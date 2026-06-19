# learn-http-for-web-frontend-perspective-part-027.md

# Part 027 — Service Workers, Cache API, Offline, and Request Interception

> Seri: `learn-http-for-web-frontend-perspective`  
> Bagian: `027`  
> Topik: Service Workers, Cache API, Offline, and Request Interception  
> Perspektif: Java Software Engineer yang ingin memahami HTTP dari sisi browser/frontend secara dalam, operasional, dan arsitektural.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 026, kita sudah membangun banyak layer:

1. HTTP message model.
2. Methods dan status codes.
3. Headers, body, media type.
4. Fetch API dan non-fetch requests.
5. CORS, cookies, auth, CSRF.
6. HTTP caching dan revalidation.
7. Redirects, negotiation, compression.
8. Resource loading dan waterfall.
9. HTTP/1.1, HTTP/2, HTTP/3.
10. HTTPS, secure contexts, security headers.
11. Browser isolation policies.
12. API design, mutation, error contract.
13. Streaming, SSE, WebSocket, WebTransport.

Sekarang kita masuk ke layer yang sering paling membingungkan bagi backend engineer: **service worker**.

Service worker bukan sekadar “cache untuk PWA”. Service worker adalah **programmable network interceptor** yang berjalan di browser, berada di antara halaman web dan network, dan dapat mengubah bagaimana request ditangani.

Mental model sederhananya:

```text
Page / Browser Resource Loader
        |
        | Request: navigation, JS, CSS, image, font, fetch, etc.
        v
Service Worker, jika scope cocok dan aktif
        |
        | Bisa:
        | - pass-through ke network
        | - response dari Cache API
        | - race cache vs network
        | - fallback offline
        | - synthesize response
        | - queue mutation untuk replay
        v
HTTP cache / network / server / CDN
```

Tanpa service worker, browser punya HTTP cache yang dikontrol oleh header seperti `Cache-Control`, `ETag`, dan `Last-Modified`.

Dengan service worker, aplikasi bisa menambahkan lapisan cache dan routing sendiri menggunakan JavaScript.

Ini kuat, tapi berbahaya.

Salah desain service worker dapat menyebabkan:

- user menjalankan versi aplikasi lama;
- HTML baru memakai JavaScript lama;
- JavaScript lama memanggil API contract baru;
- response API personalized tersimpan dan dipakai user lain di shared device;
- offline queue mengirim mutation ganda;
- logout terlihat sukses tapi cache masih menyimpan data sensitif;
- bug hanya muncul di production, tidak bisa direproduksi dengan hard refresh biasa.

Part ini akan membahas service worker sebagai sistem jaringan, bukan sekadar fitur PWA.

---

## 1. Apa Itu Service Worker?

Service worker adalah script JavaScript yang browser jalankan di background, terpisah dari thread utama halaman.

Ia dapat:

- menerima event lifecycle seperti `install` dan `activate`;
- menerima `fetch` event untuk request yang berada dalam scope-nya;
- membuka Cache API;
- mengirim dan menerima message dari page;
- mendukung fitur seperti push notification dan background sync pada browser yang mendukung;
- mengontrol bagaimana aplikasi merespons saat network unavailable.

Namun service worker juga punya batasan penting:

- tidak punya akses langsung ke DOM;
- hanya berjalan pada secure context, umumnya HTTPS, kecuali pengecualian localhost untuk development;
- event-driven, tidak selalu hidup;
- bisa dihentikan browser kapan saja saat idle;
- tidak boleh dianggap sebagai long-running daemon;
- tidak otomatis memperbaiki caching; developer harus mendesain strateginya.

Service worker lebih mirip **reverse proxy kecil di sisi browser** daripada “utility JavaScript biasa”.

---

## 2. Service Worker Bukan HTTP Cache

Ini salah satu confusion terbesar.

HTTP cache browser:

```text
Server mengirim header:
Cache-Control: max-age=3600
ETag: "abc"

Browser cache memutuskan:
- fresh?
- stale?
- revalidate?
- boleh store?
```

Service worker cache:

```text
Developer menulis JavaScript:
const cached = await caches.match(request)
if (cached) return cached
return fetch(request)
```

Perbedaannya fundamental.

| Aspek | HTTP Cache | Service Worker + Cache API |
|---|---|---|
| Dikontrol oleh | HTTP headers | JavaScript application logic |
| Scope | Browser cache policy | Service worker registration scope |
| Storage API | Internal browser cache | CacheStorage / Cache API |
| Revalidation otomatis | Ya, berdasarkan HTTP semantics | Tidak otomatis kecuali developer implementasikan |
| Bisa synthesize response | Tidak | Ya |
| Bisa offline fallback | Terbatas | Ya |
| Bisa salah serve app shell lama | Tidak dengan sendirinya | Sangat bisa |
| Cocok untuk | Generic HTTP caching | App-specific routing/caching/offline |

Cache API menyimpan `Request` → `Response` pairs.

Tapi Cache API bukan database umum. Ia lebih cocok untuk response resource, bukan domain object kompleks. Untuk data aplikasi yang perlu query, index, dan transactional semantics, IndexedDB biasanya lebih tepat.

---

## 3. Core Mental Model: Service Worker sebagai Programmable Network Router

Jangan mulai dari “bagaimana cache offline”. Mulai dari routing.

Untuk setiap request dalam scope, service worker harus menjawab pertanyaan:

```text
Request ini jenis apa?
- navigation document?
- static asset?
- API read?
- API mutation?
- image?
- font?
- third-party script?
- analytics/beacon?

Apa strategi yang benar?
- network-only?
- cache-only?
- cache-first?
- network-first?
- stale-while-revalidate?
- offline fallback?
- bypass service worker?

Apa correctness invariant-nya?
- boleh stale berapa lama?
- personalized atau public?
- versioned atau unversioned?
- sensitive atau aman?
- mutation atau read-only?
```

Service worker yang baik bukan “cache everything”.

Service worker yang baik adalah **request classifier + policy executor**.

Contoh klasifikasi:

```text
Navigation request:
  network-first + fallback app shell/offline page

Hashed JS/CSS/image asset:
  cache-first, long-lived, versioned cleanup

HTML document:
  network-first atau no-cache-like strategy

API GET public catalog:
  stale-while-revalidate, mungkin dengan TTL aplikasi

API GET user profile:
  network-first, careful private cache atau no-store

API POST/PUT/PATCH/DELETE:
  network-only by default; offline queue hanya jika didesain idempotent

Auth/session endpoints:
  network-only; jangan cache

Logout:
  network-only + purge relevant caches
```

---

## 4. Registration, Scope, dan Control

Service worker diregistrasikan dari page:

```js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js');
      console.log('SW registered:', registration.scope);
    } catch (err) {
      console.error('SW registration failed:', err);
    }
  });
}
```

Scope default ditentukan oleh lokasi file service worker.

Jika file berada di:

```text
/service-worker.js
```

maka scope default bisa mencakup:

```text
/
```

Jika file berada di:

```text
/app/service-worker.js
```

maka scope default biasanya:

```text
/app/
```

Scope menentukan URL mana yang bisa dikontrol.

Contoh:

```text
Service worker scope: https://example.com/app/

Dikontrol:
https://example.com/app/
https://example.com/app/dashboard
https://example.com/app/assets/main.js

Tidak dikontrol:
https://example.com/
https://example.com/api/users   jika di luar /app/
https://cdn.example.com/app.js   beda origin
```

Implikasi penting:

- service worker tidak bisa mengontrol origin lain;
- path file service worker memengaruhi scope;
- CDN assets di origin berbeda tidak otomatis dikontrol;
- API di subdomain berbeda tidak dikontrol oleh service worker app, meskipun bisa di-`fetch` oleh service worker;
- service worker hanya intercept request dari controlled clients dalam scope.

---

## 5. Lifecycle: Install, Waiting, Activate, Control

Service worker lifecycle sering menjadi sumber bug deployment.

Secara konseptual:

```text
register()
   |
   v
installing
   |
   v
installed / waiting
   |
   v
activating
   |
   v
activated
   |
   v
controls pages, receives fetch events
```

### 5.1 Install

Event `install` biasanya digunakan untuk precache asset penting.

```js
const STATIC_CACHE = 'static-v1';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll([
        '/',
        '/offline.html',
        '/assets/app.abc123.js',
        '/assets/app.def456.css'
      ]);
    })
  );
});
```

`event.waitUntil()` memberi tahu browser bahwa install belum selesai sampai promise selesai.

Jika precache gagal, install bisa gagal.

Ini berarti daftar asset precache harus valid. Satu URL 404 bisa membuat service worker tidak terinstall.

### 5.2 Waiting

Service worker baru tidak selalu langsung mengontrol page yang sudah terbuka.

Biasanya ia masuk state `waiting` sampai semua tab yang masih dikontrol versi lama ditutup.

Ini bagus untuk consistency, tapi bisa mengejutkan saat deployment.

```text
Tab A membuka app dengan SW v1
Deploy SW v2
Tab B load app
SW v2 installed, tapi waiting
Tab A masih dikontrol v1
Tab B bisa juga masih dikontrol v1 tergantung kondisi
```

### 5.3 Activate

Event `activate` sering digunakan untuk cleanup cache versi lama.

```js
const CURRENT_CACHES = new Set(['static-v2', 'runtime-v2']);

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => {
      return Promise.all(
        names
          .filter(name => !CURRENT_CACHES.has(name))
          .map(name => caches.delete(name))
      );
    })
  );
});
```

### 5.4 Claiming Clients

`clients.claim()` membuat service worker aktif segera mengontrol clients dalam scope.

```js
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
```

Ini kuat, tapi berisiko jika HTML/JS yang sudah loaded tidak kompatibel dengan service worker baru.

### 5.5 skipWaiting

`self.skipWaiting()` memaksa service worker baru melewati state waiting.

```js
self.addEventListener('install', event => {
  self.skipWaiting();
});
```

Ini sering dipakai untuk update cepat, tapi bisa menyebabkan **mixed-version runtime**:

```text
Page JS v1 masih berjalan
Service worker v2 tiba-tiba mengontrol fetch
API/cache routing v2 mungkin tidak kompatibel dengan JS v1
```

Prinsip:

```text
skipWaiting() bukan default terbaik untuk semua app.
Ia adalah keputusan deployment strategy.
```

---

## 6. Fetch Event: Titik Intersepsi Utama

Service worker menerima `fetch` event untuk request yang dibuat oleh controlled client.

Request itu bisa berasal dari:

- navigation;
- `fetch()`;
- XHR;
- script loading;
- CSS loading;
- image loading;
- font loading;
- iframe;
- manifest;
- module import;
- dan resource lain yang melewati Fetch infrastructure browser.

Contoh basic pass-through:

```js
self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});
```

Ini tidak menambah nilai, tapi menunjukkan bahwa service worker bisa menggantikan default browser fetch handling.

Contoh fallback cache:

```js
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request);
    })
  );
});
```

Namun kode seperti ini terlalu naif.

Masalahnya:

- semua request diperlakukan sama;
- API response bisa dicache tanpa policy;
- POST tidak ditangani benar;
- opaque cross-origin responses bisa tersimpan tanpa bisa dibaca;
- error network tidak punya fallback baik;
- tidak ada versioning;
- tidak ada TTL;
- tidak ada cleanup;
- auth/logout tidak dipertimbangkan.

Service worker production perlu routing eksplisit.

---

## 7. Request Classification dalam Service Worker

Contoh classifier sederhana:

```js
function classifyRequest(request) {
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    return 'navigation';
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    return 'static-asset';
  }

  if (url.origin === 'https://api.example.com') {
    if (request.method === 'GET') return 'api-read';
    return 'api-mutation';
  }

  if (['image', 'font', 'style', 'script'].includes(request.destination)) {
    return `subresource:${request.destination}`;
  }

  return 'other';
}
```

Kemudian routing:

```js
self.addEventListener('fetch', event => {
  const type = classifyRequest(event.request);

  if (type === 'navigation') {
    event.respondWith(handleNavigation(event.request));
    return;
  }

  if (type === 'static-asset') {
    event.respondWith(cacheFirst(event.request, 'static-v1'));
    return;
  }

  if (type === 'api-read') {
    event.respondWith(networkFirst(event.request, 'api-runtime-v1'));
    return;
  }

  if (type === 'api-mutation') {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(fetch(event.request));
});
```

Inilah pola sehat: eksplisit, berbeda per tipe request, dan punya fallback jelas.

---

## 8. Cache API: Primitive, Bukan Strategy

Cache API menyediakan primitive seperti:

```js
const cache = await caches.open('runtime-v1');
await cache.put(request, response);
const cached = await cache.match(request);
await cache.delete(request);
const keys = await cache.keys();
```

Tapi Cache API tidak otomatis tahu:

- response boleh dicache atau tidak;
- TTL aplikasi;
- apakah response personalized;
- apakah response masih kompatibel dengan versi app;
- apakah user sudah logout;
- apakah schema API sudah berubah;
- apakah cache perlu dibersihkan.

Dengan kata lain:

```text
Cache API gives storage.
It does not give correctness.
```

Developer harus menambahkan policy.

---

## 9. Strategy 1: Network Only

Network only berarti selalu ke network.

```js
async function networkOnly(request) {
  return fetch(request);
}
```

Cocok untuk:

- login;
- logout;
- refresh token;
- payment;
- mutation default;
- sensitive personalized API;
- admin action;
- audit-related request;
- anything correctness-critical.

Failure behavior:

- offline → gagal;
- server down → gagal;
- UI harus menampilkan failure state.

Network-only adalah strategi paling aman untuk correctness.

---

## 10. Strategy 2: Cache Only

Cache only berarti hanya ambil dari cache.

```js
async function cacheOnly(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (!cached) {
    return new Response('Not found in cache', { status: 504 });
  }
  return cached;
}
```

Cocok untuk:

- asset yang sudah dipastikan diprecache;
- offline shell resource;
- controlled static fallback.

Tidak cocok untuk:

- HTML yang berubah;
- API response;
- auth state;
- resource yang tidak dijamin ada.

Risiko:

```text
Jika asset tidak ada di cache, user stuck meski network tersedia.
```

---

## 11. Strategy 3: Cache First

Cache first:

1. cek cache;
2. kalau ada, return;
3. kalau tidak, fetch network;
4. simpan response;
5. return response.

```js
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  const response = await fetch(request);

  if (response.ok) {
    cache.put(request, response.clone());
  }

  return response;
}
```

Cocok untuk:

- hashed static assets;
- images yang immutable;
- fonts;
- versioned resources.

Tidak cocok untuk:

- HTML document;
- API response yang harus fresh;
- user-specific data;
- resource tanpa versioning.

Invariant cache-first:

```text
URL harus berubah saat content berubah.
```

Artinya cache-first aman jika resource URL fingerprinted:

```text
/assets/app.a1b2c3.js
/assets/style.d4e5f6.css
```

Tidak aman jika:

```text
/assets/app.js
```

karena `app.js` bisa berubah tapi cache tetap menyajikan versi lama.

---

## 12. Strategy 4: Network First

Network first:

1. coba network;
2. jika sukses, simpan cache;
3. jika network gagal, fallback ke cache.

```js
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);

    if (response.ok && request.method === 'GET') {
      cache.put(request, response.clone());
    }

    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}
```

Cocok untuk:

- HTML navigation;
- API GET yang boleh fallback stale;
- user dashboard yang bisa menampilkan last known data;
- content yang harus fresh jika possible.

Risiko:

- offline fallback bisa stale;
- user mungkin melihat data lama tanpa sadar;
- response error HTTP seperti 500 tidak otomatis masuk `catch`, karena `fetch()` resolve untuk HTTP error.

Jika ingin fallback untuk 500 juga, harus eksplisit:

```js
async function networkFirstWithHttpFallback(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);

    if (response.ok) {
      cache.put(request, response.clone());
      return response;
    }

    const cached = await cache.match(request);
    return cached || response;
  } catch (err) {
    const cached = await cache.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}
```

---

## 13. Strategy 5: Stale While Revalidate

Stale-while-revalidate:

1. return cache immediately if available;
2. in background fetch latest;
3. update cache for next time.

```js
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedPromise = cache.match(request);

  const networkPromise = fetch(request)
    .then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  const cached = await cachedPromise;
  return cached || networkPromise || new Response('Unavailable', { status: 503 });
}
```

Cocok untuk:

- avatar;
- public catalog;
- semi-static metadata;
- feature flags jika stale acceptable;
- public content.

Tidak cocok untuk:

- account balance;
- auth session;
- permission list yang harus fresh;
- regulatory case state yang harus legally defensible;
- any data where stale state can trigger wrong user action.

Stale-while-revalidate adalah performance pattern, bukan correctness pattern.

---

## 14. Strategy 6: Offline Fallback

Offline fallback untuk navigation biasanya:

1. coba network;
2. jika gagal, return `/offline.html`.

```js
async function handleNavigation(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const cache = await caches.open('static-v1');
    const fallback = await cache.match('/offline.html');
    return fallback || new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}
```

Untuk SPA, sering fallback ke app shell:

```js
async function handleSpaNavigation(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const cache = await caches.open('static-v1');
    return cache.match('/index.html');
  }
}
```

Tapi hati-hati:

```text
Jangan return /index.html untuk semua 404 secara buta.
```

Kalau user membuka URL invalid saat online, server harus bisa mengembalikan 404 yang benar.

Salah desain:

```text
GET /not-a-real-page
network returns 404
service worker treats it as failure
returns index.html
user sees blank route atau misleading app page
```

Network failure dan HTTP 404 adalah kondisi berbeda.

---

## 15. Navigation Preload

Service worker kadang memperlambat navigation karena browser harus membangunkan service worker dulu sebelum request network dilakukan.

Navigation preload memungkinkan browser memulai network request untuk navigation secara paralel saat service worker sedang booting.

Enable saat activate:

```js
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});
```

Gunakan di fetch handler:

```js
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const preload = await event.preloadResponse;
      if (preload) return preload;

      try {
        return await fetch(event.request);
      } catch (err) {
        const cache = await caches.open('static-v1');
        return cache.match('/offline.html');
      }
    })());
  }
});
```

Manfaat:

```text
Mengurangi service worker startup penalty untuk navigation.
```

Batasan:

- tidak semua browser/support context sama;
- hanya relevan untuk navigation GET;
- server bisa melihat header `Service-Worker-Navigation-Preload` pada request preload di browser yang mendukung.

---

## 16. Precache vs Runtime Cache

### 16.1 Precache

Precache adalah cache saat install.

Cocok untuk:

- app shell;
- offline page;
- hashed JS/CSS penting;
- icon/logo;
- minimal critical assets.

Kelebihan:

- resource tersedia offline sejak service worker terinstall;
- predictable.

Kekurangan:

- install bisa gagal kalau asset gagal;
- memperbesar initial cost;
- bisa membuang bandwidth untuk resource yang tidak dipakai.

### 16.2 Runtime Cache

Runtime cache adalah cache saat request terjadi.

Cocok untuk:

- images;
- API GET tertentu;
- route-specific assets;
- content yang tidak perlu tersedia sejak awal.

Kelebihan:

- lebih lazy;
- tidak menghambat install;
- menyesuaikan perilaku user.

Kekurangan:

- perlu eviction;
- bisa tumbuh liar;
- correctness lebih sulit.

---

## 17. Versioning dan Cache Cleanup

Cache harus diberi versi.

```js
const VERSION = '2026-06-18-001';
const STATIC_CACHE = `static-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;
```

Saat activate, hapus cache lama:

```js
self.addEventListener('activate', event => {
  const expected = new Set([STATIC_CACHE, RUNTIME_CACHE]);

  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => !expected.has(key))
        .map(key => caches.delete(key))
    ))
  );
});
```

Tapi jangan terlalu agresif.

Jika hapus cache lama saat tab lama masih berjalan, page lama mungkin meminta asset yang sudah tidak ada.

Masalah deployment klasik:

```text
1. User membuka app v1.
2. Service worker v2 aktif dan menghapus cache v1.
3. Page v1 melakukan dynamic import /assets/chunk-v1.js.
4. Asset v1 sudah hilang dari cache dan server sudah tidak menyimpan file lama.
5. User mendapat ChunkLoadError.
```

Mitigasi:

- gunakan hashed asset;
- simpan beberapa versi asset di server/CDN untuk window tertentu;
- jangan hapus semua cache lama terlalu cepat;
- gunakan update prompt ke user;
- hindari `skipWaiting()` agresif tanpa kompatibilitas;
- buat chunk load recovery strategy.

---

## 18. Service Worker dan HTTP Cache: Double Cache Problem

Request melalui service worker masih bisa menggunakan HTTP cache, tergantung `fetch()` options dan browser behavior.

Ada beberapa layer:

```text
Service Worker Cache API
        |
fetch(request)
        |
Browser HTTP Cache
        |
Network/CDN
        |
Origin
```

Bug muncul jika developer lupa ada dua cache.

Contoh:

```js
const response = await fetch('/api/me');
cache.put('/api/me', response.clone());
```

Jika server mengirim:

```http
Cache-Control: max-age=600
```

maka `fetch('/api/me')` bisa saja mendapat response dari HTTP cache, lalu service worker menyimpan lagi response stale ke Cache API.

Untuk request tertentu, gunakan cache mode:

```js
fetch(request, { cache: 'no-store' })
```

Namun jangan gunakan `no-store` secara sembarangan karena bisa menghancurkan performance dan revalidation.

Prinsip:

```text
Tentukan siapa owner caching policy:
- HTTP cache via headers?
- Service worker runtime cache?
- App data cache seperti React Query/TanStack Query?
- IndexedDB domain cache?
```

Jika semua layer caching tanpa koordinasi, debugging menjadi sangat mahal.

---

## 19. Auth, Cookies, dan Credentials dalam Service Worker

Service worker fetch mengikuti rules Fetch API.

Jika page request membawa credentials sesuai policy, service worker menerima `Request` tersebut.

Namun ketika service worker membuat request baru, developer harus hati-hati.

Contoh salah:

```js
fetch(event.request.url)
```

Ini membuat request baru dari string, dan bisa kehilangan properties penting dari original request.

Lebih aman:

```js
fetch(event.request)
```

Atau clone dengan sadar:

```js
const newRequest = new Request(event.request, {
  headers: newHeaders
});
```

Tapi memodifikasi request tidak selalu mungkin, terutama body stream yang sudah dipakai atau mode/credentials tertentu.

Untuk auth endpoints:

```text
/login
/logout
/session
/token/refresh
```

biasanya gunakan network-only dan jangan cache response.

Logout harus mempertimbangkan cache purge.

Contoh:

```js
async function clearUserCaches() {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter(name => name.startsWith('user-') || name.startsWith('api-private-'))
      .map(name => caches.delete(name))
  );
}
```

Page bisa mengirim message ke service worker saat logout:

```js
navigator.serviceWorker.controller?.postMessage({ type: 'LOGOUT' });
```

Service worker:

```js
self.addEventListener('message', event => {
  if (event.data?.type === 'LOGOUT') {
    event.waitUntil(clearUserCaches());
  }
});
```

Invariant penting:

```text
Jika data terkait user identity, cache harus dipartisi per user atau dibersihkan saat identity berubah.
```

---

## 20. API Caching: Sangat Berguna, Sangat Berisiko

API GET tertentu bisa dicache oleh service worker.

Tapi pertanyaan pertama bukan “bisa dicache?” melainkan:

```text
Apa konsekuensi jika response ini stale?
```

Klasifikasi:

| API | Strategy | Catatan |
|---|---|---|
| `/api/public/catalog` | stale-while-revalidate | Jika stale acceptable |
| `/api/me` | network-first atau network-only | Private dan identity-sensitive |
| `/api/permissions` | network-only atau strict revalidate | Stale permission berbahaya |
| `/api/cases/{id}` | tergantung domain | Untuk regulatory workflow, stale state bisa fatal |
| `/api/notifications` | network-first | Stale acceptable jika UI jelas |
| `/api/exchange-rates` | TTL eksplisit | Bisa stale dengan label timestamp |
| `/api/feature-flags` | network-first + short TTL | Stale flags bisa memengaruhi rollout |

Untuk domain seperti enforcement lifecycle, case management, regulatory workflow, default aman adalah:

```text
Service worker jangan sembarang cache API state transaksional.
```

Jika cache dipakai, UI harus menyatakan:

- data terakhir diperbarui kapan;
- apakah offline/stale;
- apakah action tertentu disabled saat offline;
- apakah mutation akan disimpan untuk sync nanti.

---

## 21. Offline Mutation Queue: Problem State Machine, Bukan Sekadar Queue

Offline mutation terlihat menarik:

```text
User offline → submit action → simpan queue → replay saat online
```

Tapi ini sangat kompleks.

Pertanyaan wajib:

1. Apakah mutation idempotent?
2. Apakah server menerima idempotency key?
3. Apakah action masih valid saat direplay?
4. Bagaimana jika entity sudah berubah?
5. Bagaimana jika user logout sebelum replay?
6. Bagaimana jika permission berubah?
7. Bagaimana jika replay sebagian sukses?
8. Bagaimana audit trail dicatat?
9. Bagaimana user tahu action masih pending?
10. Bagaimana konflik diselesaikan?

Contoh queue item:

```json
{
  "id": "client-generated-uuid",
  "type": "APPROVE_CASE",
  "method": "POST",
  "url": "/api/cases/CASE-123/approve",
  "body": {
    "reason": "validated"
  },
  "idempotencyKey": "approve-CASE-123-client-uuid",
  "createdAt": "2026-06-18T10:00:00Z",
  "baseVersion": "etag-or-case-version-17"
}
```

Replay harus mengirim precondition:

```http
Idempotency-Key: approve-CASE-123-client-uuid
If-Match: "case-version-17"
```

Jika server response:

```http
409 Conflict
```

atau:

```http
412 Precondition Failed
```

maka frontend tidak boleh diam-diam menganggap sukses.

Untuk regulated workflow, offline mutation sering harus dibatasi pada action yang aman, bukan semua action.

Prinsip:

```text
Offline mutation without server-side idempotency and conflict protocol is data corruption waiting to happen.
```

---

## 22. Background Sync

Background Sync memungkinkan aplikasi meminta browser menjalankan sync saat koneksi kembali tersedia.

Namun dukungan browser dan kondisi eksekusi bervariasi.

Jangan desain critical business workflow yang hanya bergantung pada background sync.

Lebih aman:

- simpan queue secara lokal;
- tampilkan pending state di UI;
- coba replay saat app dibuka dan online;
- gunakan background sync sebagai enhancement;
- pastikan server idempotent;
- pastikan conflict handling eksplisit.

Pseudo-flow:

```text
User submit offline mutation
  -> write queue to IndexedDB
  -> UI shows Pending Sync
  -> register background sync if supported
  -> on sync/app resume/online event: replay
  -> success: mark done
  -> conflict: require user resolution
  -> auth expired: pause queue
```

---

## 23. Push Notification dan Service Worker

Service worker juga dipakai untuk push notification.

Namun push bukan topik HTTP request/response utama di seri ini. Yang penting untuk frontend HTTP perspective:

- push event bisa membangunkan service worker;
- notification click bisa membuka/focus client;
- push payload harus diperlakukan sebagai untrusted input;
- jangan menyimpan sensitive data sembarangan;
- push bukan replacement untuk server state query;
- user permission dan browser policy sangat menentukan.

Contoh flow:

```text
Server sends push: "Case updated"
Service worker receives push
Shows notification
User clicks
Client opens /cases/123
App fetches latest case state from server
```

Push memberi sinyal, bukan sumber kebenaran final.

---

## 24. Opaque Responses dan Cross-Origin Caching

Jika service worker fetch resource cross-origin dengan `no-cors`, response bisa menjadi opaque.

Opaque response:

- status tidak bisa dibaca secara normal;
- body tidak bisa dibaca;
- header tidak bisa dibaca;
- bisa disimpan di cache dalam kondisi tertentu;
- sulit divalidasi.

Contoh:

```js
const response = await fetch('https://third-party-cdn.example/script.js', {
  mode: 'no-cors'
});
```

Jangan cache opaque response tanpa alasan kuat.

Risikonya:

- Anda tidak tahu apakah response sebenarnya 200, 404, atau error-like;
- Anda bisa menyimpan response buruk;
- debugging sulit;
- security posture lebih lemah.

Untuk asset penting, lebih baik:

- host sendiri;
- pakai CORS yang benar;
- pakai SRI jika third-party script;
- hindari service worker caching untuk third-party sensitive resources.

---

## 25. Range Requests, Streaming, dan Response Clone

Response body adalah stream.

Jika service worker ingin membaca response dan juga mengembalikannya ke page, harus clone.

```js
const response = await fetch(request);
const copy = response.clone();
await cache.put(request, copy);
return response;
```

Jika tidak clone:

```js
const response = await fetch(request);
await cache.put(request, response);
return response; // body may already be consumed
```

Bug:

```text
TypeError: body stream already read
```

Untuk large files, video, range requests, streaming response, service worker caching bisa lebih kompleks.

Jangan otomatis cache semua response besar.

Pertimbangkan:

- response size;
- `Range` header;
- memory pressure;
- device storage;
- eviction;
- user data cost.

---

## 26. Storage Pressure dan Eviction

Cache API storage tidak infinite.

Browser bisa menghapus data origin dalam kondisi storage pressure.

Aplikasi tidak boleh mengasumsikan cache akan selalu tersedia.

Prinsip:

```text
Cache is optimization and resilience aid, not durable source of truth.
```

Gunakan cache untuk:

- asset yang bisa diunduh ulang;
- offline fallback;
- last known safe data;
- performance optimization.

Jangan gunakan Cache API sebagai satu-satunya penyimpanan untuk:

- transaction log penting;
- unsynced regulatory action;
- data yang tidak bisa direkonstruksi;
- bukti audit.

Untuk queue penting, gunakan IndexedDB dengan desain durability lebih eksplisit, lalu tetap sadar browser storage dapat dihapus user/browser.

---

## 27. Update Strategy: Prompt vs Force Reload

Saat service worker baru tersedia, aplikasi perlu strategi update.

Pilihan:

### 27.1 Passive Update

Biarkan browser mengaktifkan versi baru setelah semua tab lama ditutup.

Kelebihan:

- minim mixed-version bug;
- user tidak terganggu.

Kekurangan:

- user bisa lama memakai versi lama.

### 27.2 Prompt User

Tampilkan banner:

```text
Versi baru tersedia. Refresh untuk memperbarui.
```

Kelebihan:

- user aware;
- mengurangi forced interruption;
- cocok untuk app produktivitas.

### 27.3 Force Reload

Paksa reload saat update tersedia.

Kelebihan:

- cepat pindah versi.

Kekurangan:

- bisa kehilangan unsaved state;
- berbahaya untuk form panjang;
- buruk untuk workflow kritis.

Untuk enterprise/regulatory case management, umumnya lebih defensible:

```text
Prompt update + preserve draft state + safe reload point.
```

Bukan force reload sembarangan.

---

## 28. Workbox: Abstraction yang Berguna, Bukan Pengganti Pemahaman

Workbox menyediakan helper untuk:

- precaching;
- routing;
- caching strategies;
- expiration;
- background sync;
- broadcast update;
- build integration.

Namun Workbox tidak menghapus kebutuhan desain.

Salah:

```text
Pakai Workbox lalu cache semua GET.
```

Benar:

```text
Gunakan Workbox untuk mengekspresikan policy yang sudah jelas.
```

Contoh konseptual:

```js
// Pseudocode style, bukan konfigurasi final
registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({ cacheName: 'images' })
);

registerRoute(
  ({ url }) => url.pathname.startsWith('/assets/'),
  new CacheFirst({ cacheName: 'static-assets' })
);

registerRoute(
  ({ url, request }) => url.pathname.startsWith('/api/') && request.method === 'GET',
  new NetworkFirst({ cacheName: 'api-read-cache' })
);
```

Tetap perlu menjawab:

- API mana yang boleh dicache?
- TTL berapa?
- user-specific atau public?
- logout purge bagaimana?
- error fallback bagaimana?
- cache versioning bagaimana?

---

## 29. Debugging Service Worker

Checklist debugging:

### 29.1 Pastikan Page Controlled atau Tidak

Di browser DevTools Application panel:

- service worker registered?
- status activated/running/stopped?
- clients controlled?
- update found?
- waiting worker?

Dari console:

```js
navigator.serviceWorker.controller
```

Jika `null`, page belum dikontrol service worker.

### 29.2 Network Tab

Cari indikasi:

```text
from ServiceWorker
from disk cache
from memory cache
```

Bedakan:

- response dari service worker;
- response dari HTTP cache;
- response dari network;
- response dari preloaded navigation.

### 29.3 Disable / Unregister

Untuk isolasi:

- unregister service worker;
- clear site data;
- hard reload;
- test incognito/fresh profile.

Jangan langsung menyimpulkan server bug sebelum service worker dibypass.

### 29.4 Log dengan Hati-Hati

Service worker console berbeda dari page console.

Tambahkan structured logging saat development:

```js
console.log('[sw] fetch', event.request.method, event.request.url, classifyRequest(event.request));
```

Hapus/kurangi noisy logs di production.

### 29.5 Inspect Cache Storage

DevTools Application → Cache Storage.

Periksa:

- cache names;
- stale entries;
- unexpected API responses;
- old asset versions;
- offline page;
- user-specific data.

---

## 30. Failure Mode Catalog

### 30.1 App Shell Lama

Symptom:

```text
User masih melihat UI versi lama setelah deployment.
```

Possible cause:

- service worker cache-first untuk `/index.html`;
- old SW masih active;
- new SW waiting;
- CDN cache juga stale.

Fix:

- jangan cache-first HTML;
- gunakan network-first/revalidate;
- update prompt;
- versioned cache cleanup.

### 30.2 ChunkLoadError Setelah Deploy

Symptom:

```text
Dynamic import gagal, JS chunk 404.
```

Possible cause:

- HTML/JS lama refer ke chunk lama;
- server/CDN sudah menghapus asset lama;
- SW cleanup terlalu agresif.

Fix:

- keep old assets for a grace period;
- hashed assets immutable;
- chunk error recovery;
- avoid aggressive cache deletion.

### 30.3 API Data Stale Tanpa Indikator

Symptom:

```text
User melihat status case lama dan melakukan action salah.
```

Possible cause:

- stale-while-revalidate untuk state transaksional;
- service worker fallback ke cache saat server 500;
- UI tidak menandai stale.

Fix:

- network-only/network-first strict untuk critical state;
- show stale timestamp;
- disable mutation saat offline/stale;
- use ETag/precondition.

### 30.4 Logout Tapi Data Masih Muncul

Symptom:

```text
User logout, login sebagai user lain, data user pertama muncul.
```

Possible cause:

- user-specific API cached tanpa partition;
- logout tidak purge cache;
- cache key tidak include user identity.

Fix:

- purge private caches on logout;
- partition cache per user;
- avoid caching sensitive data;
- server send no-store for private endpoints.

### 30.5 Postman Berhasil, Browser Gagal Saat Offline/Service Worker Aktif

Symptom:

```text
API terlihat benar di Postman, tapi browser menerima response aneh.
```

Possible cause:

- service worker intercept;
- cached synthetic response;
- CORS/browser policy;
- credentials lost in reconstructed request.

Fix:

- bypass/unregister SW;
- inspect `from ServiceWorker`;
- compare real network request;
- preserve original request object.

### 30.6 Offline Mutation Ganda

Symptom:

```text
Action yang sama terkirim dua kali setelah online.
```

Possible cause:

- queue replay retry tanpa idempotency key;
- user resubmit;
- background sync + foreground replay double-send.

Fix:

- idempotency key;
- queue item state machine;
- server-side dedupe;
- single replay lock;
- visible pending state.

---

## 31. Security Considerations

Service worker memperbesar attack surface karena dapat mengontrol request/response.

Risiko:

- compromised service worker dapat serve malicious JS;
- stale vulnerable asset bertahan di cache;
- sensitive API response tersimpan;
- logout tidak membersihkan data;
- third-party script compromise saat precache;
- cache poisoning karena key terlalu longgar;
- scope terlalu luas.

Mitigasi:

1. Serve service worker dari HTTPS.
2. Batasi scope jika memungkinkan.
3. Jangan cache auth/session/payment endpoints.
4. Gunakan CSP dan SRI untuk mengurangi risiko script injection.
5. Version cache secara eksplisit.
6. Purge private cache saat logout.
7. Jangan cache opaque third-party response sembarangan.
8. Audit routing rules.
9. Hindari `eval`/dynamic untrusted code.
10. Treat service worker update as security-sensitive deployment.

Service worker adalah bagian dari trusted computing base frontend.

---

## 32. Service Worker untuk Enterprise/Regulatory Systems

Untuk sistem enforcement lifecycle atau complex case management, service worker harus dipakai lebih hati-hati daripada consumer content app.

Pertanyaan desain:

### 32.1 Data Classification

```text
Public static?
Public dynamic?
User-specific but low-risk?
Sensitive case data?
Permission-sensitive?
Audit-critical?
Legal-state-changing?
```

### 32.2 Allowed Offline Behavior

```text
Boleh read-only offline?
Boleh draft offline?
Boleh submit offline?
Boleh approve/reject offline?
Boleh upload evidence offline?
```

Untuk banyak regulated workflow:

- offline draft mungkin boleh;
- offline submit mungkin boleh dengan pending state;
- offline approval/rejection sering harus dilarang atau memerlukan strict conflict check;
- stale permission tidak boleh dipakai untuk authorize final action.

### 32.3 Auditability

Jika offline action didukung:

- kapan user membuat action locally?
- kapan action dikirim ke server?
- kapan server menerima?
- state entity saat action dibuat?
- state entity saat action diterapkan?
- apakah ada conflict?
- apakah user diberi tahu?

Service worker saja tidak cukup. Server protocol harus mendukung audit semantics.

---

## 33. Practical Architecture Pattern

Untuk SPA enterprise modern:

```text
Static assets:
  cache-first, hashed, immutable

HTML document:
  network-first, fallback offline page, not cache-first forever

Public images:
  stale-while-revalidate + expiration

Private API reads:
  network-first or network-only, explicit allowlist only

Critical workflow state:
  network-only or strict revalidation

Mutations:
  network-only by default
  offline queue only for explicitly designed idempotent operations

Auth/session/logout:
  network-only + cache purge

Offline UX:
  clear status: online/offline/stale/pending sync

Update:
  prompt user, preserve state, avoid unsafe force reload
```

---

## 34. Minimal Production-Grade Service Worker Skeleton

Contoh ini bukan copy-paste final, tetapi menunjukkan struktur yang sehat.

```js
const VERSION = 'v1';
const STATIC_CACHE = `static-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;
const OFFLINE_URL = '/offline.html';

const PRECACHE_URLS = [
  OFFLINE_URL,
  '/assets/app.abc123.js',
  '/assets/app.def456.css'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(PRECACHE_URLS);
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const expected = new Set([STATIC_CACHE, RUNTIME_CACHE]);
    const names = await caches.keys();

    await Promise.all(
      names
        .filter(name => !expected.has(name))
        .map(name => caches.delete(name))
    );

    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'LOGOUT') {
    event.waitUntil(clearPrivateCaches());
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (request.method !== 'GET') {
    event.respondWith(fetch(request));
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/api/public/')) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  if (url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/session')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  event.respondWith(fetch(request));
});

async function handleNavigation(event) {
  try {
    const preload = await event.preloadResponse;
    if (preload) return preload;

    return await fetch(event.request);
  } catch (err) {
    const cache = await caches.open(STATIC_CACHE);
    const offline = await cache.match(OFFLINE_URL);
    return offline || new Response('Offline', { status: 503 });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  return cached || networkPromise || new Response('Unavailable', { status: 503 });
}

async function clearPrivateCaches() {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter(name => name.startsWith('private-') || name.startsWith('user-'))
      .map(name => caches.delete(name))
  );
}
```

Key lesson dari skeleton ini:

- tidak semua request dicache;
- mutation network-only;
- navigation punya fallback;
- assets cache-first hanya jika versioned;
- API public dibedakan dari API private;
- logout punya hook purge;
- navigation preload dipertimbangkan;
- cache versioning eksplisit.

---

## 35. Design Review Checklist

Gunakan checklist ini saat review service worker.

### 35.1 Scope

- Service worker scope sudah benar?
- Tidak terlalu luas?
- Tidak terlalu sempit sehingga route penting tidak controlled?
- API/subdomain expectations jelas?

### 35.2 Lifecycle

- Install failure behavior dipahami?
- Waiting/activate behavior dipahami?
- `skipWaiting()` digunakan dengan sadar?
- `clients.claim()` digunakan dengan sadar?
- Update prompt ada?

### 35.3 Caching

- Cache names versioned?
- Cleanup aman?
- Asset hashed?
- HTML tidak cache-first buta?
- Private API tidak dicache sembarangan?
- TTL/expiration ada untuk runtime cache?
- Opaque response tidak dicache tanpa alasan?

### 35.4 Auth

- Login/logout/session network-only?
- Cache dibersihkan saat logout?
- Cache dipartisi per user jika perlu?
- Sensitive response punya `Cache-Control: no-store` di server?

### 35.5 Offline

- Offline UX eksplisit?
- Stale data diberi label?
- Mutations saat offline dibatasi?
- Queue punya idempotency key?
- Conflict handling ada?

### 35.6 Observability

- Bisa membedakan response dari SW/cache/network?
- Logging dev cukup?
- Ada cara unregister/reset?
- Ada metric untuk stale/offline/pending sync?

### 35.7 Security

- Service worker served via HTTPS?
- CSP/SRI dipertimbangkan?
- Cache poisoning dicegah?
- Sensitive data tidak disimpan sembarangan?
- Third-party resource policy jelas?

---

## 36. Latihan Mental Model

### Latihan 1 — Klasifikasi Request

Diberikan request berikut:

```text
GET /index.html
GET /assets/app.abc123.js
GET /assets/chunk-user.def456.js
GET /api/me
GET /api/public/products?page=1
POST /api/cases/123/approve
GET https://fonts.gstatic.com/font.woff2
GET /offline.html
```

Tentukan untuk masing-masing:

- apakah service worker boleh intercept?
- strategy apa?
- boleh cache atau tidak?
- stale acceptable atau tidak?
- apa failure mode-nya?

### Latihan 2 — Debug Incident

Symptom:

```text
Setelah deployment, sebagian user melihat menu lama dan ketika klik menu tertentu muncul error 404 untuk JS chunk.
```

Analisis:

- Apakah HTML stale?
- Apakah service worker cache-first untuk HTML?
- Apakah old chunk sudah dihapus dari CDN?
- Apakah SW baru menghapus cache lama?
- Apakah user masih controlled by old SW?
- Apakah ada update prompt?

### Latihan 3 — Offline Mutation Design

Untuk action:

```text
Approve enforcement case
```

Jawab:

- boleh offline atau tidak?
- jika boleh, precondition apa?
- idempotency key bagaimana?
- conflict response apa?
- audit log mencatat apa?
- UI pending state seperti apa?

---

## 37. Ringkasan Mental Model

Service worker adalah layer jaringan programmable di browser.

Ia kuat karena bisa:

- intercept request;
- serve cache;
- fallback offline;
- mempercepat asset;
- mendukung PWA;
- mengatur update;
- membantu resilience.

Ia berbahaya karena bisa:

- menyajikan data stale;
- menyimpan data sensitif;
- membuat deployment sulit;
- menciptakan mixed-version bug;
- menggandakan mutation;
- menyembunyikan server behavior asli;
- membuat debugging HTTP lebih kompleks.

Prinsip top 1%:

```text
Jangan mendesain service worker sebagai cache blanket.
Desain sebagai policy router berdasarkan request type, data sensitivity, freshness requirement, user identity, and failure semantics.
```

Kalimat kunci:

```text
HTTP cache is protocol-driven.
Service worker cache is application-driven.
Application-driven cache must carry application correctness rules.
```

---

## 38. Referensi

Referensi utama untuk bagian ini:

- MDN — Service Worker API: `https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API`
- MDN — Using Service Workers: `https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers`
- MDN — ServiceWorkerGlobalScope fetch event: `https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/fetch_event`
- MDN — FetchEvent.respondWith(): `https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith`
- MDN — FetchEvent.preloadResponse: `https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/preloadResponse`
- MDN — NavigationPreloadManager: `https://developer.mozilla.org/en-US/docs/Web/API/NavigationPreloadManager`
- MDN — Cache API: `https://developer.mozilla.org/en-US/docs/Web/API/Cache`
- W3C — Service Workers Specification: `https://www.w3.org/TR/service-workers/`
- web.dev — Service Workers: `https://web.dev/learn/pwa/service-workers`
- web.dev — Offline Cookbook: `https://web.dev/articles/offline-cookbook`
- web.dev — Offline fallback page: `https://web.dev/articles/offline-fallback-page`
- web.dev — Navigation preload: `https://web.dev/blog/navigation-preload`
- Chrome Developers — Workbox: `https://developer.chrome.com/docs/workbox`

---

## 39. Status Seri

```text
Part 027 selesai.
Seri belum selesai.
Lanjut ke Part 028: Observability: Network Debugging, Correlation, Tracing, and RUM.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-026.md">⬅️ Part 026 — Streaming, SSE, WebSocket, WebTransport, and Long Polling</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-028.md">Part 028 — Observability: Network Debugging, Correlation, Tracing, and RUM ➡️</a>
</div>

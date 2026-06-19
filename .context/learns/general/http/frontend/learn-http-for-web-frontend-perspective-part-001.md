# learn-http-for-web-frontend-perspective-part-001.md

# Part 001 — Orientation: HTTP dari Sudut Pandang Browser

> Seri: `learn-http-for-web-frontend-perspective`  
> Audience utama: Java software engineer yang ingin memahami HTTP dari sudut pandang web/frontend secara top-tier.  
> Posisi dalam seri: setelah Part 000, sebelum masuk ke URL/origin, request/response, method, status, CORS, cookies, caching, security, performance, dan reliability.

---

## 0. Tujuan Part Ini

Bagian ini menjawab satu pertanyaan besar:

> Ketika sebuah halaman web “melakukan HTTP request”, apa yang sebenarnya terjadi dari sudut pandang browser, dan kenapa cara berpikir backend-only sering tidak cukup?

Sebagai Java engineer, Anda mungkin sudah familiar dengan:

- HTTP controller di Spring MVC/Spring WebFlux.
- REST endpoint.
- status code.
- header.
- JSON body.
- API gateway.
- reverse proxy.
- load balancer.
- TLS termination.
- logs server-side.

Namun di browser, HTTP bukan hanya `GET /users/123` dan `POST /orders`.

Browser adalah runtime yang:

1. melakukan banyak request tanpa JavaScript eksplisit;
2. menerapkan security policy di atas HTTP;
3. punya cache sendiri;
4. punya cookie jar sendiri;
5. punya storage model sendiri;
6. punya scheduler resource loading sendiri;
7. punya parser HTML/CSS/JS yang memicu request tambahan;
8. punya DevTools yang menunjukkan sebagian evidence, bukan seluruh kebenaran;
9. bisa memblokir response walaupun server mengirim 200 OK;
10. bisa tidak mengirim cookie walaupun cookie ada;
11. bisa melakukan preflight sebelum request utama;
12. bisa menggunakan cache tanpa menyentuh server;
13. bisa mengubah behavior berdasarkan origin, site, scheme, mode, credentials, CSP, service worker, dan privacy policy.

Part ini membangun mental model yang benar sebelum kita masuk ke detail teknis.

---

## 1. Kenapa HTTP dari Perspektif Frontend Berbeda?

Dari perspektif backend, HTTP sering terlihat seperti ini:

```text
client -> server -> controller -> service -> repository -> response
```

Dari perspektif browser/frontend, HTTP lebih mirip seperti ini:

```text
user action / parser / runtime / browser subsystem
        |
        v
browser policy layer
        |
        v
cache / service worker / network scheduler
        |
        v
DNS / connection / TLS / HTTP transport
        |
        v
CDN / proxy / gateway / backend
        |
        v
response headers + body
        |
        v
browser policy enforcement
        |
        v
cache update / cookie update / JS visibility / rendering impact
```

Perbedaan utamanya: **browser bukan HTTP client netral**.

`curl`, Postman, Java `HttpClient`, OkHttp, Apache HttpClient, dan browser sama-sama bisa mengirim HTTP request, tetapi browser punya constraint tambahan:

- same-origin policy;
- CORS;
- cookie SameSite;
- mixed content blocking;
- CSP;
- CORP/COEP/COOP;
- service worker interception;
- HTTP cache;
- resource priority;
- navigation rules;
- iframe sandboxing;
- secure context requirements;
- forbidden headers;
- privacy partitioning;
- storage partitioning;
- credential mode;
- referrer policy;
- redirect mode;
- request destination;
- request mode;
- fetch metadata headers.

Karena itu kalimat seperti ini sering keliru:

> “Endpoint-nya berhasil kok di Postman, berarti frontend-nya yang salah.”

Yang lebih presisi:

> “Endpoint-nya menerima request dari HTTP client non-browser. Sekarang kita perlu cek apakah request itu valid di bawah constraint browser: origin, credentials, CORS, cookie policy, redirect policy, cache, dan security headers.”

---

## 2. Browser sebagai HTTP Client Kompleks

Browser tidak hanya menjalankan JavaScript. Browser adalah gabungan banyak engine/subsystem:

```text
Browser
├── UI process
├── Network service
├── Renderer process
├── JavaScript engine
├── HTML parser
├── CSS engine
├── Layout engine
├── Compositor
├── Storage subsystem
├── Cookie store
├── HTTP cache
├── Service worker runtime
├── Security policy engine
├── Extension system
└── DevTools instrumentation
```

Dari semua subsystem itu, banyak yang bisa memicu atau memengaruhi HTTP.

### 2.1 Request yang Dipicu HTML

Contoh HTML sederhana:

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="/app.css">
    <script src="/app.js" defer></script>
  </head>
  <body>
    <img src="/hero.webp" alt="Hero">
  </body>
</html>
```

Tanpa satu baris `fetch()`, browser akan membuat request untuk:

```text
GET /               -> HTML document
GET /app.css        -> stylesheet
GET /app.js         -> script
GET /hero.webp      -> image
```

Jika CSS berisi font atau background image:

```css
@font-face {
  font-family: Inter;
  src: url('/fonts/inter.woff2') format('woff2');
}

.hero {
  background-image: url('/bg.webp');
}
```

Browser dapat membuat request tambahan:

```text
GET /fonts/inter.woff2
GET /bg.webp
```

Jika JavaScript melakukan dynamic import:

```js
import('./checkout-page.js');
```

Browser membuat request lagi:

```text
GET /checkout-page.js
```

Jadi di frontend, request bukan hanya “API call”. Request adalah konsekuensi dari:

- dokumen HTML;
- parser;
- CSS;
- JavaScript;
- module graph;
- image loading;
- font loading;
- route transition;
- service worker;
- preload/prefetch;
- analytics;
- browser extension;
- iframe;
- user navigation.

---

## 3. Tiga Lapisan yang Sering Tercampur: Protocol, Policy, API

Salah satu kesalahan besar adalah mencampur tiga hal ini:

```text
1. HTTP protocol semantics
2. Browser policy
3. JavaScript API behavior
```

Mereka berhubungan, tetapi bukan hal yang sama.

### 3.1 HTTP Protocol Semantics

Ini mencakup konsep seperti:

- method: GET, POST, PUT, PATCH, DELETE;
- status code: 200, 201, 204, 301, 304, 400, 401, 403, 404, 409, 429, 500;
- headers;
- representation;
- cache semantics;
- conditional request;
- content negotiation.

Contoh:

```http
GET /api/products/123 HTTP/1.1
Host: api.example.com
Accept: application/json
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: max-age=60

{"id":"123","name":"Keyboard"}
```

Ini adalah lapisan HTTP.

### 3.2 Browser Policy

Browser bisa berkata:

> Response ini valid secara HTTP, tetapi JavaScript tidak boleh membacanya.

Contoh cross-origin request tanpa CORS yang benar:

```js
fetch('https://api.other-company.com/private-data')
```

Server mungkin mengirim:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"secret":"..."}
```

Tetapi browser dapat memblokir JavaScript dari membaca response karena CORS policy tidak terpenuhi.

Dari sisi server: request sukses.  
Dari sisi browser: response tidak tersedia bagi script.  
Dari sisi user: aplikasi error.  
Dari sisi DevTools: mungkin terlihat request 200 tetapi console menampilkan CORS error.

### 3.3 JavaScript API Behavior

`fetch()` punya behavior sendiri.

Contoh penting:

```js
const response = await fetch('/api/orders/999');
```

Jika server mengirim 404, `fetch()` tidak otomatis throw exception.

```js
const response = await fetch('/api/orders/999');
console.log(response.status); // 404
console.log(response.ok);     // false
```

`fetch()` biasanya reject untuk network-level failure, abort, atau policy-level failure, bukan karena HTTP status 4xx/5xx.

Jadi:

```js
try {
  const response = await fetch('/api/orders/999');
  // 404 tetap masuk ke sini
} catch (error) {
  // network error / abort / policy error, bukan normal HTTP error
}
```

Kesalahan umum:

```js
try {
  const data = await fetch('/api/orders/999').then(r => r.json());
} catch (e) {
  showError('Order not found');
}
```

Masalahnya:

- 404 tidak otomatis masuk `catch`;
- response body bisa bukan JSON;
- error network dan error domain tercampur;
- UI tidak bisa membedakan not found, unauthorized, timeout, dan server down.

Versi lebih sehat:

```js
async function getJson(url, options) {
  const response = await fetch(url, options);

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    throw new HttpError({
      status: response.status,
      statusText: response.statusText,
      body,
      headers: response.headers,
    });
  }

  return body;
}
```

---

## 4. Mental Model: HTTP Request sebagai Perjalanan Multi-Boundary

Untuk engineer top-tier, request tidak dilihat sebagai satu panggilan fungsi.

Request adalah perjalanan melewati boundary.

```text
[User intent]
    |
[Frontend state]
    |
[Browser API]
    |
[Browser policy]
    |
[Cache / service worker]
    |
[Network scheduler]
    |
[DNS]
    |
[TCP/TLS/QUIC]
    |
[HTTP transport]
    |
[CDN]
    |
[Load balancer]
    |
[API gateway]
    |
[Backend service]
    |
[Persistence / downstream]
    |
[Response path back]
    |
[Browser policy again]
    |
[JS visibility / rendering / cache / cookies]
    |
[User-visible state]
```

Setiap boundary bisa:

- menambah header;
- menghapus header;
- mengubah request;
- menolak request;
- cache response;
- redirect;
- compress/decompress;
- terminate TLS;
- retry;
- timeout;
- log sebagian informasi;
- menyembunyikan informasi dari layer berikutnya.

### 4.1 Contoh: Login Request

Frontend code:

```js
await fetch('https://api.example.com/login', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'content-type': 'application/json'
  },
  body: JSON.stringify({ username, password })
});
```

Apa yang mungkin terjadi?

```text
1. Browser melihat URL cross-origin.
2. Method POST + content-type application/json dapat memicu CORS preflight.
3. Browser mengirim OPTIONS preflight.
4. Server harus menjawab CORS headers yang sesuai.
5. Jika preflight gagal, POST asli tidak dikirim.
6. Jika preflight sukses, browser mengirim POST.
7. Karena credentials: include, browser boleh mengirim cookie yang match.
8. Server mengirim Set-Cookie.
9. Browser mengevaluasi Set-Cookie: Domain, Path, Secure, SameSite, HttpOnly.
10. Jika cookie valid menurut policy, browser menyimpan cookie.
11. JavaScript mungkin tidak bisa membaca Set-Cookie header.
12. Request berikutnya baru bisa memakai cookie tersebut jika origin/site/path/secure cocok.
```

Dari backend log, mungkin hanya terlihat:

```text
OPTIONS /login 204
POST /login 200
```

Tapi dari browser, outcome bisa berbeda:

- cookie tidak tersimpan;
- cookie tersimpan tapi tidak terkirim di request berikutnya;
- response 200 tetapi JS tidak bisa membaca karena CORS;
- Set-Cookie ada di response tetapi tidak visible via `response.headers.get('set-cookie')`;
- preflight gagal sebelum POST;
- POST tidak pernah sampai server;
- redirect login diikuti browser tetapi hasilnya opaque/error bagi fetch.

---

## 5. Request Bukan Selalu Berarti Network

Kalimat “browser melakukan request” tidak selalu berarti paket keluar ke network.

Request bisa diselesaikan oleh:

```text
1. memory cache
2. disk HTTP cache
3. service worker
4. preloaded resource
5. back-forward cache interaction
6. browser internal response
7. network actual request
```

Contoh:

```js
await fetch('/config.json');
```

Kemungkinan outcome:

| Skenario | Network ke server? | Catatan |
|---|---:|---|
| Cache fresh | Tidak | Response dari browser HTTP cache |
| Cache stale + revalidate | Ya, kecil | Browser kirim conditional request, server bisa balas 304 |
| Service worker cache-first | Tidak | Response dari Cache API/service worker |
| Service worker network-first | Ya | Tetapi fallback bisa cache |
| DevTools disable cache aktif | Ya | Behavior berubah saat DevTools terbuka |
| `cache: 'no-store'` | Ya | Browser bypass sebagian caching semantics |

Implikasi penting:

> Tidak adanya log server tidak selalu berarti frontend tidak memanggil endpoint. Bisa jadi browser menyelesaikan request dari cache atau service worker.

Sebaliknya:

> Adanya request di DevTools tidak selalu berarti backend origin menerima request. Bisa jadi request berhenti di service worker, CDN, proxy, atau cache revalidation.

---

## 6. DevTools Network: Evidence, Bukan Kebenaran Absolut

Chrome DevTools Network panel sangat penting, tetapi harus dibaca sebagai evidence dengan konteks.

Network panel dapat membantu melihat:

- URL;
- method;
- status;
- protocol;
- request headers;
- response headers;
- payload;
- preview;
- initiator;
- timing;
- waterfall;
- priority;
- cache indicator;
- cookies;
- CORS-related symptoms;
- service worker involvement;
- redirect chain.

Namun DevTools juga punya jebakan:

1. **Disable cache** mengubah behavior.
2. Request bisa tampil 200 tetapi JS tidak bisa membaca response.
3. Header tertentu disembunyikan dari JavaScript walaupun tampil di DevTools.
4. Response dari cache bisa terlihat seperti request normal jika tidak hati-hati membaca Size/Status/Timing.
5. Extension browser bisa menambah/mengubah request.
6. Service worker bisa intercept request.
7. Preserve log off membuat redirect/navigation menghapus evidence lama.
8. Timing bisa berbeda karena throttling, cache, priority, atau connection reuse.
9. Network panel tidak selalu menunjukkan alasan kebijakan browser secara lengkap; console sering perlu dibaca bersamaan.

### 6.1 Cara Membaca Satu Request di DevTools

Saat melihat satu request, jangan mulai dari body. Mulai dari metadata.

Checklist:

```text
1. Apa initiator-nya?
2. Apakah request ini document, fetch, xhr, script, stylesheet, image, font, preflight, websocket, eventsource?
3. URL lengkapnya apa?
4. Origin halaman dan origin target sama atau berbeda?
5. Method apa?
6. Status code apa?
7. Ada redirect chain?
8. Request headers apa yang dikirim?
9. Response headers apa yang diterima?
10. Ada cookie yang dikirim?
11. Ada Set-Cookie yang diterima?
12. Apakah response from memory cache / disk cache / service worker?
13. Timing bottleneck di mana?
14. Apakah console menunjukkan CORS/CSP/mixed content error?
15. Apakah JS bisa membaca response atau hanya browser yang bisa melihatnya?
```

### 6.2 Cara Membaca Waterfall

Waterfall bukan hanya “lama atau cepat”. Ia menceritakan dependency graph.

Pertanyaan yang harus diajukan:

```text
1. Request mana yang memulai seluruh chain?
2. Request mana yang blocking rendering?
3. Request mana yang sequential padahal bisa parallel?
4. Request mana yang menunggu DNS/connect/TLS?
5. Request mana yang TTFB-nya besar?
6. Request mana yang download-nya besar?
7. Request mana yang low priority padahal critical?
8. Ada preflight sebelum API call?
9. Ada redirect chain yang tidak perlu?
10. Ada cache miss untuk asset fingerprinted?
11. Ada request duplicate?
12. Ada API waterfall karena komponen saling menunggu?
```

Contoh buruk:

```text
GET /                      200
GET /app.js                200
GET /api/me                200
GET /api/permissions       200
GET /api/menu              200
GET /api/dashboard         200
GET /api/dashboard/chart   200
```

Jika setiap request menunggu hasil sebelumnya, UI terasa lambat walaupun masing-masing endpoint cepat.

Dari perspektif backend, setiap API mungkin 80 ms.  
Dari perspektif user, total chain bisa 800 ms–2 detik.

---

## 7. Browser Request Types: Tidak Semua Sama

DevTools sering mengelompokkan request berdasarkan type.

Jenis request punya aturan berbeda.

| Type | Biasanya Dipicu Oleh | Bisa Dibaca JS? | Policy Penting |
|---|---|---:|---|
| document | navigation | tidak sebagai fetch response biasa | navigation, CSP, mixed content |
| fetch/xhr | JS API | ya, jika policy mengizinkan | CORS, credentials, cache mode |
| script | HTML/script loader | tidak sebagai body langsung | CORS/SRI/CSP/module rules |
| stylesheet | HTML/CSS | tidak sebagai body langsung | CSP, MIME, cache |
| image | HTML/CSS/JS | terbatas | CORS jika canvas/readback |
| font | CSS | tidak langsung | CORS sering relevan |
| preflight | browser otomatis OPTIONS | tidak | CORS |
| websocket | JS WebSocket | event-based | handshake, upgrade, origin |
| eventsource | EventSource/SSE | event-based | CORS, reconnect |
| ping/beacon | analytics/unload | tidak detail | keepalive/beacon limits |

Kesalahan umum adalah menganggap semua request setara dengan `fetch()`.

Contoh:

```html
<img src="https://cdn.example.com/photo.jpg">
```

Ini cross-origin request. Browser boleh menampilkan image dalam banyak kasus tanpa CORS. Tetapi jika JS mencoba membaca pixel via canvas, browser bisa memblokir karena canvas menjadi tainted.

Contoh lain:

```css
@font-face {
  font-family: MyFont;
  src: url('https://cdn.example.com/font.woff2');
}
```

Font cross-origin sering membutuhkan CORS header yang benar. Jadi image dan font punya behavior berbeda walaupun sama-sama GET.

---

## 8. Backend Mental Model vs Browser Mental Model

Sebagai Java engineer, Anda mungkin berpikir:

```java
@GetMapping("/profile")
public Profile getProfile() {
    return service.getProfile();
}
```

Dari backend:

```text
request masuk -> auth filter -> controller -> service -> response keluar
```

Dari browser:

```text
Can JS issue this request?
Is URL same-origin or cross-origin?
Will browser attach cookies?
Will this trigger preflight?
Will preflight include credentials?
Does server answer OPTIONS correctly?
Is response blocked by CORS?
Is response served from cache?
Is cached response stale?
Is service worker intercepting?
Is request cancelled because user navigated away?
Is response ignored because newer request completed first?
Is UI showing stale state?
```

Keduanya benar, tetapi melihat boundary berbeda.

### 8.1 Contoh: 401 Unauthorized

Backend melihat:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer
Content-Type: application/json

{"error":"token_expired"}
```

Frontend harus menjawab:

```text
Apakah ini request utama atau background refresh?
Apakah token refresh boleh dicoba?
Apakah request ini idempotent untuk retry?
Apakah ada banyak request paralel yang semua mendapat 401?
Apakah refresh token sedang berjalan?
Apakah UI harus redirect login?
Apakah harus preserve intended route?
Apakah harus clear local auth state?
Apakah 401 karena expired, revoked, malformed, atau missing credentials?
```

Satu status code bisa memicu state machine kompleks.

---

## 9. Core Invariants HTTP untuk Frontend

Bagian ini penting. Invariant adalah pegangan saat debugging.

### Invariant 1 — URL Menentukan Target Resource

URL bukan hanya string.

Ia menentukan:

- scheme;
- host;
- port;
- path;
- query;
- fragment;
- origin;
- site relationship;
- service worker scope;
- cache key;
- cookie applicability;
- CORS relationship.

Perubahan kecil bisa berdampak besar:

```text
http://localhost:3000
http://127.0.0.1:3000
https://localhost:3000
https://app.example.com
https://api.example.com
https://example.com/api
```

Bagi manusia, beberapa terlihat “sama”. Bagi browser, mereka bisa berbeda origin/site/security context.

### Invariant 2 — Method Menyatakan Intent, Bukan Sekadar Routing

`GET` semestinya read-only.  
`POST` biasanya non-idempotent mutation/process.  
`PUT` biasanya replace/upsert resource.  
`PATCH` partial modification.  
`DELETE` remove/deactivate resource.

Frontend perlu tahu ini untuk:

- retry;
- optimistic UI;
- duplicate submit prevention;
- caching;
- prefetching;
- browser behavior;
- API client design.

### Invariant 3 — Status Code Menyatakan Outcome Class

Status code bukan dekorasi.

Frontend seharusnya bisa membedakan:

```text
200: success with body
201: created
202: accepted but not done
204: success with no body
304: cached representation still valid
400: malformed/bad input
401: unauthenticated
403: authenticated but forbidden
404: absent/not visible
409: conflict
422: semantic validation failure
429: rate limited
500: server bug/failure
502/503/504: upstream/gateway/availability problem
```

Jika semua error dikirim sebagai 200 dengan `success: false`, UI, observability, retry, monitoring, dan gateway behavior menjadi lebih buruk.

### Invariant 4 — Header Adalah Control Plane

Header mengontrol:

- content type;
- cache;
- cookies;
- CORS;
- authentication;
- security policy;
- compression;
- content negotiation;
- tracing;
- rate limiting;
- retry instruction;
- redirects;
- conditional requests.

Body adalah data. Header adalah policy/metadata/control.

### Invariant 5 — Browser Boleh Memblokir walaupun HTTP Sukses

Server 200 bukan akhir cerita.

Browser masih bisa memblokir karena:

- CORS;
- CSP;
- mixed content;
- CORP/COEP/COOP;
- MIME type mismatch;
- SRI mismatch;
- cookie policy;
- redirect policy;
- download policy;
- insecure context;
- iframe sandbox;
- private network access policy;
- extension interference.

### Invariant 6 — JavaScript Tidak Melihat Semua yang Browser Lihat

DevTools bisa menampilkan hal yang tidak bisa diakses JS.

Contoh:

- `Set-Cookie` tidak bisa dibaca dengan `response.headers.get('set-cookie')` di browser JS.
- Beberapa response headers tidak exposed untuk cross-origin fetch kecuali server memakai `Access-Control-Expose-Headers`.
- Cookie HttpOnly tidak bisa dibaca via `document.cookie`.
- Cross-origin resource timing bisa dibatasi tanpa `Timing-Allow-Origin`.

### Invariant 7 — Cache adalah Bagian dari Correctness

Cache bukan hanya performance.

Cache bisa membuat:

- user melihat data lama;
- JS chunk lama dipakai setelah deploy;
- personalized data bocor jika salah `public`;
- API tidak terpanggil ke server;
- 304 dianggap error oleh client yang salah;
- service worker menyajikan app shell lama.

### Invariant 8 — User Experience Adalah Interpretasi dari Protocol Outcome

Protocol outcome harus diterjemahkan ke UX.

```text
401 -> login required? session expired? silent refresh?
403 -> show forbidden? hide feature? ask admin?
404 -> not found? not authorized? stale link?
409 -> conflict resolution? reload latest? merge?
429 -> retry after? disable button? show cooldown?
503 -> maintenance? retry? offline fallback?
```

Frontend top-tier bukan hanya memanggil API. Ia membuat failure dapat dimengerti manusia.

---

## 10. “Works in Postman” Taxonomy

Ketika API berhasil di Postman tetapi gagal di browser, kemungkinan besar perbedaannya ada di salah satu axis berikut.

### 10.1 Origin/CORS Axis

Postman tidak menerapkan CORS seperti browser.

Browser akan peduli:

```text
Origin: https://app.example.com
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Headers: content-type, authorization
Access-Control-Allow-Methods: GET, POST, OPTIONS
```

Jika salah, JavaScript tidak bisa membaca response atau request utama tidak dikirim.

### 10.2 Cookie/Credentials Axis

Postman bisa mengirim cookie/token secara eksplisit. Browser memakai aturan:

- cookie domain;
- path;
- Secure;
- HttpOnly;
- SameSite;
- third-party context;
- credentials mode;
- scheme;
- expiration.

### 10.3 Header Axis

Postman bisa mengirim header apa pun. Browser melarang beberapa header dikontrol JS dan menambahkan beberapa header sendiri.

### 10.4 Redirect Axis

Postman sering memperlihatkan redirect lebih eksplisit. Browser fetch punya redirect handling dan CORS interaction sendiri.

### 10.5 Cache Axis

Postman biasanya tidak merepresentasikan browser cache, service worker cache, atau resource cache seperti browser.

### 10.6 TLS/Secure Context Axis

Browser punya aturan secure context, mixed content, certificate trust, HSTS, dan blocked insecure request.

### 10.7 Content/MIME Axis

Browser bisa menolak script/style/module jika MIME type salah, walaupun HTTP status 200.

---

## 11. Minimal Vocabulary untuk Seri Ini

Kita akan memperdalam semua ini di part berikutnya, tetapi vocabulary awal perlu jelas.

### 11.1 Origin

Origin secara konseptual adalah kombinasi:

```text
scheme + host + port
```

Contoh:

```text
https://app.example.com:443
```

Berbeda dari:

```text
http://app.example.com:80
https://api.example.com:443
https://app.example.com:8443
```

Origin adalah fondasi same-origin policy dan CORS.

### 11.2 Site

Site biasanya berkaitan dengan registrable domain/eTLD+1 dan schemeful same-site behavior.

Contoh:

```text
https://app.example.com
https://api.example.com
```

Mereka cross-origin tetapi bisa same-site.

Ini penting untuk cookies `SameSite`.

### 11.3 Fetch

Fetch adalah model standar browser untuk mengambil resource. `window.fetch()` adalah API JavaScript yang memakai model itu, tetapi browser juga memakai konsep fetching untuk banyak resource lain.

### 11.4 Request Mode

Mode memengaruhi policy:

```text
cors
same-origin
no-cors
navigate
websocket
```

Sebagian mode tidak bisa dipilih sembarangan oleh aplikasi.

### 11.5 Credentials Mode

Menentukan apakah browser menyertakan credentials seperti cookies/client cert/auth info:

```text
omit
same-origin
include
```

Ini sangat penting untuk auth berbasis cookie.

### 11.6 CORS

CORS adalah mekanisme browser + server headers untuk memperbolehkan JavaScript membaca response cross-origin dalam kondisi tertentu.

CORS bukan authentication dan bukan server-side firewall.

### 11.7 Preflight

Preflight adalah request `OPTIONS` otomatis dari browser sebelum request cross-origin tertentu.

Tujuannya bertanya:

> Server, apakah origin ini boleh mengirim method/header seperti ini?

### 11.8 Simple Request

Istilah CORS untuk request yang tidak memerlukan preflight jika memenuhi constraint tertentu pada method/header/content-type.

### 11.9 HTTP Cache

Cache built-in browser berdasarkan HTTP caching semantics.

Berbeda dari:

- application state cache;
- React Query cache;
- Redux store;
- service worker Cache API;
- CDN cache.

### 11.10 Service Worker

Script khusus yang bisa bertindak sebagai programmable proxy antara page dan network untuk scope tertentu.

### 11.11 Navigation Request

Request dokumen utama saat user membuka halaman atau browser pindah URL.

Ini berbeda dari fetch/XHR request.

### 11.12 Subresource Request

Request untuk resource pendukung seperti JS, CSS, image, font, media.

### 11.13 Representation

Data yang dikirim sebagai representasi state resource pada saat tertentu, misalnya JSON, HTML, image, atau binary.

Resource bukan body. Body adalah representasi dari resource.

---

## 12. Cara Berpikir Saat Debugging HTTP Browser

Gunakan urutan ini.

### Step 1 — Klasifikasikan Request

Tanya:

```text
Ini request apa?
- navigation?
- fetch/xhr?
- script?
- stylesheet?
- image?
- font?
- preflight?
- websocket?
- eventsource?
- beacon?
```

Kenapa? Karena aturan browser berbeda.

### Step 2 — Tentukan Relationship Origin/Site

Tanya:

```text
Page origin apa?
Target origin apa?
Same-origin atau cross-origin?
Same-site atau cross-site?
HTTP atau HTTPS?
Localhost atau IP?
Subdomain atau path-based?
```

### Step 3 — Periksa Intent HTTP

Tanya:

```text
Method apa?
Request body ada?
Content-Type apa?
Custom headers apa?
Credentials dipakai?
```

Ini menentukan CORS, cacheability, retryability, dan UI behavior.

### Step 4 — Periksa Browser Policy

Tanya:

```text
Ada CORS?
Ada CSP?
Ada mixed content?
Ada cookie SameSite issue?
Ada service worker?
Ada redirect cross-origin?
Ada MIME mismatch?
```

### Step 5 — Periksa Cache/Interception

Tanya:

```text
From memory cache?
From disk cache?
From service worker?
304?
CDN cache hit?
DevTools disable cache aktif?
```

### Step 6 — Periksa Server Outcome

Tanya:

```text
Status code apa?
Response headers apa?
Body apa?
Apakah error contract valid?
Apakah server logs menerima request?
Apakah gateway/CDN logs menerima request?
```

### Step 7 — Periksa UI State Consequence

Tanya:

```text
Apakah response terbaru atau stale?
Apakah request lama mengalahkan request baru?
Apakah request dibatalkan?
Apakah error dipetakan benar?
Apakah retry aman?
Apakah user diberi feedback yang tepat?
```

---

## 13. Contoh Diagnosis End-to-End

### Kasus: Login Sukses di Network Tab, Tetapi User Tetap Belum Login

Gejala:

```text
POST /login -> 200 OK
Response body: {"ok": true}
Set-Cookie terlihat di response headers
Namun GET /me setelah itu tetap 401
```

Engineer pemula mungkin berkata:

> Frontend state management bug.

Engineer lebih kuat bertanya:

```text
1. Apakah request login cross-origin?
2. Apakah fetch memakai credentials: 'include'?
3. Apakah response CORS menyertakan Access-Control-Allow-Credentials: true?
4. Apakah Access-Control-Allow-Origin bukan wildcard?
5. Apakah Set-Cookie memakai Secure tetapi halaman masih http?
6. Apakah SameSite=None disertai Secure?
7. Apakah Domain cookie cocok dengan API/app topology?
8. Apakah cookie Path cocok?
9. Apakah cookie blocked di Application/Cookies panel?
10. Apakah GET /me memakai credentials: 'include' juga?
11. Apakah third-party cookie diblokir browser?
12. Apakah redirect login mengubah origin/site?
```

Kemungkinan root cause:

```text
fetch('/login') memakai credentials: 'include', tetapi fetch('/me') tidak.
```

Atau:

```text
Set-Cookie: session=...; SameSite=None
```

tetapi tanpa:

```text
Secure
```

Atau:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

kombinasi yang tidak valid untuk credentialed CORS.

Poin penting:

> Network tab “200 OK” tidak cukup. Login adalah koordinasi HTTP status, CORS, credentials mode, cookie policy, storage, dan request berikutnya.

---

## 14. Contoh Diagnosis: API Lambat Padahal Backend Cepat

Gejala:

```text
Backend log menunjukkan setiap endpoint 50-100 ms.
User melihat dashboard load 2.5 detik.
```

Network waterfall:

```text
GET /api/me                   90 ms
  -> GET /api/permissions     80 ms
      -> GET /api/menu        70 ms
          -> GET /api/stats   100 ms
              -> GET /api/chart?type=A 120 ms
              -> GET /api/chart?type=B 110 ms
```

Masalah bukan satu endpoint lambat. Masalahnya dependency chain.

Solusi mungkin:

- parallelize request;
- combine screen-critical data;
- introduce BFF endpoint;
- preload after login;
- cache stable data;
- defer non-critical panels;
- use skeleton UI;
- remove unnecessary preflight;
- reduce redirect;
- improve TTFB via CDN/edge.

Mental model:

> Latency frontend adalah graph problem, bukan hanya endpoint latency problem.

---

## 15. Frontend HTTP adalah State Machine, Bukan Utility Function

Banyak codebase membuat wrapper seperti ini:

```js
export function apiGet(path) {
  return fetch(API_BASE + path).then(r => r.json());
}
```

Ini terlalu miskin untuk sistem nyata.

HTTP client layer yang matang perlu memodelkan:

```text
Request lifecycle:
idle -> pending -> success
              \-> http_error
              \-> network_error
              \-> timeout
              \-> aborted
              \-> auth_refreshing
              \-> retrying
              \-> conflict
              \-> rate_limited
              \-> offline
```

Dan setiap transition punya konsekuensi:

- update UI;
- show validation;
- retry;
- cancel;
- ignore stale response;
- refresh token;
- redirect login;
- log telemetry;
- correlate trace;
- preserve user input;
- rollback optimistic update.

### 15.1 Minimal HTTP Result Model

Daripada hanya return data, model yang lebih eksplisit:

```ts
type HttpResult<T> =
  | {
      type: 'success';
      status: number;
      data: T;
      headers: Headers;
    }
  | {
      type: 'http-error';
      status: number;
      error: unknown;
      headers: Headers;
      retryable: boolean;
    }
  | {
      type: 'network-error';
      error: Error;
      retryable: boolean;
    }
  | {
      type: 'timeout';
      timeoutMs: number;
      retryable: boolean;
    }
  | {
      type: 'aborted';
      reason?: unknown;
    };
```

Tujuannya bukan supaya semua aplikasi pakai tipe ini persis, tetapi supaya Anda berpikir:

> Tidak semua failure sama. Tidak semua failure harus ditampilkan sama. Tidak semua failure aman di-retry.

---

## 16. Boundary dengan Backend: Kontrak yang Perlu Disepakati

Frontend dan backend perlu kontrak yang lebih kaya daripada “endpoint dan JSON”.

Untuk setiap endpoint penting, sepakati:

```text
1. URL dan method
2. Auth mechanism
3. Credential behavior
4. CORS behavior jika cross-origin
5. Request content type
6. Response content type
7. Success status codes
8. Error status codes
9. Error body format
10. Cache-Control
11. ETag/Last-Modified jika relevan
12. Idempotency behavior
13. Retryability
14. Rate limit headers
15. Correlation/trace headers
16. Redirect behavior
17. Pagination/filtering/sorting semantics
18. Partial failure semantics
19. Backward compatibility rules
20. Observability expectations
```

Contoh kontrak lemah:

```text
POST /submit returns JSON
```

Contoh kontrak lebih kuat:

```text
POST /applications/{id}/submit
- Requires authenticated session cookie.
- Browser client must send credentials.
- Cross-origin allowed only from https://app.example.com.
- Request: application/json.
- Success:
  - 202 Accepted if submission workflow started.
  - Body contains operationId and statusUrl.
- Error:
  - 400 malformed JSON.
  - 401 unauthenticated.
  - 403 not allowed to submit this application.
  - 409 application state conflict.
  - 422 validation errors with field-level details.
  - 429 rate limited with Retry-After.
- Mutation is idempotent if Idempotency-Key is provided.
- Response has Cache-Control: no-store.
- Response includes X-Request-ID.
```

Ini jauh lebih usable untuk frontend, QA, SRE, dan support.

---

## 17. Apa yang Harus Anda Abaikan Sementara

Untuk belajar efisien, jangan masuk terlalu dalam dulu ke:

- detail binary framing HTTP/2;
- QUIC packet internals;
- TLS cipher suite detail;
- browser engine implementation source code;
- CDN vendor-specific tuning;
- framework-specific wrappers;
- React/Vue-specific data fetching library;
- OAuth/OIDC full depth;
- WebTransport internals;
- service worker offline architecture detail.

Semua itu penting, tetapi bukan pondasi pertama.

Urutan yang lebih sehat:

```text
1. HTTP semantics
2. URL/origin/site
3. browser request model
4. fetch behavior
5. CORS/cookies/cache
6. security headers
7. performance/reliability
8. architecture/testing/operations
```

---

## 18. Practical Lab Setup untuk Seri Ini

Untuk belajar serius, siapkan mini-lab.

### 18.1 Minimal Topology

```text
Frontend dev server:
http://localhost:5173

Backend API:
http://localhost:8080

Alternative API domain via hosts file:
http://api.local.test:8080

HTTPS local optional:
https://app.local.test
https://api.local.test
```

Kenapa perlu beberapa host?

Karena banyak konsep tidak muncul jika semua same-origin.

Kita butuh mencoba:

- same-origin;
- cross-origin same-site-ish local simulation;
- cross-origin cross-site-ish simulation;
- HTTP vs HTTPS;
- localhost vs 127.0.0.1;
- cookie Domain/Path/SameSite;
- CORS preflight;
- redirect;
- cache;
- service worker.

### 18.2 Backend Minimal

Bisa pakai Spring Boot, Node, Go, atau apa pun. Karena context Anda Java engineer, contoh backend konseptual bisa menggunakan Spring Boot.

Endpoint yang berguna:

```text
GET  /api/hello
GET  /api/me
POST /api/login
POST /api/logout
GET  /api/cache/public
GET  /api/cache/private
GET  /api/cache/etag
POST /api/mutate
PATCH /api/resource/{id}
GET  /api/slow?ms=1000
GET  /api/error/{status}
GET  /api/redirect/{type}
OPTIONS /*
```

### 18.3 Frontend Minimal

Buat halaman dengan tombol:

```text
- same-origin fetch
- cross-origin fetch
- fetch with credentials
- fetch without credentials
- custom header fetch
- JSON POST
- form POST
- image load
- font load
- script load
- cached request
- aborted request
- slow request
- redirect request
```

Tujuannya bukan UI indah. Tujuannya membuat HTTP behavior terlihat.

### 18.4 Browser Tools

Gunakan minimal:

- Chrome DevTools Network;
- Chrome DevTools Application tab;
- Console;
- Performance panel untuk waterfall lanjut;
- `curl` sebagai pembanding non-browser;
- server logs;
- gateway/proxy logs jika ada.

---

## 19. Cara Menggunakan `curl` Tanpa Menipu Diri Sendiri

`curl` sangat berguna, tetapi tidak meniru browser sepenuhnya.

Contoh:

```bash
curl -i https://api.example.com/me
```

Ini tidak otomatis membuktikan browser bisa fetch endpoint tersebut.

Untuk mendekati browser, Anda perlu meniru sebagian header:

```bash
curl -i 'https://api.example.com/me' \
  -H 'Origin: https://app.example.com' \
  -H 'Accept: application/json'
```

Untuk preflight:

```bash
curl -i -X OPTIONS 'https://api.example.com/me' \
  -H 'Origin: https://app.example.com' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization, content-type'
```

Untuk cookie:

```bash
curl -i 'https://api.example.com/me' \
  -H 'Origin: https://app.example.com' \
  -H 'Cookie: session=abc123'
```

Tetapi tetap ingat:

- `curl` tidak menerapkan CORS;
- `curl` tidak menerapkan SameSite seperti browser;
- `curl` tidak punya browser cookie jar policy yang sama;
- `curl` tidak punya CSP;
- `curl` tidak punya mixed content blocking;
- `curl` tidak punya service worker;
- `curl` tidak punya resource priority;
- `curl` tidak punya JS visibility restriction.

Jadi `curl` adalah alat untuk memeriksa server response, bukan bukti final browser behavior.

---

## 20. Anti-Patterns Awal yang Harus Dihindari

### Anti-Pattern 1 — Treating CORS as Backend Auth

Salah:

```text
Kita aman karena CORS hanya allow domain kita.
```

Lebih benar:

```text
CORS membatasi browser script dari origin lain untuk membaca response. CORS bukan mekanisme authentication server-to-server dan bukan pengganti authorization.
```

### Anti-Pattern 2 — Wildcard CORS untuk Semua Environment

Salah:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Untuk credentialed browser request, ini bermasalah. Production CORS harus eksplisit dan intentional.

### Anti-Pattern 3 — Semua Error Jadi 200

Salah:

```http
HTTP/1.1 200 OK

{"success":false,"error":"unauthorized"}
```

Lebih sehat:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/problem+json

{"type":"...","title":"Unauthorized","detail":"Session expired"}
```

### Anti-Pattern 4 — API Client Tanpa Timeout/Cancellation

Salah:

```js
const data = await fetch('/api/search?q=' + q).then(r => r.json());
```

Masalah:

- user mengetik cepat;
- request lama bisa selesai setelah request baru;
- response stale bisa overwrite UI;
- route berubah tetapi request tetap berjalan;
- tidak ada timeout;
- abort tidak dimodelkan.

### Anti-Pattern 5 — Cache Header Tidak Disengaja

Salah:

```text
Biarkan default aja.
```

Cache default antar browser/proxy/CDN bisa mengejutkan. Untuk endpoint penting, cache policy harus eksplisit.

### Anti-Pattern 6 — Menganggap DevTools 200 Berarti Aplikasi Bisa Membaca

Salah:

```text
Di Network tab 200, harusnya bisa.
```

Lebih benar:

```text
Network tab menunjukkan browser menerima response. JS visibility masih ditentukan CORS, response type, exposed headers, dan policy lain.
```

### Anti-Pattern 7 — Menyamakan App Cache dengan HTTP Cache

React Query cache, Redux store, service worker cache, browser HTTP cache, dan CDN cache adalah layer berbeda.

Jangan menyebut semuanya “cache” tanpa menyebut layer.

---

## 21. Decision Framework Awal

Saat mendesain request dari frontend, gunakan pertanyaan ini.

### 21.1 Request Identity

```text
Apa resource targetnya?
Apa URL finalnya?
Apakah URL environment-dependent?
Apakah path/query stabil?
```

### 21.2 Request Intent

```text
Apakah read atau mutation?
Apakah safe?
Apakah idempotent?
Apakah boleh retry?
Apakah boleh prefetch?
```

### 21.3 Browser Relationship

```text
Same-origin atau cross-origin?
Same-site atau cross-site?
Butuh credentials?
Akan trigger preflight?
Ada cookie?
```

### 21.4 Response Contract

```text
Success status apa?
Error status apa?
Body selalu JSON atau bisa kosong?
Content-Type benar?
Header apa yang harus dibaca frontend?
Perlu Access-Control-Expose-Headers?
```

### 21.5 Cache Contract

```text
Boleh cache?
Private atau public?
Berapa lama?
Butuh revalidation?
Ada ETag?
Apakah response personalized?
```

### 21.6 Security Contract

```text
Apakah endpoint sensitif?
Apakah response bisa embedded?
Apakah CSP connect-src mengizinkan?
Apakah mixed content mungkin?
Apakah token/cookie bocor via URL/referrer?
```

### 21.7 UX Contract

```text
Apa yang user lihat saat pending?
Apa yang user lihat saat timeout?
Apa yang user lihat saat unauthorized?
Apa yang user lihat saat conflict?
Apa yang user lihat saat retry?
Apakah input user aman?
```

### 21.8 Observability Contract

```text
Ada request ID?
Ada traceparent?
Ada Server-Timing?
Frontend log menyimpan status/method/path/latency?
PII aman?
Error bisa dikorelasikan dengan backend logs?
```

---

## 22. Mini Exercise

Buka aplikasi web apa pun yang cukup kompleks, lalu buka DevTools Network.

Lakukan observasi:

```text
1. Reload halaman dengan Preserve log ON.
2. Catat request document utama.
3. Catat semua JS/CSS/image/font request.
4. Cari request API pertama.
5. Cari preflight OPTIONS jika ada.
6. Cari request yang served from cache.
7. Cari request yang redirect.
8. Cari request paling lama.
9. Cari request dengan status 4xx/5xx.
10. Klik satu API request dan baca request/response headers.
```

Jawab:

```text
- Request mana yang user-critical?
- Request mana yang render-critical?
- Request mana yang bisa ditunda?
- Request mana yang bisa di-cache?
- Request mana yang tidak boleh di-cache?
- Apakah ada API waterfall?
- Apakah ada header security?
- Apakah ada CORS?
- Apakah cookies dikirim?
- Apakah ada correlation ID?
```

Tujuan exercise ini bukan optimasi langsung. Tujuannya melatih mata.

---

## 23. Ringkasan Part 001

Inti Part 001:

1. Browser adalah HTTP client yang sangat kompleks, bukan sekadar runtime JavaScript.
2. Request browser bisa dipicu HTML, CSS, JS, parser, preload scanner, service worker, iframe, analytics, dan navigation.
3. HTTP protocol, browser policy, dan JavaScript API behavior harus dibedakan.
4. `fetch()` tidak reject hanya karena HTTP status 404/500.
5. Response 200 dari server belum tentu bisa dibaca JavaScript.
6. Request tidak selalu menyentuh network karena cache/service worker.
7. DevTools Network adalah evidence penting, tetapi harus dibaca dengan konteks.
8. Postman/curl sukses tidak membuktikan browser sukses.
9. Header adalah control plane HTTP.
10. Frontend HTTP engineering adalah kombinasi protocol semantics, browser policy, UX state machine, performance, security, dan observability.

---

## 24. Referensi Utama

- RFC 9110 — HTTP Semantics. RFC 9110 mendefinisikan semantics HTTP, termasuk metode, status code, fields, dan representation model modern.
- RFC 9111 — HTTP Caching. RFC 9111 mendefinisikan cache behavior dan header fields yang mengontrol caching.
- WHATWG Fetch Standard. Fetch Standard mendefinisikan requests, responses, dan proses fetching yang mengikat banyak fitur web platform.
- MDN Web Docs — Fetch API, CORS, HTTP headers, status codes, caching, cookies.
- Chrome DevTools Documentation — Network panel, request inspection, timing, cache, initiator, waterfall.

---

## 25. Bridge ke Part 002

Part ini membangun orientasi besar. Part berikutnya akan masuk ke fondasi yang paling sering menyebabkan bug frontend HTTP:

```text
URL, Origin, Site, Scheme, Host, Port, Path, Query, Fragment
```

Kenapa ini penting?

Karena sebelum memahami CORS, cookies, SameSite, service worker scope, cache key, redirect, atau security policy, Anda harus bisa menjawab dengan presisi:

```text
Halaman saya berasal dari origin apa?
Request saya menuju origin apa?
Apakah keduanya same-origin?
Apakah keduanya same-site?
Apakah scheme/host/port berubah?
Apakah browser menganggap ini secure context?
```

Tanpa fondasi ini, debugging CORS/cookie/cache akan terasa seperti trial-and-error.

---

# Status Seri

```text
Part 001 selesai.
Seri belum selesai.
Lanjut ke Part 002: URL, Origin, Site, Scheme, Host, Port, Path, Query, Fragment.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-000.md">⬅️ Part 000 — Fondasi Seri: Cara Berpikir HTTP dari Perspektif Web/Frontend</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-002.md">Part 002 — URL, Origin, Site, Scheme, Host, Port, Path, Query, Fragment ➡️</a>
</div>

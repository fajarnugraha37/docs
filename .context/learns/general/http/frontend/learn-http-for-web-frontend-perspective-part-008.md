# learn-http-for-web-frontend-perspective-part-008.md

# Part 008 — Fetch API Mental Model: What `fetch()` Actually Does

> Seri: `learn-http-for-web-frontend-perspective`  
> Target pembaca: Java software engineer yang ingin memahami HTTP dari perspektif browser/frontend secara mendalam.  
> Posisi dalam seri: setelah kita memahami URL, origin/site, HTTP message model, methods, status codes, headers, body/media type/encoding, sekarang kita masuk ke API utama browser modern untuk membuat request dari JavaScript: `fetch()`.

---

## 0. Tujuan Part Ini

Di banyak codebase frontend, `fetch()` terlihat sederhana:

```js
const response = await fetch('/api/users');
const users = await response.json();
```

Namun mental model seperti itu terlalu tipis untuk production system. `fetch()` bukan sekadar “HTTP client JavaScript”. Ia adalah entry point ke **browser fetching architecture**: sistem yang menggabungkan HTTP semantics, CORS, redirects, credentials, cache, referrer policy, service worker, streaming body, abort signal, security constraints, dan lifecycle browser.

Tujuan bagian ini adalah membangun pemahaman bahwa:

1. `fetch()` tidak identik dengan HTTP request mentah.
2. `fetch()` berjalan di atas policy browser.
3. Promise dari `fetch()` merepresentasikan keberhasilan level network/fetching, bukan keberhasilan business request.
4. `Response` body adalah stream yang hanya bisa dikonsumsi sekali kecuali di-clone.
5. Banyak opsi `fetch()` mengubah perilaku request secara signifikan: `mode`, `credentials`, `cache`, `redirect`, `signal`, `keepalive`, `headers`, `body`.
6. HTTP error seperti 404/500 bukan JavaScript exception.
7. CORS failure, DNS failure, TLS failure, offline, abort, dan blocked request biasanya muncul sebagai failure berbeda dari HTTP response.
8. Client HTTP layer yang baik harus membedakan transport, protocol, parsing, dan domain failure.

---

## 1. Posisi `fetch()` dalam Arsitektur Browser

Secara konseptual, ketika Anda memanggil:

```js
await fetch('https://api.example.com/orders');
```

Anda tidak langsung “membuka socket lalu mengirim HTTP request”. Browser melewati beberapa layer:

```text
Application JavaScript
        |
        v
Fetch API surface
        |
        v
Fetch algorithm / browser policy engine
        |
        +--> URL parsing and normalization
        +--> origin / same-origin / same-site classification
        +--> CORS decision
        +--> credentials decision
        +--> referrer policy decision
        +--> service worker interception
        +--> HTTP cache lookup / revalidation
        +--> redirect handling
        +--> mixed-content / secure-context checks
        +--> CSP / connect-src checks
        +--> network stack
        +--> proxy / DNS / TCP / TLS / HTTP/2 / HTTP/3
        |
        v
Response object exposed to JavaScript, if allowed
```

Dari sudut backend engineer, request adalah request. Dari sudut browser, request adalah hasil dari banyak keputusan policy.

Itulah sebabnya masalah seperti ini sering terjadi:

```text
"API berhasil di Postman, tapi gagal di browser."
```

Postman bukan browser. Postman tidak menerapkan Same-Origin Policy seperti browser. Postman tidak melakukan CORS enforcement seperti browser. Postman tidak punya cookie jar browser dengan SameSite semantics yang sama. Postman tidak menjalankan CSP, service worker, mixed content blocking, atau browser credential policy.

Mental model pertama:

```text
fetch() = request intent dari JavaScript + browser policy + network execution + exposure rules.
```

Bukan:

```text
fetch() = kirim HTTP request mentah.
```

---

## 2. Fetch API vs Fetch Standard

Ada dua hal yang perlu dibedakan:

1. **Fetch API**: interface JavaScript yang Anda pakai (`fetch`, `Request`, `Response`, `Headers`, `AbortController`).
2. **Fetch Standard**: spesifikasi browser yang mendefinisikan algoritma fetching untuk banyak resource, bukan hanya panggilan JavaScript.

Artinya, konsep fetch tidak hanya dipakai oleh:

```js
fetch('/api/data')
```

Tetapi juga oleh mekanisme browser lain, misalnya:

```html
<img src="/hero.png">
<script src="/app.js"></script>
<link rel="stylesheet" href="/style.css">
<link rel="preload" href="/font.woff2" as="font">
```

Banyak resource browser melewati model fetching yang sama atau sangat terkait. Ini menjelaskan kenapa pembahasan CORS, cache, credentials, redirect, referrer, dan security headers tidak bisa dipisahkan dari `fetch()`.

---

## 3. Minimal `fetch()` Call dan Apa yang Sebenarnya Terjadi

Contoh paling sederhana:

```js
const response = await fetch('/api/users');
```

Browser akan membuat request dengan kira-kira karakteristik berikut:

```text
URL: resolved relative to current document URL
Method: GET
Body: none
Mode: cors or same-origin depending context and request
Credentials: same-origin by default
Redirect: follow by default
Cache: default
Referrer: determined by referrer policy
Headers: browser-controlled defaults + user-provided allowed headers
```

Poin penting: banyak nilai tidak terlihat di kode, tetapi tetap ada.

`fetch('/api/users')` tidak berarti request kosong. Browser masih bisa mengirim header seperti:

```http
Accept: */*
Accept-Language: ...
Accept-Encoding: gzip, deflate, br, zstd
User-Agent: ...
Sec-Fetch-Site: same-origin
Sec-Fetch-Mode: cors
Sec-Fetch-Dest: empty
Referer: ...
Cookie: ... maybe
```

Beberapa header dikontrol browser dan tidak boleh diset manual oleh JavaScript.

---

## 4. The Core Objects: `fetch`, `Request`, `Response`, `Headers`

### 4.1 `fetch(input, init)`

Signature praktis:

```js
fetch(input, init)
```

`input` bisa berupa:

```js
fetch('/api/users')
fetch(new Request('/api/users'))
```

`init` adalah configuration object:

```js
fetch('/api/users', {
  method: 'GET',
  headers: {
    'Accept': 'application/json'
  },
  credentials: 'include',
  mode: 'cors',
  cache: 'no-store',
  redirect: 'follow',
  signal: abortController.signal
});
```

### 4.2 `Request`

`Request` merepresentasikan request intent yang sudah distandardisasi:

```js
const request = new Request('/api/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ itemId: 'A-001', quantity: 2 })
});

const response = await fetch(request);
```

`Request` berguna untuk:

- membuat abstraction layer;
- clone request;
- dipakai dalam service worker;
- menyimpan opsi request secara eksplisit;
- membangun wrapper HTTP yang lebih predictable.

### 4.3 `Response`

`Response` bukan body langsung. Ia adalah object yang berisi:

```text
status
statusText
ok
headers
url
redirected
type
body
bodyUsed
methods to consume body
```

Contoh:

```js
const response = await fetch('/api/users');

console.log(response.status);   // 200, 404, 500, etc.
console.log(response.ok);       // true for 200-299
console.log(response.headers);  // Headers object
```

### 4.4 `Headers`

`Headers` adalah struktur khusus, bukan plain object biasa:

```js
const headers = new Headers();
headers.set('Accept', 'application/json');
headers.set('X-Request-Id', crypto.randomUUID());

const response = await fetch('/api/users', { headers });
```

Namun tidak semua header boleh diset. Browser melarang beberapa header karena alasan security, correctness, dan kontrol protocol.

---

## 5. Kesalahan Mental Model Paling Umum: `fetch()` Tidak Reject untuk HTTP Error

Ini bagian yang harus tertanam kuat.

Kode berikut:

```js
try {
  const response = await fetch('/api/users/does-not-exist');
  console.log('success');
} catch (error) {
  console.log('failed');
}
```

Jika server mengembalikan:

```http
HTTP/1.1 404 Not Found
Content-Type: application/json

{ "error": "USER_NOT_FOUND" }
```

Maka `fetch()` biasanya **resolve**, bukan reject.

Kenapa?

Karena dari sudut Fetch API, request berhasil dilakukan dan response berhasil diterima. HTTP status `404` adalah response valid. Itu bukan network failure.

Yang membuat Promise reject adalah hal seperti:

```text
- DNS failure
- TLS failure
- connection failure
- CORS blocked response
- request aborted
- browser policy blocked request
- malformed URL in some cases
- network interrupted before response available
```

Bukan:

```text
- 400 Bad Request
- 401 Unauthorized
- 403 Forbidden
- 404 Not Found
- 409 Conflict
- 422 Unprocessable Content
- 429 Too Many Requests
- 500 Internal Server Error
- 503 Service Unavailable
```

Maka wrapper HTTP yang benar harus eksplisit:

```js
async function getJson(url, init) {
  const response = await fetch(url, init);

  if (!response.ok) {
    const errorBody = await safeReadJson(response);
    throw new HttpError({
      status: response.status,
      statusText: response.statusText,
      body: errorBody,
      headers: response.headers,
      url: response.url
    });
  }

  return response.json();
}
```

Mental model:

```text
Promise rejection = fetch/network/policy-level failure.
HTTP non-2xx = protocol-level outcome, still a response.
Domain error = application-level outcome inside a response body.
```

---

## 6. Failure Taxonomy: Jangan Campur Semua Error

Frontend yang matang tidak menyebut semua error sebagai “API failed”. Ia membedakan layer.

### 6.1 Fetch/Network/Policy Failure

Contoh:

```js
try {
  await fetch('https://api.example.com/orders');
} catch (e) {
  // Could be network failure, CORS failure, abort, etc.
}
```

Ciri:

- tidak ada usable `Response` object;
- tidak ada status code HTTP yang bisa dibaca;
- sering muncul sebagai `TypeError: Failed to fetch` di browser;
- bisa disebabkan oleh CORS, DNS, TLS, offline, mixed content, CSP, atau blocked request.

### 6.2 HTTP Error Response

Contoh:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{ "code": "SESSION_EXPIRED" }
```

Ciri:

- ada `Response` object;
- ada status code;
- body mungkin bisa dibaca;
- frontend bisa membuat keputusan berdasarkan status/body.

### 6.3 Body Parsing Failure

Contoh:

```js
const response = await fetch('/api/users');
const data = await response.json();
```

Jika body kosong, HTML error page, atau JSON invalid, maka `.json()` bisa throw.

Ini bukan network failure dan bukan HTTP failure. Ini **representation parsing failure**.

### 6.4 Domain Failure

Contoh:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "eligible": false,
  "reason": "LIMIT_REACHED"
}
```

Atau:

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "code": "VERSION_CONFLICT",
  "message": "The record was updated by another user."
}
```

Domain failure harus dibedakan dari protocol failure.

### 6.5 Recommended Error Model

Gunakan kategori seperti:

```ts
type ClientFailure =
  | { kind: 'network'; cause: unknown }
  | { kind: 'aborted'; cause: unknown }
  | { kind: 'http'; status: number; body: unknown; headers: Headers }
  | { kind: 'parse'; status: number; cause: unknown; rawText?: string }
  | { kind: 'domain'; code: string; details?: unknown };
```

Ini membuat UI jauh lebih bisa dikendalikan.

---

## 7. `response.ok`, `status`, dan Status Code Handling

`response.ok` bernilai true jika status berada dalam range 200–299.

```js
const response = await fetch('/api/orders');

if (!response.ok) {
  throw new Error(`HTTP ${response.status}`);
}
```

Namun untuk production, jangan hanya throw generic error. Anda biasanya butuh membaca body error.

```js
async function readError(response) {
  const contentType = response.headers.get('Content-Type') || '';

  if (contentType.includes('application/json')) {
    return await response.json();
  }

  return await response.text();
}
```

Tapi hati-hati: body hanya bisa dibaca sekali.

---

## 8. Body Stream: Response Body Bukan String Biasa

`Response` body adalah stream. Method berikut mengonsumsi stream:

```js
await response.json();
await response.text();
await response.blob();
await response.arrayBuffer();
await response.formData();
```

Setelah salah satu dipanggil, body dianggap sudah digunakan.

Contoh bug:

```js
const response = await fetch('/api/users');

console.log(await response.text());
const data = await response.json(); // error: body already used
```

Karena body sudah dibaca oleh `.text()`.

Anda bisa cek:

```js
console.log(response.bodyUsed);
```

Jika perlu membaca dua kali, gunakan `clone()` sebelum body dikonsumsi:

```js
const response = await fetch('/api/users');
const copy = response.clone();

console.log(await copy.text());
const data = await response.json();
```

Namun clone bukan solusi gratis untuk body besar. Untuk payload besar, membaca dua kali berarti overhead memori/streaming yang perlu dipertimbangkan.

Mental model:

```text
Response body is a consumable stream, not a reusable buffer.
```

---

## 9. Parsing JSON dengan Benar

Naif:

```js
const response = await fetch('/api/users');
return response.json();
```

Masalah:

1. Tidak cek `response.ok`.
2. Tidak cek `Content-Type`.
3. Gagal untuk 204 No Content.
4. Gagal jika backend mengirim HTML error page.
5. Gagal jika body kosong.
6. Gagal jika JSON invalid.
7. Tidak membedakan HTTP error dan parse error.

Wrapper lebih defensif:

```js
async function parseJsonResponse(response) {
  if (response.status === 204 || response.status === 205) {
    return null;
  }

  const contentType = response.headers.get('Content-Type') || '';

  if (!contentType.toLowerCase().includes('application/json')) {
    const text = await response.text();
    throw new Error(`Expected JSON but got ${contentType}: ${text.slice(0, 200)}`);
  }

  return response.json();
}
```

Namun dalam real code, jangan selalu menyertakan raw body ke error/log karena bisa mengandung PII.

---

## 10. Request Body: Kapan Browser Menentukan Header, Kapan Anda Menentukan

### 10.1 JSON Body

Untuk JSON:

```js
await fetch('/api/orders', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  body: JSON.stringify({ itemId: 'A-001', quantity: 2 })
});
```

Di sini Anda harus set `Content-Type: application/json` jika server perlu tahu cara membaca body.

### 10.2 FormData

Untuk `FormData`, jangan set `Content-Type` manual:

```js
const formData = new FormData();
formData.append('file', file);
formData.append('description', 'Invoice');

await fetch('/api/upload', {
  method: 'POST',
  body: formData
});
```

Browser akan membuat header seperti:

```http
Content-Type: multipart/form-data; boundary=----...
```

Jika Anda set manual:

```js
headers: { 'Content-Type': 'multipart/form-data' }
```

Anda bisa merusak boundary, dan server gagal parsing.

### 10.3 URLSearchParams

```js
const body = new URLSearchParams();
body.set('username', 'alice');
body.set('password', 'secret');

await fetch('/login', {
  method: 'POST',
  body
});
```

Browser bisa menyetel media type form-url-encoded.

### 10.4 Blob / ArrayBuffer / Stream

Untuk binary atau stream:

```js
await fetch('/api/binary', {
  method: 'POST',
  body: someBlob
});
```

Anda perlu memahami memory dan upload behavior, terutama untuk file besar.

---

## 11. `method`: Default GET dan Konsekuensi Body

Default method adalah GET.

```js
fetch('/api/users'); // GET
```

Untuk POST:

```js
fetch('/api/users', {
  method: 'POST',
  body: JSON.stringify({ name: 'Alice' })
});
```

Ingat dari Part 004:

- GET harus safe secara semantic.
- PUT/DELETE idempotent secara semantic.
- POST tidak idempotent secara default.
- OPTIONS banyak muncul untuk CORS preflight.

Beberapa method tidak lazim dengan body. Jangan mendesain API yang bergantung pada GET body untuk browser frontend. Banyak stack, proxy, cache, dan tooling tidak mendukung atau tidak mengharapkan GET body.

---

## 12. `headers`: Power dan Batasannya

Contoh:

```js
await fetch('/api/orders', {
  headers: {
    'Accept': 'application/json',
    'X-Client-Version': 'web-2026.06.18'
  }
});
```

Namun browser tidak mengizinkan JavaScript mengatur header tertentu, misalnya header yang berhubungan dengan connection management, cookie, host, content length, dan beberapa header keamanan/protocol.

Pola penting:

```text
Header custom dapat mengubah request dari simple menjadi preflighted CORS request.
```

Misalnya request cross-origin dengan header:

```http
X-Request-Id: abc
Authorization: Bearer ...
```

biasanya memicu preflight.

Jangan tambahkan custom header hanya karena “rapi”. Setiap header adalah bagian dari protocol contract dan bisa punya konsekuensi CORS/cache/security.

---

## 13. `mode`: `cors`, `same-origin`, `no-cors`, `navigate`

### 13.1 `cors`

Ini mode umum untuk cross-origin request yang ingin response-nya dibaca JavaScript.

```js
fetch('https://api.example.com/data', {
  mode: 'cors'
});
```

Server harus mengirim CORS response headers yang sesuai.

### 13.2 `same-origin`

Hanya izinkan same-origin.

```js
fetch('/api/data', {
  mode: 'same-origin'
});
```

Jika URL ternyata cross-origin, request akan ditolak.

Gunakan ini jika Anda ingin enforce invariant:

```text
HTTP client ini hanya boleh bicara ke origin aplikasi sendiri.
```

### 13.3 `no-cors`

Ini sering disalahgunakan.

```js
fetch('https://third-party.example/pixel', {
  mode: 'no-cors'
});
```

Dalam `no-cors`, response yang diekspos ke JavaScript biasanya opaque. Anda tidak bisa membaca status, headers, atau body dengan normal.

Jadi `no-cors` bukan solusi untuk “mengatasi CORS error”. Ia justru membuat response tidak bisa dibaca.

Mental model:

```text
no-cors = saya bersedia mengirim request terbatas tanpa membaca response meaningful.
```

Bukan:

```text
no-cors = bypass CORS.
```

### 13.4 `navigate`

Mode ini terkait navigation request, bukan opsi yang normal digunakan untuk application `fetch()` biasa.

---

## 14. `credentials`: Cookie, Authorization, dan Ambient Authority

`credentials` mengontrol apakah browser menyertakan credentials seperti cookies, TLS client certificates, atau authentication entries tertentu, serta bagaimana credentialed CORS diperlakukan.

Nilai umum:

```js
credentials: 'omit'
credentials: 'same-origin'
credentials: 'include'
```

### 14.1 `same-origin` Default

Secara umum default `fetch()` adalah `same-origin`.

Artinya:

```js
fetch('/api/me')
```

akan menyertakan cookie same-origin.

Tetapi:

```js
fetch('https://api.other-origin.com/me')
```

tidak otomatis menyertakan cookie cross-origin kecuali Anda menggunakan:

```js
fetch('https://api.other-origin.com/me', {
  credentials: 'include'
});
```

### 14.2 Credentialed CORS

Untuk cross-origin cookie-based request:

```js
fetch('https://api.example.com/me', {
  credentials: 'include'
});
```

server perlu mengirim header CORS yang compatible:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

Tidak bisa memakai wildcard origin untuk credentialed request:

```http
Access-Control-Allow-Origin: *
```

### 14.3 Token di Authorization Header

Jika Anda memakai bearer token:

```js
fetch('/api/me', {
  headers: {
    Authorization: `Bearer ${token}`
  }
});
```

Perhatikan:

- `Authorization` bisa memicu CORS preflight pada cross-origin request.
- Token di JavaScript memiliki risiko XSS exposure.
- Token refresh flow harus mengatasi concurrency/race.

### 14.4 Cookie vs Header Auth

Cookie:

```text
+ otomatis dikirim sesuai cookie policy
+ bisa HttpOnly
+ cocok untuk BFF/session
- ambient authority
- perlu CSRF consideration
- SameSite/CORS/third-party cookie complexity
```

Authorization header:

```text
+ eksplisit di request
+ tidak otomatis dikirim browser
+ cocok untuk API tertentu
- token harus berada di JavaScript-accessible storage/memory
- XSS impact tinggi
- preflight lebih sering
```

---

## 15. `cache`: Browser HTTP Cache Control dari Fetch

`fetch()` memiliki opsi `cache`:

```js
fetch('/api/products', { cache: 'default' })
fetch('/api/products', { cache: 'no-store' })
fetch('/api/products', { cache: 'reload' })
fetch('/api/products', { cache: 'no-cache' })
fetch('/api/products', { cache: 'force-cache' })
fetch('/api/products', { cache: 'only-if-cached', mode: 'same-origin' })
```

Penting: opsi ini berinteraksi dengan HTTP cache headers dari server. Jangan mengandalkan client-side `cache` option sebagai pengganti desain cache server yang benar.

### 15.1 `default`

Mengikuti normal HTTP cache semantics.

### 15.2 `no-store`

Bypass cache dan tidak menyimpan response ke HTTP cache.

Cocok untuk data sangat sensitif atau request yang benar-benar tidak boleh tersimpan.

### 15.3 `reload`

Bypass cache pada request, tapi response mungkin disimpan.

### 15.4 `no-cache`

Bukan berarti “tidak pakai cache sama sekali”. Dalam HTTP semantics, `no-cache` sering berarti cache boleh menyimpan tetapi harus revalidate sebelum digunakan.

### 15.5 `force-cache`

Cenderung memakai cache jika tersedia, bahkan jika stale dalam kondisi tertentu sesuai browser semantics.

### 15.6 `only-if-cached`

Terbatas dan biasanya hanya untuk same-origin.

Production advice:

```text
Desain caching utama dengan response headers.
Gunakan fetch cache option hanya untuk kebutuhan spesifik client behavior.
```

---

## 16. `redirect`: Follow, Error, Manual

Default:

```js
redirect: 'follow'
```

Artinya browser mengikuti redirect secara otomatis.

```js
const response = await fetch('/old-url');
console.log(response.url);        // final URL after redirects
console.log(response.redirected); // true/false
```

Opsi:

```js
redirect: 'follow'
redirect: 'error'
redirect: 'manual'
```

### 16.1 `follow`

Browser mengikuti redirect.

### 16.2 `error`

Redirect dianggap failure.

Berguna jika invariant Anda:

```text
API endpoint tidak boleh redirect.
```

### 16.3 `manual`

Sering disalahpahami. Browser tidak memberi Anda kontrol penuh seperti server-side HTTP client. Cross-origin manual redirect bisa menghasilkan response terbatas/opaque-redirect.

Untuk frontend API call, redirect sering bukan pattern ideal. Lebih baik API mengembalikan status explicit seperti:

```http
401 Unauthorized
Content-Type: application/json

{ "code": "SESSION_EXPIRED" }
```

Daripada:

```http
302 Found
Location: /login
```

Kenapa? Karena `fetch()` terhadap API yang tiba-tiba menerima HTML login page sering menyebabkan parsing error atau CORS/redirect confusion.

---

## 17. `signal`: Abort, Cancellation, dan Timeout

`fetch()` tidak punya opsi `timeout` sederhana seperti beberapa HTTP client backend. Pola modernnya memakai `AbortController`.

### 17.1 Manual Abort

```js
const controller = new AbortController();

const promise = fetch('/api/search?q=abc', {
  signal: controller.signal
});

controller.abort();

await promise; // rejects with abort-related error
```

### 17.2 Timeout Pattern

```js
async function fetchWithTimeout(url, init = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
```

Namun ini belum menangani jika `init.signal` sudah ada. Versi lebih matang perlu compose signal.

### 17.3 Compose dengan Existing Signal

Modern browser mendukung helper seperti `AbortSignal.timeout()` dan `AbortSignal.any()` di banyak environment modern, tetapi compatibility tetap perlu dicek untuk target browser Anda.

Pattern konseptual:

```js
async function fetchJson(url, { signal, timeoutMs = 10_000, ...init } = {}) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const response = await fetch(url, {
    ...init,
    signal: combinedSignal
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}
```

### 17.4 Kenapa Cancellation Penting di Frontend

Contoh scenario:

1. User mengetik search query `a`.
2. Request `/search?q=a` dikirim.
3. User mengetik `ab`.
4. Request `/search?q=ab` dikirim.
5. Response `ab` datang lebih dulu.
6. Response `a` datang belakangan.
7. UI menampilkan hasil lama.

Solusi:

- abort request lama;
- atau gunakan request sequence id;
- atau library data fetching yang deduplicate/cancel;
- atau stale response guard.

Contoh:

```js
let currentController;
let currentRequestId = 0;

async function search(query) {
  currentController?.abort();
  currentController = new AbortController();

  const requestId = ++currentRequestId;

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
      signal: currentController.signal
    });

    const data = await response.json();

    if (requestId !== currentRequestId) {
      return; // stale response
    }

    renderResults(data);
  } catch (e) {
    if (currentController.signal.aborted) {
      return;
    }
    renderError(e);
  }
}
```

---

## 18. `keepalive`: Small Requests During Page Unload

`keepalive` memungkinkan request kecil tetap dikirim ketika halaman sedang unload/navigate away.

```js
fetch('/analytics/event', {
  method: 'POST',
  body: JSON.stringify({ event: 'page_exit' }),
  headers: { 'Content-Type': 'application/json' },
  keepalive: true
});
```

Gunakan untuk telemetry kecil, bukan operasi bisnis penting.

Batasan penting:

- ukuran payload terbatas;
- tidak cocok untuk mutation penting;
- user agent bisa membatasi;
- untuk analytics, `navigator.sendBeacon()` sering lebih cocok.

Jangan gunakan `keepalive` untuk operasi seperti:

```text
- submit pembayaran
- approve workflow
- delete data
- finalisasi transaksi
```

Jika operasi penting, desain UX dan backend acknowledgement dengan benar.

---

## 19. `referrer` dan `referrerPolicy`

Browser dapat mengirim `Referer` header berdasarkan policy.

```js
fetch('/api/data', {
  referrerPolicy: 'strict-origin-when-cross-origin'
});
```

Referrer penting untuk:

- analytics;
- CSRF heuristics;
- privacy;
- token leakage prevention;
- cross-origin navigation.

Hindari menaruh token/session/sensitive data di URL query karena bisa bocor melalui logs, history, analytics, dan referrer dalam kondisi tertentu.

---

## 20. `integrity`: Subresource Integrity Context

`integrity` lebih umum dilihat pada resource seperti script/link, tetapi Fetch API juga punya opsi terkait integrity metadata.

Konsepnya:

```text
Browser dapat memverifikasi bahwa bytes yang diterima cocok dengan hash yang diharapkan.
```

Ini relevan terutama untuk third-party/static resource. Untuk API dynamic JSON, integrity biasanya bukan pattern praktis.

---

## 21. Request Priority dan Fetch Priority

Browser modern memiliki mekanisme prioritas resource. Ada API/atribut seperti `fetchpriority` untuk resource tertentu dan opsi priority dalam beberapa konteks modern.

Namun jangan berpikir priority adalah solusi utama untuk API design buruk.

Urutan pengaruh yang lebih fundamental:

```text
1. Kurangi dependency yang tidak perlu.
2. Hindari waterfall sequential yang tidak perlu.
3. Cache dengan benar.
4. Kecilkan payload.
5. Prioritaskan critical resource.
6. Baru gunakan priority hints jika memang cocok.
```

---

## 22. Service Worker Interception

Jika aplikasi punya service worker, `fetch()` bisa tidak langsung menuju network.

Flow konseptual:

```text
fetch('/api/data')
        |
        v
service worker fetch event?
        |
        +--> return cached response
        +--> forward to network
        +--> synthesize response
        +--> fail
```

Service worker bisa:

- mengembalikan response dari Cache API;
- melakukan network-first strategy;
- melakukan stale-while-revalidate;
- membuat offline fallback;
- memodifikasi request/response dalam batas tertentu.

Akibatnya, saat debugging, jangan hanya lihat backend log. Mungkin request tidak pernah keluar dari browser karena service worker menjawab dari cache.

DevTools biasanya punya panel Application/Service Workers dan opsi bypass service worker.

---

## 23. Fetch and HTTP Cache: Jangan Campur dengan Application Data Cache

Ada beberapa cache berbeda:

```text
Browser HTTP cache
Service Worker Cache API
In-memory app cache
TanStack Query/SWR cache
CDN cache
Backend cache
Database/cache layer
```

`fetch()` berinteraksi terutama dengan browser HTTP cache dan service worker layer. Library seperti TanStack Query menyimpan **application data**, bukan HTTP cache dalam arti protocol.

Contoh:

```js
const data = useQuery({
  queryKey: ['users'],
  queryFn: () => fetch('/api/users').then(r => r.json()),
  staleTime: 60_000
});
```

`staleTime` di sini bukan `Cache-Control: max-age=60`. Itu application cache policy.

Mental model:

```text
HTTP cache = byte/response caching governed by HTTP semantics.
Application cache = domain data caching governed by app/library semantics.
```

Keduanya bisa saling membantu atau saling merusak jika tidak didesain.

---

## 24. CORS dan Error Visibility

Salah satu hal paling menyebalkan bagi frontend engineer: browser sengaja tidak memberi terlalu banyak detail ke JavaScript saat CORS gagal.

Contoh:

```js
try {
  await fetch('https://api.example.com/secret');
} catch (e) {
  console.error(e);
}
```

Anda mungkin hanya melihat generic failure. DevTools console/network bisa memberi indikasi CORS, tetapi JavaScript tidak mendapat response details.

Kenapa? Karena jika browser memberi detail penuh, Same-Origin Policy bisa bocor.

Pola debugging:

```text
1. Cek Console untuk CORS error.
2. Cek Network: apakah preflight OPTIONS terjadi?
3. Cek request Origin.
4. Cek response Access-Control-Allow-Origin.
5. Cek Access-Control-Allow-Credentials jika credentials include.
6. Cek Access-Control-Allow-Headers untuk custom headers.
7. Cek Access-Control-Allow-Methods untuk method.
8. Cek Vary: Origin untuk cached response.
9. Cek apakah server/proxy/CDN mengubah header.
```

---

## 25. Opaque Response dan `response.type`

`Response.type` bisa bernilai seperti:

```text
basic
cors
opaque
opaqueredirect
error
```

Opaque response sering muncul dari `no-cors` request.

Ciri opaque response:

```text
- status tidak meaningful untuk JavaScript
- body tidak bisa dibaca
- headers tidak bisa dibaca
```

Jika Anda melihat opaque response, jangan berharap bisa parsing JSON.

---

## 26. Redirect + Fetch + Auth: Bug Klasik SPA

Scenario:

1. SPA memanggil `/api/me`.
2. Session expired.
3. Backend/security filter mengembalikan `302 Location: /login`.
4. Browser mengikuti redirect.
5. Response final adalah HTML login page.
6. Frontend menjalankan `response.json()`.
7. Parsing gagal karena body adalah HTML.

Dari backend perspective, redirect ke login normal untuk browser navigation. Dari API/fetch perspective, itu sering buruk.

Lebih baik:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "code": "SESSION_EXPIRED",
  "loginUrl": "/login"
}
```

Lalu frontend memutuskan:

```js
if (error.status === 401 && error.body?.code === 'SESSION_EXPIRED') {
  navigateToLogin();
}
```

Invariant:

```text
Navigation endpoint may redirect.
API endpoint should usually return API-shaped errors.
```

---

## 27. Building a Robust `fetchJson` Wrapper

Kita bangun dari naif ke cukup matang.

### 27.1 Naif

```js
async function fetchJson(url) {
  const response = await fetch(url);
  return response.json();
}
```

Masalah:

- 404 dianggap sukses sampai parsing;
- 204 gagal parsing;
- HTML error page gagal parsing;
- no timeout;
- no abort support;
- no error taxonomy;
- no credentials policy explicit;
- no correlation header;
- no content-type check.

### 27.2 Versi Lebih Matang

```js
class HttpError extends Error {
  constructor({ status, statusText, body, headers, url }) {
    super(`HTTP ${status} ${statusText}`);
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.headers = headers;
    this.url = url;
  }
}

class ParseError extends Error {
  constructor({ message, status, contentType, rawSnippet, cause }) {
    super(message);
    this.name = 'ParseError';
    this.status = status;
    this.contentType = contentType;
    this.rawSnippet = rawSnippet;
    this.cause = cause;
  }
}

async function readBody(response) {
  if (response.status === 204 || response.status === 205) {
    return null;
  }

  const contentType = response.headers.get('Content-Type') || '';

  if (contentType.toLowerCase().includes('application/json')) {
    try {
      return await response.json();
    } catch (cause) {
      throw new ParseError({
        message: 'Failed to parse JSON response',
        status: response.status,
        contentType,
        cause
      });
    }
  }

  const text = await response.text();

  if (!text) {
    return null;
  }

  throw new ParseError({
    message: `Expected JSON response but received ${contentType || 'unknown content type'}`,
    status: response.status,
    contentType,
    rawSnippet: text.slice(0, 200)
  });
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init.headers || {})
    },
    ...init
  });

  const body = await readBody(response);

  if (!response.ok) {
    throw new HttpError({
      status: response.status,
      statusText: response.statusText,
      body,
      headers: response.headers,
      url: response.url
    });
  }

  return body;
}
```

### 27.3 Caveat

Kode di atas masih perlu disesuaikan untuk:

- timeout;
- abort signal composition;
- trace/correlation ID;
- retry policy;
- auth refresh;
- upload/download progress;
- binary endpoints;
- request deduplication;
- schema validation;
- observability hooks;
- PII-safe logging.

Namun struktur mentalnya sudah benar: baca response, parse sesuai representation, bedakan HTTP error, jangan treat semua sebagai generic exception.

---

## 28. Timeout, Retry, dan Idempotency

Timeout dan retry harus memahami method semantics.

Aman-ish untuk retry otomatis:

```text
GET, HEAD, OPTIONS, maybe PUT/DELETE if designed idempotently
```

Berbahaya untuk retry otomatis:

```text
POST mutation without idempotency key
```

Contoh buruk:

```js
await retry(() => fetch('/api/payments', {
  method: 'POST',
  body: JSON.stringify(payment)
}));
```

Jika request pertama sebenarnya berhasil di server tetapi response hilang karena network failure, retry bisa membuat pembayaran ganda.

Solusi:

```js
await fetch('/api/payments', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': crypto.randomUUID()
  },
  body: JSON.stringify(payment)
});
```

Namun idempotency key harus didukung backend dengan penyimpanan dan semantics yang benar.

Frontend rule:

```text
No automatic retry for non-idempotent mutation unless API contract explicitly supports idempotency.
```

---

## 29. Upload dan Download Progress

Fetch API modern bagus untuk streaming, tetapi upload progress masih lebih sering memakai `XMLHttpRequest` dalam beberapa kebutuhan karena XHR menyediakan upload progress events secara lebih langsung.

Download progress bisa dilakukan dengan `ReadableStream`:

```js
async function downloadWithProgress(url, onProgress) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentLength = response.headers.get('Content-Length');
  const total = contentLength ? Number(contentLength) : undefined;

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    chunks.push(value);
    received += value.length;
    onProgress?.({ received, total });
  }

  return new Blob(chunks);
}
```

Caveat:

- `Content-Length` mungkin tidak ada karena compression/chunking;
- buffering chunks bisa boros memori;
- untuk file besar, gunakan streaming strategy yang lebih cocok;
- browser support dan API behavior perlu dicek.

---

## 30. Streaming Response: Saat JSON Bukan Satu Blob

Untuk banyak API tradisional:

```text
request -> wait -> full JSON response
```

Namun beberapa use case butuh streaming:

```text
- logs
- AI/token stream
- progress events
- large data export
- incremental rendering
```

Fetch response body dapat dibaca sebagai stream:

```js
const response = await fetch('/api/events-stream');
const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { value, done } = await reader.read();
  if (done) break;

  const text = decoder.decode(value, { stream: true });
  console.log(text);
}
```

Namun streaming memperkenalkan kompleksitas:

- partial message framing;
- backpressure;
- cancellation;
- retry/reconnect;
- proxy buffering;
- compression interaction;
- UI incremental rendering;
- error after partial success.

Untuk event-like stream, SSE (`EventSource`) sering lebih cocok daripada manual fetch streaming.

---

## 31. Environment-Specific Gotchas

### 31.1 Localhost vs 127.0.0.1

```text
http://localhost:3000
http://127.0.0.1:3000
```

Bisa dianggap origin berbeda. Cookie, CORS, dan storage bisa berbeda.

### 31.2 HTTP vs HTTPS

```text
http://app.example.com
https://app.example.com
```

Scheme berbeda berarti origin berbeda.

Selain itu, HTTPS page tidak boleh sembarang request active content ke HTTP endpoint karena mixed content blocking.

### 31.3 Dev Proxy Menyembunyikan CORS

Dev server proxy sering membuat request terlihat same-origin:

```text
browser -> localhost frontend dev server -> backend
```

Di production:

```text
browser -> app.example.com
browser -> api.example.com
```

CORS/cookie behavior bisa berubah.

### 31.4 CDN/Proxy Mengubah Response

Response yang diterima browser mungkin bukan response langsung dari service Anda. CDN/proxy/gateway bisa:

- menambah/menghapus header;
- mengubah compression;
- melakukan redirect;
- cache response;
- menyisipkan error page HTML;
- mengubah status code.

---

## 32. Debugging `fetch()` di DevTools

Ketika `fetch()` gagal, jangan langsung baca stack trace. Buka Network tab.

Checklist:

```text
1. Apakah request muncul di Network tab?
2. URL final benar?
3. Method benar?
4. Status code apa?
5. Ada preflight OPTIONS?
6. Request headers sesuai ekspektasi?
7. Cookie terkirim?
8. Response headers sesuai ekspektasi?
9. Content-Type benar?
10. Response body JSON atau HTML/error page?
11. Redirect terjadi?
12. Request served from memory/disk cache/service worker?
13. Timing bottleneck di DNS/connect/TLS/TTFB/download?
14. Console menunjukkan CORS/CSP/mixed content error?
15. Apakah response header terlihat di Network tapi tidak bisa dibaca JS? Mungkin butuh Access-Control-Expose-Headers.
```

Perbedaan penting:

```text
Network tab melihat lebih banyak daripada JavaScript boleh melihat.
```

Browser DevTools bisa menunjukkan response header, tetapi JavaScript mungkin tidak boleh membaca header tersebut karena CORS exposure rules.

---

## 33. Designing a Frontend HTTP Client Layer

Untuk aplikasi serius, jangan menyebar `fetch()` langsung di seluruh komponen.

Buruk:

```js
// Component A
fetch('/api/users').then(r => r.json())

// Component B
fetch('/api/orders', { credentials: 'include' }).then(r => r.json())

// Component C
fetch('/api/products', { cache: 'no-store' }).then(r => r.json())
```

Masalah:

- inconsistent error handling;
- inconsistent credentials;
- no shared timeout;
- no observability;
- no retry policy;
- no schema validation;
- hard to test;
- auth refresh scattered;
- response parsing repeated;
- security mistakes duplicated.

Lebih baik:

```text
UI component
    |
    v
Domain data hook/service
    |
    v
API client per resource
    |
    v
Shared HTTP client
    |
    v
fetch()
```

Shared HTTP client bertanggung jawab untuk:

```text
- base URL
- credentials policy
- default headers
- Accept / Content-Type convention
- timeout
- abort support
- error normalization
- parsing
- correlation ID
- tracing hooks
- retry policy
- auth failure handling
- logging redaction
```

Tetapi jangan buat “God HTTP client” yang tahu semua domain behavior. Pisahkan:

```text
transport concerns       -> shared HTTP client
API resource concerns    -> API module
business/domain concerns -> domain service / state layer
UI concerns              -> component / view model
```

---

## 34. Example: Production-Oriented HTTP Client Skeleton

Berikut contoh skeleton TypeScript-ish. Ini bukan library final, tapi menunjukkan separation of concerns.

```ts
type HttpClientOptions = {
  baseUrl?: string;
  defaultTimeoutMs?: number;
  credentials?: RequestCredentials;
  getCorrelationId?: () => string;
};

type RequestOptions = RequestInit & {
  timeoutMs?: number;
  expectedContentType?: 'json' | 'text' | 'blob' | 'none';
};

class HttpStatusError extends Error {
  status: number;
  body: unknown;
  response: Response;

  constructor(response: Response, body: unknown) {
    super(`HTTP ${response.status} ${response.statusText}`);
    this.name = 'HttpStatusError';
    this.status = response.status;
    this.body = body;
    this.response = response;
  }
}

function buildUrl(baseUrl: string | undefined, path: string): string {
  if (!baseUrl) return path;
  return new URL(path, baseUrl).toString();
}

async function parseResponse(response: Response, expected: RequestOptions['expectedContentType']) {
  if (expected === 'none' || response.status === 204 || response.status === 205) {
    return null;
  }

  if (expected === 'blob') {
    return response.blob();
  }

  if (expected === 'text') {
    return response.text();
  }

  const contentType = response.headers.get('Content-Type') || '';

  if (contentType.toLowerCase().includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  throw new Error(`Expected JSON, got ${contentType}: ${text.slice(0, 200)}`);
}

function createHttpClient(options: HttpClientOptions = {}) {
  const {
    baseUrl,
    defaultTimeoutMs = 15_000,
    credentials = 'same-origin',
    getCorrelationId = () => crypto.randomUUID()
  } = options;

  return async function request<T = unknown>(path: string, init: RequestOptions = {}): Promise<T> {
    const timeoutMs = init.timeoutMs ?? defaultTimeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);

    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;

    const headers = new Headers(init.headers);

    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }

    if (!headers.has('X-Correlation-Id')) {
      headers.set('X-Correlation-Id', getCorrelationId());
    }

    const response = await fetch(buildUrl(baseUrl, path), {
      ...init,
      credentials,
      headers,
      signal
    });

    const parsedBody = await parseResponse(response, init.expectedContentType ?? 'json');

    if (!response.ok) {
      throw new HttpStatusError(response, parsedBody);
    }

    return parsedBody as T;
  };
}
```

Catatan:

- `AbortSignal.timeout` dan `AbortSignal.any` perlu dicek compatibility target browser.
- `X-Correlation-Id` custom header dapat memicu CORS preflight untuk cross-origin request.
- Jangan selalu generate correlation ID di browser jika sistem observability Anda punya standard lain seperti Trace Context.
- Jangan log full body sembarangan.
- Untuk endpoints non-JSON, gunakan explicit expected content type.

---

## 35. Anti-Patterns yang Harus Dihindari

### 35.1 Menganggap `catch` Menangkap HTTP Error

Buruk:

```js
try {
  const data = await fetch('/api/users').then(r => r.json());
} catch {
  showError('Server error');
}
```

Lebih baik:

```js
const response = await fetch('/api/users');

if (!response.ok) {
  handleHttpError(response);
}
```

### 35.2 Memakai `no-cors` untuk “Fix CORS”

Buruk:

```js
fetch('https://api.example.com/data', { mode: 'no-cors' });
```

Jika Anda perlu membaca response, fix server CORS policy. Jangan pakai `no-cors`.

### 35.3 Selalu `response.json()`

Buruk:

```js
return fetch(url).then(r => r.json());
```

Tidak semua response punya JSON body.

### 35.4 Set `Content-Type: multipart/form-data` Manual

Buruk:

```js
fetch('/upload', {
  method: 'POST',
  headers: { 'Content-Type': 'multipart/form-data' },
  body: formData
});
```

Biarkan browser menyetel boundary.

### 35.5 Retry Semua Request

Buruk:

```js
retry(() => fetch('/api/checkout', { method: 'POST', body }));
```

Mutation perlu idempotency strategy.

### 35.6 Token Refresh Stampede

Buruk:

```text
10 request mendapat 401 bersamaan
10 request refresh token bersamaan
sebagian refresh gagal
session state rusak
```

Solusi perlu single-flight refresh, queueing, atau auth state machine yang benar.

### 35.7 Menaruh Business Logic di HTTP Wrapper

Buruk:

```text
httpClient automatically redirects every 409 to conflict page
httpClient automatically shows toast for every 500
httpClient knows invoice workflow states
```

Transport layer jangan tahu terlalu banyak domain behavior.

---

## 36. Case Study 1: “API 500 Tidak Masuk Catch”

### Symptom

Developer menulis:

```js
try {
  await fetch('/api/report').then(r => r.json());
} catch (e) {
  showToast('Request failed');
}
```

Backend mengirim:

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{ "code": "REPORT_GENERATION_FAILED" }
```

UI tidak menampilkan error yang tepat.

### Root Cause

`fetch()` resolve karena response diterima. `catch` hanya akan jalan jika `.json()` gagal atau network/fetch failure terjadi.

### Fix

```js
const response = await fetch('/api/report');
const body = await response.json();

if (!response.ok) {
  showToast(body.message ?? `HTTP ${response.status}`);
  return;
}

renderReport(body);
```

### Prevention

Gunakan shared HTTP wrapper yang mengubah non-2xx menjadi typed `HttpError`.

---

## 37. Case Study 2: “Login Sukses, Tapi `/me` Tetap 401”

### Symptom

```js
await fetch('https://api.example.com/login', {
  method: 'POST',
  body: JSON.stringify(credentials),
  headers: { 'Content-Type': 'application/json' }
});

await fetch('https://api.example.com/me'); // 401
```

### Kemungkinan Root Cause

1. Login response `Set-Cookie`, tapi cookie tidak disimpan karena CORS credentials tidak benar.
2. Request `/me` tidak mengirim cookie karena `credentials: 'include'` tidak diset untuk cross-origin.
3. Cookie `SameSite` tidak compatible dengan cross-site request.
4. Cookie `Secure` tidak dikirim di HTTP local dev.
5. Domain/path cookie tidak match.
6. Browser privacy policy membatasi third-party cookie.

### Fix Pattern

```js
await fetch('https://api.example.com/login', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(credentials)
});

await fetch('https://api.example.com/me', {
  credentials: 'include'
});
```

Server:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
Set-Cookie: session=...; Path=/; HttpOnly; Secure; SameSite=None
```

Butuh penyesuaian berdasarkan apakah request same-site/cross-site.

---

## 38. Case Study 3: “Response Header Terlihat di DevTools, Tapi `response.headers.get()` Null”

### Symptom

Network tab menunjukkan:

```http
X-Total-Count: 348
```

Tapi kode:

```js
const total = response.headers.get('X-Total-Count');
console.log(total); // null
```

### Root Cause

Untuk cross-origin CORS response, JavaScript hanya bisa membaca safelisted response headers kecuali server mengekspos header tambahan.

### Fix

Server harus menambahkan:

```http
Access-Control-Expose-Headers: X-Total-Count
```

### Prevention

Jika API pagination memakai custom response header, contract CORS juga harus menyebut exposed headers.

Alternatif: taruh metadata pagination di response body.

---

## 39. Case Study 4: “Upload File Gagal Hanya di Browser”

### Symptom

Frontend:

```js
const formData = new FormData();
formData.append('file', file);

await fetch('/api/upload', {
  method: 'POST',
  headers: {
    'Content-Type': 'multipart/form-data'
  },
  body: formData
});
```

Backend gagal membaca multipart.

### Root Cause

Boundary tidak diset dengan benar karena developer override `Content-Type`.

### Fix

```js
await fetch('/api/upload', {
  method: 'POST',
  body: formData
});
```

Biarkan browser menentukan `Content-Type` dengan boundary.

---

## 40. Decision Matrix: Opsi Fetch yang Sering Dipakai

| Need | Fetch Option / Pattern | Caveat |
|---|---|---|
| Same-origin JSON GET | `fetch('/api/x')` | Tetap cek `ok` dan parsing |
| Cross-origin API read | `mode: 'cors'` | Server harus enable CORS |
| Cross-origin cookie | `credentials: 'include'` | Butuh ACAO explicit + ACAC true + cookie attrs |
| Jangan kirim cookie | `credentials: 'omit'` | Pastikan auth tidak bergantung cookie |
| Request timeout | `AbortController` / `AbortSignal.timeout` | Timeout bukan built-in option klasik |
| Cancel stale search | `AbortController` + request id | Tangani abort bukan sebagai error user-facing |
| Upload FormData | `body: formData` | Jangan set multipart Content-Type manual |
| Read JSON | `response.json()` | Body sekali pakai; 204 kosong |
| Read file | `response.blob()` / stream | Memory concern untuk file besar |
| Reject redirect | `redirect: 'error'` | Bagus untuk API invariant |
| Avoid cache | `cache: 'no-store'` | Tetap desain server cache headers |
| Page unload telemetry | `keepalive: true` / beacon | Jangan untuk business-critical mutation |
| Read custom response header cross-origin | `Access-Control-Expose-Headers` server-side | Tidak cukup hanya header ada di Network tab |

---

## 41. Checklist Review Code yang Memakai `fetch()`

Gunakan checklist ini saat review PR.

### Correctness

- Apakah `response.ok` dicek?
- Apakah status non-2xx diperlakukan berbeda dari network failure?
- Apakah 204/205 ditangani?
- Apakah `Content-Type` dicek sebelum `json()`?
- Apakah body hanya dibaca sekali?
- Apakah redirect API diperlakukan eksplisit?

### Security

- Apakah credentials policy eksplisit?
- Apakah token tidak bocor ke URL?
- Apakah custom headers diperlukan?
- Apakah CORS implication dipahami?
- Apakah sensitive body/header tidak dilog?
- Apakah cookie auth memperhitungkan CSRF?

### Reliability

- Apakah ada timeout/cancellation untuk request user-facing?
- Apakah stale response bisa overwrite UI?
- Apakah retry aman berdasarkan method/idempotency?
- Apakah offline/network failure punya UX?
- Apakah abort tidak ditampilkan sebagai error merah ke user?

### Performance

- Apakah request membuat waterfall tidak perlu?
- Apakah payload terlalu besar?
- Apakah caching policy jelas?
- Apakah duplicate request dideduplicate?
- Apakah large response dibaca dengan strategi memory-aware?

### Observability

- Apakah ada correlation/trace mechanism?
- Apakah error normalized?
- Apakah status/body/error category bisa dilaporkan?
- Apakah logging PII-safe?
- Apakah server bisa mengaitkan request frontend dengan backend trace?

---

## 42. Mental Model Final

Ingat model ini:

```text
fetch(input, init)
    |
    v
Construct Request
    |
    +--> URL resolution
    +--> method/body/header normalization
    +--> credentials/cache/redirect/mode/referrer policy
    |
    v
Browser policy checks
    |
    +--> same-origin / CORS
    +--> CSP connect-src
    +--> mixed content
    +--> forbidden headers
    |
    v
Service worker?
    |
    +--> respond from cache
    +--> forward to network
    |
    v
HTTP cache?
    |
    +--> fresh response
    +--> revalidation
    +--> network
    |
    v
Network stack
    |
    +--> DNS/proxy/TCP/TLS/HTTP2/HTTP3
    |
    v
Redirect/CORS exposure/body stream
    |
    v
Response object or rejected Promise
```

Dan error taxonomy:

```text
No Response object:
  network / CORS / abort / policy / TLS / DNS / offline

Response object with non-2xx:
  HTTP-level outcome

Response object with unparseable body:
  representation/parsing failure

Response object with valid body but negative business result:
  domain-level outcome
```

---

## 43. Practice Lab

Untuk benar-benar menguasai bagian ini, buat mini app lokal dengan endpoint berikut:

```text
GET /ok-json              -> 200 application/json
GET /not-found-json       -> 404 application/json
GET /server-error-html    -> 500 text/html
GET /empty                -> 204 no body
GET /slow                 -> delay 10 seconds
GET /redirect-login       -> 302 Location: /login
GET /login                -> 200 text/html
POST /echo-json           -> echo JSON body
POST /upload              -> accept multipart
GET /custom-header        -> X-Total-Count response header
```

Lalu dari browser:

1. Panggil semua endpoint dengan fetch naif.
2. Catat mana yang reject dan mana yang resolve.
3. Coba `response.ok`.
4. Coba `.json()` terhadap HTML dan 204.
5. Baca body dua kali dan amati error.
6. Tambahkan `AbortController` untuk `/slow`.
7. Tambahkan redirect mode `error` untuk `/redirect-login`.
8. Buat cross-origin setup dan amati CORS.
9. Tambahkan custom response header dan coba baca dari JS.
10. Tambahkan service worker sederhana dan lihat request tidak selalu sampai server.

Target bukan sekadar berhasil, tapi bisa menjelaskan setiap outcome dengan layer yang tepat.

---

## 44. Ringkasan

`fetch()` adalah API kecil di permukaan tetapi besar secara konseptual. Untuk menjadi kuat di HTTP frontend, Anda harus berhenti berpikir bahwa `fetch()` adalah “HTTP client biasa”. Ia adalah gerbang ke sistem browser yang melibatkan security policy, cache, credentials, redirects, service worker, streaming, dan network stack.

Prinsip utama:

1. HTTP error bukan Promise rejection.
2. Body adalah stream sekali pakai.
3. CORS bukan auth dan bukan firewall; CORS mengontrol exposure response ke JavaScript.
4. Credentials harus eksplisit, terutama cross-origin.
5. `no-cors` bukan solusi untuk membaca response cross-origin.
6. Parsing body adalah failure layer tersendiri.
7. Timeout/cancel perlu `AbortController`.
8. Retry harus tunduk pada idempotency.
9. DevTools Network adalah sumber kebenaran debugging awal, tetapi JavaScript punya exposure rules lebih sempit.
10. Production app butuh HTTP client layer, bukan `fetch()` liar di seluruh komponen.

---

## 45. Referensi Utama

- WHATWG Fetch Standard — unified fetching architecture, `Request`, `Response`, CORS, redirects, body handling, dan algoritma browser fetching.
- MDN Web Docs — Using the Fetch API, `RequestInit`, `Response.ok`, `Response.bodyUsed`, `AbortController`.
- RFC 9110 — HTTP Semantics: status code, response/message semantics, representation metadata.

---

## 46. Status Seri

```text
Part 008 selesai.
Seri belum selesai.
Lanjut ke Part 009: XMLHttpRequest, Forms, Navigation, Beacon, and Non-Fetch Requests.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-007.md">⬅️ Body, Payload, Representation, Media Type, and Encoding</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-009.md">Part 009 — XMLHttpRequest, Forms, Navigation, Beacon, and Non-Fetch Requests ➡️</a>
</div>

# learn-http-for-web-frontend-perspective-part-009.md

# Part 009 — XMLHttpRequest, Forms, Navigation, Beacon, and Non-Fetch Requests

> Seri: `learn-http-for-web-frontend-perspective`  
> Perspektif: Java software engineer yang ingin menguasai HTTP dari sisi browser/frontend  
> Level: intermediate → advanced  
> Fokus bagian ini: memahami bahwa traffic browser tidak hanya berasal dari `fetch()`, serta mampu membedakan perilaku HTTP dari `fetch`, XHR, form submission, navigation, resource loading, beacon, iframe, SSE, dan handshake realtime.

---

## 0. Kenapa Bagian Ini Penting?

Setelah mempelajari `fetch()` di Part 008, mudah sekali jatuh ke asumsi:

> “Kalau frontend melakukan HTTP request, berarti request itu pasti dibuat oleh `fetch()` atau library yang membungkus `fetch()`.”

Itu salah.

Browser adalah HTTP client yang jauh lebih besar daripada JavaScript API. Browser bisa membuat request karena banyak alasan:

- user mengetik URL lalu menekan Enter;
- browser melakukan navigation;
- HTML parser menemukan `<script src="...">`;
- CSS menemukan `url(...)`;
- halaman memuat image, font, video, favicon, manifest, atau source map;
- user submit `<form>`;
- SPA library melakukan `fetch()`;
- legacy code memakai `XMLHttpRequest`;
- analytics mengirim `navigator.sendBeacon()` saat page unload;
- app membuka `EventSource` untuk Server-Sent Events;
- app membuka WebSocket;
- iframe memuat dokumen lain;
- service worker mengintercept request;
- browser melakukan preload/prefetch/prerender;
- extension, password manager, atau browser feature tertentu menambah request tambahan.

Dari DevTools Network, semua terlihat seperti “request”. Tetapi dari sudut browser, request-request itu punya kategori, policy, mode, credential behavior, redirect behavior, visibility, cancellation behavior, dan security constraint yang berbeda.

Bagian ini membangun mental model untuk menjawab pertanyaan produksi seperti:

- Kenapa request form bisa mengirim cookie, tetapi `fetch()` tidak?
- Kenapa image cross-origin bisa tampil, tetapi response-nya tidak bisa dibaca JavaScript?
- Kenapa request analytics tetap dikirim saat user menutup tab?
- Kenapa redirect login bekerja untuk navigation, tetapi gagal untuk AJAX?
- Kenapa request terlihat di Network tab, tetapi tidak bisa dikontrol oleh frontend code?
- Kenapa preflight muncul hanya untuk request tertentu?
- Kenapa XHR lama punya behavior berbeda dari `fetch()`?
- Kenapa `no-cors` menghasilkan opaque response dan bukan solusi?
- Kenapa font blocked padahal image dari domain yang sama bisa tampil?

Inti bagian ini:

> `fetch()` hanyalah salah satu pintu masuk ke fetching model browser. Untuk menjadi engineer top-tier, Anda harus memahami request berdasarkan **initiator**, **destination**, **mode**, **credentials**, **visibility**, dan **lifecycle**, bukan hanya berdasarkan URL dan status code.

---

## 1. Mental Model: Browser Punya Banyak “Request Initiator”

Setiap request browser punya “alasan keberadaan”. Dalam DevTools, ini sering muncul sebagai **Initiator**, **Type**, **Destination**, atau **Resource Type**.

Secara konseptual, request browser dapat dikelompokkan menjadi:

```text
Browser HTTP Traffic
├── Navigation requests
│   ├── address bar navigation
│   ├── link click
│   ├── form submit navigation
│   ├── redirect navigation
│   └── iframe navigation
│
├── Subresource requests
│   ├── script
│   ├── stylesheet
│   ├── image
│   ├── font
│   ├── media
│   ├── manifest
│   ├── favicon
│   └── source map
│
├── Scripted requests
│   ├── fetch()
│   ├── XMLHttpRequest
│   ├── sendBeacon()
│   └── EventSource
│
├── Realtime / bidirectional channels
│   ├── WebSocket handshake
│   └── WebTransport / related modern transports
│
├── Speculative and performance requests
│   ├── preload
│   ├── modulepreload
│   ├── prefetch
│   ├── preconnect
│   ├── dns-prefetch
│   └── prerender
│
└── Service worker-mediated requests
    ├── intercepted navigation
    ├── intercepted subresource
    ├── intercepted fetch/XHR
    └── synthetic/cache response
```

Satu URL yang sama bisa diminta dengan behavior yang berbeda tergantung request initiator.

Contoh:

```html
<img src="https://cdn.example.com/avatar.png">
```

```js
await fetch("https://cdn.example.com/avatar.png");
```

Keduanya bisa menghasilkan HTTP `GET /avatar.png`, tetapi browser policy-nya berbeda:

- `<img>` dapat menampilkan cross-origin image dalam banyak kondisi;
- `fetch()` cross-origin membutuhkan CORS kalau JavaScript ingin membaca response;
- `<img>` tidak memberi JavaScript akses otomatis ke bytes response;
- `fetch()` memberi JavaScript akses ke body kalau CORS mengizinkan;
- canvas tainting dapat terjadi jika image cross-origin digambar ke `<canvas>` tanpa CORS yang benar.

Jadi pertanyaan yang benar bukan hanya:

> “Request ini GET atau POST?”

Tetapi:

> “Request ini dibuat oleh siapa, untuk tujuan apa, dengan mode apa, credentials apa, dan hasilnya boleh dibaca oleh siapa?”

---

## 2. Lima Dimensi untuk Mengklasifikasi Request Browser

Untuk membaca request browser dengan presisi, gunakan lima dimensi berikut.

### 2.1 Initiator

Initiator adalah penyebab request.

Contoh:

- HTML parser;
- CSS parser;
- JavaScript `fetch()`;
- JavaScript XHR;
- navigation;
- form submission;
- service worker;
- preload scanner;
- browser speculative loader.

Pertanyaan diagnosis:

```text
Siapa yang memulai request ini?
```

Kenapa penting?

Karena initiator menentukan:

- apakah request dapat dikontrol oleh app code;
- apakah response dapat dibaca oleh JavaScript;
- apakah request mengikuti CORS;
- apakah redirect behavior sama dengan navigation;
- apakah request dibatalkan saat page unload;
- apakah request diprioritaskan sebagai critical resource.

---

### 2.2 Destination

Destination adalah tujuan semantik request dari sudut browser.

Contoh destination:

- `document`
- `script`
- `style`
- `image`
- `font`
- `media`
- `iframe`
- `empty` untuk beberapa scripted fetch

Destination mempengaruhi:

- CSP directive yang berlaku;
- `Sec-Fetch-Dest` header;
- CORS requirement untuk resource tertentu;
- priority;
- decoding/processing response;
- apakah response dieksekusi, dirender, diunduh, atau hanya diberikan ke JavaScript.

Contoh:

```html
<script src="https://cdn.example.com/app.js"></script>
<img src="https://cdn.example.com/app.js">
```

URL sama, destination beda. Browser memperlakukan response secara berbeda.

---

### 2.3 Mode

Mode adalah policy akses cross-origin.

Konsep umum:

- same-origin;
- cors;
- no-cors;
- navigate;
- websocket.

Mode menjawab:

```text
Apakah request boleh cross-origin?
Kalau boleh, apakah JavaScript boleh membaca response?
Apakah response menjadi opaque?
Apakah CORS diperlukan?
```

`fetch()` memberi opsi `mode`, tetapi banyak request non-fetch menentukan mode secara implisit berdasarkan jenis resource.

---

### 2.4 Credentials

Credentials adalah data autentikasi yang bisa dikirim browser secara otomatis atau eksplisit.

Contoh:

- cookies;
- HTTP authentication;
- TLS client certificate;
- beberapa credential-related browser state.

Dalam `fetch()`, credentials dapat berupa:

```js
fetch(url, { credentials: "omit" });        // tidak kirim credential
fetch(url, { credentials: "same-origin" }); // default: credential untuk same-origin
fetch(url, { credentials: "include" });     // credential juga untuk cross-origin jika policy mengizinkan
```

Dalam XHR, konsep mirip diatur dengan:

```js
xhr.withCredentials = true;
```

Namun form navigation, image loading, script loading, dan iframe punya aturan credential yang tidak selalu identik dengan `fetch()`.

---

### 2.5 Visibility

Visibility menjawab:

```text
Apakah JavaScript bisa membaca response?
```

Contoh:

- `fetch()` CORS success → JS bisa membaca body/header tertentu;
- `fetch()` `no-cors` → response opaque, JS tidak bisa membaca body/status meaningful;
- `<img>` cross-origin → browser bisa render image, JS tidak otomatis bisa membaca bytes;
- navigation → response menjadi document, bukan return value ke JS;
- form submit normal → response mengganti document;
- beacon → JS hampir tidak mendapat response detail;
- WebSocket → setelah handshake, komunikasi bukan lagi response body biasa.

Ini membedakan:

> “Browser berhasil memuat resource”

vs

> “JavaScript berhasil membaca response.”

Keduanya tidak sama.

---

## 3. Scripted Requests: `fetch()` vs `XMLHttpRequest`

### 3.1 `fetch()` sebagai model modern

`fetch()` adalah API modern berbasis Promise dan stream.

Karakter utama:

- Promise resolves untuk HTTP response, termasuk 404/500;
- Promise rejects untuk network-level failure, abort, CORS failure, atau policy failure;
- body adalah stream yang umumnya hanya bisa dikonsumsi sekali;
- mendukung `AbortController`;
- punya model `Request`, `Response`, dan `Headers`;
- credentials dikontrol via `credentials` option;
- redirect dikontrol via `redirect` option;
- CORS terintegrasi dengan Fetch Standard.

Contoh minimal:

```js
const res = await fetch("/api/profile", {
  method: "GET",
  credentials: "same-origin",
});

if (!res.ok) {
  throw new Error(`HTTP ${res.status}`);
}

const profile = await res.json();
```

---

### 3.2 `XMLHttpRequest` sebagai legacy tapi masih penting

`XMLHttpRequest` atau XHR adalah API lama untuk scripted HTTP request.

Masih penting karena:

- banyak legacy app masih memakainya;
- beberapa library lama dibangun di atas XHR;
- upload progress lebih historis/umum dengan XHR;
- beberapa behavior debugging di DevTools masih menyebut XHR/fetch sebagai satu kategori;
- pengetahuan XHR membantu membaca codebase lama.

Contoh XHR:

```js
const xhr = new XMLHttpRequest();
xhr.open("GET", "/api/profile");
xhr.responseType = "json";

xhr.onload = () => {
  if (xhr.status >= 200 && xhr.status < 300) {
    console.log(xhr.response);
  } else {
    console.error("HTTP error", xhr.status, xhr.responseText);
  }
};

xhr.onerror = () => {
  console.error("Network or CORS error");
};

xhr.send();
```

Untuk credentialed cross-origin request:

```js
const xhr = new XMLHttpRequest();
xhr.open("GET", "https://api.example.com/me");
xhr.withCredentials = true;
xhr.send();
```

`withCredentials = true` kira-kira setara niatnya dengan `fetch(..., { credentials: "include" })`, tetapi API dan lifecycle-nya berbeda.

---

### 3.3 Perbedaan penting `fetch()` dan XHR

| Area | `fetch()` | XHR |
|---|---|---|
| Style | Promise/stream | callback/event |
| HTTP 404/500 | Promise tetap resolve | `load` tetap terpanggil |
| Network/CORS failure | reject | `error` |
| Abort | `AbortController` | `xhr.abort()` |
| Body streaming | lebih modern | terbatas |
| Upload progress | historically lebih mudah via `xhr.upload.onprogress` | native event |
| Credentials | `credentials` option | `withCredentials` |
| Response object | `Response` | properties di `xhr` |
| Legacy support | modern | sangat lama |

Contoh bug umum:

```js
try {
  const res = await fetch("/api/orders");
  const data = await res.json();
  // Bug: 500 tetap masuk sini jika body JSON valid.
} catch (e) {
  // Hanya network/policy/abort/parsing error yang masuk sini.
}
```

Versi lebih benar:

```js
const res = await fetch("/api/orders");

if (!res.ok) {
  const body = await safeReadJson(res);
  throw new ApiError(res.status, body);
}

const data = await res.json();
```

---

## 4. HTML Form Submission: Browser-Native HTTP Mutation

HTML form adalah mekanisme HTTP bawaan browser yang jauh lebih tua daripada SPA.

Form bukan sekadar UI component. Form adalah cara declarative untuk membuat HTTP request.

Contoh:

```html
<form method="post" action="/orders">
  <input name="sku" value="BOOK-1">
  <input name="quantity" value="2">
  <button type="submit">Buy</button>
</form>
```

Saat user submit:

1. browser mengumpulkan successful controls;
2. browser membentuk request berdasarkan `method`, `action`, dan `enctype`;
3. browser mengirim request;
4. browser melakukan navigation ke response;
5. halaman lama biasanya diganti dengan halaman response.

MDN merangkum form HTML sebagai cara user-friendly untuk mengonfigurasi HTTP request yang dikirim ke server.

---

### 4.1 Method form

HTML form native mendukung method utama:

```html
<form method="get" action="/search">
```

```html
<form method="post" action="/orders">
```

Secara native, HTML form tidak mendukung `PUT`, `PATCH`, atau `DELETE` langsung seperti REST API modern.

Karena itu banyak framework memakai:

```html
<input type="hidden" name="_method" value="DELETE">
```

atau JavaScript menangani submit lalu melakukan `fetch()`.

---

### 4.2 GET form

Contoh:

```html
<form method="get" action="/search">
  <input name="q" value="http cache">
  <button>Search</button>
</form>
```

Browser menghasilkan navigation ke URL seperti:

```text
/search?q=http+cache
```

Karakteristik:

- data masuk query string;
- cocok untuk search/filter yang bookmarkable;
- bisa di-share sebagai URL;
- masuk browser history;
- jangan dipakai untuk data sensitif;
- semestinya tidak punya side effect.

---

### 4.3 POST form

Contoh:

```html
<form method="post" action="/orders">
  <input name="sku" value="BOOK-1">
  <input name="quantity" value="2">
  <button>Submit</button>
</form>
```

Default encoding form POST adalah:

```http
Content-Type: application/x-www-form-urlencoded
```

Body kira-kira:

```text
sku=BOOK-1&quantity=2
```

Karakteristik:

- request body membawa data;
- response biasanya menjadi document baru;
- refresh setelah POST dapat memicu browser confirmation;
- umum dipakai untuk login form, checkout, classic server-rendered apps.

---

### 4.4 `enctype`

Form encoding menentukan `Content-Type` request.

#### `application/x-www-form-urlencoded`

Default.

```html
<form method="post" action="/login">
```

Cocok untuk field sederhana.

#### `multipart/form-data`

Untuk file upload.

```html
<form method="post" action="/upload" enctype="multipart/form-data">
  <input type="file" name="document">
  <button>Upload</button>
</form>
```

Browser menentukan boundary otomatis.

Kesalahan umum di JavaScript:

```js
const formData = new FormData(form);

await fetch("/upload", {
  method: "POST",
  headers: {
    "Content-Type": "multipart/form-data", // Bug: jangan set manual
  },
  body: formData,
});
```

Yang benar:

```js
const formData = new FormData(form);

await fetch("/upload", {
  method: "POST",
  body: formData,
});
```

Browser akan menambahkan boundary yang benar:

```http
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary...
```

#### `text/plain`

Jarang dipakai untuk production API.

```html
<form method="post" enctype="text/plain">
```

Biasanya tidak cocok untuk structured API.

---

### 4.5 Form submit vs JavaScript-handled submit

Form normal:

```html
<form method="post" action="/orders">
  ...
</form>
```

Perilaku:

- browser melakukan request;
- browser melakukan navigation;
- JS tidak menerima `Response` object;
- redirect diperlakukan sebagai navigation;
- cookies dikirim sesuai aturan browser navigation;
- progressive enhancement bagus.

JavaScript-handled form:

```js
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const res = await fetch("/api/orders", {
    method: "POST",
    body: formData,
  });

  // UI tetap di halaman yang sama.
});
```

Perilaku:

- JavaScript mengontrol request;
- response bisa dibaca jika CORS/policy mengizinkan;
- tidak otomatis navigation;
- developer harus menangani loading, error, success, retry, duplicate submit;
- redirect login tidak selalu berubah menjadi full-page login flow;
- accessibility/progressive enhancement butuh perhatian tambahan.

---

### 4.6 Post/Redirect/Get Pattern

Dalam server-rendered form flow, pattern klasik:

```text
User submits POST /orders
Server creates order
Server responds 303 See Other Location: /orders/123
Browser navigates GET /orders/123
```

Keuntungan:

- refresh halaman tidak mengulang POST;
- URL akhir bookmarkable;
- browser history lebih bersih;
- user tidak melihat form resubmission warning.

Untuk SPA, pattern ini sering diganti dengan:

```text
POST /api/orders
→ 201 Created { id: "123" }
→ frontend router navigate("/orders/123")
```

Keduanya valid, tetapi failure model berbeda.

---

## 5. Navigation Requests: Request yang Menghasilkan Document

Navigation request adalah request untuk memuat dokumen baru.

Contoh penyebab:

- user mengetik URL;
- user klik link;
- `window.location.href = ...`;
- form submit normal;
- redirect navigation;
- iframe load;
- browser restore session;
- history back/forward;
- SPA fallback reload.

Contoh link:

```html
<a href="/dashboard">Dashboard</a>
```

Browser melakukan navigation request dengan destination `document`.

---

### 5.1 Navigation berbeda dari `fetch()`

Misalnya endpoint `/login` mengembalikan HTML login page.

Dengan navigation:

```js
window.location.href = "/login";
```

Browser:

- request `/login`;
- menerima HTML;
- mengganti document;
- menjalankan parsing, script, CSS, lifecycle baru.

Dengan `fetch()`:

```js
const res = await fetch("/login");
const html = await res.text();
```

Browser:

- request `/login`;
- memberi HTML sebagai string ke JavaScript;
- tidak otomatis mengganti halaman;
- script di HTML tidak dieksekusi sebagai document baru;
- redirect behavior berbeda tergantung options dan CORS.

Jadi endpoint yang cocok untuk navigation belum tentu cocok untuk AJAX.

---

### 5.2 Redirect login: navigation vs AJAX

Classic web app:

```text
GET /dashboard
→ 302 Location: /login
→ browser navigates to /login
→ user sees login page
```

SPA API call:

```text
fetch('/api/orders')
→ 302 Location: /login
→ fetch follows redirect
→ final response is HTML login page
→ frontend tries res.json()
→ JSON parse error
```

Bug yang muncul:

```text
Unexpected token '<', "<!doctype html>..." is not valid JSON
```

Akar masalah:

- server menggunakan navigation-style auth redirect untuk API endpoint;
- frontend mengharapkan API-style error contract.

Desain lebih baik untuk API:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/problem+json

{
  "type": "https://example.com/problems/unauthenticated",
  "title": "Authentication required",
  "code": "AUTH_REQUIRED"
}
```

Frontend lalu memutuskan:

```js
if (error.status === 401) {
  authStore.markExpired();
  router.push("/login");
}
```

Invariant:

> Navigation endpoint boleh redirect ke HTML. API endpoint sebaiknya mengembalikan status dan body API yang bisa diproses mesin.

---

### 5.3 Iframe navigation

Iframe memuat document dalam nested browsing context.

```html
<iframe src="https://pay.example.com/checkout"></iframe>
```

Request iframe adalah navigation request untuk document, tetapi dalam konteks frame.

Hal yang mempengaruhi:

- `X-Frame-Options`;
- CSP `frame-ancestors`;
- sandbox attribute;
- third-party cookie restrictions;
- postMessage communication;
- COOP/COEP/CORP pada beberapa kasus;
- payment/auth provider policy.

Bug umum:

```text
Checkout iframe blank di production.
```

Kemungkinan akar masalah:

- provider mengirim `X-Frame-Options: DENY`;
- CSP `frame-ancestors` tidak mengizinkan origin app;
- third-party cookies diblokir;
- mixed content;
- redirect dalam iframe menuju domain yang tidak boleh di-frame;
- login page provider melarang embedding.

---

## 6. Subresource Requests: Script, CSS, Image, Font, Media

Subresource request adalah request untuk resource yang dibutuhkan document.

Contoh:

```html
<link rel="stylesheet" href="/assets/app.css">
<script src="/assets/app.js" defer></script>
<img src="/images/hero.jpg" alt="Hero">
```

Browser membuat request otomatis saat parsing atau rendering.

---

## 6.1 Script Requests

Script request terjadi saat browser memuat JavaScript dari `src`.

```html
<script src="https://cdn.example.com/app.js"></script>
```

Classic script cross-origin historically bisa dimuat tanpa CORS untuk eksekusi, tetapi ada banyak detail modern:

- module scripts memakai aturan CORS yang lebih ketat;
- Subresource Integrity dapat memerlukan `crossorigin` untuk error detail dan CORS interaction;
- CSP `script-src` menentukan apakah script boleh dimuat;
- MIME type penting;
- `X-Content-Type-Options: nosniff` dapat menyebabkan script diblokir jika content type salah.

Contoh module script:

```html
<script type="module" src="https://cdn.example.com/app.mjs"></script>
```

Module script lebih dekat ke CORS-aware loading.

Bug umum:

```text
Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".
```

Kemungkinan:

- asset path salah;
- CDN fallback mengembalikan `index.html`;
- chunk file tidak ada setelah deployment;
- content type salah;
- cache stale.

---

## 6.2 Stylesheet Requests

```html
<link rel="stylesheet" href="/assets/app.css">
```

CSS bisa memicu request lanjutan:

```css
@font-face {
  font-family: Inter;
  src: url("/fonts/inter.woff2") format("woff2");
}

.hero {
  background-image: url("/images/hero.jpg");
}
```

Jadi satu `<link>` dapat menyebabkan banyak request turunan.

Hal penting:

- stylesheet dapat render-blocking;
- CSS import menambah waterfall;
- CSS resource URL relatif terhadap file CSS;
- CSP `style-src` dan `font-src`/`img-src` dapat memblokir resource;
- source map dapat muncul sebagai request tambahan.

---

## 6.3 Image Requests

```html
<img src="https://cdn.example.com/avatar.png" alt="Avatar">
```

Image cross-origin dapat ditampilkan tanpa JavaScript membaca bytes-nya.

Namun jika ingin memproses image di canvas:

```html
<img id="avatar" crossorigin="anonymous" src="https://cdn.example.com/avatar.png">
```

Server perlu mengizinkan CORS:

```http
Access-Control-Allow-Origin: https://app.example.com
```

Jika tidak, canvas dapat menjadi “tainted” dan JavaScript tidak boleh membaca pixel data.

Prinsip:

> Menampilkan resource cross-origin tidak selalu sama dengan mendapatkan akses programatik ke isinya.

---

## 6.4 Font Requests

Fonts punya aturan yang sering mengejutkan.

```css
@font-face {
  font-family: "Acme";
  src: url("https://cdn.example.com/acme.woff2") format("woff2");
}
```

Cross-origin font biasanya membutuhkan CORS header yang benar.

Bug umum:

```text
Access to font at 'https://cdn.example.com/acme.woff2' from origin 'https://app.example.com' has been blocked by CORS policy.
```

Perbaikan server/CDN:

```http
Access-Control-Allow-Origin: https://app.example.com
Content-Type: font/woff2
Cache-Control: public, max-age=31536000, immutable
```

Atau jika font publik:

```http
Access-Control-Allow-Origin: *
```

Tetapi hati-hati untuk resource yang membawa credential/personalisasi.

---

## 6.5 Media Requests

Video/audio dapat memakai range requests.

```html
<video controls src="/media/intro.mp4"></video>
```

Browser bisa mengirim:

```http
Range: bytes=0-
```

Server idealnya mendukung:

```http
206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 0-999999/5000000
```

Masalah umum:

- video tidak bisa seek karena server tidak mendukung range;
- CDN tidak cache range dengan benar;
- MIME type salah;
- CORS dibutuhkan jika media diproses via canvas/Web Audio;
- large media mengganggu bandwidth critical resources.

---

## 7. `navigator.sendBeacon()`: Fire-and-Forget yang Tidak Sama dengan `fetch()`

`sendBeacon()` dirancang untuk mengirim data kecil secara reliable ketika halaman sedang unload/backgrounding, misalnya analytics, telemetry, atau “user left page” signal.

Contoh:

```js
window.addEventListener("pagehide", () => {
  const payload = JSON.stringify({
    page: location.pathname,
    durationMs: performance.now(),
  });

  navigator.sendBeacon("/analytics/page-exit", payload);
});
```

Karakter utama:

- asynchronous;
- tidak menunggu response detail;
- cocok untuk telemetry kecil;
- browser mencoba mengirim tanpa memblokir unload;
- return value hanya boolean indikasi queued atau tidak;
- tidak bisa set custom headers seperti `Authorization` secara langsung;
- bukan untuk operasi bisnis kritikal;
- bukan pengganti reliable transaction.

---

### 7.1 Kapan memakai `sendBeacon()`

Cocok untuk:

- page unload analytics;
- RUM event;
- performance metrics;
- low-value telemetry;
- fire-and-forget logging.

Tidak cocok untuk:

- payment;
- logout yang wajib berhasil;
- audit regulatory yang wajib tercatat;
- order submission;
- mutation yang user-visible;
- request yang membutuhkan response body.

---

### 7.2 `sendBeacon()` dan Content-Type

Jika payload string dikirim:

```js
navigator.sendBeacon("/analytics", JSON.stringify({ event: "exit" }));
```

Server harus siap menerima content type yang browser pilih. Jika butuh tipe spesifik, gunakan `Blob`:

```js
const body = new Blob(
  [JSON.stringify({ event: "exit" })],
  { type: "application/json" }
);

navigator.sendBeacon("/analytics", body);
```

Namun untuk cross-origin beacon, Content-Type dan CORS/preflight dapat menjadi lebih rumit. Jangan menganggap beacon bebas dari CORS.

---

### 7.3 `fetch(..., { keepalive: true })`

Alternatif modern untuk beberapa kasus:

```js
window.addEventListener("pagehide", () => {
  fetch("/analytics/page-exit", {
    method: "POST",
    body: JSON.stringify({ page: location.pathname }),
    headers: { "Content-Type": "application/json" },
    keepalive: true,
  });
});
```

Tetapi ada batasan ukuran dan lifecycle. Gunakan untuk telemetry kecil, bukan transaksi kritikal.

---

## 8. EventSource / Server-Sent Events

Server-Sent Events memakai HTTP response jangka panjang yang server gunakan untuk mengirim event satu arah ke browser.

Client:

```js
const events = new EventSource("/api/events");

events.onmessage = (event) => {
  console.log("event", event.data);
};

events.onerror = () => {
  console.log("SSE connection error or reconnecting");
};
```

Server response:

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

id: 1
event: notification
data: {"message":"hello"}

```

Karakteristik:

- server → client only;
- berjalan di atas HTTP;
- browser punya reconnect behavior;
- cocok untuk notifications, progress updates, feed updates;
- tidak cocok untuk bidirectional low-latency interaction seperti collaborative editing kompleks;
- proxy buffering bisa merusak SSE;
- connection limit perlu diperhatikan;
- auth biasanya via cookie atau URL/token pattern dengan hati-hati.

---

### 8.1 SSE vs polling

Polling:

```text
GET /events every 5 seconds
```

SSE:

```text
GET /events once
server keeps response open
server sends events over time
```

Trade-off:

| Aspek | Polling | SSE |
|---|---|---|
| Simplicity | sangat mudah | sedang |
| Latency | tergantung interval | rendah |
| Server load | banyak request | koneksi panjang |
| Direction | client pulls | server pushes |
| Proxy compatibility | mudah | perlu tuning buffering/timeouts |
| Browser API | fetch/timer | EventSource |

---

## 9. WebSocket Handshake: Dimulai dari HTTP, Lalu Berubah Protokol

WebSocket dimulai dengan HTTP request handshake.

Client:

```js
const socket = new WebSocket("wss://api.example.com/ws");

socket.onopen = () => {
  socket.send(JSON.stringify({ type: "subscribe", topic: "orders" }));
};

socket.onmessage = (event) => {
  console.log(event.data);
};
```

Handshake kira-kira:

```http
GET /ws HTTP/1.1
Host: api.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: ...
Sec-WebSocket-Version: 13
Origin: https://app.example.com
```

Server success:

```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: ...
```

Setelah itu, komunikasi bukan HTTP request-response biasa.

---

### 9.1 WebSocket bukan CORS biasa

WebSocket memakai `Origin` header untuk membantu server memutuskan apakah origin boleh membuka koneksi, tetapi bukan CORS preflight biasa seperti `fetch()`.

Server harus validasi `Origin` sendiri.

Bug umum:

```text
WebSocket bisa dibuka dari origin jahat karena server tidak memvalidasi Origin.
```

Jika WebSocket memakai cookie-based auth, risiko CSRF-like connection hijacking perlu dipikirkan.

Checklist WebSocket security:

- gunakan `wss://`;
- validasi `Origin`;
- auth token/session harus jelas;
- jangan percaya message client;
- enforce authorization per subscription/topic;
- rate limit;
- heartbeat;
- close idle connections;
- handle reconnect storm.

---

## 10. Resource Hints: Request yang Browser Buat demi Performance

Browser bisa membuat request atau koneksi sebelum resource benar-benar dibutuhkan.

### 10.1 DNS prefetch

```html
<link rel="dns-prefetch" href="//cdn.example.com">
```

Tujuan: resolve DNS lebih awal.

---

### 10.2 Preconnect

```html
<link rel="preconnect" href="https://cdn.example.com">
```

Tujuan: DNS + TCP + TLS lebih awal.

Cocok untuk origin critical yang pasti dipakai.

---

### 10.3 Preload

```html
<link rel="preload" href="/assets/app.css" as="style">
```

Tujuan: download resource critical lebih awal.

Harus tepat `as`-nya:

```html
<link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
```

Jika salah, browser bisa download dua kali atau tidak memakai cache sesuai harapan.

---

### 10.4 Prefetch

```html
<link rel="prefetch" href="/next-page-data.json">
```

Tujuan: ambil resource yang mungkin dibutuhkan nanti, prioritas rendah.

Risiko:

- membuang bandwidth;
- membocorkan intent user;
- cache invalidation sulit;
- tidak cocok untuk personalized sensitive data tanpa kontrol.

---

### 10.5 Prerender

Prerender dapat memuat halaman masa depan secara lebih agresif. Ini punya implikasi besar:

- request bisa terjadi sebelum user benar-benar navigasi;
- analytics bisa double count jika tidak hati-hati;
- side effect pada GET menjadi sangat berbahaya;
- halaman harus siap dengan lifecycle activation.

Invariant penting:

> Karena browser dapat melakukan speculative request, GET harus aman dan bebas side effect.

Ini menghubungkan kembali ke Part 004 tentang safe methods.

---

## 11. `no-cors`: Salah Satu Sumber Salah Paham Terbesar

Banyak developer saat melihat CORS error mencoba:

```js
fetch("https://api.example.com/data", {
  mode: "no-cors",
});
```

Lalu request “berhasil”, tetapi response tidak bisa dibaca.

Kenapa?

`no-cors` bukan “matikan CORS supaya bisa baca response”.

`no-cors` berarti:

- browser membatasi request ke bentuk tertentu;
- response menjadi opaque;
- JavaScript tidak bisa membaca status/body/header secara meaningful;
- cocok untuk beberapa subresource-like/fire-and-forget cases, bukan API data fetching.

Contoh:

```js
const res = await fetch("https://api.example.com/data", { mode: "no-cors" });

console.log(res.type);   // "opaque"
console.log(res.status); // 0
await res.text();        // tidak memberi body yang bisa dibaca
```

Mental model:

> `no-cors` memungkinkan browser melakukan request terbatas tanpa memberi JavaScript akses ke response. Ia bukan bypass security.

Solusi CORS yang benar ada di server response headers dan desain origin/credential yang tepat.

---

## 12. Cross-Origin Matrix: Display vs Read vs Execute

Salah satu cara paling berguna memahami browser HTTP adalah membedakan tiga hal:

1. browser boleh meminta resource;
2. browser boleh menampilkan/mengeksekusi resource;
3. JavaScript boleh membaca isi response.

| Resource | Cross-origin bisa diminta? | Bisa digunakan oleh browser? | JS bisa baca bytes/body? | Catatan |
|---|---:|---:|---:|---|
| `<img>` | sering bisa | ya, sebagai image | tidak langsung | canvas bisa tainted |
| `<script>` classic | sering bisa | bisa dieksekusi jika policy izinkan | tidak sebagai text response | CSP/MIME/SRI penting |
| module script | lebih ketat | butuh CORS-like success | tidak sebagai fetch body | modern module loading |
| CSS | sering bisa | bisa dipakai | tidak sebagai text response | CSS dapat fetch resource turunan |
| font | biasanya butuh CORS | bisa dipakai jika CORS ok | tidak sebagai body | font CORS sering jadi bug |
| `fetch()` | tergantung mode/CORS | tidak otomatis render | ya jika CORS/same-origin ok | API data fetching |
| XHR | tergantung CORS | tidak otomatis render | ya jika CORS/same-origin ok | legacy scripted request |
| form submit | bisa navigation | response jadi document | tidak sebagai JS response | classic web flow |
| iframe | bisa navigation jika allowed | document embedded | limited by same-origin | frame policy penting |
| sendBeacon | tergantung policy | tidak ada response use | tidak | telemetry |

Kunci:

> Browser sering boleh menggunakan resource tanpa memberi JavaScript akses penuh ke resource tersebut.

---

## 13. Credentials Behavior: Jangan Mengasumsikan Semua Request Sama

### 13.1 Same-origin scripted request

```js
fetch("/api/me");
```

Default `credentials` untuk fetch adalah `same-origin`, sehingga cookie same-origin dapat dikirim.

---

### 13.2 Cross-origin scripted request

```js
fetch("https://api.example.com/me");
```

Secara default, cross-origin credentials tidak dikirim.

Butuh:

```js
fetch("https://api.example.com/me", {
  credentials: "include",
});
```

Dan server harus mengizinkan credentialed CORS:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

Serta cookie harus cocok dengan aturan `Domain`, `Path`, `Secure`, `SameSite`, dan browser privacy policy.

---

### 13.3 Navigation request

Navigation cross-site dapat mengirim cookies tergantung SameSite dan cookie policy.

Contoh:

```html
<a href="https://bank.example.com/account">Bank</a>
```

Cookie bank mungkin dikirim jika aturan SameSite mengizinkan. Tetapi JavaScript dari origin asal tidak bisa membaca response document cross-origin karena halaman berubah atau dibuka sebagai konteks lain.

---

### 13.4 Image/script resource

Subresource request juga punya credential behavior tersendiri. Misalnya `<img>` ke same-site/cross-site bisa membawa cookie dalam kondisi tertentu, tetapi modern browser privacy restrictions dan SameSite dapat mempengaruhi.

Jangan mendesain image/script/font endpoint personalized tanpa sadar bahwa browser/CDN/cache/cookie interaction bisa rumit.

---

## 14. Cancellation dan Page Lifecycle

Request browser bisa dibatalkan karena banyak alasan:

- user navigasi ke halaman lain;
- component unmount;
- route berubah;
- tab ditutup;
- browser masuk background;
- network berubah;
- request priority kalah;
- service worker update;
- memory pressure;
- `AbortController.abort()`;
- XHR `abort()`.

### 14.1 Fetch cancellation

```js
const controller = new AbortController();

const promise = fetch("/api/search?q=http", {
  signal: controller.signal,
});

controller.abort();
```

Abort bukan “server pasti membatalkan kerja”. Abort berarti browser/client berhenti menunggu dan biasanya menutup stream/request. Server mungkin sudah menerima request dan tetap memproses.

Invariant:

> Client-side cancellation bukan transactional rollback.

Untuk operasi bisnis:

- buat endpoint cancel eksplisit;
- gunakan operation ID;
- jangan anggap abort menghentikan side effect;
- desain idempotency dan status resource.

---

### 14.2 Page unload

Saat user menutup tab atau navigasi pergi:

- normal fetch bisa dibatalkan;
- XHR sync selama unload sudah tidak disarankan/terbatas;
- `sendBeacon()` atau `fetch keepalive` lebih cocok untuk telemetry kecil;
- UI tidak boleh mengandalkan request unload untuk operasi kritikal.

Contoh buruk:

```js
window.addEventListener("beforeunload", async () => {
  await fetch("/api/save-critical-payment", { method: "POST" });
});
```

Ini tidak reliable.

---

## 15. DevTools: Cara Membaca Request Non-Fetch

Di Chrome/Edge/Firefox DevTools Network, perhatikan kolom:

- Name;
- Status;
- Type;
- Initiator;
- Size;
- Time;
- Waterfall;
- Priority;
- Headers;
- Payload;
- Response;
- Timing.

Untuk setiap request, tanyakan:

```text
1. Initiator-nya apa?
2. Type/destination-nya apa?
3. Ini navigation, subresource, scripted request, atau speculative request?
4. Apakah request ini visible ke JavaScript?
5. Apakah CORS berlaku?
6. Apakah credentials dikirim?
7. Apakah redirect terjadi?
8. Apakah response dipakai sebagai document, script, style, image, font, stream, atau data?
9. Apakah request ini bisa dibatalkan oleh lifecycle halaman?
10. Apakah service worker/CDN/cache ikut bermain?
```

---

## 16. Common Production Bugs dan Diagnosis

### 16.1 “API berhasil di browser kalau buka URL langsung, tapi gagal di fetch”

Scenario:

```text
User buka https://api.example.com/me langsung → terlihat JSON
SPA fetch https://api.example.com/me → CORS error
```

Diagnosis:

- buka URL langsung adalah navigation;
- navigation tidak sama dengan JS reading response;
- `fetch()` butuh CORS untuk cross-origin read;
- server belum mengirim `Access-Control-Allow-Origin` yang benar.

Fix:

```http
Access-Control-Allow-Origin: https://app.example.com
Vary: Origin
```

Jika credentials:

```http
Access-Control-Allow-Credentials: true
```

Dan fetch:

```js
fetch("https://api.example.com/me", { credentials: "include" });
```

---

### 16.2 “Login form berhasil, tetapi SPA login fetch gagal”

Classic form:

```html
<form method="post" action="https://auth.example.com/login">
```

SPA:

```js
fetch("https://auth.example.com/login", {
  method: "POST",
  body: JSON.stringify(credentials),
  headers: { "Content-Type": "application/json" },
  credentials: "include",
});
```

Perbedaan:

- form POST mungkin memakai `application/x-www-form-urlencoded`;
- fetch JSON memicu preflight;
- auth server mungkin tidak menangani OPTIONS;
- CORS credential headers mungkin salah;
- SameSite cookie mungkin tidak cocok;
- form navigation dan AJAX punya redirect handling berbeda.

Fix bukan “samakan URL”, tetapi samakan contract:

- endpoint login API harus mendukung CORS/preflight jika cross-origin;
- response harus API-friendly;
- cookie harus `Secure; SameSite=None` jika benar-benar cross-site;
- server harus tidak redirect HTML untuk API error.

---

### 16.3 “Font blocked by CORS, tapi image dari CDN sama bisa tampil”

Akar:

- image display punya aturan berbeda;
- font cross-origin biasanya membutuhkan CORS;
- CDN belum menambahkan `Access-Control-Allow-Origin` untuk font.

Fix:

```http
Access-Control-Allow-Origin: *
Content-Type: font/woff2
Cache-Control: public, max-age=31536000, immutable
```

Untuk public static font, wildcard biasanya aman karena tidak personalized dan tidak credentialed.

---

### 16.4 “Analytics hilang saat user menutup tab”

Akar:

- normal async fetch dibatalkan saat unload;
- event lifecycle salah;
- payload terlalu besar;
- endpoint cross-origin butuh preflight yang belum terjadi;
- beacon tidak dipakai atau gagal queued.

Fix:

- gunakan `pagehide`, bukan hanya `beforeunload`;
- gunakan `sendBeacon()` untuk telemetry kecil;
- atau `fetch(..., { keepalive: true })`;
- jangan pakai custom header jika ingin meminimalkan preflight;
- jangan jadikan telemetry unload sebagai sumber kebenaran tunggal.

---

### 16.5 “Request muncul dua kali”

Kemungkinan:

- preflight OPTIONS + actual request;
- redirect chain;
- preload + actual resource double download karena attribute mismatch;
- React Strict Mode dev double effect;
- service worker revalidation;
- browser retry;
- form submit plus JS fetch karena lupa `preventDefault()`;
- image responsive candidates;
- favicon request;
- source map request.

Diagnosis:

- lihat method;
- lihat initiator;
- lihat status 3xx;
- lihat `Purpose`, `Sec-Purpose`, atau resource hint;
- lihat call stack initiator;
- lihat apakah salah satunya OPTIONS.

---

## 17. Backend/API Design Implication untuk Java Engineer

Sebagai Java/backend engineer, bagian ini punya konsekuensi langsung.

### 17.1 Jangan desain API hanya untuk Postman/curl

Postman dan curl bukan browser.

Mereka tidak enforce:

- Same-Origin Policy;
- CORS read restrictions;
- browser credential modes;
- SameSite cookie behavior;
- forbidden headers;
- CORP/COEP/COOP;
- CSP;
- mixed content;
- service worker;
- page lifecycle cancellation.

Jika endpoint “berhasil di Postman” tetapi gagal di browser, browser belum tentu salah. Bisa jadi contract endpoint tidak compatible dengan browser policy.

---

### 17.2 Pisahkan endpoint document dan endpoint API

Document endpoint:

```text
GET /login
GET /dashboard
POST /orders classic form
```

Boleh:

- return HTML;
- redirect ke HTML;
- memakai PRG pattern;
- mengandalkan browser navigation.

API endpoint:

```text
GET /api/me
POST /api/orders
PATCH /api/profile
```

Sebaiknya:

- return JSON/problem+json;
- tidak redirect ke HTML untuk auth failure;
- status code machine-readable;
- CORS jelas;
- error envelope stabil;
- idempotency/retry semantics jelas.

---

### 17.3 Auth middleware harus sadar request type

Bug umum di backend:

```text
Jika unauthenticated → selalu redirect 302 /login
```

Itu cocok untuk browser navigation, buruk untuk API.

Lebih baik:

```text
If Accept: text/html / navigation → 302 /login
If API / Accept: application/json → 401 problem+json
```

Atau pisahkan route dan security chain.

Spring-style conceptual example:

```java
// Pseudocode, bukan konfigurasi final
if (isApiRequest(request)) {
    response.setStatus(401);
    response.setContentType("application/problem+json");
    writeProblemJson(response, "AUTH_REQUIRED");
} else {
    response.sendRedirect("/login");
}
```

---

### 17.4 Static asset endpoint harus berbeda dari API endpoint

Static asset ideal:

```http
Cache-Control: public, max-age=31536000, immutable
Content-Type: application/javascript
```

API personalized ideal:

```http
Cache-Control: private, no-store
Content-Type: application/json
```

Jangan campur policy.

Asset route yang fallback ke HTML harus hati-hati. Jika missing JS chunk mengembalikan `index.html` dengan status 200, browser akan memberi error MIME yang membingungkan.

Lebih baik missing asset:

```http
HTTP/1.1 404 Not Found
Content-Type: text/plain
```

Bukan:

```http
HTTP/1.1 200 OK
Content-Type: text/html

<!doctype html>...
```

---

## 18. Decision Framework: Request Ini Harus Pakai Apa?

### 18.1 Mengambil data untuk UI SPA

Gunakan:

```text
fetch() / HTTP client layer / data fetching library
```

Dengan:

- explicit error handling;
- timeout/abort;
- credentials policy;
- JSON contract;
- retry policy;
- cache strategy.

---

### 18.2 Submit form biasa server-rendered

Gunakan:

```text
HTML form + PRG
```

Jika:

- progressive enhancement penting;
- response adalah document;
- flow cocok dengan navigation;
- tidak butuh SPA state preservation.

---

### 18.3 Upload file dengan progress

Pilihan:

- XHR jika butuh upload progress event yang luas;
- fetch jika progress tidak dibutuhkan atau browser support modern mencukupi;
- direct-to-object-storage upload untuk file besar.

---

### 18.4 Analytics saat page exit

Gunakan:

```text
sendBeacon()
```

atau:

```text
fetch keepalive
```

Dengan batasan:

- payload kecil;
- tidak membutuhkan response;
- bukan transaksi kritikal.

---

### 18.5 Server push notification satu arah

Gunakan:

```text
SSE / EventSource
```

Jika:

- server → client;
- browser harus menerima event real-time-ish;
- bidirectional tidak perlu;
- proxy bisa dikonfigurasi.

---

### 18.6 Bidirectional realtime

Gunakan:

```text
WebSocket
```

Jika:

- client dan server saling kirim message;
- latency penting;
- protocol message custom;
- server siap mengelola connection lifecycle.

---

### 18.7 Critical navigation

Gunakan:

```text
normal link/navigation
```

Jika:

- hasilnya document baru;
- browser history/bookmark/SEO penting;
- auth redirect flow berbasis document;
- ingin memanfaatkan behavior native browser.

---

## 19. Anti-Patterns

### 19.1 Menggunakan `fetch()` untuk semuanya

Tidak semua request harus scripted.

Kadang native form/link lebih benar:

- lebih accessible;
- lebih progressive;
- lebih compatible;
- lebih sederhana;
- lebih sesuai dengan document navigation.

---

### 19.2 Menggunakan form submit untuk API modern tanpa sadar navigation

Jika Anda submit form tanpa `preventDefault()`, browser akan navigasi.

Bug:

```js
form.addEventListener("submit", async () => {
  await fetch("/api/orders", { method: "POST" });
});
```

Tanpa `event.preventDefault()`, bisa terjadi:

- fetch jalan;
- form native submit juga jalan;
- duplicate mutation;
- page navigation;
- race condition.

---

### 19.3 Mengandalkan unload request untuk data penting

Tidak reliable.

Gunakan explicit save sebelum unload, autosave dengan status, atau durable backend operation.

---

### 19.4 Memperbaiki CORS dengan `no-cors`

`no-cors` membuat response opaque. Itu bukan solusi API.

---

### 19.5 Menggunakan 302 HTML login untuk API

API client butuh 401/403 yang machine-readable, bukan HTML login page.

---

### 19.6 Tidak memvalidasi Origin pada WebSocket

Jika auth berbasis cookie, WebSocket tanpa origin validation bisa membuka attack surface.

---

### 19.7 Menaruh side effect di GET

Speculative loading, prefetch, prerender, crawler, reload, dan cache dapat memicu GET tanpa user intent eksplisit.

GET harus safe.

---

## 20. Practical Lab

### Lab 1 — Bandingkan navigation vs fetch

Buat endpoint lokal:

```http
GET /hello
Content-Type: text/html

<h1>Hello</h1>
```

Uji:

```js
window.location.href = "/hello";
```

Lalu:

```js
const res = await fetch("/hello");
console.log(await res.text());
```

Observasi:

- satu mengganti document;
- satu memberi string ke JS.

---

### Lab 2 — Form normal vs JS form

HTML:

```html
<form id="order-form" method="post" action="/orders">
  <input name="sku" value="BOOK-1">
  <button>Submit</button>
</form>
```

Pertama biarkan native submit.

Lalu tambahkan:

```js
document.querySelector("#order-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const res = await fetch("/api/orders", {
    method: "POST",
    body: formData,
  });
  console.log(res.status);
});
```

Bandingkan di Network:

- method;
- content-type;
- payload;
- redirect;
- response handling;
- document reload atau tidak.

---

### Lab 3 — Image cross-origin vs fetch cross-origin

Coba render image publik:

```html
<img src="https://example-cdn.test/avatar.png">
```

Lalu coba:

```js
await fetch("https://example-cdn.test/avatar.png");
```

Jika server tidak mengirim CORS, image mungkin tampil tetapi fetch gagal dibaca.

Catat perbedaan:

- display vs read;
- resource request vs scripted request;
- CORS error di console.

---

### Lab 4 — Beacon saat pagehide

```js
window.addEventListener("pagehide", () => {
  navigator.sendBeacon(
    "/analytics/exit",
    new Blob([JSON.stringify({ t: Date.now() })], { type: "application/json" })
  );
});
```

Observasi:

- apakah request muncul di Network;
- apakah response detail tersedia;
- apakah payload kecil terkirim;
- apa yang terjadi jika payload diperbesar.

---

### Lab 5 — Preload double download

```html
<link rel="preload" href="/fonts/inter.woff2" as="fetch">
<style>
@font-face {
  font-family: Inter;
  src: url("/fonts/inter.woff2") format("woff2");
}
</style>
```

Lalu perbaiki:

```html
<link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
```

Amati apakah request double.

---

## 21. Checklist Diagnosis Request Browser

Gunakan checklist ini saat debugging request aneh.

```text
[ ] Apakah request ini dibuat oleh fetch, XHR, form, navigation, resource loading, beacon, SSE, WebSocket, preload, atau service worker?
[ ] Apa method-nya?
[ ] Apa destination/type-nya?
[ ] Apakah same-origin, same-site, cross-origin, atau cross-site?
[ ] Apakah JavaScript perlu membaca response?
[ ] Apakah CORS diperlukan?
[ ] Apakah preflight muncul?
[ ] Apakah credentials dikirim?
[ ] Apakah cookie eligible menurut Domain/Path/Secure/SameSite?
[ ] Apakah redirect terjadi?
[ ] Redirect menuju HTML atau API response?
[ ] Apakah response MIME type sesuai destination?
[ ] Apakah CSP/CORP/COEP/COOP/X-Frame-Options memblokir?
[ ] Apakah request dibatalkan oleh navigation/unload/abort?
[ ] Apakah service worker mengintercept?
[ ] Apakah request speculative/preload/prefetch?
[ ] Apakah cache/CDN mengubah response?
[ ] Apakah Postman/curl success relevan untuk browser? Jika tidak, policy browser mana yang berbeda?
```

---

## 22. Ringkasan Mental Model

HTTP di browser tidak bisa dipahami hanya sebagai:

```text
method + URL + headers + body → status + headers + body
```

Itu model protocol minimal. Untuk frontend, model lengkapnya:

```text
initiator
+ destination
+ mode
+ credentials
+ browser policy
+ lifecycle
+ cache/service worker
+ network transport
+ response visibility
= actual behavior
```

`fetch()` adalah API penting, tetapi bukan seluruh dunia HTTP browser.

Form submit, navigation, image, script, CSS, font, iframe, beacon, XHR, SSE, WebSocket handshake, preload, prefetch, dan service worker semuanya ikut membentuk real traffic aplikasi web.

Engineer top-tier tidak bertanya:

> “Kenapa request ini gagal?”

Mereka bertanya:

> “Request ini jenis apa, siapa yang memulainya, response-nya seharusnya dipakai oleh siapa, policy browser apa yang berlaku, dan failure ini terjadi pada lapisan protocol, policy, lifecycle, cache, atau application contract?”

Jika Anda bisa menjawab itu, DevTools Network berubah dari daftar request acak menjadi peta sistem yang bisa dibaca.

---

## 23. Koneksi ke Part Berikutnya

Bagian ini menunjukkan bahwa banyak request browser melibatkan policy cross-origin, credentials, dan visibility.

Itu membawa kita langsung ke topik berikutnya:

```text
Part 010 — CORS Part 1: Same-Origin Policy and Why CORS Exists
```

Di sana kita akan membongkar CORS dari threat model dasarnya, bukan dari error message-nya. Kita akan membedakan:

- same-origin policy;
- cross-origin request;
- cross-origin read;
- simple request;
- preflight;
- credentialed CORS;
- exposed headers;
- kenapa Postman/curl bukan pembanding valid untuk browser.

---

## Status Seri

```text
Part 009 selesai.
Seri belum selesai.
Lanjut ke Part 010: CORS Part 1: Same-Origin Policy and Why CORS Exists.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-008.md">⬅️ Part 008 — Fetch API Mental Model: What `fetch()` Actually Does</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-010.md">CORS Part 1: Same-Origin Policy and Why CORS Exists ➡️</a>
</div>

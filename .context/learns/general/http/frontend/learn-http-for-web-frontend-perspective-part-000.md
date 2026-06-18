# learn-http-for-web-frontend-perspective-part-000.md

# Part 000 — Fondasi Seri: Cara Berpikir HTTP dari Perspektif Web/Frontend

> **Series:** `learn-http-for-web-frontend-perspective`  
> **Audience utama:** Java software engineer yang ingin memahami HTTP dari sisi browser/frontend secara mendalam.  
> **Tujuan part ini:** membangun fondasi mental, scope, vocabulary, dan cara belajar agar seluruh part berikutnya tidak terasa seperti kumpulan header, status code, dan trik debugging terpisah.

---

## 0. Status Seri

Ini adalah **Part 000** dari seri **HTTP for Web/Frontend Perspective**.

Seri belum selesai.

Part ini bukan bagian terakhir. Setelah ini lanjut ke:

```text
learn-http-for-web-frontend-perspective-part-001.md
```

Dengan topik:

```text
Orientation: HTTP dari Sudut Pandang Browser
```

---

## 1. Kenapa Ada Part 000?

Sebelum masuk ke HTTP request, response, header, CORS, cookies, cache, dan fetch, kita perlu menyamakan cara berpikir.

Banyak engineer belajar HTTP seperti ini:

```text
GET untuk ambil data.
POST untuk kirim data.
200 sukses.
404 tidak ditemukan.
500 error server.
CORS tinggal allow origin.
Cookie tinggal Set-Cookie.
Cache tinggal Cache-Control.
```

Itu cukup untuk membuat aplikasi sederhana, tapi tidak cukup untuk menjadi engineer yang bisa mendiagnosis problem produksi yang nyata.

Masalah HTTP di browser jarang berdiri sendiri. Contohnya:

```text
Login sukses, response 200, Set-Cookie ada di Network tab, tapi user tetap dianggap belum login.
```

Masalah itu bisa berasal dari banyak lapisan:

- cookie `SameSite` salah;
- cookie `Secure` tidak cocok dengan environment HTTP lokal;
- domain cookie tidak match;
- request fetch tidak memakai `credentials: "include"`;
- CORS tidak mengizinkan credential;
- response pakai `Access-Control-Allow-Origin: *` padahal credentialed request;
- reverse proxy menghapus `Set-Cookie`;
- browser memblokir third-party cookie;
- frontend dan backend memakai origin berbeda;
- redirect login membuat cookie diset di origin yang tidak diharapkan;
- service worker menyajikan response lama;
- devtools menampilkan header tapi JavaScript tidak bisa membaca header tertentu;
- user berada di browser dengan policy privacy berbeda.

Jika kita hanya hafal “cookie untuk session”, kita akan stuck. Jika kita punya model sistem, kita bisa membedahnya.

Part 000 ini dibuat untuk membangun model tersebut.

---

## 2. Sumber Kebenaran yang Akan Dipakai

Seri ini akan memisahkan antara:

1. **HTTP standard**
2. **browser behavior**
3. **JavaScript API**
4. **server/framework behavior**
5. **CDN/proxy/gateway behavior**
6. **security policy**
7. **observability evidence**

HTTP modern didefinisikan terutama melalui keluarga RFC 9110 dan turunannya. RFC 9110 mendefinisikan HTTP sebagai protokol aplikasi stateless untuk sistem informasi hypertext terdistribusi, sekaligus menetapkan arsitektur, terminologi, elemen inti protokol, mekanisme ekstensi, serta skema URI `http` dan `https`.[^rfc9110]

Dari sisi browser, Fetch Standard penting karena banyak mekanisme browser modern—termasuk `fetch()`, CORS, request/response model, redirect handling, dan network error exposure—mengikuti model fetch browser, bukan hanya “HTTP mentah”.[^fetch]

MDN menjelaskan HTTP sebagai protokol untuk fetching resource seperti dokumen HTML, dan halaman web lengkap biasanya tersusun dari banyak resource seperti teks, layout, gambar, video, script, dan resource lain.[^mdn-http-overview]

Same-origin policy adalah mekanisme security fundamental browser yang membatasi bagaimana dokumen atau script dari satu origin dapat berinteraksi dengan resource dari origin lain.[^mdn-sop]

CORS adalah mekanisme berbasis HTTP header yang memungkinkan server menyatakan origin mana yang boleh diizinkan browser untuk memuat resource cross-origin; untuk request tertentu browser juga melakukan preflight request.[^mdn-cors]

Artinya, ketika kita bicara HTTP frontend, kita tidak hanya bicara protocol spec. Kita bicara **HTTP sebagaimana dijalankan oleh browser sebagai user agent dengan policy, cache, credential store, security boundary, dan lifecycle UI**.

---

## 3. Apa yang Dimaksud “HTTP for Web/Frontend Perspective”?

HTTP dari perspektif backend biasanya bertanya:

```text
Bagaimana server menerima request?
Bagaimana route dipilih?
Bagaimana controller membaca body?
Bagaimana response dibuat?
Bagaimana status code dikembalikan?
Bagaimana API diamankan?
Bagaimana throughput dan latency server dijaga?
```

HTTP dari perspektif frontend bertanya:

```text
Kenapa browser mengirim request ini?
Kenapa header ini ada/tidak ada?
Kenapa cookie tidak terkirim?
Kenapa request kena preflight?
Kenapa response terlihat di Network tab tapi tidak bisa dibaca JavaScript?
Kenapa cache mengembalikan versi lama?
Kenapa redirect mengubah method?
Kenapa API berhasil di Postman tapi gagal di browser?
Kenapa request muncul dari <img>, <script>, <link>, service worker, bukan dari fetch?
Kenapa halaman lambat padahal endpoint cepat?
Kenapa error tidak terlihat di backend log?
```

Backend melihat HTTP sebagai **server contract**.

Frontend harus melihat HTTP sebagai **browser-mediated distributed interaction**.

Modelnya bukan:

```text
JavaScript -> HTTP -> Server
```

Model yang lebih benar:

```text
User action
  -> UI state machine
  -> JavaScript / HTML parser / CSS loader / image loader / service worker
  -> Fetch algorithm / browser resource loading pipeline
  -> browser policy checks
  -> HTTP cache
  -> cookie jar / credential mode
  -> DNS / connection / TLS / HTTP transport
  -> proxy / CDN / gateway / load balancer
  -> backend service
  -> reverse path
  -> browser policy checks again
  -> response exposure to JS or renderer
  -> UI state transition
```

Masalah frontend HTTP biasanya muncul karena engineer menghilangkan salah satu kotak di atas dari model mentalnya.

---

## 4. Prinsip Utama Seri Ini

### 4.1 Jangan Mencampur HTTP Semantic dengan Browser Policy

Contoh:

```text
HTTP server mengembalikan 200 OK.
Browser tetap memblokir response karena CORS.
```

Dari sisi HTTP, request bisa sukses.

Dari sisi JavaScript, request bisa dianggap gagal karena browser tidak mengekspos response ke script.

Jadi pertanyaan yang benar bukan hanya:

```text
Apakah server mengembalikan 200?
```

Tapi:

```text
Apakah browser mengizinkan JavaScript membaca response itu?
```

Ini perbedaan besar.

### 4.2 Browser Bukan cURL

`curl`, Postman, backend service, mobile native app, dan browser tidak punya boundary yang sama.

Browser punya:

- same-origin policy;
- CORS enforcement;
- cookie jar dengan aturan domain/path/SameSite/Secure;
- forbidden request headers;
- mixed content blocking;
- secure context requirement;
- cache partitioning;
- service worker;
- resource loading priorities;
- privacy restrictions;
- user-mediated security model.

Karena itu, kalimat berikut sering misleading:

```text
Di Postman berhasil, berarti API benar.
```

Lebih tepat:

```text
Server dapat merespons client non-browser, tapi belum tentu kontraknya valid untuk browser.
```

### 4.3 Network Tab Adalah Evidence, Bukan Kebenaran Tunggal

DevTools Network tab sangat penting, tapi harus dibaca hati-hati.

Network tab bisa menunjukkan:

- request URL;
- method;
- status;
- request headers;
- response headers;
- timing;
- initiator;
- cache source;
- cookies;
- payload;
- priority;
- protocol;
- remote address.

Tapi Network tab tidak otomatis menjawab:

- apakah JavaScript boleh membaca response header tertentu;
- apakah response body diekspos ke JS;
- apakah cookie diterima browser atau ditolak;
- apakah response berasal dari service worker;
- apakah cache behavior berbeda karena reload mode;
- apakah redirect internal disembunyikan;
- apakah request gagal sebelum mencapai server;
- apakah preflight gagal sehingga actual request tidak pernah dikirim.

Top 1% engineer tidak hanya melihat “status 200”. Mereka bertanya:

```text
200 untuk request yang mana?
Request itu diinisiasi oleh siapa?
Apakah itu preflight atau actual request?
Apakah response diekspos ke JavaScript?
Apakah cookie dikirim?
Apakah response dari network, memory cache, disk cache, atau service worker?
Apakah redirect terjadi sebelumnya?
Apakah origin berubah?
Apakah header penting disembunyikan oleh browser?
```

### 4.4 HTTP Error dan JavaScript Error Tidak Sama

Contoh dengan `fetch()`:

```js
const response = await fetch('/api/users/123');
```

Jika server mengembalikan:

```text
404 Not Found
```

`fetch()` biasanya tetap resolve menjadi `Response`. Ia tidak otomatis throw hanya karena status 404 atau 500.

Tetapi jika terjadi network-level failure, CORS blocking tertentu, DNS error, TLS error, atau abort, Promise dapat reject.

Jadi mental model yang salah:

```text
try/catch menangkap semua HTTP error.
```

Mental model yang lebih benar:

```text
try/catch menangkap kegagalan operasi fetch sebagai operasi browser, bukan semua status HTTP non-2xx.
Status HTTP harus diperiksa dari Response object.
```

### 4.5 HTTP Adalah Boundary Contract, Bukan Sekadar Transport

Dalam sistem modern, HTTP response membawa banyak keputusan:

- apakah user boleh melihat data;
- apakah data boleh di-cache;
- apakah request boleh di-retry;
- apakah response aman untuk origin tertentu;
- apakah browser boleh menjalankan script;
- apakah iframe boleh embed halaman;
- apakah resource boleh dipakai cross-origin;
- apakah cookie harus dikirim berikutnya;
- apakah UI harus menampilkan inline validation atau global error;
- apakah client harus backoff;
- apakah deployment aman untuk cache lama.

HTTP bukan hanya “cara kirim JSON”.

HTTP adalah **contract surface** antara product behavior, browser security, backend semantics, infrastructure, performance, dan observability.

---

## 5. Peta Lapisan HTTP di Web

Untuk seri ini, gunakan lapisan berikut sebagai peta berpikir.

```text
┌─────────────────────────────────────────────────────────────┐
│ User intent                                                   │
│ click, type, navigate, refresh, submit, upload, close tab      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Frontend application state                                    │
│ route, component lifecycle, query cache, form state, auth      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Browser request initiator                                     │
│ fetch, XHR, form, navigation, img, script, link, font, SW      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Browser policy layer                                          │
│ SOP, CORS, CSP, mixed content, credentials, referrer, CORP     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Browser storage/cache/credential layer                        │
│ HTTP cache, cookie jar, service worker cache, storage          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Network and transport                                         │
│ DNS, TCP, TLS, HTTP/1.1, HTTP/2, HTTP/3, QUIC                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Edge and platform infrastructure                              │
│ CDN, WAF, reverse proxy, API gateway, load balancer, ingress   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Backend application                                            │
│ routing, auth, controller, validation, domain logic, DB        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Response path                                                  │
│ status, headers, body, cache, cookies, policy, exposure, UI    │
└─────────────────────────────────────────────────────────────┘
```

Saat debugging, kita akan selalu bertanya:

```text
Di lapisan mana fakta terakhir yang pasti benar?
Di lapisan mana asumsi mulai masuk?
```

Contoh:

```text
Backend log tidak menerima request.
```

Kemungkinan:

- request tidak pernah dibuat oleh frontend;
- request dibatalkan;
- request dilayani cache;
- service worker intercept;
- preflight gagal;
- DNS/TLS gagal;
- CDN/WAF memblokir;
- request diarahkan ke environment lain;
- DevTools filter menyembunyikan request.

Contoh lain:

```text
Backend log menerima request dan mengembalikan 200.
```

Tetap mungkin frontend gagal karena:

- CORS exposure gagal;
- JSON parse gagal;
- response shape tidak sesuai kontrak;
- frontend membaca body dua kali;
- response kalah race dengan request lebih baru;
- query cache menyimpan error lama;
- UI state transition salah;
- service worker mengganti response;
- browser menolak cookie dari response.

---

## 6. Vocabulary Awal yang Harus Stabil

Bagian ini bukan definisi final. Definisi detail akan dibahas di part masing-masing. Tujuannya adalah membuat vocabulary awal supaya tidak tertukar.

### 6.1 Client

Dalam HTTP, client adalah pihak yang membuat request.

Dalam web, client bisa berarti:

- browser sebagai user agent;
- JavaScript app di dalam browser;
- service worker;
- HTML parser;
- image loader;
- CSS loader;
- test runner;
- mobile WebView;
- CDN yang melakukan revalidation ke origin;
- backend service yang memanggil service lain.

Dalam seri ini, jika disebut “frontend client”, maksud utamanya adalah:

```text
browser + JavaScript application + browser resource loading system
```

Bukan hanya kode JavaScript.

### 6.2 User Agent

User agent adalah software yang bertindak atas nama user. Browser adalah user agent utama dalam seri ini.

Browser bukan client pasif. Browser membuat keputusan:

- header apa yang ditambahkan;
- header apa yang dilarang;
- cookie apa yang dikirim;
- response apa yang boleh dibaca script;
- resource mana yang diprioritaskan;
- request mana yang di-cache;
- apakah request perlu preflight;
- apakah mixed content diblokir;
- apakah halaman berada di secure context.

### 6.3 Origin

Origin secara praktis adalah kombinasi:

```text
scheme + host + port
```

Contoh:

```text
https://app.example.com
```

Origin berbeda dari:

```text
https://api.example.com
http://app.example.com
https://app.example.com:8443
```

Perbedaan origin sangat penting untuk:

- CORS;
- same-origin policy;
- cookies;
- storage;
- iframe;
- service worker;
- resource sharing.

### 6.4 Site

Site tidak selalu sama dengan origin.

Secara kasar, site berkaitan dengan registrable domain dan scheme. Ini penting untuk SameSite cookie dan beberapa privacy/security model browser.

Contoh:

```text
https://app.example.com
https://api.example.com
```

Keduanya beda origin, tetapi bisa dianggap same-site dalam konteks tertentu.

Detailnya akan dibahas di Part 002 dan cookie/CORS parts.

### 6.5 Resource

Resource adalah target konseptual dari request.

Contoh resource:

```text
/users/123
/orders/2026-001
/assets/app.8f3a.js
/index.html
/avatar.png
```

Resource bukan selalu file fisik. Resource bisa berupa hasil komputasi dinamis dari backend.

### 6.6 Representation

Representation adalah bentuk data yang dikirim untuk mewakili resource pada waktu tertentu.

Contoh resource yang sama bisa punya representation berbeda:

```text
/users/123 as application/json
/users/123 as text/html
/users/123?lang=id
/users/123?fields=id,name
```

HTTP caching dan content negotiation banyak berurusan dengan representation, bukan hanya resource.

### 6.7 Request

Request adalah pesan dari client ke server yang membawa:

- method;
- target URL/path;
- headers;
- optional body.

Dalam browser, request juga punya metadata internal:

- mode;
- credentials mode;
- cache mode;
- redirect mode;
- referrer policy;
- destination;
- priority;
- initiator;
- client context.

Metadata internal ini tidak selalu terlihat sebagai HTTP header, tapi memengaruhi perilaku browser.

### 6.8 Response

Response adalah pesan dari server ke client yang membawa:

- status code;
- headers;
- optional body.

Dalam browser, response juga bisa memiliki exposure rule:

- apakah body boleh dibaca JavaScript;
- apakah header tertentu bisa dibaca JavaScript;
- apakah response dianggap opaque;
- apakah response berasal dari cache;
- apakah response hasil redirect;
- apakah response disaring oleh CORS.

### 6.9 Header

Header adalah metadata. Dalam praktik, header adalah control plane HTTP.

Header dapat mengontrol:

- content type;
- caching;
- compression;
- authentication;
- authorization context;
- cookies;
- CORS;
- security policy;
- redirects;
- rate limits;
- tracing;
- feature policy;
- browser isolation.

Jangan anggap header sebagai “tambahan kecil”. Banyak bug produksi justru bug header.

### 6.10 Body

Body adalah payload. Bisa berupa:

- JSON;
- HTML;
- text;
- form data;
- multipart upload;
- binary;
- stream;
- empty body.

Kesalahan umum frontend:

- mengasumsikan semua response punya JSON body;
- melakukan `response.json()` pada 204;
- membaca body dua kali;
- salah `Content-Type`;
- mengirim JSON tapi lupa `JSON.stringify`;
- mengirim `FormData` tapi manual set boundary yang salah;
- mengabaikan ukuran payload.

### 6.11 Credentials

Dalam browser, credentials biasanya mencakup:

- cookies;
- HTTP authentication entries;
- client certificates.

Untuk JavaScript `fetch()`, credentials behavior dikontrol melalui `credentials` option:

```js
fetch(url, { credentials: 'include' })
```

Tapi pengiriman cookie tetap harus lolos aturan browser seperti domain, path, Secure, SameSite, dan policy privacy.

### 6.12 Cache

Cache bukan satu hal.

Di browser/frontend, bisa ada:

- HTTP memory cache;
- HTTP disk cache;
- preload cache;
- service worker cache;
- application query cache;
- CDN cache;
- backend cache;
- database cache.

Saat seseorang berkata:

```text
Ini kena cache.
```

Pertanyaan lanjutannya:

```text
Cache yang mana?
Key-nya apa?
Fresh atau stale?
Siapa yang boleh menyimpan?
Bagaimana invalidasinya?
Bagaimana revalidation-nya?
Apakah user-specific?
```

### 6.13 Network Error

Dalam browser, “network error” tidak selalu berarti kabel internet putus.

Bisa berarti:

- DNS gagal;
- TLS gagal;
- koneksi ditolak;
- request diblokir policy;
- CORS gagal;
- mixed content blocked;
- abort;
- browser tidak mengekspos detail karena security reason.

Ini penting karena browser sengaja menyembunyikan beberapa detail error untuk mencegah information leakage.

---

## 7. Mental Model: Request Bukan Selalu Berasal dari Kode Anda

Java engineer yang masuk frontend sering berpikir:

```text
Request terjadi ketika kode memanggil fetch/axios.
```

Di browser, ini tidak cukup.

Request bisa terjadi karena:

```html
<img src="/logo.png" />
<script src="/app.js"></script>
<link rel="stylesheet" href="/style.css" />
<link rel="preload" href="/font.woff2" as="font" />
<iframe src="https://example.com"></iframe>
<form action="/submit" method="post"></form>
```

Request juga bisa terjadi karena:

```js
fetch('/api/data')
new XMLHttpRequest()
navigator.sendBeacon('/analytics', data)
new EventSource('/events')
new WebSocket('wss://example.com/socket')
```

Dan bisa terjadi karena browser/app lifecycle:

- route navigation;
- speculative preload;
- module graph import;
- CSS importing font/image;
- service worker update check;
- favicon request;
- manifest request;
- source map request;
- browser extension;
- devtools;
- prefetch/prerender;
- reload;
- back/forward cache restore.

Karena itu, saat melihat request asing di Network tab, jangan langsung menyimpulkan bug. Tanya:

```text
Initiator-nya siapa?
Destination-nya apa?
Request ini untuk render, data, navigation, analytics, atau browser internal?
```

---

## 8. Mental Model: Response Bukan Selalu Bisa Dibaca JavaScript

Server bisa mengirim response lengkap.

Browser bisa menerima response lengkap.

Tapi JavaScript belum tentu bisa membaca response itu.

Contoh penyebab:

- CORS tidak mengizinkan origin;
- response opaque karena `no-cors`;
- header tidak masuk `Access-Control-Expose-Headers`;
- redirect chain cross-origin;
- mixed content blocked;
- CSP membatasi koneksi;
- CORP/COEP/COOP policy;
- resource dimuat sebagai image/script/font, bukan fetch data;
- response digunakan renderer, bukan diekspos ke JS.

Jadi debugging harus membedakan:

```text
Did server send it?
Did browser receive it?
Did browser accept it?
Did browser expose it to JavaScript?
Did app parse it correctly?
Did UI state consume it correctly?
```

Ini lima pertanyaan berbeda.

---

## 9. Mental Model: HTTP Sukses Belum Tentu Product Sukses

HTTP `200 OK` hanya mengatakan request HTTP berhasil menurut server untuk method/resource tersebut.

Tapi product flow bisa gagal.

Contoh:

```json
{
  "status": "FAILED",
  "reason": "PAYMENT_REJECTED"
}
```

Dengan HTTP:

```text
200 OK
```

Apakah ini salah?

Tergantung. Jika request-nya adalah:

```text
GET /payments/123/status
```

Maka `200 OK` dengan domain status `FAILED` masuk akal.

Tapi jika request-nya:

```text
POST /payments
```

Dan pembayaran gagal divalidasi karena kartu invalid, mungkin `422 Unprocessable Content` atau `400 Bad Request` lebih tepat tergantung kontrak.

Jika gateway down, `502`/`503`/`504` lebih tepat.

Prinsipnya:

```text
HTTP status menjelaskan outcome interaksi HTTP terhadap resource.
Domain status menjelaskan state bisnis di dalam representation.
```

Jangan mencampur keduanya secara sembrono.

---

## 10. Mental Model: Browser HTTP adalah Sistem State Machine

Frontend sering gagal bukan karena satu request, tapi karena transisi state yang tidak lengkap.

Contoh login:

```text
ANONYMOUS
  -> submit credentials
  -> LOGIN_PENDING
  -> login response received
  -> cookie accepted?
  -> profile request sent with cookie?
  -> profile response 200?
  -> AUTHENTICATED
```

Ada banyak failure transition:

```text
LOGIN_PENDING
  -> network error
  -> show retry

LOGIN_PENDING
  -> 401
  -> show invalid credentials

LOGIN_PENDING
  -> 200 but cookie rejected
  -> inconsistent state

LOGIN_PENDING
  -> 200 but profile 401
  -> session establishment failed

AUTHENTICATED
  -> API 401
  -> refresh session?
  -> logout?
  -> retry original request?
```

Kalau Anda hanya melihat endpoint login, Anda akan kehilangan sistem sebenarnya.

Top 1% frontend HTTP reasoning selalu menghubungkan:

```text
protocol outcome -> browser behavior -> app state transition -> user-visible behavior
```

---

## 11. Mental Model: Performance Bukan Hanya Endpoint Cepat

Backend engineer sering mengukur:

```text
Endpoint latency: 80 ms.
```

User merasakan:

```text
Halaman selesai dipakai: 3.5 detik.
```

Kenapa bisa berbeda?

Karena browser harus melakukan:

- DNS lookup;
- TCP/TLS handshake;
- HTTP negotiation;
- HTML download;
- parse HTML;
- discover CSS/JS/image/font;
- download critical resources;
- execute JavaScript;
- hydrate app;
- call API;
- parse JSON;
- render UI;
- load images/fonts;
- handle main thread blocking;
- wait for third-party scripts.

Satu endpoint cepat tidak menjamin halaman cepat.

Pertanyaan frontend performance yang benar:

```text
Request mana yang berada di critical path?
Request mana yang blocking render?
Request mana yang bisa di-cache?
Request mana yang sequential padahal bisa parallel?
Request mana yang low value tapi high cost?
Request mana yang memicu preflight tambahan?
Request mana yang memakai origin baru sehingga butuh koneksi baru?
```

---

## 12. Mental Model: Security adalah Browser-Server Cooperation

Security web modern bukan hanya backend auth.

Backend bisa melakukan:

- authentication;
- authorization;
- session management;
- CSRF token validation;
- rate limiting;
- input validation;
- audit logging.

Browser/server policy bisa melakukan:

- CORS;
- SameSite cookie;
- Secure cookie;
- HttpOnly cookie;
- CSP;
- HSTS;
- Referrer-Policy;
- Permissions-Policy;
- CORP/COEP/COOP;
- mixed content blocking;
- secure context enforcement.

Frontend code bisa melakukan:

- safe token storage decisions;
- correct credentials mode;
- careful redirect handling;
- safe DOM rendering;
- avoiding leaking secrets in URL;
- avoiding sensitive data in localStorage when inappropriate;
- robust logout/session state handling.

Security failure sering terjadi saat satu tim mengira tim lain sudah menutup celah.

Contoh:

```text
Backend: “Kami sudah pakai HttpOnly cookie.”
Frontend: “Berarti aman dari semua serangan.”
```

Tidak benar. HttpOnly membantu mengurangi risiko pencurian cookie via JavaScript, tapi tidak otomatis menyelesaikan CSRF, session fixation, CORS misconfig, XSS impact lain, atau privilege confusion.

---

## 13. Invariant yang Akan Dipakai Sepanjang Seri

Invariant adalah aturan mental yang stabil. Saat bingung, kembali ke invariant.

### Invariant 1 — URL Menentukan Target Resource

```text
scheme://host:port/path?query#fragment
```

Tapi fragment tidak dikirim ke server.

### Invariant 2 — Method Menyatakan Intent Protokol

`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `HEAD` punya semantics. Framework boleh fleksibel, tapi browser/cache/proxy/security tooling sering mengasumsikan semantics HTTP.

### Invariant 3 — Status Code Menyatakan Outcome Interaksi HTTP

Status code bukan tempat utama domain state yang kompleks, tapi status code harus cukup benar agar client, cache, proxy, retry logic, monitoring, dan manusia bisa mengambil keputusan.

### Invariant 4 — Header adalah Metadata dan Policy Surface

Banyak behavior browser dikontrol header. Salah satu header bisa mengubah security, cache, credential, atau rendering behavior.

### Invariant 5 — Body adalah Representation, Bukan Selalu State Final

Response body merepresentasikan sesuatu pada waktu tertentu. Bisa stale, partial, localized, personalized, filtered, atau variant.

### Invariant 6 — Browser Bisa Menolak atau Menyaring Response

Server success tidak menjamin JavaScript visibility.

### Invariant 7 — Cookie adalah Ambient Credential

Cookie dikirim otomatis jika rule cocok. Ini powerful tapi berisiko karena bisa ikut request tanpa explicit code.

### Invariant 8 — Cache adalah Correctness Boundary

Caching bukan hanya performance. Cache bisa membuat user melihat data salah, script lama, auth state lama, atau response personalized milik orang lain jika salah desain.

### Invariant 9 — Retry Hanya Aman Jika Operation Aman untuk Diulang

Network failure tidak memberi tahu apakah server sudah memproses mutation. Karena itu idempotency penting.

### Invariant 10 — Observability Harus Melintasi Boundary

Frontend issue sering tidak cukup diselesaikan dengan backend log. Butuh correlation ID, trace, Network tab, RUM, server logs, CDN logs, dan sometimes HAR.

---

## 14. Cara Membaca Masalah HTTP dengan Framework Diagnosis

Gunakan template ini sepanjang seri.

### Step 1 — Apa Gejala User?

Jangan mulai dari header. Mulai dari user-visible behavior.

```text
User klik Save, spinner tidak berhenti.
```

Atau:

```text
User login, diarahkan ke dashboard, lalu kembali ke login.
```

### Step 2 — Request Apa yang Seharusnya Terjadi?

Tulis expected interaction.

```text
POST /api/login
GET /api/me
GET /api/dashboard-summary
```

### Step 3 — Request Apa yang Benar-Benar Terjadi?

Buka Network tab.

Periksa:

- URL;
- method;
- status;
- initiator;
- request headers;
- response headers;
- payload;
- cookies;
- timing;
- protocol;
- cache source;
- redirect;
- preflight;
- service worker.

### Step 4 — Apakah Request Mencapai Server?

Jika tidak:

- frontend tidak membuat request;
- request dibatalkan;
- CORS preflight gagal;
- browser policy blocked;
- service worker intercept;
- cache hit;
- DNS/TLS/network error;
- request ke origin yang salah.

### Step 5 — Apakah Server Mengembalikan Response yang Tepat?

Periksa:

- status code;
- body shape;
- error envelope;
- content type;
- cache headers;
- CORS headers;
- Set-Cookie;
- security headers;
- correlation ID.

### Step 6 — Apakah Browser Menerima dan Mengekspos Response?

Periksa:

- CORS result;
- exposed headers;
- cookie accepted/rejected;
- response type;
- redirect mode;
- credentials mode;
- CSP/mixed content/CORP/COEP.

### Step 7 — Apakah App Mengonsumsi Response dengan Benar?

Periksa:

- JSON parsing;
- non-2xx handling;
- retry;
- abort;
- stale response race;
- query cache;
- mutation state;
- optimistic update rollback;
- UI error mapping.

### Step 8 — Apa Prevention Invariant-nya?

Setiap incident harus menghasilkan aturan pencegahan.

Contoh:

```text
Semua endpoint credentialed cross-origin harus punya test untuk:
- Access-Control-Allow-Origin exact origin, bukan *
- Access-Control-Allow-Credentials true
- Vary: Origin
- fetch credentials include
- SameSite=None; Secure untuk third-party context
```

---

## 15. Skill yang Ingin Dibentuk

Seri ini tidak hanya mengajarkan “apa itu header X”.

Seri ini membentuk beberapa skill.

### 15.1 Protocol Literacy

Anda bisa membaca request/response mentah dan memahami konsekuensinya.

Contoh:

```http
HTTP/1.1 204 No Content
Content-Type: application/json
```

Anda langsung curiga:

```text
204 seharusnya tidak membawa body. Jika frontend tetap memanggil response.json(), bisa error.
Content-Type pada 204 mungkin tidak berguna atau membingungkan.
```

### 15.2 Browser Policy Literacy

Anda bisa membedakan:

```text
Server tidak mengirim response.
```

vs

```text
Browser tidak mengekspos response.
```

### 15.3 API Contract Design

Anda bisa mendesain API yang nyaman untuk UI:

- status code tepat;
- error body stabil;
- pagination jelas;
- idempotency untuk mutation;
- cache policy eksplisit;
- correlation ID tersedia;
- retry behavior jelas;
- partial failure terdefinisi.

### 15.4 Debugging Discipline

Anda tidak langsung menebak. Anda mengumpulkan evidence:

- Network tab;
- console;
- application/cookie/storage panel;
- server log;
- CDN log;
- HAR;
- trace ID;
- reproduction matrix.

### 15.5 Failure Modelling

Anda bisa bertanya:

```text
Apa yang terjadi jika user double click?
Apa yang terjadi jika tab ditutup saat request berjalan?
Apa yang terjadi jika response datang terbalik?
Apa yang terjadi jika token expired di tengah batch request?
Apa yang terjadi jika retry terjadi setelah server memproses mutation?
Apa yang terjadi jika CDN menyimpan response personalized?
```

### 15.6 Cross-Team Translation

Anda bisa menerjemahkan masalah antar tim.

Untuk backend:

```text
Endpoint ini mengembalikan 200 dengan error domain, sehingga frontend tidak bisa membedakan retryable server failure dari validation failure secara generik.
```

Untuk security:

```text
Credentialed cross-origin flow ini membutuhkan exact ACAO, ACAC true, Vary Origin, dan SameSite cookie yang sesuai. Wildcard origin tidak valid untuk skenario ini.
```

Untuk infra:

```text
CDN meng-cache HTML terlalu lama, sehingga user mendapat app shell lama yang mereferensikan chunk yang sudah tidak tersedia.
```

Untuk product:

```text
Save operation tidak idempotent, jadi retry otomatis bisa membuat duplikasi. Kita perlu idempotency key atau UI harus mencegah retry mutation tertentu.
```

---

## 16. Setup Lab yang Direkomendasikan

Agar seri ini bukan teori, siapkan lab sederhana.

### 16.1 Tools Minimal

```text
Browser modern:
- Chrome / Chromium
- Firefox
- Safari jika tersedia

CLI:
- curl
- jq
- node
- npm/pnpm
- openssl optional

Frontend dev:
- Vite atau dev server sederhana

Backend dev:
- Java Spring Boot atau Node/Express kecil

Proxy optional:
- nginx
- Caddy
- mitmproxy optional
```

Karena Anda Java engineer, Spring Boot cocok untuk melihat sisi server. Tapi beberapa eksperimen frontend lebih cepat dengan Node server kecil. Seri ini akan menjelaskan konsep lintas stack.

### 16.2 Struktur Lab

Gunakan beberapa origin lokal:

```text
http://localhost:3000        frontend app
http://localhost:8080        backend API
http://127.0.0.1:8080        backend API dengan host berbeda
https://localhost:8443       HTTPS backend lokal
http://api.localhost:8080    subdomain lokal jika dikonfigurasi
```

Kenapa banyak origin?

Karena bug browser HTTP sering hanya muncul saat origin/site/scheme/port berubah.

### 16.3 DevTools Panels yang Akan Sering Dipakai

```text
Network
Application -> Cookies
Application -> Storage
Application -> Service Workers
Security
Console
Performance
Lighthouse / Performance Insights optional
```

### 16.4 Minimal Backend Endpoint untuk Eksperimen

Nanti kita akan membuat endpoint seperti:

```text
GET    /api/hello
GET    /api/me
POST   /api/login
POST   /api/logout
GET    /api/cache/public
GET    /api/cache/private
GET    /api/cache/etag
POST   /api/orders
PUT    /api/profile
PATCH  /api/profile
DELETE /api/items/{id}
OPTIONS /api/*
GET    /api/stream
GET    /api/events
```

Endpoint ini bukan untuk “membuat app”, tapi untuk mengamati behavior HTTP/browser.

---

## 17. Cara Belajar Setiap Part

Untuk setiap part, gunakan pola ini.

### 17.1 Baca Konsep

Pahami modelnya dulu.

Jangan langsung hafal header.

### 17.2 Lihat Request/Response Mentah

Untuk setiap konsep, cari bentuk mentahnya.

Contoh:

```http
GET /api/me HTTP/1.1
Host: api.example.com
Origin: https://app.example.com
Cookie: sid=abc
Accept: application/json
```

### 17.3 Jalankan di Browser

Konsep browser harus dites di browser, bukan hanya Postman.

### 17.4 Bandingkan dengan curl/Postman

Jika browser gagal tapi curl sukses, itu sinyal bahwa policy browser terlibat.

### 17.5 Ubah Satu Variabel

Debugging HTTP harus terkontrol.

Ubah satu hal:

- origin;
- method;
- header;
- credentials mode;
- cache header;
- cookie attribute;
- redirect status;
- content type.

Lihat efeknya.

### 17.6 Catat Invariant

Setiap part harus menghasilkan beberapa invariant praktis.

Contoh:

```text
Custom Authorization header pada cross-origin request biasanya membuat request tidak simple dan memicu preflight.
```

---

## 18. Anti-Pattern Cara Belajar HTTP

### 18.1 Menghafal Status Code Tanpa Semantics

Tidak cukup tahu:

```text
409 = conflict
```

Harus tahu:

```text
Conflict terhadap state resource apa?
Bisakah user resolve?
Apakah retry berguna?
Apakah perlu refetch?
Apakah UI harus merge conflict?
```

### 18.2 Menganggap CORS sebagai Backend Security

CORS melindungi browser user dari script origin lain yang membaca response tanpa izin. CORS bukan firewall untuk mencegah server-to-server request.

### 18.3 Menganggap Cookie Selalu Dikirim

Cookie hanya dikirim jika rule cocok.

Rule-nya melibatkan:

- domain;
- path;
- scheme;
- Secure;
- SameSite;
- credentials mode;
- browser privacy policy;
- third-party context;
- expiry;
- user settings.

### 18.4 Menganggap Cache Selalu Baik

Cache salah bisa lebih buruk daripada tidak ada cache.

Contoh fatal:

```text
CDN menyimpan response /api/me milik user A lalu mengembalikannya ke user B.
```

### 18.5 Menganggap Retry Selalu Membantu

Retry mutation tanpa idempotency bisa menduplikasi order, pembayaran, pesan, atau workflow action.

### 18.6 Menganggap Axios/fetch Library Menyelesaikan HTTP

Library bisa membantu ergonomics. Tapi browser tetap menjalankan policy. Library tidak bisa bypass CORS, SameSite, mixed content, atau forbidden headers.

### 18.7 Menganggap “Works on Localhost” Valid untuk Production

Localhost sering berbeda dalam:

- scheme;
- secure context behavior;
- cookie Secure behavior;
- domain;
- port;
- proxy;
- CORS;
- cache;
- CDN;
- TLS;
- browser privacy policy.

---

## 19. Beberapa Problem Klasik yang Akan Kita Kuasai

### 19.1 “CORS Error”

Kita akan pecah menjadi:

```text
Apakah preflight terjadi?
Apakah preflight sukses?
Apakah actual request dikirim?
Apakah ACAO cocok?
Apakah credentialed request?
Apakah ACAC ada?
Apakah custom header diizinkan?
Apakah method diizinkan?
Apakah response header perlu diekspos?
Apakah CDN meng-cache CORS response salah origin?
```

### 19.2 “Cookie Tidak Terkirim”

Kita akan pecah menjadi:

```text
Apakah cookie tersimpan?
Apakah cookie ditolak saat Set-Cookie?
Apakah domain match?
Apakah path match?
Apakah Secure cocok?
Apakah SameSite cocok?
Apakah request same-site atau cross-site?
Apakah fetch credentials mode benar?
Apakah browser memblokir third-party cookie?
Apakah redirect mengubah context?
```

### 19.3 “API Lambat”

Kita akan pecah menjadi:

```text
DNS berapa lama?
Connect berapa lama?
TLS berapa lama?
TTFB berapa lama?
Content download berapa lama?
Request blocked/queued?
Preflight tambahan?
Origin terlalu banyak?
Payload terlalu besar?
Sequential dependency?
Main thread blocked?
Cache miss?
CDN miss?
```

### 19.4 “Data Lama Muncul”

Kita akan pecah menjadi:

```text
HTTP cache?
Service worker cache?
CDN cache?
Application query cache?
Backend cache?
Race condition?
Stale response wins?
Optimistic update tidak rollback?
ETag/revalidation salah?
```

### 19.5 “Redirect Aneh”

Kita akan pecah menjadi:

```text
301/302/303/307/308?
Method berubah?
Body hilang?
Cross-origin redirect?
Credential ikut?
CORS setelah redirect?
Fetch redirect mode?
OAuth flow?
Open redirect risk?
```

---

## 20. Apa yang Tidak Akan Kita Ulang dari Seri Git

Karena Anda sudah punya seri `learn-git-mastery-for-java-engineers`, kita tidak akan mengulang:

- Git branching;
- commit style;
- merge/rebase;
- release tagging;
- repository hygiene;
- code review workflow secara umum;
- semantic versioning dari sisi Git;
- CI/CD source control flow.

Namun kita akan menyentuh deployment jika relevan dengan HTTP, misalnya:

- hashed static assets;
- HTML cache policy;
- old chunk 404;
- CDN invalidation;
- service worker update;
- rollback yang aman terhadap browser cache.

Fokusnya tetap HTTP/browser, bukan Git workflow.

---

## 21. Outcome yang Diharapkan Setelah Part 000

Setelah menyelesaikan Part 000, Anda seharusnya punya model awal:

```text
HTTP frontend = protocol semantics
              + browser policy
              + resource loading
              + credentials/cookies
              + cache layers
              + security headers
              + transport behavior
              + infrastructure mutation
              + app state machine
              + user experience
              + observability
```

Anda juga seharusnya mulai tidak puas dengan jawaban dangkal seperti:

```text
CORS tinggal allow all.
Cache tinggal no-cache.
Cookie tinggal set domain.
Fetch tinggal try/catch.
Status code terserah yang penting body jelas.
```

Jawaban top-tier selalu menghubungkan konsekuensi:

```text
Jika kita memilih header/method/status/policy ini,
apa efeknya pada browser,
cache,
security,
retry,
observability,
UX,
dan operasi produksi?
```

---

## 22. Checklist Fondasi Sebelum Lanjut

Pastikan Anda bisa menjawab ini secara konseptual sebelum masuk Part 001.

### 22.1 Browser vs Non-Browser

- Kenapa request yang sukses di Postman bisa gagal di browser?
- Apa perbedaan server menerima response dengan JavaScript bisa membaca response?
- Kenapa browser menambahkan/melarang header tertentu?

### 22.2 Origin dan Policy

- Apa bedanya origin dan site secara kasar?
- Kenapa `localhost`, `127.0.0.1`, dan subdomain bisa berperilaku berbeda?
- Kenapa same-origin policy ada?

### 22.3 Cookies dan Credentials

- Kenapa cookie disebut ambient credential?
- Kenapa cookie tidak selalu dikirim walaupun tersimpan?
- Kenapa `fetch()` credentials mode penting?

### 22.4 Cache

- Cache yang mana: browser HTTP cache, service worker cache, CDN cache, atau app query cache?
- Apa risiko cache untuk personalized response?
- Kenapa cache adalah correctness boundary?

### 22.5 Debugging

- Apa request yang diharapkan?
- Apa request yang benar-benar terjadi?
- Apakah request mencapai server?
- Apakah response diekspos ke JS?
- Apakah app state transition benar?

Jika pertanyaan-pertanyaan ini mulai terasa natural, Anda siap lanjut.

---

## 23. Latihan Awal

Latihan ini tidak perlu kode besar. Tujuannya melatih observasi.

### Latihan 1 — Bandingkan Browser dan curl

Buat endpoint sederhana:

```text
GET /api/hello
```

Response:

```json
{
  "message": "hello"
}
```

Panggil dari:

```bash
curl -i http://localhost:8080/api/hello
```

Lalu panggil dari browser frontend:

```js
fetch('http://localhost:8080/api/hello')
  .then(r => r.json())
  .then(console.log)
  .catch(console.error)
```

Amati:

- apakah request terkirim;
- apakah ada `Origin` header;
- apakah CORS error;
- apakah response visible di Network;
- apakah JavaScript bisa membaca body.

### Latihan 2 — Ubah Host

Bandingkan:

```text
http://localhost:8080/api/hello
http://127.0.0.1:8080/api/hello
```

Lihat apakah browser menganggap origin berbeda.

### Latihan 3 — Tambahkan Custom Header

```js
fetch('http://localhost:8080/api/hello', {
  headers: {
    'X-Debug': 'true'
  }
})
```

Amati apakah preflight muncul.

### Latihan 4 — Tambahkan Cookie

Backend mengirim:

```http
Set-Cookie: sid=abc; Path=/; HttpOnly
```

Amati:

- apakah cookie tersimpan;
- apakah cookie dikirim request berikutnya;
- apa yang berubah jika pakai `credentials: "include"`;
- apa yang berubah jika origin berbeda.

### Latihan 5 — Cache Sederhana

Backend mengirim:

```http
Cache-Control: max-age=60
```

Refresh halaman dan amati apakah request benar-benar ke network atau dari cache.

---

## 24. Preview Part 001

Part 001 akan mulai membahas HTTP dari sudut pandang browser secara lebih sistematis.

Topik utama:

- browser sebagai HTTP client kompleks;
- request bukan hanya `fetch()`;
- perbedaan HTTP protocol, browser policy, JavaScript API, dan network transport;
- cara membaca DevTools Network;
- peta besar request lifecycle;
- mengapa CORS/cookies/cache sering disalahpahami oleh backend engineer;
- invariant pertama untuk membaca HTTP browser.

---

## 25. Ringkasan Part 000

HTTP dari perspektif frontend bukan sekadar:

```text
JavaScript kirim request ke server lalu menerima JSON.
```

Model yang lebih benar:

```text
Browser menjalankan request melalui protocol semantics, security policy, credentials, cache, transport, infrastructure, dan app state machine sebelum user melihat hasil.
```

Untuk menjadi sangat kuat di area ini, Anda harus bisa membedakan:

- HTTP success vs browser exposure success;
- server behavior vs browser policy;
- cookie stored vs cookie sent;
- response visible in Network vs readable by JS;
- cache hit browser vs cache hit CDN vs query cache;
- network failure vs HTTP non-2xx;
- protocol error vs product state;
- endpoint latency vs user-perceived performance.

Fondasi ini akan dipakai terus sampai Part 035.

---

## References

[^rfc9110]: RFC Editor, **RFC 9110: HTTP Semantics**, defines HTTP architecture, terminology, common protocol elements, extensibility mechanisms, and `http`/`https` URI schemes. https://www.rfc-editor.org/rfc/rfc9110.html

[^fetch]: WHATWG, **Fetch Standard**, defines requests, responses, and the fetching process used by browser APIs and resource loading. https://fetch.spec.whatwg.org/

[^mdn-http-overview]: MDN Web Docs, **Overview of HTTP**, describes HTTP as the Web’s resource-fetching protocol and explains that a complete document is composed from multiple resources. https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview

[^mdn-sop]: MDN Web Docs, **Same-origin policy**, describes same-origin policy as a critical security mechanism restricting how documents or scripts from one origin interact with resources from another origin. https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy

[^mdn-cors]: MDN Web Docs, **Cross-Origin Resource Sharing (CORS)**, describes CORS as an HTTP-header-based mechanism for permitting cross-origin resource loading, including preflight behavior for certain requests. https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS

---

## Status Akhir Part

```text
Part 000 selesai.
Seri belum selesai.
Lanjut ke Part 001: Orientation: HTTP dari Sudut Pandang Browser.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-001.md">Part 001 — Orientation: HTTP dari Sudut Pandang Browser ➡️</a>
</div>

# learn-http-for-web-frontend-perspective-part-003.md

# Part 003 — HTTP Message Model: Request, Response, Header, Body

> Seri: `learn-http-for-web-frontend-perspective`  
> Perspektif: Java Software Engineer yang ingin menguasai HTTP dari sisi browser/frontend  
> Level: Fondasi konseptual + diagnosis produksi  
> Status: Part 003 dari 035 — seri belum selesai

---

## 0. Tujuan Bagian Ini

Pada Part 000 kita membangun fondasi cara belajar HTTP secara sistemik. Pada Part 001 kita melihat browser sebagai HTTP client yang kompleks. Pada Part 002 kita membedah URL, origin, site, scheme, host, port, path, query, dan fragment.

Sekarang kita masuk ke unit paling fundamental HTTP: **message**.

HTTP pada level semantik adalah pertukaran pesan:

```text
Client  -- request  -->  Server
Client  <-- response --  Server
```

Dari sisi browser/frontend, pemahaman ini sangat penting karena hampir semua bug produksi yang terlihat sebagai “frontend error” sebenarnya berasal dari salah satu bagian pesan HTTP:

- URL salah
- method salah
- header tidak terkirim
- header tidak boleh dikontrol JavaScript
- body tidak sesuai `Content-Type`
- response status tidak sesuai semantik
- response body tidak bisa dibaca
- response header ada di Network tab tapi tidak bisa diakses JS
- browser memblokir response karena policy layer seperti CORS
- cache membaca metadata secara berbeda dari ekspektasi aplikasi

Part ini bertujuan membuat Anda bisa melihat request/response bukan sebagai “call API”, tetapi sebagai **kontrak pesan lintas boundary**.

---

## 1. Referensi Standar yang Dipakai

Bagian ini mengikuti model HTTP modern dari:

- RFC 9110 — HTTP Semantics
- MDN Web Docs — HTTP messages dan headers
- WHATWG Fetch Standard — perilaku browser-level untuk request/response, header guard, forbidden headers, body stream, dan fetch pipeline

RFC 9110 mendefinisikan semantik HTTP yang berlaku lintas versi HTTP, termasuk HTTP/1.1, HTTP/2, dan HTTP/3. Jadi ketika kita bicara method, status, field/header, representation, content, dan semantics, kita tidak sedang bicara hanya format wire HTTP/1.1, tetapi konsep yang tetap berlaku meskipun transport-nya berbeda.

Referensi:

- RFC 9110 — HTTP Semantics: <https://www.rfc-editor.org/rfc/rfc9110.html>
- MDN — HTTP messages: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Messages>
- MDN — HTTP headers: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers>
- WHATWG Fetch Standard: <https://fetch.spec.whatwg.org/>

---

## 2. Mental Model Utama: HTTP Message Adalah Envelope + Metadata + Representation

Sebuah HTTP message dapat dipikirkan sebagai amplop terstruktur:

```text
HTTP Message
├── Control line / pseudo metadata
├── Header fields
├── Empty separator
└── Optional content/body
```

Untuk request:

```http
POST /orders HTTP/1.1
Host: api.example.com
Accept: application/json
Content-Type: application/json
Authorization: Bearer eyJ...

{
  "sku": "BOOK-001",
  "quantity": 2
}
```

Untuk response:

```http
HTTP/1.1 201 Created
Content-Type: application/json
Location: /orders/ord_123
Cache-Control: no-store

{
  "id": "ord_123",
  "status": "created"
}
```

Secara konseptual:

| Bagian | Fungsi | Contoh |
|---|---|---|
| Method | Intent request | `GET`, `POST`, `PUT`, `DELETE` |
| Target | Resource yang dituju | `/orders/123` |
| Status | Outcome response | `200`, `201`, `404`, `409`, `500` |
| Header | Metadata/control plane | `Content-Type`, `Accept`, `Cache-Control`, `Origin` |
| Body/content | Data/representasi | JSON, HTML, file, stream |

Top 1% engineer tidak hanya bertanya:

> “API ini return apa?”

Mereka bertanya:

> “Apa semantik method-nya, metadata apa yang mengontrol policy, body ini representasi apa, status-nya memberi sinyal apa, dan browser akan mengizinkan JavaScript membaca bagian mana?”

---

## 3. Request Message: Bukan Sekadar URL + JSON

Request message adalah pesan dari client ke server untuk meminta server melakukan sesuatu terhadap resource.

Struktur konseptual request:

```text
Request
├── Method
├── Request target / URL
├── HTTP version / transport-specific mapping
├── Headers
└── Optional body/content
```

Contoh request dari browser:

```http
GET /api/profile HTTP/1.1
Host: app.example.com
Accept: application/json
Accept-Encoding: gzip, deflate, br
Accept-Language: en-US,en;q=0.9,id;q=0.8
Cookie: session=abc123
Sec-Fetch-Site: same-origin
Sec-Fetch-Mode: cors
Sec-Fetch-Dest: empty
User-Agent: Mozilla/5.0 ...
```

Dari JavaScript, Anda mungkin hanya menulis:

```js
const response = await fetch('/api/profile', {
  headers: {
    Accept: 'application/json'
  }
});
```

Tetapi browser mengirim jauh lebih banyak metadata daripada yang Anda tulis.

Inilah salah satu perbedaan besar antara:

```text
JavaScript code you wrote
```

versus

```text
HTTP request the browser actually sends
```

---

## 4. Response Message: Bukan Sekadar Body

Response message adalah jawaban server terhadap request.

Struktur konseptual response:

```text
Response
├── Status code
├── Reason phrase / transport-specific metadata
├── Headers
└── Optional body/content
```

Contoh response:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: private, max-age=60
ETag: "profile-v12"
Set-Cookie: session=abc123; HttpOnly; Secure; SameSite=Lax
Server-Timing: db;dur=18, app;dur=42

{
  "id": "u_123",
  "name": "Ayu"
}
```

Frontend yang tidak matang hanya membaca:

```js
const data = await response.json();
```

Frontend yang matang membaca response sebagai beberapa layer:

```text
Status code  → apakah outcome protocol berhasil?
Headers      → metadata apa yang mengontrol cache/security/cookie/diagnostics?
Body         → representasi domain apa yang dikirim?
Browser      → apakah JS boleh mengakses semua itu?
```

---

## 5. HTTP/1.1 Text Format vs HTTP/2/HTTP/3 Framing

Banyak tutorial mengajarkan HTTP message dengan format text HTTP/1.1:

```http
GET /index.html HTTP/1.1
Host: example.com
Accept: text/html
```

Ini berguna untuk belajar, tetapi tidak boleh disalahpahami.

Pada HTTP/2 dan HTTP/3, pesan tidak dikirim sebagai baris text yang sama seperti HTTP/1.1. HTTP/2 memakai binary framing dan pseudo-headers seperti:

```text
:method: GET
:scheme: https
:authority: example.com
:path: /index.html
```

HTTP/3 memakai QUIC sebagai transport di bawahnya. Tetapi secara semantik, browser dan server tetap bertukar:

```text
Request: method + target + headers + optional content
Response: status + headers + optional content
```

Jadi mental model yang harus Anda pegang:

```text
HTTP Semantics ≠ HTTP/1.1 Wire Format
```

Semantik tetap sama; encoding dan transport bisa berbeda.

Implikasi praktis:

- DevTools mungkin menampilkan header pseudo seperti `:method` atau `:status` untuk HTTP/2/3.
- Anda tidak perlu mengirim `Host` secara manual dari browser.
- JavaScript tidak punya kontrol langsung atas framing HTTP/2/3.
- Optimasi frontend harus fokus pada resource graph, caching, priority, origin count, dan request sequencing, bukan format bytes mentah.

---

## 6. Start Line, Request Line, Status Line, dan Pseudo-Headers

Pada HTTP/1.1 request line terlihat seperti:

```http
GET /products?page=1 HTTP/1.1
```

Terdiri dari:

```text
method request-target HTTP-version
```

Pada HTTP/1.1 response status line terlihat seperti:

```http
HTTP/1.1 200 OK
```

Terdiri dari:

```text
HTTP-version status-code reason-phrase
```

Pada HTTP/2/3, konsep ini dipetakan ke pseudo-headers:

```text
:method: GET
:scheme: https
:authority: api.example.com
:path: /products?page=1
:status: 200
```

Frontend biasanya melihat semua ini lewat DevTools, bukan lewat kode JavaScript.

Yang penting:

- `:method` setara intent request.
- `:scheme` bagian dari origin/security boundary.
- `:authority` kira-kira menggantikan authority/host.
- `:path` berisi path + query.
- `:status` status response.

Jangan mencampuradukkan pseudo-header HTTP/2 dengan header aplikasi biasa. Anda tidak bisa sembarang membuat `:method` dari `fetch()` header.

---

## 7. Header Fields: Control Plane HTTP

Header adalah metadata berbentuk pasangan nama-nilai.

Contoh:

```http
Content-Type: application/json
Cache-Control: no-store
Authorization: Bearer abc
Origin: https://app.example.com
Accept: application/json
```

Dari perspektif frontend, header adalah **control plane** HTTP karena header sering menentukan:

- format body
- caching
- authentication
- authorization context
- CORS
- cookies
- redirect behavior
- compression
- security policy
- observability
- request priority
- conditional request
- content negotiation

Body membawa data. Header membawa aturan main.

Kesalahan umum adalah menganggap header hanya “tambahan”. Dalam HTTP modern, banyak keputusan browser dibuat dari header.

Contoh:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

Header ini menentukan apakah JavaScript boleh membaca response cross-origin credentialed request.

Contoh lain:

```http
Cache-Control: public, max-age=31536000, immutable
```

Header ini menentukan apakah browser boleh menyimpan asset selama setahun.

Contoh lain:

```http
Content-Security-Policy: script-src 'self'
```

Header ini menentukan script mana yang boleh dijalankan browser.

---

## 8. Header Name Case-Insensitive, Tetapi Praktik Tetap Harus Rapi

HTTP header field name bersifat case-insensitive.

Secara semantik, ini sama:

```http
Content-Type: application/json
content-type: application/json
CONTENT-TYPE: application/json
```

Namun dalam praktik modern:

- HTTP/2 dan HTTP/3 cenderung menampilkan header lowercase.
- Banyak framework tetap memakai canonical casing seperti `Content-Type`.
- DevTools bisa menampilkan bentuk yang berbeda dari yang Anda bayangkan.
- Proxy/CDN bisa menormalisasi casing.

Jangan membuat logic yang bergantung pada casing header.

Buruk:

```js
if (headers['Content-Type']) {
  // brittle
}
```

Lebih aman:

```js
const contentType = response.headers.get('content-type');
```

Fetch `Headers` API menangani normalisasi akses header.

---

## 9. Header Value Bukan Selalu String Sederhana

Secara tampilan, header terlihat seperti string:

```http
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
```

Tetapi banyak header punya struktur internal:

```http
Cache-Control: private, max-age=60, stale-while-revalidate=30
```

```http
Set-Cookie: session=abc; HttpOnly; Secure; SameSite=Lax; Path=/
```

```http
Content-Type: application/json; charset=utf-8
```

Jadi jangan menganggap parsing header bisa selalu dilakukan dengan split sederhana.

Misalnya, parsing `Set-Cookie` jauh lebih tricky daripada parsing `Accept`. Bahkan `Set-Cookie` diperlakukan khusus dan tidak bisa digabung sembarangan seperti header lain.

Mental model:

```text
Header field = named metadata field
Header value = syntax-specific structured value
```

---

## 10. Request Headers vs Response Headers

Beberapa header hanya masuk akal pada request:

```http
Accept: application/json
Authorization: Bearer abc
Origin: https://app.example.com
If-None-Match: "abc"
```

Beberapa header hanya masuk akal pada response:

```http
Content-Type: application/json
Cache-Control: no-store
ETag: "abc"
Location: /orders/123
Set-Cookie: session=abc; HttpOnly; Secure
```

Beberapa bisa muncul di request dan response tergantung konteks:

```http
Content-Type: application/json
Content-Length: 1234
```

Kesalahan umum:

- mengirim `Access-Control-Allow-Origin` dari frontend request
- mengira `Set-Cookie` bisa diset sebagai request header dari browser JS
- memakai `Content-Type` pada GET tanpa body
- mengirim `Authorization` lalu lupa bahwa custom auth header memicu preflight pada cross-origin request

CORS response headers harus dikirim server, bukan client.

Buruk:

```js
fetch('https://api.example.com/data', {
  headers: {
    'Access-Control-Allow-Origin': '*'
  }
});
```

Itu tidak menyelesaikan CORS karena browser membutuhkan server memberi izin lewat response header.

---

## 11. End-to-End Headers vs Hop-by-Hop Headers

HTTP message bisa melewati banyak perantara:

```text
Browser → CDN → Reverse Proxy → API Gateway → Backend Service
```

Tidak semua header dimaksudkan untuk sampai ke tujuan akhir.

### End-to-end header

Header yang semantiknya berlaku dari pengirim awal ke penerima akhir.

Contoh:

```http
Authorization: Bearer abc
Content-Type: application/json
Cache-Control: no-store
ETag: "abc"
```

### Hop-by-hop header

Header yang hanya berlaku untuk satu koneksi antar node.

Contoh historis/umum:

```http
Connection: keep-alive
Transfer-Encoding: chunked
```

Frontend biasanya tidak mengontrol hop-by-hop headers di browser. Tetapi Anda harus sadar bahwa proxy/gateway bisa:

- menghapus header tertentu
- menambahkan header observability
- mengubah compression
- mengubah cache headers
- mengubah redirect
- menambahkan security headers

Ketika bug hanya terjadi di production, sering akar masalahnya bukan frontend code atau backend service, tetapi layer antara keduanya.

---

## 12. Representation vs Resource: Konsep yang Sering Hilang

HTTP tidak selalu mengirim “resource” secara langsung. HTTP mengirim **representation** dari resource.

Resource:

```text
/orders/123
```

Representation bisa berbeda:

```http
Accept: application/json
```

Response:

```json
{
  "id": "123",
  "status": "paid"
}
```

Atau:

```http
Accept: text/html
```

Response:

```html
<html>...</html>
```

Resource sama, representation berbeda.

Ini penting untuk:

- content negotiation
- caching
- `Vary`
- localization
- API versioning
- partial response
- compression
- security scanning
- frontend rendering

Mental model:

```text
URL identifies resource.
Headers negotiate representation.
Body carries representation data.
```

---

## 13. Content, Body, Payload: Jangan Campur Aduk Secara Semantik

Dalam percakapan sehari-hari kita sering bilang “body”. Itu cukup aman. Tetapi secara semantik modern, Anda perlu memahami beberapa istilah:

| Istilah | Makna praktis |
|---|---|
| Body | Bagian pesan yang membawa data setelah header |
| Content | Data representasi yang dikirim dalam message |
| Payload | Istilah umum untuk data yang dibawa pesan |
| Representation | Bentuk tertentu dari resource, beserta metadata representasinya |

Dalam debugging frontend, pertanyaan yang lebih tepat adalah:

- Apakah request ini punya body?
- Apakah body sesuai dengan `Content-Type`?
- Apakah response body kosong?
- Apakah status code memperbolehkan body yang berarti?
- Apakah body dapat dikonsumsi lebih dari sekali?
- Apakah body sudah dikompresi di transfer?
- Apakah JavaScript boleh membaca body ini?

Contoh jebakan:

```js
const response = await fetch('/api/delete', { method: 'DELETE' });
const data = await response.json();
```

Jika server membalas:

```http
HTTP/1.1 204 No Content
```

Maka `response.json()` akan gagal karena tidak ada body untuk diparse.

---

## 14. Body Tidak Selalu Ada

Tidak semua request punya body.

Umumnya:

| Method | Body umum? | Catatan |
|---|---:|---|
| GET | Tidak | Body pada GET tidak punya semantik umum dan sering bermasalah |
| HEAD | Tidak | Response tidak boleh berisi body yang dikonsumsi seperti GET |
| POST | Ya | Umum untuk create/action/search/submit |
| PUT | Ya | Umum untuk replace resource |
| PATCH | Ya | Umum untuk partial update |
| DELETE | Kadang | Bisa, tapi dukungan/proxy/framework tidak selalu konsisten |
| OPTIONS | Biasanya tidak | Preflight CORS biasanya tanpa application body |

Tidak semua response punya body.

Contoh:

| Status | Body? | Catatan |
|---|---:|---|
| 204 No Content | Tidak | Jangan parse JSON |
| 304 Not Modified | Tidak membawa representasi baru | Browser memakai cached representation |
| HEAD response | Tidak | Header seolah GET, tanpa body |
| 1xx | Tidak seperti response final biasa | Informational |

Frontend HTTP client layer harus memperlakukan ini secara eksplisit.

Buruk:

```js
async function request(url, options) {
  const res = await fetch(url, options);
  return res.json();
}
```

Lebih aman:

```js
async function parseResponse(res) {
  if (res.status === 204 || res.status === 304) {
    return null;
  }

  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return await res.json();
  }

  return await res.text();
}
```

---

## 15. Content-Type vs Accept

Dua header ini sering tertukar.

### `Content-Type`

Menyatakan format body yang sedang dikirim.

Request:

```http
POST /api/orders HTTP/1.1
Content-Type: application/json

{"sku":"BOOK-001"}
```

Artinya:

```text
Body request ini adalah JSON.
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"123"}
```

Artinya:

```text
Body response ini adalah JSON.
```

### `Accept`

Menyatakan format response yang client prefer/terima.

Request:

```http
GET /api/orders/123 HTTP/1.1
Accept: application/json
```

Artinya:

```text
Client ingin menerima response JSON.
```

### Kesalahan umum

Salah:

```js
fetch('/api/orders', {
  method: 'POST',
  headers: {
    Accept: 'application/json'
  },
  body: JSON.stringify({ sku: 'BOOK-001' })
});
```

Masalah: request body dikirim sebagai string tetapi tidak memberitahu server bahwa body adalah JSON.

Benar:

```js
fetch('/api/orders', {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ sku: 'BOOK-001' })
});
```

Tetapi ingat: pada cross-origin request, `Content-Type: application/json` dapat membuat request menjadi tidak simple dan memicu CORS preflight.

---

## 16. Browser-Added Headers: Request Anda Tidak Sepolos Kode Anda

Ketika Anda menulis:

```js
fetch('/api/profile');
```

Browser dapat menambahkan header seperti:

```http
Accept: */*
Accept-Encoding: gzip, deflate, br
Accept-Language: en-US,en;q=0.9
Connection: keep-alive
Cookie: session=abc
Host: app.example.com
Sec-Fetch-Dest: empty
Sec-Fetch-Mode: cors
Sec-Fetch-Site: same-origin
User-Agent: Mozilla/5.0 ...
```

Tidak semua selalu sama. Tergantung:

- browser
- mode request
- origin relationship
- credentials mode
- resource type
- HTTP version
- platform
- privacy settings
- extensions
- service worker
- enterprise policy

Artinya, debug harus melihat actual request di DevTools, bukan hanya source code.

---

## 17. Forbidden Request Headers: Browser Memegang Kendali

Dalam browser, JavaScript tidak boleh mengatur semua header. Ada header yang disebut **forbidden request headers**.

Tujuannya agar user agent/browser tetap punya kontrol atas header sensitif atau header yang berkaitan dengan koneksi, security, origin, cookie, dan fetch pipeline.

Contoh header yang tidak boleh Anda set langsung dari browser JS biasanya meliputi kategori seperti:

- `Host`
- `Cookie`
- `Content-Length`
- `Connection`
- beberapa `Sec-*`
- beberapa `Proxy-*`
- `Transfer-Encoding`
- dan header lain yang dikendalikan browser

Contoh salah:

```js
fetch('https://api.example.com/data', {
  headers: {
    Host: 'api.internal.example.com',
    Cookie: 'session=abc',
    'Content-Length': '999'
  }
});
```

Browser tidak akan mengizinkan ini bekerja seperti server-side HTTP client.

Dari sisi Java engineer, ini penting karena di backend Anda mungkin terbiasa memakai Apache HttpClient, OkHttp, WebClient, atau RestTemplate yang memberi kontrol jauh lebih besar. Browser bukan general-purpose HTTP client. Browser adalah user agent dengan security policy.

Mental model:

```text
Server-side HTTP client: Anda mengontrol banyak header.
Browser fetch/XHR: browser mengontrol header sensitif.
```

---

## 18. Header Guard dalam Fetch

Fetch API punya konsep internal terkait bagaimana header boleh dimodifikasi. Tidak semua `Headers` object punya kemampuan yang sama.

Secara praktis:

```js
const headers = new Headers();
headers.set('Content-Type', 'application/json');
```

Bisa untuk header tertentu.

Tetapi:

```js
headers.set('Cookie', 'session=abc');
```

Tidak boleh bekerja sebagai cara mengirim cookie manual di browser.

Cookie dikirim oleh browser berdasarkan:

- cookie jar
- domain/path match
- `Secure`
- `SameSite`
- credentials mode
- third-party cookie policy
- partitioning/privacy rules

Bukan berdasarkan manual `Cookie` header dari JS.

---

## 19. Request Body di Fetch: String, JSON, FormData, Blob, Stream

Fetch menerima beberapa jenis body.

Contoh JSON:

```js
await fetch('/api/orders', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ sku: 'BOOK-001', quantity: 2 })
});
```

Contoh form URL-encoded:

```js
const params = new URLSearchParams();
params.set('username', 'ayu');
params.set('password', 'secret');

await fetch('/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded'
  },
  body: params
});
```

Contoh multipart upload:

```js
const form = new FormData();
form.append('file', fileInput.files[0]);
form.append('description', 'invoice');

await fetch('/api/uploads', {
  method: 'POST',
  body: form
});
```

Untuk `FormData`, jangan set `Content-Type` manual.

Buruk:

```js
await fetch('/api/uploads', {
  method: 'POST',
  headers: {
    'Content-Type': 'multipart/form-data'
  },
  body: form
});
```

Masalah: browser perlu menambahkan boundary otomatis:

```http
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary...
```

Jika Anda set manual tanpa boundary, server tidak bisa parse body dengan benar.

Benar:

```js
await fetch('/api/uploads', {
  method: 'POST',
  body: form
});
```

---

## 20. Response Body di Fetch: Stream Sekali Pakai

Fetch response body adalah stream. Secara praktis, body hanya bisa dikonsumsi sekali.

Contoh bug:

```js
const res = await fetch('/api/profile');

console.log(await res.text());
const data = await res.json(); // error: body already consumed
```

Karena body sudah dibaca oleh `text()`.

Jika perlu membaca dua kali untuk debugging, gunakan clone:

```js
const res = await fetch('/api/profile');
const copy = res.clone();

console.log(await copy.text());
const data = await res.json();
```

Tetapi jangan biasakan clone besar di production karena bisa berdampak memory.

---

## 21. HTTP Error Tidak Sama dengan Network Error

Ini krusial.

Dalam Fetch API:

```js
const res = await fetch('/api/profile');
```

Promise biasanya **resolve** meskipun server mengembalikan:

```http
HTTP/1.1 404 Not Found
```

atau:

```http
HTTP/1.1 500 Internal Server Error
```

Karena dari perspektif Fetch, request berhasil mendapatkan HTTP response.

Yang dianggap reject biasanya kondisi seperti:

- network failure
- DNS failure
- CORS blocking yang menghasilkan network error abstraction
- request aborted
- TLS failure
- invalid URL

Karena itu, client harus eksplisit memeriksa:

```js
const res = await fetch('/api/profile');

if (!res.ok) {
  throw new Error(`HTTP ${res.status}`);
}

const data = await res.json();
```

Tetapi wrapper yang matang tidak hanya throw `HTTP 500`; ia membaca error body, status, headers, correlation ID, retryability, dan mapping UI.

---

## 22. Status Code Adalah Outcome Class, Body Adalah Detail

Status code memberi sinyal outcome di level HTTP.

Body memberi detail domain/aplikasi.

Contoh baik:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/order-conflict",
  "title": "Order state conflict",
  "detail": "Order has already been paid and can no longer be cancelled.",
  "code": "ORDER_ALREADY_PAID"
}
```

Frontend bisa memahami:

```text
409              → conflict, bukan validasi input biasa
ORDER_ALREADY_PAID → domain-specific reason
message/detail   → user/support explanation
```

Contoh buruk:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": false,
  "error": "ORDER_ALREADY_PAID"
}
```

Masalah:

- Observability HTTP mengira sukses.
- CDN/gateway/logging salah mengklasifikasi.
- Retry policy bisa salah.
- Frontend wrapper harus parse body untuk tahu gagal.
- Monitoring 4xx/5xx tidak menangkap error.

Bukan berarti `200` dengan error body selalu haram. GraphQL dan beberapa RPC style punya alasan desain sendiri. Tetapi untuk REST/HTTP API biasa, status code harus dipakai dengan benar.

---

## 23. `Content-Length`, Compression, dan Transfer Reality

Anda mungkin melihat header:

```http
Content-Length: 1024
```

Artinya ukuran content yang dikirim dalam message pada konteks tertentu.

Namun di browser, beberapa hal membuat ukuran tidak sesederhana itu:

- response bisa dikompresi dengan gzip/br
- DevTools bisa menampilkan transferred size vs resource size
- HTTP/2/3 punya framing sendiri
- chunked transfer bisa tidak memiliki fixed content length
- CDN bisa melakukan compression berbeda dari origin
- service worker bisa menyajikan cached response

Contoh:

```http
Content-Encoding: br
Content-Length: 24576
```

Mungkin ukuran setelah decompress menjadi:

```text
120 KB
```

Dalam performance analysis, bedakan:

| Ukuran | Makna |
|---|---|
| Encoded/transferred size | bytes yang dikirim melalui network |
| Decoded/resource size | ukuran setelah decompress |
| Parsed/runtime cost | biaya parse/compile/render di browser |

Frontend performance tidak selesai hanya dengan mengecilkan transfer bytes. JSON 1MB yang sudah gzip 80KB tetap bisa mahal untuk parse dan render.

---

## 24. `Accept-Encoding` dan Compression: Biasanya Browser yang Mengurus

Browser biasanya mengirim:

```http
Accept-Encoding: gzip, deflate, br
```

atau variasi modern tergantung browser.

JavaScript tidak perlu dan biasanya tidak bisa mengatur ini secara manual.

Server/CDN bisa membalas:

```http
Content-Encoding: br
```

Lalu browser melakukan decompression otomatis sebelum Anda membaca body:

```js
const data = await response.json();
```

Anda tidak melihat compressed bytes secara langsung dari `response.json()`.

Implikasi:

- Jangan double-decompress di frontend.
- Perhatikan DevTools transferred vs resource size.
- Compression adalah kerja sama browser, CDN, dan server.
- Untuk file kecil, compression overhead bisa tidak signifikan atau malah tidak perlu.
- Untuk streaming, compression bisa mempengaruhi flush behavior.

---

## 25. `Accept-Language`: Browser Preference Bukan Identitas User

Browser dapat mengirim:

```http
Accept-Language: en-US,en;q=0.9,id;q=0.8
```

Ini menyatakan preferensi bahasa dari browser/user agent.

Jangan memperlakukannya sebagai:

- identitas user final
- locale aplikasi yang pasti
- izin untuk mengubah data permanen user

Untuk aplikasi serius, locale biasanya adalah kombinasi:

```text
explicit user setting > URL route/domain > stored app preference > Accept-Language fallback
```

Jika server menghasilkan response berbeda berdasarkan `Accept-Language`, cache harus memperhatikan `Vary: Accept-Language`. Jika tidak, user bisa menerima bahasa yang salah dari cache.

---

## 26. `Origin` vs `Referer`: Dua Header yang Sering Disalahpahami

### `Origin`

`Origin` biasanya berisi:

```http
Origin: https://app.example.com
```

Dipakai terutama untuk security policy seperti CORS dan CSRF defense.

Origin hanya berisi:

```text
scheme + host + port
```

Tidak berisi path/query.

### `Referer`

`Referer` dapat berisi URL halaman asal, tergantung referrer policy.

```http
Referer: https://app.example.com/orders/123
```

Catatan: spelling historis header adalah `Referer`, bukan `Referrer`.

Jangan mengandalkan `Referer` selalu lengkap karena bisa dipotong/ditiadakan oleh:

- `Referrer-Policy`
- browser privacy settings
- cross-origin rules
- HTTPS → HTTP downgrade
- extension/privacy tooling

Untuk CORS, yang penting adalah `Origin`, bukan `Referer`.

---

## 27. `Sec-Fetch-*`: Browser Memberi Konteks Request

Browser modern dapat mengirim Fetch Metadata headers seperti:

```http
Sec-Fetch-Site: same-origin
Sec-Fetch-Mode: cors
Sec-Fetch-Dest: empty
Sec-Fetch-User: ?1
```

Ini membantu server memahami konteks request:

- request berasal dari same-origin atau cross-site?
- mode request apa?
- tujuan request untuk document, image, script, empty/fetch?
- apakah request dipicu user navigation?

Dari frontend perspective:

- Anda biasanya tidak mengatur header ini manual.
- Header ini berguna untuk server-side security policy.
- Jika backend memblokir berdasarkan Fetch Metadata, beberapa request frontend bisa gagal karena `mode` atau `dest` berbeda dari ekspektasi.

Contoh failure:

```text
Image CDN request blocked because server policy only allowed Sec-Fetch-Dest: empty.
```

Atau:

```text
API gateway blocks cross-site requests using Sec-Fetch-Site but staging domain topology accidentally makes app and API cross-site.
```

---

## 28. `Authorization` Header: Simple in Code, Complex in Browser

Frontend sering mengirim:

```js
fetch('https://api.example.com/profile', {
  headers: {
    Authorization: `Bearer ${token}`
  }
});
```

Dampak:

1. Header ini membawa credential eksplisit.
2. Pada cross-origin CORS, `Authorization` bukan CORS-safelisted request header sehingga biasanya memicu preflight.
3. Request dengan `Authorization` harus sangat hati-hati terhadap caching.
4. Token di JavaScript memory/localStorage punya threat model berbeda dari HttpOnly cookie.
5. Logging/proxy harus tidak membocorkan nilai header.

Untuk browser/frontend, auth bukan sekadar “tambahkan header”. Anda perlu mempertimbangkan:

- storage token
- refresh token flow
- preflight volume
- retry behavior
- expired token race
- cache bypass
- XSS exposure
- CORS allow headers

---

## 29. `Cookie` dan `Set-Cookie`: Dua Arah, Dua Kontrol Berbeda

Server mengirim cookie dengan response header:

```http
Set-Cookie: session=abc; HttpOnly; Secure; SameSite=Lax; Path=/
```

Browser menyimpan cookie jika aturan terpenuhi.

Pada request berikutnya, browser dapat mengirim:

```http
Cookie: session=abc
```

Frontend JavaScript tidak mengirim `Cookie` header manual pada fetch. Yang bisa dikontrol secara terbatas adalah credentials mode:

```js
fetch('https://api.example.com/profile', {
  credentials: 'include'
});
```

Tetapi cookie tetap hanya terkirim jika:

- domain cocok
- path cocok
- Secure terpenuhi
- SameSite mengizinkan
- browser privacy policy mengizinkan
- third-party cookie policy mengizinkan
- CORS credentialed flow benar untuk cross-origin response

Ini sebabnya bug “login sukses tapi cookie tidak terkirim” tidak bisa dipecahkan hanya dengan melihat kode `fetch()`.

Anda harus melihat seluruh message model.

---

## 30. Response Headers Bisa Ada di Network Tab Tapi Tidak Bisa Dibaca JavaScript

Ini sangat penting untuk CORS.

Misal response cross-origin berisi:

```http
X-Request-Id: req_123
X-RateLimit-Remaining: 42
```

Anda melihatnya di DevTools Network.

Tetapi JavaScript:

```js
response.headers.get('x-request-id')
```

bisa menghasilkan `null` jika header tersebut tidak diekspos oleh server melalui:

```http
Access-Control-Expose-Headers: X-Request-Id, X-RateLimit-Remaining
```

Browser DevTools bukan sama dengan JavaScript access.

Mental model:

```text
DevTools can inspect lower-level browser-observed messages.
JavaScript can only access what browser policy exposes.
```

Ini salah satu boundary paling penting dalam HTTP frontend.

---

## 31. CORS Error Bukan HTTP Response Biasa untuk JavaScript

Kadang server benar-benar mengirim response:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"not_allowed"}
```

Tetapi jika CORS policy tidak mengizinkan frontend membaca response, JavaScript mungkin hanya melihat:

```text
TypeError: Failed to fetch
```

Atau browser console menampilkan CORS error.

Artinya:

```text
HTTP transaction may have happened.
Browser policy blocked JavaScript visibility.
```

Jadi ketika debugging cross-origin:

- lihat actual request
- lihat preflight jika ada
- lihat actual response
- lihat response CORS headers
- lihat console policy error
- jangan hanya percaya exception JavaScript

---

## 32. Empty Body, Invalid JSON, dan Defensive Parsing

Banyak frontend bug berasal dari asumsi bahwa semua response pasti JSON.

Contoh:

```js
const data = await response.json();
```

Ini gagal jika:

- response body kosong
- server mengirim HTML error page
- server mengirim plain text
- proxy mengirim gateway error HTML
- response 204
- CORS membuat response tidak exposed
- body sudah dikonsumsi
- stream terputus

HTTP client wrapper yang matang harus:

1. membaca status
2. membaca content-type
3. menentukan apakah body boleh ada
4. parse sesuai media type
5. fallback aman untuk unknown body
6. preserve diagnostic info

Contoh lebih defensif:

```js
async function readBodySafely(response) {
  if (response.status === 204 || response.status === 304) {
    return { kind: 'empty', value: null };
  }

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      return { kind: 'json', value: await response.json() };
    } catch (error) {
      return { kind: 'invalid-json', error };
    }
  }

  try {
    return { kind: 'text', value: await response.text() };
  } catch (error) {
    return { kind: 'unreadable', error };
  }
}
```

---

## 33. HTTP Message dan DevTools Network: Cara Membaca dengan Benar

Saat membuka DevTools Network, jangan hanya lihat “status merah/hijau”. Baca message secara berlapis.

### 33.1 Request URL

Pertanyaan:

- Apakah scheme benar? `https` vs `http`
- Apakah host benar?
- Apakah port benar?
- Apakah path benar?
- Apakah query benar?
- Apakah request ke origin yang Anda kira?
- Apakah redirect mengubah URL?

### 33.2 Request Method

Pertanyaan:

- Apakah method sesuai intent?
- Apakah browser mengirim OPTIONS dulu?
- Apakah method berubah setelah redirect?
- Apakah form submit memakai GET/POST yang diharapkan?

### 33.3 Request Headers

Pertanyaan:

- Apakah `Origin` ada?
- Apakah `Authorization` ada?
- Apakah `Cookie` terkirim?
- Apakah `Content-Type` benar?
- Apakah custom header memicu preflight?
- Apakah `Accept` sesuai?
- Apakah `Sec-Fetch-*` menunjukkan konteks yang benar?

### 33.4 Request Payload

Pertanyaan:

- Apakah body ada?
- Apakah JSON valid?
- Apakah multipart boundary ada?
- Apakah form field sesuai?
- Apakah body dikirim dua kali?

### 33.5 Response Status

Pertanyaan:

- Apakah status sesuai outcome?
- Apakah 2xx tapi body menyatakan gagal?
- Apakah 3xx terjadi tanpa disadari?
- Apakah 401/403/409/422/429 punya meaning yang benar?
- Apakah 502/503/504 berasal dari gateway?

### 33.6 Response Headers

Pertanyaan:

- Apakah `Content-Type` benar?
- Apakah `Cache-Control` benar?
- Apakah `Set-Cookie` ada?
- Apakah cookie ditolak browser?
- Apakah CORS headers benar?
- Apakah `Access-Control-Expose-Headers` ada?
- Apakah `Location` benar?
- Apakah security headers memblokir resource?

### 33.7 Response Body

Pertanyaan:

- Apakah body sesuai contract?
- Apakah body HTML error page?
- Apakah body kosong?
- Apakah JSON shape berubah?
- Apakah field null/undefined unexpected?

### 33.8 Timing

Pertanyaan:

- Apakah lambat karena DNS/connect/TLS?
- Apakah lambat karena TTFB?
- Apakah lambat karena download size?
- Apakah request queued/stalled?
- Apakah waterfall terlalu serial?

---

## 34. Case Study 1: “API Berhasil di Postman Tapi Gagal di Browser”

### Symptom

Frontend:

```text
TypeError: Failed to fetch
```

Console:

```text
Access to fetch at 'https://api.example.com/profile' from origin 'https://app.example.com' has been blocked by CORS policy
```

Postman:

```text
200 OK
```

### Junior diagnosis

> “Frontend error.”

Atau:

> “CORS server bermasalah, tambahkan `no-cors`.”

### Correct diagnosis

Postman bukan browser. Postman tidak menerapkan browser same-origin policy seperti browser JavaScript.

Browser request mungkin punya:

```http
Origin: https://app.example.com
Authorization: Bearer abc
```

Karena `Authorization` header cross-origin, browser mengirim preflight:

```http
OPTIONS /profile HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: GET
Access-Control-Request-Headers: authorization
```

Server harus membalas preflight dengan benar:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET
Access-Control-Allow-Headers: Authorization
```

Jika tidak, actual request mungkin tidak dikirim, atau response tidak exposed ke JS.

### Invariant

```text
Browser request = HTTP semantics + browser security policy.
Postman request = HTTP semantics without browser JS policy.
```

---

## 35. Case Study 2: “Set-Cookie Ada Tapi Browser Tidak Login”

### Symptom

Login response:

```http
HTTP/1.1 200 OK
Set-Cookie: session=abc; HttpOnly; Secure; SameSite=None
```

Frontend berikutnya:

```js
fetch('https://api.example.com/profile')
```

Response:

```http
401 Unauthorized
```

### Kemungkinan masalah

1. `fetch()` tidak memakai `credentials: 'include'` untuk cross-origin.
2. Server CORS tidak mengirim `Access-Control-Allow-Credentials: true`.
3. Server memakai `Access-Control-Allow-Origin: *`, tidak valid untuk credentialed CORS.
4. Cookie domain/path tidak cocok.
5. Cookie `Secure` tidak bisa dipakai di `http://localhost` tergantung setup.
6. SameSite tidak sesuai flow.
7. Browser memblokir third-party cookie.
8. Cookie ditolak karena attribute invalid.

### Debug message-level

Lihat response login:

- Ada `Set-Cookie`?
- Apakah browser menandai cookie rejected?
- Ada CORS credential headers?

Lihat request profile:

- Ada `Cookie` header?
- `credentials` mode benar?
- Origin/site relationship apa?

### Invariant

```text
Set-Cookie in response does not guarantee Cookie in later request.
```

---

## 36. Case Study 3: “Response Header Ada Tapi `response.headers.get()` Null”

### Symptom

Network tab menunjukkan:

```http
X-Request-Id: req_abc
```

Code:

```js
const requestId = response.headers.get('x-request-id');
console.log(requestId); // null
```

### Diagnosis

Jika request cross-origin, browser hanya mengekspos CORS-safelisted response headers secara default. Custom response header harus diekspos:

```http
Access-Control-Expose-Headers: X-Request-Id
```

### Invariant

```text
Observed by browser ≠ exposed to JavaScript.
```

---

## 37. Case Study 4: “Response JSON Parse Error di Production Saja”

### Symptom

```text
Unexpected token < in JSON at position 0
```

### Kemungkinan besar

Frontend mengira response JSON, tetapi menerima HTML:

```html
<html>
  <body>502 Bad Gateway</body>
</html>
```

Atau SPA fallback mengembalikan `index.html` untuk API path.

### Debug

Lihat:

- status code
- content-type
- response body preview
- apakah request diarahkan ke path yang benar
- apakah proxy route API salah
- apakah CDN fallback salah

### Invariant

```text
Always inspect Content-Type before assuming JSON.
```

---

## 38. Design Principle: HTTP Client Layer Harus Message-Aware

Frontend serius sebaiknya tidak menyebar `fetch()` mentah di seluruh aplikasi.

Bukan berarti selalu harus pakai library besar. Tetapi harus ada layer yang memahami:

- URL construction
- method semantics
- header defaults
- content-type handling
- accept handling
- credentials mode
- status classification
- safe body parsing
- error normalization
- correlation ID extraction
- retry policy
- timeout/abort
- auth/session interaction
- CORS limitations

Contoh skeleton:

```ts
type HttpResult<T> =
  | { ok: true; status: number; data: T; headers: Headers }
  | { ok: false; status: number | null; error: NormalizedHttpError; headers?: Headers };

async function httpJson<T>(url: string, init: RequestInit = {}): Promise<HttpResult<T>> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.headers || {})
      }
    });
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: {
        kind: 'network-error',
        cause: error
      }
    };
  }

  const body = await readBodySafely(response);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      headers: response.headers,
      error: normalizeHttpError(response, body)
    };
  }

  return {
    ok: true,
    status: response.status,
    headers: response.headers,
    data: body.value as T
  };
}
```

Tujuannya bukan wrapper cantik. Tujuannya adalah menjaga invariant HTTP tetap konsisten di seluruh aplikasi.

---

## 39. Message Model dari Perspektif Java Backend Engineer

Sebagai Java engineer, Anda mungkin terbiasa melihat HTTP dari sisi server framework:

Spring MVC:

```java
@PostMapping("/orders")
public ResponseEntity<OrderResponse> create(@RequestBody CreateOrderRequest request) {
    ...
}
```

Atau filter:

```java
String auth = request.getHeader("Authorization");
```

Dari browser/frontend, Anda perlu membalik perspektif:

```text
What did browser actually send?
What did browser refuse to send?
What did server actually respond?
What did browser store?
What did browser expose to JavaScript?
What did browser block?
```

Mapping Java backend ↔ frontend browser:

| Backend concept | Browser/frontend equivalent |
|---|---|
| `HttpServletRequest` | actual request observed in Network tab |
| `@RequestHeader` | headers that browser/proxy actually sent |
| `@RequestBody` | serialized body from JS/form/browser |
| `ResponseEntity.status()` | status visible to browser, if not blocked |
| `ResponseEntity.headers()` | response metadata, partly exposed to JS depending CORS |
| `Set-Cookie` | browser cookie storage attempt, may be rejected |
| servlet filter | server-side policy layer |
| CORS filter | browser visibility gate |
| gateway filter | intermediate mutation of message |

A top engineer can reason from either side and meet in the middle.

---

## 40. Checklist: Membaca Satu HTTP Request/Response Secara Profesional

Gunakan checklist ini setiap kali debugging.

### Request identity

- [ ] URL final benar?
- [ ] Scheme benar?
- [ ] Host/port benar?
- [ ] Path/query benar?
- [ ] Origin relationship benar?

### Request intent

- [ ] Method benar?
- [ ] Request punya body atau tidak?
- [ ] Body sesuai method semantics?
- [ ] Redirect mengubah method?

### Request metadata

- [ ] `Accept` benar?
- [ ] `Content-Type` benar jika body ada?
- [ ] `Authorization` ada jika perlu?
- [ ] `Cookie` terkirim jika perlu?
- [ ] `Origin` sesuai?
- [ ] Custom headers memicu preflight?
- [ ] Browser forbidden headers tidak diasumsikan bisa diset?

### Request body

- [ ] JSON valid?
- [ ] FormData boundary otomatis?
- [ ] Payload size wajar?
- [ ] File upload field name benar?

### Response status

- [ ] Status code sesuai outcome?
- [ ] Error memakai 4xx/5xx yang tepat?
- [ ] 204/304 tidak diparse sebagai JSON?
- [ ] Redirect dipahami?

### Response metadata

- [ ] `Content-Type` sesuai body?
- [ ] `Cache-Control` sesuai sensitivity?
- [ ] `Set-Cookie` valid?
- [ ] CORS headers sesuai?
- [ ] Custom headers diekspos jika perlu dibaca JS?
- [ ] Security headers memblokir resource atau tidak?

### Response body

- [ ] Shape sesuai contract?
- [ ] Empty state jelas?
- [ ] Error envelope konsisten?
- [ ] HTML proxy error tidak diparse sebagai JSON?

### Browser policy

- [ ] CORS pass?
- [ ] Cookie policy pass?
- [ ] Mixed content pass?
- [ ] CSP/CORP/COEP/COOP relevan?
- [ ] Service worker mengintercept?

### Timing/performance

- [ ] DNS/connect/TLS lambat?
- [ ] TTFB lambat?
- [ ] Download besar?
- [ ] Request queued?
- [ ] Waterfall serial?

---

## 41. Common Anti-Patterns dan Replacement

### Anti-pattern 1: Semua response dianggap JSON

Buruk:

```js
return fetch(url).then(r => r.json());
```

Lebih baik:

```js
const contentType = response.headers.get('content-type') || '';
```

Lalu parse sesuai status dan media type.

---

### Anti-pattern 2: Menganggap 404/500 akan masuk `catch`

Buruk:

```js
try {
  const response = await fetch('/api/data');
  return await response.json();
} catch {
  showError();
}
```

Lebih baik:

```js
const response = await fetch('/api/data');

if (!response.ok) {
  handleHttpError(response);
}
```

---

### Anti-pattern 3: Set CORS header dari frontend

Buruk:

```js
headers: {
  'Access-Control-Allow-Origin': '*'
}
```

Lebih baik:

```text
Configure server/gateway to emit correct CORS response headers.
```

---

### Anti-pattern 4: Set `Content-Type: multipart/form-data` manual

Buruk:

```js
headers: {
  'Content-Type': 'multipart/form-data'
}
```

Lebih baik:

```js
body: formData
```

Biarkan browser set boundary.

---

### Anti-pattern 5: Mengira cookie bisa dikirim manual via header

Buruk:

```js
headers: {
  Cookie: 'session=abc'
}
```

Lebih baik:

```js
credentials: 'include'
```

Dan pastikan cookie/CORS/domain/SameSite benar.

---

### Anti-pattern 6: Mengabaikan response headers

Buruk:

```js
const data = await response.json();
```

Tanpa melihat status, content-type, cache, request ID, rate limit.

Lebih baik:

```js
const requestId = response.headers.get('x-request-id');
const contentType = response.headers.get('content-type');
```

Dengan catatan cross-origin custom header perlu `Access-Control-Expose-Headers`.

---

## 42. Latihan Praktik

### Latihan 1 — Inspect Request yang Sebenarnya

Buat halaman kecil:

```html
<!doctype html>
<html>
  <body>
    <button id="btn">Fetch</button>
    <script>
      document.getElementById('btn').onclick = async () => {
        const res = await fetch('https://httpbin.org/anything', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Debug-Client': 'browser'
          },
          body: JSON.stringify({ hello: 'world' })
        });

        console.log(await res.json());
      };
    </script>
  </body>
</html>
```

Amati di DevTools:

- method
- URL
- request headers
- request payload
- response status
- response headers
- response body
- apakah ada preflight

Pertanyaan:

- Header mana yang Anda set manual?
- Header mana yang browser tambahkan?
- Apakah ada OPTIONS request?
- Kenapa?

---

### Latihan 2 — Parse Response Defensively

Implementasikan fungsi:

```ts
async function parseHttpResponse(response: Response): Promise<unknown> {
  // TODO
}
```

Requirement:

- return `null` untuk 204/304
- parse JSON jika `Content-Type` mengandung `application/json`
- parse text jika `text/*`
- return `Blob` untuk binary unknown
- jangan crash jika body kosong
- preserve status dan headers untuk caller

---

### Latihan 3 — Bandingkan Browser vs Server-side Client

Buat request yang sama dari:

1. browser `fetch()`
2. curl
3. Java HTTP client

Bandingkan:

- header yang bisa Anda set
- cookie behavior
- redirect behavior
- CORS behavior
- compression behavior
- error handling

Kesimpulan yang harus Anda dapat:

```text
Browser is not just another HTTP client.
Browser is an HTTP client with user-agent policy, security model, storage model, and resource loading integration.
```

---

## 43. Mini Design Review: API Response yang Baik untuk Frontend

Misal Anda mendesain endpoint:

```http
POST /api/orders
```

Response sukses create sebaiknya mempertimbangkan:

```http
HTTP/1.1 201 Created
Content-Type: application/json
Location: /api/orders/ord_123
Cache-Control: no-store
X-Request-Id: req_abc

{
  "id": "ord_123",
  "status": "created",
  "createdAt": "2026-06-18T10:15:30Z"
}
```

Kenapa?

- `201` memberi sinyal resource created.
- `Location` memberi canonical URL resource baru.
- `Content-Type` membuat body parseable.
- `Cache-Control: no-store` mencegah data sensitif tersimpan jika perlu.
- `X-Request-Id` membantu support/debugging.
- Body memberi representasi awal untuk UI.

Response validation error:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json
X-Request-Id: req_def

{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "code": "VALIDATION_ERROR",
  "fields": {
    "quantity": ["Quantity must be greater than zero"]
  }
}
```

Frontend bisa mapping:

```text
422              → field/form error
fields.quantity  → inline field error
X-Request-Id     → support correlation
```

---

## 44. Ringkasan Mental Model

Pegang model ini:

```text
HTTP Message = intent/outcome + metadata + optional representation
```

Request:

```text
method + target + headers + optional body
```

Response:

```text
status + headers + optional body
```

Browser menambahkan layer:

```text
HTTP semantics
+ Fetch/XHR API rules
+ Same-Origin/CORS policy
+ cookie/storage policy
+ cache policy
+ security headers
+ resource loading pipeline
+ service worker interception
```

Karena itu, frontend HTTP debugging harus selalu menjawab lima pertanyaan:

1. Apa yang kode ingin kirim?
2. Apa yang browser benar-benar kirim?
3. Apa yang server/gateway benar-benar balas?
4. Apa yang browser simpan/blokir/ubah?
5. Apa yang JavaScript akhirnya boleh lihat?

Kalau Anda bisa menjawab lima pertanyaan itu dengan evidence dari DevTools dan server logs, Anda sudah jauh melampaui pemahaman HTTP rata-rata.

---

## 45. Apa yang Harus Dikuasai Sebelum Lanjut

Sebelum lanjut ke Part 004, pastikan Anda bisa menjelaskan tanpa melihat catatan:

- struktur request message
- struktur response message
- bedanya header dan body
- bedanya `Content-Type` dan `Accept`
- kenapa body tidak selalu ada
- kenapa `fetch()` tidak reject untuk HTTP 404/500
- kenapa browser tidak mengizinkan header tertentu diset manual
- kenapa header terlihat di Network tab belum tentu bisa dibaca JavaScript
- kenapa Postman sukses tidak membuktikan browser pasti sukses
- bagaimana membaca satu request di DevTools secara sistematis

---

## 46. Preview Part 004

Part berikutnya:

```text
learn-http-for-web-frontend-perspective-part-004.md
```

Topik:

```text
HTTP Methods: Semantics, Safety, Idempotency, and Frontend Consequences
```

Kita akan membedah method bukan sebagai “CRUD mapping template”, tetapi sebagai kontrak intent yang berdampak pada:

- retry safety
- duplicate submit
- optimistic UI
- autosave
- refresh/reload
- browser/proxy/cache behavior
- idempotency key
- conflict handling
- API design
- mutation state machine

---

## Status Seri

```text
Part 003 selesai.
Seri belum selesai.
Lanjut ke Part 004: HTTP Methods: Semantics, Safety, Idempotency, and Frontend Consequences.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-002.md">⬅️ Part 002 — URL, Origin, Site, Scheme, Host, Port, Path, Query, Fragment</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-004.md">Part 004 — HTTP Methods: Semantics, Safety, Idempotency, and Frontend Consequences ➡️</a>
</div>

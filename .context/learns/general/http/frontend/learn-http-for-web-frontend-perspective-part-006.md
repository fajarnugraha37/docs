# learn-http-for-web-frontend-perspective-part-006.md

# Part 006 — Headers Deep Dive: The Real Control Plane of HTTP

> Seri: `learn-http-for-web-frontend-perspective`  
> Perspektif: Java software engineer yang ingin menguasai HTTP dari sisi browser/frontend  
> Level: intermediate → advanced → production-grade  
> Status seri: Part 006 dari 035  
> Bagian sebelumnya: Part 005 — Status Codes: Reading Outcomes Like a Protocol Engineer  
> Bagian berikutnya: Part 007 — Body, Payload, Representation, Media Type, and Encoding

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya, kita melihat **status code** sebagai sinyal outcome: sukses, redirect, client error, server error, conflict, rate limit, dan sebagainya.

Di bagian ini kita masuk ke bagian HTTP yang paling sering diremehkan tetapi paling menentukan perilaku produksi:

> **HTTP headers adalah control plane dari komunikasi HTTP.**

Body biasanya membawa data bisnis. Header membawa metadata, constraint, policy, negotiation, routing signal, cache instruction, security boundary, credential behavior, observability context, dan browser enforcement signal.

Kalau body adalah “apa isi pesan”, maka header adalah “bagaimana pesan ini harus dipahami, diproses, dibatasi, disimpan, diteruskan, dibaca, diamankan, dan diamati”.

Setelah menyelesaikan bagian ini, Anda harus bisa:

1. membedakan header request, response, representation, cache, security, CORS, cookie, observability, dan proxy;
2. memahami kenapa browser tidak mengizinkan JavaScript mengatur semua header;
3. mendiagnosis masalah seperti:
   - custom header menyebabkan preflight;
   - response header terlihat di DevTools tapi tidak bisa dibaca oleh JavaScript;
   - cache salah karena `Vary` hilang;
   - cookie tidak terkirim walaupun `Set-Cookie` ada;
   - CDN menyajikan response user lain;
   - API gateway menghapus correlation header;
   - security header memblokir script/font/image;
4. mendesain header contract yang stabil untuk frontend/backend;
5. membaca header bukan sebagai detail kecil, tetapi sebagai sistem kontrol lintas browser, CDN, gateway, backend, dan observability.

---

## 1. Mental Model Utama: Header sebagai Control Plane

HTTP message terdiri dari tiga lapisan sederhana:

```txt
[start-line]
headers

body
```

Contoh request:

```http
GET /api/me HTTP/1.1
Host: api.example.com
Accept: application/json
Authorization: Bearer eyJ...
Origin: https://app.example.com
Sec-Fetch-Site: same-site
Sec-Fetch-Mode: cors
Sec-Fetch-Dest: empty

```

Contoh response:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: private, no-cache
ETag: "user-123-v42"
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Access-Control-Expose-Headers: ETag, X-Request-Id
X-Request-Id: req_01HT...

{"id":"123","name":"Ayu"}
```

Body hanya berisi data user. Tetapi hampir semua keputusan penting ada di header:

| Pertanyaan | Dijawab oleh |
|---|---|
| Format body apa? | `Content-Type` |
| Client ingin format apa? | `Accept` |
| Boleh disimpan cache? | `Cache-Control` |
| Response masih valid atau perlu revalidate? | `ETag`, `Last-Modified`, `If-None-Match` |
| Request berasal dari origin mana? | `Origin` |
| Browser boleh expose response ke JS? | `Access-Control-Allow-Origin`, `Access-Control-Expose-Headers` |
| Credential dikirim atau tidak? | `Cookie`, `Authorization`, fetch `credentials`, CORS headers |
| Ini request navigasi, image, script, atau fetch? | `Sec-Fetch-*` |
| Response boleh di-frame? | `X-Frame-Options`, `Content-Security-Policy: frame-ancestors` |
| Script apa yang boleh dieksekusi? | `Content-Security-Policy` |
| Request bisa dikorelasikan ke trace backend? | `traceparent`, `X-Request-Id`, `Server-Timing` |
| Proxy boleh meneruskan header ini? | hop-by-hop semantics, gateway config |

Dari perspektif browser/frontend, header adalah tempat bertemunya:

```txt
HTTP semantics
+ browser security policy
+ cache semantics
+ auth/session model
+ CDN/proxy routing
+ observability
+ performance hints
+ deployment topology
```

Inilah sebabnya bug header sering terasa “aneh”: request terlihat benar, response terlihat benar, tetapi browser tetap menolak, cache tetap salah, atau JavaScript tetap tidak bisa membaca sesuatu.

---

## 2. Header Bukan Sekadar Key-Value Biasa

Secara visual, header terlihat seperti pasangan key-value:

```http
Content-Type: application/json
Cache-Control: no-store
```

Tetapi secara sistem, header punya properti penting:

1. **Header name case-insensitive.**
   `Content-Type`, `content-type`, dan `CONTENT-TYPE` merujuk field name yang sama.

2. **Header value tidak selalu string sederhana.**
   Banyak header punya grammar spesifik:
   - list: `Accept: text/html, application/json`
   - directives: `Cache-Control: max-age=60, private`
   - structured-ish values: `Content-Type: application/json; charset=utf-8`
   - dates: `Last-Modified: Wed, 21 Oct 2015 07:28:00 GMT`
   - tokens: `ETag: "abc123"`

3. **Sebagian header boleh muncul beberapa kali.**
   Contoh paling penting: `Set-Cookie` tidak boleh diperlakukan seperti list header biasa karena setiap cookie adalah header sendiri.

4. **Sebagian header dikontrol browser, bukan JavaScript.**
   Contoh: `Host`, `Cookie`, `Content-Length`, beberapa `Sec-*`, dan header lain yang dianggap forbidden.

5. **Sebagian header memengaruhi CORS.**
   Custom request header seperti `X-Request-Id` atau `X-Tenant-Id` dapat membuat browser mengirim preflight `OPTIONS`.

6. **Sebagian header hanya visible di DevTools, tapi tidak accessible dari JS.**
   Dalam cross-origin fetch, JavaScript hanya bisa membaca CORS-safelisted response headers dan header yang diekspos lewat `Access-Control-Expose-Headers`.

7. **Sebagian header diubah oleh proxy/CDN/gateway.**
   Apa yang dikirim browser belum tentu identik dengan apa yang diterima service.

8. **Sebagian header bersifat end-to-end, sebagian hop-by-hop.**
   Ini penting ketika ada CDN, load balancer, API gateway, service mesh, dan reverse proxy.

Kesalahan umum engineer adalah menganggap header sebagai “dictionary”. Untuk aplikasi kecil, itu cukup. Untuk sistem produksi, mental model itu terlalu miskin.

Mental model yang lebih tepat:

```txt
Header = typed metadata field with protocol-defined semantics,
         browser constraints,
         intermediary behavior,
         and security consequences.
```

---

## 3. Taksonomi Header dari Perspektif Frontend

Untuk belajar efisien, jangan menghafal semua header satu per satu. Kelompokkan berdasarkan fungsi.

### 3.1 Request Intent & Negotiation Headers

Header ini membantu client menyatakan apa yang dia inginkan.

Contoh:

```http
Accept: application/json
Accept-Language: id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7
Accept-Encoding: gzip, br, zstd
```

Pertanyaan yang dijawab:

- “Saya bisa menerima format apa?”
- “Bahasa apa yang saya prefer?”
- “Encoding/compression apa yang saya dukung?”

Frontend biasanya tidak mengatur semua ini secara manual. Browser sering mengatur default-nya, terutama untuk resource seperti HTML, CSS, image, script, font.

### 3.2 Representation Headers

Header ini menjelaskan body.

Contoh:

```http
Content-Type: application/json; charset=utf-8
Content-Encoding: br
Content-Language: id-ID
Content-Length: 3482
```

Pertanyaan yang dijawab:

- “Body ini formatnya apa?”
- “Body ini dikompresi bagaimana?”
- “Bahasa kontennya apa?”
- “Panjangnya berapa byte?”

### 3.3 Cache Headers

Header ini mengatur apakah response boleh disimpan, berapa lama, dan bagaimana divalidasi ulang.

Contoh:

```http
Cache-Control: public, max-age=31536000, immutable
ETag: "app.9f3a1b2c.js"
Last-Modified: Tue, 18 Jun 2026 09:00:00 GMT
Vary: Accept-Encoding
Age: 120
```

Pertanyaan yang dijawab:

- “Response ini boleh disimpan?”
- “Cache mana yang boleh menyimpan?”
- “Berapa lama fresh?”
- “Kapan harus revalidate?”
- “Variant response bergantung pada request header apa?”

### 3.4 CORS Headers

Header ini menentukan apakah browser boleh mengekspos response cross-origin ke JavaScript.

Contoh:

```http
Origin: https://app.example.com
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Headers: Authorization, Content-Type, X-Request-Id
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE
Access-Control-Expose-Headers: ETag, X-Request-Id
Access-Control-Max-Age: 600
```

Pertanyaan yang dijawab:

- “Request berasal dari origin mana?”
- “Origin ini boleh membaca response?”
- “Request boleh membawa credential?”
- “Header apa yang boleh dikirim?”
- “Header response apa yang boleh dibaca JS?”

### 3.5 Cookie & Credential Headers

Header ini mengatur session/credential berbasis cookie.

Contoh:

```http
Cookie: session=abc; theme=dark
Set-Cookie: session=abc; HttpOnly; Secure; SameSite=Lax; Path=/
```

Pertanyaan yang dijawab:

- “Credential ambient apa yang dikirim browser?”
- “Server ingin menyimpan cookie apa?”
- “Cookie ini visible ke JS atau tidak?”
- “Cookie ini boleh dikirim cross-site atau tidak?”

### 3.6 Auth Headers

Header ini membawa credential eksplisit.

Contoh:

```http
Authorization: Bearer eyJhbGciOi...
WWW-Authenticate: Bearer realm="api"
```

Pertanyaan yang dijawab:

- “Client membuktikan identitas dengan mekanisme apa?”
- “Server meminta authentication scheme apa?”

### 3.7 Security Policy Headers

Header ini mengirim policy ke browser.

Contoh:

```http
Content-Security-Policy: default-src 'self'; script-src 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-site
```

Pertanyaan yang dijawab:

- “Script/resource mana yang boleh dimuat?”
- “Browser harus selalu pakai HTTPS?”
- “Boleh sniff MIME type?”
- “Referer dikirim seberapa detail?”
- “API browser apa yang boleh digunakan?”
- “Context ini isolated atau tidak?”

### 3.8 Fetch Metadata Headers

Header ini dikirim browser untuk memberi server konteks request.

Contoh:

```http
Sec-Fetch-Site: same-origin
Sec-Fetch-Mode: cors
Sec-Fetch-Dest: empty
Sec-Fetch-User: ?1
```

Pertanyaan yang dijawab:

- “Request ini berasal dari same-origin, same-site, atau cross-site?”
- “Mode request ini apa?”
- “Tujuannya untuk document, image, script, fetch, iframe, atau lainnya?”
- “Ini user-initiated navigation atau bukan?”

### 3.9 Observability Headers

Header ini membantu debugging lintas sistem.

Contoh:

```http
X-Request-Id: req_01HTZ...
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
Server-Timing: db;dur=34, app;dur=52
```

Pertanyaan yang dijawab:

- “Request ini ID-nya apa?”
- “Trace distributed-nya apa?”
- “Waktu server habis di mana?”
- “Bisa dikorelasikan dari browser ke logs backend?”

### 3.10 Proxy/CDN/Forwarding Headers

Header ini muncul karena ada intermediary.

Contoh:

```http
Forwarded: for=203.0.113.10;proto=https;host=api.example.com
X-Forwarded-For: 203.0.113.10
X-Forwarded-Proto: https
X-Forwarded-Host: api.example.com
Via: 1.1 proxy.example.net
CF-Cache-Status: HIT
```

Pertanyaan yang dijawab:

- “Client asli IP-nya apa?”
- “Original protocol HTTPS atau HTTP?”
- “Original host apa sebelum proxy?”
- “Response dari CDN cache atau origin?”

Frontend jarang mengatur header ini, tetapi sering harus membacanya saat debugging.

---

## 4. Header Lifecycle: Dari Browser ke Service dan Balik Lagi

Request frontend jarang langsung ke service. Lebih sering flow-nya seperti ini:

```txt
Browser
  ↓
DNS
  ↓
CDN / edge
  ↓
WAF
  ↓
Load balancer
  ↓
API gateway / reverse proxy
  ↓
Service mesh / sidecar
  ↓
Backend service
  ↓
Database / downstream service
```

Response balik lewat jalur sebaliknya.

Di setiap titik, header bisa:

1. ditambahkan;
2. dihapus;
3. diubah;
4. dinormalisasi;
5. dipakai untuk routing;
6. dipakai untuk caching;
7. dipakai untuk auth;
8. dipakai untuk security enforcement;
9. dipakai untuk logging/tracing;
10. disalahkonfigurasi.

Contoh perubahan nyata:

```txt
Browser sends:
  Host: api.example.com
  Origin: https://app.example.com
  Authorization: Bearer ...
  X-Request-Id: abc

CDN may add:
  CF-Connecting-IP: ...
  X-Forwarded-For: ...

Gateway may add:
  X-Forwarded-Proto: https
  X-Request-Id: generated-if-missing

Service may add response:
  Cache-Control: private, no-store
  X-Request-Id: abc

Gateway may add response:
  Server-Timing: gateway;dur=12

CDN may add response:
  Age: 24
  CF-Cache-Status: HIT
```

Frontend debugging harus bertanya:

> Header mana yang dikirim browser?  
> Header mana yang diterima service?  
> Header mana yang dikirim service?  
> Header mana yang akhirnya diterima browser?  
> Header mana yang boleh dibaca JavaScript?

Itu lima pertanyaan berbeda.

---

## 5. Request Headers yang Sering Terlihat di Browser

Mari lihat contoh request dari SPA ke API:

```http
GET /api/orders?status=open HTTP/2
Host: api.example.com
Accept: application/json
Accept-Encoding: gzip, deflate, br, zstd
Accept-Language: id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7
Authorization: Bearer eyJ...
Origin: https://app.example.com
Referer: https://app.example.com/orders
Sec-Fetch-Dest: empty
Sec-Fetch-Mode: cors
Sec-Fetch-Site: same-site
User-Agent: Mozilla/5.0 ...
```

Kita bedah.

### 5.1 `Host`

```http
Host: api.example.com
```

`Host` menunjukkan authority target. Dalam HTTP/1.1, ini sangat penting karena satu IP dapat melayani banyak domain lewat virtual hosting.

Frontend tidak boleh sembarangan set `Host` dari JavaScript. Browser dan network stack yang mengontrolnya.

### 5.2 `Accept`

```http
Accept: application/json
```

`Accept` menyatakan media type yang client bisa terima.

Untuk API JSON, frontend sering memakai:

```http
Accept: application/json
```

Tapi untuk browser navigation, browser bisa mengirim sesuatu seperti:

```http
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8
```

Makna penting:

- Request navigation berbeda dari API fetch.
- Server bisa menggunakan `Accept` untuk content negotiation.
- Jika server menghasilkan variasi berdasarkan `Accept`, response cache harus memperhatikan `Vary: Accept`.

### 5.3 `Accept-Language`

```http
Accept-Language: id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7
```

Browser menyatakan preferensi bahasa user.

Masalah produksi:

- Jika HTML/API response berbeda berdasarkan bahasa, cache harus aware.
- Jika CDN cache tidak mempertimbangkan language, user bisa mendapat bahasa orang lain.
- `Vary: Accept-Language` bisa benar secara semantic tetapi berbahaya untuk cache cardinality karena variasi bahasa browser bisa sangat banyak.

Alternatif yang sering lebih controlled:

- language di URL: `/id/products`, `/en/products`;
- language di cookie/application preference;
- language di user profile;
- CDN normalization.

### 5.4 `Accept-Encoding`

```http
Accept-Encoding: gzip, deflate, br, zstd
```

Client menyatakan compression encoding yang didukung.

Frontend biasanya tidak mengatur ini. Browser mengaturnya.

Server/CDN memilih encoding dan membalas:

```http
Content-Encoding: br
Vary: Accept-Encoding
```

Masalah produksi:

- Proxy melakukan double compression.
- Response dikompresi tetapi `Content-Encoding` salah.
- CDN cache tidak memisahkan variant gzip/br dengan benar.
- Debugging payload size salah karena DevTools menampilkan compressed vs uncompressed size.

### 5.5 `Authorization`

```http
Authorization: Bearer eyJ...
```

Header ini membawa credential eksplisit.

Dari perspektif frontend:

- Menambahkan `Authorization` ke cross-origin request biasanya membuat request tidak simple dan memicu preflight.
- Response untuk request dengan `Authorization` biasanya tidak boleh diperlakukan sebagai public cache kecuali server sangat eksplisit dan benar.
- Token di header rentan bocor ke log jika logging tidak disiplin.
- Jika disimpan di localStorage, token exposed terhadap XSS.
- Jika disimpan di memory, refresh dan multi-tab punya tantangan.

`Authorization` bukan sekadar header. Ia mengubah threat model, CORS behavior, cacheability, logging risk, dan retry behavior.

### 5.6 `Origin`

```http
Origin: https://app.example.com
```

`Origin` memberi tahu server asal request menurut browser.

Penting:

- Dipakai dalam CORS.
- Dipakai untuk CSRF defense tambahan.
- Tidak sama dengan `Referer`.
- Tidak berisi path.
- Dikirim dalam banyak cross-origin request dan beberapa same-origin/certain methods tergantung konteks.

Server sering memvalidasi `Origin` untuk state-changing requests.

### 5.7 `Referer`

```http
Referer: https://app.example.com/orders
```

`Referer` memberi URL halaman sebelumnya/sumber request. Namanya memang historically misspelled sebagai `Referer`.

Masalah:

- Bisa mengandung path/query sensitif jika policy salah.
- Bisa dikurangi/dihilangkan oleh `Referrer-Policy`.
- Tidak boleh dijadikan satu-satunya security control.
- Berbeda dari `Origin`.

### 5.8 `User-Agent`

```http
User-Agent: Mozilla/5.0 ...
```

User agent string historically dipakai untuk deteksi browser/device. Tetapi ini fragile.

Untuk frontend modern:

- Hindari server logic yang bergantung kuat pada parsing `User-Agent`.
- Gunakan feature detection di client.
- Untuk kebutuhan tertentu, Client Hints bisa lebih terstruktur, tetapi punya konsekuensi privacy dan caching.

### 5.9 `Sec-Fetch-*`

```http
Sec-Fetch-Site: same-site
Sec-Fetch-Mode: cors
Sec-Fetch-Dest: empty
```

Header ini dikirim browser sebagai Fetch Metadata.

Gunanya:

- membantu server membedakan request same-origin, same-site, cross-site;
- membantu server memblokir request cross-site yang mencurigakan;
- membantu mitigasi beberapa class CSRF/cross-site abuse;
- memberi visibility apakah request untuk image/script/document/fetch.

Frontend tidak set header ini secara manual.

### 5.10 Custom Headers

Contoh:

```http
X-Request-Id: req_123
X-Tenant-Id: tenant_abc
X-Feature-Flag: new-dashboard
```

Custom header berguna, tetapi mahal jika salah.

Konsekuensi:

- Cross-origin request dengan custom header biasanya memicu preflight.
- Header perlu masuk `Access-Control-Allow-Headers`.
- Header perlu dipertahankan oleh gateway/proxy.
- Header bisa terekam di logs.
- Header bisa memperbesar cache variant jika masuk `Vary`.

Rule of thumb:

> Jangan taruh data bisnis arbitrer di custom header hanya karena “lebih bersih dari body/query”. Header punya semantic dan operational cost.

---

## 6. Response Headers yang Sering Menentukan Perilaku Frontend

Contoh response API:

```http
HTTP/2 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: private, no-cache
ETag: "orders-open-v17"
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Access-Control-Expose-Headers: ETag, X-Request-Id
X-Request-Id: req_123
Server-Timing: app;dur=84, db;dur=31

{"items":[...]}
```

### 6.1 `Content-Type`

```http
Content-Type: application/json; charset=utf-8
```

Header ini menjelaskan media type response body.

Frontend consequences:

- `response.json()` mencoba parse body sebagai JSON, tetapi tidak otomatis memvalidasi `Content-Type`.
- Browser security behavior untuk script/style/image bisa bergantung pada MIME type.
- `X-Content-Type-Options: nosniff` membuat MIME mismatch lebih ketat.
- API yang mengembalikan HTML error page dengan status 500 tetapi frontend memanggil `response.json()` akan menghasilkan parsing error yang menyembunyikan error asli.

Praktik baik untuk HTTP client frontend:

```ts
async function parseJsonResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(`Expected JSON, got ${contentType}. Body preview: ${text.slice(0, 200)}`);
  }

  return response.json();
}
```

### 6.2 `Cache-Control`

```http
Cache-Control: private, no-cache
```

Header ini mengontrol cache behavior.

Perlu hati-hati:

- `no-store` berarti jangan simpan.
- `no-cache` bukan berarti jangan simpan; artinya boleh simpan tetapi harus revalidate sebelum reuse.
- `private` berarti hanya private cache seperti browser, bukan shared cache seperti CDN.
- `public` berarti shared cache boleh menyimpan jika syarat lain terpenuhi.

Untuk API user-specific:

```http
Cache-Control: private, no-store
```

atau:

```http
Cache-Control: private, no-cache
ETag: "user-123-v7"
```

tergantung kebutuhan.

Untuk fingerprinted static asset:

```http
Cache-Control: public, max-age=31536000, immutable
```

### 6.3 `ETag`

```http
ETag: "orders-open-v17"
```

ETag adalah validator. Client bisa revalidate:

```http
If-None-Match: "orders-open-v17"
```

Server bisa menjawab:

```http
HTTP/2 304 Not Modified
```

Frontend consequence:

- Browser cache bisa memakai ini otomatis.
- API client custom juga bisa memakai ETag untuk concurrency control.
- ETag bisa dipakai dengan `If-Match` untuk mencegah lost update.

### 6.4 `Location`

```http
Location: /orders/123
```

Dipakai pada redirect atau resource creation.

Contoh create:

```http
HTTP/1.1 201 Created
Location: /api/orders/123
```

Frontend bisa memakai `Location` untuk navigasi/refresh resource.

Tetapi untuk cross-origin fetch, jika ingin membaca `Location` dari JS, server mungkin perlu expose header:

```http
Access-Control-Expose-Headers: Location
```

### 6.5 `Retry-After`

```http
Retry-After: 60
```

Dipakai untuk `429 Too Many Requests` atau `503 Service Unavailable`.

Frontend consequence:

- Jangan retry membabi buta.
- Respect server backpressure.
- Bisa tampilkan UI: “Coba lagi dalam 60 detik.”
- Bisa masuk retry scheduler.

### 6.6 `WWW-Authenticate`

```http
WWW-Authenticate: Bearer realm="api", error="invalid_token"
```

Dipakai untuk authentication challenge, biasanya dengan `401 Unauthorized`.

Frontend consequence:

- Bisa membantu membedakan token expired, invalid, atau auth scheme salah.
- Jangan hanya treat semua 401 sebagai “logout paksa” tanpa mempertimbangkan refresh flow.

### 6.7 `X-Request-Id`

```http
X-Request-Id: req_123
```

Header observability custom yang umum.

Frontend consequence:

- Tampilkan support ID pada error page.
- Kirim ke logging frontend.
- Korelasikan dengan backend logs.
- Untuk cross-origin response, expose jika JS perlu baca:

```http
Access-Control-Expose-Headers: X-Request-Id
```

### 6.8 `Server-Timing`

```http
Server-Timing: app;dur=84, db;dur=31, cache;desc="MISS"
```

Header ini memberi timing server yang bisa muncul di DevTools dan dapat diakses melalui Performance APIs dalam kondisi tertentu.

Frontend consequence:

- Membedakan “network lambat” vs “server lambat” vs “DB lambat”.
- Berguna untuk RUM.
- Jangan memasukkan informasi sensitif.

### 6.9 CDN/Proxy Response Headers

Contoh:

```http
Age: 240
Via: 1.1 varnish
CF-Cache-Status: HIT
X-Cache: HIT
```

Frontend debugging:

- `Age` memberi indikasi response sudah berapa lama di cache.
- `X-Cache`/vendor-specific header menunjukkan HIT/MISS/BYPASS.
- Bisa menjelaskan kenapa backend log tidak muncul: request tidak sampai origin karena cache HIT.

---

## 7. Browser Constraint: JavaScript Tidak Bisa Mengatur Semua Header

Ini bagian yang sering mengejutkan engineer backend.

Di server-to-server HTTP client, Anda bisa hampir bebas menulis header.

Di browser:

```ts
fetch("https://api.example.com/data", {
  headers: {
    "Host": "evil.com",
    "Cookie": "session=abc",
    "Content-Length": "999",
    "Sec-Fetch-Site": "same-origin"
  }
});
```

Banyak header di atas akan ditolak/diabaikan browser.

Kenapa?

Karena browser bukan HTTP library biasa. Browser adalah security boundary. Jika JavaScript dari arbitrary website boleh mengatur semua header, maka web security model runtuh.

### 7.1 Forbidden Request Headers

Forbidden request headers adalah header yang tidak boleh diset atau dimodifikasi secara programatik oleh JavaScript.

Contoh kategori:

- connection/protocol control:
  - `Connection`
  - `Content-Length`
  - `Host`
  - `Transfer-Encoding`
- cookie/credential control:
  - `Cookie`
- browser-controlled metadata:
  - `Origin` dalam banyak konteks
  - `Referer` secara langsung dibatasi, gunakan `referrer`/`referrerPolicy`
  - `Sec-*`
- proxy/security-sensitive fields tertentu.

Mental model:

```txt
Server-side HTTP client:
  application controls transport-level and application-level headers.

Browser fetch:
  application suggests some headers,
  browser owns security-sensitive headers.
```

### 7.2 Kenapa `Cookie` Tidak Bisa Diset Manual?

Anda mungkin ingin:

```ts
fetch("/api", {
  headers: {
    Cookie: "session=abc"
  }
});
```

Browser tidak mengizinkan ini.

Cookie dikirim berdasarkan:

- cookie jar browser;
- target URL;
- domain/path matching;
- `Secure`;
- `SameSite`;
- third-party cookie policy;
- fetch `credentials` mode;
- CORS credential policy.

Jadi cara mengirim cookie bukan dengan set `Cookie`, tetapi:

```ts
fetch("https://api.example.com/me", {
  credentials: "include"
});
```

lalu server harus mengatur CORS credential response dengan benar.

### 7.3 Kenapa `Content-Length` Tidak Bisa Diset Manual?

Browser menghitungnya dari body dan transport encoding.

Jika JavaScript bebas memalsukan `Content-Length`, banyak parser/proxy/server bisa terkena ambiguity dan request smuggling risk.

### 7.4 Kenapa `Origin` Tidak Bisa Dipalsukan Manual?

`Origin` dipakai server untuk security decision, terutama CORS dan CSRF mitigation. Jika JavaScript bebas mengatur `Origin`, mekanisme itu tidak berguna.

### 7.5 Kenapa `Sec-*` Tidak Bisa Diset Manual?

Prefix `Sec-` dirancang untuk header yang hanya boleh dikontrol user agent/browser. Ini memberi server sinyal yang lebih dapat dipercaya bahwa header tersebut berasal dari browser, bukan script userland.

---

## 8. CORS dan Header: Sumber Banyak Bug Produksi

CORS bukan hanya soal origin. Header sangat menentukan.

### 8.1 Simple Request dan CORS-Safelisted Request Headers

Dalam CORS, tidak semua request perlu preflight.

Request yang memenuhi syarat tertentu disebut “simple request” secara informal. Salah satu syarat pentingnya adalah request hanya memakai CORS-safelisted request headers dengan value yang memenuhi constraint.

CORS-safelisted request headers mencakup header seperti:

```txt
Accept
Accept-Language
Content-Language
Content-Type
Range
```

Tetapi `Content-Type` hanya safelisted untuk media type tertentu:

```txt
application/x-www-form-urlencoded
multipart/form-data
text/plain
```

Artinya:

```ts
fetch("https://api.example.com/orders", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ itemId: "A1" })
});
```

Cross-origin request di atas biasanya memicu preflight karena `application/json` bukan CORS-safelisted `Content-Type`.

Banyak orang salah menyimpulkan:

> “POST memicu preflight.”

Lebih tepat:

> “Kombinasi method, headers, content-type, mode, dan origin menentukan apakah preflight terjadi.”

### 8.2 Custom Header Memicu Preflight

Contoh:

```ts
fetch("https://api.example.com/orders", {
  headers: {
    "X-Request-Id": crypto.randomUUID()
  }
});
```

Jika cross-origin, `X-Request-Id` tidak safelisted, sehingga browser perlu preflight:

```http
OPTIONS /orders HTTP/2
Origin: https://app.example.com
Access-Control-Request-Method: GET
Access-Control-Request-Headers: x-request-id
```

Server harus menjawab:

```http
HTTP/2 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET
Access-Control-Allow-Headers: X-Request-Id
Access-Control-Max-Age: 600
```

Jika tidak, actual request tidak dikirim.

### 8.3 Response Header Terlihat di Network, Tapi `response.headers.get()` Null

Kasus umum:

```http
HTTP/2 200 OK
X-Request-Id: req_123
```

Di DevTools terlihat. Tetapi:

```ts
const response = await fetch("https://api.example.com/data");
console.log(response.headers.get("x-request-id")); // null
```

Penyebab: cross-origin response tidak mengekspos header tersebut ke JavaScript.

Solusi:

```http
Access-Control-Expose-Headers: X-Request-Id
```

Untuk beberapa header standar/safelisted, browser mengekspos secara default. Untuk custom header, expose eksplisit.

### 8.4 `Access-Control-Allow-Headers` Bukan untuk Response Headers

Kesalahan umum:

```http
Access-Control-Allow-Headers: X-Request-Id
```

Lalu berharap frontend bisa membaca `X-Request-Id` response.

Padahal:

- `Access-Control-Allow-Headers` = request headers apa yang boleh dikirim pada actual request setelah preflight.
- `Access-Control-Expose-Headers` = response headers apa yang boleh dibaca JavaScript.

Jadi:

```http
Access-Control-Allow-Headers: Authorization, Content-Type, X-Request-Id
Access-Control-Expose-Headers: X-Request-Id, ETag
```

Dua header ini menyelesaikan masalah berbeda.

---

## 9. Header dan Cache: `Vary` adalah Pedang Bermata Dua

Header caching akan dibahas lebih dalam di Part 014 dan Part 015, tetapi bagian ini perlu memperkenalkan `Vary` karena ia sangat header-centric.

### 9.1 Apa Itu `Vary`?

`Vary` memberi tahu cache bahwa response tergantung pada nilai request header tertentu.

Contoh:

```http
Vary: Accept-Encoding
```

Artinya response gzip/br/plain adalah variant berbeda.

Contoh lain:

```http
Vary: Origin
```

Artinya response CORS berbeda berdasarkan `Origin` request.

Contoh lain:

```http
Vary: Accept-Language
```

Artinya response bahasa Indonesia dan English adalah variant berbeda.

### 9.2 Bug Tanpa `Vary: Origin`

Misal server melakukan dynamic CORS:

Request dari app A:

```http
Origin: https://app-a.example.com
```

Response:

```http
Access-Control-Allow-Origin: https://app-a.example.com
```

Request dari app B:

```http
Origin: https://app-b.example.com
```

Response seharusnya:

```http
Access-Control-Allow-Origin: https://app-b.example.com
```

Jika response di-cache oleh CDN tanpa `Vary: Origin`, CDN bisa menyajikan response app A ke app B:

```http
Access-Control-Allow-Origin: https://app-a.example.com
```

Browser app B akan menolak.

Atau lebih buruk: jika cache/policy salah, data bisa bocor.

Jika CORS allow-origin dibuat dinamis berdasarkan request origin, biasanya perlu:

```http
Vary: Origin
```

### 9.3 Bug dengan `Vary` Terlalu Banyak

`Vary` benar secara semantic tetapi bisa menghancurkan cache efficiency.

Contoh:

```http
Vary: User-Agent, Accept-Language, Origin, Authorization
```

Efek:

- cache key explosion;
- hit ratio turun;
- CDN storage meningkat;
- debugging makin sulit;
- response personalization risk meningkat jika tidak jelas.

Rule of thumb:

> Tambahkan `Vary` hanya ketika response benar-benar berbeda berdasarkan request header tersebut.

### 9.4 `Authorization` dan Cache

Request dengan `Authorization` sering user-specific.

Jika response user-specific, hindari shared cache:

```http
Cache-Control: private, no-store
```

atau gunakan konfigurasi sangat eksplisit jika memang ingin cache shared untuk authenticated request. Jangan “mengandalkan CDN tahu sendiri”.

### 9.5 Personalized Response Leak

Anti-pattern:

```http
HTTP/2 200 OK
Cache-Control: public, max-age=300
Content-Type: application/json

{"userId":"123","email":"ayu@example.com"}
```

Jika response ini dari endpoint user-specific seperti `/api/me`, shared cache dapat menyajikan data user A ke user B.

Correctness harus lebih penting daripada cache hit ratio.

---

## 10. Header dan Security: Browser Policy Delivery Mechanism

Security headers tidak hanya “hardening checklist”. Mereka adalah cara server mengirim policy ke browser.

### 10.1 `Content-Security-Policy`

Contoh:

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-abc123'; connect-src 'self' https://api.example.com
```

CSP dapat mengontrol:

- script source;
- style source;
- image source;
- font source;
- API connection source;
- iframe/frame source;
- form action;
- report endpoint;
- frame ancestors.

Frontend implications:

- Inline script bisa diblokir.
- Third-party analytics bisa gagal.
- API call bisa gagal jika `connect-src` tidak mengizinkan domain API.
- WebSocket butuh `connect-src wss://...`.
- CSS-in-JS bisa butuh nonce/hash strategy.
- Deployment asset domain harus masuk policy.

CSP adalah policy engineering, bukan sekadar satu header copy-paste.

### 10.2 `Strict-Transport-Security`

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

HSTS memberi tahu browser untuk selalu memakai HTTPS untuk host tersebut selama periode tertentu.

Frontend implications:

- Mengurangi downgrade attack.
- Bisa merusak subdomain jika `includeSubDomains` dipasang tanpa kesiapan HTTPS semua subdomain.
- Sulit rollback cepat setelah browser menyimpan policy.

### 10.3 `X-Content-Type-Options: nosniff`

```http
X-Content-Type-Options: nosniff
```

Menginstruksikan browser untuk tidak melakukan MIME sniffing pada konteks tertentu.

Frontend implications:

- Jika JS file disajikan dengan `text/plain`, browser bisa menolak eksekusi.
- Jika CSS disajikan dengan MIME salah, stylesheet bisa gagal.
- Ini baik untuk security tetapi menuntut server/CDN MIME config benar.

### 10.4 `X-Frame-Options` dan `frame-ancestors`

```http
X-Frame-Options: DENY
```

atau CSP:

```http
Content-Security-Policy: frame-ancestors 'self' https://portal.example.com
```

Mengatur siapa yang boleh menampilkan page dalam frame.

Frontend implications:

- Mencegah clickjacking.
- Bisa merusak integrasi embedded dashboard/portal jika tidak dirancang.
- `frame-ancestors` lebih fleksibel daripada `X-Frame-Options`.

### 10.5 `Referrer-Policy`

```http
Referrer-Policy: strict-origin-when-cross-origin
```

Mengatur seberapa banyak URL referrer dikirim.

Frontend implications:

- Mengurangi leakage path/query sensitive.
- Bisa memengaruhi analytics/attribution.
- Jangan memasukkan token/session ID di URL; policy bukan alasan untuk desain buruk.

### 10.6 `Permissions-Policy`

```http
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

Mengontrol API browser apa yang boleh dipakai oleh document/iframe.

Frontend implications:

- Feature bisa gagal bukan karena JavaScript bug, tapi policy.
- Embedded iframe bisa dibatasi.
- Harus sinkron dengan product requirement.

### 10.7 COOP/COEP/CORP

Contoh:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-site
```

Header ini terkait browser isolation dan akan dibahas lebih detail di Part 022.

Frontend implications:

- Resource third-party bisa terblokir.
- SharedArrayBuffer/cross-origin isolation punya requirement khusus.
- Semua resource dependency harus kompatibel.

---

## 11. Header dan Cookies: `Set-Cookie` adalah Special Case

Cookie akan dibahas penuh di Part 012 dan Part 013. Di sini kita fokus pada header mechanics.

### 11.1 `Set-Cookie` Bukan Header List Biasa

Response bisa punya banyak `Set-Cookie`:

```http
Set-Cookie: session=abc; HttpOnly; Secure; SameSite=Lax; Path=/
Set-Cookie: csrf=def; Secure; SameSite=Lax; Path=/
```

Jangan digabung menjadi:

```http
Set-Cookie: session=abc; HttpOnly; Secure; SameSite=Lax; Path=/, csrf=def; Secure; SameSite=Lax; Path=/
```

Itu bisa salah.

Banyak bug terjadi ketika proxy/framework memperlakukan `Set-Cookie` seperti comma-separated list header biasa.

### 11.2 `Set-Cookie` Tidak Dibaca via Fetch Headers

Walaupun response punya:

```http
Set-Cookie: session=abc; HttpOnly; Secure
```

Frontend tidak bisa melakukan:

```ts
response.headers.get("set-cookie")
```

Browser mengelola cookie jar. `Set-Cookie` adalah forbidden response header name untuk exposure ke frontend JavaScript.

### 11.3 Cookie Disimpan Tapi Tidak Dikirim

Kasus umum:

1. Login response punya `Set-Cookie`.
2. DevTools menunjukkan cookie tersimpan.
3. Request berikutnya tidak membawa cookie.

Kemungkinan:

- fetch tidak memakai `credentials: "include"` untuk cross-origin;
- server tidak mengirim `Access-Control-Allow-Credentials: true`;
- `Access-Control-Allow-Origin` memakai `*`, tidak valid untuk credentialed CORS;
- `SameSite` tidak cocok;
- `Secure` tidak cocok di HTTP/local dev;
- domain/path tidak match;
- third-party cookie diblokir;
- request sebenarnya beda site/origin dari yang diasumsikan.

Header saja tidak cukup; cookie behavior adalah kombinasi header + browser policy + request context.

---

## 12. Header dan Observability: Jangan Debug Buta

Untuk sistem enterprise, setiap request penting harus bisa dilacak.

### 12.1 Correlation ID

Request:

```http
X-Request-Id: req_01J0ABC...
```

Response:

```http
X-Request-Id: req_01J0ABC...
```

Frontend usage:

```ts
const requestId = response.headers.get("x-request-id");
```

Agar bisa dibaca cross-origin:

```http
Access-Control-Expose-Headers: X-Request-Id
```

UI error:

```txt
Terjadi gangguan. Support ID: req_01J0ABC
```

Backend logs:

```txt
request_id=req_01J0ABC user_id=123 status=500 duration_ms=812
```

Ini mengubah incident handling dari “tidak bisa reproduce” menjadi traceable.

### 12.2 W3C Trace Context

Modern distributed tracing sering memakai:

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
tracestate: vendor=value
```

Frontend dapat berpartisipasi dalam tracing, tetapi hati-hati:

- Cross-origin custom tracing headers dapat memicu preflight.
- Gateway harus meneruskan header.
- Sampling harus terkendali.
- Jangan menyimpan PII di trace attributes.

### 12.3 `Server-Timing`

Response:

```http
Server-Timing: gateway;dur=8, app;dur=72, db;dur=31
```

Di DevTools, ini bisa muncul sebagai breakdown server.

Prinsip:

- Masukkan timing yang membantu diagnosis.
- Jangan leak nama tabel internal, query detail, tenant sensitive, atau topology rahasia.
- Cocok untuk membedakan server time vs network time.

### 12.4 Header untuk Client Diagnostics

Beberapa header yang berguna:

```http
X-Request-Id: req_123
X-Trace-Id: trace_abc
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 12
X-RateLimit-Reset: 1718700000
Retry-After: 60
Server-Timing: app;dur=42
```

Tetapi semua header yang perlu dibaca JS cross-origin harus diekspos:

```http
Access-Control-Expose-Headers: X-Request-Id, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After, Server-Timing
```

Catatan: jangan expose semua header dengan sembrono. Expose yang memang kontraktual.

---

## 13. Header Size, Bloat, dan Operational Limits

Header terlihat kecil, tetapi bisa menjadi bottleneck.

### 13.1 Header Size Limit

Server, proxy, load balancer, CDN, dan framework punya limit ukuran header.

Gejala:

- `400 Bad Request`;
- `431 Request Header Fields Too Large`;
- request gagal hanya untuk user tertentu;
- login redirect loop;
- cookie terlalu besar;
- header auth token terlalu panjang;
- gateway menolak request sebelum sampai service.

### 13.2 Cookie Bloat

Cookie dikirim pada setiap request yang match domain/path.

Jika cookie besar:

```txt
Request HTML: carries cookie
Request CSS: maybe carries cookie
Request JS: maybe carries cookie
Request image: maybe carries cookie
Request API: carries cookie
```

Konsekuensi:

- bandwidth naik;
- latency naik;
- cacheability turun;
- header limit risk;
- mobile network makin buruk;
- semua request membawa ambient credential yang mungkin tidak perlu.

Praktik:

- minimalkan cookie size;
- gunakan domain/path scope yang sempit;
- pisahkan asset domain cookieless jika perlu;
- jangan simpan profile/permissions besar dalam cookie;
- jangan simpan JWT besar tanpa memahami biaya.

### 13.3 JWT di Header

```http
Authorization: Bearer <very-large-jwt>
```

Masalah:

- dikirim pada setiap API request;
- bisa menyebabkan preflight jika cross-origin;
- bisa bocor ke logs;
- header size bertambah;
- token rotation dan refresh race complexity.

JWT bukan salah, tetapi harus dipakai dengan sadar.

### 13.4 Header Bloat dari Observability

Contoh terlalu banyak:

```http
X-Request-Id: ...
X-Correlation-Id: ...
X-Trace-Id: ...
X-Span-Id: ...
X-B3-TraceId: ...
X-B3-SpanId: ...
traceparent: ...
tracestate: ...
X-Debug-User: ...
X-Debug-Tenant: ...
```

Problem:

- redundant;
- inconsistent;
- PII risk;
- proxy limit;
- unclear source of truth.

Better:

- pilih standard jika mungkin;
- dokumentasikan propagation;
- expose hanya yang dibutuhkan frontend;
- jangan kirim debug headers di production kecuali controlled.

---

## 14. Hop-by-Hop vs End-to-End Headers

HTTP dapat melewati intermediary. Tidak semua header dimaksudkan sampai origin/final recipient.

### 14.1 End-to-End Headers

End-to-end header harus diteruskan ke final recipient, kecuali proxy memang melakukan transformasi valid.

Contoh umum:

```txt
Authorization
Cache-Control
Content-Type
ETag
Accept
Origin
```

### 14.2 Hop-by-Hop Headers

Hop-by-hop header hanya berlaku untuk satu koneksi/transport hop.

Contoh classic:

```txt
Connection
Keep-Alive
Transfer-Encoding
Upgrade
TE
Trailer
Proxy-Authorization
Proxy-Authenticate
```

Kenapa frontend perlu tahu?

Karena saat debugging lewat gateway/CDN, beberapa header mungkin sengaja tidak diteruskan. Selain itu, beberapa security issue muncul dari proxy yang salah menangani hop-by-hop headers.

### 14.3 `Connection` Header Trap

Dalam HTTP/1.1, `Connection` dapat menyebut header lain sebagai hop-by-hop.

Contoh berbahaya jika proxy salah:

```http
Connection: X-Internal-Auth
X-Internal-Auth: admin
```

Intermediary harus hati-hati menghapus header yang ditandai hop-by-hop. Ini lebih banyak urusan proxy/backend, tetapi frontend engineer yang membaca traffic perlu paham bahwa path request melewati banyak layer.

---

## 15. Header Naming: Standard vs Custom

### 15.1 Gunakan Standard Header Jika Ada

Contoh:

| Kebutuhan | Prefer |
|---|---|
| media type body | `Content-Type` |
| accepted response format | `Accept` |
| cache instruction | `Cache-Control` |
| conditional read | `If-None-Match` |
| conditional update | `If-Match` |
| retry delay | `Retry-After` |
| auth credential | `Authorization` |
| creation resource URI | `Location` |
| correlation standard | `traceparent` |

Jangan membuat:

```http
X-Response-Format: json
X-Should-Cache: false
X-Retry-In: 60
X-Auth-Token: abc
```

jika sudah ada header standar yang cocok.

### 15.2 `X-*` Convention

Historically banyak custom header memakai `X-`:

```http
X-Request-Id
X-Tenant-Id
X-API-Version
```

Sekarang `X-` bukan requirement. Banyak sistem tetap memakainya karena legacy dan clarity.

Yang lebih penting dari prefix:

- semantic jelas;
- owner jelas;
- format jelas;
- propagation jelas;
- privacy impact jelas;
- CORS impact jelas;
- cache impact jelas.

### 15.3 Jangan Jadikan Header sebagai Dumping Ground

Anti-pattern:

```http
X-User-Role: admin
X-User-Email: ayu@example.com
X-Feature-A: true
X-Feature-B: false
X-UI-State: expanded
X-Workflow-State: pending-approval
```

Masalah:

- PII leak;
- duplicated business state;
- cache confusion;
- authorization ambiguity;
- inconsistent source of truth;
- preflight overhead;
- harder contract evolution.

Gunakan header untuk metadata protokol/operasional. Gunakan body untuk domain payload.

---

## 16. Practical Header Contract untuk API Frontend

Untuk API production-grade, jangan biarkan header “terbentuk kebetulan” dari framework. Definisikan contract.

### 16.1 Minimal Response Header untuk JSON API

Contoh baseline:

```http
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
X-Request-Id: req_...
```

Untuk cross-origin:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Access-Control-Expose-Headers: X-Request-Id
Vary: Origin
```

Jika API punya rate limit:

```http
RateLimit-Limit: 100
RateLimit-Remaining: 42
RateLimit-Reset: 60
Retry-After: 60
Access-Control-Expose-Headers: X-Request-Id, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After
```

Catatan: beberapa ekosistem masih memakai `X-RateLimit-*`; pilih dan dokumentasikan.

### 16.2 Static Asset Header

Untuk asset fingerprinted:

```http
Content-Type: application/javascript; charset=utf-8
Cache-Control: public, max-age=31536000, immutable
Content-Encoding: br
Vary: Accept-Encoding
X-Content-Type-Options: nosniff
```

Untuk HTML app shell:

```http
Content-Type: text/html; charset=utf-8
Cache-Control: no-cache
Content-Security-Policy: ...
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
```

Kenapa beda?

- HTML menentukan versi aplikasi yang harus bisa revalidate.
- Fingerprinted JS/CSS aman dicache lama karena URL berubah saat content berubah.

### 16.3 File Download Header

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="invoice-123.pdf"
Content-Length: 1048576
Cache-Control: private, no-store
X-Request-Id: req_...
Access-Control-Expose-Headers: Content-Disposition, Content-Length, X-Request-Id
```

Frontend perlu expose `Content-Disposition` jika ingin membaca filename dari JS pada cross-origin download.

### 16.4 Upload Endpoint Header

Request:

```http
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary...
```

Penting untuk frontend:

```ts
const formData = new FormData();
formData.append("file", file);

await fetch("/api/upload", {
  method: "POST",
  body: formData
});
```

Jangan set manual:

```ts
headers: {
  "Content-Type": "multipart/form-data"
}
```

Karena browser perlu menambahkan boundary. Jika Anda set manual tanpa boundary, server bisa gagal parse.

---

## 17. Debugging Header di DevTools: Cara Membaca yang Benar

Saat membuka DevTools → Network → request tertentu, jangan hanya lihat status dan response body.

Gunakan urutan ini.

### 17.1 Request URL dan Origin Context

Pertanyaan:

- URL target apa?
- Page origin apa?
- Same-origin, same-site, atau cross-origin?
- Protocol HTTPS atau HTTP?
- Redirect terjadi atau tidak?

### 17.2 Request Headers

Periksa:

- `Origin`
- `Referer`
- `Cookie`
- `Authorization`
- `Content-Type`
- `Accept`
- custom headers
- `Sec-Fetch-*`

Pertanyaan:

- Header yang Anda kira terkirim memang terkirim?
- Cookie ada?
- Authorization ada?
- Custom header menyebabkan preflight?
- Request mode terlihat dari `Sec-Fetch-Mode`?

### 17.3 Preflight

Jika ada `OPTIONS` sebelum request:

Periksa request preflight:

```http
Access-Control-Request-Method
Access-Control-Request-Headers
Origin
```

Periksa response preflight:

```http
Access-Control-Allow-Origin
Access-Control-Allow-Methods
Access-Control-Allow-Headers
Access-Control-Allow-Credentials
Access-Control-Max-Age
```

Pertanyaan:

- Server mengizinkan method actual?
- Server mengizinkan header actual?
- Origin cocok persis?
- Credential policy cocok?
- Status preflight sukses?

### 17.4 Response Headers

Periksa:

- `Content-Type`
- `Cache-Control`
- `ETag`
- `Location`
- `Set-Cookie`
- `Access-Control-*`
- `Vary`
- `X-Request-Id`
- `Server-Timing`
- CDN headers

Pertanyaan:

- Body type cocok?
- Cache behavior benar?
- Cookie diterima/diblokir browser?
- Header custom perlu dibaca JS sudah di-expose?
- Response dari CDN cache atau origin?

### 17.5 Compare “Visible in DevTools” vs “Accessible in JS”

DevTools menunjukkan network-level visibility. JavaScript punya browser policy visibility.

Contoh:

```ts
response.headers.get("x-request-id")
```

bisa `null` walaupun DevTools menampilkan `X-Request-Id`.

Diagnosis:

- Jika same-origin: biasanya accessible.
- Jika cross-origin: cek `Access-Control-Expose-Headers`.
- Jika forbidden response header seperti `Set-Cookie`: tidak accessible.

---

## 18. Real Production Failure Patterns

### 18.1 “API Berhasil di Postman, Gagal di Browser”

Penyebab umum:

- Postman tidak menjalankan Same-Origin Policy.
- Postman tidak menjalankan CORS.
- Postman bebas set forbidden headers.
- Browser melakukan preflight.
- Browser tidak expose response header.
- Cookie behavior browser berbeda.

Debug:

```txt
1. Apakah request cross-origin?
2. Apakah ada preflight?
3. Apakah preflight berhasil?
4. Apakah actual response punya Access-Control-Allow-Origin yang cocok?
5. Apakah credentials mode cocok?
6. Apakah header yang ingin dibaca di-expose?
```

### 18.2 “Login Sukses, Tapi Request Berikutnya Tidak Authenticated”

Kemungkinan:

- `Set-Cookie` diblokir karena `SameSite=None` tanpa `Secure`.
- fetch login tidak memakai `credentials: "include"`.
- fetch API berikutnya tidak memakai `credentials: "include"`.
- CORS tidak mengizinkan credentials.
- Cookie domain/path tidak match.
- API beda site.
- Browser privacy setting memblokir third-party cookie.

Header yang harus dicek:

```http
Set-Cookie
Cookie
Access-Control-Allow-Origin
Access-Control-Allow-Credentials
Vary
```

### 18.3 “Response Header Ada, Tapi Tidak Bisa Dibaca”

Penyebab:

```http
X-Request-Id: req_123
```

tidak diikuti:

```http
Access-Control-Expose-Headers: X-Request-Id
```

### 18.4 “CDN Cache Salah User”

Gejala:

- user melihat data user lain;
- backend log tidak menunjukkan request;
- response punya `Age` tinggi atau `X-Cache: HIT`;
- endpoint user-specific punya `Cache-Control: public`.

Fix:

```http
Cache-Control: private, no-store
```

atau desain cache key dan personalization secara eksplisit.

### 18.5 “Preflight Storm”

Gejala:

- setiap API call diawali `OPTIONS`;
- latency naik;
- gateway logs penuh OPTIONS;
- mobile user merasakan lambat.

Penyebab:

- custom headers terlalu banyak;
- `Authorization` cross-origin;
- `Content-Type: application/json`;
- `Access-Control-Max-Age` terlalu rendah/tidak ada;
- API domain dipisah dari app domain.

Mitigasi:

- same-origin deployment via reverse proxy/BFF jika cocok;
- set `Access-Control-Max-Age` reasonable;
- kurangi custom header;
- batch request;
- pahami bahwa JSON POST cross-origin memang sering preflight.

### 18.6 “Static JS Tidak Dieksekusi”

Penyebab:

```http
Content-Type: text/plain
X-Content-Type-Options: nosniff
```

Browser menolak script karena MIME type salah.

Fix:

```http
Content-Type: application/javascript; charset=utf-8
```

### 18.7 “Font Gagal Load”

Kemungkinan:

- font dari cross-origin CDN tanpa CORS header;
- CSP `font-src` tidak mengizinkan domain;
- CORP/COEP policy memblokir;
- MIME type salah.

Header yang dicek:

```http
Access-Control-Allow-Origin
Content-Type
Content-Security-Policy
Cross-Origin-Resource-Policy
```

---

## 19. Header Decision Framework

Saat ingin menambah header baru, gunakan pertanyaan ini.

### 19.1 Apakah Sudah Ada Header Standar?

Jika ya, gunakan standar.

Contoh:

- retry delay → `Retry-After`
- created resource URI → `Location`
- cache instruction → `Cache-Control`
- content type → `Content-Type`
- auth → `Authorization`
- tracing → `traceparent`

### 19.2 Header Ini Request atau Response?

Jangan campur.

- Request header menyatakan metadata dari client/request.
- Response header menyatakan metadata dari server/response.

### 19.3 Apakah Header Ini Akan Memicu Preflight?

Jika header dikirim dari browser ke cross-origin API dan tidak safelisted, kemungkinan iya.

Tanyakan:

- Apakah preflight acceptable?
- Apakah latency overhead masuk budget?
- Apakah gateway handle OPTIONS?
- Apakah `Access-Control-Allow-Headers` diset?
- Apakah `Access-Control-Max-Age` diset?

### 19.4 Apakah Header Ini Perlu Dibaca JavaScript?

Jika response cross-origin dan JS perlu membaca:

```http
Access-Control-Expose-Headers: Header-Name
```

Jika tidak perlu dibaca JS, jangan expose.

### 19.5 Apakah Header Ini Mengandung Data Sensitif?

Jangan masukkan:

- email;
- user full name;
- permissions detail;
- internal role;
- token;
- tenant secret;
- raw error cause;
- internal hostnames;
- query details;
- PII.

Header sering masuk logs lebih mudah daripada body.

### 19.6 Apakah Header Ini Memengaruhi Cache?

Jika response berubah berdasarkan request header, mungkin perlu `Vary`.

Tetapi `Vary` menambah cache cardinality.

### 19.7 Apakah Header Ini Harus Melewati Gateway/CDN?

Pastikan:

- allowlist proxy;
- CORS allow headers;
- logging redaction;
- tracing propagation;
- CDN cache key config;
- WAF rule tidak memblokir.

### 19.8 Siapa Owner Semantic Header Ini?

Header custom tanpa owner akan membusuk.

Dokumentasikan:

```yaml
Header: X-Request-Id
Direction: request + response
Owner: platform
Purpose: correlation id
Format: lowercase prefix req_ + ULID
Required: yes for API responses
CORS exposed: yes
Sensitive: no
Generated by: edge if missing
Propagated to: gateway, services, logs
```

---

## 20. Header Contract Examples

### 20.1 Authenticated SPA API

Request:

```http
GET /api/me HTTP/2
Host: api.example.com
Accept: application/json
Origin: https://app.example.com
Cookie: session=abc
Sec-Fetch-Site: same-site
Sec-Fetch-Mode: cors
Sec-Fetch-Dest: empty
```

Response:

```http
HTTP/2 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: private, no-store
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Access-Control-Expose-Headers: X-Request-Id
Vary: Origin
X-Request-Id: req_01J0ABC

{"id":"u123","name":"Ayu"}
```

Invariant:

- User-specific response tidak masuk shared cache.
- Credentialed CORS origin eksplisit, bukan wildcard.
- Request ID bisa dibaca frontend.

### 20.2 Public Catalog API with Cache

Request:

```http
GET /api/products?category=book HTTP/2
Accept: application/json
Origin: https://shop.example.com
```

Response:

```http
HTTP/2 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: public, max-age=60, stale-while-revalidate=300
ETag: "products-book-v42"
Access-Control-Allow-Origin: *
X-Request-Id: req_789
Access-Control-Expose-Headers: ETag, X-Request-Id

{"items":[...]}
```

Invariant:

- Public data aman untuk public cache.
- Wildcard CORS boleh karena tidak credentialed.
- ETag exposed jika frontend ingin aware validator.

### 20.3 Mutation with Idempotency Key

Request:

```http
POST /api/payments HTTP/2
Content-Type: application/json
Accept: application/json
Idempotency-Key: pay_01J0ABC
Authorization: Bearer eyJ...
Origin: https://app.example.com

{"amount":100000,"currency":"IDR"}
```

Preflight consequence:

```txt
Content-Type: application/json + Authorization + Idempotency-Key
→ cross-origin preflight likely.
```

CORS preflight response must allow:

```http
Access-Control-Allow-Headers: Authorization, Content-Type, Idempotency-Key
Access-Control-Allow-Methods: POST
```

Actual response:

```http
HTTP/2 201 Created
Content-Type: application/json; charset=utf-8
Location: /api/payments/pmt_123
Cache-Control: no-store
X-Request-Id: req_456
Access-Control-Expose-Headers: Location, X-Request-Id

{"id":"pmt_123","status":"processing"}
```

Invariant:

- Mutation retry-safe karena idempotency key.
- Location exposed jika frontend butuh resource URI.
- No-store karena payment sensitive.

### 20.4 Long-Running Operation

Initial response:

```http
HTTP/2 202 Accepted
Content-Type: application/json; charset=utf-8
Location: /api/jobs/job_123
Retry-After: 5
Cache-Control: no-store
X-Request-Id: req_abc
Access-Control-Expose-Headers: Location, Retry-After, X-Request-Id

{"jobId":"job_123","status":"queued"}
```

Frontend behavior:

- Poll `Location`.
- Use `Retry-After` as minimum delay.
- Show queued/progress UI.
- Preserve `X-Request-Id` for support.

---

## 21. Header Anti-Patterns dan Replacement

### 21.1 Anti-Pattern: Semua Response `Cache-Control: no-cache`

Problem:

- Static assets tidak optimal.
- API sensitive mungkin masih bisa disimpan dan harus revalidate.
- Developer salah memahami `no-cache`.

Replacement:

```http
# Sensitive API
Cache-Control: no-store

# User-specific but revalidatable
Cache-Control: private, no-cache
ETag: "..."

# Fingerprinted assets
Cache-Control: public, max-age=31536000, immutable

# HTML app shell
Cache-Control: no-cache
```

### 21.2 Anti-Pattern: `Access-Control-Allow-Origin: *` Everywhere

Problem:

- Tidak valid untuk credentialed CORS.
- Membuka API public read jika tidak intended.
- Menyembunyikan origin policy yang sebenarnya.

Replacement:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

atau untuk public non-credentialed resource:

```http
Access-Control-Allow-Origin: *
```

### 21.3 Anti-Pattern: Custom Header untuk Semua Metadata

Problem:

```http
X-User-Id: 123
X-User-Role: admin
X-Page-Name: dashboard
X-Action: approve
```

Replacement:

- Domain data di body.
- Identity dari auth/session di server context.
- UI analytics lewat dedicated analytics event, bukan API headers.
- Request correlation pakai `X-Request-Id`/`traceparent`.

### 21.4 Anti-Pattern: Response Header Dibutuhkan Frontend Tapi Tidak Di-Expose

Problem:

```ts
response.headers.get("x-request-id") // null
```

Replacement:

```http
Access-Control-Expose-Headers: X-Request-Id
```

### 21.5 Anti-Pattern: Logging Semua Header Mentah

Problem:

- token leak;
- cookie leak;
- PII leak;
- compliance risk.

Replacement:

- redact `Authorization`;
- redact `Cookie`;
- redact `Set-Cookie`;
- log whitelisted diagnostic headers;
- generate safe request ID.

### 21.6 Anti-Pattern: Manual `Content-Type` untuk `FormData`

Problem:

```ts
fetch("/upload", {
  method: "POST",
  headers: { "Content-Type": "multipart/form-data" },
  body: formData
});
```

Missing boundary.

Replacement:

```ts
fetch("/upload", {
  method: "POST",
  body: formData
});
```

Let browser set `Content-Type` with boundary.

### 21.7 Anti-Pattern: Treat Headers as Case-Sensitive

Problem:

```ts
response.headers.get("X-Request-Id")
```

In Fetch, `Headers.get()` is case-insensitive, but backend/proxy/custom code may not be. Jangan membuat logic internal yang case-sensitive.

Replacement:

- normalize field names;
- document canonical spelling for readability;
- do not depend on casing.

---

## 22. Java/Spring Backend Lens: Kenapa Ini Penting untuk Anda

Karena Anda Java engineer, penting memahami dampak framework/gateway.

### 22.1 Spring Security dan CORS Ordering

Banyak bug terjadi karena CORS diproses setelah authentication.

Preflight `OPTIONS` tidak membawa credential seperti actual request. Jika security filter menuntut auth untuk `OPTIONS`, preflight bisa 401/403.

Correct model:

```txt
CORS preflight should be answered as policy check,
before actual endpoint auth semantics block it.
```

### 22.2 Servlet Filters Menambah Header

Common filters:

- request ID filter;
- security header filter;
- CORS filter;
- compression filter;
- logging filter;
- auth filter.

Order matters.

Example failure:

```txt
Exception thrown before request ID response header added.
Frontend receives 500 with no X-Request-Id.
Support cannot correlate.
```

Better:

- generate request ID at earliest edge/filter;
- always add it to response, including errors;
- propagate via MDC/logging context;
- expose via CORS if frontend needs it.

### 22.3 Gateway vs Service Responsibility

Pertanyaan desain:

| Header | Better owner |
|---|---|
| `Strict-Transport-Security` | edge/gateway |
| `Content-Security-Policy` | app/edge jointly |
| `X-Request-Id` | edge/gateway generated, service propagated |
| `Cache-Control` API | service/domain owner |
| `Access-Control-*` | gateway/platform with app policy input |
| `Content-Type` | service/framework |
| `Server-Timing` | gateway + service |
| `Set-Cookie` | auth/session service |

Tidak semua header harus diset di tiap service.

### 22.4 Reverse Proxy Header Trust

Backend sering membaca:

```http
X-Forwarded-Proto
X-Forwarded-Host
X-Forwarded-For
```

Hati-hati:

- header ini bisa dipalsukan oleh client jika edge tidak membersihkan;
- aplikasi hanya boleh trust header dari known proxy;
- salah trust bisa membuat redirect URL salah, HTTPS detection salah, secure cookie salah.

---

## 23. Latihan Praktis

### Latihan 1 — Header Classification

Klasifikasikan header berikut:

```http
Accept: application/json
Content-Type: application/json
Cache-Control: private, no-store
ETag: "abc"
If-None-Match: "abc"
Origin: https://app.example.com
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Expose-Headers: X-Request-Id
Set-Cookie: session=abc; HttpOnly; Secure; SameSite=Lax
Authorization: Bearer token
X-Request-Id: req_123
Server-Timing: app;dur=42
Content-Security-Policy: default-src 'self'
Vary: Origin
```

Jawab berdasarkan kategori:

- negotiation;
- representation;
- cache;
- conditional;
- CORS;
- cookie;
- auth;
- observability;
- security.

### Latihan 2 — Diagnose Header Bug

Kasus:

```ts
const response = await fetch("https://api.example.com/report", {
  credentials: "include"
});

console.log(response.headers.get("x-request-id")); // null
```

DevTools response:

```http
HTTP/2 200 OK
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
X-Request-Id: req_123
Content-Type: application/json
```

Pertanyaan:

1. Kenapa `x-request-id` null?
2. Header apa yang perlu ditambahkan?
3. Apakah request credentialed CORS sudah benar?

Jawaban:

1. Karena cross-origin response tidak expose `X-Request-Id` ke JS secara default.
2. Tambahkan:

```http
Access-Control-Expose-Headers: X-Request-Id
```

3. Credentialed CORS tampak benar karena origin eksplisit dan `Access-Control-Allow-Credentials: true`, asalkan fetch memakai `credentials: "include"` dan cookie attributes sesuai.

### Latihan 3 — Preflight Trigger

Manakah yang likely memicu preflight jika cross-origin?

A:

```ts
fetch("https://api.example.com/items");
```

B:

```ts
fetch("https://api.example.com/items", {
  headers: { "X-Request-Id": "abc" }
});
```

C:

```ts
fetch("https://api.example.com/items", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}"
});
```

D:

```ts
fetch("https://api.example.com/items", {
  method: "POST",
  headers: { "Content-Type": "text/plain" },
  body: "hello"
});
```

Expected:

- A: biasanya tidak.
- B: ya, custom header.
- C: ya, `application/json` bukan CORS-safelisted content type.
- D: tidak selalu, karena `text/plain` safelisted jika constraint lain terpenuhi.

### Latihan 4 — Cache Leak Review

Review response:

```http
HTTP/2 200 OK
Content-Type: application/json
Cache-Control: public, max-age=300
Set-Cookie: session=abc; HttpOnly; Secure

{"id":"u123","email":"ayu@example.com"}
```

Masalah:

- user-specific body;
- `Set-Cookie`;
- `public` shared cache;
- possible personalized data leak.

Better:

```http
Cache-Control: private, no-store
```

atau desain explicit safe cache.

---

## 24. Checklist Review Header untuk Frontend/API PR

Gunakan checklist ini saat review endpoint baru.

### 24.1 Request Side

- [ ] Method sudah sesuai semantic?
- [ ] `Content-Type` hanya dikirim saat ada body?
- [ ] `Accept` jelas jika API punya variants?
- [ ] Custom request headers benar-benar perlu?
- [ ] Custom headers memicu preflight dan sudah dipertimbangkan?
- [ ] Credential mode sesuai cookie/auth model?
- [ ] Tidak ada token/PII di header yang tidak perlu?
- [ ] Idempotency key dipakai untuk mutation yang retryable?

### 24.2 Response Side

- [ ] `Content-Type` benar untuk body?
- [ ] `Cache-Control` eksplisit?
- [ ] User-specific response tidak public cache?
- [ ] Static asset punya cache policy sesuai fingerprinting?
- [ ] Error response tetap punya content type dan request ID?
- [ ] `Location` digunakan untuk 201/202 jika relevan?
- [ ] `Retry-After` digunakan untuk 429/503 jika relevan?
- [ ] `ETag`/conditional headers dipakai jika caching/concurrency butuh?

### 24.3 CORS

- [ ] Origin policy eksplisit?
- [ ] Credentialed CORS tidak memakai wildcard?
- [ ] `Access-Control-Allow-Headers` mencakup request headers aktual?
- [ ] `Access-Control-Expose-Headers` mencakup response headers yang perlu dibaca JS?
- [ ] `Vary: Origin` ada jika allow-origin dynamic?
- [ ] Preflight tidak diblokir auth middleware?
- [ ] `Access-Control-Max-Age` reasonable?

### 24.4 Security

- [ ] CSP sesuai asset/API domains?
- [ ] `X-Content-Type-Options: nosniff` aman karena MIME config benar?
- [ ] HSTS dipasang di layer yang tepat?
- [ ] Referrer policy tidak leak query sensitive?
- [ ] Frame policy sesuai embedding requirement?
- [ ] Permissions policy tidak memblokir feature yang dibutuhkan?

### 24.5 Observability

- [ ] Request ID selalu ada termasuk error?
- [ ] Request ID exposed jika frontend perlu membaca?
- [ ] Trace context propagated?
- [ ] Sensitive headers diredaCted di logs?
- [ ] `Server-Timing` aman dan berguna?

### 24.6 Intermediary/CDN

- [ ] Header tidak dihapus gateway?
- [ ] CDN cache key sesuai `Vary`?
- [ ] Compression headers benar?
- [ ] Cookie tidak dikirim ke asset domain jika tidak perlu?
- [ ] Forwarded headers trusted hanya dari proxy resmi?

---

## 25. Ringkasan Mental Model

Headers adalah bagian HTTP yang mengendalikan perilaku.

Ingat lima prinsip:

### Prinsip 1 — Header adalah metadata bersemantik, bukan dictionary biasa

Header punya grammar, ownership, security constraint, visibility rules, dan intermediary behavior.

### Prinsip 2 — Browser adalah HTTP client dengan policy layer

JavaScript tidak bebas mengatur semua header. Browser mengontrol header sensitif seperti `Cookie`, `Host`, `Content-Length`, `Origin`, dan `Sec-*`.

### Prinsip 3 — CORS sangat header-driven

Preflight, allowed request headers, exposed response headers, credentials, dan dynamic origin semuanya bergantung pada header.

### Prinsip 4 — Cache correctness sering ditentukan oleh header

`Cache-Control`, `ETag`, `Vary`, `Age`, dan `Authorization` bisa menentukan apakah response fresh, stale, private, public, atau berbahaya.

### Prinsip 5 — Production debugging membutuhkan header literacy

DevTools Network bukan hanya tempat melihat status/body. Header adalah bukti utama untuk memahami:

- request context;
- browser policy;
- auth/cookie behavior;
- cache behavior;
- security blocking;
- CDN/proxy effects;
- observability correlation.

---

## 26. Apa yang Harus Anda Kuasai Sebelum Lanjut

Sebelum masuk Part 007, pastikan Anda bisa menjawab:

1. Apa beda request header dan response header?
2. Apa beda `Content-Type` dan `Accept`?
3. Kenapa JavaScript tidak bisa set `Cookie` header manual?
4. Kenapa custom header bisa memicu preflight?
5. Apa beda `Access-Control-Allow-Headers` dan `Access-Control-Expose-Headers`?
6. Kenapa `Vary: Origin` penting untuk dynamic CORS?
7. Kenapa `Set-Cookie` special?
8. Kenapa `Cache-Control: no-cache` bukan berarti “do not store”?
9. Header apa yang perlu dicek saat login cookie gagal?
10. Header apa yang perlu dicek saat response terlihat di DevTools tapi tidak bisa dibaca JS?
11. Kenapa `X-Request-Id` harus dirancang sebagai contract, bukan kebetulan?
12. Kenapa security headers bisa menyebabkan frontend resource gagal load?

Jika jawaban Anda sudah jelas, Anda siap masuk ke body/payload/media type.

---

## 27. Referensi Utama

Referensi ini tidak perlu dihafal, tetapi penting sebagai anchor ketika terjadi perdebatan desain atau debugging:

- RFC 9110 — HTTP Semantics: arsitektur HTTP, terminology, methods, status, fields, representations.
- RFC 9111 — HTTP Caching: cache behavior dan cache-related header fields.
- WHATWG Fetch Standard: model fetch browser, forbidden headers, CORS, request/response handling.
- MDN HTTP Headers Reference: referensi praktis header HTTP browser.
- MDN CORS documentation: penjelasan praktis CORS, safelisted headers, expose headers.
- MDN Fetch API: perilaku fetch dari sisi JavaScript/browser.

---

## 28. Status Seri

```txt
Part 006 selesai.
Seri belum selesai.
Lanjut ke Part 007: Body, Payload, Representation, Media Type, and Encoding.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-005.md">⬅️ Part 005 — Status Codes: Reading Outcomes Like a Protocol Engineer</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-007.md">Body, Payload, Representation, Media Type, and Encoding ➡️</a>
</div>

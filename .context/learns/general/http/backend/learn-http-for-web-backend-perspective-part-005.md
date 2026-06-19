# learn-http-for-web-backend-perspective-part-005.md

# Part 005 — Headers as Backend Control Plane

> Seri: **HTTP for Web / Backend Perspective**  
> Context utama: **Java Software Engineer**  
> Fokus: memahami HTTP headers sebagai **metadata contract**, **routing/control signal**, **security boundary**, **observability carrier**, dan **proxy/application coordination layer**.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- Part 000: mental model HTTP backend.
- Part 001: semantics dari sudut pandang server.
- Part 002: lifecycle request dari socket sampai controller.
- Part 003: method sebagai kontrak correctness.
- Part 004: status code sebagai kontrak state backend.

Part ini membahas **headers**.

Banyak engineer memperlakukan header sebagai “metadata tambahan”. Itu tidak salah, tetapi terlalu dangkal. Dari perspektif backend production, header adalah salah satu **control plane** paling penting dalam HTTP.

Header dapat menentukan:

- bagaimana body harus diparse;
- apakah response boleh dicache;
- apakah request berasal dari HTTPS atau HTTP setelah melewati proxy;
- identitas request untuk tracing;
- apakah client meminta JSON, PDF, CSV, atau format lain;
- apakah operasi conditional boleh dilakukan;
- apakah response aman dirender di browser;
- apakah request melewati gateway yang trusted atau spoofed;
- apakah downstream boleh melakukan retry atau harus menolak;
- apakah request terlalu besar, terlalu mahal, atau mencurigakan.

Karena itu, part ini bukan daftar hafalan header. Kita akan membangun mental model agar kamu bisa mendesain dan mendiagnosis HTTP backend dengan presisi.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Membedakan header sebagai **representation metadata**, **routing metadata**, **cache control**, **security policy**, **tracing metadata**, dan **proxy metadata**.
2. Memahami perbedaan **end-to-end headers** dan **hop-by-hop headers**.
3. Menentukan header mana yang boleh dipercaya oleh aplikasi dan mana yang harus dianggap input tidak terpercaya.
4. Mendesain response header yang benar untuk JSON API, file download, cacheable response, sensitive response, dan async operation.
5. Mendiagnosis bug production yang muncul karena header hilang, salah, diduplikasi, ditimpa proxy, atau disalahartikan framework.
6. Menggunakan header secara benar di Java/Spring MVC dan WebFlux.
7. Membuat checklist backend untuk header correctness, security, observability, dan interoperability.

---

## 2. Mental Model Utama: Header adalah Control Plane

Dalam sistem backend, ada dua jenis informasi besar:

1. **Data plane**  
   Isi aktual yang diproses: JSON body, file, stream, command payload, response representation.

2. **Control plane**  
   Informasi yang mengontrol cara data dipahami, ditransfer, diamankan, dirutekan, dicache, dan diobservasi.

HTTP headers sebagian besar berada di control plane.

Contoh:

```http
POST /cases HTTP/1.1
Host: api.example.gov
Content-Type: application/json
Accept: application/json
Authorization: Bearer eyJ...
Idempotency-Key: 6f2d7e9a-7a7d-4e9c-a8b6-2c2b7e9c9a1a
Traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
Content-Length: 187

{
  "type": "complaint",
  "subjectId": "SUBJ-123"
}
```

Body berisi data domain. Header mengontrol:

- `Host`: virtual host / authority.
- `Content-Type`: cara parse body.
- `Accept`: format response yang diharapkan.
- `Authorization`: credential.
- `Idempotency-Key`: deduplication/retry behavior.
- `Traceparent`: distributed tracing.
- `Content-Length`: framing/body boundary.

Jika header salah, body yang benar pun bisa gagal diproses.

---

## 3. Header Bukan Satu Kategori: Peta Besar

Untuk backend engineer, lebih berguna mengelompokkan header berdasarkan fungsinya.

| Kategori | Contoh Header | Fungsi Backend |
|---|---|---|
| Message framing | `Content-Length`, `Transfer-Encoding` | Menentukan batas body dan cara membaca message |
| Representation metadata | `Content-Type`, `Content-Encoding`, `Content-Language` | Menjelaskan representasi body |
| Negotiation | `Accept`, `Accept-Encoding`, `Accept-Language` | Client menyatakan bentuk response yang bisa diterima |
| Cache | `Cache-Control`, `ETag`, `Last-Modified`, `Vary`, `Expires` | Mengontrol reuse response |
| Conditional request | `If-Match`, `If-None-Match`, `If-Unmodified-Since` | Optimistic concurrency dan validation |
| Authentication | `Authorization`, `WWW-Authenticate` | Credential dan challenge |
| Browser/security policy | `Set-Cookie`, `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options` | Security boundary browser-facing API |
| Proxy/forwarding | `Forwarded`, `X-Forwarded-For`, `X-Forwarded-Proto`, `Host` | Menyampaikan original request context |
| Observability | `Traceparent`, `Tracestate`, `Baggage`, `X-Request-ID`, `Correlation-ID` | Request correlation dan tracing |
| Rate limiting | `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` | Mengomunikasikan throttling policy |
| File/download | `Content-Disposition`, `Accept-Ranges`, `Range` | Download behavior dan partial content |
| CORS | `Origin`, `Access-Control-Allow-Origin`, `Access-Control-Allow-Headers` | Browser access declaration |

Kesalahan umum: header dipakai tanpa tahu kategorinya. Misalnya:

- `Content-Type` dipakai untuk meminta response, padahal itu tugas `Accept`.
- `X-Forwarded-For` dipercaya langsung, padahal bisa spoofed kalau tidak dikontrol di proxy boundary.
- `Cache-Control: public` dikirim untuk response user-specific.
- `Vary: Origin` lupa saat response CORS berbeda per origin.
- `Content-Disposition` tidak disanitasi sehingga raw filename dari user bisa masuk header.

---

## 4. Struktur Header dalam HTTP

Secara konseptual, header adalah pasangan nama dan nilai.

```http
Header-Name: header value
```

Contoh:

```http
Content-Type: application/json
Cache-Control: no-store
Traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

Namun ada beberapa detail penting.

### 4.1 Header Name Case-Insensitive

Header name bersifat case-insensitive.

Berikut harus dianggap sama:

```http
Content-Type: application/json
content-type: application/json
CONTENT-TYPE: application/json
```

Backend tidak boleh membuat logic yang bergantung pada casing header name.

Di Java/Spring, framework umumnya sudah menangani ini. Tetapi bug bisa muncul saat:

- memakai map custom yang case-sensitive;
- menormalisasi header secara manual;
- menggabungkan data dari proxy, gateway, dan application layer;
- membuat signature/canonical request tanpa aturan casing yang eksplisit.

### 4.2 Header Value Tidak Selalu Satu Nilai

Beberapa header dapat muncul lebih dari sekali atau memiliki comma-separated values.

Contoh:

```http
Accept: application/json
Accept: application/problem+json
```

Secara efektif bisa setara dengan:

```http
Accept: application/json, application/problem+json
```

Tetapi tidak semua header aman digabung dengan koma. Header seperti `Set-Cookie` adalah contoh klasik yang harus diperlakukan khusus.

Konsekuensi backend:

- Jangan membuat asumsi “satu header = satu string sederhana”.
- Gunakan API framework yang memahami multi-value headers.
- Saat menulis middleware/filter, berhati-hati ketika merge headers.

### 4.3 Header Ordering Umumnya Tidak Boleh Bermakna

Aplikasi backend sebaiknya tidak membuat semantics berdasarkan urutan header, kecuali untuk header yang spesifikasinya memang memiliki aturan prioritas dalam value-nya, seperti `Accept` dengan quality value.

Contoh:

```http
Accept: application/json;q=0.9, application/xml;q=0.5
```

Di sini ordering bukan satu-satunya sinyal; `q` value ikut menentukan preferensi.

### 4.4 Header Size Tidak Tak Terbatas

Header sering dianggap kecil, tetapi di production bisa menjadi sumber masalah.

Penyebab header besar:

- JWT terlalu besar.
- Cookie terlalu banyak.
- Trace baggage terlalu panjang.
- Client mengirim header arbitrary.
- Gateway menambahkan metadata berlapis.

Risiko:

- request ditolak proxy dengan `431 Request Header Fields Too Large` atau `400 Bad Request`;
- Tomcat/Netty menolak request karena limit;
- latency meningkat karena header dikirim di setiap request;
- observability storage membengkak;
- security risk karena header injection atau request smuggling edge case.

Backend perlu mengatur limit header di edge dan app server.

---

## 5. End-to-End vs Hop-by-Hop Headers

Ini mental model penting.

### 5.1 End-to-End Headers

End-to-end header dimaksudkan untuk sampai ke final recipient.

Contoh:

- `Authorization`
- `Content-Type`
- `Accept`
- `Cache-Control`
- `ETag`
- `Traceparent`

Jika request melewati proxy, header ini biasanya diteruskan kecuali ada policy khusus.

### 5.2 Hop-by-Hop Headers

Hop-by-hop header hanya berlaku untuk satu koneksi antar dua node yang bersebelahan.

Contoh umum:

- `Connection`
- `Keep-Alive`
- `Transfer-Encoding`
- `Upgrade`
- `TE`
- `Trailer`

Proxy tidak boleh meneruskan hop-by-hop header sembarangan ke downstream karena maknanya hanya untuk hop tersebut.

### 5.3 Kenapa Ini Penting untuk Backend?

Karena backend modern hampir selalu berada di belakang:

- load balancer;
- reverse proxy;
- API gateway;
- service mesh;
- ingress controller.

Sebuah header bisa:

- dibuat client;
- ditambahkan CDN;
- diganti load balancer;
- dinormalisasi gateway;
- dihapus service mesh;
- akhirnya dibaca app.

Tanpa memahami hop boundary, backend mudah salah percaya metadata.

Contoh bug:

```http
Connection: X-Internal-User
X-Internal-User: admin
```

Jika proxy salah menangani hop-by-hop semantics, attacker bisa memengaruhi header yang seharusnya tidak diteruskan atau membuat perbedaan interpretasi antar proxy dan backend.

Ini salah satu akar dari keluarga bug request smuggling/header confusion.

---

## 6. Request Headers vs Response Headers

### 6.1 Request Headers

Request header menyampaikan metadata dari client/proxy ke server.

Contoh:

```http
GET /cases/CASE-123 HTTP/1.1
Host: api.example.gov
Accept: application/json
Authorization: Bearer ...
If-None-Match: "case-123-v7"
Traceparent: 00-...
```

Request header menjawab pertanyaan:

- Siapa yang memanggil?
- Apa yang diminta?
- Format apa yang diterima?
- Apakah ada precondition?
- Dari origin mana?
- Request ini bagian dari trace apa?
- Berapa besar body?
- Apakah request melewati proxy tertentu?

### 6.2 Response Headers

Response header menyampaikan metadata dari server/proxy ke client.

Contoh:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: private, max-age=60
ETag: "case-123-v7"
Traceparent: 00-...
X-Request-ID: req-9b7f
```

Response header menjawab pertanyaan:

- Apa format body ini?
- Boleh dicache atau tidak?
- Apa validator representation-nya?
- Browser boleh melakukan apa?
- Cookie apa yang harus disimpan?
- Kalau kena rate limit, kapan coba lagi?
- Bagaimana request ini dikorelasikan di logs/traces?

---

## 7. Representation Headers: Menjelaskan Body

Representation header membantu server/client memahami payload.

### 7.1 Content-Type

`Content-Type` menjelaskan media type dari body yang dikirim.

Request:

```http
POST /cases HTTP/1.1
Content-Type: application/json

{"subjectId":"SUBJ-123"}
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"CASE-123"}
```

Backend harus membedakan:

- request body `Content-Type` → cara server parse body;
- response body `Content-Type` → cara client parse response.

Kesalahan umum:

```http
POST /cases
Accept: application/json

{"subjectId":"SUBJ-123"}
```

Jika body dikirim tanpa `Content-Type`, server tidak punya kontrak eksplisit untuk parsing body. Framework bisa menebak, tapi backend production sebaiknya eksplisit.

### 7.2 Content-Type Bukan Accept

`Content-Type` menjelaskan body yang sedang dikirim.

`Accept` menjelaskan response yang diinginkan.

Contoh benar:

```http
POST /reports HTTP/1.1
Content-Type: application/json
Accept: application/pdf

{"caseId":"CASE-123"}
```

Maknanya:

- request body berupa JSON;
- client ingin response PDF.

### 7.3 Media Type Parameter

`Content-Type` dapat punya parameter.

```http
Content-Type: application/json; charset=utf-8
```

Untuk JSON modern, UTF-8 dominan, tetapi backend tetap harus berhati-hati terhadap encoding mismatch.

### 7.4 Content-Encoding

`Content-Encoding` menjelaskan encoding representation, misalnya compression.

```http
Content-Encoding: gzip
```

Untuk request body compressed, backend harus mempertimbangkan:

- apakah menerima compressed request body;
- limit setelah decompression;
- risiko decompression bomb;
- observability body size before/after decompression;
- apakah gateway atau app yang melakukan decompression.

### 7.5 Content-Language

`Content-Language` menjelaskan bahasa representasi.

Contoh:

```http
Content-Language: id
```

Berguna untuk:

- localized error response;
- document generation;
- legal/regulatory correspondence;
- cache variant jika response berbeda per bahasa.

Jika response bisa berbeda berdasarkan bahasa, `Vary: Accept-Language` sering diperlukan.

---

## 8. Negotiation Headers: Client Menyatakan Preferensi

### 8.1 Accept

`Accept` menyatakan media type response yang dapat diterima client.

```http
Accept: application/json
```

Multiple acceptable types:

```http
Accept: application/json, application/problem+json
```

With quality:

```http
Accept: application/json;q=1.0, application/xml;q=0.5
```

Backend dapat mengembalikan `406 Not Acceptable` jika tidak bisa memenuhi.

Dalam praktik JSON API, banyak service hanya mendukung JSON. Namun explicit handling tetap berguna:

- menjaga kontrak;
- mencegah client salah asumsi;
- mendukung error response `application/problem+json`;
- mendukung export PDF/CSV dari resource yang sama.

### 8.2 Accept-Encoding

`Accept-Encoding` menyatakan compression algorithm yang diterima client.

```http
Accept-Encoding: gzip, br
```

Biasanya dikelola oleh:

- CDN;
- reverse proxy;
- application server;
- framework.

Backend perlu tahu karena compression berdampak pada:

- CPU usage;
- latency;
- payload size;
- streaming behavior;
- security risk tertentu seperti compression side-channel untuk secret-bearing responses.

### 8.3 Accept-Language

`Accept-Language` menyatakan bahasa yang diinginkan client.

```http
Accept-Language: id-ID,id;q=0.9,en;q=0.7
```

Backend harus berhati-hati:

- jangan menjadikan localized message sebagai stable machine contract;
- error code harus tetap stabil;
- localized `detail` boleh berubah;
- cache harus mempertimbangkan `Vary: Accept-Language` jika response berbeda.

### 8.4 Negotiation Failure

Jika client meminta format yang tidak didukung:

```http
GET /cases/CASE-123 HTTP/1.1
Accept: application/xml
```

Dan server hanya mendukung JSON, pilihan respons:

```http
HTTP/1.1 406 Not Acceptable
Content-Type: application/problem+json
```

Namun untuk sebagian API internal, server bisa memilih default JSON. Yang penting adalah konsisten dan terdokumentasi.

---

## 9. Framing Headers: Batas Message Body

Framing menentukan bagaimana penerima tahu body dimulai dan berakhir.

### 9.1 Content-Length

`Content-Length` menyatakan panjang body dalam bytes.

```http
Content-Length: 187
```

Backend concern:

- request body size limit;
- mismatch antara declared length dan actual body;
- timeout saat body tidak lengkap;
- memory allocation;
- file upload handling;
- request smuggling jika proxy/backend beda interpretasi.

### 9.2 Transfer-Encoding

`Transfer-Encoding: chunked` umum di HTTP/1.1 untuk body yang dikirim dalam chunk.

```http
Transfer-Encoding: chunked
```

Backend concern:

- streaming parsing;
- interaction dengan proxy buffering;
- request smuggling saat `Content-Length` dan `Transfer-Encoding` bertentangan;
- limit total body meskipun tidak ada content length awal.

### 9.3 Jangan Membaca Body Tanpa Limit

Rule production:

> Every request body must have an effective maximum size.

Limit bisa diterapkan di:

- CDN;
- reverse proxy;
- gateway;
- servlet container;
- framework multipart config;
- controller/application logic.

Untuk Java backend:

- Tomcat punya limit connector/header/body tertentu.
- Spring multipart punya max file/request size.
- WebFlux punya codec memory limit.
- Gateway seperti Nginx/Envoy/Kong juga punya limit sendiri.

Limit yang tidak selaras bisa menyebabkan error membingungkan:

- proxy return `413 Payload Too Large`;
- app return `500` karena memory pressure;
- client melihat connection reset;
- logs app kosong karena request ditolak sebelum app.

---

## 10. Cache Headers: Backend Mengontrol Reuse

Caching akan dibahas detail pada Part 013, tetapi header overview perlu dibangun di sini.

### 10.1 Cache-Control

Contoh response public cacheable:

```http
Cache-Control: public, max-age=3600
```

Contoh sensitive response:

```http
Cache-Control: no-store
```

Contoh user-specific response:

```http
Cache-Control: private, max-age=60
```

Backend harus menilai:

- apakah response user-specific?
- apakah mengandung data sensitif?
- apakah boleh disimpan shared cache?
- apakah representation berubah sering?
- apakah response bisa divalidasi dengan ETag?

### 10.2 ETag

`ETag` adalah validator representation.

```http
ETag: "case-123-v7"
```

Berguna untuk:

- conditional GET;
- optimistic concurrency;
- bandwidth saving;
- conflict prevention.

### 10.3 Last-Modified

```http
Last-Modified: Tue, 18 Jun 2026 10:00:00 GMT
```

Lebih kasar daripada ETag karena bergantung waktu. Banyak sistem domain lebih cocok menggunakan ETag berbasis version/hash.

### 10.4 Vary

`Vary` memberitahu cache bahwa response berbeda berdasarkan request header tertentu.

Contoh:

```http
Vary: Accept-Encoding
```

Jika response berbeda berdasarkan origin:

```http
Vary: Origin
```

Jika response berbeda berdasarkan bahasa:

```http
Vary: Accept-Language
```

Kesalahan `Vary` bisa menyebabkan cache mengirim representation yang salah ke client lain.

---

## 11. Conditional Request Headers

Conditional headers menjadikan HTTP bisa mendukung efficient validation dan concurrency control.

### 11.1 If-None-Match

Biasanya untuk conditional GET.

```http
GET /cases/CASE-123 HTTP/1.1
If-None-Match: "case-123-v7"
```

Jika tidak berubah:

```http
HTTP/1.1 304 Not Modified
ETag: "case-123-v7"
```

### 11.2 If-Match

Biasanya untuk update agar mencegah lost update.

```http
PUT /cases/CASE-123 HTTP/1.1
If-Match: "case-123-v7"
Content-Type: application/json

{...}
```

Jika current version bukan v7:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json
```

### 11.3 Backend Insight

Conditional headers adalah salah satu cara paling elegan untuk menjembatani:

- HTTP semantics;
- database optimistic locking;
- user workflow;
- concurrent editing;
- regulatory audit trail.

Akan dibahas detail di Part 012.

---

## 12. Authentication Headers

### 12.1 Authorization

`Authorization` membawa credential.

```http
Authorization: Bearer eyJhbGciOi...
```

Atau:

```http
Authorization: Basic base64(username:password)
```

Backend harus memperlakukan header ini sebagai highly sensitive.

Rule:

- Jangan log full `Authorization`.
- Jangan expose ke error response.
- Jangan forward ke service yang tidak perlu.
- Jangan simpan di analytics raw event.
- Jangan pakai token sebagai correlation id.

### 12.2 WWW-Authenticate

Digunakan server untuk memberi authentication challenge, terutama saat `401 Unauthorized`.

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="api"
```

Dalam API modern, header ini sering dilupakan. Tetapi secara semantics, `401` berkaitan erat dengan challenge authentication.

### 12.3 Proxy-Authorization

Berbeda dari `Authorization`. Ini untuk authenticating ke proxy, bukan origin server.

Backend application biasanya tidak perlu memproses ini kecuali memang membangun proxy.

---

## 13. Security Headers: Server Mengirim Policy ke Client

Security headers akan dibahas lebih detail di Part 027, tetapi overview diperlukan.

### 13.1 Strict-Transport-Security

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Memberi tahu browser agar memakai HTTPS untuk domain tersebut dalam periode tertentu.

Backend concern:

- biasanya dikirim di edge/reverse proxy;
- jangan aktifkan sembrono untuk domain/subdomain yang belum siap HTTPS;
- preloading punya konsekuensi operasional panjang.

### 13.2 X-Content-Type-Options

```http
X-Content-Type-Options: nosniff
```

Mencegah browser melakukan MIME sniffing tertentu.

Penting jika backend menyajikan file upload/download.

### 13.3 Content-Security-Policy

```http
Content-Security-Policy: default-src 'self'
```

Lebih relevan untuk browser-facing app, tetapi backend sering menjadi tempat header ini dikonfigurasi.

### 13.4 X-Frame-Options / frame-ancestors

Mencegah clickjacking.

```http
X-Frame-Options: DENY
```

Atau via CSP:

```http
Content-Security-Policy: frame-ancestors 'none'
```

### 13.5 Referrer-Policy

```http
Referrer-Policy: no-referrer
```

Mengontrol informasi referrer yang dikirim browser.

### 13.6 Permissions-Policy

```http
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

Mengontrol browser features.

### 13.7 Cache-Control for Sensitive Data

Untuk data sensitif:

```http
Cache-Control: no-store
Pragma: no-cache
```

`Pragma` legacy, tetapi kadang masih dikirim untuk kompatibilitas.

---

## 14. Cookie Headers

Cookie adalah header, tetapi semantics-nya cukup kompleks.

### 14.1 Cookie Request Header

Client mengirim cookie:

```http
Cookie: SESSION=abc123; theme=dark
```

### 14.2 Set-Cookie Response Header

Server menyetel cookie:

```http
Set-Cookie: SESSION=abc123; HttpOnly; Secure; SameSite=Lax; Path=/
```

### 14.3 Set-Cookie Tidak Sama dengan Header List Biasa

Multiple cookies harus dikirim sebagai multiple `Set-Cookie` headers, bukan digabung dengan koma sembarangan.

```http
Set-Cookie: SESSION=abc123; HttpOnly; Secure
Set-Cookie: PREF=compact; Secure
```

### 14.4 Backend Risk

Cookie bisa menyebabkan:

- header bloat;
- session fixation;
- CSRF exposure;
- accidental cross-subdomain leakage;
- cache contamination jika response user-specific dicache publik.

Detail dibahas di Part 016.

---

## 15. Proxy and Forwarding Headers

Ini salah satu area paling sering menyebabkan bug production dan security issue.

### 15.1 Host

`Host` menyatakan authority target.

```http
Host: api.example.gov
```

Backend menggunakan Host untuk:

- virtual host routing;
- absolute URL generation;
- tenant resolution;
- redirect URL;
- security policy.

Risk:

- Host header injection;
- password reset poisoning;
- wrong tenant resolution;
- cache poisoning.

Rule:

> Jangan mempercayai Host tanpa allowlist jika digunakan untuk security-sensitive behavior.

### 15.2 Forwarded

Standardized forwarding header:

```http
Forwarded: for=203.0.113.10;proto=https;host=api.example.gov
```

Menyampaikan original client/proxy context.

### 15.3 X-Forwarded-For

Non-standard tetapi sangat umum.

```http
X-Forwarded-For: 203.0.113.10, 10.0.0.5
```

Biasanya berupa chain IP.

Risk:

- client bisa spoof header jika edge tidak menghapus/menulis ulang;
- app salah mengambil IP paling kiri/kanan;
- internal proxy chain tidak terdokumentasi;
- rate limiting salah target.

### 15.4 X-Forwarded-Proto

```http
X-Forwarded-Proto: https
```

Dipakai app untuk tahu original scheme sebelum TLS terminated di proxy.

Bug umum:

- app mengira request HTTP karena koneksi proxy→app plain HTTP;
- redirect dibuat ke `http://...` bukan `https://...`;
- secure cookie tidak diset karena app tidak tahu original request HTTPS.

### 15.5 X-Forwarded-Host

```http
X-Forwarded-Host: api.example.gov
```

Berguna untuk URL generation, tetapi juga security-sensitive.

### 15.6 Trust Boundary Rule

Forwarded headers hanya boleh dipercaya jika:

1. request datang dari trusted proxy;
2. edge proxy menghapus header user-supplied;
3. edge proxy menulis ulang canonical forwarding headers;
4. app dikonfigurasi hanya mempercayai proxy tertentu.

Jika tidak, attacker bisa mengirim:

```http
X-Forwarded-For: 127.0.0.1
X-Forwarded-Proto: https
X-Forwarded-Host: attacker.example
```

Dan app yang naif bisa salah mengambil keputusan.

### 15.7 Spring ForwardedHeaderFilter

Di Spring, `ForwardedHeaderFilter` atau konfigurasi server/framework dapat membuat aplikasi memahami forwarded headers.

Namun jangan hanya “enable” tanpa memahami deployment topology.

Pertanyaan wajib:

- Apakah app langsung terekspos internet?
- Apakah ada satu atau lebih reverse proxy?
- Proxy mana yang menghapus spoofed headers?
- Apakah gateway menulis `Forwarded` atau `X-Forwarded-*`?
- Apakah Kubernetes ingress ikut menambahkan header?
- Apakah service mesh mengubah header?

---

## 16. Observability Headers

Header adalah carrier penting untuk tracing dan correlation.

### 16.1 X-Request-ID

Contoh:

```http
X-Request-ID: req-2f4c8f0a
```

Tujuan:

- correlate logs;
- expose request identifier ke client/support;
- simplify debugging.

Rule:

- Jika client mengirim ID, validasi format dan panjang.
- Jika tidak ada, generate di edge/app.
- Jangan biarkan attacker membuat ID panjang/berbahaya yang masuk log mentah.
- Return ID di response.

Response:

```http
X-Request-ID: req-2f4c8f0a
```

### 16.2 Correlation-ID

Beberapa organisasi memakai:

```http
Correlation-ID: corr-123
```

Atau:

```http
X-Correlation-ID: corr-123
```

Tidak semua standar sama. Yang penting adalah organisasi memiliki satu convention yang konsisten.

### 16.3 W3C Trace Context: traceparent

Distributed tracing modern sering memakai `traceparent`.

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

Makna umum:

- trace id;
- parent/span id;
- flags.

Backend uses:

- continue trace;
- create child span;
- correlate service calls;
- diagnose latency/error across distributed system.

### 16.4 tracestate

```http
tracestate: vendor1=value1,vendor2=value2
```

Vendor-specific trace state.

### 16.5 baggage

```http
baggage: tenant_id=abc,workflow=case-review
```

Baggage membawa key-value context lintas service.

Risk:

- high-cardinality data;
- sensitive data leakage;
- header size bloat;
- propagation of untrusted values.

Rule:

> Propagate only context that is safe, bounded, and operationally useful.

---

## 17. Rate Limiting and Retry Headers

### 17.1 Retry-After

Dipakai dengan `429 Too Many Requests` atau `503 Service Unavailable`.

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
```

Artinya client sebaiknya retry setelah 60 detik.

Bisa juga memakai HTTP date:

```http
Retry-After: Thu, 18 Jun 2026 10:00:00 GMT
```

### 17.2 RateLimit Headers

Beberapa API memakai header seperti:

```http
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 60
```

Backend concern:

- konsisten dengan actual limiter;
- jangan leak policy internal berlebihan;
- pastikan nilai sesuai identity dimension;
- gateway dan app jangan memberi header yang bertentangan.

### 17.3 Retry Header Tidak Menggantikan Idempotency

Memberi `Retry-After` tidak berarti semua request aman di-retry.

Untuk POST non-idempotent, perlu idempotency design tersendiri.

---

## 18. CORS Headers from Backend Perspective

CORS akan dibahas detail di Part 017, tetapi di sini kita lihat header-nya.

### 18.1 Request Origin

Browser mengirim:

```http
Origin: https://app.example.gov
```

Backend/gateway merespons:

```http
Access-Control-Allow-Origin: https://app.example.gov
```

### 18.2 Preflight

```http
OPTIONS /cases HTTP/1.1
Origin: https://app.example.gov
Access-Control-Request-Method: POST
Access-Control-Request-Headers: authorization, content-type
```

Response:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.gov
Access-Control-Allow-Methods: POST
Access-Control-Allow-Headers: authorization, content-type
Access-Control-Max-Age: 600
```

### 18.3 Credentials

```http
Access-Control-Allow-Credentials: true
```

Jika credentials true, wildcard origin tidak boleh dipakai secara sembarangan.

### 18.4 Vary: Origin

Jika response CORS bergantung pada `Origin`, tambahkan:

```http
Vary: Origin
```

Tanpa ini, shared cache bisa menyajikan response dengan CORS header untuk origin yang salah.

---

## 19. Content-Disposition and File Download Headers

### 19.1 Content-Disposition

Untuk file download:

```http
Content-Disposition: attachment; filename="case-report.pdf"
Content-Type: application/pdf
```

Backend concern:

- filename harus disanitasi;
- hindari CRLF injection;
- handle non-ASCII filename dengan benar;
- jangan percaya filename upload dari user untuk response header;
- gunakan allowlist extension bila perlu.

### 19.2 Inline vs Attachment

```http
Content-Disposition: inline
```

Meminta browser menampilkan jika bisa.

```http
Content-Disposition: attachment
```

Meminta browser download.

### 19.3 X-Content-Type-Options

Untuk download file user-supplied, pertimbangkan:

```http
X-Content-Type-Options: nosniff
```

Agar browser tidak menebak MIME type berbahaya.

---

## 20. Range and Partial Content Headers

Untuk download besar atau resume download.

Request:

```http
Range: bytes=0-1023
```

Response:

```http
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-1023/4096
Accept-Ranges: bytes
```

Backend concern:

- authorization tetap berlaku untuk partial content;
- range abuse bisa menyebabkan banyak random disk reads;
- multiple ranges bisa mahal;
- cache behavior harus benar;
- object storage/CDN mungkin lebih cocok melayani file besar.

---

## 21. Custom Headers: Kapan Layak, Kapan Jangan

Custom header umum di sistem internal.

Contoh:

```http
X-Tenant-ID: tenant-123
X-Actor-ID: user-456
X-Request-Source: case-portal
```

Masalahnya bukan memakai custom header, tapi **trust dan ownership**.

Pertanyaan wajib:

1. Siapa yang boleh membuat header ini?
2. Apakah client eksternal boleh mengirimnya?
3. Apakah gateway akan menimpa atau menghapusnya?
4. Apakah nilainya divalidasi?
5. Apakah header ini dipakai untuk authorization?
6. Apakah header ini masuk log?
7. Apakah header ini propagated ke downstream?
8. Apakah ada batas panjang?

### 21.1 Jangan Pakai Custom Header untuk Menghindari Domain Model

Buruk:

```http
X-Approve: true
X-Case-ID: CASE-123
POST /workflow
```

Lebih baik:

```http
POST /cases/CASE-123/approval-requests
Content-Type: application/json

{
  "decision": "APPROVE",
  "reason": "Evidence complete"
}
```

Header sebaiknya metadata/control, bukan domain payload utama.

### 21.2 Kapan Custom Header Masuk Akal

Custom header masuk akal untuk:

- correlation id;
- idempotency key;
- tenant context yang ditetapkan gateway;
- feature flag internal;
- client app version;
- request source classification;
- internal auth assertion dari gateway, jika protected.

Namun untuk data domain, body/path/query biasanya lebih tepat.

---

## 22. Header Trust Boundary

Ini bagian paling penting secara security.

### 22.1 Semua Request Header dari Client adalah Untrusted

Default rule:

> Header dari client adalah input tidak terpercaya sampai divalidasi atau ditulis ulang oleh trusted infrastructure.

Termasuk:

- `Host`
- `X-Forwarded-For`
- `X-User-ID`
- `X-Tenant-ID`
- `X-Role`
- `Origin`
- `Referer`
- `User-Agent`
- `Content-Type`
- `Accept`
- `X-Request-ID`

### 22.2 Header yang Dibuat Gateway Bisa Trusted, Tetapi Hanya Jika Boundary Ketat

Misalnya gateway melakukan authentication lalu menambahkan:

```http
X-Authenticated-User: user-123
X-Authenticated-Scopes: case:read case:write
```

Ini hanya aman jika:

- service tidak bisa dipanggil langsung dari internet;
- gateway menghapus header incoming dengan nama sama;
- network policy membatasi akses;
- mTLS/service identity memastikan source;
- downstream hanya menerima dari trusted gateway.

Jika tidak, attacker bisa mengirim sendiri header tersebut.

### 22.3 Internal Header Prefix Strategy

Beberapa organisasi memakai prefix:

```http
X-Internal-User-ID
X-Internal-Tenant-ID
```

Prefix bukan security control. Prefix hanya convention. Security tetap bergantung pada boundary enforcement.

### 22.4 Header Sanitization at Edge

Best practice:

Di edge/gateway:

1. Hapus headers yang tidak boleh dikirim client.
2. Generate canonical request id jika tidak valid.
3. Tulis ulang forwarding headers.
4. Normalize host/scheme.
5. Validate content length/type.
6. Enforce header size limit.
7. Reject malformed headers.

---

## 23. Header Injection and CRLF

Header injection terjadi ketika attacker bisa memasukkan newline/control character ke header value.

Contoh bahaya:

```text
filename = "report.pdf\r\nSet-Cookie: admin=true"
```

Jika backend memasukkan filename mentah ke `Content-Disposition`, response bisa rusak atau disalahgunakan.

Bad:

```java
response.setHeader("Content-Disposition", "attachment; filename=\"" + userFilename + "\"");
```

Better:

- sanitize filename;
- remove CR/LF/control chars;
- use safe library/helper;
- fallback to generated filename;
- never use untrusted value directly in header.

### 23.1 Header Injection Sources

- filename upload;
- user display name;
- tenant name;
- redirect URL;
- custom metadata;
- error message;
- external service response;
- query parameter copied into header.

### 23.2 Defensive Rule

> Any value written into a response header must be header-safe, length-bounded, and control-character-free.

---

## 24. Header Normalization and Duplicate Header Confusion

Attackers exploit differences between components.

Example ambiguity:

```http
Content-Length: 10
Content-Length: 20
```

Or:

```http
X-Forwarded-For: 1.2.3.4
X-Forwarded-For: 127.0.0.1
```

Or different casing:

```http
X-User-ID: attacker
x-user-id: admin
```

If proxy and backend interpret differently, security breaks.

Backend hardening:

- reject duplicate sensitive headers;
- canonicalize carefully;
- configure proxy normalization;
- avoid custom parsing;
- log normalized view;
- test proxy/app behavior together.

Sensitive headers where duplicates are dangerous:

- `Authorization`
- `Content-Length`
- `Transfer-Encoding`
- `Host`
- `X-Forwarded-*`
- internal identity headers
- idempotency keys

---

## 25. Java/Spring MVC Header Handling

### 25.1 Reading Request Header

```java
@GetMapping("/cases/{id}")
public ResponseEntity<CaseDto> getCase(
    @PathVariable String id,
    @RequestHeader(name = "If-None-Match", required = false) String ifNoneMatch,
    @RequestHeader(name = "X-Request-ID", required = false) String requestId
) {
    // validate requestId if you use it
    // evaluate conditional request if supported
    return ResponseEntity.ok()
        .header("X-Request-ID", requestId != null ? requestId : generateRequestId())
        .body(loadCase(id));
}
```

### 25.2 Writing Response Header

```java
@GetMapping("/cases/{id}")
public ResponseEntity<CaseDto> getCase(@PathVariable String id) {
    CaseDto dto = loadCase(id);

    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_JSON)
        .cacheControl(CacheControl.noStore())
        .eTag("\"case-" + id + "-v" + dto.version() + "\"")
        .body(dto);
}
```

### 25.3 Multi-Value Headers

```java
@GetMapping("/debug/headers")
public ResponseEntity<Map<String, List<String>>> headers(
    @RequestHeader HttpHeaders headers
) {
    return ResponseEntity.ok(headers);
}
```

Use this carefully. Do not expose all headers in production because it may leak credentials/cookies.

### 25.4 Global Header Filter

Example: request id filter.

```java
@Component
public class RequestIdFilter extends OncePerRequestFilter {

    private static final Pattern SAFE_ID = Pattern.compile("^[A-Za-z0-9._:-]{1,128}$");

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String incoming = request.getHeader("X-Request-ID");
        String requestId = isSafe(incoming) ? incoming : UUID.randomUUID().toString();

        MDC.put("requestId", requestId);
        response.setHeader("X-Request-ID", requestId);

        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove("requestId");
        }
    }

    private boolean isSafe(String value) {
        return value != null && SAFE_ID.matcher(value).matches();
    }
}
```

Key points:

- validate incoming ID;
- bound length;
- add to response;
- add to logging MDC;
- cleanup MDC to avoid thread reuse leakage.

### 25.5 Security Header Configuration in Spring Security

Example conceptual configuration:

```java
@Bean
SecurityFilterChain security(HttpSecurity http) throws Exception {
    return http
        .headers(headers -> headers
            .contentTypeOptions(Customizer.withDefaults())
            .frameOptions(frame -> frame.deny())
            .httpStrictTransportSecurity(hsts -> hsts
                .includeSubDomains(true)
                .maxAgeInSeconds(31536000)
            )
        )
        .build();
}
```

Real configuration depends on Spring Security version and deployment topology.

---

## 26. Java/WebFlux Header Handling

### 26.1 Reading Headers

```java
@GetMapping("/cases/{id}")
public Mono<ResponseEntity<CaseDto>> getCase(
    @PathVariable String id,
    ServerHttpRequest request
) {
    HttpHeaders headers = request.getHeaders();
    String ifNoneMatch = headers.getFirst(HttpHeaders.IF_NONE_MATCH);

    return caseService.getCase(id)
        .map(dto -> ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_JSON)
            .eTag("\"case-" + id + "-v" + dto.version() + "\"")
            .body(dto));
}
```

### 26.2 WebFilter for Request ID

```java
@Component
public class RequestIdWebFilter implements WebFilter {

    private static final Pattern SAFE_ID = Pattern.compile("^[A-Za-z0-9._:-]{1,128}$");

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        String incoming = exchange.getRequest().getHeaders().getFirst("X-Request-ID");
        String requestId = isSafe(incoming) ? incoming : UUID.randomUUID().toString();

        exchange.getResponse().getHeaders().set("X-Request-ID", requestId);

        return chain.filter(exchange)
            .contextWrite(ctx -> ctx.put("requestId", requestId));
    }

    private boolean isSafe(String value) {
        return value != null && SAFE_ID.matcher(value).matches();
    }
}
```

Reactive caution:

- MDC tidak otomatis aman lintas thread/event loop;
- gunakan Reactor context / observability integration;
- jangan blocking saat memproses header;
- tetap validasi header length/value.

---

## 27. Header Propagation in Backend-to-Backend Calls

Ketika service A memanggil service B, jangan forward semua header secara buta.

Bad:

```java
incomingHeaders.forEach(outgoingHeaders::addAll);
```

Kenapa buruk?

- `Authorization` user bisa bocor ke service yang tidak perlu.
- `Cookie` browser bisa bocor ke internal service.
- `Host` salah.
- `Content-Length` salah.
- `Transfer-Encoding` salah.
- `X-Forwarded-*` chain rusak.
- Sensitive internal headers bisa terseret.

Better: allowlist propagation.

Propagate usually safe/needed:

- `traceparent`
- `tracestate`
- selected `baggage` keys
- sanitized `X-Request-ID`
- explicit tenant/user context if internal boundary is secure
- authorization token only if downstream requires and policy allows

Never blindly propagate:

- `Host`
- `Content-Length`
- `Transfer-Encoding`
- `Connection`
- `Keep-Alive`
- `Cookie`
- `Set-Cookie`
- raw `Authorization` unless intentional
- inbound `X-Forwarded-*` unless handled by proxy/gateway

---

## 28. Header Decision Framework

Saat akan memakai header, tanyakan:

1. Apakah ini metadata/control atau domain payload?
2. Siapa sumber header ini?
3. Apakah sumbernya trusted?
4. Apakah header ini end-to-end atau hop-by-hop?
5. Apakah boleh diteruskan ke downstream?
6. Apakah nilainya harus divalidasi?
7. Apakah ada batas panjang?
8. Apakah boleh masuk log?
9. Apakah memengaruhi cache?
10. Apakah response perlu `Vary`?
11. Apakah ada duplikasi/casing ambiguity?
12. Apakah proxy/gateway bisa mengubahnya?
13. Apakah framework otomatis memprosesnya?
14. Apa failure status jika header invalid/missing?
15. Apakah behavior-nya terdokumentasi sebagai API contract?

---

## 29. Common Backend Header Anti-Patterns

### 29.1 Always Trusting X-Forwarded-For

Buruk:

```java
String clientIp = request.getHeader("X-Forwarded-For");
```

Tanpa trusted proxy boundary, ini spoofable.

### 29.2 Logging Full Authorization Header

Buruk:

```text
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

Token leak di logs sering lebih berbahaya daripada bug aplikasi biasa.

### 29.3 Missing Content-Type Validation

Buruk:

- menerima body JSON tapi tidak memastikan `Content-Type: application/json`;
- parser menebak;
- client behavior tidak konsisten;
- security scanner menemukan content-type confusion.

### 29.4 Cache-Control Salah untuk Sensitive Data

Buruk:

```http
Cache-Control: public, max-age=3600
```

Untuk response user-specific atau regulatory-sensitive.

### 29.5 Forgetting Vary

Buruk:

```http
Access-Control-Allow-Origin: https://tenant-a.example
```

Tanpa:

```http
Vary: Origin
```

Jika melewati shared cache, bisa salah.

### 29.6 Using Headers for Business Commands

Buruk:

```http
POST /cases/CASE-123
X-Action: approve
```

Lebih baik domain operation terlihat jelas di URI/body.

### 29.7 Blind Header Forwarding

Buruk:

- forward all headers from inbound to outbound;
- membawa cookie, authorization, host, content-length;
- menyebabkan security dan protocol bugs.

### 29.8 Inconsistent Request ID Handling

Buruk:

- app A pakai `X-Request-ID`;
- app B pakai `Correlation-ID`;
- gateway generate `X-Correlation-Id`;
- logs tidak bisa dicari end-to-end.

### 29.9 Oversized JWT in Authorization Header

Masalah:

- header size limit;
- every request carries large token;
- proxy rejection;
- latency overhead;
- logs/tracing risk.

### 29.10 Duplicate Sensitive Headers Accepted

Buruk:

```http
Authorization: Bearer token1
Authorization: Bearer token2
```

Jika komponen berbeda memilih token berbeda, security ambiguity muncul.

---

## 30. Production Header Checklist

### 30.1 Request Inbound Checklist

Untuk setiap endpoint:

- [ ] Apakah required headers jelas?
- [ ] Apakah optional headers punya default behavior?
- [ ] Apakah `Content-Type` divalidasi untuk request body?
- [ ] Apakah `Accept` ditangani atau didokumentasikan?
- [ ] Apakah header size dibatasi?
- [ ] Apakah duplicate sensitive headers ditolak?
- [ ] Apakah request id divalidasi/generate?
- [ ] Apakah auth header tidak dilog?
- [ ] Apakah forwarded headers hanya dipercaya dari proxy terpercaya?
- [ ] Apakah idempotency header didesain untuk operation yang butuh retry-safety?
- [ ] Apakah conditional headers dipakai untuk update yang rawan lost update?

### 30.2 Response Outbound Checklist

Untuk setiap response:

- [ ] Apakah `Content-Type` benar?
- [ ] Apakah cache header benar?
- [ ] Apakah sensitive response memakai `Cache-Control: no-store`?
- [ ] Apakah response yang bervariasi punya `Vary`?
- [ ] Apakah error response format konsisten?
- [ ] Apakah request/correlation id dikembalikan?
- [ ] Apakah security headers diterapkan di app/edge?
- [ ] Apakah file download memakai `Content-Disposition` aman?
- [ ] Apakah ETag/Last-Modified dikirim jika caching/concurrency butuh?
- [ ] Apakah rate limit response punya `Retry-After` atau rate limit metadata?

### 30.3 Proxy/Gateway Checklist

- [ ] Edge menghapus spoofed forwarding headers.
- [ ] Edge menulis canonical forwarding headers.
- [ ] Host allowlist diterapkan.
- [ ] Header size limit diset.
- [ ] Request body limit diset.
- [ ] Hop-by-hop headers tidak diteruskan sembarangan.
- [ ] Security headers tidak dobel/kontradiktif antara app dan gateway.
- [ ] CORS policy konsisten.
- [ ] Rate limit headers berasal dari source yang benar.
- [ ] Trace/request id tidak dibuat ulang di setiap hop tanpa propagation.

---

## 31. Case Study: Regulatory Case API Behind Gateway

Bayangkan sistem:

```text
Browser / Machine Client
        |
        v
CDN / WAF
        |
        v
API Gateway
        |
        v
Spring Boot Case Service
        |
        v
Database / Object Storage / Event Bus
```

Endpoint:

```http
GET /cases/CASE-123
```

### 31.1 Request dari Browser

```http
GET /cases/CASE-123 HTTP/1.1
Host: api.regulator.example
Accept: application/json
Authorization: Bearer eyJ...
Origin: https://portal.regulator.example
Traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
X-Request-ID: req-client-123
```

### 31.2 Gateway Processing

Gateway harus:

1. Validasi TLS.
2. Validasi host.
3. Hapus incoming spoofable internal headers.
4. Validasi Authorization atau pass ke service sesuai architecture.
5. Normalize/generate request id.
6. Set forwarding headers.
7. Apply rate limit.
8. Forward trace context.

Forwarded to app:

```http
GET /cases/CASE-123 HTTP/1.1
Host: case-service.internal
Accept: application/json
Authorization: Bearer eyJ...
Forwarded: for=203.0.113.10;proto=https;host=api.regulator.example
X-Request-ID: req-client-123
Traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
X-Gateway-Authenticated: true
```

But only safe if app can only be reached from gateway.

### 31.3 App Response

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: private, max-age=30
ETag: "case-CASE-123-v7"
Vary: Accept, Origin
X-Request-ID: req-client-123
Access-Control-Allow-Origin: https://portal.regulator.example
X-Content-Type-Options: nosniff

{
  "id": "CASE-123",
  "status": "UNDER_REVIEW",
  "version": 7
}
```

### 31.4 Design Observations

- `Cache-Control: private` karena data case user-specific/sensitive.
- `ETag` memungkinkan conditional GET dan optimistic update.
- `Vary: Origin` penting jika CORS header bergantung origin.
- `X-Request-ID` dikembalikan untuk support/debugging.
- `Content-Type` eksplisit.
- Security header minimal dikirim.

---

## 32. Debugging Header Issues

### 32.1 Dengan curl

Lihat response headers:

```bash
curl -i https://api.example.gov/cases/CASE-123
```

Kirim request header tertentu:

```bash
curl -i \
  -H 'Accept: application/json' \
  -H 'X-Request-ID: debug-123' \
  https://api.example.gov/cases/CASE-123
```

Test content type:

```bash
curl -i \
  -X POST https://api.example.gov/cases \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{"subjectId":"SUBJ-123"}'
```

Test bad content type:

```bash
curl -i \
  -X POST https://api.example.gov/cases \
  -H 'Content-Type: text/plain' \
  -d '{"subjectId":"SUBJ-123"}'
```

Expected often:

```http
415 Unsupported Media Type
```

### 32.2 Debug Proxy Headers

```bash
curl -i \
  -H 'X-Forwarded-For: 127.0.0.1' \
  -H 'X-Forwarded-Proto: https' \
  https://api.example.gov/debug/whoami
```

Jika app percaya header spoofed langsung, itu red flag.

### 32.3 Debug Cache Headers

```bash
curl -I https://api.example.gov/public/reference-data
```

Periksa:

- `Cache-Control`
- `ETag`
- `Last-Modified`
- `Vary`
- `Age`
- CDN-specific headers

### 32.4 Debug CORS Headers

```bash
curl -i \
  -X OPTIONS https://api.example.gov/cases \
  -H 'Origin: https://portal.example.gov' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type'
```

Periksa:

- `Access-Control-Allow-Origin`
- `Access-Control-Allow-Methods`
- `Access-Control-Allow-Headers`
- `Access-Control-Allow-Credentials`
- `Vary: Origin`

---

## 33. Header Design Matrix for Common Backend Responses

| Scenario | Important Headers | Notes |
|---|---|---|
| JSON resource response | `Content-Type`, `ETag`, `Cache-Control`, `Vary`, `X-Request-ID` | Add ETag if versioned |
| Created resource | `Location`, `Content-Type`, `Cache-Control` | `201 Created` often uses `Location` |
| Async accepted operation | `Location` or operation URL, `Retry-After`, `Content-Type` | Works with `202 Accepted` |
| Validation error | `Content-Type: application/problem+json`, `X-Request-ID`, `Cache-Control: no-store` | Avoid sensitive details |
| Unauthorized | `WWW-Authenticate`, `Cache-Control: no-store` | Do not leak auth internals |
| Rate limited | `Retry-After`, rate limit metadata | Usually `429` |
| Sensitive user data | `Cache-Control: no-store` or `private`, security headers | Avoid shared cache leakage |
| Public reference data | `Cache-Control: public`, `ETag`, `Vary` | Good CDN candidate |
| File download | `Content-Type`, `Content-Disposition`, `Content-Length`, `X-Content-Type-Options` | Sanitize filename |
| Partial download | `Accept-Ranges`, `Content-Range`, `ETag` | Use `206 Partial Content` |
| CORS response | `Access-Control-Allow-Origin`, `Vary: Origin` | Origin-specific response must vary |

---

## 34. Exercises

### Exercise 1 — Classify Headers

Given request:

```http
POST /cases/CASE-123/evidence HTTP/1.1
Host: api.example.gov
Content-Type: multipart/form-data; boundary=abc
Accept: application/json
Authorization: Bearer token
X-Forwarded-For: 127.0.0.1
Traceparent: 00-abc-xyz-01
Content-Length: 10485760
```

Classify each header into:

- representation;
- negotiation;
- authentication;
- framing;
- proxy;
- observability;
- authority/routing.

Then answer:

1. Which headers are untrusted?
2. Which headers must not be blindly logged?
3. Which headers affect body parsing?
4. Which headers should be controlled by gateway?

### Exercise 2 — Design Response Headers

Design response headers for:

1. `GET /public/regulation-types`
2. `GET /cases/CASE-123`
3. `POST /cases`
4. `POST /case-exports`
5. `GET /case-exports/EXPORT-123/file`

For each, decide:

- `Content-Type`
- `Cache-Control`
- `ETag` or not
- `Location` or not
- `Vary` or not
- security headers
- request id header

### Exercise 3 — Find Security Bugs

Review this response:

```http
HTTP/1.1 200 OK
Content-Type: text/html
Cache-Control: public, max-age=86400
Content-Disposition: attachment; filename="{userProvidedFilename}"
Set-Cookie: SESSION=abc123

<html>...</html>
```

Potential bugs:

1. Public cache with session/sensitive data.
2. User-provided filename injection risk.
3. Missing `HttpOnly`, `Secure`, `SameSite` on cookie.
4. Possibly wrong `Content-Type` if content is user-provided.
5. Missing `X-Content-Type-Options: nosniff`.
6. Missing request id/correlation header.

### Exercise 4 — Header Propagation Policy

You are building service A calling service B. Incoming request has:

```http
Authorization: Bearer user-token
Cookie: SESSION=abc
X-Request-ID: req-123
Traceparent: 00-...
X-Forwarded-For: 203.0.113.10
X-Tenant-ID: tenant-123
Content-Length: 500
Host: api.example.gov
```

Decide which to propagate.

A reasonable policy:

- propagate sanitized `X-Request-ID`;
- propagate `traceparent`;
- propagate tenant only if set/validated by trusted auth layer;
- propagate user token only if downstream needs user delegation;
- do not propagate `Cookie` by default;
- do not propagate `Host`;
- do not propagate `Content-Length` manually;
- do not propagate inbound `X-Forwarded-For` from app layer.

---

## 35. Key Takeaways

1. Headers are not decorative metadata; they are HTTP control plane.
2. `Content-Type` describes what is sent; `Accept` describes what is requested.
3. Header names are case-insensitive, but duplicate/multi-value handling is subtle.
4. End-to-end headers and hop-by-hop headers must not be treated the same.
5. Forwarded headers are security-sensitive and only trusted behind strict proxy boundaries.
6. `Authorization`, `Cookie`, and internal identity headers must be protected from logging and blind propagation.
7. Cache headers are correctness and privacy controls.
8. `Vary` is essential when response changes based on request headers.
9. Observability headers must be validated, bounded, and consistently propagated.
10. Custom headers are acceptable for metadata/control, but weak when used as hidden domain model.
11. Backend-to-backend clients should use allowlist propagation, never blind forwarding.
12. Header correctness must be tested across proxy, gateway, framework, and application—not only controller code.

---

## 36. Readiness Checklist Before Moving to Part 006

Kamu siap lanjut jika bisa menjelaskan:

- perbedaan `Content-Type` dan `Accept`;
- mengapa `X-Forwarded-For` tidak boleh langsung dipercaya;
- kapan response butuh `Vary`;
- mengapa `Set-Cookie` tidak boleh digabung sembarangan;
- mengapa blind header forwarding berbahaya;
- cara mendesain header untuk sensitive JSON response;
- cara mendesain header untuk file download;
- cara request id dan trace context bergerak antar-service;
- bagaimana header bisa memicu cache leak, auth bug, dan observability failure.

---

## 37. Hubungan ke Part Berikutnya

Part berikutnya adalah:

**Part 006 — Request Body, Response Body, and Message Framing**

Kita akan memperdalam:

- body vs representation;
- `Content-Length`;
- `Transfer-Encoding`;
- chunked transfer;
- streaming;
- multipart;
- compression;
- body size limits;
- request smuggling;
- Servlet vs WebFlux body handling.

Header adalah metadata/control plane. Part berikutnya membahas payload dan framing sebagai data plane yang dikendalikan oleh header.

---

## 38. Status Seri

Seri **belum selesai**.

Progress saat ini:

- Selesai: Part 000 sampai Part 005.
- Berikutnya: Part 006.
- Target total: Part 000 sampai Part 032.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-004.md">⬅️ Part 004 — Status Codes as Backend State Contracts</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-006.md">Part 006 — Request Body, Response Body, and Message Framing ➡️</a>
</div>

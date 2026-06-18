# Part 4 — Headers, Content Negotiation, Compression, dan Metadata Contract

Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
File: `04-http-headers-content-negotiation-compression-metadata.md`  
Target: Java 8 hingga Java 25  
Level: Advanced / Production Engineering

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas URI, URL, encoding, query parameter, dan canonical request. Itu adalah fondasi untuk memastikan request diarahkan ke resource yang benar.

Part ini membahas lapisan berikutnya: **HTTP headers dan metadata contract**.

Di banyak aplikasi, header sering dianggap sekadar “tambahan kecil” seperti:

```http
Authorization: Bearer xxx
Content-Type: application/json
```

Padahal di production, header adalah salah satu bagian paling penting dari kontrak integrasi.

Header menentukan:

- format data yang dikirim,
- format data yang diharapkan,
- autentikasi,
- otorisasi,
- korelasi request,
- tracing,
- idempotency,
- caching,
- conditional update,
- compression,
- rate limiting,
- retry scheduling,
- versioning,
- tenant context,
- feature negotiation,
- observability,
- dan auditability.

Seorang engineer biasa melihat header sebagai `Map<String, String>`.

Engineer yang lebih matang melihat header sebagai **protocol metadata layer**.

Engineer top-tier melihat header sebagai **contract boundary yang dapat menyebabkan correctness issue, security incident, performance degradation, cache corruption, duplicate transaction, dan observability blind spot jika tidak didesain dengan benar**.

---

## 2. Mental Model: Header Bukan Sekadar Key-Value

Secara teknis, HTTP header memang terlihat seperti pasangan nama dan nilai:

```http
Header-Name: header value
```

Namun secara desain, header lebih tepat dipahami sebagai metadata yang melekat pada pesan HTTP.

```text
HTTP Request
├── Request Line
│   ├── Method
│   ├── Target URI
│   └── Protocol Version
├── Headers                <-- metadata contract
├── Empty Line
└── Body                   <-- representation payload
```

Header tidak berada “di luar” request. Header adalah bagian dari pesan HTTP.

Tanpa header yang benar, body yang sama dapat memiliki makna berbeda.

Contoh:

```http
POST /orders HTTP/1.1
Content-Type: application/json

{"amount":"100.00"}
```

berbeda dari:

```http
POST /orders HTTP/1.1
Content-Type: application/x-www-form-urlencoded

amount=100.00
```

Body terlihat sama-sama membawa data, tetapi parser server yang dipakai berbeda.

Begitu juga response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"APPROVED"}
```

berbeda dari:

```http
HTTP/1.1 200 OK
Content-Type: text/plain

{"status":"APPROVED"}
```

Client yang disiplin tidak hanya membaca body. Client harus membaca body **berdasarkan metadata response**.

---

## 3. Header sebagai Contract Boundary

Dalam integrasi API, contract tidak hanya terdiri dari:

- endpoint,
- method,
- request body,
- response body,
- status code.

Contract juga mencakup header.

Contoh kontrak API yang lengkap:

```text
POST /payment-instructions

Required request headers:
- Authorization: Bearer <access-token>
- Content-Type: application/json
- Accept: application/json
- X-Request-Id: <uuid>
- Idempotency-Key: <uuid>
- X-Client-Version: <semver>

Optional request headers:
- Traceparent
- X-Tenant-Id
- If-Match

Response headers:
- Content-Type
- ETag
- Retry-After
- RateLimit-Limit
- RateLimit-Remaining
- RateLimit-Reset
- X-Request-Id
```

Jika salah satu header wajib hilang, efeknya bisa bermacam-macam:

- server menolak dengan `400`, `401`, `403`, `415`, atau `406`,
- server salah memilih parser,
- server menganggap request tidak idempotent,
- cache menyimpan response yang salah,
- tracing terputus,
- retry menghasilkan double payment,
- audit trail kehilangan correlation ID,
- downstream sulit didiagnosis saat incident.

Jadi header bukan “pelengkap”. Header adalah bagian dari **semantic contract**.

---

## 4. Klasifikasi Header yang Penting untuk HTTP Client

Untuk client-side engineering, header dapat dikelompokkan menjadi beberapa kategori.

```text
HTTP Headers
├── Representation Headers
│   ├── Content-Type
│   ├── Content-Length
│   ├── Content-Encoding
│   └── Content-Language
│
├── Negotiation Headers
│   ├── Accept
│   ├── Accept-Encoding
│   ├── Accept-Language
│   └── Prefer
│
├── Authentication / Authorization Headers
│   ├── Authorization
│   ├── Proxy-Authorization
│   └── API-key style custom headers
│
├── Conditional Request Headers
│   ├── If-Match
│   ├── If-None-Match
│   ├── If-Modified-Since
│   └── If-Unmodified-Since
│
├── Caching Headers
│   ├── Cache-Control
│   ├── ETag
│   ├── Expires
│   └── Vary
│
├── Resilience / Rate Limit Headers
│   ├── Retry-After
│   ├── RateLimit-Limit
│   ├── RateLimit-Remaining
│   └── RateLimit-Reset
│
├── Observability Headers
│   ├── X-Request-Id
│   ├── X-Correlation-Id
│   ├── Traceparent
│   ├── Tracestate
│   └── Baggage
│
├── Safety / Idempotency Headers
│   └── Idempotency-Key
│
└── Product / Domain Metadata Headers
    ├── X-Tenant-Id
    ├── X-Agency-Id
    ├── X-Client-Version
    └── X-Feature-Flag
```

Tidak semua sistem memakai semua header di atas. Namun engineer yang matang tahu fungsi masing-masing sehingga bisa memilih secara sadar.

---

## 5. Header Name: Case-Insensitive, Tapi Jangan Sembarangan

Secara HTTP semantics, nama header bersifat case-insensitive.

Artinya secara konsep:

```http
Content-Type: application/json
```

sama dengan:

```http
content-type: application/json
```

Namun secara engineering, tetap gunakan bentuk canonical yang umum:

```http
Content-Type
Accept
Authorization
Cache-Control
ETag
If-Match
If-None-Match
Retry-After
```

Alasannya:

1. Lebih mudah dibaca di log.
2. Lebih konsisten di dokumentasi.
3. Mengurangi bug di tool/proxy yang tidak sepenuhnya compliant.
4. Memudahkan redaction rule.
5. Memudahkan contract test.

Jangan mendesain logic aplikasi yang bergantung pada casing header.

Buruk:

```java
if (headers.containsKey("Content-Type")) {
    // salah jika map dibuat case-sensitive
}
```

Lebih baik:

```java
String contentType = findHeaderIgnoreCase(headers, "Content-Type");
```

Dalam library mature seperti OkHttp, Retrofit, Apache HttpClient, dan JDK HttpClient, header handling biasanya sudah memperlakukan nama header sesuai aturan HTTP. Tetapi bug tetap bisa muncul jika kita mengubah header menjadi `Map<String, String>` biasa di layer sendiri.

---

## 6. Multi-Value Header: Tidak Semua Header Boleh Dianggap String Tunggal

Banyak engineer menyimpan header sebagai:

```java
Map<String, String> headers
```

Ini berbahaya karena beberapa header dapat memiliki lebih dari satu nilai.

Contoh:

```http
Accept: application/json
Accept: application/problem+json
```

atau:

```http
Set-Cookie: session=abc; Path=/; HttpOnly
Set-Cookie: theme=dark; Path=/
```

Jika dipaksa menjadi `Map<String, String>`, nilai dapat tertimpa.

Untuk request client, masalah ini sering muncul pada:

- `Accept`,
- `Cache-Control`,
- custom feature headers,
- tracing headers,
- `Cookie`,
- `Forwarded`,
- `X-Forwarded-*`,
- `Set-Cookie` di response.

Model yang lebih benar:

```java
Map<String, List<String>> headers
```

Atau gunakan abstraction bawaan library.

Contoh JDK HttpClient:

```java
HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
Map<String, List<String>> responseHeaders = response.headers().map();
```

Contoh OkHttp:

```java
Headers headers = response.headers();
List<String> values = headers.values("Set-Cookie");
```

Contoh Retrofit:

```java
Response<UserDto> response = call.execute();
String etag = response.headers().get("ETag");
List<String> cookies = response.headers().values("Set-Cookie");
```

Guideline:

```text
Jika header berasal dari HTTP message asli, jangan terlalu cepat ubah menjadi Map<String, String>.
Pertahankan multi-value semantics selama mungkin.
```

---

## 7. `Content-Type`: Format Payload yang Dikirim

`Content-Type` menjelaskan representation format dari body yang dikirim.

Contoh:

```http
Content-Type: application/json
```

Artinya body harus diperlakukan sebagai JSON.

Contoh lain:

```http
Content-Type: application/xml
Content-Type: text/plain; charset=UTF-8
Content-Type: application/x-www-form-urlencoded
Content-Type: multipart/form-data; boundary=----abc
Content-Type: application/octet-stream
```

### 7.1 Kesalahan Umum: Mengirim JSON Tanpa `Content-Type`

Buruk:

```java
HttpRequest request = HttpRequest.newBuilder(uri)
        .POST(HttpRequest.BodyPublishers.ofString("{\"name\":\"Fajar\"}"))
        .build();
```

Request ini punya body JSON, tetapi tidak menyatakan formatnya.

Lebih baik:

```java
HttpRequest request = HttpRequest.newBuilder(uri)
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString("{\"name\":\"Fajar\"}"))
        .build();
```

### 7.2 Charset

Untuk textual body, charset penting.

```http
Content-Type: application/json; charset=UTF-8
```

Namun untuk JSON modern, UTF-8 umumnya menjadi default yang paling aman. Tetap eksplisit jika integrasi enterprise lama rawan salah encoding.

### 7.3 `Content-Type` Bukan `Accept`

Banyak bug muncul karena engineer mencampur keduanya.

```text
Content-Type = format body yang client kirim
Accept       = format response yang client minta
```

Contoh yang benar:

```http
POST /customers
Content-Type: application/json
Accept: application/json

{"name":"Ayu"}
```

Client mengirim JSON dan meminta response JSON.

---

## 8. `Accept`: Format Response yang Diinginkan

`Accept` memberi tahu server format response yang client bisa proses.

Contoh:

```http
Accept: application/json
```

Bisa lebih dari satu:

```http
Accept: application/json, application/problem+json
```

Atau dengan quality value:

```http
Accept: application/json; q=1.0, application/xml; q=0.5
```

Dalam API client production, biasanya gunakan explicit `Accept`.

Buruk:

```http
Accept: */*
```

Ini terlalu longgar. Server bisa mengembalikan HTML error page, XML, plain text, atau format lain yang tidak siap diparse client.

Lebih baik:

```http
Accept: application/json
```

atau jika API menggunakan Problem Details:

```http
Accept: application/json, application/problem+json
```

Mental model:

```text
Accept membatasi ruang kemungkinan response.
Semakin eksplisit Accept, semakin stabil parser dan error handling client.
```

---

## 9. `Content-Length` dan `Transfer-Encoding`

`Content-Length` menyatakan ukuran body dalam bytes.

```http
Content-Length: 128
```

Namun di banyak HTTP client modern, header ini biasanya dihitung otomatis oleh library jika ukuran body diketahui.

Jangan set manual kecuali benar-benar perlu.

Buruk:

```java
requestBuilder.header("Content-Length", "123"); // berbahaya jika body berubah
```

Masalah yang bisa terjadi:

- server menunggu body yang tidak pernah datang,
- server memotong body,
- connection dianggap corrupt,
- request gagal secara sporadis,
- proxy menolak request.

Untuk streaming body yang ukurannya belum diketahui, client/protocol dapat memakai chunked transfer encoding pada HTTP/1.1.

Guideline:

```text
Biarkan HTTP client library mengelola Content-Length dan Transfer-Encoding kecuali Anda sedang membangun low-level protocol handling.
```

---

## 10. `Accept-Encoding`, `Content-Encoding`, dan Compression

Compression adalah salah satu area yang sering tersembunyi.

Ada dua header penting:

```http
Accept-Encoding: gzip, br
Content-Encoding: gzip
```

Maknanya berbeda.

```text
Accept-Encoding  = encoding/compression yang client bersedia terima
Content-Encoding = encoding/compression yang benar-benar digunakan pada body
```

Contoh request:

```http
GET /reports/large
Accept: application/json
Accept-Encoding: gzip
```

Contoh response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Encoding: gzip
```

Body response dikompresi gzip.

### 10.1 Transparent Decompression

Beberapa client dapat melakukan decompression otomatis.

OkHttp, misalnya, dikenal mendukung transparent GZIP ketika memungkinkan. Artinya aplikasi menerima body yang sudah didekompresi tanpa harus manual membuka `GZIPInputStream`.

Konsekuensi penting:

- header `Content-Encoding` bisa berbeda antara network-level response dan application-level response,
- ukuran body di log bisa membingungkan,
- metrik bytes-on-wire berbeda dari bytes-after-decompression,
- interceptor level menentukan apa yang terlihat.

### 10.2 Compression Bomb Risk

Response kecil di network dapat menjadi sangat besar setelah decompression.

Contoh:

```text
compressed:   5 MB
uncompressed: 800 MB
```

Jika client langsung membaca ke memory:

```java
String body = response.body().string();
```

maka aplikasi bisa terkena memory pressure.

Guideline:

```text
Untuk API besar, batasi ukuran response setelah decompression, bukan hanya ukuran wire payload.
```

### 10.3 Kapan Jangan Pakai Compression

Compression tidak selalu menguntungkan.

Kurang cocok jika:

- payload sangat kecil,
- CPU caller/callee sudah bottleneck,
- data sudah terkompresi seperti PDF, ZIP, JPEG, PNG,
- latency dominated by server processing, bukan transfer,
- streaming low-latency chunk kecil.

Cocok jika:

- payload JSON/XML besar,
- bandwidth terbatas,
- response repetitive,
- cross-region call,
- mobile/edge client.

---

## 11. `Authorization`: Credential Boundary

Header paling sensitif dalam request biasanya:

```http
Authorization: Bearer <token>
```

atau:

```http
Authorization: Basic <base64>
```

atau custom:

```http
X-API-Key: <secret>
```

Prinsip utama:

```text
Authorization header tidak boleh bocor ke log, metric label, exception message, trace attribute, dashboard, screenshot, atau audit non-secure.
```

### 11.1 Redaction Wajib

Redact minimal header berikut:

```text
Authorization
Proxy-Authorization
Cookie
Set-Cookie
X-API-Key
Api-Key
X-Auth-Token
X-Amz-Security-Token
```

Contoh log buruk:

```text
Calling partner API with headers={Authorization=Bearer eyJhbGciOi...}
```

Contoh log lebih aman:

```text
Calling partner API method=POST path=/payments headers={Authorization=<redacted>, X-Request-Id=...}
```

### 11.2 Jangan Propagate Authorization Sembarangan

Dalam microservices, ada godaan untuk meneruskan semua incoming header ke outgoing request.

Buruk:

```java
for (Map.Entry<String, String> h : incomingHeaders.entrySet()) {
    outgoing.header(h.getKey(), h.getValue());
}
```

Ini berbahaya.

Risikonya:

- token user bocor ke third-party API,
- internal credential dikirim ke external host,
- cookie session bocor,
- header spoofing,
- confused deputy problem,
- audit ambiguity.

Lebih baik gunakan allowlist:

```text
Allowed propagated headers:
- traceparent
- tracestate
- X-Request-Id
- X-Correlation-Id
- Accept-Language, jika relevan
```

Credential harus dipasang oleh client adapter berdasarkan target downstream, bukan blindly inherited dari inbound request.

---

## 12. Correlation ID dan Request ID

Observability production sangat bergantung pada correlation metadata.

Umum dipakai:

```http
X-Request-Id: 1f2e6d7c-...
X-Correlation-Id: case-12345-flow-67890
```

Perbedaan umum:

```text
Request ID     = unik per HTTP request
Correlation ID = mengikat beberapa request dalam satu business flow
```

Namun istilah ini tidak selalu konsisten antar organisasi. Yang penting adalah kontraknya jelas.

### 12.1 Pola yang Disarankan

Saat menerima incoming request:

```text
if incoming X-Request-Id valid:
    use it as parent/external request id
else:
    generate new request id

for outgoing request:
    generate outgoing request id if needed
    propagate correlation id
    propagate trace context
```

Untuk sistem regulasi/case management, correlation ID sangat penting karena satu aksi user dapat menyentuh banyak entitas:

```text
User action: submit enforcement case
├── create case
├── upload document
├── validate license
├── notify officer
├── update audit trail
└── call external registry
```

Tanpa correlation ID, investigasi incident menjadi mahal.

### 12.2 Jangan Pakai Data Sensitif sebagai Correlation ID

Buruk:

```http
X-Correlation-Id: NRIC-S1234567A
```

Lebih baik:

```http
X-Correlation-Id: 018f9f8c-8b59-7ac5-9a43-...
```

Jika butuh menghubungkan ke case, simpan mapping di audit system, bukan expose identifier sensitif ke semua downstream.

---

## 13. W3C Trace Context: `traceparent` dan `tracestate`

Untuk distributed tracing modern, header yang umum adalah:

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
tracestate: vendor-specific-state
```

`traceparent` membawa identitas trace dan span parent. Ini memungkinkan request terlihat sebagai satu trace end-to-end di OpenTelemetry/Jaeger/Tempo/Zipkin/APM lain.

Mental model:

```text
Correlation ID menjawab: business flow/request apa ini?
Trace context menjawab: span teknis mana yang memanggil span mana?
```

Keduanya tidak harus saling menggantikan.

Recommended propagation:

```text
Propagate:
- traceparent
- tracestate
- baggage, jika kebijakan organisasi mengizinkan

Do not blindly propagate:
- Authorization
- Cookie
- Set-Cookie
- Host
- Content-Length
- Transfer-Encoding
```

---

## 14. `Idempotency-Key`: Safety untuk Command Request

`Idempotency-Key` adalah header yang sering menjadi pembeda antara API client biasa dan API client serius.

Contoh:

```http
POST /payments
Idempotency-Key: 018f9f91-9ea2-78cc-a6b4-...
Content-Type: application/json
```

Masalah yang ingin diselesaikan:

```text
Client mengirim POST create payment.
Server memproses payment berhasil.
Koneksi timeout sebelum client menerima response.
Client tidak tahu apakah payment terjadi.
Client retry.
Tanpa idempotency key, payment bisa terjadi dua kali.
```

Dengan idempotency key, server dapat mengenali retry dari command yang sama.

### 14.1 Kapan Idempotency-Key Penting

Gunakan untuk operasi command yang punya side effect:

- create payment,
- create case,
- submit application,
- issue license,
- send notification,
- reserve slot,
- create order,
- submit appeal,
- upload document metadata,
- external registry update.

Tidak terlalu perlu untuk pure read:

```http
GET /cases/123
```

### 14.2 Idempotency-Key Harus Stabil per Logical Attempt

Buruk:

```java
for (int attempt = 0; attempt < 3; attempt++) {
    request.header("Idempotency-Key", UUID.randomUUID().toString());
}
```

Ini membuat setiap retry terlihat seperti request baru.

Benar:

```java
String idempotencyKey = UUID.randomUUID().toString();

for (int attempt = 0; attempt < 3; attempt++) {
    request.header("Idempotency-Key", idempotencyKey);
}
```

### 14.3 Idempotency-Key Bukan Pengganti Transaction Design

Client bisa mengirim idempotency key, tetapi server harus menyimpan dan menerapkannya dengan benar.

Server harus bisa menjawab:

- key ini pernah dipakai atau belum,
- request body sama atau berubah,
- response sebelumnya apa,
- key berlaku berapa lama,
- apakah key scoped per client/tenant/user,
- bagaimana menangani concurrent duplicate request.

Dari sisi client, pastikan key:

- unik,
- stabil untuk retry logical operation yang sama,
- tidak mengandung data sensitif,
- tercatat di log/audit dengan aman,
- ikut masuk ke observability context.

---

## 15. Conditional Requests: `ETag`, `If-Match`, `If-None-Match`

Conditional headers memungkinkan client melakukan request berdasarkan kondisi state resource.

Ini penting untuk caching dan concurrency control.

### 15.1 `ETag`

`ETag` adalah validator untuk representasi resource.

Response:

```http
HTTP/1.1 200 OK
ETag: "case-v17"
Content-Type: application/json

{"id":"CASE-1","status":"DRAFT"}
```

Client dapat menyimpan ETag bersama data.

### 15.2 `If-None-Match` untuk Cache Revalidation

Request:

```http
GET /cases/CASE-1
If-None-Match: "case-v17"
```

Jika resource belum berubah, server dapat menjawab:

```http
HTTP/1.1 304 Not Modified
```

Client memakai cached representation.

Manfaat:

- hemat bandwidth,
- hemat parsing,
- mengurangi load server,
- tetap menjaga freshness.

### 15.3 `If-Match` untuk Optimistic Concurrency

Request:

```http
PUT /cases/CASE-1
If-Match: "case-v17"
Content-Type: application/json

{"status":"SUBMITTED"}
```

Maknanya:

```text
Update hanya boleh dilakukan jika resource masih berada pada versi yang saya baca sebelumnya.
```

Jika resource sudah berubah menjadi `case-v18`, server dapat menolak:

```http
HTTP/1.1 412 Precondition Failed
```

Ini sangat penting untuk sistem case management/regulatory workflow:

```text
Officer A membaca case versi 17.
Officer B mengubah case menjadi versi 18.
Officer A mencoba submit berdasarkan data lama.
If-Match mencegah lost update.
```

### 15.4 Conditional Header sebagai Correctness Tool

Banyak engineer melihat ETag hanya untuk cache. Itu terlalu sempit.

ETag + `If-Match` adalah alat untuk:

- optimistic locking,
- lost update prevention,
- safe concurrent editing,
- audit defensibility,
- explicit state transition guard.

---

## 16. `Cache-Control`, `Expires`, dan `Vary`

HTTP caching tidak hanya untuk browser. API client juga bisa memakai caching jika kontraknya jelas.

### 16.1 `Cache-Control`

Response:

```http
Cache-Control: max-age=300
```

Maknanya response boleh dianggap fresh selama 300 detik.

Contoh lain:

```http
Cache-Control: no-store
Cache-Control: no-cache
Cache-Control: private
Cache-Control: public, max-age=3600
```

Perbedaan penting:

```text
no-store = jangan simpan response
no-cache = boleh simpan, tapi harus revalidate sebelum dipakai
```

Untuk data sensitif, biasanya gunakan:

```http
Cache-Control: no-store
```

### 16.2 `Expires`

`Expires` memberi waktu absolut kapan response dianggap expired.

```http
Expires: Wed, 21 Oct 2026 07:28:00 GMT
```

Dalam sistem modern, `Cache-Control` biasanya lebih diutamakan.

### 16.3 `Vary`

`Vary` memberi tahu cache bahwa response berbeda tergantung header request tertentu.

Contoh:

```http
Vary: Accept-Encoding
```

Artinya response gzip dan non-gzip harus diperlakukan sebagai varian berbeda.

Contoh lain:

```http
Vary: Accept-Language
```

Artinya response Bahasa Indonesia dan English berbeda.

Jika client-side cache mengabaikan `Vary`, bisa terjadi cache pollution:

```text
Request A: Accept-Language: id-ID
Cache stores Indonesian response.
Request B: Accept-Language: en-US
Cache incorrectly returns Indonesian response.
```

### 16.4 Caching API Client Harus Sangat Disiplin

Client-side cache cocok untuk:

- reference data,
- static configuration,
- postal code lookup,
- country list,
- product catalog read-heavy,
- external API dengan quota ketat,
- expensive read endpoint.

Tidak cocok untuk:

- state mutating response,
- authorization-dependent sensitive data,
- per-user confidential data,
- real-time decision data,
- data yang freshness-nya legal-critical.

---

## 17. Rate Limit Headers dan `Retry-After`

Banyak API modern memberi sinyal rate limit melalui response header.

Contoh:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
RateLimit-Limit: 300
RateLimit-Remaining: 0
RateLimit-Reset: 1710000000
```

Maknanya:

- client terlalu sering memanggil,
- tunggu 30 detik sebelum retry,
- limit periode ini 300,
- sisa quota 0,
- reset pada waktu tertentu.

### 17.1 `Retry-After`

`Retry-After` bisa berupa:

```http
Retry-After: 120
```

atau HTTP date:

```http
Retry-After: Wed, 21 Oct 2026 07:28:00 GMT
```

Client yang mature tidak sekadar retry dengan backoff internal. Ia menghormati sinyal server jika valid.

Pseudo logic:

```text
if status == 429 or status == 503:
    if Retry-After valid:
        wait according to Retry-After, within max allowed delay
    else:
        use exponential backoff with jitter
```

### 17.2 Jangan Percaya Buta

Tetap batasi `Retry-After`.

Misalnya:

```text
Retry-After: 86400
```

Tidak semua caller boleh menunggu 24 jam. Untuk request synchronous, lebih baik fail fast dan jadwalkan retry async jika domain mengizinkan.

Guideline:

```text
Retry-After adalah input ke retry policy, bukan perintah absolut tanpa batas.
```

---

## 18. Domain Metadata Header

Banyak enterprise API memakai custom header:

```http
X-Tenant-Id: tenant-a
X-Agency-Id: CEA
X-Client-Version: aceas-case-client/2.3.1
X-Channel: intranet
X-User-Type: officer
```

Header seperti ini dapat berguna, tetapi juga mudah menjadi tempat desain buruk.

### 18.1 Kapan Custom Header Masuk Akal

Custom header masuk akal untuk metadata yang:

- bukan bagian dari resource representation,
- berlaku untuk request secara keseluruhan,
- dibutuhkan cross-cutting layer,
- dipakai routing, authz, observability, atau policy,
- tidak cocok dimasukkan ke body.

Contoh yang masuk akal:

```http
X-Tenant-Id: tenant-a
X-Request-Id: uuid
X-Client-Version: case-service/1.8.0
```

### 18.2 Kapan Custom Header Buruk

Buruk jika header dipakai untuk menyembunyikan domain command utama.

Contoh buruk:

```http
POST /cases/123/action
X-New-Status: APPROVED
X-Reason: officer-decision
```

Lebih baik domain command ada di body:

```http
POST /cases/123/approval
Content-Type: application/json

{
  "decision": "APPROVED",
  "reason": "officer-decision"
}
```

Header bukan tempat utama untuk domain state yang harus divalidasi, diaudit, dan diversiokan sebagai contract body.

---

## 19. Header Propagation: Allowlist, Bukan Copy All

Dalam backend service, request sering masuk dari user/browser/gateway lalu service memanggil downstream.

Anti-pattern paling sering:

```java
public Request.Builder propagateAllHeaders(HttpServletRequest incoming, Request.Builder outgoing) {
    Enumeration<String> names = incoming.getHeaderNames();
    while (names.hasMoreElements()) {
        String name = names.nextElement();
        outgoing.header(name, incoming.getHeader(name));
    }
    return outgoing;
}
```

Ini tampak praktis tetapi berbahaya.

Header yang tidak boleh dipropagate sembarangan:

```text
Host
Content-Length
Transfer-Encoding
Connection
Keep-Alive
Upgrade
Authorization
Proxy-Authorization
Cookie
Set-Cookie
X-Forwarded-For
X-Real-IP
Forwarded
```

Beberapa header hop-by-hop tidak boleh diteruskan antar hop seperti metadata end-to-end biasa.

### 19.1 Pattern yang Lebih Aman

Gunakan allowlist:

```java
private static final Set<String> PROPAGATABLE_HEADERS = Set.of(
        "traceparent",
        "tracestate",
        "x-request-id",
        "x-correlation-id"
);
```

Lalu normalisasi case:

```java
boolean isPropagatable(String name) {
    return PROPAGATABLE_HEADERS.contains(name.toLowerCase(Locale.ROOT));
}
```

Kemudian target-specific client memasang header auth sendiri:

```text
Incoming user request
    ↓
Extract safe observability context
    ↓
Client adapter chooses target credential
    ↓
Outgoing downstream request
```

---

## 20. Library Mapping: JDK HttpClient

JDK HttpClient memakai `HttpRequest.Builder`.

Contoh dasar:

```java
HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://api.example.com/customers"))
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("X-Request-Id", requestId)
        .POST(HttpRequest.BodyPublishers.ofString(json))
        .build();
```

Untuk banyak header sekaligus:

```java
HttpRequest request = HttpRequest.newBuilder(uri)
        .headers(
                "Accept", "application/json",
                "Content-Type", "application/json",
                "X-Request-Id", requestId
        )
        .POST(HttpRequest.BodyPublishers.ofString(json))
        .build();
```

Response headers:

```java
HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

Optional<String> contentType = response.headers().firstValue("Content-Type");
Map<String, List<String>> allHeaders = response.headers().map();
```

Important notes:

- jangan reuse builder lintas thread,
- request hasil `build()` immutable,
- beberapa restricted headers mungkin tidak bisa diset langsung,
- body publisher menentukan body transfer behavior,
- redaction/logging harus dibuat sendiri atau lewat wrapper.

---

## 21. Library Mapping: OkHttp

OkHttp memakai `Request.Builder` dan `Headers`.

Contoh:

```java
Request request = new Request.Builder()
        .url("https://api.example.com/customers")
        .header("Accept", "application/json")
        .header("X-Request-Id", requestId)
        .post(RequestBody.create(json, MediaType.get("application/json")))
        .build();
```

Perbedaan penting:

```java
.header(name, value)     // replace existing header with same name
.addHeader(name, value)  // add additional value
```

Contoh multi-value:

```java
Request request = new Request.Builder()
        .url(url)
        .addHeader("Accept", "application/json")
        .addHeader("Accept", "application/problem+json")
        .build();
```

Response:

```java
try (Response response = client.newCall(request).execute()) {
    Headers headers = response.headers();
    String contentType = headers.get("Content-Type");
    List<String> cookies = headers.values("Set-Cookie");
}
```

### 21.1 Interceptor untuk Header Global

Application interceptor cocok untuk memasang header cross-cutting:

```java
class DefaultHeadersInterceptor implements Interceptor {
    @Override
    public Response intercept(Chain chain) throws IOException {
        Request original = chain.request();

        Request request = original.newBuilder()
                .header("Accept", "application/json")
                .header("X-Client-Version", "case-client/1.0.0")
                .build();

        return chain.proceed(request);
    }
}
```

Namun hati-hati: interceptor global jangan memasang auth untuk semua host jika client dipakai multi-target.

Lebih aman:

```text
Satu OkHttpClient shared infrastructure
+ per-target wrapper/interceptor policy
```

atau buat client instance turunan dengan policy berbeda jika perlu.

---

## 22. Library Mapping: Retrofit

Retrofit mendeklarasikan header di interface.

Static headers:

```java
interface CustomerApi {
    @Headers({
            "Accept: application/json",
            "X-Client-Version: customer-client/1.0.0"
    })
    @GET("customers/{id}")
    Call<CustomerDto> getCustomer(@Path("id") String id);
}
```

Dynamic header:

```java
interface CustomerApi {
    @GET("customers/{id}")
    Call<CustomerDto> getCustomer(
            @Path("id") String id,
            @Header("Authorization") String authorization,
            @Header("X-Request-Id") String requestId
    );
}
```

Header map:

```java
@GET("customers/{id}")
Call<CustomerDto> getCustomer(
        @Path("id") String id,
        @HeaderMap Map<String, String> headers
);
```

Gunakan `@HeaderMap` dengan hati-hati. Jangan jadikan ini pintu untuk arbitrary header dari caller.

Lebih baik:

```text
Service method menerima domain context
Client adapter membentuk header yang diizinkan
Retrofit interface tetap minimal
```

Contoh wrapper:

```java
public CustomerDto getCustomer(CustomerId id, RequestContext ctx) {
    String auth = tokenProvider.getBearerToken();
    String requestId = ctx.requestId();

    Response<CustomerDto> response = api.getCustomer(
            id.value(),
            "Bearer " + auth,
            requestId
    ).execute();

    return handle(response);
}
```

---

## 23. Library Mapping: Apache HttpClient 5

Apache HttpClient 5 memberi kontrol besar atas header, config, dan connection management.

Contoh classic client:

```java
HttpGet request = new HttpGet("https://api.example.com/customers/123");
request.addHeader(HttpHeaders.ACCEPT, "application/json");
request.addHeader("X-Request-Id", requestId);

try (CloseableHttpResponse response = client.execute(request)) {
    Header contentType = response.getFirstHeader(HttpHeaders.CONTENT_TYPE);
    int status = response.getCode();
}
```

Untuk POST:

```java
HttpPost request = new HttpPost("https://api.example.com/customers");
request.addHeader(HttpHeaders.ACCEPT, "application/json");
request.setEntity(new StringEntity(json, ContentType.APPLICATION_JSON));
```

Apache cocok ketika butuh:

- kontrol detail connection manager,
- route-specific policy,
- proxy/corporate network complex,
- advanced TLS strategy,
- classic blocking dan async variants,
- migration dari legacy enterprise code.

---

## 24. Logging Header: Debugging vs Data Leakage

HTTP logging sangat membantu, tetapi juga sangat berbahaya.

Jangan log semua header mentah.

### 24.1 Header Safe to Log

Biasanya aman:

```text
Accept
Content-Type
Content-Encoding
Accept-Encoding
User-Agent
X-Request-Id
X-Correlation-Id
traceparent, sebagian tergantung policy
Idempotency-Key, tergantung policy; sering boleh tapi tetap hati-hati
```

### 24.2 Header yang Harus Diredact

```text
Authorization
Proxy-Authorization
Cookie
Set-Cookie
X-API-Key
Api-Key
X-Auth-Token
X-CSRF-Token
X-Amz-Security-Token
```

### 24.3 Jangan Log Body Hanya Karena Header Aman

Header aman tidak berarti body aman.

Contoh:

```http
Content-Type: application/json
```

Body bisa berisi:

```json
{
  "nric": "S1234567A",
  "email": "person@example.com",
  "salary": 10000
}
```

Logging policy harus terpisah:

```text
Header logging policy
Body logging policy
Field-level redaction policy
Sampling policy
Environment policy
```

---

## 25. Header dan Metrics: Hindari Cardinality Explosion

Jangan masukkan header bebas ke metric label.

Buruk:

```text
http_client_requests_total{path="/api", authorization="Bearer eyJ..."}
```

Jelas fatal.

Tapi ini juga buruk:

```text
http_client_requests_total{x_request_id="uuid-unique-per-request"}
```

Karena cardinality meledak.

Metric label yang lebih aman:

```text
client_name="payment-api"
method="POST"
route="/payments"
status_class="2xx"
outcome="success"
```

Header seperti `X-Request-Id` masuk log/trace, bukan metric label.

---

## 26. Header dan Tracing: Attribute Mana yang Layak Masuk Span

Untuk span outgoing HTTP client, attribute yang lazim:

```text
http.request.method
url.scheme
server.address
server.port
http.response.status_code
network.protocol.version
```

Custom attribute boleh, tetapi hati-hati.

Boleh:

```text
client.name = "payment-api"
external.system = "payment-gateway-x"
retry.attempt = 2
idempotency.enabled = true
```

Jangan:

```text
authorization = "Bearer ..."
cookie = "..."
full.url.with.sensitive.query = "..."
```

Untuk header observability:

```text
traceparent/tracestate dipropagate sebagai context,
bukan sekadar dicatat sebagai log string.
```

---

## 27. Header Security Pitfalls

### 27.1 CRLF Injection

Jika nilai header dibentuk dari input user tanpa validasi, attacker dapat mencoba menyisipkan CRLF:

```text
normal-value\r\nInjected-Header: evil
```

Library modern biasanya menolak karakter ilegal, tetapi jangan mengandalkan itu sebagai satu-satunya pertahanan.

Validasi header value yang berasal dari user/domain bebas.

### 27.2 Host Header Confusion

Jangan set `Host` secara manual kecuali punya alasan kuat.

`Host` dipakai routing virtual host. Salah set dapat menyebabkan request diarahkan atau diproses secara tidak sesuai.

### 27.3 Redirect Credential Leakage

Jika client mengikuti redirect otomatis, pastikan credential tidak bocor ke host berbeda.

Scenario:

```text
GET https://api.internal.local/data
Authorization: Bearer internal-token

302 Location: https://evil.example/collect
```

Client yang buruk bisa meneruskan Authorization ke host baru.

Production-grade client harus punya redirect policy:

```text
if redirect host changes:
    do not forward Authorization unless explicitly allowed
```

### 27.4 SSRF via Header

Header seperti ini sering dipakai oleh proxy/gateway:

```http
X-Forwarded-Host
X-Forwarded-For
Forwarded
```

Jangan percaya header tersebut dari external caller kecuali sudah disanitasi oleh trusted gateway.

---

## 28. Header Versioning dan Compatibility

API versioning kadang dilakukan melalui header:

```http
Accept: application/vnd.company.customer.v2+json
```

atau:

```http
X-API-Version: 2
```

atau:

```http
Api-Version: 2026-06-01
```

Trade-off:

### Version in URL

```http
GET /v2/customers/123
```

Kelebihan:

- mudah dilihat,
- mudah diroute,
- mudah ditest manual.

Kekurangan:

- URL berubah,
- sering membuat duplikasi endpoint.

### Version in Header

```http
Accept: application/vnd.company.customer.v2+json
```

Kelebihan:

- lebih dekat ke content negotiation,
- URL resource tetap.

Kekurangan:

- lebih sulit terlihat,
- sering dilupakan di client,
- debugging manual lebih rumit.

Guideline:

```text
Apapun strategi versioning, bungkus di client adapter agar caller domain tidak perlu mengingat header version.
```

---

## 29. Designing a Header Policy Object

Jangan biarkan header tersebar di seluruh codebase.

Buruk:

```java
request.header("Authorization", "Bearer " + token);
request.header("X-Request-Id", requestId);
request.header("Accept", "application/json");
```

tersebar di 80 tempat.

Lebih baik buat policy object:

```java
public final class OutboundHeaderPolicy {
    private final TokenProvider tokenProvider;
    private final ClientIdentity clientIdentity;

    public Map<String, String> buildHeaders(RequestContext context) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Accept", "application/json");
        headers.put("Authorization", "Bearer " + tokenProvider.getToken());
        headers.put("X-Request-Id", context.requestId());
        headers.put("X-Correlation-Id", context.correlationId());
        headers.put("X-Client-Version", clientIdentity.version());
        return headers;
    }
}
```

Namun jangan berhenti di `Map<String, String>` jika butuh multi-value. Untuk header policy sederhana, map masih cukup. Untuk framework-level client, buat abstraction yang mendukung multiple values.

Better abstraction:

```java
public interface HeaderSink {
    void set(String name, String value);
    void add(String name, String value);
}
```

Lalu implementasi untuk JDK/OkHttp/Apache/Retrofit.

---

## 30. Safe Header Builder Pattern

Contoh sederhana reusable untuk Java 8+:

```java
public final class HttpHeadersBuilder {
    private final Map<String, List<String>> headers = new LinkedHashMap<>();

    public HttpHeadersBuilder set(String name, String value) {
        validateName(name);
        validateValue(value);
        headers.put(name, new ArrayList<>(List.of(value)));
        return this;
    }

    public HttpHeadersBuilder add(String name, String value) {
        validateName(name);
        validateValue(value);
        headers.computeIfAbsent(name, k -> new ArrayList<>()).add(value);
        return this;
    }

    public Map<String, List<String>> build() {
        Map<String, List<String>> copy = new LinkedHashMap<>();
        headers.forEach((k, v) -> copy.put(k, List.copyOf(v)));
        return Collections.unmodifiableMap(copy);
    }

    private static void validateName(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Header name must not be blank");
        }
        if (name.indexOf('\r') >= 0 || name.indexOf('\n') >= 0) {
            throw new IllegalArgumentException("Invalid header name");
        }
    }

    private static void validateValue(String value) {
        if (value == null) {
            throw new IllegalArgumentException("Header value must not be null");
        }
        if (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
            throw new IllegalArgumentException("Invalid header value");
        }
    }
}
```

Untuk Java 8, ganti `List.of`, `List.copyOf`, dan `String.isBlank()` dengan alternatif compatible.

Java 8 version sketch:

```java
private static boolean isBlank(String value) {
    return value == null || value.trim().isEmpty();
}
```

---

## 31. Header Policy untuk Different Downstream

Jangan semua downstream diberi header sama.

Contoh downstream:

```text
Payment API
- Authorization
- Idempotency-Key
- X-Request-Id
- X-Correlation-Id
- Accept: application/json

Document API
- Authorization
- Accept: application/pdf or application/json
- Range, jika partial download

Registry API
- X-API-Key
- Accept: application/json
- X-Agency-Id

Internal Case API
- mTLS identity
- traceparent
- X-Correlation-Id
- X-User-Context, jika aman dan disetujui
```

Header policy harus per client, bukan global tanpa konteks.

Recommended structure:

```text
outbound/
├── payment/
│   ├── PaymentApiClient
│   ├── PaymentHeaderPolicy
│   └── PaymentErrorMapper
├── document/
│   ├── DocumentApiClient
│   ├── DocumentHeaderPolicy
│   └── DocumentErrorMapper
└── registry/
    ├── RegistryApiClient
    ├── RegistryHeaderPolicy
    └── RegistryErrorMapper
```

---

## 32. Content Negotiation Strategy

Content negotiation bukan hanya mengisi `Accept`.

Strateginya harus menjawab:

1. Format response apa yang client bisa parse?
2. Error format apa yang client bisa parse?
3. Apakah server bisa mengembalikan HTML error dari gateway?
4. Apakah XML masih mungkin?
5. Apakah API memakai vendor media type?
6. Apakah versioning lewat `Accept`?
7. Apakah compression diperbolehkan?
8. Apakah language/localization relevan?

Contoh robust Accept:

```http
Accept: application/json, application/problem+json
```

Untuk vendor media type:

```http
Accept: application/vnd.company.case.v2+json, application/problem+json
```

Untuk PDF download:

```http
Accept: application/pdf
```

Untuk endpoint yang bisa return JSON metadata atau file, jangan ambigu. Pisahkan endpoint atau buat contract jelas.

---

## 33. Handling Unexpected `Content-Type`

Production client harus menangani response seperti:

```http
HTTP/1.1 502 Bad Gateway
Content-Type: text/html

<html>nginx error...</html>
```

Jika client selalu parse JSON, akan muncul error sekunder:

```text
JsonParseException: Unexpected character '<'
```

Padahal akar masalahnya adalah downstream/gateway `502`.

Better handling:

```text
1. Read status code.
2. Inspect Content-Type.
3. If expected JSON/problem+json, parse structured body.
4. If unexpected content type, capture small safe snippet.
5. Classify as protocol/transport/gateway error.
```

Pseudo code:

```java
if (status >= 400) {
    String contentType = response.header("Content-Type");

    if (isJson(contentType) || isProblemJson(contentType)) {
        return parseErrorEnvelope(response.body());
    }

    String snippet = readLimitedSnippet(response.body(), 2048);
    throw new DownstreamProtocolException(status, contentType, snippet);
}
```

---

## 34. Headers and Body Coupling

Beberapa header harus konsisten dengan body.

```text
Content-Type      ↔ body format
Content-Length    ↔ body byte length
Content-Encoding  ↔ body encoding
Digest            ↔ body hash, jika dipakai
Idempotency-Key   ↔ logical command identity
If-Match          ↔ resource version being updated
Accept            ↔ response parser
```

Jika header dan body tidak sinkron, request bisa menjadi corrupt secara semantic.

Contoh:

```http
Content-Type: application/json

name=Fajar&role=TL
```

Server mungkin gagal parse, atau lebih buruk: parse dengan fallback yang tidak kita sadari.

---

## 35. Header Redaction Utility

Contoh redaction sederhana:

```java
public final class HeaderRedactor {
    private static final Set<String> SENSITIVE = new HashSet<>(Arrays.asList(
            "authorization",
            "proxy-authorization",
            "cookie",
            "set-cookie",
            "x-api-key",
            "api-key",
            "x-auth-token",
            "x-csrf-token"
    ));

    public static Map<String, List<String>> redact(Map<String, List<String>> headers) {
        Map<String, List<String>> result = new LinkedHashMap<>();

        for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
            String name = entry.getKey();
            if (SENSITIVE.contains(name.toLowerCase(Locale.ROOT))) {
                result.put(name, Collections.singletonList("<redacted>"));
            } else {
                result.put(name, entry.getValue());
            }
        }

        return result;
    }
}
```

Enhancement untuk production:

- support partial redaction,
- support configurable sensitive headers,
- redact query parameters juga,
- redact body fields,
- environment-specific logging,
- sampling,
- test coverage untuk redaction.

---

## 36. Header Testing

Header harus ditest seperti contract lain.

### 36.1 Unit Test Header Policy

```java
@Test
void shouldBuildRequiredHeaders() {
    OutboundHeaderPolicy policy = new OutboundHeaderPolicy(tokenProvider, clientIdentity);

    Map<String, String> headers = policy.buildHeaders(context);

    assertEquals("application/json", headers.get("Accept"));
    assertTrue(headers.get("Authorization").startsWith("Bearer "));
    assertEquals(context.requestId(), headers.get("X-Request-Id"));
}
```

### 36.2 MockWebServer Test

Dengan OkHttp MockWebServer:

```java
RecordedRequest recorded = server.takeRequest();
assertEquals("application/json", recorded.getHeader("Accept"));
assertEquals("application/json", recorded.getHeader("Content-Type"));
assertNotNull(recorded.getHeader("X-Request-Id"));
```

### 36.3 Contract Test

Pastikan kontrak menyebutkan required header:

```yaml
requiredHeaders:
  - Authorization
  - Content-Type
  - Accept
  - X-Request-Id
  - Idempotency-Key
```

### 36.4 Negative Test

Test juga behavior jika header hilang atau salah:

```text
Missing Content-Type -> 415 or client validation failure
Missing Authorization -> 401
Missing Idempotency-Key for command -> client validation failure
Unsupported Accept -> 406
Wrong If-Match -> 412
```

---

## 37. Common Anti-Patterns

### 37.1 Header Tersebar di Semua Method

```java
client.post(url, body, token, requestId, tenantId);
```

Setiap method menyusun header sendiri.

Dampak:

- inconsistent header,
- sulit rotate auth scheme,
- redaction tidak konsisten,
- testing berulang,
- bug muncul di endpoint tertentu saja.

Solusi:

```text
centralized header policy per downstream client
```

### 37.2 Copy Semua Incoming Header

Sudah dibahas: sangat berisiko.

Solusi:

```text
allowlist propagation
```

### 37.3 Accept Terlalu Longgar

```http
Accept: */*
```

Solusi:

```http
Accept: application/json, application/problem+json
```

### 37.4 Authorization Bocor ke Log

Solusi:

```text
redaction by default
security test
log review
```

### 37.5 Idempotency-Key Digenerate Ulang Per Retry

Solusi:

```text
idempotency key generated once per logical command
```

### 37.6 Menganggap Header Single-Value Semua

Solusi:

```text
preserve multi-value semantics
```

### 37.7 Mengabaikan Response Header

Client hanya membaca body.

Padahal response header membawa:

- `Content-Type`,
- `ETag`,
- `Retry-After`,
- rate limit info,
- cache policy,
- request id dari server.

---

## 38. Production Readiness Checklist

Gunakan checklist ini saat review HTTP client.

### Contract

- [ ] Apakah required request headers terdokumentasi?
- [ ] Apakah expected response headers terdokumentasi?
- [ ] Apakah `Content-Type` selalu benar untuk body request?
- [ ] Apakah `Accept` eksplisit?
- [ ] Apakah error media type didukung?
- [ ] Apakah custom header punya alasan desain yang jelas?

### Security

- [ ] Apakah `Authorization`/API key tidak pernah dilog?
- [ ] Apakah header propagation memakai allowlist?
- [ ] Apakah redirect tidak membocorkan credential ke host lain?
- [ ] Apakah header value dari user divalidasi?
- [ ] Apakah sensitive query/header diredact?

### Correctness

- [ ] Apakah command side-effect memakai `Idempotency-Key` jika API mendukung?
- [ ] Apakah retry mempertahankan idempotency key yang sama?
- [ ] Apakah optimistic update memakai `If-Match` jika relevan?
- [ ] Apakah cache revalidation memakai `If-None-Match` jika relevan?
- [ ] Apakah `Vary` dihormati jika memakai cache?

### Resilience

- [ ] Apakah `Retry-After` dibaca untuk `429`/`503`?
- [ ] Apakah rate limit header dimonitor?
- [ ] Apakah compression tidak menyebabkan memory blow-up?
- [ ] Apakah unexpected content type ditangani?

### Observability

- [ ] Apakah `X-Request-Id`/correlation ID dikirim?
- [ ] Apakah `traceparent` dipropagate?
- [ ] Apakah header redaction dites?
- [ ] Apakah metric tidak memakai high-cardinality header?
- [ ] Apakah server request id dari response dicatat jika ada?

### Testing

- [ ] Apakah header policy punya unit test?
- [ ] Apakah integration test memverifikasi actual outgoing header?
- [ ] Apakah missing/wrong header dites?
- [ ] Apakah redaction test ada?
- [ ] Apakah multi-value header dites jika digunakan?

---

## 39. Design Review Questions

Saat melakukan design review API client, tanyakan:

1. Header apa yang wajib untuk semua request?
2. Header apa yang hanya berlaku untuk endpoint tertentu?
3. Header mana yang berasal dari inbound request?
4. Header mana yang dihasilkan oleh client adapter?
5. Header mana yang secret?
6. Header mana yang boleh dilog?
7. Header mana yang boleh menjadi metric attribute?
8. Header mana yang mempengaruhi retry?
9. Header mana yang mempengaruhi cache?
10. Header mana yang mempengaruhi concurrency control?
11. Header mana yang mempengaruhi parser response?
12. Header mana yang harus dipertahankan antar retry?
13. Header mana yang harus diganti setiap attempt?
14. Apakah redirect policy aman untuk auth header?
15. Apakah header contract diverifikasi dalam test?

Pertanyaan ini sering menemukan bug desain sebelum production.

---

## 40. Mini Case Study: Submit Case ke External Registry

Bayangkan service internal perlu submit enforcement case ke external registry.

Request:

```http
POST /registry/cases
Authorization: Bearer <token>
Content-Type: application/json
Accept: application/json, application/problem+json
X-Request-Id: 018f...
X-Correlation-Id: case-flow-018f...
Traceparent: 00-...
Idempotency-Key: 018f...
X-Client-Version: aceas-registry-client/2.1.0

{
  "caseId": "CASE-2026-0001",
  "subject": "...",
  "documents": [...]
}
```

Response success:

```http
HTTP/1.1 201 Created
Content-Type: application/json
ETag: "registry-case-v1"
X-Request-Id: registry-req-789

{
  "registryReference": "REG-123"
}
```

Response rate limited:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
Retry-After: 60
X-Request-Id: registry-req-790

{
  "type": "https://example.com/problems/rate-limit",
  "title": "Too Many Requests"
}
```

Production-grade client behavior:

```text
1. Attach token from registry token provider.
2. Attach stable idempotency key for this submission command.
3. Attach request/correlation/trace context.
4. Send explicit Accept and Content-Type.
5. On 201, parse body and capture ETag/server request id.
6. On 429, respect Retry-After within retry/deadline policy.
7. On timeout, retry only if idempotency key is stable.
8. On unexpected HTML 502, classify as gateway/protocol error.
9. Log with redacted Authorization.
10. Emit metrics without request-id as label.
```

This is the difference between “it can call API” and “it can survive production”.

---

## 41. Key Takeaways

1. Header adalah bagian dari contract, bukan dekorasi.
2. `Content-Type` menjelaskan body yang dikirim; `Accept` menjelaskan response yang diinginkan.
3. Jangan copy semua inbound header ke outbound request.
4. Credential header harus dikelola target-specific dan diredact selalu.
5. Correlation dan trace headers adalah fondasi diagnosability.
6. `Idempotency-Key` penting untuk retry command side-effect.
7. `ETag`, `If-Match`, dan `If-None-Match` berguna untuk cache dan concurrency correctness.
8. Compression menghemat bandwidth tetapi dapat menambah CPU/memory risk.
9. Response header seperti `Retry-After`, `ETag`, dan rate limit info harus dibaca, bukan diabaikan.
10. Header policy harus diuji seperti business contract.

---

## 42. Hubungan dengan Part Berikutnya

Part ini membahas metadata request/response. Namun header sering berkaitan langsung dengan body:

- `Content-Type` menentukan serializer.
- `Accept` menentukan parser.
- `Content-Encoding` menentukan decompression.
- `Content-Length` menentukan transfer behavior.
- Multipart membutuhkan boundary.
- Streaming membutuhkan lifecycle handling.

Karena itu part berikutnya akan masuk ke:

```text
Part 5 — Body Handling: JSON, Form, Multipart, Streaming, File Upload/Download
```

Di sana kita akan membahas body bukan sebagai `String`, tetapi sebagai data flow yang punya ukuran, lifecycle, memory cost, retryability, dan backpressure implications.

---

## 43. Status Series

Selesai:

```text
Part 0 — Orientation: HTTP Client sebagai Production Subsystem, Bukan Utility
Part 1 — Java HTTP Client Landscape di Java 8–25
Part 2 — Request Lifecycle Deep Dive: Dari Method Call Sampai Response Body
Part 3 — URI, URL, Encoding, Query Parameter, dan Canonical Request
Part 4 — Headers, Content Negotiation, Compression, dan Metadata Contract
```

Belum selesai. Masih lanjut ke part berikutnya.



<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 3 — URI, URL, Encoding, Query Parameter, dan Canonical Request](./03-uri-url-encoding-query-and-canonical-request.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 5 — Body Handling: JSON, Form, Multipart, Streaming, File Upload/Download](./05-request-response-body-json-form-multipart-streaming.md)

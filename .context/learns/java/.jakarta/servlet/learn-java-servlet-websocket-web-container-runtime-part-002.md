# learn-java-servlet-websocket-web-container-runtime — Part 002
# HTTP Fundamentals for Servlet Engineers

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `002`  
> Topik: HTTP fundamentals untuk engineer Servlet/WebSocket  
> Rentang: Java 8 sampai Java 25, Java EE `javax.*` sampai Jakarta EE `jakarta.*`  
> Status seri: belum selesai  

---

## 0. Tujuan Part Ini

Part ini membangun fondasi HTTP yang wajib dimiliki sebelum masuk terlalu jauh ke `HttpServletRequest`, `HttpServletResponse`, filter, dispatcher, async servlet, SSE, WebSocket upgrade, reverse proxy, load balancer, dan container tuning.

Banyak developer Java web merasa sudah “paham HTTP” karena pernah memakai annotation seperti:

```java
@GetMapping("/users/{id}")
@PostMapping("/orders")
```

atau:

```java
@GET
@Path("/users/{id}")
```

Tetapi di level Servlet/container, HTTP bukan sekadar routing REST. HTTP adalah **kontrak protokol** yang menentukan:

1. bagaimana request dibaca,
2. kapan body boleh dibaca,
3. kapan response dianggap committed,
4. kapan header masih boleh diubah,
5. kapan client boleh retry,
6. kapan cache boleh menyimpan response,
7. kapan proxy boleh memutus koneksi,
8. kapan redirect aman,
9. kapan request bisa dianggap malformed,
10. kapan error berasal dari aplikasi, container, proxy, atau browser.

Mental model utama part ini:

> Servlet bukan abstraksi di atas Java object biasa. Servlet adalah boundary antara **HTTP message semantics** dan **application code**.

Kalau HTTP semantics-nya salah, kode Java yang terlihat benar bisa tetap menghasilkan bug produksi:

- `GET` mengubah data lalu di-prefetch browser/cache.
- `POST` dipakai untuk operation yang sebenarnya idempotent tapi retry-nya berbahaya.
- `Content-Type` salah sehingga body parser gagal.
- Filter membaca request body lalu controller tidak bisa membacanya lagi.
- Response sudah committed, tetapi aplikasi masih mencoba mengubah status code.
- Redirect memakai `http://` karena app tidak paham TLS termination di proxy.
- Download besar gagal karena response buffering dan timeout.
- WebSocket mati setelah 60 detik karena idle timeout proxy, bukan karena bug Java.

---

## 1. Posisi HTTP di Dalam Java Web Runtime

Sebelum request mencapai servlet, ia biasanya melewati beberapa layer:

```text
Client / Browser / Mobile App / API Consumer
        |
        |  HTTP request
        v
DNS / CDN / WAF / API Gateway
        |
        v
Load Balancer / Reverse Proxy / Ingress
        |
        v
Servlet Container Connector
        |
        v
Filter Chain
        |
        v
Servlet / Framework Dispatcher
        |
        v
Application Service / Domain / Database / External API
```

Di setiap layer, HTTP message bisa dipengaruhi oleh:

- header ditambah,
- header dihapus,
- body dibatasi,
- body di-buffer,
- body di-compress/decompress,
- connection di-keep-alive,
- timeout diterapkan,
- request di-retry,
- scheme berubah dari HTTPS ke HTTP internal,
- path di-rewrite,
- status code diganti,
- error page dihasilkan sebelum mencapai aplikasi.

Servlet container menerima HTTP message yang sudah melewati dunia luar tersebut, lalu mengubahnya menjadi object seperti:

```java
jakarta.servlet.http.HttpServletRequest
jakarta.servlet.http.HttpServletResponse
```

atau pada legacy stack:

```java
javax.servlet.http.HttpServletRequest
javax.servlet.http.HttpServletResponse
```

Hal penting:

> `HttpServletRequest` bukan HTTP request mentah. Ia adalah representasi request menurut container setelah parsing, normalisasi, konfigurasi connector, dan kemungkinan pengaruh proxy.

Karena itu, engineer Servlet yang kuat tidak hanya bertanya:

> “Controller mana yang dipanggil?”

Tetapi juga:

> “Apa HTTP message yang benar-benar diterima container, bagaimana container mem-parsing-nya, dan kapan aplikasi mulai mengubah response?”

---

## 2. HTTP Sebagai Message Protocol

HTTP adalah protokol pertukaran message. Secara sederhana:

```text
Client sends request
Server sends response
```

Request dan response terdiri dari:

```text
Start line
Headers
Blank line
Optional body
```

Contoh HTTP/1.1 request:

```http
POST /orders?source=web HTTP/1.1
Host: example.com
Content-Type: application/json
Accept: application/json
Content-Length: 82
Authorization: Bearer eyJ...

{
  "customerId": "CUST-001",
  "items": [{"sku": "BOOK-1", "qty": 2}]
}
```

Contoh HTTP/1.1 response:

```http
HTTP/1.1 201 Created
Content-Type: application/json
Location: /orders/ORD-123
Cache-Control: no-store
Content-Length: 48

{
  "orderId": "ORD-123",
  "status": "CREATED"
}
```

Di Servlet, elemen tersebut kira-kira dipetakan menjadi:

| HTTP concept | Servlet API |
|---|---|
| Method | `request.getMethod()` |
| Request URI | `request.getRequestURI()` |
| Query string | `request.getQueryString()` |
| Header | `request.getHeader(name)` |
| Body input stream | `request.getInputStream()` |
| Character body reader | `request.getReader()` |
| Status code | `response.setStatus(...)` |
| Response header | `response.setHeader(...)`, `addHeader(...)` |
| Response body binary | `response.getOutputStream()` |
| Response body text | `response.getWriter()` |
| Redirect | `response.sendRedirect(...)` |
| Error response | `response.sendError(...)` |

Namun mapping ini tidak selalu 1:1 karena Servlet container melakukan parsing, buffering, encoding, session tracking, dispatching, dan error handling.

---

## 3. HTTP Stateless, Tapi Aplikasi Tidak Selalu Stateless

HTTP secara protokol bersifat stateless: setiap request berdiri sendiri. Server tidak secara otomatis mengingat request sebelumnya.

Tetapi aplikasi web sering membutuhkan state:

- login session,
- CSRF token,
- shopping cart,
- wizard form,
- uploaded file progress,
- user preference,
- WebSocket presence,
- polling cursor,
- pagination cursor.

State biasanya dibangun di atas HTTP melalui:

- cookies,
- session ID,
- bearer token,
- URL parameter,
- hidden form field,
- server-side session store,
- external cache,
- database,
- client-side local/session storage.

Di Servlet, state yang paling klasik adalah:

```java
HttpSession session = request.getSession();
session.setAttribute("userId", userId);
```

Tetapi jangan salah memahami:

> `HttpSession` bukan fitur HTTP murni. Ia adalah state abstraction yang dibuat Servlet container di atas request stateless, biasanya memakai cookie `JSESSIONID`.

Implikasi engineering:

- Kalau cookie hilang, session hilang.
- Kalau app pindah node tanpa sticky session/replication, session bisa hilang.
- Kalau session terlalu besar, memory cluster bisa bocor.
- Kalau user membuka banyak tab, request paralel bisa mengakses session yang sama.
- Kalau logout terjadi di satu tab, tab lain bisa mengirim request dengan cookie lama.

Kita akan membahas session detail di Part 012. Di part ini cukup pegang satu prinsip:

> HTTP stateless; state aplikasi adalah desain tambahan yang harus punya lifecycle, timeout, consistency, dan failure model sendiri.

---

## 4. Anatomy Request Line

HTTP/1.1 request line berbentuk:

```http
METHOD request-target HTTP-version
```

Contoh:

```http
GET /aceas/application/list?page=1&size=20 HTTP/1.1
```

Komponen:

| Komponen | Contoh | Makna |
|---|---|---|
| Method | `GET` | Intent request |
| Request target | `/aceas/application/list?page=1&size=20` | Target resource + query |
| Version | `HTTP/1.1` | Versi wire protocol |

Di Servlet, container mengurai request target menjadi beberapa bagian:

```text
https://agency.example.com/aceas/application/list?page=1&size=20
\___/  \________________/ \____/ \_______________/ \______________/
scheme       host         context     path            query string
```

Servlet API dapat memberikan:

```java
request.getScheme();        // "http" atau "https" menurut container
request.getServerName();    // host menurut container
request.getServerPort();    // port menurut container
request.getContextPath();   // misalnya "/aceas"
request.getRequestURI();    // misalnya "/aceas/application/list"
request.getQueryString();   // "page=1&size=20"
request.getRequestURL();    // reconstructed URL
```

Tetapi di belakang reverse proxy, nilai-nilai ini bisa misleading.

Contoh topologi:

```text
Browser --HTTPS--> ALB --HTTP--> Tomcat
```

Browser melihat:

```text
https://agency.example.com/aceas/application/list
```

Tomcat mungkin melihat:

```text
http://10.0.12.34:8080/aceas/application/list
```

Kalau aplikasi membuat redirect berdasarkan `request.getScheme()`, ia bisa menghasilkan redirect ke HTTP internal, bukan HTTPS publik.

Bug umum:

```java
String url = request.getScheme() + "://" + request.getServerName() + "/login";
response.sendRedirect(url);
```

Di environment reverse proxy, ini bisa menyebabkan:

- redirect ke internal host,
- mixed-content issue,
- SSO callback mismatch,
- redirect loop,
- cookie `Secure` tidak terset,
- wrong absolute URL di email/notification.

Solusinya bukan “hardcode HTTPS”, tetapi memahami forwarded headers dan proxy/container configuration. Detailnya akan dibahas di Part 005 dan Part 029.

---

## 5. HTTP Method Semantics

HTTP method bukan hanya nama operation. Method membawa semantics yang memengaruhi:

- browser behavior,
- cache behavior,
- retry behavior,
- crawler behavior,
- proxy behavior,
- API gateway policy,
- observability,
- idempotency design,
- security control.

Method umum:

| Method | Tujuan umum | Body request? | Safe? | Idempotent? | Umum dipakai untuk |
|---|---:|---:|---:|---:|---|
| `GET` | Mengambil representasi resource | Sebaiknya tidak bergantung pada body | Ya | Ya | Read/query |
| `HEAD` | Seperti GET tanpa body response | Tidak umum | Ya | Ya | Metadata, cache validation |
| `POST` | Memproses payload / create subordinate resource / command | Ya | Tidak | Tidak secara default | Create, submit command |
| `PUT` | Replace/create resource pada URI target | Ya | Tidak | Ya | Full replace/upsert |
| `PATCH` | Partial modification | Ya | Tidak | Tergantung desain | Partial update |
| `DELETE` | Menghapus resource | Biasanya tidak | Tidak | Ya secara semantics | Delete |
| `OPTIONS` | Menanyakan capabilities | Biasanya tidak | Ya | Ya | CORS preflight, API introspection |
| `TRACE` | Diagnostic loop-back | Tidak untuk app umum | Ya | Ya | Biasanya disabled |

### 5.1 Safe Method

Method disebut **safe** jika request tidak dimaksudkan mengubah state server.

`GET`, `HEAD`, dan `OPTIONS` umumnya safe.

Safe bukan berarti “tidak ada side effect sama sekali”. Server masih boleh:

- menulis access log,
- menambah metric,
- memperbarui last-seen analytics,
- mengisi cache.

Tetapi safe berarti client tidak meminta perubahan state bisnis.

Contoh salah:

```http
GET /orders/ORD-123/cancel
```

Kenapa buruk?

- Browser bisa prefetch link.
- Crawler bisa mengikuti link.
- Cache/proxy bisa mengulang validasi.
- User bisa reload tanpa sadar.
- CSRF risk meningkat.

Lebih benar:

```http
POST /orders/ORD-123/cancellation-requests
```

atau:

```http
PATCH /orders/ORD-123
Content-Type: application/json

{
  "status": "CANCELLED"
}
```

Tergantung model domain.

### 5.2 Idempotent Method

Method disebut **idempotent** jika efek beberapa request identik dengan efek satu request, untuk request yang sama.

Contoh:

```http
DELETE /orders/ORD-123
```

Jika order sudah terhapus, pengulangan DELETE tidak membuat “lebih terhapus”. Server bisa mengembalikan `204`, `404`, atau response lain sesuai desain, tetapi state akhirnya sama.

Contoh PUT idempotent:

```http
PUT /users/U-100/profile
Content-Type: application/json

{
  "displayName": "Fajar",
  "language": "id"
}
```

Dikirim sekali atau lima kali, hasil resource target tetap sama.

Contoh POST tidak idempotent:

```http
POST /payments
Content-Type: application/json

{
  "amount": 100000,
  "currency": "IDR"
}
```

Kalau dikirim dua kali, bisa menciptakan dua payment.

Untuk POST yang perlu aman terhadap retry, desain perlu idempotency key:

```http
POST /payments HTTP/1.1
Idempotency-Key: 7b0b6c2f-1d1e-4f43-8a18-65b6e0d2d7ef
Content-Type: application/json

{
  "amount": 100000,
  "currency": "IDR"
}
```

Server menyimpan hasil untuk key tersebut sehingga retry tidak membuat duplicate operation.

### 5.3 Cacheable

Beberapa method/response bisa di-cache jika header mengizinkan. Dalam praktik, cache paling sering berkaitan dengan `GET` dan `HEAD`.

Cache bukan hanya browser cache. Bisa juga:

- CDN,
- reverse proxy,
- API gateway,
- service worker,
- intermediate corporate proxy.

Contoh response cacheable:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: public, max-age=60
ETag: "user-list-v17"

...
```

Contoh response yang tidak boleh disimpan:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "nric": "...",
  "email": "..."
}
```

Kesalahan cache pada aplikasi regulator/enterprise sangat berbahaya:

- user melihat data user lain,
- browser menyimpan data sensitif,
- proxy menyajikan data stale,
- audit trail tampak tidak konsisten,
- logout tidak benar-benar menghapus data dari history/cache.

---

## 6. Method Design: Resource vs Command

Dalam sistem bisnis kompleks, tidak semua operation cocok dimodelkan sebagai CRUD resource sederhana.

Contoh domain:

- submit application,
- approve appeal,
- reject case,
- assign officer,
- escalate enforcement,
- reopen investigation,
- regenerate invoice,
- resend notification.

Pemula sering memaksa semuanya menjadi:

```http
PUT /case/123
```

atau:

```http
POST /case/update
```

Engineer yang lebih matang membedakan antara:

1. **Resource representation update**
2. **Command/action with business transition**
3. **Sub-resource creation**
4. **State-machine transition**

Contoh lebih jelas:

```http
POST /cases/CASE-123/assignments
```

Makna:

- membuat assignment event/resource baru,
- bisa divalidasi,
- bisa diaudit,
- bisa punya idempotency key,
- bisa punya status sendiri.

Contoh transition:

```http
POST /cases/CASE-123/transitions
Content-Type: application/json

{
  "transition": "ESCALATE",
  "reason": "Repeated non-compliance"
}
```

Dalam konteks Servlet, method semantics ini penting karena filter, cache, reverse proxy, access log, rate limit, dan retry policy sering bergantung pada method.

Contoh policy:

```text
GET     -> boleh cache, rate limit lebih longgar
POST    -> no cache, perlu CSRF/idempotency/audit
PUT     -> idempotent retry mungkin aman
DELETE  -> privileged, audited, idempotent semantics
OPTIONS -> CORS preflight, jangan masuk business logic
```

---

## 7. Status Code Semantics

Status code adalah cara server menyatakan hasil pemrosesan request.

Kelas status:

| Kelas | Range | Makna umum |
|---|---:|---|
| 1xx | 100-199 | Informational |
| 2xx | 200-299 | Success |
| 3xx | 300-399 | Redirection |
| 4xx | 400-499 | Client-side/request problem |
| 5xx | 500-599 | Server-side problem |

Status code bukan kosmetik. Ia memengaruhi:

- retry client,
- browser behavior,
- monitoring alert,
- API gateway policy,
- cache behavior,
- SLO calculation,
- incident triage.

### 7.1 Common 2xx

| Status | Makna | Contoh |
|---:|---|---|
| 200 OK | Request berhasil, response body berisi representasi/hasil | Query list, update returns object |
| 201 Created | Resource baru dibuat | Create order/application |
| 202 Accepted | Request diterima tapi belum selesai | Async job/report generation |
| 204 No Content | Berhasil tanpa body | Delete/update minimal |
| 206 Partial Content | Partial response | Range download |

Contoh `201 Created`:

```http
HTTP/1.1 201 Created
Location: /applications/APP-123
Content-Type: application/json

{
  "applicationId": "APP-123"
}
```

Contoh `202 Accepted` untuk proses async:

```http
HTTP/1.1 202 Accepted
Location: /jobs/JOB-789
Content-Type: application/json

{
  "jobId": "JOB-789",
  "status": "QUEUED"
}
```

`202` penting untuk operasi yang tidak seharusnya menahan request thread lama:

- report besar,
- export data,
- integration call panjang,
- bulk recalculation,
- document generation.

### 7.2 Common 3xx

| Status | Makna | Catatan |
|---:|---|---|
| 301 | Moved Permanently | Bisa di-cache; hati-hati untuk API |
| 302 | Found | Legacy redirect; method handling historis ambigu |
| 303 | See Other | Umum setelah POST, redirect ke GET result page |
| 307 | Temporary Redirect | Method/body dipertahankan |
| 308 | Permanent Redirect | Method/body dipertahankan, permanent |

Untuk form submit klasik:

```text
POST /applications
  -> 303 See Other
Location: /applications/APP-123
  -> browser GET /applications/APP-123
```

Pattern ini dikenal sebagai Post/Redirect/Get.

Kenapa penting?

- mencegah duplicate submit saat refresh,
- membuat browser history lebih aman,
- mengarahkan user ke representation resource.

Di Servlet:

```java
response.setStatus(HttpServletResponse.SC_SEE_OTHER); // 303
response.setHeader("Location", request.getContextPath() + "/applications/APP-123");
```

atau menggunakan `sendRedirect`, tetapi pahami status default container/framework dan perubahan API pada versi modern.

### 7.3 Common 4xx

| Status | Makna | Contoh |
|---:|---|---|
| 400 | Bad Request | JSON invalid, parameter malformed |
| 401 | Unauthorized | Belum authenticated / credential invalid |
| 403 | Forbidden | Authenticated tapi tidak berhak |
| 404 | Not Found | Resource/path tidak ditemukan |
| 405 | Method Not Allowed | Path ada, method tidak didukung |
| 409 | Conflict | Version conflict, state transition invalid |
| 410 | Gone | Resource sudah tidak tersedia permanen |
| 413 | Content Too Large | Upload/body terlalu besar |
| 414 | URI Too Long | Query/path terlalu panjang |
| 415 | Unsupported Media Type | `Content-Type` tidak didukung |
| 422 | Unprocessable Content | Payload valid secara syntax, invalid secara domain |
| 429 | Too Many Requests | Rate limit |
| 431 | Request Header Fields Too Large | Header/cookie terlalu besar |

Common mistake:

```text
Semua error validasi -> 500
```

Ini salah karena 500 berarti server failure. Kalau user mengirim JSON invalid, required field kosong, atau transition tidak valid, itu biasanya 4xx.

Contoh untuk invalid state transition:

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "error": "INVALID_STATE_TRANSITION",
  "message": "Case cannot be approved while investigation is still open."
}
```

Kenapa `409`, bukan `400`?

Karena request secara syntax mungkin valid, tetapi bertentangan dengan current state resource.

### 7.4 Common 5xx

| Status | Makna | Contoh |
|---:|---|---|
| 500 | Internal Server Error | Unhandled exception, bug |
| 501 | Not Implemented | Server tidak mendukung capability |
| 502 | Bad Gateway | Proxy/gateway mendapat response invalid dari upstream |
| 503 | Service Unavailable | Overload/maintenance/dependency unavailable |
| 504 | Gateway Timeout | Gateway/proxy timeout menunggu upstream |

Penting: `504` sering bukan dihasilkan aplikasi Java, tetapi oleh reverse proxy/load balancer/API gateway karena upstream terlalu lama menjawab.

Contoh:

```text
Browser -> ALB timeout 60s -> 504
                  |
                  v
              Tomcat masih memproses 120s
```

Dari perspektif Java log, request mungkin sukses setelah 120 detik. Dari perspektif user, request gagal 504 pada detik 60.

Inilah kenapa HTTP timeout alignment sangat penting.

---

## 8. Headers: Metadata yang Mengubah Semantics

HTTP header adalah pasangan name-value yang membawa metadata request/response.

Contoh request headers:

```http
Host: api.example.com
Accept: application/json
Accept-Encoding: gzip, br
Content-Type: application/json
Authorization: Bearer eyJ...
Cookie: JSESSIONID=...
X-Request-ID: abc-123
```

Contoh response headers:

```http
Content-Type: application/json; charset=UTF-8
Cache-Control: no-store
Set-Cookie: JSESSIONID=...; Path=/; HttpOnly; Secure; SameSite=Lax
Location: /orders/ORD-123
ETag: "v3"
```

Di Servlet:

```java
String accept = request.getHeader("Accept");
response.setHeader("Cache-Control", "no-store");
```

Header names case-insensitive secara HTTP, tapi best practice tetap memakai canonical casing untuk readability.

### 8.1 Header Tidak Sama dengan Parameter

Jangan campur:

| Data | Lokasi |
|---|---|
| `Accept` | Header |
| `Content-Type` | Header |
| `page=1` | Query parameter |
| JSON field `name` | Body |
| `JSESSIONID` | Cookie header |
| Correlation ID | Header |

Pemula sering melakukan desain seperti:

```http
POST /api?action=approve&userId=123
```

Padahal sebagian data lebih tepat di:

- path: identity resource,
- body: command payload,
- header: metadata request,
- cookie/token: authentication/session context.

Contoh lebih bersih:

```http
POST /cases/CASE-123/approval-decisions
Content-Type: application/json
X-Request-ID: req-123

{
  "decision": "APPROVE",
  "reason": "All requirements satisfied"
}
```

---

## 9. Content-Type vs Accept

Dua header ini sering tertukar.

### 9.1 `Content-Type`

`Content-Type` menjelaskan format body yang dikirim dalam message.

Pada request:

```http
POST /applications HTTP/1.1
Content-Type: application/json

{"name":"Fajar"}
```

Maknanya:

> Client mengirim body berformat JSON.

Pada response:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=UTF-8

{"status":"OK"}
```

Maknanya:

> Server mengirim body berformat JSON.

### 9.2 `Accept`

`Accept` menjelaskan format response yang diinginkan client.

```http
GET /applications/APP-123 HTTP/1.1
Accept: application/json
```

Maknanya:

> Client ingin menerima JSON.

Jika server tidak dapat memenuhi, server dapat mengembalikan:

```http
HTTP/1.1 406 Not Acceptable
```

### 9.3 Kesalahan Umum

Salah:

```http
POST /applications
Accept: application/json

{"name":"Fajar"}
```

Body ada JSON, tetapi tidak ada `Content-Type`. Server tidak wajib menebak.

Benar:

```http
POST /applications
Content-Type: application/json
Accept: application/json

{"name":"Fajar"}
```

Di Servlet/filter level, kalau ingin membaca body JSON, jangan hanya melihat path/method. Periksa juga `Content-Type`.

Pseudo-code:

```java
String contentType = request.getContentType();
if (contentType == null || !contentType.toLowerCase(Locale.ROOT).startsWith("application/json")) {
    response.sendError(HttpServletResponse.SC_UNSUPPORTED_MEDIA_TYPE);
    return;
}
```

---

## 10. Content Negotiation

Content negotiation adalah proses memilih representasi response berdasarkan request headers.

Header terkait:

| Header | Fungsi |
|---|---|
| `Accept` | Media type yang diterima client |
| `Accept-Language` | Bahasa yang diinginkan |
| `Accept-Encoding` | Encoding kompresi yang didukung |
| `Accept-Charset` | Charset yang diterima, jarang dipakai modern |

Contoh:

```http
GET /reports/123 HTTP/1.1
Accept: application/pdf, application/json;q=0.8
Accept-Language: id-ID,id;q=0.9,en;q=0.7
Accept-Encoding: gzip, br
```

Makna:

- client lebih suka PDF,
- JSON juga diterima dengan prioritas lebih rendah,
- bahasa Indonesia prioritas utama,
- response boleh dikompresi gzip/brotli jika server/proxy mendukung.

### 10.1 Quality Value

`q` menunjukkan preferensi relatif.

```http
Accept: application/json;q=1.0, text/html;q=0.8, */*;q=0.1
```

Artinya:

1. JSON paling disukai,
2. HTML masih diterima,
3. apa pun boleh sebagai fallback rendah.

Framework seperti Spring MVC/JAX-RS sering menangani content negotiation. Tetapi di Servlet murni, kita harus eksplisit.

Contoh sederhana:

```java
String accept = Optional.ofNullable(request.getHeader("Accept")).orElse("*/*");

if (accept.contains("application/json") || accept.contains("*/*")) {
    response.setContentType("application/json");
    response.getWriter().write("{\"status\":\"OK\"}");
} else if (accept.contains("text/plain")) {
    response.setContentType("text/plain");
    response.getWriter().write("OK");
} else {
    response.sendError(HttpServletResponse.SC_NOT_ACCEPTABLE);
}
```

Ini belum parser `Accept` yang sempurna, tapi menunjukkan mental model.

### 10.2 `Vary` Header

Jika response berbeda berdasarkan header request, server perlu mengirim `Vary` agar cache tidak salah.

Contoh:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Vary: Accept, Accept-Language
```

Tanpa `Vary`, cache bisa menyajikan response bahasa/format yang salah ke client lain.

---

## 11. Request Body Semantics

HTTP request body adalah optional. Tidak semua method umum memakai body.

Di Servlet:

```java
ServletInputStream in = request.getInputStream();
```

atau:

```java
BufferedReader reader = request.getReader();
```

Aturan penting:

> Untuk satu request, jangan campur `getInputStream()` dan `getReader()` sembarangan. Pilih binary stream atau character reader.

### 11.1 Body Hanya Bisa Dibaca Sekali Secara Natural

Request body adalah stream. Setelah dibaca, data tidak otomatis bisa dibaca ulang.

Bug umum di filter:

```java
public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain) {
    String body = new String(request.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    log.info("body={}", body);
    chain.doFilter(request, response);
}
```

Akibatnya controller/framework di belakang filter menemukan body kosong.

Solusi konseptual:

- jangan log full body by default,
- gunakan wrapper yang caching body dengan limit ukuran,
- hanya cache body untuk media type tertentu,
- jangan cache upload besar,
- redaksi data sensitif,
- perhatikan memory pressure.

Request wrapper akan dibahas detail di Part 005 dan Part 009.

### 11.2 `getParameter()` Bisa Memicu Body Parsing

Untuk `application/x-www-form-urlencoded`, parameter form bisa berasal dari body.

Contoh:

```http
POST /login HTTP/1.1
Content-Type: application/x-www-form-urlencoded

username=fajar&password=secret
```

Saat memanggil:

```java
request.getParameter("username")
```

container mungkin perlu membaca dan mem-parsing body.

Implikasi:

- setelah parameter parsing, raw body stream mungkin tidak lagi tersedia seperti semula,
- filter yang membaca body sebelum parameter parsing dapat mengubah behavior,
- encoding harus diset sebelum parsing parameter.

Contoh:

```java
request.setCharacterEncoding("UTF-8");
String username = request.getParameter("username");
```

Kalau encoding diset setelah `getParameter`, bisa terlambat.

### 11.3 Body Size Limit

Body terlalu besar bisa ditolak oleh:

- browser/client,
- reverse proxy,
- load balancer,
- ingress,
- servlet container,
- framework multipart parser,
- application code.

Status yang umum:

```http
413 Content Too Large
```

Topologi bug:

```text
Nginx client_max_body_size = 1 MB
Tomcat maxPostSize         = 20 MB
Application limit          = 10 MB
```

User upload 5 MB:

- Nginx menolak duluan,
- Java app tidak pernah menerima request,
- log aplikasi kosong,
- user melihat error dari proxy.

Engineer yang matang selalu memeriksa body limit di semua layer.

---

## 12. Response Body Semantics

Response body ditulis lewat:

```java
response.getWriter()
```

atau:

```java
response.getOutputStream()
```

Pilih salah satu.

| API | Cocok untuk |
|---|---|
| `getWriter()` | Text: HTML, JSON, plain text, XML |
| `getOutputStream()` | Binary: PDF, image, zip, file download |

### 12.1 Content-Type Harus Diset Sebelum Menulis

```java
response.setContentType("application/json");
response.setCharacterEncoding("UTF-8");
response.getWriter().write("{\"status\":\"OK\"}");
```

Pada Servlet modern, beberapa API menyediakan overload berbasis `Charset`, tetapi prinsipnya sama:

> Tentukan metadata response sebelum body ditulis/committed.

### 12.2 Response Commit

Response disebut **committed** ketika status dan header sudah dikirim ke client. Setelah committed:

- status tidak bisa diubah secara efektif,
- header baru mungkin tidak terkirim,
- `sendError` bisa gagal/terlambat,
- redirect tidak mungkin dilakukan dengan benar.

Response bisa committed karena:

- buffer penuh,
- `flush()` dipanggil,
- writer/output stream ditutup,
- container memutuskan mengirim data,
- streaming response berjalan.

Bug umum:

```java
response.getWriter().write("partial data");

try {
    riskyOperation();
} catch (Exception e) {
    response.sendError(500); // terlambat jika response sudah committed
}
```

Pattern yang lebih aman:

- lakukan validasi sebelum menulis response,
- siapkan data sebelum commit,
- untuk streaming, punya error protocol sendiri,
- jangan mengandalkan status code setelah body mulai terkirim.

### 12.3 Buffering

Container biasanya memiliki response buffer. Selama buffer belum flush/commit, app masih bisa mengubah status/header.

```java
response.setBufferSize(32 * 1024); // harus sebelum body write
```

Tetapi jangan memperbesar buffer sembarangan untuk semua response. Buffer besar per request bisa menambah memory pressure.

Trade-off:

| Buffer kecil | Buffer besar |
|---|---|
| Lebih cepat commit | Lebih lama bisa ubah header/status |
| Memory lebih rendah | Memory lebih tinggi |
| Streaming lebih natural | Bisa mengurangi flush kecil |
| Error handling setelah write lebih sulit | Error handling sebelum commit lebih fleksibel |

---

## 13. `Content-Length` vs Chunked Transfer

HTTP response/request body perlu framing: penerima harus tahu kapan body selesai.

Umum di HTTP/1.1:

1. `Content-Length`
2. `Transfer-Encoding: chunked`
3. connection close sebagai delimiter, untuk case tertentu/legacy

### 13.1 Content-Length

```http
Content-Length: 48
```

Makna:

> Body persis 48 bytes.

Keuntungan:

- client tahu progress,
- beberapa proxy/cache lebih mudah menangani,
- cocok untuk body yang sudah diketahui ukurannya.

Di Servlet:

```java
byte[] body = json.getBytes(StandardCharsets.UTF_8);
response.setContentType("application/json");
response.setContentLength(body.length);
response.getOutputStream().write(body);
```

Untuk body besar, jangan selalu materialize ke byte array hanya demi `Content-Length`.

### 13.2 Chunked Transfer

Jika panjang body tidak diketahui di awal, server bisa mengirim chunk.

Konseptual:

```http
Transfer-Encoding: chunked

5\r\n
hello\r\n
6\r\n
 world\r\n
0\r\n
\r\n
```

Dalam Servlet, kita biasanya tidak menulis chunk framing manual. Container yang mengatur.

Streaming response, SSE, dan download yang tidak diketahui ukurannya sering memakai mekanisme semacam ini.

### 13.3 Bug Content-Length Salah

Jika `Content-Length` lebih kecil dari body aktual:

- client membaca body terpotong,
- sisa bytes bisa mengganggu connection reuse.

Jika `Content-Length` lebih besar:

- client menunggu bytes yang tidak pernah datang,
- timeout.

Karena itu, jangan set `Content-Length` manual kecuali benar-benar yakin.

---

## 14. Connection Management: Keep-Alive, Timeout, dan Reuse

HTTP/1.1 default-nya mendukung persistent connection. Artinya satu TCP connection bisa dipakai untuk beberapa request/response secara berurutan.

```text
TCP connection
  request 1 -> response 1
  request 2 -> response 2
  request 3 -> response 3
```

Manfaat:

- mengurangi overhead TCP/TLS handshake,
- latency lebih rendah,
- lebih efisien.

Risiko:

- idle connection memakan resource,
- timeout mismatch antar layer,
- connection reuse bisa terganggu jika framing body salah,
- slow client bisa menahan resource.

Layer timeout umum:

| Layer | Timeout contoh |
|---|---|
| Browser/client | request timeout |
| CDN/WAF | origin timeout |
| Load balancer | idle timeout |
| Reverse proxy | proxy read/send timeout |
| Servlet connector | connection/keep-alive timeout |
| Application | async/request timeout |
| HTTP client ke downstream | connect/read timeout |
| DB pool | query/connection timeout |

Bug produksi sering terjadi karena timeout tidak aligned.

Contoh buruk:

```text
ALB idle timeout                 = 60s
Nginx proxy_read_timeout         = 75s
Tomcat async timeout             = 120s
Application report generation    = 180s
DB query timeout                 = unlimited
```

Hasil:

- user dapat 504 di 60 detik,
- app masih bekerja sampai 180 detik,
- DB masih query,
- thread/resource tetap terpakai,
- retry user memperparah load.

Desain lebih baik:

```text
Synchronous HTTP request max      = 20s
App timeout                       = 18s
Proxy timeout                     = 25s
LB timeout                        = 30s
Long job                          = 202 Accepted + job polling/SSE/WebSocket
DB query timeout                  = sesuai SLA operation
```

Prinsip:

> Timeout paling dalam harus sadar terhadap timeout paling luar. Jangan biarkan pekerjaan mahal terus berjalan setelah client/proxy sudah menyerah.

---

## 15. HTTP/1.1 vs HTTP/2 dalam Konteks Servlet

Servlet engineer tidak selalu perlu menulis kode khusus untuk HTTP/2, tetapi perlu paham dampaknya.

### 15.1 HTTP/1.1

Karakter umum:

- text-based wire format,
- request/response sequential per connection,
- persistent connection,
- head-of-line blocking di level connection,
- banyak connection paralel dari browser ke host.

### 15.2 HTTP/2

Karakter umum:

- binary framing,
- multiplexing beberapa stream dalam satu connection,
- header compression,
- lebih efisien untuk banyak resource,
- biasanya dinegosiasikan via ALPN untuk TLS.

Jakarta Servlet 6.1 specification menyatakan container harus support HTTP dan HTTPS, dan required HTTP versions yang container harus implement adalah HTTP/1.1 dan HTTP/2. Untuk HTTP/2, container harus support `h2` dan `h2c` protocol identifiers dan ALPN implication.

Implikasi untuk app Servlet:

- request tetap terlihat sebagai `HttpServletRequest`,
- response tetap `HttpServletResponse`,
- API aplikasi tidak selalu tahu apakah wire protocol HTTP/1.1 atau HTTP/2,
- connection-level behavior berbeda,
- proxy/LB bisa terminate HTTP/2 lalu meneruskan HTTP/1.1 ke app,
- HTTP/2 multiplexing tidak berarti application processing menjadi parallel tanpa batas; container thread pool/downstream tetap bottleneck.

### 15.3 Kesalahpahaman Umum

Salah:

> “Pakai HTTP/2 berarti tidak perlu tuning thread pool.”

Benar:

> HTTP/2 mengubah efisiensi koneksi dan multiplexing, tetapi request tetap harus diproses oleh container/application. Bottleneck masih bisa berada di worker thread, CPU, DB pool, lock, atau downstream service.

---

## 16. URL, URI, Path, Query: Jangan Dicampur

Istilah sering tertukar:

| Istilah | Contoh | Makna |
|---|---|---|
| URL | `https://example.com/app/users?page=1` | Locator lengkap |
| URI | `/app/users?page=1` atau identifier lain | Identifier resource |
| Path | `/app/users` | Bagian path tanpa query |
| Query string | `page=1` | Parameter setelah `?` |
| Fragment | `#section1` | Tidak dikirim ke server dalam HTTP request |

Browser tidak mengirim fragment ke server.

Contoh:

```text
https://example.com/app/users?page=1#profile
```

Server menerima:

```http
GET /app/users?page=1 HTTP/1.1
Host: example.com
```

Server tidak menerima `#profile`.

Implikasi:

- server tidak bisa membaca fragment OAuth SPA kecuali client JS mengirimkannya,
- routing SPA dengan hash tidak masuk Servlet routing,
- analytics server-side tidak melihat fragment.

---

## 17. Query Parameter vs Path Variable

Contoh path variable:

```http
GET /applications/APP-123
```

Contoh query parameter:

```http
GET /applications?status=PENDING&page=1&size=20
```

Rule of thumb:

| Gunakan path | Gunakan query |
|---|---|
| Identitas resource | Filter/search/sort/pagination |
| Hierarki resource | Optional modifier |
| State target jelas | Non-identity criteria |

Contoh baik:

```http
GET /cases/CASE-123
GET /cases?status=OPEN&assignedTo=U-100&page=2
```

Contoh kurang baik:

```http
GET /case?id=CASE-123
```

Tidak selalu salah, tetapi kurang ekspresif dan menyulitkan cache/log/routing tertentu.

Di Servlet mapping, path dan query juga berbeda:

- servlet mapping tidak memakai query string,
- filter URL pattern tidak berdasarkan query,
- reverse proxy route biasanya berdasarkan path/host/header, bukan query, kecuali konfigurasi khusus.

---

## 18. Percent-Encoding dan Character Encoding

URL hanya bisa membawa karakter tertentu secara aman. Karakter khusus di-encode.

Contoh:

```text
space -> %20 atau + pada form encoding tertentu
/     -> %2F
?     -> %3F
&     -> %26
=     -> %3D
```

Masalah sering muncul saat:

- path variable mengandung slash,
- parameter di-encode dua kali,
- reverse proxy decode sebelum app,
- container reject encoded slash karena security,
- Unicode tidak konsisten.

Contoh:

```http
GET /documents/folder%2Ffile
```

Apakah ini satu segment `folder/file`, atau dua segment `folder` dan `file`?

Jawaban tergantung proxy/container/framework configuration. Security implications besar karena encoded slash bisa dipakai dalam path traversal/bypass mapping.

Prinsip:

> Jangan mendesain identifier yang membutuhkan slash mentah di path variable. Gunakan safe ID, base64url, UUID, atau query/body jika perlu.

### 18.1 Body Character Encoding

Untuk text body:

```http
Content-Type: application/json; charset=UTF-8
```

JSON modern umumnya UTF-8. Untuk form legacy, encoding perlu diperhatikan.

Di Servlet:

```java
request.setCharacterEncoding("UTF-8");
```

Harus dilakukan sebelum membaca parameter/body.

---

## 19. Forms: `application/x-www-form-urlencoded`

HTML form default sering memakai:

```http
Content-Type: application/x-www-form-urlencoded
```

Contoh:

```http
POST /login HTTP/1.1
Content-Type: application/x-www-form-urlencoded

username=fajar&password=secret
```

Di Servlet:

```java
String username = request.getParameter("username");
String password = request.getParameter("password");
```

Hal yang perlu diingat:

- form field menjadi parameter,
- body parsing bisa terjadi saat `getParameter`,
- password tidak boleh dilog,
- CSRF biasanya relevan untuk cookie-authenticated forms,
- redirect setelah POST sering memakai PRG pattern.

---

## 20. Multipart: Boundary-Based Body

File upload HTML form memakai:

```http
Content-Type: multipart/form-data; boundary=----abc123
```

Body terdiri dari beberapa part:

```http
------abc123
Content-Disposition: form-data; name="description"

My document
------abc123
Content-Disposition: form-data; name="file"; filename="report.pdf"
Content-Type: application/pdf

(binary bytes)
------abc123--
```

Di Servlet modern:

```java
@MultipartConfig(
    fileSizeThreshold = 1024 * 1024,
    maxFileSize = 10L * 1024 * 1024,
    maxRequestSize = 20L * 1024 * 1024
)
public class UploadServlet extends HttpServlet {
    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response) throws IOException, ServletException {
        Part file = request.getPart("file");
        // process file
    }
}
```

Multipart detail akan dibahas di Part 016, tetapi dari sisi HTTP pahami:

- `Content-Type` memiliki boundary,
- body bisa sangat besar,
- container bisa menulis temporary file,
- filename dari client tidak boleh dipercaya,
- content type dari client tidak boleh dipercaya,
- size limit harus ada di semua layer.

---

## 21. Cache-Control: Salah Cache Bisa Fatal

Header cache paling penting:

| Header | Fungsi |
|---|---|
| `Cache-Control` | Instruksi cache modern |
| `ETag` | Validator berbasis entity tag |
| `Last-Modified` | Validator berbasis waktu |
| `Expires` | Expiration legacy/HTTP cache |
| `Vary` | Response bervariasi berdasarkan request header |

### 21.1 Sensitive Response

Untuk response sensitif:

```http
Cache-Control: no-store
Pragma: no-cache
```

`no-store` berarti cache tidak boleh menyimpan response.

Cocok untuk:

- profile pribadi,
- data identitas,
- regulatory case data,
- financial document,
- token response,
- report confidential.

### 21.2 Static Asset

Untuk asset dengan fingerprint:

```http
Cache-Control: public, max-age=31536000, immutable
```

Contoh:

```text
/app/assets/main.8fd91a.js
```

Karena filename berubah saat content berubah, cache lama aman.

### 21.3 Conditional Request

Client bisa mengirim:

```http
If-None-Match: "v17"
```

Server bisa menjawab:

```http
HTTP/1.1 304 Not Modified
```

Tanpa body.

Di Servlet, static resource handling sering dilakukan default servlet/container/framework. Tetapi untuk custom download/report, conditional request bisa penting.

---

## 22. CORS Preflight dari Perspektif HTTP

CORS adalah mekanisme browser. Ia bukan mekanisme authorization server-side.

Preflight request:

```http
OPTIONS /api/cases HTTP/1.1
Origin: https://frontend.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type, authorization
```

Response:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://frontend.example.com
Access-Control-Allow-Methods: POST
Access-Control-Allow-Headers: content-type, authorization
Access-Control-Max-Age: 600
```

Kesalahan umum:

- business servlet memproses `OPTIONS` sebagai operation normal,
- CORS filter terlalu longgar `*` untuk credentialed request,
- lupa allow header `Authorization`,
- preflight diblok auth filter sebelum CORS response,
- mengira CORS melindungi API dari non-browser client.

CORS detail security tidak akan diulang terlalu dalam, tetapi filter mechanics akan muncul di Part 009.

---

## 23. Authentication Metadata: Cookie vs Authorization Header

HTTP membawa authentication context umumnya melalui:

```http
Cookie: JSESSIONID=...
```

atau:

```http
Authorization: Bearer eyJ...
```

Perbedaan engineering:

| Mekanisme | Umum untuk | Risiko utama |
|---|---|---|
| Cookie session | Browser web app | CSRF, SameSite, session fixation |
| Bearer token | API/mobile/SPAs tertentu | token leakage, storage, replay |
| mTLS/client cert | service-to-service/high security | cert lifecycle, proxy termination |

Di Servlet, cookie session sangat terkait dengan `HttpSession`. Authorization header biasanya diproses filter/security framework.

Prinsip part ini:

> HTTP hanya membawa credential material. Authentication/authorization adalah layer di atasnya, tetapi salah memahami header/cookie akan membuat security layer rapuh.

---

## 24. Redirect Semantics

Redirect adalah response 3xx dengan `Location`.

Contoh:

```http
HTTP/1.1 303 See Other
Location: /applications/APP-123
```

Di Servlet:

```java
response.sendRedirect(request.getContextPath() + "/applications/APP-123");
```

Masalah redirect umum:

### 24.1 Open Redirect

```java
String next = request.getParameter("next");
response.sendRedirect(next);
```

Attack:

```text
/login?next=https://evil.example/phishing
```

Mitigasi:

- allow only relative paths,
- whitelist host,
- normalize path,
- reject scheme-relative URL `//evil.example`,
- avoid trusting raw request parameter.

### 24.2 Wrong Scheme Behind Proxy

App membangun absolute redirect dari internal scheme.

```text
User sees HTTPS
App sees HTTP
Redirect Location: http://public.example/login
```

Efek:

- downgrade,
- cookie Secure issue,
- SSO callback mismatch.

Solusi:

- forwarded header processing di container/framework,
- canonical external base URL configuration,
- avoid unnecessary absolute redirect.

### 24.3 POST Redirect

Setelah POST sukses, sering lebih baik pakai 303 daripada return HTML langsung.

Flow:

```text
POST /applications
  -> 303 Location: /applications/APP-123
GET /applications/APP-123
  -> 200
```

---

## 25. Error Response: `sendError` vs Normal Body

Di Servlet:

```java
response.sendError(404);
```

atau:

```java
response.setStatus(404);
response.setContentType("application/json");
response.getWriter().write("{...}");
```

Perbedaannya penting.

`sendError` memberi sinyal ke container bahwa error terjadi. Container bisa melakukan error dispatch ke configured error page.

`setStatus` hanya mengatur status response; aplikasi tetap mengontrol body.

Contoh API JSON biasanya lebih eksplisit:

```java
response.setStatus(HttpServletResponse.SC_NOT_FOUND);
response.setContentType("application/json");
response.getWriter().write("{\"error\":\"CASE_NOT_FOUND\"}");
```

Tetapi kalau ingin error page container:

```java
response.sendError(HttpServletResponse.SC_NOT_FOUND);
```

Part 017 akan membahas error dispatch detail.

---

## 26. HTTP Compression

Client mengirim:

```http
Accept-Encoding: gzip, br
```

Server/proxy dapat menjawab:

```http
Content-Encoding: gzip
```

Body yang dikirim adalah compressed representation.

Hal yang perlu dipahami:

- compression bisa dilakukan app container atau reverse proxy,
- jangan kompres file yang sudah compressed seperti zip/jpeg tertentu,
- compression mengurangi bandwidth tetapi menambah CPU,
- compression untuk data sensitif punya risiko tertentu jika attacker bisa mengamati ukuran dan memengaruhi plaintext,
- `Content-Length` untuk compressed body berbeda dari uncompressed body.

Di deployment modern, compression sering lebih baik di reverse proxy/CDN daripada di servlet code manual.

---

## 27. Range Request untuk Download

Client bisa meminta sebagian file:

```http
Range: bytes=0-1023
```

Server menjawab:

```http
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-1023/5000000
```

Berguna untuk:

- resume download,
- video/audio seek,
- large file transfer.

Servlet custom download yang mengabaikan Range mungkin tetap jalan, tetapi UX buruk untuk file besar.

Part 016 akan membahas download besar lebih detail.

---

## 28. Conditional Update: ETag dan Lost Update

HTTP validator tidak hanya untuk cache. Bisa juga untuk concurrency control.

Flow:

```http
GET /cases/CASE-123
```

Response:

```http
HTTP/1.1 200 OK
ETag: "case-v7"

{
  "id": "CASE-123",
  "status": "DRAFT"
}
```

Update:

```http
PUT /cases/CASE-123
If-Match: "case-v7"
Content-Type: application/json

{
  "status": "SUBMITTED"
}
```

Jika resource sudah berubah menjadi v8:

```http
HTTP/1.1 412 Precondition Failed
```

Ini relevan untuk aplikasi case management/regulatory workflow karena banyak officer bisa melihat dan mengubah entity yang sama.

Tidak semua sistem memakai ETag; bisa juga memakai version field di JSON. Tetapi HTTP menyediakan semantics yang kuat jika digunakan dengan benar.

---

## 29. Observability dari HTTP Surface

HTTP menghasilkan sinyal observability dasar:

- method,
- path/template,
- status code,
- duration,
- request size,
- response size,
- user agent,
- remote address,
- request ID,
- upstream status,
- retry count,
- timeout source.

Access log contoh:

```text
10.0.1.10 - - [16/Jun/2026:10:42:11 +0000] "POST /cases/CASE-123/transitions HTTP/1.1" 409 184 32ms "req-abc"
```

App log contoh:

```text
INFO requestId=req-abc method=POST path=/cases/{id}/transitions status=409 durationMs=32 errorCode=INVALID_STATE_TRANSITION
```

Yang harus dihindari:

```text
INFO request=/cases/CASE-123/transitions body={...full sensitive data...}
```

Prinsip:

- log metadata cukup,
- log body hanya dengan policy ketat,
- redact sensitive fields,
- jangan log token/cookie/password,
- gunakan route template, bukan raw path high-cardinality untuk metrics.

Part 030 akan membahas observability detail.

---

## 30. HTTP Failure Taxonomy

Saat request gagal, jangan langsung menyimpulkan “bug Java”. Pecah berdasarkan boundary.

### 30.1 Client-Side Problem

Contoh:

- malformed JSON,
- missing header,
- unsupported media type,
- expired token,
- wrong method,
- upload terlalu besar,
- browser cancel.

Status umum:

```text
400, 401, 403, 404, 405, 413, 415, 422, 429
```

### 30.2 Proxy/Gateway Problem

Contoh:

- upstream timeout,
- upstream connection refused,
- upstream reset,
- body size limit proxy,
- header too large,
- wrong route.

Status umum:

```text
502, 503, 504, 413, 431
```

### 30.3 Container Problem

Contoh:

- max threads exhausted,
- connection backlog full,
- request parsing rejected,
- multipart temp directory full,
- classloader/deployment error,
- connector timeout.

### 30.4 Application Problem

Contoh:

- unhandled exception,
- deadlock,
- slow DB query,
- downstream API timeout,
- invalid state mapping,
- memory pressure.

### 30.5 Network/Client Disconnect

Contoh Java symptoms:

- `Broken pipe`,
- `Connection reset by peer`,
- client abort exception,
- async timeout,
- partial write.

Tidak semua broken pipe adalah server bug. Bisa jadi user menutup browser, mobile network pindah, proxy timeout, atau client cancel.

---

## 31. HTTP dan Servlet: Critical Invariants

Ini adalah invariant yang harus tertanam sebelum menulis Servlet/filter.

### Invariant 1 — Request Body Stream Bukan Data Structure Biasa

Body adalah stream. Sekali dibaca, ia habis kecuali di-cache/wrap.

Konsekuensi:

- filter body logging harus hati-hati,
- validation layer yang membaca body harus mengembalikan stream untuk layer berikutnya,
- upload besar tidak boleh dibaca seluruhnya ke memory.

### Invariant 2 — Header/Status Harus Final Sebelum Response Commit

Setelah commit, response metadata efektif tidak bisa diubah.

Konsekuensi:

- jangan tulis body sebelum validasi penting selesai,
- streaming perlu error protocol sendiri,
- wrapper/filter harus tahu kapan chain sudah commit.

### Invariant 3 — Method Semantics Mempengaruhi Dunia Luar

`GET` bukan sekadar “function read”. `POST` bukan sekadar “function write”.

Konsekuensi:

- cache, browser, crawler, retry, proxy, dan security filter memperlakukan method berbeda.

### Invariant 4 — Status Code adalah Contract, Bukan Dekorasi

Status salah membuat observability dan client behavior salah.

Konsekuensi:

- jangan semua error jadi 500,
- jangan semua success jadi 200,
- gunakan 202 untuk async accepted,
- gunakan 409/412 untuk conflict/concurrency jika tepat.

### Invariant 5 — App Tidak Selalu Melihat HTTP Eksternal yang Sama dengan Client

Reverse proxy bisa mengubah scheme, host, port, path, protocol, dan timeout.

Konsekuensi:

- jangan percaya `getScheme()` mentah di belakang proxy,
- forwarded headers harus dikonfigurasi,
- absolute URL harus canonical.

### Invariant 6 — Timeout adalah Bagian dari Semantics Produksi

Request tidak hanya “berhasil/gagal”, tetapi juga “selesai sebelum boundary menyerah”.

Konsekuensi:

- app timeout harus lebih pendek dari proxy timeout,
- long-running job sebaiknya async,
- downstream timeout wajib ada.

### Invariant 7 — HTTP Tidak Menghilangkan Backpressure

Kalau client lambat, downstream lambat, atau response besar, resource tetap terpakai.

Konsekuensi:

- streaming perlu backpressure awareness,
- thread pool dan connection pool harus dilihat bersama,
- async servlet bukan magic.

---

## 32. Mini Case Study 1: GET yang Mengubah State

### Problem

Sistem memiliki endpoint:

```http
GET /notifications/123/mark-read
```

Saat user membuka dashboard, browser/plugin/prefetcher mengikuti link tersebut. Notification menjadi read tanpa user sengaja.

### HTTP Diagnosis

`GET` adalah safe method. Client/proxy/browser boleh memperlakukan GET sebagai fetch representation yang tidak mengubah business state.

Endpoint melanggar method semantics.

### Redesign

Option 1: command sub-resource

```http
POST /notifications/123/read-events
```

Option 2: update representation

```http
PATCH /notifications/123
Content-Type: application/json

{
  "read": true
}
```

### Servlet Implication

Filter/audit/rate limit bisa membedakan:

```text
GET  /notifications       -> read/query
POST /notifications/*/... -> state change, audit required
```

---

## 33. Mini Case Study 2: 504 Tetapi Tidak Ada Error di App Log

### Problem

User export report besar. Setelah 60 detik browser menerima:

```http
504 Gateway Timeout
```

Aplikasi Java log:

```text
INFO Report generated successfully duration=118000ms
```

### Diagnosis

Request melewati load balancer/proxy dengan timeout 60 detik. App masih bekerja setelah proxy sudah menyerah.

```text
Client -> LB 60s timeout -> Servlet app 118s processing -> DB
```

### Redesign

Gunakan async job:

```http
POST /reports/export-jobs
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /reports/export-jobs/JOB-123

{
  "jobId": "JOB-123",
  "status": "QUEUED"
}
```

Client polling/SSE/WebSocket:

```http
GET /reports/export-jobs/JOB-123
```

atau:

```text
SSE/WebSocket notification saat job selesai
```

### Lesson

HTTP synchronous request bukan tempat ideal untuk operasi tak terbatas. Timeout eksternal adalah bagian dari desain.

---

## 34. Mini Case Study 3: Filter Logging Membuat JSON Body Hilang

### Problem

Filter logging membaca body:

```java
String body = new String(request.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
log.info("body={}", body);
chain.doFilter(request, response);
```

Controller menerima body kosong dan mengembalikan 400.

### Diagnosis

Request body adalah stream. Filter mengonsumsinya sebelum layer berikutnya.

### Redesign

Gunakan request wrapper dengan caching terbatas:

```text
Original request body stream
        |
        v
CachingRequestWrapper reads once with max size
        |
        +--> log sanitized copy
        |
        +--> expose new input stream to downstream
```

Tetapi jangan apply untuk semua request:

- skip multipart,
- max body size kecil,
- redact sensitive fields,
- sampling,
- only on debug/troubleshooting.

### Lesson

Cross-cutting concern di Servlet filter harus menghormati HTTP stream lifecycle.

---

## 35. Mini Case Study 4: Cookie Terlalu Besar Menjadi 431

### Problem

Aplikasi menyimpan terlalu banyak data di cookie:

```text
Cookie: session=...; preferences=...; featureFlags=...; largeToken=...
```

Beberapa request gagal dengan:

```http
431 Request Header Fields Too Large
```

atau proxy-specific error.

### Diagnosis

Cookie dikirim di setiap request ke domain/path yang cocok. Header request membesar. Proxy/container punya limit header size.

### Redesign

- Simpan state besar di server-side session/cache/database.
- Cookie hanya menyimpan opaque session id/token kecil.
- Batasi domain/path cookie.
- Hapus cookie lama dengan path/domain yang benar.
- Monitor request header size.

### Lesson

Cookie bukan storage bebas. Cookie adalah header yang ikut di setiap request.

---

## 36. Mini Case Study 5: API Mengembalikan 200 untuk Error Domain

### Problem

Endpoint transition:

```http
POST /cases/CASE-123/transitions
```

Response saat transition invalid:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": false,
  "error": "INVALID_STATE"
}
```

### Masalah

- Monitoring menganggap sukses.
- Client generic tidak tahu error.
- Retry behavior salah.
- API gateway analytics misleading.
- SLO success rate palsu.

### Redesign

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "error": "INVALID_STATE_TRANSITION",
  "message": "Case cannot move from CLOSED to UNDER_REVIEW.",
  "currentState": "CLOSED"
}
```

### Lesson

Status code adalah bagian dari domain contract di boundary HTTP.

---

## 37. Servlet-Oriented HTTP Checklist

Sebelum membuat endpoint Servlet/framework, tanyakan:

### Request Design

- Apa method yang benar?
- Apakah operation safe?
- Apakah idempotent?
- Apakah butuh idempotency key?
- Data mana di path, query, header, cookie, body?
- Apa `Content-Type` yang diterima?
- Apa `Accept` yang didukung?
- Berapa max body size?
- Apakah body bisa streaming?
- Apakah request butuh session?
- Apakah request bisa dipanggil paralel dari tab/device berbeda?

### Response Design

- Status code success yang tepat?
- Status code failure yang tepat?
- Apakah response body JSON/HTML/binary?
- Apakah `Content-Type` dan charset benar?
- Apakah response boleh di-cache?
- Apakah perlu `Location`?
- Apakah perlu `ETag`?
- Apakah body besar perlu streaming/range?
- Apakah response bisa committed sebelum error terjadi?

### Runtime Design

- Berapa timeout app?
- Berapa timeout proxy/LB?
- Apakah operation terlalu lama untuk synchronous HTTP?
- Apakah perlu 202 + job resource?
- Apakah request bisa dibatalkan?
- Apakah downstream timeout lebih pendek?
- Apakah thread/connection pool cukup?
- Apakah retry client aman?

### Proxy/Deployment Design

- Apakah app di belakang TLS termination?
- Apakah forwarded headers benar?
- Apakah context path/path rewrite benar?
- Apakah body/header limit selaras?
- Apakah redirect absolute URL benar?
- Apakah WebSocket/SSE butuh timeout khusus?

### Observability Design

- Apakah access log mencatat method/path/status/duration/requestId?
- Apakah app log memakai correlation ID?
- Apakah metric memakai route template, bukan raw path?
- Apakah 4xx dan 5xx dipisah?
- Apakah timeout source bisa dibedakan?
- Apakah client abort tidak dianggap incident server otomatis?

---

## 38. Mental Model Akhir Part Ini

Setelah part ini, HTTP harus dipahami sebagai contract dengan beberapa lapisan:

```text
1. Message syntax
   method, target, version, headers, body

2. Semantics
   safe, idempotent, cacheable, status code, content negotiation

3. Transport/runtime behavior
   keep-alive, timeout, chunking, compression, HTTP/1.1 vs HTTP/2

4. Servlet mapping
   request object, response object, stream, buffer, commit

5. Production boundary
   proxy, LB, TLS termination, header/body limits, observability

6. Failure model
   client error, app error, container error, proxy timeout, network disconnect
```

Top-tier Servlet engineer tidak melihat endpoint sebagai function:

```text
request -> controller -> service -> response
```

Melainkan sebagai lifecycle:

```text
HTTP message arrives
  -> proxy may transform/reject/timeout
  -> container parses and maps
  -> filters may inspect/wrap/short-circuit
  -> servlet/framework handles
  -> response metadata/body generated
  -> response may commit/stream/fail
  -> connection reused/closed
  -> logs/metrics/traces emitted
```

Dan selalu bertanya:

> “Di boundary mana semantics berubah, resource tertahan, response committed, retry terjadi, atau timeout muncul?”

Itulah fondasi untuk memahami `HttpServletRequest`, `HttpServletResponse`, dispatch, filter, async servlet, WebSocket upgrade, SSE, reverse proxy, dan container tuning pada part-part berikutnya.

---

## 39. Latihan Pemahaman

Jawab tanpa melihat framework terlebih dahulu.

### Latihan 1

Endpoint berikut bermasalah atau tidak?

```http
GET /applications/APP-123/submit
```

Pertanyaan:

- Apakah method-nya tepat?
- Apa risiko browser/proxy/crawler?
- Redesign URL dan method-nya.

### Latihan 2

Aplikasi export report membutuhkan 2 menit. Load balancer timeout 60 detik.

Pertanyaan:

- Status apa yang kemungkinan user lihat?
- Apakah app log bisa tetap sukses?
- Desain HTTP apa yang lebih tepat?

### Latihan 3

Filter membaca request body untuk logging, lalu controller JSON gagal parsing.

Pertanyaan:

- Apa invariant yang dilanggar?
- Apa solusi wrapper-nya?
- Apa risiko kalau wrapper membaca body upload 200 MB?

### Latihan 4

API mengembalikan:

```http
HTTP/1.1 200 OK

{"success": false}
```

untuk invalid state transition.

Pertanyaan:

- Apa dampaknya ke monitoring?
- Status code apa yang lebih tepat?
- Kapan `400`, `409`, dan `412` dipakai?

### Latihan 5

Aplikasi di belakang HTTPS reverse proxy, tetapi Servlet melihat `request.getScheme()` sebagai `http`.

Pertanyaan:

- Apa kemungkinan efeknya pada redirect?
- Apa efeknya pada cookie Secure?
- Layer mana yang harus dikonfigurasi?

---

## 40. Ringkasan

Part ini membahas HTTP sebagai fondasi Servlet engineering:

- HTTP adalah message protocol dengan start line, headers, dan optional body.
- Method memiliki semantics: safe, idempotent, cacheable.
- Status code adalah contract yang memengaruhi client, proxy, cache, monitoring, dan retry.
- `Content-Type` menjelaskan body message; `Accept` menjelaskan response yang diinginkan.
- Request body adalah stream dan secara natural hanya dibaca sekali.
- Response punya buffer dan commit semantics.
- Timeout, keep-alive, body limit, header limit, compression, dan proxy behavior adalah bagian dari desain produksi.
- HTTP/2 meningkatkan connection efficiency tetapi tidak menghilangkan bottleneck aplikasi.
- Banyak bug Servlet sebenarnya adalah bug HTTP boundary.

Part berikutnya akan masuk ke:

```text
Part 003 — Servlet Container Architecture
```

Di sana kita akan membedah bagaimana container menerima connection, memetakan request ke context/servlet/filter chain, mengelola connector/thread pool, dan menjalankan aplikasi web Java.

---

## 41. Referensi

- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- IETF Datatracker RFC 9110: https://datatracker.ietf.org/doc/html/rfc9110
- Jakarta Servlet 6.1 Specification: https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1
- Jakarta Servlet 6.1 Release Page: https://jakarta.ee/specifications/servlet/6.1/
- MDN — Overview of HTTP: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview
- MDN — HTTP response status codes: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status
- MDN — HTTP headers: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-servlet-websocket-web-container-runtime-part-001](./learn-java-servlet-websocket-web-container-runtime-part-001.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-servlet-websocket-web-container-runtime-part-003](./learn-java-servlet-websocket-web-container-runtime-part-003.md)

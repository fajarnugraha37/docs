# learn-http-for-web-backend-perspective-part-002.md

# Part 002 — Request Lifecycle: From Socket to Controller

> Seri: `learn-http-for-web-backend-perspective`  
> Audience: Java software engineer  
> Fokus: memahami perjalanan request HTTP di backend production dari network boundary sampai controller/application handler, termasuk resource consumption, thread/event-loop model, proxy behavior, timeout, cancellation, dan failure mode.

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 000 kita membangun mental model besar: HTTP backend bukan sekadar `@GetMapping`, melainkan kontrak production yang harus benar secara semantics, aman, observable, dan bisa bertahan saat sistem berada di bawah tekanan.

Pada Part 001 kita membahas HTTP semantics dari sisi server: resource, representation, method properties, dan konsekuensi memilih method/status/header.

Part 002 masuk ke lapisan yang lebih operasional:

> Apa yang sebenarnya terjadi ketika sebuah request HTTP masuk ke backend Java sampai akhirnya mencapai controller?

Ini bukan sekadar detail internal. Pemahaman ini menentukan apakah kita bisa:

- mendiagnosis latency;
- mencegah thread starvation;
- memilih timeout yang masuk akal;
- memahami kenapa request bisa gagal sebelum menyentuh controller;
- membedakan error dari proxy, container, framework, atau application code;
- mendesain API yang aman terhadap slow client, oversized body, malformed request, dan overload;
- memahami perbedaan Spring MVC, Servlet async, WebFlux, Netty, Tomcat, gateway, dan reverse proxy.

Tujuan akhirnya: kamu tidak lagi melihat request sebagai “method controller dipanggil”, tetapi sebagai **unit konsumsi resource yang melewati pipeline berlapis**.

---

## 1. Core Mental Model

Request HTTP backend bisa dimodelkan sebagai pipeline:

```text
Client
  ↓
DNS / network route
  ↓
TCP or QUIC connection
  ↓
TLS termination
  ↓
HTTP parser
  ↓
Edge proxy / CDN / load balancer / API gateway
  ↓
Internal network
  ↓
Application server connector
  ↓
Container request object
  ↓
Filter / middleware chain
  ↓
Framework dispatcher
  ↓
Controller / handler
  ↓
Application service
  ↓
Domain / database / downstream calls
  ↓
Response serialization
  ↓
HTTP response framing
  ↓
Proxy / network / client
```

Dalam sistem nyata, request mungkin tidak melewati semua layer, tetapi pola dasarnya sama: **setiap layer dapat membaca, mengubah, menolak, membatasi, mencatat, meneruskan, atau menghentikan request**.

Backend engineer top-tier tidak hanya bertanya:

> “Controller mana yang menangani endpoint ini?”

Tetapi juga:

> “Layer mana yang pertama kali menerima request, siapa yang percaya pada header apa, timeout mana yang berlaku, thread/event-loop mana yang dipakai, body dibaca kapan, response dikirim kapan, dan apa yang terjadi jika client putus di tengah jalan?”

---

## 2. Request Bukan Objek Biasa, Melainkan Konsumsi Resource

Kesalahan umum adalah menganggap request sebagai objek murah:

```java
@PostMapping("/cases")
public CaseResponse create(@RequestBody CreateCaseRequest request) {
    return service.create(request);
}
```

Dari sudut controller, request terlihat seperti object Java biasa. Dari sudut production, request adalah konsumsi banyak resource:

| Resource | Dikonsumsi Oleh Request |
|---|---|
| connection slot | client membuka koneksi ke proxy/server |
| TLS state | handshake dan session state |
| socket buffer | data request/response |
| parser state | parsing request line/header/body |
| memory | header map, request object, body buffer, DTO |
| CPU | TLS, parsing, decompression, validation, serialization |
| thread atau event loop time | menjalankan pipeline request |
| queue capacity | backlog, worker queue, connection pool queue |
| database connection | jika request menyentuh DB |
| downstream HTTP connection | jika memanggil service lain |
| log/trace/metric budget | observability overhead |

Maka prinsip awalnya:

> Request adalah klaim terhadap resource backend. Backend harus memvalidasi, membatasi, dan melepas resource itu secepat dan setepat mungkin.

Konsekuensi desain:

1. Jangan membaca body besar tanpa limit.
2. Jangan menunggu downstream tanpa timeout.
3. Jangan membiarkan request mengantre tanpa batas.
4. Jangan melakukan blocking call di event loop.
5. Jangan memegang DB connection saat menunggu operasi lambat yang tidak perlu.
6. Jangan menganggap client pasti menunggu response sampai selesai.
7. Jangan menganggap controller selalu terpanggil.

---

## 3. Lifecycle Tingkat Tinggi

Secara praktis, request lifecycle dapat dibagi menjadi 12 fase:

```text
1. Client constructs request
2. DNS and connection establishment
3. TLS negotiation or termination
4. HTTP framing and parsing
5. Edge/proxy processing
6. Routing/load balancing
7. App server accepts connection
8. Container/framework builds request abstraction
9. Middleware/filter/security chain runs
10. Handler/controller executes
11. Response is serialized/framed
12. Response is flushed back to client
```

Setiap fase punya failure mode sendiri.

| Fase | Contoh Failure |
|---|---|
| DNS | wrong target, stale record |
| connection | refused, timeout, backlog full |
| TLS | certificate error, protocol mismatch |
| parsing | malformed request, invalid header |
| proxy | 413, 414, 429, 502, 503, 504 |
| routing | wrong upstream, path rewrite bug |
| app accept | thread pool exhausted, connection limit |
| framework | unsupported media type, binding failure |
| filter/security | unauthenticated, forbidden, CSRF rejected |
| controller | validation/business error |
| serialization | JSON error, stream broken |
| flush | client disconnected, write timeout |

Agar debugging efektif, kita harus mampu menjawab:

> Apakah request gagal sebelum masuk aplikasi, di container, di framework, di controller, saat downstream, atau saat response dikirim?

---

## 4. Dari Client ke Server: Connection Establishment

Sebelum HTTP semantics berlaku, client harus mencapai server secara network.

Untuk HTTP/1.1 dan HTTP/2 di deployment umum, transport biasanya TCP + TLS. Untuk HTTP/3, transport memakai QUIC di atas UDP. Namun banyak backend Java tidak langsung menerima HTTP/3; sering kali HTTP/3 berhenti di edge/CDN/proxy, lalu diteruskan ke backend sebagai HTTP/1.1 atau HTTP/2.

### 4.1 TCP Connection

Pada HTTP/1.1 dan HTTP/2, request biasanya berjalan di atas koneksi TCP.

Hal penting dari sisi backend:

1. Koneksi bukan gratis.
2. Server punya batas jumlah connection.
3. Ada backlog queue di OS/kernel.
4. Ada accept queue.
5. Ada idle timeout.
6. Ada keep-alive timeout.
7. Ada socket buffer.
8. Ada risiko slow client.

Simplified flow:

```text
Client
  → TCP SYN
Server kernel
  → TCP SYN-ACK
Client
  → ACK
Connection established
```

Setelah itu, TLS handshake bisa terjadi jika HTTPS.

### 4.2 TLS Handshake

TLS menyediakan confidentiality, integrity, dan server authentication. Dalam banyak arsitektur, TLS tidak selalu diterminasi di aplikasi Java. TLS bisa diterminasi di:

- CDN;
- load balancer;
- ingress controller;
- API gateway;
- reverse proxy seperti Nginx/Envoy/HAProxy;
- aplikasi Java langsung.

Pertanyaan penting:

> Di mana TLS berhenti, dan apakah traffic dari sana ke backend tetap terenkripsi?

Jika TLS berhenti di proxy dan diteruskan ke app sebagai HTTP plain internal, maka aplikasi Java tidak bisa langsung tahu scheme aslinya kecuali proxy mengirim informasi seperti `Forwarded` atau `X-Forwarded-Proto`.

Ini memengaruhi:

- absolute URL generation;
- redirect URL;
- secure cookie;
- HSTS;
- audit log;
- security decision;
- mixed-content behavior di client browser.

### 4.3 ALPN

ALPN, Application-Layer Protocol Negotiation, dipakai saat TLS handshake untuk menyepakati protocol seperti `http/1.1` atau `h2`.

Secara operasional:

- client dan server/proxy menyepakati HTTP version;
- backend mungkin tidak menerima versi yang sama dengan edge;
- trace/log harus bisa menunjukkan versi di setiap segment jika relevan.

---

## 5. HTTP Parsing: Sebelum Controller Ada

Setelah koneksi tersedia, server/proxy harus membaca bytes dan mengubahnya menjadi request HTTP.

Untuk HTTP/1.1, request secara konseptual terlihat seperti:

```http
POST /cases HTTP/1.1
Host: api.example.com
Content-Type: application/json
Content-Length: 64
Authorization: Bearer ...

{"subjectId":"S-100","allegation":"late filing"}
```

Untuk HTTP/2 dan HTTP/3, wire format bukan plain text seperti HTTP/1.1. Ada frame, stream, dan pseudo-header seperti `:method`, `:scheme`, `:authority`, `:path`. Namun semantics-nya tetap HTTP.

Hal yang terjadi saat parsing:

1. Validasi start line atau pseudo-header.
2. Validasi header syntax.
3. Penentuan body framing.
4. Penentuan content length.
5. Decoding transfer encoding jika berlaku.
6. Pengecekan limit header size.
7. Pengecekan request target/path length.
8. Pengecekan method.
9. Penanganan connection reuse.

Banyak request buruk ditolak di sini sebelum framework Java tahu apa-apa.

Contoh:

| Problem | Kemungkinan Response |
|---|---|
| header terlalu besar | 400 / 431 / proxy-specific error |
| URI terlalu panjang | 414 |
| body terlalu besar | 413 |
| method tidak dikenal/dilarang | 400 / 405 / 501 |
| malformed framing | 400 |
| invalid TLS | no HTTP response |

### 5.1 Request Smuggling Awareness

Request smuggling muncul ketika dua komponen dalam chain berbeda menafsirkan batas request, biasanya akibat ambiguity antara `Content-Length` dan `Transfer-Encoding`, atau perbedaan parser proxy vs origin server.

Mental model penting:

```text
Client sends ambiguous bytes
  ↓
Proxy interprets boundary one way
  ↓
Backend interprets boundary another way
  ↓
Attacker causes hidden request to be processed
```

Implikasi backend:

- jangan menerima framing ambigu;
- gunakan proxy/app server yang patched;
- samakan policy parsing di edge dan origin;
- batasi header/body;
- jangan expose origin langsung jika edge melakukan sanitization.

---

## 6. Edge / Reverse Proxy / Gateway Processing

Dalam production, aplikasi Java jarang menjadi penerima request pertama dari internet. Biasanya ada edge component.

Contoh:

```text
Internet Client
  ↓
CDN / WAF
  ↓
Load Balancer
  ↓
API Gateway / Ingress
  ↓
Service / Java App
```

Komponen ini bisa melakukan:

- TLS termination;
- path routing;
- host routing;
- authentication awal;
- rate limiting;
- WAF inspection;
- request size limiting;
- compression/decompression;
- header normalization;
- header injection;
- path rewrite;
- response buffering;
- retry ke upstream;
- health check;
- circuit breaking;
- observability;
- timeout enforcement.

### 6.1 Proxy Dapat Menghasilkan Response Tanpa Aplikasi

Tidak semua response berasal dari app Java.

| Status | Bisa Dihasilkan Oleh |
|---|---|
| 400 | proxy/parser/app |
| 401 | gateway/app |
| 403 | WAF/gateway/app |
| 404 | gateway routing/app |
| 413 | proxy/app |
| 414 | proxy/app |
| 429 | gateway/rate limiter/app |
| 502 | load balancer/proxy |
| 503 | proxy/app/orchestrator |
| 504 | proxy/load balancer |

Saat debugging, jangan langsung cari controller jika access log aplikasi tidak melihat request.

### 6.2 Header Rewriting

Proxy sering menambah header:

```http
Forwarded: for=203.0.113.10;proto=https;host=api.example.com
X-Forwarded-For: 203.0.113.10, 10.0.1.7
X-Forwarded-Proto: https
X-Request-ID: req-abc123
```

Tetapi header ini harus diperlakukan sebagai **trusted only after trust boundary**.

Jika aplikasi langsung exposed ke internet dan menerima `X-Forwarded-For` dari client, attacker bisa memalsukan IP.

Aturan aman:

1. Hanya percaya forwarded headers dari proxy yang trusted.
2. Proxy harus menghapus/overwrite header forwarded dari client eksternal.
3. Aplikasi harus dikonfigurasi tahu siapa proxy trusted.
4. Audit log harus membedakan remote socket address dan claimed client address.

### 6.3 Path Rewrite

Proxy bisa mengubah path:

```text
External: /api/v1/cases/123
Internal: /cases/123
```

Risiko:

- link generation salah;
- redirect salah;
- route matching beda;
- security rule mismatch;
- OpenAPI documentation tidak sesuai runtime;
- cache key di edge tidak sama dengan resource identity internal.

---

## 7. Load Balancing dan Routing ke Instance Backend

Load balancer memilih instance backend berdasarkan strategi tertentu:

- round-robin;
- least connections;
- random;
- weighted;
- consistent hashing;
- sticky session;
- locality-aware routing;
- health-aware routing.

Pertanyaan penting:

1. Apakah request bisa dikirim ulang ke instance lain jika upstream gagal?
2. Apakah retry gateway aman untuk method non-idempotent?
3. Apakah session state ada di memory instance?
4. Apakah WebSocket/SSE butuh sticky routing?
5. Apakah health check endpoint benar-benar mencerminkan readiness?
6. Apakah load balancer timeout lebih pendek dari aplikasi?

### 7.1 Health Check Bukan Readiness Sempurna

Endpoint seperti:

```http
GET /actuator/health
```

sering dianggap cukup. Namun server bisa sehat secara proses tetapi tidak siap memproses traffic:

- thread pool penuh;
- DB connection pool habis;
- downstream critical mati;
- GC pause berat;
- disk penuh;
- event loop blocked;
- config dependency gagal;
- queue internal penuh.

Health model perlu membedakan:

| Check | Makna |
|---|---|
| liveness | process masih hidup |
| readiness | siap menerima traffic |
| startup | initialization selesai |
| dependency health | dependency utama tersedia |
| saturation signal | resource belum penuh |

---

## 8. Application Server Accepts Connection

Saat request mencapai Java app, ada container/server yang menerima koneksi.

Contoh server Java:

- Tomcat;
- Jetty;
- Undertow;
- Netty/Reactor Netty;
- embedded server di Spring Boot;
- application server tradisional.

Pada Spring MVC default dengan embedded Tomcat, pipeline simplifikasi:

```text
Socket accepted by Tomcat connector
  ↓
HTTP parsed by Tomcat
  ↓
Servlet request/response objects created
  ↓
Filter chain
  ↓
DispatcherServlet
  ↓
HandlerMapping
  ↓
HandlerAdapter
  ↓
Controller method
```

Pada WebFlux dengan Reactor Netty:

```text
Socket accepted by Netty
  ↓
Event loop reads HTTP data
  ↓
Reactor Netty creates reactive request abstraction
  ↓
WebHandler chain
  ↓
Router/HandlerMapping
  ↓
Handler function/controller
  ↓
Reactive response publisher
```

Perbedaan besar: **thread-per-request** vs **event-loop/non-blocking pipeline**.

---

## 9. Thread-Per-Request Model: Servlet / Spring MVC

Dalam model Servlet synchronous klasik, request biasanya diproses oleh worker thread.

Simplified:

```text
Incoming request
  ↓
Connector accepts
  ↓
Worker thread assigned
  ↓
Filter chain executes
  ↓
Controller executes
  ↓
Blocking DB/HTTP calls may block same thread
  ↓
Response returned
  ↓
Thread released
```

Contoh controller:

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    private final CaseService caseService;

    CaseController(CaseService caseService) {
        this.caseService = caseService;
    }

    @GetMapping("/{id}")
    CaseResponse getCase(@PathVariable String id) {
        return caseService.getCase(id);
    }
}
```

Dari sisi kode, terlihat linear. Dari sisi runtime:

```text
Tomcat worker thread
  → auth filter
  → logging filter
  → DispatcherServlet
  → controller
  → service
  → repository
  → database call blocks
  → JSON serialization
  → socket write
```

### 9.1 Kelebihan Model Ini

1. Sederhana dipahami.
2. Cocok untuk banyak aplikasi CRUD/domain service.
3. Stack trace mudah dibaca.
4. Integrasi library blocking luas.
5. Debugging lebih familiar.

### 9.2 Risiko Model Ini

Risiko utamanya adalah **thread exhaustion**.

Misal:

- Tomcat max worker thread: 200.
- Setiap request memanggil downstream lambat selama 5 detik.
- Traffic spike: 1000 concurrent request.

Yang terjadi:

```text
200 request occupy all worker threads
800 request wait/queue/rejected
new health checks may fail
latency grows
client retries
retry storm worsens overload
```

Thread-per-request bukan buruk. Tetapi kamu harus sadar bahwa blocking wait mengonsumsi worker thread.

### 9.3 Thread Pool dan Queue

Parameter seperti `maxThreads`, accept count, connection limit, dan queue behavior menentukan apa yang terjadi saat load tinggi.

Mental model:

```text
Connection arrives
  ↓
Can OS accept it?
  ↓ no → connection refused/timeout
  ↓ yes
Can server accept it?
  ↓ no → queue/reject
  ↓ yes
Is worker thread available?
  ↓ no → wait/queue until timeout
  ↓ yes
Process request
```

Sistem yang tidak punya rejection strategy sering mati perlahan: latency naik, queue penuh, semua client retry, lalu collapse.

---

## 10. Event Loop Model: Netty / WebFlux

Dalam event loop model, sejumlah kecil thread menangani banyak connection secara non-blocking.

Simplified:

```text
Event loop reads socket readiness
  ↓
HTTP frame/data parsed
  ↓
Reactive pipeline invoked
  ↓
Non-blocking DB/HTTP call returns Publisher
  ↓
Event loop continues processing other connections
  ↓
Callback resumes when data ready
  ↓
Response chunks written non-blockingly
```

Contoh WebFlux:

```java
@RestController
@RequestMapping("/cases")
class ReactiveCaseController {

    private final ReactiveCaseService service;

    ReactiveCaseController(ReactiveCaseService service) {
        this.service = service;
    }

    @GetMapping("/{id}")
    Mono<CaseResponse> getCase(@PathVariable String id) {
        return service.getCase(id);
    }
}
```

### 10.1 Kelebihan Model Ini

1. Bisa menangani banyak concurrent connection dengan thread lebih sedikit.
2. Cocok untuk streaming, SSE, long-lived connection.
3. Cocok saat dependency juga non-blocking.
4. Backpressure lebih eksplisit.

### 10.2 Risiko Model Ini

Risiko utamanya adalah **blocking event loop**.

Kode seperti ini berbahaya di WebFlux:

```java
@GetMapping("/{id}")
Mono<CaseResponse> getCase(@PathVariable String id) {
    CaseResponse response = blockingJdbcRepository.findCase(id); // buruk jika jalan di event loop
    return Mono.just(response);
}
```

Jika event loop blocked:

- banyak connection lain ikut terganggu;
- latency melonjak;
- timeout cascade;
- throughput turun drastis;
- sulit didiagnosis jika tidak ada monitoring event-loop blocking.

Aturan:

> Reactive stack hanya benar-benar bernilai jika pipeline dominan non-blocking atau kamu mengelola blocking boundary secara eksplisit.

Contoh mitigasi untuk blocking call:

```java
@GetMapping("/{id}")
Mono<CaseResponse> getCase(@PathVariable String id) {
    return Mono.fromCallable(() -> blockingRepository.findCase(id))
        .subscribeOn(Schedulers.boundedElastic());
}
```

Namun ini bukan magic. Blocking tetap memakai thread pool lain. Jika semua call blocking, Spring MVC mungkin lebih sederhana dan lebih jujur.

---

## 11. Servlet Async: Tengah-Tengah Antara MVC dan Reactive

Servlet API mendukung async processing. Tujuannya: melepas container thread saat menunggu pekerjaan async.

Contoh konsep:

```java
@GetMapping("/reports/{id}")
Callable<ReportResponse> getReport(@PathVariable String id) {
    return () -> reportService.generateOrFetch(id);
}
```

Atau:

```java
@GetMapping("/cases/{id}")
DeferredResult<CaseResponse> getCase(@PathVariable String id) {
    DeferredResult<CaseResponse> result = new DeferredResult<>(5000L);

    asyncService.fetchCase(id)
        .whenComplete((value, error) -> {
            if (error != null) {
                result.setErrorResult(error);
            } else {
                result.setResult(value);
            }
        });

    return result;
}
```

Async Servlet membantu jika:

- request menunggu operasi asynchronous;
- thread container tidak perlu dipegang selama wait;
- ada long polling;
- ada callback/event completion.

Tapi kompleksitas meningkat:

- timeout harus dikelola;
- error propagation harus jelas;
- context/logging/security context harus dipropagasi;
- cancellation harus dipikirkan.

---

## 12. Container Request Object: Abstraction yang Sudah Diproses

Saat controller menerima object seperti `HttpServletRequest`, object itu bukan bytes mentah dari network. Ia adalah hasil parsing dan normalisasi oleh container.

Contoh:

```java
@GetMapping("/debug")
Map<String, Object> debug(HttpServletRequest request) {
    return Map.of(
        "method", request.getMethod(),
        "requestUri", request.getRequestURI(),
        "query", request.getQueryString(),
        "remoteAddr", request.getRemoteAddr(),
        "contentType", request.getContentType()
    );
}
```

Hal yang sudah terjadi sebelum ini:

- connection diterima;
- HTTP message diparse;
- header dimapping;
- request target dipisah;
- body stream disiapkan;
- encoding mungkin ditentukan;
- beberapa invalid request sudah ditolak.

### 12.1 Body Biasanya Stream, Bukan Object Siap Pakai

Pada Servlet, body dibaca dari `InputStream` atau `Reader`. Spring lalu memakai message converter untuk deserialize body menjadi DTO.

```java
@PostMapping("/cases")
CaseResponse create(@RequestBody CreateCaseRequest request) {
    return service.create(request);
}
```

Di balik layar:

```text
HTTP body bytes
  ↓
ServletInputStream
  ↓
Spring HttpMessageConverter
  ↓
Jackson JSON parser
  ↓
CreateCaseRequest object
  ↓
Bean Validation if configured
  ↓
Controller argument
```

Jika JSON invalid, controller method tidak dipanggil.

Jika `Content-Type` tidak didukung, controller method mungkin tidak dipanggil.

Jika body terlalu besar dan limit diterapkan di proxy/container, controller method tidak dipanggil.

---

## 13. Filter Chain: Middleware Sebelum Controller

Servlet filter adalah layer sebelum `DispatcherServlet` atau controller.

Contoh filter:

- request logging;
- correlation ID;
- authentication;
- authorization awal;
- CORS;
- CSRF;
- compression;
- rate limiting;
- body wrapping;
- audit context;
- tenant resolution.

Simplified:

```text
Request
  ↓
Filter A: correlation id
  ↓
Filter B: security
  ↓
Filter C: tenant context
  ↓
DispatcherServlet
  ↓
Controller
```

Contoh filter sederhana:

```java
@Component
class CorrelationIdFilter extends OncePerRequestFilter {

    private static final String HEADER = "X-Request-ID";

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        String requestId = request.getHeader(HEADER);
        if (requestId == null || requestId.isBlank()) {
            requestId = UUID.randomUUID().toString();
        }

        MDC.put("requestId", requestId);
        response.setHeader(HEADER, requestId);

        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove("requestId");
        }
    }
}
```

### 13.1 Filter Bisa Menghentikan Request

Filter tidak wajib meneruskan request.

```java
if (!authenticated) {
    response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
    return;
}

filterChain.doFilter(request, response);
```

Maka controller tidak terpanggil.

### 13.2 Filter Ordering Penting

Urutan salah bisa menyebabkan bug serius.

Contoh:

```text
Wrong order:
  request logging reads body
  ↓
controller tries to read body
  ↓
body already consumed
```

Atau:

```text
Wrong order:
  tenant context resolved after authorization
  ↓
authorization cannot enforce tenant boundary correctly
```

Prinsip umum:

1. Correlation/tracing early.
2. Forwarded header normalization early but only trusted.
3. Security before business handler.
4. Body-consuming filters harus sangat hati-hati.
5. Cleanup context in `finally`.

---

## 14. Spring MVC Dispatcher Lifecycle

Spring MVC memakai `DispatcherServlet` sebagai front controller.

Simplified flow:

```text
DispatcherServlet
  ↓
HandlerMapping finds matching controller method
  ↓
HandlerInterceptor preHandle
  ↓
HandlerAdapter invokes controller
  ↓
Argument resolvers bind parameters
  ↓
Message converters parse body
  ↓
Validation
  ↓
Controller method executes
  ↓
Return value handlers process response
  ↓
Message converters serialize body
  ↓
HandlerInterceptor postHandle/afterCompletion
```

### 14.1 HandlerMapping

Spring mencari method yang cocok:

```java
@GetMapping("/cases/{caseId}")
CaseResponse get(@PathVariable String caseId) { ... }
```

Faktor matching:

- HTTP method;
- path pattern;
- consumes;
- produces;
- params;
- headers.

Contoh:

```java
@PostMapping(
    path = "/cases",
    consumes = "application/json",
    produces = "application/json"
)
CaseResponse create(@RequestBody CreateCaseRequest request) {
    return service.create(request);
}
```

Jika `Content-Type` tidak cocok, request bisa gagal dengan 415.
Jika `Accept` tidak bisa dipenuhi, request bisa gagal dengan 406.

### 14.2 Argument Resolver

Spring mengisi parameter controller dari berbagai sumber:

```java
@GetMapping("/cases/{id}")
CaseResponse get(
    @PathVariable String id,
    @RequestParam Optional<String> view,
    @RequestHeader("X-Tenant-ID") String tenantId,
    Principal principal
) { ... }
```

Sumber data:

- path variable;
- query parameter;
- header;
- cookie;
- request body;
- principal/security context;
- session;
- model attribute.

Binding error bisa terjadi sebelum method dipanggil.

### 14.3 Message Converter

Untuk JSON, Spring biasanya memakai Jackson.

Body:

```json
{
  "subjectId": "S-100",
  "priority": "HIGH"
}
```

DTO:

```java
record CreateCaseRequest(
    String subjectId,
    Priority priority
) {}
```

Converter melakukan:

- read bytes;
- parse JSON;
- map field;
- convert enum/date/number;
- create object.

Failure:

- malformed JSON;
- invalid enum;
- invalid date;
- missing required constructor property;
- numeric overflow;
- unknown field jika configured strict;
- content type mismatch.

### 14.4 Return Value Handler

Controller return value diproses:

```java
@GetMapping("/{id}")
ResponseEntity<CaseResponse> get(@PathVariable String id) {
    return ResponseEntity.ok()
        .header("ETag", "\"v7\"")
        .body(service.get(id));
}
```

Spring menentukan:

- status code;
- headers;
- body serialization;
- content negotiation;
- response commit.

---

## 15. Spring WebFlux Request Lifecycle

WebFlux punya dua programming model:

1. annotated controller seperti Spring MVC;
2. functional endpoint dengan `RouterFunction` dan `HandlerFunction`.

Annotated:

```java
@RestController
class CaseHandler {

    @GetMapping("/cases/{id}")
    Mono<CaseResponse> get(@PathVariable String id) {
        return service.get(id);
    }
}
```

Functional:

```java
@Bean
RouterFunction<ServerResponse> routes(CaseService service) {
    return route(GET("/cases/{id}"), request ->
        service.get(request.pathVariable("id"))
            .flatMap(caseResponse -> ServerResponse.ok().bodyValue(caseResponse))
    );
}
```

Flow simplifikasi:

```text
Reactor Netty receives bytes
  ↓
HttpHandler
  ↓
WebFilter chain
  ↓
HandlerMapping
  ↓
HandlerAdapter
  ↓
Controller/handler returns Mono/Flux
  ↓
Publisher subscribed
  ↓
Response written when data arrives
```

### 15.1 Lazy Execution

Dalam reactive programming, return `Mono` atau `Flux` bukan berarti operasi langsung selesai. Pipeline dieksekusi saat subscribed oleh framework.

```java
Mono<CaseResponse> response = service.get(id); // describes work
return response;                              // framework subscribes
```

Implikasi:

- error terjadi asynchronous;
- logging harus ditempatkan dengan operator yang tepat;
- context propagation berbeda dari ThreadLocal biasa;
- cancellation bisa terjadi sebelum pipeline selesai.

### 15.2 Backpressure

Reactive Streams menyediakan mekanisme demand. Dalam HTTP streaming, ini membantu menghindari producer membanjiri consumer.

Namun backpressure tidak otomatis menyelesaikan semua masalah:

- database driver harus mendukung non-blocking/backpressure;
- downstream HTTP client harus non-blocking;
- codec buffer harus dikelola;
- proxy bisa buffering dan merusak streaming behavior;
- client lambat tetap bisa menahan resource.

---

## 16. Request Body Lifecycle

Body adalah bagian yang sering memicu bug dan vulnerability.

### 16.1 Body Tidak Selalu Ada

Tidak semua method punya body meaningful. GET request body misalnya tidak umum dan sering diabaikan/ditolak oleh intermediary.

Backend jangan mendesain API yang bergantung pada GET body.

### 16.2 Body Bisa Dibaca Sekali

Dalam banyak framework, request body adalah stream yang hanya bisa dibaca sekali.

Anti-pattern:

```java
filter reads body for logging
controller reads body for JSON parsing
```

Tanpa wrapping/caching khusus, controller bisa menerima empty body.

### 16.3 Body Size Limit

Limit bisa diterapkan di beberapa layer:

```text
CDN limit
  ↓
Load balancer limit
  ↓
API gateway limit
  ↓
Nginx/Envoy limit
  ↓
Tomcat/Netty limit
  ↓
Spring multipart limit
  ↓
Application validation
```

Jika limit tidak konsisten, behavior membingungkan.

Contoh:

- gateway mengizinkan 20 MB;
- app hanya mengizinkan 10 MB;
- client kadang menerima 413 dari app;
- kadang menerima 413 dari gateway;
- error response shape tidak konsisten.

Prinsip:

1. Tentukan limit per endpoint/use case.
2. Terapkan limit sedekat mungkin ke edge.
3. Pastikan app juga punya defense-in-depth.
4. Dokumentasikan limit.
5. Pastikan error response konsisten sejauh memungkinkan.

### 16.4 Body Decompression

Jika request dikompresi, server bisa menerima body kecil secara compressed tetapi besar setelah decompression.

Risiko:

```text
Compressed request: 1 MB
Decompressed payload: 500 MB
```

Mitigasi:

- limit compressed size;
- limit decompressed size;
- timeout read;
- reject unsupported encodings;
- monitor decompression ratio.

---

## 17. Response Lifecycle

Response tidak “muncul” sekaligus. Ia dibangun dan dikirim melalui tahap:

```text
Controller returns value
  ↓
Framework determines status/header/body
  ↓
Serializer converts object to bytes
  ↓
Server frames HTTP response
  ↓
Bytes written to socket/proxy
  ↓
Client receives progressively or after buffering
```

### 17.1 Response Commit

Response dianggap committed ketika status/header sudah dikirim. Setelah committed, kamu tidak bisa bebas mengubah status/header.

Masalah umum:

```text
Start streaming response with 200 OK
  ↓
error occurs halfway
  ↓
cannot change status to 500
  ↓
client receives partial response or broken stream
```

Untuk streaming/export besar, desain error handling harus berbeda.

### 17.2 Serialization Failure

Controller berhasil, tapi response gagal saat serialization.

Contoh:

- circular reference object;
- lazy JPA relation diakses setelah session tertutup;
- invalid custom serializer;
- unsupported type;
- object terlalu besar;
- client disconnect saat write.

Jadi “business logic sukses” tidak sama dengan “HTTP response sukses terkirim”.

### 17.3 Client Disconnect

Client bisa disconnect:

- user menutup browser/tab;
- mobile network berubah;
- client timeout;
- proxy timeout;
- retry policy memulai request baru;
- browser membatalkan fetch.

Backend harus mempertimbangkan:

- apakah operasi harus dibatalkan?
- apakah transaksi DB sudah commit?
- apakah downstream call harus dihentikan?
- apakah log status harus dianggap error?
- apakah idempotency diperlukan untuk retry berikutnya?

---

## 18. Timeout Model End-to-End

Timeout bukan satu angka. Ada banyak timeout di banyak layer.

```text
Client timeout
  ↓
CDN timeout
  ↓
Load balancer idle timeout
  ↓
API gateway upstream timeout
  ↓
Service mesh timeout
  ↓
App server request timeout
  ↓
HTTP client downstream timeout
  ↓
DB query timeout
```

Jika timeout tidak harmonis, failure menjadi aneh.

### 18.1 Contoh Timeout Mismatch

Misal:

```text
Client timeout: 30s
Gateway timeout: 60s
App downstream timeout: none
DB query timeout: none
```

Yang terjadi:

1. Client menunggu 30 detik lalu menyerah.
2. Gateway/app tetap menjalankan request.
3. DB query tetap berjalan.
4. Client retry.
5. Backend mengerjakan request duplikat.
6. Load meningkat.

Lebih baik:

```text
Client deadline: 30s
Gateway timeout: 28s
App request deadline: 25s
Downstream HTTP timeout: 5s-10s depending dependency
DB query timeout: bounded
```

Bukan angka persisnya yang penting, melainkan prinsip:

> Inner operations harus punya budget yang lebih kecil dari outer deadline.

### 18.2 Deadline Propagation

Daripada tiap layer memilih timeout acak, sistem bisa membawa deadline.

Contoh header internal:

```http
X-Request-Deadline: 2026-06-18T10:15:30Z
```

Atau context internal yang dihitung dari ingress.

Application service lalu bertanya:

> “Berapa waktu tersisa untuk request ini?”

Jika waktu tersisa terlalu kecil, lebih baik fail fast daripada memulai operasi mahal yang kemungkinan tidak akan selesai.

---

## 19. Cancellation

Cancellation berarti pekerjaan dihentikan karena hasilnya tidak lagi dibutuhkan atau deadline habis.

Sumber cancellation:

- client disconnect;
- client timeout;
- gateway timeout;
- app deadline exceeded;
- user explicitly cancels operation;
- parent request cancelled;
- shutdown/draining.

### 19.1 Servlet Cancellation

Di model blocking klasik, cancellation tidak selalu otomatis menghentikan pekerjaan. Thread mungkin tetap menunggu DB/downstream meskipun client sudah pergi.

Kamu perlu:

- timeout di DB query;
- timeout di HTTP client;
- interruption-aware code jika applicable;
- async request listener;
- transaction boundary yang jelas.

### 19.2 Reactive Cancellation

Di reactive pipeline, cancellation adalah sinyal penting. Jika client disconnect, subscription bisa dibatalkan.

Namun cancellation efektif hanya jika operator dan dependency menghormatinya.

Contoh:

- non-blocking HTTP client bisa cancel request upstream;
- reactive DB driver bisa cancel query jika supported;
- blocking call di boundedElastic mungkin tidak langsung berhenti.

---

## 20. Queues: The Hidden Latency Multiplier

Setiap layer bisa punya queue:

```text
kernel accept queue
load balancer queue
proxy upstream queue
app connector queue
worker thread queue
executor queue
DB connection pool wait queue
HTTP client connection pool wait queue
message queue
```

Queue membuat sistem terlihat “masih menerima traffic”, padahal sebenarnya hanya menunda kegagalan.

### 20.1 Queueing Collapse

Misal:

- normal latency: 100 ms;
- dependency lambat: 5 s;
- request tetap diterima dan mengantre;
- client timeout 2 s;
- client retry;
- queue makin panjang;
- request lama tetap diproses meski client sudah pergi;
- sistem collapse.

Prinsip:

> Dalam overload, bounded queue + fast rejection sering lebih baik daripada unbounded waiting.

Response yang jujur seperti `503 Service Unavailable` atau `429 Too Many Requests` bisa lebih sehat daripada membuat semua request timeout.

---

## 21. Request Lifecycle di Microservices

Dalam microservices, satu inbound HTTP request bisa memicu beberapa outbound request.

```text
Client
  ↓
Case API
  ├─ Identity Service
  ├─ Case DB
  ├─ Document Service
  ├─ Notification Service
  └─ Audit Service
```

Latency total bukan hanya satu controller. Ia adalah graph.

### 21.1 Fan-Out Risk

Jika satu request memanggil 5 service, dan masing-masing punya failure probability 1%, request-level failure lebih tinggi.

Jika semua downstream dipanggil serial:

```text
A 100ms + B 150ms + C 200ms + D 100ms = 550ms plus overhead
```

Jika parallel:

```text
max(A,B,C,D) plus coordination overhead
```

Tetapi parallel fan-out meningkatkan concurrency pressure.

### 21.2 Cascading Failure

Cascading failure terjadi ketika satu dependency lambat menyebabkan service pemanggil ikut kehabisan resource, lalu memengaruhi service lain.

Mitigasi:

- timeout;
- retry budget;
- circuit breaker;
- bulkhead;
- fallback jika aman;
- cache jika valid;
- load shedding;
- async decoupling untuk operasi non-critical;
- idempotency untuk retry;
- observability per dependency.

---

## 22. Mapping Lifecycle ke Spring Boot Production

### 22.1 Spring MVC Embedded Tomcat Typical Path

```text
Client
  ↓
Nginx/Ingress
  ↓
Tomcat connector
  ↓
Coyote HTTP parser
  ↓
Servlet request/response
  ↓
Filter chain
  ├─ ForwardedHeaderFilter
  ├─ CorrelationIdFilter
  ├─ Spring Security filters
  └─ Observability filters
  ↓
DispatcherServlet
  ↓
HandlerMapping
  ↓
HandlerInterceptor
  ↓
HandlerAdapter
  ↓
Argument resolution
  ↓
Message conversion / validation
  ↓
Controller
  ↓
Service
  ↓
Repository/downstream client
  ↓
Return value handling
  ↓
JSON serialization
  ↓
Tomcat writes response
  ↓
Proxy returns response
```

### 22.2 Spring WebFlux Reactor Netty Typical Path

```text
Client
  ↓
Gateway/Ingress
  ↓
Reactor Netty HTTP server
  ↓
Event loop
  ↓
HttpHandler
  ↓
WebFilter chain
  ↓
HandlerMapping
  ↓
Reactive controller/handler
  ↓
Mono/Flux pipeline
  ↓
Non-blocking downstream client or driver
  ↓
Codec serialization
  ↓
Netty writes response
```

---

## 23. Common Backend Misdiagnoses

### Misdiagnosis 1: “Controller lambat”

Mungkin benar, tapi bisa juga:

- request antre sebelum controller;
- body upload lambat;
- proxy buffering;
- auth filter lambat;
- DB pool wait;
- downstream timeout;
- response serialization besar;
- client slow reading.

### Misdiagnosis 2: “Aplikasi return 504”

Sering kali 504 berasal dari gateway/load balancer, bukan aplikasi.

Aplikasi mungkin masih memproses request setelah gateway timeout.

### Misdiagnosis 3: “GET aman karena hanya membaca”

GET bisa tetap menghabiskan resource besar jika query mahal. Safe secara semantics bukan berarti murah.

### Misdiagnosis 4: “Reactive pasti lebih cepat”

Reactive bisa lebih scalable untuk I/O non-blocking dan streaming. Tapi untuk blocking DB/JPA heavy application, reactive bisa menambah kompleksitas tanpa manfaat besar.

### Misdiagnosis 5: “Timeout di client cukup”

Tidak cukup. Server dan downstream tetap bisa memproses setelah client menyerah.

---

## 24. Failure Mode Matrix

| Failure | Layer | Symptom | Mitigation |
|---|---|---|---|
| malformed HTTP | parser/proxy/container | 400 before controller | strict parser, logging at edge |
| header too large | proxy/container | 431/400 | header limit, token size control |
| URI too long | proxy/container | 414 | avoid huge query, use POST for complex query if needed |
| body too large | proxy/container/app | 413 | explicit per-endpoint limit |
| slow upload | connection/container | worker held, timeout | read timeout, body timeout, streaming limits |
| auth failure | gateway/filter/app | 401/403 | consistent auth layer |
| body parse error | framework/converter | 400 before controller | robust error mapping |
| validation error | framework/app | 400/422 | structured validation response |
| DB pool exhaustion | app/dependency | latency spike, 500/503 | pool sizing, timeout, bulkhead |
| downstream slowness | app/client | timeout, thread starvation | timeout, circuit breaker |
| response serialization error | framework | 500 after controller | DTO discipline, tests |
| client disconnect | network/write | broken pipe/cancel | cancellation handling, idempotency |
| gateway timeout | proxy | 504 | align timeout budgets |
| event loop blocked | reactive runtime | global latency spike | block detection, isolate blocking |
| thread pool exhausted | servlet runtime | queue/timeout | bounded concurrency, load shedding |

---

## 25. Observability: Apa yang Harus Direkam di Setiap Request

Minimal production-grade HTTP backend perlu melihat:

1. request method;
2. route template, bukan raw high-cardinality path;
3. status code;
4. latency total;
5. request size;
6. response size;
7. authenticated principal atau service identity jika aman;
8. tenant jika relevan;
9. correlation/request ID;
10. trace ID/span ID;
11. user agent jika relevan;
12. client IP after trusted proxy resolution;
13. error class;
14. timeout/cancellation marker;
15. downstream dependency latency.

Contoh structured access log concept:

```json
{
  "timestamp": "2026-06-18T10:15:00Z",
  "requestId": "req-123",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "method": "POST",
  "route": "/cases/{caseId}/evidence",
  "status": 201,
  "durationMs": 142,
  "requestBytes": 20918,
  "responseBytes": 812,
  "tenantId": "tenant-a",
  "clientIp": "203.0.113.10",
  "error": null
}
```

Hindari:

- log raw body sensitif;
- log token Authorization;
- high-cardinality path sebagai metric label;
- menyimpan PII tanpa policy;
- mencampur 4xx validation noise dengan 5xx server failure.

---

## 26. Debugging Request Lifecycle Secara Sistematis

Saat ada masalah HTTP backend, gunakan pendekatan layer-by-layer.

### 26.1 Pertanyaan Diagnosis

1. Apakah request mencapai edge?
2. Apakah request mencapai gateway?
3. Apakah request mencapai app instance?
4. Apakah filter/security melewatkan request?
5. Apakah controller terpanggil?
6. Apakah body berhasil diparse?
7. Apakah validation lolos?
8. Apakah service/domain berhasil?
9. Apakah downstream lambat/gagal?
10. Apakah response berhasil diserialize?
11. Apakah response berhasil dikirim ke proxy?
12. Apakah proxy berhasil mengirim ke client?

### 26.2 Evidence yang Dicari

| Evidence | Menjawab |
|---|---|
| CDN/WAF log | request masuk internet edge? |
| load balancer log | routing ke upstream? |
| gateway access log | status gateway vs app? |
| app access log | app melihat request? |
| application log | controller/service jalan? |
| trace | waktu habis di span mana? |
| metrics | pool/thread saturated? |
| GC log | runtime pause? |
| DB metrics | query/pool wait? |
| client log | timeout/cancel/retry? |

### 26.3 Curl untuk Reproduksi Dasar

```bash
curl -v \
  -X POST "https://api.example.com/cases" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "X-Request-ID: debug-001" \
  -d '{"subjectId":"S-100","allegation":"late filing"}'
```

Perhatikan:

- status code;
- response headers;
- TLS/protocol info;
- redirects;
- transfer behavior;
- body error shape;
- request ID echoed atau tidak.

---

## 27. Design Implications untuk Java Backend Engineer

### 27.1 Controller Harus Tipis Tetapi Bukan Bodoh

Controller bukan tempat domain logic berat, tetapi tetap bertanggung jawab pada HTTP boundary:

- method/status/header mapping;
- request DTO;
- validation entrypoint;
- auth principal extraction;
- idempotency key extraction;
- conditional header extraction;
- response metadata;
- error mapping via centralized handler.

### 27.2 Application Service Tidak Boleh Tergantung Detail HTTP Berlebihan

Buruk:

```java
caseService.create(HttpServletRequest request);
```

Lebih baik:

```java
caseService.create(command, executionContext);
```

Di mana `executionContext` berisi hal yang memang diperlukan:

- actor identity;
- tenant;
- request id;
- deadline;
- idempotency key;
- audit metadata.

### 27.3 HTTP Boundary Harus Eksplisit

Buat mapping jelas:

```text
HTTP request
  → request DTO
  → validation
  → command/query object
  → application service
  → domain result
  → response DTO
  → HTTP response
```

Jangan membiarkan entity persistence bocor langsung ke representation.

---

## 28. Mini Case Study: Create Enforcement Case

Endpoint:

```http
POST /cases
Content-Type: application/json
Accept: application/json
Idempotency-Key: 8d3f2...
Authorization: Bearer ...
```

Body:

```json
{
  "subjectId": "S-100",
  "allegationType": "LATE_FILING",
  "description": "Quarterly report not submitted before deadline"
}
```

Lifecycle:

```text
1. Client opens HTTPS connection to api.example.com
2. CDN/WAF checks method, path, body size, threat rules
3. Load balancer routes to API gateway
4. Gateway verifies token presence and rate limit
5. Gateway forwards request to case-service
6. Tomcat accepts connection
7. Spring Security validates JWT and builds principal
8. Correlation filter sets request ID
9. DispatcherServlet matches POST /cases
10. Jackson parses JSON into CreateCaseRequest
11. Bean Validation checks required fields
12. Controller extracts Idempotency-Key
13. Application service checks deduplication store
14. Domain creates case aggregate
15. Database transaction commits
16. Audit event written/outboxed
17. Response DTO serialized
18. Server returns 201 Created with Location header
19. Gateway forwards response
20. Client receives response
```

Response:

```http
HTTP/1.1 201 Created
Content-Type: application/json
Location: /cases/C-2026-00001
X-Request-ID: req-123

{
  "caseId": "C-2026-00001",
  "status": "OPEN",
  "createdAt": "2026-06-18T10:15:00Z"
}
```

Failure scenarios:

| Step | Failure | Desired Behavior |
|---|---|---|
| WAF | malicious payload | 403/400 before app |
| gateway | rate exceeded | 429 with Retry-After |
| security | invalid token | 401 |
| parser | invalid JSON | 400 structured error |
| validation | missing subjectId | 400/422 field error |
| idempotency | duplicate key same payload | replay previous response |
| idempotency | duplicate key different payload | 409 |
| DB | unique conflict | 409 or domain-specific error |
| audit | audit outbox failure before commit | transaction rollback or fail-safe policy |
| response | client disconnect after commit | operation remains committed; retry uses idempotency |

---

## 29. Checklist: Request Lifecycle Readiness

Gunakan checklist ini untuk menilai backend HTTP service.

### 29.1 Edge and Proxy

- [ ] TLS termination jelas.
- [ ] Forwarded headers trusted hanya dari proxy yang benar.
- [ ] Client IP resolution aman.
- [ ] Path rewrite terdokumentasi.
- [ ] Request size limit diterapkan di edge.
- [ ] Timeout proxy selaras dengan app.
- [ ] Gateway-generated errors dapat dibedakan dari app errors.

### 29.2 Application Server

- [ ] Connection limit jelas.
- [ ] Worker thread/event-loop model dipahami.
- [ ] Queue bounded.
- [ ] Request/header/body limits configured.
- [ ] Keep-alive/idle timeout reasonable.
- [ ] Graceful shutdown/draining tersedia.

### 29.3 Framework Boundary

- [ ] Filter order benar.
- [ ] Security before business handler.
- [ ] Correlation ID generated early.
- [ ] Body logging tidak merusak stream.
- [ ] Message conversion errors dipetakan konsisten.
- [ ] Validation errors structured.
- [ ] Exception handling centralized.

### 29.4 Application Code

- [ ] Controller tidak menampung domain logic berat.
- [ ] DTO tidak langsung entity.
- [ ] Deadline/timeout dipropagasi.
- [ ] Downstream client punya timeout.
- [ ] DB query punya timeout jika perlu.
- [ ] Idempotency dipakai untuk operasi non-idempotent yang bisa diretry.
- [ ] Client disconnect dipertimbangkan.

### 29.5 Observability

- [ ] Access log tersedia.
- [ ] Trace ID dan request ID konsisten.
- [ ] Metrics status/latency/throughput tersedia.
- [ ] Route template digunakan, bukan raw path high-cardinality.
- [ ] Downstream latency terlihat.
- [ ] Timeout dan cancellation terlihat.
- [ ] Sensitive data tidak bocor di log.

---

## 30. Latihan Praktis

### Latihan 1 — Gambar Pipeline Service Kamu

Ambil satu endpoint production atau project pribadi:

```http
POST /orders
```

Gambarkan pipeline:

```text
Client → CDN → LB → Gateway → Service → Controller → DB → Response
```

Untuk setiap layer, jawab:

1. Timeout-nya berapa?
2. Body limit-nya berapa?
3. Siapa yang bisa menghasilkan 4xx?
4. Siapa yang bisa menghasilkan 5xx?
5. Header apa yang ditambah/diubah?
6. Log apa yang tersedia?
7. Request ID dibuat di mana?
8. Auth dicek di mana?
9. Retry bisa terjadi di mana?
10. Jika client disconnect, apa yang terjadi?

### Latihan 2 — Cari Request yang Tidak Mencapai Controller

Simulasikan kasus:

1. invalid JSON;
2. wrong Content-Type;
3. body terlalu besar;
4. Authorization missing;
5. path tidak cocok;
6. method salah.

Untuk setiap kasus, catat:

- status code;
- response body;
- apakah controller terpanggil;
- log mana yang muncul;
- apakah error shape konsisten.

### Latihan 3 — Timeout Budget

Untuk endpoint:

```http
POST /cases/{id}/decision
```

Misal target client-visible latency maksimal 5 detik. Buat budget:

```text
Gateway timeout: ?
App request deadline: ?
DB query timeout: ?
Downstream document service timeout: ?
Audit write timeout: ?
Notification behavior: sync or async?
```

Pertimbangkan apakah notification harus synchronous atau outbox async.

### Latihan 4 — Thread Starvation Scenario

Misal service Spring MVC punya:

```text
max worker threads: 200
DB pool size: 30
p95 DB query normal: 50ms
p95 DB query incident: 4s
incoming concurrent requests: 500
client timeout: 2s
```

Analisis:

1. Apa yang terjadi pada worker thread?
2. Apa yang terjadi pada DB pool wait?
3. Apakah client retry memperburuk?
4. Status apa yang lebih sehat: timeout lambat atau fast 503?
5. Mitigasi apa yang perlu?

### Latihan 5 — Reactive Blocking Boundary

Jika kamu punya WebFlux controller tetapi masih memakai JPA blocking repository:

1. Di thread mana repository call berjalan?
2. Apakah event loop blocked?
3. Apakah `boundedElastic` cukup?
4. Apa risiko pool saturation?
5. Apakah Spring MVC lebih tepat?

---

## 31. Key Takeaways

1. Request lifecycle dimulai jauh sebelum controller dan berakhir setelah response benar-benar terkirim.
2. Banyak error HTTP production berasal dari proxy/container/framework, bukan business logic.
3. Request adalah konsumsi resource: connection, memory, CPU, thread/event-loop, pool, queue, dan downstream capacity.
4. Spring MVC memakai model yang biasanya thread-per-request; mudah dipahami tetapi rentan thread starvation jika blocking wait tidak dibatasi.
5. WebFlux/Reactor Netty memakai event loop/non-blocking model; powerful untuk concurrency dan streaming, tetapi berbahaya jika blocking call masuk event loop.
6. Body parsing, validation, security, dan message conversion bisa gagal sebelum controller dipanggil.
7. Proxy/gateway bisa mengubah path, header, status, timeout, dan response behavior.
8. Timeout harus dipikirkan sebagai budget end-to-end, bukan angka acak per layer.
9. Queue tersembunyi sering memperburuk incident karena menunda kegagalan sampai sistem collapse.
10. Observability harus menunjukkan request melalui layer, bukan hanya log controller.

---

## 32. Referensi

- RFC 9110 — HTTP Semantics.
- RFC 9111 — HTTP Caching.
- RFC 9112 — HTTP/1.1.
- RFC 9113 — HTTP/2.
- RFC 9114 — HTTP/3.
- Spring Framework Reference — Spring Web MVC.
- Spring Framework Reference — Spring WebFlux.
- Apache Tomcat Documentation — HTTP Connector.
- Netty Documentation — EventLoop and Channel Pipeline concepts.
- OWASP Cheat Sheet Series — REST Security Cheat Sheet.
- OWASP API Security Top 10.
- OpenTelemetry Semantic Conventions — HTTP spans and attributes.

---

## 33. Penutup Part 002

Part ini membangun mental model request lifecycle dari network sampai controller dan response. Ini fondasi untuk part berikutnya karena method semantics, status code, header, body, security, timeout, dan observability semuanya bergantung pada pemahaman pipeline ini.

Pada part berikutnya kita masuk ke:

**Part 003 — Methods Deep Dive for Backend Correctness**

Kita akan membahas method HTTP bukan sebagai pilihan routing, tetapi sebagai kontrak correctness: safe, idempotent, retryable, cacheable, dan bagaimana memilih method untuk command/query/workflow backend yang kompleks.

Status seri: **Part 002 dari 032 — belum selesai.**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-001.md">⬅️ Part 001 — HTTP Semantics from Server Point of View</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-003.md">Part 003 — Methods Deep Dive for Backend Correctness ➡️</a>
</div>

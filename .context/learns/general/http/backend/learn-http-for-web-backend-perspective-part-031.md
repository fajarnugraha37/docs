# learn-http-for-web-backend-perspective-part-031.md

# HTTP for Web/Backend Perspective — Part 031
# Backend-to-Backend HTTP Clients

> Seri: `learn-http-for-web-backend-perspective`  
> Part: `031 / 032`  
> Fokus: membangun HTTP client backend yang benar, resilient, observable, aman, dan cocok untuk sistem Java production.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas sisi server: semantics, status code, headers, body, validation, idempotency, concurrency, caching, auth, authorization, rate limiting, timeout, streaming, proxy/gateway, observability, security, Spring MVC, dan WebFlux.

Part ini membalik perspektif.

Backend service bukan hanya **menerima HTTP request**. Backend service juga sering menjadi **HTTP client** untuk:

- memanggil service internal lain,
- memanggil identity provider,
- memanggil payment provider,
- memanggil document storage,
- memanggil fraud/risk engine,
- memanggil notification service,
- memanggil external regulator/agency API,
- memanggil webhook receiver,
- memanggil partner integration,
- mengirim callback asynchronous.

Di titik ini, HTTP client bukan helper library biasa. Ia adalah **dependency boundary**.

Kalau inbound HTTP salah, satu endpoint bisa rusak. Kalau outbound HTTP salah, satu dependency bisa menyeret seluruh sistem jatuh melalui timeout, retry storm, thread starvation, connection leak, token propagation error, atau misleading error mapping.

---

## 1. Core Mental Model

Backend-to-backend HTTP client adalah kombinasi dari 6 hal:

```text
HTTP client = protocol adapter
            + dependency boundary
            + resource manager
            + failure translator
            + security boundary
            + observability emitter
```

Artinya, ketika service `A` memanggil service `B`, `A` tidak hanya “mengirim request”. `A` sedang mengambil keputusan tentang:

1. Bagaimana kontrak remote dependency dimodelkan.
2. Berapa lama resource lokal boleh ditahan.
3. Kapan retry aman.
4. Kapan error dianggap domain error, dependency error, atau system overload.
5. Token/identity apa yang boleh dikirim.
6. Header mana yang boleh dipropagasikan.
7. Apakah request perlu idempotency key.
8. Bagaimana trace/log/metrics mencatat dependency call.
9. Apa yang terjadi jika dependency lambat, down, partial failure, atau memberi response ambigu.

Client yang buruk biasanya terlihat sederhana:

```java
RestTemplate restTemplate = new RestTemplate();
return restTemplate.getForObject(url, Foo.class);
```

Client production-grade biasanya lebih eksplisit:

```text
Typed client wrapper
  -> request construction
  -> authentication/signing
  -> timeout/deadline
  -> idempotency/retry policy
  -> circuit breaker/bulkhead
  -> response classification
  -> error translation
  -> metrics/log/tracing
  -> domain-level result
```

---

## 2. Kenapa Outbound HTTP Lebih Berbahaya dari Kelihatannya

### 2.1 Remote call menahan resource lokal

Saat service melakukan outbound HTTP call, ia biasanya menahan:

- thread atau event-loop continuation,
- connection dari pool outbound,
- memory buffer,
- request context,
- transaction context jika salah desain,
- lock jika lebih salah lagi,
- user-facing request timeout budget,
- database transaction jika call dilakukan di dalam transaction.

Kalau dependency lambat, service caller ikut lambat. Kalau caller ikut lambat, upstream caller ikut lambat. Ini bisa menjadi **cascading failure**.

### 2.2 Remote failure jarang binary

Remote dependency tidak hanya “up” atau “down”. Ia bisa:

- connect timeout,
- TLS handshake gagal,
- DNS gagal,
- connection reset,
- read timeout,
- memberi `429`,
- memberi `503`,
- memberi `500`,
- memberi `200` dengan body error,
- memberi response schema berubah,
- memberi response lambat setelah caller timeout,
- sukses tapi caller tidak menerima response,
- sukses sebagian,
- duplikat memproses request akibat retry.

Engineer top-tier tidak mendesain client untuk happy path. Ia mendesain client untuk **ambiguous completion**.

---

## 3. Taxonomy Backend-to-Backend Calls

Tidak semua outbound call sama. Policy client harus mengikuti jenis dependency.

### 3.1 Internal synchronous query

Contoh:

```text
Case Service -> User Service: GET /users/{id}
```

Karakteristik:

- biasanya safe,
- kadang cacheable,
- retry relatif aman,
- latency harus rendah,
- fallback mungkin tersedia,
- harus ada timeout pendek.

### 3.2 Internal command

Contoh:

```text
Case Service -> Notification Service: POST /notifications
Case Service -> Evidence Service: POST /evidence-records
```

Karakteristik:

- punya side effect,
- retry hanya aman jika idempotent,
- perlu idempotency key atau operation id,
- response timeout tidak berarti operation gagal,
- butuh reconciliation.

### 3.3 External provider call

Contoh:

```text
Payment provider
Identity provider
External regulator API
Document signing provider
```

Karakteristik:

- latency lebih tidak stabil,
- error semantics tidak selalu ideal,
- schema bisa berubah,
- security/signature penting,
- rate limit ketat,
- retry harus sangat hati-hati,
- audit dan evidence logging penting.

### 3.4 Control-plane call

Contoh:

```text
Service -> Feature flag service
Service -> Config service
Service -> Policy service
```

Karakteristik:

- memengaruhi behavior sistem,
- fallback/stale cache sering lebih baik daripada hard failure,
- timeout harus sangat pendek,
- failure mode harus eksplisit.

### 3.5 Authentication/introspection call

Contoh:

```text
API -> Authorization Server: POST /introspect
```

Karakteristik:

- sangat latency-sensitive,
- bisa menjadi bottleneck semua request,
- caching perlu hati-hati,
- fail-open/fail-closed adalah security decision.

### 3.6 Webhook/callback delivery

Contoh:

```text
Platform -> Partner: POST /partner-webhooks/case-status
```

Karakteristik:

- receiver tidak dikontrol,
- retry biasanya async,
- signing wajib,
- exponential backoff,
- deduplication event id,
- delivery log penting.

---

## 4. Java HTTP Client Options

Di ekosistem Java modern, pilihan umum adalah:

1. JDK `java.net.http.HttpClient`.
2. Spring `RestClient`.
3. Spring `WebClient`.
4. Apache HttpClient.
5. OkHttp.
6. Legacy `RestTemplate`.
7. Generated clients dari OpenAPI.
8. Declarative clients seperti OpenFeign.

Tidak ada satu client terbaik untuk semua kasus. Yang penting adalah memahami **runtime model**, **connection pool**, **timeout**, **observability**, dan **error model**.

---

## 5. JDK `java.net.http.HttpClient`

JDK `HttpClient` tersedia sejak Java 11.

Mental model:

```text
HttpClient
  immutable setelah dibangun
  dapat dipakai untuk banyak request
  mengelola resource sharing untuk request-requestnya
  mendukung HTTP/1.1 dan HTTP/2
  mendukung sync dan async API
```

Contoh sederhana:

```java
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(2))
    .version(HttpClient.Version.HTTP_2)
    .followRedirects(HttpClient.Redirect.NEVER)
    .build();

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://user-service.internal/users/123"))
    .timeout(Duration.ofSeconds(1))
    .header("Accept", "application/json")
    .GET()
    .build();

HttpResponse<String> response = client.send(
    request,
    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
);
```

Hal penting:

- jangan membuat `HttpClient` baru per request,
- bedakan connect timeout dan request timeout,
- gunakan immutable shared client,
- response classification tetap harus dibuat sendiri,
- JSON serialization/deserialization bukan concern bawaan utama,
- observability otomatis tergantung instrumentation yang dipakai.

JDK `HttpClient` cocok untuk:

- aplikasi non-Spring,
- library kecil,
- client sederhana,
- kontrol manual tinggi,
- menghindari dependency eksternal.

Namun untuk aplikasi Spring production, sering lebih praktis memakai `RestClient` atau `WebClient` karena integrasi dengan message converter, error handler, observability, dan konfigurasi Spring ecosystem lebih natural.

---

## 6. Spring `RestClient`

`RestClient` adalah synchronous HTTP client fluent API di Spring Framework modern.

Mental model:

```text
RestClient = modern synchronous client API
           + Spring message converters
           + fluent request builder
           + integrasi Spring ecosystem
```

Contoh:

```java
RestClient userClient = RestClient.builder()
    .baseUrl("https://user-service.internal")
    .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
    .build();

UserDto user = userClient.get()
    .uri("/users/{id}", userId)
    .retrieve()
    .body(UserDto.class);
```

Kelebihan:

- lebih modern daripada `RestTemplate`,
- API fluent,
- cocok untuk synchronous Spring MVC service,
- menggunakan infrastructure Spring untuk body conversion,
- mudah dibungkus sebagai typed client.

Tapi `RestClient` tetap membutuhkan desain production:

- request factory dengan timeout,
- connection pool,
- retry/circuit breaker jika perlu,
- error mapping,
- auth header,
- trace propagation,
- idempotency policy,
- metrics.

Contoh typed wrapper:

```java
@Component
public class UserDirectoryClient {

    private final RestClient restClient;

    public UserDirectoryClient(RestClient.Builder builder) {
        this.restClient = builder
            .baseUrl("https://user-service.internal")
            .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
            .build();
    }

    public Optional<UserProfile> findUser(UserId id) {
        try {
            UserProfileResponse response = restClient.get()
                .uri("/users/{id}", id.value())
                .retrieve()
                .body(UserProfileResponse.class);

            return Optional.of(map(response));
        } catch (HttpClientErrorException.NotFound ex) {
            return Optional.empty();
        } catch (RestClientException ex) {
            throw new UserDirectoryUnavailableException("User directory call failed", ex);
        }
    }
}
```

Perhatikan: controller atau service domain tidak perlu tahu URL, header, status code detail, atau provider-specific exception. Semua itu berada di client boundary.

---

## 7. Spring `WebClient`

`WebClient` adalah HTTP client reactive dari Spring WebFlux.

Mental model:

```text
WebClient = non-blocking HTTP client
          + Reactor Mono/Flux
          + streaming support
          + cancellation/backpressure-aware pipeline
```

Contoh:

```java
WebClient userClient = WebClient.builder()
    .baseUrl("https://user-service.internal")
    .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
    .build();

Mono<UserDto> userMono = userClient.get()
    .uri("/users/{id}", userId)
    .retrieve()
    .bodyToMono(UserDto.class);
```

Cocok untuk:

- WebFlux application,
- high-concurrency I/O-bound calls,
- streaming response,
- SSE/NDJSON,
- fan-out dengan composition reactive,
- cancellation propagation.

Bahaya umum:

```java
// Buruk jika dijalankan di event loop atau dipakai sembarangan
UserDto user = webClient.get()
    .uri("/users/{id}", userId)
    .retrieve()
    .bodyToMono(UserDto.class)
    .block();
```

`block()` bisa valid di boundary tertentu pada aplikasi synchronous, tetapi sangat berbahaya jika terjadi di event loop WebFlux atau tanpa timeout eksplisit.

Contoh reactive timeout dan error mapping:

```java
public Mono<UserProfile> getUser(UserId id) {
    return webClient.get()
        .uri("/users/{id}", id.value())
        .accept(MediaType.APPLICATION_JSON)
        .retrieve()
        .onStatus(HttpStatusCode::is4xxClientError, response ->
            response.bodyToMono(ProblemDetail.class)
                .map(problem -> new UserDirectoryClientException(problem.getDetail()))
        )
        .onStatus(HttpStatusCode::is5xxServerError, response ->
            Mono.just(new UserDirectoryUnavailableException("User directory unavailable"))
        )
        .bodyToMono(UserProfileResponse.class)
        .timeout(Duration.ofMillis(800))
        .map(this::map);
}
```

---

## 8. Apache HttpClient dan OkHttp

### 8.1 Apache HttpClient

Apache HttpClient sering dipakai ketika butuh kontrol kuat atas:

- connection pooling,
- proxy,
- TLS,
- retry strategy,
- connection eviction,
- socket config,
- advanced authentication,
- enterprise network environment.

Ia sering menjadi underlying client untuk Spring request factory.

### 8.2 OkHttp

OkHttp populer karena:

- API ergonomis,
- connection pooling matang,
- HTTP/2 support,
- interceptor model,
- banyak dipakai di JVM ecosystem,
- mudah untuk signing/logging/interceptor.

Dalam Spring application, pilihannya bukan hanya library mana paling cepat, tetapi mana yang paling mudah dikonfigurasi konsisten untuk:

- timeout,
- pool,
- metrics,
- trace,
- TLS,
- proxy,
- error handling,
- testability.

---

## 9. Jangan Sebar Raw HTTP Calls di Seluruh Codebase

Anti-pattern umum:

```text
Controller A langsung panggil WebClient
Service B langsung bikin RestTemplate
Job C langsung pakai Java HttpClient
Handler D langsung parse status code
```

Akibat:

- timeout tidak konsisten,
- retry tidak konsisten,
- auth propagation bocor,
- error mapping berbeda-beda,
- observability sulit,
- test sulit,
- migration dependency sulit,
- provider contract tersebar.

Pattern yang lebih baik:

```text
Application Service
  -> Port/interface
      -> Typed HTTP Adapter/Client
          -> HTTP library
```

Contoh:

```java
public interface UserDirectory {
    Optional<UserProfile> findById(UserId id);
}

@Component
public class HttpUserDirectory implements UserDirectory {
    private final RestClient restClient;

    @Override
    public Optional<UserProfile> findById(UserId id) {
        // HTTP-specific behavior stays here
    }
}
```

Keuntungan:

- domain tidak tahu HTTP,
- provider migration lebih mudah,
- test domain bisa pakai fake implementation,
- error taxonomy internal stabil,
- resilience policy per dependency jelas,
- observability bisa distandarkan.

---

## 10. Connection Pooling

### 10.1 Kenapa connection pool penting

Membuat TCP/TLS connection baru untuk setiap request mahal:

- TCP handshake,
- TLS handshake,
- CPU cryptography,
- latency tambahan,
- port exhaustion,
- load balancer pressure.

HTTP client production harus reuse connection.

### 10.2 Pool harus bounded

Connection pool tidak boleh infinite.

Parameter penting:

- max total connections,
- max connections per host/route,
- idle timeout,
- connection lifetime,
- pending acquisition timeout,
- keep-alive behavior,
- HTTP/2 multiplexing limit,
- stale connection validation.

Masalah jika terlalu kecil:

- request menunggu pool,
- latency naik,
- timeout palsu,
- throughput turun.

Masalah jika terlalu besar:

- dependency overload,
- local resource exhaustion,
- load balancer overload,
- retry storm lebih besar.

### 10.3 Pool adalah bulkhead

Connection pool per dependency bisa berfungsi sebagai bulkhead.

```text
Case Service
  -> User Service pool: max 50
  -> Evidence Service pool: max 30
  -> External Regulator pool: max 10
```

Jika external regulator lambat, pool external regulator penuh, tetapi pool user service tetap sehat.

Kalau semua dependency memakai satu global pool, satu dependency lambat bisa menghabiskan semua outbound connection capacity.

---

## 11. DNS Behavior

DNS sering dilupakan dalam HTTP client design.

Masalah umum:

- DNS lookup lambat,
- DNS cache terlalu lama,
- service IP berubah,
- Kubernetes service discovery,
- load balancer IP rotation,
- stale DNS,
- split-horizon DNS,
- negative DNS cache.

Pertanyaan production:

1. Berapa lama JVM cache DNS?
2. Apakah client menghormati DNS TTL?
3. Apakah connection pool tetap menahan koneksi lama ke instance yang sudah drain?
4. Apakah retry mencoba endpoint yang sama atau resolve ulang?
5. Bagaimana behavior saat DNS intermittent failure?

Di Kubernetes, service name biasanya stabil, tetapi endpoint di belakangnya bisa berubah. Connection reuse tetap perlu disesuaikan dengan lifecycle pod, load balancer, dan drain timeout.

---

## 12. TLS Verification and Trust

Outbound HTTPS bukan hanya “pakai https”.

Client harus memastikan:

- certificate valid,
- hostname verification aktif,
- trust store benar,
- certificate chain benar,
- TLS version aman,
- cipher policy sesuai,
- mTLS jika diperlukan,
- certificate rotation didukung,
- private key tidak bocor,
- tidak ada `trustAllCerts` di production.

Anti-pattern fatal:

```java
// Jangan pernah pakai pendekatan seperti ini di production
TrustManager[] trustAllCerts = ...
HostnameVerifier trustAllHosts = (hostname, session) -> true;
```

Untuk service-to-service internal, pilihan umum:

1. TLS terminated at mesh sidecar.
2. mTLS antar-service via service mesh.
3. mTLS langsung di application client.
4. Private CA internal.

Pertanyaan desain:

- Apakah identity service berasal dari certificate, token, atau keduanya?
- Siapa yang melakukan certificate rotation?
- Apa behavior saat cert hampir expired?
- Apakah expiry termonitor?
- Apakah hostname verification tetap aktif untuk internal service?

---

## 13. Timeout Taxonomy for HTTP Clients

Timeout harus eksplisit dan berlapis.

### 13.1 Connect timeout

Batas waktu untuk membuka koneksi ke remote.

Jika connect timeout terjadi, biasanya remote tidak reachable atau network path bermasalah.

### 13.2 TLS handshake timeout

Batas waktu handshake TLS.

Kadang termasuk socket/connect/read config tergantung client library.

### 13.3 Connection acquisition timeout

Batas waktu menunggu connection dari pool.

Ini penting. Banyak orang hanya set connect/read timeout, tetapi lupa bahwa request bisa menunggu lama di pool queue sebelum koneksi tersedia.

### 13.4 Write timeout

Batas waktu menulis request body.

Penting untuk upload besar atau network lambat.

### 13.5 Read/response timeout

Batas waktu menunggu response byte atau response completion.

### 13.6 Total request timeout

Batas end-to-end untuk satu outbound call.

### 13.7 Deadline from inbound request

Outbound timeout harus lebih kecil dari sisa inbound deadline.

```text
Inbound request timeout: 2s
  validation: 100ms
  DB: 300ms
  outbound dependency: max 700ms
  response mapping: 50ms
  safety margin: 200ms
```

Jangan set outbound timeout 5s di dalam inbound request yang timeout-nya 2s.

---

## 14. Timeout Budgeting

Timeout bukan angka random.

Pertanyaan:

1. Berapa SLO endpoint caller?
2. Berapa dependency latency p95/p99?
3. Apakah dependency internal atau external?
4. Apakah call ada di user-facing path?
5. Apakah fallback tersedia?
6. Apakah retry akan dilakukan?
7. Berapa jumlah retry maksimal?
8. Berapa concurrency traffic?
9. Apakah timeout akan menyebabkan duplicate side effect?

Contoh salah:

```text
Client timeout: 30s
Gateway timeout: 10s
Service request timeout: 5s
DB timeout: none
Retry: 3x
```

Contoh lebih masuk akal:

```text
Gateway timeout: 3s
Service deadline: 2.5s
Outbound dependency A timeout: 600ms
Outbound dependency B timeout: 400ms
Retry only for safe/idempotent transient errors
DB statement timeout: 700ms
```

---

## 15. Retry Policy

Retry adalah obat yang bisa menjadi racun.

Retry membantu ketika:

- failure transient,
- operation safe/idempotent,
- dependency punya kapasitas pulih,
- retry diberi backoff/jitter,
- retry budget terbatas.

Retry memperburuk ketika:

- dependency sedang overload,
- request punya side effect non-idempotent,
- timeout terlalu panjang,
- semua caller retry bersamaan,
- tidak ada jitter,
- retry dilakukan di banyak layer sekaligus.

### 15.1 Retryable vs non-retryable

Umumnya retryable:

- connect timeout,
- connection reset sebelum request diproses,
- DNS temporary failure,
- `503` dengan `Retry-After`,
- `429` dengan `Retry-After`,
- selected `502/504`, tergantung path.

Umumnya tidak retryable:

- `400`,
- `401`,
- `403`,
- `404` untuk lookup deterministik,
- `409` tanpa state refresh,
- `422`,
- schema validation error,
- side-effecting `POST` tanpa idempotency key.

### 15.2 Retry budget

Jangan berpikir “retry 3x selalu aman”.

Jika traffic 1000 RPS dan setiap request retry 3x saat dependency down, dependency menerima potensi 4000 RPS. Itu mempercepat collapse.

Retry budget harus dibatasi:

```text
max attempts: 2
max total retry time: 300ms
backoff: exponential + jitter
retry only idempotent operations
respect Retry-After
stop if caller deadline nearly exhausted
```

### 15.3 Jitter

Tanpa jitter, semua client bisa retry bersamaan.

```text
Bad:
  retry after 100ms, 200ms, 400ms exactly

Better:
  retry after random between 50-150ms, then 100-300ms, etc.
```

---

## 16. Idempotency for Outbound Commands

Jika caller mengirim command ke dependency, retry butuh idempotency.

Contoh:

```http
POST /external-submissions HTTP/1.1
Idempotency-Key: case-123-submit-regulator-v1
Content-Type: application/json
```

Key harus:

- unik per logical operation,
- stabil across retry,
- tidak reuse untuk payload berbeda,
- punya expiry policy,
- tercatat di audit log,
- dikaitkan dengan operation id internal.

Untuk service internal, lebih baik pakai operation id domain:

```json
{
  "operationId": "01HZY7...",
  "caseId": "CASE-2026-0001",
  "transition": "SUBMIT_TO_REGULATOR"
}
```

Dan tetap kirim header:

```http
Idempotency-Key: 01HZY7...
```

Jika dependency tidak mendukung idempotency, caller harus menghindari sync retry untuk side-effecting operation dan memakai async outbox/reconciliation.

---

## 17. Circuit Breaker

Circuit breaker mencegah caller terus memanggil dependency yang jelas sedang gagal.

State umum:

```text
CLOSED
  normal calls allowed

OPEN
  calls fail fast

HALF_OPEN
  limited probe calls allowed
```

Circuit breaker cocok untuk:

- dependency remote,
- failure rate tinggi,
- timeout meningkat,
- external provider instability,
- mencegah thread/connection exhaustion.

Namun circuit breaker bukan pengganti timeout. Tanpa timeout, circuit breaker juga terlambat tahu failure.

Desain error mapping:

```text
Circuit open -> dependency unavailable -> maybe 503 to upstream
Timeout -> dependency timeout -> maybe 504/503 depending ownership
4xx from dependency -> domain/client mapping
```

---

## 18. Bulkhead

Bulkhead membatasi blast radius.

Bentuk bulkhead:

- connection pool per dependency,
- thread pool per dependency,
- semaphore per dependency,
- reactive concurrency limit,
- queue bound per dependency.

Contoh:

```text
External regulator API:
  max concurrent calls: 10
  queue: 0 or very small
  timeout: 1s
  circuit breaker enabled

Internal user service:
  max concurrent calls: 100
  timeout: 300ms
  short retry for GET only
```

Tanpa bulkhead, satu dependency lambat bisa menghabiskan semua worker thread caller.

---

## 19. Rate Limiting Outbound

Inbound rate limiting melindungi service kita. Outbound rate limiting melindungi dependency dan kontrak provider.

Gunakan outbound limiter untuk:

- external API quota,
- partner API limit,
- regulator API window,
- expensive internal dependency,
- downstream shared service.

Pertanyaan:

1. Limit per tenant atau global?
2. Limit per provider credential?
3. Limit per operation type?
4. Apa yang terjadi jika limit habis?
5. Apakah request ditolak, ditunda, atau masuk queue async?
6. Apakah response ke caller `429`, `503`, atau `202 accepted`?

Untuk user-facing synchronous path, menunggu lama dalam queue outbound biasanya buruk. Lebih baik fail fast atau ubah operasi menjadi async job.

---

## 20. Error Classification

Jangan lempar raw HTTP exception ke domain.

Buat taxonomy internal.

Contoh:

```java
sealed interface UserDirectoryError permits
    UserNotFound,
    UserDirectoryUnavailable,
    UserDirectoryTimeout,
    UserDirectoryContractViolation,
    UserDirectoryUnauthorized {
}
```

Mapping:

```text
404 -> UserNotFound
401/403 -> configuration/security error, usually alert
429 -> dependency throttled
500/502/503/504 -> dependency unavailable
schema parse failure -> contract violation
connect timeout -> dependency unreachable
read timeout -> dependency timeout
circuit open -> dependency unavailable fast-fail
```

Untuk command:

```text
timeout after sending request body != operation failed
```

Ini harus dimodelkan sebagai ambiguous completion:

```java
enum CommandOutcome {
    ACCEPTED,
    REJECTED,
    DUPLICATE_ACCEPTED,
    AMBIGUOUS_COMPLETION,
    DEPENDENCY_UNAVAILABLE
}
```

---

## 21. Status Code Mapping from Dependency to Caller

Jangan otomatis meneruskan status code dependency ke upstream caller.

Contoh:

```text
Client -> Case API -> User Service
```

Jika User Service memberi `404 user not found`, Case API mungkin perlu mengembalikan:

- `422` jika user id dalam request invalid secara domain,
- `409` jika case assignment conflict,
- `500` jika invariant internal rusak,
- `503` jika user directory unavailable,
- `404` hanya jika resource utama Case API memang tidak ditemukan.

Dependency status code adalah input, bukan output final.

---

## 22. Token Propagation

Outbound call sering butuh auth.

Pola umum:

### 22.1 End-user token propagation

Service meneruskan token user ke dependency.

Risiko:

- token audience salah,
- token terlalu powerful,
- dependency mendapat akses yang tidak diperlukan,
- confused deputy,
- token bocor di log,
- chain terlalu panjang.

### 22.2 Token exchange / on-behalf-of

Service menukar token user menjadi token baru untuk dependency dengan audience yang tepat.

Lebih aman untuk zero-trust/service-to-service.

### 22.3 Service credential

Service memanggil dependency sebagai service identity.

Perlu membawa user context secara terpisah untuk audit:

```http
Authorization: Bearer <service-token>
X-Actor-User-Id: <internal-user-id>   // hanya jika trusted internal and policy-defined
```

Header actor tidak boleh dipercaya dari external client. Header seperti ini harus dibuat oleh trusted service/gateway.

### 22.4 mTLS identity

Dependency mengenali caller dari certificate/service identity.

Masih mungkin perlu token untuk user/tenant context.

---

## 23. Header Propagation Policy

Jangan propagate semua inbound headers ke outbound request.

Buruk:

```java
inboundHeaders.forEach(outbound::header);
```

Risiko:

- spoofed `X-Forwarded-For`,
- leaked cookies,
- leaked Authorization,
- wrong Host,
- cache headers bocor,
- CORS headers tidak relevan,
- internal control headers disalahgunakan,
- correlation chaos.

Gunakan allowlist.

Biasanya boleh dipropagasikan/dibuat ulang:

- `traceparent`,
- `tracestate` jika trust policy jelas,
- `X-Request-ID` atau correlation id,
- selected tenant context dari trusted auth result,
- selected locale jika dependency butuh,
- idempotency key for same logical operation,
- service-to-service auth header yang dibuat caller.

Biasanya jangan dipropagasikan mentah:

- `Authorization` external user token tanpa audience check,
- `Cookie`,
- `Host`,
- `Forwarded`,
- `X-Forwarded-*`,
- `Connection`,
- `Transfer-Encoding`,
- `Content-Length`,
- browser-only headers,
- gateway internal headers dari untrusted source.

---

## 24. Trace Propagation and Metrics

Outbound HTTP client harus menghasilkan observability dependency.

Minimal metrics:

```text
http.client.request.duration
http.client.request.count
http.client.error.count
status code distribution
exception type
dependency name
operation name
retry count
circuit breaker state
connection pool usage
timeout count
```

Hindari high-cardinality label:

```text
Bad label:
  uri=/users/12345/cases/98765

Better label:
  uri_template=/users/{userId}/cases/{caseId}
```

Trace span outbound harus mencatat:

- dependency/service name,
- HTTP method,
- route/template jika ada,
- status code,
- error type,
- retry attempts jika relevan,
- timeout/circuit breaker attributes jika instrumentation mendukung.

Correlation id membantu log manusia; trace id membantu distributed tracing.

---

## 25. Logging Outbound Calls

Log yang baik menjawab:

1. Dependency apa yang dipanggil?
2. Operation apa?
3. Berapa durasinya?
4. Apa hasilnya?
5. Retry berapa kali?
6. Timeout/circuit breaker terjadi?
7. Correlation/trace id apa?
8. Tenant/user context internal apa?

Jangan log:

- bearer token,
- cookie,
- API key,
- private key,
- full PII payload,
- evidence document body,
- password/secret,
- raw signed payload tanpa redaction.

Contoh structured log:

```json
{
  "event": "outbound_http_call_completed",
  "dependency": "user-directory",
  "operation": "getUserProfile",
  "method": "GET",
  "uriTemplate": "/users/{id}",
  "status": 200,
  "durationMs": 42,
  "attempts": 1,
  "traceId": "...",
  "tenantId": "tenant-a"
}
```

---

## 26. Request Signing

External integration sering membutuhkan signing.

Common patterns:

- HMAC signature,
- asymmetric signature,
- timestamp + nonce,
- canonical request,
- body hash,
- mTLS plus signature,
- webhook signature.

Hal penting:

1. Signature harus mencakup method, path, query, timestamp, body hash.
2. Timestamp harus punya tolerance kecil.
3. Nonce/idempotency id mencegah replay.
4. Canonicalization harus deterministic.
5. Jangan sign header yang bisa diubah proxy kecuali controlled.
6. Secret rotation harus didukung.
7. Signature failure harus observable.

Contoh conceptual canonical string:

```text
POST
/external-submissions
caseId=CASE-1
content-type:application/json
x-request-timestamp:2026-06-19T10:15:30Z
sha256=<body-hash>
```

---

## 27. JSON Contract Robustness

Outbound client harus defensif terhadap response dependency.

Pertanyaan:

- Apakah unknown fields diabaikan?
- Apakah missing field dianggap error?
- Apakah enum unknown ditangani?
- Apakah number precision aman?
- Apakah date/time timezone eksplisit?
- Apakah error body mengikuti Problem Details?
- Apakah dependency kadang mengirim HTML error page?
- Apakah content-type dicek sebelum parse?

Jangan parse body sukses jika status error tanpa classification.

Jangan menganggap `200` selalu valid jika body schema rusak.

Schema parse failure adalah **contract violation**, bukan sekadar NullPointerException.

---

## 28. Redirect Handling

Backend HTTP client biasanya harus hati-hati dengan redirect.

Risiko:

- Authorization header terkirim ke host lain,
- SSRF via redirect,
- method berubah pada redirect tertentu,
- POST body dikirim ulang,
- signature invalid,
- audit membingungkan,
- dependency endpoint misconfigured.

Default aman untuk internal API:

```text
follow redirects: disabled
```

Jika redirect perlu didukung:

- allowlist host,
- jangan forward credentials cross-host,
- batasi redirect count,
- log redirect,
- validate scheme tetap HTTPS,
- jangan ikuti redirect ke private IP jika URL berasal dari user input.

---

## 29. Proxies and Corporate Network

Outbound client kadang melewati forward proxy atau egress gateway.

Pertanyaan:

- Apakah proxy mengubah headers?
- Apakah TLS diinspeksi?
- Apakah mTLS masih end-to-end?
- Apakah proxy punya timeout lebih pendek?
- Apakah proxy mengembalikan `407 Proxy Authentication Required`?
- Apakah egress policy allowlist host?
- Apakah DNS resolution dilakukan client atau proxy?

Untuk regulated systems, egress harus terkendali:

```text
Service -> controlled egress gateway -> external provider
```

Bukan semua pod bebas memanggil internet.

---

## 30. Avoid Remote Calls Inside Database Transactions

Anti-pattern:

```java
@Transactional
public void submitCase(CaseId caseId) {
    Case c = repository.lock(caseId);
    regulatorClient.submit(c); // remote HTTP inside DB transaction
    c.markSubmitted();
}
```

Masalah:

- DB lock ditahan selama network call,
- timeout remote bisa memperpanjang transaction,
- retry bisa duplicate side effect,
- transaction rollback tidak membatalkan remote side effect,
- deadlock/lock contention meningkat,
- ambiguous completion sulit direconcile.

Pattern lebih baik:

```text
1. Validate state inside transaction
2. Record command/outbox event
3. Commit local transaction
4. Worker sends HTTP command with idempotency key
5. Record result/retry/reconciliation
```

Atau jika memang harus synchronous:

- jangan tahan lock selama remote call,
- gunakan version check/conditional update,
- gunakan timeout pendek,
- gunakan idempotency,
- desain recovery.

---

## 31. Fan-Out Calls

Endpoint sering melakukan beberapa outbound call.

Contoh:

```text
GET /cases/{id}/summary
  -> Case DB
  -> User Service
  -> Evidence Service
  -> Risk Service
  -> SLA Service
```

Risiko:

- latency total naik,
- partial failure,
- N+1 remote calls,
- dependency waterfall,
- retry multiplication,
- observability kompleks.

Design options:

### 31.1 Sequential calls

Mudah dipahami, tetapi latency menjumlah.

```text
A 100ms + B 120ms + C 80ms = 300ms+
```

### 31.2 Parallel calls

Latency lebih rendah, tetapi resource/concurrency lebih besar.

```text
max(A, B, C) = 120ms+
```

Tetap butuh:

- per-call timeout,
- global deadline,
- partial response policy,
- cancellation propagation,
- bounded concurrency.

### 31.3 Aggregation/cache/materialized view

Untuk read-heavy summary, sering lebih baik punya read model daripada fan-out setiap request.

### 31.4 Async enrichment

Response utama dikembalikan dulu, enrichment tersedia kemudian.

---

## 32. Parallel Calls with WebClient: Good and Bad

Contoh reactive composition:

```java
Mono<UserProfile> user = userClient.getUser(userId)
    .timeout(Duration.ofMillis(300));

Mono<RiskSummary> risk = riskClient.getRisk(caseId)
    .timeout(Duration.ofMillis(400));

return Mono.zip(user, risk)
    .map(tuple -> new CaseSummary(tuple.getT1(), tuple.getT2()))
    .timeout(Duration.ofMillis(600));
```

Masalah jika tidak hati-hati:

- semua request fan-out tanpa concurrency bound,
- timeout luar lebih pendek tapi inner call tidak cancel benar,
- error satu dependency menggagalkan semua response padahal partial acceptable,
- retry semua parallel calls meningkatkan storm,
- blocking mapping di event loop.

Untuk partial response:

```java
Mono<RiskSummary> risk = riskClient.getRisk(caseId)
    .timeout(Duration.ofMillis(300))
    .onErrorReturn(RiskSummary.unavailable());
```

Tapi fallback harus domain-legal. Jangan sembunyikan error penting hanya agar response terlihat sukses.

---

## 33. Circuit Breaker + Retry Ordering

Order matters.

Umum:

```text
TimeLimiter
Retry
CircuitBreaker
Bulkhead
```

Tetapi urutan tepat bergantung library dan tujuan.

Pertanyaan:

- Apakah circuit breaker menghitung setiap retry attempt atau final call?
- Apakah timeout berlaku per attempt atau total?
- Apakah bulkhead menahan slot selama retry backoff?
- Apakah retry terjadi setelah circuit open?
- Apakah fallback dipanggil setelah semua attempts?

Failure mode umum:

```text
timeout per attempt 1s
retry 3x
caller deadline 2s
=> total bisa melebihi caller deadline jika tidak ada total budget
```

Selalu desain berdasarkan **total budget**, bukan hanya per-attempt config.

---

## 34. Testing Backend HTTP Clients

Client test harus mencakup lebih dari `200 OK`.

### 34.1 Unit test with fake port

Domain service diuji dengan fake `UserDirectory` interface.

### 34.2 HTTP adapter test with mock server

Gunakan MockWebServer/WireMock/similar untuk menguji:

- request method,
- path,
- query,
- headers,
- body,
- auth signing,
- status code mapping,
- timeout,
- retry,
- malformed body,
- unknown fields,
- error body,
- rate limit response,
- `Retry-After`,
- connection reset jika tool mendukung.

### 34.3 Contract test

Jika dependency internal:

- provider contract,
- consumer-driven contract,
- OpenAPI schema validation,
- backward compatibility check.

### 34.4 Integration test

Test dengan real dependency di staging/sandbox untuk:

- TLS,
- auth,
- DNS,
- proxy,
- real latency,
- provider-specific edge cases.

### 34.5 Chaos test

Simulasikan:

- slow response,
- timeout,
- 500 burst,
- malformed JSON,
- partial response,
- rate limit,
- dependency down,
- DNS failure,
- TLS cert expired.

---

## 35. Generated Clients from OpenAPI

Generated client berguna, tetapi jangan biarkan generated code menjadi seluruh boundary.

Kelebihan:

- type generation,
- schema alignment,
- less boilerplate,
- faster onboarding,
- contract visibility.

Kekurangan:

- error model sering generik,
- retry/timeout tidak selalu sesuai,
- generated model bisa bocor ke domain,
- sulit custom observability jika tidak dibungkus,
- regeneration bisa breaking.

Pattern yang lebih baik:

```text
Domain/Application
  -> internal port interface
    -> custom adapter
      -> generated API client
        -> HTTP library
```

Generated DTO tidak harus menjadi domain model.

---

## 36. Webhook Delivery as Outbound HTTP

Webhook adalah outbound HTTP command ke sistem yang tidak kita kontrol.

Production webhook delivery harus punya:

- event id,
- idempotency semantics,
- signature,
- timestamp,
- retry schedule,
- dead-letter queue,
- delivery log,
- endpoint validation,
- timeout pendek,
- redirect policy ketat,
- SSRF protection,
- payload schema version,
- tenant isolation,
- per-destination rate limit.

Contoh headers:

```http
POST /partner/callback HTTP/1.1
Content-Type: application/json
X-Event-Id: evt_01HZ...
X-Event-Type: case.status.changed
X-Event-Timestamp: 2026-06-19T10:15:30Z
X-Signature: v1=...
```

Receiver harus bisa deduplicate berdasarkan `X-Event-Id`.

Sender harus menyimpan delivery attempts:

```text
attempt #1 -> timeout
attempt #2 -> 503
attempt #3 -> 200
```

---

## 37. SSRF Risk in Outbound Clients

Jika URL outbound berasal dari user input, Anda sedang membuka pintu SSRF.

Contoh fitur berisiko:

- import from URL,
- webhook URL registration,
- file fetcher,
- preview URL,
- callback URL,
- integration endpoint custom URL,
- evidence download from external URL.

Defense:

1. Allowlist domain jika mungkin.
2. Resolve DNS dan blok private/internal IP ranges.
3. Re-check after redirect.
4. Disable redirect atau validate redirect target.
5. Require HTTPS.
6. Block link-local metadata address.
7. Use egress proxy with network policy.
8. Timeout pendek.
9. Size limit.
10. Content-type validation.
11. No internal credentials.
12. Log destination safely.

Jangan biarkan backend HTTP client menjadi browser internal untuk attacker.

---

## 38. Handling `Retry-After`

Dependency bisa memberi:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
```

atau date:

```http
Retry-After: Fri, 19 Jun 2026 10:20:00 GMT
```

Client harus menentukan:

- apakah request synchronous bisa menunggu? biasanya tidak,
- apakah akan retry async? sering iya,
- apakah response ke caller menyertakan rate limit context?
- apakah retry-after melebihi caller deadline?
- apakah retry-after dipercaya dari dependency?

Untuk user-facing synchronous path, jika dependency meminta retry setelah 60 detik, service sebaiknya tidak menahan request 60 detik. Ubah menjadi async job atau fail fast dengan response yang jelas.

---

## 39. Caching Outbound Responses

Tidak semua dependency call harus real-time.

Candidate for cache:

- public reference data,
- user profile display name,
- policy metadata,
- feature flags,
- configuration,
- authorization metadata dengan TTL sangat hati-hati,
- external catalog.

Risiko cache:

- stale authorization,
- stale account status,
- tenant leakage,
- cache key tidak lengkap,
- negative cache terlalu lama,
- stampede saat expired.

Pattern:

```text
read-through cache
short TTL
stale-if-error for non-critical data
single-flight request coalescing
per-tenant cache key
explicit invalidation for critical updates
```

Jangan cache response yang mengandung user-specific sensitive data kecuali key dan TTL benar-benar aman.

---

## 40. Backend Client Configuration Template

Untuk setiap dependency, dokumentasikan:

```yaml
dependency: user-directory
owner: identity-platform-team
base_url: https://user-service.internal
protocol: HTTP/2 preferred
purpose: resolve user profile and active status
criticality: high
call_type: synchronous query
methods:
  - GET /users/{id}
timeouts:
  connect: 100ms
  acquire: 50ms
  response: 300ms
  total: 400ms
connection_pool:
  max_per_host: 50
  idle_timeout: 30s
retry:
  enabled: true
  max_attempts: 2
  retryable: connect-timeout, connection-reset, 503
  backoff: exponential-with-jitter
circuit_breaker:
  enabled: true
  failure_rate_threshold: 50%
  open_duration: 10s
bulkhead:
  max_concurrent: 100
auth:
  type: service-token
  audience: user-directory
headers:
  propagate:
    - traceparent
    - X-Request-ID
  deny:
    - Cookie
    - Authorization-from-external
observability:
  dependency_name: user-directory
  uri_template_labels: true
  log_body: false
fallback:
  active_status: fail-closed
  display_name: stale-cache-allowed
```

Ini terlihat birokratis, tetapi sangat efektif untuk production engineering.

---

## 41. Case Study: Regulatory Case Submission to External Agency

Scenario:

```text
Internal Case Management Platform
  -> External Regulator Submission API
```

Operation:

```text
Submit case package to external agency
```

Naive design:

```java
@PostMapping("/cases/{id}/submit")
public ResponseEntity<?> submit(@PathVariable String id) {
    Case c = repository.find(id);
    ExternalResponse r = regulatorClient.submit(c);
    c.markSubmitted(r.reference());
    repository.save(c);
    return ResponseEntity.ok().build();
}
```

Problems:

- remote call in request path,
- ambiguous timeout,
- no idempotency,
- no audit attempt log,
- no async retry,
- no reconciliation,
- DB and remote side effect coordination unclear,
- external outage blocks user operation,
- user may click submit again.

Better model:

```text
POST /cases/{id}/submission-requests
  -> validates user authorization and case state
  -> creates local SubmissionRequest with operationId
  -> writes outbox command
  -> returns 202 Accepted + operation resource

Worker:
  -> loads command
  -> sends external HTTP POST with Idempotency-Key
  -> signs request
  -> records attempt
  -> maps response
  -> updates submission request state
  -> emits audit event
```

External call headers:

```http
POST /agency/submissions HTTP/1.1
Authorization: Bearer <agency-token>
Content-Type: application/json
Accept: application/json
Idempotency-Key: subreq_01HZ...
X-Request-ID: req_...
Traceparent: 00-...
X-Signature: v1=...
```

Submission state machine:

```text
CREATED
  -> SENDING
  -> ACCEPTED
  -> REJECTED
  -> RETRY_SCHEDULED
  -> FAILED_REQUIRES_REVIEW
  -> AMBIGUOUS_REQUIRES_RECONCILIATION
```

Ambiguous completion handling:

```text
timeout after request sent
  -> do not mark failed immediately
  -> query agency by operation id/reference if supported
  -> retry with same idempotency key if allowed
  -> escalate to manual reconciliation after retry budget exhausted
```

This is the difference between “HTTP call works” and “business process is defensible”.

---

## 42. Practical Java/Spring Client Design

### 42.1 Define dependency port

```java
public interface ExternalAgencySubmissionPort {
    SubmissionResult submit(SubmissionCommand command);
}
```

### 42.2 Define stable internal result

```java
public sealed interface SubmissionResult {
    record Accepted(String agencyReference) implements SubmissionResult {}
    record Rejected(String reasonCode, String message) implements SubmissionResult {}
    record DuplicateAccepted(String agencyReference) implements SubmissionResult {}
    record Ambiguous(String reason) implements SubmissionResult {}
    record Unavailable(String reason) implements SubmissionResult {}
}
```

### 42.3 Implement HTTP adapter

```java
@Component
public class ExternalAgencyHttpClient implements ExternalAgencySubmissionPort {

    private final RestClient restClient;
    private final SignatureService signatureService;

    public ExternalAgencyHttpClient(RestClient.Builder builder,
                                    SignatureService signatureService) {
        this.restClient = builder
            .baseUrl("https://agency.example.gov")
            .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
            .build();
        this.signatureService = signatureService;
    }

    @Override
    public SubmissionResult submit(SubmissionCommand command) {
        AgencySubmissionRequest body = map(command);
        String signature = signatureService.sign("POST", "/submissions", body);

        try {
            AgencySubmissionResponse response = restClient.post()
                .uri("/submissions")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Idempotency-Key", command.operationId().value())
                .header("X-Signature", signature)
                .body(body)
                .retrieve()
                .body(AgencySubmissionResponse.class);

            return new SubmissionResult.Accepted(response.reference());

        } catch (HttpClientErrorException.Conflict ex) {
            return handleConflict(ex);
        } catch (HttpClientErrorException.UnprocessableEntity ex) {
            return handleRejected(ex);
        } catch (ResourceAccessException ex) {
            return new SubmissionResult.Ambiguous("network-timeout-or-access-error");
        } catch (RestClientException ex) {
            return new SubmissionResult.Unavailable("agency-client-error");
        }
    }
}
```

Note: real implementation should distinguish connect timeout, read timeout, TLS failure, parse failure, and server response errors more precisely.

---

## 43. Production Readiness Checklist

Untuk setiap backend HTTP client, cek:

### Contract

- Apakah dependency punya owner jelas?
- Apakah API contract terdokumentasi?
- Apakah status/error model dipahami?
- Apakah schema evolution ditangani?
- Apakah generated client dibungkus?

### Timeout

- Connect timeout ada?
- Pool acquisition timeout ada?
- Read/response timeout ada?
- Total timeout ada?
- Timeout sesuai caller deadline?
- Timeout gateway/service mesh aligned?

### Pooling

- Client instance reused?
- Pool bounded?
- Pool per dependency?
- Idle eviction/lifetime jelas?
- Pool metrics diamati?

### Retry

- Retry hanya untuk retryable failure?
- Retry hanya untuk safe/idempotent operation?
- Ada backoff+jitter?
- Ada max attempts?
- Ada total retry budget?
- Respect `Retry-After`?
- Tidak double retry di banyak layer?

### Idempotency

- Command punya operation id?
- `Idempotency-Key` dikirim jika didukung?
- Timeout after send dimodelkan ambiguous?
- Reconciliation tersedia?

### Resilience

- Circuit breaker perlu?
- Bulkhead perlu?
- Outbound rate limit perlu?
- Fallback domain-legal?
- Fail-open/fail-closed diputuskan eksplisit?

### Security

- TLS verification aktif?
- Trust store benar?
- mTLS jika perlu?
- Token audience benar?
- Header propagation allowlist?
- Secrets tidak masuk log?
- Redirect policy aman?
- SSRF protection jika URL dinamis?

### Observability

- Metrics per dependency?
- Trace span outbound?
- URI template, bukan raw URI high-cardinality?
- Retry count terlihat?
- Circuit breaker state terlihat?
- Timeout type terlihat?
- Logs redacted?

### Testing

- 2xx tested?
- 4xx tested?
- 5xx tested?
- Timeout tested?
- Malformed body tested?
- Retry tested?
- Circuit breaker tested?
- Auth/signature tested?
- Contract tested?

---

## 44. Common Anti-Patterns

### 44.1 Membuat HTTP client baru per request

Akibat:

- connection reuse hilang,
- TLS overhead tinggi,
- resource leak,
- throughput buruk.

### 44.2 Tidak punya timeout

Akibat:

- request menggantung,
- thread exhaustion,
- incident sulit dihentikan.

### 44.3 Retry semua error

Akibat:

- duplicate side effect,
- overload makin parah,
- provider rate limit.

### 44.4 Propagate semua header

Akibat:

- credential leak,
- spoofing,
- trust boundary collapse.

### 44.5 Remote call dalam DB transaction

Akibat:

- lock panjang,
- ambiguous side effect,
- rollback tidak membatalkan remote action.

### 44.6 Domain bergantung pada generated DTO

Akibat:

- provider schema bocor ke core domain,
- migration sulit,
- business model rapuh.

### 44.7 Menelan dependency failure dan return default palsu

Akibat:

- data salah,
- audit menyesatkan,
- regulatory decision invalid.

### 44.8 Logging full request/response body

Akibat:

- PII leak,
- secret leak,
- compliance issue,
- log cost explosion.

---

## 45. Exercises

### Exercise 1 — Classify dependency calls

Ambil 5 outbound call di sistem yang kamu kenal. Untuk tiap call, klasifikasikan:

```text
- dependency name
- internal/external
- query/command/control-plane/auth/webhook
- sync/async
- safe/idempotent/non-idempotent
- timeout budget
- retry policy
- circuit breaker needed?
- fallback allowed?
- audit required?
```

### Exercise 2 — Design typed client boundary

Desain interface dan adapter untuk:

```text
Case Service -> Evidence Service
```

Operation:

```text
GET /evidence/{id}/metadata
POST /evidence/{id}/scan-requests
```

Tentukan:

- method,
- timeout,
- retry,
- idempotency,
- error mapping,
- auth,
- trace/log fields.

### Exercise 3 — Failure matrix

Untuk command:

```text
POST /external-submissions
```

Buat matrix:

```text
Failure point                          Outcome
------------------------------------------------------------
connect timeout before sending          ?
connection reset after sending body      ?
read timeout after remote commit         ?
500 with unknown body                    ?
409 duplicate operation                  ?
429 Retry-After 60s                      ?
malformed 200 response                   ?
```

### Exercise 4 — Header propagation policy

Buat allowlist/denylist untuk outbound call dari API Gateway-facing service ke internal service.

Minimal bahas:

- `Authorization`,
- `Cookie`,
- `traceparent`,
- `X-Request-ID`,
- `X-Forwarded-For`,
- tenant context,
- locale,
- idempotency key.

### Exercise 5 — Timeout budget

Endpoint punya SLO 1 detik. Ia perlu:

- DB read,
- call User Service,
- call Risk Service,
- response rendering.

Buat budget realistis termasuk retry decision.

---

## 46. Ringkasan Mental Model

Backend-to-backend HTTP client yang baik bukan sekadar library call.

Ia harus menjawab:

1. Apa dependency contract-nya?
2. Berapa resource lokal boleh dipakai?
3. Apa timeout budget-nya?
4. Apakah retry aman?
5. Apakah operation idempotent?
6. Apa yang terjadi saat completion ambigu?
7. Bagaimana error remote diterjemahkan ke domain?
8. Token/header apa yang boleh dikirim?
9. Bagaimana trace/log/metrics merekam dependency call?
10. Bagaimana mencegah dependency failure menjadi cascading failure?

Engineer backend top-tier melihat outbound HTTP sebagai **distributed systems boundary**, bukan helper method.

---

## 47. Apa yang Harus Diingat

- Reuse HTTP client instance; jangan buat per request.
- Semua outbound call harus punya timeout eksplisit.
- Retry hanya untuk failure yang tepat dan operasi yang aman/idempotent.
- Command remote butuh idempotency atau async/reconciliation.
- Jangan propagate semua inbound headers.
- Jangan lakukan remote HTTP call di dalam DB transaction tanpa alasan sangat kuat.
- Dependency status code tidak otomatis menjadi status code API kamu.
- Token propagation harus memperhatikan audience dan trust boundary.
- Connection pool adalah resource manager dan bulkhead.
- Observability outbound sama pentingnya dengan observability inbound.
- Generated client harus dibungkus dalam adapter boundary.
- Timeout setelah request dikirim sering berarti ambiguous completion, bukan failure pasti.

---

## 48. Persiapan Part Berikutnya

Part berikutnya adalah capstone final:

```text
learn-http-for-web-backend-perspective-part-032.md
```

Judul:

```text
Capstone: Designing a Production-Grade HTTP API
```

Kita akan menggabungkan seluruh seri menjadi desain lengkap untuk regulatory enforcement case lifecycle:

- resource model,
- URI design,
- method/status matrix,
- representation,
- validation,
- error model,
- auth/authz,
- idempotency,
- optimistic concurrency,
- caching,
- rate limiting,
- file/evidence handling,
- async operation,
- observability,
- security hardening,
- Java/Spring implementation sketch,
- failure mode analysis,
- production readiness checklist.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-030.md">⬅️ HTTP for Web/Backend Perspective — Part 030</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-032.md">Part 032 — Capstone: Designing a Production-Grade HTTP API ➡️</a>
</div>

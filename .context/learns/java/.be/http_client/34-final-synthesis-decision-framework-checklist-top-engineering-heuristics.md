# Part 34 — Final Synthesis: Decision Framework, Checklist, and Top 1% Engineering Heuristics

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `34-final-synthesis-decision-framework-checklist-top-engineering-heuristics.md`  
> Scope: Java 8–25, JDK HttpClient, OkHttp, Retrofit, Apache HttpClient 5, Spring RestClient/WebClient/RestTemplate, generated clients, production operations.

---

## 1. Tujuan Part Ini

Part ini adalah sintesis akhir dari seluruh seri.

Jika Part 0 sampai Part 33 membangun pemahaman dari lifecycle, library, timeout, retry, observability, architecture, testing, sampai case study, maka Part 34 bertujuan membuat semua itu menjadi **kerangka keputusan yang bisa dipakai ulang**.

Targetnya bukan menghafal API.

Targetnya adalah bisa menjawab pertanyaan seperti:

- Library HTTP client mana yang paling cocok untuk kasus ini?
- Timeout harus berapa dan ditempatkan di mana?
- Retry aman atau berbahaya?
- Error model harus bagaimana supaya domain tidak bocor HTTP concern?
- Bagaimana tahu client ini production-ready?
- Bagaimana membedakan incident network, downstream, pool, thread, TLS, auth, atau bug mapping?
- Bagaimana mereview desain HTTP client milik engineer lain?
- Bagaimana membuat HTTP client menjadi komponen yang defensible, observable, secure, dan evolvable?

Mental model akhirnya sederhana:

```text
HTTP client production-grade
= protocol correctness
+ resource management
+ failure semantics
+ security boundary
+ observability
+ testability
+ operational playbook
+ architectural isolation
```

HTTP client yang baik bukan yang paling pendek kodenya.

HTTP client yang baik adalah yang perilakunya tetap bisa diprediksi saat:

- downstream lambat,
- DNS berubah,
- token expired,
- sertifikat diganti,
- response body besar,
- partial outage,
- traffic spike,
- retry mulai memperbesar beban,
- deployment berlangsung bertahap,
- tim lain mengubah kontrak API.

---

## 2. Final Mental Model: HTTP Client sebagai Boundary System

HTTP client berada di antara dua dunia:

```text
internal application model
        |
        v
client boundary
        |
        v
external protocol / remote system
```

Di sisi internal, aplikasi ingin berbicara dalam bahasa domain:

```text
getCustomerProfile(customerId)
submitApplication(command)
verifyPayment(referenceNo)
sendNotification(message)
```

Di sisi eksternal, realitanya adalah:

```text
URI
headers
method
body bytes
status code
TLS
DNS
socket
timeouts
retries
proxy
connection pool
JSON/XML/schema drift
```

Tugas HTTP client production-grade adalah **menerjemahkan dua dunia itu tanpa membuat domain layer tercemar oleh noise transport**.

### 2.1 Prinsip Utama

Prinsip yang harus selalu dipegang:

> Domain layer tidak boleh tahu terlalu banyak tentang HTTP.

Domain/application layer boleh tahu bahwa operasi gagal, tidak tersedia, timeout, rejected, conflict, unauthenticated, atau business-invalid.

Tetapi domain/application layer sebaiknya tidak perlu tahu detail seperti:

- `SocketTimeoutException`,
- `SSLHandshakeException`,
- OkHttp `ResponseBody`,
- Apache `HttpEntity`,
- Retrofit `Call<T>`,
- raw `HttpResponse<String>`,
- status code tanpa semantic translation,
- external DTO yang mengikuti schema vendor.

Boundary yang sehat terlihat seperti ini:

```text
Application Service
  -> Outbound Port
     -> HTTP Adapter / Gateway
        -> Policy Layer
           -> Transport Client
              -> Remote API
```

Contoh:

```java
public interface PaymentGateway {
    PaymentVerificationResult verify(PaymentReference reference);
}
```

Bukan:

```java
public class PaymentService {
    private final OkHttpClient client;

    public void process(...) {
        Request request = new Request.Builder()
            .url("https://vendor.example.com/api/payment/verify")
            .build();
        // domain logic mixed with HTTP, JSON, status code, retry, and logging
    }
}
```

---

## 3. Final Decision Framework: Memilih HTTP Client Library

Tidak ada satu library yang selalu benar.

Yang benar adalah library yang cocok dengan constraint.

### 3.1 Pilihan Utama

| Pilihan | Cocok Untuk | Hindari Jika |
|---|---|---|
| JDK `java.net.http.HttpClient` | Java 11+, dependency minimal, standar JDK, HTTP/2, async `CompletableFuture`, internal service sederhana-menengah | Perlu interceptor ecosystem kaya, built-in testing tools, fitur advanced transport yang lebih banyak |
| OkHttp | Production client kuat, HTTP/2, pooling, interceptor, event listener, TLS/pinning, Retrofit base | Butuh full enterprise Apache-style route/proxy customization tertentu |
| Retrofit | Type-safe API interface, third-party/internal API dengan contract jelas, DTO/converter/call adapter | API sangat dinamis, butuh request construction custom ekstrem, atau ingin menghindari annotation DSL |
| Apache HttpClient 5 | Enterprise transport control, proxy, route planner, connection manager, classic/async model, migration Apache 4.x | Ingin API sederhana/minimal dependency |
| Spring RestClient | Spring synchronous application modern, ingin fluent API, observation integration, blocking model | Non-Spring app atau reactive pipeline murni |
| Spring WebClient | Reactive/non-blocking pipeline, streaming, high concurrency dengan Reactor ecosystem | Tim tidak siap reactive complexity, blocking call bercampur tanpa disiplin |
| RestTemplate | Existing legacy Spring code | New development, kecuali alasan compatibility kuat |
| Generated OpenAPI client | Banyak endpoint, contract-first, governance SDK, multi-team API | Spec buruk/tidak stabil, generated DTO bocor ke domain, policy tidak bisa diinjeksi |

### 3.2 Decision Tree Sederhana

```text
Apakah aplikasi Java 8?
  ya  -> OkHttp / Apache HttpClient 5 / Retrofit / Spring RestTemplate legacy
  tidak -> lanjut

Butuh dependency minimal dan cukup standard HTTP?
  ya  -> JDK HttpClient
  tidak -> lanjut

Butuh type-safe declarative API interface?
  ya  -> Retrofit atau Spring HTTP Interface
  tidak -> lanjut

Butuh enterprise transport control kuat?
  ya  -> Apache HttpClient 5
  tidak -> lanjut

Aplikasi Spring synchronous modern?
  ya  -> RestClient
  tidak -> lanjut

Pipeline reactive end-to-end?
  ya  -> WebClient
  tidak -> OkHttp atau JDK HttpClient
```

### 3.3 Heuristic Library Selection

Gunakan **JDK HttpClient** bila:

- Java 11+ minimum,
- ingin dependency kecil,
- HTTP call relatif straightforward,
- tim nyaman membangun wrapper policy sendiri,
- tidak butuh Retrofit-style interface,
- tidak butuh Apache-level route/proxy customization.

Gunakan **OkHttp** bila:

- butuh production-ready transport engine,
- butuh interceptor chain,
- butuh EventListener untuk lifecycle metrics,
- butuh MockWebServer ecosystem,
- butuh integration natural dengan Retrofit,
- butuh HTTP/2, pooling, TLS features yang matang.

Gunakan **Retrofit** bila:

- API contract stabil,
- endpoint banyak,
- ingin interface sebagai API definition,
- ingin converter/call adapter abstraction,
- ingin mengurangi boilerplate request construction.

Gunakan **Apache HttpClient 5** bila:

- enterprise proxy/tunnel/route behavior penting,
- perlu per-route connection management eksplisit,
- migrasi dari Apache 4.x,
- organisasi sudah punya standard Apache,
- perlu classic dan async API dalam satu ecosystem.

Gunakan **Spring RestClient** bila:

- aplikasi Spring modern,
- model synchronous/blocking,
- ingin integrasi Spring message converter, observation, builder customization.

Gunakan **WebClient** bila:

- sistem reactive end-to-end,
- streaming/backpressure penting,
- concurrency sangat tinggi dan tim paham Reactor,
- tidak akan memblok event loop sembarangan.

---

## 4. Final Architecture Checklist

Gunakan checklist ini saat mendesain HTTP client baru.

### 4.1 Boundary Checklist

Sebuah HTTP client matang harus punya boundary yang jelas:

- [ ] Ada outbound port/domain-facing interface.
- [ ] External DTO tidak bocor ke domain model.
- [ ] Transport object tidak bocor ke application service.
- [ ] Status code diterjemahkan menjadi semantic result/error.
- [ ] Error body diparse di adapter, bukan di domain layer.
- [ ] Auth/token handling tidak disebar di caller.
- [ ] Timeout/retry/rate/circuit policy terpusat.
- [ ] Logging/redaction terpusat.
- [ ] Observability naming konsisten.
- [ ] Config tervalidasi saat startup.

### 4.2 Package Structure yang Disarankan

```text
com.example.integration.payment
  PaymentGateway.java                         // outbound port
  PaymentVerificationResult.java              // domain-safe result
  PaymentClientProperties.java                // config model

com.example.integration.payment.adapter
  PaymentHttpGateway.java                     // implements port
  PaymentRequestMapper.java
  PaymentResponseMapper.java
  PaymentErrorMapper.java

com.example.integration.payment.transport
  PaymentTransportClient.java                 // JDK/OkHttp/Retrofit/Apache detail
  PaymentAuthInterceptor.java
  PaymentObservationListener.java

com.example.integration.payment.dto
  VerifyPaymentRequestDto.java
  VerifyPaymentResponseDto.java
  PaymentProblemDto.java

com.example.integration.payment.policy
  PaymentRetryPolicy.java
  PaymentTimeoutPolicy.java
  PaymentRateLimitPolicy.java
  PaymentCircuitPolicy.java

com.example.integration.payment.test
  PaymentMockServerFixtures.java
```

### 4.3 Anti-Pattern Architecture

Hindari:

```text
Service class
  -> constructs URL manually
  -> adds auth header manually
  -> calls client directly
  -> parses JSON directly
  -> switches on status code directly
  -> retries directly
  -> logs body directly
  -> returns external DTO directly
```

Karena desain seperti ini membuat:

- policy tidak konsisten,
- error semantics tersebar,
- security review sulit,
- testing rapuh,
- observability tidak standar,
- migration library mahal,
- domain coupling tinggi.

---

## 5. Final Timeout Framework

Timeout bukan angka tunggal.

Timeout adalah **budget lifecycle**.

### 5.1 Jenis Timeout

```text
operation deadline
  ├─ queue / bulkhead acquisition
  ├─ DNS resolution
  ├─ pool acquisition
  ├─ TCP connect
  ├─ TLS handshake
  ├─ request write
  ├─ response header wait
  ├─ response body read
  ├─ decode/map
  └─ retry attempts
```

### 5.2 Rule of Thumb

- Connect timeout biasanya lebih pendek dari total operation timeout.
- Read/response timeout harus mengikuti downstream SLA.
- Retry harus berada dalam total deadline.
- Pool acquisition timeout harus ada jika pool/concurrency terbatas.
- Timeout per attempt tidak boleh membuat total latency melebihi upstream SLA.
- Jika ada fan-out, timeout per branch harus lebih kecil dari parent deadline.

### 5.3 Timeout Budget Example

Misalnya API caller punya SLA 2 detik.

Jangan lakukan:

```text
attempt 1: 2s
attempt 2: 2s
attempt 3: 2s
actual worst case: 6s + backoff
```

Lebih baik:

```text
total deadline: 1800ms
attempt 1: 600ms
backoff: 100ms
attempt 2: 500ms
backoff: 200ms
attempt 3: remaining budget
```

Dengan rule:

```text
if remainingBudget < minimumUsefulAttemptBudget:
    do not retry
```

### 5.4 Timeout Smell

Red flags:

- Timeout default library tidak diketahui.
- Semua downstream punya timeout sama.
- Retry tidak deadline-aware.
- Timeout dinaikkan untuk “fix” incident tanpa root cause.
- Tidak ada metric timeout per phase.
- Tidak ada cancellation propagation.
- Infinite read timeout.
- Pool acquisition bisa menunggu tanpa batas.

---

## 6. Final Retry Framework

Retry adalah alat tajam.

Retry bisa menyembuhkan transient failure, tetapi juga bisa memperbesar outage.

### 6.1 Retry Decision Matrix

| Kondisi | Retry? | Catatan |
|---|---:|---|
| DNS temporary failure | Kadang | Perlu backoff dan limit |
| Connect refused | Kadang | Mungkin instance down atau deploy |
| TLS cert invalid | Tidak | Biasanya config/security issue |
| Timeout sebelum request terkirim | Mungkin | Lebih aman |
| Timeout setelah body terkirim | Hati-hati | Side effect mungkin sudah terjadi |
| HTTP 408 | Mungkin | Deadline-aware |
| HTTP 429 | Mungkin | Hormati `Retry-After` |
| HTTP 500/502/503/504 | Mungkin | Idempotency wajib dipertimbangkan |
| HTTP 400 | Tidak | Caller bug/validation |
| HTTP 401 | Refresh token sekali | Jangan infinite refresh loop |
| HTTP 403 | Tidak | Authorization/config issue |
| HTTP 404 | Biasanya tidak | Kecuali eventual consistency documented |
| HTTP 409 | Biasanya tidak | Perlu domain conflict handling |
| Decode error | Tidak | Contract/schema issue |
| Business rejection | Tidak | Domain result, bukan retryable transport |

### 6.2 Retry Harus Punya

- [ ] Max attempt.
- [ ] Backoff.
- [ ] Jitter.
- [ ] Total deadline.
- [ ] Retryable classifier.
- [ ] Idempotency classifier.
- [ ] Observability per attempt.
- [ ] Respect `Retry-After`.
- [ ] Circuit breaker interaction.
- [ ] Test untuk duplicate side effect.

### 6.3 Retry Anti-Pattern

```java
while (true) {
    try {
        return call();
    } catch (Exception e) {
        Thread.sleep(1000);
    }
}
```

Masalah:

- infinite,
- tidak deadline-aware,
- tidak tahu error retryable atau tidak,
- tidak punya jitter,
- menyembunyikan incident,
- bisa membuat downstream makin mati.

---

## 7. Final Error Modelling Framework

Error HTTP client harus diklasifikasi, bukan disamaratakan.

### 7.1 Error Taxonomy Final

```text
ClientConfigError
  - invalid base URL
  - missing credential
  - invalid timeout config

ClientSecurityError
  - SSRF blocked
  - untrusted certificate
  - hostname verification failed
  - redirect blocked

ClientTransportError
  - DNS failure
  - connect failure
  - connection reset
  - timeout
  - TLS handshake failure

ClientProtocolError
  - malformed response
  - unsupported content type
  - invalid compression
  - invalid charset

ClientHttpStatusError
  - 4xx
  - 5xx
  - 429

ClientDecodeError
  - invalid JSON/XML
  - schema mismatch
  - enum unknown
  - date parse failure

ClientDomainError
  - business rejection
  - validation from remote
  - duplicate command
  - external conflict

ClientPolicyError
  - rate limited locally
  - bulkhead full
  - circuit open
  - deadline exhausted
```

### 7.2 Typed Result Pattern

Untuk client penting, pertimbangkan typed result:

```java
sealed interface ExternalCallResult<T> permits ExternalCallResult.Success,
        ExternalCallResult.RemoteRejected,
        ExternalCallResult.Unavailable,
        ExternalCallResult.Timeout,
        ExternalCallResult.Unauthorized,
        ExternalCallResult.Forbidden,
        ExternalCallResult.Conflict,
        ExternalCallResult.InvalidResponse {

    record Success<T>(T value) implements ExternalCallResult<T> {}
    record RemoteRejected<T>(String code, String message) implements ExternalCallResult<T> {}
    record Unavailable<T>(String reason) implements ExternalCallResult<T> {}
    record Timeout<T>(String phase) implements ExternalCallResult<T> {}
    record Unauthorized<T>() implements ExternalCallResult<T> {}
    record Forbidden<T>() implements ExternalCallResult<T> {}
    record Conflict<T>(String externalReference) implements ExternalCallResult<T> {}
    record InvalidResponse<T>(String reason) implements ExternalCallResult<T> {}
}
```

Untuk Java 8, sealed interface tidak tersedia, tetapi pola bisa dibuat dengan class hierarchy biasa.

### 7.3 Error Translation Principle

```text
transport error -> integration error
HTTP status -> external semantic error
external business error -> domain-safe rejection
local policy error -> caller-visible availability state
```

Jangan langsung lempar `RuntimeException` generik.

---

## 8. Final Observability Checklist

HTTP client tanpa observability adalah blind spot.

### 8.1 Logs

Log minimal:

- client name,
- operation name,
- method,
- route template, bukan full URL mentah,
- status/error class,
- duration,
- attempt number,
- retry decision,
- correlation ID,
- external reference jika aman,
- redacted diagnostic metadata.

Jangan log:

- access token,
- API key,
- password,
- private key,
- full PII body,
- sensitive query parameter,
- full signed URL,
- cookie/session header.

### 8.2 Metrics

Minimal metrics:

```text
http_client_request_duration_seconds
http_client_request_total
http_client_error_total
http_client_timeout_total
http_client_retry_attempt_total
http_client_retry_exhausted_total
http_client_circuit_state
http_client_bulkhead_rejected_total
http_client_rate_limited_total
http_client_pool_acquire_duration
http_client_active_requests
http_client_inflight_requests
```

Dimension/tag yang aman:

```text
client = payment-api
operation = verify-payment
method = POST
route = /v1/payments/{id}/verify
status_class = 2xx / 4xx / 5xx
error_class = timeout / dns / tls / decode / domain
attempt = first / retry
```

Hindari tag high-cardinality:

```text
full_url
customer_id
transaction_id
raw_error_message
request_body_hash jika terlalu unik
```

### 8.3 Tracing

Trace harus menunjukkan:

- parent operation,
- outbound call span,
- retry attempts jika perlu,
- downstream route,
- status/error classification,
- duration,
- correlation with logs.

Gunakan `traceparent`/trace context propagation untuk distributed tracing.

### 8.4 Observability Maturity Levels

```text
Level 0: no telemetry
Level 1: logs only
Level 2: logs + duration metric
Level 3: status/error/retry metrics
Level 4: distributed tracing + correlation
Level 5: phase-aware diagnostics + pool/concurrency visibility + runbook alerts
```

Target minimal production-critical client: **Level 4**.

Target top-tier subsystem: **Level 5**.

---

## 9. Final Security Checklist

Security HTTP client lebih luas dari HTTPS.

### 9.1 Destination Security

- [ ] Base URL tidak berasal dari input user mentah.
- [ ] Scheme allowlist: biasanya hanya `https`.
- [ ] Host allowlist untuk sensitive client.
- [ ] Port allowlist bila perlu.
- [ ] Redirect policy eksplisit.
- [ ] Redirect ke host/scheme berbeda divalidasi.
- [ ] DNS rebinding risk dipertimbangkan untuk user-controlled URL.
- [ ] Private IP/link-local/metadata endpoint diblokir untuk fetcher umum.

### 9.2 Credential Security

- [ ] Token tidak diletakkan di query string.
- [ ] Header `Authorization` selalu redacted.
- [ ] API key tidak masuk log.
- [ ] Secret loaded dari secret manager/config source aman.
- [ ] Secret rotation didukung.
- [ ] Token cache punya expiry skew.
- [ ] Token refresh single-flight untuk mencegah herd.

### 9.3 TLS Security

- [ ] Hostname verification aktif.
- [ ] Truststore jelas.
- [ ] mTLS keystore aman.
- [ ] Tidak ada trust-all manager di production.
- [ ] Certificate rotation plan ada.
- [ ] Certificate pinning hanya jika operationally justified.
- [ ] TLS failure tidak di-bypass dengan disable verification.

### 9.4 Payload Security

- [ ] Max response size.
- [ ] Max upload size.
- [ ] XML parser hardened.
- [ ] Unknown content type ditolak.
- [ ] Sensitive field redaction.
- [ ] Error body tidak ditampilkan mentah ke user.
- [ ] Compression bomb dipertimbangkan untuk untrusted payload.

### 9.5 Dependency Security

- [ ] Library version dipantau.
- [ ] CVE scan aktif.
- [ ] Transitive dependency dikontrol.
- [ ] Generated client tidak membawa dependency usang.

---

## 10. Final Testing Strategy

HTTP client test yang baik tidak hanya menguji happy path.

### 10.1 Test Pyramid untuk HTTP Client

```text
unit test
  - mapper
  - error classifier
  - policy decision
  - config validation

adapter test with mock server
  - request method/path/query/header/body
  - response mapping
  - error body mapping
  - retry behavior
  - timeout behavior

contract test
  - compatibility with provider schema
  - generated client compatibility
  - backward/forward compatibility

integration test
  - real auth sandbox
  - real TLS/proxy if needed
  - staging dependency

fault injection / chaos-style test
  - slow response
  - connection reset
  - malformed body
  - 429 with Retry-After
  - 500 burst
  - partial outage
```

### 10.2 Mandatory Test Cases

For production-critical client:

- [ ] 2xx success.
- [ ] 4xx domain/client error.
- [ ] 401 token refresh once.
- [ ] 403 no retry.
- [ ] 404 semantics clarified.
- [ ] 409 conflict mapping.
- [ ] 429 with `Retry-After`.
- [ ] 500/502/503/504 retry if safe.
- [ ] connect timeout.
- [ ] read/response timeout.
- [ ] malformed JSON/XML.
- [ ] unknown enum.
- [ ] missing required field.
- [ ] large body rejected/streamed.
- [ ] sensitive log redaction.
- [ ] correlation header propagated.
- [ ] idempotency key sent for command.
- [ ] no retry for non-repeatable body.
- [ ] circuit open behavior.
- [ ] bulkhead full behavior.

### 10.3 Test Smells

- Test mocks the client interface only and never verifies HTTP request.
- Test only checks success response.
- No test for timeout/retry/error.
- Test depends on real third-party API in normal unit CI.
- Test asserts exact timestamp/random ID without fixture control.
- Test logs real token.
- Test uses `Thread.sleep` excessively.
- Test cannot reproduce incident class.

---

## 11. Final Production Readiness Checklist

Sebelum HTTP client dianggap production-ready, pastikan:

### 11.1 Design

- [ ] Ada owner/client name.
- [ ] Ada operation list.
- [ ] Ada outbound port/interface.
- [ ] DTO eksternal terisolasi.
- [ ] Error model terdokumentasi.
- [ ] Retryability terdokumentasi per operation.
- [ ] Idempotency terdokumentasi untuk command.
- [ ] Fallback policy jelas.

### 11.2 Configuration

- [ ] Base URL per environment.
- [ ] Timeout per client/operation.
- [ ] Pool/concurrency limit.
- [ ] Retry config.
- [ ] Rate limit/bulkhead/circuit config.
- [ ] Auth config.
- [ ] Secret source.
- [ ] TLS/proxy config.
- [ ] Startup validation.
- [ ] Effective config bisa dilihat secara aman.

### 11.3 Runtime

- [ ] Client instance reused.
- [ ] Response body selalu ditutup/dikonsumsi.
- [ ] Connection pool tidak bocor.
- [ ] Executor/threading jelas.
- [ ] Cancellation didukung.
- [ ] Shutdown lifecycle jelas jika client punya resource.

### 11.4 Resilience

- [ ] Timeout lengkap.
- [ ] Retry deadline-aware.
- [ ] Backoff+jitter.
- [ ] Circuit breaker untuk dependency kritis.
- [ ] Bulkhead/concurrency limit.
- [ ] Rate limit jika downstream membatasi.
- [ ] Fallback tidak menyembunyikan data correctness issue.

### 11.5 Security

- [ ] HTTPS enforced.
- [ ] TLS verification tidak dimatikan.
- [ ] Credential redacted.
- [ ] Sensitive URL/query tidak dilog.
- [ ] Redirect controlled.
- [ ] SSRF defense untuk dynamic URL.
- [ ] XML/deserialization hardened.

### 11.6 Observability

- [ ] Metrics tersedia.
- [ ] Logs structured dan redacted.
- [ ] Tracing propagated.
- [ ] Correlation ID propagated.
- [ ] Retry/circuit/bulkhead visible.
- [ ] Dashboard ada.
- [ ] Alert ada.

### 11.7 Testing

- [ ] Mock server tests.
- [ ] Error tests.
- [ ] Timeout/retry tests.
- [ ] Contract tests.
- [ ] Security tests.
- [ ] Regression fixtures dari incident.

### 11.8 Operations

- [ ] Runbook ada.
- [ ] Known failure modes terdokumentasi.
- [ ] Rollback plan ada.
- [ ] Dependency SLA diketahui.
- [ ] Escalation path jelas.
- [ ] Sandbox/staging endpoint tersedia.

---

## 12. Final Design Review Questions

Saat mereview HTTP client, tanyakan:

### 12.1 Boundary

- Apa nama client dan operation-nya?
- Apakah ini third-party, internal service, atau public API?
- Apakah caller melihat domain result atau HTTP detail?
- Apakah DTO eksternal bocor?
- Apakah error remote diterjemahkan dengan benar?

### 12.2 Semantics

- Operation ini read atau command?
- Apakah idempotent?
- Apakah retry aman?
- Apa arti 404?
- Apa arti 409?
- Apa arti 202?
- Apa arti empty body?
- Apakah success HTTP selalu success domain?

### 12.3 Resilience

- Timeout total berapa?
- Timeout per phase berapa?
- Retry berapa kali?
- Backoff dan jitter ada?
- Apa yang terjadi saat downstream lambat?
- Apa yang terjadi saat downstream return 429?
- Apa yang terjadi saat token expired bersamaan di banyak thread?
- Apa yang terjadi saat circuit open?

### 12.4 Resource

- Apakah client reused?
- Apakah pool bounded?
- Apakah concurrency bounded?
- Apakah response body selalu ditutup?
- Apakah body besar di-stream?
- Apakah executor aman?
- Apakah virtual threads dipakai dengan benar?

### 12.5 Security

- Dari mana base URL berasal?
- Apakah user bisa mengontrol URL?
- Apakah redirect aman?
- Apakah token bisa bocor ke log?
- Apakah TLS diverifikasi?
- Apakah mTLS certificate rotation dipikirkan?

### 12.6 Observability

- Metric apa yang tersedia?
- Bagaimana membedakan DNS, connect, TLS, timeout, 4xx, 5xx, decode?
- Apakah route metric low-cardinality?
- Apakah trace context dipropagasi?
- Apakah retry attempts terlihat?

### 12.7 Testing

- Apakah request path/query/header/body diverifikasi?
- Apakah timeout diuji?
- Apakah 429 diuji?
- Apakah malformed response diuji?
- Apakah duplicate command diuji?
- Apakah log redaction diuji?

---

## 13. Final Incident Diagnosis Framework

Saat incident terjadi, jangan langsung menaikkan timeout atau restart aplikasi.

Gunakan urutan diagnosis:

```text
1. Scope
2. Symptom
3. Phase
4. Blast radius
5. Recent change
6. Resource pressure
7. Downstream state
8. Mitigation
9. Evidence preservation
10. Postmortem
```

### 13.1 Symptom → Likely Cause

| Symptom | Kemungkinan |
|---|---|
| Banyak DNS error | DNS resolver, CoreDNS, JVM cache, hostname typo |
| Connect timeout | network path, LB, security group, downstream down |
| TLS handshake error | cert expired, truststore, hostname, mTLS key/cert |
| Read timeout naik | downstream lambat, query lambat, payload besar |
| Pool acquire timeout | connection leak, pool kecil, downstream lambat, concurrency spike |
| 429 naik | rate limit upstream, retry storm, batch spike |
| 401 spike | token expired, auth server issue, refresh bug |
| 5xx spike | downstream incident, deployment, overload |
| Decode error | contract drift, wrong content-type, partial response |
| Thread count naik | blocking call menunggu, no timeout, slow downstream |
| CPU naik | JSON parsing, retry storm, logging body besar, TLS churn |
| Memory naik | buffering large response, body retained, queue buildup |

### 13.2 Safe Mitigation

Lebih aman:

- turunkan concurrency,
- aktifkan/ketatkan circuit breaker,
- kurangi retry,
- tambah jitter,
- hormati 429,
- disable non-critical feature,
- gunakan fallback read-only jika aman,
- rollback perubahan endpoint/config,
- isolate traffic class.

Berbahaya jika dilakukan tanpa bukti:

- menaikkan timeout besar-besaran,
- menaikkan retry attempt,
- menaikkan thread pool tanpa limit,
- mematikan TLS verification,
- mematikan circuit breaker,
- restart terus-menerus tanpa evidence,
- bypass rate limiter.

---

## 14. Top 1% Engineering Heuristics

Bagian ini adalah ringkasan perilaku berpikir yang membedakan engineer biasa dari engineer top-tier dalam HTTP client engineering.

### 14.1 Think in Failure Modes, Not Happy Path

Engineer biasa bertanya:

> Bagaimana cara call API ini?

Engineer matang bertanya:

> Bagaimana API ini gagal, bagaimana kita tahu, dan bagaimana sistem tetap terkendali?

Untuk setiap client operation, pikirkan:

```text
What if DNS fails?
What if connect hangs?
What if TLS cert rotates?
What if response is 200 but body means rejected?
What if token expires across 500 concurrent requests?
What if downstream is slow but not dead?
What if retry duplicates command?
What if response body is 500 MB?
What if schema adds unknown enum?
What if route returns HTML error page?
```

### 14.2 Make Implicit Behavior Explicit

Banyak bug muncul karena behavior library tidak diketahui.

Jadikan eksplisit:

- timeout,
- redirect,
- retry,
- connection pool,
- proxy,
- TLS,
- auth refresh,
- error mapping,
- body size,
- logging redaction.

Default library boleh dipakai, tetapi harus diketahui.

### 14.3 Separate Semantics from Mechanism

Mechanism:

```text
GET /v1/customer/123
HTTP 404
SocketTimeoutException
Retry-After: 10
```

Semantics:

```text
customer not found
remote unavailable
deadline exhausted
caller should retry later
```

Top-tier client selalu punya layer translation.

### 14.4 Bound Everything

Unbounded system eventually fails.

Bound:

- timeout,
- retry,
- concurrency,
- queue,
- body size,
- pool size,
- cache size,
- token refresh concurrency,
- fan-out parallelism,
- log volume.

### 14.5 Retry is Load

Retry bukan free reliability.

Retry = additional traffic.

Jika downstream sedang overload, retry bisa menjadi serangan dari sistem sendiri.

Top-tier design selalu menggabungkan:

```text
retry + backoff + jitter + deadline + circuit breaker + rate/concurrency control
```

### 14.6 Observability is Part of the API

Client yang tidak bisa didiagnosis belum selesai.

Design output bukan hanya code.

Design output juga:

- metrics,
- logs,
- traces,
- dashboard,
- alert,
- runbook,
- test fixture.

### 14.7 Preserve Domain Integrity

External API sering berubah, tidak konsisten, atau punya model yang berbeda.

Jangan biarkan external model menjadi domain model.

Gunakan anti-corruption layer.

### 14.8 Treat Configuration as Code-adjacent Logic

Config bukan hal kecil.

Config menentukan:

- endpoint,
- timeout,
- retry,
- concurrency,
- TLS,
- auth,
- circuit,
- rate limit.

Config yang salah bisa lebih berbahaya dari bug code.

Maka config harus:

- typed,
- validated,
- observable,
- versioned,
- reviewed,
- safely reloadable jika dinamis.

### 14.9 Design for Migration

Library akan berubah.

Endpoint akan berubah.

Auth scheme akan berubah.

Generated client akan berubah.

Jangan membuat seluruh codebase tergantung langsung pada transport library.

Gunakan port/adapter/wrapper.

### 14.10 Turn Incidents into Regression Tests

Setiap incident HTTP client harus menghasilkan minimal satu dari:

- new metric,
- new alert,
- new test fixture,
- new timeout policy,
- new error classifier,
- new runbook step,
- new dashboard panel,
- new security guardrail.

Kalau tidak, incident yang sama akan kembali.

---

## 15. Final Comparison: Ordinary vs Production-Grade vs Top-Tier

| Area | Ordinary | Production-Grade | Top-Tier |
|---|---|---|---|
| API call | Direct call in service | Dedicated client adapter | Domain port + governed integration boundary |
| Timeout | One default value | Per client/operation timeout | Deadline budget with phase-aware reasoning |
| Retry | Retry all exceptions | Retry classifier + backoff | Retry budget + idempotency + observability + circuit integration |
| Error | Generic exception | Error taxonomy | Typed semantic result + audit-safe diagnostics |
| Auth | Add header | Token provider/cache | Single-flight refresh + rotation + redaction |
| Pooling | Unknown | Reused client/pool | Pool sizing tied to concurrency/latency model |
| Body | String/byte[] everywhere | Stream large body | Size policy + parser strategy + security guard |
| Security | HTTPS | TLS + redaction + secret handling | SSRF/redirect/DNS/proxy/TLS threat model |
| Observability | Some logs | Logs + metrics + traces | Phase-aware diagnosis + low-cardinality telemetry + runbook |
| Testing | Happy path | Mock server + error tests | Fault injection + contract + incident regression |
| Operations | Restart on issue | Runbook | Evidence-driven mitigation + feedback loop |
| Migration | Big bang | Wrapper/strangler | Dual-run/shadow/feature flag/governance |

---

## 16. Final Reference Implementation Shape

A mature client often has this shape:

```java
public interface ExternalCustomerPort {
    CustomerLookupResult findCustomer(CustomerLookupQuery query);
}
```

```java
public final class CustomerHttpAdapter implements ExternalCustomerPort {
    private final CustomerTransport transport;
    private final CustomerRequestMapper requestMapper;
    private final CustomerResponseMapper responseMapper;
    private final CustomerErrorMapper errorMapper;
    private final ExternalCallPolicy policy;
    private final CustomerClientTelemetry telemetry;

    @Override
    public CustomerLookupResult findCustomer(CustomerLookupQuery query) {
        return policy.execute("customer.find", () -> {
            var request = requestMapper.toRequest(query);
            var rawResponse = transport.execute(request);
            return responseMapper.toDomain(rawResponse);
        }, errorMapper::toDomainError, telemetry);
    }
}
```

Transport bisa JDK/OkHttp/Retrofit/Apache.

Domain tidak peduli.

Policy bisa berkembang.

Testing bisa fokus per layer.

Observability bisa konsisten.

Migration lebih aman.

---

## 17. Java 8–25 Final Guidance

### Java 8

Pilihan realistis:

- OkHttp,
- Retrofit,
- Apache HttpClient 5,
- Spring RestTemplate legacy,
- async via CompletableFuture/custom executor.

Perhatian:

- tidak ada JDK `HttpClient` modern,
- tidak ada virtual threads,
- concurrency harus sangat disiplin dengan thread pools,
- wrapper architecture penting untuk future migration.

### Java 11–17

Pilihan bertambah:

- JDK `java.net.http.HttpClient`,
- OkHttp/Retrofit tetap kuat,
- Apache 5 untuk enterprise,
- Spring RestClient/WebClient tergantung versi Spring.

Perhatian:

- async `CompletableFuture` bisa dipakai,
- jangan membuat async pipeline tanpa cancellation/deadline,
- dependency minimal bisa memakai JDK client.

### Java 21–25

Pilihan modern:

- blocking client + virtual threads untuk banyak I/O-bound use case,
- JDK HttpClient semakin menarik,
- Spring RestClient + virtual threads bisa sederhana dan scalable,
- reactive tetap relevan untuk pipeline reactive/streaming.

Perhatian:

- virtual threads bukan pengganti timeout/concurrency limit,
- pinning/blocking native/monitor tertentu tetap perlu dipahami,
- structured concurrency membantu fan-out/fan-in reasoning.

---

## 18. Final Learning Map Setelah Seri Ini

Setelah menyelesaikan seri ini, lanjutan yang paling natural adalah:

1. **Service-to-service resilience engineering**
   - service mesh,
   - adaptive concurrency,
   - load shedding,
   - retry budgets at platform level.

2. **API governance and contract lifecycle**
   - OpenAPI governance,
   - backward compatibility,
   - consumer-driven contract,
   - SDK versioning.

3. **Distributed tracing and production diagnostics**
   - OpenTelemetry deep dive,
   - span/metric design,
   - trace-based debugging,
   - incident reconstruction.

4. **Java concurrency for distributed systems**
   - virtual threads,
   - structured concurrency,
   - cancellation,
   - rate/concurrency control.

5. **Security for outbound integration**
   - SSRF defense,
   - mTLS operations,
   - secret rotation,
   - zero trust service identity.

6. **Performance profiling for integration-heavy systems**
   - flame graph,
   - allocation profiling,
   - tail latency,
   - GC impact,
   - load test design.

---

## 19. Final Summary

HTTP client engineering yang matang bukan tentang tahu banyak library.

Itu tentang mengontrol boundary antar sistem.

Seorang engineer yang kuat bisa melihat HTTP call sebagai:

```text
remote dependency
+ unreliable network
+ security boundary
+ protocol contract
+ resource consumer
+ latency contributor
+ failure amplifier
+ observability source
+ architectural seam
```

Kalau hanya menulis:

```java
client.get(url)
```

itu beginner-level.

Kalau bisa menjawab:

```text
Apa timeout budget-nya?
Apa retry semantics-nya?
Apa idempotency guarantee-nya?
Apa pool/concurrency bound-nya?
Apa error taxonomy-nya?
Apa redaction policy-nya?
Apa telemetry-nya?
Apa test matrix-nya?
Apa incident playbook-nya?
Apa migration path-nya?
```

itu engineering-level.

Kalau bisa membuat semua jawaban itu menjadi reusable framework untuk tim, system, dan organization, itu mendekati top-tier engineering.

---

## 20. Completion Status

Seri ini selesai.

Total:

```text
Part 0  — Orientation: HTTP Client sebagai Production Subsystem, Bukan Utility
Part 1  — Java HTTP Client Landscape di Java 8–25
Part 2  — Request Lifecycle Deep Dive: Dari Method Call Sampai Response Body
Part 3  — URI, URL, Encoding, Query Parameter, dan Canonical Request
Part 4  — Headers, Content Negotiation, Compression, dan Metadata Contract
Part 5  — Body Handling: JSON, Form, Multipart, Streaming, File Upload/Download
Part 6  — Timeout Engineering: Connect, Read, Write, Call, Pool, DNS, TLS
Part 7  — Connection Pooling, Keep-Alive, HTTP/2 Multiplexing, dan Resource Reuse
Part 8  — DNS, Proxy, Load Balancer, NAT, dan Network Topology Awareness
Part 9  — TLS, mTLS, Trust Store, Key Store, ALPN, Certificate Pinning
Part 10 — Authentication Client-Side: Basic, Bearer, OAuth2, API Key, HMAC, Token Refresh
Part 11 — Retry Engineering: Idempotency, Backoff, Jitter, Retry Budget, dan Hedging
Part 12 — Rate Limiting, Throttling, Bulkhead, dan Client-Side Load Shedding
Part 13 — Circuit Breaker, Timeout, Retry, dan Fallback Composition
Part 14 — JDK HttpClient Deep Dive
Part 15 — OkHttp Deep Dive: Client, Dispatcher, Interceptor, ConnectionPool
Part 16 — Retrofit Deep Dive: Type-Safe API Client di Atas OkHttp
Part 17 — Apache HttpClient 5 Deep Dive
Part 18 — Spring HTTP Client Layer: RestTemplate, WebClient, RestClient
Part 19 — API Client Architecture: Port, Adapter, Gateway, SDK, Anti-Corruption Layer
Part 20 — Error Modelling: Status Code, Transport Failure, Protocol Failure, Domain Failure
Part 21 — Observability: Logging, Metrics, Tracing, Correlation, Redaction
Part 22 — Testing HTTP Clients: Unit, Contract, Integration, Chaos, Mock Server
Part 23 — JSON/XML Mapping for HTTP Client Boundary
Part 24 — Performance Engineering: Throughput, Latency, Allocation, GC, Threading
Part 25 — Virtual Threads, CompletableFuture, Reactive, dan Structured Concurrency
Part 26 — Security Hardening for HTTP Clients
Part 27 — Generated Clients: OpenAPI, Codegen, SDK Governance
Part 28 — Client Configuration Management: Environment, Tenant, Endpoint, Secret, Feature Flag
Part 29 — Production Failure Playbook: Diagnosis and Incident Response
Part 30 — Migration Patterns: Legacy Client ke Modern Client
Part 31 — Advanced Patterns: Fan-Out Aggregator, Token Single-Flight, Client-Side Cache, Idempotent Command
Part 32 — Case Study: Building a Production-Grade Third-Party API Client
Part 33 — Case Study: Internal Microservice Client at Scale
Part 34 — Final Synthesis: Decision Framework, Checklist, and Top 1% Engineering Heuristics
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 33 — Case Study: Internal Microservice Client at Scale](./33-case-study-internal-microservice-client-at-scale.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Orientation: Data Transformation as Software Boundary](../mapper/00-orientation-data-transformation-as-software-boundary.md)

# Part 35 — Capstone: Building a Production-Grade Java Network Client and Service Platform

> Seri: `learn-java-io-network-http-grpc-protocol-engineering`  
> Bagian: `035-capstone-production-grade-java-network-client-and-service-platform.md`  
> Target: Java 8–25  
> Level: Advanced / Staff+ / Top 1% Software Engineer Orientation

---

## 0. Posisi Bagian Ini dalam Seri

Ini adalah bagian penutup dari seri **Java IO Network, HTTP, gRPC, and Protocol Engineering**.

Bagian ini tidak bertujuan memperkenalkan API baru secara terpisah. Tujuannya adalah menyatukan seluruh materi sebelumnya menjadi satu rancangan yang bisa dipakai untuk membangun **production-grade communication platform** di Java.

Setelah menyelesaikan bagian ini, kamu diharapkan tidak hanya bisa membuat HTTP client atau gRPC client, tetapi bisa merancang lapisan komunikasi yang:

1. eksplisit secara kontrak,
2. aman secara failure semantics,
3. observable,
4. testable,
5. resilient tanpa menjadi agresif,
6. kompatibel lintas versi,
7. bisa diaudit,
8. bisa dioperasikan oleh tim,
9. tidak menyebarkan detail network secara liar ke seluruh codebase,
10. dapat berkembang dari Java 8 sampai Java 25.

Ini adalah perbedaan antara engineer yang “bisa call API” dan engineer yang bisa merancang **networked system boundary**.

---

## 1. Problem Besar yang Kita Pecahkan

Dalam banyak codebase enterprise, komunikasi antar-sistem tumbuh secara organik:

```text
service A langsung pakai RestTemplate
service B pakai WebClient
service C pakai Apache HttpClient
service D pakai JDK HttpClient
service E pakai gRPC stub langsung
service F punya retry sendiri
service G punya timeout sendiri
service H log payload sembarangan
service I tidak punya idempotency key
service J tidak punya tracing
```

Awalnya terlihat fleksibel. Dalam jangka panjang, ini berubah menjadi masalah arsitektural:

```text
Tidak ada satu tempat untuk mengatur timeout.
Tidak ada satu standar retry.
Tidak ada konsistensi error mapping.
Tidak tahu call mana yang idempotent.
Tidak tahu dependency mana yang sedang lambat.
Tidak tahu pool mana yang penuh.
Tidak tahu apakah request gagal sebelum atau setelah side effect.
Tidak tahu apakah 504 berasal dari gateway, service, database, atau retry storm.
Tidak tahu apakah log aman dari secret/PII.
Tidak tahu apakah perubahan contract akan merusak consumer.
```

Top-tier engineer melihat ini bukan sebagai masalah “library HTTP”, tetapi sebagai masalah **platform boundary**.

---

## 2. Target Capstone

Kita akan merancang satu platform komunikasi internal bernama:

```text
Java Network Communication Platform
```

Nama module contoh:

```text
com.company.platform.network
```

Atau dalam struktur multi-module:

```text
platform-network-core
platform-network-http
platform-network-grpc
platform-network-resilience
platform-network-observability
platform-network-testkit
platform-network-spring-boot
```

Platform ini menyediakan:

```text
1. HTTP client foundation
2. gRPC channel/stub foundation
3. typed client SDK pattern
4. deadline and timeout policy
5. retry and idempotency policy
6. circuit breaker / bulkhead / rate limiter hooks
7. TLS/mTLS configuration model
8. proxy/gateway/load balancer awareness
9. request context propagation
10. logs, metrics, traces
11. safe error model
12. large payload strategy
13. testing utilities
14. production diagnostics
15. governance rules
```

Tujuannya bukan membuat framework besar yang mengunci semua tim. Tujuannya adalah membuat **bounded communication layer** yang menjaga invariants dan menghilangkan variasi berbahaya.

---

## 3. Prinsip Utama

### 3.1 Network Call adalah Distributed Attempt

Setiap outbound call harus dipahami sebagai attempt, bukan function call biasa.

```text
Local method call:
- address known
- memory shared
- failure usually exception or return value
- duration usually small
- no partial side effect over network

Network call:
- name resolution may fail
- connection may fail
- TLS may fail
- request write may partially succeed
- server may process but response lost
- gateway may retry or timeout
- client may retry
- remote side effect may already happen
- response may not prove the absence/presence of side effect
```

Karena itu, setiap call membutuhkan explicit policy:

```text
deadline
retryability
idempotency
authentication
authorization
observability
error mapping
resource budget
payload limit
cancellation behavior
```

### 3.2 Transport Failure Bukan Domain Failure

Jangan mencampur error transport dengan error bisnis.

Contoh buruk:

```java
throw new CaseApprovalFailedException("Connection timed out");
```

Masalahnya: `CaseApprovalFailedException` terdengar seperti keputusan domain bahwa approval gagal. Padahal mungkin dependency tidak bisa dihubungi.

Model yang lebih benar:

```text
Domain failure:
- CASE_NOT_ELIGIBLE
- CASE_ALREADY_APPROVED
- APPROVAL_WINDOW_CLOSED
- INVALID_CASE_STATE

Transport failure:
- DNS_FAILURE
- CONNECT_TIMEOUT
- TLS_FAILURE
- DEADLINE_EXCEEDED
- CONNECTION_RESET
- REMOTE_UNAVAILABLE

Integration failure:
- REMOTE_CONTRACT_VIOLATION
- REMOTE_RATE_LIMITED
- REMOTE_REJECTED
- REMOTE_AUTH_FAILED
```

Top-tier engineer menjaga pemisahan ini karena berdampak pada retry, audit, SLA, alert, dan user experience.

### 3.3 Timeout Harus Hierarkis

Timeout bukan satu angka tunggal.

```text
overall deadline
  ├─ queue/pool acquisition budget
  ├─ DNS budget
  ├─ connect budget
  ├─ TLS handshake budget
  ├─ request write budget
  ├─ first byte budget
  ├─ response body budget
  └─ retry/backoff budget
```

Tanpa hierarki, sistem mudah mengalami:

```text
thread starvation
retry storm
request menunggu lebih lama dari SLA caller
server tetap bekerja setelah client menyerah
pool penuh karena call terlalu lama
p99 meledak tanpa p50 berubah
```

### 3.4 Retry Harus Semantic, Bukan Refleks

Retry yang benar membutuhkan jawaban atas pertanyaan ini:

```text
Apakah request sudah sampai remote server?
Apakah remote server sudah memprosesnya?
Apakah operasi idempotent?
Apakah ada idempotency key?
Apakah body bisa dikirim ulang?
Apakah deadline masih cukup?
Apakah retry akan memperburuk overload?
Apakah remote memberi Retry-After atau pushback?
Apakah layer lain sudah retry?
```

Retry tanpa idempotency adalah bom waktu.

### 3.5 Pool dan Channel adalah Capacity Boundary

Connection pool bukan detail performa kecil. Ia adalah boundary kapasitas.

```text
Too small:
- queueing
- artificial latency
- pool acquisition timeout

Too large:
- remote overload
- file descriptor pressure
- ephemeral port pressure
- load balancer pressure
- TLS handshake burst
```

HTTP/1.1, HTTP/2, dan gRPC punya model kapasitas berbeda:

```text
HTTP/1.1:
- concurrency roughly tied to number of connections

HTTP/2:
- multiple streams per connection
- but max concurrent streams can queue

 gRPC:
- channel abstraction
- underlying HTTP/2 connection/subchannel
- stream concurrency and load balancing matter
```

### 3.6 Observability adalah Kontrak, Bukan Setelahnya

Setiap outbound call harus bisa menjawab:

```text
Siapa caller-nya?
Dependency apa yang dipanggil?
Endpoint/method apa?
Operation id apa?
Deadline berapa?
Timeout fase mana?
Retry attempt ke berapa?
Status remote apa?
Exception lokal apa?
Pool wait berapa?
DNS/connect/TLS/body phase terlihat atau tidak?
Trace id apa?
Correlation id apa?
Idempotency key apa?
Payload size berapa?
Response size berapa?
```

Kalau sistem tidak bisa menjawab ini saat incident, berarti design observability belum selesai.

---

## 4. Architecture Blueprint

High-level architecture:

```text
Application Service
   |
   | calls typed port/interface
   v
Domain-facing Client SDK
   |
   | maps domain request/result
   v
Integration Adapter
   |
   | applies contract mapping, error mapping, idempotency semantics
   v
Network Platform Layer
   |
   | timeout, retry, circuit breaker, tracing, metrics, logging, TLS, proxy
   v
Transport Implementation
   |
   | JDK HttpClient / Apache HttpClient / OkHttp / Netty / gRPC Channel
   v
Network Path
   |
   | proxy / gateway / service mesh / LB / remote service
   v
Remote System
```

Key idea:

```text
Business code should not know transport details.
Transport code should not know business policy beyond metadata supplied by adapter.
Policy should be explicit, typed, testable, and observable.
```

---

## 5. Module Design

### 5.1 `platform-network-core`

Berisi abstraction umum:

```text
NetworkDependency
NetworkOperation
NetworkRequestContext
Deadline
Attempt
IdempotencyKey
CorrelationContext
NetworkResult
NetworkException
RemoteError
PayloadPolicy
RetryPolicy
TimeoutPolicy
ResiliencePolicy
```

Contoh model:

```java
public final class NetworkOperation {
    private final String dependencyName;
    private final String operationName;
    private final boolean idempotent;
    private final boolean sideEffecting;
    private final PayloadClass payloadClass;
    private final RetryPolicy retryPolicy;
    private final TimeoutPolicy timeoutPolicy;

    // constructor/getters omitted
}
```

Contoh dependency:

```java
public final class NetworkDependency {
    private final String name;
    private final URI baseUri;
    private final DependencyCriticality criticality;
    private final AuthMode authMode;
    private final TransportKind transportKind;

    // constructor/getters omitted
}
```

Kita ingin setiap outbound operation punya identity stabil:

```text
dependency = "payment-service"
operation  = "CreatePaymentInstruction"
transport  = HTTP
method     = POST
idempotent = true with idempotency key
criticality = HIGH
```

Identity ini dipakai oleh:

```text
metrics label
trace span name
log field
retry policy
dashboard
alert routing
runbook
```

### 5.2 `platform-network-http`

Berisi HTTP-specific abstraction:

```text
HttpEndpoint
HttpRequestSpec
HttpResponseMapper
HttpErrorMapper
HttpBodyStrategy
HttpHeaderPolicy
HttpClientFacade
```

Contoh:

```java
public interface HttpClientFacade {
    <T> NetworkResult<T> execute(
        NetworkOperation operation,
        HttpRequestSpec request,
        HttpResponseMapper<T> mapper,
        NetworkRequestContext context
    );
}
```

Untuk Java 11+, implementasi bisa memakai `java.net.http.HttpClient`. Java `HttpClient` modern dibuat melalui builder, immutable setelah dibangun, dapat dipakai untuk banyak request, dan dapat dikonfigurasi untuk preferred protocol version HTTP/1.1 atau HTTP/2, redirect, proxy, authenticator, dan connect timeout.

Untuk Java 8, implementasi bisa memakai:

```text
Apache HttpClient 4/5
OkHttp
Netty
Spring RestTemplate dengan request factory yang benar
```

Yang penting bukan library-nya, tetapi policy-nya konsisten.

### 5.3 `platform-network-grpc`

Berisi gRPC-specific abstraction:

```text
GrpcChannelFactory
GrpcStubFactory
GrpcCallPolicy
GrpcErrorMapper
GrpcMetadataPropagator
GrpcDeadlinePropagator
GrpcStreamingGuard
```

Contoh:

```java
public interface GrpcClientFactory {
    <S> S createStub(
        String dependencyName,
        Class<S> stubType,
        GrpcClientPolicy policy
    );
}
```

gRPC Java menggunakan `ManagedChannel` sebagai abstraction koneksi/client-side transport. Channel harus dikelola sebagai resource jangka panjang, bukan dibuat per request. gRPC juga menyediakan mekanisme deadline, retry, hedging, service config, name resolution, load balancing, metadata, health checking, dan status code model.

### 5.4 `platform-network-resilience`

Berisi integrasi:

```text
RetryExecutor
CircuitBreakerAdapter
RateLimiterAdapter
BulkheadAdapter
AdaptiveConcurrencyLimiter
DeadlineAwareScheduler
```

Aturan penting:

```text
Retry tidak boleh terjadi tanpa deadline.
Retry tidak boleh terjadi tanpa classification.
Retry side-effecting operation harus membutuhkan idempotency key.
Circuit breaker harus melihat failure yang benar, bukan semua 4xx.
Rate limiter harus bisa memberi rejection yang jelas.
Bulkhead harus per dependency, bukan global saja.
```

### 5.5 `platform-network-observability`

Berisi:

```text
NetworkSpanFactory
NetworkMetricsRecorder
SafeLogger
PayloadRedactor
ContextPropagator
AttemptEventPublisher
```

OpenTelemetry Java menyediakan API/SDK dan instrumentation untuk menghasilkan telemetry seperti traces, metrics, dan logs. OpenTelemetry Java agent juga dapat dipasang pada aplikasi Java 8+ untuk auto-instrumentation tanpa perubahan kode besar.

### 5.6 `platform-network-testkit`

Berisi utility testing:

```text
FakeHttpServer
FakeGrpcServer
FaultScript
LatencyInjector
RetryAssert
TraceAssert
ContractFixture
GoldenPayload
TlsTestCertificateFactory
LargePayloadFixture
```

Tujuannya agar test outbound client tidak sekadar mock method call, tetapi bisa menguji behavior network:

```text
connect refused
slow response
partial response
malformed JSON
HTTP 429 Retry-After
HTTP 503
connection reset
TLS cert invalid
gRPC UNAVAILABLE
gRPC DEADLINE_EXCEEDED
server streaming slow consumer
large file response
```

---

## 6. Core Domain Model untuk Network Platform

### 6.1 `NetworkRequestContext`

Context harus membawa metadata lintas layer:

```java
public final class NetworkRequestContext {
    private final String correlationId;
    private final String traceId;
    private final String caller;
    private final Deadline deadline;
    private final Optional<String> idempotencyKey;
    private final Map<String, String> baggage;

    // constructor/getters omitted
}
```

Jangan gunakan `ThreadLocal` sembarangan tanpa strategi propagation. Pada Java modern, virtual threads dan structured concurrency mengubah cara context dibawa. Untuk Java 25, scoped values dapat menjadi pilihan untuk context immutable yang aman dibagikan ke callees dan child threads, tetapi platform harus tetap punya abstraction agar kompatibel dengan Java 8–25.

### 6.2 `Deadline`

Deadline lebih kuat daripada timeout karena deadline memiliki absolute budget.

```java
public final class Deadline {
    private final Instant expiresAt;

    public Duration remaining(Clock clock) {
        Duration remaining = Duration.between(clock.instant(), expiresAt);
        return remaining.isNegative() ? Duration.ZERO : remaining;
    }

    public boolean isExpired(Clock clock) {
        return !remaining(clock).isPositive();
    }
}
```

Policy:

```text
Inbound request receives or creates deadline.
Each outbound call receives remaining budget.
Retry consumes from same budget.
Backoff cannot exceed remaining budget.
Server work should stop when deadline expires.
```

### 6.3 `NetworkResult`

Jangan paksa semua menjadi exception. Untuk client SDK, sering lebih baik punya typed result:

```java
public sealed interface NetworkResult<T> permits NetworkSuccess, NetworkFailure {
}

public final class NetworkSuccess<T> implements NetworkResult<T> {
    private final T value;
    private final ResponseMetadata metadata;
}

public final class NetworkFailure<T> implements NetworkResult<T> {
    private final NetworkError error;
    private final AttemptSummary attempts;
}
```

Untuk Java 8, sealed interface belum tersedia. Alternatif:

```text
abstract class NetworkResult<T>
final class NetworkSuccess<T> extends NetworkResult<T>
final class NetworkFailure<T> extends NetworkResult<T>
```

### 6.4 `NetworkError`

Error taxonomy:

```text
NameResolutionFailure
ConnectionFailure
TlsFailure
PoolExhausted
TimeoutFailure
DeadlineExceeded
RemoteUnavailable
RemoteRateLimited
RemoteRejected
RemoteContractViolation
PayloadTooLarge
SerializationFailure
DeserializationFailure
CancellationFailure
UnknownNetworkFailure
```

Setiap error harus membawa:

```text
dependency
operation
attempt count
phase
retryable?
idempotent?
remote status if any
exception class
safe message
correlation id
trace id
```

Contoh:

```java
public final class NetworkError {
    private final String dependency;
    private final String operation;
    private final NetworkPhase phase;
    private final NetworkErrorKind kind;
    private final boolean retryable;
    private final Optional<Integer> httpStatus;
    private final Optional<String> grpcStatus;
    private final String safeMessage;
}
```

---

## 7. Timeout and Deadline Design

### 7.1 Policy Template

Contoh policy dependency:

```yaml
network:
  dependencies:
    case-profile-service:
      transport: http
      baseUrl: https://case-profile.internal
      connectTimeout: 300ms
      requestTimeout: 1500ms
      maxAttempts: 2
      backoff:
        initial: 50ms
        max: 150ms
        jitter: full
      pool:
        maxConnections: 100
        maxPending: 200
        acquisitionTimeout: 100ms
      circuitBreaker:
        failureRateThreshold: 50
        slowCallThreshold: 1000ms
        minimumCalls: 50
```

Namun jangan hanya punya YAML. Harus ada semantic validation:

```text
requestTimeout <= operation deadline
backoff max < requestTimeout
maxAttempts tidak boleh membuat total worst-case melewati SLA
sideEffecting operation membutuhkan idempotency key jika retry enabled
pool max tidak boleh melebihi remote agreed concurrency
```

### 7.2 Deadline Propagation

HTTP header contoh:

```text
X-Request-Deadline: 2026-06-18T09:45:10.123Z
X-Request-Timeout-Ms: 1200
```

gRPC:

```text
gRPC deadline memakai mekanisme native deadline.
Client stub diberi withDeadlineAfter(...).
Server context cancellation harus dicek pada operasi panjang.
```

gRPC documentation menekankan deadline agar client membatasi berapa lama menunggu call selesai; server dapat membatalkan call saat deadline dari client terlewati.

### 7.3 Java 8–25 Implementation Strategy

```text
Java 8:
- Apache HttpClient / OkHttp timeout controls
- CompletableFuture with explicit scheduler
- manual context propagation

Java 11+:
- JDK HttpClient connectTimeout and request timeout
- sendAsync with CompletableFuture

Java 21+:
- virtual threads can simplify blocking style
- still use bounded concurrency

Java 25:
- structured concurrency helps group related subtasks
- scoped values can help immutable context propagation
```

Important invariant:

```text
Virtual threads reduce cost of blocking wait.
They do not increase remote capacity.
They do not remove need for timeout, pool, bulkhead, or backpressure.
```

---

## 8. Retry and Idempotency Design

### 8.1 Retry Classification Table

| Failure | Retry? | Condition |
|---|---:|---|
| DNS temporary failure | Maybe | only if deadline remains |
| Connect timeout | Maybe | remote likely not reached |
| Connection refused | Maybe | if deployment/restart expected; short budget |
| TLS handshake failure | Usually no | cert/config problem |
| Request write timeout | Dangerous | body may be partially sent |
| Read timeout after request sent | Dangerous | remote may have processed |
| HTTP 408 | Maybe | if idempotent/replayable |
| HTTP 409 | Usually no | semantic conflict, unless concurrency retry policy exists |
| HTTP 429 | Maybe | respect `Retry-After` / rate policy |
| HTTP 500 | Maybe | only known transient operations |
| HTTP 502/503/504 | Maybe | with backoff and budget |
| gRPC UNAVAILABLE | Maybe | common transient candidate |
| gRPC DEADLINE_EXCEEDED | Usually no immediate retry | caller budget already consumed unless outer budget remains |
| gRPC ABORTED | Maybe | for transaction/concurrency retry pattern |
| gRPC INVALID_ARGUMENT | No | caller bug or validation issue |

### 8.2 Idempotency Key Model

Untuk operasi side-effecting:

```text
POST /payments
POST /case-approvals
POST /document-submissions
POST /notifications
```

Jika retry diizinkan, request harus membawa:

```text
Idempotency-Key: <stable-operation-id>
```

Server harus menyimpan:

```text
idempotency_key
request_fingerprint
operation_status
response_snapshot
created_at
expires_at
```

Rule:

```text
Same key + same fingerprint + completed => return same result
Same key + different fingerprint => reject as conflict
Same key + in progress => return 409/202 depending contract
Expired key => policy decision, usually reject or treat as new only if safe
```

### 8.3 Retry Budget

Retry budget mencegah retry storm.

```text
For every 100 original requests,
allow at most N retry attempts in a rolling window.
```

Atau:

```text
retry tokens are replenished by successful original calls
retry consumes token
when tokens exhausted, fail fast
```

AWS guidance tentang retry/backoff/jitter menekankan pentingnya menghindari retry agresif yang menyinkron dan memperparah overload.

---

## 9. HTTP Platform Design

### 9.1 Typed Client Example

Business-facing interface:

```java
public interface CaseProfileClient {
    NetworkResult<CaseProfile> getCaseProfile(CaseId caseId, NetworkRequestContext context);
}
```

Implementation:

```java
public final class HttpCaseProfileClient implements CaseProfileClient {
    private final HttpClientFacade http;
    private final URI baseUri;

    @Override
    public NetworkResult<CaseProfile> getCaseProfile(CaseId caseId, NetworkRequestContext context) {
        NetworkOperation operation = Operations.GET_CASE_PROFILE;

        HttpRequestSpec request = HttpRequestSpec.get(
            baseUri.resolve("/cases/" + caseId.value() + "/profile")
        ).accept("application/json")
         .header("X-Correlation-Id", context.correlationId())
         .build();

        return http.execute(operation, request, CaseProfileMapper.INSTANCE, context);
    }
}
```

Business service tidak tahu:

```text
HTTP library apa
retry dilakukan bagaimana
timeout berapa
tracing dibuat di mana
metric direkam di mana
TLS config dari mana
exception detail transport apa
```

### 9.2 Response Mapping

Mapping harus eksplisit:

```text
200 -> success
304 -> cache not modified if operation supports cache
400 -> remote rejected invalid request
401/403 -> auth/authz failure
404 -> domain not found if endpoint contract says so
409 -> conflict/concurrency state
412 -> optimistic locking/precondition failure
422 -> validation error if contract uses it
429 -> rate limited
500/502/503/504 -> remote unavailable/transient candidate
malformed JSON -> remote contract violation
unknown 2xx shape -> remote contract violation
```

Jangan hanya:

```java
if (status >= 400) throw new RuntimeException(...);
```

### 9.3 Safe Logging

Log minimal yang aman:

```json
{
  "event": "outbound_http_attempt_completed",
  "dependency": "case-profile-service",
  "operation": "GetCaseProfile",
  "method": "GET",
  "route": "/cases/{caseId}/profile",
  "status": 200,
  "duration_ms": 143,
  "attempt": 1,
  "retryable": false,
  "correlation_id": "...",
  "trace_id": "..."
}
```

Hindari log:

```text
Authorization header
Cookie
raw request body with PII
raw response body with PII
mTLS private key path if sensitive
full URL containing tokens
```

---

## 10. gRPC Platform Design

### 10.1 Stub Factory Pattern

```java
public final class ManagedGrpcClientFactory {
    private final ManagedChannelRegistry channels;
    private final GrpcPolicyRegistry policies;
    private final GrpcInterceptorFactory interceptors;

    public CaseProfileGrpc.CaseProfileBlockingStub caseProfileBlockingStub() {
        ManagedChannel channel = channels.get("case-profile-grpc");
        return CaseProfileGrpc.newBlockingStub(channel)
            .withInterceptors(interceptors.forDependency("case-profile-grpc"));
    }
}
```

Rules:

```text
Do not create channel per request.
Do not hide deadline.
Do not hide cancellation.
Do not map all StatusRuntimeException to generic RuntimeException.
Do not retry streaming call blindly.
```

### 10.2 Deadline

```java
stub.withDeadlineAfter(context.deadline().remaining(clock).toMillis(), TimeUnit.MILLISECONDS)
    .getCaseProfile(request);
```

### 10.3 Metadata Propagation

```text
x-correlation-id
traceparent / tracing context
idempotency-key if applicable
auth token / mTLS identity
caller application
operation id
```

### 10.4 Error Mapping

```text
INVALID_ARGUMENT -> remote rejected invalid input
NOT_FOUND -> domain not found if contract says so
FAILED_PRECONDITION -> state invalid
ABORTED -> concurrency conflict, maybe retryable if designed
UNAVAILABLE -> transient/unavailable
RESOURCE_EXHAUSTED -> rate/limit/quota
DEADLINE_EXCEEDED -> budget exhausted or remote too slow
CANCELLED -> caller/server cancellation, inspect initiator
UNKNOWN -> avoid generic; include details safely
```

### 10.5 Streaming Guard

For streaming:

```text
bounded outbound queue
manual flow control if needed
explicit cancellation path
heartbeat if long idle
resume token if resumable
chunk size limit
per-stream duration limit
per-client stream count limit
observability per stream and per message class
```

---

## 11. Resilience Composition Order

A common safe execution pipeline:

```text
1. validate operation policy
2. create attempt context
3. check deadline
4. acquire bulkhead/concurrency permit
5. check circuit breaker permission
6. acquire rate-limit token if needed
7. execute transport attempt with phase timeouts
8. classify response/error
9. record metrics/traces/logs
10. decide retry using classification + idempotency + budget
11. release resources
12. map final result
```

Pseudo-code:

```java
public <T> NetworkResult<T> executeWithPolicy(
    NetworkOperation operation,
    Supplier<AttemptResult<T>> attempt,
    NetworkRequestContext context
) {
    validate(operation, context);

    AttemptSummary summary = new AttemptSummary();

    while (true) {
        if (context.deadline().isExpired(clock)) {
            return failure(NetworkError.deadlineExceeded(operation, summary));
        }

        Permit permit = bulkhead.acquire(operation, context.deadline());
        if (!permit.acquired()) {
            return failure(NetworkError.bulkheadRejected(operation, summary));
        }

        try {
            AttemptResult<T> result = circuitBreaker.execute(operation, attempt);
            summary.add(result);

            if (result.isSuccess()) {
                return success(result.value(), summary);
            }

            RetryDecision decision = retryPolicy.decide(operation, result.error(), summary, context);
            if (!decision.shouldRetry()) {
                return failure(result.error(), summary);
            }

            sleeper.sleep(decision.backoff(), context.deadline());
        } finally {
            permit.release();
        }
    }
}
```

Important detail:

```text
The policy executor must not sleep beyond deadline.
The policy executor must not retry non-replayable body.
The policy executor must not retry side-effecting operation without idempotency guarantee.
The policy executor must emit one event per attempt and one event per final result.
```

---

## 12. Observability Contract

### 12.1 Span Naming

Recommended:

```text
HTTP outbound span:
HTTP GET case-profile-service /cases/{caseId}/profile

gRPC outbound span:
gRPC case.profile.v1.CaseProfileService/GetCaseProfile
```

Avoid high-cardinality span names:

```text
BAD: HTTP GET /cases/CASE-2026-000123/profile
GOOD: HTTP GET /cases/{caseId}/profile
```

### 12.2 Metrics

Minimum metrics:

```text
network.client.requests.total
network.client.duration
network.client.attempts.total
network.client.retries.total
network.client.failures.total
network.client.deadline_exceeded.total
network.client.timeouts.total
network.client.pool.pending
network.client.pool.active
network.client.pool.idle
network.client.bulkhead.rejected.total
network.client.circuit.open
network.client.payload.request.bytes
network.client.payload.response.bytes
```

Useful labels:

```text
dependency
operation
transport
protocol
method/status_class
error_kind
retryable
attempt_number_bucket
```

Avoid labels:

```text
full URL
case id
user id
raw exception message if high-cardinality
idempotency key
trace id
```

### 12.3 Logs

Log lifecycle:

```text
request started? usually trace enough, avoid noisy logs
attempt failed
retry scheduled
retry exhausted
final failure
policy rejection
circuit opened/closed
pool exhaustion
deadline exceeded
```

### 12.4 Dashboards

Dashboard per dependency:

```text
traffic rate
success rate
error rate by kind
latency p50/p95/p99
retry rate
attempts per request
deadline exceeded
pool active/pending/idle
bulkhead rejection
circuit state
payload size distribution
HTTP/gRPC status distribution
```

Question dashboard must answer:

```text
Is the dependency down?
Is our client overloading it?
Are we queueing before sending?
Are retries amplifying traffic?
Are failures concentrated in one phase?
Did p99 rise before error rate?
Did payload size change?
Did pool pending increase?
```

---

## 13. Security and Compliance Contract

### 13.1 Outbound Security Policy

Every outbound client must define:

```text
allowed scheme: https only unless explicit exception
allowed host allowlist
allowed port allowlist
redirect policy
proxy policy
TLS/mTLS policy
timeout policy
payload size limit
header allowlist/blocklist
secret redaction
SSRF guard if URL is user-supplied
```

### 13.2 SSRF Guard

If any feature fetches external URL:

```text
validate scheme
validate host allowlist or domain policy
resolve DNS carefully
block private/internal/link-local IP ranges unless explicitly allowed
avoid following redirects or revalidate every redirect
set small timeout
limit response size
validate Content-Type
stream safely
log safely
```

### 13.3 Auditability

For regulated/case-management systems, network operations that affect case state should record:

```text
operation id
idempotency key
remote dependency
remote operation
request semantic summary
response semantic summary
final decision
attempt count
final status
correlation id
actor/system identity
business entity id
created timestamp
```

Avoid storing raw payload if it contains PII/secrets unless retention and access controls are explicit.

---

## 14. Testing Strategy for the Capstone Platform

### 14.1 Unit Tests

Test pure policy logic:

```text
timeout budget calculation
retry classification
idempotency validation
error mapping
status mapping
header redaction
payload limit decision
circuit breaker classification
```

### 14.2 Component Tests

Use fake HTTP/gRPC servers:

```text
200 success
400 validation
409 conflict
429 Retry-After
500/503/504
slow response
malformed body
large body
connection reset
```

### 14.3 Contract Tests

For REST:

```text
OpenAPI examples
problem+json shape
pagination shape
enum compatibility
unknown field behavior
```

For gRPC:

```text
proto compatibility
field number preservation
unknown field tolerance
status mapping
metadata requirements
```

### 14.4 Fault Injection Tests

Use tools like Toxiproxy/Testcontainers or network simulation:

```text
latency
bandwidth limit
connection cut
half-open connection
packet loss
TLS failure
DNS failure approximation
```

### 14.5 Observability Tests

Assert that failures emit:

```text
metric
trace span
safe log event
attempt count
error kind
operation name
correlation id
```

This is often ignored, but a platform is not production-grade if observability is not tested.

---

## 15. Deployment and Configuration Governance

### 15.1 Configuration Ownership

Each dependency config should have owner:

```yaml
owner: team-case-platform
dependency: document-service
contact: '#case-platform-alerts'
criticality: high
runbook: 'runbooks/document-service-client.md'
```

### 15.2 Change Review Checklist

Changing timeout/retry/pool config should require review:

```text
Does this increase traffic under failure?
Does this increase remote concurrency?
Does deadline still fit upstream SLA?
Does operation have idempotency guarantee?
Does dashboard show the new policy?
Does test cover failure mode?
Does runbook mention it?
```

### 15.3 Environment Differences

DEV/UAT/PROD can differ in endpoints, but should not randomly differ in semantics.

Bad:

```text
PROD retry = 3
UAT retry = 0
DEV timeout = unlimited
```

Better:

```text
same semantic profile
smaller capacity in lower env
explicit test profile for fault injection
```

---

## 16. Migration Strategy from Messy Codebase

### Phase 1 — Inventory

List all outbound communication:

```text
service
class/method
remote dependency
protocol
library
endpoint/method
current timeout
current retry
current auth
current observability
payload type
criticality
```

### Phase 2 — Classify

Classify operations:

```text
read-only idempotent
side-effecting idempotent with key
side-effecting non-idempotent
streaming
large payload
external internet call
internal service call
critical path
background job
```

### Phase 3 — Wrap, Do Not Rewrite Everything

Create platform wrapper around existing clients:

```text
existing RestTemplate can be wrapped
existing Apache HttpClient can be wrapped
existing gRPC stub can be created via factory
```

Goal first:

```text
standard timeout
standard logging
standard metrics
standard error taxonomy
```

### Phase 4 — Move Business Code to Typed SDK

Replace direct call sites:

```text
Before:
service method builds URL and calls HTTP directly

After:
service method calls CaseProfileClient.getCaseProfile(...)
```

### Phase 5 — Enforce Governance

Use code review/static rules:

```text
No direct new HttpClient in business module.
No direct ManagedChannelBuilder outside platform module.
No outbound call without operation identity.
No retry without policy.
No side-effecting retry without idempotency.
No raw payload logging.
```

---

## 17. Production Readiness Checklist

### 17.1 Per Dependency

```text
[ ] Owner defined
[ ] Criticality defined
[ ] Base endpoint configured
[ ] Protocol version known
[ ] TLS/mTLS strategy defined
[ ] Auth strategy defined
[ ] Timeout policy defined
[ ] Retry policy defined
[ ] Pool/channel policy defined
[ ] Circuit breaker/bulkhead policy defined if needed
[ ] Rate limit/quota known
[ ] Error mapping documented
[ ] Idempotency contract documented if side-effecting
[ ] Observability dashboard exists
[ ] Alert routing exists
[ ] Runbook exists
[ ] Contract test exists
[ ] Fault injection test exists for critical dependency
```

### 17.2 Per Operation

```text
[ ] Operation name stable
[ ] Route/method/service method known
[ ] Request schema/version known
[ ] Response schema/version known
[ ] Error schema known
[ ] Retryability decided
[ ] Idempotency requirement decided
[ ] Payload limit decided
[ ] Deadline budget decided
[ ] Fallback behavior decided
[ ] Audit requirement decided
[ ] Security redaction decided
```

### 17.3 Per Release

```text
[ ] Dependency config diff reviewed
[ ] Timeout/retry/pool changes reviewed
[ ] Dashboard checked in UAT/staging
[ ] Contract compatibility checked
[ ] TLS/cert expiry checked
[ ] Load test or smoke test executed for critical dependency
[ ] Rollback behavior known
[ ] Feature flag/kill switch available if high risk
```

---

## 18. Case Study: Case Approval Platform Communication Layer

Imagine regulatory case-management system:

```text
Case Service
Profile Service
Document Service
Notification Service
Payment Service
Audit Service
Search Service
External Agency Gateway
```

### 18.1 Bad Design

```text
CaseService approves case.
Inside method:
- calls profile service with raw WebClient
- calls document service with RestTemplate
- calls payment service with gRPC stub directly
- sends email with retry in catch block
- writes audit at end
```

Failure:

```text
payment call times out after remote processed payment
case service retries whole approval
notification sent twice
audit trail only records final failure
user clicks approve again
case enters inconsistent state
```

### 18.2 Better Design

Use orchestration with explicit operation ids:

```text
Approval operation id: APPROVAL-2026-0001
Idempotency key: CASE-123:APPROVE:v3
```

Outbound operations:

```text
Get profile: read-only, retryable
Validate documents: read-only, retryable
Create payment instruction: side-effecting, retryable only with idempotency key
Send notification: side-effecting, async outbox preferred
Write audit: local durable first or outbox
```

Flow:

```text
1. validate local state
2. create approval command record
3. reserve idempotency key
4. call remote profile/doc dependencies with deadline
5. call payment with idempotency key
6. persist approval state transition
7. emit notification via outbox
8. emit audit event
```

Network platform ensures:

```text
profile retry safe
document retry safe
payment retry guarded by idempotency key
notification not sent inline repeatedly
every outbound attempt traced
every final failure mapped to recoverable/retryable/manual-review state
```

### 18.3 Failure State Mapping

```text
Profile unavailable -> APPROVAL_PENDING_DEPENDENCY
Document service timeout -> APPROVAL_PENDING_DOCUMENT_VALIDATION
Payment deadline exceeded -> PAYMENT_CONFIRMATION_REQUIRED
Notification failure -> APPROVED_NOTIFICATION_PENDING
Audit failure -> block or local durable fallback, depending compliance rule
```

This is top-tier design: network failure becomes explicit workflow state, not random exception.

---

## 19. Common Anti-Patterns

### 19.1 Direct Client Everywhere

```text
new HttpClient()
new RestTemplate()
ManagedChannelBuilder.forAddress(...).build()
```

inside arbitrary service classes.

Impact:

```text
no governance
no observability
resource leak
inconsistent timeout
inconsistent retry
hard to migrate
```

### 19.2 Infinite or Missing Timeout

```text
No timeout means caller can wait forever.
Long timeout means resources are held too long.
Short timeout without retry/idempotency can create false failure.
```

### 19.3 Retry All Exceptions

Bad:

```java
catch (Exception e) {
    retry();
}
```

Impact:

```text
retry validation errors
retry auth errors
retry non-idempotent side effects
retry permanent contract violations
```

### 19.4 Pool Size as Magic Number

Bad:

```text
maxConnections=1000 because high traffic
```

Better:

```text
based on arrival rate, latency, remote capacity, per-instance count, protocol, and SLA
```

### 19.5 Logging Raw Payload

Impact:

```text
PII leak
secret leak
compliance violation
high storage cost
log query instability
```

### 19.6 gRPC Channel per Request

Impact:

```text
connection churn
TLS churn
HTTP/2 benefit lost
load balancer pressure
latency spike
resource leak
```

### 19.7 Streaming Without Backpressure

Impact:

```text
unbounded queue
heap growth
slow consumer collapse
connection leak
partial delivery ambiguity
```

### 19.8 Observability Only at Controller

If only inbound controller is traced, outbound dependency failure remains opaque.

You need both:

```text
inbound span
outbound span
attempt events
pool metrics
error classification
```

---

## 20. Java 8–25 Design Compatibility

### 20.1 Java 8 Baseline

Use:

```text
Apache HttpClient / OkHttp
CompletableFuture carefully
ExecutorService
manual context propagation
try-with-resources
classic resilience library integration
```

Avoid assuming:

```text
JDK HttpClient
records
sealed classes
virtual threads
structured concurrency
scoped values
```

### 20.2 Java 11+

Can use:

```text
java.net.http.HttpClient
HTTP/2 support
CompletableFuture async client
BodyPublisher/BodyHandler model
```

### 20.3 Java 17+

Can use:

```text
records for DTOs/policies
sealed interfaces for result/error hierarchy
modern switch expressions
better TLS defaults than older Java 8 environments
```

### 20.4 Java 21+

Can use:

```text
virtual threads
structured concurrency preview/incubator depending version
simpler blocking-style network code
```

Still required:

```text
bounded concurrency
pool/channel limits
deadline propagation
backpressure
observability
```

### 20.5 Java 25

Java 25 documentation includes modern structured concurrency and scoped values direction. Use them to simplify concurrency structure and immutable context propagation where appropriate, but keep platform abstractions portable if your estate spans Java 8–25.

---

## 21. Final Mental Model

A production-grade Java network platform is not this:

```text
HTTP client + retry library + logs
```

It is this:

```text
A controlled boundary that converts local intent into remote attempts,
under explicit deadline, capacity, security, compatibility, and observability rules,
then converts uncertain remote outcomes back into safe domain decisions.
```

That sentence is the heart of the whole series.

---

## 22. Final Architecture Summary

```text
Business Use Case
   |
   v
Typed Port / Client Interface
   |
   v
Domain-facing SDK
   |
   v
Adapter / Anti-Corruption Layer
   |
   v
Network Operation Metadata
   |
   +--> Deadline Policy
   +--> Retry / Idempotency Policy
   +--> Bulkhead / Rate Limit / Circuit Breaker
   +--> TLS / Auth / Proxy Policy
   +--> Observability Policy
   +--> Payload / Security Policy
   |
   v
Transport Facade
   |
   +--> HTTP Implementation
   +--> gRPC Implementation
   +--> Streaming Implementation
   +--> Large Payload Implementation
   |
   v
Network Path
   |
   v
Remote Dependency
```

---

## 23. Exercises

### Exercise 1 — Inventory Real System Calls

Pick one existing Java service. List every outbound call:

```text
dependency
operation
transport
library
timeout
retry
idempotency
pool/channel
observability
owner
criticality
```

Find at least five inconsistencies.

### Exercise 2 — Design Error Taxonomy

Create a `NetworkErrorKind` enum/class hierarchy that separates:

```text
DNS
connect
TLS
pool
timeout
remote 4xx
remote 5xx
rate limit
contract violation
payload violation
cancellation
```

Map HTTP and gRPC errors into it.

### Exercise 3 — Build a Deadline-Aware Retry Executor

Implement retry executor that:

```text
uses a global deadline
supports max attempts
uses jittered backoff
does not retry non-idempotent operations
records attempt events
stops when deadline expires
```

### Exercise 4 — Design a Typed Client SDK

Create a typed client for:

```text
DocumentService
- getDocumentMetadata
- downloadDocument
- submitDocument
- deleteDraftDocument
```

Define operation metadata for each.

### Exercise 5 — Observability Contract

For one dependency, define:

```text
span name
metrics
labels
safe logs
dashboards
alerts
runbook questions
```

### Exercise 6 — Failure Playbook

Write runbook for:

```text
HTTP 504 spike from gateway
```

Must include:

```text
what to check first
client metrics
gateway metrics
server metrics
pool metrics
retry metrics
deadline metrics
safe mitigation
permanent fix
```

---

## 24. Completion Criteria for This Series

You have completed the series if you can confidently explain and design:

```text
TCP stream semantics
DNS and endpoint discovery
socket/channel/selector trade-offs
protocol framing
serialization compatibility
HTTP semantics
HTTP/1.1 and HTTP/2 runtime behavior
HTTP/3/QUIC trade-offs
Java HTTP clients
JDK HttpClient
Timeout/deadline engineering
Retry/idempotency/hedging
Connection pooling
TLS/mTLS/ALPN
Proxy/gateway/LB/service mesh behavior
REST contract evolution
HTTP streaming
WebSocket production behavior
gRPC fundamentals
gRPC transport internals
gRPC retry/LB/name resolution/service config
gRPC streaming/backpressure
Netty runtime model
Reactive/async/virtual thread decision framework
Backpressure/rate limit/bulkhead/circuit breaker/adaptive protection
Observability
Performance engineering
Large payload transfer
Security beyond TLS
Network testing and chaos
Production failure diagnosis
Architecture patterns
Production-grade communication platform design
```

---

## 25. Closing Thought

The top 1% gap is rarely about memorizing more APIs.

It is about seeing hidden systems:

```text
A timeout is a resource policy.
A retry is a side-effect decision.
A connection pool is a capacity boundary.
A protocol is a compatibility contract.
A trace is an incident reconstruction tool.
A network exception is an uncertain distributed outcome.
A client SDK is an architecture boundary.
A production call is not a method call; it is a governed attempt.
```

Once you think this way, HTTP client code, gRPC stubs, Netty handlers, TLS config, observability, and failure playbooks stop being separate topics. They become one discipline:

```text
Java Network Systems Engineering
```

---

## 26. References

- Oracle Java SE 25 `java.net.http.HttpClient` documentation: immutable reusable client, builder configuration, HTTP/1.1 and HTTP/2 support, redirect/proxy/authenticator/connect-timeout configuration.
- Oracle Java SE 25 `java.net.http` module documentation.
- gRPC official documentation: core concepts, deadlines, retry, hedging, load balancing, performance best practices, status codes, metadata, flow control, cancellation, and service config.
- OpenTelemetry Java documentation and OpenTelemetry Java instrumentation project: Java telemetry API/SDK and Java 8+ agent-based instrumentation.
- RFC 9110 HTTP Semantics.
- RFC 9112 HTTP/1.1.
- RFC 9113 HTTP/2.
- RFC 6455 WebSocket Protocol.
- OWASP SSRF Prevention Cheat Sheet.
- Oracle Java Serialization Filtering / JEP 290.

---

# Status Seri

```text
Part 35 of 35 selesai.
Seri learn-java-io-network-http-grpc-protocol-engineering selesai.
```

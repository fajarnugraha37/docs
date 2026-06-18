# Part 21 — Observability: Logging, Metrics, Tracing, Correlation, Redaction

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `21-observability-logging-metrics-tracing-correlation-redaction.md`  
> Target: Java 8–25, JDK HttpClient, OkHttp, Retrofit, Apache HttpClient 5, Spring RestClient/WebClient/RestTemplate  
> Level: Advanced / Production Engineering

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas error modelling. Sekarang kita masuk ke konsekuensi operasionalnya: **kalau outbound HTTP call bermasalah, bagaimana kita tahu apa yang terjadi?**

HTTP client tanpa observability yang baik akan terlihat seperti ini:

```text
User request lambat
→ service thread tertahan
→ downstream call timeout
→ log hanya: "java.net.SocketTimeoutException"
→ tidak tahu downstream mana
→ tidak tahu endpoint mana
→ tidak tahu latency fase mana
→ tidak tahu apakah retry terjadi
→ tidak tahu apakah token refresh terjadi
→ tidak tahu apakah response body bocor
→ tidak tahu apakah pool penuh
→ tidak tahu apakah problem hanya tenant tertentu
```

HTTP client top-tier harus mampu menjawab pertanyaan produksi seperti:

1. Downstream mana yang lambat?
2. Endpoint mana yang error?
3. Status code apa yang dominan?
4. Apakah error berasal dari DNS, connect, TLS, read timeout, decode, atau domain semantic error?
5. Berapa latency P50/P95/P99 per downstream?
6. Apakah retry memperbaiki atau memperburuk situasi?
7. Apakah pool exhaustion terjadi?
8. Apakah request punya correlation ID dan trace ID?
9. Apakah token, cookie, API key, atau PII bocor ke log?
10. Apakah metric punya cardinality aman?
11. Apakah tracing dapat menghubungkan inbound request dengan outbound dependency?
12. Apakah incident bisa dianalisis tanpa mengaktifkan debug logging berbahaya?

Part ini membangun mental model observability untuk HTTP client sebagai **diagnostic contract**.

---

## 2. Core Mental Model

HTTP client observability bukan hanya "log request dan response".

Model yang lebih benar:

```text
Outbound call observability
= structured event
+ metric time series
+ distributed trace span
+ correlation context
+ safe diagnostic metadata
+ redaction policy
+ failure classification
+ sampling strategy
+ production runbook linkage
```

Atau dalam bentuk lifecycle:

```text
application operation
  ↓
client boundary
  ↓
request metadata created
  ↓
correlation/trace propagated
  ↓
attempt started
  ↓
DNS/connect/TLS/write/read/decode phases observed if possible
  ↓
response/error classified
  ↓
retry/fallback/circuit outcome recorded
  ↓
structured log emitted only when useful
  ↓
metrics updated
  ↓
trace span completed
  ↓
sensitive data redacted before leaving process
```

Top-tier HTTP client tidak hanya menjawab "berhasil/gagal".

Ia menjawab:

```text
apa yang dipanggil
untuk operasi apa
oleh request siapa
ke dependency mana
berapa lama
hasilnya apa
kegagalannya jenis apa
apakah retry terjadi
apakah fallback terjadi
apakah aman di-log
apa dampaknya ke user/domain
```

---

## 3. Observability Pillars untuk HTTP Client

Ada tiga pilar klasik:

```text
logs
metrics
traces
```

Tetapi untuk HTTP client, kita butuh dua tambahan:

```text
correlation context
redaction / privacy boundary
```

Karena outbound HTTP call membawa informasi sensitif: authorization header, cookie, token, query parameter, body, business identifier, tenant, account id, document id, email, NIK, dan sebagainya.

Jadi modelnya:

```text
HTTP client observability pillars:

1. Logs
   → event-level diagnostic detail

2. Metrics
   → aggregate behavior over time

3. Traces
   → causal path across services

4. Correlation
   → request identity across logs/events

5. Redaction
   → safety control for sensitive data
```

Tanpa redaction, observability menjadi data leakage system.

Tanpa correlation, log hanya noise.

Tanpa metrics, incident tidak terlihat cepat.

Tanpa trace, distributed latency sulit dijelaskan.

Tanpa logs, detail failure hilang.

---

## 4. Apa yang Harus Diobservasi pada HTTP Client?

Minimal production-grade outbound HTTP client harus mengobservasi:

```text
client.name
operation.name
remote.system
remote.host
remote.port
http.method
http.route/template
http.status_code
outcome
failure.kind
retry.count
attempt.number
duration.total
request.size(optional, bucketed)
response.size(optional, bucketed)
timeout.kind
circuit.state(optional)
rate_limit.decision(optional)
correlation_id
trace_id
span_id
tenant(optional, controlled cardinality)
```

Yang **jangan sembarang** diobservasi:

```text
full URL with sensitive query
Authorization header
Cookie header
Set-Cookie header
API key
access token
refresh token
client secret
request body
response body
PII
raw XML/JSON payload
full stack trace for expected downstream 4xx
high-cardinality user id as metric tag
unique document id as metric tag
```

---

## 5. Logs: Apa Fungsi Logging pada HTTP Client?

Logging berguna untuk **diagnostic event**.

Bukan untuk membuat time-series dashboard.

Bukan untuk menyimpan semua payload.

Bukan untuk menggantikan distributed tracing.

Log HTTP client yang baik biasanya punya event seperti:

```text
outbound.http.request.started
outbound.http.request.completed
outbound.http.request.failed
outbound.http.retry.scheduled
outbound.http.retry.exhausted
outbound.http.auth.refresh.started
outbound.http.auth.refresh.failed
outbound.http.circuit.opened
outbound.http.response.decode_failed
```

Tetapi di high-throughput system, tidak semua request perlu log `started` dan `completed` di INFO. Biasanya:

```text
INFO  → important state transition, retry exhausted, fallback used, circuit open
WARN  → degraded dependency behavior, retryable failure after retries, 429 burst, high latency threshold breached
ERROR → unexpected failure, non-recoverable dependency failure, security violation, data integrity issue
DEBUG → detailed request lifecycle for temporary diagnosis
TRACE → highly detailed internal events, normally disabled
```

### 5.1 Bad Logging Example

```java
log.info("Calling URL: {} with headers: {} body: {}", url, headers, body);
```

Masalah:

```text
- token bisa bocor
- cookie bisa bocor
- body bisa berisi PII
- URL query bisa berisi secret
- log tidak structured
- sulit query berdasarkan downstream/client/status/failure kind
```

### 5.2 Better Structured Logging

```java
log.info("outbound_http_completed client={} operation={} method={} route={} status={} outcome={} durationMs={} retryCount={} correlationId={}",
    "payment-gateway",
    "create-payment",
    "POST",
    "/v1/payments",
    201,
    "success",
    durationMs,
    retryCount,
    correlationId
);
```

Lebih baik lagi kalau memakai structured logging JSON:

```json
{
  "event": "outbound_http_completed",
  "client": "payment-gateway",
  "operation": "create-payment",
  "method": "POST",
  "route": "/v1/payments",
  "status": 201,
  "outcome": "success",
  "duration_ms": 184,
  "retry_count": 0,
  "correlation_id": "req-abc-123",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

### 5.3 Log Route Template, Bukan Raw URL

Gunakan:

```text
GET /customers/{customerId}/orders
```

Bukan:

```text
GET /customers/982341/orders?token=abc&email=user@example.com
```

Kenapa?

```text
- raw URL bisa mengandung PII/secret
- metric cardinality meledak
- log noise tinggi
- route template lebih berguna untuk aggregate diagnosis
```

### 5.4 Logging 4xx vs 5xx

Tidak semua HTTP error perlu `ERROR`.

Contoh:

```text
404 dari API lookup eksternal karena data memang tidak ada
→ mungkin domain result: NOT_FOUND
→ log DEBUG/INFO atau tidak perlu log per request

401 karena token expired lalu refresh berhasil
→ mungkin DEBUG/metric only

401 setelah refresh gagal
→ WARN/ERROR tergantung impact

429 burst dari downstream
→ WARN + metric + circuit/rate limiter signal

500/502/503/504 setelah retry exhausted
→ WARN/ERROR tergantung business criticality
```

Rule praktis:

```text
Log level harus merefleksikan actionability, bukan hanya status code.
```

---

## 6. Metrics: Apa yang Harus Diukur?

Metrics menjawab pertanyaan aggregate:

```text
berapa sering
berapa lama
berapa banyak
berapa parah
apakah tren memburuk
```

HTTP client metrics minimal:

```text
http.client.requests.total
http.client.request.duration
http.client.errors.total
http.client.retries.total
http.client.timeouts.total
http.client.inflight
http.client.circuit.state
http.client.rate_limited.total
http.client.fallbacks.total
```

Namun nama metric berbeda tergantung platform. Yang penting bukan nama persisnya, tetapi semantic dimension-nya.

### 6.1 Metric Dimensions / Tags

Recommended low-cardinality tags:

```text
client
operation
method
route/template
status_class
outcome
failure_kind
retryable
```

Contoh:

```text
client="payment-gateway"
operation="create-payment"
method="POST"
route="/v1/payments"
status_class="2xx"
outcome="success"
```

Untuk status code, boleh pakai exact code jika cardinality tetap rendah:

```text
status="201"
status="400"
status="429"
status="503"
```

### 6.2 Dangerous Tags

Jangan jadikan metric tag:

```text
user_id
email
customer_id
document_id
invoice_id
transaction_id
full_url
query_string
request_id
correlation_id
trace_id
token hash
raw exception message
```

Kenapa?

```text
- cardinality explosion
- storage cost naik drastis
- dashboard lambat
- alert noisy
- bisa membocorkan data sensitif
```

Metric harus aggregate, bukan per-entity log.

### 6.3 Latency Metrics

Jangan hanya average.

Minimal lihat:

```text
P50
P90
P95
P99
max(optional)
count
error rate
```

Average menipu. Downstream bisa punya average 100 ms tetapi P99 10 detik. User biasanya terkena tail latency, bukan average.

### 6.4 Attempt Metrics vs Operation Metrics

Retry membuat metric ambigu.

Misalnya operation `createPayment()` melakukan 3 attempts:

```text
attempt 1 → 503 after 100 ms
attempt 2 → timeout after 500 ms
attempt 3 → success after 200 ms
operation total → success after 900 ms including backoff
```

Kita butuh dua level metric:

```text
attempt-level metric
→ setiap HTTP attempt

operation-level metric
→ logical API client operation
```

Kalau hanya attempt metric, terlihat error rate tinggi walaupun operation sukses.

Kalau hanya operation metric, retry storm tersembunyi.

Top-tier client mengukur keduanya.

### 6.5 Timeout Metrics

Timeout harus diklasifikasi:

```text
connect_timeout
pool_acquire_timeout
read_timeout
write_timeout
call_timeout
response_timeout
deadline_exceeded
```

Kalau semua disebut `timeout`, diagnosis menjadi kabur.

```text
connect_timeout naik
→ network route / downstream unreachable / proxy issue

read_timeout naik
→ downstream slow / response generation lambat

pool_acquire_timeout naik
→ local pool exhausted / leak / concurrency terlalu tinggi

call_timeout naik
→ total budget terlalu kecil atau retry terlalu banyak
```

### 6.6 Pool Metrics

Untuk client yang punya explicit pool seperti OkHttp/Apache, ukur:

```text
active connections
idle connections
connection acquire duration
connection creation count
connection reuse count
pool saturation
pending calls
running calls
per-host queued calls
```

OkHttp `Dispatcher` juga punya konsep queued/running calls. Apache pooling manager punya total/per-route connection stats.

### 6.7 Retry Metrics

```text
retry_attempts_total
retry_exhausted_total
retry_success_after_retry_total
retry_suppressed_due_to_deadline_total
retry_suppressed_due_to_non_idempotent_total
retry_suppressed_due_to_budget_total
```

Ini membedakan:

```text
retry membantu
vs
retry membebani downstream
vs
retry ditolak karena policy benar
```

---

## 7. Tracing: Melihat Causal Path Across Services

Distributed tracing menjawab:

```text
request ini lewat service mana saja?
downstream mana yang makan latency terbesar?
apakah satu inbound request membuat banyak outbound calls?
apakah retry terlihat sebagai repeated attempt?
apakah token refresh terjadi di tengah request?
```

Trace biasanya terdiri dari:

```text
trace
  span inbound HTTP server
    span database query
    span outbound HTTP client A
    span outbound HTTP client B
      span retry attempt(optional)
```

### 7.1 Trace Context

Standar umum untuk propagation modern adalah W3C Trace Context:

```text
traceparent
tracestate
```

`traceparent` membawa identitas trace yang memungkinkan service lain menghubungkan span mereka ke trace yang sama.

Contoh format konseptual:

```text
traceparent: 00-<trace-id>-<parent-id>-<trace-flags>
```

Dalam HTTP client, kita harus memastikan:

```text
- current trace context dibaca dari thread/context
- header traceparent disuntikkan ke outbound request
- baggage hanya dikirim jika aman
- header tidak ditimpa sembarangan
- context tetap benar pada async/reactive boundary
```

### 7.2 Span Naming

Span name yang buruk:

```text
HTTP GET
GET https://api.example.com/customers/12345/orders?email=a@b.com
```

Span name yang baik:

```text
GET /customers/{customerId}/orders
PaymentGateway.createPayment
CustomerRegistry.lookupCustomer
```

Prinsip:

```text
Span name harus low-cardinality dan diagnostically useful.
```

### 7.3 Span Attributes

Useful attributes:

```text
http.request.method
url.scheme
server.address
server.port
http.route
http.response.status_code
network.protocol.name
network.protocol.version
error.type
client.name
operation.name
retry.count
attempt.number
```

Hindari:

```text
full URL dengan query sensitif
raw payload
Authorization
Cookie
customer id sebagai attribute high-cardinality kecuali benar-benar dikontrol
```

### 7.4 Attempt Span vs Operation Span

Ada dua desain:

#### Desain A — One Span Per Logical Operation

```text
span: PaymentGateway.createPayment
attributes:
  retry.count=2
  final.status=201
```

Kelebihan:

```text
- trace lebih ringkas
- mudah dibaca
```

Kekurangan:

```text
- detail tiap attempt hilang
```

#### Desain B — Parent Operation Span + Child Attempt Spans

```text
span: PaymentGateway.createPayment
  span: HTTP POST /v1/payments attempt=1 status=503
  span: HTTP POST /v1/payments attempt=2 error=read_timeout
  span: HTTP POST /v1/payments attempt=3 status=201
```

Kelebihan:

```text
- retry visible
- latency breakdown jelas
```

Kekurangan:

```text
- trace lebih ramai
- volume telemetry naik
```

Rekomendasi:

```text
Untuk critical external dependency, gunakan operation span + attempt detail.
Untuk high-volume low-risk dependency, cukup operation span dengan retry attributes.
```

### 7.5 Async Context Propagation

Ini sering menjadi bug observability.

Contoh masalah:

```java
client.sendAsync(request, BodyHandlers.ofString())
    .thenApply(response -> map(response));
```

Kalau context propagation tidak diatur, callback bisa berjalan di executor berbeda tanpa trace context. Akibatnya outbound span terputus.

Hal yang perlu diperhatikan:

```text
CompletableFuture executor
virtual threads
Reactor context
ThreadLocal MDC
custom thread pool
OkHttp Dispatcher threads
Apache async callbacks
```

Top-tier engineer tidak mengasumsikan `ThreadLocal` selalu aman melewati async boundary.

---

## 8. Correlation ID vs Trace ID

Sering tertukar.

### 8.1 Trace ID

Trace ID adalah identitas distributed trace.

Digunakan oleh tracing backend.

Biasanya otomatis dari OpenTelemetry/Micrometer Tracing.

### 8.2 Correlation ID

Correlation ID adalah identitas request/business operation yang sering dipakai di log dan komunikasi antar sistem.

Bisa berupa:

```text
X-Request-ID
X-Correlation-ID
x-correlation-id
requestId
transactionId
```

### 8.3 Perbedaannya

```text
Trace ID
→ observability/telemetry concern
→ dikelola tracing system
→ cocok untuk mencari trace di Jaeger/Tempo/Zipkin/APM

Correlation ID
→ operational/application concern
→ sering masuk log/audit/support
→ bisa disepakati lintas organisasi atau integrasi eksternal
```

Sistem yang baik bisa punya keduanya:

```text
log event:
  trace_id=...
  span_id=...
  correlation_id=...
  client=payment-gateway
  operation=create-payment
```

### 8.4 Propagation Rule

```text
Inbound request punya correlation ID
→ validasi format/panjang
→ pakai ulang jika trusted
→ generate baru jika tidak ada/tidak valid
→ simpan di request context
→ propagate ke outbound client yang relevan
```

Jangan propagate semua header mentah dari inbound ke outbound.

---

## 9. MDC / Thread Context Logging

Di Java logging, MDC sering dipakai:

```java
MDC.put("correlationId", correlationId);
MDC.put("traceId", traceId);
```

Lalu pattern log otomatis memasukkan field tersebut.

Masalahnya:

```text
MDC biasanya ThreadLocal
async callback bisa pindah thread
virtual thread lifecycle berbeda
Reactor punya Context sendiri
OkHttp async callback berjalan di Dispatcher thread
CompletableFuture callback bisa di ForkJoinPool/common pool
```

Jadi untuk HTTP client observability:

```text
- jangan hanya mengandalkan MDC implisit
- explicit context object sering lebih aman di client boundary
- gunakan instrumentation resmi jika ada
- wrap executor untuk context propagation bila perlu
- bersihkan MDC setelah request selesai
```

Contoh pattern explicit context:

```java
public record ClientCallContext(
    String correlationId,
    String traceId,
    String tenant,
    String operation
) {}
```

Lalu client method menerima context:

```java
PaymentResult createPayment(CreatePaymentCommand command, ClientCallContext context);
```

Ini lebih eksplisit daripada berharap semua layer membaca `ThreadLocal`.

---

## 10. Redaction: Observability Harus Aman

Redaction bukan kosmetik. Ini security control.

### 10.1 Data yang Harus Diredact

Headers:

```text
Authorization
Proxy-Authorization
Cookie
Set-Cookie
X-API-Key
API-Key
X-Auth-Token
X-CSRF-Token
X-Signature
X-Client-Secret
```

Query parameters:

```text
token
access_token
refresh_token
apikey
api_key
key
secret
signature
password
email
phone
nric
ssn
nik
```

Body fields:

```text
password
secret
token
refreshToken
accessToken
clientSecret
cardNumber
cvv
pin
email
phone
address
identityNumber
bankAccount
```

### 10.2 Redaction Strategy

Ada beberapa strategi:

```text
remove
mask
hash
classify
summarize
```

Contoh:

```text
Authorization: Bearer eyJhbGciOi...
→ Authorization: <redacted>

email=user@example.com
→ email=<redacted>

account=1234567890
→ account_hash=sha256:ab12...
```

Namun hashing juga harus hati-hati:

```text
- hash tanpa salt bisa brute-force untuk domain kecil
- hash tetap data derived yang mungkin sensitif
- jangan jadikan hash high-cardinality metric tag
```

### 10.3 Allowlist Lebih Aman daripada Blocklist

Untuk logging headers, pendekatan aman:

```text
allowlist:
  Content-Type
  Accept
  User-Agent
  X-Correlation-ID
  traceparent
  Idempotency-Key? maybe partial only
```

Bukan:

```text
log semua header kecuali Authorization
```

Karena sistem nyata sering punya custom sensitive header yang tidak diketahui blocklist.

### 10.4 Body Logging

Default rule:

```text
Do not log full body in production.
```

Alternatif aman:

```text
- log schema/type
- log body size
- log hash only if needed and approved
- log validation error path, not value
- log sanitized subset
- enable temporary debug with sampling and strict redaction
```

Contoh:

```json
{
  "event": "outbound_http_decode_failed",
  "client": "customer-registry",
  "operation": "lookup-customer",
  "status": 200,
  "response_content_type": "application/json",
  "response_size_bytes": 842,
  "json_error_path": "$.customer.birthDate",
  "error": "invalid_date_format"
}
```

Bukan:

```text
Failed to parse response: { "name": "...", "birthDate": "...", "identityNo": "..." }
```

---

## 11. Cardinality Control

Observability system bisa jatuh karena cardinality.

Cardinality adalah jumlah kombinasi label/tag unik.

Contoh buruk:

```text
metric: http.client.duration
labels:
  client=payment
  url=/payment/tx/123
  userId=998877
  traceId=abc123
```

Setiap request bisa membuat time series baru.

Akibat:

```text
- metric backend mahal
- query lambat
- storage meledak
- alert tidak stabil
- telemetry drop
```

### 11.1 Safe Tags

```text
client
operation
method
route_template
status_code/status_class
outcome
failure_kind
region/env
```

### 11.2 Dangerous Tags

```text
raw_url
query_string
user_id
request_id
trace_id
correlation_id
transaction_id
email
ip_address
exception_message
```

### 11.3 Route Template Problem

Kalau framework/library tidak tahu route template, kita harus supply sendiri dari client operation.

Misalnya:

```java
ExternalOperation op = new ExternalOperation(
    "customer-registry",
    "lookup-customer",
    "GET",
    "/v1/customers/{customerId}"
);
```

Jangan mengandalkan raw URI untuk metric.

---

## 12. Instrumentation Layer: Di Mana Observability Dipasang?

Ada beberapa layer:

```text
1. Transport layer
   → OkHttp EventListener/interceptor
   → Apache exec interceptor
   → JDK wrapper
   → Reactor Netty metrics

2. Client adapter layer
   → PaymentGatewayClient
   → CustomerRegistryClient

3. Resilience policy layer
   → retry/circuit/bulkhead/fallback decorators

4. Application use case layer
   → business operation context
```

### 12.1 Transport Layer Observability

Kelebihan:

```text
- dekat dengan network lifecycle
- bisa melihat DNS/connect/TLS/pool
- reusable untuk semua clients
```

Kekurangan:

```text
- tidak selalu tahu domain operation
- raw URL risk
- sulit mapping ke business context
```

### 12.2 Adapter Layer Observability

Kelebihan:

```text
- tahu operation name
- tahu tenant/context
- tahu domain outcome
- bisa classify external error
```

Kekurangan:

```text
- tidak selalu tahu detail transport phase
```

### 12.3 Best Practice

Gunakan dua level:

```text
transport instrumentation
→ low-level timing/failure

client adapter instrumentation
→ operation-level semantic outcome
```

---

## 13. JDK HttpClient Observability Pattern

JDK `HttpClient` tidak menyediakan interceptor API seperti OkHttp. Jadi observability biasanya dipasang dengan wrapper.

### 13.1 Wrapper Pattern

```java
public final class ObservedJdkHttpClient {
    private final HttpClient delegate;
    private final ClientTelemetry telemetry;

    public ObservedJdkHttpClient(HttpClient delegate, ClientTelemetry telemetry) {
        this.delegate = delegate;
        this.telemetry = telemetry;
    }

    public <T> HttpResponse<T> send(
            ExternalOperation operation,
            HttpRequest request,
            HttpResponse.BodyHandler<T> bodyHandler,
            ClientCallContext context
    ) throws IOException, InterruptedException {
        long start = System.nanoTime();
        ClientSpan span = telemetry.startSpan(operation, request, context);

        try {
            HttpResponse<T> response = delegate.send(request, bodyHandler);
            long durationNs = System.nanoTime() - start;

            telemetry.recordSuccess(operation, response.statusCode(), durationNs, context, span);
            return response;
        } catch (IOException | InterruptedException e) {
            long durationNs = System.nanoTime() - start;
            telemetry.recordFailure(operation, classify(e), durationNs, context, span);
            throw e;
        } finally {
            span.end();
        }
    }
}
```

### 13.2 Async Variant

```java
public <T> CompletableFuture<HttpResponse<T>> sendAsync(
        ExternalOperation operation,
        HttpRequest request,
        HttpResponse.BodyHandler<T> bodyHandler,
        ClientCallContext context
) {
    long start = System.nanoTime();
    ClientSpan span = telemetry.startSpan(operation, request, context);

    return delegate.sendAsync(request, bodyHandler)
        .whenComplete((response, throwable) -> {
            long durationNs = System.nanoTime() - start;

            if (throwable == null) {
                telemetry.recordSuccess(operation, response.statusCode(), durationNs, context, span);
            } else {
                telemetry.recordFailure(operation, classify(throwable), durationNs, context, span);
            }

            span.end();
        });
}
```

Perhatikan:

```text
- context harus explicit atau dipropagasi
- cancellation harus direkam
- CompletionException harus di-unwrap
- timeout harus diklasifikasi
```

---

## 14. OkHttp Observability Pattern

OkHttp punya dua hook utama:

```text
Interceptor
EventListener
```

### 14.1 Interceptor

Interceptor cocok untuk:

```text
- menambah correlation header
- menambah trace context jika instrumentation manual
- structured logging request/response summary
- semantic response classification ringan
- redaction
```

Contoh:

```java
public final class CorrelationInterceptor implements Interceptor {
    private final CorrelationContextProvider contextProvider;

    public CorrelationInterceptor(CorrelationContextProvider contextProvider) {
        this.contextProvider = contextProvider;
    }

    @Override
    public Response intercept(Chain chain) throws IOException {
        ClientCallContext context = contextProvider.current();

        Request request = chain.request().newBuilder()
            .header("X-Correlation-ID", context.correlationId())
            .build();

        return chain.proceed(request);
    }
}
```

### 14.2 Logging Interceptor Danger

OkHttp punya logging interceptor, tetapi level BODY di production berbahaya.

Prinsip:

```text
- BODY logging hanya untuk local/dev atau temporary controlled diagnosis
- headers harus diredact
- query/body sensitive data tidak boleh bocor
- jangan aktifkan global BODY logging di production
```

### 14.3 EventListener

`EventListener` cocok untuk lifecycle timing:

```text
callStart
proxySelectStart/proxySelectEnd
dnsStart/dnsEnd
connectStart/connectEnd
secureConnectStart/secureConnectEnd
connectionAcquired
requestHeadersStart/requestHeadersEnd
requestBodyStart/requestBodyEnd
responseHeadersStart/responseHeadersEnd
responseBodyStart/responseBodyEnd
connectionReleased
callEnd
callFailed
```

Dengan ini kita bisa membangun phase timing:

```text
DNS duration
connect duration
TLS duration
request write duration
server wait duration
response body read duration
connection held duration
```

### 14.4 OkHttp EventListener Skeleton

```java
public final class MetricsEventListener extends EventListener {
    private final long callStartNanos = System.nanoTime();
    private long dnsStartNanos;
    private long connectStartNanos;
    private long tlsStartNanos;

    @Override
    public void dnsStart(Call call, String domainName) {
        dnsStartNanos = System.nanoTime();
    }

    @Override
    public void dnsEnd(Call call, String domainName, List<InetAddress> inetAddressList) {
        recordDuration("dns", System.nanoTime() - dnsStartNanos);
    }

    @Override
    public void connectStart(Call call, InetSocketAddress inetSocketAddress, Proxy proxy) {
        connectStartNanos = System.nanoTime();
    }

    @Override
    public void connectEnd(Call call, InetSocketAddress inetSocketAddress, Proxy proxy, Protocol protocol) {
        recordDuration("connect", System.nanoTime() - connectStartNanos);
    }

    @Override
    public void secureConnectStart(Call call) {
        tlsStartNanos = System.nanoTime();
    }

    @Override
    public void secureConnectEnd(Call call, Handshake handshake) {
        recordDuration("tls", System.nanoTime() - tlsStartNanos);
    }

    @Override
    public void callEnd(Call call) {
        recordDuration("total", System.nanoTime() - callStartNanos);
    }

    @Override
    public void callFailed(Call call, IOException ioe) {
        recordFailure(classify(ioe), System.nanoTime() - callStartNanos);
    }

    private void recordDuration(String phase, long nanos) {
        // send to metrics backend
    }

    private void recordFailure(String failureKind, long nanos) {
        // send to metrics/log/tracing backend
    }
}
```

Factory:

```java
OkHttpClient client = new OkHttpClient.Builder()
    .eventListenerFactory(call -> new MetricsEventListener())
    .addInterceptor(new CorrelationInterceptor(contextProvider))
    .build();
```

---

## 15. Retrofit Observability Pattern

Retrofit sendiri adalah declarative adapter di atas OkHttp.

Observability bisa dipasang di:

```text
OkHttp layer
→ transport metrics/logging/tracing

Retrofit call adapter/converter layer
→ response decode/error body parsing

Gateway wrapper layer
→ operation outcome/domain classification
```

### 15.1 Jangan Berhenti di OkHttp Metrics

OkHttp tahu:

```text
GET https://api.example.com/v1/users/123
status 404
```

Tetapi domain gateway tahu:

```text
CustomerRegistry.lookupCustomer
customer not found
not retryable
domain result = CustomerMissing
```

Jadi Retrofit client sebaiknya tetap dibungkus:

```java
public final class CustomerRegistryGateway {
    private final CustomerRegistryApi api;
    private final ClientTelemetry telemetry;

    public CustomerLookupResult lookupCustomer(CustomerId customerId, ClientCallContext context) {
        ExternalOperation op = ExternalOperation.of(
            "customer-registry",
            "lookup-customer",
            "GET",
            "/v1/customers/{customerId}"
        );

        return telemetry.observe(op, context, () -> {
            Response<CustomerDto> response = api.getCustomer(customerId.value()).execute();
            return mapResponse(response);
        });
    }
}
```

---

## 16. Apache HttpClient 5 Observability Pattern

Apache HttpClient 5 bisa diobservasi lewat:

```text
execution interceptors
connection manager stats
custom route planner/proxy logging
response handler wrapper
pool metrics polling
```

### 16.1 Pool Stats

Untuk pooling manager, metric penting:

```text
leased connections
available connections
pending connection requests
max connections
per-route leased/available/pending/max
```

Diagnosis:

```text
leased tinggi + pending tinggi
→ pool saturated

available rendah + pending tinggi
→ concurrency terlalu tinggi atau connection leak

per-route pending tinggi, total masih cukup
→ per-route limit terlalu kecil
```

### 16.2 Wrapper Execution Pattern

Walaupun Apache punya interceptor, operation-level telemetry tetap lebih mudah di wrapper:

```java
try (CloseableHttpResponse response = client.execute(request)) {
    int status = response.getCode();
    telemetry.recordStatus(op, status, duration);
    return handler.handle(response);
} catch (IOException e) {
    telemetry.recordFailure(op, classify(e), duration);
    throw e;
}
```

---

## 17. Spring Client Observability Pattern

Spring Boot dan Spring Framework modern punya observability integration berbasis Micrometer Observation.

### 17.1 RestClient / RestTemplate

Konsep:

```text
ObservationRegistry
ClientRequestObservationConvention
request observation
metrics/traces emitted via Micrometer/OpenTelemetry bridge
```

Yang harus diperhatikan:

```text
- route/template harus low-cardinality
- custom tags harus hati-hati
- jangan memasukkan user id/request id sebagai tag
- custom convention bisa menambah client/operation jika aman
```

### 17.2 WebClient

WebClient membawa tantangan context propagation Reactor.

Pastikan:

```text
- trace context masuk Reactor Context
- MDC bridging jika perlu
- filter tidak membaca body sembarangan
- error mapping tetap preserve observation outcome
```

### 17.3 Spring HTTP Interface

Untuk declarative HTTP interface Spring, tetap perlakukan sebagai API client boundary:

```text
interface method
→ generated proxy
→ RestClient/WebClient underneath
→ observation layer
→ gateway wrapper untuk domain semantics
```

---

## 18. OpenTelemetry untuk HTTP Client

OpenTelemetry menyediakan standardisasi telemetry:

```text
traces
metrics
logs context
semantic conventions
propagation
instrumentation agent/library
```

Ada dua pendekatan:

### 18.1 Auto Instrumentation

Java agent dapat menginstrument banyak library tanpa perubahan kode besar.

Kelebihan:

```text
- cepat diterapkan
- coverage luas
- cocok untuk baseline tracing
```

Kekurangan:

```text
- operation/domain name sering kurang presisi
- redaction/custom classification perlu konfigurasi tambahan
- tidak menggantikan client gateway telemetry
```

### 18.2 Manual Instrumentation

Manual span/metric di client boundary.

Kelebihan:

```text
- operation name akurat
- domain outcome bisa direkam
- retry/fallback bisa terlihat sesuai model aplikasi
```

Kekurangan:

```text
- butuh disiplin engineering
- raw instrumentation bisa inkonsisten tanpa abstraction
```

### 18.3 Best Practice

```text
auto instrumentation untuk baseline transport visibility
+ manual instrumentation di gateway/client adapter untuk semantic visibility
```

---

## 19. HTTP Client Telemetry Schema

Agar konsisten, buat schema internal.

Contoh:

```java
public record ExternalOperation(
    String clientName,
    String operationName,
    String method,
    String routeTemplate
) {}

public enum FailureKind {
    DNS_FAILURE,
    CONNECT_FAILURE,
    TLS_FAILURE,
    POOL_ACQUIRE_TIMEOUT,
    CONNECT_TIMEOUT,
    READ_TIMEOUT,
    WRITE_TIMEOUT,
    CALL_TIMEOUT,
    CONNECTION_RESET,
    HTTP_4XX,
    HTTP_5XX,
    RATE_LIMITED,
    DECODE_FAILURE,
    DOMAIN_REJECTION,
    AUTH_FAILURE,
    CANCELLED,
    UNKNOWN
}

public enum Outcome {
    SUCCESS,
    CLIENT_ERROR,
    SERVER_ERROR,
    TIMEOUT,
    TRANSPORT_ERROR,
    DECODE_ERROR,
    DOMAIN_ERROR,
    CANCELLED
}
```

Telemetry API:

```java
public interface ClientTelemetry {
    ClientSpan startSpan(ExternalOperation operation, ClientCallContext context);

    void recordAttemptStart(ExternalOperation operation, int attempt, ClientCallContext context);

    void recordAttemptResult(
        ExternalOperation operation,
        int attempt,
        Outcome outcome,
        FailureKind failureKind,
        Integer statusCode,
        long durationNanos,
        ClientCallContext context
    );

    void recordOperationResult(
        ExternalOperation operation,
        Outcome outcome,
        FailureKind failureKind,
        Integer finalStatusCode,
        int retryCount,
        long totalDurationNanos,
        ClientCallContext context
    );
}
```

Dengan schema seperti ini, semua client memakai bahasa observability yang sama.

---

## 20. Log Sampling

Tidak semua event perlu log penuh.

Sampling berguna untuk:

```text
- high-volume success logs
- repeated 404/400 expected
- downstream noisy failure
- debug body/headers sementara
```

Tetapi hati-hati:

```text
- jangan sampling semua ERROR critical
- jangan sampling audit event wajib
- jangan sampling security violation
- jangan sampling rare failure tanpa aggregate metric
```

Pattern:

```text
metrics record 100%
traces sampled according to policy
logs sampled for high-volume non-critical events
critical logs always emitted
```

---

## 21. Alerting untuk HTTP Client

Alert harus actionable.

Contoh alert buruk:

```text
HTTP client error occurred
```

Contoh alert lebih baik:

```text
payment-gateway create-payment 5xx rate > 5% for 5 minutes
customer-registry lookup-customer P95 latency > 2s for 10 minutes
shipping-api pool pending connections > 20 for 3 minutes
identity-provider token refresh failure > 10/min
external-tax-api retry exhausted > 2% for 5 minutes
```

### 21.1 Alert Dimensions

```text
client
operation
region/env
failure class
impact class
```

### 21.2 Avoid Alert Storm

Gunakan hierarchy:

```text
service-level symptom alert
→ downstream dependency panel
→ operation-level drilldown
```

Jangan bikin alert untuk setiap endpoint kecil kecuali critical.

---

## 22. Dashboard HTTP Client

Dashboard production sebaiknya punya:

```text
1. Request rate per client/operation
2. Error rate by outcome/failure kind
3. Latency P50/P95/P99
4. Status code distribution
5. Retry rate and retry exhausted rate
6. Timeout breakdown
7. Circuit breaker state
8. Rate limiting/load shedding count
9. Pool stats / queued calls
10. Top slow downstream operations
11. Trace exemplar links
12. Recent sanitized failure logs
```

### 22.1 Golden Signals untuk HTTP Client

```text
Traffic
→ request rate

Errors
→ failure/error rate

Latency
→ duration percentiles

Saturation
→ pool/concurrency/queue saturation
```

Tambahan khusus:

```text
retry pressure
fallback usage
token refresh failures
rate limit response
```

---

## 23. Failure Diagnosis dengan Observability

### 23.1 Scenario: P95 Latency Naik

Check:

```text
- client/operation mana?
- status code berubah?
- retry count naik?
- timeout naik?
- DNS/connect/TLS phase naik?
- pool acquire naik?
- downstream server wait naik?
- body read naik?
- response size naik?
```

Interpretasi:

```text
DNS duration naik
→ resolver/CoreDNS/network DNS issue

connect duration naik
→ route/LB/firewall/downstream capacity

TLS duration naik
→ certificate/proxy/CPU/handshake issue

pool acquire naik
→ pool saturated/local leak/concurrency spike

response header wait naik
→ downstream app slow

response body read naik
→ large payload/network throughput issue
```

### 23.2 Scenario: 401 Spike

Check:

```text
- token refresh success/failure?
- token expiry skew?
- clock drift?
- auth server latency?
- credential rotation?
- tenant-specific credential issue?
- retry after refresh happening?
```

### 23.3 Scenario: 429 Spike

Check:

```text
- request rate naik?
- retry amplification?
- distributed instances total rate?
- Retry-After respected?
- local limiter configured?
- tenant causing spike?
```

### 23.4 Scenario: Pool Exhaustion

Check:

```text
- response body closed?
- active vs idle vs pending connections?
- per-route limit?
- queued calls?
- downstream latency increased?
- concurrency spike?
- streaming response holding connection too long?
```

### 23.5 Scenario: TLS Failure

Check:

```text
- certificate expired?
- chain incomplete?
- hostname mismatch?
- truststore changed?
- mTLS client cert expired?
- proxy TLS inspection?
- protocol/cipher mismatch?
```

---

## 24. Privacy, Compliance, dan Audit Boundary

Dalam regulated/enterprise system, observability harus memenuhi constraint:

```text
- least data exposure
- retention policy
- access control
- auditability
- incident reconstruction
- PII protection
- secret protection
```

Jangan menyamakan debug log dengan audit log.

### 24.1 Debug/Operational Log

Untuk engineer:

```text
- sanitized diagnostic metadata
- technical failure kind
- duration/status/retry info
- trace/correlation link
```

### 24.2 Audit Log

Untuk governance/business/legal trace:

```text
- who initiated
- what business action
- when
- external system involved
- final outcome
- reference id if allowed
- no secret/payload dump
```

### 24.3 Security Log

Untuk security monitoring:

```text
- blocked redirect
- SSRF allowlist violation
- invalid certificate
- suspicious auth failure
- token refresh abuse
```

---

## 25. Code Pattern: Sanitizer

```java
public final class HttpSanitizer {
    private static final Set<String> SENSITIVE_HEADERS = Set.of(
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        "api-key",
        "x-auth-token",
        "x-client-secret"
    );

    private static final Set<String> SENSITIVE_QUERY_KEYS = Set.of(
        "token",
        "access_token",
        "refresh_token",
        "apikey",
        "api_key",
        "key",
        "secret",
        "signature",
        "password",
        "email",
        "phone"
    );

    public String sanitizeHeader(String name, String value) {
        if (name == null) return "";
        if (SENSITIVE_HEADERS.contains(name.toLowerCase(Locale.ROOT))) {
            return "<redacted>";
        }
        return value;
    }

    public String sanitizeQueryParam(String name, String value) {
        if (name == null) return "";
        if (SENSITIVE_QUERY_KEYS.contains(name.toLowerCase(Locale.ROOT))) {
            return "<redacted>";
        }
        return value;
    }
}
```

Dalam produksi, gunakan allowlist jika memungkinkan.

---

## 26. Code Pattern: Observed Operation Wrapper

```java
public final class ObservedClientOperationExecutor {
    private final ClientTelemetry telemetry;

    public ObservedClientOperationExecutor(ClientTelemetry telemetry) {
        this.telemetry = telemetry;
    }

    public <T> T execute(
            ExternalOperation operation,
            ClientCallContext context,
            Callable<T> action,
            Function<Throwable, FailureKind> classifier
    ) {
        long start = System.nanoTime();
        ClientSpan span = telemetry.startSpan(operation, context);

        try {
            T result = action.call();
            long duration = System.nanoTime() - start;
            telemetry.recordOperationResult(
                operation,
                Outcome.SUCCESS,
                null,
                null,
                0,
                duration,
                context
            );
            return result;
        } catch (Throwable t) {
            long duration = System.nanoTime() - start;
            FailureKind failureKind = classifier.apply(t);
            telemetry.recordOperationResult(
                operation,
                mapOutcome(failureKind),
                failureKind,
                extractStatus(t),
                extractRetryCount(t),
                duration,
                context
            );
            throw rethrow(t);
        } finally {
            span.end();
        }
    }

    private Outcome mapOutcome(FailureKind failureKind) {
        return switch (failureKind) {
            case CONNECT_TIMEOUT, READ_TIMEOUT, WRITE_TIMEOUT, CALL_TIMEOUT, POOL_ACQUIRE_TIMEOUT -> Outcome.TIMEOUT;
            case HTTP_4XX -> Outcome.CLIENT_ERROR;
            case HTTP_5XX -> Outcome.SERVER_ERROR;
            case DECODE_FAILURE -> Outcome.DECODE_ERROR;
            case DOMAIN_REJECTION -> Outcome.DOMAIN_ERROR;
            case CANCELLED -> Outcome.CANCELLED;
            default -> Outcome.TRANSPORT_ERROR;
        };
    }

    private RuntimeException rethrow(Throwable t) {
        if (t instanceof RuntimeException re) return re;
        return new RuntimeException(t);
    }

    private Integer extractStatus(Throwable t) {
        return null;
    }

    private int extractRetryCount(Throwable t) {
        return 0;
    }
}
```

Catatan Java 8:

```text
Switch expression belum tersedia di Java 8.
Gunakan switch statement atau if/else.
```

---

## 27. Java 8–25 Considerations

### 27.1 Java 8

Umum:

```text
- Apache HttpClient 4/5
- OkHttp
- Retrofit
- RestTemplate
- CompletableFuture tersedia
```

Observability concern:

```text
- no JDK HttpClient standard
- manual wrapper lebih umum
- MDC propagation ke CompletableFuture harus eksplisit
- Java agent instrumentation bisa membantu
```

### 27.2 Java 11+

```text
- JDK HttpClient tersedia
- sendAsync berbasis CompletableFuture
- wrapper observability penting karena tidak ada interceptor native
```

### 27.3 Java 17

```text
- LTS modern baseline
- records/sealed classes membantu modelling telemetry/error
- pattern matching mulai berguna tergantung versi
```

### 27.4 Java 21+

```text
- virtual threads membuat blocking client lebih scalable
- tetapi observability tetap harus explicit
- MDC/ThreadLocal behavior perlu diuji
- per-request virtual thread bisa memudahkan mental model, tetapi tidak menghilangkan timeout/bulkhead need
```

### 27.5 Java 25

```text
- gunakan API modern JDK bila cocok
- tetap validasi library instrumentation compatibility
- jangan berasumsi semua observability otomatis benar hanya karena framework modern
```

---

## 28. Anti-Patterns

### 28.1 Log Full Request/Response Body di Production

Bahaya:

```text
- PII leak
- secret leak
- log cost explosion
- compliance issue
```

### 28.2 Metric Tag Pakai Full URL

Bahaya:

```text
- cardinality explosion
- PII leak
- dashboard rusak
```

### 28.3 Semua Exception Jadi `DOWNSTREAM_ERROR`

Bahaya:

```text
- tidak bisa bedakan DNS vs timeout vs decode vs 4xx
- retry salah
- alert tidak actionable
```

### 28.4 Hanya Mengandalkan APM Auto Instrumentation

Auto instrumentation berguna, tetapi sering tidak tahu:

```text
- domain operation
- retry semantics
- fallback usage
- semantic failure
- idempotency decision
```

### 28.5 Logging Tanpa Correlation ID

Akibat:

```text
- log tidak bisa dirangkai
- incident diagnosis lambat
- support sulit mencari request tertentu
```

### 28.6 Correlation ID Jadi Metric Tag

Bahaya:

```text
- cardinality unbounded
```

### 28.7 Retry Tidak Terlihat di Metrics

Akibat:

```text
- downstream bisa overload tanpa terlihat
- operation success menyembunyikan attempt failures
```

### 28.8 Redaction Hanya di Logger, Bukan di Telemetry Pipeline

Bahaya:

```text
- data bisa bocor lewat span attributes atau metric labels
- bukan hanya log yang perlu aman
```

---

## 29. Design Review Checklist

Gunakan checklist ini saat review HTTP client:

```text
[ ] Apakah setiap client punya client.name yang stabil?
[ ] Apakah setiap operation punya operation.name yang stabil?
[ ] Apakah route/template low-cardinality?
[ ] Apakah raw URL/query tidak dipakai sebagai metric tag?
[ ] Apakah Authorization/Cookie/API key diredact?
[ ] Apakah body logging disabled by default?
[ ] Apakah 4xx/5xx/timeout/decode/domain error dibedakan?
[ ] Apakah retry count direkam?
[ ] Apakah retry exhausted direkam?
[ ] Apakah fallback usage direkam?
[ ] Apakah circuit state observable?
[ ] Apakah rate limited/load shed event observable?
[ ] Apakah pool stats observable untuk pooled client?
[ ] Apakah correlation ID dipropagate?
[ ] Apakah trace context dipropagate?
[ ] Apakah async context propagation diuji?
[ ] Apakah MDC dibersihkan?
[ ] Apakah metric tags aman cardinality-nya?
[ ] Apakah alert actionable?
[ ] Apakah dashboard memperlihatkan traffic/error/latency/saturation?
[ ] Apakah log cukup untuk incident tanpa membocorkan data?
```

---

## 30. Production Readiness Template

Untuk setiap external HTTP client, dokumentasikan:

```yaml
client: payment-gateway
owner: payments-team
base_url_config_key: clients.payment.base-url
operations:
  - name: create-payment
    method: POST
    route: /v1/payments
    idempotent: false
    idempotency_key: required
    timeout_ms: 3000
    retry: only-before-send-or-idempotency-key
    alerts:
      - 5xx_rate
      - p95_latency
      - retry_exhausted
telemetry:
  metrics:
    - duration
    - status
    - retry_count
    - timeout_kind
  traces:
    propagation: w3c
    span_name: PaymentGateway.createPayment
  logs:
    body_logging: disabled
    header_redaction: enabled
    query_redaction: enabled
security:
  auth: oauth2-client-credentials
  token_redaction: required
  tls: default-truststore
  mTLS: false
```

---

## 31. Top 1% Engineering Heuristics

1. **Observability is part of the client contract, not an afterthought.**

2. **Never log what you cannot justify retaining.**

3. **Metric tags must be designed like database indexes: useful, bounded, and stable.**

4. **Trace shows causality; metric shows scale; log shows detail. Do not force one pillar to do all jobs.**

5. **A downstream call has at least two outcomes: transport outcome and domain outcome. Observe both.**

6. **Retry without retry telemetry is invisible load amplification.**

7. **Timeout without timeout kind is weak evidence.**

8. **Raw URL is almost never a safe metric dimension.**

9. **Auto instrumentation gives baseline; client gateway instrumentation gives meaning.**

10. **Redaction must happen before data leaves process boundary.**

---

## 32. Summary

HTTP client observability yang baik membuat outbound dependency menjadi jelas:

```text
who called what
why it was called
where it went
how long it took
what happened
what failed
whether retry/fallback happened
how it affected domain operation
how to diagnose it safely
```

Mental model final:

```text
HTTP client observability
= diagnostic clarity
+ production safety
+ bounded cardinality
+ secure redaction
+ causal tracing
+ useful metrics
+ actionable logs
```

Kalau HTTP client hanya punya log `Exception calling API`, sistem masih berada di level utility.

Kalau HTTP client punya structured telemetry, safe redaction, domain-aware outcome, retry visibility, trace propagation, metric discipline, dan production playbook, maka ia sudah menjadi subsystem yang layak untuk sistem besar.

---

## 33. Hubungan ke Part Berikutnya

Part ini menjelaskan bagaimana membuat outbound call terlihat dan aman didiagnosis.

Part berikutnya akan masuk ke:

```text
Part 22 — Testing HTTP Clients: Unit, Contract, Integration, Chaos, Mock Server
```

Kita akan membahas bagaimana membuktikan client behavior:

```text
- URI construction benar
- headers aman
- auth refresh bekerja
- retry tidak salah
- timeout terjadi sesuai policy
- error mapping stabil
- body leak tidak terjadi
- tracing/correlation terpropagasi
- mock server dan fault injection digunakan dengan benar
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./20-error-modelling-status-transport-protocol-domain-failure.md">⬅️ Part 20 — Error Modelling: Status Code, Transport Failure, Protocol Failure, Domain Failure</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./22-testing-http-clients-unit-contract-integration-chaos-mockserver.md">Part 22 — Testing HTTP Clients: Unit, Contract, Integration, Chaos, Mock Server ➡️</a>
</div>

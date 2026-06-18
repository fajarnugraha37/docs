# Part 13 — Circuit Breaker, Timeout, Retry, dan Fallback Composition

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `13-circuit-breaker-timeout-retry-fallback-composition.md`  
> Target: Java 8–25, backend/service-to-service/third-party API client engineering  
> Level: Advanced / production-grade

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas timeout, retry, rate limiting, throttling, bulkhead, dan load shedding secara terpisah. Tetapi di production, pola-pola tersebut hampir tidak pernah berdiri sendiri.

Biasanya HTTP client production memiliki komposisi seperti ini:

```text
application code
  → validation
  → domain client adapter
  → fallback policy
  → circuit breaker
  → retry policy
  → timeout / deadline
  → bulkhead / concurrency limiter
  → rate limiter
  → HTTP library
  → network
  → downstream service
```

Masalahnya: urutan tersebut **tidak netral**.

Policy yang sama, dengan urutan berbeda, bisa menghasilkan perilaku yang sangat berbeda:

```text
retry outside circuit breaker
  → breaker melihat 1 logical call
  → retry terjadi di dalam satu call
  → failure count lebih halus

circuit breaker outside retry
  → breaker bisa melihat setiap attempt
  → failure count naik lebih cepat
  → breaker lebih agresif terbuka
```

Keduanya bisa benar, tergantung tujuan. Yang salah adalah memakai default tanpa memahami konsekuensinya.

Part ini bertujuan membentuk mental model untuk mendesain komposisi resilience policy pada Java HTTP client sehingga kita bisa menjawab pertanyaan seperti:

- Apakah timeout harus berada di dalam retry atau di luar retry?
- Apakah circuit breaker menghitung tiap attempt atau tiap business operation?
- Apakah fallback boleh mengembalikan data stale?
- Apakah fallback boleh dipakai untuk operasi command/write?
- Apakah retry boleh berjalan ketika circuit breaker half-open?
- Bagaimana menghindari retry storm?
- Bagaimana menghindari fallback yang menyembunyikan outage?
- Bagaimana mengobservasi policy chain secara benar?

---

## 2. Core Mental Model

HTTP client resilience bukan satu fitur. Ia adalah **control system**.

Setiap policy mengubah satu aspek dari sistem:

| Policy | Mengontrol | Risiko Jika Salah |
|---|---|---|
| Timeout | Waktu tunggu | Terlalu pendek: false failure. Terlalu panjang: thread/pool tertahan |
| Retry | Recovery dari transient failure | Retry storm, duplicate side effect, latency amplification |
| Circuit breaker | Menghentikan call ke downstream yang sedang buruk | Fail-fast terlalu agresif atau terlalu lambat |
| Bulkhead | Membatasi concurrency/isolasi resource | Starvation jika terlalu kecil, overload jika terlalu besar |
| Rate limiter | Membatasi request per waktu | Underutilization atau tetap melanggar limit downstream |
| Fallback | Memberi alternatif ketika primary gagal | Data salah, outage tersembunyi, compliance issue |

### 2.1 Resilience Policy Mengubah Beban

Jangan berpikir retry hanya “meningkatkan reliability”. Retry juga meningkatkan beban.

Jika incoming request 1.000 RPS dan setiap call punya retry max 3 attempt:

```text
best case downstream load  = 1.000 RPS
worst case downstream load = 3.000 RPS
```

Jika downstream sudah lambat, retry bisa memperburuk keadaan:

```text
downstream slow
  → caller timeout
  → caller retry
  → more calls hit downstream
  → downstream slower
  → more timeout
  → retry storm
```

Karena itu retry harus selalu dibatasi oleh:

- idempotency
- total timeout/deadline
- retry budget
- rate limit
- concurrency limit
- circuit breaker

### 2.2 Timeout Mengubah Resource Retention

Timeout bukan hanya soal UX. Timeout menentukan berapa lama resource caller ditahan:

- thread
- virtual thread continuation
- socket
- connection pool slot
- memory buffer
- request context
- transaction context
- MDC/log context
- downstream capacity

Timeout terlalu panjang membuat sistem tampak “sabar”, tetapi sebenarnya menyimpan terlalu banyak work-in-progress.

Timeout terlalu pendek membuat sistem tampak “cepat gagal”, tetapi bisa memotong request yang sebenarnya sehat pada P95/P99 normal.

### 2.3 Circuit Breaker Mengubah Failure Visibility

Circuit breaker bukan retry. Circuit breaker adalah mekanisme untuk **berhenti mencoba sementara** ketika sinyal kegagalan melewati threshold.

State umum:

```text
CLOSED
  calls allowed
  metrics collected
  if failure/slow-call threshold exceeded → OPEN

OPEN
  calls rejected immediately
  no network call made
  after wait duration → HALF_OPEN

HALF_OPEN
  limited probe calls allowed
  if probes succeed → CLOSED
  if probes fail → OPEN
```

Circuit breaker menjaga caller dari downstream yang sedang bermasalah dan menjaga downstream dari tekanan tambahan.

### 2.4 Fallback Mengubah Semantics

Fallback paling berbahaya karena terlihat “membantu”.

Fallback bukan sekadar:

```text
if failed return default
```

Fallback mengubah arti response.

Contoh aman:

```text
recommendation service unavailable
  → return empty recommendation list
  → user still can proceed
```

Contoh berbahaya:

```text
payment authorization service unavailable
  → return approved
```

Dalam sistem enterprise/regulatory, fallback harus diperlakukan sebagai keputusan bisnis dan audit, bukan hanya technical convenience.

---

## 3. Vocabulary yang Harus Presisi

### 3.1 Attempt vs Operation

Ini perbedaan fundamental.

```text
operation = satu niat bisnis/logical call
attempt   = satu percobaan network ke downstream
```

Contoh:

```text
operation: createCaseInExternalSystem(caseId=123)

attempt 1: POST /cases → timeout
attempt 2: POST /cases → connection reset
attempt 3: POST /cases → 201 Created
```

Dari sisi business operation, ini sukses.

Dari sisi network attempts, ada 2 failure dan 1 success.

Circuit breaker perlu tahu mau menghitung yang mana.

### 3.2 Failure vs Slow Call

Circuit breaker modern biasanya tidak hanya menghitung failure. Ia juga bisa menghitung slow call.

```text
failure call:
  exception, timeout, 5xx, mapped error

slow call:
  response berhasil tetapi melewati threshold latency
```

Kenapa slow call penting?

Karena sebelum downstream benar-benar error, sering kali ia menjadi lambat dulu.

```text
downstream saturation
  → latency naik
  → caller threads tertahan
  → pool penuh
  → timeout mulai muncul
  → 5xx mulai muncul
```

Jika breaker hanya melihat 5xx, ia terlambat.

### 3.3 Timeout vs TimeLimiter vs Deadline

Istilah sering bercampur.

```text
timeout:
  durasi maksimum untuk satu phase atau call

time limiter:
  wrapper policy yang membatasi durasi eksekusi function/future

deadline:
  absolute latest time seluruh operation harus selesai
```

Contoh:

```text
incoming request budget: 800 ms
internal processing: 100 ms
HTTP operation deadline: remaining 700 ms
retry attempt 1 max: 250 ms
backoff: 50 ms
retry attempt 2 max: 250 ms
final mapping/logging: 50 ms
```

Top-tier design memakai deadline-aware retry, bukan timeout konstan per attempt tanpa melihat sisa waktu.

### 3.4 Fallback vs Degradation vs Compensation

```text
fallback:
  return alternative result immediately

degradation:
  reduce feature quality, scope, freshness, or precision

compensation:
  perform later action to repair/complete an earlier partial failure
```

Contoh:

```text
fallback:
  use cached exchange rate

degradation:
  hide enrichment panel but keep main transaction page

compensation:
  enqueue failed notification for later redelivery
```

Jangan campur ketiganya.

---

## 4. Circuit Breaker Deep Dive

### 4.1 Apa yang Dilindungi Circuit Breaker?

Circuit breaker melindungi dua pihak sekaligus:

1. Caller
   - thread tidak habis
   - request tidak menunggu sia-sia
   - pool tidak terisi oleh call yang kemungkinan gagal
   - latency tail tidak makin parah

2. Downstream
   - tidak terus dihantam request ketika sedang rusak
   - punya waktu recovery
   - tidak diperburuk retry storm

### 4.2 Circuit Breaker Bukan Health Check

Breaker tidak selalu sama dengan health check.

Health check biasanya menjawab:

```text
apakah service technically alive?
```

Circuit breaker menjawab:

```text
apakah untuk traffic nyata saat ini, downstream ini layak dicoba?
```

Downstream bisa health check `UP`, tetapi untuk endpoint tertentu sedang lambat.

Karena itu breaker sering lebih tepat dibuat per dependency + operation class, bukan hanya per hostname.

Contoh:

```text
external-profile-api.readProfile.breaker
external-profile-api.searchProfiles.breaker
external-payment-api.authorizePayment.breaker
external-payment-api.capturePayment.breaker
```

### 4.3 Breaker Granularity

Granularity terlalu kasar:

```text
one breaker for all calls to api.vendor.com
```

Masalah:

- endpoint read ringan ikut mati karena endpoint heavy report gagal
- POST command ikut dipengaruhi GET search
- tenant A issue mematikan tenant B

Granularity terlalu halus:

```text
one breaker per URL path + user + query
```

Masalah:

- metric sample terlalu kecil
- breaker tidak pernah stabil
- cardinality meledak
- observability sulit

Granularity yang biasanya sehat:

```text
per downstream system
  + per operation class
  + optionally per tenant criticality
```

Contoh:

```text
onemap.geocode.lookup
identity-provider.token.issue
payment.authorization.command
case-registry.case.read
case-registry.case.create
```

### 4.4 Failure Classification untuk Circuit Breaker

Tidak semua failure harus dihitung sebagai breaker failure.

| Event | Count as Breaker Failure? | Reason |
|---|---:|---|
| DNS failure | Ya | Dependency/network path unreachable |
| Connect timeout | Ya | Tidak bisa establish connection |
| TLS handshake failure | Biasanya ya | Dependency/security path failing |
| Read timeout | Ya | Downstream too slow/unresponsive |
| 500 | Ya | Downstream internal failure |
| 502/503/504 | Ya | Downstream/gateway failure |
| 429 | Tergantung | Bisa rate limit, lebih cocok rate limiter/backoff |
| 400 | Tidak | Caller bug atau bad request |
| 401 | Tidak langsung | Auth issue, kecuali token service down |
| 403 | Tidak | Permission/config issue |
| 404 | Biasanya tidak | Domain result, bukan service failure |
| 409 | Biasanya tidak | Business conflict |
| JSON mapping error | Tergantung | Contract drift bisa dependency failure |

Rule praktis:

```text
Count failure jika event menunjukkan downstream/path tidak mampu melayani request valid.
Jangan count failure jika event menunjukkan caller mengirim request invalid atau domain result normal.
```

### 4.5 Slow Call Classification

Slow call perlu threshold sendiri.

Contoh:

```text
normal P95 endpoint: 180 ms
normal P99 endpoint: 350 ms
client timeout: 700 ms
slow call threshold: 400 ms
```

Jika banyak call > 400 ms, breaker bisa terbuka sebelum timeout massal terjadi.

Tetapi slow threshold tidak boleh terlalu rendah.

Jika threshold diset di dekat P50 normal, breaker akan false-open saat traffic normal.

### 4.6 Half-Open Probe

Half-open adalah fase paling sering salah desain.

Ketika breaker open, setelah wait duration ia masuk half-open dan mengizinkan sedikit probe call.

Contoh buruk:

```text
breaker half-open
  → izinkan 100 request sekaligus
  → downstream baru recovery langsung dihantam lagi
  → gagal lagi
  → open lagi
```

Contoh lebih baik:

```text
breaker half-open
  → izinkan 3–10 probe call
  → no aggressive retry in half-open
  → jika sukses stabil → close
  → jika gagal → open lagi
```

Dalam half-open, retry perlu sangat hati-hati. Probe harus menguji downstream, bukan menyembunyikan failure dengan retry.

---

## 5. Timeout Composition

### 5.1 Timeout per Attempt vs Timeout per Operation

Contoh salah umum:

```text
maxAttempts = 3
callTimeout = 2s
```

Pertanyaan:

```text
Apakah 2s itu per attempt atau total operation?
```

Jika per attempt:

```text
worst-case = 3 × 2s + backoff
           = > 6s
```

Jika caller SLA 1s, ini sudah mustahil.

Model yang lebih sehat:

```text
operationDeadline = 900 ms
attemptTimeout    = min(250 ms, remainingBudget - safetyMargin)
backoff           = bounded by remainingBudget
```

### 5.2 Timeout Harus Dekat dengan Resource yang Dilindungi

Timeout bisa diterapkan di banyak layer:

```text
controller request timeout
service operation timeout
resilience TimeLimiter
HTTP call timeout
connect/read/write timeout
DB transaction timeout
```

Masalah muncul jika timeout luar lebih pendek dari timeout dalam, tetapi cancellation tidak dipropagasikan.

Contoh:

```text
controller timeout 1s
HTTP client timeout 10s
```

Jika controller menyerah setelah 1s tetapi HTTP call terus berjalan sampai 10s, maka resource tetap bocor secara logis.

Targetnya:

```text
outer timeout cancels inner work
inner timeout is shorter or aligned with remaining deadline
```

### 5.3 Connect vs Read vs Call Timeout dalam Policy Chain

Timeout level HTTP library tetap penting meskipun memakai resilience wrapper.

```text
resilience timeout:
  membatasi logical execution dari sudut caller

HTTP timeout:
  membatasi network phase spesifik
```

Jika hanya pakai wrapper timeout tetapi HTTP library tidak bisa dibatalkan dengan benar, socket bisa tetap aktif.

Jika hanya pakai HTTP timeout tetapi tidak ada operation deadline, total retry chain bisa terlalu lama.

---

## 6. Retry Composition

### 6.1 Retry di Dalam atau di Luar Circuit Breaker?

Ada dua komposisi utama.

#### Option A — Circuit Breaker Outside Retry

```text
circuitBreaker(
  retry(
    httpCall
  )
)
```

Artinya:

```text
breaker melihat hasil akhir logical operation
retry menyembunyikan transient attempt failure
```

Konsekuensi:

- breaker lebih stabil
- transient failure tidak langsung menaikkan failure count
- cocok untuk operasi read/idempotent dengan retry terbatas
- tetapi breaker bisa terlambat melihat degradasi attempt-level

#### Option B — Retry Outside Circuit Breaker

```text
retry(
  circuitBreaker(
    httpCall
  )
)
```

Artinya:

```text
breaker melihat tiap attempt
retry akan mencoba lagi jika breaker mengizinkan
```

Konsekuensi:

- breaker lebih cepat terbuka
- attempt failure terlihat jelas
- cocok jika setiap attempt memberi tekanan besar ke downstream
- tetapi breaker bisa terlalu agresif
- retry bisa langsung gagal jika breaker open

### 6.2 Mana yang Lebih Baik?

Tidak ada jawaban universal.

Untuk third-party API yang strict rate limit dan mahal:

```text
breaker outside retry + retry sangat terbatas
```

Atau bahkan:

```text
no retry for command
breaker counts final operation
```

Untuk downstream internal dengan transient network issue kecil:

```text
breaker outside retry
```

Untuk downstream yang sering overload dan retry bisa memperburuk:

```text
retry outside breaker atau no retry
breaker lebih cepat protect
```

Untuk half-open breaker:

```text
avoid retry or allow at most 1 carefully bounded retry
```

### 6.3 Retry Harus Deadline-Aware

Retry yang tidak deadline-aware adalah bug desain.

Pseudo model:

```java
Instant deadline = now().plusMillis(800);

for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    long remaining = millisUntil(deadline);
    if (remaining <= minimumUsefulTimeMs) {
        throw new DeadlineExceededException();
    }

    Duration attemptTimeout = min(config.maxAttemptTimeout(), Duration.ofMillis(remaining - safetyMargin));

    try {
        return callWithTimeout(request, attemptTimeout);
    } catch (Exception e) {
        if (!isRetryable(e) || attempt == maxAttempts) throw e;

        Duration delay = backoffDelay(attempt);
        if (delay.toMillis() >= millisUntil(deadline) - safetyMargin) throw e;
        sleep(delay);
    }
}
```

### 6.4 Retry Harus Idempotency-Aware

Retry aman jika:

```text
operation is naturally idempotent
OR operation has idempotency key
OR duplicate side effect is acceptable and compensated
```

Retry berbahaya jika:

```text
POST creates resource without idempotency key
POST charges money
POST sends email/SMS
POST submits legal/regulatory action
POST mutates irreversible state
```

---

## 7. Fallback Composition

### 7.1 Fallback di Mana Diletakkan?

Fallback biasanya outermost policy dari sudut application:

```text
fallback(
  circuitBreaker(
    retry(
      timeout(
        httpCall
      )
    )
  )
)
```

Artinya:

```text
jika semua policy primary path gagal, fallback diputuskan berdasarkan semantics operation
```

Namun fallback tidak harus selalu outermost. Kadang fallback spesifik diletakkan dekat operasi tertentu.

Contoh fan-out:

```text
getDashboard()
  → main account call must succeed
  → recommendation call may fallback empty
  → notification count may fallback stale cache
  → compliance alert call must not fallback silently
```

### 7.2 Jenis Fallback

#### 7.2.1 Empty Fallback

```text
recommendations unavailable → []
```

Aman untuk optional enrichment.

Tidak aman untuk mandatory decision.

#### 7.2.2 Static Fallback

```text
feature flag service unavailable → default config
```

Aman jika default konservatif.

Contoh:

```text
if risk score unavailable → manual review required
```

Bukan:

```text
if risk score unavailable → approve automatically
```

#### 7.2.3 Cached Fallback

```text
exchange rate API unavailable → last known rate if not older than 15 minutes
```

Harus punya freshness metadata.

```java
record CachedValue<T>(T value, Instant fetchedAt, Duration maxAge) {
    boolean isFreshEnough(Instant now) {
        return fetchedAt.plus(maxAge).isAfter(now);
    }
}
```

#### 7.2.4 Stale-While-Revalidate

```text
serve stale data now
trigger refresh asynchronously
```

Cocok untuk read-heavy, non-critical data.

Tidak cocok untuk auth, payment, legal status, entitlement, enforcement decision.

#### 7.2.5 Degraded Response

```text
return profile without enrichment
return case summary without external risk score
return dashboard with partial sections
```

Butuh response contract yang eksplisit:

```json
{
  "caseId": "C-123",
  "summary": {...},
  "externalRisk": null,
  "degraded": true,
  "degradationReason": "RISK_SERVICE_UNAVAILABLE"
}
```

#### 7.2.6 Queue for Later / Async Compensation

Untuk command yang tidak boleh silently fail:

```text
notification delivery failed
  → enqueue retry job
  → return accepted/partial
  → expose delivery status
```

Ini bukan fallback response sederhana. Ini reliability workflow.

### 7.3 Fallback yang Harus Dihindari

#### Dangerous Fallback 1 — Default Allow

```text
permission service down → allow
```

Biasanya salah. Default harus konservatif:

```text
permission service down → deny or manual review
```

#### Dangerous Fallback 2 — Fake Success

```text
external submission failed → return success to user
```

Ini menciptakan data inconsistency dan audit risk.

Lebih baik:

```text
return accepted pending submission
store outbox
show pending state
retry asynchronously
```

#### Dangerous Fallback 3 — Swallowing Contract Drift

```text
JSON parse failed → return empty object
```

Ini menyembunyikan integration break.

Lebih baik:

```text
mark as protocol failure
alert
fallback only if explicitly safe
```

#### Dangerous Fallback 4 — Unlimited Cache Staleness

```text
API down → use cached value forever
```

Fallback cache harus punya:

- max age
- source timestamp
- stale indicator
- metric
- audit policy

---

## 8. Recommended Composition Patterns

### 8.1 Read-Only Idempotent Query

Contoh:

```text
GET /profiles/{id}
GET /postal-code/{code}
GET /catalog/items/{id}
```

Recommended chain:

```text
bulkhead
  → rateLimiter
  → circuitBreaker
  → retry(deadline-aware, limited)
  → per-attempt timeout
  → http call
  → fallback cache optional
```

Atau secara conceptual dari caller:

```text
fallback(
  circuitBreaker(
    retry(
      timeout(
        bulkhead(rateLimiter(httpCall))
      )
    )
  )
)
```

Important:

- retry allowed for transient 502/503/504/connect reset
- retry obeys total deadline
- fallback allowed only if read data can be stale/partial
- breaker records final outcome or attempt outcome depending desired sensitivity

### 8.2 Non-Idempotent Command

Contoh:

```text
POST /payments/charge
POST /cases/submit
POST /notifications/send
POST /applications/approve
```

Recommended chain:

```text
bulkhead
  → rateLimiter
  → circuitBreaker
  → timeout
  → http call
  → no automatic retry unless idempotency key exists
  → no fake success fallback
```

If idempotency key exists:

```text
retry only on transport failure where result unknown
but only if downstream guarantees idempotent replay
```

For critical command, better pattern:

```text
persist command/outbox
  → attempt HTTP delivery
  → record result
  → retry asynchronously with idempotency key
  → expose status
```

### 8.3 Token Acquisition Client

Token endpoint has special behavior.

```text
client credentials token request
```

Recommended chain:

```text
single-flight lock/cache
  → circuitBreaker(token endpoint)
  → retry very limited
  → short timeout
  → fail closed
```

Do not let 100 concurrent requests refresh token simultaneously.

```text
token expires
  → 100 app threads see expired token
  → 100 token requests
  → auth server rate limits
  → all app requests fail
```

Use single-flight:

```text
only one thread refreshes
others wait or use still-valid token within grace window
```

### 8.4 Third-Party API with Strict Rate Limit

Recommended chain:

```text
rateLimiter(strict)
  → bulkhead
  → circuitBreaker
  → retry only when Retry-After allows and deadline permits
  → timeout
  → http call
```

For `429`:

```text
respect Retry-After
avoid immediate retry storm
record vendor quota metrics
```

### 8.5 Internal Microservice Call

Recommended chain:

```text
bulkhead per downstream
  → circuitBreaker per operation
  → retry limited for safe operations
  → timeout based on upstream budget
  → tracing headers
  → http call
```

In service mesh environments, verify whether the mesh already retries.

Never stack retries blindly:

```text
application retry 3x
  × service mesh retry 3x
  × gateway retry 2x
  = 18 attempts
```

---

## 9. Policy Ordering: Practical Reasoning

### 9.1 Rate Limiter Before Retry or After Retry?

If rate limiter wraps the whole operation:

```text
rateLimiter(retry(httpCall))
```

Then one permit can produce multiple attempts.

If rate limiter wraps each attempt:

```text
retry(rateLimiter(httpCall))
```

Then each attempt consumes a permit.

For third-party quota, usually each HTTP request counts, so rate limit should apply per attempt.

For business operation quota, rate limit can apply per operation.

Many systems need both:

```text
operationRateLimiter(
  retry(
    attemptRateLimiter(
      httpCall
    )
  )
)
```

### 9.2 Bulkhead Before Retry or After Retry?

If bulkhead wraps operation:

```text
bulkhead(retry(httpCall))
```

One slot is held across retries and backoff. This can reduce concurrency but may waste slots while sleeping.

If bulkhead wraps attempt:

```text
retry(bulkhead(httpCall))
```

Slot is held only during active attempt, not backoff. But many operations may wait/retry outside bulkhead.

Common practical approach:

```text
small operation-level limiter
  + attempt-level HTTP pool/concurrency limit
```

### 9.3 Timeout Before Retry or Retry Before Timeout?

```text
timeout(retry(httpCall))
```

This means timeout is total operation timeout.

```text
retry(timeout(httpCall))
```

This means timeout is per attempt.

Production-grade usually needs both:

```text
operationTimeout(
  retry(
    attemptTimeout(
      httpCall
    )
  )
)
```

### 9.4 Circuit Breaker Before Fallback or Fallback Before Circuit Breaker?

Usually:

```text
fallback(circuitBreaker(httpCall))
```

Breaker should see primary failure.

If fallback is inside breaker:

```text
circuitBreaker(fallback(httpCall))
```

Then breaker may see success because fallback returned a value. This can hide downstream failure from breaker.

That is usually wrong unless you deliberately want breaker to measure user-visible success, not downstream health.

---

## 10. Java Implementation Models

### 10.1 Pure Wrapper Model

A simple client adapter can define clear policy boundaries.

```java
public interface ExternalProfileClient {
    ProfileResult getProfile(ProfileId id, RequestContext context);
}
```

Implementation:

```java
public final class ResilientExternalProfileClient implements ExternalProfileClient {
    private final RawExternalProfileHttpClient rawClient;
    private final ProfileFallback fallback;
    private final RetryPolicy retryPolicy;
    private final CircuitBreakerPolicy circuitBreaker;
    private final TimeoutPolicy timeoutPolicy;

    @Override
    public ProfileResult getProfile(ProfileId id, RequestContext context) {
        try {
            return circuitBreaker.execute(() ->
                retryPolicy.execute(() ->
                    timeoutPolicy.execute(context.deadline(), () ->
                        rawClient.getProfile(id, context)
                    )
                )
            );
        } catch (Exception e) {
            return fallback.getProfileFallback(id, context, e);
        }
    }
}
```

This structure makes policy visible.

### 10.2 Resilience4j Style

Resilience4j provides decorators for patterns such as CircuitBreaker, Retry, RateLimiter, Bulkhead, and TimeLimiter. Conceptually:

```java
Supplier<ProfileResult> supplier = () -> rawClient.getProfile(id, context);

Supplier<ProfileResult> decorated = Decorators.ofSupplier(supplier)
    .withCircuitBreaker(circuitBreaker)
    .withRetry(retry)
    .withBulkhead(bulkhead)
    .withFallback(throwable -> fallback.getProfileFallback(id, context, throwable))
    .decorate();

return decorated.get();
```

Important: do not treat decorator order as cosmetic. Read the execution order and test it.

### 10.3 Failsafe Style

Failsafe composes policies around executable logic.

Conceptually:

```java
RetryPolicy<ProfileResult> retry = RetryPolicy.<ProfileResult>builder()
    .handleIf(this::isRetryable)
    .withMaxAttempts(3)
    .build();

CircuitBreaker<ProfileResult> breaker = CircuitBreaker.<ProfileResult>builder()
    .handleIf(this::shouldCountBreakerFailure)
    .build();

Timeout<ProfileResult> timeout = Timeout.<ProfileResult>builder(Duration.ofMillis(300))
    .build();

return Failsafe.with(fallback, breaker, retry, timeout)
    .get(() -> rawClient.getProfile(id, context));
```

Again: verify policy order and what each policy observes.

### 10.4 OkHttp Interceptor Boundary

OkHttp interceptors can monitor, rewrite, and retry calls. They are powerful, but not every resilience concern belongs inside an interceptor.

Good interceptor use cases:

- add correlation ID
- add auth header
- redact logs
- collect low-level timing
- handle token refresh carefully

Risky interceptor use cases:

- broad business fallback
- unbounded retry
- domain-specific error mapping hidden from adapter
- swallowing failures silently

Better split:

```text
OkHttp interceptor:
  transport/protocol concern

Client adapter:
  domain/error/fallback concern

Resilience wrapper:
  retry/breaker/bulkhead/timeout composition
```

### 10.5 Retrofit Boundary

Retrofit interface should not become the full resilience layer.

Good:

```java
interface VendorApi {
    @GET("/profiles/{id}")
    Call<ProfileDto> getProfile(@Path("id") String id);
}
```

Then wrap it:

```java
final class VendorProfileClient {
    private final VendorApi api;
    private final PolicyChain policies;

    ProfileResult getProfile(ProfileId id, RequestContext ctx) {
        return policies.execute("vendor.getProfile", ctx, () -> {
            Response<ProfileDto> response = api.getProfile(id.value()).execute();
            return mapResponse(response);
        });
    }
}
```

Avoid spreading `execute()` and response parsing across service layer.

### 10.6 JDK HttpClient Boundary

JDK `HttpClient` gives you HTTP execution primitives. Resilience policies are usually external wrappers.

```java
HttpRequest request = HttpRequest.newBuilder(uri)
    .timeout(Duration.ofMillis(300))
    .GET()
    .build();

HttpResponse<String> response = httpClient.send(request, BodyHandlers.ofString());
```

For production client:

```text
raw JDK client
  → request builder
  → response classifier
  → policy chain
  → domain adapter
```

Do not let `HttpResponse<String>` leak through your domain service.

---

## 11. Failure Semantics Matrix

A top-tier HTTP client should define policy decisions explicitly.

| Failure/Event | Retry? | Breaker Count? | Fallback? | Notes |
|---|---:|---:|---:|---|
| DNS failure | Maybe | Yes | Maybe | Retry only if alternate DNS/IP likely |
| Connect timeout | Maybe | Yes | Maybe | Often transient, but dangerous under overload |
| TLS handshake failure | Usually no | Yes | Rare | Config/cert issue usually not fixed by retry |
| Read timeout | Maybe | Yes | Maybe | Depends idempotency/deadline |
| Connection reset before write | Maybe | Yes | Maybe | Safer than after body write |
| Connection reset after write | Dangerous | Yes | Depends | Result may be unknown |
| HTTP 400 | No | No | No | Caller bug/request validation issue |
| HTTP 401 | Maybe token refresh once | No/Maybe | No | Refresh token once, avoid loop |
| HTTP 403 | No | No | No | Permission issue |
| HTTP 404 | No | No | Domain-specific | Usually normal result |
| HTTP 409 | No | No | Domain-specific | Conflict/business state |
| HTTP 429 | Later | Maybe no | Maybe | Respect Retry-After |
| HTTP 500 | Maybe | Yes | Maybe | Retry if safe |
| HTTP 502/503/504 | Maybe | Yes | Maybe | Classic transient/gateway failures |
| JSON parse error | No | Maybe | Rare | Contract drift; alert |
| Empty mandatory body | No | Maybe | Rare | Protocol violation |
| Breaker open | No | No additional | Maybe | Fallback can apply |
| Bulkhead full | No immediate | No downstream failure | Maybe | Caller-side saturation |
| Rate limited locally | No immediate | No downstream failure | Maybe | Caller-side protection |

---

## 12. Observability for Policy Composition

Without observability, resilience policy becomes superstition.

### 12.1 Metrics Needed

For each downstream operation:

```text
http.client.requests.total
http.client.duration
http.client.status.count
http.client.exceptions.count
http.client.timeout.count
http.client.retry.attempts
http.client.retry.exhausted
http.client.circuitbreaker.state
http.client.circuitbreaker.calls.rejected
http.client.circuitbreaker.failure.rate
http.client.circuitbreaker.slow.call.rate
http.client.fallback.used
http.client.bulkhead.rejected
http.client.ratelimiter.rejected
http.client.pool.acquire.duration
http.client.pool.active.connections
```

Metric labels should be low-cardinality:

Good:

```text
downstream=profile-api
operation=getProfile
outcome=success|failure|timeout|fallback
status_class=2xx|4xx|5xx
exception_type=SocketTimeoutException
```

Bad:

```text
url=/profiles/123456789
userId=...
token=...
fullExceptionMessage=...
```

### 12.2 Logs Needed

For each final operation failure:

```text
operation
correlationId
traceId
downstream
method
route template, not full URL with PII
attemptCount
totalDurationMs
lastFailureType
statusCode if any
breakerState
fallbackUsed
retryExhausted
remainingDeadlineMs if useful
```

Do not log:

- access token
- API key
- secret
- full Authorization header
- private key
- sensitive request/response body
- unredacted query params containing PII

### 12.3 Tracing Needed

Trace should show:

```text
logical operation span
  → attempt 1 span
  → backoff event
  → attempt 2 span
  → fallback event if used
```

Avoid hiding retries inside one span without events.

Useful span attributes:

```text
http.request.method
server.address
url.template
http.response.status_code
retry.attempt
resilience.circuit_breaker.state
resilience.fallback.used
error.type
```

### 12.4 Alerting Signals

Alert not only on 5xx.

Important early signals:

```text
retry attempts increasing
slow call rate increasing
pool acquire time increasing
bulkhead rejection increasing
fallback usage increasing
circuit breaker half-open/open transitions increasing
429 increasing
p99 latency increasing while error still low
```

Fallback usage should often be alert-worthy. A fallback can preserve UX while hiding a dependency outage.

---

## 13. Testing Policy Composition

### 13.1 Test Failure Classification

Create table-driven tests:

```java
record FailureCase(
    Throwable exception,
    int statusCode,
    boolean retryable,
    boolean breakerFailure,
    boolean fallbackAllowed
) {}
```

Validate:

```text
400 is not retryable
503 is retryable for GET
503 is not retryable for non-idempotent POST without idempotency key
401 refresh only once
429 respects Retry-After
JSON parse error is protocol failure
```

### 13.2 Test Retry Count

Mock server scenario:

```text
attempt 1 → 503
attempt 2 → 503
attempt 3 → 200
```

Assert:

```text
3 HTTP requests made
result success
retry metric = 2
breaker final outcome based on chosen design
```

### 13.3 Test Deadline

Scenario:

```text
operation deadline 500ms
attempt timeout 300ms
backoff 250ms
```

Assert:

```text
second attempt not started if remaining budget insufficient
```

### 13.4 Test Breaker Open

Scenario:

```text
N failures exceed threshold
next request rejected without hitting mock server
fallback invoked if allowed
metric breaker.rejected increments
```

### 13.5 Test Half-Open

Scenario:

```text
breaker open
wait duration passes
allow limited probes
probe success closes breaker
probe failure reopens breaker
```

Assert retry policy does not turn one half-open probe into many hidden attempts unless intentionally configured.

### 13.6 Test Fallback Correctness

Fallback test should assert not only response but metadata.

```text
fallback result includes degraded=true
cache freshness checked
reason recorded
metric incremented
no fake success for command
```

### 13.7 Chaos / Fault Injection Cases

Test:

- slow response
- connection reset
- no response body
- malformed JSON
- 429 with Retry-After
- 503 burst
- TLS failure
- DNS failure if possible
- pool exhaustion
- token endpoint slow
- auth 401 loop

---

## 14. Common Anti-Patterns

### 14.1 Retry Everything

```java
catch (Exception e) {
    retry();
}
```

Wrong because:

- 400 will never become success
- 403 will not become success
- non-idempotent command can duplicate side effect
- contract drift will not be fixed by retry
- downstream overload gets worse

### 14.2 Timeout Only at Outer Layer

```text
controller timeout exists
HTTP call has no timeout
```

May leave background work running.

### 14.3 Circuit Breaker Around Fallback

```text
circuitBreaker(fallback(httpCall))
```

Breaker sees fallback success and never opens even though downstream is failing.

### 14.4 Fallback Without Visibility

```text
catch exception return empty list
```

No metric, no log, no degraded flag, no alert.

This is silent data corruption at UX/system level.

### 14.5 One Breaker for Everything

```text
externalApiBreaker
```

All endpoints share same fate, even if only one operation is degraded.

### 14.6 Per-User Breaker

```text
breaker-user-123
breaker-user-456
```

Metric sample too small and cardinality too high.

### 14.7 Nested Retry Storm

```text
controller retry
  → service retry
  → client retry
  → mesh retry
  → gateway retry
```

Always inventory all retry layers.

### 14.8 Ignoring 429 Semantics

```text
429 received
retry immediately
```

Should respect `Retry-After` when present and obey local budget.

### 14.9 Breaker Opens on Client Bug

If 400/404 count as breaker failure, one deployment bug can open breaker and hide real issue.

### 14.10 Fallback for Security Decision

```text
authz service unavailable → allow
```

Usually unacceptable. Fail closed unless explicit risk decision says otherwise.

---

## 15. Design Review Checklist

Use this checklist when reviewing any production HTTP client.

### 15.1 Timeout

- Is there a total operation deadline?
- Is there a per-attempt timeout?
- Are connect/read/write/call timeout configured appropriately?
- Is timeout shorter than upstream SLA?
- Does cancellation propagate to HTTP call?
- Are timeout metrics separated by type?

### 15.2 Retry

- Which status codes are retryable?
- Which exceptions are retryable?
- Are non-idempotent operations protected?
- Is idempotency key used when retrying commands?
- Is backoff with jitter used?
- Is retry deadline-aware?
- Is retry budget enforced?
- Are nested retries inventoried?

### 15.3 Circuit Breaker

- What is breaker granularity?
- Does breaker count per attempt or per operation?
- Are 4xx excluded correctly?
- Are slow calls counted?
- Is half-open probe limited?
- Is breaker state observable?
- Is open breaker behavior clear to caller?

### 15.4 Fallback

- Is fallback allowed by business semantics?
- Is fallback safe for this operation?
- Is fallback marked as degraded?
- Is cached fallback freshness bounded?
- Is fallback usage observable/alerted?
- Is fallback forbidden for dangerous commands/security decisions?

### 15.5 Composition

- What is exact order of policies?
- Does rate limiter apply per operation or per attempt?
- Does bulkhead slot cover backoff time?
- Does fallback hide breaker failure?
- Does retry operate in half-open state?
- Are library-level retries disabled/understood?

### 15.6 Observability

- Are attempts visible separately from operations?
- Are retry counts logged/metriced?
- Are breaker state transitions visible?
- Are fallback events visible?
- Are sensitive values redacted?
- Are labels low-cardinality?

---

## 16. Practical Default Recommendations

These are not universal laws, but useful starting points.

### 16.1 For Read API

```text
operation deadline: based on upstream SLA, often 300–1000 ms internal
per-attempt timeout: smaller than operation deadline
max attempts: 2–3
backoff: small exponential + jitter
breaker: per downstream operation
fallback: cache/empty only if business-safe
```

### 16.2 For Command API

```text
operation deadline: explicit
max attempts: 1 unless idempotency key exists
breaker: yes
fallback: no fake success
compensation: outbox/retry workflow if needed
```

### 16.3 For Token Endpoint

```text
single-flight refresh: yes
retry: 1–2 max
breaker: yes
fallback: use still-valid token only within safe grace, otherwise fail closed
```

### 16.4 For Third-Party API

```text
rate limiter: strict
bulkhead: small and isolated
retry: only allowed cases
429: respect Retry-After
breaker: yes
fallback: explicit business approval
```

### 16.5 For Internal Microservice

```text
trace propagation: mandatory
timeout: budget-based
retry: only at one layer
breaker: per operation class
bulkhead: per dependency
fallback: partial response only if contract supports degradation
```

---

## 17. Mental Model Summary

A production HTTP client is not resilient because it has retry, timeout, circuit breaker, and fallback.

It is resilient when those policies are composed with correct semantics.

The core reasoning model:

```text
1. What operation am I performing?
2. Is it read or command?
3. Is it idempotent?
4. What is the total deadline?
5. What failures are retryable?
6. What failures count against downstream health?
7. How much load can I safely generate?
8. What happens when downstream is slow?
9. What happens when breaker opens?
10. Is fallback truthful, safe, observable, and bounded?
```

Top 1% engineers do not ask only:

```text
How do I add retry?
```

They ask:

```text
What semantic guarantee am I preserving while adding retry?
What load am I creating?
What resource am I protecting?
What failure am I making visible or hiding?
What will happen at P99 during partial outage?
```

---

## 18. Key Takeaways

- Circuit breaker is a fail-fast and protection mechanism, not a retry mechanism.
- Timeout must be modeled as a deadline/budget, not a random duration.
- Retry must be idempotency-aware, deadline-aware, and budget-aware.
- Fallback is a semantic decision, not only a technical catch block.
- Policy order changes behavior.
- Breaker can count operation outcome or attempt outcome; choose intentionally.
- Rate limiter and bulkhead can apply per operation or per attempt; choose intentionally.
- Fallback must be observable and often marked as degraded.
- Do not hide dependency outage behind silent fallback.
- Do not allow nested retries without calculating worst-case attempts.
- Test policy composition under failure, not only success.

---

## 19. Bridge ke Part Berikutnya

Setelah memahami komposisi resilience policy, kita akan masuk ke library pertama secara mendalam:

```text
Part 14 — JDK HttpClient Deep Dive
```

Di sana kita akan membahas `java.net.http.HttpClient` sebagai client modern bawaan JDK:

- builder model
- immutable reusable client
- sync vs async
- `HttpRequest`
- `HttpResponse`
- `BodyPublisher`
- `BodyHandler`
- HTTP/1.1 vs HTTP/2
- executor
- redirect
- proxy
- authenticator
- cookie handler
- cancellation
- WebSocket overview
- production wrapper pattern



<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 12 — Rate Limiting, Throttling, Bulkhead, dan Client-Side Load Shedding](./12-rate-limiting-throttling-bulkhead-client-side-load-shedding.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 14 — JDK `HttpClient` Deep Dive: `java.net.http` sebagai Native HTTP Client Modern Java](./14-jdk-httpclient-deep-dive-java-net-http.md)

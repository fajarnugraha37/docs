# Part 14 — Retry, Idempotency, Backoff, Jitter, Hedging, and Duplicate Suppression

> Seri: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `014-retry-idempotency-backoff-jitter-hedging-duplicate-suppression.md`  
> Scope Java: 8–25  
> Level: Advanced / production systems engineering

---

## 1. Tujuan Bagian Ini

Di bagian sebelumnya kita membahas timeout sebagai batas waktu dan resource budget. Bagian ini membahas keputusan berikutnya:

> Setelah sebuah network call gagal, lambat, ambigu, atau belum jelas hasilnya, apakah client boleh mencoba lagi?

Pertanyaan ini terlihat sederhana, tetapi di sistem produksi jawabannya jarang sederhana.

Retry bisa menyelamatkan sistem dari transient failure. Retry juga bisa menghancurkan sistem dengan menggandakan load, menciptakan retry storm, membuat operasi non-idempotent dieksekusi berkali-kali, merusak audit trail, memperparah overload, dan menyembunyikan root cause.

Seorang engineer yang hanya tahu template retry biasanya berpikir:

```text
Jika timeout, retry 3x dengan exponential backoff.
```

Seorang network systems engineer berpikir:

```text
Apa yang sebenarnya gagal?
Apakah server menerima request?
Apakah operasi sudah menyebabkan side effect?
Apakah request aman diulang?
Apakah retry masih berada dalam deadline user?
Apakah retry menambah load pada dependency yang sedang overload?
Apakah retry terjadi di client, gateway, mesh, SDK, message broker, dan job scheduler sekaligus?
Apakah kita punya idempotency key, dedup store, atau operation identity?
Apakah response lama dan response baru bisa tiba bersamaan?
Apakah observability bisa membedakan original attempt dan retry attempt?
```

Bagian ini akan membangun mental model tersebut.

---

## 2. Learning Outcomes

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan failure yang aman di-retry, tidak aman di-retry, dan ambigu.
2. Mendesain retry berdasarkan deadline, bukan berdasarkan angka `maxAttempts` random.
3. Membedakan idempotent method, idempotent operation, idempotency key, deduplication, dan exactly-once illusion.
4. Menggunakan exponential backoff dan jitter dengan benar.
5. Memahami mengapa retry tanpa budget bisa memperparah outage.
6. Mendesain duplicate suppression untuk operasi side-effect seperti create payment, submit application, send email, approve case, publish event, dan generate document.
7. Memahami hedging sebagai latency optimization yang berbahaya jika dipakai tanpa idempotency dan capacity control.
8. Membedakan HTTP retry, gRPC retry, message redelivery, job retry, dan manual user retry.
9. Mendesain retry policy untuk Java HTTP/gRPC client dari Java 8 sampai 25.
10. Membuat failure model, metrics, logs, dan test case untuk retry behavior.

---

## 3. Core Thesis

Retry bukan fitur teknis. Retry adalah keputusan semantic.

Sebuah request tidak boleh diulang hanya karena exception terlihat transient. Request hanya boleh diulang jika salah satu dari kondisi berikut benar:

1. Operasi memang idempotent secara semantic.
2. Request tidak pernah sampai ke server.
3. Server menjamin duplicate suppression.
4. Client membawa operation identity yang bisa dikenali server.
5. Efek samping duplicate dapat diterima dan dikompensasi.
6. Retry dilakukan hanya untuk read-only operation.
7. Retry dilakukan oleh layer yang memiliki informasi cukup tentang safety operation.

Jika tidak, retry adalah bentuk spekulasi.

---

## 4. Retry Is Not a Fix; It Is a Load Multiplier

Misalkan ada service A memanggil service B.

```text
A -> B
```

Jika A mengirim 1.000 request per second ke B dan setiap request gagal lalu di-retry 3 kali, maka B menerima sampai 4.000 attempts per second.

```text
original attempt : 1.000 rps
retry attempt 1  : 1.000 rps
retry attempt 2  : 1.000 rps
retry attempt 3  : 1.000 rps
--------------------------------
total attempts   : 4.000 rps
```

Jika B gagal karena overload, retry memperparah overload.

Sekarang bayangkan call chain:

```text
User API -> Service A -> Service B -> Service C -> Database
```

Jika setiap layer punya retry 3x, total attempts bisa meledak secara multiplicative.

```text
A retries B 3x
B retries C 3x
C retries DB 3x
```

Worst-case attempt amplification:

```text
4 * 4 * 4 = 64 attempts
```

Satu request user bisa berubah menjadi puluhan attempt downstream.

Ini sebabnya retry harus dianggap sebagai:

```text
failure recovery mechanism + capacity risk + semantic risk
```

bukan sekadar resilience pattern.

---

## 5. The Retry Decision Model

Setiap kali ingin menambahkan retry, gunakan model keputusan berikut.

```text
Should retry?
|
+-- 1. What failed?
|     +-- DNS failure?
|     +-- TCP connect failure?
|     +-- TLS handshake failure?
|     +-- write failure?
|     +-- response timeout?
|     +-- 429/503?
|     +-- 5xx?
|     +-- application error?
|
+-- 2. Did the server possibly receive the request?
|     +-- definitely no
|     +-- definitely yes
|     +-- unknown
|
+-- 3. Is the operation safe to repeat?
|     +-- read-only
|     +-- idempotent update
|     +-- protected by idempotency key
|     +-- unsafe side effect
|
+-- 4. Is there remaining deadline?
|     +-- yes
|     +-- no
|
+-- 5. Is downstream overloaded?
|     +-- no signal
|     +-- Retry-After
|     +-- rate limited
|     +-- circuit open
|     +-- saturation high
|
+-- 6. Which layer owns retry?
      +-- application client
      +-- SDK
      +-- gateway
      +-- service mesh
      +-- gRPC service config
      +-- job scheduler
      +-- message broker
```

A good retry policy is the output of this decision model.

---

## 6. Failure Taxonomy: What Kind of Failure Are We Retrying?

### 6.1 DNS Failure

Examples:

```text
UnknownHostException
Temporary failure in name resolution
DNS timeout
SERVFAIL
NXDOMAIN
```

Retry consideration:

| Failure | Retry? | Notes |
|---|---:|---|
| Temporary resolver failure | Maybe | Use short retry if deadline allows. |
| NXDOMAIN | Usually no | Could be config error, unless dynamic DNS just changed. |
| Stale DNS cache | Retry alone may not help | Need cache TTL, resolver refresh, connection pool refresh. |
| Kubernetes CoreDNS overloaded | Retry can worsen load | Need DNS caching, lower lookup frequency, connection reuse. |

Important mental model:

```text
Retrying the HTTP request may retry DNS resolution only if the client actually resolves again.
If an existing connection is reused, DNS is not involved.
If a stale IP is kept in a pool, retry may hit the same bad endpoint repeatedly.
```

---

### 6.2 TCP Connect Failure

Examples:

```text
Connection refused
Connect timed out
No route to host
Network unreachable
```

Retry consideration:

| Failure | Meaning | Retry? |
|---|---|---:|
| Connection refused | Host reachable, port not accepting | Maybe, if rollout/restart. |
| Connect timeout | SYN unanswered / path issue | Maybe, but expensive. |
| No route to host | Routing/network config | Usually not useful quickly. |
| Network unreachable | Local/network issue | Usually no immediate retry. |

Connect failure often means request did not reach the application. For non-idempotent operation, it may still be safer than read timeout because server likely did not process the request. But do not overgeneralize: proxies, NATs, and gateways complicate the path.

---

### 6.3 TLS Handshake Failure

Examples:

```text
SSLHandshakeException
certificate_unknown
PKIX path building failed
hostname verification failed
protocol_version
bad_certificate
```

Retry consideration:

| Failure | Retry? | Why |
|---|---:|---|
| Certificate expired | No | Configuration/security issue. |
| Truststore missing CA | No | Client configuration issue. |
| Hostname mismatch | No | Endpoint/cert issue. |
| Temporary handshake timeout | Maybe | If network overloaded. |
| ALPN negotiation failure | No | Protocol mismatch. |

Retrying TLS configuration errors just burns capacity.

---

### 6.4 Write Failure

Write failure is subtle.

If client fails while writing request body:

```text
SocketException: Broken pipe
Connection reset by peer
IOException during request body upload
```

The server may have received:

1. No bytes.
2. Partial headers.
3. Full headers but partial body.
4. Full body but failed before response.
5. Full request and already processed side effect.

Therefore write failure is often ambiguous.

Retry safety depends on:

```text
operation idempotency
body replayability
server parser behavior
server transaction boundary
idempotency key
request size
whether response was already generated
```

---

### 6.5 Read Timeout / Response Timeout

Read timeout is the most dangerous retry trigger.

Client perspective:

```text
I sent request.
I did not receive response before timeout.
```

Server reality may be:

```text
request not received
request queued
request processing
request committed
response generated but lost
response delayed by proxy
response blocked by slow network
response completed after client timeout
```

A read timeout tells you little about side effects.

For a create/approve/submit operation, automatic retry after read timeout can duplicate effects unless the operation is idempotent.

---

### 6.6 HTTP Status Failures

| Status | Retry? | Notes |
|---:|---:|---|
| 408 | Maybe | Request timeout; depends on method/idempotency. |
| 409 | Usually no automatic retry | Requires conflict resolution. |
| 412 | No | Precondition failed; client state stale. |
| 425 | Later maybe | Too Early; relevant with early data. |
| 429 | Yes with `Retry-After` / rate policy | Respect server feedback. |
| 500 | Maybe | Generic; dangerous without classification. |
| 502 | Maybe | Gateway/upstream failure. |
| 503 | Maybe with backoff / `Retry-After` | Service unavailable/overloaded. |
| 504 | Maybe | Gateway timeout; server may still be processing. |

HTTP method matters, but method is not enough. A `POST` can be idempotent with an idempotency key; a badly designed `GET` can cause side effects even though it should not.

---

### 6.7 gRPC Status Failures

Common retry-relevant gRPC status codes:

| gRPC status | Retry? | Notes |
|---|---:|---|
| `UNAVAILABLE` | Often yes | Transient server/network/load balancer issue. |
| `DEADLINE_EXCEEDED` | Usually no at same layer | Deadline is already gone. Parent may decide. |
| `RESOURCE_EXHAUSTED` | Maybe with throttling | Equivalent to overload/quota/rate limit. |
| `ABORTED` | Maybe at higher transaction level | Concurrency conflict. |
| `INTERNAL` | Usually classify carefully | Could be bug, not transient. |
| `UNKNOWN` | Avoid blind retry | Insufficient semantic signal. |
| `INVALID_ARGUMENT` | No | Client bug/domain validation. |
| `FAILED_PRECONDITION` | No automatic retry | Requires state transition. |
| `PERMISSION_DENIED` | No | Authz failure. |
| `UNAUTHENTICATED` | Maybe after token refresh | Only if auth refresh is valid. |

The important point: gRPC status is part of the protocol contract. Treating all non-OK as retryable is wrong.

---

## 7. Idempotency: The Foundation of Safe Retry

### 7.1 Idempotent Operation

An operation is idempotent if applying it multiple times has the same intended effect as applying it once.

```text
f(f(x)) = f(x)
```

Examples:

```text
PUT /users/123/email -> set email to "a@example.com"
DELETE /sessions/abc -> session no longer exists
PATCH /case/123/status -> set status to CLOSED, if current state allows
```

Non-idempotent examples:

```text
POST /payments -> create a new payment
POST /emails/send -> send an email
POST /case/123/approve -> approve and generate new audit event
POST /documents/generate -> create a new document version
POST /wallet/debit -> subtract money
```

But domain design can make some POST operations idempotent.

```http
POST /payments
Idempotency-Key: 9dbf0e7e-3c48-4f52-87b1-2e54a6aee101
```

If the same key is used again for the same semantic operation, the server returns the same result instead of creating another payment.

---

### 7.2 Idempotent Method vs Idempotent Business Operation

HTTP defines method semantics. `GET`, `HEAD`, `PUT`, and `DELETE` are generally idempotent by method semantics. `POST` is not inherently idempotent.

But production systems must reason at business operation level.

| HTTP Method | Protocol expectation | Business reality |
|---|---|---|
| GET | Safe/read-only | Some systems incorrectly mutate read count/session state. |
| PUT | Replace/set resource | Usually idempotent if resource ID stable. |
| DELETE | Resource absent after delete | Usually idempotent, but audit/event side effects may repeat if not designed. |
| POST | Process/create/action | Can be idempotent with operation key. |
| PATCH | Partial modification | Depends on patch semantics. |

Example of idempotent PATCH:

```json
{
  "status": "SUSPENDED"
}
```

Example of non-idempotent PATCH:

```json
{
  "incrementViolationCountBy": 1
}
```

Same HTTP method, different semantics.

---

### 7.3 Idempotency Key

An idempotency key identifies a unique intended operation from the client perspective.

It is not simply a random request ID.

```text
request-id       = unique per attempt
correlation-id   = groups related logs/traces
idempotency-key  = stable across retries of the same intended operation
operation-id     = domain-level identity of command/effect
```

A retry should usually generate a new request ID but reuse the same idempotency key.

```text
Attempt 1:
  X-Request-Id: req-001
  Idempotency-Key: op-789

Attempt 2:
  X-Request-Id: req-002
  Idempotency-Key: op-789
```

This lets observability see two attempts while business logic sees one intended operation.

---

## 8. Duplicate Suppression

Idempotency key is the client-facing handle. Duplicate suppression is the server-side mechanism.

A duplicate suppression store usually records:

```text
idempotency_key
request_fingerprint
operation_status
response_status
response_body or response_reference
created_at
expires_at
locked_until
owner/principal/tenant
resource_id
```

### 8.1 Basic Duplicate Suppression Flow

```text
Client sends command with Idempotency-Key
|
Server receives request
|
Check idempotency store
|
+-- key absent
|     +-- insert key as IN_PROGRESS atomically
|     +-- execute operation
|     +-- store final response/result
|     +-- return response
|
+-- key exists with same fingerprint and COMPLETED
|     +-- return stored response/result
|
+-- key exists with same fingerprint and IN_PROGRESS
|     +-- return 409/202 or wait/poll depending design
|
+-- key exists with different fingerprint
      +-- return 409 conflict / idempotency key reuse error
```

### 8.2 Why Request Fingerprint Matters

Without fingerprint validation, a client could reuse the same idempotency key for a different operation.

Bad:

```text
Idempotency-Key: abc
POST /payments amount=100

Idempotency-Key: abc
POST /payments amount=999
```

Server must reject the second request if the key was already bound to a different semantic payload.

Fingerprint can include:

```text
HTTP method
path or operation name
tenant/user/principal
normalized body hash
selected semantic headers
API version
```

Do not include volatile headers like request ID, timestamp, trace ID, or auth token raw value.

---

### 8.3 Database Pattern: Unique Constraint as Idempotency Gate

Example conceptual table:

```sql
CREATE TABLE idempotency_record (
    tenant_id           VARCHAR(64)  NOT NULL,
    idempotency_key     VARCHAR(128) NOT NULL,
    request_hash        VARCHAR(128) NOT NULL,
    status              VARCHAR(32)  NOT NULL,
    response_code       INTEGER,
    response_body       CLOB,
    resource_type       VARCHAR(64),
    resource_id         VARCHAR(128),
    created_at          TIMESTAMP    NOT NULL,
    expires_at          TIMESTAMP    NOT NULL,
    PRIMARY KEY (tenant_id, idempotency_key)
);
```

Atomic insert is the gate:

```text
INSERT idempotency key
|
+-- success     -> this request owns execution
+-- duplicate   -> inspect existing record
```

Never implement duplicate suppression as:

```text
SELECT if exists
then INSERT
```

without a unique constraint. That is a race condition.

---

### 8.4 Transaction Boundary

A common mistake:

```text
1. Execute side effect
2. Store idempotency result
```

If the process crashes between step 1 and step 2, the next retry does not know whether the side effect happened.

Better patterns:

#### Pattern A — Same Database Transaction

Use when side effect and idempotency record are in the same database.

```text
BEGIN
  insert idempotency IN_PROGRESS
  create/update domain resource
  store idempotency COMPLETED + resource reference
COMMIT
```

#### Pattern B — Outbox Pattern

Use when side effect includes external message/email/integration.

```text
BEGIN
  insert idempotency record
  update domain state
  insert outbox event with deterministic event id
COMMIT

outbox worker sends external effect with idempotent external key
```

#### Pattern C — External Idempotency Delegation

Use when external provider supports idempotency keys, e.g. payment API.

```text
Internal operation id -> external idempotency key
```

Store the mapping.

---

### 8.5 TTL and Retention

Idempotency records cannot usually be stored forever without cost.

But TTL must match business risk.

| Operation | Suggested retention thinking |
|---|---|
| Search/read | No idempotency record needed. |
| Create payment | Long enough for client retry window and reconciliation. |
| Submit application | Often days/weeks if user/browser retry can happen later. |
| Send email | At least job retry window; maybe link to message id. |
| Approve case | Often tied to audit retention; duplicate approval must be impossible by state machine anyway. |
| Generate report | Could be shorter if resource ID deterministic. |

TTL is not just technical cleanup. It is part of semantic guarantee.

---

## 9. Retry Policy Components

A retry policy has several dimensions.

```text
RetryPolicy = {
  maxAttempts,
  maxElapsedTime/deadline,
  retryableExceptions,
  retryableStatusCodes,
  nonRetryableStatusCodes,
  backoffStrategy,
  jitterStrategy,
  perAttemptTimeout,
  globalDeadline,
  idempotencyRequirement,
  retryBudget,
  circuitBreakerInteraction,
  rateLimitInteraction,
  observabilityTags
}
```

Most bad retry implementations define only:

```text
maxAttempts = 3
wait = 1s
```

That is incomplete.

---

## 10. Exponential Backoff

Exponential backoff increases delay after each failed attempt.

Example:

```text
baseDelay = 100ms
attempt 1 delay = 100ms
attempt 2 delay = 200ms
attempt 3 delay = 400ms
attempt 4 delay = 800ms
attempt 5 delay = 1600ms
```

Formula:

```text
delay = min(maxDelay, baseDelay * multiplier^(attempt - 1))
```

Example Java-ish implementation:

```java
static Duration exponentialBackoff(
        int attempt,
        Duration baseDelay,
        double multiplier,
        Duration maxDelay
) {
    if (attempt < 1) {
        throw new IllegalArgumentException("attempt must start at 1");
    }

    double rawMillis = baseDelay.toMillis() * Math.pow(multiplier, attempt - 1);
    long cappedMillis = Math.min((long) rawMillis, maxDelay.toMillis());
    return Duration.ofMillis(cappedMillis);
}
```

Problem: exponential backoff without jitter synchronizes clients.

If 10.000 clients fail at the same time, they may retry at the same times:

```text
T+100ms
T+200ms
T+400ms
T+800ms
```

That creates retry waves.

---

## 11. Jitter

Jitter adds randomness so clients do not retry in lockstep.

### 11.1 No Jitter

```text
all clients retry at exactly 100ms, 200ms, 400ms...
```

Bad under fleet-wide failure.

### 11.2 Full Jitter

```text
cap = min(maxDelay, base * 2^attempt)
delay = random(0, cap)
```

Java-ish:

```java
static Duration fullJitter(
        int attempt,
        Duration baseDelay,
        Duration maxDelay,
        ThreadLocalRandom random
) {
    long capMillis = Math.min(
            maxDelay.toMillis(),
            baseDelay.toMillis() * (1L << Math.min(attempt - 1, 30))
    );

    long delayMillis = random.nextLong(0, capMillis + 1);
    return Duration.ofMillis(delayMillis);
}
```

### 11.3 Equal Jitter

```text
cap = min(maxDelay, base * 2^attempt)
delay = cap/2 + random(0, cap/2)
```

This avoids too many very short delays.

### 11.4 Decorrelated Jitter

```text
delay = min(maxDelay, random(baseDelay, previousDelay * 3))
```

Useful for long-running retry loops.

### 11.5 Practical Recommendation

For RPC/HTTP calls:

```text
Use exponential backoff + full or equal jitter.
Always cap max delay.
Always bound total elapsed time by deadline.
Avoid unbounded background retry loops.
```

---

## 12. Deadline-Aware Retry

Retry must fit inside a total deadline.

Bad:

```text
attempt timeout = 2s
max attempts = 3
backoff = 1s, 2s
actual worst-case = 2s + 1s + 2s + 2s + 2s = 9s
user expected = 3s
```

Good:

```text
overall deadline = 3s
attempt 1 budget = 700ms
backoff = 100ms jittered
attempt 2 budget = 700ms
backoff = 200ms jittered
attempt 3 gets remaining budget only if useful
```

Pseudo-code:

```java
public <T> T executeWithRetry(Callable<T> operation, Deadline deadline) throws Exception {
    int attempt = 1;
    Throwable last = null;

    while (deadline.hasTimeLeft()) {
        Duration remaining = deadline.remaining();
        Duration perAttemptTimeout = remaining.compareTo(Duration.ofMillis(800)) < 0
                ? remaining
                : Duration.ofMillis(800);

        try {
            return callWithTimeout(operation, perAttemptTimeout);
        } catch (Throwable t) {
            last = t;

            if (!isRetryable(t)) {
                throw t;
            }

            if (attempt >= 3) {
                break;
            }

            Duration delay = computeJitteredBackoff(attempt);
            if (delay.compareTo(deadline.remaining()) >= 0) {
                break;
            }

            sleep(delay);
            attempt++;
        }
    }

    throw new RetryExhaustedException("retry exhausted", last);
}
```

The key invariant:

```text
Retry cannot extend the user-visible deadline unless explicitly designed as async workflow.
```

---

## 13. Retry Budget

Retry budget limits how much extra traffic retries may generate.

Example policy:

```text
Retry attempts must not exceed 10% of successful original attempts over rolling 1 minute.
```

If original traffic is 10.000 requests/minute, retry budget is 1.000 retry attempts/minute.

When retry budget is exhausted:

```text
fail fast
surface error
open circuit
shed optional workload
wait for server Retry-After
```

Why this matters:

```text
Without retry budget, retry can turn partial outage into total outage.
```

---

## 14. Server Feedback: Retry-After, Rate Limits, and Overload Signals

### 14.1 `Retry-After`

HTTP servers may send:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 30
```

or:

```http
Retry-After: Wed, 21 Oct 2015 07:28:00 GMT
```

A good client should respect server feedback if the operation remains relevant.

But also apply local caps:

```text
if Retry-After > user deadline -> do not wait synchronously
if Retry-After is huge -> convert to async/pending state
if Retry-After absent -> use client backoff policy
```

### 14.2 429 Too Many Requests

For 429:

```text
Retry only if the request is still useful.
Respect Retry-After or rate-limit headers.
Do not retry all clients at the same instant.
Apply jitter even after Retry-After if many clients are affected.
```

### 14.3 gRPC Pushback

gRPC retry/hedging design includes server pushback concepts in service config behavior. The general principle is:

```text
If server says slow down, client should not blindly continue retrying.
```

---

## 15. Hedging

Hedging sends a duplicate request before the first one has failed, usually to reduce tail latency.

Example:

```text
T+0ms    send attempt A
T+50ms   if no response, send attempt B to another backend
T+80ms   B returns
T+81ms   cancel A
```

Hedging is not retry after failure. It is speculative duplicate execution.

### 15.1 When Hedging Helps

Hedging can help when:

```text
latency has high tail variance
operations are read-only or idempotent
backend replicas are independent
client can cancel losers
capacity headroom exists
hedging is limited by budget
```

### 15.2 When Hedging Hurts

Hedging hurts when:

```text
system is overloaded
operation has side effects
duplicate cancellation is not reliable
all replicas share same bottleneck
request is large
backend is not idempotent
hedging is enabled globally
```

### 15.3 Hedging vs Retry

| Aspect | Retry | Hedging |
|---|---|---|
| Trigger | After failure/timeout/status | Before first attempt completes |
| Goal | Recover from transient failure | Reduce tail latency |
| Load impact | Extra attempts after failure | Extra concurrent attempts during slowness |
| Safety requirement | Idempotency or known no-effect | Stronger idempotency requirement |
| Cancellation importance | Medium | High |
| Best for | transient failures | read-heavy latency-sensitive calls |

---

## 16. Java HTTP Retry: A Production Wrapper Pattern

JDK `HttpClient` intentionally does not provide a rich built-in retry policy abstraction. That is usually good: retry semantics belong near business/client wrapper code.

### 16.1 Domain-Oriented Client Method

Instead of exposing raw HTTP everywhere:

```java
HttpResponse<String> response = httpClient.send(request, BodyHandlers.ofString());
```

Expose domain operation:

```java
CustomerProfile profile = customerClient.getProfile(customerId, deadline);
SubmissionResult result = applicationClient.submitApplication(command, idempotencyKey, deadline);
```

This lets retry policy depend on operation semantics.

---

### 16.2 Retry Classifier

```java
public interface RetryClassifier {
    RetryDecision classify(HttpAttemptResult result, OperationSemantics semantics);
}

public enum RetryDecisionType {
    RETRY,
    DO_NOT_RETRY,
    REFRESH_AUTH_THEN_RETRY,
    FAIL_FAST,
    OPEN_CIRCUIT
}

public record RetryDecision(
        RetryDecisionType type,
        String reason,
        Optional<Duration> serverSuggestedDelay
) {}
```

Operation semantics:

```java
public record OperationSemantics(
        String operationName,
        boolean readOnly,
        boolean idempotent,
        boolean hasIdempotencyKey,
        boolean bodyReplayable,
        Set<Integer> retryableStatuses
) {}
```

Classifier example:

```java
public RetryDecision classify(HttpAttemptResult result, OperationSemantics semantics) {
    if (!semantics.readOnly() && !semantics.idempotent() && !semantics.hasIdempotencyKey()) {
        return new RetryDecision(DO_NOT_RETRY, "operation is not retry-safe", Optional.empty());
    }

    if (!semantics.bodyReplayable()) {
        return new RetryDecision(DO_NOT_RETRY, "request body is not replayable", Optional.empty());
    }

    if (result.exception() instanceof java.net.ConnectException) {
        return new RetryDecision(RETRY, "connect failure", Optional.empty());
    }

    if (result.exception() instanceof java.net.http.HttpTimeoutException) {
        return new RetryDecision(RETRY, "request timeout", Optional.empty());
    }

    if (result.statusCode() == 429 || result.statusCode() == 503) {
        return new RetryDecision(RETRY, "server throttling/unavailable", result.retryAfter());
    }

    if (result.statusCode() == 502 || result.statusCode() == 504) {
        return new RetryDecision(RETRY, "gateway failure", Optional.empty());
    }

    return new RetryDecision(DO_NOT_RETRY, "not classified as retryable", Optional.empty());
}
```

---

### 16.3 Preserve Request Identity Correctly

For retry attempts:

```text
same: correlation id
same: idempotency key
same: operation id
new: attempt id / request id
new: span id
incremented: retry attempt number
```

Headers example:

```http
X-Correlation-Id: corr-123
X-Request-Id: req-456-attempt-2
X-Retry-Attempt: 2
Idempotency-Key: idem-789
```

Do not reuse the exact same request ID for each attempt. It makes logs ambiguous.

---

## 17. Body Replayability

A request body is replayable if it can be sent again exactly or semantically equivalently.

Replayable:

```text
byte array
string
small JSON object
file with stable content
supplier that opens a new stream each attempt
```

Not safely replayable:

```text
InputStream already consumed
stream from user upload without rewind
body generated from volatile state
time-dependent signature body
one-time token body
large stream without stable storage
```

### 17.1 JDK HttpClient BodyPublisher Trap

If you build a `BodyPublisher` from an `InputStream`, ensure it can provide a new stream for each attempt.

Bad conceptual pattern:

```java
InputStream input = getUploadStream();
BodyPublisher body = HttpRequest.BodyPublishers.ofInputStream(() -> input);
```

The same consumed stream may be reused.

Better conceptual pattern:

```java
Path file = spoolToTempFile(uploadStream);
BodyPublisher body = HttpRequest.BodyPublishers.ofFile(file);
```

or:

```java
BodyPublisher body = HttpRequest.BodyPublishers.ofInputStream(() -> openFreshStream(file));
```

Retry safety depends on body replayability.

---

## 18. gRPC Retry and Hedging Mental Model

gRPC has protocol-level concepts for retry and hedging through service configuration. But that does not eliminate semantic responsibility.

### 18.1 gRPC Retry Policy Dimensions

A retry policy usually includes:

```text
maxAttempts
initialBackoff
maxBackoff
backoffMultiplier
retryableStatusCodes
```

Example conceptual service config:

```json
{
  "methodConfig": [
    {
      "name": [{ "service": "case.CaseService", "method": "GetCase" }],
      "retryPolicy": {
        "maxAttempts": 4,
        "initialBackoff": "0.100s",
        "maxBackoff": "1s",
        "backoffMultiplier": 2,
        "retryableStatusCodes": ["UNAVAILABLE"]
      }
    }
  ]
}
```

This may be reasonable for `GetCase`.

It may be dangerous for:

```text
ApproveCase
SubmitApplication
SendNotification
DebitAccount
CreateDocumentVersion
```

unless these operations are idempotent.

---

### 18.2 gRPC Deadlines and Retry

gRPC deadline should bound all attempts.

```text
call deadline = 800ms
attempts must fit inside 800ms
```

If a retry starts after the deadline has no useful budget, it is just noise.

---

### 18.3 gRPC Streaming Retry

Streaming retry is more complex.

Unary call:

```text
request -> response
```

Can sometimes be replayed.

Client streaming:

```text
many request messages -> one response
```

Retry requires replaying the whole stream or resuming with protocol support.

Bidirectional streaming:

```text
many request messages <-> many response messages
```

Generic retry is usually impossible without application-level sequence numbers, acknowledgement, checkpoints, and resumption protocol.

For streaming, design explicit resume semantics:

```text
stream_id
message_sequence
last_acknowledged_sequence
resume_token
checkpoint
idempotent message processing
```

---

## 19. Retry Across Layers: Avoid Accidental Multiplication

A real system may have retries in multiple places:

```text
Browser retry button
Frontend fetch retry
API gateway retry
Service mesh retry
Java client retry
gRPC service config retry
Message broker redelivery
Job scheduler retry
Database driver retry
Cloud SDK retry
Manual operator rerun
```

If each layer retries independently, behavior becomes unpredictable.

### 19.1 Ownership Rule

Every operation should have one primary retry owner.

Examples:

| Operation | Retry owner |
|---|---|
| Read profile | Java client wrapper or gRPC config |
| Submit application | Application service with idempotency key |
| Send email | Outbox worker |
| Payment call | Payment adapter with external idempotency key |
| File upload | Upload protocol/resumable transfer layer |
| Batch job step | Job scheduler with checkpointing |

Gateway/mesh retries should be conservative and usually limited to safe methods or connect-level failures.

---

## 20. Retry and State Machines

For case management/regulatory systems, many operations are state transitions.

Example:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> CLOSED
```

Retry must respect state machine invariants.

### 20.1 Good Operation Design

```text
Command: SubmitApplication
Command ID: cmd-123
Expected current state: DRAFT
Target state: SUBMITTED
```

If retried after success:

```text
current state already SUBMITTED
command id already processed
return original result or idempotent success
```

### 20.2 Bad Operation Design

```text
POST /application/123/submit

Implementation:
  insert audit event "submitted"
  send email
  set state SUBMITTED
```

If retried:

```text
multiple audit events
multiple emails
possibly duplicate downstream integration
```

### 20.3 State Transition Idempotency

State transition command should include:

```text
command_id
actor_id
tenant_id
entity_id
expected_version
expected_state
transition_name
payload_hash
```

Database constraints:

```text
unique(command_id)
unique(entity_id, transition_name, command_id)
optimistic version check
```

This protects both retry and double-click/user resubmit.

---

## 21. Retry and Audit Trail

In regulatory systems, audit trail is not noise. It is part of legal defensibility.

Retry can corrupt audit semantics if every attempt records a business event.

Distinguish:

```text
technical attempt log
business audit event
integration attempt record
```

Example:

```text
Technical logs:
  attempt 1 failed timeout
  attempt 2 succeeded

Business audit:
  application submitted once

Integration audit:
  external notification sent once or attempted twice but deduped by message id
```

Do not create business audit event per retry attempt unless the attempt itself is a business-relevant event.

---

## 22. Retry and Authentication

Authentication failures require classification.

| Failure | Retry? | Pattern |
|---|---:|---|
| Expired access token | Yes after refresh | Refresh once, then retry. |
| Invalid client credentials | No | Configuration/secret issue. |
| Permission denied | No | Authorization issue. |
| Key rotation race | Maybe | Refresh JWKS/token/cert. |
| 401 from stale token | Yes once | Avoid infinite auth loop. |

Auth refresh retry must be bounded:

```text
max one token refresh per operation attempt chain
single-flight token refresh across threads
do not stampede identity provider
```

Bad:

```text
1000 requests receive 401
1000 requests refresh token concurrently
identity provider overloaded
```

Good:

```text
single-flight refresh
others wait or use refreshed token
retry original request once
```

---

## 23. Retry and Circuit Breaker

Circuit breaker prevents repeated calls to unhealthy dependency.

Retry and circuit breaker must cooperate.

Bad order:

```text
retry loop calls dependency 3x
then circuit breaker records one failure
```

This hides actual downstream pressure.

Better:

```text
each attempt passes through limiter/bulkhead/circuit accounting
retry policy checks circuit state before next attempt
```

Possible pipeline:

```text
Deadline
 -> Retry Budget
 -> Rate Limiter
 -> Circuit Breaker
 -> Bulkhead
 -> Attempt Timeout
 -> HTTP/gRPC Call
```

But exact order depends on design. The invariant is:

```text
Retry must not bypass protection mechanisms.
```

---

## 24. Retry and Rate Limiting

Retry should be rate-limited separately from original traffic.

Why?

Original traffic is user demand.
Retry traffic is recovery overhead.

Metrics:

```text
original_requests_total
retry_attempts_total
retry_budget_remaining
retry_suppressed_total
retry_after_respected_total
retry_after_ignored_total
```

Policy example:

```text
At most 2 attempts per operation.
At most 10% retry traffic per dependency.
No retry when queue depth > threshold.
No retry when circuit open.
No retry for low-priority background traffic during brownout.
```

---

## 25. Retry and Priority

Not all traffic deserves the same retry behavior.

| Traffic | Retry posture |
|---|---|
| User-facing read | Short retry if within UX deadline. |
| User-facing write | Retry only with idempotency. |
| Internal async job | Longer retry with checkpointing. |
| Audit/legal event | Strong delivery design, outbox, reconciliation. |
| Metrics/log shipping | Drop or buffer boundedly. |
| Optional recommendation | No retry or low priority. |

During overload, retry policy should preserve critical operations and shed optional work.

---

## 26. Retry in Background Jobs

Job retry is different from RPC retry.

RPC retry:

```text
short deadline
user waiting
few attempts
low total elapsed time
```

Job retry:

```text
minutes/hours/days
checkpointable
persistent attempt state
operator visibility
dead-letter handling
```

Job retry should store:

```text
job_id
step_id
attempt_number
last_error_class
last_error_message
next_retry_at
max_attempts
status
checkpoint
```

Use exponential backoff with max delay and eventual dead-letter state.

For non-idempotent jobs, use deterministic operation IDs per step.

---

## 27. Retry in Message-Driven Systems

Message brokers redeliver messages when consumers fail.

This is retry.

Consumer must be idempotent.

Pattern:

```text
message_id / event_id
consumer_name
processed_message table
unique(message_id, consumer_name)
```

Flow:

```text
receive message
check processed table
if absent:
  process in transaction
  mark processed
ack message
```

Common failure:

```text
process side effect
crash before ack
message redelivered
side effect repeated
```

Solution depends on side effect:

```text
same DB transaction
outbox/inbox
external idempotency key
saga compensation
```

---

## 28. Exactly-Once Is Usually a Product of Idempotency + Dedup + Reconciliation

Exactly-once delivery across distributed systems is often not a practical guarantee at application boundary.

What we can usually build:

```text
at-least-once delivery
+ idempotent consumer
+ duplicate suppression
+ deterministic operation IDs
+ reconciliation
= effectively-once business effect
```

This distinction matters.

Do not promise exactly-once just because a library says it supports exactly-once in a narrow internal sense.

At business boundary, ask:

```text
Can duplicate command occur?
Can duplicate message occur?
Can response be lost after commit?
Can user click twice?
Can batch be rerun?
Can operator manually replay?
Can provider send callback twice?
```

If yes, design idempotency.

---

## 29. Metrics for Retry Systems

Minimum metrics per dependency/operation:

```text
requests_total{operation, dependency}
attempts_total{operation, dependency, attempt}
retries_total{operation, dependency, reason}
retry_suppressed_total{operation, dependency, reason}
retry_exhausted_total{operation, dependency}
retry_success_after_attempt_total{operation, attempt}
idempotency_duplicate_total{operation}
idempotency_conflict_total{operation}
hedged_requests_total{operation}
hedge_winner_attempt_total{operation, attempt}
retry_budget_remaining{dependency}
latency_by_attempt_seconds{operation, attempt}
```

Important derived signals:

```text
attempts per original request
retry success rate
retry amplification factor
percentage of traffic caused by retries
percentage of successful calls requiring retry
retry exhausted rate
idempotency conflict rate
```

Retry success rate can be misleading. If retries succeed but amplify load massively, they may still be harmful.

---

## 30. Logs and Traces for Retry

Every attempt should be visible.

Log fields:

```text
correlation_id
operation_id
idempotency_key
request_id
attempt_number
max_attempts
retry_reason
retry_decision
delay_ms
deadline_remaining_ms
status_code
grpc_status
exception_class
dependency
endpoint
```

Trace model:

```text
parent span: logical operation
child span: attempt 1
child span: attempt 2
child span: attempt 3
```

Do not collapse all attempts into one indistinguishable span.

---

## 31. Testing Retry Behavior

You cannot trust retry behavior that is not tested under failure.

Test cases:

### 31.1 Connect Failure

```text
Given dependency port closed
When client calls read-only operation
Then it retries according to policy
And stops within deadline
```

### 31.2 Read Timeout After Side Effect

```text
Given server commits operation but delays response
When client times out and retries with same idempotency key
Then server returns original result
And side effect occurs once
```

### 31.3 Duplicate Payload Conflict

```text
Given idempotency key already used for amount=100
When client reuses same key for amount=200
Then server returns conflict
And no new side effect occurs
```

### 31.4 Retry-After

```text
Given server returns 429 Retry-After: 5
When deadline has only 2 seconds remaining
Then client does not wait synchronously
And returns retryable-later error or async pending state
```

### 31.5 Retry Budget Exhaustion

```text
Given retry budget exhausted
When retryable 503 occurs
Then client suppresses retry
And emits retry_suppressed metric
```

### 31.6 Body Not Replayable

```text
Given request body is one-time InputStream
When first attempt fails after partial write
Then retry is not attempted automatically
```

### 31.7 Hedging Read Operation

```text
Given first backend slow and second backend fast
When hedging delay elapses
Then second attempt wins
And first attempt is cancelled
And hedge budget is consumed
```

---

## 32. Java Implementation Sketch: Retry Executor

This is conceptual, not a complete framework.

```java
public final class RetryExecutor {
    private final RetryPolicy policy;
    private final Sleeper sleeper;
    private final Clock clock;

    public RetryExecutor(RetryPolicy policy, Sleeper sleeper, Clock clock) {
        this.policy = Objects.requireNonNull(policy);
        this.sleeper = Objects.requireNonNull(sleeper);
        this.clock = Objects.requireNonNull(clock);
    }

    public <T> T execute(OperationContext context, Attempt<T> attempt) throws Exception {
        int attemptNumber = 1;
        Throwable lastFailure = null;

        while (true) {
            if (!context.deadline().hasTimeLeft(clock)) {
                throw new DeadlineExceededException("deadline exceeded before attempt", lastFailure);
            }

            AttemptContext attemptContext = context.newAttempt(attemptNumber);

            try {
                T result = attempt.call(attemptContext);
                return result;
            } catch (Throwable failure) {
                lastFailure = failure;

                RetryDecision decision = policy.classify(context, attemptNumber, failure);

                if (!decision.shouldRetry()) {
                    throw failure;
                }

                if (attemptNumber >= policy.maxAttempts()) {
                    throw new RetryExhaustedException("max attempts reached", failure);
                }

                Duration delay = policy.nextDelay(attemptNumber, decision);
                Duration remaining = context.deadline().remaining(clock);

                if (delay.compareTo(remaining) >= 0) {
                    throw new DeadlineExceededException("not enough deadline for retry delay", failure);
                }

                sleeper.sleep(delay);
                attemptNumber++;
            }
        }
    }
}
```

Interface:

```java
@FunctionalInterface
public interface Attempt<T> {
    T call(AttemptContext context) throws Exception;
}
```

Important design choices:

```text
attempt context carries attempt number
logical operation context carries idempotency key and deadline
policy classifies failure using operation semantics
sleep is injectable for tests
clock is injectable for tests
retry does not own business idempotency; it requires it
```

---

## 33. Java 8–25 Considerations

### 33.1 Java 8

Common stack:

```text
HttpURLConnection
Apache HttpClient 4.x
OkHttp
Netty
CompletableFuture limited compared to later styles
ExecutorService
```

Retry usually implemented through:

```text
client wrapper
Resilience4j-like library
Spring Retry
custom interceptor
Apache HttpRequestRetryHandler
OkHttp Interceptor
```

Watch out:

```text
no built-in JDK HttpClient
manual deadline propagation
thread pool saturation
body replayability
hidden retries in libraries/cloud SDKs
```

### 33.2 Java 11+

JDK `HttpClient` becomes available as standard API.

Useful capabilities:

```text
sync send
async sendAsync
request timeout
connect timeout at client level
HTTP/2 support
BodyPublisher/BodyHandler model
```

But retry still needs custom semantic wrapper.

### 33.3 Java 21–25

Virtual threads change blocking cost, not network semantics.

With virtual threads:

```text
blocking send() becomes easier to scale by thread count
```

But retry still consumes:

```text
connection pool capacity
remote capacity
rate limit budget
CPU for serialization/TLS
memory for payload buffering
idempotency store capacity
```

Structured concurrency can improve attempt orchestration for hedging or parallel calls, but cancellation and idempotency remain mandatory.

---

## 34. Anti-Patterns

### 34.1 Retry Everything

```java
catch (Exception e) {
    retry();
}
```

This retries validation errors, auth errors, bugs, and permanent configuration failures.

---

### 34.2 Retry POST Without Idempotency

```text
POST /payments
read timeout
retry
payment duplicated
```

---

### 34.3 Infinite Retry Loop

```text
while (true) retry
```

Without deadline, budget, and operator visibility, this creates hidden load.

---

### 34.4 Same Request ID for All Attempts

Makes logs impossible to interpret.

---

### 34.5 New Idempotency Key Per Retry

This defeats duplicate suppression.

Bad:

```text
attempt 1 -> Idempotency-Key: A
attempt 2 -> Idempotency-Key: B
```

The server sees two different operations.

---

### 34.6 Retrying After Deadline

If caller already gave up, retrying only creates orphan work.

---

### 34.7 Layered Retries Without Ownership

Gateway retries, mesh retries, client retries, SDK retries, and job retries can multiply.

---

### 34.8 Hedging Write Operations

Unless idempotency is extremely strong, this is dangerous.

---

### 34.9 Retrying Non-Replayable Bodies

A consumed stream cannot be magically replayed.

---

### 34.10 Logging Only Final Failure

If attempt 1 timed out, attempt 2 got 503, attempt 3 got 401, the final exception alone hides the real story.

---

## 35. Case Study: Application Submission Timeout

### 35.1 Scenario

A user submits a licensing application.

```text
POST /applications/123/submit
```

Server does:

```text
validate application
change status DRAFT -> SUBMITTED
insert audit event
send acknowledgement email
publish integration event
return 200
```

Client times out after 3 seconds.

Question: should client retry?

### 35.2 Bad Design

No idempotency key.

Retry happens automatically.

Possible outcome:

```text
status already SUBMITTED
second request fails with 409
but audit event inserted twice
email sent twice
integration event published twice
client sees confusing error
```

### 35.3 Better Design

Client sends:

```http
POST /applications/123/submit
Idempotency-Key: submit-application-123-command-456
X-Correlation-Id: corr-789
```

Server implements:

```text
unique command id
state transition idempotency
single business audit event
outbox event with deterministic id
email generated by outbox with message id
stored operation result
```

Retry behavior:

```text
attempt 1 commits but response lost
attempt 2 reaches server
server detects same idempotency key
server returns original success
business effect occurs once
technical attempt logs show two attempts
```

This is top-tier engineering: not “avoid failure”, but make ambiguity safe.

---

## 36. Case Study: Downstream 503 Storm

### 36.1 Scenario

Service B is overloaded and returns 503.

Service A retries every 503 three times immediately.

### 36.2 Outcome

```text
B receives more traffic
latency increases
more timeouts
A thread pool fills
gateway times out
users retry manually
incident expands
```

### 36.3 Better Design

```text
A respects Retry-After
A uses exponential backoff with jitter
A has retry budget
A stops retrying when circuit opens
A sheds optional calls
A emits retry_suppressed metrics
B returns clear overload signal
Gateway does not also retry unsafe methods
```

---

## 37. Case Study: Hedging Search API

### 37.1 Scenario

Search API has p99 spikes due to occasional slow shard.

Operation:

```text
GET /search?q=abc
```

### 37.2 Hedging Design

```text
send first request
if no response after p95 latency threshold, send hedge
use first successful response
cancel loser
limit hedge rate to 5% of traffic
only hedge read-only operations
monitor hedge win rate
```

### 37.3 Danger Signal

If hedge rate rises sharply during overload, hedging may amplify overload.

Policy:

```text
disable hedging when backend saturation high
hedge only when retry/hedge budget available
```

---

## 38. Design Checklist

Before enabling retry, answer these questions.

### 38.1 Semantic Safety

```text
Is the operation read-only?
Is it idempotent by business semantics?
Does it have an idempotency key?
Can server suppress duplicates?
Can duplicate side effect cause legal/financial/audit issue?
Can response loss after commit be handled?
```

### 38.2 Failure Classification

```text
Which exceptions/statuses are retryable?
Which are explicitly non-retryable?
Are read timeouts treated differently from connect failures?
Are auth failures handled separately?
Are 429/503 Retry-After respected?
```

### 38.3 Time Budget

```text
What is the overall deadline?
What is per-attempt timeout?
What is max elapsed retry time?
Can retry exceed caller deadline?
```

### 38.4 Load Protection

```text
Is there retry budget?
Is there jitter?
Is there circuit breaker interaction?
Is retry traffic rate-limited?
Can retries be suppressed during brownout?
```

### 38.5 Observability

```text
Can we see every attempt?
Can we distinguish original and retry attempts?
Can we measure retry amplification factor?
Can we see retry success after attempt N?
Can we detect idempotency conflicts?
```

### 38.6 Testing

```text
Have we tested response lost after commit?
Have we tested duplicate idempotency key with different payload?
Have we tested non-replayable body?
Have we tested Retry-After?
Have we tested retry budget exhaustion?
```

---

## 39. Practical Default Policy Matrix

| Operation type | Retry default | Required protection |
|---|---|---|
| GET/read-only small request | Yes, short | Deadline, jitter, budget. |
| GET large streaming response | Maybe | Range/resume or restart safety. |
| PUT set resource state | Maybe | Versioning or idempotent set semantics. |
| DELETE resource | Maybe | Idempotent delete semantics. |
| POST create resource | No unless protected | Idempotency key or client-provided resource ID. |
| POST state transition | No unless protected | Command ID, state machine idempotency. |
| POST external payment | No unless protected | External idempotency key and reconciliation. |
| Send email/SMS | Async retry | Outbox, deterministic message ID. |
| Batch job | Yes | Checkpoint, persistent attempt state. |
| gRPC unary read | Yes | Deadline and retryable status codes. |
| gRPC streaming | Usually no generic retry | Resume protocol. |
| Hedged read | Maybe | Hedge budget and cancellation. |
| Hedged write | Avoid | Very strong idempotency only. |

---

## 40. Exercises

### Exercise 1 — Classify Retry Safety

Classify each operation as safe retry, conditionally safe retry, or unsafe retry:

```text
GET /cases/123
POST /cases/123/approve
PUT /users/123/email
POST /payments
DELETE /sessions/abc
POST /reports/generate
POST /notifications/email
PATCH /inventory/sku-1 { "increment": -1 }
PATCH /case/123 { "status": "UNDER_REVIEW" }
```

For each conditionally safe operation, define required idempotency mechanism.

---

### Exercise 2 — Design Idempotency Table

Design idempotency storage for:

```text
SubmitApplicationCommand
```

Include:

```text
tenant
user
application id
command id
payload hash
status
result reference
created_at
expires_at
```

Define unique constraints and conflict behavior.

---

### Exercise 3 — Retry Timeline

Given:

```text
overall deadline: 2 seconds
per-attempt timeout: 700ms
base backoff: 100ms
max attempts: 3
```

Design a timeline that does not exceed deadline.

---

### Exercise 4 — Detect Retry Storm

Given metrics:

```text
original_requests_total = 10,000/min
attempts_total = 38,000/min
success_rate = 70%
latency p99 = 12s
503 rate = 20%
```

Calculate retry amplification factor and explain whether retry is helping or hurting.

---

### Exercise 5 — Build a Retry Classifier

Write pseudo-code for classifier rules:

```text
retry connect timeout for idempotent operations
retry 429 only with backoff
do not retry 400/401/403/404/409/412/422
retry 502/503/504 only if deadline remains
retry read timeout only if idempotency key exists or operation is read-only
```

---

## 41. Key Takeaways

1. Retry is not a generic fix; it is a semantic decision with capacity impact.
2. Read timeout is ambiguous: server may have committed the side effect.
3. Idempotency key must stay stable across retries; request ID should change per attempt.
4. Duplicate suppression must be atomic and usually backed by a unique constraint.
5. Exponential backoff without jitter can synchronize clients and create retry waves.
6. Retry must be bounded by deadline and retry budget.
7. Hedging is speculative duplicate execution, not normal retry.
8. Retry ownership must be explicit across client, gateway, service mesh, SDK, broker, and job scheduler.
9. Java virtual threads make blocking calls easier to scale but do not remove downstream capacity, idempotency, or deadline constraints.
10. In regulatory/case-management systems, retry must preserve state machine invariants and audit meaning.

---

## 42. References

- RFC 9110 — HTTP Semantics. Defines HTTP method semantics, status codes, and retry-related protocol behavior.
- AWS Builders Library — Timeouts, retries, and backoff with jitter. Practical discussion of timeout selection, retry amplification, backoff, and jitter.
- gRPC documentation — Request hedging and service config. Describes retry and hedging policies in gRPC.
- Google SRE Book — Handling Overload. Discusses overload control, client-side throttling, and reliability-oriented traffic management.
- Java SE 25 documentation — `java.net.http.HttpClient`, `HttpRequest`, `HttpResponse`, and modern Java concurrency APIs relevant to deadline/cancellation orchestration.

---

## 43. Completion Status

```text
Part 14 of 35 selesai.
Seri belum selesai.
Part berikutnya: Part 15 — Connection Pooling and Resource Management.
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 13 — Timeout Engineering: Connect, DNS, TLS, Request, Read, Write, Pool Acquisition, and Deadline](./013-timeout-engineering-connect-dns-tls-request-read-write-pool-acquisition-deadline.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 15 — Connection Pooling and Resource Management](./015-connection-pooling-and-resource-management.md)

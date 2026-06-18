# learn-jaxrs-advanced-part-030.md

# Bagian 030 — Client Resilience: Timeout, Retry, Circuit Breaker, Bulkhead, Rate Limit, Idempotency, Deadline Budget, Fallback, and Production-Grade Outbound HTTP Policy

> Target pembaca: Java/Jakarta engineer yang ingin mendesain **resilience policy untuk outbound HTTP client** secara production-grade. Fokus bagian ini bukan hanya “tambahkan retry”, tetapi bagaimana membangun mental model failure, timeout budget, retry safety, idempotency, circuit breaker, bulkhead, rate limit, fallback, deadline propagation, observability, dan integrasi JAX-RS Client dengan MicroProfile Fault Tolerance / library resilience seperti Resilience4j / custom policy.
>
> Namespace utama: `jakarta.ws.rs.client.ClientBuilder`, `jakarta.ws.rs.ProcessingException`, `jakarta.ws.rs.client.ResponseProcessingException`, `jakarta.ws.rs.WebApplicationException`, `jakarta.ws.rs.core.Response`, serta konsep MicroProfile Fault Tolerance: `@Timeout`, `@Retry`, `@CircuitBreaker`, `@Bulkhead`, `@Fallback`, `@Asynchronous`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Resilience adalah Policy, Bukan Library](#2-mental-model-resilience-adalah-policy-bukan-library)
3. [Failure Taxonomy untuk Outbound HTTP](#3-failure-taxonomy-untuk-outbound-http)
4. [Transport Failure vs HTTP Failure vs Semantic Failure](#4-transport-failure-vs-http-failure-vs-semantic-failure)
5. [Timeout: First Line of Defense](#5-timeout-first-line-of-defense)
6. [Connect Timeout](#6-connect-timeout)
7. [Read Timeout](#7-read-timeout)
8. [Request Timeout vs Operation Deadline](#8-request-timeout-vs-operation-deadline)
9. [Timeout Budgeting](#9-timeout-budgeting)
10. [Deadline Propagation](#10-deadline-propagation)
11. [Retry: Powerful and Dangerous](#11-retry-powerful-and-dangerous)
12. [Retry Safety: Safe, Idempotent, and Idempotency-Key](#12-retry-safety-safe-idempotent-and-idempotency-key)
13. [HTTP Method Semantics and Retry](#13-http-method-semantics-and-retry)
14. [Retryable Failure Classification](#14-retryable-failure-classification)
15. [Non-Retryable Failures](#15-non-retryable-failures)
16. [Retry-After Header](#16-retry-after-header)
17. [Backoff and Jitter](#17-backoff-and-jitter)
18. [Retry Budget](#18-retry-budget)
19. [Hedging vs Retry](#19-hedging-vs-retry)
20. [Idempotency-Key](#20-idempotency-key)
21. [Conditional Requests and Idempotency](#21-conditional-requests-and-idempotency)
22. [Circuit Breaker](#22-circuit-breaker)
23. [Circuit Breaker States](#23-circuit-breaker-states)
24. [What Should Count as Failure?](#24-what-should-count-as-failure)
25. [Circuit Breaker Scope](#25-circuit-breaker-scope)
26. [Bulkhead](#26-bulkhead)
27. [Connection Pool as Bulkhead](#27-connection-pool-as-bulkhead)
28. [Thread Pool Bulkhead](#28-thread-pool-bulkhead)
29. [Semaphore Bulkhead](#29-semaphore-bulkhead)
30. [Rate Limit and Client-Side Throttling](#30-rate-limit-and-client-side-throttling)
31. [Fallback](#31-fallback)
32. [Fallback Types](#32-fallback-types)
33. [Fallback Dangers](#33-fallback-dangers)
34. [Caching as Resilience](#34-caching-as-resilience)
35. [Stale-While-Revalidate and Graceful Degradation](#35-stale-while-revalidate-and-graceful-degradation)
36. [Queueing and Load Shedding](#36-queueing-and-load-shedding)
37. [Resilience Policy Order](#37-resilience-policy-order)
38. [MicroProfile Fault Tolerance Overview](#38-microprofile-fault-tolerance-overview)
39. [Using MicroProfile Fault Tolerance with JAX-RS Client](#39-using-microprofile-fault-tolerance-with-jax-rs-client)
40. [Programmatic Resilience Wrapper](#40-programmatic-resilience-wrapper)
41. [Resilience4j / Custom Library Integration](#41-resilience4j--custom-library-integration)
42. [JAX-RS Client Timeout Configuration](#42-jax-rs-client-timeout-configuration)
43. [Exception Mapping in Client Resilience](#43-exception-mapping-in-client-resilience)
44. [Response Body Consumption and Resilience](#44-response-body-consumption-and-resilience)
45. [Streaming Downloads and Retry](#45-streaming-downloads-and-retry)
46. [Uploads and Retry](#46-uploads-and-retry)
47. [SSE and Resilience](#47-sse-and-resilience)
48. [Authentication Token Refresh](#48-authentication-token-refresh)
49. [Service Discovery and Load Balancing](#49-service-discovery-and-load-balancing)
50. [Per-Downstream Policy](#50-per-downstream-policy)
51. [Configuration Strategy](#51-configuration-strategy)
52. [Observability](#52-observability)
53. [Metrics](#53-metrics)
54. [Tracing](#54-tracing)
55. [Logging](#55-logging)
56. [Testing Resilience](#56-testing-resilience)
57. [Chaos / Fault Injection](#57-chaos--fault-injection)
58. [OpenAPI and Contract Notes](#58-openapi-and-contract-notes)
59. [Runtime Differences and Implementation Notes](#59-runtime-differences-and-implementation-notes)
60. [Common Failure Modes](#60-common-failure-modes)
61. [Best Practices](#61-best-practices)
62. [Anti-Patterns](#62-anti-patterns)
63. [Production Checklist](#63-production-checklist)
64. [Latihan](#64-latihan)
65. [Referensi Resmi](#65-referensi-resmi)
66. [Penutup](#66-penutup)

---

# 1. Tujuan Part Ini

Part sebelumnya membahas JAX-RS Client API core dan advanced extension points.

Sekarang kita masuk ke topik yang menentukan apakah integrasi HTTP kamu akan stabil di production:

```text
resilience
```

Outbound HTTP call bisa gagal karena banyak alasan:

- DNS lambat/gagal;
- connect timeout;
- TLS handshake error;
- read timeout;
- connection reset;
- downstream overload;
- 429 rate limit;
- 503 maintenance;
- 500 bug;
- malformed JSON;
- stale ETag;
- idempotency conflict;
- partial stream failure;
- token expired;
- circuit terbuka;
- pool exhausted;
- caller deadline habis.

Tanpa policy, service kamu bisa:

- menunggu terlalu lama;
- retry membabi buta;
- menggandakan transaksi;
- membuat retry storm;
- menumpuk thread;
- melanjutkan request setelah caller timeout;
- menyembunyikan error dengan fallback salah;
- memperburuk outage downstream.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- membedakan failure types;
- menentukan timeout budget;
- memilih retry yang aman;
- memakai idempotency key;
- memahami circuit breaker dan bulkhead;
- membatasi concurrency dan rate;
- membuat fallback yang benar;
- mengintegrasikan JAX-RS Client dengan MicroProfile Fault Tolerance/library resilience;
- mengobservasi outbound dependency;
- menguji timeout/retry/circuit/bulkhead secara realistis.

## 1.2 Prinsip utama

```text
Resilience is not “always retry”.
Resilience is choosing the least harmful behavior under failure.
```

---

# 2. Mental Model: Resilience adalah Policy, Bukan Library

Library hanya alat.

Policy menjawab:

```text
Berapa lama boleh menunggu?
Kapan retry?
Berapa kali retry?
Apa yang aman diretry?
Kapan fail fast?
Berapa concurrency maksimum?
Apa fallback yang benar?
Apa error yang dikembalikan ke caller?
Bagaimana observable?
```

## 2.1 Bad mental model

```text
Pasang @Retry dan @CircuitBreaker di semua method.
```

Masalah:

- unsafe POST bisa double charge;
- retry memperparah overload;
- timeout tidak align dengan gateway;
- fallback menyembunyikan data salah;
- breaker scope salah;
- bulkhead tidak ada.

## 2.2 Better mental model

```text
Each outbound operation has an explicit resilience contract.
```

Example:

```text
CustomerDirectory.getCustomer
- method: GET
- timeout: 500ms
- retry: 1 retry on connect timeout / 503 / 429
- backoff: 50–200ms jitter
- circuit breaker: by downstream service
- bulkhead: max 50 concurrent
- fallback: cached customer summary if not stale > 5 min
```

## 2.3 Top-tier rule

```text
Resilience policy belongs to operation semantics, not generic HTTP client settings.
```

---

# 3. Failure Taxonomy untuk Outbound HTTP

Failure taxonomy membantu menentukan response.

## 3.1 Transport failures

Tidak ada response HTTP valid:

- DNS failure;
- connect timeout;
- connection refused;
- TLS failure;
- read timeout;
- connection reset;
- broken pipe.

JAX-RS Client biasanya melempar `ProcessingException`.

## 3.2 HTTP failures

Ada response HTTP:

- 400;
- 401;
- 403;
- 404;
- 409;
- 429;
- 500;
- 503.

Ini bukan exception transport. Ini downstream response.

## 3.3 Response processing failures

Response diterima, tapi gagal diproses:

- invalid JSON;
- unknown enum;
- missing provider;
- response stream read error.

JAX-RS Client punya `ResponseProcessingException`.

## 3.4 Semantic failures

HTTP 200 tapi business result gagal:

```json
{
  "success": false,
  "errorCode": "LIMIT_EXCEEDED"
}
```

Sebaiknya API modern tidak melakukan ini, tapi real-world integrasi sering begitu.

## 3.5 Rule

Classify failures before deciding retry/fallback.

---

# 4. Transport Failure vs HTTP Failure vs Semantic Failure

## 4.1 Transport failure

```text
No response, cannot know whether downstream processed request.
```

This is dangerous for retrying unsafe operations.

## 4.2 HTTP failure

```text
Downstream returned status. Use status semantics.
```

Example:

```text
404 not retryable
429 retryable after delay maybe
503 retryable maybe
```

## 4.3 Semantic failure

```text
Protocol success but business failure.
```

Retry depends on business code.

## 4.4 Rule

Never treat all exceptions and HTTP statuses as the same “failure”.

---

# 5. Timeout: First Line of Defense

Timeout is mandatory.

Without timeout:

```text
thread waits indefinitely
connection pool held
request deadline exceeded
caller times out first
resource leak
```

## 5.1 Timeout types

- connect timeout;
- TLS handshake timeout;
- read/socket timeout;
- request timeout;
- operation deadline;
- queue timeout;
- acquisition timeout;
- downstream-specific timeout.

## 5.2 Timeout is not failure recovery

Timeout only bounds waiting.

After timeout, you still decide:

- retry?
- fallback?
- fail?
- circuit breaker record?

## 5.3 Rule

Timeout first, retry second. Never retry without bounded timeout.

---

# 6. Connect Timeout

Connect timeout limits how long to establish connection.

JAX-RS:

```java
Client client = ClientBuilder.newBuilder()
    .connectTimeout(500, TimeUnit.MILLISECONDS)
    .build();
```

## 6.1 Failure

If connection not established in time, JAX-RS Client throws `ProcessingException` with timeout cause.

## 6.2 Choose value

Usually short:

```text
100ms–2s
```

depending network.

## 6.3 Too high

Slow failover.

## 6.4 Too low

False failures during network jitter.

## 6.5 Rule

Connect timeout should be short and environment-informed.

---

# 7. Read Timeout

Read timeout limits waiting to read response.

JAX-RS:

```java
Client client = ClientBuilder.newBuilder()
    .readTimeout(2, TimeUnit.SECONDS)
    .build();
```

## 7.1 Failure

If server does not respond within timeframe, `ProcessingException` is thrown with `TimeoutException` as cause.

## 7.2 Important

Read timeout is often per blocking read/socket wait, not always full operation deadline depending implementation.

## 7.3 Streaming

For streaming responses, read timeout semantics may interact with chunk/event arrival.

## 7.4 Rule

Read timeout is necessary but may not replace end-to-end deadline.

---

# 8. Request Timeout vs Operation Deadline

## 8.1 Request timeout

Timeout configured in HTTP client.

## 8.2 Operation deadline

Maximum time allowed for business operation including:

- queue wait;
- retries;
- backoff;
- serialization;
- HTTP call;
- response processing.

## 8.3 Example

Caller budget:

```text
800ms total
```

Policy:

```text
attempt 1 timeout 250ms
backoff 50ms
attempt 2 timeout 250ms
decode/overhead 100ms
```

## 8.4 Rule

Retries must fit within operation deadline.

---

# 9. Timeout Budgeting

Timeouts across stack must align.

Example inbound request budget:

```text
API gateway timeout: 30s
service endpoint budget: 25s
downstream A budget: 2s
downstream B budget: 5s
database budget: 3s
```

## 9.1 Avoid impossible budgets

If caller times out at 2 seconds, downstream read timeout 10 seconds is wasteful.

## 9.2 Nested calls

Each layer should reserve time for itself and downstreams.

## 9.3 Tail latency

Retry increases tail latency.

## 9.4 Rule

Budget from caller deadline backward.

---

# 10. Deadline Propagation

Deadline propagation means passing remaining time downstream.

## 10.1 Header examples

```http
X-Request-Deadline: 2026-06-12T10:00:00Z
X-Timeout-Ms: 500
```

These are custom conventions unless using framework standard.

## 10.2 Benefits

Downstream can fail early rather than start work that will be abandoned.

## 10.3 Caveat

Headers are untrusted from external callers. Trust only internal boundary.

## 10.4 Rule

Deadline propagation improves coordinated failure, but must be standardized internally.

---

# 11. Retry: Powerful and Dangerous

Retry can hide transient failures.

Retry can also create an outage.

## 11.1 Retry helps when

- transient network failure;
- temporary overload;
- leader failover;
- short 503 maintenance;
- 429 with Retry-After;
- connection reset before request processed.

## 11.2 Retry hurts when

- downstream already overloaded;
- request is expensive;
- operation is non-idempotent;
- failure is permanent;
- many clients retry together;
- retry exceeds caller deadline.

## 11.3 Rule

Retry only when likely to succeed and safe to repeat.

---

# 12. Retry Safety: Safe, Idempotent, and Idempotency-Key

## 12.1 Safe methods

GET/HEAD/OPTIONS are safe by HTTP semantics.

Safe means intended not to change server state.

## 12.2 Idempotent methods

PUT, DELETE, and safe methods are idempotent by HTTP semantics.

Idempotent means same request repeated has same intended effect.

## 12.3 POST

POST is generally not idempotent.

Can be made retry-safe with:

```text
Idempotency-Key
```

and server support.

## 12.4 PATCH

PATCH is not necessarily idempotent.

Requires contract analysis.

## 12.5 Rule

Retry decision must be method + endpoint + idempotency contract aware.

---

# 13. HTTP Method Semantics and Retry

## 13.1 GET

Usually retryable if:

- timeout;
- connection failure;
- 503;
- 429 with backoff.

## 13.2 PUT

Can be retryable if full replacement and idempotent.

Use `If-Match` if concurrency matters.

## 13.3 DELETE

Can be retryable carefully.

But response handling matters:

```text
first DELETE succeeds
retry returns 404
```

Client policy may treat 404 as success if resource absent is desired final state.

## 13.4 POST

Do not retry unless idempotency key or operation-specific guarantee.

## 13.5 PATCH

Retry only if idempotent patch contract and concurrency/idempotency in place.

## 13.6 Rule

HTTP method alone is not enough; endpoint semantics matter.

---

# 14. Retryable Failure Classification

Common retryable candidates:

## 14.1 Transport

- connect timeout;
- connection refused;
- connection reset before response;
- DNS transient;
- TLS transient rarely;
- read timeout for idempotent operation.

## 14.2 HTTP

- 408 Request Timeout;
- 429 Too Many Requests;
- 500 maybe, if known transient;
- 502 Bad Gateway;
- 503 Service Unavailable;
- 504 Gateway Timeout.

## 14.3 Semantic

- known transient code;
- lock timeout;
- dependency unavailable.

## 14.4 Rule

Start conservative. Add retryable cases based on evidence.

---

# 15. Non-Retryable Failures

Usually non-retryable:

- 400 malformed request;
- 401 invalid auth unless refresh token flow;
- 403 forbidden;
- 404 not found;
- 409 business conflict;
- 412 precondition failed;
- 413 payload too large;
- 415 unsupported media type;
- 422 validation failure;
- invalid response schema;
- permanent DNS misconfig;
- certificate validation failure.

## 15.1 Token expired exception

May be retryable once after refresh if server indicates expired token.

## 15.2 Rule

Do not retry caller bugs or business rejections.

---

# 16. Retry-After Header

Downstream may respond with:

```http
Retry-After: 120
```

or HTTP date.

Used with:

- 429;
- 503;
- redirects in some cases.

## 16.1 Respect it

If value fits within deadline and policy, wait.

## 16.2 Cap it

Do not wait beyond caller deadline or max retry delay.

## 16.3 If too large

Fail with retryable-after metadata to caller if appropriate.

## 16.4 Rule

`Retry-After` is cooperation signal, not command to ignore your own deadline.

---

# 17. Backoff and Jitter

## 17.1 Fixed delay

```text
100ms, 100ms, 100ms
```

Can synchronize clients.

## 17.2 Exponential backoff

```text
100ms, 200ms, 400ms
```

## 17.3 Jitter

Randomize delay.

```text
delay = random(0, base * 2^attempt)
```

## 17.4 Why jitter

Prevents retry storm thundering herd.

## 17.5 Rule

Use jitter for distributed retry.

---

# 18. Retry Budget

Retry budget limits total retry volume.

## 18.1 Why

If every request retries 3 times, downstream sees 4x load during failure.

## 18.2 Budget examples

```text
retries <= 10% of original request volume
max 1 retry for user-facing calls
max 2 retries for background jobs
```

## 18.3 Per service

Track retry ratio per downstream.

## 18.4 Rule

Retries must be globally bounded, not just per request.

---

# 19. Hedging vs Retry

Hedging sends duplicate request before first fails to reduce tail latency.

## 19.1 Example

Send second GET after p95 latency threshold if first still pending.

## 19.2 Dangerous

- doubles load;
- can duplicate side effects;
- requires idempotent/safe operations;
- complex cancellation.

## 19.3 Use cases

Read-only latency-critical requests in large distributed systems.

## 19.4 Rule

Do not use hedging unless you have strong operational maturity.

---

# 20. Idempotency-Key

Idempotency-Key is client-generated key identifying one intended operation.

```http
POST /payments
Idempotency-Key: 3f573...
```

## 20.1 Server behavior

Same key + same request returns same result.

Same key + different request returns conflict.

## 20.2 Client retry

If timeout occurs, client retries with same key.

## 20.3 Scope

Bind key to:

- actor;
- tenant;
- endpoint;
- method;
- request body hash;
- time window.

## 20.4 Rule

Idempotency-Key makes unsafe operations retry-safe only if server implements it correctly.

---

# 21. Conditional Requests and Idempotency

For PUT/PATCH/DELETE, combine retry safety with preconditions:

```http
If-Match: "v7"
```

## 21.1 Benefits

Prevents lost update if retry happens after resource changed.

## 21.2 Stale precondition

```text
412 Precondition Failed
```

Do not retry automatically as same request.

## 21.3 Rule

Conditional headers are part of resilience for mutable resources.

---

# 22. Circuit Breaker

Circuit breaker prevents repeated calls to failing dependency.

## 22.1 Goal

Fail fast when downstream is unhealthy.

## 22.2 Prevents

- thread exhaustion;
- connection pool exhaustion;
- cascading failure;
- retry storm.

## 22.3 Not magic

Circuit breaker does not fix downstream.

It protects caller.

## 22.4 Rule

Use circuit breaker for dependencies with meaningful failure rate and recovery behavior.

---

# 23. Circuit Breaker States

## 23.1 Closed

Calls allowed.

Failures counted.

## 23.2 Open

Calls fail fast without hitting downstream.

## 23.3 Half-open

Small number of trial calls allowed.

If success, close.

If fail, open again.

## 23.4 Parameters

- failure threshold;
- rolling window;
- minimum request count;
- open duration;
- half-open trial count.

## 23.5 Rule

Tune breaker to avoid flapping and false opens.

---

# 24. What Should Count as Failure?

Count as failure:

- timeout;
- connection errors;
- 500/502/503/504 maybe;
- response processing failure maybe.

Do not count:

- 400 validation error;
- 401 caller auth bug;
- 403 forbidden;
- 404 expected not found;
- 409 business conflict;
- 412 stale precondition.

## 24.1 Business-specific

Some 404s are failure if dependency should always have data.

## 24.2 Rule

Circuit failure classification must match operation semantics.

---

# 25. Circuit Breaker Scope

Possible scopes:

- per downstream service;
- per endpoint/operation;
- per tenant;
- per region;
- per host instance.

## 25.1 Too broad

One bad endpoint opens entire service.

## 25.2 Too narrow

Too many breakers, hard to observe.

## 25.3 Recommendation

Start per downstream operation group.

Example:

```text
PaymentGateway.charge
PaymentGateway.refund
CustomerDirectory.lookup
```

## 25.4 Rule

Breaker scope should reflect failure isolation boundary.

---

# 26. Bulkhead

Bulkhead limits concurrent use of a dependency or operation.

## 26.1 Why

Even if dependency is slow, it should not consume all caller resources.

## 26.2 Forms

- connection pool limit;
- thread pool;
- semaphore;
- queue limit;
- rate limiter.

## 26.3 Example

```text
max 30 concurrent calls to DocumentService
```

## 26.4 Rule

Every critical downstream should have concurrency isolation.

---

# 27. Connection Pool as Bulkhead

HTTP client connector often has connection pool.

## 27.1 Per route max

Limit connections to one host.

## 27.2 Global max

Limit all outbound connections.

## 27.3 Acquisition timeout

How long to wait for available connection.

## 27.4 Implementation-specific

JAX-RS standard API does not standardize all pool tuning.

## 27.5 Rule

Tune connection pools per implementation and downstream.

---

# 28. Thread Pool Bulkhead

Async client calls or wrapper can use dedicated executor.

## 28.1 Example

```text
paymentExecutor max 20 threads, queue 100
searchExecutor max 50 threads, queue 200
```

## 28.2 Risk

Thread pools can hide queue latency.

## 28.3 Queue timeout

Do not wait in queue longer than deadline.

## 28.4 Rule

Bound thread pools and queues; observe queue wait.

---

# 29. Semaphore Bulkhead

Semaphore bulkhead limits concurrency without separate thread pool.

## 29.1 Example

```java
if (!semaphore.tryAcquire()) {
    throw new BulkheadRejectedException();
}
try {
    return call();
} finally {
    semaphore.release();
}
```

## 29.2 Good for

Synchronous calls where caller thread executes operation.

## 29.3 Benefit

Simple and low overhead.

## 29.4 Rule

Semaphore bulkhead is often good for synchronous JAX-RS client wrappers.

---

# 30. Rate Limit and Client-Side Throttling

Client-side rate limiting protects downstream and respects quotas.

## 30.1 Use cases

- external API quota;
- shared tenant quota;
- expensive endpoint;
- known downstream capacity.

## 30.2 Token bucket

Allows burst with sustained rate.

## 30.3 Leaky bucket

Smooths traffic.

## 30.4 Server feedback

Use 429 and Retry-After to adjust.

## 30.5 Rule

If downstream has quota, enforce client-side throttle before server rejects.

---

# 31. Fallback

Fallback returns alternative result when call fails.

## 31.1 Good fallback

- cached value;
- default non-critical feature flag;
- degraded response;
- empty optional widget;
- queued async operation.

## 31.2 Bad fallback

- fake success for payment;
- stale authorization decision;
- default allow on security failure;
- silently empty critical data.

## 31.3 Rule

Fallback must be safe, honest, and domain-approved.

---

# 32. Fallback Types

## 32.1 Cache fallback

Use last known value.

## 32.2 Static fallback

Default configuration.

## 32.3 Degraded feature

Hide recommendation panel.

## 32.4 Async fallback

Queue work for later.

## 32.5 Fail-fast fallback

Return controlled error quickly.

## 32.6 Rule

Fallback is not always data; sometimes fallback is fast failure.

---

# 33. Fallback Dangers

## 33.1 Data correctness

Stale data can mislead.

## 33.2 Security

Never default-allow.

## 33.3 Observability

Fallback can hide incidents.

## 33.4 User trust

Silent degraded result can be worse than explicit error.

## 33.5 Rule

Fallback must be visible in metrics/logs and often in response metadata.

---

# 34. Caching as Resilience

Cache can reduce dependency load and provide fallback.

## 34.1 Read-through cache

Call downstream on miss.

## 34.2 Cache-aside

Application controls cache.

## 34.3 Negative caching

Cache 404/not found briefly if safe.

## 34.4 Stale cache

Serve stale value when downstream unavailable if domain allows.

## 34.5 Rule

Cache fallback needs TTL, invalidation, and correctness policy.

---

# 35. Stale-While-Revalidate and Graceful Degradation

## 35.1 Concept

Serve stale data temporarily while refreshing in background.

## 35.2 Good for

- product catalog;
- reference data;
- public configuration;
- non-critical recommendations.

## 35.3 Bad for

- permissions;
- balances;
- workflow state;
- legal/compliance data.

## 35.4 Rule

Stale data is domain decision.

---

# 36. Queueing and Load Shedding

If system overloaded, waiting may be worse than rejecting.

## 36.1 Load shedding

Fail fast with:

```http
503 Service Unavailable
Retry-After: 1
```

or internal error to caller.

## 36.2 Queue limit

Bound queue.

## 36.3 Deadline-aware queue

If request deadline too close, reject.

## 36.4 Rule

Bounded rejection is healthier than unbounded waiting.

---

# 37. Resilience Policy Order

Common order:

```text
caller deadline
  ↓
bulkhead / rate limiter
  ↓
circuit breaker
  ↓
retry policy
  ↓
timeout per attempt
  ↓
JAX-RS client call
  ↓
response/error classifier
  ↓
fallback if allowed
```

## 37.1 Alternative order

Some libraries place retry inside/outside circuit breaker differently.

This changes metrics and breaker behavior.

## 37.2 Example

If circuit breaker wraps retry, one operation failure recorded after all retries.

If retry wraps circuit breaker, each attempt may affect breaker.

## 37.3 Rule

Know your policy composition order.

---

# 38. MicroProfile Fault Tolerance Overview

MicroProfile Fault Tolerance defines standardized annotations/policies for:

- Timeout;
- Retry;
- Fallback;
- CircuitBreaker;
- Bulkhead;
- Asynchronous.

## 38.1 Example

```java
@ApplicationScoped
public class CustomerGateway {

    @Timeout(500)
    @Retry(maxRetries = 1, delay = 50, jitter = 50)
    @CircuitBreaker(requestVolumeThreshold = 20, failureRatio = 0.5, delay = 5000)
    @Bulkhead(30)
    public CustomerResponse getCustomer(CustomerId id) {
        return callWithJaxRsClient(id);
    }
}
```

## 38.2 Benefits

- declarative;
- portable across MicroProfile runtimes;
- integrates with CDI;
- metrics support in many runtimes.

## 38.3 Caveat

Annotation policy is still operation policy. Do not copy-paste.

## 38.4 Rule

MicroProfile FT is a resilience policy mechanism, not a substitute for design.

---

# 39. Using MicroProfile Fault Tolerance with JAX-RS Client

## 39.1 Wrapper service

Put annotations on gateway method, not random helper.

```java
@ApplicationScoped
public class PaymentGateway {

    @Timeout(1000)
    @Retry(maxRetries = 0)
    @CircuitBreaker
    @Bulkhead(20)
    public PaymentResult charge(ChargeCommand command) {
        try (Response response = target.request()
            .header("Idempotency-Key", command.idempotencyKey())
            .post(Entity.json(command))) {
            return decodeCharge(response);
        }
    }
}
```

## 39.2 Why wrapper

Centralizes:

- URI;
- headers;
- DTO;
- error mapping;
- resilience;
- metrics.

## 39.3 Avoid annotating private method

CDI interceptors may not apply to self-invocation/private methods depending runtime.

## 39.4 Rule

Use CDI-managed outbound gateway beans for fault tolerance annotations.

---

# 40. Programmatic Resilience Wrapper

Sometimes annotations are not enough.

## 40.1 Interface

```java
public interface ResilientHttpOperation<T> {
    T execute() throws Exception;
}
```

## 40.2 Wrapper responsibilities

- deadline;
- bulkhead acquire;
- circuit check;
- attempts;
- timeout per attempt;
- response classification;
- fallback;
- metrics.

## 40.3 Why programmatic

Needed for:

- dynamic policies;
- non-CDI code;
- advanced retry classification;
- per-call deadlines;
- streaming.

## 40.4 Rule

Keep programmatic policy reusable but operation-aware.

---

# 41. Resilience4j / Custom Library Integration

Resilience4j and similar libraries provide:

- Retry;
- CircuitBreaker;
- Bulkhead;
- RateLimiter;
- TimeLimiter.

## 41.1 Advantages

- rich programmatic model;
- Spring/non-Jakarta support;
- composition control;
- metrics integration.

## 41.2 Caveat

Library-specific behavior/order.

## 41.3 Rule

If not on MicroProfile runtime, use a proven resilience library instead of ad-hoc retry loops.

---

# 42. JAX-RS Client Timeout Configuration

## 42.1 Standard API

```java
Client client = ClientBuilder.newBuilder()
    .connectTimeout(500, TimeUnit.MILLISECONDS)
    .readTimeout(2, TimeUnit.SECONDS)
    .build();
```

## 42.2 Infinite timeout

Value `0` means infinity.

Avoid in production.

## 42.3 Per-client

These are client builder settings.

Per-request timeout may require implementation-specific properties or separate clients.

## 42.4 Rule

Set baseline timeouts on every Client; override per operation only deliberately.

---

# 43. Exception Mapping in Client Resilience

## 43.1 Transport

```java
catch (ProcessingException e)
```

Classify cause:

- TimeoutException;
- ConnectException;
- SSLException;
- UnknownHostException.

## 43.2 Response processing

```java
catch (ResponseProcessingException e)
```

Means response was received but processing failed.

## 43.3 HTTP errors

If you use `Response`, non-2xx is not necessarily exception.

Decode and classify.

## 43.4 Rule

Resilience layer needs typed failure classification.

---

# 44. Response Body Consumption and Resilience

## 44.1 Retry after response body?

If HTTP response is 503 with small Problem Details, safe.

## 44.2 If streaming body partially consumed

Retry may produce duplicate partial file unless range/resume supported.

## 44.3 Error decoder

Must close response and not buffer huge body.

## 44.4 Rule

Retry logic must account for request and response entity streaming.

---

# 45. Streaming Downloads and Retry

## 45.1 Failure mid-download

Connection drops after 50MB of 100MB.

Retry full download wastes bandwidth and may corrupt destination if appends wrong.

## 45.2 Use Range resume

If server supports:

- ETag;
- Accept-Ranges;
- Range;
- If-Range.

## 45.3 Rule

Streaming download retry should be resume-aware, not blind.

---

# 46. Uploads and Retry

## 46.1 Upload timeout

Did server store file or not? Unknown.

## 46.2 Retry requires

- idempotency key;
- upload session;
- checksum;
- object storage multipart upload;
- resumable upload protocol.

## 46.3 Do not retry large POST upload blindly

Can duplicate storage and scan work.

## 46.4 Rule

Uploads need explicit resumable/idempotent design for retry.

---

# 47. SSE and Resilience

## 47.1 SSE reconnect

SSE client has reconnect behavior.

## 47.2 Last-Event-ID

Use event ID to resume if server supports replay.

## 47.3 Backoff

Reconnect delay should avoid storm.

## 47.4 Rule

SSE resilience is stream-specific: reconnect + replay + resync.

---

# 48. Authentication Token Refresh

## 48.1 401 response

If token expired, client may refresh token and retry once.

## 48.2 Danger

If many requests see 401, they may all refresh.

Use single-flight refresh.

## 48.3 Do not retry invalid credentials forever

If refresh fails, fail.

## 48.4 Rule

Token refresh is a specialized retry with concurrency control.

---

# 49. Service Discovery and Load Balancing

## 49.1 Multiple endpoints

If one instance fails, client/load balancer may choose another.

## 49.2 Retry across hosts

Safer for idempotent requests.

## 49.3 Sticky state

If downstream operation is not stateless, retrying another host may fail.

## 49.4 Service mesh

May provide retries/circuit breakers too.

Avoid duplicating policies without coordination.

## 49.5 Rule

Client resilience must align with load balancer/service mesh policy.

---

# 50. Per-Downstream Policy

Each downstream has different behavior.

## 50.1 Payment service

```text
no blind retry
idempotency key required
strict timeout
fallback none
```

## 50.2 Catalog service

```text
retry GET
serve stale cache fallback
circuit breaker
```

## 50.3 Notification service

```text
async queue fallback
best-effort
```

## 50.4 Identity service

```text
short timeout
no default allow
fail closed
```

## 50.5 Rule

One global policy for all downstreams is usually wrong.

---

# 51. Configuration Strategy

## 51.1 Config fields

```yaml
downstreams:
  customer:
    baseUrl: ...
    connectTimeoutMs: 300
    readTimeoutMs: 1000
    maxRetries: 1
    retryBaseDelayMs: 50
    circuitFailureRatio: 0.5
    bulkheadMaxConcurrent: 50
```

## 51.2 Validate config

Prevent:

- negative timeout;
- zero infinite timeout in prod;
- retry too high;
- bulkhead too high;
- delay beyond deadline.

## 51.3 Dynamic config

Useful but dangerous.

Changes must be observable and audited.

## 51.4 Rule

Resilience config is production control plane; validate it.

---

# 52. Observability

Resilience without observability is guesswork.

Need know:

- timeout rate;
- retry count;
- retry success;
- circuit state;
- bulkhead rejects;
- fallback usage;
- latency distribution;
- downstream status codes;
- remaining deadline.

## 52.1 Operation labels

Use logical names:

```text
PaymentGateway.charge
CustomerGateway.getCustomer
```

not full URL.

## 52.2 Rule

Every resilience decision should be measurable.

---

# 53. Metrics

Suggested metrics:

```text
http_client_requests_total{client,operation,status,attempt}
http_client_duration_seconds{client,operation}
http_client_attempt_duration_seconds{client,operation,attempt}
http_client_retries_total{client,operation,outcome}
http_client_timeouts_total{client,operation,type}
http_client_circuit_state{client,operation,state}
http_client_circuit_open_total{client,operation}
http_client_bulkhead_rejected_total{client,operation}
http_client_rate_limited_total{client,operation}
http_client_fallback_total{client,operation,type}
http_client_retry_after_observed_total{client,operation}
```

## 53.1 Avoid high cardinality

Do not label by:

- URL with IDs;
- request body;
- tenant ID if high-cardinality;
- exception message.

## 53.2 Rule

Metrics should reveal dependency health and policy behavior.

---

# 54. Tracing

## 54.1 Spans per attempt

Either create:

- one parent outbound operation span;
- child span per retry attempt.

## 54.2 Attributes

- downstream service;
- operation;
- attempt number;
- timeout;
- retry decision;
- circuit state;
- status.

## 54.3 Events

```text
retry.scheduled
circuit.open
bulkhead.rejected
fallback.used
```

## 54.4 Rule

Traces should show why time was spent, not only final failure.

---

# 55. Logging

## 55.1 Log resilience events

- circuit opened/closed;
- bulkhead rejection;
- fallback used;
- retry exhausted;
- timeout;
- token refresh failure.

## 55.2 Avoid log spam

Do not log every retry at error level.

## 55.3 Redact

No Authorization, cookies, PII.

## 55.4 Rule

Logs are for exceptional state transitions, metrics for volume.

---

# 56. Testing Resilience

## 56.1 Test cases

- connect timeout;
- read timeout;
- 503 then success;
- 429 Retry-After;
- 400 not retried;
- unsafe POST not retried;
- POST with Idempotency-Key retried if policy allows;
- circuit opens;
- circuit half-open recovers;
- bulkhead rejects;
- fallback used;
- response decode failure.

## 56.2 Use fake server

Mock server should simulate:

- delay;
- close connection;
- malformed JSON;
- status sequence;
- Retry-After;
- slow streaming.

## 56.3 Rule

Resilience tests must verify policy, not just implementation.

---

# 57. Chaos / Fault Injection

## 57.1 Inject failures

- latency;
- packet loss;
- 500/503;
- connection reset;
- DNS failure;
- TLS failure;
- slow response body;
- partial response.

## 57.2 In lower environments

Validate:

- no retry storm;
- circuit opens;
- fallback visible;
- request deadlines respected.

## 57.3 Rule

Resilience claims need failure drills.

---

# 58. OpenAPI and Contract Notes

## 58.1 Downstream contract should document

- idempotency key support;
- Retry-After usage;
- rate limit headers;
- ETag/precondition requirements;
- error format;
- 429/503 behavior.

## 58.2 Client wrapper uses docs

Do not guess.

## 58.3 Rule

Resilience depends on provider contract.

---

# 59. Runtime Differences and Implementation Notes

## 59.1 JAX-RS standard

Standardizes connect/read timeout APIs since JAX-RS 2.1/Jakarta REST.

## 59.2 Not fully standardized

- connection pool config;
- per-request timeout;
- redirect handling;
- proxy properties;
- low-level socket options;
- retry support.

## 59.3 MicroProfile FT

Depends on MicroProfile runtime/CDI interceptors.

## 59.4 Rule

Keep implementation-specific resilience config isolated.

---

# 60. Common Failure Modes

## 60.1 No timeout

Threads hang.

## 60.2 Retry all exceptions

Duplicate side effects.

## 60.3 Retry without jitter

Retry storm.

## 60.4 Retry beyond caller deadline

Wasted work.

## 60.5 Circuit breaker counts 404 as failure blindly

False open.

## 60.6 No bulkhead

One slow downstream kills whole service.

## 60.7 Fallback returns unsafe default

Security/data correctness bug.

## 60.8 Response not closed on error

Connection leak.

## 60.9 Multiple layers retry

Client + mesh + gateway = retry amplification.

## 60.10 Token refresh stampede

Auth service overload.

## 60.11 Streaming retried from beginning blindly

Corrupt/duplicate output.

## 60.12 Resilience not observable

Invisible degradation.

---

# 61. Best Practices

## 61.1 Set timeouts everywhere

Connect + read + operation deadline.

## 61.2 Retry conservatively

Only retry safe/idempotent/retry-safe operations.

## 61.3 Use backoff+jitter

Avoid synchronized retry.

## 61.4 Respect Retry-After

Within deadline.

## 61.5 Use Idempotency-Key for unsafe retryable operations

Server must support.

## 61.6 Add circuit breaker for unstable dependencies

Tune per operation.

## 61.7 Add bulkhead

Protect caller resources.

## 61.8 Use fallback only when semantically safe

And observe it.

## 61.9 Coordinate with service mesh/gateway

Avoid duplicate retry amplification.

## 61.10 Test failure modes

Timeout, 429, 503, malformed body, connection reset.

---

# 62. Anti-Patterns

## 62.1 `@Retry` on every method

Dangerous.

## 62.2 Infinite timeout

Production hang.

## 62.3 Retry POST without idempotency

Duplicate operations.

## 62.4 Fallback to empty list for critical data

Silent data loss.

## 62.5 Circuit breaker global for all downstream operations

One endpoint breaks all.

## 62.6 No queue limit

Memory/latency collapse.

## 62.7 Ignoring 429 Retry-After

Uncooperative client.

## 62.8 Catch `Exception` and return null

Failure hidden.

## 62.9 Metrics label full URL

Cardinality explosion.

## 62.10 Disabling TLS validation to “fix” timeout/failures

Security disaster.

---

# 63. Production Checklist

## 63.1 Timeout/deadline

- [ ] Connect timeout set.
- [ ] Read timeout set.
- [ ] Operation deadline defined.
- [ ] Retry delays fit deadline.
- [ ] Gateway/caller timeout aligned.
- [ ] Infinite timeout forbidden in prod.

## 63.2 Retry

- [ ] Retryable failures classified.
- [ ] Non-retryable statuses defined.
- [ ] Method/idempotency policy defined.
- [ ] Backoff+jitter configured.
- [ ] Retry budget defined.
- [ ] Retry-After respected.
- [ ] Unsafe operations require idempotency key.

## 63.3 Circuit/bulkhead/rate

- [ ] Circuit breaker scope defined.
- [ ] Failure classification configured.
- [ ] Bulkhead max concurrent configured.
- [ ] Connection pool limits configured.
- [ ] Rate limit/client throttle configured if needed.
- [ ] Rejection mapped correctly.

## 63.4 Fallback/cache

- [ ] Fallback approved by domain.
- [ ] Staleness limit defined.
- [ ] Security fallback fail-closed.
- [ ] Fallback visible in metrics/logs.
- [ ] Cache invalidation/TTL defined.

## 63.5 Observability/testing

- [ ] Metrics for timeout/retry/circuit/bulkhead/fallback.
- [ ] Tracing per attempt or event.
- [ ] Secret-safe logs.
- [ ] Fault injection tests.
- [ ] Contract tests for 429/503/Problem Details.
- [ ] Mesh/gateway retry coordination reviewed.

---

# 64. Latihan

## Latihan 1 — Timeout Baseline

Buat JAX-RS `Client` dengan:

```text
connectTimeout = 300ms
readTimeout = 1000ms
```

Test server delay melebihi timeout dan klasifikasikan `ProcessingException`.

## Latihan 2 — Retry Classifier

Implement policy:

- retry GET on 503 once;
- retry GET on connect timeout once;
- do not retry 400/404/409/412;
- respect Retry-After if <= 500ms.

## Latihan 3 — Idempotency-Key

Untuk POST `/exports`, retry hanya jika `Idempotency-Key` ada.

Mock server timeout lalu success.

Pastikan key sama.

## Latihan 4 — Circuit Breaker

Simulate 10 failures.

Circuit opens.

Next call fails fast.

After delay, half-open trial succeeds and circuit closes.

## Latihan 5 — Bulkhead

Limit 2 concurrent calls.

Start 3 slow calls.

Third rejected with `BULKHEAD_REJECTED`.

## Latihan 6 — Fallback

Catalog service unavailable.

Return cached catalog if age < 5 minutes.

Expose `degraded=true`.

## Latihan 7 — Token Refresh Single-Flight

10 concurrent calls get 401 expired token.

Only one refresh request should happen.

Others wait/reuse refreshed token.

## Latihan 8 — Streaming Download Resume

Download fails after 10MB.

Retry with `Range` and `If-Range`.

Validate checksum.

## Latihan 9 — Retry Amplification Review

Assume:

```text
client retries 2
service mesh retries 2
gateway retries 1
```

Calculate maximum attempts and redesign to avoid amplification.

---

# 65. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `ClientBuilder` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/clientbuilder

2. Jakarta RESTful Web Services 4.0 — Client API Package  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/package-summary

3. Jakarta RESTful Web Services 3.1 Specification — Client Exceptions  
   https://jakarta.ee/specifications/restful-ws/3.1/jakarta-restful-ws-spec-3.1.html

4. MicroProfile Fault Tolerance — Overview  
   https://microprofile.io/specifications/microprofile-fault-tolerance/

5. MicroProfile Fault Tolerance 4.1 Specification  
   https://download.eclipse.org/microprofile/microprofile-fault-tolerance-4.1/microprofile-fault-tolerance-spec-4.1.html

6. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

7. RFC 9111 — HTTP Caching  
   https://www.rfc-editor.org/rfc/rfc9111.html

8. RFC 6585 — Additional HTTP Status Codes  
   https://httpwg.org/specs/rfc6585.html

9. MDN — Retry-After Header  
   https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Retry-After

---

# 66. Penutup

Client resilience bukan fitur opsional untuk service-to-service architecture.

Mental model final:

```text
Outbound call
  ↓
deadline
  ↓
bulkhead/rate limit
  ↓
circuit breaker
  ↓
retry policy
  ↓
per-attempt timeout
  ↓
JAX-RS client invocation
  ↓
failure classifier
  ↓
fallback if safe
```

Prinsip final:

```text
Timeout prevents indefinite waiting.
Retry handles transient failure but can amplify outages.
Circuit breaker protects caller from unhealthy dependency.
Bulkhead prevents one dependency from consuming all resources.
Idempotency makes repeated unsafe requests safe only if server supports it.
Fallback is a domain decision, not technical decoration.
```

Top-tier JAX-RS engineer memastikan:

- setiap outbound operation punya resilience contract;
- timeout/deadline jelas;
- retry hanya untuk operasi yang aman;
- idempotency key dipakai untuk POST retry-safe;
- circuit breaker failure classification benar;
- bulkhead dan pool limits melindungi resource;
- fallback tidak merusak correctness/security;
- retry layer tidak dobel dengan mesh/gateway;
- metrics/traces/logs menunjukkan semua keputusan resilience;
- failure modes diuji dengan mock server/fault injection.

Part berikutnya:

```text
Bagian 031 — CDI Integration and Resource/Provider Injection
```

Kita akan membahas CDI integration secara mendalam: injection ke resource/provider, scope, proxy, lifecycle, request context, provider singleton caveats, `@Context` vs CDI injection, testing, and production patterns.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-029.md](./learn-jaxrs-advanced-part-029.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-031.md](./learn-jaxrs-advanced-part-031.md)

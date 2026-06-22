# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-023
# Fault Tolerance and Resilience: SmallRye Fault Tolerance, Time Budget, Isolation

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Part: `023`  
> Topik: Fault Tolerance and Resilience: SmallRye Fault Tolerance, Time Budget, Isolation  
> Status: Materi lanjutan advance — tidak mengulang dasar HTTP client, REST, atau exception handling  
> Target: Software engineer yang mampu mendesain resilience sebagai properti sistem, bukan sekadar memasang annotation retry/circuit breaker

---

## 0. Ringkasan Besar

Fault tolerance sering dipahami secara dangkal:

```java
@Retry
@CircuitBreaker
@Fallback
public Response call() {
    return external.call();
}
```

Namun production resilience bukan tentang menempel annotation sebanyak mungkin.

Production resilience adalah kemampuan sistem untuk:

1. membatasi kerusakan,
2. gagal secara terkendali,
3. menjaga resource tetap tersedia,
4. menghindari amplification,
5. menjaga user-facing path,
6. memberikan fallback yang aman,
7. mempertahankan auditability,
8. mencegah retry storm,
9. mengendalikan latency tail,
10. memastikan failure satu dependency tidak meruntuhkan seluruh sistem.

SmallRye Fault Tolerance di Quarkus menyediakan tools seperti:

- `@Timeout`
- `@Retry`
- `@CircuitBreaker`
- `@Fallback`
- `@Bulkhead`
- `@RateLimit`

Tetapi tools ini hanya berguna jika dipakai dengan mental model yang benar.

Part ini membahas resilience dari sisi **sistem**, bukan sekadar API.

---

## 1. Mental Model: Resilience Bukan “Agar Selalu Sukses”

Resilience bukan berarti semua request selalu sukses.

Resilience berarti:

```text
Sistem tetap terkendali saat sebagian komponennya gagal.
```

Kadang keputusan paling resilient adalah **gagal cepat**.

Contoh:

```text
External service down.
```

Pilihan buruk:

```text
Tunggu 30 detik.
Retry 5 kali.
Semua worker thread habis.
User-facing API ikut lambat.
```

Pilihan lebih baik:

```text
Timeout 800ms.
Circuit breaker open.
Fallback aman atau return controlled error.
Resource aplikasi tetap sehat.
```

Resilience adalah tentang **damage containment**.

---

## 2. Fault Tolerance vs Resilience

### 2.1 Fault Tolerance

Fault tolerance adalah mekanisme teknis untuk menghadapi failure lokal:

- timeout,
- retry,
- fallback,
- circuit breaker,
- bulkhead,
- rate limit.

### 2.2 Resilience

Resilience adalah properti arsitektur:

- dependency isolation,
- graceful degradation,
- load shedding,
- backpressure,
- idempotency,
- observability,
- operational control,
- SLO-based decision,
- recovery path,
- auditability.

Fault tolerance adalah alat.

Resilience adalah desain.

```text
Fault tolerance annotation tidak otomatis membuat sistem resilient.
```

---

## 3. Failure Taxonomy

Sebelum memilih retry/circuit breaker/fallback, klasifikasikan failure.

### 3.1 Technical Transient Failure

Contoh:

- network timeout,
- TCP reset,
- HTTP 502/503/504,
- temporary DNS issue,
- database deadlock,
- temporary connection pool exhaustion.

Biasanya:

```text
Retryable, bounded, with backoff.
```

### 3.2 Technical Permanent Failure

Contoh:

- wrong URL,
- TLS certificate invalid,
- authentication configuration wrong,
- schema incompatible,
- unsupported protocol,
- missing dependency.

Biasanya:

```text
Not retryable.
Fail fast.
Alert.
Fix config/code.
```

### 3.3 Business Failure

Contoh:

- validation failed,
- insufficient balance,
- invalid state transition,
- application already approved,
- duplicate business key,
- permission denied.

Biasanya:

```text
Not retryable.
Return business error.
Audit if required.
```

### 3.4 Capacity Failure

Contoh:

- 429 Too Many Requests,
- queue full,
- thread pool saturated,
- DB pool saturated,
- bulkhead rejected.

Biasanya:

```text
Backoff, shed load, reduce rate, fail fast.
```

### 3.5 Unknown Failure

Contoh:

- unexpected exception,
- null pointer,
- parsing bug,
- illegal state.

Biasanya:

```text
Do not blindly retry forever.
Classify, alert, fail controlled.
```

---

## 4. Quarkus SmallRye Fault Tolerance Extension

Add extension:

```bash
./mvnw quarkus:add-extension -Dextensions="smallrye-fault-tolerance"
```

Dependency concept:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-smallrye-fault-tolerance</artifactId>
</dependency>
```

The extension integrates MicroProfile Fault Tolerance and SmallRye-specific capabilities.

Core annotations:

```java
@Timeout
@Retry
@CircuitBreaker
@Fallback
@Bulkhead
```

SmallRye/Quarkus also supports `@RateLimit` and extra features such as backoff strategy annotations.

Important:

```text
These annotations usually apply through CDI interception.
The annotated method must be called through CDI proxy, not self-invoked directly.
```

Anti-pattern:

```java
@ApplicationScoped
public class MyService {

    public void outer() {
        inner(); // self-invocation may bypass interceptor
    }

    @Retry
    public void inner() {
        ...
    }
}
```

Better:

```text
Put fault-tolerant boundary in separate CDI bean
or call through injected proxy.
```

---

## 5. Resilience Boundary Placement

Where should fault tolerance annotations live?

Bad:

```java
@Path("/cases")
public class CaseResource {

    @Retry
    @Timeout
    @GET
    public CaseDto getCase(...) {
        ...
    }
}
```

Sometimes okay, but often too broad.

Better:

```text
Resource -> Application Service -> Gateway/Adapter -> External Client
```

Put resilience at the boundary that actually fails:

```java
@ApplicationScoped
public class IdentityGateway {

    @Timeout(800)
    @Retry(maxRetries = 1)
    @CircuitBreaker(...)
    public IdentitySnapshot loadIdentity(ApplicantId id) {
        ...
    }
}
```

Why?

Because:

- retry should wrap only external call or dependency boundary,
- fallback should be dependency-specific,
- circuit breaker should isolate one dependency,
- resource layer should not know dependency mechanics,
- service layer can decide degraded behavior.

Rule:

```text
Put fault tolerance around failure boundary, not around entire business transaction.
```

---

## 6. Timeout: The First and Most Important Resilience Primitive

Timeout prevents indefinite waiting.

Without timeout:

```text
A slow dependency converts into resource exhaustion.
```

### 6.1 Timeout Annotation

```java
import org.eclipse.microprofile.faulttolerance.Timeout;

@Timeout(800)
public IdentitySnapshot loadIdentity(ApplicantId id) {
    return client.getIdentity(id.value());
}
```

This means the call must complete within roughly 800ms.

### 6.2 Timeout Must Be Derived from SLA

Do not choose timeout randomly.

If inbound API has 2s SLA:

```text
total budget = 2000ms
```

Possible budget:

```text
validation           50ms
local DB read        150ms
identity API         600ms
risk API             500ms
DB write             200ms
outbox insert         50ms
serialization         50ms
buffer              400ms
```

Then identity API cannot have 5s timeout.

Invariant:

```text
Downstream timeout must fit upstream deadline.
```

### 6.3 Timeout Does Not Cancel Everything Magically

Depending on execution model:

- the caller may stop waiting,
- the underlying task may continue,
- remote server may still process request,
- side effect may still happen,
- thread may still be occupied until operation returns,
- connection may or may not be aborted.

Therefore:

```text
Timeout must be combined with idempotency for side-effecting calls.
```

---

## 7. Retry: Useful, Dangerous, and Often Overused

Retry helps when failure is transient.

Retry harms when failure is permanent or capacity-related.

### 7.1 Basic Retry

```java
import org.eclipse.microprofile.faulttolerance.Retry;
import org.eclipse.microprofile.faulttolerance.Timeout;

@Timeout(800)
@Retry(maxRetries = 2, delay = 100)
public IdentitySnapshot loadIdentity(ApplicantId id) {
    return client.getIdentity(id.value());
}
```

### 7.2 Retry Classification

Define what is retryable:

```java
@Retry(
    maxRetries = 2,
    retryOn = {
        ExternalTimeoutException.class,
        ExternalUnavailableException.class
    },
    abortOn = {
        ExternalValidationException.class,
        ExternalAuthorizationException.class,
        ExternalAuthenticationException.class
    }
)
public Result call() {
    ...
}
```

### 7.3 Retry Storm

Retry storm:

```text
External dependency slows down.
All callers retry.
Traffic multiplies.
Dependency gets worse.
Callers saturate.
System collapses.
```

Example:

```text
100 requests/s
maxRetries = 3
potential downstream load = 400 attempts/s
```

If timeout is long, resource usage multiplies too.

### 7.4 Retry Budget

Retry budget defines maximum extra attempts allowed.

Instead of:

```text
Always retry 3 times.
```

Use:

```text
Retry only if remaining deadline allows it.
Retry only transient failures.
Retry only idempotent operations.
Retry with backoff/jitter.
Retry max 1 for user-facing path.
Use async queue for heavy retry.
```

### 7.5 Backoff Strategy

MicroProfile Fault Tolerance retry supports delay/jitter; SmallRye adds extra backoff strategies such as exponential/fibonacci backoff.

Concept:

```java
@Retry(maxRetries = 3, delay = 100, jitter = 50)
@ExponentialBackoff
public Result call() {
    ...
}
```

Exact imports/attributes should be checked against the selected SmallRye Fault Tolerance version.

Design principle:

```text
Use backoff when failure indicates overload.
Use jitter to avoid synchronized retry.
```

---

## 8. Circuit Breaker: Fail Fast When Failure Is Repeated

Circuit breaker prevents repeated calls to known failing dependency.

States:

```text
CLOSED
  normal calls

OPEN
  fail fast

HALF_OPEN
  limited probe calls
```

### 8.1 Basic Circuit Breaker

```java
import org.eclipse.microprofile.faulttolerance.CircuitBreaker;

@CircuitBreaker(
    requestVolumeThreshold = 20,
    failureRatio = 0.5,
    delay = 5000
)
public Result call() {
    return dependency.call();
}
```

Meaning:

```text
Over a window of calls, if failure ratio exceeds threshold,
open circuit for delay period.
```

### 8.2 What Should Count as Failure?

Count:

- timeout,
- connection failure,
- 5xx,
- dependency unavailable,
- bulkhead failure depending policy.

Usually do not count:

- 400 validation,
- 403 authorization,
- 404 business not found,
- expected business conflict.

If business errors count as circuit failure, a client sending invalid data could open circuit incorrectly.

### 8.3 Circuit Breaker Is Per Boundary

Do not use one circuit breaker for all dependencies.

Better:

```text
identity-api circuit
risk-api circuit
email-api circuit
payment-api circuit
```

Even better:

```text
dependency + operation
```

Because:

```text
GET /identity may be healthy.
POST /identity/verify may be failing.
```

### 8.4 Circuit Breaker Tuning

Important parameters:

- request volume threshold,
- failure ratio,
- delay/open duration,
- half-open trial count,
- exception classification,
- fallback behavior.

Too sensitive:

```text
opens during small blips
```

Too insensitive:

```text
opens only after system already damaged
```

Tuning should use:

- real traffic volume,
- dependency latency,
- SLO,
- failure history,
- business criticality.

---

## 9. Bulkhead: Concurrency Isolation

Bulkhead limits concurrent executions.

Without bulkhead:

```text
Slow identity API consumes all worker threads.
Other endpoints slow down.
```

With bulkhead:

```text
Only N concurrent identity calls.
Excess calls fail/queue bounded.
```

### 9.1 Basic Bulkhead

```java
import org.eclipse.microprofile.faulttolerance.Bulkhead;

@Bulkhead(value = 10, waitingTaskQueue = 20)
public IdentitySnapshot loadIdentity(ApplicantId id) {
    return client.getIdentity(id.value());
}
```

Meaning:

```text
Up to 10 concurrent calls.
Up to 20 waiting.
More than that rejected.
```

### 9.2 Bulkhead Is Not Rate Limit

Bulkhead controls concurrency:

```text
How many at the same time?
```

Rate limit controls frequency:

```text
How many per time window?
```

You often need both.

### 9.3 Bulkhead and Retry Interaction

If retry wraps bulkhead incorrectly:

```text
Bulkhead rejected -> retry -> bulkhead rejected -> retry
```

This can add noise.

Policy:

```text
Usually do not retry bulkhead rejection immediately.
Use caller backpressure or fail fast.
```

---

## 10. Rate Limit: Frequency Control

Rate limit protects:

- downstream quota,
- internal capacity,
- expensive operations,
- shared dependencies.

Quarkus/SmallRye supports rate limiting via SmallRye Fault Tolerance extra features.

Concept:

```java
@RateLimit(value = 100, window = 1, windowUnit = ChronoUnit.MINUTES)
public Result call() {
    return dependency.call();
}
```

Important:

```text
Local rate limit is per application instance.
```

If you have 6 pods:

```text
100/min per pod = 600/min globally
```

For external global quota, use distributed rate limit:

- Redis token bucket,
- central quota service,
- broker/queue shaping,
- single worker,
- API gateway rate policy.

---

## 11. Fallback: Degradation with Intent

Fallback is not “return anything”.

Fallback must preserve correctness.

### 11.1 Safe Fallback Examples

| Dependency | Fallback |
|---|---|
| recommendation service | return empty recommendations |
| postal lookup | return manual input mode |
| dashboard aggregate | return stale snapshot with timestamp |
| email API | queue for retry |
| audit publisher | persist outbox |
| autocomplete | disable suggestions |

### 11.2 Unsafe Fallback Examples

| Dependency | Bad Fallback |
|---|---|
| authorization service | allow access |
| payment verification | assume paid |
| identity verification | assume identity valid |
| sanctions screening | skip check silently |
| case lock service | proceed without lock |

Rule:

```text
Security/compliance/financial correctness must fail closed unless an explicit compensating control exists.
```

### 11.3 Fallback Should Be Visible

Fallback should emit:

- metric,
- structured log,
- trace attribute,
- user-safe message if relevant,
- audit event if business decision is affected.

Invisible fallback is dangerous.

---

## 12. Load Shedding

Load shedding intentionally rejects work to protect the system.

Examples:

```text
If queue is full, reject new work.
If DB pool active > 90%, reject low-priority request.
If dependency circuit open, fail fast.
If CPU saturated, shed expensive endpoint.
```

This sounds harsh, but it prevents:

```text
all requests timing out
```

Better to reject 5% quickly than make 100% time out slowly.

### 12.1 Load Shedding Decisions

Need classification:

- critical vs non-critical,
- user-facing vs background,
- read vs write,
- free-text search vs status lookup,
- admin batch vs public API,
- tenant priority if applicable.

Example:

```text
During DB pressure:
- continue login/status checks,
- pause dashboard recalculation,
- reject report generation,
- slow background jobs.
```

---

## 13. Dependency Isolation

A service should isolate dependencies.

Types of isolation:

1. **Thread/concurrency isolation**
   - bulkhead.

2. **Connection isolation**
   - per-client pool.

3. **Timeout isolation**
   - per dependency timeout.

4. **Circuit isolation**
   - circuit breaker per dependency.

5. **Data isolation**
   - fallback cache per dependency.

6. **Transaction isolation**
   - do not hold DB locks during network calls.

7. **Deployment isolation**
   - separate worker service for heavy integration.

8. **Priority isolation**
   - user traffic separated from batch traffic.

### 13.1 Bad Shared Pool

```text
All outbound clients use same connection/thread pool.
Slow email API consumes capacity needed by identity API.
```

Better:

```text
Per dependency budget.
```

---

## 14. Time Budget and Deadline Propagation

Timeout should not be local guesses.

Use deadline thinking:

```text
Request enters service at t0.
Deadline = t0 + 2 seconds.
Every operation consumes part of deadline.
```

Pseudo-code:

```java
public Result handle(Request request) {
    Deadline deadline = Deadline.after(Duration.ofSeconds(2));

    validate(request, deadline.remaining());
    identityGateway.load(request.userId(), deadline.remaining());
    riskGateway.evaluate(request, deadline.remaining());
    repository.save(request, deadline.remaining());

    return Result.ok();
}
```

Even if you do not implement a formal Deadline class, think this way.

### 14.1 Deadline-Aware Retry

Bad:

```text
Retry because maxRetries not reached.
```

Better:

```text
Retry only if remaining time > minimum attempt budget.
```

Example:

```text
deadline remaining = 200ms
external API p95 = 500ms
do not retry
```

---

## 15. Cascading Failure

Cascading failure happens when one failure causes another.

Example:

```text
Risk API slow
  -> Application service threads blocked
  -> DB transactions stay open longer
  -> DB pool exhausted
  -> Other endpoints fail
  -> Users retry
  -> Load increases
  -> Application service crashes
```

Resilience controls break the chain:

```text
timeout
bulkhead
circuit breaker
fallback
load shedding
queue
idempotency
rate limit
```

A top-tier engineer asks:

```text
If this dependency slows down, what else does it consume?
```

Resources consumed:

- worker threads,
- event loop time,
- DB connections,
- HTTP connections,
- memory,
- CPU,
- queue slots,
- locks,
- user patience,
- retry budget.

---

## 16. Coordinated Omission

Coordinated omission is a measurement problem.

If your system stops sending requests during slow periods, your measured latency may look better than user experience.

Example benchmark:

```text
Send request.
Wait for response.
Send next request.
```

If response takes 10s, the benchmark sends fewer requests during slowness and underreports load/latency impact.

For resilience testing, use load tools that maintain request rate.

Why important?

Because circuit breaker/timeout tuning based on bad measurements will be wrong.

Measure:

- p50,
- p95,
- p99,
- p99.9,
- timeout rate,
- queue wait,
- bulkhead rejection,
- saturation,
- end-to-end latency.

---

## 17. Tail Latency

Average latency hides pain.

Example:

```text
p50 = 50ms
p95 = 500ms
p99 = 5000ms
```

If user-facing SLA is 2s, p99 is bad.

Fault tolerance must target tail:

- timeout caps worst-case wait,
- bulkhead caps queueing,
- circuit breaker fails fast,
- fallback avoids waiting,
- rate limit prevents overload,
- load shedding prevents collapse.

Rule:

```text
Resilience engineering is mostly tail-latency engineering.
```

---

## 18. Graceful Degradation

Graceful degradation means system returns reduced but useful functionality.

Examples:

```text
Dashboard shows last refreshed value.
Search disables expensive filter.
Case page shows core data but hides recommendation panel.
Report request is queued instead of generated inline.
Email notification delayed but transaction completes.
```

Degradation requires product/domain decision.

It cannot be invented by infrastructure alone.

Ask:

1. What is essential?
2. What is optional?
3. What can be stale?
4. What can be async?
5. What must fail closed?
6. What must be audited?

---

## 19. Resilience and Idempotency

Retry, timeout, and fallback require idempotency.

If call times out:

```text
Did remote service process it or not?
```

Unknown.

Therefore side-effecting calls need:

- idempotency key,
- unique business key,
- request hash,
- outbox,
- reconciliation,
- status query,
- compensating action.

Example:

```text
POST create case timed out.
```

Recovery:

```text
Query by idempotency key/business key.
If exists, use existing.
If not, retry create.
```

Without idempotency, retry can duplicate.

---

## 20. Resilience and Transactions

Do not combine long network waits with DB transaction.

Bad:

```java
@Transactional
public void approve(ApplicationId id) {
    Application app = repository.lock(id);
    external.notify(app);
    app.approve();
}
```

Failure modes:

- DB lock held during external wait,
- timeout uncertain,
- rollback cannot undo external notify,
- retry can duplicate notify,
- lock contention affects other users.

Better:

```java
@Transactional
public void approve(ApplicationId id) {
    Application app = repository.lock(id);
    app.approve();
    outbox.insertNotification(app.id());
}
```

Then publisher handles external notify with resilience/idempotency.

---

## 21. Applying Multiple Fault Tolerance Annotations

Annotation composition matters.

Example:

```java
@Timeout(800)
@Retry(maxRetries = 1)
@CircuitBreaker(...)
@Bulkhead(...)
@Fallback(...)
public Result call() {
    ...
}
```

Questions:

1. Does timeout apply per attempt or total?
2. Does retry happen before fallback?
3. Are circuit breaker failures counted before/after retry?
4. Does bulkhead rejection trigger retry?
5. Does fallback receive final failure?
6. Are exceptions classified correctly?

You must verify behavior against the selected SmallRye version.

Design guideline:

```text
Prefer simple combinations.
Test actual behavior.
Do not stack annotations blindly.
```

---

## 22. Programmatic Fault Tolerance

Annotation-based FT is convenient, but sometimes programmatic FT is better.

Use programmatic style when:

- policy depends on runtime config,
- operation selected dynamically,
- multiple dependencies share policy factory,
- deadline-aware retry needed,
- you need explicit composition,
- you want testable policy objects.

SmallRye Fault Tolerance has programmatic APIs and supports guarding `Uni` returning actions.

Conceptual shape:

```java
FaultTolerance<Result> ft = FaultTolerance.create(...)
        .withTimeout(...)
        .withRetry(...)
        .withCircuitBreaker(...)
        .build();

Result result = ft.call(() -> dependency.call());
```

Exact API should be checked against SmallRye version.

---

## 23. Reactive Fault Tolerance

In reactive systems, resilience must respect non-blocking execution.

For `Uni<T>`:

```java
public Uni<Result> call() {
    return client.call()
            .ifNoItem().after(Duration.ofMillis(800)).fail()
            .onFailure(TransientFailure.class).retry().atMost(1)
            .onFailure().recoverWithItem(this::fallback);
}
```

Important:

- do not block event loop,
- timeout should be non-blocking,
- retry should not create retry storm,
- fallback should be non-blocking if possible,
- circuit breaker stateful strategy must be understood,
- context propagation must be maintained.

Reactive code does not remove resilience needs.

It just changes execution mechanics.

---

## 24. Virtual Threads and Fault Tolerance

Virtual threads reduce the cost of blocking waits.

They do not solve:

- missing timeout,
- dependency overload,
- duplicate retries,
- circuit breaking,
- DB lock held during network call,
- external rate limit,
- unsafe fallback.

Virtual threads can make code simpler:

```text
blocking style + strict timeout + bulkhead + idempotency
```

But virtual threads can also hide high concurrency until downstream collapses.

Rule:

```text
Virtual threads reduce thread scarcity.
They do not remove downstream scarcity.
```

---

## 25. Resilience for Background Jobs

Background jobs need different resilience from user requests.

User request:

```text
low latency, fail fast, user-visible
```

Background job:

```text
can retry longer, can checkpoint, can pause, can process later
```

Do not use same policy blindly.

Example:

| Aspect | User Request | Background Job |
|---|---|---|
| Timeout | short | per-item/per-batch |
| Retry | limited | more attempts with backoff |
| Fallback | degraded response | queue/retry/checkpoint |
| User impact | immediate | delayed processing |
| Audit | request log | job_run/item_result |
| Idempotency | required for side effect | mandatory |

---

## 26. Resilience for Messaging

Message consumers need:

- ack/nack policy,
- retry topic,
- DLQ,
- idempotency,
- poison message handling,
- backpressure,
- consumer lag monitoring,
- circuit breaker around downstream,
- pause/resume consumption.

If downstream is down:

```text
Do not keep consuming unlimited messages and failing them instantly.
```

Better:

- circuit open,
- pause consumer,
- nack with delay,
- route to retry topic,
- DLQ after max attempt,
- preserve ordering if required.

---

## 27. Resilience Metrics

Measure strategy behavior, not only request latency.

Metrics:

```text
ft_timeout_total{method}
ft_retry_total{method,reason}
ft_retry_exhausted_total{method}
ft_circuit_open_total{method}
ft_circuit_state{method,state}
ft_bulkhead_rejected_total{method}
ft_bulkhead_concurrent_executions{method}
ft_rate_limited_total{method}
fallback_total{method,fallback_type}
dependency_unavailable_total{dependency}
dependency_latency_seconds{dependency,operation}
deadline_exceeded_total{operation}
load_shed_total{reason}
```

Business metrics:

```text
degraded_response_total
stale_response_served_total
async_queued_due_to_dependency_total
manual_recovery_required_total
```

---

## 28. Alerting Strategy

Bad alerts:

```text
One timeout happened.
```

Better alerts:

```text
timeout rate > 5% for 5 minutes
circuit open for critical dependency > 2 minutes
bulkhead rejection > threshold
fallback rate > baseline x 3
retry exhausted > threshold
dependency p99 > SLO
no successful external sync in X minutes
DLQ growth > threshold
```

Alert should map to runbook.

If no one knows what to do, alert is noise.

---

## 29. Resilience Runbook

For each critical dependency, document:

```text
Dependency name
Owner/team
Business function
Criticality
Timeout
Retry policy
Circuit breaker policy
Fallback
Rate limit
Bulkhead limit
Dashboard
Alert
Manual mitigation
Recovery validation
Rollback plan
```

Example:

```text
Dependency: Identity API
Criticality: high for application submission
Timeout: 800ms
Retry: max 1 on 5xx/timeout
Circuit: open after 50% failure over 20 requests
Fallback: none for submit; stale for profile display
Bulkhead: 20 concurrent
Manual mitigation: disable optional enrichment; keep core submission blocked if identity required
```

---

## 30. Testing Resilience

### 30.1 Timeout Test

Simulate dependency sleeping beyond timeout.

Assert:

- timeout exception,
- duration capped,
- metric emitted,
- no thread starvation.

### 30.2 Retry Test

Simulate:

```text
fail once -> success
```

Assert:

- two attempts,
- result success,
- metric retry count 1.

Simulate:

```text
validation error
```

Assert:

- no retry.

### 30.3 Circuit Breaker Test

Simulate repeated failures.

Assert:

- circuit opens,
- calls fail fast,
- after delay half-open trial happens,
- success closes circuit.

### 30.4 Bulkhead Test

Send concurrent calls beyond limit.

Assert:

- only N active,
- extra rejected or queued,
- rejection metric emitted.

### 30.5 Fallback Test

Simulate dependency failure.

Assert:

- fallback used,
- fallback safe,
- stale marker returned if stale,
- metric/log emitted.

### 30.6 Retry Storm Test

Run load with dependency slow.

Assert:

- total attempts bounded,
- system remains responsive,
- bulkhead works,
- circuit opens,
- p99 capped.

### 30.7 Native Image Test

If native deployment:

- verify FT interceptors work,
- verify client proxy generation,
- verify exception mapping,
- verify metrics,
- verify TLS/client behavior.

---

## 31. Chaos and Failure Injection

Inject:

- latency,
- 500,
- 503,
- 429,
- connection reset,
- DNS failure,
- TLS failure,
- malformed JSON,
- partial response,
- slow DB,
- pool exhaustion,
- broker down,
- Redis down,
- token endpoint down.

Observe:

- does system fail fast?
- are resources preserved?
- are retries bounded?
- are fallbacks safe?
- do alerts trigger?
- can operators diagnose?
- does recovery happen automatically?

Chaos testing without observability is theater.

---

## 32. Configuration Governance

Fault tolerance values should be configurable but governed.

Bad:

```java
@Timeout(10000)
@Retry(maxRetries = 5)
```

Hardcoded values become hidden policy.

Better:

- defaults in code,
- override via config,
- documented per dependency,
- reviewed through change control,
- environment-specific only when justified.

However:

```text
Do not let random runtime changes silently alter safety-critical behavior.
```

For critical dependency, config change should be visible and auditable.

---

## 33. Case Study: Identity API for Application Submission

Requirement:

```text
Application submission requires identity verification.
If identity API unavailable, submission cannot proceed.
User-facing SLA: 3 seconds.
```

### 33.1 Policy

```text
Timeout: 800ms
Retry: max 1 on timeout/5xx only
Backoff: 100ms jitter
Circuit breaker: open after 50% failures over 20 calls
Bulkhead: 20 concurrent
Fallback: none for submission
Fallback for profile display: stale identity snapshot <= 24h
```

### 33.2 Why No Fallback for Submission?

Because identity is mandatory.

Returning success without identity verification violates business/security rule.

Correct degraded behavior:

```text
Return controlled error:
"Identity verification is temporarily unavailable. Please try again later."
```

### 33.3 Resource Protection

If identity API is down:

```text
circuit opens
requests fail fast
threads preserved
DB not locked
system remains responsive
```

---

## 34. Case Study: Dashboard Summary

Requirement:

```text
Dashboard shows count and trend.
It can be stale for 5 minutes.
```

Policy:

```text
Timeout: 300ms
Retry: none for user request
Fallback: stale cached summary
Circuit breaker: yes
Bulkhead: small
Background refresh: yes
```

User response:

```json
{
  "pendingCases": 123,
  "overdueCases": 7,
  "asOf": "2026-06-20T10:00:00Z",
  "freshness": "STALE"
}
```

This is good fallback because:

- user gets useful information,
- stale is explicit,
- correctness tolerance known.

---

## 35. Case Study: Email Notification

Requirement:

```text
After application expires, email notification should be sent.
User does not wait for email.
```

Policy:

```text
Do not call email API inline.
Use outbox.
Publisher has retry with backoff.
DLQ after max attempts.
Idempotency key per notification type/application.
Circuit breaker around email provider.
Bulkhead and rate limit.
```

This design prevents email provider outage from breaking core transaction.

---

## 36. Common Anti-Patterns

### 36.1 Retry Without Timeout

Retrying calls that can hang.

### 36.2 Timeout Larger Than Upstream SLA

Caller times out before callee policy ends.

### 36.3 Retry All Exceptions

Business errors and auth failures retried uselessly.

### 36.4 Circuit Breaker Counts 4xx Business Errors

Invalid user input opens dependency circuit.

### 36.5 Fallback Hides Critical Failure

System silently skips required check.

### 36.6 Bulkhead Too Large

Bulkhead limit equals entire worker pool, so isolation is fake.

### 36.7 Local Rate Limit for Global Quota

Multiple pods exceed provider quota.

### 36.8 Long Transaction Around Network Call

DB locks held during external latency.

### 36.9 Self-Invocation Bypasses FT Interceptor

Annotation appears present but not applied.

### 36.10 No Metrics for Fallback

System degraded but no one knows.

### 36.11 Same Policy for All Dependencies

Email, identity, payment, dashboard all need different policies.

### 36.12 Fallback Returns Default Success

This is often data corruption disguised as resilience.

---

## 37. Production Checklist

### 37.1 Dependency Classification

- [ ] Dependency owner known.
- [ ] Criticality known.
- [ ] Failure type classified.
- [ ] User impact known.
- [ ] Business fallback rules defined.
- [ ] Security/compliance failure behavior defined.

### 37.2 Timeout

- [ ] Inbound SLA known.
- [ ] Downstream timeout fits deadline.
- [ ] Connect/read/operation timeout configured.
- [ ] Background job timeout separate from user request timeout.
- [ ] Long waits avoided in transactions.

### 37.3 Retry

- [ ] Retryable exceptions explicit.
- [ ] Abort exceptions explicit.
- [ ] Retry count bounded.
- [ ] Backoff/jitter used where needed.
- [ ] Retry budget fits deadline.
- [ ] Side effects are idempotent.

### 37.4 Circuit Breaker

- [ ] Circuit per dependency/operation.
- [ ] Failure classification correct.
- [ ] Threshold tuned to traffic volume.
- [ ] Open/half-open behavior tested.
- [ ] Circuit state observable.
- [ ] Fallback behavior safe.

### 37.5 Isolation

- [ ] Bulkhead set per dependency.
- [ ] Rate limit set if dependency has quota.
- [ ] Global quota handled globally.
- [ ] Connection pool budget understood.
- [ ] User-facing and background workload separated.

### 37.6 Fallback and Degradation

- [ ] Fallback does not violate correctness.
- [ ] Security failures fail closed.
- [ ] Stale data marked.
- [ ] Async queue/outbox used for side effects.
- [ ] Degraded mode visible in metrics/logs.

### 37.7 Observability

- [ ] Timeout metric.
- [ ] Retry metric.
- [ ] Circuit metric.
- [ ] Bulkhead rejection metric.
- [ ] Rate limit metric.
- [ ] Fallback metric.
- [ ] Dependency latency p95/p99.
- [ ] Dashboard and alert.

### 37.8 Testing

- [ ] Timeout test.
- [ ] Retry test.
- [ ] Circuit breaker test.
- [ ] Bulkhead test.
- [ ] Fallback test.
- [ ] Load-shedding test.
- [ ] Retry storm test.
- [ ] Native-image test if needed.

---

## 38. Latihan

### Latihan 1 — Dependency Policy Design

Untuk dependency berikut, desain:

- timeout,
- retry,
- circuit breaker,
- bulkhead,
- rate limit,
- fallback,
- idempotency,
- observability.

Dependencies:

1. Identity provider.
2. Email provider.
3. Payment provider.
4. Dashboard aggregation service.
5. External address lookup.
6. Internal case service.
7. Audit event collector.
8. Report generation service.

### Latihan 2 — Timeout Budget

Endpoint:

```text
POST /cases/{id}/approve
SLA: 2 seconds
```

Operations:

- load case,
- check authorization,
- call risk service,
- update DB,
- insert audit,
- insert notification outbox.

Buat time budget dan fault tolerance policy.

### Latihan 3 — Retry Storm Analysis

Traffic:

```text
200 requests/s
External dependency starts returning 503
Retry max = 3
Timeout per attempt = 1s
```

Jawab:

- berapa attempt/s maksimum?
- resource apa yang akan habis?
- bagaimana membatasi storm?
- policy baru apa yang lebih aman?

### Latihan 4 — Fallback Safety Review

Evaluasi fallback berikut:

1. Permission service down -> allow request.
2. Dashboard service down -> return stale dashboard.
3. Payment status API down -> assume paid.
4. Email API down -> queue email.
5. Postal lookup down -> allow manual address entry.
6. Sanctions screening down -> approve application.

Tentukan safe/unsafe dan alasannya.

---

## 39. Ringkasan Invariants

Ingat invariants berikut:

```text
Resilience is damage containment, not guaranteed success.
Timeout is the first resilience primitive.
Retry must be bounded, classified, and idempotent.
Retry storm can destroy a recovering dependency.
Circuit breaker fails fast to protect resources.
Bulkhead limits concurrency, not request rate.
Rate limit controls frequency, but local rate limit is per instance.
Fallback must preserve correctness.
Security and compliance checks fail closed.
Do not hold DB transaction while waiting for unreliable network.
Fault tolerance belongs at dependency boundary.
Annotation stacking must be tested, not assumed.
Metrics must show degraded mode, not only total failures.
Graceful degradation is a domain decision.
Virtual threads do not remove downstream scarcity.
Native image does not remove resilience requirements.
```

---

## 40. Referensi Resmi yang Relevan

Referensi yang perlu dibaca saat implementasi nyata:

- Quarkus SmallRye Fault Tolerance guide.
- SmallRye Fault Tolerance reference.
- SmallRye Fault Tolerance extra features for backoff strategies.
- SmallRye Fault Tolerance programmatic API.
- Quarkus REST Client guide.
- Quarkus OpenTelemetry and Micrometer guides.
- Quarkus reactive architecture guide.
- Quarkus virtual threads guide.
- Quarkus native image reference.

---

## 41. Kapan Seri Ini Lanjut ke Part Berikutnya

Part ini menyelesaikan fault tolerance dan resilience design di Quarkus.

Bagian berikutnya:

```text
Part 024 — Observability I: Logging, Structured Logs, Correlation, MDC, Audit Trail
```

Di part berikutnya, fokus bergeser ke observability dasar yang benar:

- structured logging,
- MDC/context propagation,
- correlation ID,
- request ID,
- audit event vs technical log,
- log redaction,
- security principal in logs,
- native-image logging behavior,
- log sampling,
- error taxonomy,
- operational log contract,
- audit defensibility.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-022.md">⬅️ HTTP Client Engineering: REST Client Reactive, Fault Tolerance, Timeout, Retry, Circuit Breaker</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-024.md">Observability I: Logging, Structured Logs, Correlation, MDC, Audit Trail ➡️</a>
</div>

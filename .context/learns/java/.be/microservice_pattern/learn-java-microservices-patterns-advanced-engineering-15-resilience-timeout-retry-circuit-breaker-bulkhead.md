# Learn Java Microservices Patterns — Advanced Engineering
## Part 15 — Resilience Pattern: Timeout, Retry, Circuit Breaker, Bulkhead

**Filename:** `learn-java-microservices-patterns-advanced-engineering-15-resilience-timeout-retry-circuit-breaker-bulkhead.md`  
**Series:** `learn-java-microservices-patterns-advanced-engineering`  
**Part:** 15 of 35  
**Target level:** Advanced / principal-engineer thinking  
**Java range:** Java 8 through Java 25  

---

## 0. What This Part Is About

This part is about designing microservices that survive real production failure.

At beginner level, resilience is often described as:

- add timeout
- add retry
- add circuit breaker
- add fallback
- add bulkhead

That is not enough.

A top-tier engineer does not ask only:

> “Which library should I use?”

They ask:

> “What resource am I protecting?”  
> “What failure am I assuming?”  
> “What is the downstream allowed to receive?”  
> “What is the user allowed to wait for?”  
> “What is safe to retry?”  
> “What should degrade?”  
> “What must fail fast?”  
> “What blast radius am I accepting?”  
> “How do I prove the policy works under overload?”

Resilience is not primarily about making every request succeed.

Resilience is about ensuring that **failure stays bounded**.

A resilient microservice can still return errors. In fact, a resilient service often returns errors intentionally, earlier, and more predictably, to protect the rest of the system.

---

## 1. Core Mental Model

### 1.1 Resilience Is Capacity Protection

A service dies when one or more finite resources are exhausted:

- request threads
- virtual threads carrier threads
- servlet worker threads
- event loop threads
- connection pool slots
- database sessions
- memory
- heap
- direct memory
- file descriptors
- queue capacity
- CPU
- downstream quota
- broker partition capacity
- external API rate limit

Therefore every resilience pattern should be interpreted as a way to protect capacity.

| Pattern | Main resource protected |
|---|---|
| Timeout | Time, thread occupancy, connection occupancy |
| Retry | Availability, but risks extra load |
| Backoff + jitter | Downstream recovery capacity |
| Circuit breaker | Downstream and caller resource pool |
| Bulkhead | Caller resource isolation |
| Rate limiter | Downstream quota and local capacity |
| Load shedding | Core service capacity |
| Fallback | User experience and graceful degradation |
| Hedging | Tail latency, but risks extra load |
| Deadline propagation | End-to-end latency budget |

The question is not “should we add these patterns?”

The question is:

> “What is the maximum amount of work we allow the system to spend on a request that is already unlikely to succeed?”

---

## 2. Why Resilience Pattern Exists

A microservice request path usually crosses multiple boundaries.

Example:

```text
Browser
  -> API Gateway
  -> Application BFF
  -> Application Service
  -> Profile Service
  -> Document Service
  -> Workflow Service
  -> Oracle/PostgreSQL
  -> Redis
  -> Kafka/RabbitMQ
  -> External Agency API
```

Every hop has independent failure modes:

- unavailable
- slow
- overloaded
- partially available
- returning malformed data
- returning stale data
- accepting request but timing out response
- applying side effect but losing response
- rate-limiting caller
- returning transient error
- returning permanent business error

Without resilience design, failures propagate.

A downstream service slows down. Caller threads wait longer. Caller thread pool fills. API Gateway queues grow. Users retry. Load increases. Autoscaler may add instances too late. Database connection pool saturates. Health checks fail. Kubernetes restarts pods. Restarting pods create cold-start pressure. Traffic shifts to remaining pods. The whole system degrades.

This is a cascading failure.

---

## 3. Important Distinction: Fault Tolerance vs Resilience vs Reliability

### Fault tolerance

The ability to continue operating despite certain faults.

Example:

- retry on transient network error
- use multiple replicas
- fallback to cache

### Resilience

The ability to absorb, contain, adapt to, and recover from failure.

Example:

- shed non-critical traffic during overload
- open circuit when dependency is failing
- isolate slow dependency in separate bulkhead
- reduce feature quality instead of taking down whole page

### Reliability

The externally visible ability to provide correct service over time.

Example:

- 99.9% successful submission within 2 seconds
- less than 0.1% payment duplicate risk
- no lost regulatory decision events

Fault tolerance mechanisms help resilience. Resilience contributes to reliability. But they are not identical.

A system can be fault-tolerant in one dimension and unreliable in another.

Example:

- retry makes transient calls succeed
- but duplicate side effects corrupt business state

That system is not reliable.

---

## 4. Failure Taxonomy

Before selecting a resilience pattern, classify the failure.

### 4.1 By duration

| Failure type | Example | Typical response |
|---|---|---|
| Momentary | dropped packet | retry with tiny backoff |
| Short transient | brief restart | retry with backoff/jitter |
| Sustained transient | dependency degraded for minutes | circuit breaker, fallback, load shedding |
| Permanent | invalid request, missing permission | no retry |
| Unknown | timeout after possible side effect | idempotency + reconciliation |

### 4.2 By semantics

| Failure type | Meaning |
|---|---|
| Technical transient | network timeout, connection reset |
| Technical permanent | DNS misconfigured, invalid TLS, wrong credential |
| Business permanent | invalid state transition, unauthorized operation |
| Capacity failure | queue full, 429, 503, pool exhausted |
| Dependency degradation | p99 latency spike, partial availability |
| Unknown outcome | caller timed out but downstream may have committed |

### 4.3 By retry safety

| Operation | Usually safe to retry? | Requirement |
|---|---:|---|
| GET read | Often yes | timeout/backoff; cache may help |
| idempotent PUT | Often yes | stable resource identity |
| DELETE | Sometimes | delete must be idempotent |
| POST command | Not by default | idempotency key/business key |
| payment-like action | Dangerous | strict idempotency and reconciliation |
| external notification | Depends | deduplication / message key |
| state transition | Depends | compare-and-set / transition id |

The top-tier rule:

> Never decide retry policy without knowing side-effect semantics.

---

## 5. Timeout Engineering

### 5.1 Timeout Is Not Optional

Every remote call must have a timeout.

Without timeout, one slow dependency can convert caller resources into parked work.

Bad mental model:

> “Timeout is just to avoid waiting too long.”

Better mental model:

> “Timeout is a resource lease.”

A caller grants a downstream dependency a limited amount of time to consume caller resources.

When the lease expires, the caller must stop waiting.

### 5.2 Types of Timeout

| Timeout | Meaning |
|---|---|
| DNS resolution timeout | Time to resolve host |
| connection timeout | Time to establish TCP/TLS connection |
| TLS handshake timeout | Time to complete secure session |
| connection acquisition timeout | Time to obtain connection from pool |
| write timeout | Time to send request bytes |
| read timeout | Time waiting for response bytes |
| response timeout | Time to receive complete response |
| request timeout | Whole remote operation budget |
| business deadline | End-to-end operation deadline |

A common production bug is setting only one timeout and assuming it covers all phases.

Example:

```text
connectionTimeout = 1s
readTimeout = 30s
connectionPoolAcquireTimeout = infinite
```

This service can still hang under pool starvation.

### 5.3 Timeout Budget

A timeout should be derived from:

1. user-facing SLA/SLO
2. upstream timeout
3. number of downstream hops
4. downstream latency distribution
5. false timeout tolerance
6. retry strategy
7. fallback availability
8. resource pool size

Example:

```text
User-visible endpoint SLO: 2 seconds
Gateway timeout: 3 seconds
BFF total budget: 1800 ms
Application service budget: 1200 ms
Profile dependency budget: 250 ms
Document dependency budget: 300 ms
Workflow dependency budget: 400 ms
Response composition buffer: 200 ms
```

You do not give each dependency 2 seconds. That multiplies latency.

### 5.4 Deadline Propagation

Timeouts should respect remaining budget.

```text
Incoming request deadline: now + 1500 ms
Service A spends: 300 ms
Remaining: 1200 ms
Service A calls Service B with max 800 ms, not default 5 seconds
Service B calls Service C with remaining-aware budget
```

Without deadline propagation, a request that is already useless to the user may continue consuming backend resources.

### 5.5 Choosing Timeout Values

A practical strategy:

1. define acceptable false timeout rate
2. examine downstream latency percentile
3. set timeout near relevant percentile with padding
4. include network variance
5. include TLS/connection warmup where relevant
6. test under load
7. monitor timeout rate separately from error rate

Example:

```text
Downstream p50: 20 ms
Downstream p95: 80 ms
Downstream p99: 180 ms
Downstream p99.9: 450 ms
Acceptable false timeout: 0.1%
Initial timeout: 500–600 ms
```

But beware: if p99.9 is very close to p50, small latency shifts can cause many false timeouts. Add padding.

### 5.6 Timeout Too Low

Failure mode:

- false timeouts increase
- caller retries unnecessarily
- retry load increases
- downstream becomes even slower
- circuit breaker may open incorrectly

### 5.7 Timeout Too High

Failure mode:

- caller threads held too long
- connection pool held too long
- queue grows
- user waits unnecessarily
- failure detection is slow
- cascading failure becomes worse

### 5.8 Timeout Placement

Timeout should exist at multiple layers:

```text
API Gateway timeout
  -> BFF endpoint timeout
  -> service application timeout
  -> remote client timeout
  -> database query timeout
  -> message handler processing timeout
```

But they must be coordinated.

Bad:

```text
Gateway timeout: 30s
Service A client timeout: 60s
Service B DB query timeout: unlimited
```

Better:

```text
Gateway timeout: 5s
BFF request budget: 4s
Service call budget: 1s
DB query timeout: 700ms
Fallback path: 200ms
```

---

## 6. Retry Engineering

### 6.1 Retry Is Load Amplification

Retry can improve availability only when failures are transient and downstream has recovery capacity.

Retry becomes dangerous when downstream is overloaded.

If every service does three retries across a five-hop call chain, worst-case amplification can explode.

```text
Service A retries Service B 3 times
Service B retries Service C 3 times
Service C retries Service D 3 times

Potential downstream attempt multiplication: 3 x 3 x 3 = 27
```

A retry policy that looks harmless locally can be destructive globally.

### 6.2 Retry Only When Safe

Do not retry:

- validation failure
- unauthorized/forbidden
- business rule rejection
- invalid state transition
- unsupported version
- duplicate command already processed, unless idempotent response is supported
- non-idempotent command without idempotency key

Usually retryable:

- connection reset before request sent
- HTTP 408 sometimes
- HTTP 429 with backoff respecting Retry-After
- HTTP 503/504 sometimes
- transient database deadlock if transaction is safe to replay
- optimistic lock conflict only if command can be re-evaluated safely

### 6.3 Retry Budget

Retry must be bounded.

A retry budget defines how much extra work retry is allowed to create.

Example policies:

```text
At most 1 retry for user-facing synchronous request
At most 3 retries for background job
At most 5 retries for async consumer with exponential backoff
At most 15 minutes total retry window for external API delivery
At most 10% additional request volume caused by retries
```

A retry budget protects the system from self-inflicted overload.

### 6.4 Retry Backoff

Bad:

```text
retry immediately after failure
```

Better:

```text
attempt 1: immediately or after 50 ms
attempt 2: after 100 ms
attempt 3: after 250 ms
attempt 4: after 500 ms
attempt 5: after 1000 ms
```

Backoff gives downstream time to recover.

### 6.5 Jitter

If many clients retry with the same schedule, they create synchronized retry waves.

Jitter randomizes retry delay.

Example:

```text
base delay: 500 ms
jittered delay: random between 250 ms and 750 ms
```

This spreads load.

### 6.6 Respect Retry-After

If downstream returns:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
```

The client should not retry in 100 ms.

Retry must respect server-side backpressure signal.

### 6.7 Retry Placement

Do not allow every layer to retry blindly.

Bad:

```text
Browser retries
Gateway retries
BFF retries
Service retries
HTTP client retries
Service mesh retries
Database driver retries
```

This can produce extreme amplification.

Better:

- one owner for retry policy per path
- retries closest to caller that understands business semantics
- infrastructure retries only for clearly safe transport failures
- service mesh retries disabled or tightly bounded for non-idempotent calls

### 6.8 Retry With Deadline

Retry must stop when request deadline is near.

Bad:

```java
for (int i = 0; i < 3; i++) {
    callWithTimeout(1000);
}
```

If caller has 1200 ms total budget, this can exceed it.

Better:

```java
while (attemptsRemaining && deadline.hasTimeLeft()) {
    Duration attemptTimeout = min(configuredAttemptTimeout, deadline.remaining());
    callWithTimeout(attemptTimeout);
}
```

---

## 7. Circuit Breaker

### 7.1 Mental Model

A circuit breaker prevents repeated calls to a dependency that is likely to fail.

It protects:

- caller resources
- downstream resources
- user latency
- system stability

It does not fix the downstream service.

It changes caller behavior.

### 7.2 States

Classic states:

| State | Meaning |
|---|---|
| Closed | Calls are allowed |
| Open | Calls fail fast without reaching downstream |
| Half-open | Limited test calls allowed |

Flow:

```text
Closed
  -> failures exceed threshold
Open
  -> wait duration passes
Half-open
  -> test calls succeed -> Closed
  -> test calls fail -> Open
```

### 7.3 What Counts As Failure?

Not every exception should open a circuit.

Count as failure:

- timeout
- connection refused
- 503
- 504
- dependency-specific transient error
- pool acquisition timeout

Usually do not count:

- 400 validation error
- 401/403 authorization failure
- 404 expected not found
- business rejection

Be careful with HTTP 429. It may indicate capacity/rate limiting and should often contribute to adaptive throttling or circuit decisions, but the exact policy depends on contract.

### 7.4 Sliding Window

Circuit breaker usually needs a window:

- count-based: last N calls
- time-based: last N seconds

Example:

```text
minimum calls: 50
failure rate threshold: 50%
slow call rate threshold: 60%
slow call threshold: 800 ms
open duration: 30s
half-open permitted calls: 5
```

Minimum calls matter. Without them, one failure can open the circuit during low traffic.

### 7.5 Slow Call Circuit Breaker

Failure is not only error.

Slow dependency can be worse than down dependency.

A slow-call threshold opens circuit when too many calls exceed latency threshold.

Example:

```text
If 70% of last 100 calls took more than 1 second, open circuit.
```

This prevents thread/connection exhaustion.

### 7.6 Circuit Breaker Granularity

Possible granularity:

- per downstream service
- per downstream endpoint
- per tenant
- per operation type
- per external agency
- per region

Too coarse:

```text
ProfileService circuit opens because /profile/photo is slow.
Now /profile/basic also fails, even though healthy.
```

Too fine:

```text
Every endpoint has separate breaker.
Operational complexity explodes.
```

A good default:

- separate breaker for critical dependencies
- separate breaker for materially different latency/availability profile
- separate breaker for external dependencies
- separate breaker for expensive operations

### 7.7 Circuit Breaker Is Not A Retry Replacement

Circuit breaker and retry interact.

Bad combination:

```text
Retry 5 times, then circuit breaker records one failure.
```

This hides load amplification.

Alternative:

```text
Circuit breaker wraps each attempt.
Retry checks circuit before each attempt.
Metrics record attempts and original requests separately.
```

But exact order depends on library and semantics.

Always test composition.

---

## 8. Bulkhead

### 8.1 Mental Model

Bulkhead isolates failure so one dependency or workload cannot consume all resources.

The name comes from ship compartments: water in one compartment should not sink the whole ship.

### 8.2 Types of Bulkhead

| Bulkhead type | Example |
|---|---|
| Thread pool bulkhead | separate executor for external API calls |
| Semaphore bulkhead | max concurrent calls to dependency |
| Connection pool bulkhead | separate DB/client pools per dependency |
| Queue bulkhead | separate bounded queues by workload |
| Pod/deployment bulkhead | separate service deployment for heavy workload |
| Tenant bulkhead | per-tenant concurrency or quota |
| Priority bulkhead | critical vs non-critical operation isolation |

### 8.3 Semaphore Bulkhead

Limits concurrent executions.

Example:

```text
Only 20 concurrent calls to Document Service.
If all 20 are used, new calls fail fast or wait briefly.
```

Pros:

- simple
- low overhead
- good for blocking and non-blocking clients

Cons:

- does not isolate threads if underlying call blocks badly
- requires careful timeout

### 8.4 Thread Pool Bulkhead

Uses separate worker pool.

Example:

```text
ExternalAgencyClientExecutor:
  core = 20
  queue = 100
  reject when full
```

Pros:

- isolates blocking work
- protects main request threads

Cons:

- extra threads
- queue can hide overload
- bad sizing can increase latency

### 8.5 Java 21+ Virtual Threads and Bulkhead

Virtual threads reduce the cost of blocking waits.

They do not remove the need for bulkheads.

Why?

Because the scarce resource may not be the thread.

It may be:

- database connections
- remote service capacity
- CPU
- memory
- socket buffers
- external API quota
- carrier thread pinning risk
- downstream concurrency limit

With virtual threads, semaphore bulkheads and connection limits become even more important.

Bad Java 21 assumption:

> “Virtual threads are cheap, so unlimited concurrency is fine.”

Correct assumption:

> “Virtual threads make waiting cheaper, but downstream capacity is still finite.”

---

## 9. Rate Limiting

### 9.1 Mental Model

Rate limiting controls request rate over time.

Bulkhead controls concurrency.

Both are needed.

| Mechanism | Controls |
|---|---|
| Rate limiter | requests per time unit |
| Bulkhead | concurrent in-flight work |
| Timeout | maximum waiting duration |
| Circuit breaker | whether calls should be attempted |

Example:

```text
External agency allows 300 requests/minute.
Set outbound rate limiter to 250/minute.
Set concurrency bulkhead to 20.
Set timeout to 2s.
Set retry only for 429/503 with backoff.
```

### 9.2 Token Bucket

Token bucket allows bursts up to bucket size while enforcing average rate.

Useful for:

- APIs with burst allowance
- user-facing traffic
- smoothing but not eliminating spikes

### 9.3 Leaky Bucket

Leaky bucket processes at fixed rate.

Useful for:

- strict downstream quota
- external API with no burst tolerance
- background worker pacing

### 9.4 Per-Tenant Rate Limit

In multi-tenant systems, global rate limit is insufficient.

Without tenant limit:

```text
Tenant A floods system.
Tenant B experiences outage.
```

Better:

```text
Global limit: 10,000 req/min
Tenant default: 500 req/min
Critical tenant: 2,000 req/min
Internal admin: separate quota
```

---

## 10. Load Shedding

### 10.1 Mental Model

Load shedding rejects work intentionally to preserve useful service.

A system under overload has two choices:

1. accept too much work and collapse
2. reject some work and remain available for critical requests

Top-tier systems choose controlled rejection.

### 10.2 Load Shedding Signals

Possible signals:

- request queue depth
- CPU saturation
- memory pressure
- GC pause
- DB pool usage
- downstream error rate
- p99 latency
- event loop lag
- consumer lag
- number of in-flight requests
- deadline already expired

### 10.3 Criticality-Based Shedding

Not all requests are equal.

Example:

| Request | Criticality |
|---|---|
| Submit application | High |
| Approve case | High |
| Load audit listing page | Medium |
| Generate dashboard widget | Low |
| Export report | Low/background |
| Refresh notification badge | Very low |

During overload:

- continue high-criticality commands
- degrade medium queries
- reject low-priority reports
- disable expensive optional features

### 10.4 Brownout

Brownout means disabling non-essential features temporarily.

Example:

```text
Normal case dashboard:
- case summary
- profile summary
- document count
- recommendation panel
- notification badge
- analytics widget

Brownout dashboard:
- case summary only
- document count if fast
- omit recommendation and analytics widget
```

Brownout is better than total outage.

---

## 11. Fallback

### 11.1 Fallback Is Not Always Good

Fallback can preserve user experience.

But fallback can also hide correctness problems.

Bad fallback:

```text
Authorization service unavailable.
Fallback: allow request.
```

Terrible.

Better:

```text
Authorization service unavailable.
Fallback: deny or use short-lived cached decision only if explicitly designed and auditable.
```

### 11.2 Types of Fallback

| Fallback type | Example |
|---|---|
| Static fallback | return default label |
| Cache fallback | return stale profile summary |
| Partial response | omit optional widget |
| Alternative dependency | secondary provider |
| Manual fallback | route to human review |
| Async fallback | accept command and process later |
| Fail-closed | deny action when security dependency fails |
| Fail-open | allow low-risk read with warning |

### 11.3 Fallback Decision Matrix

| Situation | Good fallback? |
|---|---:|
| Optional dashboard widget unavailable | Yes |
| User permission unknown | Usually no; fail closed |
| External address lookup down | Maybe accept manual input |
| Payment confirmation unknown | No silent success; pending/reconcile |
| Report generation slow | Queue background job |
| Audit logging unavailable | Depends; often block or use durable local outbox |

### 11.4 Fallback Must Be Observable

Fallback is degraded behavior.

Track:

- fallback count
- fallback rate
- fallback reason
- stale data age
- affected tenant/user/operation
- fallback success/failure

A silent fallback can become silent corruption.

---

## 12. Hedged Requests

### 12.1 Mental Model

Hedging sends a duplicate request after a delay to reduce tail latency.

Example:

```text
Send request to replica A.
If no response after p95 latency, send duplicate to replica B.
Use first successful response.
Cancel or ignore slower response.
```

### 12.2 When Hedging Helps

Useful for:

- idempotent reads
- replicated backend
- rare tail latency spikes
- high-volume systems with strict p99 target

Dangerous for:

- writes
- non-idempotent operations
- overloaded downstream
- expensive calls
- external APIs with quotas

Hedging is not a default pattern. It is an advanced latency optimization that must be constrained.

---

## 13. Pattern Composition

### 13.1 Example Composition for User-Facing GET

```text
Deadline propagation
  -> rate limit
  -> bulkhead
  -> circuit breaker
  -> timeout
  -> retry once with jitter if safe
  -> stale cache fallback
```

### 13.2 Example Composition for POST Command

```text
Idempotency key validation
  -> rate limit
  -> bulkhead
  -> no automatic retry unless safe
  -> timeout
  -> if unknown outcome: return 202 Pending or query-by-id
  -> outbox for side effect publication
```

### 13.3 Example Composition for Background Consumer

```text
Message received
  -> inbox deduplication
  -> concurrency bulkhead
  -> timeout per dependency
  -> retry with exponential backoff
  -> circuit breaker for downstream
  -> parking lot / DLQ after retry exhaustion
  -> alert if DLQ rate breaches threshold
```

### 13.4 Ordering Matters

Different libraries compose policies differently.

Conceptually:

- rate limiter should usually reject before expensive work
- bulkhead should protect local resources before calling dependency
- circuit breaker should fail fast before acquiring scarce downstream resources
- timeout should bound each attempt
- retry should respect circuit breaker and deadline
- fallback should be last and explicit

But exact order must be tested in the actual stack.

---

## 14. Java 8–25 Considerations

### 14.1 Java 8

Typical stack:

- servlet thread-per-request
- blocking HTTP clients
- fixed thread pools
- CompletableFuture available
- Resilience4j supports Java 8 style functional decorators

Risks:

- thread pool exhaustion
- blocking call amplification
- poor timeout defaults
- callback complexity if async

Recommended:

- strict thread pool bulkheads
- bounded queues
- explicit timeout per dependency
- connection pool limits
- idempotency for retryable commands

### 14.2 Java 11

Adds standardized `java.net.http.HttpClient`.

Useful for:

- HTTP/2 support
- async calls with `CompletableFuture`
- cleaner client abstraction than legacy clients

Still requires:

- request timeout
- connection management
- bulkhead
- retry policy
- deadline propagation

### 14.3 Java 17

A strong modern baseline.

Useful language/runtime features:

- records for immutable DTOs
- sealed classes for result/error modeling
- better GC/runtime behavior
- mature container ergonomics

Design improvement:

- model failure results explicitly
- avoid exception-only control flow
- use records for policy/config snapshots

### 14.4 Java 21

Virtual threads change blocking economics.

Good for:

- simpler synchronous code
- high-concurrency I/O-bound services
- reducing need for reactive style solely for scalability

Still needs:

- concurrency limit
- connection pool limit
- downstream quota limit
- timeout
- cancellation propagation
- observability

### 14.5 Java 25

Java 25 continues the modern Java line after Java 21. The resilience principles do not change. What improves is the quality of runtime, language ergonomics, and ecosystem evolution.

Design rule:

> Do not let Java version become an excuse for unlimited concurrency.

Whether using platform threads, reactive execution, or virtual threads, the same finite resources must be protected.

---

## 15. Framework and Library Positioning

### 15.1 MicroProfile Fault Tolerance

MicroProfile Fault Tolerance defines annotations/concepts for:

- Timeout
- Retry
- Fallback
- CircuitBreaker
- Bulkhead
- Asynchronous

Useful when working in Jakarta EE / MicroProfile runtimes.

Example conceptual style:

```java
@Timeout(500)
@Retry(maxRetries = 1, delay = 100)
@CircuitBreaker(requestVolumeThreshold = 50, failureRatio = 0.5)
@Bulkhead(20)
@Fallback(ProfileFallback.class)
public ProfileSummary getProfile(String profileId) {
    return remoteProfileClient.getProfile(profileId);
}
```

This is convenient, but annotation simplicity can hide policy complexity. You still need to define:

- what counts as failure
- retryable exceptions
- timeout source
- fallback correctness
- metric names
- per-operation granularity

### 15.2 Resilience4j

Resilience4j is commonly used in Spring and Java 8+ applications.

It provides modules such as:

- CircuitBreaker
- Retry
- RateLimiter
- Bulkhead
- TimeLimiter

Useful when you want composable decorators and explicit configuration.

Conceptual style:

```java
Supplier<ProfileSummary> supplier = () -> client.getProfile(profileId);

Supplier<ProfileSummary> decorated = Decorators.ofSupplier(supplier)
    .withBulkhead(profileBulkhead)
    .withCircuitBreaker(profileCircuitBreaker)
    .withRetry(profileRetry)
    .withFallback(List.of(Exception.class), ex -> ProfileSummary.unavailable(profileId))
    .decorate();

return decorated.get();
```

### 15.3 Spring Cloud CircuitBreaker

Useful when standardizing circuit breaker usage across Spring services while allowing different implementations.

But do not make the abstraction hide important semantics.

Service teams still need:

- operation-level config
- explicit fallback design
- retry ownership
- metrics
- dashboards
- tests

### 15.4 Service Mesh

Service mesh can provide:

- mTLS
- retries
- timeouts
- circuit breaking / outlier detection
- traffic shifting
- observability

But mesh-level policies may not know business semantics.

Danger:

```text
Mesh retries POST /approve three times.
Approval side effect executes twice.
```

Default stance:

- mesh retries only for clearly safe idempotent operations
- application owns business-aware retry
- mesh owns transport-level safety and routing
- all retry layers must be inventoried

---

## 16. Configuration Design

Resilience policy must be configurable but controlled.

Example config:

```yaml
resilience:
  profile-service:
    get-profile:
      timeoutMs: 500
      retry:
        maxAttempts: 2
        initialDelayMs: 50
        maxDelayMs: 200
        jitter: true
        retryableStatus: [503, 504]
      circuitBreaker:
        minimumCalls: 50
        failureRateThreshold: 50
        slowCallThresholdMs: 800
        slowCallRateThreshold: 70
        openDurationSeconds: 30
        halfOpenPermittedCalls: 5
      bulkhead:
        maxConcurrentCalls: 30
        maxWaitMs: 20
      fallback:
        mode: STALE_CACHE
        maxStalenessSeconds: 300
```

Validation rules:

- timeout must be lower than upstream deadline
- retry max attempts must fit total budget
- fallback staleness must be explicit
- bulkhead must be lower than downstream known capacity
- circuit breaker minimum calls must be meaningful for traffic level
- default retry must not apply to unsafe methods

---

## 17. Observability for Resilience

Track original requests and attempts separately.

Metrics:

```text
request.count
request.success.count
request.error.count
request.latency.p50/p95/p99
remote.attempt.count
remote.timeout.count
remote.retry.count
remote.retry.exhausted.count
circuit.state
circuit.open.count
circuit.half_open.success.count
circuit.half_open.failure.count
bulkhead.available_concurrency
bulkhead.rejected.count
rate_limiter.rejected.count
fallback.count
fallback.stale_age
load_shed.count
```

Important dashboards:

1. dependency health by operation
2. timeout rate vs latency percentile
3. retry amplification ratio
4. circuit breaker state timeline
5. bulkhead saturation
6. fallback rate
7. downstream error budget burn
8. tenant-level rejection
9. thread/connection pool occupancy
10. request deadline expiration

### Retry Amplification Ratio

```text
retry_amplification = remote_attempt_count / original_request_count
```

If original requests = 1000 and remote attempts = 2500, amplification = 2.5x.

That may be dangerous.

---

## 18. Testing Resilience

### 18.1 Unit Tests

Test policy classification:

- 400 is not retried
- 503 is retried
- timeout triggers fallback
- business exception does not open circuit
- stale cache fallback has max age

### 18.2 Integration Tests

Use fake downstream that can:

- delay response
- return 500
- return 429
- drop connection
- accept request but not return response
- return malformed payload

### 18.3 Load Tests

Validate:

- retry does not overload dependency
- bulkhead rejects under saturation
- p99 stays bounded
- thread pools do not grow without bound
- connection pool exhaustion is visible

### 18.4 Chaos Tests

Inject:

- 2-second latency to dependency
- 50% error rate
- complete dependency outage
- partial pod failure
- DNS delay
- broker slowdown
- DB lock contention

Expected behavior should be known before test.

### 18.5 Game Days

Run operational exercises:

- external agency API down
- Profile Service p99 increases 10x
- Redis unavailable
- DB pool saturated
- circuit breaker stuck open due to misconfigured threshold
- fallback cache stale
- service mesh retry unexpectedly enabled

---

## 19. Regulatory Case Management Example

Scenario:

```text
Officer opens Case Details page.
BFF calls:
- Case Service
- Profile Service
- Document Service
- Workflow Service
- Audit Service
- Recommendation Service
```

Criticality:

| Dependency | Critical? | Strategy |
|---|---:|---|
| Case Service | Yes | fail page if unavailable |
| Profile Service | Medium | stale cache fallback allowed |
| Document Service | Medium | partial response allowed |
| Workflow Service | High | fail action panel if unavailable |
| Audit Service | High for audit page, low for summary | context-specific |
| Recommendation Service | Low | omit during overload |

Resilience policy:

```text
Case Service:
  timeout 500ms
  no fallback
  circuit breaker per operation

Profile Service:
  timeout 300ms
  retry once for 503/504
  stale cache fallback up to 10 minutes

Document Service:
  timeout 500ms
  no retry for listing if expensive
  partial response with warning

Workflow Service:
  timeout 400ms
  no unsafe retry for state transition
  command endpoint requires idempotency key

Recommendation Service:
  timeout 150ms
  circuit breaker aggressive
  omit if slow
```

Important distinction:

- rendering a page may degrade
- approving a case must not silently degrade correctness

---

## 20. Common Anti-Patterns

### 20.1 No Timeout

Remote call can wait indefinitely.

### 20.2 Same Timeout Everywhere

Every dependency gets 30 seconds regardless of criticality.

### 20.3 Retry Everything

All exceptions are retried, including validation and authorization errors.

### 20.4 Retry At Every Layer

Browser, gateway, service mesh, HTTP client, application, and DB driver all retry.

### 20.5 Circuit Breaker Without Fallback Strategy

Circuit opens, but user experience and operational response are undefined.

### 20.6 Fallback That Violates Correctness

Security, approval, payment, or audit dependency fails open without explicit risk acceptance.

### 20.7 Bulkhead With Unbounded Queue

Bulkhead exists, but queue grows until memory/latency explodes.

### 20.8 Hidden Service Mesh Retry

Application team thinks no retry exists, but mesh retries traffic.

### 20.9 Metrics Only For Final Request

Retries and attempts are invisible, so amplification is hidden.

### 20.10 Resilience Config Copy-Paste

Every service uses the same thresholds, regardless of traffic and dependency behavior.

---

## 21. Design Checklist

For every remote dependency, answer:

```text
1. What operation is being called?
2. Is it read or write?
3. Is it idempotent?
4. What is the caller deadline?
5. What is the per-attempt timeout?
6. What failures are retryable?
7. How many retries are allowed?
8. Is backoff used?
9. Is jitter used?
10. Who owns retry: app, gateway, mesh, client library?
11. What circuit breaker protects this call?
12. What failure threshold opens circuit?
13. What slow-call threshold opens circuit?
14. What bulkhead protects local resources?
15. What rate limit protects downstream quota?
16. What fallback exists?
17. Is fallback correct or only convenient?
18. Is fallback visible in metrics/logs/traces?
19. What happens under overload?
20. What work is shed first?
21. What dashboard shows this dependency health?
22. What alert fires before users complain?
23. How is the policy tested?
24. What happens during deploy/rollback?
25. What is the incident runbook?
```

---

## 22. Architecture Review Questions

Use these questions in senior/principal architecture review.

### Timeout

- Are all remote calls bounded?
- Are connection acquisition and read timeouts separate?
- Is timeout derived from end-to-end deadline?
- Is timeout lower than upstream timeout?
- Are DB query timeouts configured?

### Retry

- What exactly is retried?
- What is never retried?
- Is the operation idempotent?
- Is retry budget defined?
- Are backoff and jitter used?
- Are retries observable as attempts?
- Does service mesh also retry?

### Circuit breaker

- What is breaker granularity?
- What counts as failure?
- Are slow calls counted?
- Is minimum call volume appropriate?
- What is half-open behavior?
- What operational alert exists when circuit opens?

### Bulkhead

- What resource is isolated?
- Is queue bounded?
- What happens when bulkhead is full?
- Are low-priority operations isolated from critical ones?
- Are tenant quotas isolated?

### Fallback

- Is fallback safe?
- Is stale data allowed?
- Is fallback visible to user/operator?
- Does fallback violate authorization/audit correctness?

### Load shedding

- What is rejected first?
- Can the system preserve critical workflows under overload?
- Are 429/503 responses meaningful?
- Does client respect Retry-After?

---

## 23. Production Readiness Checklist

A service is not resilience-ready until:

```text
[ ] Every outbound call has explicit timeout.
[ ] Timeout covers connection acquisition where relevant.
[ ] Retry policy is operation-specific.
[ ] Retry policy is idempotency-aware.
[ ] Backoff and jitter are enabled where retry exists.
[ ] Retry budget is defined.
[ ] Service mesh/gateway/client retry layers are inventoried.
[ ] Circuit breaker exists for critical dependencies.
[ ] Circuit breaker failure classification is correct.
[ ] Slow-call threshold is configured for slow dependency risk.
[ ] Bulkhead exists for expensive/fragile dependencies.
[ ] Queues are bounded.
[ ] Rate limits protect downstream quotas.
[ ] Load shedding behavior is explicit.
[ ] Fallback is correctness-reviewed.
[ ] Fallback is observable.
[ ] Metrics distinguish original request and remote attempt.
[ ] Dashboard shows dependency health per operation.
[ ] Alert exists for timeout spike, retry spike, circuit open, bulkhead rejection, fallback spike.
[ ] Chaos tests validate dependency outage behavior.
[ ] Load tests validate overload behavior.
[ ] Incident runbook explains what to tune or disable.
[ ] Config validation prevents unsafe policy.
```

---

## 24. Practical Exercise

Take one existing microservice endpoint.

Example:

```text
POST /applications/{id}/approve
```

Map:

```text
User-visible SLA:
Critical dependencies:
Optional dependencies:
Remote calls:
Database calls:
Message publishing:
External systems:
Idempotency key:
Timeout per call:
Retryable failures:
Non-retryable failures:
Circuit breaker granularity:
Bulkhead limit:
Fallback behavior:
Load shedding behavior:
Metrics:
Alerts:
Runbook:
```

Then answer:

1. What happens if Profile Service is slow?
2. What happens if Workflow Service times out after committing state?
3. What happens if Audit Service is down?
4. What happens if downstream returns 429?
5. What happens if officer double-clicks Approve?
6. What happens if gateway retries but service also retries?
7. What happens if circuit breaker opens for only one tenant?
8. What is the safest degraded behavior?

---

## 25. Key Takeaways

1. Resilience is capacity protection.
2. Timeout is a resource lease.
3. Retry is load amplification unless bounded.
4. Backoff without jitter can synchronize retry storms.
5. Circuit breaker protects callers and downstreams from repeated failure.
6. Bulkhead isolates resource exhaustion.
7. Rate limit controls flow over time; bulkhead controls concurrency.
8. Load shedding is controlled rejection, not failure.
9. Fallback must be correctness-reviewed.
10. Virtual threads reduce thread cost, not downstream capacity limits.
11. Resilience policies must be operation-specific.
12. The system must observe original requests and retry attempts separately.
13. A resilient system may fail fast intentionally to prevent collapse.

---

## 26. References

- Google SRE Book — Addressing Cascading Failures: https://sre.google/sre-book/addressing-cascading-failures/
- Google SRE Book — Handling Overload: https://sre.google/sre-book/handling-overload/
- AWS Builders Library — Timeouts, retries, and backoff with jitter: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
- MicroProfile Fault Tolerance 4.1: https://microprofile.io/specifications/fault-tolerance/4-1/
- MicroProfile Fault Tolerance Specification 4.1: https://download.eclipse.org/microprofile/microprofile-fault-tolerance-4.1/microprofile-fault-tolerance-spec-4.1.html
- Resilience4j documentation: https://resilience4j.readme.io/
- Resilience4j GitHub: https://github.com/resilience4j/resilience4j
- OpenJDK JDK 25 project: https://openjdk.org/projects/jdk/25/

---

# Series Progress

Current status:

```text
Completed: Part 0 through Part 15
Current part: Part 15 — Resilience Pattern: Timeout, Retry, Circuit Breaker, Bulkhead
Remaining: Part 16 through Part 34
```

Next part:

```text
Part 16 — Backpressure, Flow Control, and Capacity-Aware Design
```

Next filename:

```text
learn-java-microservices-patterns-advanced-engineering-16-backpressure-flow-control-capacity-aware-design.md
```

# learn-java-eclipse-jersey-deployment-models-part-024  
# Part 24 — Connection, Timeout, and Backpressure Engineering

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 24 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami reliability engineering untuk koneksi, timeout, retry, pool, queue, circuit breaker, bulkhead, dan overload pada aplikasi Jersey.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: connection pools, keep-alive, HTTP client pools, DB pools, timeout budgets, retry storms, circuit breakers, rate limits, bulkheads, bounded queues, load shedding, dan backpressure end-to-end.

---

## 1. Mengapa Connection, Timeout, dan Backpressure Sangat Penting?

Banyak aplikasi Jersey terlihat stabil saat traffic normal, tetapi runtuh saat salah satu dependency melambat.

Contoh:

```text
Normal:
  DB latency 50ms
  API latency p95 120ms
  threads idle
  pool sehat

Incident:
  DB latency 5s
  Tomcat threads penuh
  DB pool wait penuh
  gateway 504
  client retry
  traffic naik
  pod restart
  database makin berat
```

Masalahnya sering bukan “Jersey lambat”.

Masalahnya adalah:

```text
unbounded wait
timeout tidak konsisten
pool tidak disejajarkan
retry tidak aman
queue terlalu panjang
no load shedding
no circuit breaker
no bulkhead
backpressure hanya asumsi
```

Top-tier mental model:

> Reliability bukan hanya “service bisa menerima request”.  
> Reliability adalah kemampuan service untuk **membatasi kerusakan** ketika dependency lambat, traffic naik, atau resource habis.

---

## 2. The Failure Chain

Typical synchronous REST chain:

```text
Client
  ↓
API Gateway / Ingress / ALB
  ↓
Jersey service
  ↓
DB pool
  ↓
Database
```

or:

```text
Client
  ↓
Gateway
  ↓
Jersey service
  ↓
HTTP client pool
  ↓
Downstream service
  ↓
Its DB
```

Each layer has:

```text
connection
pool
queue
timeout
retry
circuit
thread
memory
```

If one layer lacks limit, it can absorb unlimited pain until the whole system collapses.

The goal:

```text
fail fast when necessary
degrade gracefully where possible
protect dependencies
protect own runtime
return controlled errors
recover automatically
```

---

## 3. Connection Is a Resource

Connections are not free.

Connection consumes:

```text
file descriptor
kernel memory
JVM object
TLS state
pool slot
server-side session
database backend process/thread/session
load balancer tracking
```

For DB:

```text
one app connection may equal one DB session
```

For HTTP:

```text
one connection may hold keep-alive socket
```

For HTTP/2:

```text
one connection may multiplex many streams
```

For Netty:

```text
many connections may share event loops, but still consume memory and descriptors
```

Rule:

```text
Every connection must have owner, limit, timeout, and lifecycle.
```

---

## 4. Timeout Types

Timeout is not one thing.

Common types:

```text
connect timeout:
  max time to establish TCP/TLS connection

connection acquisition timeout:
  max time to wait for a pool connection

read/socket timeout:
  max time waiting for response data

request/call timeout:
  max total time for entire operation

idle timeout:
  max time an idle connection remains open

keep-alive timeout:
  max time idle persistent HTTP connection is kept

query timeout:
  max time DB query may run

transaction timeout:
  max transaction duration

queue timeout:
  max time task waits in queue

server request timeout:
  max time request is allowed to run
```

If you only set connect timeout, you are not protected from slow response.

If you only set read timeout, you may still wait forever for pool acquisition.

---

## 5. Timeout Budget

A timeout budget is a coordinated set of timeouts across layers.

Bad:

```text
client timeout:
  10s

gateway timeout:
  60s

app downstream timeout:
  120s

DB query timeout:
  none
```

Good:

```text
client:
  15s

gateway:
  14s

app request budget:
  12s

downstream call:
  4s

DB query:
  8s

pool acquisition:
  200ms - 1s depending endpoint
```

Rule:

```text
Outer layers should not time out long before inner layers know the request is hopeless.
```

Also:

```text
Inner calls should not exceed the remaining request budget.
```

---

## 6. Deadline vs Timeout

Timeout:

```text
this operation can take at most 3s
```

Deadline:

```text
this entire request must finish by timestamp T
```

Deadline is stronger for multi-step operations.

Example:

```text
request budget:
  10s

step A:
  uses 3s

remaining:
  7s

step B timeout:
  min(configuredTimeout, remainingBudget)
```

Without deadline propagation:

```text
each downstream call gets full timeout
total request exceeds gateway/client timeout
```

Top-tier systems propagate deadlines.

In plain Jersey, you can implement request deadline context:

```text
request start time
max duration
remaining budget helper
```

Then service code uses remaining budget for DB/HTTP calls.

---

## 7. Keep-Alive

HTTP keep-alive reuses connections.

Pros:

```text
less TCP/TLS handshake overhead
lower latency
less CPU
better throughput
```

Cons:

```text
idle connections consume resources
stale connections after backend close
load balancer idle timeout mismatch
connection reuse to unhealthy backend
```

Timeouts to align:

```text
client keep-alive
proxy keep-alive
ALB idle timeout
Tomcat/Jetty keep-alive
HTTP client pool idle eviction
downstream keep-alive
```

AWS ALB default idle timeout is documented as 60 seconds.

If backend keep-alive timeout is shorter than ALB expectation, ALB may try to reuse a connection that backend already closed, producing intermittent 502-like behavior depending timing.

Rule:

```text
Align idle/keep-alive timeouts across proxy and backend.
```

---

## 8. Server-Side Connection Controls

Servlet containers expose connection controls.

Tomcat connector includes attributes such as:

```text
maxConnections
acceptCount
connectionTimeout
keepAliveTimeout
maxKeepAliveRequests
maxThreads
```

Tomcat documentation describes the HTTP Connector as listening on a TCP port and forwarding requests to the associated Engine to process requests and create responses.

Mental model:

```text
maxConnections:
  how many connections server accepts/holds

maxThreads:
  how many request processing threads

acceptCount:
  how much backlog/queue when saturated

connectionTimeout:
  how long to wait for request after connection established

keepAliveTimeout:
  idle keep-alive wait
```

Do not tune one knob alone.

---

## 9. Server-Side Thread vs Connection

Connection count and request thread count are different.

Example:

```text
1000 keep-alive connections
50 active requests
200 max threads
```

This can be fine.

But:

```text
1000 slow clients
large request bodies
request buffering disabled
```

may stress server differently.

Connection controls protect sockets/descriptors.

Thread controls protect request execution.

Both matter.

---

## 10. DB Pool Engineering

DB pool settings commonly include:

```text
maximumPoolSize
minimumIdle
connectionTimeout
idleTimeout
maxLifetime
validationTimeout
leakDetectionThreshold
```

For HikariCP style pools:

```text
connectionTimeout:
  how long caller waits for connection from pool
```

If too long:

```text
request threads wait too long
gateway may timeout
queue grows
```

If too short:

```text
transient spike may fail too aggressively
```

Choose based on request budget.

Example:

```text
API p95 target:
  500ms

DB pool acquisition timeout:
  100ms - 250ms

Long reporting endpoint:
  separate pool or async job
```

Do not let ordinary REST endpoint wait 30s for DB connection.

---

## 11. DB Pool Size Formula

Important:

```text
total DB connections = pool_per_pod * max_pods
```

If:

```text
pool_per_pod = 30
max_pods = 10
```

then:

```text
max app DB connections = 300
```

If DB safe budget is 150, this is dangerous.

Better:

```text
pool_per_pod = floor(DB_budget / max_pods)
```

Then reserve connections for:

- admin,
- migration,
- background jobs,
- other services,
- monitoring.

Do not size DB pool per pod in isolation.

---

## 12. DB Pool Is a Bulkhead

DB pool is not only performance optimization.

It is a bulkhead:

```text
limits how many concurrent DB operations this service can send
```

If pool too large:

```text
service can overwhelm DB
```

If pool too small:

```text
service underutilizes DB
```

Optimal pool is usually much smaller than thread count.

Database often performs better with controlled concurrency.

Rule:

```text
DB pool size should protect the database as much as serve the application.
```

---

## 13. HTTP Client Pool Engineering

HTTP client pools should define:

```text
max total connections
max connections per route/host
connection acquisition timeout
connect timeout
response/read timeout
call timeout
idle eviction
TLS config
retry policy
```

Without connection pool limits:

```text
outbound calls can explode
```

Without acquisition timeout:

```text
request can wait too long for outbound connection
```

Without call timeout:

```text
request can hang indefinitely
```

For Java HTTP clients:

- JDK `HttpClient`,
- Apache HttpClient,
- OkHttp,
- Jersey Client,

each has different config style.

But the concepts are the same.

---

## 14. Connection Pool Per Dependency

Do not use one generic pool for every downstream.

Bad:

```text
one HTTP client pool shared across all dependencies
max total = 50
```

If dependency A slows down, it can consume all 50 connections and starve dependency B.

Better:

```text
separate clients/pools/bulkheads per dependency
```

Example:

```text
identity-service:
  max 20

payment-service:
  max 10

document-service:
  max 5

notification-service:
  max 5
```

This is dependency isolation.

---

## 15. Bulkhead Pattern

Bulkhead isolates failures.

Like ship compartments:

```text
if one compartment floods,
ship does not sink
```

Software bulkheads:

```text
separate thread pool
separate connection pool
separate semaphore limit
separate queue
separate rate limit
```

Example:

```text
search endpoint expensive:
  max 10 concurrent

case update endpoint critical:
  separate pool
  not affected by search
```

Bulkhead is one of the most important patterns for production Jersey.

---

## 16. Semaphore Bulkhead

Semaphore bulkhead limits concurrent calls without creating extra threads.

Concept:

```java
Semaphore semaphore = new Semaphore(20);

if (!semaphore.tryAcquire()) {
    return Response.status(503).build();
}

try {
    return doWork();
} finally {
    semaphore.release();
}
```

Use for:

- limiting endpoint concurrency,
- protecting downstream,
- controlling expensive operation.

Pros:

```text
simple
low overhead
works with caller thread
```

Cons:

```text
caller still does work if acquired
no queue unless you add one
```

Often better than queueing.

---

## 17. Thread Pool Bulkhead

Separate executor per dependency/use case.

Example:

```text
paymentExecutor:
  20 threads, queue 100

reportExecutor:
  5 threads, queue 20

notificationExecutor:
  10 threads, queue 100
```

Pros:

- isolates blocking work,
- separates queue,
- different sizing per dependency.

Cons:

- more threads,
- more operational complexity,
- context propagation,
- shutdown complexity.

Use only where needed.

---

## 18. Bounded Queue

Unbounded queue is hidden outage.

Bad:

```java
new LinkedBlockingQueue<>()
```

Good:

```java
new ArrayBlockingQueue<>(1000)
```

But better depends on use case.

For latency-sensitive API, queue should often be small.

Why?

If queue is huge:

```text
request waits in queue
client/gateway times out
work still executes later
wastes resources
```

Backpressure prefers early rejection.

---

## 19. Queue Timeout

Instead of waiting forever:

```java
boolean accepted = queue.offer(task, 100, TimeUnit.MILLISECONDS);
```

If not accepted:

```text
return 503
```

Queue wait consumes request budget.

Rule:

```text
Queue wait must be part of request deadline.
```

If request budget is 2s, do not wait 5s in queue.

---

## 20. Circuit Breaker

Circuit breaker prevents repeated calls to a failing dependency.

States:

```text
closed:
  calls allowed

open:
  calls fail fast

half-open:
  limited test calls allowed
```

Trips based on:

- failure rate,
- slow call rate,
- timeout rate,
- minimum call count,
- sliding window.

Resilience4j describes itself as a lightweight fault tolerance library and provides decorators such as Circuit Breaker, Rate Limiter, Retry, and Bulkhead.

Circuit breaker protects:

```text
dependency
caller threads
latency budget
user experience
```

It does not fix the dependency.

It prevents cascading failure.

---

## 21. Circuit Breaker Failure Definition

Define failure carefully.

Count as failure:

```text
connection refused
timeout
5xx from dependency
unexpected exception
```

Maybe not count:

```text
404 business not found
400 validation error
409 expected conflict
```

Slow calls may count separately.

Example:

```text
if more than 50% calls fail over 100 calls:
  open circuit

if more than 50% calls exceed 2s:
  open circuit
```

Choose based on dependency semantics.

---

## 22. Half-Open Behavior

When circuit is open, after wait duration:

```text
allow small number of trial calls
```

If success:

```text
close circuit
```

If failure:

```text
open again
```

Important:

```text
half-open max calls should be small
```

Otherwise thundering herd returns when dependency recovers.

---

## 23. Retry

Retry can help transient failures.

Retry can also destroy systems.

Safe for:

```text
idempotent GET
temporary connection reset
rate-limited dependency with Retry-After
brief network hiccup
```

Dangerous for:

```text
non-idempotent POST
long timeout failures
overloaded dependency
database deadlock without idempotency
payment/submission side effects
```

Rule:

```text
Retry only when operation is safe or idempotency is enforced.
```

---

## 24. Retry Storm

Retry storm:

```text
dependency slows
calls timeout
clients retry
gateway retries
service retries
traffic multiplies
dependency gets worse
```

Example:

```text
original traffic:
  100 rps

client retries 2 times:
  up to 300 rps

service retries downstream 2 times:
  up to 900 downstream attempts
```

Retries must have:

- max attempts,
- exponential backoff,
- jitter,
- deadline awareness,
- idempotency,
- circuit breaker coordination.

---

## 25. Backoff and Jitter

Bad retry:

```text
retry immediately
```

Better:

```text
exponential backoff
jitter
```

Example:

```text
attempt 1 after 100ms ± jitter
attempt 2 after 250ms ± jitter
attempt 3 after 500ms ± jitter
```

Jitter prevents synchronized retries.

Do not retry after request deadline.

---

## 26. Retry and Circuit Breaker Ordering

Ordering matters.

Common:

```text
Retry inside circuit breaker?
Circuit breaker outside retry?
```

If circuit breaker counts each retry attempt, it may open faster.

If it counts final operation result, behavior differs.

Design explicitly.

For many systems:

```text
time limiter/deadline
bulkhead
circuit breaker
retry with small attempts for safe errors
```

But exact composition depends on library and semantics.

Test it.

---

## 27. Rate Limiting

Rate limiting controls request rate.

Types:

```text
global
per client
per user
per tenant
per API key
per endpoint
per dependency
```

Layer choices:

```text
gateway
service
downstream client wrapper
domain operation
```

HTTP response:

```text
429 Too Many Requests
Retry-After: seconds
```

Rate limit protects from:

- abuse,
- sudden spikes,
- expensive operation overload,
- tenant unfairness.

---

## 28. Token Bucket Mental Model

Token bucket:

```text
tokens added at fixed rate
request consumes token
if no token, reject or wait
```

Allows bursts up to bucket capacity.

Example:

```text
rate:
  100 requests/sec

burst:
  200
```

Good for API gateway.

For app internals, semaphore bulkhead may be more relevant than rate limit.

---

## 29. Load Shedding

Load shedding means intentionally rejecting work to preserve system health.

Examples:

```text
if request queue full -> 503
if DB pool wait too high -> 503
if CPU too high and latency high -> 503
if dependency circuit open -> fallback/503
if non-critical endpoint under pressure -> reject first
```

Load shedding is not failure.

It is controlled survival.

Bad systems try to serve everything until they serve nothing.

---

## 30. Priority and Degradation

Not all endpoints are equal.

Example:

```text
critical:
  login
  case view
  approval submit

non-critical:
  reports
  export
  analytics
  suggestions
```

Under overload:

```text
reject/degrade non-critical first
```

Patterns:

- separate bulkheads,
- separate deployments,
- priority queues with caution,
- feature flags,
- degraded response,
- cached fallback.

---

## 31. Fallback

Fallback can be useful:

```text
return cached data
return partial response
disable optional section
queue async notification
show "try later" for non-critical action
```

Fallback can be dangerous:

```text
return stale authorization decision
fake successful payment
hide data integrity failure
```

Rule:

```text
Fallback must be domain-safe.
```

For regulatory/financial workflows, many failures should be explicit, not silently hidden.

---

## 32. Idempotency for Writes

For unsafe writes, use idempotency key.

Example:

```http
POST /cases/{id}/submit
Idempotency-Key: 2d39...
```

Store:

```text
idempotency key
user/tenant
operation
request hash
status
result
expiration
```

If duplicate request:

```text
same key + same request -> same result
same key + different request -> 409
```

This makes retries safer.

---

## 33. Deadline-Aware Jersey Filter

Conceptual filter:

```java
@Provider
public class DeadlineFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext context) {
        long startedNanos = System.nanoTime();
        long budgetMillis = 10_000;

        RequestDeadline deadline = new RequestDeadline(startedNanos, budgetMillis);
        context.setProperty("request.deadline", deadline);
    }
}
```

Helper:

```java
public final class RequestDeadline {
    private final long startedNanos;
    private final long budgetNanos;

    public Duration remaining() {
        long elapsed = System.nanoTime() - startedNanos;
        long remaining = budgetNanos - elapsed;
        return Duration.ofNanos(Math.max(0, remaining));
    }

    public boolean expired() {
        return remaining().isZero();
    }
}
```

Use remaining budget for outbound calls.

---

## 34. Timeout Response Mapping

If dependency timeout occurs, choose response carefully.

Examples:

```text
DB query timeout:
  503 if system dependency unavailable
  504 if gateway-like upstream timeout semantics
  500 if unexpected internal timeout but avoid vague if possible

Downstream service timeout:
  504 Gateway Timeout if service acts as gateway/proxy
  503 Service Unavailable if dependency temporarily unavailable
```

Consistency matters more than perfect theory.

Return structured error:

```json
{
  "code": "DEPENDENCY_TIMEOUT",
  "message": "A required dependency did not respond in time.",
  "requestId": "..."
}
```

Do not leak internal hostnames or stack traces.

---

## 35. Connection Leak Detection

Connection leaks cause pool exhaustion.

Symptoms:

```text
DB pool active reaches max
idle zero
threads waiting for connection
no corresponding DB activity
```

Causes:

```text
Connection not closed
ResultSet/Statement not closed
transaction not completed
exception path skipped close
```

Use try-with-resources:

```java
try (Connection c = dataSource.getConnection();
     PreparedStatement ps = c.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {
    ...
}
```

For JPA/container-managed entity manager, understand lifecycle.

Pool leak detection can help but may have overhead/noise.

---

## 36. HTTP Connection Leak

HTTP response body must be consumed/closed depending client.

Bad pattern:

```java
Response response = client.target(url).request().get();
// not closed
```

For Jersey Client:

```java
try (Response response = target.request().get()) {
    String body = response.readEntity(String.class);
}
```

If response not closed, connection may not return to pool.

Pool exhaustion follows.

---

## 37. Keep-Alive Stale Connection

A stale connection is closed by server/proxy but still believed open by client pool.

Symptoms:

```text
first request after idle fails
connection reset
broken pipe
intermittent 502/IOException
```

Mitigation:

```text
idle eviction shorter than upstream idle timeout
validate connections if supported
retry safe idempotent call once
align keep-alive
```

If ALB idle timeout is 60s, backend/client idle handling should be aligned.

---

## 38. Head-of-Line Blocking

HTTP/1.1 connection can process limited concurrent requests per connection unless pipelining/multiplexing not used.

If pool per route too small:

```text
requests wait for available connection
```

HTTP/2 multiplexing changes this, but backend/gateway may downgrade to HTTP/1.1.

Do not assume HTTP/2 end-to-end.

Measure pool wait.

---

## 39. Slow Client and Server Protection

Slow clients can consume resources.

Reverse proxy buffering often protects app:

```text
proxy reads slow client
backend receives buffered request quickly
```

But if app directly exposed, server needs:

- read timeout,
- request header timeout,
- body read timeout,
- max header size,
- max body size,
- connection limits.

For Jersey behind proxy, configure both proxy and app/server sufficiently.

---

## 40. Large Uploads

Large upload risks:

```text
memory pressure
temp disk pressure
proxy buffering disk usage
request thread held long
timeout mismatch
partial upload cleanup
virus scanning delay
```

Design:

```text
size limit
streaming policy
temp dir with quota
async processing
object storage direct upload if possible
separate endpoint/pool
```

Do not let ordinary API worker pool be consumed by large uploads.

---

## 41. Long Downloads

Large download risks:

```text
connection held long
thread held depending server/model
proxy timeout
client disconnect
slow client
memory if response buffered
```

Use:

- streaming response,
- proxy buffering policy,
- sendfile/static/object storage redirect,
- signed URLs,
- range requests if needed,
- timeout and cancellation handling.

For large files, offload to object storage/CDN where possible.

---

## 42. Backpressure in Servlet Model

Servlet thread pool saturation gives crude backpressure:

```text
new requests wait or are rejected upstream
```

But if queues are large, clients wait until timeout.

Better:

```text
bounded queues
short connection acquisition timeout
readiness degrade
gateway rate limit
application overload 503
```

Servlet model needs explicit overload policy.

---

## 43. Backpressure in Netty Model

Netty has lower-level channel writability/backpressure mechanisms.

But Jersey-on-Netty app can still overload if:

```text
resource work offloaded to unbounded executor
request bodies aggregated without limit
downstream calls unbounded
```

Netty network backpressure is not application backpressure.

You still need:

- bulkheads,
- bounded executors,
- rate limits,
- request body limits,
- timeouts,
- circuit breakers.

---

## 44. Kubernetes Backpressure

Kubernetes tools:

```text
readinessProbe:
  remove pod from service

HPA:
  add pods if metric high

resource limits:
  enforce CPU/memory

Ingress/gateway:
  rate limit / queue / reject

PDB:
  preserve availability during disruption
```

But Kubernetes does not know DB pool saturation unless you expose it.

If readiness always says true, Kubernetes keeps sending traffic to overloaded pods.

Advanced readiness can consider:

```text
critical executor queue full
DB pool wait extreme
circuit breaker open for critical dependency
shutdown state
```

Be careful to avoid flapping.

---

## 45. Observability Signals

Collect:

```text
request latency p50/p95/p99
status codes
dependency latency
timeout count
retry count
circuit breaker state
bulkhead available permits
bulkhead rejections
executor queue depth
executor rejection count
DB pool active/idle/pending
HTTP client pool leased/available/pending
connection reset count
gateway 502/503/504
Kubernetes restarts/OOMKilled
CPU throttling
```

Without these, incidents become speculation.

---

## 46. Alerting

Alert on symptoms and causes.

Symptoms:

```text
5xx rate high
p99 latency high
availability low
gateway 504 high
```

Causes:

```text
DB pool pending high
executor queue high
circuit breaker open
retry count high
thread pool saturated
OOMKilled
CPU throttling
```

Avoid alerting on every transient small spike.

Alert on sustained user-impacting conditions and leading indicators.

---

## 47. Testing Failure, Not Just Success

Test scenarios:

```text
DB slow
DB unavailable
downstream HTTP slow
downstream returns 500
downstream hangs
connection pool exhausted
executor queue full
large request body
slow client
client disconnect
gateway timeout
pod shutdown during request
rolling update under load
retry storm simulation
```

Tools:

- Toxiproxy,
- WireMock,
- mock servers,
- database proxy,
- chaos experiments,
- load testing tools.

A service is not production-ready until failure behavior is tested.

---

## 48. Example Endpoint Protection

Suppose:

```text
POST /cases/{id}/approve
```

Protection:

```text
request budget:
  8s

DB pool acquisition:
  200ms

DB query/update:
  3s

external notification:
  async after commit or outbox

idempotency:
  case state transition protected

bulkhead:
  max 50 concurrent approvals per pod

retry:
  no retry on state-changing DB update
  retry notification async with outbox

circuit breaker:
  external notification does not block approval

overload:
  503 when approval bulkhead full
```

This is production design.

---

## 49. Example Downstream HTTP Protection

For dependency:

```text
document-service
```

Set:

```text
max connections:
  20 per pod

connect timeout:
  500ms

read/call timeout:
  2s

bulkhead:
  20 concurrent

retry:
  1 retry only for idempotent GET
  backoff 100-300ms with jitter

circuit breaker:
  opens on high failure/slow-call rate

fallback:
  document preview unavailable, core case still loads
```

This prevents optional dependency from taking down core API.

---

## 50. Production Configuration Template

Conceptual config:

```yaml
server:
  requestTimeout: 12s
  maxRequestBody: 1MiB

database:
  pool:
    maxSize: 20
    connectionTimeout: 250ms
    validationTimeout: 1s
  queryTimeout: 5s

downstreams:
  documentService:
    maxConnections: 20
    connectTimeout: 500ms
    callTimeout: 2s
    retry:
      maxAttempts: 2
      backoff: 100ms
      jitter: true
    circuitBreaker:
      failureRateThreshold: 50
      slowCallThreshold: 2s
      minimumCalls: 50
    bulkhead:
      maxConcurrent: 20

overload:
  maxInFlightApprovals: 50
  queueTimeout: 100ms
```

The exact library syntax differs, but the model matters.

---

## 51. Common Failure Modes

### 51.1 Gateway 504 but App Keeps Running

Cause:

```text
gateway timeout shorter than app/downstream timeout
```

Fix:

```text
app deadline shorter than gateway timeout
cancel/stop work after deadline
```

### 51.2 DB Pool Exhausted

Cause:

```text
pool too small, leak, slow query, too many replicas, long transaction
```

Fix:

```text
leak detection
query optimization
pool sizing by total replicas
shorter transactions
bulkheads
```

### 51.3 Retry Storm

Cause:

```text
client/gateway/service all retry
```

Fix:

```text
bounded retries
jitter
circuit breaker
idempotency
Retry-After
```

### 51.4 Circuit Breaker Opens Too Often

Cause:

```text
threshold too sensitive
business errors counted as failures
minimum calls too low
timeouts too short
```

Fix:

```text
adjust failure classification
increase minimum sample
separate dependencies
```

### 51.5 Queue Latency Explosion

Cause:

```text
unbounded/large queue
workers saturated
```

Fix:

```text
smaller bounded queue
load shedding
more capacity if dependency supports it
```

---

## 52. Anti-Patterns

### Anti-Pattern 1 — Infinite Timeout

No production call should wait forever.

### Anti-Pattern 2 — Huge Thread Pool + Tiny DB Pool

Creates waiting and memory pressure.

### Anti-Pattern 3 — Retry Everything

Retries can multiply failure.

### Anti-Pattern 4 — One Pool for All Downstreams

One bad dependency starves all.

### Anti-Pattern 5 — Unbounded Queue

Turns overload into delayed failure.

### Anti-Pattern 6 — Circuit Breaker Without Metrics

You need to know when/why it opens.

### Anti-Pattern 7 — Readiness Always Green

Kubernetes keeps routing to overloaded pod.

### Anti-Pattern 8 — Body Size Limit Only in App

Proxy may accept huge body and buffer disk/memory.

### Anti-Pattern 9 — Fallback That Lies

Do not hide critical failure with fake success.

### Anti-Pattern 10 — Timeout Longer Than Client/Gateway

Work continues after client is gone.

---

## 53. Decision Matrix

| Concern | Primary Control |
|---|---|
| Too many DB calls | DB pool / semaphore bulkhead |
| Slow DB | query timeout / circuit breaker / readiness |
| Too many downstream HTTP calls | HTTP client pool / bulkhead |
| Downstream outage | timeout / circuit breaker / fallback |
| Traffic spike | gateway rate limit / HPA / load shedding |
| Request queue growth | bounded queue / rejection |
| Retry storm | retry budget / jitter / circuit breaker |
| Non-idempotent retry risk | idempotency key |
| Long operations | async job pattern |
| Large uploads | body limit / streaming / separate endpoint |
| Gateway timeout | app deadline shorter than gateway |
| Pod overload | readiness degradation / 503 |
| Resource exhaustion | requests/limits + pool sizing |

---

## 54. Top-Tier Engineering Perspective

A basic engineer says:

```text
Set timeout to 30 seconds.
```

A senior engineer asks:

```text
Which timeout?
```

A top-tier engineer defines:

```text
- end-to-end request budget
- per-hop timeout budget
- connection acquisition timeout
- pool limits per dependency
- retry classification and budget
- circuit breaker thresholds
- bulkhead boundaries
- bounded queues and rejection behavior
- idempotency for writes
- overload response semantics
- readiness degradation policy
- metrics and alerting
- failure test scenarios
```

Reliability comes from coordinated limits, not one magic timeout.

---

## 55. Production Readiness Checklist

```text
[ ] End-to-end timeout budget defined.
[ ] Gateway/proxy timeout aligned with app deadline.
[ ] Server keep-alive/idle timeout aligned with proxy/LB.
[ ] DB pool max size sized by max replicas.
[ ] DB pool acquisition timeout configured.
[ ] DB query timeout configured.
[ ] DB leak detection strategy exists.
[ ] HTTP client max connections configured per dependency.
[ ] HTTP connect/read/call timeout configured.
[ ] HTTP response bodies closed properly.
[ ] Retry policy limited and jittered.
[ ] No retry on unsafe writes without idempotency.
[ ] Circuit breaker configured for critical dependencies.
[ ] Bulkheads defined for expensive/downstream operations.
[ ] Executor queues bounded.
[ ] Rejection maps to controlled 503/429.
[ ] Request body limits set at proxy and app.
[ ] Large upload/download strategy defined.
[ ] Readiness reflects severe critical saturation if appropriate.
[ ] Metrics for pool/queue/retry/circuit exposed.
[ ] Alerting covers symptoms and leading indicators.
[ ] Failure scenarios load-tested.
[ ] Rollout/shutdown with in-flight requests tested.
```

---

## 56. Summary

Connection, timeout, and backpressure engineering is the reliability core of Jersey deployment.

Threading decides where work runs.

This part decides:

```text
how much work is allowed
how long work may wait
which dependencies are protected
how overload is rejected
how failures are contained
```

Core rules:

```text
Every pool must be bounded.
Every blocking call needs timeout.
Every retry needs budget and idempotency.
Every dependency needs isolation.
Every queue needs capacity and rejection policy.
Every gateway/app/downstream timeout must align.
Every overload should fail controlled, not collapse uncontrolled.
```

Top-tier conclusion:

> Backpressure is not a library.  
> Backpressure is an end-to-end contract across gateway, server, executor, pool, dependency, and client.

---

## 57. How This Part Connects to the Next Part

This part covered runtime reliability limits.

Next:

```text
Part 25 — Deployment-Time Configuration Architecture
```

We will focus on:

- how to design configuration for Jersey deployments,
- environment variables vs files vs server config,
- secrets,
- config precedence,
- validation,
- typed config,
- reload vs restart,
- profile anti-patterns,
- Docker/Kubernetes/Open Liberty/Payara differences,
- and how bad configuration architecture causes production incidents.

---

## References

- Apache Tomcat 10.1 HTTP Connector Configuration Reference: https://tomcat.apache.org/tomcat-10.1-doc/config/http.html
- Kubernetes documentation — Resource Management for Pods and Containers: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
- Resilience4j documentation — Getting Started: https://resilience4j.readme.io/docs/getting-started
- Resilience4j GitHub repository: https://github.com/resilience4j/resilience4j
- AWS Application Load Balancer attributes: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
- AWS Load Balancer idle timeout configuration: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-023.md">⬅️ Part 23 — Threading Model Across Deployment Modes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-025.md">Part 25 — Deployment-Time Configuration Architecture ➡️</a>
</div>

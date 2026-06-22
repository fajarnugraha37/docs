# learn-java-eclipse-jersey-deployment-models-part-029  
# Part 29 — Performance Engineering for Deployment Models

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 29 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami performance engineering Jersey lintas deployment model secara benar, terukur, dan production-relevant.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: startup time, warmup, throughput, latency, p99, allocation rate, JSON serialization, thread/pool tuning, GC, JFR, JMH, load testing, Docker/Kubernetes limits, dan perbandingan WAR/embedded/Netty/Liberty/Payara.

---

## 1. Performance Engineering Bukan “Mana yang Paling Cepat?”

Pertanyaan yang salah:

```text
Apakah Tomcat lebih cepat dari Jetty?
Apakah Netty selalu lebih cepat?
Apakah fat jar lebih cepat dari WAR?
Apakah virtual thread pasti lebih cepat?
Apakah Grizzly lebih ringan?
```

Pertanyaan yang benar:

```text
Untuk workload apa?
Dengan latency SLO apa?
Dengan concurrency berapa?
Dengan dependency apa?
Dengan payload sebesar apa?
Dengan CPU/memory limit berapa?
Dengan GC apa?
Dengan startup constraint apa?
Dengan deployment model apa?
Dengan observability apa?
```

Performance engineering bukan mencari angka tertinggi di benchmark sintetis.

Performance engineering adalah:

```text
mendesain, mengukur, menjelaskan, dan mengontrol behavior sistem terhadap target yang eksplisit.
```

Top-tier mental model:

> Performance is not speed.  
> Performance is the relationship between workload, resources, latency, throughput, and correctness under constraints.

---

## 2. Performance Metrics yang Penting

### Throughput

```text
requests per second
jobs per second
messages per second
```

### Latency

```text
time from request received to response sent
```

Need percentiles:

```text
p50
p90
p95
p99
p99.9
max
```

### Startup Time

```text
process start -> port open
process start -> app ready
process start -> warmed enough
```

### Resource Usage

```text
CPU
memory
heap
non-heap
direct memory
threads
file descriptors
network
DB connections
```

### Efficiency

```text
RPS per CPU
latency per CPU
memory per replica
startup time per image size
```

### Stability

```text
does p99 remain stable over time?
does memory grow?
does GC degrade?
does throughput collapse under slow dependency?
```

---

## 3. Average Latency Is Not Enough

Example:

```text
average latency:
  100ms

p99 latency:
  5s
```

Users experiencing p99 see slow app.

Average hides:

- queueing,
- GC pauses,
- DB pool waits,
- retry delays,
- cold paths,
- lock contention,
- noisy neighbor effects,
- CPU throttling.

Use percentiles.

Also separate:

```text
successful latency
error latency
timeout latency
per endpoint latency
per dependency latency
```

One slow report endpoint should not hide fast CRUD endpoints.

---

## 4. Performance Targets

Define targets before tuning.

Example:

```text
Endpoint:
  GET /cases/{id}

Target:
  p95 < 150ms
  p99 < 500ms
  error rate < 0.1%

Traffic:
  200 rps steady
  500 rps burst 2 minutes

Resource:
  2 replicas
  1 CPU each
  1Gi memory each

Dependency:
  DB p95 < 50ms
```

Without target, tuning is endless.

Performance target must include:

```text
traffic shape
latency SLO
error budget
resource budget
payload size
dependency assumptions
```

---

## 5. Workload Model

Workload must reflect reality.

Dimensions:

```text
endpoint mix
read/write ratio
payload sizes
auth overhead
cache hit rate
DB query complexity
downstream calls
concurrency
think time
burst pattern
request distribution
tenant distribution
large object distribution
```

Bad benchmark:

```text
100% GET /hello
```

for service where real traffic is:

```text
70% GET case detail
20% search
5% upload
5% approval write
```

Benchmark must represent production.

---

## 6. Deployment Model Performance Differences

| Model | Performance Strength | Performance Risk |
|---|---|---|
| Tomcat WAR | mature servlet tuning, stable ops | thread exhaustion, WAR/server config |
| Jetty WAR/embedded | flexible, efficient, modern threading | tuning complexity |
| Grizzly embedded | lightweight Jersey-friendly | less common ops ecosystem |
| JDK HTTP Server | minimal | limited production features |
| Netty | high connection scalability/event-driven | event-loop blocking risk |
| Payara/GlassFish | managed Jakarta EE services | heavier startup/runtime footprint |
| Open Liberty | feature-based, cloud-friendly | feature/config tuning |
| Docker | reproducible runtime | cgroup memory/CPU issues |
| Kubernetes | scaling/rollout | probes/resources/autoscaling complexity |

No model is universally fastest.

Deployment model changes bottlenecks.

---

## 7. Startup Performance

Startup phases:

```text
JVM start
class loading
server bootstrap
dependency initialization
Jersey resource scanning
provider discovery
CDI/HK2 initialization
JSON provider initialization
JPA/metamodel initialization
config validation
health readiness
JIT warmup after first traffic
```

Managed servers may add:

```text
domain/server config
feature loading
WAR deployment
JNDI resource setup
CDI container boot
JPA persistence unit boot
```

Embedded apps may start faster, but only if:

```text
classpath small
scanning limited
dependency initialization controlled
```

---

## 8. Startup Time vs Readiness Time

Two different metrics:

```text
process startup time:
  process begins until HTTP server listens

readiness time:
  process begins until app can safely receive traffic
```

Kubernetes should care about readiness.

Example:

```text
server port listens after 5s
JPA/CDI app ready after 20s
cache warmed after 60s
```

If readiness returns true after port open, traffic may hit cold/unready app.

Measure:

```text
container start timestamp
server started timestamp
Jersey initialized timestamp
readiness true timestamp
first successful request timestamp
```

---

## 9. Cold Start vs Warm Performance

Java uses JIT compilation.

Cold performance:

```text
first requests
class loading
interpreter/tiered compilation
cache miss
connection pool cold
TLS warmup
```

Warm performance:

```text
hot methods compiled
pools established
classes loaded
cache warmed
```

Benchmark both:

```text
cold startup latency
warm steady-state p99
post-deploy warmup behavior
```

If autoscaling frequently creates new pods, cold performance matters.

---

## 10. Warmup Strategy

Warmup can include:

```text
preload important classes
initialize JSON mappers
initialize DB pool
run synthetic safe queries
call internal warmup endpoints
prime caches if safe
JIT warmup through controlled traffic
```

But warmup can be dangerous:

```text
expensive startup
dependency load spike
cache stale data
fake production traffic
side effects
```

Warmup must be safe and idempotent.

Do not perform business writes in warmup.

---

## 11. Jersey Resource Scanning Cost

Jersey can discover resources/providers via package scanning.

Scanning large classpaths can increase startup.

Options:

```java
new ResourceConfig()
    .packages("com.example.api");
```

or explicit registration:

```java
new ResourceConfig()
    .register(CaseResource.class)
    .register(GlobalExceptionMapper.class)
    .register(JsonProvider.class);
```

Explicit registration can improve predictability.

Trade-off:

```text
package scanning:
  easier development

explicit registration:
  faster/more controlled startup
```

For large apps, consider explicit or narrowed scanning.

---

## 12. JSON Serialization Performance

JSON is often a major cost.

Factors:

```text
payload size
object graph size
reflection/introspection
date/time formatting
null handling
polymorphism
pretty printing
streaming vs materializing
DTO design
Jackson/JSON-B/MOXy config
```

Performance tips:

```text
use DTOs not entities
avoid huge nested object graphs
paginate
avoid pretty printing in production
reuse ObjectMapper/Jsonb instance if app-owned
avoid unnecessary conversion layers
stream large responses if needed
```

Measure allocation rate during JSON serialization.

---

## 13. DTO vs Entity Performance

Returning JPA entities directly can cause:

```text
lazy loading storms
N+1 queries
huge object graphs
serialization cycles
security exposure
unstable JSON contract
```

DTO mapping cost exists, but it is often worth it.

Performance optimization:

```text
query only needed fields
projection queries
DTO records/classes
batch fetching
pagination
avoid lazy serialization
```

Do not optimize away DTOs prematurely.

---

## 14. Allocation Rate

High allocation rate causes GC pressure.

Sources:

```text
JSON serialization
DTO mapping
String concatenation
regex
boxing
large collections
logging construction
temporary byte arrays
request body buffering
exception-heavy control flow
```

Measure with:

```text
JFR allocation events
async-profiler allocation profiling
GC logs
JVM metrics
```

Optimize hot paths only after measurement.

---

## 15. Exceptions and Performance

Exceptions are expensive when thrown frequently.

Bad:

```java
try {
    parseSomething();
} catch (Exception e) {
    // normal control flow
}
```

Expected validation errors should not rely on heavy exception flow deep in hot paths if avoidable.

But do not over-optimize rare error cases.

Use metrics:

```text
exceptions per second
exception type frequency
```

Frequent exception stack traces also flood logs.

---

## 16. Logging Overhead

Logging can hurt performance.

Risks:

```text
synchronous appenders
huge log volume
string construction before level check
logging full request/response bodies
stack traces for expected errors
slow log sink
disk I/O
JSON encoding overhead
```

Use:

```java
if (logger.isDebugEnabled()) {
    logger.debug("Expensive debug {}", expensive());
}
```

or lazy logging API where available.

In containers, stdout logging can block if collector/runtime is stressed.

Monitor log volume.

---

## 17. Thread Pool Tuning

From Part 23:

```text
threads do not create capacity by themselves
```

Thread tuning depends on:

```text
CPU
blocking ratio
latency
DB pool
HTTP client pool
endpoint mix
Kubernetes CPU limit
```

Too few threads:

```text
underutilization
queueing
```

Too many threads:

```text
memory pressure
context switching
downstream overload
```

Use load tests to find knee point.

---

## 18. DB Pool Tuning

DB pool affects throughput and latency.

Too small:

```text
connection wait time high
```

Too large:

```text
DB overloaded
query latency worsens
lock contention
more memory/session overhead
```

Tune by:

```text
DB capacity
query latency
transaction duration
replica count
endpoint mix
```

Measure:

```text
active connections
pending threads
acquisition time
query duration
DB CPU/wait events
```

Pool tuning without query tuning is incomplete.

---

## 19. HTTP Client Pool Tuning

Outbound dependency performance depends on:

```text
connection reuse
pool size
per-host limit
timeouts
TLS handshake
DNS
retry
HTTP version
payload size
```

Measure:

```text
connect time
TLS handshake time
time to first byte
response read time
connection pool wait
status codes
timeout types
```

If downstream is slow, increasing outbound pool can damage downstream.

Use bulkhead/circuit breaker.

---

## 20. Keep-Alive Performance

Keep-alive reduces connection setup overhead.

Benefits:

```text
fewer TCP handshakes
fewer TLS handshakes
lower CPU
lower latency
```

Risks:

```text
stale connections
idle resource usage
load imbalance
LB idle timeout mismatch
```

Tune:

```text
client idle eviction < upstream idle timeout
server keep-alive aligned with LB
max keep-alive requests if needed
```

Test under idle-then-burst traffic.

---

## 21. Compression Performance

Compression reduces bytes but costs CPU.

Good for:

```text
large text JSON responses
slow networks
external clients
```

Bad for:

```text
small payloads
already compressed files
CPU-constrained pods
high-throughput internal services
sensitive compression side-channel contexts
```

Often best at edge proxy/CDN.

Measure:

```text
CPU increase
response size reduction
latency impact
```

---

## 22. Request Body Handling

Large request bodies affect:

```text
memory
temp disk
proxy buffering
server threads
multipart parsing
GC
latency
```

Use:

```text
body size limit
streaming for large files
object storage direct upload
separate upload service/pool
temp dir quota
```

Do not let large upload path share same thread/pool limits as critical small APIs unless planned.

---

## 23. Pagination and Query Limits

Performance and security.

Always limit:

```text
page size
sort fields
filter complexity
date range
export size
```

Bad:

```text
GET /cases?pageSize=1000000
```

Good:

```text
max page size 100/500 depending use case
cursor pagination for large datasets
async export job for big reports
```

Pagination is performance architecture.

---

## 24. Caching

Cache can improve performance but adds correctness risk.

Cache types:

```text
local in-memory
distributed cache
HTTP cache
CDN
DB query cache
JPA second-level cache
```

Use for:

```text
reference data
static metadata
expensive read-only results
token/JWKS keys
external lookup data
```

Risks:

```text
stale data
multi-tenant leak
cache stampede
unbounded memory
invalidation bugs
```

Always define:

```text
TTL
max size
key design
tenant/security scope
invalidation
fallback behavior
metrics
```

---

## 25. Cache Stampede

Many requests miss cache simultaneously and all call dependency.

Mitigation:

```text
single-flight/in-flight dedup
early refresh
stale-while-revalidate
request coalescing
jittered TTL
bulkhead
```

Example:

```text
OneMap postal code lookup:
  exact-key cache
  in-flight dedup
  rate-limited worker pool
```

Cache is not just `Map`.

It is concurrency design.

---

## 26. GC Engineering

GC affects latency and throughput.

For Java 21/25:

```text
G1 default commonly suitable
ZGC useful for low-latency/high heap
Generational ZGC available in modern JDKs
```

Do not choose GC by trend.

Choose by:

```text
heap size
latency SLO
allocation rate
CPU budget
throughput target
pause tolerance
```

Measure:

```text
GC pause duration
GC frequency
allocation rate
heap after GC
CPU usage
p99 correlation
```

---

## 27. Container Memory and GC

Container memory includes more than heap:

```text
heap
metaspace
thread stacks
direct buffers
code cache
native memory
GC structures
```

If heap too high:

```text
OOMKilled despite no Java heap OOM
```

Use:

```text
-XX:MaxRAMPercentage=60-75 depending workload
```

But measure.

For Netty/direct buffers, leave more headroom.

For many platform threads, leave stack headroom.

---

## 28. CPU Limits and Performance

Kubernetes CPU limits can throttle.

Symptoms:

```text
p99 latency spikes
GC slower
throughput unstable
CPU throttling metrics high
```

Performance tests must run with same CPU limit/request as production.

Do not benchmark on laptop unlimited CPU then deploy to:

```text
cpu limit: 500m
```

Thread/GC behavior changes.

---

## 29. Benchmark Levels

### Microbenchmark

Measures small code unit.

Example:

```text
JSON mapping method
DTO conversion
validation logic
```

Use JMH.

### Component Benchmark

Measures one component.

Example:

```text
Jersey resource with mocked DB
serialization path
filter chain
```

### Load Test

Measures running service.

Example:

```text
HTTP requests through server/container
```

### End-to-End Test

Measures full chain.

```text
gateway -> app -> DB/downstream
```

All are useful.

Do not replace load testing with microbenchmarks.

---

## 30. JMH

OpenJDK describes JMH as a Java harness for building, running, and analyzing nano/micro/milli/macro benchmarks targeting the JVM.

Use JMH for:

```text
DTO mapper
JSON serialization config
validation helper
URI builder
small algorithmic paths
```

JMH handles many JVM benchmarking pitfalls such as warmup and compiler behavior better than ad-hoc loops.

Bad:

```java
long start = System.nanoTime();
for (...) method();
System.out.println(System.nanoTime() - start);
```

For JVM microbenchmarking, use JMH.

---

## 31. Microbenchmark Pitfalls

Even JMH can mislead if benchmark does not represent real app context.

Pitfalls:

```text
dead-code elimination
constant folding
unrealistic branch profile
missing allocation pressure
missing cache effects
missing concurrent interference
unrealistic data shape
wrong warmup
measuring framework overhead not target
```

A 2026 paper on misleading JVM microbenchmarks notes that even following JMH guidelines cannot overcome context issues when microbenchmarks create unrealistic profiles compared to real application execution.

Rule:

```text
Use microbenchmarks to compare small choices,
then verify in service-level load test.
```

---

## 32. Load Testing

Load test should include:

```text
real endpoint mix
auth behavior
payload sizes
DB/downstream
warmup period
steady state period
burst period
failure period
cooldown period
```

Metrics during test:

```text
RPS
latency percentiles
error rate
CPU/memory
GC
threads
DB pool
dependency latency
Kubernetes throttling/restarts
```

Do not report only tool-side latency.

Correlate with server metrics.

---

## 33. Coordinated Omission

Some load generators can hide latency when system stalls.

If generator waits for response before sending next request, slow server reduces request rate and may underreport true queueing behavior.

Use tools/settings that account for coordinated omission where needed.

Understand:

```text
open model:
  requests arrive at configured rate regardless of previous completion

closed model:
  fixed users wait for response then send next
```

Both model different realities.

Choose intentionally.

---

## 34. Warmup in Load Test

Include warmup period:

```text
JIT warmup
connection pool warmup
cache warmup
class loading
```

Do not include warmup in steady-state metrics unless measuring cold performance.

Report separately:

```text
cold start p99
warm steady p99
post-deploy first minute p99
```

---

## 35. Performance Test Environment

Environment should match production:

```text
same Java version
same image
same CPU/memory limits
same server config
same DB class
same network path if possible
same proxy/gateway
same TLS/compression if relevant
same observability overhead
```

If not identical, document differences.

Performance conclusions are only valid for tested conditions.

---

## 36. Profiling

Use profiling when metrics show bottleneck.

Tools:

```text
JFR
async-profiler
Java Mission Control
JDK tools
server metrics
DB profiler
tracing
```

Oracle documentation describes JFR as a tool for collecting diagnostic and profiling data about a running Java application, integrated into the JVM and designed with very low overhead in typical settings.

Use profiling to answer:

```text
where CPU is spent
where allocation happens
which locks contend
which methods block
which I/O waits dominate
```

Do not optimize by guess.

---

## 37. JFR for Jersey

Useful JFR events:

```text
CPU execution samples
allocation in new TLAB/outside TLAB
GC pauses
thread park
socket read/write
file I/O
monitor blocked
exceptions
class loading
method profiling
```

In incident/performance test:

```bash
jcmd 1 JFR.start name=perf settings=profile duration=120s filename=/tmp/perf.jfr
```

Then analyze in JMC.

Protect JFR files because they can contain sensitive info.

---

## 38. Performance by Deployment Mode: Tomcat

Tune:

```text
maxThreads
acceptCount
maxConnections
keepAliveTimeout
connectionTimeout
compression
access log overhead
```

Watch:

```text
currentThreadsBusy
DB pool pending
p99 latency
GC
connector errors
```

Common bottleneck:

```text
threads blocked on DB/downstream
```

Do not solve by only increasing `maxThreads`.

---

## 39. Performance by Deployment Mode: Jetty

Tune:

```text
QueuedThreadPool min/max
selector threads
HTTP configuration
connection idle timeout
virtual thread executor if used
```

Watch:

```text
busy threads
queue size
request latency
connector stats
GC
```

Jetty can be very efficient, but thread pool and handler design still matter.

Virtual threads may improve blocking workloads if downstream limits are controlled.

---

## 40. Performance by Deployment Mode: Grizzly

Tune:

```text
worker threads
selector threads
HTTP server config
Jersey resource scanning
JSON provider
```

Watch:

```text
worker saturation
request latency
allocation
JVM metrics
```

Embedded Grizzly performance is often good for Jersey-native apps, but ops visibility must be added.

---

## 41. Performance by Deployment Mode: JDK HTTP Server

Tune:

```text
explicit executor
queue
timeouts
minimal filters
```

Watch:

```text
executor active/queue/rejections
latency
JVM metrics
```

JDK HTTP server is not a full production app-server feature set.

Performance can be acceptable for limited/simple internal services, but you must own more infrastructure.

---

## 42. Performance by Deployment Mode: Netty

Tune:

```text
event loop group size
offload executor
direct memory
ByteBuf allocator
HTTP decoder/aggregator limits
keep-alive
backpressure
```

Watch:

```text
event loop lag
direct memory
offload queue
channel errors
latency
GC
```

Netty excels at high connection/concurrency I/O, but blocking destroys it.

Do not run DB blocking work on event loop.

---

## 43. Performance by Deployment Mode: Payara/GlassFish

Tune:

```text
HTTP thread pools
JDBC pools
JVM options
CDI/JPA startup
server logging
deployment scanning
resource config
```

Watch:

```text
server-managed JDBC pool
HTTP thread pool
transaction duration
JPA query latency
server logs
GC/JVM
```

Full Jakarta EE features add value but also startup/runtime overhead.

Only enable/use what you need and tune server-managed resources.

---

## 44. Performance by Deployment Mode: Open Liberty

Tune:

```text
enabled features
server.xml
JVM options
HTTP endpoint
threading if configured
datasource
MicroProfile metrics/health
```

Watch:

```text
startup time
feature load impact
HTTP metrics
JVM metrics
datasource metrics
Kubernetes readiness
```

Open Liberty feature selection can reduce runtime surface.

Avoid enabling full platform if Web Profile or individual features are enough.

---

## 45. Docker/Kubernetes Performance

Tune:

```text
CPU request/limit
memory request/limit
MaxRAMPercentage
thread pools
DB pool per max replicas
image startup
probe timings
HPA metrics
topology spread
```

Watch:

```text
CPU throttling
OOMKilled
pod restarts
readiness flapping
GC under memory limit
node pressure
network latency
```

Performance in Kubernetes is a resource contract problem.

---

## 46. Performance and Autoscaling

HPA based on CPU may not scale when bottleneck is:

```text
DB pool pending
downstream latency
thread queue
external rate limit
```

CPU low but latency high can happen.

Consider custom metrics:

```text
request latency
in-flight requests
queue depth
DB pool pending
RPS per pod
```

But autoscaling cannot fix a saturated database or hard external rate limit.

Scaling app can worsen downstream bottleneck.

---

## 47. Performance and Readiness

Under severe saturation, readiness can remove pod from traffic.

But if all pods become not ready:

```text
service outage
```

Use readiness for:

```text
startup
shutdown
critical unrecoverable local state
severe local overload if designed
```

Do not make readiness flap on minor transient latency.

Load shedding with 503 may be better than readiness flapping for some overload.

---

## 48. Performance and Security

Security controls cost CPU/latency:

```text
TLS
JWT verification
mTLS
input validation
audit logging
encryption
WAF
rate limit
CORS preflight
```

Do not disable security to gain performance.

Optimize:

```text
JWKS cache
connection reuse
hardware acceleration
efficient algorithms
bounded audit logging
edge TLS termination if policy allows
```

Measure realistic security-enabled performance.

---

## 49. Performance and Observability Overhead

Observability has overhead:

```text
structured logging
tracing spans
metrics labels
JFR
access logs
debug logs
body logging
```

Good observability is worth overhead, but:

```text
avoid high-cardinality labels
sample traces
do not log bodies
avoid synchronous slow appenders
```

Benchmark with production-like observability enabled.

---

## 50. Common Performance Failure Modes

### 50.1 Fast Locally, Slow in Kubernetes

Causes:

```text
CPU limit
memory limit/GC
network path
proxy
DB latency
cold image startup
different Java version
observability overhead
```

### 50.2 High Throughput, Bad p99

Causes:

```text
queueing
GC pauses
lock contention
DB pool wait
retry
CPU throttling
large payload outliers
```

### 50.3 Low CPU, High Latency

Causes:

```text
waiting on DB/downstream
thread pool queue
connection pool wait
event loop blocked
rate limit
lock contention
```

### 50.4 More Threads Makes It Worse

Causes:

```text
context switching
DB overload
memory pressure
queue amplification
```

### 50.5 Benchmark Result Does Not Match Production

Causes:

```text
wrong workload
missing proxy/auth/TLS
mocked DB too fast
no warmup
no failure scenario
different resource limits
```

---

## 51. Performance Engineering Process

Repeatable process:

```text
1. Define SLO and workload.
2. Establish baseline.
3. Identify bottleneck with metrics/profiling.
4. Change one variable.
5. Test under same conditions.
6. Compare p95/p99, error rate, resource usage.
7. Validate failure behavior.
8. Document decision.
```

Do not tune multiple variables at once unless doing designed experiment.

---

## 52. Performance Decision Records

Document:

```text
why Tomcat maxThreads=150
why DB pool=20
why MaxRAMPercentage=65
why G1/ZGC
why endpoint X is async job
why body size limit=5MB
why HPA metric is CPU or queue depth
```

Future engineers should know reasoning.

Performance settings without rationale become superstition.

---

## 53. Production Performance Checklist

```text
[ ] SLO defined per critical endpoint.
[ ] Workload model documented.
[ ] Baseline load test exists.
[ ] Cold start and warm performance measured.
[ ] Startup/readiness time measured.
[ ] p95/p99 tracked.
[ ] Endpoint route templates used in metrics.
[ ] DB pool active/pending measured.
[ ] HTTP client pool measured.
[ ] Thread pool/executor metrics measured.
[ ] GC metrics/log strategy defined.
[ ] JFR/profiling procedure exists.
[ ] Kubernetes CPU/memory limits match tests.
[ ] CPU throttling monitored.
[ ] OOMKilled monitored.
[ ] JSON serialization path profiled if hot.
[ ] Large payload strategy defined.
[ ] Cache TTL/max size/metrics defined.
[ ] Load test includes proxy/auth/TLS if relevant.
[ ] Failure-mode performance tested.
[ ] Autoscaling does not exceed downstream capacity.
[ ] Performance decisions documented.
```

---

## 54. Anti-Patterns

### Anti-Pattern 1 — Benchmarking `/hello`

Then claiming production API performance.

### Anti-Pattern 2 — Reporting Average Latency Only

Hides p99 pain.

### Anti-Pattern 3 — Optimizing Before Measuring

Usually wrong bottleneck.

### Anti-Pattern 4 — Increasing Threads Blindly

Can worsen latency.

### Anti-Pattern 5 — Ignoring Container CPU Limits

Laptop results become irrelevant.

### Anti-Pattern 6 — No Warmup

JVM results misleading.

### Anti-Pattern 7 — Microbenchmark as Final Proof

Need service-level validation.

### Anti-Pattern 8 — Disabling Observability/Security in Benchmark

Production differs.

### Anti-Pattern 9 — No Dependency Bottleneck Testing

Service collapses under real downstream slowness.

### Anti-Pattern 10 — Caching Without Correctness Model

Fast but wrong is failure.

---

## 55. Top-Tier Engineering Perspective

A basic engineer says:

```text
Netty is faster.
```

A senior engineer asks:

```text
What is the p99 under our workload?
```

A top-tier engineer defines:

```text
- workload model
- SLO
- resource budget
- deployment model bottlenecks
- cold/warm behavior
- dependency assumptions
- p99 and saturation signals
- profiling evidence
- benchmark methodology
- failure-mode performance
- production validation
```

Performance engineering is evidence-driven architecture.

---

## 56. Summary

Performance differs across Jersey deployment models, but not in simplistic ways.

The true performance depends on:

```text
workload
threading model
dependency latency
pool sizing
JSON serialization
GC/allocation
container CPU/memory
proxy/gateway behavior
startup/warmup
observability/security overhead
```

Use:

```text
JMH for small code paths
load tests for services
JFR/profilers for bottlenecks
Kubernetes metrics for cgroup reality
p95/p99 for user impact
```

Top-tier conclusion:

> Performance is not what the framework can do in isolation.  
> Performance is what the deployed system can sustain under realistic workload and constraints.

---

## 57. How This Part Connects to the Next Part

This part covered performance engineering.

Next:

```text
Part 30 — Migration Playbook: Jersey 2 → 3 → 4
```

We will cover:

- `javax.*` to `jakarta.*`,
- Java version changes,
- Jersey BOM changes,
- Servlet/Jakarta EE server compatibility,
- provider migration,
- dependency audit,
- deployment descriptor migration,
- testing strategy,
- rolling migration,
- and how to avoid mixing incompatible generations.

---

## References

- OpenJDK Code Tools — JMH: https://openjdk.org/projects/code-tools/jmh/
- OpenJDK JMH repository: https://github.com/openjdk/jmh
- Oracle documentation — About Java Flight Recorder: https://docs.oracle.com/javacomponents/jmc-5-4/jfr-runtime-guide/about.htm
- Kubernetes documentation — Resource Management for Pods and Containers: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
- Apache Tomcat 10.1 HTTP Connector Configuration Reference: https://tomcat.apache.org/tomcat-10.1-doc/config/http.html
- Eclipse Jetty 12.1 Threading Architecture: https://jetty.org/docs/jetty/12.1/programming-guide/arch/threads.html
- Open Liberty documentation — Performance tuning: https://openliberty.io/docs/latest/performance-tuning.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-028.md">⬅️ Part 28 — Failure Modes: Startup, Runtime, Redeploy, Shutdown</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-030.md">Part 30 — Migration Playbook: Jersey 2 → 3 → 4 ➡️</a>
</div>

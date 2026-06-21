# learn-linux-kernel-mastery-for-java-engineers-part-031.md

# Part 031 — Performance Engineering: Methodology, Benchmarking, Load Testing, and Capacity Planning

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `031`  
> Topik: Performance engineering methodology, benchmarking, load testing, latency percentiles, throughput, saturation, queueing, coordinated omission, Java/JVM benchmarking, Linux/container effects, Kubernetes capacity planning, regression testing, SLO-driven tuning, dan production performance governance  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada Part 030, kita membuat playbook incident production:

- CPU high
- CPU throttling
- OOMKilled
- native memory
- FD leak
- network timeout
- DNS latency
- disk latency
- container startup failure
- node pressure
- postmortem

Part 031 berpindah dari mode reaktif ke mode preventif:

> bagaimana merancang, mengukur, menguji, dan merencanakan performa sebelum menjadi incident.

Performance engineering bukan sekadar “membuat lebih cepat”.

Performance engineering adalah disiplin untuk menjawab:

```text
Seberapa cepat harusnya sistem?
Pada beban berapa?
Dengan resource berapa?
Dengan latency tail berapa?
Apa bottleneck-nya?
Apa kapasitas aman?
Apa trade-off-nya?
Apakah perubahan ini regression?
Kapan kita harus scale?
```

Untuk Java engineer yang bekerja di Linux/Kubernetes, performance engineering harus menggabungkan:

- application behavior
- JVM/GC behavior
- Linux scheduler/memory/network/storage behavior
- cgroup/container limits
- Kubernetes scheduling/autoscaling
- downstream dependencies
- queueing theory
- measurement correctness
- observability

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan:
   - benchmark
   - load test
   - stress test
   - soak test
   - spike test
   - capacity test
   - regression test
2. Memahami metrik performa:
   - latency
   - throughput
   - concurrency
   - utilization
   - saturation
   - error rate
   - queue length
   - resource cost
3. Membaca percentiles:
   - p50
   - p90
   - p95
   - p99
   - p999
   - max
4. Memahami kenapa average latency sering menipu.
5. Memahami coordinated omission.
6. Mendesain load test yang realistis.
7. Menghindari benchmark Java yang salah:
   - no warmup
   - dead code elimination
   - unrealistic payload
   - no GC accounting
   - no container limits
   - measuring localhost only
8. Menggunakan metodologi:
   - define SLO
   - baseline
   - hypothesize
   - measure
   - change one variable
   - compare
   - validate in production
9. Menghubungkan load test dengan Linux evidence:
   - CPU usage
   - CPU throttling
   - memory pressure
   - GC
   - network retransmission
   - disk latency
   - cgroup pressure
10. Melakukan capacity planning:
    - per-pod throughput
    - headroom
    - autoscaling
    - dependency capacity
    - node capacity
    - failure scenarios
11. Mendesain performance regression gate di CI/CD.
12. Menjelaskan trade-off:
    - latency vs throughput
    - CPU vs memory
    - batching vs tail latency
    - caching vs freshness/memory
    - compression vs CPU/network
    - sync durability vs latency
    - limits vs noisy neighbor
13. Membuat performance report yang actionable.

---

## 2. Performance Engineering Mental Model

Performance engineering selalu dimulai dari pertanyaan bisnis/operasional:

```text
Apa yang harus dilayani?
Dalam batas latency berapa?
Pada traffic berapa?
Dengan error budget berapa?
Dengan cost/resource berapa?
```

Bukan:

```text
Bagaimana membuat fungsi ini 10% lebih cepat?
```

Kecuali 10% itu relevan terhadap SLO/cost/capacity.

Model:

```text
Goal
  -> workload model
  -> metrics
  -> baseline
  -> bottleneck analysis
  -> experiment
  -> validation
  -> capacity model
  -> production guardrails
```

---

## 3. SLO, SLI, SLA

### 3.1 SLI

Service Level Indicator = metrik yang mengukur service.

Contoh:

```text
HTTP request latency p99
HTTP success rate
availability
freshness
queue delay
```

### 3.2 SLO

Service Level Objective = target internal.

Contoh:

```text
99% request GET /checkout/quote < 250ms over 30 days
success rate >= 99.9%
```

### 3.3 SLA

Service Level Agreement = kontrak eksternal, biasanya dengan konsekuensi.

Performance engineering harus mengoptimasi untuk SLO, bukan untuk microbenchmark yang tidak berdampak.

---

## 4. Latency, Throughput, Concurrency

### 4.1 Latency

Waktu menyelesaikan satu operasi.

Contoh:

```text
request latency = response_time - request_start
```

### 4.2 Throughput

Jumlah operasi per satuan waktu.

```text
requests per second
messages per second
transactions per second
bytes per second
```

### 4.3 Concurrency

Jumlah operasi in-flight pada saat yang sama.

Hubungan Little's Law:

```text
concurrency = throughput × latency
```

Jika throughput 1000 req/s dan latency rata-rata 100ms:

```text
concurrency ≈ 1000 × 0.1 = 100 in-flight requests
```

Ini sangat penting untuk thread pool, connection pool, queue, dan memory sizing.

---

## 5. Percentiles

Average latency bisa menipu.

Example:

```text
99 requests = 10ms
1 request = 5000ms
average ≈ 59.9ms
```

Average terlihat “oke”, tapi 1% user sangat buruk.

Percentiles:

| Percentile | Meaning |
|---|---|
| p50 | median, 50% requests faster |
| p90 | 90% faster |
| p95 | 95% faster |
| p99 | 99% faster |
| p999 | 99.9% faster |

Tail latency matters because users experience individual requests, not averages.

---

## 6. Tail Latency Amplification

Jika satu user action memanggil 20 dependencies sequential/parallel, tail latency menumpuk.

Jika setiap dependency punya p99 buruk, end-to-end p99 bisa jauh lebih buruk.

Parallel fanout example:

```text
request calls 10 services in parallel
response waits for all
```

Even if each service has 1% slow chance, chance at least one slow:

```text
1 - 0.99^10 ≈ 9.56%
```

So p99 of components can become p90-ish issue at aggregate level.

Design implication:

- reduce fanout
- set deadlines
- hedge carefully
- cache
- degrade gracefully
- avoid waiting for all non-critical work
- monitor per-dependency tail

---

## 7. Throughput vs Latency

At low load:

```text
latency low and stable
```

As load increases:

```text
resource utilization rises
queueing begins
latency increases
tail grows first
```

At saturation:

```text
throughput plateaus
latency explodes
errors/timeouts rise
```

Classic curve:

```text
load ->
latency:
  flat -> rising -> cliff
```

Do not plan capacity at the cliff.

Operate with headroom.

---

## 8. Utilization vs Saturation

Utilization:

```text
how busy resource is
```

Saturation:

```text
how much demand waits because resource is busy
```

Examples:

| Resource | Utilization | Saturation |
|---|---|---|
| CPU | CPU usage | run queue / CPU pressure / throttling |
| Memory | memory.current | reclaim pressure / OOM / swap |
| Disk | throughput/util | queue depth / await / io.pressure |
| Network | bandwidth | retrans/drop/queue |
| Thread pool | active threads | queue length / rejected |
| DB pool | used connections | waiters / acquire latency |
| Event loop | CPU/time busy | event loop lag |

Saturation is often a better early warning than utilization.

---

## 9. Queueing Theory in 5 Minutes

If arrivals exceed service capacity:

```text
queue grows without bound
```

Even before that, as utilization approaches 100%, queueing delay grows non-linearly.

For a simplified M/M/1 queue:

```text
response time grows roughly as 1 / (1 - utilization)
```

At:

```text
50% utilization -> moderate wait
80% utilization -> much higher wait
90% utilization -> bad
99% utilization -> catastrophic
```

Real systems are more complex, but lesson stands:

```text
Do not run latency-sensitive services near saturation.
```

---

## 10. Coordinated Omission

Coordinated omission is a measurement bug.

It happens when load generator waits for response before sending next request, so it stops measuring the period while system is overloaded.

Example:

```text
client sends request
server pauses 10s
client waits
no new requests sent during pause
```

Measured latency may underreport real user experience.

Correct load generators maintain intended arrival rate and record delays.

Tools like wrk2 were designed to address this for constant-rate HTTP benchmarking.

Always ask:

```text
Does this tool measure coordinated omission correctly?
```

---

## 11. Types of Performance Tests

### 11.1 Microbenchmark

Measures small code path.

Example:

- JSON parser method
- UUID generator
- cache lookup
- compression function

Use JMH for Java.

### 11.2 Component benchmark

Measures one component/service locally.

Example:

- service endpoint with mocked dependencies
- repository layer with test DB
- serializer pipeline

### 11.3 Load test

Measures service under expected realistic load.

### 11.4 Stress test

Push beyond capacity to find breaking point.

### 11.5 Soak test

Run realistic load for long duration to find leaks/degradation.

### 11.6 Spike test

Sudden load bursts.

### 11.7 Capacity test

Find capacity envelope under defined SLO.

### 11.8 Regression test

Compare current build with baseline.

---

## 12. Java Microbenchmarking with JMH

Do not write naive Java microbenchmark like:

```java
long start = System.nanoTime();
for (...) {
    method();
}
System.out.println(System.nanoTime() - start);
```

Problems:

- JIT warmup
- dead code elimination
- constant folding
- escape analysis
- GC effects
- CPU frequency
- branch prediction
- unrealistic data
- benchmark code differs from production

Use JMH.

JMH handles:

- warmup iterations
- measurement iterations
- forks
- blackholes
- modes
- profilers
- state setup
- JVM isolation

---

## 13. JMH Basic Example

```java
import org.openjdk.jmh.annotations.*;
import org.openjdk.jmh.infra.Blackhole;

import java.util.concurrent.TimeUnit;

@BenchmarkMode(Mode.Throughput)
@OutputTimeUnit(TimeUnit.SECONDS)
@State(Scope.Thread)
public class JsonLikeBenchmark {

    private String input;

    @Setup
    public void setup() {
        input = "{\"id\":123,\"name\":\"fajar\"}";
    }

    @Benchmark
    public void parseSomething(Blackhole bh) {
        // replace with real parsing
        bh.consume(input.indexOf("name"));
    }
}
```

Run with JMH plugin/build.

Important:

- benchmark representative input
- use Blackhole
- use forks
- inspect allocation
- profile if surprising

---

## 14. Microbenchmark Pitfalls

1. Benchmarking code not used in production.
2. Inputs too small/simple.
3. Ignoring allocation rate.
4. No warmup.
5. One JVM run only.
6. Benchmark on laptop, assume production.
7. Ignoring CPU governor/frequency.
8. Comparing across noisy environments.
9. No confidence intervals.
10. Optimizing method that is not on hot path.

Microbenchmark is useful only after you know a path matters.

Use profiler first.

---

## 15. Load Test Workload Model

A load test must define:

```text
who are users?
what operations?
what request mix?
what payload size?
what data distribution?
what think time?
what arrival rate?
what auth/session behavior?
what dependency behavior?
what cache state?
what error expectation?
```

Bad load test:

```text
1000 users call GET /health repeatedly
```

Good load test:

```text
40% search
30% product detail
20% checkout quote
10% purchase
payload distribution based on production
authenticated sessions
realistic dependency latency
constant arrival rate
cache warm/cold scenarios
```

---

## 16. Open Model vs Closed Model Load

### 16.1 Closed model

Fixed number of clients/users. Each sends next request after response.

```text
concurrency fixed
throughput depends on response time
```

Common but can hide coordinated omission.

### 16.2 Open model

Requests arrive at target rate independent of responses.

```text
arrival rate fixed
concurrency grows if latency increases
```

Better for modeling real user/request arrival.

Use open model for capacity/SLO tests when possible.

---

## 17. Warmup

Java systems need warmup:

- class loading
- JIT compilation
- profile-guided optimization
- connection pool warmup
- cache warmup
- TLS session cache
- DB plan cache
- page cache
- branch predictor
- autoscaling stabilization

Benchmark before warmup may measure startup/warmup, not steady-state.

But startup performance can be a separate target.

Define:

```text
cold start test
warm steady-state test
```

Do not mix.

---

## 18. Cold vs Warm Cache

Cache state changes results massively.

Examples:

- JVM JIT warm
- application cache warm
- DB buffer cache warm
- Linux page cache warm
- DNS cache warm
- connection pool warm
- TLS session warm

Test scenarios:

1. Cold start/cold cache.
2. Warm steady-state.
3. Cache eviction/rolling restart.
4. Node scale-up with cold image/page cache.
5. Dependency cache miss storm.

Document cache state in results.

---

## 19. Test Environment Fidelity

Performance results depend on environment:

- CPU model
- number of cores
- CPU limits
- memory limits
- kernel version
- JDK version
- GC
- container runtime
- network path
- storage type
- node pressure
- dependency instance size
- database data volume
- TLS on/off
- logging on/off
- observability agents on/off

Production-like tests are expensive but necessary for capacity claims.

A laptop benchmark is useful for development, not capacity planning.

---

## 20. Measure the Whole Stack

During load test, collect:

### Application

- latency p50/p95/p99/p999
- throughput
- error rate
- concurrency
- queue wait
- dependency latency
- connection pool wait
- retry count
- log volume

### JVM

- heap usage
- GC pauses
- allocation rate
- threads
- direct memory
- safepoints
- JFR/profile

### Container/Linux

- CPU usage
- CPU throttling
- CPU pressure
- memory.current
- memory.pressure
- OOM events
- FD count
- pids
- network retrans
- disk I/O latency
- io.pressure

### Kubernetes

- pod restarts
- HPA behavior
- node pressure
- scheduling
- image pull
- probe failures

### Dependencies

- DB CPU/IO/locks
- cache hit ratio
- queue lag
- downstream p99
- connection count

---

## 21. Performance Test Success Criteria

Define before running.

Example:

```text
At 1500 req/s for 30 minutes:
- success rate >= 99.9%
- p50 <= 50ms
- p95 <= 150ms
- p99 <= 300ms
- no pod restarts
- CPU throttling < 1% periods
- heap after GC stable
- GC pause p99 < 50ms
- DB CPU < 70%
- no queue growth
```

If criteria not defined, test results become opinion.

---

## 22. Baseline

Baseline is current known performance under defined conditions.

Store:

- code version
- image digest
- config
- JVM flags
- resource requests/limits
- node type
- dependency versions
- load profile
- dataset
- metrics
- profiles/flame graphs
- JFR
- test date

Every performance change should compare to baseline.

No baseline means “fast” and “slow” are vibes.

---

## 23. Change One Variable

If you change:

- JVM version
- GC
- heap size
- CPU limit
- thread pool size
- DB pool size
- code optimization
- payload
- cache
- node type

all at once, you cannot attribute result.

Experiment rule:

```text
change one major variable at a time
```

If multiple changes required, run staged tests.

---

## 24. Benchmark Report Template

```markdown
# Performance Test Report

## Goal
What question this test answers.

## System Under Test
- service version/image digest
- JDK version
- JVM flags
- resources
- replicas
- node type
- dependencies

## Workload
- request mix
- arrival rate/concurrency
- payload distribution
- duration
- warmup
- dataset
- cache state

## Success Criteria
- latency
- throughput
- error
- resource
- dependency constraints

## Results
- p50/p95/p99/p999
- throughput
- errors
- CPU/memory/GC
- throttling
- dependency metrics

## Bottleneck Analysis
Evidence.

## Conclusion
Pass/fail and capacity estimate.

## Artifacts
- dashboard link
- JFR
- flame graphs
- logs
- raw load generator output

## Next Actions
```

---

## 25. Capacity Planning Basics

Capacity planning asks:

```text
How many resources do we need for expected traffic with headroom?
```

Inputs:

- current peak RPS
- growth forecast
- per-pod capacity under SLO
- resource per pod
- dependency capacity
- node capacity
- failure tolerance
- autoscaling delay
- deployment surge
- regional failover
- traffic burst pattern

Output:

- required replicas
- CPU/memory requests
- node count
- DB/cache capacity
- autoscaling policy
- headroom
- cost estimate

---

## 26. Per-Pod Capacity

Find max sustainable throughput per pod under SLO.

Example:

```text
1 pod:
  p99 <= 300ms up to 250 req/s
  CPU throttling < 1%
  memory stable
```

If peak target is 2000 req/s and you want 40% headroom:

```text
required capacity = 2000 × 1.4 = 2800 req/s
replicas = ceil(2800 / 250) = 12
```

Then check dependencies.

If DB cannot handle 2800 req/s, app replica count alone is meaningless.

---

## 27. Headroom

Headroom absorbs:

- traffic spikes
- pod restarts
- node failures
- deployment surge
- GC/JIT variability
- noisy neighbors
- dependency jitter
- autoscaling delay
- partial regional failure

Common target:

```text
run steady-state at 40-70% of proven capacity
```

Exact number depends on service criticality and autoscaling speed.

Do not plan at benchmark max.

---

## 28. N+1 / Failure Capacity

If you run N replicas and one node/zone fails, can remaining capacity handle traffic?

Example:

```text
normal peak = 1000 req/s
replicas = 5
per pod capacity = 250 req/s under SLO
total = 1250 req/s
one pod lost -> 1000 req/s capacity
```

This leaves no headroom during failure.

Better plan:

```text
survive one node/pod/zone failure with SLO
```

Use pod anti-affinity/topology spread.

---

## 29. Autoscaling

HPA based on CPU is common but imperfect.

CPU scaling works when:

- CPU correlates with load
- bottleneck is CPU
- metrics are timely
- startup is fast enough
- downstream can handle more replicas

CPU scaling fails when:

- bottleneck is DB
- latency increases before CPU
- CPU throttling distorts behavior
- queue grows but CPU low
- event loop blocked
- memory/disk/network bottleneck
- startup slow/cold cache

Better metrics sometimes:

- RPS per pod
- queue length
- in-flight requests
- event loop lag
- p95 latency
- consumer lag
- custom saturation metric

---

## 30. Load Shedding

When overloaded, a service should fail fast instead of collapse.

Mechanisms:

- bounded queues
- max in-flight requests
- rate limiting
- bulkheads
- circuit breakers
- deadline propagation
- adaptive concurrency limits
- priority queues
- graceful degradation
- backpressure

Without load shedding:

```text
latency grows -> retries grow -> resource grows -> outage grows
```

Tail latency becomes total failure.

---

## 31. Retry Budget

Retries are useful but dangerous.

Bad retry:

```text
3 retries per layer across 5 layers
```

Can amplify load massively.

Use:

- bounded retries
- exponential backoff
- jitter
- retry only idempotent operations
- respect deadline
- retry budget
- circuit breaker
- avoid retrying on overload blindly

Measure retry rate.

During incident, retries can be the difference between degradation and collapse.

---

## 32. Timeout Budget

Timeouts should fit within end-to-end deadline.

Example end-to-end SLO:

```text
300ms p99
```

If request calls:

- service A
- DB
- cache
- downstream HTTP

Do not give each dependency 5s timeout.

Use:

```text
overall deadline
per-hop budget
fail fast
fallback if possible
```

Timeout too high causes queue/thread exhaustion.

Timeout too low causes false failures.

Tune with real latency distribution.

---

## 33. Connection Pool Sizing

Connection pool too small:

- pool wait latency
- underutilized downstream possibly
- request queueing

Connection pool too large:

- overload downstream
- more memory/sockets
- more TLS handshakes
- more DB contention
- worse tail latency

Use Little's Law:

```text
needed connections ≈ throughput × dependency latency
```

Example:

```text
500 req/s
each request does one DB call
DB p95 = 20ms
needed active DB connections ≈ 500 × 0.02 = 10
```

Add headroom, but do not set 500 blindly.

---

## 34. Thread Pool Sizing

CPU-bound work:

```text
threads ≈ cores
```

I/O-bound blocking work:

```text
threads can exceed cores, but bounded by memory and downstream capacity
```

Event-loop:

```text
small number of threads, never block
```

Virtual threads:

```text
many concurrent blocking tasks possible,
but downstream pools, memory, pinning, and CPU still matter
```

Always monitor:

- active threads
- queue size
- task wait time
- rejection
- pids/current
- CPU throttling
- memory/thread stacks

---

## 35. Batching Trade-Off

Batching improves throughput by amortizing overhead:

- fewer syscalls
- fewer DB round trips
- better compression
- better disk writes
- fewer network packets

But batching can hurt latency:

- waits to fill batch
- head-of-line blocking
- large batch causes long processing pause
- memory spikes

Use when:

- workload tolerates delay
- throughput matters
- batch size/time bounded
- tail latency measured

Always set:

```text
max batch size
max batch wait time
max memory
```

---

## 36. Caching Trade-Off

Caching improves latency/throughput by avoiding repeated work.

Costs:

- memory
- stale data
- invalidation complexity
- cache stampede
- cold start
- uneven hit ratio
- GC pressure
- eviction CPU
- consistency risk

Measure:

- hit ratio
- miss latency
- eviction count
- cache size
- load penalty
- stampede events
- memory impact

Use bounded caches.

Protect misses with request coalescing/single-flight if needed.

---

## 37. Compression Trade-Off

Compression reduces network/storage bytes.

Costs:

- CPU
- latency
- memory buffers
- event loop blocking if done there

Good when:

- network is bottleneck
- payload large
- CPU available
- client supports
- compression ratio high

Bad when:

- CPU constrained
- payload tiny
- already compressed data
- latency-sensitive path
- event loop thread performs compression

Benchmark with production payloads.

---

## 38. Logging Trade-Off

More logs improve debugging but cost:

- CPU formatting
- allocation
- disk/stdout I/O
- network log shipping
- storage cost
- sensitive data risk
- incident amplification

Performance rules:

- parameterized logging
- avoid payload dumps
- rate limit repetitive errors
- async bounded logging
- monitor dropped logs
- do not fsync debug logs per request
- sample high-volume logs

During load test, use production-like logging.

---

## 39. Durability Trade-Off

`fsync` per operation gives stronger durability but high latency.

Options:

- fsync per write
- group commit
- periodic flush
- write-behind
- replicated memory
- external durable queue
- database transaction

Business semantics decide.

Do not silently remove fsync for performance if durability required.

Make durability/latency trade-off explicit.

---

## 40. Performance Regression Testing

Regression gate should catch:

- latency increase
- throughput decrease
- CPU increase
- allocation increase
- GC increase
- memory growth
- startup time increase
- image size increase
- dependency call increase
- log volume increase

Lightweight CI:

- JMH for hot utility code
- startup benchmark
- smoke load test
- allocation threshold
- image size threshold

Heavier nightly:

- realistic load test
- JFR capture
- flame graph comparison
- capacity envelope test

---

## 41. Startup Performance

For Kubernetes, startup matters for:

- rollout speed
- autoscaling response
- failure recovery
- scale-from-zero
- node replacement

Measure:

```text
image pull time
container create time
JVM start time
app init time
readiness time
warmup time to steady performance
```

Optimizations:

- smaller image
- layered image cache
- CDS/AppCDS
- reduce classpath scanning
- lazy init carefully
- avoid dependency calls at startup
- tune probes
- pre-warm caches if needed
- CPU request adequate during startup

---

## 42. Java Warmup and JIT

Java performance changes over time:

- interpreter
- C1/C2 compilation
- profiling data
- inlining
- escape analysis
- deoptimization
- tiered compilation
- code cache
- class loading

Benchmark must account for:

```text
cold startup
warm steady-state
post-deploy warmup
```

Canary should not judge steady-state too early unless startup is the target.

---

## 43. GC Performance Methodology

Do not tune GC blindly.

Steps:

1. Define latency/throughput goal.
2. Measure allocation rate.
3. Measure pause distribution.
4. Check heap occupancy after GC.
5. Check promotion/old gen behavior.
6. Check CPU overhead.
7. Check container throttling.
8. Adjust heap or allocation source.
9. Then tune GC if needed.

Common mistakes:

- changing GC without allocation profile
- increasing heap until memory OOM
- ignoring CPU throttling
- ignoring native memory
- optimizing average pause not p99
- not testing with real traffic

---

## 44. Linux Performance Methodology: USE

USE method:

```text
For every resource, check:
Utilization
Saturation
Errors
```

Resources:

- CPU
- memory
- disk
- network
- filesystem
- DNS
- thread pools
- connection pools
- locks
- queues
- downstream services

Example CPU:

```text
Utilization: CPU usage
Saturation: run queue / CPU pressure / throttling
Errors: not typical, but throttling/events
```

Disk:

```text
Utilization: disk busy/throughput
Saturation: queue/await/io.pressure
Errors: I/O errors
```

Network:

```text
Utilization: bandwidth/pps
Saturation: drops/retrans/queues
Errors: resets/drops
```

---

## 45. Bottleneck Analysis

A bottleneck is resource/path limiting throughput or latency.

Signs:

- utilization near limit
- saturation/queue growing
- increasing load does not increase throughput
- latency grows sharply
- errors/timeouts rise
- reducing demand improves

Bottlenecks can move.

Example:

1. CPU bottleneck fixed.
2. DB becomes bottleneck.
3. Network becomes bottleneck.
4. Lock contention appears.

Performance engineering is iterative.

---

## 46. Cost Performance

Performance is not just speed.

Cost dimensions:

- CPU cores
- memory
- network egress
- storage IOPS
- disk space
- number of pods
- node type
- license
- operational complexity

Metric examples:

```text
requests/sec/core
requests/sec/GB memory
cost per million requests
p99 latency per dollar
```

Optimization that reduces p99 by 5ms but doubles cost may not be worth it unless SLO requires.

---

## 47. Production Validation

Load test is not production.

After rollout:

- compare real p50/p95/p99
- compare CPU/memory/GC
- compare error rates
- compare dependency load
- compare logs
- compare autoscaling
- compare cost
- watch long enough for soak issues

Use canary:

- small traffic
- same metrics
- automated rollback criteria
- compare to control

---

## 48. Performance Change Review Checklist

Before merging performance-sensitive change:

```text
[ ] What performance goal?
[ ] What workload does it target?
[ ] What metric improves?
[ ] What trade-off worsens?
[ ] Benchmark evidence?
[ ] Production-like test?
[ ] Memory/allocation impact?
[ ] CPU impact?
[ ] GC impact?
[ ] Tail latency impact?
[ ] Failure behavior?
[ ] Observability added?
[ ] Rollback plan?
```

---

## 49. Example: Capacity Planning Walkthrough

Scenario:

```text
Checkout service
Peak expected: 1200 req/s
SLO: p99 < 250ms
Failure requirement: tolerate one node loss
Per-pod tested capacity: 180 req/s under p99 < 250ms
CPU per pod at 180 req/s: 1.2 cores
Memory stable: 900Mi
```

Add 40% headroom:

```text
capacity target = 1200 × 1.4 = 1680 req/s
replicas = ceil(1680 / 180) = 10
```

If pods spread across 5 nodes, one node loss might remove 2 pods:

```text
remaining = 8 × 180 = 1440 req/s
```

This is above peak 1200 but only 20% headroom.

Maybe choose 12 replicas:

```text
normal = 2160 req/s
after losing 2-3 pods = 1620-1800 req/s
```

Check dependencies:

```text
DB capacity at 1200 req/s?
Redis capacity?
Payment gateway rate limit?
Connection pool sizes?
```

Set resource requests:

```text
CPU request maybe 1.2-1.5 cores
memory request maybe 1.2Gi
limit memory maybe 1.5-2Gi
CPU limit maybe omitted or set high depending policy
```

---

## 50. Example: Benchmark Result Interpretation

Result:

```text
At 500 req/s:
p50 30ms
p95 80ms
p99 600ms
CPU 45%
memory stable
DB p99 40ms
cpu.stat throttling high
event loop lag spikes
```

Bad conclusion:

```text
Need optimize application code.
```

Better conclusion:

```text
Tail latency likely caused by CPU throttling/event loop scheduling, not average CPU or DB.
Need inspect cgroup cpu.max/stat, event loop CPU/wall profile, and CPU limit policy.
```

---

## 51. Example: Average Lies

Result:

```text
avg latency 90ms
p99 latency 2s
```

Average SLO passes? Users still suffer.

If p99 matters, optimize:

- queues
- GC pauses
- slow dependency outliers
- lock contention
- cold cache
- retries
- network retrans
- CPU throttling
- disk stalls

Not average.

---

## 52. Example: Cache Stampede

Traffic spike after cache expiry.

Symptoms:

- DB QPS spike
- app CPU spike
- p99 spike
- retries
- cache hit ratio drops
- many identical misses

Mitigation:

- single-flight/request coalescing
- jittered TTL
- stale-while-revalidate
- background refresh
- limit concurrent misses
- circuit breaker
- pre-warm

Load test should include cache expiry scenarios.

---

## 53. Example: Retry Storm

Dependency latency increases.

Clients retry.

Traffic to dependency multiplies.

Symptoms:

- app RPS to dependency > inbound RPS
- thread pools exhausted
- connection pools full
- CPU/logs increase
- dependency worsens

Mitigation:

- retry budget
- backoff+jitter
- circuit breaker
- deadline propagation
- load shedding
- fallback/degrade

Performance test should include dependency degradation.

---

## 54. Performance Governance

For mature teams:

- define performance budgets
- benchmark critical paths
- require resource impact in design docs
- store baseline profiles
- capacity review before launch
- SLO review
- regression gates
- production canary
- regular load tests
- incident learnings feed tests
- dashboards include saturation, not only utilization

Performance is not one-time tuning. It is lifecycle discipline.

---

## 55. Common Misinterpretations

### Misinterpretation 1

```text
Average latency is enough.
```

Correction:

```text
Tail percentiles matter for user experience and distributed systems.
```

### Misinterpretation 2

```text
Max throughput is capacity.
```

Correction:

```text
Capacity is throughput while meeting SLO with headroom.
```

### Misinterpretation 3

```text
CPU 50% means plenty of capacity.
```

Correction:

```text
Could still have CPU throttling, event loop lag, lock contention, or single-thread bottleneck.
```

### Misinterpretation 4

```text
Load test passed once, so capacity is known forever.
```

Correction:

```text
Code, traffic, dependencies, data size, and infrastructure change.
```

### Misinterpretation 5

```text
Benchmark on localhost predicts production.
```

Correction:

```text
Production includes network, TLS, cgroups, storage, dependencies, GC, agents, and noisy neighbors.
```

### Misinterpretation 6

```text
More threads always increase throughput.
```

Correction:

```text
More threads can increase context switching, memory, contention, downstream overload, and tail latency.
```

### Misinterpretation 7

```text
Increasing timeout improves reliability.
```

Correction:

```text
It can increase resource retention and queueing. Use deadlines and backpressure.
```

---

## 56. Invariant yang Harus Diingat

1. Optimize for SLO, not vibes.
2. Average latency hides tail pain.
3. Throughput without latency target is incomplete.
4. Capacity means meeting SLO with headroom.
5. Saturation predicts collapse better than utilization alone.
6. Queueing delay grows non-linearly near saturation.
7. Coordinated omission can invalidate latency tests.
8. Java benchmarks need warmup and JMH for microbenchmarks.
9. Load tests need realistic workload models.
10. Cache state must be declared.
11. Test environment matters.
12. Change one variable at a time.
13. CPU throttling can dominate tail latency.
14. Heap is only part of container memory.
15. Dependencies can be the real bottleneck.
16. Retries can amplify outages.
17. Thread/connection pools must be sized from workload and dependency capacity.
18. Batching improves throughput but can hurt tail latency.
19. Performance regression should be tested continuously.
20. Production validation is mandatory.

---

## 57. Pertanyaan Senior-Level Reasoning

### Q1

Kenapa max RPS bukan kapasitas service?

Jawaban:

- Max RPS sering diukur saat latency/error sudah buruk.
- Kapasitas service adalah throughput maksimum yang masih memenuhi SLO dengan headroom.
- Tail latency, error rate, and saturation must be included.

### Q2

Kenapa average latency tidak cukup?

Jawaban:

- Average hides outliers.
- Users experience individual requests.
- Distributed fanout amplifies tail.
- p95/p99/p999 reveal reliability of latency.

### Q3

Apa itu coordinated omission?

Jawaban:

- Measurement bug where load generator stops sending new work while waiting for slow response, underreporting latency during stalls.
- Use constant-rate/open-model tools or corrected histograms.

### Q4

Kenapa CPU 50% bisa tetap punya latency buruk?

Jawaban:

- single hot thread
- CPU throttling
- event loop blocked
- lock contention
- I/O wait
- memory reclaim
- dependency wait
- queueing
- p99 not average CPU

### Q5

Bagaimana sizing connection pool secara rasional?

Jawaban:

- Estimate concurrency needed by Little's Law:
  `connections ≈ throughput × dependency latency`
- Add headroom.
- Respect downstream capacity.
- Monitor pool wait and saturation.
- Avoid huge defaults.

### Q6

Apa bedanya stress test dan capacity test?

Jawaban:

- Stress test pushes beyond limits to see failure mode.
- Capacity test finds maximum sustainable load under defined SLO and headroom.

---

## 58. Ringkasan

Performance engineering adalah disiplin sistematis, bukan sekadar tuning.

Mental model utama:

```text
SLO
  -> workload model
  -> measurement
  -> baseline
  -> bottleneck
  -> experiment
  -> validation
  -> capacity plan
  -> regression guard
```

Untuk Java di Linux/Kubernetes, performa harus dilihat lintas layer:

```text
application
JVM
GC
Linux scheduler
cgroups
network
storage
Kubernetes
dependencies
```

Benchmark yang baik menjawab pertanyaan yang jelas.

Load test yang baik mensimulasikan realita.

Capacity planning yang baik menyertakan headroom dan failure scenario.

Performance governance yang baik mencegah incident sebelum terjadi.

---

## 59. Referensi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. JMH — Java Microbenchmark Harness  
   `https://openjdk.org/projects/code-tools/jmh/`

2. HdrHistogram  
   `https://hdrhistogram.github.io/HdrHistogram/`

3. Gil Tene — Coordinated Omission materials  
   `https://www.azul.com/blog/coordinated-omission/`

4. Brendan Gregg — USE Method  
   `https://www.brendangregg.com/usemethod.html`

5. Google SRE Books — SLOs, alerting, capacity planning  
   `https://sre.google/books/`

6. Kubernetes Documentation — Resource Management  
   `https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/`

7. Kubernetes Documentation — Horizontal Pod Autoscaling  
   `https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/`

8. OpenJDK Documentation — JFR, GC logging, JVM flags  
   `https://docs.oracle.com/en/java/javase/`

9. async-profiler  
   `https://github.com/async-profiler/async-profiler`

10. Linux Kernel Documentation — cgroup v2 and PSI  
    `https://docs.kernel.org/admin-guide/cgroup-v2.html`  
    `https://docs.kernel.org/accounting/psi.html`

---

## 60. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 031 — Performance Engineering: Methodology, Benchmarking, Load Testing, and Capacity Planning
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-032.md
Part 032 — Kernel Build, Modules, eBPF Internals, and Safe Experimentation Labs
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-030.md">⬅️ Part 030 — Production Failure Playbooks: CPU, Memory, Network, Disk, and Container Incidents</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-032.md">Part 032 — Kernel Build, Modules, eBPF Internals, and Safe Experimentation Labs ➡️</a>
</div>

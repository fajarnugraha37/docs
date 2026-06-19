# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-031
# Cloud-Native Runtime Tuning: JVM Mode vs Native Mode, Memory, GC, Startup, Throughput

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Part: `031`  
> Topik: Cloud-Native Runtime Tuning: JVM Mode vs Native Mode, Memory, GC, Startup, Throughput  
> Status: Materi lanjutan advance — setelah Kubernetes/container deployment  
> Target: Software engineer yang mampu membuat keputusan runtime Quarkus berbasis pengukuran: JVM vs native, memory, GC, CPU, startup, throughput, latency, dan cost

---

## 0. Ringkasan Besar

Banyak diskusi Quarkus berhenti pada klaim:

```text
Quarkus cepat.
Native image startup cepat.
Memory kecil.
```

Itu benar sebagai arah desain, tetapi belum cukup untuk production engineering.

Production runtime tuning harus menjawab:

1. Apakah service ini lebih cocok JVM atau native?
2. Apa metrik keputusan yang digunakan?
3. Berapa memory request/limit yang benar?
4. Apakah RSS atau heap yang menjadi bottleneck?
5. GC apa yang dipakai?
6. Bagaimana p95/p99 latency?
7. Apakah CPU throttling terjadi?
8. Apakah startup time atau time-to-readiness yang penting?
9. Apakah native benar-benar lebih murah untuk workload ini?
10. Apakah throughput steady-state JVM lebih baik?
11. Bagaimana DB pool, HTTP client pool, thread pool, event loop, dan cache mempengaruhi memory/latency?
12. Bagaimana autoscaling dikaitkan dengan downstream capacity?
13. Bagaimana menghindari benchmark yang misleading?
14. Bagaimana Quarkus dev mode berbeda dari production?
15. Bagaimana membuat tuning reproducible?

Part ini membahas cloud-native runtime tuning sebagai disiplin berbasis measurement.

---

## 1. Mental Model: Runtime Tuning Bukan “Set Flag”, Tapi Capacity Model

Tuning bukan menebak flag:

```text
-Xmx512m
-XX:+UseZGC
quarkus.thread-pool.max-threads=200
```

Tuning adalah membuat capacity model:

```text
Traffic profile
  -> concurrency
  -> latency budget
  -> thread/virtual thread/event loop model
  -> DB pool/client pool/cache
  -> CPU
  -> memory/RSS
  -> GC/native memory
  -> Kubernetes requests/limits
  -> autoscaling
  -> cost
```

Setiap knob punya trade-off.

Contoh:

```text
Menambah DB pool size bisa menaikkan throughput aplikasi,
tetapi bisa menghancurkan database saat HPA scale-out.
```

Contoh lain:

```text
Native image bisa menurunkan memory dan startup,
tetapi build lebih lambat dan throughput CPU-heavy perlu diukur.
```

Prinsip:

```text
No tuning without measurement.
No measurement without workload model.
No workload model without SLO.
```

---

## 2. Performance Dimensions

Quarkus performance harus dilihat multi-dimensi:

1. **Startup time**
   - waktu process mulai sampai app up.

2. **Time to readiness**
   - waktu sampai pod menerima traffic.

3. **Memory**
   - heap,
   - RSS,
   - native memory,
   - direct buffers,
   - thread stacks,
   - code/cache/metaspace in JVM.

4. **CPU**
   - request CPU cost,
   - throttling,
   - startup CPU,
   - GC CPU,
   - serialization CPU.

5. **Throughput**
   - requests/sec,
   - messages/sec,
   - job items/sec.

6. **Latency**
   - p50,
   - p95,
   - p99,
   - p99.9,
   - timeout rate.

7. **Error rate**
   - 4xx,
   - 5xx,
   - timeout,
   - rejection,
   - circuit open.

8. **Saturation**
   - DB pool waiting,
   - thread pool queue,
   - event loop blocked,
   - CPU throttled,
   - queue lag.

9. **Cost**
   - CPU/memory allocation,
   - pod density,
   - scale behavior,
   - build cost.

Do not optimize one dimension blindly.

---

## 3. JVM Mode vs Native Mode Decision

### 3.1 JVM Mode Strengths

JVM mode is strong when:

- service is long-running,
- throughput matters,
- JIT warmup acceptable,
- library compatibility broad,
- debugging/profiling needed,
- dynamic behavior used,
- build speed matters,
- team knows JVM tuning.

JVM advantages:

```text
JIT can optimize hot paths using runtime profile.
Tooling is mature.
Compatibility is broad.
Build pipeline is simpler.
```

### 3.2 Native Mode Strengths

Native mode is strong when:

- cold start matters,
- scale-to-zero/serverless,
- memory budget tight,
- many small services,
- pod density matters,
- startup-sensitive autoscaling,
- Quarkus extensions cover dependencies,
- dynamic behavior limited.

Native advantages:

```text
Fast startup.
Often lower RSS.
No JIT warmup.
Smaller runtime image possible.
Good cold-start behavior.
```

### 3.3 Decision Table

| Workload | Likely Starting Point |
|---|---|
| serverless function | native |
| CLI/batch command short-lived | native |
| many small low-traffic services | native candidate |
| long-running high-throughput API | benchmark JVM vs native |
| CPU-heavy scoring engine | benchmark, JVM may win |
| reflection-heavy legacy app | JVM or refactor first |
| memory-constrained cluster | native candidate |
| complex unsupported libraries | JVM likely safer |
| latency-sensitive with warm traffic | benchmark |
| fast scale-out API | native candidate, watch DB burst |

Rule:

```text
Choose runtime mode by measured SLO/cost, not ideology.
```

---

## 4. Quarkus Performance Measurement Guidance

Quarkus has an official performance measurement guide that covers measuring memory usage, startup time, native-image default flags, and coordinated omission. The guide explicitly highlights measurement methodology: run tests on the same hardware for a batch, measure startup consistently, and beware coordinated omission in tools. Quarkus native reference also covers native memory management, inspecting/debugging native executables, and improving runtime performance.

Practical implications:

```text
Do not compare results from different machines.
Do not compare dev mode to production.
Do not compare cold JVM to warm native unfairly.
Do not report average latency only.
Do not ignore coordinated omission.
Do not ignore RSS in containers.
```

---

## 5. Dev Mode Is Not Production

Quarkus dev mode optimizes feedback loop, not runtime performance.

Quarkus dev-mode differences guide notes that optimal performance is not an objective of dev mode, and C2 compiler can be disabled to improve startup time in dev mode.

Therefore:

```text
Never benchmark production performance in dev mode.
```

Use packaged application:

```bash
./mvnw package
java -jar target/quarkus-app/quarkus-run.jar
```

Or native:

```bash
./mvnw package -Dnative
./target/*-runner
```

Or containerized production-like image.

---

## 6. Measurement Environment

Control variables:

- same hardware,
- same CPU/memory limit,
- same Java version,
- same Quarkus version,
- same application build,
- same DB/data,
- same dependency latency,
- same container runtime,
- same Kubernetes node type,
- same warmup,
- same load generator,
- same network topology.

Document:

```text
runtime mode
image tag
git commit
JVM flags/native build flags
CPU/memory request/limit
replica count
data size
traffic profile
tool used
duration
warmup
SLO thresholds
```

Without this, performance result cannot be trusted.

---

## 7. Startup Time vs Time to Readiness

Startup time:

```text
process started -> Quarkus started
```

Readiness time:

```text
pod scheduled -> app ready to receive traffic
```

Readiness includes:

- container pull,
- pod scheduling,
- process start,
- config load,
- extension startup,
- DB connection validation,
- cache warmup if blocking readiness,
- migration if any,
- health check UP.

Native helps process startup, but readiness can still be delayed by:

- DB unavailable,
- token endpoint slow,
- cache warmup,
- migration,
- secret mount,
- service mesh sidecar,
- cold DNS/TLS,
- application initialization.

Measure both.

---

## 8. Memory: Heap vs RSS

### 8.1 Heap

Heap is Java object memory managed by GC.

JVM mode:

```text
-Xmx controls max heap.
```

Native mode:

```text
native image also has a managed heap, but runtime behavior differs.
```

### 8.2 RSS

RSS = resident set size, memory actually resident in RAM.

Container memory limit cares about process memory, not only Java heap.

RSS includes:

- heap,
- thread stacks,
- native memory,
- direct buffers,
- mapped files,
- JIT/code cache in JVM,
- metaspace/class metadata in JVM,
- GC structures,
- native libraries,
- TLS/crypto buffers,
- memory allocator overhead.

Therefore:

```text
Xmx 512m does not mean container needs only 512Mi.
```

For Kubernetes memory limit, use RSS/headroom.

### 8.3 JVM Native Memory Tracking

In JVM mode, use Native Memory Tracking for analysis:

```bash
-XX:NativeMemoryTracking=summary
```

Then:

```bash
jcmd <pid> VM.native_memory summary
```

Useful for:

- direct buffer usage,
- thread stacks,
- class metadata,
- code cache,
- GC overhead,
- allocator.

---

## 9. Container Memory Sizing

Sizing approach:

```text
container limit = heap + non-heap/native + thread stacks + direct buffers + safety headroom
```

Example JVM:

```text
memory limit: 1Gi
heap target: 60-70%
non-heap/native: 20-30%
headroom: 10-20%
```

JVM flag:

```text
-XX:MaxRAMPercentage=70
```

But do not blindly use 70%.

If app uses:

- Netty direct buffers,
- large thread pool,
- caches,
- compression,
- TLS,
- big JSON payloads,
- image/PDF processing,

need more non-heap headroom.

### 9.1 Cache Memory

Local Caffeine cache uses heap.

If cache size unbounded:

```text
OOM risk
GC pressure
latency spikes
```

Configure maximum size/weight.

### 9.2 Thread Stack Memory

Platform thread stack consumes memory.

Large thread pools:

```text
more memory
more context switching
```

Virtual threads reduce per-thread cost, but do not remove downstream bottlenecks.

---

## 10. CPU Requests, Limits, and Throttling

CPU request:

```text
scheduler placement and guaranteed share
```

CPU limit:

```text
maximum allowed CPU
```

If app hits CPU limit, Kubernetes throttles.

Symptoms:

- p99 latency spikes,
- GC slower,
- event loop delayed,
- readiness/liveness timeout,
- throughput lower,
- CPU usage looks capped,
- throttling metrics increase.

Tuning:

- set realistic CPU request,
- avoid too-low CPU limit for latency-sensitive services,
- monitor throttling,
- benchmark with same CPU limits as production,
- scale based on saturation.

Important:

```text
CPU throttling can look like random latency.
```

---

## 11. GC Strategy in JVM Mode

Java 21 commonly uses G1 by default.

Other collectors:

- G1,
- ZGC,
- Shenandoah depending distribution,
- Parallel GC for some workloads.

### 11.1 G1

Good general-purpose collector.

Pros:

- default,
- predictable enough,
- good throughput/latency balance.

Tune only if measurement shows need.

### 11.2 ZGC

Low-latency GC.

Pros:

- low pause,
- useful for large heaps/latency-sensitive services.

Cons:

- CPU overhead,
- memory overhead,
- needs measurement,
- may not improve small services.

Example:

```bash
-XX:+UseZGC
```

### 11.3 GC Tuning Principle

Do not tune GC before knowing:

- allocation rate,
- live set,
- pause time,
- latency SLO,
- heap occupancy,
- object churn source,
- cache behavior.

Most performance problems are not solved by GC flags.

Often better:

- reduce allocations,
- bound caches,
- fix query payload size,
- stream data,
- avoid huge object graphs,
- reduce JSON mapping overhead,
- tune thread/pool/backpressure.

---

## 12. Allocation Rate

High allocation rate causes GC pressure.

Sources:

- JSON serialization/deserialization,
- DTO mapping,
- string concatenation,
- logging payloads,
- large collections,
- stream pipelines in hot path,
- per-request regex compile,
- exception creation,
- BigDecimal/date formatting,
- buffering full responses,
- copying byte arrays.

Quarkus native/JVM both benefit from lower allocation.

Measure with:

- JFR,
- allocation profiler,
- GC logs,
- Micrometer/JVM metrics,
- async profiler.

Optimization examples:

- reuse compiled `Pattern`,
- avoid logging huge objects,
- stream large payloads,
- avoid unnecessary `toList`,
- use projections instead of entity graphs,
- cache static metadata,
- avoid exception for control flow.

---

## 13. Startup Optimization

Quarkus is designed for fast startup via build-time optimizations.

Still, app-specific startup can be slow due:

- migrations,
- cache warmup,
- external dependency checks,
- large config loading,
- classpath/resource scanning by custom libs,
- connection initialization,
- service mesh sidecar,
- heavy static initialization,
- logging/OTel exporter startup,
- native image runtime init.

Startup tuning:

1. Move heavy work out of startup if not required for readiness.
2. Avoid contacting optional dependencies at startup.
3. Use startupProbe for slow initialization.
4. Lazy initialize optional clients.
5. Precompute safe metadata at build time where Quarkus supports.
6. Avoid large warmup all pods at once.
7. Measure time-to-ready, not only process start.

---

## 14. Throughput Tuning

Throughput depends on:

- CPU,
- IO concurrency,
- DB pool,
- HTTP client pool,
- thread/event loop model,
- serialization,
- locks,
- cache hit ratio,
- downstream latency,
- batching,
- backpressure.

Example:

```text
Throughput low because DB pool max=10, not because CPU.
```

Another:

```text
Throughput high but p99 terrible because queueing.
```

Tune by bottleneck:

| Bottleneck | Tuning |
|---|---|
| CPU | optimize code, scale CPU, reduce serialization |
| DB pool | optimize queries, right-size pool, reduce transaction time |
| external API | timeout, rate limit, async/outbox, cache |
| thread pool | reduce blocking, virtual threads, worker size |
| event loop | remove blocking, offload CPU/blocking work |
| memory/GC | reduce allocation, bound cache, heap sizing |
| network | keep-alive, pool, payload size, compression |

---

## 15. Latency Tuning

Latency must be measured as distribution.

Track:

- p50,
- p90,
- p95,
- p99,
- timeout rate,
- queue wait,
- dependency latency.

p99 is often caused by:

- downstream timeout,
- DB pool waiting,
- GC pause,
- CPU throttling,
- lock contention,
- cold cache,
- TLS handshake,
- connection pool exhaustion,
- noisy neighbor,
- retry.

Do not optimize p50 while ignoring p99.

### 15.1 Timeout Budget

From Part 023:

```text
Inbound deadline must dominate downstream timeouts.
```

If request SLA is 2s:

```text
external timeout 5s is invalid.
```

---

## 16. Reactive Architecture and Event Loop

Quarkus has a reactive core based on Vert.x.

Reactive architecture guide notes that traditional thread-per-request requires multiple threads to handle concurrency; thread pools constrain concurrency and each thread has memory/CPU cost. Reactive/event-loop model uses fewer threads but requires non-blocking behavior.

Event loop rules:

```text
Do not block event loop.
Do not run CPU-heavy work on event loop.
Do not call blocking JDBC/file IO from event loop.
```

Symptoms of event loop blocking:

- many requests slow,
- blocked thread warnings,
- p99 spikes,
- low CPU but high latency,
- event loop saturation.

Use:

- worker threads for blocking code,
- virtual threads where appropriate,
- reactive clients for non-blocking pipeline,
- proper annotations/dispatching.

---

## 17. Worker Threads

Blocking work runs on worker threads.

Tuning worker pool:

- too small -> queueing,
- too large -> memory/context switching/DB pressure,
- right-sized -> enough concurrency without downstream overload.

Do not set worker thread count arbitrarily high.

Consider:

```text
blocked time
request rate
DB pool
external API latency
CPU cores
memory
```

Little's Law:

```text
concurrency ≈ throughput * latency
```

Example:

```text
100 requests/sec * 200ms = 20 concurrent requests
```

If p99 includes 2s external wait:

```text
100 rps * 2s = 200 concurrent waits
```

Need timeout, bulkhead, backpressure, not just more threads.

---

## 18. Virtual Threads

Quarkus supports Java 21+ virtual threads in REST, messaging, gRPC, and other areas.

Virtual threads are useful for blocking-style IO code:

```text
simple imperative code
many concurrent IO waits
less platform thread memory overhead
```

But virtual threads do not remove:

- DB connection limit,
- external API rate limit,
- CPU limit,
- memory for request objects,
- lock contention,
- pinned carrier thread risk,
- need for timeout/circuit breaker.

Quarkus virtual thread guide explains how to benefit from virtual threads, and Quarkus has guides for REST and messaging virtual thread usage.

Rule:

```text
Virtual threads reduce cost of waiting.
They do not make downstream unlimited.
```

---

## 19. Pinning Risk

Virtual threads can pin carrier threads in some blocking/synchronized/native situations.

Pinning reduces scalability.

Sources:

- synchronized block around blocking IO,
- native method,
- some monitor usage,
- blocking call while holding lock.

Quarkus/Java ecosystem provides ways to detect pinning; Quarkus blog discussed testing virtual thread pinning and test helpers.

Test virtual thread apps under load and with pinning detection when virtual threads are critical.

---

## 20. DB Pool Sizing

DB pool is one of the most important tuning knobs.

Too small:

```text
requests wait for connection
latency rises
throughput capped
```

Too large:

```text
DB overloaded
more locks
more memory
more context switching
worse latency
```

Pool size must consider:

```text
replica count * pool size <= DB safe connection budget
```

Example:

```text
DB safe max app connections = 240
max replicas = 8
pool per pod <= 30
```

If HPA can scale to 20 pods:

```text
pool per pod 30 -> 600 connections
```

Not safe.

### 20.1 Quarkus Datasource

Quarkus datasource guide provides unified configuration for JDBC and reactive drivers.

Typical JDBC pool configs include:

```properties
quarkus.datasource.jdbc.max-size=20
quarkus.datasource.jdbc.min-size=2
```

Exact options depend on Quarkus version.

Tuning strategy:

- measure active/awaiting connections,
- monitor DB CPU/waits,
- reduce transaction duration,
- avoid external call in transaction,
- use keyset pagination,
- separate job workload if needed.

---

## 21. HTTP Client Pool and Outbound Limits

Outbound clients also have resource budgets:

- max connections,
- pending queue,
- timeout,
- retry,
- circuit breaker,
- rate limit.

If HTTP client pool too small:

```text
requests wait, p99 rises
```

If too large:

```text
downstream overloaded
local memory/socket pressure
```

Coordinate with:

- bulkhead,
- rate limit,
- service mesh policy,
- downstream capacity.

---

## 22. Cache Tuning

Cache can improve latency, but memory and correctness matter.

Tune:

- maximum size,
- TTL,
- stale policy,
- hit ratio,
- eviction,
- load duration,
- stampede control,
- serialization size,
- local vs distributed.

Caffeine cache on heap:

```text
affects heap and GC
```

Redis cache:

```text
adds network latency and dependency
```

High hit ratio is not enough.

Also monitor stale served and invalidation lag.

---

## 23. Native Runtime Memory

Quarkus native reference covers native memory management and inspection/debugging native executables.

Native memory tuning differs from JVM:

- no HotSpot JIT/metaspace in same way,
- image heap/native heap,
- runtime heap,
- thread stacks,
- malloc/native allocations,
- direct buffers,
- GC mode for native image.

Measure RSS.

Do not assume native process memory equals heap.

Use OS/container metrics:

```text
container_memory_working_set_bytes
RSS
process memory
```

---

## 24. Native Throughput Tuning

Native may not always beat JVM steady-state throughput.

Possible native strengths:

- no warmup,
- lower memory,
- fast startup,
- predictable cold behavior.

Possible native weaknesses:

- AOT lacks some JIT profile optimization,
- CPU-heavy code may run slower,
- profiling/debugging harder,
- build-time choices matter.

Benchmark native with:

- warmed JVM comparison,
- same container limits,
- same traffic,
- same dependencies,
- sufficient duration,
- tail latency,
- CPU/RSS.

---

## 25. Container Ergonomics

For JVM in container:

- Java detects container limits,
- MaxRAMPercentage useful,
- CPU limit affects available processors,
- GC thread count tied to CPU,
- too-low CPU limit hurts startup and GC.

Tune:

```bash
-XX:MaxRAMPercentage=70
-XX:+ExitOnOutOfMemoryError
```

Potential:

```bash
-XX:InitialRAMPercentage=...
-XX:MinRAMPercentage=...
-XX:ActiveProcessorCount=...
```

Use only with measurement.

For native:

- memory limit still applies,
- CPU throttling still applies,
- fast startup can stress dependencies.

---

## 26. Autoscaling Metrics

HPA default CPU scaling is often insufficient.

Better signals:

- request rate,
- p95 latency,
- queue depth,
- Kafka lag,
- worker queue,
- DB pool saturation,
- custom business backlog.

But scaling on latency can be tricky if bottleneck is downstream DB.

If DB is bottleneck:

```text
adding pods can worsen latency.
```

Use autoscaling with capacity model.

Example:

```text
Scale consumers by Kafka lag,
but cap max replicas based on DB/external API capacity.
```

---

## 27. Warmup and Cold Start

JVM warmup:

- classloading,
- JIT compilation,
- cache warmup,
- connection pool warmup,
- TLS session warmup,
- DB plan cache.

Native warmup:

- less JIT warmup,
- still cache/connection/TLS warmup,
- app/data warmup still exists.

Do not confuse native startup with fully warmed app.

Test:

```text
first request latency
after 1 minute
after 10 minutes
after cache warm
after DB pool warm
```

---

## 28. Benchmark Design

A benchmark scenario must define:

```text
endpoint/message/job
runtime mode
resource limit
replicas
data size
dependency behavior
arrival rate
duration
warmup
success criteria
metrics collected
```

Example:

```yaml
scenario: submit-application
runtime: jvm
replicas: 3
cpu: 1
memory: 1Gi
arrival_rate: 100rps
duration: 15m
warmup: 3m
data:
  applications: 1_000_000
  users: 100_000
slo:
  p95: 500ms
  p99: 1500ms
  error_rate: <0.1%
```

---

## 29. Coordinated Omission

Coordinated omission occurs when load generator waits for response before sending next request, hiding latency during stalls.

Quarkus performance measurement guide explicitly calls out coordinated omission problem in tools.

Use tools/settings that maintain intended arrival rate.

Measure:

- intended rate,
- actual throughput,
- latency including queueing,
- errors/timeouts,
- p99/p99.9.

If test ignores coordinated omission, it may report false success.

---

## 30. Profiling Strategy

Use profiling when metrics show symptom but not cause.

JVM tools:

- JFR,
- async-profiler,
- jcmd,
- jstack/thread dump,
- heap dump,
- NMT,
- GC logs.

Native tools:

- native image diagnostics,
- perf,
- async-profiler where applicable,
- OS-level profiler,
- Quarkus native reference guidance,
- container metrics.

Profile under realistic load.

Do not profile only idle app.

---

## 31. Runtime Tuning Playbook

### 31.1 Symptom: High p99 Latency

Check:

- dependency latency,
- DB pool awaiting,
- CPU throttling,
- GC pauses,
- event loop blocked,
- thread pool queue,
- retry/circuit behavior,
- cache misses,
- lock contention.

### 31.2 Symptom: OOMKilled

Check:

- container memory limit,
- heap max,
- RSS,
- cache size,
- direct buffers,
- thread count,
- payload size,
- native memory,
- memory leak.

### 31.3 Symptom: Low Throughput

Check:

- CPU saturation,
- DB pool,
- external API timeout,
- locks,
- small worker pool,
- rate limit,
- serialization CPU,
- slow queries.

### 31.4 Symptom: Slow Startup

Check:

- dev mode vs prod mode,
- migrations,
- cache warmup,
- external checks,
- native/JVM mode,
- container CPU limit,
- classpath/custom scanning,
- OTel/exporter startup.

### 31.5 Symptom: DB Overload After Scale-Out

Check:

- replicas * pool size,
- HPA max replicas,
- job workload,
- startup connection burst,
- cache cold miss,
- query plans.

---

## 32. Quarkus Runtime Knob Categories

Categories:

1. **HTTP server**
   - thread/event loop/limits.

2. **Datasource**
   - pool size,
   - timeouts.

3. **REST client**
   - timeout,
   - pool,
   - TLS.

4. **Messaging**
   - concurrency,
   - backpressure.

5. **Cache**
   - size,
   - TTL,
   - metrics.

6. **Fault tolerance**
   - timeout,
   - retry,
   - circuit,
   - bulkhead,
   - rate limit.

7. **JVM**
   - heap,
   - GC,
   - CPU ergonomics.

8. **Native**
   - build/runtime native options,
   - memory,
   - diagnostics.

9. **Kubernetes**
   - resources,
   - probes,
   - HPA,
   - rollout.

Never tune a single layer in isolation.

---

## 33. Example JVM Configuration

Conceptual Kubernetes env:

```yaml
env:
  - name: JAVA_OPTS_APPEND
    value: >
      -XX:MaxRAMPercentage=70
      -XX:+ExitOnOutOfMemoryError
```

Quarkus config:

```properties
quarkus.datasource.jdbc.max-size=20
quarkus.datasource.jdbc.min-size=2

external.identity.timeout=PT800MS
jobs.expiry.batch-size=500

quarkus.cache.caffeine."reference-data".maximum-size=1000
quarkus.cache.caffeine."reference-data".expire-after-write=24H
```

Kubernetes:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "768Mi"
  limits:
    cpu: "1"
    memory: "1Gi"
```

Validate with load test.

---

## 34. Example Native Configuration

Native container:

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "256Mi"
  limits:
    cpu: "1"
    memory: "512Mi"
```

But do not copy blindly.

Need measure:

- idle RSS,
- RSS under load,
- p99,
- CPU,
- readiness,
- scale behavior.

Native app may use less memory, but if it does CPU-heavy work, CPU limit may still dominate.

---

## 35. Runtime Mode Decision Record

For each service, create decision record:

```text
Service: application-service
Runtime: JVM / Native
Reason:
  - workload pattern
  - startup requirement
  - memory budget
  - throughput requirement
  - library compatibility
Measurement:
  - startup time
  - readiness time
  - RSS
  - CPU
  - p95/p99
  - throughput
Trade-offs:
  - build time
  - debugging
  - compatibility
Rollback:
  - can deploy JVM image if native fails
```

This prevents runtime choice from becoming folklore.

---

## 36. Case Study: API Service on EKS

Service:

```text
Quarkus REST + Hibernate + Oracle + Redis + OIDC
```

Initial config:

```text
replicas=4
DB pool max=50
memory limit=1Gi
CPU limit=1
```

Problem:

```text
DB has safe app connection budget 200.
HPA max replicas planned 8.
```

At max scale:

```text
8 * 50 = 400 DB connections
```

Not safe.

Better:

```text
DB pool max=20
HPA max=8 -> 160 connections
leave headroom for jobs/admin/other services
```

If throughput insufficient:

- optimize queries,
- reduce transaction duration,
- add read replica if appropriate,
- queue background work,
- increase DB capacity,
- split workloads.

Do not simply increase pool.

---

## 37. Case Study: Native Fast Startup Causing DB Burst

Native deployment scales from 2 to 20 pods quickly.

Each pod:

```text
opens min DB pool 10
warms cache
loads reference data
```

Burst:

```text
18 new pods * 10 = 180 new DB connections quickly
```

DB spikes.

Mitigation:

- lower min pool,
- lazy connection acquisition,
- stagger rollout,
- warm cache gradually,
- readiness delay/jitter,
- HPA stabilization,
- DB connection budget,
- startup backoff.

Fast startup changes failure mode.

---

## 38. Case Study: p99 Latency from CPU Throttling

Symptoms:

```text
p50 stable 50ms
p99 spikes 3s
CPU usage near limit
container_cpu_cfs_throttled high
GC logs show pauses longer
```

Root cause:

```text
CPU limit too low for burst.
```

Fix:

- increase CPU limit/request,
- optimize CPU-heavy serialization,
- reduce logging,
- reduce retry storm,
- scale replicas,
- tune HPA.

Do not only tune GC.

---

## 39. Anti-Pattern Umum

### 39.1 Benchmarking Dev Mode

Invalid.

### 39.2 Comparing Cold JVM vs Warm Native Only

Unfair comparison.

### 39.3 Average Latency Focus

p99 ignored.

### 39.4 Ignoring RSS

Container OOM despite heap looking fine.

### 39.5 Increasing Thread Pool Blindly

Downstream collapse.

### 39.6 Increasing DB Pool Blindly

DB overload.

### 39.7 Native Because “Always Faster”

Not always for throughput/CPU-heavy workloads.

### 39.8 CPU Limit Too Tight

Throttling causes p99 spikes.

### 39.9 No Warmup Phase in Benchmark

Misleading JVM results.

### 39.10 Ignoring Coordinated Omission

Tail latency hidden.

### 39.11 Autoscaling on CPU Only

Queue/DB bottleneck ignored.

### 39.12 No Runtime Decision Record

Tuning choices become tribal knowledge.

---

## 40. Production Checklist

### 40.1 Measurement

- [ ] Production-like packaged app used.
- [ ] Dev mode not benchmarked.
- [ ] Same hardware/environment controlled.
- [ ] Startup and readiness measured.
- [ ] p95/p99 measured.
- [ ] RSS measured.
- [ ] CPU throttling measured.
- [ ] DB/client pool metrics captured.
- [ ] Coordinated omission avoided.

### 40.2 JVM

- [ ] Heap sizing based on container limit.
- [ ] Non-heap/native headroom included.
- [ ] GC metrics collected.
- [ ] Allocation rate profiled.
- [ ] JVM flags documented.
- [ ] Warmup behavior measured.

### 40.3 Native

- [ ] Native integration tests pass.
- [ ] RSS under load measured.
- [ ] CPU under load measured.
- [ ] Startup/readiness measured.
- [ ] JVM vs native compared.
- [ ] Native observability validated.
- [ ] Native build cost understood.

### 40.4 Kubernetes

- [ ] requests/limits sized.
- [ ] HPA max respects downstream.
- [ ] DB pool * replicas safe.
- [ ] probes tuned.
- [ ] graceful shutdown tested.
- [ ] rollout scale burst considered.
- [ ] cache warmup controlled.

### 40.5 Application

- [ ] timeouts configured.
- [ ] retries bounded.
- [ ] bulkheads/rate limits set.
- [ ] caches bounded.
- [ ] jobs resource budgeted.
- [ ] external dependency limits understood.
- [ ] business SLO defined.

---

## 41. Latihan

### Latihan 1 — JVM vs Native Decision

Service:

```text
REST API, 30 RPS average, 500 RPS peak, JDBC Oracle, Redis cache, OIDC, long-running on EKS.
```

Buat decision plan:

- metric apa diukur,
- runtime mana baseline,
- workload test,
- success criteria,
- rollback plan.

### Latihan 2 — Memory Sizing

Pod memory limit 1Gi.

Aplikasi JVM butuh:

```text
heap live set 350Mi
direct buffer peak 100Mi
thread/native/metaspace 150Mi
cache peak 100Mi
headroom 150Mi
```

Tentukan Xmx/MaxRAMPercentage dan apakah limit cukup.

### Latihan 3 — DB Pool and HPA

DB safe app connections 300.

Ada 5 services:

```text
service A max replicas 6
service B max replicas 4
service C max replicas 8
jobs max concurrent 2
admin connections 20
```

Buat DB pool allocation agar total aman.

### Latihan 4 — p99 Investigation

Gejala:

```text
p50 40ms, p95 300ms, p99 6s.
CPU low, DB pool awaiting high.
```

Buat investigation dan tuning plan.

### Latihan 5 — Native Scale Burst

Native app autoscale dari 2 ke 30 pods saat traffic spike.

Apa risiko terhadap:

- DB,
- Redis,
- OIDC,
- cache,
- external API,
- observability backend?

Buat mitigation.

---

## 42. Ringkasan Invariants

Ingat invariants berikut:

```text
Runtime tuning starts from SLO and workload model.
JVM vs native is a measured decision.
Startup time is not the same as time to readiness.
Heap is not RSS.
Container memory limit cares about total process memory.
CPU throttling can cause p99 latency.
GC tuning is not a substitute for allocation and query optimization.
Virtual threads reduce waiting cost, not downstream scarcity.
DB pool size must be multiplied by replicas.
Autoscaling must respect downstream capacity.
Benchmark dev mode is invalid.
Avoid coordinated omission.
Measure p95/p99, not only averages.
Native improves cold start/memory often, but throughput must be tested.
Document runtime mode decision.
```

---

## 43. Referensi Resmi yang Relevan

Referensi yang perlu dibaca saat implementasi nyata:

- Quarkus Measuring Performance guide.
- Quarkus Native Reference Guide.
- Quarkus Performance page and benchmark notes.
- Quarkus Dev Mode Differences guide.
- Quarkus Virtual Thread support reference.
- Quarkus Reactive Architecture guide.
- Quarkus Datasource guide.
- Quarkus Micrometer Metrics guide.
- Quarkus Container Images guide.
- Quarkus Kubernetes deployment/probe guides.
- GraalVM/Mandrel Native Image documentation.
- JVM GC and container ergonomics documentation for selected Java distribution.

---

## 44. Kapan Seri Ini Lanjut ke Part Berikutnya

Part ini menyelesaikan runtime tuning untuk JVM/native mode, memory, GC, startup, throughput, latency, dan Kubernetes capacity model.

Bagian berikutnya:

```text
Part 032 — Virtual Threads in Quarkus: Loom, Blocking Simplicity, Reactive Trade-Off
```

Di part berikutnya, fokus bergeser khusus ke virtual threads:

- Project Loom mental model,
- platform thread vs virtual thread,
- carrier thread,
- pinning,
- blocking simplicity,
- reactive trade-off,
- Quarkus REST/messaging/gRPC virtual threads,
- JDBC and external IO,
- structured concurrency implications,
- performance testing,
- anti-patterns,
- production checklist.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-030.md">⬅️ Kubernetes and Container Engineering: Image Build, Probes, ConfigMap, Secret, Service Binding</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-032.md">Virtual Threads in Quarkus: Loom, Blocking Simplicity, Reactive Trade-Off ➡️</a>
</div>

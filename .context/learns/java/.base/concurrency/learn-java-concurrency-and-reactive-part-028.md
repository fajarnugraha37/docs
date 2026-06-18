# learn-java-concurrency-and-reactive-part-028.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 028  
# Performance Engineering for Threads and Virtual Threads: Throughput, Latency, Queueing, Pinning, Memory, GC, Pool Sizing, Benchmarking, and Production Tuning

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **028**  
> Fokus: memahami performance engineering untuk aplikasi Java concurrent, baik dengan platform threads maupun virtual threads. Materi ini membahas throughput, latency, p99, Little's Law, queueing, thread pool sizing, virtual thread scaling, carrier saturation, pinning, blocking I/O, CPU-bound limits, memory footprint, ThreadLocal cost, stack footprint, allocation, GC, context switching, JFR profiling, benchmark methodology, load testing, capacity planning, dan tuning production.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Performance Engineering Bukan Menebak](#2-performance-engineering-bukan-menebak)
3. [Mental Model: Throughput, Latency, Concurrency](#3-mental-model-throughput-latency-concurrency)
4. [Little's Law](#4-littles-law)
5. [Throughput](#5-throughput)
6. [Latency dan Percentiles](#6-latency-dan-percentiles)
7. [p99 Lebih Penting daripada Average](#7-p99-lebih-penting-daripada-average)
8. [Queueing Theory Mental Model](#8-queueing-theory-mental-model)
9. [Saturation](#9-saturation)
10. [CPU-Bound vs I/O-Bound Performance](#10-cpubound-vs-iobound-performance)
11. [Platform Thread Cost Model](#11-platform-thread-cost-model)
12. [Virtual Thread Cost Model](#12-virtual-thread-cost-model)
13. [Virtual Threads: What Gets Faster and What Does Not](#13-virtual-threads-what-gets-faster-and-what-does-not)
14. [Thread Pool Sizing for Platform Threads](#14-thread-pool-sizing-for-platform-threads)
15. [Why You Usually Do Not Pool Virtual Threads](#15-why-you-usually-do-not-pool-virtual-threads)
16. [Resource Pool Sizing](#16-resource-pool-sizing)
17. [Connection Pool Performance](#17-connection-pool-performance)
18. [HTTP Client Pool Performance](#18-http-client-pool-performance)
19. [Semaphore Bulkhead Performance](#19-semaphore-bulkhead-performance)
20. [Context Switching](#20-context-switching)
21. [Carrier Threads and Scheduler Saturation](#21-carrier-threads-and-scheduler-saturation)
22. [Virtual Thread Pinning Performance Impact](#22-virtual-thread-pinning-performance-impact)
23. [ThreadLocal Performance Cost](#23-threadlocal-performance-cost)
24. [Memory Footprint of Many Tasks](#24-memory-footprint-of-many-tasks)
25. [Stack Footprint](#25-stack-footprint)
26. [Allocation Rate and GC](#26-allocation-rate-and-gc)
27. [Lock Contention Performance](#27-lock-contention-performance)
28. [False Sharing and Cache Locality](#28-false-sharing-and-cache-locality)
29. [Backpressure as Performance Tool](#29-backpressure-as-performance-tool)
30. [Timeouts as Performance Protection](#30-timeouts-as-performance-protection)
31. [Benchmarking Concurrent Java](#31-benchmarking-concurrent-java)
32. [JMH for Microbenchmarks](#32-jmh-for-microbenchmarks)
33. [Load Testing for Macro Performance](#33-load-testing-for-macro-performance)
34. [JFR Profiling Workflow](#34-jfr-profiling-workflow)
35. [Capacity Planning](#35-capacity-planning)
36. [Tuning Methodology](#36-tuning-methodology)
37. [Mini Case Study: Virtual Threads Improve Throughput but DB p99 Worsens](#37-mini-case-study-virtual-threads-improve-throughput-but-db-p99-worsens)
38. [Mini Case Study: ThreadLocal Buffer Memory Explosion](#38-mini-case-study-threadlocal-buffer-memory-explosion)
39. [Mini Case Study: CPU Work in Virtual Threads](#39-mini-case-study-cpu-work-in-virtual-threads)
40. [Common Anti-Patterns](#40-common-antipatterns)
41. [Best Practices](#41-best-practices)
42. [Decision Matrix](#42-decision-matrix)
43. [Latihan](#43-latihan)
44. [Ringkasan](#44-ringkasan)
45. [Referensi](#45-referensi)

---

# 1. Tujuan Bagian Ini

Performance engineering untuk concurrency sering salah arah karena engineer fokus pada:

```text
jumlah thread
jenis executor
virtual thread enabled atau tidak
```

Padahal pertanyaan performance yang benar adalah:

```text
Apa bottleneck sebenarnya?
Apakah CPU, DB, HTTP, queue, lock, memory, GC, atau downstream?
Berapa throughput yang dibutuhkan?
Berapa p99 latency target?
Berapa concurrency aman?
Di mana request menunggu?
Apa efek overload?
```

Virtual threads mengubah cost model, tetapi tidak menghilangkan hukum performance:

- CPU tetap finite;
- DB connection tetap finite;
- remote service tetap finite;
- memory tetap finite;
- queueing tetap menambah latency;
- lock tetap serialization;
- GC tetap dipengaruhi allocation/live set.

Target bagian ini:

```text
Mampu mengukur dan mengoptimalkan aplikasi concurrent secara sistematis,
bukan berdasarkan mitos “tambah thread”, “pakai virtual thread”, atau “naikkan pool”.
```

---

# 2. Performance Engineering Bukan Menebak

Bad tuning:

```text
Naikkan thread pool dari 200 ke 1000.
Naikkan DB pool dari 50 ke 500.
Aktifkan virtual threads.
Tambah heap.
```

tanpa evidence.

Good tuning:

```text
Measure -> identify bottleneck -> formulate hypothesis -> change one thing -> test -> compare.
```

## 2.1 Performance loop

```text
1. Define SLO
2. Measure baseline
3. Identify bottleneck
4. Change one variable
5. Run repeatable test
6. Compare p50/p95/p99, throughput, resource usage
7. Keep or rollback
```

## 2.2 Main rule

```text
Performance engineering is controlled experimentation.
```

---

# 3. Mental Model: Throughput, Latency, Concurrency

Three core metrics:

## 3.1 Throughput

How many operations completed per unit time.

```text
requests/second
messages/second
rows/second
```

## 3.2 Latency

How long one operation takes.

```text
request duration
DB query duration
queue wait
```

## 3.3 Concurrency

How many operations in progress at the same time.

```text
in-flight requests
active DB connections
running tasks
waiting virtual threads
```

## 3.4 Relationship

If throughput fixed and latency increases, concurrency rises.

If concurrency too high for capacity, queueing increases latency.

## 3.5 Main rule

```text
Throughput, latency, and concurrency are linked.
You cannot tune one while ignoring the others.
```

---

# 4. Little's Law

Little's Law:

```text
L = λ × W
```

Where:

```text
L = average number of items in system
λ = arrival/completion rate
W = average time in system
```

Example:

```text
throughput = 100 req/s
latency = 200 ms = 0.2 s
concurrency ≈ 100 × 0.2 = 20 in-flight requests
```

If latency becomes 2 seconds at same throughput:

```text
concurrency ≈ 100 × 2 = 200
```

## 4.1 Why important

If downstream slows, in-flight work grows automatically.

That means:

- more memory;
- more queued work;
- more timeout risk;
- more resource pressure.

## 4.2 Main rule

```text
Higher latency creates higher concurrency pressure even if arrival rate stays constant.
```

---

# 5. Throughput

Throughput is bounded by the bottleneck.

If DB can do 500 queries/sec and each request needs 2 queries:

```text
max request throughput <= 250 req/sec
```

unless caching/read model changes.

## 5.1 More threads do not guarantee more throughput

If bottleneck is DB:

```text
more threads = more waiting
```

not more DB capacity.

## 5.2 Main rule

```text
Throughput improves by increasing bottleneck capacity or reducing bottleneck demand.
```

---

# 6. Latency dan Percentiles

Latency distribution matters.

Common percentiles:

- p50 median;
- p90;
- p95;
- p99;
- p99.9.

## 6.1 Why percentiles?

Averages hide tail.

Example:

```text
99 requests = 10ms
1 request = 5s
average ≈ 59.9ms
p99 ≈ 5s
```

User pain is p99.

## 6.2 Main rule

```text
Use percentiles for latency SLO, not only average.
```

---

# 7. p99 Lebih Penting daripada Average

p99 captures tail behavior.

Tail latency often caused by:

- queueing;
- lock contention;
- GC pause;
- slow DB query;
- downstream timeout;
- retry;
- noisy neighbor;
- cold cache;
- CPU saturation;
- connection pool wait.

## 7.1 Fan-out amplifies tail

If one request calls 10 downstreams, chance one is slow increases.

## 7.2 Main rule

```text
In distributed concurrent systems, user latency is often dominated by the slowest dependency.
```

---

# 8. Queueing Theory Mental Model

When utilization approaches 100%, queueing delay rises sharply.

Example:

```text
server utilization 50% -> low wait
server utilization 90% -> high wait
server utilization 99% -> unstable wait
```

## 8.1 Headroom

Keep headroom.

If DB pool always active=max:

```text
no headroom for spikes
```

## 8.2 Main rule

```text
Running every resource at 100% utilization maximizes queueing, not user experience.
```

---

# 9. Saturation

A resource is saturated when demand >= capacity.

Resources:

- CPU;
- DB;
- HTTP downstream;
- executor;
- queue;
- lock;
- disk;
- network;
- memory/GC;
- rate limit quota.

## 9.1 Saturation indicators

- queue grows;
- wait time grows;
- timeout grows;
- p99 grows;
- utilization high;
- rejections occur.

## 9.2 Main rule

```text
Every saturation point needs an explicit policy: queue, reject, shed, degrade, or scale.
```

---

# 10. CPU-Bound vs I/O-Bound Performance

## 10.1 CPU-bound

Bottleneck CPU cycles.

Tuning:

- better algorithm;
- reduce allocation;
- use bounded CPU pool;
- parallelize to core count;
- improve cache locality.

## 10.2 I/O-bound

Bottleneck waiting on external resource.

Tuning:

- reduce calls;
- batch;
- cache;
- optimize DB/query;
- virtual threads;
- non-blocking I/O;
- resource limits;
- timeouts.

## 10.3 Main rule

```text
CPU-bound tuning increases computation efficiency.
I/O-bound tuning reduces waiting or makes waiting cheaper.
```

---

# 11. Platform Thread Cost Model

Platform threads cost:

- OS thread stack memory;
- kernel scheduling;
- context switching;
- limited practical count;
- blocking occupies OS thread.

## 11.1 Pooling

Platform threads are expensive enough to pool.

```java
Executors.newFixedThreadPool(200)
```

## 11.2 Problem

If tasks mostly wait, many platform threads are idle but reserved/blocked.

## 11.3 Main rule

```text
Platform threads are expensive blocking resources, so platform-thread pools are capacity controls.
```

---

# 12. Virtual Thread Cost Model

Virtual threads are lightweight Java threads scheduled by JVM.

Cost:

- virtual thread object;
- continuation/stack chunks;
- scheduling state;
- captured task objects;
- ThreadLocal map if used;
- memory for blocked operation state.

## 12.1 Much cheaper than platform threads

But not free.

Millions may still consume memory.

## 12.2 Main rule

```text
Virtual threads make blocking concurrency cheaper, not infinite.
```

---

# 13. Virtual Threads: What Gets Faster and What Does Not

## 13.1 Gets better

- throughput for blocking I/O when platform threads were bottleneck;
- simpler code than async callback;
- request concurrency when waiting dominates;
- thread-per-task model.

## 13.2 Does not get better automatically

- DB query time;
- DB connection count;
- downstream capacity;
- CPU-heavy computation;
- lock contention;
- memory allocation;
- bad algorithms;
- retry storm.

## 13.3 Main rule

```text
Virtual threads improve thread scalability, not every bottleneck.
```

---

# 14. Thread Pool Sizing for Platform Threads

Classic sizing rough idea:

```text
threads ≈ cores × (1 + wait_time / compute_time)
```

If tasks wait a lot, more threads may help.

But this is approximation.

## 14.1 Need caps

Too many platform threads cause:

- memory overhead;
- context switching;
- scheduling overhead;
- noisy latency.

## 14.2 For CPU-bound

```text
threads ≈ cores
```

or slightly more depending blocking.

## 14.3 Main rule

```text
Platform thread pools should be sized by workload wait/compute ratio and resource limits.
```

---

# 15. Why You Usually Do Not Pool Virtual Threads

Virtual threads are cheap and intended for thread-per-task.

Bad:

```java
Executors.newFixedThreadPool(100, Thread.ofVirtual().factory())
```

This limits threads, not resources.

Better:

```java
Executors.newVirtualThreadPerTaskExecutor()
```

and limit:

- DB;
- HTTP;
- CPU;
- memory;
- request admission.

## 15.1 Main rule

```text
Do not use virtual-thread pool size as resource control.
Use resource-specific bulkheads.
```

---

# 16. Resource Pool Sizing

Resource pool sizing asks:

```text
How many concurrent operations can this dependency handle at target latency?
```

Examples:

- DB pool;
- HTTP connection pool;
- CPU pool;
- thread pool;
- object storage client;
- message consumers.

## 16.1 Measure saturation curve

Increase concurrency until p99 rises sharply.

Choose operating point with headroom.

## 16.2 Main rule

```text
Pool size is a capacity contract with a dependency, not a random tuning knob.
```

---

# 17. Connection Pool Performance

Metrics:

- active;
- idle;
- pending;
- acquisition time;
- timeout count;
- connection usage duration;
- max lifetime;
- leak detection.

## 17.1 Pool too small

High pending, DB not saturated.

## 17.2 Pool too large

DB saturated, query latency worse.

## 17.3 Query too slow

Active high, usage duration high.

## 17.4 Main rule

```text
Connection pool performance is determined by pool size × query duration × DB capacity.
```

---

# 18. HTTP Client Pool Performance

Metrics per downstream:

- in-flight;
- connection wait;
- connect time;
- TLS time;
- response time;
- timeout;
- retry;
- circuit open;
- bulkhead rejection.

## 18.1 Pool too small

Connection wait high but downstream maybe fine.

## 18.2 Downstream slow

In-flight high, response time high.

## 18.3 Main rule

```text
HTTP latency must be decomposed into waiting for connection, connecting, and waiting for response.
```

---

# 19. Semaphore Bulkhead Performance

Semaphore bulkhead adds:

- acquire wait;
- rejection;
- bounded in-flight.

Good metric:

```text
bulkhead.acquire.duration
bulkhead.rejected.total
bulkhead.inflight
```

## 19.1 Performance benefit

Rejecting early prevents useless work and queueing collapse.

## 19.2 Main rule

```text
A bulkhead improves performance under overload by preserving bounded latency and protecting dependencies.
```

---

# 20. Context Switching

Platform thread context switching cost increases with many runnable threads.

Symptoms:

- high system CPU;
- lower throughput;
- p99 jitter;
- poor CPU cache locality.

Virtual threads reduce OS-thread blocking issue, but if many virtual threads are CPU-runnable, carriers still contend for CPU.

## 20.1 Main rule

```text
Too many runnable CPU tasks hurt performance regardless of thread type.
```

---

# 21. Carrier Threads and Scheduler Saturation

Virtual threads run on carrier platform threads.

If many virtual threads are CPU-bound:

```text
carriers saturated
scheduler queue grows
latency increases
```

If many virtual threads block properly:

```text
carriers freed
scalability improves
```

## 21.1 Observe

- CPU;
- scheduler queue if available;
- pinned events;
- task latency;
- DB/HTTP waits.

## 21.2 Main rule

```text
Virtual-thread performance depends on virtual threads mostly waiting, not all running CPU loops.
```

---

# 22. Virtual Thread Pinning Performance Impact

Pinning prevents carrier release during blocking.

Impact:

- fewer carriers available;
- runnable virtual threads wait longer;
- throughput drops;
- latency rises.

## 22.1 Detect

- JFR `VirtualThreadPinned`;
- stack traces;
- low throughput with high waiting;
- scheduler queue.

## 22.2 Fix

- avoid problematic blocking regions;
- upgrade JDK if relevant;
- move blocking outside critical section;
- replace problematic native/library path;
- add timeouts.

## 22.3 Main rule

```text
Pinning turns virtual-thread blocking back toward platform-thread blocking cost.
```

---

# 23. ThreadLocal Performance Cost

ThreadLocal cost in virtual-thread apps can be severe.

Example:

```java
ThreadLocal<byte[]> buffer = ThreadLocal.withInitial(() -> new byte[1024 * 1024]);
```

If 10,000 virtual threads touch it:

```text
potentially massive memory
```

## 23.1 Avoid

- large buffers;
- per-thread caches;
- mutable heavy context.

## 23.2 Prefer

- local variables;
- bounded object pools only if justified;
- immutable scoped context;
- smaller allocations.

## 23.3 Main rule

```text
Per-thread memory patterns become dangerous when thread count becomes huge.
```

---

# 24. Memory Footprint of Many Tasks

Each task may retain:

- request object;
- input payload;
- response buffer;
- Future/CompletableFuture;
- lambda capture;
- stack;
- ThreadLocal;
- MDC;
- exception;
- queued references.

## 24.1 Unbounded submission

Submitting 1 million tasks can OOM even with virtual threads.

## 24.2 Main rule

```text
Bound the number of in-flight tasks by memory and resource budget.
```

---

# 25. Stack Footprint

Platform threads often reserve significant native stack.

Virtual threads use more flexible stack representation.

But deep call stacks and many blocked virtual threads still consume memory.

## 25.1 Avoid

- deep recursion;
- large object graphs retained on stack;
- huge local buffers;
- unnecessary captures.

## 25.2 Main rule

```text
Virtual-thread stacks are lightweight, not zero-cost.
```

---

# 26. Allocation Rate and GC

Concurrency increases allocation:

- more tasks;
- more futures;
- more buffers;
- more stack traces;
- more request objects;
- more intermediate collections.

High allocation rate causes:

- frequent young GC;
- promotion;
- old gen pressure;
- pause spikes;
- CPU spent in GC.

## 26.1 Tune by reducing allocation first

Before GC flags:

- reuse carefully;
- stream/chunk data;
- avoid unnecessary boxing;
- avoid large temporary lists;
- limit task count.

## 26.2 Main rule

```text
GC tuning cannot fully fix excessive allocation from bad concurrency design.
```

---

# 27. Lock Contention Performance

Lock contention serializes work.

Symptoms:

- BLOCKED threads;
- monitor blocked time;
- high p99;
- CPU maybe low;
- high wait time.

## 27.1 Fix

- reduce lock hold time;
- remove I/O under lock;
- split lock;
- per-key locks;
- immutable snapshot;
- concurrent data structure.

## 27.2 Main rule

```text
Lock contention performance improves by reducing shared mutable critical sections.
```

---

# 28. False Sharing and Cache Locality

In CPU-bound parallel code:

- false sharing causes cache invalidations;
- random memory access hurts locality;
- pointer-heavy objects reduce cache efficiency;
- primitive arrays often faster.

## 28.1 Main rule

```text
Parallel CPU performance is limited by memory/cache behavior, not just cores.
```

---

# 29. Backpressure as Performance Tool

Backpressure improves performance under overload by refusing to make latency infinite.

Strategies:

- bounded queues;
- timed offer;
- semaphore acquire timeout;
- admission control;
- rate limits;
- circuit breaker;
- load shedding.

## 29.1 Main rule

```text
Backpressure protects p99 by preventing uncontrolled queue growth.
```

---

# 30. Timeouts as Performance Protection

Timeouts prevent indefinite resource occupation.

Use:

- request timeout;
- DB acquisition timeout;
- query timeout;
- HTTP timeout;
- semaphore acquire timeout;
- queue offer timeout.

## 30.1 Deadline hierarchy

```text
request deadline
  > dependency timeout
  > connection acquire timeout
```

## 30.2 Main rule

```text
Timeouts convert unknown infinite waits into observable bounded failures.
```

---

# 31. Benchmarking Concurrent Java

Benchmarking pitfalls:

- no warmup;
- measuring debug/log heavy code;
- not controlling input size;
- not isolating dependency;
- unrealistic zero-latency mocks;
- no p99;
- no overload test;
- benchmarking on laptop then assuming prod;
- changing multiple variables.

## 31.1 Need baselines

Compare:

- sequential;
- platform thread pool;
- virtual threads;
- bounded resources;
- different pool sizes.

## 31.2 Main rule

```text
A benchmark is useful only if it reflects the bottleneck you want to study.
```

---

# 32. JMH for Microbenchmarks

Use JMH for microbenchmarks:

- warmup;
- forks;
- measurement iterations;
- dead-code prevention;
- profilers.

Good for:

- algorithm comparison;
- allocation reduction;
- CPU function;
- data structure choice.

Not enough for:

- full web app;
- DB;
- network;
- distributed latency.

## 32.1 Main rule

```text
Use JMH for small CPU/memory questions, not end-to-end system capacity.
```

---

# 33. Load Testing for Macro Performance

Use load testing for system behavior.

Scenarios:

- steady load;
- ramp-up;
- spike;
- soak;
- overload;
- downstream slow;
- DB slow;
- partial outage;
- retry storm;
- virtual threads on/off.

Measure:

- throughput;
- p50/p95/p99/p99.9;
- errors;
- timeouts;
- rejections;
- CPU;
- memory;
- GC;
- DB pool;
- HTTP pool;
- queue age.

## 33.1 Main rule

```text
Load testing must include overload and dependency degradation, not only happy path.
```

---

# 34. JFR Profiling Workflow

Workflow:

1. Reproduce issue.
2. Start JFR for short window.
3. Capture during load.
4. Inspect CPU samples.
5. Inspect allocation.
6. Inspect locks/parks.
7. Inspect I/O.
8. Inspect virtual-thread pinned events.
9. Correlate with metrics.

Command example:

```bash
jcmd <pid> JFR.start name=perf settings=profile duration=60s filename=/tmp/perf.jfr
```

## 34.1 Main rule

```text
JFR is the default first serious profiler for production-like Java performance.
```

---

# 35. Capacity Planning

Capacity planning asks:

```text
At target p99, how much traffic can this service handle with headroom?
```

Inputs:

- request rate target;
- request mix;
- DB calls per request;
- downstream calls per request;
- CPU per request;
- memory per request;
- retry rate;
- fan-out factor.

## 35.1 Headroom

Plan for:

- traffic spikes;
- node loss;
- GC;
- deployment overlap;
- downstream slowness.

## 35.2 Main rule

```text
Capacity is not max throughput. Capacity is sustainable throughput at target latency with headroom.
```

---

# 36. Tuning Methodology

## 36.1 Step 1: Define target

```text
p99 < 300ms at 500 rps
```

## 36.2 Step 2: Baseline

Current metrics.

## 36.3 Step 3: Bottleneck

CPU? DB? HTTP? lock? memory?

## 36.4 Step 4: Change one thing

Example:

- query index;
- DB bulkhead;
- virtual threads;
- CPU pool size;
- timeout.

## 36.5 Step 5: Validate

Same load test.

## 36.6 Main rule

```text
Tune bottlenecks, not symptoms.
```

---

# 37. Mini Case Study: Virtual Threads Improve Throughput but DB p99 Worsens

## 37.1 Situation

Before:

```text
platform threads limited request concurrency
DB pool stable
```

After virtual threads:

```text
more requests reach DB
throughput initially rises
DB pool wait rises
p99 worsens
```

## 37.2 Fix

- DB bulkhead;
- query optimization;
- connection acquisition timeout;
- request admission;
- reduce N+1;
- cache/read model.

## 37.3 Lesson

```text
Virtual threads can reveal bottlenecks by removing thread bottleneck.
```

---

# 38. Mini Case Study: ThreadLocal Buffer Memory Explosion

## 38.1 Code

```java
static final ThreadLocal<byte[]> BUFFER =
    ThreadLocal.withInitial(() -> new byte[512 * 1024]);
```

## 38.2 With platform pool 100

~50MB.

## 38.3 With many virtual threads

Thousands touch ThreadLocal -> huge memory.

## 38.4 Fix

- remove per-thread buffer;
- allocate smaller local buffer;
- use bounded pool if proven;
- stream data;
- use scoped immutable context only for metadata.

## 38.5 Lesson

```text
Old per-thread optimization can become virtual-thread memory bug.
```

---

# 39. Mini Case Study: CPU Work in Virtual Threads

## 39.1 Problem

Endpoint on virtual threads performs CPU-heavy PDF generation.

1000 concurrent requests.

CPU saturated.

Latency huge.

## 39.2 Fix

- bound CPU work with fixed CPU pool;
- limit endpoint admission;
- async job for large reports;
- cache/precompute;
- return 202 for long jobs.

## 39.3 Lesson

```text
Virtual threads are not CPU parallelism.
```

---

# 40. Common Anti-Patterns

## 40.1 Increasing all pools

More queueing and overload.

## 40.2 Measuring average only

Tail hidden.

## 40.3 Benchmarking without warmup

Invalid.

## 40.4 Using virtual threads for CPU-bound work

Wrong tool.

## 40.5 Pooling virtual threads

Wrong limit.

## 40.6 No resource bulkheads

Unbounded dependency pressure.

## 40.7 Huge ThreadLocal values

Memory explosion.

## 40.8 Unbounded task submission

OOM.

## 40.9 Ignoring GC

Latency mystery.

## 40.10 No overload testing

Production discovers behavior first.

---

# 41. Best Practices

## 41.1 Define performance SLO

Throughput and p99.

## 41.2 Measure before tuning

Use metrics/JFR/load test.

## 41.3 Separate CPU and I/O

Bound CPU, virtualize waiting.

## 41.4 Use virtual threads for blocking I/O

When resource limits are explicit.

## 41.5 Do not pool virtual threads

Use virtual-thread-per-task.

## 41.6 Bound resources

DB/HTTP/semaphore/queue/admission.

## 41.7 Track wait times

Queue wait, DB wait, HTTP wait.

## 41.8 Reduce allocation

Before GC tuning.

## 41.9 Watch ThreadLocal

Especially in virtual-thread apps.

## 41.10 Test overload

Including slow dependency and retry behavior.

---

# 42. Decision Matrix

| Symptom | Likely Bottleneck | Action |
|---|---|---|
| CPU 100%, p99 high | CPU-bound | profile, bounded CPU pool, optimize |
| DB pending high | DB pool/query | optimize, bulkhead, timeout |
| HTTP in-flight high | downstream slow | timeout, bulkhead, circuit breaker |
| Queue depth/age grows | consumer slow | scale consumer, backpressure |
| Many platform threads blocked | I/O-bound platform limit | virtual threads or async |
| Many virtual threads waiting DB | DB capacity | DB bulkhead, query optimize |
| JFR pinned events | carrier pinning | inspect stack, refactor/upgrade |
| Memory grows with concurrency | queued tasks/ThreadLocal | bound tasks, reduce retention |
| GC pauses align p99 | allocation/live set | reduce allocation, tune GC later |
| Lock blocked time high | contention | reduce critical section |
| Parallel stream slow | overhead/common pool | sequential/custom CPU strategy |
| CompletableFuture slow | executor saturation | explicit executor/metrics |

---

# 43. Latihan

## Latihan 1 — Little's Law

Hitung concurrency jika throughput 300 rps dan average latency 250 ms.

## Latihan 2 — Pool Bottleneck

Diberi DB pool 50, query average 100 ms. Estimasi throughput maksimum kasar.

## Latihan 3 — Virtual Thread Migration

Buat daftar metrics sebelum/sesudah enable virtual threads.

## Latihan 4 — ThreadLocal Cost

Hitung potensi memory jika 20.000 virtual threads menyentuh ThreadLocal 256KB.

## Latihan 5 — CPU Bound Endpoint

Desain CPU bulkhead untuk report generation.

## Latihan 6 — JFR Workflow

Tulis command JFR dan checklist analisis.

## Latihan 7 — Load Test Matrix

Buat matrix test: normal, spike, DB slow, downstream slow, retry storm.

## Latihan 8 — Timeout Hierarchy

Buat deadline request 2s dan turunkan ke HTTP/DB/semaphore timeout.

## Latihan 9 — Allocation Reduction

Identifikasi 5 sumber allocation di concurrent request path.

## Latihan 10 — Decision Practice

Diberi 5 symptoms, tentukan bottleneck dan evidence yang perlu dikumpulkan.

---

# 44. Ringkasan

Performance engineering concurrent Java adalah disiplin pengukuran dan capacity design.

Core lessons:

- Performance tuning tanpa evidence adalah tebak-tebakan.
- Throughput, latency, dan concurrency saling terkait.
- Little's Law membantu memahami in-flight work.
- p99 lebih penting daripada average untuk user experience.
- Queueing naik tajam saat utilization mendekati 100%.
- Saturation butuh explicit policy.
- CPU-bound dan I/O-bound perlu strategi berbeda.
- Platform threads mahal untuk blocking; virtual threads lebih murah untuk waiting.
- Virtual threads tidak mempercepat DB, HTTP, CPU, lock, atau bad algorithms.
- Platform thread pools perlu sizing; virtual threads biasanya tidak dipool.
- Resource pools harus berdasarkan capacity dependency.
- Context switching dan carrier saturation penting untuk CPU-heavy tasks.
- Pinning merusak benefit virtual threads.
- ThreadLocal memory patterns berbahaya pada virtual threads.
- Banyak tasks berarti banyak retained memory.
- Allocation rate mempengaruhi GC dan latency.
- Lock contention serializes work.
- Backpressure dan timeouts adalah performance protection.
- JMH cocok untuk microbenchmark; load testing cocok untuk macro/system performance.
- JFR adalah alat utama untuk profiling Java production-like workloads.
- Capacity planning harus berbasis sustainable throughput at target latency with headroom.

Main rule:

```text
Do not tune thread count first.
Find the bottleneck, bound the work,
measure p99 and wait times,
then change one variable at a time.
```

---

# 45. Referensi

1. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

2. OpenJDK JEP 491 — Synchronize Virtual Threads without Pinning  
   https://openjdk.org/jeps/491

3. Oracle Java SE 25 Guide — Virtual Threads  
   https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html

4. Java SE 25 — `Executors.newVirtualThreadPerTaskExecutor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html#newVirtualThreadPerTaskExecutor()

5. Java SE 25 — `ThreadPoolExecutor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html

6. Java SE 25 — `ForkJoinPool`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinPool.html

7. JDK Tools — `jcmd`  
   https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html

8. Java Flight Recorder Runtime Guide  
   https://docs.oracle.com/en/java/javase/25/jfapi/

9. Java Microbenchmark Harness (JMH)  
   https://openjdk.org/projects/code-tools/jmh/

10. Micrometer Documentation  
    https://docs.micrometer.io/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-concurrency-and-reactive-part-027.md](./learn-java-concurrency-and-reactive-part-027.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-concurrency-and-reactive-part-029.md](./learn-java-concurrency-and-reactive-part-029.md)

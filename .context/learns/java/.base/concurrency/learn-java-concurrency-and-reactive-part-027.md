# learn-java-concurrency-and-reactive-part-027.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 027  
# Observability and Debugging Concurrent Java: Thread Dumps, JFR, jcmd, Metrics, Logs, Traces, Locks, Executors, Virtual Threads, and Production Runbooks

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **027**  
> Fokus: memahami observability dan debugging untuk aplikasi Java concurrent. Materi ini membahas cara mendiagnosis deadlock, starvation, blocked threads, executor saturation, virtual-thread pinning, DB pool starvation, HTTP downstream waits, memory pressure, CPU saturation, context leaks, async failures, dan incident production menggunakan thread dump, JFR, `jcmd`, metrics, logs, tracing, heap/thread analysis, dan runbook yang sistematis.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Observability Concurrent Java Sulit](#2-kenapa-observability-concurrent-java-sulit)
3. [Mental Model: Observe Waiting, Running, Queuing, and Failing](#3-mental-model-observe-waiting-running-queuing-and-failing)
4. [Four Golden Questions](#4-four-golden-questions)
5. [Signals: Metrics, Logs, Traces, Profiles, Dumps](#5-signals-metrics-logs-traces-profiles-dumps)
6. [Thread States](#6-thread-states)
7. [Thread Dumps](#7-thread-dumps)
8. [Reading Thread Dumps](#8-reading-thread-dumps)
9. [Deadlock Detection](#9-deadlock-detection)
10. [Blocked vs Waiting vs Timed Waiting](#10-blocked-vs-waiting-vs-timed-waiting)
11. [Executor Observability](#11-executor-observability)
12. [ForkJoinPool Observability](#12-forkjoinpool-observability)
13. [Virtual Threads Observability](#13-virtual-threads-observability)
14. [Virtual Thread Pinning](#14-virtual-thread-pinning)
15. [`jcmd` Essentials](#15-jcmd-essentials)
16. [Java Flight Recorder](#16-java-flight-recorder)
17. [JFR Events for Concurrency](#17-jfr-events-for-concurrency)
18. [Lock Contention](#18-lock-contention)
19. [Monitor Contention](#19-monitor-contention)
20. [Database Pool Observability](#20-database-pool-observability)
21. [HTTP Client and Downstream Observability](#21-http-client-and-downstream-observability)
22. [Queue and Backpressure Observability](#22-queue-and-backpressure-observability)
23. [CPU Saturation Diagnostics](#23-cpu-saturation-diagnostics)
24. [Memory Pressure and Allocation](#24-memory-pressure-and-allocation)
25. [GC and Concurrency](#25-gc-and-concurrency)
26. [Context Propagation Debugging](#26-context-propagation-debugging)
27. [Logging for Concurrent Systems](#27-logging-for-concurrent-systems)
28. [Tracing Concurrent Work](#28-tracing-concurrent-work)
29. [Metrics Design](#29-metrics-design)
30. [High-Cardinality Pitfalls](#30-highcardinality-pitfalls)
31. [Debugging Structured Concurrency](#31-debugging-structured-concurrency)
32. [Debugging CompletableFuture](#32-debugging-completablefuture)
33. [Debugging Parallel Streams](#33-debugging-parallel-streams)
34. [Debugging Reactive Pipelines](#34-debugging-reactive-pipelines)
35. [Debugging Production Without Making It Worse](#35-debugging-production-without-making-it-worse)
36. [Incident Runbook: Service Stuck](#36-incident-runbook-service-stuck)
37. [Incident Runbook: Latency Spike](#37-incident-runbook-latency-spike)
38. [Incident Runbook: CPU 100%](#38-incident-runbook-cpu-100)
39. [Incident Runbook: DB Pool Exhausted](#39-incident-runbook-db-pool-exhausted)
40. [Mini Case Study: All Threads Waiting on Future](#40-mini-case-study-all-threads-waiting-on-future)
41. [Mini Case Study: Virtual Thread Pinning](#41-mini-case-study-virtual-thread-pinning)
42. [Mini Case Study: Lost Correlation ID in `@Async`](#42-mini-case-study-lost-correlation-id-in-async)
43. [Common Anti-Patterns](#43-common-antipatterns)
44. [Best Practices](#44-best-practices)
45. [Decision Matrix](#45-decision-matrix)
46. [Latihan](#46-latihan)
47. [Ringkasan](#47-ringkasan)
48. [Referensi](#48-referensi)

---

# 1. Tujuan Bagian Ini

Concurrent Java bugs sering sulit karena:

```text
bug tidak selalu deterministic
bug muncul saat load tinggi
bug hilang saat diberi breakpoint
bug tidak selalu menghasilkan exception
bug kadang hanya berupa latency tinggi
bug bisa ada di thread, executor, DB pool, HTTP pool, lock, queue, atau context
```

Contoh incident:

```text
Service tidak error, tetapi request timeout.
CPU tidak tinggi, tetapi latency tinggi.
Thread banyak WAITING.
DB pool active=maximum.
Virtual threads banyak, tetapi throughput rendah.
MDC correlationId hilang di @Async.
CompletableFuture tidak pernah selesai.
```

Target bagian ini:

```text
Mampu membangun observability yang menjawab:
apa yang running,
apa yang waiting,
apa yang queued,
apa yang blocked,
apa yang timed out,
apa yang cancelled,
dan resource mana yang menjadi bottleneck.
```

---

# 2. Kenapa Observability Concurrent Java Sulit

## 2.1 Banyak layer

Satu request melewati:

```text
HTTP server
filter/security
controller
service
executor/virtual thread
DB pool
database lock
HTTP client pool
downstream
message broker
```

Masalah bisa terjadi di layer manapun.

## 2.2 Symptoms misleading

`threads high` belum tentu masalah.

`CPU low` belum tentu sehat.

`DB pool full` bisa akibat query lambat, leak, lock wait, atau terlalu banyak request.

## 2.3 Need correlation

Tanpa correlation ID:

```text
log A, trace B, metric C tidak bisa disambungkan
```

## 2.4 Main rule

```text
Concurrent observability is about connecting waits across layers.
```

---

# 3. Mental Model: Observe Waiting, Running, Queuing, and Failing

Untuk setiap unit kerja, tanya:

## 3.1 Running

Apakah sedang memakai CPU?

## 3.2 Waiting

Menunggu apa?

- lock;
- queue;
- DB connection;
- DB lock;
- HTTP response;
- semaphore;
- future;
- sleep;
- retry backoff.

## 3.3 Queuing

Antri di mana?

- executor queue;
- servlet backlog;
- DB pool pending;
- message broker lag;
- HTTP client pool;
- OS run queue.

## 3.4 Failing

Gagal bagaimana?

- timeout;
- cancellation;
- rejection;
- deadlock;
- circuit breaker;
- retry exhausted.

## 3.5 Main rule

```text
A concurrency incident is usually a waiting/queuing story.
Find the queue or wait point.
```

---

# 4. Four Golden Questions

Saat incident concurrency:

## 4.1 What is saturated?

CPU, DB, HTTP, lock, executor, queue, memory, GC?

## 4.2 Who is waiting?

Which threads/tasks/requests are waiting?

## 4.3 What are they waiting for?

Lock? Connection? Future? Downstream? Permit?

## 4.4 Why is the owner slow?

The resource holder/consumer/downstream may be bottleneck.

## 4.5 Main rule

```text
Do not only inspect waiters. Find the holder/owner/consumer they are waiting on.
```

---

# 5. Signals: Metrics, Logs, Traces, Profiles, Dumps

## 5.1 Metrics

Aggregated numeric signals.

Good for alerts and trends.

## 5.2 Logs

Discrete events with context.

Good for explaining why.

## 5.3 Traces

Request path and timing across services.

Good for distributed waits.

## 5.4 Profiles

Where CPU/allocation/time is spent.

Good for performance.

## 5.5 Dumps

Point-in-time JVM state.

Good for deadlock/thread state.

## 5.6 Main rule

```text
Metrics detect, traces localize, logs explain, dumps reveal waits, profiles quantify hot paths.
```

---

# 6. Thread States

Java thread states:

- `NEW`;
- `RUNNABLE`;
- `BLOCKED`;
- `WAITING`;
- `TIMED_WAITING`;
- `TERMINATED`.

## 6.1 RUNNABLE

May be running or ready to run.

Can also be in native I/O depending JVM/OS representation.

## 6.2 BLOCKED

Waiting to enter monitor/synchronized.

## 6.3 WAITING

Waiting indefinitely for another thread/action.

## 6.4 TIMED_WAITING

Waiting with timeout.

## 6.5 Main rule

```text
Thread state is a clue, not full diagnosis.
Always inspect stack trace and resource metrics.
```

---

# 7. Thread Dumps

Thread dump captures stack traces of threads.

Ways:

```bash
jcmd <pid> Thread.print
jstack <pid>
kill -3 <pid>   # Unix-like, prints to stdout/log
```

In containers, use:

```bash
jcmd 1 Thread.print
```

if Java process is PID 1.

## 7.1 Capture multiple dumps

Take 3 dumps, 5–10 seconds apart.

Why?

- one dump is snapshot;
- multiple dumps show progress or stuckness;
- same stack across dumps indicates stuck/waiting.

## 7.2 Main rule

```text
One thread dump is a photo. Multiple thread dumps are a short video.
```

---

# 8. Reading Thread Dumps

Look for:

## 8.1 Thread name

Name executors meaningfully.

```text
http-worker-...
db-writer-...
case-import-...
```

## 8.2 State

`BLOCKED`, `WAITING`, `TIMED_WAITING`, `RUNNABLE`.

## 8.3 Top stack frame

Where is it stuck?

## 8.4 Locks

```text
waiting to lock <...>
locked <...>
parking to wait for <...>
```

## 8.5 Patterns

Many threads same stack = bottleneck.

## 8.6 Main rule

```text
Thread dump diagnosis is pattern matching across many stacks.
```

---

# 9. Deadlock Detection

`ThreadMXBean` and thread dumps can detect Java monitor/ownable synchronizer deadlocks.

`jcmd Thread.print` may include deadlock information.

## 9.1 Limitations

May not detect:

- DB deadlock outside JVM;
- HTTP dependency circular wait;
- application-level future wait cycle;
- resource pool deadlock.

## 9.2 Main rule

```text
No JVM deadlock found does not mean no liveness bug.
```

---

# 10. Blocked vs Waiting vs Timed Waiting

## 10.1 BLOCKED

Usually monitor lock.

Example:

```text
waiting to lock <0x...>
```

## 10.2 WAITING

Could be:

- `LockSupport.park`;
- `Object.wait`;
- `Future.get`;
- `BlockingQueue.take`;
- `Thread.join`.

## 10.3 TIMED_WAITING

Could be:

- sleep;
- timed poll;
- timed wait;
- timeout-based acquire.

## 10.4 Main rule

```text
BLOCKED points to monitor contention; WAITING points to coordination or resource wait.
```

---

# 11. Executor Observability

For `ThreadPoolExecutor`, expose:

- core pool size;
- max pool size;
- active count;
- pool size;
- queue size;
- remaining queue capacity;
- completed task count;
- rejected task count;
- task duration;
- queue wait duration.

## 11.1 Queue wait

Important metric:

```text
time from submission to start
```

High queue wait means saturation.

## 11.2 Task duration

Time from start to finish.

High task duration means slow work.

## 11.3 Main rule

```text
Executor latency = queue wait + execution time.
Measure both.
```

---

# 12. ForkJoinPool Observability

For ForkJoinPool observe:

- parallelism;
- pool size;
- active thread count;
- running thread count;
- queued task count;
- steal count;
- quiescence;
- common pool usage.

## 12.1 Common pool problem

If parallel streams or CompletableFuture default async slow down, inspect common pool saturation/blocking.

## 12.2 Main rule

```text
ForkJoinPool is for CPU-ish work; blocking tasks in it appear as lost parallelism.
```

---

# 13. Virtual Threads Observability

Virtual threads change observability.

Old assumptions:

```text
thread count high = bad
```

not necessarily true.

Need inspect:

- virtual thread lifecycle;
- pinned events;
- scheduler queue;
- carrier saturation;
- DB/HTTP wait;
- memory footprint;
- ThreadLocal usage.

## 13.1 ThreadMXBean caveat

Some traditional thread MXBean methods focus on platform threads and may not include virtual thread IDs depending method.

## 13.2 Main rule

```text
For virtual-thread apps, observe resources and pinning, not just thread count.
```

---

# 14. Virtual Thread Pinning

Pinning means virtual thread cannot unmount from carrier while blocked.

Symptoms:

- throughput lower than expected;
- carrier threads occupied;
- virtual threads queued;
- JFR `VirtualThreadPinned` events;
- stack traces show problematic blocking region.

## 14.1 Diagnostics

Use JFR.

Also JVM diagnostic options may help in development.

## 14.2 Main rule

```text
Pinning diagnosis is stack-trace driven: find where the virtual thread blocks while carrier cannot be freed.
```

---

# 15. `jcmd` Essentials

Useful commands:

```bash
jcmd
jcmd <pid> help
jcmd <pid> Thread.print
jcmd <pid> GC.heap_info
jcmd <pid> VM.system_properties
jcmd <pid> VM.flags
jcmd <pid> JFR.start name=profile settings=profile duration=60s filename=/tmp/app.jfr
jcmd <pid> JFR.dump name=profile filename=/tmp/app.jfr
jcmd <pid> JFR.stop name=profile
```

## 15.1 Production caution

JFR usually low overhead, but still choose settings/duration carefully.

## 15.2 Main rule

```text
jcmd is the Swiss army knife for live JVM diagnostics.
```

---

# 16. Java Flight Recorder

JFR records runtime events:

- CPU;
- allocation;
- GC;
- locks;
- threads;
- I/O;
- exceptions;
- virtual thread events;
- method profiling.

## 16.1 Why JFR for concurrency

Thread dumps show snapshot.

JFR shows timeline.

## 16.2 Profiles

- continuous recording;
- on-demand recording;
- incident recording.

## 16.3 Main rule

```text
Use JFR when you need temporal evidence: what happened before, during, and after the incident.
```

---

# 17. JFR Events for Concurrency

Relevant event categories can include:

## 17.1 Java monitor blocked

Monitor contention.

## 17.2 Thread park

Waiting via LockSupport.

## 17.3 Execution samples

CPU hotspots.

## 17.4 Socket read/write

I/O waits.

## 17.5 File read/write

File I/O.

## 17.6 Virtual thread events

Start/end/pinned depending JDK/event configuration.

## 17.7 Allocation events

Memory pressure.

## 17.8 Main rule

```text
JFR connects stack traces to durations.
That is exactly what concurrency debugging needs.
```

---

# 18. Lock Contention

Lock contention symptoms:

- many BLOCKED threads;
- high Java monitor blocked time;
- low CPU but high latency;
- hot synchronized method;
- p99 spikes.

## 18.1 What to measure

- lock wait time;
- lock hold time;
- owner stack;
- number of waiters;
- frequency.

## 18.2 Fixes

- reduce critical section;
- split lock;
- immutable snapshots;
- concurrent collections;
- per-key/striped locks;
- avoid I/O under lock.

## 18.3 Main rule

```text
Lock contention is fixed by reducing sharing, scope, or hold time.
```

---

# 19. Monitor Contention

`synchronized` uses monitors.

Thread dump shows:

```text
BLOCKED (on object monitor)
```

JFR monitor events can show duration.

## 19.1 Java 24+/JEP 491 context

Modern JDK improvements reduce virtual-thread pinning related to synchronized, but monitor contention remains logical serialization.

## 19.2 Main rule

```text
Even if monitor blocking becomes virtual-thread-friendly, the critical section is still one-at-a-time.
```

---

# 20. Database Pool Observability

For HikariCP or similar, monitor:

- active connections;
- idle connections;
- pending threads;
- max pool size;
- acquisition time;
- timeout count;
- connection usage duration;
- leak detection;
- query duration;
- transaction duration.

## 20.1 Interpret

Active=max + pending high:

```text
pool saturated
```

Active low + pending high:

```text
pool issue/config/connection creation problem
```

Active=max + DB CPU low:

```text
maybe lock wait / connection leak / network wait
```

## 20.2 Main rule

```text
DB pool metrics must be read together with query and DB-side metrics.
```

---

# 21. HTTP Client and Downstream Observability

Track per downstream:

- in-flight requests;
- connection pool active/idle/pending;
- latency p50/p95/p99;
- timeout count;
- retry count;
- circuit breaker state;
- bulkhead permits;
- rate limit rejection;
- error status;
- DNS/connect/TLS timing if available.

## 21.1 Main rule

```text
Downstream latency must be attributed per dependency, not averaged globally.
```

---

# 22. Queue and Backpressure Observability

For queues:

- depth;
- remaining capacity;
- enqueue rate;
- dequeue rate;
- oldest item age;
- offer timeout;
- rejection/drop count;
- consumer processing duration;
- DLQ count.

## 22.1 Depth alone is insufficient

A queue of 100 may be fine if age < 10ms.

A queue of 10 may be bad if oldest age 5 minutes.

## 22.2 Main rule

```text
Queue age is often more important than queue size.
```

---

# 23. CPU Saturation Diagnostics

CPU 100% can be:

- real useful compute;
- busy loop;
- lock-free spin;
- serialization/deserialization;
- regex;
- encryption/compression;
- GC;
- JIT compilation;
- logging overhead.

## 23.1 Tools

- JFR execution samples;
- async profiler if available;
- OS top/perf;
- thread CPU time;
- flame graphs.

## 23.2 Main rule

```text
CPU saturation diagnosis needs profiling, not thread count guessing.
```

---

# 24. Memory Pressure and Allocation

Concurrency can increase memory via:

- queued tasks;
- virtual thread stacks;
- ThreadLocal values;
- request buffers;
- CompletableFuture graphs;
- retry queues;
- logging buffers;
- result aggregation;
- unbounded collections.

## 24.1 Observe

- heap usage;
- allocation rate;
- GC pause;
- live set;
- queue sizes;
- object histograms;
- heap dumps if needed.

## 24.2 Main rule

```text
Concurrency bugs often manifest as memory pressure from queued or retained work.
```

---

# 25. GC and Concurrency

GC can affect concurrency:

- stop-the-world pauses look like latency spikes;
- GC pressure from allocations reduces throughput;
- many short-lived tasks increase allocation;
- large queues increase live set;
- ThreadLocal leaks increase retained memory.

## 25.1 Observe

- GC pause duration;
- allocation rate;
- promotion rate;
- old gen usage;
- humongous allocations if G1;
- retained objects.

## 25.2 Main rule

```text
When latency spikes, always correlate with GC timeline.
```

---

# 26. Context Propagation Debugging

Symptoms:

- missing correlation ID;
- wrong tenant;
- missing security principal;
- transaction not active;
- MDC missing in async task.

## 26.1 Check boundaries

- `@Async`;
- executor submit;
- CompletableFuture;
- scheduler;
- message listener;
- virtual thread child;
- reactive scheduler switch.

## 26.2 Add assertions

Fail fast for required context.

```java
TenantContext.currentOrThrow()
```

## 26.3 Main rule

```text
Every thread/async boundary is a context propagation boundary.
```

---

# 27. Logging for Concurrent Systems

Good logs include:

- correlation ID;
- request ID;
- tenant;
- user/session if safe;
- operation name;
- resource key;
- attempt number;
- version/fencing token;
- timeout/deadline;
- thread/task name;
- outcome.

## 27.1 Avoid

- logging secrets;
- excessive logs inside hot loops;
- missing correlation;
- high-cardinality metric labels in logs? logs can handle more than metrics but still costly.

## 27.2 Main rule

```text
Logs should reconstruct a single operation timeline across threads.
```

---

# 28. Tracing Concurrent Work

Distributed tracing shows spans.

For fan-out:

```text
parent request span
  -> DB span
  -> HTTP A span
  -> HTTP B span
  -> async child span
```

## 28.1 Important

Async child spans must be linked to parent context.

## 28.2 Span attributes

- dependency name;
- timeout;
- retry attempt;
- queue wait;
- bulkhead wait;
- cancellation status.

## 28.3 Main rule

```text
Tracing should show where time is spent: execution, waiting, queueing, retrying.
```

---

# 29. Metrics Design

Core metric types:

## 29.1 Counter

Events count.

```text
timeouts_total
rejections_total
```

## 29.2 Gauge

Current value.

```text
queue_depth
active_connections
```

## 29.3 Histogram/timer

Distribution.

```text
request_latency
db_connection_wait
```

## 29.4 Main rule

```text
For concurrency, histograms of wait time are more useful than averages.
```

---

# 30. High-Cardinality Pitfalls

Do not label metrics with:

- userId;
- requestId;
- raw URL with IDs;
- tenant if huge number and uncontrolled;
- exception message;
- SQL text;
- thread name if many virtual threads.

## 30.1 Use logs/traces for high-cardinality identifiers

Metrics for bounded dimensions.

## 30.2 Main rule

```text
Metrics labels must be low-cardinality; traces/logs carry high-cardinality context.
```

---

# 31. Debugging Structured Concurrency

Look for:

- parent scope duration;
- child duration;
- child failure;
- sibling cancellation;
- deadline exceeded;
- scope close;
- leaked child tasks impossible if structured correctly, but check blocking children.

## 31.1 Metrics

```text
scope.children.started
scope.children.cancelled
scope.failures
scope.duration
```

## 31.2 Main rule

```text
Structured concurrency should make task tree observable as parent-child spans.
```

---

# 32. Debugging CompletableFuture

Problems:

- future never completed;
- exception swallowed;
- default executor common pool saturated;
- cancellation not propagated;
- callback not running;
- blocking `join` causing starvation.

## 32.1 Inspect

- executor used;
- completion stage graph;
- exceptionally handlers;
- timeout operators;
- thread dumps showing common pool;
- logs per stage.

## 32.2 Main rule

```text
CompletableFuture bugs are often executor, exception, or cancellation propagation bugs.
```

---

# 33. Debugging Parallel Streams

Problems:

- wrong result;
- nondeterministic ordering;
- common pool contention;
- blocking I/O inside stream;
- side effects.

## 33.1 Strategy

- compare sequential result;
- remove side effects;
- check reduction associativity;
- profile common pool;
- benchmark source size/type.

## 33.2 Main rule

```text
If parallel stream is wrong, suspect side effects. If slow, suspect overhead, source, stateful ops, or common pool contention.
```

---

# 34. Debugging Reactive Pipelines

Problems:

- blocking event loop;
- missing backpressure;
- scheduler misuse;
- context loss;
- dropped errors;
- unbounded flatMap concurrency.

## 34.1 Inspect

- operator chain;
- scheduler boundaries;
- concurrency parameter;
- request/demand;
- event-loop blocked metrics;
- reactive context.

## 34.2 Main rule

```text
Reactive debugging is about demand, scheduler, and context boundaries.
```

---

# 35. Debugging Production Without Making It Worse

## 35.1 Avoid heavy actions first

Do not immediately take huge heap dump on memory-stressed production unless necessary.

## 35.2 Prefer low-impact evidence

- metrics snapshot;
- thread dumps;
- short JFR;
- logs around incident;
- DB pool stats.

## 35.3 Coordinate

- notify team;
- record timestamps;
- capture before restart if possible;
- avoid multiple people running heavy diagnostics.

## 35.4 Main rule

```text
Diagnostics should be proportional to incident severity and system headroom.
```

---

# 36. Incident Runbook: Service Stuck

Symptoms:

```text
no progress
requests timeout
CPU low or moderate
```

Steps:

1. Capture timestamp and affected endpoints.
2. Take 3 thread dumps.
3. Check DB pool active/pending.
4. Check executor queues.
5. Check HTTP downstream latency.
6. Check locks/deadlock section.
7. Check queue depths/oldest age.
8. Check recent deployment/config.
9. If virtual threads, check JFR pinned events if available.
10. Mitigate: reduce traffic, disable endpoint, open circuit, restart only after evidence if possible.

## 36.1 Main rule

```text
For stuck service, find what all work is waiting on.
```

---

# 37. Incident Runbook: Latency Spike

Steps:

1. Check p50/p95/p99 by endpoint.
2. Correlate with DB/HTTP latency.
3. Check queue wait vs execution time.
4. Check GC pauses.
5. Check CPU saturation.
6. Check retry/circuit breaker metrics.
7. Compare traces slow vs normal.
8. Look for lock contention/JFR events.
9. Check traffic shape and noisy tenant.
10. Apply mitigation: shed load, reduce concurrency, circuit break slow dependency.

## 37.1 Main rule

```text
Latency spike diagnosis is correlation across time-series signals.
```

---

# 38. Incident Runbook: CPU 100%

Steps:

1. Take short JFR/profile.
2. Identify hot methods.
3. Check request rate and endpoint mix.
4. Check CPU-heavy job/report.
5. Check GC vs application CPU.
6. Check busy loops/spin/retry storm.
7. Check parallel streams/common pool.
8. Reduce CPU work/admission if needed.

## 38.1 Main rule

```text
CPU 100% requires profiling to distinguish useful work from pathological work.
```

---

# 39. Incident Runbook: DB Pool Exhausted

Symptoms:

```text
active=max
pending high
connection timeouts
```

Steps:

1. Check active/idle/pending.
2. Check query duration p99.
3. Check transaction duration.
4. Check DB lock waits/deadlocks.
5. Check connection leaks.
6. Check recent traffic/virtual-thread enablement.
7. Check N+1/query count per request.
8. Check remote call inside transaction.
9. Mitigate: fail fast, reduce concurrency, disable expensive endpoint, kill runaway query if safe.
10. Fix: optimize query, shorten tx, bulkhead, timeout.

## 39.1 Main rule

```text
DB pool exhaustion is either too much demand, too slow release, or leaked connections.
```

---

# 40. Mini Case Study: All Threads Waiting on Future

## 40.1 Symptom

Thread dump:

```text
pool-1-thread-1 WAITING FutureTask.get
pool-1-thread-2 WAITING FutureTask.get
...
```

Executor queue has child tasks.

## 40.2 Cause

Parent tasks occupy all workers and wait for child tasks submitted to same pool.

## 40.3 Fix

- avoid waiting on same bounded pool;
- use structured concurrency;
- separate executor;
- virtual threads for blocking orchestration;
- non-blocking composition.

## 40.4 Lesson

```text
Thread dump plus executor queue reveals thread-pool starvation deadlock.
```

---

# 41. Mini Case Study: Virtual Thread Pinning

## 41.1 Symptom

Virtual threads enabled but throughput low.

JFR shows pinned events.

## 41.2 Diagnosis

Pinned stack points to blocking call inside problematic region.

## 41.3 Fix

- upgrade JDK if monitor pinning issue addressed;
- move blocking outside critical section;
- replace problematic native/blocking library;
- add timeouts;
- reduce concurrency while fixing.

## 41.4 Lesson

```text
Virtual-thread performance bugs need JFR evidence, not guesses.
```

---

# 42. Mini Case Study: Lost Correlation ID in `@Async`

## 42.1 Symptom

Main request logs have correlation ID.

Async logs do not.

## 42.2 Cause

MDC ThreadLocal not propagated to async executor thread.

## 42.3 Fix

- pass explicit context;
- configure TaskDecorator;
- use tracing context propagation;
- clear context after task.

## 42.4 Lesson

```text
Async boundary is context boundary.
```

---

# 43. Common Anti-Patterns

## 43.1 Only average latency

Averages hide p99.

## 43.2 No queue wait metric

Cannot distinguish queueing from execution.

## 43.3 No correlation ID

Logs unusable during concurrency incident.

## 43.4 Thread count alert for virtual threads

Misleading.

## 43.5 No DB pool metrics

Blind to main bottleneck.

## 43.6 Logging inside hot loop

Makes incident worse.

## 43.7 High-cardinality labels

Metrics backend collapse.

## 43.8 Restart before evidence

Root cause lost.

## 43.9 One huge heap dump first

May worsen production.

## 43.10 No cancellation/timeout outcome metrics

Failures invisible.

---

# 44. Best Practices

## 44.1 Name threads/executors/tasks

Useful dumps.

## 44.2 Measure queue wait and execution time separately

For every executor/queue.

## 44.3 Use correlation ID everywhere

Logs, traces, errors.

## 44.4 Monitor resource boundaries

DB, HTTP, queue, semaphore, CPU.

## 44.5 Capture multiple thread dumps

For stuck incidents.

## 44.6 Use JFR for timeline

Especially pinning/lock/CPU/allocation.

## 44.7 Keep metrics low-cardinality

Use traces/logs for IDs.

## 44.8 Build runbooks

Before incident.

## 44.9 Test observability

Break dependency and see dashboard.

## 44.10 Treat timeouts/cancellations as first-class outcomes

Count and trace them.

---

# 45. Decision Matrix

| Symptom | First Evidence |
|---|---|
| Service stuck | 3 thread dumps + DB/executor metrics |
| p99 latency spike | traces + resource wait metrics |
| CPU 100% | JFR/profile |
| DB timeouts | pool active/pending + query/tx metrics |
| Missing context | logs around async boundary |
| Common pool slow | ForkJoin metrics + thread dump |
| Wrong parallel stream result | sequential comparison + side effect audit |
| Virtual threads low throughput | JFR pinning + resource metrics |
| Memory growth | heap metrics + queue sizes + allocation profile |
| Executor saturated | queue wait + active count + rejection |
| Lock contention | thread dump BLOCKED + JFR monitor events |
| Queue backlog | queue age + dequeue rate |
| Retry storm | retry count + downstream latency |

---

# 46. Latihan

## Latihan 1 — Thread Dump Reading

Ambil thread dump dan klasifikasikan 10 thread: RUNNABLE, BLOCKED, WAITING, TIMED_WAITING.

## Latihan 2 — Executor Metrics

Desain metric untuk `ThreadPoolExecutor`: active, queue size, queue wait, task duration, rejected.

## Latihan 3 — DB Pool Dashboard

Buat dashboard DB pool: active, idle, pending, acquisition p99, timeout, tx duration.

## Latihan 4 — JFR Recording

Tulis command `jcmd` untuk merekam JFR 60 detik.

## Latihan 5 — Virtual Thread Pinning

Jelaskan langkah menemukan stack penyebab pinned event.

## Latihan 6 — Context Leak

Buat test yang memastikan MDC/tenant context tidak leak antar request.

## Latihan 7 — Queue Age

Desain metric oldest item age untuk queue worker.

## Latihan 8 — Latency Spike Runbook

Buat runbook 10 langkah untuk p99 spike.

## Latihan 9 — CPU Profile

Buat checklist membedakan CPU app vs GC vs retry storm.

## Latihan 10 — Observability Review

Ambil satu service dan daftar observability gap untuk concurrency incident.

---

# 47. Ringkasan

Observability concurrent Java harus menjawab di mana work running, waiting, queued, failing, atau cancelled.

Core lessons:

- Concurrent bugs sering berupa liveness/latency, bukan exception.
- Observability harus menghubungkan waits across layers.
- Metrics, logs, traces, dumps, and profiles punya fungsi berbeda.
- Thread states adalah clue, bukan diagnosis lengkap.
- Thread dumps harus dibaca sebagai pola banyak stack.
- Ambil multiple thread dumps untuk melihat progress.
- Executor latency = queue wait + execution time.
- ForkJoin common pool contention bisa memengaruhi parallel streams dan CompletableFuture default.
- Virtual-thread apps harus fokus pada pinning/resource waits, bukan sekadar thread count.
- JFR memberi timeline untuk locks, parks, CPU, allocation, I/O, virtual-thread events.
- Lock contention terlihat dari BLOCKED/JFR monitor events.
- DB pool metrics harus dibaca bersama query/transaction/DB-side metrics.
- Queue age sering lebih penting dari queue depth.
- CPU 100% butuh profiling.
- Memory pressure sering berasal dari queued/retained work.
- Context propagation harus dicek pada setiap async/thread boundary.
- Logs harus punya correlation ID dan outcome.
- Metrics labels harus low-cardinality.
- Production diagnostics harus proporsional dan tidak memperburuk incident.
- Runbook harus siap sebelum incident.

Main rule:

```text
To debug concurrent Java, do not ask only “how many threads?”
Ask “what is each unit of work waiting for,
where is it queued, who owns the resource,
and how long has it been there?”
```

---

# 48. Referensi

1. Java SE 25 — `Thread.State`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.State.html

2. Java SE 25 — `ThreadMXBean`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.management/java/lang/management/ThreadMXBean.html

3. Java SE 25 — `ThreadPoolExecutor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html

4. Java SE 25 — `ForkJoinPool`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinPool.html

5. JDK Tools — `jcmd`  
   https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html

6. Java Flight Recorder Runtime Guide  
   https://docs.oracle.com/en/java/javase/25/jfapi/

7. Oracle Java SE 25 Guide — Virtual Threads  
   https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html

8. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

9. OpenJDK JEP 491 — Synchronize Virtual Threads without Pinning  
   https://openjdk.org/jeps/491

10. Micrometer Documentation  
    https://docs.micrometer.io/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 026](./learn-java-concurrency-and-reactive-part-026.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 028](./learn-java-concurrency-and-reactive-part-028.md)

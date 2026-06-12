# learn-java-concurrency-and-reactive-part-005.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 005  
# Thread Pools: Sizing, Queues, Rejection, Saturation, Backpressure, Bulkheads, and Production Capacity Design

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **005**  
> Fokus: memahami thread pool bukan sebagai “tempat menjalankan task”, tetapi sebagai **capacity-control mechanism**. Kita akan membahas pool sizing CPU-bound dan I/O-bound, queue design, bounded vs unbounded queue, rejection policy, backpressure, Little’s Law, saturation, thread starvation, bulkhead, timeout, metrics, dan desain executor production. Bagian ini melanjutkan part 004 tentang Executor Framework dan masuk lebih dalam ke sizing serta overload control.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Thread Pool sebagai Capacity Boundary](#2-mental-model-thread-pool-sebagai-capacity-boundary)
3. [Anatomi `ThreadPoolExecutor`](#3-anatomi-threadpoolexecutor)
4. [Core Pool Size](#4-core-pool-size)
5. [Maximum Pool Size](#5-maximum-pool-size)
6. [Keep Alive Time](#6-keep-alive-time)
7. [Work Queue](#7-work-queue)
8. [ThreadFactory](#8-threadfactory)
9. [RejectedExecutionHandler](#9-rejectedexecutionhandler)
10. [Bagaimana `ThreadPoolExecutor` Memutuskan Menjalankan atau Mengantri Task](#10-bagaimana-threadpoolexecutor-memutuskan-menjalankan-atau-mengantri-task)
11. [Fixed Pool, Cached Pool, Single Pool: Apa Risiko Tersembunyinya](#11-fixed-pool-cached-pool-single-pool-apa-risiko-tersembunyinya)
12. [Unbounded Queue: Kenyamanan yang Berbahaya](#12-unbounded-queue-kenyamanan-yang-berbahaya)
13. [Bounded Queue: Membuat Overload Terlihat](#13-bounded-queue-membuat-overload-terlihat)
14. [Direct Handoff with `SynchronousQueue`](#14-direct-handoff-with-synchronousqueue)
15. [ArrayBlockingQueue vs LinkedBlockingQueue](#15-arrayblockingqueue-vs-linkedblockingqueue)
16. [CPU-Bound Pool Sizing](#16-cpu-bound-pool-sizing)
17. [I/O-Bound Pool Sizing](#17-io-bound-pool-sizing)
18. [Blocking Ratio and Wait/Compute Formula](#18-blocking-ratio-and-waitcompute-formula)
19. [Little’s Law for Thread Pools](#19-littles-law-for-thread-pools)
20. [Queue Wait Time and Tail Latency](#20-queue-wait-time-and-tail-latency)
21. [Saturation](#21-saturation)
22. [Rejection Policies](#22-rejection-policies)
23. [`AbortPolicy`](#23-abortpolicy)
24. [`CallerRunsPolicy`](#24-callerrunspolicy)
25. [`DiscardPolicy` and `DiscardOldestPolicy`](#25-discardpolicy-and-discardoldestpolicy)
26. [Backpressure](#26-backpressure)
27. [Bulkheads](#27-bulkheads)
28. [Thread Starvation](#28-thread-starvation)
29. [Nested Task Deadlock](#29-nested-task-deadlock)
30. [Separate Pools by Workload](#30-separate-pools-by-workload)
31. [Virtual Threads and Pool Sizing](#31-virtual-threads-and-pool-sizing)
32. [Resource Guards with Semaphores](#32-resource-guards-with-semaphores)
33. [Timeouts and Deadlines](#33-timeouts-and-deadlines)
34. [Metrics and Alerts](#34-metrics-and-alerts)
35. [Tuning Process](#35-tuning-process)
36. [Production Config Examples](#36-production-config-examples)
37. [Common Failure Modes](#37-common-failure-modes)
38. [Anti-Patterns](#38-anti-patterns)
39. [Best Practices](#39-best-practices)
40. [Decision Matrix](#40-decision-matrix)
41. [Latihan](#41-latihan)
42. [Ringkasan](#42-ringkasan)
43. [Referensi](#43-referensi)

---

# 1. Tujuan Bagian Ini

Banyak developer membuat executor seperti ini:

```java
ExecutorService executor = Executors.newFixedThreadPool(20);
```

Lalu merasa sudah “aman” karena thread dibatasi 20.

Masalahnya:

```text
Fixed thread pool membatasi jumlah worker thread,
tetapi factory method tersebut memakai shared unbounded queue.
```

Artinya jika task masuk lebih cepat daripada diproses:

```text
thread tetap 20
queue tumbuh
latency naik
memory naik
akhirnya OOM atau timeout storm
```

Bagian ini mengubah cara berpikir:

```text
Thread pool bukan hanya kumpulan thread.
Thread pool adalah boundary kapasitas, antrian, dan overload policy.
```

Target:

- memahami parameter `ThreadPoolExecutor`;
- memahami interaksi pool size dan queue;
- tahu risiko unbounded queue;
- bisa sizing CPU-bound dan I/O-bound workloads;
- memahami saturation dan tail latency;
- memilih rejection policy;
- mendesain backpressure;
- memisahkan workload dengan bulkhead;
- memahami thread starvation dan nested task deadlock;
- memahami bagaimana virtual threads mengubah sizing thread tetapi bukan resource capacity;
- membuat executor production dengan metrics dan alert.

---

# 2. Mental Model: Thread Pool sebagai Capacity Boundary

Thread pool menjawab:

```text
Berapa banyak task yang boleh berjalan sekaligus?
Berapa banyak task yang boleh menunggu?
Apa yang terjadi saat kapasitas penuh?
Bagaimana task dibatalkan saat shutdown?
Bagaimana kita melihat overload?
```

## 2.1 Pool bukan hanya performance optimization

Pool adalah control mechanism.

Jika tidak ada pool atau limit:

```text
producer dapat membuat task tak terbatas
```

Jika ada pool tapi queue tidak dibatasi:

```text
producer tetap dapat membuat backlog tak terbatas
```

Jika pool dan queue dibatasi:

```text
sistem bisa mengatakan “tidak” saat overload
```

## 2.2 Thread pool sebagai valve

Bayangkan air:

```text
producer = pompa air
thread pool = pipa
queue = bak penampung
consumer/downstream = saluran keluar
```

Jika pompa lebih cepat dari saluran keluar:

- bak penuh;
- harus ada overflow policy;
- kalau tidak, banjir.

Dalam software:

- queue penuh;
- reject/backpressure;
- kalau tidak, memory/latency banjir.

## 2.3 Main rule

```text
A thread pool should define both execution capacity and waiting capacity.
```

---

# 3. Anatomi `ThreadPoolExecutor`

Constructor utama:

```java
ExecutorService executor = new ThreadPoolExecutor(
    int corePoolSize,
    int maximumPoolSize,
    long keepAliveTime,
    TimeUnit unit,
    BlockingQueue<Runnable> workQueue,
    ThreadFactory threadFactory,
    RejectedExecutionHandler handler
);
```

Masing-masing parameter adalah keputusan desain.

## 3.1 `corePoolSize`

Jumlah worker baseline.

## 3.2 `maximumPoolSize`

Jumlah maksimum worker.

## 3.3 `keepAliveTime`

Berapa lama worker di atas core boleh idle sebelum dihentikan.

## 3.4 `workQueue`

Tempat task menunggu.

## 3.5 `threadFactory`

Cara membuat/naming/configure thread.

## 3.6 `handler`

Apa yang terjadi saat task ditolak.

## 3.7 Main rule

```text
ThreadPoolExecutor is not an implementation detail.
It is your execution policy written as code.
```

---

# 4. Core Pool Size

`corePoolSize` adalah jumlah worker utama.

## 4.1 Behavior

Jika jumlah running workers kurang dari core, executor cenderung membuat worker baru untuk task baru.

## 4.2 Core worker can stay alive

Secara default, core threads tetap hidup walaupun idle.

## 4.3 `allowCoreThreadTimeOut`

Bisa membuat core threads timeout juga:

```java
ThreadPoolExecutor pool = ...
pool.allowCoreThreadTimeOut(true);
```

## 4.4 Choosing core size

Tergantung workload:

- CPU-bound;
- I/O-bound;
- scheduled;
- priority;
- latency target;
- downstream capacity.

## 4.5 Main rule

```text
corePoolSize is the steady-state execution capacity.
```

---

# 5. Maximum Pool Size

`maximumPoolSize` adalah jumlah maksimum worker.

## 5.1 It may not matter with unbounded queue

Jika queue unbounded, task akan masuk queue setelah core penuh. Akibatnya executor tidak perlu membuat thread di atas core.

Dokumentasi `ThreadPoolExecutor` Java SE 25 menjelaskan bahwa unbounded queue seperti `LinkedBlockingQueue` tanpa kapasitas membuat task baru menunggu di queue ketika semua core threads sibuk, sehingga tidak lebih dari `corePoolSize` threads yang dibuat dan `maximumPoolSize` tidak berpengaruh. 

## 5.2 It matters with bounded queue or direct handoff

Jika queue penuh, executor bisa membuat thread hingga maximum.

## 5.3 Danger of large max

Maximum terlalu besar bisa:

- membuat terlalu banyak platform threads;
- menaikkan context switch;
- membanjiri downstream;
- memperburuk latency.

## 5.4 Main rule

```text
maximumPoolSize only helps if queue policy allows growth beyond core.
```

---

# 6. Keep Alive Time

`keepAliveTime` mengatur idle lifetime untuk threads di atas core.

## 6.1 Use case

Cached-like pools:

- grow during burst;
- shrink after idle.

## 6.2 For fixed pool

Usually irrelevant because core=max and extra threads do not exist.

## 6.3 Main rule

```text
keepAliveTime controls burst worker retention, not task timeout.
```

---

# 7. Work Queue

Queue adalah tempat task menunggu sebelum dieksekusi.

`BlockingQueue` implementations are thread-safe and queueing methods achieve their effects atomically using internal locks or other concurrency control according to Java SE 25 docs. 

Common queues:

- `ArrayBlockingQueue`;
- `LinkedBlockingQueue`;
- `SynchronousQueue`;
- `PriorityBlockingQueue`;
- `DelayQueue`.

## 7.1 Queue is not free

Every queued task retains:

- task object;
- captured references;
- context;
- payload;
- potential large object graphs.

## 7.2 Queue affects latency

Queueing means waiting.

Task latency:

```text
queue wait time + execution time
```

## 7.3 Main rule

```text
Queue capacity is part of your latency and memory budget.
```

---

# 8. ThreadFactory

ThreadFactory should set:

- name;
- daemon flag;
- uncaught exception handler;
- sometimes priority;
- platform vs virtual.

Example:

```java
ThreadFactory factory = Thread.ofPlatform()
    .name("invoice-worker-", 1)
    .daemon(false)
    .uncaughtExceptionHandler((thread, error) ->
        log.error("Thread {} failed", thread.getName(), error)
    )
    .factory();
```

## 8.1 Main rule

```text
Unnamed executor threads are an observability failure.
```

---

# 9. RejectedExecutionHandler

Handler decides what happens when executor cannot accept task.

Common policies:

- abort;
- caller-runs;
- discard;
- discard-oldest;
- custom.

## 9.1 Rejection is backpressure point

Rejection means:

```text
system is saturated or shutting down
```

It should not be ignored.

## 9.2 Main rule

```text
RejectedExecutionHandler is your overload policy.
```

---

# 10. Bagaimana `ThreadPoolExecutor` Memutuskan Menjalankan atau Mengantri Task

Simplified logic:

```text
1. If running workers < corePoolSize:
      create new worker
2. Else try to queue task
3. If queue full and workers < maximumPoolSize:
      create extra worker
4. Else reject task
```

## 10.1 Why this matters

With unbounded queue:

```text
step 2 almost always succeeds
step 3 rarely happens
maximumPoolSize irrelevant
```

With bounded queue:

```text
queue can fill
pool can grow to maximum
then reject
```

With `SynchronousQueue`:

```text
queue cannot store
task must handoff to worker or create worker/reject
```

## 10.2 Main rule

```text
Pool sizing cannot be understood without queue behavior.
```

---

# 11. Fixed Pool, Cached Pool, Single Pool: Apa Risiko Tersembunyinya

## 11.1 Fixed pool

```java
Executors.newFixedThreadPool(n)
```

Java SE docs describe it as reusing a fixed number of threads operating off a shared unbounded queue. 

Risk:

```text
bounded threads, unbounded queue
```

## 11.2 Cached pool

```java
Executors.newCachedThreadPool()
```

Risk:

```text
potentially too many platform threads under load
```

## 11.3 Single thread executor

```java
Executors.newSingleThreadExecutor()
```

Risk:

```text
strict order but one stuck task blocks all
unbounded queue
```

## 11.4 Main rule

```text
Convenient Executors factories hide important capacity decisions.
```

---

# 12. Unbounded Queue: Kenyamanan yang Berbahaya

Unbounded queue feels safe because submission rarely fails.

But overload is hidden.

## 12.1 What happens

```text
incoming rate > processing rate
queue grows
queue wait time grows
tasks become stale
memory grows
timeouts happen
retry storm starts
```

## 12.2 Example

```java
ExecutorService executor = Executors.newFixedThreadPool(20);

for (Request request : incoming) {
    executor.submit(() -> process(request));
}
```

If each task takes 1s and 1000 tasks/sec arrive:

```text
capacity ≈ 20 tasks/sec
arrival = 1000 tasks/sec
backlog grows 980/sec
```

## 12.3 When unbounded queue may be acceptable

Rarely, when:

- producer rate is naturally bounded;
- task count is small;
- workload independent;
- memory impact understood;
- queue metrics and outer admission control exist.

## 12.4 Main rule

```text
Unbounded queue turns overload into latency and memory growth.
```

---

# 13. Bounded Queue: Membuat Overload Terlihat

Bounded queue has capacity:

```java
new ArrayBlockingQueue<>(1000)
```

When full, executor must:

- create more threads up to max;
- reject;
- caller runs;
- block externally if using custom submission logic.

## 13.1 Benefit

- memory bounded;
- overload visible;
- backpressure possible;
- latency capped more realistically.

## 13.2 Cost

You must design rejection.

## 13.3 Example production executor

```java
ExecutorService executor = new ThreadPoolExecutor(
    16,
    32,
    30,
    TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(500),
    Thread.ofPlatform().name("payment-worker-", 1).factory(),
    new ThreadPoolExecutor.AbortPolicy()
);
```

## 13.4 Main rule

```text
Bounded queues force you to confront overload honestly.
```

---

# 14. Direct Handoff with `SynchronousQueue`

`SynchronousQueue` has no internal capacity.

Task handoff must meet worker directly.

## 14.1 Behavior

If no worker available:

- create worker if below max;
- otherwise reject.

## 14.2 Use case

- cached pools;
- direct handoff;
- avoid queueing;
- tasks should not wait in executor queue.

## 14.3 Risk

Can create many threads if max large.

## 14.4 Main rule

```text
SynchronousQueue trades queueing for thread growth or rejection.
```

---

# 15. ArrayBlockingQueue vs LinkedBlockingQueue

## 15.1 ArrayBlockingQueue

Java SE 25 docs describe `ArrayBlockingQueue` as a bounded FIFO blocking queue backed by an array. 

Properties:

- fixed capacity;
- array-backed;
- predictable memory;
- FIFO;
- optional fairness constructor.

## 15.2 LinkedBlockingQueue

Linked queue can be optionally bounded. Without specified capacity, it can be effectively very large.

Properties:

- linked nodes;
- can be bounded or unbounded depending constructor;
- extra node allocation.

## 15.3 Practical guidance

For production executor queue:

```java
new ArrayBlockingQueue<>(capacity)
```

is often a good explicit bounded default.

If using `LinkedBlockingQueue`, specify capacity:

```java
new LinkedBlockingQueue<>(capacity)
```

## 15.4 Main rule

```text
Always know your queue capacity.
If you cannot name it, you probably did not design it.
```

---

# 16. CPU-Bound Pool Sizing

CPU-bound tasks spend most time executing CPU instructions.

Examples:

- compression;
- encryption;
- image processing;
- JSON parsing huge payloads;
- report computation;
- sorting;
- CPU-heavy validation.

## 16.1 Rule of thumb

```text
pool size ≈ number of CPU cores
```

Maybe slightly less or more depending GC, OS, other services.

## 16.2 Why not 100 threads on 8 cores?

Only 8-ish can run at once.

Too many runnable threads cause:

- context switching;
- CPU cache misses;
- worse throughput;
- higher tail latency.

## 16.3 Example

```java
int cores = Runtime.getRuntime().availableProcessors();

ExecutorService cpuPool = new ThreadPoolExecutor(
    cores,
    cores,
    0L,
    TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue<>(cores * 100),
    Thread.ofPlatform().name("cpu-worker-", 1).factory(),
    new ThreadPoolExecutor.AbortPolicy()
);
```

## 16.4 Main rule

```text
CPU-bound pools should be sized around CPU cores, not request volume.
```

---

# 17. I/O-Bound Pool Sizing

I/O-bound tasks spend much time waiting.

Examples:

- DB calls;
- HTTP calls;
- S3 calls;
- file I/O;
- Redis calls.

## 17.1 Platform-thread pool sizing

For platform threads, pool size can be larger than cores because many threads wait.

But it must respect:

- DB pool;
- HTTP connection pool;
- downstream rate limit;
- memory;
- latency target.

## 17.2 Virtual threads

For many blocking I/O tasks, virtual threads are often better than huge platform pools.

But still guard external resource.

## 17.3 Main rule

```text
I/O-bound concurrency should be sized by downstream capacity and latency target,
not only CPU cores.
```

---

# 18. Blocking Ratio and Wait/Compute Formula

A common heuristic:

```text
threads ≈ cores × (1 + wait_time / compute_time)
```

Example:

```text
cores = 8
compute = 10ms
wait = 90ms
threads ≈ 8 × (1 + 90/10)
        = 8 × 10
        = 80
```

This suggests 80 platform threads may keep CPU busy if tasks wait 90% of time.

## 18.1 Caveat

This is a heuristic, not law.

It ignores:

- downstream capacity;
- memory;
- lock contention;
- GC;
- variable latency;
- queueing;
- external rate limits.

## 18.2 With virtual threads

You do not size virtual thread pool by this formula.

You size:

- DB pool;
- HTTP pool;
- semaphore;
- rate limiter;
- admission queue.

## 18.3 Main rule

```text
Wait/compute formula estimates useful platform-thread concurrency,
but resource capacity still wins.
```

---

# 19. Little’s Law for Thread Pools

Little’s Law:

```text
L = λ × W
```

For service:

```text
concurrency = throughput × latency
```

Example:

```text
arrival rate = 200 requests/sec
average processing time = 100ms = 0.1s
concurrency ≈ 20
```

If processing time rises to 1s:

```text
concurrency ≈ 200
```

## 19.1 Pool interpretation

If pool has 20 workers and each task takes 100ms:

```text
capacity ≈ 20 / 0.1s = 200 tasks/sec
```

If task time becomes 1s:

```text
capacity ≈ 20 / 1s = 20 tasks/sec
```

## 19.2 Queue growth

If arrival > capacity:

```text
queue grows
```

## 19.3 Main rule

```text
Thread pool throughput is limited by worker count divided by task duration.
```

---

# 20. Queue Wait Time and Tail Latency

Response time includes:

```text
queue wait + execution time + downstream wait
```

If queue grows, p95/p99 latency grows.

## 20.1 Hidden latency

A task may be fast once started, but wait long in queue.

## 20.2 Example

```text
execution time = 50ms
queue wait p99 = 3s
user latency p99 ≈ 3.05s
```

## 20.3 Queue age metric

Queue size alone is not enough.

Track:

```text
oldest task age
queue wait duration
```

## 20.4 Main rule

```text
Queueing is latency.
Bound and measure it.
```

---

# 21. Saturation

Saturation means executor cannot keep up.

Signs:

- active threads == max;
- queue increasing;
- queue wait increasing;
- rejection count > 0;
- task duration rising;
- caller timeouts;
- CPU high or downstream saturated.

## 21.1 Saturated CPU pool

CPU high, workers busy.

## 21.2 Saturated I/O pool

CPU may be low, workers blocked.

## 21.3 Saturated queue

Queue full, rejections.

## 21.4 Main rule

```text
Saturation diagnosis starts with: are workers running, waiting, blocked, or queued?
```

---

# 22. Rejection Policies

When saturated, decide what happens.

## 22.1 Rejection is normal

In resilient systems, rejecting is sometimes better than accepting work that will time out anyway.

## 22.2 Policies

- fail fast;
- caller runs;
- discard;
- discard oldest;
- custom degrade;
- enqueue elsewhere;
- return 429/503;
- schedule retry later.

## 22.3 Main rule

```text
A rejected task is not necessarily failure.
It is controlled admission.
```

---

# 23. `AbortPolicy`

Default in explicit `ThreadPoolExecutor`.

Throws `RejectedExecutionException`.

## 23.1 Good for

- request/response systems;
- fail-fast overload;
- upstream can retry/backoff;
- clear observability.

## 23.2 Example

```java
try {
    executor.execute(task);
} catch (RejectedExecutionException e) {
    metrics.incrementRejected();
    throw new ServiceOverloadedException();
}
```

## 23.3 Main rule

```text
AbortPolicy is honest overload.
Handle it and surface meaningful response.
```

---

# 24. `CallerRunsPolicy`

Caller executes task when executor saturated.

## 24.1 Effect

Slows down submitter.

This can create backpressure.

## 24.2 Good for

- non-latency-sensitive producers;
- batch pipelines;
- when caller can safely do work.

## 24.3 Dangerous for

- event loop threads;
- request threads with strict latency;
- lock-holding callers;
- scheduler threads.

## 24.4 Main rule

```text
CallerRunsPolicy is backpressure only if caller is allowed to slow down.
```

---

# 25. `DiscardPolicy` and `DiscardOldestPolicy`

## 25.1 DiscardPolicy

Silently drops new task.

Dangerous.

Use only for:

- telemetry samples;
- best-effort refresh;
- lossy signals.

## 25.2 DiscardOldestPolicy

Drops oldest queued task and retries submission.

Dangerous for ordered/business tasks.

## 25.3 Required if used

- metrics;
- explicit documentation;
- only discardable work.

## 25.4 Main rule

```text
Never silently discard business work.
```

---

# 26. Backpressure

Backpressure tells producers to slow down or stop.

## 26.1 Thread-pool backpressure

- bounded queue;
- rejection;
- caller-runs;
- semaphore before submit;
- rate limiter.

## 26.2 HTTP backpressure

- 429 Too Many Requests;
- 503 Service Unavailable;
- Retry-After;
- max in-flight requests.

## 26.3 Batch backpressure

- smaller chunks;
- limited concurrency;
- pause reading input;
- bounded channel.

## 26.4 Message consumer backpressure

- pause consumption;
- reduce poll;
- commit carefully;
- scale consumers.

## 26.5 Main rule

```text
Backpressure is a system-wide contract, not just executor configuration.
```

---

# 27. Bulkheads

Bulkhead isolates workloads.

Ship analogy:

```text
If one compartment floods, whole ship does not sink.
```

In services:

```text
payment executor
email executor
report executor
case-query executor
```

If report tasks saturate, payment should still work.

## 27.1 Without bulkhead

Shared executor:

```text
slow reports occupy all workers
login/payment tasks wait
whole service degrades
```

## 27.2 With bulkhead

Separate pools/limits:

```text
report pool saturated
payment pool unaffected
```

## 27.3 Bulkhead types

- separate executor;
- separate queue;
- semaphore per downstream;
- connection pool partitioning;
- rate limit per tenant;
- circuit breaker per dependency.

## 27.4 Main rule

```text
Do not let non-critical workload consume critical workload capacity.
```

---

# 28. Thread Starvation

Thread starvation happens when tasks cannot get threads.

## 28.1 Causes

- pool too small;
- long blocking tasks;
- deadlock/nested submit;
- high priority workload occupying shared pool;
- unbounded queue of slow tasks;
- blocking inside event loop/common pool.

## 28.2 Symptoms

- tasks queued forever;
- timeouts;
- low CPU but high latency;
- thread dump shows all workers waiting on I/O/locks;
- queue depth increases.

## 28.3 Main rule

```text
Thread starvation often means all workers are waiting for something else.
Find what they wait for.
```

---

# 29. Nested Task Deadlock

Classic bug:

```java
ExecutorService executor = Executors.newFixedThreadPool(1);

Future<String> outer = executor.submit(() -> {
    Future<String> inner = executor.submit(() -> "inner");
    return inner.get();
});

System.out.println(outer.get());
```

What happens?

```text
one worker runs outer
outer waits for inner
inner queued
no worker available
deadlock
```

## 29.1 With larger pool

Still possible if all workers submit nested tasks and wait.

## 29.2 Fixes

- avoid blocking inside same bounded executor;
- use separate executor;
- restructure using CompletableFuture;
- use structured concurrency;
- increase capacity only if model safe;
- direct call if dependency is sequential.

## 29.3 Main rule

```text
Do not submit to the same bounded executor and wait inside its worker unless capacity is proven.
```

---

# 30. Separate Pools by Workload

Common separation:

## 30.1 CPU pool

For CPU-heavy work.

Size around cores.

## 30.2 Blocking I/O pool

If using platform threads for blocking I/O.

Size by downstream/latency.

## 30.3 Scheduled pool

For timed jobs.

## 30.4 Critical pool

For critical low-latency tasks.

## 30.5 Bulk/background pool

For non-critical jobs.

## 30.6 Virtual-thread executor

For many blocking request-scoped tasks.

## 30.7 Main rule

```text
Separate pools when workloads have different latency, resource, or criticality profiles.
```

---

# 31. Virtual Threads and Pool Sizing

Virtual threads change thread sizing.

## 31.1 Do not pool virtual threads

Use:

```java
Executors.newVirtualThreadPerTaskExecutor()
```

## 31.2 What to size instead

- DB pool;
- HTTP connection pool;
- semaphore per downstream;
- request admission;
- memory;
- CPU executor for CPU-heavy work.

## 31.3 CPU-heavy virtual threads

If you create 10,000 CPU-bound virtual threads on 8 cores:

```text
not faster
many runnable tasks
scheduler overhead
```

## 31.4 Blocking I/O virtual threads

If 10,000 tasks mostly wait:

```text
works better than 10,000 platform threads
but downstream and memory still matter
```

## 31.5 Main rule

```text
Virtual threads remove the need to size thread pools for blocking waits,
but not the need to size resource access.
```

---

# 32. Resource Guards with Semaphores

When virtual threads make tasks cheap, use semaphores to guard scarce resources.

## 32.1 Example: downstream HTTP limit

```java
final class LimitedClient {
    private final Semaphore permits = new Semaphore(100);
    private final RemoteClient client;

    Response call(Request request) throws Exception {
        if (!permits.tryAcquire(200, TimeUnit.MILLISECONDS)) {
            throw new ServiceOverloadedException("remote-client saturated");
        }

        try {
            return client.call(request);
        } finally {
            permits.release();
        }
    }
}
```

## 32.2 Example: CPU section inside virtual request

```java
ExecutorService cpuPool = Executors.newFixedThreadPool(
    Runtime.getRuntime().availableProcessors()
);
```

Use CPU pool for CPU-heavy part, not unlimited virtual threads.

## 32.3 Main rule

```text
With virtual threads, semaphores and pools protect scarce downstream resources.
```

---

# 33. Timeouts and Deadlines

Thread pools without timeouts create stuck systems.

## 33.1 Task timeout

```java
future.get(500, TimeUnit.MILLISECONDS);
```

## 33.2 Queue timeout

If using explicit queue:

```java
queue.offer(task, 100, TimeUnit.MILLISECONDS);
```

## 33.3 Downstream timeout

HTTP/DB clients should have timeouts.

## 33.4 Deadline

Pass remaining request budget to subtasks.

## 33.5 Main rule

```text
Timeouts cap waiting.
Deadlines coordinate multiple waits under one request budget.
```

---

# 34. Metrics and Alerts

Minimum executor metrics:

## 34.1 Thread metrics

- pool size;
- active count;
- largest pool size.

## 34.2 Queue metrics

- current size;
- remaining capacity;
- oldest task age;
- queue wait time.

## 34.3 Task metrics

- submitted;
- started;
- completed;
- failed;
- cancelled;
- rejected;
- execution duration.

## 34.4 Saturation metrics

- active/max ratio;
- queue usage ratio;
- rejection rate.

## 34.5 Alerts

Alert on:

- sustained queue > 80%;
- rejection rate > threshold;
- oldest task age > SLA;
- active == max sustained;
- task duration p99 spike;
- shutdown timeout.

## 34.6 Main rule

```text
Monitor saturation before users report latency.
```

---

# 35. Tuning Process

Do not guess forever.

## 35.1 Step 1: classify workload

CPU-bound, I/O-bound, mixed.

## 35.2 Step 2: identify bottleneck

CPU, DB, HTTP, lock, queue, memory.

## 35.3 Step 3: set initial limits

Pool size, queue size, timeout, rejection.

## 35.4 Step 4: load test

Use realistic concurrency and latency.

## 35.5 Step 5: observe

CPU, heap, GC, thread dump, pool metrics, DB metrics.

## 35.6 Step 6: adjust

Increase/decrease pool/queue/resource limits.

## 35.7 Step 7: define alerts

Prevent future blind incidents.

## 35.8 Main rule

```text
Thread pool tuning is empirical capacity engineering,
not copy-paste configuration.
```

---

# 36. Production Config Examples

## 36.1 CPU-bound pool

```java
int cores = Runtime.getRuntime().availableProcessors();

ExecutorService cpuPool = new ThreadPoolExecutor(
    cores,
    cores,
    0L,
    TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue<>(cores * 100),
    Thread.ofPlatform().name("cpu-worker-", 1).factory(),
    new ThreadPoolExecutor.AbortPolicy()
);
```

## 36.2 Blocking I/O platform pool

```java
ExecutorService ioPool = new ThreadPoolExecutor(
    32,
    64,
    30,
    TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1000),
    Thread.ofPlatform().name("io-worker-", 1).factory(),
    new ThreadPoolExecutor.AbortPolicy()
);
```

## 36.3 Virtual thread executor with resource guard

```java
Semaphore dbPermits = new Semaphore(50);

try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<Result> future = executor.submit(() -> {
        if (!dbPermits.tryAcquire(100, TimeUnit.MILLISECONDS)) {
            throw new ServiceOverloadedException("DB saturated");
        }

        try {
            return repository.query();
        } finally {
            dbPermits.release();
        }
    });

    return future.get(1, TimeUnit.SECONDS);
}
```

## 36.4 Scheduled safe task

```java
ScheduledExecutorService scheduler =
    Executors.newScheduledThreadPool(
        2,
        Thread.ofPlatform().name("scheduler-", 1).factory()
    );

scheduler.scheduleWithFixedDelay(
    () -> {
        try {
            cleanup();
        } catch (Throwable t) {
            log.error("cleanup failed", t);
        }
    },
    0,
    1,
    TimeUnit.MINUTES
);
```

## 36.5 Main rule

```text
Every production executor config should reveal its capacity policy.
```

---

# 37. Common Failure Modes

## 37.1 OOM from unbounded queue

Fixed pool with infinite backlog.

## 37.2 Latency explosion

Queue wait dominates.

## 37.3 Native thread OOM

Cached pool creates too many platform threads.

## 37.4 DB pool starvation

Too many worker tasks wait for DB connections.

## 37.5 Thread starvation deadlock

Nested submit/get in same bounded pool.

## 37.6 Critical workload blocked by background workload

No bulkhead.

## 37.7 Silent data loss

DiscardPolicy used for business tasks.

## 37.8 Event loop blocked by CallerRunsPolicy

Caller thread unexpectedly runs slow task.

## 37.9 Scheduled task stops

Exception suppresses future runs.

## 37.10 Virtual thread flood overwhelms downstream

No semaphore/rate limit.

---

# 38. Anti-Patterns

## 38.1 “Use fixed pool, done”

Without queue/rejection/metrics.

## 38.2 Unbounded queue for untrusted load

Memory risk.

## 38.3 Huge pool for slow DB

DB gets worse.

## 38.4 One shared executor for everything

No isolation.

## 38.5 Blocking inside CPU pool

CPU tasks starved.

## 38.6 CPU-heavy work on unlimited virtual threads

No speedup, more scheduling overhead.

## 38.7 Ignoring RejectedExecutionException

Overload mishandled.

## 38.8 Using DiscardPolicy casually

Silent data loss.

## 38.9 No queue wait metrics

Latency source hidden.

## 38.10 Tuning without load test

Guesswork.

---

# 39. Best Practices

## 39.1 Explicitly choose queue capacity

No accidental unbounded queues.

## 39.2 Separate workload pools

Use bulkheads.

## 39.3 Size CPU pools around cores

Benchmark and observe.

## 39.4 Size I/O concurrency around downstream

DB/HTTP/rate limits.

## 39.5 Use bounded queues

Expose overload.

## 39.6 Handle rejection

Return 429/503, backpressure, retry later, or degrade.

## 39.7 Measure queue wait

Queue size alone is insufficient.

## 39.8 Use virtual threads for blocking I/O

But guard external resources.

## 39.9 Avoid nested blocking submits

Prevent starvation deadlock.

## 39.10 Treat executor config as architecture

Review it like DB schema or API contract.

---

# 40. Decision Matrix

| Workload / Constraint | Pool Strategy |
|---|---|
| CPU-bound | fixed platform pool ≈ cores |
| Short blocking I/O moderate load | bounded platform I/O pool |
| Massive blocking I/O | virtual threads + resource guards |
| Strict ordering | single-thread/keyed executor |
| Periodic task | scheduled executor with safe wrapper |
| Best-effort telemetry | bounded pool + discard with metrics maybe |
| Business-critical task | bounded queue + abort/retry/durable queue |
| Slow downstream | semaphore/bulkhead + timeout |
| High-priority workload | separate executor |
| Batch pipeline | bounded queues + caller-runs/backpressure possible |
| Event loop caller | avoid CallerRunsPolicy |
| Unknown/untrusted load | bounded everything |
| Request fan-out | virtual threads/structured concurrency + deadline |
| Durable async work | external queue, not only in-memory executor |

---

# 41. Latihan

## Latihan 1 — Fixed Pool Risk

Jelaskan kenapa `Executors.newFixedThreadPool(10)` masih bisa OOM.

## Latihan 2 — Compute Capacity

Pool 20 threads, average task duration 200ms. Approx throughput capacity berapa task/sec?

## Latihan 3 — Little’s Law

Arrival 500 task/sec, latency 100ms. Approx concurrency? Jika latency naik 1s, concurrency berapa?

## Latihan 4 — CPU Pool

Machine 8 cores. Desain CPU-bound executor config awal.

## Latihan 5 — I/O Pool

Task call downstream dengan average wait 90ms dan compute 10ms di machine 8 cores. Hitung heuristic thread count. Lalu jelaskan kenapa downstream limit tetap lebih penting.

## Latihan 6 — Rejection Policy

Pilih rejection policy untuk:
1. payment command;
2. metrics sample;
3. batch import chunk;
4. event loop submitted task.

## Latihan 7 — Nested Deadlock

Reproduce nested submit deadlock dengan fixed pool size 1.

## Latihan 8 — Bulkhead

Desain executor separation untuk service dengan login, report, notification, and audit workloads.

## Latihan 9 — Virtual Thread Guard

Buat pseudo-code virtual thread executor dengan semaphore limit 50 untuk DB.

## Latihan 10 — Metrics Plan

Buat daftar metrics untuk executor `case-report-worker`.

---

# 42. Ringkasan

Thread pool adalah capacity-control mechanism.

Core lessons:

- `ThreadPoolExecutor` config merepresentasikan execution policy.
- `corePoolSize`, `maximumPoolSize`, `workQueue`, dan rejection handler harus dipahami bersama.
- Dengan unbounded queue, `maximumPoolSize` sering tidak berpengaruh.
- Fixed thread pool membatasi threads, bukan queued tasks.
- Cached thread pool bisa membuat terlalu banyak platform threads.
- Single-thread executor memberi ordering tetapi bisa backlog.
- Queueing adalah latency.
- Bounded queue membuat overload terlihat.
- Rejection adalah overload signal.
- `AbortPolicy` cocok untuk fail-fast overload.
- `CallerRunsPolicy` bisa menjadi backpressure jika caller aman untuk diperlambat.
- Discard policy hanya untuk task discardable.
- CPU-bound pool sebaiknya sekitar jumlah cores.
- I/O-bound concurrency harus mempertimbangkan downstream capacity.
- Little’s Law membantu memahami hubungan throughput, latency, dan concurrency.
- Saturation terlihat dari active threads, queue, rejection, duration, dan resource metrics.
- Bulkhead mencegah satu workload merusak workload lain.
- Nested submit/get bisa deadlock di bounded executor.
- Virtual threads mengubah sizing thread, tetapi resource guard tetap wajib.
- Executor production perlu metrics dan alert.

Main rule:

```text
Thread pool design is capacity design:
how much can run, how much can wait,
what happens when full, and how we know it is saturated.
```

---

# 43. Referensi

1. Java SE 25 — `ThreadPoolExecutor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html

2. Java SE 25 — `Executors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html

3. Java SE 25 — `BlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html

4. Java SE 25 — `ArrayBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ArrayBlockingQueue.html

5. Java SE 25 — `LinkedBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/LinkedBlockingQueue.html

6. Java SE 25 — `SynchronousQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/SynchronousQueue.html

7. Java SE 25 — `RejectedExecutionHandler`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/RejectedExecutionHandler.html

8. Java SE 25 — `Semaphore`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html

9. Java SE 25 — `Executors.newVirtualThreadPerTaskExecutor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html#newVirtualThreadPerTaskExecutor()

10. OpenJDK JEP 444 — Virtual Threads  
    https://openjdk.org/jeps/444

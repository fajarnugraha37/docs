# learn-java-concurrency-and-reactive-part-022.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 022  
# Parallelism: CPU-Bound Work, ForkJoinPool, Work Stealing, Task Granularity, and Parallel Algorithm Design

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **022**  
> Fokus: memahami **parallelism** untuk workload CPU-bound di Java. Bagian sebelumnya banyak membahas concurrency untuk I/O, virtual threads, producer-consumer, dan backpressure. Bagian ini fokus ke cara memecah kerja CPU agar berjalan paralel di banyak core dengan benar: `ForkJoinPool`, work stealing, task splitting, granularity, threshold, `RecursiveTask`, `RecursiveAction`, `CompletableFuture` executor choice, parallel streams, common pool, blocking pitfalls, false sharing, memory bandwidth, reduction, associativity, dan desain algoritma parallel yang production-ready.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Concurrency vs Parallelism](#2-concurrency-vs-parallelism)
3. [CPU-Bound vs I/O-Bound](#3-cpubound-vs-iobound)
4. [Kenapa Virtual Threads Bukan Solusi CPU-Bound](#4-kenapa-virtual-threads-bukan-solusi-cpubound)
5. [Mental Model CPU Parallelism](#5-mental-model-cpu-parallelism)
6. [Amdahl's Law](#6-amdahls-law)
7. [Work, Span, and Parallelism](#7-work-span-and-parallelism)
8. [Task Decomposition](#8-task-decomposition)
9. [Task Granularity](#9-task-granularity)
10. [ForkJoinPool Overview](#10-forkjoinpool-overview)
11. [Work Stealing Mental Model](#11-work-stealing-mental-model)
12. [ForkJoinTask](#12-forkjointask)
13. [RecursiveTask](#13-recursivetask)
14. [RecursiveAction](#14-recursiveaction)
15. [Basic Fork/Join Sum](#15-basic-forkjoin-sum)
16. [Threshold Tuning](#16-threshold-tuning)
17. [Fork One, Compute One](#17-fork-one-compute-one)
18. [Join Discipline](#18-join-discipline)
19. [Common ForkJoinPool](#19-common-forkjoinpool)
20. [Custom ForkJoinPool](#20-custom-forkjoinpool)
21. [Blocking in ForkJoinPool](#21-blocking-in-forkjoinpool)
22. [ManagedBlocker](#22-managedblocker)
23. [Parallel Streams Relationship](#23-parallel-streams-relationship)
24. [CompletableFuture and CPU Executor Choice](#24-completablefuture-and-cpu-executor-choice)
25. [Data Parallelism](#25-data-parallelism)
26. [Reduction and Associativity](#26-reduction-and-associativity)
27. [Shared Mutable State in Parallel Algorithms](#27-shared-mutable-state-in-parallel-algorithms)
28. [False Sharing](#28-false-sharing)
29. [Memory Bandwidth and Cache Locality](#29-memory-bandwidth-and-cache-locality)
30. [Load Balancing](#30-load-balancing)
31. [Parallelism and Backpressure](#31-parallelism-and-backpressure)
32. [CPU Pools in Server Applications](#32-cpu-pools-in-server-applications)
33. [Parallelism with Virtual-Thread Applications](#33-parallelism-with-virtualthread-applications)
34. [Observability and Benchmarking](#34-observability-and-benchmarking)
35. [Testing Parallel Algorithms](#35-testing-parallel-algorithms)
36. [Mini Case Study: Parallel Report Aggregation](#36-mini-case-study-parallel-report-aggregation)
37. [Mini Case Study: Image/Document Processing](#37-mini-case-study-imagedocument-processing)
38. [Mini Case Study: CPU Work Inside Web Request](#38-mini-case-study-cpu-work-inside-web-request)
39. [Common Anti-Patterns](#39-common-antipatterns)
40. [Best Practices](#40-best-practices)
41. [Decision Matrix](#41-decision-matrix)
42. [Latihan](#42-latihan)
43. [Ringkasan](#43-ringkasan)
44. [Referensi](#44-referensi)

---

# 1. Tujuan Bagian Ini

Banyak engineer mencampuradukkan dua hal:

```text
concurrency = banyak pekerjaan sedang berlangsung
parallelism = banyak pekerjaan benar-benar berjalan bersamaan di banyak core
```

Virtual threads sangat bagus untuk concurrency I/O-bound.

Tetapi untuk CPU-bound workload:

```text
Jumlah core tetap batas utama.
```

Jika mesin punya 8 core, menjalankan 10.000 virtual threads CPU-heavy tidak membuat 10.000 operasi berjalan paralel. Yang terjadi bisa:

- context switching meningkat;
- cache locality buruk;
- scheduler overhead;
- latency naik;
- throughput tidak membaik;
- CPU 100%;
- request lain kelaparan.

Target bagian ini:

```text
Mampu mendesain CPU parallelism yang benar:
memecah kerja, memilih threshold, memakai ForkJoinPool,
menghindari shared mutable state, mengukur speedup,
dan menjaga aplikasi server tetap stabil.
```

---

# 2. Concurrency vs Parallelism

## 2.1 Concurrency

Concurrency adalah struktur program yang menangani banyak task dalam rentang waktu yang overlap.

Contoh:

```text
10.000 request sedang menunggu HTTP/DB
```

Tidak berarti semuanya memakai CPU bersamaan.

## 2.2 Parallelism

Parallelism adalah eksekusi simultan.

Contoh:

```text
8 CPU cores menjalankan 8 chunk komputasi pada waktu yang sama
```

## 2.3 Analogy

Concurrency:

```text
Satu kasir mengelola banyak antrean dengan menunggu pembayaran.
```

Parallelism:

```text
Delapan kasir melayani delapan pelanggan bersamaan.
```

## 2.4 Main rule

```text
Concurrency is about dealing with many things.
Parallelism is about doing many things at the same time.
```

---

# 3. CPU-Bound vs I/O-Bound

## 3.1 I/O-bound

Dominated by waiting:

- database;
- network;
- disk;
- remote APIs;
- queues.

Virtual threads help.

## 3.2 CPU-bound

Dominated by computation:

- parsing huge files;
- compression;
- encryption/hash;
- image processing;
- report aggregation;
- sorting;
- simulation;
- ML inference;
- large JSON transformation;
- rule evaluation.

Parallelism helps, if workload decomposes.

## 3.3 Main rule

```text
Use virtual threads to scale waiting.
Use bounded parallelism to scale computation.
```

---

# 4. Kenapa Virtual Threads Bukan Solusi CPU-Bound

Virtual thread:

```text
cheap Java thread
```

But CPU core:

```text
physical execution resource
```

If 10.000 virtual threads run CPU loops:

```java
while (...) {
    compute();
}
```

they compete for limited carrier/platform execution and CPU time.

## 4.1 Symptoms

- CPU 100%;
- carrier saturation;
- queueing;
- GC pressure;
- poor latency;
- no speedup after certain point.

## 4.2 Main rule

```text
Virtual threads reduce cost of blocking.
They do not increase CPU cores.
```

---

# 5. Mental Model CPU Parallelism

To parallelize CPU work:

1. Split work into independent chunks.
2. Run chunks on limited number of workers close to CPU core count.
3. Combine results safely.
4. Minimize coordination overhead.
5. Avoid shared mutable state.
6. Measure.

## 5.1 CPU parallelism needs enough work

Parallel overhead must be worth it.

Small work:

```text
parallel overhead > computation
```

Large work:

```text
parallelism can help
```

## 5.2 Main rule

```text
Parallelism pays only when independent work is large enough to amortize coordination overhead.
```

---

# 6. Amdahl's Law

Amdahl's Law explains speedup limit.

If fraction `p` of program can be parallelized and `N` cores available:

```text
speedup = 1 / ((1 - p) + p / N)
```

Example:

```text
90% parallelizable, 10% serial, 8 cores:
speedup = 1 / (0.1 + 0.9/8) ≈ 4.7x
```

Not 8x.

## 6.1 Serial bottleneck matters

If one stage remains serial, it caps speedup.

## 6.2 Main rule

```text
Parallel speedup is limited by the serial fraction of the workload.
```

---

# 7. Work, Span, and Parallelism

Useful mental model:

## 7.1 Work

Total amount of computation.

```text
How much CPU total?
```

## 7.2 Span

Critical path length.

```text
Shortest possible time with infinite processors.
```

## 7.3 Parallelism

```text
work / span
```

If tasks depend heavily on each other, span is long and parallelism limited.

## 7.4 Main rule

```text
To improve parallelism, reduce dependencies and critical path.
```

---

# 8. Task Decomposition

Good decomposition:

- independent chunks;
- balanced size;
- minimal shared state;
- local accumulation;
- combine at end.

Example:

```text
array[0..n]
split into halves
compute left and right
combine sums
```

Bad decomposition:

- tiny tasks;
- too many shared writes;
- locks around each item;
- uneven chunk sizes;
- dependency chain.

## 8.1 Main rule

```text
Parallel algorithm design starts with decomposition, not with executor selection.
```

---

# 9. Task Granularity

Granularity = task size.

## 9.1 Too small

Too many tasks:

- scheduling overhead;
- object allocation;
- fork/join overhead;
- poor cache.

## 9.2 Too large

Too few tasks:

- poor load balancing;
- some cores idle.

## 9.3 Threshold

Fork/join algorithms often use threshold:

```java
if (size <= THRESHOLD) {
    computeDirectly();
} else {
    split();
}
```

## 9.4 Main rule

```text
Threshold tuning is where theory meets measurement.
```

---

# 10. ForkJoinPool Overview

`ForkJoinPool` is designed for tasks that split into subtasks and join results.

Oracle Java SE docs describe `ForkJoinPool` as an `ExecutorService` for running `ForkJoinTask`s, using work-stealing where idle workers steal tasks from busy workers.

Use cases:

- divide-and-conquer;
- recursive decomposition;
- parallel reductions;
- CPU-bound workloads.

## 10.1 Main concepts

- worker threads;
- work queues;
- fork;
- join;
- work stealing;
- common pool;
- custom pool.

## 10.2 Main rule

```text
ForkJoinPool is designed for many small-ish CPU tasks that recursively split and join.
```

---

# 11. Work Stealing Mental Model

Each worker has a deque of tasks.

Worker:

```text
pushes/pops own tasks
```

Idle worker:

```text
steals from another worker
```

## 11.1 Why useful

If one worker has many subtasks, others can help.

## 11.2 Load balancing

Work stealing helps dynamic load balancing without central queue bottleneck.

## 11.3 Main rule

```text
Work stealing balances recursive task trees by letting idle workers steal work.
```

---

# 12. ForkJoinTask

`ForkJoinTask` is base abstraction.

Common subclasses:

- `RecursiveTask<V>` returns value;
- `RecursiveAction` returns no value;
- `CountedCompleter` advanced.

## 12.1 Do not use for arbitrary blocking I/O

ForkJoin is optimized for CPU-ish fork/join tasks.

## 12.2 Main rule

```text
ForkJoinTask should usually be small, CPU-oriented, and non-blocking.
```

---

# 13. RecursiveTask

Use when task returns result.

Example:

```java
class SumTask extends RecursiveTask<Long> {
    @Override
    protected Long compute() {
        ...
    }
}
```

## 13.1 Main rule

```text
RecursiveTask is for divide-and-conquer computations with a result.
```

---

# 14. RecursiveAction

Use when task mutates disjoint output or side-effect-free output buffer.

```java
class NormalizeTask extends RecursiveAction {
    @Override
    protected void compute() {
        ...
    }
}
```

## 14.1 Caution

Mutating shared output must be partitioned safely.

Good:

```text
each task writes distinct array range
```

Bad:

```text
all tasks add to same ArrayList
```

## 14.2 Main rule

```text
RecursiveAction is safe when side effects are partitioned or otherwise synchronized.
```

---

# 15. Basic Fork/Join Sum

Example:

```java
final class SumTask extends RecursiveTask<Long> {
    private static final int THRESHOLD = 10_000;

    private final long[] values;
    private final int start;
    private final int end;

    SumTask(long[] values, int start, int end) {
        this.values = values;
        this.start = start;
        this.end = end;
    }

    @Override
    protected Long compute() {
        int size = end - start;

        if (size <= THRESHOLD) {
            long sum = 0;
            for (int i = start; i < end; i++) {
                sum += values[i];
            }
            return sum;
        }

        int mid = start + size / 2;

        SumTask left = new SumTask(values, start, mid);
        SumTask right = new SumTask(values, mid, end);

        left.fork();
        long rightResult = right.compute();
        long leftResult = left.join();

        return leftResult + rightResult;
    }
}
```

Usage:

```java
ForkJoinPool pool = ForkJoinPool.commonPool();
long result = pool.invoke(new SumTask(values, 0, values.length));
```

## 15.1 Main rule

```text
Split recursively until threshold; compute directly below threshold; combine results.
```

---

# 16. Threshold Tuning

Threshold affects performance.

## 16.1 Too low

Many tiny tasks.

## 16.2 Too high

Not enough parallelism.

## 16.3 Tune by benchmark

Try values:

```text
1_000
10_000
100_000
1_000_000
```

depending workload.

## 16.4 Factors

- per-item compute cost;
- memory access;
- CPU cache;
- number of cores;
- task overhead;
- allocation.

## 16.5 Main rule

```text
Threshold must be measured for the actual workload and machine class.
```

---

# 17. Fork One, Compute One

Pattern:

```java
left.fork();
R rightResult = right.compute();
R leftResult = left.join();
```

Why?

- current worker keeps doing useful work;
- reduces overhead;
- helps work stealing.

Bad:

```java
left.fork();
right.fork();
return combine(left.join(), right.join());
```

This may create extra scheduling overhead.

## 17.1 Main rule

```text
In binary fork/join, fork one branch and compute the other directly.
```

---

# 18. Join Discipline

Do not join before enough work is forked/computed.

Bad:

```java
left.fork();
long leftResult = left.join();
long rightResult = right.compute();
```

This serializes.

Better:

```java
left.fork();
long rightResult = right.compute();
long leftResult = left.join();
```

## 18.1 Main rule

```text
Join after giving other work a chance to run.
```

---

# 19. Common ForkJoinPool

`ForkJoinPool.commonPool()` is shared by many Java APIs:

- parallel streams;
- CompletableFuture async methods without explicit executor;
- application/library code.

## 19.1 Risk

Blocking or heavy tasks in common pool can affect unrelated code.

## 19.2 Main rule

```text
Do not treat common pool as your private CPU or blocking executor.
```

---

# 20. Custom ForkJoinPool

For isolated CPU workload:

```java
ForkJoinPool pool = new ForkJoinPool(
    Runtime.getRuntime().availableProcessors()
);
```

Use:

```java
try {
    Result result = pool.invoke(task);
} finally {
    pool.shutdown();
}
```

## 20.1 Server app caution

If every request creates pool, terrible.

Create application-level pool.

## 20.2 Main rule

```text
Use custom ForkJoinPool to isolate significant CPU workloads from common pool.
```

---

# 21. Blocking in ForkJoinPool

ForkJoinPool assumes workers do CPU work and help with work stealing.

Blocking worker reduces parallelism.

Bad:

```java
pool.submit(() -> httpClient.call()).join();
```

## 21.1 Consequence

Workers blocked, fewer workers available for CPU tasks.

## 21.2 Use virtual threads for blocking I/O

Blocking I/O should usually use virtual threads or dedicated blocking executor.

## 21.3 Main rule

```text
Do not put arbitrary blocking I/O into ForkJoinPool.
```

---

# 22. ManagedBlocker

ForkJoinPool provides `ManagedBlocker` to tell pool about blocking.

Concept:

```java
ForkJoinPool.managedBlock(blocker);
```

This may allow compensation.

## 22.1 Use when

You must block inside ForkJoin task and can express blocking condition.

## 22.2 Still not first choice

Better to avoid blocking in CPU fork/join tasks.

## 22.3 Main rule

```text
ManagedBlocker is an escape hatch, not permission to design blocking ForkJoin workloads casually.
```

---

# 23. Parallel Streams Relationship

Parallel streams use fork/join under the hood, usually common pool.

```java
list.parallelStream()
    .map(this::compute)
    .toList();
```

Good for:

- CPU-bound stateless operations;
- sufficiently large data;
- associative reductions;
- no blocking I/O;
- no shared mutable state.

Bad for:

- DB/HTTP calls;
- side effects;
- request-level unpredictable pool use;
- small collections;
- order-sensitive operations.

## 23.1 Main rule

```text
Parallel streams are convenient ForkJoin-backed data parallelism, not a general concurrency tool.
```

---

# 24. CompletableFuture and CPU Executor Choice

`CompletableFuture.supplyAsync` without executor uses common pool.

For CPU work:

```java
CompletableFuture.supplyAsync(() -> cpuWork(), cpuExecutor);
```

For blocking I/O:

```java
CompletableFuture.supplyAsync(() -> blockingCall(), virtualThreadExecutor);
```

or direct virtual thread code.

## 24.1 Main rule

```text
Always choose executor based on workload: CPU-bound vs blocking I/O.
```

---

# 25. Data Parallelism

Data parallelism applies same operation to many elements.

Example:

```java
for each row -> parse/validate/transform
```

Good if each element independent.

## 25.1 Avoid shared collector mutation

Bad:

```java
List<Result> results = new ArrayList<>();

inputs.parallelStream().forEach(input -> {
    results.add(process(input));
});
```

Good:

```java
List<Result> results = inputs.parallelStream()
    .map(this::process)
    .toList();
```

## 25.2 Main rule

```text
Data parallelism works best with stateless operations and safe reductions.
```

---

# 26. Reduction and Associativity

Reduction combines many values.

```java
sum = a + b + c + d
```

Parallel reduction requires operation associative.

Associative:

```text
(a + b) + c == a + (b + c)
```

Not always safe:

- floating point addition can differ due to rounding;
- string concatenation order matters if unordered;
- non-associative subtraction.

## 26.1 Identity

Identity must be neutral.

For sum:

```text
0
```

For multiplication:

```text
1
```

## 26.2 Main rule

```text
Parallel reduction requires correct identity, associativity, and usually no side effects.
```

---

# 27. Shared Mutable State in Parallel Algorithms

Shared mutable state kills scalability.

Bad:

```java
AtomicLong total = new AtomicLong();

inputs.parallelStream().forEach(input -> {
    total.addAndGet(expensive(input));
});
```

Even if correct, contention may hurt.

Better:

```java
long total = inputs.parallelStream()
    .mapToLong(this::expensive)
    .sum();
```

## 27.1 Local accumulation

Each task accumulates locally, combine later.

## 27.2 Main rule

```text
Prefer local accumulation and reduction over shared mutation.
```

---

# 28. False Sharing

False sharing happens when independent variables share same CPU cache line and different cores update them, causing cache invalidation.

Example concept:

```text
counter[0] updated by core 0
counter[1] updated by core 1
same cache line
```

Performance degrades.

## 28.1 Where relevant

- high-frequency counters;
- arrays of mutable per-thread state;
- low-level performance code.

## 28.2 Mitigation

- padding;
- `LongAdder`;
- chunk-local state;
- avoid hot adjacent writes.

## 28.3 Main rule

```text
Correct parallel code can still be slow due to cache-coherence effects.
```

---

# 29. Memory Bandwidth and Cache Locality

CPU-bound is not always compute-bound.

Sometimes memory bandwidth is bottleneck.

Example:

```text
scan huge array with simple operation
```

Adding threads may saturate memory bandwidth and stop scaling.

## 29.1 Improve locality

- process contiguous chunks;
- avoid random access;
- reduce object pointer chasing;
- use primitive arrays;
- avoid excessive allocation.

## 29.2 Main rule

```text
Parallelism is limited by memory subsystem as well as CPU cores.
```

---

# 30. Load Balancing

Work should be balanced.

Bad:

```text
chunk 1 takes 1 ms
chunk 2 takes 10 seconds
```

One worker lags, others idle.

## 30.1 Work stealing helps

ForkJoin dynamic splitting helps balance uneven tasks.

## 30.2 Chunk size tradeoff

Smaller chunks balance better but increase overhead.

## 30.3 Main rule

```text
Good parallelism needs both enough work and balanced work.
```

---

# 31. Parallelism and Backpressure

CPU parallelism needs admission control too.

If every request starts CPU parallel job, server can overload.

Example:

```text
100 requests × 8 CPU tasks = 800 CPU tasks on 8 cores
```

## 31.1 Use CPU bulkhead

```java
Semaphore cpuPermits = new Semaphore(Runtime.getRuntime().availableProcessors());
```

or bounded CPU executor.

## 31.2 Main rule

```text
Parallel CPU work must be globally bounded in server applications.
```

---

# 32. CPU Pools in Server Applications

Have a dedicated CPU executor for heavy work.

```java
ExecutorService cpuExecutor = Executors.newFixedThreadPool(
    Runtime.getRuntime().availableProcessors()
);
```

## 32.1 Queue policy

Do not use unbounded queue blindly.

Use bounded queue/rejection if workload can overload.

## 32.2 Separate from I/O

Do not run blocking DB/HTTP in CPU pool.

## 32.3 Main rule

```text
Separate CPU-bound execution from blocking I/O execution.
```

---

# 33. Parallelism with Virtual-Thread Applications

In virtual-thread server:

```text
request virtual thread handles blocking I/O
CPU-heavy section uses bounded CPU pool/ForkJoinPool
```

Example:

```java
ReportData data = repository.load(...); // blocking in virtual thread
Report report = cpuExecutor.submit(() -> renderReport(data)).get();
```

## 33.1 Beware blocking on CPU future

Virtual thread can block cheaply waiting for CPU result.

But CPU executor remains bounded.

## 33.2 Main rule

```text
Virtual thread can orchestrate; bounded CPU pool computes.
```

---

# 34. Observability and Benchmarking

Measure:

## 34.1 CPU

- utilization;
- run queue;
- context switching;
- per-core usage.

## 34.2 Pool

- active workers;
- queue size;
- task duration;
- rejection;
- wait time.

## 34.3 Algorithm

- speedup vs sequential;
- threshold sensitivity;
- allocation rate;
- GC;
- memory bandwidth;
- cache behavior.

## 34.4 Use JMH for microbenchmarks

Do not benchmark with naive `System.currentTimeMillis` only.

## 34.5 Main rule

```text
Parallelism without benchmark is guesswork.
```

---

# 35. Testing Parallel Algorithms

Test:

## 35.1 Correctness

Compare to sequential result.

## 35.2 Determinism

Run many times.

## 35.3 Edge cases

Empty, one element, threshold boundary.

## 35.4 Race

Use stress tests.

## 35.5 Floating point tolerance

Parallel order may differ.

## 35.6 Main rule

```text
Parallel algorithm tests should compare against trusted sequential implementation.
```

---

# 36. Mini Case Study: Parallel Report Aggregation

## 36.1 Requirement

Aggregate 10 million rows into totals.

## 36.2 Bad

Shared map with locks per row.

```java
rows.parallelStream().forEach(row -> {
    synchronized (totals) {
        update(totals, row);
    }
});
```

Lock destroys parallelism.

## 36.3 Better

Partition rows.

Each task creates local totals.

Combine maps at end.

```text
chunk -> local aggregate
merge local aggregates
```

## 36.4 Lesson

```text
Parallel aggregation should use local accumulation then combine.
```

---

# 37. Mini Case Study: Image/Document Processing

## 37.1 Requirement

Generate thumbnails for 1000 documents.

## 37.2 Workload

CPU-heavy image processing plus I/O read/write.

## 37.3 Design

- virtual threads for I/O orchestration;
- bounded CPU pool for rendering;
- bounded queue for pending CPU work;
- limit memory buffers;
- backpressure if too many docs.

## 37.4 Lesson

```text
Mixed workloads need separate controls for I/O, CPU, and memory.
```

---

# 38. Mini Case Study: CPU Work Inside Web Request

## 38.1 Problem

Endpoint running on virtual thread generates huge PDF directly.

100 concurrent requests generate 100 PDFs on 8-core machine.

CPU saturated.

## 38.2 Fix

- CPU bulkhead;
- async job for large reports;
- return 202 Accepted;
- cache results;
- bounded CPU executor;
- reject/degrade under load.

## 38.3 Lesson

```text
Virtual-thread request handling does not make CPU-heavy request work free.
```

---

# 39. Common Anti-Patterns

## 39.1 Using virtual threads for CPU scaling

Wrong bottleneck.

## 39.2 Parallelizing tiny tasks

Overhead dominates.

## 39.3 Blocking I/O in ForkJoinPool common pool

Starvation.

## 39.4 Shared mutable collector

Race/contention.

## 39.5 Parallel stream for DB calls

Common pool + blocking + resource overload.

## 39.6 Unbounded CPU tasks per request

Server overload.

## 39.7 Ignoring threshold

Poor performance.

## 39.8 Assuming parallel always faster

Not true.

## 39.9 Floating-point reduction surprises

Different order, different rounding.

## 39.10 Custom pool per request

Expensive and chaotic.

---

# 40. Best Practices

## 40.1 Identify workload type

CPU vs I/O vs mixed.

## 40.2 Use bounded CPU parallelism

Core-count-aware.

## 40.3 Prefer ForkJoin for recursive CPU divide-and-conquer

Not blocking I/O.

## 40.4 Tune threshold

Benchmark.

## 40.5 Avoid shared mutable state

Use local accumulation/reduction.

## 40.6 Avoid common pool for blocking

Use explicit executor.

## 40.7 Isolate heavy CPU workloads

Custom pool/bulkhead.

## 40.8 Preserve request latency

Do not let CPU jobs starve normal requests.

## 40.9 Measure speedup

Compare sequential vs parallel.

## 40.10 Think memory/cache

Not just thread count.

---

# 41. Decision Matrix

| Scenario | Recommended |
|---|---|
| Recursive CPU divide-and-conquer | ForkJoinPool |
| Simple CPU map/reduce over large collection | parallel stream or ForkJoin, benchmark |
| Blocking HTTP/DB calls | virtual threads, not ForkJoin |
| CPU-heavy work in web request | bounded CPU executor/bulkhead |
| Tiny collection processing | sequential |
| Shared mutable aggregation | local accumulation + reduction |
| High-contention metrics | LongAdder |
| Mixed I/O + CPU pipeline | virtual threads for I/O, CPU pool for compute |
| Need isolate from common pool | custom ForkJoinPool/executor |
| Long blocking in ForkJoin | avoid or ManagedBlocker if unavoidable |
| Huge report generation | async job or CPU bulkhead |
| Floating point exact reproducibility | be careful with parallel reduction |
| Unbalanced recursive work | ForkJoin work stealing helps |

---

# 42. Latihan

## Latihan 1 — SumTask

Implementasikan `RecursiveTask<Long>` untuk menjumlah array besar.

## Latihan 2 — Threshold Benchmark

Bandingkan threshold 1k, 10k, 100k, 1M.

## Latihan 3 — Fork One Compute One

Refactor fork both pattern menjadi fork one compute one.

## Latihan 4 — Parallel Stream Side Effect

Perbaiki parallel stream yang menulis ke shared `ArrayList`.

## Latihan 5 — Local Aggregation

Desain parallel aggregation dengan local map per chunk.

## Latihan 6 — CPU Pool

Buat bounded CPU executor untuk PDF generation endpoint.

## Latihan 7 — Common Pool Risk

Jelaskan kenapa `CompletableFuture.supplyAsync(blockingCall)` tanpa executor berbahaya.

## Latihan 8 — Mixed Pipeline

Desain pipeline file import: virtual threads untuk I/O, CPU pool untuk parsing/compression.

## Latihan 9 — Amdahl Calculation

Hitung speedup untuk p=0.95 dan N=8.

## Latihan 10 — Observability

Buat metric list untuk CPU pool production.

---

# 43. Ringkasan

Parallelism berbeda dari concurrency.

Core lessons:

- Concurrency menangani banyak task; parallelism menjalankan banyak task bersamaan.
- Virtual threads bagus untuk I/O-bound waiting, bukan CPU scaling.
- CPU-bound work dibatasi core, memory bandwidth, cache locality, dan serial fraction.
- Amdahl's Law membatasi speedup.
- Parallel algorithm dimulai dari decomposition.
- Task granularity dan threshold sangat penting.
- ForkJoinPool memakai work stealing.
- RecursiveTask mengembalikan result; RecursiveAction tidak.
- Fork one branch, compute one branch adalah pattern penting.
- Join discipline mempengaruhi parallelism.
- Common pool shared oleh parallel streams dan CompletableFuture default async.
- Jangan gunakan common pool untuk blocking I/O.
- ManagedBlocker adalah escape hatch untuk blocking dalam ForkJoin.
- Parallel streams cocok untuk stateless CPU data parallelism, bukan DB/HTTP calls.
- Shared mutable state menghancurkan scalability.
- Reduction harus associative dan identity harus benar.
- False sharing, memory bandwidth, dan cache locality dapat membatasi speedup.
- Server apps butuh bounded CPU pools.
- Virtual-thread apps sebaiknya memakai virtual thread untuk orchestration dan bounded CPU executor untuk compute.
- Parallelism harus diukur dengan benchmark.

Main rule:

```text
Use virtual threads for waiting.
Use bounded CPU parallelism for computation.
Use ForkJoin when work can split and join efficiently.
Measure before claiming speedup.
```

---

# 44. Referensi

1. Java SE 25 — `ForkJoinPool`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinPool.html

2. Java SE 25 — `ForkJoinTask`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinTask.html

3. Java SE 25 — `RecursiveTask`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/RecursiveTask.html

4. Java SE 25 — `RecursiveAction`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/RecursiveAction.html

5. Java SE 25 — `CompletableFuture`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html

6. Java SE 25 — `ExecutorService`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html

7. Java SE 25 — `Executors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html

8. Java SE 25 — `LongAdder`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html

9. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

10. Java Microbenchmark Harness (JMH)  
    https://openjdk.org/projects/code-tools/jmh/

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-concurrency-and-reactive-part-021.md](./learn-java-concurrency-and-reactive-part-021.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-concurrency-and-reactive-part-023.md](./learn-java-concurrency-and-reactive-part-023.md)

</div>
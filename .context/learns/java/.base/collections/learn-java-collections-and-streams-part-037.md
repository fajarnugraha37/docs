# learn-java-collections-and-streams-part-037.md

# Java Collections and Streams — Part 037  
# Parallel Streams Fundamentals: Splitting, Fork/Join, Common Pool, Work Granularity, Source Quality, Ordering Cost, Reduction Correctness, and When `.parallel()` Helps or Hurts

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **037**  
> Fokus: memahami parallel streams dari dasar: bukan sebagai “auto speed-up”, tetapi sebagai model **divide-and-conquer** di atas `Spliterator`, `ForkJoinPool`, stateless operations, associative reduction, source splitting quality, ordering constraints, memory bandwidth, blocking risk, dan benchmark discipline.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Parallel Stream = Split, Process, Combine](#2-mental-model-parallel-stream--split-process-combine)
3. [Sequential vs Parallel Stream](#3-sequential-vs-parallel-stream)
4. [Cara Membuat Parallel Stream](#4-cara-membuat-parallel-stream)
5. [Fork/Join Mental Model](#5-forkjoin-mental-model)
6. [Common Pool](#6-common-pool)
7. [Spliterator sebagai Kunci Parallelism](#7-spliterator-sebagai-kunci-parallelism)
8. [Source Quality: Good vs Poor Parallel Sources](#8-source-quality-good-vs-poor-parallel-sources)
9. [Work Granularity](#9-work-granularity)
10. [CPU-Bound vs IO-Bound](#10-cpu-bound-vs-io-bound)
11. [Stateless Operation Requirement](#11-stateless-operation-requirement)
12. [Non-Interference Requirement](#12-non-interference-requirement)
13. [Reduction Correctness](#13-reduction-correctness)
14. [Collector Correctness](#14-collector-correctness)
15. [Ordering Cost](#15-ordering-cost)
16. [`findFirst` vs `findAny` in Parallel](#16-findfirst-vs-findany-in-parallel)
17. [`forEach` vs `forEachOrdered` in Parallel](#17-foreach-vs-foreachordered-in-parallel)
18. [`limit`, `skip`, and Ordered Parallel Streams](#18-limit-skip-and-ordered-parallel-streams)
19. [`distinct` and `sorted` in Parallel](#19-distinct-and-sorted-in-parallel)
20. [`unordered()` as Performance Lever](#20-unordered-as-performance-lever)
21. [Side Effects and Shared State](#21-side-effects-and-shared-state)
22. [Blocking Operations and Common Pool Starvation](#22-blocking-operations-and-common-pool-starvation)
23. [Parallel Streams and Virtual Threads](#23-parallel-streams-and-virtual-threads)
24. [Nested Parallel Streams](#24-nested-parallel-streams)
25. [Exception Handling](#25-exception-handling)
26. [Memory Bandwidth and Allocation Pressure](#26-memory-bandwidth-and-allocation-pressure)
27. [False Sharing and Contention](#27-false-sharing-and-contention)
28. [Benchmarking Parallel Streams](#28-benchmarking-parallel-streams)
29. [When Parallel Stream Is a Good Fit](#29-when-parallel-stream-is-a-good-fit)
30. [When Parallel Stream Is a Bad Fit](#30-when-parallel-stream-is-a-bad-fit)
31. [Production Diagnostics](#31-production-diagnostics)
32. [Common Anti-Patterns](#32-common-anti-patterns)
33. [Production Failure Modes](#33-production-failure-modes)
34. [Best Practices](#34-best-practices)
35. [Decision Matrix](#35-decision-matrix)
36. [Latihan](#36-latihan)
37. [Ringkasan](#37-ringkasan)
38. [Referensi](#38-referensi)

---

# 1. Tujuan Bagian Ini

Parallel stream sering dipahami secara terlalu sederhana:

```java
list.parallelStream()
```

atau:

```java
stream.parallel()
```

lalu diasumsikan:

```text
lebih banyak thread = lebih cepat
```

Ini salah.

Parallel stream bisa mempercepat pipeline tertentu, tetapi juga bisa membuat program:

- lebih lambat;
- nondeterministic;
- race condition;
- common pool starvation;
- memory lebih tinggi;
- result salah karena reduce tidak associative;
- output order berubah;
- DB/network overload;
- latency spike karena blocking;
- performance tidak stabil antar environment.

Parallel stream adalah tool untuk pekerjaan tertentu:

```text
bounded data + good splitting + CPU-heavy independent work + correct reduction + low ordering constraint
```

Tujuan part ini:

- memahami cara kerja parallel stream;
- memahami source splitting;
- memahami ForkJoinPool/common pool;
- memahami syarat correctness;
- memahami kapan parallel stream membantu;
- memahami kapan parallel stream berbahaya;
- membangun production checklist sebelum memakai `.parallel()`.

---

# 2. Mental Model: Parallel Stream = Split, Process, Combine

Parallel stream bekerja seperti divide-and-conquer.

```text
source
  -> split into chunks
  -> process chunks in parallel
  -> combine partial results
```

Contoh:

```java
long total = orders.parallelStream()
    .filter(Order::paid)
    .mapToLong(Order::amountInCents)
    .sum();
```

Mental model:

```text
orders split into partitions
each partition filters and sums locally
partial sums combined into final sum
```

## 2.1 Three questions

Sebelum pakai parallel stream, tanya:

1. Bisa source dibelah efisien?
2. Bisa tiap element diproses independen?
3. Bisa hasil partial digabung benar dan murah?

## 2.2 Main rule

```text
Parallel stream performance is split quality + per-element work + combine cost + correctness.
```

---

# 3. Sequential vs Parallel Stream

## 3.1 Sequential

```java
orders.stream()
```

Satu pipeline traversal secara sequential.

## 3.2 Parallel

```java
orders.parallelStream()
```

atau:

```java
orders.stream().parallel()
```

Pipeline dapat dieksekusi secara parallel.

## 3.3 Not guaranteed faster

Parallel execution punya overhead:

- splitting;
- task scheduling;
- synchronization;
- combining;
- memory pressure;
- ordering coordination.

## 3.4 Rule

Sequential is the baseline. Parallel must justify its overhead.

---

# 4. Cara Membuat Parallel Stream

## 4.1 From collection

```java
orders.parallelStream()
```

## 4.2 From stream

```java
orders.stream()
    .parallel()
```

## 4.3 Switch back to sequential

```java
orders.parallelStream()
    .map(...)
    .sequential()
    .forEachOrdered(...);
```

## 4.4 Last mode wins

In a pipeline, mode can be switched, but avoid confusing mixed-mode pipelines.

## 4.5 Rule

Choose parallel/sequential intentionally near pipeline boundary.

---

# 5. Fork/Join Mental Model

Parallel stream uses fork/join style execution.

## 5.1 Fork

Split task into subtasks.

```text
process 0..1_000_000
fork 0..500_000
fork 500_000..1_000_000
```

## 5.2 Join

Combine partial results.

```text
partial A + partial B -> final
```

## 5.3 Work stealing

ForkJoinPool worker threads can steal tasks from others to balance load.

## 5.4 Rule

Parallel stream is best for workloads that fit fork/join divide-and-conquer.

---

# 6. Common Pool

Parallel streams commonly run on the ForkJoin common pool.

## 6.1 Shared resource

The common pool is shared across application tasks using it.

## 6.2 Risk

Blocking operations in parallel stream can occupy common pool workers.

Example bad:

```java
urls.parallelStream()
    .map(httpClient::get)
    .toList();
```

## 6.3 Impact

Can affect unrelated parallel streams or fork/join tasks.

## 6.4 Rule

Do not treat parallel stream as private thread pool.

---

# 7. Spliterator sebagai Kunci Parallelism

A stream source is split using `Spliterator`.

Important methods/concepts:

```java
trySplit()
estimateSize()
characteristics()
```

## 7.1 Good splitting

A good spliterator can divide source into balanced chunks.

## 7.2 Poor splitting

If source cannot split well, parallel stream has little advantage.

## 7.3 Characteristics

Useful characteristics include:

```java
SIZED
SUBSIZED
ORDERED
IMMUTABLE
CONCURRENT
DISTINCT
SORTED
NONNULL
```

## 7.4 Rule

Parallel stream quality starts at Spliterator quality.

---

# 8. Source Quality: Good vs Poor Parallel Sources

## 8.1 Good sources

Generally good:

```java
ArrayList
arrays
IntStream.range
LongStream.range
primitive arrays
```

Why:

- known size;
- good splitting;
- locality;
- balanced chunks.

## 8.2 Often poor sources

Potentially poor:

```java
LinkedList
Iterator-backed streams
Files.lines
Stream.generate
Stream.iterate recurrence
IO streams
```

Why:

- poor splitting;
- unknown size;
- sequential dependency;
- IO blocking;
- expensive coordination.

## 8.3 HashSet/HashMap

Can split, but order is not meaningful and locality may be less ideal.

## 8.4 Rule

Prefer arrays/ranges/ArrayList-like sources for parallel streams.

---

# 9. Work Granularity

Parallel overhead must be amortized by enough work.

## 9.1 Too small

```java
list.parallelStream()
    .map(x -> x + 1)
    .toList();
```

Likely slower for small/simple data.

## 9.2 Better candidate

```java
items.parallelStream()
    .map(this::expensiveCpuComputation)
    .toList();
```

## 9.3 Granularity dimensions

- number of elements;
- CPU cost per element;
- split cost;
- combine cost;
- allocation per element.

## 9.4 Rule

Parallelism helps when per-element work is large enough and independent.

---

# 10. CPU-Bound vs IO-Bound

## 10.1 CPU-bound

Good candidate:

- hashing large payload;
- image processing;
- CPU-heavy parsing;
- expensive mathematical computation.

## 10.2 IO-bound

Bad candidate:

- HTTP calls;
- DB queries;
- file reads;
- remote service calls.

## 10.3 Why IO-bound bad

Parallel stream uses limited shared worker pool and no built-in backpressure/rate limiting.

## 10.4 Better for IO concurrency

Use:

- bounded ExecutorService;
- CompletableFuture with custom executor;
- virtual threads;
- reactive client;
- queue/backpressure.

## 10.5 Rule

Parallel stream is primarily for CPU-bound data parallelism, not IO orchestration.

---

# 11. Stateless Operation Requirement

Parallel stream operations should be stateless.

Good:

```java
.map(this::pureTransform)
.filter(this::purePredicate)
```

Bad:

```java
.map(x -> counter++)
```

## 11.1 Why

Multiple threads process elements concurrently.

Shared mutable state causes races.

## 11.2 Rule

Lambdas in parallel streams should be stateless and independent.

---

# 12. Non-Interference Requirement

Do not mutate source while streaming.

Bad:

```java
list.parallelStream()
    .forEach(x -> list.add(transform(x)));
```

## 12.1 Concurrent source exception

Some concurrent collections allow concurrent modification, but semantics are weakly consistent, not necessarily snapshot/deterministic.

## 12.2 Rule

Parallel stream source should not be modified during execution unless source explicitly supports it and nondeterminism is acceptable.

---

# 13. Reduction Correctness

Parallel reduction requires:

- true identity;
- associative accumulator;
- compatible combiner;
- no shared mutable state.

## 13.1 Good

```java
long total = orders.parallelStream()
    .mapToLong(Order::amountInCents)
    .sum();
```

## 13.2 Bad

```java
int result = numbers.parallelStream()
    .reduce(0, (a, b) -> a - b);
```

Subtraction is not associative.

## 13.3 Rule

If reduction is not mathematically safe under regrouping, do not parallelize it.

---

# 14. Collector Correctness

Collectors in parallel require:

- fresh supplier;
- isolated accumulation;
- correct combiner;
- honest characteristics.

## 14.1 Good

```java
List<Result> results = items.parallelStream()
    .map(this::compute)
    .toList();
```

## 14.2 Bad custom collector

Supplier returns shared list.

```java
ArrayList<T> shared = new ArrayList<>();
Collector.of(() -> shared, List::add, ...)
```

Wrong.

## 14.3 Rule

Custom collectors must be tested sequential and parallel.

---

# 15. Ordering Cost

Parallel stream order can cost.

Ordered operations include:

```java
findFirst
forEachOrdered
limit on ordered stream
skip on ordered stream
stable distinct
ordered collect
```

## 15.1 Why

The framework must coordinate chunks to respect encounter order.

## 15.2 Rule

If order does not matter, do not force ordered operations.

---

# 16. `findFirst` vs `findAny` in Parallel

## 16.1 findFirst

Must return first in encounter order.

```java
parallelStream.findFirst()
```

Can require coordination.

## 16.2 findAny

Can return any element.

```java
parallelStream.findAny()
```

Often more efficient.

## 16.3 Rule

Use `findAny` in parallel when any matching element is acceptable.

---

# 17. `forEach` vs `forEachOrdered` in Parallel

## 17.1 forEach

May execute in arbitrary order.

```java
parallelStream.forEach(action)
```

## 17.2 forEachOrdered

Preserves encounter order.

```java
parallelStream.forEachOrdered(action)
```

## 17.3 Cost

`forEachOrdered` may serialize parts of output.

## 17.4 Rule

Use `forEachOrdered` only when side-effect order is required.

---

# 18. `limit`, `skip`, and Ordered Parallel Streams

## 18.1 Ordered limit

```java
list.parallelStream()
    .limit(100)
```

Must preserve first 100 encounter-order elements.

## 18.2 Ordered skip

```java
list.parallelStream()
    .skip(1_000_000)
```

Can require coordination.

## 18.3 If order irrelevant

```java
stream.parallel()
    .unordered()
    .limit(100)
```

## 18.4 Rule

Ordered slicing is often expensive in parallel.

---

# 19. `distinct` and `sorted` in Parallel

## 19.1 distinct

Needs coordination to remove duplicates.

Ordered distinct preserves first occurrence order, which is more expensive.

## 19.2 sorted

Requires global ordering.

Parallel sort can help for large data, but still needs full buffering and merging.

## 19.3 Rule

Stateful operations can dominate parallel pipeline cost.

---

# 20. `unordered()` as Performance Lever

`unordered()` removes encounter order constraint.

```java
items.parallelStream()
    .unordered()
    .distinct()
    .count();
```

## 20.1 Good when

Output order irrelevant.

## 20.2 Bad when

First/last/page/report/API order matters.

## 20.3 Rule

Use `unordered()` only when business semantics allow arbitrary order.

---

# 21. Side Effects and Shared State

Bad:

```java
List<Result> results = new ArrayList<>();

items.parallelStream()
    .map(this::compute)
    .forEach(results::add);
```

## 21.1 Race

ArrayList is not thread-safe.

## 21.2 Even thread-safe may be bad

```java
Queue<Result> q = new ConcurrentLinkedQueue<>();
items.parallelStream().forEach(q::add);
```

Safe structurally, but may be slower and unordered.

## 21.3 Correct

```java
List<Result> results = items.parallelStream()
    .map(this::compute)
    .toList();
```

## 21.4 Rule

Use reductions/collectors, not external shared mutable state.

---

# 22. Blocking Operations and Common Pool Starvation

Blocking in parallel stream is dangerous.

## 22.1 Example bad

```java
ids.parallelStream()
    .map(repository::findById)
    .toList();
```

If repository blocks, workers wait.

## 22.2 Common pool impact

Blocking can starve other tasks using common pool.

## 22.3 Better

Use bounded IO concurrency:

```java
ExecutorService executor = Executors.newFixedThreadPool(20);
```

or virtual threads with explicit limit/rate control.

## 22.4 Rule

Do not run blocking IO workloads on parallel streams by default.

---

# 23. Parallel Streams and Virtual Threads

Virtual threads are for blocking concurrency.

Parallel streams are for CPU data parallelism.

## 23.1 Different tools

Parallel stream:

```text
split data and compute on worker pool
```

Virtual threads:

```text
many blocking tasks with cheap threads
```

## 23.2 Do not confuse

Adding virtual threads does not make parallel streams the right abstraction for IO.

## 23.3 Rule

Use virtual threads/executors for many blocking operations; use parallel streams for CPU-heavy aggregate computation.

---

# 24. Nested Parallel Streams

Bad:

```java
outer.parallelStream()
    .map(o -> o.inner().parallelStream()
        .map(this::compute)
        .toList())
    .toList();
```

## 24.1 Problems

- common pool contention;
- oversubscription;
- unpredictable performance;
- hard diagnostics.

## 24.2 Better

Flatten one level:

```java
outer.parallelStream()
    .flatMap(o -> o.inner().stream())
    .map(this::compute)
    .toList();
```

or choose one parallel boundary.

## 24.3 Rule

Avoid nested parallel streams.

---

# 25. Exception Handling

If one parallel task fails, others may already be running.

## 25.1 Side effects

Already-performed side effects are not rolled back.

## 25.2 Exception wrapping

Exceptions may propagate from terminal operation.

## 25.3 Better

For per-item error collection, model result explicitly:

```java
items.parallelStream()
    .map(this::tryCompute)
    .toList();
```

where `tryCompute` returns success/failure value.

## 25.4 Rule

Parallel stream does not provide transaction or cancellation rollback semantics.

---

# 26. Memory Bandwidth and Allocation Pressure

Parallelism can be limited by memory bandwidth.

## 26.1 Example

```java
largeList.parallelStream()
    .map(x -> new SmallObject(x))
    .toList();
```

May allocate heavily across threads.

## 26.2 GC pressure

More concurrent allocation can increase GC activity.

## 26.3 Cache locality

Array/range source better than pointer-heavy linked structures.

## 26.4 Rule

Parallel CPU usage is not enough; memory bandwidth and allocation can bottleneck.

---

# 27. False Sharing and Contention

Shared counters/accumulators cause contention.

## 27.1 Bad

```java
AtomicLong total = new AtomicLong();
stream.parallel().forEach(x -> total.addAndGet(value(x)));
```

## 27.2 Better

```java
long total = stream.parallel()
    .mapToLong(this::value)
    .sum();
```

Framework creates partial accumulations and combines.

## 27.3 Rule

Avoid shared mutable counters; use reduction.

---

# 28. Benchmarking Parallel Streams

Do not benchmark with naive `System.currentTimeMillis` once.

Use:

- warmup;
- multiple iterations;
- JMH for microbenchmark;
- realistic data size;
- production-like CPU;
- no dead-code elimination;
- separate IO from CPU;
- monitor GC;
- compare sequential baseline.

## 28.1 Things to record

- dataset size;
- source type;
- operation cost;
- parallelism;
- CPU utilization;
- allocation rate;
- GC;
- p95/p99 latency if request path.

## 28.2 Rule

Parallel stream adoption must be measured, not guessed.

---

# 29. When Parallel Stream Is a Good Fit

Good candidate:

```text
bounded in-memory data
good splitting source
CPU-heavy independent per-element work
stateless lambdas
associative reduction
low ordering requirement
low blocking
low shared state
measured speedup
```

## 29.1 Example

```java
long score = IntStream.range(0, data.length)
    .parallel()
    .map(i -> expensiveScore(data[i]))
    .sum();
```

## 29.2 Rule

Parallel streams fit CPU-bound, data-parallel, bounded workloads.

---

# 30. When Parallel Stream Is a Bad Fit

Bad candidate:

```text
small dataset
cheap operation
IO-bound work
blocking DB/network calls
shared mutable state
requires strict order
bad source splitting
custom non-associative reduction
nested parallelism
request path with tight latency variability
uses common pool already heavily
```

## 30.1 Rule

If you need control over concurrency, backpressure, rate limit, or transaction semantics, do not use parallel stream.

---

# 31. Production Diagnostics

Check:

## 31.1 Source

ArrayList/array/range or poor source?

## 31.2 Work

CPU-heavy enough?

## 31.3 Operations

Stateful barriers? ordering constraints?

## 31.4 Reduction

Associative and correct?

## 31.5 Side effects

Any shared mutable state?

## 31.6 Common pool

Other tasks using it? Blocking?

## 31.7 GC/memory

Allocation increased?

## 31.8 Environment

Container CPU limits? available processors? noisy neighbors?

## 31.9 Rule

Parallel stream performance issues require system-level diagnosis, not just code reading.

---

# 32. Common Anti-Patterns

## 32.1 Adding `.parallel()` blindly

Bad.

## 32.2 Parallel stream for DB calls

Bad.

## 32.3 Parallel stream for HTTP calls

Bad.

## 32.4 External mutable collection accumulation

Bad.

## 32.5 Non-associative reduce

Wrong.

## 32.6 Ordered operations everywhere

Slow.

## 32.7 Nested parallel streams

Bad.

## 32.8 Benchmarking once

Misleading.

## 32.9 Using common pool for blocking workloads

Risky.

## 32.10 Assuming thread-safe value objects because map is concurrent

Wrong.

---

# 33. Production Failure Modes

## 33.1 Result wrong in parallel

Cause: non-associative reduction or shared mutable state.

## 33.2 Random order output

Cause: `forEach` or unordered collector.

## 33.3 Slower than sequential

Cause: overhead > work, poor source, stateful barriers.

## 33.4 Common pool starvation

Cause: blocking IO in parallel stream.

## 33.5 DB overload

Cause: parallel stream creates many concurrent queries.

## 33.6 Rate limit incident

Cause: parallel HTTP calls.

## 33.7 Memory/GC spike

Cause: parallel allocation and materialization.

## 33.8 Flaky tests

Cause: order nondeterminism.

## 33.9 Latency spikes

Cause: shared common pool contention.

## 33.10 Partial side effects after exception

Cause: parallel tasks already executed side effects.

---

# 34. Best Practices

## 34.1 Start sequential

Write correct sequential pipeline first.

## 34.2 Parallel only after measurement

Prove benefit.

## 34.3 Use good sources

Arrays, ranges, ArrayList.

## 34.4 Keep lambdas pure/stateless

No shared mutation.

## 34.5 Use reductions/collectors

Avoid external accumulation.

## 34.6 Avoid blocking IO

Use dedicated concurrency abstraction.

## 34.7 Avoid nested parallel streams

One parallel boundary.

## 34.8 Remove order constraints if safe

Use `unordered()` only with clear semantics.

## 34.9 Watch common pool

Do not assume isolation.

## 34.10 Benchmark in realistic environment

Especially containers.

---

# 35. Decision Matrix

| Question | If Yes | If No |
|---|---|---|
| Data bounded and in memory? | parallel possible | avoid parallel stream |
| Source splits well? | good candidate | likely poor |
| Per-element work CPU-heavy? | good candidate | overhead may dominate |
| Lambdas stateless? | good | unsafe |
| Reduction associative? | good | wrong in parallel |
| Order required? | expect cost | can use unordered/findAny |
| Blocking IO involved? | use other abstraction | parallel stream possible |
| Shared mutable state? | redesign | good |
| Custom collector tested parallel? | maybe safe | risky |
| Measured speedup? | consider use | stay sequential |
| Common pool contention acceptable? | maybe | avoid |
| Need rate limit/backpressure? | use executor/reactive | parallel stream okay if CPU |
| Dataset small? | sequential | maybe parallel if work huge |
| Source is range/array? | good | inspect Spliterator |
| Operation includes sorted/distinct? | measure carefully | easier |

---

# 36. Latihan

## Latihan 1 — Sequential vs Parallel

Compare conceptually:

```java
list.stream().map(this::cheap).toList()
list.parallelStream().map(this::cheap).toList()
```

Explain why parallel may be slower.

## Latihan 2 — Good Source

Use `IntStream.range(0, n).parallel()` for CPU-heavy function.

Explain why range splits well.

## Latihan 3 — Bad Source

Discuss why `Files.lines(path).parallel()` may not improve performance.

## Latihan 4 — Non-Associative Reduce

Run subtraction reduce sequential vs parallel conceptually.

## Latihan 5 — External Mutable List

Show why parallel forEach add to ArrayList is unsafe.

## Latihan 6 — findFirst vs findAny

Use parallel stream and explain performance/semantic difference.

## Latihan 7 — Ordered limit

Explain cost difference:

```java
parallelStream.limit(100)
parallelStream.unordered().limit(100)
```

## Latihan 8 — Blocking IO

Design alternative for calling 1,000 HTTP endpoints with bounded concurrency.

## Latihan 9 — Nested Parallel

Refactor nested parallel streams into one parallel boundary.

## Latihan 10 — Benchmark Plan

Write a benchmark plan before enabling parallel stream in production.

---

# 37. Ringkasan

Parallel streams are powerful but narrow-purpose.

Core lessons:

- Parallel stream means split, process chunks, combine partial results.
- It uses fork/join style execution and commonly the shared ForkJoin common pool.
- Spliterator quality determines split quality.
- Arrays, ranges, and ArrayList are good sources.
- IO, iterators, linked structures, and recurrence streams are often poor.
- Parallel helps when work is CPU-heavy, independent, and large enough.
- Lambdas must be stateless and non-interfering.
- Reductions must have true identity and associative operations.
- Collectors need correct supplier/accumulator/combiner/characteristics.
- Ordering operations can be expensive.
- `findAny` is more parallel-friendly than `findFirst` when any result is enough.
- `forEachOrdered` can reduce parallel benefit.
- Blocking operations can starve the common pool.
- Parallel streams are not a network/DB concurrency framework.
- Nested parallel streams are usually bad.
- Benchmarking is mandatory.

Main rule:

```text
Do not ask “can I add .parallel()?”
Ask:
Can this data split well?
Is the work CPU-heavy and independent?
Is reduction correct under regrouping?
Is order unnecessary or affordable?
Did measurement prove speedup?
```

---

# 38. Referensi

1. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

2. Java SE 25 — `java.util.stream` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

3. Java SE 25 — `BaseStream.parallel`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/BaseStream.html#parallel()

4. Java SE 25 — `Spliterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterator.html

5. Java SE 25 — `Spliterators`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterators.html

6. Java SE 25 — `ForkJoinPool`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinPool.html

7. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

8. Java SE 25 — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

9. Java SE 25 — `IntStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.html

10. OpenJDK — Stream package source  
    https://github.com/openjdk/jdk/tree/master/src/java.base/share/classes/java/util/stream

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Collections and Streams — Part 036](./learn-java-collections-and-streams-part-036.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Collections and Streams — Part 038](./learn-java-collections-and-streams-part-038.md)

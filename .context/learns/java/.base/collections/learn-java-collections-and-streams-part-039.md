# learn-java-collections-and-streams-part-039.md

# Java Collections and Streams — Part 039  
# Parallel Stream Performance: Cost Model, Speedup Limits, Spliterator Quality, Work Granularity, Stateful Barriers, Ordering Cost, Memory/GC, Common Pool, Benchmarking, and Production Tuning

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **039**  
> Fokus: memahami performance parallel streams secara realistis. Bagian sebelumnya membahas correctness. Bagian ini membahas kapan parallel stream benar-benar lebih cepat, kenapa sering lebih lambat, bagaimana menganalisis source splitting, per-element cost, combiner cost, order constraints, stateful barriers, memory bandwidth, GC, blocking, common pool contention, benchmarking, dan production diagnostics.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Speedup Harus Membayar Overhead](#2-mental-model-speedup-harus-membayar-overhead)
3. [Performance Formula Sederhana](#3-performance-formula-sederhana)
4. [Amdahl's Law Mental Model](#4-amdahls-law-mental-model)
5. [Spliterator Quality](#5-spliterator-quality)
6. [Good Sources for Parallel Streams](#6-good-sources-for-parallel-streams)
7. [Poor Sources for Parallel Streams](#7-poor-sources-for-parallel-streams)
8. [Work Granularity](#8-work-granularity)
9. [Cheap Operations Usually Lose](#9-cheap-operations-usually-lose)
10. [CPU-Bound Workload](#10-cpu-bound-workload)
11. [IO-Bound Workload](#11-io-bound-workload)
12. [Blocking and Common Pool Contention](#12-blocking-and-common-pool-contention)
13. [Ordering Cost](#13-ordering-cost)
14. [Stateful Barrier Cost](#14-stateful-barrier-cost)
15. [`sorted()` Cost](#15-sorted-cost)
16. [`distinct()` Cost](#16-distinct-cost)
17. [`limit()` and `skip()` Cost](#17-limit-and-skip-cost)
18. [`unordered()` as Optimization](#18-unordered-as-optimization)
19. [Reduction and Combiner Cost](#19-reduction-and-combiner-cost)
20. [Collector Cost](#20-collector-cost)
21. [`groupingBy` vs `groupingByConcurrent` Performance](#21-groupingby-vs-groupingbyconcurrent-performance)
22. [Memory Bandwidth](#22-memory-bandwidth)
23. [Allocation and GC Pressure](#23-allocation-and-gc-pressure)
24. [Primitive Streams and Boxing](#24-primitive-streams-and-boxing)
25. [Cache Locality](#25-cache-locality)
26. [Load Balance and Skew](#26-load-balance-and-skew)
27. [False Sharing and Contention](#27-false-sharing-and-contention)
28. [Parallelism Level and CPU Limits](#28-parallelism-level-and-cpu-limits)
29. [Containers and Cloud Runtime Effects](#29-containers-and-cloud-runtime-effects)
30. [Benchmarking Methodology](#30-benchmarking-methodology)
31. [JMH Benchmark Skeleton](#31-jmh-benchmark-skeleton)
32. [What to Measure](#32-what-to-measure)
33. [Profiling and Diagnostics](#33-profiling-and-diagnostics)
34. [Performance Case Studies](#34-performance-case-studies)
35. [Common Anti-Patterns](#35-common-anti-patterns)
36. [Production Failure Modes](#36-production-failure-modes)
37. [Best Practices](#37-best-practices)
38. [Decision Matrix](#38-decision-matrix)
39. [Latihan](#39-latihan)
40. [Ringkasan](#40-ringkasan)
41. [Referensi](#41-referensi)

---

# 1. Tujuan Bagian Ini

Setelah correctness, pertanyaan berikutnya:

```text
Apakah parallel stream benar-benar lebih cepat?
```

Jawaban jujurnya:

```text
Tergantung.
```

Parallel stream bisa sangat membantu jika workload cocok:

```text
large bounded data + good splitting source + CPU-heavy independent work + low combine cost + low ordering constraint
```

Tetapi parallel stream juga sering lebih lambat jika:

- data kecil;
- operasi murah;
- source sulit dibelah;
- pipeline punya stateful barrier;
- output harus ordered;
- collector/combiner mahal;
- banyak boxing/allocation;
- workload IO-bound/blocking;
- common pool sibuk;
- memory bandwidth sudah bottleneck;
- container CPU terbatas;
- nested parallel stream;
- benchmark tidak benar.

Tujuan bagian ini:

- membangun cost model parallel stream;
- memahami bottleneck utama;
- memahami kapan speedup realistis;
- memahami benchmark/profiling;
- memahami production tuning dan decision matrix.

---

# 2. Mental Model: Speedup Harus Membayar Overhead

Parallel stream menambahkan overhead:

```text
sequential work
+ split overhead
+ task scheduling overhead
+ thread coordination
+ partial result allocation
+ combine overhead
+ order preservation overhead
+ memory/GC overhead
```

Parallel stream menang jika:

```text
saved time from parallel CPU work > added overhead
```

## 2.1 Jika work murah

```java
list.parallelStream()
    .map(x -> x + 1)
    .toList();
```

Overhead bisa lebih besar dari manfaat.

## 2.2 Jika work mahal

```java
items.parallelStream()
    .map(this::expensiveHashOrSimulation)
    .toList();
```

Parallel bisa membantu.

## 2.3 Main rule

```text
Parallel stream is not free speed.
It is a trade: extra coordination cost for possible CPU concurrency.
```

---

# 3. Performance Formula Sederhana

Model kasar:

```text
T_parallel =
  T_split
+ T_schedule
+ max(T_partition_work)
+ T_combine
+ T_order_coordination
+ T_memory_gc
```

Sequential:

```text
T_sequential =
  T_work_all_in_one_thread
```

Parallel useful if:

```text
T_parallel < T_sequential
```

## 3.1 Important

`max(T_partition_work)` matters because total runtime follows slowest partition.

## 3.2 Skew

If one partition has much more expensive elements, speedup drops.

## 3.3 Rule

Parallel time is dominated by slowest partition plus overhead.

---

# 4. Amdahl's Law Mental Model

Amdahl's Law says speedup is limited by non-parallelizable portion.

If 80% can be parallelized and 20% is serial:

```text
maximum speedup is bounded
```

Even infinite CPU cannot eliminate serial part.

## 4.1 In stream pipeline

Serial-like parts include:

- splitting poor source;
- stateful barriers;
- ordered result coordination;
- combine phase;
- synchronized side effects;
- GC pauses;
- IO waiting.

## 4.2 Rule

Parallel speedup is limited by the parts of pipeline that cannot run independently.

---

# 5. Spliterator Quality

Parallel stream depends on `Spliterator`.

Good spliterator provides:

- efficient `trySplit`;
- accurate `estimateSize`;
- useful `SIZED`/`SUBSIZED`;
- balanced partitions;
- low traversal overhead.

## 5.1 Poor spliterator

If `trySplit` cannot split well, parallelism is limited.

## 5.2 Characteristics matter

`Spliterator` characteristics can help stream framework optimize computation.

## 5.3 Rule

If source cannot split efficiently, parallel stream rarely performs well.

---

# 6. Good Sources for Parallel Streams

## 6.1 Arrays

```java
Arrays.stream(array).parallel()
```

Good size knowledge and indexing.

## 6.2 ArrayList

Backed by array; good random access/splitting.

## 6.3 Primitive ranges

```java
IntStream.range(0, n).parallel()
```

Excellent splitting.

## 6.4 Primitive arrays

Avoid boxing, good locality.

## 6.5 Rule

Best parallel sources are sized, indexed, and balanced.

---

# 7. Poor Sources for Parallel Streams

## 7.1 LinkedList

Poor cache locality and splitting compared with ArrayList.

## 7.2 Iterator-backed stream

Unknown size and limited splitting.

## 7.3 Files.lines

IO-bound, lazy, line splitting may not match CPU parallelism.

## 7.4 Stream.generate

No natural finite size; splitting poor/unsafe.

## 7.5 Stream.iterate

Sequential recurrence unless bounded/splittable pattern.

## 7.6 Rule

Poor source splitting can erase parallel benefit before computation begins.

---

# 8. Work Granularity

Work granularity = amount of useful work per element or per chunk.

## 8.1 Too fine-grained

```java
.map(x -> x + 1)
```

Cheap operation.

## 8.2 Coarse enough

```java
.map(this::cpuHeavyTransform)
```

Expensive operation.

## 8.3 Chunk overhead

Each task has scheduling overhead. Work per chunk must amortize it.

## 8.4 Rule

Parallel stream needs enough CPU work per element/chunk.

---

# 9. Cheap Operations Usually Lose

Example:

```java
long count = IntStream.range(0, 1_000_000)
    .parallel()
    .map(i -> i + 1)
    .count();
```

May not even execute map if count can be derived, and if it does, work is too cheap.

## 9.1 Cheap pipeline examples

- simple getter;
- primitive addition;
- small string concat;
- boolean predicate;
- list copy.

## 9.2 Rule

Do not parallelize cheap transformations unless data size and benchmark justify it.

---

# 10. CPU-Bound Workload

Parallel streams are usually best for CPU-bound work.

Examples:

- CPU-heavy parsing after data already in memory;
- cryptographic hashing over many independent payloads;
- image processing;
- simulation;
- scoring;
- expensive validation rules;
- numeric computation over arrays.

## 10.1 Good example

```java
List<Result> results = inputs.parallelStream()
    .map(this::expensivePureComputation)
    .toList();
```

## 10.2 Requirements

- no blocking;
- no shared mutable state;
- good source splitting;
- enough data.

## 10.3 Rule

Parallel streams are primarily a CPU data parallelism tool.

---

# 11. IO-Bound Workload

IO-bound work often performs poorly or dangerously with parallel stream.

Bad:

```java
ids.parallelStream()
    .map(repository::findById)
    .toList();
```

## 11.1 Problems

- blocks common pool workers;
- no rate limiting;
- no backpressure;
- no explicit timeout/retry policy;
- can overload database;
- hides concurrency level.

## 11.2 Better

- SQL query with `WHERE id IN (...)`;
- batch API;
- bounded ExecutorService;
- virtual threads with semaphore/rate limit;
- reactive pipeline;
- queue worker model.

## 11.3 Rule

Parallel stream is not an IO concurrency framework.

---

# 12. Blocking and Common Pool Contention

Parallel streams usually use ForkJoin common pool.

The common pool is shared.

## 12.1 Problem

Blocking tasks occupy worker threads.

```java
requests.parallelStream()
    .forEach(client::sendBlocking);
```

## 12.2 Consequence

Other tasks using common pool can suffer.

## 12.3 Custom pool?

Some code submits parallel stream work inside custom ForkJoinPool, but this is advanced and can still be confusing. Prefer explicit concurrency tools for blocking IO.

## 12.4 Rule

Never block common pool casually.

---

# 13. Ordering Cost

Order preservation can reduce parallelism.

Costly operations:

```java
findFirst
forEachOrdered
ordered limit
ordered skip
stable distinct
ordered collect
```

## 13.1 Why

Framework must coordinate partitions to preserve encounter order.

## 13.2 If order irrelevant

Use:

```java
unordered()
findAny()
forEach()
```

where semantically correct.

## 13.3 Rule

Order is a correctness feature with performance cost.

---

# 14. Stateful Barrier Cost

Stateful operations need memory/state across elements.

Examples:

```java
sorted
distinct
limit
skip
takeWhile
dropWhile
```

## 14.1 Barrier

Some stateful operations delay downstream processing or require global coordination.

## 14.2 Rule

A single stateful barrier can dominate the pipeline cost.

---

# 15. `sorted()` Cost

`sorted()` requires global ordering.

## 15.1 Cost

- buffers elements;
- compares elements;
- merges sorted partitions;
- allocates memory;
- imposes order.

## 15.2 Top-1 anti-pattern

Bad:

```java
stream.parallel()
    .sorted(comparator)
    .findFirst();
```

Better:

```java
stream.parallel()
    .min(comparator);
```

## 15.3 Top-N

`sorted().limit(n)` sorts all elements.

For huge data, consider bounded priority queue collector.

## 15.4 Rule

Avoid full sort when min/max/top-N specialized algorithm is enough.

---

# 16. `distinct()` Cost

`distinct()` needs tracking seen elements.

## 16.1 Ordered distinct

Stable distinct on ordered parallel stream can be expensive.

## 16.2 Unordered distinct

If order irrelevant:

```java
parallelStream.unordered().distinct()
```

may reduce coordination.

## 16.3 Memory

Needs memory proportional to number of unique elements.

## 16.4 Rule

Distinct is a set-building operation; watch memory and order constraints.

---

# 17. `limit()` and `skip()` Cost

## 17.1 Ordered limit

Must return first N elements in encounter order.

## 17.2 Ordered skip

Must discard first N elements in encounter order.

## 17.3 Unordered limit

If any N elements acceptable:

```java
parallelStream.unordered().limit(n)
```

can be cheaper.

## 17.4 Pagination warning

`skip/limit` over large in-memory stream is not database pagination.

## 17.5 Rule

Ordered slicing is often expensive in parallel.

---

# 18. `unordered()` as Optimization

`unordered()` removes encounter order constraint.

## 18.1 Use cases

```java
items.parallelStream()
    .unordered()
    .distinct()
    .count();
```

```java
items.parallelStream()
    .unordered()
    .limit(100)
    .toList();
```

## 18.2 Not a shuffle

It does not randomize; it relaxes order requirement.

## 18.3 Rule

Use unordered only when output order is truly irrelevant.

---

# 19. Reduction and Combiner Cost

Parallel reduction creates partial results and combines them.

## 19.1 Cheap combiner

```java
Long::sum
Integer::max
BigDecimal::add
```

Usually okay.

## 19.2 Expensive combiner

```java
list.addAll(hugeList)
map.merge all keys
string concatenation
```

Can dominate.

## 19.3 Rule

Parallel reduction performance depends heavily on combiner cost.

---

# 20. Collector Cost

Collectors allocate and combine containers.

## 20.1 toList

Partial lists then combined.

## 20.2 groupingBy

Partial maps then merged. Expensive if many keys.

## 20.3 toMap

Partial maps then merged, duplicate merge logic applied.

## 20.4 joining

Partial builders/strings combined.

## 20.5 Rule

Collectors can become the bottleneck, especially map/group collectors.

---

# 21. `groupingBy` vs `groupingByConcurrent` Performance

## 21.1 groupingBy

Parallel `groupingBy` creates partial maps and merges.

Good when:

- key distribution is moderate;
- order/map type matters;
- combine cost acceptable.

## 21.2 groupingByConcurrent

Accumulates into concurrent map.

Good when:

- unordered result acceptable;
- many keys;
- contention manageable;
- concurrent collector semantics fit.

## 21.3 Hot key problem

If many elements map to same key, concurrent updates contend heavily.

## 21.4 Rule

`groupingByConcurrent` is not automatically faster; key distribution decides.

---

# 22. Memory Bandwidth

CPU cores share memory bandwidth.

Parallel code can saturate memory bandwidth before CPU.

## 22.1 Symptoms

- CPU not fully utilized;
- speedup plateaus;
- GC/allocation high;
- cache misses high.

## 22.2 Pointer-heavy collections

Linked structures and object graphs hurt locality.

## 22.3 Rule

Parallelism cannot overcome memory bandwidth limits.

---

# 23. Allocation and GC Pressure

Parallel streams can allocate more temporary objects:

- partial containers;
- boxed values;
- lambdas/captures in some patterns;
- mapped DTOs;
- grouping maps/lists;
- sorted buffers.

## 23.1 More allocation

More worker threads can allocate concurrently, increasing GC pressure.

## 23.2 Fix

- primitive streams;
- avoid boxing;
- avoid unnecessary materialization;
- pre-aggregate;
- use arrays/ranges;
- reduce intermediate objects.

## 23.3 Rule

Parallel speedup can disappear under allocation and GC pressure.

---

# 24. Primitive Streams and Boxing

Primitive streams reduce boxing overhead.

## 24.1 Better

```java
long total = orders.parallelStream()
    .mapToLong(Order::amountInCents)
    .sum();
```

## 24.2 Worse

```java
Long total = orders.parallelStream()
    .map(Order::amountInCents)
    .reduce(0L, Long::sum);
```

Potential boxing.

## 24.3 Rule

For numeric parallel pipelines, prefer primitive streams.

---

# 25. Cache Locality

Cache locality matters.

## 25.1 Array/range

Good locality.

## 25.2 LinkedList/object graph

Poor locality.

## 25.3 Maps/sets

Hash table traversal can be less cache-friendly.

## 25.4 Rule

Parallel streams over contiguous data often perform better than pointer-heavy data structures.

---

# 26. Load Balance and Skew

Parallel tasks need balanced work.

## 26.1 Equal element count not equal work

Some elements may be more expensive.

Example:

```java
orders.parallelStream()
    .map(this::validate)
```

Some orders trigger expensive validation.

## 26.2 Work stealing helps

ForkJoin work stealing can help, but cannot eliminate all skew.

## 26.3 Rule

Skewed per-element work reduces parallel speedup.

---

# 27. False Sharing and Contention

Shared counters or arrays can create contention.

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

## 27.3 LongAdder?

Good for concurrent counters, but stream reduction often better.

## 27.4 Rule

Avoid shared mutable hot spots.

---

# 28. Parallelism Level and CPU Limits

Parallel stream common pool parallelism is related to available processors by default.

## 28.1 Available processors

In containers, CPU quota affects actual capacity.

## 28.2 Too much parallelism

Can cause context switching and contention.

## 28.3 Too little parallelism

Cannot use CPU fully.

## 28.4 Rule

Parallel stream behavior depends on runtime CPU availability and pool contention.

---

# 29. Containers and Cloud Runtime Effects

In Kubernetes/cloud:

- CPU requests/limits matter;
- noisy neighbors matter;
- throttling matters;
- common pool is per JVM;
- multiple request threads may call parallel streams concurrently;
- p99 latency can worsen.

## 29.1 Request path caution

Parallel stream inside web request can create burst CPU usage and affect other requests.

## 29.2 Rule

In services, optimize for throughput and tail latency, not just single-call speed.

---

# 30. Benchmarking Methodology

Benchmark with discipline.

## 30.1 Avoid

```java
long start = System.nanoTime();
runOnce();
long time = System.nanoTime() - start;
```

Not enough.

## 30.2 Use JMH for microbenchmarks

JMH handles:

- warmup;
- measurement iterations;
- forks;
- dead-code elimination protection.

## 30.3 Macrobenchmark too

For service workloads, measure:

- request latency;
- throughput;
- CPU;
- GC;
- pool contention;
- database/network impact.

## 30.4 Rule

Use JMH for isolated computation and production-like benchmark for end-to-end behavior.

---

# 31. JMH Benchmark Skeleton

Example conceptual skeleton:

```java
@State(Scope.Thread)
public class ParallelStreamBenchmark {
    private List<Input> inputs;

    @Setup
    public void setup() {
        inputs = createInputs(1_000_000);
    }

    @Benchmark
    public long sequential() {
        return inputs.stream()
            .mapToLong(this::compute)
            .sum();
    }

    @Benchmark
    public long parallel() {
        return inputs.parallelStream()
            .mapToLong(this::compute)
            .sum();
    }

    private long compute(Input input) {
        return expensiveCpuWork(input);
    }
}
```

## 31.1 Compare apples to apples

Same data, same computation, same result.

## 31.2 Validate output

Benchmark must not remove computation as dead code.

## 31.3 Rule

Benchmark correctness first, then performance.

---

# 32. What to Measure

Measure:

## 32.1 Time

- average;
- p50/p95/p99;
- throughput.

## 32.2 CPU

- utilization;
- user/system time;
- throttling.

## 32.3 GC

- allocation rate;
- pause time;
- GC frequency.

## 32.4 Threads

- common pool activity;
- blocked/waiting threads.

## 32.5 Memory

- heap usage;
- temporary object count.

## 32.6 Result correctness

Sequential vs parallel result equivalence.

## 32.7 Rule

Performance without correctness and resource metrics is incomplete.

---

# 33. Profiling and Diagnostics

Useful tools:

- JFR;
- async-profiler;
- Java Mission Control;
- JMH profilers;
- `jcmd`;
- GC logs;
- OS CPU metrics;
- container CPU throttling metrics;
- application p95/p99 latency.

## 33.1 What to look for

- fork/join worker blocking;
- high allocation;
- collector combiner hotspots;
- hash/comparator hotspots;
- sorting cost;
- lock contention;
- Atomic/ConcurrentHashMap contention;
- GC pressure.

## 33.2 Rule

Profile before tuning.

---

# 34. Performance Case Studies

## 34.1 Case A: Primitive range CPU compute

```java
long result = LongStream.range(0, n)
    .parallel()
    .map(this::expensiveCpu)
    .sum();
```

Likely good if `n` large and compute expensive.

## 34.2 Case B: ArrayList DTO mapping

```java
list.parallelStream()
    .map(Dto::from)
    .toList();
```

May help if mapping expensive; may hurt if mapping cheap/allocation-heavy.

## 34.3 Case C: groupingBy many keys

```java
events.parallelStream()
    .collect(groupingBy(Event::type, counting()));
```

May be dominated by map merge.

## 34.4 Case D: HTTP call per element

```java
ids.parallelStream()
    .map(client::fetch)
    .toList();
```

Bad abstraction.

## 34.5 Case E: sorted limit

```java
items.parallelStream()
    .sorted(comparator)
    .limit(10)
```

Full sort; maybe not optimal for top-N.

## 34.6 Rule

Parallel stream suitability is pipeline-specific.

---

# 35. Common Anti-Patterns

## 35.1 Add `.parallel()` without benchmark

Bad.

## 35.2 Parallel cheap map/filter

Usually bad.

## 35.3 Parallel DB/network calls

Wrong tool.

## 35.4 External mutable state

Correctness and performance issue.

## 35.5 Ordered operations in parallel unnecessarily

Slow.

## 35.6 groupingBy high-cardinality in parallel without measuring

Can be slower.

## 35.7 sorted().limit(n) for top-N huge data

Expensive.

## 35.8 Boxing in numeric parallel pipeline

Allocation overhead.

## 35.9 Nested parallel streams

Pool contention.

## 35.10 Ignoring container CPU limits

Production surprise.

---

# 36. Production Failure Modes

## 36.1 Slower after parallelization

Cause: overhead > work.

## 36.2 CPU spike and p99 latency regression

Cause: parallel stream inside request path.

## 36.3 Common pool starvation

Cause: blocking tasks.

## 36.4 GC pressure increase

Cause: parallel allocation/materialization.

## 36.5 DB overload

Cause: parallel repository calls.

## 36.6 Incorrect result

Cause: non-associative reduction/shared state.

## 36.7 Nondeterministic order

Cause: unordered/parallel terminal.

## 36.8 Hot key contention

Cause: groupingByConcurrent on skewed keys.

## 36.9 No speedup despite full CPU

Cause: memory bandwidth bottleneck.

## 36.10 Flaky benchmark

Cause: no warmup/no forks/dead-code elimination.

---

# 37. Best Practices

## 37.1 Correctness first

Never benchmark wrong code.

## 37.2 Start sequential

Make baseline.

## 37.3 Use parallel for CPU-bound data-parallel workloads

Not IO orchestration.

## 37.4 Choose good source

Array/range/ArrayList/primitive arrays.

## 37.5 Increase work granularity

Parallelize meaningful work.

## 37.6 Avoid stateful barriers when possible

Use min/max/top-N alternatives.

## 37.7 Relax order if correct

Use `unordered()` and `findAny`.

## 37.8 Use primitive streams

Avoid boxing.

## 37.9 Avoid shared mutable state

Use reductions/collectors.

## 37.10 Benchmark with JMH and production metrics

Measure throughput, latency, CPU, GC.

---

# 38. Decision Matrix

| Condition | Parallel Stream Fit |
|---|---|
| large bounded data | good |
| ArrayList/array/range source | good |
| CPU-heavy pure function | good |
| primitive numeric reduction | good |
| cheap map/filter | poor |
| small dataset | poor |
| IO-bound operation | poor |
| blocking DB/network | poor |
| source is iterator/IO/generate | poor |
| requires strict order | costly |
| uses sorted/distinct heavily | measure carefully |
| uses groupingBy with many keys | measure carefully |
| hot key grouping | likely contention |
| external mutable state | invalid |
| non-associative reduce | invalid |
| common pool already busy | risky |
| service p99 critical | risky |
| container CPU throttled | risky |
| benchmark shows speedup | possible |
| no benchmark | do not assume |

---

# 39. Latihan

## Latihan 1 — Cost Model

For a pipeline, estimate split, work, combine, order, memory cost.

## Latihan 2 — Cheap Operation

Explain why parallelizing `map(x -> x + 1)` may be slower.

## Latihan 3 — CPU Heavy Range

Design a benchmark for `LongStream.range(...).parallel()` with CPU-heavy computation.

## Latihan 4 — Source Quality

Compare ArrayList vs LinkedList as parallel stream source conceptually.

## Latihan 5 — Ordered Limit

Explain why ordered `parallel().limit(100)` may be costly.

## Latihan 6 — Grouping Performance

Compare `groupingBy` vs `groupingByConcurrent` for low-cardinality vs high-cardinality keys.

## Latihan 7 — IO Alternative

Replace parallel stream HTTP calls with bounded executor/virtual-thread design.

## Latihan 8 — Boxing

Rewrite `Stream<Integer>` numeric aggregation into `IntStream`.

## Latihan 9 — Top-N

Explain why `sorted().limit(10)` sorts all input and design bounded heap alternative.

## Latihan 10 — Production Metrics

List metrics you would check after enabling parallel stream in service endpoint.

---

# 40. Ringkasan

Parallel stream performance is not automatic.

Core lessons:

- Parallel stream speedup must exceed splitting/scheduling/combining/order/memory overhead.
- Good sources split well: arrays, ranges, ArrayList.
- Poor sources limit speedup: iterators, IO, LinkedList, generate/iterate.
- Work must be CPU-heavy enough.
- IO-bound work should not use parallel streams as concurrency framework.
- Common pool is shared and blocking can starve it.
- Ordering constraints reduce parallel benefit.
- Stateful barriers like sorted/distinct/ordered limit can dominate cost.
- `unordered()` can help only when order does not matter.
- Combiner and collector cost can dominate.
- groupingByConcurrent is not automatically faster.
- Memory bandwidth, allocation, GC, and cache locality matter.
- Primitive streams avoid boxing overhead.
- Load skew reduces speedup.
- Containers/cloud CPU limits affect behavior.
- Benchmark with JMH and production-like metrics.
- Always compare against sequential baseline.
- Correctness comes before performance.

Main rule:

```text
Parallel stream is a performance optimization for bounded CPU data parallelism.
Use it only when source splits well, work is heavy enough, reduction is correct, ordering is affordable, and measurements prove speedup.
```

---

# 41. Referensi

1. Java SE 25 — `java.util.stream` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

2. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

3. Java SE 25 — `Spliterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterator.html

4. Java SE 25 — `ForkJoinPool`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinPool.html

5. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

6. Java SE 25 — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

7. Java SE 25 — `BaseStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/BaseStream.html

8. Java SE 25 — `IntStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.html

9. OpenJDK JMH  
   https://openjdk.org/projects/code-tools/jmh/

10. OpenJDK — Stream package source  
    https://github.com/openjdk/jdk/tree/master/src/java.base/share/classes/java/util/stream

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Collections and Streams — Part 038](./learn-java-collections-and-streams-part-038.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Collections and Streams — Part 040](./learn-java-collections-and-streams-part-040.md)

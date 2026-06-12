# learn-java-concurrency-and-reactive-part-023.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 023  
# Parallel Streams Revisited from Concurrency Perspective: ForkJoin, Common Pool, Spliterator, Reduction, Ordering, Side Effects, and Production Pitfalls

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **023**  
> Fokus: memahami ulang **Parallel Streams** dari perspektif concurrency dan parallelism. Parallel stream bukan “tinggal tambah `.parallel()` supaya cepat”. Ia adalah mekanisme data-parallel berbasis splitting, ForkJoin common pool, reduction, spliterator characteristics, ordering semantics, non-interference, stateless functions, associativity, dan cost model. Bagian ini membahas kapan parallel stream cocok, kapan berbahaya, kenapa blocking I/O di parallel stream buruk, kenapa side effect berbahaya, bagaimana reduction yang benar, serta strategi production-safe.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Parallel Stream Bukan Magic Performance Switch](#2-parallel-stream-bukan-magic-performance-switch)
3. [Stream Recap](#3-stream-recap)
4. [Sequential vs Parallel Stream](#4-sequential-vs-parallel-stream)
5. [Mental Model: Data Parallelism](#5-mental-model-data-parallelism)
6. [Under the Hood: Splitting and ForkJoin](#6-under-the-hood-splitting-and-forkjoin)
7. [Common Pool](#7-common-pool)
8. [Spliterator](#8-spliterator)
9. [Spliterator Characteristics](#9-spliterator-characteristics)
10. [Source Matters](#10-source-matters)
11. [Intermediate and Terminal Operations](#11-intermediate-and-terminal-operations)
12. [Stateless Operations](#12-stateless-operations)
13. [Non-Interference](#13-noninterference)
14. [Side Effects: The Big Warning](#14-side-effects-the-big-warning)
15. [Shared Mutable State Pitfall](#15-shared-mutable-state-pitfall)
16. [Correct Collection with `collect`](#16-correct-collection-with-collect)
17. [Reduction Mental Model](#17-reduction-mental-model)
18. [Associativity and Identity](#18-associativity-and-identity)
19. [Floating Point Reduction](#19-floating-point-reduction)
20. [Ordering and Encounter Order](#20-ordering-and-encounter-order)
21. [`forEach` vs `forEachOrdered`](#21-foreach-vs-foreachordered)
22. [Stateful Operations](#22-stateful-operations)
23. [`sorted`, `distinct`, `limit`, `skip`](#23-sorted-distinct-limit-skip)
24. [Primitive Streams](#24-primitive-streams)
25. [Boxing and Allocation](#25-boxing-and-allocation)
26. [Granularity and Data Size](#26-granularity-and-data-size)
27. [CPU-Bound Suitability](#27-cpubound-suitability)
28. [Blocking I/O Pitfall](#28-blocking-io-pitfall)
29. [Parallel Streams and Virtual Threads](#29-parallel-streams-and-virtual-threads)
30. [Parallel Streams and CompletableFuture](#30-parallel-streams-and-completablefuture)
31. [Parallel Streams in Web Applications](#31-parallel-streams-in-web-applications)
32. [Custom ForkJoinPool: Should You?](#32-custom-forkjoinpool-should-you)
33. [Collectors in Parallel](#33-collectors-in-parallel)
34. [Concurrent Collectors](#34-concurrent-collectors)
35. [`groupingBy` vs `groupingByConcurrent`](#35-groupingby-vs-groupingbyconcurrent)
36. [Debugging Parallel Streams](#36-debugging-parallel-streams)
37. [Benchmarking Parallel Streams](#37-benchmarking-parallel-streams)
38. [Mini Case Study: Bad Shared ArrayList](#38-mini-case-study-bad-shared-arraylist)
39. [Mini Case Study: Parallel DB Calls Gone Wrong](#39-mini-case-study-parallel-db-calls-gone-wrong)
40. [Mini Case Study: Correct Parallel Aggregation](#40-mini-case-study-correct-parallel-aggregation)
41. [Common Anti-Patterns](#41-common-antipatterns)
42. [Best Practices](#42-best-practices)
43. [Decision Matrix](#43-decision-matrix)
44. [Latihan](#44-latihan)
45. [Ringkasan](#45-ringkasan)
46. [Referensi](#46-referensi)

---

# 1. Tujuan Bagian Ini

Parallel stream sering menggoda:

```java
list.parallelStream()
    .map(this::process)
    .toList();
```

Terlihat seperti:

```text
tinggal tambah parallel dan program jadi lebih cepat
```

Tetapi parallel stream adalah alat yang punya prasyarat:

- data cukup besar;
- operasi CPU-bound;
- operasi stateless;
- operasi non-interfering;
- reduction associative;
- tidak bergantung pada ordering kecuali sadar cost;
- tidak melakukan blocking I/O;
- tidak menulis shared mutable state;
- source mudah di-split;
- common pool tidak sedang dipakai workload lain.

Target bagian ini:

```text
Mampu memakai parallel stream secara benar,
mampu mengenali kapan parallel stream buruk,
dan mampu memilih alternatif seperti sequential stream,
ForkJoinPool custom, virtual threads, CompletableFuture,
atau pipeline bounded.
```

---

# 2. Parallel Stream Bukan Magic Performance Switch

Parallel stream bisa mempercepat.

Parallel stream juga bisa memperlambat.

Kenapa?

Karena parallelization punya overhead:

- splitting data;
- scheduling task;
- worker coordination;
- combining result;
- memory allocation;
- synchronization in collectors;
- common pool contention;
- loss of locality;
- ordering constraints.

Jika workload kecil:

```text
overhead > benefit
```

Jika workload blocking I/O:

```text
common pool workers blocked
```

Jika operasi punya side effect:

```text
race/incorrect result
```

## 2.1 Main rule

```text
Parallel stream is a data-parallel CPU tool, not a general concurrency tool.
```

---

# 3. Stream Recap

Stream pipeline:

```java
List<String> names = users.stream()
    .filter(User::active)
    .map(User::name)
    .toList();
```

Pipeline terdiri dari:

## 3.1 Source

```java
users
```

## 3.2 Intermediate operations

```java
filter
map
sorted
distinct
```

## 3.3 Terminal operation

```java
toList
collect
reduce
forEach
sum
```

## 3.4 Lazy evaluation

Intermediate operations dievaluasi saat terminal operation dipanggil.

## 3.5 Main rule

```text
Stream describes a computation over data; terminal operation executes it.
```

---

# 4. Sequential vs Parallel Stream

Sequential:

```java
users.stream()
```

Parallel:

```java
users.parallelStream()
```

or:

```java
users.stream().parallel()
```

## 4.1 Sequential

One logical flow.

Easier to reason.

## 4.2 Parallel

Data split into partitions processed concurrently.

## 4.3 Conversion

A stream pipeline is either sequential or parallel as a mode.

Calling `.parallel()` switches mode.

## 4.4 Main rule

```text
parallel() changes execution strategy, not business semantics.
Your operations must be valid under parallel execution.
```

---

# 5. Mental Model: Data Parallelism

Parallel stream is best understood as:

```text
split source into chunks
process chunks independently
combine results
```

Example sum:

```text
[1..1_000_000]
split into chunks
sum each chunk
add partial sums
```

Good when:

- per-element work independent;
- combine operation cheap and associative;
- data can split efficiently.

Bad when:

- each element depends on previous;
- shared mutable state;
- blocking I/O;
- strict ordering with expensive stateful operations.

## 5.1 Main rule

```text
Parallel stream works best when each element can be processed independently.
```

---

# 6. Under the Hood: Splitting and ForkJoin

Parallel stream uses splitting of source and ForkJoin-style execution.

Conceptually:

```text
source.spliterator()
trySplit()
process partition
combine
```

Workers process chunks in parallel, commonly using ForkJoin common pool.

## 6.1 Why splitting matters

ArrayList splits well.

LinkedList splits poorly.

IO stream source may not split well.

## 6.2 Main rule

```text
Parallel stream performance depends heavily on source splittability.
```

---

# 7. Common Pool

Parallel streams usually use `ForkJoinPool.commonPool()`.

This pool is shared by:

- parallel streams;
- `CompletableFuture` async methods without explicit executor;
- other library/application tasks.

## 7.1 Risk

If parallel stream blocks, it can starve unrelated common pool work.

## 7.2 Server app caution

In application server, many requests using parallel streams can contend for same common pool.

## 7.3 Main rule

```text
The common pool is shared infrastructure.
Do not use it as if it were private capacity.
```

---

# 8. Spliterator

`Spliterator` means:

```text
splitable iterator
```

It supports traversing and splitting source.

Important methods conceptually:

```java
trySplit()
tryAdvance()
estimateSize()
characteristics()
```

## 8.1 Parallel stream depends on trySplit

If splitting is efficient, parallelism can be effective.

If splitting is poor, parallelism suffers.

## 8.2 Main rule

```text
Spliterator quality determines how well a stream source can be parallelized.
```

---

# 9. Spliterator Characteristics

Characteristics can include:

- `ORDERED`;
- `DISTINCT`;
- `SORTED`;
- `SIZED`;
- `SUBSIZED`;
- `NONNULL`;
- `IMMUTABLE`;
- `CONCURRENT`.

## 9.1 SIZED/SUBSIZED

Good for partitioning.

## 9.2 ORDERED

May impose ordering constraints.

## 9.3 CONCURRENT

Source can be safely concurrently modified/traversed in certain ways.

## 9.4 Main rule

```text
Stream source characteristics affect correctness and optimization opportunities.
```

---

# 10. Source Matters

Good sources for parallel:

## 10.1 ArrayList / arrays

Good random access and splitting.

## 10.2 IntStream.range

Excellent splitting.

```java
IntStream.range(0, n).parallel()
```

## 10.3 HashSet

Can split, unordered.

## 10.4 Poorer sources

- LinkedList;
- iterator-only sources;
- IO lines stream;
- generated infinite streams;
- sources with expensive traversal.

## 10.5 Main rule

```text
Not all streams are equally parallelizable.
Start with source splittability.
```

---

# 11. Intermediate and Terminal Operations

Operations differ in parallel-friendliness.

## 11.1 Stateless intermediate

Good:

```java
map
filter
```

if function is pure/stateless.

## 11.2 Stateful intermediate

Potentially expensive:

```java
sorted
distinct
limit
skip
```

especially with ordered streams.

## 11.3 Terminal

Reduction/collect/forEach have different semantics.

## 11.4 Main rule

```text
Operation semantics can dominate parallel stream performance.
```

---

# 12. Stateless Operations

Stateless operation does not depend on mutable state that changes during pipeline.

Good:

```java
.map(x -> x * x)
.filter(x -> x > 0)
```

Bad:

```java
.map(x -> counter++)
```

## 12.1 Thread-safe but still poor

Even atomic counter:

```java
AtomicInteger counter = new AtomicInteger();
.map(x -> counter.incrementAndGet())
```

This creates contention and hidden ordering issue.

## 12.2 Main rule

```text
Parallel stream functions should be stateless and side-effect-free.
```

---

# 13. Non-Interference

Non-interference means stream operations should not modify the source or data structures involved during traversal.

Bad:

```java
list.parallelStream()
    .forEach(x -> list.remove(x));
```

## 13.1 Why

Parallel traversal assumes source not structurally interfered with unless source supports concurrent behavior.

## 13.2 Main rule

```text
Do not mutate the stream source while streaming it.
```

---

# 14. Side Effects: The Big Warning

Side effects in parallel stream are dangerous.

Bad:

```java
List<Result> results = new ArrayList<>();

inputs.parallelStream()
    .forEach(input -> results.add(process(input)));
```

Problems:

- `ArrayList` not thread-safe;
- lost updates;
- corrupted state;
- unpredictable ordering.

## 14.1 “Fix” with synchronized list?

```java
List<Result> results = Collections.synchronizedList(new ArrayList<>());
```

Correct maybe, but contention may kill performance.

Better:

```java
List<Result> results = inputs.parallelStream()
    .map(this::process)
    .toList();
```

## 14.2 Main rule

```text
Use stream result operations, not shared side effects.
```

---

# 15. Shared Mutable State Pitfall

Bad aggregation:

```java
Map<String, Long> counts = new HashMap<>();

items.parallelStream().forEach(item -> {
    counts.merge(item.type(), 1L, Long::sum);
});
```

Not thread-safe.

Even with `ConcurrentHashMap`, if operation high-contention, performance may suffer.

Better:

```java
Map<String, Long> counts = items.parallelStream()
    .collect(Collectors.groupingBy(Item::type, Collectors.counting()));
```

or concurrent collector when appropriate.

## 15.1 Main rule

```text
Shared mutable state is the enemy of parallel stream scalability.
```

---

# 16. Correct Collection with `collect`

Use collectors:

```java
List<Result> results = inputs.parallelStream()
    .map(this::process)
    .collect(Collectors.toList());
```

Modern:

```java
List<Result> results = inputs.parallelStream()
    .map(this::process)
    .toList();
```

## 16.1 Collector handles combination

The stream framework can create partial containers and merge them.

## 16.2 Main rule

```text
Use collect/reduce so the framework can manage per-task accumulation and combination.
```

---

# 17. Reduction Mental Model

Reduction combines elements into one result.

Example:

```java
int sum = numbers.parallelStream()
    .reduce(0, Integer::sum);
```

Parallel reduction:

```text
chunk 1 -> partial sum
chunk 2 -> partial sum
combine partials
```

## 17.1 Requirements

- identity correct;
- accumulator associative;
- combiner compatible;
- no side effects.

## 17.2 Main rule

```text
Parallel reduction is correct only when partial results can be combined in any valid grouping.
```

---

# 18. Associativity and Identity

Associative operation:

```text
(a op b) op c == a op (b op c)
```

Identity:

```text
identity op x == x
```

Good:

```java
reduce(0, Integer::sum)
```

Bad:

```java
reduce(0, (a, b) -> a - b)
```

Subtraction not associative.

## 18.1 Main rule

```text
If reduction is not associative, parallel result may be wrong or surprising.
```

---

# 19. Floating Point Reduction

Floating point addition is mathematically associative but not exactly associative in binary floating-point due to rounding.

Parallel sum may differ from sequential sum.

```java
double sum = values.parallelStream()
    .mapToDouble(Double::doubleValue)
    .sum();
```

## 19.1 If exact reproducibility required

Use:

- sequential deterministic order;
- BigDecimal if appropriate;
- compensated summation;
- domain-specific tolerance.

## 19.2 Main rule

```text
Parallel floating-point reduction may produce different rounding results.
```

---

# 20. Ordering and Encounter Order

Some stream sources have encounter order:

- List;
- arrays;
- ordered ranges.

Some do not:

- HashSet;
- unordered concurrent sources.

Ordering can constrain parallel performance.

## 20.1 Ordered pipeline

May preserve order for certain operations.

## 20.2 Unordered optimization

If order not needed:

```java
stream.unordered().parallel()
```

can improve performance for some operations.

## 20.3 Main rule

```text
Preserving order has cost. Drop ordering only when semantics allow.
```

---

# 21. `forEach` vs `forEachOrdered`

## 21.1 `forEach`

May execute in arbitrary order in parallel.

```java
stream.parallel().forEach(System.out::println);
```

## 21.2 `forEachOrdered`

Preserves encounter order but can reduce parallel benefit.

```java
stream.parallel().forEachOrdered(System.out::println);
```

## 21.3 Main rule

```text
Use forEachOrdered only when output order is required.
```

---

# 22. Stateful Operations

Stateful operations need memory of previously seen elements.

Examples:

- `distinct`;
- `sorted`;
- `limit`;
- `skip`.

These can be expensive in parallel.

## 22.1 Why

Need coordination, buffering, ordering, global state.

## 22.2 Main rule

```text
Stateful stream operations can reduce or erase parallel speedup.
```

---

# 23. `sorted`, `distinct`, `limit`, `skip`

## 23.1 `sorted`

Requires global ordering.

Can be expensive.

## 23.2 `distinct`

Needs tracking seen elements.

For ordered streams, preserving first occurrence can cost more.

## 23.3 `limit`

With ordered parallel streams, must know first N in encounter order.

## 23.4 `skip`

Similar ordering cost.

## 23.5 Main rule

```text
Ordered stateful operations are often the hardest for parallel streams.
```

---

# 24. Primitive Streams

Prefer primitive streams for numeric work:

```java
IntStream
LongStream
DoubleStream
```

Example:

```java
long sum = LongStream.range(0, n)
    .parallel()
    .map(this::compute)
    .sum();
```

## 24.1 Avoid boxing

Bad:

```java
Stream<Integer>
```

for large numeric computation.

## 24.2 Main rule

```text
Primitive streams reduce boxing and allocation overhead.
```

---

# 25. Boxing and Allocation

Parallel stream can allocate:

- tasks;
- lambdas/captures;
- boxed values;
- collectors;
- temporary buffers.

If per-element work small, allocation overhead dominates.

## 25.1 Use primitive arrays/streams

For numeric processing.

## 25.2 Main rule

```text
For small per-element operations, allocation overhead can erase parallel gains.
```

---

# 26. Granularity and Data Size

Parallel stream is more likely useful when:

- data size large;
- per-element compute expensive;
- source splits well;
- operations stateless;
- result combination cheap.

It is often bad when:

- collection small;
- per-element work trivial;
- stateful ordered operations;
- blocking I/O;
- shared mutation.

## 26.1 Main rule

```text
Parallel streams need enough work per element or enough elements to justify overhead.
```

---

# 27. CPU-Bound Suitability

Good example:

```java
List<Hash> hashes = filesMetadata.parallelStream()
    .map(this::computeHashFromInMemoryBytes)
    .toList();
```

if data already in memory and CPU-heavy.

Bad:

```java
ids.parallelStream()
    .map(id -> repository.findById(id))
    .toList();
```

DB calls are blocking I/O and resource-limited.

## 27.1 Main rule

```text
Parallel streams are for CPU-bound data transformations, not external calls.
```

---

# 28. Blocking I/O Pitfall

This is one of the biggest mistakes.

Bad:

```java
users.parallelStream()
    .map(user -> httpClient.loadProfile(user.id()))
    .toList();
```

Problems:

- uses ForkJoin common pool;
- blocks CPU workers;
- no per-downstream bulkhead;
- no timeout propagation;
- can overload HTTP dependency;
- can starve other parallel streams/CompletableFuture tasks.

Better:

- virtual threads with semaphore bulkhead;
- explicit executor;
- structured concurrency for bounded fan-out;
- reactive client if stream/backpressure needed.

## 28.1 Main rule

```text
Do not use parallel streams for blocking DB/HTTP calls.
```

---

# 29. Parallel Streams and Virtual Threads

Parallel streams do not become virtual-thread-based because request thread is virtual.

If virtual thread calls:

```java
list.parallelStream()
```

the parallel work still uses stream's parallel execution, typically common ForkJoinPool.

## 29.1 Virtual thread can wait cheaply

The calling virtual thread may block cheaply waiting for result.

But CPU/ForkJoin workers are still scarce.

## 29.2 Main rule

```text
Virtual-thread caller does not make parallel stream execution virtual-thread-per-element.
```

---

# 30. Parallel Streams and CompletableFuture

Both may use common pool by default.

```java
CompletableFuture.supplyAsync(...)
list.parallelStream()
```

can contend.

## 30.1 Production danger

A library uses parallel stream internally.

Your app uses CompletableFuture common pool.

Under load they interfere.

## 30.2 Main rule

```text
Common pool contention is a hidden coupling between parallel streams and default async tasks.
```

---

# 31. Parallel Streams in Web Applications

Be careful using parallel stream inside request handlers.

Problem:

```text
many concurrent requests × parallel stream per request = common pool contention
```

Example:

```java
Response handle(Request request) {
    return request.items().parallelStream()
        .map(this::compute)
        .toList();
}
```

If 100 requests do this, CPU saturates and latency spikes.

## 31.1 Better

- bounded CPU executor;
- batch/job for heavy work;
- sequential if small;
- admission control.

## 31.2 Main rule

```text
Parallelism inside request must be globally bounded, not per-request unbounded.
```

---

# 32. Custom ForkJoinPool: Should You?

Some developers run parallel stream in custom pool:

```java
ForkJoinPool pool = new ForkJoinPool(4);
List<Result> result = pool.submit(() ->
    list.parallelStream()
        .map(this::compute)
        .toList()
).join();
```

## 32.1 Caution

This pattern is sometimes used but can be subtle.

Parallel streams are designed around current ForkJoin worker behavior in many cases, but relying on custom pool execution can be confusing and should be tested.

## 32.2 Better alternatives

- explicit ForkJoinTask;
- dedicated CPU executor;
- sequential stream;
- custom batching.

## 32.3 Main rule

```text
If you need strict execution isolation, explicit ForkJoinTask or dedicated executor is often clearer than hidden parallel stream behavior.
```

---

# 33. Collectors in Parallel

Collector has:

- supplier;
- accumulator;
- combiner;
- finisher;
- characteristics.

For parallel collection, framework may create multiple result containers and combine.

## 33.1 Collector correctness

Accumulator and combiner must be compatible.

## 33.2 Avoid unsafe mutable shared collector

Use standard collectors unless you know collector contract deeply.

## 33.3 Main rule

```text
Parallel collector correctness depends on proper supplier/accumulator/combiner semantics.
```

---

# 34. Concurrent Collectors

Some collectors are concurrent.

Example:

```java
Collectors.groupingByConcurrent(...)
Collectors.toConcurrentMap(...)
```

These can accumulate into concurrent result container.

## 34.1 When useful

- unordered parallel streams;
- high concurrency;
- grouping/map results.

## 34.2 Not always faster

Concurrent map contention may be high.

Regular grouping with per-task maps and combine can be faster depending data.

## 34.3 Main rule

```text
Concurrent collector reduces combining cost but may increase shared contention.
Benchmark.
```

---

# 35. `groupingBy` vs `groupingByConcurrent`

## 35.1 `groupingBy`

Usually creates partial maps and combines.

```java
Map<Type, List<Item>> grouped = items.parallelStream()
    .collect(Collectors.groupingBy(Item::type));
```

## 35.2 `groupingByConcurrent`

Concurrent accumulation.

```java
ConcurrentMap<Type, List<Item>> grouped = items.parallelStream()
    .collect(Collectors.groupingByConcurrent(Item::type));
```

## 35.3 Trade-off

If many keys and unordered semantics okay, concurrent may help.

If few hot keys, contention may hurt.

## 35.4 Main rule

```text
Use groupingByConcurrent only when concurrent unordered accumulation matches semantics and performs better.
```

---

# 36. Debugging Parallel Streams

Parallel stream bugs are harder due to nondeterminism.

## 36.1 Symptoms

- missing elements;
- duplicate elements;
- nondeterministic output order;
- occasional exceptions;
- poor performance;
- common pool starvation.

## 36.2 Debug strategy

- run sequential version;
- remove side effects;
- check reduction associativity;
- inspect source splittability;
- check blocking calls;
- benchmark;
- profile common pool.

## 36.3 Main rule

```text
If parallel stream result differs from sequential result, suspect side effects or invalid reduction first.
```

---

# 37. Benchmarking Parallel Streams

Use JMH for serious benchmarking.

Naive benchmark mistakes:

- no warmup;
- dead-code elimination;
- measuring one run;
- ignoring GC;
- including data generation;
- not comparing sequential baseline;
- different input sizes.

## 37.1 Benchmark dimensions

- data size;
- per-element cost;
- source type;
- parallelism;
- ordered/unordered;
- collector type.

## 37.2 Main rule

```text
Parallel stream should earn its complexity by measured speedup.
```

---

# 38. Mini Case Study: Bad Shared ArrayList

## 38.1 Broken

```java
List<Result> results = new ArrayList<>();

inputs.parallelStream().forEach(input -> {
    results.add(process(input));
});
```

## 38.2 Fix

```java
List<Result> results = inputs.parallelStream()
    .map(this::process)
    .toList();
```

## 38.3 Lesson

```text
Use map + collect/toList instead of side-effect mutation.
```

---

# 39. Mini Case Study: Parallel DB Calls Gone Wrong

## 39.1 Broken

```java
List<Order> orders = ids.parallelStream()
    .map(id -> repository.findById(id))
    .toList();
```

## 39.2 Problems

- DB calls block common pool;
- no DB bulkhead;
- no transaction clarity;
- possible pool starvation;
- no timeout/deadline;
- unpredictable production interference.

## 39.3 Better with virtual threads and semaphore

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Semaphore db = new Semaphore(50);

    List<Future<Order>> futures = ids.stream()
        .map(id -> executor.submit(() -> {
            if (!db.tryAcquire(100, TimeUnit.MILLISECONDS)) {
                throw new ServiceBusyException();
            }
            try {
                return repository.findById(id);
            } finally {
                db.release();
            }
        }))
        .toList();

    List<Order> orders = new ArrayList<>();
    for (Future<Order> future : futures) {
        orders.add(future.get());
    }
    return orders;
}
```

## 39.4 Lesson

```text
External I/O needs resource governance, not parallel stream.
```

---

# 40. Mini Case Study: Correct Parallel Aggregation

## 40.1 Requirement

Compute totals per type for millions of in-memory events.

## 40.2 Good

```java
Map<EventType, Long> counts = events.parallelStream()
    .collect(Collectors.groupingBy(
        Event::type,
        Collectors.counting()
    ));
```

## 40.3 If high contention and unordered acceptable

Try:

```java
ConcurrentMap<EventType, Long> counts = events.parallelStream()
    .unordered()
    .collect(Collectors.groupingByConcurrent(
        Event::type,
        Collectors.counting()
    ));
```

Benchmark both.

## 40.4 Lesson

```text
Parallel aggregation can work well when data is in-memory, CPU-bound, and reduction semantics are valid.
```

---

# 41. Common Anti-Patterns

## 41.1 `.parallel()` as default

Bad.

## 41.2 Parallel stream over blocking DB/HTTP calls

Common pool starvation and resource overload.

## 41.3 Shared mutable list/map in `forEach`

Race.

## 41.4 Using `forEachOrdered` unnecessarily

Kills parallel benefit.

## 41.5 Stateful lambdas

Nondeterministic.

## 41.6 Non-associative reduce

Incorrect result.

## 41.7 Parallel stream inside every web request

Global CPU contention.

## 41.8 Assuming concurrent collector always faster

May contend.

## 41.9 Ignoring source type

Poor splitting.

## 41.10 No benchmark

Performance claim unsupported.

---

# 42. Best Practices

## 42.1 Use for CPU-bound in-memory data

Best fit.

## 42.2 Keep operations stateless and non-interfering

No shared mutable side effects.

## 42.3 Use map/filter/reduce/collect properly

Let framework combine.

## 42.4 Avoid blocking I/O

Use virtual threads/structured concurrency instead.

## 42.5 Prefer primitive streams for numeric work

Avoid boxing.

## 42.6 Be explicit about ordering

Use unordered when safe.

## 42.7 Benchmark sequential vs parallel

Use realistic data.

## 42.8 Avoid common pool interference

Be cautious in servers.

## 42.9 Do not use parallel streams for small workloads

Overhead dominates.

## 42.10 Verify reduction laws

Associativity, identity, combiner compatibility.

---

# 43. Decision Matrix

| Situation | Parallel Stream? |
|---|---|
| Large in-memory CPU-bound transform | Yes, candidate |
| Small list trivial map | No |
| DB calls per element | No |
| HTTP calls per element | No |
| Shared mutable output list | No; use collect |
| Numeric primitive aggregation | Yes, candidate with primitive stream |
| Need exact output order side effects | Usually no |
| Need `forEachOrdered` | Maybe sequential better |
| Source is ArrayList/array/range | Good source |
| Source is LinkedList/IO stream | Often poor |
| Web request heavy CPU work | Maybe, but globally bound CPU better |
| Reduction not associative | No |
| Stateful operation sorted/distinct/limit | Benchmark carefully |
| Concurrent grouping many keys | Maybe `groupingByConcurrent`, benchmark |
| Virtual-thread request handler | Parallel stream still uses ForkJoin; be careful |

---

# 44. Latihan

## Latihan 1 — Side Effect Refactor

Ubah parallel stream yang menulis ke shared `ArrayList` menjadi `map().toList()`.

## Latihan 2 — Reduction Law

Tentukan apakah operasi berikut associative: addition, subtraction, max, string concat with order, BigDecimal add.

## Latihan 3 — DB Call Refactor

Refactor parallel stream DB call menjadi virtual-thread executor + semaphore bulkhead.

## Latihan 4 — Source Comparison

Bandingkan parallel stream dari `ArrayList`, `LinkedList`, dan `IntStream.range`.

## Latihan 5 — Primitive Stream

Ubah `Stream<Integer>` numeric calculation menjadi `IntStream`.

## Latihan 6 — forEachOrdered

Buat contoh output berbeda antara `forEach` dan `forEachOrdered`.

## Latihan 7 — groupingByConcurrent

Benchmark `groupingBy` vs `groupingByConcurrent` untuk banyak key vs sedikit key.

## Latihan 8 — Common Pool Risk

Jelaskan kenapa parallel stream di library internal bisa mengganggu aplikasi.

## Latihan 9 — Ordered Stateful Operation

Uji `limit` pada ordered parallel stream vs unordered stream.

## Latihan 10 — Benchmark Plan

Buat rencana benchmark untuk membuktikan `.parallel()` mempercepat workload tertentu.

---

# 45. Ringkasan

Parallel streams adalah alat data-parallel yang kuat tetapi mudah disalahgunakan.

Core lessons:

- Parallel stream bukan magic performance switch.
- Parallel stream cocok untuk CPU-bound in-memory data processing.
- Parallel stream biasanya memakai ForkJoin common pool.
- Source splittability sangat penting.
- `Spliterator` characteristics mempengaruhi optimisasi.
- Operations harus stateless dan non-interfering.
- Side effects dengan shared mutable state berbahaya.
- Gunakan `collect`/`reduce`, bukan shared mutation.
- Reduction harus associative dan punya identity benar.
- Floating-point reduction bisa berbeda hasil rounding.
- Encounter order punya cost.
- `forEachOrdered` dapat mengurangi parallel benefit.
- Stateful operations seperti `sorted`, `distinct`, `limit`, `skip` bisa mahal.
- Primitive streams mengurangi boxing.
- Workload harus cukup besar untuk menutup overhead.
- Jangan pakai parallel streams untuk DB/HTTP blocking calls.
- Virtual thread caller tidak membuat parallel stream memakai virtual threads.
- `CompletableFuture` default async dan parallel streams bisa saling ganggu via common pool.
- Di web app, parallel stream per request bisa membuat CPU contention global.
- Concurrent collectors tidak selalu lebih cepat; benchmark.
- Debugging parallel stream dimulai dari sequential baseline, side effects, dan reduction validity.

Main rule:

```text
Use parallel streams only when data is in-memory, splittable,
operations are stateless/non-interfering,
reduction is valid, workload is large enough,
and common-pool impact is acceptable.
```

---

# 46. Referensi

1. Java SE 25 — Stream API  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

2. Java SE 25 — Package `java.util.stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

3. Java SE 25 — `Spliterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterator.html

4. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

5. Java SE 25 — `ForkJoinPool`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinPool.html

6. Java SE 25 — `CompletableFuture`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html

7. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

8. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

9. Java Microbenchmark Harness (JMH)  
   https://openjdk.org/projects/code-tools/jmh/

10. Java SE 25 — `IntStream`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.html

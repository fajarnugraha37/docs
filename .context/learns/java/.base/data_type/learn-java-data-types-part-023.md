# learn-java-data-types-part-023.md

# Java Data Types — Part 023  
# Data Types and Performance: Allocation, Boxing, GC, Cache Locality, JIT, Benchmarking, dan Production Measurement

> Seri: **Advanced Java Data Types**  
> Bagian: **023**  
> Fokus: memahami hubungan pilihan data type dengan performance Java: primitive vs wrapper, array vs collection, object graph, allocation rate, GC pressure, cache locality, branch prediction, BigDecimal, String, Optional, Stream, enum, records, concurrency primitives, false sharing, JIT optimization, escape analysis, JMH benchmarking, JFR profiling, dan prinsip “measure before optimize”.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Performance Bukan Sekadar Big-O](#2-performance-bukan-sekadar-big-o)
3. [Mental Model: Cost Model Data Type](#3-mental-model-cost-model-data-type)
4. [Primitive vs Wrapper Performance](#4-primitive-vs-wrapper-performance)
5. [Boxing, Unboxing, dan Hidden Allocation](#5-boxing-unboxing-dan-hidden-allocation)
6. [Arrays vs Collections](#6-arrays-vs-collections)
7. [Object Graph dan Pointer Chasing](#7-object-graph-dan-pointer-chasing)
8. [Cache Locality dan Data-Oriented Thinking](#8-cache-locality-dan-data-oriented-thinking)
9. [Allocation Rate dan GC Pressure](#9-allocation-rate-dan-gc-pressure)
10. [Escape Analysis dan Scalar Replacement](#10-escape-analysis-dan-scalar-replacement)
11. [JIT, Warmup, dan Profile-Guided Optimization](#11-jit-warmup-dan-profile-guided-optimization)
12. [Branch Prediction dan Polymorphism](#12-branch-prediction-dan-polymorphism)
13. [Virtual Dispatch, Interface Calls, dan Megamorphism](#13-virtual-dispatch-interface-calls-dan-megamorphism)
14. [Records dan Performance](#14-records-dan-performance)
15. [Enum, EnumSet, dan EnumMap](#15-enum-enumset-dan-enummap)
16. [String Performance](#16-string-performance)
17. [BigDecimal Performance](#17-bigdecimal-performance)
18. [Date/Time Performance](#18-datetime-performance)
19. [Optional Performance](#19-optional-performance)
20. [Streams vs Loops](#20-streams-vs-loops)
21. [Collections Performance Trade-Offs](#21-collections-performance-trade-offs)
22. [HashMap, TreeMap, LinkedHashMap, ConcurrentHashMap](#22-hashmap-treemap-linkedhashmap-concurrenthashmap)
23. [Concurrency Data Types dan Performance](#23-concurrency-data-types-dan-performance)
24. [AtomicLong vs LongAdder](#24-atomiclong-vs-longadder)
25. [Volatile, Locks, dan Contention](#25-volatile-locks-dan-contention)
26. [False Sharing](#26-false-sharing)
27. [Serialization dan Boundary Cost](#27-serialization-dan-boundary-cost)
28. [Database/API Mapping Cost](#28-databaseapi-mapping-cost)
29. [Microbenchmarking dengan JMH](#29-microbenchmarking-dengan-jmh)
30. [Common Benchmarking Mistakes](#30-common-benchmarking-mistakes)
31. [Profiling dengan JFR](#31-profiling-dengan-jfr)
32. [Heap/Allocation Analysis](#32-heapallocation-analysis)
33. [Performance Decision Workflow](#33-performance-decision-workflow)
34. [Designing Performance-Aware Types](#34-designing-performance-aware-types)
35. [Production Failure Modes](#35-production-failure-modes)
36. [Best Practices](#36-best-practices)
37. [Decision Matrix](#37-decision-matrix)
38. [Latihan](#38-latihan)
39. [Ringkasan](#39-ringkasan)
40. [Referensi](#40-referensi)

---

# 1. Tujuan Bagian Ini

Kita sudah membahas data layout di part sebelumnya. Sekarang kita membahas performance dari perspektif pemilihan data type.

Pertanyaan yang sering muncul:

```text
Apakah record lebih lambat dari class?
Apakah List<Integer> aman untuk data besar?
Apakah Stream lambat?
Apakah BigDecimal mahal?
Apakah Optional bikin alokasi?
Apakah HashMap cukup?
Kapan pakai EnumMap?
Kapan array lebih baik dari List?
Kapan LongAdder lebih baik dari AtomicLong?
```

Jawaban senior bukan:

```text
"selalu pakai X"
```

Tetapi:

```text
tergantung cost model, workload, scale, JIT, allocation, GC, cache locality, contention, dan measurement.
```

Tujuan bagian ini:

- membangun cost model data type;
- memahami hidden cost: boxing, allocation, pointer chasing;
- memahami trade-off array/collection/object graph;
- memahami JIT/escape analysis/warmup;
- memahami String/BigDecimal/Optional/Stream performance;
- memahami concurrent data type cost;
- memahami cara benchmark dengan JMH;
- memahami cara profiling production dengan JFR;
- membuat decision workflow yang aman.

---

# 2. Performance Bukan Sekadar Big-O

Big-O penting, tetapi tidak cukup.

Dua struktur sama-sama O(n):

```java
int[] array
LinkedList<Integer>
```

Tetapi performance bisa berbeda jauh karena:

- cache locality;
- object allocation;
- pointer chasing;
- boxing;
- branch prediction;
- GC pressure;
- memory bandwidth;
- CPU pipeline;
- JIT optimization.

## 2.1 Big-O ignores constants

Untuk ukuran kecil/menengah, constant factor dominan.

## 2.2 Big-O ignores memory layout

`ArrayList` dan `LinkedList` sama-sama bisa iterasi O(n), tetapi `ArrayList` biasanya jauh lebih cache-friendly.

## 2.3 Big-O ignores allocation

Function O(1) yang allocate object setiap call bisa lebih mahal daripada O(n) kecil yang tanpa allocation.

## 2.4 Big-O ignores concurrency

`AtomicLong.incrementAndGet()` O(1), tapi high contention bisa bottleneck.

## 2.5 Performance is workload-specific

Read-heavy, write-heavy, latency-sensitive, memory-limited, throughput-oriented — semua bisa memilih type berbeda.

---

# 3. Mental Model: Cost Model Data Type

Saat memilih data type, pikirkan cost berikut.

## 3.1 CPU cost

- arithmetic;
- comparison;
- hashing;
- parsing;
- formatting;
- virtual dispatch;
- branch;
- synchronization.

## 3.2 Memory cost

- object header;
- fields;
- references;
- padding;
- arrays;
- internal collection structures;
- retained graph.

## 3.3 Allocation cost

- new objects;
- boxing;
- lambdas/captures;
- intermediate collections;
- BigDecimal operations;
- String transformations.

## 3.4 GC cost

- number of objects;
- lifespan;
- old-gen promotion;
- reference graph traversal;
- allocation rate.

## 3.5 Locality cost

- contiguous array;
- pointer chasing;
- cache misses.

## 3.6 Contention cost

- locks;
- atomics;
- volatile;
- false sharing;
- concurrent map hot keys.

## 3.7 Boundary cost

- JSON serialization;
- DB mapping;
- string parsing;
- date/time conversion;
- validation.

## 3.8 Rule

```text
Data type performance = semantics + representation + workload + runtime optimization.
```

---

# 4. Primitive vs Wrapper Performance

## 4.1 Primitive

```java
int x = 42;
long id = 123L;
double score = 0.95;
```

Stored directly in fields/arrays/local variables.

Pros:

- no object header;
- no null;
- compact arrays;
- efficient arithmetic.

Cons:

- no generics;
- no null;
- no methods beyond operators/static helpers;
- no domain semantics alone.

## 4.2 Wrapper

```java
Integer x = 42;
Long id = 123L;
Double score = 0.95;
```

Object/reference type.

Pros:

- works with generics/collections;
- nullable;
- can be used as Object;
- framework compatibility.

Cons:

- allocation/boxing;
- object header;
- reference indirection;
- null unboxing NPE;
- identity traps.

## 4.3 Field example

```java
record A(int value) {}
record B(Integer value) {}
```

`A` stores int inline in record object.

`B` stores reference to Integer object.

## 4.4 Array example

```java
int[] xs
Integer[] xs
List<Integer> xs
```

Memory/performance from best to worst usually:

```text
int[]  -> Integer[] -> List<Integer>
```

for dense numeric data, though exact workload matters.

## 4.5 Domain wrapper

```java
record Version(long value) {}
```

Semantically good. But for huge arrays of versions, object overhead matters.

Use domain wrapper at boundary, compact primitive internally if needed.

---

# 5. Boxing, Unboxing, dan Hidden Allocation

Autoboxing hides conversion.

```java
List<Integer> values = new ArrayList<>();
values.add(1); // boxes int to Integer
```

## 5.1 Unboxing

```java
Integer x = values.get(0);
int y = x; // unbox
```

## 5.2 Hidden allocation

```java
Integer x = 1000;
```

may allocate unless optimized/cached.

## 5.3 Cache

Small wrapper values may be cached.

Do not rely on identity:

```java
Integer.valueOf(127) == Integer.valueOf(127) // often true
Integer.valueOf(1000) == Integer.valueOf(1000) // often false
```

## 5.4 Loop cost

```java
long sum = 0;
for (Integer x : list) {
    sum += x;
}
```

Unboxing each element.

## 5.5 Null risk

```java
Integer x = null;
int y = x; // NPE
```

## 5.6 Performance rule

Avoid boxed numeric values in:

- large arrays/lists;
- tight loops;
- hot metrics;
- parsing/tokenization;
- high-frequency pipelines.

---

# 6. Arrays vs Collections

## 6.1 Arrays

```java
int[] values
String[] names
```

Pros:

- compact;
- fast indexed access;
- primitive support;
- low overhead;
- good locality.

Cons:

- fixed length;
- mutable;
- covariant for reference arrays;
- awkward APIs;
- no rich collection operations;
- no generics for primitive arrays.

## 6.2 Collections

```java
List<T>
Set<T>
Map<K,V>
```

Pros:

- expressive semantics;
- dynamic size;
- generic type safety;
- rich APIs;
- implementation choices.

Cons:

- object overhead;
- reference indirection;
- boxing for primitives;
- collection-specific overhead.

## 6.3 Data size matters

For 10 items, clarity dominates.

For 10 million ints, representation matters.

## 6.4 API design

Use collections for domain API.

Use arrays internally for high-volume primitive data.

## 6.5 Example hybrid

```java
final class RiskScores {
    private final double[] scores;

    RiskScore scoreAt(int index) {
        return new RiskScore(scores[index]);
    }
}
```

---

# 7. Object Graph dan Pointer Chasing

Object-rich design:

```java
List<OrderLine>
OrderLine -> ProductId -> String
OrderLine -> Money -> BigDecimal -> BigInteger/int[]
```

Each reference may require pointer chasing.

## 7.1 CPU cache misses

Pointer chasing can cause cache misses.

## 7.2 GC tracing

More objects = more references to trace.

## 7.3 Readability vs performance

Object-rich domain model is good for correctness.

But hot data path may need compact representation.

## 7.4 Flattening

For analytics/batch:

```java
long[] productIds;
long[] quantities;
long[] pricesInCents;
```

can outperform object list.

## 7.5 Rule

Use object model for domain logic. Use data-oriented layout for measured hot paths.

---

# 8. Cache Locality dan Data-Oriented Thinking

## 8.1 Contiguous memory

Primitive arrays store values contiguously.

```java
int[] xs
```

Good for CPU cache.

## 8.2 ArrayList

ArrayList stores references contiguously, but objects elsewhere.

Still usually better than linked nodes.

## 8.3 LinkedList

Nodes scattered in memory.

Poor locality.

## 8.4 Data-oriented layout

Instead of:

```java
record Point(double x, double y) {}
List<Point>
```

for huge numeric processing, consider:

```java
double[] xs;
double[] ys;
```

## 8.5 Trade-off

Data-oriented code can be less domain-readable.

Use only when profiling justifies.

## 8.6 Practical senior approach

```text
Domain layer: clear objects.
Hot processing layer: compact representation.
Mapper between them.
```

---

# 9. Allocation Rate dan GC Pressure

Allocation rate is bytes/objects allocated per time.

High allocation can hurt throughput/latency even if objects short-lived.

## 9.1 Common allocation sources

- boxing;
- stream intermediate objects;
- string transformations;
- BigDecimal operations;
- collection copying;
- lambdas capturing state;
- exception creation;
- Optional/record wrappers in hot loops;
- date/time object creation.

## 9.2 Young GC handles short-lived objects well

But high allocation still consumes CPU and memory bandwidth.

## 9.3 Promotion

Objects surviving young GCs may promote to old generation.

Long-lived object graphs add marking cost.

## 9.4 Allocation-free style

Sometimes useful in hot paths:

- reuse buffers carefully;
- primitive arrays;
- avoid boxing;
- avoid temporary collections;
- use mutable builder locally.

## 9.5 Do not pool ordinary objects blindly

Object pooling often worsens performance and memory.

Pool expensive resources, not simple POJOs.

## 9.6 Measure allocation

Use JFR allocation events or profiler.

---

# 10. Escape Analysis dan Scalar Replacement

JIT may eliminate allocation if object does not escape.

Example:

```java
record Pair(int a, int b) {}

int sum(int x, int y) {
    Pair p = new Pair(x, y);
    return p.a() + p.b();
}
```

JIT may scalar-replace `Pair` and avoid allocation.

## 10.1 Escape

Object escapes if it can be observed outside current compilation scope:

- returned;
- stored in field;
- passed to unknown method;
- captured by lambda;
- stored in array/global.

## 10.2 Scalar replacement

JIT replaces object fields with scalar variables.

## 10.3 Implication

Not every `new` in source becomes heap allocation in optimized code.

## 10.4 But do not rely blindly

Optimization depends on:

- JIT compilation;
- runtime profile;
- method size;
- polymorphism;
- escape;
- JVM flags;
- version.

## 10.5 Benchmark carefully

Naive benchmark can measure optimized-away code incorrectly.

Use JMH.

---

# 11. JIT, Warmup, dan Profile-Guided Optimization

Java performance changes over time.

## 11.1 Interpretation then compilation

JVM may interpret code first, collect profile, then JIT compile hot methods.

## 11.2 Warmup

Early execution may be slower.

Microbenchmarks must account for warmup.

## 11.3 Runtime profiles

JIT uses profile information such as branch frequency and receiver types.

A benchmark with unrealistic profile can mislead.

## 11.4 Deoptimization

If assumptions break, compiled code can deoptimize.

## 11.5 Production difference

Benchmark isolated method may not match production because production has:

- different branch distribution;
- CPU/cache interference;
- different object lifetimes;
- real IO;
- GC behavior;
- contention;
- classpath/framework overhead.

## 11.6 Rule

Use microbenchmarks for focused questions, but validate with application-level profiling.

---

# 12. Branch Prediction dan Polymorphism

CPU branch prediction affects performance.

## 12.1 Predictable branch

```java
if (status == ACTIVE) { ... }
```

If mostly active, branch predictor performs well.

## 12.2 Unpredictable branch

Random true/false can be slower.

## 12.3 Enum switch

Switch on enum can be efficient, but actual performance depends.

## 12.4 Polymorphism

Virtual dispatch can be optimized if receiver types predictable.

## 12.5 Megamorphic callsite

If many receiver types at same callsite, JIT inlining harder.

Example:

```java
List<Rule> rules; // many implementation classes
for (Rule rule : rules) rule.apply(ctx);
```

May be fine, but in hot path many implementations can reduce inlining.

## 12.6 Design rule

Do not eliminate polymorphism prematurely. But in hot loops, receiver diversity matters.

---

# 13. Virtual Dispatch, Interface Calls, dan Megamorphism

## 13.1 Virtual call

```java
obj.method()
```

runtime dispatch based on actual class.

## 13.2 Interface call

```java
handler.handle(command)
```

similar dynamic dispatch.

## 13.3 Inlining

JIT can inline calls when target predictable.

## 13.4 Monomorphic

One receiver type observed.

Usually easy to inline.

## 13.5 Bimorphic/polymorphic

Few receiver types.

May still optimize.

## 13.6 Megamorphic

Many receiver types.

Inlining harder, overhead higher.

## 13.7 Data type implication

Sealed types may help compiler/JIT reason at language level in some contexts, but do not assume magic.

Use profiling.

---

# 14. Records dan Performance

Records are ordinary classes with generated methods.

## 14.1 Not zero-cost wrapper

```java
record CaseId(String value) {}
```

is object.

## 14.2 Benefit

- concise;
- final;
- immutable-ish;
- generated equals/hashCode/toString;
- JIT may optimize short-lived records.

## 14.3 Cost

- object allocation if not optimized away;
- header/padding;
- reference fields;
- generated methods can be costly if components costly.

## 14.4 Record equals

Generated equals compares all components.

If component list large, equality can be expensive.

## 14.5 Record toString

Generated toString can allocate strings and traverse components.

Do not call in hot logs unless needed.

## 14.6 Rule

Use records for correctness. Optimize representation only when measured hot path/object scale requires.

---

# 15. Enum, EnumSet, dan EnumMap

## 15.1 Enum comparison

Enum `==` is fast and correct.

## 15.2 EnumSet

`EnumSet` is specialized for enum elements, often bit-vector-like internally.

Excellent for flags/permissions.

## 15.3 EnumMap

Specialized for enum keys.

Often better than HashMap for enum keys.

## 15.4 Avoid Set<String> for closed flags

Bad:

```java
Set<String> permissions
```

Better:

```java
EnumSet<Permission>
```

internally.

## 15.5 External codes

Map external string code to enum at boundary.

## 15.6 Performance and correctness align

EnumSet/EnumMap improve both semantics and performance.

---

# 16. String Performance

## 16.1 String immutable

Operations create new strings:

```java
s.trim().toLowerCase()
```

## 16.2 Concatenation

Modern Java uses invokedynamic/string concat strategies. Simple `+` is fine for normal code.

For loops, use `StringBuilder`.

```java
StringBuilder sb = new StringBuilder();
for (...) sb.append(...);
```

## 16.3 Compact strings

JEP 254 changed String internal representation to byte array plus encoding flag, enabling Latin-1 strings to use less memory.

## 16.4 substring

Modern Java substring copies relevant bytes/chars; older Java shared char array historically. Do not rely on old behavior.

## 16.5 Regex cost

`String.matches` compiles regex each call.

Prefer precompiled Pattern in hot paths:

```java
private static final Pattern P = Pattern.compile(...);
```

## 16.6 Case conversion

Locale-aware operations can be costly and semantically important.

Use `Locale.ROOT` for machine identifiers.

## 16.7 Intern/dedup

String interning/dedup can help duplicate strings but has trade-offs. Measure.

---

# 17. BigDecimal Performance

Java SE 25 `BigDecimal` is immutable arbitrary-precision signed decimal, consisting of arbitrary precision integer unscaled value and 32-bit scale.

## 17.1 Immutable operations allocate

```java
amount = amount.add(other);
```

creates new BigDecimal.

## 17.2 Arbitrary precision cost

BigDecimal is more expensive than primitive integer/long/double.

## 17.3 Correctness for money

For money/exact decimal, BigDecimal may be necessary.

## 17.4 Minor units alternative

```java
long cents
```

can be faster and compact for many monetary domains.

## 17.5 Scale/rounding

Rounding operations cost and must be correct.

## 17.6 Avoid new BigDecimal(double)

Use string/valueOf.

## 17.7 Rule

Do not replace BigDecimal with double for performance if exact decimal correctness required.

Instead consider:

- minor units long;
- batching;
- reducing operations;
- careful rounding policy;
- profiling.

---

# 18. Date/Time Performance

## 18.1 java.time immutable

Operations create new objects.

```java
instant.plus(duration)
date.plusDays(1)
```

## 18.2 Instant.now cost

Clock access has non-trivial cost.

If same timestamp sufficient:

```java
Instant now = clock.instant();
for (...) use(now);
```

## 18.3 Zone conversion cost

```java
instant.atZone(zone)
```

requires zone rules.

Avoid repeated conversions in tight loops if not needed.

## 18.4 Formatting/parsing cost

DateTimeFormatter formatting/parsing is relatively expensive.

Do not parse/format repeatedly in hot path if you can keep typed value.

## 18.5 Store typed values internally

Parse at boundary once.

Format at boundary once.

## 18.6 DateTimeFormatter reuse

DateTimeFormatter is immutable/thread-safe; reuse static final formatters where appropriate.

---

# 19. Optional Performance

## 19.1 Optional object

`Optional<T>` is object wrapper.

In many cases JIT may optimize away short-lived Optional.

## 19.2 Return type overhead

For repository/service result, overhead usually negligible compared to IO.

## 19.3 Hot loops

Avoid `Optional` in tight loops/large arrays if it causes allocation/object overhead.

## 19.4 Primitive optional

Use:

```java
OptionalInt
OptionalLong
OptionalDouble
```

to avoid boxing where appropriate.

## 19.5 Optional in fields/collections

```java
List<Optional<T>>
```

can be memory-heavy and semantically awkward.

## 19.6 Rule

Use Optional for API clarity, not in high-volume storage structures unless measured acceptable.

---

# 20. Streams vs Loops

Java SE 25 `java.util.stream` package defines `Stream`, `IntStream`, `LongStream`, and `DoubleStream`; primitive streams support primitive int, long, and double elements, avoiding boxed object streams for those primitives.

## 20.1 Stream benefits

- declarative;
- composable;
- less boilerplate;
- can express transformations clearly.

## 20.2 Stream costs

- pipeline overhead;
- lambda allocation/captures sometimes;
- boxing if using `Stream<Integer>`;
- harder debugging;
- parallel stream pitfalls.

## 20.3 Primitive streams

Prefer:

```java
IntStream
LongStream
DoubleStream
```

for primitive numeric pipelines.

## 20.4 Loops

Loops can be faster and clearer for hot low-level code.

```java
long sum = 0;
for (int x : xs) sum += x;
```

## 20.5 toList

`stream.toList()` returns unmodifiable list in modern Java.

## 20.6 Rule

Use streams for clarity in normal code. Use loops for measured hot paths or complex control flow.

---

# 21. Collections Performance Trade-Offs

## 21.1 ArrayList

Fast indexed access, append, iteration.

Good default list.

## 21.2 LinkedList

Poor locality, node allocation.

Rarely best.

## 21.3 HashSet/HashMap

Average O(1), but depends on hash quality, resizing, memory overhead.

## 21.4 TreeSet/TreeMap

O(log n), sorted/range operations.

## 21.5 LinkedHashMap

Predictable order, slightly more overhead than HashMap.

## 21.6 EnumSet/EnumMap

Specialized and efficient for enum.

## 21.7 Initial capacity

For large collections, set initial capacity to avoid resizing.

## 21.8 Remove while iterate

Use Iterator/removeIf to avoid CME.

---

# 22. HashMap, TreeMap, LinkedHashMap, ConcurrentHashMap

## 22.1 HashMap

Good general lookup.

Costs:

- hash computation;
- table;
- nodes;
- resizing;
- poor locality vs arrays.

## 22.2 TreeMap

Sorted/range operations.

Costs:

- compare cost;
- tree nodes;
- O(log n).

## 22.3 LinkedHashMap

Maintains insertion/access order.

Useful for stable iteration/LRU-like logic.

## 22.4 ConcurrentHashMap

Thread-safe concurrent operations.

Costs:

- concurrency control;
- no null keys/values;
- compute function complexity;
- contention on hot keys.

## 22.5 Key type

Key equality/hashCode performance matters.

Bad key:

```java
List<String> mutableLongList
```

Good key:

```java
record CacheKey(TenantId tenantId, QueryHash queryHash) {}
```

## 22.6 Map choice

Choose by semantics first, then workload.

---

# 23. Concurrency Data Types dan Performance

Concurrency primitives have cost.

## 23.1 volatile

Visibility/order cost, no mutual exclusion.

## 23.2 synchronized/ReentrantLock

Mutual exclusion, can contend/block.

## 23.3 Atomic classes

CAS loops, good for simple state, can contend.

## 23.4 LongAdder

Better for high-contention counters, weaker exact snapshot semantics.

## 23.5 ConcurrentHashMap

Scales better than synchronized map for many workloads, but hot keys can still contend.

## 23.6 CopyOnWriteArrayList

Great read-heavy, awful write-heavy.

## 23.7 BlockingQueue

Good producer-consumer, but queue capacity and blocking behavior affect throughput/latency.

---

# 24. AtomicLong vs LongAdder

## 24.1 AtomicLong

```java
AtomicLong counter = new AtomicLong();
counter.incrementAndGet();
```

Good when:

- need exact value frequently;
- sequence number;
- low/moderate contention.

## 24.2 LongAdder

```java
LongAdder adder = new LongAdder();
adder.increment();
long value = adder.sum();
```

Good when:

- high update contention;
- metrics counters;
- exact instantaneous value not critical.

## 24.3 Semantics

LongAdder spreads contention across cells internally.

`sum()` aggregates.

## 24.4 Wrong use

Do not use LongAdder for unique ID generation.

## 24.5 Decision

```text
sequence/exact atomic state -> AtomicLong
high-throughput metric -> LongAdder
```

---

# 25. Volatile, Locks, dan Contention

## 25.1 Contention

Multiple threads competing for same resource.

Examples:

- synchronized method hot path;
- single AtomicLong counter;
- ConcurrentHashMap same key;
- logging lock;
- shared queue.

## 25.2 Lock granularity

Coarse lock simpler but may reduce parallelism.

Fine-grained lock faster sometimes but harder to reason.

## 25.3 Immutability avoids locks

Immutable snapshots can eliminate read locks.

## 25.4 Volatile read/write

Cheaper than locks for simple state, but not free.

## 25.5 Lock-free not always faster

CAS under high contention can spin/retry.

## 25.6 Measure with realistic contention

Single-thread benchmark tells nothing about contention performance.

---

# 26. False Sharing

False sharing occurs when independent variables used by different threads share same CPU cache line, causing invalidation traffic.

## 26.1 Example concept

Thread A updates counterA.

Thread B updates counterB.

If adjacent in memory on same cache line, performance can suffer.

## 26.2 JDK mitigation

Some classes use padding/striping internally.

LongAdder is one approach to reduce contention.

## 26.3 Application-level caution

Usually not first optimization.

## 26.4 Hot counters

If building high-performance counters, false sharing matters.

## 26.5 Measure

Use JMH with multiple threads and perf/JFR where possible.

## 26.6 Do not overfit

False sharing is real but lower-level. Fix bigger issues first.

---

# 27. Serialization dan Boundary Cost

Data type performance often dominated by boundary conversion.

## 27.1 JSON

Costs:

- reflection/introspection;
- string parsing;
- UTF-8 encoding/decoding;
- date/time formatting;
- BigDecimal parsing;
- object creation;
- collections allocation.

## 27.2 DTO mapping

Mapping domain types to DTO strings/numbers allocates.

## 27.3 Database

Costs:

- JDBC driver conversion;
- BigDecimal mapping;
- timestamp conversion;
- string allocation;
- result set object creation;
- ORM dirty checking/proxy overhead.

## 27.4 Kafka/event

Serialization/deserialization can dominate CPU.

## 27.5 Rule

Before optimizing in-memory type, check whether boundary serialization/database dominates.

## 27.6 Keep typed internally

Parse at boundary once, operate on typed values internally, format at output once.

---

# 28. Database/API Mapping Cost

## 28.1 AttributeConverter

JPA converters for value objects add method calls and object creation.

Usually worth correctness.

For huge batch reads, measure.

## 28.2 DTO records

Records are good DTOs but still allocate.

## 28.3 Projection

Use DB projection to avoid loading huge object graphs.

## 28.4 Avoid N+1

No data type optimization fixes N+1 query.

## 28.5 Pagination

Large collections in memory can dominate.

## 28.6 Batch mapping

For massive batch, consider streaming ResultSet and compact representation.

---

# 29. Microbenchmarking dengan JMH

OpenJDK JMH describes itself as a Java harness for building, running, and analysing nano/micro/milli/macro benchmarks targeting the JVM.

Use JMH for focused measurement like:

- `int[]` vs `List<Integer>`;
- loop vs stream;
- HashMap vs EnumMap;
- BigDecimal vs long minor units;
- DateTimeFormatter reuse;
- allocation differences.

## 29.1 Why JMH

JMH handles common JVM benchmarking issues:

- warmup;
- measurement iterations;
- forks;
- dead-code elimination prevention;
- state setup;
- blackholes;
- parameterization.

## 29.2 Standalone project

JMH docs recommend using Maven to set up a standalone project depending on application jars for more reliable benchmark setup.

## 29.3 Basic benchmark

```java
@State(Scope.Thread)
public class SumBenchmark {
    private int[] values;

    @Setup
    public void setup() {
        values = IntStream.range(0, 1_000).toArray();
    }

    @Benchmark
    public long sumLoop() {
        long sum = 0;
        for (int x : values) {
            sum += x;
        }
        return sum;
    }

    @Benchmark
    public long sumStream() {
        return Arrays.stream(values).asLongStream().sum();
    }
}
```

## 29.4 Benchmark mode

Choose:

- throughput;
- average time;
- sample time;
- single shot.

## 29.5 Forks

Use multiple forks to reduce JVM profile pollution.

## 29.6 Parametrize

```java
@Param({"100", "10000", "1000000"})
int size;
```

Scale matters.

---

# 30. Common Benchmarking Mistakes

## 30.1 Dead code elimination

Benchmark computes result but never uses it.

JIT removes work.

Fix: return result or use Blackhole.

## 30.2 Constant folding

Inputs constant; JIT precomputes.

Use state/params.

## 30.3 No warmup

Measures interpreter/cold JIT.

Use JMH warmup.

## 30.4 Benchmarking in IDE

IDE runs can be noisy/unreliable.

Use proper JMH execution.

## 30.5 Unrealistic data

Benchmark all strings same length/status distribution; production differs.

## 30.6 Ignoring allocation

Throughput may look okay but allocation high.

Measure allocation/profilers.

## 30.7 Ignoring GC

GC can dominate.

## 30.8 Microbenchmarking wrong level

Optimizing method that is not production bottleneck.

## 30.9 Single-thread only

Concurrency performance requires multi-thread benchmark.

## 30.10 Trusting one run

Use multiple forks/iterations and confidence.

---

# 31. Profiling dengan JFR

Java SE 25 `jdk.jfr` package provides classes to create events and control Flight Recorder, and Flight Recorder collects data as events with timestamp, duration, and payload useful for diagnosing running applications.

## 31.1 Why JFR

JFR can show:

- allocation hotspots;
- CPU hotspots;
- lock contention;
- GC pauses;
- thread states;
- IO events;
- exceptions;
- custom events.

## 31.2 Start recording

Example:

```bash
jcmd <pid> JFR.start name=profile settings=profile filename=app.jfr
```

or JVM args.

## 31.3 Allocation profiling

Look for:

- excessive wrappers;
- DTO mapping allocation;
- string parsing/formatting;
- BigDecimal churn;
- collection resizing;
- stream allocation.

## 31.4 Lock profiling

Find contention.

## 31.5 Production-friendly

JFR is designed for low-overhead production diagnostics, but still configure carefully.

## 31.6 Custom events

For domain performance, create custom JFR events sparingly.

---

# 32. Heap/Allocation Analysis

## 32.1 Heap histogram

```bash
jcmd <pid> GC.class_histogram
```

Shows object counts/bytes by class.

## 32.2 Heap dump

Analyze retained size.

## 32.3 Allocation rate

Use JFR/profiler to identify allocation sources.

## 32.4 Object count

High counts of:

```text
Integer
Long
String
byte[]
char[]
HashMap$Node
ArrayList
Optional
BigDecimal
```

can indicate type/design issue.

## 32.5 Retained graph

Cache maps often retain large graphs.

## 32.6 Before/after

Measure after optimization to avoid placebo.

---

# 33. Performance Decision Workflow

## 33.1 Step 1: Define performance requirement

Examples:

```text
p99 latency < 50ms
throughput 10k req/s
heap < 512MB
batch 10M rows in < 2min
allocation < 100MB/s
```

## 33.2 Step 2: Measure production-like workload

Use JFR/APM/logs/metrics/load test.

## 33.3 Step 3: Identify bottleneck

CPU? Allocation? GC? Lock? IO? DB? Serialization?

## 33.4 Step 4: Hypothesize type cost

Examples:

- boxing in hot loop;
- BigDecimal churn;
- HashMap key allocation;
- LinkedList pointer chasing;
- String regex repeated;
- JSON date parsing;
- Optional allocation in large list.

## 33.5 Step 5: Microbenchmark if needed

Use JMH for isolated alternative.

## 33.6 Step 6: Implement minimal change

Do not rewrite architecture if one data structure choice fixes bottleneck.

## 33.7 Step 7: Validate end-to-end

Load test/profile again.

## 33.8 Step 8: Document trade-off

Explain why less-obvious type chosen.

---

# 34. Designing Performance-Aware Types

## 34.1 Correctness-first type

```java
record CaseId(String value) {}
```

Good.

## 34.2 Hot-path representation

If huge scale:

```java
final class CaseIdIndex {
    private final long[] ids;
}
```

## 34.3 Avoid premature wrapper explosion in internal arrays

Millions of:

```java
record Score(double value)
```

may be too heavy.

Use `double[]` internally, expose `RiskScore` at boundary.

## 34.4 Keep parsing at edge

Don't repeatedly parse string ID inside core loop.

## 34.5 Cache normalized values

If normalization expensive and value reused, store canonical representation.

## 34.6 Precompute hash?

For immutable keys used heavily, maybe precompute hash.

But only if measured.

## 34.7 Avoid too generic abstraction in hot path

Generic polymorphic frameworks can hinder inlining.

Use direct code in critical loops if needed.

## 34.8 Separate domain and engine

A common pattern:

```text
domain model for correctness
engine model for performance
mapper between them
```

---

# 35. Production Failure Modes

## 35.1 OOM from boxed collection

`List<Integer>` for millions of values.

Fix:

- `int[]`;
- primitive collection;
- streaming.

## 35.2 GC storm from BigDecimal loop

Repeated BigDecimal operations in hot aggregation.

Fix:

- minor units long if valid;
- reduce intermediate allocations;
- batch carefully.

## 35.3 Stream pipeline in hot parser

High allocation/overhead.

Fix:

- loop;
- primitive stream;
- benchmark.

## 35.4 Regex compiled per call

`String.matches` in validation loop.

Fix:

- static final Pattern.

## 35.5 DateTimeFormatter created per request

Repeated formatter allocation.

Fix:

- static final formatter if pattern/locale fixed.

## 35.6 HashMap resize under load

Large map built without capacity.

Fix:

- pre-size;
- use appropriate load factor.

## 35.7 LinkedList selected for queue

Poor memory/locality.

Fix:

- ArrayDeque or BlockingQueue.

## 35.8 AtomicLong hot counter contention

Many threads update same counter.

Fix:

- LongAdder for metrics.

## 35.9 ConcurrentHashMap hot key contention

All updates same key.

Fix:

- sharding/LongAdder values/design change.

## 35.10 Microbenchmark misleading

Optimization based on unrealistic benchmark worsens production.

Fix:

- production profiling;
- representative JMH data;
- load test.

## 35.11 Logging toString on large record

Generated toString traverses huge fields.

Fix:

- safe concise toString;
- structured logging with selected fields.

## 35.12 Serialization dominates but code optimized elsewhere

Spent time optimizing in-memory type while JSON/DB dominates.

Fix:

- profile first.

---

# 36. Best Practices

## 36.1 General

- Design for correctness first.
- Measure before optimizing.
- Use JMH for microbenchmarks.
- Use JFR/profilers for production/application profiling.
- Avoid boxed primitives in large/hot numeric data.
- Use primitive arrays/streams when needed.
- Prefer ArrayList/ArrayDeque over LinkedList in most cases.
- Use EnumSet/EnumMap for enum.
- Pre-size large collections.
- Reuse DateTimeFormatter/Pattern.
- Avoid BigDecimal in hot loops unless exact decimal needed.
- Use minor units for money when domain allows.
- Use immutable snapshots for read-heavy shared state.
- Use LongAdder for high-contention metrics.
- Avoid `toString` of huge/sensitive records in hot logs.
- Keep parsing/formatting at boundaries.
- Validate optimization end-to-end.

## 36.2 Benchmarking

- Warm up.
- Use forks.
- Avoid dead code elimination.
- Parametrize sizes.
- Use realistic data distribution.
- Measure allocation.
- Benchmark concurrent workloads with threads.
- Do not trust one run.
- Confirm with production-like load.

## 36.3 Code review checklist

Ask:

```text
Is this type boxed in a hot path?
Does this allocate per element/request?
Does this collection resize?
Is this String/regex/date formatter repeated?
Is this object graph too deep?
Is this value used as map key efficiently?
Is this concurrency primitive contended?
Did we measure?
```

---

# 37. Decision Matrix

| Situation | Recommended |
|---|---|
| small business collection | clear domain collection |
| millions of ints | `int[]` / primitive collection |
| monetary correctness | `BigDecimal` or minor units if valid |
| monetary hot aggregation | minor units `long` if domain allows |
| enum flags | `EnumSet` |
| enum key map | `EnumMap` |
| FIFO single-thread queue | `ArrayDeque` |
| producer-consumer | `BlockingQueue` |
| high-contention metric counter | `LongAdder` |
| exact sequence counter | `AtomicLong` |
| hot string validation | precompiled `Pattern` |
| date formatting fixed pattern | reused `DateTimeFormatter` |
| object-rich hot loop | consider compact representation |
| lookup by ID normal scale | `HashMap<Id, Value>` |
| huge primitive key map | primitive specialized map |
| read-heavy config | immutable snapshot + volatile/AtomicReference |
| benchmark type alternatives | JMH |
| production bottleneck search | JFR/profiler/APM |
| suspected memory leak | heap dump retained size |
| suspicious allocation rate | JFR allocation profiling |

---

# 38. Latihan

## Latihan 1 — int[] vs List<Integer>

Benchmark sum over `int[]`, `Integer[]`, and `List<Integer>` using JMH.

Measure throughput and allocation.

## Latihan 2 — Loop vs Stream

Benchmark loop vs `Arrays.stream(ints).sum()` vs boxed stream.

## Latihan 3 — BigDecimal vs Minor Units

Implement money addition with BigDecimal and long cents. Benchmark and discuss correctness trade-off.

## Latihan 4 — Pattern.compile

Compare `String.matches` vs static final `Pattern` in validation loop.

## Latihan 5 — DateTimeFormatter

Compare creating formatter per call vs reusing static formatter.

## Latihan 6 — ArrayList vs LinkedList Iteration

Benchmark iteration over 1M elements.

## Latihan 7 — HashMap Initial Capacity

Benchmark building large HashMap with/without initial capacity.

## Latihan 8 — EnumMap vs HashMap

Benchmark enum key lookup.

## Latihan 9 — AtomicLong vs LongAdder

Benchmark multi-thread increments.

## Latihan 10 — JFR Allocation

Run a small app that creates many boxed integers. Capture JFR and find allocation hotspot.

## Latihan 11 — Record toString

Create record with large list and log toString in loop. Measure allocation. Override concise toString.

## Latihan 12 — Production Workflow

Pick a real endpoint/batch job. Define target, collect JFR, identify top allocation/CPU hotspot, propose one data type change.

---

# 39. Ringkasan

Data type performance is about cost model.

Key dimensions:

```text
CPU
memory
allocation
GC
cache locality
JIT optimization
polymorphism
contention
boundary conversion
```

Main lessons:

- Primitive arrays are compact and fast for large numeric data.
- Wrapper/boxing overhead matters in hot/large paths.
- Object graph depth causes pointer chasing and GC cost.
- ArrayList is usually better than LinkedList.
- EnumSet/EnumMap are excellent for enum.
- BigDecimal is correct for exact decimal but more expensive.
- String operations can allocate; regex/date formatting should be reused when hot.
- Optional is good API signal, but avoid large/hot storage use.
- Streams are fine for clarity, but loops may win in hot paths.
- Records are ordinary objects; correctness benefit first, memory cost at scale.
- Volatile/atomic/locks/concurrent collections all have different costs.
- LongAdder is for high-contention metrics, not sequence IDs.
- JIT can eliminate some allocations, but only under conditions.
- Microbenchmarks can mislead; use JMH properly.
- Production profiling with JFR often reveals the real bottleneck.

Senior Java engineer tidak bertanya:

```text
Apakah X cepat?
```

Mereka bertanya:

```text
Cepat untuk workload apa?
Data size berapa?
Allocation berapa?
GC impact apa?
JIT bisa optimize tidak?
Boundary cost dominan tidak?
Sudah diukur dengan apa?
```

Performance-aware data type design adalah seni memilih representation yang cukup benar, cukup cepat, cukup hemat, dan tetap maintainable.

---

# 40. Referensi

1. OpenJDK JMH — Java Microbenchmark Harness  
   https://github.com/openjdk/jmh

2. OpenJDK Code Tools — JMH  
   https://openjdk.org/projects/code-tools/jmh/

3. Java SE 25 API — `jdk.jfr` package  
   https://docs.oracle.com/en/java/javase/25/docs/api/jdk.jfr/jdk/jfr/package-summary.html

4. Java SE 25 API — `java.util.stream` package  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

5. Java SE 25 API — `BigDecimal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html

6. JEP 254 — Compact Strings  
   https://openjdk.org/jeps/254

7. Java SE 25 API — `LongAdder`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html

8. Java SE 25 API — `AtomicLong`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicLong.html

9. Java SE 25 API — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

10. Java SE 25 API — `EnumMap`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumMap.html

11. Java SE 25 API — `EnumSet`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumSet.html

12. Java SE 25 API — `DateTimeFormatter`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/format/DateTimeFormatter.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Data Types — Part 022](./learn-java-data-types-part-022.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Data Types — Part 024](./learn-java-data-types-part-024.md)

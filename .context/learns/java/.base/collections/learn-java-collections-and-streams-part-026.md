# learn-java-collections-and-streams-part-026.md

# Java Collections and Streams — Part 026  
# Intermediate Operations Deep Dive: filter, map, flatMap, mapMulti, distinct, sorted, peek, limit, skip, takeWhile, dropWhile, unordered, Stateless vs Stateful, and Pipeline Cost

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **026**  
> Fokus: memahami intermediate operations bukan sebagai “method chaining cantik”, tetapi sebagai stage dalam lazy pipeline yang punya karakter: stateless/stateful, short-circuiting, order-sensitive, buffering, equality/comparator dependency, side-effect risk, dan parallel cost.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Intermediate Operation adalah Pipeline Stage](#2-mental-model-intermediate-operation-adalah-pipeline-stage)
3. [Stateless vs Stateful Intermediate Operations](#3-stateless-vs-stateful-intermediate-operations)
4. [Short-Circuiting Intermediate Operations](#4-short-circuiting-intermediate-operations)
5. [Order-Sensitive Intermediate Operations](#5-order-sensitive-intermediate-operations)
6. [`filter`](#6-filter)
7. [`map`](#7-map)
8. [`mapToInt`, `mapToLong`, `mapToDouble`](#8-maptoint-maptolong-maptodouble)
9. [`flatMap`](#9-flatmap)
10. [`flatMapToInt`, `flatMapToLong`, `flatMapToDouble`](#10-flatmaptoint-flatmaptolong-flatmaptodouble)
11. [`mapMulti`](#11-mapmulti)
12. [`mapMultiToInt`, `mapMultiToLong`, `mapMultiToDouble`](#12-mapmultitoint-mapmultitolong-mapmultitodouble)
13. [`distinct`](#13-distinct)
14. [`sorted`](#14-sorted)
15. [`peek`](#15-peek)
16. [`limit`](#16-limit)
17. [`skip`](#17-skip)
18. [`takeWhile`](#18-takewhile)
19. [`dropWhile`](#19-dropwhile)
20. [`unordered`](#20-unordered)
21. [`sequential` and `parallel` as Mode Switches](#21-sequential-and-parallel-as-mode-switches)
22. [Operation Ordering: Why Stage Order Matters](#22-operation-ordering-why-stage-order-matters)
23. [Stateful Operation Placement](#23-stateful-operation-placement)
24. [Side Effects in Intermediate Operations](#24-side-effects-in-intermediate-operations)
25. [Null Handling in Intermediate Operations](#25-null-handling-in-intermediate-operations)
26. [Exception Handling in Intermediate Operations](#26-exception-handling-in-intermediate-operations)
27. [Intermediate Operations and Infinite Streams](#27-intermediate-operations-and-infinite-streams)
28. [Intermediate Operations and Parallel Streams](#28-intermediate-operations-and-parallel-streams)
29. [Performance Cost Model](#29-performance-cost-model)
30. [Debugging Intermediate Operations](#30-debugging-intermediate-operations)
31. [Common Anti-Patterns](#31-common-anti-patterns)
32. [Production Failure Modes](#32-production-failure-modes)
33. [Best Practices](#33-best-practices)
34. [Decision Matrix](#34-decision-matrix)
35. [Latihan](#35-latihan)
36. [Ringkasan](#36-ringkasan)
37. [Referensi](#37-referensi)

---

# 1. Tujuan Bagian Ini

Intermediate operation adalah operasi stream yang mengembalikan stream lagi.

Contoh:

```java
users.stream()
    .filter(User::active)
    .map(User::email)
    .distinct()
    .sorted()
    .limit(100)
    .toList();
```

Di sini:

```java
filter
map
distinct
sorted
limit
```

adalah intermediate operations.

Banyak developer memahami intermediate ops hanya sebagai:

```text
filter = where
map = transform
sorted = sort
distinct = unique
```

Itu benar, tapi belum cukup.

Untuk production-grade engineering, kamu harus memahami:

- operation lazy atau tidak;
- stateless atau stateful;
- short-circuiting atau tidak;
- butuh buffering atau tidak;
- order-sensitive atau tidak;
- cocok untuk parallel atau tidak;
- bergantung pada equals/hashCode atau comparator;
- apakah bisa menyebabkan memory blow-up;
- apakah lambda punya side effect;
- apakah source infinite;
- apakah null bisa lewat.

Tujuan bagian ini:

- membedah setiap intermediate operation penting;
- memahami cost dan semantics;
- memahami stage ordering;
- memahami traps;
- membangun mental model sebelum terminal operations, primitive streams, reduction, collectors, dan parallel streams.

---

# 2. Mental Model: Intermediate Operation adalah Pipeline Stage

Intermediate operation tidak langsung menjalankan computation.

Ia menambahkan stage ke pipeline.

```java
Stream<String> pipeline = names.stream()
    .filter(name -> name.length() > 3)
    .map(String::toUpperCase);
```

Sampai titik ini, belum ada element diproses.

Processing baru terjadi saat terminal operation:

```java
List<String> result = pipeline.toList();
```

## 2.1 Pipeline stage

Setiap stage bisa:

- menerima element;
- menolak element;
- mengubah element;
- menghasilkan nol/satu/banyak element;
- menahan element sementara;
- membatasi jumlah element;
- mengubah order;
- mengubah mode/order constraint.

## 2.2 Per-element flow

Untuk stateless operations:

```text
element -> filter -> map -> downstream
```

## 2.3 Stateful operations

Untuk operations seperti `sorted`:

```text
many elements -> buffer/sort -> downstream
```

## 2.4 Rule

```text
Intermediate operations describe a lazy processing plan, not immediate collection transformations.
```

---

# 3. Stateless vs Stateful Intermediate Operations

Java stream docs membagi intermediate operations menjadi stateless dan stateful.

## 3.1 Stateless

Stateless operation tidak perlu mengingat element sebelumnya untuk memproses element berikutnya.

Examples:

```java
filter
map
flatMap
mapMulti
peek
```

## 3.2 Stateful

Stateful operation perlu state dari element sebelumnya atau perlu melihat lebih banyak input sebelum menghasilkan output.

Examples:

```java
distinct
sorted
limit
skip
takeWhile
dropWhile
```

Catatan: `limit`, `skip`, `takeWhile`, `dropWhile` sangat dipengaruhi order dan short-circuit behavior.

## 3.3 Why it matters

Stateful operations can:

- buffer;
- increase memory;
- constrain parallelism;
- change latency;
- require equality/comparison;
- make infinite streams tricky.

## 3.4 Rule

Stateless operations are streaming-friendly. Stateful operations need more careful cost reasoning.

---

# 4. Short-Circuiting Intermediate Operations

Intermediate operation disebut short-circuiting jika pada input infinite ia bisa menghasilkan stream finite.

Examples:

```java
limit
takeWhile
```

## 4.1 limit

```java
Stream.generate(UUID::randomUUID)
    .limit(10)
    .toList();
```

Infinite source becomes finite.

## 4.2 takeWhile

```java
Stream.iterate(1, n -> n + 1)
    .takeWhile(n -> n <= 10)
    .toList();
```

## 4.3 skip is not enough

```java
Stream.iterate(0, n -> n + 1)
    .skip(1_000)
    .toList();
```

Still infinite.

## 4.4 Rule

Short-circuiting intermediate operations are necessary for safely bounding infinite sources.

---

# 5. Order-Sensitive Intermediate Operations

Some operations behave differently or cost differently when stream is ordered.

## 5.1 Examples

```java
limit
skip
takeWhile
dropWhile
distinct
sorted
```

## 5.2 Ordered stream

Must preserve encounter order constraints.

## 5.3 Unordered stream

Can allow more freedom, especially parallel.

## 5.4 Example

```java
set.parallelStream()
    .unordered()
    .limit(100)
```

May be more efficient if any 100 elements are acceptable.

## 5.5 Rule

When order does not matter, removing order constraints can improve performance.

---

# 6. `filter`

`filter` keeps elements matching predicate.

```java
stream.filter(predicate)
```

## 6.1 Example

```java
List<User> active = users.stream()
    .filter(User::active)
    .toList();
```

## 6.2 Characteristics

- stateless if predicate stateless;
- lazy;
- preserves encounter order;
- may reduce element count;
- does not transform type.

## 6.3 Predicate should be pure

Good:

```java
user -> user.active()
```

Bad:

```java
user -> {
    auditList.add(user);
    return user.active();
}
```

## 6.4 Expensive predicate

Place cheap selective filters early.

```java
orders.stream()
    .filter(Order::paid)
    .filter(this::expensiveFraudCheck)
```

## 6.5 Null risk

If stream may contain null:

```java
.filter(Objects::nonNull)
```

before method reference.

## 6.6 Rule

Use filter for selection; keep predicates stateless and cheap when possible.

---

# 7. `map`

`map` transforms each element into one element.

```java
<R> Stream<R> map(Function<? super T, ? extends R> mapper)
```

## 7.1 Example

```java
List<String> emails = users.stream()
    .map(User::email)
    .toList();
```

## 7.2 Characteristics

- stateless if mapper stateless;
- one input -> one output;
- may change type;
- preserves encounter order;
- mapper may return null.

## 7.3 Common use

DTO projection:

```java
orders.stream()
    .map(OrderDto::from)
    .toList();
```

## 7.4 Avoid side effects

Bad:

```java
.map(user -> {
    user.setActive(false);
    return user;
})
```

Use loop or explicit mutation flow.

## 7.5 Rule

Use map for pure transformation.

---

# 8. `mapToInt`, `mapToLong`, `mapToDouble`

These convert object stream to primitive stream.

## 8.1 Example

```java
int total = orders.stream()
    .mapToInt(Order::quantity)
    .sum();
```

## 8.2 Why important

Avoids boxing:

```java
Stream<Integer>
```

vs:

```java
IntStream
```

## 8.3 Numeric terminal operations

Primitive streams have:

```java
sum
average
summaryStatistics
min
max
```

## 8.4 Rule

Use primitive mapping for numeric aggregation.

---

# 9. `flatMap`

`flatMap` maps each input element to a stream, then flattens all resulting streams.

```java
<R> Stream<R> flatMap(Function<T, Stream<R>> mapper)
```

## 9.1 Example

```java
List<OrderLine> lines = orders.stream()
    .flatMap(order -> order.lines().stream())
    .toList();
```

## 9.2 One-to-many

Input:

```text
Order -> Stream<OrderLine>
```

Output:

```text
OrderLine, OrderLine, ...
```

## 9.3 Good use cases

- nested collections;
- optional values;
- parent-child flattening;
- tokenizing;
- decomposing records.

## 9.4 Empty stream for no elements

```java
.flatMap(order -> order.lines() == null
    ? Stream.empty()
    : order.lines().stream())
```

## 9.5 Stream closing

Mapped streams are closed after contents placed into pipeline.

## 9.6 Cost

Creates many small streams if used heavily.

## 9.7 Rule

Use flatMap for one-to-many transformation, but avoid excessive tiny stream creation in hot paths if mapMulti fits.

---

# 10. `flatMapToInt`, `flatMapToLong`, `flatMapToDouble`

Primitive flattening variants.

## 10.1 Example

```java
int total = orders.stream()
    .flatMapToInt(order -> order.lines().stream()
        .mapToInt(OrderLine::quantity))
    .sum();
```

## 10.2 Use case

Nested numeric data.

## 10.3 Rule

Use primitive flatMap variants when flattening numeric streams.

---

# 11. `mapMulti`

`mapMulti` maps one input element to zero or more output elements using a consumer, without creating a stream per element.

```java
<R> Stream<R> mapMulti(BiConsumer<T, Consumer<R>> mapper)
```

## 11.1 Example

```java
List<OrderLine> lines = orders.stream()
    .<OrderLine>mapMulti((order, downstream) -> {
        for (OrderLine line : order.lines()) {
            downstream.accept(line);
        }
    })
    .toList();
```

## 11.2 Compared to flatMap

`flatMap`:

```java
.flatMap(order -> order.lines().stream())
```

`mapMulti`:

```java
.mapMulti((order, out) -> order.lines().forEach(out))
```

## 11.3 When useful

- replace flatMap with fewer temporary streams;
- emit zero/one/few elements;
- flatten optional-like values;
- imperative emission clearer.

## 11.4 Type inference

Sometimes you need explicit type witness:

```java
.<OrderLine>mapMulti(...)
```

## 11.5 Rule

Use mapMulti when one-to-many emission is simple and you want to avoid per-element stream allocation.

---

# 12. `mapMultiToInt`, `mapMultiToLong`, `mapMultiToDouble`

Primitive variants.

## 12.1 Example

```java
int total = orders.stream()
    .mapMultiToInt((order, out) -> {
        for (OrderLine line : order.lines()) {
            out.accept(line.quantity());
        }
    })
    .sum();
```

## 12.2 Benefit

Avoids boxing and avoids nested primitive streams.

## 12.3 Rule

Use primitive mapMulti variants for efficient flattening numeric data.

---

# 13. `distinct`

`distinct` removes duplicate elements.

```java
stream.distinct()
```

## 13.1 Equality dependency

For object streams, distinct uses `equals`.

Therefore correctness depends on:

```java
equals
hashCode
```

## 13.2 Characteristics

- stateful;
- may need to remember seen elements;
- preserves encounter order for ordered streams;
- can be expensive in parallel ordered streams.

## 13.3 Example

```java
List<UserId> ids = users.stream()
    .map(User::id)
    .distinct()
    .toList();
```

## 13.4 Memory cost

Needs a set of seen values.

Large stream -> large memory.

## 13.5 Sorted distinct?

If source sorted and duplicates adjacent, a custom approach may be cheaper in some cases, but standard distinct is general.

## 13.6 Rule

Use distinct when equality-based uniqueness is needed; remember it is stateful and memory-using.

---

# 14. `sorted`

`sorted` sorts stream elements.

## 14.1 Natural sort

```java
stream.sorted()
```

Elements must be Comparable.

## 14.2 Comparator sort

```java
stream.sorted(Comparator.comparing(User::lastName))
```

## 14.3 Characteristics

- stateful;
- order-changing;
- often buffers entire input;
- expensive for large streams;
- impossible to finish for infinite unbounded stream.

## 14.4 Use min/max instead

Bad:

```java
users.stream()
    .sorted(Comparator.comparing(User::createdAt))
    .findFirst();
```

Better:

```java
users.stream()
    .min(Comparator.comparing(User::createdAt));
```

## 14.5 Stability

For ordered streams, sorted is stable.

## 14.6 Rule

Use sorted for full ordered output, not for finding one minimum/maximum.

---

# 15. `peek`

`peek` performs action on elements as they pass through.

```java
stream.peek(action)
```

## 15.1 Intended use

Mostly debugging.

```java
stream.peek(x -> log.debug("after filter: {}", x))
```

## 15.2 Lazy

`peek` runs only when terminal operation pulls elements.

## 15.3 Dangerous as business logic

Bad:

```java
orders.stream()
    .peek(order -> order.markProcessed())
    .toList();
```

## 15.4 Short-circuit caveat

With terminal short-circuiting, peek may run for only some elements.

## 15.5 Parallel caveat

In parallel stream, peek action may run concurrently and out of expected order.

## 15.6 Rule

Use peek for debugging/observability, not required business mutation.

---

# 16. `limit`

`limit(n)` truncates stream to at most n elements.

## 16.1 Example

```java
List<User> top10 = users.stream()
    .limit(10)
    .toList();
```

## 16.2 Characteristics

- short-circuiting stateful intermediate operation;
- order-sensitive;
- useful for infinite streams.

## 16.3 Ordered parallel cost

For ordered parallel streams, limit may need to preserve first n in encounter order.

## 16.4 Unordered optimization

If any n elements are okay:

```java
stream.unordered().limit(n)
```

may be cheaper.

## 16.5 Rule

Use limit to bound work; consider order cost.

---

# 17. `skip`

`skip(n)` discards first n elements.

## 17.1 Example

```java
List<User> page = users.stream()
    .skip(offset)
    .limit(size)
    .toList();
```

## 17.2 Characteristics

- stateful;
- order-sensitive;
- not enough to bound infinite stream by itself.

## 17.3 Large offset cost

Skipping a huge offset can still traverse many elements.

## 17.4 Pagination caution

Stream skip over database result loaded into memory is not database pagination.

Push pagination to DB when possible.

## 17.5 Rule

Use skip for in-memory stream slicing, not as substitute for source-level pagination.

---

# 18. `takeWhile`

`takeWhile(predicate)` takes longest prefix matching predicate.

## 18.1 Example

```java
List<Integer> small = numbers.stream()
    .takeWhile(n -> n < 100)
    .toList();
```

## 18.2 Ordered stream

For ordered stream, stops at first non-matching element.

Input:

```text
1, 2, 200, 3
```

takeWhile `< 100` returns:

```text
1, 2
```

not:

```text
1, 2, 3
```

## 18.3 Unordered stream

Semantics differ because prefix is not meaningful.

## 18.4 Infinite stream

Can bound infinite ordered stream if predicate eventually false.

## 18.5 Rule

takeWhile is prefix-based, not filter.

---

# 19. `dropWhile`

`dropWhile(predicate)` drops longest prefix matching predicate, then emits remaining elements.

## 19.1 Example

```java
List<Integer> rest = numbers.stream()
    .dropWhile(n -> n < 100)
    .toList();
```

Input:

```text
1, 2, 200, 3
```

Output:

```text
200, 3
```

## 19.2 Not filter

It only drops prefix.

## 19.3 Ordered stream

Meaningful with encounter order.

## 19.4 Use cases

- skip header lines;
- ignore leading warm-up samples;
- process after marker.

## 19.5 Rule

dropWhile is prefix removal, not global exclusion.

---

# 20. `unordered`

`unordered()` removes ordered constraint from stream.

## 20.1 Example

```java
stream.unordered()
    .limit(100)
```

## 20.2 It does not shuffle

It does not mean randomize.

It means downstream no longer needs preserve encounter order.

## 20.3 Useful in parallel

Can improve performance for operations like:

- distinct;
- limit;
- skip;
- findAny.

## 20.4 Rule

Use unordered when order truly does not matter.

---

# 21. `sequential` and `parallel` as Mode Switches

Streams can switch mode:

```java
stream.parallel()
stream.sequential()
```

## 21.1 Last mode wins

Pipeline mode is effectively determined by latest mode setting before terminal execution.

## 21.2 Use carefully

Avoid sprinkling mode switches through code.

## 21.3 Rule

Choose sequential/parallel intentionally at source/pipeline boundary.

---

# 22. Operation Ordering: Why Stage Order Matters

Intermediate operation order can change both result and cost.

## 22.1 Filter before map

If map expensive:

```java
users.stream()
    .filter(User::active)
    .map(this::expensiveProjection)
```

better than mapping inactive users.

## 22.2 Limit before sort?

```java
stream.limit(100).sorted()
```

sorts first 100 elements.

```java
stream.sorted().limit(100)
```

returns global top 100 by sort order.

Different result.

## 22.3 Distinct before limit?

```java
stream.distinct().limit(10)
```

first 10 unique.

```java
stream.limit(10).distinct()
```

unique among first 10.

Different result.

## 22.4 Rule

Stage order is semantics, not just optimization.

---

# 23. Stateful Operation Placement

## 23.1 Put reducing filters before stateful ops

Better:

```java
orders.stream()
    .filter(Order::paid)
    .distinct()
```

than distinct over all orders if only paid orders matter.

## 23.2 Avoid sorting before filtering

Usually:

```java
filter -> sorted
```

unless sorting affects predicate semantics.

## 23.3 Limit early only if semantically correct

Limit can reduce work but changes meaning if placed too early.

## 23.4 Rule

Stateful operations should usually process as few elements as semantics allow.

---

# 24. Side Effects in Intermediate Operations

Side effects inside intermediate operations are traps.

## 24.1 Lazy means side effect timing is delayed

```java
stream.map(x -> {
    sideEffect(x);
    return transform(x);
});
```

No terminal -> no side effect.

## 24.2 Short-circuit means side effect may not run for all

```java
stream.peek(this::audit)
    .findFirst();
```

Only some elements audited.

## 24.3 Parallel means side effect may be concurrent

Race risk.

## 24.4 Rule

Required side effects belong in explicit control flow or terminal operations with careful design, not hidden intermediate stages.

---

# 25. Null Handling in Intermediate Operations

## 25.1 map can produce null

```java
users.stream()
    .map(User::middleName)
```

May produce null.

## 25.2 Next stage can fail

```java
.map(String::toUpperCase)
```

NPE if null.

## 25.3 Use filter

```java
.map(User::middleName)
.filter(Objects::nonNull)
```

## 25.4 Use flatMap + ofNullable

```java
.flatMap(user -> Stream.ofNullable(user.middleName()))
```

## 25.5 Rule

Normalize nulls early and explicitly.

---

# 26. Exception Handling in Intermediate Operations

Checked exceptions do not fit standard functional interfaces.

## 26.1 Bad fit

```java
paths.stream()
    .map(Files::readString)
```

does not compile because IOException.

## 26.2 Options

- handle inside lambda;
- wrap as unchecked;
- use loop;
- produce `Result` type;
- perform IO outside stream.

## 26.3 Rule

If exception handling dominates, use loop or explicit result modeling.

---

# 27. Intermediate Operations and Infinite Streams

## 27.1 Safe

```java
Stream.iterate(0, n -> n + 1)
    .filter(n -> n % 2 == 0)
    .limit(10)
    .toList();
```

## 27.2 Unsafe

```java
Stream.iterate(0, n -> n + 1)
    .sorted()
    .limit(10)
```

Sorting infinite stream cannot complete.

## 27.3 takeWhile

Can safely bound if predicate eventually false.

## 27.4 distinct on infinite stream

May run forever or grow memory unbounded.

## 27.5 Rule

Do not use unbounded buffering operations on infinite streams.

---

# 28. Intermediate Operations and Parallel Streams

## 28.1 Stateless operations parallelize well

```java
map
filter
```

if functions are independent and work enough.

## 28.2 Stateful ordered operations can be costly

```java
distinct
sorted
limit
skip
takeWhile
dropWhile
```

especially preserving encounter order.

## 28.3 unordered can help

```java
parallelStream.unordered().distinct()
```

if order does not matter.

## 28.4 Side effects are dangerous

Shared mutable state breaks correctness.

## 28.5 Rule

Parallel stream performance depends heavily on intermediate operation characteristics.

---

# 29. Performance Cost Model

## 29.1 Cheap stateless ops

```java
filter
map
peek
```

mostly per-element function cost.

## 29.2 One-to-many ops

```java
flatMap
mapMulti
```

cost includes emitted element count and allocation.

## 29.3 Stateful ops

```java
distinct
sorted
skip/limit ordered
```

can require memory/buffering/coordination.

## 29.4 Primitive ops

Avoid boxing.

## 29.5 Rule

Intermediate operation cost is not uniform; know each operation's data and memory behavior.

---

# 30. Debugging Intermediate Operations

## 30.1 Use peek sparingly

```java
.peek(x -> log.debug("x={}", x))
```

## 30.2 Use named methods

```java
.filter(this::isEligible)
.map(this::toDto)
```

## 30.3 Split complex pipeline

Complex stream can be broken for clarity.

## 30.4 Avoid relying on peek in tests

Terminal short-circuiting may make peek partial.

## 30.5 Rule

Debug for understanding, not as permanent business mechanism.

---

# 31. Common Anti-Patterns

## 31.1 `peek` for mutation

Bad.

## 31.2 External mutable list in map/filter

Bad.

## 31.3 `sorted().findFirst()` instead of `min`

Bad.

## 31.4 `skip` for database pagination

Bad if source already loaded huge data.

## 31.5 `distinct` on objects without correct equals/hashCode

Bad.

## 31.6 `takeWhile` used as filter

Wrong semantics.

## 31.7 `flatMap` producing null stream

Mapper must not return null.

## 31.8 Infinite stream with sorted/distinct collect

Dangerous.

## 31.9 Parallel stream with stateful lambdas

Dangerous.

## 31.10 Rule

Most intermediate operation bugs are semantic misunderstanding, not syntax errors.

---

# 32. Production Failure Modes

## 32.1 Memory blow-up from distinct

Large unique stream keeps large seen set.

## 32.2 Memory blow-up from sorted

Large stream buffered for sorting.

## 32.3 Infinite stream never terminates

Stateful unbounded operation.

## 32.4 Wrong result from stage ordering

`limit` before `sorted`, or `distinct` before/after limit.

## 32.5 Parallel race from side effects

External mutable accumulator.

## 32.6 Missing audit due to peek + short-circuit

Side effect does not run for all elements.

## 32.7 NPE after map returns null

No null normalization.

## 32.8 Performance regression from flatMap tiny streams

Use mapMulti or loop.

## 32.9 Ordered parallel limit slow

Use unordered if semantics allow.

## 32.10 takeWhile stops too early

It is prefix-based.

## 32.11 dropWhile keeps later matching items

It only drops prefix.

## 32.12 Comparator expensive in sorted

Precompute key or sort differently.

---

# 33. Best Practices

## 33.1 Keep lambdas pure

Stateless, non-interfering, side-effect-free.

## 33.2 Filter early

Reduce data before expensive map/sort/distinct when semantics allow.

## 33.3 Use primitive mapping

For numeric aggregation.

## 33.4 Use mapMulti when appropriate

Avoid flatMap overhead for simple emission.

## 33.5 Use min/max instead of sorted+findFirst/last

When only one extremum needed.

## 33.6 Bound infinite streams

Use limit/takeWhile/short-circuit.

## 33.7 Handle null explicitly

`filter(Objects::nonNull)` or `Stream.ofNullable`.

## 33.8 Be careful with order

Use unordered only when correct.

## 33.9 Avoid stream for complex mutation

Use loop if clearer.

---

# 34. Decision Matrix

| Need | Operation |
|---|---|
| keep matching elements | `filter` |
| transform one-to-one | `map` |
| transform to primitive int | `mapToInt` |
| flatten nested streams | `flatMap` |
| flatten simple zero/many emission | `mapMulti` |
| remove duplicates by equals | `distinct` |
| sort all elements | `sorted` |
| debug element flow | `peek` carefully |
| keep first n | `limit` |
| discard first n | `skip` |
| take ordered prefix while predicate true | `takeWhile` |
| drop ordered prefix while predicate true | `dropWhile` |
| remove order constraint | `unordered` |
| make pipeline parallel | `parallel` |
| force sequential | `sequential` |
| find minimum | terminal `min`, not `sorted().findFirst()` |
| find maximum | terminal `max`, not full sort |
| nullable one-to-zero/one | `flatMap(x -> Stream.ofNullable(...))` |
| numeric nested flattening | `mapMultiToInt`/`flatMapToInt` |
| database pagination | push to database, not stream skip |
| side-effect mutation | loop or terminal with care |

---

# 35. Latihan

## Latihan 1 — Laziness

Create pipeline with `filter`, `map`, `peek`.

Show no output until terminal operation.

## Latihan 2 — Stage Ordering

Compare:

```java
stream.limit(10).sorted()
stream.sorted().limit(10)
```

Explain result difference.

## Latihan 3 — distinct Cost

Run distinct on large random data.

Explain memory behavior.

## Latihan 4 — sorted vs min

Find oldest user with `sorted().findFirst()` then with `min`.

Explain why min is better.

## Latihan 5 — takeWhile vs filter

Input:

```text
1, 2, 100, 3, 4
```

Compare `takeWhile(n < 10)` and `filter(n < 10)`.

## Latihan 6 — flatMap vs mapMulti

Flatten `List<Order>` to `OrderLine`.

Implement both.

## Latihan 7 — Null Map

Map users to optional middle name with null handling.

Use `Stream.ofNullable`.

## Latihan 8 — peek Trap

Use `peek` for audit then `findFirst`.

Show audit incomplete.

## Latihan 9 — Parallel Side Effect

Use parallel stream adding to ArrayList.

Fix with collect/toList.

## Latihan 10 — Infinite Stream

Try infinite stream with `limit`, then explain why `sorted` before limit is wrong.

---

# 36. Ringkasan

Intermediate operations are lazy pipeline stages.

Core lessons:

- Intermediate operations return streams.
- They do not execute until terminal operation.
- Stateless operations process each element independently.
- Stateful operations may buffer or remember prior elements.
- `filter` selects.
- `map` transforms one-to-one.
- primitive map avoids boxing.
- `flatMap` flattens one-to-many streams.
- `mapMulti` emits zero/many without creating nested streams.
- `distinct` uses equals/hashCode and needs memory.
- `sorted` buffers and sorts; use min/max for extremum.
- `peek` is mainly for debugging.
- `limit` bounds stream and is short-circuiting.
- `skip` discards prefix but does not bound infinite stream.
- `takeWhile` and `dropWhile` are prefix operations.
- `unordered` removes order constraints but does not shuffle.
- Stage order affects both semantics and performance.
- Side effects are dangerous.
- Infinite streams require bounding.
- Parallel performance depends heavily on operation characteristics.

Main rule:

```text
Intermediate operations are not just syntax.
They encode dataflow, state, ordering, memory, and termination behavior.
```

---

# 37. Referensi

1. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

2. Java SE 25 — `java.util.stream` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

3. Java SE 25 — `IntStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.html

4. Java SE 25 — `LongStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/LongStream.html

5. Java SE 25 — `DoubleStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/DoubleStream.html

6. dev.java — Adding Intermediate Operations on a Stream  
   https://dev.java/learn/adding-intermediate-operations-on-a-stream/

7. dev.java — The Stream API  
   https://dev.java/learn/api/streams/

8. Java SE 25 — `Comparator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html

9. Java SE 25 — `Objects`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html

10. Java SE 25 — `Collection.stream`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html#stream()

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-025.md](./learn-java-collections-and-streams-part-025.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-027.md](./learn-java-collections-and-streams-part-027.md)

</div>
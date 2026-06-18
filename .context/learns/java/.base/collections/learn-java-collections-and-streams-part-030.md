# learn-java-collections-and-streams-part-030.md

# Java Collections and Streams — Part 030  
# Collectors Deep Dive: Mutable Reduction Protocol, Supplier, Accumulator, Combiner, Finisher, Characteristics, Downstream Collectors, Concurrent Collectors, and Custom Collector Correctness

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **030**  
> Fokus: memahami `Collector` sebagai protokol **mutable reduction** yang dipakai `Stream.collect(...)`. Kita akan membedah supplier, accumulator, combiner, finisher, characteristics, predefined collectors, downstream collectors, custom collectors, concurrent collectors, grouping patterns, performance cost, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Collector = Recipe for Mutable Reduction](#2-mental-model-collector--recipe-for-mutable-reduction)
3. [Why Collectors Exist](#3-why-collectors-exist)
4. [`collect` vs `reduce`](#4-collect-vs-reduce)
5. [Collector Type Parameters: `T`, `A`, `R`](#5-collector-type-parameters-t-a-r)
6. [Supplier](#6-supplier)
7. [Accumulator](#7-accumulator)
8. [Combiner](#8-combiner)
9. [Finisher](#9-finisher)
10. [Collector Characteristics](#10-collector-characteristics)
11. [`IDENTITY_FINISH`](#11-identity_finish)
12. [`UNORDERED`](#12-unordered)
13. [`CONCURRENT`](#13-concurrent)
14. [Non-Concurrent Collector in Parallel Stream](#14-non-concurrent-collector-in-parallel-stream)
15. [Concurrent Collector in Parallel Stream](#15-concurrent-collector-in-parallel-stream)
16. [Basic Collection Collectors](#16-basic-collection-collectors)
17. [`toList`, `toUnmodifiableList`, `Stream.toList`](#17-tolist-tounmodifiablelist-streamtolist)
18. [`toSet`, `toUnmodifiableSet`](#18-toset-tounmodifiableset)
19. [`toCollection`](#19-tocollection)
20. [`toMap`](#20-tomap)
21. [`toConcurrentMap`](#21-toconcurrentmap)
22. [`groupingBy`](#22-groupingby)
23. [`groupingByConcurrent`](#23-groupingbyconcurrent)
24. [`partitioningBy`](#24-partitioningby)
25. [Downstream Collector Mental Model](#25-downstream-collector-mental-model)
26. [`mapping`](#26-mapping)
27. [`flatMapping`](#27-flatmapping)
28. [`filtering`](#28-filtering)
29. [`collectingAndThen`](#29-collectingandthen)
30. [`teeing`](#30-teeing)
31. [Numeric Collectors](#31-numeric-collectors)
32. [`joining`](#32-joining)
33. [`reducing`](#33-reducing)
34. [Custom Collector with `Collector.of`](#34-custom-collector-with-collectorof)
35. [Custom Collector Correctness Rules](#35-custom-collector-correctness-rules)
36. [Collector and Ordering](#36-collector-and-ordering)
37. [Collector and Null](#37-collector-and-null)
38. [Collector and Duplicate Keys](#38-collector-and-duplicate-keys)
39. [Collector and Memory](#39-collector-and-memory)
40. [Collector and Parallel Performance](#40-collector-and-parallel-performance)
41. [Common Anti-Patterns](#41-common-anti-patterns)
42. [Production Failure Modes](#42-production-failure-modes)
43. [Best Practices](#43-best-practices)
44. [Decision Matrix](#44-decision-matrix)
45. [Latihan](#45-latihan)
46. [Ringkasan](#46-ringkasan)
47. [Referensi](#47-referensi)

---

# 1. Tujuan Bagian Ini

Pada part sebelumnya kita membahas reduction.

Sekarang kita deep dive ke salah satu reduction mechanism paling penting di Stream API:

```java
collect(...)
```

Contoh:

```java
List<String> emails = users.stream()
    .map(User::email)
    .toList();

Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(User::role));

String csv = users.stream()
    .map(User::email)
    .collect(Collectors.joining(","));
```

`Collector` sering dipakai, tetapi jarang dipahami secara mendalam.

Padahal collector adalah protocol dengan beberapa bagian:

```text
supplier
accumulator
combiner
finisher
characteristics
```

Kalau kamu salah memahami collector:

- result bisa salah di parallel stream;
- duplicate key meledak di `toMap`;
- memory bisa membengkak saat grouping high-cardinality;
- collector concurrent bisa disalahgunakan;
- order bisa hilang;
- custom collector bisa corrupt;
- unmodifiable vs mutable result bisa membingungkan;
- null handling bisa gagal.

Tujuan part ini:

- memahami collector sebagai mutable reduction protocol;
- memahami parts collector;
- memahami predefined collectors;
- memahami downstream collectors;
- memahami concurrent collectors;
- memahami custom collector correctness;
- memahami production failure modes.

---

# 2. Mental Model: Collector = Recipe for Mutable Reduction

Collector adalah resep untuk mengubah:

```text
Stream<T> -> R
```

melalui intermediate accumulation type `A`.

Secara konseptual:

```text
T = element type
A = mutable accumulation container
R = final result type
```

Example:

```java
Collector<String, ?, List<String>> collector = Collectors.toList();
```

Mental model:

```text
supplier     -> create mutable list
accumulator  -> add element into list
combiner     -> merge two lists
finisher     -> maybe return list as-is
```

## 2.1 Why mutable reduction?

Untuk membangun container seperti List/Map/StringBuilder, membuat object baru pada setiap element akan mahal.

Collector memungkinkan framework mengakumulasi ke mutable container dengan aturan aman.

## 2.2 Parallel model

Dalam parallel stream, framework bisa membuat beberapa container partial:

```text
partition A -> container A
partition B -> container B
partition C -> container C
then combine containers
```

## 2.3 Main rule

```text
Collector is not just a helper method.
It is a contract for how stream elements become a result.
```

---

# 3. Why Collectors Exist

Kenapa tidak pakai `reduce` saja?

Karena `reduce` cocok untuk immutable value.

Bad:

```java
List<String> list = stream.reduce(
    new ArrayList<>(),
    (acc, x) -> {
        acc.add(x);
        return acc;
    },
    (a, b) -> {
        a.addAll(b);
        return a;
    }
);
```

Ini terlihat bisa, tapi sangat mudah salah, terutama parallel.

Correct:

```java
List<String> list = stream.collect(Collectors.toList());
```

## 3.1 Collector handles mutable containers

Collector tells stream framework:

- how to create fresh container;
- how to add one element;
- how to merge partial containers;
- how to finish result.

## 3.2 Rule

Use collectors for mutable accumulation.

---

# 4. `collect` vs `reduce`

| Need | Use |
|---|---|
| sum numbers | primitive `sum` or `reduce` |
| combine BigDecimal | `reduce(BigDecimal.ZERO, BigDecimal::add)` |
| build List | `collect` / `toList` |
| build Set | `collect` |
| build Map | `collect(toMap)` |
| group values | `collect(groupingBy)` |
| join strings | `collect(joining)` |
| custom mutable summary | `collect` |
| immutable algebraic value | `reduce` |

## 4.1 Rule

```text
Reduce values. Collect containers.
```

---

# 5. Collector Type Parameters: `T`, `A`, `R`

`Collector<T, A, R>`:

```java
T = input element type
A = mutable accumulation type
R = final result type
```

## 5.1 Example to list

```java
Collector<String, List<String>, List<String>>
```

Conceptually:

```text
T = String
A = List<String>
R = List<String>
```

Actual collector often uses wildcard:

```java
Collector<String, ?, List<String>>
```

because accumulation type is implementation detail.

## 5.2 Example joining

```java
Collector<CharSequence, StringBuilder, String>
```

Conceptually:

```text
T = CharSequence
A = StringBuilder
R = String
```

## 5.3 Example grouping

```java
Collector<User, ?, Map<Role, List<User>>>
```

## 5.4 Rule

`A` is usually hidden because callers should care about final result `R`.

---

# 6. Supplier

Supplier creates fresh accumulation container.

## 6.1 Example

```java
ArrayList::new
```

## 6.2 Requirement

Supplier must create a new independent container each time.

Bad:

```java
ArrayList<String> shared = new ArrayList<>();

Supplier<ArrayList<String>> bad = () -> shared;
```

This breaks parallel and even sequential assumptions.

## 6.3 Parallel stream

Each partition may receive its own container from supplier.

## 6.4 Rule

Supplier must return fresh mutable container.

---

# 7. Accumulator

Accumulator adds one element into accumulation container.

## 7.1 Example

```java
List::add
```

Conceptually:

```java
(accumulatorContainer, element) -> mutate container
```

## 7.2 Signature

```java
BiConsumer<A, T>
```

## 7.3 Requirement

Accumulator mutates only its provided container.

Bad:

```java
(acc, item) -> globalList.add(item)
```

## 7.4 Rule

Accumulator should be local to its container and non-interfering.

---

# 8. Combiner

Combiner merges two partial accumulation containers.

## 8.1 Example

```java
(left, right) -> {
    left.addAll(right);
    return left;
}
```

## 8.2 Signature

```java
BinaryOperator<A>
```

## 8.3 Parallel importance

In parallel stream, combiner is used to merge partition results.

## 8.4 Must preserve semantics

Combining two partial containers must produce same logical result as sequential accumulation.

## 8.5 Rule

Combiner is not optional for parallel-correct mutable reduction.

---

# 9. Finisher

Finisher converts accumulation type `A` into final result `R`.

## 9.1 Identity finisher

If `A == R`, finisher can be identity.

Example:

```text
ArrayList -> ArrayList
```

## 9.2 Transforming finisher

Example:

```text
StringBuilder -> String
```

or:

```text
mutable list -> unmodifiable list
```

## 9.3 Example collectingAndThen

```java
collectingAndThen(toList(), List::copyOf)
```

## 9.4 Rule

Finisher is where mutable accumulation can become final immutable/domain result.

---

# 10. Collector Characteristics

Collector characteristics are hints/constraints:

```java
CONCURRENT
UNORDERED
IDENTITY_FINISH
```

They affect how stream framework may execute collection.

## 10.1 Characteristics are contracts

Do not declare them unless true.

## 10.2 Wrong characteristics can break result

Especially:

```java
CONCURRENT
IDENTITY_FINISH
```

## 10.3 Rule

Collector characteristics are correctness declarations, not performance decorations.

---

# 11. `IDENTITY_FINISH`

Means finisher is identity and can be elided.

## 11.1 When true

If accumulation type `A` can be cast to result type `R`.

Example:

```text
A = List<T>
R = List<T>
```

## 11.2 When false

If finisher transforms:

```text
StringBuilder -> String
mutable list -> immutable list
```

## 11.3 Danger

If you declare IDENTITY_FINISH but actually need finisher, result type/semantics break.

## 11.4 Rule

Declare IDENTITY_FINISH only when final result is exactly the accumulator.

---

# 12. `UNORDERED`

Means collector result does not depend on encounter order.

## 12.1 Example

Collecting to `Set` is typically unordered by collector semantics.

## 12.2 Not same as source unordered

Source may be ordered, collector may not care.

## 12.3 Benefit

Can allow optimizations.

## 12.4 Danger

Do not declare unordered if result order matters.

## 12.5 Rule

UNORDERED means result equivalence does not depend on input encounter order.

---

# 13. `CONCURRENT`

Means accumulator can be called concurrently from multiple threads on same result container.

## 13.1 Requirement

Result container must support concurrent updates.

Example:

```java
ConcurrentHashMap
```

not:

```java
HashMap
ArrayList
```

## 13.2 CONCURRENT and UNORDERED

If a concurrent collector is not also unordered, it should only be evaluated concurrently when applied to unordered data source.

## 13.3 Danger

Declaring CONCURRENT for non-thread-safe container corrupts result.

## 13.4 Rule

CONCURRENT is a strong thread-safety promise.

---

# 14. Non-Concurrent Collector in Parallel Stream

Important: non-concurrent collector can still work in parallel.

How?

The framework uses thread confinement.

## 14.1 Model

```text
thread 1 -> container A
thread 2 -> container B
thread 3 -> container C
combine A+B+C
```

## 14.2 No shared mutation

Each container is used by one thread at a time until combine.

## 14.3 Example

```java
List<String> result = stream.parallel()
    .collect(Collectors.toList());
```

This can be correct even though ArrayList itself is not thread-safe, because containers are isolated.

## 14.4 Rule

Collector does not need to be CONCURRENT to be parallel-compatible.

---

# 15. Concurrent Collector in Parallel Stream

Concurrent collector allows multiple threads to accumulate into same container.

## 15.1 Example

```java
ConcurrentMap<Role, List<User>> result = users.parallelStream()
    .collect(Collectors.groupingByConcurrent(User::role));
```

## 15.2 Caveat

Downstream collector/value containers may still have constraints.

## 15.3 Order

Concurrent collectors often do not preserve encounter order.

## 15.4 Rule

Concurrent collection can reduce combining overhead but changes ordering/coordination tradeoffs.

---

# 16. Basic Collection Collectors

Common collectors:

```java
toList
toSet
toCollection
toUnmodifiableList
toUnmodifiableSet
toUnmodifiableMap
```

## 16.1 Use cases

- materialize pipeline result;
- choose collection type;
- enforce immutability;
- deduplicate via Set.

## 16.2 Rule

Choose collection collector based on mutability, order, uniqueness, and type requirements.

---

# 17. `toList`, `toUnmodifiableList`, `Stream.toList`

There are multiple list-producing options.

## 17.1 Collectors.toList

```java
stream.collect(Collectors.toList())
```

No guarantee on list type or mutability.

## 17.2 Collectors.toUnmodifiableList

```java
stream.collect(Collectors.toUnmodifiableList())
```

Returns unmodifiable list and rejects null.

## 17.3 Stream.toList

```java
stream.toList()
```

Returns unmodifiable list; allows null elements if stream contains nulls.

## 17.4 Mutable ArrayList

```java
stream.collect(Collectors.toCollection(ArrayList::new))
```

## 17.5 Rule

Use the terminal/collector that matches mutability/null/type requirements.

---

# 18. `toSet`, `toUnmodifiableSet`

## 18.1 toSet

```java
Set<T> set = stream.collect(Collectors.toSet());
```

No guarantee on set implementation.

## 18.2 toUnmodifiableSet

```java
Set<T> set = stream.collect(Collectors.toUnmodifiableSet());
```

Unmodifiable, rejects null, duplicate elements reduced.

## 18.3 Need order?

Use:

```java
Collectors.toCollection(LinkedHashSet::new)
```

## 18.4 Need enum set?

Use custom supplier carefully:

```java
Collectors.toCollection(() -> EnumSet.noneOf(Role.class))
```

## 18.5 Rule

Use `toCollection` when Set implementation/order matters.

---

# 19. `toCollection`

Creates collection using supplied factory.

```java
ArrayList<T> list = stream.collect(Collectors.toCollection(ArrayList::new));
```

## 19.1 Use cases

- mutable result required;
- specific type required;
- preserve insertion order with LinkedHashSet;
- sorted set with TreeSet.

## 19.2 Examples

```java
LinkedHashSet<String> orderedUnique = stream
    .collect(Collectors.toCollection(LinkedHashSet::new));

TreeSet<String> sorted = stream
    .collect(Collectors.toCollection(TreeSet::new));
```

## 19.3 Rule

Use toCollection when collection type is part of contract.

---

# 20. `toMap`

Builds Map from stream elements.

## 20.1 Basic

```java
Map<UserId, User> byId = users.stream()
    .collect(Collectors.toMap(User::id, Function.identity()));
```

## 20.2 Duplicate key problem

If duplicate key appears, basic toMap throws.

## 20.3 Merge function

```java
Map<Role, User> firstByRole = users.stream()
    .collect(Collectors.toMap(
        User::role,
        Function.identity(),
        (a, b) -> a
    ));
```

## 20.4 Map supplier

```java
LinkedHashMap<UserId, User> byId = users.stream()
    .collect(Collectors.toMap(
        User::id,
        Function.identity(),
        (a, b) -> a,
        LinkedHashMap::new
    ));
```

## 20.5 Rule

Always think about duplicate keys and map type.

---

# 21. `toConcurrentMap`

Builds ConcurrentMap.

## 21.1 Example

```java
ConcurrentMap<UserId, User> byId = users.parallelStream()
    .collect(Collectors.toConcurrentMap(
        User::id,
        Function.identity()
    ));
```

## 21.2 Duplicate merge

Same duplicate key issue; provide merge if needed.

## 21.3 Use case

Parallel accumulation into concurrent map.

## 21.4 Caveat

Concurrent result does not make values immutable/thread-safe.

## 21.5 Rule

Use toConcurrentMap when concurrent map result/parallel concurrent accumulation is intended.

---

# 22. `groupingBy`

Groups elements by classifier.

## 22.1 Basic

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(User::role));
```

## 22.2 With downstream

```java
Map<Role, Long> countByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.counting()
    ));
```

## 22.3 With map supplier

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        LinkedHashMap::new,
        Collectors.toList()
    ));
```

## 22.4 Rule

Use groupingBy when duplicate group keys are expected and values should aggregate per group.

---

# 23. `groupingByConcurrent`

Concurrent grouping.

## 23.1 Example

```java
ConcurrentMap<Role, List<User>> byRole = users.parallelStream()
    .collect(Collectors.groupingByConcurrent(User::role));
```

## 23.2 Order caveat

Concurrent grouping is generally unordered.

## 23.3 Downstream caveat

The resulting value containers and downstream collector semantics matter.

## 23.4 Use case

Parallel grouping where order not needed.

## 23.5 Rule

Use groupingByConcurrent only when concurrent unordered grouping semantics fit.

---

# 24. `partitioningBy`

Partitions into two groups based on boolean predicate.

## 24.1 Basic

```java
Map<Boolean, List<User>> activePartition = users.stream()
    .collect(Collectors.partitioningBy(User::active));
```

## 24.2 With downstream

```java
Map<Boolean, Long> counts = users.stream()
    .collect(Collectors.partitioningBy(
        User::active,
        Collectors.counting()
    ));
```

## 24.3 Difference from groupingBy Boolean

`partitioningBy` is specifically two-way partition.

## 24.4 Rule

Use partitioningBy for boolean split.

---

# 25. Downstream Collector Mental Model

Downstream collector applies reduction inside another reduction.

Example:

```java
groupingBy(role, counting())
```

Mental model:

```text
group elements by role
inside each role group, count elements
```

## 25.1 Powerful composition

Collectors compose like:

```text
groupingBy -> mapping -> filtering -> collectingAndThen
```

## 25.2 Rule

Downstream collectors let you avoid post-processing maps manually.

---

# 26. `mapping`

Transforms elements before downstream collector.

## 26.1 Example

```java
Map<Role, List<String>> namesByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.mapping(User::name, Collectors.toList())
    ));
```

## 26.2 Equivalent but clearer per group

Without mapping, you might group User then map each list later.

## 26.3 Rule

Use mapping for projection inside grouped/partitioned reductions.

---

# 27. `flatMapping`

Maps each element to stream and flattens into downstream collector.

## 27.1 Example

```java
Map<CustomerId, Set<OrderLine>> linesByCustomer = orders.stream()
    .collect(Collectors.groupingBy(
        Order::customerId,
        Collectors.flatMapping(
            order -> order.lines().stream(),
            Collectors.toSet()
        )
    ));
```

## 27.2 Use case

One group element contributes many downstream elements.

## 27.3 Resource note

Mapped streams are closed after use.

## 27.4 Rule

Use flatMapping when each grouped element expands into multiple downstream elements.

---

# 28. `filtering`

Filters elements inside downstream collector.

## 28.1 Example

```java
Map<Department, List<Employee>> highEarnersByDept = employees.stream()
    .collect(Collectors.groupingBy(
        Employee::department,
        Collectors.filtering(
            e -> e.salary() > 100_000,
            Collectors.toList()
        )
    ));
```

## 28.2 Difference from upstream filter

Upstream filter removes elements before grouping.

Downstream filtering preserves groups that may have empty downstream result.

## 28.3 Example difference

If a department has no high earners:

- upstream filter may omit department;
- downstream filtering can keep department with empty list.

## 28.4 Rule

Use filtering downstream when empty groups still matter.

---

# 29. `collectingAndThen`

Applies finisher after downstream collector.

## 29.1 Example

```java
Map<Role, List<User>> immutableByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.collectingAndThen(
            Collectors.toList(),
            List::copyOf
        )
    ));
```

## 29.2 Use cases

- immutable group values;
- validation;
- domain conversion;
- optional extraction.

## 29.3 Rule

Use collectingAndThen to transform collector result after accumulation.

---

# 30. `teeing`

Combines two collectors and merges their results.

## 30.1 Example

```java
record Range(int min, int max) {}

Range range = numbers.stream()
    .collect(Collectors.teeing(
        Collectors.minBy(Integer::compareTo),
        Collectors.maxBy(Integer::compareTo),
        (min, max) -> new Range(min.orElseThrow(), max.orElseThrow())
    ));
```

## 30.2 Use case

Compute two reductions in one pass.

## 30.3 Caveat

Handle empty stream if downstream returns Optional.

## 30.4 Rule

Use teeing when two independent reductions should produce one final result.

---

# 31. Numeric Collectors

Collectors provide numeric reduction helpers:

```java
counting
summingInt
summingLong
summingDouble
averagingInt
averagingLong
averagingDouble
summarizingInt
summarizingLong
summarizingDouble
```

## 31.1 Example

```java
Map<Role, Integer> totalAgeByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.summingInt(User::age)
    ));
```

## 31.2 Summary

```java
Map<Role, IntSummaryStatistics> statsByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.summarizingInt(User::age)
    ));
```

## 31.3 Rule

Use numeric collectors for downstream per-group numeric aggregation.

---

# 32. `joining`

Joins CharSequence elements.

## 32.1 Basic

```java
String s = words.stream()
    .collect(Collectors.joining());
```

## 32.2 Delimiter

```java
String csv = words.stream()
    .collect(Collectors.joining(","));
```

## 32.3 Prefix/suffix

```java
String display = words.stream()
    .collect(Collectors.joining(", ", "[", "]"));
```

## 32.4 Rule

Use joining instead of reduce string concatenation.

---

# 33. `reducing`

Collector form of reduction, useful downstream.

## 33.1 Example downstream max

```java
Map<Role, Optional<User>> oldestByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.reducing(BinaryOperator.maxBy(
            Comparator.comparing(User::createdAt)
        ))
    ));
```

Often `maxBy` collector is clearer.

## 33.2 Example mapping + reducing

```java
Map<Role, Integer> maxAgeByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.mapping(
            User::age,
            Collectors.reducing(0, Integer::max)
        )
    ));
```

## 33.3 Rule

Use reducing collector mostly as downstream composition tool.

---

# 34. Custom Collector with `Collector.of`

You can create custom collector.

## 34.1 Example: immutable summary

```java
record CountAndTotal(long count, long total) {}

final class Acc {
    long count;
    long total;

    void add(Order order) {
        count++;
        total += order.amountInCents();
    }

    Acc merge(Acc other) {
        count += other.count;
        total += other.total;
        return this;
    }

    CountAndTotal finish() {
        return new CountAndTotal(count, total);
    }
}

Collector<Order, Acc, CountAndTotal> collector = Collector.of(
    Acc::new,
    Acc::add,
    Acc::merge,
    Acc::finish
);
```

Usage:

```java
CountAndTotal summary = orders.stream().collect(collector);
```

## 34.2 Rule

Custom collector is justified when built-in collectors cannot express the reduction cleanly.

---

# 35. Custom Collector Correctness Rules

## 35.1 Supplier fresh

Must create new independent accumulator.

## 35.2 Accumulator local

Must mutate only given accumulator.

## 35.3 Combiner correct

Must merge partial accumulators.

## 35.4 Finisher correct

Must produce final result exactly once where needed.

## 35.5 Characteristics honest

Do not declare CONCURRENT/UNORDERED/IDENTITY_FINISH unless true.

## 35.6 Empty input

Result from supplier+finisher should make sense.

## 35.7 Parallel test

Test sequential and parallel if collector may be used parallel.

## 35.8 Rule

A collector is a mini protocol; test its algebra.

---

# 36. Collector and Ordering

## 36.1 Ordered source + ordered collector

Result may preserve encounter order.

## 36.2 toList

Usually preserves encounter order.

## 36.3 toSet

No order guarantee by collector contract.

## 36.4 toCollection

Use explicit type for order.

```java
LinkedHashSet::new
```

## 36.5 groupingBy map order

Default map type not guaranteed for order you may want.

Use supplier:

```java
groupingBy(classifier, LinkedHashMap::new, downstream)
```

## 36.6 Rule

If order is part of result contract, specify collection/map type.

---

# 37. Collector and Null

Null behavior differs.

## 37.1 toList

Can collect null depending collector/result.

## 37.2 toUnmodifiableList

Rejects null.

## 37.3 toMap

Null keys/values may cause exceptions depending collector/map behavior.

## 37.4 groupingBy classifier null

Be careful; null classifier may fail depending collector implementation/Map.

## 37.5 Rule

Normalize null before collect unless explicitly supported.

---

# 38. Collector and Duplicate Keys

`toMap` duplicate keys are a common production failure.

## 38.1 Bad

```java
Map<Role, User> byRole = users.stream()
    .collect(Collectors.toMap(User::role, Function.identity()));
```

If two users share role, exception.

## 38.2 First wins

```java
(a, b) -> a
```

## 38.3 Last wins

```java
(a, b) -> b
```

## 38.4 Merge domain

```java
(existing, incoming) -> existing.merge(incoming)
```

## 38.5 Many values

Use groupingBy.

## 38.6 Rule

For every `toMap`, ask: what if key duplicates?

---

# 39. Collector and Memory

Collectors often materialize data.

## 39.1 toList

Stores all elements.

## 39.2 groupingBy

Stores map plus per-group containers.

## 39.3 joining

Stores resulting string/string builder.

## 39.4 High-cardinality grouping

May create huge map.

## 39.5 Large downstream lists

Memory grows by total input size.

## 39.6 Rule

Collecting is materialization; know output size.

---

# 40. Collector and Parallel Performance

## 40.1 Non-concurrent collector

Parallel creates multiple containers and combines.

Combining cost can be high.

## 40.2 Concurrent collector

May accumulate concurrently into shared concurrent container.

Reduces combining but adds concurrent update contention.

## 40.3 groupingBy vs groupingByConcurrent

- `groupingBy`: more deterministic order options, combine maps.
- `groupingByConcurrent`: concurrent map, unordered-oriented, may be faster for some parallel cases.

## 40.4 Downstream matters

Even concurrent grouping may have downstream list/container considerations.

## 40.5 Rule

Parallel collector performance is collector-specific. Measure.

---

# 41. Common Anti-Patterns

## 41.1 toMap without duplicate policy

Common crash.

## 41.2 groupingBy when only one value per key expected

Maybe toMap with validation is better.

## 41.3 toSet expecting order

Use LinkedHashSet.

## 41.4 Collecting huge stream to list

Memory blow-up.

## 41.5 Custom collector with shared supplier object

Breaks parallel.

## 41.6 Declaring CONCURRENT on ArrayList accumulator

Corruption.

## 41.7 IDENTITY_FINISH with real finisher

Wrong result.

## 41.8 Downstream filtering misunderstood

Upstream vs downstream filtering gives different group presence.

## 41.9 Exposing mutable collector result

Unexpected external mutation.

## 41.10 Rule

Collectors are concise, but their defaults are not always your contract.

---

# 42. Production Failure Modes

## 42.1 Duplicate key exception in toMap

Fix: merge function or groupingBy.

## 42.2 Unordered set output breaks test/API

Fix: LinkedHashSet/TreeSet/toCollection.

## 42.3 groupingBy high-cardinality OOM

Fix: streaming aggregation, pagination, DB aggregation, bounded processing.

## 42.4 Parallel custom collector corrupts result

Fix: fresh supplier, local accumulator, correct combiner.

## 42.5 Wrong concurrent collector characteristic

Fix: remove CONCURRENT or use concurrent container.

## 42.6 Mutable list returned and modified

Fix: `toList`, `toUnmodifiableList`, `collectingAndThen`.

## 42.7 Null rejected unexpectedly

Fix: filter/normalize null before collecting.

## 42.8 Downstream filter omits/keeps groups unexpectedly

Fix: understand upstream vs downstream filtering.

## 42.9 groupingByConcurrent loses ordering assumptions

Fix: use groupingBy with ordered map/list or post-sort.

## 42.10 joining huge data creates massive string

Fix: stream to writer or limit/segment output.

## 42.11 teeing empty Optional crash

Fix: handle empty downstream results.

## 42.12 Wrong map type

Fix: map supplier.

---

# 43. Best Practices

## 43.1 Be explicit about result contract

- mutable or unmodifiable;
- ordered or unordered;
- duplicate behavior;
- map type;
- null policy.

## 43.2 Prefer built-in collectors

Use custom collector only when needed.

## 43.3 Use downstream collectors

Avoid manual post-processing maps.

## 43.4 Always handle duplicate keys

For `toMap`.

## 43.5 Use `toCollection` for specific collection type

Especially `LinkedHashSet`, `TreeSet`, `ArrayList`.

## 43.6 Use groupingBy for many values per key

Do not force merge when list/group is intended.

## 43.7 Test custom collectors in parallel

Even if first use is sequential.

## 43.8 Watch memory

Collecting materializes.

## 43.9 Normalize null

Before collection.

---

# 44. Decision Matrix

| Need | Collector |
|---|---|
| unmodifiable list simple | `stream.toList()` |
| mutable ArrayList | `toCollection(ArrayList::new)` |
| unmodifiable list rejecting null | `toUnmodifiableList()` |
| set no order contract | `toSet()` |
| ordered unique set | `toCollection(LinkedHashSet::new)` |
| sorted set | `toCollection(TreeSet::new)` |
| map unique keys | `toMap(k, v)` |
| map duplicate keys | `toMap(k, v, merge)` |
| specific map type | `toMap(k, v, merge, supplier)` |
| concurrent map | `toConcurrentMap` |
| group to list | `groupingBy(classifier)` |
| group count | `groupingBy(classifier, counting())` |
| group mapped value | `groupingBy(classifier, mapping(...))` |
| group flattened values | `groupingBy(classifier, flatMapping(...))` |
| group with per-group filter | `groupingBy(classifier, filtering(...))` |
| two-way boolean split | `partitioningBy` |
| immutable post-processing | `collectingAndThen` |
| two reductions one result | `teeing` |
| string concat | `joining` |
| numeric per-group sum | `summingInt/Long/Double` |
| numeric stats per group | `summarizingInt/Long/Double` |
| custom domain summary | `Collector.of` |
| parallel unordered grouping | consider `groupingByConcurrent` |
| exact ordering result | specify ordered collection/map |
| huge result | avoid full collect or aggregate upstream |

---

# 45. Latihan

## Latihan 1 — Collector Parts

Implement custom collector that computes count and total cents.

Identify supplier, accumulator, combiner, finisher.

## Latihan 2 — Duplicate Key

Use `toMap` with duplicate keys.

Fix with first-wins, last-wins, and groupingBy.

## Latihan 3 — Ordered Set

Collect names into HashSet and LinkedHashSet.

Compare order.

## Latihan 4 — Downstream Mapping

Group users by role into list of names.

## Latihan 5 — Downstream Filtering

Group departments with only high earners.

Compare upstream filter vs downstream filtering.

## Latihan 6 — FlatMapping

Group orders by customer and collect all line items.

## Latihan 7 — CollectingAndThen

Group users by role and make each list immutable.

## Latihan 8 — Teeing

Compute min and max age in one pass.

Handle empty input safely.

## Latihan 9 — Custom Collector Parallel Test

Run your custom collector sequential and parallel.

Verify same result.

## Latihan 10 — Memory Design

Given 100 million records, explain why `toList`/`groupingBy` may be dangerous and propose alternative.

---

# 46. Ringkasan

Collectors are mutable reduction protocols.

Core lessons:

- Collector transforms `Stream<T>` into result `R` using accumulation type `A`.
- Supplier creates fresh containers.
- Accumulator adds elements.
- Combiner merges partial containers.
- Finisher converts accumulation to final result.
- Characteristics are correctness contracts.
- Non-concurrent collectors can still work in parallel via thread confinement.
- CONCURRENT means same container can be accumulated by multiple threads.
- toMap needs duplicate key policy.
- groupingBy is for many elements per key.
- Downstream collectors avoid post-processing.
- mapping, flatMapping, filtering are powerful downstream tools.
- collectingAndThen transforms final result.
- teeing combines two reductions.
- toCollection is for explicit collection type.
- groupingByConcurrent trades ordering for concurrent accumulation patterns.
- Custom collectors must be tested for supplier/accumulator/combiner/finisher correctness.
- Collecting materializes data and can consume large memory.

Main rule:

```text
A collector is a mini-protocol.
Before using or writing one, define result type, mutability, ordering, duplicate policy, null policy, memory size, and parallel correctness.
```

---

# 47. Referensi

1. Java SE 25 — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

2. Java SE 25 — `Collector.Characteristics`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.Characteristics.html

3. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

4. Java SE 25 — `Stream.collect`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

5. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

6. Java SE 25 — `ConcurrentMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentMap.html

7. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

8. Java SE 25 — `IntSummaryStatistics`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/IntSummaryStatistics.html

9. dev.java — Reductions  
   https://dev.java/learn/api/streams/reducing/

10. OpenJDK — `Collectors.java` Source  
    https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/stream/Collectors.java

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-029.md](./learn-java-collections-and-streams-part-029.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-031.md](./learn-java-collections-and-streams-part-031.md)

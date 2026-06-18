# learn-java-collections-and-streams-part-031.md

# Java Collections and Streams — Part 031  
# Built-in Collectors: toList, toSet, toMap, groupingBy, partitioningBy, mapping, filtering, flatMapping, collectingAndThen, teeing, joining, counting, summing, averaging, summarizing, reducing, and Production Selection Patterns

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **031**  
> Fokus: memahami seluruh built-in collectors penting di `java.util.stream.Collectors`: bukan sekadar hafalan method, tetapi memilih collector berdasarkan **output contract**: list/set/map, mutability, ordering, duplicate keys, null policy, grouping cardinality, downstream reduction, memory behavior, dan parallel/concurrent semantics.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Built-in Collector adalah Vocabulary untuk Output Shape](#2-mental-model-built-in-collector-adalah-vocabulary-untuk-output-shape)
3. [Collector Selection Questions](#3-collector-selection-questions)
4. [List Collectors](#4-list-collectors)
5. [`Stream.toList()` vs `Collectors.toList()` vs `toUnmodifiableList()`](#5-streamtolist-vs-collectorstolist-vs-tounmodifiablelist)
6. [Set Collectors](#6-set-collectors)
7. [`toCollection`](#7-tocollection)
8. [Map Collectors](#8-map-collectors)
9. [`toMap` Duplicate Key Strategies](#9-tomap-duplicate-key-strategies)
10. [`toUnmodifiableMap`](#10-tounmodifiablemap)
11. [`toConcurrentMap`](#11-toconcurrentmap)
12. [`groupingBy`](#12-groupingby)
13. [`groupingBy` with Downstream](#13-groupingby-with-downstream)
14. [`groupingBy` with Map Supplier](#14-groupingby-with-map-supplier)
15. [`groupingByConcurrent`](#15-groupingbyconcurrent)
16. [`partitioningBy`](#16-partitioningby)
17. [`mapping`](#17-mapping)
18. [`filtering`](#18-filtering)
19. [`flatMapping`](#19-flatmapping)
20. [`collectingAndThen`](#20-collectingandthen)
21. [`teeing`](#21-teeing)
22. [`counting`](#22-counting)
23. [`summingInt`, `summingLong`, `summingDouble`](#23-summingint-summinglong-summingdouble)
24. [`averagingInt`, `averagingLong`, `averagingDouble`](#24-averagingint-averaginglong-averagingdouble)
25. [`summarizingInt`, `summarizingLong`, `summarizingDouble`](#25-summarizingint-summarizinglong-summarizingdouble)
26. [`minBy` and `maxBy`](#26-minby-and-maxby)
27. [`joining`](#27-joining)
28. [`reducing`](#28-reducing)
29. [`toUnmodifiable*` Collectors and Null](#29-tounmodifiable-collectors-and-null)
30. [Collector Composition Patterns](#30-collector-composition-patterns)
31. [Common Built-in Collector Recipes](#31-common-built-in-collector-recipes)
32. [Ordering and Map/Set Type](#32-ordering-and-mapset-type)
33. [Memory Behavior](#33-memory-behavior)
34. [Parallel and Concurrent Behavior](#34-parallel-and-concurrent-behavior)
35. [Common Anti-Patterns](#35-common-anti-patterns)
36. [Production Failure Modes](#36-production-failure-modes)
37. [Best Practices](#37-best-practices)
38. [Decision Matrix](#38-decision-matrix)
39. [Latihan](#39-latihan)
40. [Ringkasan](#40-ringkasan)
41. [Referensi](#41-referensi)

---

# 1. Tujuan Bagian Ini

Pada part sebelumnya kita membedah `Collector` sebagai protocol.

Sekarang kita fokus ke built-in collectors:

```java
Collectors.toList()
Collectors.toSet()
Collectors.toMap()
Collectors.groupingBy()
Collectors.partitioningBy()
Collectors.mapping()
Collectors.filtering()
Collectors.flatMapping()
Collectors.collectingAndThen()
Collectors.teeing()
Collectors.joining()
Collectors.counting()
Collectors.summingInt()
Collectors.averagingInt()
Collectors.summarizingInt()
Collectors.reducing()
```

Masalah di production biasanya bukan karena developer tidak tahu nama method.

Masalahnya karena salah memilih collector untuk kontrak output.

Contoh:

```java
Collectors.toMap(User::role, Function.identity())
```

akan gagal jika role duplicate.

```java
Collectors.toSet()
```

tidak menjanjikan order tertentu.

```java
Collectors.groupingBy(User::role)
```

bisa membuat map/list besar dan boros memory.

```java
Collectors.groupingByConcurrent(...)
```

tidak otomatis berarti semua downstream value aman untuk semua asumsi bisnis.

Tujuan bagian ini:

- memahami built-in collectors by output shape;
- tahu mutability/order/null/duplicate policy;
- memilih downstream collector yang tepat;
- memahami `groupingBy` vs `toMap`;
- memahami `partitioningBy`;
- memahami `mapping/filtering/flatMapping`;
- memahami `teeing`;
- memahami numeric collectors;
- menghindari production failure modes.

---

# 2. Mental Model: Built-in Collector adalah Vocabulary untuk Output Shape

Collector menjawab pertanyaan:

```text
Stream element mau saya jadikan bentuk hasil apa?
```

Bentuk hasil umum:

```text
List
Set
Map
ConcurrentMap
Map<K, List<T>>
Map<K, Long>
Map<K, SummaryStatistics>
String
Optional<T>
custom domain summary
```

## 2.1 Output shape first

Jangan mulai dari:

```text
collector apa yang saya ingat?
```

Mulai dari:

```text
kontrak output saya apa?
```

Contoh:

```text
Butuh satu User per ID?
-> toMap(User::id, Function.identity())

Butuh banyak User per Role?
-> groupingBy(User::role)

Butuh count per Role?
-> groupingBy(User::role, counting())

Butuh CSV?
-> joining(",")

Butuh immutable list?
-> stream.toList() atau toUnmodifiableList, tergantung null policy
```

## 2.2 Main rule

```text
Built-in collectors are a vocabulary for declaring result shape and reduction policy.
```

---

# 3. Collector Selection Questions

Sebelum memilih collector, tanya:

## 3.1 Apa output container?

- List?
- Set?
- Map?
- String?
- summary object?
- grouped map?

## 3.2 Mutable atau unmodifiable?

Apakah caller boleh mutate result?

## 3.3 Order penting?

Jika iya, order berdasarkan apa?

## 3.4 Duplicate key mungkin?

Jika map, apa policy duplicate key?

## 3.5 One value or many values per key?

Jika many, `groupingBy`.

## 3.6 Null mungkin?

Collector tertentu menolak null.

## 3.7 Memory size?

Apakah result bisa besar?

## 3.8 Parallel/concurrent?

Apakah collector dipakai di parallel stream?

## 3.9 Rule

Collector selection is API contract design.

---

# 4. List Collectors

Common choices:

```java
stream.toList()
stream.collect(Collectors.toList())
stream.collect(Collectors.toUnmodifiableList())
stream.collect(Collectors.toCollection(ArrayList::new))
stream.collect(Collectors.toCollection(LinkedList::new))
```

## 4.1 Simple result list

```java
List<String> emails = users.stream()
    .map(User::email)
    .toList();
```

## 4.2 Mutable list

```java
ArrayList<String> emails = users.stream()
    .map(User::email)
    .collect(Collectors.toCollection(ArrayList::new));
```

## 4.3 Unmodifiable list rejecting null

```java
List<String> emails = users.stream()
    .map(User::email)
    .collect(Collectors.toUnmodifiableList());
```

## 4.4 Rule

Use `Stream.toList()` for simple unmodifiable result, `toCollection` for specific mutable type.

---

# 5. `Stream.toList()` vs `Collectors.toList()` vs `toUnmodifiableList()`

## 5.1 `Stream.toList()`

```java
stream.toList()
```

- terminal operation directly on Stream;
- returns unmodifiable List;
- can contain null elements if stream has nulls.

## 5.2 `Collectors.toList()`

```java
stream.collect(Collectors.toList())
```

- collector;
- no guarantee on returned List type/mutability by contract;
- historically often mutable ArrayList, but do not depend on it.

## 5.3 `Collectors.toUnmodifiableList()`

```java
stream.collect(Collectors.toUnmodifiableList())
```

- unmodifiable;
- rejects null elements.

## 5.4 Need mutable ArrayList?

Use:

```java
stream.collect(Collectors.toCollection(ArrayList::new))
```

## 5.5 Rule

Never rely on unspecified mutability from `Collectors.toList()`.

---

# 6. Set Collectors

## 6.1 `toSet`

```java
Set<Role> roles = users.stream()
    .map(User::role)
    .collect(Collectors.toSet());
```

No guarantee on set implementation/order.

## 6.2 `toUnmodifiableSet`

```java
Set<Role> roles = users.stream()
    .map(User::role)
    .collect(Collectors.toUnmodifiableSet());
```

Unmodifiable; rejects null.

## 6.3 Ordered unique set

```java
LinkedHashSet<Role> roles = users.stream()
    .map(User::role)
    .collect(Collectors.toCollection(LinkedHashSet::new));
```

## 6.4 Sorted set

```java
TreeSet<String> names = users.stream()
    .map(User::name)
    .collect(Collectors.toCollection(TreeSet::new));
```

## 6.5 Rule

Use `toCollection` when set ordering/type matters.

---

# 7. `toCollection`

`toCollection` lets you choose collection implementation.

## 7.1 Mutable ArrayList

```java
ArrayList<User> list = users.stream()
    .collect(Collectors.toCollection(ArrayList::new));
```

## 7.2 LinkedHashSet

```java
LinkedHashSet<String> uniqueInOrder = names.stream()
    .collect(Collectors.toCollection(LinkedHashSet::new));
```

## 7.3 TreeSet

```java
TreeSet<String> sorted = names.stream()
    .collect(Collectors.toCollection(TreeSet::new));
```

## 7.4 EnumSet

```java
EnumSet<Role> roles = users.stream()
    .map(User::role)
    .collect(Collectors.toCollection(() -> EnumSet.noneOf(Role.class)));
```

## 7.5 Rule

If concrete collection behavior matters, specify it.

---

# 8. Map Collectors

Map collectors include:

```java
toMap
toUnmodifiableMap
toConcurrentMap
```

Map collection needs design for:

- key mapper;
- value mapper;
- duplicate key policy;
- map implementation;
- null policy;
- ordering.

## 8.1 Basic toMap

```java
Map<UserId, User> byId = users.stream()
    .collect(Collectors.toMap(User::id, Function.identity()));
```

## 8.2 Value projection

```java
Map<UserId, String> emailById = users.stream()
    .collect(Collectors.toMap(User::id, User::email));
```

## 8.3 Rule

Map collector means “one final value per key”, unless you merge/group.

---

# 9. `toMap` Duplicate Key Strategies

Duplicate key is unavoidable in many domains.

## 9.1 Basic toMap throws

```java
Collectors.toMap(User::role, Function.identity())
```

If two users have same role, exception.

## 9.2 First wins

```java
Collectors.toMap(
    User::role,
    Function.identity(),
    (first, second) -> first
)
```

## 9.3 Last wins

```java
Collectors.toMap(
    User::role,
    Function.identity(),
    (first, second) -> second
)
```

## 9.4 Merge domain values

```java
Collectors.toMap(
    Order::customerId,
    OrderSummary::from,
    OrderSummary::merge
)
```

## 9.5 Many values per key

Use groupingBy:

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(User::role));
```

## 9.6 Rule

Every `toMap` needs an explicit answer to “what if key duplicates?”

---

# 10. `toUnmodifiableMap`

Creates unmodifiable map.

## 10.1 Basic

```java
Map<UserId, String> emailById = users.stream()
    .collect(Collectors.toUnmodifiableMap(User::id, User::email));
```

## 10.2 Duplicate key

Use merge overload if duplicates possible.

```java
Collectors.toUnmodifiableMap(
    User::role,
    User::email,
    (a, b) -> a
)
```

## 10.3 Null

Rejects null keys and values.

## 10.4 Rule

Use toUnmodifiableMap for immutable output where null is invalid.

---

# 11. `toConcurrentMap`

Creates `ConcurrentMap`.

## 11.1 Example

```java
ConcurrentMap<UserId, User> byId = users.parallelStream()
    .collect(Collectors.toConcurrentMap(
        User::id,
        Function.identity()
    ));
```

## 11.2 Duplicate handling

```java
Collectors.toConcurrentMap(
    User::id,
    Function.identity(),
    (a, b) -> a
)
```

## 11.3 Use cases

- concurrent result needed;
- parallel accumulation into ConcurrentMap;
- later concurrent reads/writes.

## 11.4 Caveat

Values are not automatically thread-safe/immutable.

## 11.5 Rule

Use toConcurrentMap when concurrent map result is part of contract, not merely because stream is parallel.

---

# 12. `groupingBy`

`groupingBy` groups stream elements by classifier.

## 12.1 Basic

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(User::role));
```

## 12.2 Output

```text
Role -> List<User>
```

## 12.3 When use

When multiple elements per key are expected.

## 12.4 Difference from toMap

`toMap` wants one value per key.

`groupingBy` wants collection/reduction per key.

## 12.5 Rule

Use groupingBy when key duplicates are natural and should aggregate.

---

# 13. `groupingBy` with Downstream

Downstream collector changes value type.

## 13.1 Count per group

```java
Map<Role, Long> countByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.counting()
    ));
```

## 13.2 Names per role

```java
Map<Role, List<String>> namesByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.mapping(User::name, Collectors.toList())
    ));
```

## 13.3 Stats per role

```java
Map<Role, IntSummaryStatistics> ageStatsByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.summarizingInt(User::age)
    ));
```

## 13.4 Rule

Use downstream collectors to compute per-group output directly.

---

# 14. `groupingBy` with Map Supplier

Default map type is not your contract.

Specify if needed.

## 14.1 LinkedHashMap for encounter-order group keys

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        LinkedHashMap::new,
        Collectors.toList()
    ));
```

## 14.2 TreeMap for sorted keys

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        TreeMap::new,
        Collectors.toList()
    ));
```

## 14.3 EnumMap for enum keys

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        () -> new EnumMap<>(Role.class),
        Collectors.toList()
    ));
```

## 14.4 Rule

When map type/order matters, use groupingBy overload with map supplier.

---

# 15. `groupingByConcurrent`

Concurrent grouping.

## 15.1 Basic

```java
ConcurrentMap<Role, List<User>> byRole = users.parallelStream()
    .collect(Collectors.groupingByConcurrent(User::role));
```

## 15.2 With downstream

```java
ConcurrentMap<Role, Long> countByRole = users.parallelStream()
    .collect(Collectors.groupingByConcurrent(
        User::role,
        Collectors.counting()
    ));
```

## 15.3 Caveats

- generally unordered-oriented;
- downstream collector behavior matters;
- list values may not mean ordered list;
- concurrent grouping is not always faster.

## 15.4 Rule

Use groupingByConcurrent when unordered concurrent grouping fits and measurement supports it.

---

# 16. `partitioningBy`

Partitions into `true` and `false`.

## 16.1 Basic

```java
Map<Boolean, List<User>> activePartition = users.stream()
    .collect(Collectors.partitioningBy(User::active));
```

## 16.2 With downstream count

```java
Map<Boolean, Long> counts = users.stream()
    .collect(Collectors.partitioningBy(
        User::active,
        Collectors.counting()
    ));
```

## 16.3 Use case

Two buckets, boolean classifier.

## 16.4 Difference from groupingBy

`partitioningBy` always represents boolean partitioning conceptually.

## 16.5 Rule

Use partitioningBy for true/false split.

---

# 17. `mapping`

Adapts downstream collector by mapping input first.

## 17.1 Example

```java
Map<Role, Set<String>> emailsByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.mapping(User::email, Collectors.toSet())
    ));
```

## 17.2 Why not map before grouping?

If you map to email before grouping, you may lose role unless you carry it.

Downstream mapping keeps grouping context.

## 17.3 Rule

Use mapping when grouped element should be projected before downstream accumulation.

---

# 18. `filtering`

Filters input for downstream collector.

## 18.1 Example

```java
Map<Role, List<User>> activeUsersByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.filtering(User::active, Collectors.toList())
    ));
```

## 18.2 Difference from upstream filter

Upstream filter:

```java
users.stream()
    .filter(User::active)
    .collect(groupingBy(User::role));
```

Groups with no active users may be absent.

Downstream filtering can preserve group key with empty downstream result if group existed upstream.

## 18.3 Rule

Use downstream filtering when group presence matters even if downstream values are empty.

---

# 19. `flatMapping`

Maps input to stream and flattens into downstream collector.

## 19.1 Example

```java
Map<CustomerId, Set<ProductId>> productIdsByCustomer = orders.stream()
    .collect(Collectors.groupingBy(
        Order::customerId,
        Collectors.flatMapping(
            order -> order.lines().stream().map(OrderLine::productId),
            Collectors.toSet()
        )
    ));
```

## 19.2 Mapped stream closure

Mapped streams are closed after contents are placed downstream.

If mapper returns null stream, it is treated as empty stream.

## 19.3 Rule

Use flatMapping when one grouped element contributes zero/many downstream values.

---

# 20. `collectingAndThen`

Applies finisher after collector.

## 20.1 Immutable group values

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

## 20.2 Extract Optional

```java
User oldest = users.stream()
    .collect(Collectors.collectingAndThen(
        Collectors.maxBy(Comparator.comparing(User::createdAt)),
        Optional::orElseThrow
    ));
```

## 20.3 Rule

Use collectingAndThen when final result needs post-processing.

---

# 21. `teeing`

Runs two collectors and merges their results.

## 21.1 Example

```java
record MinMax(int min, int max) {}

MinMax minMax = numbers.stream()
    .collect(Collectors.teeing(
        Collectors.minBy(Integer::compareTo),
        Collectors.maxBy(Integer::compareTo),
        (min, max) -> new MinMax(min.orElseThrow(), max.orElseThrow())
    ));
```

## 21.2 Use case

Compute two independent reductions in one pass.

## 21.3 Empty input

Handle Optional outputs carefully.

## 21.4 Rule

Use teeing when two collector results must become one final result.

---

# 22. `counting`

Counts elements.

## 22.1 Whole stream

```java
long count = users.stream()
    .collect(Collectors.counting());
```

Usually:

```java
users.stream().count()
```

is simpler.

## 22.2 Downstream

```java
Map<Role, Long> countByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.counting()
    ));
```

## 22.3 Rule

Use `counting` mainly as downstream collector.

---

# 23. `summingInt`, `summingLong`, `summingDouble`

## 23.1 Sum per group

```java
Map<Role, Integer> totalAgeByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.summingInt(User::age)
    ));
```

## 23.2 Long sum

```java
Map<CustomerId, Long> totalCentsByCustomer = orders.stream()
    .collect(Collectors.groupingBy(
        Order::customerId,
        Collectors.summingLong(Order::amountInCents)
    ));
```

## 23.3 Double sum

Use only for approximate numeric domains.

## 23.4 Rule

Use summing collectors for downstream numeric totals.

---

# 24. `averagingInt`, `averagingLong`, `averagingDouble`

## 24.1 Average per group

```java
Map<Role, Double> avgAgeByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.averagingInt(User::age)
    ));
```

## 24.2 Return type

Averaging returns `Double`.

## 24.3 Empty group

For normal grouping, group exists because at least one input classified there. But downstream filtering can produce empty downstream, where averaging result semantics matter.

## 24.4 Rule

Use averaging collectors when Double average is acceptable.

---

# 25. `summarizingInt`, `summarizingLong`, `summarizingDouble`

Summary collectors produce statistics object.

## 25.1 Example

```java
Map<Role, IntSummaryStatistics> ageStatsByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.summarizingInt(User::age)
    ));
```

## 25.2 Stats include

- count;
- sum;
- min;
- max;
- average.

## 25.3 Useful when

You need multiple numeric aggregates in one pass.

## 25.4 Rule

Use summarizing collectors for per-group numeric dashboards.

---

# 26. `minBy` and `maxBy`

Collector form of min/max.

## 26.1 Whole stream

```java
Optional<User> oldest = users.stream()
    .collect(Collectors.minBy(Comparator.comparing(User::createdAt)));
```

Usually:

```java
users.stream().min(...)
```

is simpler.

## 26.2 Downstream

```java
Map<Role, Optional<User>> oldestByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.minBy(Comparator.comparing(User::createdAt))
    ));
```

## 26.3 Optional per group

Result values are Optional.

Use collectingAndThen if you want unwrap with policy.

## 26.4 Rule

Use minBy/maxBy mostly as downstream collectors.

---

# 27. `joining`

Joins `CharSequence` elements into String.

## 27.1 Basic

```java
String result = names.stream()
    .collect(Collectors.joining());
```

## 27.2 Delimiter

```java
String csv = names.stream()
    .collect(Collectors.joining(","));
```

## 27.3 Delimiter + prefix/suffix

```java
String display = names.stream()
    .collect(Collectors.joining(", ", "[", "]"));
```

## 27.4 Null risk

Joining expects CharSequence; null can cause problems.

Normalize first.

## 27.5 Rule

Use joining for String assembly, not reduce with `+`.

---

# 28. `reducing`

Collector form of reduction.

## 28.1 Whole stream

```java
Integer sum = numbers.stream()
    .collect(Collectors.reducing(0, Integer::sum));
```

Usually `reduce` or primitive sum is clearer.

## 28.2 Downstream use

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

## 28.3 Prefer specialized collectors

Often:

```java
maxBy
summingInt
counting
```

are clearer.

## 28.4 Rule

Use reducing when no more specific downstream collector fits.

---

# 29. `toUnmodifiable*` Collectors and Null

Unmodifiable collectors reject null.

Examples:

```java
toUnmodifiableList
toUnmodifiableSet
toUnmodifiableMap
```

## 29.1 Why good

They enforce null-free immutable result boundary.

## 29.2 Surprise

If stream can contain null, collection fails.

## 29.3 Normalize

```java
.filter(Objects::nonNull)
```

or map null to explicit value.

## 29.4 Rule

Use toUnmodifiable collectors when null rejection is desired contract.

---

# 30. Collector Composition Patterns

Collectors are composable.

## 30.1 Group + map

```java
groupingBy(User::role, mapping(User::email, toSet()))
```

## 30.2 Group + filter

```java
groupingBy(User::role, filtering(User::active, toList()))
```

## 30.3 Group + flatten

```java
groupingBy(Order::customerId, flatMapping(o -> o.lines().stream(), toList()))
```

## 30.4 Group + finish

```java
groupingBy(User::role, collectingAndThen(toList(), List::copyOf))
```

## 30.5 Group + stats

```java
groupingBy(User::role, summarizingInt(User::age))
```

## 30.6 Rule

Compose collectors to express output directly, not post-process manually.

---

# 31. Common Built-in Collector Recipes

## 31.1 Active users by role

```java
Map<Role, List<User>> activeByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.filtering(User::active, Collectors.toList())
    ));
```

## 31.2 Email set by role

```java
Map<Role, Set<String>> emailsByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.mapping(User::email, Collectors.toSet())
    ));
```

## 31.3 Total order amount by customer

```java
Map<CustomerId, Long> totalByCustomer = orders.stream()
    .collect(Collectors.groupingBy(
        Order::customerId,
        Collectors.summingLong(Order::amountInCents)
    ));
```

## 31.4 Last order per customer

```java
Map<CustomerId, Order> lastOrderByCustomer = orders.stream()
    .collect(Collectors.toMap(
        Order::customerId,
        Function.identity(),
        BinaryOperator.maxBy(Comparator.comparing(Order::createdAt))
    ));
```

## 31.5 Immutable grouped lists

```java
Map<Role, List<User>> immutableByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.collectingAndThen(Collectors.toList(), List::copyOf)
    ));
```

## 31.6 Rule

Prefer collector recipes that make domain policy visible.

---

# 32. Ordering and Map/Set Type

## 32.1 List preserves encounter order

If source has encounter order.

## 32.2 Set does not guarantee order

Use LinkedHashSet/TreeSet if needed.

## 32.3 Map from toMap

Default map type is not guaranteed as output contract.

Use supplier.

## 32.4 groupingBy map order

Use map supplier for key order.

## 32.5 Rule

If output order matters, choose collection/map implementation explicitly.

---

# 33. Memory Behavior

## 33.1 toList/toSet

Materialize all output elements.

## 33.2 toMap

Materializes one value per key.

## 33.3 groupingBy

Materializes map + group containers.

Potentially huge.

## 33.4 joining

Materializes one big String.

## 33.5 summarizing/counting

Compact aggregation.

## 33.6 Rule

Prefer aggregate collectors over materializing collectors when output can be huge.

---

# 34. Parallel and Concurrent Behavior

## 34.1 toList in parallel

Correct via per-partition accumulation + combining.

## 34.2 groupingBy in parallel

Can be expensive due map combining.

## 34.3 groupingByConcurrent

May reduce combining but introduces concurrent map update contention and unordered semantics.

## 34.4 toConcurrentMap

Useful when concurrent result desired.

## 34.5 Rule

Parallel collector performance depends on cardinality, contention, combiner cost, and order requirements.

---

# 35. Common Anti-Patterns

## 35.1 `toMap` with duplicate keys

Fix: merge function or groupingBy.

## 35.2 `toSet` expecting stable order

Fix: LinkedHashSet.

## 35.3 `groupingBy` for massive high-cardinality stream

Potential OOM.

## 35.4 `joining` huge stream into memory

Potential large string memory issue.

## 35.5 `groupingByConcurrent` assumed ordered

Wrong.

## 35.6 `Collectors.toList()` assumed mutable

Contract does not guarantee.

## 35.7 `toUnmodifiableList` with null

Fails.

## 35.8 Upstream filter when empty groups must remain

Use downstream filtering.

## 35.9 `reducing` when `summingInt`/`maxBy` clearer

Use semantic collector.

## 35.10 Rule

Collector defaults are not always your product/API contract.

---

# 36. Production Failure Modes

## 36.1 Duplicate key exception

Cause: `toMap` without merge.

## 36.2 Nondeterministic JSON output

Cause: HashSet/HashMap collector when order expected.

## 36.3 Memory spike from groupingBy

Cause: materializing all groups.

## 36.4 Unmodifiable mutation crash

Cause: caller mutates `stream.toList()` or unmodifiable collector result.

## 36.5 NullPointerException in unmodifiable collectors

Cause: null input.

## 36.6 Wrong group presence

Cause: upstream filter vs downstream filtering confusion.

## 36.7 Concurrent grouping output order surprise

Cause: groupingByConcurrent unordered semantics.

## 36.8 Map value list externally mutated

Cause: returning mutable grouped lists.

Fix: collectingAndThen/List.copyOf.

## 36.9 joining creates huge string

Fix: stream to Writer or chunk output.

## 36.10 teeing Optional empty crash

Fix: handle empty.

## 36.11 Wrong merge policy hides data loss

Cause: first-wins/last-wins used carelessly.

## 36.12 Bad map supplier

Cause: TreeMap comparator inconsistent or EnumMap wrong enum type.

---

# 37. Best Practices

## 37.1 Start with output contract

Define:

- type;
- mutability;
- ordering;
- duplicate policy;
- null policy;
- memory expectation.

## 37.2 Prefer semantic collectors

Use:

- counting;
- summing;
- summarizing;
- joining;
- groupingBy;
- partitioningBy.

## 37.3 Be explicit with maps

Always handle duplicates intentionally.

## 37.4 Use downstream collectors

Avoid post-processing maps manually.

## 37.5 Use toCollection for implementation-specific result

Especially order-sensitive sets/maps.

## 37.6 Use immutable finishers at boundaries

`collectingAndThen(..., List::copyOf)`

## 37.7 Avoid materializing huge data

Aggregate upstream or stream to external sink.

## 37.8 Test edge cases

- empty input;
- duplicate keys;
- null values;
- ordering;
- high cardinality;
- parallel if used.

---

# 38. Decision Matrix

| Need | Built-in Collector |
|---|---|
| unmodifiable list, null allowed | `stream.toList()` |
| mutable ArrayList | `toCollection(ArrayList::new)` |
| unmodifiable null-rejecting list | `toUnmodifiableList()` |
| unique no order contract | `toSet()` |
| unique insertion order | `toCollection(LinkedHashSet::new)` |
| sorted unique | `toCollection(TreeSet::new)` |
| enum set | `toCollection(() -> EnumSet.noneOf(...))` |
| one value per key | `toMap` |
| duplicate key with merge | `toMap(k, v, merge)` |
| specific map type | `toMap(k, v, merge, supplier)` |
| immutable map | `toUnmodifiableMap` |
| concurrent map | `toConcurrentMap` |
| many values per key | `groupingBy` |
| count per key | `groupingBy(k, counting())` |
| sum per key | `groupingBy(k, summingLong(...))` |
| stats per key | `groupingBy(k, summarizingInt(...))` |
| boolean split | `partitioningBy` |
| project within group | `mapping` |
| filter within group | `filtering` |
| flatten within group | `flatMapping` |
| immutable group values | `collectingAndThen(toList(), List::copyOf)` |
| two reductions one result | `teeing` |
| string concat | `joining` |
| downstream custom reduce | `reducing` |
| parallel unordered grouping | consider `groupingByConcurrent` |
| keep group key order | `groupingBy(k, LinkedHashMap::new, downstream)` |

---

# 39. Latihan

## Latihan 1 — toList Variants

Compare mutability/null behavior of:

```java
stream.toList()
collect(toList())
collect(toUnmodifiableList())
collect(toCollection(ArrayList::new))
```

## Latihan 2 — Duplicate Key

Collect users by role with `toMap`.

Make it fail, then fix with first-wins, last-wins, and groupingBy.

## Latihan 3 — Ordered Set

Collect names into `toSet` and `LinkedHashSet`.

Explain order difference.

## Latihan 4 — Group Count

Group users by role and count.

## Latihan 5 — Group Mapping

Group users by role into emails.

## Latihan 6 — Downstream Filtering

Compare upstream filter vs downstream filtering for preserving empty groups.

## Latihan 7 — FlatMapping

Group orders by customer and collect all product IDs.

## Latihan 8 — Immutable Group Values

Use groupingBy + collectingAndThen to make group lists immutable.

## Latihan 9 — Teeing

Compute min/max age into a record.

Handle empty list.

## Latihan 10 — Memory Scenario

Given 50 million events, decide whether `groupingBy` is safe. Propose alternative.

---

# 40. Ringkasan

Built-in collectors are output-shape vocabulary.

Core lessons:

- Choose collector based on output contract.
- `Stream.toList()` returns unmodifiable list.
- `Collectors.toList()` does not guarantee mutability/type.
- `toUnmodifiable*` rejects null.
- `toCollection` is for explicit collection implementation.
- `toSet` has no stable order guarantee.
- `toMap` needs duplicate key policy.
- `groupingBy` is for many values/reductions per key.
- `groupingBy` map supplier controls key map implementation/order.
- `groupingByConcurrent` is unordered/concurrent-oriented.
- `partitioningBy` is boolean split.
- `mapping`, `filtering`, `flatMapping` adapt downstream collection.
- `collectingAndThen` applies final transformation.
- `teeing` combines two reductions.
- `counting`, `summing`, `averaging`, `summarizing` are especially useful downstream.
- `joining` is for string assembly.
- `reducing` is useful when no specialized collector fits.
- Materializing collectors can consume large memory.
- Order, null, duplicate, mutability, and memory policy must be explicit.

Main rule:

```text
Do not ask “which collector can do this?”
Ask “what is the exact result contract?”
Then choose the collector that encodes that contract.
```

---

# 41. Referensi

1. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

2. Java SE 25 — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

3. Java SE 25 — `Collector.Characteristics`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.Characteristics.html

4. Java SE 25 — `Stream.toList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html#toList()

5. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

6. Java SE 25 — `ConcurrentMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentMap.html

7. Java SE 25 — `IntSummaryStatistics`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/IntSummaryStatistics.html

8. Java SE 25 — `DoubleSummaryStatistics`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/DoubleSummaryStatistics.html

9. dev.java — The Stream API  
   https://dev.java/learn/api/streams/

10. dev.java — Reductions  
    https://dev.java/learn/api/streams/reducing/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-030.md](./learn-java-collections-and-streams-part-030.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-032.md](./learn-java-collections-and-streams-part-032.md)

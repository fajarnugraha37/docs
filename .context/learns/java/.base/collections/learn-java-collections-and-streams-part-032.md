# learn-java-collections-and-streams-part-032.md

# Java Collections and Streams — Part 032  
# Grouping and Aggregation Patterns: groupingBy, groupingByConcurrent, partitioningBy, Downstream Collectors, Multi-Level Grouping, Histograms, Rollups, Top-N, and Production Aggregation Design

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **032**  
> Fokus: memahami grouping dan aggregation sebagai pola desain data processing di Java Streams. Kita akan membedah `groupingBy`, `partitioningBy`, downstream collectors, multi-level grouping, histogram, rollup, top-N per group, duplicate handling, high-cardinality memory risk, ordering, concurrency, dan kapan aggregation harus dipindahkan ke database/streaming engine.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Grouping = Classify, Bucket, Reduce](#2-mental-model-grouping--classify-bucket-reduce)
3. [Grouping vs Mapping vs Filtering vs Reducing](#3-grouping-vs-mapping-vs-filtering-vs-reducing)
4. [Basic `groupingBy`](#4-basic-groupingby)
5. [Classifier Function](#5-classifier-function)
6. [Default Output Shape: `Map<K, List<T>>`](#6-default-output-shape-mapk-listt)
7. [Downstream Collector Mental Model](#7-downstream-collector-mental-model)
8. [Counting per Group](#8-counting-per-group)
9. [Summing per Group](#9-summing-per-group)
10. [Averaging per Group](#10-averaging-per-group)
11. [Summary Statistics per Group](#11-summary-statistics-per-group)
12. [Mapping Values per Group](#12-mapping-values-per-group)
13. [Filtering Values per Group](#13-filtering-values-per-group)
14. [FlatMapping Values per Group](#14-flatmapping-values-per-group)
15. [Immutable Group Values](#15-immutable-group-values)
16. [Multi-Level Grouping](#16-multi-level-grouping)
17. [Composite Key vs Nested Map](#17-composite-key-vs-nested-map)
18. [Histograms](#18-histograms)
19. [Rollups](#19-rollups)
20. [Top-N per Group](#20-top-n-per-group)
21. [Min/Max per Group](#21-minmax-per-group)
22. [Latest/First/Last per Group](#22-latestfirstlast-per-group)
23. [Deduplication per Group](#23-deduplication-per-group)
24. [Partitioning as Two-Way Grouping](#24-partitioning-as-two-way-grouping)
25. [`groupingBy` vs `toMap`](#25-groupingby-vs-tomap)
26. [`groupingBy` Map Supplier](#26-groupingby-map-supplier)
27. [`groupingByConcurrent`](#27-groupingbyconcurrent)
28. [Ordering in Aggregation Results](#28-ordering-in-aggregation-results)
29. [Null Keys and Null Values](#29-null-keys-and-null-values)
30. [High Cardinality and Memory Risk](#30-high-cardinality-and-memory-risk)
31. [Aggregation in Java vs Database vs Streaming Engine](#31-aggregation-in-java-vs-database-vs-streaming-engine)
32. [Production Diagnostics](#32-production-diagnostics)
33. [Common Anti-Patterns](#33-common-anti-patterns)
34. [Production Failure Modes](#34-production-failure-modes)
35. [Best Practices](#35-best-practices)
36. [Decision Matrix](#36-decision-matrix)
37. [Latihan](#37-latihan)
38. [Ringkasan](#38-ringkasan)
39. [Referensi](#39-referensi)

---

# 1. Tujuan Bagian Ini

Grouping dan aggregation adalah salah satu alasan utama Stream API terasa powerful.

Contoh:

```java
Map<Role, Long> countByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.counting()
    ));
```

Atau:

```java
Map<CustomerId, Long> totalAmountByCustomer = orders.stream()
    .collect(Collectors.groupingBy(
        Order::customerId,
        Collectors.summingLong(Order::amountInCents)
    ));
```

Namun grouping juga sering menjadi sumber masalah production:

- `groupingBy` menghasilkan `Map<K, List<T>>` dan menyimpan semua item per group;
- high-cardinality key membuat memory meledak;
- nested grouping menghasilkan struktur sulit dibaca;
- order output tidak sesuai ekspektasi;
- null classifier menyebabkan failure;
- `groupingByConcurrent` dipakai karena “parallel” tapi hasil/order tidak sesuai;
- downstream filtering berbeda dari upstream filtering;
- top-N per group dibuat dengan full list sort mahal;
- aggregation di Java padahal seharusnya dilakukan di database.

Tujuan part ini:

- memahami grouping sebagai classify + bucket + reduce;
- memahami downstream collector sebagai aggregation policy;
- membangun pola histogram, rollup, top-N, min/max, latest per group;
- memahami nested map vs composite key;
- memahami memory dan cardinality;
- tahu kapan Java stream aggregation tepat dan kapan tidak.

---

# 2. Mental Model: Grouping = Classify, Bucket, Reduce

Grouping punya tiga langkah mental:

```text
1. classify element into key
2. put element into bucket for that key
3. reduce each bucket into final value
```

Example:

```java
Map<Role, Long> countByRole = users.stream()
    .collect(Collectors.groupingBy(User::role, Collectors.counting()));
```

Mental model:

```text
User -> role
role bucket -> count
```

## 2.1 Without downstream

```java
groupingBy(User::role)
```

default downstream:

```java
toList()
```

Output:

```java
Map<Role, List<User>>
```

## 2.2 With downstream

```java
groupingBy(User::role, counting())
```

Output:

```java
Map<Role, Long>
```

## 2.3 Main rule

```text
Grouping is not just creating buckets.
Good grouping chooses what each bucket reduces into.
```

---

# 3. Grouping vs Mapping vs Filtering vs Reducing

## 3.1 Mapping

Transforms each element.

```java
users.stream().map(User::email)
```

## 3.2 Filtering

Selects elements.

```java
users.stream().filter(User::active)
```

## 3.3 Grouping

Classifies elements by key.

```java
users.stream().collect(groupingBy(User::role))
```

## 3.4 Reducing

Aggregates many elements into result.

```java
collect(groupingBy(User::role, counting()))
```

## 3.5 Combined

```java
Map<Role, Set<String>> activeEmailsByRole = users.stream()
    .filter(User::active)
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.mapping(User::email, Collectors.toSet())
    ));
```

## 3.6 Rule

Most aggregation pipelines are selection + classification + per-group reduction.

---

# 4. Basic `groupingBy`

Basic form:

```java
Collectors.groupingBy(classifier)
```

Example:

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(User::role));
```

## 4.1 Output

```java
Map<Role, List<User>>
```

## 4.2 Equivalent idea

```java
Map<Role, List<User>> result = new HashMap<>();
for (User user : users) {
    result.computeIfAbsent(user.role(), k -> new ArrayList<>())
          .add(user);
}
```

## 4.3 When useful

When you need all original items per key.

## 4.4 Warning

If you only need counts/sums/stats, do not collect full lists.

## 4.5 Rule

Default groupingBy materializes lists. Use downstream aggregation when possible.

---

# 5. Classifier Function

Classifier maps element to group key.

```java
Function<? super T, ? extends K>
```

Example:

```java
User::role
Order::customerId
Event::type
Invoice::status
```

## 5.1 Good classifier

- stable;
- deterministic;
- cheap;
- non-null if collector/map rejects null;
- has correct equals/hashCode if key object.

## 5.2 Bad classifier

```java
user -> new MutableKey(user)
```

if key can mutate.

## 5.3 Composite classifier

```java
record CustomerMonth(CustomerId customerId, YearMonth month) {}
```

## 5.4 Rule

Classifier key is map key; all map key rules apply.

---

# 6. Default Output Shape: `Map<K, List<T>>`

Default groupingBy is:

```java
Map<K, List<T>>
```

## 6.1 Example

```java
Map<Status, List<Order>> byStatus = orders.stream()
    .collect(Collectors.groupingBy(Order::status));
```

## 6.2 Memory behavior

Stores every order reference in grouped lists.

## 6.3 If data is large

Maybe too expensive.

## 6.4 Alternative

Count:

```java
groupingBy(Order::status, counting())
```

Sum:

```java
groupingBy(Order::status, summingLong(Order::amountInCents))
```

Stats:

```java
groupingBy(Order::status, summarizingLong(Order::amountInCents))
```

## 6.5 Rule

Do not default to `Map<K, List<T>>` if you only need aggregate numbers.

---

# 7. Downstream Collector Mental Model

Downstream collector defines what happens inside each bucket.

```java
groupingBy(classifier, downstream)
```

Examples:

```java
counting()
summingLong(...)
mapping(..., toSet())
filtering(..., toList())
flatMapping(..., toSet())
collectingAndThen(...)
```

## 7.1 Mental model

```text
for each group:
    apply downstream collector to elements in that group
```

## 7.2 Example

```java
Map<Role, Set<String>> emailsByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.mapping(User::email, Collectors.toSet())
    ));
```

Inside each role group:

```text
User -> email -> Set<String>
```

## 7.3 Rule

Downstream collector is the per-group aggregation policy.

---

# 8. Counting per Group

## 8.1 Count users by role

```java
Map<Role, Long> countByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.counting()
    ));
```

## 8.2 Count orders by status

```java
Map<OrderStatus, Long> countByStatus = orders.stream()
    .collect(Collectors.groupingBy(
        Order::status,
        Collectors.counting()
    ));
```

## 8.3 Why better than list size

Bad:

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(groupingBy(User::role));

Map<Role, Integer> counts = byRole.entrySet().stream()
    .collect(toMap(Map.Entry::getKey, e -> e.getValue().size()));
```

This stores all users unnecessarily.

## 8.4 Rule

If you only need counts, use `counting()` directly.

---

# 9. Summing per Group

## 9.1 Total order amount per customer

```java
Map<CustomerId, Long> totalByCustomer = orders.stream()
    .collect(Collectors.groupingBy(
        Order::customerId,
        Collectors.summingLong(Order::amountInCents)
    ));
```

## 9.2 Quantity per product

```java
Map<ProductId, Integer> quantityByProduct = lines.stream()
    .collect(Collectors.groupingBy(
        OrderLine::productId,
        Collectors.summingInt(OrderLine::quantity)
    ));
```

## 9.3 Double sum

Use for approximate values:

```java
Map<SensorId, Double> totalBySensor = readings.stream()
    .collect(Collectors.groupingBy(
        Reading::sensorId,
        Collectors.summingDouble(Reading::value)
    ));
```

## 9.4 Rule

Use summing collectors for numeric aggregation per group; choose int/long/double carefully.

---

# 10. Averaging per Group

## 10.1 Average age by role

```java
Map<Role, Double> avgAgeByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.averagingInt(User::age)
    ));
```

## 10.2 Average order amount by status

```java
Map<OrderStatus, Double> avgAmountByStatus = orders.stream()
    .collect(Collectors.groupingBy(
        Order::status,
        Collectors.averagingLong(Order::amountInCents)
    ));
```

## 10.3 Money caution

Average cents as double may be okay for reporting display if rounded carefully, but not for accounting ledger.

## 10.4 Rule

Averaging collectors return Double; decide if approximate output is acceptable.

---

# 11. Summary Statistics per Group

## 11.1 Example

```java
Map<ProductId, IntSummaryStatistics> qtyStatsByProduct = lines.stream()
    .collect(Collectors.groupingBy(
        OrderLine::productId,
        Collectors.summarizingInt(OrderLine::quantity)
    ));
```

## 11.2 Includes

- count;
- sum;
- min;
- max;
- average.

## 11.3 Use case

Dashboards, metrics, quick summaries.

## 11.4 Rule

Use summary statistics when multiple numeric aggregates are needed in one pass.

---

# 12. Mapping Values per Group

Use `mapping` downstream.

## 12.1 Emails by role

```java
Map<Role, Set<String>> emailsByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.mapping(User::email, Collectors.toSet())
    ));
```

## 12.2 Product IDs by customer

```java
Map<CustomerId, Set<ProductId>> productsByCustomer = orders.stream()
    .collect(Collectors.groupingBy(
        Order::customerId,
        Collectors.mapping(Order::productId, Collectors.toSet())
    ));
```

## 12.3 Rule

Use downstream mapping when group key needs original element but group value needs projection.

---

# 13. Filtering Values per Group

Use downstream `filtering`.

## 13.1 Active users by role while preserving roles

```java
Map<Role, List<User>> activeByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.filtering(User::active, Collectors.toList())
    ));
```

## 13.2 Upstream filter difference

```java
users.stream()
    .filter(User::active)
    .collect(groupingBy(User::role));
```

This can omit roles with no active users.

Downstream filtering can keep existing role groups with empty list, if at least one user with that role was present upstream.

## 13.3 Use case

Reports where all categories must appear.

## 13.4 Rule

Use downstream filtering when empty result per existing group is meaningful.

---

# 14. FlatMapping Values per Group

Use downstream `flatMapping` when each element contributes many group values.

## 14.1 Order lines by customer

```java
Map<CustomerId, Set<ProductId>> productsByCustomer = orders.stream()
    .collect(Collectors.groupingBy(
        Order::customerId,
        Collectors.flatMapping(
            order -> order.lines().stream().map(OrderLine::productId),
            Collectors.toSet()
        )
    ));
```

## 14.2 Tags by article category

```java
Map<Category, Set<Tag>> tagsByCategory = articles.stream()
    .collect(Collectors.groupingBy(
        Article::category,
        Collectors.flatMapping(
            article -> article.tags().stream(),
            Collectors.toSet()
        )
    ));
```

## 14.3 Rule

Use flatMapping when grouped input has nested collections.

---

# 15. Immutable Group Values

Grouped lists are often mutable.

At API boundary, immutable group values may be better.

## 15.1 Immutable lists per group

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.collectingAndThen(
            Collectors.toList(),
            List::copyOf
        )
    ));
```

## 15.2 Immutable map too

```java
Map<Role, List<User>> immutableByRole = Map.copyOf(byRole);
```

But note: `Map.copyOf` is shallow; group lists must already be immutable.

## 15.3 Rule

Use `collectingAndThen` for immutable group values.

---

# 16. Multi-Level Grouping

Nested grouping:

```java
Map<Department, Map<Role, List<User>>> byDeptThenRole = users.stream()
    .collect(Collectors.groupingBy(
        User::department,
        Collectors.groupingBy(User::role)
    ));
```

## 16.1 With downstream count

```java
Map<Department, Map<Role, Long>> countByDeptRole = users.stream()
    .collect(Collectors.groupingBy(
        User::department,
        Collectors.groupingBy(
            User::role,
            Collectors.counting()
        )
    ));
```

## 16.2 Risk

Nested maps become hard to traverse, serialize, and maintain.

## 16.3 Alternative

Composite key record:

```java
record DeptRole(Department department, Role role) {}
```

## 16.4 Rule

Use nested grouping for naturally hierarchical output; use composite key for tabular/matrix output.

---

# 17. Composite Key vs Nested Map

## 17.1 Nested map

```java
Map<Department, Map<Role, Long>>
```

Good for hierarchical access:

```java
result.get(dept).get(role)
```

## 17.2 Composite key

```java
Map<DeptRole, Long>
```

Good for:

- flat tables;
- export;
- matrix transformation;
- database-like grouping;
- easier iteration.

## 17.3 Composite key record

```java
record DeptRole(Department department, Role role) {}

Map<DeptRole, Long> count = users.stream()
    .collect(Collectors.groupingBy(
        user -> new DeptRole(user.department(), user.role()),
        Collectors.counting()
    ));
```

## 17.4 Rule

Choose result shape based on how consumers read the aggregation.

---

# 18. Histograms

Histogram counts frequency per bucket.

## 18.1 Status histogram

```java
Map<OrderStatus, Long> statusHistogram = orders.stream()
    .collect(Collectors.groupingBy(
        Order::status,
        Collectors.counting()
    ));
```

## 18.2 Age bucket histogram

```java
record AgeBucket(int minInclusive, int maxInclusive) {}

AgeBucket bucket(int age) {
    int start = (age / 10) * 10;
    return new AgeBucket(start, start + 9);
}

Map<AgeBucket, Long> ageHistogram = users.stream()
    .collect(Collectors.groupingBy(
        user -> bucket(user.age()),
        Collectors.counting()
    ));
```

## 18.3 Ordering buckets

Use TreeMap or sort result later.

## 18.4 Rule

Histogram is grouping with count downstream.

---

# 19. Rollups

Rollup aggregates by time/category levels.

## 19.1 Sales by month

```java
Map<YearMonth, Long> salesByMonth = orders.stream()
    .collect(Collectors.groupingBy(
        order -> YearMonth.from(order.createdAt()),
        TreeMap::new,
        Collectors.summingLong(Order::amountInCents)
    ));
```

## 19.2 Sales by customer and month

```java
record CustomerMonth(CustomerId customerId, YearMonth month) {}

Map<CustomerMonth, Long> sales = orders.stream()
    .collect(Collectors.groupingBy(
        order -> new CustomerMonth(
            order.customerId(),
            YearMonth.from(order.createdAt())
        ),
        Collectors.summingLong(Order::amountInCents)
    ));
```

## 19.3 Rule

Rollups are grouping over derived dimensions.

---

# 20. Top-N per Group

Top-N per group is common but tricky.

## 20.1 Simple but memory-heavy

```java
Map<Role, List<User>> top3ByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.collectingAndThen(
            Collectors.toList(),
            list -> list.stream()
                .sorted(Comparator.comparing(User::score).reversed())
                .limit(3)
                .toList()
        )
    ));
```

## 20.2 Problem

Stores all users per group then sorts each group.

May be okay for small groups, bad for huge groups.

## 20.3 Better for large groups

Use custom collector with bounded priority queue per group.

Conceptual:

```text
for each group keep only top N candidates
```

## 20.4 Rule

Top-N per group should not sort full group if group size can be huge.

---

# 21. Min/Max per Group

## 21.1 Max score by role

```java
Map<Role, Optional<User>> topByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.maxBy(Comparator.comparing(User::score))
    ));
```

## 21.2 Unwrap Optional per group

```java
Map<Role, User> topByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.collectingAndThen(
            Collectors.maxBy(Comparator.comparing(User::score)),
            Optional::orElseThrow
        )
    ));
```

Because groups created from at least one element, Optional should be present unless downstream filtering creates empty groups.

## 21.3 Rule

Use `minBy`/`maxBy` for one best element per group.

---

# 22. Latest/First/Last per Group

## 22.1 Latest order per customer

```java
Map<CustomerId, Order> latestByCustomer = orders.stream()
    .collect(Collectors.toMap(
        Order::customerId,
        Function.identity(),
        BinaryOperator.maxBy(Comparator.comparing(Order::createdAt))
    ));
```

This is often better than grouping to list then sorting.

## 22.2 First encountered per key

```java
Map<CustomerId, Order> firstByCustomer = orders.stream()
    .collect(Collectors.toMap(
        Order::customerId,
        Function.identity(),
        (first, second) -> first,
        LinkedHashMap::new
    ));
```

## 22.3 Last encountered per key

```java
Map<CustomerId, Order> lastByCustomer = orders.stream()
    .collect(Collectors.toMap(
        Order::customerId,
        Function.identity(),
        (first, second) -> second,
        LinkedHashMap::new
    ));
```

## 22.4 Rule

For one value per key with merge policy, `toMap` may be better than `groupingBy`.

---

# 23. Deduplication per Group

## 23.1 Unique emails by role

```java
Map<Role, Set<String>> emailsByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.mapping(User::email, Collectors.toSet())
    ));
```

## 23.2 Preserve email encounter order

```java
Map<Role, Set<String>> emailsByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.mapping(
            User::email,
            Collectors.toCollection(LinkedHashSet::new)
        )
    ));
```

## 23.3 Rule

For per-group uniqueness, use downstream Set collector.

---

# 24. Partitioning as Two-Way Grouping

`partitioningBy` is boolean grouping.

## 24.1 Active vs inactive

```java
Map<Boolean, List<User>> partition = users.stream()
    .collect(Collectors.partitioningBy(User::active));
```

## 24.2 Count active/inactive

```java
Map<Boolean, Long> counts = users.stream()
    .collect(Collectors.partitioningBy(
        User::active,
        Collectors.counting()
    ));
```

## 24.3 Better domain type?

Sometimes boolean map is less readable than record:

```java
record ActiveSummary(long active, long inactive) {}
```

Can use `teeing` or explicit loop.

## 24.4 Rule

Use partitioningBy for simple boolean split; use domain summary for public API clarity.

---

# 25. `groupingBy` vs `toMap`

## 25.1 Use groupingBy when many values per key

```java
Map<Role, List<User>>
```

## 25.2 Use toMap when one value per key

```java
Map<UserId, User>
```

## 25.3 Use toMap with merge when duplicates collapse to one

```java
latest order per customer
```

## 25.4 Use groupingBy with downstream when duplicates aggregate to a value

```java
count/sum/stats/list/set per key
```

## 25.5 Rule

`toMap` is one final value per key. `groupingBy` is per-key aggregation.

---

# 26. `groupingBy` Map Supplier

## 26.1 Default

Default map type is implementation detail not business contract.

## 26.2 LinkedHashMap

```java
Collectors.groupingBy(
    classifier,
    LinkedHashMap::new,
    downstream
)
```

For encounter-order keys.

## 26.3 TreeMap

```java
Collectors.groupingBy(
    classifier,
    TreeMap::new,
    downstream
)
```

For sorted keys.

## 26.4 EnumMap

```java
Collectors.groupingBy(
    User::role,
    () -> new EnumMap<>(Role.class),
    downstream
)
```

Efficient for enum keys.

## 26.5 Rule

If group key ordering or map performance matters, specify map supplier.

---

# 27. `groupingByConcurrent`

`groupingByConcurrent` returns concurrent collector producing `ConcurrentMap`.

## 27.1 Example

```java
ConcurrentMap<Role, Long> countByRole = users.parallelStream()
    .collect(Collectors.groupingByConcurrent(
        User::role,
        Collectors.counting()
    ));
```

## 27.2 Why use

Potentially better for parallel unordered grouping.

## 27.3 Caveats

- result is concurrent map;
- order is not primary semantic;
- downstream collector still matters;
- contention on hot keys can hurt performance;
- not automatically faster.

## 27.4 Rule

Use groupingByConcurrent only when unordered concurrent aggregation semantics fit and performance is measured.

---

# 28. Ordering in Aggregation Results

Ordering can matter at several levels.

## 28.1 Group key order

Use map supplier:

```java
LinkedHashMap
TreeMap
EnumMap
```

## 28.2 Values order inside group

Use downstream collector:

```java
toList
toCollection(LinkedHashSet::new)
sorted post-processing
```

## 28.3 Sorted group values

```java
Map<Role, List<User>> sortedUsersByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.collectingAndThen(
            Collectors.toList(),
            list -> list.stream()
                .sorted(Comparator.comparing(User::name))
                .toList()
        )
    ));
```

## 28.4 Rule

Specify ordering at both key and value levels if output contract needs it.

---

# 29. Null Keys and Null Values

## 29.1 Classifier null

A null group key may fail depending collector/map implementation.

Best practice:

```java
.filter(user -> user.role() != null)
```

or:

```java
user -> Optional.ofNullable(user.role()).orElse(Role.UNKNOWN)
```

## 29.2 Downstream null

`mapping(User::email, toUnmodifiableSet())` fails if email null.

## 29.3 Rule

Normalize null before grouping/aggregation.

---

# 30. High Cardinality and Memory Risk

High cardinality means many distinct keys.

## 30.1 Example

Grouping by request ID:

```java
groupingBy(Event::requestId)
```

If requestId unique, you create almost one group per event.

## 30.2 Memory cost

Grouping stores:

- map entry per key;
- downstream container/result per key;
- sometimes list per key;
- references to elements.

## 30.3 Better options

- aggregate in database;
- process in pages/windows;
- use streaming engine;
- use approximate sketches;
- limit dimensions;
- pre-filter;
- summarize compactly;
- write incremental results.

## 30.4 Rule

Never group unbounded high-cardinality data in memory without a budget.

---

# 31. Aggregation in Java vs Database vs Streaming Engine

## 31.1 Java stream aggregation is good when

- data already in memory;
- input bounded;
- dataset moderate;
- business logic not easy in SQL;
- need local DTO transformation;
- aggregation is request-scope small/medium.

## 31.2 Database aggregation is better when

- data lives in DB;
- filtering/grouping can be pushed down;
- dataset large;
- indexes can help;
- result is compact.

Example SQL:

```sql
SELECT status, COUNT(*)
FROM orders
WHERE created_at >= ?
GROUP BY status;
```

## 31.3 Streaming engine better when

- unbounded events;
- windowed aggregation;
- stateful continuous processing;
- high throughput;
- replay/fault tolerance needed.

## 31.4 Rule

Do not pull millions of rows into Java just to group them if the database can aggregate them.

---

# 32. Production Diagnostics

Check:

## 32.1 Group cardinality

How many distinct keys?

## 32.2 Group size distribution

Are there hot keys with huge lists?

## 32.3 Memory allocation

Are lists/maps exploding?

## 32.4 Duplicate policy

Is data loss hidden by first-wins/last-wins?

## 32.5 Order contract

Are tests relying on HashMap order?

## 32.6 Null rate

Are classifier/value nulls causing exceptions?

## 32.7 DB pushdown opportunity

Can aggregation be moved upstream?

## 32.8 Rule

Aggregation diagnostics are mostly about cardinality, memory, and contract mismatch.

---

# 33. Common Anti-Patterns

## 33.1 groupingBy then size

Use counting.

## 33.2 groupingBy then sum manually

Use summing.

## 33.3 groupingBy huge data

Push down or stream incrementally.

## 33.4 nested grouping for flat report

Use composite key.

## 33.5 toMap where duplicates natural

Use groupingBy.

## 33.6 groupingBy where one value needed

Use toMap with merge.

## 33.7 groupingByConcurrent for deterministic ordered output

Wrong.

## 33.8 top-N per group by sorting full giant lists

Use bounded heap/custom collector.

## 33.9 null classifier ignored

Normalize null.

## 33.10 default HashMap order exposed to API

Specify map type.

---

# 34. Production Failure Modes

## 34.1 OOM from `Map<K, List<T>>`

Cause: default grouping stores all elements.

Fix: downstream aggregation or upstream aggregation.

## 34.2 Too many groups

Cause: high-cardinality classifier.

Fix: reduce dimensions, page/window, DB aggregation.

## 34.3 Missing group keys

Cause: upstream filter removed all elements for category.

Fix: downstream filtering or pre-seed categories.

## 34.4 Wrong order

Cause: default map/set type.

Fix: LinkedHashMap/TreeMap/LinkedHashSet.

## 34.5 Duplicate data silently lost

Cause: toMap merge first-wins/last-wins used incorrectly.

Fix: groupingBy or explicit domain merge.

## 34.6 Concurrent grouping slower

Cause: hot key contention or downstream overhead.

Fix: benchmark; use sequential/groupingBy or different aggregation.

## 34.7 Null classifier failure

Fix: UNKNOWN bucket or filter.

## 34.8 Money total wrong

Cause: summingDouble for currency.

Fix: summingLong minor units or BigDecimal reduction.

## 34.9 Nested maps hard to serialize

Fix: composite key DTO/list rows.

## 34.10 Top-N latency spike

Cause: sorting huge group lists.

Fix: bounded priority queue.

---

# 35. Best Practices

## 35.1 Use downstream collectors early

Avoid materializing lists if aggregate is enough.

## 35.2 Design output shape first

Nested map? Composite key? DTO rows?

## 35.3 Specify map/collection type when order matters

Do not rely on defaults.

## 35.4 Normalize nulls

Before classifier/downstream.

## 35.5 Watch cardinality

Estimate distinct keys and group sizes.

## 35.6 Push aggregation upstream when data large

Database/SQL, search engine aggregation, streaming engine.

## 35.7 Be explicit with duplicate policy

Especially toMap.

## 35.8 Avoid full group sort for top-N

Use bounded structures for large groups.

## 35.9 Make API results immutable

At service boundaries, prefer defensive copies.

---

# 36. Decision Matrix

| Need | Pattern |
|---|---|
| all elements by key | `groupingBy(k)` |
| count by key | `groupingBy(k, counting())` |
| sum int by key | `groupingBy(k, summingInt(...))` |
| sum long/money minor units by key | `groupingBy(k, summingLong(...))` |
| average by key | `groupingBy(k, averagingDouble/Int/Long(...))` |
| stats by key | `groupingBy(k, summarizingInt/Long/Double(...))` |
| projected values by key | `groupingBy(k, mapping(..., downstream))` |
| filtered values while preserving groups | `groupingBy(k, filtering(..., downstream))` |
| nested values flattened per key | `groupingBy(k, flatMapping(..., downstream))` |
| boolean split | `partitioningBy(predicate)` |
| two-level hierarchy | nested `groupingBy` |
| flat report with multiple dimensions | composite key record |
| latest per key | `toMap(k, identity, maxBy(...))` |
| first/last per key | `toMap(k, identity, merge, LinkedHashMap::new)` |
| unique values per key | `groupingBy(k, mapping(v, toSet()))` |
| ordered unique values per key | `toCollection(LinkedHashSet::new)` downstream |
| key order matters | groupingBy with map supplier |
| enum key groups | groupingBy with EnumMap supplier |
| parallel unordered grouping | consider `groupingByConcurrent` |
| huge data in DB | SQL `GROUP BY`, not Java grouping |
| unbounded events | streaming engine/windowed aggregation |
| top-N small groups | group list + sort + limit |
| top-N large groups | custom bounded heap collector |

---

# 37. Latihan

## Latihan 1 — Count by Status

Given orders, produce `Map<OrderStatus, Long>`.

## Latihan 2 — Total by Customer

Produce `Map<CustomerId, Long>` total cents.

## Latihan 3 — Group Mapping

Group users by role into `Set<String>` emails.

## Latihan 4 — Downstream Filtering

Compare upstream filter vs downstream filtering for active users by role.

## Latihan 5 — FlatMapping

Group orders by customer and collect all product IDs from order lines.

## Latihan 6 — Multi-Level vs Composite Key

Build both:

```java
Map<Department, Map<Role, Long>>
Map<DeptRole, Long>
```

Explain consumer differences.

## Latihan 7 — Histogram

Create age bucket histogram.

## Latihan 8 — Latest per Customer

Use `toMap` merge with `BinaryOperator.maxBy`.

## Latihan 9 — Immutable Groups

Make `Map<Role, List<User>>` where each list is immutable.

## Latihan 10 — High Cardinality Design

Given 10 million events grouped by request ID, explain memory risk and propose better architecture.

---

# 38. Ringkasan

Grouping and aggregation are classify + bucket + reduce.

Core lessons:

- `groupingBy(classifier)` defaults to `Map<K, List<T>>`.
- Use downstream collectors to avoid unnecessary list materialization.
- `counting`, `summing`, `averaging`, and `summarizing` are essential aggregation tools.
- `mapping` projects values per group.
- `filtering` filters inside each group and differs from upstream filter.
- `flatMapping` handles nested values per group.
- `collectingAndThen` can make group values immutable.
- Multi-level grouping creates nested maps.
- Composite keys are often better for flat reports.
- Histograms are grouping + counting.
- Rollups are grouping over derived dimensions.
- Top-N per group requires care; full sort per group can be expensive.
- `toMap` with merge is often better for latest/first/last one value per key.
- `partitioningBy` is boolean grouping.
- `groupingByConcurrent` is for unordered concurrent grouping, not deterministic ordered output.
- Map supplier controls key map type/order.
- High-cardinality grouping can cause memory blow-up.
- Large DB-backed aggregation should often be pushed to SQL or a streaming engine.

Main rule:

```text
Never write groupingBy by reflex.
First define: key cardinality, output value type, ordering, memory budget, duplicate policy, and whether aggregation belongs in Java at all.
```

---

# 39. Referensi

1. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

2. Java SE 25 — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

3. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

4. Java SE 25 — `ConcurrentMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentMap.html

5. Java SE 25 — `IntSummaryStatistics`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/IntSummaryStatistics.html

6. Java SE 25 — `LongSummaryStatistics`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LongSummaryStatistics.html

7. dev.java — Using a Collector as a Terminal Operation  
   https://dev.java/learn/using-a-collector-as-a-terminal-operation/

8. dev.java — Reductions  
   https://dev.java/learn/api/streams/reducing/

9. OpenJDK — `Collectors.java` Source  
   https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/stream/Collectors.java

10. Java SE 25 — `BinaryOperator`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/BinaryOperator.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-031.md](./learn-java-collections-and-streams-part-031.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-033.md](./learn-java-collections-and-streams-part-033.md)

</div>
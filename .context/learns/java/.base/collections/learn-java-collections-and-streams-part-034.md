# learn-java-collections-and-streams-part-034.md

# Java Collections and Streams — Part 034  
# Stream Ordering and Encounter Order: Ordered Sources, Unordered Sources, Sorted Order, `unordered()`, `findFirst`, `findAny`, `limit`, `skip`, `distinct`, `forEachOrdered`, Collectors, and Parallel Performance

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **034**  
> Fokus: memahami **encounter order** sebagai properti penting stream yang memengaruhi correctness, determinism, performance, dan parallel execution. Kita akan membedah ordered source, unordered source, sorted order, insertion order, access order, `BaseStream.unordered()`, `forEach` vs `forEachOrdered`, `findFirst` vs `findAny`, `limit`, `skip`, `distinct`, collectors, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Encounter Order = Urutan Element Dilihat oleh Stream](#2-mental-model-encounter-order--urutan-element-dilihat-oleh-stream)
3. [Encounter Order vs Sorted Order vs Insertion Order](#3-encounter-order-vs-sorted-order-vs-insertion-order)
4. [Ordered Sources](#4-ordered-sources)
5. [Unordered Sources](#5-unordered-sources)
6. [How Intermediate Operations Affect Order](#6-how-intermediate-operations-affect-order)
7. [`sorted()` Imposes Order](#7-sorted-imposes-order)
8. [`unordered()` Removes Order Constraint](#8-unordered-removes-order-constraint)
9. [`distinct()` and Order](#9-distinct-and-order)
10. [`limit()` and Order](#10-limit-and-order)
11. [`skip()` and Order](#11-skip-and-order)
12. [`takeWhile()` and `dropWhile()` and Order](#12-takewhile-and-dropwhile-and-order)
13. [`findFirst()` vs `findAny()`](#13-findfirst-vs-findany)
14. [`forEach()` vs `forEachOrdered()`](#14-foreach-vs-foreachordered)
15. [`toList()`, `toArray()`, and Order](#15-tolist-toarray-and-order)
16. [Collectors and Order](#16-collectors-and-order)
17. [Map and Set Collectors: Order Pitfalls](#17-map-and-set-collectors-order-pitfalls)
18. [LinkedHashMap, TreeMap, LinkedHashSet, TreeSet](#18-linkedhashmap-treemap-linkedhashset-treeset)
19. [Parallel Streams and Order Cost](#19-parallel-streams-and-order-cost)
20. [Ordered Parallel `limit`/`skip` Cost](#20-ordered-parallel-limitskip-cost)
21. [Unordered Parallel Optimization](#21-unordered-parallel-optimization)
22. [Concurrent Sources and Weak Consistency](#22-concurrent-sources-and-weak-consistency)
23. [HashMap/HashSet Order Trap](#23-hashmaphashset-order-trap)
24. [Testing and Determinism](#24-testing-and-determinism)
25. [API Output Ordering Contracts](#25-api-output-ordering-contracts)
26. [Database Result Order Analogy](#26-database-result-order-analogy)
27. [Production Diagnostics](#27-production-diagnostics)
28. [Common Anti-Patterns](#28-common-anti-patterns)
29. [Production Failure Modes](#29-production-failure-modes)
30. [Best Practices](#30-best-practices)
31. [Decision Matrix](#31-decision-matrix)
32. [Latihan](#32-latihan)
33. [Ringkasan](#33-ringkasan)
34. [Referensi](#34-referensi)

---

# 1. Tujuan Bagian Ini

Stream order sering terlihat seperti detail kecil.

Padahal order memengaruhi:

- correctness;
- deterministic output;
- test stability;
- API response order;
- performance;
- parallel stream scalability;
- behavior of `findFirst`;
- behavior of `limit`;
- behavior of `skip`;
- behavior of `takeWhile`;
- behavior of `dropWhile`;
- behavior of `forEachOrdered`;
- output collection ordering.

Contoh sederhana:

```java
Set<String> names = new HashSet<>(List.of("B", "A", "C"));

List<String> result = names.stream()
    .limit(2)
    .toList();
```

Apa hasilnya?

Tidak boleh diasumsikan:

```text
[B, A]
```

atau:

```text
[A, B]
```

Karena `HashSet` tidak punya encounter order bermakna.

Tujuan part ini:

- memahami encounter order;
- membedakan ordered/unordered source;
- memahami operasi yang preserve/impose/remove order;
- memahami order-sensitive terminal operations;
- memahami order cost di parallel stream;
- memahami output contract untuk collectors;
- menghindari bug nondeterministic.

---

# 2. Mental Model: Encounter Order = Urutan Element Dilihat oleh Stream

Encounter order adalah urutan element yang disajikan source kepada stream pipeline.

```text
source encounter order -> stream operation -> terminal result
```

## 2.1 List example

```java
List<String> list = List.of("A", "B", "C");
list.stream()
```

Encounter order:

```text
A, B, C
```

## 2.2 HashSet example

```java
Set<String> set = new HashSet<>(List.of("A", "B", "C"));
set.stream()
```

No defined encounter order.

Walaupun output di mesinmu terlihat stabil, itu bukan kontrak yang boleh diandalkan.

## 2.3 TreeSet example

```java
Set<String> set = new TreeSet<>(List.of("B", "A", "C"));
set.stream()
```

Encounter order:

```text
A, B, C
```

because TreeSet iteration is sorted order.

## 2.4 Main rule

```text
Encounter order is a stream property inherited from source and modified by operations.
```

---

# 3. Encounter Order vs Sorted Order vs Insertion Order

Istilah ini sering tercampur.

## 3.1 Encounter order

Urutan stream melihat element.

## 3.2 Insertion order

Urutan element dimasukkan ke collection.

Examples:

```java
LinkedHashSet
LinkedHashMap
```

## 3.3 Sorted order

Urutan berdasarkan comparator/natural ordering.

Examples:

```java
TreeSet
TreeMap
stream.sorted()
```

## 3.4 Access order

`LinkedHashMap` bisa dibuat access-order untuk LRU-like behavior.

Encounter order dari `linkedHashMap.entrySet().stream()` mengikuti iteration order map tersebut.

## 3.5 Rule

Encounter order is what stream sees; its origin can be insertion, sorted, index, access, or none.

---

# 4. Ordered Sources

Sources with defined encounter order include:

## 4.1 List

```java
ArrayList
LinkedList
List.of(...)
```

Order = list index order.

## 4.2 Arrays

```java
Arrays.stream(array)
```

Order = array index order.

## 4.3 Ranges

```java
IntStream.range(0, 10)
```

Order = numeric ascending sequence.

## 4.4 LinkedHashSet

Order = insertion order.

## 4.5 TreeSet

Order = sorted order.

## 4.6 LinkedHashMap views

```java
linkedHashMap.entrySet().stream()
```

Order = map iteration order.

## 4.7 TreeMap views

Order = key sorted order.

## 4.8 Rule

If order matters, choose ordered source intentionally.

---

# 5. Unordered Sources

Sources without defined encounter order include:

## 5.1 HashSet

```java
hashSet.stream()
```

## 5.2 HashMap views

```java
hashMap.entrySet().stream()
```

## 5.3 Many concurrent collection views

They may have weakly consistent traversal and no meaningful encounter order contract.

## 5.4 Generated streams

Some generated streams can be unordered depending source and operation.

## 5.5 Rule

If source is unordered, downstream order-sensitive operation has no business-stable order to preserve.

---

# 6. How Intermediate Operations Affect Order

Intermediate operations can:

## 6.1 Preserve order

Most stateless operations preserve encounter order:

```java
filter
map
flatMap
mapMulti
peek
```

If source order is A, B, C, output order follows surviving/transformed sequence.

## 6.2 Impose order

```java
sorted()
```

can impose sorted order.

## 6.3 Remove order constraint

```java
unordered()
```

declares order no longer needed.

## 6.4 Stateful operations

```java
distinct
limit
skip
takeWhile
dropWhile
```

may be order-sensitive.

## 6.5 Rule

Ask whether an operation preserves, imposes, depends on, or removes encounter order.

---

# 7. `sorted()` Imposes Order

`sorted()` sorts elements.

## 7.1 Natural order

```java
stream.sorted()
```

## 7.2 Comparator

```java
stream.sorted(Comparator.comparing(User::name))
```

## 7.3 On unordered stream

`sorted()` creates ordered output by sort order.

```java
hashSet.stream()
    .sorted()
    .toList();
```

## 7.4 Cost

Sorted is stateful and usually buffers all elements.

## 7.5 Rule

Use `sorted()` when sorted output is required, not just to make tests pass casually.

---

# 8. `unordered()` Removes Order Constraint

`unordered()` does not shuffle.

It removes the obligation to preserve encounter order.

```java
stream.unordered()
```

## 8.1 Why useful

In parallel streams, removing order can improve performance for some operations:

- `distinct`;
- `limit`;
- `skip`;
- `findAny`;
- some collectors.

## 8.2 Not random

Unordered means:

```text
order no longer semantically required
```

not:

```text
randomize elements
```

## 8.3 Use only when correct

If API response order matters, do not call unordered.

## 8.4 Rule

Use unordered only when any order is semantically acceptable.

---

# 9. `distinct()` and Order

`distinct()` removes duplicates.

## 9.1 Ordered stream

For ordered streams, `distinct()` preserves first occurrence order.

Example:

```java
List.of("B", "A", "B", "C").stream()
    .distinct()
    .toList();
```

Result:

```text
B, A, C
```

## 9.2 Unordered stream

No first occurrence guarantee because encounter order is not meaningful.

## 9.3 Parallel cost

Preserving stability for ordered parallel distinct can be expensive.

## 9.4 Optimization

If order does not matter:

```java
stream.unordered().distinct()
```

may allow more efficient execution.

## 9.5 Rule

Ordered distinct means first occurrence wins. Unordered distinct means unique set semantics without stable order.

---

# 10. `limit()` and Order

`limit(n)` takes first n elements in encounter order for ordered streams.

## 10.1 Ordered source

```java
List.of("A", "B", "C").stream()
    .limit(2)
    .toList();
```

Result:

```text
A, B
```

## 10.2 Unordered source

```java
hashSet.stream()
    .limit(2)
```

Any two elements.

## 10.3 Parallel cost

Ordered parallel limit may require coordination to ensure first n by encounter order.

## 10.4 Rule

`limit` means “first n” only when encounter order is defined and preserved.

---

# 11. `skip()` and Order

`skip(n)` discards first n elements in encounter order for ordered streams.

## 11.1 Ordered source

```java
List.of("A", "B", "C").stream()
    .skip(1)
    .toList();
```

Result:

```text
B, C
```

## 11.2 Unordered source

Skips arbitrary n elements.

## 11.3 Pagination caution

```java
stream.skip(offset).limit(size)
```

is in-memory slicing, not database pagination.

## 11.4 Rule

Skip is meaningful only relative to encounter order.

---

# 12. `takeWhile()` and `dropWhile()` and Order

These are prefix-based operations.

## 12.1 takeWhile

```java
List.of(1, 2, 100, 3).stream()
    .takeWhile(n -> n < 10)
    .toList();
```

Result:

```text
1, 2
```

not:

```text
1, 2, 3
```

## 12.2 dropWhile

```java
List.of(1, 2, 100, 3).stream()
    .dropWhile(n -> n < 10)
    .toList();
```

Result:

```text
100, 3
```

## 12.3 Unordered stream

Prefix semantics are not meaningful in the same way.

## 12.4 Rule

`takeWhile`/`dropWhile` are order-dependent prefix operations, not global filter operations.

---

# 13. `findFirst()` vs `findAny()`

## 13.1 findFirst

Returns first element in encounter order if order exists.

```java
Optional<User> first = users.stream()
    .filter(User::active)
    .findFirst();
```

## 13.2 findAny

Returns any element.

```java
Optional<User> any = users.parallelStream()
    .filter(User::active)
    .findAny();
```

## 13.3 Parallel performance

`findAny` can be more flexible in parallel because it need not coordinate to find the first encounter-order element.

## 13.4 Use rule

- use `findFirst` if first is meaningful;
- use `findAny` if any matching element is acceptable.

## 13.5 Rule

Do not use findFirst by habit; it may impose unnecessary order constraints.

---

# 14. `forEach()` vs `forEachOrdered()`

## 14.1 forEach

```java
stream.forEach(action)
```

In parallel, action may run in nondeterministic order.

## 14.2 forEachOrdered

```java
stream.forEachOrdered(action)
```

Preserves encounter order when stream has one.

## 14.3 Cost

`forEachOrdered` can reduce parallelism.

## 14.4 Source unordered

If stream has no defined encounter order, ordered output still has no domain-stable order.

## 14.5 Rule

Use `forEachOrdered` only when ordered side effect is required.

---

# 15. `toList()`, `toArray()`, and Order

## 15.1 Ordered stream

```java
list.stream()
    .map(...)
    .toList()
```

preserves encounter order in result list.

## 15.2 Unordered stream

Result list has whatever traversal order stream provides; not domain-stable.

## 15.3 toArray

Also follows stream encounter order where defined.

## 15.4 Rule

Materialized sequence outputs are deterministic only if stream encounter order is deterministic.

---

# 16. Collectors and Order

Collector order behavior depends on:

- source order;
- stream ordered/unordered status;
- collector characteristics;
- result container type;
- parallel/concurrent behavior.

## 16.1 joining

Concatenates in encounter order for ordered streams.

## 16.2 toList

Preserves encounter order for ordered streams.

## 16.3 toSet

No order guarantee.

## 16.4 groupingBy

Map key order depends on map implementation. Group value list order depends on downstream collector/source order.

## 16.5 Rule

Collectors can preserve, discard, or transform order depending on collector and container.

---

# 17. Map and Set Collectors: Order Pitfalls

## 17.1 toSet

```java
stream.collect(Collectors.toSet())
```

Do not expect insertion order.

## 17.2 toMap

Default map type/order not part of contract.

## 17.3 groupingBy

Default map order should not be exposed as API contract.

## 17.4 Fix

Use explicit suppliers:

```java
Collectors.toCollection(LinkedHashSet::new)
Collectors.toMap(k, v, merge, LinkedHashMap::new)
Collectors.groupingBy(k, LinkedHashMap::new, downstream)
```

## 17.5 Rule

If order matters, never rely on default Set/Map collector output.

---

# 18. LinkedHashMap, TreeMap, LinkedHashSet, TreeSet

## 18.1 LinkedHashMap

Preserves insertion/encounter order for map entries.

## 18.2 TreeMap

Sorts keys.

## 18.3 LinkedHashSet

Preserves insertion/encounter order for unique values.

## 18.4 TreeSet

Sorts values.

## 18.5 Example

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        LinkedHashMap::new,
        Collectors.toList()
    ));
```

## 18.6 Rule

Use collection/map type to encode output order contract.

---

# 19. Parallel Streams and Order Cost

Order preservation can be expensive in parallel.

## 19.1 Why

Parallel stream splits data into partitions.

If result must preserve encounter order, framework must coordinate partition ordering.

## 19.2 Operations affected

- `forEachOrdered`;
- `findFirst`;
- ordered `limit`;
- ordered `skip`;
- stable `distinct`;
- ordered collection result.

## 19.3 Sometimes worth it

If correctness requires order, pay the cost.

## 19.4 Rule

Parallel stream with order constraints can lose much of parallel benefit.

---

# 20. Ordered Parallel `limit`/`skip` Cost

## 20.1 Ordered limit

Must return first n elements in encounter order.

This may require processing/coordinating earlier partitions.

## 20.2 Ordered skip

Must discard first n elements in encounter order.

Can be expensive for large skip.

## 20.3 Optimization if order irrelevant

```java
stream.parallel()
    .unordered()
    .limit(100)
```

## 20.4 Rule

Ordered slicing in parallel is a coordination-heavy operation.

---

# 21. Unordered Parallel Optimization

When order does not matter, call:

```java
unordered()
```

Examples:

## 21.1 Any matching element

```java
users.parallelStream()
    .unordered()
    .filter(User::active)
    .findAny();
```

## 21.2 Any 100 items

```java
items.parallelStream()
    .unordered()
    .limit(100)
    .toList();
```

## 21.3 Distinct set-like result

```java
items.parallelStream()
    .unordered()
    .distinct()
    .toList();
```

Only if output order does not matter.

## 21.4 Rule

Unordered is a performance lever only when semantics allow it.

---

# 22. Concurrent Sources and Weak Consistency

Concurrent collections often provide weakly consistent traversal.

Example:

```java
ConcurrentHashMap.newKeySet().stream()
```

## 22.1 Safe structurally

Traversal can proceed during concurrent mutation.

## 22.2 Not snapshot

May reflect some updates and not others.

## 22.3 Order

No stable encounter order for business output.

## 22.4 If deterministic output needed

Snapshot and sort:

```java
List<T> snapshot = concurrentSet.stream()
    .sorted(comparator)
    .toList();
```

## 22.5 Rule

Concurrent source safety is not the same as deterministic ordered snapshot.

---

# 23. HashMap/HashSet Order Trap

HashMap/HashSet iteration may look stable in small tests.

But it is not a contract for business order.

## 23.1 Bad

```java
List<String> result = hashSet.stream().toList();
assertEquals(List.of("A", "B", "C"), result);
```

## 23.2 Better

If order needed:

```java
hashSet.stream()
    .sorted()
    .toList();
```

or use ordered source:

```java
LinkedHashSet
TreeSet
```

## 23.3 Rule

Never write tests/API logic depending on HashMap/HashSet iteration order.

---

# 24. Testing and Determinism

## 24.1 If order matters

Assert exact sequence.

Use ordered source and explicit sorted/order collector.

## 24.2 If order does not matter

Assert as set/multiset.

```java
assertThat(result).containsExactlyInAnyOrder(...)
```

## 24.3 Avoid flaky tests

Flaky stream tests often come from hidden order assumptions.

## 24.4 Rule

Test should match order contract: ordered assertion for ordered contract, unordered assertion for unordered contract.

---

# 25. API Output Ordering Contracts

API response order must be explicit.

## 25.1 Bad

```java
return users.stream()
    .collect(Collectors.toSet());
```

then JSON serializes arbitrary set order.

## 25.2 Better

```java
return users.stream()
    .sorted(Comparator.comparing(User::name))
    .toList();
```

## 25.3 Map output

If JSON map order matters for clients/reports:

```java
LinkedHashMap
TreeMap
```

## 25.4 Rule

Do not expose accidental collection iteration order as API behavior.

---

# 26. Database Result Order Analogy

SQL result order is not guaranteed without `ORDER BY`.

Likewise:

```java
HashSet.stream().toList()
```

has no meaningful order contract.

## 26.1 SQL

```sql
SELECT * FROM users;
```

No order guarantee.

```sql
SELECT * FROM users ORDER BY name;
```

Order specified.

## 26.2 Java stream

```java
users.stream().toList()
```

Order depends on source.

```java
users.stream().sorted(comparator).toList()
```

Order specified.

## 26.3 Rule

If order matters, state it explicitly.

---

# 27. Production Diagnostics

When output order bug appears, check:

## 27.1 Source type

List? HashSet? HashMap? ConcurrentHashMap?

## 27.2 Intermediate operations

Was `unordered()` called?

Was `sorted()` applied?

## 27.3 Terminal operation

`forEach` or `forEachOrdered`?

`findFirst` or `findAny`?

## 27.4 Collector

`toSet`, `toMap`, `groupingBy` defaults?

## 27.5 Parallel

Parallel stream may expose nondeterminism.

## 27.6 Rule

Order bugs are found by tracing source -> intermediate ops -> terminal/container.

---

# 28. Common Anti-Patterns

## 28.1 Relying on HashSet stream order

Bad.

## 28.2 Using findFirst on unordered source

Misleading.

## 28.3 Using findFirst when findAny is enough

Unnecessary order cost.

## 28.4 Using forEach in parallel for ordered output

Bad.

## 28.5 Using toSet then expecting JSON order

Bad.

## 28.6 Using groupingBy default map order in API

Bad.

## 28.7 Calling unordered while order is required

Correctness bug.

## 28.8 Sorting huge data just to make tests deterministic

Maybe better choose ordered source or adjust test.

## 28.9 limit/skip on unordered source for pagination

Wrong.

## 28.10 Rule

Most order bugs are accidental contracts.

---

# 29. Production Failure Modes

## 29.1 Flaky tests

Cause: unordered source but ordered assertion.

## 29.2 Inconsistent API response

Cause: HashMap/HashSet iteration order exposed.

## 29.3 Wrong “first” item

Cause: `findFirst` on unordered source.

## 29.4 Slow parallel stream

Cause: order-preserving operations.

## 29.5 Pagination bug

Cause: `skip/limit` on unordered or unstable source.

## 29.6 Missing deterministic winner

Cause: max/min comparator without tie-breaker.

## 29.7 Report rows shuffled

Cause: groupingBy default map.

## 29.8 Duplicate distinct order surprise

Cause: unordered distinct.

## 29.9 forEach side effects out of order

Cause: parallel forEach.

## 29.10 Concurrent snapshot inconsistency

Cause: concurrent source stream not snapshot.

---

# 30. Best Practices

## 30.1 State order contract explicitly

At API/service boundaries.

## 30.2 Use ordered source when order matters

List, LinkedHashSet, TreeSet, LinkedHashMap, TreeMap.

## 30.3 Sort explicitly for business order

```java
sorted(comparator)
```

## 30.4 Use map/set suppliers

LinkedHashMap, TreeMap, LinkedHashSet, TreeSet.

## 30.5 Use findAny when any is enough

Especially parallel.

## 30.6 Avoid ordered parallel operations unless needed

Measure.

## 30.7 Test correctly

Ordered contract -> exact assertion.

Unordered contract -> order-insensitive assertion.

## 30.8 Snapshot concurrent sources when deterministic report needed

Then sort.

---

# 31. Decision Matrix

| Requirement | Recommended |
|---|---|
| preserve list order | ordered source + `toList()` |
| sorted output | `sorted(comparator)` |
| unique preserving encounter order | `distinct()` on ordered stream or `LinkedHashSet` collector |
| unique no order needed | `unordered().distinct()` if beneficial |
| first meaningful element | `findFirst()` on ordered stream |
| any matching element | `findAny()` |
| ordered side effect | `forEachOrdered()` |
| unordered side effect | `forEach()` |
| first page from list | `skip/limit` on ordered list stream |
| database page | SQL/order at database, not stream over full table |
| ordered map output | `LinkedHashMap` supplier |
| sorted map keys | `TreeMap` supplier |
| ordered unique set | `LinkedHashSet` |
| sorted unique set | `TreeSet` |
| parallel any N elements | `parallel().unordered().limit(n)` |
| deterministic concurrent collection report | snapshot + sort |
| group key order | `groupingBy(..., LinkedHashMap::new, downstream)` |
| enum key order | `EnumMap` supplier |
| order irrelevant test | assert ignoring order |
| API stable order | document and enforce order |

---

# 32. Latihan

## Latihan 1 — Source Order

Compare stream output from:

```java
ArrayList
HashSet
LinkedHashSet
TreeSet
```

## Latihan 2 — HashSet Limit

Use `HashSet.stream().limit(2)`.

Explain why result should not be relied on.

## Latihan 3 — distinct Stability

Compare distinct on ordered list vs unordered set.

## Latihan 4 — findFirst vs findAny

Use parallel stream and explain semantic difference.

## Latihan 5 — forEach vs forEachOrdered

Print ordered list using parallel stream with both terminals.

## Latihan 6 — toSet Order Trap

Collect to `toSet` and then to `LinkedHashSet`.

Compare iteration order.

## Latihan 7 — groupingBy Map Order

Group users by role with default map, then LinkedHashMap supplier.

## Latihan 8 — Pagination

Implement skip/limit over ordered list.

Explain why same over HashSet is invalid.

## Latihan 9 — Concurrent Source

Stream over ConcurrentHashMap keySet while mutating.

Explain weak consistency.

## Latihan 10 — API Contract

Design API response sorted by `createdAt desc, id asc`.

Implement stream pipeline and tests.

---

# 33. Ringkasan

Encounter order is a core stream property.

Core lessons:

- Encounter order is the order stream sees elements.
- List/arrays/ranges are ordered.
- HashSet/HashMap are not business-ordered.
- TreeSet/TreeMap encounter order is sorted order.
- LinkedHashSet/LinkedHashMap encounter order is insertion/access iteration order.
- Most stateless ops preserve order.
- `sorted()` imposes order.
- `unordered()` removes order constraint, not randomizes.
- `distinct()` is stable for ordered streams.
- `limit`/`skip` depend on encounter order.
- `takeWhile`/`dropWhile` are prefix operations.
- `findFirst` is order-sensitive; `findAny` is more flexible.
- `forEach` is not ordered in parallel; `forEachOrdered` is.
- Collector output order depends on collector and container.
- Use LinkedHashMap/TreeMap/LinkedHashSet/TreeSet when order is part of contract.
- Parallel order preservation can be expensive.
- Concurrent source stream is not deterministic snapshot.
- Do not expose accidental HashMap/HashSet order as API behavior.

Main rule:

```text
If order matters, make it explicit.
If order does not matter, do not pay for it.
```

---

# 34. Referensi

1. Java SE 25 — `java.util.stream` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

2. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

3. Java SE 25 — `BaseStream.unordered`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/BaseStream.html#unordered()

4. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

5. Java SE 25 — `LinkedHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedHashMap.html

6. Java SE 25 — `TreeMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeMap.html

7. Java SE 25 — `LinkedHashSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedHashSet.html

8. Java SE 25 — `TreeSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeSet.html

9. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

10. OpenJDK — `Collectors.java` Source  
    https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/stream/Collectors.java

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-033.md](./learn-java-collections-and-streams-part-033.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-035.md](./learn-java-collections-and-streams-part-035.md)

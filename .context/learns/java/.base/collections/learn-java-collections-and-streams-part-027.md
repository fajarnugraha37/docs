# learn-java-collections-and-streams-part-027.md

# Java Collections and Streams — Part 027  
# Terminal Operations Deep Dive: forEach, forEachOrdered, toList, collect, reduce, count, min, max, matching, finding, arrays, Optional, Side Effects, Ordering, and Reduction Correctness

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **027**  
> Fokus: memahami terminal operations sebagai titik di mana stream pipeline benar-benar dieksekusi. Kita akan membedah result-producing vs side-effect terminal operations, short-circuiting terminals, ordering semantics, `Optional`, `reduce`, `collect`, `toList`, `toArray`, matching/finding, dan failure mode production.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Terminal Operation Mengeksekusi Pipeline](#2-mental-model-terminal-operation-mengeksekusi-pipeline)
3. [Terminal Operation Categories](#3-terminal-operation-categories)
4. [One Terminal Operation Only](#4-one-terminal-operation-only)
5. [`forEach`](#5-foreach)
6. [`forEachOrdered`](#6-foreachordered)
7. [`toList`](#7-tolist)
8. [`collect`](#8-collect)
9. [`toArray`](#9-toarray)
10. [`reduce`](#10-reduce)
11. [Reduction Correctness: Identity, Associativity, Compatibility](#11-reduction-correctness-identity-associativity-compatibility)
12. [`count`](#12-count)
13. [`min` and `max`](#13-min-and-max)
14. [`anyMatch`, `allMatch`, `noneMatch`](#14-anymatch-allmatch-nonematch)
15. [`findFirst` and `findAny`](#15-findfirst-and-findany)
16. [`iterator` and `spliterator` Terminal Escape Hatches](#16-iterator-and-spliterator-terminal-escape-hatches)
17. [`Optional` Results](#17-optional-results)
18. [Terminal Operations and Encounter Order](#18-terminal-operations-and-encounter-order)
19. [Terminal Operations and Parallel Streams](#19-terminal-operations-and-parallel-streams)
20. [Terminal Operations and Side Effects](#20-terminal-operations-and-side-effects)
21. [Terminal Operations and Infinite Streams](#21-terminal-operations-and-infinite-streams)
22. [Terminal Operations and Resource-Backed Streams](#22-terminal-operations-and-resource-backed-streams)
23. [Terminal Operations and Null](#23-terminal-operations-and-null)
24. [Choosing Between `toList`, `collect(toList)`, and `collect(toCollection)`](#24-choosing-between-tolist-collecttolist-and-collecttocollection)
25. [Choosing Between `reduce` and `collect`](#25-choosing-between-reduce-and-collect)
26. [Choosing Between `forEach` and `collect`](#26-choosing-between-foreach-and-collect)
27. [Performance Cost Model](#27-performance-cost-model)
28. [Common Anti-Patterns](#28-common-anti-patterns)
29. [Production Failure Modes](#29-production-failure-modes)
30. [Best Practices](#30-best-practices)
31. [Decision Matrix](#31-decision-matrix)
32. [Latihan](#32-latihan)
33. [Ringkasan](#33-ringkasan)
34. [Referensi](#34-referensi)

---

# 1. Tujuan Bagian Ini

Intermediate operation hanya menyusun rencana.

Terminal operation yang mengeksekusi rencana itu.

Contoh:

```java
List<String> emails = users.stream()
    .filter(User::active)
    .map(User::email)
    .toList();
```

`filter` dan `map` belum bekerja sebelum terminal operation.

`toList()` memulai traversal source dan menjalankan pipeline.

Terminal operations mencakup:

```java
forEach
forEachOrdered
toList
collect
toArray
reduce
count
min
max
anyMatch
allMatch
noneMatch
findFirst
findAny
iterator
spliterator
```

Tujuan part ini:

- memahami kapan pipeline berjalan;
- memahami jenis terminal operations;
- memahami side-effect vs result terminal;
- memahami short-circuiting terminal;
- memahami ordering;
- memahami `Optional`;
- memahami `reduce` correctness;
- memahami kapan pakai `collect`;
- memahami production failure modes.

---

# 2. Mental Model: Terminal Operation Mengeksekusi Pipeline

Stream pipeline:

```text
source -> intermediate ops -> terminal op
```

Terminal operation:

1. starts traversal;
2. pulls elements from source;
3. applies intermediate stages;
4. produces result or side-effect;
5. consumes stream;
6. closes pipeline logically.

## 2.1 Example

```java
long count = names.stream()
    .filter(name -> name.length() > 3)
    .count();
```

`count()` causes:

```text
source traversal
filter evaluation
count accumulation
```

## 2.2 No terminal, no execution

```java
names.stream()
    .filter(this::isValid)
    .map(this::normalize);
```

This does not process elements.

## 2.3 Rule

```text
Terminal operation is the trigger point of stream execution.
```

---

# 3. Terminal Operation Categories

## 3.1 Side-effect terminal

```java
forEach
forEachOrdered
```

They perform actions and return void.

## 3.2 Materialization terminal

```java
toList
collect
toArray
```

They build a result container/array.

## 3.3 Reduction terminal

```java
reduce
count
min
max
sum // primitive streams
average // primitive streams
summaryStatistics // primitive streams
```

They aggregate many elements into one value.

## 3.4 Matching terminal

```java
anyMatch
allMatch
noneMatch
```

They return boolean and can short-circuit.

## 3.5 Finding terminal

```java
findFirst
findAny
```

They return Optional and can short-circuit.

## 3.6 Escape hatch terminal

```java
iterator
spliterator
```

They hand traversal control back to caller.

## 3.7 Rule

Terminal operation choice defines final semantics, memory use, and execution behavior.

---

# 4. One Terminal Operation Only

A stream is normally consumable once.

## 4.1 Bad

```java
Stream<User> active = users.stream().filter(User::active);

long count = active.count();
List<User> list = active.toList(); // IllegalStateException
```

## 4.2 Better

Create new stream:

```java
long count = users.stream().filter(User::active).count();
List<User> list = users.stream().filter(User::active).toList();
```

or materialize once:

```java
List<User> activeUsers = users.stream()
    .filter(User::active)
    .toList();

long count = activeUsers.size();
```

## 4.3 Rule

Do not store streams as reusable values.

---

# 5. `forEach`

`forEach` performs action for each element.

```java
stream.forEach(action)
```

## 5.1 Example

```java
users.stream()
    .forEach(user -> log.info("user={}", user.id()));
```

## 5.2 Side effect terminal

It returns void.

## 5.3 Ordering

For parallel streams, `forEach` does not guarantee encounter order execution.

## 5.4 Use cases

- logging;
- sending to external sink;
- invoking side-effecting consumer;
- bridging to legacy API.

## 5.5 Danger

Bad:

```java
List<String> emails = new ArrayList<>();

users.parallelStream()
    .map(User::email)
    .forEach(emails::add);
```

Race.

Better:

```java
List<String> emails = users.parallelStream()
    .map(User::email)
    .toList();
```

## 5.6 Rule

Use `forEach` only when side effects are the intended result and concurrency/order semantics are safe.

---

# 6. `forEachOrdered`

`forEachOrdered` performs action in encounter order if stream has defined encounter order.

```java
stream.forEachOrdered(action)
```

## 6.1 Example

```java
users.parallelStream()
    .map(User::email)
    .forEachOrdered(System.out::println);
```

## 6.2 Cost

Preserving order can reduce parallel benefits.

## 6.3 Use case

- ordered output;
- deterministic printing/writing;
- preserving sequence.

## 6.4 If source unordered

Encounter order may not be meaningful.

## 6.5 Rule

Use `forEachOrdered` when side effect order matters; expect possible performance cost.

---

# 7. `toList`

`Stream.toList()` materializes elements into a List.

```java
List<String> emails = users.stream()
    .map(User::email)
    .toList();
```

## 7.1 Result list

The returned list is unmodifiable.

## 7.2 Allows null?

`Stream.toList()` can return list containing null elements if stream has nulls.

## 7.3 Difference from collection ownership

The resulting list is materialized output, not the stream.

## 7.4 Mutability trap

Bad:

```java
List<String> emails = users.stream()
    .map(User::email)
    .toList();

emails.add("x"); // UnsupportedOperationException
```

## 7.5 Rule

Use `toList()` for simple unmodifiable list materialization.

---

# 8. `collect`

`collect` performs mutable reduction.

```java
<R, A> R collect(Collector<? super T, A, R> collector)
```

## 8.1 Examples

```java
Set<Role> roles = users.stream()
    .map(User::role)
    .collect(Collectors.toSet());

Map<UserId, User> byId = users.stream()
    .collect(Collectors.toMap(User::id, Function.identity()));
```

## 8.2 Collector parts

A collector has:

- supplier;
- accumulator;
- combiner;
- finisher;
- characteristics.

## 8.3 When use collect

- build Set;
- build Map;
- grouping;
- partitioning;
- joining;
- summarizing;
- custom mutable reduction.

## 8.4 Parallel

Collector combiner matters for parallel streams.

## 8.5 Rule

Use collect when result construction needs a collector strategy, especially Set/Map/grouping.

---

# 9. `toArray`

Materializes stream into array.

## 9.1 Object array

```java
Object[] arr = stream.toArray();
```

## 9.2 Typed array

```java
String[] arr = stream.toArray(String[]::new);
```

## 9.3 Use cases

- API requires array;
- interoperability;
- primitive stream arrays.

## 9.4 Primitive arrays

```java
int[] values = intStream.toArray();
```

## 9.5 Rule

Use generator overload for typed object arrays.

---

# 10. `reduce`

`reduce` combines stream elements into one result.

## 10.1 Optional reduce

```java
Optional<Integer> max = numbers.stream()
    .reduce(Integer::max);
```

## 10.2 Identity reduce

```java
int sum = numbers.stream()
    .reduce(0, Integer::sum);
```

## 10.3 Three-argument reduce

```java
U result = stream.reduce(identity, accumulator, combiner);
```

Important for parallel when result type differs.

## 10.4 Use cases

- immutable accumulation;
- mathematical reductions;
- combining values.

## 10.5 Do not use reduce for mutable containers

Bad:

```java
List<String> list = stream.reduce(
    new ArrayList<>(),
    (acc, x) -> { acc.add(x); return acc; },
    (a, b) -> { a.addAll(b); return a; }
);
```

Use collect.

## 10.6 Rule

Use reduce for immutable/value reductions; use collect for mutable containers.

---

# 11. Reduction Correctness: Identity, Associativity, Compatibility

Reduction must be correct, especially for parallel.

## 11.1 Identity

Identity must be neutral.

For sum:

```java
0
```

For multiplication:

```java
1
```

Bad identity:

```java
numbers.stream().reduce(10, Integer::sum)
```

adds 10 even for non-empty stream.

## 11.2 Associativity

Operation must be associative:

```text
(a op b) op c == a op (b op c)
```

Good:

```java
Integer::sum
```

Bad:

```java
(a, b) -> a - b
```

## 11.3 Compatibility

For three-arg reduce, combiner must be compatible with accumulator.

## 11.4 Parallel danger

Non-associative reduce can produce different results in parallel.

## 11.5 Rule

Reduction correctness requires identity and associativity discipline.

---

# 12. `count`

Counts elements.

```java
long count = stream.count();
```

## 12.1 Example

```java
long activeCount = users.stream()
    .filter(User::active)
    .count();
```

## 12.2 May optimize

For sized sources and no filtering, implementation may use size knowledge.

## 12.3 Infinite stream

```java
Stream.generate(...)
    .count()
```

never completes.

## 12.4 Rule

Use count for cardinality after pipeline filtering/transformation.

---

# 13. `min` and `max`

Find minimum/maximum according to comparator.

```java
Optional<User> oldest = users.stream()
    .min(Comparator.comparing(User::createdAt));
```

## 13.1 Better than sorted + findFirst

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

## 13.2 Return Optional

Empty stream -> Optional.empty.

## 13.3 Comparator must handle nulls if null possible

```java
Comparator.nullsLast(...)
```

## 13.4 Rule

Use min/max when you need one extremum, not full sorted output.

---

# 14. `anyMatch`, `allMatch`, `noneMatch`

Matching terminals return boolean and short-circuit.

## 14.1 anyMatch

```java
boolean hasAdmin = users.stream()
    .anyMatch(User::admin);
```

Stops at first true.

## 14.2 allMatch

```java
boolean allActive = users.stream()
    .allMatch(User::active);
```

Stops at first false.

For empty stream, returns true.

## 14.3 noneMatch

```java
boolean noBanned = users.stream()
    .noneMatch(User::banned);
```

Stops at first true.

For empty stream, returns true.

## 14.4 Vacuous truth

`allMatch` and `noneMatch` on empty stream return true.

## 14.5 Rule

Use matching terminals for existence/universal checks; remember empty-stream semantics.

---

# 15. `findFirst` and `findAny`

## 15.1 findFirst

Returns first element in encounter order.

```java
Optional<User> firstActive = users.stream()
    .filter(User::active)
    .findFirst();
```

## 15.2 findAny

Returns any element, useful for parallel/unordered streams.

```java
Optional<User> anyActive = users.parallelStream()
    .filter(User::active)
    .findAny();
```

## 15.3 Ordered cost

`findFirst` may constrain parallel execution.

## 15.4 Unordered source

For unordered source, first may not be meaningful.

## 15.5 Rule

Use `findFirst` for order-sensitive logic; use `findAny` when any match is acceptable.

---

# 16. `iterator` and `spliterator` Terminal Escape Hatches

These terminal operations return traversal objects.

```java
Iterator<T> iterator = stream.iterator();
Spliterator<T> spliterator = stream.spliterator();
```

## 16.1 Why escape hatch

They allow custom traversal not expressible by stream terminal operations.

## 16.2 Caveat

After calling, stream is consumed/owned by iterator/spliterator traversal.

## 16.3 Use sparingly

If you need iterator, maybe `Iterable`/collection is better API.

## 16.4 Rule

Use iterator/spliterator terminal operations for interop or advanced traversal, not common stream usage.

---

# 17. `Optional` Results

Some terminal operations return Optional:

```java
findFirst
findAny
min
max
reduce(BinaryOperator)
```

## 17.1 Why

Stream may be empty.

## 17.2 Good handling

```java
return users.stream()
    .filter(User::active)
    .findFirst()
    .orElseThrow();
```

## 17.3 Avoid get blindly

Bad:

```java
optional.get()
```

without checking.

## 17.4 Optional primitive

Primitive streams have:

```java
OptionalInt
OptionalLong
OptionalDouble
```

## 17.5 Rule

Optional result means absence is part of terminal semantics.

---

# 18. Terminal Operations and Encounter Order

Terminal operations differ in order sensitivity.

## 18.1 Order-sensitive

```java
findFirst
forEachOrdered
toList
toArray
collect to ordered collection
```

## 18.2 Less order-sensitive

```java
findAny
anyMatch
allMatch
noneMatch
count
min
max
```

## 18.3 forEach vs forEachOrdered

`forEach` may execute in nondeterministic order in parallel.

`forEachOrdered` preserves encounter order.

## 18.4 Rule

Choose terminal operation based on whether order is semantically required.

---

# 19. Terminal Operations and Parallel Streams

## 19.1 Safe if reduction correct

Parallel terminal operations require:

- stateless functions;
- non-interference;
- associative reductions;
- compatible collectors;
- no unsafe side effects.

## 19.2 Bad

```java
List<T> result = new ArrayList<>();
stream.parallel().forEach(result::add);
```

## 19.3 Good

```java
List<T> result = stream.parallel()
    .map(this::process)
    .toList();
```

## 19.4 Ordered terminal cost

`forEachOrdered` and `findFirst` can reduce parallel performance.

## 19.5 Rule

Parallel terminal correctness depends on operation semantics, not just thread-safe source.

---

# 20. Terminal Operations and Side Effects

## 20.1 Side effects are explicit in forEach

```java
stream.forEach(this::send);
```

## 20.2 Side effects in collect/reduce are wrong if hidden

Collectors handle mutation internally in controlled way.

External shared mutation is dangerous.

## 20.3 IO side effects

If sending emails/writing DB, stream may obscure retry/error handling.

## 20.4 Rule

If side effects are business-critical, prefer explicit control flow when error handling/lifecycle matters.

---

# 21. Terminal Operations and Infinite Streams

Some terminals can finish on infinite streams.

## 21.1 Can finish

```java
findFirst
findAny
anyMatch
allMatch // only if false eventually
noneMatch // only if true eventually
limit(...).toList()
```

## 21.2 Cannot finish

```java
count
toList
sorted().findFirst()
reduce without short-circuit
```

on unbounded infinite stream.

## 21.3 Rule

Infinite stream terminal must be short-circuiting or preceded by bounding operation.

---

# 22. Terminal Operations and Resource-Backed Streams

For resource-backed streams:

```java
try (Stream<String> lines = Files.lines(path)) {
    return lines.filter(...).count();
}
```

## 22.1 Terminal consumes resource

Terminal operation reads from file/resource.

## 22.2 Exceptions may happen during terminal

IO errors can occur while consuming stream.

## 22.3 Close required

Use try-with-resources.

## 22.4 Rule

Terminal operation is where resource-backed stream often performs actual IO.

---

# 23. Terminal Operations and Null

## 23.1 toList can contain null

If stream has nulls, result list may contain null.

## 23.2 findFirst/findAny and null

Streams should avoid null; finding null can cause issues because Optional cannot contain null result.

## 23.3 min/max with null

Comparator must handle null.

## 23.4 collect to unmodifiable collectors

Some collectors reject null.

## 23.5 Rule

Normalize null before terminal operation.

---

# 24. Choosing Between `toList`, `collect(toList)`, and `collect(toCollection)`

## 24.1 `toList`

```java
stream.toList()
```

Simple unmodifiable List.

## 24.2 `Collectors.toList`

```java
stream.collect(Collectors.toList())
```

Returns a List, but specific type/mutability not guaranteed by contract.

## 24.3 `toCollection`

```java
stream.collect(Collectors.toCollection(ArrayList::new))
```

Use when specific mutable collection type is required.

## 24.4 Rule

Use `toList()` for simple unmodifiable result; use `toCollection` when mutability/type is required.

---

# 25. Choosing Between `reduce` and `collect`

## 25.1 Use reduce for immutable value combination

```java
int sum = numbers.stream().reduce(0, Integer::sum);
```

## 25.2 Use collect for mutable container accumulation

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(User::role));
```

## 25.3 Bad reduce

Using reduce with mutable container breaks parallel semantics.

## 25.4 Rule

Reduce values; collect containers.

---

# 26. Choosing Between `forEach` and `collect`

## 26.1 Bad forEach accumulation

```java
List<String> emails = new ArrayList<>();
users.stream().forEach(u -> emails.add(u.email()));
```

## 26.2 Better

```java
List<String> emails = users.stream()
    .map(User::email)
    .toList();
```

## 26.3 Use forEach for external effects

```java
users.stream().forEach(notificationService::send);
```

But if errors/retries matter, loop may be clearer.

## 26.4 Rule

Use collect/toList for building results; use forEach for intentional side effects.

---

# 27. Performance Cost Model

## 27.1 Materialization

`toList`, `collect`, `toArray` allocate output.

## 27.2 Short-circuit

`anyMatch`, `findFirst`, `findAny` may avoid full traversal.

## 27.3 Reduction

`count`, `min`, `max`, `reduce` usually traverse all needed elements.

## 27.4 Ordering

`forEachOrdered`, `findFirst`, ordered `limit` can impose cost in parallel.

## 27.5 Collector

Collector cost depends on accumulator, combiner, map/list/set type, grouping cardinality.

## 27.6 Rule

Terminal operation often dominates memory and final cost.

---

# 28. Common Anti-Patterns

## 28.1 Reusing stream after terminal

Bad.

## 28.2 forEach adding to external mutable list

Bad, especially parallel.

## 28.3 sorted().findFirst instead of min

Inefficient.

## 28.4 Optional.get blindly

Bad.

## 28.5 reduce with mutable container

Bad.

## 28.6 collect toMap without duplicate key strategy

Can fail.

## 28.7 forEach for complex business side effects

Hard to handle errors/retries.

## 28.8 count on infinite stream

Never completes.

## 28.9 findFirst on unordered source expecting deterministic result

Wrong assumption.

## 28.10 Rule

Most terminal bugs are wrong assumptions about consumption, order, mutability, or reduction correctness.

---

# 29. Production Failure Modes

## 29.1 Unmodifiable toList surprise

Caller tries to mutate result.

Fix: `new ArrayList<>(stream.toList())` or `toCollection(ArrayList::new)`.

## 29.2 Duplicate key in toMap

Fix: merge function or groupingBy.

## 29.3 Parallel forEach race

Fix: collect/reduce correctly.

## 29.4 Non-associative reduce different result in parallel

Fix: associative operation or sequential explicit logic.

## 29.5 Resource stream not closed

Fix: try-with-resources.

## 29.6 Infinite stream terminal never completes

Fix: limit/takeWhile/short-circuit.

## 29.7 findAny used when first is required

Fix: findFirst.

## 29.8 forEachOrdered destroys parallel benefit

Fix: remove order requirement if possible.

## 29.9 Optional empty not handled

Fix: orElse/orElseThrow/or.

## 29.10 Side-effect errors swallowed/partial

Fix: explicit loop/transaction/retry design.

## 29.11 null reaches terminal with Optional

Fix: filter/map null safely before terminal.

## 29.12 counting after expensive map

If map not needed for count, move count earlier or avoid map.

---

# 30. Best Practices

## 30.1 Prefer result terminals over side-effect accumulation

Use:

```java
toList
collect
reduce
```

not external mutable state.

## 30.2 Use short-circuit terminals

Use:

```java
anyMatch
findFirst
findAny
```

to avoid unnecessary traversal.

## 30.3 Use min/max

Avoid full sort for one extremum.

## 30.4 Handle Optional explicitly

Never blindly `get`.

## 30.5 Choose collection terminal intentionally

- `toList` for unmodifiable list.
- `toCollection` for mutable specific collection.
- `toMap` with duplicate policy.
- `groupingBy` for multiple values per key.

## 30.6 Ensure reduction correctness

Identity and associativity.

## 30.7 Close resource-backed streams

try-with-resources.

## 30.8 Use loops for complex side effects

Especially transactional IO.

---

# 31. Decision Matrix

| Need | Terminal Operation |
|---|---|
| build unmodifiable List | `toList()` |
| build mutable ArrayList | `collect(toCollection(ArrayList::new))` |
| build Set | `collect(toSet())` / `toCollection` |
| build Map one value per key | `toMap` with duplicate policy |
| group many values per key | `groupingBy` |
| boolean exists | `anyMatch` |
| all satisfy | `allMatch` |
| none satisfy | `noneMatch` |
| first in encounter order | `findFirst` |
| any matching element | `findAny` |
| count elements | `count` |
| minimum | `min` |
| maximum | `max` |
| immutable value aggregation | `reduce` |
| mutable reduction/container | `collect` |
| typed object array | `toArray(Type[]::new)` |
| primitive array | primitive stream `toArray()` |
| side effect each element | `forEach` |
| ordered side effect | `forEachOrdered` |
| custom traversal | `iterator`/`spliterator` |
| infinite stream finite result | short-circuit or limit first |
| resource stream | terminal inside try-with-resources |

---

# 32. Latihan

## Latihan 1 — Terminal Trigger

Create stream with filter/map logging. Show logs only after terminal operation.

## Latihan 2 — toList Mutability

Call `toList()` and try to add element. Fix with `toCollection(ArrayList::new)`.

## Latihan 3 — forEach Race

Use parallel stream adding to ArrayList. Fix with `toList`.

## Latihan 4 — min vs sorted

Find oldest entity using sorted+findFirst and min. Compare complexity.

## Latihan 5 — Match Empty Semantics

Run `allMatch`, `noneMatch`, `anyMatch` on empty stream. Explain.

## Latihan 6 — findFirst vs findAny

Compare sequential and parallel behavior.

## Latihan 7 — reduce Identity

Show wrong result with bad identity.

## Latihan 8 — Non-Associative Reduce

Use subtraction sequential vs parallel. Explain difference.

## Latihan 9 — toMap Duplicate

Collect duplicate keys with `toMap`, then fix with merge function and with groupingBy.

## Latihan 10 — Files.lines Terminal

Use `Files.lines` with try-with-resources and terminal count.

---

# 33. Ringkasan

Terminal operations execute stream pipelines.

Core lessons:

- Intermediate operations are lazy; terminal operation triggers execution.
- A stream is normally consumed once.
- `forEach` is side-effect terminal; be careful with order and parallelism.
- `forEachOrdered` preserves encounter order at possible performance cost.
- `toList()` returns unmodifiable list.
- `collect` is mutable reduction using Collector.
- `toArray` materializes array; use generator for typed arrays.
- `reduce` is for immutable/value reductions.
- Reduction correctness requires identity and associativity.
- `count`, `min`, `max` aggregate stream elements.
- `anyMatch`, `allMatch`, `noneMatch` short-circuit.
- `findFirst` is order-sensitive; `findAny` is more flexible.
- Optional results must be handled.
- Infinite streams need short-circuit/bounds.
- Resource-backed streams must be closed.
- Use `collect`/`toList` instead of external mutable accumulation.
- Use min/max instead of sorting when only one extremum is needed.

Main rule:

```text
The terminal operation is the commitment point:
it decides execution, result shape, ordering cost, side effects, memory allocation, and correctness constraints.
```

---

# 34. Referensi

1. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

2. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

3. Java SE 25 — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

4. Java SE 25 — `java.util.stream` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

5. Java SE 25 — `Optional`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html

6. Java SE 25 — `OptionalInt`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/OptionalInt.html

7. Java SE 25 — `IntStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.html

8. Java SE 25 — `Files.lines`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html#lines(java.nio.file.Path)

9. dev.java — Terminal Operations on Streams  
   https://dev.java/learn/api/streams/terminal-operations/

10. dev.java — Reductions  
    https://dev.java/learn/api/streams/reducing/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-026.md](./learn-java-collections-and-streams-part-026.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-028.md](./learn-java-collections-and-streams-part-028.md)

# learn-java-collections-and-streams-part-058.md

# Java Collections and Streams — Part 058  
# Debugging Streams and Collections: Lazy Pipelines, Hidden Side Effects, Collector Bugs, Ordering Issues, ConcurrentModification, N+1 Queries, Memory Spikes, and Production Diagnostics

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **058**  
> Fokus: memahami cara debugging Collections dan Streams secara systematic. Kita akan membahas lazy evaluation, terminal operation, `peek` yang aman/tidak aman, collector combiner bugs, duplicate key issues, ordering problems, `ConcurrentModificationException`, weakly-consistent iteration, parallel stream bugs, N+1 query hidden inside stream, memory spike dari `toList/groupingBy/sorted/distinct`, logging strategy, breakpoint strategy, test minimization, heap diagnostics, and production-safe observability.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Debugging Collection = Debugging Data + Contract + Lifecycle](#2-mental-model-debugging-collection--debugging-data--contract--lifecycle)
3. [Mental Model: Debugging Stream = Debugging Lazy Dataflow](#3-mental-model-debugging-stream--debugging-lazy-dataflow)
4. [Checklist Awal Debugging](#4-checklist-awal-debugging)
5. [Bug Class 1: Pipeline Tidak Jalan](#5-bug-class-1-pipeline-tidak-jalan)
6. [Bug Class 2: Stream Sudah Dikonsumsi](#6-bug-class-2-stream-sudah-dikonsumsi)
7. [Bug Class 3: `peek` Tidak Dieksekusi Seperti yang Diharapkan](#7-bug-class-3-peek-tidak-dieksekusi-seperti-yang-diharapkan)
8. [Bug Class 4: Data Hilang Karena Filter](#8-bug-class-4-data-hilang-karena-filter)
9. [Bug Class 5: Mapping Menghasilkan Null](#9-bug-class-5-mapping-menghasilkan-null)
10. [Bug Class 6: Duplicate Key pada `toMap`](#10-bug-class-6-duplicate-key-pada-tomap)
11. [Bug Class 7: Merge Function Salah](#11-bug-class-7-merge-function-salah)
12. [Bug Class 8: Order Berubah](#12-bug-class-8-order-berubah)
13. [Bug Class 9: `ConcurrentModificationException`](#13-bug-class-9-concurrentmodificationexception)
14. [Bug Class 10: Parallel Stream Race](#14-bug-class-10-parallel-stream-race)
15. [Bug Class 11: Collector Combiner Bug](#15-bug-class-11-collector-combiner-bug)
16. [Bug Class 12: Lazy Loading dan N+1 Tersembunyi](#16-bug-class-12-lazy-loading-dan-n1-tersembunyi)
17. [Bug Class 13: Memory Spike](#17-bug-class-13-memory-spike)
18. [Bug Class 14: Infinite or Very Long Stream](#18-bug-class-14-infinite-or-very-long-stream)
19. [Bug Class 15: Mutation Leak](#19-bug-class-15-mutation-leak)
20. [Debugging with Small Reproducers](#20-debugging-with-small-reproducers)
21. [Debugging by Materializing Intermediate Results](#21-debugging-by-materializing-intermediate-results)
22. [Debugging with Named Predicates and Mappers](#22-debugging-with-named-predicates-and-mappers)
23. [Safe Use of `peek`](#23-safe-use-of-peek)
24. [Logging Stream Pipelines Safely](#24-logging-stream-pipelines-safely)
25. [Breakpoint Strategy](#25-breakpoint-strategy)
26. [Custom Debug Helper Functions](#26-custom-debug-helper-functions)
27. [Testing Collectors](#27-testing-collectors)
28. [Testing Ordering](#28-testing-ordering)
29. [Testing Null and Duplicate Policies](#29-testing-null-and-duplicate-policies)
30. [Testing Parallel Equivalence](#30-testing-parallel-equivalence)
31. [Debugging Concurrent Collections](#31-debugging-concurrent-collections)
32. [Debugging Memory Issues](#32-debugging-memory-issues)
33. [Debugging Persistence-Backed Collections](#33-debugging-persistence-backed-collections)
34. [Production Observability](#34-production-observability)
35. [When to Refactor Stream to Loop](#35-when-to-refactor-stream-to-loop)
36. [Common Anti-Patterns](#36-common-anti-patterns)
37. [Production Failure Modes](#37-production-failure-modes)
38. [Best Practices](#38-best-practices)
39. [Decision Matrix](#39-decision-matrix)
40. [Latihan](#40-latihan)
41. [Ringkasan](#41-ringkasan)
42. [Referensi](#42-referensi)

---

# 1. Tujuan Bagian Ini

Streams dan Collections membuat kode terlihat ringkas, tetapi debugging bisa lebih sulit jika mental model salah.

Contoh:

```java
orders.stream()
    .filter(this::isVisible)
    .map(this::toDto)
    .peek(dto -> audit(dto))
    .limit(10);
```

Kode ini tidak menjalankan apapun karena tidak ada terminal operation.

Contoh lain:

```java
Map<ProductId, OrderLine> linesByProduct = lines.stream()
    .collect(Collectors.toMap(
        OrderLine::productId,
        Function.identity(),
        (a, b) -> b
    ));
```

Ini silently latest-wins. Jika duplicate harus error, bug ini bisa menghilangkan data.

Contoh lain:

```java
orders.stream()
    .map(order -> OrderDto.from(order, order.lines()))
    .toList();
```

Jika `lines()` lazy, ini bisa N+1 query.

Tujuan bagian ini:

- punya systematic debugging checklist;
- memahami bug umum stream/collection;
- tahu kapan memakai `peek`, kapan tidak;
- membuat small reproducer;
- menguji collector, ordering, null, duplicate, parallel correctness;
- mendiagnosis memory dan persistence issues;
- tahu kapan stream harus di-refactor menjadi loop.

---

# 2. Mental Model: Debugging Collection = Debugging Data + Contract + Lifecycle

Collection bug biasanya bukan hanya “kode salah”.

Biasanya ada kontrak yang tidak jelas:

```text
Apakah null boleh?
Apakah duplicate boleh?
Apakah order dijamin?
Apakah collection mutable?
Apakah snapshot atau live view?
Apakah thread-safe?
Apakah lazy/persistence-backed?
Apakah size bounded?
```

## 2.1 Debugging question

Saat melihat bug collection, jangan langsung lihat syntax.

Tanya:

```text
Kontrak collection ini apa?
Siapa pemiliknya?
Siapa yang boleh mutate?
Kapan datanya berubah?
```

## 2.2 Rule

Debug collection by validating its contract, not only its contents.

---

# 3. Mental Model: Debugging Stream = Debugging Lazy Dataflow

Stream pipeline adalah dataflow lazy.

```text
source -> filter -> map -> sort -> collect
```

Tidak berjalan sampai terminal operation.

## 3.1 Important properties

- lazy;
- one-shot;
- may short-circuit;
- intermediate operations can be fused;
- order may depend on source and operation;
- parallel stream changes execution thread/order;
- exceptions often appear at terminal operation.

## 3.2 Rule

Debug stream by locating source, each transformation, and terminal operation.

---

# 4. Checklist Awal Debugging

Saat stream/collection result salah, cek:

## 4.1 Source

Apakah input benar?

## 4.2 Terminal operation

Apakah stream benar-benar dieksekusi?

## 4.3 Filters

Predicate mana yang membuang data?

## 4.4 Mapping

Apakah mapper pure dan tidak menghasilkan null?

## 4.5 Duplicate policy

Apakah `toMap`/dedup menghapus data?

## 4.6 Order

Apakah map/set/source menjamin order?

## 4.7 Mutability

Apakah collection berubah setelah dibuat?

## 4.8 Concurrency

Apakah diakses banyak thread?

## 4.9 Persistence

Apakah collection lazy-backed dan memicu query?

## 4.10 Size

Apakah operasi materialize semua data?

---

# 5. Bug Class 1: Pipeline Tidak Jalan

Bad:

```java
orders.stream()
    .filter(Order::isPaid)
    .map(OrderMapper::toDto);
```

Tidak ada terminal operation.

## 5.1 Fix

```java
List<OrderDto> dtos = orders.stream()
    .filter(Order::isPaid)
    .map(OrderMapper::toDto)
    .toList();
```

## 5.2 Debug signal

- breakpoint di mapper/filter tidak kena;
- log di `peek` tidak muncul;
- side effect tidak terjadi.

## 5.3 Rule

No terminal operation, no stream execution.

---

# 6. Bug Class 2: Stream Sudah Dikonsumsi

Bad:

```java
Stream<Order> stream = orders.stream();

long count = stream.count();
List<Order> list = stream.toList();
```

Second terminal operation throws:

```text
IllegalStateException: stream has already been operated upon or closed
```

## 6.1 Fix

Use collection source again:

```java
long count = orders.size();
List<Order> list = orders.stream().toList();
```

or supplier:

```java
Supplier<Stream<Order>> streamSupplier = orders::stream;
```

## 6.2 Rule

A stream is one-shot. Keep source collection if you need multiple passes.

---

# 7. Bug Class 3: `peek` Tidak Dieksekusi Seperti yang Diharapkan

`peek` is intermediate and lazy.

Bad:

```java
orders.stream()
    .peek(order -> log.info("{}", order));
```

No terminal operation.

## 7.1 Short-circuit surprise

```java
orders.stream()
    .peek(this::debug)
    .anyMatch(Order::isPaid);
```

`peek` only runs until match found.

## 7.2 Rule

Use `peek` only for debugging/observation, never required business side effects.

---

# 8. Bug Class 4: Data Hilang Karena Filter

Predicate too strict:

```java
.filter(order -> order.status() == PAID)
.filter(order -> order.amountCents() > 100_000)
.filter(order -> order.tenantId().equals(currentTenant))
```

## 8.1 Debug technique

Name predicates and count after each stage:

```java
List<Order> source = orders;

List<Order> paid = source.stream()
    .filter(OrderPredicates.isPaid())
    .toList();

List<Order> large = paid.stream()
    .filter(OrderPredicates.amountGreaterThan(100_000))
    .toList();

List<Order> tenant = large.stream()
    .filter(OrderPredicates.belongsTo(currentTenant))
    .toList();
```

## 8.2 Rule

When filter result surprises you, isolate predicates and measure each stage.

---

# 9. Bug Class 5: Mapping Menghasilkan Null

Streams allow null elements in many cases, but later operations may fail.

Bad:

```java
List<OrderDto> dtos = orders.stream()
    .map(this::toDtoOrNull)
    .toList();
```

Later:

```java
dtos.forEach(dto -> dto.id()); // NPE
```

## 9.1 Better

Return Optional:

```java
orders.stream()
    .map(this::toDtoMaybe)
    .flatMap(Optional::stream)
    .toList();
```

or fail fast:

```java
.map(order -> Objects.requireNonNull(toDto(order), "dto"))
```

## 9.2 Rule

Mapper null policy must be explicit.

---

# 10. Bug Class 6: Duplicate Key pada `toMap`

This throws if duplicate keys and no merge function:

```java
orders.stream()
    .collect(Collectors.toMap(Order::id, Function.identity()));
```

## 10.1 Debug

Find duplicates:

```java
Map<OrderId, Long> counts = orders.stream()
    .collect(Collectors.groupingBy(Order::id, Collectors.counting()));

counts.entrySet().stream()
    .filter(e -> e.getValue() > 1)
    .forEach(System.out::println);
```

## 10.2 Fix policy

Reject explicitly:

```java
(a, b) -> {
    throw new DuplicateOrderException(a.id());
}
```

First wins:

```java
(a, b) -> a
```

Latest wins:

```java
(a, b) -> b
```

Merge:

```java
Order::merge
```

## 10.3 Rule

Duplicate key error is not just technical; it asks for business policy.

---

# 11. Bug Class 7: Merge Function Salah

Bad:

```java
Collectors.toMap(
    Item::key,
    Function.identity(),
    (left, right) -> right
)
```

Silently overwrites.

## 11.1 Debug

Log conflict carefully:

```java
(left, right) -> {
    throw new IllegalStateException(
        "Duplicate key with values: " + left.id() + ", " + right.id()
    );
}
```

Avoid logging sensitive full objects.

## 11.2 Rule

Use latest-wins only when it is real business policy.

---

# 12. Bug Class 8: Order Berubah

Common causes:

## 12.1 HashSet/HashMap source

No stable order guarantee.

## 12.2 `unordered()`

Removes order constraint.

## 12.3 Parallel processing

Can change processing timing; terminal operation matters.

## 12.4 Collector map type

`groupingBy` default map type is not necessarily ordered.

## 12.5 Fix

Use explicit sort:

```java
.sorted(Comparator.comparing(Order::createdAt).reversed())
```

or ordered map:

```java
Collectors.groupingBy(
    Order::status,
    LinkedHashMap::new,
    Collectors.toList()
)
```

## 12.6 Rule

If order matters, define it explicitly.

---

# 13. Bug Class 9: `ConcurrentModificationException`

Bad:

```java
for (Order order : orders) {
    if (order.cancelled()) {
        orders.remove(order);
    }
}
```

## 13.1 Fix with iterator

```java
Iterator<Order> iterator = orders.iterator();
while (iterator.hasNext()) {
    if (iterator.next().cancelled()) {
        iterator.remove();
    }
}
```

## 13.2 Fix with removeIf

```java
orders.removeIf(Order::cancelled);
```

## 13.3 Fix with new collection

```java
List<Order> active = orders.stream()
    .filter(Predicate.not(Order::cancelled))
    .toList();
```

## 13.4 Rule

Do not structurally modify collection while iterating except through supported mechanisms.

---

# 14. Bug Class 10: Parallel Stream Race

Bad:

```java
List<OrderDto> result = new ArrayList<>();

orders.parallelStream()
    .map(OrderMapper::toDto)
    .forEach(result::add);
```

`ArrayList` is not thread-safe.

## 14.1 Fix

```java
List<OrderDto> result = orders.parallelStream()
    .map(OrderMapper::toDto)
    .toList();
```

## 14.2 Rule

Never mutate shared non-thread-safe collection from parallel stream.

---

# 15. Bug Class 11: Collector Combiner Bug

Custom collector works sequentially but fails parallel.

Bad:

```java
(left, right) -> left
```

drops right accumulator.

## 15.1 Debug test

```java
R sequential = input.stream().collect(collector);
R parallel = input.parallelStream().collect(collector);

assertEquals(sequential, parallel);
```

## 15.2 Direct combiner test

Create two accumulators manually and combine.

## 15.3 Rule

If collector has combiner, test it directly and via parallel stream.

---

# 16. Bug Class 12: Lazy Loading dan N+1 Tersembunyi

Stream hides DB access:

```java
orders.stream()
    .map(order -> OrderDto.from(order, order.lines()))
    .toList();
```

If `lines()` lazy, each order may trigger query.

## 16.1 Debug

Enable SQL logging/query counting.

Check:

```text
1 query for orders
N queries for lines
```

## 16.2 Fix

- fetch join;
- entity graph;
- projection query;
- batch fetch;
- map DTO inside transaction;
- avoid entity stream to controller.

## 16.3 Rule

When mapping persistence entities, treat collection access as possible SQL.

---

# 17. Bug Class 13: Memory Spike

Common causes:

```java
stream.toList()
stream.collect(groupingBy(...))
stream.distinct()
stream.sorted()
```

## 17.1 Debug

Ask:

- how many elements?
- how many groups?
- how large values?
- does operation need all data?
- can DB aggregate?
- can process batch by batch?

## 17.2 Fix

- limit/pagination;
- bounded collector;
- DB aggregation;
- streaming sink;
- batch processing.

## 17.3 Rule

Stateful/materializing stream operations require size awareness.

---

# 18. Bug Class 14: Infinite or Very Long Stream

Example:

```java
Stream.generate(this::next)
    .filter(this::matches)
    .toList();
```

Infinite collect.

## 18.1 Fix

Use limit/takeWhile:

```java
Stream.generate(this::next)
    .limit(1000)
    .toList();
```

## 18.2 Rule

Infinite streams must have explicit bound before materialization.

---

# 19. Bug Class 15: Mutation Leak

Bad getter:

```java
List<OrderLine> lines() {
    return lines;
}
```

Caller modifies internal list.

## 19.1 Debug symptom

Object state changes from unexpected location.

## 19.2 Fix

```java
List<OrderLine> lines() {
    return List.copyOf(lines);
}
```

## 19.3 Rule

If collection state changes mysteriously, inspect reference exposure.

---

# 20. Debugging with Small Reproducers

Large production pipeline:

```java
findOrders(...)
    .stream()
    .filter(...)
    .map(...)
    .collect(...)
```

Make tiny input:

```java
List<Order> orders = List.of(
    paidOrder(),
    cancelledOrder(),
    duplicateOrderId(),
    nullStatusOrder()
);
```

Then assert expected.

## 20.1 Rule

Small deterministic reproducer beats staring at huge pipeline.

---

# 21. Debugging by Materializing Intermediate Results

For debugging only:

```java
List<Order> paid = orders.stream()
    .filter(Order::isPaid)
    .toList();

List<OrderDto> dtos = paid.stream()
    .map(OrderMapper::toDto)
    .toList();
```

## 21.1 Benefit

You can inspect each stage.

## 21.2 Caveat

Do not keep debug materialization in hot production paths unless acceptable.

## 21.3 Rule

Break pipeline into stages temporarily to locate data loss/transformation bug.

---

# 22. Debugging with Named Predicates and Mappers

Instead of anonymous lambdas:

```java
.filter(order -> ...)
.map(order -> ...)
```

extract:

```java
Predicate<Order> visibleToViewer = OrderPredicates.visibleTo(viewer);
Function<Order, OrderDto> toDto = OrderMapper.forLocale(locale);
```

## 22.1 Benefit

- easier unit testing;
- easier breakpoint;
- better logs;
- clearer stack traces.

## 22.2 Rule

If lambda needs debugging, it probably deserves a name.

---

# 23. Safe Use of `peek`

Acceptable debugging:

```java
orders.stream()
    .peek(order -> log.debug("before filter id={}", order.id()))
    .filter(Order::isPaid)
    .peek(order -> log.debug("after filter id={}", order.id()))
    .map(OrderMapper::toDto)
    .toList();
```

## 23.1 Not acceptable

```java
.peek(repository::save)
.peek(audit::record)
```

for business side effects.

## 23.2 Rule

`peek` should be removable without changing business semantics.

---

# 24. Logging Stream Pipelines Safely

Avoid logging full object graph.

Bad:

```java
log.debug("orders={}", orders);
```

Better:

```java
log.debug("orderCount={}, ids={}",
    orders.size(),
    orders.stream().map(Order::id).limit(20).toList()
);
```

## 24.1 For large collections

Log:

- count;
- first N IDs;
- group counts;
- correlation ID;
- tenant ID;
- error code counts.

## 24.2 Rule

Log summaries, not full collections.

---

# 25. Breakpoint Strategy

## 25.1 Break inside named method

```java
.map(OrderMapper::toDto)
```

Set breakpoint in `toDto`.

## 25.2 Use conditional breakpoint

Break when:

```text
order.id().equals(targetId)
```

## 25.3 Avoid breakpoint in huge lambda

Hard to inspect.

## 25.4 Rule

Named functions make debugger usable.

---

# 26. Custom Debug Helper Functions

Helper:

```java
static <T> Function<T, T> debug(String label, Function<T, ?> view) {
    return value -> {
        log.debug("{}={}", label, view.apply(value));
        return value;
    };
}
```

Usage:

```java
orders.stream()
    .map(debug("source order", Order::id))
    .filter(Order::isPaid)
    .map(debug("paid order", Order::id))
    .toList();
```

## 26.1 Caveat

Still intermediate/lazy.

## 26.2 Rule

Debug helpers must not change semantics.

---

# 27. Testing Collectors

Test custom collector:

## 27.1 Empty input

## 27.2 Single input

## 27.3 Multiple input

## 27.4 Duplicate keys

## 27.5 Combiner

## 27.6 Finisher immutability

## 27.7 Parallel equivalence

```java
assertEquals(
    input.stream().collect(collector),
    input.parallelStream().collect(collector)
);
```

## 27.8 Rule

Collector tests must include combiner behavior, not only sequential collection.

---

# 28. Testing Ordering

Test expected order:

```java
assertEquals(
    List.of(id3, id2, id1),
    result.stream().map(OrderDto::id).toList()
);
```

## 28.1 Use deterministic tie-breaker

If sort by timestamp, add ID tie-breaker.

## 28.2 Rule

If order is contract, test it.

---

# 29. Testing Null and Duplicate Policies

## 29.1 Null input

```java
assertThrows(NullPointerException.class, () -> service.process(List.of((Item) null)));
```

## 29.2 Duplicate key

```java
assertThrows(DuplicateKeyException.class, () -> index(itemsWithDuplicate));
```

## 29.3 Rule

Null and duplicate policies are not edge cases; they are contract tests.

---

# 30. Testing Parallel Equivalence

For pure/associative pipelines:

```java
List<Result> seq = input.stream()
    .map(this::transform)
    .toList();

List<Result> par = input.parallelStream()
    .map(this::transform)
    .toList();

assertEquals(seq, par);
```

## 30.1 Caveat

Parallel order may differ for unordered sources/operations.

## 30.2 Rule

Only use parallel if equivalence and performance are tested.

---

# 31. Debugging Concurrent Collections

Questions:

## 31.1 Is iteration exact or weakly consistent?

Concurrent collections may not give snapshot.

## 31.2 Are compound actions atomic?

```java
containsKey + put
```

is not atomic.

## 31.3 Is collection bounded?

Unbounded queue/map can grow.

## 31.4 Is visibility guaranteed?

Safe publication?

## 31.5 Rule

Concurrent collection debugging focuses on atomicity, visibility, and iteration semantics.

---

# 32. Debugging Memory Issues

Look for:

- `toList` on large stream;
- `groupingBy` to huge lists;
- `distinct`/`sorted`;
- unbounded cache/map;
- queue backlog;
- ThreadLocal collection;
- static registry;
- subList/view retention;
- ORM persistence context.

## 32.1 Heap dump

Inspect dominator tree and retained size.

## 32.2 Rule

Find which collection retains memory, then why entries are not removed/bounded.

---

# 33. Debugging Persistence-Backed Collections

Checklist:

## 33.1 Is collection lazy?

## 33.2 Is transaction open?

## 33.3 How many SQL queries?

## 33.4 Is DTO mapping triggering lazy loads?

## 33.5 Is pagination broken by fetch join?

## 33.6 Is collection huge?

## 33.7 Rule

Enable SQL/query-count observability when streams touch entities.

---

# 34. Production Observability

Add metrics:

- input collection size;
- output collection size;
- filtered count;
- grouped bucket count;
- duplicate count;
- null rejection count;
- batch size;
- queue depth;
- cache size;
- stream processing duration;
- query count;
- memory/heap after operation.

## 34.1 Rule

Collection bugs become easier when size/count metrics are visible.

---

# 35. When to Refactor Stream to Loop

Refactor if:

- pipeline has many side effects;
- debugging is painful;
- exception handling complex;
- transaction/audit workflow important;
- stateful process;
- multiple outputs;
- conditional branching complex;
- performance needs precise control.

## 35.1 Example

Instead of forcing stream:

```java
for (Command command : commands) {
    authorize(command);
    ValidationResult validation = validate(command);
    if (validation.failed()) {
        failures.add(...);
        continue;
    }
    execute(command);
    audit(command);
}
```

## 35.2 Rule

Readable loop is better than clever pipeline.

---

# 36. Common Anti-Patterns

## 36.1 Debugging with business `peek`

Bad.

## 36.2 Logging entire collection

PII/memory/log flood.

## 36.3 Assuming HashMap order

Flaky.

## 36.4 Silent merge latest-wins

Data loss.

## 36.5 Parallel stream with shared mutable result

Race.

## 36.6 Ignoring combiner tests

Parallel bugs.

## 36.7 Mapping entities to DTO outside transaction

Lazy failure/N+1.

## 36.8 Materializing unbounded stream

OOM.

## 36.9 Returning live mutable collection

Mutation leak.

## 36.10 Debugging huge pipeline without small repro

Slow and unreliable.

---

# 37. Production Failure Modes

## 37.1 Pipeline did nothing

No terminal operation.

## 37.2 Data missing

Over-strict filter or silent duplicate merge.

## 37.3 Wrong order

Unspecified collection order.

## 37.4 NPE later

Mapper emitted null.

## 37.5 Duplicate key exception

Unexpected duplicate in `toMap`.

## 37.6 Parallel corruption

Shared mutable list.

## 37.7 Wrong parallel result

Bad collector combiner.

## 37.8 N+1 query storm

Lazy collection access in mapper.

## 37.9 OOM

`groupingBy`/`toList` huge input.

## 37.10 State corruption

Mutable collection exposed.

---

# 38. Best Practices

## 38.1 Start with contract

Null, duplicate, order, mutability, lifecycle.

## 38.2 Build small reproducers

Use tiny data with edge cases.

## 38.3 Name complex lambdas

Predicates/mappers/collectors.

## 38.4 Use `peek` only for temporary debugging

Not business logic.

## 38.5 Materialize intermediate results temporarily

Inspect stage by stage.

## 38.6 Test collectors thoroughly

Empty, duplicate, combiner, parallel.

## 38.7 Test order if order matters

Use deterministic assertions.

## 38.8 Observe SQL for persistence entities

Streams can hide queries.

## 38.9 Watch memory for stateful operations

`sorted`, `distinct`, `groupingBy`, `toList`.

## 38.10 Refactor to loop when pipeline hides workflow

Clarity wins.

---

# 39. Decision Matrix

| Symptom | Likely Cause | Debug Approach |
|---|---|---|
| filter/map not called | no terminal operation | add terminal op |
| stream fails second use | stream one-shot | recreate from source |
| `peek` missing logs | lazy/short-circuit | check terminal op |
| missing elements | filter too strict | isolate predicates |
| NPE after mapping | mapper returned null | explicit null policy |
| duplicate key exception | `toMap` duplicate | find duplicates, define merge |
| data overwritten | latest-wins merge | conflict-detecting merge |
| order flaky | unordered source/map | explicit sort/ordered map |
| ConcurrentModificationException | mutate during iteration | iterator/removeIf/copy |
| parallel wrong result | shared state/bad combiner | sequential vs parallel test |
| many SQL queries | lazy collection in mapper | SQL logs/fetch/projection |
| memory spike | materialization/stateful op | heap/limit/batch/DB agg |
| mysterious mutation | exposed mutable collection | defensive copy |
| queue grows | producer > consumer | backpressure metrics |
| cache grows | no eviction | size/TTL metrics |

---

# 40. Latihan

## Latihan 1 — No Terminal Operation

Create a stream pipeline with `peek` and no terminal operation. Explain why nothing happens.

## Latihan 2 — Duplicate Key Debug

Given duplicate order IDs, find duplicates before `toMap`.

## Latihan 3 — Merge Policy

Replace latest-wins merge with conflict-detecting merge.

## Latihan 4 — Ordering Bug

Show HashMap iteration order issue and fix with LinkedHashMap/sort.

## Latihan 5 — Concurrent Modification

Trigger `ConcurrentModificationException`, then fix with `removeIf`.

## Latihan 6 — Parallel Race

Write unsafe parallel stream adding to `ArrayList`, then fix with `toList`.

## Latihan 7 — Collector Combiner

Create broken collector and show sequential/parallel mismatch.

## Latihan 8 — N+1 Debug

Map entity collection to DTO and count SQL queries.

## Latihan 9 — Memory Spike

Compare `groupingBy` raw list vs downstream counting.

## Latihan 10 — Refactor to Loop

Take stream with authorization, validation, execution, audit side effects and refactor to loop.

---

# 41. Ringkasan

Debugging Streams and Collections requires understanding contract, lifecycle, and dataflow.

Core lessons:

- Collections bugs often come from unclear contracts.
- Streams are lazy and one-shot.
- No terminal operation means no execution.
- `peek` is for debugging, not business side effects.
- Data loss often comes from filters or duplicate merge policy.
- Mapper null policy must be explicit.
- `toMap` duplicate keys require business policy.
- Order must be explicitly defined when important.
- `ConcurrentModificationException` indicates unsafe structural mutation during iteration.
- Parallel streams require pure functions and safe collectors.
- Custom collector combiner must be tested.
- Streams can hide ORM lazy loading and N+1 queries.
- Materializing huge streams can cause OOM.
- Mutable collection exposure causes mysterious state changes.
- Small reproducers and named functions make debugging easier.
- Production observability should include sizes, counts, query counts, queue depth, and memory trends.
- Refactor to loop when stream hides workflow.

Main rule:

```text
When debugging a stream or collection bug, ask:
What is the source? What is the contract? When is it executed?
What is filtered, transformed, materialized, mutated, queried, or retained?
```

---

# 42. Referensi

1. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

2. Java SE 25 — `Collectors.toMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html#toMap(java.util.function.Function,java.util.function.Function)

3. Java SE 25 — `Collectors.groupingBy`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html#groupingBy(java.util.function.Function)

4. Java SE 25 — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

5. Java SE 25 — `ConcurrentModificationException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ConcurrentModificationException.html

6. Java SE 25 — `Iterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Iterator.html

7. Java SE 25 — `Collection.removeIf`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html#removeIf(java.util.function.Predicate)

8. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

9. Java SE 25 — `List.copyOf`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html#copyOf(java.util.Collection)

10. Java SE 25 — `Map`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-collections-and-streams-part-057.md">⬅️ Java Collections and Streams — Part 057</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-collections-and-streams-part-059.md">Java Collections and Streams — Part 059 ➡️</a>
</div>

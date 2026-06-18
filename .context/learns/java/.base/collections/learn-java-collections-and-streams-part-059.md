# learn-java-collections-and-streams-part-059.md

# Java Collections and Streams — Part 059  
# Testing Collections and Streams: Contract Tests, Edge Cases, Ordering, Duplicates, Nulls, Immutability, Collectors, Parallel Equivalence, Concurrency, Persistence, Performance, and Property-Based Thinking

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **059**  
> Fokus: memahami cara menguji Collections dan Streams secara sistematis. Kita akan membahas test contract untuk collection API, null/missing/empty, duplicate policy, ordering, immutability, defensive copy, map/set equality, custom collectors, stream laziness, one-shot stream, parallel equivalence, concurrency, N+1 query, memory/performance, property-based testing mindset, dan test data design.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Test Collection Behavior, Not Just Result Size](#2-mental-model-test-collection-behavior-not-just-result-size)
3. [Apa yang Harus Diuji dari Collection API?](#3-apa-yang-harus-diuji-dari-collection-api)
4. [Test Data Design](#4-test-data-design)
5. [Testing Empty Collections](#5-testing-empty-collections)
6. [Testing Single Element](#6-testing-single-element)
7. [Testing Multiple Elements](#7-testing-multiple-elements)
8. [Testing Null Collection Input](#8-testing-null-collection-input)
9. [Testing Null Elements](#9-testing-null-elements)
10. [Testing Duplicate Policy](#10-testing-duplicate-policy)
11. [Testing Ordering](#11-testing-ordering)
12. [Testing Stable Sorting and Tie-Breakers](#12-testing-stable-sorting-and-tie-breakers)
13. [Testing Set Semantics](#13-testing-set-semantics)
14. [Testing Map Semantics](#14-testing-map-semantics)
15. [Testing `equals`/`hashCode` Impact](#15-testing-equalshashcode-impact)
16. [Testing Defensive Copying](#16-testing-defensive-copying)
17. [Testing Immutability](#17-testing-immutability)
18. [Testing Snapshot vs Live View](#18-testing-snapshot-vs-live-view)
19. [Testing Stream Laziness](#19-testing-stream-laziness)
20. [Testing One-Shot Streams](#20-testing-one-shot-streams)
21. [Testing Short-Circuiting](#21-testing-short-circuiting)
22. [Testing Stream Pipelines](#22-testing-stream-pipelines)
23. [Testing Predicates and Mappers](#23-testing-predicates-and-mappers)
24. [Testing Custom Collectors](#24-testing-custom-collectors)
25. [Testing Collector Combiner](#25-testing-collector-combiner)
26. [Testing Sequential vs Parallel Equivalence](#26-testing-sequential-vs-parallel-equivalence)
27. [Testing Concurrent Collections](#27-testing-concurrent-collections)
28. [Testing Blocking Queues and Backpressure](#28-testing-blocking-queues-and-backpressure)
29. [Testing Repository/Persistence Collections](#29-testing-repositorypersistence-collections)
30. [Testing N+1 Query Risk](#30-testing-n1-query-risk)
31. [Testing Pagination Contracts](#31-testing-pagination-contracts)
32. [Testing Large Collection Behavior](#32-testing-large-collection-behavior)
33. [Testing Memory Boundaries](#33-testing-memory-boundaries)
34. [Testing Error Aggregation](#34-testing-error-aggregation)
35. [Testing Batch API Collections](#35-testing-batch-api-collections)
36. [Property-Based Testing Mindset](#36-property-based-testing-mindset)
37. [Metamorphic Testing](#37-metamorphic-testing)
38. [Test Naming Patterns](#38-test-naming-patterns)
39. [Common Anti-Patterns](#39-common-anti-patterns)
40. [Production Failure Modes Prevented by Tests](#40-production-failure-modes-prevented-by-tests)
41. [Best Practices](#41-best-practices)
42. [Decision Matrix](#42-decision-matrix)
43. [Latihan](#43-latihan)
44. [Ringkasan](#44-ringkasan)
45. [Referensi](#45-referensi)

---

# 1. Tujuan Bagian Ini

Banyak bug collection/stream lolos karena test hanya mengecek happy path:

```java
assertEquals(3, result.size());
```

Padahal collection behavior punya banyak dimensi:

- input null;
- element null;
- empty collection;
- duplicate;
- ordering;
- mutability;
- snapshot vs live;
- one-shot stream;
- lazy execution;
- parallel correctness;
- concurrency safety;
- N+1 query;
- memory growth;
- pagination stability;
- partial failure;
- error correlation.

Contoh test yang lemah:

```java
@Test
void shouldReturnOrders() {
    List<OrderDto> result = service.findOrders();
    assertFalse(result.isEmpty());
}
```

Test ini tidak menjawab:

- apakah order stabil?
- apakah unauthorized order difilter?
- apakah duplicate muncul?
- apakah result immutable?
- apakah lazy collection memicu N+1?
- apakah null aman?
- apakah page boundary benar?

Tujuan bagian ini:

- membuat testing checklist untuk collections/streams;
- menguji edge case yang sering menyebabkan production bugs;
- menguji collector dan parallel behavior;
- menguji immutability/defensive copy;
- menguji repository collection/N+1/pagination;
- mengenal property-based/metamorphic testing mindset.

---

# 2. Mental Model: Test Collection Behavior, Not Just Result Size

Collection bukan hanya jumlah element.

Collection punya kontrak:

```text
presence
size
order
uniqueness
null policy
mutability
snapshot/live
thread safety
lifecycle
error policy
```

## 2.1 Bad assertion

```java
assertEquals(2, result.size());
```

## 2.2 Better assertion

```java
assertEquals(
    List.of(order3.id(), order2.id()),
    result.stream().map(OrderDto::id).toList()
);
```

Ini menguji:

- element identity;
- order;
- exact content.

## 2.3 Main rule

```text
A good collection test asserts exact contract: content, order, duplicates, nullability, mutability, and lifecycle.
```

---

# 3. Apa yang Harus Diuji dari Collection API?

Untuk method:

```java
List<OrderDto> findVisibleOrders(User viewer)
```

uji:

## 3.1 Content

Order mana yang masuk?

## 3.2 Exclusion

Order mana yang tidak boleh masuk?

## 3.3 Order

Sort by apa?

## 3.4 Empty

Jika tidak ada data?

## 3.5 Authorization

Viewer hanya lihat data yang berhak.

## 3.6 Null

Input/output null policy.

## 3.7 Immutability

Can caller mutate result?

## 3.8 Performance signals

N+1 query? page size?

## 3.9 Rule

Test both included and excluded elements.

---

# 4. Test Data Design

Test data harus sengaja mencakup edge cases.

Example order list:

```text
paid order
cancelled order
different tenant order
same timestamp different id
duplicate product id
null optional field
large amount
zero amount
```

## 4.1 Use builders/mothers

```java
Order paidOrder = anOrder()
    .withStatus(PAID)
    .withTenant(tenantA)
    .build();
```

## 4.2 Avoid random-only data

Random data without clear intent makes failures hard to debug.

## 4.3 Rule

Each test element should exist for a reason.

---

# 5. Testing Empty Collections

Empty input:

```java
List<OrderDto> result = service.toDtos(List.of());
assertEquals(List.of(), result);
```

## 5.1 Empty should not be null

```java
assertNotNull(result);
assertTrue(result.isEmpty());
```

## 5.2 Empty output contract

If API promises empty list, assert exactly that.

## 5.3 Rule

Every collection method should have empty input/output tests.

---

# 6. Testing Single Element

Single element catches mapping correctness without noise.

```java
Order order = paidOrder();

List<OrderDto> result = mapper.toDtos(List.of(order));

assertEquals(List.of(OrderDto.from(order)), result);
```

## 6.1 Rule

Single-element tests isolate transformation correctness.

---

# 7. Testing Multiple Elements

Multiple elements test ordering, filtering, duplicates, aggregation.

```java
List<OrderDto> result = service.visibleOrders(List.of(order1, order2, order3));

assertEquals(List.of(order3.id(), order1.id()), ids(result));
```

## 7.1 Rule

Multi-element test should include at least one excluded element.

---

# 8. Testing Null Collection Input

Decide policy.

## 8.1 Reject null

```java
assertThrows(NullPointerException.class, () -> service.process(null));
```

## 8.2 Treat null as empty

Usually avoid unless explicitly documented.

```java
assertEquals(List.of(), service.process(null));
```

## 8.3 Rule

Do not leave null collection input behavior accidental.

---

# 9. Testing Null Elements

Example:

```java
List<Order> input = Arrays.asList(order1, null, order2);
```

Policy:

## 9.1 Reject

```java
assertThrows(NullPointerException.class, () -> service.process(input));
```

## 9.2 Skip

```java
assertEquals(List.of(dto1, dto2), service.process(input));
```

## 9.3 Preserve

Rare; should be explicit.

## 9.4 Rule

Test null elements separately from null collection reference.

---

# 10. Testing Duplicate Policy

Duplicates are business-relevant.

## 10.1 Reject duplicates

```java
assertThrows(DuplicateProductException.class,
    () -> indexByProductId(linesWithDuplicateProduct()));
```

## 10.2 First-wins

```java
assertEquals(first, result.get(key));
```

## 10.3 Latest-wins

```java
assertEquals(latest, result.get(key));
```

## 10.4 Merge

```java
assertEquals(totalQuantity, result.get(productId));
```

## 10.5 Rule

Duplicate policy must have explicit tests.

---

# 11. Testing Ordering

If order matters, assert exact order.

```java
assertEquals(
    List.of("C", "B", "A"),
    result.stream().map(Item::id).toList()
);
```

## 11.1 Avoid order-insensitive assertions

Do not use containsExactlyInAnyOrder if order is part of contract.

## 11.2 Rule

Order contract must be tested with exact sequence.

---

# 12. Testing Stable Sorting and Tie-Breakers

If sorting by `createdAt`, include same timestamp.

```java
Order a = order("A", sameTime);
Order b = order("B", sameTime);
```

Expected tie-breaker:

```java
createdAt desc, id desc
```

Assert:

```java
assertEquals(List.of("B", "A"), ids(result));
```

## 12.1 Rule

Sorting tests should include ties.

---

# 13. Testing Set Semantics

Set should remove duplicates by equality.

```java
Set<Role> roles = Set.copyOf(List.of(ADMIN, ADMIN));
assertEquals(Set.of(ADMIN), roles);
```

## 13.1 Test equals/hashCode

If custom object in Set, verify duplicate equivalence.

## 13.2 Rule

Set tests must prove intended equality semantics.

---

# 14. Testing Map Semantics

Map tests:

- missing key;
- duplicate key;
- null key/value policy;
- ordering if ordered map;
- merge policy.

Example:

```java
assertEquals(Optional.empty(), index.find(missingId));
```

## 14.1 Rule

Map wrapper APIs should be tested for missing/duplicate semantics, not only `get` happy path.

---

# 15. Testing `equals`/`hashCode` Impact

Hash collections rely on equality.

Test:

```java
UserId a1 = new UserId("A");
UserId a2 = new UserId("A");

Map<UserId, User> map = Map.of(a1, user);
assertSame(user, map.get(a2));
```

## 15.1 Mutable key test

If key can mutate, test failure and redesign.

## 15.2 Rule

Any type used as Map key or Set element deserves equality tests.

---

# 16. Testing Defensive Copying

Constructor defensive copy:

```java
List<Role> roles = new ArrayList<>(List.of(USER));
UserPrincipal principal = new UserPrincipal(userId, roles);

roles.add(ADMIN);

assertEquals(Set.of(USER), principal.roles());
```

Getter defensive copy:

```java
Set<Role> returned = principal.roles();
assertThrows(UnsupportedOperationException.class, () -> returned.add(ADMIN));
```

## 16.1 Rule

Defensive copy tests should mutate original input and returned output.

---

# 17. Testing Immutability

For result object:

```java
Report report = service.report();

assertThrows(UnsupportedOperationException.class,
    () -> report.rows().add(row));
```

## 17.1 Nested immutability

Also test nested lists/maps.

```java
assertThrows(UnsupportedOperationException.class,
    () -> report.errorsByField().get("email").add(error));
```

## 17.2 Rule

Top-level unmodifiable is not enough; test nested collection immutability.

---

# 18. Testing Snapshot vs Live View

Snapshot expected:

```java
List<String> source = new ArrayList<>(List.of("A"));
List<String> snapshot = service.snapshot(source);

source.add("B");

assertEquals(List.of("A"), snapshot);
```

Live view expected:

```java
List<String> view = service.view(source);
source.add("B");
assertEquals(List.of("A", "B"), view);
```

## 18.1 Rule

Snapshot/live semantics must be tested.

---

# 19. Testing Stream Laziness

Use counter:

```java
AtomicInteger calls = new AtomicInteger();

Stream<String> stream = input.stream()
    .map(value -> {
        calls.incrementAndGet();
        return value.toUpperCase();
    });

assertEquals(0, calls.get());

stream.toList();

assertEquals(input.size(), calls.get());
```

## 19.1 Rule

If laziness is contract, test no work before terminal operation.

---

# 20. Testing One-Shot Streams

```java
Stream<String> stream = input.stream();

stream.count();

assertThrows(IllegalStateException.class, stream::toList);
```

## 20.1 API test

If your API returns Stream, test caller behavior/documentation with try-with-resources if resource-backed.

## 20.2 Rule

Stream-returning APIs should test one-shot and close lifecycle if relevant.

---

# 21. Testing Short-Circuiting

Use counter:

```java
AtomicInteger calls = new AtomicInteger();

boolean found = input.stream()
    .peek(x -> calls.incrementAndGet())
    .anyMatch(x -> x.equals("target"));

assertTrue(found);
assertTrue(calls.get() < input.size());
```

## 21.1 Rule

Short-circuit tests prove pipeline does not process unnecessary elements.

---

# 22. Testing Stream Pipelines

For pipeline:

```java
orders.stream()
    .filter(visible)
    .filter(paid)
    .map(toDto)
    .sorted(byCreatedAtDesc)
    .toList();
```

Test layers:

- predicate unit tests;
- mapper unit tests;
- pipeline integration test;
- ordering test;
- exclusion test.

## 22.1 Rule

Do not test complex pipeline only through one giant integration test.

---

# 23. Testing Predicates and Mappers

Predicate:

```java
assertTrue(isPaid().test(paidOrder));
assertFalse(isPaid().test(cancelledOrder));
```

Mapper:

```java
assertEquals(expectedDto, OrderMapper.toDto(order));
```

## 23.1 Rule

Named predicate/mapper makes testing simple and precise.

---

# 24. Testing Custom Collectors

Collector test cases:

## 24.1 Empty

```java
assertEquals(emptySummary(), Stream.<Order>empty().collect(summaryCollector()));
```

## 24.2 Single

```java
assertEquals(summaryOf(order), Stream.of(order).collect(summaryCollector()));
```

## 24.3 Multiple

```java
assertEquals(expected, orders.stream().collect(summaryCollector()));
```

## 24.4 Finisher immutability

Try mutating result collections.

## 24.5 Rule

Custom collector tests must cover supplier, accumulator, combiner, finisher behavior.

---

# 25. Testing Collector Combiner

Directly test merge:

```java
SummaryAcc left = new SummaryAcc();
left.add(order1);

SummaryAcc right = new SummaryAcc();
right.add(order2);

SummaryAcc merged = left.merge(right);

assertEquals(expected, merged.finish());
```

## 25.1 Rule

Combiner bugs are hidden in sequential streams; test explicitly.

---

# 26. Testing Sequential vs Parallel Equivalence

```java
Summary sequential = orders.stream()
    .collect(summaryCollector());

Summary parallel = orders.parallelStream()
    .collect(summaryCollector());

assertEquals(sequential, parallel);
```

## 26.1 For order-sensitive result

If parallel may change order, define expected order or disallow parallel.

## 26.2 Rule

Any collector intended for parallel use must pass sequential/parallel equivalence.

---

# 27. Testing Concurrent Collections

Test invariants under concurrency.

Example: no duplicate session creation.

```java
ExecutorService executor = Executors.newFixedThreadPool(8);

List<Callable<Session>> tasks = IntStream.range(0, 100)
    .mapToObj(i -> (Callable<Session>) () -> registry.getOrCreate(userId))
    .toList();

List<Session> sessions = executor.invokeAll(tasks).stream()
    .map(future -> future.get())
    .toList();

assertEquals(1, Set.copyOf(sessions).size());
```

## 27.1 Repeat

Concurrency tests may be flaky; run repeated/stress tests.

## 27.2 Rule

Concurrent collection tests should assert invariants, not exact timing.

---

# 28. Testing Blocking Queues and Backpressure

Test bounded behavior:

```java
BlockingQueue<Task> queue = new ArrayBlockingQueue<>(1);

assertTrue(queue.offer(task1));
assertFalse(queue.offer(task2));
```

Timeout behavior:

```java
assertFalse(queue.offer(task2, 50, TimeUnit.MILLISECONDS));
```

## 28.1 Shutdown

Test interruption handling.

## 28.2 Rule

Queue tests should cover full, empty, timeout, and shutdown behavior.

---

# 29. Testing Repository/Persistence Collections

Test:

- lazy access inside transaction;
- DTO mapping inside transaction;
- no entity collection leaked;
- orphan removal;
- cascade behavior;
- ordering after reload;
- large collection query pagination.

## 29.1 Rule

Persistence collection tests should verify DB state and SQL behavior, not only object graph.

---

# 30. Testing N+1 Query Risk

Use query counter or SQL statement inspector.

Pseudo test:

```java
QueryCounter.reset();

List<OrderDto> result = service.findOrderDtos();

assertThat(QueryCounter.count()).isLessThanOrEqualTo(2);
```

## 30.1 Include multiple parents

N+1 does not show with one parent. Test at least 3.

## 30.2 Rule

N+1 tests require multiple parent rows and query count assertion.

---

# 31. Testing Pagination Contracts

Test:

## 31.1 Page size

## 31.2 Stable order

## 31.3 No duplicates across pages

## 31.4 No missing items across pages

## 31.5 Cursor invalid/expired

## 31.6 Tie-breakers

## 31.7 Rule

Pagination tests must include same-sort-key ties and page boundaries.

---

# 32. Testing Large Collection Behavior

Do not always need millions in unit tests.

Use scaled test:

```java
List<Integer> input = IntStream.range(0, 10_000)
    .boxed()
    .toList();
```

Assert:

- completes under reasonable time;
- does not materialize unnecessary details;
- respects max size;
- caps errors.

## 32.1 Rule

Use representative cardinality tests for algorithms and caps.

---

# 33. Testing Memory Boundaries

Hard in unit tests, but test policies:

- max batch size rejected;
- error list capped;
- cache has max size;
- queue bounded;
- pagination required.

Example:

```java
assertThrows(PayloadTooLargeException.class,
    () -> service.process(items(1001)));
```

## 33.1 Rule

Test memory boundaries through contract limits, not fragile heap assertions.

---

# 34. Testing Error Aggregation

For validation:

```java
ValidationReport report = validator.validate(rows);

assertEquals(10, report.totalRows());
assertEquals(7, report.validRows());
assertEquals(3, report.errorRows());
assertEquals(List.of("email", "name"), report.errorFields());
```

## 34.1 Per-item correlation

Assert index/client ID included.

## 34.2 Rule

Error aggregation tests must verify counts and correlation.

---

# 35. Testing Batch API Collections

Test:

- empty batch;
- max batch;
- above max;
- duplicate item ID;
- partial success;
- all-or-nothing rollback;
- per-item authorization;
- idempotent retry;
- response order/correlation.

## 35.1 Rule

Batch collection tests should model real retry and partial failure scenarios.

---

# 36. Property-Based Testing Mindset

Instead of only examples, define properties.

Examples:

## 36.1 Sorting property

Result is sorted.

```text
for all i < j, result[i] <= result[j]
```

## 36.2 Filtering property

Every output item satisfies predicate.

## 36.3 Mapping property

Output size equals input size if map is total.

## 36.4 Dedup property

No duplicate keys in output.

## 36.5 Idempotence

Normalization twice equals normalization once.

```java
normalize(normalize(x)).equals(normalize(x))
```

## 36.6 Rule

Properties catch broad classes of collection bugs.

---

# 37. Metamorphic Testing

Metamorphic tests compare related inputs.

## 37.1 Permutation invariance

If order should not matter:

```text
aggregate(input) == aggregate(shuffle(input))
```

## 37.2 Additive count

```text
count(input + onePaid) == count(input) + 1
```

## 37.3 Duplicate handling

```text
dedup(input + duplicate) == dedup(input)
```

if duplicates collapsed.

## 37.4 Rule

Metamorphic tests are powerful for aggregation and dedup logic.

---

# 38. Test Naming Patterns

Good names:

```java
shouldReturnEmptyListWhenNoOrders()
shouldRejectNullElements()
shouldPreserveCreatedAtDescendingOrder()
shouldRejectDuplicateProductIds()
shouldReturnImmutableSnapshot()
shouldNotTriggerNPlusOneWhenMappingOrders()
shouldProduceSameSummaryForSequentialAndParallelStream()
```

## 38.1 Rule

Test name should state collection contract.

---

# 39. Common Anti-Patterns

## 39.1 Only asserting size

Weak.

## 39.2 Ignoring order

If order matters.

## 39.3 No duplicate tests

Dangerous.

## 39.4 No null element tests

NPE later.

## 39.5 Testing only one parent for ORM mapping

N+1 hidden.

## 39.6 No combiner tests for custom collector

Parallel bug.

## 39.7 No immutability tests

Mutation leak.

## 39.8 Using random data without fixed seed/intent

Hard to debug.

## 39.9 Concurrency test with sleeps only

Flaky.

## 39.10 Performance tests in fragile unit tests

Prefer policy tests or dedicated benchmarks.

---

# 40. Production Failure Modes Prevented by Tests

## 40.1 Response order changed

Ordering tests catch.

## 40.2 Duplicate silently overwritten

Duplicate policy tests catch.

## 40.3 Null element NPE

Null element tests catch.

## 40.4 Mutable result corrupted

Immutability tests catch.

## 40.5 N+1 query storm

Query-count tests catch.

## 40.6 Pagination duplicates

Boundary/tie tests catch.

## 40.7 Parallel wrong aggregation

Sequential/parallel tests catch.

## 40.8 Batch retry duplicate side effects

Idempotency tests catch.

## 40.9 OOM from too-large batch

Max-size tests catch.

## 40.10 Stale/mutable snapshot bug

Snapshot/live tests catch.

---

# 41. Best Practices

## 41.1 Assert exact content

Not just size.

## 41.2 Test empty/single/multiple

They catch different bugs.

## 41.3 Test null input and null elements

Separately.

## 41.4 Test duplicate policy

Reject/first/latest/merge.

## 41.5 Test order with ties

Stable sorting matters.

## 41.6 Test defensive copy and immutability

Input mutation and output mutation.

## 41.7 Test collector combiner

Direct and parallel equivalence.

## 41.8 Test persistence query count

For entity-to-DTO mapping.

## 41.9 Test boundaries instead of heap

Max sizes, caps, pagination.

## 41.10 Use property/metamorphic thinking

Especially for aggregation, sorting, dedup.

---

# 42. Decision Matrix

| Contract | Test |
|---|---|
| empty result | exact empty list/map |
| null input rejected | `assertThrows` |
| null element rejected | list containing null |
| duplicates rejected | duplicate fixture |
| first-wins | assert first retained |
| latest-wins | assert latest retained |
| merge duplicates | assert merged value |
| order matters | exact sequence assertion |
| stable sort | same primary key/tie-breaker |
| set uniqueness | equivalent duplicate values |
| map missing key | Optional empty/exception |
| defensive copy input | mutate original after construction |
| immutable output | mutating returned collection throws |
| snapshot | mutate source after result |
| live view | mutate source and observe view |
| lazy stream | counter before terminal op |
| one-shot stream | second terminal op throws |
| short-circuit | counter less than input |
| collector combiner | manual merge test |
| parallel support | sequential == parallel |
| concurrency invariant | multi-thread stress/invariant |
| N+1 risk | query count with multiple parents |
| pagination | boundary/tie/no duplicate pages |
| batch max size | above max rejected |
| error aggregation | counts + item index/client ID |

---

# 43. Latihan

## Latihan 1 — Exact Content

Refactor a test that only asserts size into exact ID/order assertion.

## Latihan 2 — Duplicate Policy

Test `toMap` index builder for duplicate key rejection.

## Latihan 3 — Defensive Copy

Write test proving constructor and getter defensively copy roles.

## Latihan 4 — Snapshot vs Live

Create two APIs: snapshot and live view. Test difference.

## Latihan 5 — Stream Laziness

Use `AtomicInteger` to prove map is not executed before terminal operation.

## Latihan 6 — Collector Combiner

Build custom summary collector and test combiner directly.

## Latihan 7 — Parallel Equivalence

Compare sequential and parallel result for aggregation collector.

## Latihan 8 — N+1 Query

Create 3 orders each with lines and assert query count does not grow with N.

## Latihan 9 — Pagination Tie

Create records with same timestamp and assert stable tie-breaker.

## Latihan 10 — Metamorphic Aggregation

Prove count aggregation is invariant under input shuffle.

---

# 44. Ringkasan

Testing Collections and Streams means testing contracts, not just implementation.

Core lessons:

- Assert exact content and order when relevant.
- Test empty, single, and multiple elements.
- Test null collection and null elements separately.
- Duplicate policy must be explicit and tested.
- Stable ordering requires tie-breaker tests.
- Set/Map behavior depends on equality/hashCode.
- Defensive copy tests should mutate input and output.
- Immutability must include nested collections.
- Snapshot vs live view semantics should be tested.
- Stream laziness, one-shot, and short-circuiting can be tested with counters.
- Predicates/mappers are easier to test when named.
- Custom collectors need supplier/accumulator/combiner/finisher tests.
- Parallel equivalence catches combiner and shared-state bugs.
- Concurrent collections require invariant/stress tests.
- Persistence-backed collections require query-count/N+1 tests.
- Pagination tests require boundary and tie cases.
- Memory safety is often tested via max-size/cap contracts.
- Property-based and metamorphic thinking catch broad bugs.

Main rule:

```text
For collection-heavy code, every important behavior should have a test:
empty, null, duplicate, order, mutability, laziness, concurrency,
pagination, aggregation, and lifecycle.
```

---

# 45. Referensi

1. Java SE 25 — `Collection`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html

2. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

3. Java SE 25 — `Set`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html

4. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

5. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

6. Java SE 25 — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

7. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

8. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

9. Java SE 25 — `BlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html

10. OpenJDK jcstress  
    https://openjdk.org/projects/code-tools/jcstress/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Collections and Streams — Part 058](./learn-java-collections-and-streams-part-058.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Collections and Streams — Part 060](./learn-java-collections-and-streams-part-060.md)

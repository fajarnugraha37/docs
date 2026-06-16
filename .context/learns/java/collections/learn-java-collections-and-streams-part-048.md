# learn-java-collections-and-streams-part-048.md

# Java Collections and Streams — Part 048
# Collection API Design: Input Contracts, Return Contracts, Mutability, Ownership, Ordering, Null Policy, Defensive Copying, Pagination, Snapshots, Views, and Evolution-Safe APIs

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **048**  
> Fokus: mendesain API berbasis collection secara production-grade. Kita akan membahas parameter collection, return collection, interface vs implementation, `List`/`Set`/`Collection`/`Iterable`/`Stream`, mutability contract, null policy, ordering, duplicate policy, defensive copy, snapshot vs live view, ownership transfer, pagination, API evolution, concurrency, persistence boundaries, DTO boundaries, dan dokumentasi kontrak.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: API Collection = Kontrak, Bukan Sekadar Type](#2-mental-model-api-collection--kontrak-bukan-sekadar-type)
3. [Input vs Output Collection Contract](#3-input-vs-output-collection-contract)
4. [Parameter Type Selection](#4-parameter-type-selection)
5. [Return Type Selection](#5-return-type-selection)
6. [`Iterable` as Input](#6-iterable-as-input)
7. [`Collection` as Input](#7-collection-as-input)
8. [`List` as Input](#8-list-as-input)
9. [`Set` as Input](#9-set-as-input)
10. [`Map` as Input](#10-map-as-input)
11. [Avoid Over-Specifying Implementation Types](#11-avoid-over-specifying-implementation-types)
12. [When Implementation Type Is Acceptable](#12-when-implementation-type-is-acceptable)
13. [Return Empty Collection, Not Null](#13-return-empty-collection-not-null)
14. [Null Elements Policy](#14-null-elements-policy)
15. [Duplicate Policy](#15-duplicate-policy)
16. [Ordering Contract](#16-ordering-contract)
17. [Mutability Contract](#17-mutability-contract)
18. [Ownership Contract](#18-ownership-contract)
19. [Defensive Copy on Input](#19-defensive-copy-on-input)
20. [Defensive Copy on Output](#20-defensive-copy-on-output)
21. [Snapshot vs Live View](#21-snapshot-vs-live-view)
22. [Unmodifiable vs Immutable](#22-unmodifiable-vs-immutable)
23. [Exposing Internal Collections](#23-exposing-internal-collections)
24. [API Boundary vs Internal API](#24-api-boundary-vs-internal-api)
25. [Stream as Parameter](#25-stream-as-parameter)
26. [Stream as Return Type](#26-stream-as-return-type)
27. [Pagination and Large Collections](#27-pagination-and-large-collections)
28. [Batch APIs](#28-batch-apis)
29. [Partial Results and Error Reporting](#29-partial-results-and-error-reporting)
30. [Collection API and Concurrency](#30-collection-api-and-concurrency)
31. [Collection API and Persistence](#31-collection-api-and-persistence)
32. [Collection API and JSON/DTO](#32-collection-api-and-jsondto)
33. [Collection API and Domain Model](#33-collection-api-and-domain-model)
34. [API Evolution](#34-api-evolution)
35. [Documentation Checklist](#35-documentation-checklist)
36. [Common Anti-Patterns](#36-common-anti-patterns)
37. [Production Failure Modes](#37-production-failure-modes)
38. [Best Practices](#38-best-practices)
39. [Decision Matrix](#39-decision-matrix)
40. [Latihan](#40-latihan)
41. [Ringkasan](#41-ringkasan)
42. [Referensi](#42-referensi)

---

# 1. Tujuan Bagian Ini

Banyak bug production berasal dari API collection yang kontraknya tidak jelas.

Contoh:

```java
List<OrderLine> getLines()
```

Pertanyaan yang tidak terjawab:

- Apakah boleh null?
- Apakah list bisa dimodifikasi caller?
- Apakah perubahan caller memengaruhi object internal?
- Apakah urutan dijamin?
- Apakah duplicate boleh?
- Apakah element boleh null?
- Apakah return snapshot atau live view?
- Apakah list besar?
- Apakah caller boleh menyimpan reference?
- Apakah thread-safe?
- Apakah collection ini lazy?
- Apakah perlu ditutup?

Contoh lain:

```java
void process(List<Order> orders)
```

Pertanyaan:

- Kenapa `List`, bukan `Collection` atau `Iterable`?
- Apakah order penting?
- Apakah method akan memodifikasi input?
- Apakah null element valid?
- Apakah duplicate diproses dua kali?
- Apakah method menyimpan reference ke collection?
- Apakah input boleh mutable setelah method dipanggil?

Tujuan bagian ini:

- memahami collection API sebagai kontrak;
- memilih parameter/return type yang tepat;
- mendesain null/order/mutability/ownership semantics;
- menghindari exposing internals;
- membedakan snapshot/live view/unmodifiable/immutable;
- memahami stream sebagai API type;
- membuat API yang scalable, evolvable, dan mudah dipakai benar.

---

# 2. Mental Model: API Collection = Kontrak, Bukan Sekadar Type

Type collection bukan hanya compile-time shape.

Type collection mengomunikasikan:

```text
required capability
allowed semantics
business assumptions
performance expectations
ownership
mutation rights
```

## 2.1 Bad API

```java
ArrayList<User> findUsers();
```

Membocorkan implementation detail.

## 2.2 Better API

```java
List<User> findUsers();
```

Mengatakan result ordered/indexable, tanpa memaksa implementation.

## 2.3 Even better if domain-specific

```java
UserSearchResult searchUsers(UserSearchQuery query);
```

Mengizinkan pagination, metadata, total count, warnings.

## 2.4 Main rule

```text
Choose collection API types based on the contract you want callers to rely on.
```

---

# 3. Input vs Output Collection Contract

Input dan output punya pertanyaan berbeda.

## 3.1 Input collection

Pertanyaan utama:

```text
Apa kemampuan minimum yang method butuhkan?
```

Contoh:

```java
void sendEmails(Collection<EmailCommand> commands)
```

Jika hanya butuh iterate dan size maybe, `Collection` cukup.

## 3.2 Output collection

Pertanyaan utama:

```text
Apa kontrak yang method berikan ke caller?
```

Contoh:

```java
List<UserDto> users()
```

Memberikan ordered result.

## 3.3 Rule

Input type should be as general as useful. Return type should be as specific as contract requires.

---

# 4. Parameter Type Selection

Pilih parameter type berdasarkan operasi yang dibutuhkan.

## 4.1 Need only iterate once

```java
void process(Iterable<Event> events)
```

## 4.2 Need size/contains

```java
void validate(Collection<Item> items)
```

## 4.3 Need ordering/index

```java
void assignLineNumbers(List<OrderLine> lines)
```

## 4.4 Need uniqueness semantics

```java
void grantRoles(Set<Role> roles)
```

## 4.5 Need lookup by key

```java
void applyPrices(Map<ProductId, Money> prices)
```

## 4.6 Rule

Do not require `List` if you only need `Iterable`.

---

# 5. Return Type Selection

Return type tells caller what they can rely on.

## 5.1 Return `List`

When order matters.

```java
List<OrderDto> latestOrders()
```

## 5.2 Return `Set`

When uniqueness/membership matters.

```java
Set<Permission> permissions()
```

## 5.3 Return `Map`

When lookup matters.

```java
Map<ProductId, StockLevel> stockByProduct()
```

## 5.4 Return domain result

When metadata/errors/pagination matter.

```java
SearchResult<OrderDto> searchOrders(OrderSearchQuery query)
```

## 5.5 Rule

Return the abstraction that expresses result semantics, not internal storage.

---

# 6. `Iterable` as Input

Use `Iterable<T>` when you only need to iterate.

```java
void publishAll(Iterable<Event> events) {
    for (Event event : events) {
        publisher.publish(event);
    }
}
```

## 6.1 Benefits

Accepts many sources.

## 6.2 Limitations

No size, no contains, no stream directly unless converted.

## 6.3 Re-iteration uncertainty

Some Iterable implementations may be one-shot.

## 6.4 Rule

Use `Iterable` for simple traversal, but document if you iterate more than once.

---

# 7. `Collection` as Input

Use `Collection<T>` when you need:

- size;
- isEmpty;
- contains;
- maybe copy.

```java
void validateItems(Collection<Item> items) {
    if (items.isEmpty()) {
        throw new IllegalArgumentException("items required");
    }
}
```

## 7.1 Good default

For many batch APIs, `Collection` is better than `List`.

## 7.2 Rule

Use `Collection` when order/index is not required but cardinality matters.

---

# 8. `List` as Input

Use `List<T>` when:

- encounter order matters;
- index access matters;
- duplicates are meaningful;
- stable sequence is required.

```java
Invoice createInvoice(List<OrderLine> lines)
```

## 8.1 Avoid if order irrelevant

If method sorts internally or only iterates, `Collection` may be better.

## 8.2 Rule

Require `List` only when list semantics are part of the contract.

---

# 9. `Set` as Input

Use `Set<T>` when uniqueness is required by caller contract.

```java
void replaceRoles(Set<Role> roles)
```

## 9.1 But validate anyway

A caller can pass any Set implementation, but null/mutability/order may differ.

## 9.2 Beware equality

Set uniqueness uses equals/hashCode or comparator.

## 9.3 Rule

Use `Set` when uniqueness is not optional.

---

# 10. `Map` as Input

Use `Map<K,V>` when caller provides key-value association.

```java
void applyExchangeRates(Map<Currency, BigDecimal> rates)
```

## 10.1 Questions

- Are missing keys allowed?
- Are extra keys ignored?
- Are null keys/values allowed?
- Is iteration order relevant?

## 10.2 Rule

Map parameter should document key/value null and missing-key policy.

---

# 11. Avoid Over-Specifying Implementation Types

Bad:

```java
void process(ArrayList<Order> orders)
```

Why bad:

- rejects other list implementations;
- leaks implementation assumptions;
- makes tests harder;
- reduces API flexibility.

Better:

```java
void process(List<Order> orders)
```

or:

```java
void process(Collection<Order> orders)
```

## 11.1 Rule

Use interfaces in APIs unless implementation type is essential.

---

# 12. When Implementation Type Is Acceptable

Implementation type can be acceptable for internal low-level code where capability matters.

## 12.1 Example

```java
void fillBuffer(ArrayDeque<Task> deque)
```

If method specifically relies on deque implementation performance/internals.

## 12.2 Example

```java
EnumMap<Status, Long> counts
```

If enum-specific memory/performance semantics are part of contract.

## 12.3 Public API caution

Even then, prefer interface or domain type for public APIs.

## 12.4 Rule

Expose implementation types only when callers must know and benefit from that implementation.

---

# 13. Return Empty Collection, Not Null

Bad:

```java
List<User> findUsers() {
    return null;
}
```

Good:

```java
List<User> findUsers() {
    return List.of();
}
```

## 13.1 Benefits

Caller code simpler:

```java
for (User user : findUsers()) {
    ...
}
```

No null check.

## 13.2 Rule

Collection-returning methods should return empty collection, not null.

---

# 14. Null Elements Policy

Decide if collection elements can be null.

Recommended default:

```text
No null elements.
```

## 14.1 Enforce input

```java
items.forEach(item -> Objects.requireNonNull(item, "item"));
```

or copy factories:

```java
List.copyOf(items)
```

## 14.2 Document

```java
@param items non-null collection of non-null items
```

## 14.3 Rule

Do not leave null element policy implicit.

---

# 15. Duplicate Policy

For input collections, decide duplicate behavior.

## 15.1 Process duplicates

```text
Every element is processed, duplicates included.
```

## 15.2 Reject duplicates

```java
if (new HashSet<>(ids).size() != ids.size()) {
    throw new DuplicateIdException();
}
```

## 15.3 Collapse duplicates

```java
Set.copyOf(ids)
```

## 15.4 Merge duplicates

Use map/merge policy.

## 15.5 Rule

Duplicate policy must be explicit when duplicates affect business result.

---

# 16. Ordering Contract

Return order should be documented.

Examples:

```text
sorted by createdAt desc
encounter order from input
insertion order
undefined order
```

## 16.1 Bad

```java
Set<UserDto> users()
```

then client expects order from current HashSet iteration.

## 16.2 Better

```java
List<UserDto> usersSortedByName()
```

or documentation.

## 16.3 Rule

If clients can observe order, define it.

---

# 17. Mutability Contract

Can caller mutate returned collection?

Options:

```text
mutable independent copy
unmodifiable snapshot
live unmodifiable view
internal mutable reference
```

## 17.1 Recommended public return

Usually:

```java
return List.copyOf(items);
```

Unmodifiable snapshot.

## 17.2 Mutable copy

```java
return new ArrayList<>(items);
```

Caller can mutate copy without affecting internal state.

## 17.3 Rule

Returned collection mutability is part of API contract.

---

# 18. Ownership Contract

Ownership answers:

```text
Who may mutate this collection after method call?
Who owns resource/lifetime?
Can method retain reference?
```

## 18.1 Input ownership

Bad:

```java
class Service {
    private Collection<Item> items;

    void setItems(Collection<Item> items) {
        this.items = items;
    }
}
```

Caller can mutate after set.

Better:

```java
this.items = List.copyOf(items);
```

## 18.2 Rule

If method stores input collection, make defensive copy unless ownership transfer is explicit.

---

# 19. Defensive Copy on Input

```java
class Batch {
    private final List<Item> items;

    Batch(Collection<Item> items) {
        this.items = List.copyOf(items);
    }
}
```

## 19.1 Benefits

- rejects null collection/elements;
- prevents caller mutation from changing internal state;
- gives stable snapshot.

## 19.2 For mutable elements

Still need element immutability or deep copy if required.

## 19.3 Rule

Defensive copy protects collection structure, not element objects.

---

# 20. Defensive Copy on Output

```java
List<Item> items() {
    return List.copyOf(items);
}
```

## 20.1 For frequent calls

Copying may cost.

Alternative:

```java
Collections.unmodifiableList(items)
```

But this is live view.

## 20.2 Rule

Use snapshot for safety, live view only with clear contract and performance reason.

---

# 21. Snapshot vs Live View

## 21.1 Snapshot

```java
List.copyOf(items)
```

Stable at time of call.

## 21.2 Live view

```java
Collections.unmodifiableList(items)
```

Cannot mutate via view, but reflects internal changes.

## 21.3 Example

```java
List<Item> view = order.linesView();
order.addLine(...);
view.size(); // may change if live view
```

## 21.4 Rule

Name/document whether returned collection is snapshot or live.

---

# 22. Unmodifiable vs Immutable

## 22.1 Unmodifiable collection

Caller cannot modify through that reference.

But underlying collection may still change if it is a view.

## 22.2 Immutable collection

No mutation can happen through any reference.

## 22.3 Element mutability

Even immutable collection can contain mutable elements.

## 22.4 Rule

Unmodifiable collection structure is not the same as deeply immutable object graph.

---

# 23. Exposing Internal Collections

Avoid:

```java
return internalList;
```

unless API is deliberately internal and mutation is intended.

## 23.1 Consequences

- invariants broken;
- concurrency bugs;
- unexpected mutation;
- tests flaky;
- security rules bypassed.

## 23.2 Rule

Do not expose internal mutable collection from domain/service objects.

---

# 24. API Boundary vs Internal API

Public boundary API should be stricter and clearer.

## 24.1 Public API

Prefer:

- immutable/snapshot returns;
- no nulls;
- documented order;
- DTO result wrappers;
- pagination.

## 24.2 Internal hot path

May use mutable collections for performance but with local ownership.

## 24.3 Rule

Internal performance shortcuts should not leak into public contracts.

---

# 25. Stream as Parameter

Avoid public API:

```java
void process(Stream<Item> items)
```

unless laziness is essential.

## 25.1 Problems

- stream is one-shot;
- may be already consumed;
- may need closing;
- may be parallel;
- hard to validate size;
- ownership unclear.

## 25.2 Better

```java
void process(Collection<Item> items)
```

or:

```java
void process(Iterable<Item> items)
```

## 25.3 Rule

Use Stream as parameter sparingly; prefer Iterable/Collection for normal APIs.

---

# 26. Stream as Return Type

Returning Stream can be useful for lazy data.

```java
Stream<Record> openRecords()
```

But it raises ownership questions.

## 26.1 If resource-backed

Name and document:

```java
/**
 * Caller must close the returned stream.
 */
Stream<Record> openRecordStream();
```

## 26.2 If not resource-backed

Still one-shot and lazy.

## 26.3 Rule

Return Stream only when laziness is part of contract and lifecycle is clear.

---

# 27. Pagination and Large Collections

Returning huge `List` is dangerous.

Bad:

```java
List<OrderDto> findAllOrders()
```

for millions of rows.

Better:

```java
Page<OrderDto> findOrders(OrderQuery query, PageRequest pageRequest)
```

or cursor:

```java
Slice<OrderDto>
```

or streaming with explicit resource ownership.

## 27.1 Rule

For unbounded/large data, use pagination/cursor/batch, not giant collection return.

---

# 28. Batch APIs

Batch input APIs should define size constraints.

```java
BatchResult processBatch(List<Command> commands)
```

Questions:

- max batch size?
- empty allowed?
- duplicates?
- ordered processing?
- partial failure?
- idempotency key?

## 28.1 Validate early

```java
if (commands.size() > MAX_BATCH_SIZE) {
    throw new BatchTooLargeException();
}
```

## 28.2 Rule

Batch APIs must include cardinality and failure semantics.

---

# 29. Partial Results and Error Reporting

If collection processing can partially fail, do not return only collection.

Bad:

```java
List<Record> importCsv(...)
```

If some lines invalid, what happens?

Better:

```java
ImportReport importCsv(...)
```

with:

```java
validRecords
failures
warnings
totalRows
```

## 29.1 Rule

When failures matter, return result object, not just collection.

---

# 30. Collection API and Concurrency

Clarify whether collection is thread-safe.

## 30.1 Usually not thread-safe

Most API collections should be considered not thread-safe unless documented.

## 30.2 Do not expose synchronized internals casually

Thread-safety is bigger contract than wrapper.

## 30.3 Snapshot helps

Immutable snapshots are safe to share structurally.

## 30.4 Rule

If concurrent access is expected, design and document it explicitly.

---

# 31. Collection API and Persistence

Repository APIs need careful collection design.

## 31.1 Avoid findAll for large tables

```java
List<Entity> findAll()
```

dangerous.

## 31.2 Prefer query/pagination

```java
Page<Entity> findByCriteria(Criteria criteria, Pageable pageable)
```

## 31.3 Stream from DB cursor

If returning stream, lifecycle/transaction close must be explicit.

## 31.4 Rule

Persistence APIs should not accidentally materialize unbounded data.

---

# 32. Collection API and JSON/DTO

For DTOs:

## 32.1 Response

Prefer empty arrays/lists over null.

## 32.2 Request

Validate:

- missing field;
- explicit null;
- empty list;
- null element;
- duplicate;
- max size.

## 32.3 Backward compatibility

Changing order or null behavior can break clients.

## 32.4 Rule

Collection semantics are part of external API compatibility.

---

# 33. Collection API and Domain Model

Domain APIs should expose domain behavior.

Bad:

```java
order.getLines().add(line)
```

Good:

```java
order.addLine(product, quantity)
```

## 33.1 Getter

```java
List<OrderLine> lines()
```

should usually be snapshot/unmodifiable.

## 33.2 Rule

Domain collection APIs should protect invariants.

---

# 34. API Evolution

Collection API choices affect future evolution.

## 34.1 Returning List

Caller may rely on order and index.

Changing to Set later is breaking.

## 34.2 Returning mutable list

Caller may rely on mutation.

Changing to unmodifiable is breaking.

## 34.3 Returning HashMap

Caller may rely accidentally on implementation quirks.

## 34.4 Better

Return domain result wrapper:

```java
SearchResult<T>
```

allows adding metadata later.

## 34.5 Rule

Expose the smallest stable contract you are willing to support long-term.

---

# 35. Documentation Checklist

For any collection API, document:

## 35.1 Null

- collection null?
- elements null?
- keys/values null?

## 35.2 Mutability

- returned collection mutable?
- independent copy?
- live view?

## 35.3 Ordering

- guaranteed?
- sorted by what?
- input order preserved?

## 35.4 Duplicates

- allowed?
- rejected?
- collapsed?
- merged?

## 35.5 Size

- empty allowed?
- max size?
- unbounded?

## 35.6 Ownership

- method stores reference?
- caller can mutate after passing?

## 35.7 Resource

- need close?
- lazy?

## 35.8 Concurrency

- thread-safe?
- snapshot?

## 35.9 Failure

- partial failures?
- fail-fast?

---

# 36. Common Anti-Patterns

## 36.1 Return null collection

Bad.

## 36.2 Public mutable getter

Bad.

## 36.3 Accept `ArrayList` unnecessarily

Over-specified.

## 36.4 Return implementation type

Leaks detail.

## 36.5 Hidden live view

Surprise.

## 36.6 Claim immutable but elements mutable

Misleading.

## 36.7 Return `Stream` without close contract

Leak risk.

## 36.8 No pagination

OOM risk.

## 36.9 Silent duplicate collapse

Data loss.

## 36.10 Undefined order consumed by clients

Compatibility bug.

---

# 37. Production Failure Modes

## 37.1 Caller mutates returned list

Internal invariants broken.

## 37.2 Null list returned

Client NPE.

## 37.3 HashSet order changes

API response order flaky.

## 37.4 Duplicate command processed twice

Duplicate policy absent.

## 37.5 Duplicate command ignored

Set collapsed duplicate silently.

## 37.6 Large result OOM

No pagination.

## 37.7 DB cursor leak

Returned Stream not closed.

## 37.8 Transaction closed before stream consumed

Lazy persistence stream bug.

## 37.9 Concurrent modification

Live view over mutable internal collection.

## 37.10 API breaking change

Mutability/order contract changed unexpectedly.

---

# 38. Best Practices

## 38.1 Accept the least specific useful input type

`Iterable`/`Collection` unless list/set/map semantics needed.

## 38.2 Return the semantic output type

`List` for order, `Set` for uniqueness, `Map` for lookup.

## 38.3 Return empty, not null

Always.

## 38.4 Reject null elements by default

Unless documented.

## 38.5 Document duplicate/order/mutability

Make assumptions explicit.

## 38.6 Defensive copy when storing input

Avoid ownership leaks.

## 38.7 Return snapshots for public API

Prefer `List.copyOf`.

## 38.8 Use result wrappers for large/partial/metadata-rich results

`Page`, `SearchResult`, `ImportReport`.

## 38.9 Avoid Stream as public API unless lifecycle is clear

Especially resource-backed streams.

## 38.10 Design for evolution

Expose stable contracts, not implementation details.

---

# 39. Decision Matrix

| Need | API Design |
|---|---|
| input only iterated once | `Iterable<T>` |
| input needs size/isEmpty | `Collection<T>` |
| input order/index matters | `List<T>` |
| input uniqueness required | `Set<T>` |
| key lookup required | `Map<K,V>` |
| output ordered | `List<T>` |
| output unique | `Set<T>` |
| output lookup | `Map<K,V>` |
| output has metadata | result wrapper |
| output can be huge | pagination/cursor/batch |
| output lazy resource | `Stream<T>` with close contract |
| no result | empty collection, not null |
| no mutation allowed | unmodifiable snapshot |
| caller may mutate copy | mutable defensive copy |
| internal state must be protected | defensive copy output |
| input stored internally | defensive copy input |
| duplicates invalid | validate/reject |
| duplicates should merge | explicit merge policy |
| order undefined | document undefined or return unordered type |
| API may evolve | domain wrapper/result object |

---

# 40. Latihan

## Latihan 1 — Parameter Refactor

Given `void process(ArrayList<Order> orders)`, refactor to the least specific useful type.

## Latihan 2 — Return Contract

Design return type for `latestOrders()` where order is newest first.

## Latihan 3 — Defensive Copy

Implement constructor that stores collection input safely.

## Latihan 4 — Snapshot vs Live View

Show how live unmodifiable view changes after internal mutation.

## Latihan 5 — Duplicate Policy

Design batch command API that rejects duplicate command IDs.

## Latihan 6 — Pagination

Refactor `List<User> findAllUsers()` for large datasets.

## Latihan 7 — Stream Return

Design `openRecords()` returning Stream and document close contract.

## Latihan 8 — DTO Validation

Validate request DTO list: null list, empty, null elements, duplicate IDs, max size.

## Latihan 9 — Mutability Breaking Change

Explain why changing returned mutable list to unmodifiable can break clients.

## Latihan 10 — API Checklist

Take one collection API in your codebase and document null/order/mutability/ownership/duplicates/failure semantics.

---

# 41. Ringkasan

Collection API design is contract design.

Core lessons:

- Input and output collection contracts are different.
- Input type should require only capabilities needed.
- Output type should express semantics promised.
- Prefer interfaces over implementation types.
- Return empty collections, not null.
- Null element policy must be explicit.
- Duplicate policy must be explicit.
- Ordering is part of API compatibility.
- Mutability and ownership must be clear.
- Defensive copy protects boundaries.
- Snapshot and live view are different contracts.
- Unmodifiable is not always deeply immutable.
- Avoid exposing internal mutable collections.
- Use Stream as API type only when laziness/lifecycle is intentional.
- Use pagination/result wrappers for large or metadata-rich results.
- Batch APIs need size, ordering, duplicate, and failure semantics.
- Persistence streams need transaction/close contracts.
- External DTO collection semantics are compatibility commitments.
- Domain APIs should protect invariants through behavior methods.
- Design APIs for future evolution.

Main rule:

```text
A collection in an API is not just a container.
It is a promise about ordering, duplicates, nulls, mutability,
ownership, size, lifecycle, and failure semantics.
```

---

# 42. Referensi

1. Java SE 25 — `Collection`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html

2. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

3. Java SE 25 — `Set`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html

4. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

5. Java SE 25 — `Iterable`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Iterable.html

6. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

7. Java SE 25 — `List.copyOf`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html#copyOf(java.util.Collection)

8. Java SE 25 — `Collections.unmodifiableList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#unmodifiableList(java.util.List)

9. Java SE 25 — `Objects.requireNonNull`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html#requireNonNull(T)

10. Java SE 25 — `StreamSupport`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/StreamSupport.html

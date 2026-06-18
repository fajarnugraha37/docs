# learn-java-collections-and-streams-part-049.md

# Java Collections and Streams — Part 049  
# Streams in API Design: Laziness, One-Shot Consumption, Resource Ownership, Boundary Contracts, Return Types, Parameters, Pagination, Exceptions, Parallelism, and Production-Safe Stream APIs

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **049**  
> Fokus: mendesain API yang menggunakan `Stream` secara benar. Kita akan membahas kapan `Stream` layak menjadi return type atau parameter, kapan harus dihindari, bagaimana menjelaskan one-shot/lazy/resource-backed stream, close ownership, transaction boundaries, pagination, exception handling, parallelism, mutability, API evolution, dan alternatif seperti `Iterable`, `Collection`, `List`, `Page`, callback, cursor, dan domain result wrapper.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Stream API Type = Lazy One-Shot Pipeline Contract](#2-mental-model-stream-api-type--lazy-one-shot-pipeline-contract)
3. [Stream as Return Type: Kapan Masuk Akal?](#3-stream-as-return-type-kapan-masuk-akal)
4. [Stream as Return Type: Kapan Berbahaya?](#4-stream-as-return-type-kapan-berbahaya)
5. [Stream as Parameter: Kenapa Sering Buruk?](#5-stream-as-parameter-kenapa-sering-buruk)
6. [Alternatif untuk Stream Parameter](#6-alternatif-untuk-stream-parameter)
7. [Alternatif untuk Stream Return](#7-alternatif-untuk-stream-return)
8. [One-Shot Consumption Contract](#8-one-shot-consumption-contract)
9. [Laziness Contract](#9-laziness-contract)
10. [Resource Ownership Contract](#10-resource-ownership-contract)
11. [Closeable Stream APIs](#11-closeable-stream-apis)
12. [Naming Conventions: `stream` vs `openStream`](#12-naming-conventions-stream-vs-openstream)
13. [Transaction Boundary Problems](#13-transaction-boundary-problems)
14. [Repository APIs Returning Stream](#14-repository-apis-returning-stream)
15. [Service APIs Returning Stream](#15-service-apis-returning-stream)
16. [Controller/API Boundary and Stream](#16-controllerapi-boundary-and-stream)
17. [Stream and Pagination](#17-stream-and-pagination)
18. [Stream and Cursor Design](#18-stream-and-cursor-design)
19. [Callback Pattern](#19-callback-pattern)
20. [Spliterator/Iterable Pattern](#20-spliteratoriterable-pattern)
21. [Stream Supplier Pattern](#21-stream-supplier-pattern)
22. [Exception Handling in Stream APIs](#22-exception-handling-in-stream-apis)
23. [Null Policy](#23-null-policy)
24. [Ordering Policy](#24-ordering-policy)
25. [Parallelism Policy](#25-parallelism-policy)
26. [Side Effects Policy](#26-side-effects-policy)
27. [Mutability and Snapshot Semantics](#27-mutability-and-snapshot-semantics)
28. [Stream API and Security](#28-stream-api-and-security)
29. [Stream API and Observability](#29-stream-api-and-observability)
30. [Stream API and API Evolution](#30-stream-api-and-api-evolution)
31. [Design Examples](#31-design-examples)
32. [Bad API Examples and Refactoring](#32-bad-api-examples-and-refactoring)
33. [Testing Stream APIs](#33-testing-stream-apis)
34. [Documentation Checklist](#34-documentation-checklist)
35. [Common Anti-Patterns](#35-common-anti-patterns)
36. [Production Failure Modes](#36-production-failure-modes)
37. [Best Practices](#37-best-practices)
38. [Decision Matrix](#38-decision-matrix)
39. [Latihan](#39-latihan)
40. [Ringkasan](#40-ringkasan)
41. [Referensi](#41-referensi)

---

# 1. Tujuan Bagian Ini

`Stream` terlihat menarik sebagai API type:

```java
Stream<User> findUsers();
```

atau:

```java
void process(Stream<Order> orders);
```

Tetapi `Stream` bukan sekadar collection modern. `Stream` membawa kontrak khusus:

- lazy;
- one-shot;
- mungkin resource-backed;
- mungkin perlu ditutup;
- mungkin sequential atau parallel;
- mungkin punya ordering atau tidak;
- tidak punya size reliable;
- tidak bisa reuse;
- exception bisa muncul saat terminal operation, bukan saat method dipanggil;
- jika source DB/file/network, lifecycle harus jelas;
- caller bisa menambahkan operasi yang mengubah timing dan resource lifetime.

Karena itu `Stream` sebagai API type harus dipakai dengan hati-hati.

Tujuan bagian ini:

- memahami kapan Stream layak muncul di API;
- memahami kenapa Stream parameter sering buruk;
- membandingkan Stream dengan `Iterable`, `Collection`, `List`, `Page`, cursor, callback;
- mendesain close/resource ownership;
- memahami transaction boundary;
- membuat naming dan documentation yang aman;
- menghindari production bugs seperti DB cursor leak, transaction closed, stream consumed twice, dan hidden lazy exception.

---

# 2. Mental Model: Stream API Type = Lazy One-Shot Pipeline Contract

Jika method mengembalikan:

```java
Stream<T>
```

ia tidak hanya mengembalikan data.

Ia mengembalikan pipeline lazy yang biasanya belum dieksekusi.

## 2.1 One-shot

Stream hanya bisa dikonsumsi sekali.

```java
Stream<User> users = service.users();

long count = users.count();
List<User> list = users.toList(); // illegal
```

## 2.2 Lazy

Work terjadi saat terminal operation.

```java
Stream<User> users = service.users();
```

Belum tentu query/processing sudah dilakukan.

## 2.3 Resource ownership

Jika stream membuka resource, caller harus close.

## 2.4 Main rule

```text
Returning Stream means returning a lazy, one-shot computation, not a collection.
```

---

# 3. Stream as Return Type: Kapan Masuk Akal?

Stream return type masuk akal ketika:

## 3.1 Laziness adalah fitur

Data besar dan caller ingin short-circuit:

```java
try (Stream<LogLine> lines = logReader.openLines()) {
    return lines.anyMatch(LogLine::isFatal);
}
```

## 3.2 Caller perlu compose pipeline

Library/internal API yang memang memberi stream source.

```java
Stream<Token> tokenize(CharSequence input)
```

## 3.3 Source bukan collection

Custom source seperti generator, parser, file, cursor.

## 3.4 Data mungkin besar

Tapi jika resource-backed, close contract wajib.

## 3.5 Rule

Return Stream only when laziness/composability is part of the intended contract.

---

# 4. Stream as Return Type: Kapan Berbahaya?

Berbahaya ketika caller sebenarnya butuh collection result.

Bad:

```java
Stream<UserDto> getUsersForResponse()
```

Controller akhirnya:

```java
return service.getUsersForResponse().toList();
```

Lebih baik:

```java
List<UserDto> getUsersForResponse()
```

## 4.1 Berbahaya jika resource-backed

```java
Stream<User> findAllAsStream()
```

Jika DB cursor/connection harus tetap terbuka, caller harus tahu.

## 4.2 Berbahaya di public API

Karena lifecycle dan error timing lebih sulit dipahami.

## 4.3 Rule

Do not return Stream just to avoid choosing a collection type.

---

# 5. Stream as Parameter: Kenapa Sering Buruk?

API seperti ini sering problematik:

```java
void process(Stream<Order> orders)
```

## 5.1 Problems

- stream mungkin sudah consumed;
- stream mungkin resource-backed dan caller harus close;
- method mungkin tidak tahu size;
- method mungkin tidak tahu parallel/sequential;
- method mungkin menyimpan stream untuk nanti;
- method mungkin consume dua kali tanpa sadar;
- exception muncul saat method consume;
- caller tidak tahu apakah method akan close stream.

## 5.2 Example bug

```java
void process(Stream<Order> orders) {
    if (orders.count() == 0) {
        return;
    }
    orders.forEach(this::process); // illegal, stream already consumed
}
```

## 5.3 Rule

Avoid Stream as parameter unless the method is explicitly a stream pipeline consumer.

---

# 6. Alternatif untuk Stream Parameter

## 6.1 `Iterable<T>`

Jika hanya iterasi:

```java
void process(Iterable<Order> orders)
```

## 6.2 `Collection<T>`

Jika butuh size/isEmpty:

```java
void process(Collection<Order> orders)
```

## 6.3 `List<T>`

Jika order/index penting:

```java
void processInOrder(List<Order> orders)
```

## 6.4 `Supplier<Stream<T>>`

Jika butuh membuat stream baru beberapa kali.

```java
void compare(Supplier<Stream<Order>> orders)
```

Tapi lifecycle harus jelas.

## 6.5 Callback

Jika method owns resource:

```java
<R> R withOrders(Function<Stream<Order>, R> action)
```

## 6.6 Rule

Prefer simpler collection/iterable parameters unless laziness is essential.

---

# 7. Alternatif untuk Stream Return

## 7.1 `List<T>`

For bounded ordered results.

```java
List<UserDto> findUsers(...)
```

## 7.2 `Set<T>`

For unique results.

## 7.3 `Map<K,V>`

For lookup result.

## 7.4 `Page<T>` / `Slice<T>`

For large query result.

## 7.5 Cursor/Iterator abstraction

For controlled lazy traversal.

```java
RecordCursor openCursor()
```

## 7.6 Callback

```java
<R> R withRecords(Function<Stream<Record>, R> action)
```

## 7.7 Rule

Use Stream return only if alternatives fail to express laziness/composability cleanly.

---

# 8. One-Shot Consumption Contract

Stream is consumable once.

## 8.1 API implication

If API returns stream, caller must not expect repeatability.

Bad caller:

```java
Stream<User> users = service.users();
long count = users.count();
List<User> list = users.toList();
```

## 8.2 If repeatability needed

Return collection or supplier.

```java
Supplier<Stream<User>> users()
```

But supplier may reopen source each time.

## 8.3 Rule

If caller may need multiple passes, do not return Stream.

---

# 9. Laziness Contract

Lazy result means:

```java
Stream<User> stream = service.findUsers();
```

may not execute query/processing yet.

## 9.1 Exception timing

Exception may occur later:

```java
stream.toList();
```

not at method return.

## 9.2 Side effect timing

If stream source logs/loads/fetches, timing is terminal-operation dependent.

## 9.3 Rule

Lazy APIs must document when work happens.

---

# 10. Resource Ownership Contract

A resource-backed Stream must be closed.

## 10.1 Example

```java
Stream<String> openLines(Path path) throws IOException
```

Caller:

```java
try (Stream<String> lines = openLines(path)) {
    ...
}
```

## 10.2 Ownership questions

- Who opens resource?
- Who closes it?
- Can stream escape transaction?
- What if terminal operation throws?

## 10.3 Rule

If API returns resource-backed Stream, caller close responsibility must be explicit.

---

# 11. Closeable Stream APIs

Because Stream extends `AutoCloseable`, try-with-resources works.

## 11.1 Good API name

```java
Stream<Record> openRecordStream()
```

Name hints resource.

## 11.2 Javadoc

```java
/**
 * Opens a stream of records. The caller must close the returned stream.
 */
```

## 11.3 Rule

Resource-backed stream method names should make opening/closing obvious.

---

# 12. Naming Conventions: `stream` vs `openStream`

## 12.1 In-memory stream

```java
Stream<Item> stream()
```

May be okay for collection-like object.

## 12.2 Resource-backed stream

```java
Stream<Item> openStream()
Stream<Item> openRecordStream()
```

Better because it signals ownership.

## 12.3 Query stream

```java
Stream<User> streamUsers(...)
```

Not enough if DB cursor-backed. Prefer:

```java
Stream<User> openUserCursor(...)
```

or dedicated cursor type.

## 12.4 Rule

Use names that reveal whether resource/lifecycle is involved.

---

# 13. Transaction Boundary Problems

Common bug:

```java
@Transactional
Stream<User> streamUsers() {
    return repository.streamAll();
}
```

Caller consumes after transaction closes.

## 13.1 Failure

LazyInitializationException, closed ResultSet, closed connection, or similar.

## 13.2 Better

Consume inside transaction:

```java
@Transactional
List<UserDto> findUsers() {
    try (Stream<User> users = repository.streamAll()) {
        return users.map(UserDto::from).toList();
    }
}
```

## 13.3 Callback

```java
@Transactional
<R> R withUsers(Function<Stream<User>, R> action) {
    try (Stream<User> users = repository.streamAll()) {
        return action.apply(users);
    }
}
```

## 13.4 Rule

Do not return lazy DB stream across transaction boundary unless transaction/lifecycle is managed explicitly.

---

# 14. Repository APIs Returning Stream

Repository stream can be useful for large read processing.

## 14.1 But document

- transaction must be open;
- stream must be closed;
- not reusable;
- ordering;
- fetch size/batch behavior if relevant.

## 14.2 Alternative

Pagination:

```java
Page<User> findPage(...)
```

or chunk processor.

## 14.3 Rule

DB stream APIs are advanced and must be paired with transaction/close discipline.

---

# 15. Service APIs Returning Stream

Service layer should usually not expose Stream if it hides resources.

## 15.1 Bad

```java
Stream<OrderDto> exportOrders()
```

if this uses DB cursor internally.

## 15.2 Better callback

```java
void exportOrders(OrderExportSink sink)
```

or:

```java
<R> R withOrderStream(Function<Stream<OrderDto>, R> action)
```

## 15.3 Better page/chunk

```java
OrderExportBatch nextBatch(Cursor cursor)
```

## 15.4 Rule

Service API should expose business-safe abstraction, not leak low-level stream lifecycle.

---

# 16. Controller/API Boundary and Stream

Returning `Stream` from controller/service boundary is often wrong.

## 16.1 REST response

A REST endpoint usually needs serialized body.

Better:

```java
List<UserDto>
Page<UserDto>
StreamingResponseBody
```

depending use case.

## 16.2 If streaming HTTP response

Use framework-specific streaming abstraction, not plain Java Stream unless carefully integrated.

## 16.3 Rule

External API streaming needs protocol-level design, not simply returning `Stream<T>`.

---

# 17. Stream and Pagination

Stream is not pagination.

## 17.1 Stream

Lazy traversal, one-shot.

## 17.2 Pagination

Explicit bounded page with metadata:

```java
Page<T>
items
page number
page size
total maybe
hasNext
```

## 17.3 Large user-facing query

Use pagination.

## 17.4 Rule

Use Stream for internal lazy processing; use pagination for client-facing large result navigation.

---

# 18. Stream and Cursor Design

Cursor is often better than Stream for resource-heavy large traversal.

## 18.1 Cursor API

```java
interface RecordCursor extends AutoCloseable {
    boolean hasNext();
    Record next();
}
```

## 18.2 Benefits

- explicit close;
- explicit lifecycle;
- can expose checkpoint;
- can model retries;
- can expose progress;
- can avoid stream one-shot surprises.

## 18.3 Rule

For long-lived resource traversal, consider cursor abstraction.

---

# 19. Callback Pattern

Callback keeps resource ownership inside method.

```java
<R> R withLines(Path path, Function<Stream<String>, R> action) throws IOException {
    try (Stream<String> lines = Files.lines(path)) {
        return action.apply(lines);
    }
}
```

Usage:

```java
long errorCount = withLines(path, lines ->
    lines.filter(line -> line.contains("ERROR")).count()
);
```

## 19.1 Benefit

Caller gets stream composability but cannot forget close.

## 19.2 Danger

Caller must not return stream from callback.

## 19.3 Rule

Callback pattern is excellent for resource-backed streams with controlled lifetime.

---

# 20. Spliterator/Iterable Pattern

Instead of returning Stream, return `Iterable` or custom type.

```java
Iterable<Record> records()
```

## 20.1 Benefits

- works with for-each;
- less API surprise;
- can document one-shot or repeatable;
- can provide stream method internally.

## 20.2 If close needed

Plain Iterable does not express close. Use custom AutoCloseable cursor.

## 20.3 Rule

Iterable is good for simple traversal; AutoCloseable cursor is better for resource traversal.

---

# 21. Stream Supplier Pattern

`Supplier<Stream<T>>` can express repeatable stream creation.

```java
Supplier<Stream<User>> users = () -> repository.findAll().stream();
```

## 21.1 Use case

Need multiple independent traversals.

```java
long count = users.get().count();
List<User> active = users.get().filter(User::active).toList();
```

## 21.2 Danger

If supplier opens resource each time, each stream must be closed.

## 21.3 Rule

Supplier solves one-shot issue but introduces lifecycle clarity requirement.

---

# 22. Exception Handling in Stream APIs

Because stream is lazy, exceptions may occur during terminal operation.

## 22.1 Example

```java
Stream<Record> records = parser.records(path);
```

may succeed, but:

```java
records.toList();
```

may throw.

## 22.2 API implication

Javadoc must explain runtime exceptions and parse/IO failure timing.

## 22.3 Rule

Lazy stream APIs shift exception timing to caller’s terminal operation.

---

# 23. Null Policy

Stream APIs should not emit null by default.

## 23.1 Prefer non-null elements

Document:

```text
The returned stream contains no null elements.
```

## 23.2 If null possible

Better model explicitly.

```java
Stream<Optional<T>>
```

is sometimes awkward.

Better:

```java
Stream<Result<T>>
```

if failures/absence matter.

## 23.3 Rule

A Stream API should document whether elements can be null.

---

# 24. Ordering Policy

Stream can be ordered or unordered.

## 24.1 Ordered API

```java
Stream<Order> ordersByCreatedAtDesc()
```

## 24.2 Unordered API

```java
Stream<Tag> tags()
```

if no order promised.

## 24.3 Rule

If caller may rely on order, make it explicit in method name or documentation.

---

# 25. Parallelism Policy

Do not surprise callers with parallel streams.

## 25.1 Bad

```java
return items.parallelStream();
```

Caller may not expect common-pool execution.

## 25.2 Better

Return sequential stream; let caller choose parallel if safe.

```java
return items.stream();
```

## 25.3 Rule

APIs should usually return sequential streams unless parallelism is core documented behavior.

---

# 26. Side Effects Policy

Stream return gives caller control over terminal operation.

If your source has side effects during traversal, document them.

## 26.1 Example

```java
Stream<Message> receiveMessages()
```

Does traversing acknowledge messages?

If yes, Stream may be bad API.

## 26.2 Rule

If traversal causes external side effects, a domain-specific API is better than plain Stream.

---

# 27. Mutability and Snapshot Semantics

Returning stream from mutable collection:

```java
return internalList.stream();
```

If internal list changes before terminal operation, result may change or fail.

## 27.1 Snapshot stream

```java
return List.copyOf(internalList).stream();
```

## 27.2 Live stream

```java
return internalList.stream();
```

Live and mutation-sensitive.

## 27.3 Rule

Define whether stream is over snapshot or live state.

---

# 28. Stream API and Security

Stream can defer authorization checks.

## 28.1 Bad

```java
Stream<Document> documentsFor(User user) {
    return allDocuments.stream().filter(doc -> canRead(user, doc));
}
```

If user/session context changes before terminal operation, risk.

## 28.2 Better

Capture immutable authorization context.

```java
UserId userId = user.id();
Set<Role> roles = Set.copyOf(user.roles());
```

## 28.3 Rule

Lazy stream APIs must not depend on mutable security context that can change before consumption.

---

# 29. Stream API and Observability

Lazy APIs complicate metrics.

## 29.1 Where to measure?

- method call time?
- terminal operation time?
- per-element processing?
- close time?

## 29.2 onClose

Can record close metrics.

## 29.3 Better for services

Perform processing inside service method if metrics/SLAs matter.

## 29.4 Rule

If observability boundary matters, avoid leaking lazy stream beyond that boundary.

---

# 30. Stream API and API Evolution

Returning Stream commits to:

- one-shot;
- lazy;
- pipeline-style consumption;
- possible close;
- no size;
- no random access;
- terminal operation controlled by caller.

Changing later to `List` may break callers.

## 30.1 Returning List commits to materialized ordered collection.

## 30.2 Result wrapper is more evolvable.

```java
SearchResult<T>
```

## 30.3 Rule

Pick return type based on stable long-term contract.

---

# 31. Design Examples

## 31.1 In-memory domain object

```java
class Order {
    private final List<OrderLine> lines = new ArrayList<>();

    List<OrderLine> lines() {
        return List.copyOf(lines);
    }

    Stream<OrderLine> lineStream() {
        return List.copyOf(lines).stream();
    }
}
```

Usually `List` is enough.

## 31.2 File parser

```java
Stream<Record> openRecordStream(Path path) throws IOException
```

with caller-close contract.

Better:

```java
<R> R withRecords(Path path, Function<Stream<Record>, R> action)
```

## 31.3 Repository

```java
Page<User> findUsers(UserQuery query, PageRequest page)
```

preferred for API queries.

Stream only for internal batch processing with transaction.

## 31.4 Rule

Use stream only where laziness is a real design feature.

---

# 32. Bad API Examples and Refactoring

## 32.1 Bad: Stream parameter

```java
void importUsers(Stream<UserDto> users)
```

Refactor:

```java
ImportReport importUsers(Collection<UserDto> users)
```

or:

```java
ImportReport importUsers(Iterable<UserDto> users)
```

## 32.2 Bad: DB stream return

```java
Stream<Order> findAllOrders()
```

Refactor:

```java
Page<Order> findOrders(OrderQuery query, PageRequest page)
```

or internal callback:

```java
<R> R withOrderStream(Function<Stream<Order>, R> action)
```

## 32.3 Bad: resource stream without name

```java
Stream<String> lines(Path path)
```

Refactor:

```java
Stream<String> openLines(Path path)
```

or:

```java
<R> R withLines(Path path, Function<Stream<String>, R> action)
```

## 32.4 Rule

Refactor Stream APIs when lifecycle, size, or ownership is unclear.

---

# 33. Testing Stream APIs

Test:

## 33.1 One-shot behavior

Ensure callers do not reuse.

## 33.2 Close behavior

For resource streams, verify close handler/resource close.

## 33.3 Lazy exception timing

Test exception during terminal operation.

## 33.4 Ordering

Assert order if promised.

## 33.5 Null

Assert no nulls if promised.

## 33.6 Snapshot/live

Mutate source after stream creation before terminal operation and verify intended behavior.

## 33.7 Parallel

If API returns sequential stream, assert `!stream.isParallel()` if important.

## 33.8 Rule

Stream API tests should validate lifecycle contract, not just elements.

---

# 34. Documentation Checklist

For Stream API, document:

## 34.1 Consumption

One-shot? Repeatable? Supplier?

## 34.2 Laziness

When does work start?

## 34.3 Resource

Must caller close?

## 34.4 Transaction

Must be consumed inside transaction?

## 34.5 Exceptions

When/what exceptions can occur?

## 34.6 Null

Can elements be null?

## 34.7 Ordering

Is encounter order defined?

## 34.8 Parallel

Sequential or parallel? Caller may parallelize?

## 34.9 Side effects

Does traversal cause side effects?

## 34.10 Snapshot

Snapshot or live view?

---

# 35. Common Anti-Patterns

## 35.1 Stream parameter for normal batch input

Use Collection/Iterable.

## 35.2 Returning resource stream without close docs

Leak risk.

## 35.3 Returning DB stream across transaction boundary

Broken.

## 35.4 Returning parallel stream unexpectedly

Common-pool surprise.

## 35.5 Returning stream from mutable internal collection

Live mutation surprise.

## 35.6 Returning stream to avoid pagination

Bad scalability.

## 35.7 Consuming stream twice internally

Illegal.

## 35.8 Closing stream you do not own

Ownership bug.

## 35.9 Forgetting to close stream you own

Leak.

## 35.10 Hiding side effects in traversal

Bad API semantics.

---

# 36. Production Failure Modes

## 36.1 Stream already operated upon or closed

Cause: API accepted stream and consumed twice.

## 36.2 DB cursor leak

Cause: returned stream not closed.

## 36.3 Closed transaction

Cause: lazy stream consumed outside transaction.

## 36.4 OOM

Cause: caller does `toList()` on unbounded stream.

## 36.5 Security leak

Cause: lazy stream uses mutable auth context.

## 36.6 Inconsistent result

Cause: stream over live mutable collection.

## 36.7 Missing metrics

Cause: processing happens outside service boundary.

## 36.8 Common pool regression

Cause: returned parallel stream.

## 36.9 Hidden IO exception

Cause: exception thrown at terminal operation, not method call.

## 36.10 API misuse

Cause: no docs for one-shot/close/order/null semantics.

---

# 37. Best Practices

## 37.1 Do not use Stream as default API type

Use it intentionally.

## 37.2 Prefer Collection/Iterable for input

Unless laziness is essential.

## 37.3 Prefer List/Page/result wrapper for output

Unless stream laziness is required.

## 37.4 Name resource streams with `open`

Make ownership visible.

## 37.5 Use try-with-resources for resource streams

Always.

## 37.6 Use callback pattern to contain resource lifetime

Especially service/repository layers.

## 37.7 Avoid returning DB stream across transaction boundary

Consume inside boundary.

## 37.8 Return sequential streams by default

Let caller opt into parallel.

## 37.9 Document null/order/close/laziness/exceptions

No hidden semantics.

## 37.10 Test lifecycle behavior

Close, one-shot, lazy exceptions, snapshot/live.

---

# 38. Decision Matrix

| Situation | Recommended API |
|---|---|
| normal batch input | `Collection<T>` or `Iterable<T>` |
| input order/index matters | `List<T>` |
| input unique set | `Set<T>` |
| output bounded ordered result | `List<T>` |
| output large client-facing query | `Page<T>`/`Slice<T>` |
| output has metadata/errors | result wrapper |
| internal lazy source no resource | `Stream<T>` acceptable |
| resource-backed lazy source | `openStream()` + close docs or callback |
| DB cursor | callback/transaction boundary or cursor abstraction |
| need repeatable traversal | `Collection<T>` or `Supplier<Stream<T>>` |
| need external HTTP streaming | framework-specific streaming response |
| traversal has side effects | domain-specific API, not plain Stream |
| caller must not manage lifecycle | callback |
| source mutable but snapshot desired | return `List.copyOf(...).stream()` or list |
| caller needs size | return collection/page, not stream |
| exception handling complex | loop/callback/result object |
| future metadata likely | result wrapper |

---

# 39. Latihan

## Latihan 1 — Stream Parameter Refactor

Refactor `void process(Stream<Order> orders)` into a safer API.

## Latihan 2 — Resource Stream Naming

Rename `Stream<String> lines(Path path)` and write Javadoc close contract.

## Latihan 3 — Callback Pattern

Implement `withLines(Path, Function<Stream<String>, R>)`.

## Latihan 4 — Transaction Boundary

Explain why repository stream consumed outside transaction fails. Refactor.

## Latihan 5 — Snapshot vs Live Stream

Create method returning `internalList.stream()` and demonstrate mutation before terminal operation.

## Latihan 6 — Pagination Alternative

Replace `Stream<UserDto> searchUsers(...)` with `Page<UserDto>`.

## Latihan 7 — Supplier Pattern

Design `Supplier<Stream<T>>` for repeatable in-memory traversal, then discuss resource risks.

## Latihan 8 — Parallel Surprise

Show why returning `parallelStream()` from API can harm caller.

## Latihan 9 — Stream API Documentation

Write docs covering one-shot, laziness, close, ordering, null, exceptions.

## Latihan 10 — API Review

Pick one existing Stream-returning method and decide whether to keep, rename, wrap, or replace.

---

# 40. Ringkasan

Streams in API design require careful contracts.

Core lessons:

- `Stream` as API type means lazy, one-shot pipeline.
- Do not use Stream as default parameter type.
- Prefer `Iterable`/`Collection`/`List`/`Set`/`Map` for ordinary APIs.
- Return Stream only when laziness/composability is intended.
- Resource-backed streams must have explicit close ownership.
- Naming like `openStream` helps communicate lifecycle.
- DB streams need transaction boundary discipline.
- Service/controller APIs often should return collections/pages/result wrappers instead.
- Stream is not pagination.
- Cursor/callback patterns can be safer for large/resource-backed data.
- `Supplier<Stream<T>>` solves one-shot but adds lifecycle concerns.
- Lazy streams shift exception timing to terminal operation.
- Stream APIs need explicit null/order/parallel/side-effect/snapshot contracts.
- Avoid surprising callers with parallel streams.
- Test lifecycle behavior, not just element values.

Main rule:

```text
Expose Stream only when the API intentionally promises lazy one-shot traversal.
If the caller simply needs data, return a collection, page, cursor, or result object.
```

---

# 41. Referensi

1. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

2. Java SE 25 — `BaseStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/BaseStream.html

3. Java SE 25 — `Collection`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html

4. Java SE 25 — `Iterable`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Iterable.html

5. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

6. Java SE 25 — `StreamSupport`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/StreamSupport.html

7. Java SE 25 — `Files.lines`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html#lines(java.nio.file.Path)

8. Java SE 25 — `AutoCloseable`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/AutoCloseable.html

9. Java SE 25 — `Spliterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterator.html

10. OpenJDK — Stream API source  
    https://github.com/openjdk/jdk/tree/master/src/java.base/share/classes/java/util/stream

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-048.md](./learn-java-collections-and-streams-part-048.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-050.md](./learn-java-collections-and-streams-part-050.md)

</div>
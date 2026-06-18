# learn-java-collections-and-streams-part-050.md

# Java Collections and Streams — Part 050  
# Collections and Persistence: ORM Collections, Lazy Loading, Dirty Checking, Cascades, Orphan Removal, N+1, Pagination, Batch Processing, DTO Mapping, and Domain Boundary Design

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **050**  
> Fokus: memahami hubungan antara Java Collections dan persistence layer. Kita akan membahas collection di JPA/Hibernate style ORM, lazy/eager loading, persistent collections, dirty checking, cascade, orphan removal, equals/hashCode, `List` vs `Set` vs `Map`, ordering, pagination, N+1, fetch join, DTO projections, repository stream, transaction boundaries, batch processing, dan cara menjaga domain model/API tidak bocor oleh detail persistence.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Persistence Collection Bukan Collection Biasa](#2-mental-model-persistence-collection-bukan-collection-biasa)
3. [Domain Collection vs Persistence Collection](#3-domain-collection-vs-persistence-collection)
4. [ORM Persistent Collections](#4-orm-persistent-collections)
5. [Lazy Loading](#5-lazy-loading)
6. [Eager Loading](#6-eager-loading)
7. [LazyInitialization Problem](#7-lazyinitialization-problem)
8. [Transaction Boundary](#8-transaction-boundary)
9. [N+1 Query Problem](#9-n1-query-problem)
10. [Fetch Join and Entity Graphs](#10-fetch-join-and-entity-graphs)
11. [Pagination with Collections](#11-pagination-with-collections)
12. [Collection Size and Count Queries](#12-collection-size-and-count-queries)
13. [Dirty Checking](#13-dirty-checking)
14. [Replacing Collection vs Mutating Collection](#14-replacing-collection-vs-mutating-collection)
15. [Cascade Semantics](#15-cascade-semantics)
16. [Orphan Removal](#16-orphan-removal)
17. [`List` in Persistence](#17-list-in-persistence)
18. [`Set` in Persistence](#18-set-in-persistence)
19. [`Map` in Persistence](#19-map-in-persistence)
20. [Ordering: `@OrderBy`, `@OrderColumn`, and Query Order](#20-ordering-orderby-ordercolumn-and-query-order)
21. [Duplicates and Bags](#21-duplicates-and-bags)
22. [Entity Equality and Hash Collections](#22-entity-equality-and-hash-collections)
23. [Mutable Entities in Sets](#23-mutable-entities-in-sets)
24. [Embeddable/Value Object Collections](#24-embeddablevalue-object-collections)
25. [Large Collections](#25-large-collections)
26. [Streaming from Repository](#26-streaming-from-repository)
27. [Batch Processing](#27-batch-processing)
28. [DTO Projection vs Entity Graph](#28-dto-projection-vs-entity-graph)
29. [Mapping Entities to DTO Collections](#29-mapping-entities-to-dto-collections)
30. [Avoiding Persistence Leakage](#30-avoiding-persistence-leakage)
31. [Repository API Design](#31-repository-api-design)
32. [Domain API Design with Persistence Constraints](#32-domain-api-design-with-persistence-constraints)
33. [Concurrency and Stale Collections](#33-concurrency-and-stale-collections)
34. [Caching and Collections](#34-caching-and-collections)
35. [Testing Persistence Collections](#35-testing-persistence-collections)
36. [Observability and Diagnostics](#36-observability-and-diagnostics)
37. [Common Anti-Patterns](#37-common-anti-patterns)
38. [Production Failure Modes](#38-production-failure-modes)
39. [Best Practices](#39-best-practices)
40. [Decision Matrix](#40-decision-matrix)
41. [Latihan](#41-latihan)
42. [Ringkasan](#42-ringkasan)
43. [Referensi](#43-referensi)

---

# 1. Tujuan Bagian Ini

Collections di domain/in-memory terlihat sederhana:

```java
class Order {
    private final List<OrderLine> lines = new ArrayList<>();
}
```

Tetapi saat collection dipersist via ORM, behavior-nya berubah.

Collection bisa menjadi:

- lazy proxy;
- persistent wrapper;
- dirty-checking aware collection;
- collection dengan cascade/orphan behavior;
- collection yang query-nya baru jalan saat diakses;
- collection yang tergantung transaction/session;
- collection yang dapat menyebabkan N+1 query;
- collection yang replacement vs mutation-nya punya arti berbeda;
- collection yang ordering-nya tergantung annotation/query;
- collection yang tidak cocok untuk `equals/hashCode` tertentu.

Contoh bug umum:

```java
List<OrderDto> result = orders.stream()
    .map(order -> new OrderDto(
        order.id(),
        order.lines().stream()
            .map(OrderLineDto::from)
            .toList()
    ))
    .toList();
```

Jika `orders` berisi 100 order dan `lines()` lazy, ini bisa memicu 101 query atau gagal jika transaction sudah closed.

Tujuan bagian ini:

- memahami collection behavior di persistence layer;
- menghindari N+1 dan lazy loading bugs;
- mendesain collection domain yang aman dengan ORM;
- memahami `List`/`Set`/`Map` persistence trade-off;
- mendesain repository/API yang tidak mengembalikan collection berbahaya;
- memahami DTO projection, pagination, batching, stream/cursor lifecycle;
- membuat mental model production-grade.

---

# 2. Mental Model: Persistence Collection Bukan Collection Biasa

In-memory collection:

```text
data sudah ada di memory
akses murah
tidak butuh transaction
tidak ada SQL saat get/iterate
```

Persistent collection:

```text
bisa lazy
bisa proxy/wrapper
akses bisa trigger query
perubahan bisa terdeteksi ORM
lifecycle tergantung persistence context
mutation punya cascade/orphan semantics
```

## 2.1 Important shift

Calling:

```java
order.lines().size()
```

mungkin bukan sekadar membaca memory.

Bisa memicu SQL.

## 2.2 Main rule

```text
When a collection is backed by persistence, every access may have database semantics.
```

---

# 3. Domain Collection vs Persistence Collection

Domain collection fokus pada business rules:

```text
order lines must be positive
roles cannot be empty
history is append-only
```

Persistence collection fokus pada storage mapping:

```text
one-to-many
join table
foreign key
lazy proxy
cascade
orphan removal
```

## 3.1 Tension

Domain ingin encapsulation:

```java
order.addLine(product, quantity)
```

ORM sering ingin mutable field:

```java
private List<OrderLineEntity> lines = new ArrayList<>();
```

## 3.2 Strategy

- keep collection field private;
- expose snapshots;
- mutate through domain methods;
- let ORM access fields if needed;
- map entity <-> domain if separating models.

## 3.3 Rule

Persistence collection mechanics should not become your public domain API.

---

# 4. ORM Persistent Collections

ORM may replace your collection with implementation wrapper.

Example conceptual:

```java
private List<OrderLine> lines = new ArrayList<>();
```

At runtime might become:

```text
PersistentBag
PersistentList
PersistentSet
```

depending ORM.

## 4.1 Why wrapper exists

- lazy loading;
- dirty checking;
- snapshot comparison;
- cascade operations;
- orphan detection.

## 4.2 Consequence

Do not assume exact implementation type.

Bad:

```java
ArrayList<OrderLine> lines
```

Better:

```java
List<OrderLine> lines
```

## 4.3 Rule

Persistence-managed collection fields should use interface types, not concrete implementation assumptions.

---

# 5. Lazy Loading

Lazy loading means collection data is loaded when accessed.

```java
Order order = repository.findById(id);
List<OrderLine> lines = order.lines(); // may load now or later
```

## 5.1 Benefits

Avoid loading unnecessary data.

## 5.2 Risks

- N+1 queries;
- access outside transaction;
- unpredictable latency;
- serialization accidentally triggers load;
- logging/toString triggers load.

## 5.3 Rule

Lazy loading is useful but must be controlled at query/service boundary.

---

# 6. Eager Loading

Eager loading loads collection immediately with parent.

## 6.1 Benefits

Avoid lazy access failure.

## 6.2 Risks

- loads too much data;
- cartesian explosion;
- memory spike;
- slow queries;
- unnecessary joins.

## 6.3 Rule

Eager is not a universal fix for lazy loading problems.

---

# 7. LazyInitialization Problem

Lazy collection needs active persistence context/session.

Bad:

```java
Order order = service.findOrder(id); // transaction ended
order.lines().size(); // fails if lazy
```

## 7.1 Typical cause

Returning entity with lazy collection outside transaction.

## 7.2 Fix options

- map to DTO inside transaction;
- fetch required association explicitly;
- use projection query;
- use application service method that returns ready result;
- avoid exposing entity to web/API layer.

## 7.3 Rule

Do not let lazy entity collections escape beyond their valid persistence context unless initialized intentionally.

---

# 8. Transaction Boundary

Transaction defines when lazy collection can load and when dirty changes flush.

## 8.1 Good

```java
@Transactional
OrderDto getOrder(OrderId id) {
    Order order = orderRepository.findWithLines(id);
    return OrderDto.from(order);
}
```

DTO mapping happens inside transaction.

## 8.2 Risky

```java
@Transactional
Order findOrder(OrderId id) {
    return orderRepository.findById(id);
}
```

Caller later accesses lazy collection outside transaction.

## 8.3 Rule

Application service should return DTO/domain result that is fully safe outside transaction.

---

# 9. N+1 Query Problem

N+1 occurs when loading parent list and lazily accessing collection per parent.

```java
List<Order> orders = repository.findRecentOrders();

for (Order order : orders) {
    order.lines().size(); // query per order
}
```

If 100 orders:

```text
1 query for orders
100 queries for lines
```

## 9.1 Stream hides N+1

```java
orders.stream()
    .map(order -> OrderDto.from(order, order.lines()))
    .toList();
```

Looks clean, but may issue many queries.

## 9.2 Rule

Streams do not eliminate database access; they can hide it.

---

# 10. Fetch Join and Entity Graphs

To avoid N+1, fetch required associations upfront.

## 10.1 Fetch join concept

```sql
select o from Order o join fetch o.lines where ...
```

## 10.2 Entity graph concept

Declare graph of associations to load.

## 10.3 Caution

Fetching multiple collections can cause row multiplication/cartesian explosion.

## 10.4 Rule

Fetch exactly what the use case needs, not everything.

---

# 11. Pagination with Collections

Pagination plus collection fetch is tricky.

## 11.1 Parent pagination

You want page of orders.

## 11.2 Collection fetch join issue

Joining lines duplicates rows, which can break pagination semantics if applied at SQL row level.

## 11.3 Safer strategy

- page parent IDs first;
- fetch children for those IDs;
- assemble DTO;
- use projection query;
- use batch/subselect fetching depending ORM.

## 11.4 Rule

Do not naively fetch join large collection with pagination without understanding SQL shape.

---

# 12. Collection Size and Count Queries

Calling:

```java
order.lines().size()
```

may:

- use initialized collection size;
- trigger loading entire collection;
- issue count query depending ORM/config;
- be inefficient.

## 12.1 Better for counts

Use dedicated query:

```java
long countLinesByOrderId(OrderId id)
```

## 12.2 Rule

For large collections, count/query explicitly instead of materializing collection.

---

# 13. Dirty Checking

ORM tracks changes to managed entities/collections.

```java
order.addLine(line);
```

At flush/commit, ORM detects and persists changes.

## 13.1 Collection wrapper matters

Replacing collection may confuse orphan/dirty tracking depending mapping/provider.

## 13.2 Mutate managed collection

Often safer:

```java
this.lines.add(line);
```

than:

```java
this.lines = new ArrayList<>(newLines);
```

especially with orphan removal.

## 13.3 Rule

For ORM-managed collections, understand whether mutation or replacement is expected.

---

# 14. Replacing Collection vs Mutating Collection

Bad pattern:

```java
public void setLines(List<OrderLine> lines) {
    this.lines = lines;
}
```

Problems:

- bypasses invariants;
- may break ORM wrapper;
- may confuse orphan removal;
- caller owns collection;
- null/duplicates unchecked.

Better:

```java
public void replaceLines(Collection<OrderLine> newLines) {
    requireDraft();
    this.lines.clear();
    for (OrderLine line : newLines) {
        addLine(line);
    }
}
```

## 14.1 Rule

If replacement is allowed, implement it through controlled mutation and invariant checks.

---

# 15. Cascade Semantics

Cascade defines operations propagated from parent to child.

Examples:

```text
persist parent -> persist children
remove parent -> remove children
merge parent -> merge children
```

## 15.1 Danger

Cascade remove can delete more than intended.

## 15.2 Rule

Cascade should match aggregate ownership semantics, not convenience.

---

# 16. Orphan Removal

Orphan removal means child removed from parent collection is deleted.

```java
order.removeLine(lineId);
```

If line is orphan, delete it.

## 16.1 Good for aggregate-owned children

Order owns OrderLine.

## 16.2 Dangerous for shared children

If child can belong elsewhere, orphan removal may be wrong.

## 16.3 Rule

Use orphan removal only when parent truly owns child lifecycle.

---

# 17. `List` in Persistence

List may represent:

- ordered collection;
- bag with duplicates;
- index column order;
- insertion order in memory but not guaranteed by DB unless specified.

## 17.1 If order matters

Persist order explicitly.

Examples:

- order column;
- position field;
- query order by.

## 17.2 If duplicates allowed

List/bag can allow duplicates.

## 17.3 Rule

Do not assume DB returns list in insertion order unless order is specified.

---

# 18. `Set` in Persistence

Set enforces uniqueness in memory by equals/hashCode.

## 18.1 Good

Roles, permissions, tags.

## 18.2 Danger

Mutable entity equality breaks set.

## 18.3 DB uniqueness

Set in Java does not replace database unique constraint.

## 18.4 Rule

If uniqueness is business-critical, enforce in both domain and database.

---

# 19. `Map` in Persistence

Map can model key-value association.

Examples:

```java
Map<Locale, Translation>
Map<ProductId, Price>
Map<AttributeName, AttributeValue>
```

## 19.1 Good

When lookup by key is central.

## 19.2 Danger

Map key must be stable and persistable.

## 19.3 Rule

Use map when key semantics are domain-relevant, not just to avoid searching.

---

# 20. Ordering: `@OrderBy`, `@OrderColumn`, and Query Order

Ordering strategies:

## 20.1 Query order

Order result in query.

```sql
order by created_at desc
```

## 20.2 Order by child property

ORM annotation or query.

## 20.3 Order column

Persist position/index.

## 20.4 Domain position

Explicit value object:

```java
LineNumber
StepOrder
```

## 20.5 Rule

If order is business data, store it explicitly.

---

# 21. Duplicates and Bags

ORM list without index can behave like bag.

## 21.1 Bag

Allows duplicates, no persistent index.

## 21.2 Problem

Multiple bag fetches can be problematic in ORM due row multiplication.

## 21.3 Rule

Model duplicates intentionally; do not accidentally use bag semantics.

---

# 22. Entity Equality and Hash Collections

Entity equality is hard.

## 22.1 ID assigned after persist

Before persist, id may be null.

If equals/hashCode uses id, behavior changes after persist.

## 22.2 Business key

May be mutable.

If used in hashCode and changes while in Set, set breaks.

## 22.3 Rule

Be extremely cautious using entities in HashSet/HashMap keys.

---

# 23. Mutable Entities in Sets

Bad scenario:

```java
Set<User> users = new HashSet<>();
users.add(user);

user.setEmail("new@example.com"); // email part of hashCode

users.contains(user); // may be false
```

## 23.1 Fix

- immutable equality fields;
- use stable id;
- avoid mutable entity set;
- use Map by stable ID.

## 23.2 Rule

Mutable hash fields and hash-based collections do not mix.

---

# 24. Embeddable/Value Object Collections

Collections of value objects are often safer.

Example:

```java
List<Address>
Set<Permission>
List<Money>
```

## 24.1 Value object traits

- immutable;
- equality by value;
- no identity lifecycle.

## 24.2 Persistence

May map as element collection or separate table.

## 24.3 Rule

Value object collections are good fit for immutable copy/set semantics.

---

# 25. Large Collections

Large persistent collections are dangerous to load.

Examples:

- customer with millions of transactions;
- case with huge audit events;
- product with huge inventory movements.

## 25.1 Avoid

```java
customer.transactions().stream()
```

if collection can be huge.

## 25.2 Better

Query repository:

```java
Page<Transaction> findTransactions(CustomerId id, PageRequest page)
```

## 25.3 Rule

Do not model unbounded history as always-loaded child collection.

---

# 26. Streaming from Repository

Repository may return:

```java
Stream<Record> streamAll()
```

## 26.1 Requirements

- active transaction;
- close stream;
- avoid collecting all if huge;
- handle exceptions;
- avoid leaking stream outside service.

## 26.2 Good service pattern

```java
@Transactional(readOnly = true)
void export(ExportSink sink) {
    try (Stream<Record> records = repository.streamAll()) {
        records.forEach(sink::write);
    }
}
```

## 26.3 Rule

Repository streams should be consumed and closed inside controlled boundary.

---

# 27. Batch Processing

Batch persistence avoids loading/holding too much.

## 27.1 Pattern

- fetch page/chunk;
- process;
- flush/clear if ORM;
- repeat.

## 27.2 Avoid

```java
repository.findAll().stream()
```

for large table.

## 27.3 Rule

Batch processing is usually safer than giant collection or unmanaged stream.

---

# 28. DTO Projection vs Entity Graph

If only read API needs data, DTO projection may be better than entity graph.

## 28.1 Entity graph

Loads entities and associations.

## 28.2 DTO projection

Query selects exactly required fields.

## 28.3 Benefit

- less memory;
- no lazy issue;
- avoids exposing entities;
- stable API shape.

## 28.4 Rule

For read-only views, prefer query/projection shaped to use case.

---

# 29. Mapping Entities to DTO Collections

Mapping entity collections can trigger lazy loads.

Bad if not fetched:

```java
OrderDto.from(order)
```

inside stream and accesses `order.lines()`.

## 29.1 Good

Fetch needed data first.

## 29.2 Better

Projection query returns DTO directly.

## 29.3 Rule

DTO mapping should not accidentally query per element.

---

# 30. Avoiding Persistence Leakage

Persistence leakage examples:

```java
public List<OrderLine> getLines() // returns ORM-managed collection
```

or:

```java
@Transactional
public Stream<Order> findAll()
```

exposed to controller.

## 30.1 Better

- expose domain methods;
- return DTO/read model;
- return snapshots;
- use repository inside service boundary.

## 30.2 Rule

Do not expose ORM-managed collections beyond persistence/application layer casually.

---

# 31. Repository API Design

Repository should express data access use case.

## 31.1 Bad

```java
List<Order> findAll()
```

for large data.

## 31.2 Better

```java
Optional<Order> findById(OrderId id)
Page<OrderSummary> search(OrderQuery query, PageRequest page)
List<Order> findByIds(Collection<OrderId> ids)
Stream<Order> openStreamForExport(...)
```

## 31.3 Rule

Repository collection return should reflect size, shape, and lifecycle.

---

# 32. Domain API Design with Persistence Constraints

Domain should protect invariants while still satisfying ORM.

## 32.1 Field access

Keep private collection field.

## 32.2 No public setter

Use domain methods.

## 32.3 Protected constructor for ORM if needed

Keep business constructor/factory.

## 32.4 Rule

Persistence constraints may shape implementation but should not weaken domain API.

---

# 33. Concurrency and Stale Collections

Persistent collections can become stale.

## 33.1 Two transactions

Transaction A loads order lines.

Transaction B modifies lines.

Transaction A still sees old collection unless refreshed.

## 33.2 Optimistic locking

Use versioning on aggregate.

## 33.3 Rule

Collection consistency across transactions needs locking/version strategy.

---

# 34. Caching and Collections

Cached collections can be stale or huge.

## 34.1 Second-level cache

Can cache associations depending ORM.

## 34.2 Application cache

Avoid caching mutable collections directly.

## 34.3 Rule

Cache immutable snapshots or read models, not live mutable persistent collections.

---

# 35. Testing Persistence Collections

Test:

## 35.1 Lazy access outside transaction

Should fail or be avoided.

## 35.2 N+1

Use SQL count/log assertion.

## 35.3 Cascade/orphan

Remove child and verify DB effect.

## 35.4 Ordering

Persist and reload; verify order.

## 35.5 Equality in Set

Persist/mutate and verify behavior.

## 35.6 Pagination

Ensure parent/child fetch does not break page.

## 35.7 Rule

Persistence collection tests must include SQL behavior, not only Java object state.

---

# 36. Observability and Diagnostics

Monitor:

- SQL query count;
- slow queries;
- collection fetch count;
- rows returned;
- persistence context size;
- memory allocation;
- transaction duration;
- connection pool usage;
- lazy load exceptions;
- batch flush time.

## 36.1 Tools

- SQL logging;
- ORM statistics;
- datasource proxy;
- APM traces;
- database query plans;
- JFR allocation/profiling.

## 36.2 Rule

Collection persistence bugs are visible in SQL and transaction metrics.

---

# 37. Common Anti-Patterns

## 37.1 Exposing ORM collection directly

Breaks invariants/lifecycle.

## 37.2 Stream mapping lazy collection causing N+1

Hidden SQL.

## 37.3 Eager everything

Memory/performance disaster.

## 37.4 Returning DB stream to controller

Lifecycle leak.

## 37.5 `findAll()` on huge table

OOM risk.

## 37.6 HashSet with mutable entity equality

Broken set.

## 37.7 Relying on DB order without order by

Flaky order.

## 37.8 Replacing managed collection field

Dirty/orphan tracking bug.

## 37.9 Cascade remove on shared child

Data loss.

## 37.10 DTO serialization of entity graph

Accidental lazy loading/huge response.

---

# 38. Production Failure Modes

## 38.1 N+1 query storm

Cause: stream DTO mapping accesses lazy child collection.

## 38.2 LazyInitializationException

Cause: collection accessed outside transaction.

## 38.3 OOM

Cause: loading huge collection or findAll.

## 38.4 Slow pagination

Cause: fetch join collection with row explosion.

## 38.5 Missing delete

Cause: orphan removal not triggered due replacement/mapping issue.

## 38.6 Accidental delete

Cause: cascade/orphan on shared child.

## 38.7 Duplicate rows/DTOs

Cause: join fetch collection duplicates parent rows.

## 38.8 Wrong order

Cause: no persisted/query order.

## 38.9 Set corruption

Cause: mutable hash fields.

## 38.10 DB cursor leak

Cause: repository stream not closed.

---

# 39. Best Practices

## 39.1 Keep ORM collections private

Expose domain methods/snapshots.

## 39.2 Avoid returning entities to controller

Map to DTO/read model inside transaction.

## 39.3 Fetch per use case

Do not rely on random lazy access.

## 39.4 Detect N+1 early

Use SQL logs/tests.

## 39.5 Use pagination for large results

Avoid `findAll()`.

## 39.6 Use projection for read-only views

Select exactly what is needed.

## 39.7 Be careful with Set of entities

Prefer map by stable ID when appropriate.

## 39.8 Specify ordering explicitly

Query order/order column/domain position.

## 39.9 Consume repository streams inside transaction and close

Use try-with-resources.

## 39.10 Align cascade/orphan with aggregate ownership

Not convenience.

---

# 40. Decision Matrix

| Situation | Recommendation |
|---|---|
| small aggregate-owned children | private collection + domain methods |
| huge child collection | repository query/page, not aggregate list |
| read-only API view | DTO projection |
| write aggregate with children | fetch aggregate with needed children |
| lazy collection needed | access inside transaction |
| controller needs response | map to DTO inside service |
| export large data | repository stream consumed in service or batch pages |
| pagination with children | page parent IDs then fetch children |
| uniqueness in DB | domain validation + DB unique constraint |
| entity in set | ensure stable equality or avoid |
| order matters | persist/query order explicitly |
| child lifecycle owned by parent | cascade/orphan may fit |
| child shared elsewhere | avoid orphan/cascade remove |
| partial update collection | mutate managed collection through methods |
| count children | count query, not load all |
| avoid N+1 | fetch join/entity graph/batch/projection |
| avoid persistence leakage | return read model/snapshot |

---

# 41. Latihan

## Latihan 1 — N+1 Detection

Given `orders.stream().map(OrderDto::from).toList()`, identify where lazy collection access may cause N+1.

## Latihan 2 — DTO Mapping Boundary

Refactor service to fetch order with lines and map to DTO inside transaction.

## Latihan 3 — Large Collection

Refactor `customer.transactions()` into paginated repository query.

## Latihan 4 — Set Equality Bug

Create entity with mutable email in hashCode, put in HashSet, mutate email, observe issue.

## Latihan 5 — Orphan Removal

Explain when removing child from parent collection should delete row.

## Latihan 6 — Cascade Danger

Explain why cascade remove on shared lookup entity is dangerous.

## Latihan 7 — Repository Stream

Write service method consuming `Stream<Record>` with try-with-resources inside transaction.

## Latihan 8 — Pagination with Children

Design two-step query: page order IDs, then fetch lines for those IDs.

## Latihan 9 — Ordering

Model ordered workflow steps with persisted position.

## Latihan 10 — Persistence Leak Review

Find an API returning ORM-managed collection and refactor to snapshot/domain method/DTO.

---

# 42. Ringkasan

Collections and persistence require a different mental model.

Core lessons:

- Persistent collections are not ordinary in-memory collections.
- Accessing collection can trigger SQL.
- Lazy loading must be controlled by transaction/service boundary.
- Eager loading is not universal fix.
- Streams can hide N+1 queries.
- Fetch per use case with join/entity graph/projection/batching.
- Pagination with fetched collections is tricky.
- Dirty checking depends on managed collection behavior.
- Mutating collection and replacing collection are not equivalent in ORM.
- Cascade and orphan removal must match aggregate ownership.
- `List`, `Set`, and `Map` have persistence-specific trade-offs.
- Ordering must be explicit if it matters.
- Entity equality is dangerous in hash-based collections.
- Large child collections should be queried/paged, not always loaded as aggregate state.
- Repository streams require transaction and close discipline.
- DTO projection often beats entity graph for read APIs.
- Do not leak ORM-managed collections to controllers/API.
- Test SQL behavior, not only Java state.

Main rule:

```text
When a collection is persistence-backed,
treat every access, mutation, iteration, and stream pipeline
as a possible database operation with lifecycle, transaction,
performance, and consistency consequences.
```

---

# 43. Referensi

1. Jakarta Persistence — Entity Relationships  
   https://jakarta.ee/specifications/persistence/

2. Hibernate ORM Documentation — Collections  
   https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html#collections

3. Hibernate ORM Documentation — Fetching  
   https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html#fetching

4. Hibernate ORM Documentation — Bytecode Enhancement and Dirty Checking  
   https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html#BytecodeEnhancement

5. Spring Data JPA Reference — Repositories  
   https://docs.spring.io/spring-data/jpa/reference/

6. Spring Data JPA Reference — Query Methods  
   https://docs.spring.io/spring-data/jpa/reference/jpa/query-methods.html

7. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

8. Java SE 25 — `Set`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html

9. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

10. Java SE 25 — `Stream`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Collections and Streams — Part 049](./learn-java-collections-and-streams-part-049.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Collections and Streams — Part 052](./learn-java-collections-and-streams-part-052.md)

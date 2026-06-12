# learn-java-collections-and-streams-part-055.md

# Java Collections and Streams — Part 055  
# Advanced Map Patterns: Indexes, Multimaps, Frequency Maps, Composite Keys, Bidirectional Lookups, Canonicalization, Merge Policies, Caches, Dispatch Tables, and Domain-Safe Map Design

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **055**  
> Fokus: memahami `Map` bukan hanya sebagai key-value container, tetapi sebagai building block untuk indexing, aggregation, lookup optimization, domain modeling, cache, dispatch table, deduplication, relationship modeling, and consistency control. Kita akan membahas pattern-pattern `Map` advanced yang sering muncul di backend production systems.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Map = Relationship, Index, and Policy](#2-mental-model-map--relationship-index-and-policy)
3. [Basic Map Questions](#3-basic-map-questions)
4. [Lookup Map](#4-lookup-map)
5. [Index Map](#5-index-map)
6. [Unique Index](#6-unique-index)
7. [Non-Unique Index / Multimap](#7-non-unique-index--multimap)
8. [Frequency Map](#8-frequency-map)
9. [Counter Map with `merge`](#9-counter-map-with-merge)
10. [Counter Map with `LongAdder`](#10-counter-map-with-longadder)
11. [Grouping Map](#11-grouping-map)
12. [Partition Map](#12-partition-map)
13. [Composite Key Map](#13-composite-key-map)
14. [Nested Map vs Composite Key](#14-nested-map-vs-composite-key)
15. [Bidirectional Map Pattern](#15-bidirectional-map-pattern)
16. [Reverse Lookup Map](#16-reverse-lookup-map)
17. [Canonicalization Map](#17-canonicalization-map)
18. [Interning Pattern](#18-interning-pattern)
19. [Deduplication Map](#19-deduplication-map)
20. [Merge Policy Map](#20-merge-policy-map)
21. [Latest-Wins and First-Wins](#21-latest-wins-and-first-wins)
22. [Conflict-Detecting Map](#22-conflict-detecting-map)
23. [Map as Dispatch Table](#23-map-as-dispatch-table)
24. [Map as Strategy Registry](#24-map-as-strategy-registry)
25. [Map as State Machine Transition Table](#25-map-as-state-machine-transition-table)
26. [Map as Permission Matrix](#26-map-as-permission-matrix)
27. [Map as Cache](#27-map-as-cache)
28. [Read-Through Cache Pattern](#28-read-through-cache-pattern)
29. [Write-Through and Write-Behind](#29-write-through-and-write-behind)
30. [Map as Identity Map](#30-map-as-identity-map)
31. [Map as Unit-of-Work Support](#31-map-as-unit-of-work-support)
32. [Map as Join/Aggregation Accelerator](#32-map-as-joinaggregation-accelerator)
33. [Map and Ordering](#33-map-and-ordering)
34. [Map Null Policy](#34-map-null-policy)
35. [Map Memory and Leak Risks](#35-map-memory-and-leak-risks)
36. [Concurrency with Advanced Map Patterns](#36-concurrency-with-advanced-map-patterns)
37. [Testing Map Patterns](#37-testing-map-patterns)
38. [Common Anti-Patterns](#38-common-anti-patterns)
39. [Production Failure Modes](#39-production-failure-modes)
40. [Best Practices](#40-best-practices)
41. [Decision Matrix](#41-decision-matrix)
42. [Latihan](#42-latihan)
43. [Ringkasan](#43-ringkasan)
44. [Referensi](#44-referensi)

---

# 1. Tujuan Bagian Ini

`Map<K, V>` sering dianggap sederhana:

```java
value = map.get(key);
map.put(key, value);
```

Tetapi di production backend, `Map` sering menjadi pusat desain:

- index data berdasarkan ID;
- join dua collection;
- detect duplicate;
- group data;
- count frequency;
- cache expensive result;
- route command/event ke handler;
- model permission matrix;
- model state transition;
- implement identity map;
- canonicalize object;
- maintain reverse lookup;
- aggregate errors by field;
- reduce query complexity dari O(n²) ke O(n).

Contoh:

```java
Map<ProductId, Product> productById = products.stream()
    .collect(Collectors.toMap(Product::id, Function.identity()));
```

Ini bukan hanya map. Ini adalah **index**.

Contoh lain:

```java
Map<FieldName, List<ValidationError>> errorsByField
```

Ini bukan hanya map. Ini adalah **error grouping contract**.

Tujuan bagian ini:

- memahami berbagai advanced `Map` patterns;
- memilih key/value design yang benar;
- memahami merge/conflict policy;
- menghindari null ambiguity;
- membedakan nested map vs composite key;
- menggunakan map untuk performance dan domain clarity;
- menghindari concurrency, memory, dan security pitfalls.

---

# 2. Mental Model: Map = Relationship, Index, and Policy

Map merepresentasikan hubungan:

```text
K -> V
```

Tetapi arti domain-nya bisa sangat berbeda:

```text
id -> entity
status -> count
field -> errors
commandType -> handler
(oldState,newEvent) -> transition
tenant+user -> permission
object -> canonical instance
```

Setiap map harus menjawab:

```text
Apa arti key?
Apa arti value?
Apakah key unik?
Apakah missing key valid?
Apakah null key/value valid?
Apa duplicate key policy?
Apakah order map penting?
Apakah map mutable?
Apakah map bounded?
Apakah thread-safe?
```

## 2.1 Main rule

```text
A Map is not just storage; it is a policy about lookup, uniqueness, and association.
```

---

# 3. Basic Map Questions

Sebelum memakai map, jawab:

## 3.1 Key identity

Apakah key stabil dan immutable?

## 3.2 Value ownership

Apakah value boleh dimutate?

## 3.3 Missing key

Return null, Optional, default, or exception?

## 3.4 Duplicate key

Reject, merge, replace, first-wins, latest-wins?

## 3.5 Null

Apakah null key/value allowed?

## 3.6 Ordering

HashMap, LinkedHashMap, TreeMap?

## 3.7 Concurrency

Single-thread, synchronized, concurrent?

## 3.8 Lifecycle

Bounded? Eviction? Clear?

## 3.9 Rule

A production map should have an explicit key, value, missing, duplicate, null, ordering, concurrency, and lifecycle policy.

---

# 4. Lookup Map

Lookup map is the simplest pattern:

```java
Map<UserId, User> userById
```

## 4.1 Use case

Fast lookup by ID.

## 4.2 Build

```java
Map<UserId, User> userById = users.stream()
    .collect(Collectors.toMap(User::id, Function.identity()));
```

## 4.3 Missing key handling

Avoid raw null ambiguity:

```java
Optional<User> find(UserId id) {
    return Optional.ofNullable(userById.get(id));
}
```

or domain exception:

```java
User require(UserId id) {
    User user = userById.get(id);
    if (user == null) {
        throw new MissingUserException(id);
    }
    return user;
}
```

## 4.4 Rule

A lookup map should hide raw `get` semantics behind meaningful method when possible.

---

# 5. Index Map

Index map is built from collection to speed lookup.

Before:

```java
for (OrderLine line : lines) {
    Product product = products.stream()
        .filter(p -> p.id().equals(line.productId()))
        .findFirst()
        .orElseThrow();
}
```

This is O(n*m).

After:

```java
Map<ProductId, Product> productById = products.stream()
    .collect(Collectors.toMap(Product::id, Function.identity()));

for (OrderLine line : lines) {
    Product product = productById.get(line.productId());
}
```

O(n + m).

## 5.1 Rule

Build indexes when repeated lookup would otherwise scan collections.

---

# 6. Unique Index

Unique index means one key maps to exactly one value.

```java
Map<Email, User> userByEmail
```

## 6.1 Duplicate should fail

```java
Map<Email, User> userByEmail = users.stream()
    .collect(Collectors.toMap(
        User::email,
        Function.identity(),
        (a, b) -> {
            throw new DuplicateEmailException(a.email());
        }
    ));
```

## 6.2 Do not silently overwrite

Unless policy says so.

## 6.3 Rule

If uniqueness is business invariant, duplicate keys should be detected explicitly.

---

# 7. Non-Unique Index / Multimap

One key maps to many values.

Example:

```java
Map<CustomerId, List<Order>> ordersByCustomer
```

Build:

```java
Map<CustomerId, List<Order>> ordersByCustomer = orders.stream()
    .collect(Collectors.groupingBy(Order::customerId));
```

## 7.1 Mutability

`groupingBy` result lists are mutable implementation details unless wrapped.

For boundary:

```java
Map<CustomerId, List<Order>> immutable = ordersByCustomer.entrySet().stream()
    .collect(Collectors.toUnmodifiableMap(
        Map.Entry::getKey,
        e -> List.copyOf(e.getValue())
    ));
```

## 7.2 Rule

A multimap should define whether value lists are mutable, ordered, and duplicate-preserving.

---

# 8. Frequency Map

Frequency map counts occurrences.

```java
Map<Status, Long> countByStatus
```

Using streams:

```java
Map<Status, Long> countByStatus = orders.stream()
    .collect(Collectors.groupingBy(
        Order::status,
        Collectors.counting()
    ));
```

## 8.1 Rule

Frequency map is a domain summary; define missing bucket behavior.

---

# 9. Counter Map with `merge`

Imperative counter:

```java
Map<String, Integer> counts = new HashMap<>();

for (String word : words) {
    counts.merge(word, 1, Integer::sum);
}
```

## 9.1 Why `merge`

Avoids verbose get/put logic.

## 9.2 Removal behavior

If remapping returns null, entry removed.

Be careful.

## 9.3 Rule

Use `merge` for simple counter/accumulator map updates.

---

# 10. Counter Map with `LongAdder`

Concurrent high-throughput counter:

```java
ConcurrentHashMap<String, LongAdder> counts = new ConcurrentHashMap<>();

void record(String key) {
    counts.computeIfAbsent(key, k -> new LongAdder()).increment();
}
```

Read:

```java
long value = Optional.ofNullable(counts.get(key))
    .map(LongAdder::sum)
    .orElse(0L);
```

## 10.1 Rule

Use `LongAdder` for high-contention concurrent counting, but understand `sum()` is snapshot-ish.

---

# 11. Grouping Map

Grouping map stores grouped values:

```java
Map<Department, List<Employee>>
```

## 11.1 Downstream collector

```java
Map<Department, Set<EmployeeId>> idsByDepartment = employees.stream()
    .collect(Collectors.groupingBy(
        Employee::department,
        Collectors.mapping(Employee::id, Collectors.toSet())
    ));
```

## 11.2 Rule

Use downstream collectors to control value shape.

---

# 12. Partition Map

Binary grouping:

```java
Map<Boolean, List<User>> activePartition = users.stream()
    .collect(Collectors.partitioningBy(User::active));
```

## 12.1 Better domain shape

Instead of `Map<Boolean, ...>`:

```java
record UserPartition(List<User> active, List<User> inactive) {}
```

## 12.2 Rule

`Map<Boolean, V>` is often less readable than named result type.

---

# 13. Composite Key Map

Composite key combines multiple dimensions:

```java
record PriceKey(ProductId productId, Currency currency) {}
Map<PriceKey, Money> priceByProductAndCurrency
```

## 13.1 Requirements

Composite key should be:

- immutable;
- compact;
- value-based equality;
- no mutable references;
- normalized.

## 13.2 Rule

Use record/value object for composite key, not string concatenation.

---

# 14. Nested Map vs Composite Key

Nested map:

```java
Map<ProductId, Map<Currency, Money>>
```

Composite key:

```java
Map<PriceKey, Money>
```

## 14.1 Nested map good when

- first dimension frequently queried;
- natural hierarchy;
- you often need all currencies for product.

## 14.2 Composite key good when

- lookup by full key is primary;
- dimensions are symmetric;
- easier atomic operations;
- simpler flat iteration.

## 14.3 Rule

Choose nested map when hierarchy matters; choose composite key when full-key lookup matters.

---

# 15. Bidirectional Map Pattern

Need lookup both ways:

```text
userId -> username
username -> userId
```

## 15.1 Maintain two maps

```java
final class UsernameIndex {
    private final Map<UserId, Username> byId = new HashMap<>();
    private final Map<Username, UserId> byUsername = new HashMap<>();

    void put(UserId id, Username username) {
        if (byUsername.containsKey(username)) {
            throw new DuplicateUsernameException(username);
        }
        Username old = byId.put(id, username);
        if (old != null) {
            byUsername.remove(old);
        }
        byUsername.put(username, id);
    }
}
```

## 15.2 Consistency risk

Both maps must update atomically.

## 15.3 Rule

Bidirectional maps need encapsulation; never expose both maps for arbitrary mutation.

---

# 16. Reverse Lookup Map

Reverse lookup from value to keys.

If values are not unique:

```java
Map<Role, Set<UserId>> userIdsByRole
```

Build:

```java
Map<Role, Set<UserId>> userIdsByRole = users.stream()
    .flatMap(user -> user.roles().stream()
        .map(role -> Map.entry(role, user.id())))
    .collect(Collectors.groupingBy(
        Map.Entry::getKey,
        Collectors.mapping(Map.Entry::getValue, Collectors.toSet())
    ));
```

## 16.1 Rule

Reverse lookup should match value uniqueness: one-to-one or one-to-many.

---

# 17. Canonicalization Map

Canonicalization returns one canonical instance for equivalent values.

```java
Map<Email, Email> canonicalEmails = new HashMap<>();

Email canonicalize(Email email) {
    return canonicalEmails.computeIfAbsent(email.normalized(), key -> email.normalized());
}
```

## 17.1 Use case

Reduce duplicate value objects or ensure identity sharing.

## 17.2 Risk

Unbounded map leak.

## 17.3 Rule

Canonicalization maps need lifecycle/size strategy.

---

# 18. Interning Pattern

Interning is canonicalization.

Example:

```java
Map<String, String> intern = new ConcurrentHashMap<>();

String intern(String value) {
    return intern.computeIfAbsent(value, Function.identity());
}
```

## 18.1 Danger

If values are user-controlled and unbounded, memory leak.

## 18.2 Rule

Do not intern unbounded user input without limits.

---

# 19. Deduplication Map

Dedup by key:

```java
Map<EventId, Event> uniqueEvents = new LinkedHashMap<>();

for (Event event : events) {
    uniqueEvents.putIfAbsent(event.id(), event);
}
```

## 19.1 First-wins

`putIfAbsent`.

## 19.2 Latest-wins

`put`.

## 19.3 Conflict-detecting

Check existing and compare.

## 19.4 Rule

Deduplication must define first/latest/conflict policy.

---

# 20. Merge Policy Map

When duplicate key appears, merge values.

```java
Map<ProductId, Quantity> quantityByProduct = new HashMap<>();

for (OrderLine line : lines) {
    quantityByProduct.merge(
        line.productId(),
        line.quantity(),
        Quantity::add
    );
}
```

## 20.1 Rule

Use merge when duplicate keys represent combinable facts.

---

# 21. Latest-Wins and First-Wins

## 21.1 Latest-wins

```java
map.put(key, value);
```

or collector:

```java
Collectors.toMap(
    Item::key,
    Function.identity(),
    (oldValue, newValue) -> newValue
)
```

## 21.2 First-wins

```java
map.putIfAbsent(key, value);
```

or:

```java
(oldValue, newValue) -> oldValue
```

## 21.3 Rule

First/latest-wins should be documented because both can hide conflicts.

---

# 22. Conflict-Detecting Map

Detect conflicting duplicate values.

```java
Map<Key, Value> map = new HashMap<>();

void putOrVerify(Key key, Value value) {
    Value existing = map.putIfAbsent(key, value);
    if (existing != null && !existing.equals(value)) {
        throw new ConflictException(key, existing, value);
    }
}
```

## 22.1 Use case

Data reconciliation, config loading, idempotency.

## 22.2 Rule

Conflict-detecting maps are safer than silent overwrite for critical data.

---

# 23. Map as Dispatch Table

Replace switch/if chain:

```java
Map<CommandType, Consumer<Command>> handlers = Map.of(
    CommandType.CREATE, this::handleCreate,
    CommandType.CANCEL, this::handleCancel
);
```

Dispatch:

```java
Consumer<Command> handler = handlers.get(command.type());
if (handler == null) {
    throw new UnsupportedCommandException(command.type());
}
handler.accept(command);
```

## 23.1 Rule

Dispatch maps are good when keys and handlers are stable and complete.

---

# 24. Map as Strategy Registry

Strategy pattern:

```java
interface PricingStrategy {
    Money price(Quote quote);
}

Map<PricingMode, PricingStrategy> strategies
```

Usage:

```java
PricingStrategy strategy = strategies.get(mode);
if (strategy == null) {
    throw new UnsupportedPricingModeException(mode);
}
return strategy.price(quote);
```

## 24.1 Spring-style injection

```java
Map<String, PricingStrategy> strategies
```

can be injected by bean name.

## 24.2 Rule

Registry maps should validate completeness at startup.

---

# 25. Map as State Machine Transition Table

State machine:

```java
record TransitionKey(State state, EventType eventType) {}

Map<TransitionKey, State> transitions = Map.of(
    new TransitionKey(State.DRAFT, EventType.SUBMIT), State.SUBMITTED,
    new TransitionKey(State.SUBMITTED, EventType.APPROVE), State.APPROVED
);
```

## 25.1 Rule

Transition maps make allowed transitions explicit and testable.

---

# 26. Map as Permission Matrix

Permission matrix:

```java
Map<Role, Set<Action>> allowedActionsByRole
```

or:

```java
Map<PermissionKey, Boolean>
```

## 26.1 Safer method

```java
boolean can(Role role, Action action) {
    return allowedActionsByRole
        .getOrDefault(role, Set.of())
        .contains(action);
}
```

## 26.2 Rule

Security maps should be immutable, complete, and validated.

---

# 27. Map as Cache

Cache map stores computed values.

```java
ConcurrentHashMap<Key, Value> cache = new ConcurrentHashMap<>();
```

## 27.1 Required policy

- size;
- TTL;
- eviction;
- invalidation;
- concurrency;
- error caching;
- negative caching;
- metrics.

## 27.2 Rule

Map is not a production cache until it has lifecycle and bounds.

---

# 28. Read-Through Cache Pattern

```java
Value get(Key key) {
    return cache.computeIfAbsent(key, repository::load);
}
```

## 28.1 Caveat

If load fails, should failure be cached?

Usually no, unless negative caching intentional.

## 28.2 Stampede

Many threads may wait/compete for same key depending implementation.

## 28.3 Rule

Read-through cache must define failure, eviction, and concurrency behavior.

---

# 29. Write-Through and Write-Behind

## 29.1 Write-through

Update DB and cache together.

## 29.2 Write-behind

Update cache, asynchronously persist later.

## 29.3 Risk

Write-behind can lose data if process crashes.

## 29.4 Rule

Cache write policy must match durability requirements.

---

# 30. Map as Identity Map

Identity map ensures one object instance per identity in a unit of work.

```java
Map<EntityId, Entity> identityMap
```

## 30.1 Use case

ORM persistence context.

## 30.2 Benefit

Avoid duplicate entity instances.

## 30.3 Rule

Identity map lifecycle should be scoped, not global unbounded.

---

# 31. Map as Unit-of-Work Support

Track changes:

```java
Map<EntityId, Entity> dirtyEntities
Map<EntityId, Entity> newEntities
Map<EntityId, Entity> removedEntities
```

## 31.1 Rule

Unit-of-work maps must have clear transaction/request lifecycle.

---

# 32. Map as Join/Aggregation Accelerator

Join in memory:

```java
Map<CustomerId, Customer> customerById = customers.stream()
    .collect(Collectors.toMap(Customer::id, Function.identity()));

List<OrderView> views = orders.stream()
    .map(order -> new OrderView(order, customerById.get(order.customerId())))
    .toList();
```

## 32.1 Missing join target

Define policy:

- reject;
- skip;
- unknown placeholder;
- partial result.

## 32.2 Rule

Map-based joins need missing-reference policy.

---

# 33. Map and Ordering

Map choices:

## 33.1 HashMap

No guaranteed iteration order.

## 33.2 LinkedHashMap

Insertion/access order.

## 33.3 TreeMap

Sorted by key.

## 33.4 EnumMap

Enum keys, efficient natural enum order.

## 33.5 Rule

If output order matters, choose ordered map or sort explicitly.

---

# 34. Map Null Policy

Avoid null values in maps.

## 34.1 Ambiguity

```java
map.get(key) == null
```

means absent or present null.

## 34.2 Better

- no null values;
- `Optional` return from method;
- sentinel value;
- explicit containsKey when needed.

## 34.3 Rule

Map API should hide raw null ambiguity.

---

# 35. Map Memory and Leak Risks

Maps often become memory leaks.

Risks:

- unbounded cache;
- user-controlled keys;
- large object graph keys;
- values retaining entity graphs;
- static maps;
- ThreadLocal maps;
- metrics label maps.

## 35.1 Rule

Every long-lived map needs size/lifecycle/eviction monitoring.

---

# 36. Concurrency with Advanced Map Patterns

Concurrent patterns:

## 36.1 Use `ConcurrentHashMap`

For shared mutable maps.

## 36.2 Use atomic methods

```java
computeIfAbsent
merge
putIfAbsent
compute
```

## 36.3 Avoid compound race

```java
if (!map.containsKey(k)) map.put(k, v)
```

## 36.4 Rule

Concurrent map pattern correctness depends on atomic operation choice.

---

# 37. Testing Map Patterns

Test:

- duplicate key;
- missing key;
- null key/value;
- ordering;
- merge policy;
- conflict detection;
- concurrency;
- immutability;
- cache eviction;
- memory bounds;
- reverse map consistency.

## 37.1 Rule

Map tests should test policy, not only happy-path lookup.

---

# 38. Common Anti-Patterns

## 38.1 Using raw `Map<String, Object>` everywhere

Weak contract.

## 38.2 String-concatenated composite keys

Collision/normalization bugs.

## 38.3 Silent overwrite in `toMap`

Data loss.

## 38.4 `Map<Boolean, ...>` domain result

Unreadable.

## 38.5 Null values

Ambiguous.

## 38.6 Unbounded cache map

Leak.

## 38.7 Bidirectional maps exposed separately

Inconsistent.

## 38.8 HashMap order relied upon

Flaky.

## 38.9 Mutable object as key

Lookup failure.

## 38.10 Check-then-put in concurrent map

Race.

---

# 39. Production Failure Modes

## 39.1 Data loss

Duplicate key latest-wins silently overwrites.

## 39.2 Wrong join

Missing reference mapped to null and later NPE.

## 39.3 Memory leak

Unbounded canonicalization/cache map.

## 39.4 Permission bug

Permission matrix mutable or incomplete.

## 39.5 Dispatch failure

Handler map missing new command type.

## 39.6 Flaky response order

HashMap iteration used in API.

## 39.7 Reverse lookup inconsistency

Two maps updated partially.

## 39.8 Cache stampede

Read-through map load not controlled.

## 39.9 Concurrent duplicate initialization

Non-atomic check-put.

## 39.10 Lookup failure

Mutable key hash changes.

---

# 40. Best Practices

## 40.1 Design key as immutable value object

Records are excellent.

## 40.2 Hide raw map behind domain API

Expose `find`, `require`, `can`, `transition`.

## 40.3 Define duplicate policy

Reject, merge, first, latest, conflict.

## 40.4 Avoid null values

Use Optional-returning methods or sentinel.

## 40.5 Use correct map implementation

HashMap, LinkedHashMap, TreeMap, EnumMap, ConcurrentHashMap.

## 40.6 Validate registry completeness

Dispatch/strategy/security maps.

## 40.7 Bound long-lived maps

Eviction/TTL/clear lifecycle.

## 40.8 Use atomic operations in concurrent maps

`computeIfAbsent`, `merge`.

## 40.9 Test policy edge cases

Duplicates, missing, order, concurrency.

## 40.10 Prefer explicit domain types over `Map<String,Object>`

Strong types prevent bugs.

---

# 41. Decision Matrix

| Need | Pattern |
|---|---|
| lookup by ID | `Map<Id, Entity>` |
| repeated join | build index map |
| unique field invariant | unique index with duplicate rejection |
| one key many values | multimap/grouping map |
| count occurrences | frequency map |
| high concurrency count | `ConcurrentHashMap<K, LongAdder>` |
| multi-dimensional lookup | composite key record |
| hierarchical lookup | nested map |
| lookup both directions | encapsulated bidirectional map |
| canonical object reuse | canonicalization map with bounds |
| deduplicate input | first/latest/conflict policy map |
| route command to handler | dispatch table |
| strategy selection | strategy registry |
| state transition | transition table |
| permission check | immutable permission matrix |
| read-through cache | bounded cache with load policy |
| in-memory join | index + missing policy |
| ordered API output | LinkedHashMap/TreeMap/sort |
| concurrent shared map | ConcurrentHashMap + atomic ops |
| long-lived map | lifecycle/eviction metrics |

---

# 42. Latihan

## Latihan 1 — Unique Index

Build `Map<Email, User>` and reject duplicate email.

## Latihan 2 — Multimap

Build `Map<CustomerId, List<Order>>`, then make values immutable.

## Latihan 3 — Composite Key

Create `PriceKey(productId, currency)` record and use it in map.

## Latihan 4 — Nested vs Composite

Model product/currency price lookup both ways and compare.

## Latihan 5 — Bidirectional Map

Implement username index with consistent two-map updates.

## Latihan 6 — Conflict-Detecting Map

Implement `putOrVerify`.

## Latihan 7 — Dispatch Table

Replace switch command handler with `Map<CommandType, Handler>`.

## Latihan 8 — State Transition Table

Implement allowed transitions and tests for unsupported transition.

## Latihan 9 — Read-Through Cache

Implement `computeIfAbsent` cache, then add TTL/size discussion.

## Latihan 10 — Map Join

Join orders to customers using index map and define missing customer policy.

---

# 43. Ringkasan

`Map` is one of the most powerful abstraction tools in Java.

Core lessons:

- Map represents relationship, index, and policy.
- Lookup maps should hide raw null `get`.
- Index maps turn repeated scans into O(1) lookup.
- Unique indexes must reject duplicate keys explicitly.
- Multimaps model one-to-many relationships.
- Frequency maps summarize occurrences.
- Composite keys should be immutable value objects.
- Nested map vs composite key depends on access pattern.
- Bidirectional maps need encapsulation for consistency.
- Canonicalization/interning maps need bounds.
- Deduplication requires first/latest/conflict policy.
- Dispatch/strategy/transition/permission maps make rules explicit.
- Cache maps require eviction/lifecycle.
- Identity maps and unit-of-work maps must be scoped.
- Map-based joins need missing-reference policy.
- Map implementation affects ordering, concurrency, memory, and null handling.
- Long-lived maps are common memory leak sources.
- Concurrent map patterns require atomic operations.

Main rule:

```text
Every Map should have an explicit story for:
key identity, value ownership, missing keys, duplicate keys,
nulls, ordering, concurrency, and lifecycle.
```

---

# 44. Referensi

1. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

2. Java SE 25 — `HashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html

3. Java SE 25 — `LinkedHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedHashMap.html

4. Java SE 25 — `TreeMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeMap.html

5. Java SE 25 — `EnumMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumMap.html

6. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

7. Java SE 25 — `LongAdder`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html

8. Java SE 25 — `Collectors.toMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html#toMap(java.util.function.Function,java.util.function.Function)

9. Java SE 25 — `Collectors.groupingBy`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html#groupingBy(java.util.function.Function)

10. Java SE 25 — `Map.merge`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html#merge(K,V,java.util.function.BiFunction)

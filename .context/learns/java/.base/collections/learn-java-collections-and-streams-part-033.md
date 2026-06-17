# learn-java-collections-and-streams-part-033.md

# Java Collections and Streams — Part 033  
# `toMap` and Duplicate Key Strategy: Key Semantics, Merge Functions, Map Suppliers, Ordering, Null Policy, Concurrent Maps, and Production-Safe Map Collection

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **033**  
> Fokus: memahami `Collectors.toMap(...)` secara production-grade: key uniqueness, duplicate key exception, merge function, first-wins/last-wins/domain merge, `groupingBy` vs `toMap`, map supplier, `LinkedHashMap`, `TreeMap`, `EnumMap`, `IdentityHashMap`, `ConcurrentMap`, null policy, ordering, and failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: `toMap` = One Final Value per Key](#2-mental-model-tomap--one-final-value-per-key)
3. [The Core Question: Are Keys Unique?](#3-the-core-question-are-keys-unique)
4. [Basic `toMap`](#4-basic-tomap)
5. [Duplicate Key Exception](#5-duplicate-key-exception)
6. [Key Equality Semantics](#6-key-equality-semantics)
7. [Value Mapper](#7-value-mapper)
8. [Merge Function](#8-merge-function)
9. [First-Wins Strategy](#9-first-wins-strategy)
10. [Last-Wins Strategy](#10-last-wins-strategy)
11. [Domain Merge Strategy](#11-domain-merge-strategy)
12. [Fail-Fast Explicit Duplicate Strategy](#12-fail-fast-explicit-duplicate-strategy)
13. [When Duplicate Means Use `groupingBy`](#13-when-duplicate-means-use-groupingby)
14. [`toMap` vs `groupingBy`](#14-tomap-vs-groupingby)
15. [Map Supplier](#15-map-supplier)
16. [`LinkedHashMap` for Encounter-Order Maps](#16-linkedhashmap-for-encounter-order-maps)
17. [`TreeMap` for Sorted Keys](#17-treemap-for-sorted-keys)
18. [`EnumMap` for Enum Keys](#18-enummap-for-enum-keys)
19. [`IdentityHashMap` Supplier Warning](#19-identityhashmap-supplier-warning)
20. [`toUnmodifiableMap`](#20-tounmodifiablemap)
21. [`toConcurrentMap`](#21-toconcurrentmap)
22. [Ordering Semantics](#22-ordering-semantics)
23. [Null Keys and Null Values](#23-null-keys-and-null-values)
24. [Composite Keys](#24-composite-keys)
25. [Latest/Oldest per Key](#25-latestoldest-per-key)
26. [Max/Min Score per Key](#26-maxmin-score-per-key)
27. [Sum/Count per Key: `toMap` Merge vs `groupingBy`](#27-sumcount-per-key-tomap-merge-vs-groupingby)
28. [Map of DTOs](#28-map-of-dtos)
29. [Indexing Patterns](#29-indexing-patterns)
30. [Cache/Lookup Map Construction](#30-cachelookup-map-construction)
31. [Parallel Stream Considerations](#31-parallel-stream-considerations)
32. [Performance Cost Model](#32-performance-cost-model)
33. [Testing `toMap` Correctness](#33-testing-tomap-correctness)
34. [Common Anti-Patterns](#34-common-anti-patterns)
35. [Production Failure Modes](#35-production-failure-modes)
36. [Best Practices](#36-best-practices)
37. [Decision Matrix](#37-decision-matrix)
38. [Latihan](#38-latihan)
39. [Ringkasan](#39-ringkasan)
40. [Referensi](#40-referensi)

---

# 1. Tujuan Bagian Ini

`Collectors.toMap(...)` terlihat sederhana:

```java
Map<UserId, User> byId = users.stream()
    .collect(Collectors.toMap(User::id, Function.identity()));
```

Tapi dalam production, `toMap` adalah salah satu collector yang paling sering menyebabkan bug.

Penyebab paling umum:

```text
Duplicate key
```

Contoh:

```java
Map<Role, User> byRole = users.stream()
    .collect(Collectors.toMap(User::role, Function.identity()));
```

Jika ada dua user dengan role yang sama, collector akan gagal.

Masalah lain:

- key equality tidak sesuai;
- value mapper menghasilkan null;
- merge function diam-diam membuang data;
- ordering map tidak sesuai ekspektasi;
- map type default dianggap stabil;
- `toConcurrentMap` dianggap otomatis lebih benar;
- `toUnmodifiableMap` gagal karena null;
- `TreeMap` comparator inconsistent with equals;
- composite key dibuat asal;
- parallel stream dengan merge non-associative;
- `toMap` dipakai padahal yang dibutuhkan `groupingBy`.

Tujuan part ini:

- memahami `toMap` sebagai one-value-per-key collector;
- memahami duplicate key semantics;
- mendesain merge function yang aman;
- memilih map supplier;
- memahami `toMap` vs `groupingBy`;
- memahami null/order/concurrency pitfalls;
- membangun map collection yang production-safe.

---

# 2. Mental Model: `toMap` = One Final Value per Key

`toMap` artinya:

```text
Untuk setiap element T:
  key = keyMapper(T)
  value = valueMapper(T)
Masukkan ke Map<K, U>
```

Karena `Map` hanya punya satu value final per key:

```text
K -> U
```

maka jika dua element menghasilkan key yang sama, harus ada jawaban:

```text
value mana yang menang?
atau bagaimana values digabung?
atau apakah harus fail?
```

## 2.1 Example unique key

```java
Map<UserId, User> byId = users.stream()
    .collect(Collectors.toMap(User::id, Function.identity()));
```

Ini masuk akal jika `UserId` unique.

## 2.2 Example non-unique key

```java
Map<Role, User> byRole = users.stream()
    .collect(Collectors.toMap(User::role, Function.identity()));
```

Role biasanya tidak unique.

Ini salah kecuali ada merge policy.

## 2.3 Main rule

```text
Use toMap only when each key has exactly one final value, or you have explicit merge policy.
```

---

# 3. The Core Question: Are Keys Unique?

Sebelum pakai `toMap`, tanya:

```text
Apakah keyMapper menghasilkan key unique untuk seluruh stream?
```

## 3.1 If yes

Basic `toMap` is okay.

```java
toMap(User::id, Function.identity())
```

## 3.2 If no

Choose:

- merge function;
- `groupingBy`;
- fail-fast custom policy;
- upstream deduplication;
- better key.

## 3.3 If unsure

Do not use basic two-arg `toMap`.

## 3.4 Rule

`toMap` is safe only if uniqueness is guaranteed or duplicate policy is explicit.

---

# 4. Basic `toMap`

Signature conceptually:

```java
toMap(keyMapper, valueMapper)
```

Example:

```java
Map<UserId, String> emailById = users.stream()
    .collect(Collectors.toMap(
        User::id,
        User::email
    ));
```

## 4.1 What happens

For each user:

```text
key = user.id()
value = user.email()
```

## 4.2 Duplicate keys

If duplicate keys exist, `IllegalStateException`.

## 4.3 Map type

Returned map type is not a business guarantee.

## 4.4 Rule

Use basic toMap for unique-key indexing only.

---

# 5. Duplicate Key Exception

This fails:

```java
List<User> users = List.of(
    new User("A", Role.ADMIN),
    new User("B", Role.ADMIN)
);

Map<Role, User> byRole = users.stream()
    .collect(Collectors.toMap(User::role, Function.identity()));
```

Because both users map to:

```text
Role.ADMIN
```

## 5.1 Why fail is good

Failing is often better than silently losing data.

## 5.2 But production crash may be bad

If duplicate is expected, express policy.

## 5.3 Rule

Duplicate key exception means your map contract and data cardinality disagree.

---

# 6. Key Equality Semantics

Duplicate keys are determined by map key equality.

For default maps:

```text
equals + hashCode
```

## 6.1 Value object key

Good:

```java
record UserId(String value) {}
```

Records provide value equality.

## 6.2 Mutable key danger

Bad:

```java
class MutableKey {
    String value;
}
```

If key mutates after insertion, map lookup breaks.

## 6.3 BigDecimal trap

`BigDecimal("1.0").equals(BigDecimal("1.00"))` is false because scale matters.

## 6.4 Case-insensitive keys

Normalize:

```java
email.toLowerCase(Locale.ROOT)
```

or use TreeMap with comparator, but understand comparator equality.

## 6.5 Rule

`toMap` correctness depends on key equality semantics.

---

# 7. Value Mapper

Value mapper determines map value.

## 7.1 Identity value

```java
Function.identity()
```

## 7.2 Projection

```java
User::email
```

## 7.3 DTO

```java
user -> new UserSummary(user.id(), user.name())
```

## 7.4 Value mapper cost

If duplicates may be merged, value mapper still creates values before merge.

For expensive values, consider alternative pipeline or custom collector.

## 7.5 Rule

Value mapper should create exactly the value you want to store per key.

---

# 8. Merge Function

Signature:

```java
BinaryOperator<U>
```

Used when duplicate key occurs.

Example:

```java
Collectors.toMap(
    User::role,
    Function.identity(),
    (a, b) -> a
)
```

## 8.1 Parameters

Usually:

```text
existing value
new value
```

But do not design merge that depends on fragile order unless stream is ordered and sequential semantics are intended.

## 8.2 Must be associative-ish for parallel

If used in parallel, merging partial maps can apply merge in different grouping.

## 8.3 Rule

Merge function is the explicit duplicate key policy.

---

# 9. First-Wins Strategy

Keep first encountered value.

```java
Map<Role, User> firstByRole = users.stream()
    .collect(Collectors.toMap(
        User::role,
        Function.identity(),
        (first, second) -> first
    ));
```

## 9.1 When valid

- first occurrence is meaningful;
- stream encounter order is defined;
- this policy is documented.

## 9.2 Need order

Use ordered source and map supplier if output order matters:

```java
Collectors.toMap(
    User::role,
    Function.identity(),
    (first, second) -> first,
    LinkedHashMap::new
)
```

## 9.3 Risk

Can silently discard later values.

## 9.4 Rule

First-wins is data loss unless the domain explicitly says first is canonical.

---

# 10. Last-Wins Strategy

Keep latest encountered value.

```java
Map<Role, User> lastByRole = users.stream()
    .collect(Collectors.toMap(
        User::role,
        Function.identity(),
        (first, second) -> second
    ));
```

## 10.1 When valid

- later row overrides earlier row;
- config/property override;
- event replay where later event supersedes earlier.

## 10.2 Need deterministic encounter order

If source is unordered, “last” is meaningless.

## 10.3 Rule

Last-wins requires deterministic input order and explicit override semantics.

---

# 11. Domain Merge Strategy

Merge two values into one domain aggregate.

## 11.1 Example order summary

```java
record OrderSummary(long count, long totalCents) {
    static OrderSummary from(Order order) {
        return new OrderSummary(1, order.amountInCents());
    }

    OrderSummary merge(OrderSummary other) {
        return new OrderSummary(
            this.count + other.count,
            this.totalCents + other.totalCents
        );
    }
}
```

Use:

```java
Map<CustomerId, OrderSummary> summaryByCustomer = orders.stream()
    .collect(Collectors.toMap(
        Order::customerId,
        OrderSummary::from,
        OrderSummary::merge
    ));
```

## 11.2 Good merge

- associative;
- no side effects;
- returns new value or safely mutates isolated value if collector semantics allow;
- clear domain meaning.

## 11.3 Rule

Domain merge is preferred over first/last-wins when duplicates represent aggregatable facts.

---

# 12. Fail-Fast Explicit Duplicate Strategy

Sometimes duplicate is invalid and should fail with clearer message.

```java
Map<UserId, User> byId = users.stream()
    .collect(Collectors.toMap(
        User::id,
        Function.identity(),
        (a, b) -> {
            throw new IllegalStateException(
                "Duplicate user id: " + a.id()
            );
        }
    ));
```

## 12.1 Why explicit?

Default exception may be enough, but custom message can include domain context.

## 12.2 Use in validation

Good at boundaries where uniqueness is required.

## 12.3 Rule

If duplicates are invalid, fail clearly and close to collection point.

---

# 13. When Duplicate Means Use `groupingBy`

If duplicates should all be preserved:

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(User::role));
```

## 13.1 One-to-many

`Role -> List<User>`

## 13.2 Unique values per key

```java
Map<Role, Set<String>> emailsByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.mapping(User::email, Collectors.toSet())
    ));
```

## 13.3 Count per key

```java
Map<Role, Long> countByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.counting()
    ));
```

## 13.4 Rule

If duplicate key represents multiple facts, use grouping/aggregation.

---

# 14. `toMap` vs `groupingBy`

| Requirement | Use |
|---|---|
| key unique | `toMap` |
| one final value per key via merge | `toMap` with merge |
| many values per key | `groupingBy` |
| count per key | `groupingBy(counting)` |
| sum per key | `groupingBy(summing*)` or `toMap` merge summary |
| latest per key | `toMap` with maxBy merge |
| preserve all duplicates | `groupingBy` |
| fail on duplicates | basic `toMap` or explicit fail merge |

## 14.1 Rule

`toMap` collapses duplicates. `groupingBy` represents duplicates.

---

# 15. Map Supplier

Four-arg `toMap`:

```java
toMap(keyMapper, valueMapper, mergeFunction, mapSupplier)
```

Example:

```java
LinkedHashMap<UserId, User> byId = users.stream()
    .collect(Collectors.toMap(
        User::id,
        Function.identity(),
        (a, b) -> a,
        LinkedHashMap::new
    ));
```

## 15.1 Why supplier matters

Controls:

- map implementation;
- iteration order;
- sorting;
- enum optimization;
- identity semantics;
- concurrency if using concurrent map supplier carefully.

## 15.2 Rule

Use map supplier when map type/order is part of output contract.

---

# 16. `LinkedHashMap` for Encounter-Order Maps

If you need output map iteration order to follow stream encounter order:

```java
Map<UserId, User> byId = users.stream()
    .collect(Collectors.toMap(
        User::id,
        Function.identity(),
        (a, b) -> a,
        LinkedHashMap::new
    ));
```

## 16.1 Common use

- JSON output;
- UI display;
- deterministic tests;
- report generation.

## 16.2 Caveat

Encounter order must be meaningful from source.

## 16.3 Rule

Use LinkedHashMap when map iteration order matters.

---

# 17. `TreeMap` for Sorted Keys

```java
Map<String, User> byEmail = users.stream()
    .collect(Collectors.toMap(
        User::email,
        Function.identity(),
        (a, b) -> a,
        TreeMap::new
    ));
```

## 17.1 Comparator

If custom ordering:

```java
() -> new TreeMap<>(String.CASE_INSENSITIVE_ORDER)
```

## 17.2 Comparator equality

TreeMap key uniqueness is based on comparator comparison result `0`, not equals.

Case-insensitive TreeMap treats:

```text
"A@example.com"
"a@example.com"
```

as same key.

## 17.3 Rule

TreeMap changes duplicate key semantics to comparator-based key equivalence.

---

# 18. `EnumMap` for Enum Keys

Efficient for enum keys.

```java
Map<Role, User> byRole = users.stream()
    .collect(Collectors.toMap(
        User::role,
        Function.identity(),
        (a, b) -> a,
        () -> new EnumMap<>(Role.class)
    ));
```

## 18.1 Better for enum key maps

- compact;
- fast;
- enum natural order.

## 18.2 Duplicate role

Still needs merge.

## 18.3 Rule

Use EnumMap supplier for enum-key maps when map type matters.

---

# 19. `IdentityHashMap` Supplier Warning

You can technically use:

```java
() -> new IdentityHashMap<Key, Value>()
```

But this changes key semantics to `==`.

## 19.1 Dangerous

Two equal value objects become different keys.

## 19.2 Use only for identity algorithms

- object graph tracking;
- proxy mapping;
- serialization copy map.

## 19.3 Rule

Do not use IdentityHashMap supplier for domain value keys.

---

# 20. `toUnmodifiableMap`

Creates unmodifiable map.

```java
Map<UserId, String> emailById = users.stream()
    .collect(Collectors.toUnmodifiableMap(
        User::id,
        User::email
    ));
```

## 20.1 Duplicate keys

Two-arg version throws on duplicate.

Use merge overload:

```java
Collectors.toUnmodifiableMap(
    User::role,
    User::email,
    (a, b) -> a
)
```

## 20.2 Null policy

Disallows null keys and values.

## 20.3 Use case

- API boundary;
- immutable lookup;
- configuration snapshot.

## 20.4 Rule

Use toUnmodifiableMap when final map must be immutable and null-free.

---

# 21. `toConcurrentMap`

Creates `ConcurrentMap`.

```java
ConcurrentMap<UserId, User> byId = users.parallelStream()
    .collect(Collectors.toConcurrentMap(
        User::id,
        Function.identity()
    ));
```

## 21.1 Duplicate keys

Use merge overload if duplicates possible.

```java
Collectors.toConcurrentMap(
    User::id,
    Function.identity(),
    (a, b) -> a
)
```

## 21.2 Map supplier

Can supply concurrent map.

```java
Collectors.toConcurrentMap(
    User::id,
    Function.identity(),
    (a, b) -> a,
    ConcurrentHashMap::new
)
```

## 21.3 Caveat

ConcurrentMap result does not make values immutable/thread-safe.

## 21.4 Rule

Use toConcurrentMap when concurrent map result or concurrent accumulation semantics are needed.

---

# 22. Ordering Semantics

## 22.1 Default toMap order

Do not rely on it.

## 22.2 LinkedHashMap

Preserves insertion/encounter order.

## 22.3 TreeMap

Sorts by key.

## 22.4 ConcurrentHashMap

No encounter-order iteration guarantee.

## 22.5 Parallel streams

Even with ordered source, merge timing and map type matter.

## 22.6 Rule

If map iteration order matters, specify map supplier and avoid unordered/concurrent assumptions.

---

# 23. Null Keys and Null Values

Collectors differ in null behavior.

## 23.1 `toMap`

Null behavior can be surprising; avoid null keys/values regardless.

## 23.2 `toUnmodifiableMap`

Disallows null keys and values.

## 23.3 `toConcurrentMap`

ConcurrentHashMap disallows null keys/values.

## 23.4 Best practice

Normalize:

```java
.filter(user -> user.id() != null)
```

or map:

```java
user -> Objects.requireNonNull(user.id(), "user id")
```

## 23.5 Rule

Do not let null silently enter map collection.

---

# 24. Composite Keys

When key is combination of fields, use record.

```java
record CustomerMonth(CustomerId customerId, YearMonth month) {}
```

Use:

```java
Map<CustomerMonth, Long> totalByCustomerMonth = orders.stream()
    .collect(Collectors.toMap(
        order -> new CustomerMonth(
            order.customerId(),
            YearMonth.from(order.createdAt())
        ),
        Order::amountInCents,
        Long::sum
    ));
```

## 24.1 Why record

- immutable;
- value equality;
- good hashCode;
- self-documenting.

## 24.2 Avoid string concatenation keys

Bad:

```java
customerId + ":" + month
```

Can collide/parse poorly.

## 24.3 Rule

Use record composite keys for multi-field map keys.

---

# 25. Latest/Oldest per Key

## 25.1 Latest order by customer

```java
Map<CustomerId, Order> latestByCustomer = orders.stream()
    .collect(Collectors.toMap(
        Order::customerId,
        Function.identity(),
        BinaryOperator.maxBy(Comparator.comparing(Order::createdAt))
    ));
```

## 25.2 Oldest order by customer

```java
Map<CustomerId, Order> oldestByCustomer = orders.stream()
    .collect(Collectors.toMap(
        Order::customerId,
        Function.identity(),
        BinaryOperator.minBy(Comparator.comparing(Order::createdAt))
    ));
```

## 25.3 Tie-breaker

Add tie-breaker for deterministic result:

```java
Comparator.comparing(Order::createdAt)
    .thenComparing(Order::id)
```

## 25.4 Rule

Use minBy/maxBy merge for latest/oldest one-value-per-key maps.

---

# 26. Max/Min Score per Key

## 26.1 Top user per role

```java
Map<Role, User> topUserByRole = users.stream()
    .collect(Collectors.toMap(
        User::role,
        Function.identity(),
        BinaryOperator.maxBy(Comparator.comparing(User::score))
    ));
```

## 26.2 If all top ties needed

Use groupingBy, not toMap.

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(User::role));
```

Then handle ties.

## 26.3 Rule

`toMap` max/min merge keeps one winner; if ties matter, use grouping.

---

# 27. Sum/Count per Key: `toMap` Merge vs `groupingBy`

## 27.1 Sum with toMap

```java
Map<CustomerId, Long> totalByCustomer = orders.stream()
    .collect(Collectors.toMap(
        Order::customerId,
        Order::amountInCents,
        Long::sum
    ));
```

## 27.2 Sum with groupingBy

```java
Map<CustomerId, Long> totalByCustomer = orders.stream()
    .collect(Collectors.groupingBy(
        Order::customerId,
        Collectors.summingLong(Order::amountInCents)
    ));
```

## 27.3 Which is clearer?

For simple numeric aggregation, `groupingBy(..., summingLong(...))` reads as aggregation.

For custom merge summary object, `toMap` can be concise.

## 27.4 Count with toMap

```java
Map<Role, Long> countByRole = users.stream()
    .collect(Collectors.toMap(
        User::role,
        user -> 1L,
        Long::sum
    ));
```

Better:

```java
groupingBy(User::role, counting())
```

## 27.5 Rule

Use groupingBy for aggregation vocabulary; use toMap merge when one-value-per-key merge is domain-natural.

---

# 28. Map of DTOs

## 28.1 DTO by ID

```java
Map<UserId, UserDto> dtoById = users.stream()
    .collect(Collectors.toMap(
        User::id,
        UserDto::from
    ));
```

## 28.2 Duplicate IDs invalid

Basic toMap fail is good.

## 28.3 Duplicate IDs expected from join?

Need policy.

```java
(UserDto a, UserDto b) -> a.merge(b)
```

## 28.4 Rule

DTO map collection should reflect uniqueness guarantees from source.

---

# 29. Indexing Patterns

`toMap` often builds indexes.

## 29.1 By ID

```java
Map<UserId, User> byId = users.stream()
    .collect(Collectors.toMap(User::id, Function.identity()));
```

## 29.2 By unique code

```java
Map<String, Product> bySku = products.stream()
    .collect(Collectors.toMap(Product::sku, Function.identity()));
```

## 29.3 Multi-map index

If key not unique:

```java
Map<CustomerId, List<Order>> ordersByCustomer = orders.stream()
    .collect(Collectors.groupingBy(Order::customerId));
```

## 29.4 Rule

Index type depends on cardinality: one-to-one uses toMap; one-to-many uses groupingBy.

---

# 30. Cache/Lookup Map Construction

Map construction for lookup is common.

## 30.1 Immutable lookup

```java
Map<ProductId, Product> productById = products.stream()
    .collect(Collectors.toUnmodifiableMap(
        Product::id,
        Function.identity()
    ));
```

## 30.2 Mutable lookup

```java
Map<ProductId, Product> productById = products.stream()
    .collect(Collectors.toMap(Product::id, Function.identity()));
```

## 30.3 Concurrent lookup

```java
ConcurrentMap<ProductId, Product> productById = products.parallelStream()
    .collect(Collectors.toConcurrentMap(Product::id, Function.identity()));
```

## 30.4 Rule

Choose mutability/concurrency based on lookup lifecycle.

---

# 31. Parallel Stream Considerations

## 31.1 Merge function must be safe

For parallel, merge grouping can differ.

Associative merge is safest.

Good:

```java
Long::sum
OrderSummary::merge
BinaryOperator.maxBy(comparator)
```

Risky:

```java
(a, b) -> a.append(b)
```

if mutating shared object incorrectly.

## 31.2 Map combiner cost

Non-concurrent `toMap` in parallel creates partial maps and merges them.

Can be expensive.

## 31.3 Concurrent map

`toConcurrentMap` can reduce combining but introduces concurrent update contention.

## 31.4 Rule

Parallel `toMap` is not automatically faster; benchmark and ensure merge correctness.

---

# 32. Performance Cost Model

## 32.1 Hash cost

Depends on key hashCode.

## 32.2 Equality cost

Duplicate detection uses equality/comparator depending map.

## 32.3 Merge cost

Called for duplicates.

## 32.4 Map resizing

Large maps may resize.

Cannot directly set initial capacity via built-in map supplier unless custom supplier:

```java
() -> new HashMap<>(expectedSize)
```

## 32.5 Value creation cost

Value mapper creates values before merge.

## 32.6 Rule

`toMap` performance is map construction performance plus mapper/merge cost.

---

# 33. Testing `toMap` Correctness

Test:

## 33.1 Unique keys

Expected normal map.

## 33.2 Duplicate keys

Does policy work?

## 33.3 Null key/value

Does policy reject/normalize?

## 33.4 Ordering

If exposed output order matters, test map iteration order.

## 33.5 Key equality

Test equal different instances.

## 33.6 Parallel

If used parallel, compare sequential/parallel results.

## 33.7 Rule

A `toMap` test suite must include duplicate keys.

---

# 34. Common Anti-Patterns

## 34.1 Basic toMap on non-unique key

Crash.

## 34.2 First-wins hiding data loss

Silent bug.

## 34.3 Last-wins on unordered source

Nondeterministic.

## 34.4 toMap when groupingBy needed

Lost duplicates or awkward merge.

## 34.5 groupingBy when toMap merge needed

Materializes lists unnecessarily.

## 34.6 Relying on default map order

Nondeterministic API/test output.

## 34.7 String composite key

Collision/parse risk.

## 34.8 Mutable key

Lookup breaks.

## 34.9 toConcurrentMap with non-thread-safe value mutation

ConcurrentMap protects map structure, not value internals.

## 34.10 Rule

Most `toMap` bugs are hidden cardinality/equality/order bugs.

---

# 35. Production Failure Modes

## 35.1 Duplicate key exception in production

Cause: uniqueness assumption false.

Fix: merge function, groupingBy, or data validation.

## 35.2 Silent data loss from first-wins

Cause: duplicate data discarded.

Fix: fail-fast or grouping.

## 35.3 Nondeterministic last-wins

Cause: unordered/parallel source.

Fix: define ordering and sort before collect or use deterministic comparator merge.

## 35.4 Wrong latest selected

Cause: missing tie-breaker in comparator.

Fix: `thenComparing`.

## 35.5 HashMap order exposed to client

Cause: default map type.

Fix: LinkedHashMap/TreeMap.

## 35.6 NullPointerException

Cause: null key/value in unmodifiable/concurrent map.

Fix: normalize/validate.

## 35.7 Memory spike

Cause: huge map construction.

Fix: stream paging, DB lookup, capacity planning, incremental processing.

## 35.8 Bad composite key collision

Cause: concatenated string key.

Fix: record key.

## 35.9 BigDecimal key surprise

Cause: equals scale semantics.

Fix: normalize BigDecimal or use comparator-based TreeMap carefully.

## 35.10 Parallel slower than sequential

Cause: map merging/contention cost.

Fix: benchmark; use sequential.

---

# 36. Best Practices

## 36.1 State cardinality

Document whether key is unique.

## 36.2 Prefer basic toMap only for true unique keys

IDs, SKUs, unique codes.

## 36.3 Always design duplicate policy

Fail, first, last, merge, grouping.

## 36.4 Use groupingBy for one-to-many

Do not cram lists manually into toMap unless necessary.

## 36.5 Use map supplier for order/type

LinkedHashMap, TreeMap, EnumMap.

## 36.6 Normalize keys

Case, whitespace, BigDecimal scale, composite key.

## 36.7 Avoid null

Validate before collecting.

## 36.8 Test duplicates

Always.

## 36.9 Be careful with parallel

Merge function must be associative and deterministic.

---

# 37. Decision Matrix

| Need | Recommended |
|---|---|
| unique ID to object | `toMap(id, identity)` |
| unique ID to DTO | `toMap(id, dtoMapper)` |
| duplicate invalid | basic `toMap` or explicit fail merge |
| duplicate first wins | `toMap(k, v, (a,b)->a)` |
| duplicate last wins | `toMap(k, v, (a,b)->b)` |
| latest by timestamp | `toMap(k, identity, maxBy(comparator))` |
| oldest by timestamp | `toMap(k, identity, minBy(comparator))` |
| sum value per key | `groupingBy(k, summing*)` or `toMap(k, value, sum)` |
| count per key | `groupingBy(k, counting())` |
| many values per key | `groupingBy(k)` |
| unique projected values per key | `groupingBy(k, mapping(v, toSet()))` |
| ordered output map | four-arg `toMap(..., LinkedHashMap::new)` |
| sorted keys | four-arg `toMap(..., TreeMap::new)` |
| enum keys | four-arg `toMap(..., () -> new EnumMap<>(Type.class))` |
| immutable null-free map | `toUnmodifiableMap` |
| concurrent map result | `toConcurrentMap` |
| composite key | record key |
| case-insensitive key | normalize or TreeMap comparator |
| null possible | validate/filter/map to sentinel before collect |
| ties matter | groupingBy, not maxBy single winner |
| huge dataset | consider DB/index/paging instead of in-memory toMap |

---

# 38. Latihan

## Latihan 1 — Duplicate Crash

Create users with duplicate role and collect with basic `toMap`.

Explain exception.

## Latihan 2 — First vs Last Wins

Implement first-wins and last-wins.

Explain when each is safe.

## Latihan 3 — Latest per Customer

Collect latest order per customer using `BinaryOperator.maxBy`.

Add tie-breaker.

## Latihan 4 — Grouping Alternative

Convert duplicate role example into `Map<Role, List<User>>`.

## Latihan 5 — Sum per Key

Implement total cents per customer using both `toMap` merge and `groupingBy(summingLong)`.

Compare readability.

## Latihan 6 — Map Supplier

Collect into LinkedHashMap and TreeMap. Compare iteration order.

## Latihan 7 — EnumMap

Collect users by role into EnumMap with merge.

## Latihan 8 — Composite Key

Create `record CustomerMonth(CustomerId, YearMonth)` and aggregate totals.

## Latihan 9 — Null Policy

Make key mapper return null and decide validation strategy.

## Latihan 10 — Parallel Merge

Create associative and non-associative merge examples. Compare sequential/parallel risk.

---

# 39. Ringkasan

`toMap` is one-value-per-key map construction.

Core lessons:

- Basic `toMap` assumes unique keys.
- Duplicate keys throw unless merge function is provided.
- Merge function is duplicate key policy.
- First-wins and last-wins can silently lose data.
- Domain merge is safer when duplicates represent aggregatable facts.
- Use groupingBy when duplicates should be preserved.
- Use map supplier when map type/order matters.
- LinkedHashMap gives encounter-order iteration.
- TreeMap sorts keys and uses comparator equality.
- EnumMap is ideal for enum keys.
- IdentityHashMap changes equality semantics and is dangerous for domain keys.
- toUnmodifiableMap is immutable and null-rejecting.
- toConcurrentMap creates ConcurrentMap but does not make values thread-safe.
- Null keys/values should be normalized or rejected.
- Composite keys should be immutable value objects, usually records.
- Parallel toMap requires safe merge and may not be faster.
- Always test duplicate-key scenarios.

Main rule:

```text
Before writing toMap, answer:
Is the key truly unique?
If not, do I want fail-fast, first-wins, last-wins, domain merge, or groupingBy?
```

---

# 40. Referensi

1. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

2. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

3. Java SE 25 — `ConcurrentMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentMap.html

4. Java SE 25 — `BinaryOperator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/BinaryOperator.html

5. Java SE 25 — `Function`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Function.html

6. Java SE 25 — `LinkedHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedHashMap.html

7. Java SE 25 — `TreeMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeMap.html

8. Java SE 25 — `EnumMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumMap.html

9. Java SE 25 — `IdentityHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/IdentityHashMap.html

10. dev.java — Reductions  
    https://dev.java/learn/api/streams/reducing/

# learn-java-collections-and-streams-part-043.md

# Java Collections and Streams — Part 043  
# Null Handling in Streams: Null Sources, Null Elements, `filter(Objects::nonNull)`, `Stream.ofNullable`, Optional, Null Object, Collectors Null Policy, Maps, FlatMap, and Production-Safe Null Semantics

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **043**  
> Fokus: memahami null handling dalam Stream API secara production-grade. Kita akan membedah null source, null element, null mapper result, `filter(Objects::nonNull)`, `Stream.ofNullable`, `Optional.stream`, `flatMap`, `mapMulti`, collectors yang menerima/menolak null, `toMap` null trap, null pada grouping, API boundary, JSON/DB/event semantics, dan strategi null-safe pipeline yang eksplisit.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Null Harus Jadi Kontrak, Bukan Kebetulan](#2-mental-model-null-harus-jadi-kontrak-bukan-kebetulan)
3. [Tiga Jenis Null dalam Stream](#3-tiga-jenis-null-dalam-stream)
4. [Null Source](#4-null-source)
5. [Null Elements](#5-null-elements)
6. [Null Mapper Result](#6-null-mapper-result)
7. [`filter(Objects::nonNull)`](#7-filterobjectsnonnull)
8. [`Stream.ofNullable`](#8-streamofnullable)
9. [`Optional.stream`](#9-optionalstream)
10. [Optional vs Null in Stream Pipelines](#10-optional-vs-null-in-stream-pipelines)
11. [Null-Safe Collection to Stream](#11-null-safe-collection-to-stream)
12. [Null-Safe Nested Collection Flattening](#12-null-safe-nested-collection-flattening)
13. [`flatMap` and Null Streams](#13-flatmap-and-null-streams)
14. [`mapMulti` and Null Handling](#14-mapmulti-and-null-handling)
15. [Collectors and Null Policy](#15-collectors-and-null-policy)
16. [`Stream.toList()` and Null](#16-streamtolist-and-null)
17. [`Collectors.toList()` and Null](#17-collectorstolist-and-null)
18. [`Collectors.toUnmodifiableList/Set/Map` and Null](#18-collectorstounmodifiablelistsetmap-and-null)
19. [`Collectors.toMap` Null Trap](#19-collectorstomap-null-trap)
20. [Null Keys in Maps](#20-null-keys-in-maps)
21. [Null Values in Maps](#21-null-values-in-maps)
22. [Null in `groupingBy`](#22-null-in-groupingby)
23. [Null in `joining`](#23-null-in-joining)
24. [Null and Sorting](#24-null-and-sorting)
25. [Null and `distinct`](#25-null-and-distinct)
26. [Null and Primitive Streams](#26-null-and-primitive-streams)
27. [Null Object Pattern](#27-null-object-pattern)
28. [Sentinel / UNKNOWN Bucket](#28-sentinel--unknown-bucket)
29. [Boundary Normalization](#29-boundary-normalization)
30. [JSON, Database, and Event Semantics](#30-json-database-and-event-semantics)
31. [Nullness Annotations and Static Analysis](#31-nullness-annotations-and-static-analysis)
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

Null dalam stream sering muncul sebagai bug kecil yang kemudian menjadi production incident.

Contoh:

```java
List<String> emails = users.stream()
    .map(User::email)
    .map(String::toLowerCase)
    .toList();
```

Jika `email()` mengembalikan null, pipeline throw `NullPointerException`.

Contoh lain:

```java
Map<UserId, String> emailById = users.stream()
    .collect(Collectors.toMap(User::id, User::email));
```

Jika value mapper menghasilkan null, `toMap` bisa throw `NullPointerException`.

Contoh lain:

```java
List<String> emails = maybeNullUsers.stream()
    .map(User::email)
    .toList();
```

Jika `maybeNullUsers` sendiri null, NPE terjadi sebelum stream mulai.

Masalah utama:

- null source;
- null elements;
- null mapper results;
- collector null policy berbeda-beda;
- `Optional` kadang dipakai dengan benar, kadang disalahgunakan;
- null filtering bisa menyembunyikan data quality issue;
- null dalam map/grouping punya semantics domain;
- `toUnmodifiable*` collectors menolak null;
- `toMap` null behavior sering mengejutkan;
- primitive stream tidak bisa membawa null;
- JSON/DB/event punya perbedaan antara missing, null, empty, dan unknown.

Tujuan bagian ini:

- membedakan jenis null;
- memilih strategi null handling yang eksplisit;
- memahami collector null policy;
- memakai `Stream.ofNullable` dan `Optional.stream` dengan benar;
- menghindari silent data loss;
- mendesain pipeline yang null-safe dan domain-safe.

---

# 2. Mental Model: Null Harus Jadi Kontrak, Bukan Kebetulan

Null bisa berarti banyak hal:

```text
unknown
not applicable
not loaded
missing field
invalid data
empty value
not found
optional relationship absent
bug
```

Jika semua makna itu diperlakukan sama sebagai `null`, stream pipeline akan rawan.

## 2.1 Bad mental model

```text
Kalau null, filter saja.
```

## 2.2 Better mental model

```text
Apa arti null di domain ini?
Apakah harus ditolak, diganti default, dikelompokkan ke UNKNOWN, atau dilaporkan?
```

## 2.3 Main rule

```text
Null handling is domain modeling, not just NPE avoidance.
```

---

# 3. Tiga Jenis Null dalam Stream

## 3.1 Null source

Collection/source yang mau di-stream ternyata null.

```java
users.stream()
```

Jika `users == null`, NPE.

## 3.2 Null element

Source tidak null, tetapi mengandung element null.

```java
List<User> users = Arrays.asList(user1, null, user2);
```

## 3.3 Null mapper result

Element tidak null, tetapi mapper menghasilkan null.

```java
.map(User::email)
```

Email bisa null.

## 3.4 Rule

Always identify which null category you are handling.

---

# 4. Null Source

Bad:

```java
List<User> users = getUsersMaybeNull();

List<String> emails = users.stream()
    .map(User::email)
    .toList();
```

If `users` null, pipeline never starts.

## 4.1 Prefer returning empty collection

Best API design:

```java
List<User> getUsers() {
    return List.of();
}
```

not:

```java
return null;
```

## 4.2 If consuming legacy API

```java
List<User> users = getUsersMaybeNull();

List<String> emails = users == null
    ? List.of()
    : users.stream().map(User::email).toList();
```

## 4.3 Helper

```java
static <T> Stream<T> streamOfNullableCollection(Collection<T> collection) {
    return collection == null ? Stream.empty() : collection.stream();
}
```

Use:

```java
List<String> emails = streamOfNullableCollection(users)
    .map(User::email)
    .toList();
```

## 4.4 Rule

Best fix for null source is API contract: return empty collection, not null.

---

# 5. Null Elements

A stream can contain null references.

```java
Stream.of("A", null, "B")
```

Some operations tolerate null, some do not.

## 5.1 Safe operation?

```java
Stream.of("A", null, "B")
    .toList();
```

Can materialize null in list depending terminal/collector.

## 5.2 Unsafe operation

```java
Stream.of("A", null, "B")
    .map(String::toLowerCase)
    .toList();
```

NPE.

## 5.3 Rule

If stream may contain null elements, handle before dereferencing.

---

# 6. Null Mapper Result

Mapper can return null.

```java
users.stream()
    .map(User::email)
```

This creates stream of possibly null emails.

## 6.1 Then unsafe

```java
.map(String::toLowerCase)
```

## 6.2 Handle

```java
users.stream()
    .map(User::email)
    .filter(Objects::nonNull)
    .map(email -> email.toLowerCase(Locale.ROOT))
    .toList();
```

## 6.3 But think domain

Dropping users with null email may or may not be correct.

## 6.4 Rule

Filtering null mapper results is a business decision, not a default.

---

# 7. `filter(Objects::nonNull)`

Common pattern:

```java
stream.filter(Objects::nonNull)
```

## 7.1 Use case

Remove null elements before dereference.

```java
List<String> normalized = names.stream()
    .filter(Objects::nonNull)
    .map(name -> name.toLowerCase(Locale.ROOT))
    .toList();
```

## 7.2 Good when

Null means absent/unneeded.

## 7.3 Bad when

Null indicates data quality error.

Example:

```java
orders.stream()
    .map(Order::customerId)
    .filter(Objects::nonNull)
```

If every order must have customerId, filtering hides corrupt data.

## 7.4 Rule

Use `filter(Objects::nonNull)` only when dropping null is semantically correct.

---

# 8. `Stream.ofNullable`

`Stream.ofNullable(value)` returns:

```text
Stream.of(value) if value != null
Stream.empty() if value == null
```

## 8.1 Single nullable value

```java
Stream<String> emailStream = Stream.ofNullable(user.email());
```

## 8.2 Flatten optional nullable field

```java
List<String> emails = users.stream()
    .flatMap(user -> Stream.ofNullable(user.email()))
    .toList();
```

## 8.3 Difference from filter

This combines map + null elimination:

```java
.flatMap(user -> Stream.ofNullable(user.email()))
```

instead of:

```java
.map(User::email)
.filter(Objects::nonNull)
```

## 8.4 Rule

Use `Stream.ofNullable` when nullable value should become zero-or-one stream element.

---

# 9. `Optional.stream`

`Optional.stream()` converts:

```text
Optional.of(x) -> Stream.of(x)
Optional.empty() -> Stream.empty()
```

## 9.1 Example

```java
List<User> found = ids.stream()
    .map(repository::findById)      // Optional<User>
    .flatMap(Optional::stream)
    .toList();
```

## 9.2 Good use

Flatten many optional lookup results.

## 9.3 Rule

Use `Optional.stream` to bridge `Optional<T>` into stream pipelines cleanly.

---

# 10. Optional vs Null in Stream Pipelines

## 10.1 Optional as return type

Good for possibly absent result:

```java
Optional<User> findUser(UserId id)
```

## 10.2 Optional inside collection

Usually avoid:

```java
List<Optional<User>>
```

Often better to flatten immediately.

## 10.3 Optional as field

Often discouraged for entity/DTO fields; depends on style/framework.

## 10.4 Optional.map null behavior

`Optional.map` uses `ofNullable`-like behavior: if mapper returns null, result is empty Optional.

## 10.5 Optional.flatMap null behavior

`Optional.flatMap` expects mapper to return non-null Optional; if mapper returns null, NPE.

## 10.6 Rule

Use Optional at API boundaries for absence, not as a universal null replacement inside every data structure.

---

# 11. Null-Safe Collection to Stream

Pattern:

```java
static <T> Stream<T> nullSafeStream(Collection<T> collection) {
    return collection == null ? Stream.empty() : collection.stream();
}
```

Use:

```java
List<String> names = nullSafeStream(users)
    .map(User::name)
    .toList();
```

## 11.1 Alternative with Optional

```java
Stream<T> stream = Optional.ofNullable(collection)
    .stream()
    .flatMap(Collection::stream);
```

or:

```java
Optional.ofNullable(collection)
    .map(Collection::stream)
    .orElseGet(Stream::empty)
```

## 11.2 Prefer helper?

A helper is often clearer.

## 11.3 Rule

For legacy nullable collections, centralize null-safe stream conversion.

---

# 12. Null-Safe Nested Collection Flattening

Suppose:

```java
class Order {
    List<OrderLine> lines; // may be null
}
```

Bad:

```java
orders.stream()
    .flatMap(order -> order.lines().stream())
```

NPE if lines null.

## 12.1 Fix

```java
orders.stream()
    .flatMap(order -> nullSafeStream(order.lines()))
    .toList();
```

## 12.2 Better domain model

Prefer:

```java
List<OrderLine> lines = List.of();
```

not null.

## 12.3 Rule

Nested collections should default to empty; if legacy nullable, flatten with helper.

---

# 13. `flatMap` and Null Streams

`flatMap` mapper should not return null stream.

Bad:

```java
.flatMap(order -> order.lines() == null ? null : order.lines().stream())
```

## 13.1 Correct

```java
.flatMap(order -> order.lines() == null
    ? Stream.empty()
    : order.lines().stream())
```

## 13.2 Better

```java
.flatMap(order -> nullSafeStream(order.lines()))
```

## 13.3 Rule

A `flatMap` mapper should return a Stream, not null.

---

# 14. `mapMulti` and Null Handling

`mapMulti` can emit zero, one, or many values.

## 14.1 Nullable field

```java
List<String> emails = users.stream()
    .<String>mapMulti((user, downstream) -> {
        String email = user.email();
        if (email != null) {
            downstream.accept(email);
        }
    })
    .toList();
```

## 14.2 Nested collection

```java
List<OrderLine> lines = orders.stream()
    .<OrderLine>mapMulti((order, downstream) -> {
        List<OrderLine> orderLines = order.lines();
        if (orderLines != null) {
            orderLines.forEach(downstream);
        }
    })
    .toList();
```

## 14.3 Rule

`mapMulti` is useful for explicit zero-or-more emission without creating many small streams.

---

# 15. Collectors and Null Policy

Collectors differ.

Some tolerate null depending container.

Some reject null explicitly.

Important examples:

```java
Stream.toList()
Collectors.toList()
Collectors.toUnmodifiableList()
Collectors.toSet()
Collectors.toUnmodifiableSet()
Collectors.toMap()
Collectors.toUnmodifiableMap()
Collectors.joining()
```

## 15.1 Main rule

Do not assume all collectors treat null the same way.

---

# 16. `Stream.toList()` and Null

`Stream.toList()` returns unmodifiable list.

It can contain null elements if stream contains nulls.

Example:

```java
List<String> list = Stream.of("A", null, "B")
    .toList();
```

The result list is unmodifiable but can include null.

## 16.1 Mutation

```java
list.add("C"); // UnsupportedOperationException
```

## 16.2 Rule

`Stream.toList()` is unmodifiable, not necessarily null-free.

---

# 17. `Collectors.toList()` and Null

```java
List<String> list = Stream.of("A", null, "B")
    .collect(Collectors.toList());
```

Generally can collect null into list, but do not rely on returned list type or mutability contract.

## 17.1 If need mutable ArrayList

```java
.collect(Collectors.toCollection(ArrayList::new))
```

## 17.2 Rule

`Collectors.toList()` can carry nulls but gives weak type/mutability guarantees.

---

# 18. `Collectors.toUnmodifiableList/Set/Map` and Null

Unmodifiable collectors reject null.

## 18.1 toUnmodifiableList

```java
Stream.of("A", null)
    .collect(Collectors.toUnmodifiableList()); // NPE
```

## 18.2 toUnmodifiableSet

Rejects null values.

## 18.3 toUnmodifiableMap

Rejects null keys and values.

## 18.4 Rule

Use unmodifiable collectors when you want null rejection as part of contract.

---

# 19. `Collectors.toMap` Null Trap

`Collectors.toMap` is commonly surprising with null values.

Bad:

```java
Map<UserId, String> emailById = users.stream()
    .collect(Collectors.toMap(User::id, User::email));
```

If `email()` returns null, this can throw NPE.

## 19.1 Fix by filtering?

Only if dropping users without email is correct:

```java
Map<UserId, String> emailById = users.stream()
    .filter(user -> user.email() != null)
    .collect(Collectors.toMap(User::id, User::email));
```

## 19.2 Fix by default

If default is correct:

```java
Map<UserId, String> emailById = users.stream()
    .collect(Collectors.toMap(
        User::id,
        user -> Objects.requireNonNullElse(user.email(), "")
    ));
```

## 19.3 Fix by Optional value?

Usually avoid:

```java
Map<UserId, Optional<String>>
```

unless API explicitly wants Optional values.

## 19.4 Fix by custom collector/manual loop

If map should allow null values, explicit loop is clearer:

```java
Map<UserId, String> emailById = new HashMap<>();
for (User user : users) {
    emailById.put(user.id(), user.email());
}
```

## 19.5 Rule

Before `toMap`, validate key/value null policy explicitly.

---

# 20. Null Keys in Maps

Some maps allow null keys, some do not.

## 20.1 HashMap

Allows one null key.

## 20.2 ConcurrentHashMap

Does not allow null keys/values.

## 20.3 TreeMap

Null key behavior depends comparator/natural ordering.

## 20.4 toUnmodifiableMap

Rejects null keys.

## 20.5 Rule

Null key in map is usually bad domain modeling; prefer UNKNOWN/sentinel or reject.

---

# 21. Null Values in Maps

Null map value can mean:

```text
key exists but value unknown
```

But `Map.get(key)` returns null for both:

```text
key absent
key present with null value
```

unless you use `containsKey`.

## 21.1 Ambiguity

```java
String email = emailById.get(id);
```

Is there no user or user email null?

## 21.2 Better

- do not store null values;
- use Optional at API return;
- use explicit value type;
- use sentinel.

## 21.3 Rule

Null map values create absence ambiguity.

---

# 22. Null in `groupingBy`

Classifier returning null is risky.

```java
users.stream()
    .collect(Collectors.groupingBy(User::role));
```

If role null, behavior may fail depending collector implementation/contracts.

## 22.1 Better reject

```java
.collect(Collectors.groupingBy(user ->
    Objects.requireNonNull(user.role(), "role")
));
```

## 22.2 Better UNKNOWN bucket

```java
.collect(Collectors.groupingBy(user ->
    user.role() == null ? Role.UNKNOWN : user.role()
));
```

## 22.3 Rule

Do not let null group keys appear accidentally; reject or bucket intentionally.

---

# 23. Null in `joining`

`Collectors.joining` operates on `CharSequence`.

Bad:

```java
Stream.of("A", null, "B")
    .collect(Collectors.joining(","));
```

Null can cause NPE.

## 23.1 Fix drop null

```java
.filter(Objects::nonNull)
.collect(Collectors.joining(","))
```

## 23.2 Fix default

```java
.map(s -> Objects.toString(s, ""))
.collect(Collectors.joining(","))
```

## 23.3 Rule

Normalize null before string joining.

---

# 24. Null and Sorting

Sorting null values needs explicit comparator.

Bad:

```java
names.stream()
    .sorted()
    .toList();
```

if names contains null.

## 24.1 Nulls first

```java
names.stream()
    .sorted(Comparator.nullsFirst(String::compareTo))
    .toList();
```

## 24.2 Nulls last

```java
names.stream()
    .sorted(Comparator.nullsLast(String::compareTo))
    .toList();
```

## 24.3 Object property

```java
users.stream()
    .sorted(Comparator.comparing(
        User::email,
        Comparator.nullsLast(String::compareTo)
    ))
    .toList();
```

## 24.4 Rule

Null sorting policy must be explicit.

---

# 25. Null and `distinct`

`distinct()` can handle null as a distinct value in object streams.

```java
Stream.of("A", null, "A", null)
    .distinct()
    .toList();
```

Result conceptually has one null.

## 25.1 But later ops may fail

```java
.distinct()
.map(String::toLowerCase)
```

NPE on null.

## 25.2 Rule

`distinct` does not eliminate null unless combined with non-null filter.

---

# 26. Null and Primitive Streams

Primitive streams cannot contain null.

```java
IntStream
LongStream
DoubleStream
```

## 26.1 Mapping nullable Integer

Bad:

```java
users.stream()
    .map(User::age)          // Integer maybe null
    .mapToInt(Integer::intValue)
```

NPE if age null.

## 26.2 Filter

```java
users.stream()
    .map(User::age)
    .filter(Objects::nonNull)
    .mapToInt(Integer::intValue)
    .average();
```

## 26.3 Default

```java
.mapToInt(user -> user.age() == null ? 0 : user.age())
```

Only if zero means correct default.

## 26.4 Rule

Before primitive mapping, decide whether null is absent, defaultable, or invalid.

---

# 27. Null Object Pattern

Null Object replaces null with object representing no-op/default behavior.

## 27.1 Example

```java
interface DiscountPolicy {
    Money apply(Money price);
}

enum NoDiscountPolicy implements DiscountPolicy {
    INSTANCE;

    public Money apply(Money price) {
        return price;
    }
}
```

Then:

```java
DiscountPolicy policy = product.discountPolicyOrDefault();
```

## 27.2 Useful when

- behavior has safe default;
- many null checks disappear;
- no-op is domain-valid.

## 27.3 Dangerous when

Missing value should be detected, not silently ignored.

## 27.4 Rule

Use Null Object only when absence has a valid behavior.

---

# 28. Sentinel / UNKNOWN Bucket

For grouping/reporting:

```java
Role role = user.role() == null ? Role.UNKNOWN : user.role();
```

## 28.1 Good

Reports can show unknown category.

```java
Map<Role, Long> counts = users.stream()
    .collect(Collectors.groupingBy(
        user -> user.role() == null ? Role.UNKNOWN : user.role(),
        Collectors.counting()
    ));
```

## 28.2 Bad

If UNKNOWN hides data corruption.

## 28.3 Rule

UNKNOWN bucket is a reporting policy, not a universal fix.

---

# 29. Boundary Normalization

Normalize nulls at boundaries:

- controller/request DTO;
- database row mapping;
- external API response;
- message consumer;
- file parser.

## 29.1 Example

```java
record CreateUserCommand(String name, String email) {
    CreateUserCommand {
        name = Objects.requireNonNull(name, "name");
        email = normalizeEmail(email);
    }
}
```

## 29.2 Benefit

Core domain pipeline can assume non-null.

## 29.3 Rule

Push null normalization to system boundaries.

---

# 30. JSON, Database, and Event Semantics

Null means different things across boundaries.

## 30.1 JSON

- field missing;
- field present null;
- empty string;
- empty array.

These are different.

## 30.2 Database

SQL null means unknown/not applicable depending schema.

## 30.3 Events

Null field in event can mean clearing value, unknown, or producer bug.

## 30.4 Rule

Do not collapse missing/null/empty/unknown unless product semantics say so.

---

# 31. Nullness Annotations and Static Analysis

Use tools to catch null issues earlier.

Examples:

- `@NonNull`;
- `@Nullable`;
- Checker Framework;
- NullAway;
- SpotBugs nullness;
- IDE inspections;
- Error Prone integrations.

## 31.1 Goal

Make null contract visible at compile/review time.

## 31.2 Rule

Runtime null filtering is not a substitute for clear nullness contracts.

---

# 32. Production Diagnostics

When NPE occurs in stream:

## 32.1 Identify source

Was source null?

## 32.2 Identify element

Was an element null?

## 32.3 Identify mapper

Did mapper return null?

## 32.4 Identify collector

Did collector reject null?

## 32.5 Add context

Use logging or exception with element ID/index/source.

## 32.6 Rule

Null pipeline failures are diagnosed by locating which null category occurred.

---

# 33. Common Anti-Patterns

## 33.1 Blind `filter(Objects::nonNull)`

Can hide data quality bugs.

## 33.2 Returning null collections

Return empty.

## 33.3 `flatMap` returning null

Return `Stream.empty()`.

## 33.4 `toMap` with nullable values

NPE surprise.

## 33.5 Null map values

Ambiguous get.

## 33.6 Null group keys

Unclear semantics.

## 33.7 Optional everywhere

Overcomplicated model.

## 33.8 Null Object hiding real errors

Dangerous.

## 33.9 Defaulting null to zero

Wrong aggregates.

## 33.10 Not documenting null policy

Team confusion.

---

# 34. Production Failure Modes

## 34.1 NPE in method reference

```java
.map(String::trim)
```

on null element.

## 34.2 NPE in collector

`toUnmodifiableList` or `toMap` with null value.

## 34.3 Silent data loss

Nulls filtered without reporting.

## 34.4 Wrong grouping

Nulls dumped into UNKNOWN hiding producer bug.

## 34.5 Wrong numeric average

Null age defaulted to 0.

## 34.6 Ambiguous map lookup

Null value vs absent key.

## 34.7 JSON contract bug

Missing field treated same as explicit null.

## 34.8 DB null surprise

SQL null mapped to Java null then dereferenced.

## 34.9 Event compatibility bug

Null in event interpreted differently by consumers.

## 34.10 Parallel debugging difficulty

NPE context lost in parallel pipeline.

---

# 35. Best Practices

## 35.1 Prefer non-null collections

Return empty collection.

## 35.2 Normalize at boundaries

Validate or convert nulls early.

## 35.3 Use `Stream.ofNullable` for zero-or-one nullable value

Clear and concise.

## 35.4 Use `Optional.stream` for optional lookup results

Flatten naturally.

## 35.5 Avoid null map values

Use explicit model.

## 35.6 Be explicit with collector null policy

Especially `toMap` and unmodifiable collectors.

## 35.7 Do not blindly filter null

Decide reject/drop/default/bucket/report.

## 35.8 Use comparator nullsFirst/nullsLast

For sorting nullable values.

## 35.9 Use primitive streams after null decision

Filter/default/reject before unboxing.

## 35.10 Add nullness annotations/static checks

Make contracts visible.

---

# 36. Decision Matrix

| Situation | Recommended |
|---|---|
| method returns null collection | change to empty collection |
| consuming legacy nullable collection | `collection == null ? Stream.empty() : collection.stream()` |
| nullable single value to stream | `Stream.ofNullable(value)` |
| `Optional<T>` to stream | `optional.stream()` |
| null element should be dropped | `filter(Objects::nonNull)` |
| null element indicates bug | `Objects.requireNonNull` / fail-fast |
| nullable mapper result absent | `flatMap(x -> Stream.ofNullable(mapper(x)))` |
| nullable nested collection | helper `nullSafeStream(collection)` |
| `flatMap` mapper might return null | return `Stream.empty()` |
| null values need immutable list | reject/null-normalize before `toUnmodifiableList` |
| nullable map values | avoid `toMap`; normalize or explicit loop/model |
| null group key for report | map to UNKNOWN bucket |
| null group key invalid | fail-fast |
| nullable sort key | `Comparator.nullsFirst/nullsLast` |
| nullable Integer to int | filter/default/reject before `mapToInt` |
| null in JSON boundary | distinguish missing/null/empty |
| DB null in domain | map to Optional/value object/sentinel consciously |
| nullness bugs recurring | annotations/static analysis |

---

# 37. Latihan

## Latihan 1 — Null Source

Implement helper:

```java
static <T> Stream<T> nullSafeStream(Collection<T> c)
```

## Latihan 2 — Null Element

Given `List<String>` with nulls, produce lowercase non-null names.

Then explain when this would be wrong.

## Latihan 3 — `Stream.ofNullable`

Convert nullable email fields into list of present emails.

## Latihan 4 — `Optional.stream`

Given IDs and repository returning `Optional<User>`, collect found users.

## Latihan 5 — Nested Nullable Collections

Flatten `Order.lines()` where lines may be null.

## Latihan 6 — `toMap` Null Value

Show why nullable email in `toMap(User::id, User::email)` is risky. Fix with reject/default/filter/custom model.

## Latihan 7 — Group UNKNOWN

Group users by role with null role mapped to `Role.UNKNOWN`.

## Latihan 8 — Null Sorting

Sort users by nullable email, nulls last.

## Latihan 9 — Primitive Null

Average nullable ages, excluding missing ages.

## Latihan 10 — Boundary Semantics

For JSON field `middleName`, distinguish missing, null, empty string, and real value.

---

# 38. Ringkasan

Null handling in streams is about semantics before syntax.

Core lessons:

- Null can occur as source, element, or mapper result.
- Prefer APIs returning empty collections, not null.
- Use `filter(Objects::nonNull)` only when dropping null is correct.
- Use `Stream.ofNullable` for nullable zero-or-one value.
- Use `Optional.stream` to flatten optional results.
- `flatMap` mapper should return `Stream.empty()`, not null.
- `mapMulti` can express null-safe zero-or-more emission.
- Collectors have different null policies.
- `Stream.toList()` is unmodifiable but can contain null.
- `toUnmodifiable*` collectors reject null.
- `toMap` with nullable values is a common trap.
- Null map values create absence ambiguity.
- Null group keys should be rejected or bucketed intentionally.
- Sorting nullable values needs explicit comparator.
- Primitive streams require null decision before unboxing.
- Null Object and UNKNOWN bucket are domain strategies, not universal fixes.
- Normalize nulls at boundaries.
- Missing/null/empty/unknown are different concepts.
- Nullness annotations and static analysis improve long-term safety.

Main rule:

```text
Do not ask only “how do I avoid NPE?”
Ask “what does this null mean, and what should the pipeline do with that meaning?”
```

---

# 39. Referensi

1. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

2. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

3. Java SE 25 — `Optional`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html

4. Java SE 25 — `Objects`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html

5. Java SE 25 — `Comparator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html

6. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

7. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

8. Java SE 25 — `IntStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.html

9. OpenJDK Bug System — `Collectors.toMap` null value behavior  
   https://bugs.openjdk.org/browse/JDK-8148463

10. NullAway paper — Practical Type-Based Null Safety for Java  
    https://arxiv.org/abs/1907.02127

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-042.md](./learn-java-collections-and-streams-part-042.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-044.md](./learn-java-collections-and-streams-part-044.md)

</div>
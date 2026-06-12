# learn-java-collections-and-streams-part-013.md

# Java Collections and Streams — Part 013  
# Collections and Null: Null Policy, Null Object, Optional, Empty Collections, Map.get Ambiguity, Null Elements, Null Keys, and Production-Safe Absence Modeling

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **013**  
> Fokus: memahami `null` dalam Collections sebagai **absence/value/invalid-state modeling problem**, bukan sekadar `NullPointerException`. Kita akan membedah null elements, null keys, null values, `List.of`/`Set.of`/`Map.of` null rejection, `copyOf`, `Map.get` ambiguity, `Optional`, empty collections, Null Object pattern, validation, API/DB/JSON boundaries, concurrency, streams, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Null adalah Absence yang Tidak Bernama](#2-mental-model-null-adalah-absence-yang-tidak-bernama)
3. [Empat Meaning Berbeda dari Null](#3-empat-meaning-berbeda-dari-null)
4. [Null Policy di Collection: Tidak Seragam](#4-null-policy-di-collection-tidak-seragam)
5. [Null Elements in Lists](#5-null-elements-in-lists)
6. [Null Elements in Sets](#6-null-elements-in-sets)
7. [Null Keys and Null Values in Maps](#7-null-keys-and-null-values-in-maps)
8. [`ConcurrentHashMap` and Null Rejection](#8-concurrenthashmap-and-null-rejection)
9. [`Queue` and Null](#9-queue-and-null)
10. [`List.of`, `Set.of`, `Map.of` and Null](#10-listof-setof-mapof-and-null)
11. [`copyOf` and Null Rejection](#11-copyof-and-null-rejection)
12. [`Collections.unmodifiable*` and Null](#12-collectionsunmodifiable-and-null)
13. [`Arrays.asList` and Null](#13-arraysaslist-and-null)
14. [`Map.get` Ambiguity](#14-mapget-ambiguity)
15. [`containsKey` vs `get`](#15-containskey-vs-get)
16. [Absence Modeling Options](#16-absence-modeling-options)
17. [Empty Collection vs Null Collection](#17-empty-collection-vs-null-collection)
18. [`Optional<T>`](#18-optionalt)
19. [Optional in Collections](#19-optional-in-collections)
20. [Null Object Pattern](#20-null-object-pattern)
21. [Sentinel Values](#21-sentinel-values)
22. [Null and Streams](#22-null-and-streams)
23. [Filtering Nulls](#23-filtering-nulls)
24. [Mapping Functions Returning Null](#24-mapping-functions-returning-null)
25. [Collectors and Null](#25-collectors-and-null)
26. [Comparator Null Handling](#26-comparator-null-handling)
27. [Null and Equality/Hashing](#27-null-and-equalityhashing)
28. [Null in API/JSON Boundaries](#28-null-in-apijson-boundaries)
29. [Null in Database Boundaries](#29-null-in-database-boundaries)
30. [Null in Events and Messaging](#30-null-in-events-and-messaging)
31. [Null in Domain Modeling](#31-null-in-domain-modeling)
32. [Null Validation Strategy](#32-null-validation-strategy)
33. [Nullness Annotations and Static Analysis](#33-nullness-annotations-and-static-analysis)
34. [Security and Null](#34-security-and-null)
35. [Performance and Memory Considerations](#35-performance-and-memory-considerations)
36. [Production Failure Modes](#36-production-failure-modes)
37. [Best Practices](#37-best-practices)
38. [Decision Matrix](#38-decision-matrix)
39. [Latihan](#39-latihan)
40. [Ringkasan](#40-ringkasan)
41. [Referensi](#41-referensi)

---

# 1. Tujuan Bagian Ini

`null` di Java sering terlihat sederhana:

```java
value == null
```

Tetapi dalam Collections, `null` bisa berarti banyak hal:

```text
collection tidak ada
collection ada tapi kosong
element tidak ada
element tidak diketahui
map key tidak ada
map key ada tapi value null
field sengaja dikosongkan
field belum diload
field tidak berlaku
invalid input
```

Jika semua meaning itu dimodelkan dengan `null`, code menjadi ambigu.

Contoh:

```java
String value = map.get(key);
if (value == null) {
    ...
}
```

Apakah:

```text
key tidak ada?
key ada tapi value null?
map tidak mengizinkan null?
ada bug?
```

Tujuan bagian ini:

- memahami null policy di collections;
- membedakan null collection vs empty collection;
- memahami `Map.get` ambiguity;
- memahami kapan `Optional`, empty collection, Null Object, atau domain type lebih baik;
- memahami null dalam stream/collector/comparator;
- mendesain API/domain yang null-safe;
- mengenali production failure modes.

---

# 2. Mental Model: Null adalah Absence yang Tidak Bernama

`null` adalah absence tanpa nama.

Ia tidak menjelaskan:

```text
absent karena tidak ditemukan?
absent karena belum dihitung?
absent karena tidak punya permission?
absent karena field optional?
absent karena error?
absent karena default?
```

## 2.1 Problem

```java
User user = usersById.get(id);
if (user == null) {
    return;
}
```

Tidak jelas apakah missing user acceptable atau bug.

## 2.2 Better

```java
Optional<User> findUser(UserId id)
```

atau:

```java
User getRequiredUser(UserId id)
```

atau:

```java
boolean containsUser(UserId id)
```

depending semantics.

## 2.3 Collections amplify null ambiguity

Because collections already model:

- zero elements;
- missing key;
- empty result;
- optional membership;
- map lookup.

Adding null creates another layer of absence.

## 2.4 Rule

```text
Null should not be the default absence model inside collection-heavy code.
```

---

# 3. Empat Meaning Berbeda dari Null

## 3.1 Unknown

```text
We do not know the value.
```

Example:

```java
middleName = null
```

## 3.2 Not applicable

```text
This field does not apply to this case.
```

Example:

```java
companyName for individual applicant
```

## 3.3 Not found

```text
Lookup failed.
```

Example:

```java
map.get(id) == null
```

## 3.4 Intentionally empty

```text
There are no items.
```

Example:

```java
children = null
```

should usually be:

```java
children = List.of()
```

## 3.5 Why distinguish?

Each meaning produces different behavior:

- validation;
- API response;
- database constraint;
- UI display;
- audit;
- authorization.

## 3.6 Rule

If two meanings need different behavior, do not encode both as null.

---

# 4. Null Policy di Collection: Tidak Seragam

Java Collections Framework does not have one universal null policy.

## 4.1 Some allow null

Examples commonly:

```java
ArrayList
LinkedList
HashSet
HashMap
```

## 4.2 Some reject null

Examples:

```java
List.of
Set.of
Map.of
List.copyOf
Set.copyOf
Map.copyOf
ConcurrentHashMap
PriorityQueue
ArrayDeque
EnumSet
```

## 4.3 Some depend on comparator

```java
TreeSet
TreeMap
```

Natural ordering usually cannot compare null, but custom comparator may.

## 4.4 Some use null as special return

```java
Queue.poll()
Queue.peek()
Map.get()
```

## 4.5 Rule

Always know null policy of concrete collection/factory, not just interface.

---

# 5. Null Elements in Lists

Many mutable list implementations allow null.

```java
List<String> xs = new ArrayList<>();
xs.add(null);
```

## 5.1 But should you?

Usually no.

Null elements make every traversal suspicious:

```java
for (String x : xs) {
    x.length(); // possible NPE
}
```

## 5.2 Null element vs absent element

If a list contains null:

```java
[A, null, C]
```

Does it mean:

- missing value at position?
- placeholder?
- intentionally blank?
- parse failure?

## 5.3 Better alternatives

- remove absent elements;
- use `Optional<T>` only in rare list-position semantics;
- use domain object with status;
- use Null Object;
- use validation error.

## 5.4 Example: optional middle names

Bad:

```java
List<String> middleNames = List.of("A", null, "B"); // impossible with List.of
```

Better:

```java
record PersonName(String first, Optional<String> middle, String last) {}
```

or:

```java
record PersonName(String first, String middleOrBlank, String last) {}
```

depending domain.

## 5.5 Rule

Null elements in lists should be rare and explicitly documented.

---

# 6. Null Elements in Sets

Some sets allow one null element:

```java
Set<String> xs = new HashSet<>();
xs.add(null);
```

## 6.1 Meaning problem

A set models membership.

```java
set.contains(null)
```

What does null membership mean?

## 6.2 Usually smell

If a set is:

```java
Set<Permission>
Set<CaseId>
Set<Tag>
```

null should almost certainly be invalid.

## 6.3 Set.of rejects null

```java
Set.of(null); // NullPointerException
```

Useful for fail-fast validation.

## 6.4 EnumSet rejects null

EnumSet is ideal for null-free enum membership.

## 6.5 Rule

A null in a Set usually means your domain model failed to validate input.

---

# 7. Null Keys and Null Values in Maps

`HashMap` permits one null key and multiple null values.

```java
Map<String, String> map = new HashMap<>();
map.put(null, "value");
map.put("key", null);
```

## 7.1 Null key problem

What does null key mean?

- default bucket?
- unknown key?
- invalid key?
- global value?

Usually unclear.

## 7.2 Null value problem

Null value makes `get` ambiguous.

```java
map.get("missing") == null
map.get("presentButNull") == null
```

## 7.3 Better

- do not store null values;
- remove key to represent absence;
- use `containsKey` when null values intentional;
- use domain wrapper;
- use `Optional` carefully.

## 7.4 Map.of rejects null

Good for constants and null-free maps.

## 7.5 Rule

Avoid null keys and values in maps unless the API explicitly models them.

---

# 8. `ConcurrentHashMap` and Null Rejection

`ConcurrentHashMap` does not allow null keys or null values.

## 8.1 Why this matters

In concurrent maps, null return from `get` can cleanly mean absent.

```java
V value = map.get(key);
if (value == null) {
    // key absent
}
```

## 8.2 Concurrent ambiguity avoided

If null values were allowed, distinguishing absent from present-null would require a second operation like `containsKey`, but concurrent mutation could change map between calls.

## 8.3 Practical effect

Code migrating from `HashMap` to `ConcurrentHashMap` can start failing if it used nulls.

## 8.4 Better design

Use null-free values and explicit absence.

## 8.5 Rule

Concurrent maps are strongly biased toward null-free design.

---

# 9. `Queue` and Null

Queues often use null as special return value.

```java
queue.poll() // returns null if empty
queue.peek() // returns null if empty
```

## 9.1 Null element would be ambiguous

If queue allowed null element, `poll()` returning null could mean:

- empty queue;
- actual null item.

## 9.2 Many queue implementations reject null

Examples:

```java
ArrayDeque
PriorityQueue
BlockingQueue implementations
```

## 9.3 Work item should not be null

Use explicit command/signal type:

```java
sealed interface WorkItem permits Job, Stop {}

record Job(...) implements WorkItem {}
record Stop() implements WorkItem {}
```

## 9.4 Poison pill should not be null

Avoid:

```java
queue.put(null)
```

Use sentinel object.

## 9.5 Rule

Never use null as queue item. Use explicit sentinel/domain type.

---

# 10. `List.of`, `Set.of`, `Map.of` and Null

Static factory methods reject null.

## 10.1 List.of

```java
List.of("A", null); // NullPointerException
```

## 10.2 Set.of

```java
Set.of(null); // NullPointerException
```

## 10.3 Map.of

```java
Map.of("A", null); // NullPointerException
Map.of(null, 1);   // NullPointerException
```

## 10.4 Why useful

They fail fast when constructing null-free constants/data.

## 10.5 Migration gotcha

Replacing:

```java
Arrays.asList("A", null)
```

with:

```java
List.of("A", null)
```

changes behavior.

## 10.6 Rule

Use `of` factories when null should be invalid.

---

# 11. `copyOf` and Null Rejection

`List.copyOf`, `Set.copyOf`, `Map.copyOf` reject nulls.

## 11.1 List.copyOf

Rejects null elements.

```java
List.copyOf(listWithNull); // NPE
```

## 11.2 Set.copyOf

Rejects null elements.

## 11.3 Map.copyOf

Rejects null keys and null values.

## 11.4 Defensive validation

This makes `copyOf` useful as boundary validation:

```java
this.items = List.copyOf(items);
```

Now null list or null item fails fast.

## 11.5 Error message

Default NPE may not have good domain message. For public API, validate explicitly if error quality matters.

## 11.6 Rule

`copyOf` is both defensive copy and null rejection tool.

---

# 12. `Collections.unmodifiable*` and Null

Unmodifiable wrappers do not change null policy of backing collection.

## 12.1 Example

```java
List<String> raw = new ArrayList<>();
raw.add(null);

List<String> view = Collections.unmodifiableList(raw);
view.get(0); // null
```

## 12.2 Mutation via backing

Backing collection can later add null.

```java
raw.add(null);
```

view sees it.

## 12.3 Not validation

```java
Collections.unmodifiableList(raw)
```

does not validate null-free.

## 12.4 Rule

Unmodifiable view is not a null-cleaning boundary.

---

# 13. `Arrays.asList` and Null

`Arrays.asList` allows null because array may contain null.

```java
List<String> xs = Arrays.asList("A", null);
```

## 13.1 Fixed-size

You cannot add/remove, but can set:

```java
xs.set(1, "B");
```

## 13.2 Backed by array

If array element becomes null, list sees null.

## 13.3 Migration caution

`List.of` rejects null. `Arrays.asList` allows null.

## 13.4 Rule

Do not use `Arrays.asList` as null-free validation.

---

# 14. `Map.get` Ambiguity

This is one of the most important null issues.

```java
V value = map.get(key);
```

If `value == null`, there are two possibilities:

1. key absent;
2. key present and mapped to null.

## 14.1 Example

```java
Map<String, String> map = new HashMap<>();
map.put("A", null);

map.get("A"); // null
map.get("B"); // null
```

## 14.2 Ambiguous code

```java
if (map.get(key) == null) {
    loadValue();
}
```

If key exists with null value, this reloads incorrectly.

## 14.3 Better with null-free map

If map never stores null values:

```java
if (map.get(key) == null) {
    // absent
}
```

can be acceptable.

## 14.4 Better with containsKey

```java
if (map.containsKey(key)) {
    V value = map.get(key);
}
```

## 14.5 Rule

Do not store null values in maps unless you are ready to use `containsKey` and document ambiguity.

---

# 15. `containsKey` vs `get`

## 15.1 When null values allowed

Use:

```java
if (map.containsKey(key)) {
    V value = map.get(key); // may be null intentionally
} else {
    // absent
}
```

## 15.2 Race in concurrent maps

In normal concurrent scenarios, `containsKey` then `get` can be non-atomic.

But `ConcurrentHashMap` disallows null values, so `get == null` means absent at the moment of read.

## 15.3 Atomic compute

For concurrent initialization:

```java
map.computeIfAbsent(key, this::load);
```

But mapping function must not return null if you expect insertion.

## 15.4 Rule

Null-free maps simplify lookup logic dramatically.

---

# 16. Absence Modeling Options

Instead of null, options include:

## 16.1 Empty collection

For zero results:

```java
List.of()
```

## 16.2 Optional

For maybe one result:

```java
Optional<User>
```

## 16.3 Domain result

```java
sealed interface LookupResult permits Found, NotFound, Forbidden {}
```

## 16.4 Null Object

```java
NoDiscountPolicy.INSTANCE
```

## 16.5 Sentinel

Special internal marker object.

## 16.6 Exception

For required value absent:

```java
throw new NotFoundException(...)
```

## 16.7 Rule

Choose absence model based on domain meaning, not habit.

---

# 17. Empty Collection vs Null Collection

## 17.1 Bad

```java
List<OrderLine> lines = null;
```

Now every caller must check null.

## 17.2 Good

```java
List<OrderLine> lines = List.of();
```

Meaning:

```text
known to have zero lines
```

## 17.3 API return

Prefer:

```java
return List.of();
```

over:

```java
return null;
```

## 17.4 Difference

Null collection can mean:

```text
not loaded / unknown / not applicable
```

Empty collection means:

```text
loaded and contains no elements
```

## 17.5 If not loaded is meaningful

Model it explicitly:

```java
sealed interface LinesState permits NotLoaded, Loaded {}
record Loaded(List<OrderLine> lines) implements LinesState {}
```

## 17.6 Rule

Return empty collections for zero items; reserve absence for different semantics.

---

# 18. `Optional<T>`

`Optional<T>` is primarily intended as method return type where there is clear need to represent no result and using null is likely to cause errors.

## 18.1 Good use

```java
Optional<User> findUser(UserId id)
```

## 18.2 Bad use

```java
Optional<List<User>> findUsers(...)
```

Often better:

```java
List<User> findUsers(...)
```

empty list means no users.

## 18.3 Optional variable should not be null

```java
Optional<User> user = null; // bad
```

Should be:

```java
Optional.empty()
```

## 18.4 Optional field debate

Optional as field is often discouraged in many codebases due to serialization/JPA/framework friction.

Use carefully.

## 18.5 Rule

Use Optional for maybe-one result, not for collections that can naturally be empty.

---

# 19. Optional in Collections

## 19.1 List<Optional<T>>

Sometimes useful when position matters.

Example:

```java
List<Optional<Score>> scoresByRound;
```

Round index exists, score may be missing.

## 19.2 Usually smell

```java
List<Optional<User>> users
```

Often better to filter absent users or model result.

## 19.3 Map<K, Optional<V>>

Can represent known negative lookup/cache.

Example:

```java
Map<UserId, Optional<User>> cache;
```

This stores both found and not-found results.

But be careful: `Optional.empty` values are extra complexity.

## 19.4 Alternative negative cache

Use domain cache entry:

```java
sealed interface UserCacheEntry permits FoundUser, MissingUser {}
```

## 19.5 Rule

Optional inside collection is valid only when absence itself is an element/value.

---

# 20. Null Object Pattern

Null Object pattern replaces null with object that implements neutral behavior.

## 20.1 Example

```java
interface DiscountPolicy {
    Money apply(Money amount);
}

enum NoDiscountPolicy implements DiscountPolicy {
    INSTANCE;

    @Override
    public Money apply(Money amount) {
        return amount;
    }
}
```

## 20.2 Use

```java
DiscountPolicy policy = customer.discountPolicyOrDefault();
```

No null check needed.

## 20.3 Good use cases

- strategy default;
- no-op listener;
- empty handler;
- default policy.

## 20.4 Bad use cases

When absence must be visible/audited.

If no discount policy is an error, Null Object hides bug.

## 20.5 Rule

Use Null Object when neutral behavior is valid domain behavior.

---

# 21. Sentinel Values

Sentinel is special marker value.

## 21.1 Example internal marker

```java
private static final Object MISSING = new Object();
```

Used inside cache implementation.

## 21.2 Domain sentinel

```java
UserId.UNKNOWN
```

Can be dangerous if treated as real ID.

## 21.3 Queue sentinel

Poison pill:

```java
StopSignal.INSTANCE
```

Better than null.

## 21.4 Rules

- sentinel must be impossible to confuse with real value;
- keep sentinel internal where possible;
- document behavior.

## 21.5 Rule

Sentinels are useful internally, dangerous as public domain values.

---

# 22. Null and Streams

Streams can carry null elements unless source/operations prevent them.

```java
Stream.of("A", null, "B")
```

## 22.1 Operations may fail

```java
stream.map(String::length)
```

fails on null.

## 22.2 sorted

Natural sorting with null can fail unless comparator handles null.

## 22.3 distinct

Can handle one null as distinct element.

## 22.4 findFirst/findAny

If selected element is null, behavior can be problematic because Optional cannot contain null. Stream operations generally expect non-null result for Optional-bearing terminals.

## 22.5 Rule

Prefer null-free streams.

---

# 23. Filtering Nulls

## 23.1 `Objects::nonNull`

```java
list.stream()
    .filter(Objects::nonNull)
    .map(...)
```

## 23.2 But be careful

Filtering null silently can hide data quality bugs.

## 23.3 Better for boundary cleanup

At untrusted boundary:

```java
List<String> cleaned = input.stream()
    .filter(Objects::nonNull)
    .map(String::strip)
    .filter(Predicate.not(String::isBlank))
    .toList();
```

But if null invalid, reject instead.

## 23.4 Reject null

```java
if (input.stream().anyMatch(Objects::isNull)) {
    throw new IllegalArgumentException("null item");
}
```

or:

```java
List.copyOf(input); // fail fast NPE
```

## 23.5 Rule

Filter null only when dropping missing values is intended.

---

# 24. Mapping Functions Returning Null

## 24.1 Bad surprise

```java
List<String> names = users.stream()
    .map(User::middleNameNullable)
    .toList();
```

Result may contain null.

## 24.2 If absent should be dropped

```java
List<String> names = users.stream()
    .map(User::middleNameOptional)
    .flatMap(Optional::stream)
    .toList();
```

## 24.3 If default

```java
.map(user -> user.middleName().orElse(""))
```

## 24.4 If invalid

Validate and throw.

## 24.5 Rule

A mapper returning null should be treated as explicit design smell.

---

# 25. Collectors and Null

Collector null behavior differs.

## 25.1 `toList`

Can collect nulls depending stream.

## 25.2 `toSet`

Can collect nulls depending implementation, but do not rely on null acceptance as design.

## 25.3 `toUnmodifiableList`

Rejects null.

## 25.4 `toUnmodifiableSet`

Rejects null.

## 25.5 `toUnmodifiableMap`

Rejects null keys/values and duplicate keys unless merge function.

## 25.6 `groupingBy`

Classifier returning null may fail because null keys are not accepted in some collector implementations/Map constraints. Do not use null classifier; map to explicit category.

## 25.7 Rule

If collector result should be null-free, use unmodifiable collectors or validate explicitly.

---

# 26. Comparator Null Handling

## 26.1 Natural order

```java
list.sort(Comparator.naturalOrder());
```

fails if list contains null.

## 26.2 nullsFirst

```java
list.sort(Comparator.nullsFirst(Comparator.naturalOrder()));
```

## 26.3 nullsLast

```java
list.sort(Comparator.nullsLast(Comparator.naturalOrder()));
```

## 26.4 Nullable field

```java
Comparator<User> byMiddleName =
    Comparator.comparing(
        User::middleNameNullable,
        Comparator.nullsLast(String::compareTo)
    );
```

## 26.5 Better domain

Avoid nullable field if possible.

## 26.6 Rule

Null ordering must be explicit.

---

# 27. Null and Equality/Hashing

## 27.1 `Objects.equals`

```java
Objects.equals(a, b)
```

null-safe equality.

## 27.2 `Objects.hash`

```java
Objects.hash(field1, field2)
```

handles null but allocates varargs array; can be okay, but consider performance for hot keys.

## 27.3 Records

Record generated equals/hashCode handles null components.

But domain may not want null components.

## 27.4 HashMap null key

HashMap supports null key, but domain may not.

## 27.5 Rule

Null-safe equality is not same as null-valid domain model.

---

# 28. Null in API/JSON Boundaries

JSON can represent:

```json
{
  "items": null
}
```

or:

```json
{
  "items": []
}
```

or omit field:

```json
{}
```

These can mean different things.

## 28.1 Define semantics

For each field:

- required?
- nullable?
- default empty?
- omitted allowed?
- null item allowed?

## 28.2 Collection fields

Usually prefer:

```json
"items": []
```

for no items.

Reject:

```json
"items": null
```

unless null has meaning.

## 28.3 Partial update

In PATCH:

```json
"tags": null
```

could mean clear tags or no change depending API.

Do not leave ambiguous.

## 28.4 OpenAPI

Document:

- nullable;
- minItems/maxItems;
- uniqueItems;
- required;
- item nullable.

## 28.5 Rule

API must distinguish omitted, null, and empty.

---

# 29. Null in Database Boundaries

SQL NULL has three-valued logic and different semantics from Java null.

## 29.1 Nullable column

```sql
middle_name varchar null
```

Could mean unknown/not applicable.

## 29.2 Empty child table

No rows means empty collection.

Do not map no child rows to null collection.

## 29.3 LEFT JOIN

Can produce null columns for absent joined row.

Map carefully.

## 29.4 Unique constraints with null

DB behavior for unique nullable columns varies by database.

Do not assume Java Set semantics.

## 29.5 Rule

Database NULL and Java null need explicit mapping policy.

---

# 30. Null in Events and Messaging

Events should be stable facts.

## 30.1 Avoid null collections

Use empty arrays.

```json
"violations": []
```

## 30.2 Schema evolution

Adding optional field:

- omitted for old events;
- null for explicit unknown;
- default at consumer?

Decide.

## 30.3 Null item

Array with null item is rarely good.

```json
"caseIds": ["CASE-1", null]
```

usually invalid.

## 30.4 Consumer compatibility

Consumers may not handle null.

## 30.5 Rule

Event payloads should be null-minimal and schema-explicit.

---

# 31. Null in Domain Modeling

## 31.1 Required value

Use non-null field.

```java
record CaseId(String value) {
    CaseId {
        value = Objects.requireNonNull(value);
    }
}
```

## 31.2 Optional value

Use:

- Optional return;
- domain union/sealed type;
- nullable internally with strict accessor;
- separate subtype.

## 31.3 Collection

Use empty collection for no items.

```java
List<Violation> violations = List.of();
```

## 31.4 Not applicable

Model explicitly:

```java
sealed interface ApplicantName permits IndividualName, CompanyName {}
```

## 31.5 Rule

Domain model should avoid null for invariants and use explicit types for meaningful absence.

---

# 32. Null Validation Strategy

## 32.1 At boundary

Validate incoming data immediately.

```java
Objects.requireNonNull(request.caseIds(), "caseIds");
List<CaseId> ids = List.copyOf(request.caseIds());
```

## 32.2 Element validation

```java
for (CaseId id : ids) {
    Objects.requireNonNull(id, "caseIds contains null");
}
```

`List.copyOf` can do this, but message may be generic.

## 32.3 Normalize

```java
String normalized = raw.strip();
```

But raw must be non-null first.

## 32.4 Reject or default?

Defaulting null to empty may hide caller bug.

For internal API, reject.

For public API, decide compatibility.

## 32.5 Rule

Validate null at system boundaries; keep core domain null-free.

---

# 33. Nullness Annotations and Static Analysis

Java language itself does not have built-in non-null type system.

Common tools/annotations:

- Checker Framework;
- NullAway;
- SpotBugs/FindBugs annotations;
- JetBrains annotations;
- JSpecify;
- Error Prone + NullAway.

## 33.1 Benefit

Move null errors earlier to compile/static analysis.

## 33.2 Limitation

Requires discipline and library annotation coverage.

## 33.3 Collections

Annotations can express:

```java
List<@NonNull CaseId>
@Nullable List<CaseId>
```

depending tool support.

These mean different things:

- collection reference nullable;
- element nullable.

## 33.4 Rule

If project is large, use nullness tooling to enforce collection null policy.

---

# 34. Security and Null

Null can become security bug.

## 34.1 Permission missing as allow

Bad:

```java
Boolean allowed = permissionMap.get(permission);
if (allowed == null || allowed) {
    allow();
}
```

## 34.2 Tenant ID null

```java
tenantIds.contains(requestTenant)
```

If requestTenant null and set contains null, bad policy.

## 34.3 Filter bypass

Null field skipped in validation can bypass rule.

## 34.4 Cache null poisoning

Caching null/empty incorrectly can deny/allow wrong access.

## 34.5 Rule

Security-sensitive code should fail closed on null.

---

# 35. Performance and Memory Considerations

## 35.1 Empty collections

`List.of()` / `Collections.emptyList()` avoid null checks and are cheap.

## 35.2 Optional allocation

Optional objects may allocate depending optimization. Do not use Optional in hot element-level collections without need.

## 35.3 Null checks

Null checks are cheap compared to production bugs.

## 35.4 Filtering null in streams

For huge streams, filtering is linear and okay if intended.

## 35.5 Map containsKey + get

Two lookups in HashMap; usually okay but avoid if null-free map.

## 35.6 Rule

Prefer clarity and correctness; optimize null handling only when measured.

---

# 36. Production Failure Modes

## 36.1 Null collection returned

Caller loops and gets NPE.

Fix: return empty collection.

## 36.2 Null element in list

Stream map method reference throws NPE.

Fix: validate elements or filter intentionally.

## 36.3 Map.get ambiguity

Present-null confused with absent.

Fix: no null map values or use containsKey.

## 36.4 ConcurrentHashMap migration failure

Code previously stored null in HashMap.

Fix: use null-free sentinel/domain entry.

## 36.5 Queue poison pill null

Queue rejects null or consumer misinterprets empty.

Fix: explicit sentinel object.

## 36.6 `List.of` NPE after migration

Old code allowed null.

Fix: clean data or keep explicit nullable modeling.

## 36.7 `Set.copyOf` NPE on null

Boundary data contains null.

Fix: validation with clear error.

## 36.8 `groupingBy` classifier null

Collector fails or produces invalid grouping.

Fix: map null to explicit category.

## 36.9 Comparator NPE

Sorting nullable field with natural order.

Fix: `nullsFirst/nullsLast` or normalize.

## 36.10 Optional in collection overused

Code becomes nested and unclear.

Fix: model absence at right level.

## 36.11 JSON null vs omitted confusion

Patch clears data accidentally.

Fix: explicit patch semantics.

## 36.12 DB null mapped to empty incorrectly

Unknown becomes empty and affects decisions.

Fix: preserve semantic difference.

## 36.13 Null permission treated as allow

Security bug.

Fix: fail closed.

## 36.14 Null Object hides error

Missing required strategy silently no-ops.

Fix: use Null Object only when neutral behavior valid.

---

# 37. Best Practices

## 37.1 General

- Prefer null-free collections.
- Return empty collections, not null.
- Reject null elements at boundaries.
- Avoid null keys and null values.
- Use `copyOf` for defensive null rejection.
- Use explicit absence models.

## 37.2 Maps

- Prefer no null values.
- If null values allowed, use `containsKey`.
- In concurrent maps, remember null is rejected.
- Use domain cache entries for negative caching.

## 37.3 Streams

- Keep streams null-free.
- Do not silently filter null unless intended.
- Use Optional.stream for optional flattening.
- Use null-aware comparator when needed.

## 37.4 APIs

- Distinguish omitted/null/empty.
- Document item nullability.
- Use minItems/maxItems/uniqueItems.
- Reject null arrays/items unless meaningful.

## 37.5 Domain

- Use non-null value objects.
- Empty collection for no items.
- Optional for maybe-one returns.
- Sealed/domain types for meaningful absence.
- Null Object only for valid neutral behavior.

## 37.6 Security

- Fail closed on null.
- Avoid nullable permission/tenant/role collections.
- Validate before authorization.

---

# 38. Decision Matrix

| Situation | Recommended |
|---|---|
| method returns many results | empty collection for none |
| method returns maybe one | `Optional<T>` |
| required value missing | exception/domain error |
| missing has multiple reasons | sealed/domain result type |
| default behavior valid | Null Object |
| internal marker needed | private sentinel |
| map absent vs present-null | avoid null values or use `containsKey` |
| concurrent map | no null key/value |
| queue stop signal | explicit poison object, not null |
| list can have missing positions | `List<Optional<T>>` only if position matters |
| stream may produce null | reject, map to Optional, or filter intentionally |
| sort nullable field | `Comparator.nullsFirst/nullsLast` |
| API no items | `[]`, not `null` |
| API PATCH no change vs clear | explicit semantics |
| DB no child rows | empty collection |
| DB nullable column | explicit domain mapping |
| security decision null | fail closed |
| boundary collection | `copyOf` + validation |

---

# 39. Latihan

## Latihan 1 — Null Collection

Refactor method:

```java
List<CaseId> findCases(...) {
    if (...) return null;
}
```

agar return empty collection dan caller lebih sederhana.

## Latihan 2 — Map.get Ambiguity

Buat HashMap dengan key present-null dan absent key.

Tulis code yang membedakan menggunakan `containsKey`.

## Latihan 3 — Null-Free Constructor

Implement record:

```java
record BulkRequest(List<CaseId> caseIds) {}
```

dengan:

- no null list;
- no null element;
- non-empty;
- max 100;
- immutable copy.

## Latihan 4 — Optional vs Empty List

Design API:

```java
findUserById
findUsersByRole
```

Mana return Optional dan mana return List?

## Latihan 5 — Null Object

Implement `NoDiscountPolicy` dan jelaskan kapan ini valid/tidak valid.

## Latihan 6 — Stream Nulls

Given:

```java
List<String> xs = Arrays.asList("A", null, "B");
```

Tulis tiga versi:

1. reject null;
2. filter null;
3. replace null dengan default.

## Latihan 7 — Comparator Nulls

Sort list user berdasarkan nullable `middleName` dengan nulls last.

## Latihan 8 — JSON Semantics

Define meaning for:

```json
{}
{"tags": null}
{"tags": []}
{"tags": ["A", null]}
```

dalam PATCH request.

## Latihan 9 — Negative Cache

Design cache untuk user lookup yang bisa menyimpan “not found” tanpa null value.

## Latihan 10 — Security Fail Closed

Refactor authorization code agar null permission mapping tidak menghasilkan allow.

---

# 40. Ringkasan

Null dalam collections adalah absence modeling problem.

Core lessons:

- Null memiliki banyak meaning; jangan campur semuanya.
- Null policy collections tidak seragam.
- Lists may allow null, but null elements are usually bad.
- Sets with null are usually domain smell.
- HashMap permits null key/value, but this causes ambiguity.
- ConcurrentHashMap rejects null key/value.
- Queues should not use null as item because poll/peek use null as empty signal.
- `List.of`, `Set.of`, `Map.of`, and `copyOf` reject null.
- Unmodifiable wrappers do not remove null.
- `Map.get` cannot distinguish absent vs present-null.
- Empty collection is usually better than null collection.
- Optional is for maybe-one return, not usually for many-result collections.
- Optional inside collections is valid only when absence is itself a value.
- Null Object works only when neutral behavior is valid.
- Streams should generally be null-free.
- Comparator null handling must be explicit.
- API must distinguish omitted, null, and empty.
- DB NULL needs explicit mapping.
- Security-sensitive code must fail closed on null.

Main rule:

```text
Do not let null silently cross collection boundaries.
Either reject it, name it, or model it explicitly.
```

---

# 41. Referensi

1. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

2. Java SE 25 — `Set`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html

3. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

4. Java SE 25 — `Optional`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html

5. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

6. Java SE 25 — `Queue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Queue.html

7. Java SE 25 — `ArrayDeque`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayDeque.html

8. Java SE 25 — `PriorityQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html

9. Java SE 25 — `Comparator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html

10. Java SE 25 — `Collectors`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

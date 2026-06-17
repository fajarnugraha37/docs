# learn-java-collections-and-streams-part-009.md

# Java Collections and Streams — Part 009  
# Equality, Hashing, and Ordering in Collections: equals, hashCode, Comparable, Comparator, Mutable Keys, TreeSet/TreeMap, BigDecimal, Arrays, Records, dan Production Correctness

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **009**  
> Fokus: memahami bahwa banyak bug Collections bukan bug `HashMap`, `HashSet`, `TreeSet`, atau `Collectors`, tetapi bug pada **equality, hashing, dan ordering contract**. Kita akan membedah `equals`, `hashCode`, `Comparable`, `Comparator`, consistency, mutable keys, entity equality, record equality, arrays as keys, BigDecimal traps, null ordering, comparator chains, sorted collections, stream `distinct`, `toMap`, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Collection Correctness Depends on Element Semantics](#2-mental-model-collection-correctness-depends-on-element-semantics)
3. [Tiga Kontrak Besar](#3-tiga-kontrak-besar)
4. [`equals` Contract](#4-equals-contract)
5. [`hashCode` Contract](#5-hashcode-contract)
6. [`Comparable` Contract](#6-comparable-contract)
7. [`Comparator` Contract](#7-comparator-contract)
8. [Hash-Based Collections](#8-hash-based-collections)
9. [Sorted Collections](#9-sorted-collections)
10. [Set Correctness](#10-set-correctness)
11. [Map Key Correctness](#11-map-key-correctness)
12. [Stream `distinct`](#12-stream-distinct)
13. [`Collectors.toMap` and Key Equality](#13-collectorstomap-and-key-equality)
14. [Mutable Key Disaster](#14-mutable-key-disaster)
15. [Mutable Element in Set](#15-mutable-element-in-set)
16. [Record Equality](#16-record-equality)
17. [Arrays as Keys or Set Elements](#17-arrays-as-keys-or-set-elements)
18. [BigDecimal Trap](#18-bigdecimal-trap)
19. [Entity Equality Problem](#19-entity-equality-problem)
20. [Value Object Equality](#20-value-object-equality)
21. [Comparator Consistency with Equals](#21-comparator-consistency-with-equals)
22. [Comparator Chains](#22-comparator-chains)
23. [Null Handling in Comparators](#23-null-handling-in-comparators)
24. [Case-Insensitive and Locale-Sensitive Equality](#24-case-insensitive-and-locale-sensitive-equality)
25. [Floating Point Equality](#25-floating-point-equality)
26. [Identity Equality](#26-identity-equality)
27. [Hash Collision and Poor Hash Functions](#27-hash-collision-and-poor-hash-functions)
28. [Ordering vs Equality in API/DB/JSON Boundaries](#28-ordering-vs-equality-in-apidbjson-boundaries)
29. [Design Patterns](#29-design-patterns)
30. [Testing Equality, Hashing, and Ordering](#30-testing-equality-hashing-and-ordering)
31. [Production Failure Modes](#31-production-failure-modes)
32. [Best Practices](#32-best-practices)
33. [Decision Matrix](#33-decision-matrix)
34. [Latihan](#34-latihan)
35. [Ringkasan](#35-ringkasan)
36. [Referensi](#36-referensi)

---

# 1. Tujuan Bagian Ini

Collections Framework terlihat seperti API container.

Tetapi real correctness sering ditentukan oleh type yang menjadi element/key.

Contoh:

```java
Set<User> users = new HashSet<>();
Map<UserId, Session> sessions = new HashMap<>();
TreeSet<BigDecimal> amounts = new TreeSet<>();
List<Order> orders = ...
orders.stream().distinct().toList();
```

Pertanyaan sebenarnya:

```text
Apakah User.equals benar?
Apakah User.hashCode stabil?
Apakah UserId immutable?
Apakah BigDecimal scale sudah dikanonisasi?
Apakah comparator konsisten dengan equals?
Apakah field yang dipakai comparator bisa berubah?
Apakah array key memakai identity equality?
Apakah entity ID sudah tersedia saat equals dipanggil?
```

Tujuan bagian ini:

- memahami kontrak `equals`, `hashCode`, `Comparable`, `Comparator`;
- memahami dampaknya ke `HashSet`, `HashMap`, `TreeSet`, `TreeMap`, stream `distinct`, `toMap`;
- mengenali mutable key/element hazards;
- memahami BigDecimal, arrays, records, entities;
- mendesain equality/order yang production-safe;
- membuat checklist review.

---

# 2. Mental Model: Collection Correctness Depends on Element Semantics

## 2.1 HashSet is not magic

```java
Set<EmailAddress> emails = new HashSet<>();
```

`HashSet` hanya bisa menjamin uniqueness jika:

```java
EmailAddress.equals
EmailAddress.hashCode
```

benar.

## 2.2 TreeSet is not magic

```java
Set<Person> people = new TreeSet<>(Comparator.comparing(Person::age));
```

`TreeSet` akan menganggap dua person dengan age sama sebagai duplicate.

## 2.3 Map is not magic

```java
Map<TenantCaseKey, CaseSummary> map = new HashMap<>();
```

Akan aman jika `TenantCaseKey` immutable dan equality-nya benar.

## 2.4 Stream distinct is not magic

```java
stream.distinct()
```

bergantung pada equality.

## 2.5 Main rule

```text
Collections amplify equality mistakes.
```

Bug kecil di `equals/hashCode/comparator` bisa menjadi:

- missing map entry;
- duplicate set;
- lost element;
- wrong grouping;
- wrong dedup;
- cache leak;
- authorization bug;
- cross-tenant bug.

---

# 3. Tiga Kontrak Besar

Collections bergantung pada tiga kelompok kontrak:

## 3.1 Equality contract

```java
equals(Object other)
```

Menentukan:

```text
Apakah dua object dianggap sama?
```

Dipakai oleh:

- `List.contains`;
- `HashSet`;
- `HashMap`;
- `Set.equals`;
- `List.equals`;
- `Stream.distinct`;
- `Collectors.toMap` key collision via map;
- many algorithms.

## 3.2 Hashing contract

```java
hashCode()
```

Menentukan bucket placement di hash-based collections.

Dipakai oleh:

- `HashMap`;
- `HashSet`;
- `LinkedHashMap`;
- `LinkedHashSet`;
- `ConcurrentHashMap`.

## 3.3 Ordering contract

```java
Comparable<T>
Comparator<T>
```

Menentukan sorted order dan uniqueness di sorted collections.

Dipakai oleh:

- `TreeSet`;
- `TreeMap`;
- `PriorityQueue`;
- `sorted()` stream operation;
- `Collections.sort`;
- `List.sort`;
- binary search;
- min/max.

## 3.4 Summary

```text
Hash-based collection -> equals + hashCode
Sorted collection -> compareTo/comparator
List equality -> equals + order
Set equality -> equals membership, order-insensitive
Map equality -> key/value equals, order-insensitive
```

---

# 4. `equals` Contract

The `Object.equals` contract has five core properties.

## 4.1 Reflexive

For non-null x:

```java
x.equals(x) == true
```

## 4.2 Symmetric

For non-null x and y:

```java
x.equals(y) == y.equals(x)
```

## 4.3 Transitive

If:

```java
x.equals(y)
y.equals(z)
```

then:

```java
x.equals(z)
```

## 4.4 Consistent

Repeated calls return same result as long as data used in equality does not change.

## 4.5 Non-null

For non-null x:

```java
x.equals(null) == false
```

## 4.6 Practical implication

Violating any property can break collections.

## 4.7 Common bad equals

```java
@Override
public boolean equals(Object o) {
    return o instanceof User user
        && email.equalsIgnoreCase(user.email);
}
```

Maybe okay, but must ensure `hashCode` also case-insensitive.

## 4.8 Rule

If you override equals, treat it as a public mathematical contract.

---

# 5. `hashCode` Contract

The `Object.hashCode` contract says:

## 5.1 Consistency

Repeated calls must return same integer during execution if equality-relevant data unchanged.

## 5.2 Equal objects same hash

If:

```java
a.equals(b)
```

then:

```java
a.hashCode() == b.hashCode()
```

## 5.3 Unequal objects can share hash

If not equal, hash codes may still collide.

## 5.4 Most important rule

```text
Equal objects must have equal hash codes.
```

## 5.5 Bad example

```java
record EmailAddress(String value) {
    @Override
    public boolean equals(Object o) {
        return o instanceof EmailAddress other
            && value.equalsIgnoreCase(other.value);
    }

    // BAD: hashCode remains case-sensitive if not overridden
}
```

Fix:

```java
@Override
public int hashCode() {
    return value.toLowerCase(Locale.ROOT).hashCode();
}
```

Better: canonicalize in constructor.

## 5.6 Rule

Always implement equals and hashCode together.

---

# 6. `Comparable` Contract

`Comparable<T>` defines natural ordering:

```java
int compareTo(T other)
```

## 6.1 Return meaning

```java
negative -> this < other
zero     -> this == other in ordering
positive -> this > other
```

## 6.2 Natural ordering

Use Comparable when type has obvious natural order.

Examples:

- number;
- date/time;
- version;
- lexicographic ID maybe;
- priority wrapper.

## 6.3 Not every type needs Comparable

Do not make a domain type Comparable if there are multiple valid orderings.

Example:

```java
Person
```

Could sort by:

- name;
- age;
- createdAt;
- ID.

Better use Comparator.

## 6.4 Consistency with equals

Strongly recommended:

```java
x.compareTo(y) == 0
```

should imply:

```java
x.equals(y)
```

If not, sorted collections can behave surprisingly.

## 6.5 Rule

Comparable defines natural identity for sorted collections; use it only when natural order is truly natural.

---

# 7. `Comparator` Contract

`Comparator<T>` defines external ordering strategy.

```java
Comparator<Person> byAge = Comparator.comparingInt(Person::age);
```

## 7.1 Return meaning

Same as compareTo:

- negative;
- zero;
- positive.

## 7.2 Comparator can define multiple orderings

```java
Comparator<Person> byName
Comparator<Person> byAge
Comparator<Person> byCreatedAtDesc
```

## 7.3 Comparator equality in TreeSet/TreeMap

For TreeSet/TreeMap:

```java
compare(a, b) == 0
```

means same element/key for that collection.

## 7.4 Dangerous comparator

```java
Comparator<Person> byAge = Comparator.comparingInt(Person::age);
```

In TreeSet, two people same age collapse.

## 7.5 Rule

Comparator used in sorted collection is not just sort order. It also defines uniqueness/key equality inside that collection.

---

# 8. Hash-Based Collections

Hash-based collections include:

```java
HashSet
HashMap
LinkedHashSet
LinkedHashMap
ConcurrentHashMap
```

They rely on:

```java
hashCode -> bucket
equals   -> key/element equality
```

## 8.1 Lookup flow

For `HashMap.get(key)`:

1. compute hash;
2. choose bucket;
3. compare keys in bucket;
4. return matching value.

## 8.2 If hashCode changes

Map looks in wrong bucket.

## 8.3 If equals wrong

Map cannot identify matching key.

## 8.4 If hashCode poor

Many collisions, slow lookup.

## 8.5 Rule

Hash-based collection correctness requires stable equality and hash.

---

# 9. Sorted Collections

Sorted collections include:

```java
TreeSet
TreeMap
```

They rely on:

```java
Comparable
Comparator
```

## 9.1 Lookup flow

For TreeMap:

1. compare key with current node;
2. go left/right;
3. if compare == 0, key considered match.

## 9.2 equals may not be used

TreeMap/TreeSet membership is based on comparison, not necessarily equals.

## 9.3 Consequence

Comparator inconsistency can produce surprising “duplicates missing”.

## 9.4 Rule

In sorted collections, comparator is key identity.

---

# 10. Set Correctness

Set has no duplicates.

But “duplicate” means different things by implementation.

## 10.1 HashSet

Duplicate if:

```java
hashCode same bucket candidate
equals true
```

## 10.2 TreeSet

Duplicate if:

```java
compare(a, b) == 0
```

## 10.3 Example

```java
Set<BigDecimal> hashSet = new HashSet<>();
hashSet.add(new BigDecimal("1.0"));
hashSet.add(new BigDecimal("1.00"));
// size 2
```

```java
Set<BigDecimal> treeSet = new TreeSet<>();
treeSet.add(new BigDecimal("1.0"));
treeSet.add(new BigDecimal("1.00"));
// size 1
```

## 10.4 Rule

Choose Set implementation based on equality/ordering semantics you actually want.

---

# 11. Map Key Correctness

Map key should usually be:

- immutable;
- small;
- canonical;
- equality-correct;
- hash-stable;
- not array;
- not entity with lifecycle-dependent ID unless carefully designed.

## 11.1 Good key

```java
record TenantCaseKey(TenantId tenantId, CaseId caseId) {}
```

## 11.2 Bad key

```java
class User {
    String email; // mutable
    equals/hashCode use email
}
Map<User, Session> sessions;
```

## 11.3 Better

```java
Map<UserId, Session> sessions;
```

## 11.4 Composite key

Use record:

```java
record CacheKey(TenantId tenantId, CaseId caseId, Locale locale) {}
```

## 11.5 Rule

Design Map keys more carefully than values.

---

# 12. Stream `distinct`

`Stream.distinct()` returns a stream consisting of distinct elements.

For object streams, distinctness is based on `Object.equals`.

## 12.1 Ordered streams

For ordered streams, `distinct` preserves encounter order of first occurrence.

```java
List.of("B", "A", "B").stream()
    .distinct()
    .toList();
// B, A
```

## 12.2 Unordered streams

For unordered streams, no stable first occurrence guarantee.

## 12.3 Performance

`distinct` is stateful. It needs remember seen elements.

For huge streams, memory can grow.

## 12.4 Parallel ordered distinct

Can be expensive because order preservation matters.

## 12.5 Rule

`distinct` is Set-like stateful operation; equality and memory matter.

---

# 13. `Collectors.toMap` and Key Equality

`Collectors.toMap` creates map from stream.

## 13.1 Basic

```java
Map<CaseId, CaseSummary> byId = cases.stream()
    .collect(Collectors.toMap(CaseSummary::caseId, Function.identity()));
```

## 13.2 Duplicate key

If two elements produce equal keys, default collector throws.

## 13.3 Duplicate depends on key equality

If `CaseId.equals` wrong, duplicate detection wrong.

## 13.4 Merge policy

```java
Collectors.toMap(
    CaseSummary::caseId,
    Function.identity(),
    (a, b) -> a
)
```

## 13.5 Map supplier

```java
Collectors.toMap(
    CaseSummary::caseId,
    Function.identity(),
    (a, b) -> a,
    LinkedHashMap::new
)
```

## 13.6 Rule

`toMap` requires explicit duplicate key policy unless duplicates are impossible by invariant.

---

# 14. Mutable Key Disaster

## 14.1 Example

```java
final class UserKey {
    private String email;

    UserKey(String email) {
        this.email = email;
    }

    void changeEmail(String email) {
        this.email = email;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof UserKey other
            && Objects.equals(email, other.email);
    }

    @Override
    public int hashCode() {
        return Objects.hash(email);
    }
}
```

Usage:

```java
UserKey key = new UserKey("a@example.com");

Map<UserKey, String> map = new HashMap<>();
map.put(key, "session");

key.changeEmail("b@example.com");

map.get(key); // likely null
map.containsKey(key); // likely false
```

## 14.2 Why

Object is stored in bucket based on old hash.

After mutation, lookup uses new hash.

## 14.3 Fix

Make key immutable:

```java
record UserKey(String email) {
    UserKey {
        email = email.toLowerCase(Locale.ROOT);
    }
}
```

## 14.4 Rule

Never mutate map key fields used by equality/hash while key is in map.

---

# 15. Mutable Element in Set

Same issue applies to Set.

## 15.1 Example

```java
Set<UserKey> set = new HashSet<>();
UserKey key = new UserKey("a@example.com");
set.add(key);

key.changeEmail("b@example.com");

set.contains(key); // likely false
set.remove(key);   // likely false
```

## 15.2 Worse

Set may now contain an element unreachable by normal lookup.

## 15.3 Fix

- immutable set elements;
- remove before mutation and re-add after;
- use stable identity.

## 15.4 Rule

Set element equality must be stable during membership.

---

# 16. Record Equality

Records generate:

- `equals`;
- `hashCode`;
- `toString`;

based on components.

## 16.1 Good

```java
record CaseId(String value) {}
```

Value equality works.

## 16.2 Canonicalization

```java
record EmailAddress(String value) {
    EmailAddress {
        value = value.strip().toLowerCase(Locale.ROOT);
    }
}
```

Now equality is case-normalized through canonical value.

## 16.3 Mutable component problem

```java
record Key(List<String> parts) {}
```

If `parts` mutable, record equality/hash can change.

Fix:

```java
record Key(List<String> parts) {
    Key {
        parts = List.copyOf(parts);
    }
}
```

## 16.4 Array component problem

```java
record Digest(byte[] bytes) {}
```

Generated equals uses array reference equality, not content equality.

Need custom equals/hashCode with defensive copy.

## 16.5 Rule

Records are great for value keys only if components are themselves equality-safe and immutable.

---

# 17. Arrays as Keys or Set Elements

Arrays do not override `equals`/`hashCode`.

They use Object identity equality.

## 17.1 Bad

```java
Map<byte[], String> map = new HashMap<>();

map.put(new byte[]{1, 2}, "A");
map.get(new byte[]{1, 2}); // null
```

## 17.2 Bad set

```java
Set<int[]> set = new HashSet<>();
set.add(new int[]{1, 2});
set.add(new int[]{1, 2});
set.size(); // 2
```

## 17.3 Fix wrapper

```java
public final class BytesKey {
    private final byte[] bytes;
    private final int hash;

    public BytesKey(byte[] bytes) {
        this.bytes = bytes.clone();
        this.hash = Arrays.hashCode(this.bytes);
    }

    public byte[] bytes() {
        return bytes.clone();
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof BytesKey other
            && Arrays.equals(bytes, other.bytes);
    }

    @Override
    public int hashCode() {
        return hash;
    }
}
```

## 17.4 Rule

Never use raw arrays as HashMap keys or HashSet elements if content equality is intended.

---

# 18. BigDecimal Trap

`BigDecimal.equals` considers value and scale.

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00")) // false
```

`BigDecimal.compareTo` compares numeric value.

```java
new BigDecimal("1.0").compareTo(new BigDecimal("1.00")) // 0
```

## 18.1 HashSet

```java
Set<BigDecimal> set = new HashSet<>();
set.add(new BigDecimal("1.0"));
set.add(new BigDecimal("1.00"));
set.size(); // 2
```

## 18.2 TreeSet

```java
Set<BigDecimal> set = new TreeSet<>();
set.add(new BigDecimal("1.0"));
set.add(new BigDecimal("1.00"));
set.size(); // 1
```

## 18.3 Map key

```java
Map<BigDecimal, String> map = new HashMap<>();
map.put(new BigDecimal("1.0"), "A");
map.get(new BigDecimal("1.00")); // null
```

## 18.4 Fix with domain type

```java
record MoneyAmount(BigDecimal value) {
    MoneyAmount {
        value = value.setScale(2, RoundingMode.UNNECESSARY);
    }
}
```

## 18.5 Or normalize

```java
value.stripTrailingZeros()
```

Be careful with scale semantics.

## 18.6 Rule

Never use raw BigDecimal equality in collections without deciding scale semantics.

---

# 19. Entity Equality Problem

Entities are tricky.

## 19.1 Database-generated ID problem

Before persist:

```java
id == null
```

After persist:

```java
id != null
```

If equals/hashCode uses ID, hash changes.

## 19.2 Mutable business key problem

If equals/hashCode uses mutable email/status/name, map/set breaks on update.

## 19.3 Hibernate/proxy problem

`getClass()` vs `instanceof` equality can interact with proxies.

## 19.4 Common strategies

### Strategy A: avoid entities as set/map keys

Use ID value object:

```java
Map<UserId, User>
Set<UserId>
```

### Strategy B: immutable natural key

Only if truly immutable and unique.

### Strategy C: identity equality for entities

Use object identity for entity instances and value objects for keys.

## 19.5 Rule

Do not casually put mutable persistence entities into HashSet/HashMap as keys/elements.

---

# 20. Value Object Equality

Value objects are usually ideal for collection keys/elements.

## 20.1 Characteristics

- immutable;
- equality by value;
- canonicalized;
- validated;
- small.

## 20.2 Example

```java
record CaseId(String value) {
    CaseId {
        value = value.strip().toUpperCase(Locale.ROOT);
        if (!value.matches("CASE-[0-9]{8}")) {
            throw new IllegalArgumentException("Invalid case id");
        }
    }
}
```

## 20.3 Use

```java
Map<CaseId, CaseSummary>
Set<CaseId>
```

## 20.4 Benefits

- stable hash;
- no primitive/string confusion;
- compile-time type safety;
- easier review.

## 20.5 Rule

Use value objects for collection keys where meaning matters.

---

# 21. Comparator Consistency with Equals

## 21.1 Meaning

Comparator consistent with equals if:

```java
compare(a, b) == 0
```

has same boolean value as:

```java
a.equals(b)
```

## 21.2 In TreeSet

```java
record Person(String name, int age) {}

Set<Person> people = new TreeSet<>(Comparator.comparingInt(Person::age));
people.add(new Person("A", 30));
people.add(new Person("B", 30));
people.size(); // 1
```

## 21.3 Fix

If uniqueness should include name:

```java
Comparator<Person> byAgeThenName =
    Comparator.comparingInt(Person::age)
              .thenComparing(Person::name);
```

## 21.4 But maybe not enough

If two persons can have same age and name but different ID, include ID.

## 21.5 Rule

Comparator for sorted collections must encode uniqueness semantics, not just display sort.

---

# 22. Comparator Chains

Java Comparator API provides fluent composition.

## 22.1 Basic

```java
Comparator<CaseSummary> byUpdatedAt =
    Comparator.comparing(CaseSummary::updatedAt);
```

## 22.2 Descending

```java
Comparator<CaseSummary> newestFirst =
    Comparator.comparing(CaseSummary::updatedAt).reversed();
```

## 22.3 Tie-breaker

```java
Comparator<CaseSummary> order =
    Comparator.comparing(CaseSummary::updatedAt).reversed()
              .thenComparing(CaseSummary::caseId);
```

## 22.4 Primitive comparators

Avoid boxing:

```java
Comparator.comparingInt(User::age)
Comparator.comparingLong(Event::sequence)
Comparator.comparingDouble(Score::value)
```

## 22.5 Null handling

```java
Comparator.nullsLast(Comparator.naturalOrder())
```

## 22.6 Rule

Always include deterministic tie-breaker when stable ordering matters.

---

# 23. Null Handling in Comparators

## 23.1 Natural order and null

Natural order usually cannot compare null.

```java
new TreeSet<String>().add(null); // likely NPE
```

## 23.2 nullsFirst/nullsLast

```java
Comparator<String> c =
    Comparator.nullsLast(String::compareTo);
```

## 23.3 Comparing nullable field

```java
Comparator<User> byMiddleName =
    Comparator.comparing(
        User::middleName,
        Comparator.nullsLast(String::compareTo)
    );
```

## 23.4 Domain recommendation

Avoid null where possible.

But if data boundary can contain null, comparator must handle it deliberately.

## 23.5 Rule

Null ordering is a business/API decision, not incidental detail.

---

# 24. Case-Insensitive and Locale-Sensitive Equality

## 24.1 Case-insensitive key

Bad:

```java
Map<String, User> usersByEmail;
```

with mixed case emails.

## 24.2 Canonicalize

```java
record EmailAddress(String value) {
    EmailAddress {
        value = value.strip().toLowerCase(Locale.ROOT);
    }
}
```

## 24.3 Locale issue

Using default locale for case conversion can cause bugs.

Prefer:

```java
Locale.ROOT
```

for technical identifiers.

## 24.4 User-visible text

For user-visible sorting, use locale-aware Collator, not simple String compare.

## 24.5 Rule

Technical keys should be canonicalized locale-independently. Human text sorting needs locale-aware design.

---

# 25. Floating Point Equality

Floating-point equality is tricky:

- NaN;
- -0.0 vs 0.0;
- rounding;
- precision;
- ULP;
- representation error.

## 25.1 Set of Double

```java
Set<Double> values = new HashSet<>();
```

May be valid for exact bit-like semantics, but often wrong for measured values.

## 25.2 Approximate equality

Approximate equality is not transitive.

If:

```text
a approximately equals b
b approximately equals c
```

does not guarantee:

```text
a approximately equals c
```

This breaks equals contract.

## 25.3 Do not implement equals with epsilon casually

Bad:

```java
Math.abs(a - b) < 0.001
```

inside equals.

## 25.4 Better

Use domain bucketing/canonicalization.

```java
record TemperatureBucket(int tenths) {}
```

## 25.5 Rule

Never use non-transitive approximate equality in equals/hashCode.

---

# 26. Identity Equality

Identity equality uses:

```java
==
```

not equals.

## 26.1 IdentityHashMap

```java
IdentityHashMap<K,V>
```

uses object identity.

## 26.2 Use cases

- object graph traversal;
- cycle detection by object reference;
- serialization internals;
- proxy tracking.

## 26.3 Not domain default

For value objects:

```java
new CaseId("CASE-1")
```

and another same value should be equal.

Identity map would treat them different.

## 26.4 Rule

Use identity equality only when object instance identity is the actual model.

---

# 27. Hash Collision and Poor Hash Functions

## 27.1 Poor hash

```java
@Override
public int hashCode() {
    return 1;
}
```

All keys collide.

## 27.2 Consequence

HashMap becomes much slower.

Modern HashMap can treeify collision bins under conditions, but poor hash still hurts.

## 27.3 Expensive hash

Hash computation itself can be expensive if key is large.

Example:

- large string;
- large array wrapper;
- deep object graph.

## 27.4 Cache hash for immutable heavy key

```java
final class BytesKey {
    private final byte[] bytes;
    private final int hash;
}
```

## 27.5 Rule

Hash should be stable, reasonably distributed, and not unnecessarily expensive.

---

# 28. Ordering vs Equality in API/DB/JSON Boundaries

## 28.1 API duplicate detection

If API says emails unique case-insensitively, Java type must enforce same canonicalization.

## 28.2 DB unique constraint

If Java says unique lower-case email, DB should enforce:

```sql
unique(lower(email))
```

or canonical stored value.

## 28.3 JSON arrays

If order matters, JSON array order matters.

If uniqueness matters, schema should state unique items, but equality semantics may not match Java custom equality.

## 28.4 Sorted API output

Comparator should be deterministic and documented.

```text
sorted by updatedAt desc, caseId asc
```

## 28.5 Rule

Equality/order semantics must align across Java, API, DB, and event contracts.

---

# 29. Design Patterns

## 29.1 Canonical value object

```java
record NormalizedEmail(String value) {
    NormalizedEmail {
        value = value.strip().toLowerCase(Locale.ROOT);
        if (!value.contains("@")) {
            throw new IllegalArgumentException();
        }
    }
}
```

## 29.2 Stable composite key

```java
record TenantCaseKey(TenantId tenantId, CaseId caseId) {}
```

## 29.3 Comparator constant

```java
static final Comparator<CaseSummary> CASE_SUMMARY_ORDER =
    Comparator.comparing(CaseSummary::updatedAt).reversed()
              .thenComparing(CaseSummary::caseId);
```

## 29.4 Tie-breaker by ID

Always add stable tie-breaker for deterministic output.

## 29.5 Content array wrapper

```java
BytesKey
```

## 29.6 Domain collection wrapper

```java
record UniqueEmails(Set<EmailAddress> values) {
    UniqueEmails {
        values = Set.copyOf(values);
    }
}
```

## 29.7 Rule

Make equality/order choices reusable, named, and tested.

---

# 30. Testing Equality, Hashing, and Ordering

## 30.1 Equals properties

Test:

- reflexive;
- symmetric;
- transitive;
- null false;
- different type false;
- equal values equal;
- different values not equal.

## 30.2 HashCode

Test equal objects same hash.

## 30.3 Hash collection behavior

```java
Set<T> set = new HashSet<>();
set.add(a);
assertTrue(set.contains(equalToA));
```

## 30.4 Mutation test

If type intended immutable, ensure no mutation path.

## 30.5 Comparator

Test:

- negative/zero/positive;
- tie-breakers;
- sorted output;
- TreeSet size behavior;
- null behavior;
- consistency with equals if required.

## 30.6 BigDecimal tests

Explicitly test scale variants.

## 30.7 Array wrapper tests

Test content equality and defensive copy.

## 30.8 DB/API consistency tests

Test Java equality matches DB unique/index rules.

## 30.9 Rule

Do not test equality only through direct equals; test collection behavior too.

---

# 31. Production Failure Modes

## 31.1 HashMap lookup fails after key mutation

Fix: immutable key.

## 31.2 HashSet contains duplicate-looking elements

equals/hashCode not canonicalized.

Fix: canonical value object.

## 31.3 TreeSet drops elements

Comparator too weak.

Fix: comparator includes uniqueness identity or use different collection.

## 31.4 BigDecimal HashSet vs TreeSet mismatch

Fix: normalize scale/domain type.

## 31.5 Arrays as keys fail lookup

Fix: content wrapper.

## 31.6 Entity hash changes after persist

Fix: avoid entity as key; use stable ID/value object.

## 31.7 `distinct` fails to dedup expected values

Fix: equals semantics or canonicalization.

## 31.8 `toMap` duplicate key exception

Fix: duplicate policy/merge.

## 31.9 Comparator sort nondeterministic for equal keys

Fix: stable tie-breaker.

## 31.10 Case-insensitive lookup fails

Fix: canonical key with Locale.ROOT.

## 31.11 Approximate float equals breaks Set

Fix: bucket/canonical representation.

## 31.12 Hash collision performance issue

Fix: better hash/key design.

## 31.13 ConcurrentHashMap key mutated

Fix: immutable key.

## 31.14 DB unique constraint disagrees with Java equality

Fix: align canonicalization and constraints.

---

# 32. Best Practices

## 32.1 Equality

- Prefer immutable value objects.
- Canonicalize in constructor.
- Override equals and hashCode together.
- Do not use mutable fields.
- Avoid arrays as components unless custom equality.
- Avoid approximate equality in equals.

## 32.2 Hashing

- Ensure equal objects have equal hash.
- Keep hash stable.
- Avoid poor constant hash.
- Cache hash only for immutable heavy keys.

## 32.3 Ordering

- Use Comparable only for true natural order.
- Use Comparator for context-specific order.
- Add deterministic tie-breaker.
- Be careful with nulls.
- Ensure comparator used in TreeSet/TreeMap encodes uniqueness semantics.
- Keep comparison fields immutable while in sorted collection.

## 32.4 Collections

- Use HashSet/HashMap for equals/hash semantics.
- Use TreeSet/TreeMap for comparator semantics.
- Choose BigDecimal collection semantics deliberately.
- Use typed keys for maps.
- Avoid entities as keys.
- Test collection behavior.

## 32.5 Boundaries

- Align Java equality with DB unique constraints.
- Document API duplicate/order semantics.
- Canonicalize technical identifiers consistently.

---

# 33. Decision Matrix

| Problem | Recommended |
|---|---|
| stable key for Map | immutable record/value object |
| multi-field key | composite record |
| case-insensitive technical key | canonicalize with `Locale.ROOT` |
| byte array key | defensive content wrapper |
| BigDecimal amount key | canonical domain type with fixed scale |
| sorted display | Comparator with tie-breaker |
| sorted set uniqueness | comparator consistent with intended identity |
| many valid sort orders | external Comparator, not Comparable |
| entity lookup | Map by ID, not entity key |
| approximate numeric grouping | bucket/canonical value, not epsilon equals |
| duplicate API values | validate with explicit equality policy |
| stream dedup preserving order | ordered stream + `distinct`, equality safe |
| duplicate toMap keys | explicit merge policy |
| exact unique DB rule | matching DB unique constraint |
| object graph identity tracking | IdentityHashMap |

---

# 34. Latihan

## Latihan 1 — Mutable Key

Implement mutable `UserKey`, put into HashMap, mutate, observe lookup failure. Refactor to record.

## Latihan 2 — Comparator Trap

Create TreeSet of `Person(name, age)` comparator by age. Add two same age. Fix with tie-breaker.

## Latihan 3 — BigDecimal

Compare behavior:

```java
HashSet<BigDecimal>
TreeSet<BigDecimal>
```

for `1.0` and `1.00`.

Then design `MoneyAmount`.

## Latihan 4 — Array Key

Use `byte[]` as HashMap key and observe failure. Implement `BytesKey`.

## Latihan 5 — Record with Mutable List

Create record key with `List<String>`, mutate list after map put. Refactor with `List.copyOf`.

## Latihan 6 — Case-Insensitive Email

Implement `EmailAddress` with canonical constructor. Test HashSet dedup.

## Latihan 7 — Stream distinct

Create list of domain objects and test `distinct` result before/after equals implementation.

## Latihan 8 — toMap Duplicate Policy

Given duplicate `CaseId`, implement:

- reject;
- keep first;
- keep latest;
- group all.

## Latihan 9 — Comparator Nulls

Sort users by nullable middle name with nulls last.

## Latihan 10 — DB Alignment

Design Java `Username` equality and matching DB unique constraint.

---

# 35. Ringkasan

Equality, hashing, and ordering are the hidden foundation of collection correctness.

Core lessons:

- `equals` defines value equality.
- `hashCode` must agree with equals.
- `Comparable` defines natural order.
- `Comparator` defines contextual order.
- Hash-based collections depend on equals/hashCode.
- Sorted collections depend on comparator/compareTo.
- TreeSet/TreeMap use compare==0 as identity within that collection.
- Mutable keys/elements break maps/sets.
- Records are good only if components are equality-safe.
- Arrays use identity equality, not content equality.
- BigDecimal equals and compareTo differ by scale semantics.
- Entities are dangerous as map keys/set elements.
- Stream `distinct` depends on equals.
- `toMap` duplicate detection depends on key equality.
- Comparator consistency matters.
- Null ordering must be explicit.
- Equality/order semantics must align with API/DB/event boundaries.

Main rule:

```text
Before choosing HashMap, HashSet, TreeMap, TreeSet, distinct, grouping, or toMap,
design equality, hashing, and ordering first.
```

---

# 36. Referensi

1. Java SE 25 — `Object.equals` and `Object.hashCode`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html

2. Java SE 25 — `Comparable`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Comparable.html

3. Java SE 25 — `Comparator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html

4. Java SE 25 — `HashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html

5. Java SE 25 — `HashSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashSet.html

6. Java SE 25 — `TreeMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeMap.html

7. Java SE 25 — `TreeSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeSet.html

8. Java SE 25 — `BigDecimal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html

9. Java SE 25 — `Arrays`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html

10. Java SE 25 — `Stream.distinct`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html#distinct()

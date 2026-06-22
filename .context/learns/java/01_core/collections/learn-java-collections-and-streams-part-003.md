# learn-java-collections-and-streams-part-003.md

# Java Collections and Streams — Part 003  
# Sets Deep Dive: Uniqueness, Hashing, Ordering, HashSet, LinkedHashSet, TreeSet, EnumSet, SequencedSet, dan Domain Membership Semantics

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **003**  
> Fokus: memahami `Set` sebagai **uniqueness contract**, bukan sekadar “List tanpa duplicate”. Kita akan membedah `HashSet`, `LinkedHashSet`, `TreeSet`, `EnumSet`, `SequencedSet`, equality/hash/comparator correctness, ordering semantics, null policy, mutation hazards, domain modeling, API/DB/event mapping, performance, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Set adalah Kontrak Uniqueness](#2-mental-model-set-adalah-kontrak-uniqueness)
3. [`Set` Contract](#3-set-contract)
4. [Kapan `Set` Tepat](#4-kapan-set-tepat)
5. [Kapan `Set` adalah Smell](#5-kapan-set-adalah-smell)
6. [Uniqueness: Duplicate Rejected vs Silently Deduped](#6-uniqueness-duplicate-rejected-vs-silently-deduped)
7. [Equality and Hashing as Set Foundation](#7-equality-and-hashing-as-set-foundation)
8. [Mutable Elements in Set](#8-mutable-elements-in-set)
9. [`HashSet` Mental Model](#9-hashset-mental-model)
10. [`HashSet` Ordering and Capacity](#10-hashset-ordering-and-capacity)
11. [`LinkedHashSet` Mental Model](#11-linkedhashset-mental-model)
12. [`SequencedSet` and Encounter Order](#12-sequencedset-and-encounter-order)
13. [`TreeSet` Mental Model](#13-treeset-mental-model)
14. [Comparator Consistency and TreeSet Pitfalls](#14-comparator-consistency-and-treeset-pitfalls)
15. [`EnumSet` Mental Model](#15-enumset-mental-model)
16. [Set Operations: Union, Intersection, Difference](#16-set-operations-union-intersection-difference)
17. [Null Elements](#17-null-elements)
18. [Set Equality and Hashing](#18-set-equality-and-hashing)
19. [Sets in Records and Value Objects](#19-sets-in-records-and-value-objects)
20. [Set as Domain Type](#20-set-as-domain-type)
21. [PermissionSet Pattern](#21-permissionset-pattern)
22. [Visited Set and Graph Algorithms](#22-visited-set-and-graph-algorithms)
23. [Set vs List vs Map](#23-set-vs-list-vs-map)
24. [Set and Streams](#24-set-and-streams)
25. [Set in API/JSON Contracts](#25-set-in-apijson-contracts)
26. [Set in Database Mapping](#26-set-in-database-mapping)
27. [Set and Concurrency](#27-set-and-concurrency)
28. [Performance and Memory Cost Model](#28-performance-and-memory-cost-model)
29. [Production Failure Modes](#29-production-failure-modes)
30. [Best Practices](#30-best-practices)
31. [Decision Matrix](#31-decision-matrix)
32. [Latihan](#32-latihan)
33. [Ringkasan](#33-ringkasan)
34. [Referensi](#34-referensi)

---

# 1. Tujuan Bagian Ini

`Set` sering dijelaskan sebagai:

```text
Collection yang tidak boleh duplicate.
```

Itu benar, tapi terlalu dangkal.

Dalam production design, `Set` berarti:

```text
Uniqueness is part of the contract.
Membership matters.
Equality semantics become correctness.
```

Jika kamu menulis:

```java
Set<Permission> permissions;
```

maka kamu mengatakan:

```text
Permission tidak boleh duplicate.
Urutan biasanya tidak penting, kecuali Set implementation/interface menjanjikan order.
Membership check adalah operasi penting.
```

Tetapi `Set` juga bisa berbahaya:

```java
Set<CaseId> ids = new HashSet<>(request.caseIds());
```

Jika request memiliki duplicate, conversion ke Set akan **diam-diam menghapus duplicate**. Kadang benar, kadang ini bug karena duplicate seharusnya dianggap invalid.

Tujuan bagian ini:

- memahami `Set` sebagai uniqueness contract;
- membedakan `HashSet`, `LinkedHashSet`, `TreeSet`, `EnumSet`;
- memahami `SequencedSet`;
- memahami equality/hash/comparator sebagai fondasi correctness;
- memahami kapan Set tepat, kapan smell;
- memahami Set dalam API/DB/event/domain;
- mengenali production failure modes.

---

# 2. Mental Model: Set adalah Kontrak Uniqueness

`Set<E>` menjawab pertanyaan:

```text
Apakah element ini sudah ada?
```

Core operation:

```java
set.contains(element)
```

Meaning:

```text
Membership.
```

## 2.1 List vs Set

```java
List<Permission> permissions
```

means:

```text
Order matters or duplicates may matter.
```

```java
Set<Permission> permissions
```

means:

```text
Uniqueness matters.
```

## 2.2 Set is not merely dedup tool

Dedup is an operation.

Set is a model.

Bad mental model:

```text
I have duplicates, so I convert to Set.
```

Better mental model:

```text
Domain says there must be no duplicates, so Set or PermissionSet expresses invariant.
```

## 2.3 Set can hide bad input

If duplicate input is a client error, do not silently convert to Set.

Detect duplicates first.

## 2.4 Set equality depends on element equality

If `Permission.equals` is wrong, `Set<Permission>` is wrong.

## 2.5 Rule

```text
Set correctness is element equality correctness.
```

---

# 3. `Set` Contract

Java SE 25 `Set` says it places additional stipulations beyond `Collection` on constructors and on `add`, `equals`, and `hashCode` methods.

## 3.1 No duplicate elements

A set contains no pair of elements `e1` and `e2` such that:

```java
Objects.equals(e1, e2)
```

and at most one null element if implementation permits null.

## 3.2 `add`

```java
boolean added = set.add(element);
```

Returns:

- `true` if set changed;
- `false` if equal element already existed.

## 3.3 `contains`

```java
set.contains(element)
```

uses equality semantics appropriate to implementation:

- `HashSet`: hashCode + equals;
- `TreeSet`: comparator/compareTo;
- `EnumSet`: enum identity/ordinal internally.

## 3.4 `equals`

Two sets are equal if they contain same elements, regardless order.

```java
Set.of("A", "B").equals(Set.of("B", "A")) // true
```

## 3.5 `hashCode`

Set hash is sum-like over element hashes; order-independent.

## 3.6 Mutable elements warning

Set docs warn that behavior is not specified if an object value changes in a way that affects equals comparison while object is element in set.

## 3.7 Rule

Do not mutate fields that participate in equality/hash/comparator while object is inside a Set.

---

# 4. Kapan `Set` Tepat

Use `Set` when:

## 4.1 Membership matters

```java
if (permissions.contains(Permission.CASE_CLOSE)) {
    ...
}
```

## 4.2 Duplicate invalid or meaningless

```java
Set<CaseId> selectedCaseIds;
```

if duplicate selection is meaningless.

## 4.3 Domain uniqueness

```java
Set<Tag> tags;
Set<Role> roles;
Set<ViolationCode> violationCodes;
```

## 4.4 Fast lookup

Set usually better than List for repeated membership checks.

## 4.5 Graph traversal

```java
Set<NodeId> visited;
```

## 4.6 Dedup with intentional semantics

```java
Set<EmailAddress> uniqueRecipients;
```

## 4.7 Permission modeling

```java
EnumSet<Permission>
```

often excellent.

## 4.8 Rule

Use Set when “is member?” and “unique” are more important than position.

---

# 5. Kapan `Set` adalah Smell

## 5.1 Order matters but using HashSet

```java
Set<ApprovalStep> steps = new HashSet<>();
```

If workflow order matters, this is wrong.

Use:

```java
List<ApprovalStep>
SequencedCollection<ApprovalStep>
```

or ordered unique:

```java
SequencedSet<ApprovalStep>
LinkedHashSet<ApprovalStep>
```

## 5.2 Duplicate should be error

```java
Set<CaseId> ids = new HashSet<>(request.ids());
```

If duplicate request ID should cause validation error, this hides input bug.

## 5.3 Comparator defines wrong uniqueness

```java
new TreeSet<>(Comparator.comparing(Person::age))
```

People with same age collapse.

## 5.4 Mutable element

```java
Set<User> users;
user.setEmail(...); // if email affects equals/hash
```

Set becomes corrupted.

## 5.5 Need count/frequency

If duplicates count matters, use:

```java
Map<T, Long>
```

or multiset-like structure.

## 5.6 Need lookup value by key

If you often find object by ID:

```java
set.stream().filter(x -> x.id().equals(id))
```

Use:

```java
Map<Id, Object>
```

## 5.7 Rule

Set is not a universal dedup patch. It is a uniqueness model.

---

# 6. Uniqueness: Duplicate Rejected vs Silently Deduped

This is a critical distinction.

## 6.1 Silent dedup

```java
Set<CaseId> ids = new HashSet<>(request.caseIds());
```

Input:

```text
CASE-1, CASE-1, CASE-2
```

Output:

```text
CASE-1, CASE-2
```

No error.

## 6.2 Reject duplicates

If duplicate is invalid:

```java
static <T> Set<T> requireUnique(List<T> values) {
    Set<T> seen = new HashSet<>();
    List<T> duplicates = new ArrayList<>();

    for (T value : values) {
        if (!seen.add(value)) {
            duplicates.add(value);
        }
    }

    if (!duplicates.isEmpty()) {
        throw new IllegalArgumentException("Duplicate values: " + duplicates);
    }

    return Set.copyOf(seen);
}
```

## 6.3 Keep first occurrence order

```java
Set<CaseId> ids = new LinkedHashSet<>(request.caseIds());
```

This dedups while preserving encounter order.

## 6.4 Domain decision

Ask:

```text
Are duplicates invalid, redundant, or meaningful?
```

- invalid -> validation error;
- redundant -> set/dedup;
- meaningful -> list/multiset/count map.

## 6.5 Rule

Never dedup accidentally.

---

# 7. Equality and Hashing as Set Foundation

## 7.1 HashSet

Uses:

```java
hashCode
equals
```

## 7.2 TreeSet

Uses:

```java
Comparator
Comparable
```

for membership/uniqueness.

## 7.3 Record elements

Records have value equality based on components.

Good if components are immutable and equality semantics match.

## 7.4 BigDecimal trap

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00")) // false
```

HashSet sees different.

```java
new BigDecimal("1.0").compareTo(new BigDecimal("1.00")) // 0
```

TreeSet with natural ordering sees same.

So:

```java
new HashSet<>(List.of(new BigDecimal("1.0"), new BigDecimal("1.00"))).size() // 2
new TreeSet<>(List.of(new BigDecimal("1.0"), new BigDecimal("1.00"))).size() // 1
```

This can surprise.

## 7.5 Arrays

Arrays use reference equality.

```java
Set<byte[]> hashes = new HashSet<>();
hashes.add(new byte[]{1,2});
hashes.add(new byte[]{1,2});
hashes.size(); // 2
```

Use wrapper with content equality.

## 7.6 Rule

Before using Set, inspect element equality semantics.

---

# 8. Mutable Elements in Set

## 8.1 Bad example

```java
final class User {
    private String email;

    @Override
    public boolean equals(Object o) {
        return o instanceof User other && Objects.equals(email, other.email);
    }

    @Override
    public int hashCode() {
        return Objects.hash(email);
    }

    void changeEmail(String email) {
        this.email = email;
    }
}
```

Usage:

```java
Set<User> users = new HashSet<>();
User user = new User("a@example.com");
users.add(user);

user.changeEmail("b@example.com");

users.contains(user); // may be false
```

## 8.2 Why

Hash bucket chosen using old hash.

After mutation, lookup uses new hash.

## 8.3 Fix

- make set elements immutable;
- use stable identity key;
- remove then mutate then re-add;
- avoid mutable equality fields.

## 8.4 Entity warning

Entities with mutable business key in equals/hashCode are dangerous in Set.

## 8.5 Rule

Set elements must be stable with respect to equality while in set.

---

# 9. `HashSet` Mental Model

Java SE 25 `HashSet` implements `Set`, backed by a hash table, actually a `HashMap` instance. It makes no guarantees about iteration order and permits null.

Mental model:

```text
HashSet<E> = HashMap<E, dummyValue>
```

## 9.1 Add

```java
set.add(e)
```

stores `e` as key in backing HashMap.

## 9.2 Contains

```java
set.contains(e)
```

does hash lookup.

## 9.3 Performance

Expected constant-time for basic operations, assuming good hash distribution.

## 9.4 No ordering guarantee

Do not rely on iteration order.

Even if appears stable in tests, it is not contract.

## 9.5 Allows one null

HashSet permits null element.

## 9.6 Unsynchronized

HashSet is not thread-safe.

## 9.7 Rule

HashSet is general-purpose Set default when ordering is not required.

---

# 10. `HashSet` Ordering and Capacity

## 10.1 No order guarantee

```java
Set<String> s = new HashSet<>();
s.add("A");
s.add("B");
s.add("C");

for (String x : s) {
    ...
}
```

Do not assume A, B, C order.

## 10.2 Capacity and load factor

HashSet performance depends on:

- initial capacity;
- load factor;
- hash function quality.

Too low capacity -> resizing.

Too high capacity -> wasted memory and iteration cost may increase because iteration scans bucket table.

## 10.3 Pre-sizing

If expected size known:

```java
Set<CaseId> ids = new HashSet<>(expectedSize * 2);
```

But exact sizing should be done carefully. Over-sizing can waste memory.

## 10.4 Iteration cost

HashSet iteration cost depends on size plus capacity.

This is one reason not to massively over-allocate.

## 10.5 Rule

Use HashSet for membership; avoid relying on order; size sensibly for large sets.

---

# 11. `LinkedHashSet` Mental Model

Java SE 25 `LinkedHashSet` is a hash table and linked list implementation of `Set`, with well-defined encounter order. It differs from `HashSet` by maintaining a doubly-linked list through entries; encounter order is generally insertion order.

## 11.1 Meaning

```java
LinkedHashSet<E>
```

gives:

```text
Set uniqueness + stable encounter order.
```

## 11.2 Use cases

- dedup while preserving input order;
- deterministic output;
- ordered tags;
- unique recipients preserving request order;
- stable tests;
- display order.

## 11.3 Example

```java
Set<String> uniqueInInputOrder = new LinkedHashSet<>(List.of("B", "A", "B", "C"));
// iteration: B, A, C
```

## 11.4 Cost

Compared to HashSet:

- slightly more memory;
- maintains linked order;
- predictable iteration.

## 11.5 Java 21+

LinkedHashSet participates in sequenced set semantics.

## 11.6 Rule

Use LinkedHashSet when uniqueness and encounter order both matter.

---

# 12. `SequencedSet` and Encounter Order

Java SE 25 `SequencedSet` is both `SequencedCollection` and `Set`: it can be thought of as a Set with well-defined encounter order, or a SequencedCollection with unique elements.

## 12.1 Meaning

```java
SequencedSet<Tag> tags
```

says:

```text
Tags are unique and have defined encounter order.
```

## 12.2 Order-insensitive equality

Important: `SequencedSet` inherits Set equality/hash behavior. Two sets compare equal if they contain same elements, irrespective of order.

```java
SequencedSet<String> a = new LinkedHashSet<>(List.of("A", "B"));
SequencedSet<String> b = new LinkedHashSet<>(List.of("B", "A"));

a.equals(b) // true as Set equality, despite different encounter order
```

## 12.3 First/last operations

SequencedSet supports first/last/reversed style operations, depending implementation mutability.

## 12.4 Domain implication

If order is part of equality, SequencedSet is not enough. Use List or custom value object equality.

## 12.5 Example

```java
record OrderedUniqueTags(SequencedSet<Tag> values) {
    OrderedUniqueTags {
        values = new LinkedHashSet<>(values);
    }

    Tag first() {
        return values.getFirst();
    }
}
```

## 12.6 Rule

SequencedSet means unique + ordered traversal, but equality remains set-like.

---

# 13. `TreeSet` Mental Model

`TreeSet` is a NavigableSet implementation backed by a TreeMap. Elements are ordered by natural ordering or comparator.

## 13.1 Meaning

```java
TreeSet<E>
```

gives:

```text
Unique elements according to comparator/natural ordering + sorted order + navigation.
```

## 13.2 Operations

Good for:

```java
first()
last()
floor()
ceiling()
lower()
higher()
subSet()
headSet()
tailSet()
```

## 13.3 Performance

Typically O(log n) for add/remove/contains.

Slower than HashSet for simple membership, but supports order/range.

## 13.4 Natural ordering

Elements must be mutually comparable if no comparator supplied.

## 13.5 Null

Null handling depends on comparator; natural ordering usually cannot handle null.

## 13.6 Rule

Use TreeSet when sorted uniqueness or range/navigation matters.

---

# 14. Comparator Consistency and TreeSet Pitfalls

TreeSet uniqueness is based on comparison, not equals.

## 14.1 Dangerous comparator

```java
record Person(String name, int age) {}

Set<Person> people = new TreeSet<>(Comparator.comparing(Person::age));

people.add(new Person("A", 30));
people.add(new Person("B", 30));

people.size(); // 1
```

Because comparator says age equal.

## 14.2 Fix with tie-breaker

```java
Comparator<Person> byAgeThenName =
    Comparator.comparingInt(Person::age)
              .thenComparing(Person::name);
```

But ensure it matches desired uniqueness.

## 14.3 If uniqueness should be by ID

Use comparator by ID or use HashSet plus sorted view.

## 14.4 Comparator inconsistent with equals

Set interface generally recommends ordering consistent with equals to obey Set contract expectations.

If inconsistent, behavior is well-defined by comparator but surprising.

## 14.5 Mutable comparison fields

If field used by comparator changes while object in TreeSet, set behavior breaks.

## 14.6 Rule

For TreeSet, comparator defines identity inside the set.

---

# 15. `EnumSet` Mental Model

`EnumSet` is specialized Set implementation for enum types.

## 15.1 Meaning

```java
EnumSet<Permission>
```

gives:

```text
Set of enum constants, compact and fast.
```

## 15.2 Internal model

Typically represented as bit vector.

This makes it:

- compact;
- fast;
- ideal for flags/permissions/options.

## 15.3 Creation

```java
EnumSet<Permission> none = EnumSet.noneOf(Permission.class);
EnumSet<Permission> all = EnumSet.allOf(Permission.class);
EnumSet<Permission> some = EnumSet.of(Permission.READ, Permission.WRITE);
```

## 15.4 Null

EnumSet does not permit null elements.

## 15.5 Copying

```java
EnumSet<Permission> copy = EnumSet.copyOf(existing);
```

## 15.6 Domain wrapper

```java
public final class PermissionSet {
    private final EnumSet<Permission> values;

    public PermissionSet(Set<Permission> values) {
        this.values = values.isEmpty()
            ? EnumSet.noneOf(Permission.class)
            : EnumSet.copyOf(values);
    }

    public boolean allows(Permission permission) {
        return values.contains(permission);
    }

    public Set<Permission> asSet() {
        return Set.copyOf(values);
    }
}
```

## 15.7 Warning

EnumSet internally uses enum ordinal, but that does not mean you should persist enum ordinal externally.

## 15.8 Rule

Use EnumSet for enum membership sets.

---

# 16. Set Operations: Union, Intersection, Difference

Java Set operations are often done through mutable copies.

## 16.1 Union

```java
Set<T> union = new HashSet<>(a);
union.addAll(b);
```

## 16.2 Intersection

```java
Set<T> intersection = new HashSet<>(a);
intersection.retainAll(b);
```

## 16.3 Difference

```java
Set<T> difference = new HashSet<>(a);
difference.removeAll(b);
```

## 16.4 Immutable result

```java
Set<T> result = Set.copyOf(union);
```

## 16.5 Preserve order

Use LinkedHashSet if encounter order matters.

```java
Set<T> union = new LinkedHashSet<>(a);
union.addAll(b);
```

## 16.6 EnumSet optimization

For enum sets:

```java
EnumSet<Permission> union = EnumSet.copyOf(a);
union.addAll(b);
```

## 16.7 Rule

Set algebra should choose implementation based on desired result order/performance.

---

# 17. Null Elements

## 17.1 HashSet

Permits null.

```java
Set<String> s = new HashSet<>();
s.add(null);
```

## 17.2 LinkedHashSet

Permits null.

## 17.3 TreeSet

Natural ordering usually cannot compare null.

A custom comparator can support null.

## 17.4 EnumSet

Does not permit null.

## 17.5 Set.of

Disallows null.

## 17.6 Domain recommendation

Prefer null-free sets.

Use `Set.copyOf` to reject null when making immutable copy.

## 17.7 Rule

Null policy is implementation/domain-specific, not guaranteed by Set interface.

---

# 18. Set Equality and Hashing

## 18.1 Order-insensitive equality

```java
Set.of("A", "B").equals(Set.of("B", "A")) // true
```

## 18.2 LinkedHashSet equality

Even though it has insertion order, equals is still Set equality.

## 18.3 TreeSet equality

TreeSet equals another set if same elements according to Set semantics. But membership in TreeSet determined by comparator.

## 18.4 Hash code

Set hash is order-independent.

## 18.5 If order matters in equality

Use:

```java
List<T>
```

or custom type with custom equality.

## 18.6 Rule

Set equality says same members, not same order.

---

# 19. Sets in Records and Value Objects

## 19.1 Bad

```java
record PermissionGroup(Set<Permission> permissions) {}
```

This is shallow immutable only.

Caller can mutate original set.

## 19.2 Better

```java
record PermissionGroup(Set<Permission> permissions) {
    PermissionGroup {
        permissions = Set.copyOf(permissions);
    }
}
```

## 19.3 For enum

```java
public final class PermissionGroup {
    private final EnumSet<Permission> permissions;

    public PermissionGroup(Set<Permission> permissions) {
        this.permissions = permissions.isEmpty()
            ? EnumSet.noneOf(Permission.class)
            : EnumSet.copyOf(permissions);
    }

    public Set<Permission> permissions() {
        return Set.copyOf(permissions);
    }
}
```

## 19.4 If order matters

Do not use plain Set.

Use SequencedSet or List/wrapper.

## 19.5 Rule

Set components need defensive copy and element immutability review.

---

# 20. Set as Domain Type

A Set can encode domain invariant.

## 20.1 PermissionSet

```java
PermissionSet
```

## 20.2 ViolationCodeSet

```java
record ViolationCodeSet(Set<ViolationCode> values) {
    ViolationCodeSet {
        values = Set.copyOf(values);
        if (values.isEmpty()) {
            throw new IllegalArgumentException("At least one violation required");
        }
    }
}
```

## 20.3 UniqueRecipients

```java
record UniqueRecipients(Set<EmailAddress> values) {}
```

## 20.4 OrderedUniqueSelection

```java
record OrderedUniqueSelection(SequencedSet<CaseId> values) {}
```

## 20.5 Why wrapper?

Raw Set does not express:

- non-empty;
- max size;
- null policy;
- security;
- domain operations;
- duplicate rejection behavior.

## 20.6 Rule

If uniqueness is core domain rule, consider domain wrapper.

---

# 21. PermissionSet Pattern

Permissions are one of the best uses of `EnumSet`.

## 21.1 Enum

```java
enum Permission {
    CASE_READ,
    CASE_ASSIGN,
    CASE_CLOSE,
    CASE_ARCHIVE
}
```

## 21.2 Wrapper

```java
public final class PermissionSet {
    private final EnumSet<Permission> values;

    private PermissionSet(EnumSet<Permission> values) {
        this.values = values.clone();
    }

    public static PermissionSet none() {
        return new PermissionSet(EnumSet.noneOf(Permission.class));
    }

    public static PermissionSet of(Permission first, Permission... rest) {
        EnumSet<Permission> set = EnumSet.of(first, rest);
        return new PermissionSet(set);
    }

    public boolean allows(Permission permission) {
        return values.contains(permission);
    }

    public PermissionSet plus(Permission permission) {
        EnumSet<Permission> copy = values.clone();
        copy.add(permission);
        return new PermissionSet(copy);
    }

    public Set<Permission> asSet() {
        return Set.copyOf(values);
    }
}
```

## 21.3 Benefits

- compact;
- fast;
- no duplicates;
- domain operation `allows`;
- immutable external behavior.

## 21.4 Avoid

```java
List<String> permissions
```

This invites duplicate/string typo/ordering confusion.

## 21.5 Rule

EnumSet + wrapper is often ideal for permission flags.

---

# 22. Visited Set and Graph Algorithms

## 22.1 Use case

```java
Set<NodeId> visited = new HashSet<>();
```

Prevents revisiting nodes.

## 22.2 Correctness depends on NodeId equality

If NodeId equality wrong, graph traversal loops or skips nodes.

## 22.3 BFS example

```java
Queue<NodeId> queue = new ArrayDeque<>();
Set<NodeId> visited = new HashSet<>();

queue.add(start);
visited.add(start);

while (!queue.isEmpty()) {
    NodeId current = queue.remove();

    for (NodeId next : graph.neighbors(current)) {
        if (visited.add(next)) {
            queue.add(next);
        }
    }
}
```

## 22.4 `visited.add(next)` idiom

`add` returns true only if new.

Useful.

## 22.5 Large graph

For huge graph:

- memory cost of HashSet significant;
- consider primitive IDs/bitset/bloom filter depending requirements.

## 22.6 Rule

Visited set is correctness-critical; key type must be stable and compact enough.

---

# 23. Set vs List vs Map

## 23.1 Use List when

- order matters;
- duplicates meaningful;
- positional access.

## 23.2 Use Set when

- uniqueness/membership matters;
- duplicates invalid or redundant.

## 23.3 Use Map when

- lookup by key to value matters;
- you often search object by ID.

## 23.4 Example smell

```java
List<User> users;

User find(UserId id) {
    return users.stream()
        .filter(u -> u.id().equals(id))
        .findFirst()
        .orElseThrow();
}
```

If frequent:

```java
Map<UserId, User> usersById;
```

## 23.5 Set of objects vs Map by ID

If object has ID and lookup by ID matters, Map is often better than Set.

## 23.6 Rule

Choose based on dominant semantic operation: sequence, membership, or lookup.

---

# 24. Set and Streams

## 24.1 Collect to set

```java
Set<EmailAddress> emails = users.stream()
    .map(User::email)
    .collect(Collectors.toSet());
```

But `Collectors.toSet()` does not guarantee implementation/order.

## 24.2 Need order-preserving set

```java
Set<EmailAddress> emails = users.stream()
    .map(User::email)
    .collect(Collectors.toCollection(LinkedHashSet::new));
```

## 24.3 Need enum set

```java
EnumSet<Permission> permissions = users.stream()
    .flatMap(u -> u.permissions().stream())
    .collect(Collectors.toCollection(() -> EnumSet.noneOf(Permission.class)));
```

But this is awkward if stream may be empty. Often simpler loop/wrapper factory.

## 24.4 `distinct`

Stream `distinct()` uses equality and may preserve encounter order for ordered streams.

```java
list.stream().distinct().toList()
```

This dedups while keeping first occurrence order for ordered stream.

## 24.5 `toSet` and mutability

`Collectors.toSet()` does not promise unmodifiable.

`stream.collect(Collectors.toUnmodifiableSet())` gives unmodifiable set and rejects null.

## 24.6 Rule

When collecting to Set, choose implementation/order/mutability deliberately.

---

# 25. Set in API/JSON Contracts

JSON has arrays, not sets.

A Java `Set<T>` typically serializes as JSON array:

```json
["READ", "WRITE"]
```

## 25.1 Need uniqueItems

OpenAPI/JSON Schema can express uniqueness:

```yaml
type: array
uniqueItems: true
items:
  type: string
```

## 25.2 Order

If Java Set is HashSet, response order should not be meaningful.

If order matters, document it and use ordered representation.

## 25.3 Duplicate input policy

If request contains duplicates:

```json
["READ", "READ"]
```

Policy options:

- reject;
- silently dedup;
- preserve duplicates as list.

For permissions, reject or dedup may both be reasonable. But decide explicitly.

## 25.4 Stable output

Use sorted or linked order if deterministic output matters.

## 25.5 Rule

API must state uniqueness and order semantics; Java Set alone is not enough.

---

# 26. Set in Database Mapping

## 26.1 Join table

Permission set:

```sql
user_permission (
    user_id VARCHAR NOT NULL,
    permission_code VARCHAR NOT NULL,
    PRIMARY KEY (user_id, permission_code)
)
```

Primary key enforces uniqueness.

## 26.2 Ordered unique set

Need order column plus unique constraint.

```sql
case_tag (
    case_id VARCHAR NOT NULL,
    tag_code VARCHAR NOT NULL,
    position INT NOT NULL,
    PRIMARY KEY (case_id, tag_code),
    UNIQUE (case_id, position)
)
```

## 26.3 JSON array column

Can store set as JSON array, but DB uniqueness constraints harder.

## 26.4 Delimited string

Bad:

```text
READ,WRITE,CLOSE
```

Hard to query/validate/migrate.

## 26.5 Rule

If uniqueness is durable, enforce it in database too.

---

# 27. Set and Concurrency

## 27.1 HashSet not thread-safe

Concurrent mutation unsafe.

## 27.2 Concurrent set from ConcurrentHashMap

```java
Set<T> set = ConcurrentHashMap.newKeySet();
```

Useful for concurrent membership.

## 27.3 Synchronized set

```java
Set<T> set = Collections.synchronizedSet(new HashSet<>());
```

Iteration requires external synchronization.

## 27.4 CopyOnWriteArraySet

Good for small read-mostly sets.

## 27.5 Immutable snapshot

Often best for config/permissions:

```java
volatile Set<Permission> permissions = Set.of();

void reload(Set<Permission> newPermissions) {
    permissions = Set.copyOf(newPermissions);
}
```

## 27.6 Mutable elements still problem

Thread-safe set does not make element state thread-safe.

## 27.7 Rule

Choose concurrent set strategy based on read/write pattern.

---

# 28. Performance and Memory Cost Model

## 28.1 HashSet

Good:

- membership expected O(1);
- add/remove expected O(1).

Costs:

- backing HashMap;
- bucket table;
- node objects;
- hash computation;
- memory overhead higher than list.

## 28.2 LinkedHashSet

Adds linked ordering overhead, but deterministic encounter order.

## 28.3 TreeSet

O(log n), supports order/range.

Comparator cost matters.

## 28.4 EnumSet

Very compact and fast for enum.

Often best for enum membership.

## 28.5 Small sets

For tiny sets, overhead can dominate. `Set.of` is compact for constants.

## 28.6 Huge sets

Watch:

- memory;
- object overhead;
- hash quality;
- resizing;
- GC pressure.

## 28.7 Primitive IDs

If huge set of primitive IDs, boxed `Set<Integer>` can be memory-heavy.

Alternatives:

- primitive collections library;
- bitset if dense;
- sorted primitive array + binary search;
- bloom filter for probabilistic membership.

## 28.8 Rule

Set is semantically powerful but can be memory-expensive.

---

# 29. Production Failure Modes

## 29.1 Silent duplicate removal

Input duplicates should be error but are deduped.

Fix: validate duplicates before Set conversion.

## 29.2 HashSet order relied upon

Tests pass, production order changes.

Fix: use LinkedHashSet/List/sorted output.

## 29.3 Mutable key element

Element mutation breaks HashSet membership.

Fix: immutable elements or remove-mutate-readd.

## 29.4 TreeSet comparator drops elements

Comparator compares only age/status, not identity.

Fix: comparator matches uniqueness semantics.

## 29.5 BigDecimal inconsistency

HashSet and TreeSet produce different sizes.

Fix: domain decimal type with canonical scale.

## 29.6 Array elements

Set<byte[]> dedups by identity not content.

Fix: wrapper with content equality.

## 29.7 EnumSet copied from empty set incorrectly

`EnumSet.copyOf(emptyCollection)` can fail if enum type cannot be inferred. Use `EnumSet.noneOf`.

## 29.8 Null crash after Set.of

`Set.of` rejects null.

Fix: validate null policy.

## 29.9 Concurrent HashSet mutation

Race/corruption.

Fix: concurrent set or immutable snapshot.

## 29.10 JSON Set order nondeterministic

API clients observe changing order.

Fix: stable order or document unordered.

## 29.11 DB lacks unique constraint

App Set enforces uniqueness but manual script inserts duplicates.

Fix: DB unique constraint.

---

# 30. Best Practices

## 30.1 General

- Use Set when uniqueness/membership is semantic.
- Do not use Set to hide duplicate errors.
- Choose implementation intentionally.
- Prefer HashSet for unordered membership.
- Prefer LinkedHashSet for ordered unique traversal.
- Prefer TreeSet for sorted/range operations.
- Prefer EnumSet for enum values.
- Use Set.copyOf for immutable null-free snapshot.
- Wrap Set for domain invariants.
- Keep elements immutable with respect to equality.
- Do not rely on HashSet order.

## 30.2 API

- Document uniqueness with `uniqueItems`.
- Document order if any.
- Define duplicate input policy.
- Bound collection size.

## 30.3 DB

- Mirror uniqueness with unique constraints.
- Use join table for queryable sets.
- Avoid delimited string sets.

## 30.4 Streams

- Use `distinct` for order-preserving dedup in ordered stream.
- Use explicit collector if Set implementation matters.
- Avoid assuming `Collectors.toSet()` order/type.

## 30.5 Concurrency

- Use immutable snapshots for read-mostly.
- Use ConcurrentHashMap.newKeySet for concurrent membership.
- Avoid mutable elements.

---

# 31. Decision Matrix

| Requirement | Recommended |
|---|---|
| general unique membership | `HashSet` |
| unique + preserve insertion order | `LinkedHashSet` / `SequencedSet` |
| unique + sorted order | `TreeSet` / `SortedSet` |
| unique + range/nearest lookup | `NavigableSet` / `TreeSet` |
| enum permissions/options | `EnumSet` |
| immutable small constants | `Set.of` |
| immutable snapshot | `Set.copyOf` |
| concurrent membership | `ConcurrentHashMap.newKeySet()` |
| read-mostly small concurrent set | `CopyOnWriteArraySet` |
| duplicate should be error | validate duplicates before Set |
| order-sensitive equality | `List` or custom wrapper, not Set |
| frequency/count duplicates | `Map<T, Long>` |
| lookup object by ID | `Map<Id, Object>` |
| ordered unique API output | `LinkedHashSet` or sorted list |
| dense integer membership | `BitSet` or primitive specialized structure |

---

# 32. Latihan

## Latihan 1 — Duplicate Policy

Given request:

```json
{
  "caseIds": ["CASE-1", "CASE-1", "CASE-2"]
}
```

Design two policies:

1. silently dedup while preserving order;
2. reject duplicate with validation error.

Implement both.

## Latihan 2 — Mutable Element Bug

Create class with mutable `email` used in equals/hashCode. Put into HashSet, mutate, observe `contains`.

Refactor to immutable record.

## Latihan 3 — TreeSet Comparator Bug

Create:

```java
record Person(String name, int age) {}
```

Use `TreeSet` comparator by age. Add two persons same age. Explain result. Fix comparator.

## Latihan 4 — BigDecimal Set Difference

Compare HashSet and TreeSet behavior for:

```java
1.0
1.00
```

Explain.

## Latihan 5 — PermissionSet

Implement immutable PermissionSet backed by EnumSet with:

- `allows`;
- `plus`;
- `minus`;
- `containsAll`;
- `asSet`.

## Latihan 6 — API Schema

Design OpenAPI schema for `Set<Permission>`:

- unique items;
- max 20;
- enum values;
- duplicate policy.

## Latihan 7 — DB Mapping

Design table for ordered unique tags per case.

## Latihan 8 — Stream Collecting

Collect list of emails into:

- HashSet;
- LinkedHashSet preserving order;
- unmodifiable Set.

Explain differences.

---

# 33. Ringkasan

`Set` is uniqueness contract.

Core lessons:

- Set means no duplicate elements.
- HashSet is general-purpose unordered membership set.
- LinkedHashSet adds defined encounter order.
- SequencedSet means unique + encounter order, but equality remains order-insensitive.
- TreeSet uses comparator/natural ordering for uniqueness and sorted navigation.
- EnumSet is ideal for enum membership.
- Set correctness depends on element equality/hash/comparator.
- Mutable elements can corrupt Set behavior.
- BigDecimal and arrays have surprising equality implications.
- Silent dedup can hide invalid input.
- API/DB/event boundaries must explicitly define uniqueness and order.
- Set is not List and not Map.
- For huge sets, memory cost matters.
- For concurrent sets, choose strategy deliberately.

Main rule:

```text
Use Set when uniqueness is the model, not merely because duplicates are inconvenient.
```

---

# 34. Referensi

1. Java SE 25 — `Set`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html

2. Java SE 25 — `HashSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashSet.html

3. Java SE 25 — `LinkedHashSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedHashSet.html

4. Java SE 25 — `TreeSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeSet.html

5. Java SE 25 — `EnumSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumSet.html

6. Java SE 25 — `SortedSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SortedSet.html

7. Java SE 25 — `NavigableSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/NavigableSet.html

8. Java SE 25 — `SequencedSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedSet.html

9. JEP 431 — Sequenced Collections  
   https://openjdk.org/jeps/431

10. Java SE 25 — Collections Framework Overview  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-overview.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-collections-and-streams-part-002.md">⬅️ Java Collections and Streams — Part 002</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-collections-and-streams-part-004.md">Java Collections and Streams — Part 004 ➡️</a>
</div>

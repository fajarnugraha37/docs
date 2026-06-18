# learn-java-collections-and-streams-part-018.md

# Java Collections and Streams — Part 018  
# Enum Collections: EnumSet, EnumMap, Bit Vector Mental Model, Ordinal Array Indexing, Type Safety, Flags, State Sets, and Production Pitfalls

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **018**  
> Fokus: memahami collection khusus enum: `EnumSet` dan `EnumMap`. Kita akan membedah kenapa keduanya sangat efisien, bagaimana mental model bit vector dan ordinal-indexed array, kapan mengganti `HashSet<Enum>`/`HashMap<Enum,V>`, bagaimana null/type/order policy-nya, bagaimana desain permission flags/state sets/rule maps, dan jebakan enum evolution di production.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Enum Collections Memanfaatkan Universe yang Terbatas](#2-mental-model-enum-collections-memanfaatkan-universe-yang-terbatas)
3. [Kenapa Enum Butuh Collection Khusus](#3-kenapa-enum-butuh-collection-khusus)
4. [`EnumSet<E extends Enum<E>>`](#4-enumsete-extends-enume)
5. [`EnumMap<K extends Enum<K>, V>`](#5-enummapk-extends-enumk-v)
6. [EnumSet Internal Mental Model: Bit Vector](#6-enumset-internal-mental-model-bit-vector)
7. [EnumMap Internal Mental Model: Ordinal Array](#7-enummap-internal-mental-model-ordinal-array)
8. [Enum Universe](#8-enum-universe)
9. [Natural Order: Declaration Order](#9-natural-order-declaration-order)
10. [Null Policy](#10-null-policy)
11. [Type Safety](#11-type-safety)
12. [EnumSet Factory Methods](#12-enumset-factory-methods)
13. [EnumMap Constructors](#13-enummap-constructors)
14. [EnumSet vs HashSet](#14-enumset-vs-hashset)
15. [EnumMap vs HashMap](#15-enummap-vs-hashmap)
16. [EnumSet as Flags](#16-enumset-as-flags)
17. [EnumSet as State Capability Set](#17-enumset-as-state-capability-set)
18. [EnumMap as Strategy Table](#18-enummap-as-strategy-table)
19. [EnumMap as Transition Table](#19-enummap-as-transition-table)
20. [EnumMap as Configuration Matrix](#20-enummap-as-configuration-matrix)
21. [Complement, Range, and Bulk Operations](#21-complement-range-and-bulk-operations)
22. [Iteration Behavior](#22-iteration-behavior)
23. [Equality, Hashing, and Ordering](#23-equality-hashing-and-ordering)
24. [Mutability and Defensive Copying](#24-mutability-and-defensive-copying)
25. [Concurrency](#25-concurrency)
26. [Serialization and Persistence Boundaries](#26-serialization-and-persistence-boundaries)
27. [API/JSON/Event Boundaries](#27-apijsonevent-boundaries)
28. [Database Mapping](#28-database-mapping)
29. [Enum Evolution Risks](#29-enum-evolution-risks)
30. [Anti-Patterns](#30-anti-patterns)
31. [Performance Cost Model](#31-performance-cost-model)
32. [Testing Enum Collections](#32-testing-enum-collections)
33. [Production Failure Modes](#33-production-failure-modes)
34. [Best Practices](#34-best-practices)
35. [Decision Matrix](#35-decision-matrix)
36. [Latihan](#36-latihan)
37. [Ringkasan](#37-ringkasan)
38. [Referensi](#38-referensi)

---

# 1. Tujuan Bagian Ini

Enum adalah type dengan kemungkinan value yang terbatas dan diketahui.

Contoh:

```java
enum Permission {
    VIEW_CASE,
    EDIT_CASE,
    CLOSE_CASE,
    APPROVE_CASE
}
```

Jika kita butuh kumpulan permission:

```java
Set<Permission> permissions
```

Secara umum kita bisa memakai:

```java
HashSet<Permission>
```

Tetapi Java menyediakan:

```java
EnumSet<Permission>
```

Jika kita butuh mapping dari enum ke value:

```java
Map<CaseStatus, Handler>
```

Kita bisa memakai:

```java
HashMap<CaseStatus, Handler>
```

Tetapi Java menyediakan:

```java
EnumMap<CaseStatus, Handler>
```

Kenapa?

Karena enum punya:

```text
fixed universe
ordinal
identity-safe singleton constants
declaration order
known key/element type
```

Ini memungkinkan representation yang jauh lebih compact dan efficient.

Tujuan bagian ini:

- memahami `EnumSet` dan `EnumMap`;
- memahami bit vector dan ordinal array mental model;
- memahami factory/constructor;
- memahami null/type/order/mutability behavior;
- memahami use cases seperti flags, permission sets, transition tables;
- memahami enum evolution risks;
- tahu kapan mengganti HashSet/HashMap dengan EnumSet/EnumMap.

---

# 2. Mental Model: Enum Collections Memanfaatkan Universe yang Terbatas

Untuk enum:

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED,
    CLOSED
}
```

Semua possible value sudah diketahui:

```text
universe = [DRAFT, SUBMITTED, APPROVED, REJECTED, CLOSED]
```

Setiap constant punya ordinal:

```text
DRAFT     -> 0
SUBMITTED -> 1
APPROVED  -> 2
REJECTED  -> 3
CLOSED    -> 4
```

## 2.1 EnumSet

Set membership bisa direpresentasikan sebagai bit.

```text
[DRAFT, SUBMITTED, APPROVED, REJECTED, CLOSED]
   0        1          0         0       1
```

Artinya:

```text
{SUBMITTED, CLOSED}
```

## 2.2 EnumMap

Mapping bisa direpresentasikan sebagai array indexed by ordinal.

```text
values[status.ordinal()] = handler
```

## 2.3 Why fast?

Tidak perlu:

- hash computation;
- hash bucket;
- node object per entry;
- comparator;
- tree traversal.

## 2.4 Rule

```text
Enum collections are efficient because enum key/element universe is fixed, small, and ordinal-addressable.
```

---

# 3. Kenapa Enum Butuh Collection Khusus

## 3.1 HashSet<Enum> works, but generic

`HashSet<Permission>` tidak tahu bahwa key universe terbatas.

It still uses hash-table machinery.

## 3.2 HashMap<Enum,V> works, but generic

`HashMap<CaseStatus, Handler>` stores nodes/buckets.

But enum keys can be represented by ordinal-indexed array.

## 3.3 Enum-specific benefits

- compact memory;
- fast operations;
- natural enum declaration order;
- type safety for single enum type;
- readable factory APIs;
- excellent for flags and state sets.

## 3.4 Rule

When element/key type is enum, consider EnumSet/EnumMap before HashSet/HashMap.

---

# 4. `EnumSet<E extends Enum<E>>`

`EnumSet` is a specialized Set implementation for enum types.

## 4.1 Type bound

```java
EnumSet<E extends Enum<E>>
```

Only enum element types are allowed.

## 4.2 All elements same enum type

An EnumSet contains elements from one enum type.

## 4.3 No null elements

EnumSet does not permit null elements.

## 4.4 Natural order

Iteration order follows enum declaration order.

## 4.5 Modifiable

EnumSet instances are generally mutable unless wrapped/copied into unmodifiable form.

## 4.6 Not synchronized

External synchronization required if shared and mutated concurrently.

## 4.7 Rule

EnumSet is the default Set implementation for enum elements.

---

# 5. `EnumMap<K extends Enum<K>, V>`

`EnumMap` is a specialized Map implementation for enum keys.

## 5.1 Type bound

```java
EnumMap<K extends Enum<K>, V>
```

Keys must be enum constants.

## 5.2 All keys same enum type

All keys come from one enum type.

## 5.3 Null keys not allowed

Null keys are not permitted.

## 5.4 Null values allowed

EnumMap permits null values.

But null values can create `get` ambiguity just like other maps.

## 5.5 Natural order

Iteration order follows enum declaration order of keys.

## 5.6 Modifiable

EnumMap is mutable.

## 5.7 Not synchronized

External synchronization required for concurrent mutation.

## 5.8 Rule

EnumMap is the default Map implementation for enum keys.

---

# 6. EnumSet Internal Mental Model: Bit Vector

EnumSet can be represented internally as bit vector.

## 6.1 Small enum

If enum has <= 64 constants, one `long` can represent membership.

Conceptually:

```text
bit 0 -> enum ordinal 0
bit 1 -> enum ordinal 1
...
```

## 6.2 Large enum

If enum has more constants, representation can use long array.

## 6.3 Operation examples

Contains:

```text
(mask & (1L << ordinal)) != 0
```

Add:

```text
mask |= (1L << ordinal)
```

Remove:

```text
mask &= ~(1L << ordinal)
```

Union:

```text
a | b
```

Intersection:

```text
a & b
```

Difference:

```text
a & ~b
```

## 6.4 Why efficient

Bulk set operations become bit operations.

## 6.5 Rule

EnumSet is conceptually a type-safe bitset for enum constants.

---

# 7. EnumMap Internal Mental Model: Ordinal Array

EnumMap can store values in array slots corresponding to enum ordinal.

## 7.1 Conceptual

```java
Object[] values = new Object[enumUniverse.length];
```

For key:

```java
values[key.ordinal()] = value;
```

## 7.2 Presence tracking

Because null values may be allowed, implementation needs distinguish:

```text
no mapping
mapped to null
```

This can be done with internal sentinel/masking strategy.

## 7.3 Why efficient

- no hashing;
- no tree;
- direct ordinal indexing;
- compact array storage;
- iteration by enum order.

## 7.4 Limitation

Requires knowing key enum type.

## 7.5 Rule

EnumMap is conceptually an array indexed by enum ordinal with Map semantics.

---

# 8. Enum Universe

Enum universe means all constants of a given enum type.

## 8.1 Example

```java
enum Channel {
    EMAIL,
    SMS,
    PUSH
}
```

Universe:

```text
[EMAIL, SMS, PUSH]
```

## 8.2 EnumSet needs type

An empty EnumSet cannot infer enum type from elements because there are no elements.

So use:

```java
EnumSet.noneOf(Channel.class)
```

## 8.3 EnumMap needs key type

```java
new EnumMap<>(Channel.class)
```

## 8.4 Copy constructors

EnumMap can infer type from existing EnumMap or from non-empty Map in some constructors.

But explicit class is often clearer.

## 8.5 Rule

Empty enum collections require explicit enum type.

---

# 9. Natural Order: Declaration Order

Enum natural order is declaration order.

```java
enum Priority {
    LOW,
    MEDIUM,
    HIGH
}
```

Natural order:

```text
LOW < MEDIUM < HIGH
```

## 9.1 EnumSet iteration

EnumSet iterates in natural order.

## 9.2 EnumMap iteration

EnumMap keySet/entrySet iterate in key natural order.

## 9.3 Not insertion order

Adding HIGH first does not make it appear first.

## 9.4 Domain caution

Changing enum declaration order can affect output order.

## 9.5 Rule

Enum collection order follows enum declaration order, not insertion order.

---

# 10. Null Policy

## 10.1 EnumSet

Null elements are not permitted.

```java
EnumSet.of(null)
```

throws.

## 10.2 EnumMap

Null keys are not permitted.

Null values are permitted.

```java
map.put(Status.OPEN, null); // allowed
map.put(null, value);       // not allowed
```

## 10.3 Null values danger

```java
map.get(Status.OPEN) == null
```

could mean:

- absent;
- present mapped to null.

Use `containsKey` if null values are intentional.

## 10.4 Recommendation

Avoid null values in EnumMap unless explicitly modeled.

## 10.5 Rule

Enum collections reject null enum keys/elements; keep values null-free by design where possible.

---

# 11. Type Safety

EnumSet and EnumMap prevent mixing enum types.

## 11.1 Good

```java
EnumSet<Permission> permissions = EnumSet.of(Permission.VIEW_CASE);
```

Cannot add unrelated enum.

## 11.2 Different enum types

```java
enum Permission { VIEW }
enum Status { VIEW }
```

Even if constants have same names, types are different.

## 11.3 Raw type danger

Raw EnumSet/EnumMap can break compile-time safety.

Avoid raw types.

## 11.4 Rule

Enum collections give strong type safety when used with generics.

---

# 12. EnumSet Factory Methods

EnumSet has rich factory methods.

## 12.1 noneOf

```java
EnumSet<Permission> none = EnumSet.noneOf(Permission.class);
```

Empty set with explicit enum type.

## 12.2 allOf

```java
EnumSet<Permission> all = EnumSet.allOf(Permission.class);
```

All constants.

## 12.3 of

```java
EnumSet<Permission> basic =
    EnumSet.of(Permission.VIEW_CASE, Permission.EDIT_CASE);
```

## 12.4 range

```java
EnumSet<Priority> mediumAndAbove =
    EnumSet.range(Priority.MEDIUM, Priority.HIGH);
```

Includes endpoints and follows declaration order.

## 12.5 complementOf

```java
EnumSet<Permission> denied =
    EnumSet.complementOf(allowed);
```

All enum constants not in allowed.

## 12.6 copyOf

```java
EnumSet<Permission> copy = EnumSet.copyOf(existingSet);
```

If copying from general collection, source must be non-empty so enum type can be inferred.

## 12.7 Rule

Use factory method that expresses intent: none, all, of, range, complement, copy.

---

# 13. EnumMap Constructors

## 13.1 Explicit enum type

```java
EnumMap<Status, Handler> handlers =
    new EnumMap<>(Status.class);
```

Best for empty maps.

## 13.2 Copy EnumMap

```java
EnumMap<Status, Handler> copy = new EnumMap<>(handlers);
```

## 13.3 Copy Map

```java
EnumMap<Status, Handler> copy = new EnumMap<>(someMap);
```

If map is not EnumMap, it must contain at least one mapping so key type can be determined.

## 13.4 Empty map copy problem

```java
new EnumMap<>(emptyHashMap)
```

cannot infer enum key type.

Use:

```java
new EnumMap<>(Status.class)
```

## 13.5 Rule

Prefer explicit `EnumMap(MyEnum.class)` when creating maps from scratch.

---

# 14. EnumSet vs HashSet

## 14.1 HashSet<Enum>

Works, but uses hash-table structure.

## 14.2 EnumSet

Enum-specific, compact, fast.

## 14.3 Differences

| Aspect | HashSet<Enum> | EnumSet |
|---|---|---|
| representation | hash table | bit vector |
| null element | may allow one null | rejects null |
| order | no guarantee | enum declaration order |
| memory | more overhead | compact |
| type restriction | any element type | enum only |
| bulk ops | generic | bit operations |
| best use | general set | enum flags/state sets |

## 14.4 Rule

Use EnumSet for enum sets unless you specifically need behavior EnumSet does not provide.

---

# 15. EnumMap vs HashMap

## 15.1 HashMap<Enum,V>

Works, but generic hash table.

## 15.2 EnumMap

Enum-key optimized map.

## 15.3 Differences

| Aspect | HashMap<Enum,V> | EnumMap |
|---|---|---|
| representation | hash table nodes/buckets | ordinal-indexed array |
| null key | HashMap allows one | rejects null |
| null value | allows | allows |
| order | no guarantee | enum declaration order |
| memory | more overhead | compact |
| lookup | hash/equality | ordinal index |
| key type | any | single enum type |
| best use | general map | enum-key map |

## 15.4 Rule

Use EnumMap when all keys are from one enum type.

---

# 16. EnumSet as Flags

EnumSet is often better than integer bit flags.

## 16.1 Bad old style

```java
static final int READ = 1;
static final int WRITE = 2;
static final int DELETE = 4;

int permissions = READ | WRITE;
```

Problems:

- not type-safe;
- unreadable;
- can mix unrelated flags.

## 16.2 Better

```java
enum Permission {
    READ,
    WRITE,
    DELETE
}

EnumSet<Permission> permissions =
    EnumSet.of(Permission.READ, Permission.WRITE);
```

## 16.3 Operations

```java
permissions.contains(Permission.READ)
permissions.add(Permission.DELETE)
permissions.remove(Permission.WRITE)
```

## 16.4 All permissions

```java
EnumSet.allOf(Permission.class)
```

## 16.5 No permissions

```java
EnumSet.noneOf(Permission.class)
```

## 16.6 Rule

EnumSet is type-safe bit flags.

---

# 17. EnumSet as State Capability Set

EnumSet is excellent for allowed transitions/capabilities.

## 17.1 Example

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED,
    CLOSED
}
```

Allowed terminal statuses:

```java
static final EnumSet<CaseStatus> TERMINAL =
    EnumSet.of(CaseStatus.REJECTED, CaseStatus.CLOSED);
```

## 17.2 Status group

```java
static final EnumSet<CaseStatus> EDITABLE =
    EnumSet.of(CaseStatus.DRAFT, CaseStatus.REJECTED);
```

## 17.3 Check

```java
if (TERMINAL.contains(status)) {
    ...
}
```

## 17.4 Defensive copy

Static final EnumSet is still mutable!

Bad:

```java
public static final EnumSet<CaseStatus> TERMINAL = EnumSet.of(...);
```

External code can mutate if public.

Better:

```java
private static final Set<CaseStatus> TERMINAL =
    Collections.unmodifiableSet(EnumSet.of(...));
```

or expose method:

```java
static boolean isTerminal(CaseStatus status) {
    return TERMINAL.contains(status);
}
```

## 17.5 Rule

EnumSet is mutable; do not expose mutable static constants.

---

# 18. EnumMap as Strategy Table

EnumMap can map enum to strategy.

## 18.1 Example

```java
enum NotificationChannel {
    EMAIL,
    SMS,
    PUSH
}

EnumMap<NotificationChannel, NotificationSender> senders =
    new EnumMap<>(NotificationChannel.class);

senders.put(NotificationChannel.EMAIL, emailSender);
senders.put(NotificationChannel.SMS, smsSender);
senders.put(NotificationChannel.PUSH, pushSender);
```

## 18.2 Dispatch

```java
NotificationSender sender = senders.get(channel);
if (sender == null) {
    throw new IllegalStateException("No sender for " + channel);
}
sender.send(message);
```

## 18.3 Completeness validation

```java
if (!senders.keySet().containsAll(EnumSet.allOf(NotificationChannel.class))) {
    throw new IllegalStateException("Missing sender");
}
```

## 18.4 Better for required complete table

Build and validate at startup.

## 18.5 Rule

EnumMap is excellent for enum-based dispatch tables.

---

# 19. EnumMap as Transition Table

State machines often map state to allowed transitions.

## 19.1 Example

```java
enum Status {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED,
    CLOSED
}
```

```java
EnumMap<Status, EnumSet<Status>> transitions =
    new EnumMap<>(Status.class);

transitions.put(Status.DRAFT, EnumSet.of(Status.SUBMITTED));
transitions.put(Status.SUBMITTED, EnumSet.of(Status.APPROVED, Status.REJECTED));
transitions.put(Status.APPROVED, EnumSet.of(Status.CLOSED));
transitions.put(Status.REJECTED, EnumSet.noneOf(Status.class));
transitions.put(Status.CLOSED, EnumSet.noneOf(Status.class));
```

## 19.2 Check transition

```java
boolean canTransition(Status from, Status to) {
    return transitions.getOrDefault(from, EnumSet.noneOf(Status.class))
        .contains(to);
}
```

## 19.3 Defensive immutability

Store unmodifiable sets or copy before returning.

## 19.4 Completeness test

Every enum status should have mapping.

## 19.5 Rule

EnumMap + EnumSet is a compact readable state transition model.

---

# 20. EnumMap as Configuration Matrix

EnumMap can model configuration by dimension.

## 20.1 Single dimension

```java
EnumMap<Environment, UrlConfig> configByEnv;
```

## 20.2 Nested enum map

```java
EnumMap<Environment, EnumMap<Region, Endpoint>> endpoints;
```

## 20.3 Alternative composite key

```java
record EnvRegion(Environment env, Region region) {}
Map<EnvRegion, Endpoint>
```

## 20.4 Use nested EnumMap when dimensions are small enum universes

It is compact and type-safe.

## 20.5 Rule

EnumMap is useful for dense enum-indexed matrices.

---

# 21. Complement, Range, and Bulk Operations

EnumSet provides high-level bulk operations.

## 21.1 Complement

```java
EnumSet<Permission> denied =
    EnumSet.complementOf(allowed);
```

## 21.2 Range

```java
EnumSet<Priority> highEnough =
    EnumSet.range(Priority.MEDIUM, Priority.CRITICAL);
```

## 21.3 Bulk mutating operations

```java
set.addAll(other)
set.retainAll(other)
set.removeAll(other)
```

These can be efficient bit operations when both are EnumSet of same type.

## 21.4 Caution with range

Range follows declaration order, not numeric severity unless declaration order matches severity.

## 21.5 Rule

EnumSet bulk operations are expressive and efficient, but depend on enum declaration order.

---

# 22. Iteration Behavior

## 22.1 EnumSet

Iterates in enum declaration order.

## 22.2 EnumMap

Views iterate keys in enum declaration order.

## 22.3 Not insertion order

```java
set.add(HIGH);
set.add(LOW);
```

iteration:

```text
LOW, HIGH
```

if declared LOW before HIGH.

## 22.4 Use case

Stable output without sorting.

## 22.5 Rule

Enum collection iteration order is predictable if enum declaration order is stable.

---

# 23. Equality, Hashing, and Ordering

## 23.1 Enum equality

Enum constants are singleton instances.

Usually compare with:

```java
status == Status.CLOSED
```

## 23.2 Enum hashCode

Identity-based/stable.

## 23.3 Enum compareTo

Natural order is ordinal/declaration order.

## 23.4 EnumSet equality

As Set, equality is based on set contents, not representation.

## 23.5 EnumMap equality

As Map, equality is based on mappings.

## 23.6 Rule

Enum equality is simple and stable; enum declaration order is the ordering dimension.

---

# 24. Mutability and Defensive Copying

EnumSet and EnumMap are mutable.

## 24.1 Defensive copy input

```java
record PermissionSet(EnumSet<Permission> values) {
    PermissionSet {
        values = values.clone();
    }
}
```

But returning EnumSet directly still exposes mutability.

## 24.2 Prefer Set in public API

```java
record PermissionSet(Set<Permission> values) {
    PermissionSet {
        values = Collections.unmodifiableSet(EnumSet.copyOf(values));
    }
}
```

Problem: if input can be empty general Set, `EnumSet.copyOf(values)` cannot infer type.

Use explicit helper.

## 24.3 Helper

```java
static Set<Permission> immutablePermissionSet(Collection<Permission> values) {
    EnumSet<Permission> copy = values.isEmpty()
        ? EnumSet.noneOf(Permission.class)
        : EnumSet.copyOf(values);
    return Collections.unmodifiableSet(copy);
}
```

## 24.4 Defensive return

```java
return EnumSet.copyOf(internalSet);
```

or unmodifiable snapshot.

## 24.5 Rule

Do not expose mutable EnumSet/EnumMap from domain objects.

---

# 25. Concurrency

EnumSet and EnumMap are not synchronized.

## 25.1 Concurrent mutation unsafe

Use external synchronization if multiple threads mutate.

## 25.2 Immutable snapshot

For read-mostly:

```java
private volatile Set<Permission> permissions = Set.of();

void reload(Collection<Permission> newPermissions) {
    EnumSet<Permission> copy = newPermissions.isEmpty()
        ? EnumSet.noneOf(Permission.class)
        : EnumSet.copyOf(newPermissions);
    permissions = Collections.unmodifiableSet(copy);
}
```

## 25.3 Concurrent map alternative?

There is no ConcurrentEnumMap in JDK.

If concurrent update needed:

- synchronize;
- use volatile immutable snapshot;
- use `AtomicReference<EnumMap<...>>`;
- use `ConcurrentHashMap<Enum,V>` if needed, but lose EnumMap compactness.

## 25.4 Rule

For enum config/state tables, immutable snapshots are often best concurrency pattern.

---

# 26. Serialization and Persistence Boundaries

## 26.1 EnumSet serialization

Enum constants serialize by name semantics through enum serialization mechanisms.

## 26.2 EnumMap serialization

Keys are enum constants.

## 26.3 Persistence caution

Do not persist ordinal unless you fully control evolution.

## 26.4 Rename caution

Persisting enum name is safer than ordinal but rename breaks compatibility unless mapped.

## 26.5 Rule

Enum collection in memory is fine; persistence representation needs explicit evolution strategy.

---

# 27. API/JSON/Event Boundaries

## 27.1 JSON representation

Enum sets usually become arrays of strings:

```json
["VIEW_CASE", "EDIT_CASE"]
```

## 27.2 Stable API values

Do not expose Java enum names blindly if names may change.

Consider explicit code:

```java
enum Permission {
    VIEW_CASE("view_case");
}
```

## 27.3 Order

If JSON array order matters, remember EnumSet order is declaration order.

## 27.4 Unknown values

APIs must decide how to handle unknown enum values for forward compatibility.

## 27.5 Rule

Enum collection API contract should define values, order, unknown handling, and evolution.

---

# 28. Database Mapping

## 28.1 EnumSet as join table

For user permissions:

```text
user_permission(user_id, permission_code)
```

Good normalized representation.

## 28.2 EnumSet as bit mask column

Compact but dangerous if based on ordinal.

If based on explicit stable bit codes, more manageable but still less transparent.

## 28.3 EnumMap as rows

```text
status_config(status, config_value)
```

## 28.4 Avoid ordinal

Ordinal changes when enum order changes.

## 28.5 Prefer explicit codes

```java
enum Permission {
    VIEW_CASE("VIEW_CASE");
}
```

## 28.6 Rule

Do not let enum ordinal leak into durable storage.

---

# 29. Enum Evolution Risks

Enums evolve.

## 29.1 Adding constant

Could affect:

- `EnumSet.allOf`;
- `complementOf`;
- exhaustive switch;
- completeness of EnumMap tables;
- API outputs;
- database validation;
- permissions.

## 29.2 Reordering constant

Affects:

- enum natural order;
- `range`;
- iteration order;
- ordinal-based persistence;
- priority semantics if tied to declaration order.

## 29.3 Removing constant

Breaks deserialization, DB values, API clients.

## 29.4 Renaming constant

Breaks name-based serialization/persistence unless mapped.

## 29.5 Rule

Treat enum changes as schema changes.

---

# 30. Anti-Patterns

## 30.1 Public mutable static EnumSet

```java
public static final EnumSet<Permission> ADMIN =
    EnumSet.allOf(Permission.class);
```

Callers can mutate ADMIN.

Fix:

```java
private static final Set<Permission> ADMIN =
    Collections.unmodifiableSet(EnumSet.allOf(Permission.class));
```

## 30.2 Using HashSet for enum flags by default

Use EnumSet.

## 30.3 Persisting ordinal

Dangerous.

## 30.4 Using range for business severity without stable declaration order

Dangerous.

## 30.5 Null values in EnumMap

Ambiguous.

## 30.6 Missing EnumMap entries

Strategy table fails at runtime.

## 30.7 Mutable EnumSet inside record without copy

Aliasing bug.

## 30.8 Returning internal EnumMap

Caller mutates domain/config state.

## 30.9 Rule

Enum collections are efficient, but still mutable and evolution-sensitive.

---

# 31. Performance Cost Model

## 31.1 EnumSet

Very compact.

Operations often bit operations.

Excellent for:

- membership check;
- union/intersection;
- small flag sets;
- permission groups.

## 31.2 EnumMap

Array lookup by ordinal.

Excellent for:

- dense enum-key mappings;
- strategy tables;
- config by enum.

## 31.3 HashSet/HashMap overhead avoided

No hash buckets/nodes for enum universe.

## 31.4 Large enum

Still efficient, but if enum has hundreds/thousands constants, think carefully about design.

## 31.5 Rule

EnumSet/EnumMap are among the most efficient general-purpose JDK collections for enum data.

---

# 32. Testing Enum Collections

## 32.1 Completeness

For EnumMap strategy table:

```java
assertEquals(
    EnumSet.allOf(Channel.class),
    EnumSet.copyOf(senders.keySet())
);
```

Need handle empty carefully.

## 32.2 No extra/missing permissions

Test role permission sets.

## 32.3 Evolution tests

When enum constant added, test should fail if config missing.

## 32.4 Order tests

If API output order depends on enum order, test explicitly.

## 32.5 Null tests

Verify null rejected.

## 32.6 Defensive copy tests

Mutate input collection after constructor; domain object should not change.

## 32.7 Rule

Enum collections should have tests that fail when enum universe changes unexpectedly.

---

# 33. Production Failure Modes

## 33.1 Public static EnumSet mutated

Fix: unmodifiable wrapper/snapshot/private helper.

## 33.2 EnumMap missing handler for new enum

Fix: completeness test at startup and unit test.

## 33.3 EnumSet.allOf grants new permission automatically

Adding enum constant accidentally expands admin role.

Fix: explicit sets for security-sensitive roles.

## 33.4 complementOf changes after enum added

New constant appears in complement unexpectedly.

Fix: avoid complement for security policy unless intended.

## 33.5 Persisted ordinal breaks after reorder

Fix: store explicit code/name.

## 33.6 JSON output order changes after enum reorder

Fix: define API order explicitly or do not rely on enum declaration order.

## 33.7 EnumMap null value ambiguity

Fix: avoid null values or use containsKey.

## 33.8 Empty collection copy issue

`EnumSet.copyOf(emptyCollection)` cannot infer enum type.

Fix: `EnumSet.noneOf(MyEnum.class)`.

## 33.9 Raw EnumSet mixed types

Fix: no raw types.

## 33.10 Mutable EnumSet in record

Fix: defensive copy and unmodifiable exposure.

## 33.11 Range misuse

`EnumSet.range(LOW, HIGH)` depends on declaration order.

Fix: explicit set if semantic range not exactly declaration order.

## 33.12 Concurrent mutation

Fix: immutable snapshot or synchronization.

---

# 34. Best Practices

## 34.1 Use

- `EnumSet` for enum sets/flags.
- `EnumMap` for enum-key maps.
- `EnumSet.noneOf` for empty enum set.
- `EnumSet.allOf` only when truly all current/future constants are desired.
- `EnumMap(MyEnum.class)` for empty map.
- explicit completeness validation for EnumMap strategy tables.

## 34.2 Avoid

- public mutable EnumSet/EnumMap;
- persisting ordinal;
- relying casually on enum declaration order as external API;
- null values in EnumMap;
- raw enum collections;
- complementOf for security-sensitive allow lists unless carefully reviewed.

## 34.3 Boundary

- expose `Set<Enum>` or `Map<Enum,V>` interfaces;
- return unmodifiable snapshots;
- validate unknown API enum values;
- define evolution policy.

## 34.4 Security

- prefer explicit allow lists;
- avoid allOf/complementOf for permissions unless intended;
- tests should fail when new permission enum added.

---

# 35. Decision Matrix

| Requirement | Recommended |
|---|---|
| set of enum flags | `EnumSet` |
| map from enum to value | `EnumMap` |
| empty enum set | `EnumSet.noneOf(MyEnum.class)` |
| all enum values | `EnumSet.allOf(MyEnum.class)` |
| enum range by declaration order | `EnumSet.range(from, to)` |
| complement set | `EnumSet.complementOf(set)` |
| mutable enum map | `new EnumMap<>(MyEnum.class)` |
| immutable enum set boundary | copy to EnumSet + unmodifiable wrapper |
| complete strategy table | `EnumMap` + completeness validation |
| security role permissions | explicit `EnumSet.of(...)`, not casual `allOf` |
| durable storage | explicit enum code/name, not ordinal |
| JSON event values | stable external codes |
| concurrent read-mostly config | volatile immutable EnumMap/EnumSet snapshot |
| concurrent mutation | synchronization or different design |
| insertion order needed | enum declaration order may not match; use List if needed |
| arbitrary key type | HashMap |
| arbitrary set element type | HashSet |

---

# 36. Latihan

## Latihan 1 — HashSet to EnumSet

Refactor:

```java
Set<Permission> permissions = new HashSet<>();
```

to EnumSet. Compare code and behavior.

## Latihan 2 — EnumMap Strategy Table

Implement:

```java
EnumMap<NotificationChannel, NotificationSender>
```

with completeness validation.

## Latihan 3 — State Transition Table

Implement:

```java
EnumMap<Status, EnumSet<Status>>
```

and method:

```java
boolean canTransition(Status from, Status to)
```

## Latihan 4 — Public Static Mutability

Show how public static final EnumSet can be mutated.

Fix it.

## Latihan 5 — Empty Copy Problem

Try:

```java
EnumSet.copyOf(List.of())
```

Explain failure and fix with `noneOf`.

## Latihan 6 — Enum Evolution

Add new enum constant `SUPER_ADMIN_PERMISSION`.

Which tests should fail?

## Latihan 7 — Persistence Design

Design DB schema for storing EnumSet<Permission> without ordinal.

## Latihan 8 — API Codes

Implement enum with stable external code and parser.

## Latihan 9 — Complement Security Review

Use `EnumSet.complementOf` for denied permissions.

Explain why adding a new permission can change security behavior.

## Latihan 10 — EnumMap Null Values

Create EnumMap with present-null value. Show `get` ambiguity and fix.

---

# 37. Ringkasan

Enum collections are specialized, compact, and expressive.

Core lessons:

- EnumSet is specialized Set for enum elements.
- EnumMap is specialized Map for enum keys.
- EnumSet is conceptually type-safe bit vector.
- EnumMap is conceptually ordinal-indexed array.
- Enum collections require one enum universe.
- Empty EnumSet/EnumMap often need explicit enum class.
- Iteration follows enum declaration order.
- EnumSet rejects null elements.
- EnumMap rejects null keys but allows null values.
- EnumSet/EnumMap are mutable and not synchronized.
- Use defensive copies/unmodifiable wrappers at boundaries.
- EnumSet is ideal for flags, permissions, status groups.
- EnumMap is ideal for strategy tables, transition tables, config matrices.
- Avoid public mutable static EnumSet.
- Avoid persisting enum ordinal.
- Adding/reordering enum constants can change behavior.
- Security-sensitive enum sets should be explicit and tested.

Main rule:

```text
If the element or key type is enum,
EnumSet and EnumMap should be your first thought,
but enum evolution and mutability must be reviewed like schema changes.
```

---

# 38. Referensi

1. Java SE 25 — `EnumSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumSet.html

2. Java SE 25 — `EnumMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumMap.html

3. Java SE 25 — `Enum`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Enum.html

4. OpenJDK — `EnumSet.java` Source  
   https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/EnumSet.java

5. OpenJDK — `RegularEnumSet.java` Source  
   https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/RegularEnumSet.java

6. OpenJDK — `JumboEnumSet.java` Source  
   https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/JumboEnumSet.java

7. OpenJDK — `EnumMap.java` Source  
   https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/EnumMap.java

8. Java Language Specification — Enum Classes  
   https://docs.oracle.com/javase/specs/jls/se24/html/jls-8.html#jls-8.9

9. Java SE 25 — `Collections.unmodifiableSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#unmodifiableSet(java.util.Set)

10. Java SE 25 — `Set`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-017.md](./learn-java-collections-and-streams-part-017.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-019.md](./learn-java-collections-and-streams-part-019.md)

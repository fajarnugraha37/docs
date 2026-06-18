# learn-java-collections-and-streams-part-004.md

# Java Collections and Streams — Part 004  
# Maps Deep Dive: Key Semantics, Lookup, HashMap, LinkedHashMap, TreeMap, EnumMap, IdentityHashMap, WeakHashMap, SequencedMap, Cache, Index, dan Production Pitfalls

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **004**  
> Fokus: memahami `Map` sebagai **key-value association** dan **lookup/indexing abstraction**, bukan sekadar “dictionary”. Kita akan membedah key semantics, equality/hash/comparator, `HashMap`, `LinkedHashMap`, `TreeMap`, `EnumMap`, `IdentityHashMap`, `WeakHashMap`, `SequencedMap`, null ambiguity, `compute/merge`, cache/index patterns, concurrency preview, API/DB/JSON boundary, performance, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Map adalah Association, Index, dan Lookup Contract](#2-mental-model-map-adalah-association-index-dan-lookup-contract)
3. [`Map` Contract](#3-map-contract)
4. [Kapan `Map` Tepat](#4-kapan-map-tepat)
5. [Kapan `Map` adalah Smell](#5-kapan-map-adalah-smell)
6. [Key Semantics: The Heart of Map Correctness](#6-key-semantics-the-heart-of-map-correctness)
7. [Value Semantics](#7-value-semantics)
8. [`Map.get` Ambiguity: Missing vs Present Null](#8-mapget-ambiguity-missing-vs-present-null)
9. [Map Views: `keySet`, `values`, `entrySet`](#9-map-views-keyset-values-entryset)
10. [`HashMap` Mental Model](#10-hashmap-mental-model)
11. [`HashMap` Capacity, Load Factor, Resize, and Iteration](#11-hashmap-capacity-load-factor-resize-and-iteration)
12. [Hash Collision and Tree Bins](#12-hash-collision-and-tree-bins)
13. [`LinkedHashMap` Mental Model](#13-linkedhashmap-mental-model)
14. [`SequencedMap` and Encounter Order](#14-sequencedmap-and-encounter-order)
15. [`TreeMap` Mental Model](#15-treemap-mental-model)
16. [`SortedMap` and `NavigableMap`](#16-sortedmap-and-navigablemap)
17. [`EnumMap` Mental Model](#17-enummap-mental-model)
18. [`IdentityHashMap` Mental Model](#18-identityhashmap-mental-model)
19. [`WeakHashMap` Mental Model](#19-weakhashmap-mental-model)
20. [Map Operations: `put`, `putIfAbsent`, `compute`, `merge`](#20-map-operations-put-putifabsent-compute-merge)
21. [Frequency Counter Pattern](#21-frequency-counter-pattern)
22. [Grouping and Indexing Pattern](#22-grouping-and-indexing-pattern)
23. [Composite Key Pattern](#23-composite-key-pattern)
24. [Nested Map vs Composite Key](#24-nested-map-vs-composite-key)
25. [Map as Cache](#25-map-as-cache)
26. [Map as Domain Smell: `Map<String,Object>`](#26-map-as-domain-smell-mapstringobject)
27. [Maps and Streams](#27-maps-and-streams)
28. [Maps in API/JSON Contracts](#28-maps-in-apijson-contracts)
29. [Maps in Database Mapping](#29-maps-in-database-mapping)
30. [Maps and Concurrency Preview](#30-maps-and-concurrency-preview)
31. [Performance and Memory Cost Model](#31-performance-and-memory-cost-model)
32. [Production Failure Modes](#32-production-failure-modes)
33. [Best Practices](#33-best-practices)
34. [Decision Matrix](#34-decision-matrix)
35. [Latihan](#35-latihan)
36. [Ringkasan](#36-ringkasan)
37. [Referensi](#37-referensi)

---

# 1. Tujuan Bagian Ini

`Map` adalah salah satu struktur data paling penting di Java.

Banyak problem production sebenarnya adalah problem:

```text
key design
lookup strategy
cache key
duplicate key
mutable key
wrong equality
null ambiguity
ordering assumption
unbounded growth
```

Contoh:

```java
Map<String, Object> payload;
Map<CaseId, CaseSummary> summaries;
Map<TenantId, Map<CaseId, CaseSummary>> summariesByTenant;
Map<String, List<Event>> eventsByType;
Map<Permission, Boolean> permissions;
Map<Instant, Rule> rulesByEffectiveTime;
```

Semua `Map`, tetapi meaning dan risikonya berbeda.

Tujuan bagian ini:

- memahami `Map` sebagai association/index;
- membedah key semantics;
- memahami `HashMap`, `LinkedHashMap`, `TreeMap`, `EnumMap`, `IdentityHashMap`, `WeakHashMap`;
- memahami ordered/sequenced map;
- memahami null ambiguity;
- memakai `compute`, `merge`, `putIfAbsent` dengan benar;
- membedakan map sebagai domain model vs map sebagai index;
- memahami API/DB/JSON/cache boundary;
- mengenali production failure modes.

---

# 2. Mental Model: Map adalah Association, Index, dan Lookup Contract

`Map<K,V>` berarti:

```text
Setiap key K dipetakan ke paling banyak satu value V.
Lookup by key adalah operasi utama.
Key uniqueness adalah invariant.
```

## 2.1 Association

```java
Map<CaseId, CaseSummary>
```

means:

```text
CaseId associated with CaseSummary.
```

## 2.2 Index

```java
Map<UserId, User> usersById
```

means:

```text
In-memory index for fast lookup by UserId.
```

## 2.3 Cache

```java
Map<CacheKey, CacheValue> cache
```

means:

```text
Computed/stored values keyed by request/context.
```

But cache needs eviction, size bound, TTL, concurrency, and invalidation. A raw HashMap is usually not enough.

## 2.4 Grouping result

```java
Map<CaseStatus, List<CaseSummary>> byStatus
```

means:

```text
Cases grouped by status.
```

## 2.5 Lookup contract

If your code often does:

```java
list.stream().filter(x -> x.id().equals(id)).findFirst()
```

you probably need:

```java
Map<Id, X>
```

## 2.6 Rule

```text
Use Map when key-based lookup is central to the problem.
```

---

# 3. `Map` Contract

Java SE docs define `Map` as an object that maps keys to values; a map cannot contain duplicate keys, and each key can map to at most one value.

## 3.1 Key uniqueness

```java
map.put(key, value1);
map.put(key, value2);
```

Second put replaces value for same key.

## 3.2 One key, one value

A map does not model:

```text
one key -> many values
```

unless value is collection:

```java
Map<K, List<V>>
Map<K, Set<V>>
```

## 3.3 Collection views

Map provides:

```java
keySet()
values()
entrySet()
```

## 3.4 Order

Map order is the order in which iterators on collection views return elements.

Some implementations guarantee order:

- `TreeMap`: sorted key order;
- `LinkedHashMap`: insertion/access order;
- `SequencedMap`: encounter order contract.

Some do not:

- `HashMap`.

## 3.5 Null policy

Depends on implementation.

`HashMap` permits null key and null values.

`ConcurrentHashMap` does not.

## 3.6 Optional operations

Like collections, maps may be unmodifiable or have optional operations unsupported.

## 3.7 Rule

Map interface gives association contract, but implementation defines order/null/concurrency/performance details.

---

# 4. Kapan `Map` Tepat

Use Map when:

## 4.1 Lookup by key dominates

```java
CaseSummary summary = summariesById.get(caseId);
```

## 4.2 Key uniqueness matters

```java
Map<EmailAddress, User> usersByEmail;
```

## 4.3 Need index

```java
Map<CaseId, Case> index = cases.stream()
    .collect(toMap(Case::id, Function.identity()));
```

## 4.4 Need grouping

```java
Map<CaseStatus, List<Case>> byStatus;
```

## 4.5 Need count/frequency

```java
Map<CaseStatus, Long> counts;
```

## 4.6 Need configuration/rule lookup

```java
Map<ViolationCode, PenaltyRule> rules;
```

## 4.7 Need cache

```java
Map<CacheKey, CachedValue>
```

but raw Map rarely sufficient for production cache.

## 4.8 Rule

If the main question is “given K, find V”, use Map.

---

# 5. Kapan `Map` adalah Smell

## 5.1 `Map<String,Object>` as domain

```java
Map<String, Object> caseData;
```

This hides schema.

Better:

```java
record CaseData(CaseId id, CaseStatus status, OfficerId assignedTo) {}
```

## 5.2 Key is not stable

```java
Map<User, Session> sessions;
```

where `User.equals/hashCode` uses mutable email.

Better:

```java
Map<UserId, Session>
```

## 5.3 Map used for ordered list

```java
Map<Integer, ApprovalStep> stepsByPosition;
```

If positions are continuous order, maybe:

```java
List<ApprovalStep>
```

## 5.4 Map used for one-to-many but value mutation unsafe

```java
Map<CaseId, List<Event>> eventsByCase;
```

Needs careful list ownership/concurrency.

## 5.5 Map as cache without eviction

```java
static final Map<Key, Value> CACHE = new HashMap<>();
```

Memory leak risk.

## 5.6 Map with String keys for known fields

```java
Map<String, String> user;
user.get("fristName");
```

Typo bug.

Use record/class.

## 5.7 Rule

Map is excellent for lookup. It is poor as substitute for schema/domain model.

---

# 6. Key Semantics: The Heart of Map Correctness

The key is the most important part of a Map.

## 6.1 Key must have stable identity/equality

For hash maps:

```java
equals
hashCode
```

must remain stable while key is in map.

## 6.2 Bad mutable key

```java
record MutableEmailKey(StringBuilder value) {}
```

or class whose hash fields mutate.

## 6.3 Good key

```java
record UserId(UUID value) {}
record TenantCaseRef(TenantId tenantId, CaseId caseId) {}
```

Immutable records with immutable components.

## 6.4 Composite key

```java
record TenantCaseKey(TenantId tenantId, CaseId caseId) {}
```

Good for multi-tenant map.

## 6.5 Array key problem

```java
Map<byte[], Value> map;
```

Array equality is identity-based.

Use wrapper:

```java
final class DigestKey {
    private final byte[] bytes;
    // clone + Arrays.equals/hashCode
}
```

## 6.6 BigDecimal key problem

Scale affects equals/hash.

If domain numeric equality ignores scale, canonicalize.

## 6.7 Rule

```text
Bad key design creates invisible Map bugs.
```

---

# 7. Value Semantics

Values are often overlooked.

## 7.1 Mutable value issue

```java
Map<UserId, List<Permission>> permissionsByUser;
```

If caller gets list and mutates it, map state changes.

## 7.2 Concurrent value issue

```java
ConcurrentHashMap<UserId, List<Permission>>
```

Map is concurrent. List is not.

## 7.3 Null value issue

If map permits null values, `get` becomes ambiguous.

## 7.4 Value object recommendation

Prefer immutable values:

```java
Map<UserId, PermissionSet>
Map<CaseId, CaseSnapshot>
```

## 7.5 Defensive copy

When putting collection values:

```java
map.put(userId, List.copyOf(permissions));
```

When returning:

```java
return Map.copyOf(map);
```

but note values themselves may still be mutable.

## 7.6 Rule

Map safety requires both key and value design.

---

# 8. `Map.get` Ambiguity: Missing vs Present Null

If map allows null values:

```java
V value = map.get(key);
```

`value == null` can mean:

1. key absent;
2. key present with null value.

## 8.1 Example

```java
Map<String, String> map = new HashMap<>();
map.put("a", null);

map.get("a"); // null
map.get("b"); // null
```

## 8.2 Use containsKey

```java
if (map.containsKey(key)) {
    V value = map.get(key);
}
```

## 8.3 Avoid null values

Often better:

```java
Map<K, Optional<V>>
```

Maybe, but can be awkward.

Or model absence by not storing key.

Or use domain value type.

## 8.4 ConcurrentHashMap design

ConcurrentHashMap disallows null key/value partly to avoid this ambiguity in concurrent contexts.

## 8.5 Rule

Avoid null values in maps unless you have explicit reason and tests.

---

# 9. Map Views: `keySet`, `values`, `entrySet`

Map exposes collection views.

## 9.1 keySet

```java
Set<K> keys = map.keySet();
```

Usually backed by map.

Removing from keySet removes mapping.

```java
keys.remove(key);
```

## 9.2 values

```java
Collection<V> values = map.values();
```

Values may contain duplicates.

Removing from values removes corresponding mapping.

## 9.3 entrySet

```java
Set<Map.Entry<K,V>> entries = map.entrySet();
```

Often best for iteration:

```java
for (Map.Entry<K,V> entry : map.entrySet()) {
    process(entry.getKey(), entry.getValue());
}
```

## 9.4 Entry mutation

Some entries support:

```java
entry.setValue(newValue)
```

depending implementation/view.

## 9.5 View exposure risk

Bad:

```java
Set<K> keys() {
    return internalMap.keySet();
}
```

Caller can mutate internal map.

Better:

```java
Set<K> keys() {
    return Set.copyOf(internalMap.keySet());
}
```

## 9.6 Rule

Map views are often live views. Copy before crossing boundary.

---

# 10. `HashMap` Mental Model

Java SE 25 `HashMap` is a hash table based implementation of Map, permits null values and null key, unsynchronized, and makes no guarantees about map order.

Mental model:

```text
HashMap = array of buckets + nodes/tree nodes
```

Each entry stores:

- key;
- value;
- hash;
- next link or tree structure.

## 10.1 Put

```java
map.put(key, value)
```

Steps conceptually:

1. compute key hash;
2. map hash to bucket index;
3. if empty, add node;
4. if matching key exists, replace value;
5. if collision, chain/tree logic;
6. resize if threshold exceeded.

## 10.2 Get

```java
map.get(key)
```

Steps:

1. compute hash;
2. find bucket;
3. compare candidate keys using equals;
4. return value if found.

## 10.3 Expected performance

Basic operations expected constant-time if hash function distributes keys well.

## 10.4 Null key

HashMap supports one null key.

## 10.5 Not thread-safe

Concurrent structural mutation unsafe.

## 10.6 Rule

HashMap is general-purpose map default when ordering/concurrency/special keys are not required.

---

# 11. `HashMap` Capacity, Load Factor, Resize, and Iteration

## 11.1 Capacity

Number of buckets in table.

## 11.2 Load factor

Controls when resize happens.

Default load factor is 0.75, generally a good time/space trade-off.

## 11.3 Threshold

Conceptually:

```text
threshold = capacity * loadFactor
```

When size exceeds threshold, map resizes.

## 11.4 Resize

Resize allocates new table and redistributes entries.

Cost can be visible in latency-sensitive paths.

## 11.5 Pre-sizing

If expected number of mappings known, initialize appropriately.

In newer JDKs, factory helpers may exist for expected mappings, but normal constructor still common:

```java
new HashMap<>(initialCapacity)
```

Be careful: constructor capacity is bucket capacity, not exact mapping count.

## 11.6 Iteration cost

HashMap iteration cost proportional to capacity plus size.

Over-sizing can make iteration slower and waste memory.

## 11.7 Rule

For large maps, capacity planning matters.

---

# 12. Hash Collision and Tree Bins

Hash collisions happen when different keys map to same bucket.

## 12.1 Collision handling

HashMap historically used linked lists in buckets.

Modern HashMap can treeify heavily-collided buckets under conditions.

## 12.2 Why still care?

Even with tree bins, bad hashCode harms performance.

## 12.3 Poor hash example

```java
@Override
public int hashCode() {
    return 1;
}
```

All keys collide.

## 12.4 Good key design

Use records or robust equals/hashCode.

```java
record TenantCaseKey(TenantId tenantId, CaseId caseId) {}
```

## 12.5 Security note

Hash collision attacks historically matter for user-controlled keys in hash tables. Modern implementations mitigate, but bounded input and good design still matter.

## 12.6 Rule

HashMap performance starts with key hash quality.

---

# 13. `LinkedHashMap` Mental Model

`LinkedHashMap` is a hash table and linked list implementation of Map with predictable iteration order.

## 13.1 Insertion order

Default LinkedHashMap maintains insertion order.

```java
Map<String, Integer> map = new LinkedHashMap<>();
map.put("B", 2);
map.put("A", 1);
map.put("C", 3);

// iteration: B, A, C
```

## 13.2 Re-insertion

Re-inserting existing key does not change insertion order in insertion-order mode.

## 13.3 Access order

LinkedHashMap can be constructed with access-order mode, useful for LRU-style behavior.

## 13.4 removeEldestEntry

Subclass can override:

```java
protected boolean removeEldestEntry(Map.Entry<K,V> eldest)
```

to implement simple bounded cache.

## 13.5 SequencedMap

In Java 21+, LinkedHashMap has SequencedMap operations.

## 13.6 Use cases

- deterministic output;
- preserve input order;
- simple LRU;
- ordered API response;
- stable tests.

## 13.7 Rule

Use LinkedHashMap when you need Map lookup plus predictable encounter order.

---

# 14. `SequencedMap` and Encounter Order

Java SE 25 `SequencedMap` provides methods to add mappings, retrieve mappings, and remove mappings at either end of the map's encounter order.

## 14.1 Meaning

```java
SequencedMap<K,V>
```

says:

```text
Entries have defined encounter order.
First/last mapping are meaningful.
Reverse view is meaningful.
```

## 14.2 Operations

Conceptually:

```java
firstEntry()
lastEntry()
pollFirstEntry()
pollLastEntry()
putFirst(K,V)
putLast(K,V)
reversed()
sequencedKeySet()
sequencedValues()
sequencedEntrySet()
```

## 14.3 Use cases

- event metadata in insertion order;
- LRU cache introspection;
- deterministic ordered maps;
- first/last rule;
- API order guarantee.

## 14.4 Equality caveat

Map equality ignores order.

Two maps with same mappings are equal even if encounter order differs.

## 14.5 Rule

SequencedMap gives order-aware traversal operations, not order-sensitive equality.

---

# 15. `TreeMap` Mental Model

`TreeMap` is a red-black tree based implementation of NavigableMap.

## 15.1 Meaning

```java
TreeMap<K,V>
```

says:

```text
Map entries sorted by key.
Need ordered/range/navigation operations.
```

## 15.2 Key ordering

Keys ordered by:

- natural ordering;
- comparator supplied at construction.

## 15.3 Basic operation cost

`get`, `put`, `remove` are typically O(log n).

## 15.4 Use cases

- effective-dated rules;
- time-indexed events;
- price tiers;
- nearest version;
- range query;
- sorted output.

## 15.5 Example

```java
NavigableMap<Instant, Rule> rules = new TreeMap<>();
Rule active = rules.floorEntry(now).getValue();
```

## 15.6 Rule

Use TreeMap when key order/range matters more than raw lookup speed.

---

# 16. `SortedMap` and `NavigableMap`

## 16.1 SortedMap

Provides:

```java
firstKey()
lastKey()
headMap()
tailMap()
subMap()
comparator()
```

## 16.2 NavigableMap

Adds nearest-entry methods:

```java
lowerEntry()
floorEntry()
ceilingEntry()
higherEntry()
firstEntry()
lastEntry()
pollFirstEntry()
pollLastEntry()
descendingMap()
```

## 16.3 Range views

Range views are often backed by original map.

Mutating view can mutate original.

## 16.4 Inclusive/exclusive bounds

NavigableMap overloads let you control inclusive/exclusive.

## 16.5 Comparator defines key uniqueness

If comparator returns 0 for two different keys, map treats them as same key.

## 16.6 Rule

For sorted/range maps, comparator is part of identity.

---

# 17. `EnumMap` Mental Model

`EnumMap` is specialized Map for enum keys.

Oracle tutorials describe EnumMap as internally implemented as an array and high-performance for enum keys.

## 17.1 Meaning

```java
EnumMap<CaseStatus, Integer> countsByStatus
```

says:

```text
Key space is enum constants.
Fast compact mapping by enum.
```

## 17.2 Creation

```java
EnumMap<CaseStatus, Integer> counts = new EnumMap<>(CaseStatus.class);
```

## 17.3 Use cases

- counts by status;
- strategy by enum;
- transition table;
- permission metadata;
- enum display labels;
- rule lookup by enum.

## 17.4 Null key

EnumMap does not permit null keys.

May permit null values.

## 17.5 Iteration order

Natural order of enum constants.

## 17.6 Warning

EnumMap internal use of ordinal is fine. Persisting enum ordinal externally is still dangerous.

## 17.7 Rule

Use EnumMap whenever map keys are enum constants.

---

# 18. `IdentityHashMap` Mental Model

`IdentityHashMap` uses reference equality (`==`) instead of object equality (`equals`) for keys.

## 18.1 Meaning

```java
IdentityHashMap<K,V>
```

says:

```text
Object identity, not value equality, defines key uniqueness.
```

## 18.2 Use cases

Rare:

- object graph traversal;
- serialization algorithms;
- proxy/instrumentation;
- preserving object identity;
- cycle detection by reference.

## 18.3 Bad for normal domain

```java
IdentityHashMap<UserId, User>
```

is usually wrong because two equal UserId instances should be same key.

## 18.4 Example

```java
String a = new String("x");
String b = new String("x");

Map<String, Integer> normal = new HashMap<>();
normal.put(a, 1);
normal.put(b, 2);
normal.size(); // 1

Map<String, Integer> identity = new IdentityHashMap<>();
identity.put(a, 1);
identity.put(b, 2);
identity.size(); // 2
```

## 18.5 Rule

Use IdentityHashMap only when object identity is the domain of the algorithm.

---

# 19. `WeakHashMap` Mental Model

`WeakHashMap` stores keys weakly, allowing entries to be removed when keys are no longer strongly reachable elsewhere.

## 19.1 Meaning

```java
WeakHashMap<K,V>
```

says:

```text
Map entries should not keep keys alive.
```

## 19.2 Use cases

- metadata associated with objects without preventing GC;
- canonicalization-like auxiliary maps;
- listeners/metadata tied to object lifetime.

## 19.3 Not normal cache

WeakHashMap is not a general cache solution.

Why:

- entries disappear based on GC, not TTL/LRU/business policy;
- values can strongly reference keys indirectly, preventing cleanup;
- behavior can be surprising.

## 19.4 Classloader leak caution

Weak references can help some leaks, but do not magically fix bad reference graphs.

## 19.5 Rule

Use WeakHashMap only when GC-based key lifetime is intended.

---

# 20. Map Operations: `put`, `putIfAbsent`, `compute`, `merge`

## 20.1 `put`

```java
V old = map.put(key, value);
```

Replaces existing value.

## 20.2 `putIfAbsent`

```java
map.putIfAbsent(key, value);
```

Only sets if absent or mapped to null depending implementation/default semantics.

For concurrent maps, atomic semantics matter.

## 20.3 `computeIfAbsent`

```java
map.computeIfAbsent(key, k -> createValue(k));
```

Useful for lazy initialization.

Caution:

- mapping function should be side-effect controlled;
- for ConcurrentHashMap, mapping function may be called under concurrency constraints;
- avoid recursive update to same map.

## 20.4 `compute`

```java
map.compute(key, (k, old) -> newValue);
```

Can add, replace, or remove if returns null.

## 20.5 `merge`

```java
map.merge(key, 1, Integer::sum);
```

Great for counters/frequency.

## 20.6 Remove via compute

```java
map.compute(key, (k, old) -> old == null ? null : old.updated());
```

Returning null removes mapping.

## 20.7 Rule

Use map atomic/update methods to express update semantics, especially in concurrent contexts.

---

# 21. Frequency Counter Pattern

## 21.1 Simple

```java
Map<CaseStatus, Long> counts = new EnumMap<>(CaseStatus.class);

for (Case c : cases) {
    counts.merge(c.status(), 1L, Long::sum);
}
```

## 21.2 Stream

```java
Map<CaseStatus, Long> counts = cases.stream()
    .collect(Collectors.groupingBy(
        Case::status,
        () -> new EnumMap<>(CaseStatus.class),
        Collectors.counting()
    ));
```

## 21.3 Concurrent high-contention

For concurrent counting:

```java
ConcurrentHashMap<Key, LongAdder> counts = new ConcurrentHashMap<>();
counts.computeIfAbsent(key, k -> new LongAdder()).increment();
```

## 21.4 Domain wrapper

```java
record StatusCounts(Map<CaseStatus, Long> values) {}
```

## 21.5 Rule

For enum keys, prefer EnumMap for counts.

---

# 22. Grouping and Indexing Pattern

## 22.1 Index by unique key

```java
Map<CaseId, Case> byId = cases.stream()
    .collect(Collectors.toMap(Case::id, Function.identity()));
```

But duplicate key throws.

## 22.2 Duplicate policy

If duplicate is invalid, throwing is okay but error message may need domain context.

If duplicate should keep latest:

```java
Map<CaseId, Case> latest = cases.stream()
    .collect(Collectors.toMap(
        Case::id,
        Function.identity(),
        BinaryOperator.maxBy(Comparator.comparing(Case::updatedAt))
    ));
```

## 22.3 Group by non-unique key

```java
Map<OfficerId, List<Case>> byOfficer = cases.stream()
    .collect(Collectors.groupingBy(Case::assignedOfficer));
```

## 22.4 Grouping memory risk

Grouping builds all groups in memory.

For huge data, consider database aggregation, streaming aggregation, chunking, or external storage.

## 22.5 Rule

Indexing requires unique key policy. Grouping requires memory policy.

---

# 23. Composite Key Pattern

## 23.1 Multi-tenant key

```java
record TenantCaseKey(TenantId tenantId, CaseId caseId) {}
```

Use:

```java
Map<TenantCaseKey, CaseSummary> summaries;
```

## 23.2 Why not string concat?

Bad:

```java
String key = tenantId + ":" + caseId;
```

Problems:

- delimiter collision;
- inconsistent normalization;
- weaker type safety;
- parsing bugs.

## 23.3 Record key benefits

- immutable;
- generated equals/hashCode;
- clear semantics;
- no delimiter;
- compiler type checking.

## 23.4 Caution

Components must be immutable and have correct equality.

## 23.5 Rule

Use record composite key for multi-field Map keys.

---

# 24. Nested Map vs Composite Key

## 24.1 Nested map

```java
Map<TenantId, Map<CaseId, CaseSummary>> byTenantThenCase;
```

Pros:

- easy get all for tenant;
- natural hierarchy.

Cons:

- nested mutation complexity;
- missing inner map handling;
- harder atomic operations;
- more complex serialization.

## 24.2 Composite key map

```java
Map<TenantCaseKey, CaseSummary> byTenantCase;
```

Pros:

- single map;
- simple key;
- easy cache key model;
- fewer nested mutation issues.

Cons:

- getting all for tenant requires scan or secondary index.

## 24.3 Decision

Use nested map if tenant grouping access dominates.

Use composite key if direct lookup dominates.

Use both indexes if needed, but maintain consistency carefully.

## 24.4 Rule

Key shape should match dominant access pattern.

---

# 25. Map as Cache

A raw Map can be cache-like, but production cache needs more.

## 25.1 Raw cache

```java
Map<Key, Value> cache = new HashMap<>();
```

Missing:

- max size;
- eviction;
- TTL;
- concurrency;
- stats;
- invalidation;
- memory bounds;
- value freshness;
- negative caching policy.

## 25.2 Simple LRU with LinkedHashMap

```java
class LruCache<K,V> extends LinkedHashMap<K,V> {
    private final int maxEntries;

    LruCache(int maxEntries) {
        super(16, 0.75f, true);
        this.maxEntries = maxEntries;
    }

    @Override
    protected boolean removeEldestEntry(Map.Entry<K,V> eldest) {
        return size() > maxEntries;
    }
}
```

This is simple, not necessarily concurrent.

## 25.3 Cache key design

Bad:

```java
"case:" + caseId
```

in multi-tenant system.

Better:

```java
record CaseCacheKey(TenantId tenantId, CaseId caseId) {}
```

## 25.4 Cache value

Prefer immutable snapshot.

## 25.5 Rule

Map can implement small local cache, but cache policy must be explicit.

---

# 26. Map as Domain Smell: `Map<String,Object>`

## 26.1 Bad domain model

```java
Map<String, Object> caseData;
```

Problems:

- no schema;
- runtime casts;
- typos;
- no refactor support;
- invalid states;
- unclear nulls;
- hard validation;
- weak API/DB contract.

## 26.2 Better record

```java
record CaseData(
    CaseId caseId,
    CaseStatus status,
    OfficerId assignedTo,
    Instant updatedAt
) {}
```

## 26.3 When Map<String,Object> okay

- generic JSON boundary before parsing;
- logging structured unknown metadata;
- plugin system;
- truly dynamic attributes.

Even then, wrap:

```java
record DynamicAttributes(Map<AttributeKey, AttributeValue> values) {}
```

## 26.4 Rule

Map is not a replacement for domain type.

---

# 27. Maps and Streams

## 27.1 Iterating entries

```java
map.entrySet().stream()
    .filter(e -> e.getValue().isActive())
    .map(Map.Entry::getKey)
    .toList();
```

## 27.2 Collecting to map

```java
Map<CaseId, CaseSummary> byId = summaries.stream()
    .collect(Collectors.toMap(CaseSummary::caseId, Function.identity()));
```

## 27.3 Duplicate key

`toMap` without merge function throws on duplicate key.

## 27.4 Merge function

```java
Map<CaseId, CaseSummary> latest = summaries.stream()
    .collect(Collectors.toMap(
        CaseSummary::caseId,
        Function.identity(),
        BinaryOperator.maxBy(Comparator.comparing(CaseSummary::updatedAt))
    ));
```

## 27.5 Preserve order

```java
Map<CaseId, CaseSummary> ordered = summaries.stream()
    .collect(Collectors.toMap(
        CaseSummary::caseId,
        Function.identity(),
        (a, b) -> a,
        LinkedHashMap::new
    ));
```

## 27.6 Grouping

```java
Map<CaseStatus, List<CaseSummary>> byStatus = summaries.stream()
    .collect(Collectors.groupingBy(CaseSummary::status));
```

## 27.7 Rule

When collecting to Map, always decide duplicate key and map implementation policy.

---

# 28. Maps in API/JSON Contracts

JSON object keys are strings.

## 28.1 Map with String keys

```java
Map<String, String>
```

maps naturally to JSON object.

## 28.2 Map with typed keys

```java
Map<CaseId, CaseSummary>
```

serializes awkwardly because keys become strings.

Potential JSON:

```json
{
  "CASE-00000001": { ... }
}
```

## 28.3 Alternative array of entries

```json
[
  {
    "caseId": "CASE-00000001",
    "summary": { ... }
  }
]
```

Benefits:

- key schema explicit;
- order explicit;
- easier OpenAPI;
- easier for clients.

## 28.4 Order

JSON object order should not be relied upon as semantic contract, even if many parsers preserve it.

Use array if order matters.

## 28.5 Rule

Public APIs should avoid complex Map keys unless client contract is clear.

---

# 29. Maps in Database Mapping

## 29.1 Key-value table

```sql
case_attribute (
    case_id VARCHAR NOT NULL,
    attr_key VARCHAR NOT NULL,
    attr_value VARCHAR NOT NULL,
    PRIMARY KEY (case_id, attr_key)
)
```

## 29.2 Map as child table

`Map<K,V>` naturally maps to table with key column and value column.

## 29.3 JSON column

Can store map as JSON object, but:

- harder constraints;
- harder indexing;
- schema drift;
- validation burden.

## 29.4 Reference data map

A map in Java may correspond to DB reference table.

## 29.5 Unique constraint

Map key uniqueness should be enforced by primary key/unique constraint.

## 29.6 Rule

If Map is durable, DB must enforce key uniqueness and value constraints.

---

# 30. Maps and Concurrency Preview

## 30.1 HashMap not thread-safe

Concurrent mutation can corrupt behavior.

## 30.2 ConcurrentHashMap

Use for concurrent access/update.

```java
ConcurrentMap<K,V> map = new ConcurrentHashMap<>();
```

## 30.3 Atomic operations

```java
putIfAbsent
computeIfAbsent
compute
merge
```

important under concurrency.

## 30.4 Mutable values still unsafe

```java
ConcurrentHashMap<K, List<V>> map;
map.get(k).add(v); // unsafe if list not thread-safe
```

## 30.5 Immutable value strategy

```java
map.compute(key, (k, old) -> {
    List<V> copy = old == null ? new ArrayList<>() : new ArrayList<>(old);
    copy.add(value);
    return List.copyOf(copy);
});
```

## 30.6 Rule

Concurrent map protects map structure, not mutable value internals.

---

# 31. Performance and Memory Cost Model

## 31.1 HashMap

Good:

- expected O(1) get/put;
- general-purpose.

Costs:

- table;
- node objects;
- key/value references;
- hash computation;
- resizing;
- memory overhead.

## 31.2 LinkedHashMap

Adds linked list overhead, predictable order.

## 31.3 TreeMap

O(log n), sorted/range operations.

## 31.4 EnumMap

Very compact/fast for enum keys.

## 31.5 IdentityHashMap

Specialized identity equality; not normal map.

## 31.6 WeakHashMap

GC-sensitive behavior; not predictable cache.

## 31.7 Large maps

Ask:

```text
How many entries?
How large are keys and values?
Are keys duplicated elsewhere?
Is key string heavy?
Is map long-lived?
Does it need eviction?
```

## 31.8 Primitive key maps

`Map<Integer,V>` boxes keys.

For huge maps, primitive specialized collections may be needed.

## 31.9 Rule

Map performance is dominated by key design, operation pattern, memory, and resize behavior.

---

# 32. Production Failure Modes

## 32.1 Mutable key breaks lookup

Key hash changes after insertion.

Fix: immutable key.

## 32.2 Missing vs null ambiguity

`get` returns null for both absent and present-null.

Fix: avoid null values or use containsKey.

## 32.3 HashMap order relied upon

Output order changes.

Fix: LinkedHashMap/TreeMap/array response.

## 32.4 Duplicate key in toMap

Stream collect fails.

Fix: define merge policy.

## 32.5 Map cache grows forever

Memory leak/OOM.

Fix: bounded cache/eviction/TTL.

## 32.6 Tenant missing from cache key

Cross-tenant data leak.

Fix: composite key includes tenant.

## 32.7 ConcurrentHashMap value race

Mutable value corrupted.

Fix: immutable values/atomic compute/concurrent value.

## 32.8 WeakHashMap entry disappears unexpectedly

GC removes key.

Fix: use normal cache if lifetime policy not GC-based.

## 32.9 IdentityHashMap used accidentally

Equal keys treated different.

Fix: use HashMap.

## 32.10 TreeMap comparator collision

Comparator treats distinct keys as same.

Fix: comparator matches key identity.

## 32.11 JSON map with typed key unclear

Client cannot validate key schema.

Fix: array of entries or documented pattern.

## 32.12 `Map<String,Object>` runtime ClassCastException

Fix: typed DTO/domain model.

---

# 33. Best Practices

## 33.1 Key design

- Use immutable keys.
- Use typed IDs/composite record keys.
- Avoid arrays as keys unless wrapped.
- Canonicalize string-like keys.
- Be careful with BigDecimal scale.
- Ensure comparator consistency for sorted maps.

## 33.2 Value design

- Prefer immutable values.
- Avoid null values.
- Defensive copy collection values.
- For concurrent map, ensure values are thread-safe/immutable.

## 33.3 Implementation choice

- HashMap for general lookup.
- LinkedHashMap for deterministic order/LRU-like.
- TreeMap for sorted/range.
- EnumMap for enum keys.
- IdentityHashMap only for reference identity algorithms.
- WeakHashMap only for GC-lifetime associations.
- ConcurrentHashMap for concurrent access.

## 33.4 API/boundary

- Do not expose mutable internal maps/views.
- Avoid Map with complex keys in public JSON.
- Define duplicate key policy.
- Define ordering if output deterministic.
- Mirror key uniqueness in DB.

## 33.5 Streams

- Always handle duplicate key in `toMap` intentionally.
- Choose map supplier if order/type matters.
- Beware grouping huge data.

---

# 34. Decision Matrix

| Requirement | Recommended |
|---|---|
| general key lookup | `HashMap` |
| deterministic insertion order | `LinkedHashMap` |
| access-order/LRU simple cache | `LinkedHashMap` access-order + `removeEldestEntry` |
| sorted key lookup | `TreeMap` |
| nearest/range query by key | `NavigableMap` / `TreeMap` |
| enum keys | `EnumMap` |
| object identity keys | `IdentityHashMap` |
| weak key lifecycle | `WeakHashMap` |
| concurrent map | `ConcurrentHashMap` |
| multi-tenant key | composite record key |
| one key to many values | `Map<K, List<V>>` / `Map<K, Set<V>>` / multimap abstraction |
| count/frequency | `Map<K, Long>` or `Map<K, LongAdder>` |
| public JSON with typed key | array of entries |
| domain schema | record/class, not `Map<String,Object>` |
| immutable snapshot | `Map.copyOf` plus immutable values |
| duplicate key invalid | `toMap` without merge or explicit validation |
| duplicate key choose latest | `toMap` with merge function |

---

# 35. Latihan

## Latihan 1 — Key Design

Buat composite key:

```java
TenantId + CaseId
```

Bandingkan:

- string concat key;
- nested map;
- record key.

Jelaskan trade-off.

## Latihan 2 — Mutable Key Bug

Buat class key dengan mutable field used in equals/hashCode. Masukkan ke HashMap, mutate, lalu coba get.

Refactor ke immutable record.

## Latihan 3 — Duplicate Key in toMap

Given list case summaries with duplicate caseId, implement policies:

1. reject duplicate;
2. keep first;
3. keep latest updatedAt;
4. group all duplicates.

## Latihan 4 — EnumMap

Implement count by `CaseStatus` using:

- HashMap;
- EnumMap.

Jelaskan kenapa EnumMap lebih tepat.

## Latihan 5 — LinkedHashMap LRU

Implement simple LRU cache with LinkedHashMap access-order and max entries.

Discuss why it is not enough for high-concurrency production cache.

## Latihan 6 — Null Ambiguity

Create map with present-null and absent key. Show difference using `containsKey`.

## Latihan 7 — API Map Design

Design API response for:

```java
Map<CaseId, CaseSummary>
```

as:

1. JSON object;
2. array of entries.

Explain which is better for public API.

## Latihan 8 — Concurrent Mutable Value

Use `ConcurrentHashMap<UserId, List<Permission>>` and identify race. Refactor with immutable list and `compute`.

---

# 36. Ringkasan

`Map` adalah key-value association.

Core lessons:

- Map cannot contain duplicate keys; each key maps to at most one value.
- Key semantics are the heart of Map correctness.
- HashMap is general-purpose, unordered, permits null, and is unsynchronized.
- LinkedHashMap adds predictable encounter order and can support simple LRU.
- SequencedMap gives first/last/reversed encounter-order operations.
- TreeMap gives sorted key order and navigable/range operations.
- EnumMap is ideal for enum keys.
- IdentityHashMap uses `==`, not `equals`; rare specialized use.
- WeakHashMap uses weak keys; not general cache.
- `Map.get` has missing vs present-null ambiguity.
- Map views are often live and can mutate backing map.
- `compute`/`merge` express update semantics.
- `toMap` needs duplicate key policy.
- Map as cache needs eviction/TTL/concurrency.
- `Map<String,Object>` is usually domain smell.
- API/DB/event boundaries must explicitly define key representation, uniqueness, order, null, and compatibility.

Main rule:

```text
Use Map when lookup by key is the model. Design the key like production depends on it—because it does.
```

---

# 37. Referensi

1. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

2. Java SE 25 — `HashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html

3. Java SE 25 — `LinkedHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedHashMap.html

4. Java SE 25 — `SequencedMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedMap.html

5. Java SE 25 — `TreeMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeMap.html

6. Java SE 25 — `SortedMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SortedMap.html

7. Java SE 25 — `NavigableMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/NavigableMap.html

8. Java SE 25 — `EnumMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumMap.html

9. Java SE 25 — `IdentityHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/IdentityHashMap.html

10. Java SE 25 — `WeakHashMap`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/WeakHashMap.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Collections and Streams — Part 003](./learn-java-collections-and-streams-part-003.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Collections and Streams — Part 005](./learn-java-collections-and-streams-part-005.md)

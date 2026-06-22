# learn-java-collections-and-streams-part-023.md

# Java Collections and Streams — Part 023  
# Weak, Soft, and Identity Maps: WeakHashMap, IdentityHashMap, WeakReference, SoftReference, ReferenceQueue, Canonicalization, Metadata Maps, and Leak-Sensitive Design

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **023**  
> Fokus: memahami map yang tidak memakai semantic equality biasa atau tidak memegang key/value secara strong seperti map umum. Kita akan membedah `WeakHashMap`, `IdentityHashMap`, `WeakReference`, `SoftReference`, `ReferenceQueue`, weak-key metadata maps, identity-based graph traversal, canonicalization, memory-sensitive cache anti-patterns, classloader leaks, listener leaks, dan production diagnostics.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Map Biasa Memegang Strong Reference dan Equality Semantics](#2-mental-model-map-biasa-memegang-strong-reference-dan-equality-semantics)
3. [Strong, Weak, Soft, Phantom: Reachability Overview](#3-strong-weak-soft-phantom-reachability-overview)
4. [`WeakReference`](#4-weakreference)
5. [`SoftReference`](#5-softreference)
6. [`ReferenceQueue`](#6-referencequeue)
7. [`WeakHashMap`](#7-weakhashmap)
8. [WeakHashMap Internal Mental Model](#8-weakhashmap-internal-mental-model)
9. [Weak Keys, Strong Values](#9-weak-keys-strong-values)
10. [WeakHashMap Behavior that Surprises Developers](#10-weakhashmap-behavior-that-surprises-developers)
11. [When WeakHashMap is Appropriate](#11-when-weakhashmap-is-appropriate)
12. [When WeakHashMap is Dangerous](#12-when-weakhashmap-is-dangerous)
13. [WeakHashMap as Metadata Map](#13-weakhashmap-as-metadata-map)
14. [WeakHashMap and ClassLoader/Plugin Metadata](#14-weakhashmap-and-classloaderplugin-metadata)
15. [WeakHashMap and Listener Leaks](#15-weakhashmap-and-listener-leaks)
16. [WeakHashMap is Not a Production Cache Policy](#16-weakhashmap-is-not-a-production-cache-policy)
17. [SoftReference and Memory-Sensitive Caches](#17-softreference-and-memory-sensitive-caches)
18. [Why SoftReference Caches Are Often a Bad Default](#18-why-softreference-caches-are-often-a-bad-default)
19. [`IdentityHashMap`](#19-identityhashmap)
20. [Identity vs Equality](#20-identity-vs-equality)
21. [IdentityHashMap Internal Mental Model](#21-identityhashmap-internal-mental-model)
22. [When IdentityHashMap is Appropriate](#22-when-identityhashmap-is-appropriate)
23. [When IdentityHashMap is Dangerous](#23-when-identityhashmap-is-dangerous)
24. [IdentityHashMap for Graph Traversal](#24-identityhashmap-for-graph-traversal)
25. [IdentityHashMap for Serialization/Copy Algorithms](#25-identityhashmap-for-serializationcopy-algorithms)
26. [Canonicalization and Interning](#26-canonicalization-and-interning)
27. [Weak Canonical Maps](#27-weak-canonical-maps)
28. [Weak vs Identity vs Normal Maps](#28-weak-vs-identity-vs-normal-maps)
29. [Null Semantics](#29-null-semantics)
30. [Concurrency](#30-concurrency)
31. [Streams and Views](#31-streams-and-views)
32. [Memory Leak Patterns](#32-memory-leak-patterns)
33. [Production Diagnostics](#33-production-diagnostics)
34. [Production Failure Modes](#34-production-failure-modes)
35. [Best Practices](#35-best-practices)
36. [Decision Matrix](#36-decision-matrix)
37. [Latihan](#37-latihan)
38. [Ringkasan](#38-ringkasan)
39. [Referensi](#39-referensi)

---

# 1. Tujuan Bagian Ini

Map umum seperti:

```java
HashMap<K,V>
LinkedHashMap<K,V>
TreeMap<K,V>
ConcurrentHashMap<K,V>
```

biasanya punya dua asumsi:

1. key/value direferensikan secara **strong** oleh map;
2. key identity ditentukan oleh `equals`/`hashCode` atau comparator.

Tetapi Java juga menyediakan map khusus:

```java
WeakHashMap<K,V>
IdentityHashMap<K,V>
```

Mereka mengubah asumsi dasar.

`WeakHashMap`:

```text
key disimpan secara weak
entry bisa hilang ketika key tidak lagi strongly reachable
```

`IdentityHashMap`:

```text
key dibandingkan dengan ==, bukan equals
```

Ini powerful, tetapi mudah disalahgunakan.

Tujuan part ini:

- memahami reachability;
- memahami weak/soft reference;
- memahami `WeakHashMap`;
- memahami weak-key metadata map;
- memahami kenapa weak values tidak otomatis;
- memahami `IdentityHashMap`;
- memahami identity-based algorithms;
- memahami cache anti-patterns;
- memahami memory leak diagnostics.

---

# 2. Mental Model: Map Biasa Memegang Strong Reference dan Equality Semantics

## 2.1 Strong map

```java
Map<Key, Value> map = new HashMap<>();
map.put(key, value);
```

Selama map masih reachable, map memegang:

```text
strong reference to key
strong reference to value
```

Akibatnya key dan value tidak eligible for GC.

## 2.2 Equality semantics

`HashMap` mencari key berdasarkan:

```text
hashCode + equals
```

`TreeMap` berdasarkan:

```text
Comparator / Comparable
```

## 2.3 Problem

Kadang kamu ingin metadata attached ke object tanpa mencegah object itu di-GC.

Kadang kamu ingin membedakan dua object walaupun `equals` bilang sama.

## 2.4 Specialized maps

- `WeakHashMap` changes reachability.
- `IdentityHashMap` changes equality semantics.

## 2.5 Rule

```text
Weak maps change object lifetime.
Identity maps change object identity semantics.
```

---

# 3. Strong, Weak, Soft, Phantom: Reachability Overview

Java reference API membedakan reachability.

## 3.1 Strongly reachable

Object masih bisa dicapai melalui normal strong references.

```java
Object o = new Object();
```

Selama `o` reachable, object tidak bisa di-GC.

## 3.2 Softly reachable

Object tidak strongly reachable, tetapi masih reachable melalui `SoftReference`.

GC boleh membersihkan soft reference karena memory demand.

## 3.3 Weakly reachable

Object tidak strongly/softly reachable, tetapi reachable melalui `WeakReference`.

GC dapat membersihkan weak reference lebih eagerly.

## 3.4 Phantom reachable

Object sudah finalized/unreachable dan hanya phantom reachable, biasanya untuk cleanup after GC.

## 3.5 Main focus

Untuk collections, yang paling relevan:

```java
WeakReference
SoftReference
WeakHashMap
```

## 3.6 Rule

Reference strength determines whether your data structure keeps objects alive.

---

# 4. `WeakReference`

`WeakReference<T>` adalah reference yang tidak mencegah referent di-GC.

## 4.1 Example

```java
WeakReference<User> ref = new WeakReference<>(user);
user = null;
```

Jika tidak ada strong reference lain ke object User, GC boleh clear weak reference.

## 4.2 get

```java
User u = ref.get();
```

Bisa return:

- object, jika masih alive;
- null, jika sudah cleared.

## 4.3 ReferenceQueue

WeakReference bisa didaftarkan ke `ReferenceQueue` agar kamu tahu ketika referent cleared.

## 4.4 Use cases

- metadata side tables;
- canonicalization;
- avoiding leaks in auxiliary structures;
- cache-like structures with explicit caution.

## 4.5 Rule

WeakReference is for observing object lifetime without extending it.

---

# 5. `SoftReference`

`SoftReference<T>` lebih kuat daripada weak reference.

## 5.1 Intended use

Soft references are often used for memory-sensitive caches.

## 5.2 Clearing behavior

GC clears soft references at discretion, typically in response to memory demand.

## 5.3 Important guarantee

Soft references to softly reachable objects are guaranteed to be cleared before JVM throws `OutOfMemoryError`.

## 5.4 But timing is not deterministic

You cannot predict exactly when soft references are cleared.

## 5.5 Rule

SoftReference makes cache retention controlled by GC pressure, not your business policy.

---

# 6. `ReferenceQueue`

A `ReferenceQueue<T>` receives reference objects after their referents are cleared.

## 6.1 Why needed

If you build custom weak/soft map, you need cleanup of stale entries.

## 6.2 Concept

```java
ReferenceQueue<Key> queue = new ReferenceQueue<>();
WeakReference<Key> ref = new WeakReference<>(key, queue);
```

When key is cleared, ref may be enqueued.

## 6.3 Poll

```java
Reference<? extends Key> ref = queue.poll();
```

Then remove associated entry.

## 6.4 WeakHashMap

WeakHashMap handles this internally.

## 6.5 Rule

ReferenceQueue is the cleanup channel for reference-based data structures.

---

# 7. `WeakHashMap`

`WeakHashMap<K,V>` is a hash-table based Map with weak keys.

## 7.1 Key behavior

Each key is stored indirectly as weak reference.

If key is no longer strongly reachable outside the map, its entry may be removed after GC clears the weak reference.

## 7.2 Value behavior

Values are ordinary strong references.

This is extremely important.

## 7.3 Map behavior changes over time

Entries may disappear due to GC, even without explicit map mutation.

## 7.4 Use case

Metadata associated with objects whose lifetime should not be extended by metadata map.

## 7.5 Rule

WeakHashMap is a map whose keys do not keep objects alive.

---

# 8. WeakHashMap Internal Mental Model

Conceptually:

```text
WeakHashMap
  weak reference to key -> strong reference to value
```

Not:

```text
weak key -> weak value
```

## 8.1 Entry lifecycle

1. Put key/value.
2. Map stores weak reference to key.
3. Value remains strongly held by map.
4. If key has no strong references outside map, GC clears weak ref.
5. Map eventually expunges stale entry.

## 8.2 Stale entries

Cleanup may happen during map operations.

## 8.3 Consequence

Size and content can appear to change due to GC.

## 8.4 Rule

WeakHashMap entries are controlled partly by garbage collector reachability.

---

# 9. Weak Keys, Strong Values

This is the biggest trap.

## 9.1 Value strongly references key

Bad:

```java
WeakHashMap<Key, Value> map = new WeakHashMap<>();
map.put(key, new Value(key));
```

If `Value` strongly references `key`, then:

```text
map -> value -> key
```

keeps key alive.

The weak key cannot be collected.

## 9.2 Indirect reference cycle

Even indirect chains can keep keys alive.

```text
map -> valueA -> keyB -> valueB -> keyA
```

## 9.3 Fix options

- Ensure value does not reference key.
- Store weak references as values too.
- Use custom structure.
- Use explicit remove lifecycle.

## 9.4 Rule

Weak key map leaks if values strongly refer back to keys.

---

# 10. WeakHashMap Behavior that Surprises Developers

## 10.1 Size can shrink without remove

Because GC clears keys.

## 10.2 containsKey can become false later

Even if you never called remove.

## 10.3 get can return null later

Because entry disappeared.

## 10.4 Iteration can see fewer entries over time

GC-dependent.

## 10.5 Synchronization does not stop GC

Even if synchronized externally, GC can clear weak keys.

## 10.6 Rule

WeakHashMap is not stable storage.

---

# 11. When WeakHashMap is Appropriate

## 11.1 Object metadata

Attach metadata without extending object lifetime.

```java
WeakHashMap<Object, Metadata> metadataByObject;
```

## 11.2 Framework side table

Metadata for user objects in framework.

## 11.3 Class metadata

Careful metadata attached to Class/ClassLoader objects to avoid leaks.

## 11.4 Canonicalization helper

Weakly refer to canonical objects.

## 11.5 Internals where GC-driven removal acceptable

If missing entry can be recomputed.

## 11.6 Rule

Use WeakHashMap when losing entries due to GC is acceptable and desired.

---

# 12. When WeakHashMap is Dangerous

## 12.1 Required data

If entry must remain as long as map exists, do not use WeakHashMap.

## 12.2 Business cache requiring TTL/size policy

WeakHashMap does not provide predictable eviction.

## 12.3 Key is interned/string literal/static singleton

Key may never be collected.

## 12.4 Value references key

Leak.

## 12.5 Concurrent use without synchronization

WeakHashMap is not synchronized.

## 12.6 Rule

Do not use WeakHashMap just because you fear memory leaks.

---

# 13. WeakHashMap as Metadata Map

Common pattern:

```java
final class MetadataRegistry {
    private final Map<Object, Metadata> metadata =
        Collections.synchronizedMap(new WeakHashMap<>());

    Metadata metadataFor(Object object) {
        return metadata.computeIfAbsent(object, this::createMetadata);
    }
}
```

## 13.1 Why weak key

If object disappears, metadata should disappear too.

## 13.2 Value caution

`Metadata` must not strongly reference object.

Bad:

```java
record Metadata(Object owner, Instant createdAt) {}
```

Better:

```java
record Metadata(Instant createdAt, String typeName) {}
```

## 13.3 Synchronization

WeakHashMap is not thread-safe. Use synchronized wrapper or explicit lock if shared.

## 13.4 Rule

Weak metadata values should not reference metadata keys.

---

# 14. WeakHashMap and ClassLoader/Plugin Metadata

ClassLoader leaks are common in app servers/plugin systems.

## 14.1 Leak pattern

Static map:

```java
static final Map<Class<?>, Metadata> CACHE = new HashMap<>();
```

Keys are Class objects.

Class objects reference ClassLoader.

Static map prevents ClassLoader unload.

## 14.2 WeakHashMap idea

```java
static final Map<Class<?>, Metadata> CACHE =
    Collections.synchronizedMap(new WeakHashMap<>());
```

Now Class keys can be collected if no strong references remain.

## 14.3 Value caution

Metadata must not strongly reference Class/ClassLoader.

## 14.4 Better modern alternatives

Use framework-provided class value mechanisms when suitable, e.g. `ClassValue`.

## 14.5 Rule

WeakHashMap can help class metadata leaks only if values do not retain the classloader chain.

---

# 15. WeakHashMap and Listener Leaks

Listeners often leak because registries strongly hold them.

## 15.1 Weak listener map

```java
WeakHashMap<Listener, ListenerMetadata>
```

can allow listener GC.

## 15.2 But weak listener patterns are tricky

Listener may disappear unexpectedly if caller does not keep strong reference.

## 15.3 Better often

Explicit unregister lifecycle.

```java
Registration reg = bus.register(listener);
reg.close();
```

## 15.4 Rule

Weak listeners reduce leaks but can create surprising disappearance. Prefer explicit lifecycle when possible.

---

# 16. WeakHashMap is Not a Production Cache Policy

Many developers use WeakHashMap as cache.

## 16.1 Problem

Eviction depends on key reachability, not:

- max size;
- TTL;
- last access;
- business freshness;
- memory budget of values.

## 16.2 Strong values remain

Large values remain as long as key is strongly reachable elsewhere.

## 16.3 Weak keys can disappear too early

If no one else strongly references equivalent key object.

## 16.4 Better

Use cache library with explicit:

- max size;
- TTL;
- refresh;
- stats;
- removal listener.

## 16.5 Rule

WeakHashMap is not a general cache replacement.

---

# 17. SoftReference and Memory-Sensitive Caches

SoftReference has historically been used for memory-sensitive caches.

## 17.1 Example

```java
SoftReference<BigObject> ref = new SoftReference<>(bigObject);
```

## 17.2 Benefit

GC can reclaim cached object under memory pressure.

## 17.3 Problem

Eviction timing is GC-dependent.

## 17.4 Predictability

Production systems often need predictable cache behavior.

## 17.5 Rule

SoftReference caches are for best-effort memory sensitivity, not precise cache policy.

---

# 18. Why SoftReference Caches Are Often a Bad Default

## 18.1 Unpredictable latency

Cache contents may vanish under memory pressure, causing reload storms.

## 18.2 GC coupling

Cache behavior depends on GC heuristics and heap pressure.

## 18.3 No TTL/freshness

SoftReference does not know business freshness.

## 18.4 No max weight

Memory pressure is not same as cache budget.

## 18.5 Better

Use explicit bounded cache for production.

## 18.6 Rule

Use SoftReference only when GC-driven best-effort retention is genuinely acceptable.

---

# 19. `IdentityHashMap`

`IdentityHashMap<K,V>` is Map implementation that uses reference equality.

## 19.1 Key comparison

Uses:

```java
k1 == k2
```

not:

```java
k1.equals(k2)
```

## 19.2 Hashing

Uses identity hash code, not user-defined hashCode.

## 19.3 Not general-purpose Map

It intentionally violates normal Map expectation when clients expect equals semantics.

## 19.4 Use cases

- topology-preserving object graph algorithms;
- serialization;
- deep copy;
- proxy tracking;
- cycle detection by object identity.

## 19.5 Rule

IdentityHashMap is for object identity algorithms, not normal domain lookup.

---

# 20. Identity vs Equality

## 20.1 Equality

```java
new String("A").equals(new String("A")) // true
```

## 20.2 Identity

```java
new String("A") == new String("A") // false
```

## 20.3 IdentityHashMap example

```java
String a = new String("A");
String b = new String("A");

Map<String, Integer> map = new IdentityHashMap<>();
map.put(a, 1);
map.put(b, 2);

map.size(); // 2
```

HashMap would size 1.

## 20.4 Rule

IdentityHashMap distinguishes object instances, not logical values.

---

# 21. IdentityHashMap Internal Mental Model

IdentityHashMap is implemented differently from HashMap.

## 21.1 Linear-probe hash table

Conceptually it uses an array with alternating key/value slots and linear probing.

## 21.2 Identity hash

Uses `System.identityHashCode`.

## 21.3 Null handling

Uses internal sentinel for null key.

## 21.4 Tuning

Constructor expected maximum size helps capacity.

## 21.5 Rule

IdentityHashMap is optimized for identity-based reference mapping.

---

# 22. When IdentityHashMap is Appropriate

## 22.1 Graph traversal visited set

```java
Map<Object, Boolean> visited = new IdentityHashMap<>();
```

## 22.2 Deep copy

Map original object identity to copied object.

```java
IdentityHashMap<Object, Object> copies;
```

## 22.3 Serialization

Preserve object sharing and cycles.

## 22.4 Proxy/wrapper registry

Map exact object instance to proxy.

## 22.5 Framework internals

Track objects by identity independent of equals implementation.

## 22.6 Rule

Use IdentityHashMap when object identity is the domain of the algorithm.

---

# 23. When IdentityHashMap is Dangerous

## 23.1 Domain value lookup

Bad:

```java
IdentityHashMap<UserId, User> usersById;
```

Two equal UserId objects become different keys.

## 23.2 String keys

Bad unless you intentionally mean same String object.

## 23.3 Records/value objects

Bad for normal value semantics.

## 23.4 Public API

Surprising to callers expecting Map equality contract.

## 23.5 Rule

Never use IdentityHashMap for value-object domain lookup.

---

# 24. IdentityHashMap for Graph Traversal

## 24.1 Problem

Graph nodes may override equals based on value.

But traversal must detect object cycles by instance.

## 24.2 Example

```java
void traverse(Node node, Map<Node, Boolean> visited) {
    if (visited.put(node, Boolean.TRUE) != null) {
        return;
    }
    for (Node child : node.children()) {
        traverse(child, visited);
    }
}
```

Use:

```java
Map<Node, Boolean> visited = new IdentityHashMap<>();
```

## 24.3 Why not HashSet?

HashSet uses equals; two distinct nodes equal by value may collapse incorrectly.

## 24.4 Rule

For object graph identity, use identity-based visited tracking.

---

# 25. IdentityHashMap for Serialization/Copy Algorithms

## 25.1 Deep copy

Need preserve shared references.

```text
A -> X
B -> X
```

After copy:

```text
A' -> X'
B' -> X'
```

not two separate copies of X.

## 25.2 Identity map

```java
IdentityHashMap<Object, Object> copyByOriginal = new IdentityHashMap<>();
```

## 25.3 Cycle handling

If object seen before, return existing copy.

## 25.4 Rule

IdentityHashMap is ideal for preserving object topology.

---

# 26. Canonicalization and Interning

Canonicalization maps equal values to one canonical instance.

## 26.1 Example

```java
UserId canonical = canonicalize(new UserId("A"));
```

All equal UserId values share same instance.

## 26.2 Normal map

```java
Map<UserId, UserId> canonical = new HashMap<>();
```

## 26.3 Weak canonical map

To avoid retaining canonical values forever, use weak references carefully.

## 26.4 Danger

Canonical value may disappear if weakly held and not strongly used elsewhere.

## 26.5 Rule

Canonicalization changes object identity/lifetime semantics; design carefully.

---

# 27. Weak Canonical Maps

Weak canonicalization wants:

```text
if canonical object not used elsewhere, allow GC
```

## 27.1 WeakHashMap challenge

If key and value are same object:

```java
weakMap.put(value, value);
```

value strongly references canonical object, preventing key collection.

## 27.2 Need weak value too

Use custom structure:

```text
weak key -> weak value
```

plus ReferenceQueue cleanup.

## 27.3 Complexity

This is subtle and easy to leak.

## 27.4 Better

Use established libraries or carefully tested custom implementation.

## 27.5 Rule

Weak interning is advanced; WeakHashMap alone is often not enough.

---

# 28. Weak vs Identity vs Normal Maps

| Need | Map |
|---|---|
| logical key equality | `HashMap` |
| sorted/range key | `TreeMap` |
| concurrent logical lookup | `ConcurrentHashMap` |
| key should not keep object alive | `WeakHashMap` |
| object identity lookup | `IdentityHashMap` |
| enum key | `EnumMap` |
| insertion/access order | `LinkedHashMap` |
| weak key + concurrent | custom/library; no JDK ConcurrentWeakHashMap |
| production cache | cache library |

## 28.1 Rule

Choose based on equality semantics and lifetime semantics separately.

---

# 29. Null Semantics

## 29.1 WeakHashMap

Allows null key and null values similar to HashMap behavior.

Null key is held strongly/specially because it cannot be weakly referenced in normal way.

## 29.2 IdentityHashMap

Permits null key/value.

Null key handled with internal sentinel.

## 29.3 Caution

Null values still create `get` ambiguity.

## 29.4 Rule

Avoid null values even if these maps allow them.

---

# 30. Concurrency

## 30.1 WeakHashMap

Not synchronized.

Use:

```java
Collections.synchronizedMap(new WeakHashMap<>())
```

or explicit locking.

But remember GC-driven removal can still happen.

## 30.2 IdentityHashMap

Not synchronized.

Use external synchronization if shared and mutated.

## 30.3 No built-in ConcurrentWeakHashMap

JDK does not provide concurrent weak-key map.

## 30.4 Rule

Specialized map semantics do not imply thread safety.

---

# 31. Streams and Views

## 31.1 WeakHashMap views

Views are live and may shrink as GC clears keys.

## 31.2 IdentityHashMap views

Views use identity semantics.

## 31.3 Snapshot

If stable traversal needed:

```java
Map<K,V> snapshot = new HashMap<>(map);
```

But for weak map, snapshot strongly holds keys.

## 31.4 Rule

Snapshotting weak map changes lifetime during snapshot.

---

# 32. Memory Leak Patterns

## 32.1 Static HashMap metadata

Static map keeps keys forever.

Fix: weak key map or explicit remove.

## 32.2 WeakHashMap value references key

Weakness defeated.

## 32.3 Listener registry strong references

Listeners never GC.

Fix: unregister or weak pattern with caution.

## 32.4 Soft cache retains too much

GC keeps soft refs longer than expected.

## 32.5 Identity map long-lived

Visited map not cleared after traversal.

## 32.6 Rule

Maps leak when lifetime of map exceeds intended lifetime of keys/values.

---

# 33. Production Diagnostics

## 33.1 Heap dump

Look for:

- large HashMap retaining keys;
- WeakHashMap values retaining keys;
- ClassLoader retained by static maps;
- listeners retained by registry;
- IdentityHashMap used as long-lived cache;
- SoftReference storms.

## 33.2 Dominator tree

Find path:

```text
GC root -> static map -> value -> key/classloader
```

## 33.3 Reference chains

For WeakHashMap, verify values do not point to keys.

## 33.4 Cache metrics

If using soft/weak cache, monitor hit rate and reload spikes.

## 33.5 Rule

Leak diagnosis is reachability graph diagnosis.

---

# 34. Production Failure Modes

## 34.1 WeakHashMap entry disappears unexpectedly

Fix: use normal map if data required.

## 34.2 WeakHashMap does not clear

Value references key or key strongly referenced elsewhere.

## 34.3 String literal keys never disappear

Interned/static strings remain strongly reachable.

## 34.4 Weak listener vanishes

Caller did not keep strong reference.

## 34.5 Soft cache reload storm

GC clears many soft refs under pressure.

## 34.6 IdentityHashMap duplicate logical keys

Equal value objects stored separately.

## 34.7 IdentityHashMap used in API

Caller surprised by non-equals semantics.

## 34.8 ClassLoader leak persists

Weak key but value references Class/ClassLoader.

## 34.9 Weak canonical map leaks

Value strongly holds key.

## 34.10 Concurrent access corrupts WeakHashMap/IdentityHashMap

Fix: synchronization or different structure.

## 34.11 Null value get ambiguity

Fix: avoid null values.

## 34.12 Snapshot weak map retains keys temporarily

Accept or avoid snapshot.

---

# 35. Best Practices

## 35.1 WeakHashMap

- Use for auxiliary metadata.
- Ensure value does not reference key.
- Do not use for required data.
- Do not use as general cache.
- Synchronize externally if shared.
- Be careful with static maps and classloaders.

## 35.2 SoftReference

- Use only for best-effort memory-sensitive cache.
- Prefer explicit cache policy for production.
- Monitor reload behavior.

## 35.3 IdentityHashMap

- Use for object graph algorithms.
- Avoid domain value lookup.
- Do not expose casually in public APIs.
- Clear after traversal.

## 35.4 General

- Think in reachability graph.
- Think in equality semantics.
- Test GC-dependent behavior carefully but avoid relying on exact GC timing.
- Prefer explicit lifecycle when possible.

---

# 36. Decision Matrix

| Requirement | Recommended |
|---|---|
| logical key lookup | `HashMap` |
| concurrent logical lookup | `ConcurrentHashMap` |
| metadata should not keep object alive | `WeakHashMap` |
| value should not keep key alive | ensure value does not reference key |
| weak key + weak value | custom/reference-queue/library |
| memory-sensitive best-effort value cache | `SoftReference` with caution |
| predictable cache TTL/size | cache library |
| object identity visited set | `IdentityHashMap` |
| graph deep copy identity table | `IdentityHashMap` |
| class metadata avoiding classloader leak | `WeakHashMap` or `ClassValue`, with value caution |
| listener lifecycle | explicit unregister preferred |
| weak listeners | use carefully |
| enum key | `EnumMap` |
| sorted key | `TreeMap` |
| weak concurrent map | custom/library; JDK has no direct general-purpose one |
| public API map | avoid WeakHashMap/IdentityHashMap unless explicitly documented |

---

# 37. Latihan

## Latihan 1 — WeakHashMap Disappearing Entry

Create object key, put into WeakHashMap, remove strong reference, request GC, observe eventual disappearance.

Explain why exact timing is not guaranteed.

## Latihan 2 — Value References Key Leak

Create WeakHashMap where value holds key.

Show why entry may not disappear.

## Latihan 3 — Metadata Map

Design metadata map for object instances where metadata does not keep object alive.

## Latihan 4 — IdentityHashMap String Example

Put two `new String("A")` keys into IdentityHashMap and HashMap.

Compare size.

## Latihan 5 — Graph Traversal

Use IdentityHashMap as visited map for object graph with cycles.

## Latihan 6 — Deep Copy

Implement copy registry:

```java
IdentityHashMap<Object, Object> copies
```

to preserve shared references.

## Latihan 7 — SoftReference Cache

Build simple SoftReference cache and explain why it is unpredictable.

## Latihan 8 — ClassLoader Leak Reasoning

Draw reachability path:

```text
static map -> value -> Class -> ClassLoader
```

Explain weak key failure if value retains class.

## Latihan 9 — Weak Listener

Design weak listener pattern and explain why explicit unregister may be better.

## Latihan 10 — Map Selection

Given scenarios, choose HashMap/WeakHashMap/IdentityHashMap/ConcurrentHashMap/TreeMap.

---

# 38. Ringkasan

Weak, soft, and identity maps change foundational assumptions.

Core lessons:

- Normal maps hold strong references.
- WeakHashMap holds keys weakly.
- WeakHashMap values are strong.
- Value referencing key defeats weak-key cleanup.
- WeakHashMap entries may disappear due to GC.
- WeakHashMap is good for auxiliary metadata, not required storage.
- WeakHashMap is not a predictable cache policy.
- SoftReference is GC-driven memory-sensitive retention, not TTL/size policy.
- IdentityHashMap uses `==`, not `equals`.
- IdentityHashMap is for object graph identity algorithms.
- IdentityHashMap is dangerous for domain value lookup.
- Weak canonicalization is subtle because values can retain keys.
- ReferenceQueue is needed for custom reference-based data structures.
- Specialized map semantics do not imply thread safety.
- Leak diagnosis is reachability graph diagnosis.

Main rule:

```text
Before choosing WeakHashMap or IdentityHashMap, ask:
Am I changing lifetime semantics, equality semantics, or both?
If yes, is that exactly what the algorithm needs?
```

---

# 39. Referensi

1. Java SE 25 — `WeakHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/WeakHashMap.html

2. Java SE 25 — `IdentityHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/IdentityHashMap.html

3. Java SE 25 — `WeakReference`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/WeakReference.html

4. Java SE 25 — `SoftReference`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/SoftReference.html

5. Java SE 25 — `Reference`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/Reference.html

6. Java SE 25 — `ReferenceQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/ReferenceQueue.html

7. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

8. Java SE 25 — `ClassValue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ClassValue.html

9. OpenJDK — `WeakHashMap.java` Source  
   https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/WeakHashMap.java

10. OpenJDK — `IdentityHashMap.java` Source  
    https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/IdentityHashMap.java

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-collections-and-streams-part-022.md">⬅️ Java Collections and Streams — Part 022</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-collections-and-streams-part-024.md">Java Collections and Streams — Part 024 ➡️</a>
</div>

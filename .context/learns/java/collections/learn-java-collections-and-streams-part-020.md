# learn-java-collections-and-streams-part-020.md

# Java Collections and Streams — Part 020
# ConcurrentHashMap Deep Dive: ConcurrentMap Contract, Null-Free Semantics, Per-Key Atomicity, compute/merge, Weakly Consistent Views, Resizing, Contention, LongAdder Pattern, and Production Design

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **020**  
> Fokus: memahami `ConcurrentHashMap` bukan sebagai “HashMap yang thread-safe”, tetapi sebagai **concurrent key-value coordination primitive**. Kita akan membedah contract `ConcurrentMap`, null-free semantics, happens-before intuition, atomic update methods, `computeIfAbsent`, `merge`, `LongAdder` pattern, weakly consistent iterators, view collections, sizing, contention, mutable value hazards, cache misuse, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: ConcurrentHashMap adalah Concurrent Index](#2-mental-model-concurrenthashmap-adalah-concurrent-index)
3. [Bukan Sekadar Synchronized HashMap](#3-bukan-sekadar-synchronized-hashmap)
4. [Map Contract vs ConcurrentMap Contract](#4-map-contract-vs-concurrentmap-contract)
5. [Core Guarantees](#5-core-guarantees)
6. [What It Does Not Guarantee](#6-what-it-does-not-guarantee)
7. [Null-Free Semantics](#7-null-free-semantics)
8. [Why Null is Forbidden](#8-why-null-is-forbidden)
9. [Safe Publication and Memory Visibility](#9-safe-publication-and-memory-visibility)
10. [`get`, `put`, `remove`: Basic Operations](#10-get-put-remove-basic-operations)
11. [`putIfAbsent`: Atomic Insert](#11-putifabsent-atomic-insert)
12. [`remove(key, value)` and `replace`](#12-removekey-value-and-replace)
13. [`computeIfAbsent`](#13-computeifabsent)
14. [`computeIfPresent`](#14-computeifpresent)
15. [`compute`](#15-compute)
16. [`merge`](#16-merge)
17. [Choosing Between Atomic Methods](#17-choosing-between-atomic-methods)
18. [Mapping Function Rules](#18-mapping-function-rules)
19. [LongAdder Frequency Map Pattern](#19-longadder-frequency-map-pattern)
20. [Concurrent Sets with `newKeySet`](#20-concurrent-sets-with-newkeyset)
21. [Views: `keySet`, `values`, `entrySet`](#21-views-keyset-values-entryset)
22. [Weakly Consistent Iterators](#22-weakly-consistent-iterators)
23. [Bulk Operations](#23-bulk-operations)
24. [Sizing and Capacity](#24-sizing-and-capacity)
25. [Resizing Under Concurrency](#25-resizing-under-concurrency)
26. [Contention and Hot Keys](#26-contention-and-hot-keys)
27. [Mutable Values Hazard](#27-mutable-values-hazard)
28. [Nested Concurrent Structures](#28-nested-concurrent-structures)
29. [ConcurrentHashMap as Cache](#29-concurrenthashmap-as-cache)
30. [Snapshot Patterns](#30-snapshot-patterns)
31. [Per-Key Lock/State Pattern](#31-per-key-lockstate-pattern)
32. [ConcurrentHashMap vs Alternatives](#32-concurrenthashmap-vs-alternatives)
33. [Streams and ConcurrentHashMap](#33-streams-and-concurrenthashmap)
34. [Performance Cost Model](#34-performance-cost-model)
35. [Testing ConcurrentHashMap Code](#35-testing-concurrenthashmap-code)
36. [Production Diagnostics](#36-production-diagnostics)
37. [Production Failure Modes](#37-production-failure-modes)
38. [Best Practices](#38-best-practices)
39. [Decision Matrix](#39-decision-matrix)
40. [Latihan](#40-latihan)
41. [Ringkasan](#41-ringkasan)
42. [Referensi](#42-referensi)

---

# 1. Tujuan Bagian Ini

`ConcurrentHashMap` sering dipakai begitu saja:

```java
Map<K, V> map = new ConcurrentHashMap<>();
```

Lalu developer berharap:

```text
semua problem concurrency selesai
```

Padahal `ConcurrentHashMap` menyelesaikan problem spesifik:

- concurrent exact key lookup;
- concurrent update per key;
- atomic insert/update/remove per key;
- weakly consistent traversal;
- safe publication melalui collection operation;
- high-throughput shared map access.

Namun ia tidak otomatis menyelesaikan:

- multi-map transaction;
- mutable value race;
- cache eviction;
- TTL;
- business invariant across keys;
- exact snapshot iteration;
- ordered traversal;
- backpressure;
- distributed concurrency.

Tujuan bagian ini:

- memahami `ConcurrentHashMap` secara contract-level;
- memahami atomic methods;
- memahami null-free semantics;
- memahami weakly consistent iteration;
- memahami contention and performance;
- memahami value mutability hazard;
- mendesain pattern production yang aman.

---

# 2. Mental Model: ConcurrentHashMap adalah Concurrent Index

`ConcurrentHashMap<K,V>` adalah shared index:

```text
K -> V
```

yang dapat diakses banyak thread.

Contoh:

```java
ConcurrentHashMap<UserId, Session> sessions;
ConcurrentHashMap<String, LongAdder> counters;
ConcurrentHashMap<JobId, JobState> jobs;
ConcurrentHashMap<TenantId, TenantConfig> configs;
```

## 2.1 What it protects

It protects map structure:

```text
buckets/table/nodes/mappings
```

from concurrent corruption.

## 2.2 What it does not protect

It does not automatically protect:

```text
fields inside V
collections inside V
relationships between multiple keys
relationships between this map and another map
```

## 2.3 Example

```java
ConcurrentHashMap<UserId, List<Role>> rolesByUser;
```

The map is concurrent. The `List<Role>` value may not be.

## 2.4 Main rule

```text
ConcurrentHashMap gives safe concurrent map operations, not safe mutable object graphs.
```

---

# 3. Bukan Sekadar Synchronized HashMap

A synchronized map wrapper:

```java
Map<K,V> map = Collections.synchronizedMap(new HashMap<>());
```

uses coarse lock around operations.

`ConcurrentHashMap` is designed for higher concurrency.

## 3.1 Difference

Synchronized wrapper:

```text
one mutex around method calls
```

ConcurrentHashMap:

```text
concurrent retrieval/update design with finer-grained internal coordination
```

## 3.2 Iteration

SynchronizedMap iteration requires manual synchronization.

ConcurrentHashMap iterators are weakly consistent and do not throw `ConcurrentModificationException`.

## 3.3 Null

HashMap permits null key/value. ConcurrentHashMap rejects null key/value.

## 3.4 Rule

ConcurrentHashMap is a different concurrency contract, not only a synchronized HashMap.

---

# 4. Map Contract vs ConcurrentMap Contract

`ConcurrentHashMap` implements `ConcurrentMap`.

`ConcurrentMap` extends `Map` with atomic operations.

## 4.1 Important additional methods

```java
putIfAbsent
remove(key, value)
replace(key, value)
replace(key, oldValue, newValue)
```

## 4.2 Default compute/merge methods

ConcurrentMap provides concurrency-aware expectations for compute-like methods.

## 4.3 Null assumption

ConcurrentMap default implementations assume null values are not supported, so `get() == null` means absence. Implementations supporting null values must override.

## 4.4 Rule

ConcurrentMap contract is built around null-free atomic map operations.

---

# 5. Core Guarantees

## 5.1 Concurrent access

Multiple threads can safely call supported methods.

## 5.2 Retrieval concurrency

Retrieval operations generally do not block updates in the same way coarse synchronized maps do.

## 5.3 Atomic updates

Per-key methods such as:

```java
putIfAbsent
compute
computeIfAbsent
computeIfPresent
merge
```

support atomic update logic for a key.

## 5.4 Weakly consistent traversal

Iterators/spliterators are safe under concurrent modification but not exact snapshot.

## 5.5 Memory consistency

Actions before placing an object into concurrent collection happen-before actions after access/removal by another thread according to package contract.

## 5.6 Rule

ConcurrentHashMap provides per-key safe concurrent coordination.

---

# 6. What It Does Not Guarantee

## 6.1 No total map lock

It does not make multi-key operation atomic.

Bad assumption:

```java
if (map.containsKey(a) && map.containsKey(b)) {
    map.remove(a);
    map.remove(b);
}
```

This is not atomic as a pair.

## 6.2 No exact size under mutation

`size()` under concurrent updates is not stable as control condition.

## 6.3 No ordering

No insertion order, no sorted order.

## 6.4 No eviction

Not a complete cache.

## 6.5 No protection for mutable V

If V is mutable, you need additional design.

## 6.6 Rule

ConcurrentHashMap is safe map structure, not universal synchronization mechanism.

---

# 7. Null-Free Semantics

`ConcurrentHashMap` rejects:

- null keys;
- null values.

```java
map.put(null, value); // NullPointerException
map.put(key, null);   // NullPointerException
```

## 7.1 `get` return

```java
V value = map.get(key);
```

If null:

```text
no mapping currently visible
```

because present-null value is impossible.

## 7.2 Benefits

Simplifies atomic methods and absence checks.

## 7.3 Design implication

Use absence instead of null value.

## 7.4 Rule

In ConcurrentHashMap, absence is represented by no mapping.

---

# 8. Why Null is Forbidden

Null would create ambiguity.

## 8.1 Map.get ambiguity

If null values were allowed:

```java
map.get(k) == null
```

could mean absent or present-null.

## 8.2 Concurrent race

With normal HashMap, you can disambiguate:

```java
containsKey(k)
```

But in concurrent map, key could change between `get` and `containsKey`.

## 8.3 Atomic method design

Atomic methods rely on null meaning absent/no result in many places.

## 8.4 Better alternatives

- no mapping;
- explicit sentinel object;
- sealed domain result;
- `Optional<V>` only if absence is itself cached value;
- `CacheEntry` type.

## 8.5 Rule

Null-free design is foundational to ConcurrentHashMap correctness.

---

# 9. Safe Publication and Memory Visibility

When thread A puts object into a concurrent collection and thread B retrieves it, concurrent collection operations provide memory consistency effects.

## 9.1 Good

```java
record Config(String url, int timeout) {}

map.put("tenant-a", new Config(url, timeout));
Config config = map.get("tenant-a");
```

Immutable value works well.

## 9.2 Dangerous

```java
class MutableConfig {
    String url;
    int timeout;
}

MutableConfig config = new MutableConfig();
map.put("tenant-a", config);
config.timeout = 5000; // mutation after publication
```

Mutation after publication can race unless synchronized/volatile/atomic/immutable design.

## 9.3 Rule

Put immutable or safely synchronized values into concurrent maps.

---

# 10. `get`, `put`, `remove`: Basic Operations

## 10.1 get

```java
V v = map.get(key);
```

Returns current value or null if absent.

## 10.2 put

```java
V old = map.put(key, value);
```

Associates key to value, returns previous value or null if absent.

Because null values impossible, return null means no previous mapping.

## 10.3 remove

```java
V old = map.remove(key);
```

Removes mapping, returns old value or null if absent.

## 10.4 Single operation atomicity

Each method is thread-safe, but sequences are not automatically atomic.

## 10.5 Rule

Use basic operations for simple independent map actions.

---

# 11. `putIfAbsent`: Atomic Insert

## 11.1 Problem

Bad:

```java
if (map.get(key) == null) {
    map.put(key, value);
}
```

Another thread can insert between get and put.

## 11.2 Good

```java
V existing = map.putIfAbsent(key, value);
if (existing == null) {
    // inserted
} else {
    // someone else already had value
}
```

## 11.3 Use case

- registry;
- single initialization;
- idempotent insert;
- lock object per key.

## 11.4 Limitation

The value is constructed before call. If value construction expensive, use `computeIfAbsent`.

## 11.5 Rule

Use putIfAbsent when value is cheap/already available.

---

# 12. `remove(key, value)` and `replace`

These are compare-and-act atomic operations.

## 12.1 Conditional remove

```java
map.remove(key, expectedValue);
```

Removes only if key maps to expected value.

## 12.2 Conditional replace

```java
map.replace(key, oldValue, newValue);
```

Replaces only if current value equals expected old value.

## 12.3 Use case

Optimistic state transition:

```java
jobs.replace(jobId, PENDING, RUNNING);
```

## 12.4 Value equality

Uses equals, so immutable value objects are preferred.

## 12.5 Rule

Use conditional remove/replace for optimistic per-key state transitions.

---

# 13. `computeIfAbsent`

```java
V value = map.computeIfAbsent(key, k -> createValue(k));
```

## 13.1 Semantics

If key absent, compute and install value atomically.

If key present, return existing value.

## 13.2 Mapping function returning null

If mapping function returns null, no mapping is recorded.

## 13.3 Use cases

- lazy initialization;
- per-key counter;
- per-key lock;
- registry object.

## 13.4 Example

```java
ConcurrentHashMap<UserId, UserContext> contexts = new ConcurrentHashMap<>();

UserContext ctx = contexts.computeIfAbsent(userId, UserContext::new);
```

## 13.5 Caveat

Do not make mapping function slow/blocking if high contention.

## 13.6 Rule

Use computeIfAbsent for atomic lazy per-key creation.

---

# 14. `computeIfPresent`

```java
map.computeIfPresent(key, (k, oldValue) -> newValue);
```

## 14.1 Semantics

Only computes if key currently present.

## 14.2 Returning null

Returning null removes mapping.

## 14.3 Use cases

- update only existing session;
- expire if condition;
- transform existing value.

## 14.4 Example

```java
sessions.computeIfPresent(userId, (id, session) ->
    session.isExpired() ? null : session.refresh()
);
```

## 14.5 Rule

Use computeIfPresent when absent key should stay absent.

---

# 15. `compute`

```java
map.compute(key, (k, oldValue) -> newValue);
```

## 15.1 Semantics

Computes whether key is present or absent.

`oldValue` is null if absent.

## 15.2 Returning null

Removes mapping or keeps absent.

## 15.3 Use cases

- full per-key state machine;
- insert/update/remove in one atomic function;
- conditional transition.

## 15.4 Example

```java
jobs.compute(jobId, (id, old) -> {
    if (old == null) {
        return JobState.pending(id);
    }
    return old.advance();
});
```

## 15.5 Rule

Use compute when both absent and present cases matter.

---

# 16. `merge`

```java
map.merge(key, value, remappingFunction);
```

## 16.1 Semantics

If key absent, associates given value.

If key present, combines old value and given value.

## 16.2 Returning null

If remapping function returns null, mapping is removed.

## 16.3 Use cases

- counters;
- aggregation;
- append immutable data;
- max/min update.

## 16.4 Example

```java
counts.merge(word, 1, Integer::sum);
```

## 16.5 High contention

For very high-contention counters, prefer `LongAdder`.

## 16.6 Rule

Use merge for atomic accumulation.

---

# 17. Choosing Between Atomic Methods

| Need | Method |
|---|---|
| insert only if absent, value already built | `putIfAbsent` |
| lazy create if absent | `computeIfAbsent` |
| update only if present | `computeIfPresent` |
| insert/update/remove depending old value | `compute` |
| combine old and new value | `merge` |
| remove only if still expected value | `remove(key, value)` |
| replace only if still expected value | `replace(key, old, new)` |

## 17.1 Rule

Use the narrowest atomic method that matches the state transition.

---

# 18. Mapping Function Rules

Mapping/remapping functions are critical.

## 18.1 Keep short

Avoid long blocking IO inside `compute`.

## 18.2 Avoid recursive update to same map/key

Can cause illegal recursive update or deadlock-like behavior depending pattern.

## 18.3 Avoid side effects

Function may be retried or interact badly with concurrency.

## 18.4 Do not mutate unrelated shared state without coordination

Atomicity is per map/key, not global.

## 18.5 Return null intentionally

Know that null removes/no mapping.

## 18.6 Rule

Mapping functions should be pure-ish, fast, and local to the key.

---

# 19. LongAdder Frequency Map Pattern

ConcurrentHashMap docs recommend scalable frequency map pattern:

```java
ConcurrentHashMap<String, LongAdder> freqs = new ConcurrentHashMap<>();

freqs.computeIfAbsent(key, k -> new LongAdder())
     .increment();
```

## 19.1 Why not merge Integer?

```java
counts.merge(key, 1, Integer::sum);
```

Can work, but creates boxed integers and contends heavily for hot keys.

## 19.2 LongAdder advantage

LongAdder spreads contention internally.

## 19.3 Reading

```java
LongAdder adder = freqs.get(key);
long count = adder == null ? 0L : adder.sum();
```

## 19.4 Cleanup

If keys are unbounded, counters can leak.

## 19.5 Rule

Use CHM + LongAdder for high-throughput counters.

---

# 20. Concurrent Sets with `newKeySet`

ConcurrentHashMap can create concurrent sets.

## 20.1 Static factory

```java
Set<K> set = ConcurrentHashMap.newKeySet();
```

## 20.2 Backed by map

Set membership is backed by ConcurrentHashMap keys.

## 20.3 Use cases

- visited IDs;
- online users;
- in-flight job IDs;
- dedup set.

## 20.4 Alternative keySet(defaultValue)

```java
ConcurrentHashMap<K, Boolean> map = new ConcurrentHashMap<>();
Set<K> set = map.keySet(Boolean.TRUE);
```

## 20.5 Rule

Use `ConcurrentHashMap.newKeySet()` for concurrent membership set.

---

# 21. Views: `keySet`, `values`, `entrySet`

ConcurrentHashMap provides collection views.

## 21.1 keySet

View of keys.

## 21.2 values

View of values.

## 21.3 entrySet

View of entries.

## 21.4 Backed by map

Changes reflect map and vice versa where operations supported.

## 21.5 Iterators

Weakly consistent.

## 21.6 Rule

Views are live concurrent views, not snapshots.

---

# 22. Weakly Consistent Iterators

ConcurrentHashMap iterators are weakly consistent.

## 22.1 Meaning

They:

- do not throw ConcurrentModificationException;
- may proceed concurrently with updates;
- may reflect some modifications after iterator creation;
- may not reflect all modifications;
- do not provide atomic snapshot.

## 22.2 Example

```java
for (K key : map.keySet()) {
    ...
}
```

Safe while map mutates, but result not exact snapshot.

## 22.3 If exact snapshot needed

```java
Map<K,V> snapshot = Map.copyOf(map);
```

For mutable values, copy to DTOs, not just references.

## 22.4 Rule

Weakly consistent iteration is for monitoring/best-effort traversal, not exact reporting.

---

# 23. Bulk Operations

ConcurrentHashMap has bulk operations:

- `forEach`;
- `search`;
- `reduce`;

with parallelism threshold.

## 23.1 Use carefully

These operations are designed to be safe under concurrent updates but not necessarily snapshot exact.

## 23.2 Parallelism threshold

Controls when parallel execution is used.

## 23.3 Functions should be side-effect safe

Avoid depending on stable map state.

## 23.4 Use cases

- monitoring;
- approximate aggregation;
- concurrent-safe traversal;
- non-critical summaries.

## 23.5 Rule

Bulk operations are concurrent-friendly, not transactionally consistent.

---

# 24. Sizing and Capacity

Constructors allow initial capacity.

## 24.1 Why size matters

Resizing under concurrency is expensive.

## 24.2 Initial capacity

If you expect many mappings, provide initial capacity.

```java
new ConcurrentHashMap<>(expectedMappings)
```

## 24.3 Load factor/concurrencyLevel

Some constructors accept loadFactor and concurrencyLevel for compatibility/sizing hints.

Modern implementation does not use old segment model like Java 7 did.

## 24.4 Avoid over-sizing

Large tables use memory.

## 24.5 Rule

Pre-size large maps when expected cardinality is known.

---

# 25. Resizing Under Concurrency

ConcurrentHashMap resizes table as it grows.

## 25.1 Cost

Resize requires moving/redistributing bins.

## 25.2 Concurrent assistance

Modern implementations can allow threads to help transfer during resizing.

## 25.3 Latency

Resizing can create throughput/latency impact.

## 25.4 Pre-size

Reduce resize by reasonable initial sizing.

## 25.5 Rule

Large growing concurrent maps should be capacity-planned.

---

# 26. Contention and Hot Keys

## 26.1 Hot key

Many threads update same key.

```java
map.compute("global", ...)
```

This serializes around that key's update path.

## 26.2 Symptoms

- high CPU;
- reduced throughput;
- blocked/contended threads;
- long compute latency.

## 26.3 Fixes

- LongAdder for counters;
- sharding;
- per-tenant maps;
- batching;
- actor/single-writer;
- reduce update frequency.

## 26.4 Rule

ConcurrentHashMap scales with distributed keys; hot keys still bottleneck.

---

# 27. Mutable Values Hazard

## 27.1 Bad

```java
ConcurrentHashMap<UserId, ArrayList<Role>> roles = new ConcurrentHashMap<>();

roles.computeIfAbsent(userId, id -> new ArrayList<>())
     .add(role);
```

Map operation safe. ArrayList mutation unsafe.

## 27.2 Option 1: concurrent value

```java
ConcurrentHashMap<UserId, Set<Role>> roles = new ConcurrentHashMap<>();

roles.computeIfAbsent(userId, id -> ConcurrentHashMap.newKeySet())
     .add(role);
```

## 27.3 Option 2: immutable update

```java
roles.compute(userId, (id, oldSet) -> {
    Set<Role> next = oldSet == null
        ? new HashSet<>()
        : new HashSet<>(oldSet);
    next.add(role);
    return Set.copyOf(next);
});
```

## 27.4 Option 3: per-value lock

Use explicit synchronized value object.

## 27.5 Rule

Never assume V is safe because map is safe.

---

# 28. Nested Concurrent Structures

Nested maps are common:

```java
ConcurrentHashMap<TenantId, ConcurrentHashMap<UserId, Session>> sessions;
```

## 28.1 Safe creation

```java
sessions.computeIfAbsent(tenantId, id -> new ConcurrentHashMap<>())
        .put(userId, session);
```

## 28.2 Cleanup complexity

Removing empty inner map safely is tricky because another thread may insert into it while cleanup runs.

## 28.3 Alternative composite key

```java
record TenantUserKey(TenantId tenantId, UserId userId) {}
ConcurrentHashMap<TenantUserKey, Session> sessions;
```

## 28.4 Rule

Nested concurrent maps need lifecycle and cleanup design.

---

# 29. ConcurrentHashMap as Cache

ConcurrentHashMap is often used as local cache.

## 29.1 What it gives

- concurrent lookup;
- concurrent update;
- atomic lazy load.

## 29.2 What it lacks

- max size;
- TTL;
- eviction;
- refresh;
- stats;
- backpressure;
- stampede protection beyond per-key compute;
- removal policy.

## 29.3 Loading cache

```java
map.computeIfAbsent(key, this::load);
```

Good for simple cases.

## 29.4 Risks

- unbounded growth;
- stale data;
- slow loader blocking map update path;
- exception behavior;
- negative caching ambiguity.

## 29.5 Rule

ConcurrentHashMap is storage mechanism, not complete cache policy.

---

# 30. Snapshot Patterns

Sometimes you need deterministic read.

## 30.1 Immutable map snapshot

```java
Map<K,V> snapshot = Map.copyOf(map);
```

This copies current visible mappings.

## 30.2 DTO snapshot

```java
record SnapshotEntry<K,V>(K key, V value) {}

List<SnapshotEntry<K,V>> snapshot = map.entrySet().stream()
    .map(e -> new SnapshotEntry<>(e.getKey(), e.getValue()))
    .toList();
```

## 30.3 Mutable values

Snapshot of map references does not deep-copy values.

## 30.4 Rule

Snapshot map structure separately from value immutability.

---

# 31. Per-Key Lock/State Pattern

ConcurrentHashMap can store per-key lock/state.

## 31.1 Per-key lock

```java
ConcurrentHashMap<K, Object> locks = new ConcurrentHashMap<>();

Object lock = locks.computeIfAbsent(key, k -> new Object());
synchronized (lock) {
    ...
}
```

## 31.2 Cleanup problem

Removing lock safely is hard because another thread may still use it.

## 31.3 Better abstractions

- striped locks;
- `ReentrantLock` with reference counting;
- actor per key;
- database lock;
- single-flight library pattern.

## 31.4 Rule

Per-key locks in CHM are powerful but lifecycle-sensitive.

---

# 32. ConcurrentHashMap vs Alternatives

## 32.1 `HashMap` + lock

Good for simple low-contention, multi-operation invariants.

## 32.2 `Collections.synchronizedMap`

Good for legacy simple synchronization.

## 32.3 `ConcurrentSkipListMap`

Use if sorted/range concurrent map needed.

## 32.4 immutable snapshot volatile Map

Best for read-mostly config.

## 32.5 cache library

Best for production cache with eviction/TTL/stats.

## 32.6 database

For distributed consistency.

## 32.7 Rule

Use ConcurrentHashMap for in-memory concurrent exact lookup/update, not everything.

---

# 33. Streams and ConcurrentHashMap

## 33.1 Stream over views

```java
map.entrySet().stream()
```

uses weakly consistent source semantics.

## 33.2 Parallel bulk

ConcurrentHashMap has its own bulk methods; streams also possible.

## 33.3 Determinism

If deterministic exact result needed, snapshot first.

## 33.4 Avoid side effects

Do not mutate map in stream pipeline unless carefully designed.

## 33.5 Rule

ConcurrentHashMap streams are useful for best-effort processing, not exact stable reports under mutation.

---

# 34. Performance Cost Model

## 34.1 Fast reads

ConcurrentHashMap is optimized for concurrent retrieval.

## 34.2 Updates

Updates require internal coordination.

## 34.3 Hot bins/keys

Contention reduces scalability.

## 34.4 Resizing

Resize is costly.

## 34.5 Mapping function cost

`compute` methods can serialize work per key/bin.

## 34.6 Memory

Nodes/table/counters/values consume memory.

## 34.7 Rule

CHM performance depends on key distribution, contention, value design, and workload.

---

# 35. Testing ConcurrentHashMap Code

## 35.1 Test invariants

Example:

```text
total count equals number of increments
no duplicate initialization
no lost transitions
```

## 35.2 Stress test

Run many threads and iterations.

## 35.3 Avoid sleep-based tests

Use latches/barriers.

## 35.4 Test mapping functions

Ensure no recursion, no blocking, no null surprises.

## 35.5 Test cleanup

Especially nested maps/per-key locks/caches.

## 35.6 Rule

Test the algorithm, not just that CHM methods work.

---

# 36. Production Diagnostics

## 36.1 Map size/cardinality

Unexpected growth indicates leak/cache issue.

## 36.2 Key distribution

Hot key? Many keys? Composite key correctness?

## 36.3 Value size

Large values dominate memory.

## 36.4 Allocation

LongAdder creation, immutable value copies, compute churn.

## 36.5 Contention

JFR/profiler/thread dumps.

## 36.6 Slow loaders

computeIfAbsent loader latency.

## 36.7 Iteration assumptions

Reports inconsistent? Weak iteration may be reason.

## 36.8 Rule

Diagnose CHM by size, key distribution, value mutability, contention, and lifecycle.

---

# 37. Production Failure Modes

## 37.1 Mutable ArrayList value race

Fix: concurrent value or immutable update.

## 37.2 Check-then-act duplicate initialization

Fix: computeIfAbsent/putIfAbsent.

## 37.3 Long blocking compute function

Fix: keep mapping short, use future-based loading, or a dedicated cache abstraction.

## 37.4 Unbounded cache OOM

Fix: bounded cache/eviction.

## 37.5 Weak iterator assumed snapshot

Fix: Map.copyOf or DTO snapshot.

## 37.6 Null value migration failure

Fix: explicit absence model.

## 37.7 Hot key contention

Fix: LongAdder/sharding/batching.

## 37.8 Nested map cleanup race

Fix: composite key or lifecycle lock.

## 37.9 Per-key lock leak

Fix: reference-counted lock or striped locks.

## 37.10 size used as correctness control

Fix: avoid exact size decisions under mutation.

## 37.11 compute returns null accidentally

Fix: validate mapper; remember null removes/no mapping.

## 37.12 `get` then mutate value fields unsafely

Fix: immutable/synchronized value.

## 37.13 Multi-map invariant broken

Fix: lock/transaction/single owner.

## 37.14 High memory from LongAdder counters never removed

Fix: cleanup policy.

---

# 38. Best Practices

## 38.1 Use atomic methods

Prefer:

```java
computeIfAbsent
compute
merge
putIfAbsent
replace
remove(key,value)
```

over manual sequences.

## 38.2 Keep values immutable

Or use concurrent/synchronized value types.

## 38.3 Avoid null

CHM enforces null-free keys/values.

## 38.4 Snapshot for reporting

Use `Map.copyOf` or DTO copy.

## 38.5 Monitor cardinality

Concurrent maps often become accidental caches.

## 38.6 Avoid slow compute

Mapping/remapping should be short.

## 38.7 Use LongAdder for hot counters

Avoid boxed counter churn and high contention when throughput matters.

## 38.8 Be careful with nested maps

Design cleanup and lifecycle.

## 38.9 Choose alternatives when needed

- `ConcurrentSkipListMap` for sorted/range;
- bounded cache for eviction;
- immutable snapshot for read-mostly config.

---

# 39. Decision Matrix

| Need | Recommended |
|---|---|
| concurrent exact lookup | `ConcurrentHashMap` |
| atomic lazy create | `computeIfAbsent` |
| insert if absent, value already built | `putIfAbsent` |
| update if present only | `computeIfPresent` |
| insert/update/remove based on old value | `compute` |
| accumulate | `merge` |
| high-contention counter | `ConcurrentHashMap<K, LongAdder>` |
| concurrent set | `ConcurrentHashMap.newKeySet()` |
| exact snapshot report | `Map.copyOf` / DTO snapshot |
| sorted concurrent map | `ConcurrentSkipListMap` |
| read-mostly config | volatile immutable `Map` snapshot |
| cache with eviction/TTL | cache library |
| multi-key transaction | explicit lock/transaction |
| nested mutable list value | concurrent value or immutable update |
| per-key lock | consider striped locks/lifecycle management |
| null/negative cache | explicit `CacheEntry` type |
| weak iteration acceptable | CHM views |
| exact size correctness | avoid CHM size under mutation |

---

# 40. Latihan

## Latihan 1 — Duplicate Initialization

Implement check-then-act lazy initialization with `get` + `put`.

Run with many threads.

Refactor to `computeIfAbsent`.

## Latihan 2 — Frequency Map

Build word frequency counter using:

```java
ConcurrentHashMap<String, LongAdder>
```

Compare with `merge(word, 1, Integer::sum)`.

## Latihan 3 — Mutable Value Race

Create:

```java
ConcurrentHashMap<String, ArrayList<Integer>>
```

Update list from many threads.

Refactor safely.

## Latihan 4 — Weak Iterator

Iterate keySet while adding/removing keys.

Explain why result is not exact snapshot.

## Latihan 5 — Snapshot Report

Create stable report using DTO snapshot.

## Latihan 6 — Negative Cache

Design cache value type:

```java
sealed interface LookupResult permits Found, NotFound, Failed {}
```

instead of storing null.

## Latihan 7 — Nested Map Cleanup

Implement nested CHM and explain cleanup race.

Try composite key alternative.

## Latihan 8 — Per-Key Lock

Implement per-key lock map and discuss leak/removal problem.

## Latihan 9 — Slow computeIfAbsent

Simulate slow loader. Observe contention for same key.

Design alternative using `CompletableFuture` value.

## Latihan 10 — Cache Growth

Create CHM cache with random keys and no eviction.

Monitor size and memory.

---

# 41. Ringkasan

`ConcurrentHashMap` is one of Java's most important concurrent data structures.

Core lessons:

- It is not just synchronized HashMap.
- It implements ConcurrentMap with atomic operations.
- It rejects null keys and values.
- Null-free design makes `get == null` mean absent.
- It gives safe concurrent map operations, not full algorithm safety.
- Atomic methods prevent check-then-act and read-modify-write races.
- `computeIfAbsent` is for lazy per-key creation.
- `compute` is for full per-key state transitions.
- `merge` is for accumulation.
- `LongAdder` pattern is excellent for high-throughput counters.
- Iterators/views are weakly consistent, not snapshots.
- Mutable values inside CHM remain dangerous.
- Hot keys reduce scalability.
- It is not a cache policy by itself.
- Snapshot if you need deterministic reporting.
- Monitor size, contention, loader latency, and value mutability.

Main rule:

```text
ConcurrentHashMap makes individual map operations safe and scalable.
You still own value safety, lifecycle, invariants, and business-level atomicity.
```

---

# 42. Referensi

1. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

2. Java SE 25 — `ConcurrentMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentMap.html

3. Java SE 25 — `ConcurrentHashMap.KeySetView`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.KeySetView.html

4. Java SE 25 — `LongAdder`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html

5. Java SE 25 — `ConcurrentSkipListMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentSkipListMap.html

6. Java SE 25 — `java.util.concurrent` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/package-summary.html

7. OpenJDK — `ConcurrentHashMap.java` Source  
   https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/concurrent/ConcurrentHashMap.java

8. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

9. Java SE 25 — `HashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html

10. Java SE 25 — `ConcurrentModificationException`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ConcurrentModificationException.html

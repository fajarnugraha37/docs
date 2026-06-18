# learn-java-collections-and-streams-part-022.md

# Java Collections and Streams — Part 022  
# CopyOnWrite and Snapshot Collections: CopyOnWriteArrayList, CopyOnWriteArraySet, Immutable Snapshots, Listener Lists, Read-Mostly Concurrency, Publication Patterns, and Production Pitfalls

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **022**  
> Fokus: memahami copy-on-write dan snapshot collections sebagai pattern untuk **read-mostly concurrent access**: kapan `CopyOnWriteArrayList`/`CopyOnWriteArraySet` sangat tepat, kapan sangat mahal, bagaimana snapshot iterator bekerja, bagaimana membedakannya dari unmodifiable view dan immutable snapshot, serta bagaimana mendesain listener registry/config snapshot yang production-safe.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Copy on Write = Read Stable, Write Expensive](#2-mental-model-copy-on-write--read-stable-write-expensive)
3. [Masalah yang Diselesaikan Copy-On-Write](#3-masalah-yang-diselesaikan-copy-on-write)
4. [Masalah yang Tidak Diselesaikan Copy-On-Write](#4-masalah-yang-tidak-diselesaikan-copy-on-write)
5. [`CopyOnWriteArrayList`](#5-copyonwritearraylist)
6. [`CopyOnWriteArraySet`](#6-copyonwritearrayset)
7. [Snapshot Iterator](#7-snapshot-iterator)
8. [Why Iterator Does Not Support Mutation](#8-why-iterator-does-not-support-mutation)
9. [Copy-On-Write Write Path](#9-copy-on-write-write-path)
10. [Read Path Cost](#10-read-path-cost)
11. [Write Path Cost](#11-write-path-cost)
12. [Listener List Pattern](#12-listener-list-pattern)
13. [Observer/Event Callback Pattern](#13-observerevent-callback-pattern)
14. [Read-Mostly Config Snapshot Pattern](#14-read-mostly-config-snapshot-pattern)
15. [Immutable Snapshot with `List.copyOf`](#15-immutable-snapshot-with-listcopyof)
16. [Unmodifiable View vs Immutable Snapshot vs Copy-On-Write](#16-unmodifiable-view-vs-immutable-snapshot-vs-copy-on-write)
17. [Volatile Snapshot Pattern](#17-volatile-snapshot-pattern)
18. [AtomicReference Snapshot Pattern](#18-atomicreference-snapshot-pattern)
19. [Copy-On-Write vs Synchronized List](#19-copy-on-write-vs-synchronized-list)
20. [Copy-On-Write vs ConcurrentLinkedQueue](#20-copy-on-write-vs-concurrentlinkedqueue)
21. [Copy-On-Write vs ConcurrentHashMap.newKeySet](#21-copy-on-write-vs-concurrenthashmapnewkeyset)
22. [Copy-On-Write vs Immutable Collections](#22-copy-on-write-vs-immutable-collections)
23. [Element Mutability Hazard](#23-element-mutability-hazard)
24. [Memory and GC Cost](#24-memory-and-gc-cost)
25. [Latency Spikes on Writes](#25-latency-spikes-on-writes)
26. [Large Collections Warning](#26-large-collections-warning)
27. [Streams and Copy-On-Write Collections](#27-streams-and-copy-on-write-collections)
28. [API and Domain Boundaries](#28-api-and-domain-boundaries)
29. [Concurrency Semantics](#29-concurrency-semantics)
30. [Common Anti-Patterns](#30-common-anti-patterns)
31. [Production Diagnostics](#31-production-diagnostics)
32. [Production Failure Modes](#32-production-failure-modes)
33. [Best Practices](#33-best-practices)
34. [Decision Matrix](#34-decision-matrix)
35. [Latihan](#35-latihan)
36. [Ringkasan](#36-ringkasan)
37. [Referensi](#37-referensi)

---

# 1. Tujuan Bagian Ini

Dalam concurrency, ada banyak situasi di mana:

```text
read/traversal sangat sering
write/update sangat jarang
```

Contoh:

- listener list;
- callback registry;
- plugin registry;
- read-mostly configuration;
- routing rules yang di-reload jarang;
- feature flag snapshot;
- validators/handlers list;
- interceptors;
- event subscribers.

Untuk pattern seperti ini, locking setiap traversal bisa mahal atau rawan deadlock/reentrancy.

Java menyediakan:

```java
CopyOnWriteArrayList
CopyOnWriteArraySet
```

Mereka menggunakan strategi:

```text
read from stable array snapshot
write by copying entire array
```

Tujuan bagian ini:

- memahami copy-on-write mental model;
- memahami snapshot iterator;
- memahami write cost;
- memahami kapan cocok/tidak;
- memahami alternatif snapshot publishing;
- memahami production failure modes.

---

# 2. Mental Model: Copy on Write = Read Stable, Write Expensive

Copy-on-write berarti:

```text
read reads current array
write creates new array copy with modification
then publishes new array
```

Simplified:

```text
current array: [A, B, C]

add(D):
  new array: [A, B, C, D]
  publish new array
```

Readers already holding old array continue seeing:

```text
[A, B, C]
```

New readers see:

```text
[A, B, C, D]
```

## 2.1 Big idea

Reads do not need to coordinate with writes by locking traversal.

Writes pay O(n) copy cost.

## 2.2 Good workload

```text
99.9% read/traverse
0.1% write
small-to-medium collection
```

## 2.3 Bad workload

```text
frequent writes
large collection
high mutation rate
```

## 2.4 Rule

```text
Copy-on-write optimizes reader simplicity by making writers pay.
```

---

# 3. Masalah yang Diselesaikan Copy-On-Write

## 3.1 Concurrent traversal without lock

You can iterate safely while another thread adds/removes elements.

## 3.2 No ConcurrentModificationException

Snapshot iterator does not fail-fast.

## 3.3 Stable callback invocation

Listener list can be traversed without being affected by listener registration/unregistration during callback.

## 3.4 Simple mental model

Each traversal sees stable array state.

## 3.5 Safe publication of array reference

New array is published safely by implementation.

## 3.6 Rule

Copy-on-write solves read-mostly concurrent traversal.

---

# 4. Masalah yang Tidak Diselesaikan Copy-On-Write

## 4.1 Frequent mutation

Every mutation copies array.

## 4.2 Large collection writes

Large array copy causes allocation and latency.

## 4.3 Mutable element internals

If elements are mutable, copy-on-write does not freeze them.

## 4.4 Compound business invariant

It does not make multi-step business workflow atomic beyond collection operation.

## 4.5 Freshness guarantee for existing iterator

Iterator sees old snapshot. That is feature, not bug.

## 4.6 Rule

Copy-on-write protects collection structure, not element state or business invariant.

---

# 5. `CopyOnWriteArrayList`

`CopyOnWriteArrayList` is a thread-safe variant of `ArrayList` where mutative operations make a fresh copy of the underlying array.

## 5.1 Suitable when

Traversal operations vastly outnumber mutations.

## 5.2 Supports null?

It permits all elements allowed by list semantics, including null. Still avoid null in domain lists.

## 5.3 Ordering

Maintains list order.

## 5.4 Iterator

Snapshot-style iterator.

## 5.5 Mutation methods

`add`, `set`, `remove`, and similar operations copy the array.

## 5.6 Rule

Use CopyOnWriteArrayList for read-mostly ordered concurrent lists.

---

# 6. `CopyOnWriteArraySet`

`CopyOnWriteArraySet` is a Set backed by CopyOnWriteArrayList.

## 6.1 Suitable when

- small set;
- read-mostly;
- unique listeners/subscribers;
- iteration stability matters.

## 6.2 Contains/add cost

Because array-backed set must check duplicates, add/contains are linear.

## 6.3 Ordering

Iteration order follows underlying list order of insertion.

## 6.4 Write cost

Writes copy underlying array.

## 6.5 Rule

Use CopyOnWriteArraySet for small read-mostly unique collections.

---

# 7. Snapshot Iterator

Snapshot iterator sees array state at iterator creation.

## 7.1 Example

```java
CopyOnWriteArrayList<String> list = new CopyOnWriteArrayList<>();
list.add("A");
list.add("B");

Iterator<String> it = list.iterator();

list.add("C");

while (it.hasNext()) {
    System.out.println(it.next());
}
```

Output from iterator:

```text
A
B
```

The iterator does not see C.

## 7.2 Why useful

Traversal is stable even if collection changes.

## 7.3 No CME

Concurrent modifications do not throw `ConcurrentModificationException`.

## 7.4 Rule

Snapshot iterator favors stable traversal over latest view.

---

# 8. Why Iterator Does Not Support Mutation

Snapshot iterator is not attached to live mutable collection state.

## 8.1 Unsupported operations

Iterator mutation methods like:

```java
remove
set
add
```

are not supported.

## 8.2 Why

The iterator sees old array.

Removing from old snapshot would not map cleanly to current array.

## 8.3 Correct mutation

Mutate collection directly:

```java
list.remove(element);
```

not through iterator.

## 8.4 Rule

Snapshot iterator is for reading, not modifying.

---

# 9. Copy-On-Write Write Path

A mutation conceptually:

1. lock or coordinate writer;
2. read current array;
3. copy array with change;
4. publish new array reference;
5. old readers continue with old array.

## 9.1 Add example

```text
old: [A, B]
add C
new: [A, B, C]
```

## 9.2 Remove example

```text
old: [A, B, C]
remove B
new: [A, C]
```

## 9.3 Set example

```text
old: [A, B]
set index 1 = X
new: [A, X]
```

## 9.4 Rule

Every structural write allocates/copies.

---

# 10. Read Path Cost

Reads are simple.

## 10.1 get

Index lookup reads from current array.

## 10.2 iteration

Iterator holds array reference.

## 10.3 contains

Still linear search.

## 10.4 no lock for traversal

This is the main benefit.

## 10.5 Rule

CopyOnWrite reads are excellent for traversal-heavy workloads.

---

# 11. Write Path Cost

Writes are expensive.

## 11.1 O(n) copy

Every write copies array.

## 11.2 Allocation

New array allocation per mutation.

## 11.3 GC

Old arrays remain alive while iterators/reference holders still use them.

## 11.4 Large list

Writing to list with 100_000 elements copies 100_000 references.

## 11.5 Rule

CopyOnWrite writes are intentionally expensive.

---

# 12. Listener List Pattern

The classic use case.

## 12.1 Example

```java
final class EventBus {
    private final CopyOnWriteArrayList<Listener> listeners =
        new CopyOnWriteArrayList<>();

    void register(Listener listener) {
        listeners.add(Objects.requireNonNull(listener));
    }

    void unregister(Listener listener) {
        listeners.remove(listener);
    }

    void publish(Event event) {
        for (Listener listener : listeners) {
            listener.onEvent(event);
        }
    }
}
```

## 12.2 Why good

- publishing events reads/traverses frequently;
- registration/unregistration rare;
- listener added during publish does not affect current publish;
- listener removed during publish may still receive current event if snapshot contains it.

## 12.3 This is acceptable if documented

Callback semantics should say:

```text
Registration changes affect future publications, not necessarily current in-flight publication.
```

## 12.4 Rule

CopyOnWriteArrayList is ideal for listener registries with rare mutation.

---

# 13. Observer/Event Callback Pattern

Copy-on-write avoids lock while invoking callbacks.

## 13.1 Why avoid lock during callback

If you lock listener list and call external code while holding lock, listener callback can:

- re-enter registration;
- cause deadlock;
- block other threads;
- call slow IO.

## 13.2 Copy-on-write helps

Traversal is safe without holding collection lock.

## 13.3 Still handle listener exceptions

One bad listener should not necessarily stop all.

```java
for (Listener listener : listeners) {
    try {
        listener.onEvent(event);
    } catch (RuntimeException ex) {
        log.warn("listener failed", ex);
    }
}
```

## 13.4 Rule

Do not hold locks while calling external listener code.

---

# 14. Read-Mostly Config Snapshot Pattern

Sometimes `CopyOnWriteArrayList` is not necessary.

For config reloaded rarely, use immutable snapshot.

## 14.1 Example

```java
final class RuleRegistry {
    private volatile List<Rule> rules = List.of();

    void reload(List<Rule> newRules) {
        rules = List.copyOf(newRules);
    }

    List<Rule> currentRules() {
        return rules;
    }
}
```

## 14.2 Why good

- reads are simple volatile read;
- reload copies once;
- immutable list prevents mutation;
- no per-add copy if reload builds list elsewhere.

## 14.3 Difference from COW list

COW list is good for individual concurrent adds/removes.

Volatile snapshot is good for whole-list replacement.

## 14.4 Rule

For bulk reload config, prefer immutable volatile snapshot over CopyOnWriteArrayList.

---

# 15. Immutable Snapshot with `List.copyOf`

`List.copyOf` creates unmodifiable list snapshot.

## 15.1 Boundary copy

```java
this.rules = List.copyOf(rules);
```

## 15.2 Null rejection

Rejects null elements.

## 15.3 Shallow immutability

The list cannot change, but element objects may be mutable.

## 15.4 Good for publishing

```java
volatile List<Rule> rules = List.of();
rules = List.copyOf(newRules);
```

## 15.5 Rule

Use `copyOf` for immutable snapshot boundaries.

---

# 16. Unmodifiable View vs Immutable Snapshot vs Copy-On-Write

These are different.

## 16.1 Unmodifiable view

```java
List<T> view = Collections.unmodifiableList(mutableList);
```

- cannot mutate through view;
- backing list can still mutate;
- view reflects backing changes.

## 16.2 Immutable snapshot

```java
List<T> snapshot = List.copyOf(mutableList);
```

- independent list;
- unmodifiable;
- does not reflect later backing changes.

## 16.3 Copy-on-write collection

```java
CopyOnWriteArrayList<T> cow = new CopyOnWriteArrayList<>();
```

- mutable collection;
- thread-safe;
- each write copies array;
- iterators are snapshots.

## 16.4 Rule

Do not confuse read-only view, immutable snapshot, and copy-on-write mutable collection.

---

# 17. Volatile Snapshot Pattern

Use volatile reference to immutable collection.

## 17.1 Example

```java
final class HandlerRegistry {
    private volatile List<Handler> handlers = List.of();

    void reload(Collection<Handler> newHandlers) {
        handlers = List.copyOf(newHandlers);
    }

    void handle(Request request) {
        for (Handler handler : handlers) {
            handler.handle(request);
        }
    }
}
```

## 17.2 Benefit

No write amplification for individual add/remove if updates are batch.

## 17.3 Limitation

If you need atomic add/remove from many threads, use COW list or explicit lock.

## 17.4 Rule

Volatile immutable snapshot is excellent for reload-style read-mostly data.

---

# 18. AtomicReference Snapshot Pattern

If updates are compare-and-set based:

```java
AtomicReference<List<Rule>> rulesRef =
    new AtomicReference<>(List.of());
```

## 18.1 Update loop

```java
void addRule(Rule rule) {
    while (true) {
        List<Rule> oldRules = rulesRef.get();
        ArrayList<Rule> next = new ArrayList<>(oldRules);
        next.add(rule);
        List<Rule> snapshot = List.copyOf(next);
        if (rulesRef.compareAndSet(oldRules, snapshot)) {
            return;
        }
    }
}
```

## 18.2 Similarity

This is manual copy-on-write.

## 18.3 Use case

When you need explicit CAS semantics or custom snapshot type.

## 18.4 Rule

AtomicReference snapshot is custom copy-on-write with explicit update policy.

---

# 19. Copy-On-Write vs Synchronized List

## 19.1 Synchronized list

```java
List<T> list = Collections.synchronizedList(new ArrayList<>());
```

- each method synchronized;
- iteration requires manual synchronization;
- writes cheap relative to COW;
- reads contend on lock.

## 19.2 CopyOnWriteArrayList

- traversal does not need external synchronization;
- writes copy array;
- snapshot iterator.

## 19.3 Choose synchronized list when

- writes are frequent;
- collection small;
- coarse lock acceptable;
- you need locked compound operations.

## 19.4 Choose COW when

- reads/traversals dominate;
- writes are rare;
- stable iteration matters.

## 19.5 Rule

Synchronized list makes readers and writers coordinate; COW lets readers avoid writer coordination at cost of writes.

---

# 20. Copy-On-Write vs ConcurrentLinkedQueue

## 20.1 ConcurrentLinkedQueue

Good for producer-consumer FIFO.

## 20.2 CopyOnWriteArrayList

Good for stable repeated traversal of registered elements.

## 20.3 Bad substitution

Do not use COW list as high-throughput queue.

Do not use queue as listener registry if you need repeated traversal over all listeners.

## 20.4 Rule

Queue is for handoff; COW list is for read-mostly registry traversal.

---

# 21. Copy-On-Write vs ConcurrentHashMap.newKeySet

## 21.1 Concurrent key set

```java
Set<T> set = ConcurrentHashMap.newKeySet();
```

Good for concurrent membership updates.

## 21.2 CopyOnWriteArraySet

Good for small read-mostly sets.

## 21.3 Difference

CHM set:

- better for frequent add/remove/contains;
- weakly consistent iteration;
- no stable snapshot iterator.

COW set:

- writes copy;
- snapshot iteration.

## 21.4 Rule

Use CHM key set for write-heavy membership; COW set for read-mostly stable traversal.

---

# 22. Copy-On-Write vs Immutable Collections

## 22.1 Immutable collection

Cannot be mutated.

Good for snapshot publishing.

## 22.2 Copy-on-write collection

Mutable API; internally replaces array on write.

Good for concurrent incremental mutation.

## 22.3 Example

Use immutable snapshot for config reload.

Use CopyOnWriteArrayList for listener registration.

## 22.4 Rule

Immutable snapshot is for replacement; COW is for safe incremental mutation.

---

# 23. Element Mutability Hazard

Copy-on-write copies array references, not objects.

## 23.1 Example

```java
CopyOnWriteArrayList<MutableConfig> configs = new CopyOnWriteArrayList<>();
```

If a `MutableConfig` object is mutated, all snapshots referencing it see mutation.

## 23.2 Copy-on-write is shallow

Array changes are copied.

Element internals are not.

## 23.3 Fix

Use immutable elements.

```java
record Config(String name, int timeout) {}
```

## 23.4 Rule

Copy-on-write protects collection structure, not element state.

---

# 24. Memory and GC Cost

## 24.1 Write allocation

Each write allocates new array.

## 24.2 Old arrays retained

Old arrays remain reachable by existing iterators.

## 24.3 Write burst

Many writes create many arrays.

## 24.4 Large elements?

Array copies references, not deep elements, but arrays themselves can be large.

## 24.5 Rule

Frequent COW writes create allocation and GC pressure.

---

# 25. Latency Spikes on Writes

A write to large COW list copies all references.

## 25.1 Example

```text
list size = 100_000
add one listener -> copy 100_000 references
```

## 25.2 Impact

- request latency spike;
- allocation spike;
- GC pressure.

## 25.3 Mitigation

- keep COW lists small;
- batch updates via immutable snapshot;
- use different concurrent collection;
- synchronize around mutable array/list if write-heavy.

## 25.4 Rule

COW write latency is proportional to collection size.

---

# 26. Large Collections Warning

Copy-on-write is not for large dynamic collections.

## 26.1 Bad signs

- thousands/millions of elements;
- frequent add/remove;
- write burst;
- memory-sensitive service.

## 26.2 Alternative

- ConcurrentHashMap;
- ConcurrentLinkedQueue;
- synchronized list;
- immutable snapshot reload;
- ReadWriteLock protected list;
- domain-specific registry.

## 26.3 Rule

COW is usually for small-to-moderate read-mostly collections.

---

# 27. Streams and Copy-On-Write Collections

## 27.1 Stream source

A stream from COW list operates over snapshot-like array semantics.

## 27.2 Concurrent mutation

Mutations after stream creation may not appear in pipeline.

## 27.3 Deterministic traversal

Good if you want stable traversal.

## 27.4 But element mutability remains

Stream sees same element references.

## 27.5 Rule

COW streams are stable structurally, shallow in element state.

---

# 28. API and Domain Boundaries

## 28.1 Do not expose COW type unnecessarily

Prefer:

```java
List<Listener>
```

or methods:

```java
register(listener)
unregister(listener)
```

## 28.2 Return snapshot

```java
List<Listener> listeners() {
    return List.copyOf(listeners);
}
```

## 28.3 Domain object fields

Do not use COW collection inside immutable domain object unless concurrency mutation is truly part of domain.

## 28.4 Rule

Keep concurrency collection as infrastructure detail.

---

# 29. Concurrency Semantics

## 29.1 Thread-safe structure

COW list/set methods are thread-safe.

## 29.2 Snapshot iteration

Iteration state is isolated from later structural changes.

## 29.3 Visibility

Publishing new array makes new state visible to later readers.

## 29.4 Compound operations

Some methods like `addIfAbsent` exist to avoid duplicate race.

## 29.5 Rule

Use built-in atomic-ish methods when available; do not manually check-then-add.

---

# 30. Common Anti-Patterns

## 30.1 CopyOnWriteArrayList for high-frequency writes

Bad.

## 30.2 CopyOnWriteArrayList as queue

Bad.

## 30.3 Large COW list with many mutations

Bad.

## 30.4 Mutable elements assumed frozen

Bad.

## 30.5 Expecting iterator to see latest writes

Bad.

## 30.6 Exposing mutable COW collection publicly

Bad API design.

## 30.7 Using COW because “thread-safe” without workload analysis

Bad.

## 30.8 Rule

Copy-on-write is specialized, not general-purpose concurrency solution.

---

# 31. Production Diagnostics

Check:

## 31.1 Write frequency

How often add/remove/set?

## 31.2 Collection size

How large is array copied?

## 31.3 Allocation

Look for many object arrays.

## 31.4 GC

Write bursts can increase GC.

## 31.5 Latency

Correlate writes with spikes.

## 31.6 Iterator retention

Long-lived iterators can retain old arrays.

## 31.7 Rule

COW problems show up as allocation and write latency.

---

# 32. Production Failure Modes

## 32.1 Listener added during event expects current event

But current iterator snapshot does not include it.

Fix: document semantics.

## 32.2 Listener removed during event still called

If snapshot contains it.

Fix: document or add active flag inside listener registration.

## 32.3 Write storm causes GC spike

Fix: use different collection or batch snapshot.

## 32.4 Large list add latency

Fix: avoid COW for large mutable lists.

## 32.5 Mutable element race

Fix: immutable elements.

## 32.6 Iterator remove unsupported

Fix: mutate collection directly.

## 32.7 Public COW list mutated externally

Fix: encapsulate.

## 32.8 Add-if-absent race using contains + add

Fix: use `addIfAbsent` or COW set.

## 32.9 Snapshot stale report

Fix: if latest is required, create new snapshot at report time.

## 32.10 Rule

Most COW bugs come from wrong freshness/write-cost assumptions.

---

# 33. Best Practices

## 33.1 Use COW for

- listener lists;
- callback registries;
- read-mostly small lists/sets;
- stable iteration under concurrent mutation;
- observer pattern.

## 33.2 Avoid COW for

- write-heavy workloads;
- queues;
- large dynamic collections;
- mutable element state;
- high-frequency add/remove.

## 33.3 Prefer immutable snapshots for

- config reload;
- routing rules;
- bulk replacement;
- read-mostly data with batch updates.

## 33.4 API

- encapsulate COW collection;
- expose register/unregister methods;
- document in-flight callback semantics;
- return snapshots, not live COW collection.

## 33.5 Monitoring

- watch write frequency;
- array allocation;
- GC;
- listener count;
- callback latency.

---

# 34. Decision Matrix

| Requirement | Recommended |
|---|---|
| listener list, rare registration | `CopyOnWriteArrayList` |
| unique listener set, rare mutation | `CopyOnWriteArraySet` |
| frequent concurrent membership update | `ConcurrentHashMap.newKeySet()` |
| producer-consumer handoff | `BlockingQueue` / `ConcurrentLinkedQueue` |
| read-mostly config replaced in bulk | volatile `List.copyOf` snapshot |
| exact immutable API return | `List.copyOf` |
| read-only view over mutable list | `Collections.unmodifiableList` |
| write-heavy list with lock acceptable | synchronized list / explicit lock |
| sorted concurrent data | `ConcurrentSkipListMap/Set` |
| mutable element state | immutable elements or explicit synchronization |
| huge list with writes | avoid copy-on-write |
| iterator must see stable old state | copy-on-write or snapshot copy |
| iterator must see latest state | do not rely on snapshot iterator |

---

# 35. Latihan

## Latihan 1 — Snapshot Iterator

Create `CopyOnWriteArrayList`, get iterator, then add element.

Verify iterator does not see new element.

## Latihan 2 — Listener Registry

Implement event bus using `CopyOnWriteArrayList`.

Document add/remove during publish semantics.

## Latihan 3 — Write Cost

Measure add latency for COW list sizes:

```text
10
1_000
100_000
```

## Latihan 4 — Mutable Element Hazard

Store mutable object in COW list and mutate field.

Explain why old snapshots see changed object.

## Latihan 5 — Config Snapshot

Implement volatile `List<Rule>` with `List.copyOf` reload.

Compare with COW list.

## Latihan 6 — Add If Absent

Demonstrate race with contains+add.

Fix with `addIfAbsent` or `CopyOnWriteArraySet`.

## Latihan 7 — Unmodifiable View vs Snapshot

Create mutable list, unmodifiable view, and `List.copyOf` snapshot.

Mutate original and compare behavior.

## Latihan 8 — Queue Misuse

Explain why COW list is bad for high-throughput producer-consumer queue.

## Latihan 9 — Public API

Refactor class exposing public COW list into encapsulated register/unregister API.

## Latihan 10 — Diagnostics

Given heap with many old Object[] arrays retained by iterators, explain possible COW cause.

---

# 36. Ringkasan

Copy-on-write and snapshot patterns are powerful when used narrowly.

Core lessons:

- Copy-on-write makes reads/traversals stable and writes expensive.
- `CopyOnWriteArrayList` copies underlying array on mutation.
- Snapshot iterator sees array state at iterator creation.
- Snapshot iterator does not support mutation.
- COW is excellent for listener/callback registries.
- COW is bad for write-heavy or large dynamic collections.
- `CopyOnWriteArraySet` is for small read-mostly unique sets.
- COW protects collection structure, not mutable element state.
- Unmodifiable view is not immutable snapshot.
- `List.copyOf` is good for immutable snapshot publishing.
- Volatile immutable snapshot is often better for config reload.
- COW write cost creates allocation and GC pressure.
- Document callback freshness semantics.
- Encapsulate COW collections as infrastructure detail.

Main rule:

```text
Use copy-on-write when stale-but-stable traversal is acceptable and writes are rare.
Use immutable snapshots when data is replaced in bulk.
Use other concurrent collections when mutation is frequent.
```

---

# 37. Referensi

1. Java SE 25 — `CopyOnWriteArrayList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html

2. Java SE 25 — `CopyOnWriteArraySet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArraySet.html

3. Java SE 25 — `java.util.concurrent` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/package-summary.html

4. Java SE 25 — `Collections`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html

5. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

6. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

7. Java SE 25 — `ConcurrentLinkedQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentLinkedQueue.html

8. OpenJDK — `CopyOnWriteArrayList.java` Source  
   https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/concurrent/CopyOnWriteArrayList.java

9. OpenJDK — `CopyOnWriteArraySet.java` Source  
   https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/concurrent/CopyOnWriteArraySet.java

10. Java SE 25 — `AtomicReference`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicReference.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-021.md](./learn-java-collections-and-streams-part-021.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-023.md](./learn-java-collections-and-streams-part-023.md)

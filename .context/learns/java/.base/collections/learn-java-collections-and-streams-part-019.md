# learn-java-collections-and-streams-part-019.md

# Java Collections and Streams — Part 019  
# Concurrent Collections Overview: Thread Safety, Synchronized Wrappers, ConcurrentHashMap, BlockingQueue, ConcurrentLinkedQueue, CopyOnWriteArrayList, Weakly Consistent Iterators, and Memory Visibility

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **019**  
> Fokus: memahami concurrent collections sebagai **coordination and visibility tools**, bukan sekadar “collection yang thread-safe”. Kita akan membedah thread-safety, synchronized wrappers, `ConcurrentHashMap`, blocking/non-blocking queues, copy-on-write collections, weakly consistent iterators, snapshot iterators, memory consistency effects, compound actions, atomic methods, backpressure, contention, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Concurrent Collection adalah Coordination Contract](#2-mental-model-concurrent-collection-adalah-coordination-contract)
3. [Masalah yang Diselesaikan Concurrent Collections](#3-masalah-yang-diselesaikan-concurrent-collections)
4. [Masalah yang Tidak Diselesaikan Concurrent Collections](#4-masalah-yang-tidak-diselesaikan-concurrent-collections)
5. [Thread Safety Vocabulary](#5-thread-safety-vocabulary)
6. [Visibility, Atomicity, Ordering](#6-visibility-atomicity-ordering)
7. [Fail-Fast vs Weakly Consistent vs Snapshot Iteration](#7-fail-fast-vs-weakly-consistent-vs-snapshot-iteration)
8. [`Collections.synchronized*` Wrappers](#8-collectionssynchronized-wrappers)
9. [Synchronized Wrapper Limitations](#9-synchronized-wrapper-limitations)
10. [`ConcurrentHashMap` Overview](#10-concurrenthashmap-overview)
11. [ConcurrentHashMap Atomic Operations](#11-concurrenthashmap-atomic-operations)
12. [`LongAdder` Frequency Map Pattern](#12-longadder-frequency-map-pattern)
13. [`ConcurrentHashMap` Null Policy](#13-concurrenthashmap-null-policy)
14. [`ConcurrentSkipListMap` and `ConcurrentSkipListSet`](#14-concurrentskiplistmap-and-concurrentskiplistset)
15. [Non-Blocking Queues](#15-non-blocking-queues)
16. [`ConcurrentLinkedQueue`](#16-concurrentlinkedqueue)
17. [Blocking Queues](#17-blocking-queues)
18. [`ArrayBlockingQueue`](#18-arrayblockingqueue)
19. [`LinkedBlockingQueue`](#19-linkedblockingqueue)
20. [`PriorityBlockingQueue`](#20-priorityblockingqueue)
21. [`DelayQueue`](#21-delayqueue)
22. [`SynchronousQueue`](#22-synchronousqueue)
23. [`LinkedTransferQueue`](#23-linkedtransferqueue)
24. [Copy-On-Write Collections](#24-copy-on-write-collections)
25. [`CopyOnWriteArrayList`](#25-copyonwritearraylist)
26. [`CopyOnWriteArraySet`](#26-copyonwritearrayset)
27. [Concurrent Collections and Streams](#27-concurrent-collections-and-streams)
28. [Compound Actions and Race Conditions](#28-compound-actions-and-race-conditions)
29. [Check-Then-Act Pitfall](#29-check-then-act-pitfall)
30. [Read-Modify-Write Pitfall](#30-read-modify-write-pitfall)
31. [Mutable Values Inside Concurrent Collections](#31-mutable-values-inside-concurrent-collections)
32. [Backpressure and Capacity](#32-backpressure-and-capacity)
33. [Choosing by Concurrency Pattern](#33-choosing-by-concurrency-pattern)
34. [Performance Cost Model](#34-performance-cost-model)
35. [Memory Consistency Effects](#35-memory-consistency-effects)
36. [Testing Concurrent Collections](#36-testing-concurrent-collections)
37. [Production Diagnostics](#37-production-diagnostics)
38. [Production Failure Modes](#38-production-failure-modes)
39. [Best Practices](#39-best-practices)
40. [Decision Matrix](#40-decision-matrix)
41. [Latihan](#41-latihan)
42. [Ringkasan](#42-ringkasan)
43. [Referensi](#43-referensi)

---

# 1. Tujuan Bagian Ini

Collections biasa seperti:

```java
ArrayList
HashMap
HashSet
TreeMap
ArrayDeque
```

umumnya tidak aman untuk concurrent mutation.

Jika beberapa thread melakukan:

```java
map.put(...)
map.get(...)
list.add(...)
queue.poll(...)
```

secara bersamaan tanpa coordination, masalah bisa muncul:

- lost update;
- stale read;
- data race;
- inconsistent internal state;
- `ConcurrentModificationException`;
- visibility bug;
- unbounded memory growth;
- race in check-then-act;
- queue overload tanpa backpressure.

Java menyediakan `java.util.concurrent` collections untuk pattern tertentu:

```java
ConcurrentHashMap
ConcurrentSkipListMap
ConcurrentLinkedQueue
BlockingQueue
ArrayBlockingQueue
LinkedBlockingQueue
PriorityBlockingQueue
DelayQueue
SynchronousQueue
CopyOnWriteArrayList
CopyOnWriteArraySet
```

Tujuan part ini:

- memahami kategori concurrent collections;
- memahami guarantee dan limitation;
- memahami iteration semantics;
- memahami atomic methods;
- memahami compound action pitfalls;
- memahami backpressure;
- memilih collection berdasarkan concurrency pattern.

---

# 2. Mental Model: Concurrent Collection adalah Coordination Contract

Concurrent collection bukan sekadar:

```text
collection yang tidak crash kalau dipakai banyak thread
```

Concurrent collection adalah contract tentang:

```text
apa yang atomic?
apa yang visible?
apa yang boleh berubah saat iteration?
apakah operasi blocking?
apakah ada capacity?
apakah ada ordering?
apakah traversal exact/snapshot/weakly consistent?
apakah compound action aman?
```

## 2.1 Example

```java
ConcurrentHashMap<K,V>
```

menyediakan concurrent get/put/update.

Tetapi jika value-nya:

```java
ArrayList<V>
```

maka nested list tidak otomatis thread-safe.

## 2.2 Example

```java
BlockingQueue<Job>
```

bukan hanya queue thread-safe.

Ia juga coordination tool antara producer dan consumer.

## 2.3 Example

```java
CopyOnWriteArrayList<Listener>
```

bukan general concurrent list.

Ia cocok ketika traversal/read jauh lebih banyak daripada write.

## 2.4 Main rule

```text
Concurrent collection solves a specific concurrency pattern, not all concurrency problems.
```

---

# 3. Masalah yang Diselesaikan Concurrent Collections

## 3.1 Safe concurrent access

Multiple threads can access collection without external lock for supported operations.

## 3.2 Memory visibility

Concurrent collection methods establish useful happens-before relations for inserted/retrieved elements depending collection contract.

## 3.3 Atomic single operations

Examples:

```java
putIfAbsent
computeIfAbsent
replace
remove(key, value)
offer
poll
take
put
```

## 3.4 Scalable access

Some concurrent collections avoid one global lock.

## 3.5 Producer-consumer coordination

BlockingQueue supports waiting when empty/full.

## 3.6 Concurrent iteration

Weakly consistent or snapshot iterators avoid fail-fast behavior.

## 3.7 Rule

Concurrent collections provide safe building blocks for shared state.

---

# 4. Masalah yang Tidak Diselesaikan Concurrent Collections

## 4.1 Business-level transaction

```java
if user has quota, decrement quota and add job
```

May require higher-level lock/transaction.

## 4.2 Multi-collection invariant

Keeping two maps consistent requires coordination.

```java
byId
byEmail
```

Concurrent maps individually safe, combined invariant not automatic.

## 4.3 Mutable value safety

```java
ConcurrentHashMap<K, List<V>>
```

Map safe, list not.

## 4.4 Atomic iteration snapshot

Weakly consistent iteration is not exact snapshot.

## 4.5 Capacity policy for maps

ConcurrentHashMap does not provide eviction/TTL.

## 4.6 Fair scheduling

Not all queues are fair by default; fairness may have throughput cost.

## 4.7 Rule

Thread-safe data structure does not automatically make your algorithm thread-safe.

---

# 5. Thread Safety Vocabulary

## 5.1 Thread-safe

Object can be used by multiple threads according to its contract without corrupting state.

## 5.2 Atomic

Operation appears indivisible.

Example:

```java
putIfAbsent
```

## 5.3 Linearizable

Operation appears to occur at a single point in time.

Not every behavior you observe during iteration is linearizable snapshot.

## 5.4 Lock-free/non-blocking

Progress does not require blocking on a lock.

Specific technical meaning; do not use casually.

## 5.5 Blocking

Operation may wait.

Example:

```java
BlockingQueue.take()
```

## 5.6 Weakly consistent

Iterator may reflect some concurrent modifications and does not throw CME.

## 5.7 Snapshot

Iterator sees state at construction time.

## 5.8 Rule

Know exact guarantee. “Thread-safe” alone is too vague.

---

# 6. Visibility, Atomicity, Ordering

Concurrent bugs often fall into three categories.

## 6.1 Visibility

Thread A writes, Thread B may not see without proper happens-before.

Concurrent collection operations help publish elements safely.

## 6.2 Atomicity

This is not atomic:

```java
if (!map.containsKey(k)) {
    map.put(k, v);
}
```

Another thread can modify between calls.

Use:

```java
map.putIfAbsent(k, v);
```

## 6.3 Ordering

Which update happens first?

Concurrent code must define ordering where business needs it.

## 6.4 Rule

Concurrent collections help with visibility and operation atomicity, but business ordering still needs design.

---

# 7. Fail-Fast vs Weakly Consistent vs Snapshot Iteration

## 7.1 Fail-fast

Typical non-concurrent mutable collections.

Example:

```java
ArrayList
HashMap
```

Iterator may throw `ConcurrentModificationException`.

## 7.2 Weakly consistent

Concurrent collections like `ConcurrentHashMap` views and `ConcurrentLinkedQueue`.

Iterator:

- does not throw CME;
- may reflect some updates;
- may not reflect others;
- safe but not exact snapshot.

## 7.3 Snapshot

`CopyOnWriteArrayList` iterator sees array state at iterator creation.

No synchronization needed while traversing.

## 7.4 Rule

Concurrent traversal must be designed around consistency semantics.

---

# 8. `Collections.synchronized*` Wrappers

JDK provides synchronized wrappers:

```java
Collections.synchronizedList(new ArrayList<>())
Collections.synchronizedMap(new HashMap<>())
Collections.synchronizedSet(new HashSet<>())
```

## 8.1 How they work

They wrap operations with synchronization on a mutex.

## 8.2 Single-operation safety

```java
syncList.add(x)
syncList.get(0)
```

are synchronized.

## 8.3 Iteration requires manual synchronization

```java
synchronized (syncList) {
    Iterator<T> it = syncList.iterator();
    while (it.hasNext()) {
        process(it.next());
    }
}
```

## 8.4 Use cases

- simple legacy code;
- small shared collection;
- low contention;
- coarse-grained locking acceptable.

## 8.5 Rule

Synchronized wrappers synchronize methods, not your entire multi-step algorithm.

---

# 9. Synchronized Wrapper Limitations

## 9.1 Global lock

All operations contend on same lock.

## 9.2 Compound actions

Still need external synchronization:

```java
if (!list.contains(x)) {
    list.add(x);
}
```

## 9.3 Iteration

Must synchronize manually.

## 9.4 Scalability

May be poor under high concurrency.

## 9.5 Better alternatives

- `ConcurrentHashMap`;
- `CopyOnWriteArrayList`;
- `BlockingQueue`;
- immutable snapshots;
- explicit locks around larger invariant.

## 9.6 Rule

Use synchronized wrappers when simplicity beats scalability.

---

# 10. `ConcurrentHashMap` Overview

`ConcurrentHashMap<K,V>` is scalable concurrent Map.

## 10.1 Core properties

- thread-safe retrieval/update;
- no null keys/values;
- weakly consistent iterators/views;
- atomic methods like `computeIfAbsent`;
- good for concurrent lookup/update.

## 10.2 Not a synchronized HashMap

It is designed for concurrent access without one global exclusion lock for all operations.

## 10.3 Good use cases

- shared index;
- frequency counters;
- registries;
- concurrent caches with explicit policy;
- per-key coordination.

## 10.4 Limitations

- no nulls;
- no ordering;
- no eviction by itself;
- compound multi-key invariants not automatic.

## 10.5 Rule

ConcurrentHashMap is default concurrent Map for exact key lookup.

---

# 11. ConcurrentHashMap Atomic Operations

Important methods:

```java
putIfAbsent
remove(key, value)
replace(key, oldValue, newValue)
compute
computeIfAbsent
computeIfPresent
merge
```

## 11.1 putIfAbsent

```java
map.putIfAbsent(key, value)
```

Atomic insert only if absent.

## 11.2 computeIfAbsent

```java
V value = map.computeIfAbsent(key, this::load);
```

Atomic per key.

## 11.3 merge

```java
map.merge(key, delta, Integer::sum);
```

Useful for counters if low contention, but for high contention use LongAdder pattern.

## 11.4 Mapping function warning

Mapping functions should be short, side-effect careful, and should not recursively update same map in dangerous ways.

## 11.5 Rule

Use atomic map methods instead of check-then-act.

---

# 12. `LongAdder` Frequency Map Pattern

`ConcurrentHashMap` docs explicitly mention frequency map pattern with `LongAdder`.

## 12.1 Pattern

```java
ConcurrentHashMap<String, LongAdder> freqs = new ConcurrentHashMap<>();

freqs.computeIfAbsent(key, k -> new LongAdder())
     .increment();
```

## 12.2 Why LongAdder

Under high contention, LongAdder can scale better than AtomicLong by spreading updates.

## 12.3 Reading value

```java
long count = freqs.get(key).sum();
```

## 12.4 Cleanup

If counters can become zero or keys unbounded, design removal/eviction.

## 12.5 Rule

For high-concurrency counters per key, use ConcurrentHashMap + LongAdder.

---

# 13. `ConcurrentHashMap` Null Policy

ConcurrentHashMap rejects null keys and null values.

## 13.1 Why useful

`get(key) == null` can mean absent.

No present-null ambiguity.

## 13.2 Migration gotcha

HashMap code using null values fails when migrated.

## 13.3 Absence

Use absence as no mapping.

If negative result must be cached, use explicit value:

```java
sealed interface CacheEntry permits Found, Missing {}
```

or `Optional<V>` carefully.

## 13.4 Rule

ConcurrentHashMap encourages null-free designs.

---

# 14. `ConcurrentSkipListMap` and `ConcurrentSkipListSet`

Concurrent sorted/navigable alternatives.

## 14.1 ConcurrentSkipListMap

Concurrent `NavigableMap`.

Provides sorted key order and concurrent access.

## 14.2 ConcurrentSkipListSet

Concurrent `NavigableSet`.

## 14.3 Use cases

- concurrent sorted index;
- range queries under concurrency;
- leaderboard-like ordered sets;
- time-indexed concurrent map.

## 14.4 Cost

Usually more overhead than ConcurrentHashMap for exact lookup.

## 14.5 Rule

Use skip list collections when you need concurrent sorted navigation.

---

# 15. Non-Blocking Queues

Non-blocking queues do not make consumer wait by blocking method unless you add waiting logic.

Examples:

```java
ConcurrentLinkedQueue
ConcurrentLinkedDeque
```

## 15.1 offer/poll

```java
queue.offer(item);
Item item = queue.poll(); // null if empty
```

## 15.2 No backpressure

Producer can keep adding unless memory runs out.

## 15.3 Good use cases

- many producers/consumers;
- non-blocking handoff;
- event buffers with external signaling;
- work queues where emptiness is polled.

## 15.4 Rule

Non-blocking queue is not enough if you need backpressure.

---

# 16. `ConcurrentLinkedQueue`

`ConcurrentLinkedQueue` is unbounded thread-safe queue based on linked nodes.

## 16.1 FIFO

Queue orders elements FIFO.

## 16.2 Null not allowed

Like most concurrent collection implementations, null elements are not allowed.

## 16.3 Weakly consistent iterator

Its iterator is weakly consistent.

## 16.4 size cost

For concurrent queues, `size()` may be expensive and inaccurate under concurrent mutation. Avoid using size for control.

## 16.5 Use cases

- non-blocking task handoff;
- event buffering with external consumer scheduling;
- many producers.

## 16.6 Rule

Use ConcurrentLinkedQueue when non-blocking unbounded FIFO is acceptable.

---

# 17. Blocking Queues

`BlockingQueue` supports operations that wait.

## 17.1 Operation families

Insert:

```java
add      // exception if cannot
offer    // false if cannot
put      // wait
offer(timeout)
```

Remove:

```java
remove   // exception if empty
poll     // null if empty
take     // wait
poll(timeout)
```

Examine:

```java
element  // exception if empty
peek     // null if empty
```

## 17.2 Producer-consumer

BlockingQueue is designed primarily for producer-consumer queues.

## 17.3 Backpressure

Bounded BlockingQueue can slow producers when consumers lag.

## 17.4 Null not allowed

BlockingQueue implementations generally do not accept null.

## 17.5 Rule

Use BlockingQueue when waiting/backpressure is part of the design.

---

# 18. `ArrayBlockingQueue`

Bounded blocking queue backed by array.

## 18.1 Fixed capacity

Capacity set at construction.

## 18.2 Backpressure

`put` blocks when full.

## 18.3 FIFO

Orders elements FIFO.

## 18.4 Fairness option

Can be constructed with fairness policy, usually lower throughput.

## 18.5 Use cases

- fixed memory queue;
- bounded producer-consumer;
- backpressure.

## 18.6 Rule

Use ArrayBlockingQueue when bounded capacity is required and fixed size is acceptable.

---

# 19. `LinkedBlockingQueue`

Blocking queue based on linked nodes.

## 19.1 Optional capacity

Can be bounded or effectively unbounded if capacity not provided.

## 19.2 Danger of unbounded

Unbounded queues can cause memory growth if producers outpace consumers.

## 19.3 Use cases

- producer-consumer with potentially large buffer;
- executor queues;
- bounded if you care about memory.

## 19.4 Rule

Always think twice before using unbounded LinkedBlockingQueue.

---

# 20. `PriorityBlockingQueue`

Unbounded blocking priority queue.

## 20.1 Priority order

Elements ordered by natural order or comparator.

## 20.2 Not FIFO among equal priority unless tie-breaker

Need sequence tie-breaker if fairness/stability matters.

## 20.3 Unbounded

Can grow without backpressure.

## 20.4 Use cases

- prioritized background jobs;
- scheduling by priority without delay semantics.

## 20.5 Rule

PriorityBlockingQueue gives priority ordering, not bounded backpressure.

---

# 21. `DelayQueue`

Queue of delayed elements.

## 21.1 Element type

Elements implement `Delayed`.

## 21.2 Take behavior

`take` returns element only after delay expires.

## 21.3 Use cases

- delayed retry;
- scheduled expiration;
- timeout management.

## 21.4 Caveat

Not replacement for full scheduler in all cases.

## 21.5 Rule

Use DelayQueue for delay-based availability.

---

# 22. `SynchronousQueue`

A queue with no internal capacity.

## 22.1 Handoff

Each insert waits for matching remove and vice versa.

## 22.2 Use cases

- direct handoff;
- executor designs where tasks handed directly to worker;
- rendezvous pattern.

## 22.3 No buffering

If producer/consumer not matched, operation waits or fails depending method.

## 22.4 Rule

SynchronousQueue is not a queue buffer. It is a handoff point.

---

# 23. `LinkedTransferQueue`

Advanced concurrent queue supporting transfer semantics.

## 23.1 transfer

Producer can wait until consumer receives element.

## 23.2 tryTransfer

Try immediate handoff.

## 23.3 Use cases

- high-throughput producer-consumer;
- direct handoff or queueing hybrid.

## 23.4 Rule

Use TransferQueue when producer handoff semantics matter.

---

# 24. Copy-On-Write Collections

Copy-on-write means mutation creates a fresh copy of underlying array.

## 24.1 Reads

Reads/traversals are cheap and lock-free-ish from caller perspective.

## 24.2 Writes

Writes are expensive O(n) copy.

## 24.3 Snapshot iteration

Iterator sees array snapshot at iterator creation.

## 24.4 Use cases

- listener lists;
- observer callbacks;
- configuration callbacks;
- read-mostly collections.

## 24.5 Rule

Copy-on-write is for read-heavy, write-rarely workloads.

---

# 25. `CopyOnWriteArrayList`

Thread-safe variant of ArrayList where mutative operations copy underlying array.

## 25.1 Snapshot iterator

Iterator provides snapshot state at iterator construction.

No synchronization needed during traversal.

Iterator does not support remove/set/add.

## 25.2 Good use

```java
CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();

for (Listener listener : listeners) {
    listener.onEvent(event);
}
```

Listeners may be added concurrently without affecting current iteration.

## 25.3 Bad use

- frequent writes;
- large lists;
- hot mutation path.

## 25.4 Rule

Use CopyOnWriteArrayList for stable listener traversal.

---

# 26. `CopyOnWriteArraySet`

Set backed by CopyOnWriteArrayList.

## 26.1 Good for

- small sets;
- read-mostly;
- listener uniqueness;
- stable iteration.

## 26.2 Bad for

- large sets;
- frequent membership updates;
- high write throughput.

## 26.3 Rule

CopyOnWriteArraySet is for small read-mostly unique collections.

---

# 27. Concurrent Collections and Streams

## 27.1 Concurrent spliterators

Concurrent collections may have spliterators reporting `CONCURRENT`.

## 27.2 Weak consistency

Stream over concurrent collection may reflect concurrent modifications in weakly consistent way.

## 27.3 Do not assume exact snapshot

If exact snapshot needed:

```java
List<T> snapshot = List.copyOf(concurrentCollection);
```

## 27.4 Parallel stream caution

Concurrent source + parallel stream + mutation can be subtle.

## 27.5 Rule

For deterministic stream processing, snapshot first.

---

# 28. Compound Actions and Race Conditions

Compound action = multiple operations that must be logically atomic.

## 28.1 Example

```java
if (!set.contains(x)) {
    set.add(x);
}
```

Even if set is thread-safe, another thread can add between calls.

## 28.2 Use atomic method if available

For map:

```java
map.putIfAbsent(k, v)
```

For set backed by ConcurrentHashMap:

```java
set.add(x)
```

is atomic for adding membership.

## 28.3 Larger invariant

If operation spans multiple structures, use lock/transaction.

## 28.4 Rule

Thread-safe operations do not make multi-operation sequences atomic.

---

# 29. Check-Then-Act Pitfall

## 29.1 Bad

```java
if (!map.containsKey(key)) {
    map.put(key, load(key));
}
```

Two threads may load and put.

## 29.2 Better

```java
map.computeIfAbsent(key, this::load);
```

## 29.3 But careful

Mapping function may run under map's internal synchronization for that key/bin; keep it short and avoid dangerous recursive updates.

## 29.4 Rule

Use atomic compute/putIfAbsent for check-then-act.

---

# 30. Read-Modify-Write Pitfall

## 30.1 Bad counter

```java
Integer old = map.get(key);
map.put(key, old == null ? 1 : old + 1);
```

Lost updates.

## 30.2 Better

```java
map.merge(key, 1, Integer::sum);
```

## 30.3 High contention better

```java
map.computeIfAbsent(key, k -> new LongAdder()).increment();
```

## 30.4 Rule

Use atomic update methods for read-modify-write.

---

# 31. Mutable Values Inside Concurrent Collections

Concurrent collection protects its structure, not nested mutable values.

## 31.1 Bad

```java
ConcurrentHashMap<UserId, ArrayList<Permission>> map = new ConcurrentHashMap<>();

map.computeIfAbsent(userId, id -> new ArrayList<>())
   .add(permission);
```

ArrayList is not thread-safe.

## 31.2 Better immutable update

```java
map.compute(userId, (id, oldList) -> {
    List<Permission> copy = oldList == null
        ? new ArrayList<>()
        : new ArrayList<>(oldList);
    copy.add(permission);
    return List.copyOf(copy);
});
```

## 31.3 Better concurrent value

```java
ConcurrentHashMap<UserId, Set<Permission>> map = new ConcurrentHashMap<>();
map.computeIfAbsent(userId, id -> ConcurrentHashMap.newKeySet())
   .add(permission);
```

## 31.4 Rule

Concurrent outer container does not make inner values safe.

---

# 32. Backpressure and Capacity

Backpressure prevents producers from overwhelming system.

## 32.1 Unbounded queue danger

Producer faster than consumer:

```text
queue grows
heap grows
GC grows
OOM
```

## 32.2 Bounded BlockingQueue

```java
BlockingQueue<Job> queue = new ArrayBlockingQueue<>(1000);
queue.put(job); // blocks when full
```

## 32.3 Offer with timeout

```java
if (!queue.offer(job, 100, TimeUnit.MILLISECONDS)) {
    rejectOrRetry(job);
}
```

## 32.4 Rule

If work can arrive faster than processed, design bounded capacity and rejection/backpressure.

---

# 33. Choosing by Concurrency Pattern

## 33.1 Shared lookup/update

`ConcurrentHashMap`.

## 33.2 Concurrent sorted lookup/range

`ConcurrentSkipListMap`.

## 33.3 Producer-consumer with backpressure

Bounded `BlockingQueue`.

## 33.4 Non-blocking FIFO

`ConcurrentLinkedQueue`.

## 33.5 Direct handoff

`SynchronousQueue`.

## 33.6 Delayed processing

`DelayQueue`.

## 33.7 Read-mostly listener list

`CopyOnWriteArrayList`.

## 33.8 Immutable read-mostly config

Volatile immutable snapshot.

## 33.9 Rule

Pick by communication pattern, not by class popularity.

---

# 34. Performance Cost Model

## 34.1 ConcurrentHashMap

Cost depends on:

- key distribution;
- contention;
- compute function cost;
- resizing;
- value mutability;
- hot keys.

## 34.2 BlockingQueue

Cost depends on:

- lock/condition contention;
- capacity;
- producer/consumer ratio;
- blocking frequency.

## 34.3 ConcurrentLinkedQueue

Cost depends on:

- node allocation;
- CAS contention;
- polling strategy;
- unbounded growth.

## 34.4 CopyOnWriteArrayList

Cost depends on:

- list size;
- write frequency;
- traversal frequency.

## 34.5 Synchronized wrappers

Cost depends on global lock contention.

## 34.6 Rule

Concurrent performance is workload/contension-specific. Measure.

---

# 35. Memory Consistency Effects

`java.util.concurrent` package specifies memory consistency effects.

## 35.1 General idea

Actions in a thread prior to placing an object into a concurrent collection happen-before actions subsequent to access/removal of that element from the collection in another thread, according to the collection's contract.

## 35.2 Why important

Concurrent collections can safely publish objects if used correctly.

## 35.3 But object mutation after insertion

If you mutate object after putting it into collection without synchronization, readers may see races on object fields.

## 35.4 Prefer immutable elements

Put immutable/safely-published objects into concurrent collections.

## 35.5 Rule

Concurrent collection helps publish references, not magically make mutable object internals race-free.

---

# 36. Testing Concurrent Collections

## 36.1 Unit tests not enough

Concurrency bugs may not reproduce deterministically.

## 36.2 Stress tests

Run many threads, many iterations.

## 36.3 Invariants

Assert business invariants after concurrent operations.

## 36.4 JCStress

For low-level concurrency correctness, use jcstress.

## 36.5 Timeouts

Test blocking behavior with timeouts to avoid hanging tests.

## 36.6 Deterministic design

Prefer designs that minimize shared mutable state.

## 36.7 Rule

Test concurrency by testing invariants under contention, not just happy path.

---

# 37. Production Diagnostics

## 37.1 Map growth

Monitor ConcurrentHashMap size/cardi­nality.

## 37.2 Queue depth

Queue size and age of oldest item are critical.

## 37.3 Throughput

Producer rate vs consumer rate.

## 37.4 Blocking

Thread dumps show waiting on queue/locks.

## 37.5 Contention

JFR/profiler lock events, CPU, safepoints.

## 37.6 GC

Unbounded queues/maps show heap growth.

## 37.7 Hot keys

Frequency counters or per-key locks may bottleneck.

## 37.8 Copy-on-write writes

Write spikes can allocate large arrays.

## 37.9 Rule

Monitor size, rate, age, contention, and allocation.

---

# 38. Production Failure Modes

## 38.1 ConcurrentHashMap with mutable ArrayList values

Fix: concurrent/immutable value strategy.

## 38.2 check-then-act race

Fix: atomic methods.

## 38.3 unbounded queue OOM

Fix: bounded queue/backpressure.

## 38.4 CopyOnWriteArrayList write storm

Fix: different structure/lock/snapshot strategy.

## 38.5 assuming weak iterator is exact

Fix: snapshot first.

## 38.6 using size for queue control

Fix: use offer/put/poll/take semantics.

## 38.7 blocking forever

Fix: timeout/cancellation/poison pill/shutdown protocol.

## 38.8 null inserted into concurrent collection

Fix: explicit sentinel/domain type.

## 38.9 computeIfAbsent slow function

Fix: keep mapping function short; avoid blocking or recursive map mutation.

## 38.10 multi-map invariant broken

Fix: lock/transaction/single owner actor.

## 38.11 hot-key contention

Fix: LongAdder/striping/sharding.

## 38.12 synchronized wrapper iteration without lock

Fix: synchronize around iteration.

## 38.13 common pool misuse with parallel streams and blocking queues

Fix: dedicated executor/design.

## 38.14 stale mutable object fields

Fix: immutable values or proper synchronization.

---

# 39. Best Practices

## 39.1 General

- Choose concurrent collection by concurrency pattern.
- Prefer immutable values.
- Use atomic methods.
- Avoid check-then-act.
- Avoid mutable nested collections unless protected.
- Do not assume exact iteration snapshot.

## 39.2 Maps

- Use ConcurrentHashMap for concurrent exact lookup.
- Use compute/merge/putIfAbsent.
- Avoid null.
- Use LongAdder for high-contention counters.
- Monitor size.

## 39.3 Queues

- Use bounded BlockingQueue for backpressure.
- Use timeouts for graceful degradation.
- Do not use null poison pill.
- Monitor queue depth and age.

## 39.4 Copy-on-write

- Use for read-mostly listener lists.
- Avoid large/frequent writes.

## 39.5 Synchronized wrappers

- Synchronize manually during iteration.
- Prefer modern concurrent collections under contention.

## 39.6 Testing/ops

- Stress test invariants.
- Use JFR/thread dumps/metrics.
- Define shutdown protocols.

---

# 40. Decision Matrix

| Need | Recommended |
|---|---|
| concurrent exact key lookup | `ConcurrentHashMap` |
| concurrent frequency map | `ConcurrentHashMap<K, LongAdder>` |
| concurrent sorted map | `ConcurrentSkipListMap` |
| concurrent sorted set | `ConcurrentSkipListSet` |
| producer-consumer with backpressure | bounded `BlockingQueue` |
| fixed-capacity FIFO | `ArrayBlockingQueue` |
| optionally bounded linked FIFO | `LinkedBlockingQueue` with capacity |
| non-blocking unbounded FIFO | `ConcurrentLinkedQueue` |
| direct handoff | `SynchronousQueue` |
| delayed availability | `DelayQueue` |
| priority work queue | `PriorityBlockingQueue` |
| read-mostly listener list | `CopyOnWriteArrayList` |
| small read-mostly set | `CopyOnWriteArraySet` |
| simple low-contention legacy collection | `Collections.synchronized*` |
| exact snapshot processing | copy snapshot first |
| shared read-mostly config | volatile immutable snapshot |
| nested mutable values | avoid or protect explicitly |
| multi-collection invariant | explicit lock/transaction/actor |

---

# 41. Latihan

## Latihan 1 — Check-Then-Act Race

Show why:

```java
if (!map.containsKey(k)) map.put(k, v);
```

is race-prone.

Refactor to `putIfAbsent`.

## Latihan 2 — Frequency Map

Implement concurrent word counter using:

```java
ConcurrentHashMap<String, LongAdder>
```

## Latihan 3 — Mutable Value Bug

Use:

```java
ConcurrentHashMap<UserId, List<Permission>>
```

and demonstrate race.

Refactor with immutable list update or concurrent set.

## Latihan 4 — BlockingQueue Backpressure

Create bounded `ArrayBlockingQueue`.

Show producer blocks or `offer` fails when full.

## Latihan 5 — CopyOnWrite Snapshot

Create `CopyOnWriteArrayList`, create iterator, mutate list, show iterator snapshot.

## Latihan 6 — Weak Iterator

Iterate `ConcurrentHashMap.keySet()` while mutating map.

Explain why result is safe but not exact.

## Latihan 7 — Synchronized Wrapper Iteration

Show correct synchronized iteration around `Collections.synchronizedList`.

## Latihan 8 — Queue Shutdown

Design poison pill using explicit object, not null.

## Latihan 9 — Concurrent Sorted Range

Use `ConcurrentSkipListMap` for time-indexed events and query range.

## Latihan 10 — Production Metrics

List metrics for queue-based worker system:

- queue depth;
- oldest age;
- producer rate;
- consumer rate;
- rejection count;
- processing latency.

---

# 42. Ringkasan

Concurrent collections are coordination tools.

Core lessons:

- Thread-safe collection does not make whole algorithm thread-safe.
- Concurrent collections define atomicity, visibility, iteration, and blocking semantics.
- Synchronized wrappers use coarse synchronization and require manual locking during iteration.
- ConcurrentHashMap is default concurrent map for exact lookup.
- ConcurrentHashMap rejects null key/value.
- Atomic methods prevent check-then-act and read-modify-write races.
- LongAdder works well for high-contention frequency maps.
- Weakly consistent iterators are safe but not exact snapshots.
- CopyOnWriteArrayList iterators are snapshots.
- BlockingQueue is producer-consumer coordination and backpressure tool.
- Non-blocking queues do not provide backpressure.
- Mutable values inside concurrent collections remain dangerous.
- Bounded queues protect memory.
- Use immutable snapshots for deterministic processing.
- Monitor size, depth, age, throughput, contention, and allocation.

Main rule:

```text
A concurrent collection gives you safe operations.
It does not automatically give you safe workflows.
```

---

# 43. Referensi

1. Java SE 25 — `java.util.concurrent` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/package-summary.html

2. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

3. Java SE 25 — `ConcurrentHashMap.KeySetView`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.KeySetView.html

4. Java SE 25 — `BlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html

5. Java SE 25 — `CopyOnWriteArrayList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html

6. Java SE 25 — `ConcurrentLinkedQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentLinkedQueue.html

7. Java SE 25 — `ConcurrentSkipListMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentSkipListMap.html

8. Java SE 25 — `ArrayBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ArrayBlockingQueue.html

9. Java SE 25 — `LinkedBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/LinkedBlockingQueue.html

10. Java SE 25 — `SynchronousQueue`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/SynchronousQueue.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-018.md](./learn-java-collections-and-streams-part-018.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-020.md](./learn-java-collections-and-streams-part-020.md)

# learn-java-concurrency-and-reactive-part-020.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 020  
# Concurrent Data Structures and Synchronization Strategy: Choosing the Right Collection, Locking Model, Queue, Map, Snapshot, and Ownership Pattern

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **020**  
> Fokus: memahami struktur data concurrent dan strategi sinkronisasi di Java. Kita akan membahas kapan memakai immutable snapshot, synchronized wrapper, explicit lock, `ConcurrentHashMap`, `CopyOnWriteArrayList`, `BlockingQueue`, `ConcurrentLinkedQueue`, `ArrayBlockingQueue`, `LinkedBlockingQueue`, `PriorityBlockingQueue`, `DelayQueue`, `SynchronousQueue`, atomics, striped locking, per-key synchronization, actor ownership, dan bagaimana memilih berdasarkan invariant, throughput, latency, memory, ordering, backpressure, dan workload.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Masalah Utama: Shared Mutable Collections](#2-masalah-utama-shared-mutable-collections)
3. [Mental Model: Collection Operation vs Business Operation](#3-mental-model-collection-operation-vs-business-operation)
4. [Strategi Besar Synchronization](#4-strategi-besar-synchronization)
5. [Immutable Snapshot](#5-immutable-snapshot)
6. [Synchronized Collections](#6-synchronized-collections)
7. [`Collections.synchronizedXxx` Pitfalls](#7-collectionssynchronizedxxx-pitfalls)
8. [Explicit Lock Around Ordinary Collection](#8-explicit-lock-around-ordinary-collection)
9. [`ConcurrentHashMap`](#9-concurrenthashmap)
10. [Atomic Map Operations](#10-atomic-map-operations)
11. [`computeIfAbsent` Deep Dive](#11-computeifabsent-deep-dive)
12. [`compute`, `merge`, and `putIfAbsent`](#12-compute-merge-and-putifabsent)
13. [Weakly Consistent Iterators](#13-weakly-consistent-iterators)
14. [ConcurrentHashMap Anti-Patterns](#14-concurrenthashmap-anti-patterns)
15. [`CopyOnWriteArrayList`](#15-copyonwritearraylist)
16. [When Copy-On-Write Works](#16-when-copy-on-write-works)
17. [Concurrent Queues Overview](#17-concurrent-queues-overview)
18. [`ConcurrentLinkedQueue`](#18-concurrentlinkedqueue)
19. [`BlockingQueue` Mental Model](#19-blockingqueue-mental-model)
20. [`ArrayBlockingQueue`](#20-arrayblockingqueue)
21. [`LinkedBlockingQueue`](#21-linkedblockingqueue)
22. [`PriorityBlockingQueue`](#22-priorityblockingqueue)
23. [`DelayQueue`](#23-delayqueue)
24. [`SynchronousQueue`](#24-synchronousqueue)
25. [Deque Variants](#25-deque-variants)
26. [Queues as Backpressure Boundary](#26-queues-as-backpressure-boundary)
27. [Producer-Consumer Strategy](#27-producer-consumer-strategy)
28. [Per-Key Synchronization](#28-per-key-synchronization)
29. [Striped Locking](#29-striped-locking)
30. [AtomicReference with Immutable State](#30-atomicreference-with-immutable-state)
31. [LongAdder and Concurrent Counters](#31-longadder-and-concurrent-counters)
32. [Thread-Safe Set Patterns](#32-thread-safe-set-patterns)
33. [Thread-Safe Cache Patterns](#33-thread-safe-cache-patterns)
34. [Compound Invariants Across Collections](#34-compound-invariants-across-collections)
35. [Actor Ownership as Alternative](#35-actor-ownership-as-alternative)
36. [Virtual Threads and Concurrent Data Structures](#36-virtual-threads-and-concurrent-data-structures)
37. [Observability and Tuning](#37-observability-and-tuning)
38. [Mini Case Study: Listener Registry](#38-mini-case-study-listener-registry)
39. [Mini Case Study: Case Processing Queue](#39-mini-case-study-case-processing-queue)
40. [Mini Case Study: Per-Case Locking](#40-mini-case-study-per-case-locking)
41. [Common Anti-Patterns](#41-common-anti-patterns)
42. [Best Practices](#42-best-practices)
43. [Decision Matrix](#43-decision-matrix)
44. [Latihan](#44-latihan)
45. [Ringkasan](#45-ringkasan)
46. [Referensi](#46-referensi)

---

# 1. Tujuan Bagian Ini

Banyak concurrency bug Java muncul bukan di `Thread` API, melainkan di penggunaan collection.

Contoh sederhana:

```java
private final Map<String, UserSession> sessions = new HashMap<>();
```

Lalu beberapa thread melakukan:

```java
sessions.put(id, session);
sessions.get(id);
sessions.remove(id);
for (var entry : sessions.entrySet()) { ... }
```

Masalah:

- `HashMap` tidak thread-safe;
- update concurrent bisa corrupt internal structure;
- iterator fail-fast;
- reader melihat stale/inconsistent state;
- compound operation tidak atomic;
- invariant antar collection bisa rusak.

Solusi bukan selalu “ganti ke `ConcurrentHashMap`”.

Pertanyaan sebenarnya:

```text
Apa invariant data ini?
Apa operasi bisnis yang harus atomic?
Apakah reads jauh lebih banyak daripada writes?
Apakah ordering penting?
Apakah producer harus dibatasi?
Apakah task boleh wait?
Apakah snapshot consistency diperlukan?
Apakah per-key independence ada?
```

Target bagian ini:

```text
Mampu memilih struktur data dan strategi sinkronisasi berdasarkan semantics,
bukan berdasarkan kebiasaan atau nama class yang mengandung kata Concurrent.
```

---

# 2. Masalah Utama: Shared Mutable Collections

Collection mutable yang shared adalah hotspot concurrency.

Bad example:

```java
final class SessionRegistry {
    private final Map<String, Session> sessions = new HashMap<>();

    void add(Session session) {
        sessions.put(session.id(), session);
    }

    Session get(String id) {
        return sessions.get(id);
    }
}
```

Jika dipakai banyak thread:

- race;
- visibility issue;
- structural corruption;
- lost update;
- stale read.

## 2.1 “But it works on my machine”

Concurrency bugs timing-dependent.

Mungkin baru muncul saat:

- high traffic;
- multi-core;
- GC pause;
- resize map;
- iteration while mutation;
- new JDK;
- different CPU.

## 2.2 Main rule

```text
A shared mutable collection must have a synchronization strategy.
```

---

# 3. Mental Model: Collection Operation vs Business Operation

Thread-safe collection menjamin operasi collection tertentu aman.

Tetapi business operation bisa terdiri dari beberapa collection operations.

Example:

```java
if (!map.containsKey(key)) {
    map.put(key, createValue());
}
```

Walaupun `map` adalah `ConcurrentHashMap`, sequence ini tidak atomic.

Correct:

```java
map.computeIfAbsent(key, k -> createValue());
```

## 3.1 Another example

```java
User user = users.get(userId);
Role role = roles.get(user.roleId());
```

Jika invariant antara `users` dan `roles` harus consistent, dua concurrent maps tidak cukup.

## 3.2 Main rule

```text
Thread-safe collection operations do not automatically make business workflows atomic.
```

---

# 4. Strategi Besar Synchronization

Untuk shared data structure, pilih strategi:

## 4.1 Immutable snapshot

Read-only shared version, replaced atomically.

## 4.2 Synchronized wrapper

Simple monitor around collection operations.

## 4.3 Explicit lock

Custom locking around ordinary collection and invariants.

## 4.4 Concurrent collection

Built-in concurrent algorithm.

## 4.5 Atomic reference to immutable aggregate

CAS update whole state.

## 4.6 Per-key lock/striped lock

Reduce contention by partitioning.

## 4.7 Actor ownership

One owner thread mutates, others send messages.

## 4.8 Main rule

```text
Pick synchronization strategy based on invariants, contention, ordering, and lifecycle.
```

---

# 5. Immutable Snapshot

Great for read-mostly state.

```java
record RoutingTable(Map<String, URI> routes, long version) {
    RoutingTable {
        routes = Map.copyOf(routes);
    }
}

final class RoutingRegistry {
    private final AtomicReference<RoutingTable> current;

    RoutingRegistry(RoutingTable initial) {
        this.current = new AtomicReference<>(initial);
    }

    RoutingTable current() {
        return current.get();
    }

    void reload(RoutingTable next) {
        current.set(next);
    }
}
```

## 5.1 Pros

- readers lock-free;
- consistent snapshot;
- no partial update;
- easy rollback/versioning;
- simple mental model.

## 5.2 Cons

- write copies whole structure;
- large snapshot cost;
- stale readers possible until next read;
- not ideal for frequent writes.

## 5.3 Use cases

- config;
- route table;
- permission snapshot;
- feature flags;
- reference data;
- read-mostly caches.

## 5.4 Main rule

```text
If data is read often and updated rarely, immutable snapshot is often simpler than concurrent mutation.
```

---

# 6. Synchronized Collections

Java provides wrappers:

```java
Collections.synchronizedMap(new HashMap<>())
Collections.synchronizedList(new ArrayList<>())
Collections.synchronizedSet(new HashSet<>())
```

These synchronize individual method calls.

## 6.1 Good

- simple;
- legacy compatibility;
- low/moderate contention;
- all operations serialized.

## 6.2 Bad

- compound operations need external synchronization;
- iteration needs manual synchronization;
- one global lock;
- can become bottleneck.

## 6.3 Main rule

```text
Synchronized wrappers make individual collection methods synchronized,
not your whole business logic.
```

---

# 7. `Collections.synchronizedXxx` Pitfalls

## 7.1 Iteration pitfall

Bad:

```java
Map<String, Session> map = Collections.synchronizedMap(new HashMap<>());

for (var entry : map.entrySet()) {
    process(entry);
}
```

Need:

```java
synchronized (map) {
    for (var entry : map.entrySet()) {
        process(entry);
    }
}
```

## 7.2 Compound pitfall

Bad:

```java
if (!map.containsKey(k)) {
    map.put(k, v);
}
```

Need synchronized block or atomic concurrent map operation.

## 7.3 External lock object

Wrapper uses itself as mutex.

You must synchronize on wrapper object, not backing map.

## 7.4 Main rule

```text
With synchronized wrappers, iteration and compound operations must synchronize manually.
```

---

# 8. Explicit Lock Around Ordinary Collection

When invariants are complex, use lock.

```java
final class UserRoleRegistry {
    private final ReentrantLock lock = new ReentrantLock();

    private final Map<UserId, User> users = new HashMap<>();
    private final Map<RoleId, Role> roles = new HashMap<>();

    void addUser(User user) {
        lock.lock();
        try {
            if (!roles.containsKey(user.roleId())) {
                throw new IllegalArgumentException("Unknown role");
            }
            users.put(user.id(), user);
        } finally {
            lock.unlock();
        }
    }
}
```

## 8.1 Pros

- protects multi-collection invariant;
- explicit timeout/interrupt possible;
- readable invariant boundary.

## 8.2 Cons

- serialized;
- lock contention;
- must unlock in finally.

## 8.3 Main rule

```text
When invariant spans multiple fields/collections, a lock is often clearer than multiple concurrent collections.
```

---

# 9. `ConcurrentHashMap`

`ConcurrentHashMap` is the default concurrent map for many use cases.

```java
ConcurrentHashMap<Key, Value> map = new ConcurrentHashMap<>();
```

Good for:

- concurrent get/put/remove;
- per-key updates;
- high read concurrency;
- atomic methods like `computeIfAbsent`;
- scalable map access.

Java SE 25 docs describe `ConcurrentHashMap` as supporting full concurrency of retrievals and high expected concurrency for updates.

## 9.1 Reads usually do not block

Retrieval operations generally do not block.

## 9.2 No null keys/values

`ConcurrentHashMap` does not allow null keys or values.

## 9.3 Main rule

```text
Use ConcurrentHashMap for independent per-key concurrent access.
```

---

# 10. Atomic Map Operations

Prefer atomic map methods:

```java
putIfAbsent
computeIfAbsent
computeIfPresent
compute
merge
replace
remove(key, value)
```

## 10.1 Bad

```java
Value value = map.get(key);
if (value == null) {
    value = create();
    map.put(key, value);
}
```

Race.

## 10.2 Good

```java
Value value = map.computeIfAbsent(key, k -> create());
```

## 10.3 Main rule

```text
Use map atomic methods for check-then-act on a ConcurrentHashMap.
```

---

# 11. `computeIfAbsent` Deep Dive

Common use:

```java
CacheValue value = cache.computeIfAbsent(key, this::load);
```

## 11.1 Mapping function caution

Mapping function should be:

- short;
- side-effect controlled;
- not recursively update same map in dangerous ways;
- not block long if avoidable;
- idempotent/safe if retried depending semantics.

## 11.2 Blocking inside compute

If loader calls slow DB/API, it may block update path for that key/bin.

Better pattern sometimes:

```java
ConcurrentHashMap<Key, CompletableFuture<Value>> cache = new ConcurrentHashMap<>();

CompletableFuture<Value> future = cache.computeIfAbsent(
    key,
    k -> CompletableFuture.supplyAsync(() -> load(k), executor)
);
```

But cancellation/failure eviction policy becomes important.

## 11.3 Main rule

```text
computeIfAbsent is atomic, but the mapping function becomes part of synchronization design.
```

---

# 12. `compute`, `merge`, and `putIfAbsent`

## 12.1 `putIfAbsent`

Install if no value.

```java
map.putIfAbsent(key, value);
```

## 12.2 `compute`

General remapping.

```java
map.compute(key, (k, old) -> update(old));
```

## 12.3 `merge`

Good for counters/aggregation.

```java
map.merge(key, 1, Integer::sum);
```

## 12.4 Counter example

For high contention counters, use `LongAdder` values:

```java
ConcurrentHashMap<String, LongAdder> counts = new ConcurrentHashMap<>();

counts.computeIfAbsent(name, k -> new LongAdder())
      .increment();
```

## 12.5 Main rule

```text
Choose the narrowest atomic map operation that matches your update semantics.
```

---

# 13. Weakly Consistent Iterators

ConcurrentHashMap iterators are weakly consistent.

Meaning:

- do not throw `ConcurrentModificationException`;
- may reflect some updates during iteration;
- not necessarily a snapshot;
- safe for concurrent traversal.

## 13.1 If you need snapshot

Use copy:

```java
Map<Key, Value> snapshot = Map.copyOf(map);
```

## 13.2 If you need exact consistent aggregate

Use lock or immutable snapshot design.

## 13.3 Main rule

```text
Concurrent iteration is not the same as consistent snapshot iteration.
```

---

# 14. ConcurrentHashMap Anti-Patterns

## 14.1 Assuming whole-map invariant

Two keys updated independently may be inconsistent.

## 14.2 Doing long blocking work in compute

Can hurt throughput.

## 14.3 Mutable values without synchronization

Map is concurrent, value may not be.

```java
ConcurrentHashMap<Key, ArrayList<Value>> map; // dangerous
```

Use concurrent value or immutable update.

## 14.4 Check-then-act outside atomic method

Race.

## 14.5 Assuming size is exact under concurrency

Size can be transient under concurrent updates.

## 14.6 Main rule

```text
ConcurrentHashMap protects map structure, not arbitrary mutable value semantics.
```

---

# 15. `CopyOnWriteArrayList`

`CopyOnWriteArrayList` copies underlying array on mutation.

Good for:

- many reads/iterations;
- rare writes;
- listener lists;
- stable iteration.

Example:

```java
CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();

void addListener(Listener listener) {
    listeners.add(listener);
}

void publish(Event event) {
    for (Listener listener : listeners) {
        listener.onEvent(event);
    }
}
```

## 15.1 Pros

- iteration no lock;
- snapshot-style iterator;
- no ConcurrentModificationException;
- simple listener registry.

## 15.2 Cons

- writes expensive;
- memory copies;
- bad for frequent mutation or huge lists.

## 15.3 Main rule

```text
CopyOnWriteArrayList is for read-mostly lists with rare mutation.
```

---

# 16. When Copy-On-Write Works

Works when:

```text
read frequency >>> write frequency
```

Examples:

- listeners;
- handlers;
- plugins;
- immutable subscriber list;
- small config list.

Does not work when:

- queue;
- high write list;
- large dynamic list;
- frequent add/remove;
- real-time mutable state.

## 16.1 Main rule

```text
Copy-on-write trades write cost for simple safe reads.
```

---

# 17. Concurrent Queues Overview

Queues model handoff between producers and consumers.

Types:

## 17.1 Non-blocking queues

- `ConcurrentLinkedQueue`;
- `ConcurrentLinkedDeque`.

## 17.2 Blocking queues

- `ArrayBlockingQueue`;
- `LinkedBlockingQueue`;
- `PriorityBlockingQueue`;
- `DelayQueue`;
- `SynchronousQueue`;
- `LinkedTransferQueue`.

## 17.3 Choice dimensions

- bounded/unbounded;
- blocking/non-blocking;
- FIFO/priority/delay;
- memory;
- fairness;
- backpressure;
- producer-consumer count.

## 17.4 Main rule

```text
Queue choice is backpressure and ordering design.
```

---

# 18. `ConcurrentLinkedQueue`

Lock-free, unbounded, non-blocking FIFO queue.

```java
ConcurrentLinkedQueue<Event> queue = new ConcurrentLinkedQueue<>();

queue.offer(event);
Event event = queue.poll();
```

## 18.1 Good

- many producers/consumers;
- no blocking;
- high concurrency;
- polling loops with external coordination.

## 18.2 Bad

- unbounded memory risk;
- consumers may spin/poll;
- no built-in backpressure;
- no blocking wait.

## 18.3 Main rule

```text
ConcurrentLinkedQueue is for non-blocking handoff when you manage waiting/backpressure elsewhere.
```

---

# 19. `BlockingQueue` Mental Model

BlockingQueue supports producer-consumer coordination.

Operations:

## 19.1 Insert

```java
put(e)        // wait if full
offer(e)      // fail if full
offer(e,t,u)  // wait up to timeout
```

## 19.2 Remove

```java
take()        // wait if empty
poll()        // null if empty
poll(t,u)     // wait up to timeout
```

## 19.3 Main rule

```text
BlockingQueue combines thread-safe queue with coordination and backpressure.
```

---

# 20. `ArrayBlockingQueue`

Bounded FIFO queue backed by array.

```java
BlockingQueue<Task> queue = new ArrayBlockingQueue<>(1000);
```

## 20.1 Pros

- bounded memory;
- predictable capacity;
- good backpressure;
- optional fairness constructor.

## 20.2 Cons

- fixed size;
- producers block/reject when full;
- one capacity for all.

## 20.3 Use cases

- producer-consumer with bounded buffer;
- worker queue;
- admission control.

## 20.4 Main rule

```text
ArrayBlockingQueue is a strong default when you need bounded FIFO backpressure.
```

---

# 21. `LinkedBlockingQueue`

Optionally bounded linked queue.

```java
BlockingQueue<Task> queue = new LinkedBlockingQueue<>(capacity);
```

If no capacity specified, capacity is effectively very large.

## 21.1 Pros

- can be bounded;
- often good throughput;
- flexible.

## 21.2 Cons

- unbounded default is dangerous;
- linked nodes add allocation;
- memory can grow if unbounded.

## 21.3 Main rule

```text
Always think twice before using unbounded LinkedBlockingQueue.
```

---

# 22. `PriorityBlockingQueue`

Priority queue with blocking take.

```java
PriorityBlockingQueue<Job> queue = new PriorityBlockingQueue<>();
```

## 22.1 Pros

- priority ordering;
- useful for scheduling by importance.

## 22.2 Cons

- unbounded;
- priority starvation risk;
- equal priority ordering considerations;
- no natural backpressure.

## 22.3 Main rule

```text
Priority queues need starvation policy and capacity governance.
```

---

# 23. `DelayQueue`

Elements become available only after delay.

```java
DelayQueue<DelayedTask> queue = new DelayQueue<>();
```

Good for:

- retry after delay;
- scheduled expiration;
- delayed processing.

## 23.1 Main rule

```text
DelayQueue is for time-based availability, not general scheduling replacement.
```

---

# 24. `SynchronousQueue`

Queue with no capacity.

Each put waits for take; each take waits for put.

```java
BlockingQueue<Task> queue = new SynchronousQueue<>();
```

## 24.1 Use cases

- direct handoff;
- executor designs where no queueing desired;
- backpressure by requiring consumer ready.

## 24.2 Main rule

```text
SynchronousQueue is a rendezvous, not a buffer.
```

---

# 25. Deque Variants

Concurrent deques:

```java
ConcurrentLinkedDeque
LinkedBlockingDeque
```

Use when both ends matter:

- work stealing;
- LIFO/FIFO hybrid;
- double-ended producer/consumer.

## 25.1 Main rule

```text
Use deque when end-selection is part of scheduling semantics.
```

---

# 26. Queues as Backpressure Boundary

A bounded queue is a pressure valve.

Producer when full must:

- block;
- timeout;
- drop;
- reject;
- shed load;
- fallback.

## 26.1 Bad

```java
new LinkedBlockingQueue<>() // unbounded
```

Under load, memory grows until OOM.

## 26.2 Good

```java
new ArrayBlockingQueue<>(1000)
```

with rejection/timeout policy.

## 26.3 Main rule

```text
If producers can outpace consumers, queue must be bounded or load must be shed elsewhere.
```

---

# 27. Producer-Consumer Strategy

Design questions:

## 27.1 Producers

How many? Burst? Can block?

## 27.2 Consumers

How many? Processing time? Failure handling?

## 27.3 Queue

Bounded? FIFO? Priority? Delay?

## 27.4 Backpressure

What happens when full?

## 27.5 Shutdown

How consumers stop?

## 27.6 Main rule

```text
Producer-consumer design is not just queue selection.
It is lifecycle, capacity, failure, and ordering policy.
```

---

# 28. Per-Key Synchronization

When operations on same key must serialize but different keys independent.

Example:

```text
caseId=123 operations ordered
caseId=456 can run concurrently
```

Approaches:

- `ConcurrentHashMap<Key, Lock>`;
- striped locks;
- actor per key;
- database row locks;
- partitioned queue.

## 28.1 Lock map caution

Need cleanup to avoid lock map growth.

```java
ConcurrentHashMap<Key, ReentrantLock> locks = new ConcurrentHashMap<>();
```

## 28.2 Main rule

```text
Per-key synchronization is useful when invariants are per key, not global.
```

---

# 29. Striped Locking

Striping maps many keys to fewer locks.

```java
final class StripedLocks {
    private final ReentrantLock[] locks;

    StripedLocks(int stripes) {
        this.locks = IntStream.range(0, stripes)
            .mapToObj(i -> new ReentrantLock())
            .toArray(ReentrantLock[]::new);
    }

    ReentrantLock lockFor(Object key) {
        return locks[Math.floorMod(key.hashCode(), locks.length)];
    }
}
```

## 29.1 Pros

- bounded lock count;
- less global contention;
- no per-key cleanup.

## 29.2 Cons

- unrelated keys can collide;
- operations needing multiple stripes need ordering;
- stripe count tuning.

## 29.3 Main rule

```text
Striped locking reduces contention while keeping lock count bounded.
```

---

# 30. AtomicReference with Immutable State

For complex state updated as whole:

```java
record State(Map<Key, Value> values, long version) {
    State {
        values = Map.copyOf(values);
    }
}
```

Update:

```java
AtomicReference<State> ref = new AtomicReference<>(initial);

void put(Key key, Value value) {
    ref.updateAndGet(old -> {
        Map<Key, Value> next = new HashMap<>(old.values());
        next.put(key, value);
        return new State(next, old.version() + 1);
    });
}
```

## 30.1 Good

- consistent immutable snapshot;
- lock-free reads;
- atomic aggregate replacement.

## 30.2 Bad

- copy cost;
- CAS retry cost;
- not for huge frequent writes.

## 30.3 Main rule

```text
AtomicReference + immutable aggregate is excellent for read-mostly consistent state.
```

---

# 31. LongAdder and Concurrent Counters

High contention counter:

```java
LongAdder adder = new LongAdder();
adder.increment();
long total = adder.sum();
```

For per-key:

```java
ConcurrentHashMap<String, LongAdder> metrics = new ConcurrentHashMap<>();

metrics.computeIfAbsent(name, k -> new LongAdder())
       .increment();
```

## 31.1 LongAdder vs AtomicLong

`LongAdder` improves high-contention update throughput by spreading contention.

But `sum()` is not an atomic snapshot with concurrent updates.

## 31.2 Main rule

```text
Use LongAdder for high-throughput metrics, not strict linearizable counters.
```

---

# 32. Thread-Safe Set Patterns

## 32.1 ConcurrentHashMap key set

```java
Set<Key> set = ConcurrentHashMap.newKeySet();
```

Good general concurrent set.

## 32.2 CopyOnWriteArraySet

Good for small read-mostly sets.

## 32.3 SynchronizedSet

Simple, serialized.

## 32.4 Immutable Set Snapshot

Read-only published set.

## 32.5 Main rule

```text
Choose set implementation based on mutation frequency and snapshot consistency.
```

---

# 33. Thread-Safe Cache Patterns

## 33.1 Simple CHM cache

```java
ConcurrentHashMap<Key, Value> cache = new ConcurrentHashMap<>();

Value value = cache.computeIfAbsent(key, this::load);
```

## 33.2 Future cache

Avoid duplicate loads:

```java
ConcurrentHashMap<Key, CompletableFuture<Value>> cache = new ConcurrentHashMap<>();
```

But handle failure eviction.

## 33.3 Use library

For production caches, consider mature cache libraries with:

- eviction;
- TTL;
- refresh;
- max size;
- stats;
- single-flight loading.

## 33.4 Main rule

```text
A map is not a full cache unless eviction, expiry, loading, and failure policy are defined.
```

---

# 34. Compound Invariants Across Collections

Example:

```java
Map<UserId, User> users;
Map<RoleId, Set<UserId>> roleMembers;
```

Invariant:

```text
if user.roleId = R, then roleMembers[R] contains user.id
```

Concurrent maps alone do not maintain this invariant.

Use:

- one lock around both;
- immutable aggregate snapshot;
- single owner actor;
- transaction/database constraints.

## 34.1 Main rule

```text
When invariant spans collections, synchronize the invariant, not just the collections.
```

---

# 35. Actor Ownership as Alternative

Instead of shared concurrent collection:

```text
one actor/event-loop owns mutable map
others send commands
```

Example:

```java
final class RegistryActor {
    private final ExecutorService owner = Executors.newSingleThreadExecutor();
    private final Map<Key, Value> map = new HashMap<>();

    void put(Key key, Value value) {
        owner.execute(() -> map.put(key, value));
    }
}
```

## 35.1 Pros

- no locks inside owner;
- sequential reasoning;
- preserves order.

## 35.2 Cons

- bottleneck;
- queue management;
- backpressure;
- async API;
- failure handling.

## 35.3 Main rule

```text
Actor ownership replaces shared-memory concurrency with message serialization.
```

---

# 36. Virtual Threads and Concurrent Data Structures

Virtual threads increase concurrency.

Implications:

## 36.1 More operations hit shared data

Hot locks/maps become visible.

## 36.2 Waiting is cheaper but contention remains

`BlockingQueue.take()` can be cheap for virtual thread, but queue capacity still matters.

## 36.3 ThreadLocal-heavy values still risky

Do not use per-thread collection caches blindly.

## 36.4 Main rule

```text
Virtual threads make shared data structure design more important, not less.
```

---

# 37. Observability and Tuning

Measure:

## 37.1 Queues

- size;
- remaining capacity;
- offer timeout/rejection;
- take wait time;
- processing time.

## 37.2 Maps/cache

- hit/miss;
- load duration;
- compute failures;
- size;
- eviction if any;
- contention symptoms.

## 37.3 Locks

- wait time;
- hold time;
- queue length if available.

## 37.4 Backpressure

- rejected tasks;
- dropped items;
- producer wait.

## 37.5 Main rule

```text
Concurrent data structures need metrics at their contention/backpressure boundary.
```

---

# 38. Mini Case Study: Listener Registry

## 38.1 Requirement

Many events, rare listener add/remove.

## 38.2 Good solution

```java
final class ListenerRegistry {
    private final CopyOnWriteArrayList<Listener> listeners =
        new CopyOnWriteArrayList<>();

    void add(Listener listener) {
        listeners.add(listener);
    }

    void publish(Event event) {
        for (Listener listener : listeners) {
            listener.onEvent(event);
        }
    }
}
```

## 38.3 Why

- read/iterate often;
- mutation rare;
- stable snapshot iteration useful.

## 38.4 Lesson

```text
CopyOnWriteArrayList is excellent for listener registries.
```

---

# 39. Mini Case Study: Case Processing Queue

## 39.1 Requirement

Producers submit case processing tasks. Consumers process with fixed capacity.

## 39.2 Good solution

```java
BlockingQueue<CaseTask> queue = new ArrayBlockingQueue<>(1000);
```

Producer:

```java
if (!queue.offer(task, 100, TimeUnit.MILLISECONDS)) {
    throw new ServiceBusyException("case queue full");
}
```

Consumer:

```java
while (!Thread.currentThread().isInterrupted()) {
    CaseTask task = queue.take();
    process(task);
}
```

## 39.3 Why

- bounded memory;
- backpressure;
- blocking wait;
- simple shutdown via interrupt.

## 39.4 Lesson

```text
Bounded BlockingQueue is a concurrency and backpressure boundary.
```

---

# 40. Mini Case Study: Per-Case Locking

## 40.1 Requirement

Same case ID must not be processed concurrently. Different cases can run concurrently.

## 40.2 Striped lock

```java
ReentrantLock lock = stripedLocks.lockFor(caseId);

lock.lock();
try {
    processCase(caseId);
} finally {
    lock.unlock();
}
```

## 40.3 Why not global lock?

Global lock serializes all cases.

## 40.4 Why not per-key lock map?

Can grow forever unless cleanup designed.

## 40.5 Lesson

```text
Striped locks are a pragmatic middle ground for per-key serialization.
```

---

# 41. Common Anti-Patterns

## 41.1 Replacing HashMap with ConcurrentHashMap and assuming everything fixed

Business invariants may still race.

## 41.2 Mutable values inside ConcurrentHashMap

Map safe, value unsafe.

## 41.3 `containsKey` then `put`

Race.

## 41.4 Long blocking loader in `computeIfAbsent`

Can hurt map throughput.

## 41.5 Unbounded queues

Memory leak/OOM.

## 41.6 CopyOnWrite for write-heavy list

Terrible write performance.

## 41.7 Priority queue without starvation policy

Low priority never runs.

## 41.8 Iterating synchronized collection without synchronized block

Race/ConcurrentModificationException.

## 41.9 Per-key lock map without cleanup

Memory growth.

## 41.10 Queue without shutdown protocol

Consumers stuck forever.

---

# 42. Best Practices

## 42.1 Start from invariant

What must remain true?

## 42.2 Prefer immutable snapshots for read-mostly state

Simple and safe.

## 42.3 Use ConcurrentHashMap for independent per-key operations

Use atomic methods.

## 42.4 Keep compute functions short

Avoid long blocking work in map compute paths.

## 42.5 Use bounded queues for producer-consumer

Avoid unbounded memory.

## 42.6 Use CopyOnWrite for listener-style read-mostly lists

Not for frequent writes.

## 42.7 Use locks for multi-collection invariants

One lock around invariant.

## 42.8 Use LongAdder for high-contention metrics

Not strict counters.

## 42.9 Use per-key/striped locking when invariants are per key

Avoid global bottleneck.

## 42.10 Add metrics

Queue size, wait time, rejection, cache load, lock wait.

---

# 43. Decision Matrix

| Need | Recommended |
|---|---|
| Read-mostly config | immutable snapshot + volatile/AtomicReference |
| Independent key-value concurrent access | ConcurrentHashMap |
| Check-then-create value | computeIfAbsent |
| High-contention per-key metrics | ConcurrentHashMap + LongAdder |
| Listener list | CopyOnWriteArrayList |
| Frequent list mutation | lock + ArrayList or concurrent queue depending semantics |
| Producer-consumer bounded buffer | ArrayBlockingQueue |
| Producer-consumer with linked capacity | LinkedBlockingQueue with explicit capacity |
| Direct handoff no buffering | SynchronousQueue |
| Delayed retry tasks | DelayQueue |
| Priority work | PriorityBlockingQueue + starvation policy |
| Multi-collection invariant | explicit lock or immutable aggregate |
| Per-key serialization | striped locks/per-key actor |
| Queue with backpressure | bounded BlockingQueue |
| Non-blocking polling queue | ConcurrentLinkedQueue |
| Strict snapshot iteration | immutable copy/snapshot |
| Durable work | database/queue system, not in-memory collection only |

---

# 44. Latihan

## Latihan 1 — ConcurrentHashMap Atomicity

Refactor `containsKey` + `put` menjadi `computeIfAbsent`.

## Latihan 2 — Mutable Value Bug

Buat contoh `ConcurrentHashMap<Key, ArrayList<Value>>` yang race, lalu perbaiki.

## Latihan 3 — Immutable Snapshot

Implementasikan config registry dengan `AtomicReference<Config>`.

## Latihan 4 — Listener Registry

Implementasikan listener registry dengan `CopyOnWriteArrayList`.

## Latihan 5 — Bounded Queue

Buat producer-consumer dengan `ArrayBlockingQueue` dan timeout offer.

## Latihan 6 — Queue Selection

Pilih queue untuk: retry delay, priority job, direct handoff, bounded FIFO.

## Latihan 7 — Striped Lock

Implementasikan striped lock untuk `caseId`.

## Latihan 8 — Multi-Collection Invariant

Desain registry user-role dengan invariant lintas dua map.

## Latihan 9 — Cache Failure Policy

Desain cache dengan `CompletableFuture` value dan failure eviction.

## Latihan 10 — Metrics

Buat daftar metrics untuk queue worker production.

---

# 45. Ringkasan

Concurrent data structure bukan sekadar “pakai class concurrent”.

Core lessons:

- Shared mutable collections butuh synchronization strategy.
- Thread-safe collection operation tidak otomatis membuat business operation atomic.
- Immutable snapshot cocok untuk read-mostly consistent state.
- Synchronized wrappers synchronize individual methods; iteration/compound operation butuh manual sync.
- Explicit lock cocok untuk multi-field/multi-collection invariant.
- ConcurrentHashMap cocok untuk independent per-key access.
- Gunakan atomic map operations: `computeIfAbsent`, `compute`, `merge`, `putIfAbsent`.
- Mapping function dalam compute harus didesain hati-hati.
- ConcurrentHashMap iterator weakly consistent, bukan snapshot.
- CopyOnWriteArrayList cocok untuk listener/read-mostly list.
- Queue choice adalah desain backpressure/order/waiting.
- Bounded BlockingQueue adalah producer-consumer boundary yang kuat.
- Unbounded queue bisa menjadi memory leak.
- Priority queues butuh starvation policy.
- Per-key synchronization cocok untuk per-key invariant.
- Striped locking membatasi jumlah lock sambil mengurangi contention.
- AtomicReference + immutable aggregate cocok untuk read-mostly aggregate state.
- LongAdder cocok untuk high-throughput metrics, bukan strict counters.
- Actor ownership adalah alternatif untuk shared mutable collection.
- Virtual threads meningkatkan kebutuhan desain resource/data structure yang benar.
- Observability harus melihat queue size, wait time, rejection, cache load, lock wait.

Main rule:

```text
Choose concurrent data structures by semantics:
invariant, ordering, backpressure, snapshot consistency,
mutation frequency, contention, and ownership.
```

---

# 46. Referensi

1. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

2. Java SE 25 — `CopyOnWriteArrayList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html

3. Java SE 25 — `BlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html

4. Java SE 25 — `ArrayBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ArrayBlockingQueue.html

5. Java SE 25 — `LinkedBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/LinkedBlockingQueue.html

6. Java SE 25 — `ConcurrentLinkedQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentLinkedQueue.html

7. Java SE 25 — `PriorityBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/PriorityBlockingQueue.html

8. Java SE 25 — `DelayQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/DelayQueue.html

9. Java SE 25 — `SynchronousQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/SynchronousQueue.html

10. Java SE 25 — `LongAdder`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html

11. Java SE 25 — `AtomicReference`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicReference.html

12. Java SE 25 — `Collections.synchronizedMap`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html

13. OpenJDK JEP 444 — Virtual Threads  
    https://openjdk.org/jeps/444

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 019](./learn-java-concurrency-and-reactive-part-019.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 021](./learn-java-concurrency-and-reactive-part-021.md)

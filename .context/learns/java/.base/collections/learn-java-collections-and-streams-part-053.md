# learn-java-collections-and-streams-part-053.md

# Java Collections and Streams — Part 053  
# Collections and Concurrency: Thread Safety, Safe Publication, Visibility, Compound Actions, Synchronized Wrappers, Concurrent Collections, Weakly-Consistent Iteration, Copy-on-Write, Blocking Queues, and Production Patterns

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **053**  
> Fokus: memahami concurrency dalam Java Collections secara production-grade. Kita akan membahas perbedaan thread-safe, immutable, unmodifiable, synchronized, concurrent; Java Memory Model; safe publication; compound actions; synchronized wrappers; `ConcurrentHashMap`; `CopyOnWriteArrayList`; blocking queues; weakly-consistent iteration; fail-fast iteration; parallel streams; dan desain collection state yang aman dalam multi-threaded services.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Collection + Concurrency = State Sharing Problem](#2-mental-model-collection--concurrency--state-sharing-problem)
3. [Thread-Safe vs Immutable vs Unmodifiable vs Concurrent](#3-thread-safe-vs-immutable-vs-unmodifiable-vs-concurrent)
4. [Java Memory Model dan Visibility](#4-java-memory-model-dan-visibility)
5. [Safe Publication](#5-safe-publication)
6. [Data Race pada Collections](#6-data-race-pada-collections)
7. [Compound Actions](#7-compound-actions)
8. [Check-Then-Act Race](#8-check-then-act-race)
9. [Read-Modify-Write Race](#9-read-modify-write-race)
10. [Fail-Fast Iteration](#10-fail-fast-iteration)
11. [Weakly-Consistent Iteration](#11-weakly-consistent-iteration)
12. [Snapshot Iteration](#12-snapshot-iteration)
13. [Synchronized Wrappers](#13-synchronized-wrappers)
14. [Manual Synchronization During Iteration](#14-manual-synchronization-during-iteration)
15. [`ConcurrentHashMap`](#15-concurrenthashmap)
16. [Atomic Map Operations](#16-atomic-map-operations)
17. [`computeIfAbsent` Correctness](#17-computeifabsent-correctness)
18. [Frequency Maps with `LongAdder`](#18-frequency-maps-with-longadder)
19. [`CopyOnWriteArrayList`](#19-copyonwritearraylist)
20. [`ConcurrentLinkedQueue`](#20-concurrentlinkedqueue)
21. [`BlockingQueue`](#21-blockingqueue)
22. [Producer-Consumer Pattern](#22-producer-consumer-pattern)
23. [Backpressure](#23-backpressure)
24. [`ConcurrentSkipListMap` and Sorted Concurrent Collections](#24-concurrentskiplistmap-and-sorted-concurrent-collections)
25. [Immutable Snapshots](#25-immutable-snapshots)
26. [Defensive Copying in Concurrent APIs](#26-defensive-copying-in-concurrent-apis)
27. [Collections in Caches](#27-collections-in-caches)
28. [Collections in Request-Scoped vs Singleton Services](#28-collections-in-request-scoped-vs-singleton-services)
29. [Streams and Concurrent Collections](#29-streams-and-concurrent-collections)
30. [Parallel Streams and Shared Collections](#30-parallel-streams-and-shared-collections)
31. [Lock Granularity](#31-lock-granularity)
32. [Contention and Scalability](#32-contention-and-scalability)
33. [Deadlocks with Collections](#33-deadlocks-with-collections)
34. [Testing Concurrent Collection Code](#34-testing-concurrent-collection-code)
35. [Observability and Diagnostics](#35-observability-and-diagnostics)
36. [Common Anti-Patterns](#36-common-anti-patterns)
37. [Production Failure Modes](#37-production-failure-modes)
38. [Best Practices](#38-best-practices)
39. [Decision Matrix](#39-decision-matrix)
40. [Latihan](#40-latihan)
41. [Ringkasan](#41-ringkasan)
42. [Referensi](#42-referensi)

---

# 1. Tujuan Bagian Ini

Collections sangat sering menjadi shared state.

Contoh:

```java
class SessionRegistry {
    private final Map<UserId, Session> sessions = new HashMap<>();

    void register(UserId userId, Session session) {
        sessions.put(userId, session);
    }

    Optional<Session> find(UserId userId) {
        return Optional.ofNullable(sessions.get(userId));
    }
}
```

Jika `SessionRegistry` adalah singleton bean dan diakses banyak request thread, `HashMap` di atas tidak aman.

Masalah yang bisa muncul:

- data race;
- lost update;
- stale read;
- corrupted internal structure;
- `ConcurrentModificationException`;
- duplicate initialization;
- memory visibility bug;
- inconsistent iteration;
- deadlock;
- throughput collapse karena lock terlalu kasar;
- false sense of safety karena memakai unmodifiable view;
- unsafe compound actions pada concurrent collections;
- parallel stream yang menulis ke shared collection.

Tujuan bagian ini:

- memahami collection thread-safety secara benar;
- membedakan immutable, unmodifiable, synchronized, concurrent;
- memahami safe publication dan visibility;
- memilih concurrent collection yang tepat;
- menghindari compound action race;
- memahami weakly-consistent/snapshot/fail-fast iterators;
- mendesain shared collection state yang aman dan scalable.

---

# 2. Mental Model: Collection + Concurrency = State Sharing Problem

Concurrency problem muncul ketika:

```text
lebih dari satu thread mengakses state yang sama
dan setidaknya satu thread melakukan write
tanpa coordination yang benar
```

Collection adalah state.

Jika collection shared dan mutable, ia butuh strategi concurrency.

## 2.1 Strategy options

1. Jangan share.
2. Buat immutable.
3. Share snapshot.
4. Guard dengan lock.
5. Gunakan concurrent collection.
6. Gunakan message passing/queue.
7. Gunakan actor/single writer.
8. Gunakan database/transaction sebagai source of truth.

## 2.2 Main rule

```text
The safest shared collection is the one you do not mutate concurrently.
```

---

# 3. Thread-Safe vs Immutable vs Unmodifiable vs Concurrent

## 3.1 Thread-safe

Object bisa digunakan oleh banyak thread tanpa corrupt state jika contract dipatuhi.

## 3.2 Immutable

State tidak berubah setelah construction.

Immutable object aman dibaca banyak thread jika safely published.

## 3.3 Unmodifiable

Reference tidak menyediakan mutating methods, tetapi backing collection bisa tetap berubah.

```java
List<T> view = Collections.unmodifiableList(mutableList);
```

`view` bukan immutable jika `mutableList` masih bisa diubah.

## 3.4 Concurrent

Collection didesain untuk concurrent access/update.

Contoh:

```java
ConcurrentHashMap
ConcurrentLinkedQueue
CopyOnWriteArrayList
BlockingQueue
ConcurrentSkipListMap
```

## 3.5 Rule

Unmodifiable is not concurrency-safe by itself. Immutable snapshot is much safer.

---

# 4. Java Memory Model dan Visibility

Thread A menulis ke collection.

Thread B membaca collection.

Tanpa happens-before relationship, thread B bisa melihat stale state.

## 4.1 Example

```java
class Holder {
    List<String> list;

    void init() {
        list = new ArrayList<>();
        list.add("READY");
    }

    boolean ready() {
        return list != null && list.contains("READY");
    }
}
```

Tanpa safe publication, thread lain bisa melihat state tidak konsisten.

## 4.2 Coordination mechanisms

- final fields;
- volatile reference;
- synchronized;
- locks;
- thread-safe collections;
- executor/task boundaries;
- concurrent utilities.

## 4.3 Rule

Concurrency correctness includes visibility, not only atomicity.

---

# 5. Safe Publication

Safe publication means object state visible correctly to other threads.

## 5.1 Final field

```java
final class Config {
    private final List<String> allowedHosts;

    Config(Collection<String> allowedHosts) {
        this.allowedHosts = List.copyOf(allowedHosts);
    }

    List<String> allowedHosts() {
        return allowedHosts;
    }
}
```

Final field + immutable copy is strong pattern.

## 5.2 Volatile reference for snapshot replacement

```java
class RoutingTable {
    private volatile Map<RouteKey, Route> routes = Map.of();

    void replace(Map<RouteKey, Route> newRoutes) {
        routes = Map.copyOf(newRoutes);
    }

    Optional<Route> find(RouteKey key) {
        return Optional.ofNullable(routes.get(key));
    }
}
```

## 5.3 Rule

For read-mostly state, volatile immutable snapshot is often simple and robust.

---

# 6. Data Race pada Collections

Bad:

```java
List<Event> events = new ArrayList<>();

// Thread A
events.add(event);

// Thread B
events.stream().count();
```

Without synchronization, this is data race.

## 6.1 Possible outcomes

- stale reads;
- `ConcurrentModificationException`;
- inconsistent result;
- internal corruption;
- lost elements.

## 6.2 Rule

Mutable non-thread-safe collections must not be accessed concurrently without external synchronization.

---

# 7. Compound Actions

A compound action is multiple operations that must be atomic together.

Example:

```java
if (!map.containsKey(key)) {
    map.put(key, value);
}
```

Even with synchronized/concurrent map, this sequence may not be atomic unless guarded or replaced with atomic operation.

## 7.1 Rule

Thread-safe individual methods do not automatically make multi-step logic thread-safe.

---

# 8. Check-Then-Act Race

Bad:

```java
if (!sessions.containsKey(userId)) {
    sessions.put(userId, createSession(userId));
}
```

Two threads can both create session.

## 8.1 Correct with `computeIfAbsent`

```java
Session session = sessions.computeIfAbsent(userId, this::createSession);
```

## 8.2 Caveat

Mapping function should be side-effect safe and not too expensive/blocking.

## 8.3 Rule

Use atomic map operations for check-then-act.

---

# 9. Read-Modify-Write Race

Bad:

```java
Integer count = counts.get(key);
counts.put(key, count == null ? 1 : count + 1);
```

Lost update under concurrency.

## 9.1 Correct options

```java
counts.merge(key, 1, Integer::sum);
```

or:

```java
ConcurrentHashMap<Key, LongAdder> counts = new ConcurrentHashMap<>();

counts.computeIfAbsent(key, k -> new LongAdder()).increment();
```

## 9.2 Rule

Counters need atomic update strategy.

---

# 10. Fail-Fast Iteration

Many non-concurrent collections have fail-fast iterators.

Example:

```java
for (Item item : list) {
    list.add(other); // ConcurrentModificationException
}
```

## 10.1 Important

Fail-fast is bug detection, not correctness guarantee.

## 10.2 In concurrency

Another thread mutating during iteration may trigger exception or undefined behavior.

## 10.3 Rule

Do not rely on fail-fast for synchronization.

---

# 11. Weakly-Consistent Iteration

Concurrent collections often provide weakly-consistent iterators.

They may reflect some, all, or none of concurrent modifications after iterator creation, but do not usually throw `ConcurrentModificationException`.

Example:

```java
ConcurrentHashMap<Key, Value> map = new ConcurrentHashMap<>();

for (Key key : map.keySet()) {
    // concurrent updates may or may not be seen
}
```

## 11.1 Use case

Monitoring/snapshot-ish traversal where exact consistency not required.

## 11.2 Rule

Weakly-consistent iteration is safe but not a transactional snapshot.

---

# 12. Snapshot Iteration

`CopyOnWriteArrayList` iterator observes snapshot at iterator creation.

```java
CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();

for (Listener listener : listeners) {
    listener.onEvent(event);
}
```

Concurrent add/remove won't affect current iteration.

## 12.1 Good for listeners

Read/iterate often, mutate rarely.

## 12.2 Bad for frequent writes

Every write copies array.

## 12.3 Rule

Snapshot iteration is ideal for read-heavy, write-rare listener-style collections.

---

# 13. Synchronized Wrappers

`Collections.synchronizedList` wraps collection methods with synchronization.

```java
List<T> list = Collections.synchronizedList(new ArrayList<>());
```

## 13.1 Individual method safety

```java
list.add(x);
list.get(0);
```

are synchronized.

## 13.2 Compound actions still need external synchronization

```java
synchronized (list) {
    if (!list.isEmpty()) {
        return list.get(0);
    }
}
```

## 13.3 Rule

Synchronized wrappers protect individual calls, not arbitrary multi-call logic.

---

# 14. Manual Synchronization During Iteration

For synchronized wrapper:

```java
List<T> list = Collections.synchronizedList(new ArrayList<>());

synchronized (list) {
    Iterator<T> it = list.iterator();
    while (it.hasNext()) {
        process(it.next());
    }
}
```

## 14.1 Why

Iteration is multi-step.

## 14.2 Rule

When using synchronized wrappers, manually synchronize during iteration.

---

# 15. `ConcurrentHashMap`

`ConcurrentHashMap` is the workhorse concurrent map.

## 15.1 Good for

- concurrent lookup/update;
- caches;
- registries;
- counters with `LongAdder`;
- idempotency maps;
- dedup maps.

## 15.2 Does not allow null keys/values

This avoids ambiguity in concurrent contexts.

## 15.3 Iteration

Weakly consistent.

## 15.4 Rule

Use `ConcurrentHashMap` for shared mutable maps with concurrent access.

---

# 16. Atomic Map Operations

Important operations:

```java
putIfAbsent
computeIfAbsent
compute
computeIfPresent
merge
replace
remove(key, value)
```

## 16.1 Example: registration

```java
Session existing = sessions.putIfAbsent(userId, newSession);
if (existing != null) {
    return existing;
}
return newSession;
```

## 16.2 Example: merge

```java
counts.merge(status, 1L, Long::sum);
```

## 16.3 Rule

Prefer atomic map methods over external check-then-act logic.

---

# 17. `computeIfAbsent` Correctness

Common pattern:

```java
CacheValue value = cache.computeIfAbsent(key, this::load);
```

## 17.1 Good

Avoids duplicate insertion.

## 17.2 Caution

Mapping function may be invoked under map-internal coordination.

Avoid:

- blocking too long;
- calling back into same map with complex dependencies;
- side effects that cannot repeat;
- relying on thread-local context unexpectedly.

## 17.3 Rule

`computeIfAbsent` mapping function should be deterministic, bounded, and side-effect cautious.

---

# 18. Frequency Maps with `LongAdder`

High-concurrency counter:

```java
ConcurrentHashMap<String, LongAdder> counts = new ConcurrentHashMap<>();

void record(String key) {
    counts.computeIfAbsent(key, k -> new LongAdder()).increment();
}

long count(String key) {
    LongAdder adder = counts.get(key);
    return adder == null ? 0L : adder.sum();
}
```

## 18.1 Why LongAdder

Better under high contention than single atomic counter.

## 18.2 Snapshot semantics

`sum()` is not necessarily atomic with concurrent updates.

Usually fine for metrics.

## 18.3 Rule

Use `LongAdder` for high-throughput approximate/current counters, not strict transactional counts.

---

# 19. `CopyOnWriteArrayList`

Good for listener lists.

```java
class EventBus {
    private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();

    void register(Listener listener) {
        listeners.addIfAbsent(listener);
    }

    void publish(Event event) {
        for (Listener listener : listeners) {
            listener.onEvent(event);
        }
    }
}
```

## 19.1 Pros

- iteration no lock;
- no ConcurrentModificationException;
- snapshot semantics.

## 19.2 Cons

- expensive writes;
- memory copy on mutation;
- not for large/high-write lists.

## 19.3 Rule

Use copy-on-write collections for small read-heavy/write-rare sets.

---

# 20. `ConcurrentLinkedQueue`

Non-blocking concurrent FIFO queue.

## 20.1 Good for

- handoff where consumer polls;
- non-blocking event queues;
- internal buffers with external backpressure.

## 20.2 Missing backpressure

It is unbounded.

## 20.3 Rule

Use concurrent linked queues carefully; unbounded queues can become memory leaks.

---

# 21. `BlockingQueue`

Blocking queues support producer-consumer coordination.

Examples:

```java
ArrayBlockingQueue
LinkedBlockingQueue
PriorityBlockingQueue
DelayQueue
SynchronousQueue
```

## 21.1 Bounded queue

```java
BlockingQueue<Task> queue = new ArrayBlockingQueue<>(1000);
```

## 21.2 put/take

```java
queue.put(task);
Task task = queue.take();
```

## 21.3 Rule

Use bounded blocking queues when you need handoff plus backpressure.

---

# 22. Producer-Consumer Pattern

Producer:

```java
void submit(Task task) throws InterruptedException {
    queue.put(task);
}
```

Consumer:

```java
while (!Thread.currentThread().isInterrupted()) {
    Task task = queue.take();
    process(task);
}
```

## 22.1 Interruption

Always restore interrupt if catching `InterruptedException` and cannot throw.

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

## 22.2 Rule

Producer-consumer designs require shutdown/interruption strategy.

---

# 23. Backpressure

Backpressure means producers are slowed when consumers cannot keep up.

## 23.1 Bounded queue

`put` blocks when full.

## 23.2 Offer with timeout

```java
boolean accepted = queue.offer(task, 100, TimeUnit.MILLISECONDS);
```

## 23.3 Reject policy

If queue full, reject/degrade.

## 23.4 Rule

Unbounded collection buffers hide overload until memory fails.

---

# 24. `ConcurrentSkipListMap` and Sorted Concurrent Collections

Use when you need sorted concurrent map.

```java
ConcurrentSkipListMap<Instant, Event> events = new ConcurrentSkipListMap<>();
```

## 24.1 Use cases

- time windows;
- range queries;
- ordered concurrent keys.

## 24.2 Cost

More overhead than `ConcurrentHashMap`.

## 24.3 Rule

Use sorted concurrent collections only when concurrent range/order queries are required.

---

# 25. Immutable Snapshots

Read-mostly state can use immutable snapshot replacement.

```java
class FeatureFlags {
    private volatile Map<String, Boolean> flags = Map.of();

    void reload(Map<String, Boolean> newFlags) {
        this.flags = Map.copyOf(newFlags);
    }

    boolean enabled(String key) {
        return flags.getOrDefault(key, false);
    }
}
```

## 25.1 Pros

- readers lock-free;
- simple visibility via volatile;
- no concurrent mutation.

## 25.2 Cons

- update copies whole map;
- not for high-frequency writes.

## 25.3 Rule

Immutable snapshot is excellent for configuration/routing/read-mostly state.

---

# 26. Defensive Copying in Concurrent APIs

When returning collection from concurrent object:

```java
List<Session> sessions() {
    return List.copyOf(sessionsByUser.values());
}
```

## 26.1 Snapshot not necessarily linearizable

For concurrent map values, snapshot may reflect weakly consistent traversal.

If exact consistency required, synchronize/lock or use stronger design.

## 26.2 Rule

Document whether snapshot is approximate or consistent.

---

# 27. Collections in Caches

Caches are concurrent maps with policies.

## 27.1 Avoid DIY cache if complex

Need:

- eviction;
- TTL;
- size bounds;
- refresh;
- metrics;
- stampede prevention.

## 27.2 DIY simple cache

```java
ConcurrentHashMap<Key, Value> cache = new ConcurrentHashMap<>();
```

May be okay for small stable data.

## 27.3 Rule

For production cache semantics, prefer proven cache library or explicit bounded design.

---

# 28. Collections in Request-Scoped vs Singleton Services

Request-scoped local collections:

```java
List<Item> items = new ArrayList<>();
```

Usually safe if not shared.

Singleton service fields:

```java
private final List<Item> items = new ArrayList<>();
```

Shared across threads.

## 28.1 Rule

Local method collections are usually safe; singleton mutable fields need concurrency design.

---

# 29. Streams and Concurrent Collections

Stream over concurrent collection:

```java
map.entrySet().stream()
```

may be weakly consistent.

## 29.1 Concurrent modification

May not throw, but result may reflect concurrent changes partially.

## 29.2 Rule

If you need consistent snapshot, copy first.

```java
List<Entry<K,V>> snapshot = List.copyOf(map.entrySet());
```

---

# 30. Parallel Streams and Shared Collections

Bad:

```java
List<Result> results = new ArrayList<>();

items.parallelStream()
    .map(this::compute)
    .forEach(results::add);
```

ArrayList is not thread-safe.

## 30.1 Correct

```java
List<Result> results = items.parallelStream()
    .map(this::compute)
    .toList();
```

or collector.

## 30.2 Rule

Do not mutate shared non-thread-safe collections from parallel stream.

---

# 31. Lock Granularity

## 31.1 Coarse lock

One lock for whole collection.

Simple but contention high.

## 31.2 Fine-grained

Multiple locks/segments.

Higher throughput but complex.

## 31.3 Lock-free/concurrent collection

Use JDK implementation where possible.

## 31.4 Rule

Prefer proven concurrent collections before custom lock schemes.

---

# 32. Contention and Scalability

Thread-safe does not mean scalable.

## 32.1 Bottlenecks

- synchronized list under heavy writes;
- single AtomicLong counter;
- global lock around map;
- blocking queue with slow consumer;
- copy-on-write list with frequent writes.

## 32.2 Rule

Measure contention under realistic concurrency.

---

# 33. Deadlocks with Collections

Deadlock can occur if locking multiple collections in inconsistent order.

Bad:

```java
synchronized (a) {
    synchronized (b) {
        ...
    }
}
```

Another thread locks b then a.

## 33.1 Fix

- consistent lock order;
- single higher-level lock;
- tryLock with timeout;
- avoid external locks.

## 33.2 Rule

Do not expose locks/collections that callers may lock unpredictably.

---

# 34. Testing Concurrent Collection Code

Testing concurrency is hard.

## 34.1 Tests

- stress tests;
- repeated runs;
- race detection by design review;
- jcstress for JMM-level issues;
- executor-based concurrent tests;
- timeouts;
- invariants under load.

## 34.2 Invariants

Examples:

```text
no duplicate sessions
count never negative
all submitted tasks eventually processed
no missing IDs
```

## 34.3 Rule

Concurrent collection code needs stress/invariant testing, not only unit examples.

---

# 35. Observability and Diagnostics

Monitor:

- collection size;
- queue depth;
- map entry count;
- rejection count;
- blocking time;
- lock contention;
- task latency;
- duplicate initialization count;
- cache hit/miss;
- thread pool saturation;
- GC/memory.

## 35.1 Rule

Concurrency bugs often appear first as latency, queue growth, or memory symptoms.

---

# 36. Common Anti-Patterns

## 36.1 `HashMap` shared in singleton service

Race.

## 36.2 `Collections.unmodifiableList` over mutable list as “thread-safe”

Wrong.

## 36.3 `containsKey` then `put` on concurrent map

Race.

## 36.4 Mutating ArrayList from parallel stream

Race.

## 36.5 Unbounded queue as backpressure

Memory leak.

## 36.6 CopyOnWriteArrayList for high-write workload

Performance disaster.

## 36.7 Holding lock while calling external code

Deadlock/latency.

## 36.8 Iterating synchronized wrapper without synchronized block

Unsafe.

## 36.9 Assuming weakly-consistent iteration is exact snapshot

Wrong.

## 36.10 Ignoring interrupt in blocking queue consumer

Shutdown bug.

---

# 37. Production Failure Modes

## 37.1 Lost update

Counter/map updated with get-then-put.

## 37.2 Duplicate initialization

`containsKey`/`put` race.

## 37.3 Stale config

Unsafe publication.

## 37.4 ConcurrentModificationException

Iteration while mutable list changed.

## 37.5 Memory leak

Unbounded queue grows under overload.

## 37.6 Throughput collapse

Global synchronized collection under contention.

## 37.7 Listener missing event

Copy/update semantics misunderstood.

## 37.8 Deadlock

Locks acquired in inconsistent order.

## 37.9 Inconsistent security roles

Mutable shared set changed without visibility/locking.

## 37.10 Parallel stream corruption

Shared mutable output collection.

---

# 38. Best Practices

## 38.1 Avoid shared mutable collections

Prefer local variables or immutable snapshots.

## 38.2 Use final fields and defensive copies

For immutable state.

## 38.3 Use volatile immutable snapshot for read-mostly configs

Simple and safe.

## 38.4 Use concurrent collections for shared mutable state

Pick based on access pattern.

## 38.5 Use atomic map operations

`computeIfAbsent`, `merge`, `putIfAbsent`.

## 38.6 Use bounded queues for producer-consumer

Backpressure matters.

## 38.7 Do not mutate shared collection in parallel streams

Use collectors.

## 38.8 Be explicit about iteration semantics

Fail-fast, weakly-consistent, or snapshot.

## 38.9 Keep locks private

Avoid exposing lockable internals.

## 38.10 Test under concurrency and observe in production

Metrics and stress tests.

---

# 39. Decision Matrix

| Need | Recommended |
|---|---|
| read-only shared config | immutable snapshot + final/volatile |
| frequent concurrent map updates | `ConcurrentHashMap` |
| high-contention counters | `LongAdder` in `ConcurrentHashMap` |
| listener list | `CopyOnWriteArrayList` |
| producer-consumer with backpressure | bounded `BlockingQueue` |
| non-blocking FIFO | `ConcurrentLinkedQueue` |
| sorted concurrent map | `ConcurrentSkipListMap` |
| exact consistent snapshot | lock/copy under coordination |
| approximate monitoring traversal | weakly-consistent concurrent iterator |
| simple local processing | `ArrayList` local variable |
| synchronized legacy collection | synchronized wrapper + manual iteration lock |
| check-then-act map logic | `computeIfAbsent`/`putIfAbsent` |
| count updates | `merge` or `LongAdder` |
| parallel transformation result | stream collector, not shared mutation |
| high write list | not `CopyOnWriteArrayList` |
| overload control | bounded queue/rejection/backpressure |

---

# 40. Latihan

## Latihan 1 — HashMap Race

Create singleton-style registry with `HashMap`, then refactor to `ConcurrentHashMap`.

## Latihan 2 — Check-Then-Act

Refactor `containsKey` + `put` to `computeIfAbsent`.

## Latihan 3 — Counter Race

Refactor `Map<K, Integer>` counter to `ConcurrentHashMap<K, LongAdder>`.

## Latihan 4 — Synchronized Wrapper Iteration

Demonstrate correct manual synchronization while iterating synchronized list.

## Latihan 5 — Parallel Stream Race

Show why adding to shared `ArrayList` in `parallelStream().forEach` is unsafe.

## Latihan 6 — Immutable Snapshot Config

Implement `volatile Map.copyOf` routing table.

## Latihan 7 — Bounded Queue

Build producer-consumer with `ArrayBlockingQueue` and interrupt-aware shutdown.

## Latihan 8 — CopyOnWrite Listener

Implement listener registry with `CopyOnWriteArrayList`.

## Latihan 9 — Weakly Consistent Iterator

Iterate `ConcurrentHashMap` while updating it and describe possible observations.

## Latihan 10 — Concurrency Design Review

For a shared collection in your codebase, identify owner, mutation paths, visibility, atomic operations, and iteration semantics.

---

# 41. Ringkasan

Collections and concurrency are about shared mutable state.

Core lessons:

- Mutable shared collection needs concurrency strategy.
- Thread-safe, immutable, unmodifiable, synchronized, and concurrent are different concepts.
- Visibility matters as much as atomicity.
- Safe publication is required for shared objects.
- Compound actions need atomic operations or locks.
- Fail-fast iterators detect bugs but are not synchronization.
- Concurrent iterators are often weakly consistent, not exact snapshots.
- Copy-on-write is great for read-heavy/write-rare workloads.
- Synchronized wrappers require external synchronization for iteration.
- `ConcurrentHashMap` atomic operations prevent common races.
- `LongAdder` helps high-contention counters.
- Bounded blocking queues provide backpressure.
- Immutable snapshots are powerful for read-mostly state.
- Parallel streams must not mutate shared non-thread-safe collections.
- Concurrency correctness includes shutdown, interruption, lock granularity, and observability.

Main rule:

```text
Before sharing a collection across threads, decide:
who owns it, who mutates it, how visibility is guaranteed,
which operations must be atomic, and what iteration semantics are acceptable.
```

---

# 42. Referensi

1. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

2. Java SE 25 — `CopyOnWriteArrayList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html

3. Java SE 25 — `BlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html

4. Java SE 25 — `ConcurrentLinkedQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentLinkedQueue.html

5. Java SE 25 — `ConcurrentSkipListMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentSkipListMap.html

6. Java SE 25 — `LongAdder`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html

7. Java SE 25 — `Collections.synchronizedList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#synchronizedList(java.util.List)

8. Java SE 25 — `ArrayBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ArrayBlockingQueue.html

9. Java SE 25 — `ExecutorService`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html

10. OpenJDK jcstress  
    https://openjdk.org/projects/code-tools/jcstress/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-052.md](./learn-java-collections-and-streams-part-052.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-054.md](./learn-java-collections-and-streams-part-054.md)

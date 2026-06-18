# learn-java-collections-and-streams-part-054.md

# Java Collections and Streams — Part 054  
# Collections and Memory Leaks: Static Collections, Unbounded Caches, Listener Registries, ThreadLocal, SubList/Slice Retention, Weak References, ORM Persistence Context, Resource Streams, and Heap Diagnostics

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **054**  
> Fokus: memahami bagaimana Collections dan Streams bisa menyebabkan memory leak di Java production systems. Kita akan membahas static collections, unbounded maps/lists, cache tanpa eviction, listener/subscriber registry, `ThreadLocal`, `subList`/view retention, map key/value retention, weak/soft references, classloader leaks, ORM persistence context growth, stream/resource leaks, queue backlog, metrics label cardinality, serta cara diagnosis dengan heap dump, dominator tree, GC logs, JFR, dan production-safe mitigation.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Memory Leak di Java = Object Masih Reachable](#2-mental-model-memory-leak-di-java--object-masih-reachable)
3. [Collections sebagai Retention Root](#3-collections-sebagai-retention-root)
4. [Static Collection Leaks](#4-static-collection-leaks)
5. [Singleton Service Collection Leaks](#5-singleton-service-collection-leaks)
6. [Unbounded Cache Leaks](#6-unbounded-cache-leaks)
7. [Missing Eviction Policy](#7-missing-eviction-policy)
8. [Listener/Subscriber Registry Leaks](#8-listenersubscriber-registry-leaks)
9. [ThreadLocal Collection Leaks](#9-threadlocal-collection-leaks)
10. [Queue Backlog as Memory Leak](#10-queue-backlog-as-memory-leak)
11. [Map Key Retention](#11-map-key-retention)
12. [Map Value Retention](#12-map-value-retention)
13. [Composite Key Leaks](#13-composite-key-leaks)
14. [SubList/View Retention](#14-sublistview-retention)
15. [Iterator and Stream Retention](#15-iterator-and-stream-retention)
16. [Resource-Backed Stream Leaks](#16-resource-backed-stream-leaks)
17. [Collectors and Accidental Materialization](#17-collectors-and-accidental-materialization)
18. [Grouping/Distinct/Sorted Memory Growth](#18-groupingdistinctsorted-memory-growth)
19. [ORM Persistence Context Growth](#19-orm-persistence-context-growth)
20. [Batch Processing and Persistence Context Leaks](#20-batch-processing-and-persistence-context-leaks)
21. [ClassLoader Leaks via Collections](#21-classloader-leaks-via-collections)
22. [Metrics Cardinality Leaks](#22-metrics-cardinality-leaks)
23. [Logging and Error Collection Leaks](#23-logging-and-error-collection-leaks)
24. [WeakHashMap](#24-weakhashmap)
25. [WeakReference, SoftReference, PhantomReference](#25-weakreference-softreference-phantomreference)
26. [ReferenceQueue Cleanup](#26-referencequeue-cleanup)
27. [When Weak References Are Not Enough](#27-when-weak-references-are-not-enough)
28. [Bounded Collections](#28-bounded-collections)
29. [Eviction Strategies](#29-eviction-strategies)
30. [Memory Leak Diagnostics](#30-memory-leak-diagnostics)
31. [Heap Dump Analysis](#31-heap-dump-analysis)
32. [Dominator Tree and Retained Size](#32-dominator-tree-and-retained-size)
33. [GC Logs and Memory Trend](#33-gc-logs-and-memory-trend)
34. [JFR and Allocation Profiling](#34-jfr-and-allocation-profiling)
35. [Production Mitigation Patterns](#35-production-mitigation-patterns)
36. [Common Anti-Patterns](#36-common-anti-patterns)
37. [Production Failure Modes](#37-production-failure-modes)
38. [Best Practices](#38-best-practices)
39. [Decision Matrix](#39-decision-matrix)
40. [Latihan](#40-latihan)
41. [Ringkasan](#41-ringkasan)
42. [Referensi](#42-referensi)

---

# 1. Tujuan Bagian Ini

Java memiliki garbage collector, tetapi bukan berarti memory leak tidak mungkin.

Memory leak di Java biasanya terjadi ketika object yang seharusnya tidak dibutuhkan lagi masih **reachable** dari GC root.

Collections sering menjadi penyebab karena mereka memang didesain untuk menahan reference.

Contoh:

```java
class AuditBuffer {
    private static final List<AuditEvent> EVENTS = new ArrayList<>();

    static void record(AuditEvent event) {
        EVENTS.add(event);
    }
}
```

Jika tidak pernah dibersihkan, `EVENTS` akan tumbuh selamanya.

Contoh lain:

```java
Map<UserId, UserSession> sessions = new ConcurrentHashMap<>();
```

Jika session tidak pernah expire/remove, map menjadi leak.

Contoh stream:

```java
List<Record> all = Files.lines(path)
    .map(this::parse)
    .toList();
```

Jika file besar, ini bukan leak klasik, tetapi accidental materialization yang bisa membuat memory habis.

Tujuan bagian ini:

- memahami memory leak dari sudut object reachability;
- mengidentifikasi collection retention patterns;
- memahami static/singleton/cache/listener/threadlocal leaks;
- memahami view/subList/stream retention;
- memahami unbounded queue/cache/grouping leaks;
- memahami weak references dan batasannya;
- mendesain bounded/evicting collections;
- mendiagnosis leak dengan heap dump, retained size, GC logs, dan JFR.

---

# 2. Mental Model: Memory Leak di Java = Object Masih Reachable

Garbage collector membebaskan object yang tidak reachable.

Jika object masih reachable dari GC root, object tidak bisa di-GC.

GC roots termasuk:

- thread stack;
- static fields;
- JNI references;
- classloader references;
- active monitors;
- internal JVM roots.

Collection leak berarti:

```text
GC Root -> collection -> element/key/value -> object graph besar
```

## 2.1 Leak bukan selalu object yang “hilang”

Object bisa masih ada karena kita sendiri menyimpan reference.

## 2.2 Leak vs high allocation

- High allocation: object dibuat banyak tetapi cepat mati.
- Memory leak: object lama tetap hidup dan jumlahnya naik.

## 2.3 Main rule

```text
If a collection keeps a reference, the entire referenced object graph may stay alive.
```

---

# 3. Collections sebagai Retention Root

Collection bisa menahan:

- key;
- value;
- element;
- node internal;
- backing array;
- comparator;
- listener callback;
- lambda capturing object;
- view terhadap collection lain;
- iterator/stream pipeline state.

Contoh:

```java
Map<RequestId, RequestContext> contexts = new HashMap<>();
```

Satu `RequestContext` bisa menahan:

```text
user
headers
body
security principal
DB entity graph
large byte[]
```

## 3.1 Rule

Memory cost collection bukan hanya jumlah entry, tetapi retained graph dari setiap entry.

---

# 4. Static Collection Leaks

Static collection hidup selama classloader hidup.

Bad:

```java
public final class GlobalRegistry {
    private static final Map<String, Object> REGISTRY = new HashMap<>();

    public static void register(String key, Object value) {
        REGISTRY.put(key, value);
    }
}
```

Jika tidak ada remove/eviction, leak.

## 4.1 Static cache danger

Static cache sering luput dari lifecycle management.

## 4.2 Fix

- avoid static mutable state;
- use bounded cache;
- provide remove/clear lifecycle;
- use dependency-managed singleton with shutdown hook;
- prefer cache library.

## 4.3 Rule

Static mutable collections must be treated as process-lifetime storage.

---

# 5. Singleton Service Collection Leaks

In Spring/service apps, singleton beans live for app lifetime.

Bad:

```java
@Service
class ImportService {
    private final List<ImportResult> results = new ArrayList<>();

    void importFile(File file) {
        results.add(runImport(file));
    }
}
```

This accumulates across requests.

## 5.1 Local variable fix

```java
void importFile(File file) {
    List<ImportResult> results = new ArrayList<>();
    ...
}
```

## 5.2 Rule

Do not put per-request/per-job collections in singleton fields.

---

# 6. Unbounded Cache Leaks

Map used as cache:

```java
private final Map<Key, Value> cache = new ConcurrentHashMap<>();
```

Without eviction, it is not a cache; it is an unbounded map.

## 6.1 Common cache keys

- user id;
- request id;
- query string;
- tenant id;
- token;
- file path;
- dynamic filter map;
- raw input.

## 6.2 Attack risk

User-controlled keys can create unbounded entries.

## 6.3 Rule

A cache without size/TTL/eviction policy is a memory leak waiting to happen.

---

# 7. Missing Eviction Policy

Eviction options:

## 7.1 Size-based

Limit number of entries or weight.

## 7.2 Time-based

Expire after write/access.

## 7.3 Reference-based

Weak/soft references.

## 7.4 Explicit lifecycle

Remove on logout/job completion/event.

## 7.5 Rule

Eviction policy must match data lifecycle.

---

# 8. Listener/Subscriber Registry Leaks

Listener registry:

```java
class EventBus {
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();

    void register(Listener listener) {
        listeners.add(listener);
    }
}
```

If listeners never unregister, they remain alive.

## 8.1 Lambda capture leak

```java
eventBus.register(event -> this.handle(event));
```

The listener captures `this`, retaining whole object.

## 8.2 Fix

- return subscription handle;
- unregister in lifecycle destroy;
- weak listener pattern carefully;
- use scoped event bus.

## 8.3 Rule

Every registration API needs deregistration/lifecycle story.

---

# 9. ThreadLocal Collection Leaks

`ThreadLocal` values live as long as thread lives unless removed.

In thread pools, threads live long.

Bad:

```java
private static final ThreadLocal<List<RequestLog>> LOGS =
    ThreadLocal.withInitial(ArrayList::new);

void handle() {
    LOGS.get().add(...);
}
```

If not cleared, data can accumulate per worker thread.

## 9.1 Fix

```java
try {
    ...
} finally {
    LOGS.remove();
}
```

## 9.2 Rule

Always remove ThreadLocal values in pooled-thread environments.

---

# 10. Queue Backlog as Memory Leak

Unbounded queues can grow under overload.

```java
Queue<Task> queue = new ConcurrentLinkedQueue<>();
```

If producers faster than consumers, memory grows.

## 10.1 Symptom

Looks like leak, but actually backlog.

## 10.2 Fix

- bounded queue;
- backpressure;
- rejection policy;
- rate limiting;
- autoscaling;
- monitoring queue depth.

## 10.3 Rule

Unbounded queue is deferred failure.

---

# 11. Map Key Retention

Map holds strong references to keys.

```java
Map<Request, Result> results = new HashMap<>();
```

If `Request` contains large body, map retains it.

## 11.1 Better key

Use small stable key:

```java
Map<RequestId, Result>
```

not whole request object.

## 11.2 Rule

Map keys should be minimal stable identifiers, not large object graphs.

---

# 12. Map Value Retention

Values can retain huge graph.

```java
Map<UserId, UserEntity> users
```

A user entity may retain orders, sessions, profile, lazy proxies.

## 12.1 Better value

Store DTO/projection/small summary if cache does not need full graph.

## 12.2 Rule

Cache/map values should be as small as the use case allows.

---

# 13. Composite Key Leaks

Composite keys can retain unexpected objects.

Bad:

```java
record CacheKey(User user, SearchRequest request) {}
```

This retains full user and request.

Better:

```java
record CacheKey(UserId userId, String normalizedQuery, int page) {}
```

## 13.1 Rule

Composite keys should contain compact immutable value fields.

---

# 14. SubList/View Retention

`subList` is a view over original list.

```java
List<byte[]> huge = loadHugeList();
List<byte[]> small = huge.subList(0, 10);
```

Depending implementation, `small` may retain reference to `huge` backing structure.

## 14.1 Fix snapshot

```java
List<byte[]> small = List.copyOf(huge.subList(0, 10));
```

## 14.2 Other views

- `Collections.unmodifiableList`;
- map views `keySet`, `values`, `entrySet`;
- `List.reversed`/sequenced views;
- `subMap`, `headMap`, `tailMap`.

Views can retain backing collection.

## 14.3 Rule

If you need small independent result, copy the view.

---

# 15. Iterator and Stream Retention

Iterator/stream can retain source.

```java
Stream<T> stream = hugeList.stream().filter(...);
```

As long as stream is referenced, hugeList may be retained.

## 15.1 Lambda capture

```java
stream.map(x -> this.process(x))
```

captures `this`.

## 15.2 Rule

Do not store streams/iterators as long-lived fields.

---

# 16. Resource-Backed Stream Leaks

Resource-backed streams must be closed.

Bad:

```java
Stream<String> lines = Files.lines(path);
long count = lines.count();
// no close
```

Good:

```java
try (Stream<String> lines = Files.lines(path)) {
    long count = lines.count();
}
```

## 16.1 Resource leak

Not just heap; can leak file descriptors, DB cursors, sockets.

## 16.2 Rule

Any stream backed by external resource belongs in try-with-resources.

---

# 17. Collectors and Accidental Materialization

This can blow memory:

```java
List<Record> records = hugeStream.toList();
```

or:

```java
Map<Key, List<Record>> grouped = hugeStream.collect(groupingBy(...));
```

## 17.1 Not leak, but memory spike

Object may be needed by result, but result too large.

## 17.2 Fix

- process incrementally;
- batch;
- write to sink;
- use database aggregation;
- use bounded collector/top-N;
- stream to file/output.

## 17.3 Rule

Terminal operations that materialize all data need size awareness.

---

# 18. Grouping/Distinct/Sorted Memory Growth

Stateful stream ops retain data.

## 18.1 `distinct`

Needs remember seen elements.

## 18.2 `sorted`

Needs buffer all elements before emitting.

## 18.3 `groupingBy`

Stores all groups/results.

## 18.4 Rule

Stateful operations over unbounded/huge streams can consume unbounded memory.

---

# 19. ORM Persistence Context Growth

ORM persistence context holds managed entities.

```java
List<Entity> all = repository.findAll();
```

or batch loop without clear:

```java
for (...) {
    entityManager.persist(entity);
}
```

Entities remain managed until transaction/context cleared.

## 19.1 Fix

- batch flush/clear;
- pagination;
- stateless session/read-only query;
- DTO projection;
- stream with controlled context.

## 19.2 Rule

Persistence context is a hidden collection of managed entities.

---

# 20. Batch Processing and Persistence Context Leaks

Bad:

```java
@Transactional
void importAll(List<Row> rows) {
    for (Row row : rows) {
        entityManager.persist(map(row));
    }
}
```

For millions rows, persistence context grows.

## 20.1 Fix

```java
int i = 0;
for (Row row : rows) {
    entityManager.persist(map(row));
    if (++i % batchSize == 0) {
        entityManager.flush();
        entityManager.clear();
    }
}
```

## 20.2 Rule

Long transactions with many entities need explicit persistence context management.

---

# 21. ClassLoader Leaks via Collections

Static collections in application server/plugin systems can retain classes/classloaders.

Example:

```java
static Map<String, Class<?>> registry
```

If not cleared on undeploy/reload, old classloader retained.

## 21.1 Common sources

- static caches;
- thread locals;
- logging frameworks;
- JDBC drivers;
- global registries.

## 21.2 Rule

In reloadable environments, static collections need cleanup hooks.

---

# 22. Metrics Cardinality Leaks

Metrics labels are often stored in maps internally.

Bad:

```java
counter("request", "userId", userId.toString()).increment();
```

Each user creates a time series.

## 22.1 Result

Metrics backend and app memory grow.

## 22.2 Fix

Use low-cardinality labels:

```text
endpoint
status
tenant tier
error code
```

not user ID/request ID/raw path.

## 22.3 Rule

Metric label values are keys in long-lived maps; keep cardinality bounded.

---

# 23. Logging and Error Collection Leaks

Collecting all errors:

```java
List<ErrorDetail> errors = new ArrayList<>();
```

for huge import can grow too much.

## 23.1 Fix

- cap errors;
- sample;
- summarize by type;
- write to external report file;
- stream errors to sink.

## 23.2 Rule

Error collections need size policy too.

---

# 24. WeakHashMap

`WeakHashMap` stores keys weakly.

If key no longer strongly reachable elsewhere, entry can be removed after GC.

## 24.1 Use case

Metadata attached to objects you do not own.

```java
Map<Object, Metadata> metadata = new WeakHashMap<>();
```

## 24.2 Caveat

Value can strongly reference key, preventing cleanup.

Bad:

```java
weakMap.put(key, new Value(key));
```

## 24.3 Rule

WeakHashMap helps only if keys are not strongly reachable through values or elsewhere.

---

# 25. WeakReference, SoftReference, PhantomReference

## 25.1 WeakReference

Cleared eagerly when object weakly reachable.

Useful for canonicalization/metadata.

## 25.2 SoftReference

Cleared under memory pressure; behavior can be unpredictable for cache design.

## 25.3 PhantomReference

For post-mortem cleanup with ReferenceQueue.

## 25.4 Rule

Reference types are advanced tools, not replacement for explicit lifecycle/eviction.

---

# 26. ReferenceQueue Cleanup

Weak references often need cleanup queue.

```java
ReferenceQueue<Value> queue = new ReferenceQueue<>();
```

When reference cleared, enqueue cleanup work.

## 26.1 Without cleanup

Map of weak references can retain dead reference objects/keys.

## 26.2 Rule

If using custom weak-reference maps, implement cleanup.

---

# 27. When Weak References Are Not Enough

Weak references do not solve:

- unbounded keys still strongly referenced elsewhere;
- values referencing keys;
- slow cleanup;
- need for predictable eviction;
- resource cleanup;
- large live working set.

## 27.1 Rule

For caches, prefer explicit bounded eviction over weak-reference magic.

---

# 28. Bounded Collections

Bounded collection enforces max size.

## 28.1 Bounded queue

```java
new ArrayBlockingQueue<>(capacity)
```

## 28.2 Bounded cache

Use cache library or custom LRU.

## 28.3 Bounded error list

```java
if (errors.size() < MAX_ERRORS) {
    errors.add(error);
}
```

## 28.4 Rule

If collection can grow from external input, bound it.

---

# 29. Eviction Strategies

## 29.1 LRU

Evict least recently used.

## 29.2 LFU

Evict least frequently used.

## 29.3 TTL

Evict after time.

## 29.4 Size/weight

Evict by entry count or memory estimate.

## 29.5 Explicit invalidation

Remove on domain event.

## 29.6 Rule

Eviction must match access pattern and correctness.

---

# 30. Memory Leak Diagnostics

Symptoms:

- old gen grows over time;
- full GC does not reclaim;
- heap after GC trends upward;
- OOM after hours/days;
- latency increases with GC;
- collection sizes grow;
- queue depth grows.

## 30.1 First question

Is memory retained or just allocated frequently?

## 30.2 Rule

Diagnose using after-GC live set trend, not only allocation rate.

---

# 31. Heap Dump Analysis

Heap dump tools show retained objects.

Look for:

- huge `HashMap`;
- huge `ArrayList`;
- `ConcurrentHashMap$Node`;
- many domain entities;
- large `byte[]`;
- retained by static fields;
- retained by thread locals;
- retained by classloader;
- retained by queues.

## 31.1 Rule

Find the collection retaining the graph, not just the largest object.

---

# 32. Dominator Tree and Retained Size

Dominator tree answers:

```text
If this object were removed, how much memory could be freed?
```

Collections often dominate huge graphs.

## 32.1 Example

```text
ConcurrentHashMap -> 2M Session -> 10GB retained
```

## 32.2 Rule

Retained size is more important than shallow size for leaks.

---

# 33. GC Logs and Memory Trend

GC logs can show:

- heap before/after GC;
- old generation growth;
- full GC frequency;
- allocation pressure;
- promotion rate.

## 33.1 Leak signal

After full GC, old gen remains high or increases over time.

## 33.2 Rule

Use GC logs to confirm memory retention trend before deep heap analysis.

---

# 34. JFR and Allocation Profiling

JFR helps see:

- allocation hotspots;
- object allocation in new TLAB/outside TLAB;
- live object statistics;
- file/socket events;
- thread allocation;
- GC pauses.

## 34.1 Use

If leak grows slowly, periodic JFR/heap dumps help.

## 34.2 Rule

JFR shows where objects are allocated; heap dump shows why they remain alive.

---

# 35. Production Mitigation Patterns

## 35.1 Emergency cap

Add max size to collection/cache/queue.

## 35.2 Clear bad cache

Expose safe admin operation if appropriate.

## 35.3 Restart

Temporary mitigation, not fix.

## 35.4 Backpressure

Stop accepting unlimited work.

## 35.5 Reduce cardinality

Metrics/log labels.

## 35.6 Rule

Mitigation should reduce growth while root cause is fixed.

---

# 36. Common Anti-Patterns

## 36.1 Static mutable collection without lifecycle

Leak.

## 36.2 Unbounded cache

Leak.

## 36.3 Listener register without unregister

Leak.

## 36.4 ThreadLocal without remove

Leak.

## 36.5 Unbounded queue

Backlog/OOM.

## 36.6 Storing request/user/entity as map key

Retains huge graph.

## 36.7 Keeping subList view

Retains backing list.

## 36.8 Storing stream as field

Retains source.

## 36.9 `groupingBy` huge stream

Memory explosion.

## 36.10 ORM batch without clear

Persistence context growth.

---

# 37. Production Failure Modes

## 37.1 OOM after days

Static cache grows.

## 37.2 OOM during import

Error list/grouping materializes everything.

## 37.3 File descriptor exhaustion

Resource stream not closed.

## 37.4 Old deployment not unloaded

Classloader retained by static map/threadlocal.

## 37.5 Metrics backend overload

High-cardinality labels.

## 37.6 Queue memory blow-up

Consumers slower than producers.

## 37.7 Session leak

Session map missing expiry/remove.

## 37.8 Listener leak

Destroyed components still registered.

## 37.9 Large object retained by small subList

View retention.

## 37.10 ORM memory spike

Persistence context holds all managed entities.

---

# 38. Best Practices

## 38.1 Avoid static mutable collections

Use managed lifecycle and bounded caches.

## 38.2 Bound caches and queues

Size/TTL/backpressure.

## 38.3 Always unregister listeners

Use subscription handles/lifecycle hooks.

## 38.4 Remove ThreadLocal

In finally block.

## 38.5 Use compact keys/values

Avoid retaining huge graphs.

## 38.6 Copy views when independence needed

`List.copyOf(subList)`.

## 38.7 Close resource streams

try-with-resources.

## 38.8 Avoid unbounded materialization

Batch/process incrementally.

## 38.9 Manage persistence context in batches

flush/clear or use projections.

## 38.10 Monitor collection sizes

Expose safe metrics for queues/caches/registries.

---

# 39. Decision Matrix

| Situation | Risk | Recommended |
|---|---|---|
| static map | process-lifetime leak | avoid/bound/clear lifecycle |
| singleton field list | cross-request accumulation | local variable or bounded store |
| cache map | unbounded growth | TTL/size eviction |
| listener registry | retained components | unregister/subscription handle |
| ThreadLocal list/map | pooled thread retention | `remove()` in finally |
| unbounded queue | backlog OOM | bounded queue/backpressure |
| large map key | graph retention | compact immutable key |
| subList result | backing retention | copy snapshot |
| stream field | source retention | do not store stream |
| Files.lines | file descriptor leak | try-with-resources |
| grouping huge stream | memory explosion | incremental aggregation/batching |
| ORM import | persistence context growth | flush/clear batches |
| high-cardinality metrics | memory/time-series leak | bounded labels |
| error collection | huge diagnostics | cap/sample/summarize |
| cache with weak refs | unpredictable cleanup | explicit eviction preferred |

---

# 40. Latihan

## Latihan 1 — Static Map Leak

Create static map cache with user-controlled keys. Add max size/TTL strategy.

## Latihan 2 — Listener Leak

Implement registration returning `AutoCloseable` subscription that unregisters listener.

## Latihan 3 — ThreadLocal Cleanup

Write request filter/interceptor that uses ThreadLocal and removes it in finally.

## Latihan 4 — SubList Retention

Demonstrate why keeping small subList can retain large backing list. Fix with copy.

## Latihan 5 — Queue Backpressure

Replace `ConcurrentLinkedQueue` with bounded `ArrayBlockingQueue` and rejection policy.

## Latihan 6 — Error Cap

For import validation, keep only first 100 errors and summarize remaining count.

## Latihan 7 — Metrics Cardinality

Identify bad metric labels and replace with bounded labels.

## Latihan 8 — ORM Batch

Persist 1M rows with periodic flush/clear strategy.

## Latihan 9 — Heap Dump Reasoning

Given dominator tree showing large `ConcurrentHashMap`, identify retained keys/values.

## Latihan 10 — Cache Key Refactor

Replace key containing full request object with compact immutable key.

---

# 41. Ringkasan

Collections are one of the most common causes of memory retention bugs.

Core lessons:

- Java memory leak means unwanted objects remain reachable.
- Collections retain entire object graphs through elements/keys/values.
- Static/singleton collections live for application lifetime.
- Cache without eviction is an unbounded map.
- Listener registries need unregister lifecycle.
- ThreadLocal values must be removed in thread pools.
- Unbounded queues are memory leaks under overload.
- Map keys and values should be compact.
- Views like subList can retain backing collections.
- Streams/iterators can retain sources and captured objects.
- Resource-backed streams must be closed.
- Stateful stream operations can materialize huge data.
- ORM persistence context can behave like hidden growing collection.
- Weak references are not a substitute for eviction/lifecycle.
- Heap dump retained size reveals true leak owners.
- GC logs show live-set trends.
- JFR helps locate allocation sources.
- Bounded collections, eviction, lifecycle cleanup, and monitoring are core defenses.

Main rule:

```text
Every long-lived collection must have an explicit growth policy:
who adds, who removes, when it expires, how big it can get,
and how its size is monitored.
```

---

# 42. Referensi

1. Java SE 25 — `WeakHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/WeakHashMap.html

2. Java SE 25 — `WeakReference`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/WeakReference.html

3. Java SE 25 — `SoftReference`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/SoftReference.html

4. Java SE 25 — `PhantomReference`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/PhantomReference.html

5. Java SE 25 — `ReferenceQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/ReferenceQueue.html

6. Java SE 25 — `ThreadLocal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadLocal.html

7. Java SE 25 — `ArrayBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ArrayBlockingQueue.html

8. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

9. Java SE 25 — `List.subList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html#subList(int,int)

10. Java Flight Recorder Runtime Guide  
    https://docs.oracle.com/javacomponents/jmc-5-5/jfr-runtime-guide/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-053.md](./learn-java-collections-and-streams-part-053.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-055.md](./learn-java-collections-and-streams-part-055.md)

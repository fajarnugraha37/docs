# learn-java-collections-and-streams-part-014.md

# Java Collections and Streams — Part 014  
# Collections and Performance Cost Model: Beyond Big-O, Allocation, Memory Layout, Cache Locality, Hashing, Resizing, Boxing, Iteration, GC Pressure, and Production Measurement

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **014**  
> Fokus: memahami performance Collections secara production-grade. Bukan hanya “`ArrayList` O(1), `HashMap` O(1), `TreeMap` O(log n)”, tetapi **biaya nyata di JVM**: allocation, object header, references, pointer chasing, cache locality, resizing, hashing, comparator cost, boxing, iterator allocation, stream overhead, GC pressure, concurrency contention, false assumptions, dan measurement discipline.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Big-O adalah Awal, Bukan Akhir](#2-mental-model-big-o-adalah-awal-bukan-akhir)
3. [Cost Dimensions](#3-cost-dimensions)
4. [Algorithmic Complexity](#4-algorithmic-complexity)
5. [Constant Factors](#5-constant-factors)
6. [Memory Layout and Object Overhead](#6-memory-layout-and-object-overhead)
7. [Cache Locality and Pointer Chasing](#7-cache-locality-and-pointer-chasing)
8. [Allocation and GC Pressure](#8-allocation-and-gc-pressure)
9. [Boxing and Primitive Data](#9-boxing-and-primitive-data)
10. [Hashing Cost](#10-hashing-cost)
11. [Equality Cost](#11-equality-cost)
12. [Comparator Cost](#12-comparator-cost)
13. [Resizing and Capacity Planning](#13-resizing-and-capacity-planning)
14. [Iteration Cost](#14-iteration-cost)
15. [Random Access vs Sequential Access](#15-random-access-vs-sequential-access)
16. [`ArrayList` Cost Model](#16-arraylist-cost-model)
17. [`LinkedList` Cost Model](#17-linkedlist-cost-model)
18. [`HashMap` Cost Model](#18-hashmap-cost-model)
19. [`LinkedHashMap` Cost Model](#19-linkedhashmap-cost-model)
20. [`HashSet` and `LinkedHashSet` Cost Model](#20-hashset-and-linkedhashset-cost-model)
21. [`TreeMap` and `TreeSet` Cost Model](#21-treemap-and-treeset-cost-model)
22. [`EnumMap` and `EnumSet` Cost Model](#22-enummap-and-enumset-cost-model)
23. [`ArrayDeque` and Queue Cost Model](#23-arraydeque-and-queue-cost-model)
24. [`PriorityQueue` Cost Model](#24-priorityqueue-cost-model)
25. [Immutable/Unmodifiable Collections Cost Model](#25-immutableunmodifiable-collections-cost-model)
26. [Streams Cost Model](#26-streams-cost-model)
27. [Parallel Streams Cost Model](#27-parallel-streams-cost-model)
28. [Concurrent Collections Cost Model](#28-concurrent-collections-cost-model)
29. [Collection Size Regimes](#29-collection-size-regimes)
30. [Choosing by Access Pattern](#30-choosing-by-access-pattern)
31. [Memory Footprint Patterns](#31-memory-footprint-patterns)
32. [Performance Anti-Patterns](#32-performance-anti-patterns)
33. [Measurement: JMH, JFR, Profilers, and Production Telemetry](#33-measurement-jmh-jfr-profilers-and-production-telemetry)
34. [Benchmarking Collections Correctly](#34-benchmarking-collections-correctly)
35. [Production Diagnostics Checklist](#35-production-diagnostics-checklist)
36. [Best Practices](#36-best-practices)
37. [Decision Matrix](#37-decision-matrix)
38. [Latihan](#38-latihan)
39. [Ringkasan](#39-ringkasan)
40. [Referensi](#40-referensi)

---

# 1. Tujuan Bagian Ini

Banyak developer berhenti di:

```text
ArrayList get O(1)
LinkedList insert O(1)
HashMap get O(1)
TreeMap get O(log n)
```

Itu tidak salah, tapi tidak cukup.

Di production, performance collection dipengaruhi oleh:

```text
object allocation
memory footprint
cache locality
CPU branch
hash function
equals cost
comparator cost
resizing
copying
boxing
GC pressure
iterator/stream overhead
synchronization/contention
data size
access pattern
hot path frequency
```

Contoh:

```java
LinkedList<Integer> list = ...
```

Secara teori insert/remove di tengah bisa O(1) jika node sudah diketahui.

Tetapi jika harus mencari posisi dengan index:

```java
list.get(i)
```

maka traversal O(n), plus pointer chasing, plus boxed Integer, plus node allocation.

Tujuan bagian ini:

- membangun mental model cost nyata;
- membedakan algorithmic complexity vs JVM cost;
- memahami trade-off tiap collection;
- menghindari anti-pattern performance;
- tahu kapan harus benchmark;
- mendesain collection berdasarkan access pattern.

---

# 2. Mental Model: Big-O adalah Awal, Bukan Akhir

Big-O menjelaskan pertumbuhan biaya terhadap input size.

Tapi Big-O menyembunyikan banyak hal.

## 2.1 Dua operasi sama-sama O(n)

```java
ArrayList iteration
LinkedList iteration
```

Keduanya O(n).

Namun `ArrayList` sering jauh lebih cepat karena:

- data references berdekatan dalam array;
- CPU cache lebih friendly;
- tidak ada node object per element;
- traversal linear sederhana.

`LinkedList` punya:

- node object per element;
- pointer chasing;
- worse locality;
- more GC pressure.

## 2.2 O(1) tidak berarti gratis

`HashMap.get` expected O(1), tapi tetap ada:

- key hash computation;
- bucket lookup;
- equality checks;
- cache miss;
- collision traversal/tree lookup;
- branch cost.

## 2.3 O(log n) bisa menang

Untuk small n, `TreeMap` O(log n) bisa cukup cepat dan memberi sorted/range semantics.

Untuk large n, HashMap biasanya lookup lebih cepat, tetapi tidak sorted.

## 2.4 Main rule

```text
Big-O tells scalability shape.
Cost model tells production behavior.
Measurement tells truth.
```

---

# 3. Cost Dimensions

Saat memilih collection, pikirkan dimensi berikut.

## 3.1 Time complexity

- add;
- remove;
- get;
- contains;
- iteration;
- sort;
- range query.

## 3.2 Memory footprint

- object header;
- array capacity;
- node objects;
- references;
- boxed primitives;
- load factor spare capacity.

## 3.3 Allocation rate

- per element allocation;
- iterator allocation;
- stream pipeline objects;
- temporary lists/maps;
- resize copies.

## 3.4 CPU behavior

- cache locality;
- branch prediction;
- pointer chasing;
- virtual dispatch;
- lambda dispatch/inlining.

## 3.5 GC behavior

- short-lived temporary collections;
- long-lived large maps;
- retained sublists/views;
- boxing objects.

## 3.6 Concurrency behavior

- lock contention;
- CAS retry;
- copy-on-write copy cost;
- weakly consistent iteration;
- false sharing.

## 3.7 Rule

Performance is multi-dimensional. Optimizing one dimension can hurt another.

---

# 4. Algorithmic Complexity

Common expected complexity mental model:

| Operation | ArrayList | LinkedList | HashMap | TreeMap | HashSet | TreeSet |
|---|---:|---:|---:|---:|---:|---:|
| get by index/key | O(1) index | O(n) index | expected O(1) | O(log n) | n/a | n/a |
| add end | amortized O(1) | O(1) | expected O(1) put | O(log n) put | expected O(1) | O(log n) |
| remove by value/key | O(n) | O(n) | expected O(1) | O(log n) | expected O(1) | O(log n) |
| contains | O(n) | O(n) | expected O(1) key | O(log n) key | expected O(1) | O(log n) |
| iteration | O(n) | O(n) | O(size + capacity) | O(n) | O(size + capacity) | O(n) |

## 4.1 Expected vs worst-case

HashMap operations are expected O(1), assuming good hash distribution.

Bad hash or adversarial keys can degrade.

## 4.2 Amortized

ArrayList add at end is amortized O(1) because occasional resize is O(n), spread over many adds.

## 4.3 Hidden traversal

`LinkedList.add(index, value)` is not O(1) if you only have index; finding position costs O(n).

## 4.4 Rule

Always ask: “Do I already have the node/reference, or only an index/key/value?”

---

# 5. Constant Factors

Big-O ignores constants.

## 5.1 Example

For 20 elements:

```java
list.contains(x)
```

may be faster than building `HashSet`.

## 5.2 Building index cost

```java
Set<T> set = new HashSet<>(list);
```

Costs O(n) upfront.

Worth it if many lookups.

Not worth it for one lookup.

## 5.3 Comparator cost

`TreeSet` with expensive comparator can be slow even at moderate n.

## 5.4 Hash cost

Hashing a large composite key may dominate lookup.

## 5.5 Rule

For small n, simple structures often win.

---

# 6. Memory Layout and Object Overhead

Java objects have overhead.

A collection is not just data.

## 6.1 ArrayList

Roughly:

```text
ArrayList object
+
Object[] backing array
+
element objects elsewhere
```

## 6.2 LinkedList

Roughly:

```text
LinkedList object
+
Node object per element
+
element objects elsewhere
```

Each node has references:

```text
item
prev
next
```

plus object header.

## 6.3 HashMap

Roughly:

```text
HashMap object
+
Node[] table
+
Node object per entry
+
key objects
+
value objects
```

## 6.4 TreeMap

Roughly:

```text
TreeMap object
+
Entry node per mapping
+
left/right/parent/color references
+
key/value objects
```

## 6.5 Boxing

```java
List<Integer>
```

stores references to `Integer` objects, not raw ints.

## 6.6 Rule

Memory footprint often dominates performance for large collections.

---

# 7. Cache Locality and Pointer Chasing

Modern CPU likes contiguous memory access.

## 7.1 Array-based structures

```java
ArrayList
ArrayDeque
EnumSet bit vector
EnumMap array
```

often have better locality.

## 7.2 Node-based structures

```java
LinkedList
TreeMap
HashMap nodes
```

involve pointer chasing.

Pointer chasing can cause cache misses.

## 7.3 Why LinkedList often loses

Even though linked lists have nice theoretical properties, each step jumps to another object.

## 7.4 Rule

For iteration-heavy workloads, contiguous data structures are usually better.

---

# 8. Allocation and GC Pressure

Collections allocate memory.

## 8.1 Allocation sources

- new collection object;
- backing arrays;
- node objects;
- boxed values;
- iterators;
- stream objects;
- temporary copies;
- map entries;
- resizing arrays.

## 8.2 Short-lived temporaries

```java
someList.stream()
    .map(...)
    .collect(toList())
```

can allocate intermediate pipeline/result objects.

JIT may optimize some, but not all.

## 8.3 Long-lived maps

Large caches/maps become old-gen residents.

Bad eviction can cause memory pressure.

## 8.4 GC pressure symptoms

- high allocation rate;
- frequent young GC;
- old-gen growth;
- long pauses;
- memory fragmentation;
- high retained heap.

## 8.5 Rule

Allocation rate is often more actionable than raw CPU time.

---

# 9. Boxing and Primitive Data

Java generic collections cannot store primitives directly.

```java
List<Integer>
Map<Long, Value>
Set<Integer>
```

store boxed objects.

## 9.1 Cost

- allocation for boxed values beyond cache range;
- memory overhead;
- indirection;
- GC pressure;
- unboxing CPU.

## 9.2 Example

```java
List<Integer> ids = new ArrayList<>();
for (int i = 0; i < 1_000_000; i++) {
    ids.add(i);
}
```

This can allocate many Integer objects.

## 9.3 Alternatives

- primitive arrays;
- `BitSet` for dense boolean membership;
- specialized primitive collections library;
- `IntStream` for streaming primitive operations;
- custom compact structure.

## 9.4 Rule

For millions of primitive values, boxed collections deserve scrutiny.

---

# 10. Hashing Cost

Hash-based collections rely on `hashCode`.

## 10.1 Cheap key

```java
record CaseId(String value) {}
```

String hash is cached after first computation.

## 10.2 Expensive key

```java
record ComplexKey(List<String> parts) {}
```

hash may traverse list.

## 10.3 Array wrapper

If key wraps byte array, computing hash every time expensive.

Cache hash if immutable:

```java
final class BytesKey {
    private final byte[] bytes;
    private final int hash;
}
```

## 10.4 Poor distribution

Bad hash causes collisions.

## 10.5 Rule

Hash key design affects both correctness and performance.

---

# 11. Equality Cost

After hash bucket, equals decides match.

## 11.1 Cheap equals

- enum;
- int-like ID;
- canonical string;
- small record.

## 11.2 Expensive equals

- deep object graph;
- large list;
- byte array;
- BigDecimal normalization on the fly;
- case-insensitive compare without canonicalization.

## 11.3 Canonicalization helps

Instead of:

```java
email.equalsIgnoreCase(other.email)
```

on every equals, canonicalize once:

```java
value = value.toLowerCase(Locale.ROOT)
```

## 11.4 Rule

Hot equality should be cheap and stable.

---

# 12. Comparator Cost

Sorted structures call comparator many times.

## 12.1 TreeMap/TreeSet

Each lookup/update is O(log n) comparisons.

If comparator is expensive, cost multiplies.

## 12.2 Sort

Sorting O(n log n) comparisons.

Comparator cost dominates for complex keys.

## 12.3 Bad comparator

```java
Comparator.comparing(user -> expensiveNormalize(user.name()))
```

called repeatedly.

## 12.4 Better

Precompute sort key.

```java
record UserSortView(User user, String normalizedName) {}
```

or canonicalize domain value.

## 12.5 Rule

Comparator should not perform expensive repeated work in hot paths.

---

# 13. Resizing and Capacity Planning

Resizable collections grow.

## 13.1 ArrayList

When capacity insufficient, allocates larger array and copies references.

## 13.2 HashMap

When threshold exceeded, resizes table and redistributes entries.

## 13.3 Cost

Resize is O(n) event.

Usually amortized fine, but can create latency spike.

## 13.4 Pre-sizing

If expected size known:

```java
new ArrayList<>(expectedSize)
new HashMap<>(initialCapacity)
```

## 13.5 Over-sizing

Too large capacity wastes memory and can slow iteration for HashMap/HashSet.

## 13.6 Rule

Pre-size large known collections, but avoid careless huge capacity.

---

# 14. Iteration Cost

Iteration is often the dominant operation.

## 14.1 ArrayList

Fast linear traversal over backing array.

## 14.2 LinkedList

Linear but pointer chasing.

## 14.3 HashMap/HashSet

Iteration cost can depend on size plus capacity because buckets are scanned.

## 14.4 TreeMap/TreeSet

In-order traversal over tree nodes.

## 14.5 LinkedHashMap/LinkedHashSet

Iteration over linked order; predictable, often efficient relative to capacity issue.

## 14.6 Rule

If you iterate often, choose for iteration, not just lookup.

---

# 15. Random Access vs Sequential Access

## 15.1 Random access

```java
list.get(i)
```

Fast for ArrayList.

Slow for LinkedList.

## 15.2 Sequential access

Iterator traversal can be okay for both, but ArrayList usually has better locality.

## 15.3 `RandomAccess`

Marker interface for lists supporting fast random access.

Example:

```java
if (list instanceof RandomAccess) {
    for (int i = 0; i < list.size(); i++) ...
} else {
    for (E e : list) ...
}
```

## 15.4 Rule

Do not use index loops blindly on unknown List implementation.

---

# 16. `ArrayList` Cost Model

`ArrayList` is usually default List.

## 16.1 Strengths

- fast get/set by index;
- fast iteration;
- compact relative to linked structures;
- amortized fast append;
- good cache locality.

## 16.2 Weaknesses

- inserting/removing near front/middle shifts elements;
- resizing copies backing array;
- not thread-safe;
- contains is O(n).

## 16.3 Good use cases

- most list data;
- read-heavy ordered data;
- append then iterate;
- DTO arrays;
- stream source.

## 16.4 Performance notes

Oracle docs state many operations like `size`, `isEmpty`, `get`, `set`, iterator/listIterator are constant time, and add is amortized constant time.

## 16.5 Rule

Use ArrayList as default List unless access pattern says otherwise.

---

# 17. `LinkedList` Cost Model

`LinkedList` is doubly-linked list implementing List and Deque.

## 17.1 Strengths

- O(1) add/remove at ends;
- O(1) remove if you already have iterator/node position;
- implements Deque;
- no array resize.

## 17.2 Weaknesses

- poor random access;
- node allocation per element;
- poor cache locality;
- high memory overhead;
- more GC pressure;
- often slower than ArrayDeque for queue/deque.

## 17.3 Indexed access

Oracle docs note operations indexing into the list traverse from beginning or end, whichever is closer.

## 17.4 Better alternatives

- `ArrayList` for list;
- `ArrayDeque` for queue/stack/deque.

## 17.5 Rule

Do not choose LinkedList by textbook intuition. Choose it only after access-pattern evidence.

---

# 18. `HashMap` Cost Model

`HashMap` is default general-purpose map.

## 18.1 Strengths

- expected constant-time get/put;
- flexible keys/values;
- permits null key/value;
- widely optimized.

## 18.2 Weaknesses

- memory overhead;
- no order guarantee;
- hash/equality dependent;
- resize cost;
- iteration can depend on capacity + size;
- not thread-safe.

## 18.3 Capacity and load factor

Default load factor is generally good. Higher load factor saves space but increases lookup cost; lower load factor can improve lookup but wastes memory.

## 18.4 Iteration cost

HashMap docs state iteration over collection views requires time proportional to capacity plus size.

## 18.5 Rule

HashMap is excellent for lookup, but key design and sizing matter.

---

# 19. `LinkedHashMap` Cost Model

`LinkedHashMap` adds encounter order to HashMap-like structure.

## 19.1 Strengths

- predictable iteration order;
- insertion/access order;
- useful for LRU-style structures;
- iteration independent of unused bucket capacity in practice relative to linked order semantics.

## 19.2 Weaknesses

- extra links per entry;
- more memory than HashMap;
- update order maintenance cost;
- not thread-safe.

## 19.3 Use cases

- deterministic output;
- preserving input order;
- simple LRU;
- ordered map API.

## 19.4 Rule

Pay LinkedHashMap overhead when deterministic order is valuable.

---

# 20. `HashSet` and `LinkedHashSet` Cost Model

## 20.1 HashSet

Backed by HashMap.

Strengths:

- expected O(1) add/remove/contains;
- good for membership.

Weaknesses:

- memory overhead;
- no order;
- hash/equality dependent;
- iteration depends on size + backing capacity.

## 20.2 LinkedHashSet

Adds linked encounter order.

Strengths:

- unique + deterministic order;
- dedup preserving input order.

Weaknesses:

- more memory.

## 20.3 Rule

Use HashSet for pure membership; LinkedHashSet when order matters.

---

# 21. `TreeMap` and `TreeSet` Cost Model

Tree structures provide sorted order.

## 21.1 Strengths

- sorted traversal;
- range queries;
- floor/ceiling/lower/higher;
- predictable O(log n);
- no hashing needed.

## 21.2 Weaknesses

- slower lookup than HashMap for plain key lookup;
- comparator cost;
- node overhead;
- pointer chasing;
- comparator consistency pitfalls.

## 21.3 Use cases

- time-based rule lookup;
- range queries;
- sorted output;
- nearest neighbor key.

## 21.4 Rule

Use TreeMap/TreeSet when sorted/range operations are core, not for generic lookup.

---

# 22. `EnumMap` and `EnumSet` Cost Model

Enum-specialized collections are often extremely efficient.

## 22.1 EnumMap

Backed conceptually by array indexed by enum ordinal.

Strengths:

- compact;
- fast;
- predictable enum key universe;
- natural enum order iteration.

## 22.2 EnumSet

Backed conceptually by bit vector.

Strengths:

- very compact;
- fast membership;
- ideal for flags/permissions.

## 22.3 Weaknesses

- only enum keys/elements;
- no null keys/elements;
- enum ordinal order semantics.

## 22.4 Rule

If key/element type is enum, consider EnumMap/EnumSet first.

---

# 23. `ArrayDeque` and Queue Cost Model

ArrayDeque is resizable circular array deque.

## 23.1 Strengths

- fast add/remove at both ends;
- no node per element;
- good locality;
- better than Stack for stack use;
- often better than LinkedList for queue use.

## 23.2 Weaknesses

- no random access;
- resizing cost;
- not thread-safe;
- no null.

## 23.3 Use cases

- stack;
- queue;
- BFS;
- sliding window;
- local worklist.

## 23.4 Rule

Use ArrayDeque as default non-concurrent queue/stack/deque.

---

# 24. `PriorityQueue` Cost Model

PriorityQueue is heap-based priority structure.

## 24.1 Strengths

- efficient access to smallest/highest priority element;
- offer/poll O(log n);
- peek O(1);
- good for scheduling/algorithms.

## 24.2 Weaknesses

- iteration not sorted;
- comparator cost;
- mutation of priority breaks ordering;
- not thread-safe;
- no null.

## 24.3 Use cases

- top-k;
- Dijkstra/A*;
- delayed-ish priority without blocking delay;
- job priority.

## 24.4 Rule

Use PriorityQueue for repeated next-priority retrieval, not sorted iteration.

---

# 25. Immutable/Unmodifiable Collections Cost Model

## 25.1 `List.of`/`Map.of`

Can be compact for small constants.

## 25.2 `copyOf`

Usually O(n) copy, but may optimize if source already unmodifiable.

## 25.3 Unmodifiable view

Cheap wrapper, but live backing risk.

## 25.4 Defensive copy cost

Cost is often acceptable at boundaries but avoid repeated copies in loops.

## 25.5 Rule

Use immutable snapshots for safety, but copy once at boundary.

---

# 26. Streams Cost Model

Streams add abstraction.

## 26.1 Costs

- pipeline objects;
- lambda invocation/inlining;
- boxing if object stream;
- stateful operations memory;
- collector allocation;
- possible loss of simple loop clarity.

## 26.2 Benefits

- composability;
- laziness;
- short-circuiting;
- primitive streams;
- declarative transformations.

## 26.3 Stateful operations

```java
distinct
sorted
limit on ordered parallel stream
groupingBy
```

can require memory/coordination.

## 26.4 Primitive streams

```java
IntStream
LongStream
DoubleStream
```

avoid boxing.

## 26.5 Rule

Streams are not automatically slower or faster. Source, operations, and allocation decide.

---

# 27. Parallel Streams Cost Model

Parallel stream requires:

- splittable source;
- enough work per element;
- associative/stateless operations;
- low contention;
- good collector/reduction;
- suitable common pool usage.

## 27.1 Good source

ArrayList/arrays/ranges often split well.

## 27.2 Bad source

LinkedList, IO, blocking tasks, synchronized source, poor spliterator.

## 27.3 Overheads

- task creation;
- work stealing;
- merging;
- ordering constraints;
- contention;
- common ForkJoinPool interference.

## 27.4 Rule

Parallel stream is performance tool only after measuring sequential baseline.

---

# 28. Concurrent Collections Cost Model

## 28.1 ConcurrentHashMap

Good scalable concurrent lookup/update, but:

- atomic operations have overhead;
- contention on hot keys;
- resizing expensive;
- weakly consistent iteration.

## 28.2 CopyOnWriteArrayList

Reads/iteration cheap and snapshot-safe.

Writes copy entire array.

Good for listener lists.

Bad for write-heavy workloads.

## 28.3 BlockingQueue

Adds coordination cost but gives backpressure.

## 28.4 Synchronized wrappers

Coarse-grained locking.

Simple but can bottleneck.

## 28.5 Rule

Thread-safe collection cost depends on contention pattern.

---

# 29. Collection Size Regimes

## 29.1 Tiny collections: 0-10

Simple list may beat hash structure.

Use `List.of`, arrays, small lists.

## 29.2 Small collections: 10-1000

Choose by semantics first.

Performance usually okay.

## 29.3 Medium: thousands to hundreds thousands

Sizing, allocation, hashing, iteration matter.

## 29.4 Large: millions

Memory footprint, boxing, GC, primitive structures, streaming/pagination matter.

## 29.5 Huge/unbounded

Avoid in-memory if possible.

Use database/query, streaming, external storage, chunking.

## 29.6 Rule

Collection choice changes as size regime changes.

---

# 30. Choosing by Access Pattern

## 30.1 Append then iterate

Use ArrayList.

## 30.2 Many membership checks

Use HashSet.

## 30.3 Many lookup by ID

Use HashMap.

## 30.4 Sorted/range queries

Use TreeMap/NavigableMap.

## 30.5 Enum keys

Use EnumMap.

## 30.6 Enum set/flags

Use EnumSet.

## 30.7 Queue/stack

Use ArrayDeque.

## 30.8 Concurrent producer-consumer

Use BlockingQueue.

## 30.9 Read-mostly listener list

Use CopyOnWriteArrayList.

## 30.10 Rule

Access pattern beats abstract preference.

---

# 31. Memory Footprint Patterns

## 31.1 Avoid nested maps blindly

```java
Map<A, Map<B, Map<C, V>>>
```

can create many small maps.

Alternative:

```java
Map<Key3<A,B,C>, V>
```

depending access pattern.

## 31.2 Avoid boxed primitive maps for huge data

```java
Map<Integer, Long>
```

can be huge.

## 31.3 Avoid retaining views

```java
list.subList(...)
```

can retain backing list.

## 31.4 Avoid huge unbounded caches

Use eviction.

## 31.5 Avoid duplicate copies

Know ownership.

## 31.6 Rule

For large collections, memory model is architecture decision.

---

# 32. Performance Anti-Patterns

## 32.1 `list.contains` inside loop

```java
for (Item item : items) {
    if (allowedList.contains(item.id())) ...
}
```

If allowedList large, use Set.

## 32.2 Rebuilding set repeatedly

```java
for (...) {
    Set<X> set = new HashSet<>(list);
}
```

Build once.

## 32.3 LinkedList for random access

Bad.

## 32.4 Stream sorted then find first

```java
stream.sorted().findFirst()
```

Use min/max if only need one.

## 32.5 Boxing hot path

Use primitive arrays/streams/specialized collections.

## 32.6 Overusing parallelStream

Measure first.

## 32.7 Unbounded map cache

Memory leak.

## 32.8 Poor composite string key

Use record key.

## 32.9 Huge `groupingBy`

May OOM.

Use DB aggregation/chunking.

## 32.10 Sorting with expensive comparator

Precompute keys.

---

# 33. Measurement: JMH, JFR, Profilers, and Production Telemetry

## 33.1 JMH

Use JMH for microbenchmarks.

Avoid homemade timing loops.

JMH handles:

- warmup;
- measurement iterations;
- dead-code elimination pitfalls;
- forks;
- JVM optimization behavior.

## 33.2 JFR

Java Flight Recorder helps observe production-like behavior:

- allocation hotspots;
- GC;
- lock contention;
- CPU samples;
- object allocation in new TLAB/outside TLAB.

## 33.3 Profilers

Use async-profiler/JFR/profiler to see:

- CPU hotspots;
- allocation hotspots;
- lock contention.

## 33.4 Production metrics

Track:

- request latency;
- queue size;
- cache size/hit rate;
- map sizes;
- allocation rate;
- GC time;
- heap usage.

## 33.5 Rule

Do not optimize collection choice based on folklore. Measure.

---

# 34. Benchmarking Collections Correctly

## 34.1 Warmup

JIT needs warmup.

## 34.2 Avoid dead-code elimination

Consume results.

## 34.3 Realistic data

Use realistic:

- sizes;
- key distribution;
- hash distribution;
- hit/miss ratio;
- mutation/read ratio.

## 34.4 Separate setup from measurement

Do not measure data generation unless intended.

## 34.5 Measure allocation

CPU time alone insufficient.

## 34.6 Benchmark variants

Compare:

- ArrayList vs LinkedList;
- HashSet vs List contains;
- HashMap vs TreeMap;
- boxed vs primitive;
- sequential vs parallel stream.

## 34.7 Rule

A benchmark that does not model access pattern is misleading.

---

# 35. Production Diagnostics Checklist

When collection performance issue suspected:

## 35.1 Identify hot collection

- type;
- size;
- lifetime;
- owner;
- mutation/read ratio.

## 35.2 Identify hot operation

- lookup;
- contains;
- iteration;
- grouping;
- sorting;
- copying;
- stream pipeline.

## 35.3 Check key/equality

- hash distribution;
- expensive equals;
- mutable keys;
- collision.

## 35.4 Check memory

- retained heap;
- boxed primitives;
- nested maps;
- unbounded caches;
- view retention.

## 35.5 Check concurrency

- lock contention;
- hot keys;
- blocking queue backlog;
- copy-on-write writes.

## 35.6 Check algorithm

- nested loops;
- contains in loop;
- repeated sorting;
- repeated copying.

## 35.7 Rule

Diagnose before replacing collections.

---

# 36. Best Practices

## 36.1 Defaults

- Use ArrayList for most lists.
- Use HashMap for general lookup.
- Use HashSet for membership.
- Use ArrayDeque for local queue/stack.
- Use EnumMap/EnumSet for enum keys/elements.
- Use LinkedHashMap/LinkedHashSet when deterministic order matters.
- Use TreeMap/TreeSet when sorted/range semantics matter.

## 36.2 Performance

- Pre-size large collections when size known.
- Avoid boxed primitives for huge datasets.
- Avoid LinkedList unless justified.
- Avoid unbounded maps/caches.
- Avoid repeated conversions/copies.
- Use primitive streams for numeric pipelines.
- Measure with JMH/JFR/profilers.

## 36.3 Design

- Choose by access pattern.
- Keep keys immutable and cheap.
- Canonicalize expensive equality.
- Use comparators with cheap stable keys.
- Copy at boundaries, not in hot loops.
- Document size expectations.

---

# 37. Decision Matrix

| Requirement | Recommended |
|---|---|
| general ordered list | `ArrayList` |
| append then iterate | `ArrayList` |
| random access | `ArrayList` |
| queue/stack/deque local | `ArrayDeque` |
| membership lookup | `HashSet` |
| key lookup | `HashMap` |
| deterministic unique order | `LinkedHashSet` |
| deterministic map order | `LinkedHashMap` |
| sorted/range set | `TreeSet` |
| sorted/range map | `TreeMap` / `NavigableMap` |
| enum flags | `EnumSet` |
| enum key map | `EnumMap` |
| huge primitive membership dense | `BitSet` |
| huge primitive collections | primitive arrays/specialized library |
| read-mostly concurrent list | `CopyOnWriteArrayList` |
| concurrent lookup | `ConcurrentHashMap` |
| producer-consumer | bounded `BlockingQueue` |
| immutable snapshot | `copyOf` |
| small constants | `List.of` / `Set.of` / `Map.of` |
| top priority retrieval | `PriorityQueue` |
| one-off small contains | `List.contains` may be enough |
| many contains | build `HashSet` once |
| aggregation huge data | database/chunking/streaming |

---

# 38. Latihan

## Latihan 1 — List Contains vs Set

Given 100_000 allowed IDs and 1_000_000 items, compare:

```java
allowedList.contains(id)
allowedSet.contains(id)
```

Explain build cost vs lookup cost.

## Latihan 2 — ArrayList vs LinkedList Iteration

Benchmark iteration over 1_000_000 elements.

Explain locality and allocation.

## Latihan 3 — HashMap Capacity

Create HashMap with known 1_000_000 entries.

Compare default growth vs pre-sizing.

Measure allocation/latency.

## Latihan 4 — Boxing Cost

Compare:

```java
List<Integer>
int[]
IntStream
```

for summing 10 million ints.

## Latihan 5 — Comparator Cost

Sort 1 million strings using comparator that lowercases inside compare.

Then precompute lowercase key.

Compare.

## Latihan 6 — Stream sorted vs min

Compare:

```java
stream.sorted().findFirst()
stream.min(comparator)
```

## Latihan 7 — Parallel Stream

Compare sequential and parallel stream over:

- ArrayList CPU-heavy work;
- LinkedList CPU-heavy work;
- IO/blocking work.

Explain.

## Latihan 8 — Memory Leak Cache

Implement unbounded map cache, observe growth. Add max size/eviction strategy.

## Latihan 9 — Nested Map vs Composite Key

Compare memory/access pattern:

```java
Map<TenantId, Map<CaseId, V>>
Map<TenantCaseKey, V>
```

## Latihan 10 — JMH Setup

Create JMH benchmark for:

- HashSet contains;
- ArrayList contains;
- TreeSet contains.

Use realistic hit/miss ratio.

---

# 39. Ringkasan

Performance Collections bukan hanya Big-O.

Core lessons:

- Big-O gives growth shape, not full cost.
- Constant factors matter.
- Memory layout matters.
- Cache locality matters.
- Allocation rate and GC pressure matter.
- Boxing can dominate huge primitive workloads.
- Hashing/equality/comparator cost can dominate lookup/sort.
- Resizing can cause latency spikes.
- Iteration cost depends on structure and capacity.
- ArrayList is usually default List.
- LinkedList is rarely right by default.
- HashMap is excellent for lookup but key/sizing matter.
- TreeMap is for sorted/range semantics.
- EnumMap/EnumSet are excellent for enum keys/elements.
- ArrayDeque is default local queue/stack/deque.
- Streams and parallel streams have source/operation overhead.
- Concurrent collections have contention/coordination costs.
- Choose by access pattern and size regime.
- Measure with JMH/JFR/profilers, not intuition.

Main rule:

```text
A collection is not just an API.
It is an algorithm + memory layout + allocation pattern + CPU behavior + semantic contract.
```

---

# 40. Referensi

1. Java SE 25 — `ArrayList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayList.html

2. Java SE 25 — `HashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html

3. Java SE 25 — `LinkedList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedList.html

4. Java SE 25 — `HashSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashSet.html

5. Java SE 25 — `TreeMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeMap.html

6. Java SE 25 — `TreeSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeSet.html

7. Java SE 25 — `EnumMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumMap.html

8. Java SE 25 — `EnumSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumSet.html

9. Java SE 25 — `ArrayDeque`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayDeque.html

10. Java SE 25 — `PriorityQueue`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-013.md](./learn-java-collections-and-streams-part-013.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-015.md](./learn-java-collections-and-streams-part-015.md)

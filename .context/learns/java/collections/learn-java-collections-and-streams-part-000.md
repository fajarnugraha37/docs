# learn-java-collections-and-streams-part-000.md

# Java Collections and Streams — Part 000  
# Peta Besar Collections and Streams: Data Structure, Semantic Contract, Traversal, Pipeline, dan Production Mental Model

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **000**  
> Fokus: membangun peta besar dan mental model sebelum masuk ke detail `List`, `Set`, `Map`, `Queue`, `Stream`, `Collector`, `Spliterator`, parallel stream, concurrency, performance, dan production design. Bagian ini sengaja tidak berisi hafalan API satu per satu, tetapi kerangka berpikir yang akan dipakai sepanjang seri.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Collections and Streams Layak Dipelajari Sangat Dalam](#2-kenapa-collections-and-streams-layak-dipelajari-sangat-dalam)
3. [Mental Model Utama](#3-mental-model-utama)
4. [Collection Bukan Sekadar “Kumpulan Data”](#4-collection-bukan-sekadar-kumpulan-data)
5. [Stream Bukan Collection](#5-stream-bukan-collection)
6. [Empat Dimensi: Storage, Traversal, Computation, Contract](#6-empat-dimensi-storage-traversal-computation-contract)
7. [Collections Framework sebagai Unified Architecture](#7-collections-framework-sebagai-unified-architecture)
8. [Interface vs Implementation](#8-interface-vs-implementation)
9. [The Big Interfaces](#9-the-big-interfaces)
10. [Map Bukan Collection, Tapi Bagian dari Collections Framework](#10-map-bukan-collection-tapi-bagian-dari-collections-framework)
11. [Encounter Order dan Sequenced Collections](#11-encounter-order-dan-sequenced-collections)
12. [Iteration Model: Iterable dan Iterator](#12-iteration-model-iterable-dan-iterator)
13. [Spliterator: Traversal + Partitioning](#13-spliterator-traversal--partitioning)
14. [Stream Pipeline Model](#14-stream-pipeline-model)
15. [Collector sebagai Reduction Protocol](#15-collector-sebagai-reduction-protocol)
16. [Lazy Evaluation](#16-lazy-evaluation)
17. [Internal Iteration vs External Iteration](#17-internal-iteration-vs-external-iteration)
18. [Mutability and Ownership](#18-mutability-and-ownership)
19. [Equality, Hashing, Ordering](#19-equality-hashing-ordering)
20. [Null Semantics](#20-null-semantics)
21. [Big-O Is Not Enough](#21-big-o-is-not-enough)
22. [Concurrency Dimension](#22-concurrency-dimension)
23. [Boundary Dimension: API, DB, JSON, Kafka, Cache](#23-boundary-dimension-api-db-json-kafka-cache)
24. [Domain Modeling with Collections](#24-domain-modeling-with-collections)
25. [Common Misconceptions](#25-common-misconceptions)
26. [Production Failure Modes yang Akan Sering Kita Bahas](#26-production-failure-modes-yang-akan-sering-kita-bahas)
27. [How to Think Like Top 1% Engineer](#27-how-to-think-like-top-1-engineer)
28. [Roadmap Seri Ini](#28-roadmap-seri-ini)
29. [Checklist Awal](#29-checklist-awal)
30. [Latihan Mental Model](#30-latihan-mental-model)
31. [Ringkasan](#31-ringkasan)
32. [Referensi](#32-referensi)

---

# 1. Tujuan Bagian Ini

Kita baru saja menyelesaikan seri panjang tentang **Java Data Types**. Sekarang kita lanjut ke area yang sering dianggap “sudah biasa” oleh banyak developer, padahal sangat dalam:

```text
Collections and Streams
```

Banyak developer bisa menulis:

```java
list.stream()
    .filter(x -> x.active())
    .map(x -> x.name())
    .toList();
```

Tetapi engineer yang benar-benar kuat akan bertanya:

```text
Apakah List memang semantic type yang tepat?
Apakah order penting?
Apakah uniqueness penting?
Apakah null boleh?
Apakah element mutable?
Apakah collection ini snapshot atau live view?
Apakah stream ini resource-backed?
Apakah pipeline ini lazy?
Apakah operation ini stateful?
Apakah collector ini aman untuk parallel?
Apakah grouping ini bisa OOM?
Apakah map key immutable?
Apakah comparator konsisten dengan equals?
Apakah API boleh return Stream?
Apakah ConcurrentHashMap value-nya juga thread-safe?
```

Tujuan bagian 000:

- memberi peta besar;
- membedakan collection, stream, iterator, spliterator, collector;
- membangun mental model sebelum masuk detail;
- menjelaskan kenapa Collections/Streams adalah foundation untuk production Java;
- menyusun vocabulary yang akan dipakai sepanjang seri.

---

# 2. Kenapa Collections and Streams Layak Dipelajari Sangat Dalam

Collections dan Streams muncul hampir di semua Java codebase:

- API response list;
- request item list;
- map cache;
- repository result;
- entity child collection;
- validation errors;
- event history;
- permission set;
- retry queue;
- aggregation result;
- in-memory index;
- stream transformation;
- CSV/import batch;
- file line processing;
- grouping report;
- metrics aggregation;
- concurrent worker queue.

Karena sering muncul, bug di area ini juga sering muncul:

- `ConcurrentModificationException`;
- duplicate key di `Collectors.toMap`;
- `NullPointerException` di stream pipeline;
- HashMap key berubah setelah dimasukkan;
- `TreeSet` hilang element karena comparator salah;
- unbounded queue OOM;
- `List<Integer>` OOM karena boxing;
- entity lazy collection terserialisasi ke API;
- `parallelStream` memperlambat service;
- file stream tidak ditutup;
- `HashMap` digunakan sebagai cache tanpa eviction;
- permission list duplicate;
- `Map<String,Object>` menjadi pseudo-domain model;
- mutable collection bocor dari aggregate.

Collections and Streams bukan sekadar utility.

Mereka adalah:

```text
data structure choice
semantic contract
performance decision
concurrency decision
boundary contract
domain modeling tool
```

---

# 3. Mental Model Utama

Sepanjang seri ini, gunakan empat kalimat berikut.

## 3.1 Collection

```text
Collection = object yang merepresentasikan group of elements dengan semantic contract tertentu.
```

Bukan hanya “array yang bisa grow”.

Collection punya makna:

- ordered atau tidak;
- unique atau tidak;
- sorted atau tidak;
- allows null atau tidak;
- mutable atau tidak;
- thread-safe atau tidak;
- stable iteration atau tidak;
- identity/value semantics;
- bounded atau unbounded.

## 3.2 Stream

```text
Stream = lazy computation pipeline over a source.
```

Stream bukan storage.

Stream adalah alur operasi:

```text
source -> intermediate operations -> terminal operation
```

## 3.3 Collector

```text
Collector = protocol untuk mengubah stream elements menjadi accumulated result.
```

Contoh result:

- list;
- set;
- map;
- grouped map;
- summary statistics;
- string join;
- custom domain object.

## 3.4 Spliterator

```text
Spliterator = traversal + partitioning contract untuk source elements.
```

Spliterator adalah fondasi penting untuk stream, terutama parallel stream.

---

# 4. Collection Bukan Sekadar “Kumpulan Data”

Misalnya:

```java
List<CaseId> caseIds
Set<CaseId> caseIds
SortedSet<CaseId> caseIds
Queue<CaseId> caseIds
Deque<CaseId> caseIds
Map<CaseId, CaseSummary> summaries
```

Semua menyimpan lebih dari satu value. Tetapi semantics-nya berbeda.

## 4.1 `List<CaseId>`

Mengatakan:

```text
Ada urutan.
Duplicate mungkin boleh.
Index mungkin meaningful.
```

## 4.2 `Set<CaseId>`

Mengatakan:

```text
Uniqueness penting.
Duplicate tidak boleh.
Order mungkin tidak penting, tergantung implementation.
```

## 4.3 `SortedSet<CaseId>`

Mengatakan:

```text
Uniqueness + sorted order penting.
Comparator/Comparable menjadi bagian dari correctness.
```

## 4.4 `Queue<CaseId>`

Mengatakan:

```text
Processing order penting.
Biasanya producer-consumer atau task processing.
```

## 4.5 `Map<CaseId, CaseSummary>`

Mengatakan:

```text
Lookup by key penting.
Key equality/hash sangat krusial.
```

## 4.6 Review smell

Jika kamu melihat:

```java
List<String> permissions
```

tanya:

```text
Apakah duplicate boleh?
Apakah order penting?
Apakah string ini closed set?
Apakah harusnya EnumSet<Permission>?
```

---

# 5. Stream Bukan Collection

Stream sering disalahpahami sebagai “collection yang lebih modern”.

Salah.

Stream tidak menyimpan data.

Stream:

- membaca dari source;
- membuat pipeline operasi;
- baru jalan saat terminal operation;
- single-use;
- bisa sequential atau parallel;
- bisa finite atau infinite;
- bisa resource-backed.

## 5.1 Collection stores

```java
List<Case> cases = repository.findAll();
```

`cases` menyimpan element.

## 5.2 Stream computes

```java
List<CaseSummary> summaries = cases.stream()
    .filter(Case::isOpen)
    .map(CaseSummary::from)
    .toList();
```

Stream mendefinisikan komputasi.

## 5.3 Stream is consumed

```java
Stream<Case> stream = cases.stream();

stream.count();
stream.toList(); // error: stream has already been operated upon or closed
```

## 5.4 Resource-backed stream

```java
try (Stream<String> lines = Files.lines(path)) {
    long count = lines.count();
}
```

Stream ini harus ditutup.

## 5.5 Key rule

```text
Return Collection when caller needs data.
Return Stream only when caller participates in traversal/lifetime contract.
```

---

# 6. Empat Dimensi: Storage, Traversal, Computation, Contract

Untuk memahami Collections and Streams, pisahkan empat dimensi.

## 6.1 Storage

Dimensi ini bertanya:

```text
Data disimpan di mana dan bagaimana?
```

Examples:

- `ArrayList` backing array;
- `LinkedList` nodes;
- `HashMap` table;
- `TreeMap` tree;
- `EnumSet` compact bit representation;
- `ConcurrentHashMap` concurrent table.

## 6.2 Traversal

Dimensi ini bertanya:

```text
Bagaimana data dilalui?
```

Tools:

- `Iterator`;
- `ListIterator`;
- `Spliterator`;
- enhanced for-loop;
- stream source traversal.

## 6.3 Computation

Dimensi ini bertanya:

```text
Operasi apa yang dilakukan pada data?
```

Examples:

- filter;
- map;
- reduce;
- group;
- sort;
- distinct;
- aggregate;
- collect.

## 6.4 Contract

Dimensi ini bertanya:

```text
Apa janji semantic dan operational-nya?
```

Examples:

- allows null;
- maintains order;
- unique;
- sorted;
- thread-safe;
- immutable;
- fail-fast;
- weakly consistent;
- serializable;
- stable external contract.

## 6.5 Why this matters

Bug sering terjadi karena mencampur dimensi.

Contoh:

```java
List<OrderLine> lines
```

Developer tahu storage-nya list, tapi tidak tahu contract-nya:

- boleh empty?
- duplicate product boleh?
- order menentukan invoice?
- mutable?
- max size?
- null elements?

---

# 7. Collections Framework sebagai Unified Architecture

Java Collections Framework adalah unified architecture untuk merepresentasikan dan memanipulasi collections secara independen dari detail representasi implementasinya.

Framework ini terdiri dari:

- interfaces;
- implementations;
- algorithms;
- utilities;
- interoperability convention.

## 7.1 Interfaces

Examples:

```java
Collection
List
Set
SortedSet
NavigableSet
Queue
Deque
Map
SortedMap
NavigableMap
```

## 7.2 Implementations

Examples:

```java
ArrayList
LinkedList
HashSet
LinkedHashSet
TreeSet
HashMap
LinkedHashMap
TreeMap
ArrayDeque
PriorityQueue
ConcurrentHashMap
CopyOnWriteArrayList
```

## 7.3 Algorithms/utilities

Examples:

```java
Collections.sort
Collections.binarySearch
Collections.unmodifiableList
Collections.synchronizedList
Collections.emptyList
List.of
Set.of
Map.of
```

## 7.4 Interoperability

Because APIs depend on interfaces:

```java
void process(Collection<CaseId> ids)
```

Caller can provide:

- `ArrayList`;
- `HashSet`;
- immutable list;
- result of another library;
- custom collection.

## 7.5 But abstraction must be precise

Too broad:

```java
void process(Collection<Step> steps)
```

If order matters, use:

```java
void process(List<Step> steps)
```

or:

```java
void process(SequencedCollection<Step> steps)
```

depending semantics.

---

# 8. Interface vs Implementation

A major design skill is choosing interface and implementation separately.

## 8.1 Interface expresses need

```java
Set<Permission> permissions
```

means uniqueness.

```java
List<ApprovalStep> steps
```

means order/index.

```java
Queue<Job> jobs
```

means processing order.

## 8.2 Implementation expresses trade-off

```java
HashSet<Permission>
```

fast membership, no guaranteed encounter order.

```java
LinkedHashSet<Permission>
```

membership + insertion order.

```java
EnumSet<Permission>
```

compact/fast for enum.

## 8.3 API should usually expose interface

```java
public Set<Permission> permissions()
```

not:

```java
public HashSet<Permission> permissions()
```

unless implementation is part of contract.

## 8.4 Internals may choose implementation

```java
private final EnumSet<Permission> permissions;
```

## 8.5 Return immutable interface

```java
public Set<Permission> permissions() {
    return Set.copyOf(permissions);
}
```

## 8.6 Key question

```text
What does caller need to know?
```

Do not expose more than necessary.

---

# 9. The Big Interfaces

## 9.1 `Iterable`

Can provide iterator.

```java
for (CaseId id : ids) {
    ...
}
```

## 9.2 `Collection`

General group of elements.

Has:

- size;
- isEmpty;
- contains;
- iterator;
- add/remove optional;
- bulk operations.

## 9.3 `List`

Ordered sequence with positional access.

Core semantics:

- order;
- duplicates allowed;
- index-based operations.

## 9.4 `Set`

No duplicate elements according to equality semantics.

Core semantics:

- uniqueness;
- membership.

## 9.5 `SortedSet` / `NavigableSet`

Set with sorted order and navigation/range operations.

Core semantics:

- uniqueness by comparator/compareTo;
- sorted order;
- range queries.

## 9.6 `Queue`

Holds elements prior to processing.

Core semantics:

- insertion/retrieval policy;
- often FIFO, but not always.

## 9.7 `Deque`

Double-ended queue.

Core semantics:

- add/remove from both ends;
- can model stack or queue.

## 9.8 `Map`

Key-value association.

Core semantics:

- unique keys;
- lookup by key;
- key equality/hash or ordering.

## 9.9 `SequencedCollection`, `SequencedSet`, `SequencedMap`

Java 21+ interfaces for collections/maps with well-defined encounter order and first/last/reversed operations.

---

# 10. Map Bukan Collection, Tapi Bagian dari Collections Framework

`Map` does not extend `Collection`.

Why?

A map is not a collection of elements. It is an association of keys to values.

But it provides collection views:

```java
map.keySet()
map.values()
map.entrySet()
```

## 10.1 `keySet`

Set of keys.

```java
Set<CaseId> ids = map.keySet();
```

## 10.2 `values`

Collection of values.

```java
Collection<CaseSummary> summaries = map.values();
```

Values may contain duplicates.

## 10.3 `entrySet`

Set of key-value pairs.

```java
Set<Map.Entry<CaseId, CaseSummary>> entries = map.entrySet();
```

## 10.4 View semantics

These views are often backed by the map.

Mutating the map affects views; removing through view can affect map.

## 10.5 Production implication

Do not casually expose map views from internal mutable maps.

---

# 11. Encounter Order dan Sequenced Collections

Encounter order means the order in which elements are encountered during traversal.

Examples:

- `List` has encounter order by index.
- `LinkedHashSet` has insertion encounter order.
- `TreeSet` has sorted encounter order.
- `HashSet` generally should not be treated as stable ordered.
- `LinkedHashMap` has insertion/access encounter order depending mode.
- `TreeMap` has sorted key encounter order.

## 11.1 Before Java 21

Java had many ordered collections, but no common interface for “has first/last/reversed”.

APIs were inconsistent:

- `List.get(0)`;
- `Deque.getFirst()`;
- `SortedSet.first()`;
- `LinkedHashMap` order but awkward first/last access.

## 11.2 Sequenced Collections

JEP 431 introduced:

```java
SequencedCollection
SequencedSet
SequencedMap
```

to standardize encounter-order operations.

## 11.3 Important methods

Conceptually:

```java
getFirst()
getLast()
addFirst()
addLast()
removeFirst()
removeLast()
reversed()
```

For maps:

```java
firstEntry()
lastEntry()
pollFirstEntry()
pollLastEntry()
sequencedKeySet()
sequencedValues()
sequencedEntrySet()
reversed()
```

## 11.4 Mental model

If your domain/API needs:

```text
first
last
reverse order
stable encounter order
```

you should think in terms of sequenced semantics.

## 11.5 Example domain

```java
record ApprovalTrail(SequencedCollection<ApprovalStep> steps) {}
```

This says order matters and first/last may matter.

## 11.6 Caution

Not every sequenced collection supports mutation methods; some can throw `UnsupportedOperationException`.

---

# 12. Iteration Model: Iterable dan Iterator

The enhanced for-loop:

```java
for (CaseId id : caseIds) {
    process(id);
}
```

is based on `Iterable`.

## 12.1 Iterable

```java
interface Iterable<T> {
    Iterator<T> iterator();
}
```

## 12.2 Iterator

Core methods:

```java
boolean hasNext()
T next()
default void remove()
```

## 12.3 External iteration

You control traversal:

```java
Iterator<CaseId> it = ids.iterator();
while (it.hasNext()) {
    CaseId id = it.next();
}
```

## 12.4 Removing while iterating

Correct:

```java
Iterator<CaseId> it = ids.iterator();
while (it.hasNext()) {
    if (shouldRemove(it.next())) {
        it.remove();
    }
}
```

Danger:

```java
for (CaseId id : ids) {
    ids.remove(id); // likely ConcurrentModificationException
}
```

## 12.5 Fail-fast

Many collections provide fail-fast iterators that detect structural modification during iteration on best-effort basis.

Do not write correctness logic relying on ConcurrentModificationException.

## 12.6 Iterator as boundary

If API accepts `Iterable<T>`, it says:

```text
I only need to traverse.
I do not need size, random access, uniqueness, or mutation.
```

This is powerful for flexible APIs.

---

# 13. Spliterator: Traversal + Partitioning

Spliterator is less commonly used directly, but crucial for Stream.

A Spliterator is an object for traversing and partitioning elements of a source. A source can be an array, collection, IO channel, or generator function.

## 13.1 Why Spliterator exists

Iterator can traverse, but cannot describe:

- size estimate;
- ability to split;
- encounter order;
- distinctness;
- sortedness;
- immutability;
- concurrency;
- non-null guarantee.

Spliterator adds those.

## 13.2 Core methods

Conceptually:

```java
boolean tryAdvance(Consumer<? super T> action)
void forEachRemaining(Consumer<? super T> action)
Spliterator<T> trySplit()
long estimateSize()
int characteristics()
```

## 13.3 Characteristics

Important flags:

```java
ORDERED
DISTINCT
SORTED
SIZED
NONNULL
IMMUTABLE
CONCURRENT
SUBSIZED
```

## 13.4 Parallel stream foundation

Parallel streams depend on splitting source into chunks.

If source splits well, parallelism can help.

If source splits poorly, parallelism can be worse.

## 13.5 Example

ArrayList spliterator can split efficiently.

LinkedList splitting is less locality-friendly.

IO line stream may not split well.

## 13.6 Rule

```text
Parallel stream performance starts at Spliterator quality.
```

---

# 14. Stream Pipeline Model

A stream pipeline consists of:

```text
source
  -> zero or more intermediate operations
  -> terminal operation
```

Example:

```java
List<String> names = cases.stream()
    .filter(Case::isOpen)
    .map(Case::assignedOfficerName)
    .distinct()
    .sorted()
    .toList();
```

## 14.1 Source

```java
cases.stream()
```

Can come from:

- collection;
- array;
- file;
- generator;
- range;
- custom spliterator.

## 14.2 Intermediate operation

Returns another stream.

Examples:

```java
filter
map
flatMap
distinct
sorted
limit
skip
peek
takeWhile
dropWhile
```

Intermediate operations are lazy.

## 14.3 Terminal operation

Produces result or side effect.

Examples:

```java
toList
collect
reduce
forEach
count
min
max
findFirst
anyMatch
```

Terminal operation triggers execution.

## 14.4 Stateless vs stateful intermediate

Stateless:

```java
map
filter
```

Stateful:

```java
distinct
sorted
limit
skip
```

Stateful operations may need memory or coordination.

## 14.5 Short-circuiting

Some operations can stop early:

```java
anyMatch
findFirst
limit
takeWhile
```

## 14.6 One-use

A stream pipeline can be consumed once.

---

# 15. Collector sebagai Reduction Protocol

`collect` is a mutable reduction.

Common:

```java
List<CaseSummary> summaries = cases.stream()
    .map(CaseSummary::from)
    .toList();
```

or:

```java
Map<CaseStatus, List<Case>> byStatus = cases.stream()
    .collect(Collectors.groupingBy(Case::status));
```

## 15.1 Collector components

A Collector conceptually has:

```text
supplier
accumulator
combiner
finisher
characteristics
```

## 15.2 Supplier

Creates mutable container.

```java
ArrayList::new
```

## 15.3 Accumulator

Adds one element.

```java
List::add
```

## 15.4 Combiner

Merges partial results.

Important for parallel streams.

## 15.5 Finisher

Transforms accumulator to final result.

## 15.6 Characteristics

Examples:

- `CONCURRENT`;
- `UNORDERED`;
- `IDENTITY_FINISH`.

## 15.7 Production importance

Most broken custom collectors fail because combiner is wrong or because accumulator is not safe for parallel use.

## 15.8 Rule

```text
Collector design is algebra + mutability + parallel correctness.
```

---

# 16. Lazy Evaluation

Streams are lazy.

This code does nothing:

```java
Stream<CaseSummary> s = cases.stream()
    .filter(c -> {
        System.out.println("filter");
        return c.isOpen();
    })
    .map(CaseSummary::from);
```

No terminal operation.

This executes:

```java
List<CaseSummary> result = s.toList();
```

## 16.1 Why laziness matters

Because it enables:

- pipeline fusion;
- short-circuiting;
- avoiding intermediate collections;
- infinite streams with limit;
- efficient traversal.

## 16.2 Vertical execution mental model

For many pipelines, execution can be per element through multiple operations:

```text
element1 -> filter -> map -> terminal
element2 -> filter -> map -> terminal
```

Not necessarily:

```text
filter all -> map all -> terminal
```

But stateful operations like `sorted` and `distinct` may need buffering.

## 16.3 Example short-circuit

```java
boolean exists = cases.stream()
    .filter(Case::isOpen)
    .anyMatch(c -> c.priority() == HIGH);
```

Can stop early.

## 16.4 Side effect surprise

Because operations are lazy, side effects in intermediate ops happen only when terminal executes.

## 16.5 Rule

Do not put essential side effects in intermediate operations.

---

# 17. Internal Iteration vs External Iteration

## 17.1 External iteration

You control loop.

```java
List<CaseSummary> result = new ArrayList<>();
for (Case c : cases) {
    if (c.isOpen()) {
        result.add(CaseSummary.from(c));
    }
}
```

## 17.2 Internal iteration

Stream controls traversal.

```java
List<CaseSummary> result = cases.stream()
    .filter(Case::isOpen)
    .map(CaseSummary::from)
    .toList();
```

## 17.3 External iteration strengths

- complex control flow;
- early break/continue;
- checked exceptions easier;
- debugging easier;
- mutable algorithm clearer;
- index access.

## 17.4 Internal iteration strengths

- declarative transformation;
- composition;
- parallelism possibility;
- fewer temporary variables;
- readable data pipeline.

## 17.5 Top-tier approach

Do not blindly prefer streams or loops.

Ask:

```text
Which expresses the intent better and safer for this workload?
```

## 17.6 Rule

Streams are great for transformation pipelines. Loops are great for procedural control.

---

# 18. Mutability and Ownership

Collections are often mutable.

This is one of the biggest sources of bugs.

## 18.1 Mutable collection

```java
List<String> xs = new ArrayList<>();
xs.add("a");
```

## 18.2 Unmodifiable view

```java
List<String> view = Collections.unmodifiableList(xs);
```

If `xs` changes, `view` reflects change.

## 18.3 Immutable copy

```java
List<String> copy = List.copyOf(xs);
```

`copy` does not change if `xs` changes.

## 18.4 Shallow immutability

If elements are mutable, immutable collection does not freeze elements.

```java
List<MutableUser> users = List.copyOf(raw);
users.get(0).setName("changed");
```

## 18.5 Ownership questions

For every collection field/parameter:

```text
Does caller keep ownership?
Do we copy?
Do we store reference?
Do we return live view?
Do we return snapshot?
Can caller mutate it?
Can elements mutate?
```

## 18.6 Constructor pattern

```java
public record ViolationList(List<Violation> values) {
    public ViolationList {
        values = List.copyOf(values);
        if (values.isEmpty()) {
            throw new IllegalArgumentException("violations required");
        }
    }
}
```

## 18.7 Rule

No collection should cross a boundary without ownership semantics.

---

# 19. Equality, Hashing, Ordering

Collections rely deeply on equality and ordering.

## 19.1 Hash-based collections

```java
HashMap
HashSet
LinkedHashMap
LinkedHashSet
ConcurrentHashMap
```

Depend on:

```java
equals
hashCode
```

## 19.2 Sorted collections

```java
TreeMap
TreeSet
```

Depend on:

```java
Comparator
Comparable
```

## 19.3 Mutable key failure

```java
Map<UserKey, User> map = new HashMap<>();
map.put(key, user);
key.setEmail("new@example.com");
map.get(key); // may fail
```

## 19.4 Comparator inconsistency

If comparator says two objects compare equal, TreeSet treats them as duplicate even if equals differs.

## 19.5 BigDecimal trap

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00")) // false
new BigDecimal("1.0").compareTo(new BigDecimal("1.00")) // 0
```

This matters for HashSet vs TreeSet.

## 19.6 Arrays as keys

Arrays use identity equals/hash.

Use wrapper or `List`/custom class with content equality.

## 19.7 Rule

Before putting a type in Set/Map, review equality/hash/order.

---

# 20. Null Semantics

Different collections handle null differently.

## 20.1 Some allow null

`ArrayList` and `HashMap` can contain null values.

`HashMap` allows one null key.

## 20.2 Some disallow null

`ConcurrentHashMap` disallows null keys/values.

Many immutable collection factories disallow null.

## 20.3 Map.get ambiguity

```java
V value = map.get(key);
```

If value is null, does it mean:

```text
key absent?
key present with null value?
```

Use:

```java
map.containsKey(key)
```

when needed.

## 20.4 Stream null risk

```java
list.stream()
    .map(User::email)
    .map(String::toLowerCase) // NPE if email null
```

## 20.5 Better domain

Prefer null-free collections.

Use Optional as return or model absence explicitly.

## 20.6 Rule

Define null policy at collection boundary.

---

# 21. Big-O Is Not Enough

Many developers stop at Big-O.

But collection performance depends on:

- memory layout;
- object count;
- CPU cache locality;
- allocation rate;
- GC pressure;
- branch prediction;
- hash quality;
- comparator cost;
- boxing;
- synchronization;
- contention;
- source splitting;
- stream stateful operations.

## 21.1 Example: ArrayList vs LinkedList

Both can iterate O(n).

But `ArrayList` usually has better locality and less object overhead.

## 21.2 Example: HashMap O(1)

Average lookup O(1), but:

- hashCode cost matters;
- collision matters;
- resizing matters;
- key allocation matters;
- memory overhead matters.

## 21.3 Example: Stream vs loop

Both can be O(n), but stream may involve:

- lambda dispatch;
- boxing;
- pipeline overhead;
- allocation;
- JIT optimization.

Sometimes stream is fine. Sometimes loop is better.

## 21.4 Measurement

Use:

- JMH for microbenchmark;
- JFR for allocation/CPU profiling;
- heap dump for retained memory;
- production-like load tests.

## 21.5 Rule

Big-O gives shape. Production performance needs cost model.

---

# 22. Concurrency Dimension

Collections can be:

- not thread-safe;
- externally synchronized;
- synchronized wrapper;
- concurrent;
- copy-on-write;
- immutable snapshot.

## 22.1 Not thread-safe

```java
ArrayList
HashMap
HashSet
```

Unsafe for concurrent mutation.

## 22.2 Synchronized wrapper

```java
Collections.synchronizedList(list)
```

Synchronizes operations but iteration still needs external synchronization.

## 22.3 Concurrent collection

```java
ConcurrentHashMap
ConcurrentLinkedQueue
BlockingQueue
CopyOnWriteArrayList
```

Designed for concurrent use with specific semantics.

## 22.4 Immutable snapshot

```java
List.copyOf(raw)
```

Safe to share if elements immutable.

## 22.5 Common trap

```java
ConcurrentHashMap<UserId, List<Permission>> map;
map.get(userId).add(permission);
```

Map is concurrent. List value may not be.

## 22.6 Rule

Thread-safe container does not make contained objects thread-safe.

---

# 23. Boundary Dimension: API, DB, JSON, Kafka, Cache

Collections often cross boundaries.

## 23.1 API

JSON has arrays and objects, not Java List/Set/Map semantics.

If API returns:

```json
["A", "B", "A"]
```

Is duplicate allowed?

OpenAPI should define:

- minItems;
- maxItems;
- uniqueItems;
- item schema;
- null items;
- order meaning.

## 23.2 DB

Collections can map to:

- child table;
- join table;
- JSON array column;
- array column;
- delimited string anti-pattern.

Need decide:

- order;
- uniqueness;
- queryability;
- constraints.

## 23.3 Kafka/event

Events with arrays need compatibility:

- adding element fields;
- ordering;
- max size;
- schema evolution;
- unknown elements.

## 23.4 Cache

Collections in cache should be immutable snapshots.

Cache key must include all dimensions, e.g. tenant.

## 23.5 Rule

Collection semantics must survive boundary translation.

---

# 24. Domain Modeling with Collections

Collections can be domain objects.

## 24.1 PermissionSet

```java
public record PermissionSet(EnumSet<Permission> values) {
    public PermissionSet {
        Objects.requireNonNull(values);
        values = values.clone();
    }

    public boolean allows(Permission permission) {
        return values.contains(permission);
    }

    public Set<Permission> asSet() {
        return Set.copyOf(values);
    }
}
```

## 24.2 NonEmptyList

```java
public record NonEmptyList<T>(List<T> values) {
    public NonEmptyList {
        values = List.copyOf(values);
        if (values.isEmpty()) {
            throw new IllegalArgumentException("List must not be empty");
        }
    }
}
```

## 24.3 ViolationList

```java
public record ViolationList(List<Violation> values) {
    public ViolationList {
        values = List.copyOf(values);
        if (values.isEmpty()) {
            throw new IllegalArgumentException("At least one violation required");
        }
    }
}
```

## 24.4 CaseEventHistory

```java
public record CaseEventHistory(SequencedCollection<CaseEvent> events) {
    public CaseEventHistory {
        events = List.copyOf(events);
    }

    public CaseEvent latest() {
        return events.getLast();
    }
}
```

## 24.5 Why wrap collection?

Because raw collection does not express:

- non-empty;
- unique;
- sorted;
- ordered;
- max size;
- domain operations;
- safe mutation.

## 24.6 Rule

If collection invariant matters, make collection itself a value object.

---

# 25. Common Misconceptions

## 25.1 “ArrayList is always best”

No. It is often good default for lists, but not always.

Use:

- `ArrayDeque` for queue/stack;
- `EnumSet` for enum set;
- `HashSet` for membership;
- `TreeMap` for range query;
- `ConcurrentHashMap` for concurrent lookup.

## 25.2 “LinkedList is good for insert/delete”

Only sometimes. Node traversal and memory locality often make it worse in practice.

## 25.3 “Set means unordered”

Not exactly. `Set` interface does not promise general order, but implementations can have encounter order or sorted order.

## 25.4 “HashMap is ordered because it looks ordered”

Do not rely on HashMap iteration order.

## 25.5 “Stream is faster”

Not necessarily. Stream can be more readable. Performance depends.

## 25.6 “parallelStream is faster”

Often false in server applications.

## 25.7 “Collectors.toMap is straightforward”

Duplicate keys can explode unless merge policy defined.

## 25.8 “ConcurrentHashMap makes everything thread-safe”

Only map operations are thread-safe. Mutable values still need care.

## 25.9 “Unmodifiable means immutable”

Unmodifiable view can reflect backing collection mutations.

## 25.10 “Returning Stream is flexible”

It can leak resource/lifetime complexity to caller.

---

# 26. Production Failure Modes yang Akan Sering Kita Bahas

## 26.1 Duplicate key in toMap

```java
users.stream()
    .collect(Collectors.toMap(User::email, Function.identity()));
```

Fails if duplicate email.

## 26.2 Mutable HashMap key

Key changes after put; lookup fails.

## 26.3 TreeSet comparator inconsistency

TreeSet drops distinct elements.

## 26.4 Direct entity collection serialization

Lazy load/N+1/circular reference/security leak.

## 26.5 Unbounded queue OOM

Producer faster than consumer.

## 26.6 Parallel stream common pool issue

Blocking tasks starve unrelated tasks.

## 26.7 Stream over file not closed

File handles leak.

## 26.8 HashMap cache no eviction

Memory leak.

## 26.9 `subList` retention

Small sublist retains large backing list in some contexts/implementations.

## 26.10 ConcurrentHashMap with mutable values

Race corruption.

## 26.11 Null in stream pipeline

NPE far from source.

## 26.12 Grouping huge dataset

`groupingBy` builds massive in-memory map.

---

# 27. How to Think Like Top 1% Engineer

For every collection/stream, ask these layers.

## 27.1 Semantic layer

```text
What does this data structure mean?
Order?
Uniqueness?
Duplicates?
Null?
Empty?
Bounded?
```

## 27.2 Mutation layer

```text
Who owns it?
Can caller mutate?
Is it snapshot or live?
Are elements mutable?
```

## 27.3 Performance layer

```text
How many elements?
How often read/write?
Lookup or iteration?
Memory?
Boxing?
GC?
```

## 27.4 Concurrency layer

```text
Shared across threads?
Concurrent mutation?
Safe publication?
Thread-safe values?
```

## 27.5 Boundary layer

```text
Does it cross API/DB/event/cache?
Does external contract preserve semantics?
```

## 27.6 Stream layer

```text
Lazy?
Single-use?
Resource-backed?
Stateful operations?
Short-circuit?
Parallel-safe?
```

## 27.7 Failure layer

```text
What production bug happens if assumptions are wrong?
```

## 27.8 Senior rule

```text
Pick the narrowest abstraction that expresses the required semantics.
```

---

# 28. Roadmap Seri Ini

## 28.1 Foundation

Part 000 - 013:

- big picture;
- hierarchy;
- list/set/map/queue;
- sequenced collections;
- iteration;
- spliterator;
- equality/hash/order;
- mutability;
- factories;
- generics;
- null.

## 28.2 Internals and performance

Part 014 - 023:

- cost model;
- HashMap internals;
- ArrayList internals;
- tree structures;
- enum collections;
- concurrent collections;
- blocking queues;
- weak/identity maps.

## 28.3 Streams core

Part 024 - 036:

- stream mental model;
- sources;
- intermediate operations;
- terminal operations;
- primitive streams;
- reduction;
- collectors;
- grouping;
- ordering;
- laziness;
- side effects.

## 28.4 Advanced streams

Part 037 - 046:

- parallel streams;
- correctness;
- performance;
- resource management;
- exception/null handling;
- mapMulti;
- custom collectors;
- custom spliterators.

## 28.5 Integration

Part 047 - 059:

- domain modeling;
- API design;
- persistence;
- security;
- concurrency;
- memory leaks;
- advanced maps;
- advanced aggregation;
- functional patterns;
- debugging;
- testing.

## 28.6 Production mastery

Part 060 - 062:

- failure cases;
- review checklist;
- capstone.

---

# 29. Checklist Awal

Saat melihat collection:

```java
Collection<T> xs
List<T> xs
Set<T> xs
Map<K,V> xs
Stream<T> xs
```

tanyakan:

## 29.1 Meaning

- Apa konsep domain-nya?
- Apakah raw collection cukup?
- Perlu wrapper domain?

## 29.2 Order

- Apakah order penting?
- Apakah first/last penting?
- Apakah reverse order dibutuhkan?

## 29.3 Uniqueness

- Apakah duplicate boleh?
- Berdasarkan equals atau comparator?

## 29.4 Null

- Apakah null element/key/value boleh?
- Apa arti null?

## 29.5 Mutability

- Siapa boleh mutate?
- Snapshot atau live view?
- Perlu defensive copy?

## 29.6 Size

- Bisa kosong?
- Ada max size?
- Bisa jutaan element?

## 29.7 Performance

- Operasi dominan: lookup, insert, remove, iterate, sort?
- Memory sensitive?
- Boxing?

## 29.8 Concurrency

- Shared antar thread?
- Concurrent read/write?
- Values immutable?

## 29.9 Boundary

- Akan diserialize?
- Akan disimpan DB?
- Akan dikirim API?
- Akan dicache?

## 29.10 Streams

- Source finite?
- Resource-backed?
- Pipeline lazy?
- Operation stateful?
- Parallel safe?

---

# 30. Latihan Mental Model

## Latihan 1 — Choose Interface

Untuk kasus berikut, pilih interface yang paling tepat:

1. daftar approval steps dengan urutan penting;
2. permission user yang tidak boleh duplicate;
3. antrian job background;
4. lookup case summary by case ID;
5. latest event history yang butuh first/last;
6. set enum permission;
7. range lookup by timestamp.

Jelaskan bukan hanya “pakai apa”, tetapi semantic contract-nya.

## Latihan 2 — Boundary Semantics

Desain API JSON untuk:

```java
Set<Permission>
List<ApprovalStep>
Map<CaseId, CaseSummary>
```

Jelaskan:

- order;
- duplicate;
- max size;
- key representation;
- null policy.

## Latihan 3 — Stream or Loop

Pilih stream atau loop:

1. filter-map response list sederhana;
2. parsing CSV besar dengan error accumulation;
3. early return saat menemukan valid item;
4. grouping 10 juta rows;
5. IO operation per element.

Jelaskan trade-off.

## Latihan 4 — Mutability Review

Review code:

```java
record Order(List<OrderLine> lines) {}
```

Apa bug yang mungkin? Refactor.

## Latihan 5 — Production Prediction

Prediksi production bug dari:

```java
Map<String, Object> attributes;
List<Integer> ids;
ConcurrentHashMap<UserId, List<Permission>> permissions;
Stream<String> lines = Files.lines(path);
```

---

# 31. Ringkasan

Part 000 adalah peta.

Core mental model:

```text
Collection = data structure + semantic contract
Stream = lazy computation pipeline
Collector = reduction protocol
Spliterator = traversal and partitioning contract
```

Hal penting:

- Collection bukan hanya group; ia membawa semantics.
- Stream bukan collection; ia komputasi lazy.
- Interface mengekspresikan kebutuhan; implementation mengekspresikan trade-off.
- Encounter order sekarang punya dukungan lebih eksplisit lewat Sequenced Collections.
- Iterator adalah external traversal.
- Spliterator adalah traversal + partitioning, fondasi stream/parallel stream.
- Collector adalah protocol untuk menghasilkan result.
- Mutability, equality, null, ordering, concurrency, dan boundary sama pentingnya dengan API method.
- Big-O tidak cukup untuk production.
- Collections/Streams adalah area yang sangat sering menjadi sumber bug production.

Target seri ini:

```text
Tidak hanya bisa memakai Collections and Streams,
tetapi bisa mendesain, mereview, mengoptimalkan, dan mengamankan penggunaannya.
```

---

# 32. Referensi

1. Java SE 25 — The Collections Framework  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-index.html

2. Java SE 25 — Collections Framework Overview  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-overview.html

3. Java SE 25 — `java.util.stream` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

4. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

5. Java SE 25 — `Spliterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterator.html

6. Java SE 25 — `Spliterators`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterators.html

7. JEP 431 — Sequenced Collections  
   https://openjdk.org/jeps/431

8. Java SE 25 — `java.util` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/package-summary.html

9. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

10. Java SE 25 — `Iterator`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Iterator.html

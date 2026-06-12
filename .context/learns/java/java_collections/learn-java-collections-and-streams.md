# Advanced Java Collections and Streams — Proposed Syllabus

## Part 000 — Peta Besar Collections and Streams

**Judul:** Collections and Streams as Data Architecture, Not Just Utility APIs

Fokus:

* beda collection, container, aggregate, sequence, stream, iterator, spliterator;
* Collections Framework sebagai architecture;
* Stream sebagai computation pipeline;
* kapan collection adalah domain model;
* kapan stream adalah query/transformation;
* mental model: storage vs traversal vs computation vs contract;
* hubungan Collections dengan Data Types yang sudah selesai;
* apa yang akan dibahas sepanjang seri.

Output mental model:

```text
Collection = data structure + semantic contract
Stream = lazy computation pipeline over data source
Collector = reduction protocol
Spliterator = traversal and partitioning contract
```

---

## Part 001 — Collection Interface Hierarchy Deep Dive

**Judul:** `Iterable`, `Collection`, `List`, `Set`, `Queue`, `Deque`, `Map`, and Sequenced Interfaces

Fokus:

* `Iterable`;
* `Iterator`;
* `Collection`;
* `List`;
* `Set`;
* `SortedSet`;
* `NavigableSet`;
* `Queue`;
* `Deque`;
* `Map`;
* `SortedMap`;
* `NavigableMap`;
* `SequencedCollection`;
* `SequencedSet`;
* `SequencedMap`;
* contract vs implementation;
* why interface choice matters more than class choice;
* semantic hierarchy and design smell.

---

## Part 002 — Lists Deep Dive

**Judul:** `List`: Ordering, Indexing, Random Access, Mutation, and Implementation Trade-Offs

Fokus:

* `ArrayList`;
* `LinkedList`;
* immutable/unmodifiable lists;
* `RandomAccess`;
* index-based operations;
* insertion/removal cost;
* iteration cost;
* memory locality;
* list equality;
* list as domain ordered sequence;
* anti-pattern: defaulting to `LinkedList`;
* when `ArrayDeque` is better than `LinkedList`.

---

## Part 003 — Sets Deep Dive

**Judul:** `Set`: Uniqueness, Hashing, Ordering, Identity, and Membership Semantics

Fokus:

* `HashSet`;
* `LinkedHashSet`;
* `TreeSet`;
* `EnumSet`;
* immutable sets;
* equality/hashCode impact;
* comparator consistency;
* duplicate semantics;
* set as domain invariant;
* `Set` vs `List` in API contract;
* uniqueness in DB/API;
* performance and memory.

---

## Part 004 — Maps Deep Dive

**Judul:** `Map`: Key Semantics, Lookup, Collision, Ordering, and Domain Modeling

Fokus:

* `HashMap`;
* `LinkedHashMap`;
* `TreeMap`;
* `EnumMap`;
* `IdentityHashMap`;
* `WeakHashMap`;
* `ConcurrentHashMap`;
* null key/value policies;
* hash collision;
* resizing;
* load factor;
* key immutability;
* map equality;
* map as index;
* map as cache;
* map as domain smell;
* `Map<String,Object>` anti-pattern.

---

## Part 005 — Queue and Deque Deep Dive

**Judul:** `Queue`, `Deque`, `ArrayDeque`, Blocking Queues, and Work Processing

Fokus:

* FIFO/LIFO semantics;
* `Queue` methods: `offer`, `poll`, `peek`, `add`, `remove`, `element`;
* `Deque`;
* `ArrayDeque`;
* `PriorityQueue`;
* `BlockingQueue`;
* `ArrayBlockingQueue`;
* `LinkedBlockingQueue`;
* `DelayQueue`;
* `SynchronousQueue`;
* producer-consumer;
* backpressure;
* queue size as memory risk.

---

## Part 006 — Sequenced Collections

**Judul:** Java 21+ Sequenced Collections: First, Last, Reversed, and Encounter Order

Fokus:

* motivation JEP 431;
* `SequencedCollection`;
* `SequencedSet`;
* `SequencedMap`;
* `reversed()`;
* `addFirst`, `addLast`, `getFirst`, `getLast`;
* encounter order as type-level contract;
* migration from old APIs;
* `LinkedHashMap`, `TreeMap`, `List`, `Deque`;
* domain APIs that need first/last/reverse order.

---

## Part 007 — Iteration Model

**Judul:** Iteration: `Iterator`, `ListIterator`, Fail-Fast, Snapshot, Weakly Consistent Iterators

Fokus:

* iterator contract;
* enhanced for-loop desugaring;
* `Iterator.remove`;
* fail-fast behavior;
* `ConcurrentModificationException`;
* weakly consistent iterators;
* snapshot iterators;
* `ListIterator`;
* modification during iteration;
* safe removal patterns;
* iterator as boundary.

---

## Part 008 — Spliterator Deep Dive

**Judul:** `Spliterator`: Traversal, Partitioning, Characteristics, and Parallel Stream Foundation

Fokus:

* why Spliterator exists;
* `tryAdvance`;
* `forEachRemaining`;
* `trySplit`;
* characteristics:

  * ORDERED;
  * DISTINCT;
  * SORTED;
  * SIZED;
  * NONNULL;
  * IMMUTABLE;
  * CONCURRENT;
  * SUBSIZED;
* estimated size;
* custom Spliterator;
* interaction with parallel streams;
* performance and correctness.

---

## Part 009 — Equality, Hashing, and Ordering in Collections

**Judul:** The Hidden Contract Behind Collection Correctness

Fokus:

* `equals`;
* `hashCode`;
* `Comparable`;
* `Comparator`;
* `Comparator` consistency with equals;
* mutable keys;
* arrays as keys;
* `BigDecimal` scale;
* entity equality;
* record equality;
* comparator chains;
* null handling;
* production bugs in `HashMap`, `HashSet`, `TreeSet`.

---

## Part 010 — Mutability, Immutability, and Defensive Copying

**Judul:** Mutable, Unmodifiable, Immutable, Persistent, and Snapshot Collections

Fokus:

* mutable collection;
* unmodifiable view;
* immutable copy;
* `List.of`, `Set.of`, `Map.of`;
* `copyOf`;
* `Collections.unmodifiable*`;
* shallow immutability;
* collection components in records;
* defensive copy in constructor/accessor;
* ownership policy;
* immutable snapshot for concurrency/API/cache.

---

## Part 011 — Collection Factories and Utility APIs

**Judul:** `Collections`, `Arrays`, `List.of`, `Set.of`, `Map.of`, and Factory Semantics

Fokus:

* `Collections.emptyList`;
* singleton collections;
* unmodifiable wrappers;
* synchronized wrappers;
* checked collections;
* `Arrays.asList`;
* `List.of`;
* `Set.of`;
* `Map.of`;
* `copyOf`;
* `nCopies`;
* `frequency`;
* `disjoint`;
* `shuffle`;
* `sort`;
* pitfalls and production gotchas.

---

## Part 012 — Collections and Generics

**Judul:** Invariance, Wildcards, PECS, Heap Pollution, and Type-Safe Collection APIs

Fokus:

* `List<T>` invariance;
* `Collection<? extends T>`;
* `Collection<? super T>`;
* producer/consumer APIs;
* wildcard capture;
* raw collections;
* heap pollution;
* generic arrays;
* varargs + generics;
* `ClassCastException` late failure;
* designing reusable collection APIs.

---

## Part 013 — Collections and Null

**Judul:** Null Elements, Null Keys, Null Values, Absence, and API Semantics

Fokus:

* which collections allow null;
* `HashMap` null key/value;
* `ConcurrentHashMap` no null;
* `TreeMap` null comparator behavior;
* null as element;
* absence vs null value;
* `Map.get` ambiguity;
* `containsKey`;
* Optional and collections;
* API/DB/JSON null mapping.

---

## Part 014 — Collections and Performance Cost Model

**Judul:** Big-O Is Not Enough: Memory, Locality, Allocation, GC, and CPU Costs

Fokus:

* Big-O vs constant factor;
* object overhead;
* pointer chasing;
* cache locality;
* boxing;
* allocation rate;
* GC pressure;
* `ArrayList` vs `LinkedList`;
* `HashMap` resizing;
* primitive arrays vs boxed collections;
* profiling collections;
* JFR/JMH measurement strategy.

---

## Part 015 — HashMap Internals

**Judul:** `HashMap`: Buckets, Load Factor, Resizing, Treeification, and Key Design

Fokus:

* table array;
* node;
* hash spreading;
* bucket collision;
* resizing;
* load factor;
* capacity planning;
* tree bins;
* mutable keys;
* poor hashCode;
* custom key design;
* memory cost;
* iteration order non-contract;
* production tuning.

---

## Part 016 — ArrayList Internals

**Judul:** `ArrayList`: Growth, Capacity, Random Access, and Memory Locality

Fokus:

* backing array;
* capacity vs size;
* growth policy;
* `ensureCapacity`;
* remove shifting;
* `subList`;
* iteration;
* fail-fast;
* memory retention;
* `trimToSize`;
* batch operations;
* large list risks.

---

## Part 017 — Tree Structures

**Judul:** `TreeMap`, `TreeSet`, Navigable APIs, Range Queries, and Comparator Semantics

Fokus:

* red-black tree mental model;
* sorted vs navigable;
* `floor`, `ceiling`, `lower`, `higher`;
* range views;
* comparator consistency;
* mutable comparable fields;
* null policy;
* domain use cases:

  * timeline;
  * intervals;
  * ranking;
  * range lookup.

---

## Part 018 — Enum Collections

**Judul:** `EnumSet` and `EnumMap`: Compact, Fast, and Domain-Friendly Collections

Fokus:

* why enum-specialized collections exist;
* bit-vector mental model;
* enum ordinal internally vs external ordinal danger;
* permission sets;
* state transition table;
* enum key maps;
* performance;
* API design;
* serialization caveats.

---

## Part 019 — Concurrent Collections Overview

**Judul:** Concurrent Collections: Safety, Progress, Iteration, and Contention

Fokus:

* `ConcurrentHashMap`;
* `CopyOnWriteArrayList`;
* `ConcurrentLinkedQueue`;
* `BlockingQueue`;
* `ConcurrentSkipListMap`;
* weakly consistent iterators;
* compound operations;
* atomic map methods;
* mutable values problem;
* contention and scalability;
* choosing concurrent collections.

---

## Part 020 — ConcurrentHashMap Deep Dive

**Judul:** `ConcurrentHashMap`: Atomic Operations, Compute, Merge, and Hot Key Pitfalls

Fokus:

* no null keys/values;
* `putIfAbsent`;
* `computeIfAbsent`;
* `compute`;
* `merge`;
* mapping function caveats;
* hot key contention;
* `LongAdder` values;
* bulk operations;
* weak consistency;
* cache use;
* production failure modes.

---

## Part 021 — Blocking Queues and Backpressure

**Judul:** Blocking Queues, Producer-Consumer Design, and Bounded Memory

Fokus:

* bounded vs unbounded queues;
* `put`, `take`, `offer`, `poll`;
* backpressure;
* poison pill;
* timeout;
* fairness;
* rejection strategy;
* queue as load buffer;
* why unbounded queue can kill service;
* relation to executors.

---

## Part 022 — CopyOnWrite and Snapshot Collections

**Judul:** `CopyOnWriteArrayList`, Read-Mostly Workloads, and Snapshot Semantics

Fokus:

* copy-on-write model;
* read-heavy/write-light cases;
* listener lists;
* iteration snapshot;
* memory cost;
* write amplification;
* stale reads;
* alternatives.

---

## Part 023 — Weak, Soft, and Identity Maps

**Judul:** `WeakHashMap`, `IdentityHashMap`, Reference Semantics, and Cache Misuse

Fokus:

* identity equality;
* weak keys;
* GC interaction;
* canonicalization;
* memory leak prevention;
* why `WeakHashMap` is not normal cache;
* identity-based maps;
* classloader leak risks;
* when to avoid.

---

## Part 024 — Stream Mental Model

**Judul:** Streams Are Lazy Pipelines, Not Collections

Fokus:

* source;
* intermediate operation;
* terminal operation;
* lazy evaluation;
* single-use streams;
* internal iteration;
* no storage;
* encounter order;
* stateless vs stateful operations;
* side effects;
* stream vs collection vs iterator;
* common misconceptions.

---

## Part 025 — Stream Sources

**Judul:** Creating Streams from Collections, Arrays, Files, Generators, Ranges, and Custom Sources

Fokus:

* `collection.stream`;
* `parallelStream`;
* `Arrays.stream`;
* `Stream.of`;
* `Stream.empty`;
* `Stream.generate`;
* `Stream.iterate`;
* `IntStream.range`;
* `Files.lines`;
* infinite streams;
* resource management;
* custom source with Spliterator.

---

## Part 026 — Intermediate Operations

**Judul:** `map`, `filter`, `flatMap`, `distinct`, `sorted`, `peek`, `limit`, `skip`, `takeWhile`, `dropWhile`

Fokus:

* stateless operations;
* stateful operations;
* short-circuiting;
* operation ordering;
* `map` vs `flatMap`;
* `distinct` and equals/hash;
* `sorted` and comparator;
* `peek` misuse;
* performance implications.

---

## Part 027 — Terminal Operations

**Judul:** `forEach`, `forEachOrdered`, `reduce`, `collect`, `toList`, `count`, `min`, `max`, `findFirst`, `findAny`, `anyMatch`

Fokus:

* terminal operation triggers pipeline;
* reduction;
* search/match;
* short-circuit;
* encounter order;
* side effects;
* `toList` vs collectors;
* Optional result;
* terminal operation design.

---

## Part 028 — Primitive Streams

**Judul:** `IntStream`, `LongStream`, `DoubleStream`, Boxing Avoidance, and Numeric Pipelines

Fokus:

* primitive stream types;
* `mapToInt`, `mapToLong`, `mapToDouble`;
* boxing/unboxing;
* summary statistics;
* range/rangeClosed;
* numeric reductions;
* when primitive stream is worth it;
* limitation: only int/long/double.

---

## Part 029 — Reduction Deep Dive

**Judul:** Reduction Algebra: Identity, Accumulator, Combiner, Associativity, and Parallel Correctness

Fokus:

* `reduce`;
* identity;
* accumulator;
* combiner;
* associative operation;
* identity law;
* mutable reduction anti-pattern;
* parallel reduce correctness;
* floating-point nondeterminism;
* monoid mental model.

---

## Part 030 — Collectors Deep Dive

**Judul:** `Collector`: Supplier, Accumulator, Combiner, Finisher, Characteristics

Fokus:

* collector contract;
* mutable reduction;
* supplier;
* accumulator;
* combiner;
* finisher;
* characteristics:

  * CONCURRENT;
  * UNORDERED;
  * IDENTITY_FINISH;
* custom collector;
* correctness in parallel stream;
* collector testing.

---

## Part 031 — Built-in Collectors

**Judul:** `Collectors`: `toList`, `toSet`, `toMap`, `groupingBy`, `partitioningBy`, `mapping`, `flatMapping`, `filtering`, `teeing`

Fokus:

* `toList`;
* `toUnmodifiableList`;
* `toMap` merge function;
* duplicate key failure;
* `groupingBy`;
* downstream collectors;
* `partitioningBy`;
* `collectingAndThen`;
* `summarizing`;
* `joining`;
* `teeing`;
* production patterns.

---

## Part 032 — Grouping and Aggregation Patterns

**Judul:** Production-Grade Grouping, Aggregation, Indexing, and Multi-Level Collectors

Fokus:

* group by key;
* group by composite key;
* multi-level group;
* count by status;
* sum by currency;
* max by version;
* latest per ID;
* index by unique key;
* duplicate handling;
* memory risk of grouping huge streams;
* alternatives for large data.

---

## Part 033 — `toMap` and Duplicate Key Strategy

**Judul:** Designing Map Collection Correctly: Duplicate Keys, Merge Functions, and Ordering

Fokus:

* `Collectors.toMap`;
* duplicate key exception;
* merge functions;
* choose first/last;
* conflict detection;
* grouping instead of map;
* `LinkedHashMap` supplier;
* `TreeMap` supplier;
* stable deterministic output;
* domain duplicate policy.

---

## Part 034 — Stream Ordering and Encounter Order

**Judul:** Encounter Order, Sorted Order, Source Order, and Parallel Stream Ordering

Fokus:

* ordered vs unordered source;
* `forEach` vs `forEachOrdered`;
* `findFirst` vs `findAny`;
* `unordered`;
* `distinct`/`limit` cost on ordered streams;
* ordered collectors;
* Sequenced Collections relation;
* deterministic APIs.

---

## Part 035 — Laziness, Fusion, and Short-Circuiting

**Judul:** How Stream Pipelines Actually Execute

Fokus:

* lazy intermediate operations;
* vertical execution;
* pipeline fusion mental model;
* short-circuit terminal operations;
* infinite stream safety;
* `limit`;
* `takeWhile`;
* operation order optimization;
* debugging pipeline execution.

---

## Part 036 — Stream Side Effects

**Judul:** Side Effects, Interference, Statelessness, and Non-Interference

Fokus:

* non-interference contract;
* stateless lambdas;
* modifying source during stream;
* side effects in `map`/`filter`;
* `peek` misuse;
* shared mutable state;
* thread safety;
* production bugs;
* safe side effects at terminal boundaries.

---

## Part 037 — Parallel Streams Fundamentals

**Judul:** Parallel Streams: ForkJoin, Splitting, Ordering, and When Not to Use Them

Fokus:

* how parallel stream uses common pool;
* Spliterator splitting;
* CPU-bound vs IO-bound;
* shared common pool risks;
* ordering cost;
* data size threshold;
* associative reductions;
* blocking operations;
* production server caveats.

---

## Part 038 — Parallel Stream Correctness

**Judul:** Race Conditions, Broken Collectors, Non-Associative Reduce, and Determinism

Fokus:

* unsafe mutable accumulator;
* non-thread-safe collections;
* wrong combiner;
* floating-point nondeterminism;
* concurrent collectors;
* encounter order;
* debugging parallel bugs;
* deterministic vs nondeterministic results.

---

## Part 039 — Parallel Stream Performance

**Judul:** Measuring and Tuning Parallel Streams with JMH and JFR

Fokus:

* when parallel helps;
* splitting quality;
* source type impact;
* boxing cost;
* stateful operation cost;
* GC;
* common pool contention;
* JMH benchmark setup;
* JFR profiling;
* comparing loops vs streams vs parallel streams.

---

## Part 040 — Stream Resource Management

**Judul:** Streams over Files, IO, Database, Network, and Closeable Resources

Fokus:

* streams that need close;
* `Files.lines`;
* try-with-resources;
* lazy IO;
* leaking file handles;
* stream over JDBC;
* Spring Data streams;
* transaction lifetime;
* backpressure mismatch;
* do not return resource stream casually.

---

## Part 041 — Streams vs Loops

**Judul:** Readability, Performance, Debuggability, and Control Flow Trade-Offs

Fokus:

* when stream is clearer;
* when loop is clearer;
* early return;
* checked exceptions;
* index access;
* mutation;
* hot loops;
* debugging;
* allocation;
* team style;
* code review rules.

---

## Part 042 — Exception Handling in Streams

**Judul:** Checked Exceptions, Wrapping, Fail-Fast, Error Accumulation, and Result Streams

Fokus:

* lambdas and checked exceptions;
* wrapper functions;
* sneaky throws warning;
* fail-fast stream;
* collect errors;
* `Result<T,E>` in stream;
* validation pipelines;
* batch import patterns;
* partial success.

---

## Part 043 — Null Handling in Streams

**Judul:** Nulls, Optional, `mapMulti`, Filtering, and Safe Pipelines

Fokus:

* null element risks;
* `filter(Objects::nonNull)`;
* Optional stream;
* `flatMap(Optional::stream)`;
* null from map;
* `Stream.ofNullable`;
* `mapMulti`;
* designing null-free streams.

---

## Part 044 — `mapMulti` Deep Dive

**Judul:** `mapMulti` vs `flatMap`: Zero-or-Many Mapping with Lower Overhead

Fokus:

* why `mapMulti` exists;
* one-to-many transformation;
* avoiding temporary streams;
* examples:

  * optional emission;
  * tree flattening;
  * parsing;
  * validation errors;
* performance trade-off;
* readability.

---

## Part 045 — Custom Collectors

**Judul:** Designing Correct Custom Collectors for Production

Fokus:

* when custom collector is justified;
* accumulator type;
* combiner correctness;
* finisher;
* immutable result;
* parallel compatibility;
* characteristics;
* testing collector laws;
* examples:

  * non-empty list collector;
  * grouping with validation;
  * top-N collector;
  * error accumulating collector.

---

## Part 046 — Custom Spliterators

**Judul:** Designing Custom Spliterators for Lazy, Bounded, and Parallel-Friendly Sources

Fokus:

* custom traversal;
* batching source;
* line/token parser;
* database pagination source;
* `trySplit`;
* characteristics correctness;
* resource closing;
* infinite source;
* testing Spliterator.

---

## Part 047 — Domain Modeling with Collections

**Judul:** Collections as Domain Types: `PermissionSet`, `ViolationList`, `NonEmptyList`, `OrderedSteps`

Fokus:

* collection wrapper value objects;
* non-empty collection;
* unique collection;
* ordered workflow steps;
* permission sets;
* state transition table;
* immutable collection components;
* DB/API mapping;
* validation.

---

## Part 048 — Collection API Design

**Judul:** Designing Method Signatures with Collections

Fokus:

* accept `Collection` vs `List` vs `Set` vs `Iterable` vs `Stream`;
* return collection vs stream;
* ownership;
* mutability contract;
* null policy;
* empty collection policy;
* defensive copy;
* API evolution;
* public library design.

---

## Part 049 — Streams in API Design

**Judul:** Should Your Method Accept or Return Stream?

Fokus:

* stream single-use;
* resource lifetime;
* caller responsibility;
* transaction boundary;
* lazy evaluation surprises;
* returning stream from repository;
* `Iterable` vs `Stream`;
* callback/consumer alternatives;
* API design recommendations.

---

## Part 050 — Collections and Persistence

**Judul:** Mapping Collections to SQL/NoSQL: One-to-Many, ElementCollection, JSON, Array Columns

Fokus:

* collection in entity;
* one-to-many;
* many-to-many;
* element collection;
* order column;
* uniqueness;
* lazy loading;
* N+1;
* JSON array column;
* DB array column;
* batch fetching;
* direct entity collection exposure.

---

## Part 051 — Collections and API Contracts

**Judul:** Lists, Sets, Maps, Pagination, Sorting, Filtering, and JSON Schema Semantics

Fokus:

* JSON array vs List/Set;
* uniqueness;
* ordering;
* maxItems;
* map keys as strings;
* array-of-entry pattern;
* pagination response;
* cursor vs offset;
* sort field enum;
* filter DTOs;
* OpenAPI schema design.

---

## Part 052 — Collections and Security

**Judul:** Collection Size Limits, Injection via Sort/Filter, Mass Assignment, and Data Leakage

Fokus:

* unbounded collection input;
* large payload DoS;
* sort field injection;
* filter injection;
* permission set validation;
* tenant-scoped collections;
* overexposed collections in response;
* PII in collection logs;
* mutable security contexts.

---

## Part 053 — Collections and Concurrency

**Judul:** Shared Collections, Immutable Snapshots, Concurrent Mutations, and Safe Publication

Fokus:

* synchronized collections;
* concurrent collections;
* copy-on-write;
* immutable snapshot;
* volatile reference to collection;
* mutable values in concurrent map;
* iteration under mutation;
* lock granularity;
* read-mostly config;
* producer-consumer.

---

## Part 054 — Collections and Memory Leaks

**Judul:** Retained References, Static Maps, Caches, Listeners, ThreadLocals, and Weak References

Fokus:

* static collection leak;
* cache without eviction;
* listener list leak;
* ThreadLocal value leak;
* subList retention;
* map key retention;
* WeakHashMap misuse;
* memory leak diagnosis;
* heap dump patterns.

---

## Part 055 — Advanced Map Patterns

**Judul:** Indexes, Multimaps, BiMaps, Composite Keys, Nested Maps, and Lookup Tables

Fokus:

* index by ID;
* composite key record;
* multi-map with `Map<K,List<V>>`;
* nested map smell;
* bidirectional maps;
* lookup tables;
* transition matrix;
* permission matrix;
* duplicate handling;
* memory trade-offs.

---

## Part 056 — Advanced Aggregation Patterns

**Judul:** Top-N, Windowing, Bucketing, Histograms, and Streaming Aggregations

Fokus:

* top-N with priority queue;
* bucketing by time/range;
* histograms;
* rolling aggregation;
* incremental aggregation;
* memory-bounded aggregation;
* approximate aggregation;
* collector vs loop;
* batch vs stream processing.

---

## Part 057 — Functional Patterns with Streams

**Judul:** Map/Filter/Reduce, Monads-ish Patterns, Optional Stream, Result Stream, and Composition

Fokus:

* functional transformation;
* pure functions;
* referential transparency;
* composition;
* Optional stream;
* Result in stream;
* validation accumulation;
* avoiding side effects;
* where Java streams are not functional enough.

---

## Part 058 — Debugging Streams and Collections

**Judul:** Debuggability, Observability, Logging, `peek`, Breakpoints, and Testability

Fokus:

* debugging pipelines;
* `peek` safe use;
* named methods vs inline lambdas;
* logging sizes safely;
* sampling collection contents;
* assertions;
* property-based tests;
* reproducible ordering;
* failure diagnostics.

---

## Part 059 — Testing Collections and Streams

**Judul:** Unit, Property-Based, Concurrency, Performance, and Contract Tests

Fokus:

* collection invariant tests;
* equality/hash tests;
* collector law tests;
* stream pipeline tests;
* order-sensitive tests;
* parallel stream tests;
* mutation/aliasing tests;
* DB/API serialization tests;
* JMH performance tests.

---

## Part 060 — Production Failure Case Studies

**Judul:** Realistic Incidents Caused by Collections and Streams

Fokus:

* mutable key in HashMap;
* duplicate key in `toMap`;
* null in stream;
* entity lazy collection serialization;
* unbounded queue OOM;
* parallel stream common pool starvation;
* file stream leak;
* `ConcurrentHashMap` mutable values;
* `subList` memory retention;
* enum ordinal in EnumMap assumption;
* map cache missing tenant key.

---

## Part 061 — Collections and Streams Design Review Checklist

**Judul:** Review Checklist for Production-Grade Collection and Stream Usage

Fokus:

* type semantics;
* mutability;
* nullability;
* ordering;
* uniqueness;
* concurrency;
* memory;
* performance;
* API/DB/event/cache boundary;
* stream correctness;
* collector correctness;
* security;
* testing.

---

## Part 062 — Capstone: Case Workflow Query and Aggregation Engine

**Judul:** Capstone: Build a Type-Safe Case Workflow Collection/Stream Processing Engine

Fokus:

* domain collections:

  * `ViolationList`;
  * `AttachmentSet`;
  * `PermissionSet`;
  * `CaseEventHistory`;
* event stream processing;
* grouping by status/officer/tenant;
* latest event per case;
* SLA bucketing;
* safe collectors;
* bounded memory;
* API response pagination;
* DB projection;
* concurrency-safe cache;
* review checklist.
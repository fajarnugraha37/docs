# learn-java-collections-and-streams-part-024.md

# Java Collections and Streams — Part 024  
# Stream Mental Model: Lazy Pipeline, Source, Intermediate Operations, Terminal Operations, Encounter Order, One-Shot Traversal, Non-Interference, Statelessness, and Production Thinking

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **024**  
> Fokus: membangun mental model `Stream` sebagai **lazy computation pipeline**, bukan sebagai collection. Kita akan membedah source, intermediate operation, terminal operation, laziness, fusion, short-circuiting, encounter order, one-shot traversal, side effects, non-interference, statelessness, resource management, dan kapan stream membuat code lebih baik atau lebih buruk.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model Utama: Stream Bukan Collection](#2-mental-model-utama-stream-bukan-collection)
3. [Collection vs Stream](#3-collection-vs-stream)
4. [Stream sebagai Pipeline](#4-stream-sebagai-pipeline)
5. [Source](#5-source)
6. [Intermediate Operations](#6-intermediate-operations)
7. [Terminal Operations](#7-terminal-operations)
8. [Laziness](#8-laziness)
9. [Pipeline Fusion](#9-pipeline-fusion)
10. [Short-Circuiting](#10-short-circuiting)
11. [One-Shot Traversal](#11-one-shot-traversal)
12. [Encounter Order](#12-encounter-order)
13. [Ordered vs Unordered Streams](#13-ordered-vs-unordered-streams)
14. [Sequential vs Parallel Streams](#14-sequential-vs-parallel-streams)
15. [Object Streams vs Primitive Streams](#15-object-streams-vs-primitive-streams)
16. [Non-Interference](#16-non-interference)
17. [Statelessness](#17-statelessness)
18. [Side Effects](#18-side-effects)
19. [Stateful Intermediate Operations](#19-stateful-intermediate-operations)
20. [Reduction Mental Model](#20-reduction-mental-model)
21. [Collectors Mental Model](#21-collectors-mental-model)
22. [Streams and Null](#22-streams-and-null)
23. [Streams and Exceptions](#23-streams-and-exceptions)
24. [Streams and Resource Management](#24-streams-and-resource-management)
25. [Infinite Streams](#25-infinite-streams)
26. [Debugging Stream Pipelines](#26-debugging-stream-pipelines)
27. [Stream API Design](#27-stream-api-design)
28. [Streams vs Loops](#28-streams-vs-loops)
29. [Performance Mental Model](#29-performance-mental-model)
30. [Common Misconceptions](#30-common-misconceptions)
31. [Production Failure Modes](#31-production-failure-modes)
32. [Best Practices](#32-best-practices)
33. [Decision Matrix](#33-decision-matrix)
34. [Latihan](#34-latihan)
35. [Ringkasan](#35-ringkasan)
36. [Referensi](#36-referensi)

---

# 1. Tujuan Bagian Ini

Kita sudah banyak membahas collections sebagai struktur penyimpanan:

```java
List
Set
Map
Queue
Deque
HashMap
ArrayList
TreeMap
ConcurrentHashMap
```

Sekarang kita masuk ke dunia `Stream`.

Banyak developer salah memahami stream sebagai:

```text
list yang punya method functional
```

Padahal `Stream` bukan collection.

`Stream` adalah:

```text
lazy sequence of elements supporting aggregate computation pipeline
```

Contoh:

```java
List<String> result = users.stream()
    .filter(User::active)
    .map(User::email)
    .distinct()
    .sorted()
    .toList();
```

Yang penting bukan hanya syntax.

Yang penting adalah mental model:

```text
source -> lazy intermediate operations -> terminal operation
```

Tujuan part ini:

- membedakan collection vs stream;
- memahami lazy pipeline;
- memahami source/intermediate/terminal;
- memahami one-shot traversal;
- memahami encounter order;
- memahami non-interference/statelessness;
- memahami side effects;
- memahami kapan stream tepat/tidak;
- membangun fondasi untuk part berikutnya: stream sources, intermediate ops, terminal ops, primitive streams, reduction, collectors, parallel streams.

---

# 2. Mental Model Utama: Stream Bukan Collection

Collection menyimpan data.

Stream memproses data.

## 2.1 Collection

```java
List<User> users = repository.findUsers();
```

Collection punya:

- storage;
- size;
- mutability;
- membership;
- iteration;
- ownership;
- identity.

## 2.2 Stream

```java
Stream<User> stream = users.stream();
```

Stream punya:

- source;
- pipeline;
- traversal logic;
- lazy operations;
- terminal trigger;
- one-shot consumption.

## 2.3 Analogy

Collection seperti gudang barang.

Stream seperti conveyor belt yang memproses barang dari gudang menuju hasil akhir.

## 2.4 Key difference

Collection can be reused.

Stream usually cannot.

```java
Stream<User> s = users.stream();
s.count();
s.count(); // IllegalStateException
```

## 2.5 Rule

```text
A collection is data.
A stream is a computation over data.
```

---

# 3. Collection vs Stream

| Aspect | Collection | Stream |
|---|---|---|
| primary role | store data | process data |
| reuse | reusable | one-shot |
| mutability | may be mutable | pipeline immutable-ish |
| size | often known | may be unknown/infinite |
| traversal | external/internal | internal |
| operations | add/remove/get | map/filter/reduce |
| evaluation | eager storage | lazy until terminal |
| ownership | owns elements/references | does not own source |
| result | collection itself | terminal result |
| side effects | mutation common | discouraged in pipeline |

## 3.1 Collection example

```java
List<Integer> numbers = new ArrayList<>();
numbers.add(1);
numbers.add(2);
```

## 3.2 Stream example

```java
int sum = numbers.stream()
    .mapToInt(Integer::intValue)
    .sum();
```

## 3.3 Rule

Do not use stream when you need a reusable container.

---

# 4. Stream sebagai Pipeline

Stream pipeline terdiri dari tiga bagian:

```text
source
  -> intermediate operation(s)
  -> terminal operation
```

Example:

```java
long count = users.stream()       // source
    .filter(User::active)         // intermediate
    .map(User::email)             // intermediate
    .distinct()                   // intermediate
    .count();                     // terminal
```

## 4.1 Source

Where elements come from.

## 4.2 Intermediate operations

Transform/filter pipeline and return another stream.

## 4.3 Terminal operation

Triggers processing and produces result/side-effect.

## 4.4 Pipeline is declarative

You describe what processing should happen.

Terminal operation causes it to happen.

## 4.5 Rule

Without terminal operation, nothing meaningful is processed.

---

# 5. Source

Common stream sources:

## 5.1 Collection

```java
list.stream()
set.stream()
map.entrySet().stream()
```

## 5.2 Array

```java
Arrays.stream(array)
Stream.of(values)
```

## 5.3 Range

```java
IntStream.range(0, n)
LongStream.rangeClosed(1, n)
```

## 5.4 Generated/iterated

```java
Stream.generate(...)
Stream.iterate(...)
```

## 5.5 IO/resource

```java
Files.lines(path)
```

## 5.6 Custom Spliterator

```java
StreamSupport.stream(spliterator, false)
```

## 5.7 Rule

Source characteristics strongly affect stream behavior and performance.

---

# 6. Intermediate Operations

Intermediate operations return another stream.

Examples:

```java
filter
map
flatMap
distinct
sorted
peek
limit
skip
takeWhile
dropWhile
mapMulti
```

## 6.1 Lazy

Intermediate operations are lazy.

They build pipeline stages.

## 6.2 Stateless vs stateful

Stateless:

```java
filter
map
flatMap
```

Stateful:

```java
distinct
sorted
limit
skip
takeWhile
dropWhile
```

depending context/order.

## 6.3 Operation composition

```java
stream.filter(...).map(...).limit(...)
```

Each stage composes into one pipeline.

## 6.4 Rule

Intermediate operations describe transformations; terminal operations execute them.

---

# 7. Terminal Operations

Terminal operations trigger pipeline execution.

Examples:

```java
forEach
toList
collect
reduce
count
min
max
findFirst
findAny
anyMatch
allMatch
noneMatch
sum
average
```

## 7.1 Result-producing

```java
List<String> emails = users.stream()
    .map(User::email)
    .toList();
```

## 7.2 Side-effect-producing

```java
users.stream()
    .forEach(System.out::println);
```

## 7.3 Short-circuit terminal

```java
anyMatch
findFirst
findAny
noneMatch
allMatch
```

can stop early.

## 7.4 Rule

A stream pipeline has at most one terminal operation.

---

# 8. Laziness

Streams are lazy.

This means computation begins only when terminal operation starts.

## 8.1 Example

```java
Stream<String> s = names.stream()
    .filter(name -> {
        System.out.println("filter " + name);
        return name.length() > 3;
    });

System.out.println("before terminal");

long count = s.count();
```

Nothing prints from filter before `count()`.

## 8.2 Why laziness matters

Allows:

- fusion;
- short-circuiting;
- processing only needed elements;
- infinite streams with limiting;
- avoiding unnecessary intermediate collections.

## 8.3 Rule

Intermediate operations are recipes, not execution.

---

# 9. Pipeline Fusion

Stream pipeline often processes element through multiple stages before moving to next element.

Conceptual:

```java
names.stream()
    .filter(...)
    .map(...)
    .limit(5)
    .toList();
```

does not necessarily create a list after filter then another after map.

It can process:

```text
element 1 -> filter -> map -> maybe collect
element 2 -> filter -> map -> maybe collect
...
```

## 9.1 Benefit

Avoids many intermediate collections.

## 9.2 Caveat

Stateful operations like `sorted` may need to buffer.

## 9.3 Rule

Streams are pipelines, not chains of eagerly materialized collections.

---

# 10. Short-Circuiting

Short-circuiting operations can stop early.

## 10.1 anyMatch

```java
boolean exists = users.stream()
    .anyMatch(User::active);
```

Stops when active user found.

## 10.2 findFirst

```java
Optional<User> first = users.stream()
    .filter(User::active)
    .findFirst();
```

Stops after first match in encounter order.

## 10.3 limit

```java
stream.limit(10)
```

Can bound processing.

## 10.4 Infinite stream

```java
Stream.iterate(0, n -> n + 1)
    .limit(10)
    .toList();
```

Works because limit short-circuits.

## 10.5 Rule

Short-circuiting is one of the biggest benefits of lazy streams.

---

# 11. One-Shot Traversal

A stream should be operated on only once.

## 11.1 Bad

```java
Stream<User> active = users.stream().filter(User::active);

long count = active.count();
List<User> list = active.toList(); // IllegalStateException
```

## 11.2 Why

A stream represents a traversal/computation, not reusable storage.

## 11.3 Better

Create new stream each time:

```java
long count = users.stream().filter(User::active).count();
List<User> list = users.stream().filter(User::active).toList();
```

or collect once:

```java
List<User> activeUsers = users.stream()
    .filter(User::active)
    .toList();
```

## 11.4 Rule

Never store Stream as reusable field/value.

---

# 12. Encounter Order

Encounter order is the order in which source presents elements to stream.

## 12.1 Ordered source

```java
List
LinkedHashSet
TreeSet
```

have defined encounter order.

## 12.2 Unordered source

```java
HashSet
HashMap.keySet()
```

do not guarantee meaningful encounter order.

## 12.3 Why important

Operations like:

```java
findFirst
limit
skip
forEachOrdered
```

depend on encounter order.

## 12.4 Rule

If order matters, know your source encounter order.

---

# 13. Ordered vs Unordered Streams

## 13.1 Ordered

Order constraints are preserved.

## 13.2 Unordered

May allow more optimization, especially parallel.

```java
stream.unordered()
```

declares order no longer matters.

## 13.3 Example

If you only need any matching element:

```java
set.parallelStream()
   .unordered()
   .filter(...)
   .findAny();
```

## 13.4 Rule

Do not pay for order when order does not matter.

---

# 14. Sequential vs Parallel Streams

Streams can be sequential or parallel.

```java
list.stream()
list.parallelStream()
```

## 14.1 Sequential

Single-threaded pipeline traversal.

## 14.2 Parallel

Uses splitting and fork/join style processing.

## 14.3 Not automatically faster

Parallel needs:

- splittable source;
- enough per-element work;
- stateless/non-interfering operations;
- associative reductions;
- low contention;
- no blocking common pool problems.

## 14.4 Rule

Parallel stream is performance optimization, not default style.

---

# 15. Object Streams vs Primitive Streams

Object stream:

```java
Stream<Integer>
```

may involve boxing/unboxing.

Primitive streams:

```java
IntStream
LongStream
DoubleStream
```

avoid boxing for primitive values.

## 15.1 Example

```java
int sum = numbers.stream()
    .mapToInt(Integer::intValue)
    .sum();
```

## 15.2 Use primitive streams for numeric aggregation

```java
mapToInt
mapToLong
mapToDouble
```

## 15.3 Rule

For numeric streams, prefer primitive streams.

---

# 16. Non-Interference

Stream operations should not interfere with source.

## 16.1 Bad

```java
List<String> names = new ArrayList<>(List.of("A", "B", "C"));

names.stream()
    .filter(name -> {
        names.remove(name);
        return true;
    })
    .toList();
```

This mutates source during stream processing.

## 16.2 Why bad

Can cause:

- ConcurrentModificationException;
- incorrect results;
- unpredictable behavior.

## 16.3 Good

Create result:

```java
List<String> filtered = names.stream()
    .filter(name -> !name.equals("B"))
    .toList();
```

## 16.4 Rule

Do not mutate the stream source during pipeline execution.

---

# 17. Statelessness

Behavioral parameters should usually be stateless.

## 17.1 Bad

```java
List<String> seen = new ArrayList<>();

stream.filter(x -> {
    if (seen.contains(x)) return false;
    seen.add(x);
    return true;
})
```

This keeps mutable external state.

## 17.2 Why bad

- unsafe in parallel;
- order-dependent;
- hard to reason;
- may be race-prone.

## 17.3 Better

Use stream operation designed for it:

```java
stream.distinct()
```

or collect with appropriate collector.

## 17.4 Rule

Lambdas in stream pipelines should be stateless unless you deeply understand consequences.

---

# 18. Side Effects

Side effects are not forbidden, but dangerous.

## 18.1 Bad collection mutation

```java
List<Result> results = new ArrayList<>();

users.parallelStream()
    .map(this::process)
    .forEach(results::add);
```

Race.

## 18.2 Better

```java
List<Result> results = users.parallelStream()
    .map(this::process)
    .toList();
```

## 18.3 Logging/debugging

`peek` can help debug but should not become business side-effect stage.

## 18.4 External IO

Stream with IO side effects may be harder to control, especially parallel.

## 18.5 Rule

Prefer terminal collection/reduction over external mutable side effects.

---

# 19. Stateful Intermediate Operations

Some intermediate operations need memory/state.

## 19.1 distinct

Must remember seen elements.

## 19.2 sorted

Must buffer and sort elements before downstream.

## 19.3 limit/skip

Can be cheap sequential but expensive parallel ordered.

## 19.4 takeWhile/dropWhile

Order-sensitive.

## 19.5 Rule

Stateful operations can break simple per-element streaming mental model.

---

# 20. Reduction Mental Model

Reduction combines many elements into one result.

Examples:

```java
sum
count
min
max
reduce
collect
```

## 20.1 Associativity

For parallel reduction, operation should be associative.

Good:

```java
(a + b) + c == a + (b + c)
```

For integers, mostly yes except overflow semantics still deterministic in Java arithmetic but domain must accept.

Bad:

```java
a - b
```

not associative.

## 20.2 Identity

Identity value should not change result.

```java
0 for sum
1 for multiplication
```

## 20.3 Rule

Reduction correctness depends on identity and associativity.

---

# 21. Collectors Mental Model

Collector is mutable reduction strategy.

Conceptual parts:

```text
supplier
accumulator
combiner
finisher
characteristics
```

Example:

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(User::role));
```

## 21.1 Collector creates result container

Unlike map/filter, collect materializes output.

## 21.2 Parallel collectors need combiner

Partial results merged.

## 21.3 Rule

Collectors are how streams build collections/maps/aggregations safely.

---

# 22. Streams and Null

Streams can contain null unless source/operation prevents it.

## 22.1 Example

```java
Stream.of("A", null, "B")
```

## 22.2 Danger

```java
.map(String::length)
```

fails on null.

## 22.3 Filter null intentionally

```java
.filter(Objects::nonNull)
```

## 22.4 Stream.ofNullable

```java
Stream.ofNullable(possiblyNull)
```

Produces empty stream if null, single element if non-null.

## 22.5 Rule

Keep streams null-free unless null is explicitly part of data model.

---

# 23. Streams and Exceptions

Checked exceptions do not fit cleanly in standard functional interfaces.

## 23.1 Problem

```java
files.stream()
    .map(Files::readString) // checked IOException
```

does not compile directly.

## 23.2 Options

- handle inside lambda;
- wrap in unchecked exception;
- use loop;
- design throwing helper;
- perform IO outside stream.

## 23.3 Rule

If exception handling becomes complex, a loop may be clearer.

---

# 24. Streams and Resource Management

Some streams need closing.

Example:

```java
try (Stream<String> lines = Files.lines(path)) {
    long count = lines.count();
}
```

## 24.1 Collection streams usually do not need closing

```java
list.stream()
```

No resource close needed.

## 24.2 IO-backed streams need closing

Files, directories, etc.

## 24.3 Rule

Close streams whose source owns external resources.

---

# 25. Infinite Streams

Streams may be infinite.

## 25.1 generate

```java
Stream.generate(UUID::randomUUID)
```

## 25.2 iterate

```java
Stream.iterate(0, n -> n + 1)
```

## 25.3 Need bound

```java
.limit(100)
```

or short-circuit terminal.

## 25.4 Bad

```java
Stream.generate(...)
    .toList(); // infinite, never completes / OOM
```

## 25.5 Rule

Infinite streams require short-circuiting or limits.

---

# 26. Debugging Stream Pipelines

## 26.1 Use small samples

Break complex pipeline into named steps if needed.

## 26.2 `peek`

```java
stream.peek(x -> log.debug("x={}", x))
```

Use for debugging, not business logic.

## 26.3 Collect intermediate only when helpful

```java
List<User> active = users.stream()
    .filter(User::active)
    .toList();
```

## 26.4 Rule

Readable stream is better than clever stream.

---

# 27. Stream API Design

## 27.1 Do not usually return Stream from domain object

Bad if caller must manage one-shot/resource.

## 27.2 Accept Collection/Iterable when needing reusable input

```java
void process(Collection<User> users)
```

## 27.3 Return List/Set for materialized results

```java
List<User> findUsers()
```

## 27.4 Return Stream only if

- lazy traversal is essential;
- resource lifetime documented;
- caller expected to consume once;
- API is low-level.

## 27.5 Rule

Streams are great inside methods; be cautious in public APIs.

---

# 28. Streams vs Loops

## 28.1 Streams shine for

- map/filter/reduce;
- declarative transformations;
- grouping/aggregation;
- short pipelines;
- immutable result creation.

## 28.2 Loops shine for

- complex branching;
- checked exceptions;
- early multiple exits;
- mutation-heavy algorithms;
- debugging step-by-step;
- performance-critical tight loops.

## 28.3 Rule

Choose clarity and correctness over style.

---

# 29. Performance Mental Model

Stream cost depends on:

- source spliterator;
- pipeline length;
- boxing;
- allocation;
- stateful operations;
- terminal operation;
- sequential vs parallel;
- lambda inlining;
- collector behavior.

## 29.1 Stream may avoid intermediate collections

Good.

## 29.2 Stream may allocate pipeline objects

Usually small but not zero.

## 29.3 Primitive streams avoid boxing

Important for numeric hot paths.

## 29.4 Rule

Do not assume stream is slower/faster. Measure hot paths.

---

# 30. Common Misconceptions

## 30.1 “Stream stores data”

No. It processes data from source.

## 30.2 “Intermediate operation runs immediately”

No. It is lazy.

## 30.3 “Stream can be reused”

No. Usually one-shot.

## 30.4 “parallelStream is faster”

Not automatically.

## 30.5 “peek is for business side effects”

No. Mostly debugging/inspection.

## 30.6 “Stream makes code always cleaner”

Not always.

## 30.7 Rule

Stream is a computation abstraction, not a universal replacement for loops.

---

# 31. Production Failure Modes

## 31.1 Missing terminal operation

Pipeline never runs.

## 31.2 Reusing stream

`IllegalStateException`.

## 31.3 Mutating source during stream

CME or wrong results.

## 31.4 External mutable side effects in parallel

Race.

## 31.5 Stateful lambda

Wrong results under parallel/order changes.

## 31.6 Infinite stream without limit

Hang/OOM.

## 31.7 IO stream not closed

Resource leak.

## 31.8 Null element NPE

Mapper/comparator fails.

## 31.9 Assuming HashSet stream order

Nondeterministic output.

## 31.10 sorted before findFirst

Unnecessary expensive operation if min/max would work.

## 31.11 parallel blocking IO

Common pool starvation.

## 31.12 Collector duplicate key

`toMap` failure if duplicate key.

---

# 32. Best Practices

## 32.1 Pipeline

- Keep pipelines short and readable.
- Prefer method references when clear.
- Name complex predicates/functions.
- Avoid business side effects in intermediate stages.

## 32.2 Source

- Know encounter order.
- Snapshot mutable/concurrent source if deterministic result needed.
- Close resource-backed streams.

## 32.3 Operations

- Use primitive streams for numeric aggregation.
- Use short-circuit operations.
- Avoid redundant stateful operations.
- Prefer collector/reduction over external mutation.

## 32.4 Parallel

- Use only after measuring.
- Ensure stateless/non-interfering functions.
- Avoid blocking tasks.

## 32.5 API

- Prefer returning collections over streams unless laziness/resource semantics are intentional.

---

# 33. Decision Matrix

| Need | Recommended |
|---|---|
| transform/filter collection to result | stream |
| simple mutation loop | loop |
| complex branching | loop |
| numeric aggregation | primitive stream |
| grouping/aggregation | collectors |
| first matching element | `filter(...).findFirst()` |
| any matching element | `anyMatch` |
| all match predicate | `allMatch` |
| no element matches | `noneMatch` |
| build list | `toList()` / collector |
| build map with duplicate handling | `toMap` with merge |
| avoid boxing | `IntStream`/`LongStream`/`DoubleStream` |
| deterministic result from concurrent source | snapshot first |
| resource-backed stream | try-with-resources |
| infinite stream | add `limit`/short-circuit |
| public reusable result | return collection |
| lazy one-shot advanced API | return Stream with docs |
| performance critical hot loop | benchmark stream vs loop |
| parallel CPU-heavy independent work | maybe parallel stream, measure |
| blocking IO per element | usually not parallel stream |

---

# 34. Latihan

## Latihan 1 — Laziness

Create stream with `filter` printing log.

Show that logs appear only after terminal operation.

## Latihan 2 — One-Shot

Reuse a stream after `count`.

Explain exception.

## Latihan 3 — Encounter Order

Compare stream output from:

```java
ArrayList
LinkedHashSet
HashSet
TreeSet
```

## Latihan 4 — Short-Circuit

Use `anyMatch` and show it stops early.

## Latihan 5 — Non-Interference

Mutate source inside stream and explain failure.

## Latihan 6 — External Mutation Race

Use parallel stream adding to ArrayList.

Fix with `toList`.

## Latihan 7 — Primitive Stream

Sum integers using `Stream<Integer>` and `IntStream`.

Compare boxing implications.

## Latihan 8 — Resource Stream

Use `Files.lines` with try-with-resources.

## Latihan 9 — Infinite Stream

Generate infinite stream and safely limit it.

## Latihan 10 — Loop vs Stream

Take a complex validation algorithm and decide whether stream or loop is clearer.

---

# 35. Ringkasan

Stream adalah abstraction untuk lazy aggregate computation.

Core lessons:

- Stream bukan collection.
- Collection stores; stream computes.
- Pipeline = source + intermediate ops + terminal op.
- Intermediate operations are lazy.
- Terminal operation triggers execution.
- Streams are usually one-shot.
- Encounter order comes from source.
- Ordered streams can impose cost.
- Short-circuiting can avoid unnecessary work.
- Do not mutate stream source during traversal.
- Stream lambdas should be stateless and non-interfering.
- Side effects are dangerous, especially in parallel.
- Stateful operations like sorted/distinct may buffer.
- Primitive streams avoid boxing.
- Resource-backed streams must be closed.
- Infinite streams need limit/short-circuit.
- Parallel streams are not automatically faster.
- Use stream when it improves clarity and correctness.

Main rule:

```text
A stream is a lazy, one-shot computation pipeline over a source.
Use it to express data transformation, not to hide complex mutable control flow.
```

---

# 36. Referensi

1. Java SE 25 — `java.util.stream` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

2. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

3. Java SE 25 — `BaseStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/BaseStream.html

4. Java SE 25 — `IntStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.html

5. Java SE 25 — `LongStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/LongStream.html

6. Java SE 25 — `DoubleStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/DoubleStream.html

7. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

8. Java SE 25 — `StreamSupport`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/StreamSupport.html

9. Java SE 25 — `Files.lines`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html#lines(java.nio.file.Path)

10. dev.java — The Stream API  
    https://dev.java/learn/api/streams/

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-023.md](./learn-java-collections-and-streams-part-023.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-025.md](./learn-java-collections-and-streams-part-025.md)

</div>
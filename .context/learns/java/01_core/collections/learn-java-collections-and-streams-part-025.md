# learn-java-collections-and-streams-part-025.md

# Java Collections and Streams — Part 025  
# Stream Sources: Collections, Arrays, Ranges, Builders, Generate, Iterate, Files, Regex, Random, Scanner, Custom Spliterators, Resource Sources, and Source Characteristics

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **025**  
> Fokus: memahami dari mana `Stream` berasal. Source bukan detail kecil: source menentukan **encounter order, laziness, size knowledge, splitting quality, resource lifetime, parallelism behavior, null possibility, and production risk**.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Source adalah Asal Data dan Karakter Pipeline](#2-mental-model-source-adalah-asal-data-dan-karakter-pipeline)
3. [Source Characteristics](#3-source-characteristics)
4. [Collection Sources](#4-collection-sources)
5. [List Source](#5-list-source)
6. [Set Source](#6-set-source)
7. [Map Source](#7-map-source)
8. [Array Sources](#8-array-sources)
9. [`Stream.of`](#9-streamof)
10. [`Stream.empty`](#10-streamempty)
11. [`Stream.builder`](#11-streambuilder)
12. [Primitive Range Sources](#12-primitive-range-sources)
13. [`Stream.generate`](#13-streamgenerate)
14. [`Stream.iterate`](#14-streamiterate)
15. [Finite `iterate` with Predicate](#15-finite-iterate-with-predicate)
16. [`Stream.ofNullable`](#16-streamofnullable)
17. [File and IO Sources](#17-file-and-io-sources)
18. [`Files.lines`](#18-fileslines)
19. [`Files.list`, `Files.walk`, `Files.find`](#19-fileslist-fileswalk-filesfind)
20. [Regex Sources](#20-regex-sources)
21. [Random Sources](#21-random-sources)
22. [Scanner and Token Sources](#22-scanner-and-token-sources)
23. [BufferedReader Lines](#23-bufferedreader-lines)
24. [Jar/Zip/Directory-Like Sources](#24-jarzipdirectory-like-sources)
25. [Custom Sources with Spliterator](#25-custom-sources-with-spliterator)
26. [StreamSupport](#26-streamsupport)
27. [Late Binding vs Early Binding Sources](#27-late-binding-vs-early-binding-sources)
28. [Finite vs Infinite Sources](#28-finite-vs-infinite-sources)
29. [Sized vs Unsized Sources](#29-sized-vs-unsized-sources)
30. [Ordered vs Unordered Sources](#30-ordered-vs-unordered-sources)
31. [Resource Ownership](#31-resource-ownership)
32. [Mutation of Source During Stream](#32-mutation-of-source-during-stream)
33. [Concurrent Sources](#33-concurrent-sources)
34. [Parallel Stream Source Quality](#34-parallel-stream-source-quality)
35. [Nulls from Source](#35-nulls-from-source)
36. [API Design: Should You Accept/Return Stream Sources?](#36-api-design-should-you-acceptreturn-stream-sources)
37. [Production Failure Modes](#37-production-failure-modes)
38. [Best Practices](#38-best-practices)
39. [Decision Matrix](#39-decision-matrix)
40. [Latihan](#40-latihan)
41. [Ringkasan](#41-ringkasan)
42. [Referensi](#42-referensi)

---

# 1. Tujuan Bagian Ini

Di part sebelumnya kita membangun mental model:

```text
Stream = lazy, one-shot computation pipeline
```

Sekarang pertanyaan berikutnya:

```text
Pipeline itu mendapat element dari mana?
```

Jawabannya: dari **source**.

Source bisa berupa:

```java
collection.stream()
Arrays.stream(array)
Stream.of(...)
IntStream.range(...)
Stream.generate(...)
Stream.iterate(...)
Files.lines(path)
Pattern.splitAsStream(input)
random.ints()
StreamSupport.stream(spliterator, false)
```

Source bukan sekadar “cara membuat stream”.

Source menentukan:

- apakah stream ordered;
- apakah size diketahui;
- apakah bisa parallel dengan baik;
- apakah perlu ditutup;
- apakah infinite;
- apakah source bisa berubah;
- apakah null mungkin muncul;
- apakah traversal mahal;
- apakah source late-binding;
- apakah source aman untuk concurrent mutation.

Tujuan bagian ini:

- memahami macam-macam source;
- memahami karakter tiap source;
- memahami resource-backed streams;
- memahami infinite source;
- memahami custom source via Spliterator;
- memilih source yang tepat untuk production code.

---

# 2. Mental Model: Source adalah Asal Data dan Karakter Pipeline

Stream pipeline selalu dimulai dari source.

```text
source -> intermediate operations -> terminal operation
```

Contoh:

```java
List<User> users = ...
List<String> emails = users.stream()
    .filter(User::active)
    .map(User::email)
    .toList();
```

Source:

```java
users.stream()
```

## 2.1 Source determines encounter order

List stream preserves list order.

HashSet stream has no meaningful order guarantee.

TreeSet stream follows sorted order.

## 2.2 Source determines size knowledge

ArrayList source knows size.

`Stream.generate` does not.

## 2.3 Source determines resource lifetime

`Files.lines(path)` opens file resource.

`List.stream()` does not.

## 2.4 Source determines parallel splitting quality

Array/range/list split well.

IO/generate/linked structures may split poorly.

## 2.5 Main rule

```text
A stream pipeline inherits many properties from its source.
```

---

# 3. Source Characteristics

When evaluating a source, ask:

## 3.1 Finite or infinite?

Will traversal end naturally?

## 3.2 Sized or unsized?

Can stream know number of elements?

## 3.3 Ordered or unordered?

Is encounter order meaningful?

## 3.4 Distinct?

Does source guarantee unique elements?

## 3.5 Sorted?

Is source already sorted?

## 3.6 Non-null?

Can source produce null?

## 3.7 Immutable/concurrent?

Can source change during traversal?

## 3.8 Resource-backed?

Must stream be closed?

## 3.9 Splittable?

Can source split efficiently for parallel stream?

## 3.10 Rule

Good stream design starts by understanding source characteristics.

---

# 4. Collection Sources

Every `Collection` has:

```java
stream()
parallelStream()
```

Example:

```java
Collection<User> users = ...
Stream<User> stream = users.stream();
```

## 4.1 Collection spliterator

Collection streams use the collection's spliterator.

## 4.2 Encounter order depends on collection

- `ArrayList`: list index order.
- `LinkedHashSet`: insertion order.
- `TreeSet`: sorted order.
- `HashSet`: unspecified order.

## 4.3 Mutability issue

Do not structurally mutate non-concurrent source during stream traversal.

## 4.4 Rule

Collection streams are most common, but collection type matters.

---

# 5. List Source

List streams are ordered.

```java
List<String> names = List.of("A", "B", "C");
names.stream()
```

## 5.1 ArrayList

Good source:

- ordered;
- sized;
- good locality;
- good splitting.

## 5.2 LinkedList

Ordered but poorer splitting/locality.

Parallel stream often less attractive.

## 5.3 CopyOnWriteArrayList

Snapshot-like structural behavior.

Good for stable concurrent traversal.

## 5.4 Rule

`ArrayList` is one of the best general-purpose collection stream sources.

---

# 6. Set Source

Set source characteristics differ.

## 6.1 HashSet

Unordered.

```java
hashSet.stream()
```

Do not rely on output order.

## 6.2 LinkedHashSet

Ordered by insertion encounter order.

## 6.3 TreeSet

Sorted encounter order.

## 6.4 EnumSet

Enum declaration order.

## 6.5 Rule

A Set stream may be ordered or unordered depending implementation.

---

# 7. Map Source

Map itself does not stream directly as key-value sequence.

Use views:

```java
map.entrySet().stream()
map.keySet().stream()
map.values().stream()
```

## 7.1 Entry stream

Best when key and value both needed:

```java
map.entrySet().stream()
    .filter(e -> e.getValue().active())
    .map(Map.Entry::getKey)
```

## 7.2 Key stream

Use when only keys needed.

## 7.3 Value stream

Use when only values needed.

## 7.4 Ordering

Depends on map:

- `HashMap`: unspecified.
- `LinkedHashMap`: insertion/access order.
- `TreeMap`: sorted by key.
- `ConcurrentHashMap`: weakly consistent, unordered-ish from deterministic contract perspective.

## 7.5 Rule

For maps, choose the correct view as source.

---

# 8. Array Sources

Arrays can become streams.

## 8.1 Object array

```java
String[] names = {"A", "B"};
Stream<String> s = Arrays.stream(names);
```

## 8.2 Primitive arrays

```java
int[] xs = {1, 2, 3};
IntStream s = Arrays.stream(xs);
```

## 8.3 Range slice

```java
Arrays.stream(array, fromInclusive, toExclusive)
```

## 8.4 Characteristics

Arrays are:

- ordered;
- sized;
- good splitting;
- good for parallel if work large enough.

## 8.5 Rule

Arrays are excellent stream sources, especially primitive arrays.

---

# 9. `Stream.of`

`Stream.of` creates stream from explicit values.

```java
Stream.of("A", "B", "C")
```

## 9.1 Object values

Good for small fixed source.

## 9.2 Beware array overload

```java
Stream.of(array)
```

If `array` is `String[]`, this produces stream of String elements due varargs.

But for primitive array:

```java
Stream.of(intArray)
```

produces `Stream<int[]>`, not `IntStream`.

Use:

```java
Arrays.stream(intArray)
```

## 9.3 Null

```java
Stream.of((String) null)
```

produces stream containing null.

## 9.4 Rule

Use `Stream.of` for small object values; use `Arrays.stream` for primitive arrays.

---

# 10. `Stream.empty`

Empty stream:

```java
Stream.empty()
```

## 10.1 Use cases

- no result branch;
- conditional flatMap;
- API helper;
- avoid null stream.

## 10.2 Example

```java
Stream<OrderLine> lines(Order order) {
    return order == null ? Stream.empty() : order.lines().stream();
}
```

## 10.3 Rule

Return empty stream, not null stream, when stream API is used.

---

# 11. `Stream.builder`

Build stream incrementally.

```java
Stream.Builder<String> builder = Stream.builder();
builder.add("A");
builder.add("B");
Stream<String> stream = builder.build();
```

## 11.1 Use cases

- small dynamic construction;
- conditional emission;
- low-level helper.

## 11.2 After build

Builder should not be used after `build`.

## 11.3 Alternative

Often `ArrayList` + `stream()` is clearer for many elements.

## 11.4 Rule

Use builder sparingly; it is not a replacement for collection accumulation in complex code.

---

# 12. Primitive Range Sources

## 12.1 IntStream.range

```java
IntStream.range(0, 10)
```

Produces:

```text
0..9
```

## 12.2 IntStream.rangeClosed

```java
IntStream.rangeClosed(1, 10)
```

Produces:

```text
1..10
```

## 12.3 LongStream

```java
LongStream.range(0, n)
```

## 12.4 Uses

- index loops;
- numeric computations;
- test data;
- avoid boxing.

## 12.5 Rule

Use primitive ranges instead of boxing lists of integers.

---

# 13. `Stream.generate`

Creates infinite unordered stream from Supplier.

```java
Stream.generate(UUID::randomUUID)
```

## 13.1 Infinite

Must be limited or short-circuited.

```java
Stream.generate(UUID::randomUUID)
    .limit(10)
    .toList();
```

## 13.2 Supplier state

Supplier should be thread-safe if stream parallel.

## 13.3 Use cases

- random/test data;
- repeated constant;
- generated events.

## 13.4 Rule

Never terminal-collect an unbounded generate stream without limit.

---

# 14. `Stream.iterate`

Creates stream by repeated function application.

```java
Stream.iterate(0, n -> n + 1)
```

Infinite unless bounded.

## 14.1 Example

```java
Stream.iterate(1, n -> n * 2)
    .limit(10)
    .toList();
```

## 14.2 Sequential dependency

Each element depends on previous.

Parallel splitting usually not as good as range.

## 14.3 Rule

Use `iterate` for recurrence, not simple numeric range.

---

# 15. Finite `iterate` with Predicate

Java 9 added finite iterate form:

```java
Stream.iterate(seed, hasNext, next)
```

Example:

```java
Stream.iterate(1, n -> n <= 100, n -> n + 1)
```

## 15.1 Similar to for loop

```java
for (int n = 1; n <= 100; n++)
```

## 15.2 Use case

- recurrence with stop condition;
- linked traversal;
- generate until condition.

## 15.3 For simple ranges

Prefer `IntStream.rangeClosed`.

## 15.4 Rule

Finite iterate is for recurrence-like generation with predicate.

---

# 16. `Stream.ofNullable`

Creates:

- empty stream if value null;
- one-element stream if non-null.

```java
Stream.ofNullable(user.middleName())
```

## 16.1 Useful with flatMap

```java
users.stream()
    .flatMap(user -> Stream.ofNullable(user.middleName()))
    .toList();
```

## 16.2 Better than manual null branch

```java
value == null ? Stream.empty() : Stream.of(value)
```

## 16.3 Rule

Use `ofNullable` to bridge nullable singular value into stream pipeline.

---

# 17. File and IO Sources

Some stream sources own external resources.

Examples:

```java
Files.lines(path)
Files.list(path)
Files.walk(path)
Files.find(path, depth, matcher)
```

## 17.1 Must close

Use try-with-resources.

```java
try (Stream<String> lines = Files.lines(path)) {
    lines.forEach(System.out::println);
}
```

## 17.2 Lazy IO

Lines/directories are read lazily.

## 17.3 Errors

IO errors may occur during traversal, not source creation.

## 17.4 Rule

Resource-backed streams must have explicit lifetime management.

---

# 18. `Files.lines`

Reads file lines lazily as stream of String.

```java
try (Stream<String> lines = Files.lines(path)) {
    long count = lines.count();
}
```

## 18.1 Benefits

Can process large file without reading all lines into memory.

## 18.2 Charset

Overloads allow charset.

## 18.3 Resource

Must close stream to close file.

## 18.4 Parallel caution

Line splitting depends on charset/file characteristics and IO; parallel may not help.

## 18.5 Rule

Use `Files.lines` for lazy line processing, with try-with-resources.

---

# 19. `Files.list`, `Files.walk`, `Files.find`

## 19.1 Files.list

Lists entries in a directory.

```java
try (Stream<Path> paths = Files.list(dir)) {
    ...
}
```

## 19.2 Files.walk

Walks file tree recursively.

```java
try (Stream<Path> paths = Files.walk(root)) {
    ...
}
```

## 19.3 Files.find

Finds paths matching predicate.

```java
try (Stream<Path> paths = Files.find(root, maxDepth, matcher)) {
    ...
}
```

## 19.4 Resource management

All must be closed.

## 19.5 Rule

Directory/file tree streams are resource-backed and should be closed.

---

# 20. Regex Sources

`Pattern` can create stream.

```java
Pattern.compile(",")
    .splitAsStream(input)
```

## 20.1 Use cases

- lazy token splitting;
- text processing.

## 20.2 Caveat

For simple small strings, `String.split` may be simpler.

## 20.3 Empty tokens

Regex split semantics matter.

## 20.4 Rule

Use regex stream when lazy splitting/composition is useful.

---

# 21. Random Sources

Random generators can produce streams.

Examples:

```java
new Random().ints()
new Random().longs()
new Random().doubles()
```

Also modern random generator APIs exist.

## 21.1 Infinite by default

Many random streams are unbounded unless size specified.

```java
random.ints(100)
```

## 21.2 Bounds

```java
random.ints(100, 0, 10)
```

## 21.3 Parallel caution

Use appropriate random generator for concurrent/parallel workloads.

## 21.4 Rule

Random streams need explicit size/bounds in production code.

---

# 22. Scanner and Token Sources

`Scanner` has token stream methods in modern Java.

Examples:

```java
scanner.tokens()
scanner.findAll(pattern)
```

## 22.1 Resource

Scanner may wrap resource and needs closing.

## 22.2 Tokenization

Good for simple token streams.

## 22.3 Performance

Scanner can be slower than lower-level parsing for huge files.

## 22.4 Rule

Scanner streams are convenient, not always high-performance.

---

# 23. BufferedReader Lines

`BufferedReader` provides:

```java
reader.lines()
```

## 23.1 Similar to Files.lines

Produces stream of lines.

## 23.2 Resource ownership

Closing stream does not necessarily close reader in every pattern? Best manage reader with try-with-resources.

```java
try (BufferedReader reader = Files.newBufferedReader(path);
     Stream<String> lines = reader.lines()) {
    ...
}
```

## 23.3 Rule

Manage the underlying reader explicitly.

---

# 24. Jar/Zip/Directory-Like Sources

Some APIs expose stream-like enumeration over entries.

Examples may include:

```java
JarFile.stream()
ZipFile.stream()
```

## 24.1 Resource

Zip/Jar file must be closed.

## 24.2 Lazy traversal

Entries can be processed lazily.

## 24.3 Rule

When stream source comes from closeable container, close the container/stream as documented.

---

# 25. Custom Sources with Spliterator

For custom source:

```java
Spliterator<T> spliterator = ...
Stream<T> stream = StreamSupport.stream(spliterator, false);
```

## 25.1 Use cases

- custom cursor;
- chunked data;
- domain-specific generator;
- external API pages;
- specialized traversal.

## 25.2 Need characteristics

Declare accurately:

```java
ORDERED
SIZED
SUBSIZED
IMMUTABLE
CONCURRENT
NONNULL
DISTINCT
SORTED
```

## 25.3 Bad characteristics cause bugs

Claiming `SIZED` incorrectly can break assumptions.

## 25.4 Rule

Custom stream sources require correct Spliterator contract.

---

# 26. StreamSupport

`StreamSupport.stream(spliterator, parallel)` creates stream from Spliterator.

## 26.1 Lazy traversal

The spliterator is traversed/split/queried after terminal operation begins.

## 26.2 Supplier overload

There is overload accepting `Supplier<? extends Spliterator<T>>`.

Useful to reduce interference with source before terminal operation.

## 26.3 Primitive support

Also supports primitive spliterators:

```java
StreamSupport.intStream(...)
StreamSupport.longStream(...)
StreamSupport.doubleStream(...)
```

## 26.4 Rule

StreamSupport is low-level bridge from Spliterator to Stream.

---

# 27. Late Binding vs Early Binding Sources

## 27.1 Early binding

Source captured at stream creation.

## 27.2 Late binding

Source binding delayed until traversal/terminal operation.

## 27.3 Why matters

If source mutates after stream creation but before terminal operation, behavior depends on source/spliterator.

## 27.4 Best practice

Do not rely on mutation between stream creation and terminal operation.

## 27.5 Rule

Create stream close to terminal use; avoid storing streams.

---

# 28. Finite vs Infinite Sources

## 28.1 Finite

- collection;
- array;
- range;
- file with finite lines.

## 28.2 Infinite

- generate;
- iterate without predicate/limit;
- random unbounded streams.

## 28.3 Terminal danger

```java
infiniteStream.toList()
```

never completes or OOMs.

## 28.4 Safe use

```java
limit
findFirst
anyMatch
takeWhile
```

## 28.5 Rule

Every infinite source needs a bounding/short-circuiting strategy.

---

# 29. Sized vs Unsized Sources

## 29.1 Sized

Source knows size.

Examples:

- array;
- ArrayList;
- range;
- many collections.

## 29.2 Unsized

Source may not know size.

Examples:

- generate;
- IO source;
- iterator source.

## 29.3 Why matters

Sized helps:

- preallocation;
- splitting;
- `count` optimization;
- collectors.

## 29.4 Rule

Sized sources are easier to optimize.

---

# 30. Ordered vs Unordered Sources

## 30.1 Ordered

- List;
- arrays;
- ranges;
- LinkedHashSet;
- TreeSet.

## 30.2 Unordered

- HashSet;
- many concurrent views.

## 30.3 Why matters

Ordered operations can cost more:

```java
limit
skip
findFirst
forEachOrdered
```

especially in parallel.

## 30.4 Rule

If order does not matter, do not impose it.

---

# 31. Resource Ownership

Some sources own resources.

## 31.1 Non-resource

```java
list.stream()
array stream
Stream.of
range
```

## 31.2 Resource-backed

```java
Files.lines
Files.walk
Files.list
Scanner.tokens
BufferedReader.lines
ZipFile.stream
```

## 31.3 Rule

If source is IO/Closeable-backed, use try-with-resources.

---

# 32. Mutation of Source During Stream

## 32.1 Bad

```java
List<String> list = new ArrayList<>(List.of("A", "B"));

Stream<String> s = list.stream();
list.add("C");
s.toList();
```

Behavior can depend on source and timing.

## 32.2 Worse during traversal

```java
list.stream().forEach(x -> list.add(x));
```

## 32.3 Safe options

- snapshot first;
- use concurrent collection source with weakly consistent semantics;
- avoid mutation.

## 32.4 Rule

Do not mutate non-concurrent stream source during pipeline execution.

---

# 33. Concurrent Sources

Concurrent collections can be stream sources.

```java
ConcurrentHashMap.newKeySet().stream()
```

## 33.1 Weak consistency

May reflect some concurrent updates, not exact snapshot.

## 33.2 Snapshot if needed

```java
List<T> snapshot = List.copyOf(concurrentCollection);
```

## 33.3 Rule

Concurrent source streams are safe structurally, not necessarily deterministic.

---

# 34. Parallel Stream Source Quality

Good parallel sources:

- arrays;
- ArrayList;
- ranges;
- sized spliterators with good splitting.

Poorer sources:

- linked lists;
- IO streams;
- generate;
- iterate recurrence;
- unknown-size iterators.

## 34.1 Splitting matters

Parallel stream needs divide-and-conquer.

## 34.2 Work per element matters

Even good source won't help if per-element work tiny.

## 34.3 Rule

Parallel stream starts with source split quality.

---

# 35. Nulls from Source

Some sources may emit null.

## 35.1 Collections

If collection contains null, stream emits null.

## 35.2 Stream.ofNullable

Converts nullable single value to zero/one stream.

## 35.3 IO lines

Normally lines are non-null until end is represented by stream termination, not null element.

## 35.4 Rule

Know whether your source can produce null and normalize early.

---

# 36. API Design: Should You Accept/Return Stream Sources?

## 36.1 Accepting Stream

Can be okay for one-shot computation:

```java
Summary summarize(Stream<Event> events)
```

But caller loses reuse.

## 36.2 Accepting Iterable/Collection

Better when method may traverse multiple times or needs size.

```java
Summary summarize(Collection<Event> events)
```

## 36.3 Returning Stream

Use carefully when:

- lazy traversal important;
- caller must close it;
- resource lifetime documented.

## 36.4 Returning Collection

Usually better for materialized results.

## 36.5 Rule

Streams in public API require one-shot and resource semantics documentation.

---

# 37. Production Failure Modes

## 37.1 Forgetting to close Files.lines

Resource leak.

## 37.2 Infinite generate collected to list

OOM/hang.

## 37.3 Stream.of primitive array

Got `Stream<int[]>` instead of `IntStream`.

## 37.4 HashSet source order assumed stable

Nondeterministic output/tests.

## 37.5 Concurrent source assumed snapshot

Inconsistent report.

## 37.6 Mutating ArrayList after stream creation

CME or unexpected behavior.

## 37.7 Custom Spliterator wrong characteristics

Incorrect parallel/count/collector behavior.

## 37.8 IO exception during terminal operation

Failure appears far from source creation.

## 37.9 Using iterate for numeric range

Poorer performance/splitting than IntStream.range.

## 37.10 Returning resource-backed stream without docs

Caller leaks resource.

## 37.11 Scanner stream left open

Resource leak.

## 37.12 Random infinite stream without bound

Non-terminating pipeline.

---

# 38. Best Practices

## 38.1 Source selection

- Use `collection.stream()` for existing collections.
- Use `Arrays.stream` for arrays, especially primitives.
- Use `IntStream.range` for numeric ranges.
- Use `Stream.of` for small object values.
- Use `Stream.ofNullable` for nullable single value.
- Use `Files.lines` for large lazy line processing.
- Use `StreamSupport` only for custom low-level sources.

## 38.2 Resource

- Use try-with-resources for IO-backed streams.
- Do not return closeable stream without documenting caller responsibility.

## 38.3 Infinite

- Always bound infinite sources.
- Prefer finite iterate/range when possible.

## 38.4 Ordering

- Choose ordered source if order matters.
- Avoid relying on HashSet/HashMap order.

## 38.5 Parallel

- Prefer arrays/ranges/ArrayList for parallel sources.
- Measure.

## 38.6 Mutation

- Avoid mutating source.
- Snapshot if deterministic result needed.

---

# 39. Decision Matrix

| Need | Recommended Source |
|---|---|
| existing list | `list.stream()` |
| existing set unique values | `set.stream()` |
| map keys | `map.keySet().stream()` |
| map values | `map.values().stream()` |
| map key-value | `map.entrySet().stream()` |
| object array | `Arrays.stream(array)` |
| primitive array | `Arrays.stream(intArray)` |
| small fixed object values | `Stream.of(...)` |
| empty branch | `Stream.empty()` |
| nullable single value | `Stream.ofNullable(value)` |
| integer index range | `IntStream.range(...)` |
| inclusive numeric range | `IntStream.rangeClosed(...)` |
| infinite generated values | `Stream.generate(...).limit(...)` |
| recurrence | `Stream.iterate(...)` |
| finite recurrence | `Stream.iterate(seed, hasNext, next)` |
| file lines | `Files.lines` in try-with-resources |
| directory entries | `Files.list` in try-with-resources |
| recursive file tree | `Files.walk` in try-with-resources |
| regex split | `Pattern.splitAsStream` |
| random values | random stream with explicit size/bounds |
| custom traversal | `Spliterator` + `StreamSupport` |
| deterministic concurrent report | snapshot collection first |
| parallel numeric work | range/array source |
| reusable data | collection, not stream |

---

# 40. Latihan

## Latihan 1 — Stream.of Primitive Array

Compare:

```java
Stream.of(new int[]{1,2,3})
Arrays.stream(new int[]{1,2,3})
```

Explain types.

## Latihan 2 — Encounter Order

Stream from:

```java
HashSet
LinkedHashSet
TreeSet
ArrayList
```

Observe order.

## Latihan 3 — Files.lines

Read large file line count with try-with-resources.

## Latihan 4 — Infinite Generate

Generate UUIDs and safely limit to 10.

## Latihan 5 — Finite Iterate

Use finite iterate to generate powers of two less than 1000.

## Latihan 6 — Range vs Iterate

Generate 0..1_000_000 using `IntStream.range` and `Stream.iterate`.

Compare conceptual split quality.

## Latihan 7 — Map Entry Stream

From `Map<UserId, User>`, collect IDs of active users.

## Latihan 8 — Regex Stream

Split CSV-like string with Pattern and filter blank tokens.

## Latihan 9 — Custom Spliterator

Create simple Spliterator over paged API response.

Define characteristics carefully.

## Latihan 10 — Resource API Design

Design method returning stream from file. Document close responsibility or return materialized List.

---

# 41. Ringkasan

Stream source determines pipeline behavior.

Core lessons:

- Source is where stream elements come from.
- Source characteristics affect order, size, splitting, nulls, and resources.
- Collections are common stream sources.
- List/array/range sources are ordered and usually good for splitting.
- Set/map order depends on implementation.
- Use map views as stream sources.
- Use `Arrays.stream`, not `Stream.of`, for primitive arrays.
- Use `Stream.empty` instead of null stream.
- Use `Stream.ofNullable` for nullable singular values.
- `generate` and unbounded `iterate` are infinite.
- Use `IntStream.range` for numeric ranges.
- IO-backed streams must be closed.
- Custom sources require correct Spliterator contract.
- Concurrent source streams are safe but not exact snapshots.
- Source mutation during stream traversal is dangerous.
- Public API returning Stream requires one-shot/resource docs.

Main rule:

```text
A stream pipeline is only as predictable as its source.
Before designing operations, understand source order, size, lifetime, mutability, and splitting behavior.
```

---

# 42. Referensi

1. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

2. Java SE 25 — `java.util.stream` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

3. Java SE 25 — `StreamSupport`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/StreamSupport.html

4. Java SE 25 — `Spliterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterator.html

5. Java SE 25 — `Collection.stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html#stream()

6. Java SE 25 — `Arrays.stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html

7. Java SE 25 — `Files.lines`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html#lines(java.nio.file.Path)

8. Java SE 25 — `Files.walk`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html#walk(java.nio.file.Path,java.nio.file.FileVisitOption...)

9. Java SE 25 — `Pattern.splitAsStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html#splitAsStream(java.lang.CharSequence)

10. dev.java — The Stream API  
    https://dev.java/learn/api/streams/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-collections-and-streams-part-024.md">⬅️ Java Collections and Streams — Part 024</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-collections-and-streams-part-026.md">Java Collections and Streams — Part 026 ➡️</a>
</div>

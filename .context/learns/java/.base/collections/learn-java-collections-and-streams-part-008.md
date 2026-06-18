# learn-java-collections-and-streams-part-008.md

# Java Collections and Streams — Part 008  
# Spliterator Deep Dive: Traversal, Partitioning, Characteristics, tryAdvance, trySplit, StreamSupport, Parallel Stream Foundation, dan Custom Spliterator Design

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **008**  
> Fokus: memahami `Spliterator` sebagai **traversal + partitioning contract** yang menjadi fondasi Stream API, terutama parallel stream. Kita akan membedah `tryAdvance`, `forEachRemaining`, `trySplit`, `estimateSize`, `characteristics`, `ORDERED`, `DISTINCT`, `SORTED`, `SIZED`, `NONNULL`, `IMMUTABLE`, `CONCURRENT`, `SUBSIZED`, custom spliterator, stream creation dengan `StreamSupport`, serta correctness/performance pitfalls.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Spliterator = Iterator + Split + Metadata](#2-mental-model-spliterator--iterator--split--metadata)
3. [Kenapa Spliterator Ada](#3-kenapa-spliterator-ada)
4. [Spliterator Contract](#4-spliterator-contract)
5. [`tryAdvance`](#5-tryadvance)
6. [`forEachRemaining`](#6-foreachremaining)
7. [`trySplit`](#7-trysplit)
8. [`estimateSize`](#8-estimatesize)
9. [`getExactSizeIfKnown`](#9-getexactsizeifknown)
10. [`characteristics`](#10-characteristics)
11. [`ORDERED`](#11-ordered)
12. [`DISTINCT`](#12-distinct)
13. [`SORTED`](#13-sorted)
14. [`SIZED`](#14-sized)
15. [`NONNULL`](#15-nonnull)
16. [`IMMUTABLE`](#16-immutable)
17. [`CONCURRENT`](#17-concurrent)
18. [`SUBSIZED`](#18-subsized)
19. [Characteristic Combinations](#19-characteristic-combinations)
20. [Late-Binding vs Early-Binding](#20-late-binding-vs-early-binding)
21. [Fail-Fast and Spliterator](#21-fail-fast-and-spliterator)
22. [Spliterator and Streams](#22-spliterator-and-streams)
23. [`StreamSupport`](#23-streamsupport)
24. [Sequential vs Parallel Stream Creation](#24-sequential-vs-parallel-stream-creation)
25. [Splitting Quality and Parallel Performance](#25-splitting-quality-and-parallel-performance)
26. [ArrayList vs LinkedList vs HashSet vs TreeSet Spliterators](#26-arraylist-vs-linkedlist-vs-hashset-vs-treeset-spliterators)
27. [Primitive Spliterators](#27-primitive-spliterators)
28. [Custom Spliterator: When and Why](#28-custom-spliterator-when-and-why)
29. [Custom Spliterator Example: Batching List](#29-custom-spliterator-example-batching-list)
30. [Custom Spliterator Example: Line-Like Lazy Source](#30-custom-spliterator-example-line-like-lazy-source)
31. [Custom Spliterator Design Rules](#31-custom-spliterator-design-rules)
32. [Spliterator Testing Strategy](#32-spliterator-testing-strategy)
33. [Production Failure Modes](#33-production-failure-modes)
34. [Best Practices](#34-best-practices)
35. [Decision Matrix](#35-decision-matrix)
36. [Latihan](#36-latihan)
37. [Ringkasan](#37-ringkasan)
38. [Referensi](#38-referensi)

---

# 1. Tujuan Bagian Ini

Pada part sebelumnya kita membahas `Iterator`.

`Iterator` menjawab:

```text
Bagaimana mengambil element berikutnya?
```

`Spliterator` menjawab lebih banyak:

```text
Bagaimana mengambil element berikutnya?
Bisakah source ini dibagi menjadi beberapa bagian?
Berapa perkiraan ukuran?
Apakah order penting?
Apakah element unique?
Apakah sorted?
Apakah non-null?
Apakah immutable/concurrent?
Apakah sub-split juga sized?
```

Spliterator adalah bagian yang sering tidak terlihat, tetapi sangat menentukan:

- stream source behavior;
- parallel stream performance;
- ordering behavior;
- short-circuit efficiency;
- correctness of custom sources;
- memory/performance trade-offs.

Tujuan bagian ini:

- memahami Spliterator sebagai traversal + partitioning + metadata;
- memahami methods utama;
- memahami characteristics;
- memahami hubungannya dengan Stream API;
- memahami kapan custom Spliterator perlu;
- mengenali parallel stream pitfalls dari splitting yang buruk.

---

# 2. Mental Model: Spliterator = Iterator + Split + Metadata

## 2.1 Iterator

Iterator:

```java
boolean hasNext()
E next()
```

Memberi sequential traversal.

## 2.2 Spliterator

Spliterator:

```java
boolean tryAdvance(Consumer<? super T> action)
Spliterator<T> trySplit()
long estimateSize()
int characteristics()
```

Memberi:

```text
sequential traversal
+
partitioning
+
metadata
```

## 2.3 Why “split”?

Parallel processing butuh membagi source.

```text
source
  -> split into left/right
  -> split again
  -> process chunks in parallel
  -> combine results
```

## 2.4 Why metadata?

Stream engine bisa optimize jika tahu:

- size known;
- order matters;
- elements distinct;
- sorted;
- no null;
- source immutable/concurrent.

## 2.5 Main mental model

```text
Iterator: "give me next"
Spliterator: "give me next, or give me half, and tell me what kind of source this is"
```

---

# 3. Kenapa Spliterator Ada

Spliterator introduced with Stream API to support efficient sequential and parallel traversal.

## 3.1 Iterator insufficient for parallel

Iterator is inherently sequential.

You cannot efficiently ask an Iterator:

```text
Please split yourself into two independent iterators of similar size.
```

## 3.2 Collection differences matter

Consider:

```java
ArrayList
LinkedList
HashSet
TreeSet
Files.lines
Stream.generate
```

They have very different traversal/splitting behavior.

## 3.3 ArrayList

Can split by index range efficiently.

```text
[0..999] -> [0..499] + [500..999]
```

## 3.4 LinkedList

Splitting requires traversal/chunking, less locality-friendly.

## 3.5 IO source

May not split efficiently at all.

## 3.6 Infinite generator

Size unknown, splitting tricky or impossible.

## 3.7 Spliterator gives stream engine enough protocol

Without exposing internal structure.

## 3.8 Rule

```text
Spliterator is the protocol that allows streams to understand and divide a source.
```

---

# 4. Spliterator Contract

Java SE docs define `Spliterator` as an object for traversing and partitioning elements of a source; source can be array, collection, IO channel, or generator function.

## 4.1 Main methods

```java
boolean tryAdvance(Consumer<? super T> action);
default void forEachRemaining(Consumer<? super T> action);
Spliterator<T> trySplit();
long estimateSize();
int characteristics();
```

## 4.2 Traversal methods

- `tryAdvance`;
- `forEachRemaining`.

## 4.3 Partitioning method

- `trySplit`.

## 4.4 Metadata methods

- `estimateSize`;
- `getExactSizeIfKnown`;
- `characteristics`;
- `hasCharacteristics`;
- `getComparator`.

## 4.5 Single-use nature

Like Iterator, Spliterator is stateful traversal object.

Once advanced, it has consumed elements.

## 4.6 Rule

Spliterator is not reusable collection. It is a traversal/partition cursor.

---

# 5. `tryAdvance`

`tryAdvance` attempts to advance one element.

Signature:

```java
boolean tryAdvance(Consumer<? super T> action)
```

## 5.1 Behavior

If an element exists:

- performs action on element;
- advances;
- returns true.

If no element:

- returns false.

## 5.2 Example conceptual loop

```java
Spliterator<T> sp = collection.spliterator();

while (sp.tryAdvance(item -> process(item))) {
    // action already done
}
```

Because action is passed in, loop body often empty.

## 5.3 Equivalent to next-ish

Iterator:

```java
if (it.hasNext()) {
    T item = it.next();
    process(item);
}
```

Spliterator:

```java
sp.tryAdvance(this::process);
```

## 5.4 Error handling

Exceptions thrown by action propagate.

## 5.5 Important

`tryAdvance` must not call action if no element.

## 5.6 Rule

Implement `tryAdvance` correctly first; everything else builds on it.

---

# 6. `forEachRemaining`

`forEachRemaining` processes all remaining elements.

Signature:

```java
default void forEachRemaining(Consumer<? super T> action)
```

## 6.1 Default behavior

Default can repeatedly call `tryAdvance`.

## 6.2 Optimization

Custom Spliterator can override for faster bulk traversal.

Example:

- array range loop;
- buffer scan;
- file chunk;
- primitive loop.

## 6.3 Example

```java
spliterator.forEachRemaining(this::process);
```

## 6.4 Difference from tryAdvance

`tryAdvance` processes one element at a time.

`forEachRemaining` processes all remaining.

## 6.5 Rule

Override `forEachRemaining` when bulk traversal can be more efficient than repeated `tryAdvance`.

---

# 7. `trySplit`

`trySplit` is the heart of parallelism.

Signature:

```java
Spliterator<T> trySplit()
```

## 7.1 Behavior

If this spliterator can be partitioned, it returns another spliterator covering some portion of elements.

The current spliterator keeps the rest.

If cannot split, returns null.

## 7.2 Conceptual example

Array range:

```text
current covers [0, 100)
trySplit returns [0, 50)
current now covers [50, 100)
```

## 7.3 Goal

Produce reasonably balanced independent chunks.

## 7.4 Bad split

Always returning one element:

- too many tasks;
- overhead high.

## 7.5 Bad no split

Always returning null:

- parallel stream becomes effectively sequential.

## 7.6 Unbalanced split

Returning tiny split while current remains huge causes poor parallelism.

## 7.7 Rule

Parallel stream performance depends heavily on `trySplit` quality.

---

# 8. `estimateSize`

Returns estimate of number of elements remaining.

```java
long estimateSize()
```

## 8.1 Exact or estimate

Can be exact if known.

Can be estimate if not.

Can be `Long.MAX_VALUE` for unknown/infinite.

## 8.2 Why matters

Stream engine uses size estimate for:

- task splitting;
- pre-allocation;
- optimization;
- terminal operations.

## 8.3 For sized source

Array/list can return exact remaining size.

## 8.4 For IO/generator

May be unknown.

## 8.5 Rule

Return accurate estimate if possible. Do not lie.

---

# 9. `getExactSizeIfKnown`

Default method:

```java
long getExactSizeIfKnown()
```

Returns exact size if `SIZED` characteristic is present, otherwise `-1`.

## 9.1 Use

```java
long size = sp.getExactSizeIfKnown();
```

## 9.2 Meaning

If returns non-negative, size exact for remaining elements.

## 9.3 Danger

If you report `SIZED` incorrectly, downstream optimizations may break.

## 9.4 Rule

Only report SIZED when size is exact.

---

# 10. `characteristics`

Returns bit set of characteristics.

```java
int characteristics()
```

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

## 10.1 Why characteristics matter

They allow clients like Stream API to:

- preserve order;
- skip distinct work;
- optimize sorting;
- preallocate arrays;
- handle concurrent sources;
- improve splitting.

## 10.2 `hasCharacteristics`

```java
sp.hasCharacteristics(Spliterator.ORDERED | Spliterator.SIZED)
```

## 10.3 Rule

Characteristics are promises. Wrong promises cause wrong behavior or poor performance.

---

# 11. `ORDERED`

`ORDERED` means elements have a defined encounter order.

## 11.1 Examples

- List spliterator;
- LinkedHashSet spliterator;
- TreeSet spliterator;
- ordered stream source.

## 11.2 Non-examples

- HashSet order should not be treated as semantic order.

## 11.3 Stream implications

For ordered streams:

- `findFirst` respects order;
- `forEachOrdered` respects order;
- `limit` may be more expensive in parallel;
- `distinct` may preserve first occurrence.

## 11.4 Custom Spliterator

If source order is meaningful and stable, report ORDERED.

## 11.5 Rule

Report ORDERED only when encounter order is part of source contract.

---

# 12. `DISTINCT`

`DISTINCT` means each pair of encountered elements is distinct according to equality semantics.

## 12.1 Examples

Set spliterator generally reports DISTINCT.

## 12.2 Stream implication

If source is DISTINCT, `stream.distinct()` may be optimized.

## 12.3 Danger

If your custom spliterator reports DISTINCT but emits duplicates, downstream results can be wrong.

## 12.4 Distinct according to what?

For normal object streams, distinct relates to `equals`.

For sorted/comparator-based sources, be careful.

## 12.5 Rule

Only report DISTINCT if duplicates cannot occur.

---

# 13. `SORTED`

`SORTED` means elements follow a defined sort order.

## 13.1 Examples

SortedSet/TreeSet spliterator.

## 13.2 Comparator

If sorted by natural order, `getComparator()` may return null.

If sorted by custom comparator, `getComparator()` returns it.

## 13.3 Stream implication

`sorted()` may be optimized or preserve known order.

## 13.4 ORDERED relationship

SORTED implies ORDERED conceptually.

## 13.5 Danger

If you report SORTED but output not sorted, downstream logic can be wrong.

## 13.6 Rule

Report SORTED only when traversal order is sorted by comparator/natural order.

---

# 14. `SIZED`

`SIZED` means `estimateSize` before traversal/splitting represents exact size.

## 14.1 Examples

- ArrayList;
- arrays;
- many collections.

## 14.2 Not examples

- stream from IO with unknown lines;
- generator;
- concurrent changing source unless designed carefully.

## 14.3 Stream implications

Can preallocate result storage.

Example:

```java
stream.toArray()
```

can benefit.

## 14.4 Mutation issue

If source can structurally change during traversal, SIZED may be invalid unless spliterator is late-binding or has defined concurrent behavior.

## 14.5 Rule

SIZED is a strong promise. Do not guess.

---

# 15. `NONNULL`

`NONNULL` means source guarantees no null elements.

## 15.1 Examples

Some primitive-like or validated sources.

Many standard collections do not report NONNULL because they can contain null.

## 15.2 Stream implication

Can allow optimization or assumptions.

## 15.3 Danger

Reporting NONNULL while emitting null can break downstream code expecting non-null.

## 15.4 Domain use

If custom domain collection rejects null, its spliterator may report NONNULL.

## 15.5 Rule

Report NONNULL only if null cannot be produced.

---

# 16. `IMMUTABLE`

`IMMUTABLE` means source cannot be structurally modified during traversal.

## 16.1 Examples

Immutable collection snapshot.

## 16.2 Meaning

No structural changes are possible, so no fail-fast needed.

## 16.3 Not just unmodifiable view

An unmodifiable view over mutable backing collection is not necessarily immutable.

## 16.4 Stream implication

Safer traversal assumptions.

## 16.5 Rule

Report IMMUTABLE only if source truly cannot structurally change.

---

# 17. `CONCURRENT`

`CONCURRENT` means source can be safely concurrently modified.

## 17.1 Examples

ConcurrentHashMap spliterators report concurrent behavior.

## 17.2 Meaning

The source may be modified concurrently without external synchronization.

## 17.3 Not same as immutable

Concurrent source can change.

## 17.4 Stream implication

Stream may not need fail-fast behavior.

But results may be weakly consistent.

## 17.5 Rule

Report CONCURRENT only for sources designed for concurrent modification.

---

# 18. `SUBSIZED`

`SUBSIZED` means all spliterators resulting from `trySplit` are SIZED and SUBSIZED.

## 18.1 Examples

Array-based range splitting.

## 18.2 Why important

Parallel stream can better plan work if every split has exact size.

## 18.3 Danger

If sub-splits are not exact sized, do not report.

## 18.4 SIZED relation

SUBSIZED generally goes with SIZED, but understand exact API contract.

## 18.5 Rule

SUBSIZED is for predictable split sizes.

---

# 19. Characteristic Combinations

## 19.1 ArrayList-like

```text
ORDERED | SIZED | SUBSIZED
```

May allow null, so not NONNULL.

## 19.2 HashSet-like

```text
DISTINCT | SIZED
```

No encounter order guarantee.

## 19.3 TreeSet-like

```text
DISTINCT | SORTED | ORDERED | SIZED
```

## 19.4 Immutable non-null domain list

```text
ORDERED | SIZED | SUBSIZED | IMMUTABLE | NONNULL
```

if truly guaranteed.

## 19.5 ConcurrentHashMap key set

May include:

```text
CONCURRENT | DISTINCT | NONNULL
```

and not SIZED in same exact way because concurrent size changes.

## 19.6 Rule

Characteristics should reflect semantic and operational truth, not wishful optimization.

---

# 20. Late-Binding vs Early-Binding

## 20.1 Early-binding

Spliterator binds to source state when created.

Changes after creation may cause fail-fast or be ignored depending implementation.

## 20.2 Late-binding

Spliterator binds to source closer to traversal time.

This can reduce surprises when stream created before source mutation but terminal operation later.

## 20.3 StreamSupport note

When creating streams from spliterators, docs mention spliterator is traversed/split/queried only after terminal operation begins for certain factories. This matters because streams are lazy.

## 20.4 Example

```java
Stream<T> stream = collection.stream();
collection.add(x);
stream.count();
```

Behavior depends on source/spliterator binding and collection rules.

## 20.5 Rule

Do not mutate stream source between stream creation and terminal operation unless source explicitly supports it.

---

# 21. Fail-Fast and Spliterator

Many collection spliterators are fail-fast on best-effort basis, similar to iterators.

## 21.1 Structural modification

If collection structurally modified during traversal, spliterator may throw ConcurrentModificationException.

## 21.2 Best-effort

Not guaranteed under unsynchronized concurrent modification.

## 21.3 Stream implication

Mutating source during stream pipeline can cause:

- ConcurrentModificationException;
- inconsistent result;
- missed/duplicated elements;
- undefined behavior relative to non-interference contract.

## 21.4 Rule

Do not rely on fail-fast for correctness.

---

# 22. Spliterator and Streams

A stream source is often backed by a Spliterator.

## 22.1 Collection stream

```java
collection.stream()
```

uses:

```java
collection.spliterator()
```

## 22.2 Parallel stream

```java
collection.parallelStream()
```

uses spliterator splitting.

## 22.3 Stream pipeline execution

Stream pipeline traverses source only when terminal operation begins.

## 22.4 Characteristics affect operations

Examples:

- `SIZED` helps `count`/toArray.
- `ORDERED` affects findFirst/limit/forEachOrdered.
- `DISTINCT` can optimize distinct.
- `SORTED` can optimize sorted.
- `CONCURRENT` affects concurrent traversal assumptions.

## 22.5 Rule

Understanding Stream performance requires understanding source Spliterator.

---

# 23. `StreamSupport`

`StreamSupport` is a low-level utility for creating streams from Spliterators.

## 23.1 Basic

```java
Stream<T> stream = StreamSupport.stream(spliterator, false);
```

Second argument:

```java
false = sequential
true = parallel
```

## 23.2 For primitive

```java
StreamSupport.intStream(spliteratorOfInt, false)
```

## 23.3 Intended audience

Mostly library/framework writers or custom data structure authors.

Application code usually uses:

```java
collection.stream()
```

## 23.4 Example

```java
public Stream<Row> stream() {
    return StreamSupport.stream(spliterator(), false);
}
```

## 23.5 Resource warning

If source is resource-backed, returned stream should support close handler:

```java
return StreamSupport.stream(sp, false)
    .onClose(resource::close);
```

## 23.6 Rule

Use StreamSupport when you own a custom source and need stream view.

---

# 24. Sequential vs Parallel Stream Creation

## 24.1 Sequential

```java
StreamSupport.stream(sp, false)
```

Uses traversal sequentially.

## 24.2 Parallel

```java
StreamSupport.stream(sp, true)
```

Allows parallel execution.

## 24.3 Parallel only helps if

- source splits well;
- work per element significant;
- operations stateless/associative;
- no blocking shared bottleneck;
- collector/reduction parallel-correct;
- overhead is justified.

## 24.4 Bad parallel source

Custom spliterator with `trySplit` always null.

```java
parallel = true
```

but actual traversal mostly sequential.

## 24.5 Rule

Do not expose parallel stream from custom source unless splitting is correct and useful.

---

# 25. Splitting Quality and Parallel Performance

Parallel stream performance is often determined before lambda code runs.

## 25.1 Good splitting

- balanced;
- cheap;
- independent chunks;
- accurate sizes;
- low coordination.

Array ranges are excellent.

## 25.2 Bad splitting

- unbalanced;
- expensive to split;
- unknown size;
- source synchronized;
- IO-bound;
- tiny chunks;
- high per-task overhead.

## 25.3 Balanced split

Good:

```text
1000 -> 500 + 500
500 -> 250 + 250
```

Bad:

```text
1000 -> 1 + 999
999 -> 1 + 998
```

## 25.4 Work granularity

If each element work is trivial, parallel overhead can dominate.

## 25.5 Stateful ordered operations

Parallel + ORDERED + limit/distinct/sorted can be expensive.

## 25.6 Rule

Parallel stream speed requires good spliterator + suitable workload + correct reduction.

---

# 26. ArrayList vs LinkedList vs HashSet vs TreeSet Spliterators

## 26.1 ArrayList

- ordered;
- sized;
- subsized;
- efficient splitting by range;
- good parallel source.

## 26.2 LinkedList

- ordered;
- sized;
- splitting less locality-friendly;
- node traversal cost.

## 26.3 HashSet

- distinct;
- sized;
- unordered;
- splitting depends on hash table buckets;
- no encounter order guarantee.

## 26.4 LinkedHashSet

- distinct;
- ordered encounter;
- linked order overhead.

## 26.5 TreeSet

- distinct;
- sorted;
- ordered;
- splitting tree structure may be less cheap than array.

## 26.6 ConcurrentHashMap

- concurrent;
- weakly consistent;
- useful for concurrent traversal, but not exact snapshot.

## 26.7 Rule

Collection type affects stream source behavior. `stream()` is not just stream; it inherits source characteristics.

---

# 27. Primitive Spliterators

Spliterator has primitive specializations:

```java
Spliterator.OfInt
Spliterator.OfLong
Spliterator.OfDouble
```

## 27.1 Why

Avoid boxing.

## 27.2 Example

```java
Spliterator.OfInt sp
IntStream stream = StreamSupport.intStream(sp, false);
```

## 27.3 Use cases

- numeric ranges;
- parsing primitive data;
- high-volume primitive processing.

## 27.4 Boxing cost

Generic `Spliterator<Integer>` may allocate/box.

## 27.5 Rule

For high-volume primitive data, consider primitive spliterator/stream.

---

# 28. Custom Spliterator: When and Why

Most developers never need custom Spliterator.

But it is useful when:

## 28.1 Custom data structure

You build collection-like structure and want stream support.

## 28.2 Lazy source

You have custom traversal:

- paginated API;
- file parser;
- token scanner;
- database cursor;
- generated sequence.

## 28.3 Better parallel splitting

You can split source better than default iterator-based spliterator.

## 28.4 Domain-specific characteristics

You can guarantee:

- non-null;
- sorted;
- distinct;
- sized;
- immutable.

## 28.5 Avoid if

- normal collection stream enough;
- source cannot split;
- resource lifecycle hard;
- correctness uncertain.

## 28.6 Rule

Custom Spliterator is library-level tool. Use only with clear benefit.

---

# 29. Custom Spliterator Example: Batching List

Goal:

```text
Traverse list in batches.
```

Instead of stream of individual elements, produce batches:

```java
List<T>
```

## 29.1 Implementation

```java
public final class BatchSpliterator<T> implements Spliterator<List<T>> {
    private final List<T> source;
    private final int batchSize;
    private int origin;
    private final int fence;

    public BatchSpliterator(List<T> source, int batchSize) {
        this(source, batchSize, 0, source.size());
    }

    private BatchSpliterator(List<T> source, int batchSize, int origin, int fence) {
        if (batchSize <= 0) {
            throw new IllegalArgumentException("batchSize must be positive");
        }
        this.source = Objects.requireNonNull(source);
        this.batchSize = batchSize;
        this.origin = origin;
        this.fence = fence;
    }

    @Override
    public boolean tryAdvance(Consumer<? super List<T>> action) {
        Objects.requireNonNull(action);
        if (origin >= fence) {
            return false;
        }

        int end = Math.min(origin + batchSize, fence);
        List<T> batch = List.copyOf(source.subList(origin, end));
        origin = end;
        action.accept(batch);
        return true;
    }

    @Override
    public Spliterator<List<T>> trySplit() {
        int remaining = fence - origin;
        if (remaining <= batchSize * 2) {
            return null;
        }

        int mid = origin + remaining / 2;
        // align mid to batch boundary
        int alignedMid = origin + ((mid - origin) / batchSize) * batchSize;
        if (alignedMid <= origin || alignedMid >= fence) {
            return null;
        }

        BatchSpliterator<T> prefix =
            new BatchSpliterator<>(source, batchSize, origin, alignedMid);
        origin = alignedMid;
        return prefix;
    }

    @Override
    public long estimateSize() {
        int remaining = fence - origin;
        return (remaining + batchSize - 1L) / batchSize;
    }

    @Override
    public int characteristics() {
        return ORDERED | SIZED | SUBSIZED;
    }
}
```

## 29.2 Use

```java
Stream<List<T>> batches = StreamSupport.stream(
    new BatchSpliterator<>(items, 100),
    false
);
```

## 29.3 Notes

- reports ORDERED;
- sized by number of batches;
- copies each sublist to avoid view retention/mutation;
- splitting aligns to batch boundary.

## 29.4 Caveat

If source list mutates during traversal, behavior not protected. Could copy source first if needed.

## 29.5 Rule

Custom spliterator must define ownership/mutation assumptions.

---

# 30. Custom Spliterator Example: Line-Like Lazy Source

Suppose you have source that reads records one by one and cannot split.

## 30.1 Sequential spliterator

```java
public final class CursorSpliterator<T> implements Spliterator<T> {
    private final Cursor<T> cursor;

    public CursorSpliterator(Cursor<T> cursor) {
        this.cursor = Objects.requireNonNull(cursor);
    }

    @Override
    public boolean tryAdvance(Consumer<? super T> action) {
        Objects.requireNonNull(action);

        Optional<T> next = cursor.next();
        if (next.isEmpty()) {
            return false;
        }

        action.accept(next.get());
        return true;
    }

    @Override
    public Spliterator<T> trySplit() {
        return null;
    }

    @Override
    public long estimateSize() {
        return Long.MAX_VALUE;
    }

    @Override
    public int characteristics() {
        return ORDERED | NONNULL;
    }
}
```

## 30.2 Stream with close

```java
Stream<T> stream = StreamSupport.stream(new CursorSpliterator<>(cursor), false)
    .onClose(cursor::close);
```

## 30.3 Not parallel-friendly

`trySplit` returns null.

Do not create parallel stream expecting speedup.

## 30.4 Resource ownership

Caller must close stream.

## 30.5 Rule

Non-splittable lazy sources are fine for sequential stream, not parallel stream.

---

# 31. Custom Spliterator Design Rules

## 31.1 Correctness first

Implement correct traversal before optimization.

## 31.2 Characteristics truth

Do not overclaim.

## 31.3 Splitting

If supporting parallel, split:

- balanced;
- independent;
- finite;
- with accurate estimates.

## 31.4 Ownership

Define whether source can mutate.

## 31.5 Null

If reporting NONNULL, enforce it.

## 31.6 Size

If reporting SIZED, estimate must be exact.

## 31.7 Order

If reporting ORDERED, traversal must follow defined encounter order.

## 31.8 Resource

If resource-backed, integrate close.

## 31.9 Exception

Decide how IO/parse errors surface.

## 31.10 Primitive specialization

Use primitive spliterators for high-volume primitive data.

## 31.11 Rule

A wrong spliterator is worse than no custom spliterator.

---

# 32. Spliterator Testing Strategy

## 32.1 Sequential traversal

Verify all elements produced exactly once.

## 32.2 Empty source

Verify no action called.

## 32.3 One element

Verify correct behavior.

## 32.4 Multiple elements

Verify order if ORDERED.

## 32.5 Splitting

Test recursive splitting:

```java
static <T> List<T> collectAll(Spliterator<T> sp) {
    Spliterator<T> split = sp.trySplit();

    List<T> result = new ArrayList<>();
    if (split != null) {
        result.addAll(collectAll(split));
    }
    sp.forEachRemaining(result::add);
    return result;
}
```

Need consider order depending split convention.

## 32.6 Characteristics

Assert expected flags.

## 32.7 Size

Check estimate changes as elements consumed.

## 32.8 Parallel stream

Compare sequential vs parallel result.

## 32.9 Mutation behavior

Test documented assumptions.

## 32.10 Resource closing

Test close handler if stream-backed.

## 32.11 Rule

Test spliterator like infrastructure code.

---

# 33. Production Failure Modes

## 33.1 Reporting SIZED incorrectly

Stream preallocates/optimizes based on wrong size.

Fix: remove SIZED or compute exact size.

## 33.2 Reporting DISTINCT incorrectly

`distinct()` may be optimized away and duplicates leak.

Fix: only report DISTINCT if guaranteed.

## 33.3 Reporting SORTED incorrectly

Sorted assumptions produce wrong results.

Fix: ensure comparator/order correct.

## 33.4 Bad trySplit

Parallel stream slower than sequential.

Fix: balanced splitting or keep sequential.

## 33.5 trySplit duplicates elements

Parallel stream duplicates processing.

Fix: update ranges/state correctly.

## 33.6 trySplit loses elements

Parallel stream misses data.

Fix: test recursive splitting.

## 33.7 Resource-backed stream not closed

File/DB handle leak.

Fix: onClose + try-with-resources.

## 33.8 Mutating source during stream

CME/inconsistent results.

Fix: snapshot or non-interference.

## 33.9 Reporting IMMUTABLE for unmodifiable view

Backing collection mutates.

Fix: report only for true immutability.

## 33.10 Parallel stream over blocking source

Thread starvation/poor performance.

Fix: use dedicated executor/reactive/batch design.

## 33.11 Overusing custom spliterator

Complex bug-prone code where simple iterator/list suffices.

Fix: avoid unless needed.

## 33.12 Generic spliterator for primitive hot path

Boxing overhead.

Fix: primitive spliterator/stream.

---

# 34. Best Practices

## 34.1 General

- Use built-in collection spliterators when possible.
- Understand source characteristics before parallel stream.
- Do not mutate stream source.
- Do not overclaim characteristics.
- Use StreamSupport mainly for custom/library sources.
- Close resource-backed streams.

## 34.2 Parallel

- Parallelize only splittable sources.
- Prefer array/list/range sources for parallel.
- Avoid IO/blocking sources in parallel streams.
- Ensure reduction/collector is parallel-correct.
- Measure with JMH/JFR.

## 34.3 Custom

- Implement tryAdvance correctly.
- Implement forEachRemaining if bulk traversal can optimize.
- Return null from trySplit if cannot split.
- Report exact size only if exact.
- Use primitive specializations for primitives.
- Test splitting recursively.

## 34.4 Characteristics

- ORDERED: defined encounter order.
- DISTINCT: no duplicates.
- SORTED: sorted by comparator/natural.
- SIZED: exact remaining size.
- NONNULL: no nulls.
- IMMUTABLE: source cannot structurally change.
- CONCURRENT: safe concurrent modification.
- SUBSIZED: all splits sized.

---

# 35. Decision Matrix

| Requirement | Recommended |
|---|---|
| normal collection stream | use `collection.stream()` |
| custom source stream | `StreamSupport.stream(spliterator, false)` |
| custom parallel source | implement high-quality `trySplit` |
| cannot split source | sequential stream only |
| resource-backed source | stream with `onClose` + try-with-resources |
| known exact size | report `SIZED` |
| all splits exact size | report `SUBSIZED` |
| source order meaningful | report `ORDERED` |
| no duplicates guaranteed | report `DISTINCT` |
| sorted traversal | report `SORTED` and comparator |
| no null guaranteed | report `NONNULL` |
| source immutable | report `IMMUTABLE` |
| concurrent modification safe | report `CONCURRENT` |
| primitive high-volume | use `Spliterator.OfInt/Long/Double` |
| uncertain characteristic | do not report it |

---

# 36. Latihan

## Latihan 1 — Iterator vs Spliterator

Jelaskan perbedaan:

```text
Iterator
Spliterator
```

dengan contoh kapan Iterator tidak cukup.

## Latihan 2 — Characteristics

Untuk source berikut, tentukan characteristics yang aman:

1. `ArrayList<String>`;
2. `HashSet<String>`;
3. `TreeSet<Integer>`;
4. immutable non-null sorted list;
5. database cursor;
6. generated infinite sequence.

## Latihan 3 — BatchSpliterator

Implement `BatchSpliterator<T>` dan test:

- empty list;
- 1 item;
- 10 items batch size 3;
- parallel stream result.

## Latihan 4 — Broken trySplit

Buat trySplit yang salah dan menyebabkan duplicate/missing elements. Tulis test yang menangkap bug.

## Latihan 5 — Resource-backed Spliterator

Design Spliterator untuk file records:

- sequential only;
- closeable stream;
- parse exception strategy.

## Latihan 6 — Parallel Performance

Benchmark:

- ArrayList parallel stream;
- LinkedList parallel stream;
- generated stream parallel.

Bandingkan.

## Latihan 7 — SIZED Lie

Buat spliterator yang report SIZED tapi estimate salah. Amati behavior pada `toArray` atau collect. Jelaskan risikonya.

## Latihan 8 — Primitive Spliterator

Implement simple `Spliterator.OfInt` for integer range.

Compare dengan boxed `Spliterator<Integer>`.

---

# 37. Ringkasan

Spliterator adalah fondasi Stream API.

Core lessons:

- Spliterator = traversal + partitioning + metadata.
- `tryAdvance` processes one element.
- `forEachRemaining` processes remaining elements.
- `trySplit` partitions source for parallelism.
- `estimateSize` guides planning.
- characteristics are promises.
- ORDERED means encounter order.
- DISTINCT means no duplicates.
- SORTED means sorted traversal.
- SIZED means exact remaining size.
- NONNULL means no null elements.
- IMMUTABLE means source cannot structurally change.
- CONCURRENT means safe concurrent modification.
- SUBSIZED means splits are also sized.
- Stream performance/correctness depends on source spliterator.
- Custom spliterators are powerful but risky.
- Parallel stream requires good splitting and correct reduction.
- Resource-backed spliterators require explicit close strategy.

Main rule:

```text
A Spliterator is not just a fancy Iterator.
It is the contract that tells Stream how to traverse, split, and optimize a source.
```

---

# 38. Referensi

1. Java SE 25 — `Spliterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterator.html

2. Java SE 25 — `Spliterators`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterators.html

3. Java SE 25 — `Spliterators.AbstractSpliterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterators.AbstractSpliterator.html

4. Java SE 25 — `StreamSupport`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/StreamSupport.html

5. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

6. Java SE 25 — `Collection.spliterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html#spliterator()

7. Java SE 25 — `Iterable.spliterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Iterable.html#spliterator()

8. Java SE 25 — `ArrayList.spliterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayList.html#spliterator()

9. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

10. Java SE 25 — `java.util.stream` Package Summary  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Collections and Streams — Part 007](./learn-java-collections-and-streams-part-007.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Collections and Streams — Part 009](./learn-java-collections-and-streams-part-009.md)

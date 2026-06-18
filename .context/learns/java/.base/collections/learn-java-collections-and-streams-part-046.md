# learn-java-collections-and-streams-part-046.md

# Java Collections and Streams — Part 046  
# Custom Spliterators: `tryAdvance`, `trySplit`, Characteristics, Late Binding, Parallel Splitting, StreamSupport, Primitive Spliterators, and Production-Grade Stream Sources

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **046**  
> Fokus: memahami cara membuat custom `Spliterator` secara benar. Kita akan membedah traversal, partitioning, `tryAdvance`, `forEachRemaining`, `trySplit`, `estimateSize`, `characteristics`, `ORDERED`, `SIZED`, `SUBSIZED`, `IMMUTABLE`, `CONCURRENT`, `NONNULL`, late-binding, fail-fast, `StreamSupport`, primitive spliterators, batching, chunking, line/token parsing, dan kapan custom spliterator sebaiknya dihindari.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Spliterator = Iterator + Split Metadata](#2-mental-model-spliterator--iterator--split-metadata)
3. [Kapan Butuh Custom Spliterator?](#3-kapan-butuh-custom-spliterator)
4. [Kapan Tidak Perlu Custom Spliterator?](#4-kapan-tidak-perlu-custom-spliterator)
5. [Core Methods](#5-core-methods)
6. [`tryAdvance`](#6-tryadvance)
7. [`forEachRemaining`](#7-foreachremaining)
8. [`trySplit`](#8-trysplit)
9. [`estimateSize`](#9-estimatesize)
10. [`characteristics`](#10-characteristics)
11. [Characteristic: `ORDERED`](#11-characteristic-ordered)
12. [Characteristic: `DISTINCT`](#12-characteristic-distinct)
13. [Characteristic: `SORTED`](#13-characteristic-sorted)
14. [Characteristic: `SIZED`](#14-characteristic-sized)
15. [Characteristic: `SUBSIZED`](#15-characteristic-subsized)
16. [Characteristic: `NONNULL`](#16-characteristic-nonnull)
17. [Characteristic: `IMMUTABLE`](#17-characteristic-immutable)
18. [Characteristic: `CONCURRENT`](#18-characteristic-concurrent)
19. [Late Binding vs Early Binding](#19-late-binding-vs-early-binding)
20. [Fail-Fast Behavior](#20-fail-fast-behavior)
21. [Using `StreamSupport.stream`](#21-using-streamsupportstream)
22. [Basic Sequential Spliterator Example](#22-basic-sequential-spliterator-example)
23. [Range Spliterator Example](#23-range-spliterator-example)
24. [Batching Spliterator Example](#24-batching-spliterator-example)
25. [Chunking a List](#25-chunking-a-list)
26. [Line/Token Spliterator Design](#26-linetoken-spliterator-design)
27. [Primitive Spliterators](#27-primitive-spliterators)
28. [`Spliterator.OfInt`, `OfLong`, `OfDouble`](#28-spliteratorofint-oflong-ofdouble)
29. [`Spliterators.AbstractSpliterator`](#29-spliteratorsabstractspliterator)
30. [Parallel Splitting Quality](#30-parallel-splitting-quality)
31. [Balanced vs Unbalanced Splits](#31-balanced-vs-unbalanced-splits)
32. [Unknown Size Sources](#32-unknown-size-sources)
33. [Resource Management](#33-resource-management)
34. [Thread Safety](#34-thread-safety)
35. [Testing Custom Spliterators](#35-testing-custom-spliterators)
36. [Performance Diagnostics](#36-performance-diagnostics)
37. [Common Anti-Patterns](#37-common-anti-patterns)
38. [Production Failure Modes](#38-production-failure-modes)
39. [Best Practices](#39-best-practices)
40. [Decision Matrix](#40-decision-matrix)
41. [Latihan](#41-latihan)
42. [Ringkasan](#42-ringkasan)
43. [Referensi](#43-referensi)

---

# 1. Tujuan Bagian Ini

`Spliterator` adalah salah satu bagian paling penting tapi paling jarang dibuat langsung oleh developer.

Kita sudah belajar bahwa stream punya source.

Source stream bisa berasal dari:

```java
collection.stream()
Arrays.stream(array)
IntStream.range(...)
Files.lines(...)
Stream.generate(...)
StreamSupport.stream(spliterator, parallel)
```

Di balik banyak source, ada `Spliterator`.

`Spliterator` menentukan:

- bagaimana element ditraverse;
- apakah source bisa dibelah untuk parallel execution;
- apakah order diketahui;
- apakah size diketahui;
- apakah element non-null;
- apakah source immutable/concurrent;
- apakah stream framework bisa mengoptimalkan pipeline.

Custom spliterator berguna ketika kamu punya custom data source atau traversal pattern yang tidak cocok dengan existing collection/iterator.

Namun custom spliterator juga rawan bug:

- `tryAdvance` tidak maju;
- `trySplit` menghasilkan overlap;
- split kehilangan element;
- `estimateSize` salah;
- characteristics berbohong;
- `SUBSIZED` salah;
- resource tidak ditutup;
- parallel stream lambat karena split buruk;
- infinite stream tidak bounded;
- fail-fast/concurrent semantics tidak jelas.

Tujuan part ini:

- memahami contract `Spliterator`;
- membuat custom spliterator sederhana;
- memahami splitting untuk parallelism;
- memilih characteristics dengan jujur;
- memahami `StreamSupport`;
- memahami primitive spliterators;
- menghindari production failure modes.

---

# 2. Mental Model: Spliterator = Iterator + Split Metadata

Iterator menjawab:

```text
Apa element berikutnya?
```

Spliterator menjawab:

```text
Apa element berikutnya?
Bisakah source ini dibelah?
Berapa kira-kira sisa element?
Apa karakteristik source ini?
```

## 2.1 Iterator mental model

```java
while (iterator.hasNext()) {
    T item = iterator.next();
}
```

## 2.2 Spliterator mental model

```java
spliterator.tryAdvance(item -> process(item));
```

dan untuk parallel:

```java
Spliterator<T> left = spliterator.trySplit();
Spliterator<T> right = spliterator;
```

## 2.3 Main rule

```text
Spliterator is traversal + partitioning + metadata.
```

---

# 3. Kapan Butuh Custom Spliterator?

Gunakan custom spliterator ketika:

## 3.1 Custom source

Data tidak berada dalam collection biasa.

Contoh:

- generated records;
- token stream;
- paged source;
- compressed data parser;
- custom binary format;
- tree traversal;
- segmented memory buffer;
- domain-specific cursor.

## 3.2 Need lazy traversal

Tidak ingin materialize semua data.

## 3.3 Need stream integration

Ingin source bisa dipakai dengan Stream API.

## 3.4 Need better splitting

Iterator-backed stream tidak cukup untuk parallel.

## 3.5 Need accurate metadata

Size/order/non-null/immutable known and useful.

## 3.6 Rule

Custom spliterator is justified when it models source traversal better than collection/iterator wrappers.

---

# 4. Kapan Tidak Perlu Custom Spliterator?

Hindari custom spliterator jika:

## 4.1 Data sudah collection

```java
list.stream()
```

## 4.2 Bisa pakai existing streams

```java
IntStream.range(...)
Arrays.stream(...)
Files.lines(...)
```

## 4.3 Logic lebih cocok `flatMap`/`mapMulti`

Untuk transformation biasa, jangan custom source.

## 4.4 One-off workflow

Loop lebih jelas.

## 4.5 Parallel not needed

Iterator or generator may be enough.

## 4.6 Rule

Do not write custom spliterator just because it feels advanced.

---

# 5. Core Methods

`Spliterator` core methods:

```java
boolean tryAdvance(Consumer<? super T> action);

default void forEachRemaining(Consumer<? super T> action);

Spliterator<T> trySplit();

long estimateSize();

int characteristics();
```

## 5.1 Optional methods

For sorted spliterators:

```java
Comparator<? super T> getComparator();
```

## 5.2 Rule

Correctness starts with these five methods.

---

# 6. `tryAdvance`

`tryAdvance` attempts to process one next element.

## 6.1 Contract

If element exists:

```text
call action.accept(element)
advance internal cursor
return true
```

If no element:

```text
return false
```

## 6.2 Example

```java
@Override
public boolean tryAdvance(Consumer<? super T> action) {
    if (index >= fence) {
        return false;
    }
    action.accept(array[index++]);
    return true;
}
```

## 6.3 Common bug

Forgetting to increment cursor:

```java
action.accept(array[index]);
return true;
```

This creates infinite stream.

## 6.4 Rule

`tryAdvance` must emit at most one element and advance exactly once when it returns true.

---

# 7. `forEachRemaining`

Default implementation repeatedly calls `tryAdvance`.

You can override for performance.

## 7.1 Example

```java
@Override
public void forEachRemaining(Consumer<? super T> action) {
    while (index < fence) {
        action.accept(array[index++]);
    }
}
```

## 7.2 Benefit

Avoids repeated virtual call overhead.

## 7.3 Rule

Override only if you can preserve same semantics.

---

# 8. `trySplit`

`trySplit` partitions the remaining elements.

## 8.1 Contract

Return a new spliterator covering some portion of remaining elements, and update this spliterator to cover the rest.

If cannot split, return null.

## 8.2 Example half split

```java
int lo = index;
int mid = (lo + fence) >>> 1;

if (lo >= mid) {
    return null;
}

index = mid;
return new ArraySpliterator<>(array, lo, mid);
```

Now returned spliterator covers:

```text
[lo, mid)
```

Current spliterator covers:

```text
[mid, fence)
```

## 8.3 No overlap, no gaps

This is crucial.

## 8.4 Rule

`trySplit` must partition remaining elements without overlap or loss.

---

# 9. `estimateSize`

Returns estimated number of remaining elements.

## 9.1 Exact size

For array range:

```java
return fence - index;
```

## 9.2 Unknown size

Use:

```java
Long.MAX_VALUE
```

or approximate.

## 9.3 If `SIZED`

Estimate must be exact before traversal/splitting.

## 9.4 Rule

Do not claim exact size unless you can maintain it.

---

# 10. `characteristics`

Returns bit set of characteristics.

Example:

```java
return Spliterator.ORDERED
     | Spliterator.SIZED
     | Spliterator.SUBSIZED
     | Spliterator.IMMUTABLE
     | Spliterator.NONNULL;
```

## 10.1 Importance

Stream framework uses characteristics for optimization and semantics.

## 10.2 Danger

Wrong characteristics can cause wrong results.

## 10.3 Rule

Characteristics must describe reality, not hope.

---

# 11. Characteristic: `ORDERED`

Means encounter order is defined.

## 11.1 Example

Array/list range order.

```text
index ascending
```

## 11.2 Not ordered

Hash table traversal if no stable business order.

## 11.3 Rule

Declare `ORDERED` only if encounter order is meaningful and preserved by splitting/traversal.

---

# 12. Characteristic: `DISTINCT`

Means no duplicate elements according to `equals`.

## 12.1 Example

Set spliterator may be distinct.

## 12.2 Danger

Do not declare if duplicate possible.

## 12.3 Rule

`DISTINCT` is about element uniqueness, not key uniqueness or “usually unique”.

---

# 13. Characteristic: `SORTED`

Means encounter order follows sort order.

## 13.1 Need comparator

If sorted by natural order, `getComparator()` returns null.

If custom sorted, return comparator.

## 13.2 Danger

Do not declare `SORTED` just because source is often sorted.

## 13.3 Rule

Declare `SORTED` only if traversal is guaranteed sorted.

---

# 14. Characteristic: `SIZED`

Means `estimateSize()` is exact.

## 14.1 Example

Array segment.

## 14.2 Not SIZED

Unknown iterator, IO stream, filter-like source where remaining count unknown.

## 14.3 Rule

Declare `SIZED` only if exact remaining count is known.

---

# 15. Characteristic: `SUBSIZED`

Means all spliterators produced by `trySplit` are also `SIZED` and `SUBSIZED`.

## 15.1 Example

Array range split into exact subranges.

## 15.2 Danger

If split sizes are approximate, do not declare.

## 15.3 Rule

`SUBSIZED` is a stronger promise than `SIZED`.

---

# 16. Characteristic: `NONNULL`

Means no emitted element is null.

## 16.1 Example

Range boxed integers? If boxed via source, maybe non-null.

Domain record source that rejects null.

## 16.2 Danger

If null can appear, do not declare.

## 16.3 Rule

Declare `NONNULL` only if null is impossible by construction.

---

# 17. Characteristic: `IMMUTABLE`

Means source cannot be structurally modified during traversal.

## 17.1 Example

Immutable array snapshot/source.

## 17.2 Not immutable

Mutable list that can be changed externally.

## 17.3 Rule

Declare `IMMUTABLE` only if source structure cannot change.

---

# 18. Characteristic: `CONCURRENT`

Means source can be safely concurrently modified without external synchronization.

## 18.1 Example

Concurrent collections may have concurrent spliterators.

## 18.2 Not same as thread-safe traversal

Need semantics defined.

## 18.3 Rule

Do not declare `CONCURRENT` unless source is designed for concurrent modification during traversal.

---

# 19. Late Binding vs Early Binding

## 19.1 Early binding

Spliterator binds to source state when created.

## 19.2 Late binding

Spliterator binds when traversal/splitting/size query starts.

Late binding can reflect modifications before traversal begins.

## 19.3 Why it matters

Collection streams often have documented binding/fail-fast behavior.

## 19.4 Rule

Document whether your spliterator snapshots early or reads late.

---

# 20. Fail-Fast Behavior

Fail-fast spliterator detects structural modification and throws.

Example concept:

```java
if (expectedModCount != source.modCount()) {
    throw new ConcurrentModificationException();
}
```

## 20.1 Best effort

Fail-fast is usually best-effort bug detection, not correctness mechanism.

## 20.2 Custom source

If source mutable, decide:

- snapshot;
- fail-fast;
- weakly consistent;
- external synchronization.

## 20.3 Rule

Mutable source spliterator must define modification semantics.

---

# 21. Using `StreamSupport.stream`

Create stream from spliterator:

```java
Stream<T> stream = StreamSupport.stream(spliterator, false);
```

Parallel:

```java
Stream<T> stream = StreamSupport.stream(spliterator, true);
```

## 21.1 Lazy traversal

The spliterator is traversed/split/queried after terminal operation begins.

## 21.2 Example

```java
Stream<Record> records = StreamSupport.stream(
    new RecordSpliterator(source),
    false
);
```

## 21.3 Rule

`StreamSupport` is the bridge from custom Spliterator to Stream API.

---

# 22. Basic Sequential Spliterator Example

Simple spliterator over array segment:

```java
final class ArraySegmentSpliterator<T> implements Spliterator<T> {
    private final T[] array;
    private int index;
    private final int fence;

    ArraySegmentSpliterator(T[] array, int origin, int fence) {
        this.array = Objects.requireNonNull(array);
        this.index = origin;
        this.fence = fence;
    }

    @Override
    public boolean tryAdvance(Consumer<? super T> action) {
        Objects.requireNonNull(action);
        if (index >= fence) {
            return false;
        }
        action.accept(array[index++]);
        return true;
    }

    @Override
    public Spliterator<T> trySplit() {
        return null; // sequential only
    }

    @Override
    public long estimateSize() {
        return fence - index;
    }

    @Override
    public int characteristics() {
        return ORDERED | SIZED | NONNULL;
    }
}
```

## 22.1 Problem

If array can contain null, `NONNULL` is wrong.

If no split, parallel stream has poor parallelism.

## 22.2 Rule

Even simple spliterators require honest characteristics.

---

# 23. Range Spliterator Example

A splittable integer range:

```java
final class IntRangeSpliterator implements Spliterator.OfInt {
    private int current;
    private final int endExclusive;

    IntRangeSpliterator(int startInclusive, int endExclusive) {
        this.current = startInclusive;
        this.endExclusive = endExclusive;
    }

    @Override
    public boolean tryAdvance(IntConsumer action) {
        Objects.requireNonNull(action);
        if (current >= endExclusive) {
            return false;
        }
        action.accept(current++);
        return true;
    }

    @Override
    public Spliterator.OfInt trySplit() {
        int lo = current;
        int mid = (lo + endExclusive) >>> 1;
        if (lo >= mid) {
            return null;
        }
        current = mid;
        return new IntRangeSpliterator(lo, mid);
    }

    @Override
    public long estimateSize() {
        return endExclusive - current;
    }

    @Override
    public int characteristics() {
        return ORDERED | SIZED | SUBSIZED | IMMUTABLE | NONNULL | SORTED | DISTINCT;
    }

    @Override
    public Comparator<? super Integer> getComparator() {
        return null; // natural order
    }
}
```

## 23.1 Note

Primitive spliterator avoids boxing during traversal.

## 23.2 Rule

Range is ideal for demonstrating balanced splitting.

---

# 24. Batching Spliterator Example

Sometimes you want stream of batches:

```java
Stream<List<T>>
```

from source list.

```java
final class BatchSpliterator<T> implements Spliterator<List<T>> {
    private final List<T> source;
    private final int batchSize;
    private int index;

    BatchSpliterator(List<T> source, int batchSize) {
        this.source = Objects.requireNonNull(source);
        if (batchSize <= 0) {
            throw new IllegalArgumentException("batchSize must be > 0");
        }
        this.batchSize = batchSize;
    }

    @Override
    public boolean tryAdvance(Consumer<? super List<T>> action) {
        Objects.requireNonNull(action);
        if (index >= source.size()) {
            return false;
        }
        int end = Math.min(index + batchSize, source.size());
        List<T> batch = List.copyOf(source.subList(index, end));
        index = end;
        action.accept(batch);
        return true;
    }

    @Override
    public Spliterator<List<T>> trySplit() {
        return null; // keep sequential for simple batching semantics
    }

    @Override
    public long estimateSize() {
        int remaining = source.size() - index;
        return (remaining + batchSize - 1L) / batchSize;
    }

    @Override
    public int characteristics() {
        return ORDERED | SIZED | NONNULL;
    }
}
```

## 24.1 Use

```java
Stream<List<T>> batches = StreamSupport.stream(
    new BatchSpliterator<>(items, 100),
    false
);
```

## 24.2 Rule

Batching spliterator is useful for chunked processing but be clear about copy/view semantics.

---

# 25. Chunking a List

For chunking a list, often simpler:

```java
IntStream.iterate(0, i -> i < list.size(), i -> i + batchSize)
    .mapToObj(i -> list.subList(i, Math.min(i + batchSize, list.size())))
```

## 25.1 But subList is view

If you need immutable snapshot:

```java
List.copyOf(...)
```

## 25.2 Custom spliterator justified if

- reused often;
- needs stream abstraction;
- handles resource;
- has custom splitting;
- must hide chunking details.

## 25.3 Rule

Prefer simple stream/loop unless custom spliterator gives clear value.

---

# 26. Line/Token Spliterator Design

Suppose you parse tokens from large input.

Design choices:

## 26.1 Source

- `Reader`;
- `CharBuffer`;
- `ByteBuffer`;
- memory-mapped file;
- existing String.

## 26.2 Size

Usually unknown token count.

Do not declare `SIZED`.

## 26.3 Order

Tokens usually ordered.

Declare `ORDERED`.

## 26.4 Null

Tokens likely non-null.

Declare `NONNULL` if guaranteed.

## 26.5 Split

Hard for Reader because arbitrary split can break token boundaries.

## 26.6 Rule

Token spliterators are often sequential unless you can split safely at boundaries.

---

# 27. Primitive Spliterators

Primitive spliterators avoid boxing:

```java
Spliterator.OfInt
Spliterator.OfLong
Spliterator.OfDouble
```

## 27.1 Use for numeric source

- ranges;
- primitive arrays;
- numeric parser;
- time series values.

## 27.2 Benefit

Less allocation and better primitive stream integration.

## 27.3 Rule

If your source emits primitives, implement primitive spliterator.

---

# 28. `Spliterator.OfInt`, `OfLong`, `OfDouble`

They specialize:

```java
tryAdvance(IntConsumer)
tryAdvance(LongConsumer)
tryAdvance(DoubleConsumer)
```

## 28.1 Example use

```java
IntStream stream = StreamSupport.intStream(
    new IntRangeSpliterator(0, 1_000_000),
    true
);
```

## 28.2 Rule

Primitive streams should be backed by primitive spliterators for best performance.

---

# 29. `Spliterators.AbstractSpliterator`

`Spliterators.AbstractSpliterator` helps implement spliterator when efficient partitioning is difficult.

You implement:

```java
tryAdvance
```

and it provides limited `trySplit`.

## 29.1 Use case

Unknown-size source where limited parallelism is okay.

## 29.2 Caveat

If you can implement better splitting, do it yourself.

## 29.3 Rule

Use `AbstractSpliterator` for convenience, not maximum parallel performance.

---

# 30. Parallel Splitting Quality

Good splitting:

- balanced;
- cheap;
- no overlap;
- no gaps;
- preserves order if ordered;
- exact sizes if sized/subsized;
- does not require reading all data first.

## 30.1 Bad splitting

- always returns tiny chunks;
- always returns huge uneven chunks;
- scans linearly to split;
- splits at invalid boundaries;
- creates shared mutable cursors;
- loses elements.

## 30.2 Rule

Parallel stream performance is only as good as `trySplit`.

---

# 31. Balanced vs Unbalanced Splits

Balanced split:

```text
1000 -> 500 + 500
```

Unbalanced split:

```text
1000 -> 1 + 999
```

## 31.1 Problem

Unbalanced splits cause poor load distribution.

## 31.2 Some sources naturally unbalanced

Tree traversal if tree skewed.

## 31.3 Rule

Aim for roughly balanced splitting when parallel use matters.

---

# 32. Unknown Size Sources

Unknown-size source:

- iterator;
- scanner;
- socket;
- reader;
- generator.

## 32.1 Characteristics

Do not declare:

```java
SIZED
SUBSIZED
```

## 32.2 Splitting

Can batch into chunks for limited parallelism.

## 32.3 Rule

Unknown size is okay; lying about size is not.

---

# 33. Resource Management

If spliterator owns resource, stream should close it.

## 33.1 Use onClose

```java
Stream<T> stream = StreamSupport.stream(spliterator, false)
    .onClose(resource::close);
```

## 33.2 try-with-resources

```java
try (Stream<T> stream = openStream()) {
    ...
}
```

## 33.3 Danger

If caller forgets close, resource leaks.

## 33.4 Rule

Resource-backed custom streams must define close ownership clearly.

---

# 34. Thread Safety

Spliterators are generally not designed for arbitrary concurrent calls unless specified.

Parallel stream framework uses split spliterators in separate tasks.

## 34.1 Do not share mutable cursor across splits

Bad:

```java
all splits reference same cursor
```

## 34.2 Each split needs independent range/state

Good:

```java
new split has [lo, mid)
current has [mid, hi)
```

## 34.3 Rule

After splitting, each spliterator must own independent traversal state.

---

# 35. Testing Custom Spliterators

Test:

## 35.1 Sequential traversal

All elements emitted exactly once.

## 35.2 forEachRemaining

Same as repeated tryAdvance.

## 35.3 trySplit

No overlap, no loss.

## 35.4 estimateSize

Decreases correctly.

## 35.5 characteristics

Match behavior.

## 35.6 StreamSupport sequential

Correct stream result.

## 35.7 StreamSupport parallel

Same result for ordered/unordered semantics.

## 35.8 Edge cases

Empty, one element, odd size, nulls, boundaries.

## 35.9 Rule

Custom spliterator tests must directly test splitting.

---

# 36. Performance Diagnostics

Check:

## 36.1 Split count

Is it enough for parallelism?

## 36.2 Split balance

Are chunks equal-ish?

## 36.3 Traversal overhead

Is tryAdvance too expensive?

## 36.4 Boxing

Can primitive spliterator help?

## 36.5 Characteristics

Are you missing useful `SIZED`/`SUBSIZED`?

## 36.6 Resource bottleneck

Is source IO-bound?

## 36.7 Rule

Profile splitting, traversal, and downstream processing separately.

---

# 37. Common Anti-Patterns

## 37.1 `tryAdvance` does not advance

Infinite stream.

## 37.2 `trySplit` overlap

Duplicates.

## 37.3 `trySplit` gaps

Missing elements.

## 37.4 Wrong `SIZED`

Incorrect optimization.

## 37.5 Wrong `SUBSIZED`

Parallel bugs/performance issues.

## 37.6 Declaring `NONNULL` with possible null

Wrong.

## 37.7 Declaring `ORDERED` but split breaks order

Wrong.

## 37.8 Returning null action behavior

Should reject null action with NPE.

## 37.9 Resource stream without close

Leak.

## 37.10 Custom spliterator for simple list mapping

Overengineering.

---

# 38. Production Failure Modes

## 38.1 Infinite loop

Cause: cursor not advanced.

## 38.2 Duplicate records

Cause: split overlap.

## 38.3 Missing records

Cause: split gaps.

## 38.4 Wrong parallel result

Cause: shared state between splits.

## 38.5 OOM

Cause: wrong estimate/collection preallocation or infinite traversal.

## 38.6 File descriptor leak

Cause: resource-backed stream not closed.

## 38.7 Slow parallel stream

Cause: poor trySplit.

## 38.8 Order bug

Cause: wrong ORDERED/SORTED characteristic.

## 38.9 NPE downstream

Cause: false NONNULL.

## 38.10 Flaky behavior under mutation

Cause: no fail-fast/snapshot/concurrent semantics.

---

# 39. Best Practices

## 39.1 Prefer existing sources first

Collection, arrays, ranges, Files APIs.

## 39.2 Make tryAdvance simple and correct

One element, advance once.

## 39.3 Implement trySplit only if you can do it correctly

Sequential spliterator is better than wrong parallel split.

## 39.4 Be conservative with characteristics

Underpromise rather than lie.

## 39.5 Use primitive spliterators for primitives

Avoid boxing.

## 39.6 Ensure split state independence

No shared cursor.

## 39.7 Define resource ownership

Use `onClose` and try-with-resources.

## 39.8 Test splitting directly

Not only stream result.

## 39.9 Benchmark parallel benefit

Custom splitting does not guarantee speedup.

## 39.10 Document semantics

Order, null, size, mutability, concurrency.

---

# 40. Decision Matrix

| Situation | Recommendation |
|---|---|
| source is List/Set/Map | use built-in spliterator |
| source is array/range | use Arrays/IntStream/LongStream |
| custom lazy source | custom spliterator possible |
| one-off procedural read | loop |
| unknown size iterator | `spliteratorUnknownSize` or `AbstractSpliterator` |
| needs parallel performance | implement balanced `trySplit` |
| cannot split safely | sequential spliterator |
| emits primitives | primitive spliterator |
| owns resource | stream with `onClose`; caller uses try-with-resources |
| token parser over Reader | likely ORDERED/NONNULL, not SIZED, sequential |
| array segment | ORDERED/SIZED/SUBSIZED possible |
| source mutable | snapshot, fail-fast, or define concurrent semantics |
| null possible | do not declare NONNULL |
| order not guaranteed | do not declare ORDERED |
| sorted guaranteed | declare SORTED and implement comparator correctly |
| simple transformation | use stream ops, not custom spliterator |

---

# 41. Latihan

## Latihan 1 — Array Segment Spliterator

Implement array segment spliterator with `tryAdvance`.

## Latihan 2 — Add trySplit

Add balanced `trySplit` to array segment spliterator.

## Latihan 3 — Test Split Correctness

Manually split and verify no overlap/no gaps.

## Latihan 4 — Wrong NONNULL

Create source with null and explain why `NONNULL` is wrong.

## Latihan 5 — Batch Spliterator

Create stream of batches from list.

## Latihan 6 — Primitive Range

Implement `Spliterator.OfInt` for range.

## Latihan 7 — Token Spliterator Design

Design characteristics for token parser over Reader.

## Latihan 8 — Resource Close

Create custom stream with `onClose`.

## Latihan 9 — Parallel Benchmark

Compare good balanced split vs no split.

## Latihan 10 — Characteristics Review

Given a custom source, decide characteristics honestly.

---

# 42. Ringkasan

Custom spliterator is advanced source design.

Core lessons:

- Spliterator is iterator plus splitting plus metadata.
- `tryAdvance` emits at most one element and advances state.
- `forEachRemaining` can optimize bulk traversal.
- `trySplit` must partition remaining elements with no overlap/no gaps.
- `estimateSize` must be exact if `SIZED` is declared.
- `SUBSIZED` is a strong promise for split spliterators.
- Characteristics must be truthful.
- `ORDERED`, `DISTINCT`, `SORTED`, `SIZED`, `SUBSIZED`, `NONNULL`, `IMMUTABLE`, and `CONCURRENT` all affect semantics/optimization.
- `StreamSupport.stream` bridges spliterator to Stream.
- Primitive spliterators avoid boxing.
- `AbstractSpliterator` helps when efficient splitting is difficult.
- Parallel performance depends heavily on split quality.
- Unknown-size sources should not claim sized characteristics.
- Resource-backed custom streams must define close ownership.
- Split states must be independent.
- Test splitting directly.

Main rule:

```text
A custom spliterator is correct only if traversal, splitting,
size estimation, characteristics, resource ownership, and mutation semantics
are all honest and tested.
```

---

# 43. Referensi

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

6. Java SE 25 — `IntStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.html

7. Java SE 25 — `PrimitiveIterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PrimitiveIterator.html

8. Java SE 25 — `ConcurrentModificationException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ConcurrentModificationException.html

9. Java SE 25 — `Iterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Iterator.html

10. OpenJDK — Spliterators source  
    https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/Spliterators.java

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-045.md](./learn-java-collections-and-streams-part-045.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-047.md](./learn-java-collections-and-streams-part-047.md)

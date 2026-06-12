# learn-java-collections-and-streams-part-028.md

# Java Collections and Streams — Part 028  
# Primitive Streams: IntStream, LongStream, DoubleStream, Boxing Cost, Numeric Pipelines, Ranges, Summary Statistics, OptionalInt, Precision, and Production Patterns

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **028**  
> Fokus: memahami primitive streams (`IntStream`, `LongStream`, `DoubleStream`) sebagai spesialisasi stream untuk numeric processing tanpa boxing overhead. Kita akan membahas creation, conversion, map/filter/flatMap primitive, reductions, summary statistics, Optional primitive, precision pitfalls, range sources, arrays, performance, dan kapan loop tetap lebih tepat.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Primitive Stream Menghindari Boxing](#2-mental-model-primitive-stream-menghindari-boxing)
3. [Kenapa Hanya `int`, `long`, dan `double`](#3-kenapa-hanya-int-long-dan-double)
4. [`Stream<Integer>` vs `IntStream`](#4-streaminteger-vs-intstream)
5. [`IntStream`](#5-intstream)
6. [`LongStream`](#6-longstream)
7. [`DoubleStream`](#7-doublestream)
8. [Creating Primitive Streams](#8-creating-primitive-streams)
9. [Ranges: `range` and `rangeClosed`](#9-ranges-range-and-rangeclosed)
10. [Primitive Arrays](#10-primitive-arrays)
11. [`of`, `empty`, `builder`, `generate`, `iterate`](#11-of-empty-builder-generate-iterate)
12. [Mapping from Object Stream to Primitive Stream](#12-mapping-from-object-stream-to-primitive-stream)
13. [Mapping from Primitive Stream to Object Stream](#13-mapping-from-primitive-stream-to-object-stream)
14. [Boxing and Unboxing](#14-boxing-and-unboxing)
15. [Primitive Intermediate Operations](#15-primitive-intermediate-operations)
16. [Primitive Terminal Operations](#16-primitive-terminal-operations)
17. [`sum`, `average`, `min`, `max`, `count`](#17-sum-average-min-max-count)
18. [`summaryStatistics`](#18-summarystatistics)
19. [`OptionalInt`, `OptionalLong`, `OptionalDouble`](#19-optionalint-optionallong-optionaldouble)
20. [`mapToObj`, `boxed`, and Object Projection](#20-maptoobj-boxed-and-object-projection)
21. [`asLongStream`, `asDoubleStream`](#21-aslongstream-asdoublestream)
22. [`flatMapToInt`, `flatMapToLong`, `flatMapToDouble`](#22-flatmaptoint-flatmaptolong-flatmaptodouble)
23. [`mapMultiToInt`, `mapMultiToLong`, `mapMultiToDouble`](#23-mapmultitoint-mapmultitolong-mapmultitodouble)
24. [Precision and Overflow](#24-precision-and-overflow)
25. [BigDecimal and Money Warning](#25-bigdecimal-and-money-warning)
26. [Parallel Primitive Streams](#26-parallel-primitive-streams)
27. [Primitive Streams vs Loops](#27-primitive-streams-vs-loops)
28. [Performance Cost Model](#28-performance-cost-model)
29. [Common Anti-Patterns](#29-common-anti-patterns)
30. [Production Failure Modes](#30-production-failure-modes)
31. [Best Practices](#31-best-practices)
32. [Decision Matrix](#32-decision-matrix)
33. [Latihan](#33-latihan)
34. [Ringkasan](#34-ringkasan)
35. [Referensi](#35-referensi)

---

# 1. Tujuan Bagian Ini

Stream API memiliki object stream:

```java
Stream<T>
```

Tetapi untuk angka, Java menyediakan primitive stream:

```java
IntStream
LongStream
DoubleStream
```

Kenapa?

Karena ini:

```java
Stream<Integer>
```

berarti element adalah object reference `Integer`, bukan primitive `int`.

Sedangkan ini:

```java
IntStream
```

memproses primitive `int` secara langsung.

Untuk numeric-heavy processing, perbedaan ini penting:

- mengurangi boxing/unboxing;
- mengurangi allocation;
- menyediakan terminal numeric seperti `sum`, `average`, `summaryStatistics`;
- menyediakan ranges;
- lebih cocok untuk arrays primitive;
- sering lebih efficient untuk numeric aggregation.

Tujuan part ini:

- memahami primitive streams;
- memahami boxing cost;
- tahu kapan pakai `IntStream`/`LongStream`/`DoubleStream`;
- memahami conversion object <-> primitive;
- memahami numeric reductions;
- memahami precision/overflow pitfalls;
- memilih stream atau loop secara tepat.

---

# 2. Mental Model: Primitive Stream Menghindari Boxing

## 2.1 Object stream of integers

```java
Stream<Integer>
```

Element-nya object:

```text
Integer object/reference
```

Even if value looks like number, stream pipeline moves object references.

## 2.2 Primitive stream

```java
IntStream
```

Element-nya primitive int value:

```text
int value
```

## 2.3 Why this matters

Boxing creates/wraps primitive into object.

Unboxing extracts primitive from wrapper.

```java
Integer boxed = 42; // boxing
int value = boxed;  // unboxing
```

## 2.4 In pipelines

```java
orders.stream()
    .map(Order::quantity) // Stream<Integer> if quantity boxed
    .reduce(0, Integer::sum)
```

can involve boxed values.

Better:

```java
orders.stream()
    .mapToInt(Order::quantity)
    .sum()
```

## 2.5 Rule

```text
Use primitive streams when the core data is numeric primitive and you aggregate numerically.
```

---

# 3. Kenapa Hanya `int`, `long`, dan `double`

Java provides primitive stream specializations for:

```java
IntStream
LongStream
DoubleStream
```

Not for:

```java
byte
short
char
float
boolean
```

## 3.1 Practical reason

Most numeric aggregate operations in Java are naturally represented by int, long, double.

## 3.2 Smaller primitives

`byte`, `short`, and `char` can be represented in `IntStream`.

## 3.3 Float

Can be represented in `DoubleStream` in many computations, although precision semantics differ.

## 3.4 Boolean

Boolean stream is usually modeled as object stream or counted/matched via predicates.

## 3.5 Rule

Use IntStream for int-like values, LongStream for long-like values, DoubleStream for floating-point computations.

---

# 4. `Stream<Integer>` vs `IntStream`

## 4.1 Example object stream

```java
List<Integer> values = List.of(1, 2, 3);

int sum = values.stream()
    .reduce(0, Integer::sum);
```

## 4.2 Primitive stream

```java
int sum = values.stream()
    .mapToInt(Integer::intValue)
    .sum();
```

## 4.3 Differences

| Aspect | `Stream<Integer>` | `IntStream` |
|---|---|---|
| element type | object reference | primitive int |
| boxing | yes likely | avoided |
| numeric terminals | generic reduce | sum/average/stats |
| Optional type | Optional<Integer> | OptionalInt |
| arrays | Integer[] | int[] |
| memory | more overhead | lower |
| null possibility | yes | no null element |

## 4.4 Rule

If you are doing math, use primitive stream.

---

# 5. `IntStream`

`IntStream` is stream of primitive `int` values.

## 5.1 Good for

- counts;
- indexes;
- integer ranges;
- int arrays;
- quantities;
- scores;
- small IDs when int is enough.

## 5.2 Creation

```java
IntStream.of(1, 2, 3)
IntStream.range(0, 10)
Arrays.stream(new int[] {1, 2, 3})
```

## 5.3 Numeric terminal

```java
sum
average
min
max
summaryStatistics
```

## 5.4 Rule

Use IntStream for integer computations where int range is sufficient.

---

# 6. `LongStream`

`LongStream` is stream of primitive `long` values.

## 6.1 Good for

- large counters;
- timestamps;
- IDs;
- file sizes;
- durations;
- totals that may exceed int.

## 6.2 Creation

```java
LongStream.of(1L, 2L, 3L)
LongStream.range(0L, 1_000_000L)
Arrays.stream(new long[] {1L, 2L})
```

## 6.3 Numeric terminal

```java
sum
average
min
max
summaryStatistics
```

## 6.4 Rule

Use LongStream when int overflow is possible or domain is long-valued.

---

# 7. `DoubleStream`

`DoubleStream` is stream of primitive `double` values.

## 7.1 Good for

- measurements;
- statistics;
- averages;
- scientific/engineering calculations;
- approximate numeric data.

## 7.2 Creation

```java
DoubleStream.of(1.0, 2.5, 3.2)
Arrays.stream(new double[] {1.0, 2.0})
```

## 7.3 Numeric terminal

```java
sum
average
min
max
summaryStatistics
```

## 7.4 Floating-point warning

Double arithmetic is not exact decimal arithmetic.

Do not use for money.

## 7.5 Rule

Use DoubleStream for approximate floating-point calculations, not exact decimal money.

---

# 8. Creating Primitive Streams

## 8.1 of

```java
IntStream.of(1, 2, 3)
LongStream.of(1L, 2L, 3L)
DoubleStream.of(1.0, 2.0)
```

## 8.2 arrays

```java
Arrays.stream(intArray)
Arrays.stream(longArray)
Arrays.stream(doubleArray)
```

## 8.3 ranges

```java
IntStream.range(0, n)
LongStream.rangeClosed(1, n)
```

## 8.4 mapping from object

```java
users.stream().mapToInt(User::age)
```

## 8.5 generate/iterate

```java
IntStream.generate(random::nextInt)
IntStream.iterate(0, i -> i + 1)
```

## 8.6 Rule

Choose source that matches numeric data shape: array/range/object mapping/generator.

---

# 9. Ranges: `range` and `rangeClosed`

Ranges are one of the strongest primitive stream features.

## 9.1 Exclusive end

```java
IntStream.range(0, 5)
```

Produces:

```text
0, 1, 2, 3, 4
```

## 9.2 Inclusive end

```java
IntStream.rangeClosed(0, 5)
```

Produces:

```text
0, 1, 2, 3, 4, 5
```

## 9.3 Index loop replacement

```java
IntStream.range(0, list.size())
    .mapToObj(i -> new IndexedValue<>(i, list.get(i)))
    .toList();
```

## 9.4 Parallel splitting

Ranges split well for parallel processing.

## 9.5 Rule

Use ranges for numeric sequences and indexes; prefer range over iterate for simple counting.

---

# 10. Primitive Arrays

Primitive arrays work directly with primitive streams.

## 10.1 int array

```java
int[] values = {1, 2, 3};
int sum = Arrays.stream(values).sum();
```

## 10.2 long array

```java
long max = Arrays.stream(fileSizes).max().orElse(0L);
```

## 10.3 double array

```java
double avg = Arrays.stream(samples).average().orElse(Double.NaN);
```

## 10.4 Slice

```java
Arrays.stream(values, from, to)
```

## 10.5 Rule

For primitive arrays, use `Arrays.stream(array)`, not `Stream.of(array)`.

---

# 11. `of`, `empty`, `builder`, `generate`, `iterate`

## 11.1 empty

```java
IntStream.empty()
```

## 11.2 of

```java
IntStream.of(10, 20, 30)
```

## 11.3 builder

```java
IntStream.Builder b = IntStream.builder();
b.add(1);
b.add(2);
IntStream s = b.build();
```

## 11.4 generate

```java
IntStream.generate(() -> ThreadLocalRandom.current().nextInt(100))
    .limit(10)
```

## 11.5 iterate

```java
IntStream.iterate(1, n -> n * 2)
    .limit(10)
```

## 11.6 Finite iterate

```java
IntStream.iterate(1, n -> n <= 100, n -> n + 1)
```

## 11.7 Rule

Use generate/iterate only with bounding strategy unless terminal short-circuits.

---

# 12. Mapping from Object Stream to Primitive Stream

Use:

```java
mapToInt
mapToLong
mapToDouble
```

## 12.1 Example

```java
int totalQuantity = orders.stream()
    .mapToInt(Order::quantity)
    .sum();
```

## 12.2 Long example

```java
long totalBytes = files.stream()
    .mapToLong(FileInfo::sizeBytes)
    .sum();
```

## 12.3 Double example

```java
double avgScore = students.stream()
    .mapToDouble(Student::score)
    .average()
    .orElse(0.0);
```

## 12.4 Rule

Convert to primitive stream as soon as pipeline becomes numeric.

---

# 13. Mapping from Primitive Stream to Object Stream

Use:

```java
mapToObj
```

## 13.1 Example

```java
List<String> labels = IntStream.range(0, 5)
    .mapToObj(i -> "item-" + i)
    .toList();
```

## 13.2 Use case

- generate DTOs from indexes;
- label numeric ranges;
- convert primitive calculations to objects.

## 13.3 Rule

Use `mapToObj` when leaving numeric domain to object domain.

---

# 14. Boxing and Unboxing

## 14.1 Boxing

```java
IntStream.range(0, 10)
    .boxed()
```

converts to:

```java
Stream<Integer>
```

## 14.2 Unboxing

```java
Stream<Integer> s = ...
s.mapToInt(Integer::intValue)
```

## 14.3 Cost

Boxing can create object overhead and pressure memory/GC.

Some small Integer values may be cached, but do not design around that.

## 14.4 Rule

Avoid boxing in hot numeric pipelines.

---

# 15. Primitive Intermediate Operations

Primitive streams have many familiar operations:

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
```

## 15.1 Primitive mapper

```java
IntStream.range(0, 10)
    .map(i -> i * i)
```

## 15.2 Primitive predicate

```java
.filter(i -> i % 2 == 0)
```

## 15.3 Primitive flatMap

```java
.flatMap(i -> IntStream.range(0, i))
```

## 15.4 Rule

Primitive intermediate operations avoid wrapper object functional types where possible.

---

# 16. Primitive Terminal Operations

Primitive streams add numeric terminals:

```java
sum
average
summaryStatistics
```

They also have:

```java
count
min
max
reduce
collect
forEach
toArray
anyMatch
allMatch
noneMatch
findFirst
findAny
```

## 16.1 Specialized Optional

`min`, `max`, `average`, `findFirst`, `findAny`, reduce without identity return primitive Optional variants.

## 16.2 Rule

Primitive streams combine general stream semantics with numeric-specific terminals.

---

# 17. `sum`, `average`, `min`, `max`, `count`

## 17.1 sum

```java
int total = IntStream.of(1, 2, 3).sum();
```

## 17.2 average

```java
OptionalDouble avg = IntStream.of(1, 2, 3).average();
```

Average returns OptionalDouble because stream may be empty.

## 17.3 min/max

```java
OptionalInt min = IntStream.of(5, 2, 9).min();
```

## 17.4 count

```java
long count = IntStream.range(0, 100).count();
```

## 17.5 Empty behavior

- `sum` returns 0 for empty int/long/double stream;
- `count` returns 0;
- `min/max/average` return Optional empty.

## 17.6 Rule

Know empty-stream behavior of numeric terminals.

---

# 18. `summaryStatistics`

Summary statistics gives multiple metrics in one traversal.

## 18.1 IntSummaryStatistics

```java
IntSummaryStatistics stats = orders.stream()
    .mapToInt(Order::quantity)
    .summaryStatistics();

long count = stats.getCount();
int min = stats.getMin();
int max = stats.getMax();
long sum = stats.getSum();
double avg = stats.getAverage();
```

## 18.2 LongSummaryStatistics

```java
LongSummaryStatistics stats = files.stream()
    .mapToLong(FileInfo::sizeBytes)
    .summaryStatistics();
```

## 18.3 DoubleSummaryStatistics

```java
DoubleSummaryStatistics stats = samples.stream()
    .mapToDouble(Sample::value)
    .summaryStatistics();
```

## 18.4 Benefit

Avoid multiple traversals.

## 18.5 Rule

Use summaryStatistics when you need count/min/max/sum/average together.

---

# 19. `OptionalInt`, `OptionalLong`, `OptionalDouble`

Primitive optional types avoid boxing.

## 19.1 OptionalInt

```java
OptionalInt max = IntStream.of(1, 2, 3).max();
```

## 19.2 Handling

```java
int value = max.orElse(0);
```

or:

```java
int value = max.orElseThrow();
```

## 19.3 OptionalDouble

Used for average/min/max on DoubleStream.

## 19.4 No map/flatMap richness like Optional<T>

Primitive Optionals are simpler.

## 19.5 Rule

Handle primitive Optional explicitly; do not blindly call getAsInt/getAsLong/getAsDouble.

---

# 20. `mapToObj`, `boxed`, and Object Projection

## 20.1 mapToObj

```java
List<UserRank> ranks = IntStream.range(0, users.size())
    .mapToObj(i -> new UserRank(i + 1, users.get(i)))
    .toList();
```

## 20.2 boxed

```java
List<Integer> values = IntStream.range(0, 10)
    .boxed()
    .toList();
```

## 20.3 Prefer mapToObj over boxed when creating domain object

```java
.mapToObj(i -> new Index(i))
```

not:

```java
.boxed().map(Index::new)
```

## 20.4 Rule

Use boxed only when you truly need wrapper objects.

---

# 21. `asLongStream`, `asDoubleStream`

Some primitive streams can widen.

## 21.1 Int to long

```java
LongStream longs = IntStream.range(0, 10)
    .asLongStream();
```

## 21.2 Int/Long to double

```java
DoubleStream doubles = LongStream.range(0, 10)
    .asDoubleStream();
```

## 21.3 Widening only

No direct safe narrowing stream method because narrowing can lose data.

## 21.4 Rule

Use widening conversion when domain requires larger primitive type.

---

# 22. `flatMapToInt`, `flatMapToLong`, `flatMapToDouble`

These are object stream methods that flatten to primitive streams.

## 22.1 Example

```java
int total = orders.stream()
    .flatMapToInt(order -> order.lines().stream()
        .mapToInt(OrderLine::quantity))
    .sum();
```

## 22.2 Use case

Nested object data to primitive aggregation.

## 22.3 Cost

May create many primitive streams.

## 22.4 Rule

Use flatMapTo* when each object naturally produces primitive stream.

---

# 23. `mapMultiToInt`, `mapMultiToLong`, `mapMultiToDouble`

These avoid per-element nested stream creation.

## 23.1 Example

```java
int total = orders.stream()
    .mapMultiToInt((order, out) -> {
        for (OrderLine line : order.lines()) {
            out.accept(line.quantity());
        }
    })
    .sum();
```

## 23.2 Benefit

Efficient zero/many primitive emission.

## 23.3 Good for

- flattening nested lists;
- parsing records into numbers;
- conditionally emitting numbers.

## 23.4 Rule

Use mapMultiTo* for hot flattening paths where flatMapTo* creates too many temporary streams.

---

# 24. Precision and Overflow

Primitive numeric streams do not eliminate numeric pitfalls.

## 24.1 int overflow

```java
int sum = IntStream.of(Integer.MAX_VALUE, 1).sum();
```

overflows.

## 24.2 Use LongStream

```java
long sum = IntStream.of(Integer.MAX_VALUE, 1)
    .asLongStream()
    .sum();
```

## 24.3 long overflow

Long can overflow too.

## 24.4 double precision

Double has binary floating-point rounding.

```java
DoubleStream.of(0.1, 0.2).sum()
```

not exact decimal arithmetic.

## 24.5 Rule

Primitive stream improves representation performance, not numeric correctness by itself.

---

# 25. BigDecimal and Money Warning

Do not use DoubleStream for money.

## 25.1 Bad

```java
double total = invoices.stream()
    .mapToDouble(Invoice::amount)
    .sum();
```

if amount is money.

## 25.2 Better

```java
BigDecimal total = invoices.stream()
    .map(Invoice::amount)
    .reduce(BigDecimal.ZERO, BigDecimal::add);
```

## 25.3 Minor units alternative

Use long cents/minor units if domain supports exact integer representation.

```java
long cents = invoices.stream()
    .mapToLong(Invoice::amountInCents)
    .sum();
```

## 25.4 Rule

For money, use BigDecimal or long minor units, not double.

---

# 26. Parallel Primitive Streams

Primitive ranges and arrays often split well.

## 26.1 Good candidate

```java
IntStream.range(0, largeN)
    .parallel()
    .map(this::expensiveCpuWork)
    .sum();
```

## 26.2 Bad candidate

Tiny work per element can be slower in parallel.

## 26.3 Side effects

Same stream rules:

- stateless;
- non-interfering;
- associative reductions.

## 26.4 Rule

Parallel primitive stream can be good for CPU-heavy independent numeric work; measure.

---

# 27. Primitive Streams vs Loops

Primitive streams are expressive, but loops still matter.

## 27.1 Stream good

```java
int total = orders.stream()
    .mapToInt(Order::quantity)
    .sum();
```

## 27.2 Loop good

```java
long total = 0;
for (Order order : orders) {
    if (complexCondition(order)) {
        total += compute(order);
        if (total > limit) {
            break;
        }
    }
}
```

## 27.3 Hot path

Loops can be easier for JIT and easier to micro-optimize.

## 27.4 Rule

Use primitive streams for clear numeric pipelines; use loops for complex control flow or extreme hot paths.

---

# 28. Performance Cost Model

## 28.1 Avoided cost

Primitive streams avoid wrapper allocation and unboxing overhead.

## 28.2 Remaining cost

Still have:

- pipeline/lambda overhead;
- bounds/branch logic;
- stateful operation cost;
- terminal operation cost.

## 28.3 Arrays/ranges

Very efficient sources.

## 28.4 Boxing late

If you box at end, cost returns.

```java
IntStream.range(0, n).boxed().toList()
```

## 28.5 Rule

Primitive streams remove boxing cost, not all overhead.

---

# 29. Common Anti-Patterns

## 29.1 `Stream<Integer>` for numeric aggregation

Use IntStream.

## 29.2 `Stream.of(intArray)`

Creates Stream<int[]>.

Use Arrays.stream.

## 29.3 DoubleStream for money

Bad.

## 29.4 Blind getAsInt

Bad on empty OptionalInt.

## 29.5 int sum when long needed

Overflow.

## 29.6 Boxed too early

```java
IntStream.range(...).boxed().mapToInt(...)
```

Pointless.

## 29.7 Parallel for tiny numeric work

Likely slower.

## 29.8 Infinite primitive generate without limit

Never completes/OOM.

## 29.9 Using average without empty handling

OptionalDouble empty.

## 29.10 Rule

Primitive stream mistakes usually involve wrong numeric type, boxing, or empty handling.

---

# 30. Production Failure Modes

## 30.1 Overflow in sum

Quantities/bytes exceed int.

Fix: mapToLong/asLongStream.

## 30.2 Money rounding bug

Double used for currency.

Fix: BigDecimal/minor units.

## 30.3 OptionalInt empty crash

`getAsInt` on empty.

Fix: `orElse`, `orElseThrow`, domain default.

## 30.4 Performance regression from boxing

`Stream<Integer>` in hot numeric path.

Fix: primitive stream.

## 30.5 Memory pressure from boxed collection

Collecting boxed integers for range.

Fix: avoid materialization or use primitive array.

## 30.6 Wrong type from Stream.of(intArray)

Fix: Arrays.stream.

## 30.7 Parallel slower

Work too small or contention/side effects.

Fix: sequential or loop.

## 30.8 average NaN/default confusion

Empty average is OptionalDouble.empty, not NaN.

Your default choice is domain-specific.

## 30.9 Double sum order differences

Floating-point addition is not associative; parallel order may affect tiny differences.

## 30.10 Rule

Numeric pipelines fail in production through overflow, precision, empty data, and hidden boxing.

---

# 31. Best Practices

## 31.1 Choose correct primitive

- int for small bounded quantities;
- long for counts, bytes, IDs, timestamps, money minor units;
- double for approximate measurements.

## 31.2 Convert early

Use `mapToInt/mapToLong/mapToDouble` when entering numeric domain.

## 31.3 Avoid boxing

Use primitive terminal operations.

## 31.4 Handle empty

Use OptionalInt/Long/Double carefully.

## 31.5 Use summaryStatistics

When multiple stats needed.

## 31.6 Use ranges

Prefer `IntStream.range` over boxed integer lists.

## 31.7 Be careful with money

BigDecimal or long minor units.

## 31.8 Measure hot paths

Primitive stream vs loop depends on workload.

---

# 32. Decision Matrix

| Need | Recommended |
|---|---|
| sum int quantities | `mapToInt(...).sum()` |
| sum bytes/file sizes | `mapToLong(...).sum()` |
| average score | `mapToDouble(...).average()` |
| count numeric range | `IntStream.range` |
| inclusive range | `rangeClosed` |
| int array stream | `Arrays.stream(int[])` |
| primitive to object DTO | `mapToObj` |
| primitive wrappers needed | `boxed()` |
| multiple stats | `summaryStatistics()` |
| min/max int | `min()` / `max()` with OptionalInt |
| nested object to int values | `flatMapToInt` or `mapMultiToInt` |
| avoid flatMap stream allocation | `mapMultiToInt` |
| large CPU-heavy independent numeric work | consider parallel primitive stream |
| money | BigDecimal or long minor units |
| possible int overflow | LongStream |
| exact decimal | BigDecimal |
| complex control flow | loop |
| extreme hot path | benchmark stream vs loop |
| empty numeric result | handle primitive Optional |

---

# 33. Latihan

## Latihan 1 — Boxing Difference

Compare:

```java
Stream<Integer>
IntStream
```

for summing 1..1_000_000 conceptually.

## Latihan 2 — Stream.of Primitive Array

Show type difference:

```java
Stream.of(new int[]{1,2,3})
Arrays.stream(new int[]{1,2,3})
```

## Latihan 3 — mapToInt

Given `List<Order>`, calculate total quantity with `mapToInt`.

## Latihan 4 — summaryStatistics

Calculate count/min/max/sum/average for order quantities in one traversal.

## Latihan 5 — OptionalInt

Find max on empty IntStream and handle safely.

## Latihan 6 — Overflow

Demonstrate int overflow and fix with `asLongStream`.

## Latihan 7 — Money

Show why DoubleStream is wrong for money and use BigDecimal or cents.

## Latihan 8 — mapToObj

Create labels `"item-0"` to `"item-9"` from IntStream.range.

## Latihan 9 — flatMapToInt vs mapMultiToInt

Flatten nested order lines to total quantity using both.

## Latihan 10 — Parallel Range

Use `IntStream.range(0, n).parallel()` for CPU-heavy function. Discuss when beneficial.

---

# 34. Ringkasan

Primitive streams are specialized numeric streams.

Core lessons:

- `IntStream`, `LongStream`, `DoubleStream` avoid boxing.
- Use primitive streams for numeric pipelines.
- `Stream<Integer>` is object stream and can involve boxing overhead.
- Use `mapToInt/mapToLong/mapToDouble` to enter primitive domain.
- Use `mapToObj` to return to object domain.
- Use `boxed` only when wrappers are needed.
- Ranges are powerful and split well.
- Primitive arrays should use `Arrays.stream`.
- Numeric terminals include `sum`, `average`, `min`, `max`, `summaryStatistics`.
- Empty min/max/average return primitive Optional.
- Handle OptionalInt/Long/Double explicitly.
- Primitive streams do not prevent overflow or precision bugs.
- Do not use double for money.
- Use long for large counts/bytes/minor currency units.
- Use BigDecimal for exact decimal arithmetic.
- Parallel primitive streams can be good for CPU-heavy independent work, but measure.
- Loops remain appropriate for complex control flow and extreme hot paths.

Main rule:

```text
When the pipeline is numeric, enter primitive stream land early,
stay there as long as possible,
and leave it only when you need objects again.
```

---

# 35. Referensi

1. Java SE 25 — `IntStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.html

2. Java SE 25 — `LongStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/LongStream.html

3. Java SE 25 — `DoubleStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/DoubleStream.html

4. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

5. Java SE 25 — `OptionalInt`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/OptionalInt.html

6. Java SE 25 — `OptionalLong`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/OptionalLong.html

7. Java SE 25 — `OptionalDouble`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/OptionalDouble.html

8. Java SE 25 — `IntSummaryStatistics`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/IntSummaryStatistics.html

9. Java SE 25 — `Arrays.stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html

10. Java SE 25 — `BigDecimal`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html

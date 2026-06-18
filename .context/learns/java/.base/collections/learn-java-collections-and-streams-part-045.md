# learn-java-collections-and-streams-part-045.md

# Java Collections and Streams — Part 045  
# Custom Collectors: Supplier, Accumulator, Combiner, Finisher, Characteristics, Mutable Reduction, Parallel Correctness, and Production-Grade Collector Design

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **045**  
> Fokus: memahami cara membuat custom `Collector` secara benar dan aman. Kita akan membedah `Collector<T, A, R>`, supplier, accumulator, combiner, finisher, `IDENTITY_FINISH`, `UNORDERED`, `CONCURRENT`, thread confinement, mutable reduction, parallel correctness, custom summary collectors, top-N collector, immutable result collector, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Collector = Protocol untuk Mutable Reduction](#2-mental-model-collector--protocol-untuk-mutable-reduction)
3. [`Collector<T, A, R>`](#3-collectorta-r)
4. [The Four Functions](#4-the-four-functions)
5. [Supplier](#5-supplier)
6. [Accumulator](#6-accumulator)
7. [Combiner](#7-combiner)
8. [Finisher](#8-finisher)
9. [Collector Characteristics](#9-collector-characteristics)
10. [`IDENTITY_FINISH`](#10-identity_finish)
11. [`UNORDERED`](#11-unordered)
12. [`CONCURRENT`](#12-concurrent)
13. [Thread Confinement](#13-thread-confinement)
14. [Why Custom Collector Instead of Loop?](#14-why-custom-collector-instead-of-loop)
15. [Why Custom Collector Instead of `reduce`?](#15-why-custom-collector-instead-of-reduce)
16. [Basic Custom Collector with `Collector.of`](#16-basic-custom-collector-with-collectorof)
17. [Example 1: Immutable List Collector](#17-example-1-immutable-list-collector)
18. [Example 2: Summary Collector](#18-example-2-summary-collector)
19. [Example 3: Validation Report Collector](#19-example-3-validation-report-collector)
20. [Example 4: Top-N Collector](#20-example-4-top-n-collector)
21. [Example 5: Histogram Collector](#21-example-5-histogram-collector)
22. [Example 6: Partition-Like Custom Collector](#22-example-6-partition-like-custom-collector)
23. [Designing the Accumulator Type](#23-designing-the-accumulator-type)
24. [Accumulator Mutability](#24-accumulator-mutability)
25. [Combiner Correctness](#25-combiner-correctness)
26. [Finisher and Defensive Copy](#26-finisher-and-defensive-copy)
27. [Sequential vs Parallel Collector Behavior](#27-sequential-vs-parallel-collector-behavior)
28. [Concurrent Collector Design](#28-concurrent-collector-design)
29. [Order-Sensitive Collectors](#29-order-sensitive-collectors)
30. [Null Handling in Custom Collectors](#30-null-handling-in-custom-collectors)
31. [Exception Handling in Custom Collectors](#31-exception-handling-in-custom-collectors)
32. [Performance Cost Model](#32-performance-cost-model)
33. [Testing Custom Collectors](#33-testing-custom-collectors)
34. [Property-Based Correctness Tests](#34-property-based-correctness-tests)
35. [Common Anti-Patterns](#35-common-anti-patterns)
36. [Production Failure Modes](#36-production-failure-modes)
37. [Best Practices](#37-best-practices)
38. [Decision Matrix](#38-decision-matrix)
39. [Latihan](#39-latihan)
40. [Ringkasan](#40-ringkasan)
41. [Referensi](#41-referensi)

---

# 1. Tujuan Bagian Ini

Built-in collectors sangat powerful:

```java
toList()
toMap()
groupingBy()
counting()
summingLong()
teeing()
```

Tetapi kadang domain membutuhkan aggregation khusus.

Contoh:

```text
ImportReport:
  success records
  failures
  warning count
  total rows
```

Atau:

```text
Top 10 orders by amount without sorting all orders
```

Atau:

```text
ValidationSummary:
  valid count
  invalid count
  errors by field
```

Kamu bisa menulis loop.

Tetapi jika aggregation itu reusable, composable, dan cocok sebagai terminal operation, custom collector bisa menjadi abstraction yang bagus.

Namun custom collector juga rawan salah:

- supplier mengembalikan shared object;
- accumulator menulis ke external state;
- combiner membuang data;
- finisher tidak dipanggil karena salah `IDENTITY_FINISH`;
- collector diklaim `CONCURRENT` padahal accumulator tidak thread-safe;
- parallel result berbeda dari sequential;
- ordering hilang;
- defensive copy lupa;
- null policy tidak jelas.

Tujuan part ini:

- memahami collector contract;
- membangun custom collector dengan benar;
- menghindari parallel correctness bug;
- mendesain accumulator dan finisher;
- memahami characteristics;
- membuat collector yang production-grade.

---

# 2. Mental Model: Collector = Protocol untuk Mutable Reduction

Collector adalah protocol yang menjelaskan:

```text
Bagaimana stream elements diakumulasi ke mutable container,
lalu container itu diubah menjadi final result.
```

Contoh built-in:

```java
Collectors.toList()
```

Conceptually:

```text
supplier:    new ArrayList()
accumulator: list.add(element)
combiner:    left.addAll(right)
finisher:    identity
```

## 2.1 Why mutable reduction?

Untuk mengumpulkan banyak element secara efisien ke container.

Misal:

```java
List<T>
Map<K,V>
StringBuilder
Summary object
PriorityQueue
```

## 2.2 Main rule

```text
Collector is a reusable, declarative recipe for accumulation.
```

---

# 3. `Collector<T, A, R>`

Collector punya tiga type parameter:

```java
Collector<T, A, R>
```

## 3.1 `T`

Input element type dari stream.

Example:

```java
Stream<Order>
```

Maka `T = Order`.

## 3.2 `A`

Mutable accumulation type.

Example:

```java
ArrayList<OrderDto>
SummaryAccumulator
PriorityQueue<Order>
```

## 3.3 `R`

Final result type.

Example:

```java
List<OrderDto>
OrderSummary
List<Order>
```

## 3.4 Example

```java
Collector<Order, SummaryAccumulator, OrderSummary>
```

Means:

```text
Input: Order
Accumulator: SummaryAccumulator
Result: OrderSummary
```

## 3.5 Rule

Separate accumulator type from result type. They do not have to be the same.

---

# 4. The Four Functions

Collector protocol uses four functions:

```text
supplier
accumulator
combiner
finisher
```

## 4.1 Supplier

Creates new mutable container.

## 4.2 Accumulator

Adds one input element into container.

## 4.3 Combiner

Merges two containers.

## 4.4 Finisher

Transforms container to final result.

## 4.5 Rule

If you can explain these four functions clearly, you can design a collector.

---

# 5. Supplier

Supplier creates fresh accumulator.

Example:

```java
ArrayList::new
```

## 5.1 Must be fresh

Bad:

```java
List<T> shared = new ArrayList<>();
() -> shared
```

This breaks parallel collector correctness.

## 5.2 Good

```java
() -> new ArrayList<T>()
```

## 5.3 Rule

Supplier must return a new independent accumulator each time.

---

# 6. Accumulator

Accumulator incorporates one stream element into accumulator.

Example:

```java
(list, item) -> list.add(item)
```

## 6.1 Accumulator should mutate only its accumulator

Bad:

```java
(globalList, item) -> externalList.add(item)
```

Good:

```java
(list, item) -> list.add(item)
```

## 6.2 Rule

Accumulator should not depend on or mutate shared external state.

---

# 7. Combiner

Combiner merges two accumulators.

Example:

```java
(left, right) -> {
    left.addAll(right);
    return left;
}
```

## 7.1 Used in parallel

In sequential stream, combiner may not be used often. In parallel, it is essential.

## 7.2 Common bug

```java
(left, right) -> left
```

drops data.

## 7.3 Rule

Combiner must preserve all data and semantics from both accumulators.

---

# 8. Finisher

Finisher converts accumulator into result.

## 8.1 Identity finisher

If `A` is same as `R` and result can be accumulator itself.

```java
Function.identity()
```

## 8.2 Transforming finisher

```java
list -> List.copyOf(list)
```

or:

```java
acc -> new Summary(acc.count, acc.total)
```

## 8.3 Rule

Finisher defines final contract: mutable/immutable, defensive copy, domain object.

---

# 9. Collector Characteristics

Characteristics are hints/contracts:

```java
IDENTITY_FINISH
UNORDERED
CONCURRENT
```

## 9.1 They matter

They can influence how stream framework executes collector.

## 9.2 They must be truthful

Incorrect characteristics can create wrong results.

## 9.3 Rule

Collector characteristics are correctness promises, not performance wishes.

---

# 10. `IDENTITY_FINISH`

Means finisher is identity and can be skipped.

## 10.1 Safe example

Accumulator type and result type are same:

```java
Collector<T, List<T>, List<T>>
```

with finisher identity.

## 10.2 Unsafe example

```java
Collector<T, List<T>, List<T>>
```

but finisher:

```java
List::copyOf
```

This is not identity. Do not declare `IDENTITY_FINISH`.

## 10.3 Rule

Declare `IDENTITY_FINISH` only if accumulator can be returned as final result with no transformation.

---

# 11. `UNORDERED`

Means result does not depend on encounter order.

## 11.1 Safe

Collecting into `HashSet` where order irrelevant.

## 11.2 Unsafe

Collecting into list where order matters.

## 11.3 Rule

Declare `UNORDERED` only if output semantics are order-insensitive.

---

# 12. `CONCURRENT`

Means accumulator can be called concurrently from multiple threads on same result container.

## 12.1 Safe only with concurrent accumulator

Examples:

```java
ConcurrentHashMap
LongAdder
ConcurrentLinkedQueue
```

## 12.2 Unsafe

```java
ArrayList
HashMap
StringBuilder
PriorityQueue
```

unless externally synchronized, which usually harms performance and semantics.

## 12.3 Rule

Declare `CONCURRENT` only if accumulator is truly safe for concurrent updates.

---

# 13. Thread Confinement

Non-concurrent collectors can still work in parallel because the framework can create separate accumulators per partition.

```text
thread A -> accumulator A
thread B -> accumulator B
combiner merges A and B
```

## 13.1 Implication

Accumulator type does not need to be thread-safe if it is not shared.

## 13.2 But supplier must be fresh

Otherwise thread confinement breaks.

## 13.3 Rule

Most custom collectors should be non-concurrent and rely on thread-confined accumulators.

---

# 14. Why Custom Collector Instead of Loop?

Use custom collector if:

- aggregation is reusable;
- aggregation composes with stream pipelines;
- terminal result is natural;
- you need downstream collector composition;
- code becomes clearer than repeated loops.

## 14.1 Use loop if

- logic is one-off;
- many side effects;
- complex exception handling;
- transaction workflow;
- state machine;
- readability suffers.

## 14.2 Rule

Custom collector is an abstraction investment. Use it for reusable aggregation semantics.

---

# 15. Why Custom Collector Instead of `reduce`?

Use `reduce` for immutable value reduction.

Use `collect` for mutable accumulation.

## 15.1 Bad reduce with mutable list

```java
stream.reduce(new ArrayList<>(), ... )
```

Wrong in parallel.

## 15.2 Correct collect

```java
stream.collect(Collector.of(
    ArrayList::new,
    List::add,
    (left, right) -> { left.addAll(right); return left; }
));
```

## 15.3 Rule

If accumulator mutates, think collector, not reduce.

---

# 16. Basic Custom Collector with `Collector.of`

Example:

```java
static Collector<String, StringBuilder, String> joiningWithPipe() {
    return Collector.of(
        StringBuilder::new,
        (sb, s) -> {
            if (!sb.isEmpty()) {
                sb.append('|');
            }
            sb.append(s);
        },
        (left, right) -> {
            if (left.isEmpty()) return right;
            if (right.isEmpty()) return left;
            left.append('|').append(right);
            return left;
        },
        StringBuilder::toString
    );
}
```

## 16.1 Caveat

This collector is order-sensitive.

Do not mark `UNORDERED`.

## 16.2 Rule

`Collector.of` is convenient but still requires full contract correctness.

---

# 17. Example 1: Immutable List Collector

Goal:

```java
stream.collect(toImmutableList())
```

Implementation:

```java
static <T> Collector<T, List<T>, List<T>> toImmutableList() {
    return Collector.of(
        ArrayList::new,
        List::add,
        (left, right) -> {
            left.addAll(right);
            return left;
        },
        List::copyOf
    );
}
```

## 17.1 No IDENTITY_FINISH

Because finisher creates immutable copy.

## 17.2 Null policy

`List.copyOf` rejects null.

That may be desired.

## 17.3 Rule

Finisher can enforce immutability and null policy.

---

# 18. Example 2: Summary Collector

Goal:

```java
OrderSummary summary = orders.stream()
    .collect(orderSummaryCollector());
```

Domain:

```java
record OrderSummary(long count, long totalCents, long maxCents) {}
```

Accumulator:

```java
final class OrderSummaryAcc {
    long count;
    long totalCents;
    long maxCents = Long.MIN_VALUE;

    void add(Order order) {
        count++;
        long amount = order.amountInCents();
        totalCents += amount;
        maxCents = Math.max(maxCents, amount);
    }

    OrderSummaryAcc merge(OrderSummaryAcc other) {
        count += other.count;
        totalCents += other.totalCents;
        maxCents = Math.max(maxCents, other.maxCents);
        return this;
    }

    OrderSummary finish() {
        return new OrderSummary(
            count,
            totalCents,
            count == 0 ? 0 : maxCents
        );
    }
}
```

Collector:

```java
static Collector<Order, OrderSummaryAcc, OrderSummary> orderSummaryCollector() {
    return Collector.of(
        OrderSummaryAcc::new,
        OrderSummaryAcc::add,
        OrderSummaryAcc::merge,
        OrderSummaryAcc::finish
    );
}
```

## 18.1 Correctness

- supplier fresh;
- accumulator mutates own accumulator;
- combiner merges all fields;
- finisher returns immutable record.

## 18.2 Rule

Custom summary collectors are a good use case for custom accumulation.

---

# 19. Example 3: Validation Report Collector

Goal:

```java
ValidationReport report = commands.stream()
    .collect(validationReportCollector());
```

Domain:

```java
record ValidationReport(
    long total,
    long valid,
    List<ValidationError> errors
) {}
```

Accumulator:

```java
final class ValidationAcc {
    long total;
    long valid;
    final List<ValidationError> errors = new ArrayList<>();

    void add(Command command) {
        total++;
        List<ValidationError> found = validate(command);
        if (found.isEmpty()) {
            valid++;
        } else {
            errors.addAll(found);
        }
    }

    ValidationAcc merge(ValidationAcc other) {
        total += other.total;
        valid += other.valid;
        errors.addAll(other.errors);
        return this;
    }

    ValidationReport finish() {
        return new ValidationReport(
            total,
            valid,
            List.copyOf(errors)
        );
    }
}
```

Collector:

```java
static Collector<Command, ValidationAcc, ValidationReport> validationReportCollector() {
    return Collector.of(
        ValidationAcc::new,
        ValidationAcc::add,
        ValidationAcc::merge,
        ValidationAcc::finish
    );
}
```

## 19.1 Caveat

If `validate(command)` has side effects or depends on external mutable state, parallel correctness may fail.

## 19.2 Rule

Validation collector is good if validation is pure and report aggregation is reusable.

---

# 20. Example 4: Top-N Collector

Goal: top N orders by amount without sorting all orders.

Accumulator uses bounded priority queue.

```java
final class TopNAcc<T> {
    private final int n;
    private final Comparator<? super T> comparator;
    private final PriorityQueue<T> heap;

    TopNAcc(int n, Comparator<? super T> comparator) {
        this.n = n;
        this.comparator = comparator;
        this.heap = new PriorityQueue<>(n, comparator);
    }

    void add(T item) {
        if (n <= 0) {
            return;
        }

        if (heap.size() < n) {
            heap.add(item);
            return;
        }

        T smallest = heap.peek();
        if (comparator.compare(item, smallest) > 0) {
            heap.poll();
            heap.add(item);
        }
    }

    TopNAcc<T> merge(TopNAcc<T> other) {
        for (T item : other.heap) {
            add(item);
        }
        return this;
    }

    List<T> finishDescending() {
        ArrayList<T> result = new ArrayList<>(heap);
        result.sort(comparator.reversed());
        return List.copyOf(result);
    }
}
```

Collector:

```java
static <T> Collector<T, TopNAcc<T>, List<T>> topN(
        int n,
        Comparator<? super T> comparator) {
    return Collector.of(
        () -> new TopNAcc<>(n, comparator),
        TopNAcc::add,
        TopNAcc::merge,
        TopNAcc::finishDescending
    );
}
```

Usage:

```java
List<Order> top10 = orders.stream()
    .collect(topN(10, Comparator.comparingLong(Order::amountInCents)));
```

## 20.1 Complexity

Better than sorting all elements when N is small:

```text
O(total * log N)
```

versus:

```text
O(total * log total)
```

## 20.2 Rule

Top-N is an excellent custom collector use case.

---

# 21. Example 5: Histogram Collector

Goal:

```java
Map<Bucket, Long> histogram = values.stream()
    .collect(histogram(bucketFunction));
```

Simpler with built-in:

```java
groupingBy(bucketFunction, counting())
```

Custom collector may be useful if:

- custom accumulator type;
- primitive optimized counting;
- sorted/immutable result;
- validation logic.

Simple version:

```java
static <T, K> Collector<T, Map<K, Long>, Map<K, Long>> histogram(
        Function<? super T, ? extends K> classifier) {
    return Collector.of(
        HashMap::new,
        (map, item) -> map.merge(classifier.apply(item), 1L, Long::sum),
        (left, right) -> {
            right.forEach((k, v) -> left.merge(k, v, Long::sum));
            return left;
        },
        Map::copyOf
    );
}
```

## 21.1 No IDENTITY_FINISH

Finisher returns immutable copy.

## 21.2 Rule

Do not create custom collector if built-in collector clearly expresses the same thing.

---

# 22. Example 6: Partition-Like Custom Collector

Sometimes boolean partition is not expressive enough.

```java
record ReviewBuckets(
    List<Item> accepted,
    List<Item> rejected,
    List<Item> manualReview
) {}
```

Accumulator:

```java
final class ReviewAcc {
    final List<Item> accepted = new ArrayList<>();
    final List<Item> rejected = new ArrayList<>();
    final List<Item> manualReview = new ArrayList<>();

    void add(Item item) {
        switch (classify(item)) {
            case ACCEPT -> accepted.add(item);
            case REJECT -> rejected.add(item);
            case MANUAL_REVIEW -> manualReview.add(item);
        }
    }

    ReviewAcc merge(ReviewAcc other) {
        accepted.addAll(other.accepted);
        rejected.addAll(other.rejected);
        manualReview.addAll(other.manualReview);
        return this;
    }

    ReviewBuckets finish() {
        return new ReviewBuckets(
            List.copyOf(accepted),
            List.copyOf(rejected),
            List.copyOf(manualReview)
        );
    }
}
```

## 22.1 Rule

Custom collector can encode multi-bucket domain aggregation better than nested maps.

---

# 23. Designing the Accumulator Type

A good accumulator:

- is private/internal;
- mutable;
- minimal fields;
- has `add`;
- has `merge`;
- has `finish`;
- does not leak before finish;
- does not mutate external state.

## 23.1 Pattern

```java
final class Acc {
    void add(T item) {}
    Acc merge(Acc other) { return this; }
    R finish() {}
}
```

## 23.2 Rule

Make accumulator a small explicit state machine for aggregation.

---

# 24. Accumulator Mutability

Accumulator is allowed to be mutable.

That is the point of collector.

But mutability must be confined.

## 24.1 Do not expose accumulator

Do not return it directly unless `IDENTITY_FINISH` is correct.

## 24.2 Defensive result

Use records, immutable lists, `Map.copyOf`, `List.copyOf`.

## 24.3 Rule

Mutable during accumulation, immutable at result boundary is often ideal.

---

# 25. Combiner Correctness

Combiner must be semantically equivalent to accumulating all elements in one accumulator.

## 25.1 Test

For input split into A and B:

```text
collect(A + B) == combine(collect(A), collect(B))
```

## 25.2 Common missed fields

```java
count merged but errors not merged
```

or:

```java
total merged but max not merged
```

## 25.3 Rule

Combiner must merge every meaningful field.

---

# 26. Finisher and Defensive Copy

Finisher determines final contract.

## 26.1 Mutable result

```java
Function.identity()
```

May be okay for internal use.

## 26.2 Immutable result

```java
List::copyOf
Map::copyOf
acc -> new Report(..., List.copyOf(acc.errors))
```

## 26.3 Null rejection

Copy factories reject null.

Can be good or surprising.

## 26.4 Rule

Use finisher to enforce result immutability and invariants.

---

# 27. Sequential vs Parallel Collector Behavior

Custom collector must produce equivalent results sequential and parallel.

## 27.1 Test

```java
R seq = input.stream().collect(collector);
R par = input.parallelStream().collect(collector);

assertEquals(seq, par);
```

## 27.2 If order matters

Parallel result should still respect encounter order if collector is order-sensitive and stream ordered.

## 27.3 Rule

Never assume collector is correct until sequential/parallel equivalence is tested.

---

# 28. Concurrent Collector Design

Concurrent collector is advanced.

## 28.1 Example frequency map with LongAdder

Accumulator type:

```java
ConcurrentHashMap<K, LongAdder>
```

Collector concept:

```java
Collector<T, ConcurrentHashMap<K, LongAdder>, Map<K, Long>>
```

## 28.2 Accumulator

```java
(map, item) -> map
    .computeIfAbsent(classifier.apply(item), k -> new LongAdder())
    .increment()
```

## 28.3 Finisher

Convert LongAdder to Long values.

## 28.4 Characteristics?

Only declare `CONCURRENT` if accumulator can be called concurrently on same map.

If final result needs finisher, do not declare `IDENTITY_FINISH`.

## 28.5 Rule

Concurrent collectors require strong understanding of thread-safe accumulator semantics.

---

# 29. Order-Sensitive Collectors

Some collectors depend on order:

- joining strings;
- list preserving encounter order;
- first/last occurrence;
- top-N with tie by encounter order;
- sequence validation.

## 29.1 Do not declare UNORDERED

If order matters.

## 29.2 Combiner must preserve order

For lists:

```java
left.addAll(right)
```

not:

```java
right.addAll(left)
```

## 29.3 Rule

Order-sensitive collector combiner must preserve partition encounter order.

---

# 30. Null Handling in Custom Collectors

Decide null policy.

## 30.1 Reject null

```java
Objects.requireNonNull(item, "item")
```

## 30.2 Ignore null

Only if semantically valid.

## 30.3 Bucket null

```java
UNKNOWN
```

## 30.4 Preserve null

Only if result container supports and contract says so.

## 30.5 Rule

Custom collector must document null policy.

---

# 31. Exception Handling in Custom Collectors

Accumulator can throw.

## 31.1 Fail-fast

Good for invalid data.

## 31.2 Collect errors

If errors expected, accumulator should store error data, not throw.

## 31.3 Parallel

If exception occurs in parallel, some partitions may already process elements.

## 31.4 Rule

Collector exception behavior must match aggregation semantics.

---

# 32. Performance Cost Model

Custom collector performance depends on:

- accumulator allocation;
- per-element add cost;
- combiner cost;
- finisher cost;
- memory growth;
- copying;
- map/hash cost;
- comparator cost;
- parallel partition count.

## 32.1 Top-N

`O(n log k)` can beat full sort.

## 32.2 Immutable finisher

Copy cost is paid at end.

## 32.3 Parallel combiner

Can dominate if accumulator merge is expensive.

## 32.4 Rule

A custom collector is not automatically faster than built-ins or loops.

---

# 33. Testing Custom Collectors

Test:

## 33.1 Empty input

What result?

## 33.2 Single element

Basic behavior.

## 33.3 Multiple elements

Aggregation correctness.

## 33.4 Duplicate/edge cases

Keys, ties, nulls.

## 33.5 Sequential vs parallel

Must match.

## 33.6 Combiner directly

Manually merge accumulators if possible.

## 33.7 Immutability

Result cannot be modified if promised.

## 33.8 Rule

Collector tests must test combiner, not only sequential accumulation.

---

# 34. Property-Based Correctness Tests

Think properties:

## 34.1 Count

```text
summary.count == input.size
```

## 34.2 Total

```text
summary.total == sum input amounts
```

## 34.3 Top-N

```text
result.size <= N
result is sorted descending
every excluded item <= smallest included item
```

## 34.4 Histogram

```text
sum(histogram.values) == input.size
```

## 34.5 Parallel equivalence

```text
collect(seq) == collect(par)
```

## 34.6 Rule

Properties catch collector contract bugs better than a few examples.

---

# 35. Common Anti-Patterns

## 35.1 Shared supplier object

Wrong.

## 35.2 Accumulator writes external state

Wrong.

## 35.3 Combiner drops right accumulator

Wrong.

## 35.4 Declaring IDENTITY_FINISH with non-identity finisher

Wrong.

## 35.5 Declaring CONCURRENT with ArrayList/HashMap

Wrong.

## 35.6 Declaring UNORDERED while order matters

Wrong.

## 35.7 Custom collector duplicating built-in collector

Unnecessary.

## 35.8 Huge accumulator doing workflow side effects

Use loop/service workflow.

## 35.9 No parallel tests

Risky.

## 35.10 Result exposes mutable internals

Leaky abstraction.

---

# 36. Production Failure Modes

## 36.1 Missing data in parallel

Cause: bad combiner.

## 36.2 Race condition

Cause: shared accumulator or false CONCURRENT.

## 36.3 Mutable result modified by caller

Cause: finisher returns internal mutable state.

## 36.4 Finisher skipped

Cause: incorrect IDENTITY_FINISH.

## 36.5 Order flipped

Cause: combiner merges right into left incorrectly.

## 36.6 Memory blow-up

Cause: accumulator stores too much.

## 36.7 Slow parallel collector

Cause: expensive combiner.

## 36.8 Null NPE surprise

Cause: undocumented null policy.

## 36.9 Incorrect top-N ties

Cause: comparator missing tie-breaker.

## 36.10 Flaky tests

Cause: order/concurrency assumptions.

---

# 37. Best Practices

## 37.1 Use built-in collectors first

Do not create custom collector unnecessarily.

## 37.2 Keep accumulator explicit

Small class with add/merge/finish.

## 37.3 Supplier must be fresh

No shared mutable container.

## 37.4 Accumulator mutates only its container

No external state.

## 37.5 Combiner must be complete

Merge all fields.

## 37.6 Finisher enforces final contract

Immutable if crossing boundary.

## 37.7 Characteristics must be truthful

Never lie for performance.

## 37.8 Test parallel equivalence

Always.

## 37.9 Document null/order/parallel semantics

Make contract visible.

## 37.10 Benchmark if performance is motivation

Use JMH or representative benchmark.

---

# 38. Decision Matrix

| Situation | Recommendation |
|---|---|
| built-in collector expresses it | use built-in |
| one-off complex workflow | loop |
| reusable aggregation | custom collector |
| mutable accumulation needed | custom collector, not reduce |
| immutable result needed | finisher with copy |
| top-N small N | bounded heap collector |
| summary record | accumulator + finisher |
| validation report | custom collector if pure/reusable |
| multiple buckets | custom collector or groupingBy depending shape |
| order matters | no `UNORDERED`; preserve combiner order |
| null invalid | reject in accumulator |
| null should be bucketed | map to sentinel |
| parallel use expected | test combiner and parallel equivalence |
| true concurrent accumulation | only with thread-safe accumulator + `CONCURRENT` |
| result exposes internal list | use defensive copy |
| performance claim | benchmark |
| exception-heavy workflow | loop |

---

# 39. Latihan

## Latihan 1 — Immutable List Collector

Implement `toImmutableList()` using `Collector.of`.

Test null behavior.

## Latihan 2 — Summary Collector

Create `OrderSummary(count,total,max)` collector.

Test empty input.

## Latihan 3 — Bad Combiner

Write collector whose combiner returns left only.

Show parallel result bug.

## Latihan 4 — Identity Finish Bug

Declare `IDENTITY_FINISH` incorrectly with `List.copyOf`.

Explain why wrong.

## Latihan 5 — Top-N Collector

Implement `topN(Comparator, n)`.

Test sorted result and size.

## Latihan 6 — Histogram Collector

Implement custom histogram, then compare with `groupingBy(counting())`.

## Latihan 7 — Validation Report

Collect successes/errors into report.

Decide fail-fast vs accumulate.

## Latihan 8 — Concurrent Collector

Design frequency map using `ConcurrentHashMap<K, LongAdder>`.

Explain characteristics.

## Latihan 9 — Null Policy

Add null rejection to collector accumulator.

## Latihan 10 — Parallel Equivalence

For your collector, assert sequential and parallel results match over randomized input.

---

# 40. Ringkasan

Custom collectors are powerful but require discipline.

Core lessons:

- Collector is mutable reduction protocol.
- `T` is input type, `A` is accumulator type, `R` is result type.
- Supplier creates fresh accumulators.
- Accumulator adds one element to its own accumulator.
- Combiner merges two accumulators completely.
- Finisher converts accumulator to final result.
- Characteristics must be truthful.
- `IDENTITY_FINISH` means finisher can be skipped.
- `UNORDERED` means result does not depend on encounter order.
- `CONCURRENT` means same accumulator can be updated concurrently.
- Non-concurrent collectors can still work in parallel via thread confinement.
- Use custom collector for reusable aggregation, not one-off workflow.
- Use collect, not reduce, for mutable accumulation.
- Accumulator should be small and explicit.
- Finisher is a good place for defensive copy and immutable result.
- Test sequential vs parallel equivalence.
- Combiner bugs often only appear in parallel.
- Prefer built-in collectors when they express intent clearly.

Main rule:

```text
A custom collector is production-ready only when supplier, accumulator,
combiner, finisher, characteristics, null policy, order semantics,
and parallel behavior are all explicitly correct.
```

---

# 41. Referensi

1. Java SE 25 — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

2. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

3. Java SE 25 — `Collector.Characteristics`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.Characteristics.html

4. Java SE 25 — `Stream.collect`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html#collect(java.util.stream.Collector)

5. Java SE 25 — `Stream.reduce`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html#reduce(T,java.util.function.BinaryOperator)

6. Java SE 25 — `LongAdder`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html

7. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

8. Java SE 25 — `PriorityQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html

9. Java SE 25 — `List.copyOf`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html#copyOf(java.util.Collection)

10. OpenJDK — Collectors source  
    https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/stream/Collectors.java

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-044.md](./learn-java-collections-and-streams-part-044.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-046.md](./learn-java-collections-and-streams-part-046.md)

</div>
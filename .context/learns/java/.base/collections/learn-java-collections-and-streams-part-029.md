# learn-java-collections-and-streams-part-029.md

# Java Collections and Streams — Part 029  
# Reduction Deep Dive: reduce, collect, Identity, Associativity, Accumulator, Combiner, Mutable Reduction, Parallel Correctness, and Production Pitfalls

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **029**  
> Fokus: memahami reduction sebagai proses mengubah banyak element menjadi satu hasil. Kita akan membedah `reduce`, `collect`, identity, associativity, accumulator, combiner, mutable vs immutable reduction, parallel correctness, numeric pitfalls, grouping reductions, dan kapan reduction membuat code bersih vs berbahaya.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Reduction = Many Values Into One Result](#2-mental-model-reduction--many-values-into-one-result)
3. [Reduction vs Mapping vs Filtering](#3-reduction-vs-mapping-vs-filtering)
4. [Immutable Reduction vs Mutable Reduction](#4-immutable-reduction-vs-mutable-reduction)
5. [`reduce(BinaryOperator)`](#5-reducebinaryoperator)
6. [`reduce(identity, accumulator)`](#6-reduceidentity-accumulator)
7. [`reduce(identity, accumulator, combiner)`](#7-reduceidentity-accumulator-combiner)
8. [Identity Element](#8-identity-element)
9. [Associativity](#9-associativity)
10. [Accumulator](#10-accumulator)
11. [Combiner](#11-combiner)
12. [Compatibility Between Accumulator and Combiner](#12-compatibility-between-accumulator-and-combiner)
13. [Why Parallel Streams Care More](#13-why-parallel-streams-care-more)
14. [Bad Reduction Examples](#14-bad-reduction-examples)
15. [Good Reduction Examples](#15-good-reduction-examples)
16. [Reduce vs Specialized Numeric Terminals](#16-reduce-vs-specialized-numeric-terminals)
17. [Reduce vs Collect](#17-reduce-vs-collect)
18. [Mutable Reduction with `collect`](#18-mutable-reduction-with-collect)
19. [Collector Mental Model](#19-collector-mental-model)
20. [Supplier, Accumulator, Combiner, Finisher](#20-supplier-accumulator-combiner-finisher)
21. [String Concatenation: reduce vs joining](#21-string-concatenation-reduce-vs-joining)
22. [List Accumulation: reduce vs collect](#22-list-accumulation-reduce-vs-collect)
23. [Map Accumulation and Duplicate Keys](#23-map-accumulation-and-duplicate-keys)
24. [Grouping as Reduction](#24-grouping-as-reduction)
25. [Downstream Reductions](#25-downstream-reductions)
26. [Reduction and Optional](#26-reduction-and-optional)
27. [Reduction and Empty Streams](#27-reduction-and-empty-streams)
28. [Reduction and Null](#28-reduction-and-null)
29. [Reduction and Floating-Point Precision](#29-reduction-and-floating-point-precision)
30. [Reduction and BigDecimal/Money](#30-reduction-and-bigdecimalmoney)
31. [Reduction and Infinite Streams](#31-reduction-and-infinite-streams)
32. [Reduction and Side Effects](#32-reduction-and-side-effects)
33. [Reduction and Parallel Streams](#33-reduction-and-parallel-streams)
34. [Performance Cost Model](#34-performance-cost-model)
35. [Testing Reduction Correctness](#35-testing-reduction-correctness)
36. [Common Anti-Patterns](#36-common-anti-patterns)
37. [Production Failure Modes](#37-production-failure-modes)
38. [Best Practices](#38-best-practices)
39. [Decision Matrix](#39-decision-matrix)
40. [Latihan](#40-latihan)
41. [Ringkasan](#41-ringkasan)
42. [Referensi](#42-referensi)

---

# 1. Tujuan Bagian Ini

Reduction adalah inti dari stream processing.

Ketika kamu menulis:

```java
int total = orders.stream()
    .mapToInt(Order::amount)
    .sum();
```

atau:

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(User::role));
```

atau:

```java
Optional<User> oldest = users.stream()
    .min(Comparator.comparing(User::createdAt));
```

kamu sedang melakukan reduction:

```text
many elements -> one result
```

Reduction bisa berupa:

- sum;
- count;
- min/max;
- average;
- concatenation;
- grouping;
- collecting to List/Set/Map;
- merging values;
- building summary;
- calculating domain aggregate.

Namun reduction juga salah satu sumber bug paling berbahaya dalam stream:

- identity salah;
- accumulator tidak associative;
- combiner tidak compatible;
- mutable container dipakai di `reduce`;
- parallel stream hasilnya beda;
- floating-point result berubah;
- duplicate key saat `toMap`;
- empty stream tidak ditangani;
- hidden side effects;
- memory blow-up karena collect besar.

Tujuan part ini:

- memahami reduction secara mental model;
- memahami tiga overload `reduce`;
- memahami `collect` sebagai mutable reduction;
- memahami identity/associativity/combiner;
- memahami parallel correctness;
- tahu kapan pakai `reduce`, `collect`, atau loop;
- menghindari failure mode production.

---

# 2. Mental Model: Reduction = Many Values Into One Result

Reduction menggabungkan banyak element menjadi satu hasil.

```text
[e1, e2, e3, e4] -> result
```

Examples:

```text
[1, 2, 3] -> 6
["a", "b", "c"] -> "abc"
[users] -> Map<Role, List<User>>
[orders] -> OrderSummary
```

## 2.1 Reduction is fold

Secara konseptual:

```text
result = identity
for each element:
    result = combine(result, element)
```

## 2.2 Sequential reduction

Urutan kombinasi biasanya linear.

```text
(((identity op e1) op e2) op e3)
```

## 2.3 Parallel reduction

Data bisa dibagi:

```text
part1 -> partial result
part2 -> partial result
combine partials
```

Karena itu operation harus benar saat dikelompokkan berbeda.

## 2.4 Main rule

```text
Reduction is not just syntax; it is algebra over your data.
```

---

# 3. Reduction vs Mapping vs Filtering

## 3.1 filter

Changes which elements pass.

```java
stream.filter(User::active)
```

## 3.2 map

Changes each element.

```java
stream.map(User::email)
```

## 3.3 reduce/collect

Changes many elements into a result.

```java
stream.reduce(...)
stream.collect(...)
```

## 3.4 Pipeline example

```java
Map<Role, Long> activeCountByRole = users.stream()
    .filter(User::active)                 // select
    .collect(Collectors.groupingBy(       // reduce
        User::role,
        Collectors.counting()
    ));
```

## 3.5 Rule

Map/filter shape the input; reduction commits to output.

---

# 4. Immutable Reduction vs Mutable Reduction

## 4.1 Immutable reduction

Each step creates/returns new value or combines immutable values.

Example:

```java
int sum = numbers.stream()
    .reduce(0, Integer::sum);
```

## 4.2 Mutable reduction

Accumulates into mutable container.

Example:

```java
List<String> names = users.stream()
    .map(User::name)
    .collect(Collectors.toList());
```

## 4.3 Key distinction

Use:

```java
reduce
```

for immutable/value reduction.

Use:

```java
collect
```

for mutable container reduction.

## 4.4 Rule

```text
Reduce values. Collect containers.
```

---

# 5. `reduce(BinaryOperator)`

Signature:

```java
Optional<T> reduce(BinaryOperator<T> accumulator)
```

## 5.1 No identity

Because no identity is provided, empty stream returns `Optional.empty()`.

## 5.2 Example

```java
Optional<Integer> max = numbers.stream()
    .reduce(Integer::max);
```

## 5.3 Equivalent idea

For non-empty stream:

```text
e1 op e2 op e3 ...
```

## 5.4 Use case

When there is no natural identity or empty result should be absent.

## 5.5 Example domain

```java
Optional<Order> largest = orders.stream()
    .reduce((a, b) -> a.amount().compareTo(b.amount()) >= 0 ? a : b);
```

Usually `max` is clearer.

## 5.6 Rule

Use reduce without identity when empty stream should produce Optional empty.

---

# 6. `reduce(identity, accumulator)`

Signature:

```java
T reduce(T identity, BinaryOperator<T> accumulator)
```

## 6.1 Example

```java
int sum = numbers.stream()
    .reduce(0, Integer::sum);
```

## 6.2 Identity used for empty stream

If stream empty, result is identity.

## 6.3 Identity must be neutral

For every x:

```text
identity op x == x
x op identity == x
```

## 6.4 Bad identity

```java
int sum = numbers.stream()
    .reduce(10, Integer::sum);
```

This adds 10 even when stream has elements.

## 6.5 Rule

Use identity reduce only with a true identity element.

---

# 7. `reduce(identity, accumulator, combiner)`

Signature:

```java
<U> U reduce(
    U identity,
    BiFunction<U, ? super T, U> accumulator,
    BinaryOperator<U> combiner
)
```

## 7.1 Why exists

Allows result type `U` to differ from stream element type `T`.

Example:

```java
Integer totalLength = words.stream()
    .reduce(
        0,
        (subtotal, word) -> subtotal + word.length(),
        Integer::sum
    );
```

Here:

```text
T = String
U = Integer
```

## 7.2 Accumulator

Combines partial result U with element T.

## 7.3 Combiner

Combines two partial results U.

## 7.4 Parallel

Combiner becomes essential when stream is parallel.

## 7.5 Rule

Three-arg reduce is for immutable cross-type reductions, not mutable containers.

---

# 8. Identity Element

Identity is neutral value.

## 8.1 Sum

```text
0
```

because:

```text
0 + x = x
```

## 8.2 Multiplication

```text
1
```

because:

```text
1 * x = x
```

## 8.3 String concatenation

```text
""
```

because:

```text
"" + x = x
```

## 8.4 Max?

No universal identity for arbitrary object max unless domain has minimum sentinel.

Use Optional or `max`.

## 8.5 Min?

Same.

## 8.6 Rule

If you cannot name a true identity, use Optional reduction or specialized terminal.

---

# 9. Associativity

Associativity means grouping does not change result.

```text
(a op b) op c == a op (b op c)
```

## 9.1 Associative

Addition:

```text
(1 + 2) + 3 == 1 + (2 + 3)
```

Multiplication:

```text
(2 * 3) * 4 == 2 * (3 * 4)
```

String concatenation is associative in value semantics:

```text
("a" + "b") + "c" == "a" + ("b" + "c")
```

but inefficient with repeated immutable String concatenation.

## 9.2 Not associative

Subtraction:

```text
(10 - 5) - 2 != 10 - (5 - 2)
```

Division:

```text
(100 / 10) / 2 != 100 / (10 / 2)
```

## 9.3 Why parallel cares

Parallel reduction can group elements differently.

## 9.4 Rule

If operation is not associative, do not use it for parallel reduction.

---

# 10. Accumulator

Accumulator folds element into result.

## 10.1 In two-arg reduce

```java
BinaryOperator<T> accumulator
```

Same type:

```text
T + T -> T
```

## 10.2 In three-arg reduce

```java
BiFunction<U, T, U> accumulator
```

Different result type:

```text
U + T -> U
```

## 10.3 Example

```java
(subtotal, word) -> subtotal + word.length()
```

## 10.4 Accumulator should be non-interfering

No source mutation.

## 10.5 Accumulator should be stateless

No external mutable state.

## 10.6 Rule

Accumulator describes how one element contributes to result.

---

# 11. Combiner

Combiner merges partial results.

## 11.1 Example

```java
Integer::sum
```

for partial integer sums.

## 11.2 Sequential stream

Combiner may not be used in same way or may not matter visibly.

## 11.3 Parallel stream

Combiner is essential.

## 11.4 Bad combiner

```java
(a, b) -> a - b
```

with summing accumulator.

## 11.5 Rule

Combiner must merge two partial results of same identity/accumulation semantics.

---

# 12. Compatibility Between Accumulator and Combiner

For three-arg reduce, accumulator and combiner must be compatible.

Conceptually:

```text
combiner.apply(u, accumulator.apply(identity, t))
==
accumulator.apply(u, t)
```

## 12.1 Example good

```java
Integer totalLength = words.parallelStream()
    .reduce(
        0,
        (subtotal, word) -> subtotal + word.length(),
        Integer::sum
    );
```

If one partition accumulates lengths and another accumulates lengths, combiner sums partial lengths.

## 12.2 Example bad

```java
Integer result = words.parallelStream()
    .reduce(
        0,
        (subtotal, word) -> subtotal + word.length(),
        (a, b) -> a * b
    );
```

Combiner multiplies partial sums. Wrong.

## 12.3 Rule

Combiner must combine partial results exactly as if all elements were accumulated into one result.

---

# 13. Why Parallel Streams Care More

Sequential reduction often hides bad combiner because combiner may not be exercised as expected.

Parallel reduction exposes algebra mistakes.

## 13.1 Sequential

```text
identity -> e1 -> e2 -> e3
```

## 13.2 Parallel

```text
partition A -> partial A
partition B -> partial B
combine(partial A, partial B)
```

## 13.3 Bad identity amplified

Identity may be applied once per partition, not once globally in the way developers imagine.

## 13.4 Rule

If a reduction is not correct in parallel, it is usually conceptually invalid even if sequential result looks okay.

---

# 14. Bad Reduction Examples

## 14.1 Mutable container in reduce

Bad:

```java
List<String> result = names.parallelStream()
    .reduce(
        new ArrayList<>(),
        (list, name) -> {
            list.add(name);
            return list;
        },
        (a, b) -> {
            a.addAll(b);
            return a;
        }
    );
```

Problem:

- mutable identity reused/combined incorrectly;
- side effects;
- not safe parallel semantics.

Use collect.

## 14.2 Non-associative operation

```java
int result = numbers.parallelStream()
    .reduce(0, (a, b) -> a - b);
```

Wrong.

## 14.3 Wrong identity

```java
int result = numbers.stream()
    .reduce(100, Integer::sum);
```

Adds 100.

## 14.4 Combiner incompatible

```java
.reduce(0, (sum, word) -> sum + word.length(), (a, b) -> a * b)
```

Wrong.

## 14.5 Rule

If reduction mutates shared state or has fake identity, stop and redesign.

---

# 15. Good Reduction Examples

## 15.1 Sum

```java
int sum = numbers.stream()
    .reduce(0, Integer::sum);
```

Better for primitives:

```java
int sum = numbers.stream()
    .mapToInt(Integer::intValue)
    .sum();
```

## 15.2 Product

```java
int product = numbers.stream()
    .reduce(1, (a, b) -> a * b);
```

## 15.3 Max without identity

```java
Optional<Integer> max = numbers.stream()
    .reduce(Integer::max);
```

Better:

```java
Optional<Integer> max = numbers.stream().max(Integer::compareTo);
```

## 15.4 Total string length

```java
int totalLength = words.stream()
    .reduce(
        0,
        (subtotal, word) -> subtotal + word.length(),
        Integer::sum
    );
```

Better:

```java
int totalLength = words.stream()
    .mapToInt(String::length)
    .sum();
```

## 15.5 Rule

Prefer specialized terminals when they express the reduction directly.

---

# 16. Reduce vs Specialized Numeric Terminals

## 16.1 Sum

Prefer:

```java
.mapToInt(...).sum()
```

over:

```java
.reduce(0, Integer::sum)
```

## 16.2 Min/max

Prefer:

```java
.min(comparator)
.max(comparator)
```

over custom reduce.

## 16.3 Count

Prefer:

```java
.count()
```

over reduce counting manually.

## 16.4 Average/statistics

Prefer primitive terminals.

## 16.5 Rule

Use the most semantic terminal operation available.

---

# 17. Reduce vs Collect

## 17.1 reduce

For immutable value combination:

```java
BigDecimal total = invoices.stream()
    .map(Invoice::amount)
    .reduce(BigDecimal.ZERO, BigDecimal::add);
```

## 17.2 collect

For mutable accumulation:

```java
List<String> names = users.stream()
    .map(User::name)
    .collect(Collectors.toCollection(ArrayList::new));
```

## 17.3 Why collect exists

Mutable containers can be accumulated efficiently and safely under stream framework rules.

## 17.4 Rule

If result is a collection/map/StringBuilder-like container, think collect first.

---

# 18. Mutable Reduction with `collect`

`collect` is reduction into a mutable result container.

## 18.1 Three-function collect

```java
<R> R collect(
    Supplier<R> supplier,
    BiConsumer<R, ? super T> accumulator,
    BiConsumer<R, R> combiner
)
```

Example:

```java
ArrayList<String> names = users.stream()
    .map(User::name)
    .collect(
        ArrayList::new,
        ArrayList::add,
        ArrayList::addAll
    );
```

## 18.2 Collector collect

```java
.collect(Collectors.toList())
```

## 18.3 Parallel safety

Each partition gets its own container, then containers are combined.

## 18.4 Rule

Use collect for controlled mutable reduction.

---

# 19. Collector Mental Model

A collector describes how to build result from stream elements.

Conceptually:

```text
supplier: create container
accumulator: add element to container
combiner: merge containers
finisher: final transform
characteristics: hints/constraints
```

## 19.1 Example toList

```text
supplier -> new list
accumulator -> list.add(element)
combiner -> list.addAll(otherList)
finisher -> maybe identity
```

## 19.2 Example joining

```text
supplier -> StringBuilder
accumulator -> append
combiner -> append builders
finisher -> toString
```

## 19.3 Rule

Collector is structured mutable reduction.

---

# 20. Supplier, Accumulator, Combiner, Finisher

## 20.1 Supplier

Creates fresh result container.

Must not reuse same mutable object across reductions.

## 20.2 Accumulator

Adds one element to container.

## 20.3 Combiner

Merges two partial containers.

Important for parallel.

## 20.4 Finisher

Transforms intermediate container to final result.

Example:

```text
StringBuilder -> String
```

## 20.5 Rule

Fresh supplier and correct combiner are the heart of safe mutable reduction.

---

# 21. String Concatenation: reduce vs joining

## 21.1 Bad for many strings

```java
String s = words.stream()
    .reduce("", (a, b) -> a + b);
```

Repeated String concatenation creates many intermediate strings.

## 21.2 Better

```java
String s = words.stream()
    .collect(Collectors.joining());
```

## 21.3 With delimiter

```java
String csv = words.stream()
    .collect(Collectors.joining(","));
```

## 21.4 Rule

Use `Collectors.joining` for string concatenation across stream elements.

---

# 22. List Accumulation: reduce vs collect

## 22.1 Bad reduce

```java
List<String> names = users.stream()
    .reduce(
        new ArrayList<>(),
        (list, user) -> {
            list.add(user.name());
            return list;
        },
        (a, b) -> {
            a.addAll(b);
            return a;
        }
    );
```

## 22.2 Better

```java
List<String> names = users.stream()
    .map(User::name)
    .toList();
```

or mutable:

```java
ArrayList<String> names = users.stream()
    .map(User::name)
    .collect(Collectors.toCollection(ArrayList::new));
```

## 22.3 Rule

Do not use reduce to mutate collections.

---

# 23. Map Accumulation and Duplicate Keys

## 23.1 toMap without duplicate key policy

```java
Map<Role, User> byRole = users.stream()
    .collect(Collectors.toMap(User::role, Function.identity()));
```

Fails if duplicate role.

## 23.2 Add merge function

```java
Map<Role, User> firstByRole = users.stream()
    .collect(Collectors.toMap(
        User::role,
        Function.identity(),
        (a, b) -> a
    ));
```

## 23.3 Grouping for many values

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(User::role));
```

## 23.4 Rule

When reducing to map, duplicate key policy must be explicit.

---

# 24. Grouping as Reduction

`groupingBy` reduces stream into map of groups.

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(User::role));
```

## 24.1 Classification function

Determines group key.

## 24.2 Downstream collector

Determines group value.

```java
Map<Role, Long> countByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.counting()
    ));
```

## 24.3 Rule

Grouping is reduction into categorized containers.

---

# 25. Downstream Reductions

Collectors can be nested.

## 25.1 Mapping downstream

```java
Map<Role, List<String>> namesByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.mapping(User::name, Collectors.toList())
    ));
```

## 25.2 Summing downstream

```java
Map<Role, Integer> totalAgeByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.summingInt(User::age)
    ));
```

## 25.3 Max downstream

```java
Map<Role, Optional<User>> oldestByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.maxBy(Comparator.comparing(User::createdAt))
    ));
```

## 25.4 Rule

Downstream collectors let you express per-group reductions.

---

# 26. Reduction and Optional

## 26.1 Optional reduce

```java
Optional<T> result = stream.reduce(operator);
```

## 26.2 min/max

```java
Optional<T> min = stream.min(comparator);
```

## 26.3 Empty stream

Optional empty means no result.

## 26.4 Avoid fake identity

Bad:

```java
User fake = new User(...);
stream.reduce(fake, chooseOldest)
```

Better:

```java
stream.min(comparator)
```

## 26.5 Rule

Use Optional when no natural identity exists.

---

# 27. Reduction and Empty Streams

## 27.1 reduce without identity

Empty -> Optional.empty.

## 27.2 reduce with identity

Empty -> identity.

## 27.3 sum

Empty primitive stream -> 0.

## 27.4 average/min/max

Empty -> Optional primitive empty.

## 27.5 collect

Empty -> empty collection/map/result according to collector.

## 27.6 Rule

Empty-stream behavior must be part of domain design.

---

# 28. Reduction and Null

## 28.1 Null identity

Avoid.

## 28.2 Null accumulator result

Can cause NPE or semantic ambiguity.

## 28.3 Collectors may reject null

Some unmodifiable collectors reject null.

## 28.4 Map reductions

Null keys/values may be rejected depending collector/map.

## 28.5 Rule

Normalize nulls before reduction.

---

# 29. Reduction and Floating-Point Precision

Floating-point addition is not perfectly associative.

## 29.1 Sequential vs parallel

Different grouping can produce tiny differences.

## 29.2 Example

```java
double sum = values.parallelStream()
    .mapToDouble(Double::doubleValue)
    .sum();
```

May not match exact sequential bit-for-bit in all cases.

## 29.3 Domain

For scientific approximate metrics, acceptable.

For exact money, unacceptable.

## 29.4 Rule

Floating-point reductions are approximate; parallel grouping can affect final rounding.

---

# 30. Reduction and BigDecimal/Money

## 30.1 Money total

```java
BigDecimal total = invoices.stream()
    .map(Invoice::amount)
    .reduce(BigDecimal.ZERO, BigDecimal::add);
```

## 30.2 Identity

`BigDecimal.ZERO` is identity for addition.

## 30.3 Scale considerations

BigDecimal equals/scale issues are separate; addition result scale follows BigDecimal rules.

## 30.4 Minor units alternative

```java
long totalCents = invoices.stream()
    .mapToLong(Invoice::amountInCents)
    .sum();
```

## 30.5 Rule

Use BigDecimal or integer minor units for exact monetary reductions.

---

# 31. Reduction and Infinite Streams

## 31.1 Unsafe

```java
Stream.generate(...)
    .reduce(...)
```

without bounding never completes.

## 31.2 Safe with limit

```java
Stream.generate(...)
    .limit(100)
    .reduce(...)
```

## 31.3 Short-circuit terminals

`reduce` is not short-circuiting.

## 31.4 Rule

Reduction over infinite stream requires finite bounding first.

---

# 32. Reduction and Side Effects

## 32.1 Bad

```java
AtomicInteger total = new AtomicInteger();

numbers.parallelStream()
    .forEach(total::addAndGet);
```

Works maybe but contention/side-effect style is poor.

Better:

```java
int total = numbers.parallelStream()
    .mapToInt(Integer::intValue)
    .sum();
```

## 32.2 Bad accumulator side effect

```java
.reduce(0, (sum, x) -> {
    audit(x);
    return sum + x;
})
```

Side effects may run in unexpected grouping/order.

## 32.3 Rule

Reduction functions should compute results, not perform business side effects.

---

# 33. Reduction and Parallel Streams

Parallel-safe reduction requires:

- identity is true neutral element;
- accumulator associative/stateless/non-interfering;
- combiner compatible;
- no shared mutable state;
- collector contract respected.

## 33.1 Good

```java
long total = orders.parallelStream()
    .mapToLong(Order::amountInCents)
    .sum();
```

## 33.2 Bad

```java
ArrayList<Order> result = new ArrayList<>();
orders.parallelStream().forEach(result::add);
```

## 33.3 Collector thread confinement

For non-concurrent collectors, stream framework uses separate containers and combines them.

## 33.4 Rule

Parallel reduction correctness is algebra + collector contract.

---

# 34. Performance Cost Model

## 34.1 reduce

Good for small immutable values.

Can be inefficient for immutable structures like String concatenation.

## 34.2 collect

Good for mutable containers.

Cost depends on container allocation, accumulator, combiner, finisher.

## 34.3 grouping

Cost depends on number of keys, hash quality, downstream collector.

## 34.4 parallel

Parallel helps only if splitting, computation, and combining costs justify overhead.

## 34.5 boxing

Primitive terminals avoid boxing.

## 34.6 Rule

Reduction cost is dominated by accumulator work, container growth, combining, and memory allocation.

---

# 35. Testing Reduction Correctness

## 35.1 Empty input

Test empty stream.

## 35.2 Single element

Test one element.

## 35.3 Multiple elements

Test normal data.

## 35.4 Duplicate keys

For map reductions.

## 35.5 Sequential vs parallel

If reduction intended parallel-safe, compare sequential and parallel results.

## 35.6 Different ordering

If source unordered, test order independence.

## 35.7 Large values

Test overflow/precision.

## 35.8 Rule

Reduction tests should include algebra edge cases, not only happy path.

---

# 36. Common Anti-Patterns

## 36.1 Using reduce for List/Map accumulation

Use collect.

## 36.2 Wrong identity

Fake initial value.

## 36.3 Non-associative accumulator

Subtraction/division.

## 36.4 Incompatible combiner

Works sequential, fails parallel.

## 36.5 String concat with reduce

Use joining.

## 36.6 toMap without merge function

Duplicate key failure.

## 36.7 Floating-point exactness assumption

Wrong.

## 36.8 Side effects in reduction

Dangerous.

## 36.9 BigDecimal missing identity thought

Use BigDecimal.ZERO for sum, Optional for max/min.

## 36.10 Rule

Most reduce bugs are algebra bugs disguised as API usage.

---

# 37. Production Failure Modes

## 37.1 Parallel result differs from sequential

Cause: non-associative or incompatible combiner.

## 37.2 List duplicated/corrupted in reduce

Cause: mutable container in reduce.

## 37.3 Duplicate key exception in toMap

Cause: no merge policy.

## 37.4 Memory blow-up in grouping

Cause: high cardinality group keys.

## 37.5 Wrong total due to int overflow

Cause: using IntStream sum for large totals.

## 37.6 Money rounding bug

Cause: double reduction.

## 37.7 Empty stream crash

Cause: Optional.get or getAsInt.

## 37.8 Infinite stream never completes

Cause: reduce without bound.

## 37.9 String concatenation slow

Cause: reduce with immutable String.

## 37.10 Side-effect repeated/out of order

Cause: reduction function with side effect under parallel/optimization.

## 37.11 Bad identity applied per partition

Cause: fake identity in parallel reduction.

## 37.12 Mutable downstream value leaked

Cause: collector result exposed without defensive copy.

---

# 38. Best Practices

## 38.1 Prefer semantic terminals

Use:

- `sum`;
- `count`;
- `min`;
- `max`;
- `average`;
- `summaryStatistics`.

## 38.2 Use reduce for immutable values

Good:

```java
BigDecimal.ZERO + BigDecimal::add
```

## 38.3 Use collect for containers

Good:

```java
toList
toSet
toMap
groupingBy
joining
```

## 38.4 Validate algebra

Identity and associativity.

## 38.5 Handle duplicates

Explicit merge function or grouping.

## 38.6 Handle empty

Optional or identity by domain.

## 38.7 Avoid side effects

Reduction should be computation.

## 38.8 Test parallel if used

Sequential correctness is not enough.

## 38.9 Watch memory

Grouping/collecting large streams materializes data.

---

# 39. Decision Matrix

| Need | Recommended |
|---|---|
| sum int values | `mapToInt(...).sum()` |
| sum long/money minor units | `mapToLong(...).sum()` |
| exact BigDecimal sum | `reduce(BigDecimal.ZERO, BigDecimal::add)` |
| count | `count()` |
| min/max object | `min` / `max` |
| no natural identity | Optional-returning reduce/min/max |
| build list | `toList()` or `collect(toCollection(...))` |
| build set | `collect(toSet())` |
| build map unique key | `toMap` |
| duplicate key expected | `toMap` with merge or `groupingBy` |
| group by key | `groupingBy` |
| per-group count | `groupingBy(..., counting())` |
| per-group sum | `groupingBy(..., summingInt/Long/Double)` |
| string concat | `Collectors.joining()` |
| mutable container | `collect`, not `reduce` |
| parallel reduction | associative + true identity + compatible combiner |
| infinite stream | bound before reduction |
| complex transactional side effects | loop/explicit workflow |
| exact decimal money | BigDecimal/minor units, not double |

---

# 40. Latihan

## Latihan 1 — Identity

Show why `reduce(10, Integer::sum)` gives wrong total for normal sum.

## Latihan 2 — Associativity

Compare subtraction reduction sequential and parallel.

## Latihan 3 — Three-Arg Reduce

Calculate total length of words using three-arg reduce.

Then rewrite with `mapToInt(String::length).sum()`.

## Latihan 4 — Mutable Reduce Bug

Accumulate into ArrayList using reduce in parallel.

Observe/explain why wrong.

Fix with collect.

## Latihan 5 — String Joining

Concatenate strings with reduce and with `Collectors.joining(",")`.

Explain cost/readability.

## Latihan 6 — Duplicate Key

Use `toMap` on duplicate role keys.

Fix with merge and with groupingBy.

## Latihan 7 — Grouping Downstream

Group users by role and count per role.

## Latihan 8 — BigDecimal Money

Sum invoice amounts with BigDecimal.

## Latihan 9 — Floating-Point

Sum doubles with different order. Discuss precision.

## Latihan 10 — Parallel Correctness

Write custom reduction and test sequential vs parallel equality.

---

# 41. Ringkasan

Reduction is where stream pipelines become results.

Core lessons:

- Reduction turns many elements into one result.
- `reduce` is for immutable/value reductions.
- `collect` is for mutable container reductions.
- Identity must be neutral.
- Accumulator/combiner must be associative and compatible.
- Parallel reduction exposes algebra mistakes.
- Do not mutate containers inside reduce.
- Use specialized terminals like sum/count/min/max when available.
- Use Collectors for List/Set/Map/grouping/joining.
- Duplicate key policy must be explicit in map reduction.
- Grouping is reduction into categorized containers.
- Downstream collectors express per-group reductions.
- Empty stream behavior must be designed.
- Floating-point reductions are approximate.
- Money should use BigDecimal or integer minor units.
- Infinite streams must be bounded before reduction.
- Side effects do not belong in reduction functions.

Main rule:

```text
Before writing reduce, ask:
What is the identity?
Is the operation associative?
Is the combiner compatible?
Am I reducing a value or collecting a container?
```

---

# 42. Referensi

1. Java SE 25 — `Stream.reduce`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

2. Java SE 25 — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

3. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

4. Java SE 25 — `java.util.stream` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

5. Oracle Java Tutorial — Reduction  
   https://docs.oracle.com/javase/tutorial/collections/streams/reduction.html

6. Java SE 25 — `IntStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.html

7. Java SE 25 — `Optional`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html

8. Java SE 25 — `BigDecimal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html

9. dev.java — Reductions  
   https://dev.java/learn/api/streams/reducing/

10. dev.java — Terminal Operations  
    https://dev.java/learn/api/streams/terminal-operations/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-028.md](./learn-java-collections-and-streams-part-028.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-030.md](./learn-java-collections-and-streams-part-030.md)

# learn-java-collections-and-streams-part-038.md

# Java Collections and Streams — Part 038  
# Parallel Stream Correctness: Non-Interference, Statelessness, Associativity, Identity, Combiner Compatibility, Collector Safety, Ordering, Side Effects, and Deterministic Results

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **038**  
> Fokus: memahami **correctness** parallel stream. Bagian sebelumnya membahas fundamental performance. Bagian ini membahas pertanyaan yang lebih penting: “Apakah hasilnya benar saat pipeline di-split, dieksekusi oleh banyak thread, lalu digabung?” Kita akan membedah algebra reduction, collector contract, shared mutable state, ordering, side effects, memory visibility, exception semantics, dan deterministic testing.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Parallel Correctness = Same Meaning Under Split and Combine](#2-mental-model-parallel-correctness--same-meaning-under-split-and-combine)
3. [Sequential Correct Does Not Mean Parallel Correct](#3-sequential-correct-does-not-mean-parallel-correct)
4. [The Four Core Correctness Contracts](#4-the-four-core-correctness-contracts)
5. [Non-Interference](#5-non-interference)
6. [Statelessness](#6-statelessness)
7. [Associativity](#7-associativity)
8. [Identity Element](#8-identity-element)
9. [Accumulator and Combiner Compatibility](#9-accumulator-and-combiner-compatibility)
10. [The Three-Arg `reduce` Trap](#10-the-three-arg-reduce-trap)
11. [Bad Parallel Reductions](#11-bad-parallel-reductions)
12. [Good Parallel Reductions](#12-good-parallel-reductions)
13. [Mutable Reduction Correctness](#13-mutable-reduction-correctness)
14. [Collector Supplier Correctness](#14-collector-supplier-correctness)
15. [Collector Accumulator Correctness](#15-collector-accumulator-correctness)
16. [Collector Combiner Correctness](#16-collector-combiner-correctness)
17. [Collector Finisher Correctness](#17-collector-finisher-correctness)
18. [Collector Characteristics Correctness](#18-collector-characteristics-correctness)
19. [Thread Confinement in Non-Concurrent Collectors](#19-thread-confinement-in-non-concurrent-collectors)
20. [`CONCURRENT` Collector Correctness](#20-concurrent-collector-correctness)
21. [Ordering and Determinism](#21-ordering-and-determinism)
22. [`findFirst`, `findAny`, `forEach`, `forEachOrdered`](#22-findfirst-findany-foreach-foreachordered)
23. [Floating-Point Correctness](#23-floating-point-correctness)
24. [BigDecimal and Exact Arithmetic](#24-bigdecimal-and-exact-arithmetic)
25. [Shared Mutable State](#25-shared-mutable-state)
26. [Atomic and Concurrent Containers: Correct but Still Wrong?](#26-atomic-and-concurrent-containers-correct-but-still-wrong)
27. [Side Effects and External Systems](#27-side-effects-and-external-systems)
28. [Exception and Cancellation Semantics](#28-exception-and-cancellation-semantics)
29. [Memory Visibility and Safe Publication](#29-memory-visibility-and-safe-publication)
30. [Source Mutation and Concurrent Sources](#30-source-mutation-and-concurrent-sources)
31. [Testing Parallel Correctness](#31-testing-parallel-correctness)
32. [Property-Based Thinking](#32-property-based-thinking)
33. [Production Review Checklist](#33-production-review-checklist)
34. [Common Anti-Patterns](#34-common-anti-patterns)
35. [Production Failure Modes](#35-production-failure-modes)
36. [Best Practices](#36-best-practices)
37. [Decision Matrix](#37-decision-matrix)
38. [Latihan](#38-latihan)
39. [Ringkasan](#39-ringkasan)
40. [Referensi](#40-referensi)

---

# 1. Tujuan Bagian Ini

Parallel stream bukan hanya masalah performance.

Sebelum bertanya:

```text
Apakah lebih cepat?
```

tanya dulu:

```text
Apakah tetap benar?
```

Contoh yang terlihat benar sequential:

```java
List<String> result = new ArrayList<>();

users.stream()
    .map(User::email)
    .forEach(result::add);
```

Mungkin terlihat bekerja.

Tetapi versi parallel:

```java
List<String> result = new ArrayList<>();

users.parallelStream()
    .map(User::email)
    .forEach(result::add);
```

bisa corrupt, kehilangan data, atau melempar exception.

Contoh lain:

```java
int result = numbers.parallelStream()
    .reduce(0, (a, b) -> a - b);
```

Tidak benar karena subtraction tidak associative.

Tujuan bagian ini:

- memahami syarat correctness parallel stream;
- memahami non-interference dan statelessness;
- memahami associativity, identity, combiner compatibility;
- memahami collector correctness;
- memahami ordering dan determinism;
- memahami side effect hazards;
- memahami bagaimana mengetes dan mereview parallel stream.

---

# 2. Mental Model: Parallel Correctness = Same Meaning Under Split and Combine

Parallel stream boleh memproses data seperti ini:

```text
input = [a, b, c, d, e, f]

split:
  [a, b, c] -> partial 1
  [d, e, f] -> partial 2

combine:
  combine(partial 1, partial 2)
```

Atau split berbeda:

```text
[a, b] [c, d] [e, f]
```

Atau urutan penyelesaian berbeda.

Pipeline benar jika semua strategi split/combine yang valid menghasilkan makna yang sama.

## 2.1 Correctness question

Untuk setiap lambda/reduction/collector:

```text
Apakah hasil tetap sama jika data dipartisi, diproses terpisah, dan partial results digabung?
```

## 2.2 Main rule

```text
Parallel correctness is correctness under regrouping, repartitioning, and concurrent execution.
```

---

# 3. Sequential Correct Does Not Mean Parallel Correct

Sequential execution memiliki satu traversal linear.

Parallel execution memiliki:

- multiple partitions;
- multiple threads;
- partial results;
- combiner;
- possible reordering;
- concurrent completion;
- cancellation behavior;
- different floating-point grouping.

## 3.1 Example sequential works

```java
List<String> emails = new ArrayList<>();

users.stream()
    .forEach(user -> emails.add(user.email()));
```

Sequential may work.

## 3.2 Parallel breaks

```java
users.parallelStream()
    .forEach(user -> emails.add(user.email()));
```

`ArrayList` is not thread-safe.

## 3.3 Rule

If code relies on “one element after another in one thread”, it is not parallel-safe.

---

# 4. The Four Core Correctness Contracts

Parallel stream correctness depends on four core contracts.

## 4.1 Non-interference

Do not modify source during stream execution.

## 4.2 Statelessness

Lambda should not depend on mutable state that changes during execution.

## 4.3 Associativity

Reduction operation must give same result under different grouping.

## 4.4 Isolation/combination

Mutable accumulation must use isolated containers and correct combiner.

## 4.5 Rule

If any of these fail, parallel stream may produce wrong results.

---

# 5. Non-Interference

Non-interference means stream behavioral parameters must not modify the stream source.

Bad:

```java
List<User> users = new ArrayList<>(...);

users.parallelStream()
    .filter(User::inactive)
    .forEach(users::remove);
```

## 5.1 Why wrong

The stream is traversing `users` while lambdas mutate `users`.

Possible:

- `ConcurrentModificationException`;
- missed elements;
- duplicated traversal effects;
- undefined behavior;
- data corruption.

## 5.2 Correct alternatives

```java
users.removeIf(User::inactive);
```

or:

```java
List<User> active = users.stream()
    .filter(User::active)
    .toList();
```

## 5.3 Rule

The source must be stable for the duration of the stream unless it is explicitly concurrent and weak consistency is acceptable.

---

# 6. Statelessness

A stream lambda is stateless if result depends only on its input and immutable context.

Good:

```java
.map(user -> user.email().toLowerCase(Locale.ROOT))
```

Bad:

```java
int[] index = {0};

users.parallelStream()
    .map(user -> index[0]++ + ":" + user.name())
    .toList();
```

## 6.1 Race

Multiple threads mutate index.

## 6.2 Even AtomicInteger?

```java
AtomicInteger index = new AtomicInteger();

users.parallelStream()
    .map(user -> index.getAndIncrement() + ":" + user.name())
    .toList();
```

Thread-safe increment but order is nondeterministic.

## 6.3 Better

If index is based on list order:

```java
IntStream.range(0, users.size())
    .parallel()
    .mapToObj(i -> i + ":" + users.get(i).name())
    .toList();
```

## 6.4 Rule

Avoid external mutable state; derive from element, index source, or collector.

---

# 7. Associativity

Associativity means:

```text
(a op b) op c == a op (b op c)
```

Parallel reduction can regroup operations.

## 7.1 Associative examples

```java
Integer::sum
Long::sum
BigDecimal::add
BinaryOperator.maxBy(comparator)
set union
list concatenation by combiner
```

## 7.2 Non-associative examples

```java
(a, b) -> a - b
(a, b) -> a / b
string operation depending on side effects
operation depending on current time
```

## 7.3 Floating-point nuance

Mathematically addition is associative, but floating-point addition is not strictly associative due rounding.

## 7.4 Rule

Parallel reduction requires associative semantics, not just code that compiles.

---

# 8. Identity Element

Identity must be neutral.

For operation `op`, identity `e` must satisfy:

```text
e op x == x
x op e == x
```

## 8.1 Sum

```java
0
```

## 8.2 Product

```java
1
```

## 8.3 Max

Usually no safe generic identity.

Use Optional/max terminal.

## 8.4 Bad identity

```java
numbers.parallelStream()
    .reduce(10, Integer::sum);
```

In parallel, identity may be applied to multiple partitions, amplifying the error.

## 8.5 Rule

Fake identity is especially dangerous in parallel reduction.

---

# 9. Accumulator and Combiner Compatibility

For three-arg reduce:

```java
<U> U reduce(
    U identity,
    BiFunction<U, ? super T, U> accumulator,
    BinaryOperator<U> combiner
)
```

Accumulator:

```text
U + T -> U
```

Combiner:

```text
U + U -> U
```

They must agree.

## 9.1 Good

```java
int totalLength = words.parallelStream()
    .reduce(
        0,
        (sum, word) -> sum + word.length(),
        Integer::sum
    );
```

## 9.2 Bad

```java
int result = words.parallelStream()
    .reduce(
        0,
        (sum, word) -> sum + word.length(),
        (a, b) -> a * b
    );
```

Accumulator computes sums, combiner multiplies partial sums.

Wrong.

## 9.3 Rule

Combiner must merge partial accumulator results as if all elements had been accumulated in one pass.

---

# 10. The Three-Arg `reduce` Trap

Three-arg reduce is often misused for mutable containers.

Bad:

```java
List<String> result = users.parallelStream()
    .reduce(
        new ArrayList<>(),
        (list, user) -> {
            list.add(user.email());
            return list;
        },
        (a, b) -> {
            a.addAll(b);
            return a;
        }
    );
```

## 10.1 Why wrong

The identity object may be reused conceptually as neutral value, but mutable identity is not neutral under mutation.

## 10.2 Correct

```java
List<String> result = users.parallelStream()
    .map(User::email)
    .toList();
```

or:

```java
List<String> result = users.parallelStream()
    .map(User::email)
    .collect(Collectors.toList());
```

## 10.3 Rule

Use `reduce` for immutable values; use `collect` for mutable containers.

---

# 11. Bad Parallel Reductions

## 11.1 Subtraction

```java
int x = numbers.parallelStream()
    .reduce(0, (a, b) -> a - b);
```

Non-associative.

## 11.2 StringBuilder reduce

```java
StringBuilder sb = words.parallelStream()
    .reduce(
        new StringBuilder(),
        StringBuilder::append,
        StringBuilder::append
    );
```

Mutable identity bug.

## 11.3 External counter

```java
AtomicLong total = new AtomicLong();

orders.parallelStream()
    .forEach(order -> total.addAndGet(order.amountInCents()));
```

Maybe thread-safe, but contention and not idiomatic.

## 11.4 Current time in reduction

```java
.reduce(0L, (sum, x) -> sum + System.nanoTime())
```

Not deterministic.

## 11.5 Rule

Parallel reduction should be pure, associative, and not depend on external mutation/time/order unless explicitly designed.

---

# 12. Good Parallel Reductions

## 12.1 Primitive sum

```java
long total = orders.parallelStream()
    .mapToLong(Order::amountInCents)
    .sum();
```

## 12.2 BigDecimal sum

```java
BigDecimal total = invoices.parallelStream()
    .map(Invoice::amount)
    .reduce(BigDecimal.ZERO, BigDecimal::add);
```

## 12.3 Max

```java
Optional<Order> latest = orders.parallelStream()
    .max(Comparator.comparing(Order::createdAt));
```

## 12.4 Summary object

```java
record Summary(long count, long totalCents) {
    static Summary empty() {
        return new Summary(0, 0);
    }

    static Summary from(Order order) {
        return new Summary(1, order.amountInCents());
    }

    Summary merge(Summary other) {
        return new Summary(
            this.count + other.count,
            this.totalCents + other.totalCents
        );
    }
}

Summary summary = orders.parallelStream()
    .map(Summary::from)
    .reduce(Summary.empty(), Summary::merge);
```

## 12.5 Rule

Good reductions are value-based and mergeable.

---

# 13. Mutable Reduction Correctness

Mutable reduction should use `collect`.

```java
List<String> emails = users.parallelStream()
    .map(User::email)
    .collect(Collectors.toList());
```

## 13.1 Why safe

The framework can:

- create separate containers per partition;
- accumulate in isolation;
- combine containers safely.

## 13.2 Custom mutable collector

Must obey collector contract.

## 13.3 Rule

Parallel mutable accumulation belongs in collectors, not external state or reduce.

---

# 14. Collector Supplier Correctness

Supplier creates fresh accumulator.

Bad:

```java
List<String> shared = new ArrayList<>();

Collector<User, List<String>, List<String>> bad =
    Collector.of(
        () -> shared,
        (list, user) -> list.add(user.email()),
        (a, b) -> { a.addAll(b); return a; }
    );
```

## 14.1 Why wrong

Multiple partitions may share same mutable container.

## 14.2 Good

```java
Collector<User, List<String>, List<String>> good =
    Collector.of(
        ArrayList::new,
        (list, user) -> list.add(user.email()),
        (a, b) -> { a.addAll(b); return a; }
    );
```

## 14.3 Rule

Supplier must return a new independent accumulator every time.

---

# 15. Collector Accumulator Correctness

Accumulator must mutate only the provided container.

Bad:

```java
List<String> global = new ArrayList<>();

(acc, user) -> global.add(user.email())
```

Good:

```java
(acc, user) -> acc.add(user.email())
```

## 15.1 Rule

Accumulator must not write to shared external state.

---

# 16. Collector Combiner Correctness

Combiner merges two accumulators.

Good:

```java
(left, right) -> {
    left.addAll(right);
    return left;
}
```

Bad:

```java
(left, right) -> left
```

Drops right partition.

Bad:

```java
(left, right) -> {
    right.addAll(left);
    return right;
}
```

Might reverse order unexpectedly if order matters.

## 16.1 Rule

Combiner must preserve all accumulated data and semantics.

---

# 17. Collector Finisher Correctness

Finisher converts accumulator to final result.

## 17.1 Identity finisher

When accumulator is final result.

## 17.2 Transforming finisher

```java
list -> List.copyOf(list)
```

## 17.3 Bad characteristic

If finisher transforms but collector declares `IDENTITY_FINISH`, framework may skip finisher.

## 17.4 Rule

Finisher and characteristics must agree.

---

# 18. Collector Characteristics Correctness

Collector characteristics:

```java
IDENTITY_FINISH
UNORDERED
CONCURRENT
```

## 18.1 IDENTITY_FINISH

Only if accumulator type is final result and no transformation needed.

## 18.2 UNORDERED

Only if result semantics do not depend on encounter order.

## 18.3 CONCURRENT

Only if accumulator can be safely updated concurrently by multiple threads.

## 18.4 Rule

Characteristics are correctness promises, not optimization wishes.

---

# 19. Thread Confinement in Non-Concurrent Collectors

A non-concurrent collector can still be used in parallel.

Why?

The framework uses thread confinement:

```text
partition A -> accumulator A
partition B -> accumulator B
combine after accumulation
```

The accumulator does not need to be thread-safe if it is not shared concurrently.

## 19.1 Example

`Collectors.toList()` can work in parallel even if underlying list is not thread-safe because each partition accumulates separately.

## 19.2 Rule

Non-concurrent does not mean non-parallel; it means no concurrent calls to same accumulator.

---

# 20. `CONCURRENT` Collector Correctness

A concurrent collector allows accumulation into same result container from multiple threads.

## 20.1 Requirement

Accumulator container must support concurrent mutation.

Example:

```java
ConcurrentHashMap
LongAdder
ConcurrentLinkedQueue
```

## 20.2 Bad

Declaring `CONCURRENT` with `ArrayList`.

## 20.3 Ordering

Concurrent collection usually works best with unordered streams.

## 20.4 Rule

Use `CONCURRENT` only when the accumulator is truly thread-safe and order-insensitive if needed.

---

# 21. Ordering and Determinism

Parallel streams may complete partitions in arbitrary order.

Ordered streams still preserve encounter order for order-sensitive terminals, but at cost.

## 21.1 Deterministic result

```java
List<String> emails = users.parallelStream()
    .map(User::email)
    .toList();
```

For ordered source, list order should follow encounter order.

## 21.2 Non-deterministic side effect

```java
users.parallelStream()
    .forEach(user -> System.out.println(user.id()));
```

Output order nondeterministic.

## 21.3 Rule

A deterministic result is not the same as deterministic side-effect execution order.

---

# 22. `findFirst`, `findAny`, `forEach`, `forEachOrdered`

## 22.1 findFirst

Correct if first encounter-order element matters.

## 22.2 findAny

Correct if any element is acceptable.

## 22.3 forEach

Correct for unordered independent side effects.

## 22.4 forEachOrdered

Correct for ordered side effects, slower.

## 22.5 Rule

Choose terminal operation based on semantic order requirement, not habit.

---

# 23. Floating-Point Correctness

Floating-point reductions may produce different rounding under different grouping.

```java
double sum = values.parallelStream()
    .mapToDouble(Double::doubleValue)
    .sum();
```

## 23.1 Why

Floating-point addition is not strictly associative.

## 23.2 Acceptable

Scientific/approximate metrics may tolerate small variation.

## 23.3 Not acceptable

Accounting/ledger/money.

## 23.4 Rule

Do not expect bit-identical floating-point sums across grouping/parallel strategies.

---

# 24. BigDecimal and Exact Arithmetic

For exact decimal:

```java
BigDecimal total = invoices.parallelStream()
    .map(Invoice::amount)
    .reduce(BigDecimal.ZERO, BigDecimal::add);
```

## 24.1 Associative?

BigDecimal add is value-associative for exact decimal addition, but scale/rounding policies in other operations can matter.

## 24.2 Rounding

If you round during each step, grouping can change result.

Bad:

```java
(a, b) -> a.add(b).setScale(2, RoundingMode.HALF_UP)
```

Better:

```java
sum exactly, round once at boundary
```

## 24.3 Rule

For exact reductions, avoid per-step rounding that changes associativity.

---

# 25. Shared Mutable State

Bad:

```java
Map<Role, Integer> counts = new HashMap<>();

users.parallelStream()
    .forEach(user -> counts.merge(user.role(), 1, Integer::sum));
```

Race.

Better:

```java
Map<Role, Long> counts = users.parallelStream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.counting()
    ));
```

or concurrent:

```java
ConcurrentMap<Role, Long> counts = users.parallelStream()
    .collect(Collectors.groupingByConcurrent(
        User::role,
        Collectors.counting()
    ));
```

## 25.1 Rule

External shared mutable state is almost always wrong in parallel streams.

---

# 26. Atomic and Concurrent Containers: Correct but Still Wrong?

Thread-safe structures prevent some data races, but may still be poor design.

## 26.1 Atomic counter

```java
AtomicLong total = new AtomicLong();

orders.parallelStream()
    .forEach(order -> total.addAndGet(order.amountInCents()));
```

May produce correct total but with contention.

Better:

```java
long total = orders.parallelStream()
    .mapToLong(Order::amountInCents)
    .sum();
```

## 26.2 Concurrent queue

```java
Queue<Result> q = new ConcurrentLinkedQueue<>();

items.parallelStream()
    .map(this::compute)
    .forEach(q::add);
```

May be correct but unordered and maybe slower than collect.

## 26.3 Rule

Thread-safe side effects are not automatically semantically clean or performant.

---

# 27. Side Effects and External Systems

External systems include:

- database;
- HTTP service;
- message broker;
- email;
- payment gateway;
- file system.

Parallel stream does not provide:

- transaction boundary;
- retry policy;
- idempotency;
- rate limiting;
- backpressure;
- ordering guarantee;
- rollback after exception.

## 27.1 Bad

```java
orders.parallelStream()
    .forEach(paymentClient::charge);
```

## 27.2 Better

Build commands:

```java
List<ChargeCommand> commands = orders.stream()
    .map(ChargeCommand::from)
    .toList();
```

Then execute through controlled workflow.

## 27.3 Rule

Do not use parallel streams as side-effect orchestration framework.

---

# 28. Exception and Cancellation Semantics

If one task fails, other parallel tasks may already be running.

## 28.1 No rollback

Side effects already performed remain.

## 28.2 Partial execution

Some elements processed, some not.

## 28.3 Better

For pure computation:

```java
List<Result> results = items.parallelStream()
    .map(this::compute)
    .toList();
```

For per-item failures, model result explicitly:

```java
List<Try<Result>> results = items.parallelStream()
    .map(this::tryCompute)
    .toList();
```

## 28.4 Rule

Parallel stream exceptions are not workflow compensation.

---

# 29. Memory Visibility and Safe Publication

If parallel stream returns a result through collector/reduction, framework handles necessary coordination for that result.

But if lambdas mutate external objects, you own memory visibility/thread-safety.

## 29.1 Bad

```java
Status status = new Status();

items.parallelStream()
    .forEach(item -> status.lastProcessed = item.id());
```

Race and visibility issues.

## 29.2 Better

Return result values and reduce/collect.

## 29.3 Rule

Do not rely on accidental visibility of unsynchronized external mutations.

---

# 30. Source Mutation and Concurrent Sources

## 30.1 Non-concurrent source

Do not mutate while streaming.

## 30.2 Concurrent source

Concurrent collections may allow traversal while mutation, but result may be weakly consistent.

Example:

```java
ConcurrentHashMap<Key, Value> map = new ConcurrentHashMap<>();

map.entrySet().parallelStream()
```

May reflect some concurrent updates and not others.

## 30.3 Rule

Concurrent source does not mean deterministic snapshot.

---

# 31. Testing Parallel Correctness

Test parallel stream code with:

## 31.1 Sequential vs parallel equivalence

```java
assertEquals(
    sequentialResult(input),
    parallelResult(input)
);
```

## 31.2 Repeated runs

Parallel bugs can be intermittent.

## 31.3 Different input sizes

Small, medium, large.

## 31.4 Duplicate/order cases

Especially for collectors/maps.

## 31.5 Randomized input order

To catch order assumptions.

## 31.6 Parallel stress

Run many times.

## 31.7 Rule

Parallel correctness tests should try to break hidden ordering and shared-state assumptions.

---

# 32. Property-Based Thinking

Think in properties:

## 32.1 Sum property

```text
parallel sum == sequential sum
```

## 32.2 Grouping property

```text
total count across groups == input size
```

## 32.3 Set property

```text
distinct output contains same unique elements
```

## 32.4 Latest property

```text
latestByKey[k] has max timestamp among input with key k
```

## 32.5 Rule

Parallel correctness is easier to test as invariants/properties.

---

# 33. Production Review Checklist

Before approving parallel stream:

## 33.1 Source

- Bounded?
- Stable?
- Splits well?

## 33.2 Lambdas

- Stateless?
- Non-interfering?
- No external mutation?

## 33.3 Reduction

- Identity true?
- Associative?
- Combiner compatible?

## 33.4 Collector

- Supplier fresh?
- Accumulator local?
- Combiner complete?
- Characteristics honest?

## 33.5 Ordering

- Is order required?
- Are terminals correct?

## 33.6 Side effects

- Any external effects?
- Idempotency?
- Rate limits?
- Transactions?

## 33.7 Testing

- Sequential vs parallel?
- Repeated?
- Edge cases?

## 33.8 Rule

Parallel stream review is correctness review before performance review.

---

# 34. Common Anti-Patterns

## 34.1 Parallel stream with ArrayList external add

Wrong.

## 34.2 Atomic counter instead of reduction

Poor style/contention.

## 34.3 Non-associative reduce

Wrong.

## 34.4 Mutable identity in reduce

Wrong.

## 34.5 Shared supplier in collector

Wrong.

## 34.6 Wrong combiner drops data

Wrong.

## 34.7 Declaring CONCURRENT on non-thread-safe accumulator

Wrong.

## 34.8 Parallel HTTP/DB calls

Wrong abstraction.

## 34.9 Assuming forEach order

Wrong.

## 34.10 Ignoring floating-point variance

Bug for exact domains.

---

# 35. Production Failure Modes

## 35.1 Missing results

External mutable list corrupted.

## 35.2 Wrong totals

Non-associative reduce or int overflow.

## 35.3 Duplicate or lost grouped data

Bad collector combiner.

## 35.4 Data races

Shared mutable object mutation.

## 35.5 Nondeterministic output

forEach/order assumptions.

## 35.6 Money mismatch

Double or per-step rounding.

## 35.7 External system overload

Parallel side effects.

## 35.8 Partial side effects

Exception/cancellation.

## 35.9 Flaky tests

Hidden order/concurrency assumptions.

## 35.10 Memory visibility bug

Unsynchronized external mutation.

---

# 36. Best Practices

## 36.1 Prefer pure functions

Stateless, deterministic, no mutation.

## 36.2 Use built-in reductions

`sum`, `count`, `min`, `max`, collectors.

## 36.3 Avoid external mutable state

Return values, collect, reduce.

## 36.4 Use collect for mutable accumulation

Not reduce.

## 36.5 Validate algebra

Associativity and identity.

## 36.6 Make ordering explicit

Use `findAny` when any is enough; `forEachOrdered` only if required.

## 36.7 Avoid external side effects

Especially DB/network/payment/email.

## 36.8 Test sequential vs parallel

Repeatedly and with edge cases.

## 36.9 Document assumptions

Key uniqueness, order, merge policy, precision.

## 36.10 Measure after correctness

Performance comes second.

---

# 37. Decision Matrix

| Situation | Parallel Correct? | Recommendation |
|---|---:|---|
| pure map over ArrayList | likely | okay if measured |
| primitive sum | yes | use `mapToLong().sum()` |
| subtraction reduce | no | do not parallelize |
| mutable ArrayList in reduce | no | use collect/toList |
| external ArrayList add | no | use collector |
| AtomicLong add | maybe correct but poor | use reduction |
| groupingBy counting | yes | okay; measure |
| custom collector with fresh supplier/correct combiner | maybe | test parallel |
| custom collector with shared accumulator | no | redesign |
| DB save in forEach | dangerous | explicit transaction/batch |
| HTTP calls in parallel stream | dangerous | bounded executor/reactive |
| find first in ordered stream | correct but costly | use only if needed |
| find any match | yes | use findAny/anyMatch |
| floating sum exact requirement | no | BigDecimal/minor units |
| BigDecimal add no rounding | yes | okay |
| BigDecimal per-step rounding | risky | round once at boundary |
| concurrent source stream | maybe weakly consistent | snapshot if deterministic needed |
| order-sensitive output | maybe | use ordered terminal/container |
| unordered output acceptable | yes | consider `unordered()` |

---

# 38. Latihan

## Latihan 1 — Sequential vs Parallel Result

Write a function with external ArrayList accumulation.

Explain why sequential may pass and parallel fails.

## Latihan 2 — Associativity

Test addition vs subtraction under different grouping.

## Latihan 3 — Bad Identity

Use `reduce(10, Integer::sum)` in parallel and explain amplified identity issue.

## Latihan 4 — Three-Arg Reduce

Implement total string length with correct accumulator/combiner.

Then implement wrong combiner and explain.

## Latihan 5 — Mutable Reduce

Use StringBuilder in reduce. Explain why wrong.

Fix with `Collectors.joining`.

## Latihan 6 — Custom Collector

Write collector for `Summary(count,total)`.

Test sequential and parallel.

## Latihan 7 — Concurrent Collector

Explain when `CONCURRENT` characteristic is valid.

## Latihan 8 — Floating-Point

Compare double sum in different orders. Explain why exact equality can fail.

## Latihan 9 — Side Effects

Design why `parallelStream().forEach(paymentClient::charge)` is unsafe.

## Latihan 10 — Review Checklist

Take an existing stream pipeline and review using the production checklist.

---

# 39. Ringkasan

Parallel stream correctness is stricter than sequential correctness.

Core lessons:

- Sequential correctness does not imply parallel correctness.
- Parallel stream can split, regroup, reorder completion, and combine partial results.
- Lambdas must be non-interfering and usually stateless.
- Reductions need true identity and associative operation.
- Three-arg reduce needs compatible accumulator and combiner.
- Do not use mutable identity in reduce.
- Use collect for mutable accumulation.
- Collector supplier must be fresh.
- Collector accumulator must mutate only provided container.
- Collector combiner must merge complete partial results.
- Collector characteristics must be truthful.
- Non-concurrent collectors can still work in parallel via thread confinement.
- CONCURRENT collectors require truly concurrent accumulators.
- Ordering and determinism must be explicit.
- Floating-point reductions may vary with grouping.
- External shared mutable state is dangerous.
- Atomic/concurrent containers do not automatically mean good design.
- External side effects need workflow semantics, not parallel streams.
- Exceptions do not roll back partial side effects.
- Test sequential vs parallel equivalence and invariants.

Main rule:

```text
A parallel stream is correct only if the pipeline means the same thing
when input is split into arbitrary partitions,
processed independently,
and partial results are combined.
```

---

# 40. Referensi

1. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

2. Java SE 25 — `java.util.stream` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

3. Java SE 25 — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

4. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

5. Java SE 25 — `BaseStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/BaseStream.html

6. Java SE 25 — `Spliterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterator.html

7. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

8. Java SE 25 — `AtomicLong`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicLong.html

9. Java SE 25 — `BigDecimal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html

10. OpenJDK — Stream package source  
    https://github.com/openjdk/jdk/tree/master/src/java.base/share/classes/java/util/stream

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-037.md](./learn-java-collections-and-streams-part-037.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-039.md](./learn-java-collections-and-streams-part-039.md)

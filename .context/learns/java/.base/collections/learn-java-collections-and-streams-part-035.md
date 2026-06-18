# learn-java-collections-and-streams-part-035.md

# Java Collections and Streams — Part 035  
# Laziness, Fusion, and Short-Circuiting: Stream Execution Model, Pull-Based Pipelines, Stateless vs Stateful Barriers, Infinite Streams, Operation Reordering, and Production Performance

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **035**  
> Fokus: memahami bagaimana stream benar-benar dieksekusi: lazy pipeline, terminal-triggered execution, per-element fusion, short-circuiting, cancellation, stateful operation barriers, infinite stream safety, ordering cost, debugging traps, dan performance reasoning.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Stream Pipeline adalah Rencana, Bukan Eksekusi](#2-mental-model-stream-pipeline-adalah-rencana-bukan-eksekusi)
3. [Lazy Evaluation](#3-lazy-evaluation)
4. [Terminal Operation sebagai Trigger](#4-terminal-operation-sebagai-trigger)
5. [Pull-Based Execution](#5-pull-based-execution)
6. [Pipeline Fusion](#6-pipeline-fusion)
7. [Per-Element Processing](#7-per-element-processing)
8. [Stateless Operation Fusion](#8-stateless-operation-fusion)
9. [Stateful Operation as Barrier](#9-stateful-operation-as-barrier)
10. [`sorted` Barrier](#10-sorted-barrier)
11. [`distinct` Stateful Behavior](#11-distinct-stateful-behavior)
12. [`limit` and Cancellation](#12-limit-and-cancellation)
13. [`skip` and Ordered Cost](#13-skip-and-ordered-cost)
14. [`takeWhile` and `dropWhile`](#14-takewhile-and-dropwhile)
15. [Short-Circuiting Intermediate Operations](#15-short-circuiting-intermediate-operations)
16. [Short-Circuiting Terminal Operations](#16-short-circuiting-terminal-operations)
17. [Infinite Streams](#17-infinite-streams)
18. [Why `filter` Alone Does Not Bound Infinite Streams](#18-why-filter-alone-does-not-bound-infinite-streams)
19. [Operation Ordering and Work Avoidance](#19-operation-ordering-and-work-avoidance)
20. [Cheap Filter Before Expensive Map](#20-cheap-filter-before-expensive-map)
21. [Limit Placement Semantics](#21-limit-placement-semantics)
22. [Sorted Before Limit vs Limit Before Sorted](#22-sorted-before-limit-vs-limit-before-sorted)
23. [Peek and Laziness Trap](#23-peek-and-laziness-trap)
24. [Side Effects and Partial Execution](#24-side-effects-and-partial-execution)
25. [Resource-Backed Streams and Laziness](#25-resource-backed-streams-and-laziness)
26. [Parallel Streams: Fusion and Splitting](#26-parallel-streams-fusion-and-splitting)
27. [Ordering Constraints in Parallel Short-Circuiting](#27-ordering-constraints-in-parallel-short-circuiting)
28. [Cancellation Is Cooperative, Not Magic](#28-cancellation-is-cooperative-not-magic)
29. [Debugging Lazy Pipelines](#29-debugging-lazy-pipelines)
30. [Performance Cost Model](#30-performance-cost-model)
31. [Common Anti-Patterns](#31-common-anti-patterns)
32. [Production Failure Modes](#32-production-failure-modes)
33. [Best Practices](#33-best-practices)
34. [Decision Matrix](#34-decision-matrix)
35. [Latihan](#35-latihan)
36. [Ringkasan](#36-ringkasan)
37. [Referensi](#37-referensi)

---

# 1. Tujuan Bagian Ini

Stream sering terlihat seperti chain method biasa:

```java
List<String> result = users.stream()
    .filter(User::active)
    .map(User::email)
    .distinct()
    .limit(10)
    .toList();
```

Tetapi cara eksekusinya tidak seperti:

```text
1. buat collection hasil filter
2. buat collection hasil map
3. buat collection hasil distinct
4. ambil 10
```

Tidak begitu.

Stream pipeline pada umumnya lazy dan fused.

Artinya:

- intermediate operations hanya membuat rencana;
- terminal operation memulai eksekusi;
- banyak stateless operation diproses per element dalam satu traversal;
- beberapa operation bisa short-circuit;
- beberapa operation stateful menjadi barrier;
- source mungkin tidak dibaca seluruhnya;
- side effect bisa tidak terjadi jika tidak ada terminal;
- infinite stream bisa aman atau bisa menggantung selamanya;
- order constraints bisa membuat parallel stream mahal.

Tujuan part ini:

- membangun mental model lazy execution;
- memahami fusion;
- memahami short-circuiting;
- memahami barrier stateful operations;
- memahami infinite stream;
- memahami stage ordering untuk performance dan correctness;
- menghindari debug/production traps.

---

# 2. Mental Model: Stream Pipeline adalah Rencana, Bukan Eksekusi

Kode ini:

```java
Stream<String> pipeline = users.stream()
    .filter(User::active)
    .map(User::email);
```

belum memproses user.

Pipeline hanya menyimpan rencana:

```text
source = users
stage 1 = filter active
stage 2 = map email
```

Eksekusi baru terjadi saat terminal operation:

```java
List<String> emails = pipeline.toList();
```

## 2.1 Analogy

Bayangkan pipeline seperti rute conveyor belt yang dirancang, tetapi mesin belum dinyalakan.

Terminal operation adalah tombol start.

## 2.2 Rule

```text
Intermediate operations define computation.
Terminal operations execute computation.
```

---

# 3. Lazy Evaluation

Lazy evaluation berarti computation ditunda sampai result dibutuhkan.

## 3.1 Example

```java
Stream<String> s = names.stream()
    .filter(name -> {
        System.out.println("filter " + name);
        return name.length() > 3;
    });
```

Tidak ada output sebelum terminal operation.

```java
s.toList();
```

Baru output muncul.

## 3.2 Benefit

Laziness memungkinkan:

- avoid unnecessary work;
- short-circuiting;
- process large source incrementally;
- compose pipeline before execution.

## 3.3 Danger

Jika kamu mengandalkan side effect di intermediate operation, side effect tidak terjadi tanpa terminal operation.

## 3.4 Rule

Lazy pipeline is powerful for efficiency but dangerous for hidden side effects.

---

# 4. Terminal Operation sebagai Trigger

Terminal operations:

```java
toList
collect
count
findFirst
findAny
anyMatch
allMatch
noneMatch
reduce
forEach
min
max
```

memulai traversal.

## 4.1 Example

```java
long count = users.stream()
    .filter(User::active)
    .count();
```

`count()` mengeksekusi pipeline.

## 4.2 Stream consumed

Setelah terminal operation, stream tidak boleh digunakan lagi.

## 4.3 Rule

Terminal operation is the execution boundary.

---

# 5. Pull-Based Execution

Stream pipeline secara mental bisa dianggap pull-based.

Terminal operation meminta element berikutnya dari upstream.

```text
terminal asks -> upstream stage asks -> source supplies
```

Example:

```java
users.stream()
    .filter(User::active)
    .map(User::email)
    .findFirst();
```

`findFirst` butuh satu element yang lolos.

Pipeline akan mengambil element dari source sampai menemukan active user pertama.

Tidak perlu memproses semua users.

## 5.1 Push vs pull mental model

Push:

```text
source pushes all elements downstream
```

Pull:

```text
terminal pulls as much as needed
```

Stream implementation detail lebih kompleks, tapi pull mental model membantu memahami short-circuit.

## 5.2 Rule

Terminal operation often determines how much of the source is consumed.

---

# 6. Pipeline Fusion

Fusion berarti beberapa stage digabung dalam satu traversal, tanpa membuat intermediate collection.

Example:

```java
List<String> emails = users.stream()
    .filter(User::active)
    .map(User::email)
    .toList();
```

Tidak berarti:

```java
List<User> active = ...
List<String> emails = ...
```

Melainkan secara mental:

```java
for (User user : users) {
    if (user.active()) {
        result.add(user.email());
    }
}
```

## 6.1 Why important

Fusion reduces:

- intermediate allocations;
- memory usage;
- repeated traversal;
- latency to first result for short-circuit terminals.

## 6.2 Rule

Stateless stream pipelines usually behave like fused loops.

---

# 7. Per-Element Processing

For stateless pipeline:

```java
users.stream()
    .filter(User::active)
    .map(User::email)
    .filter(email -> email.endsWith("@company.com"))
    .toList();
```

Each element flows through stages:

```text
user1 -> filter -> map -> filter -> maybe output
user2 -> filter -> map -> filter -> maybe output
...
```

## 7.1 No full stage completion

`map` does not wait for filter to finish all users.

## 7.2 Benefit

If terminal short-circuits, only few elements may be processed.

## 7.3 Rule

For stateless operations, think element-by-element through the pipeline.

---

# 8. Stateless Operation Fusion

Stateless operations include:

```java
filter
map
mapToInt
flatMap
mapMulti
peek
```

They do not need to remember previously seen elements.

## 8.1 Example

```java
orders.stream()
    .filter(Order::paid)
    .mapToLong(Order::amountInCents)
    .sum();
```

This can be fused like:

```java
long sum = 0;
for (Order order : orders) {
    if (order.paid()) {
        sum += order.amountInCents();
    }
}
```

## 8.2 Caveat flatMap

`flatMap` can create nested streams, but still conceptually emits downstream lazily.

## 8.3 Rule

Stateless operations are stream-friendly and fusion-friendly.

---

# 9. Stateful Operation as Barrier

Stateful operations need memory of elements.

Examples:

```java
distinct
sorted
limit
skip
takeWhile
dropWhile
```

Some are more barrier-like than others.

## 9.1 Barrier idea

A barrier operation may need to see many or all elements before downstream can proceed.

## 9.2 Example sorted

```java
stream.sorted().findFirst()
```

May need all elements to know first sorted element.

Better:

```java
stream.min(comparator)
```

## 9.3 Rule

Stateful operations can break the simple fused-per-element mental model.

---

# 10. `sorted` Barrier

`sorted()` usually needs to buffer all input before emitting sorted output.

## 10.1 Example

```java
users.stream()
    .sorted(Comparator.comparing(User::createdAt))
    .limit(10)
    .toList();
```

This sorts all users, then takes 10.

## 10.2 Memory

Needs memory proportional to input size.

## 10.3 Infinite stream

```java
Stream.iterate(0, n -> n + 1)
    .sorted()
    .limit(10)
```

Cannot finish because sorted needs all elements.

## 10.4 Rule

`sorted` is a full-ordering barrier. Avoid it unless full sorted output is required.

---

# 11. `distinct` Stateful Behavior

`distinct()` remembers seen elements.

## 11.1 Example

```java
stream.distinct()
```

Requires a set of seen values.

## 11.2 Ordered distinct

For ordered streams, first occurrence is preserved.

## 11.3 Infinite stream

If infinite stream has unbounded unique values:

```java
Stream.iterate(0, n -> n + 1)
    .distinct()
    .limit(10)
```

This particular example can finish because limit after distinct only needs first 10 and every item is unique.

But:

```java
Stream.generate(() -> randomValue())
    .distinct()
    .count()
```

does not finish and memory grows.

## 11.4 Rule

`distinct` can be safe with bounding terminal but can grow memory unbounded.

---

# 12. `limit` and Cancellation

`limit(n)` can stop upstream after n elements have been emitted downstream.

## 12.1 Example

```java
Stream.iterate(0, n -> n + 1)
    .limit(10)
    .toList();
```

Safe finite result.

## 12.2 With filter before limit

```java
Stream.iterate(0, n -> n + 1)
    .filter(n -> n % 2 == 0)
    .limit(10)
    .toList();
```

Consumes enough upstream elements to find 10 evens.

## 12.3 Cancellation

After enough elements, pipeline signals no more needed.

## 12.4 Rule

`limit` bounds downstream output, not necessarily exact upstream reads in all cases.

---

# 13. `skip` and Ordered Cost

`skip(n)` discards first n elements.

## 13.1 Not short-circuit by itself

```java
Stream.iterate(0, n -> n + 1)
    .skip(100)
    .count();
```

Still infinite.

## 13.2 With limit

```java
Stream.iterate(0, n -> n + 1)
    .skip(100)
    .limit(10)
    .toList();
```

Safe.

## 13.3 Ordered parallel

Skipping first n in encounter order can be expensive.

## 13.4 Rule

`skip` is slicing, not bounding.

---

# 14. `takeWhile` and `dropWhile`

## 14.1 takeWhile

Takes prefix while predicate true.

```java
IntStream.iterate(1, n -> n + 1)
    .takeWhile(n -> n <= 10)
    .toList();
```

Can make infinite sequence finite if predicate eventually false.

## 14.2 dropWhile

Drops prefix while predicate true, then emits rest.

```java
IntStream.iterate(1, n -> n + 1)
    .dropWhile(n -> n < 10)
```

Still infinite unless bounded later.

## 14.3 Rule

`takeWhile` can bound; `dropWhile` alone does not bound.

---

# 15. Short-Circuiting Intermediate Operations

A short-circuiting intermediate operation can produce finite stream from infinite input.

Examples:

```java
limit
takeWhile
```

## 15.1 limit

```java
Stream.generate(UUID::randomUUID)
    .limit(5)
```

## 15.2 takeWhile

```java
Stream.iterate(1, n -> n + 1)
    .takeWhile(n -> n <= 5)
```

## 15.3 Necessary but not sufficient

A short-circuiting operation in pipeline is necessary for some infinite streams to finish, but terminal operation and operation order still matter.

## 15.4 Rule

For infinite source, explicitly identify the bounding operation.

---

# 16. Short-Circuiting Terminal Operations

Terminal operations can stop early.

Examples:

```java
findFirst
findAny
anyMatch
allMatch
noneMatch
```

## 16.1 anyMatch

Stops when predicate true.

```java
boolean hasAdmin = users.stream()
    .anyMatch(User::admin);
```

## 16.2 allMatch

Stops when predicate false.

## 16.3 noneMatch

Stops when predicate true.

## 16.4 findFirst/findAny

Stop when element found.

## 16.5 Rule

Short-circuit terminal operations can avoid full traversal.

---

# 17. Infinite Streams

Infinite sources include:

```java
Stream.generate(...)
Stream.iterate(...)
IntStream.iterate(...)
Random.ints()
```

## 17.1 Safe

```java
Stream.generate(UUID::randomUUID)
    .limit(10)
    .toList();
```

## 17.2 Unsafe

```java
Stream.generate(UUID::randomUUID)
    .toList();
```

Never completes or OOMs.

## 17.3 Maybe safe

```java
Stream.generate(this::event)
    .anyMatch(Event::isStopSignal)
```

Only finishes if stop signal eventually appears.

## 17.4 Rule

Every infinite stream needs a termination story.

---

# 18. Why `filter` Alone Does Not Bound Infinite Streams

```java
Stream.iterate(0, n -> n + 1)
    .filter(n -> n < 10)
    .toList();
```

This does not finish.

Why?

Because filter rejects elements >= 10, but source keeps producing infinite values.

Output stops growing, but traversal never knows source is done.

## 18.1 Correct

```java
Stream.iterate(0, n -> n + 1)
    .takeWhile(n -> n < 10)
    .toList();
```

or:

```java
Stream.iterate(0, n -> n + 1)
    .limit(10)
    .toList();
```

## 18.2 Rule

Filter selects; it does not terminate an infinite source.

---

# 19. Operation Ordering and Work Avoidance

Stage order matters.

## 19.1 Expensive map before filter

Bad:

```java
users.stream()
    .map(this::expensiveProjection)
    .filter(UserDto::active)
    .toList();
```

If possible, filter first:

```java
users.stream()
    .filter(User::active)
    .map(this::expensiveProjection)
    .toList();
```

## 19.2 Limit before map

If semantics allow:

```java
users.stream()
    .limit(10)
    .map(this::expensiveProjection)
```

versus mapping all then limit.

## 19.3 Rule

Put cheap/selective/bounding operations before expensive operations when semantics allow.

---

# 20. Cheap Filter Before Expensive Map

Example:

```java
List<ReportRow> rows = orders.stream()
    .filter(Order::isCompleted)
    .filter(order -> order.amountInCents() > 0)
    .map(this::buildExpensiveReportRow)
    .toList();
```

This avoids building report rows for irrelevant orders.

## 20.1 But preserve semantics

Do not reorder if map changes data needed by filter.

## 20.2 Rule

Optimization cannot change meaning.

---

# 21. Limit Placement Semantics

`limit` placement changes result.

## 21.1 Filter then limit

```java
users.stream()
    .filter(User::active)
    .limit(10)
```

Means first 10 active users.

## 21.2 Limit then filter

```java
users.stream()
    .limit(10)
    .filter(User::active)
```

Means active users among first 10 users.

## 21.3 Rule

Limit is not just performance optimization; it changes semantics.

---

# 22. Sorted Before Limit vs Limit Before Sorted

## 22.1 Sorted then limit

```java
orders.stream()
    .sorted(Comparator.comparing(Order::createdAt).reversed())
    .limit(10)
```

Top 10 latest orders globally.

## 22.2 Limit then sorted

```java
orders.stream()
    .limit(10)
    .sorted(Comparator.comparing(Order::createdAt).reversed())
```

Sort only first 10 encounter-order orders.

## 22.3 Better for top 1

Use max:

```java
orders.stream()
    .max(Comparator.comparing(Order::createdAt))
```

## 22.4 Rule

Moving sorted/limit changes meaning; do not optimize blindly.

---

# 23. Peek and Laziness Trap

`peek` is lazy.

```java
Stream<User> s = users.stream()
    .peek(user -> log.info("{}", user.id()));
```

No log until terminal operation.

## 23.1 With short-circuit

```java
users.stream()
    .peek(user -> audit(user))
    .findFirst();
```

Only some elements audited.

## 23.2 With count optimization

Some pipelines may not evaluate stages if result can be computed from source size and stages do not affect count. Do not rely on `peek` for required side effects.

## 23.3 Rule

`peek` is for debugging, not business logic.

---

# 24. Side Effects and Partial Execution

Because of laziness and short-circuiting, side effects may be:

- not executed;
- partially executed;
- executed in unexpected order;
- executed concurrently in parallel stream.

## 24.1 Bad

```java
users.stream()
    .map(user -> {
        notificationService.send(user);
        return user.email();
    })
    .findFirst();
```

Only enough sends happen to satisfy findFirst.

## 24.2 Better

If sending is required for all:

```java
for (User user : users) {
    notificationService.send(user);
}
```

## 24.3 Rule

Business-critical side effects should not be hidden in lazy intermediate operations.

---

# 25. Resource-Backed Streams and Laziness

Resource-backed streams read lazily.

Example:

```java
try (Stream<String> lines = Files.lines(path)) {
    return lines
        .filter(line -> line.contains("ERROR"))
        .findFirst();
}
```

This may not read the whole file.

## 25.1 Benefit

Efficient search.

## 25.2 Danger

Returning stream outside resource scope:

```java
Stream<String> lines(Path path) throws IOException {
    try (Stream<String> s = Files.lines(path)) {
        return s; // broken
    }
}
```

The stream is closed before use.

## 25.3 Rule

Lazy resource streams must be consumed inside resource lifetime.

---

# 26. Parallel Streams: Fusion and Splitting

Parallel streams split source into partitions.

Each partition may run fused pipeline locally.

```text
source split -> partition pipelines -> combine terminal results
```

## 26.1 Good source

ArrayList, arrays, ranges.

## 26.2 Bad source

Unknown-size iterator, IO stream, linked structure.

## 26.3 Stateful barriers

Sorted/distinct/ordered limit can require coordination.

## 26.4 Rule

Parallel performance requires good source splitting and low coordination.

---

# 27. Ordering Constraints in Parallel Short-Circuiting

## 27.1 findAny

Flexible.

```java
parallelStream.findAny()
```

Can return any found element.

## 27.2 findFirst

Must respect encounter order.

```java
parallelStream.findFirst()
```

May need coordination.

## 27.3 ordered limit

Must return first n encounter-order elements.

## 27.4 unordered limit

Can return any n elements.

## 27.5 Rule

Order constraints reduce short-circuit freedom in parallel.

---

# 28. Cancellation Is Cooperative, Not Magic

Short-circuiting uses cancellation mechanics internally.

But:

- already-started work may continue briefly;
- parallel tasks may process extra elements;
- resource operations may not stop instantly;
- side effects already performed are not undone.

## 28.1 Example

```java
users.parallelStream()
    .peek(this::sideEffect)
    .anyMatch(User::admin);
```

Even after admin found, some side effects may already have happened.

## 28.2 Rule

Short-circuiting reduces work; it is not transactional cancellation.

---

# 29. Debugging Lazy Pipelines

## 29.1 Use peek carefully

Good:

```java
.peek(x -> log.debug("after filter: {}", x))
```

Bad as business action.

## 29.2 Break into named methods

```java
.filter(this::isEligible)
.map(this::toDto)
```

## 29.3 Materialize small sample

For debugging only:

```java
List<T> sample = stream.limit(10).toList();
```

## 29.4 Use tests for semantics

Test operation ordering explicitly.

## 29.5 Rule

Debugging stream laziness requires remembering that nothing happens before terminal operation.

---

# 30. Performance Cost Model

## 30.1 Stateless fused pipeline

Cost roughly:

```text
source traversal + per-element functions + terminal accumulation
```

## 30.2 Stateful barriers

Additional cost:

```text
memory + buffering + sorting/hash set + coordination
```

## 30.3 Short-circuiting

Can reduce input consumed.

## 30.4 Infinite streams

Need bounding/short-circuit.

## 30.5 Parallel

Cost:

```text
splitting + per-partition work + combining + coordination
```

## 30.6 Rule

Performance reasoning starts by identifying fused stages, barriers, and short-circuit opportunities.

---

# 31. Common Anti-Patterns

## 31.1 Pipeline without terminal expecting execution

No-op.

## 31.2 `peek` for required action

Wrong.

## 31.3 `filter` expecting to stop infinite stream

Wrong.

## 31.4 `sorted().limit(n)` for top-N on huge stream without considering cost

Potentially expensive.

## 31.5 `sorted().findFirst()` instead of `min`

Inefficient.

## 31.6 Side effects with short-circuit terminal

Partial execution.

## 31.7 Returning resource-backed stream from closed scope

Broken.

## 31.8 Parallel ordered short-circuit expecting huge speedup

Often disappointing.

## 31.9 Reordering stages without checking semantics

Correctness bug.

## 31.10 Rule

Most laziness bugs are “I thought this operation already happened” bugs.

---

# 32. Production Failure Modes

## 32.1 Audit not executed

Cause: audit in `peek` and no terminal/short-circuit terminal.

## 32.2 Infinite job hangs

Cause: `filter` on infinite stream with non-bounding terminal.

## 32.3 OOM

Cause: infinite stream collected or `distinct`/`sorted` on huge/infinite source.

## 32.4 Slow top-N

Cause: full sort before limit.

## 32.5 File closed error

Cause: returning lazy stream from closed resource.

## 32.6 Partial side effects

Cause: `findFirst`/`anyMatch` short-circuits.

## 32.7 Parallel stream slower

Cause: stateful barriers and order constraints.

## 32.8 Nondeterministic side effect order

Cause: parallel `forEach`/peek.

## 32.9 Unexpected zero logs

Cause: no terminal operation.

## 32.10 Extra work after match found

Cause: cooperative cancellation in parallel.

---

# 33. Best Practices

## 33.1 Identify terminal operation

Before trusting pipeline, know what triggers it.

## 33.2 Keep intermediate operations pure

Avoid required side effects.

## 33.3 Use short-circuit terminals intentionally

`anyMatch`, `findFirst`, `findAny`.

## 33.4 Bound infinite streams

`limit` or `takeWhile`.

## 33.5 Put cheap filters early

When semantics allow.

## 33.6 Avoid full barriers if simpler terminal exists

Use `min/max` instead of sort+find.

## 33.7 Consume resource streams in try-with-resources

Never leak lazy stream outside resource lifetime.

## 33.8 Measure parallel pipelines

Especially with order/stateful operations.

## 33.9 Make stage order semantic

Do not reorder just for performance unless equivalent.

---

# 34. Decision Matrix

| Situation | Recommendation |
|---|---|
| pipeline does nothing | add terminal operation |
| debugging element flow | `peek` temporarily |
| required side effect | loop or explicit terminal with care |
| infinite source | add `limit`/`takeWhile` or short-circuit terminal |
| filter infinite sequence by upper bound | use `takeWhile`, not `filter` |
| find any match | `anyMatch`/`findAny` |
| find first by order | `findFirst` on ordered stream |
| top 1 by comparator | `min`/`max` |
| top N globally | sort+limit or bounded heap collector |
| huge sort | avoid if possible |
| remove duplicates | `distinct`, watch memory |
| ordered parallel slow | consider `unordered()` if correct |
| resource stream | consume inside try-with-resources |
| count after side-effect peek | do not rely on peek execution |
| expensive map | filter/limit before map if semantics allow |
| skip without limit on infinite | unsafe |
| parallel short-circuit with side effects | avoid |

---

# 35. Latihan

## Latihan 1 — No Terminal No Execution

Create stream with `peek(System.out::println)` but no terminal. Observe no output.

## Latihan 2 — Fusion

Use filter + map + terminal and log each stage. Observe per-element flow.

## Latihan 3 — findFirst Short-Circuit

Use list of users where first active is near start. Count how many elements are inspected.

## Latihan 4 — Filter Infinite Trap

Run conceptually:

```java
IntStream.iterate(0, n -> n + 1)
    .filter(n -> n < 10)
    .boxed()
    .toList();
```

Explain why it never finishes.

## Latihan 5 — takeWhile Fix

Rewrite previous using `takeWhile`.

## Latihan 6 — sorted Barrier

Explain why `sorted().limit(10)` needs more work than `limit(10).sorted()` but has different semantics.

## Latihan 7 — min Instead of Sort

Find oldest order with `min`.

## Latihan 8 — Resource Laziness

Use `Files.lines` with `findFirst` to find first error line.

## Latihan 9 — Parallel Cancellation

Explain why `parallelStream().anyMatch(...)` may process extra elements.

## Latihan 10 — Stage Ordering

Given expensive mapper and cheap predicate, design efficient pipeline without changing semantics.

---

# 36. Ringkasan

Laziness, fusion, and short-circuiting explain how streams actually execute.

Core lessons:

- Intermediate operations build a lazy pipeline.
- Terminal operation triggers execution.
- Stateless operations often fuse into one traversal.
- Execution can be viewed as terminal pulling elements through pipeline.
- Stateful operations like `sorted` and `distinct` need buffering/state.
- `sorted` is a major barrier.
- `limit` and `takeWhile` can bound infinite streams.
- `filter` does not terminate infinite streams.
- Short-circuiting terminals can stop early.
- Operation order affects both semantics and performance.
- `peek` is lazy and not reliable for business side effects.
- Side effects may be partial under short-circuiting.
- Resource-backed streams must be consumed within resource lifetime.
- Parallel streams add splitting, combining, cancellation, and order coordination costs.
- Cancellation is cooperative, not transactional.
- Debugging streams requires understanding that nothing happens before terminal operation.

Main rule:

```text
A stream pipeline is a lazy execution plan.
Before trusting it, identify:
source, fused stateless stages, stateful barriers, short-circuit points, terminal trigger, and resource lifetime.
```

---

# 37. Referensi

1. Java SE 25 — `java.util.stream` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

2. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

3. Java SE 25 — `BaseStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/BaseStream.html

4. Java SE 25 — `IntStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.html

5. Java SE 25 — `Files.lines`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html#lines(java.nio.file.Path)

6. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

7. dev.java — The Stream API  
   https://dev.java/learn/api/streams/

8. dev.java — Adding Intermediate Operations on a Stream  
   https://dev.java/learn/adding-intermediate-operations-on-a-stream/

9. dev.java — Terminal Operations  
   https://dev.java/learn/api/streams/terminal-operations/

10. OpenJDK — Stream package source  
    https://github.com/openjdk/jdk/tree/master/src/java.base/share/classes/java/util/stream

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Collections and Streams — Part 034](./learn-java-collections-and-streams-part-034.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Collections and Streams — Part 036](./learn-java-collections-and-streams-part-036.md)

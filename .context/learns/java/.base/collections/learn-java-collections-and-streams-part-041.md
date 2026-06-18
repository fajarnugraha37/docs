# learn-java-collections-and-streams-part-041.md

# Java Collections and Streams — Part 041  
# Streams vs Loops: Readability, Control Flow, Performance, Side Effects, Exceptions, Debugging, Maintainability, and Production Decision-Making

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **041**  
> Fokus: memahami kapan menggunakan Stream API dan kapan menggunakan loop biasa. Tujuan bagian ini bukan “streams selalu lebih modern” atau “loops selalu lebih cepat”, tetapi membangun judgement engineering: readability, semantics, control flow, error handling, side effects, performance, allocation, debugging, parallelism, dan maintainability.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Stream adalah Data Pipeline, Loop adalah Control Flow](#2-mental-model-stream-adalah-data-pipeline-loop-adalah-control-flow)
3. [Streams Are Not a Replacement for All Loops](#3-streams-are-not-a-replacement-for-all-loops)
4. [When Streams Shine](#4-when-streams-shine)
5. [When Loops Shine](#5-when-loops-shine)
6. [Readability: Declarative vs Imperative](#6-readability-declarative-vs-imperative)
7. [Control Flow: `break`, `continue`, `return`](#7-control-flow-break-continue-return)
8. [Short-Circuiting Equivalents](#8-short-circuiting-equivalents)
9. [Multiple Outputs](#9-multiple-outputs)
10. [Side Effects](#10-side-effects)
11. [Exception Handling](#11-exception-handling)
12. [Checked Exceptions](#12-checked-exceptions)
13. [Mutation and State Machines](#13-mutation-and-state-machines)
14. [Index-Based Logic](#14-index-based-logic)
15. [Lookahead and Previous Element Logic](#15-lookahead-and-previous-element-logic)
16. [Nested Loops vs FlatMap](#16-nested-loops-vs-flatmap)
17. [Search Problems](#17-search-problems)
18. [Aggregation Problems](#18-aggregation-problems)
19. [Validation Problems](#19-validation-problems)
20. [Transformation Problems](#20-transformation-problems)
21. [Resource Handling](#21-resource-handling)
22. [Performance: Streams vs Loops](#22-performance-streams-vs-loops)
23. [Allocation and Boxing](#23-allocation-and-boxing)
24. [Primitive Loops vs Primitive Streams](#24-primitive-loops-vs-primitive-streams)
25. [JIT and Optimization Considerations](#25-jit-and-optimization-considerations)
26. [Debugging](#26-debugging)
27. [Testing](#27-testing)
28. [API Design](#28-api-design)
29. [Team Maintainability](#29-team-maintainability)
30. [Parallelism](#30-parallelism)
31. [Examples: Stream Better](#31-examples-stream-better)
32. [Examples: Loop Better](#32-examples-loop-better)
33. [Refactoring Loop to Stream](#33-refactoring-loop-to-stream)
34. [Refactoring Stream to Loop](#34-refactoring-stream-to-loop)
35. [Common Anti-Patterns](#35-common-anti-patterns)
36. [Production Failure Modes](#36-production-failure-modes)
37. [Best Practices](#37-best-practices)
38. [Decision Matrix](#38-decision-matrix)
39. [Latihan](#39-latihan)
40. [Ringkasan](#40-ringkasan)
41. [Referensi](#41-referensi)

---

# 1. Tujuan Bagian Ini

Setelah banyak bagian tentang Streams, penting untuk berhenti sejenak dan bertanya:

```text
Apakah stream selalu pilihan terbaik?
```

Jawabannya:

```text
Tidak.
```

Stream adalah tool yang sangat kuat untuk pipeline data:

```java
List<String> activeEmails = users.stream()
    .filter(User::active)
    .map(User::email)
    .toList();
```

Tetapi loop sering lebih baik untuk workflow imperative:

```java
for (Order order : orders) {
    if (!validator.isValid(order)) {
        auditInvalid(order);
        continue;
    }

    try {
        processor.process(order);
        auditSuccess(order);
    } catch (Exception e) {
        auditFailure(order, e);
        throw e;
    }
}
```

Tujuan part ini:

- memahami trade-off Streams vs loops;
- memilih berdasarkan semantics, bukan gaya;
- mengenali kapan stream meningkatkan clarity;
- mengenali kapan stream menyembunyikan control flow;
- memahami performance dan allocation trade-off;
- memahami side effects, exceptions, resource management;
- membangun decision matrix production.

---

# 2. Mental Model: Stream adalah Data Pipeline, Loop adalah Control Flow

## 2.1 Stream

Stream cocok untuk:

```text
source -> filter -> map -> aggregate/collect
```

Stream menyatakan **apa** transformasi data.

Example:

```java
Map<Role, Long> countByRole = users.stream()
    .filter(User::active)
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.counting()
    ));
```

## 2.2 Loop

Loop cocok untuk:

```text
step-by-step workflow with control flow
```

Loop menyatakan **bagaimana** proses berjalan.

Example:

```java
for (User user : users) {
    if (!user.active()) {
        continue;
    }

    if (!quota.allow(user)) {
        break;
    }

    notify(user);
}
```

## 2.3 Main rule

```text
Use streams for data transformation.
Use loops for procedural workflows.
```

---

# 3. Streams Are Not a Replacement for All Loops

Stream API bukan badge “modern Java”.

Loop bukan tanda code “kuno”.

Keduanya tools.

## 3.1 Bad stream

```java
orders.stream()
    .peek(order -> audit(order))
    .filter(order -> validate(order))
    .peek(order -> repository.save(order))
    .forEach(order -> email(order));
```

Ini menyembunyikan workflow side effect.

## 3.2 Better loop

```java
for (Order order : orders) {
    audit(order);

    if (!validate(order)) {
        continue;
    }

    repository.save(order);
    email(order);
}
```

## 3.3 Rule

If stream makes control flow less obvious, use a loop.

---

# 4. When Streams Shine

Streams are excellent when:

## 4.1 Pipeline is linear

```java
filter -> map -> collect
```

## 4.2 Functions are pure

No external mutation.

## 4.3 Result is aggregate or collection

```java
toList
toMap
groupingBy
sum
count
```

## 4.4 Operations are composable

Small named predicates/functions.

## 4.5 Declarative intent matters

Example:

```java
boolean hasAdmin = users.stream()
    .anyMatch(User::admin);
```

## 4.6 Rule

Use streams when the code reads like a data query.

---

# 5. When Loops Shine

Loops are better when:

## 5.1 Complex branching

Multiple `if/else`, `break`, `continue`.

## 5.2 Multiple side effects

Audit + save + notify + metrics.

## 5.3 Checked exceptions

IO/parsing with recovery.

## 5.4 State machine

Current state changes based on event.

## 5.5 Multiple outputs

Collect valid list, invalid list, errors, summary.

## 5.6 Early return with rich context

Return detailed result from inside loop.

## 5.7 Rule

Use loops when explicit step-by-step control is the business logic.

---

# 6. Readability: Declarative vs Imperative

## 6.1 Declarative stream

```java
List<OrderDto> result = orders.stream()
    .filter(Order::paid)
    .sorted(Comparator.comparing(Order::createdAt).reversed())
    .limit(10)
    .map(OrderDto::from)
    .toList();
```

Reads like:

```text
paid orders, newest first, top 10, convert to DTO
```

Good.

## 6.2 Imperative loop

```java
List<OrderDto> result = new ArrayList<>();

for (Order order : orders) {
    if (!order.paid()) {
        continue;
    }
    result.add(OrderDto.from(order));
}

result.sort(Comparator.comparing(OrderDto::createdAt).reversed());

if (result.size() > 10) {
    result = result.subList(0, 10);
}
```

More verbose.

## 6.3 But stream can become unreadable

```java
var result = orders.stream()
    .collect(groupingBy(
        o -> complexKey(o),
        collectingAndThen(
            filtering(...),
            x -> deeplyNestedTransform(x)
        )
    ));
```

Maybe loop/helper methods are clearer.

## 6.4 Rule

Use the form that communicates intent with least surprise.

---

# 7. Control Flow: `break`, `continue`, `return`

Loops provide native control flow:

```java
for (User user : users) {
    if (!user.active()) continue;
    if (user.admin()) return user;
    if (quotaExceeded()) break;
}
```

Streams have equivalents for some patterns:

```java
findFirst
anyMatch
allMatch
noneMatch
limit
takeWhile
dropWhile
```

But not all control flow maps cleanly.

## 7.1 Complex control

If you need:

- multiple breaks;
- labeled loops;
- continue with side effect;
- early return with cleanup;
- nested conditional state;

loop is usually clearer.

## 7.2 Rule

Do not force stream to emulate complex imperative control flow.

---

# 8. Short-Circuiting Equivalents

## 8.1 Search first match

Loop:

```java
for (User user : users) {
    if (user.active()) {
        return Optional.of(user);
    }
}
return Optional.empty();
```

Stream:

```java
Optional<User> firstActive = users.stream()
    .filter(User::active)
    .findFirst();
```

## 8.2 Any match

Loop:

```java
boolean found = false;
for (User user : users) {
    if (user.admin()) {
        found = true;
        break;
    }
}
```

Stream:

```java
boolean found = users.stream()
    .anyMatch(User::admin);
```

## 8.3 All match

```java
boolean allValid = records.stream()
    .allMatch(Record::valid);
```

## 8.4 Rule

Use stream short-circuit terminals when they exactly express the intent.

---

# 9. Multiple Outputs

Streams are less natural when one pass produces multiple outputs.

Example:

```text
validRecords
invalidRecords
errorMessages
summary
```

## 9.1 Loop is clear

```java
List<Record> valid = new ArrayList<>();
List<Record> invalid = new ArrayList<>();
List<String> errors = new ArrayList<>();

for (Record record : records) {
    ValidationResult result = validate(record);
    if (result.ok()) {
        valid.add(record);
    } else {
        invalid.add(record);
        errors.add(result.message());
    }
}
```

## 9.2 Stream alternative

Possible with `partitioningBy`, custom collectors, or teeing, but can become complex.

## 9.3 Rule

Multiple correlated outputs often favor loops or explicit accumulator objects.

---

# 10. Side Effects

Streams discourage side effects in intermediate operations.

## 10.1 Bad

```java
List<String> emails = new ArrayList<>();

users.stream()
    .map(User::email)
    .forEach(emails::add);
```

Better:

```java
List<String> emails = users.stream()
    .map(User::email)
    .toList();
```

## 10.2 Side-effect workflow

If side effect is the purpose:

```java
for (EmailCommand command : commands) {
    emailSender.send(command);
}
```

often clearer than:

```java
commands.stream().forEach(emailSender::send);
```

especially with error handling.

## 10.3 Rule

Use stream for computing values; use loop for important effects.

---

# 11. Exception Handling

Streams are awkward for complex exception handling.

## 11.1 Loop

```java
for (Path path : paths) {
    try {
        process(path);
    } catch (IOException e) {
        failures.add(new Failure(path, e));
    }
}
```

## 11.2 Stream

Checked exceptions do not fit standard functional interfaces cleanly.

```java
paths.stream()
    .map(path -> {
        try {
            return process(path);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    })
```

This can be okay, but can hide recovery logic.

## 11.3 Rule

When exception handling is central, loops often win.

---

# 12. Checked Exceptions

Java Stream functional interfaces do not declare checked exceptions.

## 12.1 Options

- wrap exception;
- handle inside lambda;
- use helper functional interface;
- use loop.

## 12.2 Production judgement

If checked exception is expected business path, do not bury it inside wrapper lambdas.

## 12.3 Rule

Streams are smoother with unchecked/pure transformations; loops are smoother with checked workflows.

---

# 13. Mutation and State Machines

State machines are usually loop territory.

Example:

```java
State state = State.INITIAL;

for (Event event : events) {
    state = transition(state, event);
    if (state == State.FAILED) {
        break;
    }
}
```

Could be:

```java
events.stream().reduce(State.INITIAL, this::transition, ...);
```

But if transition is not associative, parallel is invalid and loop is clearer.

## 13.1 Rule

Sequential stateful workflows are usually clearer as loops.

---

# 14. Index-Based Logic

If logic needs index:

## 14.1 Loop

```java
for (int i = 0; i < users.size(); i++) {
    result.add(new IndexedUser(i, users.get(i)));
}
```

## 14.2 Stream

```java
List<IndexedUser> result = IntStream.range(0, users.size())
    .mapToObj(i -> new IndexedUser(i, users.get(i)))
    .toList();
```

## 14.3 Which is better?

Use `IntStream.range` if transformation is simple and list random access is good.

Use loop if index logic is complex or source is not random-access.

## 14.4 Rule

Index-based streams are okay with `IntStream.range`, but do not overuse them.

---

# 15. Lookahead and Previous Element Logic

Comparing adjacent elements is often awkward in streams.

## 15.1 Loop

```java
for (int i = 1; i < values.size(); i++) {
    if (values.get(i) < values.get(i - 1)) {
        return false;
    }
}
return true;
```

## 15.2 Stream

```java
boolean sorted = IntStream.range(1, values.size())
    .allMatch(i -> values.get(i).compareTo(values.get(i - 1)) >= 0);
```

This is okay for simple adjacent checks.

## 15.3 Complex lookahead

Loop usually better.

## 15.4 Rule

For simple adjacent checks, `IntStream.range` is fine; complex lookaround favors loops.

---

# 16. Nested Loops vs FlatMap

## 16.1 Nested loop

```java
List<OrderLineDto> lines = new ArrayList<>();

for (Order order : orders) {
    for (OrderLine line : order.lines()) {
        lines.add(OrderLineDto.from(order, line));
    }
}
```

## 16.2 Stream

```java
List<OrderLineDto> lines = orders.stream()
    .flatMap(order -> order.lines().stream()
        .map(line -> OrderLineDto.from(order, line)))
    .toList();
```

## 16.3 Which better?

Stream is concise if transformation is simple.

Loop is clearer if nested logic has branching, error handling, or side effects.

## 16.4 Rule

Use `flatMap` for simple flatten-transform; use loops for procedural nested workflows.

---

# 17. Search Problems

Streams often shine for search.

## 17.1 First match

```java
Optional<User> user = users.stream()
    .filter(u -> u.id().equals(id))
    .findFirst();
```

## 17.2 Any match

```java
boolean exists = users.stream()
    .anyMatch(u -> u.id().equals(id));
```

## 17.3 Complex search with diagnostics

Loop may be better:

```java
for (User user : users) {
    if (user.id().equals(id)) {
        auditFound(user);
        return user;
    }
    auditChecked(user);
}
throw notFound(id);
```

## 17.4 Rule

Use streams for pure search; loops for search with procedural diagnostics/effects.

---

# 18. Aggregation Problems

Streams shine for aggregation.

## 18.1 Count by role

```java
Map<Role, Long> countByRole = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.counting()
    ));
```

## 18.2 Sum

```java
long total = orders.stream()
    .mapToLong(Order::amountInCents)
    .sum();
```

## 18.3 Custom multiple accumulations

Loop or custom collector.

## 18.4 Rule

Use built-in collectors for standard aggregation; use loop/custom collector for complex multi-output aggregation.

---

# 19. Validation Problems

## 19.1 All valid

```java
boolean allValid = records.stream()
    .allMatch(Record::valid);
```

## 19.2 Collect validation errors

Loop can be clearer:

```java
List<ValidationError> errors = new ArrayList<>();

for (Record record : records) {
    errors.addAll(validate(record));
}
```

Stream possible:

```java
List<ValidationError> errors = records.stream()
    .flatMap(record -> validate(record).stream())
    .toList();
```

## 19.3 Validation with fail-fast and context

Loop often better.

## 19.4 Rule

Use streams for pure validation queries; loops for rich validation workflow.

---

# 20. Transformation Problems

Streams shine for pure transformations.

## 20.1 DTO mapping

```java
List<UserDto> dtos = users.stream()
    .map(UserDto::from)
    .toList();
```

## 20.2 Filter + map

```java
List<UserDto> active = users.stream()
    .filter(User::active)
    .map(UserDto::from)
    .toList();
```

## 20.3 Transformation with exception/side effect

Loop may be better.

## 20.4 Rule

Pure transformations are stream territory.

---

# 21. Resource Handling

Resource-backed streams need `try-with-resources`.

## 21.1 Stream

```java
try (Stream<String> lines = Files.lines(path)) {
    return lines
        .filter(line -> line.contains("ERROR"))
        .findFirst();
}
```

Good.

## 21.2 Complex resource handling

Loop may be clearer:

```java
try (BufferedReader reader = Files.newBufferedReader(path)) {
    String line;
    while ((line = reader.readLine()) != null) {
        ...
    }
}
```

## 21.3 Rule

Use stream for simple resource pipelines; use loop for complex IO/error handling.

---

# 22. Performance: Streams vs Loops

## 22.1 General reality

Loops can be faster in hot low-level paths.

Streams can be fast enough and clearer for many business pipelines.

## 22.2 Stream overhead

Possible overhead:

- lambda dispatch/inlining complexity;
- pipeline machinery;
- boxing;
- allocation;
- collectors;
- stateful operations.

## 22.3 Loop benefits

- explicit control;
- fewer abstractions;
- easier micro-optimization;
- early exit logic clear.

## 22.4 Rule

Do not guess. Measure hot paths.

---

# 23. Allocation and Boxing

## 23.1 Bad numeric stream

```java
Integer total = numbers.stream()
    .reduce(0, Integer::sum);
```

May box/unbox.

## 23.2 Better primitive stream

```java
int total = numbers.stream()
    .mapToInt(Integer::intValue)
    .sum();
```

## 23.3 Loop

```java
int total = 0;
for (int n : array) {
    total += n;
}
```

Often fastest for primitive arrays.

## 23.4 Rule

For numeric hot paths, compare primitive stream and loop.

---

# 24. Primitive Loops vs Primitive Streams

## 24.1 Primitive stream

```java
long total = LongStream.of(values)
    .sum();
```

## 24.2 Loop

```java
long total = 0;
for (long value : values) {
    total += value;
}
```

## 24.3 Which better?

Loop may be faster and easier for very hot inner loops.

Primitive stream may be readable enough for non-critical aggregation.

## 24.4 Rule

Hot primitive loops deserve benchmark-based choice.

---

# 25. JIT and Optimization Considerations

Modern JVM can optimize both loops and streams.

## 25.1 Streams may optimize well

Especially simple primitive stream pipelines.

## 25.2 But not guaranteed

Complex lambdas, megamorphic calls, boxing, collectors, and stateful operations can reduce optimization.

## 25.3 Rule

JIT behavior is workload-specific. Benchmark with JMH for micro performance.

---

# 26. Debugging

## 26.1 Loop debugging

Easy breakpoints at each step.

## 26.2 Stream debugging

Can use:

- named methods;
- `peek` temporarily;
- debugger stream trace features;
- split pipeline into variables for debugging.

## 26.3 Rule

If stream pipeline becomes hard to debug, extract methods or use loop.

---

# 27. Testing

## 27.1 Stream tests

Good for output-based assertions.

```java
assertEquals(expected, transform(input));
```

## 27.2 Loop workflow tests

Good for state transitions and side effects.

Use mocks/fakes and verify order/failure handling.

## 27.3 Rule

The test style follows code semantics: data result vs workflow behavior.

---

# 28. API Design

Returning stream from API has implications:

- one-shot;
- lazy;
- caller may need close;
- source lifetime;
- not as simple as returning collection.

## 28.1 Usually return collection

```java
List<UserDto> findUsers()
```

## 28.2 Return stream only if laziness is needed and ownership documented

```java
Stream<User> openUserStream()
```

## 28.3 Rule

Do not expose Stream API casually from service boundaries.

---

# 29. Team Maintainability

A stream is good if team can read it quickly.

## 29.1 Good stream

```java
orders.stream()
    .filter(Order::paid)
    .map(OrderDto::from)
    .toList()
```

## 29.2 Bad stream

Deep nested collectors/lambdas with side effects and exception wrappers.

## 29.3 Rule

Optimize for shared understanding, not cleverness.

---

# 30. Parallelism

Parallel streams can be concise:

```java
items.parallelStream()
    .map(this::cpuHeavy)
    .toList();
```

But loops with explicit executor may be better when you need:

- custom pool;
- IO concurrency;
- rate limit;
- timeout;
- cancellation;
- backpressure;
- per-item error model.

## 30.1 Rule

Parallel streams are for CPU data parallelism, not general concurrency orchestration.

---

# 31. Examples: Stream Better

## 31.1 Filter + map

```java
List<String> emails = users.stream()
    .filter(User::active)
    .map(User::email)
    .toList();
```

## 31.2 Aggregation

```java
long total = orders.stream()
    .mapToLong(Order::amountInCents)
    .sum();
```

## 31.3 Grouping

```java
Map<Role, Long> counts = users.stream()
    .collect(Collectors.groupingBy(
        User::role,
        Collectors.counting()
    ));
```

## 31.4 Search

```java
Optional<User> admin = users.stream()
    .filter(User::admin)
    .findFirst();
```

## 31.5 Declarative predicates

```java
boolean allApproved = requests.stream()
    .allMatch(Request::approved);
```

---

# 32. Examples: Loop Better

## 32.1 Transactional workflow

```java
for (Order order : orders) {
    validate(order);
    repository.save(order);
    audit(order);
}
```

## 32.2 Multiple outputs

```java
for (Record record : records) {
    ValidationResult vr = validate(record);
    if (vr.ok()) valid.add(record);
    else invalid.add(new InvalidRecord(record, vr.errors()));
}
```

## 32.3 Complex exception handling

```java
for (Path path : paths) {
    try {
        process(path);
    } catch (IOException e) {
        failures.add(path);
    }
}
```

## 32.4 Stateful protocol

```java
for (Event event : events) {
    state = transition(state, event);
    if (state.terminal()) break;
}
```

## 32.5 Ordered side effects

```java
for (EmailCommand command : commands) {
    sender.send(command);
}
```

---

# 33. Refactoring Loop to Stream

Good candidate loop:

```java
List<String> emails = new ArrayList<>();

for (User user : users) {
    if (user.active()) {
        emails.add(user.email());
    }
}
```

Refactor:

```java
List<String> emails = users.stream()
    .filter(User::active)
    .map(User::email)
    .toList();
```

## 33.1 Conditions

- no complex side effects;
- one output;
- simple filter/map;
- order semantics preserved.

## 33.2 Rule

Refactor to stream when it reduces noise without hiding logic.

---

# 34. Refactoring Stream to Loop

Bad stream candidate:

```java
orders.stream()
    .peek(auditService::seen)
    .filter(order -> {
        try {
            return validator.validate(order);
        } catch (ValidationException e) {
            auditService.invalid(order, e);
            return false;
        }
    })
    .forEach(order -> {
        repository.save(order);
        emailService.send(order);
    });
```

Refactor:

```java
for (Order order : orders) {
    auditService.seen(order);

    try {
        if (!validator.validate(order)) {
            continue;
        }

        repository.save(order);
        emailService.send(order);
    } catch (ValidationException e) {
        auditService.invalid(order, e);
    }
}
```

## 34.1 Rule

Refactor to loop when stream hides workflow, exceptions, or side effects.

---

# 35. Common Anti-Patterns

## 35.1 Stream for everything

Bad engineering style.

## 35.2 Loop for every simple query

Unnecessarily verbose.

## 35.3 `peek` for mutation

Wrong.

## 35.4 External mutable list with forEach

Use collector.

## 35.5 Complex nested stream without helper methods

Unreadable.

## 35.6 Parallel stream for IO

Wrong abstraction.

## 35.7 Stream with many try/catch wrappers

Probably loop.

## 35.8 Ignoring primitive streams

Boxing overhead.

## 35.9 Using stream where index logic is central

Maybe loop.

## 35.10 Using loop where collector is clearer

Missed abstraction.

---

# 36. Production Failure Modes

## 36.1 Hidden partial side effects

Stream short-circuits before all side effects.

## 36.2 Lost errors

Exception wrapped and swallowed awkwardly.

## 36.3 Performance regression

Stream pipeline boxes/allocates in hot path.

## 36.4 Unreadable business logic

Over-composed stream hides workflow.

## 36.5 Race condition

Parallel stream with external mutation.

## 36.6 Transaction bug

DB saves inside stream with partial failure.

## 36.7 Resource leak

Returned lazy stream not closed.

## 36.8 Flaky order

Stream over unordered collection but loop previously had ordered source.

## 36.9 Debugging slowdown

Complex stream hard to inspect.

## 36.10 Team misunderstanding

Clever stream not maintainable.

---

# 37. Best Practices

## 37.1 Prefer streams for pure data pipelines

Filter/map/collect/reduce.

## 37.2 Prefer loops for workflows

Side effects, transactions, exception recovery.

## 37.3 Use named methods

```java
.filter(this::isEligible)
.map(this::toDto)
```

## 37.4 Avoid long lambdas

Long lambda often means extract method or loop.

## 37.5 Avoid side effects in intermediate operations

Especially `peek`.

## 37.6 Use primitive streams for numeric pipelines

Avoid boxing.

## 37.7 Benchmark hot paths

Do not assume.

## 37.8 Keep API contracts explicit

Order, mutability, null, resource ownership.

## 37.9 Optimize for maintainability

Readable beats clever.

---

# 38. Decision Matrix

| Situation | Prefer |
|---|---|
| simple filter-map-list | Stream |
| count/sum/min/max | Stream |
| grouping/aggregation | Stream/Collector |
| one output collection | Stream |
| pure search | Stream |
| any/all/none match | Stream |
| complex branching | Loop |
| multiple outputs | Loop or custom collector |
| important side effects | Loop/workflow |
| transaction boundaries | Loop/service workflow |
| checked exception recovery | Loop |
| index-heavy logic | Loop or `IntStream.range` |
| adjacent element logic simple | `IntStream.range` |
| adjacent element logic complex | Loop |
| state machine | Loop |
| resource-backed simple scan | Stream with try-with-resources |
| complex IO parsing | Loop |
| hot primitive inner loop | Loop or primitive stream benchmark |
| CPU-heavy data parallel | Parallel stream maybe |
| IO concurrency | Executor/virtual threads/reactive |
| debugging complex flow | Loop or extracted methods |
| public API resource result | Avoid Stream unless ownership explicit |
| readability suffers | Loop/extract methods |

---

# 39. Latihan

## Latihan 1 — Refactor Loop to Stream

Refactor simple filter-map-add loop into stream.

## Latihan 2 — Refactor Stream to Loop

Take stream with `peek`, try/catch, DB save, email send. Refactor to loop.

## Latihan 3 — Multiple Outputs

Given records, collect valid records, invalid records, and errors. Decide loop vs collector.

## Latihan 4 — Index Logic

Implement index labels using loop and `IntStream.range`.

## Latihan 5 — Adjacent Check

Check if list is sorted using loop and stream.

## Latihan 6 — Exception Handling

Parse files where parsing throws IOException. Compare stream wrapper vs loop.

## Latihan 7 — Performance

Design JMH benchmark comparing loop, stream, primitive stream for summing int array.

## Latihan 8 — Side Effects

Classify which operations should not be in stream intermediate operations.

## Latihan 9 — API Design

Decide whether service should return `Stream<User>` or `List<UserDto>`.

## Latihan 10 — Decision Review

Take one real code snippet and justify stream vs loop using decision matrix.

---

# 40. Ringkasan

Streams and loops solve different problems.

Core lessons:

- Stream is best for data transformation and reduction.
- Loop is best for imperative control flow and side-effect workflows.
- Streams are declarative; loops are procedural.
- Short-circuit stream terminals replace some loop `break` patterns.
- Not all control flow maps cleanly to streams.
- Multiple outputs often favor loops or custom collectors.
- Side effects and exceptions often favor loops.
- Resource-backed streams require try-with-resources.
- Numeric hot paths require benchmark-based choice.
- Primitive streams reduce boxing but loops can still win in hot code.
- `peek` is not business logic.
- Parallel stream is not general concurrency orchestration.
- Readability and maintainability are first-class engineering concerns.

Main rule:

```text
Use streams when the code is naturally a data query.
Use loops when the code is naturally a workflow.
```

---

# 41. Referensi

1. Java SE 25 — `java.util.stream` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

2. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

3. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

4. Java SE 25 — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

5. Java SE 25 — `IntStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.html

6. Java SE 25 — `Collection.removeIf`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html#removeIf(java.util.function.Predicate)

7. Java SE 25 — `BaseStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/BaseStream.html

8. Java SE 25 — `Files.lines`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html#lines(java.nio.file.Path)

9. OpenJDK JMH  
   https://openjdk.org/projects/code-tools/jmh/

10. OpenJDK — Stream API source  
    https://github.com/openjdk/jdk/tree/master/src/java.base/share/classes/java/util/stream

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-collections-and-streams-part-040.md">⬅️ Java Collections and Streams — Part 040</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-collections-and-streams-part-042.md">Java Collections and Streams — Part 042 ➡️</a>
</div>

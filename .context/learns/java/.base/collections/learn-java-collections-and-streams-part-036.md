# learn-java-collections-and-streams-part-036.md

# Java Collections and Streams — Part 036  
# Stream Side Effects: Non-Interference, Statelessness, Shared Mutable State, `peek`, `forEach`, Parallel Hazards, IO Effects, Transactions, and Production-Safe Patterns

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **036**  
> Fokus: memahami side effects dalam Stream API secara production-grade: kapan side effect aman, kapan berbahaya, apa arti **non-interfering** dan **stateless**, kenapa `peek` bukan business logic, kenapa external mutable accumulation rusak terutama pada parallel stream, dan kapan harus memakai loop, collector, queue, transaction boundary, atau explicit workflow.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Stream Lebih Cocok untuk Transformation, Bukan Mutation Workflow](#2-mental-model-stream-lebih-cocok-untuk-transformation-bukan-mutation-workflow)
3. [Apa Itu Side Effect?](#3-apa-itu-side-effect)
4. [Non-Interference](#4-non-interference)
5. [Stateless Behavioral Parameters](#5-stateless-behavioral-parameters)
6. [Kenapa Side Effects Discouraged](#6-kenapa-side-effects-discouraged)
7. [Side Effects May Not Always Execute](#7-side-effects-may-not-always-execute)
8. [`peek` Is Not Business Logic](#8-peek-is-not-business-logic)
9. [`forEach` as Side-Effect Terminal](#9-foreach-as-side-effect-terminal)
10. [`forEachOrdered`](#10-foreachordered)
11. [External Mutable Accumulation Anti-Pattern](#11-external-mutable-accumulation-anti-pattern)
12. [Use Collectors Instead](#12-use-collectors-instead)
13. [Mutation of Stream Source](#13-mutation-of-stream-source)
14. [Mutation of Elements](#14-mutation-of-elements)
15. [Shared Mutable State in Sequential Streams](#15-shared-mutable-state-in-sequential-streams)
16. [Shared Mutable State in Parallel Streams](#16-shared-mutable-state-in-parallel-streams)
17. [AtomicInteger and Concurrent Collections Are Not a Free Pass](#17-atomicinteger-and-concurrent-collections-are-not-a-free-pass)
18. [ThreadLocal in Streams](#18-threadlocal-in-streams)
19. [IO Side Effects](#19-io-side-effects)
20. [Database Writes and Transactions](#20-database-writes-and-transactions)
21. [Network Calls in Streams](#21-network-calls-in-streams)
22. [Logging and Metrics](#22-logging-and-metrics)
23. [Auditing](#23-auditing)
24. [Notifications and Emails](#24-notifications-and-emails)
25. [Stream Side Effects and Short-Circuiting](#25-stream-side-effects-and-short-circuiting)
26. [Stream Side Effects and Laziness](#26-stream-side-effects-and-laziness)
27. [Stream Side Effects and Exceptions](#27-stream-side-effects-and-exceptions)
28. [Idempotency and Retry](#28-idempotency-and-retry)
29. [When Side Effects Are Acceptable](#29-when-side-effects-are-acceptable)
30. [When to Prefer Loops](#30-when-to-prefer-loops)
31. [Safe Patterns](#31-safe-patterns)
32. [Unsafe Patterns](#32-unsafe-patterns)
33. [Production Failure Modes](#33-production-failure-modes)
34. [Best Practices](#34-best-practices)
35. [Decision Matrix](#35-decision-matrix)
36. [Latihan](#36-latihan)
37. [Ringkasan](#37-ringkasan)
38. [Referensi](#38-referensi)

---

# 1. Tujuan Bagian Ini

Stream API terlihat menggoda untuk menulis workflow:

```java
users.stream()
    .filter(User::active)
    .peek(auditService::audit)
    .map(emailService::sendWelcomeEmail)
    .forEach(repository::save);
```

Tetapi ini sering menjadi awal dari bug yang sulit didiagnosis:

- side effect tidak berjalan karena tidak ada terminal operation;
- side effect hanya berjalan sebagian karena short-circuit;
- side effect berjalan out of order pada parallel stream;
- shared mutable list corrupt;
- database writes terjadi sebagian;
- retry mengirim email dobel;
- `peek` dihilangkan/diabaikan secara optimisasi tertentu;
- source dimodifikasi saat stream berjalan;
- race condition muncul setelah `.parallel()` ditambahkan;
- exception terjadi di tengah pipeline dan state external sudah berubah sebagian.

Bagian ini bertujuan membuat kamu punya judgement:

```text
Kapan stream cocok?
Kapan side effect boleh?
Kapan harus pakai collector?
Kapan harus pakai loop?
Kapan harus pakai explicit workflow/transaction/outbox/queue?
```

---

# 2. Mental Model: Stream Lebih Cocok untuk Transformation, Bukan Mutation Workflow

Stream paling cocok untuk pipeline seperti:

```text
source -> select -> transform -> aggregate/materialize
```

Contoh bagus:

```java
List<String> emails = users.stream()
    .filter(User::active)
    .map(User::email)
    .toList();
```

Ini declarative transformation.

Workflow side effect lebih seperti:

```text
for each item:
    validate
    mutate
    call external system
    persist
    handle failure
    retry/rollback/compensate
```

Untuk workflow seperti itu, loop sering lebih jelas.

## 2.1 Main rule

```text
Use streams primarily for data transformation and reduction.
Use explicit control flow for business-critical side effects.
```

---

# 3. Apa Itu Side Effect?

Side effect adalah aksi yang mengubah sesuatu di luar return value fungsi.

Examples:

```java
list.add(x)
map.put(k, v)
object.setStatus(...)
repository.save(...)
emailService.send(...)
log.info(...)
metrics.increment(...)
auditService.record(...)
```

## 3.1 Pure function

```java
user -> user.email()
```

Tidak mengubah external state.

## 3.2 Side-effecting function

```java
user -> {
    auditService.record(user);
    return user.email();
}
```

Mengubah external audit system.

## 3.3 Rule

Side effect is any observable external change beyond the returned value.

---

# 4. Non-Interference

Behavioral parameter stream harus non-interfering.

Artinya lambda tidak memodifikasi source stream saat pipeline berjalan.

Bad:

```java
List<String> names = new ArrayList<>(List.of("A", "B"));

names.stream()
    .forEach(name -> names.add(name + "!"));
```

## 4.1 Why dangerous

Source traversal and mutation conflict.

Possible outcomes:

- `ConcurrentModificationException`;
- infinite-like behavior;
- missed elements;
- undefined/non-deterministic behavior.

## 4.2 Safe alternative

Create new result:

```java
List<String> excited = names.stream()
    .map(name -> name + "!")
    .toList();
```

## 4.3 Rule

Do not modify the stream source during stream execution.

---

# 5. Stateless Behavioral Parameters

A lambda should not depend on mutable state that changes during pipeline execution.

Bad:

```java
AtomicInteger index = new AtomicInteger();

List<String> indexed = names.stream()
    .map(name -> index.getAndIncrement() + ":" + name)
    .toList();
```

This may look okay sequentially, but order/parallel semantics become problematic.

## 5.1 Better for indexes

```java
List<String> indexed = IntStream.range(0, names.size())
    .mapToObj(i -> i + ":" + names.get(i))
    .toList();
```

## 5.2 Rule

Prefer deriving state from element/source, not external mutable variables.

---

# 6. Kenapa Side Effects Discouraged

Side effects dalam stream behavioral parameters discouraged because they can violate:

- statelessness;
- non-interference;
- thread-safety;
- ordering expectation;
- laziness expectation;
- short-circuit expectation;
- repeatability;
- test determinism.

## 6.1 Stream implementation freedom

Stream implementation can optimize, fuse, elide, parallelize, and reorder within semantic constraints.

Jika side effect bukan bagian dari result semantics yang dijamin, jangan bergantung padanya.

## 6.2 Rule

If correctness depends on side effect execution details, streams are probably the wrong abstraction.

---

# 7. Side Effects May Not Always Execute

Contoh:

```java
long count = list.stream()
    .peek(System.out::println)
    .count();
```

Jangan desain program yang correctness-nya bergantung pada `peek` dieksekusi.

Beberapa pipeline dapat menghitung result tanpa harus menjalankan setiap stage jika stage terbukti tidak memengaruhi hasil.

## 7.1 Short-circuit

```java
users.stream()
    .peek(auditService::audit)
    .findFirst();
```

Audit hanya untuk element yang diperlukan sampai first ditemukan.

## 7.2 No terminal

```java
users.stream()
    .peek(auditService::audit);
```

Tidak terjadi apa-apa.

## 7.3 Rule

Side effects in intermediate operations are not reliable business actions.

---

# 8. `peek` Is Not Business Logic

`peek` intended mainly for debugging/observability.

Good:

```java
orders.stream()
    .filter(Order::paid)
    .peek(order -> log.debug("paid order {}", order.id()))
    .map(OrderDto::from)
    .toList();
```

Bad:

```java
orders.stream()
    .peek(order -> order.markProcessed())
    .toList();
```

## 8.1 Why bad

`peek` is lazy, can be skipped/partial, and unclear as mutation point.

## 8.2 If you need mutation

Use explicit loop:

```java
for (Order order : orders) {
    order.markProcessed();
}
```

or map to new immutable object:

```java
List<Order> processed = orders.stream()
    .map(Order::processedCopy)
    .toList();
```

## 8.3 Rule

Use `peek` for debugging only; never for required state transition.

---

# 9. `forEach` as Side-Effect Terminal

`forEach` is a terminal operation for side effects.

```java
users.stream()
    .forEach(notificationService::send);
```

## 9.1 Legitimate use

When the whole purpose is side effect.

## 9.2 Caveat

Error handling, retry, ordering, transaction, and partial failure semantics are not automatically solved.

## 9.3 Parallel caveat

```java
users.parallelStream()
    .forEach(notificationService::send);
```

Calls may happen concurrently and out of order.

## 9.4 Rule

`forEach` is acceptable for simple side effects; complex side effects need explicit workflow.

---

# 10. `forEachOrdered`

`forEachOrdered` preserves encounter order if stream has one.

```java
users.parallelStream()
    .forEachOrdered(writer::write);
```

## 10.1 Use case

- ordered output;
- sequential protocol;
- deterministic append.

## 10.2 Cost

May reduce parallel performance.

## 10.3 Caveat

If source is unordered, encounter order is not meaningful.

## 10.4 Rule

Use `forEachOrdered` when side-effect order is required.

---

# 11. External Mutable Accumulation Anti-Pattern

Bad:

```java
List<String> emails = new ArrayList<>();

users.stream()
    .map(User::email)
    .forEach(emails::add);
```

Sequentially it may work, but it is not idiomatic.

Much worse in parallel:

```java
users.parallelStream()
    .map(User::email)
    .forEach(emails::add);
```

Race and corruption.

## 11.1 Better

```java
List<String> emails = users.stream()
    .map(User::email)
    .toList();
```

or mutable:

```java
ArrayList<String> emails = users.stream()
    .map(User::email)
    .collect(Collectors.toCollection(ArrayList::new));
```

## 11.2 Rule

Do not accumulate stream results into external mutable containers.

---

# 12. Use Collectors Instead

Collectors encode safe accumulation.

## 12.1 List

```java
List<String> emails = users.stream()
    .map(User::email)
    .toList();
```

## 12.2 Set

```java
Set<Role> roles = users.stream()
    .map(User::role)
    .collect(Collectors.toSet());
```

## 12.3 Map

```java
Map<UserId, User> byId = users.stream()
    .collect(Collectors.toMap(User::id, Function.identity()));
```

## 12.4 Grouping

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(User::role));
```

## 12.5 Rule

If side effect is “building a result container”, use collector.

---

# 13. Mutation of Stream Source

Never mutate source structurally during stream traversal.

Bad:

```java
users.stream()
    .filter(User::inactive)
    .forEach(users::remove);
```

## 13.1 Better

```java
users.removeIf(User::inactive);
```

or:

```java
List<User> active = users.stream()
    .filter(User::active)
    .toList();
```

## 13.2 Rule

Use collection methods or new collections, not source mutation inside stream.

---

# 14. Mutation of Elements

Mutating element objects is not always structurally interfering, but it is still risky.

```java
users.stream()
    .forEach(user -> user.setActive(false));
```

## 14.1 Risks

- hidden side effect;
- shared references;
- cache inconsistency;
- dirty checking surprises;
- parallel data race;
- hard-to-test behavior.

## 14.2 Better

Immutable transformation:

```java
List<User> deactivated = users.stream()
    .map(User::deactivated)
    .toList();
```

## 14.3 When acceptable

Simple local mutation with clear ownership and sequential stream may be okay, but loop is often clearer.

## 14.4 Rule

Element mutation in stream should be rare, local, sequential, and explicit.

---

# 15. Shared Mutable State in Sequential Streams

Even sequential stream with external mutable state can be fragile.

Example:

```java
List<String> errors = new ArrayList<>();

records.stream()
    .filter(record -> {
        if (!record.valid()) {
            errors.add(record.id());
            return false;
        }
        return true;
    })
    .toList();
```

## 15.1 Problem

Filtering and error collection are mixed.

## 15.2 Better

Use partitioning:

```java
Map<Boolean, List<Record>> partition = records.stream()
    .collect(Collectors.partitioningBy(Record::valid));
```

or explicit validation loop.

## 15.3 Rule

Sequential side effects may work but often reduce clarity.

---

# 16. Shared Mutable State in Parallel Streams

Parallel stream with shared mutable state is dangerous.

Bad:

```java
int[] sum = {0};

numbers.parallelStream()
    .forEach(n -> sum[0] += n);
```

Race.

Bad:

```java
List<Integer> result = new ArrayList<>();

numbers.parallelStream()
    .forEach(result::add);
```

Race/corruption.

## 16.1 Correct

```java
int sum = numbers.parallelStream()
    .mapToInt(Integer::intValue)
    .sum();
```

```java
List<Integer> result = numbers.parallelStream()
    .toList();
```

## 16.2 Rule

Parallel stream lambdas must not mutate shared unsynchronized state.

---

# 17. AtomicInteger and Concurrent Collections Are Not a Free Pass

Using thread-safe structures can make code safe from corruption, but still bad.

## 17.1 AtomicInteger accumulation

```java
AtomicInteger sum = new AtomicInteger();

numbers.parallelStream()
    .forEach(sum::addAndGet);
```

This may be thread-safe but has contention and poor style.

Better:

```java
int sum = numbers.parallelStream()
    .mapToInt(Integer::intValue)
    .sum();
```

## 17.2 Concurrent list/queue accumulation

```java
Queue<T> q = new ConcurrentLinkedQueue<>();
stream.parallel().forEach(q::add);
```

Maybe safe structurally, but output order and performance may be poor.

## 17.3 Rule

Thread-safe side effects are not automatically good stream design.

---

# 18. ThreadLocal in Streams

ThreadLocal may appear to solve per-thread state.

```java
ThreadLocal<Formatter> formatter = ThreadLocal.withInitial(...);
```

## 18.1 Risks

- worker threads reused;
- cleanup needed;
- context leakage;
- parallel stream uses common pool by default;
- harder reasoning.

## 18.2 Better

Use stateless functions or collector-managed state.

## 18.3 Rule

Avoid ThreadLocal in stream pipelines unless you deeply control lifecycle and cleanup.

---

# 19. IO Side Effects

Examples:

```java
Files.writeString(...)
writer.write(...)
System.out.println(...)
```

## 19.1 forEach IO

```java
lines.stream()
    .forEach(writer::println);
```

Can be okay if sequential and errors handled.

## 19.2 Parallel IO

Parallel writes can interleave.

Use `forEachOrdered` or explicit writer loop.

## 19.3 Exceptions

Checked IO exceptions do not fit stream lambdas cleanly.

## 19.4 Rule

For IO-heavy side effects, explicit loops often provide clearer error handling.

---

# 20. Database Writes and Transactions

Bad idea:

```java
users.stream()
    .forEach(repository::save);
```

Maybe acceptable for tiny script, but production transaction semantics matter.

## 20.1 Questions

- one transaction for all?
- transaction per item?
- rollback on partial failure?
- retry?
- idempotency?
- batching?
- ordering?
- backpressure?

## 20.2 Better batch design

```java
List<UserEntity> entities = users.stream()
    .map(UserEntity::from)
    .toList();

repository.saveAll(entities);
```

or explicit transactional loop.

## 20.3 Rule

Database writes require transaction design, not just stream syntax.

---

# 21. Network Calls in Streams

Bad:

```java
orders.parallelStream()
    .forEach(paymentClient::charge);
```

## 21.1 Risks

- unbounded concurrency;
- rate limiting;
- retries duplicate external action;
- timeout handling;
- partial failure;
- common pool saturation;
- no backpressure.

## 21.2 Better

Use:

- bounded executor;
- reactive pipeline with backpressure;
- queue;
- bulk API;
- outbox pattern;
- idempotency key.

## 21.3 Rule

Do not use parallel streams as network concurrency framework.

---

# 22. Logging and Metrics

Logging/metrics are side effects, but often acceptable.

## 22.1 Debug logging

```java
stream.peek(x -> log.debug("x={}", x))
```

Fine for diagnostics, not correctness.

## 22.2 Metrics

```java
stream.peek(x -> metrics.increment("processed"))
```

Be careful: short-circuiting and optimizations can affect count.

Better count via terminal result when possible.

## 22.3 Rule

Observability side effects are acceptable only when approximate/diagnostic, not required domain facts.

---

# 23. Auditing

Audit is usually domain-critical.

Bad:

```java
orders.stream()
    .peek(auditService::record)
    .filter(Order::valid)
    .findFirst();
```

Audit may be partial.

## 23.1 Better

If all attempted orders must be audited:

```java
for (Order order : orders) {
    auditService.record(order);
    if (order.valid()) {
        return order;
    }
}
```

## 23.2 Or explicit event model

```text
write audit event -> process -> commit
```

## 23.3 Rule

Critical audit should not be hidden in lazy stream stages.

---

# 24. Notifications and Emails

Emails are external side effects.

Bad:

```java
users.stream()
    .filter(User::active)
    .forEach(emailService::sendWelcome);
```

May be okay for admin tool, but production needs:

- idempotency;
- retries;
- failure record;
- rate limit;
- templates;
- observability;
- unsubscribe/compliance;
- outbox/queue.

## 24.1 Better

```java
List<EmailCommand> commands = users.stream()
    .filter(User::active)
    .map(EmailCommand::welcome)
    .toList();

emailOutbox.enqueueAll(commands);
```

## 24.2 Rule

Prefer stream to build commands/events, then execute side effects through reliable mechanism.

---

# 25. Stream Side Effects and Short-Circuiting

Short-circuit terminal operations may stop early:

```java
findFirst
findAny
anyMatch
allMatch
noneMatch
```

## 25.1 Partial side effect

```java
users.stream()
    .peek(auditService::audit)
    .anyMatch(User::admin);
```

Not all users audited.

## 25.2 Parallel

Even after match found, some tasks may already have executed side effects.

## 25.3 Rule

Do not mix required side effects with short-circuiting pipelines.

---

# 26. Stream Side Effects and Laziness

No terminal means no side effect.

```java
Stream<User> s = users.stream()
    .peek(auditService::audit);
```

No audit until terminal operation.

## 26.1 Delayed execution

Side effect happens later than code location suggests.

## 26.2 Resource scope risk

Side effect may happen after surrounding state changes.

## 26.3 Rule

Lazy execution makes hidden side effects harder to reason about.

---

# 27. Stream Side Effects and Exceptions

If exception occurs mid-pipeline, previous side effects remain.

```java
users.stream()
    .forEach(user -> {
        emailService.send(user);
        if (bad(user)) {
            throw new RuntimeException();
        }
    });
```

Some emails already sent.

## 27.1 No automatic rollback

Stream does not provide transaction compensation.

## 27.2 Better

- validate first;
- build commands;
- use transactional outbox;
- handle per-item result.

## 27.3 Rule

Side-effect pipelines need explicit failure semantics.

---

# 28. Idempotency and Retry

If side effects can be retried, they must be idempotent.

## 28.1 Example

Email send with idempotency key:

```text
welcome-email:userId:campaignId
```

## 28.2 Payment charge

Must never rely on “stream ran once” assumption.

## 28.3 Database writes

Use unique keys/upserts/versioning.

## 28.4 Rule

External side effects require idempotency design independent of stream semantics.

---

# 29. When Side Effects Are Acceptable

Side effects are acceptable when:

## 29.1 Terminal purpose is side effect

```java
stream.forEach(writer::println)
```

## 29.2 Sequential and simple

No concurrency/order/failure complexity.

## 29.3 Idempotent or non-critical

Debug logs.

## 29.4 Clear lifecycle

Resource open/close handled.

## 29.5 Error handling acceptable

Partial failure semantics are okay or explicitly handled.

## 29.6 Rule

Side effects are okay when they are simple, explicit, ordered if needed, and failure semantics are understood.

---

# 30. When to Prefer Loops

Prefer loop when:

- mutation is primary purpose;
- side effects require ordering;
- checked exceptions matter;
- transaction boundaries matter;
- retry/compensation needed;
- break/continue logic is complex;
- multiple outputs are built;
- debugging clarity matters;
- state machine is involved.

## 30.1 Example

```java
for (Order order : orders) {
    if (!order.valid()) {
        auditInvalid(order);
        continue;
    }

    try {
        process(order);
        auditSuccess(order);
    } catch (Exception e) {
        auditFailure(order, e);
        throw e;
    }
}
```

This is clearer than forcing stream.

## 30.2 Rule

Loops are not inferior; they are better for imperative workflows.

---

# 31. Safe Patterns

## 31.1 Transform then execute

```java
List<EmailCommand> commands = users.stream()
    .filter(User::active)
    .map(EmailCommand::welcome)
    .toList();

emailOutbox.enqueueAll(commands);
```

## 31.2 Collect instead of external mutation

```java
Map<Role, List<User>> byRole = users.stream()
    .collect(Collectors.groupingBy(User::role));
```

## 31.3 Use removeIf for source mutation

```java
users.removeIf(User::inactive);
```

## 31.4 Use explicit loop for side-effect workflow

```java
for (Command command : commands) {
    handler.handle(command);
}
```

## 31.5 Use bounded executor for concurrent IO

Not parallel stream.

## 31.6 Use outbox for reliable external side effects

Persist intent, then process asynchronously.

## 31.7 Rule

Separate pure selection/transformation from effect execution.

---

# 32. Unsafe Patterns

## 32.1 External list accumulation

```java
list.stream().forEach(result::add)
```

## 32.2 Source mutation

```java
list.stream().forEach(list::remove)
```

## 32.3 peek mutation

```java
stream.peek(entity::markProcessed)
```

## 32.4 Parallel network calls

```java
stream.parallel().forEach(client::call)
```

## 32.5 Side effect before short-circuit

```java
stream.peek(audit).findFirst()
```

## 32.6 Atomic counters for reductions

```java
AtomicInteger sum = new AtomicInteger();
stream.parallel().forEach(sum::addAndGet)
```

## 32.7 Rule

If stream side effect changes state you care about, question the design.

---

# 33. Production Failure Modes

## 33.1 Lost/corrupt accumulation

Cause: external ArrayList with parallel stream.

Fix: collector.

## 33.2 Audit missing

Cause: audit in peek and short-circuit/no terminal.

Fix: explicit workflow.

## 33.3 Duplicate emails

Cause: retry after partial failure.

Fix: outbox/idempotency.

## 33.4 Rate limit incident

Cause: parallel stream network calls.

Fix: bounded concurrency/backpressure.

## 33.5 Transaction partial commit

Cause: repository.save in stream with exception mid-way.

Fix: transaction design/batch/outbox.

## 33.6 Nondeterministic order

Cause: parallel forEach side effects.

Fix: forEachOrdered or loop.

## 33.7 ConcurrentModificationException

Cause: source mutation during traversal.

Fix: removeIf/new collection.

## 33.8 Metrics mismatch

Cause: metrics in peek with optimized/short-circuit pipeline.

Fix: derive metrics from terminal result.

## 33.9 Common pool starvation

Cause: blocking IO in parallel stream.

Fix: dedicated executor/reactive/bulk API.

## 33.10 Entity dirty checking surprise

Cause: mutating JPA entities inside stream.

Fix: explicit transaction/loop/DTO mapping.

---

# 34. Best Practices

## 34.1 Keep lambdas pure by default

No external mutation.

## 34.2 Use collectors for accumulation

Do not mutate external containers.

## 34.3 Avoid `peek` except debugging

Remove it after diagnosis.

## 34.4 Do not mutate source

Use `removeIf`, copy, or collector.

## 34.5 Avoid parallel streams for IO

Use bounded concurrency tools.

## 34.6 Use explicit loops for side-effect workflows

Especially transactional/external effects.

## 34.7 Separate command creation from command execution

Streams are good at creating commands.

## 34.8 Design idempotency

For all external side effects.

## 34.9 Treat side effects as domain events

Persist/queue when reliability matters.

## 34.10 Test failure paths

Partial failure, retry, ordering, concurrency.

---

# 35. Decision Matrix

| Situation | Recommended |
|---|---|
| build list/map/set | collector / `toList` |
| sum/count/reduce | terminal reduction |
| debug value flow | temporary `peek` |
| required audit all items | loop or explicit audit workflow |
| send emails | create commands + outbox/queue |
| database batch save | map to entities + `saveAll` or explicit transaction |
| remove elements from source | `removeIf` or build new collection |
| mutate each object sequentially | explicit loop preferred |
| ordered output side effect | `forEachOrdered` or loop |
| unordered simple logging | `forEach`/`peek` acceptable |
| network calls concurrent | bounded executor/reactive, not parallel stream |
| external mutable accumulation | avoid; use collector |
| index assignment | `IntStream.range`, not AtomicInteger |
| metric count | derive from terminal result |
| short-circuit search | do not attach required side effect before terminal |
| blocking IO | avoid common pool parallel stream |
| parallel CPU pure transform | okay if stateless and measured |
| transaction needed | explicit transaction workflow |

---

# 36. Latihan

## Latihan 1 — External Mutable List

Write parallel stream adding to ArrayList. Explain why unsafe. Fix with `toList`.

## Latihan 2 — Peek No Terminal

Use `peek(System.out::println)` without terminal. Explain output.

## Latihan 3 — Peek Short-Circuit

Use `peek(audit)` before `findFirst`. Explain why audit is partial.

## Latihan 4 — Source Mutation

Remove elements inside stream. Fix with `removeIf`.

## Latihan 5 — AtomicInteger Index

Use AtomicInteger index in stream. Replace with `IntStream.range`.

## Latihan 6 — Notification Commands

Transform users into EmailCommand list, then enqueue commands outside stream.

## Latihan 7 — DB Save Design

Compare `stream.forEach(repository::save)` vs `saveAll` vs explicit loop with transaction handling.

## Latihan 8 — Parallel Network Call Risk

Explain why `parallelStream().forEach(client::call)` can cause rate limit.

## Latihan 9 — Metrics

Count processed items with terminal result instead of `peek` metrics.

## Latihan 10 — Side Effect Classification

For each action—logging, audit, payment, list.add, map.put, repository.save—classify safe/unsafe context.

---

# 37. Ringkasan

Side effects are the hardest part of Stream API correctness.

Core lessons:

- Stream lambdas should generally be non-interfering and stateless.
- Do not modify the stream source during traversal.
- Do not accumulate into external mutable containers; use collectors.
- `peek` is for debugging, not business logic.
- `forEach` is acceptable only for clear side-effect terminal use.
- `forEachOrdered` preserves order at possible performance cost.
- Sequential side effects may work but can hurt clarity.
- Parallel side effects are dangerous without strong design.
- Atomic/concurrent structures do not automatically make stream design good.
- Network calls and database writes need bounded concurrency, transaction, retry, and idempotency design.
- Short-circuiting can make side effects partial.
- Laziness means side effects may not happen until terminal operation.
- Exceptions do not roll back previous side effects.
- Explicit loops are better for imperative workflows.
- Streams are excellent for creating commands/events; execute effects through reliable mechanisms.

Main rule:

```text
Use streams to compute what should happen.
Use explicit workflows to make important things happen.
```

---

# 38. Referensi

1. Java SE 25 — `java.util.stream` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

2. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

3. Java SE 25 — `BaseStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/BaseStream.html

4. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

5. Java SE 25 — `Collection.removeIf`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html#removeIf(java.util.function.Predicate)

6. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

7. Java SE 25 — `AtomicInteger`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html

8. Java SE 25 — `IntStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.html

9. dev.java — The Stream API  
   https://dev.java/learn/api/streams/

10. OpenJDK — `Stream.java` Source  
    https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/stream/Stream.java

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-035.md](./learn-java-collections-and-streams-part-035.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-037.md](./learn-java-collections-and-streams-part-037.md)

</div>
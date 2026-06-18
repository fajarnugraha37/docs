# learn-java-concurrency-and-reactive-part-016.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 016  
# Structured Concurrency: Parent-Child Task Ownership, Fork/Join Scopes, Failure Propagation, Cancellation, Deadlines, and Request-Scoped Fan-Out

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **016**  
> Fokus: memahami **Structured Concurrency** sebagai model desain untuk mengelola banyak task concurrent sebagai satu unit kerja. Kita akan membahas kenapa raw `ExecutorService`, `Future`, dan `CompletableFuture` sering tidak cukup untuk parent-child task ownership; konsep scope; fork/join; failure propagation; sibling cancellation; deadlines; result aggregation; observability; virtual threads; `StructuredTaskScope`; `ShutdownOnFailure`; `ShutdownOnSuccess`; serta pola production untuk request-scoped fan-out.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Masalah Utama: Unstructured Concurrency](#2-masalah-utama-unstructured-concurrency)
3. [Mental Model Structured Concurrency](#3-mental-model-structured-concurrency)
4. [Parent Owns Child Tasks](#4-parent-owns-child-tasks)
5. [Task Lifetime Must Be Bounded](#5-task-lifetime-must-be-bounded)
6. [Kenapa Virtual Threads Membutuhkan Structured Concurrency](#6-kenapa-virtual-threads-membutuhkan-structured-concurrency)
7. [Raw `ExecutorService` Fan-Out Problem](#7-raw-executorservice-fan-out-problem)
8. [`CompletableFuture` Graph Problem](#8-completablefuture-graph-problem)
9. [StructuredTaskScope Overview](#9-structuredtaskscope-overview)
10. [Basic Fork/Join Scope](#10-basic-forkjoin-scope)
11. [`Subtask`](#11-subtask)
12. [Joining Subtasks](#12-joining-subtasks)
13. [Getting Results](#13-getting-results)
14. [Failure Propagation](#14-failure-propagation)
15. [`ShutdownOnFailure`](#15-shutdownonfailure)
16. [`ShutdownOnSuccess`](#16-shutdownonsuccess)
17. [Cancellation Semantics](#17-cancellation-semantics)
18. [Interruption and Cooperative Cancellation](#18-interruption-and-cooperative-cancellation)
19. [Deadlines and Timeouts](#19-deadlines-and-timeouts)
20. [Result Aggregation](#20-result-aggregation)
21. [Partial Result Policy](#21-partial-result-policy)
22. [Error Classification](#22-error-classification)
23. [Nested Scopes](#23-nested-scopes)
24. [Structured Concurrency and Scoped Values](#24-structured-concurrency-and-scoped-values)
25. [Structured Concurrency and ThreadLocal](#25-structured-concurrency-and-threadlocal)
26. [Structured Concurrency vs ExecutorService](#26-structured-concurrency-vs-executorservice)
27. [Structured Concurrency vs CompletableFuture](#27-structured-concurrency-vs-completablefuture)
28. [Structured Concurrency vs Reactive](#28-structured-concurrency-vs-reactive)
29. [Resource Governance Inside Scopes](#29-resource-governance-inside-scopes)
30. [Observability and Diagnostics](#30-observability-and-diagnostics)
31. [Testing Structured Concurrency](#31-testing-structured-concurrency)
32. [Production Design Pattern: Request Fan-Out](#32-production-design-pattern-request-fan-out)
33. [Production Design Pattern: Race First Successful Result](#33-production-design-pattern-race-first-successful-result)
34. [Production Design Pattern: Required + Optional Children](#34-production-design-pattern-required--optional-children)
35. [Production Design Pattern: Bulkheaded Children](#35-production-design-pattern-bulkheaded-children)
36. [Mini Case Study: Dashboard Aggregation](#36-mini-case-study-dashboard-aggregation)
37. [Mini Case Study: Search Across Providers](#37-mini-case-study-search-across-providers)
38. [Mini Case Study: Request Timeout Cancels Children](#38-mini-case-study-request-timeout-cancels-children)
39. [Common Anti-Patterns](#39-common-anti-patterns)
40. [Best Practices](#40-best-practices)
41. [Decision Matrix](#41-decision-matrix)
42. [Latihan](#42-latihan)
43. [Ringkasan](#43-ringkasan)
44. [Referensi](#44-referensi)

---

# 1. Tujuan Bagian Ini

Virtual threads membuat kita mudah membuat banyak concurrent subtasks.

Contoh:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<User> user = executor.submit(() -> userClient.load(userId));
    Future<Orders> orders = executor.submit(() -> orderClient.load(userId));
    Future<Payments> payments = executor.submit(() -> paymentClient.load(userId));

    return new Dashboard(user.get(), orders.get(), payments.get());
}
```

Kode ini terlihat sederhana, tetapi ada pertanyaan penting:

```text
Jika orders gagal, apakah user dan payments harus dicancel?
Jika request timeout, apakah semua child tasks berhenti?
Jika parent method return, apakah ada child task yang masih jalan?
Jika satu child lambat, bagaimana deadline diterapkan?
Jika ada partial result, siapa menentukan policy?
Bagaimana observability menampilkan parent-child relation?
```

Structured concurrency menjawab pertanyaan ini dengan satu prinsip:

```text
Concurrent subtasks should have a clear lexical parent scope.
The parent cannot complete until children are completed, failed, or cancelled.
```

Target bagian ini:

- memahami masalah unstructured concurrency;
- memahami task ownership;
- memahami scope;
- memahami fork/join;
- memahami cancellation sibling;
- memahami failure propagation;
- memahami `StructuredTaskScope`;
- memahami `ShutdownOnFailure`;
- memahami `ShutdownOnSuccess`;
- memahami structured concurrency sebagai pasangan natural virtual threads;
- mampu mendesain request fan-out yang aman.

---

# 2. Masalah Utama: Unstructured Concurrency

Unstructured concurrency terjadi ketika task dibuat tanpa ownership jelas.

Contoh:

```java
void handle(Request request) {
    executor.submit(() -> audit(request));
    executor.submit(() -> notify(request));
    return response;
}
```

Pertanyaan:

```text
Siapa owner audit task?
Bagaimana jika audit gagal?
Apakah task boleh hidup setelah request selesai?
Apakah request cancellation membatalkan task?
Apakah context masih valid?
Bagaimana shutdown menunggu task?
```

## 2.1 Fire-and-forget problem

Fire-and-forget sering berarti:

```text
fire-and-forget-to-handle-errors
fire-and-forget-to-cancel
fire-and-forget-to-observe
```

## 2.2 Detached child task

Task yang dibuat parent tetapi hidup tanpa parent disebut detached.

Detached task bisa benar jika memang durable/background dan punya ownership lain, misalnya queue/job table.

Tetapi untuk request-scoped subtasks, detached task biasanya bug.

## 2.3 Main rule

```text
If a task is started for a request, its lifetime should usually be bounded by that request.
```

---

# 3. Mental Model Structured Concurrency

Structured concurrency mirip structured programming.

Dulu, `goto` membuat control flow liar.

Structured programming memperkenalkan block:

```java
if (...) { ... }
while (...) { ... }
try (...) { ... }
```

Structured concurrency melakukan hal serupa untuk concurrent tasks:

```text
open scope
  fork child A
  fork child B
  join children
close scope
```

Scope membuat lifetime jelas.

## 3.1 Lexical scope

Task hidup di dalam block kode.

Ketika block selesai:

```text
children sudah selesai/cancelled
```

## 3.2 Parent-child tree

Alih-alih task graph liar:

```text
request
  -> child A
  -> child B
      -> grandchild B1
      -> grandchild B2
```

## 3.3 Main rule

```text
Structured concurrency turns concurrent tasks into a tree of owned lifetimes.
```

---

# 4. Parent Owns Child Tasks

Dalam structured concurrency:

```text
parent starts children
parent waits for children
parent handles children failure
parent cancels children when needed
parent returns only after children are resolved
```

## 4.1 Ownership questions

For every child task:

```text
Who started it?
Who waits for it?
Who cancels it?
Who observes failure?
Who owns context?
Who owns resource budget?
```

Structured concurrency makes answer:

```text
the scope/parent
```

## 4.2 Main rule

```text
A child task should not outlive the scope that needs its result.
```

---

# 5. Task Lifetime Must Be Bounded

A task can be:

## 5.1 Request-scoped

Lives only for request.

Example:

```text
load profile
load permissions
load dashboard widgets
```

## 5.2 Job-scoped

Lives for durable job.

Needs job table/queue/status.

## 5.3 Application-scoped

Long-running background service.

Needs lifecycle management.

## 5.4 Main rule

```text
Before forking a task, name its lifetime scope.
```

---

# 6. Kenapa Virtual Threads Membutuhkan Structured Concurrency

Virtual threads make it cheap to create child tasks.

Cheap creation increases risk of unowned task explosion.

```java
for (Item item : items) {
    Thread.ofVirtual().start(() -> process(item));
}
```

This can create:

- no join;
- no cancellation;
- no error aggregation;
- no resource bound;
- no lifecycle.

Structured concurrency gives discipline.

JEP 505 describes structured concurrency as treating groups of related tasks running in different threads as a single unit of work, streamlining error handling and cancellation, improving reliability, and enhancing observability. It also states that structured concurrency is a great match for virtual threads.

## 6.1 Main rule

```text
Virtual threads give cheap concurrency.
Structured concurrency gives safe ownership of that concurrency.
```

---

# 7. Raw `ExecutorService` Fan-Out Problem

Example:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<A> a = executor.submit(this::loadA);
    Future<B> b = executor.submit(this::loadB);

    return combine(a.get(), b.get());
}
```

Problems:

## 7.1 Failure ordering

If `a.get()` fails, `b` may still run unless cancelled.

## 7.2 Timeout

If parent times out, children need cancellation.

## 7.3 Boilerplate

Manual try/catch/cancel.

## 7.4 Context

Need explicit propagation.

## 7.5 Observability

No explicit task tree.

## 7.6 Main rule

```text
ExecutorService starts tasks.
It does not automatically encode parent-child policy.
```

---

# 8. `CompletableFuture` Graph Problem

CompletableFuture can compose async tasks.

But:

- graph can be hard to read;
- cancellation propagation is subtle;
- sibling cancellation is manual;
- failure aggregation is nontrivial;
- context propagation is manual;
- stack traces are fragmented;
- parent-child lifetime is not lexical.

Example:

```java
CompletableFuture<A> a = supplyAsync(this::loadA);
CompletableFuture<B> b = supplyAsync(this::loadB);

return a.thenCombine(b, this::combine);
```

If `a` fails, does `b` cancel?

Not necessarily.

## 8.1 Main rule

```text
CompletableFuture models dependency graph.
Structured concurrency models task ownership scope.
```

---

# 9. StructuredTaskScope Overview

`StructuredTaskScope` is Java's API for structured concurrency.

Conceptual usage:

```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Subtask<A> a = scope.fork(this::loadA);
    Subtask<B> b = scope.fork(this::loadB);

    scope.join();
    scope.throwIfFailed();

    return combine(a.get(), b.get());
}
```

## 9.1 Preview status

Structured concurrency has evolved through preview/incubator JEPs. In Java 25, refer to the current `StructuredTaskScope` API/JEP state for exact method signatures and preview requirements.

## 9.2 Main concepts

- scope;
- fork;
- subtask;
- join;
- failure policy;
- shutdown/cancel;
- close.

## 9.3 Main rule

```text
StructuredTaskScope is an owner block for child tasks.
```

---

# 10. Basic Fork/Join Scope

Pseudo-code:

```java
try (var scope = new StructuredTaskScope<>()) {
    var user = scope.fork(() -> userClient.load(userId));
    var orders = scope.fork(() -> orderClient.load(userId));

    scope.join();

    return new UserOrders(user.get(), orders.get());
}
```

## 10.1 Fork

Starts child task.

## 10.2 Join

Waits for forked subtasks.

## 10.3 Close

Ensures scope lifecycle is completed.

## 10.4 Main rule

```text
fork starts children; join waits; close bounds lifetime.
```

---

# 11. `Subtask`

A subtask represents a forked child computation.

It usually exposes:

- state;
- result;
- exception;
- get result after success.

Conceptually:

```java
Subtask<User> user = scope.fork(() -> loadUser());
```

After join and success:

```java
User result = user.get();
```

## 11.1 Do not read too early

Reading result before join/success is incorrect.

## 11.2 Main rule

```text
Subtask is the structured handle to a child result.
```

---

# 12. Joining Subtasks

Joining waits for tasks according to scope policy.

```java
scope.join();
```

Some variants support deadline/time-bound join depending API version.

## 12.1 Join is not necessarily success

After join, tasks may have:

- succeeded;
- failed;
- been cancelled;
- caused shutdown.

Need policy method:

```java
scope.throwIfFailed();
```

## 12.2 Main rule

```text
join means children reached a scope-defined stopping point,
not automatically all results are successful.
```

---

# 13. Getting Results

After successful join/failure check:

```java
User userResult = user.get();
Orders orderResult = orders.get();
```

## 13.1 Result access must follow policy

Pattern:

```java
scope.join();
scope.throwIfFailed();

return combine(a.get(), b.get());
```

## 13.2 Main rule

```text
Get subtask results only after the scope has joined and failure policy has passed.
```

---

# 14. Failure Propagation

Structured concurrency makes failure policy explicit.

Question:

```text
If one child fails, what should happen to siblings?
```

Common policies:

## 14.1 All must succeed

Cancel siblings on first failure.

## 14.2 First success wins

Cancel losers after first success.

## 14.3 Partial results allowed

Collect successful optional subtasks; handle failures.

## 14.4 Best effort side task

Do not fail parent, but observe/log failure.

## 14.5 Main rule

```text
Failure policy is part of concurrency design, not an afterthought.
```

---

# 15. `ShutdownOnFailure`

`ShutdownOnFailure` is for all-required subtasks.

Concept:

```text
if any child fails,
shutdown scope,
cancel unfinished siblings,
then parent observes failure.
```

Example:

```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var user = scope.fork(() -> userClient.load(userId));
    var permissions = scope.fork(() -> permissionClient.load(userId));

    scope.join();
    scope.throwIfFailed();

    return new UserContext(user.get(), permissions.get());
}
```

## 15.1 Use when

- every child is required;
- failure of one makes result impossible;
- sibling work should stop.

## 15.2 Main rule

```text
ShutdownOnFailure fits “all children required” fan-out.
```

---

# 16. `ShutdownOnSuccess`

`ShutdownOnSuccess` is for race/hedging.

Concept:

```text
first successful child wins,
unfinished siblings cancelled.
```

Example conceptual search:

```java
try (var scope = new StructuredTaskScope.ShutdownOnSuccess<Result>()) {
    scope.fork(() -> searchProviderA(query));
    scope.fork(() -> searchProviderB(query));
    scope.fork(() -> searchProviderC(query));

    scope.join();

    return scope.result();
}
```

## 16.1 Use when

- multiple providers can answer;
- first successful result enough;
- losers should stop;
- latency matters.

## 16.2 Caution

Hedging duplicates load.

Use rate limits and budget.

## 16.3 Main rule

```text
ShutdownOnSuccess fits “first good answer wins” concurrency.
```

---

# 17. Cancellation Semantics

When scope shuts down, unfinished subtasks are cancelled/interrupted.

But interruption is cooperative.

If child ignores interruption:

```text
it may keep running until blocking call returns or task checks interrupt
```

## 17.1 Child task must cooperate

```java
if (Thread.currentThread().isInterrupted()) {
    throw new InterruptedException();
}
```

Blocking APIs should have timeouts.

## 17.2 Main rule

```text
Structured cancellation requests stop.
Task code and dependencies must make stop effective.
```

---

# 18. Interruption and Cooperative Cancellation

Write child tasks to honor interruption.

## 18.1 Blocking calls

Use clients that respond to interrupt or have timeout.

## 18.2 Loops

```java
while (...) {
    if (Thread.currentThread().isInterrupted()) {
        throw new InterruptedException();
    }
    doChunk();
}
```

## 18.3 Restore interrupt when catching

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw e;
}
```

## 18.4 Main rule

```text
Interruption is a cancellation signal.
Do not swallow it.
```

---

# 19. Deadlines and Timeouts

Structured scopes should align with request deadline.

Example conceptual:

```java
Instant deadline = context.deadline();

try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var a = scope.fork(() -> callA(context));
    var b = scope.fork(() -> callB(context));

    scope.joinUntil(deadline);
    scope.throwIfFailed();

    return combine(a.get(), b.get());
}
```

Exact API names may vary by Java version/preview state.

## 19.1 Child timeouts

Each child should also use downstream timeout based on remaining budget.

## 19.2 Main rule

```text
Parent deadline should bound all child work.
```

---

# 20. Result Aggregation

For all-required:

```java
return new Result(a.get(), b.get(), c.get());
```

For many subtasks:

```java
List<Subtask<Item>> subtasks = items.stream()
    .map(item -> scope.fork(() -> process(item)))
    .toList();

scope.join();
scope.throwIfFailed();

List<Result> results = subtasks.stream()
    .map(Subtask::get)
    .toList();
```

## 20.1 Beware unbounded fan-out

Do not fork millions of subtasks blindly.

## 20.2 Main rule

```text
Aggregation should preserve child result ownership and resource bounds.
```

---

# 21. Partial Result Policy

Not every child is required.

Example dashboard:

- profile required;
- cases required;
- notifications optional;
- recommendations optional.

Policy:

```text
required child failure -> fail request
optional child failure -> fallback empty/default and record metric
```

## 21.1 Design explicitly

Do not let optional failures accidentally fail everything.

## 21.2 Separate scopes

You may separate required and optional work.

## 21.3 Main rule

```text
Partial result policy must be explicit per child.
```

---

# 22. Error Classification

Classify child failures:

## 22.1 Critical

Parent cannot succeed.

## 22.2 Optional

Parent can degrade.

## 22.3 Transient

May retry within budget.

## 22.4 Permanent

Do not retry.

## 22.5 Security/data isolation

Fail closed.

## 22.6 Main rule

```text
Structured concurrency handles failure propagation,
but domain decides failure meaning.
```

---

# 23. Nested Scopes

A child task may create its own structured scope.

Example:

```text
request scope
  -> dashboard scope
      -> profile
      -> cases
          -> case count
          -> case SLA
```

## 23.1 Good

Mirrors call structure.

## 23.2 Caution

Avoid excessive fan-out at multiple levels.

Propagate deadlines and resource limits.

## 23.3 Main rule

```text
Nested scopes should mirror nested ownership, not create hidden task explosion.
```

---

# 24. Structured Concurrency and Scoped Values

Scoped Values work naturally with structured concurrency.

JEP 506 states scoped values enable sharing immutable data with callees within a thread and child threads, and are especially useful together with virtual threads and structured concurrency.

Concept:

```java
ScopedValue.where(CONTEXT, context)
    .run(() -> {
        try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
            var a = scope.fork(() -> serviceA.call());
            var b = scope.fork(() -> serviceB.call());

            scope.join();
            scope.throwIfFailed();

            return combine(a.get(), b.get());
        }
    });
```

Child tasks can access scoped context if supported by the API/version.

## 24.1 Main rule

```text
Use Scoped Values for immutable context shared down a structured task tree.
```

---

# 25. Structured Concurrency and ThreadLocal

ThreadLocal can work, but has issues:

- hidden mutable context;
- cleanup required;
- propagation unclear;
- child thread inheritance depends on mechanism;
- context may be stale or missing.

## 25.1 Prefer

- explicit context parameter;
- Scoped Values;
- immutable snapshots.

## 25.2 Main rule

```text
Structured concurrency clarifies task lifetime.
Use context mechanisms that also have clear lifetime.
```

---

# 26. Structured Concurrency vs ExecutorService

| Aspect | ExecutorService | Structured Concurrency |
|---|---|---|
| Task ownership | manual | scope-owned |
| Child lifetime | manual | bounded by scope |
| Failure policy | manual | built into scope policy |
| Sibling cancellation | manual | built into scope policy |
| Observability | task list/pool | parent-child tree |
| Code structure | can be detached | lexical block |
| Best for | general task execution service | request-scoped related subtasks |

## 26.1 Main rule

```text
ExecutorService is a task execution mechanism.
Structured concurrency is a task ownership mechanism.
```

---

# 27. Structured Concurrency vs CompletableFuture

| Aspect | CompletableFuture | Structured Concurrency |
|---|---|---|
| Style | async graph | direct blocking-style scope |
| Failure | graph propagation | scope policy |
| Cancellation | subtle/manual | scope shutdown |
| Stack trace | fragmented | thread stack per child |
| Context | manual | works well with Scoped Values |
| Best for | async API composition | parent-owned finite subtasks |

## 27.1 Use both?

Possible.

But avoid mixing unnecessarily.

## 27.2 Main rule

```text
Use CompletableFuture for async values.
Use structured concurrency for owned child tasks.
```

---

# 28. Structured Concurrency vs Reactive

Reactive:

- streams;
- backpressure;
- event pipelines;
- asynchronous demand.

Structured concurrency:

- finite child tasks;
- request-scoped fan-out;
- parent-child lifecycle.

## 28.1 Main rule

```text
Structured concurrency is not a stream model.
It is a lifecycle model for finite concurrent tasks.
```

---

# 29. Resource Governance Inside Scopes

Structured scope does not automatically limit resources.

If you fork 1,000 DB subtasks:

```text
scope owns them,
but DB may still overload
```

Use:

- semaphore;
- bounded input;
- per-downstream bulkhead;
- rate limit;
- chunking.

Example:

```java
var task = scope.fork(() -> {
    if (!dbPermits.tryAcquire(100, TimeUnit.MILLISECONDS)) {
        throw new ServiceBusyException();
    }
    try {
        return repository.query(id);
    } finally {
        dbPermits.release();
    }
});
```

## 29.1 Main rule

```text
Structured concurrency gives ownership, not infinite resource capacity.
```

---

# 30. Observability and Diagnostics

Structured concurrency improves observability because tasks form hierarchy.

Track:

## 30.1 Parent

- request ID;
- scope name;
- deadline;
- total duration;
- result/failure.

## 30.2 Child

- child name;
- dependency;
- duration;
- success/failure/cancelled;
- timeout;
- resource wait.

## 30.3 Aggregation

- slowest child;
- failed child;
- cancelled siblings;
- partial fallback count.

## 30.4 Main rule

```text
Every forked child should have a name, purpose, timeout, and metric.
```

---

# 31. Testing Structured Concurrency

Test:

## 31.1 All success

All subtasks succeed and result combines.

## 31.2 One failure

Required child fails; siblings cancelled.

## 31.3 Timeout

Parent deadline cancels unfinished children.

## 31.4 Optional failure

Optional child fails; fallback used.

## 31.5 Interruption

Child honors interrupt.

## 31.6 Resource limit

Semaphore rejection/timeout path.

## 31.7 Main rule

```text
Structured concurrency tests should assert lifecycle, not just result.
```

---

# 32. Production Design Pattern: Request Fan-Out

Use when one request needs multiple independent blocking calls.

```java
Response handle(ExecutionContext context, Request request) throws Exception {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        var profile = scope.fork(() -> profileClient.load(context, request.userId()));
        var cases = scope.fork(() -> caseClient.openCases(context, request.userId()));
        var sla = scope.fork(() -> slaClient.summary(context, request.userId()));

        scope.join();
        scope.throwIfFailed();

        return Response.of(profile.get(), cases.get(), sla.get());
    }
}
```

## 32.1 Add

- deadline;
- per-client bulkhead;
- child metrics;
- cancellation test.

## 32.2 Main rule

```text
Request fan-out is the canonical structured concurrency use case.
```

---

# 33. Production Design Pattern: Race First Successful Result

Use `ShutdownOnSuccess`.

Example:

```java
try (var scope = new StructuredTaskScope.ShutdownOnSuccess<SearchResult>()) {
    scope.fork(() -> providerA.search(query));
    scope.fork(() -> providerB.search(query));
    scope.fork(() -> providerC.search(query));

    scope.join();

    return scope.result();
}
```

## 33.1 Use cases

- replicated read;
- provider fallback;
- hedged request;
- lowest-latency lookup.

## 33.2 Caution

Costs more downstream capacity.

## 33.3 Main rule

```text
First-success race should be budgeted because it intentionally duplicates work.
```

---

# 34. Production Design Pattern: Required + Optional Children

Example dashboard:

```text
required: profile, cases
optional: recommendations, notifications
```

Approach:

- required scope with `ShutdownOnFailure`;
- optional tasks with independent fallback/observation;
- or custom policy.

Conceptual:

```java
Profile profile;
CaseSummary cases;

try (var required = new StructuredTaskScope.ShutdownOnFailure()) {
    var p = required.fork(() -> profileClient.load(context));
    var c = required.fork(() -> caseClient.summary(context));

    required.join();
    required.throwIfFailed();

    profile = p.get();
    cases = c.get();
}

NotificationCount notifications = loadNotificationsOrDefault(context);
```

## 34.1 Main rule

```text
Do not mix required and optional children without explicit policy.
```

---

# 35. Production Design Pattern: Bulkheaded Children

Each child uses its own dependency bulkhead.

```java
var payment = scope.fork(() ->
    paymentBulkhead.call(() -> paymentClient.load(context))
);

var document = scope.fork(() ->
    documentBulkhead.call(() -> documentClient.load(context))
);
```

## 35.1 Why

Scope ownership does not isolate dependencies.

Bulkheads do.

## 35.2 Main rule

```text
Use structured scope for lifecycle and bulkheads for capacity isolation.
```

---

# 36. Mini Case Study: Dashboard Aggregation

## 36.1 Requirement

Dashboard needs:

- user;
- open cases;
- SLA;
- notification count.

All required except notifications.

## 36.2 Design

Required:

```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var user = scope.fork(() -> userClient.load(context));
    var cases = scope.fork(() -> caseClient.openCases(context));
    var sla = scope.fork(() -> slaClient.summary(context));

    scope.join();
    scope.throwIfFailed();

    NotificationCount notifications =
        notificationClient.countOrDefault(context);

    return new Dashboard(user.get(), cases.get(), sla.get(), notifications);
}
```

## 36.3 Better optional parallelism

Optional child can run in separate policy if beneficial.

## 36.4 Lesson

```text
Classify child tasks before choosing failure policy.
```

---

# 37. Mini Case Study: Search Across Providers

## 37.1 Requirement

Search providers A, B, C. First valid result wins.

## 37.2 Design

Use `ShutdownOnSuccess`.

## 37.3 Policy

- each provider has timeout;
- global deadline;
- losers cancelled;
- rate limit hedging;
- if all fail, aggregate failure.

## 37.4 Lesson

```text
First-success structured scope makes hedging explicit and cancellable.
```

---

# 38. Mini Case Study: Request Timeout Cancels Children

## 38.1 Problem

Request times out at 2 seconds but child tasks keep running for 10 seconds.

## 38.2 Structured fix

Parent scope joins until deadline; unfinished children cancelled.

Child clients also get remaining timeout.

## 38.3 Important

Cancellation only works if children and clients honor interruption/timeouts.

## 38.4 Lesson

```text
Parent timeout must become child cancellation plus resource timeout.
```

---

# 39. Common Anti-Patterns

## 39.1 Fork without join

Unstructured task.

## 39.2 Scope without failure policy

Ambiguous behavior.

## 39.3 Ignoring child failure

Hidden incident.

## 39.4 No sibling cancellation

Wasted work after failure.

## 39.5 Forking unbounded subtasks

Memory/resource explosion.

## 39.6 No deadline

Children can hang.

## 39.7 Children ignore interrupt

Cancellation ineffective.

## 39.8 Mixing optional and required tasks casually

Wrong user-facing behavior.

## 39.9 Propagating mutable ThreadLocal context

Context leak.

## 39.10 Treating structured concurrency as resource limiter

It is not.

---

# 40. Best Practices

## 40.1 Use structured concurrency for request-scoped fan-out

Especially with virtual threads.

## 40.2 Name child tasks conceptually

At least in logs/metrics.

## 40.3 Define failure policy first

All required, first success, partial allowed.

## 40.4 Propagate deadlines

Parent budget bounds children.

## 40.5 Make child tasks interrupt-aware

Cancellation must work.

## 40.6 Use resource bulkheads

Semaphore/rate limit per dependency.

## 40.7 Avoid unbounded fork

Chunk/batch/limit.

## 40.8 Use immutable context

Explicit context or Scoped Values.

## 40.9 Test failure and cancellation

Not only success.

## 40.10 Prefer structured scopes over manual Future cancellation boilerplate

When task lifetime is parent-owned.

---

# 41. Decision Matrix

| Situation | Recommended |
|---|---|
| Request needs several required downstream calls | `ShutdownOnFailure` |
| First successful provider wins | `ShutdownOnSuccess` |
| Optional dashboard widget | fallback/optional policy |
| Child tasks must not outlive request | structured scope |
| Durable background work | queue/job table, not request scope |
| Millions of items | bounded batching, not unbounded fork |
| CPU-bound child tasks | bounded CPU executor |
| Need stream/backpressure | reactive/stream model |
| Need immutable context in children | Scoped Values or explicit context |
| Existing CF API | CompletableFuture may remain natural |
| Manual Future fan-out with complex cancellation | structured concurrency |
| Downstream resource limited | semaphore/bulkhead inside child |

---

# 42. Latihan

## Latihan 1 — Raw Future Problem

Tulis fan-out dengan `ExecutorService` lalu jelaskan failure/cancellation bug-nya.

## Latihan 2 — ShutdownOnFailure

Desain pseudo-code dashboard dengan 3 required children.

## Latihan 3 — ShutdownOnSuccess

Desain search provider race, first successful result wins.

## Latihan 4 — Optional Child

Tambahkan optional notification count dengan fallback default.

## Latihan 5 — Deadline

Buat `ExecutionContext` dengan deadline dan pakai remaining time di child client.

## Latihan 6 — Cancellation

Buat child task loop yang honor interrupt.

## Latihan 7 — Bulkhead

Tambahkan semaphore ke child task yang memanggil DB.

## Latihan 8 — Nested Scope

Desain nested scope untuk case summary yang butuh count dan SLA.

## Latihan 9 — Observability

Buat metric list untuk parent scope dan child subtasks.

## Latihan 10 — Compare

Bandingkan CompletableFuture fan-out vs StructuredTaskScope fan-out untuk endpoint yang sama.

---

# 43. Ringkasan

Structured concurrency adalah model untuk mengelola related concurrent tasks sebagai satu unit kerja.

Core lessons:

- Unstructured concurrency menciptakan task tanpa ownership jelas.
- Structured concurrency memberi lexical scope untuk child tasks.
- Parent owns child tasks.
- Parent tidak selesai sebelum children selesai/fail/cancel.
- Virtual threads membuat child tasks murah; structured concurrency membuatnya aman.
- Raw `ExecutorService` tidak otomatis memberi sibling cancellation/failure policy.
- `CompletableFuture` bagus untuk async graph, tetapi tidak selalu jelas untuk task ownership.
- `StructuredTaskScope` menyediakan scope, fork, join, subtask, dan policy.
- `ShutdownOnFailure` cocok untuk all-required children.
- `ShutdownOnSuccess` cocok untuk first-success race.
- Cancellation berbasis interruption dan harus cooperative.
- Deadlines harus membatasi semua child work.
- Required/optional child harus diklasifikasi.
- Nested scopes harus merefleksikan ownership.
- Scoped Values cocok untuk immutable context dalam structured task tree.
- Structured concurrency bukan resource limiter.
- Observability harus parent-child aware.
- Tests harus memeriksa lifecycle, failure, cancellation, dan timeout.

Main rule:

```text
Use structured concurrency when concurrent subtasks belong to one parent operation.
It gives virtual-thread fan-out a lifecycle, failure policy, and cancellation boundary.
```

---

# 44. Referensi

1. OpenJDK JEP 505 — Structured Concurrency  
   https://openjdk.org/jeps/505

2. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

3. OpenJDK JEP 506 — Scoped Values  
   https://openjdk.org/jeps/506

4. Java SE 25 — `StructuredTaskScope`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html

5. Java SE 25 — `StructuredTaskScope.Subtask`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.Subtask.html

6. Java SE 25 — `Executors.newVirtualThreadPerTaskExecutor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html#newVirtualThreadPerTaskExecutor()

7. Java SE 25 — `Future`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Future.html

8. Java SE 25 — `CompletableFuture`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html

9. Java SE 25 — `Semaphore`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html

10. Oracle Java SE 25 Guide — Virtual Threads  
    https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 015](./learn-java-concurrency-and-reactive-part-015.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 017](./learn-java-concurrency-and-reactive-part-017.md)

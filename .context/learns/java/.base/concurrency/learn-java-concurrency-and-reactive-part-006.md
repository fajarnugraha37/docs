# learn-java-concurrency-and-reactive-part-006.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 006  
# Futures, CompletableFuture, and Async Composition: Result Handles, CompletionStage Pipelines, Fan-Out/Fan-In, Exceptions, Timeouts, Cancellation, Executors, and Modern Java Trade-Offs

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **006**  
> Fokus: memahami `Future` dan `CompletableFuture` sebagai model asynchronous computation di Java. Kita akan membahas `Future` sebagai handle hasil, keterbatasannya, `CompletableFuture` sebagai `Future` + `CompletionStage`, composition (`thenApply`, `thenCompose`, `thenCombine`, `allOf`, `anyOf`), executor selection, common pool pitfalls, exception flow, timeout, cancellation limitations, context propagation, debugging, dan kapan lebih baik memakai virtual threads atau structured concurrency.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Future sebagai Handle, Bukan Hasil](#2-mental-model-future-sebagai-handle-bukan-hasil)
3. [`Future` Recap](#3-future-recap)
4. [Keterbatasan `Future`](#4-keterbatasan-future)
5. [`CompletableFuture`: Future + CompletionStage](#5-completablefuture-future--completionstage)
6. [Completion, CompletionStage, and Pipeline Thinking](#6-completion-completionstage-and-pipeline-thinking)
7. [Creating CompletableFuture](#7-creating-completablefuture)
8. [`completedFuture`, Manual `complete`, and `completeExceptionally`](#8-completedfuture-manual-complete-and-completeexceptionally)
9. [`runAsync` vs `supplyAsync`](#9-runasync-vs-supplyasync)
10. [Default Executor and Common Pool](#10-default-executor-and-common-pool)
11. [Always Consider Custom Executors](#11-always-consider-custom-executors)
12. [Sync vs Async Continuations](#12-sync-vs-async-continuations)
13. [`thenApply`: Transforming Result](#13-thenapply-transforming-result)
14. [`thenAccept` and `thenRun`: Side-Effect Continuations](#14-thenaccept-and-thenrun-side-effect-continuations)
15. [`thenCompose`: Flattening Dependent Async Work](#15-thencompose-flattening-dependent-async-work)
16. [`thenCombine`: Combining Independent Results](#16-thencombine-combining-independent-results)
17. [`allOf`: Wait for All](#17-allof-wait-for-all)
18. [`anyOf`: First Completed](#18-anyof-first-completed)
19. [Fan-Out/Fan-In with CompletableFuture](#19-fan-outfan-in-with-completablefuture)
20. [Exception Flow](#20-exception-flow)
21. [`exceptionally`, `handle`, `whenComplete`](#21-exceptionally-handle-whencomplete)
22. [Timeouts: `orTimeout`, `completeOnTimeout`, and Delayed Executor](#22-timeouts-ortimeout-completeontimeout-and-delayed-executor)
23. [Cancellation Semantics and Limitations](#23-cancellation-semantics-and-limitations)
24. [Cancellation Propagation in Future Graphs](#24-cancellation-propagation-in-future-graphs)
25. [Blocking with `get`/`join`](#25-blocking-with-getjoin)
26. [Avoiding Nested Futures](#26-avoiding-nested-futures)
27. [Async Composition vs Parallelism](#27-async-composition-vs-parallelism)
28. [Context Propagation](#28-context-propagation)
29. [Transactions and Security Context](#29-transactions-and-security-context)
30. [Debugging CompletableFuture Pipelines](#30-debugging-completablefuture-pipelines)
31. [Observability and Metrics](#31-observability-and-metrics)
32. [CompletableFuture with Virtual Threads](#32-completablefuture-with-virtual-threads)
33. [CompletableFuture vs Structured Concurrency](#33-completablefuture-vs-structured-concurrency)
34. [CompletableFuture vs Reactive](#34-completablefuture-vs-reactive)
35. [Mini Case Study: Dashboard Fan-Out](#35-mini-case-study-dashboard-fan-out)
36. [Mini Case Study: Async Cache Warmup](#36-mini-case-study-async-cache-warmup)
37. [Mini Case Study: Hidden Exception from Ignored Future](#37-mini-case-study-hidden-exception-from-ignored-future)
38. [Common Anti-Patterns](#38-common-anti-patterns)
39. [Best Practices](#39-best-practices)
40. [Decision Matrix](#40-decision-matrix)
41. [Latihan](#41-latihan)
42. [Ringkasan](#42-ringkasan)
43. [Referensi](#43-referensi)

---

# 1. Tujuan Bagian Ini

Sampai part sebelumnya, kita sudah memahami:

- `Thread`;
- task/work unit;
- `Executor`;
- `ExecutorService`;
- `Future`;
- thread pool sizing;
- queue/rejection/backpressure.

Sekarang kita fokus pada model asynchronous result composition:

```java
CompletableFuture<T>
```

`CompletableFuture` penting karena ia menggabungkan dua hal:

```text
Future<T>          = handle terhadap hasil asynchronous computation
CompletionStage<T> = pipeline yang menjalankan action saat stage selesai
```

Dengan `Future`, kita bisa submit task dan blocking menunggu hasil:

```java
Future<User> future = executor.submit(() -> loadUser(userId));
User user = future.get();
```

Dengan `CompletableFuture`, kita bisa compose:

```java
CompletableFuture<UserDto> dto =
    loadUserAsync(userId)
        .thenCompose(user -> loadOrdersAsync(user.id())
            .thenApply(orders -> UserDto.from(user, orders)));
```

Tetapi `CompletableFuture` juga sering disalahgunakan:

- default common pool tanpa sadar;
- nested futures;
- exception hilang;
- cancellation tidak benar-benar menghentikan task;
- timeout hanya menyelesaikan future tetapi task tetap jalan;
- context/security/transaction tidak ikut pindah;
- pipeline sulit dibaca;
- blocking `join()` di tempat salah;
- fan-out tanpa cancellation sibling;
- memakai async composition padahal virtual threads/structured concurrency lebih sederhana.

Tujuan bagian ini:

```text
Memahami CompletableFuture sebagai tool komposisi async,
bukan sekadar cara “membuat kode paralel”.
```

---

# 2. Mental Model: Future sebagai Handle, Bukan Hasil

`Future<T>` bukan `T`.

`Future<T>` adalah handle ke hasil yang mungkin belum tersedia.

```java
Future<User> future = executor.submit(() -> loadUser(userId));
```

Pada titik ini:

```text
User belum tentu ada.
Task mungkin belum mulai.
Task mungkin sedang queue.
Task mungkin sedang running.
Task mungkin gagal.
Task mungkin dicancel.
```

Maka `Future` menjawab:

```text
Bagaimana saya menunggu, mengambil, membatalkan,
atau mengetahui status computation ini?
```

## 2.1 Future is a promise-like handle

Dalam banyak bahasa, konsep ini disebut promise/future.

Di Java:

- `Future` adalah handle dasar;
- `CompletableFuture` adalah future yang bisa completed manual dan composed.

## 2.2 Main rule

```text
A Future is not the result.
It is ownership of a possible result.
```

---

# 3. `Future` Recap

Java SE 25 `Future` mendeskripsikan `Future` sebagai representasi hasil asynchronous computation, dengan method untuk mengecek completion, menunggu completion, mengambil result, dan cancel. 

Core methods:

```java
boolean cancel(boolean mayInterruptIfRunning);
boolean isCancelled();
boolean isDone();
T get() throws InterruptedException, ExecutionException;
T get(long timeout, TimeUnit unit)
    throws InterruptedException, ExecutionException, TimeoutException;
```

## 3.1 Success

```java
String result = future.get();
```

## 3.2 Failure

```java
try {
    future.get();
} catch (ExecutionException e) {
    Throwable cause = e.getCause();
}
```

## 3.3 Interrupted while waiting

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw e;
}
```

## 3.4 Timeout while waiting

```java
try {
    return future.get(1, TimeUnit.SECONDS);
} catch (TimeoutException e) {
    future.cancel(true);
    throw e;
}
```

## 3.5 Main rule

```text
Future.get is a blocking boundary and must be treated like blocking I/O:
handle interrupt, timeout, failure, and cancellation.
```

---

# 4. Keterbatasan `Future`

`Future` berguna, tetapi komposisinya lemah.

## 4.1 No easy transformation

Dengan `Future<User>`, tidak ada method built-in pada `Future` untuk:

```text
when done, map User to UserDto
```

## 4.2 No easy chaining

Tidak ada:

```text
after user loaded, load orders
```

## 4.3 No easy combine

Tidak ada:

```text
combine user future and orders future
```

## 4.4 No callback

Harus polling atau blocking `get`.

## 4.5 Cancellation limited

`cancel(true)` hanya request cancellation.

## 4.6 Main rule

```text
Future is a result handle.
CompletableFuture is a composition tool.
```

---

# 5. `CompletableFuture`: Future + CompletionStage

Java SE 25 `CompletableFuture` adalah `Future` yang dapat explicitly completed dan juga `CompletionStage` yang mendukung dependent functions/actions yang dipicu saat completion. 

Artinya:

```text
CompletableFuture<T>
  is Future<T>
  and CompletionStage<T>
```

## 5.1 Future side

You can:

- `get`;
- `join`;
- `cancel`;
- check `isDone`.

## 5.2 CompletionStage side

You can:

- transform;
- compose;
- combine;
- recover;
- observe;
- run actions on completion.

## 5.3 Completable side

You can manually complete:

```java
future.complete(value);
future.completeExceptionally(error);
```

## 5.4 Main rule

```text
CompletableFuture is both a result container and a pipeline node.
```

---

# 6. Completion, CompletionStage, and Pipeline Thinking

A `CompletionStage<T>` represents a stage that completes with:

- value `T`; or
- exception.

Then dependent stages can run.

Example:

```java
CompletableFuture<UserDto> dtoFuture =
    loadUserAsync(userId)
        .thenApply(user -> UserDto.from(user));
```

Pipeline:

```text
loadUserAsync
  -> thenApply User to UserDto
```

## 6.1 Stage can be incomplete

Until upstream completes.

## 6.2 Stage can complete exceptionally

Then normal transformations may be skipped.

## 6.3 Stage can run in same thread or async executor

Depends on method variant.

## 6.4 Main rule

```text
CompletableFuture code is a graph of completion-triggered stages,
not just a sequence of method calls.
```

---

# 7. Creating CompletableFuture

## 7.1 Already completed

```java
CompletableFuture<String> cf =
    CompletableFuture.completedFuture("ok");
```

## 7.2 Manual incomplete

```java
CompletableFuture<String> cf = new CompletableFuture<>();
```

Later:

```java
cf.complete("ok");
```

## 7.3 Async runnable

```java
CompletableFuture<Void> cf =
    CompletableFuture.runAsync(() -> doWork());
```

## 7.4 Async supplier

```java
CompletableFuture<User> cf =
    CompletableFuture.supplyAsync(() -> loadUser(userId));
```

## 7.5 Async with custom executor

```java
CompletableFuture<User> cf =
    CompletableFuture.supplyAsync(
        () -> loadUser(userId),
        userLookupExecutor
    );
```

## 7.6 Main rule

```text
Creation method decides when work starts and where it runs.
```

---

# 8. `completedFuture`, Manual `complete`, and `completeExceptionally`

## 8.1 `completedFuture`

Useful for:

- test;
- fallback;
- adapter;
- already-known value.

```java
CompletableFuture<User> user =
    CompletableFuture.completedFuture(cachedUser);
```

## 8.2 Manual complete

```java
CompletableFuture<Response> cf = new CompletableFuture<>();

callbackApi.send(request, new Callback() {
    @Override
    public void onSuccess(Response response) {
        cf.complete(response);
    }

    @Override
    public void onFailure(Throwable error) {
        cf.completeExceptionally(error);
    }
});
```

## 8.3 Race to complete

If multiple threads attempt to complete, only one succeeds.

```java
boolean won = cf.complete(value);
```

## 8.4 Main rule

```text
Manual completion is useful for adapting callback APIs,
but requires careful ownership and timeout/cancellation handling.
```

---

# 9. `runAsync` vs `supplyAsync`

## 9.1 `runAsync`

Use for task without result.

```java
CompletableFuture<Void> future =
    CompletableFuture.runAsync(() -> sendAudit(event), executor);
```

## 9.2 `supplyAsync`

Use for task with result.

```java
CompletableFuture<Profile> future =
    CompletableFuture.supplyAsync(() -> loadProfile(userId), executor);
```

## 9.3 Exceptions

Both complete exceptionally if task throws.

## 9.4 Main rule

```text
runAsync is async Runnable.
supplyAsync is async Supplier with result.
```

---

# 10. Default Executor and Common Pool

If you call async method without executor:

```java
CompletableFuture.supplyAsync(() -> loadUser(userId));
```

It uses default asynchronous execution facility. For many `CompletableFuture` async methods, this is typically `ForkJoinPool.commonPool()` unless configured/overridden by implementation details. Java SE 25 `ForkJoinPool` docs describe `commonPool()` as a static common pool used by tasks not explicitly submitted to a specified pool. 

## 10.1 Why this matters

Common pool is shared.

If you put blocking I/O in common pool:

```java
CompletableFuture.supplyAsync(() -> jdbcQuery());
```

you may starve unrelated common-pool work.

## 10.2 Common pool okay for

- small CPU-ish async tasks;
- simple demos;
- non-blocking/short actions;
- cases where shared pool is intentional.

## 10.3 Use custom executor for

- blocking I/O;
- long-running tasks;
- workload isolation;
- critical business task;
- custom naming/metrics;
- different capacity.

## 10.4 Main rule

```text
If you do not specify an executor, you accept someone else’s execution policy.
```

---

# 11. Always Consider Custom Executors

Example:

```java
ExecutorService userClientExecutor = new ThreadPoolExecutor(
    16,
    32,
    30,
    TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(500),
    Thread.ofPlatform().name("user-client-", 1).factory(),
    new ThreadPoolExecutor.AbortPolicy()
);
```

Use:

```java
CompletableFuture<User> user =
    CompletableFuture.supplyAsync(
        () -> userClient.load(userId),
        userClientExecutor
    );
```

## 11.1 With virtual threads

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    CompletableFuture<User> user =
        CompletableFuture.supplyAsync(() -> userClient.load(userId), executor);
}
```

But be careful with executor lifetime. If stages continue after closing, design is wrong.

## 11.2 Main rule

```text
Executor choice is part of CompletableFuture correctness and performance.
```

---

# 12. Sync vs Async Continuations

`CompletableFuture` methods often have variants:

```java
thenApply
thenApplyAsync
thenApplyAsync(fn, executor)
```

## 12.1 Non-async variant

```java
future.thenApply(this::toDto)
```

May run in thread that completes previous stage, or caller thread if already completed.

## 12.2 Async without executor

```java
future.thenApplyAsync(this::toDto)
```

Runs using default async facility.

## 12.3 Async with executor

```java
future.thenApplyAsync(this::toDto, executor)
```

Runs using specified executor.

## 12.4 Why this matters

Heavy transformation in non-async continuation can run on unexpected thread.

Example:

```java
httpFuture.thenApply(this::parseHugeJson);
```

If completion happens on event-loop thread, this may block event loop.

## 12.5 Main rule

```text
Non-async continuations execute where completion happens.
Async continuations execute through an executor.
Choose intentionally.
```

---

# 13. `thenApply`: Transforming Result

Use `thenApply` for synchronous transformation.

```java
CompletableFuture<UserDto> dto =
    userFuture.thenApply(UserDto::from);
```

## 13.1 Not for async nested call

Bad:

```java
CompletableFuture<CompletableFuture<Order>> nested =
    userFuture.thenApply(user -> loadOrderAsync(user.id()));
```

This creates nested future.

Use `thenCompose`.

## 13.2 Transformation should be quick/pure

If heavy CPU:

```java
thenApplyAsync(this::heavyTransform, cpuExecutor)
```

## 13.3 Main rule

```text
thenApply maps T to U.
Use it for local transformation, not async chaining.
```

---

# 14. `thenAccept` and `thenRun`: Side-Effect Continuations

## 14.1 `thenAccept`

Consumes result, returns `CompletableFuture<Void>`.

```java
CompletableFuture<Void> done =
    userFuture.thenAccept(user -> log.info("Loaded {}", user.id()));
```

## 14.2 `thenRun`

Runs action ignoring result.

```java
CompletableFuture<Void> done =
    userFuture.thenRun(() -> metrics.incrementLoaded());
```

## 14.3 Side-effect caution

Side effects must have failure handling and execution context.

Bad:

```java
future.thenAccept(repository::save);
```

Could run on unexpected thread/transaction context.

## 14.4 Main rule

```text
thenAccept/thenRun are for actions after completion.
Treat side effects as real tasks with failure policy.
```

---

# 15. `thenCompose`: Flattening Dependent Async Work

Use when next operation returns a `CompletionStage`.

```java
CompletableFuture<Order> order =
    userFuture.thenCompose(user -> loadOrderAsync(user.id()));
```

Pipeline:

```text
User -> CompletableFuture<Order>
flatten to CompletableFuture<Order>
```

## 15.1 Avoid nested future

Bad:

```java
CompletableFuture<CompletableFuture<Order>> nested =
    userFuture.thenApply(user -> loadOrderAsync(user.id()));
```

Good:

```java
CompletableFuture<Order> flat =
    userFuture.thenCompose(user -> loadOrderAsync(user.id()));
```

## 15.2 Main rule

```text
thenCompose is async flatMap.
Use it when next step is itself asynchronous.
```

---

# 16. `thenCombine`: Combining Independent Results

Use when two independent futures can run concurrently and combine.

```java
CompletableFuture<User> user =
    loadUserAsync(userId);

CompletableFuture<List<Order>> orders =
    loadOrdersAsync(userId);

CompletableFuture<UserOrdersDto> dto =
    user.thenCombine(orders, UserOrdersDto::new);
```

## 16.1 Both run independently

They should be started before combine if truly independent.

## 16.2 Failure

If either fails, combined stage completes exceptionally.

## 16.3 Main rule

```text
thenCombine is for independent async results that both must succeed.
```

---

# 17. `allOf`: Wait for All

`allOf` waits for many futures.

```java
CompletableFuture<Void> all =
    CompletableFuture.allOf(userFuture, ordersFuture, prefsFuture);
```

Then:

```java
CompletableFuture<Dashboard> dashboard =
    all.thenApply(ignored -> new Dashboard(
        userFuture.join(),
        ordersFuture.join(),
        prefsFuture.join()
    ));
```

## 17.1 Type problem

`allOf` returns `CompletableFuture<Void>`, so you manually collect results.

Helper:

```java
static <T> CompletableFuture<List<T>> sequence(
    List<CompletableFuture<T>> futures
) {
    CompletableFuture<Void> all =
        CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new));

    return all.thenApply(ignored ->
        futures.stream()
            .map(CompletableFuture::join)
            .toList()
    );
}
```

## 17.2 Failure

If any future fails, `allOf` completes exceptionally.

But other tasks may still continue.

## 17.3 Main rule

```text
allOf waits for completion, but does not automatically define sibling cancellation policy.
```

---

# 18. `anyOf`: First Completed

```java
CompletableFuture<Object> first =
    CompletableFuture.anyOf(providerA, providerB, providerC);
```

## 18.1 Use cases

- first responder wins;
- hedged request;
- timeout race;
- fallback race.

## 18.2 Type issue

Returns `CompletableFuture<Object>`.

## 18.3 Load issue

Hedging duplicates work.

## 18.4 Cancellation issue

Loser tasks are not automatically cancelled in a domain-aware way.

## 18.5 Main rule

```text
anyOf is a race primitive.
Use it with resource and cancellation policy.
```

---

# 19. Fan-Out/Fan-In with CompletableFuture

Example:

```java
CompletableFuture<CaseSummary> cases =
    CompletableFuture.supplyAsync(() -> caseClient.summary(userId), ioExecutor);

CompletableFuture<SlaSummary> sla =
    CompletableFuture.supplyAsync(() -> slaClient.summary(userId), ioExecutor);

CompletableFuture<NotificationCount> notifications =
    CompletableFuture.supplyAsync(() -> notificationClient.count(userId), ioExecutor);

CompletableFuture<Dashboard> dashboard =
    cases.thenCombine(sla, DashboardPartial::new)
         .thenCombine(notifications, (partial, count) ->
             new Dashboard(partial.cases(), partial.sla(), count));
```

## 19.1 Problems to solve

- What if `cases` fails?
- Should `sla` be cancelled?
- What if request times out?
- Are downstream calls bounded?
- Is context propagated?
- Are exceptions logged?
- Is partial response allowed?

## 19.2 Main rule

```text
CompletableFuture can express fan-out/fan-in,
but failure/cancellation/resource policies remain your responsibility.
```

---

# 20. Exception Flow

CompletableFuture has two completion modes:

```text
normal completion with value
exceptional completion with Throwable
```

## 20.1 Normal chain

```java
loadUserAsync()
    .thenApply(UserDto::from)
```

## 20.2 If upstream fails

Normal `thenApply` is skipped.

Exception propagates until handled.

## 20.3 Wrapping

`join()` throws `CompletionException`.

`get()` throws `ExecutionException`.

## 20.4 Main rule

```text
CompletableFuture exceptions flow through the pipeline until a recovery/handler stage handles them.
```

---

# 21. `exceptionally`, `handle`, `whenComplete`

## 21.1 `exceptionally`

Recover from failure.

```java
CompletableFuture<User> user =
    loadUserAsync()
        .exceptionally(error -> anonymousUser());
```

Transforms failure to normal value.

## 21.2 `handle`

Handle success or failure and produce new value.

```java
CompletableFuture<Result> result =
    future.handle((value, error) -> {
        if (error != null) {
            return fallbackResult(error);
        }
        return successResult(value);
    });
```

## 21.3 `whenComplete`

Observe success/failure but keep original result/failure.

```java
future.whenComplete((value, error) -> {
    if (error != null) {
        log.error("Task failed", error);
    }
});
```

## 21.4 Choosing

| Need | Method |
|---|---|
| recover failure to value | `exceptionally` |
| convert success/failure to value | `handle` |
| observe/log without changing | `whenComplete` |

## 21.5 Main rule

```text
Use exceptionally/handle for recovery.
Use whenComplete for observation.
```

---

# 22. Timeouts: `orTimeout`, `completeOnTimeout`, and Delayed Executor

## 22.1 `orTimeout`

Completes exceptionally with timeout if not complete in time.

```java
CompletableFuture<User> user =
    loadUserAsync()
        .orTimeout(500, TimeUnit.MILLISECONDS);
```

## 22.2 `completeOnTimeout`

Completes normally with fallback value.

```java
CompletableFuture<User> user =
    loadUserAsync()
        .completeOnTimeout(anonymousUser(), 500, TimeUnit.MILLISECONDS);
```

## 22.3 Important limitation

Timeout completion of `CompletableFuture` does not necessarily stop underlying work.

If supplier is running in thread and blocking, it may continue unless cancelled/interrupted by your design.

## 22.4 Delayed executor

Java docs mention delayed executor support for delayed actions. Conceptually:

```java
Executor delayed =
    CompletableFuture.delayedExecutor(500, TimeUnit.MILLISECONDS);
```

## 22.5 Main rule

```text
CompletableFuture timeout controls future completion.
It is not automatically resource cancellation.
```

---

# 23. Cancellation Semantics and Limitations

`CompletableFuture` implements `Future`, so it has `cancel`.

```java
future.cancel(true);
```

But cancellation in CompletableFuture is subtle.

## 23.1 Cancelling the future

It completes the future exceptionally with cancellation.

Dependent stages may see cancellation.

## 23.2 Underlying task may continue

If task already running in executor, `CompletableFuture.cancel` does not necessarily interrupt it the way `FutureTask` submitted to executor might.

This is a common surprise.

## 23.3 Design cancellation explicitly

Use:

- cancellation token;
- interrupt-aware tasks;
- timeout-aware clients;
- closing resources;
- structured concurrency;
- executor `Future` handle if needed.

## 23.4 Main rule

```text
Do not assume CompletableFuture.cancel stops underlying work.
Design cancellation at the task/resource level.
```

---

# 24. Cancellation Propagation in Future Graphs

Example:

```java
CompletableFuture<Dashboard> dashboard =
    cases.thenCombine(sla, Dashboard::new);
```

If dashboard is cancelled:

```text
Do cases and sla cancel?
```

Not necessarily in a way that stops their underlying operations.

## 24.1 Manual propagation

You may need:

```java
dashboard.whenComplete((v, e) -> {
    if (dashboard.isCancelled()) {
        cases.cancel(true);
        sla.cancel(true);
    }
});
```

But again, cancelling `CompletableFuture` may not stop underlying I/O.

## 24.2 Structured concurrency advantage

Structured concurrency gives clearer parent-child cancellation model.

## 24.3 Main rule

```text
CompletableFuture graphs do not automatically give structured cancellation.
```

---

# 25. Blocking with `get`/`join`

## 25.1 `get`

Checked exceptions:

```java
try {
    return future.get();
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw e;
} catch (ExecutionException e) {
    throw unwrap(e);
}
```

## 25.2 `join`

Unchecked exception:

```java
return future.join();
```

Throws `CompletionException` on failure.

## 25.3 Where blocking is acceptable

- at top-level boundary;
- in virtual thread;
- after `allOf`;
- tests;
- command-line tool.

## 25.4 Where blocking is dangerous

- event loop;
- common pool worker;
- inside same bounded executor waiting on tasks submitted to same executor;
- reactive pipeline;
- lock-holding section.

## 25.5 Main rule

```text
Blocking on CompletableFuture is allowed only when the waiting thread is allowed to block.
```

---

# 26. Avoiding Nested Futures

Nested future type:

```java
CompletableFuture<CompletableFuture<Order>>
```

usually means wrong operator.

## 26.1 Bad

```java
CompletableFuture<CompletableFuture<Order>> nested =
    userFuture.thenApply(user -> loadOrderAsync(user.id()));
```

## 26.2 Good

```java
CompletableFuture<Order> flat =
    userFuture.thenCompose(user -> loadOrderAsync(user.id()));
```

## 26.3 Main rule

```text
If your mapping function returns a CompletableFuture,
use thenCompose.
```

---

# 27. Async Composition vs Parallelism

CompletableFuture enables async composition, not necessarily CPU parallel speedup.

## 27.1 Async I/O composition

```java
loadUserAsync()
    .thenCompose(user -> loadOrdersAsync(user.id()))
```

## 27.2 Parallel independent calls

```java
CompletableFuture<User> user = loadUserAsync();
CompletableFuture<Orders> orders = loadOrdersAsync();

user.thenCombine(orders, UserOrders::new);
```

## 27.3 CPU-bound task

For CPU-heavy work, use CPU executor sized around cores.

```java
CompletableFuture.supplyAsync(() -> heavyCompute(input), cpuExecutor);
```

## 27.4 Main rule

```text
CompletableFuture organizes async dependency graphs.
Actual parallelism depends on executor and workload.
```

---

# 28. Context Propagation

CompletableFuture stages may run on different threads.

Context may be lost:

- MDC;
- security context;
- tenant;
- transaction;
- locale;
- deadline.

## 28.1 Explicit context

```java
TaskContext context = TaskContext.current();

CompletableFuture.supplyAsync(
    () -> service.load(context, request),
    executor
);
```

## 28.2 Wrapper

```java
static <T> Supplier<T> withContext(TaskContext context, Supplier<T> supplier) {
    return () -> {
        try {
            ContextHolder.set(context);
            return supplier.get();
        } finally {
            ContextHolder.clear();
        }
    };
}
```

## 28.3 Main rule

```text
Async stage boundary is context boundary.
Never assume ThreadLocal context automatically follows CompletableFuture.
```

---

# 29. Transactions and Security Context

## 29.1 Transaction boundary

Bad:

```java
@Transactional
public CompletableFuture<Void> asyncSave(Entity entity) {
    return CompletableFuture.runAsync(() -> repository.save(entity));
}
```

The async task likely runs outside caller transaction.

## 29.2 Better

Async task owns transaction:

```java
CompletableFuture.runAsync(
    () -> transactionalService.save(command),
    executor
);
```

## 29.3 Security context

Bad:

```java
CompletableFuture.supplyAsync(() -> secureService.load());
```

If `secureService` reads ThreadLocal security context, it may be missing/wrong.

## 29.4 Better

```java
SecurityContext context = SecurityContext.capture();

CompletableFuture.supplyAsync(
    () -> secureService.load(context),
    executor
);
```

## 29.5 Main rule

```text
Do not assume transaction or security context crosses async boundaries.
```

---

# 30. Debugging CompletableFuture Pipelines

## 30.1 Name stages conceptually

Instead of giant chain, break:

```java
CompletableFuture<User> user = loadUserAsync(userId);
CompletableFuture<List<Order>> orders = user.thenCompose(u -> loadOrdersAsync(u.id()));
CompletableFuture<UserOrdersDto> dto = user.thenCombine(orders, UserOrdersDto::new);
```

## 30.2 Add observation

```java
future.whenComplete((value, error) -> {
    if (error != null) {
        log.error("loadUser failed userId={}", userId, error);
    }
});
```

## 30.3 Use custom executor names

Thread dumps with `ForkJoinPool.commonPool-worker` are less informative than:

```text
user-client-1
order-client-2
```

## 30.4 Use timeouts

Hanging stage is hard to debug.

## 30.5 Beware swallowed exception

If no terminal observation, error may be invisible.

## 30.6 Main rule

```text
CompletableFuture pipelines need explicit stage naming, logging, timeout, and executor naming to be operable.
```

---

# 31. Observability and Metrics

Track:

## 31.1 Per async operation

- submitted;
- started;
- completed;
- failed;
- timed out;
- cancelled;
- duration.

## 31.2 Per executor

- active;
- queue depth;
- rejection;
- completed tasks.

## 31.3 Per fan-out request

- child count;
- child durations;
- slowest child;
- failure child;
- cancellation count.

## 31.4 Context

- correlation ID;
- tenant ID;
- request ID;
- operation name.

## 31.5 Main rule

```text
Async composition without observability becomes invisible distributed control flow inside one JVM.
```

---

# 32. CompletableFuture with Virtual Threads

Virtual threads change some trade-offs.

## 32.1 Old reason for CompletableFuture

Avoid blocking platform threads.

## 32.2 With virtual threads

Blocking can be acceptable:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<User> user = executor.submit(() -> userClient.load(userId));
    Future<Orders> orders = executor.submit(() -> orderClient.load(userId));

    return new Dashboard(user.get(), orders.get());
}
```

This may be simpler than complex `CompletableFuture` chains.

## 32.3 Still useful

CompletableFuture still useful for:

- APIs that already return CF;
- async library integration;
- event/callback adaptation;
- composing futures without occupying caller;
- advanced graph pipelines.

## 32.4 Main rule

```text
Virtual threads reduce the need to use CompletableFuture merely to avoid blocking.
Use CompletableFuture when async composition itself is valuable.
```

---

# 33. CompletableFuture vs Structured Concurrency

## 33.1 CompletableFuture

Good for:

- arbitrary async graph;
- library APIs returning futures;
- pipeline composition;
- non-blocking callback adaptation.

Weakness:

- cancellation propagation manual;
- sibling task lifetime unclear;
- context propagation manual;
- exception graph can be hard.

## 33.2 Structured concurrency

Good for:

- request-scoped child tasks;
- fan-out/fan-in;
- parent-child lifetime;
- failure/cancellation policy;
- observability.

## 33.3 Main rule

```text
For subtasks that belong to one parent operation,
structured concurrency often expresses ownership better than CompletableFuture graphs.
```

---

# 34. CompletableFuture vs Reactive

## 34.1 CompletableFuture

Best for:

```text
one async value
small finite async composition
```

## 34.2 Reactive

Best for:

```text
asynchronous stream of many values
backpressure
operator-rich event pipelines
non-blocking end-to-end flows
```

## 34.3 Mono similarity

Reactor `Mono<T>` resembles async zero-or-one value, but has reactive semantics including subscription and context.

## 34.4 Main rule

```text
CompletableFuture is for async result composition.
Reactive is for async stream processing with backpressure.
```

---

# 35. Mini Case Study: Dashboard Fan-Out

## 35.1 Requirement

Dashboard needs:

- user profile;
- open case summary;
- SLA summary;
- notifications.

## 35.2 CompletableFuture design

```java
CompletableFuture<UserProfile> profile =
    CompletableFuture.supplyAsync(() -> profileClient.load(userId), ioExecutor);

CompletableFuture<CaseSummary> cases =
    CompletableFuture.supplyAsync(() -> caseClient.summary(userId), ioExecutor);

CompletableFuture<SlaSummary> sla =
    CompletableFuture.supplyAsync(() -> slaClient.summary(userId), ioExecutor);

CompletableFuture<NotificationCount> notifications =
    CompletableFuture.supplyAsync(() -> notificationClient.count(userId), ioExecutor);

CompletableFuture<Dashboard> dashboard =
    CompletableFuture.allOf(profile, cases, sla, notifications)
        .thenApply(ignored -> new Dashboard(
            profile.join(),
            cases.join(),
            sla.join(),
            notifications.join()
        ))
        .orTimeout(800, TimeUnit.MILLISECONDS);
```

## 35.3 Missing production pieces

- context propagation;
- custom executor metrics;
- downstream timeout;
- sibling cancellation;
- fallback policy;
- partial response policy.

## 35.4 Main lesson

```text
CompletableFuture makes fan-out easy to express,
but production semantics still need explicit design.
```

---

# 36. Mini Case Study: Async Cache Warmup

## 36.1 Requirement

After startup, warm cache in background.

## 36.2 Bad

```java
CompletableFuture.runAsync(() -> cache.warmup());
```

Problems:

- common pool;
- exception hidden;
- no lifecycle;
- no metrics;
- may block startup dependencies.

## 36.3 Better

```java
CompletableFuture<Void> warmup =
    CompletableFuture.runAsync(
        observed("cache-warmup", () -> cache.warmup()),
        backgroundExecutor
    ).orTimeout(30, TimeUnit.SECONDS);

warmup.whenComplete((ignored, error) -> {
    if (error != null) {
        log.error("Cache warmup failed", error);
        metrics.incrementWarmupFailure();
    } else {
        metrics.incrementWarmupSuccess();
    }
});
```

## 36.4 Main lesson

```text
Background CompletableFuture tasks need executor, timeout, and observation.
```

---

# 37. Mini Case Study: Hidden Exception from Ignored Future

## 37.1 Problem

```java
CompletableFuture.runAsync(() -> {
    throw new RuntimeException("audit failed");
}, auditExecutor);
```

No one observes returned future.

## 37.2 Symptom

Audit silently stops for some requests.

## 37.3 Fix

```java
CompletableFuture.runAsync(() -> audit(event), auditExecutor)
    .whenComplete((ignored, error) -> {
        if (error != null) {
            log.error("Audit failed eventId={}", event.id(), error);
        }
    });
```

Better if audit is critical:

```text
use durable outbox/queue instead of fire-and-forget future
```

## 37.4 Main lesson

```text
Async side effects without observation are silent failure factories.
```

---

# 38. Common Anti-Patterns

## 38.1 Using common pool for blocking I/O

```java
CompletableFuture.supplyAsync(() -> jdbcQuery());
```

## 38.2 Ignoring returned CompletableFuture

Fire-and-forget with hidden failures.

## 38.3 Nested futures

Using `thenApply` when `thenCompose` is needed.

## 38.4 Blocking inside common pool

`join` on tasks submitted to same saturated pool.

## 38.5 No timeout

Async task can hang forever.

## 38.6 Timeout without cancellation awareness

Future completes but underlying work continues.

## 38.7 Swallowing exceptions with fallback everywhere

Hides real incident.

## 38.8 Side effects in arbitrary continuation thread

Transaction/security/context bugs.

## 38.9 Huge CompletableFuture graph for simple blocking workflow

Virtual threads/structured concurrency might be clearer.

## 38.10 No executor metrics

Async bottleneck invisible.

---

# 39. Best Practices

## 39.1 Always decide executor

Do not accidentally use common pool for production blocking work.

## 39.2 Keep stages small and named

Improve debugging.

## 39.3 Use `thenCompose` for async chaining

Avoid nested futures.

## 39.4 Use `thenCombine` for independent results

Start both futures before combining.

## 39.5 Use `allOf` carefully

Inspect each result/failure and decide cancellation policy.

## 39.6 Add timeout

But also design underlying resource cancellation.

## 39.7 Observe failures

Use `whenComplete` for logs/metrics.

## 39.8 Pass context explicitly

Tenant, user, correlation, deadline.

## 39.9 Avoid blocking in wrong threads

Especially event loops/common pool.

## 39.10 Prefer structured concurrency for request-owned fan-out when available

Clearer lifetime and cancellation.

---

# 40. Decision Matrix

| Situation | Recommended |
|---|---|
| Simple sequential dependency | Direct call or virtual thread blocking |
| One async result from existing API | CompletableFuture |
| Chain async operation after async result | `thenCompose` |
| Transform result locally | `thenApply` |
| Combine two independent async results | `thenCombine` |
| Wait for many futures | `allOf` + result collection |
| First provider wins | `anyOf` / `applyToEither` with cancellation/resource guard |
| Blocking I/O in CF | Custom executor or virtual threads |
| CPU-heavy CF stage | CPU executor |
| Need parent-child cancellation | Structured concurrency |
| Need stream/backpressure | Reactive |
| Need durable side effect | Queue/outbox |
| Need request context | explicit context/Scoped Values later |
| Need timeout fallback | `completeOnTimeout` |
| Need timeout failure | `orTimeout` |
| Need stop underlying work | task-level cancellation, not only CF timeout |

---

# 41. Latihan

## Latihan 1 — Future vs CompletableFuture

Implementasikan satu task dengan `Future`, lalu refactor ke `CompletableFuture.thenApply`.

## Latihan 2 — thenApply vs thenCompose

Buat contoh nested `CompletableFuture<CompletableFuture<T>>`, lalu perbaiki dengan `thenCompose`.

## Latihan 3 — thenCombine

Load user dan orders secara independent lalu combine menjadi DTO.

## Latihan 4 — allOf Helper

Buat helper `sequence(List<CompletableFuture<T>>)`.

## Latihan 5 — Exception Handling

Buat pipeline yang gagal, lalu recover dengan `exceptionally`, observe dengan `whenComplete`, dan convert dengan `handle`.

## Latihan 6 — Timeout

Gunakan `orTimeout` dan `completeOnTimeout`, jelaskan perbedaannya.

## Latihan 7 — Cancellation

Buat task long-running dan uji apakah `CompletableFuture.cancel(true)` menghentikan underlying task. Catat hasilnya.

## Latihan 8 — Custom Executor

Bandingkan thread name saat memakai default common pool vs custom executor.

## Latihan 9 — Context Propagation

Buat `TaskContext` explicit untuk tenant/correlation ID dalam pipeline CF.

## Latihan 10 — Rewrite with Virtual Threads

Ambil fan-out CompletableFuture dashboard dan tulis ulang memakai virtual-thread executor + `Future.get`.

---

# 42. Ringkasan

`CompletableFuture` adalah tool kuat untuk async composition, tetapi perlu pemahaman execution dan failure semantics.

Core lessons:

- `Future` adalah handle, bukan hasil.
- `Future` lemah untuk composition.
- `CompletableFuture` adalah `Future` sekaligus `CompletionStage`.
- `runAsync` untuk task tanpa result.
- `supplyAsync` untuk task dengan result.
- Default async executor biasanya common pool; jangan gunakan tanpa sadar.
- Non-async continuation dapat berjalan di thread yang menyelesaikan stage.
- Async continuation memakai executor.
- `thenApply` maps value.
- `thenCompose` flattens async dependency.
- `thenCombine` combines independent results.
- `allOf` waits for all, tetapi tidak otomatis cancellation policy.
- `anyOf` races completion, tetapi bisa menggandakan resource usage.
- Exceptions propagate until handled.
- `exceptionally`, `handle`, dan `whenComplete` punya fungsi berbeda.
- `orTimeout` completes exceptionally on timeout.
- `completeOnTimeout` provides fallback value.
- Timeout/cancel on CompletableFuture does not always stop underlying task.
- Blocking `get/join` must happen only where blocking is acceptable.
- Context/transaction/security do not magically cross async boundaries.
- Virtual threads reduce need for CompletableFuture just to avoid blocking.
- Structured concurrency often better for request-owned fan-out.
- Reactive better for async streams with backpressure.

Main rule:

```text
Use CompletableFuture when you need asynchronous result composition.
But design executor, context, timeout, exception, cancellation,
and observability explicitly.
```

---

# 43. Referensi

1. Java SE 25 — `CompletableFuture`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html

2. Java SE 25 — `CompletionStage`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletionStage.html

3. Java SE 25 — `Future`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Future.html

4. Java SE 25 — `ExecutorService`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html

5. Java SE 25 — `Executor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executor.html

6. Java SE 25 — `ForkJoinPool`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinPool.html

7. Java SE 25 — `Executors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html

8. Java SE 25 — `CompletionException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletionException.html

9. Java SE 25 — `TimeoutException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/TimeoutException.html

10. OpenJDK JEP 444 — Virtual Threads  
    https://openjdk.org/jeps/444

11. OpenJDK JEP 505 — Structured Concurrency  
    https://openjdk.org/jeps/505

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-concurrency-and-reactive-part-005.md">⬅️ Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 005</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-concurrency-and-reactive-part-007.md">Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 007 ➡️</a>
</div>

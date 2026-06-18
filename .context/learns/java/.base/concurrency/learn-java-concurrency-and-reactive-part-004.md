# learn-java-concurrency-and-reactive-part-004.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 004  
# Executor Framework Deep Dive: Executor, ExecutorService, Future, Submit vs Execute, Shutdown, Lifecycle, Rejection, Scheduling, ThreadFactory, and Production Ownership

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **004**  
> Fokus: memahami Executor Framework sebagai fondasi pengelolaan task di Java. Kita akan membahas `Executor`, `ExecutorService`, `ScheduledExecutorService`, `Future`, `Runnable`, `Callable`, `execute`, `submit`, `invokeAll`, `invokeAny`, shutdown, cancellation, rejection, queueing, thread factory, executor ownership, lifecycle, resource management, metrics, dan production design. Bagian ini belum deep dive thread pool sizing/backpressure secara matematis; itu masuk part 005.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Executor Framework Ada](#2-kenapa-executor-framework-ada)
3. [Mental Model: Submission, Queue, Worker, Completion](#3-mental-model-submission-queue-worker-completion)
4. [`Executor`: Interface Paling Minimal](#4-executor-interface-paling-minimal)
5. [`ExecutorService`: Lifecycle and Result Management](#5-executorservice-lifecycle-and-result-management)
6. [`Runnable` vs `Callable` dalam Executor](#6-runnable-vs-callable-dalam-executor)
7. [`execute` vs `submit`](#7-execute-vs-submit)
8. [`Future`: Result Handle](#8-future-result-handle)
9. [`Future.get`: Blocking, Failure, and Cancellation](#9-futureget-blocking-failure-and-cancellation)
10. [Exception Semantics: `execute` vs `submit`](#10-exception-semantics-execute-vs-submit)
11. [`invokeAll`](#11-invokeall)
12. [`invokeAny`](#12-invokeany)
13. [Executor Shutdown](#13-executor-shutdown)
14. [Graceful Shutdown Pattern](#14-graceful-shutdown-pattern)
15. [Cancellation with Future](#15-cancellation-with-future)
16. [Executor Ownership](#16-executor-ownership)
17. [Executor Lifetime](#17-executor-lifetime)
18. [ThreadFactory](#18-threadfactory)
19. [UncaughtExceptionHandler and Executor Tasks](#19-uncaughtexceptionhandler-and-executor-tasks)
20. [The `Executors` Factory Methods](#20-the-executors-factory-methods)
21. [`newFixedThreadPool`](#21-newfixedthreadpool)
22. [`newCachedThreadPool`](#22-newcachedthreadpool)
23. [`newSingleThreadExecutor`](#23-newsinglethreadexecutor)
24. [`newScheduledThreadPool`](#24-newscheduledthreadpool)
25. [`newVirtualThreadPerTaskExecutor`](#25-newvirtualthreadpertaskexecutor)
26. [ScheduledExecutorService Deep Dive](#26-scheduledexecutorservice-deep-dive)
27. [Fixed Rate vs Fixed Delay](#27-fixed-rate-vs-fixed-delay)
28. [Executor Rejection](#28-executor-rejection)
29. [ThreadPoolExecutor Overview](#29-threadpoolexecutor-overview)
30. [Queueing in Executors](#30-queueing-in-executors)
31. [Executor Metrics](#31-executor-metrics)
32. [Executor and Context Propagation](#32-executor-and-context-propagation)
33. [Executor and Transaction Boundary](#33-executor-and-transaction-boundary)
34. [Executor and Security Context](#34-executor-and-security-context)
35. [Executor and Virtual Threads](#35-executor-and-virtual-threads)
36. [Common Production Failure Modes](#36-common-production-failure-modes)
37. [Anti-Patterns](#37-anti-patterns)
38. [Best Practices](#38-best-practices)
39. [Decision Matrix](#39-decision-matrix)
40. [Latihan](#40-latihan)
41. [Ringkasan](#41-ringkasan)
42. [Referensi](#42-referensi)

---

# 1. Tujuan Bagian Ini

Di part sebelumnya kita sudah membahas bahwa task harus punya:

- ownership;
- lifecycle;
- result;
- failure;
- cancellation;
- timeout;
- retry;
- idempotency;
- resource model;
- observability.

Sekarang kita masuk ke mekanisme Java untuk menjalankan task secara terkelola:

```java
Executor
ExecutorService
ScheduledExecutorService
Future
```

Executor Framework memisahkan:

```text
apa yang dikerjakan
```

dari:

```text
bagaimana, kapan, dan di thread mana pekerjaan dijalankan
```

Tanpa Executor, kita mungkin membuat thread manual:

```java
new Thread(task).start();
```

Masalahnya:

- tidak ada pooling;
- tidak ada queue policy;
- tidak ada lifecycle management;
- tidak ada shutdown terpusat;
- tidak ada result handle;
- tidak ada scheduled execution;
- tidak ada rejection handling;
- sulit observability;
- mudah leak.

Dengan Executor:

```java
ExecutorService executor = Executors.newFixedThreadPool(10);
Future<Result> future = executor.submit(() -> doWork());
```

Kita mulai punya abstraction untuk submission, execution, result, dan lifecycle.

Target bagian ini:

```text
Mampu mendesain executor sebagai owned production resource,
bukan sekadar “tempat melempar Runnable”.
```

---

# 2. Kenapa Executor Framework Ada

Manual thread creation:

```java
for (Task task : tasks) {
    new Thread(() -> process(task)).start();
}
```

Ini terlihat mudah, tetapi production-unfriendly.

## 2.1 Masalah manual thread

### Tidak ada batas

Berapa thread maksimal?

```text
unknown
```

### Tidak ada queue policy

Jika task lebih banyak dari kapasitas?

```text
unknown
```

### Tidak ada rejection policy

Jika sistem overload?

```text
unknown
```

### Tidak ada lifecycle

Kapan berhenti?

```text
unknown
```

### Tidak ada central metrics

Berapa aktif?

```text
unknown
```

### Tidak ada result model

Bagaimana mengambil hasil/error?

```text
manual
```

## 2.2 Executor solves separation of concerns

Task:

```java
Runnable task = () -> sendEmail(email);
```

Execution policy:

```java
Executor executor = ...
executor.execute(task);
```

Executor can decide:

- run in current thread;
- run in new thread;
- run in thread pool;
- run later;
- queue;
- reject;
- schedule periodically;
- use virtual thread per task.

## 2.3 Main rule

```text
Executor Framework exists to separate task definition from execution policy.
```

---

# 3. Mental Model: Submission, Queue, Worker, Completion

Most executor systems can be understood as:

```text
caller submits task
  -> executor accepts/rejects
      -> task may be queued
          -> worker picks task
              -> task runs
                  -> result/failure captured
                      -> caller observes via Future/log/metrics
```

## 3.1 Submission

```java
executor.submit(task);
```

## 3.2 Admission

Executor may accept or reject.

## 3.3 Queue

Task may wait before running.

## 3.4 Worker

Thread executes task.

## 3.5 Completion

Task succeeds, fails, or is cancelled.

## 3.6 Observation

Future, logs, metrics, callbacks.

## 3.7 Main rule

```text
Executor design is a pipeline:
submit -> accept -> queue -> execute -> complete -> observe.
```

---

# 4. `Executor`: Interface Paling Minimal

`Executor` is minimal:

```java
public interface Executor {
    void execute(Runnable command);
}
```

It only says:

```text
execute this Runnable sometime according to implementation policy
```

## 4.1 Example

```java
Executor directExecutor = Runnable::run;

directExecutor.execute(() -> {
    System.out.println("Runs on caller thread");
});
```

This executor runs task synchronously.

## 4.2 Another executor

```java
Executor newThreadExecutor = command -> Thread.ofPlatform().start(command);
```

Each task gets new platform thread.

## 4.3 Why interface is powerful

Caller does not know execution policy.

Same task can run:

- direct;
- pooled;
- scheduled;
- virtual-thread-per-task;
- test executor.

## 4.4 Limitation

`Executor` has no:

- shutdown;
- result;
- cancellation;
- submit;
- lifecycle;
- status.

## 4.5 Main rule

```text
Executor is only fire-and-dispatch.
Use ExecutorService when you need lifecycle and result management.
```

---

# 5. `ExecutorService`: Lifecycle and Result Management

`ExecutorService` extends `Executor`.

It adds:

- `submit`;
- `invokeAll`;
- `invokeAny`;
- `shutdown`;
- `shutdownNow`;
- `isShutdown`;
- `isTerminated`;
- `awaitTermination`.

## 5.1 Example

```java
ExecutorService executor = Executors.newFixedThreadPool(4);

Future<String> future = executor.submit(() -> {
    return "result";
});

String result = future.get();

executor.shutdown();
```

## 5.2 Why ExecutorService matters

It models executor as resource with lifecycle.

## 5.3 ExecutorService should be closed/shutdown

Since modern Java, many executor services are `AutoCloseable` through `ExecutorService` being closeable in current APIs, allowing try-with-resources usage for certain patterns.

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<String> future = executor.submit(() -> callService());
    return future.get();
}
```

## 5.4 Main rule

```text
ExecutorService is not just a utility.
It is a lifecycle-bearing resource.
```

---

# 6. `Runnable` vs `Callable` dalam Executor

## 6.1 Runnable

No result.

```java
executor.execute(() -> sendEmail(email));
```

With submit:

```java
Future<?> future = executor.submit(() -> sendEmail(email));
```

The future completes with `null` if successful.

## 6.2 Callable

Returns result and can throw checked exception.

```java
Future<Report> future = executor.submit(() -> generateReport(input));
```

## 6.3 Runnable with explicit result

```java
Future<Status> future = executor.submit(
    () -> sendEmail(email),
    Status.SENT
);
```

## 6.4 Choosing

| Need | Use |
|---|---|
| no result, fire dispatch | `Runnable` |
| result needed | `Callable<T>` |
| checked exception | `Callable<T>` |
| lifecycle result handle | `submit` |
| no result handle | `execute` |

## 6.5 Main rule

```text
Use Callable when outcome matters as data.
Use Runnable when outcome is only side effect, but still observe failure.
```

---

# 7. `execute` vs `submit`

This is one of the most important differences.

## 7.1 `execute`

```java
executor.execute(() -> {
    throw new RuntimeException("boom");
});
```

- accepts `Runnable`;
- returns void;
- exception handling depends on worker/uncaught handler/executor;
- no `Future`.

## 7.2 `submit`

```java
Future<?> future = executor.submit(() -> {
    throw new RuntimeException("boom");
});
```

- accepts `Runnable` or `Callable`;
- returns `Future`;
- exceptions are captured in `Future`;
- caller must call `get()` to observe.

## 7.3 Practical consequence

With `submit`, task can fail and no log appears if nobody calls `future.get()`.

## 7.4 Example

```java
Future<?> future = executor.submit(() -> {
    throw new IllegalStateException("failed");
});

// Exception observed here:
future.get();
```

`get()` throws `ExecutionException`.

## 7.5 Main rule

```text
execute is dispatch without result.
submit is dispatch with a Future.
If you submit and ignore the Future, you may hide failures.
```

---

# 8. `Future`: Result Handle

`Future<T>` represents result of asynchronous computation.

Important methods:

```java
boolean cancel(boolean mayInterruptIfRunning);
boolean isCancelled();
boolean isDone();
T get();
T get(long timeout, TimeUnit unit);
```

## 8.1 Future is not value

Future is a handle.

```java
Future<User> future = executor.submit(() -> loadUser(id));
```

The user may not be ready yet.

## 8.2 `isDone`

```java
if (future.isDone()) {
    ...
}
```

But do not busy-wait.

## 8.3 `get`

Blocks until done.

## 8.4 Limitations

Future has limited composition.

Cannot easily say:

```text
when A and B complete, combine
```

That is why `CompletableFuture` exists.

## 8.5 Main rule

```text
Future gives you ownership of result observation.
Ignoring Future means ignoring completion semantics.
```

---

# 9. `Future.get`: Blocking, Failure, and Cancellation

## 9.1 Success

```java
Result result = future.get();
```

## 9.2 Failure

If task throws:

```java
try {
    future.get();
} catch (ExecutionException e) {
    Throwable cause = e.getCause();
}
```

## 9.3 Interrupted while waiting

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new RuntimeException("Interrupted while waiting", e);
}
```

## 9.4 Timeout

```java
try {
    return future.get(500, TimeUnit.MILLISECONDS);
} catch (TimeoutException e) {
    future.cancel(true);
    throw e;
}
```

## 9.5 Cancellation

If future cancelled:

```java
catch (CancellationException e) {
    ...
}
```

## 9.6 Main rule

```text
Future.get is a blocking boundary.
Always handle interruption, execution failure, timeout, and cancellation intentionally.
```

---

# 10. Exception Semantics: `execute` vs `submit`

## 10.1 With execute

```java
executor.execute(() -> {
    throw new RuntimeException("boom");
});
```

The exception escapes task execution.

Depending on executor/thread, it may reach uncaught exception handler and be logged.

## 10.2 With submit

```java
Future<?> future = executor.submit(() -> {
    throw new RuntimeException("boom");
});
```

The exception is captured inside `Future`.

If nobody calls `get`, it can be silent.

## 10.3 Demonstration

```java
ExecutorService executor = Executors.newSingleThreadExecutor();

executor.submit(() -> {
    throw new RuntimeException("hidden unless get is called");
});

executor.shutdown();
```

This may not visibly fail.

## 10.4 Safer wrapper for fire-and-observe

```java
static Runnable observed(String taskName, Runnable task) {
    return () -> {
        try {
            task.run();
        } catch (Throwable t) {
            log.error("Task {} failed", taskName, t);
            throw t;
        }
    };
}
```

## 10.5 Main rule

```text
If you use submit, observe the Future or wrap/report exceptions.
```

---

# 11. `invokeAll`

`invokeAll` submits collection of callables and waits for all to complete.

```java
List<Callable<Result>> tasks = List.of(
    () -> callA(),
    () -> callB(),
    () -> callC()
);

List<Future<Result>> futures = executor.invokeAll(tasks);
```

## 11.1 Result order

Returned futures correspond to input task order.

## 11.2 Failure

Each future may contain success or failure.

```java
for (Future<Result> future : futures) {
    try {
        Result result = future.get();
    } catch (ExecutionException e) {
        ...
    }
}
```

## 11.3 Timed invokeAll

```java
List<Future<Result>> futures =
    executor.invokeAll(tasks, 1, TimeUnit.SECONDS);
```

Unfinished tasks are cancelled.

## 11.4 Use case

- run several independent tasks;
- wait for all;
- gather results.

## 11.5 Limitation

Failure handling is less structured than `StructuredTaskScope`.

## 11.6 Main rule

```text
invokeAll is simple fan-out/fan-in,
but you must still inspect each Future.
```

---

# 12. `invokeAny`

`invokeAny` returns result of one successfully completed task.

```java
String result = executor.invokeAny(List.of(
    () -> callPrimary(),
    () -> callReplica()
));
```

## 12.1 Use cases

- race redundant providers;
- first successful answer wins;
- hedge request.

## 12.2 Failure

If all fail, throws `ExecutionException`.

## 12.3 Cancellation

Tasks not needed may be cancelled depending execution semantics.

## 12.4 Danger

Hedging increases load.

If used carelessly:

```text
one user request becomes multiple backend requests
```

## 12.5 Main rule

```text
invokeAny is powerful for hedging, but it multiplies resource usage.
Use with strict limits.
```

---

# 13. Executor Shutdown

Executor must be shut down when no longer needed.

## 13.1 `shutdown`

```java
executor.shutdown();
```

- stops accepting new tasks;
- existing queued/running tasks continue.

## 13.2 `shutdownNow`

```java
List<Runnable> notStarted = executor.shutdownNow();
```

- attempts to stop running tasks via interrupt;
- returns tasks that never started;
- not guaranteed to stop immediately.

## 13.3 `awaitTermination`

```java
executor.awaitTermination(30, TimeUnit.SECONDS);
```

Wait for termination.

## 13.4 States

```text
running
shutdown
terminating
terminated
```

## 13.5 Main rule

```text
Executor shutdown is cooperative.
Tasks must respond to interruption for fast shutdown.
```

---

# 14. Graceful Shutdown Pattern

Canonical pattern:

```java
static void shutdownGracefully(
    ExecutorService executor,
    Duration timeout
) {
    executor.shutdown();

    try {
        if (!executor.awaitTermination(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
            List<Runnable> dropped = executor.shutdownNow();

            if (!executor.awaitTermination(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                log.error("Executor did not terminate. droppedTasks={}", dropped.size());
            }
        }
    } catch (InterruptedException e) {
        executor.shutdownNow();
        Thread.currentThread().interrupt();
    }
}
```

## 14.1 Why two phases

Phase 1:

```text
let tasks finish
```

Phase 2:

```text
interrupt running tasks
```

## 14.2 Caveat

If tasks ignore interrupt, shutdown may still hang.

## 14.3 Main rule

```text
Graceful shutdown requires executor protocol and task interrupt cooperation.
```

---

# 15. Cancellation with Future

## 15.1 Cancel before start

If task still queued:

```java
future.cancel(false)
```

may prevent execution.

## 15.2 Cancel running task

```java
future.cancel(true)
```

requests interruption.

## 15.3 Does it stop immediately?

No.

The task must cooperate.

## 15.4 Example

```java
Future<?> future = executor.submit(() -> {
    while (!Thread.currentThread().isInterrupted()) {
        doWorkChunk();
    }
});

future.cancel(true);
```

## 15.5 Blocking method

If task is blocked in interruptible method, interrupt may wake it.

## 15.6 Main rule

```text
Future.cancel(true) means “please interrupt if running”,
not “kill the task now”.
```

---

# 16. Executor Ownership

An executor must have owner.

## 16.1 Application-owned executor

Created at startup, closed at shutdown.

Example:

```text
notification worker pool
```

## 16.2 Request-owned executor

Created for scoped work and closed after request.

Usually virtual-thread executor or structured scope.

## 16.3 Library-owned executor

Dangerous if hidden.

Libraries should document lifecycle.

## 16.4 Shared executor

Possible, but risk:

- unrelated workloads interfere;
- hard sizing;
- hard metrics;
- priority inversion.

## 16.5 Main rule

```text
Every executor needs a lifecycle owner and workload identity.
```

---

# 17. Executor Lifetime

## 17.1 Short-lived executor

Use for scoped tasks.

Example:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    ...
}
```

## 17.2 Long-lived executor

Use for service workload.

Example:

```java
class NotificationService implements AutoCloseable {
    private final ExecutorService executor;

    NotificationService() {
        this.executor = Executors.newFixedThreadPool(8, namedFactory());
    }

    @Override
    public void close() {
        shutdownGracefully(executor, Duration.ofSeconds(30));
    }
}
```

## 17.3 Do not create per request platform pools

Bad:

```java
void handleRequest() {
    ExecutorService executor = Executors.newFixedThreadPool(10);
    ...
}
```

This creates threads repeatedly and may leak.

## 17.4 Main rule

```text
Platform thread pools are usually long-lived owned resources.
Virtual-thread-per-task executors can be scoped more naturally.
```

---

# 18. ThreadFactory

ThreadFactory controls thread creation.

```java
ThreadFactory factory = Thread.ofPlatform()
    .name("case-worker-", 1)
    .daemon(false)
    .uncaughtExceptionHandler((t, e) ->
        log.error("Thread {} failed", t.getName(), e)
    )
    .factory();
```

Use:

```java
ExecutorService executor = Executors.newFixedThreadPool(8, factory);
```

## 18.1 Why important

- names;
- daemon;
- priority;
- exception handling;
- virtual vs platform;
- diagnostics.

## 18.2 Main rule

```text
Never use anonymous default thread names for important production executors.
```

---

# 19. UncaughtExceptionHandler and Executor Tasks

Important nuance:

With `execute`, RuntimeException can reach uncaught handler.

With `submit`, exception is captured in Future.

## 19.1 Example

```java
executor.submit(() -> {
    throw new RuntimeException("captured");
});
```

Uncaught handler may not run because executor catches exception and stores it in Future.

## 19.2 Therefore

For submitted tasks:

- call `get`;
- use wrapper logging;
- use afterExecute hook in custom ThreadPoolExecutor;
- use higher-level task result reporting.

## 19.3 Main rule

```text
Thread uncaught exception handler is not enough for ExecutorService.submit failures.
```

---

# 20. The `Executors` Factory Methods

`Executors` provides convenient factories.

Common:

- `newFixedThreadPool`;
- `newCachedThreadPool`;
- `newSingleThreadExecutor`;
- `newScheduledThreadPool`;
- `newVirtualThreadPerTaskExecutor`;
- `newThreadPerTaskExecutor`.

## 20.1 Convenience vs control

Factory methods are easy.

But for production, you often need explicit `ThreadPoolExecutor` to control:

- queue type;
- queue size;
- rejection policy;
- thread factory;
- metrics.

## 20.2 Main rule

```text
Executors factory methods are good for learning and some simple cases.
Production pools often need explicit configuration.
```

---

# 21. `newFixedThreadPool`

```java
ExecutorService executor = Executors.newFixedThreadPool(8);
```

## 21.1 Behavior

- fixed number of worker threads;
- tasks queue when workers busy.

## 21.2 Danger

The default queue is unbounded for this factory.

That can cause memory growth under overload.

## 21.3 Better production pattern

Use explicit `ThreadPoolExecutor` with bounded queue.

```java
ExecutorService executor = new ThreadPoolExecutor(
    8,
    8,
    0L,
    TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue<>(1000),
    namedFactory,
    new ThreadPoolExecutor.AbortPolicy()
);
```

## 21.4 Main rule

```text
Fixed thread pool bounds threads, not queued tasks.
```

---

# 22. `newCachedThreadPool`

```java
ExecutorService executor = Executors.newCachedThreadPool();
```

## 22.1 Behavior

- creates new threads as needed;
- reuses idle threads;
- idle threads eventually removed;
- can grow very large.

## 22.2 Danger

Under high load, it may create too many platform threads.

## 22.3 Use case

Short-lived asynchronous tasks in controlled environments, but be careful.

## 22.4 Main rule

```text
Cached thread pool can be an unbounded platform-thread factory under load.
Use with caution.
```

---

# 23. `newSingleThreadExecutor`

```java
ExecutorService executor = Executors.newSingleThreadExecutor();
```

## 23.1 Behavior

One worker thread processes tasks sequentially.

## 23.2 Use cases

- serialize access to non-thread-safe resource;
- maintain task ordering;
- lightweight actor-like component.

## 23.3 Danger

- unbounded queue;
- one stuck task blocks all following tasks;
- failures/restarts need understanding;
- can hide backlog.

## 23.4 Main rule

```text
Single-thread executor gives ordering but creates a single bottleneck.
Monitor queue delay.
```

---

# 24. `newScheduledThreadPool`

```java
ScheduledExecutorService scheduler =
    Executors.newScheduledThreadPool(2);
```

## 24.1 Supports

- delayed task;
- periodic task fixed-rate;
- periodic task fixed-delay.

## 24.2 Use cases

- heartbeat;
- cleanup;
- periodic refresh;
- timeout sweeper;
- retry scheduler.

## 24.3 Danger

- long task delays later executions;
- exception can suppress future periodic executions;
- overlapping behavior must be understood;
- shutdown policy.

## 24.4 Main rule

```text
Scheduled tasks are production jobs.
They need exception handling, timeout, metrics, and shutdown.
```

---

# 25. `newVirtualThreadPerTaskExecutor`

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<String> future = executor.submit(() -> callRemote());
    return future.get();
}
```

## 25.1 Behavior

Creates a new virtual thread for each submitted task.

## 25.2 Good for

- many blocking I/O tasks;
- request-scoped fan-out;
- simplifying async code;
- short-lived tasks.

## 25.3 Not a resource limiter

It does not limit number of tasks like fixed pool.

If you submit 1M tasks, it may create many virtual threads.

External resources still need guard.

## 25.4 Pair with semaphores/bulkheads

```java
Semaphore apiLimit = new Semaphore(100);
```

## 25.5 Main rule

```text
Virtual-thread-per-task executor limits thread cost,
not task count or downstream resource usage.
```

---

# 26. ScheduledExecutorService Deep Dive

`ScheduledExecutorService` schedules commands after delay or periodically.

## 26.1 One-shot delay

```java
scheduler.schedule(
    () -> cleanupExpiredSessions(),
    10,
    TimeUnit.SECONDS
);
```

## 26.2 Callable with delay

```java
ScheduledFuture<Result> future = scheduler.schedule(
    () -> refreshCache(),
    1,
    TimeUnit.MINUTES
);
```

## 26.3 Periodic fixed rate

```java
scheduler.scheduleAtFixedRate(
    this::pushMetrics,
    0,
    10,
    TimeUnit.SECONDS
);
```

## 26.4 Periodic fixed delay

```java
scheduler.scheduleWithFixedDelay(
    this::pollProvider,
    0,
    10,
    TimeUnit.SECONDS
);
```

## 26.5 Main rule

```text
Scheduling is not just timing.
It is lifecycle, error handling, and overlap policy.
```

---

# 27. Fixed Rate vs Fixed Delay

## 27.1 Fixed rate

```text
attempt to run every N time units based on schedule
```

Example:

```java
scheduleAtFixedRate(task, 0, 10, SECONDS)
```

Intended starts:

```text
t=0, t=10, t=20, t=30
```

If one run takes too long, next execution may be delayed but tries to maintain cadence.

## 27.2 Fixed delay

```text
wait N time units after previous run completes
```

Example:

```java
scheduleWithFixedDelay(task, 0, 10, SECONDS)
```

If task runs 4 seconds:

```text
start t=0
finish t=4
next start t=14
```

## 27.3 Which to choose

Fixed rate:

- metrics push;
- clock-based cadence;
- heartbeat-like tasks.

Fixed delay:

- polling;
- cleanup;
- avoid overlap/pressure;
- task duration variable.

## 27.4 Exception behavior

If periodic task throws exception, subsequent executions may be suppressed.

Wrap:

```java
Runnable safeTask = () -> {
    try {
        doScheduledWork();
    } catch (Throwable t) {
        log.error("Scheduled task failed", t);
    }
};
```

## 27.5 Main rule

```text
Fixed rate optimizes cadence.
Fixed delay optimizes breathing room after completion.
```

---

# 28. Executor Rejection

Rejection occurs when executor cannot accept task.

In `ThreadPoolExecutor`, rejection can happen when:

- executor is shutdown;
- queue is full and no more threads can be created.

## 28.1 RejectedExecutionException

```java
try {
    executor.execute(task);
} catch (RejectedExecutionException e) {
    // handle overload/shutdown
}
```

## 28.2 Rejection policies

Common `ThreadPoolExecutor` handlers:

- `AbortPolicy`;
- `CallerRunsPolicy`;
- `DiscardPolicy`;
- `DiscardOldestPolicy`.

## 28.3 AbortPolicy

Throws exception.

Good for fail-fast.

## 28.4 CallerRunsPolicy

Caller runs task.

Can provide backpressure, but dangerous if caller is event loop/request thread and task slow.

## 28.5 Discard policies

Can silently drop work.

Only use for truly discardable tasks with metrics.

## 28.6 Main rule

```text
Rejection is not an error to hide.
It is overload signal and must be part of design.
```

---

# 29. ThreadPoolExecutor Overview

For production control:

```java
ExecutorService executor = new ThreadPoolExecutor(
    corePoolSize,
    maximumPoolSize,
    keepAliveTime,
    timeUnit,
    workQueue,
    threadFactory,
    rejectionHandler
);
```

## 29.1 corePoolSize

Baseline worker count.

## 29.2 maximumPoolSize

Maximum worker count.

## 29.3 keepAliveTime

Idle thread lifetime above core size.

## 29.4 workQueue

Where tasks wait.

## 29.5 threadFactory

Names/configures threads.

## 29.6 rejectionHandler

What happens when saturated.

## 29.7 Main rule

```text
ThreadPoolExecutor is where execution policy becomes explicit.
```

---

# 30. Queueing in Executors

Queue selection matters.

## 30.1 Unbounded queue

Pros:

- simple;
- avoids rejection during bursts.

Cons:

- memory risk;
- latency risk;
- hides overload.

## 30.2 Bounded queue

Pros:

- overload visible;
- memory controlled;
- backpressure possible.

Cons:

- need rejection policy;
- callers must handle failure.

## 30.3 SynchronousQueue

No capacity; handoff directly to worker.

Used by cached-style pools.

## 30.4 Priority queue

Can prioritize tasks but risks starvation.

## 30.5 Main rule

```text
Queue choice is latency and overload policy.
```

---

# 31. Executor Metrics

Production executor should expose:

## 31.1 Pool metrics

- active thread count;
- pool size;
- largest pool size;
- completed task count.

## 31.2 Queue metrics

- queue size;
- remaining capacity;
- oldest task age if possible;
- rejection count.

## 31.3 Task metrics

- submitted;
- started;
- completed;
- failed;
- cancelled;
- duration;
- queue wait time.

## 31.4 Shutdown metrics

- termination time;
- dropped tasks.

## 31.5 Main rule

```text
An executor without metrics is an invisible queue.
```

---

# 32. Executor and Context Propagation

Executor changes thread.

ThreadLocal context may not follow.

Bad:

```java
CurrentTenant.set(tenantId);

executor.submit(() -> service.process(CurrentTenant.get()));
```

The worker thread may not have tenant.

## 32.1 Explicit context

```java
TaskContext context = new TaskContext(tenantId, userId, correlationId);

executor.submit(() -> service.process(context, command));
```

## 32.2 Wrapping task

```java
Runnable wrapWithContext(TaskContext context, Runnable task) {
    return () -> {
        try {
            ContextHolder.set(context);
            task.run();
        } finally {
            ContextHolder.clear();
        }
    };
}
```

## 32.3 Future topics

- ThreadLocal deep dive in part 012.
- Scoped Values in part 017.
- Reactive context later.

## 32.4 Main rule

```text
Executor boundaries are context boundaries.
Pass context intentionally.
```

---

# 33. Executor and Transaction Boundary

Transactions are usually thread-bound in many frameworks.

Bad:

```java
@Transactional
void handle() {
    executor.submit(() -> repository.save(entity));
}
```

The async task runs on different thread, outside original transaction.

## 33.1 Problems

- transaction not active;
- entity detached;
- lazy loading fails;
- exceptions not rollback parent;
- task may run after request completes.

## 33.2 Better

Make async task own its transaction:

```java
executor.submit(() -> transactionalService.saveAsync(command));
```

Where `saveAsync` starts its own transaction.

## 33.3 Or avoid async inside transaction

Keep transaction boundary clear.

## 33.4 Main rule

```text
Do not assume transaction context crosses executor boundaries.
```

---

# 34. Executor and Security Context

Security context may be thread-local.

Bad:

```java
executor.submit(() -> sensitiveOperation());
```

Worker may have:

- no user;
- wrong user;
- stale user if context leaked.

## 34.1 Better

Pass explicit principal/context:

```java
SecurityContext context = SecurityContext.fromCurrent();

executor.submit(() -> sensitiveOperation(context));
```

## 34.2 Validate in task

Background task should re-check authorization if needed, or use system actor explicitly.

## 34.3 Main rule

```text
Async task security context must be explicit, not assumed.
```

---

# 35. Executor and Virtual Threads

Virtual-thread-per-task executor changes old pool thinking.

## 35.1 No pool sizing for threads

Do not create fixed pool of virtual threads to “save” them.

## 35.2 Still need workload control

Use:

- semaphore;
- rate limiter;
- DB pool;
- HTTP connection pool;
- bounded queue before submission;
- structured concurrency scope.

## 35.3 Short-lived scoped executor

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<Result>> futures = tasks.stream()
        .map(task -> executor.submit(task))
        .toList();

    for (Future<Result> future : futures) {
        consume(future.get());
    }
}
```

## 35.4 Danger

Submitting too many tasks at once can create too many virtual threads and pressure memory/downstream.

## 35.5 Main rule

```text
With virtual threads, bound resources and task admission,
not thread count.
```

---

# 36. Common Production Failure Modes

## 36.1 Executor never shutdown

Thread leak, app cannot exit.

## 36.2 Per-request platform executor

Creates too many threads.

## 36.3 Unbounded fixed pool queue

Memory grows under overload.

## 36.4 Ignored Future

Task exception hidden.

## 36.5 Bad rejection handling

Overload becomes 500 storm or silent data loss.

## 36.6 Blocking task in CPU pool

CPU work starved by I/O waits.

## 36.7 CPU task in virtual-thread flood

Too many runnable tasks, no speedup.

## 36.8 Scheduled task exception stops future runs

Periodic work silently stops.

## 36.9 Async inside transaction

Detached entity/lazy failure/rollback mismatch.

## 36.10 Context leak/loss

Wrong tenant/user/log correlation.

---

# 37. Anti-Patterns

## 37.1 `Executors.newFixedThreadPool` blindly in production

Unbounded queue risk.

## 37.2 `Executors.newCachedThreadPool` under untrusted load

Unbounded platform threads.

## 37.3 Submit and forget

```java
executor.submit(task);
```

No future observation.

## 37.4 Create executor in method without close

Leak.

## 37.5 Use executor as retry system

No backoff/idempotency/dead-letter.

## 37.6 Use `CallerRunsPolicy` without understanding caller

Can block event loop/request thread.

## 37.7 Use scheduled executor without try/catch

Task dies after exception.

## 37.8 Share one executor for unrelated workloads

No isolation.

## 37.9 Ignore InterruptedException in tasks

Shutdown broken.

## 37.10 Assume virtual executor controls concurrency

It does not.

---

# 38. Best Practices

## 38.1 Name every production executor

Thread names should identify workload.

## 38.2 Own lifecycle

Create at startup, close at shutdown, or use try-with-resources.

## 38.3 Use bounded queues for production pools

Make overload explicit.

## 38.4 Handle rejection intentionally

Reject, caller-runs, shed, retry later, or backpressure.

## 38.5 Observe Futures

Especially with `submit`.

## 38.6 Wrap periodic tasks

Catch/report exceptions.

## 38.7 Separate workloads

CPU, I/O, scheduled, background, request fan-out.

## 38.8 Pass context explicitly

Tenant, user, correlation, deadline.

## 38.9 Respect transactions

Do not assume transaction crosses threads.

## 38.10 Use virtual-thread executor for blocking I/O tasks

But protect external resources.

---

# 39. Decision Matrix

| Requirement | Recommended Executor Approach |
|---|---|
| Fire dispatch, no lifecycle | `Executor` only, rare in production |
| Need result/failure/cancel | `ExecutorService.submit` |
| Need many blocking I/O tasks | `newVirtualThreadPerTaskExecutor` + resource guard |
| Need bounded CPU tasks | `ThreadPoolExecutor` fixed size ≈ cores |
| Need scheduled periodic work | `ScheduledExecutorService` |
| Need strict ordering | `newSingleThreadExecutor` or keyed executor |
| Need bounded queue/rejection | explicit `ThreadPoolExecutor` |
| Need request fan-out | virtual executor or structured concurrency |
| Need durable background work | external queue + worker executor |
| Need retry/backoff | scheduler/queue, not blind resubmit |
| Need per-task timeout | `Future.get(timeout)` + cancel, or structured scope |
| Need context propagation | explicit context/wrapper/ScopedValue later |
| Need production observability | custom named executor + metrics |

---

# 40. Latihan

## Latihan 1 — execute vs submit

Buat dua task yang throw exception: satu pakai `execute`, satu pakai `submit`. Amati perbedaannya.

## Latihan 2 — Future.get

Buat `Callable<String>` yang return value, ambil dengan `Future.get`, lalu handle `ExecutionException`.

## Latihan 3 — Timeout and Cancel

Submit task yang sleep 10 detik. Gunakan `get(1, SECONDS)` lalu `cancel(true)`.

## Latihan 4 — Graceful Shutdown

Implementasikan helper `shutdownGracefully`.

## Latihan 5 — ThreadFactory

Buat executor dengan thread name prefix `case-worker-`.

## Latihan 6 — Scheduled Task Exception

Buat scheduled fixed-rate task yang throw exception. Lalu perbaiki dengan wrapper try/catch.

## Latihan 7 — Bounded ThreadPoolExecutor

Buat pool 4 threads, queue 100, `AbortPolicy`.

## Latihan 8 — Context Propagation

Refactor task yang membaca ThreadLocal menjadi explicit `TaskContext`.

## Latihan 9 — Transaction Boundary

Jelaskan kenapa `@Transactional` method yang submit async task tidak otomatis membuat task ikut transaction.

## Latihan 10 — Virtual Executor Resource Guard

Gunakan `newVirtualThreadPerTaskExecutor` dengan `Semaphore` untuk membatasi 20 concurrent downstream calls.

---

# 41. Ringkasan

Executor Framework adalah fondasi task execution management di Java.

Core lessons:

- Executor memisahkan task definition dari execution policy.
- `Executor` hanya punya `execute`.
- `ExecutorService` menambahkan lifecycle, result, cancellation, dan shutdown.
- `Runnable` cocok untuk no result; `Callable` cocok untuk result/checked exception.
- `execute` tidak memberi Future.
- `submit` memberi Future dan menangkap exception di Future.
- Jika Future diabaikan, failure bisa tersembunyi.
- `Future.get` adalah blocking boundary.
- `invokeAll` menjalankan banyak task dan menunggu semua.
- `invokeAny` mengambil satu hasil sukses pertama tetapi bisa menggandakan load.
- Executor harus shutdown.
- Shutdown membutuhkan task yang cooperative terhadap interrupt.
- Executor harus punya owner dan lifetime.
- ThreadFactory penting untuk naming dan diagnostics.
- Executors factory methods convenient tetapi kadang kurang aman untuk production.
- Fixed pool membatasi thread, bukan queue.
- Cached pool bisa membuat terlalu banyak platform threads.
- Single-thread executor memberi order tetapi bisa backlog.
- Scheduled executor perlu exception handling.
- Rejection adalah overload signal.
- ThreadPoolExecutor membuat execution policy explicit.
- Executor boundary adalah context/security/transaction boundary.
- Virtual-thread executor mengurangi thread cost, bukan resource pressure.
- Production executor membutuhkan metrics.

Main rule:

```text
Executor is a production resource.
Design its ownership, queue, worker policy, rejection, context,
failure observation, shutdown, and metrics as intentionally as you design a database pool.
```

---

# 42. Referensi

1. Java SE 25 — `Executor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executor.html

2. Java SE 25 — `ExecutorService`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html

3. Java SE 25 — `Executors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html

4. Java SE 25 — `Future`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Future.html

5. Java SE 25 — `Callable`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Callable.html

6. Java SE 25 — `ThreadPoolExecutor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html

7. Java SE 25 — `ScheduledExecutorService`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ScheduledExecutorService.html

8. Java SE 25 — `ScheduledThreadPoolExecutor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ScheduledThreadPoolExecutor.html

9. Java SE 25 — `RejectedExecutionHandler`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/RejectedExecutionHandler.html

10. Java SE 25 — `ThreadFactory`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadFactory.html

11. OpenJDK JEP 444 — Virtual Threads  
    https://openjdk.org/jeps/444

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-concurrency-and-reactive-part-003.md](./learn-java-concurrency-and-reactive-part-003.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-concurrency-and-reactive-part-005.md](./learn-java-concurrency-and-reactive-part-005.md)

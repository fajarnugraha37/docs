# learn-java-concurrency-and-reactive-part-018.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 018  
# Cancellation, Timeout, Interruption, and Cooperative Shutdown: Designing Java Tasks That Stop Correctly

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **018**  
> Fokus: memahami cancellation sebagai bagian fundamental dari concurrency correctness. Materi ini membahas `Thread.interrupt`, interrupted status, cooperative cancellation, timeout vs deadline, `Future.cancel`, `CompletableFuture` cancellation, `ExecutorService.shutdown`, `shutdownNow`, structured concurrency cancellation, virtual threads, blocking I/O, cleanup, resource release, graceful shutdown, dan production shutdown design.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Cancellation Sulit](#2-kenapa-cancellation-sulit)
3. [Cancellation di Java Bersifat Kooperatif](#3-cancellation-di-java-bersifat-kooperatif)
4. [Mental Model: Request to Stop, Not Force Kill](#4-mental-model-request-to-stop-not-force-kill)
5. [`Thread.interrupt`](#5-threadinterrupt)
6. [Interrupted Status](#6-interrupted-status)
7. [`isInterrupted` vs `Thread.interrupted`](#7-isinterrupted-vs-threadinterrupted)
8. [`InterruptedException`](#8-interruptedexception)
9. [Golden Rule: Restore Interrupt or Propagate](#9-golden-rule-restore-interrupt-or-propagate)
10. [Designing Interruptible Tasks](#10-designing-interruptible-tasks)
11. [Cancellation Checks in Loops](#11-cancellation-checks-in-loops)
12. [Blocking Methods and Interrupts](#12-blocking-methods-and-interrupts)
13. [Non-Interruptible Blocking](#13-non-interruptible-blocking)
14. [Timeout vs Deadline](#14-timeout-vs-deadline)
15. [Deadline Propagation](#15-deadline-propagation)
16. [Future Cancellation](#16-future-cancellation)
17. [`mayInterruptIfRunning`](#17-mayinterruptifrunning)
18. [CompletableFuture Cancellation](#18-completablefuture-cancellation)
19. [Cancellation Propagation](#19-cancellation-propagation)
20. [Structured Concurrency Cancellation](#20-structured-concurrency-cancellation)
21. [Virtual Threads and Cancellation](#21-virtual-threads-and-cancellation)
22. [Cancellation and Resource Cleanup](#22-cancellation-and-resource-cleanup)
23. [Idempotent Cleanup](#23-idempotent-cleanup)
24. [Graceful Shutdown](#24-graceful-shutdown)
25. [ExecutorService Shutdown](#25-executorservice-shutdown)
26. [`shutdown` vs `shutdownNow`](#26-shutdown-vs-shutdownnow)
27. [Await Termination](#27-await-termination)
28. [Two-Phase Shutdown Pattern](#28-two-phase-shutdown-pattern)
29. [Shutdown Hooks](#29-shutdown-hooks)
30. [Cancellation in Web Requests](#30-cancellation-in-web-requests)
31. [Cancellation in Batch Jobs](#31-cancellation-in-batch-jobs)
32. [Cancellation in Message Consumers](#32-cancellation-in-message-consumers)
33. [Cancellation with Locks and Semaphores](#33-cancellation-with-locks-and-semaphores)
34. [Cancellation with Database and HTTP](#34-cancellation-with-database-and-http)
35. [Observability](#35-observability)
36. [Testing Cancellation](#36-testing-cancellation)
37. [Mini Case Study: Stuck Worker Loop](#37-mini-case-study-stuck-worker-loop)
38. [Mini Case Study: HTTP Fan-Out Timeout](#38-mini-case-study-http-fan-out-timeout)
39. [Mini Case Study: Graceful Worker Shutdown](#39-mini-case-study-graceful-worker-shutdown)
40. [Common Anti-Patterns](#40-common-anti-patterns)
41. [Best Practices](#41-best-practices)
42. [Decision Matrix](#42-decision-matrix)
43. [Latihan](#43-latihan)
44. [Ringkasan](#44-ringkasan)
45. [Referensi](#45-referensi)

---

# 1. Tujuan Bagian Ini

Concurrency bukan hanya tentang memulai banyak task.

Concurrency production harus bisa menjawab:

```text
Bagaimana menghentikan task?
Bagaimana membatalkan request?
Bagaimana mencegah child task terus jalan setelah parent gagal?
Bagaimana memastikan resource dilepas?
Bagaimana shutdown aplikasi tanpa corrupt state?
Bagaimana timeout dipropagasikan ke semua dependency?
```

Tanpa cancellation design, aplikasi bisa mengalami:

- request sudah timeout tetapi child task masih memanggil DB;
- executor shutdown tetapi task tidak berhenti;
- JVM tidak bisa terminate;
- connection/semaphore permit leak;
- retry storm;
- batch job tidak bisa dihentikan;
- message consumer memproses ulang secara kacau;
- virtual threads menumpuk menunggu dependency tanpa deadline.

Target bagian ini:

```text
Mampu mendesain Java task yang bisa berhenti secara kooperatif,
tepat waktu, aman, observable, dan tidak meninggalkan resource leak.
```

---

# 2. Kenapa Cancellation Sulit

Cancellation sulit karena menghentikan task secara paksa bisa meninggalkan state rusak.

Bayangkan thread dihentikan tepat di tengah:

```java
accountA.debit(amount);
// forced stop here
accountB.credit(amount);
```

State corrupt.

Karena itu Java modern tidak mendorong force-kill thread.

Cancellation harus kooperatif:

```text
one component requests cancellation
task observes request
task stops at safe point
task cleans resources
task reports cancellation
```

## 2.1 Main rule

```text
Cancellation is part of task protocol, not an external magic kill switch.
```

---

# 3. Cancellation di Java Bersifat Kooperatif

Kooperatif berarti task harus ikut bekerja sama untuk berhenti.

Mechanisms:

- `Thread.interrupt()`;
- volatile/atomic cancellation flag;
- timeout/deadline;
- `Future.cancel(true)`;
- structured scope shutdown;
- closing sockets/resources;
- framework cancellation signal.

## 3.1 Task must check

```java
while (!Thread.currentThread().isInterrupted()) {
    doUnitOfWork();
}
```

## 3.2 Blocking methods help

Some methods throw `InterruptedException`:

```java
BlockingQueue.take()
Thread.sleep()
CountDownLatch.await()
Semaphore.acquire()
```

## 3.3 Main rule

```text
Java cancellation works only when code reaches cancellation-aware points.
```

---

# 4. Mental Model: Request to Stop, Not Force Kill

`interrupt` does not mean:

```text
kill this thread now
```

It means:

```text
please stop what you are doing when safe
```

The receiving task decides how to react.

## 4.1 Good task behavior

- stop accepting new work;
- finish or rollback current unit safely;
- release resources;
- preserve interrupt status if needed;
- return/throw cancellation exception;
- log/metric cancellation.

## 4.2 Bad task behavior

- swallow interrupt;
- continue forever;
- leak lock/semaphore;
- partially update state;
- retry endlessly.

## 4.3 Main rule

```text
Interrupt is a cancellation signal, not asynchronous thread death.
```

---

# 5. `Thread.interrupt`

Call:

```java
thread.interrupt();
```

Effects depend on target thread state:

## 5.1 If blocked in interruptible method

Method may throw `InterruptedException`.

Example:

```java
Thread.sleep(10_000);
```

Interrupted -> throws.

## 5.2 If running normally

Interrupted status is set.

Task must check:

```java
Thread.currentThread().isInterrupted()
```

## 5.3 If not designed to observe

Nothing immediate happens.

## 5.4 Main rule

```text
interrupt requests cancellation by setting interrupted status or waking interruptible blocking calls.
```

---

# 6. Interrupted Status

Each thread has an interrupted status flag.

```java
Thread.currentThread().isInterrupted()
```

returns whether flag is set.

## 6.1 Blocking method may clear status

When `InterruptedException` is thrown, interrupted status is often cleared.

So if you catch it and cannot propagate, restore:

```java
Thread.currentThread().interrupt();
```

## 6.2 Main rule

```text
Interrupted status is the thread's cancellation signal flag.
Do not lose it accidentally.
```

---

# 7. `isInterrupted` vs `Thread.interrupted`

## 7.1 `isInterrupted`

Instance method.

```java
Thread.currentThread().isInterrupted()
```

Checks status without clearing.

## 7.2 `Thread.interrupted`

Static method.

```java
Thread.interrupted()
```

Checks current thread and clears status.

## 7.3 Dangerous if accidental

```java
if (Thread.interrupted()) {
    // status now cleared
}
```

Maybe caller expected status preserved.

## 7.4 Main rule

```text
Use isInterrupted for checks.
Use Thread.interrupted only when you intentionally want to clear status.
```

---

# 8. `InterruptedException`

Thrown by blocking methods when interrupted.

Example:

```java
try {
    queue.take();
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

## 8.1 Meaning

The operation did not complete normally because cancellation/interruption was requested.

## 8.2 Do not ignore

Bad:

```java
catch (InterruptedException e) {
    // ignore
}
```

This loses cancellation.

## 8.3 Main rule

```text
InterruptedException is not noise.
It is a cancellation control-flow signal.
```

---

# 9. Golden Rule: Restore Interrupt or Propagate

If method can throw:

```java
void runTask() throws InterruptedException {
    queue.take();
}
```

Propagate.

If cannot throw:

```java
void run() {
    try {
        queue.take();
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return;
    }
}
```

Restore and stop.

## 9.1 Why restore?

Higher-level code may check interrupted status.

## 9.2 Main rule

```text
When catching InterruptedException:
either propagate it or restore interrupt and stop.
```

---

# 10. Designing Interruptible Tasks

A good task has safe cancellation points.

Example:

```java
final class ImportTask implements Callable<ImportResult> {
    @Override
    public ImportResult call() throws Exception {
        ImportStats stats = new ImportStats();

        for (Chunk chunk : readChunks()) {
            if (Thread.currentThread().isInterrupted()) {
                throw new InterruptedException("Import cancelled");
            }

            processChunk(chunk, stats);
        }

        return stats.toResult();
    }
}
```

## 10.1 Granularity

Check cancellation between units of work, not every instruction.

## 10.2 Safe point

A safe point is where stopping leaves system consistent.

## 10.3 Main rule

```text
Long-running tasks need explicit cancellation checkpoints.
```

---

# 11. Cancellation Checks in Loops

Bad:

```java
while (true) {
    doWork();
}
```

Better:

```java
while (!Thread.currentThread().isInterrupted()) {
    doWork();
}
```

Even better for batch:

```java
for (Item item : items) {
    ensureNotCancelled();
    process(item);
}
```

Helper:

```java
static void ensureNotCancelled() throws InterruptedException {
    if (Thread.currentThread().isInterrupted()) {
        throw new InterruptedException("Cancelled");
    }
}
```

## 11.1 Main rule

```text
Any potentially long loop must have cancellation checks.
```

---

# 12. Blocking Methods and Interrupts

Many blocking methods are interruptible:

```java
Thread.sleep
Object.wait
BlockingQueue.take/put
Semaphore.acquire
CountDownLatch.await
CyclicBarrier.await
Phaser await variants
Future.get
ReentrantLock.lockInterruptibly
Condition.await
```

## 12.1 Prefer interruptible variants

Example:

```java
lock.lockInterruptibly();
```

instead of:

```java
lock.lock();
```

when cancellation matters.

## 12.2 Main rule

```text
Use interruptible blocking APIs when task cancellation matters.
```

---

# 13. Non-Interruptible Blocking

Some operations may not respond promptly to interrupt.

Examples can include:

- certain I/O;
- native calls;
- legacy drivers;
- blocking library internals;
- lock acquisition with non-interruptible API.

## 13.1 What to do

- configure timeout;
- close underlying resource;
- use interruptible API variant;
- isolate in worker;
- avoid library if not cancellable;
- use deadline.

## 13.2 Main rule

```text
Interrupt is not enough for non-interruptible blocking.
Use resource timeouts and close/cancel mechanisms.
```

---

# 14. Timeout vs Deadline

## 14.1 Timeout

Relative duration for one operation.

```text
HTTP call timeout = 500 ms
```

## 14.2 Deadline

Absolute time by which whole operation must finish.

```text
request deadline = 2026-06-12T10:00:02Z
```

## 14.3 Why deadline better for composed calls

If request has 2s budget:

```text
call A uses 1.5s
call B should not still use full 2s
```

It should use remaining 0.5s.

## 14.4 Main rule

```text
Use deadlines for end-to-end operations.
Derive per-call timeouts from remaining time.
```

---

# 15. Deadline Propagation

Context:

```java
record ExecutionContext(Instant deadline) {
    Duration remaining() {
        Duration remaining = Duration.between(Instant.now(), deadline);
        return remaining.isNegative() ? Duration.ZERO : remaining;
    }

    boolean expired() {
        return !Instant.now().isBefore(deadline);
    }
}
```

Usage:

```java
Response call(ExecutionContext context, Request request) {
    Duration timeout = context.remaining();
    return client.call(request, timeout);
}
```

## 15.1 Child tasks

Pass same deadline to child tasks.

## 15.2 Main rule

```text
All child work should share and respect the parent deadline.
```

---

# 16. Future Cancellation

`Future.cancel(boolean mayInterruptIfRunning)` attempts to cancel task.

```java
future.cancel(true);
```

If task not started, it may be prevented from running.

If running and `mayInterruptIfRunning` true, thread may be interrupted.

## 16.1 After cancel

```java
future.isCancelled()
```

`get()` may throw `CancellationException`.

## 16.2 Main rule

```text
Future.cancel requests cancellation.
It does not guarantee task instantly stops.
```

---

# 17. `mayInterruptIfRunning`

```java
future.cancel(true);
```

means:

```text
if task is running, interrupt its thread
```

```java
future.cancel(false);
```

means:

```text
do not interrupt if already running
```

## 17.1 Use true for cancellable blocking tasks

Most request cancellation should use true.

## 17.2 Use false when interruption unsafe

Rare, if task must complete critical section.

Better design critical section small and interruption-aware.

## 17.3 Main rule

```text
mayInterruptIfRunning=true is useful only if task honors interruption.
```

---

# 18. CompletableFuture Cancellation

`CompletableFuture.cancel` completes the future exceptionally with cancellation.

But cancellation does not necessarily interrupt underlying task the same way as `Future` from executor.

If created via:

```java
CompletableFuture.supplyAsync(...)
```

cancellation semantics depend on execution and task cooperation.

## 18.1 Common pitfall

```java
CompletableFuture<?> cf = CompletableFuture.supplyAsync(() -> blockingCall());
cf.cancel(true);
```

The blocking call may keep running.

## 18.2 Main rule

```text
CompletableFuture cancellation is not a universal thread interruption mechanism.
Design cancellation explicitly.
```

---

# 19. Cancellation Propagation

When parent is cancelled, child tasks should be cancelled.

Example raw futures:

```java
List<Future<?>> futures = submitChildren();

try {
    return aggregate(futures);
} catch (Exception e) {
    for (Future<?> future : futures) {
        future.cancel(true);
    }
    throw e;
}
```

## 19.1 Propagation direction

Usually:

```text
parent cancellation -> children cancellation
child critical failure -> siblings cancellation
```

## 19.2 Main rule

```text
Cancellation must propagate along task ownership boundaries.
```

---

# 20. Structured Concurrency Cancellation

Structured concurrency helps.

`ShutdownOnFailure` policy:

```text
one child fails -> unfinished siblings cancelled
```

Parent scope close also ensures children are not leaked.

## 20.1 Better than manual futures

It makes cancellation policy part of scope.

## 20.2 Main rule

```text
Structured concurrency makes cancellation propagation explicit and less error-prone.
```

---

# 21. Virtual Threads and Cancellation

Virtual threads support interrupt.

This is especially useful because virtual-thread-per-task code is often direct blocking code.

```java
Thread vt = Thread.ofVirtual().start(() -> {
    try {
        doBlockingWork();
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
});
vt.interrupt();
```

## 21.1 Still cooperative

Virtual threads do not change cancellation semantics.

## 21.2 Blocking APIs

Use timeouts and interruptible APIs.

## 21.3 Main rule

```text
Virtual threads make cancellation cheaper to wait for,
not automatic.
```

---

# 22. Cancellation and Resource Cleanup

Always release resources in `finally`.

```java
semaphore.acquire();
try {
    doWork();
} finally {
    semaphore.release();
}
```

For AutoCloseable:

```java
try (Resource resource = open()) {
    use(resource);
}
```

## 22.1 On cancellation

Cleanup still runs if exception/interrupt propagates through `finally`.

## 22.2 Main rule

```text
Cancellation path must release the same resources as success/failure path.
```

---

# 23. Idempotent Cleanup

Cleanup may be called multiple times or after partial setup.

Design:

```java
closeQuietly(resource);
releaseIfAcquired(permit);
rollbackIfStarted(transaction);
```

## 23.1 Track acquisition

```java
boolean acquired = false;
try {
    semaphore.acquire();
    acquired = true;
    doWork();
} finally {
    if (acquired) {
        semaphore.release();
    }
}
```

## 23.2 Main rule

```text
Cleanup should be safe after partial execution.
```

---

# 24. Graceful Shutdown

Graceful shutdown means:

```text
stop accepting new work
let in-flight work finish within deadline
cancel/interrupt remaining work
release resources
flush state/logs
exit
```

## 24.1 Not graceful

```text
kill process immediately
```

May corrupt in-flight work.

## 24.2 Main rule

```text
Graceful shutdown is coordinated cancellation with a deadline.
```

---

# 25. ExecutorService Shutdown

ExecutorService has:

```java
shutdown()
shutdownNow()
awaitTermination(...)
```

## 25.1 `shutdown`

Stops accepting new tasks.

Already submitted tasks continue.

## 25.2 `shutdownNow`

Attempts to stop actively executing tasks and returns tasks awaiting execution.

Usually interrupts running tasks.

## 25.3 Main rule

```text
shutdown is polite stop accepting.
shutdownNow is cancellation request for running/queued work.
```

---

# 26. `shutdown` vs `shutdownNow`

## 26.1 Use `shutdown`

For graceful phase.

```java
executor.shutdown();
```

## 26.2 Use `shutdownNow`

After timeout.

```java
if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
    executor.shutdownNow();
}
```

## 26.3 Main rule

```text
First ask executor to finish.
Then interrupt remaining tasks if deadline expires.
```

---

# 27. Await Termination

```java
executor.shutdown();

try {
    if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
        executor.shutdownNow();
        if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
            log.error("Executor did not terminate");
        }
    }
} catch (InterruptedException e) {
    executor.shutdownNow();
    Thread.currentThread().interrupt();
}
```

## 27.1 Main rule

```text
Executor shutdown must itself handle interruption correctly.
```

---

# 28. Two-Phase Shutdown Pattern

Classic pattern:

```java
void stopExecutor(ExecutorService executor) {
    executor.shutdown();
    try {
        if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
            executor.shutdownNow();
            if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
                log.error("Executor did not terminate");
            }
        }
    } catch (InterruptedException e) {
        executor.shutdownNow();
        Thread.currentThread().interrupt();
    }
}
```

## 28.1 Works when tasks cooperate

If tasks ignore interruption, shutdown may hang.

## 28.2 Main rule

```text
Executor shutdown quality depends on task cancellation quality.
```

---

# 29. Shutdown Hooks

JVM shutdown hook:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    service.stop();
}));
```

## 29.1 Use carefully

Shutdown hooks should:

- be short;
- avoid deadlocks;
- have timeouts;
- not rely on services already stopped;
- not start complex new work.

## 29.2 In containers

Kubernetes sends SIGTERM.

App should:

- stop accepting traffic;
- fail readiness;
- drain;
- shutdown executor;
- close DB/HTTP resources;
- exit before termination grace period.

## 29.3 Main rule

```text
Shutdown hook should trigger graceful shutdown, not contain complex business processing.
```

---

# 30. Cancellation in Web Requests

If client disconnects or request times out:

- stop child work;
- cancel downstream calls;
- release DB connection;
- avoid writing response after timeout;
- record metric.

## 30.1 Request deadline

Create at entry.

```java
ExecutionContext context = new ExecutionContext(now.plusSeconds(2));
```

## 30.2 Child calls

Use `context.remaining()`.

## 30.3 Main rule

```text
Web request cancellation should cancel all request-scoped subtasks.
```

---

# 31. Cancellation in Batch Jobs

Batch jobs need:

- cancellation flag;
- interrupt support;
- checkpointing;
- idempotent chunks;
- progress persistence;
- partial result handling.

## 31.1 Safe checkpoint

Stop between chunks:

```java
for (Chunk chunk : chunks) {
    ensureNotCancelled();
    processChunkInTransaction(chunk);
    saveCheckpoint(chunk.id());
}
```

## 31.2 Main rule

```text
Batch cancellation should happen at chunk boundaries where state is consistent.
```

---

# 32. Cancellation in Message Consumers

Message processing cancellation interacts with ack/nack.

## 32.1 If cancelled before ack

Message may be redelivered.

Need idempotency.

## 32.2 If processing cannot finish before shutdown

Decide:

- finish current message;
- nack/requeue;
- dead-letter;
- checkpoint.

## 32.3 Main rule

```text
Message cancellation policy must align with broker ack semantics.
```

---

# 33. Cancellation with Locks and Semaphores

## 33.1 Semaphore

Prefer timed/interruptible acquire:

```java
if (!semaphore.tryAcquire(timeout, TimeUnit.MILLISECONDS)) {
    throw new ServiceBusyException();
}
```

Release in finally.

## 33.2 ReentrantLock

Use:

```java
lock.lockInterruptibly();
```

or:

```java
lock.tryLock(timeout, unit)
```

## 33.3 synchronized

Waiting to enter `synchronized` is not timeout-based in source code.

If you need timed/interruptible lock acquisition, use `ReentrantLock`.

## 33.4 Main rule

```text
If cancellation while waiting for lock matters, use interruptible/timed lock APIs.
```

---

# 34. Cancellation with Database and HTTP

## 34.1 Database

Use:

- query timeout;
- transaction timeout;
- connection timeout;
- statement cancellation if supported;
- short transactions.

## 34.2 HTTP

Use:

- connect timeout;
- request timeout;
- response timeout;
- cancellation of request if client supports;
- circuit breaker.

## 34.3 Main rule

```text
Interrupt alone is not enough for external I/O.
Configure dependency-level timeouts.
```

---

# 35. Observability

Track cancellation and timeout.

## 35.1 Metrics

- cancellation count;
- timeout count by dependency;
- interrupted tasks;
- executor shutdown duration;
- tasks not terminated;
- child task cancellation;
- resource cleanup failures;
- semaphore acquire timeout;
- DB query timeout;
- HTTP timeout.

## 35.2 Logs

Log cancellation at boundary, not every loop check.

## 35.3 Tracing

Mark spans cancelled/timed out.

## 35.4 Main rule

```text
Cancellation should be visible as first-class outcome, not hidden exception noise.
```

---

# 36. Testing Cancellation

Test:

## 36.1 Interrupt loop

Start task, interrupt, assert stops.

## 36.2 Blocking interrupt

Task waits on `BlockingQueue.take`, interrupt, assert exits.

## 36.3 Future cancel

Submit task, cancel true, assert cleanup.

## 36.4 Timeout

Dependency sleeps beyond timeout, assert cancellation/fallback.

## 36.5 Executor shutdown

Task ignores interrupt -> test detects bad behavior.

## 36.6 Resource cleanup

Semaphore permits restored after cancellation.

## 36.7 Main rule

```text
Cancellation behavior must be tested, not assumed.
```

---

# 37. Mini Case Study: Stuck Worker Loop

## 37.1 Broken

```java
class Worker implements Runnable {
    public void run() {
        while (true) {
            doWork();
        }
    }
}
```

Cannot stop.

## 37.2 Fixed

```java
class Worker implements Runnable {
    public void run() {
        while (!Thread.currentThread().isInterrupted()) {
            doWork();
        }
    }
}
```

If `doWork` blocks, make it interruptible or add timeout.

## 37.3 Lesson

```text
Long-running loops must have cancellation checks.
```

---

# 38. Mini Case Study: HTTP Fan-Out Timeout

## 38.1 Problem

Dashboard request timeout is 2s.

Child calls each have 5s timeout.

If one child hangs, parent timeout is violated.

## 38.2 Fix

Use shared deadline.

```java
Duration timeout = context.remaining();
client.call(request, timeout);
```

Cancel siblings on failure/timeout via structured scope.

## 38.3 Lesson

```text
Child timeout must be derived from parent deadline.
```

---

# 39. Mini Case Study: Graceful Worker Shutdown

## 39.1 Worker

```java
final class WorkerService implements AutoCloseable {
    private final ExecutorService executor =
        Executors.newFixedThreadPool(4);

    void start() {
        for (int i = 0; i < 4; i++) {
            executor.submit(this::runWorker);
        }
    }

    private void runWorker() {
        try {
            while (!Thread.currentThread().isInterrupted()) {
                Message message = queue.take();
                process(message);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            cleanupWorker();
        }
    }

    @Override
    public void close() {
        executor.shutdownNow();
        try {
            if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
                log.error("Workers did not stop");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            executor.shutdownNow();
        }
    }
}
```

## 39.2 Lesson

```text
Graceful shutdown requires task loop, interrupt handling, and executor lifecycle.
```

---

# 40. Common Anti-Patterns

## 40.1 Swallowing InterruptedException

```java
catch (InterruptedException ignored) {}
```

## 40.2 Retrying after interrupt

Cancellation ignored.

## 40.3 Infinite loop without check

No stop.

## 40.4 Timeout per call but no end-to-end deadline

Request budget exceeded.

## 40.5 Cancel Future but task ignores interrupt

False sense of cancellation.

## 40.6 Cleanup not in finally

Resource leak.

## 40.7 Semaphore acquire without release

Permit leak.

## 40.8 shutdownNow as first step

Abrupt cancellation.

## 40.9 Fire-and-forget task

No owner/cancel/observe.

## 40.10 No cancellation tests

Bug only appears in shutdown/incident.

---

# 41. Best Practices

## 41.1 Treat cancellation as normal control flow

Not exceptional mystery.

## 41.2 Use deadlines

Propagate remaining budget.

## 41.3 Use interruptible APIs

Where possible.

## 41.4 Restore interrupt

If catching and not propagating.

## 41.5 Cleanup in finally

Always.

## 41.6 Use structured concurrency

For parent-owned child tasks.

## 41.7 Make long tasks checkpointed

Batch chunks.

## 41.8 Configure external timeouts

DB/HTTP/cache.

## 41.9 Test cancellation

Interrupt, timeout, shutdown.

## 41.10 Observe cancellation

Metrics/logs/tracing.

---

# 42. Decision Matrix

| Problem | Recommended |
|---|---|
| Stop running loop | interrupt check or volatile flag |
| Stop blocking queue wait | interrupt |
| Stop semaphore wait | `tryAcquire(timeout)` or interruptible acquire |
| Timed lock wait | `ReentrantLock.tryLock(timeout)` |
| Request budget | deadline context |
| Child task failure cancels siblings | structured concurrency |
| Cancel submitted task | `Future.cancel(true)` plus interrupt-aware task |
| CompletableFuture blocking task cancellation | explicit cancellation design |
| External HTTP timeout | client timeout + parent deadline |
| DB query timeout | query/transaction timeout |
| Executor graceful stop | shutdown -> await -> shutdownNow |
| Batch cancellation | chunk checkpoints |
| Message cancellation | align with ack/nack/idempotency |
| Non-interruptible library | timeout/close/isolate/replace |

---

# 43. Latihan

## Latihan 1 — Interrupt Loop

Buat loop worker yang berhenti saat interrupted.

## Latihan 2 — Restore Interrupt

Refactor kode yang swallow `InterruptedException`.

## Latihan 3 — Deadline

Buat `ExecutionContext` dengan `deadline` dan `remaining()`.

## Latihan 4 — Future Cancel

Submit task yang sleep, cancel true, dan amati behavior.

## Latihan 5 — Semaphore Cleanup

Buat test bahwa permit dikembalikan saat task dibatalkan.

## Latihan 6 — Executor Shutdown

Implementasikan two-phase shutdown helper.

## Latihan 7 — Non-Interruptible Simulation

Simulasikan blocking yang tidak merespons interrupt dan tambahkan timeout alternative.

## Latihan 8 — Structured Cancellation

Buat pseudo-code fan-out: jika satu child gagal, siblings cancel.

## Latihan 9 — Batch Checkpoint

Desain batch job yang bisa cancel di chunk boundary.

## Latihan 10 — Shutdown Readiness

Buat checklist shutdown untuk service dengan HTTP server, executor, DB pool, dan message consumer.

---

# 44. Ringkasan

Cancellation adalah bagian inti dari desain concurrent Java.

Core lessons:

- Java cancellation bersifat kooperatif.
- `interrupt` adalah request to stop, bukan force kill.
- Interrupted status adalah cancellation signal.
- `InterruptedException` harus dipropagate atau interrupt harus direstore.
- `isInterrupted` tidak clear status; `Thread.interrupted` clear status.
- Long-running loops perlu cancellation checkpoints.
- Blocking APIs sebaiknya interruptible atau timeout-based.
- Non-interruptible blocking butuh timeout/resource close.
- Timeout adalah relative per operation; deadline adalah absolute end-to-end budget.
- Child tasks harus mewarisi parent deadline.
- `Future.cancel(true)` meminta interrupt tetapi task harus cooperate.
- `CompletableFuture` cancellation tidak selalu menghentikan underlying task.
- Cancellation harus propagate along ownership boundaries.
- Structured concurrency membantu sibling cancellation dan bounded lifetime.
- Virtual threads tetap memakai cooperative cancellation.
- Cleanup harus di `finally`.
- Executor shutdown harus two-phase.
- Web request cancellation harus cancel request-scoped children.
- Batch cancellation harus terjadi pada safe checkpoint.
- Message cancellation harus sesuai ack/nack semantics.
- External I/O butuh dependency-level timeouts.
- Cancellation harus observable dan tested.

Main rule:

```text
A concurrent task is production-ready only if it can start, finish, fail,
timeout, cancel, cleanup, and report its outcome predictably.
```

---

# 45. Referensi

1. Java SE 25 — `Thread.interrupt`, interruption, virtual/platform threads  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html

2. Java SE 25 — `InterruptedException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/InterruptedException.html

3. Java SE 25 — `Future.cancel`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Future.html

4. Java SE 25 — `CompletableFuture`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html

5. Java SE 25 — `ExecutorService`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html

6. Java SE 25 — `Semaphore`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html

7. Java SE 25 — `ReentrantLock`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html

8. Java SE 25 — `StructuredTaskScope`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html

9. OpenJDK JEP 505 — Structured Concurrency  
   https://openjdk.org/jeps/505

10. OpenJDK JEP 444 — Virtual Threads  
    https://openjdk.org/jeps/444

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 017](./learn-java-concurrency-and-reactive-part-017.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 019](./learn-java-concurrency-and-reactive-part-019.md)

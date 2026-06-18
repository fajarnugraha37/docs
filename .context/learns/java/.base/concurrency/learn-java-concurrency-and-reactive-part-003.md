# learn-java-concurrency-and-reactive-part-003.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 003  
# Task, Work Unit, and Execution Model: Designing Concurrent Work Before Choosing Threads, Executors, Futures, Virtual Threads, or Reactive Pipelines

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **003**  
> Fokus: membangun mental model tentang **work unit** dan **task** sebelum memilih API concurrency. Banyak bug production bukan karena salah memakai `Thread` atau `Executor`, tetapi karena pekerjaan concurrent tidak punya ownership, lifecycle, timeout, cancellation, retry, idempotency, failure policy, resource limit, dan observability yang jelas. Bagian ini adalah jembatan dari `Thread` fundamental menuju Executor Framework, CompletableFuture, Virtual Threads, Structured Concurrency, dan Reactive Programming.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Mulai dari Task, Bukan Thread](#2-kenapa-mulai-dari-task-bukan-thread)
3. [Work vs Task vs Thread vs Executor](#3-work-vs-task-vs-thread-vs-executor)
4. [Work Unit sebagai Konsep Domain](#4-work-unit-sebagai-konsep-domain)
5. [Task sebagai Representasi Eksekusi](#5-task-sebagai-representasi-eksekusi)
6. [`Runnable`, `Callable`, `Supplier`, `Function`: Memilih Bentuk Task](#6-runnable-callable-supplier-function-memilih-bentuk-task)
7. [Task Lifecycle](#7-task-lifecycle)
8. [Task Ownership](#8-task-ownership)
9. [Task Boundary](#9-task-boundary)
10. [Task Result](#10-task-result)
11. [Task Failure](#11-task-failure)
12. [Task Cancellation](#12-task-cancellation)
13. [Task Timeout and Deadline](#13-task-timeout-and-deadline)
14. [Task Retry](#14-task-retry)
15. [Task Idempotency](#15-task-idempotency)
16. [Task Ordering](#16-task-ordering)
17. [Task Dependency](#17-task-dependency)
18. [Task Fan-Out and Fan-In](#18-task-fan-out-and-fan-in)
19. [Task Granularity](#19-task-granularity)
20. [Task Resource Model](#20-task-resource-model)
21. [Task Admission Control](#21-task-admission-control)
22. [Task Queueing](#22-task-queueing)
23. [Task Backpressure](#23-task-backpressure)
24. [Task Context](#24-task-context)
25. [Task Observability](#25-task-observability)
26. [Task Testing](#26-task-testing)
27. [Execution Model Options](#27-execution-model-options)
28. [Choosing Execution Model from Task Semantics](#28-choosing-execution-model-from-task-semantics)
29. [Design Pattern: Command as Task](#29-design-pattern-command-as-task)
30. [Design Pattern: Job as Task](#30-design-pattern-job-as-task)
31. [Design Pattern: Event Handler as Task](#31-design-pattern-event-handler-as-task)
32. [Design Pattern: Request Fan-Out Subtask](#32-design-pattern-request-fan-out-subtask)
33. [Design Pattern: Pipeline Stage Task](#33-design-pattern-pipeline-stage-task)
34. [Mini Case Study: Dashboard Aggregation](#34-mini-case-study-dashboard-aggregation)
35. [Mini Case Study: Batch Import](#35-mini-case-study-batch-import)
36. [Mini Case Study: Notification Sending](#36-mini-case-study-notification-sending)
37. [Common Anti-Patterns](#37-common-anti-patterns)
38. [Best Practices](#38-best-practices)
39. [Decision Matrix](#39-decision-matrix)
40. [Latihan](#40-latihan)
41. [Ringkasan](#41-ringkasan)
42. [Referensi](#42-referensi)

---

# 1. Tujuan Bagian Ini

Setelah memahami `Thread`, banyak engineer langsung berpikir:

```text
Harus pakai Executor apa?
Harus pakai virtual thread atau platform thread?
Harus pakai CompletableFuture?
Harus pakai reactive?
```

Pertanyaan itu penting, tetapi belum yang pertama.

Pertanyaan pertama seharusnya:

```text
Apa unit kerja yang sedang kita jalankan?
Siapa pemiliknya?
Kapan dimulai?
Kapan selesai?
Apa hasilnya?
Apa failure policy-nya?
Bisa dicancel?
Ada timeout?
Bisa di-retry?
Retry aman?
Resource apa yang dipakai?
Berapa maksimal concurrency?
Bagaimana observability-nya?
```

Bagian ini melatih cara berpikir dari sisi **task design**.

Kenapa penting?

Karena API concurrency hanyalah mekanisme eksekusi. Jika task design buruk, pilihan API terbaik pun tetap bisa menghasilkan sistem buruk.

Contoh:

```java
executor.submit(() -> repository.save(entity));
```

Kode ini terlihat sederhana. Tetapi belum jelas:

- siapa menunggu hasilnya?
- jika gagal, siapa tahu?
- apakah transaction ada?
- apakah task boleh jalan setelah request selesai?
- apakah retry akan membuat duplicate?
- apakah executor bisa shutdown?
- apakah exception hilang?
- apakah security context ada?
- apakah DB pool bisa overload?

Itulah inti bagian ini.

---

# 2. Kenapa Mulai dari Task, Bukan Thread

Thread adalah kendaraan.

Task adalah perjalanan.

Executor adalah terminal/armada kendaraan.

Reactive stream adalah sistem conveyor.

Tetapi business problem-nya adalah:

```text
barang apa yang harus dipindahkan?
ke mana?
dengan batas waktu apa?
jika gagal bagaimana?
siapa yang bertanggung jawab?
```

## 2.1 Salah urutan berpikir

Bad:

```text
Saya mau pakai virtual threads.
Sekarang task apa yang bisa saya masukkan?
```

Better:

```text
Saya punya 10.000 blocking I/O tasks pendek,
masing-masing punya timeout 2 detik,
boleh gagal per item,
harus dibatasi 100 concurrent calls ke downstream.
Model apa yang cocok?
```

## 2.2 Thread tidak memberi semantics

Thread tidak otomatis memberi:

- result semantics;
- retry semantics;
- timeout semantics;
- ownership;
- cancellation propagation;
- idempotency;
- observability;
- backpressure;
- error correlation.

## 2.3 Main rule

```text
Design the task semantics first.
Choose the execution mechanism second.
```

---

# 3. Work vs Task vs Thread vs Executor

Mari bedakan vocabulary.

## 3.1 Work

Work adalah pekerjaan bisnis/logis.

Contoh:

```text
process one case approval
send one notification
validate one import row
fetch user profile
calculate dashboard summary
publish one event
```

Work menjawab:

```text
Apa yang perlu diselesaikan?
```

## 3.2 Task

Task adalah representasi executable dari work.

Contoh Java:

```java
Runnable task = () -> notificationSender.send(notification);
Callable<Dashboard> task = () -> dashboardService.load(userId);
```

Task menjawab:

```text
Bagaimana pekerjaan ini dijalankan sebagai unit eksekusi?
```

## 3.3 Thread

Thread adalah execution context.

```java
Thread.ofVirtual().start(task);
```

Thread menjawab:

```text
Di konteks eksekusi apa task berjalan?
```

## 3.4 Executor

Executor adalah mekanisme submission dan scheduling task.

```java
executor.submit(task);
```

Executor menjawab:

```text
Siapa yang menerima task, mengantri, menjalankan, dan mengelola worker?
```

## 3.5 Future

Future adalah handle terhadap hasil task nanti.

```java
Future<Result> future = executor.submit(callable);
```

Future menjawab:

```text
Bagaimana caller menunggu, mengambil hasil, menangani failure, atau cancel?
```

## 3.6 Main rule

```text
Work is business intent.
Task is executable unit.
Thread is execution context.
Executor is task execution management.
Future is result handle.
```

---

# 4. Work Unit sebagai Konsep Domain

Work unit sebaiknya punya bentuk domain yang jelas.

Bad:

```java
Runnable task = () -> process(data);
```

Better:

```java
record NotificationSendCommand(
    NotificationId notificationId,
    TenantId tenantId,
    Recipient recipient,
    Channel channel,
    String idempotencyKey,
    Instant deadline
) {}
```

Task menjalankan command:

```java
Runnable task = () -> notificationService.send(command);
```

## 4.1 Kenapa domain work unit penting

Karena work unit bisa membawa:

- identity;
- owner;
- tenant;
- correlation ID;
- idempotency key;
- deadline;
- retry count;
- priority;
- resource class;
- audit context;
- authorization context.

## 4.2 Work unit harus serializable?

Tidak selalu.

Untuk in-memory task, tidak perlu.

Untuk queue/message task, perlu.

## 4.3 Work unit vs entity

Jangan selalu memakai entity sebagai task payload.

Bad:

```java
Runnable task = () -> process(orderEntity);
```

Risiko:

- lazy loading;
- stale entity;
- detached entity;
- large graph retention;
- transaction boundary unclear.

Better:

```java
record ProcessOrderTask(OrderId orderId, TenantId tenantId, String idempotencyKey) {}
```

Worker load fresh data within transaction.

## 4.4 Main rule

```text
A production task should have an identity and boundary,
not just a lambda that captures random state.
```

---

# 5. Task sebagai Representasi Eksekusi

Task bisa direpresentasikan sebagai:

- `Runnable`;
- `Callable<T>`;
- `Supplier<T>`;
- `Function<I,O>`;
- command object;
- message handler;
- event handler;
- actor message;
- reactive signal;
- structured concurrency subtask.

## 5.1 Task should be explicit

Bad:

```java
executor.submit(() -> {
    // captures request, entityManager, mutable list, security context
});
```

Better:

```java
record CaseSummaryTask(
    TenantId tenantId,
    UserId viewerId,
    Instant deadline
) {}

Callable<CaseSummary> task = () -> caseSummaryService.load(taskInput);
```

## 5.2 Capturing state is dangerous

Lambda capture can retain:

- request object;
- HTTP session;
- entity manager;
- large collection;
- security principal;
- mutable variables.

This can cause:

- memory leak;
- wrong context;
- race condition;
- lazy loading outside transaction;
- security bug.

## 5.3 Main rule

```text
Prefer explicit task input objects over implicit lambda capture.
```

---

# 6. `Runnable`, `Callable`, `Supplier`, `Function`: Memilih Bentuk Task

## 6.1 Runnable

Use when:

- no result;
- no checked exception in signature;
- fire-and-forget only if failure is handled elsewhere.

```java
Runnable task = () -> auditWriter.flush();
```

But beware: fire-and-forget without failure handling is dangerous.

## 6.2 Callable

Use when:

- result needed;
- checked exception possible;
- submitted to `ExecutorService`.

```java
Callable<Report> task = () -> reportService.generate(input);
```

## 6.3 Supplier

Use for pure/lazy value production, often with `CompletableFuture`.

```java
Supplier<User> supplier = () -> userClient.getUser(userId);
```

## 6.4 Function

Use when task transforms input to output.

```java
Function<Row, ValidationResult> validateRow = validator::validate;
```

## 6.5 Domain-specific interface

For meaningful domain behavior:

```java
@FunctionalInterface
interface CaseSubtask<T> {
    T execute(CaseExecutionContext context) throws Exception;
}
```

## 6.6 Main rule

```text
Choose task type based on result, exception, input, and domain meaning.
```

---

# 7. Task Lifecycle

Task lifecycle:

```text
created
submitted
accepted/rejected
queued
started
running
waiting/blocking
completed successfully
completed with failure
cancelled
timed out
cleaned up
observed
```

## 7.1 Created

Task object exists.

## 7.2 Submitted

Task handed to executor/scheduler/queue.

## 7.3 Accepted or rejected

Bounded executors may reject.

## 7.4 Queued

Task waiting before running.

## 7.5 Started

Execution begins.

## 7.6 Running/waiting/blocking

Task may use CPU or wait for resources.

## 7.7 Completed

Success or failure.

## 7.8 Cancelled/timed out

Task may be interrupted or marked cancelled.

## 7.9 Cleaned up

Resources closed; context removed.

## 7.10 Observed

Result/failure recorded.

## 7.11 Main rule

```text
A task is not only “run”.
It has lifecycle states that must be designed and observed.
```

---

# 8. Task Ownership

Every task needs owner.

Owner answers:

```text
Who created this task?
Who waits for it?
Who cancels it?
Who handles failure?
Who owns its resources?
Who observes completion?
```

## 8.1 Request-owned task

Task belongs to one HTTP request.

If request times out/cancels, task should stop.

Example:

```text
dashboard subtasks
case query fan-out
permission lookup
```

Structured concurrency fits.

## 8.2 Service-owned background task

Task belongs to application service.

Example:

```text
notification worker
scheduled cleanup
outbox publisher
```

Executor lifecycle fits.

## 8.3 Queue-owned task

Task belongs to durable queue/message system.

Example:

```text
Kafka event handler
RabbitMQ consumer
SQS message processor
```

Message acknowledgement/retry semantics matter.

## 8.4 User-owned long-running job

Task belongs to user/job record.

Example:

```text
export report
bulk import
data archival job
```

Needs job ID, status, cancellation, progress.

## 8.5 Main rule

```text
Unowned tasks become leaks, ghost work, and invisible failures.
```

---

# 9. Task Boundary

Task boundary defines what is inside one unit of work.

## 9.1 Too large

One task processes entire 10M-row file.

Problems:

- no progress;
- hard cancellation;
- memory spike;
- failure restarts everything;
- no parallelism;
- long transaction.

## 9.2 Too small

One task per tiny field validation.

Problems:

- overhead;
- scheduling cost;
- too much coordination;
- hard ordering;
- too many futures.

## 9.3 Good boundary

Example batch import:

```text
one task per chunk of 500 rows
```

or:

```text
one task per row only for slow I/O enrichment,
bounded by downstream capacity
```

## 9.4 Main rule

```text
Task boundary should balance overhead, isolation, progress, retry, and resource usage.
```

---

# 10. Task Result

A task result can be:

## 10.1 No result

```java
Runnable
```

But still needs success/failure observability.

## 10.2 Single value

```java
Callable<UserProfile>
```

## 10.3 Structured result

```java
record ImportChunkResult(
    int totalRows,
    int successRows,
    List<RowError> errors
) {}
```

## 10.4 Partial success

Batch tasks often need partial result.

## 10.5 Side effect result

Task may write to DB/send email. The result might be acknowledgment or persisted status.

## 10.6 Main rule

```text
Even “void” tasks should have observable outcome semantics.
```

---

# 11. Task Failure

Failures can be:

## 11.1 Expected business failure

Example:

```text
validation failed
insufficient permission
duplicate request
```

Usually model as data/result.

## 11.2 Transient technical failure

Example:

```text
HTTP 503
timeout
DB connection transient
rate limit
```

May be retried with policy.

## 11.3 Permanent technical failure

Example:

```text
invalid configuration
unsupported message version
schema mismatch
```

Usually fail fast/dead-letter.

## 11.4 Programmer bug

Example:

```text
NullPointerException
IllegalStateException
data race
```

Needs alert, not silent retry loop.

## 11.5 Failure visibility

If task runs in separate thread and nobody observes exception:

```text
failure disappears from caller perspective
```

## 11.6 Main rule

```text
Every task needs explicit failure classification and reporting.
```

---

# 12. Task Cancellation

Cancellation asks task to stop.

## 12.1 Cancellation is cooperative

In Java, usually:

- `Future.cancel(true)`;
- `Thread.interrupt`;
- structured concurrency cancellation;
- cancellation token/flag;
- closing resource.

## 12.2 Task must check cancellation

CPU loop:

```java
while (!Thread.currentThread().isInterrupted()) {
    computeChunk();
}
```

Blocking call:

```java
try {
    queue.take();
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

## 12.3 Cancellation cleanup

Task should:

- rollback/close transaction if needed;
- release semaphore;
- close file/socket;
- update job status;
- remove context;
- stop child tasks.

## 12.4 Cancellation is not failure?

Depends.

Possible statuses:

```text
SUCCESS
FAILED
CANCELLED
TIMED_OUT
PARTIAL
```

## 12.5 Main rule

```text
If a task can outlive its caller, cancellation design is mandatory.
```

---

# 13. Task Timeout and Deadline

Timeout is maximum wait duration for an operation.

Deadline is absolute time by which work should finish.

## 13.1 Timeout

```text
HTTP call timeout = 2 seconds
DB query timeout = 5 seconds
```

## 13.2 Deadline

```text
Request deadline = now + 800ms
All subtasks must fit within remaining deadline
```

## 13.3 Why deadline is better for fan-out

If parent request has 1s budget, and each subtask independently has 1s timeout, total may exceed budget or waste work after caller gone.

Deadline propagation:

```java
Duration remaining = Duration.between(Instant.now(), deadline);
```

## 13.4 Timeout hierarchy

Example:

```text
client timeout: 2s
API gateway timeout: 1.8s
service request deadline: 1.5s
DB timeout: 1s
downstream HTTP timeout: 800ms
```

## 13.5 Main rule

```text
Timeouts prevent indefinite waiting.
Deadlines coordinate time budget across subtasks.
```

---

# 14. Task Retry

Retry can improve resilience or destroy systems.

## 14.1 Retry only transient failures

Retry:

- timeout;
- 503;
- connection reset;
- rate limited with backoff.

Do not retry:

- validation error;
- permission denied;
- duplicate business command;
- schema bug;
- deterministic NPE.

## 14.2 Retry budget

Limit attempts.

```text
max attempts = 3
max elapsed time = deadline
```

## 14.3 Backoff

Avoid immediate retry storm.

```text
100ms, 200ms, 400ms + jitter
```

## 14.4 Idempotency

Retrying side effects requires idempotency.

Example:

```text
send payment capture twice
```

Could charge twice unless idempotency key exists.

## 14.5 Main rule

```text
Retry is safe only when failure is transient and operation is idempotent or deduplicated.
```

---

# 15. Task Idempotency

Idempotent means executing same operation multiple times has same final effect.

## 15.1 Example idempotent

```text
PUT user profile to exact state
mark notification as sent with unique notification ID
insert with idempotency key
```

## 15.2 Example non-idempotent

```text
charge credit card
send email
increment counter
append audit event without dedup
```

## 15.3 Task identity

Use idempotency key:

```java
record PaymentCaptureTask(
    PaymentId paymentId,
    String idempotencyKey,
    Money amount
) {}
```

## 15.4 DB support

- unique constraint;
- upsert;
- processed message table;
- outbox/inbox;
- state machine transition guard.

## 15.5 Main rule

```text
Any retried or message-driven task needs idempotency design.
```

---

# 16. Task Ordering

Some tasks are independent. Some require order.

## 16.1 Independent tasks

Can run concurrently.

Example:

```text
fetch profile
fetch permissions
fetch notifications
```

## 16.2 Ordered tasks

Must run in sequence.

Example:

```text
validate command
persist state transition
publish event
```

## 16.3 Per-key ordering

Example:

```text
events for same caseId must be processed in order
events for different caseId can run concurrently
```

## 16.4 Ordering mechanisms

- single-thread executor per key group;
- partitioning by key;
- actor/mailbox;
- database optimistic version;
- Kafka partition key;
- lock per aggregate;
- state machine guards.

## 16.5 Main rule

```text
Only parallelize tasks whose ordering constraints are understood.
```

---

# 17. Task Dependency

Task B may depend on Task A.

## 17.1 Sequential dependency

```text
load user -> load user orders
```

## 17.2 Independent dependency

```text
load profile
load permissions
load preferences
combine
```

## 17.3 DAG

Complex task graph:

```text
A and B in parallel
C depends on A
D depends on B and C
```

## 17.4 Tools

- simple sequential code;
- structured concurrency;
- CompletableFuture;
- reactive composition;
- workflow engine;
- batch scheduler.

## 17.5 Main rule

```text
Task dependency graph determines execution model more than API preference.
```

---

# 18. Task Fan-Out and Fan-In

Fan-out:

```text
one parent task creates multiple child tasks
```

Fan-in:

```text
combine child results
```

Example dashboard:

```text
load cases
load SLA
load notifications
load workload
combine dashboard
```

## 18.1 Failure questions

- If one child fails, cancel others?
- Return partial result?
- Use fallback?
- Wait for all?
- Timeout individually or parent deadline?

## 18.2 Structured concurrency fit

Fan-out/fan-in with parent ownership is a prime use case for structured concurrency.

## 18.3 Main rule

```text
Fan-out without cancellation/failure policy creates ghost work.
```

---

# 19. Task Granularity

Task too coarse:

```text
one task for entire import
```

Task too fine:

```text
one task per small getter computation
```

## 19.1 Factors

- scheduling overhead;
- result size;
- retry boundary;
- failure isolation;
- transaction boundary;
- resource use;
- ordering;
- progress tracking.

## 19.2 CPU-bound granularity

Enough work per task to justify scheduling overhead.

## 19.3 I/O-bound granularity

Often one task per blocking call makes sense, but still guard downstream.

## 19.4 Main rule

```text
Task granularity should be chosen from cost, isolation, retry, and resource limits.
```

---

# 20. Task Resource Model

Every task consumes resources.

## 20.1 CPU

Compute-heavy tasks.

## 20.2 Memory

Input/output buffers, captured objects, stack, context.

## 20.3 DB connection

JDBC task.

## 20.4 HTTP connection

Remote call.

## 20.5 Lock

Critical section.

## 20.6 Queue slot

Queued task.

## 20.7 Rate limit quota

External API.

## 20.8 File descriptor

File/socket stream.

## 20.9 Main rule

```text
Concurrency should be limited by the scarcest resource the task uses.
```

---

# 21. Task Admission Control

Admission control decides whether to accept task.

## 21.1 Why needed

Without admission control:

```text
accept all tasks
queue grows
latency grows
timeouts grow
memory grows
system collapses
```

## 21.2 Strategies

- max queue size;
- semaphore;
- rate limit;
- bulkhead;
- reject early;
- shed load;
- degrade functionality;
- per-tenant quota;
- priority admission.

## 21.3 Example semaphore

```java
Semaphore downstreamLimit = new Semaphore(50);

<T> T callWithLimit(Callable<T> task) throws Exception {
    if (!downstreamLimit.tryAcquire(100, TimeUnit.MILLISECONDS)) {
        throw new ServiceOverloadedException();
    }

    try {
        return task.call();
    } finally {
        downstreamLimit.release();
    }
}
```

## 21.4 Main rule

```text
A system that cannot reject work cannot protect itself.
```

---

# 22. Task Queueing

Queueing happens when task cannot run immediately.

## 22.1 Queue metrics

- depth;
- enqueue rate;
- dequeue rate;
- wait time;
- oldest item age;
- rejected count.

## 22.2 Queue types

- unbounded queue;
- bounded queue;
- priority queue;
- delay queue;
- work-stealing queues;
- durable external queue.

## 22.3 Queue trade-off

Queue smooths bursts but adds latency.

Too much queue:

```text
old work executes after it is no longer useful
```

## 22.4 Main rule

```text
A queue is not capacity.
A queue is delayed work and must be bounded/observed.
```

---

# 23. Task Backpressure

Backpressure tells producer to slow down, block, or fail.

## 23.1 In thread-based systems

Bounded queue + rejection/timeout.

```java
boolean accepted = queue.offer(task, 100, TimeUnit.MILLISECONDS);
```

## 23.2 In HTTP systems

Return:

```text
429 Too Many Requests
503 Service Unavailable
Retry-After
```

## 23.3 In reactive systems

Subscriber controls demand via `request(n)`.

## 23.4 In batch systems

Limit batch size and chunk concurrency.

## 23.5 Main rule

```text
Backpressure is the difference between overload control and overload collapse.
```

---

# 24. Task Context

Task often needs context:

- tenant ID;
- user ID;
- correlation ID;
- locale;
- request deadline;
- security permissions;
- trace/span;
- idempotency key.

## 24.1 Explicit context object

```java
record TaskContext(
    TenantId tenantId,
    UserId userId,
    String correlationId,
    Instant deadline
) {}
```

## 24.2 Avoid hidden capture

Bad:

```java
executor.submit(() -> service.process(CurrentUser.get()));
```

If context is ThreadLocal and task runs on different thread, it may be missing.

## 24.3 Context propagation options

- explicit parameters;
- wrapping tasks;
- ThreadLocal with cleanup;
- Scoped Values;
- framework context propagation;
- reactive context.

## 24.4 Main rule

```text
Context must be intentionally passed, not accidentally captured.
```

---

# 25. Task Observability

Every important task should be observable.

## 25.1 Minimum fields

- task type;
- task ID;
- tenant;
- correlation ID;
- start time;
- duration;
- status;
- failure type;
- retry count;
- cancellation reason;
- queue wait time;
- resource wait time.

## 25.2 Metrics

```text
task.submitted
task.accepted
task.rejected
task.started
task.completed
task.failed
task.cancelled
task.timeout
task.duration
task.queue.wait
```

## 25.3 Logs

Log lifecycle transitions for long-running/background jobs.

Avoid logging sensitive payload.

## 25.4 Tracing

For request fan-out, child tasks should be linked to parent trace/span.

## 25.5 Main rule

```text
If you cannot observe task lifecycle, you cannot operate it reliably.
```

---

# 26. Task Testing

Test task behavior:

## 26.1 Success

Task produces expected result.

## 26.2 Failure

Task reports/propagates failure.

## 26.3 Cancellation

Task stops when interrupted/cancelled.

## 26.4 Timeout

Task respects deadline.

## 26.5 Retry

Retry only transient failures.

## 26.6 Idempotency

Repeated execution does not duplicate side effects.

## 26.7 Resource cleanup

Semaphore/connection/file released.

## 26.8 Context

Tenant/user/correlation passed correctly.

## 26.9 Observability

Metrics/logs/status updated.

## 26.10 Main rule

```text
Task tests should cover lifecycle, not only business result.
```

---

# 27. Execution Model Options

A task can run via multiple models.

## 27.1 Direct call

```java
result = task.call();
```

Best for simple sequential flow.

## 27.2 Manual thread

```java
Thread.ofPlatform().start(runnable);
```

Low-level, rarely for many tasks.

## 27.3 Executor

```java
executor.submit(callable);
```

Managed task execution.

## 27.4 Virtual-thread-per-task executor

```java
Executors.newVirtualThreadPerTaskExecutor()
```

Good for many blocking I/O tasks.

## 27.5 CompletableFuture

```java
CompletableFuture.supplyAsync(supplier, executor)
```

Async composition.

## 27.6 Structured concurrency

Parent-owned child tasks.

Good for request fan-out.

## 27.7 Reactive

Async streams with backpressure.

Good for continuous streams/non-blocking pipelines.

## 27.8 Queue/message broker

Durable async task.

Good for decoupling and retry.

## 27.9 Scheduler

Timed/periodic tasks.

## 27.10 Main rule

```text
Execution model should match task ownership, dependency, result, and failure semantics.
```

---

# 28. Choosing Execution Model from Task Semantics

## 28.1 Request-scoped fan-out

Use structured concurrency or virtual threads.

## 28.2 Fire-and-forget business side effect

Prefer durable queue/outbox, not raw thread.

## 28.3 CPU-bound parallel computation

Use bounded CPU executor/ForkJoin.

## 28.4 I/O-bound many independent calls

Virtual threads with resource guards.

## 28.5 Async library integration

CompletableFuture/reactive depending library.

## 28.6 Continuous event stream

Reactive/stream processor/message consumer.

## 28.7 Long-running user job

Job table + worker + progress + cancellation.

## 28.8 Main rule

```text
If task result matters, keep a handle.
If task must survive process/request, persist it.
If task must be limited, guard its resource.
```

---

# 29. Design Pattern: Command as Task

Command represents requested change.

```java
record ApproveCaseCommand(
    CaseId caseId,
    UserId approverId,
    TenantId tenantId,
    String idempotencyKey
) {}
```

Task:

```java
Callable<ApproveCaseResult> task =
    () -> approveCaseService.approve(command);
```

## 29.1 Properties

- has identity;
- idempotent;
- auditable;
- validates authorization;
- can be retried if safe;
- maps to transaction boundary.

## 29.2 Main rule

```text
Command tasks should be idempotent, authorized, and transactional.
```

---

# 30. Design Pattern: Job as Task

Long-running job:

```java
record ExportCasesJob(
    JobId jobId,
    TenantId tenantId,
    UserId requestedBy,
    CaseExportFilter filter,
    Instant deadline
) {}
```

## 30.1 Job lifecycle

```text
PENDING
RUNNING
SUCCEEDED
FAILED
CANCELLED
TIMED_OUT
```

## 30.2 Job state persisted

For long-running tasks, in-memory Future is not enough.

Need:

- job table;
- progress;
- cancellation request;
- result location;
- error message;
- retry policy.

## 30.3 Main rule

```text
If user cares about task after request returns, model it as a durable job.
```

---

# 31. Design Pattern: Event Handler as Task

Event-driven task:

```java
record CaseApprovedEvent(
    EventId eventId,
    CaseId caseId,
    TenantId tenantId,
    long version
) {}
```

Handler task:

```java
void handle(CaseApprovedEvent event) {
    if (inbox.alreadyProcessed(event.eventId())) {
        return;
    }

    process(event);
    inbox.markProcessed(event.eventId());
}
```

## 31.1 Event handler requirements

- idempotency;
- ordering by aggregate if needed;
- retry;
- dead-letter;
- poison message handling;
- observability;
- version check.

## 31.2 Main rule

```text
Message/event tasks are retried by nature.
Design them idempotent from the start.
```

---

# 32. Design Pattern: Request Fan-Out Subtask

Request-scoped subtask:

```java
record DashboardSubtask<T>(
    String name,
    Callable<T> callable
) {}
```

Example:

```java
Dashboard = combine(
    loadCases(),
    loadSla(),
    loadNotifications()
)
```

## 32.1 Requirements

- parent deadline;
- cancel siblings on failure if needed;
- trace correlation;
- fallback policy;
- bounded downstream calls.

## 32.2 Main rule

```text
Fan-out subtasks should not outlive the parent request unless explicitly detached.
```

---

# 33. Design Pattern: Pipeline Stage Task

Pipeline:

```text
read -> parse -> validate -> enrich -> persist -> report
```

Each stage can be task type.

## 33.1 Stage properties

- input type;
- output type;
- concurrency;
- order preservation;
- error policy;
- backpressure;
- batching.

## 33.2 Example

```java
Function<RawRow, ParsedRow> parse;
Function<ParsedRow, ValidationResult> validate;
Function<ValidRow, EnrichedRow> enrich;
```

## 33.3 Main rule

```text
Pipeline task design must define per-stage capacity and error handling.
```

---

# 34. Mini Case Study: Dashboard Aggregation

## 34.1 Work

Load dashboard for one user.

## 34.2 Subtasks

- load case summary;
- load SLA summary;
- load notification count;
- load workload.

## 34.3 Ownership

Parent HTTP request owns subtasks.

## 34.4 Deadline

Request deadline 800ms.

## 34.5 Failure policy

If case summary fails:

```text
fail whole dashboard
```

If notification count fails:

```text
return partial with warning
```

## 34.6 Execution model

Virtual threads + structured concurrency.

## 34.7 Resource guard

Downstream HTTP client pool and timeout.

## 34.8 Observability

One parent trace with child spans.

## 34.9 Lesson

```text
Fan-out is not only parallel calls.
It is parent-owned task tree with failure policy.
```

---

# 35. Mini Case Study: Batch Import

## 35.1 Work

Import uploaded CSV.

## 35.2 Work unit

Chunk of 500 rows.

## 35.3 Ownership

Durable job owned by user.

## 35.4 Result

Job status + validation report.

## 35.5 Failure policy

- row validation errors collected;
- transient enrichment error retried;
- too many errors stops job;
- cancellation supported.

## 35.6 Execution model

Background executor + bounded queue.

Virtual threads may be used for blocking enrichment, guarded by semaphore.

## 35.7 Idempotency

Job ID + row ID + operation key.

## 35.8 Lesson

```text
Batch import needs chunking, progress, caps, and idempotency,
not just parallelStream.
```

---

# 36. Mini Case Study: Notification Sending

## 36.1 Work

Send notification to recipient.

## 36.2 Task identity

Notification ID.

## 36.3 Failure

- provider timeout transient;
- invalid recipient permanent;
- rate limit transient with backoff;
- duplicate send must be prevented.

## 36.4 Execution model

Durable queue + workers.

## 36.5 Backpressure

Bounded local queue or broker consumer pause.

## 36.6 Idempotency

Provider idempotency key if available, local sent table otherwise.

## 36.7 Lesson

```text
Fire-and-forget is rarely enough for external side effects.
Use durable task semantics.
```

---

# 37. Common Anti-Patterns

## 37.1 Starting raw thread for business task

```java
new Thread(() -> sendEmail()).start();
```

No ownership/failure/retry.

## 37.2 Fire-and-forget without observability

Task fails, nobody knows.

## 37.3 Capturing request/entity in background lambda

Context leak, lazy loading bug, memory retention.

## 37.4 Retrying non-idempotent task

Duplicate side effects.

## 37.5 No timeout

Task hangs forever.

## 37.6 No cancellation

Work continues after caller gone.

## 37.7 Unbounded queue

Memory leak under overload.

## 37.8 One task per tiny operation

Scheduling overhead dominates.

## 37.9 One giant task

No progress/retry/cancel granularity.

## 37.10 Shared mutable context

Race and visibility bugs.

## 37.11 Swallowing task exceptions

Silent failure.

## 37.12 Using parallelism to hide bad algorithm

More threads over O(n²) often still bad.

---

# 38. Best Practices

## 38.1 Model work unit explicitly

Use command/job/event/task input records.

## 38.2 Define owner

Request, service, queue, job, or scheduler.

## 38.3 Define result and failure

Success, failure, partial, cancelled, timeout.

## 38.4 Define cancellation

Interrupt/deadline/token/resource close.

## 38.5 Define timeout/deadline

No unbounded waits.

## 38.6 Define retry and idempotency together

Never separate them.

## 38.7 Limit resources

Semaphores, pools, queues, rate limiters.

## 38.8 Avoid hidden capture

Pass explicit context.

## 38.9 Add observability

Metrics/logs/tracing per task lifecycle.

## 38.10 Test lifecycle

Success, failure, timeout, cancel, retry, cleanup.

---

# 39. Decision Matrix

| Task Semantics | Suggested Execution Model |
|---|---|
| Simple immediate work | Direct call |
| One dedicated long-lived worker | Platform thread or executor with lifecycle |
| Many independent blocking I/O tasks | Virtual-thread-per-task executor |
| Request-scoped fan-out | Structured concurrency / virtual threads |
| Async graph with library futures | CompletableFuture |
| CPU-heavy split work | Bounded CPU executor / ForkJoin |
| Durable background side effect | Queue/outbox + worker |
| Long-running user job | Durable job model + worker |
| Continuous stream with backpressure | Reactive stream / stream processor |
| Scheduled periodic task | ScheduledExecutorService |
| Per-key ordered events | Partitioned queue / actor / keyed executor |
| Retried external side effect | Idempotent command + retry policy |
| Work must survive JVM restart | Persist task/job/message |
| Work must stop with request | Request-owned structured scope |

---

# 40. Latihan

## Latihan 1 — Identify Work Unit

Untuk fitur “export case report”, definisikan work unit record yang memuat identity, tenant, requester, filter, deadline, dan idempotency key.

## Latihan 2 — Classify Ownership

Klasifikasikan task berikut sebagai request-owned, service-owned, queue-owned, atau user-job-owned:

1. dashboard fan-out call;
2. nightly cleanup;
3. Kafka event handler;
4. CSV import;
5. email send after approval.

## Latihan 3 — Failure Policy

Untuk notification sending, klasifikasikan failure:

- invalid email;
- provider 503;
- timeout;
- duplicate notification ID;
- NullPointerException.

Tentukan retry atau tidak.

## Latihan 4 — Cancellation Design

Desain cancellation untuk long-running export job.

## Latihan 5 — Deadline Propagation

Parent request punya deadline 1 detik. Ada 3 subtasks. Bagaimana menentukan timeout tiap subtask?

## Latihan 6 — Idempotency

Desain idempotency key untuk payment capture task.

## Latihan 7 — Granularity

Batch 1 juta rows. Bandingkan task per row, per 500 rows, dan satu task besar.

## Latihan 8 — Resource Guard

Task enrichment memanggil API downstream dengan limit 100 concurrent calls. Desain semaphore guard.

## Latihan 9 — Observability

Buat daftar metrics untuk background task executor.

## Latihan 10 — Refactor Lambda Capture

Ubah pseudo-code berikut menjadi explicit task input:

```java
executor.submit(() -> process(request, entity, securityContext));
```

---

# 41. Ringkasan

Bagian ini membahas task dan work unit sebagai dasar concurrency design.

Core lessons:

- Jangan mulai dari thread; mulai dari work unit.
- Work adalah intent bisnis.
- Task adalah executable representation.
- Thread adalah execution context.
- Executor mengelola task execution.
- Future adalah handle result.
- Task harus punya lifecycle: created, submitted, queued, running, completed, failed, cancelled, timed out, cleaned up.
- Task harus punya owner.
- Task boundary menentukan retry, progress, cancellation, dan overhead.
- Task result harus jelas, bahkan untuk void tasks.
- Failure perlu diklasifikasikan: business, transient, permanent, bug.
- Cancellation adalah cooperative protocol.
- Timeout dan deadline mencegah indefinite waiting.
- Retry hanya aman bersama idempotency.
- Ordering constraints menentukan apakah task boleh paralel.
- Fan-out/fan-in perlu failure dan cancellation policy.
- Granularity harus seimbang.
- Resource model menentukan concurrency limit.
- Admission control dan backpressure mencegah overload.
- Context harus dipassing secara intentional.
- Task lifecycle harus observable.
- Execution model dipilih dari task semantics, bukan hype API.
- Fire-and-forget mentah adalah sumber production bug.

Main rule:

```text
A concurrent program is only as good as its task design.
Before choosing Thread, Executor, CompletableFuture, virtual thread,
structured concurrency, or reactive, define ownership, lifecycle,
result, failure, cancellation, timeout, retry, idempotency,
resource limits, and observability.
```

---

# 42. Referensi

1. Java SE 25 — `Runnable`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Runnable.html

2. Java SE 25 — `Callable`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Callable.html

3. Java SE 25 — `Thread`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html

4. Java SE 25 — `Executor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executor.html

5. Java SE 25 — `ExecutorService`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html

6. Java SE 25 — `Future`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Future.html

7. Java SE 25 — `CompletableFuture`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html

8. Java SE 25 — `Semaphore`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html

9. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

10. OpenJDK JEP 505 — Structured Concurrency  
    https://openjdk.org/jeps/505

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-concurrency-and-reactive-part-002.md](./learn-java-concurrency-and-reactive-part-002.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-concurrency-and-reactive-part-004.md](./learn-java-concurrency-and-reactive-part-004.md)

</div>
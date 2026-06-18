# learn-java-concurrency-and-reactive-part-021.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 021  
# Producer–Consumer, Pipelines, Bulkheads, and Backpressure: Designing Bounded Concurrent Workflows in Java

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **021**  
> Fokus: memahami pola **producer–consumer**, **pipeline**, **bulkhead**, dan **backpressure** sebagai fondasi desain sistem concurrent yang stabil. Kita akan membahas bounded queue, worker pools, virtual-thread-per-task, semaphores, load shedding, admission control, slow consumer problem, retry storm, poison message, fan-out/fan-in, pipeline stage isolation, ordering, fairness, graceful shutdown, metrics, dan production readiness.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Masalah: Concurrency Tanpa Batas = Overload](#2-masalah-concurrency-tanpa-batas--overload)
3. [Producer–Consumer Mental Model](#3-producerconsumer-mental-model)
4. [Producer, Queue, Consumer](#4-producer-queue-consumer)
5. [Bounded vs Unbounded Queue](#5-bounded-vs-unbounded-queue)
6. [Backpressure](#6-backpressure)
7. [Load Shedding](#7-load-shedding)
8. [Admission Control](#8-admission-control)
9. [BlockingQueue sebagai Boundary](#9-blockingqueue-sebagai-boundary)
10. [`put`, `offer`, `offer(timeout)`, `take`, `poll`](#10-put-offer-offertimeout-take-poll)
11. [Producer Strategy](#11-producer-strategy)
12. [Consumer Strategy](#12-consumer-strategy)
13. [Worker Pool Pattern](#13-worker-pool-pattern)
14. [Poison Pill Shutdown](#14-poison-pill-shutdown)
15. [Interrupt-Based Shutdown](#15-interrupt-based-shutdown)
16. [Pipeline Mental Model](#16-pipeline-mental-model)
17. [Pipeline Stage Design](#17-pipeline-stage-design)
18. [Stage Capacity and Backpressure](#18-stage-capacity-and-backpressure)
19. [Stage Isolation](#19-stage-isolation)
20. [Fan-Out / Fan-In](#20-fan-out--fanin)
21. [Ordering Guarantees](#21-ordering-guarantees)
22. [Slow Consumer Problem](#22-slow-consumer-problem)
23. [Bulkhead Pattern](#23-bulkhead-pattern)
24. [Semaphore Bulkhead](#24-semaphore-bulkhead)
25. [Executor Bulkhead](#25-executor-bulkhead)
26. [Queue Bulkhead](#26-queue-bulkhead)
27. [Per-Dependency Bulkhead](#27-perdependency-bulkhead)
28. [Per-Tenant / Per-Priority Bulkhead](#28-pertenant--perpriority-bulkhead)
29. [Backpressure vs Rate Limiting vs Circuit Breaking](#29-backpressure-vs-rate-limiting-vs-circuit-breaking)
30. [Retries, Backoff, Jitter, and Retry Budget](#30-retries-backoff-jitter-and-retry-budget)
31. [Poison Messages and DLQ](#31-poison-messages-and-dlq)
32. [Virtual Threads and Producer–Consumer](#32-virtual-threads-and-producerconsumer)
33. [Virtual Threads and Bulkheads](#33-virtual-threads-and-bulkheads)
34. [Reactive Streams Connection](#34-reactive-streams-connection)
35. [Observability](#35-observability)
36. [Testing Backpressure](#36-testing-backpressure)
37. [Mini Case Study: Email Sender](#37-mini-case-study-email-sender)
38. [Mini Case Study: Case Import Pipeline](#38-mini-case-study-case-import-pipeline)
39. [Mini Case Study: Downstream API Bulkhead](#39-mini-case-study-downstream-api-bulkhead)
40. [Common Anti-Patterns](#40-common-antipatterns)
41. [Best Practices](#41-best-practices)
42. [Decision Matrix](#42-decision-matrix)
43. [Latihan](#43-latihan)
44. [Ringkasan](#44-ringkasan)
45. [Referensi](#45-referensi)

---

# 1. Tujuan Bagian Ini

Pada bagian sebelumnya, kita membahas concurrent data structures.

Sekarang kita naik satu level:

```text
Bagaimana data/work mengalir dari producer ke consumer?
Bagaimana mencegah producer membuat work lebih cepat daripada consumer?
Bagaimana memecah workflow menjadi pipeline stage?
Bagaimana membatasi dependency agar tidak saling menjatuhkan?
Bagaimana mencegah virtual threads menciptakan overload karena terlalu mudah membuat concurrency?
```

Banyak production incident bukan karena data race, tetapi karena **capacity mismatch**.

Contoh:

```text
Producer menerima 10.000 request/detik.
Consumer hanya mampu proses 1.000 request/detik.
Queue unbounded.
Memory naik.
GC naik.
Latency naik.
Timeout.
Retry storm.
Service mati.
```

Target bagian ini:

```text
Mampu mendesain workflow concurrent yang bounded, observable,
punya backpressure, punya failure policy, dan bisa shutdown dengan aman.
```

---

# 2. Masalah: Concurrency Tanpa Batas = Overload

Concurrency yang tidak dibatasi terlihat bagus saat traffic rendah.

Tetapi saat overload, sistem akan memilih salah satu:

```text
block
queue
drop
reject
degrade
crash
```

Jika kita tidak mendesain pilihan itu, runtime memilihkan untuk kita.

Biasanya hasilnya buruk:

- unbounded queue -> OOM;
- too many DB calls -> DB pool timeout;
- retry tanpa jitter -> retry storm;
- no admission -> all requests slow;
- no bulkhead -> satu dependency gagal menjatuhkan semua fitur;
- no timeout -> tasks stuck.

## 2.1 Main rule

```text
Every concurrent system needs an overload policy.
No policy means accidental failure mode.
```

---

# 3. Producer–Consumer Mental Model

Producer–consumer adalah pola:

```text
producer creates work
queue buffers work
consumer processes work
```

Diagram:

```text
[Producer(s)] -> [Queue] -> [Consumer(s)]
```

## 3.1 Producer

Contoh:

- HTTP request handler;
- message listener;
- file reader;
- scheduler;
- user action;
- upstream pipeline stage.

## 3.2 Consumer

Contoh:

- worker thread;
- virtual thread task;
- DB writer;
- email sender;
- indexing worker;
- downstream API caller.

## 3.3 Queue

Queue adalah boundary:

- decouple speed;
- absorb burst;
- preserve ordering if needed;
- provide backpressure if bounded.

## 3.4 Main rule

```text
Producer–consumer is about matching production rate with consumption capacity.
```

---

# 4. Producer, Queue, Consumer

Simple bounded design:

```java
BlockingQueue<Job> queue = new ArrayBlockingQueue<>(1000);
```

Producer:

```java
boolean accepted = queue.offer(job, 100, TimeUnit.MILLISECONDS);
if (!accepted) {
    throw new ServiceBusyException("Job queue full");
}
```

Consumer:

```java
while (!Thread.currentThread().isInterrupted()) {
    Job job = queue.take();
    process(job);
}
```

## 4.1 Why bounded?

Because memory is finite.

## 4.2 Why timeout offer?

Because producer should not block forever.

## 4.3 Why interrupt loop?

For shutdown.

## 4.4 Main rule

```text
Bounded queue + timed offer + interruptible take is a production-friendly baseline.
```

---

# 5. Bounded vs Unbounded Queue

## 5.1 Unbounded queue

```java
new LinkedBlockingQueue<>()
```

Problem:

```text
if producer > consumer for long enough, memory grows until OOM
```

## 5.2 Bounded queue

```java
new ArrayBlockingQueue<>(capacity)
```

When full, producer must:

- wait;
- timeout;
- reject;
- drop;
- route elsewhere.

## 5.3 Unbounded is sometimes acceptable?

Only if producer rate is strictly bounded elsewhere and memory budget is understood.

## 5.4 Main rule

```text
Unbounded queues hide overload until it becomes memory failure.
```

---

# 6. Backpressure

Backpressure means downstream capacity pushes back to upstream.

If queue full:

```text
producer slows down or rejects work
```

## 6.1 Forms

- blocking producer;
- timed offer;
- rejection;
- 429/503 response;
- rate limit;
- demand signaling;
- bounded queue;
- semaphore acquire timeout.

## 6.2 Goal

Prevent system from accepting more work than it can complete within useful time.

## 6.3 Main rule

```text
Backpressure protects the system by making overload visible at the boundary.
```

---

# 7. Load Shedding

Load shedding means intentionally dropping/rejecting work under overload.

Example HTTP:

```text
503 Service Unavailable
429 Too Many Requests
```

Example internal queue:

```java
if (!queue.offer(job)) {
    metrics.incrementDroppedJobs();
    return DropResult.queueFull();
}
```

## 7.1 When better than queueing?

If work has deadline.

A request queued for 30 seconds may be useless.

## 7.2 Main rule

```text
Rejecting early can be better than accepting work that will timeout anyway.
```

---

# 8. Admission Control

Admission control decides whether work may enter the system.

Example:

```java
Semaphore admission = new Semaphore(500);

Response handle(Request request) throws Exception {
    if (!admission.tryAcquire(10, TimeUnit.MILLISECONDS)) {
        return Response.status(503).build();
    }

    try {
        return process(request);
    } finally {
        admission.release();
    }
}
```

## 8.1 Difference from queue

Admission control rejects before expensive work begins.

## 8.2 Main rule

```text
Admission control protects critical capacity before work enters deep system layers.
```

---

# 9. BlockingQueue sebagai Boundary

`BlockingQueue` is a synchronization and backpressure primitive.

Useful properties:

- thread-safe;
- producer can wait;
- consumer can wait;
- capacity can bound memory;
- interruptible waiting;
- simple worker loop.

## 9.1 Common queues

- `ArrayBlockingQueue`;
- `LinkedBlockingQueue` with explicit capacity;
- `PriorityBlockingQueue`;
- `DelayQueue`;
- `SynchronousQueue`.

## 9.2 Main rule

```text
BlockingQueue is often the simplest correct producer–consumer boundary.
```

---

# 10. `put`, `offer`, `offer(timeout)`, `take`, `poll`

## 10.1 `put`

Wait forever if full.

```java
queue.put(job);
```

Use carefully.

## 10.2 `offer`

Return false immediately if full.

```java
if (!queue.offer(job)) reject();
```

## 10.3 `offer(timeout)`

Wait up to time.

```java
if (!queue.offer(job, 100, TimeUnit.MILLISECONDS)) reject();
```

Usually production-friendly.

## 10.4 `take`

Wait forever if empty, interruptible.

```java
Job job = queue.take();
```

## 10.5 `poll(timeout)`

Wait up to time.

```java
Job job = queue.poll(1, TimeUnit.SECONDS);
```

Useful for periodic shutdown checks.

## 10.6 Main rule

```text
Use timed operations when indefinite waiting is not acceptable.
```

---

# 11. Producer Strategy

When queue is full, producer can:

## 11.1 Block

Good if producer can safely slow.

Bad if it blocks critical request thread too long.

## 11.2 Timeout then reject

Good for request-driven systems.

## 11.3 Drop newest

Good for lossy telemetry.

## 11.4 Drop oldest

Good when newest data more important.

## 11.5 Coalesce

Merge multiple updates.

Example:

```text
latest status per case ID
```

## 11.6 Route to durable queue

For work that must not be lost.

## 11.7 Main rule

```text
Producer full-queue behavior must match business semantics of the work.
```

---

# 12. Consumer Strategy

Consumer design questions:

## 12.1 How many consumers?

Based on bottleneck:

- CPU;
- DB;
- HTTP provider;
- external quota.

## 12.2 What if processing fails?

- retry;
- DLQ;
- log and continue;
- stop pipeline;
- circuit break.

## 12.3 What about ordering?

More consumers can break ordering.

## 12.4 How shutdown?

- interrupt;
- poison pill;
- close queue;
- lifecycle flag.

## 12.5 Main rule

```text
Consumer count and failure policy are capacity and correctness decisions.
```

---

# 13. Worker Pool Pattern

Basic worker pool:

```java
final class WorkerPool implements AutoCloseable {
    private final BlockingQueue<Job> queue;
    private final ExecutorService workers;

    WorkerPool(int capacity, int workerCount) {
        this.queue = new ArrayBlockingQueue<>(capacity);
        this.workers = Executors.newFixedThreadPool(workerCount);
    }

    void start() {
        for (int i = 0; i < workerCount(); i++) {
            workers.submit(this::workerLoop);
        }
    }

    boolean submit(Job job, Duration timeout) throws InterruptedException {
        return queue.offer(job, timeout.toMillis(), TimeUnit.MILLISECONDS);
    }

    private void workerLoop() {
        try {
            while (!Thread.currentThread().isInterrupted()) {
                Job job = queue.take();
                process(job);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            cleanup();
        }
    }

    @Override
    public void close() {
        workers.shutdownNow();
    }
}
```

## 13.1 Main rule

```text
Worker pool is queue capacity + worker count + processing policy + shutdown protocol.
```

---

# 14. Poison Pill Shutdown

Poison pill is sentinel message.

```java
sealed interface Work permits Job, Stop {}
record Job(String id) implements Work {}
enum Stop implements Work { INSTANCE }
```

Consumer:

```java
Work work = queue.take();
if (work == Stop.INSTANCE) {
    break;
}
```

## 14.1 Need one poison per consumer

If 4 consumers, send 4 poison pills.

## 14.2 Pros

- graceful;
- processes queued jobs before stop if poison at end.

## 14.3 Cons

- harder with priority queues;
- producers may still add after poison;
- requires protocol.

## 14.4 Main rule

```text
Poison pill is a data-level shutdown signal; use only with clear producer lifecycle.
```

---

# 15. Interrupt-Based Shutdown

Interrupt worker thread.

```java
workers.shutdownNow();
```

Consumer blocked in `queue.take()` wakes with `InterruptedException`.

## 15.1 Pros

- simple;
- works with interruptible blocking;
- immediate-ish.

## 15.2 Cons

- may abandon queued work;
- requires cleanup;
- task must honor interrupt.

## 15.3 Main rule

```text
Interrupt-based shutdown is good for stopping workers, but define what happens to queued/in-flight work.
```

---

# 16. Pipeline Mental Model

Pipeline splits workflow into stages.

Example:

```text
read file -> parse rows -> validate -> enrich -> persist -> publish event
```

Each stage may have:

- input queue;
- worker count;
- capacity;
- failure policy;
- output queue.

## 16.1 Why pipeline?

- isolate slow stages;
- parallelize independent work;
- observe bottlenecks;
- apply different resource limits;
- maintain flow.

## 16.2 Main rule

```text
Pipeline design is explicit flow control between stages with different capacities.
```

---

# 17. Pipeline Stage Design

A stage has:

```text
input type
output type
worker count
input capacity
processing function
failure policy
shutdown behavior
metrics
```

Example:

```java
record Stage<I, O>(
    BlockingQueue<I> input,
    BlockingQueue<O> output,
    Function<I, O> processor
) {}
```

## 17.1 Stage capacity

CPU stage capacity different from DB stage capacity.

## 17.2 Main rule

```text
Each pipeline stage should have its own capacity and failure policy.
```

---

# 18. Stage Capacity and Backpressure

If persist stage is slow, upstream validate stage should not build infinite output.

Use bounded queues between stages.

```text
parse -> [queue 1000] -> validate -> [queue 500] -> persist
```

## 18.1 Backpressure propagation

Full downstream queue slows upstream stage.

Eventually producer slows/rejects.

## 18.2 Main rule

```text
Bounded stage queues propagate backpressure upstream.
```

---

# 19. Stage Isolation

Stage isolation means one slow dependency does not consume all system resources.

Example:

- enrichment HTTP has 50 permits;
- DB persist has 30 permits;
- CPU validation has 8 workers.

## 19.1 Avoid same executor for everything

If all stages share same fixed pool, slow blocking stage can starve CPU stage.

## 19.2 Main rule

```text
Different bottlenecks deserve different concurrency controls.
```

---

# 20. Fan-Out / Fan-In

Fan-out:

```text
one item -> many parallel operations
```

Fan-in:

```text
combine results
```

Example:

```text
case -> load profile + load documents + load compliance -> combine
```

## 20.1 Risks

- multiplicative concurrency;
- downstream overload;
- partial failure;
- ordering;
- cancellation.

## 20.2 Main rule

```text
Fan-out multiplies concurrency. Always multiply it against dependency limits.
```

---

# 21. Ordering Guarantees

Queues can preserve FIFO order, but multiple consumers can reorder completion.

If strict order required:

## 21.1 Single consumer

Simple but limited throughput.

## 21.2 Partition by key

Order per key.

```text
caseId hash -> partition queue
```

## 21.3 Sequence numbers

Allow reorder buffer.

## 21.4 Main rule

```text
Ordering and parallelism are trade-offs.
Define whether order is global, per-key, or irrelevant.
```

---

# 22. Slow Consumer Problem

If consumer slower than producer:

```text
queue grows
latency grows
memory grows
eventually failure
```

## 22.1 Options

- speed up consumer;
- add consumers;
- reduce producer rate;
- bound queue;
- shed load;
- degrade work;
- batch;
- scale horizontally;
- move to durable broker.

## 22.2 Main rule

```text
Slow consumer must be handled explicitly; queueing alone only delays failure.
```

---

# 23. Bulkhead Pattern

Bulkhead isolates failures/capacity.

Ship analogy:

```text
compartments prevent one leak from sinking whole ship
```

In software:

```text
payment dependency has its own capacity
email dependency has its own capacity
report generation has its own capacity
```

## 23.1 Benefits

- failure isolation;
- predictable degradation;
- prevents resource monopolization;
- protects critical paths.

## 23.2 Main rule

```text
Bulkheads prevent one workload/dependency from consuming all shared capacity.
```

---

# 24. Semaphore Bulkhead

Semaphore limits in-flight operations.

```java
final class Bulkhead {
    private final Semaphore permits;

    Bulkhead(int maxConcurrent) {
        this.permits = new Semaphore(maxConcurrent);
    }

    <T> T call(Callable<T> operation, Duration acquireTimeout) throws Exception {
        if (!permits.tryAcquire(acquireTimeout.toMillis(), TimeUnit.MILLISECONDS)) {
            throw new ServiceBusyException("Bulkhead full");
        }

        try {
            return operation.call();
        } finally {
            permits.release();
        }
    }
}
```

## 24.1 Good for virtual threads

Virtual threads can wait cheaply, but semaphore enforces resource limit.

## 24.2 Main rule

```text
Semaphore bulkhead limits concurrency independently from thread count.
```

---

# 25. Executor Bulkhead

Separate executor per workload.

```java
ExecutorService emailExecutor = Executors.newFixedThreadPool(20);
ExecutorService reportExecutor = Executors.newFixedThreadPool(4);
```

## 25.1 Good

- isolates worker threads;
- prevents CPU-heavy reports from starving emails.

## 25.2 With virtual threads

Use executor bulkhead less for thread scarcity and more for workload lifecycle.

Resource limit still often better as semaphore.

## 25.3 Main rule

```text
Executor bulkhead isolates execution capacity; semaphore bulkhead isolates resource concurrency.
```

---

# 26. Queue Bulkhead

Separate queues per workload.

```text
critical queue
normal queue
background queue
```

## 26.1 Benefits

- priority isolation;
- different capacity;
- different consumers;
- different rejection policy.

## 26.2 Main rule

```text
Queue bulkheads prevent low-priority backlog from hiding high-priority work.
```

---

# 27. Per-Dependency Bulkhead

Each dependency gets own limit.

```java
Bulkhead payment = new Bulkhead(50);
Bulkhead document = new Bulkhead(100);
Bulkhead email = new Bulkhead(20);
```

## 27.1 Why not global?

If email provider slow, it should not consume payment capacity.

## 27.2 Main rule

```text
Bulkhead by dependency, not just by application.
```

---

# 28. Per-Tenant / Per-Priority Bulkhead

Multi-tenant systems need fairness.

## 28.1 Per-tenant quota

```text
tenant A max 100 in-flight
tenant B max 100 in-flight
```

## 28.2 Priority

Critical operations separate from background.

## 28.3 Main rule

```text
Without per-tenant or priority isolation, noisy neighbors can starve others.
```

---

# 29. Backpressure vs Rate Limiting vs Circuit Breaking

## 29.1 Backpressure

Slow producer based on current capacity.

## 29.2 Rate limiting

Limit request rate over time.

```text
100 req/sec
```

## 29.3 Circuit breaking

Stop calling failing dependency temporarily.

## 29.4 They work together

Example:

```text
rate limiter controls pace
bulkhead controls in-flight
circuit breaker stops known-bad calls
timeout bounds wait
```

## 29.5 Main rule

```text
Backpressure, rate limiting, and circuit breaking solve different overload dimensions.
```

---

# 30. Retries, Backoff, Jitter, and Retry Budget

Retries can help transient failures.

Retries can also kill systems.

## 30.1 Retry storm

If dependency slow and all callers retry immediately:

```text
load multiplies
dependency gets worse
```

## 30.2 Backoff

Wait longer between attempts.

## 30.3 Jitter

Randomize delay to avoid synchronized waves.

## 30.4 Budget

Stop retrying after attempts/time budget.

## 30.5 Main rule

```text
Retry is extra load. Budget it like any other load.
```

---

# 31. Poison Messages and DLQ

Poison message always fails.

If retried forever, it starves queue.

## 31.1 Policy

- max attempts;
- backoff;
- DLQ;
- alert;
- manual repair;
- idempotency.

## 31.2 Main rule

```text
Poison messages must leave the hot path after bounded attempts.
```

---

# 32. Virtual Threads and Producer–Consumer

Virtual threads can simplify consumers:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    while (running) {
        Job job = queue.take();
        executor.submit(() -> process(job));
    }
}
```

But beware:

```text
queue consumer can launch unbounded concurrent jobs
```

Need semaphore/resource limit.

## 32.1 Better

```java
Semaphore permits = new Semaphore(maxInFlight);

while (!Thread.currentThread().isInterrupted()) {
    Job job = queue.take();

    permits.acquire();
    executor.submit(() -> {
        try {
            process(job);
        } finally {
            permits.release();
        }
    });
}
```

## 32.2 Main rule

```text
Virtual threads remove worker-thread scarcity, so you must add explicit in-flight limits.
```

---

# 33. Virtual Threads and Bulkheads

With virtual threads:

```text
many tasks can wait cheaply
```

But dependency still limited.

Semaphore bulkhead becomes essential.

Example:

```java
paymentBulkhead.call(() -> paymentClient.call(request), Duration.ofMillis(50));
```

## 33.1 Main rule

```text
Virtual-thread architecture should use bulkheads at every scarce dependency.
```

---

# 34. Reactive Streams Connection

Reactive Streams formalizes backpressure via demand:

```text
subscriber requests N items
publisher emits at most N
```

Producer-consumer queues are a more manual backpressure mechanism.

## 34.1 Conceptual bridge

- bounded queue full = no demand/capacity;
- `offer` false = backpressure signal;
- blocking `put` = producer slowed.

## 34.2 Main rule

```text
Backpressure is the shared concept between blocking queues and reactive streams.
```

---

# 35. Observability

Measure:

## 35.1 Queue metrics

- size;
- remaining capacity;
- enqueue rate;
- dequeue rate;
- age of oldest item;
- offer timeout/rejection;
- take wait.

## 35.2 Worker metrics

- active workers;
- processing duration;
- failure rate;
- retry count;
- cancellation count.

## 35.3 Bulkhead metrics

- available permits;
- acquire wait;
- acquire timeout;
- in-flight;
- rejection.

## 35.4 Pipeline metrics

- per-stage throughput;
- per-stage latency;
- per-stage queue size;
- bottleneck stage.

## 35.5 Main rule

```text
Backpressure without metrics becomes mysterious latency.
```

---

# 36. Testing Backpressure

Test scenarios:

## 36.1 Queue full

Producer gets rejection/timeout.

## 36.2 Slow consumer

Queue grows up to capacity, then backpressure.

## 36.3 Consumer failure

Retry/DLQ policy works.

## 36.4 Shutdown

Consumers stop, resources released.

## 36.5 Bulkhead full

Call fails fast.

## 36.6 Retry storm prevention

Backoff/jitter/budget enforced.

## 36.7 Main rule

```text
Backpressure behavior should be tested under overload, not only normal load.
```

---

# 37. Mini Case Study: Email Sender

## 37.1 Requirement

Send email notifications. Provider allows 20 concurrent sends and 100/sec.

## 37.2 Design

- durable table/queue for email commands;
- in-memory bounded queue for local workers;
- semaphore bulkhead 20;
- rate limiter 100/sec;
- timeout per send;
- retry with backoff;
- DLQ after max attempts.

## 37.3 Worker sketch

```java
while (!Thread.currentThread().isInterrupted()) {
    EmailCommand command = queue.take();

    executor.submit(() -> {
        try {
            emailBulkhead.call(
                () -> provider.send(command),
                Duration.ofMillis(100)
            );
            markSent(command.id());
        } catch (Exception e) {
            scheduleRetryOrDlq(command, e);
        }
    });
}
```

## 37.4 Lesson

```text
Sending more concurrently than provider capacity only creates timeout and retry load.
```

---

# 38. Mini Case Study: Case Import Pipeline

## 38.1 Pipeline

```text
read CSV -> parse -> validate -> enrich -> persist
```

## 38.2 Bottlenecks

- parse = CPU;
- enrich = HTTP;
- persist = DB.

## 38.3 Design

- parse stage bounded CPU;
- enrich stage semaphore per HTTP API;
- persist stage DB bulkhead;
- bounded queues between stages;
- DLQ invalid rows;
- checkpoint progress.

## 38.4 Lesson

```text
Each pipeline stage needs capacity matching its bottleneck.
```

---

# 39. Mini Case Study: Downstream API Bulkhead

## 39.1 Problem

Dashboard calls document API. Document API slows down.

Without bulkhead:

- many requests stuck;
- virtual threads pile up;
- retries increase;
- other features suffer.

## 39.2 Fix

```java
Bulkhead documentBulkhead = new Bulkhead(50);

Document doc = documentBulkhead.call(
    () -> documentClient.load(id, context.remaining()),
    Duration.ofMillis(20)
);
```

Fallback:

```text
show dashboard without document preview
```

## 39.3 Lesson

```text
Bulkhead plus fallback turns downstream slowness into controlled degradation.
```

---

# 40. Common Anti-Patterns

## 40.1 Unbounded queue

Memory failure.

## 40.2 No full-queue policy

Producer stuck forever.

## 40.3 Single global bulkhead

One dependency starves all.

## 40.4 Retry without backoff/jitter

Retry storm.

## 40.5 Poison message infinite retry

Queue starvation.

## 40.6 Virtual threads without in-flight limit

Resource overload.

## 40.7 Same executor for CPU and blocking I/O

Starvation.

## 40.8 Ignoring ordering semantics

Parallel consumers break order.

## 40.9 No shutdown protocol

Consumers stuck.

## 40.10 Metrics only at request level

Bottleneck hidden.

---

# 41. Best Practices

## 41.1 Bound queues

Avoid unbounded memory.

## 41.2 Use timed offer

Avoid producer waiting forever.

## 41.3 Define rejection policy

Reject, drop, block, coalesce, durable queue.

## 41.4 Use per-dependency bulkheads

Protect critical paths.

## 41.5 Add retry budget

Backoff and jitter.

## 41.6 Treat poison messages explicitly

DLQ after bounded attempts.

## 41.7 Separate bottlenecks

CPU, DB, HTTP each needs own control.

## 41.8 Use virtual threads with semaphores

Cheap threads plus explicit resource limits.

## 41.9 Test overload

Full queue, slow consumer, dependency outage.

## 41.10 Observe queues and permits

Metrics at boundaries.

---

# 42. Decision Matrix

| Scenario | Recommended |
|---|---|
| Producer can outpace consumer | bounded BlockingQueue |
| Request work has deadline | timed offer or reject |
| Work must not be lost | durable queue/job table |
| Provider max concurrent calls | Semaphore bulkhead |
| Provider max rate | rate limiter |
| Provider failing | circuit breaker + retry budget |
| Rare burst acceptable | bounded queue |
| Telemetry can drop | drop/coalesce |
| Strict FIFO global order | single consumer or ordered processor |
| Per-key order | partitioned queues by key |
| CPU stage | bounded CPU executor |
| Blocking I/O stage | virtual threads + resource limit |
| Poison messages | max attempts + DLQ |
| Slow optional dependency | bulkhead + fallback |
| Multi-tenant fairness | per-tenant quota/bulkhead |

---

# 43. Latihan

## Latihan 1 — Bounded Queue

Buat producer-consumer dengan `ArrayBlockingQueue` dan `offer(timeout)`.

## Latihan 2 — Full Queue Policy

Implementasikan rejection saat queue penuh dan expose metric.

## Latihan 3 — Worker Shutdown

Implementasikan consumer loop dengan interrupt-based shutdown.

## Latihan 4 — Poison Pill

Implementasikan poison pill untuk 3 consumers.

## Latihan 5 — Pipeline

Desain pipeline `read -> parse -> validate -> persist` dengan bounded queues.

## Latihan 6 — Bulkhead

Buat `Bulkhead` berbasis `Semaphore` dengan timed acquire.

## Latihan 7 — Virtual Thread In-Flight Limit

Buat queue consumer yang menjalankan job di virtual thread tetapi membatasi max in-flight dengan semaphore.

## Latihan 8 — Retry Budget

Implementasikan retry dengan max attempts, exponential backoff, jitter, dan deadline.

## Latihan 9 — Poison Message

Desain DLQ policy untuk message yang gagal 5 kali.

## Latihan 10 — Observability

Buat dashboard metrics untuk queue, worker, bulkhead, retry, dan DLQ.

---

# 44. Ringkasan

Producer–consumer, pipeline, bulkhead, dan backpressure adalah pola utama untuk menjaga sistem concurrent tetap stabil.

Core lessons:

- Concurrency tanpa batas berubah menjadi overload.
- Producer–consumer menyelaraskan production rate dan consumption capacity.
- Queue harus bounded jika producer bisa lebih cepat dari consumer.
- Backpressure membuat overload terlihat di boundary.
- Load shedding/rejection sering lebih baik daripada queueing sampai timeout.
- Admission control mencegah work masuk jika kapasitas tidak cukup.
- BlockingQueue adalah primitive kuat untuk queue + coordination.
- Producer full-queue behavior harus sesuai business semantics.
- Consumer count harus mengikuti bottleneck.
- Pipeline memecah workflow menjadi stage dengan capacity sendiri.
- Stage isolation mencegah satu bottleneck mengganggu semua workflow.
- Fan-out menggandakan concurrency dan harus dihitung terhadap dependency limits.
- Ordering dan parallelism adalah trade-off.
- Bulkhead mengisolasi kapasitas per dependency/workload/tenant.
- Semaphore bulkhead membatasi in-flight operations.
- Backpressure, rate limiting, dan circuit breaking berbeda tetapi saling melengkapi.
- Retry adalah load tambahan dan harus dibudget.
- Poison messages harus keluar dari hot path lewat DLQ.
- Virtual threads mempermudah concurrency tetapi membuat in-flight limits makin penting.
- Observability harus ada di queue, worker, stage, retry, dan bulkhead boundary.

Main rule:

```text
A stable concurrent system does not only run work in parallel.
It controls how much work enters, where it waits,
how long it waits, what happens on overload,
and how each dependency is protected.
```

---

# 45. Referensi

1. Java SE 25 — `BlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html

2. Java SE 25 — `ArrayBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ArrayBlockingQueue.html

3. Java SE 25 — `LinkedBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/LinkedBlockingQueue.html

4. Java SE 25 — `SynchronousQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/SynchronousQueue.html

5. Java SE 25 — `PriorityBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/PriorityBlockingQueue.html

6. Java SE 25 — `DelayQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/DelayQueue.html

7. Java SE 25 — `Semaphore`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html

8. Java SE 25 — `ExecutorService`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html

9. Java SE 25 — `Executors.newVirtualThreadPerTaskExecutor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html#newVirtualThreadPerTaskExecutor()

10. OpenJDK JEP 444 — Virtual Threads  
    https://openjdk.org/jeps/444

11. Reactive Streams Specification  
    https://www.reactive-streams.org/

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-concurrency-and-reactive-part-020.md](./learn-java-concurrency-and-reactive-part-020.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-concurrency-and-reactive-part-022.md](./learn-java-concurrency-and-reactive-part-022.md)

</div>
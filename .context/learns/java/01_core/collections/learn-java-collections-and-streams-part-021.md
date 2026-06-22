# learn-java-collections-and-streams-part-021.md

# Java Collections and Streams — Part 021  
# Blocking Queues and Backpressure: Producer-Consumer, Bounded Capacity, Overload Control, Shutdown Protocols, Poison Pill, Timeouts, Fairness, and Production Diagnostics

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **021**  
> Fokus: memahami `BlockingQueue` bukan sekadar queue thread-safe, tetapi sebagai **coordination primitive** untuk producer-consumer, backpressure, overload protection, graceful shutdown, worker pipelines, dan bounded memory design.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: BlockingQueue adalah Buffer + Coordination Point](#2-mental-model-blockingqueue-adalah-buffer--coordination-point)
3. [Producer-Consumer Pattern](#3-producer-consumer-pattern)
4. [Backpressure](#4-backpressure)
5. [Kenapa Bounded Queue Penting](#5-kenapa-bounded-queue-penting)
6. [`Queue` vs `BlockingQueue`](#6-queue-vs-blockingqueue)
7. [Empat Keluarga Method BlockingQueue](#7-empat-keluarga-method-blockingqueue)
8. [`add`, `offer`, `put`, `offer(timeout)`](#8-add-offer-put-offertimeout)
9. [`remove`, `poll`, `take`, `poll(timeout)`](#9-remove-poll-take-polltimeout)
10. [`element` and `peek`](#10-element-and-peek)
11. [Null Policy](#11-null-policy)
12. [Memory Consistency Effects](#12-memory-consistency-effects)
13. [`ArrayBlockingQueue`](#13-arrayblockingqueue)
14. [`LinkedBlockingQueue`](#14-linkedblockingqueue)
15. [`PriorityBlockingQueue`](#15-priorityblockingqueue)
16. [`DelayQueue`](#16-delayqueue)
17. [`SynchronousQueue`](#17-synchronousqueue)
18. [`LinkedTransferQueue`](#18-linkedtransferqueue)
19. [`LinkedBlockingDeque`](#19-linkedblockingdeque)
20. [Choosing Queue Capacity](#20-choosing-queue-capacity)
21. [Offer Timeout vs Put Forever](#21-offer-timeout-vs-put-forever)
22. [Reject, Drop, Retry, or Degrade](#22-reject-drop-retry-or-degrade)
23. [Poison Pill Shutdown](#23-poison-pill-shutdown)
24. [Interrupt-Based Shutdown](#24-interrupt-based-shutdown)
25. [Draining and Graceful Stop](#25-draining-and-graceful-stop)
26. [Worker Pool Pattern](#26-worker-pool-pattern)
27. [Pipeline Pattern](#27-pipeline-pattern)
28. [Priority and Delay Scheduling](#28-priority-and-delay-scheduling)
29. [Fairness](#29-fairness)
30. [Queue Size and Monitoring](#30-queue-size-and-monitoring)
31. [Queue Age: Metric yang Lebih Penting dari Size](#31-queue-age-metric-yang-lebih-penting-dari-size)
32. [Common Anti-Patterns](#32-common-anti-patterns)
33. [Performance Cost Model](#33-performance-cost-model)
34. [Testing BlockingQueue Code](#34-testing-blockingqueue-code)
35. [Production Diagnostics](#35-production-diagnostics)
36. [Production Failure Modes](#36-production-failure-modes)
37. [Best Practices](#37-best-practices)
38. [Decision Matrix](#38-decision-matrix)
39. [Latihan](#39-latihan)
40. [Ringkasan](#40-ringkasan)
41. [Referensi](#41-referensi)

---

# 1. Tujuan Bagian Ini

`BlockingQueue` sering dipahami sebagai:

```text
queue yang thread-safe dan bisa blocking
```

Benar, tapi belum cukup.

Dalam production system, `BlockingQueue` adalah salah satu primitive paling penting untuk:

- producer-consumer;
- worker pool;
- async processing;
- buffering;
- backpressure;
- overload control;
- graceful shutdown;
- bounded memory;
- retry/delay/priority queueing;
- coordination antar thread.

Tanpa queue yang benar, sistem mudah mengalami:

- out-of-memory karena producer lebih cepat dari consumer;
- thread hang karena `put`/`take` tanpa shutdown;
- latency tinggi karena backlog tidak dimonitor;
- data loss karena drop policy tidak jelas;
- starvation karena priority queue tanpa tie-breaker;
- shutdown tidak bersih karena poison pill salah;
- retry storm karena queue tidak bounded;
- hidden overload karena queue besar menutupi bottleneck.

Tujuan part ini:

- memahami `BlockingQueue` sebagai coordination primitive;
- memahami method families;
- memahami backpressure;
- memahami queue implementation trade-offs;
- memahami shutdown protocol;
- memahami monitoring dan diagnostics;
- tahu kapan memilih queue tertentu.

---

# 2. Mental Model: BlockingQueue adalah Buffer + Coordination Point

`BlockingQueue<E>` punya dua fungsi besar.

## 2.1 Buffer

Ia menyimpan work item sementara:

```text
producer -> [ queue ] -> consumer
```

## 2.2 Coordination point

Ia mengatur kapan producer/consumer harus menunggu:

- consumer menunggu saat queue kosong;
- producer menunggu saat queue penuh, jika bounded;
- producer bisa gagal cepat dengan `offer`;
- producer bisa timeout dengan `offer(timeout)`;
- consumer bisa timeout dengan `poll(timeout)`.

## 2.3 Critical insight

Queue bukan hanya struktur data.

Queue menentukan behavior sistem saat load tidak seimbang.

## 2.4 Main rule

```text
A blocking queue is where throughput mismatch becomes explicit.
```

---

# 3. Producer-Consumer Pattern

Producer membuat work.

Consumer memproses work.

```java
BlockingQueue<Job> queue = new ArrayBlockingQueue<>(1000);
```

Producer:

```java
queue.put(job);
```

Consumer:

```java
while (true) {
    Job job = queue.take();
    process(job);
}
```

## 3.1 Why queue helps

Producer and consumer do not need to run at same speed every millisecond.

Queue absorbs short bursts.

## 3.2 But queue is not magic

If producer is consistently faster than consumer:

```text
queue fills up
latency increases
memory grows if unbounded
producer blocks or drops if bounded
```

## 3.3 Rule

Queue handles burst. It does not eliminate capacity planning.

---

# 4. Backpressure

Backpressure means downstream overload pushes signal upstream.

## 4.1 Without backpressure

Producer keeps accepting work.

Queue grows.

Eventually:

- heap grows;
- GC worsens;
- latency explodes;
- OOM occurs.

## 4.2 With backpressure

Bounded queue limits backlog.

When full, producer must:

- block;
- timeout;
- reject;
- drop;
- degrade;
- route elsewhere.

## 4.3 Example

```java
boolean accepted = queue.offer(job, 100, TimeUnit.MILLISECONDS);
if (!accepted) {
    throw new ServiceUnavailableException("worker queue full");
}
```

## 4.4 Rule

Backpressure is how a system says “I cannot accept unlimited work.”

---

# 5. Kenapa Bounded Queue Penting

Unbounded queue looks convenient.

```java
BlockingQueue<Job> queue = new LinkedBlockingQueue<>();
```

But it can hide overload.

## 5.1 Problem

If producer rate > consumer rate:

```text
queue grows indefinitely
```

until memory pressure or OOM.

## 5.2 Bounded queue makes overload visible

```java
BlockingQueue<Job> queue = new ArrayBlockingQueue<>(1000);
```

Now overload appears as:

- `offer` returns false;
- `put` blocks;
- timeout;
- rejection metric.

## 5.3 Bounded queue is capacity contract

It says:

```text
This subsystem can buffer at most N work items.
```

## 5.4 Rule

Prefer bounded queues unless you have a strong reason and monitoring for unbounded growth.

---

# 6. `Queue` vs `BlockingQueue`

`Queue` provides non-blocking queue operations.

Examples:

```java
offer
poll
peek
```

`BlockingQueue` extends Queue with waiting operations.

Examples:

```java
put
take
offer(timeout)
poll(timeout)
```

## 6.1 Queue empty

`poll()` returns null if empty.

## 6.2 BlockingQueue empty

`take()` waits until element available.

## 6.3 BlockingQueue full

For bounded queue:

```java
put()` waits until space available.
```

## 6.4 Rule

Use `BlockingQueue` when waiting for work/space is part of concurrency design.

---

# 7. Empat Keluarga Method BlockingQueue

BlockingQueue methods come in four styles:

| Operation type | Throws exception | Special value | Blocks | Times out |
|---|---|---|---|---|
| insert | `add(e)` | `offer(e)` | `put(e)` | `offer(e, time, unit)` |
| remove | `remove()` | `poll()` | `take()` | `poll(time, unit)` |
| examine | `element()` | `peek()` | n/a | n/a |

## 7.1 Throws exception

Good when failure is programming error.

## 7.2 Special value

Good for non-blocking decision.

## 7.3 Blocks

Good for worker loop, but must support shutdown.

## 7.4 Times out

Good for graceful overload or periodic shutdown checks.

## 7.5 Rule

Choose method family intentionally; it defines overload behavior.

---

# 8. `add`, `offer`, `put`, `offer(timeout)`

## 8.1 `add(e)`

Throws if cannot insert immediately.

Rarely best for bounded queues in production overload path.

## 8.2 `offer(e)`

Returns false if cannot insert immediately.

```java
if (!queue.offer(job)) {
    reject(job);
}
```

## 8.3 `put(e)`

Blocks until space available.

```java
queue.put(job);
```

Danger: can block forever if consumers stopped.

## 8.4 `offer(e, timeout, unit)`

Waits up to timeout.

```java
if (!queue.offer(job, 200, TimeUnit.MILLISECONDS)) {
    reject(job);
}
```

Often better for request-handling threads.

## 8.5 Rule

For external request path, prefer `offer(timeout)` or `offer` over unbounded `put`.

---

# 9. `remove`, `poll`, `take`, `poll(timeout)`

## 9.1 `remove()`

Throws if queue empty.

## 9.2 `poll()`

Returns null if empty.

```java
Job job = queue.poll();
```

## 9.3 `take()`

Blocks until item available.

```java
Job job = queue.take();
```

Common worker loop method.

## 9.4 `poll(timeout)`

Waits up to timeout then returns null.

Useful for shutdown checks:

```java
while (running || !queue.isEmpty()) {
    Job job = queue.poll(500, TimeUnit.MILLISECONDS);
    if (job != null) {
        process(job);
    }
}
```

## 9.5 Rule

Use `take` for simple always-running workers; use `poll(timeout)` when lifecycle checks matter.

---

# 10. `element` and `peek`

## 10.1 `element()`

Retrieves head but does not remove. Throws if empty.

## 10.2 `peek()`

Retrieves head but does not remove. Returns null if empty.

## 10.3 Use carefully

Peeking in concurrent queues is only observation; another consumer can remove later.

## 10.4 Rule

Do not build correctness logic on peek in multi-consumer systems.

---

# 11. Null Policy

BlockingQueue implementations do not permit null elements.

## 11.1 Why

`poll()` uses null as special value for empty.

If null elements were allowed:

```text
poll returns null
```

would be ambiguous.

## 11.2 Poison pill must not be null

Bad:

```java
queue.put(null);
```

Good:

```java
queue.put(Job.stop());
```

## 11.3 Rule

Use explicit sentinel/domain object, never null, for control messages.

---

# 12. Memory Consistency Effects

BlockingQueue provides useful memory consistency effects.

## 12.1 Meaning

Actions in a thread before placing object into BlockingQueue happen-before actions after another thread accesses/removes that element.

## 12.2 Good

```java
Job job = new Job(data);
queue.put(job);

// consumer
Job job = queue.take();
process(job);
```

The job is safely published through the queue.

## 12.3 But mutable object after enqueue

If producer mutates job after enqueue without synchronization, race can still happen.

## 12.4 Rule

Enqueue immutable or effectively immutable work items.

---

# 13. `ArrayBlockingQueue`

Bounded FIFO blocking queue backed by array.

## 13.1 Properties

- fixed capacity;
- FIFO;
- array-based;
- optional fairness policy;
- no null;
- good bounded memory behavior.

## 13.2 Constructor

```java
BlockingQueue<Job> queue = new ArrayBlockingQueue<>(1000);
```

Fairness:

```java
new ArrayBlockingQueue<>(1000, true);
```

## 13.3 Strengths

- predictable capacity;
- no node allocation per item;
- good for backpressure;
- compact.

## 13.4 Weaknesses

- fixed capacity cannot grow;
- producers/consumers coordinate through internal locking;
- fairness may reduce throughput.

## 13.5 Use cases

- worker pool queue;
- bounded async processing;
- overload-protected subsystem.

## 13.6 Rule

Use ArrayBlockingQueue when bounded capacity and predictable memory are important.

---

# 14. `LinkedBlockingQueue`

Optionally bounded FIFO blocking queue based on linked nodes.

## 14.1 Constructor

Unbounded-like:

```java
new LinkedBlockingQueue<Job>();
```

Bounded:

```java
new LinkedBlockingQueue<Job>(1000);
```

## 14.2 Strengths

- optionally bounded;
- FIFO;
- can have high throughput for producer-consumer;
- capacity can be specified.

## 14.3 Weaknesses

- unbounded default can cause OOM;
- node allocation per element;
- memory overhead higher than array queue.

## 14.4 Use cases

- producer-consumer when linked structure acceptable;
- executor queues;
- bounded buffering with dynamic node allocation.

## 14.5 Rule

If using LinkedBlockingQueue, almost always specify capacity.

---

# 15. `PriorityBlockingQueue`

Unbounded blocking priority queue.

## 15.1 Ordering

Elements ordered by natural ordering or Comparator.

## 15.2 Blocking behavior

Retrieval blocks when empty.

Insertion does not block for capacity because logically unbounded.

## 15.3 Danger

No backpressure by capacity.

Additions can fail only by resource exhaustion.

## 15.4 Equal priority

No FIFO guarantee for equal priority unless you include sequence number.

## 15.5 Use cases

- prioritized jobs;
- urgent vs normal work;
- priority scheduling.

## 15.6 Rule

PriorityBlockingQueue gives priority, not bounded overload control.

---

# 16. `DelayQueue`

Queue of delayed elements.

## 16.1 Element requirement

Elements implement `Delayed`.

## 16.2 Retrieval

Element becomes available only after delay expires.

```java
DelayedTask task = queue.take();
```

## 16.3 Use cases

- retry after delay;
- timeout tasks;
- scheduled expiration;
- debounce-like processing.

## 16.4 Weaknesses

- not full scheduler replacement;
- delay ordering must be correct;
- unbounded nature needs monitoring.

## 16.5 Rule

Use DelayQueue when availability time is part of queue semantics.

---

# 17. `SynchronousQueue`

A queue with no internal capacity.

## 17.1 Mental model

It is not a buffer.

It is a handoff point.

```text
producer waits for consumer
consumer waits for producer
```

## 17.2 No capacity

Not even capacity one.

## 17.3 Use cases

- direct handoff;
- thread pool designs;
- rendezvous;
- zero-buffer backpressure.

## 17.4 Difference from ArrayBlockingQueue(1)

Capacity one queue can store one item.

SynchronousQueue stores none.

## 17.5 Rule

Use SynchronousQueue when work should be accepted only if a consumer is ready.

---

# 18. `LinkedTransferQueue`

A transfer queue supports producer handoff semantics.

## 18.1 transfer

Producer can wait until consumer receives element.

```java
queue.transfer(item);
```

## 18.2 tryTransfer

Try immediate handoff.

## 18.3 Use cases

- hybrid queue/handoff;
- high-throughput producer-consumer;
- direct consumer availability semantics.

## 18.4 Rule

Use LinkedTransferQueue when producer needs to know whether work was actually received.

---

# 19. `LinkedBlockingDeque`

Blocking double-ended queue.

## 19.1 Supports both ends

- putFirst/takeFirst;
- putLast/takeLast.

## 19.2 Use cases

- work stealing-ish designs;
- deque-style pipelines;
- LIFO/FIFO hybrid.

## 19.3 More complex semantics

Most producer-consumer systems do not need deque.

## 19.4 Rule

Use BlockingDeque when both-end blocking operations are part of design.

---

# 20. Choosing Queue Capacity

Capacity should reflect system design.

## 20.1 Too small

- frequent rejection;
- underutilized consumers;
- poor burst absorption.

## 20.2 Too large

- hides overload;
- increases latency;
- increases memory usage;
- delays failure;
- makes shutdown/drain longer.

## 20.3 Capacity formula intuition

Think:

```text
capacity ≈ acceptable backlog duration × consumer throughput
```

Example:

```text
consumer throughput = 100 jobs/sec
acceptable backlog = 10 sec
capacity ≈ 1000 jobs
```

## 20.4 Include memory per job

If each job holds 1MB, capacity 1000 means up to 1GB referenced.

## 20.5 Rule

Queue capacity is latency and memory policy, not arbitrary number.

---

# 21. Offer Timeout vs Put Forever

## 21.1 `put` forever

Good for internal worker coordination where blocking is acceptable and shutdown is handled.

Bad for request threads.

## 21.2 `offer(timeout)`

Better for bounded latency:

```java
if (!queue.offer(job, 100, TimeUnit.MILLISECONDS)) {
    return overloaded();
}
```

## 21.3 Timeout as overload signal

Timeout should increment metric.

## 21.4 Rule

Never block request-handling threads indefinitely on queue insertion.

---

# 22. Reject, Drop, Retry, or Degrade

When queue full, decide policy.

## 22.1 Reject

Return 429/503 or domain error.

Good for external APIs.

## 22.2 Drop

Useful for lossy telemetry or best-effort events.

## 22.3 Retry

Dangerous if retry storm.

Use backoff and jitter.

## 22.4 Degrade

Do cheaper work or skip optional processing.

## 22.5 Block

Good only if caller can safely wait.

## 22.6 Rule

Full queue behavior must be explicit and observable.

---

# 23. Poison Pill Shutdown

Poison pill is special item indicating stop.

## 23.1 Example

```java
sealed interface WorkItem permits Job, Stop {}

record Job(String id) implements WorkItem {}
enum Stop implements WorkItem {
    INSTANCE
}
```

Consumer:

```java
while (true) {
    WorkItem item = queue.take();
    if (item == Stop.INSTANCE) {
        break;
    }
    process((Job) item);
}
```

## 23.2 Multiple consumers

Need one poison pill per consumer, or a broadcast shutdown mechanism.

## 23.3 Ordering

Poison pill goes through queue order.

If you enqueue poison pill before all jobs, later jobs may remain.

## 23.4 Rule

Poison pill is data-plane shutdown; design count and ordering carefully.

---

# 24. Interrupt-Based Shutdown

Blocking methods throw `InterruptedException`.

## 24.1 Worker loop

```java
try {
    while (!Thread.currentThread().isInterrupted()) {
        Job job = queue.take();
        process(job);
    }
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
}
```

## 24.2 Restore interrupt

Always restore interrupt if you catch and do not fully handle it.

## 24.3 Interrupt vs poison

- interrupt is control-plane;
- poison pill is data-plane.

## 24.4 Rule

Handle `InterruptedException` as lifecycle signal, not noise.

---

# 25. Draining and Graceful Stop

Sometimes shutdown should process remaining queue.

## 25.1 Stop accepting

First stop producers.

## 25.2 Drain queue

Consumers continue until queue empty.

## 25.3 Use poll timeout

```java
while (running || !queue.isEmpty()) {
    Job job = queue.poll(500, TimeUnit.MILLISECONDS);
    if (job != null) {
        process(job);
    }
}
```

## 25.4 Race caution

`isEmpty` can race if producers still active.

Stop producers first.

## 25.5 Rule

Graceful drain requires producer lifecycle coordination.

---

# 26. Worker Pool Pattern

## 26.1 Structure

```text
producer(s) -> bounded queue -> worker threads
```

## 26.2 Worker

```java
while (running) {
    Job job = queue.take();
    process(job);
}
```

## 26.3 Metrics

- queue depth;
- enqueue failures;
- worker utilization;
- processing time;
- oldest item age.

## 26.4 Backpressure

Bounded queue protects worker subsystem.

## 26.5 Rule

Worker pool without bounded queue is often hidden overload.

---

# 27. Pipeline Pattern

Multiple stages:

```text
ingest -> queue A -> validate -> queue B -> persist -> queue C -> notify
```

## 27.1 Benefit

Stages decouple work.

## 27.2 Risk

Each queue adds latency and memory.

## 27.3 Backpressure propagation

If later stage slows, upstream queues fill.

## 27.4 Rule

Pipeline queues must have capacity and metrics per stage.

---

# 28. Priority and Delay Scheduling

## 28.1 Priority

Use PriorityBlockingQueue when priority determines order.

Need tie-breaker:

```java
record PrioritizedJob(int priority, long sequence, Job job) {}
```

Comparator:

```java
Comparator.comparingInt(PrioritizedJob::priority)
          .thenComparingLong(PrioritizedJob::sequence)
```

## 28.2 Delay

Use DelayQueue when not-before time matters.

## 28.3 Rule

Priority and delay queues solve ordering, not capacity by default.

---

# 29. Fairness

Some blocking queues support fairness option.

## 29.1 What fairness means

Waiting producers/consumers served in FIFO-ish order.

## 29.2 Cost

Fairness can reduce throughput.

## 29.3 When use

- starvation concern;
- predictable scheduling more important than throughput.

## 29.4 Rule

Do not enable fairness by default; measure and justify.

---

# 30. Queue Size and Monitoring

Queue size is useful but not enough.

## 30.1 Metrics

- current size;
- remaining capacity;
- enqueue rate;
- dequeue rate;
- rejection count;
- timeout count;
- processing latency;
- oldest item age.

## 30.2 `size()` under concurrency

May be approximate or changing immediately.

Use it for monitoring, not exact control.

## 30.3 Rule

Queue metrics should reveal overload before users complain.

---

# 31. Queue Age: Metric yang Lebih Penting dari Size

Queue size tells how many.

Queue age tells how long work waits.

## 31.1 Example

Queue size 100 may be fine if processing fast.

Queue size 10 may be bad if oldest item waits 5 minutes.

## 31.2 Add enqueue timestamp

```java
record QueuedJob(Job job, Instant enqueuedAt) {}
```

## 31.3 Monitor oldest age

Track:

```text
now - oldest.enqueuedAt
```

## 31.4 Rule

For user-impact latency, queue age is often more important than queue size.

---

# 32. Common Anti-Patterns

## 32.1 Unbounded queue by default

```java
new LinkedBlockingQueue<>()
```

without capacity.

## 32.2 Using `put` in request thread

Can block indefinitely.

## 32.3 Ignoring InterruptedException

Breaks shutdown.

## 32.4 Null poison pill

Not allowed and semantically bad.

## 32.5 Relying on size for correctness

Race-prone.

## 32.6 No full-queue policy

System behavior undefined under overload.

## 32.7 Poison pill count wrong

Some workers never stop.

## 32.8 Priority queue without tie-breaker

Equal-priority ordering unstable.

## 32.9 Queue as database

Large durable work should not rely only on memory queue.

## 32.10 Rule

Queue mistakes often only appear under overload/shutdown.

---

# 33. Performance Cost Model

## 33.1 ArrayBlockingQueue

- fixed array;
- no node allocation;
- bounded;
- lock/condition coordination.

## 33.2 LinkedBlockingQueue

- linked node per item;
- optional capacity;
- more allocation;
- useful for dynamic buffering.

## 33.3 PriorityBlockingQueue

- heap operations O(log n);
- unbounded;
- comparator cost.

## 33.4 DelayQueue

- delay ordering;
- time checks;
- unbounded.

## 33.5 SynchronousQueue

- zero buffering;
- handoff cost;
- strong backpressure.

## 33.6 Rule

Queue performance depends on capacity, producer/consumer ratio, item cost, contention, and blocking frequency.

---

# 34. Testing BlockingQueue Code

## 34.1 Test full queue behavior

Use small capacity.

```java
new ArrayBlockingQueue<>(1)
```

## 34.2 Test timeout

Ensure producer rejects/degrades after timeout.

## 34.3 Test shutdown

- poison pill count;
- interrupt handling;
- drain behavior.

## 34.4 Test ordering

FIFO, priority, delay.

## 34.5 Avoid flaky sleeps

Use latches/barriers/timeouts.

## 34.6 Rule

BlockingQueue tests must cover overload and shutdown, not only happy path.

---

# 35. Production Diagnostics

## 35.1 Symptoms

- rising queue depth;
- rising queue age;
- producer timeouts;
- worker idle or saturated;
- GC pressure;
- OOM;
- stuck threads in `put` or `take`;
- shutdown hangs.

## 35.2 Thread dump

Look for threads blocked in:

```text
BlockingQueue.put
BlockingQueue.take
Condition.await
```

## 35.3 Metrics questions

- Are producers faster than consumers?
- Is capacity too small or consumer too slow?
- Are workers blocked on downstream dependency?
- Is queue unbounded?
- Is oldest age increasing?
- Are poison pills delivered?

## 35.4 Rule

Queue backlog is a symptom; diagnose downstream throughput.

---

# 36. Production Failure Modes

## 36.1 Unbounded LinkedBlockingQueue OOM

Fix: specify capacity and overload policy.

## 36.2 Request thread stuck on put

Fix: offer timeout or rejection.

## 36.3 Worker never exits

Fix: interrupt handling or poison pill count.

## 36.4 Poison pill before jobs

Fix: stop producers, drain, then send stop signals.

## 36.5 Priority starvation

Fix: aging/fairness/tie-breaker/multiple queues.

## 36.6 DelayQueue retry storm

Fix: exponential backoff, jitter, max attempts.

## 36.7 Full queue ignored

Fix: metrics and explicit policy.

## 36.8 Mutable job modified after enqueue

Fix: immutable job payload.

## 36.9 size-based decision race

Fix: use queue operation result.

## 36.10 Lost interrupt

Fix: restore interrupt.

## 36.11 Queue hides downstream outage

Fix: queue age alerts and circuit breaker.

## 36.12 Too-large queue creates latency

Fix: capacity by latency budget.

---

# 37. Best Practices

## 37.1 Capacity

- Prefer bounded queues.
- Choose capacity from latency and memory budget.
- Monitor remaining capacity and rejection.

## 37.2 Producer behavior

- Prefer `offer(timeout)` for request paths.
- Define full-queue policy.
- Do not block forever unless safe.

## 37.3 Consumer behavior

- Handle InterruptedException.
- Use poison pill or interrupt consistently.
- Record processing latency.

## 37.4 Payload

- Use immutable work items.
- Do not use null.
- Include enqueue timestamp for monitoring.

## 37.5 Operations

- Do not rely on `size()` for correctness.
- Use queue operation outcomes.
- Use bounded retry/backoff.

## 37.6 Monitoring

- queue depth;
- oldest age;
- enqueue/dequeue rate;
- timeout/rejection count;
- processing latency;
- worker health.

---

# 38. Decision Matrix

| Need | Recommended |
|---|---|
| bounded FIFO worker queue | `ArrayBlockingQueue` |
| optionally bounded FIFO linked queue | `LinkedBlockingQueue(capacity)` |
| unbounded FIFO with blocking retrieval | `LinkedBlockingQueue` only with strong reason |
| priority work | `PriorityBlockingQueue` + tie-breaker |
| delayed retry | `DelayQueue` |
| direct handoff, no buffering | `SynchronousQueue` |
| transfer semantics | `LinkedTransferQueue` |
| deque blocking both ends | `LinkedBlockingDeque` |
| request path enqueue | `offer(timeout)` |
| internal worker enqueue | `put` if shutdown safe |
| overload policy | reject/drop/retry/degrade explicitly |
| graceful stop | stop producers, drain, poison/interrupt |
| exact ordering with equal priority | add sequence number |
| backpressure required | bounded queue |
| durable work | database/message broker, not in-memory queue only |

---

# 39. Latihan

## Latihan 1 — Bounded Producer-Consumer

Implement producer-consumer using `ArrayBlockingQueue<>(10)`.

Observe producer blocking/full behavior.

## Latihan 2 — Offer Timeout

Use:

```java
queue.offer(job, 100, TimeUnit.MILLISECONDS)
```

Return rejection when full.

## Latihan 3 — Poison Pill

Implement 3 consumers and graceful shutdown with one poison pill per consumer.

## Latihan 4 — Interrupt Shutdown

Implement consumer loop with `take()` and correct interrupt restoration.

## Latihan 5 — Queue Age Metric

Wrap job with enqueue timestamp and measure wait time before processing.

## Latihan 6 — Priority Tie-Breaker

Create `PriorityBlockingQueue` with priority + sequence.

Show stable ordering for equal priority.

## Latihan 7 — DelayQueue Retry

Implement delayed retry job with attempt count and exponential backoff.

## Latihan 8 — Unbounded Queue OOM Thought Experiment

Calculate memory risk if job payload is 200KB and queue grows to 100_000.

## Latihan 9 — Pipeline

Build two-stage pipeline with queue A and queue B.

Add metrics per queue.

## Latihan 10 — Shutdown Race

Show why checking `queue.isEmpty()` is unsafe while producers still running.

---

# 40. Ringkasan

Blocking queues are production coordination primitives.

Core lessons:

- BlockingQueue is buffer + coordination point.
- It is designed mainly for producer-consumer.
- Bounded queues provide backpressure.
- Unbounded queues can hide overload and cause OOM.
- Method family defines overload behavior.
- `put` can block forever; `offer(timeout)` is safer for request paths.
- `take` blocks; `poll(timeout)` helps lifecycle checks.
- Null elements are not allowed.
- Use explicit poison pill, not null.
- Memory consistency effects safely publish enqueued objects.
- Use immutable work items.
- ArrayBlockingQueue is fixed bounded array FIFO.
- LinkedBlockingQueue should usually be bounded explicitly.
- PriorityBlockingQueue and DelayQueue are unbounded ordering queues.
- SynchronousQueue is zero-capacity handoff.
- Queue capacity is latency/memory policy.
- Monitor queue age, not only size.
- Shutdown protocol must be designed.
- Full queue policy must be explicit.

Main rule:

```text
A queue is not just where work waits.
It is where overload, latency, memory, and lifecycle policy become real.
```

---

# 41. Referensi

1. Java SE 25 — `BlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html

2. Java SE 25 — `Queue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Queue.html

3. Java SE 25 — `ArrayBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ArrayBlockingQueue.html

4. Java SE 25 — `LinkedBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/LinkedBlockingQueue.html

5. Java SE 25 — `PriorityBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/PriorityBlockingQueue.html

6. Java SE 25 — `DelayQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/DelayQueue.html

7. Java SE 25 — `SynchronousQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/SynchronousQueue.html

8. Java SE 25 — `LinkedTransferQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/LinkedTransferQueue.html

9. Java SE 25 — `LinkedBlockingDeque`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/LinkedBlockingDeque.html

10. Java SE 25 — `java.util.concurrent` Package Summary  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/package-summary.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-collections-and-streams-part-020.md">⬅️ Java Collections and Streams — Part 020</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-collections-and-streams-part-022.md">Java Collections and Streams — Part 022 ➡️</a>
</div>

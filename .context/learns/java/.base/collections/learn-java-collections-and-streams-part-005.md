# learn-java-collections-and-streams-part-005.md

# Java Collections and Streams — Part 005  
# Queue and Deque Deep Dive: FIFO, LIFO, ArrayDeque, PriorityQueue, BlockingQueue, Backpressure, Producer-Consumer, dan Work Processing

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **005**  
> Fokus: memahami `Queue` dan `Deque` sebagai **processing-order data structures**, bukan sekadar collection biasa. Kita akan membedah FIFO/LIFO, `Queue`, `Deque`, `ArrayDeque`, `PriorityQueue`, `BlockingQueue`, bounded vs unbounded queues, backpressure, producer-consumer, poison pill, delay/priority queues, concurrency concerns, memory risk, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Queue adalah Waiting Room untuk Processing](#2-mental-model-queue-adalah-waiting-room-untuk-processing)
3. [`Queue<E>` Contract](#3-queuee-contract)
4. [Queue Method Families: Exception vs Special Value](#4-queue-method-families-exception-vs-special-value)
5. [Kapan `Queue` Tepat](#5-kapan-queue-tepat)
6. [Kapan `Queue` adalah Smell](#6-kapan-queue-adalah-smell)
7. [`Deque<E>` Contract](#7-dequee-contract)
8. [Deque Method Families](#8-deque-method-families)
9. [Stack with Deque, Not `Stack`](#9-stack-with-deque-not-stack)
10. [`ArrayDeque` Mental Model](#10-arraydeque-mental-model)
11. [`ArrayDeque` Operation Cost and Use Cases](#11-arraydeque-operation-cost-and-use-cases)
12. [`LinkedList` as Queue/Deque: Why Usually Not Default](#12-linkedlist-as-queuedeque-why-usually-not-default)
13. [`PriorityQueue` Mental Model](#13-priorityqueue-mental-model)
14. [PriorityQueue Pitfalls](#14-priorityqueue-pitfalls)
15. [`BlockingQueue` Mental Model](#15-blockingqueue-mental-model)
16. [Bounded vs Unbounded Queues](#16-bounded-vs-unbounded-queues)
17. [`ArrayBlockingQueue`](#17-arrayblockingqueue)
18. [`LinkedBlockingQueue`](#18-linkedblockingqueue)
19. [`PriorityBlockingQueue`](#19-priorityblockingqueue)
20. [`DelayQueue`](#20-delayqueue)
21. [`SynchronousQueue`](#21-synchronousqueue)
22. [Producer-Consumer Pattern](#22-producer-consumer-pattern)
23. [Backpressure](#23-backpressure)
24. [Poison Pill and Shutdown](#24-poison-pill-and-shutdown)
25. [Timeouts and Cancellation](#25-timeouts-and-cancellation)
26. [Queue Size, Monitoring, and Operational Signals](#26-queue-size-monitoring-and-operational-signals)
27. [Queues and Executors](#27-queues-and-executors)
28. [Queues and Streams](#28-queues-and-streams)
29. [Queues in Domain Modeling](#29-queues-in-domain-modeling)
30. [Queues in API/DB/Event Boundaries](#30-queues-in-apidbevent-boundaries)
31. [Concurrency and Memory Model](#31-concurrency-and-memory-model)
32. [Performance and Memory Cost Model](#32-performance-and-memory-cost-model)
33. [Production Failure Modes](#33-production-failure-modes)
34. [Best Practices](#34-best-practices)
35. [Decision Matrix](#35-decision-matrix)
36. [Latihan](#36-latihan)
37. [Ringkasan](#37-ringkasan)
38. [Referensi](#38-referensi)

---

# 1. Tujuan Bagian Ini

Setelah `List`, `Set`, dan `Map`, sekarang kita masuk ke collection yang meaning-nya sangat berbeda:

```text
Queue / Deque = data menunggu diproses menurut policy tertentu.
```

`Queue` bukan sekadar “list yang diproses dari depan”.

Queue membawa pertanyaan production:

```text
Siapa producer?
Siapa consumer?
Apakah queue bounded?
Apa yang terjadi saat penuh?
Apa yang terjadi saat kosong?
Apakah producer harus block?
Apakah item boleh hilang?
Apakah order FIFO?
Apakah priority?
Apakah delay?
Apakah concurrent?
Apakah queue bisa tumbuh sampai OOM?
Bagaimana shutdown?
Bagaimana monitoring backlog?
```

Tujuan bagian ini:

- memahami `Queue` dan `Deque` sebagai processing-order contract;
- memahami method family yang return special value vs throw exception;
- memahami `ArrayDeque`, `PriorityQueue`, `BlockingQueue`;
- memahami bounded/unbounded dan backpressure;
- memahami producer-consumer pattern;
- memahami queue dalam executors, event processing, retry, scheduling;
- mengenali production failure modes.

---

# 2. Mental Model: Queue adalah Waiting Room untuk Processing

Queue biasanya merepresentasikan:

```text
Elements waiting to be processed.
```

Contoh:

```java
Queue<Job> jobs;
Queue<Event> events;
Queue<NodeId> bfsQueue;
BlockingQueue<Task> workQueue;
```

Core operation:

```text
enqueue -> wait -> dequeue -> process
```

## 2.1 Queue answers “what next?”

List answers:

```text
What is at index i?
```

Set answers:

```text
Is this member present?
```

Map answers:

```text
What value for key?
```

Queue answers:

```text
What should be processed next?
```

## 2.2 Queue has policy

Queue does not always mean FIFO.

Possible policies:

- FIFO;
- priority;
- delay;
- handoff;
- bounded blocking;
- non-blocking;
- concurrent.

## 2.3 Queue as buffer

Queue often decouples producer and consumer speed.

```text
Producer faster than consumer -> queue grows
Consumer faster than producer -> consumer waits/idle
```

## 2.4 Production risk

A queue without bounds can become memory leak under load.

## 2.5 Rule

```text
Queue design is load management design.
```

---

# 3. `Queue<E>` Contract

Java SE `Queue` is designed for holding elements before processing. Besides basic `Collection` operations, queues provide insertion, extraction, and inspection operations.

## 3.1 Core semantic

```java
Queue<E>
```

means:

```text
Elements are ordered according to queue policy for processing.
```

## 3.2 Not necessarily FIFO

Common queues are FIFO, but `PriorityQueue` orders by priority.

## 3.3 Queue does not define blocking methods

Blocking behavior belongs to:

```java
BlockingQueue<E>
```

which extends Queue.

## 3.4 Null policy

Queue implementations generally do not allow null, because null is used as special return value by methods like `poll`.

But this depends on implementation; avoid null queue elements.

## 3.5 Queue extends Collection

But collection operations like `contains`/iteration may not be the main purpose.

## 3.6 Rule

Use Queue when processing order, not random access, is the main concept.

---

# 4. Queue Method Families: Exception vs Special Value

Queue has paired operations.

## 4.1 Insertion

Throws exception if cannot insert:

```java
boolean add(E e)
```

Returns special value if cannot insert:

```java
boolean offer(E e)
```

## 4.2 Removal

Throws exception if empty:

```java
E remove()
```

Returns special value if empty:

```java
E poll()
```

## 4.3 Inspection

Throws exception if empty:

```java
E element()
```

Returns special value if empty:

```java
E peek()
```

## 4.4 Practical preference

Use `offer`, `poll`, `peek` when empty/full are expected states.

Use exception variants when empty/full is programmer error or invariant violation.

## 4.5 Example

```java
Job job = queue.poll();
if (job != null) {
    process(job);
}
```

## 4.6 Bounded queue

For bounded queue:

```java
if (!queue.offer(job)) {
    rejectOrBackpressure(job);
}
```

## 4.7 Rule

Choose queue method based on whether failure is expected control flow or exceptional.

---

# 5. Kapan `Queue` Tepat

Use Queue when:

## 5.1 Work waiting to be processed

```java
Queue<Job> jobs;
```

## 5.2 BFS traversal

```java
Queue<NodeId> queue = new ArrayDeque<>();
```

## 5.3 Event buffer

```java
Queue<Event> pendingEvents;
```

## 5.4 Retry queue

```java
Queue<RetryTask> retryTasks;
```

## 5.5 Producer-consumer

```java
BlockingQueue<Task> workQueue;
```

## 5.6 Priority processing

```java
PriorityQueue<Job> jobsByPriority;
```

## 5.7 Scheduling delay

```java
DelayQueue<DelayedTask> delayedTasks;
```

## 5.8 Rule

If the primary operation is “take next item to process”, Queue is likely right.

---

# 6. Kapan `Queue` adalah Smell

## 6.1 Need random access

If you need `get(i)`, Queue is wrong.

Use List.

## 6.2 Need membership only

If you mainly ask contains, Set may be better.

## 6.3 Need lookup by ID

Use Map.

## 6.4 Need persistent business workflow

In-memory queue may lose data on crash.

Use DB/event broker/message queue.

## 6.5 Need unbounded buffering

Unbounded queue without pressure is dangerous.

## 6.6 Need audit ordering but no processing

List/SequencedCollection may be better.

## 6.7 Rule

Do not use in-memory queue to hide overload or replace durable messaging when durability is required.

---

# 7. `Deque<E>` Contract

`Deque` means double-ended queue.

Java SE `Deque` describes it as a linear collection supporting insertion and removal at both ends.

## 7.1 Meaning

```java
Deque<E>
```

says:

```text
I may add/remove/inspect at front and back.
```

## 7.2 Can be queue

FIFO:

```java
addLast
removeFirst
```

## 7.3 Can be stack

LIFO:

```java
push
pop
```

## 7.4 Can be sliding window

Add to tail, remove from head.

## 7.5 Can be undo/redo

Two deques or one deque with front/back semantics.

## 7.6 Rule

Use Deque when both ends matter or when you need stack/queue without legacy Stack.

---

# 8. Deque Method Families

## 8.1 Front insertion

Exception:

```java
addFirst(E e)
```

Special value:

```java
offerFirst(E e)
```

## 8.2 Back insertion

```java
addLast(E e)
offerLast(E e)
```

## 8.3 Front removal

```java
removeFirst()
pollFirst()
```

## 8.4 Back removal

```java
removeLast()
pollLast()
```

## 8.5 Front inspection

```java
getFirst()
peekFirst()
```

## 8.6 Back inspection

```java
getLast()
peekLast()
```

## 8.7 Stack aliases

```java
push(e) // addFirst
pop()   // removeFirst
```

## 8.8 Rule

For expected empty/full conditions, prefer `offer/poll/peek` variants.

---

# 9. Stack with Deque, Not `Stack`

Legacy `Stack` exists, but modern Java recommends Deque-style usage.

## 9.1 Bad modern default

```java
Stack<Node> stack = new Stack<>();
```

`Stack` extends Vector and carries legacy synchronized behavior.

## 9.2 Better

```java
Deque<Node> stack = new ArrayDeque<>();
stack.push(root);

while (!stack.isEmpty()) {
    Node node = stack.pop();
}
```

## 9.3 Benefits

- clearer Deque contract;
- often faster;
- no legacy Vector baggage;
- supports stack and queue operations.

## 9.4 Null

ArrayDeque does not permit null, which is usually good.

## 9.5 Rule

Use `ArrayDeque` as default stack implementation.

---

# 10. `ArrayDeque` Mental Model

Java SE `ArrayDeque` is a resizable-array implementation of `Deque`. It has no capacity restrictions, grows as needed, is not thread-safe, prohibits null elements, and is likely faster than `Stack` as stack and faster than `LinkedList` as queue.

Mental model:

```text
ArrayDeque = circular array buffer
```

Elements are stored in array with head/tail indexes.

```text
[ ][A][B][C][ ]
   ^head   ^tail
```

## 10.1 Add last

```java
deque.addLast(x)
```

places at tail and advances tail.

## 10.2 Remove first

```java
deque.removeFirst()
```

takes from head and advances head.

## 10.3 Circular wrap

Head/tail can wrap around internal array.

## 10.4 Growth

If full, it grows.

## 10.5 Null prohibited

This helps distinguish absence result from actual null element.

## 10.6 Rule

ArrayDeque is the default non-concurrent queue/stack/deque implementation.

---

# 11. `ArrayDeque` Operation Cost and Use Cases

## 11.1 Typical operations

| Operation | Cost mental model |
|---|---|
| addFirst/addLast | amortized fast |
| removeFirst/removeLast | fast |
| peekFirst/peekLast | fast |
| iteration | array-friendly |
| random access | not supported |
| contains | linear |

## 11.2 Use as FIFO queue

```java
Deque<Job> queue = new ArrayDeque<>();
queue.addLast(job);
Job next = queue.removeFirst();
```

## 11.3 Use as stack

```java
Deque<Node> stack = new ArrayDeque<>();
stack.push(root);
Node node = stack.pop();
```

## 11.4 Use as sliding window

```java
Deque<Event> window = new ArrayDeque<>();
window.addLast(event);
while (tooOld(window.peekFirst())) {
    window.removeFirst();
}
```

## 11.5 Not thread-safe

For multi-thread producer/consumer, use concurrent/blocking queue.

## 11.6 Rule

If you are using `LinkedList` as simple queue/stack, first ask why not `ArrayDeque`.

---

# 12. `LinkedList` as Queue/Deque: Why Usually Not Default

`LinkedList` implements `Deque`, so it can be used as queue/deque.

```java
Deque<Job> queue = new LinkedList<>();
```

But usually not default.

## 12.1 Costs

- node allocation per element;
- prev/next references;
- pointer chasing;
- worse cache locality;
- more GC pressure.

## 12.2 ArrayDeque often better

For non-concurrent queue/stack, ArrayDeque is usually faster and more memory efficient.

## 12.3 When LinkedList could be justified

- need List and Deque operations in same object;
- frequent iterator-position removals;
- specific measured workload.

## 12.4 Rule

Use LinkedList only with clear reason, not because “queue uses linked list in textbook”.

---

# 13. `PriorityQueue` Mental Model

`PriorityQueue` orders elements by priority, not insertion time.

## 13.1 Meaning

```java
PriorityQueue<Job> jobs
```

says:

```text
Next item is smallest/highest priority according to comparator/natural order.
```

By default, Java PriorityQueue is min-priority based on natural/comparator ordering.

## 13.2 Not FIFO

If two elements have different priority, priority wins over arrival order.

## 13.3 Internal model

Typically heap-based.

## 13.4 Operations

```java
offer
poll
peek
```

## 13.5 Use cases

- scheduling by priority;
- Dijkstra/A*;
- top-N;
- retry by next attempt time;
- job priority.

## 13.6 Null

PriorityQueue does not permit null.

## 13.7 Rule

Use PriorityQueue when “next” is determined by priority/order, not arrival.

---

# 14. PriorityQueue Pitfalls

## 14.1 Iteration not sorted

Iterating PriorityQueue does not necessarily return sorted order.

To process sorted, repeatedly poll:

```java
while (!pq.isEmpty()) {
    process(pq.poll());
}
```

or copy and sort.

## 14.2 Comparator consistency

Comparator defines priority.

If comparator inconsistent or mutable fields change, behavior breaks.

## 14.3 Mutable priority

If element priority changes after insertion, queue does not reorder automatically.

Fix:

- remove and reinsert;
- use immutable priority;
- insert new item and ignore stale item with versioning.

## 14.4 Equal priority tie-breaking

PriorityQueue does not necessarily preserve insertion order among equal priority elements.

Add sequence number if stable tie-break needed.

```java
record PrioritizedJob(int priority, long sequence, Job job) {}
```

Comparator:

```java
Comparator.comparingInt(PrioritizedJob::priority)
          .thenComparingLong(PrioritizedJob::sequence)
```

## 14.5 Rule

PriorityQueue is not sorted list and not stable FIFO.

---

# 15. `BlockingQueue` Mental Model

`BlockingQueue` extends Queue with operations that wait for queue to become non-empty when retrieving and wait for space when storing.

## 15.1 Meaning

```java
BlockingQueue<Task>
```

says:

```text
This queue coordinates producer-consumer threads.
```

## 15.2 Blocking insertion

```java
put(e) // wait if full
offer(e, timeout, unit)
```

## 15.3 Blocking removal

```java
take() // wait if empty
poll(timeout, unit)
```

## 15.4 Non-blocking variants still exist

```java
offer
poll
peek
```

## 15.5 Happens-before

Concurrent queue implementations provide thread-safety semantics. In java.util.concurrent, blocking queues are intended as safe handoff structures.

## 15.6 Rule

Use BlockingQueue when threads need coordinated handoff with waiting/backpressure.

---

# 16. Bounded vs Unbounded Queues

## 16.1 Bounded queue

Has capacity limit.

```java
new ArrayBlockingQueue<>(1000)
```

When full, producer must:

- block;
- timeout;
- reject;
- drop;
- slow down.

## 16.2 Unbounded queue

Can grow until memory/resource exhaustion.

Examples:

- LinkedBlockingQueue default constructor effectively huge capacity;
- PriorityBlockingQueue is logically unbounded.

## 16.3 Production risk

Unbounded queue under sustained overload becomes OOM.

## 16.4 Backpressure

Bounded queue forces system to deal with overload.

## 16.5 Rule

In production services, default to bounded queues unless you have strong reason.

---

# 17. `ArrayBlockingQueue`

## 17.1 Mental model

Bounded blocking queue backed by array.

## 17.2 Characteristics

- fixed capacity;
- FIFO;
- blocking put/take;
- optional fairness policy;
- no null.

## 17.3 Use cases

- bounded worker queue;
- backpressure;
- predictable memory footprint;
- producer-consumer.

## 17.4 Trade-off

Capacity fixed; must choose size.

Too small -> frequent blocking/rejection.

Too large -> latency and memory risk.

## 17.5 Rule

Use ArrayBlockingQueue when bounded memory and FIFO handoff are desired.

---

# 18. `LinkedBlockingQueue`

## 18.1 Mental model

Blocking queue based on linked nodes, optionally bounded.

## 18.2 Characteristics

- FIFO;
- optionally bounded;
- if no capacity supplied, capacity can be very large;
- node allocation per element;
- blocking put/take;
- no null.

## 18.3 Use cases

- producer-consumer;
- executor queues;
- cases where linked-node throughput trade-off acceptable.

## 18.4 Risk

Default unbounded-ish capacity can hide overload until memory issue.

## 18.5 Rule

Always think about capacity when using LinkedBlockingQueue.

---

# 19. `PriorityBlockingQueue`

## 19.1 Mental model

Blocking queue with priority ordering.

Java SE docs describe it as unbounded blocking queue using same ordering rules as PriorityQueue and providing blocking retrieval.

## 19.2 Characteristics

- priority order;
- blocking retrieval;
- logically unbounded;
- no null;
- no FIFO guarantee among equal priority unless comparator handles it.

## 19.3 Risk

Unbounded priority queue can OOM under overload.

## 19.4 Use cases

- prioritized worker tasks;
- scheduled priority tasks where delay not needed.

## 19.5 Rule

Use carefully; add external bounding/admission control if production load can spike.

---

# 20. `DelayQueue`

## 20.1 Mental model

Queue of delayed elements. Element becomes available only after delay expires.

Elements implement `Delayed`.

## 20.2 Use cases

- retry after delay;
- scheduled task;
- timeout tracking;
- delayed event processing.

## 20.3 Characteristics

- blocking take waits until head delay expired;
- priority by delay expiration time;
- unbounded;
- no null.

## 20.4 Risk

Unbounded delay queue can accumulate too many delayed tasks.

## 20.5 Rule

DelayQueue is useful for in-memory scheduling, but not durable scheduler.

---

# 21. `SynchronousQueue`

## 21.1 Mental model

A queue with no internal capacity.

Each insert waits for a corresponding remove by another thread, and vice versa.

## 21.2 Meaning

```text
Direct handoff.
No buffering.
```

## 21.3 Use cases

- handoff between producer/consumer;
- executor design where task should be handed to worker or new worker/rejection;
- rendezvous.

## 21.4 Not a normal queue

- no capacity;
- cannot peek meaningfully;
- no stored elements.

## 21.5 Rule

Use SynchronousQueue when you explicitly want handoff without buffering.

---

# 22. Producer-Consumer Pattern

## 22.1 Basic model

Producer:

```java
queue.put(task);
```

Consumer:

```java
Task task = queue.take();
process(task);
```

## 22.2 Example

```java
BlockingQueue<Job> queue = new ArrayBlockingQueue<>(1000);

Thread producer = new Thread(() -> {
    while (running()) {
        Job job = readJob();
        queue.put(job);
    }
});

Thread consumer = new Thread(() -> {
    while (running()) {
        Job job = queue.take();
        process(job);
    }
});
```

Need handle `InterruptedException` properly.

## 22.3 Multiple consumers

```java
ExecutorService workers = Executors.newFixedThreadPool(n);
```

or manual consumers.

## 22.4 Backpressure

If queue full, producer blocks or times out.

## 22.5 Failure handling

If processing fails:

- retry?
- DLQ?
- log and continue?
- stop consumer?
- poison item?

## 22.6 Rule

Producer-consumer is not complete without failure and shutdown strategy.

---

# 23. Backpressure

Backpressure means producer is forced to slow down when consumer cannot keep up.

## 23.1 Without backpressure

```text
Producer keeps adding -> queue grows -> memory grows -> OOM
```

## 23.2 With bounded queue

```java
boolean accepted = queue.offer(job, 100, TimeUnit.MILLISECONDS);
if (!accepted) {
    reject(job);
}
```

## 23.3 Strategies when full

- block;
- timeout and retry;
- reject request;
- drop oldest;
- drop newest;
- shed load;
- scale consumers;
- persist to durable queue.

## 23.4 Choosing strategy

Depends on domain:

- payment command: do not drop;
- metrics event: maybe drop/sample;
- user request: reject with 429/503;
- internal job: retry/persist.

## 23.5 Rule

Queue capacity is a product decision, not just technical number.

---

# 24. Poison Pill and Shutdown

## 24.1 Poison pill

Special item tells consumer to stop.

```java
sealed interface WorkItem permits Job, StopSignal {}

record Job(...) implements WorkItem {}
record StopSignal() implements WorkItem {}
```

Consumer:

```java
while (true) {
    WorkItem item = queue.take();
    if (item instanceof StopSignal) {
        break;
    }
    process((Job) item);
}
```

## 24.2 Multiple consumers

Need one poison pill per consumer or another shutdown mechanism.

## 24.3 Type safety

Use sealed type instead of null sentinel.

## 24.4 Interruption

Consumers should handle interruption.

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

## 24.5 Rule

Shutdown is part of queue design.

---

# 25. Timeouts and Cancellation

## 25.1 Avoid blocking forever

Use timeout when appropriate:

```java
Job job = queue.poll(1, TimeUnit.SECONDS);
```

## 25.2 Offer timeout

```java
boolean accepted = queue.offer(job, 100, TimeUnit.MILLISECONDS);
```

## 25.3 Cancellation

Use:

- interruption;
- cancellation token;
- executor shutdown;
- poison pill.

## 25.4 Preserve interrupt

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

## 25.5 Rule

Blocking queue code must have interruption/shutdown policy.

---

# 26. Queue Size, Monitoring, and Operational Signals

Queue size is an operational signal.

## 26.1 Metrics

Track:

- current size;
- remaining capacity;
- enqueue rate;
- dequeue rate;
- processing latency;
- oldest item age;
- rejection count;
- timeout count;
- consumer errors;
- dead letter count.

## 26.2 Backlog

Growing queue means:

```text
arrival rate > processing rate
```

## 26.3 Queue size alone insufficient

A queue of 100 may be fine if processing is fast.

A queue of 5 may be bad if items are old.

Track age/latency too.

## 26.4 Alerting

Alert on:

- sustained high utilization;
- oldest item age;
- consumer stopped;
- repeated full queue;
- OOM risk.

## 26.5 Rule

A queue without monitoring is hidden latency.

---

# 27. Queues and Executors

Executor services often use queues internally.

## 27.1 ThreadPoolExecutor

Conceptually:

```text
submit task -> work queue -> worker thread
```

## 27.2 Queue choice affects executor behavior

- bounded queue -> backpressure/rejection;
- unbounded queue -> potential memory growth;
- SynchronousQueue -> direct handoff;
- priority queue -> priority execution.

## 27.3 Rejection policy

When executor cannot accept task:

- AbortPolicy;
- CallerRunsPolicy;
- DiscardPolicy;
- DiscardOldestPolicy;
- custom.

## 27.4 Production rule

Avoid unbounded executor queues for request-driven workloads unless consciously accepted.

## 27.5 CallerRunsPolicy

Can provide backpressure by making producer do work.

But may hurt request latency.

## 27.6 Rule

Executor queue is a production capacity control.

---

# 28. Queues and Streams

Queues and streams have different mental models.

## 28.1 Queue

Mutable, pull next item, often stateful.

## 28.2 Stream

Lazy pipeline over source.

## 28.3 Dangerous pattern

```java
queue.stream()
```

on concurrently modified queue may have weakly consistent behavior depending implementation.

## 28.4 Processing queue with stream

Usually not natural if you need destructive consumption:

```java
Job job;
while ((job = queue.poll()) != null) {
    process(job);
}
```

## 28.5 BlockingQueue stream?

A stream over BlockingQueue does not naturally block until future elements unless custom Spliterator.

## 28.6 Rule

Use loops/consumers for queue processing. Use streams for finite snapshots/pipelines.

---

# 29. Queues in Domain Modeling

## 29.1 Workflow queue

```java
record PendingReviewQueue(Deque<CaseId> values) {}
```

But if queue must survive restart, in-memory Deque is wrong.

## 29.2 Retry queue

```java
DelayQueue<RetryTask>
```

Good for in-memory retry scheduling, not durable retry.

## 29.3 Domain queue vs infrastructure queue

Domain:

```java
PendingAssignments
```

Infrastructure:

```java
BlockingQueue<AssignmentJob>
```

Keep separate when semantics differ.

## 29.4 Bounded queue as invariant

```java
record BoundedWorkQueue(...)
```

can encode capacity policy.

## 29.5 Rule

If queue state is business-critical, persist it or use durable messaging.

---

# 30. Queues in API/DB/Event Boundaries

## 30.1 API

Usually do not expose internal queue directly.

Expose:

- status;
- backlog count;
- oldest age;
- accepted/rejected result.

## 30.2 DB

Persistent queue can be modeled with table:

```sql
job_queue (
  job_id,
  status,
  priority,
  available_at,
  created_at,
  locked_by,
  locked_until
)
```

But DB queue design is hard under concurrency.

## 30.3 Event broker

For durable async processing, use:

- Kafka;
- RabbitMQ;
- SQS;
- database outbox;
- message queue.

## 30.4 Event boundaries

Queue item should have schema/version/idempotency key.

## 30.5 Rule

In-memory queue is process-local and volatile. Do not confuse it with durable messaging.

---

# 31. Concurrency and Memory Model

## 31.1 Non-concurrent queues

`ArrayDeque`, `PriorityQueue` are not thread-safe.

## 31.2 Blocking queues

BlockingQueue implementations are thread-safe and intended for multi-threaded producer-consumer.

## 31.3 Visibility

Putting item into BlockingQueue and taking it from another thread provides safe handoff semantics in practice via java.util.concurrent memory consistency guarantees.

## 31.4 Mutable items

The queue transfers references.

If item is mutable and producer mutates after enqueue, consumer may see unexpected changes.

Prefer immutable work items.

## 31.5 Interrupts

Blocking operations can throw InterruptedException. Respect it.

## 31.6 Rule

Thread-safe queue does not make queued item immutable.

---

# 32. Performance and Memory Cost Model

## 32.1 ArrayDeque

- compact circular array;
- fast add/remove ends;
- grows as needed;
- no per-node allocation;
- no null;
- not thread-safe.

## 32.2 LinkedList

- node per element;
- memory overhead;
- pointer chasing;
- not thread-safe.

## 32.3 PriorityQueue

- heap;
- priority operations O(log n);
- not sorted iteration;
- not thread-safe.

## 32.4 ArrayBlockingQueue

- fixed array;
- predictable memory;
- blocking;
- potential contention.

## 32.5 LinkedBlockingQueue

- linked nodes;
- optionally bounded;
- allocation per node;
- capacity must be considered.

## 32.6 PriorityBlockingQueue

- unbounded priority blocking;
- memory risk under load.

## 32.7 SynchronousQueue

- no storage;
- direct handoff;
- useful for strict backpressure.

## 32.8 Rule

Queue choice affects latency, throughput, memory, and overload behavior.

---

# 33. Production Failure Modes

## 33.1 Unbounded queue OOM

Producer outpaces consumer.

Fix:

- bounded queue;
- backpressure;
- rejection;
- scaling;
- durable queue.

## 33.2 LinkedBlockingQueue default capacity surprise

Default can grow extremely large.

Fix:

```java
new LinkedBlockingQueue<>(capacity)
```

## 33.3 PriorityQueue iteration assumed sorted

Bug in output/report.

Fix:

- poll repeatedly;
- copy and sort.

## 33.4 Mutable priority

Priority changes after insertion but queue not reordered.

Fix:

- immutable priority;
- remove/reinsert;
- versioned stale discard.

## 33.5 Equal priority unstable

Jobs with same priority processed nondeterministically.

Fix:

- add sequence tie-breaker.

## 33.6 Blocking forever

Consumer or producer stuck.

Fix:

- timeouts;
- interruption;
- shutdown policy.

## 33.7 Poison pill count wrong

Only one consumer stops, others hang.

Fix:

- one poison per consumer or coordinated shutdown.

## 33.8 InterruptedException swallowed

Thread keeps running despite shutdown.

Fix:

```java
Thread.currentThread().interrupt();
return;
```

## 33.9 In-memory queue used as durable queue

Crash loses work.

Fix:

- durable broker/outbox/DB queue.

## 33.10 Queue metrics missing

Latency hidden until outage.

Fix:

- monitor backlog, age, rate, rejection.

## 33.11 Blocking work in parallel stream/common pool

Queue wait blocks shared pool.

Fix:

- dedicated executor/queue design.

## 33.12 Thread-safe queue with mutable item

Consumer sees mutated object.

Fix:

- immutable work item.

---

# 34. Best Practices

## 34.1 Non-concurrent

- Use `ArrayDeque` for stack/queue/deque.
- Avoid `Stack`.
- Avoid `LinkedList` unless justified.
- Use `PriorityQueue` for priority order.
- Do not rely on PriorityQueue iteration order.

## 34.2 Concurrent

- Use `BlockingQueue` for producer-consumer.
- Prefer bounded queues in production.
- Choose full-queue strategy deliberately.
- Respect interruption.
- Use immutable work items.
- Monitor queue.

## 34.3 Backpressure

- Decide block/reject/drop/retry.
- Keep queue size finite.
- Alert on queue age, not just size.
- Use CallerRuns/rejection policy carefully.

## 34.4 Shutdown

- Define shutdown protocol.
- Use poison pill or interruption.
- Handle multiple consumers.
- Drain or persist remaining work.

## 34.5 Domain/infrastructure

- Do not expose internal queue as API.
- Do not use in-memory queue for durable business workflow.
- Persist queue state if loss is unacceptable.

---

# 35. Decision Matrix

| Requirement | Recommended |
|---|---|
| non-concurrent FIFO | `ArrayDeque` as `Queue`/`Deque` |
| non-concurrent stack | `ArrayDeque` as `Deque` |
| add/remove both ends | `ArrayDeque` |
| priority processing | `PriorityQueue` |
| bounded producer-consumer | `ArrayBlockingQueue` |
| optionally bounded linked producer-consumer | `LinkedBlockingQueue` with capacity |
| priority blocking | `PriorityBlockingQueue` with external admission control |
| delayed retry | `DelayQueue` |
| direct handoff/no buffering | `SynchronousQueue` |
| concurrent non-blocking FIFO | `ConcurrentLinkedQueue` |
| durable async processing | external broker/outbox/DB queue |
| read ordered history | `List`/`SequencedCollection`, not Queue |
| lookup pending by ID | `Map` plus queue/index |
| membership of pending | `Set` plus queue if both needed |

---

# 36. Latihan

## Latihan 1 — Queue Method Families

Implement small queue processor using:

- `remove`;
- `poll`.

Show behavior when queue empty.

## Latihan 2 — ArrayDeque Stack

Implement DFS using:

```java
Deque<Node> stack = new ArrayDeque<>();
```

Explain why not `Stack`.

## Latihan 3 — BFS

Implement BFS with:

```java
Queue<NodeId> queue = new ArrayDeque<>();
Set<NodeId> visited = new HashSet<>();
```

Explain queue vs set roles.

## Latihan 4 — PriorityQueue Tie-Breaker

Create priority job with:

- priority;
- sequence;
- jobId.

Ensure stable processing among same priority.

## Latihan 5 — Bounded BlockingQueue

Create producer-consumer with `ArrayBlockingQueue<>(10)`.

Test what happens when producer faster than consumer.

## Latihan 6 — Poison Pill

Implement shutdown with multiple consumers.

How many poison pills needed?

## Latihan 7 — Queue Monitoring

Define metrics for a work queue:

- size;
- remaining capacity;
- oldest age;
- enqueue/dequeue rate;
- rejection count.

## Latihan 8 — In-Memory vs Durable

For each workload, decide in-memory queue or durable broker:

1. sending email notification;
2. payment settlement;
3. metrics sampling;
4. case closure command;
5. UI autocomplete event.

Explain.

---

# 37. Ringkasan

Queue and Deque are processing-order structures.

Core lessons:

- `Queue` holds elements before processing.
- Queue method pairs differ by exception vs special value.
- `Deque` supports both ends and is ideal for stack/queue use.
- Prefer `ArrayDeque` for non-concurrent queue/stack/deque.
- Avoid legacy `Stack`.
- Avoid `LinkedList` as default queue.
- `PriorityQueue` orders by priority, not FIFO; iteration is not sorted.
- `BlockingQueue` coordinates producer-consumer threads.
- Bounded queues create backpressure.
- Unbounded queues can OOM.
- `ArrayBlockingQueue` gives fixed capacity.
- `LinkedBlockingQueue` must be capacity-aware.
- `PriorityBlockingQueue` is logically unbounded.
- `DelayQueue` is for delayed availability.
- `SynchronousQueue` is direct handoff with no capacity.
- Queue design must include shutdown, failure handling, monitoring, and overload policy.
- Thread-safe queue does not make queued item immutable.
- In-memory queues are not durable message brokers.

Main rule:

```text
A queue is not just a collection. A queue is a load, order, and processing policy.
```

---

# 38. Referensi

1. Java SE 25 — `Queue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Queue.html

2. Java SE 25 — `Deque`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Deque.html

3. Java SE 25 — `ArrayDeque`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayDeque.html

4. Java SE 25 — `PriorityQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html

5. Java SE 25 — `BlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html

6. Java SE 25 — `ArrayBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ArrayBlockingQueue.html

7. Java SE 25 — `LinkedBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/LinkedBlockingQueue.html

8. Java SE 25 — `PriorityBlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/PriorityBlockingQueue.html

9. Java SE 25 — `DelayQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/DelayQueue.html

10. Java SE 25 — `SynchronousQueue`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/SynchronousQueue.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-004.md](./learn-java-collections-and-streams-part-004.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-006.md](./learn-java-collections-and-streams-part-006.md)

</div>
# Strict Coding Standards — Java Concurrency

> **Purpose**: This document defines mandatory rules for LLMs, code agents, and human contributors when implementing concurrent Java code.
>
> **Scope**: Java 11, Java 17, Java 21, and Java 25 codebases. It covers Java Memory Model, threads, executors, virtual threads, futures, locks, atomics, concurrent collections, cancellation, timeouts, backpressure, observability, and testability.
>
> **Mode**: Strict. If a concurrency decision is not justified, it must not be implemented.

---

## 0. Core Principle

Concurrency is not a performance decoration. It is a correctness boundary.

A code agent must not introduce concurrency unless it can prove:

1. what work can run independently;
2. what state is shared;
3. what owns each thread/task;
4. how cancellation propagates;
5. how timeout is enforced;
6. how failures are observed;
7. how shutdown happens;
8. how the implementation is tested.

If any of these cannot be answered, keep the implementation sequential.

---

## 1. Version Compatibility Matrix

| Feature / API | Java 11 | Java 17 | Java 21 | Java 25 | Rule |
|---|---:|---:|---:|---:|---|
| `Thread`, `Runnable`, `Callable` | Yes | Yes | Yes | Yes | Allowed, but raw thread creation is restricted |
| `ExecutorService` | Yes | Yes | Yes | Yes | Preferred over manually managed threads |
| `CompletableFuture` | Yes | Yes | Yes | Yes | Allowed with strict executor and failure handling |
| `ForkJoinPool` | Yes | Yes | Yes | Yes | Restricted to CPU-bound divide-and-conquer or framework-owned usage |
| `parallelStream()` | Yes | Yes | Yes | Yes | Forbidden by default in application/server code |
| `java.util.concurrent.Flow` | Yes | Yes | Yes | Yes | Allowed for reactive-stream style protocol only |
| Virtual threads | No | No | Final | Final | Allowed in Java 21+ with strict rules |
| `Executors.newVirtualThreadPerTaskExecutor()` | No | No | Yes | Yes | Allowed for blocking I/O concurrency; do not pool virtual threads |
| Structured concurrency | No | No | Preview | Fifth preview | Forbidden by default; requires explicit preview policy |
| Scoped values | No | No | Preview | Final | Allowed only in Java 25+ and only for immutable request/context values |
| Synchronize virtual threads without most pinning cases | No | No | No | Included from Java 24+ | Do not assume Java 21 behaves the same as Java 24/25 |

### 1.1 Baseline Rule

All generated code must declare its intended Java baseline.

Examples:

```text
Baseline: Java 17
Concurrency features allowed: ExecutorService, CompletableFuture, locks, atomics, concurrent collections.
Concurrency features forbidden: virtual threads, scoped values, structured concurrency.
```

```text
Baseline: Java 21
Concurrency features allowed: virtual threads for blocking I/O.
Concurrency features forbidden by default: StructuredTaskScope, ScopedValue preview APIs.
```

```text
Baseline: Java 25
Concurrency features allowed: virtual threads, scoped values.
Concurrency features forbidden by default: StructuredTaskScope preview APIs unless project explicitly enables preview features.
```

---

## 2. Absolute Rules

### 2.1 Forbidden by Default

The following are forbidden unless an approved architecture note explicitly allows them:

1. creating raw `new Thread(...)` in application/business code;
2. using `parallelStream()` in server-side request handling;
3. using `ForkJoinPool.commonPool()` implicitly for blocking I/O;
4. submitting unbounded work to an unbounded executor queue;
5. using `Executors.newCachedThreadPool()` without a bounded external admission control;
6. swallowing `InterruptedException`;
7. ignoring `Future`, `CompletableFuture`, or scheduled task failures;
8. using `Thread.stop`, `Thread.suspend`, `Thread.resume`;
9. using `wait/notify` for new code unless implementing a low-level concurrency primitive;
10. holding locks while doing network, file, database, or external service I/O;
11. synchronizing on interned strings, boxed primitives, public objects, or externally visible objects;
12. mixing blocking and non-blocking models without an explicit boundary;
13. adding async behavior to hide slow code without backpressure;
14. using `ThreadLocal` as global hidden state without lifecycle cleanup;
15. assuming `volatile` makes compound operations atomic;
16. mutating shared non-thread-safe collections from multiple threads;
17. using preview concurrency APIs in production without explicit preview policy.

### 2.2 Mandatory for Any Concurrent Code

Any concurrent implementation must define:

```text
Concurrency Design Note
- Work units:
- Shared state:
- Ownership model:
- Executor/thread model:
- Capacity bound:
- Timeout:
- Cancellation:
- Failure propagation:
- Shutdown behavior:
- Observability:
- Tests:
```

If the generated code does not include or imply this design note, it is incomplete.

---

## 3. Concurrency Decision Protocol

Before adding concurrency, answer in order:

### 3.1 Is concurrency necessary?

Allowed reasons:

- independent I/O calls can overlap;
- CPU-bound work can be partitioned and measured;
- producer/consumer boundary requires decoupling;
- latency budget requires parallel branches;
- high number of blocking requests justifies virtual threads;
- background scheduling is explicitly required.

Not valid reasons:

- “async is modern”;
- “thread improves performance” without benchmark;
- “future-proofing”;
- “avoid waiting” while still consuming unbounded resources;
- “make UI/API return faster” while silently dropping failures.

### 3.2 What is the unit of concurrency?

Define the exact unit:

- request;
- file;
- database row batch;
- message;
- partition;
- external call;
- domain aggregate;
- scheduled job execution.

Never create concurrency around arbitrary loops without proving the iteration is independent.

### 3.3 What is shared?

Classify each object as:

| Classification | Meaning | Rule |
|---|---|---|
| Thread-confined | Owned by one thread/task | No synchronization required |
| Immutable | Cannot change after construction | Safe to share |
| Effectively immutable | Not mutated after publication | Safe only if safely published |
| Shared mutable | Multiple threads mutate/read | Requires synchronization/atomic/concurrent structure |
| External resource | DB, file, socket, remote API | Requires capacity limit and lifecycle control |

If shared mutable state cannot be eliminated, it must be protected by a single clear mechanism.

### 3.4 What limits concurrency?

Every concurrent system needs an admission control:

- bounded thread pool;
- semaphore;
- bounded queue;
- database pool size;
- rate limiter;
- external API quota;
- partition count;
- request-level fan-out limit.

Unbounded concurrency is forbidden.

---

## 4. Java Memory Model Rules

### 4.1 Visibility Is Not Automatic

A write performed by one thread is not guaranteed to be visible to another thread unless there is a valid happens-before relationship.

Valid synchronization mechanisms include:

- thread start/join semantics;
- `synchronized` monitor release/acquire;
- volatile write/read;
- locks from `java.util.concurrent.locks`;
- atomic classes;
- concurrent collections with documented memory effects;
- executor/future completion semantics;
- safe publication through final fields and immutable construction.

### 4.2 No Data Races

Do not read/write the same mutable variable from multiple threads without synchronization.

Bad:

```java
class Counter {
    private int count;

    void increment() {
        count++;
    }

    int value() {
        return count;
    }
}
```

Good:

```java
import java.util.concurrent.atomic.AtomicInteger;

final class Counter {
    private final AtomicInteger count = new AtomicInteger();

    void increment() {
        count.incrementAndGet();
    }

    int value() {
        return count.get();
    }
}
```

### 4.3 `volatile` Rule

`volatile` is allowed for:

- visibility of a single variable;
- simple stop flags;
- immutable reference publication;
- double-check patterns only when implemented correctly.

`volatile` is not enough for:

- increment/decrement;
- check-then-act;
- compound invariants;
- multiple related fields;
- collection mutation safety.

Bad:

```java
private volatile int count;

void increment() {
    count++; // Not atomic
}
```

Good:

```java
private final AtomicInteger count = new AtomicInteger();

void increment() {
    count.incrementAndGet();
}
```

### 4.4 Safe Publication

Shared objects must be safely published.

Allowed:

- immutable object assigned to `final` field during construction;
- object placed into concurrent collection;
- object published through volatile field;
- object published under lock;
- object returned after construction without leaking `this`.

Forbidden:

- leaking `this` from constructor;
- starting a thread from constructor that observes partially initialized state;
- registering callbacks from constructor if callback can run immediately;
- publishing mutable object then mutating it without synchronization.

---

## 5. Thread Ownership Rules

### 5.1 Do Not Create Raw Threads in Business Code

Bad:

```java
new Thread(() -> process(order)).start();
```

Required:

```java
executor.submit(() -> process(order));
```

Rationale:

- lifecycle is controlled;
- shutdown can be enforced;
- failures can be observed;
- capacity can be bounded;
- thread names can be standardized;
- metrics can be attached.

### 5.2 Raw Thread Creation Allowed Only For Infrastructure

Raw thread creation is allowed only in low-level infrastructure such as:

- custom thread factory;
- framework integration;
- test harness;
- JVM-level service abstraction.

Even then, the code must set:

- thread name;
- daemon policy;
- uncaught exception handler;
- lifecycle owner.

Example:

```java
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

final class NamedThreadFactory implements ThreadFactory {
    private final String prefix;
    private final AtomicInteger sequence = new AtomicInteger();

    NamedThreadFactory(String prefix) {
        this.prefix = prefix;
    }

    @Override
    public Thread newThread(Runnable task) {
        Thread thread = new Thread(task, prefix + "-" + sequence.incrementAndGet());
        thread.setDaemon(false);
        thread.setUncaughtExceptionHandler((t, e) -> {
            // Replace with project logger.
            System.err.println("Uncaught exception in " + t.getName() + ": " + e.getMessage());
        });
        return thread;
    }
}
```

---

## 6. ExecutorService Rules

### 6.1 Executor Must Be Injected or Owned Explicitly

A class that submits work must either:

1. receive an executor from outside; or
2. create and close its own executor as a lifecycle owner.

Bad:

```java
class ReportService {
    private final ExecutorService executor = Executors.newFixedThreadPool(8);
}
```

Better:

```java
import java.util.concurrent.ExecutorService;

final class ReportService {
    private final ExecutorService executor;

    ReportService(ExecutorService executor) {
        this.executor = executor;
    }
}
```

### 6.2 Executor Type Must Match Workload

| Workload | Preferred Model | Notes |
|---|---|---|
| CPU-bound | fixed-size platform thread pool | size near CPU cores; benchmark required |
| Blocking I/O on Java 11/17 | bounded platform thread pool | bound by downstream resource capacity |
| Blocking I/O on Java 21+ | virtual thread per task | still bound DB/API/file resources |
| Scheduled tasks | `ScheduledExecutorService` | task must be idempotent or guarded |
| Divide-and-conquer CPU work | `ForkJoinPool` | no blocking unless managed blocker or explicit design |
| Reactive/event-loop | framework-owned event loop | do not block event-loop threads |

### 6.3 Avoid `Executors` Factory Methods That Hide Queues

Restricted:

```java
Executors.newFixedThreadPool(10);      // Uses unbounded queue internally
Executors.newCachedThreadPool();       // Can create many threads
Executors.newSingleThreadExecutor();   // Can hide backlog
```

Preferred for bounded platform pools:

```java
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

ThreadPoolExecutor executor = new ThreadPoolExecutor(
        8,
        8,
        0L,
        TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(1_000),
        new NamedThreadFactory("report-worker"),
        new ThreadPoolExecutor.CallerRunsPolicy()
);
```

### 6.4 Queue Bound Is Mandatory

Every executor used for application work must document:

```text
corePoolSize:
maxPoolSize:
queueCapacity:
rejectionPolicy:
reason:
```

A bounded pool without a meaningful rejection policy is incomplete.

### 6.5 Shutdown Is Mandatory

Executor lifecycle must be explicit.

Java 11/17 style:

```java
static void shutdownGracefully(ExecutorService executor) {
    executor.shutdown();
    try {
        if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
            executor.shutdownNow();
            if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Executor did not terminate");
            }
        }
    } catch (InterruptedException e) {
        executor.shutdownNow();
        Thread.currentThread().interrupt();
    }
}
```

Java 21+ `ExecutorService` is `AutoCloseable`, but project code must still be clear about whether closing blocks and where lifecycle belongs.

---

## 7. Virtual Thread Rules — Java 21+

Virtual threads are allowed only when the Java baseline is 21 or newer.

### 7.1 Allowed Use Cases

Virtual threads are recommended for:

- high-concurrency blocking I/O;
- request-per-thread server model;
- outbound HTTP/database/file calls where code is blocking;
- simplifying callback-heavy blocking workflows;
- replacing large platform thread pools used only to wait.

### 7.2 Not Allowed Use Cases

Virtual threads must not be used to claim speedup for:

- CPU-bound computation;
- tight loops;
- in-memory processing with no blocking;
- hiding downstream capacity limits;
- event-loop frameworks where blocking is forbidden;
- workloads that require thread affinity.

### 7.3 Do Not Pool Virtual Threads

Bad:

```java
// Wrong mental model: virtual threads are already cheap.
ExecutorService executor = Executors.newFixedThreadPool(100, Thread.ofVirtual().factory());
```

Good:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<Response> future = executor.submit(() -> callRemoteService(request));
    return future.get(2, TimeUnit.SECONDS);
}
```

### 7.4 Limit External Resources Separately

Virtual threads do not remove capacity constraints.

If 10,000 virtual threads call a database with a 50-connection pool, only 50 calls can actively use DB connections. The rest wait and may cause latency, timeout, and memory pressure.

Use semaphores or bulkheads:

```java
import java.util.concurrent.Semaphore;

final class ExternalClient {
    private final Semaphore permits = new Semaphore(100);

    Response call(Request request) throws InterruptedException {
        if (!permits.tryAcquire(500, TimeUnit.MILLISECONDS)) {
            throw new TooManyRequestsException("external client bulkhead rejected request");
        }
        try {
            return blockingCall(request);
        } finally {
            permits.release();
        }
    }
}
```

### 7.5 Virtual Thread Pinning Awareness

For Java 21, virtual threads can be pinned to carrier threads in certain cases, especially around blocking operations inside `synchronized` sections or native/foreign calls.

Rules:

- do not perform blocking I/O while holding a monitor lock;
- prefer `ReentrantLock` for long critical sections that may block;
- keep synchronized sections short;
- profile pinning before large production rollout;
- Java 24+ improves synchronized-block behavior, but native/foreign or other blocking scenarios still require caution.

### 7.6 ThreadLocal With Virtual Threads

`ThreadLocal` is restricted with virtual threads.

Allowed:

- framework-managed context with known cleanup;
- short-lived request context with `try/finally` cleanup;
- legacy integration where replacement is not feasible.

Forbidden:

- large objects in `ThreadLocal` for every virtual thread;
- caches in `ThreadLocal`;
- security context that is not cleared;
- assuming thread-local state flows automatically to child tasks.

Java 25+ should prefer scoped values for immutable contextual data.

---

## 8. Structured Concurrency Rules

Structured concurrency is a preview API in Java 21 and remains preview in Java 25.

### 8.1 Default Policy

`StructuredTaskScope` and related preview APIs are forbidden by default in production standards.

Allowed only when all conditions are true:

1. project explicitly enables preview features;
2. build and runtime both pass `--enable-preview`;
3. API instability is accepted;
4. migration plan exists;
5. code is isolated behind a small adapter;
6. tests cover cancellation and failure propagation.

### 8.2 Conceptual Rule Even When API Is Forbidden

Even if the preview API is not used, the design principle is mandatory:

> If a parent operation starts child tasks, the parent must wait for them, cancel them, or explicitly transfer ownership.

Fire-and-forget child tasks are forbidden unless they are handed off to a durable queue, scheduler, or lifecycle-managed background service.

### 8.3 Required Behavior For Fan-Out

For fan-out logic:

- define timeout for the whole operation;
- cancel unfinished branches when result is no longer needed;
- propagate first meaningful failure;
- preserve suppressed failures where useful;
- avoid orphan tasks;
- ensure child tasks do not outlive request scope accidentally.

---

## 9. Scoped Values — Java 25+

Scoped values are allowed only on Java 25+.

### 9.1 Allowed Use Cases

Use scoped values for immutable contextual data such as:

- correlation ID;
- tenant ID;
- authenticated principal snapshot;
- request metadata;
- locale/timezone snapshot;
- tracing context;
- read-only policy context.

### 9.2 Forbidden Use Cases

Do not use scoped values for:

- mutable request state;
- caches;
- transaction state;
- security decisions that require explicit parameter flow;
- large payloads;
- data that must outlive the scope.

### 9.3 Prefer Explicit Parameters For Domain Logic

Scoped values may simplify infrastructure context propagation, but they must not hide domain dependencies.

Bad:

```java
Money calculatePrice(Order order) {
    Tenant tenant = TENANT.get();
    return pricingService.price(order, tenant);
}
```

Better:

```java
Money calculatePrice(Order order, Tenant tenant) {
    return pricingService.price(order, tenant);
}
```

Scoped context is acceptable at boundaries such as logging, tracing, and request metadata, not as hidden domain input.

---

## 10. CompletableFuture and CompletionStage Rules

### 10.1 Executor Must Be Explicit

Bad:

```java
CompletableFuture.supplyAsync(() -> blockingCall());
```

This uses the common pool by default and is unsafe for blocking I/O.

Good:

```java
CompletableFuture<Response> future = CompletableFuture.supplyAsync(
        () -> blockingCall(request),
        ioExecutor
);
```

### 10.2 Async Chains Must Use Intended Executor

Bad:

```java
future.thenApply(this::parse)
      .thenApply(this::save);
```

If `parse` or `save` is expensive or blocking, the execution thread becomes ambiguous.

Good:

```java
future.thenApplyAsync(this::parse, cpuExecutor)
      .thenApplyAsync(this::save, ioExecutor);
```

### 10.3 Failure Handling Is Mandatory

Every `CompletableFuture` chain must terminate with explicit failure observation if it is not returned to a caller.

Allowed:

```java
future.whenComplete((result, error) -> {
    if (error != null) {
        logFailure(error);
    }
});
```

Forbidden:

```java
CompletableFuture.runAsync(() -> doWork(), executor); // failure can be lost
```

### 10.4 Timeout Is Mandatory For External Work

Use timeout boundaries:

```java
CompletableFuture<Response> future = CompletableFuture
        .supplyAsync(() -> client.call(request), ioExecutor)
        .orTimeout(2, TimeUnit.SECONDS);
```

For fallback:

```java
CompletableFuture<Response> future = CompletableFuture
        .supplyAsync(() -> client.call(request), ioExecutor)
        .completeOnTimeout(Response.timeoutFallback(), 2, TimeUnit.SECONDS);
```

Fallback must be domain-approved. Never silently return fake success.

### 10.5 Cancellation Is Not Magic

Calling `future.cancel(true)` does not guarantee underlying I/O is stopped unless the operation cooperates with interruption or has its own timeout/cancel API.

All long-running operations must have:

- interrupt handling;
- deadline check;
- external client timeout;
- resource cleanup.

---

## 11. ForkJoinPool and Parallel Streams

### 11.1 ForkJoinPool Allowed Use Cases

Allowed:

- CPU-bound recursive decomposition;
- work-stealing algorithms;
- controlled internal framework execution;
- bounded parallel computation with benchmark evidence.

Restricted:

- blocking I/O;
- database calls;
- remote API calls;
- request-scoped fan-out where cancellation and timeout matter;
- application logic that shares common pool with unrelated code.

### 11.2 `parallelStream()` Forbidden by Default

Bad:

```java
orders.parallelStream()
      .map(order -> paymentClient.charge(order))
      .toList();
```

Reasons:

- uses common pool by default;
- weak control over parallelism;
- poor failure/cancellation semantics;
- dangerous with blocking I/O;
- hard to observe;
- can harm unrelated code using the same pool.

Acceptable only for isolated CPU-bound transformations with benchmark and no blocking.

---

## 12. Locks and Synchronization

### 12.1 Prefer No Shared Mutable State

Order of preference:

1. immutable data;
2. thread confinement;
3. message passing / queue;
4. concurrent collection;
5. atomic variable;
6. lock;
7. low-level wait/notify only as last resort.

### 12.2 `synchronized` Rules

Allowed for:

- short critical sections;
- simple invariants;
- private lock objects;
- non-blocking in-memory state updates.

Forbidden:

- blocking I/O inside synchronized block;
- calling external callbacks while holding lock;
- lock on `this` for public classes unless deliberately part of API;
- lock on `String`, boxed primitives, class literals for business state;
- nested locks without documented order.

Good:

```java
private final Object lock = new Object();
private int value;

int incrementAndGet() {
    synchronized (lock) {
        return ++value;
    }
}
```

### 12.3 Lock Ordering

If multiple locks are needed, define global lock order.

Bad:

```java
synchronized (accountA) {
    synchronized (accountB) {
        transfer(accountA, accountB, amount);
    }
}
```

Better:

```java
Account first = accountA.id().compareTo(accountB.id()) < 0 ? accountA : accountB;
Account second = first == accountA ? accountB : accountA;

synchronized (first.lock()) {
    synchronized (second.lock()) {
        transfer(accountA, accountB, amount);
    }
}
```

### 12.4 ReentrantLock Rules

Use `ReentrantLock` when you need:

- timed lock acquisition;
- interruptible lock acquisition;
- multiple conditions;
- explicit fairness policy;
- better structure for virtual-thread-sensitive code.

Required pattern:

```java
lock.lock();
try {
    updateState();
} finally {
    lock.unlock();
}
```

For timeout:

```java
if (!lock.tryLock(500, TimeUnit.MILLISECONDS)) {
    throw new TimeoutException("could not acquire lock");
}
try {
    updateState();
} finally {
    lock.unlock();
}
```

### 12.5 ReadWriteLock / StampedLock

Restricted.

Use only when:

- read-heavy workload is proven;
- write frequency is low;
- lock upgrade/downgrade behavior is understood;
- benchmarks prove benefit over simple lock.

Do not use `StampedLock` casually. It is easy to misuse, especially optimistic reads.

---

## 13. Atomic Classes and VarHandle

### 13.1 Atomic Classes Allowed Use Cases

Allowed:

- counters;
- flags;
- sequence numbers;
- simple state transitions;
- compare-and-set loops with small immutable state;
- hot-path metrics.

### 13.2 Atomic Classes Not Enough For Compound Invariants

Bad:

```java
AtomicInteger balance = new AtomicInteger();
AtomicInteger reserved = new AtomicInteger();
```

If `balance >= reserved` is an invariant, separate atomics are insufficient.

Use a lock or immutable aggregate CAS:

```java
record AccountState(int balance, int reserved) {}
```

Then update atomically as a whole if appropriate.

### 13.3 LongAdder / LongAccumulator

Allowed for high-contention metrics where exact immediate value is not required.

Do not use `LongAdder` for business correctness counters where exact read-after-write semantics matter.

### 13.4 VarHandle

Restricted to low-level libraries.

Do not use `VarHandle` in normal application code unless:

- Atomic classes are insufficient;
- memory ordering is documented;
- tests include concurrency stress cases;
- reviewer understands acquire/release/opaque/volatile semantics.

---

## 14. Concurrent Collections and Queues

### 14.1 Choose The Collection By Concurrency Contract

| Need | Preferred Type | Notes |
|---|---|---|
| concurrent map with high read/write | `ConcurrentHashMap` | do not compound unsafely |
| blocking producer/consumer | `BlockingQueue` | capacity required |
| delay scheduling | `DelayQueue` / scheduler | understand ordering |
| read-mostly list | `CopyOnWriteArrayList` | bad for frequent writes |
| lock-free queue | `ConcurrentLinkedQueue` | no blocking/backpressure |
| bounded handoff | `ArrayBlockingQueue`, `LinkedBlockingQueue` with capacity | choose fairness carefully |
| priority work | `PriorityBlockingQueue` | unbounded by default; wrap with capacity guard |

### 14.2 Compound Map Operations Must Be Atomic

Bad:

```java
if (!map.containsKey(key)) {
    map.put(key, createValue());
}
```

Good:

```java
Value value = map.computeIfAbsent(key, this::createValue);
```

### 14.3 Be Careful Inside `compute*` Methods

The mapping function must be:

- short;
- non-blocking;
- side-effect controlled;
- not recursively modifying the same map in dangerous ways.

Do not perform remote calls or database calls inside `computeIfAbsent`.

### 14.4 Bounded Queues For Backpressure

Unbounded queue is forbidden for producer/consumer pipelines unless the producer is naturally bounded and proven.

Good:

```java
BlockingQueue<Job> queue = new ArrayBlockingQueue<>(10_000);
```

Bad:

```java
BlockingQueue<Job> queue = new LinkedBlockingQueue<>(); // unbounded by default
```

---

## 15. Cancellation and Interruption

### 15.1 Interruption Must Be Preserved

Bad:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    // ignore
}
```

Good:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new TaskCancelledException("task interrupted", e);
}
```

### 15.2 Long Loops Must Cooperate

```java
while (hasMoreWork()) {
    if (Thread.currentThread().isInterrupted()) {
        throw new TaskCancelledException("interrupted");
    }
    processNextItem();
}
```

### 15.3 Cancellation Must Clean Up Resources

When task is cancelled:

- close files;
- close sockets/client response bodies;
- rollback transactions;
- release semaphore permits;
- release locks;
- remove thread-local data;
- stop child tasks.

Use `try/finally`.

---

## 16. Timeout and Deadline Rules

### 16.1 Timeout Required For External Work

Every external call must have timeout:

- HTTP connect timeout;
- HTTP request/read timeout;
- database query timeout;
- socket timeout;
- file lock timeout if applicable;
- future wait timeout;
- queue offer/poll timeout;
- lock acquisition timeout where contention can happen.

### 16.2 Prefer Deadline Propagation

Do not give every internal step a fresh full timeout.

Bad:

```text
API request timeout: 5s
DB call timeout: 5s
Remote call timeout: 5s
File write timeout: 5s
```

This can exceed request budget.

Better:

```text
API deadline: now + 5s
Each step receives remaining time.
```

### 16.3 Avoid Infinite Blocking

Forbidden in request path unless specifically justified:

```java
future.get();
queue.take();
lock.lock();
latch.await();
semaphore.acquire();
```

Prefer bounded variants:

```java
future.get(timeout, unit);
queue.poll(timeout, unit);
lock.tryLock(timeout, unit);
latch.await(timeout, unit);
semaphore.tryAcquire(timeout, unit);
```

---

## 17. Backpressure and Bulkhead Rules

Concurrency without backpressure is a failure amplifier.

### 17.1 Required Boundaries

For every producer/consumer or fan-out model, define:

```text
Max producers:
Max consumers:
Queue capacity:
Overflow behavior:
Retry policy:
Timeout:
Metrics:
```

### 17.2 Allowed Overflow Behaviors

- reject with explicit error;
- block with timeout;
- drop only if business explicitly allows loss;
- coalesce duplicate work;
- spill to durable queue;
- degrade gracefully.

Forbidden:

- silently drop important work;
- grow memory unbounded;
- spawn more threads as primary backpressure mechanism;
- retry indefinitely.

### 17.3 Bulkhead External Dependencies

Each downstream dependency should have separate concurrency limit.

Bad:

```text
One global executor for DB, payment, email, report, and audit calls.
```

Better:

```text
DB bulkhead: tied to DB pool capacity
Payment bulkhead: tied to payment API quota
Email bulkhead: tied to SMTP/provider limit
Report bulkhead: tied to CPU/file I/O capacity
```

---

## 18. Scheduling Rules

### 18.1 Scheduled Tasks Must Be Idempotent Or Guarded

A scheduled job must define:

- unique job name;
- overlap policy;
- retry policy;
- lock/distributed lock if multi-node;
- timeout;
- metrics;
- last-success/last-failure state;
- idempotency key if writing data.

### 18.2 No Silent Failure

`ScheduledExecutorService` suppresses subsequent executions for some failure modes depending on scheduling method. Every scheduled task must catch/log/record failure at the boundary.

```java
scheduler.scheduleWithFixedDelay(() -> {
    try {
        runJob();
    } catch (Exception e) {
        logFailure(e);
    }
}, 0, 1, TimeUnit.MINUTES);
```

### 18.3 Fixed Rate vs Fixed Delay

| Method | Meaning | Use When |
|---|---|---|
| `scheduleAtFixedRate` | Attempts regular cadence | task duration is predictable and overlap is not allowed by executor semantics |
| `scheduleWithFixedDelay` | Delay after previous completion | safer for variable duration tasks |

Do not use fixed-rate jobs for work that can exceed the interval unless backlog behavior is acceptable.

---

## 19. ThreadLocal and Context Propagation

### 19.1 ThreadLocal Is Restricted

Allowed:

- framework integration;
- logging MDC with cleanup;
- security context with cleanup;
- legacy API adaptation;
- per-thread reusable object only when memory bounded and lifecycle clear.

Forbidden:

- hidden business parameters;
- large object caches;
- request body storage;
- cross-request state;
- assuming propagation across executor boundaries;
- using `InheritableThreadLocal` with pools or virtual threads without explicit policy.

### 19.2 Cleanup Required

```java
try {
    CONTEXT.set(context);
    return handler.handle(request);
} finally {
    CONTEXT.remove();
}
```

### 19.3 Context Across Async Boundaries

If context must cross async boundary, use explicit wrappers or framework-supported propagation.

Do not assume MDC/security/transaction context automatically follows `CompletableFuture` or executor tasks.

---

## 20. Blocking vs Non-Blocking Rules

### 20.1 Do Not Block Event Loops

If using Netty, Vert.x, reactive framework, servlet async callbacks, or event-loop-like framework:

- do not call blocking JDBC/file/network APIs on event-loop threads;
- offload blocking work to a dedicated executor or virtual-thread boundary if framework supports it;
- document where blocking is allowed.

### 20.2 Do Not Fake Async

Bad:

```java
CompletableFuture.supplyAsync(() -> slowBlockingCall(), commonPool);
```

This only moves the blocking somewhere else.

Acceptable only when:

- executor is designed for blocking;
- capacity is bounded;
- timeout exists;
- failure is observed;
- cancellation is handled.

---

## 21. Database and Transaction Concurrency Rules

### 21.1 Transaction Context Is Thread-Bound In Many Frameworks

Do not assume transactions propagate across threads.

Bad:

```java
@Transactional
void processBatch(List<Order> orders) {
    orders.forEach(order -> executor.submit(() -> repository.save(order)));
}
```

The submitted task may run outside the original transaction context.

Required:

- start transaction inside each worker if intended;
- use application service boundary;
- define isolation/locking/idempotency;
- avoid sharing entity manager/session across threads.

### 21.2 Do Not Share JDBC Connections Across Threads

A JDBC `Connection` must be treated as thread-confined unless the driver and architecture explicitly guarantee otherwise.

Each worker gets its own connection from the pool and closes it promptly.

### 21.3 Batch Parallelism Must Respect DB Capacity

Parallel DB writes must be limited by:

- pool size;
- lock contention;
- transaction isolation;
- deadlock risk;
- index/write amplification;
- retry/idempotency policy.

Do not parallelize database writes blindly.

---

## 22. I/O and Network Concurrency Rules

### 22.1 External Calls Need Per-Dependency Limits

For each external dependency:

```text
Dependency:
Max concurrent calls:
Connect timeout:
Read/request timeout:
Retry policy:
Circuit breaker/bulkhead:
Fallback policy:
Idempotency rule:
```

### 22.2 Do Not Hold Locks During I/O

Bad:

```java
synchronized (lock) {
    Response response = httpClient.send(request, handler);
    state.update(response);
}
```

Good:

```java
Response response = httpClient.send(request, handler);
synchronized (lock) {
    state.update(response);
}
```

### 22.3 Streaming Work Must Have Ownership

For concurrent file/network streaming:

- exactly one owner closes stream/channel;
- cancellation closes the stream;
- buffer ownership is clear;
- partial write/read is handled;
- backpressure is explicit.

---

## 23. Error Handling Rules

### 23.1 Do Not Lose Exceptions

Bad:

```java
executor.submit(() -> doWork());
```

If the returned `Future` is ignored, exception can be effectively lost.

Better:

```java
Future<?> future = executor.submit(() -> doWork());
track(future);
```

or

```java
executor.execute(() -> {
    try {
        doWork();
    } catch (Exception e) {
        logFailure(e);
        throw e;
    }
});
```

### 23.2 Preserve Failure Context

Concurrent failures should record:

- task ID;
- parent request ID;
- dependency name;
- timeout/deadline;
- thread name;
- retry count;
- cancellation status.

### 23.3 Do Not Convert All Failures To RuntimeException Blindly

Preserve interruption:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new TaskCancelledException("interrupted", e);
}
```

Preserve timeout separately:

```java
catch (TimeoutException e) {
    throw new DependencyTimeoutException("payment lookup timed out", e);
}
```

---

## 24. Observability Rules

Concurrent code must be observable.

### 24.1 Required Metrics

For executors:

- active threads;
- pool size;
- queue size;
- completed task count;
- rejected task count;
- task duration;
- wait time in queue;
- error count;
- cancellation count.

For virtual-thread workloads:

- request concurrency;
- downstream bulkhead usage;
- time spent waiting on external resources;
- timeout count;
- pinning diagnostics when relevant;
- memory usage under high concurrency.

For queues:

- depth;
- offer failures;
- poll timeout;
- age of oldest item;
- consumer lag.

### 24.2 Thread Naming

Platform worker threads must be named according to owner and purpose:

```text
<service>-<component>-worker-<n>
report-export-worker-1
payment-retry-scheduler-1
```

Virtual threads may be numerous; rely more on task/request tracing than per-thread names.

### 24.3 Logging

Logs from concurrent code must include correlation identifiers.

Do not rely on thread name alone as request identity.

---

## 25. Testing Rules

### 25.1 Mandatory Tests

Concurrent code must include tests for:

- normal success;
- timeout;
- cancellation/interruption;
- failure propagation;
- rejection/backpressure;
- shutdown;
- duplicate execution/idempotency;
- shared state consistency;
- resource cleanup;
- high-concurrency smoke test.

### 25.2 Avoid Sleep-Based Tests

Bad:

```java
Thread.sleep(1000);
assertTrue(done.get());
```

Better:

```java
assertTrue(latch.await(1, TimeUnit.SECONDS));
```

Prefer deterministic synchronization primitives:

- `CountDownLatch`;
- `CyclicBarrier`;
- `Phaser`;
- fake clock;
- controlled executor;
- test double for external dependency.

### 25.3 Race Tests Are Not Proof

A test that passes 10,000 iterations does not prove thread safety. It can reveal bugs, not prove absence.

Correctness must come from design:

- no shared mutable state;
- safe publication;
- lock discipline;
- atomic invariant;
- documented happens-before relationships.

### 25.4 Use Stress Tests For Critical Low-Level Code

For custom synchronization, atomics, or lock-free code:

- use stress testing tools where available;
- test under different CPU counts;
- test with constrained executor sizes;
- test cancellation under load;
- test JVM shutdown behavior.

---

## 26. Performance Rules

### 26.1 Benchmark Before and After

Concurrency changes require benchmark or production telemetry.

Document:

```text
Baseline latency:
Baseline throughput:
New latency:
New throughput:
CPU usage:
Memory usage:
Queue depth:
Error/timeout rate:
Downstream pressure:
```

### 26.2 CPU-Bound Parallelism

CPU-bound parallelism should not exceed useful CPU capacity.

Rules:

- start near available processors;
- avoid oversubscription;
- avoid blocking in CPU pool;
- separate CPU pool from I/O pool;
- measure context switching and GC effects.

### 26.3 I/O-Bound Parallelism

I/O-bound parallelism is limited by external resources.

Rules:

- tune against DB pool/API quota/file system behavior;
- use virtual threads only if baseline allows;
- still enforce deadline and backpressure;
- measure tail latency, not just average throughput.

### 26.4 Avoid Premature Lock-Free Code

Lock-free algorithms are restricted.

Use them only when:

- contention is proven bottleneck;
- standard concurrent collections are insufficient;
- correctness proof exists;
- stress tests exist;
- memory ordering is documented.

---

## 27. Security Rules For Concurrent Code

### 27.1 No Cross-Request Data Leakage

Shared caches, thread locals, scoped values, and async callbacks must not leak:

- tenant ID;
- user ID;
- authorization context;
- request payload;
- correlation ID;
- secrets.

### 27.2 Authorization Must Be Checked At Execution Boundary

If work is deferred or async, authorization must be valid at execution time or captured as a safe immutable authorization decision.

Do not assume the caller's thread-local security context exists in worker threads.

### 27.3 Secrets Must Not Be Stored In Long-Lived Thread State

Forbidden:

- secrets in `ThreadLocal` caches;
- credentials in executor task names;
- secret values in exception messages/logs;
- long-lived mutable context containing tokens.

---

## 28. Common Anti-Patterns

### 28.1 Fire-And-Forget

Bad:

```java
executor.submit(() -> sendEmail(email));
return Response.accepted().build();
```

Missing:

- durable handoff;
- retry;
- failure observation;
- idempotency;
- shutdown safety.

Better:

- write to outbox/durable queue;
- background worker owns delivery;
- expose status if needed.

### 28.2 Global Executor Dumping Ground

Bad:

```java
static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();
```

Problems:

- no ownership;
- no capacity isolation;
- no shutdown;
- no workload separation;
- hard to test.

### 28.3 Async Over Sync Without Contract

Bad:

```java
CompletableFuture<User> findUser(String id) {
    return CompletableFuture.supplyAsync(() -> repository.findById(id));
}
```

This hides blocking repository call behind async API without defining executor, timeout, transaction, or error handling.

### 28.4 Lock Everything

Bad:

```java
synchronized void handle(Request request) {
    validate(request);
    Response response = remote.call(request);
    repository.save(response);
}
```

This serializes all requests and holds lock during external I/O.

### 28.5 Shared Mutable DTO

Bad:

```java
class ProcessingContext {
    Map<String, Object> values = new HashMap<>();
}
```

When passed across threads, this becomes an untyped mutable race surface.

Use immutable context or explicit typed fields.

---

## 29. LLM Implementation Contract

When generating concurrent Java code, the LLM must follow this process:

1. identify Java baseline;
2. refuse Java-version-incompatible APIs;
3. identify workload type: CPU-bound, blocking I/O, event-driven, scheduled, producer/consumer;
4. avoid concurrency unless justified;
5. define ownership and lifecycle;
6. define capacity bound;
7. define timeout/deadline;
8. define cancellation behavior;
9. define failure propagation;
10. define shared state and synchronization mechanism;
11. define observability;
12. add tests for failure, timeout, cancellation, and shutdown;
13. avoid preview APIs unless explicitly enabled.

### 29.1 Prompt Snippet For Code Agent

```text
You are implementing Java concurrency code.
Before writing code:
- Confirm the Java baseline.
- Do not use APIs above the baseline.
- Do not use preview/incubator APIs unless explicitly allowed.
- Explain why concurrency is needed.
- Classify the workload as CPU-bound, blocking I/O, event-driven, scheduled, or producer/consumer.
- Identify shared mutable state and how it is protected.
- Define executor/thread ownership, capacity limit, timeout, cancellation, failure propagation, and shutdown.

While writing code:
- Prefer ExecutorService over raw Thread.
- Never use parallelStream by default.
- Never block the ForkJoin common pool with I/O.
- Never swallow InterruptedException.
- Never ignore Future/CompletableFuture failures.
- Never use unbounded queues for uncontrolled input.
- Never hold locks during external I/O.
- Use virtual threads only on Java 21+ and only for blocking I/O concurrency.
- Do not pool virtual threads.
- Use scoped values only on Java 25+ and only for immutable contextual data.
- Do not use StructuredTaskScope unless preview features are explicitly allowed.

After writing code:
- Add tests for success, timeout, cancellation, interruption, failure propagation, backpressure/rejection, and shutdown.
- Add observability hooks or state what metrics/logs are emitted.
```

---

## 30. Reviewer Checklist

A concurrency change must be rejected if any answer is missing.

### 30.1 Version and API

- [ ] Java baseline is declared.
- [ ] No API above baseline is used.
- [ ] Preview/incubator APIs are not used unless explicitly allowed.
- [ ] Java 21 virtual-thread behavior is not confused with Java 24/25 improvements.

### 30.2 Design

- [ ] Concurrency is justified.
- [ ] Work units are independent or safely coordinated.
- [ ] Shared state is identified.
- [ ] Synchronization mechanism is appropriate.
- [ ] Ownership/lifecycle is explicit.
- [ ] Executor/thread model is explicit.

### 30.3 Capacity and Backpressure

- [ ] Thread pool size is justified.
- [ ] Queue capacity is bounded.
- [ ] Rejection policy is defined.
- [ ] External dependencies have bulkheads.
- [ ] No unbounded fan-out exists.

### 30.4 Correctness

- [ ] No data race exists.
- [ ] Safe publication is guaranteed.
- [ ] Compound invariants are protected.
- [ ] `volatile` is not misused for compound operation.
- [ ] Locks are not held during I/O.
- [ ] Lock ordering is defined if multiple locks exist.

### 30.5 Failure and Lifecycle

- [ ] Timeout exists for external and blocking operations.
- [ ] Cancellation is propagated.
- [ ] `InterruptedException` is handled correctly.
- [ ] Future/completion failures are observed.
- [ ] Executor shutdown is defined.
- [ ] Resource cleanup happens on cancellation/failure.

### 30.6 Observability and Tests

- [ ] Metrics/logging identify queue depth, active work, rejection, timeout, cancellation, and failure.
- [ ] Tests avoid arbitrary sleeps.
- [ ] Tests cover success/failure/timeout/cancellation/shutdown.
- [ ] Stress tests exist for low-level concurrency primitives.

---

## 31. Recommended Default Patterns

### 31.1 Java 11/17 Blocking I/O Fan-Out

Use bounded platform executor + deadline + downstream bulkhead.

```java
final class FanOutService {
    private final ExecutorService ioExecutor;

    FanOutService(ExecutorService ioExecutor) {
        this.ioExecutor = ioExecutor;
    }

    CombinedResult load(Request request, Duration timeout) throws Exception {
        Future<A> a = ioExecutor.submit(() -> callA(request));
        Future<B> b = ioExecutor.submit(() -> callB(request));

        long deadline = System.nanoTime() + timeout.toNanos();
        try {
            A resultA = a.get(remainingMillis(deadline), TimeUnit.MILLISECONDS);
            B resultB = b.get(remainingMillis(deadline), TimeUnit.MILLISECONDS);
            return combine(resultA, resultB);
        } catch (Exception e) {
            a.cancel(true);
            b.cancel(true);
            throw e;
        }
    }

    private static long remainingMillis(long deadlineNanos) throws TimeoutException {
        long remaining = deadlineNanos - System.nanoTime();
        if (remaining <= 0) {
            throw new TimeoutException("deadline exceeded");
        }
        return TimeUnit.NANOSECONDS.toMillis(remaining);
    }
}
```

### 31.2 Java 21+ Blocking I/O Fan-Out With Virtual Threads

Use virtual thread per task + downstream limits + timeout.

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<A> a = executor.submit(() -> callA(request));
    Future<B> b = executor.submit(() -> callB(request));

    try {
        return combine(
                a.get(2, TimeUnit.SECONDS),
                b.get(2, TimeUnit.SECONDS)
        );
    } catch (Exception e) {
        a.cancel(true);
        b.cancel(true);
        throw e;
    }
}
```

This is intentionally simple. For production, use a shared lifecycle-managed executor where appropriate, dependency-specific timeouts, and better deadline propagation.

### 31.3 Producer/Consumer With Backpressure

```java
final class Worker implements AutoCloseable {
    private final BlockingQueue<Job> queue = new ArrayBlockingQueue<>(1_000);
    private final ExecutorService executor;
    private volatile boolean running = true;

    Worker(ExecutorService executor) {
        this.executor = executor;
    }

    boolean submit(Job job) throws InterruptedException {
        return queue.offer(job, 500, TimeUnit.MILLISECONDS);
    }

    void start() {
        executor.submit(this::runLoop);
    }

    private void runLoop() {
        while (running || !queue.isEmpty()) {
            try {
                Job job = queue.poll(500, TimeUnit.MILLISECONDS);
                if (job != null) {
                    process(job);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                running = false;
            } catch (Exception e) {
                logFailure(e);
            }
        }
    }

    @Override
    public void close() {
        running = false;
        executor.shutdownNow();
    }
}
```

---

## 32. Source Anchors

Use these sources when updating this standard:

1. Java Language Specification, Chapter 17 — Threads and Locks / Java Memory Model.
2. Java SE API documentation — `java.lang.Thread`.
3. Java SE API documentation — `java.util.concurrent`.
4. Java SE API documentation — `java.util.concurrent.locks`.
5. Java SE API documentation — `java.util.concurrent.atomic`.
6. OpenJDK JEP 444 — Virtual Threads.
7. Oracle Java documentation — Virtual Threads.
8. OpenJDK JEP 491 — Synchronize Virtual Threads without Pinning.
9. OpenJDK JEP 505 — Structured Concurrency, fifth preview in JDK 25.
10. OpenJDK JEP 506 — Scoped Values in JDK 25.
11. OpenJDK JEP 428 — Structured Concurrency incubator background.

---

## 33. Final Rule

Concurrent code is accepted only when it makes the system more correct, more observable, and more controllable.

If concurrency only makes the code look advanced, reject it.

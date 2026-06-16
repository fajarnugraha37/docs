# learn-java-concurrency-and-reactive-part-029.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 029
# Testing Concurrent Code: Deterministic Tests, Stress Tests, Race Detection Thinking, Deadlocks, Timeouts, Cancellation, Virtual Threads, Database Concurrency, and Production-Like Validation

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**
> Bagian: **029**
> Fokus: memahami cara menguji kode concurrent Java secara serius. Materi ini membahas unit test deterministic, stress test, liveness test, race condition test, deadlock test, timeout/cancellation test, executor test, virtual-thread test, CompletableFuture test, parallel stream test, database concurrency test, Spring Boot integration test, Testcontainers, Awaitility-style polling, JCStress mental model, fake clocks, barriers/latches, fault injection, load testing, dan observability-driven testing.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Testing Concurrent Code Sulit](#2-kenapa-testing-concurrent-code-sulit)
3. [Apa yang Harus Diuji: Safety dan Liveness](#3-apa-yang-harus-diuji-safety-dan-liveness)
4. [Testing Pyramid untuk Concurrency](#4-testing-pyramid-untuk-concurrency)
5. [Deterministic Unit Tests](#5-deterministic-unit-tests)
6. [Avoid `Thread.sleep` as Primary Synchronization](#6-avoid-threadsleep-as-primary-synchronization)
7. [CountDownLatch](#7-countdownlatch)
8. [CyclicBarrier](#8-cyclicbarrier)
9. [Phaser](#9-phaser)
10. [Semaphore in Tests](#10-semaphore-in-tests)
11. [Awaiting Conditions](#11-awaiting-conditions)
12. [Testing Timeouts](#12-testing-timeouts)
13. [Testing Cancellation and Interruption](#13-testing-cancellation-and-interruption)
14. [Testing Executor Behavior](#14-testing-executor-behavior)
15. [Testing Queue and Backpressure](#15-testing-queue-and-backpressure)
16. [Testing Race Conditions](#16-testing-race-conditions)
17. [Stress Testing](#17-stress-testing)
18. [Repeat Tests and Randomized Scheduling](#18-repeat-tests-and-randomized-scheduling)
19. [JCStress Mental Model](#19-jcstress-mental-model)
20. [Testing Java Memory Model Assumptions](#20-testing-java-memory-model-assumptions)
21. [Testing Locks and Deadlocks](#21-testing-locks-and-deadlocks)
22. [Testing Livelock and Starvation](#22-testing-livelock-and-starvation)
23. [Testing CompletableFuture](#23-testing-completablefuture)
24. [Testing Structured Concurrency](#24-testing-structured-concurrency)
25. [Testing Virtual Threads](#25-testing-virtual-threads)
26. [Testing ThreadLocal and Context Propagation](#26-testing-threadlocal-and-context-propagation)
27. [Testing Parallel Streams](#27-testing-parallel-streams)
28. [Testing Reactive Pipelines](#28-testing-reactive-pipelines)
29. [Testing Database Concurrency](#29-testing-database-concurrency)
30. [Testing Transaction Isolation and Lost Updates](#30-testing-transaction-isolation-and-lost-updates)
31. [Testing Connection Pool Exhaustion](#31-testing-connection-pool-exhaustion)
32. [Testing Distributed Concurrency](#32-testing-distributed-concurrency)
33. [Fault Injection](#33-fault-injection)
34. [Load Testing and Soak Testing](#34-load-testing-and-soak-testing)
35. [Observability-Driven Tests](#35-observabilitydriven-tests)
36. [Test Design Patterns](#36-test-design-patterns)
37. [Mini Case Study: Race in Check-Then-Act Cache](#37-mini-case-study-race-in-checkthenact-cache)
38. [Mini Case Study: Cancellation Leak](#38-mini-case-study-cancellation-leak)
39. [Mini Case Study: DB Lost Update](#39-mini-case-study-db-lost-update)
40. [Common Anti-Patterns](#40-common-antipatterns)
41. [Best Practices](#41-best-practices)
42. [Decision Matrix](#42-decision-matrix)
43. [Latihan](#43-latihan)
44. [Ringkasan](#44-ringkasan)
45. [Referensi](#45-referensi)

---

# 1. Tujuan Bagian Ini

Kode concurrent tidak cukup diuji dengan satu happy-path test.

Concurrency bug biasanya muncul saat:

- dua operasi overlap;
- urutan eksekusi tertentu terjadi;
- timeout terjadi;
- cancellation terjadi;
- queue penuh;
- executor saturated;
- DB lock conflict;
- request di-retry;
- virtual thread dipakai dalam jumlah besar;
- context berpindah thread;
- resource gagal di tengah proses.

Target bagian ini:

```text
Mampu membuat test yang tidak hanya membuktikan happy path,
tetapi juga membuktikan correctness di bawah interleaving,
overload, cancellation, timeout, duplicate execution,
dan partial failure.
```

---

# 2. Kenapa Testing Concurrent Code Sulit

## 2.1 Nondeterministic interleavings

Dua thread bisa berjalan dengan banyak urutan.

Bug muncul hanya pada sebagian kecil interleaving.

## 2.2 Timing-dependent

Test bisa pass di laptop tetapi fail di CI.

## 2.3 Heisenbug

Debugging atau logging mengubah timing sehingga bug hilang.

## 2.4 Sleeps are unreliable

`Thread.sleep(100)` tidak menjamin thread lain sudah mencapai state tertentu.

## 2.5 Environment-dependent

Core count, CPU load, OS scheduler, JVM version, GC, dan container limits dapat mengubah behavior.

## 2.6 Main rule

```text
Concurrent tests should control coordination, not hope timing works.
```

---

# 3. Apa yang Harus Diuji: Safety dan Liveness

## 3.1 Safety

Nothing bad happens.

Examples:

- no lost update;
- no duplicate side effect;
- invariant preserved;
- no data corruption;
- no context leak;
- no stale overwrite;
- no resource leak.

## 3.2 Liveness

Something good eventually happens.

Examples:

- no deadlock;
- no starvation;
- timeout works;
- cancellation completes;
- queue drains;
- shutdown finishes.

## 3.3 Main rule

```text
Concurrent test suites must test both safety and liveness.
```

---

# 4. Testing Pyramid untuk Concurrency

## 4.1 Unit tests

Small deterministic tests untuk:

- atomic operations;
- locks;
- cancellation;
- timeout behavior;
- context capture;
- executor policy.

## 4.2 Component tests

Executor/queue/repository/client wrappers.

## 4.3 Integration tests

Real database, HTTP fake server, broker/container.

## 4.4 Stress tests

Repeated randomized/concurrent execution.

## 4.5 Load tests

System capacity and performance under realistic traffic.

## 4.6 Chaos/fault tests

Delay, timeout, duplicate, crash, reorder.

## 4.7 Main rule

```text
Concurrency correctness needs multiple test layers.
No single test style is enough.
```

---

# 5. Deterministic Unit Tests

A deterministic concurrent test forces specific ordering.

Example goal:

```text
Thread A reaches point X
Thread B reaches point Y
then release both
then assert invariant
```

Use:

- `CountDownLatch`;
- `CyclicBarrier`;
- `Phaser`;
- fake executors;
- controllable clocks;
- stub dependencies that block until released.

## 5.1 Main rule

```text
Deterministic tests replace timing guesses with explicit synchronization.
```

---

# 6. Avoid `Thread.sleep` as Primary Synchronization

Bad:

```java
Thread t = new Thread(service::work);
t.start();

Thread.sleep(100);

assertTrue(service.started());
```

Problems:

- CI may be slow;
- local may be fast;
- sleep too long slows tests;
- sleep too short flakes.

Better:

```java
CountDownLatch started = new CountDownLatch(1);

Thread t = new Thread(() -> {
    started.countDown();
    service.work();
});
t.start();

assertTrue(started.await(1, TimeUnit.SECONDS));
```

## 6.1 When sleep is acceptable

Sleep can be acceptable as small jitter in stress tests or to simulate backoff, but not as the main synchronization mechanism.

## 6.2 Main rule

```text
Sleep is not synchronization.
Use latches/barriers/conditions.
```

---

# 7. CountDownLatch

`CountDownLatch` waits until count reaches zero.

Use for:

- waiting until worker starts;
- releasing many threads simultaneously;
- waiting for completion.

## 7.1 Example: simultaneous start

```java
int workers = 20;
CountDownLatch ready = new CountDownLatch(workers);
CountDownLatch start = new CountDownLatch(1);
CountDownLatch done = new CountDownLatch(workers);

for (int i = 0; i < workers; i++) {
    Thread.ofPlatform().start(() -> {
        try {
            ready.countDown();
            start.await();
            service.increment();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            done.countDown();
        }
    });
}

assertTrue(ready.await(1, TimeUnit.SECONDS));
start.countDown();
assertTrue(done.await(5, TimeUnit.SECONDS));
```

## 7.2 Main rule

```text
CountDownLatch is useful for one-shot coordination in tests.
```

---

# 8. CyclicBarrier

`CyclicBarrier` lets multiple threads meet at same point.

Use for:

- start line;
- repeated phases;
- forcing collision.

Example:

```java
CyclicBarrier barrier = new CyclicBarrier(2);

Thread t1 = Thread.ofPlatform().start(() -> {
    await(barrier);
    service.operationA();
});

Thread t2 = Thread.ofPlatform().start(() -> {
    await(barrier);
    service.operationB();
});
```

## 8.1 Main rule

```text
CyclicBarrier is useful when multiple participants must begin a race together.
```

---

# 9. Phaser

`Phaser` supports dynamic parties and phases.

Useful for:

- multi-step tests;
- dynamic workers;
- repeated synchronization.

Example phases:

```text
phase 0: all ready
phase 1: all read initial state
phase 2: all attempt update
phase 3: verify
```

## 9.1 Main rule

```text
Phaser is a flexible barrier for multi-phase concurrency tests.
```

---

# 10. Semaphore in Tests

Semaphores can intentionally block or release dependency.

Example fake dependency:

```java
final class BlockingDependency {
    private final Semaphore entered = new Semaphore(0);
    private final Semaphore release = new Semaphore(0);

    String call() throws InterruptedException {
        entered.release();
        release.acquire();
        return "ok";
    }

    void awaitEntered() throws InterruptedException {
        entered.acquire();
    }

    void release() {
        release.release();
    }
}
```

## 10.1 Main rule

```text
A test double with semaphore can control exactly when a dependency returns.
```

---

# 11. Awaiting Conditions

Many concurrent assertions need eventual checking.

Pseudo-pattern:

```java
awaitUntil(() -> metric.count() == 5, Duration.ofSeconds(2));
```

Avoid:

```java
Thread.sleep(2000);
assertEquals(5, metric.count());
```

## 11.1 Polling should have timeout

Never wait forever.

## 11.2 Main rule

```text
Eventually assertions need bounded polling, not fixed sleep.
```

---

# 12. Testing Timeouts

Timeout test should prove:

- operation fails within expected bound;
- resource released;
- child work cancelled or ignored;
- metric/log emitted;
- caller receives correct error.

Example:

```java
assertThrows(TimeoutException.class, () ->
    service.callWithTimeout(Duration.ofMillis(100))
);
```

But also assert cleanup:

```java
assertEquals(0, bulkhead.inFlight());
```

## 12.1 Main rule

```text
Timeout tests must assert both failure and cleanup.
```

---

# 13. Testing Cancellation and Interruption

Cancellation test should verify:

- task observes cancellation/interruption;
- blocking call unblocks;
- interrupted status restored or propagated;
- resources closed;
- no background leak.

Example:

```java
Future<?> future = executor.submit(service::runBlocking);
awaitUntil(service::hasStarted, Duration.ofSeconds(1));

future.cancel(true);

assertTrue(service.cleanedUp());
```

## 13.1 Main rule

```text
Cancellation tests should prove the task stops, not merely that cancel() was called.
```

---

# 14. Testing Executor Behavior

For executor wrappers, test:

- task accepted;
- task rejected when queue full;
- task timeout;
- queue wait metric;
- task duration metric;
- shutdown behavior;
- exception handling;
- thread naming;
- context propagation.

## 14.1 Fake direct executor

For deterministic tests:

```java
Executor direct = Runnable::run;
```

But direct executor hides async bugs.

Use carefully.

## 14.2 Main rule

```text
Test executor policy: acceptance, rejection, failure, shutdown, and metrics.
```

---

# 15. Testing Queue and Backpressure

Test bounded queue:

## 15.1 Queue full

Fill queue, then offer another item.

Expected:

- returns false;
- throws ServiceBusy;
- increments rejection metric.

## 15.2 Slow consumer

Consumer blocked, producer fills queue.

## 15.3 Shutdown

Consumer unblocks and exits.

## 15.4 Main rule

```text
Backpressure test must fill the boundary intentionally.
```

---

# 16. Testing Race Conditions

Race test structure:

1. Arrange shared state.
2. Start multiple workers together.
3. Force overlapping operation.
4. Wait completion.
5. Assert invariant.
6. Repeat many times.

Example:

```java
for (int run = 0; run < 10_000; run++) {
    testConcurrentIncrementOnce();
}
```

## 16.1 Race tests can still miss bugs

Passing stress test does not prove absence.

But failing test proves bug.

## 16.2 Main rule

```text
Race tests increase confidence but do not prove correctness by themselves.
```

---

# 17. Stress Testing

Stress test runs many operations with many interleavings.

Parameters:

- thread count;
- iterations;
- random delays;
- random operation mix;
- timeout;
- assertions after each run.

## 17.1 Example target

- cache consistency;
- queue no lost item;
- no duplicate id;
- counter final value;
- lock ordering no deadlock.

## 17.2 Main rule

```text
Stress tests are bug-finders, not formal proofs.
```

---

# 18. Repeat Tests and Randomized Scheduling

JUnit repeated test:

```java
@RepeatedTest(1000)
void concurrentScenario() {
    ...
}
```

Randomized jitter:

```java
Thread.sleep(ThreadLocalRandom.current().nextInt(0, 3));
```

## 18.1 Seed randomness

Log seed so failure can be reproduced.

## 18.2 Main rule

```text
Randomized tests should record seed and scenario parameters.
```

---

# 19. JCStress Mental Model

JCStress is an OpenJDK tool for testing concurrency and Java Memory Model behaviors.

It runs tests many times under different interleavings and observes outcomes.

Useful for:

- low-level concurrency primitives;
- visibility;
- atomicity;
- reordering;
- publication;
- lock-free algorithms.

## 19.1 Not for typical service integration tests

Use it for concurrency libraries and low-level correctness.

## 19.2 Main rule

```text
For JMM-level questions, normal unit tests are insufficient; use stress harness thinking or tools like JCStress.
```

---

# 20. Testing Java Memory Model Assumptions

Examples:

- unsafe publication;
- missing volatile;
- broken double-checked locking;
- final field semantics;
- AtomicReference CAS.

## 20.1 Unit tests may pass

JMM bugs may not reproduce reliably.

## 20.2 Better

- avoid writing low-level lock-free code unless necessary;
- use standard concurrency utilities;
- use JCStress for custom primitives.

## 20.3 Main rule

```text
Do not validate custom memory-model code with one normal unit test.
```

---

# 21. Testing Locks and Deadlocks

## 21.1 Lock ordering test

Force two operations opposite directions.

Example account transfer:

```text
transfer(A,B)
transfer(B,A)
```

Assert both finish within timeout.

```java
assertTimeoutPreemptively(Duration.ofSeconds(2), () -> {
    runBothTransfers();
});
```

## 21.2 Caution

Preemptive timeout can interrupt test thread in ways that leave background tasks.

Clean up executors.

## 21.3 Main rule

```text
Deadlock tests need bounded completion assertion and reliable cleanup.
```

---

# 22. Testing Livelock and Starvation

Livelock test:

- operations keep retrying;
- assert progress within timeout;
- assert retry budget/backoff used.

Starvation test:

- low priority eventually executes;
- fair lock/queue policy respected;
- no tenant monopolizes capacity.

## 22.1 Main rule

```text
Liveness tests assert eventual progress under contention.
```

---

# 23. Testing CompletableFuture

Test:

- success path;
- exception path;
- timeout path;
- cancellation;
- executor selection;
- no common pool accidental use;
- callback order if important;
- no blocking on same executor.

## 23.1 Bad test

```java
future.join();
```

with no timeout.

Better:

```java
future.get(1, TimeUnit.SECONDS);
```

## 23.2 Main rule

```text
CompletableFuture tests should always bound waits and assert exceptional completion.
```

---

# 24. Testing Structured Concurrency

Test:

- all children success;
- one child fails and siblings cancel;
- timeout cancels children;
- results joined correctly;
- resources closed after scope;
- exceptions propagated with useful context.

## 24.1 Main rule

```text
Structured concurrency tests should verify parent-child lifecycle, not only final result.
```

---

# 25. Testing Virtual Threads

Test virtual-thread code for:

- high number of blocking tasks;
- resource limits;
- ThreadLocal cleanup;
- cancellation;
- pinning-sensitive regions;
- executor close behavior;
- memory pressure.

Example:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<String>> futures = IntStream.range(0, 1000)
        .mapToObj(i -> executor.submit(() -> blockingCall(i)))
        .toList();

    for (Future<String> f : futures) {
        assertNotNull(f.get(2, TimeUnit.SECONDS));
    }
}
```

## 25.1 Do not assert exact thread scheduling

Avoid brittle tests based on exact thread names/order.

## 25.2 Main rule

```text
Virtual-thread tests should assert resource governance and lifecycle, not scheduler internals.
```

---

# 26. Testing ThreadLocal and Context Propagation

Test:

- context available in request thread;
- context propagated to async task if intended;
- context cleared after task;
- request A does not leak into request B;
- missing context fails fast.

## 26.1 Example principle

```java
assertThrows(MissingTenantContextException.class, () ->
    asyncWorker.runWithoutContext()
);
```

## 26.2 Main rule

```text
Context propagation tests should include both propagation and cleanup.
```

---

# 27. Testing Parallel Streams

Test:

- sequential and parallel produce same result;
- operation has no side effects;
- reduction associative;
- ordering expectations;
- no DB/HTTP calls inside stream;
- performance benchmark if used for speed.

## 27.1 Example

```java
var sequential = items.stream()
    .map(this::process)
    .toList();

var parallel = items.parallelStream()
    .map(this::process)
    .toList();

assertEquals(sequential, parallel);
```

If order not guaranteed, compare as set/multiset.

## 27.2 Main rule

```text
Parallel stream correctness should be compared against sequential semantics.
```

---

# 28. Testing Reactive Pipelines

Test:

- demand/backpressure;
- scheduler boundaries;
- timeout;
- cancellation;
- error path;
- context propagation;
- no blocking event loop;
- retry policy.

Use framework-specific test utilities where available.

## 28.1 Main rule

```text
Reactive tests should assert signals: onNext, onError, onComplete, cancellation, and demand.
```

---

# 29. Testing Database Concurrency

Use real database where possible.

Mocks cannot simulate:

- locks;
- isolation;
- deadlocks;
- MVCC;
- connection pool;
- transaction timeout.

Tools:

- Testcontainers;
- embedded DB only if behavior matches enough;
- dedicated integration test DB.

## 29.1 Main rule

```text
Database concurrency correctness must be tested against a real database engine.
```

---

# 30. Testing Transaction Isolation and Lost Updates

Scenario:

1. Tx1 reads row.
2. Tx2 reads same row.
3. Tx1 updates.
4. Tx2 updates.
5. Assert final state/conflict behavior.

Use latches/barriers to force overlap.

## 30.1 Expected outcomes

Depending design:

- optimistic lock exception;
- one update rejected;
- serializable retry needed;
- atomic SQL prevents invalid balance.

## 30.2 Main rule

```text
Lost update tests must force concurrent read-modify-write overlap.
```

---

# 31. Testing Connection Pool Exhaustion

Configure small pool:

```text
maximumPoolSize = 2
connectionTimeout = 100ms
```

Start several transactions that hold connection.

Assert next request:

- times out;
- returns ServiceBusy/503;
- releases resources;
- metric increments.

## 31.1 Main rule

```text
Pool exhaustion should be a tested failure mode, not a production surprise.
```

---

# 32. Testing Distributed Concurrency

Test:

- duplicate command with same idempotency key;
- duplicate message delivery;
- stale event version;
- out-of-order events;
- lease expiry;
- fencing token rejection;
- scheduler multi-instance behavior;
- retry after timeout unknown outcome.

## 32.1 Main rule

```text
Distributed concurrency tests should simulate duplicate, reorder, timeout, and stale ownership.
```

---

# 33. Fault Injection

Inject:

- slow DB;
- DB deadlock;
- HTTP timeout;
- HTTP 500;
- message duplicate;
- broker delay;
- executor rejection;
- queue full;
- clock jump if relevant;
- cancellation.

## 33.1 Fault injection target

Not to break randomly, but to validate failure policy.

## 33.2 Main rule

```text
Fault injection tests prove the system fails in the way you designed.
```

---

# 34. Load Testing and Soak Testing

## 34.1 Load test

High traffic for capacity.

## 34.2 Soak test

Moderate traffic for long duration.

Finds:

- leaks;
- queue growth;
- ThreadLocal retention;
- connection leak;
- slow memory growth;
- retry accumulation.

## 34.3 Main rule

```text
Some concurrency bugs require time, not just traffic.
```

---

# 35. Observability-Driven Tests

A test should sometimes assert metrics/logs/traces.

Example:

- timeout metric increments;
- queue rejection metric increments;
- correlation ID appears in async log;
- DB pool wait recorded;
- cancellation count recorded.

## 35.1 Why

Production diagnosis depends on these signals.

## 35.2 Main rule

```text
If an incident depends on a metric, test that the metric exists and changes.
```

---

# 36. Test Design Patterns

## 36.1 Controlled blocking dependency

Dependency blocks until test releases it.

## 36.2 Start gate

All workers start together.

## 36.3 Completion gate

Test waits for all workers.

## 36.4 Small pool amplification

Use tiny pool to reproduce saturation.

## 36.5 Deterministic fake clock

Test deadlines without real sleeping.

## 36.6 Idempotency replay

Send same command twice.

## 36.7 Failure script

Dependency returns success/failure/timeouts in scripted order.

## 36.8 Main rule

```text
Good concurrency tests build controllable worlds.
```

---

# 37. Mini Case Study: Race in Check-Then-Act Cache

## 37.1 Broken

```java
if (!cache.containsKey(key)) {
    cache.put(key, loader.load(key));
}
return cache.get(key);
```

Two threads may load same key twice.

## 37.2 Test

- loader blocks;
- two threads call `get(key)` together;
- release loader;
- assert loader called once.

## 37.3 Fix

```java
cache.computeIfAbsent(key, loader::load);
```

or future cache with failure eviction.

## 37.4 Lesson

```text
Race tests should assert side-effect count, not only final value.
```

---

# 38. Mini Case Study: Cancellation Leak

## 38.1 Problem

Service times out but child task keeps running.

## 38.2 Test

- child dependency blocks;
- call service with short timeout;
- assert timeout returned;
- assert child cancelled/interrupted;
- assert semaphore released;
- assert no in-flight tasks.

## 38.3 Lesson

```text
Timeout without cancellation can leak resource usage.
```

---

# 39. Mini Case Study: DB Lost Update

## 39.1 Broken

Two concurrent transactions read same balance and write back.

## 39.2 Test

Use barriers to ensure both read before either writes.

## 39.3 Fix

- version column;
- atomic SQL;
- row lock;
- serializable with retry.

## 39.4 Lesson

```text
Database race tests must force the exact interleaving that causes anomaly.
```

---

# 40. Common Anti-Patterns

## 40.1 Sleeping instead of synchronizing

Flaky.

## 40.2 Waiting forever in tests

CI hang.

## 40.3 Testing only final happy result

Misses cleanup/leaks.

## 40.4 Mocking database for isolation bugs

False confidence.

## 40.5 Ignoring exceptional completion

CompletableFuture errors hidden.

## 40.6 Not cleaning executors

Test suite leaks threads.

## 40.7 No repeated/stress tests

Rare interleavings missed.

## 40.8 Asserting exact scheduling order

Brittle.

## 40.9 No timeout around liveness test

Deadlock hangs build.

## 40.10 Not testing observability

Production debugging blind.

---

# 41. Best Practices

## 41.1 Bound every wait in tests

Use timeouts.

## 41.2 Use latches/barriers/phasers

Control interleaving.

## 41.3 Test both success and failure path

Especially timeout/cancel/retry.

## 41.4 Test cleanup

Resources released.

## 41.5 Use real DB for DB concurrency

Testcontainers if possible.

## 41.6 Use small capacities to force overload

Pool size 1 or 2.

## 41.7 Repeat race-prone tests

Stress.

## 41.8 Compare parallel to sequential

For parallel algorithms.

## 41.9 Assert metrics for failure modes

Timeout/rejection/cancellation.

## 41.10 Clean up executors

Use try-with-resources or shutdown.

---

# 42. Decision Matrix

| Need | Test Strategy |
|---|---|
| Race in shared state | barrier/latch + repeated stress |
| Timeout behavior | fake blocking dependency + bounded assert |
| Cancellation | blocking dependency + cancel + cleanup assertion |
| Executor rejection | tiny bounded queue |
| Queue backpressure | fill queue intentionally |
| Deadlock prevention | opposite operations + assert finishes |
| Starvation | fairness/progress assertion |
| CompletableFuture | explicit executor + get timeout + exceptional assertions |
| Virtual threads | many blocking tasks + resource limit assertions |
| ThreadLocal context | propagation + cleanup tests |
| Parallel stream | compare sequential/parallel |
| DB lost update | real DB + forced overlapping transactions |
| Pool exhaustion | tiny pool + held connections |
| Distributed duplicate | replay same idempotency key/message |
| Stale event | out-of-order version test |
| Observability | assert metric/log emitted |

---

# 43. Latihan

## Latihan 1 — Latch Start Gate

Buat test 20 thread yang start bersamaan memakai `CountDownLatch`.

## Latihan 2 — Check-Then-Act Cache

Buat test yang membuktikan loader dipanggil dua kali pada cache broken.

## Latihan 3 — Timeout Cleanup

Buat fake dependency yang block, lalu test timeout me-release semaphore.

## Latihan 4 — Executor Rejection

Buat `ThreadPoolExecutor` queue kecil dan assert rejection.

## Latihan 5 — Deadlock Test

Buat transfer A->B dan B->A lalu assert selesai dalam 2 detik.

## Latihan 6 — Lost Update

Dengan real DB, paksa dua transaksi membaca nilai sama sebelum update.

## Latihan 7 — Context Propagation

Test MDC/correlationId di `@Async`.

## Latihan 8 — Virtual Thread Limit

Submit 1000 virtual thread tasks tetapi limit DB permits 10; assert in-flight max tidak melebihi 10.

## Latihan 9 — Duplicate Message

Test consumer menerima message sama dua kali tetapi side effect hanya sekali.

## Latihan 10 — Observability Assertion

Test queue full meningkatkan metric `queue.rejected`.

---

# 44. Ringkasan

Testing concurrent code harus menguji interleaving, failure, cleanup, dan progress.

Core lessons:

- Concurrent bugs nondeterministic dan timing-dependent.
- Test harus mengontrol koordinasi, bukan berharap timing.
- Safety dan liveness sama-sama harus diuji.
- `Thread.sleep` bukan synchronization.
- `CountDownLatch`, `CyclicBarrier`, `Phaser`, dan `Semaphore` sangat berguna untuk test concurrency.
- Awaiting conditions harus bounded.
- Timeout tests harus assert cleanup.
- Cancellation tests harus membuktikan task benar-benar berhenti.
- Executor tests harus mencakup acceptance, rejection, failure, shutdown, metrics.
- Race tests meningkatkan confidence tetapi bukan proof.
- Stress tests mencari bug; JCStress cocok untuk JMM-level primitives.
- Deadlock/livelock/starvation tests harus assert progress within timeout.
- CompletableFuture tests harus bounded dan assert exceptional completion.
- Virtual-thread tests fokus pada resource governance/lifecycle.
- Context propagation tests harus include cleanup.
- Parallel stream tests dibandingkan dengan sequential semantics.
- Database concurrency tests butuh real DB.
- Distributed concurrency tests harus simulate duplicate, reorder, timeout, stale owner.
- Fault injection memvalidasi failure policy.
- Load/soak test menemukan capacity bugs dan leaks.
- Observability-driven tests memastikan production signals tersedia.

Main rule:

```text
A good concurrent test does not ask “does it work once?”
It asks “does it stay correct when operations overlap,
resources are full, timeouts happen, cancellation fires,
messages duplicate, and failures occur?”
```

---

# 45. Referensi

1. Java SE 25 — `CountDownLatch`
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CountDownLatch.html

2. Java SE 25 — `CyclicBarrier`
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CyclicBarrier.html

3. Java SE 25 — `Phaser`
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Phaser.html

4. Java SE 25 — `Semaphore`
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html

5. Java SE 25 — `CompletableFuture`
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html

6. Java SE 25 — `ExecutorService`
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html

7. Java SE 25 — Virtual Threads Guide
   https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html

8. OpenJDK JCStress
   https://openjdk.org/projects/code-tools/jcstress/

9. Testcontainers Documentation
   https://testcontainers.com/

10. JUnit 5 User Guide
    https://junit.org/junit5/docs/current/user-guide/

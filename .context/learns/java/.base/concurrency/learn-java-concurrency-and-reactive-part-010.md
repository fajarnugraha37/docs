# learn-java-concurrency-and-reactive-part-010.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 010  
# Explicit Locks and Coordination Primitives: ReentrantLock, Condition, ReadWriteLock, StampedLock, Semaphore, CountDownLatch, CyclicBarrier, Phaser, Exchanger, and Production Coordination Design

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **010**  
> Fokus: memahami explicit locks dan coordination primitives di `java.util.concurrent`. Kita akan membahas kapan `synchronized` cukup dan kapan perlu `Lock`, `ReentrantLock`, `Condition`, `ReadWriteLock`, `ReentrantReadWriteLock`, `StampedLock`, `Semaphore`, `CountDownLatch`, `CyclicBarrier`, `Phaser`, `Exchanger`, fairness, interruptible lock acquisition, timed `tryLock`, multiple condition queues, resource permits, startup gates, phase barriers, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Dari Intrinsic Lock ke Explicit Lock](#2-dari-intrinsic-lock-ke-explicit-lock)
3. [Kapan `synchronized` Sudah Cukup](#3-kapan-synchronized-sudah-cukup)
4. [Kapan Butuh Explicit Lock](#4-kapan-butuh-explicit-lock)
5. [`Lock` Interface](#5-lock-interface)
6. [`ReentrantLock`](#6-reentrantlock)
7. [Basic Pattern: `lock` / `try` / `finally` / `unlock`](#7-basic-pattern-lock--try--finally--unlock)
8. [Reentrancy and Hold Count](#8-reentrancy-and-hold-count)
9. [Fair vs Non-Fair Locks](#9-fair-vs-non-fair-locks)
10. [`tryLock`](#10-trylock)
11. [Timed `tryLock`](#11-timed-trylock)
12. [`lockInterruptibly`](#12-lockinterruptibly)
13. [When Explicit Locks Improve Failure Handling](#13-when-explicit-locks-improve-failure-handling)
14. [`Condition`: Multiple Wait Sets](#14-condition-multiple-wait-sets)
15. [`await`, `signal`, `signalAll`](#15-await-signalsignalall)
16. [Bounded Buffer with `Condition`](#16-bounded-buffer-with-condition)
17. [`ReadWriteLock`](#17-readwritelock)
18. [`ReentrantReadWriteLock`](#18-reentrantreadwritelock)
19. [Read Lock vs Write Lock](#19-read-lock-vs-write-lock)
20. [Read-Write Lock Pitfalls](#20-read-write-lock-pitfalls)
21. [`StampedLock`](#21-stampedlock)
22. [Optimistic Read](#22-optimistic-read)
23. [StampedLock Pitfalls](#23-stampedlock-pitfalls)
24. [`Semaphore`](#24-semaphore)
25. [Semaphore as Resource Guard](#25-semaphore-as-resource-guard)
26. [Binary Semaphore vs Lock](#26-binary-semaphore-vs-lock)
27. [`CountDownLatch`](#27-countdownlatch)
28. [`CyclicBarrier`](#28-cyclicbarrier)
29. [`Phaser`](#29-phaser)
30. [`Exchanger`](#30-exchanger)
31. [Choosing Coordination Primitive](#31-choosing-coordination-primitive)
32. [Coordination and Virtual Threads](#32-coordination-and-virtual-threads)
33. [Timeouts, Cancellation, and Interrupts](#33-timeouts-cancellation-and-interrupts)
34. [Memory Consistency Effects](#34-memory-consistency-effects)
35. [Observability and Diagnostics](#35-observability-and-diagnostics)
36. [Mini Case Study: Downstream Bulkhead with Semaphore](#36-mini-case-study-downstream-bulkhead-with-semaphore)
37. [Mini Case Study: Startup Gate with CountDownLatch](#37-mini-case-study-startup-gate-with-countdownlatch)
38. [Mini Case Study: Parallel Phase Computation with Phaser](#38-mini-case-study-parallel-phase-computation-with-phaser)
39. [Common Bugs](#39-common-bugs)
40. [Best Practices](#40-best-practices)
41. [Decision Matrix](#41-decision-matrix)
42. [Latihan](#42-latihan)
43. [Ringkasan](#43-ringkasan)
44. [Referensi](#44-referensi)

---

# 1. Tujuan Bagian Ini

Di part 009, kita mempelajari intrinsic lock dan `synchronized`.

`synchronized` sangat penting dan sering cukup.

Namun, Java menyediakan explicit locks dan coordination primitives yang memberi kemampuan lebih:

```java
ReentrantLock
Condition
ReadWriteLock
ReentrantReadWriteLock
StampedLock
Semaphore
CountDownLatch
CyclicBarrier
Phaser
Exchanger
```

Bagian ini menjawab:

```text
Kapan synchronized cukup?
Kapan ReentrantLock lebih tepat?
Apa bedanya wait/notify dengan Condition?
Kapan ReadWriteLock membantu?
Apa bahaya ReadWriteLock?
Apa itu StampedLock optimistic read?
Kapan Semaphore lebih tepat daripada lock?
Apa bedanya CountDownLatch, CyclicBarrier, dan Phaser?
Bagaimana primitive ini dipakai di production?
Bagaimana timeout dan interrupt masuk ke desain coordination?
```

Target akhir:

```text
Mampu memilih primitive koordinasi berdasarkan semantics,
bukan berdasarkan “API yang terlihat canggih”.
```

---

# 2. Dari Intrinsic Lock ke Explicit Lock

Intrinsic lock:

```java
synchronized (lock) {
    // critical section
}
```

Explicit lock:

```java
lock.lock();
try {
    // critical section
} finally {
    lock.unlock();
}
```

## 2.1 Apa yang sama?

Keduanya bisa memberi:

- mutual exclusion;
- visibility;
- critical section;
- reentrancy untuk `synchronized` dan `ReentrantLock`.

## 2.2 Apa yang berbeda?

Explicit lock dapat memberi:

- `tryLock`;
- timed lock acquisition;
- interruptible lock acquisition;
- fairness option;
- multiple condition queues;
- lock state inspection;
- read/write lock forms.

## 2.3 Main rule

```text
Use synchronized for simplicity.
Use explicit Lock when you need features synchronized does not provide.
```

---

# 3. Kapan `synchronized` Sudah Cukup

Gunakan `synchronized` jika:

- critical section sederhana;
- tidak butuh timed acquire;
- tidak butuh interruptible acquire;
- tidak butuh fairness;
- hanya satu condition wait set cukup;
- lock scope jelas;
- readability penting;
- contention rendah/moderate;
- invariant lebih penting dari micro-optimization.

Example:

```java
final class Counter {
    private final Object lock = new Object();
    private long value;

    long incrementAndGet() {
        synchronized (lock) {
            return ++value;
        }
    }
}
```

## 3.1 Main rule

```text
Do not replace synchronized with ReentrantLock just to look advanced.
```

---

# 4. Kapan Butuh Explicit Lock

Explicit lock lebih tepat ketika butuh:

## 4.1 Try without waiting forever

```java
if (lock.tryLock()) {
    ...
}
```

## 4.2 Timed wait for lock

```java
if (lock.tryLock(100, TimeUnit.MILLISECONDS)) {
    ...
}
```

## 4.3 Interruptible lock acquisition

```java
lock.lockInterruptibly();
```

## 4.4 Multiple condition variables

```java
Condition notFull = lock.newCondition();
Condition notEmpty = lock.newCondition();
```

## 4.5 Fairness option

```java
new ReentrantLock(true);
```

## 4.6 Read-write separation

```java
ReentrantReadWriteLock
```

## 4.7 Main rule

```text
Choose explicit locks for explicit coordination requirements.
```

---

# 5. `Lock` Interface

`Lock` provides methods like:

```java
void lock();
void lockInterruptibly() throws InterruptedException;
boolean tryLock();
boolean tryLock(long time, TimeUnit unit) throws InterruptedException;
void unlock();
Condition newCondition();
```

The `java.util.concurrent.locks` package provides a framework for locking and waiting for conditions distinct from built-in synchronization and monitors.

## 5.1 Main difference from synchronized

With `synchronized`, acquire/release is structured by block.

With `Lock`, you must release manually.

## 5.2 Danger

Forgetting unlock causes deadlock.

## 5.3 Main rule

```text
Explicit Lock gives power by making locking explicit.
That also makes mistakes explicit.
```

---

# 6. `ReentrantLock`

`ReentrantLock` is the main implementation of `Lock`.

Java SE 25 docs describe `ReentrantLock` as owned by the thread that most recently successfully locked it and not yet unlocked it; if current thread already owns it, acquiring returns immediately and hold count increases.

## 6.1 Create

```java
private final ReentrantLock lock = new ReentrantLock();
```

Fair:

```java
private final ReentrantLock fairLock = new ReentrantLock(true);
```

## 6.2 Use

```java
lock.lock();
try {
    updateState();
} finally {
    lock.unlock();
}
```

## 6.3 Main rule

```text
ReentrantLock is synchronized with extra operational controls.
```

---

# 7. Basic Pattern: `lock` / `try` / `finally` / `unlock`

Always:

```java
lock.lock();
try {
    // protected state
} finally {
    lock.unlock();
}
```

Never:

```java
lock.lock();
doWork();
lock.unlock();
```

If `doWork()` throws, lock is never released.

## 7.1 Example

```java
final class SafeCounter {
    private final ReentrantLock lock = new ReentrantLock();
    private long value;

    long incrementAndGet() {
        lock.lock();
        try {
            return ++value;
        } finally {
            lock.unlock();
        }
    }
}
```

## 7.2 Main rule

```text
Every successful lock acquisition must have unlock in finally.
```

---

# 8. Reentrancy and Hold Count

Reentrant means same thread can acquire lock multiple times.

```java
lock.lock();
try {
    lock.lock();
    try {
        ...
    } finally {
        lock.unlock();
    }
} finally {
    lock.unlock();
}
```

Must unlock same number of times.

## 8.1 Inspection

```java
lock.isHeldByCurrentThread();
lock.getHoldCount();
```

Useful mostly for diagnostics/assertions.

## 8.2 Main rule

```text
Reentrant lock acquisition increments hold count;
lock is released only when hold count returns to zero.
```

---

# 9. Fair vs Non-Fair Locks

Default `ReentrantLock` is non-fair.

```java
new ReentrantLock();
```

Fair:

```java
new ReentrantLock(true);
```

## 9.1 Fairness

Fair lock tends to grant access to longest-waiting thread under contention.

## 9.2 Trade-off

Fairness can reduce throughput because it limits barging and may increase context switching.

## 9.3 Non-fair

Often higher throughput but potential starvation under pathological contention.

## 9.4 Main rule

```text
Use fairness for starvation-sensitive coordination,
not as default performance tuning.
```

---

# 10. `tryLock`

`tryLock` attempts immediate acquisition.

```java
if (lock.tryLock()) {
    try {
        doProtectedWork();
    } finally {
        lock.unlock();
    }
} else {
    fallback();
}
```

## 10.1 Use cases

- avoid deadlock;
- opportunistic work;
- fail fast;
- best-effort cache refresh;
- avoid blocking request thread.

## 10.2 Risk

If fallback not designed, work may be skipped incorrectly.

## 10.3 Main rule

```text
tryLock is for “do this only if available now” semantics.
```

---

# 11. Timed `tryLock`

```java
if (lock.tryLock(100, TimeUnit.MILLISECONDS)) {
    try {
        doWork();
    } finally {
        lock.unlock();
    }
} else {
    throw new TimeoutException("Could not acquire lock");
}
```

## 11.1 Use cases

- avoid waiting forever;
- honor request deadline;
- fail fast under contention;
- prevent deadlock-like waits.

## 11.2 Interruptible

Timed `tryLock` can throw `InterruptedException`.

Handle correctly:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw e;
}
```

## 11.3 Main rule

```text
Timed tryLock converts lock contention into explicit timeout behavior.
```

---

# 12. `lockInterruptibly`

```java
lock.lockInterruptibly();
try {
    doWork();
} finally {
    lock.unlock();
}
```

## 12.1 Why useful

If a thread waits for lock and cancellation happens, it can stop waiting.

With normal `lock()`, waiting is not interruptible in the same way.

## 12.2 Use cases

- shutdown-sensitive workers;
- request deadline/cancellation;
- long lock waits;
- avoiding stuck shutdown.

## 12.3 Main rule

```text
Use lockInterruptibly when waiting for lock should respect cancellation.
```

---

# 13. When Explicit Locks Improve Failure Handling

Intrinsic lock:

```java
synchronized (lock) {
    ...
}
```

No way to:

- wait only 100ms;
- fail if lock unavailable;
- respond to interrupt before entering;
- inspect queue length directly.

Explicit lock can express:

```text
if cannot acquire quickly, return 503
if cancelled, stop waiting
if contended, emit metric
```

Example:

```java
long start = System.nanoTime();

if (!lock.tryLock(50, TimeUnit.MILLISECONDS)) {
    metrics.incrementLockTimeout();
    throw new ServiceBusyException();
}

try {
    metrics.recordLockWait(System.nanoTime() - start);
    doProtectedWork();
} finally {
    lock.unlock();
}
```

## 13.1 Main rule

```text
Explicit locks make lock acquisition a controllable operation.
```

---

# 14. `Condition`: Multiple Wait Sets

With intrinsic monitor, each object has one wait set.

With `Condition`, one `Lock` can have multiple condition queues.

```java
ReentrantLock lock = new ReentrantLock();
Condition notFull = lock.newCondition();
Condition notEmpty = lock.newCondition();
```

## 14.1 Why useful

Bounded buffer has two conditions:

```text
not full
not empty
```

Using separate conditions avoids waking wrong waiters.

## 14.2 Main rule

```text
Condition is wait/notify with named condition queues.
```

---

# 15. `await`, `signal`, `signalAll`

Condition methods:

```java
await()
signal()
signalAll()
```

Use while holding associated lock.

```java
lock.lock();
try {
    while (!condition) {
        conditionVar.await();
    }
} finally {
    lock.unlock();
}
```

## 15.1 await

- releases lock;
- waits;
- reacquires lock before returning;
- can throw InterruptedException.

## 15.2 signal

Wakes one waiter on that condition.

## 15.3 signalAll

Wakes all waiters on that condition.

## 15.4 Main rule

```text
As with wait/notify, await must be used in a loop checking the condition.
```

---

# 16. Bounded Buffer with `Condition`

Educational example:

```java
final class ConditionBoundedBuffer<T> {
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition notFull = lock.newCondition();
    private final Condition notEmpty = lock.newCondition();

    private final Object[] items;
    private int head;
    private int tail;
    private int count;

    ConditionBoundedBuffer(int capacity) {
        this.items = new Object[capacity];
    }

    void put(T item) throws InterruptedException {
        lock.lockInterruptibly();
        try {
            while (count == items.length) {
                notFull.await();
            }

            items[tail] = item;
            tail = (tail + 1) % items.length;
            count++;

            notEmpty.signal();
        } finally {
            lock.unlock();
        }
    }

    @SuppressWarnings("unchecked")
    T take() throws InterruptedException {
        lock.lockInterruptibly();
        try {
            while (count == 0) {
                notEmpty.await();
            }

            Object item = items[head];
            items[head] = null;
            head = (head + 1) % items.length;
            count--;

            notFull.signal();
            return (T) item;
        } finally {
            lock.unlock();
        }
    }
}
```

## 16.1 Production note

Use `ArrayBlockingQueue` unless you are implementing a primitive.

## 16.2 Main rule

```text
Condition is valuable when one lock protects multiple wait conditions.
```

---

# 17. `ReadWriteLock`

`ReadWriteLock` has:

```java
Lock readLock();
Lock writeLock();
```

Semantics:

```text
many readers can hold read lock together
writer needs exclusive access
```

Java SE 25 locks package docs describe `ReadWriteLock` as locks that may be shared among readers but are exclusive to writers, with `ReentrantReadWriteLock` as the standard implementation.

## 17.1 Use case

Read-heavy shared state where writes are rare and reads take meaningful time.

## 17.2 Main rule

```text
ReadWriteLock helps only when concurrent reads are safe and common.
```

---

# 18. `ReentrantReadWriteLock`

Create:

```java
ReentrantReadWriteLock rw = new ReentrantReadWriteLock();

Lock read = rw.readLock();
Lock write = rw.writeLock();
```

## 18.1 Read

```java
read.lock();
try {
    return value;
} finally {
    read.unlock();
}
```

## 18.2 Write

```java
write.lock();
try {
    value = newValue;
} finally {
    write.unlock();
}
```

## 18.3 Fairness

Can be constructed fair/non-fair.

## 18.4 Main rule

```text
ReentrantReadWriteLock separates shared read access from exclusive write access.
```

---

# 19. Read Lock vs Write Lock

## 19.1 Multiple readers

Allowed:

```text
Reader A holds read lock
Reader B holds read lock
Reader C holds read lock
```

## 19.2 Writer exclusive

Writer waits until no readers/writers.

## 19.3 Readers while writer waiting

Fairness policy affects whether new readers can barge.

## 19.4 Main rule

```text
Read-write lock improves concurrency only when reads dominate and writes are short.
```

---

# 20. Read-Write Lock Pitfalls

## 20.1 Write starvation

In non-fair mode, readers may keep arriving and delay writer.

## 20.2 Upgrade problem

Trying to acquire write lock while holding read lock can deadlock.

Bad:

```java
read.lock();
try {
    if (needsWrite()) {
        write.lock(); // dangerous
        try {
            update();
        } finally {
            write.unlock();
        }
    }
} finally {
    read.unlock();
}
```

## 20.3 Downgrade possible

Acquire write, then read, then release write:

```java
write.lock();
try {
    update();
    read.lock();
} finally {
    write.unlock();
}

try {
    readUpdatedState();
} finally {
    read.unlock();
}
```

## 20.4 Overhead

For very short reads, normal lock may be faster/simpler.

## 20.5 Main rule

```text
ReadWriteLock is not automatically faster.
Use it for proven read-heavy contention.
```

---

# 21. `StampedLock`

`StampedLock` supports:

- write lock;
- read lock;
- optimistic read.

It returns stamps (`long`) that must be used to unlock/validate.

```java
long stamp = lock.writeLock();
try {
    ...
} finally {
    lock.unlockWrite(stamp);
}
```

## 21.1 Not reentrant

Unlike `ReentrantLock`, `StampedLock` is not reentrant.

## 21.2 Use case

Read-mostly data structures where optimistic read can avoid locking.

## 21.3 Main rule

```text
StampedLock is advanced. Use when optimistic read is valuable and complexity is justified.
```

---

# 22. Optimistic Read

Example point:

```java
final class Point {
    private final StampedLock lock = new StampedLock();
    private double x;
    private double y;

    double distanceFromOrigin() {
        long stamp = lock.tryOptimisticRead();

        double currentX = x;
        double currentY = y;

        if (!lock.validate(stamp)) {
            stamp = lock.readLock();
            try {
                currentX = x;
                currentY = y;
            } finally {
                lock.unlockRead(stamp);
            }
        }

        return Math.hypot(currentX, currentY);
    }

    void move(double deltaX, double deltaY) {
        long stamp = lock.writeLock();
        try {
            x += deltaX;
            y += deltaY;
        } finally {
            lock.unlockWrite(stamp);
        }
    }
}
```

## 22.1 How it works

Optimistic read:

- does not block writer initially;
- reads fields;
- validates stamp;
- if invalid, fallback to read lock.

## 22.2 Main rule

```text
Optimistic read means “read first, verify no write interfered”.
```

---

# 23. StampedLock Pitfalls

## 23.1 Not reentrant

Calling methods that reacquire same StampedLock can deadlock.

## 23.2 Stamp must match

Wrong stamp unlock causes exception/bug.

## 23.3 Optimistic read must validate

Without validate, data may be inconsistent.

## 23.4 Interruptibility caveats

Know which methods are interruptible.

## 23.5 Complexity

Harder to maintain than `ReentrantReadWriteLock`.

## 23.6 Main rule

```text
StampedLock should be justified by measured read-mostly performance need.
```

---

# 24. `Semaphore`

Semaphore manages permits.

```java
Semaphore semaphore = new Semaphore(10);
```

Acquire:

```java
semaphore.acquire();
try {
    useResource();
} finally {
    semaphore.release();
}
```

Java SE 25 `java.util.concurrent` docs describe `Semaphore` as a classic concurrency tool; Oracle concurrency guide lists it among synchronizers that facilitate coordination between threads.

## 24.1 Counting semaphore

Permits > 1.

## 24.2 Binary semaphore

Permits = 1.

## 24.3 Main use

Limit concurrent access to scarce resource.

## 24.4 Main rule

```text
Semaphore is for permits/resources, not ownership of a critical section.
```

---

# 25. Semaphore as Resource Guard

Example downstream limit:

```java
final class LimitedDownstreamClient {
    private final Semaphore permits = new Semaphore(50);
    private final DownstreamClient client;

    Response call(Request request) throws InterruptedException {
        if (!permits.tryAcquire(100, TimeUnit.MILLISECONDS)) {
            throw new ServiceBusyException("downstream bulkhead full");
        }

        try {
            return client.call(request);
        } finally {
            permits.release();
        }
    }
}
```

## 25.1 Works well with virtual threads

Many virtual threads can wait cheaply, but we still must limit DB/API calls.

## 25.2 Fair semaphore

```java
new Semaphore(50, true);
```

Fairness can reduce starvation but may reduce throughput.

## 25.3 Main rule

```text
Use Semaphore to bound concurrency against external capacity.
```

---

# 26. Binary Semaphore vs Lock

Semaphore with 1 permit:

```java
Semaphore semaphore = new Semaphore(1);
```

Can act like a mutex.

But difference:

## 26.1 Lock has ownership

`ReentrantLock` is owned by locking thread.

Wrong thread cannot unlock safely.

## 26.2 Semaphore has permits, not ownership

A different thread can release permit.

This can be useful or dangerous.

## 26.3 Use lock for mutual exclusion

Use semaphore for permit control.

## 26.4 Main rule

```text
Binary semaphore is not the same abstraction as Lock.
Use Lock for ownership, Semaphore for capacity.
```

---

# 27. `CountDownLatch`

`CountDownLatch` lets threads wait until count reaches zero.

```java
CountDownLatch ready = new CountDownLatch(3);

ready.countDown();
ready.await();
```

Java SE 25 package docs describe `CountDownLatch` as a utility for blocking until a number of signals/events/conditions hold.

## 27.1 One-shot

Cannot reset.

## 27.2 Use cases

- wait until services initialized;
- test coordination;
- start gate/done gate;
- wait for N workers.

## 27.3 Example

```java
CountDownLatch done = new CountDownLatch(tasks.size());

for (Task task : tasks) {
    executor.execute(() -> {
        try {
            process(task);
        } finally {
            done.countDown();
        }
    });
}

done.await();
```

## 27.4 Main rule

```text
CountDownLatch is a one-time gate.
```

---

# 28. `CyclicBarrier`

`CyclicBarrier` lets a fixed number of parties wait for each other at a barrier.

```java
CyclicBarrier barrier = new CyclicBarrier(4);
barrier.await();
```

When 4 parties arrive, all proceed.

Java SE 25 package docs describe `CyclicBarrier` as a resettable multiway synchronization point useful in some parallel programming styles.

## 28.1 Cyclic

Can be reused after parties released.

## 28.2 Barrier action

```java
CyclicBarrier barrier = new CyclicBarrier(4, () -> mergeResults());
```

## 28.3 Use cases

- parallel algorithm phases;
- tests;
- simulation steps.

## 28.4 Main rule

```text
CyclicBarrier coordinates fixed parties at repeated rendezvous points.
```

---

# 29. `Phaser`

`Phaser` is a more flexible barrier.

It supports:

- dynamic registration;
- multiple phases;
- arrival;
- waiting for phase advance;
- deregistration.

Java SE 25 package docs describe `Phaser` as a more flexible barrier for phased computation among multiple threads.

## 29.1 Example

```java
Phaser phaser = new Phaser(1); // main registered

for (Task task : tasks) {
    phaser.register();
    executor.execute(() -> {
        try {
            phaseOne(task);
            phaser.arriveAndAwaitAdvance();

            phaseTwo(task);
            phaser.arriveAndAwaitAdvance();
        } finally {
            phaser.arriveAndDeregister();
        }
    });
}

phaser.arriveAndDeregister();
```

## 29.2 Use cases

- dynamic parallel tasks;
- multi-phase computation;
- simulation;
- complex test coordination.

## 29.3 Main rule

```text
Phaser is for dynamic multi-phase coordination.
```

---

# 30. `Exchanger`

`Exchanger<V>` lets two threads exchange objects at a rendezvous point.

```java
Exchanger<Buffer> exchanger = new Exchanger<>();

Buffer received = exchanger.exchange(myBuffer);
```

## 30.1 Use cases

- producer/consumer buffer swap;
- pipeline handoff between two parties;
- genetic algorithms/simulations;
- rare in typical backend apps.

## 30.2 Main rule

```text
Exchanger is for two-party rendezvous with value swap.
```

---

# 31. Choosing Coordination Primitive

Ask:

## 31.1 Need mutual exclusion?

Use:

```text
synchronized / ReentrantLock
```

## 31.2 Need timed/interruptible lock?

Use:

```text
ReentrantLock
```

## 31.3 Need multiple wait conditions?

Use:

```text
Condition
```

## 31.4 Many readers, few writers?

Use:

```text
ReentrantReadWriteLock
```

maybe.

## 31.5 Read-mostly with optimistic read?

Use:

```text
StampedLock
```

carefully.

## 31.6 Limit concurrent access?

Use:

```text
Semaphore
```

## 31.7 Wait for N events once?

Use:

```text
CountDownLatch
```

## 31.8 Fixed parties repeated barrier?

Use:

```text
CyclicBarrier
```

## 31.9 Dynamic parties/phases?

Use:

```text
Phaser
```

## 31.10 Exchange between two threads?

Use:

```text
Exchanger
```

## 31.11 Main rule

```text
Choose primitive by coordination shape:
exclusive, shared, permit, one-shot gate, barrier, phase, or exchange.
```

---

# 32. Coordination and Virtual Threads

Virtual threads make waiting cheaper, but coordination still matters.

## 32.1 Semaphore with virtual threads

Good:

```text
many virtual threads wait for limited permits
```

But if too many wait, memory still grows.

## 32.2 Locks with virtual threads

Locks still serialize.

```text
10,000 virtual threads waiting on one lock = one at a time
```

## 32.3 Conditions/latches/barriers

Virtual threads can wait, but design still needs timeout/cancellation.

## 32.4 Main rule

```text
Virtual threads reduce waiting-thread cost, not coordination complexity.
```

---

# 33. Timeouts, Cancellation, and Interrupts

Prefer APIs that support timeout/interrupt where useful:

```java
tryLock(timeout)
lockInterruptibly()
semaphore.tryAcquire(timeout)
latch.await(timeout)
barrier.await(timeout)
phaser.awaitAdvanceInterruptibly(phase, timeout, unit)
```

## 33.1 Handle InterruptedException

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw e;
}
```

## 33.2 Avoid indefinite waits

Production coordination should usually have:

- timeout;
- cancellation;
- metrics;
- fallback.

## 33.3 Main rule

```text
A coordination wait without timeout or cancellation is a possible production hang.
```

---

# 34. Memory Consistency Effects

`java.util.concurrent` synchronizers define memory consistency effects.

The package docs specify that actions before releasing a synchronizer method such as `Semaphore.release` happen-before actions after a successful acquire in another thread, and similar effects exist for other synchronizers.

## 34.1 Practical meaning

If Thread A prepares data then counts down latch:

```java
data = result;
latch.countDown();
```

Thread B:

```java
latch.await();
use(data);
```

The await provides visibility according to synchronizer memory effects.

## 34.2 Main rule

```text
Coordination primitives are also safe-publication mechanisms when used according to their contracts.
```

---

# 35. Observability and Diagnostics

For explicit locks and synchronizers, observe:

## 35.1 Lock metrics

- wait duration;
- hold duration;
- contention count approximation;
- timeout count;
- queue length if available;
- owner diagnostics if available.

## 35.2 Semaphore metrics

- available permits;
- waiting count;
- acquire timeout/rejection;
- hold duration.

## 35.3 Latch/barrier/phaser metrics

- parties;
- arrived count;
- phase;
- wait time;
- broken barrier count;
- timeout/interruption count.

## 35.4 Diagnostics

- thread dumps;
- JFR lock/park events;
- custom timing logs;
- metrics tags by resource/workload.

## 35.5 Main rule

```text
Contention without metrics becomes mystery latency.
```

---

# 36. Mini Case Study: Downstream Bulkhead with Semaphore

## 36.1 Problem

Service has 10,000 virtual-thread requests, each may call downstream payment API. Payment API can handle 100 concurrent calls.

## 36.2 Bad

```java
return paymentClient.call(request);
```

10,000 calls may overwhelm downstream.

## 36.3 Good

```java
final class PaymentBulkhead {
    private final Semaphore permits = new Semaphore(100);
    private final PaymentClient client;

    PaymentResponse call(PaymentRequest request) throws InterruptedException {
        if (!permits.tryAcquire(200, TimeUnit.MILLISECONDS)) {
            throw new ServiceBusyException("payment bulkhead full");
        }

        try {
            return client.call(request);
        } finally {
            permits.release();
        }
    }
}
```

## 36.4 Lesson

```text
Virtual threads need resource bulkheads.
Semaphore is a simple concurrency guard.
```

---

# 37. Mini Case Study: Startup Gate with CountDownLatch

## 37.1 Problem

App should accept traffic only after 3 components are ready.

## 37.2 Latch

```java
CountDownLatch ready = new CountDownLatch(3);
```

Each component:

```java
initialize();
ready.countDown();
```

Main:

```java
if (!ready.await(30, TimeUnit.SECONDS)) {
    throw new IllegalStateException("Startup timeout");
}
startHttpServer();
```

## 37.3 Lesson

```text
CountDownLatch is ideal for one-time readiness gates.
```

---

# 38. Mini Case Study: Parallel Phase Computation with Phaser

## 38.1 Problem

Several dynamic worker tasks execute multiple phases:

```text
load
process
publish
```

Number of workers can vary.

## 38.2 Phaser

```java
Phaser phaser = new Phaser(1);

for (Task task : tasks) {
    phaser.register();
    executor.execute(() -> {
        try {
            load(task);
            phaser.arriveAndAwaitAdvance();

            process(task);
            phaser.arriveAndAwaitAdvance();

            publish(task);
        } finally {
            phaser.arriveAndDeregister();
        }
    });
}

phaser.arriveAndDeregister();
```

## 38.3 Lesson

```text
Phaser handles dynamic multi-phase coordination better than CountDownLatch/CyclicBarrier.
```

---

# 39. Common Bugs

## 39.1 Forgetting unlock

Deadlock.

## 39.2 Unlock not in finally

Exception leaks lock.

## 39.3 Calling Condition await without lock

IllegalMonitorStateException.

## 39.4 Await not in loop

Spurious wakeup/condition race.

## 39.5 Signal wrong condition

Waiters never progress.

## 39.6 ReadWriteLock upgrade deadlock

Holding read while acquiring write.

## 39.7 StampedLock optimistic read without validate

Inconsistent data.

## 39.8 Semaphore release too many times

Permit leak in opposite direction.

## 39.9 Semaphore acquire without finally release

Permit leak/starvation.

## 39.10 Barrier waiting forever

Party failed before reaching barrier.

## 39.11 Ignoring BrokenBarrierException

Barrier state misunderstood.

## 39.12 Infinite wait without timeout

Production hang.

---

# 40. Best Practices

## 40.1 Use synchronized first when sufficient

Simplicity wins.

## 40.2 Always unlock in finally

Non-negotiable.

## 40.3 Prefer timed/interruptible waits in production

Avoid indefinite hangs.

## 40.4 Use Condition for multiple wait predicates

Better than one monitor wait set.

## 40.5 Be careful with fairness

Fairness can reduce throughput.

## 40.6 Use ReadWriteLock only after read-heavy proof

Do not assume faster.

## 40.7 Use StampedLock sparingly

Advanced and non-reentrant.

## 40.8 Use Semaphore for resource capacity

Not as general ownership lock.

## 40.9 Use CountDownLatch for one-shot gates

Do not try to reset it.

## 40.10 Use Phaser for dynamic multi-phase coordination

When parties/phases vary.

## 40.11 Add metrics

Wait time, timeout, permits, phase.

## 40.12 Prefer higher-level abstractions

If a BlockingQueue, Executor, or structured concurrency scope expresses the design better, use it.

---

# 41. Decision Matrix

| Need | Primitive |
|---|---|
| Simple critical section | `synchronized` |
| Timed lock acquisition | `ReentrantLock.tryLock(timeout)` |
| Interruptible lock wait | `ReentrantLock.lockInterruptibly` |
| Multiple wait conditions | `ReentrantLock` + `Condition` |
| Many readers, rare writers | `ReentrantReadWriteLock` |
| Optimistic read-mostly structure | `StampedLock` |
| Limit concurrent access to resource | `Semaphore` |
| One-time wait for N events | `CountDownLatch` |
| Fixed parties rendezvous repeatedly | `CyclicBarrier` |
| Dynamic parties across phases | `Phaser` |
| Two threads exchange values | `Exchanger` |
| Queue producer-consumer | `BlockingQueue` |
| Request fan-out lifetime | Structured concurrency later |
| Simple counter | Atomic/LongAdder, not lock |
| Multi-field invariant | lock or immutable snapshot |
| Virtual-thread downstream limit | `Semaphore` |

---

# 42. Latihan

## Latihan 1 — ReentrantLock Counter

Implementasikan counter dengan `ReentrantLock`, pastikan `unlock` di `finally`.

## Latihan 2 — Timed Lock

Buat method yang gagal jika tidak bisa acquire lock dalam 100ms.

## Latihan 3 — Interruptible Lock

Buat worker yang menunggu lock dengan `lockInterruptibly`, lalu interrupt saat menunggu.

## Latihan 4 — Condition Buffer

Implementasikan one-slot buffer dengan `ReentrantLock` dan dua `Condition`: `notFull`, `notEmpty`.

## Latihan 5 — ReadWriteLock Cache

Buat cache read-heavy dengan `ReentrantReadWriteLock`.

## Latihan 6 — ReadWriteLock Pitfall

Jelaskan kenapa read-lock upgrade ke write-lock berbahaya.

## Latihan 7 — StampedLock Point

Implementasikan class `Point` dengan optimistic read.

## Latihan 8 — Semaphore Bulkhead

Buat wrapper HTTP client dengan `Semaphore(50)` dan timeout acquire.

## Latihan 9 — CountDownLatch Startup

Simulasikan 3 service initialization dan main thread menunggu semuanya ready.

## Latihan 10 — Phaser

Buat 3 worker dengan 2 phase memakai `Phaser`.

---

# 43. Ringkasan

Explicit locks dan coordination primitives memberi kemampuan lebih dari intrinsic lock.

Core lessons:

- `synchronized` tetap pilihan baik untuk critical section sederhana.
- `ReentrantLock` memberi `tryLock`, timed lock, interruptible lock, fairness, dan Condition.
- Explicit lock harus selalu `unlock` di `finally`.
- Fair lock mengurangi starvation risk tetapi bisa menurunkan throughput.
- `tryLock` cocok untuk opportunistic/fail-fast behavior.
- `lockInterruptibly` cocok untuk cancellation-sensitive waits.
- `Condition` memberi multiple wait sets untuk satu lock.
- `await` harus dalam loop seperti `wait`.
- `ReadWriteLock` memungkinkan banyak readers dan satu writer.
- `ReadWriteLock` berguna hanya untuk read-heavy workload yang terbukti.
- `StampedLock` memberi optimistic read tetapi lebih kompleks dan tidak reentrant.
- `Semaphore` membatasi permit/resource, sangat berguna sebagai bulkhead.
- Binary semaphore bukan sama dengan ownership lock.
- `CountDownLatch` adalah one-shot gate.
- `CyclicBarrier` adalah reusable barrier untuk fixed parties.
- `Phaser` adalah dynamic multi-phase coordination.
- `Exchanger` adalah two-party value swap.
- Timeouts, interrupts, dan metrics penting untuk production.
- Virtual threads mengurangi biaya waiting, tetapi tidak menghapus kebutuhan coordination dan resource limits.

Main rule:

```text
Choose coordination primitives by shape:
exclusive lock, conditional wait, shared read/exclusive write,
resource permits, one-shot gate, repeated barrier,
dynamic phases, or two-party exchange.
```

---

# 44. Referensi

1. Java SE 25 — Package `java.util.concurrent.locks`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/package-summary.html

2. Java SE 25 — `ReentrantLock`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html

3. Java SE 25 — `Condition`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/Condition.html

4. Java SE 25 — `ReentrantReadWriteLock`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantReadWriteLock.html

5. Java SE 25 — `StampedLock`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/StampedLock.html

6. Java SE 25 — `Semaphore`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html

7. Java SE 25 — `CountDownLatch`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CountDownLatch.html

8. Java SE 25 — `CyclicBarrier`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CyclicBarrier.html

9. Java SE 25 — `Phaser`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Phaser.html

10. Java SE 25 — `Exchanger`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Exchanger.html

11. Java SE 25 — Package `java.util.concurrent`, Synchronizers and Memory Consistency Effects  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/package-summary.html

12. Oracle Java SE 25 Guide — Concurrency  
    https://docs.oracle.com/en/java/javase/25/core/concurrency.html

13. OpenJDK JEP 491 — Synchronize Virtual Threads without Pinning  
    https://openjdk.org/jeps/491

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-concurrency-and-reactive-part-009.md](./learn-java-concurrency-and-reactive-part-009.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-concurrency-and-reactive-part-011.md](./learn-java-concurrency-and-reactive-part-011.md)

</div>
# learn-java-concurrency-and-reactive-part-019.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 019  
# Deadlocks, Livelocks, Starvation, and Thread Starvation: Failure Modes, Diagnostics, Prevention, and Production Recovery

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **019**  
> Fokus: memahami failure modes dalam concurrent Java: **deadlock**, **livelock**, **starvation**, **thread starvation**, **thread-pool starvation**, **resource starvation**, **lock convoy**, **priority inversion**, dan bagaimana mencegah, mendeteksi, mendiagnosis, dan memulihkan masalah ini di production. Materi ini relevan untuk platform threads, virtual threads, executor pools, locks, database connection pools, HTTP pools, message consumers, dan aplikasi high-concurrency.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Concurrency Failure Modes: Gambaran Besar](#2-concurrency-failure-modes-gambaran-besar)
3. [Deadlock: Definisi](#3-deadlock-definisi)
4. [Empat Kondisi Deadlock](#4-empat-kondisi-deadlock)
5. [Deadlock dengan Intrinsic Locks](#5-deadlock-dengan-intrinsic-locks)
6. [Deadlock dengan ReentrantLock](#6-deadlock-dengan-reentrantlock)
7. [Deadlock dengan Resource Pools](#7-deadlock-dengan-resource-pools)
8. [Deadlock dengan Database Transactions](#8-deadlock-dengan-database-transactions)
9. [Deadlock dengan Thread Pools](#9-deadlock-dengan-thread-pools)
10. [Thread-Pool Starvation Deadlock](#10-thread-pool-starvation-deadlock)
11. [Virtual Threads and Deadlock](#11-virtual-threads-and-deadlock)
12. [Lock Ordering](#12-lock-ordering)
13. [Open Calls: Do Not Call External Code While Holding Lock](#13-open-calls-do-not-call-external-code-while-holding-lock)
14. [Timeouts as Deadlock Mitigation](#14-timeouts-as-deadlock-mitigation)
15. [`tryLock` and Deadlock Avoidance](#15-trylock-and-deadlock-avoidance)
16. [Deadlock Detection](#16-deadlock-detection)
17. [Thread Dumps](#17-thread-dumps)
18. [JFR and Observability](#18-jfr-and-observability)
19. [Livelock: Definisi](#19-livelock-definisi)
20. [Livelock Example](#20-livelock-example)
21. [Livelock Prevention](#21-livelock-prevention)
22. [Starvation: Definisi](#22-starvation-definisi)
23. [Lock Starvation](#23-lock-starvation)
24. [Thread Starvation](#24-thread-starvation)
25. [Resource Starvation](#25-resource-starvation)
26. [Priority Inversion](#26-priority-inversion)
27. [Lock Convoy](#27-lock-convoy)
28. [Fairness vs Throughput](#28-fairness-vs-throughput)
29. [Starvation in ExecutorService](#29-starvation-in-executorservice)
30. [Starvation in ForkJoinPool](#30-starvation-in-forkjoinpool)
31. [Starvation in Virtual-Thread Applications](#31-starvation-in-virtual-thread-applications)
32. [Database Pool Starvation](#32-database-pool-starvation)
33. [HTTP Pool and Downstream Starvation](#33-http-pool-and-downstream-starvation)
34. [Message Consumer Starvation](#34-message-consumer-starvation)
35. [Designing for Progress](#35-designing-for-progress)
36. [Production Recovery](#36-production-recovery)
37. [Mini Case Study: Two Account Transfer Deadlock](#37-mini-case-study-two-account-transfer-deadlock)
38. [Mini Case Study: Thread Pool Waiting on Itself](#38-mini-case-study-thread-pool-waiting-on-itself)
39. [Mini Case Study: DB Pool Starvation After Virtual Thread Migration](#39-mini-case-study-db-pool-starvation-after-virtual-thread-migration)
40. [Common Anti-Patterns](#40-common-anti-patterns)
41. [Best Practices](#41-best-practices)
42. [Decision Matrix](#42-decision-matrix)
43. [Latihan](#43-latihan)
44. [Ringkasan](#44-ringkasan)
45. [Referensi](#45-referensi)

---

# 1. Tujuan Bagian Ini

Di part sebelumnya kita membahas:

- locks;
- explicit locks;
- virtual threads;
- structured concurrency;
- cancellation;
- timeouts;
- cooperative shutdown.

Sekarang kita membahas failure modes yang sering muncul saat concurrency mulai kompleks.

Masalah paling berbahaya:

```text
Program tidak crash.
Program tidak throw error.
Program hanya “diam”, stuck, lambat, atau tidak progress.
```

Contoh:

- thread A menunggu lock B;
- thread B menunggu lock A;
- semua thread pool workers menunggu task yang tidak pernah bisa jalan;
- semua DB connections dipakai oleh task yang menunggu koneksi lain;
- request high priority menunggu low priority yang memegang lock;
- virtual threads banyak, tetapi semuanya menunggu resource kecil;
- retry storm membuat dependency makin penuh;
- consumer satu partition kelaparan karena message besar.

Target bagian ini:

```text
Mampu mengenali dan mencegah deadlock, livelock, starvation,
thread starvation, pool starvation, dan resource starvation
di Java production systems.
```

---

# 2. Concurrency Failure Modes: Gambaran Besar

Ada beberapa failure mode utama.

## 2.1 Deadlock

Tasks saling menunggu selamanya.

```text
A waits for B
B waits for A
```

## 2.2 Livelock

Tasks aktif bergerak tetapi tidak membuat progress.

```text
A reacts to B
B reacts to A
forever
```

## 2.3 Starvation

Satu task tidak mendapat kesempatan/resource karena terus dikalahkan.

```text
others always get lock/CPU/connection first
```

## 2.4 Thread starvation

Task siap jalan tetapi tidak ada thread/worker/carrier yang tersedia.

## 2.5 Resource starvation

Task siap jalan tetapi resource seperti DB connection/permit/socket tidak tersedia.

## 2.6 Main rule

```text
Concurrency correctness is not only safety.
It is also progress.
```

Safety:

```text
nothing bad happens
```

Liveness/progress:

```text
something good eventually happens
```

---

# 3. Deadlock: Definisi

Deadlock adalah kondisi ketika sekelompok thread/task saling menunggu satu sama lain dan tidak ada yang bisa lanjut.

Classic:

```text
Thread 1 owns Lock A, waits for Lock B
Thread 2 owns Lock B, waits for Lock A
```

Tidak ada timeout.

Tidak ada cancellation.

Tidak ada lock release.

Maka stuck forever.

## 3.1 Main rule

```text
Deadlock is a circular wait with no escape path.
```

---

# 4. Empat Kondisi Deadlock

Deadlock klasik memerlukan empat kondisi.

## 4.1 Mutual exclusion

Resource hanya bisa dipakai satu owner.

Example:

```text
lock
DB row lock
connection
file handle
```

## 4.2 Hold and wait

Task memegang satu resource sambil menunggu resource lain.

## 4.3 No preemption

Resource tidak bisa dicabut paksa dengan aman.

## 4.4 Circular wait

Ada siklus tunggu.

```text
A -> B -> C -> A
```

## 4.5 Prevention idea

Hilangkan salah satu kondisi.

Paling sering:

- hindari hold-and-wait;
- hilangkan circular wait dengan ordering;
- pakai timeout/cancellation;
- jangan nested locks;
- open calls.

## 4.6 Main rule

```text
Deadlock prevention is about breaking circular wait or hold-and-wait.
```

---

# 5. Deadlock dengan Intrinsic Locks

Example:

```java
final Object lockA = new Object();
final Object lockB = new Object();

Thread t1 = Thread.ofPlatform().start(() -> {
    synchronized (lockA) {
        sleepQuietly(100);
        synchronized (lockB) {
            System.out.println("t1 done");
        }
    }
});

Thread t2 = Thread.ofPlatform().start(() -> {
    synchronized (lockB) {
        sleepQuietly(100);
        synchronized (lockA) {
            System.out.println("t2 done");
        }
    }
});
```

Timeline:

```text
t1 locks A
t2 locks B
t1 waits B
t2 waits A
deadlock
```

## 5.1 Why sleep?

To increase chance both grab first lock.

Real production doesn't need sleep. Timing naturally creates interleavings.

## 5.2 Main rule

```text
Nested synchronized blocks need consistent lock ordering.
```

---

# 6. Deadlock dengan ReentrantLock

`ReentrantLock` can deadlock too.

```java
lockA.lock();
try {
    lockB.lock();
    try {
        work();
    } finally {
        lockB.unlock();
    }
} finally {
    lockA.unlock();
}
```

Another thread reverse order.

## 6.1 Advantage

`ReentrantLock` offers:

```java
tryLock()
tryLock(timeout)
lockInterruptibly()
```

These can help avoid indefinite wait.

## 6.2 Main rule

```text
Explicit locks do not prevent deadlock by themselves.
They only provide tools to design escape paths.
```

---

# 7. Deadlock dengan Resource Pools

Deadlock is not only locks.

Example resource pool:

```text
Pool has 2 connections.
Task A holds connection 1, waits for another connection.
Task B holds connection 2, waits for another connection.
No connection available.
```

## 7.1 Common cause

Nested resource acquisition:

```java
Connection c1 = pool.getConnection();
try {
    // calls another component that also needs connection
    otherService.doDbWork();
} finally {
    c1.close();
}
```

## 7.2 Prevention

- avoid nested connection acquisition;
- use transaction propagation correctly;
- ensure same connection reused in transaction scope;
- use timeout;
- separate pools carefully;
- avoid blocking external calls while holding connection.

## 7.3 Main rule

```text
Pools can deadlock when tasks hold scarce resources while waiting for more of the same resource.
```

---

# 8. Deadlock dengan Database Transactions

Database deadlock example:

```text
Tx1 locks row A, waits row B
Tx2 locks row B, waits row A
```

DB may detect and abort one transaction.

## 8.1 Application responsibilities

- consistent row ordering;
- short transactions;
- proper indexes;
- avoid user/network wait inside transaction;
- retry deadlock victim safely;
- idempotency.

## 8.2 Row ordering

If updating multiple accounts:

```text
always update lower account_id first
```

## 8.3 Main rule

```text
Database deadlocks are often application lock-ordering bugs expressed at row level.
```

---

# 9. Deadlock dengan Thread Pools

Thread pools can deadlock when tasks wait for other tasks scheduled to the same saturated pool.

Example:

```java
ExecutorService pool = Executors.newFixedThreadPool(1);

Future<String> outer = pool.submit(() -> {
    Future<String> inner = pool.submit(() -> "inner");
    return inner.get();
});

System.out.println(outer.get());
```

Worker runs outer and waits for inner.

But inner cannot run because only worker is occupied.

Deadlock/starvation.

## 9.1 Main rule

```text
A task should not block waiting for another task submitted to the same bounded saturated executor.
```

---

# 10. Thread-Pool Starvation Deadlock

Thread-pool starvation deadlock happens when all workers are blocked waiting for work that needs workers from the same pool.

Example with pool size N:

```text
N parent tasks occupy all workers.
Each parent submits child task to same pool and waits.
No worker available for children.
```

## 10.1 Common in production

- nested `CompletableFuture.supplyAsync` on same executor;
- request handler submits to same pool and blocks;
- message consumers wait for subtask in same pool;
- ForkJoin misuse with blocking.

## 10.2 Prevention

- avoid blocking inside same bounded pool;
- use separate executor for child type;
- use virtual threads for blocking tasks;
- use structured concurrency;
- use non-blocking composition;
- ensure pool capacity > max nested blocking;
- avoid sync waiting inside event loop.

## 10.3 Main rule

```text
Do not make a bounded executor wait for itself.
```

---

# 11. Virtual Threads and Deadlock

Virtual threads reduce thread starvation caused by limited platform threads.

But they do not prevent:

- lock deadlock;
- DB row deadlock;
- resource pool deadlock;
- semaphore permit deadlock;
- logical circular waits;
- unbounded memory pressure.

## 11.1 Example

```text
virtual thread A holds lock1 waits lock2
virtual thread B holds lock2 waits lock1
```

Still deadlock.

## 11.2 Virtual threads may reveal resource deadlocks

Because concurrency increases, resource pool cycles become more likely.

## 11.3 Main rule

```text
Virtual threads reduce one kind of starvation, not deadlock logic.
```

---

# 12. Lock Ordering

Lock ordering prevents circular wait.

Define global order.

Example account transfer:

```java
void transfer(Account from, Account to, Money amount) {
    Account first = from.id().compareTo(to.id()) < 0 ? from : to;
    Account second = first == from ? to : from;

    synchronized (first.lock()) {
        synchronized (second.lock()) {
            from.debit(amount);
            to.credit(amount);
        }
    }
}
```

## 12.1 Tie-breaker

If order keys equal or unavailable, use tie lock.

```java
private static final Object tieLock = new Object();
```

## 12.2 Main rule

```text
All code paths must acquire shared locks in the same global order.
```

---

# 13. Open Calls: Do Not Call External Code While Holding Lock

Bad:

```java
synchronized (lock) {
    listener.onEvent(event);
}
```

If listener calls back into your object or waits on another lock, deadlock risk.

Better:

```java
List<Listener> snapshot;
synchronized (lock) {
    snapshot = List.copyOf(listeners);
}

for (Listener listener : snapshot) {
    listener.onEvent(event);
}
```

This is called open call:

```text
call external code after releasing lock
```

## 13.1 External code includes

- listener/callback;
- HTTP call;
- DB call;
- plugin;
- logging to blocking sink;
- user-provided function.

## 13.2 Main rule

```text
Never call unknown external code while holding internal locks.
```

---

# 14. Timeouts as Deadlock Mitigation

Timeouts do not prove correctness, but provide escape path.

Example:

```java
if (!lock.tryLock(100, TimeUnit.MILLISECONDS)) {
    throw new TimeoutException("Could not acquire lock");
}
```

For resources:

```java
if (!semaphore.tryAcquire(200, TimeUnit.MILLISECONDS)) {
    throw new ServiceBusyException();
}
```

## 14.1 Benefits

- avoids infinite wait;
- creates metric;
- fails fast;
- can trigger retry/recovery.

## 14.2 Limitations

Timeout is mitigation, not root fix.

## 14.3 Main rule

```text
Timeouts turn infinite waits into explicit failures.
They do not replace correct ordering.
```

---

# 15. `tryLock` and Deadlock Avoidance

Use `tryLock` to avoid circular wait.

Example:

```java
boolean acquiredA = lockA.tryLock(100, TimeUnit.MILLISECONDS);
if (!acquiredA) {
    return false;
}

try {
    boolean acquiredB = lockB.tryLock(100, TimeUnit.MILLISECONDS);
    if (!acquiredB) {
        return false;
    }

    try {
        work();
        return true;
    } finally {
        lockB.unlock();
    }
} finally {
    lockA.unlock();
}
```

## 15.1 Add backoff

If retrying, add random backoff to avoid livelock.

## 15.2 Main rule

```text
tryLock can avoid indefinite deadlock, but retries need backoff and fairness thinking.
```

---

# 16. Deadlock Detection

Java provides deadlock detection through management APIs.

`ThreadMXBean` includes methods such as:

```java
findDeadlockedThreads()
findMonitorDeadlockedThreads()
```

## 16.1 Detects monitor/ownable synchronizer deadlocks

Useful for Java locks.

## 16.2 Does not detect all logical deadlocks

Examples:

- DB deadlock outside JVM;
- remote service circular wait;
- thread pool starvation;
- resource pool deadlock;
- application-level wait cycles.

## 16.3 Main rule

```text
JVM deadlock detection helps for locks,
but production deadlocks can be logical/resource-based too.
```

---

# 17. Thread Dumps

Thread dump is essential.

Look for:

## 17.1 BLOCKED

Waiting to enter monitor.

## 17.2 WAITING/TIMED_WAITING

Waiting on condition, park, sleep, future, queue.

## 17.3 Same monitor

Many threads blocked on same lock.

## 17.4 Deadlock section

Some dumps report found deadlocks.

## 17.5 Pool starvation

All pool workers WAITING on futures from same pool.

## 17.6 Main rule

```text
Thread dumps reveal what each thread is waiting for.
Deadlock diagnosis is wait-for graph reconstruction.
```

---

# 18. JFR and Observability

JFR can help show:

- Java monitor blocked;
- thread park;
- lock contention;
- virtual thread pinned;
- execution samples;
- allocation pressure;
- socket/file reads;
- long waits.

## 18.1 Metrics to collect

- lock wait time;
- executor queue length;
- active worker count;
- DB pool active/idle/wait;
- HTTP pool wait;
- semaphore wait;
- timeout count;
- rejected count;
- virtual scheduler queued count if applicable.

## 18.2 Main rule

```text
Liveness bugs need wait-time observability, not only error counts.
```

---

# 19. Livelock: Definisi

Livelock means tasks are not blocked, but keep reacting and no progress is made.

Example analogy:

```text
Two people in hallway both step left, then both step right, forever.
```

In systems:

```text
Task A backs off because B
Task B backs off because A
both retry immediately
```

## 19.1 Difference from deadlock

Deadlock:

```text
not moving
```

Livelock:

```text
moving but no progress
```

## 19.2 Main rule

```text
Livelock is activity without progress.
```

---

# 20. Livelock Example

Two tasks try to acquire two locks politely.

```java
while (true) {
    if (lockA.tryLock()) {
        try {
            if (lockB.tryLock()) {
                try {
                    work();
                    return;
                } finally {
                    lockB.unlock();
                }
            }
        } finally {
            lockA.unlock();
        }
    }

    // both threads retry immediately
}
```

Two threads can repeatedly collide.

## 20.1 Fix

Add randomized backoff.

```java
Thread.sleep(ThreadLocalRandom.current().nextInt(1, 10));
```

Or use lock ordering.

## 20.2 Main rule

```text
Avoid symmetric immediate retries.
Use ordering, backoff, or central coordination.
```

---

# 21. Livelock Prevention

Strategies:

## 21.1 Deterministic ordering

Avoid collision.

## 21.2 Random backoff

Break symmetry.

## 21.3 Retry budget

Do not retry forever.

## 21.4 Jitter

Prevent synchronized waves.

## 21.5 Queueing

Centralize access order.

## 21.6 Main rule

```text
Livelock prevention requires breaking symmetry and bounding retries.
```

---

# 22. Starvation: Definisi

Starvation means a task waits indefinitely or too long because others keep getting resources first.

Examples:

- non-fair lock always acquired by busy threads;
- low-priority task never scheduled;
- queue with priority always receives high-priority items;
- tenant A consumes all permits;
- long tasks block short tasks in same pool.

## 22.1 Main rule

```text
Starvation is lack of fair progress for some participant.
```

---

# 23. Lock Starvation

Intrinsic locks do not guarantee fairness.

`ReentrantLock` can be fair:

```java
new ReentrantLock(true)
```

## 23.1 Fair lock

Reduces starvation risk.

## 23.2 Cost

Can reduce throughput.

## 23.3 Main rule

```text
Fairness is a correctness/latency choice, not a free performance optimization.
```

---

# 24. Thread Starvation

Thread starvation means tasks are ready but cannot get thread execution.

Platform thread pool example:

```text
pool size = 10
10 long blocking tasks occupy all workers
short urgent task waits in queue
```

## 24.1 Virtual thread impact

Virtual threads reduce starvation due to limited platform worker count for blocking I/O.

But CPU still finite.

## 24.2 Main rule

```text
Thread starvation is often caused by mixing long blocking work and latency-sensitive work in same bounded executor.
```

---

# 25. Resource Starvation

Resource starvation means task cannot get resource.

Examples:

- DB connection;
- HTTP connection;
- semaphore permit;
- file descriptor;
- memory;
- CPU;
- rate limit quota.

## 25.1 Virtual threads

Virtual threads can increase pressure because more tasks reach resource boundary.

## 25.2 Main rule

```text
A cheap waiting thread can still be waiting for an expensive scarce resource.
```

---

# 26. Priority Inversion

Priority inversion:

```text
High-priority task waits for low-priority task holding resource.
Medium-priority tasks keep running and delay low-priority.
High-priority waits too long.
```

Java thread priorities are generally not a reliable application-level scheduling mechanism.

But priority inversion concept appears in:

- business priority queues;
- lock ownership;
- tenant queues;
- scheduler policy.

## 26.1 Mitigation

- avoid long lock hold;
- priority-aware queues;
- resource reservation;
- separate pools;
- bounded critical sections.

## 26.2 Main rule

```text
High-priority work can still be blocked by low-priority resource ownership.
```

---

# 27. Lock Convoy

Lock convoy occurs when many threads queue behind a lock, and progress becomes serialized with poor scheduling/cache behavior.

## 27.1 Symptoms

- high lock wait;
- low throughput;
- high context switching;
- p99 latency spike.

## 27.2 Fix

- reduce critical section;
- split lock;
- use concurrent data structure;
- immutable snapshots;
- avoid global lock.

## 27.3 Main rule

```text
A hot lock can become a throughput toll gate.
```

---

# 28. Fairness vs Throughput

Fairness:

```text
older waiter gets priority
```

Throughput:

```text
maximize total work completed
```

Non-fair locks may allow barging, improving throughput.

Fair locks reduce starvation but may hurt throughput.

## 28.1 Use fairness when

- starvation unacceptable;
- latency predictability matters;
- resource access must be equitable.

## 28.2 Avoid fairness when

- high throughput more important;
- starvation not observed;
- critical sections short and low contention.

## 28.3 Main rule

```text
Fairness is a policy decision with throughput cost.
```

---

# 29. Starvation in ExecutorService

Common causes:

## 29.1 Unbounded queue with fixed workers

Short tasks wait behind long tasks.

## 29.2 Same pool for everything

CPU, I/O, scheduled, urgent, background all mixed.

## 29.3 Blocking inside worker

Worker occupied while waiting.

## 29.4 Nested submission

Worker waits for child task in same pool.

## 29.5 Fix

- separate executors by workload;
- virtual threads for blocking I/O;
- bounded queues;
- priority queues carefully;
- timeouts;
- reject/backpressure.

## 29.6 Main rule

```text
Executor design must separate workloads with different latency and blocking profiles.
```

---

# 30. Starvation in ForkJoinPool

ForkJoinPool is optimized for fork/join CPU-ish tasks and work stealing.

Starvation can happen when tasks block without informing pool.

## 30.1 CommonPool misuse

Using common pool for blocking I/O can starve unrelated CompletableFuture/parallel stream tasks.

## 30.2 Mitigation

- avoid blocking in common pool;
- use dedicated executor;
- use virtual threads for blocking I/O;
- use managed blocking where appropriate;
- keep CPU tasks CPU-bound.

## 30.3 Main rule

```text
Do not use ForkJoin common pool as general blocking I/O pool.
```

---

# 31. Starvation in Virtual-Thread Applications

Virtual threads reduce platform-thread pool starvation but can still starve on:

## 31.1 Carrier saturation

Too many CPU-bound virtual threads.

## 31.2 Resource saturation

DB/API/semaphore.

## 31.3 Lock contention

Hot lock.

## 31.4 Pinning/carrier capture

Problematic blocking can occupy carriers.

## 31.5 Memory pressure

Too many tasks/ThreadLocals.

## 31.6 Main rule

```text
Virtual-thread starvation moves from thread scarcity to CPU/resource/lock/memory scarcity.
```

---

# 32. Database Pool Starvation

DB pool starvation:

```text
all connections busy
new requests wait
```

Causes:

- pool too small;
- queries slow;
- transactions long;
- connection leak;
- remote call while holding connection;
- too much concurrency after virtual thread migration.

## 32.1 Metrics

- active connections;
- idle connections;
- pending acquisition;
- connection wait time;
- timeout count;
- query duration;
- transaction duration.

## 32.2 Fix

- optimize queries;
- shorten transactions;
- add indexes;
- remove remote calls inside transaction;
- tune pool;
- limit concurrent DB work;
- find leaks.

## 32.3 Main rule

```text
Increasing threads rarely fixes DB starvation.
Reducing DB hold time usually does.
```

---

# 33. HTTP Pool and Downstream Starvation

HTTP client pools can starve.

Causes:

- max connections too low;
- downstream slow;
- no timeout;
- retries;
- connection leak;
- one host monopolizes pool;
- no per-route limit;
- virtual threads increase calls.

## 33.1 Fix

- per-downstream bulkhead;
- connection timeout;
- response timeout;
- rate limit;
- circuit breaker;
- retry budget;
- separate clients/pools for critical dependencies.

## 33.2 Main rule

```text
Downstream starvation must be handled per dependency, not globally.
```

---

# 34. Message Consumer Starvation

Message consumers can starve when:

- one partition has slow poison messages;
- large messages block worker;
- retries monopolize consumers;
- no per-tenant fairness;
- priority queue always selects high priority;
- offset/ack dependency blocks progress.

## 34.1 Fix

- DLQ poison messages;
- retry with backoff;
- per-partition concurrency model;
- fair scheduling;
- max processing time;
- separate workers for slow classes;
- checkpoint/ack strategy.

## 34.2 Main rule

```text
Message progress needs fairness, poison handling, and bounded retry.
```

---

# 35. Designing for Progress

Progress-oriented design asks:

## 35.1 Can this wait forever?

If yes, add timeout/deadline/cancellation.

## 35.2 Can this acquire resources in different order?

If yes, define ordering.

## 35.3 Can this task wait on same pool?

If yes, redesign.

## 35.4 Can one tenant/user monopolize?

If yes, add quota/fairness.

## 35.5 Can retry loop run forever?

If yes, add budget/backoff.

## 35.6 Can one lock serialize all work?

If yes, reduce/shared state.

## 35.7 Main rule

```text
Every wait needs an owner, a reason, a timeout, and an observable metric.
```

---

# 36. Production Recovery

If production is stuck:

## 36.1 Capture evidence first

- thread dumps;
- JFR;
- metrics snapshot;
- DB pool stats;
- heap if memory pressure;
- logs.

## 36.2 Identify wait type

- lock wait;
- pool wait;
- DB wait;
- HTTP wait;
- CPU saturation;
- GC;
- external dependency.

## 36.3 Mitigate

- reduce traffic;
- disable endpoint;
- open circuit;
- increase timeout? usually dangerous;
- reduce concurrency;
- restart as last resort;
- kill stuck connection/session;
- rollback recent change.

## 36.4 Fix root cause

- lock order;
- resource limit;
- timeout;
- query optimization;
- bulkhead;
- task ownership.

## 36.5 Main rule

```text
Do not blindly restart before capturing wait evidence,
unless user impact requires immediate recovery.
```

---

# 37. Mini Case Study: Two Account Transfer Deadlock

## 37.1 Broken

```java
void transfer(Account from, Account to, Money amount) {
    synchronized (from.lock()) {
        synchronized (to.lock()) {
            from.debit(amount);
            to.credit(amount);
        }
    }
}
```

Concurrent:

```text
transfer(A, B)
transfer(B, A)
```

Deadlock possible.

## 37.2 Fixed ordering

```java
void transfer(Account from, Account to, Money amount) {
    Account first = from.id().compareTo(to.id()) < 0 ? from : to;
    Account second = first == from ? to : from;

    synchronized (first.lock()) {
        synchronized (second.lock()) {
            from.debit(amount);
            to.credit(amount);
        }
    }
}
```

## 37.3 Lesson

```text
Multiple resource acquisition needs deterministic order.
```

---

# 38. Mini Case Study: Thread Pool Waiting on Itself

## 38.1 Broken

```java
ExecutorService pool = Executors.newFixedThreadPool(2);

Callable<String> parent = () -> {
    Future<String> child = pool.submit(() -> slowCall());
    return child.get();
};

pool.submit(parent);
pool.submit(parent);
```

Both workers run parent and wait for child.

Children cannot run.

## 38.2 Fixes

- do not block on child in same pool;
- use virtual-thread-per-task executor for blocking subtasks;
- use structured concurrency;
- use separate executor;
- use async composition.

## 38.3 Lesson

```text
Bounded pools must not synchronously wait on tasks queued to themselves.
```

---

# 39. Mini Case Study: DB Pool Starvation After Virtual Thread Migration

## 39.1 Before

```text
Tomcat/platform worker threads = 200
DB pool = 50
```

Concurrency accidentally limited.

## 39.2 After

```text
virtual-thread request handling
5,000 concurrent requests reach DB pool
```

Symptoms:

- connection wait spikes;
- p99 latency huge;
- DB CPU high;
- timeouts;
- retry storm.

## 39.3 Fix

- per-endpoint DB bulkhead;
- request admission;
- query timeout;
- retry budget;
- DB query optimization;
- tune pool cautiously;
- cache/read model.

## 39.4 Lesson

```text
Virtual threads require replacing accidental thread limits with explicit resource limits.
```

---

# 40. Common Anti-Patterns

## 40.1 Nested locks without ordering

Deadlock.

## 40.2 Calling callback under lock

External deadlock.

## 40.3 Holding DB connection while calling remote API

Pool starvation/deadlock.

## 40.4 Blocking on same executor

Thread-pool starvation deadlock.

## 40.5 Common pool for blocking I/O

ForkJoin starvation.

## 40.6 Infinite retry without backoff

Livelock/load amplification.

## 40.7 No timeout

Infinite wait.

## 40.8 Fairness everywhere

Throughput collapse.

## 40.9 No fairness anywhere

Starvation.

## 40.10 Virtual threads without resource limits

Resource starvation.

---

# 41. Best Practices

## 41.1 Define lock ordering

For all multi-lock operations.

## 41.2 Avoid nested locks

If possible.

## 41.3 Use open calls

Do not call external code under lock.

## 41.4 Use timeouts

Every external wait.

## 41.5 Use tryLock when ordering impossible

With backoff.

## 41.6 Separate executors by workload

CPU vs blocking vs scheduled vs urgent.

## 41.7 Avoid blocking in ForkJoin common pool

Use dedicated executor/virtual threads.

## 41.8 Add resource bulkheads

DB/HTTP/semaphore/rate limit.

## 41.9 Monitor wait times

Not just utilization.

## 41.10 Capture thread dumps/JFR on incident

Evidence first.

---

# 42. Decision Matrix

| Symptom / Scenario | Likely Issue | Action |
|---|---|---|
| Threads BLOCKED on same monitors | lock contention/deadlock | thread dump, lock ordering |
| Deadlock reported in thread dump | Java lock deadlock | fix ordering/open calls |
| All pool workers WAITING on Future | pool starvation deadlock | separate executor/structured concurrency |
| DB connection wait high | DB pool starvation | reduce hold time, bulkhead, optimize |
| HTTP pool wait high | downstream starvation | per-downstream bulkhead/timeouts |
| High CPU, many runnable virtual threads | CPU saturation | bounded CPU pool/batching |
| Many virtual threads waiting DB | resource saturation | DB bulkhead/admission |
| Tasks retry rapidly no progress | livelock/retry storm | backoff/jitter/budget |
| Low-priority never runs | starvation | fairness/quota/separate queues |
| p99 high with hot lock | lock convoy | split lock/immutable/concurrent structure |
| Message partition stuck | poison/slow message | DLQ/backoff/checkpoint |
| No errors but stuck | liveness issue | thread dump/JFR/wait metrics |

---

# 43. Latihan

## Latihan 1 — Deadlock Reproduction

Buat dua lock dan dua thread yang acquire lock dengan urutan berbeda.

## Latihan 2 — Lock Ordering

Refactor deadlock dua account transfer dengan ordering berdasarkan ID.

## Latihan 3 — Pool Starvation

Buat fixed pool size 1, task parent submit child ke pool yang sama dan wait. Jelaskan deadlock.

## Latihan 4 — Open Call

Refactor listener notification agar callback dipanggil di luar lock.

## Latihan 5 — tryLock Timeout

Implementasikan operasi dua lock dengan `tryLock(timeout)` dan random backoff.

## Latihan 6 — Livelock

Simulasikan polite retry dan tambahkan jitter.

## Latihan 7 — DB Pool Analysis

Diberi DB pool 30 dan 500 virtual-thread requests, desain bulkhead dan timeout.

## Latihan 8 — Thread Dump Reading

Ambil contoh thread dump dan tandai BLOCKED/WAITING/TIMED_WAITING.

## Latihan 9 — Executor Design

Pisahkan executor untuk CPU, blocking I/O, dan scheduled tasks.

## Latihan 10 — Production Runbook

Buat runbook incident “service stuck no errors” dengan langkah capture evidence dan mitigasi.

---

# 44. Ringkasan

Part ini membahas liveness failure modes dalam concurrent Java.

Core lessons:

- Correct concurrent program harus aman dan membuat progress.
- Deadlock adalah circular wait tanpa escape.
- Empat kondisi deadlock: mutual exclusion, hold-and-wait, no preemption, circular wait.
- Intrinsic locks dan ReentrantLock sama-sama bisa deadlock.
- Resource pools dan DB transactions juga bisa deadlock/starve.
- Thread-pool starvation deadlock terjadi saat worker menunggu task yang butuh worker di pool yang sama.
- Virtual threads tidak menghilangkan logical deadlock.
- Lock ordering mencegah circular wait.
- Open calls menghindari deadlock dari callback/external code.
- Timeout/tryLock menyediakan escape path, bukan pengganti desain benar.
- Thread dumps dan `ThreadMXBean` membantu mendeteksi Java lock deadlocks.
- Livelock adalah activity without progress.
- Livelock dicegah dengan ordering, backoff, jitter, retry budget.
- Starvation berarti sebagian task tidak mendapat progress.
- Fairness mengurangi starvation tetapi bisa menurunkan throughput.
- ForkJoin common pool tidak cocok untuk blocking I/O umum.
- Virtual-thread apps tetap bisa starve pada CPU/resource/lock/memory.
- DB/HTTP/message systems butuh fairness, timeout, bulkhead, dan observability.
- Production recovery harus capture evidence sebelum root-cause analysis.

Main rule:

```text
Every wait in production must have:
an owner, a reason, a bound, a cancellation path,
and an observable metric.
```

---

# 45. Referensi

1. Java SE 25 — `ThreadMXBean` Deadlock Detection  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.management/java/lang/management/ThreadMXBean.html

2. Java SE 25 — `ReentrantLock`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html

3. Java SE 25 — `Lock`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/Lock.html

4. Java SE 25 — `ExecutorService`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html

5. Java SE 25 — `ForkJoinPool`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinPool.html

6. Java SE 25 — `Semaphore`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html

7. Java SE 25 — `Thread.State`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.State.html

8. Java SE 25 — `StructuredTaskScope`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html

9. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

10. OpenJDK JEP 491 — Synchronize Virtual Threads without Pinning  
    https://openjdk.org/jeps/491

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 018](./learn-java-concurrency-and-reactive-part-018.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 020](./learn-java-concurrency-and-reactive-part-020.md)

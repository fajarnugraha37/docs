# learn-java-concurrency-and-reactive-part-014.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 014  
# Virtual Threads Internals, Pinning, Carrier Threads, Scheduler, Mount/Unmount, Diagnostics, and Limitations

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **014**  
> Fokus: memahami sisi internal virtual threads yang penting untuk production engineering: carrier threads, scheduler, mount/unmount, parking, blocking behavior, pinning, JEP 491, synchronized/native limitations, JFR diagnostics, `VirtualThreadSchedulerMXBean`, observability, resource bottlenecks, dan batasan yang harus dipahami sebelum memakai virtual threads pada sistem high-concurrency.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Recap: Virtual Thread sebagai Lightweight `Thread`](#2-recap-virtual-thread-sebagai-lightweight-thread)
3. [Mental Model: Virtual Thread, Carrier Thread, Scheduler](#3-mental-model-virtual-thread-carrier-thread-scheduler)
4. [Carrier Thread](#4-carrier-thread)
5. [Scheduler Virtual Thread](#5-scheduler-virtual-thread)
6. [Target Parallelism](#6-target-parallelism)
7. [Mounting](#7-mounting)
8. [Unmounting](#8-unmounting)
9. [Parking and Blocking](#9-parking-and-blocking)
10. [Continuation Mental Model](#10-continuation-mental-model)
11. [Why Blocking Can Become Cheap](#11-why-blocking-can-become-cheap)
12. [When Blocking Is Still Expensive](#12-when-blocking-is-still-expensive)
13. [Pinning: Definisi](#13-pinning-definisi)
14. [Kenapa Pinning Berbahaya](#14-kenapa-pinning-berbahaya)
15. [Pinning Before and After JEP 491](#15-pinning-before-and-after-jep-491)
16. [Synchronized and Pinning](#16-synchronized-and-pinning)
17. [Native/Foreign Calls and Pinning-Like Carrier Capture](#17-nativeforeign-calls-and-pinning-like-carrier-capture)
18. [File I/O, Network I/O, JDBC: Practical View](#18-file-io-network-io-jdbc-practical-view)
19. [Locks, Parking, and Coordination Primitives](#19-locks-parking-and-coordination-primitives)
20. [ThreadLocal Internals and Cost](#20-threadlocal-internals-and-cost)
21. [Virtual Thread Stack and Memory](#21-virtual-thread-stack-and-memory)
22. [Virtual Thread State and Lifecycle Internals](#22-virtual-thread-state-and-lifecycle-internals)
23. [Daemon Behavior and JVM Lifetime](#23-daemon-behavior-and-jvm-lifetime)
24. [Scheduler Observability with `VirtualThreadSchedulerMXBean`](#24-scheduler-observability-with-virtualthreadschedulermxbean)
25. [JFR Events for Virtual Threads](#25-jfr-events-for-virtual-threads)
26. [Thread Dumps and Diagnostics](#26-thread-dumps-and-diagnostics)
27. [Pinning Diagnostics](#27-pinning-diagnostics)
28. [Resource Bottlenecks Hidden by Virtual Threads](#28-resource-bottlenecks-hidden-by-virtual-threads)
29. [Backpressure and Admission Control](#29-backpressure-and-admission-control)
30. [Virtual Threads and CPU Saturation](#30-virtual-threads-and-cpu-saturation)
31. [Virtual Threads and Lock Contention](#31-virtual-threads-and-lock-contention)
32. [Virtual Threads and Memory Pressure](#32-virtual-threads-and-memory-pressure)
33. [Virtual Threads and Structured Concurrency Preview](#33-virtual-threads-and-structured-concurrency-preview)
34. [Production Tuning Knobs](#34-production-tuning-knobs)
35. [Mini Case Study: Carrier Starvation from Pinning](#35-mini-case-study-carrier-starvation-from-pinning)
36. [Mini Case Study: Million Tasks but DB Pool 50](#36-mini-case-study-million-tasks-but-db-pool-50)
37. [Mini Case Study: ThreadLocal Buffer Explosion](#37-mini-case-study-threadlocal-buffer-explosion)
38. [Common Misconceptions](#38-common-misconceptions)
39. [Best Practices](#39-best-practices)
40. [Decision Matrix](#40-decision-matrix)
41. [Latihan](#41-latihan)
42. [Ringkasan](#42-ringkasan)
43. [Referensi](#43-referensi)

---

# 1. Tujuan Bagian Ini

Part 013 membahas fundamental virtual threads dari sisi pemakaian.

Part ini masuk lebih dalam:

```text
Bagaimana virtual thread dijalankan?
Apa itu carrier thread?
Apa itu mount/unmount?
Apa itu pinning?
Kenapa pinning bisa menghancurkan scalability?
Apa yang berubah dengan JEP 491?
Apa batasan virtual threads di production?
Bagaimana mendiagnosis virtual-thread issues?
```

Ini bukan sekadar teori internal JVM. Ini penting karena banyak incident virtual-thread migration terjadi bukan karena virtual threads “jelek”, tetapi karena engineer salah memahami bottleneck.

Contoh salah kaprah:

```text
Kita sudah pakai virtual threads, berarti tidak perlu limit DB.
Kita sudah pakai virtual threads, berarti synchronized aman untuk semua kasus.
Kita sudah pakai virtual threads, berarti 1 juta request concurrent pasti aman.
Kita sudah pakai virtual threads, berarti ThreadLocal cache lama tetap aman.
```

Target bagian ini:

```text
Mampu memakai virtual threads dengan mental model production:
cheap thread does not mean cheap resource,
blocking can be cheap only when carrier can be released,
and diagnostics must look at scheduler, carrier, resource, and task levels.
```

---

# 2. Recap: Virtual Thread sebagai Lightweight `Thread`

Virtual thread adalah `java.lang.Thread` yang lightweight dan dikelola oleh JVM.

Bisa:

```java
Thread.ofVirtual().start(task);
Executors.newVirtualThreadPerTaskExecutor();
Thread.currentThread().isVirtual();
Thread.sleep(...);
ThreadLocal;
interrupt;
join;
```

Oracle Java SE 25 guide menjelaskan bahwa Java memiliki platform threads dan virtual threads; virtual threads adalah lightweight threads untuk high-throughput concurrent applications.

## 2.1 Key difference

Platform thread:

```text
Java Thread ≈ OS thread
```

Virtual thread:

```text
Java Thread -> scheduled by JVM over carrier platform threads
```

## 2.2 Main rule

```text
Virtual thread keeps the Thread programming model,
but changes the execution substrate.
```

---

# 3. Mental Model: Virtual Thread, Carrier Thread, Scheduler

Ada tiga konsep utama:

```text
virtual thread  = logical Java thread/task
carrier thread  = platform thread currently executing a virtual thread
scheduler       = JVM component assigning virtual threads to carriers
```

## 3.1 Analogy

Bayangkan:

```text
virtual thread = passenger
carrier thread = taxi
scheduler      = dispatch system
```

Passenger tidak punya taxi tetap.

Passenger naik taxi saat perlu jalan, turun saat menunggu, lalu nanti bisa naik taxi lain.

## 3.2 Main rule

```text
A virtual thread may run on different carrier threads over its lifetime.
Do not depend on carrier identity.
```

---

# 4. Carrier Thread

JEP 444 menyebut platform thread yang digunakan scheduler untuk menjalankan virtual thread sebagai **carrier**; virtual thread bisa dijadwalkan pada carrier berbeda sepanjang lifetime-nya dan scheduler tidak menjaga affinity antara virtual thread dan carrier.

## 4.1 Carrier is platform thread

Carrier tetap OS-backed platform thread.

## 4.2 Carrier executes mounted virtual thread

Ketika virtual thread running, ia mounted pada carrier.

## 4.3 Carrier should be freed on blocking

Saat virtual thread blocking pada operasi yang bisa dipark, virtual thread unmount sehingga carrier bisa menjalankan virtual thread lain.

## 4.4 Main rule

```text
Scalability comes from freeing carrier threads when virtual threads wait.
```

---

# 5. Scheduler Virtual Thread

Virtual thread scheduler mengatur virtual threads ke carrier threads.

## 5.1 Do application developers manage it?

Biasanya tidak.

JVM menyediakan scheduler default.

## 5.2 Scheduler is not business executor

Jangan confuse:

```text
ExecutorService virtual-thread-per-task = API submit task
Virtual thread scheduler = JVM internal scheduling over carriers
```

## 5.3 Main rule

```text
Your executor creates virtual threads.
The JVM scheduler runs them on carriers.
```

---

# 6. Target Parallelism

Virtual thread scheduler punya parallelism target.

Java SE 25 menyediakan `VirtualThreadSchedulerMXBean` untuk monitoring target parallelism, platform threads yang dipakai scheduler, dan jumlah virtual threads yang queued ke scheduler; MXBean ini juga mendukung perubahan target parallelism secara dinamis.

## 6.1 Parallelism is not task count

Target parallelism kira-kira berhubungan dengan carrier execution capacity, bukan jumlah virtual threads.

## 6.2 Many virtual threads can exist

Tapi hanya sebanyak carrier/CPU capacity tertentu yang running at same instant.

## 6.3 Main rule

```text
Virtual thread count can be huge,
but running Java code still requires carrier threads and CPU.
```

---

# 7. Mounting

Mounting:

```text
virtual thread assigned to carrier and executing
```

While mounted:

- Java code runs;
- CPU consumed;
- stack active;
- locks may be acquired;
- Thread.currentThread() returns virtual thread, not carrier.

## 7.1 Important

From Java code, you see virtual thread identity.

You do not see carrier as current thread.

## 7.2 Main rule

```text
Mounted virtual thread is the logical current thread.
Carrier is hidden execution machinery.
```

---

# 8. Unmounting

Unmounting:

```text
virtual thread stops occupying carrier while waiting/parked
```

Examples:

- sleeping;
- waiting on supported blocking I/O;
- parking;
- blocking on many JUC synchronizers.

## 8.1 Benefit

Carrier becomes available to run other virtual threads.

## 8.2 Not termination

Unmounted virtual thread is still alive.

It resumes later.

## 8.3 Main rule

```text
Unmounting is what makes blocking virtual threads scalable.
```

---

# 9. Parking and Blocking

Parking means virtual thread becomes non-runnable until event occurs.

Example:

```java
Thread.sleep(Duration.ofSeconds(1));
```

The virtual thread does not need to occupy carrier for the sleep duration.

## 9.1 Blocking queue

```java
queue.take();
```

Can park waiting thread.

## 9.2 Future get

```java
future.get();
```

Can wait/park depending implementation.

## 9.3 Lock wait

Waiting on modern JUC locks usually parks.

## 9.4 Main rule

```text
Virtual thread waiting should ideally park/unmount, not monopolize a carrier.
```

---

# 10. Continuation Mental Model

Virtual thread can be understood with continuation-like mental model:

```text
save execution state when parked
restore when resumed
```

You do not program continuations directly.

But it explains why a virtual thread can suspend while keeping familiar stack-based code.

## 10.1 Stack traces still meaningful

Unlike callback chains, virtual thread stack can represent logical call path.

## 10.2 Main rule

```text
Virtual threads preserve direct style by letting JVM suspend/resume execution state.
```

---

# 11. Why Blocking Can Become Cheap

Platform thread blocking:

```text
OS thread blocked
```

Virtual thread blocking:

```text
virtual thread parked
carrier thread free
```

This makes many blocking tasks possible.

Example:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (URI uri : uris) {
        executor.submit(() -> httpClient.get(uri));
    }
}
```

## 11.1 Cheap does not mean zero cost

Each virtual thread still has:

- object metadata;
- stack chunks;
- scheduling state;
- ThreadLocal map if used;
- task references.

## 11.2 Main rule

```text
Virtual thread blocking is cheap when it releases the carrier
and the waiting state is small.
```

---

# 12. When Blocking Is Still Expensive

Blocking is still expensive when:

## 12.1 Carrier cannot be released

Pinning/native/blocking limitation.

## 12.2 Resource is scarce

DB connection, socket, rate limit, lock.

## 12.3 Too many waiting tasks

Memory pressure.

## 12.4 Blocking holds lock

Serializes many tasks.

## 12.5 Blocking triggers retries

Amplifies load.

## 12.6 Main rule

```text
Virtual threads make waiting-thread cost smaller,
not waiting-resource cost smaller.
```

---

# 13. Pinning: Definisi

Pinning means:

```text
A virtual thread is unable to unmount from its carrier while blocked.
```

So the carrier remains occupied.

## 13.1 Why called pinned?

Virtual thread becomes “pinned” to carrier.

Carrier cannot run other virtual threads until blocking ends.

## 13.2 Main effect

Virtual-thread scalability collapses toward platform-thread scalability for pinned regions.

## 13.3 Main rule

```text
Pinning turns cheap blocking back into expensive carrier blocking.
```

---

# 14. Kenapa Pinning Berbahaya

If many virtual threads pin carriers:

```text
carrier pool occupied
runnable virtual threads queued
throughput drops
latency spikes
```

Example:

```text
target carrier parallelism = 16
16 virtual threads pinned in blocking calls
other virtual threads cannot run
```

## 14.1 Symptoms

- low throughput despite many virtual threads;
- virtual scheduler queue grows;
- thread dump shows blocking in pinned regions;
- JFR `VirtualThreadPinned` events;
- high latency under load.

## 14.2 Main rule

```text
Pinning is dangerous when pinned blocking duration is long and concurrency is high.
```

---

# 15. Pinning Before and After JEP 491

Historically, virtual threads could be pinned in important cases, especially blocking while inside `synchronized` methods/blocks or native/foreign calls.

JEP 491, “Synchronize Virtual Threads without Pinning,” improves scalability of Java code using `synchronized` by arranging for virtual threads blocked in synchronized constructs to release underlying platform threads, eliminating nearly all cases of virtual threads being pinned to platform threads.

## 15.1 Important nuance

JEP 491 reduces a major source of pinning, but does not mean:

```text
all blocking is free
all native calls unpin
all lock contention disappears
resource limits disappear
```

## 15.2 Main rule

```text
JEP 491 improves synchronized-related pinning,
but production design still needs resource and contention control.
```

---

# 16. Synchronized and Pinning

Before JEP 491, guidance often said:

```text
avoid blocking inside synchronized with virtual threads
```

Because it could pin.

With JEP 491, synchronized-related pinning is dramatically improved.

## 16.1 Still avoid long synchronized sections

Even if carrier can be released:

- lock still serializes;
- many virtual threads wait;
- shared state becomes bottleneck;
- critical section latency matters.

## 16.2 Main rule

```text
JEP 491 reduces carrier pinning from synchronized,
not logical contention on the lock.
```

---

# 17. Native/Foreign Calls and Pinning-Like Carrier Capture

Some native/foreign/blocking operations may still occupy underlying platform resources in ways that limit scalability.

## 17.1 Why

JVM may not be able to safely unmount virtual thread during certain native/foreign calls.

## 17.2 Practical guidance

Audit libraries that:

- call native code;
- use JNI;
- block in OS calls;
- use old drivers;
- perform long synchronized native operations.

## 17.3 Main rule

```text
Virtual-thread scalability depends on whether blocking operations are virtual-thread-friendly.
```

---

# 18. File I/O, Network I/O, JDBC: Practical View

## 18.1 Network I/O

JDK networking APIs are generally designed to work well with virtual threads.

## 18.2 File I/O

File operations may involve OS behavior and can still be bottlenecked by disk.

## 18.3 JDBC

JDBC is blocking and often a good virtual-thread use case, but DB connection pool and DB capacity dominate.

## 18.4 Third-party drivers

Need testing.

Some may use internal pools or native code.

## 18.5 Main rule

```text
Virtual threads make blocking style viable,
but every I/O dependency still needs capacity testing.
```

---

# 19. Locks, Parking, and Coordination Primitives

Modern `java.util.concurrent` synchronizers generally park waiting threads.

Examples:

- `ReentrantLock`;
- `Semaphore`;
- `CountDownLatch`;
- `BlockingQueue`;
- `Phaser`.

## 19.1 Good

Waiting virtual threads can unmount/park.

## 19.2 But contention remains

If a semaphore has 10 permits:

```text
only 10 proceed
others wait
```

That is desired.

## 19.3 Main rule

```text
Parking-friendly waiting is good.
But concurrency limits are still limits.
```

---

# 20. ThreadLocal Internals and Cost

Each virtual thread can have ThreadLocal values.

## 20.1 Cost model

If one ThreadLocal stores 1MB buffer and 10,000 virtual threads use it:

```text
10GB potential memory
```

## 20.2 ThreadLocal maps

ThreadLocal maps are per thread. More threads means more maps/entries.

## 20.3 Avoid heavy caches

Use local variables or bounded resource pools.

## 20.4 Main rule

```text
ThreadLocal cost scales with number of threads that touch it.
Virtual threads can make that number enormous.
```

---

# 21. Virtual Thread Stack and Memory

Virtual thread stacks are managed differently from platform native stacks.

They can grow/shrink in chunks.

## 21.1 Benefit

A virtual thread does not reserve a huge native stack upfront like platform threads typically do.

## 21.2 Still consumes memory

Deep recursion, large stack frames, and many blocked virtual threads still consume memory.

## 21.3 Main rule

```text
Virtual thread stacks are lightweight, not free.
```

---

# 22. Virtual Thread State and Lifecycle Internals

Virtual threads go through logical states similar to threads:

- new;
- runnable;
- running;
- waiting/timed waiting;
- terminated.

## 22.1 Scheduler queue

Runnable virtual threads may wait to be scheduled on carriers.

## 22.2 Task queue vs scheduler queue

Do not confuse:

```text
Executor task submission queue
Virtual thread scheduler queue
Application resource queue
```

Different layers.

## 22.3 Main rule

```text
When diagnosing latency, identify which queue the task is waiting in.
```

---

# 23. Daemon Behavior and JVM Lifetime

Virtual threads are daemon threads.

A JVM exits when only daemon threads remain.

## 23.1 Bug

```java
Thread.ofVirtual().start(() -> importantWork());
```

Main thread exits; important work may be abandoned.

## 23.2 Fix

- join;
- executor close;
- structured scope;
- non-daemon platform lifecycle owner;
- application server lifecycle.

## 23.3 Main rule

```text
Virtual threads need lifecycle ownership because they do not keep JVM alive.
```

---

# 24. Scheduler Observability with `VirtualThreadSchedulerMXBean`

Java SE 25 includes `jdk.management.VirtualThreadSchedulerMXBean`.

It supports monitoring:

- scheduler target parallelism;
- platform threads used by scheduler;
- virtual threads queued to scheduler.

It can also dynamically change target parallelism.

## 24.1 Why useful

If virtual threads are runnable but not running, scheduler queue may grow.

## 24.2 Not complete application observability

You still need:

- DB pool metrics;
- HTTP client metrics;
- semaphore wait;
- lock contention;
- request latency.

## 24.3 Main rule

```text
Scheduler metrics tell you about carrier scheduling,
not business resource health.
```

---

# 25. JFR Events for Virtual Threads

Oracle virtual-thread guide documents JFR events such as:

- `jdk.VirtualThreadStart`;
- `jdk.VirtualThreadEnd`;
- `jdk.VirtualThreadPinned`.

The `jdk.VirtualThreadPinned` event indicates that a virtual thread was pinned and its carrier was not freed for longer than a threshold; older Oracle guide documentation notes it is enabled by default with a threshold such as 20 ms.

## 25.1 Use JFR

JFR can reveal:

- pinning;
- long virtual thread lifetime;
- blocked/parked patterns;
- hotspots.

## 25.2 Main rule

```text
Use JFR to detect virtual-thread pinning and lifecycle anomalies.
```

---

# 26. Thread Dumps and Diagnostics

Thread dumps can show virtual threads and stack traces.

## 26.1 What to look for

- many virtual threads blocked on same lock;
- many waiting for DB connection;
- many in same HTTP client call;
- pinned events;
- carrier threads occupied;
- scheduler queue.

## 26.2 ThreadMXBean caveat

Java SE 25 `ThreadMXBean` docs state some methods return information for live platform threads and do not include virtual thread IDs.

## 26.3 Main rule

```text
Use virtual-thread-aware diagnostics; old thread metrics may miss virtual threads.
```

---

# 27. Pinning Diagnostics

How to investigate:

## 27.1 Enable/inspect JFR

Look for `jdk.VirtualThreadPinned`.

## 27.2 Capture stack traces

Identify code region:

- synchronized block;
- native call;
- blocking library;
- file/driver operation;
- long lock hold.

## 27.3 Reduce duration

- move blocking outside critical section;
- use virtual-thread-friendly libraries;
- upgrade JDK;
- replace problematic native path;
- add timeouts.

## 27.4 Main rule

```text
Pinning diagnosis is stack-trace-driven:
find where virtual thread blocks while carrier cannot be released.
```

---

# 28. Resource Bottlenecks Hidden by Virtual Threads

Virtual threads remove platform-thread scarcity, revealing other bottlenecks.

## 28.1 DB pool

Connection wait grows.

## 28.2 HTTP downstream

Rate limit/connection pool saturates.

## 28.3 Locks

Hot monitor serializes.

## 28.4 Memory

Too many tasks/ThreadLocals/stacks.

## 28.5 CPU

More runnable work than cores.

## 28.6 Main rule

```text
Virtual threads expose the real bottleneck by removing thread scarcity.
```

---

# 29. Backpressure and Admission Control

With platform pools, pool size often accidentally limited concurrency.

With virtual threads, that accidental limit disappears.

You need explicit:

- semaphore;
- rate limiter;
- bounded queue;
- request admission;
- HTTP 429/503;
- circuit breaker;
- DB pool timeout;
- per-tenant quota.

## 29.1 Main rule

```text
When adopting virtual threads, replace accidental thread-pool backpressure with intentional resource backpressure.
```

---

# 30. Virtual Threads and CPU Saturation

If virtual threads do CPU-heavy work:

```text
they compete for carrier CPU time
```

Too many runnable CPU-bound virtual threads:

- scheduler overhead;
- context switching;
- cache pressure;
- no throughput improvement.

## 30.1 Use CPU executor

```java
ExecutorService cpuPool = Executors.newFixedThreadPool(
    Runtime.getRuntime().availableProcessors()
);
```

## 30.2 Main rule

```text
Virtual threads are not a replacement for bounded CPU parallelism.
```

---

# 31. Virtual Threads and Lock Contention

If many virtual threads block on one lock:

```text
only one proceeds at a time
```

Even if waiting is cheap, throughput is serialized.

## 31.1 Fix

- reduce shared mutable state;
- shorten critical section;
- split locks;
- immutable snapshots;
- concurrent collections;
- per-key ownership;
- actor model.

## 31.2 Main rule

```text
Cheap waiting does not make serialized critical sections scalable.
```

---

# 32. Virtual Threads and Memory Pressure

Memory pressure can come from:

- millions of virtual thread objects;
- stack chunks;
- captured lambda state;
- queued tasks;
- ThreadLocal values;
- response buffers;
- request payloads;
- futures/results;
- exception stack traces.

## 32.1 Limit task creation

Do not submit millions of tasks blindly.

Use:

- streaming;
- batching;
- bounded producer;
- semaphore;
- structured scopes;
- pagination.

## 32.2 Main rule

```text
Virtual threads are lightweight enough to be many,
not lightweight enough to be infinite.
```

---

# 33. Virtual Threads and Structured Concurrency Preview

Structured concurrency builds on virtual threads.

It gives:

- parent-child task lifetime;
- cancellation;
- failure policy;
- scoped context;
- clearer fan-out/fan-in.

Example concept:

```text
parent request scope
  -> child virtual thread A
  -> child virtual thread B
  -> join/cancel as a group
```

## 33.1 Why relevant

Many virtual-thread use cases involve subtasks that should not outlive parent.

## 33.2 Main rule

```text
Virtual threads provide cheap child execution.
Structured concurrency provides ownership structure.
```

---

# 34. Production Tuning Knobs

## 34.1 Prefer application limits first

- DB pool;
- HTTP pool;
- semaphore;
- rate limiter;
- request max concurrency.

## 34.2 Scheduler parallelism

May be observed/adjusted through management interface, but avoid using it as first-line business capacity control.

## 34.3 JVM flags

Some virtual-thread scheduler properties exist in JDK implementations, but production tuning should prioritize resource-level design.

## 34.4 Main rule

```text
Do not tune scheduler to hide missing backpressure.
Fix resource limits first.
```

---

# 35. Mini Case Study: Carrier Starvation from Pinning

## 35.1 Situation

Service uses virtual threads.

A code path blocks long inside problematic region that pins carrier.

## 35.2 Symptom

- throughput collapses;
- many virtual threads queued;
- JFR shows pinned events;
- carrier threads occupied.

## 35.3 Fix process

1. Capture JFR.
2. Find pinned stack.
3. Move blocking out of critical/native path if possible.
4. Upgrade JDK if synchronized pinning issue fixed by JEP 491.
5. Add timeout.
6. Add resource guard.
7. Load test.

## 35.4 Lesson

```text
Pinning is diagnosed by runtime evidence, not speculation.
```

---

# 36. Mini Case Study: Million Tasks but DB Pool 50

## 36.1 Code

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Input input : millionInputs) {
        executor.submit(() -> repository.query(input));
    }
}
```

## 36.2 Problem

DB pool has 50 connections.

Consequences:

- many virtual threads waiting;
- memory grows;
- DB overloaded;
- timeouts/retries;
- poor p99 latency.

## 36.3 Fix

```java
Semaphore dbLimit = new Semaphore(50);

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Input input : inputs) {
        executor.submit(() -> {
            if (!dbLimit.tryAcquire(100, TimeUnit.MILLISECONDS)) {
                throw new ServiceBusyException();
            }
            try {
                return repository.query(input);
            } finally {
                dbLimit.release();
            }
        });
    }
}
```

Better: bounded producer/batching.

## 36.4 Lesson

```text
Virtual threads allow high concurrency;
they do not decide safe concurrency for your database.
```

---

# 37. Mini Case Study: ThreadLocal Buffer Explosion

## 37.1 Code

```java
static final ThreadLocal<byte[]> BUFFER =
    ThreadLocal.withInitial(() -> new byte[1024 * 1024]);
```

## 37.2 With 100 platform workers

~100MB.

## 37.3 With 100,000 virtual threads touching it

Potentially enormous.

## 37.4 Fix

- local allocation;
- smaller buffers;
- bounded pool;
- streaming;
- avoid per-thread cache;
- use Scoped Values for context, not caches.

## 37.5 Lesson

```text
Per-thread storage becomes dangerous when threads become cheap and numerous.
```

---

# 38. Common Misconceptions

## 38.1 “Carrier count equals virtual thread count”

No.

## 38.2 “Virtual threads run without platform threads”

No. They run on carrier platform threads.

## 38.3 “Blocking always unmounts”

No. Some operations/contexts may still capture carrier.

## 38.4 “JEP 491 means lock contention is gone”

No. It reduces synchronized-related pinning, not logical serialization.

## 38.5 “ThreadLocal is free now”

No. It can be more expensive because there may be more threads.

## 38.6 “Scheduler tuning replaces backpressure”

No. Resource limits are application-level.

## 38.7 “Virtual threads are infinite”

No. Memory/resources are finite.

## 38.8 Main rule

```text
Virtual threads are lightweight threads, not magic resource virtualization.
```

---

# 39. Best Practices

## 39.1 Use virtual-thread-per-task

Do not pool virtual threads manually.

## 39.2 Use explicit resource limits

DB/API/semaphore/rate limit.

## 39.3 Avoid massive unbounded submission

Stream/batch/bound task creation.

## 39.4 Keep ThreadLocal values small

Avoid heavy caches.

## 39.5 Use JFR for pinning

Do not guess.

## 39.6 Watch scheduler queue

Use `VirtualThreadSchedulerMXBean` where useful.

## 39.7 Monitor resource wait time

DB connection wait, semaphore wait, HTTP pool wait.

## 39.8 Avoid long critical sections

Locks still serialize.

## 39.9 Use timeouts

Every blocking dependency.

## 39.10 Prefer structured concurrency for parent-owned subtasks

Covered in later part.

---

# 40. Decision Matrix

| Symptom / Need | What to Inspect / Do |
|---|---|
| Many virtual threads, low throughput | resource bottleneck, lock contention, pinning |
| JFR pinned events | inspect pinned stack, upgrade/refactor |
| DB connection waits | lower concurrency, semaphore, tune DB pool/query |
| Scheduler queue grows | CPU/carrier saturation or pinning |
| Memory grows | task count, ThreadLocals, captured state, buffers |
| CPU high | CPU-bound workload; use bounded CPU pool |
| p99 latency high | queue wait, downstream wait, lock wait |
| Missing virtual threads in old metrics | use virtual-thread-aware diagnostics |
| Need request fan-out ownership | structured concurrency |
| Synchronized-heavy code on newer JDK | still measure contention; pinning improved by JEP 491 |
| Native blocking library | test with load/JFR |
| ThreadLocal cache old pattern | remove or bound |

---

# 41. Latihan

## Latihan 1 — Carrier Mental Model

Jelaskan bedanya virtual thread, carrier thread, dan scheduler.

## Latihan 2 — Mount/Unmount

Buat timeline virtual thread yang melakukan HTTP call blocking. Tandai kapan mounted/unmounted secara konseptual.

## Latihan 3 — Pinning Explanation

Jelaskan kenapa pinning membuat virtual-thread scalability turun.

## Latihan 4 — JEP 491

Ringkas apa yang diperbaiki JEP 491 dan apa yang tidak diperbaiki.

## Latihan 5 — DB Pool Limit

Endpoint memakai virtual threads dan DB pool 30. Desain semaphore/resource guard.

## Latihan 6 — ThreadLocal Cost

Hitung potensi memory untuk ThreadLocal 256KB jika 80.000 virtual threads menyentuhnya.

## Latihan 7 — Diagnostics Plan

Buat rencana investigasi jika p99 naik setelah migrasi ke virtual threads.

## Latihan 8 — Lock Bottleneck

Desain refactor untuk hot synchronized map: immutable snapshot, ConcurrentHashMap, atau per-key lock.

## Latihan 9 — Scheduler Metrics

Cari bagaimana membaca `VirtualThreadSchedulerMXBean` di aplikasi.

## Latihan 10 — Production Readiness

Buat checklist sebelum mengaktifkan virtual-thread request handling di service dengan JDBC dan 3 downstream HTTP APIs.

---

# 42. Ringkasan

Virtual threads scalable karena JVM dapat menjalankan banyak logical threads di atas carrier platform threads dan membebaskan carrier saat virtual thread menunggu.

Core lessons:

- Carrier thread adalah platform thread yang menjalankan virtual thread saat mounted.
- Scheduler mengatur virtual threads ke carriers.
- Virtual thread bisa berpindah carrier selama lifetime.
- Mounting berarti virtual thread sedang berjalan di carrier.
- Unmounting berarti virtual thread menunggu tanpa menahan carrier.
- Blocking menjadi murah jika virtual thread bisa park/unmount.
- Pinning terjadi ketika virtual thread tidak bisa unmount saat blocked.
- Pinning menahan carrier dan merusak scalability.
- JEP 491 mengurangi hampir semua pinning terkait `synchronized`, tetapi tidak menghapus resource bottleneck.
- Native/foreign/blocking library behavior tetap harus diuji.
- ThreadLocal cost bisa besar karena virtual thread cardinality tinggi.
- Virtual thread stacks lightweight tapi tidak gratis.
- Virtual threads adalah daemon; lifecycle harus di-own.
- `VirtualThreadSchedulerMXBean` membantu memonitor scheduler.
- JFR events seperti `VirtualThreadPinned` penting untuk diagnostics.
- Old thread metrics mungkin tidak mencakup virtual threads.
- Virtual threads menghilangkan platform-thread scarcity dan mengekspos bottleneck lain.
- Resource limits/backpressure wajib.
- CPU-bound work tetap perlu bounded CPU parallelism.
- Lock contention tetap serializes.
- Memory pressure tetap nyata.

Main rule:

```text
Virtual threads scale waiting, not resources.
They are powerful when blocking can unmount from carriers
and when external capacity is explicitly governed.
```

---

# 43. Referensi

1. Oracle Java SE 25 Guide — Virtual Threads  
   https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html

2. Java SE 25 — `Thread`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html

3. Java SE 25 — `Executors.newVirtualThreadPerTaskExecutor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html#newVirtualThreadPerTaskExecutor()

4. Java SE 25 — `VirtualThreadSchedulerMXBean`  
   https://docs.oracle.com/en/java/javase/25/docs/api/jdk.management/jdk/management/VirtualThreadSchedulerMXBean.html

5. Java SE 25 — `ThreadMXBean`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.management/java/lang/management/ThreadMXBean.html

6. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

7. OpenJDK JEP 491 — Synchronize Virtual Threads without Pinning  
   https://openjdk.org/jeps/491

8. OpenJDK JEP 506 — Scoped Values  
   https://openjdk.org/jeps/506

9. OpenJDK JEP 505 — Structured Concurrency  
   https://openjdk.org/jeps/505

10. Oracle JDK 25 Core Libraries Developer Guide  
    https://docs.oracle.com/en/java/javase/25/core/java-core-libraries-developer-guide.pdf

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-concurrency-and-reactive-part-013.md">⬅️ Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 013</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-concurrency-and-reactive-part-015.md">Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 015 ➡️</a>
</div>

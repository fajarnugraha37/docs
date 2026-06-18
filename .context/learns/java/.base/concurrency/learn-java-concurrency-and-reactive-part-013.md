# learn-java-concurrency-and-reactive-part-013.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 013  
# Virtual Threads Fundamentals: Lightweight Threads, Thread-per-Task, Blocking I/O, Carrier Threads, Executors, Lifecycle, and Migration Mental Model

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **013**  
> Fokus: memahami fundamental **Virtual Threads** sebagai perubahan besar dalam model concurrency Java modern. Bagian ini membahas apa itu virtual thread, kenapa ia ada, bedanya dengan platform thread, kapan berguna, kapan tidak, thread-per-task model, blocking I/O, carrier threads, daemon behavior, `Thread.ofVirtual()`, `Executors.newVirtualThreadPerTaskExecutor()`, lifecycle, observability, migration, dan mental model production.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Virtual Threads Ada](#2-kenapa-virtual-threads-ada)
3. [Masalah Platform Thread-per-Request](#3-masalah-platform-thread-per-request)
4. [Apa Itu Virtual Thread](#4-apa-itu-virtual-thread)
5. [Virtual Thread Tetap `java.lang.Thread`](#5-virtual-thread-tetap-javalangthread)
6. [Platform Thread vs Virtual Thread](#6-platform-thread-vs-virtual-thread)
7. [Thread-per-Task Model](#7-thread-per-task-model)
8. [Kenapa Virtual Threads Cocok untuk Blocking I/O](#8-kenapa-virtual-threads-cocok-untuk-blocking-io)
9. [Kenapa Virtual Threads Tidak Membuat CPU Lebih Banyak](#9-kenapa-virtual-threads-tidak-membuat-cpu-lebih-banyak)
10. [Creating Virtual Threads with `Thread.ofVirtual()`](#10-creating-virtual-threads-with-threadofvirtual)
11. [Virtual Thread Builder](#11-virtual-thread-builder)
12. [Virtual Thread Executor](#12-virtual-thread-executor)
13. [Virtual Thread Lifecycle](#13-virtual-thread-lifecycle)
14. [Daemon Status](#14-daemon-status)
15. [Carrier Threads: Mental Model Awal](#15-carrier-threads-mental-model-awal)
16. [Mounting and Unmounting: Preview Mental Model](#16-mounting-and-unmounting-preview-mental-model)
17. [Blocking Operation Behavior](#17-blocking-operation-behavior)
18. [Do Not Pool Virtual Threads](#18-do-not-pool-virtual-threads)
19. [Limit Resources, Not Virtual Threads](#19-limit-resources-not-virtual-threads)
20. [Virtual Threads and ThreadLocal](#20-virtual-threads-and-threadlocal)
21. [Virtual Threads and `synchronized`](#21-virtual-threads-and-synchronized)
22. [Virtual Threads and Existing Blocking Libraries](#22-virtual-threads-and-existing-blocking-libraries)
23. [Virtual Threads and JDBC](#23-virtual-threads-and-jdbc)
24. [Virtual Threads and HTTP Clients](#24-virtual-threads-and-http-clients)
25. [Virtual Threads and Web Servers](#25-virtual-threads-and-web-servers)
26. [Virtual Threads vs CompletableFuture](#26-virtual-threads-vs-completablefuture)
27. [Virtual Threads vs Reactive Programming](#27-virtual-threads-vs-reactive-programming)
28. [Virtual Threads vs Kotlin Coroutines / Go Goroutines: Mental Comparison](#28-virtual-threads-vs-kotlin-coroutines--go-goroutines-mental-comparison)
29. [Observability](#29-observability)
30. [Performance Expectations](#30-performance-expectations)
31. [Migration Strategy](#31-migration-strategy)
32. [Production Design Patterns](#32-production-design-patterns)
33. [Common Misconceptions](#33-common-misconceptions)
34. [Common Failure Modes](#34-common-failure-modes)
35. [Mini Case Study: Blocking Fan-Out API](#35-mini-case-study-blocking-fan-out-api)
36. [Mini Case Study: DB Pool Exhaustion](#36-mini-case-study-db-pool-exhaustion)
37. [Mini Case Study: Replacing CompletableFuture Sprawl](#37-mini-case-study-replacing-completablefuture-sprawl)
38. [Best Practices](#38-best-practices)
39. [Decision Matrix](#39-decision-matrix)
40. [Latihan](#40-latihan)
41. [Ringkasan](#41-ringkasan)
42. [Referensi](#42-referensi)

---

# 1. Tujuan Bagian Ini

Virtual threads adalah salah satu perubahan paling penting dalam Java modern.

Tujuannya bukan membuat CPU menjadi lebih cepat.

Tujuannya adalah membuat model thread-per-task/thread-per-request kembali scalable untuk workload yang banyak menunggu I/O.

Sebelum virtual threads, banyak aplikasi Java harus memilih:

```text
model blocking sederhana tapi butuh banyak platform threads
```

atau:

```text
model async/reactive lebih scalable tapi lebih kompleks
```

Virtual threads mencoba memberi jalan tengah:

```text
tulis kode blocking sederhana,
tetapi thread-nya lightweight sehingga bisa ada sangat banyak concurrent tasks.
```

Target bagian ini:

- memahami apa itu virtual thread;
- memahami kenapa ia berbeda dari platform thread;
- memahami kapan virtual thread cocok;
- memahami kapan tidak cocok;
- memahami cara membuat virtual thread;
- memahami virtual-thread-per-task executor;
- memahami carrier thread secara mental;
- memahami kenapa virtual threads tidak perlu dipool;
- memahami kenapa resource tetap harus dibatasi;
- memahami migrasi dari platform-thread pool/CompletableFuture/reactive ke virtual threads secara hati-hati.

---

# 2. Kenapa Virtual Threads Ada

Masalah besar backend modern:

```text
Aplikasi sering menghabiskan waktu bukan untuk CPU,
tetapi menunggu:
- database;
- HTTP API;
- message broker;
- file/object storage;
- cache;
- network.
```

Platform thread mahal jika jumlah concurrent request sangat besar.

Reactive/asynchronous programming bisa mengurangi jumlah thread, tetapi:

- control flow tersebar;
- stack trace sulit;
- error handling kompleks;
- debugging lebih berat;
- context propagation sulit;
- developer harus berpikir callback/pipeline;
- blocking API existing sulit dipakai.

Virtual threads hadir untuk membuat blocking code menjadi scalable untuk banyak I/O-bound tasks.

JEP 444 memperkenalkan virtual threads ke Java Platform sebagai lightweight threads yang secara dramatis mengurangi effort menulis, memelihara, dan mengobservasi high-throughput concurrent applications.

## 2.1 Main rule

```text
Virtual threads are about scalability of blocking concurrency,
not automatic speedup of computation.
```

---

# 3. Masalah Platform Thread-per-Request

Model klasik:

```text
one request -> one platform thread
```

Kode sederhana:

```java
public Response handle(Request request) {
    User user = userClient.get(request.userId());
    Orders orders = orderClient.get(request.userId());
    return combine(user, orders);
}
```

Tetapi saat `userClient.get()` blocking, platform thread ikut blocking.

Jika ada 10.000 concurrent blocking requests:

```text
butuh sangat banyak platform threads
```

Masalah:

- OS thread mahal;
- stack memory;
- context switching;
- native thread limit;
- scheduler overhead;
- thread pool queueing;
- tail latency;
- complicated async workaround.

## 3.1 Thread pool workaround

```java
ExecutorService pool = Executors.newFixedThreadPool(200);
```

Ini membatasi threads, tetapi:

```text
request lebih banyak akan queue
```

Queue menaikkan latency.

## 3.2 Main rule

```text
Platform threads make blocking simple but expensive at high concurrency.
```

---

# 4. Apa Itu Virtual Thread

Virtual thread adalah thread ringan yang dikelola oleh JVM, bukan satu OS thread dedicated per Java thread.

Oracle Java SE 25 Virtual Threads guide menjelaskan bahwa Java memiliki dua jenis thread: platform threads dan virtual threads; virtual threads adalah lightweight threads yang mengurangi effort menulis, memelihara, dan men-debug high-throughput concurrent applications.

## 4.1 Still a thread

Virtual thread tetap:

```java
java.lang.Thread
```

Bisa:

- punya name;
- punya stack trace;
- diinterrupt;
- join;
- sleep;
- menggunakan ThreadLocal;
- menjalankan blocking code.

## 4.2 Difference

Virtual thread tidak memegang OS thread selama seluruh lifetime-nya.

Ia dapat dipark/unpark oleh JVM.

## 4.3 Main rule

```text
Virtual thread is a Java Thread with lightweight scheduling by the JVM.
```

---

# 5. Virtual Thread Tetap `java.lang.Thread`

Virtual thread bukan callback.

Bukan `CompletableFuture`.

Bukan reactive stream.

Bukan green thread yang terlihat sebagai tipe lain.

Ia adalah `Thread`.

```java
Thread thread = Thread.ofVirtual()
    .name("vt-example")
    .start(() -> {
        System.out.println(Thread.currentThread());
    });
```

Check:

```java
Thread.currentThread().isVirtual()
```

## 5.1 Existing APIs

Banyak API thread tetap berlaku:

```java
Thread.sleep(...)
Thread.currentThread()
Thread.interrupt()
Thread.join()
ThreadLocal
```

## 5.2 Main rule

```text
Virtual threads preserve the familiar thread programming model.
```

---

# 6. Platform Thread vs Virtual Thread

| Aspect | Platform Thread | Virtual Thread |
|---|---|---|
| Backing | OS thread | JVM-managed lightweight thread |
| Cost | expensive | cheap |
| Count | bounded carefully | can be very many |
| Best for | CPU-bound workers, platform integration | blocking I/O tasks |
| Pooling | common | usually unnecessary |
| Blocking | occupies OS thread | can unmount on many blocking operations |
| Daemon | configurable | always daemon |
| ThreadLocal | supported | supported but use carefully |
| Stack | OS/native stack style | JVM-managed, grows differently |
| Scheduler | OS scheduler | JVM scheduler over carrier threads |

## 6.1 Main rule

```text
Platform threads are scarce execution resources.
Virtual threads are cheap task carriers, but tasks still consume resources.
```

---

# 7. Thread-per-Task Model

With platform threads, we often pool threads:

```text
many tasks -> limited worker threads
```

With virtual threads, recommended model is:

```text
one task -> one virtual thread
```

Example:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<Response> future = executor.submit(() -> callRemote());
    return future.get();
}
```

Java SE 25 `Executors.newVirtualThreadPerTaskExecutor()` creates an executor that starts a new virtual thread for each task.

## 7.1 Why not reuse?

Virtual threads are cheap enough that reuse is usually unnecessary.

Pooling virtual threads adds complexity and can accidentally limit concurrency in the wrong place.

## 7.2 Main rule

```text
Use virtual threads per task.
Limit external resources separately.
```

---

# 8. Kenapa Virtual Threads Cocok untuk Blocking I/O

Blocking I/O spends time waiting.

For platform thread:

```text
thread blocked -> OS thread unavailable
```

For virtual thread:

```text
virtual thread can be parked
carrier thread can run other virtual thread
```

This means many concurrent blocking tasks can be represented without one OS thread each.

## 8.1 Example

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<Response>> futures = urls.stream()
        .map(url -> executor.submit(() -> httpClient.get(url)))
        .toList();

    for (Future<Response> future : futures) {
        consume(future.get());
    }
}
```

## 8.2 Main rule

```text
Virtual threads shine when tasks spend most time waiting on I/O.
```

---

# 9. Kenapa Virtual Threads Tidak Membuat CPU Lebih Banyak

If task is CPU-bound:

```java
executor.submit(() -> heavyCompute());
```

10.000 virtual threads on 8 cores still have about 8 cores.

Virtual threads do not multiply CPU.

## 9.1 CPU-bound workload

Use:

- bounded CPU executor;
- ForkJoinPool;
- parallel algorithms;
- batching;
- better algorithm.

## 9.2 Main rule

```text
Virtual threads improve concurrency for waiting, not parallel CPU capacity.
```

---

# 10. Creating Virtual Threads with `Thread.ofVirtual()`

Start directly:

```java
Thread thread = Thread.ofVirtual()
    .name("vt-worker")
    .start(() -> {
        doWork();
    });
```

Unstarted:

```java
Thread thread = Thread.ofVirtual()
    .name("vt-worker")
    .unstarted(() -> doWork());

thread.start();
```

Join:

```java
thread.join();
```

## 10.1 Simple demo

```java
public class VirtualThreadDemo {
    public static void main(String[] args) throws InterruptedException {
        Thread vt = Thread.ofVirtual()
            .name("demo-vt")
            .start(() -> {
                System.out.println("isVirtual=" + Thread.currentThread().isVirtual());
            });

        vt.join();
    }
}
```

## 10.2 Main rule

```text
Thread.ofVirtual() is the low-level builder entry point.
For many tasks, prefer an executor.
```

---

# 11. Virtual Thread Builder

Builder supports naming and factory creation.

```java
ThreadFactory factory = Thread.ofVirtual()
    .name("case-vt-", 0)
    .factory();

Thread thread = factory.newThread(() -> processCase());
thread.start();
```

## 11.1 Why name virtual threads?

Even if many virtual threads exist, names help when debugging specific task types.

Good prefix:

```text
vt-case-fanout-
vt-notification-send-
vt-report-fetch-
```

## 11.2 Main rule

```text
Name virtual threads by workload, not by user data.
```

---

# 12. Virtual Thread Executor

Recommended for task submission:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<String> result = executor.submit(() -> callRemote());
    System.out.println(result.get());
}
```

## 12.1 Why try-with-resources?

Executor is lifecycle-bearing resource.

Closing waits for submitted tasks according to executor close/shutdown semantics.

## 12.2 Submit many tasks

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<Result>> futures = new ArrayList<>();

    for (Input input : inputs) {
        futures.add(executor.submit(() -> process(input)));
    }

    for (Future<Result> future : futures) {
        consume(future.get());
    }
}
```

## 12.3 Main rule

```text
Use virtual-thread-per-task executor to express many independent blocking tasks.
```

---

# 13. Virtual Thread Lifecycle

Lifecycle is still thread lifecycle:

```text
created
started
runnable/running/waiting
terminated
```

## 13.1 A virtual thread is not reusable

Like platform thread, cannot restart after termination.

## 13.2 One task per virtual thread

```text
create -> run task -> terminate
```

## 13.3 Main rule

```text
Virtual threads are cheap one-shot execution contexts.
```

---

# 14. Daemon Status

Java SE 25 `Thread` API states that the daemon status of a virtual thread is always true.

Implication:

```text
virtual threads alone do not keep JVM alive
```

## 14.1 Example problem

```java
Thread.ofVirtual().start(() -> {
    doImportantWork();
});
```

If main exits immediately, JVM may exit before work finishes.

## 14.2 Fix

Wait explicitly:

```java
Thread vt = Thread.ofVirtual().start(() -> doImportantWork());
vt.join();
```

or use executor scope:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    executor.submit(() -> doImportantWork());
}
```

## 14.3 Main rule

```text
Virtual threads are daemon.
Own their lifecycle explicitly.
```

---

# 15. Carrier Threads: Mental Model Awal

Virtual threads run on carrier platform threads.

Think:

```text
virtual thread = task-like Java thread
carrier thread = actual platform thread that executes it when mounted
```

Many virtual threads can be multiplexed over fewer carrier threads.

## 15.1 Do you manage carriers?

Usually no.

JVM manages scheduler/carriers.

## 15.2 Do not depend on carrier identity

Business logic must not care which carrier runs a virtual thread.

## 15.3 Main rule

```text
Carrier threads are JVM implementation machinery.
Design around virtual thread semantics, not carrier identity.
```

---

# 16. Mounting and Unmounting: Preview Mental Model

Conceptually:

```text
virtual thread mounted on carrier -> executes Java code
virtual thread blocks/parks -> unmounted
carrier freed -> runs another virtual thread
virtual thread ready -> mounted again
```

## 16.1 Why it matters

Unmounting allows blocking virtual threads not to monopolize carrier threads.

## 16.2 Simplified view

```text
virtual thread blocking does not necessarily mean platform thread blocked
```

## 16.3 Main rule

```text
Virtual thread scalability depends on the JVM being able to park/unpark virtual threads efficiently.
```

---

# 17. Blocking Operation Behavior

Virtual threads make many blocking operations cheap.

Examples:

- `Thread.sleep`;
- blocking network I/O using supported JDK APIs;
- blocking queues;
- locks/parks;
- many framework blocking operations once compatible.

## 17.1 Not every blocking is equal

Some native calls or blocking inside problematic regions can still pin/occupy carriers depending JDK and operation.

JEP 491 addresses synchronization behavior by improving virtual thread behavior around monitor operations in newer JDK work.

## 17.2 Main rule

```text
Virtual threads make ordinary blocking I/O scalable,
but you still need to know pinning/blocking limitations.
```

---

# 18. Do Not Pool Virtual Threads

Bad:

```java
ExecutorService pool = Executors.newFixedThreadPool(
    100,
    Thread.ofVirtual().factory()
);
```

This limits virtual threads like platform workers.

It usually defeats the model.

## 18.1 Why

Virtual threads are not expensive scarce workers.

Scarce things are:

- DB connections;
- API quotas;
- CPU;
- memory;
- file descriptors;
- locks.

## 18.2 Correct

```java
Executors.newVirtualThreadPerTaskExecutor()
```

plus resource limits.

## 18.3 Main rule

```text
Pool platform threads.
Do not pool virtual threads to save virtual threads.
```

---

# 19. Limit Resources, Not Virtual Threads

Example DB pool has 50 connections.

Virtual threads:

```java
10,000 virtual threads
```

DB connections:

```java
50
```

If all try DB at once:

```text
9,950 wait or timeout
DB pool saturates
latency rises
```

## 19.1 Use semaphore/bulkhead

```java
Semaphore dbPermits = new Semaphore(50);

Result query() throws Exception {
    if (!dbPermits.tryAcquire(100, TimeUnit.MILLISECONDS)) {
        throw new ServiceBusyException("DB saturated");
    }

    try {
        return repository.query();
    } finally {
        dbPermits.release();
    }
}
```

## 19.2 Main rule

```text
Virtual thread count is not your capacity limit.
Downstream resource capacity is.
```

---

# 20. Virtual Threads and ThreadLocal

Virtual threads support ThreadLocal.

JEP 444 notes virtual threads support thread-local variables, improving compatibility with existing libraries.

## 20.1 Good

Existing frameworks using ThreadLocal can often work.

## 20.2 Danger

Many virtual threads can mean many ThreadLocal values.

Heavy ThreadLocal cache:

```java
ThreadLocal<byte[]> buffer
```

can explode memory.

## 20.3 Prefer Scoped Values for immutable context

JEP 506 Scoped Values are designed as immutable scoped context with lower overhead especially with virtual threads and structured concurrency.

## 20.4 Main rule

```text
ThreadLocal works with virtual threads, but heavy or long-lived ThreadLocal patterns must be re-evaluated.
```

---

# 21. Virtual Threads and `synchronized`

Virtual threads can use `synchronized`.

However, lock contention still serializes work.

```java
synchronized (lock) {
    criticalSection();
}
```

Only one virtual thread enters at a time.

## 21.1 Pinning nuance

Older virtual-thread guidance warned about pinning when blocking inside synchronized/native sections. JEP 491 improves synchronization behavior for virtual threads in newer JDKs by reducing pinning around monitor operations.

## 21.2 Still avoid long critical sections

Even without pinning, long locks reduce concurrency.

## 21.3 Main rule

```text
Virtual threads do not remove lock contention or bad critical-section design.
```

---

# 22. Virtual Threads and Existing Blocking Libraries

Virtual threads are valuable because many Java libraries are blocking.

Examples:

- JDBC;
- blocking HTTP clients;
- file APIs;
- SDKs;
- legacy service clients.

## 22.1 Compatibility goal

Use existing blocking code with simpler control flow.

## 22.2 Check library behavior

Some libraries:

- use internal pools;
- block in native code;
- depend on ThreadLocal;
- use synchronized heavily;
- have connection pool limits.

## 22.3 Main rule

```text
Virtual threads let you keep blocking APIs,
but library resource limits and internal behavior still matter.
```

---

# 23. Virtual Threads and JDBC

JDBC is blocking.

Virtual threads can allow one virtual thread per request that blocks on JDBC call.

But DB capacity remains limited.

## 23.1 DB connection pool

If Hikari max pool = 50:

```text
only 50 DB operations can use connections concurrently
```

Virtual threads waiting for connection are cheaper than platform threads, but overload still exists.

## 23.2 Transaction duration

More concurrency can increase:

- locks;
- deadlocks;
- transaction conflicts;
- DB CPU;
- connection wait.

## 23.3 Main rule

```text
Virtual threads make waiting for JDBC cheaper,
not database capacity infinite.
```

---

# 24. Virtual Threads and HTTP Clients

Blocking HTTP call:

```java
Response response = client.send(request);
```

With virtual threads, this can scale better than platform-thread-per-call.

## 24.1 Still configure

- connection pool;
- max concurrent requests;
- timeout;
- retry;
- circuit breaker;
- rate limit;
- semaphore per downstream.

## 24.2 Main rule

```text
Virtual threads simplify blocking HTTP fan-out,
but downstream protection remains mandatory.
```

---

# 25. Virtual Threads and Web Servers

Modern frameworks can use virtual threads for request handling.

Model:

```text
one request -> one virtual thread
```

This allows writing controller/service code in direct blocking style.

## 25.1 Benefits

- simpler stack traces;
- simpler exception flow;
- less async callback code;
- easier debugging.

## 25.2 Risks

- hidden resource saturation;
- accidental unbounded fan-out;
- ThreadLocal cardinality;
- blocking locks;
- DB pool exhaustion.

## 25.3 Main rule

```text
Virtual-thread web servers make blocking code scalable,
but require strict resource limits and timeouts.
```

---

# 26. Virtual Threads vs CompletableFuture

CompletableFuture is useful for async composition.

But many codebases used it only to avoid blocking platform threads.

With virtual threads:

```java
User user = userClient.get(id);
Orders orders = orderClient.get(id);
```

can be acceptable if running in virtual thread.

## 26.1 Fan-out comparison

CompletableFuture:

```java
var user = supplyAsync(() -> userClient.get(id), executor);
var orders = supplyAsync(() -> orderClient.get(id), executor);

return user.thenCombine(orders, Dashboard::new);
```

Virtual thread:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<User> user = executor.submit(() -> userClient.get(id));
    Future<Orders> orders = executor.submit(() -> orderClient.get(id));

    return new Dashboard(user.get(), orders.get());
}
```

## 26.2 Main rule

```text
Use CompletableFuture for async composition.
Use virtual threads when direct blocking code is simpler and sufficient.
```

---

# 27. Virtual Threads vs Reactive Programming

Reactive programming is still useful for:

- streams;
- backpressure;
- event pipelines;
- non-blocking end-to-end systems;
- high-throughput streaming;
- operator-rich transformations.

Virtual threads are useful for:

- request/response blocking I/O;
- legacy blocking code;
- simpler imperative flow;
- many independent blocking tasks.

## 27.1 Not enemies

They solve overlapping but different problems.

## 27.2 Main rule

```text
Virtual threads reduce the need for reactive code solely to avoid blocking.
Reactive remains valuable for asynchronous streams and backpressure.
```

---

# 28. Virtual Threads vs Kotlin Coroutines / Go Goroutines: Mental Comparison

This is a mental analogy, not exact equivalence.

## 28.1 Similarity

All provide lightweight concurrency units.

## 28.2 Difference

Virtual threads preserve Java `Thread` model and blocking style.

Coroutines often require suspend-aware APIs.

Go goroutines are language/runtime primitives with channels as core idiom.

## 28.3 Main rule

```text
Virtual threads are Java’s lightweight thread model,
integrated with existing Thread-based APIs.
```

---

# 29. Observability

Virtual threads improve stack-trace-based debugging compared to callback chains.

## 29.1 Thread dumps

Modern tooling can show virtual threads, but some management APIs focus on platform threads. Java SE 25 `ThreadMXBean` docs state that some methods return information for live platform threads and do not include virtual thread IDs.

## 29.2 Naming

Name virtual threads by workload.

## 29.3 Metrics

Track:

- request count;
- virtual tasks submitted;
- downstream semaphore wait;
- DB connection wait;
- timeout;
- task duration;
- pinning/blocked events if available;
- failures.

## 29.4 Main rule

```text
Virtual threads simplify code, but you still need workload-level observability.
```

---

# 30. Performance Expectations

Virtual threads can improve throughput when:

```text
tasks block often
platform thread count was bottleneck
downstream has capacity
timeouts/backpressure are configured
```

They may not help when:

```text
CPU is bottleneck
DB is bottleneck
lock is bottleneck
external API is bottleneck
GC/memory is bottleneck
algorithm is bad
```

## 30.1 Main rule

```text
Virtual threads remove one bottleneck: platform thread scarcity.
They do not remove all bottlenecks.
```

---

# 31. Migration Strategy

## 31.1 Identify blocking I/O workloads

Good candidates:

- HTTP client calls;
- JDBC-heavy request handlers;
- file/object storage calls;
- service fan-out.

## 31.2 Avoid migrating CPU pools blindly

CPU-bound jobs still need bounded CPU parallelism.

## 31.3 Add resource guards

Before increasing concurrency:

- DB pool;
- semaphore;
- rate limit;
- timeout;
- circuit breaker.

## 31.4 Replace async complexity gradually

Simplify `CompletableFuture` chains where blocking virtual-thread code is clearer.

## 31.5 Load test

Measure:

- throughput;
- latency p95/p99;
- DB wait;
- downstream errors;
- memory;
- GC;
- thread counts;
- lock contention.

## 31.6 Main rule

```text
Migrate to virtual threads as capacity redesign,
not as a one-line executor swap.
```

---

# 32. Production Design Patterns

## 32.1 Request per virtual thread

```text
HTTP request handler runs in virtual thread
blocking service code is acceptable
```

## 32.2 Fan-out with virtual-thread executor

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<A> a = executor.submit(this::loadA);
    Future<B> b = executor.submit(this::loadB);
    return combine(a.get(), b.get());
}
```

## 32.3 Bulkhead with semaphore

```java
Semaphore permits = new Semaphore(100);
```

## 32.4 CPU offload

```java
cpuExecutor.submit(() -> heavyCompute());
```

## 32.5 Immutable context

Use explicit context or Scoped Values.

## 32.6 Main rule

```text
Virtual-thread architecture = simple blocking code + strict resource governance.
```

---

# 33. Common Misconceptions

## 33.1 “Virtual threads make everything faster”

No. They improve scalability when waiting dominates.

## 33.2 “We do not need connection pools anymore”

Wrong. DB/API capacity still limited.

## 33.3 “We should pool virtual threads”

Usually wrong.

## 33.4 “Virtual threads replace reactive completely”

No. Reactive remains useful for streams/backpressure.

## 33.5 “ThreadLocal is always safe now”

No. Cardinality and context design still matter.

## 33.6 “Locks no longer matter”

Locks still serialize.

## 33.7 “Virtual threads are async callbacks”

No. They are Java threads.

## 33.8 Main rule

```text
Virtual threads simplify concurrency, but do not remove the need for architecture.
```

---

# 34. Common Failure Modes

## 34.1 DB pool exhaustion

Too many virtual threads waiting on DB.

## 34.2 Downstream overload

Fan-out creates too many external calls.

## 34.3 Memory pressure

Too many queued/submitted tasks or ThreadLocal values.

## 34.4 Lock bottleneck

Many virtual threads blocked on one lock.

## 34.5 Missing lifecycle wait

Virtual daemon threads abandoned when JVM exits.

## 34.6 CPU saturation

Too many CPU-heavy virtual tasks.

## 34.7 Timeout storm

More concurrency increases downstream timeouts/retries.

## 34.8 Main rule

```text
Virtual-thread incidents usually happen at resource boundaries.
```

---

# 35. Mini Case Study: Blocking Fan-Out API

## 35.1 Requirement

Dashboard calls 4 services:

- profile;
- cases;
- SLA;
- notifications.

## 35.2 Virtual thread solution

```java
Dashboard loadDashboard(UserId userId) throws Exception {
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        Future<Profile> profile =
            executor.submit(() -> profileClient.load(userId));

        Future<CaseSummary> cases =
            executor.submit(() -> caseClient.summary(userId));

        Future<SlaSummary> sla =
            executor.submit(() -> slaClient.summary(userId));

        Future<NotificationCount> notifications =
            executor.submit(() -> notificationClient.count(userId));

        return new Dashboard(
            profile.get(),
            cases.get(),
            sla.get(),
            notifications.get()
        );
    }
}
```

## 35.3 Production additions

- per-client timeout;
- per-client semaphore;
- fallback/partial policy;
- cancellation on failure;
- deadline propagation;
- tracing;
- structured concurrency later.

## 35.4 Lesson

```text
Virtual threads make fan-out code direct, but policies still need design.
```

---

# 36. Mini Case Study: DB Pool Exhaustion

## 36.1 Problem

After enabling virtual-thread request handling, throughput increases. Then DB pool saturates.

Symptoms:

- many requests waiting for DB connection;
- p99 latency increases;
- DB CPU high;
- connection acquisition timeout;
- retries amplify load.

## 36.2 Root cause

Platform thread pool previously limited concurrent DB usage accidentally.

Virtual threads removed that accidental limit.

## 36.3 Fix

- set explicit DB bulkhead;
- tune connection pool;
- add request admission control;
- add query timeout;
- reduce fan-out;
- cache/read model;
- optimize DB queries.

## 36.4 Lesson

```text
Old platform thread limits often acted as accidental bulkheads.
When moving to virtual threads, replace accidental limits with explicit limits.
```

---

# 37. Mini Case Study: Replacing CompletableFuture Sprawl

## 37.1 Before

```java
CompletableFuture<User> user =
    CompletableFuture.supplyAsync(() -> userClient.load(id), executor);

CompletableFuture<Orders> orders =
    user.thenCompose(u ->
        CompletableFuture.supplyAsync(() -> orderClient.load(u.id()), executor));

CompletableFuture<Result> result =
    orders.thenApply(this::convert)
          .exceptionally(this::fallback);
```

## 37.2 After with virtual thread

```java
Result load(UserId id) {
    try {
        User user = userClient.load(id);
        Orders orders = orderClient.load(user.id());
        return convert(orders);
    } catch (Exception e) {
        return fallback(e);
    }
}
```

Run handler in virtual thread.

## 37.3 Not always better

If operations are truly independent, still use fan-out.

If API already returns CompletionStage, CF may remain natural.

## 37.4 Lesson

```text
Virtual threads can restore readable imperative flow for blocking I/O workflows.
```

---

# 38. Best Practices

## 38.1 Use virtual-thread-per-task executor

Do not pool virtual threads manually.

## 38.2 Keep CPU work bounded

Use CPU executor for CPU-heavy work.

## 38.3 Limit downstream resources

Semaphore, connection pool, rate limiter.

## 38.4 Use timeouts everywhere

DB, HTTP, queue, future get.

## 38.5 Avoid heavy ThreadLocal

Especially buffers/caches.

## 38.6 Name workloads

Thread names/log tags/metrics.

## 38.7 Watch locks

Hot locks still bottleneck.

## 38.8 Use immutable context

Explicit context or Scoped Values.

## 38.9 Load test migration

Do not assume.

## 38.10 Prefer structured concurrency for parent-child subtasks

Covered later.

---

# 39. Decision Matrix

| Situation | Virtual Threads? |
|---|---|
| Many blocking HTTP calls | Yes, strong candidate |
| JDBC request handlers | Yes, with DB pool limits |
| CPU-heavy computation | Not primary solution |
| Existing reactive stream with backpressure | Not necessarily |
| Callback-heavy code only to avoid blocking | Consider simplifying |
| Long-running background CPU batch | Use bounded CPU executor |
| Request fan-out to services | Yes, plus structured concurrency later |
| Per-request ThreadLocal-heavy framework | Works, but audit memory/context |
| Millions of tiny CPU tasks | No, consider batching/ForkJoin |
| External API rate-limited | Yes only with semaphore/rate limit |
| Need async stream of many values | Reactive likely better |
| Legacy blocking library | Yes, good candidate after testing |

---

# 40. Latihan

## Latihan 1 — Create Virtual Thread

Buat virtual thread dengan `Thread.ofVirtual().start`, print `isVirtual`, lalu `join`.

## Latihan 2 — Virtual Thread Executor

Submit 1.000 blocking sleep tasks ke `newVirtualThreadPerTaskExecutor`.

## Latihan 3 — Compare Platform Fixed Pool

Bandingkan fixed pool 20 platform threads vs virtual-thread-per-task untuk 1.000 sleep tasks.

## Latihan 4 — DB Semaphore

Buat pseudo-code repository call dengan semaphore limit 50.

## Latihan 5 — CPU Work

Jelaskan kenapa 10.000 virtual threads untuk CPU-heavy hashing tidak membuat 10.000 operasi berjalan paralel.

## Latihan 6 — Daemon Behavior

Buat virtual thread tanpa join dan amati kenapa main bisa selesai sebelum task.

## Latihan 7 — ThreadLocal Memory

Hitung memory jika ThreadLocal buffer 1MB dipakai 20.000 virtual threads.

## Latihan 8 — CompletableFuture Refactor

Ambil chain CompletableFuture sequential dan tulis ulang dengan blocking code yang berjalan dalam virtual thread.

## Latihan 9 — Resource Boundary Audit

Untuk satu endpoint, daftar semua resource yang harus dilimit setelah migrasi ke virtual threads.

## Latihan 10 — Misconception Review

Jelaskan kenapa “virtual threads berarti tidak perlu connection pool” salah.

---

# 41. Ringkasan

Virtual threads mengembalikan kesederhanaan thread-per-task untuk workload blocking I/O.

Core lessons:

- Virtual threads adalah lightweight Java threads.
- Virtual threads tetap `java.lang.Thread`.
- Platform threads mahal dan biasanya perlu dipool.
- Virtual threads murah dan biasanya dibuat per task.
- Virtual threads cocok untuk blocking I/O.
- Virtual threads tidak menambah CPU core.
- Gunakan `Thread.ofVirtual()` untuk low-level creation.
- Gunakan `Executors.newVirtualThreadPerTaskExecutor()` untuk banyak tasks.
- Virtual threads adalah daemon; lifecycle harus di-own.
- Carrier threads adalah platform threads yang menjalankan virtual threads saat mounted.
- JVM dapat unmount virtual threads saat blocking pada banyak operasi.
- Jangan pool virtual threads.
- Limit resource: DB, HTTP, rate limit, locks, memory.
- ThreadLocal didukung, tetapi harus hati-hati.
- Locks tetap serialize.
- Existing blocking libraries bisa lebih mudah digunakan, tetapi tetap audit behavior.
- Virtual threads bisa menggantikan sebagian penggunaan CompletableFuture yang hanya bertujuan menghindari blocking.
- Reactive tetap berguna untuk streams/backpressure.
- Migration harus disertai resource governance dan load testing.

Main rule:

```text
Virtual threads make blocking concurrency cheap,
not resource usage free.
Use simple blocking code,
but make capacity limits explicit.
```

---

# 42. Referensi

1. Oracle Java SE 25 Guide — Virtual Threads  
   https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html

2. Java SE 25 — `Thread`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html

3. Java SE 25 — `Executors.newVirtualThreadPerTaskExecutor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html#newVirtualThreadPerTaskExecutor()

4. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

5. OpenJDK JEP 491 — Synchronize Virtual Threads without Pinning  
   https://openjdk.org/jeps/491

6. OpenJDK JEP 506 — Scoped Values  
   https://openjdk.org/jeps/506

7. OpenJDK JEP 505 — Structured Concurrency  
   https://openjdk.org/jeps/505

8. Java SE 25 — `ThreadMXBean`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.management/java/lang/management/ThreadMXBean.html

9. Java SE 25 — `Semaphore`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html

10. Java SE 25 — `ThreadLocal`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadLocal.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-concurrency-and-reactive-part-012.md](./learn-java-concurrency-and-reactive-part-012.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-concurrency-and-reactive-part-014.md](./learn-java-concurrency-and-reactive-part-014.md)

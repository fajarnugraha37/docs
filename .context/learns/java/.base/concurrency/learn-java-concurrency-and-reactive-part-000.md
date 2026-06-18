# learn-java-concurrency-and-reactive-part-000.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 000  
# Big Picture: From Sequential Java to Modern Concurrent Java

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **000**  
> Fokus: membangun mental model besar sebelum masuk ke detail teknis. Kita akan membedakan concurrency, parallelism, asynchronous, non-blocking, virtual threads, structured concurrency, reactive programming, backpressure, dan production decision-making. Bagian ini sengaja tidak mengulang materi Collections/Streams; semua pembahasan diarahkan ke execution model, correctness, performance, scalability, dan desain sistem concurrent modern.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Concurrency Sulit](#2-kenapa-concurrency-sulit)
3. [Mental Model Besar: Work, Task, Thread, Scheduler, Resource](#3-mental-model-besar-work-task-thread-scheduler-resource)
4. [Sequential vs Concurrent vs Parallel vs Async vs Reactive](#4-sequential-vs-concurrent-vs-parallel-vs-async-vs-reactive)
5. [Concurrency Bukan Selalu Performance](#5-concurrency-bukan-selalu-performance)
6. [CPU-Bound vs I/O-Bound](#6-cpu-bound-vs-io-bound)
7. [Blocking vs Non-Blocking](#7-blocking-vs-non-blocking)
8. [Synchronous vs Asynchronous](#8-synchronous-vs-asynchronous)
9. [Thread-per-Request Model](#9-thread-per-request-model)
10. [Platform Threads](#10-platform-threads)
11. [Virtual Threads](#11-virtual-threads)
12. [Executors and Thread Pools](#12-executors-and-thread-pools)
13. [Futures and CompletableFuture](#13-futures-and-completablefuture)
14. [Structured Concurrency](#14-structured-concurrency)
15. [Scoped Values](#15-scoped-values)
16. [Parallelism](#16-parallelism)
17. [Reactive Programming](#17-reactive-programming)
18. [Backpressure](#18-backpressure)
19. [Choosing the Right Model](#19-choosing-the-right-model)
20. [Production Mental Model](#20-production-mental-model)
21. [Common Misconceptions](#21-common-misconceptions)
22. [Concurrency Failure Modes](#22-concurrency-failure-modes)
23. [Observability from Day One](#23-observability-from-day-one)
24. [Testing Mindset](#24-testing-mindset)
25. [Learning Roadmap of This Series](#25-learning-roadmap-of-this-series)
26. [Decision Matrix](#26-decision-matrix)
27. [Checklist for Every Concurrent Design](#27-checklist-for-every-concurrent-design)
28. [Mini Case Study: Case Dashboard Fan-Out](#28-mini-case-study-case-dashboard-fan-out)
29. [Mini Case Study: Batch Import Pipeline](#29-mini-case-study-batch-import-pipeline)
30. [Mini Case Study: High-Throughput Notification Service](#30-mini-case-study-high-throughput-notification-service)
31. [Anti-Patterns](#31-anti-patterns)
32. [Best Practices](#32-best-practices)
33. [Latihan](#33-latihan)
34. [Ringkasan](#34-ringkasan)
35. [Referensi](#35-referensi)

---

# 1. Tujuan Bagian Ini

Concurrency bukan hanya “menjalankan banyak hal sekaligus”.

Dalam production software engineering, concurrency adalah kemampuan untuk:

- menangani banyak pekerjaan yang overlap;
- menjaga correctness saat banyak aktivitas berjalan bersamaan;
- menggunakan resource secara efisien;
- mengontrol latensi;
- mencegah overload;
- membuat cancellation dan timeout yang jelas;
- menjaga observability;
- menghindari deadlock, starvation, leak, dan race condition;
- memilih model yang tepat: thread, virtual thread, executor, async, parallel, atau reactive.

Bagian ini adalah peta besar.

Kita belum akan deep dive ke detail `synchronized`, `volatile`, `StructuredTaskScope`, atau Reactor operator. Itu semua akan dibahas di part masing-masing. Di sini kita bangun **mental model** yang akan dipakai di seluruh seri.

Target akhir seri ini:

```text
Bukan hanya tahu API concurrency Java,
tetapi mampu mendesain sistem concurrent yang benar, scalable,
observable, testable, dan mudah dirawat.
```

---

# 2. Kenapa Concurrency Sulit

Concurrency sulit karena bug-nya sering:

- tidak deterministik;
- jarang muncul di local;
- muncul hanya saat load tinggi;
- tergantung timing;
- tergantung CPU scheduling;
- tergantung resource eksternal;
- sulit direproduksi;
- bisa menyebabkan data corruption tanpa exception;
- bisa menyebabkan latency naik perlahan;
- bisa terlihat seperti masalah database padahal akar masalah thread pool;
- bisa terlihat seperti masalah CPU padahal akar masalah lock contention;
- bisa terlihat seperti memory leak padahal queue backlog.

Contoh bug sequential:

```java
int total = price + tax;
```

Jika salah, biasanya selalu salah.

Contoh bug concurrent:

```java
counter++;
```

Jika dipanggil banyak thread, kadang benar, kadang salah.

Kenapa?

Karena `counter++` bukan satu operasi atomik. Secara konseptual:

```text
read counter
add 1
write counter
```

Jika dua thread melakukannya bersamaan:

```text
counter = 10

Thread A read 10
Thread B read 10
Thread A write 11
Thread B write 11

Expected 12, actual 11
```

Ini race condition.

## 2.1 Concurrency menambah dimensi waktu

Dalam code sequential, kita mostly berpikir:

```text
baris 1 -> baris 2 -> baris 3
```

Dalam concurrent code, kita harus berpikir:

```text
Thread A baris 1
Thread B baris 1
Thread A baris 2
Thread C baris 1
Thread B baris 2
...
```

Interleaving bisa banyak sekali.

## 2.2 Concurrency menambah dimensi visibility

Satu thread menulis data.

Thread lain membaca data.

Pertanyaan:

```text
Apakah thread pembaca pasti melihat tulisan terbaru?
```

Jawabannya tidak selalu, kecuali ada happens-before relationship.

## 2.3 Concurrency menambah dimensi resource

Thread bukan resource gratis.

Setiap model concurrency berhubungan dengan:

- CPU;
- memory;
- stack;
- scheduler;
- lock;
- queue;
- socket;
- DB connection;
- file descriptor;
- rate limit;
- downstream service capacity.

## 2.4 Main rule

```text
Concurrency is not merely about doing more work.
Concurrency is about coordinating work safely under resource constraints.
```

---

# 3. Mental Model Besar: Work, Task, Thread, Scheduler, Resource

Sebelum belajar API, kita perlu vocabulary.

## 3.1 Work

Work adalah pekerjaan bisnis/logis.

Contoh:

```text
process one HTTP request
validate one uploaded row
send one email
call payment service
compute one report
persist one transaction
```

Work adalah “apa yang perlu dilakukan”.

## 3.2 Task

Task adalah representasi executable dari work.

Di Java bisa berupa:

```java
Runnable task = () -> sendEmail(email);
Callable<Result> task = () -> calculateReport(input);
```

Task adalah “unit yang bisa dijalankan”.

## 3.3 Thread

Thread adalah execution context.

Thread menjalankan instruksi.

Di Java modern ada dua jenis thread utama:

- platform thread;
- virtual thread.

Thread adalah “kendaraan eksekusi”.

## 3.4 Scheduler

Scheduler memilih thread/task mana yang berjalan di CPU atau carrier.

Ada scheduler OS untuk platform threads.

Ada scheduler JVM untuk virtual threads yang memetakan virtual threads ke carrier platform threads.

## 3.5 Resource

Resource adalah sesuatu yang dibutuhkan task:

- CPU core;
- memory;
- DB connection;
- HTTP connection;
- file descriptor;
- lock;
- queue capacity;
- rate limit quota;
- external service capacity.

## 3.6 Mental diagram

```text
Business Work
  -> represented as Task
      -> executed by Thread
          -> scheduled by Scheduler
              -> consumes Resource
```

## 3.7 Why this matters

Banyak engineer salah menyelesaikan masalah concurrency karena salah mengidentifikasi bottleneck.

Contoh:

```text
Problem: endpoint lambat.
Naive fix: tambah thread.
Actual bottleneck: DB connection pool only 10.
Result: tambah thread hanya membuat queue lebih panjang.
```

Atau:

```text
Problem: CPU 100%.
Naive fix: pakai virtual threads.
Actual bottleneck: CPU-bound computation.
Result: virtual threads tidak menambah CPU core.
```

## 3.8 Main rule

```text
Before choosing a concurrency API, identify:
what is the work, what is the task, what executes it,
what schedules it, and what resource limits it.
```

---

# 4. Sequential vs Concurrent vs Parallel vs Async vs Reactive

Istilah ini sering dicampur. Kita harus bedakan.

## 4.1 Sequential

Satu pekerjaan selesai sebelum pekerjaan berikutnya mulai.

```java
Result a = callA();
Result b = callB();
Result c = combine(a, b);
```

Flow:

```text
A -> B -> C
```

Sederhana, mudah dibaca, tetapi bisa lambat jika A dan B independent.

## 4.2 Concurrent

Banyak pekerjaan bisa overlap dalam waktu.

Concurrency tidak selalu berarti berjalan di CPU pada saat yang sama.

Contoh satu CPU core bisa menjalankan banyak thread secara bergantian.

Flow:

```text
A starts
B starts before A finishes
A waits
B runs
A resumes
```

Concurrency adalah soal **overlap**.

## 4.3 Parallel

Banyak pekerjaan benar-benar berjalan pada saat yang sama di banyak CPU core.

Parallelism adalah soal **simultaneous execution**.

Contoh:

```text
Core 1 computes chunk A
Core 2 computes chunk B
Core 3 computes chunk C
```

Parallelism cocok untuk CPU-bound work.

## 4.4 Asynchronous

Caller tidak menunggu hasil secara blocking.

Contoh:

```java
CompletableFuture<User> userFuture = fetchUserAsync(userId);
```

Asynchronous adalah soal **control flow**: hasil datang nanti.

Async bisa memakai thread pool, event loop, callback, future, atau reactive.

## 4.5 Non-blocking

Operation tidak memblokir thread saat menunggu resource.

Contoh non-blocking network I/O:

```text
register interest
return thread to event loop
callback when socket ready
```

Non-blocking adalah soal **resource waiting**.

## 4.6 Reactive

Reactive programming adalah model asynchronous data stream dengan backpressure.

Key concepts:

```text
Publisher
Subscriber
Subscription
demand/request(n)
backpressure
operators
```

Reactive cocok ketika data mengalir sebagai stream asynchronous dan consumer perlu mengontrol demand.

## 4.7 Summary table

| Concept | Core Question |
|---|---|
| Sequential | Apakah satu pekerjaan selesai sebelum berikutnya? |
| Concurrent | Apakah beberapa pekerjaan overlap? |
| Parallel | Apakah beberapa pekerjaan berjalan simultan di beberapa core? |
| Async | Apakah caller tidak blocking menunggu hasil? |
| Non-blocking | Apakah thread tidak tertahan saat menunggu I/O? |
| Reactive | Apakah ada async data stream dengan demand/backpressure? |

## 4.8 Main rule

```text
Concurrency is about structure.
Parallelism is about hardware utilization.
Async is about not waiting in the caller.
Non-blocking is about not occupying a thread while waiting.
Reactive is about asynchronous streams with backpressure.
```

---

# 5. Concurrency Bukan Selalu Performance

Concurrency bisa meningkatkan throughput, tetapi juga bisa memperburuk sistem.

## 5.1 Why concurrency can help

Jika task banyak menunggu I/O:

```text
call DB
call HTTP service
read file
wait queue
```

Thread/task lain bisa berjalan saat satu task menunggu.

## 5.2 Why concurrency can hurt

Concurrency menambah:

- context switching;
- synchronization overhead;
- lock contention;
- memory usage;
- queueing delay;
- debugging complexity;
- failure modes;
- resource contention.

## 5.3 Example: too much concurrency

Misal DB pool 10 connections.

Jika 1000 concurrent tasks semuanya butuh DB:

```text
10 tasks use DB
990 wait for DB connection
memory grows
latency grows
timeouts happen
retry storm starts
```

Menambah concurrency tidak menambah DB capacity.

## 5.4 Throughput vs latency

Throughput:

```text
how many requests per second
```

Latency:

```text
how long one request takes
```

Concurrency bisa menaikkan throughput sampai bottleneck tercapai, tetapi setelah itu latency biasanya naik tajam karena queueing.

## 5.5 Main rule

```text
Concurrency should match system capacity.
More concurrent work than downstream capacity becomes queueing, not speed.
```

---

# 6. CPU-Bound vs I/O-Bound

Ini salah satu pembeda paling penting.

## 6.1 CPU-bound

Task dominan memakai CPU.

Contoh:

- image processing;
- compression;
- encryption;
- JSON parsing besar;
- sorting besar;
- ML inference CPU;
- report calculation heavy;
- regex heavy;
- cryptographic hashing.

Jika CPU-bound, parallelism dibatasi jumlah core.

Rule of thumb:

```text
CPU-bound parallelism ≈ number of cores
```

Terlalu banyak thread hanya membuat context switching.

## 6.2 I/O-bound

Task dominan menunggu I/O.

Contoh:

- DB query;
- HTTP call;
- file read/write;
- Redis call;
- Kafka send/fetch;
- S3 upload/download.

Jika I/O-bound, banyak task bisa overlap karena sebagian besar waktunya menunggu.

Virtual threads sangat cocok untuk banyak blocking I/O tasks karena membuat thread-per-task lebih murah secara mental dan resource thread.

## 6.3 Mixed workload

Banyak backend workload campuran:

```text
parse request
call DB
apply business logic
call HTTP service
serialize response
```

Kita perlu pisahkan:

- blocking I/O section;
- CPU-heavy section;
- critical section;
- resource-limited section.

## 6.4 Main rule

```text
Use parallelism for CPU-bound computation.
Use concurrency for I/O-bound overlap.
Use resource limits for anything bottlenecked by external capacity.
```

---

# 7. Blocking vs Non-Blocking

## 7.1 Blocking

Blocking berarti thread berhenti menunggu operasi selesai.

```java
String body = httpClient.send(request, BodyHandlers.ofString()).body();
```

Saat menunggu network response, thread blocked.

Dengan platform thread, ini mahal jika jumlahnya besar.

Dengan virtual thread, blocking menjadi jauh lebih murah dari sisi thread, tetapi resource eksternal tetap bottleneck.

## 7.2 Non-blocking

Non-blocking berarti thread tidak parkir menunggu operasi selesai.

Biasanya:

```text
register callback / interest
return
resume later when data ready
```

Contoh model:

- NIO selector;
- event loop;
- reactive HTTP client;
- async DB driver.

## 7.3 Blocking is not bad

Blocking code sering:

- lebih mudah dibaca;
- stack trace lebih jelas;
- transaction flow lebih straightforward;
- error handling lebih natural;
- lebih mudah onboarding team.

Virtual threads membuat blocking style kembali menarik untuk high-concurrency I/O systems.

## 7.4 Non-blocking is not automatically faster

Non-blocking bisa:

- lebih kompleks;
- lebih sulit debug;
- butuh library support;
- membutuhkan context propagation khusus;
- mudah mencampur blocking call secara salah;
- operator chain sulit dibaca;
- stack trace lebih abstrak.

## 7.5 Main rule

```text
Blocking is a programming model.
Non-blocking is an implementation/resource strategy.
Choose based on bottleneck, readability, and ecosystem.
```

---

# 8. Synchronous vs Asynchronous

## 8.1 Synchronous

Caller menunggu result.

```java
User user = userService.findUser(userId);
```

Control flow linear.

## 8.2 Asynchronous

Caller menerima handle untuk result nanti.

```java
CompletableFuture<User> future = userService.findUserAsync(userId);
```

Control flow terpisah dari result availability.

## 8.3 Async with blocking underneath

Async API bisa saja internally memakai thread pool blocking.

```text
caller not blocked
worker thread blocked
```

## 8.4 Async with non-blocking underneath

Async API juga bisa memakai event loop non-blocking.

```text
caller not blocked
event loop not blocked
callback later
```

## 8.5 Virtual threads and synchronous style

Virtual threads memungkinkan menulis synchronous blocking code tetapi tetap punya high concurrency.

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<User> user = executor.submit(() -> userClient.getUser(userId));
    Future<List<Order>> orders = executor.submit(() -> orderClient.getOrders(userId));

    return combine(user.get(), orders.get());
}
```

Kode terlihat synchronous di task, tetapi banyak virtual threads bisa overlap.

## 8.6 Main rule

```text
Async API does not guarantee non-blocking implementation.
Synchronous code on virtual threads can still scale for blocking I/O.
```

---

# 9. Thread-per-Request Model

Model tradisional web app:

```text
one incoming HTTP request
  -> assigned one server thread
      -> execute controller/service/repository
      -> return response
```

## 9.1 Strength

- simple;
- linear code;
- easy stack trace;
- easy transaction boundary;
- easy exception handling;
- works well for moderate concurrency.

## 9.2 Weakness with platform threads

Platform threads are relatively expensive.

If many requests block waiting for I/O, many OS threads are occupied doing nothing.

At high concurrency:

- memory grows;
- context switching grows;
- thread pool saturates;
- requests queue;
- latency increases.

## 9.3 Virtual thread version

With virtual threads:

```text
one request -> one virtual thread
```

Blocking I/O does not monopolize platform thread in the same way.

But:

```text
one request still consumes DB connection when DB call active
one request still consumes memory
one request still consumes downstream quota
```

## 9.4 Main rule

```text
Virtual threads improve thread-per-request scalability,
but they do not remove downstream resource limits.
```

---

# 10. Platform Threads

Platform thread in Java is typically a wrapper around OS thread.

## 10.1 Characteristics

- scheduled by OS;
- has OS stack;
- relatively expensive;
- limited practical count;
- good for CPU execution;
- blocking occupies OS thread;
- mature tooling.

## 10.2 When platform threads are fine

- small number of long-running workers;
- CPU-bound pool;
- scheduled background jobs;
- event loops;
- bounded worker pools;
- tasks requiring stable thread identity.

## 10.3 When platform threads hurt

- thousands of concurrent blocking requests;
- high fan-out blocking I/O;
- many waiting tasks;
- thread-per-connection server with huge concurrency.

## 10.4 Main rule

```text
Platform threads are precious execution resources.
Do not create an unbounded number of them.
```

---

# 11. Virtual Threads

Virtual threads are Java threads scheduled by the Java runtime rather than one-to-one by OS scheduler.

## 11.1 Mental model

A virtual thread is still a `java.lang.Thread`, but it is lightweight.

Many virtual threads run over a smaller number of carrier platform threads.

When virtual thread blocks on supported blocking operations, JVM can unmount it from carrier so carrier can run another virtual thread.

## 11.2 Why virtual threads matter

They let us write:

```java
String user = callUserService();
String orders = callOrderService();
```

instead of deeply nested callback/reactive code, while still allowing high concurrency for blocking I/O workloads.

## 11.3 Creating virtual threads

```java
Thread thread = Thread.ofVirtual()
    .name("worker-", 0)
    .start(() -> {
        // task
    });

thread.join();
```

Executor style:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<String> future = executor.submit(() -> callRemoteService());
    String result = future.get();
}
```

## 11.4 What virtual threads are good for

- high concurrency blocking I/O;
- request-per-task server code;
- fan-out service calls;
- replacing complex callback chains;
- simpler code for latency hiding;
- many short-lived independent tasks.

## 11.5 What virtual threads are not good for

- making CPU-bound code faster by magic;
- bypassing DB connection pool limits;
- ignoring backpressure;
- infinite task creation;
- hiding bad timeout design;
- replacing distributed coordination;
- fixing data races automatically.

## 11.6 Main rule

```text
Virtual threads make blocking cheaper, not resources infinite.
```

---

# 12. Executors and Thread Pools

Executor separates task submission from execution.

```java
ExecutorService executor = Executors.newFixedThreadPool(10);

Future<Result> future = executor.submit(() -> doWork());
```

## 12.1 Why executor exists

Without executor:

```java
new Thread(task).start();
```

Problems:

- no central lifecycle;
- no pooling;
- no queue policy;
- no rejection policy;
- hard shutdown;
- unbounded thread creation.

## 12.2 Thread pool mental model

```text
submit task
  -> queue
      -> worker thread picks task
          -> execute
```

## 12.3 Key decisions

- pool size;
- queue type;
- queue size;
- rejection policy;
- thread factory;
- naming;
- shutdown;
- metrics.

## 12.4 Virtual-thread executor

```java
Executors.newVirtualThreadPerTaskExecutor()
```

This creates a new virtual thread for each task.

No fixed pool sizing in the old sense, because virtual threads are cheap. But task submission still must respect external resource limits.

## 12.5 Main rule

```text
Executor design is resource management design.
```

---

# 13. Futures and CompletableFuture

## 13.1 Future

`Future` represents a result that may be available later.

```java
Future<User> future = executor.submit(() -> loadUser(id));
User user = future.get();
```

Limitations:

- `get` blocks;
- poor composition;
- cancellation limited;
- exception handling clunky.

## 13.2 CompletableFuture

`CompletableFuture` supports composition.

```java
CompletableFuture<User> user =
    CompletableFuture.supplyAsync(() -> loadUser(id), executor);

CompletableFuture<Order> order =
    CompletableFuture.supplyAsync(() -> loadOrder(id), executor);

CompletableFuture<Response> response =
    user.thenCombine(order, Response::new);
```

## 13.3 Pitfalls

- default common pool misuse;
- exception swallowed if not observed;
- nested futures;
- cancellation not always propagating;
- difficult debugging of async graphs;
- context propagation issues;
- executor lifetime unclear.

## 13.4 Virtual threads change the trade-off

Some code that previously needed `CompletableFuture` only to avoid blocking can be simpler with virtual threads or structured concurrency.

## 13.5 Main rule

```text
Use CompletableFuture for async composition when it clarifies the model.
Do not use it just to avoid blocking if virtual threads make blocking acceptable.
```

---

# 14. Structured Concurrency

Unstructured concurrency:

```java
Future<A> a = executor.submit(this::callA);
Future<B> b = executor.submit(this::callB);

return combine(a.get(), b.get());
```

Questions:

- What if A fails?
- Is B cancelled?
- What if caller times out?
- Who owns child tasks?
- Are tasks leaked?
- How do logs/traces show relationship?

Structured concurrency treats related concurrent tasks as one unit of work.

Conceptual model:

```text
parent task
  ├── child task A
  ├── child task B
  └── child task C
```

Parent waits for children, failures/cancellation are coordinated.

## 14.1 Why important

It restores structure to concurrent code.

Like structured programming replaced goto-style spaghetti, structured concurrency aims to replace unstructured task spawning.

## 14.2 Java status

In Java 25, Structured Concurrency is still a preview API through JEP 505. That means API details may still change.

## 14.3 Main rule

```text
If tasks are created together to answer one request,
they should be scoped, awaited, cancelled, and observed together.
```

---

# 15. Scoped Values

Traditional context passing options:

## 15.1 Explicit parameters

```java
service.call(context, request);
```

Clear, but can be verbose.

## 15.2 ThreadLocal

```java
CurrentTenant.set(tenantId);
```

Convenient, but can leak and becomes problematic with many threads.

## 15.3 Scoped Values

Scoped values allow immutable data to be shared within a bounded dynamic scope, including child threads in structured concurrency.

Conceptual:

```java
ScopedValue.where(CURRENT_TENANT, tenantId)
    .run(() -> service.handle(request));
```

## 15.4 Why useful

- lifetime bounded;
- immutable;
- easier reasoning;
- better with virtual threads;
- avoids many ThreadLocal leak patterns.

## 15.5 Main rule

```text
Request context should have explicit lifetime.
Scoped Values provide bounded context propagation for modern Java concurrency.
```

---

# 16. Parallelism

Parallelism is about using multiple CPU cores.

## 16.1 CPU-bound example

```java
List<Result> results = chunks.parallelStream()
    .map(this::compute)
    .toList();
```

But parallel streams have caveats.

## 16.2 ForkJoinPool

Java has work-stealing pool designed for recursive/forked parallel tasks.

## 16.3 Speedup limit

If only 30% of program is parallelizable, maximum speedup is limited.

This is Amdahl’s Law conceptually:

```text
Speedup is limited by sequential fraction.
```

## 16.4 Parallelism requires

- independent work chunks;
- no shared mutable state;
- associative operations;
- enough work per task;
- controlled blocking;
- predictable pool behavior.

## 16.5 Main rule

```text
Parallelism is for CPU work that can be split safely.
Virtual threads are for concurrency, not CPU speedup.
```

---

# 17. Reactive Programming

Reactive programming models asynchronous streams of data.

Core pieces:

```text
Publisher emits data
Subscriber consumes data
Subscription connects them
Subscriber requests demand
Publisher respects demand
```

## 17.1 Why reactive exists

Reactive helps when:

- non-blocking I/O matters;
- data is stream-like;
- backpressure matters;
- event-driven pipelines;
- high connection count;
- server-sent events/websocket streams;
- async composition with demand.

## 17.2 Project Reactor vocabulary

Common types:

```text
Mono<T>  = async zero-or-one value
Flux<T>  = async zero-to-many stream
```

## 17.3 Reactive trade-offs

Pros:

- non-blocking resource usage;
- backpressure model;
- rich stream operators;
- good for streaming/event systems.

Cons:

- harder stack traces;
- harder debugging;
- context propagation complexity;
- blocking call mistakes are severe;
- learning curve;
- operator chains can become unreadable.

## 17.4 Main rule

```text
Reactive is not “better threads”.
Reactive is a different programming model for asynchronous streams with backpressure.
```

---

# 18. Backpressure

Backpressure means consumer can signal how much it can handle.

Without backpressure:

```text
producer emits 1M events/sec
consumer handles 10K events/sec
queue grows until OOM
```

With backpressure:

```text
consumer requests N
producer emits at most N
```

## 18.1 Backpressure in thread/queue systems

Bounded queue:

```java
BlockingQueue<Task> queue = new ArrayBlockingQueue<>(1000);
```

If full:

- block producer;
- reject;
- timeout;
- shed load.

## 18.2 Backpressure in reactive streams

Subscriber requests demand:

```text
subscription.request(64)
```

Publisher should not overwhelm subscriber.

## 18.3 Backpressure in web services

- limit concurrent requests;
- limit per-user rate;
- limit batch size;
- reject early;
- circuit breaker;
- bulkhead;
- timeouts.

## 18.4 Main rule

```text
Every producer-consumer system needs a policy for “consumer is slower than producer”.
```

---

# 19. Choosing the Right Model

There is no universal winner.

## 19.1 Simple sequential code

Use when:

- work is simple;
- latency acceptable;
- no overlap needed;
- easiest correctness.

## 19.2 Platform thread pool

Use when:

- bounded background workers;
- CPU-bound pool;
- scheduled tasks;
- legacy app server model;
- explicit capacity limit.

## 19.3 Virtual threads

Use when:

- many blocking I/O tasks;
- request-per-task;
- simple synchronous code preferred;
- high concurrency;
- libraries are blocking but virtual-thread friendly.

## 19.4 CompletableFuture

Use when:

- async API needed;
- compose independent futures;
- integrate with async libraries;
- small fan-out graph;
- no structured concurrency available/appropriate.

## 19.5 Structured concurrency

Use when:

- multiple subtasks belong to one parent operation;
- failure/cancellation should propagate;
- easier observability desired;
- virtual threads used for fan-out.

## 19.6 Reactive

Use when:

- non-blocking stack end-to-end;
- streaming/event data;
- backpressure central;
- WebFlux/Reactor ecosystem;
- very high connection count with streaming.

## 19.7 ForkJoin/parallelism

Use when:

- CPU-bound;
- splittable data;
- enough work;
- associative reductions;
- no blocking.

## 19.8 Main rule

```text
Choose concurrency model from workload and constraints,
not from trend or framework preference.
```

---

# 20. Production Mental Model

A production concurrent system is governed by bottlenecks.

## 20.1 Bottleneck examples

- CPU cores;
- heap;
- DB connection pool;
- DB locks;
- remote API rate limit;
- HTTP connection pool;
- Kafka partition count;
- queue capacity;
- file descriptors;
- lock contention;
- executor queue;
- GC;
- network bandwidth.

## 20.2 Concurrency increases pressure

If one request does:

```text
1 DB query
2 HTTP calls
1 Kafka publish
```

Then 1000 concurrent requests may mean:

```text
1000 DB demand
2000 HTTP call demand
1000 Kafka publish demand
```

If resources cannot handle it, latency explodes.

## 20.3 Design with limits

Every concurrent design needs:

- max concurrency;
- timeout;
- cancellation;
- queue bound;
- rejection;
- retry policy;
- circuit breaker;
- metrics.

## 20.4 Main rule

```text
Concurrency without limits is an incident generator.
```

---

# 21. Common Misconceptions

## 21.1 “Virtual threads make everything faster”

No.

They make blocking concurrency cheaper and code simpler.

CPU-bound code still needs CPU.

DB-bound code still needs DB capacity.

## 21.2 “Non-blocking is always better”

No.

Non-blocking can reduce thread usage, but complexity may not be worth it for CRUD services if virtual threads solve enough.

## 21.3 “Async means parallel”

No.

Async means caller does not wait blocking. It may still use one thread/event loop.

## 21.4 “More threads means more throughput”

Only until bottleneck.

After bottleneck, more threads mean more queueing.

## 21.5 “Parallel stream is free speed”

No.

Parallel streams can be slower or wrong with side effects/blocking/order constraints.

## 21.6 “ThreadLocal is harmless”

No.

ThreadLocal can leak context, especially with pools, and has design issues with many virtual threads.

## 21.7 “If it passes tests, concurrent code is correct”

No.

Concurrency bugs can be rare. Need stress/property/specialized tests.

---

# 22. Concurrency Failure Modes

## 22.1 Race condition

Multiple threads access shared state, at least one write, no proper synchronization.

## 22.2 Deadlock

Threads wait forever for each other’s locks/resources.

## 22.3 Livelock

Threads keep reacting but no progress.

## 22.4 Starvation

A task never gets resource/time.

## 22.5 Thread pool exhaustion

All workers busy/blocked; new tasks queue.

## 22.6 Connection pool starvation

Threads wait for DB connections.

## 22.7 Queue backlog

Producer faster than consumer.

## 22.8 Retry storm

Failures cause retries that amplify load.

## 22.9 Stale read

Thread reads old value due to visibility issue.

## 22.10 Lost update

Concurrent writes overwrite each other.

## 22.11 Context leak

ThreadLocal/security/MDC from previous request contaminates next request.

## 22.12 Cancellation leak

Task continues after caller timed out.

## 22.13 Resource leak

Executor, stream, socket, file, DB cursor not closed.

## 22.14 Pinning/virtual thread bottleneck

Virtual thread pins carrier under certain blocking/synchronized/native situations.

## 22.15 Backpressure failure

System accepts more work than it can process.

---

# 23. Observability from Day One

Concurrent systems need observability.

## 23.1 Thread metrics

- active threads;
- platform thread count;
- virtual thread count if available;
- thread states;
- blocked/waiting/runnable.

## 23.2 Executor metrics

- active count;
- pool size;
- queue size;
- completed task count;
- rejected count.

## 23.3 Queue metrics

- depth;
- enqueue rate;
- dequeue rate;
- age of oldest item;
- processing time.

## 23.4 Resource metrics

- DB pool active/idle/waiting;
- HTTP pool active/idle;
- rate limit usage;
- file descriptors;
- CPU;
- heap;
- GC.

## 23.5 Latency metrics

- p50/p95/p99;
- timeout count;
- cancellation count;
- retry count.

## 23.6 Diagnostic tools

- thread dump;
- JFR;
- heap dump;
- async profiler;
- logs with correlation ID;
- distributed tracing.

## 23.7 Main rule

```text
If a concurrent system has no queue/resource metrics,
you are debugging blind.
```

---

# 24. Testing Mindset

Concurrent code needs more than unit tests.

## 24.1 Unit tests

Good for deterministic logic.

## 24.2 Integration tests

Good for DB/HTTP/executor behavior.

## 24.3 Stress tests

Repeatedly try to trigger race/timing bugs.

## 24.4 Load tests

Measure throughput/latency/resource behavior under realistic concurrency.

## 24.5 Chaos/failure tests

Inject timeouts, cancellations, downstream slowness.

## 24.6 Specialized concurrency tests

Tools like jcstress test Java Memory Model edge cases.

## 24.7 Avoid sleep-based tests

Bad:

```java
Thread.sleep(1000);
assertTrue(done);
```

Better:

- latch;
- await condition;
- timeout;
- deterministic coordination.

## 24.8 Main rule

```text
Concurrent code should be tested for correctness, timing, cancellation,
resource limits, and behavior under load.
```

---

# 25. Learning Roadmap of This Series

This series has 35 parts.

## 25.1 Foundation

Part 000–006:

- big picture;
- OS/JVM threads;
- Java Thread;
- task model;
- executors;
- thread pools;
- CompletableFuture.

## 25.2 Correctness

Part 007–012:

- Java Memory Model;
- volatile;
- atomics;
- locks;
- coordination primitives;
- immutability;
- ThreadLocal/context.

## 25.3 Modern Java

Part 013–018:

- virtual threads;
- pinning;
- designing with virtual threads;
- structured concurrency;
- scoped values;
- cancellation/timeouts.

## 25.4 Production Concurrency

Part 019–030:

- deadlock/starvation;
- concurrent structures;
- producer-consumer;
- parallelism;
- parallel streams execution;
- Spring Boot/web concurrency;
- DB concurrency;
- distributed coordination;
- debugging/observability;
- performance;
- testing;
- failure case studies.

## 25.5 Reactive Overview

Part 031–034:

- reactive mental model;
- Reactive Streams/Reactor;
- choosing between reactive/virtual threads/CompletableFuture;
- capstone high-concurrency service.

---

# 26. Decision Matrix

| Situation | Recommended Starting Model |
|---|---|
| Simple CRUD endpoint, moderate load | Sequential/blocking platform thread model |
| High-concurrency blocking I/O service | Virtual threads |
| Fan-out to several blocking downstreams | Virtual threads + structured concurrency |
| Need async result composition | CompletableFuture or structured concurrency |
| CPU-heavy computation | Fixed CPU pool/ForkJoin/parallelism |
| Continuous event stream with backpressure | Reactive streams / stream processor |
| Server-sent events/WebSocket high connection count | Reactive/non-blocking or virtual thread depending stack |
| Blocking JDBC heavy service | Virtual threads + DB pool limits |
| Complex transaction workflow | Synchronous/imperative flow, possibly virtual thread |
| Background worker queue | Bounded executor/queue + backpressure |
| Batch import | Bounded pipeline + batch size + backpressure |
| Distributed duplicate requests | Idempotency keys + DB constraints |
| Need request context across subtasks | Scoped Values / explicit context |
| Legacy ThreadLocal-heavy app | Careful cleanup; evaluate Scoped Values |
| Need fastest raw CPU throughput | Avoid too many threads; benchmark CPU parallelism |

---

# 27. Checklist for Every Concurrent Design

Ask these before writing code.

## 27.1 Work

- What is the unit of work?
- Is it independent?
- Is it idempotent?
- Can it be cancelled?
- Can it be retried?

## 27.2 Execution

- What executes it?
- Platform thread?
- Virtual thread?
- Executor?
- Event loop?
- Reactive scheduler?

## 27.3 Resource

- What resource does it consume?
- CPU?
- DB connection?
- HTTP connection?
- lock?
- queue slot?
- memory?

## 27.4 Limit

- What is max concurrency?
- What is max queue size?
- What is max batch size?
- What is timeout?
- What happens when full?

## 27.5 Correctness

- Is there shared mutable state?
- Is visibility guaranteed?
- Is update atomic?
- Is lock ordering safe?
- Is cancellation safe?

## 27.6 Failure

- What if one subtask fails?
- Are sibling tasks cancelled?
- Are resources closed?
- Are partial results allowed?
- Is retry safe?

## 27.7 Observability

- Can we see queue depth?
- Can we see active tasks?
- Can we see timeouts?
- Can we see rejection?
- Can we trace child tasks?

## 27.8 Testing

- Is there stress test?
- Is there load test?
- Is cancellation tested?
- Is timeout tested?
- Is shutdown tested?

---

# 28. Mini Case Study: Case Dashboard Fan-Out

## 28.1 Problem

Dashboard needs:

- case summary;
- SLA summary;
- assignee workload;
- notification count.

Each from different service/DB query.

Sequential:

```java
CaseSummary cases = caseClient.summary(user);
SlaSummary sla = slaClient.summary(user);
Workload workload = workloadClient.summary(user);
NotificationCount notifications = notificationClient.count(user);

return new Dashboard(cases, sla, workload, notifications);
```

If each takes 200ms, total ~800ms.

## 28.2 Concurrent idea

Run independent calls concurrently.

Options:

- CompletableFuture;
- virtual threads + structured concurrency;
- reactive zip.

## 28.3 Virtual-thread style concept

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<CaseSummary> cases = executor.submit(() -> caseClient.summary(user));
    Future<SlaSummary> sla = executor.submit(() -> slaClient.summary(user));
    Future<Workload> workload = executor.submit(() -> workloadClient.summary(user));
    Future<NotificationCount> notifications = executor.submit(() -> notificationClient.count(user));

    return new Dashboard(
        cases.get(),
        sla.get(),
        workload.get(),
        notifications.get()
    );
}
```

## 28.4 Missing production details

This code still needs:

- timeout;
- cancellation;
- failure policy;
- resource limits;
- tracing;
- context propagation;
- fallback;
- observability.

## 28.5 Better conceptual target

Use structured concurrency in part 016.

## 28.6 Lesson

```text
Concurrency can reduce latency when independent I/O waits overlap,
but production design must define failure and cancellation.
```

---

# 29. Mini Case Study: Batch Import Pipeline

## 29.1 Problem

Import 100k rows.

Each row:

- parse;
- validate;
- enrich from DB/API;
- persist;
- report errors.

## 29.2 Bad design

```java
rows.parallelStream()
    .forEach(row -> repository.save(process(row)));
```

Problems:

- unbounded DB pressure;
- no backpressure;
- transaction chaos;
- shared error list race;
- partial failure unclear;
- hard retry;
- connection pool starvation.

## 29.3 Better model

Pipeline with bounded concurrency:

```text
read batch
  -> parse sequential or bounded
  -> validate
  -> enrich with bounded pool / virtual threads + semaphore
  -> persist in controlled transaction batches
  -> collect capped errors
```

## 29.4 Key limits

- max batch size;
- max concurrent enrich calls;
- DB connection pool guard;
- max errors;
- timeout per row/external call;
- idempotency key.

## 29.5 Lesson

```text
Batch concurrency is not “parallelize everything”.
It is controlled throughput with failure isolation.
```

---

# 30. Mini Case Study: High-Throughput Notification Service

## 30.1 Problem

Service receives notification requests and sends emails/SMS/push.

## 30.2 Bad design

```java
Queue<Notification> queue = new ConcurrentLinkedQueue<>();
```

Unbounded queue.

If provider slow:

```text
queue grows
heap grows
latency grows
OOM
```

## 30.3 Better design

- bounded queue;
- rate limit per provider;
- retry with backoff;
- dead-letter;
- idempotency;
- worker pool size based on provider capacity;
- queue depth metrics;
- shed load when overloaded.

## 30.4 Virtual threads?

Virtual threads can help with many blocking provider calls, but provider quota still limits throughput.

Use semaphore/bulkhead:

```java
Semaphore providerLimit = new Semaphore(50);
```

## 30.5 Lesson

```text
Concurrency without backpressure turns downstream slowness into local memory failure.
```

---

# 31. Anti-Patterns

## 31.1 `new Thread` everywhere

No lifecycle, no limits.

## 31.2 Unbounded executor queue

Latency and memory explosion.

## 31.3 Ignoring interrupt

Cancellation does not work.

## 31.4 Blocking in event loop

Kills non-blocking system.

## 31.5 Parallel stream for I/O

Often wrong pool, bad control, unclear resource limit.

## 31.6 Shared mutable state without synchronization

Race condition.

## 31.7 ThreadLocal without cleanup

Context leak.

## 31.8 CompletableFuture without executor

Accidental common pool usage.

## 31.9 CompletableFuture exception ignored

Failure hidden.

## 31.10 Virtual threads without resource limits

DB/downstream saturation.

## 31.11 Reactive with blocking calls

Event loop starvation.

## 31.12 Retry without backoff/budget

Retry storm.

## 31.13 No timeout

Tasks can hang indefinitely.

## 31.14 No shutdown

Executor/resource leak.

## 31.15 No metrics

Impossible to diagnose under load.

---

# 32. Best Practices

## 32.1 Start simple

Sequential code is best until latency/throughput requirements demand concurrency.

## 32.2 Identify workload type

CPU-bound, I/O-bound, mixed, streaming.

## 32.3 Use bounded resources

Queue, concurrency, batch, retry, timeout.

## 32.4 Prefer structured lifetimes

Tasks should have owner and cancellation path.

## 32.5 Avoid shared mutable state

Use immutability, confinement, message passing, or proper synchronization.

## 32.6 Use virtual threads for blocking I/O concurrency

But guard external resources.

## 32.7 Use platform pools for bounded CPU work

Do not run unlimited CPU work on virtual threads.

## 32.8 Use reactive for async streams/backpressure

Especially when non-blocking stack is end-to-end.

## 32.9 Observe everything

Thread pools, queues, DB pools, timeouts, rejections.

## 32.10 Test failure modes

Timeout, cancellation, saturation, shutdown, retry.

---

# 33. Latihan

## Latihan 1 — Classify Workload

Untuk setiap workload berikut, klasifikasikan CPU-bound/I/O-bound/mixed:

1. generate PDF report besar;
2. call 5 downstream HTTP services;
3. encrypt 10GB file;
4. import CSV and validate against DB;
5. websocket notification stream.

Jelaskan model concurrency yang cocok.

## Latihan 2 — Identify Bottleneck

Endpoint lambat saat concurrency naik dari 50 ke 500. CPU 30%, DB pool penuh, thread count tinggi.

Jawab:

- bottleneck apa?
- apakah virtual threads membantu?
- guardrail apa yang perlu?

## Latihan 3 — Model Choice

Pilih model untuk:

- CRUD Spring MVC app;
- high-concurrency blocking API gateway;
- event stream processor;
- CPU-heavy calculation service;
- dashboard fan-out service.

## Latihan 4 — Backpressure Design

Desain notification queue dengan:

- max queue size;
- max provider concurrency;
- retry;
- DLQ;
- metrics.

## Latihan 5 — Context Propagation

Bandingkan explicit parameter, ThreadLocal, dan ScopedValue untuk tenant/correlation ID.

## Latihan 6 — Failure Policy

Dashboard memanggil 4 downstream. Jika salah satu gagal, apa policy?

- fail whole request?
- partial response?
- fallback?
- cancel siblings?

## Latihan 7 — Observability Plan

Buat metrics minimum untuk executor service yang menjalankan background jobs.

## Latihan 8 — Anti-Pattern Detection

Temukan masalah dari pseudo-code:

```java
CompletableFuture.runAsync(() -> repository.save(entity));
```

tanpa executor, tanpa exception handling, tanpa transaction boundary.

## Latihan 9 — Virtual Thread Resource Guard

Desain guard agar 10k virtual threads tidak membuat DB pool 50 connections overload.

## Latihan 10 — Learning Map

Tulis ulang dengan kata-katamu sendiri:

```text
concurrency vs parallelism vs async vs non-blocking vs reactive
```

---

# 34. Ringkasan

Bagian ini adalah fondasi mental model untuk seluruh seri.

Core lessons:

- Concurrency adalah coordination under resource constraints.
- Task, thread, scheduler, dan resource adalah konsep berbeda.
- Concurrent tidak sama dengan parallel.
- Async tidak sama dengan non-blocking.
- Reactive bukan sekadar async; reactive adalah async streams dengan backpressure.
- CPU-bound butuh parallelism yang dibatasi core.
- I/O-bound bisa mendapat manfaat dari concurrency.
- Platform threads mahal jika dipakai untuk massive blocking.
- Virtual threads membuat blocking thread-per-task jauh lebih scalable dan readable.
- Virtual threads tidak membuat CPU atau DB capacity menjadi infinite.
- Executor design adalah resource management.
- CompletableFuture berguna untuk async composition, tetapi bisa kompleks.
- Structured concurrency memberi lifetime yang jelas untuk task yang berkaitan.
- Scoped values memberi context propagation dengan bounded lifetime.
- Backpressure wajib dalam producer-consumer systems.
- Production concurrency harus punya limit, timeout, cancellation, metrics, dan tests.
- Model yang benar dipilih dari workload, bukan hype.

Main rule:

```text
Before making code concurrent, answer:
What work overlaps, what resource is limiting, what failure policy applies,
how cancellation works, and how we will observe saturation?
```

---

# 35. Referensi

1. Java SE 25 — `Thread`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html

2. Oracle Java SE 25 Guide — Virtual Threads  
   https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html

3. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

4. OpenJDK JEP 505 — Structured Concurrency, Fifth Preview  
   https://openjdk.org/jeps/505

5. OpenJDK JEP 506 — Scoped Values  
   https://openjdk.org/jeps/506

6. Java SE 25 — `Executors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html

7. Java SE 25 — `CompletableFuture`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html

8. Java SE 25 — `ExecutorService`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html

9. Reactive Streams  
   https://www.reactive-streams.org/

10. Project Reactor Reference Documentation  
    https://projectreactor.io/docs/core/release/reference/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Collections and Streams — Part 062](../collections/learn-java-collections-and-streams-part-062.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 001](./learn-java-concurrency-and-reactive-part-001.md)

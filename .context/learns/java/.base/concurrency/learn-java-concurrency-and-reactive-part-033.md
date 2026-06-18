# learn-java-concurrency-and-reactive-part-033.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 033  
# Reactive vs Virtual Threads vs CompletableFuture: Choosing the Right Model for Java Concurrency, I/O, Streams, Fan-Out, CPU Work, and Production Maintainability

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **033**  
> Fokus: membuat decision framework untuk memilih model concurrency Java modern: **imperative blocking dengan virtual threads**, **Reactive Streams/Reactor**, **CompletableFuture**, **platform thread pools**, **ForkJoin/parallelism**, dan hybrid patterns. Bagian ini membahas trade-off dari sisi workload, readability, performance, backpressure, streaming, cancellation, context propagation, observability, team capability, migration, dan production risk.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Masalah Utama: Terlalu Banyak Model](#2-masalah-utama-terlalu-banyak-model)
3. [Ringkasan Cepat Tiap Model](#3-ringkasan-cepat-tiap-model)
4. [Model 1 — Imperative Blocking + Platform Threads](#4-model-1--imperative-blocking--platform-threads)
5. [Model 2 — Imperative Blocking + Virtual Threads](#5-model-2--imperative-blocking--virtual-threads)
6. [Model 3 — CompletableFuture](#6-model-3--completablefuture)
7. [Model 4 — Reactive Streams / Reactor](#7-model-4--reactive-streams--reactor)
8. [Model 5 — ForkJoin / CPU Parallelism](#8-model-5--forkjoin--cpu-parallelism)
9. [Axis 1: Workload Type](#9-axis-1-workload-type)
10. [Axis 2: Result Shape](#10-axis-2-result-shape)
11. [Axis 3: Blocking vs Non-Blocking Dependencies](#11-axis-3-blocking-vs-nonblocking-dependencies)
12. [Axis 4: Backpressure Need](#12-axis-4-backpressure-need)
13. [Axis 5: Streaming Need](#13-axis-5-streaming-need)
14. [Axis 6: Fan-Out and Cancellation](#14-axis-6-fanout-and-cancellation)
15. [Axis 7: Ordering](#15-axis-7-ordering)
16. [Axis 8: Context Propagation](#16-axis-8-context-propagation)
17. [Axis 9: Observability and Debugging](#17-axis-9-observability-and-debugging)
18. [Axis 10: Team and Codebase Fit](#18-axis-10-team-and-codebase-fit)
19. [Virtual Threads vs Reactive](#19-virtual-threads-vs-reactive)
20. [Virtual Threads vs CompletableFuture](#20-virtual-threads-vs-completablefuture)
21. [CompletableFuture vs Reactive](#21-completablefuture-vs-reactive)
22. [Reactive vs ForkJoin](#22-reactive-vs-forkjoin)
23. [Choosing for Spring MVC](#23-choosing-for-spring-mvc)
24. [Choosing for Spring WebFlux](#24-choosing-for-spring-webflux)
25. [Choosing for Batch Jobs](#25-choosing-for-batch-jobs)
26. [Choosing for Message Consumers](#26-choosing-for-message-consumers)
27. [Choosing for High Fan-Out API Aggregation](#27-choosing-for-high-fanout-api-aggregation)
28. [Choosing for Streaming APIs](#28-choosing-for-streaming-apis)
29. [Choosing for CPU-Heavy Work](#29-choosing-for-cpuheavy-work)
30. [Hybrid Architecture Rules](#30-hybrid-architecture-rules)
31. [Boundary Patterns](#31-boundary-patterns)
32. [Migration Strategy](#32-migration-strategy)
33. [Performance Comparison Mental Model](#33-performance-comparison-mental-model)
34. [Failure Mode Comparison](#34-failure-mode-comparison)
35. [Testing Strategy by Model](#35-testing-strategy-by-model)
36. [Observability by Model](#36-observability-by-model)
37. [Mini Case Study: CRUD Service on Spring MVC](#37-mini-case-study-crud-service-on-spring-mvc)
38. [Mini Case Study: Streaming Notifications](#38-mini-case-study-streaming-notifications)
39. [Mini Case Study: Dashboard Fan-Out](#39-mini-case-study-dashboard-fanout)
40. [Mini Case Study: Report Generation](#40-mini-case-study-report-generation)
41. [Common Anti-Patterns](#41-common-antipatterns)
42. [Best Practices](#42-best-practices)
43. [Decision Matrix](#43-decision-matrix)
44. [Latihan](#44-latihan)
45. [Ringkasan](#45-ringkasan)
46. [Referensi](#46-referensi)

---

# 1. Tujuan Bagian Ini

Java modern punya banyak model concurrency:

```text
Thread
ExecutorService
CompletableFuture
ForkJoinPool
parallelStream
virtual threads
structured concurrency
Reactive Streams
Project Reactor
Spring MVC
Spring WebFlux
```

Masalahnya bukan kurang alat.

Masalahnya:

```text
Kapan memilih alat yang mana?
```

Kesalahan umum:

- memakai reactive hanya karena dianggap modern;
- memakai virtual threads untuk CPU-bound work;
- memakai `CompletableFuture` untuk stream panjang;
- memakai parallel stream untuk DB calls;
- mencampur MVC blocking dan reactive tanpa boundary jelas;
- memakai `@Async` untuk durable background work;
- menganggap semua concurrency model setara.

Target bagian ini:

```text
Mampu memilih model concurrency berdasarkan workload,
bukan tren atau preferensi pribadi.
```

---

# 2. Masalah Utama: Terlalu Banyak Model

Setiap model punya kekuatan dan biaya.

Tidak ada satu model yang selalu terbaik.

Pertanyaan yang harus dijawab:

```text
Apakah workload CPU-bound atau I/O-bound?
Apakah hasilnya single value atau stream?
Apakah dependency blocking atau non-blocking?
Apakah butuh backpressure?
Apakah butuh cancellation tree?
Apakah butuh ordering?
Apakah team mampu debug model ini?
Apakah stack existing mendukung?
```

## 2.1 Main rule

```text
Concurrency model is an architectural choice, not syntax preference.
```

---

# 3. Ringkasan Cepat Tiap Model

## 3.1 Platform threads

Good for:

- small/medium blocking workloads;
- legacy code;
- bounded thread pools.

Weakness:

- expensive when many blocking tasks.

## 3.2 Virtual threads

Good for:

- many blocking I/O tasks;
- imperative request/response code;
- simpler migration.

Weakness:

- not CPU scaling;
- resource limits still explicit;
- ThreadLocal/pinning considerations.

## 3.3 CompletableFuture

Good for:

- composing finite async tasks;
- 0/1 result;
- API aggregation;
- non-blocking completion chains.

Weakness:

- no stream backpressure;
- cancellation/error propagation subtle;
- executor choice often hidden.

## 3.4 Reactive Streams/Reactor

Good for:

- asynchronous streams;
- backpressure;
- non-blocking I/O;
- WebFlux;
- streaming APIs.

Weakness:

- cognitive/debugging cost;
- blocking boundary dangerous;
- ThreadLocal context mismatch.

## 3.5 ForkJoin/parallelism

Good for:

- CPU-bound divide-and-conquer;
- data parallelism;
- reductions.

Weakness:

- bad for blocking I/O;
- requires granularity tuning.

## 3.6 Main rule

```text
Pick the model whose strengths match the dominant bottleneck and data shape.
```

---

# 4. Model 1 — Imperative Blocking + Platform Threads

Classic Java server style:

```java
User user = userRepository.findById(id);
Orders orders = orderClient.findByUser(id);
return combine(user, orders);
```

## 4.1 Good when

- concurrency moderate;
- codebase legacy;
- team familiar;
- thread count bounded;
- simplicity matters;
- no massive blocking concurrency.

## 4.2 Limit

Each blocking operation holds a platform thread.

## 4.3 Failure modes

- servlet thread exhaustion;
- executor queue growth;
- context switching;
- stack memory overhead;
- low throughput under many waits.

## 4.4 Main rule

```text
Platform-thread blocking is simple but scales poorly when many tasks mostly wait.
```

---

# 5. Model 2 — Imperative Blocking + Virtual Threads

Virtual-thread style:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<User> user = executor.submit(() -> userRepository.findById(id));
    Future<Orders> orders = executor.submit(() -> orderClient.findByUser(id));

    return combine(user.get(), orders.get());
}
```

Or Spring MVC request runs on virtual thread.

## 5.1 Good when

- dependencies are blocking;
- code is imperative;
- request/response style;
- many concurrent waits;
- simpler debugging than reactive;
- JDBC stack remains.

## 5.2 Requires

- DB pool limits;
- HTTP bulkheads;
- timeouts;
- cancellation;
- ThreadLocal audit;
- pinning awareness;
- CPU work bounded separately.

## 5.3 Failure modes

- DB/API overload after thread bottleneck removed;
- many virtual threads waiting due to no resource limits;
- ThreadLocal memory blow-up;
- CPU saturation if misused;
- pinning in problematic paths.

## 5.4 Main rule

```text
Virtual threads are ideal for making blocking I/O code scalable, if scarce resources are explicitly bounded.
```

---

# 6. Model 3 — CompletableFuture

`CompletableFuture` represents a future single result and composition stages.

Example:

```java
CompletableFuture<User> user =
    CompletableFuture.supplyAsync(() -> userClient.load(id), executor);

CompletableFuture<Orders> orders =
    CompletableFuture.supplyAsync(() -> orderClient.load(id), executor);

return user.thenCombine(orders, this::combine);
```

## 6.1 Good when

- finite number of async operations;
- 0/1 result per operation;
- simple fan-out/fan-in;
- integration with APIs returning futures;
- no stream backpressure needed.

## 6.2 Requires

- explicit executor;
- timeout;
- error handling;
- cancellation propagation;
- avoiding common pool blocking;
- avoiding same-pool deadlock.

## 6.3 Failure modes

- swallowed exceptions;
- common pool saturation;
- cancellation not propagated;
- nested futures;
- callback execution surprises;
- no natural backpressure for many items.

## 6.4 Main rule

```text
CompletableFuture is best for composing finite asynchronous single-result tasks.
```

---

# 7. Model 4 — Reactive Streams / Reactor

Reactor model:

```java
Mono<User> user = userClient.load(id);
Mono<Orders> orders = orderClient.loadOrders(id);

return Mono.zip(user, orders)
    .map(tuple -> combine(tuple.getT1(), tuple.getT2()));
```

## 7.1 Good when

- non-blocking I/O stack;
- stream of data;
- backpressure;
- WebFlux;
- SSE/WebSocket;
- event pipelines;
- reactive DB/client;
- cancellation propagation through stream.

## 7.2 Requires

- no blocking on event loop;
- understanding operators;
- context propagation;
- scheduler discipline;
- backpressure testing;
- reactive observability.

## 7.3 Failure modes

- blocking event loop;
- unbounded `flatMap`;
- duplicate subscription;
- context loss;
- silent error swallowing;
- difficult stack traces;
- retry storm.

## 7.4 Main rule

```text
Reactive is best when asynchronous streams and backpressure are first-class requirements.
```

---

# 8. Model 5 — ForkJoin / CPU Parallelism

ForkJoin style:

```java
long sum = forkJoinPool.invoke(new SumTask(values, 0, values.length));
```

## 8.1 Good when

- CPU-bound;
- data can split;
- divide-and-conquer;
- large in-memory data;
- associative reduction.

## 8.2 Bad when

- blocking DB/HTTP;
- tiny tasks;
- shared mutable state;
- ordering constraints dominate.

## 8.3 Main rule

```text
ForkJoin is for CPU parallelism, not I/O concurrency.
```

---

# 9. Axis 1: Workload Type

## 9.1 I/O-bound blocking

Best candidates:

- virtual threads;
- platform threads if small scale;
- CompletableFuture with explicit executor;
- reactive only if non-blocking stack exists.

## 9.2 I/O-bound non-blocking stream

Best candidate:

- reactive.

## 9.3 CPU-bound

Best candidates:

- bounded CPU pool;
- ForkJoin;
- parallel stream if simple and measured.

## 9.4 Mixed

Use boundaries:

```text
virtual threads for blocking orchestration
bounded CPU pool for CPU work
reactive for stream segments
```

## 9.5 Main rule

```text
First classify bottleneck: waiting, streaming, or computation.
```

---

# 10. Axis 2: Result Shape

## 10.1 Single result

Options:

- imperative return;
- virtual thread;
- CompletableFuture;
- Mono.

## 10.2 Many finite results

Options:

- sequential collection;
- bounded executor;
- Flux;
- batch query.

## 10.3 Infinite/long stream

Options:

- Flux/reactive;
- message consumer;
- SSE/WebSocket.

## 10.4 Main rule

```text
Single result and stream result deserve different models.
```

---

# 11. Axis 3: Blocking vs Non-Blocking Dependencies

If dependencies are blocking:

- JDBC;
- blocking HTTP client;
- file I/O;
- legacy SDK.

Then virtual threads may be simpler.

If dependencies are non-blocking:

- reactive HTTP client;
- reactive DB driver;
- event-loop based networking.

Then reactive may fit better.

## 11.1 Main rule

```text
Reactive stack with blocking dependencies is not truly reactive unless blocking boundaries are isolated.
```

---

# 12. Axis 4: Backpressure Need

Need backpressure when:

- producer can outpace consumer;
- stream length large/unbounded;
- client controls consumption;
- downstream capacity matters;
- memory should not buffer unbounded data.

Reactive Streams has protocol-level demand.

Virtual threads need manual backpressure:

- bounded queue;
- semaphore;
- rate limiter;
- admission control.

## 12.1 Main rule

```text
Reactive gives stream backpressure protocol; imperative models need explicit boundaries.
```

---

# 13. Axis 5: Streaming Need

If response is stream:

- SSE;
- WebSocket;
- file chunks;
- event feed;
- database change feed.

Reactive usually fits naturally.

If response is simple JSON object:

- MVC + virtual threads often simpler.

## 13.1 Main rule

```text
Reactive shines when partial, continuous, or backpressured output is core.
```

---

# 14. Axis 6: Fan-Out and Cancellation

Fan-out:

```text
one request triggers many child operations
```

Options:

## 14.1 Structured concurrency

Best for imperative fan-out with virtual threads.

## 14.2 CompletableFuture

Good for finite fan-out but cancellation subtle.

## 14.3 Reactive flatMap/zip

Good if sources are reactive and cancellation/backpressure needed.

## 14.4 Main rule

```text
Fan-out model should make cancellation and failure propagation explicit.
```

---

# 15. Axis 7: Ordering

If strict order:

- sequential;
- `concatMap`;
- single consumer;
- per-key partition.

If order not important:

- `flatMap`;
- parallelism;
- virtual-thread fan-out.

If per-key order:

- partition by key;
- actor/queue per key;
- Kafka partition key.

## 15.1 Main rule

```text
Ordering requirement can dominate concurrency choice.
```

---

# 16. Axis 8: Context Propagation

## 16.1 ThreadLocal-friendly

- platform thread request;
- virtual thread request;
- imperative call stack.

Still must clear context.

## 16.2 Context-challenging

- CompletableFuture;
- `@Async`;
- reactive scheduler hops;
- parallel streams.

Need explicit context or framework propagation.

## 16.3 Main rule

```text
Concurrency model determines whether context follows thread, task, or signal.
```

---

# 17. Axis 9: Observability and Debugging

## 17.1 Imperative + virtual threads

Pros:

- stack traces often readable;
- thread dump intuitive;
- easier local reasoning.

Cons:

- many virtual threads;
- pinning/resource waits need JFR/metrics.

## 17.2 CompletableFuture

Pros:

- finite DAG.

Cons:

- async stack/callback harder;
- executor hidden.

## 17.3 Reactive

Pros:

- rich signal lifecycle if instrumented;
- backpressure visible if measured.

Cons:

- stack traces/operator chain harder;
- context/scheduler complexity.

## 17.4 Main rule

```text
Choose a model your team can observe and debug in production.
```

---

# 18. Axis 10: Team and Codebase Fit

A technically powerful model can fail if team cannot maintain it.

Consider:

- existing stack;
- libraries;
- team familiarity;
- debugging tools;
- code review skill;
- operational maturity;
- testing maturity.

## 18.1 Main rule

```text
The best concurrency model is not only correct technically; it must be operable by the team.
```

---

# 19. Virtual Threads vs Reactive

## 19.1 Virtual threads

```text
imperative
blocking-friendly
simple call stack
manual backpressure
great for JDBC/MVC migration
```

## 19.2 Reactive

```text
declarative signal pipeline
non-blocking
protocol backpressure
great for streaming/event loops
higher cognitive cost
```

## 19.3 Choose virtual threads when

- app is mostly blocking request/response;
- JDBC is core;
- streaming/backpressure not central;
- simplicity matters.

## 19.4 Choose reactive when

- non-blocking end-to-end;
- streaming;
- backpressure central;
- WebFlux ecosystem.

## 19.5 Main rule

```text
Virtual threads make blocking code scalable.
Reactive makes asynchronous streams controllable.
```

---

# 20. Virtual Threads vs CompletableFuture

## 20.1 Virtual threads

Simpler imperative code:

```java
var a = executor.submit(this::loadA);
var b = executor.submit(this::loadB);
return combine(a.get(), b.get());
```

## 20.2 CompletableFuture

Composition style:

```java
return loadAAsync()
    .thenCombine(loadBAsync(), this::combine);
```

## 20.3 Choose virtual threads when

- code readability matters;
- blocking APIs;
- structured concurrency available;
- natural request scope.

## 20.4 Choose CompletableFuture when

- API already future-based;
- finite async composition;
- non-blocking completion stage chain useful.

## 20.5 Main rule

```text
Virtual threads restore direct style; CompletableFuture models explicit async result composition.
```

---

# 21. CompletableFuture vs Reactive

## 21.1 CompletableFuture

0/1 result.

No stream backpressure.

## 21.2 Reactive

0..N result with demand/backpressure.

## 21.3 Choose CompletableFuture when

- finite single result;
- no stream;
- no demand protocol;
- simple async fan-out.

## 21.4 Choose reactive when

- stream;
- cancellation/backpressure;
- reactive library ecosystem.

## 21.5 Main rule

```text
CompletableFuture is for async value; Reactive Streams is for async flow.
```

---

# 22. Reactive vs ForkJoin

## 22.1 Reactive

I/O/event streams/backpressure.

## 22.2 ForkJoin

CPU divide-and-conquer.

## 22.3 Do not confuse

Reactive pipelines can schedule CPU work, but CPU-bound work still needs bounded CPU resources.

## 22.4 Main rule

```text
Reactive is flow control; ForkJoin is compute parallelism.
```

---

# 23. Choosing for Spring MVC

Spring MVC with blocking JDBC/HTTP:

Good options:

- platform threads for moderate concurrency;
- virtual threads for high blocking concurrency;
- `@Async` carefully for side tasks;
- structured concurrency for request fan-out.

Avoid:

- mixing reactive internally without need;
- parallel stream for DB calls;
- unbounded async.

## 23.1 Main rule

```text
For Spring MVC blocking services, virtual threads are often the simplest modern scaling path.
```

---

# 24. Choosing for Spring WebFlux

Spring WebFlux:

Good when:

- reactive clients/drivers;
- event streams;
- non-blocking pipeline.

Avoid:

- blocking JDBC on event loop;
- `.block()` in request path;
- ThreadLocal assumptions;
- unbounded `flatMap`.

## 24.1 Main rule

```text
For WebFlux, keep the stack non-blocking or isolate blocking boundaries deliberately.
```

---

# 25. Choosing for Batch Jobs

Batch job may include:

- file I/O;
- DB reads/writes;
- CPU transform;
- remote calls.

Model:

- bounded queues/pipelines;
- virtual threads for blocking I/O;
- CPU pool for compute;
- chunked DB transactions;
- backpressure.

Reactive if stream/backpressure ecosystem is natural.

## 25.1 Main rule

```text
Batch is usually pipeline + bounded resources, not unlimited threads.
```

---

# 26. Choosing for Message Consumers

Message consumers need:

- idempotency;
- retry/DLQ;
- backpressure;
- partition ordering;
- DB transaction boundary.

Model:

- consumer concurrency based on partition/resource limits;
- virtual threads for blocking handler if appropriate;
- reactive if broker/client pipeline is reactive.

## 26.1 Main rule

```text
Message concurrency is governed by broker semantics, idempotency, and downstream limits.
```

---

# 27. Choosing for High Fan-Out API Aggregation

Options:

## 27.1 Virtual threads + structured concurrency

Good for blocking clients.

## 27.2 Reactive zip/flatMap

Good for reactive clients.

## 27.3 CompletableFuture

Good for finite async clients.

## 27.4 Requirements

- per-downstream bulkhead;
- timeout/deadline;
- fallback;
- cancellation;
- observability.

## 27.5 Main rule

```text
Fan-out choice follows client type: blocking -> virtual threads; reactive -> Reactor; future APIs -> CompletableFuture.
```

---

# 28. Choosing for Streaming APIs

Streaming APIs:

- SSE;
- WebSocket;
- file chunks;
- long event feed.

Reactive is often best.

Virtual threads can stream blocking responses, but backpressure/cancellation may be less natural depending framework.

## 28.1 Main rule

```text
If the API is fundamentally a stream, reactive deserves strong consideration.
```

---

# 29. Choosing for CPU-Heavy Work

CPU-heavy work:

- report rendering;
- image processing;
- compression;
- large aggregation.

Use:

- bounded CPU executor;
- ForkJoin;
- parallel stream only when simple and measured;
- queue/job model for long work.

Avoid:

- unbounded virtual threads;
- reactive event loop CPU work;
- common pool blocking.

## 29.1 Main rule

```text
CPU-heavy work must be bounded by cores, not by I/O concurrency model.
```

---

# 30. Hybrid Architecture Rules

Hybrid is sometimes necessary.

Rules:

## 30.1 Keep boundaries explicit

Reactive boundary, blocking boundary, CPU boundary.

## 30.2 Do not leak model everywhere

Do not force all layers to know all models.

## 30.3 Convert at edges

Examples:

- WebFlux controller uses reactive client;
- blocking repository isolated at adapter;
- MVC service returns imperative DTO.

## 30.4 Document scheduler/executor ownership

Who owns resources?

## 30.5 Main rule

```text
Hybrid architecture is safe only when boundaries are explicit and observable.
```

---

# 31. Boundary Patterns

## 31.1 Blocking adapter in reactive app

```text
reactive pipeline -> bounded scheduler/virtual-thread bridge -> blocking repository
```

But consider MVC if most app is blocking.

## 31.2 Reactive adapter in blocking app

Blocking code may call reactive client by blocking at boundary, but avoid event loop deadlock and set timeout.

## 31.3 Future adapter

Wrap future API into imperative/virtual-thread or reactive model.

## 31.4 CPU adapter

Offload CPU-heavy step to bounded CPU pool.

## 31.5 Main rule

```text
Model conversion should happen at adapter boundaries, not randomly inside business logic.
```

---

# 32. Migration Strategy

## 32.1 From platform threads to virtual threads

- audit ThreadLocal;
- audit synchronized/pinning risks;
- add DB/HTTP limits;
- load test;
- enable gradually.

## 32.2 From MVC to WebFlux

- migrate clients/drivers;
- remove blocking calls;
- retrain team;
- add reactive observability;
- migrate endpoint by endpoint.

## 32.3 From CompletableFuture to structured concurrency

- identify future fan-out;
- replace with scoped child tasks;
- ensure cancellation/deadline.

## 32.4 Main rule

```text
Migrate concurrency model to solve a measured problem, not as rewrite fashion.
```

---

# 33. Performance Comparison Mental Model

## 33.1 Virtual threads vs reactive

Both can scale I/O waits.

Reactive may use fewer threads.

Virtual threads may use simpler code.

Performance depends on:

- dependency latency;
- resource limits;
- blocking/non-blocking drivers;
- memory;
- backpressure;
- framework overhead;
- team implementation quality.

## 33.2 CompletableFuture

Can be efficient but depends heavily on executor and composition.

## 33.3 ForkJoin

Fast for CPU if workload split well.

## 33.4 Main rule

```text
Benchmark your workload; model-level claims are not enough.
```

---

# 34. Failure Mode Comparison

| Model | Common Failure |
|---|---|
| Platform threads | thread pool exhaustion |
| Virtual threads | DB/API overload, ThreadLocal memory, pinning |
| CompletableFuture | common pool saturation, swallowed errors, cancellation gaps |
| Reactive | event-loop blocking, unbounded flatMap, context loss |
| ForkJoin | blocking in pool, poor granularity, shared state contention |
| Parallel stream | common pool interference, side effects |
| `@Async` | lost context, no durability, unbounded executor |

---

# 35. Testing Strategy by Model

## 35.1 Virtual threads

- many blocking tasks;
- resource permits;
- cancellation;
- ThreadLocal cleanup;
- pinned path load test.

## 35.2 CompletableFuture

- success/error/timeout;
- executor selection;
- cancellation;
- no same-pool deadlock.

## 35.3 Reactive

- StepVerifier;
- backpressure;
- cancellation;
- scheduler boundaries;
- blocking detection.

## 35.4 ForkJoin

- compare sequential;
- threshold benchmarks;
- no shared mutable state.

## 35.5 Main rule

```text
Each concurrency model has different failure modes, so tests must match the model.
```

---

# 36. Observability by Model

## 36.1 Virtual threads

- DB/HTTP waits;
- pinned events;
- virtual thread counts;
- ThreadLocal memory;
- resource bulkheads.

## 36.2 CompletableFuture

- executor queue;
- completion latency;
- exceptional completion;
- cancellation.

## 36.3 Reactive

- demand;
- cancellation;
- scheduler queue;
- event-loop blocked;
- operator latency.

## 36.4 ForkJoin

- steal count;
- active/running;
- queued tasks;
- CPU profile.

## 36.5 Main rule

```text
Observability must be model-aware.
```

---

# 37. Mini Case Study: CRUD Service on Spring MVC

## 37.1 Context

- Spring MVC;
- JDBC;
- REST request/response;
- no streaming;
- moderate complexity.

## 37.2 Choice

Virtual threads are strong candidate.

## 37.3 Required controls

- DB pool;
- connection timeout;
- query timeout;
- HTTP timeout;
- endpoint admission for heavy paths.

## 37.4 Lesson

```text
For blocking CRUD, virtual threads often provide best simplicity/scalability trade-off.
```

---

# 38. Mini Case Study: Streaming Notifications

## 38.1 Context

- clients subscribe to notification stream;
- long-lived connections;
- cancellation on disconnect;
- variable consumer speed.

## 38.2 Choice

Reactive/WebFlux likely fit.

## 38.3 Required controls

- backpressure;
- heartbeat;
- cancellation cleanup;
- event replay policy;
- per-client buffer limit.

## 38.4 Lesson

```text
For long-lived asynchronous streams, reactive model is natural.
```

---

# 39. Mini Case Study: Dashboard Fan-Out

## 39.1 Blocking clients

Use virtual threads + structured concurrency.

## 39.2 Reactive clients

Use `Mono.zip` / `flatMap` with limits.

## 39.3 Future clients

Use CompletableFuture.

## 39.4 Common requirements

- deadline;
- fallback;
- bulkhead per downstream;
- cancellation;
- tracing.

## 39.5 Lesson

```text
Fan-out model should match dependency API type.
```

---

# 40. Mini Case Study: Report Generation

## 40.1 Context

- CPU-heavy;
- large memory;
- long duration.

## 40.2 Choice

Bounded CPU executor/ForkJoin/job queue.

Virtual threads can orchestrate request/job, not run unlimited compute.

Reactive event-loop should not execute CPU-heavy report.

## 40.3 Lesson

```text
CPU-heavy work is a capacity-managed compute problem, not reactive vs virtual thread debate.
```

---

# 41. Common Anti-Patterns

## 41.1 Choosing reactive because it is “advanced”

Wrong basis.

## 41.2 Choosing virtual threads and removing all limits

Resource overload.

## 41.3 CompletableFuture without explicit executor

Common pool surprises.

## 41.4 Reactive pipeline with blocking calls

Event-loop failure.

## 41.5 ForkJoin for blocking HTTP

Wrong pool.

## 41.6 Mixing models inside business logic

Hard to maintain.

## 41.7 Manual subscribe in service

Lifecycle lost.

## 41.8 Parallel stream in request path

Common pool contention.

## 41.9 Ignoring cancellation

Leaks.

## 41.10 Ignoring team operability

Production pain.

---

# 42. Best Practices

## 42.1 Start from workload

I/O, CPU, stream, single result?

## 42.2 Prefer simplest correct model

Do not over-engineer.

## 42.3 Bound scarce resources

Regardless of model.

## 42.4 Make model boundaries explicit

Adapters.

## 42.5 Use virtual threads for blocking I/O

When stack is imperative/blocking.

## 42.6 Use reactive for streams/backpressure

When end-to-end non-blocking.

## 42.7 Use CompletableFuture for finite async composition

With explicit executor.

## 42.8 Use ForkJoin for CPU divide-and-conquer

Measured and bounded.

## 42.9 Test model-specific failure modes

Timeout, cancellation, backpressure.

## 42.10 Observe model-specific signals

Pinned events, demand, queue wait, executor saturation.

---

# 43. Decision Matrix

| Requirement | Best Candidate |
|---|---|
| Blocking CRUD with JDBC | Spring MVC + virtual threads |
| Non-blocking streaming API | WebFlux/Reactor |
| Single async result composition | CompletableFuture or Mono |
| Many async stream items with backpressure | Flux/Reactor |
| CPU divide-and-conquer | ForkJoin |
| CPU-heavy report | bounded CPU executor/job |
| Blocking API fan-out | virtual threads + structured concurrency |
| Reactive client fan-out | Reactor zip/flatMap with concurrency |
| Future-returning SDK | CompletableFuture |
| Strict per-item order | sequential/concatMap/per-key partition |
| Massive long-lived connections | reactive/event-loop |
| Team unfamiliar with reactive and no streaming | virtual threads |
| Need context via ThreadLocal | imperative/virtual threads easier |
| Need signal context across async hops | reactive context |
| Mixed blocking/reactive | explicit adapter boundary |

---

# 44. Latihan

## Latihan 1 — Classify Workload

Klasifikasikan 10 workload: CPU-bound, blocking I/O, non-blocking stream, finite async fan-out.

## Latihan 2 — Choose Model

Untuk tiap workload, pilih virtual threads, reactive, CompletableFuture, ForkJoin, atau platform threads.

## Latihan 3 — Boundary Design

Desain boundary antara WebFlux controller dan blocking legacy repository.

## Latihan 4 — Fan-Out

Bandingkan implementasi dashboard fan-out dengan virtual threads, CompletableFuture, dan Reactor.

## Latihan 5 — Context

Jelaskan perbedaan context propagation di virtual threads, CompletableFuture, dan Reactor.

## Latihan 6 — Backpressure

Desain backpressure untuk virtual-thread pipeline dan reactive Flux.

## Latihan 7 — CPU Work

Refactor CPU-heavy endpoint agar tidak memakai virtual thread unbounded.

## Latihan 8 — Failure Modes

Buat tabel failure mode untuk model pilihanmu di project production.

## Latihan 9 — Migration

Buat rencana migrasi MVC platform threads ke virtual threads.

## Latihan 10 — Architecture Review

Gunakan checklist axis untuk mengevaluasi satu service nyata.

---

# 45. Ringkasan

Pemilihan model concurrency adalah keputusan arsitektur.

Core lessons:

- Tidak ada satu model terbaik untuk semua workload.
- Platform threads sederhana tetapi mahal untuk banyak blocking waits.
- Virtual threads cocok untuk imperative blocking I/O dengan explicit resource limits.
- CompletableFuture cocok untuk finite async single-result composition.
- Reactive cocok untuk asynchronous streams, non-blocking I/O, dan backpressure.
- ForkJoin cocok untuk CPU-bound divide-and-conquer.
- Result shape penting: single result vs stream.
- Dependency type penting: blocking vs non-blocking.
- Backpressure need sering menjadi alasan kuat memilih reactive.
- Streaming API sering natural dengan reactive.
- Fan-out harus punya cancellation, timeout, dan bulkheads.
- Ordering dapat membatasi concurrency.
- Context propagation berbeda antar model.
- Observability dan debugging harus model-aware.
- Team operability adalah faktor teknis, bukan non-teknis.
- Hybrid architecture harus punya explicit boundaries.
- Migration harus menyelesaikan measured problem.
- Benchmark workload nyata sebelum menyimpulkan model lebih cepat.

Main rule:

```text
Choose concurrency model by workload shape, resource bottleneck,
backpressure need, dependency type, cancellation semantics,
team operability, and production observability.
Not by trend.
```

---

# 46. Referensi

1. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

2. OpenJDK JEP 505 — Structured Concurrency  
   https://openjdk.org/jeps/505

3. Reactive Streams Specification  
   https://www.reactive-streams.org/

4. Java SE 25 — `CompletableFuture`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html

5. Java SE 25 — `Flow` API  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Flow.html

6. Project Reactor Reference Guide  
   https://projectreactor.io/docs/core/release/reference/

7. Spring Framework Reference — WebFlux  
   https://docs.spring.io/spring-framework/reference/web/webflux.html

8. Spring Boot Reference — Virtual Threads  
   https://docs.spring.io/spring-boot/reference/features/spring-application.html#features.spring-application.virtual-threads

9. Java SE 25 — `ForkJoinPool`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinPool.html

10. Java Microbenchmark Harness (JMH)  
    https://openjdk.org/projects/code-tools/jmh/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-concurrency-and-reactive-part-032.md">⬅️ Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 032</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-concurrency-and-reactive-part-034.md">Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 034 ➡️</a>
</div>

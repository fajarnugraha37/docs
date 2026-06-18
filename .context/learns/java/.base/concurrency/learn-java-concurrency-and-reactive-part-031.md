# learn-java-concurrency-and-reactive-part-031.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 031  
# Reactive Programming Mental Model: Data Flow, Events, Demand, Backpressure, Non-Blocking I/O, Operators, Schedulers, and the Difference from Virtual Threads

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **031**  
> Fokus: membangun mental model reactive programming sebelum masuk ke Reactive Streams specification dan Project Reactor. Bagian ini membahas push vs pull, event streams, asynchronous data flow, non-blocking I/O, backpressure, demand, publisher/subscriber, operator chain, scheduler, cold/hot streams, composition, error as signal, cancellation, resource cleanup, dan kapan reactive programming lebih cocok dibanding thread-per-request atau virtual threads.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Reactive Programming dalam Satu Kalimat](#2-reactive-programming-dalam-satu-kalimat)
3. [Kenapa Reactive Programming Ada](#3-kenapa-reactive-programming-ada)
4. [Dari Blocking Call ke Data Flow](#4-dari-blocking-call-ke-data-flow)
5. [Push vs Pull](#5-push-vs-pull)
6. [Iterator vs Observable Stream](#6-iterator-vs-observable-stream)
7. [Synchronous vs Asynchronous Flow](#7-synchronous-vs-asynchronous-flow)
8. [Non-Blocking I/O Mental Model](#8-nonblocking-io-mental-model)
9. [Event Loop Mental Model](#9-event-loop-mental-model)
10. [Why Blocking an Event Loop is Bad](#10-why-blocking-an-event-loop-is-bad)
11. [Reactive as Pipeline of Signals](#11-reactive-as-pipeline-of-signals)
12. [The Four Signals](#12-the-four-signals)
13. [Data, Error, Completion, Cancellation](#13-data-error-completion-cancellation)
14. [Backpressure Mental Model](#14-backpressure-mental-model)
15. [Demand](#15-demand)
16. [Publisher and Subscriber](#16-publisher-and-subscriber)
17. [Operator Chain](#17-operator-chain)
18. [Map, Filter, FlatMap Mental Model](#18-map-filter-flatmap-mental-model)
19. [FlatMap and Concurrency](#19-flatmap-and-concurrency)
20. [Ordering in Reactive Pipelines](#20-ordering-in-reactive-pipelines)
21. [Cold vs Hot Streams](#21-cold-vs-hot-streams)
22. [Mono vs Flux Conceptually](#22-mono-vs-flux-conceptually)
23. [Lazy Execution](#23-lazy-execution)
24. [Subscription is Execution](#24-subscription-is-execution)
25. [Schedulers](#25-schedulers)
26. [Threading is an Operator Concern](#26-threading-is-an-operator-concern)
27. [Reactive Context vs ThreadLocal](#27-reactive-context-vs-threadlocal)
28. [Error Handling Mental Model](#28-error-handling-mental-model)
29. [Timeouts, Retries, and Cancellation](#29-timeouts-retries-and-cancellation)
30. [Resource Cleanup](#30-resource-cleanup)
31. [Reactive vs CompletableFuture](#31-reactive-vs-completablefuture)
32. [Reactive vs Virtual Threads](#32-reactive-vs-virtual-threads)
33. [Reactive vs Parallelism](#33-reactive-vs-parallelism)
34. [When Reactive Programming Fits](#34-when-reactive-programming-fits)
35. [When Reactive Programming Does Not Fit](#35-when-reactive-programming-does-not-fit)
36. [Cognitive Cost](#36-cognitive-cost)
37. [Observability and Debugging Reactive Mental Model](#37-observability-and-debugging-reactive-mental-model)
38. [Mini Case Study: Streaming Search Results](#38-mini-case-study-streaming-search-results)
39. [Mini Case Study: Fan-Out API Aggregation](#39-mini-case-study-fanout-api-aggregation)
40. [Mini Case Study: Reactive Pipeline Broken by Blocking JDBC](#40-mini-case-study-reactive-pipeline-broken-by-blocking-jdbc)
41. [Common Anti-Patterns](#41-common-antipatterns)
42. [Best Practices](#42-best-practices)
43. [Decision Matrix](#43-decision-matrix)
44. [Latihan](#44-latihan)
45. [Ringkasan](#45-ringkasan)
46. [Referensi](#46-referensi)

---

# 1. Tujuan Bagian Ini

Reactive programming sering disalahpahami sebagai:

```text
cara baru supaya aplikasi lebih cepat
```

atau:

```text
pengganti semua thread
```

atau:

```text
syntax callback yang rumit
```

Mental model yang lebih benar:

```text
Reactive programming adalah cara menyusun aliran data/event asynchronous
dengan komposisi operator dan backpressure.
```

Dalam Java modern, reactive programming harus dipahami bersama:

- platform threads;
- virtual threads;
- CompletableFuture;
- event loops;
- non-blocking I/O;
- backpressure;
- distributed systems;
- observability;
- production failure modes.

Target bagian ini:

```text
Mampu memahami reactive programming bukan dari hafalan operator,
tetapi dari mental model aliran sinyal, demand, backpressure,
scheduler, dan resource boundary.
```

---

# 2. Reactive Programming dalam Satu Kalimat

Reactive programming:

```text
Program sebagai pipeline asynchronous dari signals,
di mana data, error, completion, dan demand mengalir antar stage.
```

Atau versi praktis:

```text
Daripada thread menunggu hasil,
kita mendeskripsikan apa yang harus terjadi saat data tersedia.
```

Blocking style:

```java
User user = userClient.getUser(id);
List<Order> orders = orderClient.getOrders(id);
return combine(user, orders);
```

Reactive style conceptually:

```java
Mono<User> user = userClient.getUser(id);
Mono<List<Order>> orders = orderClient.getOrders(id);

return Mono.zip(user, orders)
    .map(tuple -> combine(tuple.getT1(), tuple.getT2()));
```

## 2.1 Main rule

```text
Reactive code describes asynchronous flow; subscription executes it.
```

---

# 3. Kenapa Reactive Programming Ada

Reactive programming muncul untuk mengatasi beberapa masalah:

## 3.1 Banyak I/O concurrent

Server harus menangani ribuan koneksi yang sebagian besar menunggu network.

## 3.2 Streaming data

Data tidak selalu satu response penuh.

Bisa berupa:

- events;
- WebSocket messages;
- server-sent events;
- Kafka records;
- file chunks;
- database change stream;
- telemetry stream.

## 3.3 Backpressure

Producer bisa lebih cepat dari consumer.

Reactive Streams menjadikan demand sebagai bagian dari protocol.

## 3.4 Composition

Async workflows bisa dikomposisi tanpa callback nesting.

## 3.5 Main rule

```text
Reactive programming is most valuable when asynchronous streams and backpressure are central.
```

---

# 4. Dari Blocking Call ke Data Flow

Blocking model:

```java
Data data = client.call();
process(data);
```

Meaning:

```text
current thread waits until data is ready
```

Reactive model:

```java
client.call()
    .map(this::process);
```

Meaning:

```text
when data signal arrives, apply process
```

## 4.1 In blocking style

Control flow follows call stack.

## 4.2 In reactive style

Control flow follows signal flow.

## 4.3 Main rule

```text
Reactive programming changes mental model from call stack to signal pipeline.
```

---

# 5. Push vs Pull

## 5.1 Pull

Consumer asks for next data.

Example iterator:

```java
while (iterator.hasNext()) {
    Item item = iterator.next();
}
```

Consumer controls pace.

## 5.2 Push

Producer sends data when available.

Example callback:

```java
onMessage(message)
```

Producer often controls pace.

## 5.3 Reactive Streams

Reactive Streams blends push and pull:

```text
subscriber requests N
publisher pushes up to N
```

## 5.4 Main rule

```text
Reactive backpressure is controlled push: consumer demand limits producer emission.
```

---

# 6. Iterator vs Observable Stream

Iterator:

```text
consumer pulls next
finite/in-memory often
synchronous
```

Reactive stream:

```text
producer emits signals
possibly asynchronous
possibly infinite
can support backpressure
```

## 6.1 Example

Iterator:

```java
for (Item item : items) {
    process(item);
}
```

Reactive:

```java
itemsFlux
    .map(this::process)
    .subscribe();
```

## 6.2 Main rule

```text
Iterator is pull-based synchronous traversal.
Reactive stream is signal-based asynchronous flow.
```

---

# 7. Synchronous vs Asynchronous Flow

## 7.1 Synchronous

Caller waits for callee.

```text
A calls B and waits
```

## 7.2 Asynchronous

Caller registers continuation or pipeline.

```text
A describes what to do when B completes
```

## 7.3 Reactive does not guarantee different thread

A reactive pipeline can run synchronously unless scheduler/asynchronous source is involved.

## 7.4 Main rule

```text
Reactive is about signal composition; threading depends on source and schedulers.
```

---

# 8. Non-Blocking I/O Mental Model

Blocking I/O:

```text
thread waits in read()
```

Non-blocking I/O:

```text
operation registered
event loop notified when socket ready
callback/pipeline resumes
```

## 8.1 Why useful

Few event-loop threads can manage many connections.

## 8.2 Requirement

Do not block event-loop.

## 8.3 Main rule

```text
Non-blocking I/O scales waiting by not dedicating one thread per wait.
```

---

# 9. Event Loop Mental Model

Event loop:

```text
while running:
    get ready event
    run small handler
```

Important:

- handlers must be short;
- no blocking;
- no long CPU work;
- offload blocking/CPU work;
- event loop threads are scarce.

## 9.1 Example

```text
Netty event loop handles many channels
```

## 9.2 Main rule

```text
Event loop performance depends on handlers returning quickly.
```

---

# 10. Why Blocking an Event Loop is Bad

If event loop thread blocks:

```text
it cannot process other connections/events
```

One blocking call can delay many clients.

Bad:

```java
reactiveHandler()
    .map(x -> blockingJdbcCall(x));
```

if it runs on event-loop thread.

## 10.1 Symptoms

- p99 spike;
- low throughput;
- event-loop blocked warnings;
- many connections waiting;
- CPU not necessarily high.

## 10.2 Main rule

```text
Blocking an event loop is like blocking a whole lane of traffic, not one request.
```

---

# 11. Reactive as Pipeline of Signals

A reactive pipeline is not just values.

It is a sequence of signals.

Conceptual:

```text
onSubscribe
request(n)
onNext(value)
onNext(value)
onError(error)
or
onComplete()
cancel()
```

## 11.1 Signals are protocol

Each signal has meaning.

## 11.2 Main rule

```text
Reactive streams are protocols of signals, not just async lists.
```

---

# 12. The Four Signals

Key signal categories:

## 12.1 Data

```text
onNext(value)
```

## 12.2 Error

```text
onError(error)
```

Terminal.

## 12.3 Completion

```text
onComplete()
```

Terminal.

## 12.4 Cancellation

```text
cancel()
```

Subscriber no longer wants data.

## 12.5 Main rule

```text
In reactive programming, error, completion, and cancellation are first-class flow events.
```

---

# 13. Data, Error, Completion, Cancellation

Blocking code:

```java
try {
    Data data = call();
    return process(data);
} catch (Exception e) {
    handle(e);
}
```

Reactive code:

```java
source
    .map(this::process)
    .onErrorResume(this::fallback)
```

## 13.1 Terminal signals

After `onError` or `onComplete`, no more `onNext`.

## 13.2 Cancellation

Can happen because:

- client disconnected;
- timeout;
- downstream no longer needs result;
- operator cancels losing branch.

## 13.3 Main rule

```text
A reactive pipeline must define success, error, completion, and cancellation behavior.
```

---

# 14. Backpressure Mental Model

Backpressure:

```text
consumer tells producer how much it can handle
```

Without backpressure:

```text
producer floods consumer
buffer grows
memory grows
latency grows
failure
```

With backpressure:

```text
subscriber requests 10
publisher emits at most 10
subscriber requests more when ready
```

## 14.1 Main rule

```text
Backpressure is flow control for asynchronous streams.
```

---

# 15. Demand

Demand is requested amount.

Example:

```text
request(5)
```

Means:

```text
subscriber is ready for up to 5 items
```

Publisher must not emit more than requested.

## 15.1 Demand can accumulate

If subscriber requests 5 then 10:

```text
demand = 15
```

## 15.2 Main rule

```text
Demand is the currency of backpressure.
```

---

# 16. Publisher and Subscriber

## 16.1 Publisher

Produces signals.

## 16.2 Subscriber

Consumes signals and controls demand.

## 16.3 Subscription

Relationship between publisher and subscriber.

Subscriber can:

- request;
- cancel.

## 16.4 Main rule

```text
Publisher emits; Subscriber requests; Subscription connects and controls flow.
```

---

# 17. Operator Chain

Operators transform streams.

Example:

```java
source
    .filter(this::valid)
    .map(this::normalize)
    .flatMap(this::loadDetails)
    .timeout(Duration.ofSeconds(2))
    .onErrorResume(this::fallback)
```

Each operator creates a new publisher-like stage.

## 17.1 Operators are not immediately executed

They build pipeline.

## 17.2 Main rule

```text
Operators describe transformations; subscription activates them.
```

---

# 18. Map, Filter, FlatMap Mental Model

## 18.1 map

One input -> one output.

```text
A -> B
```

## 18.2 filter

One input -> zero or one output.

```text
A -> A or nothing
```

## 18.3 flatMap

One input -> asynchronous inner stream.

```text
A -> Publisher<B>
```

Then flatten outputs.

## 18.4 Main rule

```text
flatMap introduces asynchronous composition and often concurrency.
```

---

# 19. FlatMap and Concurrency

`flatMap` can subscribe to multiple inner publishers concurrently.

Conceptually:

```text
input 1 -> call A
input 2 -> call B
input 3 -> call C
results arrive in completion order
```

## 19.1 Concurrency limit

Many reactive libraries allow limiting flatMap concurrency.

Important to avoid:

- downstream overload;
- memory growth;
- connection pool exhaustion.

## 19.2 Main rule

```text
flatMap without concurrency control can become unbounded fan-out.
```

---

# 20. Ordering in Reactive Pipelines

Reactive pipelines may reorder when concurrent operations are used.

## 20.1 map preserves order

If synchronous sequential.

## 20.2 flatMap may reorder

Because inner async tasks complete at different times.

## 20.3 concatMap

Usually preserves order by processing one inner publisher at a time.

## 20.4 flatMapSequential

May run concurrently but emit in original order depending library.

## 20.5 Main rule

```text
Concurrency and ordering are trade-offs in reactive pipelines.
```

---

# 21. Cold vs Hot Streams

## 21.1 Cold stream

Starts producing per subscriber.

Example:

```text
HTTP call per subscription
database query per subscription
```

## 21.2 Hot stream

Produces independently of subscriber.

Example:

```text
live event bus
WebSocket feed
Kafka topic conceptual stream
```

## 21.3 Main rule

```text
Cold streams are per-subscription computations; hot streams are shared/live sources.
```

---

# 22. Mono vs Flux Conceptually

In Reactor terminology:

## 22.1 Mono

0 or 1 item.

```text
async single result
```

Examples:

- HTTP response;
- database row;
- command result.

## 22.2 Flux

0 to N items.

```text
async stream
```

Examples:

- event stream;
- file chunks;
- many rows;
- SSE.

## 22.3 Main rule

```text
Mono models single asynchronous result; Flux models asynchronous sequence.
```

---

# 23. Lazy Execution

Reactive pipelines are usually lazy.

This:

```java
Mono<User> user = userClient.load(id)
    .map(this::normalize);
```

does not necessarily call service yet.

It describes computation.

## 23.1 Main rule

```text
Building a reactive pipeline is not executing it.
```

---

# 24. Subscription is Execution

The pipeline executes when subscribed.

```java
pipeline.subscribe();
```

In web frameworks, framework subscribes for you.

## 24.1 Multiple subscriptions

Cold source may execute multiple times.

```java
Mono<User> mono = userClient.load(id);

mono.subscribe();
mono.subscribe(); // may call twice
```

## 24.2 Main rule

```text
Every subscription to a cold pipeline can mean new work.
```

---

# 25. Schedulers

Schedulers determine where work runs.

Conceptually:

- event loop scheduler;
- parallel scheduler;
- bounded elastic scheduler;
- virtual-thread-backed scheduler if supported by library/config;
- immediate/current thread.

## 25.1 Scheduler is not magic

Moving blocking work to a scheduler may avoid event-loop blocking, but resource limits still matter.

## 25.2 Main rule

```text
Scheduler choice is execution capacity design.
```

---

# 26. Threading is an Operator Concern

In reactive pipelines, thread may change due to operators like:

- subscribeOn;
- publishOn;
- asynchronous source;
- flatMap inner publisher;
- scheduler boundaries.

## 26.1 Call stack mental model breaks

A downstream operator may run on different thread than upstream.

## 26.2 Main rule

```text
In reactive code, do not infer thread from lexical code order.
```

---

# 27. Reactive Context vs ThreadLocal

ThreadLocal assumes stable thread.

Reactive pipelines may hop threads.

Therefore ThreadLocal context can disappear or be wrong.

Reactive libraries often provide context propagation mechanism.

## 27.1 Context should carry

- correlation ID;
- tenant ID;
- security snapshot;
- deadline.

## 27.2 Do not carry

- mutable request object;
- transaction connection;
- large data;
- ORM session.

## 27.3 Main rule

```text
Reactive context must flow with signals, not with threads.
```

---

# 28. Error Handling Mental Model

Errors are terminal signals.

Common strategies:

- fallback;
- retry;
- map exception;
- resume with empty;
- propagate.

## 28.1 Beware swallowing errors

Returning empty can hide failures.

## 28.2 Main rule

```text
Reactive error handling is part of the pipeline contract, not an afterthought.
```

---

# 29. Timeouts, Retries, and Cancellation

Reactive pipelines should define:

## 29.1 Timeout

Stop waiting after duration/deadline.

## 29.2 Retry

Retry only with:

- budget;
- backoff;
- jitter;
- idempotency;
- max attempts.

## 29.3 Cancellation

Cancel upstream when downstream no longer needs result.

## 29.4 Main rule

```text
Reactive timeout and retry must be designed with cancellation and idempotency.
```

---

# 30. Resource Cleanup

Resources in reactive pipeline:

- connection;
- file;
- buffer;
- subscription;
- transaction;
- temporary object.

Cleanup must happen on:

- complete;
- error;
- cancel.

## 30.1 Important

Cancellation is often forgotten.

## 30.2 Main rule

```text
Reactive resource cleanup must handle all terminal paths, including cancellation.
```

---

# 31. Reactive vs CompletableFuture

## 31.1 CompletableFuture

Best for one asynchronous result.

```text
0/1 value
```

No built-in backpressure for streams.

## 31.2 Reactive

Best for 0..N asynchronous signals with backpressure.

## 31.3 Main rule

```text
CompletableFuture is about async single result; reactive streams are about async sequences and demand.
```

---

# 32. Reactive vs Virtual Threads

## 32.1 Virtual threads

Imperative blocking code with cheap waiting.

Good for:

- request/response;
- JDBC;
- simple blocking workflows;
- easier migration.

## 32.2 Reactive

Non-blocking data flow with backpressure.

Good for:

- streaming;
- event pipelines;
- high connection count;
- reactive end-to-end;
- non-blocking drivers.

## 32.3 Main rule

```text
Virtual threads simplify blocking code.
Reactive programming models asynchronous streams and backpressure.
```

---

# 33. Reactive vs Parallelism

Reactive does not automatically mean CPU parallelism.

Reactive can orchestrate asynchronous I/O.

CPU-bound work still needs bounded parallel scheduler/executor.

## 33.1 Main rule

```text
Reactive is not a replacement for CPU parallelism.
```

---

# 34. When Reactive Programming Fits

Reactive fits when:

- data is stream-like;
- backpressure matters;
- non-blocking I/O stack is available;
- many long-lived connections;
- event-driven pipelines;
- streaming response;
- reactive database/client;
- composition of asynchronous sources is central.

## 34.1 Main rule

```text
Use reactive when flow control and asynchronous streams are core to the problem.
```

---

# 35. When Reactive Programming Does Not Fit

Reactive may not fit when:

- team is not ready for complexity;
- app is mostly CRUD with blocking JDBC;
- virtual threads solve thread scalability sufficiently;
- no streaming/backpressure need;
- codebase relies heavily on ThreadLocal transaction/session semantics;
- libraries are blocking only.

## 35.1 Main rule

```text
Do not choose reactive only because it sounds more advanced.
```

---

# 36. Cognitive Cost

Reactive code has cost:

- harder stack traces;
- operator semantics;
- debugging async flow;
- context propagation;
- scheduler understanding;
- backpressure semantics;
- different testing style.

## 36.1 Worth it when

Benefits exceed complexity.

## 36.2 Main rule

```text
Reactive programming is powerful, but its cognitive cost must be justified by workload needs.
```

---

# 37. Observability and Debugging Reactive Mental Model

Need observe:

- subscription;
- demand/request;
- emission rate;
- operator latency;
- scheduler queue;
- event-loop blocked time;
- error signals;
- cancellation;
- retries;
- dropped signals;
- context propagation.

## 37.1 Main rule

```text
Reactive observability must reveal signal flow, not only thread state.
```

---

# 38. Mini Case Study: Streaming Search Results

## 38.1 Requirement

Client wants results as they become available.

## 38.2 Blocking model

Wait for all results, return list.

## 38.3 Reactive model

Emit results gradually.

Benefits:

- lower time-to-first-item;
- backpressure;
- cancellation when client disconnects;
- streaming response.

## 38.4 Lesson

```text
Reactive shines when result is a stream, not a single value.
```

---

# 39. Mini Case Study: Fan-Out API Aggregation

## 39.1 Requirement

Call 20 services and combine.

Reactive can express:

- concurrency;
- timeout;
- fallback;
- cancellation;
- error handling.

## 39.2 Danger

Unbounded `flatMap` can overload services.

## 39.3 Lesson

```text
Reactive fan-out still needs concurrency limits and downstream bulkheads.
```

---

# 40. Mini Case Study: Reactive Pipeline Broken by Blocking JDBC

## 40.1 Problem

Reactive WebFlux endpoint calls blocking JDBC directly.

Symptoms:

- event loop blocked;
- p99 spikes;
- throughput drops.

## 40.2 Fix options

- use reactive DB driver;
- isolate blocking JDBC on bounded scheduler/virtual-thread bridge;
- use MVC + virtual threads if stack is blocking.

## 40.3 Lesson

```text
Reactive stack must be non-blocking end-to-end or isolate blocking boundaries explicitly.
```

---

# 41. Common Anti-Patterns

## 41.1 Reactive for everything

Unnecessary complexity.

## 41.2 Blocking on event loop

Severe performance bug.

## 41.3 Calling `block()` inside reactive pipeline

Breaks non-blocking flow.

## 41.4 Unbounded flatMap

Downstream overload.

## 41.5 Ignoring cancellation

Resource leak.

## 41.6 Losing context

ThreadLocal assumptions fail.

## 41.7 Retrying non-idempotent operation

Duplicate side effects.

## 41.8 Swallowing errors with empty fallback

Silent data loss.

## 41.9 Assuming reactive means parallel

Wrong mental model.

## 41.10 Multiple subscriptions to cold source accidentally

Duplicate work.

---

# 42. Best Practices

## 42.1 Start from workload

Streaming/backpressure/non-blocking needs?

## 42.2 Keep event loops non-blocking

Offload or avoid blocking operations.

## 42.3 Bound concurrency

Especially `flatMap`.

## 42.4 Make cancellation safe

Cleanup resources.

## 42.5 Use reactive context

Do not rely on ThreadLocal.

## 42.6 Design error handling explicitly

Fallback vs fail.

## 42.7 Use deadlines

Timeouts and retries budgeted.

## 42.8 Avoid duplicate subscription surprises

Cache/share intentionally if needed.

## 42.9 Test with backpressure

Not only happy path.

## 42.10 Compare with virtual threads

Choose simpler model if it satisfies requirements.

---

# 43. Decision Matrix

| Situation | Better Fit |
|---|---|
| Simple CRUD with JDBC | MVC + virtual threads |
| Streaming response | Reactive |
| Server-Sent Events/WebSocket | Reactive often |
| Blocking-only libraries | Virtual threads or isolated scheduler |
| Reactive DB/client stack | Reactive |
| Need backpressure across stream | Reactive |
| One async result | CompletableFuture or Mono |
| CPU-heavy processing | Bounded CPU pool/ForkJoin |
| Many independent blocking calls | Virtual threads + bulkhead |
| Event-loop framework | Reactive/non-blocking discipline |
| Team unfamiliar, no streaming need | Avoid reactive complexity |
| Need per-request imperative readability | Virtual threads |

---

# 44. Latihan

## Latihan 1 — Blocking vs Reactive Flow

Ambil blocking method 3-step dan gambarkan sebagai signal pipeline.

## Latihan 2 — Push/Pull

Jelaskan perbedaan iterator, callback, dan reactive backpressure.

## Latihan 3 — Demand

Simulasikan subscriber request(5), publisher emit 3, subscriber request(2).

## Latihan 4 — flatMap Concurrency

Desain fan-out 100 calls dengan max concurrency 10.

## Latihan 5 — Ordering

Jelaskan kapan menggunakan flatMap, concatMap, atau flatMapSequential.

## Latihan 6 — Cold Stream

Jelaskan kenapa dua subscription bisa menyebabkan dua HTTP calls.

## Latihan 7 — Event Loop Blocking

Buat checklist untuk menemukan blocking call di WebFlux endpoint.

## Latihan 8 — Context

Desain reactive context berisi tenant/correlation/deadline.

## Latihan 9 — Error Handling

Buat policy fallback vs retry vs fail untuk 3 downstream.

## Latihan 10 — Choose Model

Untuk 5 use case, pilih MVC+virtual threads, WebFlux/reactive, CompletableFuture, atau ForkJoin.

---

# 45. Ringkasan

Reactive programming adalah mental model aliran sinyal asynchronous dengan backpressure.

Core lessons:

- Reactive programming bukan magic performance switch.
- Reactive code mendeskripsikan data/event flow.
- Blocking style mengikuti call stack; reactive style mengikuti signal pipeline.
- Reactive Streams menggabungkan push dan pull melalui demand.
- Non-blocking I/O memungkinkan sedikit event-loop threads mengelola banyak koneksi.
- Event loop tidak boleh block.
- Reactive streams membawa signals: data, error, completion, cancellation.
- Backpressure adalah flow control.
- Demand adalah mata uang backpressure.
- Operators membangun pipeline; subscription mengeksekusi.
- `flatMap` memperkenalkan async composition dan concurrency.
- Concurrency dan ordering adalah trade-off.
- Cold stream bisa menjalankan work ulang per subscription.
- Mono = 0/1 result, Flux = 0..N sequence.
- Scheduler menentukan execution boundary.
- ThreadLocal tidak cocok sebagai context utama di reactive flow.
- Error handling dan cancellation harus dirancang eksplisit.
- Resource cleanup harus menangani complete, error, dan cancel.
- CompletableFuture cocok untuk single async result; reactive cocok untuk async sequences dengan demand.
- Virtual threads cocok untuk imperative blocking; reactive cocok untuk non-blocking streams/backpressure.
- Reactive bukan CPU parallelism.
- Reactive punya cognitive cost dan harus dipilih berdasarkan workload.

Main rule:

```text
Use reactive programming when your problem is naturally an asynchronous stream
with flow control, cancellation, and non-blocking composition.
Use virtual threads when your problem is mostly blocking request/response
and imperative code is simpler.
```

---

# 46. Referensi

1. Reactive Streams Specification  
   https://www.reactive-streams.org/

2. Project Reactor Reference Guide  
   https://projectreactor.io/docs/core/release/reference/

3. Spring Framework Reference — WebFlux  
   https://docs.spring.io/spring-framework/reference/web/webflux.html

4. Java SE 25 — `Flow` API  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Flow.html

5. Java SE 25 — `CompletableFuture`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html

6. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

7. Spring Framework Reference — Reactive Core  
   https://docs.spring.io/spring-framework/reference/core/spring-core.html

8. Netty Project  
   https://netty.io/

9. RSocket — Reactive Streams Network Protocol  
   https://rsocket.io/

10. Spring Blog/Docs — Reactive Programming and WebFlux Concepts  
    https://spring.io/reactive

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 030](./learn-java-concurrency-and-reactive-part-030.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 032](./learn-java-concurrency-and-reactive-part-032.md)

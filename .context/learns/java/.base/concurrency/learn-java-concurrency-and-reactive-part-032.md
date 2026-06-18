# learn-java-concurrency-and-reactive-part-032.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 032  
# Reactive Streams Specification and Project Reactor Overview: Publisher, Subscriber, Subscription, Demand, Mono, Flux, Operators, Schedulers, Backpressure, and Production Semantics

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **032**  
> Fokus: memahami kontrak formal **Reactive Streams** dan gambaran menyeluruh **Project Reactor**. Bagian ini membahas `Publisher`, `Subscriber`, `Subscription`, `Processor`, demand, backpressure, signal protocol, rule mental model, Java `Flow`, Project Reactor `Mono` dan `Flux`, operator transformation, `flatMap`, `concatMap`, `zip`, `merge`, scheduler, context, error handling, retry, timeout, cancellation, testing, debugging, dan production pitfalls.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Reactive Streams: Masalah yang Diselesaikan](#2-reactive-streams-masalah-yang-diselesaikan)
3. [Reactive Streams dalam Satu Kalimat](#3-reactive-streams-dalam-satu-kalimat)
4. [Empat Interface Utama](#4-empat-interface-utama)
5. [`Publisher<T>`](#5-publishert)
6. [`Subscriber<T>`](#6-subscribert)
7. [`Subscription`](#7-subscription)
8. [`Processor<T, R>`](#8-processort-r)
9. [Signal Protocol](#9-signal-protocol)
10. [Demand dan `request(n)`](#10-demand-dan-requestn)
11. [Backpressure Contract](#11-backpressure-contract)
12. [Terminal Signals](#12-terminal-signals)
13. [Cancellation](#13-cancellation)
14. [Serial Signal Rule](#14-serial-signal-rule)
15. [Non-Blocking Backpressure](#15-nonblocking-backpressure)
16. [Java `Flow` API](#16-java-flow-api)
17. [Project Reactor Overview](#17-project-reactor-overview)
18. [`Mono<T>`](#18-monot)
19. [`Flux<T>`](#19-fluxt)
20. [Cold Publishers](#20-cold-publishers)
21. [Hot Publishers](#21-hot-publishers)
22. [Creating Mono and Flux](#22-creating-mono-and-flux)
23. [Transforming Data: `map`, `filter`, `handle`](#23-transforming-data-map-filter-handle)
24. [Async Composition: `flatMap`](#24-async-composition-flatmap)
25. [Ordering: `concatMap`, `flatMapSequential`](#25-ordering-concatmap-flatmapsequential)
26. [Combining: `zip`, `merge`, `concat`, `firstWithSignal`](#26-combining-zip-merge-concat-firstwithsignal)
27. [Error Handling Operators](#27-error-handling-operators)
28. [Timeout, Retry, and Backoff](#28-timeout-retry-and-backoff)
29. [Schedulers](#29-schedulers)
30. [`subscribeOn` vs `publishOn`](#30-subscribeon-vs-publishon)
31. [Context](#31-context)
32. [Resource Management](#32-resource-management)
33. [Blocking Boundaries](#33-blocking-boundaries)
34. [Testing with StepVerifier](#34-testing-with-stepverifier)
35. [Debugging Reactor Pipelines](#35-debugging-reactor-pipelines)
36. [Observability](#36-observability)
37. [Mini Case Study: HTTP Fan-Out with Backpressure](#37-mini-case-study-http-fanout-with-backpressure)
38. [Mini Case Study: Reactive Stream with Blocking Repository](#38-mini-case-study-reactive-stream-with-blocking-repository)
39. [Mini Case Study: Duplicate Subscription](#39-mini-case-study-duplicate-subscription)
40. [Common Anti-Patterns](#40-common-antipatterns)
41. [Best Practices](#41-best-practices)
42. [Decision Matrix](#42-decision-matrix)
43. [Latihan](#43-latihan)
44. [Ringkasan](#44-ringkasan)
45. [Referensi](#45-referensi)

---

# 1. Tujuan Bagian Ini

Bagian sebelumnya membangun mental model reactive:

```text
reactive = asynchronous signal flow + demand + backpressure
```

Sekarang kita masuk ke kontrak formal:

```text
Reactive Streams Specification
```

dan implementasi populer di ekosistem Spring:

```text
Project Reactor
```

Target bagian ini:

```text
Mampu memahami Reactive Streams sebagai protocol,
bukan sekadar API operator.
Mampu membaca Mono/Flux sebagai Publisher dengan semantics:
subscription, demand, onNext, onError, onComplete, cancel.
Mampu menghindari kesalahan production seperti unbounded flatMap,
blocking event loop, duplicate subscription, lost context,
dan retry tanpa idempotency.
```

---

# 2. Reactive Streams: Masalah yang Diselesaikan

Masalah utama:

```text
Bagaimana memproses stream asynchronous tanpa membuat producer membanjiri consumer?
```

Tanpa backpressure:

```text
producer emits 1,000,000 items/sec
consumer handles 10,000 items/sec
buffer grows
memory grows
latency grows
failure
```

Reactive Streams memberi standard contract:

```text
subscriber requests N
publisher emits at most N
```

## 2.1 Interoperability

Specification memungkinkan library berbeda saling bekerja:

- Reactor;
- Akka Streams;
- RxJava adapters;
- Java Flow adapters;
- database/client reactive drivers.

## 2.2 Main rule

```text
Reactive Streams standardizes asynchronous stream processing with non-blocking backpressure.
```

---

# 3. Reactive Streams dalam Satu Kalimat

Reactive Streams adalah spesifikasi untuk:

```text
asynchronous stream processing with non-blocking backpressure
```

Konsep inti:

```text
Publisher emits signals only according to Subscriber demand.
```

## 3.1 Main rule

```text
No demand, no data.
```

---

# 4. Empat Interface Utama

Reactive Streams punya empat interface utama:

```java
Publisher<T>
Subscriber<T>
Subscription
Processor<T, R>
```

## 4.1 Relationship

```text
Subscriber subscribes to Publisher.
Publisher calls onSubscribe with Subscription.
Subscriber requests data via Subscription.
Publisher emits onNext up to requested amount.
Publisher eventually emits onComplete or onError.
Subscriber may cancel.
```

## 4.2 Diagram

```text
Subscriber --subscribe--> Publisher
Subscriber <--onSubscribe-- Publisher
Subscriber --request(n)--> Subscription/Publisher
Subscriber <--onNext(item)-- Publisher
Subscriber <--onComplete/onError-- Publisher
Subscriber --cancel()--> Subscription/Publisher
```

## 4.3 Main rule

```text
Reactive Streams is a protocol between producer and consumer.
```

---

# 5. `Publisher<T>`

Conceptual interface:

```java
public interface Publisher<T> {
    void subscribe(Subscriber<? super T> subscriber);
}
```

Publisher produces data signals.

Important:

- `subscribe` does not mean emit unbounded data;
- publisher must respect demand;
- publisher can be cold or hot depending implementation;
- publisher can be finite or infinite.

## 5.1 Main rule

```text
Publisher is a source of signals, not necessarily a source of immediate values.
```

---

# 6. `Subscriber<T>`

Conceptual interface:

```java
public interface Subscriber<T> {
    void onSubscribe(Subscription subscription);
    void onNext(T item);
    void onError(Throwable throwable);
    void onComplete();
}
```

Subscriber receives signals.

## 6.1 Responsibilities

- store subscription if needed;
- request demand;
- process `onNext`;
- handle terminal signals;
- avoid blocking if on event loop;
- cancel if no longer needed.

## 6.2 Main rule

```text
Subscriber controls demand and consumes signals.
```

---

# 7. `Subscription`

Conceptual interface:

```java
public interface Subscription {
    void request(long n);
    void cancel();
}
```

Subscription represents relationship between Publisher and Subscriber.

## 7.1 request

Ask for more items.

## 7.2 cancel

Stop receiving.

## 7.3 Main rule

```text
Subscription is the control channel: demand and cancellation.
```

---

# 8. `Processor<T, R>`

Processor is both Subscriber and Publisher:

```java
public interface Processor<T, R>
        extends Subscriber<T>, Publisher<R> {
}
```

It consumes upstream and publishes downstream.

Operator stages are conceptually processor-like.

## 8.1 Use caution

Most application code should use library operators rather than implement Processor manually.

## 8.2 Main rule

```text
Processor transforms upstream signals into downstream signals.
```

---

# 9. Signal Protocol

Normal signal flow:

```text
onSubscribe
request(n)
onNext
onNext
...
onComplete
```

or:

```text
onSubscribe
request(n)
onNext
onError
```

or:

```text
onSubscribe
request(n)
cancel
```

## 9.1 Terminal

After terminal signal:

```text
no more onNext
no more onError
no more onComplete
```

## 9.2 Main rule

```text
Reactive stream lifecycle is defined by signal order.
```

---

# 10. Demand dan `request(n)`

Demand is the number of elements requested.

```java
subscription.request(10);
```

means subscriber is ready for up to 10 elements.

Publisher can emit:

```text
0..10 items
```

not more.

## 10.1 Illegal demand

`request(0)` or negative is invalid by spec and should be handled as error.

## 10.2 Unbounded demand

Some subscribers request `Long.MAX_VALUE`.

This effectively disables fine-grained backpressure for that subscriber.

## 10.3 Main rule

```text
request(n) is a capacity promise from subscriber to publisher.
```

---

# 11. Backpressure Contract

Publisher must not emit more `onNext` than requested.

This prevents flooding.

## 11.1 Backpressure is cooperative

Both sides must follow protocol.

## 11.2 Operators affect demand

Operators may transform demand.

Example:

- buffering operator may request more upstream;
- mapping may request one-to-one;
- flatMap may request across inner publishers.

## 11.3 Main rule

```text
Backpressure is a protocol contract, not just a queue.
```

---

# 12. Terminal Signals

Terminal signals:

```text
onComplete
onError
```

After terminal:

```text
stream is done
```

## 12.1 Error terminal

`onError` means failure.

## 12.2 Complete terminal

`onComplete` means normal completion.

## 12.3 Main rule

```text
A Publisher terminates exactly once: complete or error.
```

---

# 13. Cancellation

Subscriber can call:

```java
subscription.cancel();
```

Meaning:

```text
I no longer want signals.
```

Cancellation can happen because:

- client disconnected;
- timeout;
- operator no longer needs source;
- another branch won a race;
- caller explicitly cancelled.

## 13.1 Cleanup

Publisher/operator should release resources.

## 13.2 Main rule

```text
Cancellation is a first-class lifecycle path and must clean up resources.
```

---

# 14. Serial Signal Rule

Signals to a Subscriber must be serial, not concurrently invoked.

Why?

Subscriber logic is not required to be thread-safe for concurrent `onNext`.

## 14.1 Important

A publisher/operator with concurrent sources must serialize downstream signals.

## 14.2 Main rule

```text
Reactive Streams provides asynchronous flow, not concurrent calls into one Subscriber.
```

---

# 15. Non-Blocking Backpressure

Backpressure should be non-blocking.

Bad mental model:

```text
Publisher blocks until subscriber ready
```

Spec goal:

```text
Subscriber signals demand asynchronously;
Publisher emits when demand exists.
```

## 15.1 Main rule

```text
Reactive Streams backpressure is demand signaling, not blocking producer threads.
```

---

# 16. Java `Flow` API

Java 9 introduced `java.util.concurrent.Flow`.

It mirrors Reactive Streams concepts:

- `Flow.Publisher`;
- `Flow.Subscriber`;
- `Flow.Subscription`;
- `Flow.Processor`.

## 16.1 Why it matters

Standard JDK API for flow-controlled async streams.

## 16.2 Main rule

```text
Java Flow is the JDK-level shape of Reactive Streams concepts.
```

---

# 17. Project Reactor Overview

Project Reactor is a reactive library used by Spring WebFlux.

Core types:

```text
Mono<T> = 0..1 item
Flux<T> = 0..N items
```

Both are Publishers.

Reactor provides operators for:

- transformation;
- filtering;
- async composition;
- error handling;
- retry;
- timeout;
- scheduling;
- context;
- testing.

## 17.1 Main rule

```text
Reactor is a Reactive Streams implementation plus rich operator ecosystem.
```

---

# 18. `Mono<T>`

`Mono<T>` represents 0 or 1 item.

Examples:

- one HTTP response;
- one DB row;
- one command result;
- empty result;
- error.

## 18.1 Possible outcomes

```text
onNext(value), onComplete
onComplete
onError(error)
cancel
```

## 18.2 Example

```java
Mono<User> user = userClient.findUser(id);
```

## 18.3 Main rule

```text
Mono is an asynchronous optional single result with signal semantics.
```

---

# 19. `Flux<T>`

`Flux<T>` represents 0 to N items.

Examples:

- many rows;
- event stream;
- file chunks;
- SSE;
- Kafka records.

## 19.1 Possible outcomes

```text
many onNext values, then onComplete
many onNext values, then onError
infinite onNext until cancelled
```

## 19.2 Example

```java
Flux<Event> events = eventClient.streamEvents();
```

## 19.3 Main rule

```text
Flux is an asynchronous sequence with backpressure semantics.
```

---

# 20. Cold Publishers

Cold publisher starts work per subscriber.

Example:

```java
Mono<User> user = Mono.fromCallable(() -> repository.find(id));
```

Each subscription can call repository again.

## 20.1 Risk

Duplicate subscription = duplicate work.

## 20.2 Main rule

```text
Cold publishers are repeatable recipes; each subscription may cook again.
```

---

# 21. Hot Publishers

Hot publisher emits independent of subscriber.

Examples:

- live event stream;
- subject/sink;
- shared source;
- market data feed.

## 21.1 Risk

Subscriber may miss earlier items.

## 21.2 Main rule

```text
Hot publishers represent live sources; subscription observes from now onward.
```

---

# 22. Creating Mono and Flux

Common conceptual creation:

```java
Mono.just(value)
Mono.empty()
Mono.error(error)
Mono.fromCallable(callable)
Mono.defer(() -> createMono())

Flux.just(a, b, c)
Flux.fromIterable(items)
Flux.range(0, 10)
Flux.error(error)
Flux.defer(() -> createFlux())
```

## 22.1 `just` vs `defer`

`just` captures value now.

`defer` creates source per subscription.

## 22.2 Main rule

```text
Use defer when creation must happen at subscription time.
```

---

# 23. Transforming Data: `map`, `filter`, `handle`

## 23.1 map

One input to one output.

```java
mono.map(this::toDto)
```

## 23.2 filter

Keep or drop.

```java
flux.filter(this::valid)
```

## 23.3 handle

Can emit zero or one output imperatively per input.

```java
flux.handle((item, sink) -> {
    if (valid(item)) {
        sink.next(transform(item));
    }
});
```

## 23.4 Main rule

```text
Use simple synchronous operators for simple synchronous transformations.
```

---

# 24. Async Composition: `flatMap`

`flatMap` maps each item to a Publisher and merges results.

```java
Flux<Order> orders = userIds
    .flatMap(userId -> orderClient.findOrders(userId));
```

## 24.1 Concurrency

`flatMap` can run inner publishers concurrently.

## 24.2 Limit concurrency

Use concurrency parameter when available:

```java
flux.flatMap(this::callDownstream, 10)
```

## 24.3 Main rule

```text
flatMap is async fan-out; always think about concurrency limit.
```

---

# 25. Ordering: `concatMap`, `flatMapSequential`

## 25.1 `concatMap`

Processes inner publishers one at a time in order.

Good for strict ordering.

## 25.2 `flatMapSequential`

Can run concurrently but emit in source order.

May buffer.

## 25.3 Trade-off

- `flatMap`: more concurrency, less ordering.
- `concatMap`: strict ordering, less concurrency.
- `flatMapSequential`: concurrency + ordered emission, with buffering.

## 25.4 Main rule

```text
Choose operator based on ordering and concurrency semantics.
```

---

# 26. Combining: `zip`, `merge`, `concat`, `firstWithSignal`

## 26.1 zip

Wait for multiple sources and combine aligned values.

```java
Mono.zip(userMono, ordersMono)
```

## 26.2 merge

Interleave emissions as they arrive.

## 26.3 concat

Subscribe sequentially.

## 26.4 firstWithSignal

Use first source to signal.

## 26.5 Main rule

```text
Combination operators encode concurrency, ordering, and failure semantics.
```

---

# 27. Error Handling Operators

Common patterns:

## 27.1 fallback

```java
onErrorResume(error -> fallback())
```

## 27.2 map error

```java
onErrorMap(error -> new DomainException(error))
```

## 27.3 return default

```java
onErrorReturn(defaultValue)
```

## 27.4 side-effect log

```java
doOnError(error -> log.warn("failed", error))
```

## 27.5 Main rule

```text
Error handling operator changes business semantics. Use intentionally.
```

---

# 28. Timeout, Retry, and Backoff

## 28.1 Timeout

```java
timeout(Duration.ofSeconds(2))
```

## 28.2 Retry

Retry should include:

- max attempts;
- backoff;
- jitter if supported;
- idempotency;
- deadline awareness.

## 28.3 Avoid retry storms

Never retry blindly.

## 28.4 Main rule

```text
Reactive retry is still retry: it must be bounded, delayed, and idempotent.
```

---

# 29. Schedulers

Schedulers define execution context.

Common conceptual categories:

## 29.1 immediate/current

Run on current thread.

## 29.2 parallel

CPU-bound parallel work.

## 29.3 bounded elastic

Bounded pool for blocking or longer tasks.

## 29.4 single

Single-threaded execution.

## 29.5 Main rule

```text
Schedulers are resource boundaries. Choose them by workload type.
```

---

# 30. `subscribeOn` vs `publishOn`

## 30.1 `subscribeOn`

Affects where subscription and upstream source execution happen.

Often placed near source, but position can be semantically subtle.

## 30.2 `publishOn`

Switches execution context for downstream operators after it.

## 30.3 Example mental model

```java
source
    .subscribeOn(blockingScheduler)
    .map(...)
    .publishOn(cpuScheduler)
    .map(cpuWork)
```

## 30.4 Main rule

```text
subscribeOn influences source subscription; publishOn moves downstream execution.
```

---

# 31. Context

Reactor Context carries metadata across reactive chain.

Use for:

- correlation ID;
- tenant;
- auth snapshot;
- deadline;
- tracing.

Do not use for:

- huge mutable objects;
- live request objects;
- database connection;
- JPA session.

## 31.1 Main rule

```text
Reactive context flows with signals, not threads.
```

---

# 32. Resource Management

Use resource-safe patterns for:

- file;
- connection;
- buffers;
- temporary state;
- subscriptions.

Cleanup must handle:

- complete;
- error;
- cancellation.

## 32.1 Main rule

```text
Reactive resource management must be cancellation-safe.
```

---

# 33. Blocking Boundaries

Blocking inside reactive pipeline is dangerous if it runs on event loop.

Bad:

```java
mono.map(x -> repository.blockingFind(x))
```

Better options:

- use reactive repository/client;
- isolate blocking call on bounded scheduler;
- use MVC + virtual threads if stack is blocking;
- migrate boundary explicitly.

## 33.1 Main rule

```text
A reactive pipeline is only as non-blocking as its blocking boundaries.
```

---

# 34. Testing with StepVerifier

Project Reactor provides StepVerifier for testing signals.

Conceptually test:

- expected values;
- completion;
- error;
- cancellation;
- virtual time;
- backpressure request behavior.

Example:

```java
StepVerifier.create(flux)
    .expectNext("a")
    .expectNext("b")
    .verifyComplete();
```

## 34.1 Main rule

```text
Reactive tests should assert signals, not just returned objects.
```

---

# 35. Debugging Reactor Pipelines

Challenges:

- stack trace may not show assembly location;
- execution may happen later;
- thread may switch;
- errors travel as signals;
- duplicate subscription can repeat side effects.

Tools/concepts:

- operator naming;
- checkpoints;
- logs around signals;
- metrics;
- tracing;
- debug hooks carefully;
- StepVerifier for minimal reproduction.

## 35.1 Main rule

```text
Debugging Reactor means tracing signal flow and assembly, not just call stack.
```

---

# 36. Observability

Measure:

- subscription count;
- requested demand;
- emitted count;
- error count;
- cancellation count;
- operator latency;
- scheduler queue;
- event-loop blocked;
- retry attempts;
- timeout count;
- dropped signals;
- context propagation.

## 36.1 Main rule

```text
Reactive observability must expose signal lifecycle and scheduler boundaries.
```

---

# 37. Mini Case Study: HTTP Fan-Out with Backpressure

## 37.1 Problem

Need call 100 downstream IDs.

Bad:

```java
Flux.fromIterable(ids)
    .flatMap(id -> client.call(id))
```

without concurrency limit.

## 37.2 Fix

```java
Flux.fromIterable(ids)
    .flatMap(id -> client.call(id), 10)
    .timeout(Duration.ofSeconds(3));
```

Add per-client bulkhead/timeouts/retry budget.

## 37.3 Lesson

```text
Reactive fan-out still needs concurrency limits.
```

---

# 38. Mini Case Study: Reactive Stream with Blocking Repository

## 38.1 Problem

```java
@GetMapping
Flux<CaseDto> list() {
    return Flux.fromIterable(repository.findAllBlocking())
        .map(mapper::toDto);
}
```

This calls blocking repository before returning/inside reactive path.

## 38.2 Fix options

- reactive database driver;
- isolate blocking call;
- use MVC + virtual threads;
- paginate/chunk.

## 38.3 Lesson

```text
Wrapping blocking code in Flux does not make it non-blocking.
```

---

# 39. Mini Case Study: Duplicate Subscription

## 39.1 Problem

```java
Mono<Receipt> charge = paymentClient.charge(command);

charge.subscribe(logResult());
charge.subscribe(sendEmail());
```

Cold publisher may call payment twice.

## 39.2 Fix

- compose one pipeline;
- share/cache intentionally if safe;
- use idempotency key;
- avoid manual subscribe in business logic.

## 39.3 Lesson

```text
Every subscription to cold side-effecting publisher can repeat side effects.
```

---

# 40. Common Anti-Patterns

## 40.1 Implementing Publisher manually without spec knowledge

Subtle bugs.

## 40.2 Ignoring demand

Breaks backpressure.

## 40.3 Blocking event loop

Major performance failure.

## 40.4 Unbounded flatMap

Dependency overload.

## 40.5 Blind retry

Retry storm.

## 40.6 Using ThreadLocal for context

Context loss.

## 40.7 Calling subscribe inside service method

Breaks composition/lifecycle.

## 40.8 Duplicate subscription to side-effect source

Duplicate side effects.

## 40.9 Swallowing errors as empty

Silent failure.

## 40.10 Forgetting cancellation cleanup

Resource leak.

---

# 41. Best Practices

## 41.1 Respect Reactive Streams protocol

Demand, terminal, cancellation.

## 41.2 Prefer library operators

Avoid custom Publisher unless necessary.

## 41.3 Limit flatMap concurrency

Protect downstream.

## 41.4 Keep event loop non-blocking

Isolate blocking boundaries.

## 41.5 Use context intentionally

Do not rely on ThreadLocal.

## 41.6 Treat retry as load

Budget and idempotency.

## 41.7 Avoid manual subscribe in business code

Return publisher to framework/composer.

## 41.8 Test signals

Use StepVerifier.

## 41.9 Observe cancellation and demand

Not just latency.

## 41.10 Choose reactive only when it fits

Do not force it on simple blocking CRUD.

---

# 42. Decision Matrix

| Situation | Recommended |
|---|---|
| Need 0..1 async result | Mono |
| Need 0..N async stream | Flux |
| Need strict order async mapping | concatMap |
| Need concurrent async mapping | flatMap with concurrency limit |
| Need concurrent but ordered output | flatMapSequential |
| Need combine 2 single results | Mono.zip |
| Need interleave multiple streams | merge |
| Need sequential streams | concat |
| Need blocking repository | virtual threads or bounded scheduler bridge |
| Need reactive DB + streaming | Flux/reactive end-to-end |
| Need context across thread hops | Reactor Context |
| Need test completion/error | StepVerifier |
| Need retry | retry with backoff/idempotency |
| Need CPU work | parallel scheduler or bounded CPU executor carefully |

---

# 43. Latihan

## Latihan 1 — Interface Protocol

Gambarkan urutan signal `onSubscribe -> request(3) -> onNext x3 -> onComplete`.

## Latihan 2 — Demand Violation

Jelaskan kenapa publisher tidak boleh emit 10 item setelah `request(5)`.

## Latihan 3 — Mono vs Flux

Klasifikasikan 10 use case sebagai Mono atau Flux.

## Latihan 4 — flatMap Limit

Desain pipeline 100 HTTP calls dengan concurrency 8.

## Latihan 5 — Ordering

Pilih `flatMap`, `concatMap`, atau `flatMapSequential` untuk beberapa kasus.

## Latihan 6 — subscribeOn vs publishOn

Gambarkan thread boundary untuk source blocking dan CPU mapping.

## Latihan 7 — Context

Desain context berisi tenant/correlation/deadline.

## Latihan 8 — Duplicate Subscription

Buat contoh cold publisher side effect yang terpanggil dua kali.

## Latihan 9 — StepVerifier

Tulis test untuk Flux yang emit `a`, `b`, lalu complete.

## Latihan 10 — Blocking Boundary

Refactor reactive pipeline yang memanggil JDBC blocking secara langsung.

---

# 44. Ringkasan

Reactive Streams adalah kontrak formal untuk asynchronous stream processing dengan non-blocking backpressure.

Core lessons:

- Reactive Streams menyelesaikan masalah producer cepat dan consumer lambat.
- Interface utama: Publisher, Subscriber, Subscription, Processor.
- Subscription adalah control channel untuk request dan cancel.
- Demand menentukan berapa banyak item boleh dikirim.
- Publisher tidak boleh emit lebih dari demand.
- Terminal signal hanya satu: complete atau error.
- Cancellation adalah lifecycle path penting.
- Signals harus serial ke Subscriber.
- Java Flow API merepresentasikan konsep serupa di JDK.
- Project Reactor menyediakan Mono dan Flux sebagai Publisher utama.
- Mono = 0..1, Flux = 0..N.
- Cold publisher bisa mengulang work per subscription.
- Hot publisher merepresentasikan live/shared source.
- Operators membangun pipeline; subscription mengeksekusi.
- flatMap adalah async fan-out dan perlu concurrency limit.
- concatMap menjaga ordering dengan concurrency lebih rendah.
- Schedulers adalah execution/resource boundary.
- subscribeOn dan publishOn punya semantics berbeda.
- Reactor Context menggantikan asumsi ThreadLocal untuk metadata reactive.
- Blocking boundary harus diisolasi atau dihapus.
- StepVerifier menguji signal behavior.
- Observability reactive harus mencakup demand, cancellation, scheduler, retry, timeout, dan errors.
- Hindari manual subscribe di business service.
- Reactive cocok saat asynchronous stream dan backpressure memang penting.

Main rule:

```text
Reactive Streams is not just an API style.
It is a protocol: subscribe, request, emit within demand,
terminate once, and clean up on cancellation.
```

---

# 45. Referensi

1. Reactive Streams Specification  
   https://www.reactive-streams.org/

2. Reactive Streams JVM API  
   https://github.com/reactive-streams/reactive-streams-jvm

3. Java SE 25 — `Flow` API  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Flow.html

4. Project Reactor Reference Guide  
   https://projectreactor.io/docs/core/release/reference/

5. Project Reactor API — `Mono`  
   https://projectreactor.io/docs/core/release/api/reactor/core/publisher/Mono.html

6. Project Reactor API — `Flux`  
   https://projectreactor.io/docs/core/release/api/reactor/core/publisher/Flux.html

7. Project Reactor Testing Reference  
   https://projectreactor.io/docs/core/release/reference/testing.html

8. Spring Framework Reference — WebFlux  
   https://docs.spring.io/spring-framework/reference/web/webflux.html

9. Spring Framework Reference — Reactive Core  
   https://docs.spring.io/spring-framework/reference/core/spring-core.html

10. OpenJDK JEP 444 — Virtual Threads  
    https://openjdk.org/jeps/444

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-concurrency-and-reactive-part-031.md](./learn-java-concurrency-and-reactive-part-031.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-concurrency-and-reactive-part-033.md](./learn-java-concurrency-and-reactive-part-033.md)

</div>
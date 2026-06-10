# Strict Coding Standards — Java Reactive

> File name intentionally follows the requested name: `strict-coding-standards__java_rective.md`.
> Recommended canonical alias: `strict-coding-standards__java_reactive.md`.

## 0. Purpose

This standard defines mandatory rules for implementing **reactive Java code** in production systems.
It applies to Reactive Streams, Java `Flow`, Project Reactor, RxJava, SmallRye Mutiny, Vert.x, Quarkus reactive APIs, reactive messaging, reactive HTTP clients, reactive database clients, and any asynchronous stream-based implementation.

This document is not a tutorial. It is a contract for LLM code agents and reviewers.

Reactive code is allowed only when it improves the system architecture. It is not a default replacement for simple imperative code.

## 1. Core Principle

Reactive programming must preserve:

1. correctness,
2. bounded resource usage,
3. backpressure semantics,
4. cancellation behavior,
5. observability,
6. explicit execution context,
7. predictable failure handling.

If these cannot be proven, use imperative Java with proper threads, executors, or virtual threads instead.

## 2. Baseline References

This standard is grounded in these primary references:

- Reactive Streams specification: https://www.reactive-streams.org/
- Reactive Streams JVM specification: https://github.com/reactive-streams/reactive-streams-jvm
- Java `Flow` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Flow.html
- SmallRye Mutiny documentation: https://smallrye.io/smallrye-mutiny/
- Quarkus Mutiny primer: https://quarkus.io/guides/mutiny-primer
- Quarkus reactive architecture: https://quarkus.io/guides/quarkus-reactive-architecture
- Project Reactor reference: https://projectreactor.io/docs/core/release/reference/
- RxJava documentation: https://github.com/ReactiveX/RxJava
- Vert.x documentation: https://vertx.io/docs/

## 3. Scope

This file governs:

- Reactive Streams `Publisher`, `Subscriber`, `Subscription`, `Processor`.
- Java `Flow.Publisher`, `Flow.Subscriber`, `Flow.Subscription`, `Flow.Processor`.
- Mutiny `Uni` and `Multi`.
- Reactor `Mono` and `Flux`.
- RxJava `Single`, `Maybe`, `Completable`, `Observable`, `Flowable`.
- Vert.x event loop and futures.
- Quarkus reactive routes, Quarkus REST reactive behavior, reactive messaging, and reactive clients.
- Reactive database clients and non-blocking I/O integrations.

This file does not replace:

- `strict-coding-standards__java_concurrency.md`
- `strict-coding-standards__java_stream.md`
- `strict-coding-standards__java_http.md`
- `strict-coding-standards__java_grpc.md`
- `strict-coding-standards__java_kafka.md`
- `strict-coding-standards__java_telemetry.md`

## 4. Terminology

### 4.1 Reactive

Reactive means the system is designed around asynchronous message/data flow with non-blocking behavior and backpressure-aware resource management.

Reactive does **not** mean:

- every method returns `Mono`, `Flux`, `Uni`, or `Multi`;
- every endpoint must be non-blocking;
- blocking calls disappear automatically;
- performance improves without measurement;
- errors become easier to handle.

### 4.2 Backpressure

Backpressure means the consumer can signal how much data it is ready to receive, and the producer must respect that signal.

If the source cannot respect downstream demand, the code must define an explicit overflow strategy.

### 4.3 Event Loop

An event loop is a small set of threads responsible for dispatching I/O events. It must not be blocked.

### 4.4 Blocking Work

Blocking work includes:

- JDBC calls,
- JPA/Hibernate calls,
- filesystem calls that may block,
- synchronous HTTP clients,
- DNS calls,
- cryptographic operations with expensive CPU cost,
- compression/decompression of large payloads,
- `Thread.sleep`,
- `Future.get`,
- `CompletableFuture.join`,
- waiting on locks/latches/semaphores,
- CPU-heavy transformation on event-loop threads.

## 5. Decision Rule: When Reactive Is Allowed

Reactive implementation is allowed only when at least one of these is true:

1. The service handles high concurrency with mostly non-blocking I/O.
2. The framework runtime is already reactive, such as Vert.x or Quarkus reactive stack.
3. The data source is naturally streaming and backpressure-sensitive.
4. The integration uses reactive messaging or reactive database clients.
5. The system needs efficient fan-out/fan-in with explicit cancellation and timeout behavior.
6. The code is part of an existing reactive module and must maintain consistency.

Reactive implementation is forbidden when:

1. The use case is simple CRUD over JDBC/JPA and no non-blocking stack exists.
2. The team cannot debug reactive call chains.
3. Most dependencies are blocking and will be wrapped in reactive types only superficially.
4. The implementation hides blocking calls on event loops.
5. The only justification is “reactive is modern”.
6. The code sacrifices readability without measurable architectural benefit.

## 6. LLM Agent Non-Negotiable Rules

An LLM code agent MUST NOT introduce reactive code unless it can state:

1. why reactive is appropriate,
2. which execution threads are used,
3. where blocking is forbidden,
4. how blocking dependencies are isolated,
5. how backpressure is handled,
6. how cancellation propagates,
7. how errors are mapped,
8. how timeouts are enforced,
9. how observability is attached,
10. how the behavior is tested.

If any answer is unknown, the agent must prefer imperative code or stop and request design clarification.

## 7. Allowed, Restricted, and Forbidden Constructs

| Construct                                                             |               Status | Rule                                                                     |
| --------------------------------------------------------------------- | -------------------: | ------------------------------------------------------------------------ |
| `Uni<T>` / `Mono<T>` for one async result                             |              Allowed | Use only when the operation is truly async or framework-native.          |
| `Multi<T>` / `Flux<T>` for streams                                    |              Allowed | Must define demand, cancellation, and overflow behavior.                 |
| Java `Flow` API                                                       |           Restricted | Use mostly for library/interoperability code.                            |
| Reactive Streams raw interfaces                                       |           Restricted | Prefer framework types unless implementing infrastructure.               |
| RxJava `Observable` for backpressured data                            |           Restricted | Prefer `Flowable` for backpressure-sensitive streams.                    |
| Reactor `parallel()`                                                  |           Restricted | Must justify scheduler and CPU model.                                    |
| `subscribe()` inside business code                                    | Forbidden by default | Subscription ownership belongs to boundary/runtime layer.                |
| Blocking call on event loop                                           |            Forbidden | Move to worker pool or use non-blocking client.                          |
| `block()`, `blockingGet()`, `await().indefinitely()` in reactive path |            Forbidden | Only allowed in tests, startup scripts, or explicit imperative boundary. |
| Unbounded buffering                                                   |            Forbidden | Must use bounded buffer/drop/latest/error strategy.                      |
| Swallowing errors with empty fallback                                 |            Forbidden | Fallback must be explicit and observable.                                |
| Retrying all errors forever                                           |            Forbidden | Retry must be bounded and classified.                                    |
| Hidden scheduler/thread switch                                        |            Forbidden | Every execution context switch must be justified.                        |

## 8. Reactive Type Selection

### 8.1 One Result

Use one-result reactive types only for one asynchronous result.

Examples:

- Mutiny: `Uni<Order>`
- Reactor: `Mono<Order>`
- RxJava: `Single<Order>` or `Maybe<Order>`

Rules:

- Use nullable values only if the library supports them safely.
- Prefer explicit empty/not-found semantics over `null`.
- Timeout must be attached at the boundary or operation level.
- Cancellation must cancel the underlying operation where supported.

### 8.2 Many Results

Use stream reactive types only when there can be multiple values over time.

Examples:

- Mutiny: `Multi<Event>`
- Reactor: `Flux<Event>`
- RxJava: `Flowable<Event>`

Rules:

- Demand/backpressure must be respected.
- Infinite streams must define cancellation behavior.
- Hot vs cold behavior must be documented.
- Replay/caching must be explicit.
- Ordering must be explicit if externally visible.

### 8.3 No Result

For completion-only operations:

- Mutiny: `Uni<Void>`
- Reactor: `Mono<Void>`
- RxJava: `Completable`

Rules:

- Do not hide side effects.
- Completion means the operation is actually complete, not merely scheduled.
- Failure must propagate.

## 9. Hot vs Cold Publisher Rules

Every publisher-like API must define whether it is hot or cold.

### 9.1 Cold Publisher

A cold publisher starts work per subscriber.

Allowed for:

- request-scoped computation,
- database query,
- HTTP call,
- file stream,
- generated data.

Rules:

- Multiple subscribers may trigger multiple executions.
- Side effects must be idempotent or guarded.
- Do not cache implicitly.

### 9.2 Hot Publisher

A hot publisher emits independent of subscribers.

Allowed for:

- event bus,
- message broker subscription,
- telemetry stream,
- WebSocket broadcast,
- system event stream.

Rules:

- Missing subscriber behavior must be explicit.
- Buffering/drop policy must be explicit.
- Shutdown must unsubscribe/close resources.
- Backpressure limitations must be documented.

## 10. Subscription Ownership

Business logic must return a reactive pipeline. It must not start it.

Forbidden:

```java
public void createOrder(CreateOrderCommand command) {
    repository.save(command)
        .subscribe().with(item -> log.info("saved"));
}
```

Allowed boundary ownership:

```java
public Uni<OrderId> createOrder(CreateOrderCommand command) {
    return repository.save(command)
        .map(Order::id);
}
```

Subscription may occur in:

- framework runtime,
- CLI boundary,
- test code,
- adapter that explicitly owns lifecycle,
- message listener framework.

## 11. Event Loop Rules

Event-loop code must be non-blocking.

Forbidden on event loop:

```java
Thread.sleep(1000);
entityManager.find(Order.class, id);
httpClient.send(request, BodyHandlers.ofString());
Files.readAllBytes(path);
future.get();
```

Allowed:

- non-blocking HTTP client,
- reactive database client,
- async filesystem API with worker dispatch,
- CPU-light mapping,
- validation with bounded cost.

If blocking work is unavoidable, use explicit worker dispatch:

- Quarkus: `@Blocking`, worker pool, or virtual thread where supported.
- Mutiny: `runSubscriptionOn` for blocking subscription work.
- Reactor: `Schedulers.boundedElastic()` for blocking I/O.
- Vert.x: `executeBlocking` or worker verticle.

Worker dispatch must be documented and bounded.

## 12. Blocking Isolation Rules

Wrapping blocking code in reactive type is not sufficient.

Forbidden:

```java
return Uni.createFrom().item(() -> jdbcTemplate.queryForObject(sql, mapper));
```

Allowed only when moved to blocking executor:

```java
return Uni.createFrom().item(() -> jdbcTemplate.queryForObject(sql, mapper))
    .runSubscriptionOn(blockingExecutor);
```

Rules:

- Blocking executor must be bounded.
- Queue size must be bounded or rejected.
- Timeout must be applied.
- Saturation must be observable.
- Downstream resource limit must be respected.

## 13. Backpressure Rules

A `Multi`, `Flux`, `Flowable`, or `Publisher` must define demand behavior.

Mandatory for streams:

1. source type: bounded, unbounded, hot, cold;
2. maximum buffer size;
3. overflow behavior;
4. cancellation behavior;
5. retry behavior;
6. slow consumer behavior;
7. order guarantee.

Forbidden:

- unbounded queue,
- unbounded prefetch,
- infinite retry,
- infinite buffering,
- converting backpressured stream into non-backpressured collection without limit.

For non-backpressured source, define one:

- drop latest,
- drop oldest,
- fail fast,
- sample/throttle,
- bounded buffer,
- explicit external queue.

## 14. Cancellation Rules

Reactive cancellation is part of correctness.

Every long-running operation must handle cancellation:

- cancel HTTP request if supported;
- close cursor/result stream;
- stop message consumption;
- release lock/semaphore;
- stop scheduled task;
- close file/channel;
- stop downstream fan-out.

Forbidden:

```java
return stream.onCancellation().invoke(() -> log.info("cancelled"));
```

if logging is the only cleanup but resources continue running.

## 15. Timeout Rules

Every remote/reactive boundary must have a timeout.

Required timeout types:

- request timeout,
- connect timeout for network client,
- database query timeout,
- broker ack/receive timeout,
- stream idle timeout where applicable,
- global deadline if request-scoped.

Forbidden:

- relying on library defaults without documenting them;
- timeout only at Kubernetes ingress while internal reactive flow runs forever;
- retry without deadline.

## 16. Retry Rules

Retry is restricted.

Retry is allowed only when:

1. operation is idempotent, or idempotency key exists;
2. error is classified transient;
3. retry count is bounded;
4. backoff is used;
5. jitter is used for distributed clients;
6. global deadline is respected;
7. retry attempts are observable.

Forbidden:

```java
.onFailure().retry().indefinitely()
```

Forbidden:

- retrying validation failure,
- retrying authorization failure,
- retrying duplicate key without idempotency plan,
- retrying message processing and committing offset anyway,
- retrying `POST` without idempotency key.

## 17. Error Handling Rules

Reactive error handling must preserve the failure signal.

Allowed:

- classify domain vs infrastructure errors;
- map infrastructure error to boundary error;
- recover from specific known transient failure;
- attach context without leaking secrets;
- convert to RFC 9457 / gRPC status / message DLQ appropriately.

Forbidden:

```java
.onFailure().recoverWithItem(defaultValue)
```

unless the fallback is a documented business behavior.

Forbidden:

- log and continue silently;
- return empty stream for infrastructure failure;
- swallow cancellation as success;
- convert all errors to HTTP 500 without classification;
- leak sensitive data in exception message.

## 18. Threading and Scheduler Rules

Every thread switch must be explicit.

Required documentation:

- source executor/event loop,
- worker executor,
- CPU scheduler,
- blocking scheduler,
- context propagation behavior,
- shutdown owner.

Forbidden:

- random `newFixedThreadPool` in business code;
- unbounded scheduler;
- using common pool for blocking I/O;
- relying on unknown default scheduler;
- scheduler switch as workaround for race condition.

## 19. Context Propagation Rules

Request context must be propagated intentionally.

Includes:

- trace ID,
- span context,
- correlation ID,
- tenant ID,
- authenticated principal,
- locale,
- deadline,
- cancellation token.

Forbidden:

- using `ThreadLocal` without reactive context propagation support;
- assuming MDC automatically crosses async boundaries;
- storing mutable request state in static/global context;
- leaking one request context into another.

## 20. Logging Rules

Reactive logs must include context but not secrets.

Mandatory fields where applicable:

- trace ID,
- span ID,
- correlation ID,
- operation name,
- stream name,
- partition/key if event stream,
- retry attempt,
- timeout/deadline,
- cancellation reason.

Forbidden:

- logging every element in high-volume streams by default;
- logging payload bodies containing secrets/PII;
- logging in `doOnNext` / `invoke` with expensive serialization;
- using logs as a substitute for metrics.

## 21. Metrics Rules

Reactive flows must expose metrics at boundaries.

Required metrics:

- active subscriptions,
- request duration,
- item processing duration,
- queue/buffer size,
- dropped items,
- retry count,
- timeout count,
- cancellation count,
- error count by type,
- worker pool saturation,
- backpressure/overflow events.

Metrics must avoid high cardinality labels.

Forbidden labels:

- user ID,
- raw URL with IDs,
- payload value,
- exception message,
- SQL string,
- object key with tenant/user identifiers unless normalized.

## 22. Tracing Rules

Every remote call or broker operation in reactive flow must preserve tracing context.

Rules:

- start span at boundary, not per item unless justified;
- avoid span explosion for large streams;
- include semantic attributes;
- record error status once;
- propagate context through scheduler switches;
- preserve parent-child relationship.

## 23. Reactive Database Rules

Reactive database client is allowed only when the driver is truly non-blocking.

Allowed:

- Vert.x reactive Pg client,
- R2DBC where chosen and supported,
- framework-native reactive clients.

Restricted:

- wrapping JDBC/JPA/Hibernate in reactive types.

Forbidden:

- using JPA/Hibernate on event loop;
- assuming reactive type means DB operation is non-blocking;
- mixing reactive transaction and imperative transaction without explicit boundary;
- lazy loading entity relations inside reactive pipeline.

## 24. Reactive HTTP Client Rules

Rules:

- client must be reusable;
- timeout must be explicit;
- redirect policy must be explicit;
- response body must be bounded or streamed;
- retry must respect HTTP idempotency;
- cancellation must cancel in-flight request if supported;
- SSRF validation applies to user-controlled URLs.

Forbidden:

- creating client per request;
- reading unbounded body into memory;
- blocking on response in event-loop path;
- trust-all TLS;
- disabled hostname verification.

## 25. Reactive Messaging Rules

Rules:

- message ack must happen after durable processing;
- nack/DLQ behavior must be explicit;
- idempotent consumer required;
- retry must be bounded;
- poison messages must not block partition/queue forever;
- backpressure must map to broker flow control where possible;
- offset/ack semantics must be documented.

Forbidden:

- acknowledging before processing if loss is unacceptable;
- subscribing inside handler without lifecycle owner;
- unbounded concurrency per partition/key when order matters;
- ignoring cancellation/shutdown.

## 26. Concurrency Rules

Reactive code does not eliminate concurrency bugs.

Rules:

- avoid mutable shared state;
- keep lambdas stateless;
- use immutable DTOs/events;
- serialize per key when order matters;
- document concurrency level;
- protect non-thread-safe clients/resources;
- do not assume callbacks run on same thread.

Forbidden:

```java
List<Item> result = new ArrayList<>();
return flux.doOnNext(result::add);
```

Use collectors/operators with proper ownership.

## 27. Ordering Rules

Ordering must be explicit.

Rules:

- preserve order only when required;
- document when parallelism can reorder;
- use sequential operator when order matters;
- use key-based serialization for per-aggregate order;
- test order-sensitive behavior.

Forbidden:

- using `flatMap` with concurrency when output order is required unless operator preserves order;
- assuming broker order across partitions;
- assuming asynchronous completion order equals input order.

## 28. Batching Rules

Batching is allowed only with bounded size and time.

Required:

- max batch size;
- max wait time;
- max memory budget;
- partial failure behavior;
- order behavior;
- retry behavior;
- flush on shutdown.

Forbidden:

- collect all items into list for unbounded stream;
- batch without deadline;
- batch without backpressure;
- batch without partial failure strategy.

## 29. Resource Lifecycle Rules

Reactive streams that own resources must close them.

Resources include:

- HTTP connection,
- database cursor,
- broker consumer,
- file/channel,
- scheduler/executor,
- lock/semaphore,
- external subscription.

Rules:

- allocate resource at subscription boundary;
- close on completion;
- close on failure;
- close on cancellation;
- close on application shutdown.

## 30. API Boundary Rules

Public APIs must not expose framework-specific reactive types unless the module is explicitly reactive.

Allowed in reactive module:

```java
Uni<OrderResponse> findOrder(OrderId id);
```

Forbidden in neutral domain module:

```java
Uni<Order> calculatePolicy(Order order);
```

Domain logic should usually remain synchronous/pure unless the domain itself is asynchronous.

## 31. DTO and Domain Rules

Reactive pipelines must not leak transport DTOs into domain logic.

Rules:

- map request DTO to command before business logic;
- keep domain operations pure where possible;
- map domain result to response DTO at boundary;
- do not pass framework context into domain objects.

## 32. Mutiny-Specific Rules

### 32.1 `Uni`

Rules:

- `Uni` represents zero-or-one asynchronous item/failure.
- Do not call `await().indefinitely()` in reactive path.
- Use `ifNoItem().after(...).fail()` or equivalent timeout where needed.
- Use `runSubscriptionOn` for blocking subscription work.
- Use `emitOn` carefully for downstream event dispatch.

Forbidden:

```java
return uni.await().indefinitely();
```

inside REST/reactive/message handler.

### 32.2 `Multi`

Rules:

- define overflow strategy for fast producer;
- avoid collecting infinite streams;
- handle cancellation;
- use bounded concurrency;
- document hot/cold behavior.

### 32.3 CompletionStage Conversion

Converting `Uni` to `CompletionStage` subscribes to the `Uni`; repeated conversions can trigger repeated work. Avoid repeated conversion unless idempotent and intentional.

## 33. Reactor-Specific Rules

Rules:

- prefer `Mono` for one result, `Flux` for many;
- use `Schedulers.boundedElastic()` only for bounded blocking I/O;
- do not use `parallel()` without CPU-bound justification;
- avoid `block()` except tests or imperative boundary;
- use `checkpoint`/operator naming for debuggability where useful;
- use context propagation consciously.

Forbidden:

```java
return webClient.get().retrieve().bodyToMono(String.class).block();
```

inside reactive pipeline.

## 34. RxJava-Specific Rules

Rules:

- use `Flowable` when backpressure matters;
- avoid `Observable` for unbounded high-volume data;
- document scheduler usage;
- dispose subscriptions on lifecycle end;
- never ignore `Disposable` in lifecycle-owned code.

## 35. Vert.x-Specific Rules

Rules:

- event loop must not block;
- use worker verticles or `executeBlocking` for blocking operations;
- avoid long CPU work on event loop;
- shared data must be explicit;
- context must be preserved;
- shutdown hooks must close clients/servers.

## 36. Testing Rules

Reactive code must be tested for:

- success path,
- error path,
- timeout,
- cancellation,
- retry count,
- fallback behavior,
- backpressure/overflow,
- ordering,
- concurrency limit,
- context propagation,
- resource cleanup,
- shutdown.

Forbidden:

- test that only subscribes without asserting terminal event;
- sleep-based timing tests without virtual time/test scheduler;
- ignoring dropped errors;
- not testing cancellation for long-running streams.

## 37. Test Patterns

### 37.1 Mutiny

Use Mutiny test subscribers/assertions where appropriate.

### 37.2 Reactor

Use `StepVerifier` and virtual time where appropriate.

### 37.3 RxJava

Use `TestObserver` / `TestSubscriber`.

### 37.4 Generic

Use deterministic schedulers/clocks where possible.

## 38. Performance Rules

Reactive performance claims require evidence.

Required evidence:

- workload shape,
- concurrency level,
- latency percentiles,
- throughput,
- CPU usage,
- allocation rate,
- GC behavior,
- event-loop blocked time,
- worker queue depth,
- external dependency saturation.

Forbidden:

- claiming reactive is faster without measurement;
- replacing imperative code with reactive for style only;
- creating excessive small operators in hot path without profiling;
- using reactive streams to hide bad database query design.

## 39. Security Rules

Reactive code must obey all security standards.

Required:

- input validation at boundary;
- tenant/auth context propagation;
- authorization before side effect;
- no secret logging;
- SSRF validation for outbound calls;
- bounded payloads;
- secure deserialization policy;
- rate limits/backpressure for public endpoints.

Forbidden:

- losing security context across async boundary;
- using fallback that bypasses authorization;
- retrying unauthorized request;
- logging token/payload during debugging.

## 40. Observability Rules

Every reactive boundary must provide enough evidence to debug:

- where work starts,
- where work waits,
- where work fails,
- where backpressure occurs,
- where cancellation occurs,
- where blocking happens,
- where retries happen.

Event-loop blocked-thread detection must be enabled in event-loop-based systems where available.

## 41. Shutdown Rules

Reactive systems must shut down gracefully.

Rules:

- stop accepting new work;
- cancel or drain in-flight streams according to policy;
- flush batches;
- close broker consumers/producers;
- close HTTP/database clients;
- stop schedulers/executors;
- emit shutdown metrics/logs.

Forbidden:

- abrupt shutdown with dropped in-flight side effects;
- non-daemon scheduler that prevents process exit;
- ignoring cancellation on shutdown.

## 42. Anti-Patterns

Forbidden anti-patterns:

1. Reactive wrapper around blocking code with no scheduler isolation.
2. `subscribe()` inside service method.
3. `block()` inside event loop.
4. Unbounded `flatMap` concurrency.
5. Infinite retry.
6. Empty fallback hiding infrastructure failure.
7. Hot stream with no backpressure/overflow policy.
8. Using reactive types in domain model.
9. Mixing reactive and imperative transaction boundaries accidentally.
10. Losing MDC/security context across async boundary.
11. Parallelizing per-aggregate ordered operations.
12. Calling external service once per stream item without concurrency limit.
13. Collecting unbounded stream into memory.
14. Swallowing cancellation.
15. Treating reactive as automatic performance optimization.

## 43. Required Design Note for New Reactive Code

Every new reactive flow must include a short design note:

```markdown
### Reactive Design Note

- Why reactive is justified:
- Reactive library/type used:
- Source type: hot/cold, bounded/unbounded:
- Execution context:
- Blocking dependencies:
- Blocking isolation strategy:
- Backpressure/overflow strategy:
- Timeout/deadline:
- Retry policy:
- Cancellation behavior:
- Error mapping:
- Ordering guarantee:
- Resource cleanup:
- Observability:
- Tests added:
```

## 44. Reviewer Checklist

A reviewer must reject reactive code if:

- [ ] reactive justification is missing;
- [ ] blocking call may run on event loop;
- [ ] subscription ownership is unclear;
- [ ] timeout is missing;
- [ ] retry is unbounded or unclassified;
- [ ] cancellation is ignored;
- [ ] backpressure/overflow is undefined;
- [ ] scheduler/thread ownership is unclear;
- [ ] security context propagation is unclear;
- [ ] logging may leak secrets;
- [ ] metrics/tracing are missing at boundaries;
- [ ] tests do not cover failure/timeout/cancellation;
- [ ] performance claim lacks evidence;
- [ ] reactive type leaks into domain layer unnecessarily.

## 45. LLM Prompt Contract

When implementing Java reactive code, the LLM must follow this contract:

```text
You are implementing Java reactive code.
Before writing code:
1. Identify whether the code is truly reactive or just asynchronous.
2. Identify the reactive library and baseline Java/framework version.
3. Identify event-loop, worker, scheduler, and blocking boundaries.
4. Identify source type: hot/cold, bounded/unbounded.
5. Define backpressure, timeout, retry, cancellation, and error mapping.
6. Preserve security and trace context.
7. Do not call subscribe/block/await inside business logic unless this is an explicit boundary.
8. Do not wrap blocking code in reactive types without bounded blocking isolation.
9. Add tests for success, failure, timeout, retry, cancellation, and overflow where relevant.
10. If any item is unknown, do not invent behavior; state the assumption explicitly.
```

## 46. Final Rule

Reactive code is acceptable only when it makes the system more correct, scalable, observable, and maintainable.

Reactive code that hides blocking work, hides errors, loses context, or creates unbounded resource usage is worse than simple imperative code.

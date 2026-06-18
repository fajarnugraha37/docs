# learn-jaxrs-advanced-part-024.md

# Bagian 024 — Asynchronous JAX-RS Server: `AsyncResponse`, `@Suspended`, `CompletionStage`, Timeouts, Cancellation, Lifecycle Callbacks, Executor Model, Backpressure, and Production-Safe Async APIs

> Target pembaca: Java/Jakarta engineer yang ingin menguasai **server-side asynchronous processing** dalam JAX-RS/Jakarta REST secara production-grade. Fokus bagian ini bukan hanya contoh `@Suspended AsyncResponse`, tetapi memahami kapan async berguna, kapan tidak, bagaimana request connection disuspend/resume, timeout, cancellation, callback lifecycle, executor ownership, MDC/context propagation, backpressure, long-polling, async job response `202 Accepted`, error handling, testing, observability, dan perbedaan dengan reactive/non-blocking runtime.
>
> Namespace utama: `jakarta.ws.rs.container.AsyncResponse`, `jakarta.ws.rs.container.Suspended`, `jakarta.ws.rs.container.TimeoutHandler`, `jakarta.ws.rs.container.CompletionCallback`, `jakarta.ws.rs.container.ConnectionCallback`, `jakarta.ws.rs.core.Response`, `java.util.concurrent.CompletionStage`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Async JAX-RS Membebaskan Request Thread, Bukan Membuat Kerja Jadi Gratis](#2-mental-model-async-jax-rs-membebaskan-request-thread-bukan-membuat-kerja-jadi-gratis)
3. [Synchronous Resource Method](#3-synchronous-resource-method)
4. [Asynchronous Resource Method dengan `AsyncResponse`](#4-asynchronous-resource-method-dengan-asyncresponse)
5. [`@Suspended`](#5-suspended)
6. [`AsyncResponse` Lifecycle](#6-asyncresponse-lifecycle)
7. [`resume(Object)`](#7-resumeobject)
8. [`resume(Throwable)`](#8-resumethrowable)
9. [`cancel()` dan `cancel(retryAfter)`](#9-cancel-dan-cancelretryafter)
10. [`isSuspended`, `isCancelled`, `isDone`](#10-issuspended-iscancelled-isdone)
11. [Timeout Default dan Custom TimeoutHandler](#11-timeout-default-dan-custom-timeouthandler)
12. [`NO_TIMEOUT` dan Infinite Suspension](#12-no_timeout-dan-infinite-suspension)
13. [Lifecycle Callback: CompletionCallback](#13-lifecycle-callback-completioncallback)
14. [Lifecycle Callback: ConnectionCallback](#14-lifecycle-callback-connectioncallback)
15. [AsyncResponse Register Callback](#15-asyncresponse-register-callback)
16. [CompletionStage Resource Methods](#16-completionstage-resource-methods)
17. [`AsyncResponse` vs `CompletionStage`](#17-asyncresponse-vs-completionstage)
18. [AsyncResponse vs Background Job](#18-asyncresponse-vs-background-job)
19. [Long-Running Operation Pattern: 202 Accepted + Status Resource](#19-long-running-operation-pattern-202-accepted--status-resource)
20. [Long Polling Pattern](#20-long-polling-pattern)
21. [Server-Sent Events vs AsyncResponse](#21-server-sent-events-vs-asyncresponse)
22. [Executor Ownership](#22-executor-ownership)
23. [Do Not Spawn Raw Threads per Request](#23-do-not-spawn-raw-threads-per-request)
24. [Thread Pool Sizing](#24-thread-pool-sizing)
25. [Backpressure dan Bounded Queues](#25-backpressure-dan-bounded-queues)
26. [Timeout Budgeting](#26-timeout-budgeting)
27. [Client Disconnect and Cancellation](#27-client-disconnect-and-cancellation)
28. [Context Propagation: Security, Tenant, MDC, Locale](#28-context-propagation-security-tenant-mdc-locale)
29. [CDI / Request Scope Caveat](#29-cdi--request-scope-caveat)
30. [Transaction Boundary](#30-transaction-boundary)
31. [Error Handling and Exception Mapping](#31-error-handling-and-exception-mapping)
32. [Response Commit Semantics](#32-response-commit-semantics)
33. [Filters, Interceptors, and Async](#33-filters-interceptors-and-async)
34. [Validation and Async](#34-validation-and-async)
35. [Security and Async](#35-security-and-async)
36. [Idempotency and Async](#36-idempotency-and-async)
37. [Resource Leaks](#37-resource-leaks)
38. [Memory Safety: Suspended Response Registry](#38-memory-safety-suspended-response-registry)
39. [Async Job API Design](#39-async-job-api-design)
40. [Status Resource Design](#40-status-resource-design)
41. [Cancellation Endpoint Design](#41-cancellation-endpoint-design)
42. [Retry-After and Polling Policy](#42-retry-after-and-polling-policy)
43. [Async and Observability](#43-async-and-observability)
44. [Metrics](#44-metrics)
45. [Tracing](#45-tracing)
46. [Logging](#46-logging)
47. [Testing AsyncResponse](#47-testing-asyncresponse)
48. [Testing CompletionStage Methods](#48-testing-completionstage-methods)
49. [Testing Timeout and Cancellation](#49-testing-timeout-and-cancellation)
50. [Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus](#50-runtime-differences-jersey-resteasy-cxf-liberty-quarkus)
51. [Reactive/Non-Blocking Runtime Caveat](#51-reactivenon-blocking-runtime-caveat)
52. [Common Failure Modes](#52-common-failure-modes)
53. [Best Practices](#53-best-practices)
54. [Anti-Patterns](#54-anti-patterns)
55. [Production Checklist](#55-production-checklist)
56. [Latihan](#56-latihan)
57. [Referensi Resmi](#57-referensi-resmi)
58. [Penutup](#58-penutup)

---

# 1. Tujuan Part Ini

Synchronous endpoint sederhana:

```java
@GET
@Path("/reports/{id}")
public ReportResponse getReport(@PathParam("id") ReportId id) {
    return reportService.generate(id);
}
```

Jika `generate()` lama, request thread tertahan.

Server-side async memungkinkan resource method **return lebih cepat ke runtime** sambil response disediakan nanti:

```java
@GET
@Path("/reports/{id}")
public void getReport(
    @PathParam("id") ReportId id,
    @Suspended AsyncResponse async
) {
    executor.submit(() -> {
        ReportResponse report = reportService.generate(id);
        async.resume(report);
    });
}
```

Namun ini bukan magic.

Async tidak mengurangi pekerjaan CPU/IO.

Async hanya mengubah siapa yang memegang request saat pekerjaan menunggu.

## 1.1 Tujuan utama

Bagian ini menjawab:

- kapan server-side async berguna?
- bagaimana `@Suspended AsyncResponse` bekerja?
- apa bedanya dengan `CompletionStage<T>`?
- kapan harus `202 Accepted` bukan menahan connection?
- bagaimana timeout dan cancel bekerja?
- bagaimana menangani client disconnect?
- bagaimana menjaga context propagation?
- bagaimana mendesain executor/backpressure?
- bagaimana menghindari leak suspended responses?
- bagaimana testing dan observability?

## 1.2 Prinsip utama

```text
Async frees the request handling thread.
It does not make blocking work non-blocking.
It does not replace queueing, backpressure, timeout, or job design.
```

---

# 2. Mental Model: Async JAX-RS Membebaskan Request Thread, Bukan Membuat Kerja Jadi Gratis

Synchronous:

```text
request thread
  ↓
resource method
  ↓
blocking work
  ↓
response
```

Asynchronous:

```text
request thread
  ↓
resource method receives AsyncResponse
  ↓
suspend connection
  ↓
request thread returns to container
  ↓
worker/completion callback finishes work
  ↓
async.resume(response)
  ↓
JAX-RS writes response
```

## 2.1 What async improves

Async helps when request thread should not be blocked while waiting for:

- slow downstream IO;
- message/event arrival;
- long poll;
- non-blocking computation completion;
- completion stage;
- async database/client API.

## 2.2 What async does not improve

If you move blocking work to another unbounded thread pool, you may simply move bottleneck.

```text
request thread exhausted → worker pool exhausted
```

## 2.3 Async needs capacity control

You need:

- bounded executor;
- queue limits;
- timeouts;
- cancellation;
- overload responses;
- metrics.

## 2.4 Top-tier rule

```text
Async is a concurrency management tool, not a performance guarantee.
```

---

# 3. Synchronous Resource Method

## 3.1 Example

```java
@GET
@Path("/customers/{id}")
@Produces(MediaType.APPLICATION_JSON)
public CustomerResponse get(@PathParam("id") CustomerId id) {
    return service.get(id);
}
```

## 3.2 Runtime flow

```text
match resource
invoke method
method returns Java object/Response
filters/interceptors/writer process
send response
```

## 3.3 Good for

- fast endpoints;
- blocking but bounded/short calls;
- simple CRUD;
- low latency service code;
- normal database operations under controlled timeout.

## 3.4 Problem

If method blocks for a long time, request processing thread is occupied.

## 3.5 Rule

Default to synchronous until you have a reason for async.

---

# 4. Asynchronous Resource Method dengan `AsyncResponse`

`AsyncResponse` is injectable asynchronous response object for server-side response processing.

## 4.1 Method shape

```java
@GET
public void get(@Suspended AsyncResponse async) {
    ...
}
```

Method usually returns `void`.

## 4.2 Suspend

Injecting `AsyncResponse` with `@Suspended` tells runtime this resource method is asynchronous and will not produce response immediately.

## 4.3 Resume later

```java
async.resume(entity);
```

or:

```java
async.resume(Response.ok(entity).build());
```

## 4.4 Error later

```java
async.resume(exception);
```

## 4.5 Rule

`AsyncResponse` is a handle to complete a suspended HTTP response later.

---

# 5. `@Suspended`

`@Suspended` marks an injection point for suspended async processing.

## 5.1 Example

```java
public void longPoll(@Suspended AsyncResponse async) {
    ...
}
```

## 5.2 Meaning

The resource method does not produce a response when it returns.

The runtime suspends the incoming connection until response becomes available, timeout occurs, or cancellation happens.

## 5.3 Only for async parameter

Use on `AsyncResponse` parameter.

## 5.4 Not a CDI scope

`@Suspended` is not about dependency lifecycle.

## 5.5 Rule

`@Suspended` turns resource method into async response producer.

---

# 6. `AsyncResponse` Lifecycle

States:

```text
suspended
  ↓ resume(response/throwable)
done

suspended
  ↓ timeout
done

suspended
  ↓ cancel
cancelled/done

suspended
  ↓ client disconnect
done/cancelled depending runtime callback
```

## 6.1 Normal completion

Call:

```java
async.resume(...)
```

## 6.2 Timeout completion

Configured timeout expires.

Default behavior is 503 unless custom handler.

## 6.3 Cancellation

Application cancels suspended response.

## 6.4 Client disconnect

Connection may close; runtime may notify via callback.

## 6.5 Rule

Every suspended response must eventually complete, timeout, or cancel.

---

# 7. `resume(Object)`

`resume(Object)` resumes suspended response using supplied response data.

## 7.1 Entity object

```java
async.resume(new CustomerResponse(...));
```

JAX-RS processes as if resource method returned that object.

## 7.2 Response object

```java
async.resume(Response.ok(body).build());
```

## 7.3 Return boolean

```java
boolean accepted = async.resume(response);
```

Returns whether resume was accepted depending state.

If already done/cancelled, it may return false.

## 7.4 Race

Timeout and worker completion can race.

Always check return or design idempotent completion.

## 7.5 Rule

Call `resume` once. Treat multiple completion attempts as race bugs unless explicitly handled.

---

# 8. `resume(Throwable)`

Use to complete with error.

## 8.1 Example

```java
try {
    async.resume(service.call());
} catch (Throwable t) {
    async.resume(t);
}
```

## 8.2 Exception mapping

JAX-RS can map exception via exception mappers as in normal resource processing.

## 8.3 Prefer domain exceptions

Resume with meaningful application exception, not raw internal exception.

## 8.4 Beware after timeout

If timeout already completed response, `resume(Throwable)` may fail/return false.

## 8.5 Rule

Async error path must use same Problem Details/error mapper strategy as synchronous path.

---

# 9. `cancel()` dan `cancel(retryAfter)`

`cancel()` cancels suspended request processing.

## 9.1 Default cancellation

```java
async.cancel();
```

Runtime indicates cancellation to client using 503.

## 9.2 With Retry-After seconds

```java
async.cancel(30);
```

Response includes:

```http
Retry-After: 30
```

## 9.3 With Retry-After date

```java
async.cancel(retryAfterDate);
```

## 9.4 Use cases

- overload;
- server shutdown;
- resource no longer available;
- long-poll queue full;
- application cancellation.

## 9.5 Rule

Use cancellation intentionally; include retry guidance when appropriate.

---

# 10. `isSuspended`, `isCancelled`, `isDone`

## 10.1 `isSuspended()`

True if still suspended and not complete.

## 10.2 `isCancelled()`

True if response was canceled.

## 10.3 `isDone()`

True if processing finished due to resume, timeout, or cancellation.

## 10.4 Race caveat

State can change immediately after check.

Do not use checks as synchronization guarantee.

## 10.5 Better

Use return value from `resume/cancel` and atomic state in your own registry if needed.

## 10.6 Rule

State methods are diagnostic; completion operations still need race-safe design.

---

# 11. Timeout Default dan Custom TimeoutHandler

## 11.1 Default timeout behavior

If suspended response times out and no custom handler is set, default behavior resumes with 503 Service Unavailable.

## 11.2 Set timeout

```java
async.setTimeout(10, TimeUnit.SECONDS);
```

## 11.3 Custom handler

```java
async.setTimeoutHandler(ar -> {
    ar.resume(Response.status(Response.Status.GATEWAY_TIMEOUT)
        .type("application/problem+json")
        .entity(problem("ASYNC_TIMEOUT"))
        .build());
});
```

## 11.4 Handler options

Timeout handler may:

- resume response;
- cancel response;
- extend timeout.

## 11.5 Rule

Always set explicit timeout for suspended responses.

---

# 12. `NO_TIMEOUT` dan Infinite Suspension

`AsyncResponse.NO_TIMEOUT` represents no suspend timeout.

## 12.1 Infinite wait

Can be dangerous.

```java
async.setTimeout(AsyncResponse.NO_TIMEOUT, TimeUnit.MILLISECONDS);
```

## 12.2 Risks

- memory leak;
- connection exhaustion;
- client disconnect handling;
- resource registry growth;
- no operational bound.

## 12.3 Use only when

- protocol requires indefinite wait;
- connection count bounded;
- cleanup callbacks implemented;
- shutdown handling exists.

## 12.4 Rule

Avoid infinite suspension unless you have strong backpressure and cleanup.

---

# 13. Lifecycle Callback: CompletionCallback

`CompletionCallback` can be registered to be notified when async processing completes.

## 13.1 Use cases

- cleanup registry;
- metrics finalization;
- release resource;
- log completion.

## 13.2 Example

```java
async.register((CompletionCallback) throwable -> {
    registry.remove(requestId);
    if (throwable != null) {
        log.warn("async failed", throwable);
    }
});
```

## 13.3 Throwable

May indicate failure.

## 13.4 Rule

Use completion callback for cleanup, not business completion semantics.

---

# 14. Lifecycle Callback: ConnectionCallback

`ConnectionCallback` can notify about connection close/disconnect where supported.

## 14.1 Use cases

- stop long-running work;
- remove long-poll waiter;
- release resource;
- cancel downstream call.

## 14.2 Example

```java
async.register((ConnectionCallback) disconnected -> {
    cancellationToken.cancel();
    registry.remove(requestId);
});
```

## 14.3 Runtime support

ConnectionCallback support can depend on runtime/container.

## 14.4 Rule

Do not assume client disconnect automatically cancels your background work; wire cancellation deliberately.

---

# 15. AsyncResponse Register Callback

`AsyncResponse#register` registers callback classes/instances.

## 15.1 Instance registration

```java
async.register(new MyCompletionCallback());
```

## 15.2 Lambda

For functional callback interfaces:

```java
async.register((CompletionCallback) throwable -> cleanup());
```

## 15.3 Multiple callbacks

Can register multiple callback types.

## 15.4 Threading

Callback thread may be runtime-specific.

Keep callback fast and safe.

## 15.5 Rule

Register cleanup callbacks immediately after suspension.

---

# 16. CompletionStage Resource Methods

Jakarta REST also supports asynchronous resource methods by returning `CompletionStage<T>`.

## 16.1 Example

```java
@GET
@Path("/{id}")
public CompletionStage<CustomerResponse> get(@PathParam("id") CustomerId id) {
    return customerService.getAsync(id);
}
```

## 16.2 Runtime behavior

When a resource method returns `CompletionStage`, the request is suspended and resumed when the stage completes.

## 16.3 Success

Stage completes with entity/response.

## 16.4 Failure

Stage completes exceptionally, handled by exception mapping where applicable.

## 16.5 Rule

Use `CompletionStage` when your work already has async completion model.

---

# 17. `AsyncResponse` vs `CompletionStage`

## 17.1 AsyncResponse

Manual control:

- resume;
- cancel;
- timeout handler;
- callbacks;
- long polling;
- store handle.

## 17.2 CompletionStage

Declarative completion:

- return future/stage;
- cleaner code;
- fits async client/database APIs;
- less manual lifecycle.

## 17.3 Prefer CompletionStage when

- one async computation produces one response;
- no need to store suspended clients;
- no custom cancellation/timeout logic beyond runtime/service timeout.

## 17.4 Prefer AsyncResponse when

- long polling;
- event arrives later from external system;
- need manual timeout/cancel;
- need registry of suspended responses;
- need custom lifecycle callbacks.

## 17.5 Rule

Use the simplest async model that expresses lifecycle correctly.

---

# 18. AsyncResponse vs Background Job

Important distinction.

## 18.1 AsyncResponse

Client connection remains open.

Good for:

- short-ish async wait;
- long polling;
- async IO completion;
- request expected to complete soon.

## 18.2 Background job

Client receives `202 Accepted` and polls status resource.

Good for:

- minutes/hours work;
- export/report generation;
- batch processing;
- retryable durable work;
- server restart resilience.

## 18.3 Bad

Holding HTTP connection open for 10-minute report generation.

## 18.4 Rule

If work outlives reasonable HTTP request timeout, use 202 + job resource.

---

# 19. Long-Running Operation Pattern: 202 Accepted + Status Resource

## 19.1 Start job

```http
POST /exports
```

Response:

```http
202 Accepted
Location: /operations/OP123
Retry-After: 5
```

Body:

```json
{
  "operationId": "OP123",
  "status": "accepted",
  "_links": {
    "self": { "href": "/operations/OP123" }
  }
}
```

## 19.2 Poll status

```http
GET /operations/OP123
```

Response:

```json
{
  "operationId": "OP123",
  "status": "running",
  "progress": 40
}
```

## 19.3 Completed

```json
{
  "operationId": "OP123",
  "status": "completed",
  "_links": {
    "result": { "href": "/exports/E123/download" }
  }
}
```

## 19.4 Rule

Use async HTTP suspension for short waits; use operation resource for durable long work.

---

# 20. Long Polling Pattern

Long polling holds request until event is available or timeout occurs.

## 20.1 Example

```http
GET /messages/next
```

Server suspends response until message arrives.

## 20.2 AsyncResponse registry

```java
BlockingQueue<AsyncResponse> waiters = new ArrayBlockingQueue<>(maxWaiters);
```

## 20.3 Timeout

Return:

```http
204 No Content
```

or:

```http
200 OK []
```

depending contract.

## 20.4 Backpressure

If too many waiters:

```http
503 Service Unavailable
Retry-After: 5
```

## 20.5 Rule

Long polling must have timeout and waiter limit.

---

# 21. Server-Sent Events vs AsyncResponse

## 21.1 AsyncResponse

One suspended request → one response completion.

## 21.2 SSE

One connection → many events over time.

Use for:

- notifications;
- streaming status;
- live updates.

## 21.3 AsyncResponse can long-poll

But not ideal for continuous event stream.

## 21.4 Rule

Use AsyncResponse for one eventual response; use SSE for event stream.

---

# 22. Executor Ownership

Async work must run somewhere.

## 22.1 Bad

```java
new Thread(() -> ...).start();
```

per request.

## 22.2 Good

Use managed/bounded executor.

```java
executor.submit(() -> {
    ...
});
```

## 22.3 Jakarta EE

Prefer managed executor service if available.

## 22.4 Microservices

Use bounded `ExecutorService` with metrics/shutdown.

## 22.5 Rule

Own your executor capacity model.

---

# 23. Do Not Spawn Raw Threads per Request

## 23.1 Why bad

- unbounded threads;
- no lifecycle management;
- no context propagation;
- no shutdown coordination;
- high memory;
- thread scheduling overhead;
- no metrics.

## 23.2 Better

```java
ThreadPoolExecutor(
    core,
    max,
    keepAlive,
    TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(queueSize),
    namedThreadFactory,
    rejectionHandler
)
```

## 23.3 Rejection

Return 503/429 with Problem Details.

## 23.4 Rule

Raw thread per request is not production async.

---

# 24. Thread Pool Sizing

## 24.1 CPU-bound work

Pool near CPU cores.

## 24.2 Blocking IO work

Pool can be larger but must be bounded.

## 24.3 Async/non-blocking IO

Prefer non-blocking APIs and completion stages, not extra threads.

## 24.4 Formula intuition

For blocking:

```text
threads ≈ cores * (1 + wait_time / compute_time)
```

But validate with measurement.

## 24.5 Rule

Thread pool size is capacity planning, not guesswork.

---

# 25. Backpressure dan Bounded Queues

If async queue is unbounded, overload becomes latency/memory disaster.

## 25.1 Use bounded queue

```java
new ArrayBlockingQueue<>(1000)
```

## 25.2 Rejection strategy

Return:

```http
503 Service Unavailable
Retry-After: 5
```

or:

```http
429 Too Many Requests
```

depending policy.

## 25.3 Long-poll waiter limit

Bound suspended response registry.

## 25.4 Rule

Every async design needs an overload answer.

---

# 26. Timeout Budgeting

Timeouts should be layered:

```text
client timeout
gateway timeout
server request timeout
AsyncResponse timeout
downstream timeout
executor queue timeout
database/client timeout
```

## 26.1 Budget example

```text
client: 30s
gateway: 25s
app async timeout: 20s
downstream: 15s
```

## 26.2 Avoid impossible timeout

If gateway kills at 30s, app timeout at 60s is useless.

## 26.3 Rule

Async timeout must fit deployment topology.

---

# 27. Client Disconnect and Cancellation

Client may disconnect while work continues.

## 27.1 Problem

Background task still runs and consumes resources.

## 27.2 Use ConnectionCallback

Cancel downstream work if possible.

## 27.3 Cancellation token

```java
CancellationToken token = new CancellationToken();
async.register((ConnectionCallback) disconnected -> token.cancel());
```

## 27.4 Not always possible

Some blocking calls cannot be interrupted safely.

## 27.5 Rule

Design what happens when client disappears.

---

# 28. Context Propagation: Security, Tenant, MDC, Locale

Async worker may run on different thread.

## 28.1 Request context not automatically available

Thread-locals like MDC may not propagate.

## 28.2 Capture immutable context

```java
CurrentActor actor = currentActor();
TenantId tenantId = actor.tenantId();
String correlationId = correlationId();
Locale locale = requestLocale();
```

Pass to worker.

## 28.3 Restore MDC

```java
try (MdcScope ignored = MdcScope.with("correlationId", correlationId)) {
    ...
}
```

## 28.4 Security

Do not use `SecurityContext` outside request thread if not guaranteed.

Map to `CurrentActor`.

## 28.5 Rule

Capture application context explicitly before leaving request thread.

---

# 29. CDI / Request Scope Caveat

Request-scoped beans may not be active in worker thread.

## 29.1 Bad

```java
executor.submit(() -> requestScopedBean.doSomething());
```

## 29.2 Better

Extract values before async.

```java
RequestMetadata metadata = requestMetadata.snapshot();
executor.submit(() -> service.doWork(metadata));
```

## 29.3 Managed executor

Some platforms support context propagation.

Still verify.

## 29.4 Rule

Do not assume CDI request scope follows async thread.

---

# 30. Transaction Boundary

Do not hold DB transaction open while response is suspended.

## 30.1 Bad

```text
begin transaction
suspend response
wait 30 seconds
resume
commit
```

Locks/resources held too long.

## 30.2 Better

Start transaction inside worker only while doing DB work.

## 30.3 Job pattern

For long operations, persist job state and commit quickly.

## 30.4 Rule

Async suspension is not transaction suspension.

---

# 31. Error Handling and Exception Mapping

## 31.1 Synchronous

Exception thrown from resource method can be mapped.

## 31.2 Async

Exception in worker thread must be passed to JAX-RS:

```java
async.resume(exception);
```

or converted to Response.

## 31.3 CompletionStage

Exceptional completion maps similarly.

## 31.4 Avoid swallowing errors

Bad:

```java
catch (Exception e) { log.error(...); }
```

without completing response.

Client hangs until timeout.

## 31.5 Rule

Every async failure path must complete the response.

---

# 32. Response Commit Semantics

Before `resume`, response not sent.

After `resume`, runtime processes response and may commit.

## 32.1 Double resume

Only one completion should win.

## 32.2 Timeout race

Worker may complete after timeout response already sent.

Check return value.

```java
if (!async.resume(response)) {
    log.debug("async already completed");
}
```

## 32.3 Streaming

If response entity streams and fails later, normal late-commit issues apply.

## 32.4 Rule

Completion is race-sensitive; design idempotently.

---

# 33. Filters, Interceptors, and Async

## 33.1 Request filters

Run before resource method and suspension.

## 33.2 Response filters

Run when async response is resumed and response is being processed.

## 33.3 Interceptors

Run when entity is read/written.

## 33.4 Request properties

Properties may be useful but don't rely on thread-local request state in worker.

## 33.5 Rule

Async changes timing/threading, not the fact that response still goes through JAX-RS pipeline.

---

# 34. Validation and Async

## 34.1 Parameter validation

Happens before method invocation where runtime integration applies.

## 34.2 Entity validation

Request entity is read before resource method if bound as parameter.

## 34.3 Async work validation

Domain validations in worker must map errors via `resume(Throwable)` or Response.

## 34.4 Rule

Async does not remove need for validation/error mapping.

---

# 35. Security and Async

## 35.1 Authenticate before suspend

Security filter runs before resource.

## 35.2 Capture CurrentActor

Do not hold raw `SecurityContext`.

## 35.3 Re-check authorization

If work completes much later, permissions/resource state may have changed.

For short async waits, initial check may be okay.

For long jobs, re-check at execution time.

## 35.4 Audit

Record actor, tenant, correlation.

## 35.5 Rule

Async boundary must preserve security intent safely.

---

# 36. Idempotency and Async

## 36.1 Client retry

If request times out, client may retry.

## 36.2 If operation started

Need idempotency key or job resource.

## 36.3 Pattern

```http
POST /exports
Idempotency-Key: abc
```

Return same operation resource for duplicate key.

## 36.4 Rule

Async start endpoints need retry-safe semantics.

---

# 37. Resource Leaks

Suspended responses can leak if never resumed/cancelled.

## 37.1 Leak sources

- event never arrives;
- timeout not set;
- registry not cleaned;
- worker exception swallowed;
- client disconnect ignored;
- executor queue stuck.

## 37.2 Defenses

- timeout;
- completion callback cleanup;
- bounded registry;
- shutdown cleanup;
- metrics for suspended count.

## 37.3 Rule

AsyncResponse is a resource. Manage lifecycle explicitly.

---

# 38. Memory Safety: Suspended Response Registry

Long-poll or event waiters often store `AsyncResponse`.

## 38.1 Bad

```java
List<AsyncResponse> waiters = new ArrayList<>();
```

Unbounded and not thread-safe.

## 38.2 Better

```java
BlockingQueue<AsyncWaiter> waiters = new ArrayBlockingQueue<>(1000);
```

## 38.3 Waiter object

Store minimal metadata:

```java
record AsyncWaiter(
    String id,
    AsyncResponse response,
    Instant expiresAt,
    CurrentActor actor
) {}
```

## 38.4 Cleanup

Remove on:

- completion;
- timeout;
- cancellation;
- disconnect;
- shutdown.

## 38.5 Rule

Never keep unbounded suspended responses.

---

# 39. Async Job API Design

For long work, model as resource.

## 39.1 Start

```http
POST /report-jobs
```

Response:

```http
202 Accepted
Location: /report-jobs/J123
Retry-After: 5
```

## 39.2 Status

```http
GET /report-jobs/J123
```

## 39.3 Result

```http
GET /reports/R123/download
```

or link in status.

## 39.4 Cancel

```http
POST /report-jobs/J123/cancellations
```

or:

```http
DELETE /report-jobs/J123
```

depending semantics.

## 39.5 Rule

Long-running work should be durable resource, not hanging HTTP request.

---

# 40. Status Resource Design

## 40.1 Fields

```json
{
  "id": "J123",
  "status": "running",
  "progress": 45,
  "submittedAt": "2026-06-12T10:00:00Z",
  "startedAt": "2026-06-12T10:00:03Z",
  "completedAt": null,
  "error": null,
  "_links": {
    "self": { "href": "/report-jobs/J123" },
    "cancel": { "href": "/report-jobs/J123/cancellations", "method": "POST" }
  }
}
```

## 40.2 Status enum

```text
accepted
queued
running
succeeded
failed
cancelled
expired
```

## 40.3 Error

Use Problem Details-like embedded object for failure.

## 40.4 Rule

Status resource should be stable and client-pollable.

---

# 41. Cancellation Endpoint Design

## 41.1 POST cancellation subresource

```http
POST /report-jobs/J123/cancellations
```

Good when cancellation is action with audit.

## 41.2 DELETE job

```http
DELETE /report-jobs/J123
```

Good if job resource itself is cancellable/removable.

## 41.3 Response

```http
202 Accepted
```

if cancellation requested.

```http
409 Conflict
```

if already completed and cannot cancel.

## 41.4 Rule

Cancellation is domain semantics; model clearly.

---

# 42. Retry-After and Polling Policy

## 42.1 202 response

```http
Retry-After: 5
```

Tells client suggested polling delay.

## 42.2 503/429

Also use Retry-After for overload.

## 42.3 Backoff

Clients should backoff.

## 42.4 Server should not force high polling rate

Use SSE/webhook if real-time needed.

## 42.5 Rule

Async job APIs should guide client polling.

---

# 43. Async and Observability

Async introduces multi-stage latency:

```text
request received
suspended
queued
started worker
downstream wait
completed
response resumed
response written
```

## 43.1 Need separate metrics

- time suspended;
- queue wait;
- processing time;
- completion status;
- timeout count;
- cancel count;
- executor saturation.

## 43.2 Correlation

Propagate correlation ID into worker logs/traces.

## 43.3 Rule

If you cannot observe async stages, you cannot operate async safely.

---

# 44. Metrics

Suggested metrics:

```text
jaxrs_async_suspended_current
jaxrs_async_suspended_total
jaxrs_async_resumed_total{result}
jaxrs_async_timeout_total
jaxrs_async_cancel_total
jaxrs_async_duration_seconds
executor_queue_size
executor_active_threads
executor_rejected_total
long_poll_waiters_current
```

## 44.1 Labels

Use low-cardinality labels:

- route template;
- async type;
- result;
- timeout/cancel reason.

Avoid request ID/user ID labels.

## 44.2 Rule

Async metrics should expose capacity and lifecycle.

---

# 45. Tracing

## 45.1 Trace span

A request span may need async continuation.

## 45.2 Capture context

OpenTelemetry context must be propagated to worker.

## 45.3 Add events

```text
async.suspended
async.worker.started
async.resumed
async.timeout
async.cancelled
```

## 45.4 Rule

Trace async handoff explicitly.

---

# 46. Logging

## 46.1 Include

- correlation ID;
- route;
- async state;
- duration;
- timeout/cancel reason;
- job ID if applicable.

## 46.2 Do not log

- raw body;
- tokens;
- sensitive payload;
- unbounded stack traces for normal timeout.

## 46.3 MDC

Restore/clear MDC in worker.

## 46.4 Rule

Async logs need context propagation and cleanup.

---

# 47. Testing AsyncResponse

## 47.1 Unit test

Harder because AsyncResponse is interface.

You can use fake implementation to capture `resume`.

## 47.2 Integration test

Better for runtime behavior.

Test:

- request returns after async completion;
- timeout response;
- error mapping;
- cancellation;
- filters/interceptors still run.

## 47.3 Latch

Use `CountDownLatch` to coordinate tests.

## 47.4 Avoid flaky sleeps

Use deterministic triggers.

## 47.5 Rule

Async tests must control timing deterministically.

---

# 48. Testing CompletionStage Methods

## 48.1 Success

Return completed future.

```java
CompletableFuture.completedFuture(response)
```

## 48.2 Delayed completion

Use controllable `CompletableFuture`.

## 48.3 Exceptional completion

```java
future.completeExceptionally(new DomainException(...));
```

Assert mapper response.

## 48.4 Timeout

If runtime timeout applies, test separately.

## 48.5 Rule

CompletionStage endpoints are easier to test than manual AsyncResponse if lifecycle is simple.

---

# 49. Testing Timeout and Cancellation

## 49.1 Timeout test

Set short timeout in test.

Assert:

- status;
- Problem Details;
- cleanup called;
- registry empty.

## 49.2 Cancellation test

Trigger application cancel.

Assert:

- 503/Retry-After if using `cancel(retryAfter)`;
- cleanup;
- worker cancellation if supported.

## 49.3 Disconnect test

Harder; may require client closing socket.

## 49.4 Rule

Test cleanup, not only HTTP status.

---

# 50. Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus

## 50.1 Standard behavior

`AsyncResponse`, `@Suspended`, timeout, resume/cancel are standard.

## 50.2 Differences

- connection callback support;
- default timeout config;
- thread model;
- CDI context propagation;
- exception mapping edge cases;
- reactive integration;
- servlet container interaction.

## 50.3 RESTEasy/Jersey extensions

May support extra reactive types or async features.

## 50.4 Rule

Target runtime tests are mandatory for async.

---

# 51. Reactive/Non-Blocking Runtime Caveat

AsyncResponse does not automatically make blocking calls non-blocking.

## 51.1 Blocking worker

If your worker does JDBC blocking IO, it still consumes worker thread.

## 51.2 Reactive stack

Reactive runtimes may prefer:

- non-blocking IO;
- reactive types;
- event-loop safe APIs;
- explicit blocking annotations.

## 51.3 Do not block event loop

In reactive runtimes, blocking on event loop can destroy performance.

## 51.4 Rule

Understand runtime threading model before using async.

---

# 52. Common Failure Modes

## 52.1 No timeout

Suspended connection leaks.

## 52.2 Worker exception swallowed

Client hangs until timeout.

## 52.3 Raw thread per request

Thread explosion.

## 52.4 Unbounded executor queue

Memory blow-up.

## 52.5 No backpressure

Latency collapse under load.

## 52.6 Double resume race

Confusing logs/errors.

## 52.7 Context lost

No correlation ID/security/tenant in worker.

## 52.8 Request-scoped bean used in worker

Context error.

## 52.9 Holding DB transaction while suspended

Locks/resource leak.

## 52.10 Long report held as suspended request

Gateway timeout.

## 52.11 Registry not cleaned

Memory leak.

## 52.12 Async used to hide slow design

Still slow, just harder to debug.

---

# 53. Best Practices

## 53.1 Prefer synchronous for simple fast endpoints

Avoid unnecessary complexity.

## 53.2 Prefer CompletionStage for simple async composition

Cleaner than manual AsyncResponse.

## 53.3 Use AsyncResponse for manual lifecycle/long polling

When you need suspend/resume control.

## 53.4 Use 202 job resource for long-running durable work

Do not hold connection for minutes.

## 53.5 Always set timeout

And custom timeout response.

## 53.6 Use bounded executor/queue

Define overload response.

## 53.7 Capture context explicitly

Actor, tenant, correlation, locale.

## 53.8 Register cleanup callbacks

Completion/disconnect.

## 53.9 Never hold transaction while suspended

Open transaction only inside work unit.

## 53.10 Test target runtime

Async edge cases vary.

---

# 54. Anti-Patterns

## 54.1 Async everything

Unnecessary complexity.

## 54.2 `new Thread()` in resource method

Not production.

## 54.3 Infinite suspended response without cleanup

Leak.

## 54.4 Swallow exception in worker

Client waits forever.

## 54.5 Unbounded list of AsyncResponse

Memory leak.

## 54.6 No executor metrics

Blind operations.

## 54.7 Using async to bypass gateway timeout

Won't work.

## 54.8 Domain job hidden as open HTTP connection

Poor reliability.

## 54.9 Using request-scoped entity manager in worker

Context/transaction bug.

## 54.10 No idempotency for async start

Duplicate jobs on retry.

---

# 55. Production Checklist

## 55.1 Design

- [ ] Async is justified.
- [ ] Chosen model: sync / CompletionStage / AsyncResponse / 202 job.
- [ ] Long work uses job resource, not suspended request.
- [ ] Timeout budget aligned with gateway/client.
- [ ] Cancellation semantics defined.
- [ ] Retry/idempotency strategy defined.

## 55.2 Runtime/lifecycle

- [ ] Explicit timeout set.
- [ ] TimeoutHandler set.
- [ ] CompletionCallback cleanup.
- [ ] ConnectionCallback considered.
- [ ] Registry bounded.
- [ ] Shutdown handling defined.
- [ ] Double-completion handled.

## 55.3 Executor/backpressure

- [ ] Bounded executor.
- [ ] Bounded queue.
- [ ] Rejection mapped to 503/429.
- [ ] Metrics for executor.
- [ ] Pool sizing tested.
- [ ] No raw thread per request.

## 55.4 Context/security

- [ ] CurrentActor captured.
- [ ] Tenant captured.
- [ ] Correlation ID propagated.
- [ ] MDC restored/cleared.
- [ ] No request-scoped bean used unsafely.
- [ ] Authorization re-check policy defined for long jobs.

## 55.5 Error/observability

- [ ] Worker errors resume response.
- [ ] Exception mappers work.
- [ ] Async metrics.
- [ ] Trace propagation.
- [ ] Logs include correlation ID.
- [ ] Sensitive data not logged.

## 55.6 Tests

- [ ] Success async test.
- [ ] Timeout test.
- [ ] Cancellation test.
- [ ] Error mapping test.
- [ ] Cleanup test.
- [ ] Executor rejection test.
- [ ] Context propagation test.
- [ ] Runtime/gateway timeout test.

---

# 56. Latihan

## Latihan 1 — Basic AsyncResponse

Implement:

```http
GET /async/hello
```

Resource suspends response and resumes from executor after controlled trigger.

Test success.

## Latihan 2 — Timeout Handler

Set timeout 1 second.

Return Problem Details:

```text
ASYNC_TIMEOUT
```

Assert cleanup.

## Latihan 3 — Double Resume Race

Simulate worker completion and timeout racing.

Ensure only one response wins and logs are safe.

## Latihan 4 — Bounded Executor

Create bounded executor.

When queue full, return:

```http
503 Service Unavailable
Retry-After: 5
```

## Latihan 5 — Context Propagation

Capture correlation ID and CurrentActor.

Verify worker log/trace has them.

## Latihan 6 — CompletionStage Endpoint

Implement:

```java
public CompletionStage<CustomerResponse> get(...)
```

Test success and exceptional completion.

## Latihan 7 — Long Polling

Implement long-poll messages endpoint:

- max 100 waiters;
- timeout 25s;
- 204 if no message;
- cleanup on completion.

## Latihan 8 — 202 Job API

Create export job endpoint:

- POST starts job;
- returns 202 + Location + Retry-After;
- GET status;
- GET result when done.

## Latihan 9 — Client Disconnect

Integration test that closes client connection.

Verify cleanup/cancellation callback if runtime supports.

---

# 57. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 Specification — Asynchronous Processing  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

2. Jakarta RESTful Web Services API — `AsyncResponse`  
   https://jakarta.ee/specifications/restful-ws/3.1/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/asyncresponse

3. Jakarta RESTful Web Services API — `Suspended`  
   https://jakarta.ee/specifications/restful-ws/3.1/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/suspended

4. Jakarta RESTful Web Services API — `TimeoutHandler`  
   https://jakarta.ee/specifications/restful-ws/3.1/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/timeouthandler

5. Jakarta RESTful Web Services API — `CompletionCallback`  
   https://jakarta.ee/specifications/restful-ws/3.1/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/completioncallback

6. Jakarta RESTful Web Services API — `ConnectionCallback`  
   https://jakarta.ee/specifications/restful-ws/3.1/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/connectioncallback

7. Jakarta RESTful Web Services 4.0 Specification — CompletionStage resource methods  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

8. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

---

# 58. Penutup

Server-side async di JAX-RS adalah alat penting, tetapi mudah disalahgunakan.

Mental model final:

```text
Synchronous:
  resource returns response now.

AsyncResponse:
  resource suspends connection and resumes manually later.

CompletionStage:
  resource returns future/stage; runtime resumes when completed.

202 job:
  resource starts durable operation and returns status URI.
```

Prinsip final:

```text
Async releases request thread.
It does not remove work.
It does not remove capacity limits.
It does not replace background job design.
```

Top-tier JAX-RS engineer memastikan:

- async dipakai hanya ketika sesuai;
- timeout eksplisit;
- cancellation dan disconnect dipikirkan;
- executor bounded;
- backpressure jelas;
- context propagation aman;
- transaction tidak digantung;
- worker errors selalu menyelesaikan response;
- long jobs dimodelkan sebagai operation resources;
- metrics/tracing/logging membuktikan lifecycle async bisa dioperasikan.

Part berikutnya:

```text
Bagian 025 — Server-Sent Events / SSE
```

Kita akan membahas SSE secara mendalam: event stream, `Sse`, `SseEventSink`, broadcaster, reconnect, last-event-id, heartbeat, backpressure, auth, proxy buffering, and production streaming.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 023 — Hypermedia and Links: `Link`, HATEOAS, Practical REST Maturity, `Location`, `Content-Location`, Pagination Links, Action Affordances, dan API Evolvability](./learn-jaxrs-advanced-part-023.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Bagian 025 — Server-Sent Events / SSE: `Sse`, `SseEventSink`, `SseBroadcaster`, Event Stream Protocol, Reconnect, `Last-Event-ID`, Heartbeat, Backpressure, Auth, Proxy Buffering, dan Production Streaming](./learn-jaxrs-advanced-part-025.md)

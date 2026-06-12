# learn-java-concurrency-and-reactive-part-024.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 024  
# Concurrency in Web Applications and Spring Boot: Servlet Threads, Virtual Threads, Async Execution, WebFlux, JDBC, HTTP Clients, Context, Timeouts, and Production Governance

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **024**  
> Fokus: memahami concurrency di aplikasi web Java dan Spring Boot. Kita akan membahas request lifecycle, servlet container threads, virtual threads di Spring Boot, `spring.threads.virtual.enabled`, `@Async`, `TaskExecutor`, schedulers, Spring MVC vs WebFlux, blocking vs non-blocking, JDBC, HTTP clients, transaction boundary, security/MDC/tenant context, timeouts, bulkheads, backpressure, graceful shutdown, observability, testing, dan migration strategy.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model Concurrency di Web App](#2-mental-model-concurrency-di-web-app)
3. [Request Lifecycle](#3-request-lifecycle)
4. [Servlet Stack: Thread-per-Request](#4-servlet-stack-threadperrequest)
5. [Platform Threads di Servlet Containers](#5-platform-threads-di-servlet-containers)
6. [Spring MVC Blocking Model](#6-spring-mvc-blocking-model)
7. [Spring Boot dan Virtual Threads](#7-spring-boot-dan-virtual-threads)
8. [`spring.threads.virtual.enabled`](#8-springthreadsvirtualenabled)
9. [Apa yang Berubah Saat Virtual Threads Enabled](#9-apa-yang-berubah-saat-virtual-threads-enabled)
10. [Apa yang Tidak Berubah](#10-apa-yang-tidak-berubah)
11. [Tomcat, Jetty, Undertow: Container Considerations](#11-tomcat-jetty-undertow-container-considerations)
12. [`@Async` and TaskExecutor](#12-async-and-taskexecutor)
13. [VirtualThreadTaskExecutor and SimpleAsyncTaskExecutor](#13-virtualthreadtaskexecutor-and-simpleasynctaskexecutor)
14. [Scheduling with Virtual Threads](#14-scheduling-with-virtual-threads)
15. [Spring MVC Async APIs](#15-spring-mvc-async-apis)
16. [WebFlux and Reactive Model](#16-webflux-and-reactive-model)
17. [Spring MVC + Virtual Threads vs WebFlux](#17-spring-mvc--virtual-threads-vs-webflux)
18. [JDBC and Transaction Boundaries](#18-jdbc-and-transaction-boundaries)
19. [Connection Pool Governance](#19-connection-pool-governance)
20. [HTTP Client Governance](#20-http-client-governance)
21. [Timeouts and Deadlines](#21-timeouts-and-deadlines)
22. [Bulkheads in Web Applications](#22-bulkheads-in-web-applications)
23. [Backpressure and Admission Control](#23-backpressure-and-admission-control)
24. [Request Fan-Out](#24-request-fanout)
25. [CPU-Bound Work in Request Handlers](#25-cpubound-work-in-request-handlers)
26. [ThreadLocal, MDC, SecurityContext, TenantContext](#26-threadlocal-mdc-securitycontext-tenantcontext)
27. [Context Propagation with `@Async`](#27-context-propagation-with-async)
28. [Scoped Values in Web Apps](#28-scoped-values-in-web-apps)
29. [Error Handling and Cancellation](#29-error-handling-and-cancellation)
30. [Graceful Shutdown](#30-graceful-shutdown)
31. [Observability](#31-observability)
32. [Testing Web Concurrency](#32-testing-web-concurrency)
33. [Load Testing and Capacity Planning](#33-load-testing-and-capacity-planning)
34. [Migration Strategy](#34-migration-strategy)
35. [Mini Case Study: Blocking MVC Endpoint](#35-mini-case-study-blocking-mvc-endpoint)
36. [Mini Case Study: Virtual Thread Migration Causes DB Saturation](#36-mini-case-study-virtual-thread-migration-causes-db-saturation)
37. [Mini Case Study: `@Async` Loses MDC/Security Context](#37-mini-case-study-async-loses-mdcsecurity-context)
38. [Common Anti-Patterns](#38-common-antipatterns)
39. [Best Practices](#39-best-practices)
40. [Decision Matrix](#40-decision-matrix)
41. [Latihan](#41-latihan)
42. [Ringkasan](#42-ringkasan)
43. [Referensi](#43-referensi)

---

# 1. Tujuan Bagian Ini

Web application adalah tempat concurrency Java paling sering terasa nyata.

Setiap request adalah unit kerja.

Dalam satu request, aplikasi bisa:

- baca body;
- autentikasi;
- cek tenant;
- query database;
- panggil downstream HTTP;
- publish event;
- tulis audit;
- render response;
- log correlation ID;
- menjalankan async side task.

Pertanyaan concurrency-nya:

```text
Thread apa yang menjalankan request?
Apa yang terjadi jika request blocking?
Apa bedanya Spring MVC, virtual threads, WebFlux?
Apakah @Async aman untuk context?
Bagaimana membatasi DB/HTTP concurrency?
Bagaimana request timeout membatalkan child work?
Bagaimana graceful shutdown menunggu in-flight requests?
```

Target bagian ini:

```text
Mampu mendesain Spring Boot web application yang scalable,
aman terhadap overload, jelas context boundary-nya,
dan siap migration ke virtual threads atau reactive model.
```

---

# 2. Mental Model Concurrency di Web App

Web app punya beberapa concurrency boundary:

```text
client connections
server acceptor/event loops
request handling threads/tasks
application service calls
DB/HTTP/cache pools
async executors
schedulers
message/event publishers
```

Setiap boundary punya capacity.

Contoh:

```text
Tomcat request handling
  -> controller
      -> service
          -> JDBC pool
          -> downstream HTTP pool
          -> @Async executor
```

Jika satu boundary tidak dibatasi, overload pindah ke boundary lain.

## 2.1 Main rule

```text
Web concurrency is end-to-end capacity design, not just server thread count.
```

---

# 3. Request Lifecycle

Simplified Spring MVC request:

```text
socket accepted
container maps request
filter chain
security filters
dispatcher servlet
controller
service
repository/client
response written
filters complete
thread/task released
```

Concurrency context often binds at filter level:

- MDC;
- SecurityContext;
- tenant context;
- request attributes;
- transaction context later at service/repository.

## 3.1 Context boundary

A filter/interceptor is a natural place to create and clear request context.

## 3.2 Main rule

```text
Bind request-scoped context at entry, clear/close it at exit.
```

---

# 4. Servlet Stack: Thread-per-Request

Traditional servlet model:

```text
one request handled by one container thread
```

If code blocks on DB:

```text
thread blocks
```

Platform thread-per-request scales until thread count becomes bottleneck.

Virtual threads let the same blocking style scale better by making request thread lightweight.

## 4.1 Main rule

```text
Servlet MVC is naturally thread-per-request; virtual threads make that model cheaper.
```

---

# 5. Platform Threads di Servlet Containers

Traditional container config:

```text
max threads = e.g. 200
accept count
connection timeout
```

This acts as:

- request concurrency limit;
- accidental backpressure;
- protection for DB/downstream;
- latency trade-off.

## 5.1 Problem

If 200 platform threads all block on slow DB, new requests queue.

## 5.2 Benefit

The limit also prevents 10,000 requests hitting DB at once.

## 5.3 Main rule

```text
Platform thread limits are both bottleneck and accidental bulkhead.
```

---

# 6. Spring MVC Blocking Model

Spring MVC service code is usually imperative:

```java
@GetMapping("/cases/{id}")
CaseDto getCase(@PathVariable String id) {
    CaseEntity entity = caseRepository.findById(id).orElseThrow();
    UserDto user = userClient.load(entity.userId());
    return mapper.toDto(entity, user);
}
```

This is easy to read.

But it blocks:

- JDBC;
- HTTP;
- file;
- locks.

With platform threads, too much blocking consumes container threads.

With virtual threads, blocking is cheaper but resources still limited.

## 6.1 Main rule

```text
Spring MVC + blocking I/O is simple.
Virtual threads improve thread scalability, not dependency capacity.
```

---

# 7. Spring Boot dan Virtual Threads

Spring Boot can enable virtual threads for supported application task execution.

Spring Boot documentation says virtual threads require Java 21 or later, recommends Java 24 or later for the best experience, and enables them via:

```properties
spring.threads.virtual.enabled=true
```

The same documentation warns to consider official Java virtual threads documentation before enabling, because some applications can experience lower throughput due to pinned virtual threads, detectable with JFR or `jcmd`.

## 7.1 Why Boot property matters

It lets Boot auto-configure relevant executors/container integration to use virtual threads where supported.

## 7.2 Main rule

```text
spring.threads.virtual.enabled=true is a platform-level concurrency change.
Treat it as architecture migration, not cosmetic config.
```

---

# 8. `spring.threads.virtual.enabled`

Example:

```properties
spring.threads.virtual.enabled=true
```

YAML:

```yaml
spring:
  threads:
    virtual:
      enabled: true
```

## 8.1 Requirements

- Java 21+;
- modern Spring Boot version supporting virtual threads;
- compatible libraries;
- load testing.

## 8.2 What to review before enabling

- JDBC pool;
- HTTP client pool;
- locks/synchronized;
- ThreadLocal usage;
- request timeout;
- task executors;
- schedulers;
- CPU-heavy endpoints;
- observability.

## 8.3 Main rule

```text
Enable virtual threads only after auditing downstream and shared-resource limits.
```

---

# 9. Apa yang Berubah Saat Virtual Threads Enabled

Depending Boot/server/framework integration:

## 9.1 Request handling may use virtual threads

Blocking MVC request code can run on virtual threads.

## 9.2 Async task execution may use virtual threads

Boot task execution auto-configuration can use virtual-thread based executor.

## 9.3 Scheduling behavior may change

Spring Boot task scheduling has virtual-thread behavior when enabled in supported configurations.

## 9.4 Thread pool properties may become less relevant

Traditional max worker thread properties may not limit virtual-thread concurrency the way platform worker pools did.

## 9.5 Main rule

```text
Virtual-thread enablement may remove old thread-pool bottlenecks and expose real resource bottlenecks.
```

---

# 10. Apa yang Tidak Berubah

Virtual threads do not change:

- DB max connections;
- database CPU;
- row locks;
- downstream API quotas;
- memory limits;
- CPU core count;
- lock contention;
- transaction semantics;
- security requirements;
- timeout requirements;
- business idempotency.

## 10.1 Main rule

```text
Virtual threads change request execution cost, not system capacity law.
```

---

# 11. Tomcat, Jetty, Undertow: Container Considerations

Different embedded servers integrate differently.

In practice, always check current Spring Boot and server documentation.

## 11.1 Tomcat

Spring Boot can configure request handling with virtual threads when enabled.

## 11.2 Thread properties

Some traditional server thread properties may only apply to platform thread executors and not behave as expected with virtual threads.

## 11.3 Main rule

```text
Do not assume old servlet thread-pool config remains your request concurrency limit after virtual-thread migration.
```

---

# 12. `@Async` and TaskExecutor

`@Async` runs method on a `TaskExecutor`.

Example:

```java
@Async
public CompletableFuture<Void> sendEmail(EmailCommand command) {
    emailClient.send(command);
    return CompletableFuture.completedFuture(null);
}
```

## 12.1 Questions

- Which executor?
- Is it bounded?
- Does it propagate context?
- Does it have timeout?
- What happens on failure?
- Is work durable?
- Does caller wait?

## 12.2 Main rule

```text
@Async is not a durability or reliability mechanism.
It is executor-based method dispatch.
```

---

# 13. VirtualThreadTaskExecutor and SimpleAsyncTaskExecutor

Spring Framework has virtual-thread support in task executors.

`VirtualThreadTaskExecutor` is an `AsyncTaskExecutor` based on virtual threads in JDK 21+, with thread name prefix as its main configuration option.

`SimpleAsyncTaskExecutor` also supports a virtual threads option on JDK 21+, graceful shutdown via task termination timeout with task-tracking overhead, and a concurrency limit; its default number of concurrent task executions is unlimited.

## 13.1 Danger

Unlimited task executions can overload downstream resources.

## 13.2 Main rule

```text
Virtual-thread task executors still need resource bulkheads and failure policy.
```

---

# 14. Scheduling with Virtual Threads

Scheduled jobs can trigger work.

If scheduler starts virtual-thread tasks, capacity still matters.

Bad:

```text
every minute schedule 10,000 virtual-thread jobs
```

without DB/API limits.

## 14.1 Scheduled overlap

Ensure previous run completed or define overlap policy.

## 14.2 Main rule

```text
Scheduling creates producers; producers need backpressure and overlap control.
```

---

# 15. Spring MVC Async APIs

Spring MVC supports async request processing patterns such as:

- `Callable`;
- `DeferredResult`;
- `WebAsyncTask`;
- `SseEmitter`.

These can release container thread while work continues elsewhere.

## 15.1 With virtual threads

Some reasons to use MVC async purely to avoid platform thread blocking become less compelling.

But async MVC still useful for:

- long polling;
- SSE;
- deferred external event;
- timeout handling;
- streaming response.

## 15.2 Main rule

```text
Virtual threads reduce need for async MVC only when the goal was avoiding blocking thread cost.
```

---

# 16. WebFlux and Reactive Model

Spring WebFlux uses reactive model.

Best fit:

- non-blocking I/O;
- streaming;
- backpressure;
- many long-lived connections;
- reactive database/client stack;
- event pipelines.

## 16.1 Do not block event loop

Blocking in event-loop thread is a serious bug.

## 16.2 Use boundedElastic or virtual-thread-capable scheduler if appropriate

When bridging blocking code, isolate it.

## 16.3 Main rule

```text
WebFlux is about non-blocking/backpressure semantics, not just more threads.
```

---

# 17. Spring MVC + Virtual Threads vs WebFlux

## 17.1 MVC + virtual threads

Good for:

- imperative service code;
- blocking JDBC;
- blocking clients;
- finite request/response;
- simpler migration.

## 17.2 WebFlux

Good for:

- reactive end-to-end;
- streaming;
- backpressure;
- non-blocking drivers;
- high connection counts with low per-request blocking.

## 17.3 Not simply “newer is better”

Choose based on workload and team expertise.

## 17.4 Main rule

```text
MVC + virtual threads optimizes blocking imperative code.
WebFlux optimizes non-blocking asynchronous streams.
```

---

# 18. JDBC and Transaction Boundaries

Spring transactions often bind resources to current thread.

In MVC request thread, this works naturally.

But with `@Async`:

```java
@Transactional
public void handle() {
    asyncService.doAsync();
}
```

The async method runs on another thread and does not automatically share same transaction.

## 18.1 Best practice

Async work should start its own transaction if needed.

Pass immutable command/ID, not live entity.

## 18.2 Main rule

```text
Transaction context is thread-bound and scope-bound.
Do not assume it crosses @Async or executor boundaries.
```

---

# 19. Connection Pool Governance

Hikari or other pools define real DB concurrency.

Virtual threads can create more waiting requests.

Track:

- active connections;
- idle connections;
- pending acquisitions;
- connection timeout;
- query duration;
- transaction duration.

## 19.1 Add DB bulkhead if needed

```java
Semaphore dbPermits = new Semaphore(50);
```

## 19.2 Main rule

```text
DB connection pool is a capacity boundary.
Do not let virtual-thread concurrency turn it into an unbounded waiting room.
```

---

# 20. HTTP Client Governance

For downstream clients, configure:

- connect timeout;
- response timeout;
- connection pool;
- max per route;
- retry budget;
- circuit breaker;
- semaphore bulkhead;
- rate limit.

## 20.1 Per-client wrapper

```java
final class LimitedDownstreamClient {
    private final Semaphore permits;

    Response call(Request request, Duration timeout) throws Exception {
        if (!permits.tryAcquire(20, TimeUnit.MILLISECONDS)) {
            throw new ServiceBusyException("downstream bulkhead full");
        }
        try {
            return delegate.call(request, timeout);
        } finally {
            permits.release();
        }
    }
}
```

## 20.2 Main rule

```text
Every downstream dependency needs its own timeout and concurrency budget.
```

---

# 21. Timeouts and Deadlines

Request timeout should become execution deadline.

```java
record RequestContext(
    String correlationId,
    TenantId tenantId,
    Instant deadline
) {
    Duration remaining() {
        Duration d = Duration.between(Instant.now(), deadline);
        return d.isNegative() ? Duration.ZERO : d;
    }
}
```

## 21.1 Use everywhere

- DB query timeout;
- HTTP request timeout;
- future get timeout;
- semaphore acquire timeout;
- queue offer timeout.

## 21.2 Main rule

```text
A web request has one budget; every child operation spends from it.
```

---

# 22. Bulkheads in Web Applications

Use bulkheads for:

- DB;
- each downstream;
- CPU-heavy endpoint;
- report generation;
- file/object storage;
- notification provider;
- per-tenant capacity.

## 22.1 Bulkhead response

When full:

- fail fast;
- fallback;
- return 503/429;
- degrade optional feature.

## 22.2 Main rule

```text
Bulkheads turn overload into controlled failure instead of global collapse.
```

---

# 23. Backpressure and Admission Control

At web boundary:

```java
if (!admission.tryAcquire(5, TimeUnit.MILLISECONDS)) {
    return ResponseEntity.status(503).build();
}
```

## 23.1 Useful for expensive endpoints

Not all endpoints equal.

Use endpoint-specific admission.

## 23.2 Avoid all-requests-global-only

Global limit can starve critical endpoints.

## 23.3 Main rule

```text
Admission control should reflect endpoint cost and priority.
```

---

# 24. Request Fan-Out

Controller/service may call multiple dependencies.

With virtual threads/structured concurrency:

```java
Dashboard getDashboard(RequestContext context, UserId userId) throws Exception {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        var profile = scope.fork(() -> profileClient.load(context, userId));
        var cases = scope.fork(() -> caseClient.summary(context, userId));
        var sla = scope.fork(() -> slaClient.summary(context, userId));

        scope.join();
        scope.throwIfFailed();

        return new Dashboard(profile.get(), cases.get(), sla.get());
    }
}
```

## 24.1 Production additions

- deadline;
- bulkhead per client;
- optional failure policy;
- cancellation;
- tracing.

## 24.2 Main rule

```text
Fan-out multiplies dependency load; design it with strict budgets.
```

---

# 25. CPU-Bound Work in Request Handlers

Bad:

```java
@GetMapping("/report")
Report report() {
    return generateHugeReport(); // CPU-heavy
}
```

With many concurrent requests, CPU saturates.

## 25.1 Better

- bounded CPU executor;
- admission control;
- async job for huge reports;
- cache;
- precompute;
- return 202 Accepted.

## 25.2 Main rule

```text
Virtual threads do not make CPU-heavy request processing scalable.
```

---

# 26. ThreadLocal, MDC, SecurityContext, TenantContext

Spring ecosystem uses thread-bound context in places.

Examples:

- MDC;
- Spring Security context;
- transaction synchronization;
- request attributes;
- locale context.

## 26.1 With virtual threads

Request-per-virtual-thread can reduce platform thread reuse leak, but:

- ThreadLocal still must be scoped;
- child tasks may not inherit context automatically;
- heavy ThreadLocal values are dangerous;
- async boundaries require propagation.

## 26.2 Main rule

```text
Thread-bound context must be audited at every async/thread boundary.
```

---

# 27. Context Propagation with `@Async`

`@Async` changes thread.

MDC/security/tenant context may be missing.

## 27.1 Solutions

- pass explicit immutable command/context;
- use TaskDecorator for context capture/restore;
- use framework-supported security context propagation;
- avoid relying on request-scoped objects after request ends.

## 27.2 Example principle

```java
record AuditCommand(
    TenantId tenantId,
    UserId userId,
    String correlationId,
    AuditEvent event
) {}
```

Pass command to async worker.

## 27.3 Main rule

```text
Async work should receive explicit immutable context if it may outlive request thread.
```

---

# 28. Scoped Values in Web Apps

For Java versions/framework integrations that support it, Scoped Values can model immutable request context.

Concept:

```java
ScopedValue.where(CONTEXT, requestContext)
    .run(() -> filterChain.doFilter(request, response));
```

## 28.1 Good for

- correlation ID;
- tenant ID;
- user snapshot;
- deadline.

## 28.2 Not for

- live `HttpServletRequest`;
- mutable maps;
- ORM entity;
- transaction resource.

## 28.3 Main rule

```text
Scoped Values are good for immutable request metadata, not mutable framework objects.
```

---

# 29. Error Handling and Cancellation

When request fails or times out:

- cancel child tasks;
- close response properly;
- release semaphore permits;
- rollback transaction;
- stop retries;
- record outcome.

## 29.1 HTTP status

Map overload/timeouts:

```text
429 Too Many Requests
503 Service Unavailable
504 Gateway Timeout
```

depending semantics.

## 29.2 Main rule

```text
Request failure should stop request-scoped work and release all resources.
```

---

# 30. Graceful Shutdown

Spring Boot supports graceful shutdown configuration, but application tasks still need to cooperate.

During shutdown:

- stop accepting traffic;
- finish in-flight requests within grace period;
- stop schedulers;
- stop async executors;
- close DB pools;
- close HTTP clients;
- flush logs/metrics.

## 30.1 Virtual threads are daemon

Ensure lifecycle owners wait/close properly.

## 30.2 Main rule

```text
Graceful shutdown requires both framework lifecycle and task cancellation discipline.
```

---

# 31. Observability

Metrics:

## 31.1 Web

- request count;
- concurrency;
- p95/p99;
- error status;
- timeout;
- rejection.

## 31.2 Executors

- active tasks;
- queued tasks;
- completed;
- failed;
- rejected.

## 31.3 Virtual threads

- pinned events;
- scheduler queue;
- thread count if available.

## 31.4 DB

- active/idle/pending connections;
- connection wait;
- query time;
- transaction time.

## 31.5 HTTP

- in-flight;
- connection wait;
- downstream latency;
- timeout/retry/circuit open.

## 31.6 Context

- missing correlation;
- tenant mismatch;
- security context missing.

## 31.7 Main rule

```text
Web concurrency observability must show waits at each resource boundary.
```

---

# 32. Testing Web Concurrency

Test:

## 32.1 Context cleanup

Request A context does not leak into request B.

## 32.2 `@Async` context

Async task receives expected explicit context.

## 32.3 Timeout

Slow downstream returns expected HTTP status.

## 32.4 Bulkhead full

Endpoint fails fast.

## 32.5 Transaction boundary

Async task starts own transaction.

## 32.6 Shutdown

In-flight request drains or cancels correctly.

## 32.7 Main rule

```text
Concurrency tests should simulate thread reuse, async boundaries, and overload.
```

---

# 33. Load Testing and Capacity Planning

Load test scenarios:

- normal load;
- DB slow;
- DB pool saturated;
- downstream slow;
- downstream 500;
- high fan-out;
- high CPU endpoint;
- virtual threads enabled/disabled comparison;
- cancellation storm;
- shutdown under load.

## 33.1 Measure

- throughput;
- p99;
- DB wait;
- HTTP wait;
- GC;
- CPU;
- memory;
- virtual-thread diagnostics;
- retries;
- rejections.

## 33.2 Main rule

```text
Do not enable virtual threads broadly without overload load tests.
```

---

# 34. Migration Strategy

## 34.1 Step 1: Inventory blocking

JDBC, HTTP, file, locks, synchronized, ThreadLocal.

## 34.2 Step 2: Inventory limits

Server threads, DB pool, HTTP pool, executor pools, queues.

## 34.3 Step 3: Add explicit resource controls

Bulkheads, timeouts, rate limits.

## 34.4 Step 4: Enable per environment or canary

Feature flag/config.

## 34.5 Step 5: Compare metrics

Before/after.

## 34.6 Step 6: Roll out gradually

Endpoint by endpoint or service by service.

## 34.7 Main rule

```text
Virtual-thread migration is capacity migration, not just thread migration.
```

---

# 35. Mini Case Study: Blocking MVC Endpoint

## 35.1 Endpoint

```java
@GetMapping("/dashboard")
Dashboard dashboard() {
    User user = userClient.load();
    Cases cases = caseClient.load();
    return new Dashboard(user, cases);
}
```

## 35.2 Platform thread issue

Many requests block platform threads.

## 35.3 Virtual thread improvement

Request handler can block without occupying platform worker one-to-one.

## 35.4 Still needed

- timeout per client;
- bulkhead per client;
- deadline;
- optional fallback;
- metrics.

## 35.5 Lesson

```text
Virtual threads make blocking MVC more scalable, but not self-protecting.
```

---

# 36. Mini Case Study: Virtual Thread Migration Causes DB Saturation

## 36.1 Before

```text
container max threads = 200
DB pool = 50
```

## 36.2 After

Virtual threads allow far more concurrent request work.

Symptoms:

- DB pool pending grows;
- connection timeout;
- p99 spikes;
- retries worsen DB load.

## 36.3 Fix

- endpoint admission;
- DB bulkhead;
- query timeout;
- reduce transaction duration;
- optimize DB;
- tune pool carefully;
- rate limit expensive endpoints.

## 36.4 Lesson

```text
Removing thread bottleneck exposes DB bottleneck.
```

---

# 37. Mini Case Study: `@Async` Loses MDC/Security Context

## 37.1 Problem

Controller sets MDC/security context.

`@Async` method logs without correlation ID or runs without expected principal.

## 37.2 Cause

Different thread.

## 37.3 Fix

- pass explicit context;
- configure TaskDecorator;
- use framework security context propagation;
- avoid request object in async task.

## 37.4 Lesson

```text
Async boundary is context boundary.
```

---

# 38. Common Anti-Patterns

## 38.1 Enabling virtual threads without DB/HTTP audit

Overload.

## 38.2 Assuming server max threads still protects DB

May not.

## 38.3 `@Async` fire-and-forget for important work

Lost failure/durability.

## 38.4 Blocking inside WebFlux event loop

Reactive meltdown.

## 38.5 Parallel stream in request handler

Common pool contention.

## 38.6 Huge CPU work in virtual-thread request

CPU saturation.

## 38.7 No timeouts

Stuck requests.

## 38.8 No context cleanup

Leak/stale context.

## 38.9 Passing JPA entity to async method

Transaction/thread boundary bug.

## 38.10 Single global bulkhead

No dependency isolation.

---

# 39. Best Practices

## 39.1 Match model to workload

MVC+virtual threads for blocking imperative; WebFlux for reactive streams.

## 39.2 Add explicit resource limits

DB/HTTP/CPU.

## 39.3 Use deadlines

One request budget.

## 39.4 Avoid hidden async

Make `@Async` semantics explicit.

## 39.5 Pass immutable context across async boundaries

No live request/entity.

## 39.6 Use structured concurrency for request fan-out

When available.

## 39.7 Protect CPU-heavy endpoints

CPU bulkhead/job model.

## 39.8 Monitor waits

DB wait, HTTP wait, semaphore wait.

## 39.9 Load test overload

Not just happy path.

## 39.10 Roll out gradually

Canary and rollback.

---

# 40. Decision Matrix

| Situation | Recommended |
|---|---|
| Blocking Spring MVC + JDBC | MVC + virtual threads candidate, with DB limits |
| Reactive streaming endpoint | WebFlux |
| Long-lived SSE | MVC async or WebFlux depending stack |
| `@Async` important durable work | durable queue/job table |
| `@Async` best-effort notification | explicit command + error handling |
| DB pool saturation | DB bulkhead, query optimization, admission |
| Downstream slow | timeout + bulkhead + circuit breaker |
| CPU-heavy report | bounded CPU executor or async job |
| Tenant/security context | explicit immutable context or scoped context |
| MDC in async | TaskDecorator or explicit logging context |
| Parallel stream in request | avoid or bound CPU explicitly |
| Virtual-thread migration | audit resources and load test |

---

# 41. Latihan

## Latihan 1 — Resource Inventory

Untuk satu Spring MVC endpoint, daftar semua resource boundary: DB, HTTP, CPU, queue, lock.

## Latihan 2 — Enable Virtual Threads Plan

Buat checklist sebelum menambahkan `spring.threads.virtual.enabled=true`.

## Latihan 3 — DB Bulkhead

Implementasikan service wrapper dengan semaphore untuk repository call.

## Latihan 4 — Downstream Client

Tambahkan timeout, bulkhead, retry budget ke HTTP client wrapper.

## Latihan 5 — `@Async` Context

Refactor `@Async` method agar menerima immutable command dengan tenant/user/correlation ID.

## Latihan 6 — WebFlux Blocking Bug

Jelaskan kenapa blocking repository call di event loop WebFlux berbahaya.

## Latihan 7 — CPU Endpoint

Desain endpoint report besar agar tidak saturate CPU.

## Latihan 8 — Deadline

Buat request context dengan deadline dan gunakan di DB/HTTP/semaphore acquire.

## Latihan 9 — Load Test

Buat skenario load test untuk virtual-thread migration.

## Latihan 10 — Observability Dashboard

Buat daftar panel dashboard untuk web concurrency production.

---

# 42. Ringkasan

Concurrency di Spring Boot web applications adalah desain end-to-end, bukan hanya pemilihan thread model.

Core lessons:

- Web app punya banyak capacity boundary: request handling, DB, HTTP, executors, queues, CPU.
- Servlet/MVC naturally thread-per-request.
- Platform thread limits sering menjadi accidental bulkhead.
- Spring Boot dapat mengaktifkan virtual threads dengan `spring.threads.virtual.enabled=true`.
- Virtual threads membuat blocking MVC lebih scalable dari sisi thread, tetapi tidak menambah DB/API/CPU capacity.
- Traditional server thread config mungkin tidak lagi menjadi request concurrency limit yang sama.
- `@Async` adalah executor dispatch, bukan durability mechanism.
- Virtual-thread task executors tetap butuh resource governance.
- WebFlux adalah model reactive/non-blocking dengan backpressure semantics.
- MVC + virtual threads cocok untuk imperative blocking workloads.
- WebFlux cocok untuk non-blocking streaming/reactive workloads.
- Transaction context tidak otomatis cross async boundaries.
- Connection pool tetap capacity boundary.
- HTTP clients perlu timeout, pool, bulkhead, rate limit, circuit breaker.
- Deadline harus dipropagasikan ke semua child operations.
- Bulkheads dan admission control mencegah overload.
- CPU-heavy endpoints perlu bounded CPU executor/job model.
- ThreadLocal/MDC/Security/Tenant context harus diaudit di async boundaries.
- Scoped Values cocok untuk immutable request metadata jika stack mendukung.
- Graceful shutdown butuh framework lifecycle + cooperative task cancellation.
- Observability harus melihat wait time di setiap resource.
- Migration ke virtual threads harus incremental dan load-tested.

Main rule:

```text
In Spring Boot web apps, virtual threads make blocking request code cheaper,
but production scalability still comes from explicit limits:
DB pool, HTTP bulkheads, CPU pools, deadlines, cancellation,
context boundaries, and observability.
```

---

# 43. Referensi

1. Spring Boot Reference — Virtual Threads  
   https://docs.spring.io/spring-boot/reference/features/spring-application.html#features.spring-application.virtual-threads

2. Spring Boot Reference — Task Execution and Scheduling  
   https://docs.spring.io/spring-boot/reference/features/task-execution-and-scheduling.html

3. Spring Framework Reference — Task Execution and Scheduling  
   https://docs.spring.io/spring-framework/reference/integration/scheduling.html

4. Spring Framework API — `VirtualThreadTaskExecutor`  
   https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/task/VirtualThreadTaskExecutor.html

5. Spring Framework API — `SimpleAsyncTaskExecutor`  
   https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/task/SimpleAsyncTaskExecutor.html

6. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

7. OpenJDK JEP 505 — Structured Concurrency  
   https://openjdk.org/jeps/505

8. OpenJDK JEP 506 — Scoped Values  
   https://openjdk.org/jeps/506

9. Java SE 25 — `Executors.newVirtualThreadPerTaskExecutor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html#newVirtualThreadPerTaskExecutor()

10. Java SE 25 — `StructuredTaskScope`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html

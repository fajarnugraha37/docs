# learn-java-concurrency-and-reactive-part-015.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 015  
# Designing Applications with Virtual Threads: Architecture, Resource Governance, Request Handling, Fan-Out, JDBC, HTTP, Timeouts, Bulkheads, Migration, and Production Readiness

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **015**  
> Fokus: mendesain aplikasi production dengan virtual threads. Bagian sebelumnya membahas fundamental dan internal virtual threads. Bagian ini fokus ke arsitektur: thread-per-request, thread-per-task, blocking style, resource limits, database pool, HTTP clients, fan-out, structured concurrency preview, cancellation, deadlines, bulkheads, backpressure, observability, testing, migration dari platform-thread pool/CompletableFuture/reactive, dan checklist readiness.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Dari “Bisa Pakai Virtual Thread” ke “Aplikasi Aman dengan Virtual Thread”](#2-dari-bisa-pakai-virtual-thread-ke-aplikasi-aman-dengan-virtual-thread)
3. [Architecture Mental Model](#3-architecture-mental-model)
4. [Virtual Threads Are an Execution Model, Not an Architecture by Themselves](#4-virtual-threads-are-an-execution-model-not-an-architecture-by-themselves)
5. [When Virtual Threads Fit](#5-when-virtual-threads-fit)
6. [When Virtual Threads Do Not Fit](#6-when-virtual-threads-do-not-fit)
7. [Thread-per-Request Design](#7-thread-per-request-design)
8. [Thread-per-Task Design](#8-thread-per-task-design)
9. [Do Not Pool Virtual Threads](#9-do-not-pool-virtual-threads)
10. [Bound Resources Explicitly](#10-bound-resources-explicitly)
11. [Database Design with Virtual Threads](#11-database-design-with-virtual-threads)
12. [JDBC and Connection Pools](#12-jdbc-and-connection-pools)
13. [HTTP Client Design](#13-http-client-design)
14. [Fan-Out / Fan-In Design](#14-fan-out--fan-in-design)
15. [Timeouts and Deadlines](#15-timeouts-and-deadlines)
16. [Cancellation and Interruption](#16-cancellation-and-interruption)
17. [Bulkheads](#17-bulkheads)
18. [Backpressure and Admission Control](#18-backpressure-and-admission-control)
19. [Rate Limiting](#19-rate-limiting)
20. [Retries and Idempotency](#20-retries-and-idempotency)
21. [CPU-Bound Work in Virtual-Thread Apps](#21-cpu-bound-work-in-virtual-thread-apps)
22. [Locks and Shared State](#22-locks-and-shared-state)
23. [ThreadLocal, MDC, Security, Tenant Context](#23-threadlocal-mdc-security-tenant-context)
24. [Scoped Values and Explicit Context](#24-scoped-values-and-explicit-context)
25. [Structured Concurrency Preview](#25-structured-concurrency-preview)
26. [Virtual Threads and CompletableFuture](#26-virtual-threads-and-completablefuture)
27. [Virtual Threads and Reactive Systems](#27-virtual-threads-and-reactive-systems)
28. [Designing Service Layers](#28-designing-service-layers)
29. [Designing Repositories](#29-designing-repositories)
30. [Designing Clients](#30-designing-clients)
31. [Designing Background Jobs](#31-designing-background-jobs)
32. [Designing Batch Processing](#32-designing-batch-processing)
33. [Observability](#33-observability)
34. [Testing Strategy](#34-testing-strategy)
35. [Load Testing Strategy](#35-load-testing-strategy)
36. [Migration Strategy](#36-migration-strategy)
37. [Production Readiness Checklist](#37-production-readiness-checklist)
38. [Mini Case Study: Case Dashboard Endpoint](#38-mini-case-study-case-dashboard-endpoint)
39. [Mini Case Study: Notification Sender](#39-mini-case-study-notification-sender)
40. [Mini Case Study: CSV Import with DB Enrichment](#40-mini-case-study-csv-import-with-db-enrichment)
41. [Common Anti-Patterns](#41-common-anti-patterns)
42. [Best Practices](#42-best-practices)
43. [Decision Matrix](#43-decision-matrix)
44. [Latihan](#44-latihan)
45. [Ringkasan](#45-ringkasan)
46. [Referensi](#46-referensi)

---

# 1. Tujuan Bagian Ini

Virtual threads membuat ini mudah:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<Response> future = executor.submit(() -> client.call());
    return future.get();
}
```

Tetapi aplikasi production tidak hanya butuh “bisa menjalankan banyak blocking tasks”.

Aplikasi production butuh:

- resource governance;
- request deadlines;
- cancellation;
- backpressure;
- bulkheads;
- observability;
- failure semantics;
- retry/idempotency;
- transaction boundary;
- security/tenant context;
- predictable p95/p99 latency;
- graceful shutdown;
- migration plan.

Bagian ini menjawab:

```text
Bagaimana mendesain aplikasi yang benar-benar cocok dengan virtual threads?
Bagaimana menghindari incident ketika concurrency tiba-tiba naik drastis?
Bagaimana mengganti accidental platform-thread limits dengan explicit resource limits?
```

---

# 2. Dari “Bisa Pakai Virtual Thread” ke “Aplikasi Aman dengan Virtual Thread”

Membuat virtual thread itu mudah.

Mendesain aplikasi high-concurrency dengan virtual thread tidak semudah itu.

Sebelum virtual threads:

```text
platform thread pool size = accidental concurrency limit
```

Setelah virtual threads:

```text
concurrency bisa meningkat drastis
```

Akibatnya bottleneck pindah ke:

- DB connection pool;
- DB locks;
- downstream HTTP APIs;
- rate limits;
- shared locks;
- memory;
- ThreadLocal values;
- CPU-bound sections.

## 2.1 Main rule

```text
Virtual threads remove one limit.
Production architecture must replace it with the right explicit limits.
```

---

# 3. Architecture Mental Model

Desain aplikasi virtual-thread-friendly bisa dilihat sebagai stack:

```text
Request admission
  -> virtual thread per request/task
      -> service logic in blocking style
          -> resource guards
              -> DB/HTTP/cache/message broker
          -> deadlines/timeouts
          -> cancellation/interruption
          -> observability
```

Virtual threads menyederhanakan **execution style**.

Tetapi capacity tetap dikontrol oleh:

```text
admission + bulkheads + timeouts + rate limits + resource pools
```

## 3.1 Think in budgets

Untuk setiap request:

```text
time budget
resource budget
concurrency budget
retry budget
memory budget
```

## 3.2 Main rule

```text
Virtual-thread design is budget-driven blocking architecture.
```

---

# 4. Virtual Threads Are an Execution Model, Not an Architecture by Themselves

Salah:

```text
Kita pakai virtual threads, berarti architecture sudah modern.
```

Benar:

```text
Virtual threads adalah pilihan execution model.
Architecture tetap harus mendefinisikan boundaries.
```

Boundaries:

- request boundary;
- transaction boundary;
- downstream boundary;
- async job boundary;
- cancellation boundary;
- context boundary;
- resource boundary.

## 4.1 Main rule

```text
Virtual threads simplify how work runs,
not what the work means.
```

---

# 5. When Virtual Threads Fit

Virtual threads cocok jika workload:

## 5.1 Blocking I/O-heavy

- JDBC;
- blocking HTTP clients;
- file/object storage;
- Redis/blocking cache clients;
- legacy SDKs.

## 5.2 Request/response

One request does finite work and returns result.

## 5.3 Existing imperative codebase

Service code already written blocking style.

## 5.4 Fan-out to multiple services

Each subtask can block independently.

## 5.5 Need readable stack traces

Direct call stack matters.

## 5.6 Existing async code too complex

CompletableFuture/reactive used only to avoid blocking platform threads.

## 5.7 Main rule

```text
Virtual threads fit best when code is naturally blocking and task lifetime is finite.
```

---

# 6. When Virtual Threads Do Not Fit

Virtual threads are not primary solution for:

## 6.1 CPU-bound parallelism

Use bounded CPU pool/ForkJoin/parallel algorithm.

## 6.2 Infinite event streams

Reactive/stream processing may fit better.

## 6.3 Backpressure-rich pipelines

Reactive streams may express demand better.

## 6.4 Huge unbounded task creation

Virtual threads still consume memory.

## 6.5 Non-virtual-thread-friendly blocking native libraries

Need test/diagnostics.

## 6.6 Work that must survive process restart

Use durable queue/job table, not just virtual thread.

## 6.7 Main rule

```text
Virtual threads are excellent for concurrent waiting,
not durable workflow, CPU scaling, or infinite streams by themselves.
```

---

# 7. Thread-per-Request Design

In web apps:

```text
one incoming request -> one virtual thread
```

Controller code can stay direct:

```java
Response handle(Request request) {
    User user = userClient.load(request.userId());
    List<Case> cases = caseRepository.findOpenCases(request.userId());
    return Response.of(user, cases);
}
```

## 7.1 Benefits

- simple code;
- normal try/catch;
- normal stack traces;
- transaction boundaries easier than async graph;
- no callback pyramid.

## 7.2 Risks

- too many concurrent DB calls;
- too many downstream calls;
- hidden ThreadLocal cardinality;
- locks become hot;
- request fan-out explosion.

## 7.3 Main rule

```text
Thread-per-request with virtual threads is simple,
but request admission and downstream limits must be explicit.
```

---

# 8. Thread-per-Task Design

Virtual threads encourage:

```text
one task -> one virtual thread
```

For subtasks:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<A> a = executor.submit(() -> loadA());
    Future<B> b = executor.submit(() -> loadB());

    return combine(a.get(), b.get());
}
```

## 8.1 Good

- short-lived tasks;
- finite scope;
- blocking I/O;
- easy fan-out.

## 8.2 Bad

- millions of tasks submitted blindly;
- tasks not owned;
- no timeout/cancel;
- no resource guard.

## 8.3 Main rule

```text
Thread-per-task is safe when tasks are finite, owned, bounded by resources, and observable.
```

---

# 9. Do Not Pool Virtual Threads

`Executors.newVirtualThreadPerTaskExecutor()` creates a new virtual thread per task; Java SE 25 `Executors` API documents this executor as starting a new virtual thread for each task. 

Bad:

```java
ExecutorService virtualPool =
    Executors.newFixedThreadPool(100, Thread.ofVirtual().factory());
```

This usually reintroduces wrong limit.

## 9.1 What to limit instead

- DB connections;
- HTTP connections;
- downstream concurrent calls;
- CPU worker count;
- memory;
- request admission;
- per-tenant quota.

## 9.2 Main rule

```text
Do not use virtual-thread pools as resource governance.
Use resource-specific governance.
```

---

# 10. Bound Resources Explicitly

Virtual threads are cheap.

Resources are not.

## 10.1 Common resource limits

| Resource | Control |
|---|---|
| DB | connection pool, query timeout, semaphore |
| HTTP downstream | connection pool, semaphore, rate limit |
| CPU | bounded CPU executor |
| memory | bounded task creation, streaming, limits |
| file descriptors | connection limits |
| locks | reduce shared state |
| queues | bounded queues |
| tenant capacity | per-tenant quota |

## 10.2 Main rule

```text
Every external or scarce resource needs an explicit concurrency policy.
```

---

# 11. Database Design with Virtual Threads

Virtual threads often make JDBC code simpler and more scalable from thread perspective.

But DB is usually the real bottleneck.

## 11.1 Watch

- connection acquisition time;
- query latency;
- transaction duration;
- row lock waits;
- deadlocks;
- DB CPU;
- pool saturation;
- max connections;
- retries.

## 11.2 Avoid accidental overload

Before virtual threads, a platform thread pool of 200 may accidentally limit DB pressure.

After virtual threads, 5,000 requests may all reach DB pool.

## 11.3 Main rule

```text
Virtual threads make waiting for DB cheaper,
not database work cheaper.
```

---

# 12. JDBC and Connection Pools

Connection pool remains mandatory.

Example configuration thinking:

```text
maxPoolSize = 50
connectionTimeout = 250ms
queryTimeout = 1s
requestDeadline = 2s
```

## 12.1 Add optional bulkhead

```java
final class DbBulkhead {
    private final Semaphore permits;

    DbBulkhead(int maxConcurrentDbOps) {
        this.permits = new Semaphore(maxConcurrentDbOps);
    }

    <T> T execute(Callable<T> dbCall) throws Exception {
        if (!permits.tryAcquire(100, TimeUnit.MILLISECONDS)) {
            throw new ServiceBusyException("DB bulkhead full");
        }

        try {
            return dbCall.call();
        } finally {
            permits.release();
        }
    }
}
```

## 12.2 Transaction boundaries

Keep transaction short.

Do not perform remote HTTP while holding DB transaction unless intentionally required.

## 12.3 Main rule

```text
With virtual threads, DB pool is no longer protected by thread scarcity.
Protect it explicitly.
```

---

# 13. HTTP Client Design

Blocking HTTP calls are good candidates.

```java
Response response = client.send(request);
```

But configure:

- connect timeout;
- request timeout;
- response timeout;
- max connections;
- max concurrent per route;
- retry policy;
- idempotency;
- circuit breaker;
- bulkhead.

## 13.1 Per-downstream semaphore

```java
final class DownstreamBulkhead {
    private final Semaphore permits = new Semaphore(100);

    Response call(Callable<Response> call) throws Exception {
        if (!permits.tryAcquire(50, TimeUnit.MILLISECONDS)) {
            throw new ServiceBusyException("downstream saturated");
        }

        try {
            return call.call();
        } finally {
            permits.release();
        }
    }
}
```

## 13.2 Main rule

```text
Virtual threads make HTTP fan-out easier.
They do not make downstream services stronger.
```

---

# 14. Fan-Out / Fan-In Design

Fan-out:

```text
one parent request starts multiple child operations
```

Example:

```java
Dashboard = profile + cases + sla + notifications
```

Virtual threads make direct fan-out simple.

## 14.1 Basic executor fan-out

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<Profile> profile = executor.submit(() -> profileClient.load(userId));
    Future<CaseSummary> cases = executor.submit(() -> caseClient.summary(userId));
    Future<SlaSummary> sla = executor.submit(() -> slaClient.summary(userId));

    return new Dashboard(profile.get(), cases.get(), sla.get());
}
```

## 14.2 Missing policies

- deadline;
- cancellation on failure;
- partial result;
- fallback;
- resource limits;
- observability.

## 14.3 Structured concurrency fit

JEP 505 describes structured concurrency as treating groups of related tasks running in different threads as one unit of work, streamlining error handling and cancellation. It is a natural fit for virtual-thread fan-out.

## 14.4 Main rule

```text
Fan-out needs ownership, deadline, cancellation, and resource policy.
Virtual threads only make the execution cheap.
```

---

# 15. Timeouts and Deadlines

Every blocking operation must have time budget.

## 15.1 Timeout

Per operation maximum wait.

```text
HTTP timeout = 500ms
DB query timeout = 1s
```

## 15.2 Deadline

Absolute request budget.

```java
record ExecutionContext(
    Instant deadline,
    String correlationId,
    TenantId tenantId
) {}
```

## 15.3 Remaining time

```java
Duration remaining = Duration.between(Instant.now(), context.deadline());
```

## 15.4 Main rule

```text
Virtual-thread apps need more timeouts, not fewer,
because concurrency can reach more dependencies faster.
```

---

# 16. Cancellation and Interruption

Virtual threads support interrupt.

But cancellation only works if code honors it.

## 16.1 Future cancel

```java
future.cancel(true);
```

Requests interruption.

## 16.2 Blocking clients

Need client timeouts and interrupt behavior.

## 16.3 On parent failure

Cancel child work if no longer needed.

With raw futures:

```java
try {
    return combine(a.get(), b.get());
} catch (Exception e) {
    a.cancel(true);
    b.cancel(true);
    throw e;
}
```

Structured concurrency improves this.

## 16.4 Main rule

```text
Cancellation must propagate from request to child tasks and resources.
```

---

# 17. Bulkheads

Bulkhead isolates capacity per workload/dependency.

## 17.1 Example

```text
payment API limit = 50
document API limit = 100
email API limit = 30
```

Use separate semaphores.

```java
Semaphore paymentPermits = new Semaphore(50);
Semaphore documentPermits = new Semaphore(100);
Semaphore emailPermits = new Semaphore(30);
```

## 17.2 Why

Without bulkhead:

```text
document fan-out can starve payment operations
```

## 17.3 Main rule

```text
Virtual-thread systems need bulkheads because they can generate concurrency very easily.
```

---

# 18. Backpressure and Admission Control

Backpressure controls producer.

## 18.1 Request admission

Limit number of concurrent expensive requests.

```java
Semaphore expensiveEndpoint = new Semaphore(200);
```

## 18.2 Queue admission

Do not submit unbounded tasks.

## 18.3 HTTP response

Return:

```text
429 Too Many Requests
503 Service Unavailable
Retry-After
```

## 18.4 Main rule

```text
Do not accept work that cannot complete within its deadline.
```

---

# 19. Rate Limiting

Rate limiting controls frequency, not just concurrency.

## 19.1 Concurrency limit

```text
max 100 in-flight
```

## 19.2 Rate limit

```text
max 1000 requests/minute
```

## 19.3 Need both

A downstream may require:

- max concurrent calls;
- max calls per second;
- burst limit.

## 19.4 Main rule

```text
Semaphore controls concurrency.
Rate limiter controls pace.
Use the right one or both.
```

---

# 20. Retries and Idempotency

Virtual threads make retry code easy to write:

```java
for (int attempt = 1; attempt <= 3; attempt++) {
    try {
        return client.call(request);
    } catch (TimeoutException e) {
        ...
    }
}
```

But retries can amplify load.

## 20.1 Retry only transient failures

- timeout;
- 503;
- connection reset;
- rate limit.

## 20.2 Use backoff/jitter

Avoid retry storm.

## 20.3 Require idempotency

Especially for side effects:

- payment;
- notification;
- write command;
- external mutation.

## 20.4 Main rule

```text
Virtual threads make blocking retries readable,
but retry policy still needs budget, backoff, and idempotency.
```

---

# 21. CPU-Bound Work in Virtual-Thread Apps

Do not run unbounded CPU-heavy work in virtual threads.

Bad:

```java
for (Input input : inputs) {
    executor.submit(() -> heavyHash(input));
}
```

## 21.1 Use CPU pool

```java
ExecutorService cpuPool = Executors.newFixedThreadPool(
    Runtime.getRuntime().availableProcessors()
);
```

## 21.2 Or batch

Reduce task overhead.

## 21.3 Main rule

```text
In virtual-thread apps, isolate CPU-bound work with bounded CPU parallelism.
```

---

# 22. Locks and Shared State

Virtual threads can expose lock contention.

Example:

```java
synchronized (globalLock) {
    updateGlobalMap();
}
```

If many virtual threads hit it:

```text
one at a time
```

## 22.1 Improve

- immutable snapshots;
- ConcurrentHashMap;
- per-key locks;
- actor ownership;
- reduce critical section;
- avoid blocking inside lock.

## 22.2 Main rule

```text
Virtual threads make waiting cheap, but serialization still limits throughput.
```

---

# 23. ThreadLocal, MDC, Security, Tenant Context

Virtual threads support ThreadLocal, but design carefully.

## 23.1 Request context

If each request has its own virtual thread, request-scoped ThreadLocal is less likely to leak across reused worker threads.

## 23.2 Still cleanup

Cleanup remains good hygiene.

## 23.3 Heavy values

Avoid ThreadLocal buffers/caches.

## 23.4 Async child tasks

Child virtual threads do not automatically receive ordinary ThreadLocal values unless propagated/inheritable/scoped.

## 23.5 Main rule

```text
Use ThreadLocal for compatibility, but prefer explicit or scoped immutable context for new designs.
```

---

# 24. Scoped Values and Explicit Context

JEP 506 introduces scoped values to share immutable data with callees and child threads; it describes scoped values as easier to reason about than thread-local variables and lower cost especially with virtual threads and structured concurrency.

## 24.1 Explicit context

```java
service.handle(context, command);
```

## 24.2 Scoped values

```java
ScopedValue.where(CONTEXT, context)
    .run(() -> service.handle(command));
```

## 24.3 When to use

- immutable request context;
- correlation ID;
- tenant ID;
- user snapshot;
- deadline.

## 24.4 Main rule

```text
For immutable request context, prefer explicit context or Scoped Values over mutable ThreadLocal.
```

---

# 25. Structured Concurrency Preview

Structured concurrency is the natural complement to virtual threads.

JEP 505 says structured concurrency treats related tasks in different threads as one unit of work and is a good match for virtual threads, which are cheap enough to represent concurrent units of behavior including I/O.

## 25.1 Why relevant

Fan-out children should:

- belong to parent;
- cancel when parent fails;
- complete before parent returns;
- propagate failure clearly.

## 25.2 Raw Future limitation

Raw futures do not automatically express ownership tree.

## 25.3 Main rule

```text
Virtual threads give cheap child tasks.
Structured concurrency gives parent-child lifecycle semantics.
```

---

# 26. Virtual Threads and CompletableFuture

Use CompletableFuture when:

- API already returns `CompletionStage`;
- async graph is natural;
- non-blocking callback integration;
- composition without occupying current task is needed.

Use virtual threads when:

- blocking code is simpler;
- call stack clarity matters;
- task is finite;
- you need direct exception flow.

## 26.1 Avoid unnecessary async graph

If code is sequential blocking:

```java
User user = userClient.load(id);
Orders orders = orderClient.load(user.id());
```

A virtual thread can run it cleanly.

## 26.2 Main rule

```text
Do not use CompletableFuture solely to avoid blocking platform threads if virtual threads solve that problem more simply.
```

---

# 27. Virtual Threads and Reactive Systems

Reactive remains strong for:

- streams;
- backpressure;
- event-driven pipelines;
- hot publishers;
- non-blocking I/O all the way;
- complex operator chains.

Virtual threads are strong for:

- blocking request/response;
- imperative service logic;
- legacy blocking APIs;
- finite fan-out.

## 27.1 Hybrid systems

Possible:

- reactive edge + blocking virtual thread adapters;
- virtual-thread services consuming messages;
- reactive streams for high-volume data pipelines.

## 27.2 Main rule

```text
Choose reactive for stream/backpressure semantics,
virtual threads for simple concurrent blocking tasks.
```

---

# 28. Designing Service Layers

Service methods should remain direct and clear.

```java
CaseDetails loadCaseDetails(ExecutionContext context, CaseId caseId) {
    Case caseData = caseRepository.find(context.tenantId(), caseId);
    Permissions permissions = permissionClient.load(context.userId(), caseId);
    return assemble(caseData, permissions);
}
```

## 28.1 Avoid hidden context

Prefer context parameter for important data.

## 28.2 Avoid starting unowned tasks

If service starts child tasks, it owns their lifecycle or uses structured scope.

## 28.3 Main rule

```text
Virtual-thread service code should look boring, direct, bounded, and cancellable.
```

---

# 29. Designing Repositories

Repositories using JDBC should:

- rely on connection pool;
- set query timeout;
- keep transactions short;
- avoid remote calls inside transaction;
- avoid streaming huge result into memory;
- use pagination;
- expose connection wait metrics.

## 29.1 Main rule

```text
Repository design under virtual threads is mostly about database capacity discipline.
```

---

# 30. Designing Clients

HTTP/downstream clients should provide:

- timeout;
- retry policy;
- idempotency support;
- bulkhead;
- rate limit;
- circuit breaker;
- metrics;
- correlation propagation.

## 30.1 Client wrapper

```java
final class LimitedClient {
    private final Semaphore permits;
    private final RemoteClient delegate;

    Response call(Request request, Duration timeout) throws Exception {
        if (!permits.tryAcquire(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
            throw new ServiceBusyException();
        }

        try {
            return delegate.call(request, timeout);
        } finally {
            permits.release();
        }
    }
}
```

## 30.2 Main rule

```text
Every blocking client should enforce its own capacity and timeout policy.
```

---

# 31. Designing Background Jobs

Virtual threads can run job subtasks, but job ownership must be durable if job outlives request.

## 31.1 In-memory virtual thread not enough

Bad:

```java
Thread.ofVirtual().start(() -> exportJob(jobId));
```

If process dies, job lost.

## 31.2 Better

- job table;
- queue;
- status;
- progress;
- cancellation;
- retry;
- idempotency.

Virtual threads can execute chunks.

## 31.3 Main rule

```text
Virtual threads execute job work.
They do not provide durable job semantics.
```

---

# 32. Designing Batch Processing

Batch with virtual threads:

- chunk input;
- bound concurrency;
- avoid submitting all tasks at once;
- limit DB/API calls;
- collect partial failures;
- support cancellation;
- persist progress.

## 32.1 Example

```java
Semaphore enrichmentLimit = new Semaphore(100);

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Chunk chunk : chunks) {
        executor.submit(() -> processChunk(chunk, enrichmentLimit));
    }
}
```

Better with bounded producer if chunks huge.

## 32.2 Main rule

```text
Batch + virtual threads still needs chunking and bounded in-flight work.
```

---

# 33. Observability

You need metrics at multiple levels:

## 33.1 Request

- request latency p50/p95/p99;
- concurrent requests;
- timeout count;
- cancellation count.

## 33.2 Virtual tasks

- submitted;
- completed;
- failed;
- duration;
- fan-out size.

## 33.3 Resource

- DB connection wait;
- DB query duration;
- HTTP connection wait;
- downstream latency;
- semaphore wait;
- rate limit rejection.

## 33.4 JVM

- memory;
- GC;
- virtual thread count/diagnostics;
- scheduler queue;
- pinned events;
- lock contention.

## 33.5 Main rule

```text
In virtual-thread systems, resource wait time is often more important than thread count.
```

---

# 34. Testing Strategy

## 34.1 Unit test

Keep service methods direct.

## 34.2 Integration test

Test timeouts and resource guards.

## 34.3 Concurrency test

Use many concurrent virtual tasks.

## 34.4 Cancellation test

Interrupt/cancel request and verify child tasks stop.

## 34.5 Context test

Verify tenant/security/correlation context.

## 34.6 Main rule

```text
Test virtual-thread applications at boundaries:
timeouts, cancellation, resource limits, and context.
```

---

# 35. Load Testing Strategy

Load test before and after migration.

Measure:

- throughput;
- latency p95/p99;
- DB pool wait;
- downstream error rate;
- memory;
- GC;
- lock contention;
- JFR pinned events;
- retries;
- saturation/rejection.

## 35.1 Test overload

Not only happy path.

Scenarios:

- downstream slow;
- DB slow;
- partial outage;
- high fan-out;
- large request payload;
- cancellation storm.

## 35.2 Main rule

```text
Virtual-thread migration without overload testing is incomplete.
```

---

# 36. Migration Strategy

## 36.1 Step 1: Inventory blocking points

- JDBC;
- HTTP;
- file/object storage;
- locks;
- ThreadLocal;
- native calls.

## 36.2 Step 2: Identify accidental limits

- platform thread pool size;
- bounded queue;
- servlet container threads;
- async executor.

## 36.3 Step 3: Replace with explicit limits

- DB pool;
- semaphores;
- rate limits;
- admission.

## 36.4 Step 4: Enable virtual threads for limited path

Start with non-critical endpoint/workload.

## 36.5 Step 5: Observe

Compare metrics.

## 36.6 Step 6: Expand

Incremental rollout.

## 36.7 Main rule

```text
Migrate by workload, not by ideology.
```

---

# 37. Production Readiness Checklist

Before enabling virtual threads broadly, answer:

## 37.1 Workload

- Is it I/O-bound?
- Is task finite?
- Is CPU work bounded?

## 37.2 Resources

- DB pool max?
- HTTP client max?
- downstream rate limits?
- file/socket limits?
- memory budget?

## 37.3 Policies

- timeouts?
- deadlines?
- cancellation?
- retries?
- idempotency?
- bulkheads?
- backpressure?

## 37.4 Context

- ThreadLocal usage audited?
- MDC propagation?
- tenant/security context explicit/scoped?
- transaction boundaries clear?

## 37.5 Observability

- DB wait metrics?
- downstream latency?
- semaphore wait?
- JFR enabled in tests?
- pinned events monitored?
- p99 dashboards?

## 37.6 Operations

- graceful shutdown?
- load test?
- rollback plan?
- feature flag?
- alert thresholds?

## 37.7 Main rule

```text
Virtual-thread readiness is mostly resource-governance readiness.
```

---

# 38. Mini Case Study: Case Dashboard Endpoint

## 38.1 Requirement

Endpoint loads:

- profile;
- open cases;
- SLA;
- notifications.

## 38.2 Design

```java
Dashboard handle(ExecutionContext context, UserId userId) throws Exception {
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        Future<Profile> profile =
            executor.submit(() -> profileClient.load(context, userId));

        Future<CaseSummary> cases =
            executor.submit(() -> caseClient.summary(context, userId));

        Future<SlaSummary> sla =
            executor.submit(() -> slaClient.summary(context, userId));

        Future<NotificationCount> notifications =
            executor.submit(() -> notificationClient.count(context, userId));

        return new Dashboard(
            profile.get(),
            cases.get(),
            sla.get(),
            notifications.get()
        );
    }
}
```

## 38.3 Production improvements

- per-client semaphore;
- request deadline;
- child timeout;
- cancel siblings on critical failure;
- partial fallback for notifications;
- tracing per child;
- structured concurrency later.

## 38.4 Lesson

```text
Virtual threads simplify fan-out syntax,
but production fan-out still needs policies.
```

---

# 39. Mini Case Study: Notification Sender

## 39.1 Requirement

Send notifications via external provider.

## 39.2 Bad

```java
Thread.ofVirtual().start(() -> provider.send(notification));
```

Problems:

- no durable ownership;
- no retry/idempotency;
- no rate limit;
- failure lost;
- JVM exit risk.

## 39.3 Better

- persist notification command;
- worker picks pending notifications;
- virtual threads send concurrently;
- semaphore/rate limit per provider;
- idempotency key;
- retry with backoff;
- DLQ/manual review.

## 39.4 Lesson

```text
Virtual threads are execution workers, not durable messaging semantics.
```

---

# 40. Mini Case Study: CSV Import with DB Enrichment

## 40.1 Requirement

Import 1 million rows. Each row may call DB and HTTP enrichment.

## 40.2 Bad

```java
for (Row row : rows) {
    executor.submit(() -> enrichAndSave(row));
}
```

Potentially 1 million virtual threads/tasks.

## 40.3 Better

- chunk rows;
- bounded in-flight chunks;
- semaphore for DB;
- semaphore for HTTP;
- collect errors;
- persist progress;
- cancellation flag;
- retry transient enrichment only.

## 40.4 Lesson

```text
Virtual threads need batching and in-flight limits for large batch workloads.
```

---

# 41. Common Anti-Patterns

## 41.1 One-line migration

Switch executor to virtual threads without resource review.

## 41.2 Virtual thread pool

Fixed pool using virtual thread factory.

## 41.3 Unbounded fan-out

One request creates thousands of downstream calls.

## 41.4 No DB bulkhead

DB pool becomes global queue.

## 41.5 No timeouts

Virtual threads wait forever cheaply until memory/resources suffer.

## 41.6 CPU-heavy work unbounded

No throughput gain.

## 41.7 Heavy ThreadLocal cache

Memory explosion.

## 41.8 Fire-and-forget virtual thread

Lost failure and lifecycle bug.

## 41.9 Ignoring cancellation

Work continues after request timeout.

## 41.10 Reactive-to-virtual rewrite without backpressure replacement

Loses demand control.

---

# 42. Best Practices

## 42.1 Use direct blocking style intentionally

Let code be simple.

## 42.2 Add explicit resource limits

Semaphores/pools/rate limits.

## 42.3 Use deadlines

Propagate request budget.

## 42.4 Use timeouts

Every DB/HTTP call.

## 42.5 Avoid unbounded task creation

Batch/stream/bound.

## 42.6 Keep CPU work bounded

Separate CPU executor.

## 42.7 Prefer immutable context

Explicit context or Scoped Values.

## 42.8 Use structured concurrency for fan-out

When available/appropriate.

## 42.9 Observe resource waits

Not only request latency.

## 42.10 Roll out gradually

Feature flag, canary, load test.

---

# 43. Decision Matrix

| Design Question | Recommendation |
|---|---|
| Blocking JDBC request handler? | Good virtual-thread candidate with DB limits |
| Blocking HTTP fan-out? | Good candidate with per-downstream bulkheads |
| CPU-heavy computation? | Use bounded CPU executor |
| Infinite reactive stream? | Keep reactive/stream model |
| Async code only avoids blocking? | Consider virtual-thread simplification |
| Need durable background work? | Use queue/job table; virtual threads as workers |
| Many child tasks under one request? | Use structured concurrency where possible |
| Tenant/security context? | explicit or Scoped Value |
| Heavy ThreadLocal buffers? | avoid |
| Existing DB pool was protected by small thread pool? | add explicit DB bulkhead before migration |
| Need per-request timeout? | deadline propagated to all blocking calls |
| Downstream has rate limit? | rate limiter + semaphore |
| Huge batch? | chunk and bound in-flight chunks |

---

# 44. Latihan

## Latihan 1 — Endpoint Readiness

Ambil satu endpoint I/O-heavy. Daftar semua DB/HTTP/cache calls dan limit yang harus ada sebelum virtual-thread migration.

## Latihan 2 — DB Bulkhead

Implementasikan wrapper `DbBulkhead` dengan `Semaphore` dan timed acquire.

## Latihan 3 — Deadline Context

Buat `ExecutionContext` dengan deadline dan method `remaining()`.

## Latihan 4 — Fan-Out

Tulis dashboard fan-out dengan virtual-thread executor dan tambahkan cancellation sibling manual.

## Latihan 5 — CPU Isolation

Refactor CPU-heavy JSON/report generation agar memakai bounded CPU executor.

## Latihan 6 — ThreadLocal Audit

Daftar semua ThreadLocal yang ada di aplikasi dan klasifikasikan: logging, security, tenant, transaction, cache.

## Latihan 7 — Batch Bound

Desain CSV import dengan max 100 in-flight enrichment tasks.

## Latihan 8 — Retry Budget

Buat retry policy dengan max attempts, deadline, backoff, dan idempotency key.

## Latihan 9 — Load Test Plan

Buat skenario load test: normal, DB slow, downstream 503, high fan-out, cancellation storm.

## Latihan 10 — Migration Plan

Buat 6 langkah migrasi endpoint dari platform thread pool ke virtual threads.

---

# 45. Ringkasan

Virtual threads memudahkan desain aplikasi blocking high-concurrency, tetapi production safety tetap bergantung pada resource governance.

Core lessons:

- Virtual threads adalah execution model, bukan architecture lengkap.
- Cocok untuk finite blocking I/O tasks.
- Tidak cocok sebagai solusi utama CPU-bound/infinite stream/durable workflow.
- Thread-per-request menjadi scalable jika resource dibatasi.
- Thread-per-task bagus untuk finite owned subtasks.
- Jangan pool virtual threads.
- Batasi DB, HTTP, CPU, memory, rate, dan request admission.
- JDBC tetap butuh connection pool, timeout, dan short transactions.
- HTTP clients tetap butuh timeout, bulkhead, retry, idempotency, dan rate limit.
- Fan-out membutuhkan deadline, cancellation, fallback, dan observability.
- Cancellation harus interrupt-aware dan resource-aware.
- Bulkheads mencegah satu dependency/workload menghancurkan lainnya.
- Backpressure harus eksplisit karena platform-thread limit lama mungkin hilang.
- CPU-bound work harus dipisah ke bounded CPU executor.
- ThreadLocal harus diaudit; prefer explicit context atau Scoped Values.
- Structured concurrency adalah pasangan natural virtual threads untuk parent-child subtasks.
- Migration harus incremental, measured, dan didahului resource limit design.

Main rule:

```text
Design virtual-thread applications as simple blocking code
wrapped in strict resource governance:
timeouts, deadlines, bulkheads, admission control,
cancellation, observability, and explicit context.
```

---

# 46. Referensi

1. Oracle Java SE 25 Guide — Virtual Threads  
   https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html

2. Java SE 25 — `Executors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html

3. Java SE 25 — `ExecutorService`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html

4. Java SE 25 — `Thread`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html

5. Java SE 25 — `Semaphore`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html

6. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

7. OpenJDK JEP 505 — Structured Concurrency  
   https://openjdk.org/jeps/505

8. OpenJDK JEP 506 — Scoped Values  
   https://openjdk.org/jeps/506

9. OpenJDK JEP 491 — Synchronize Virtual Threads without Pinning  
   https://openjdk.org/jeps/491

10. Java SE 25 — `CompletableFuture`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 014](./learn-java-concurrency-and-reactive-part-014.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 016](./learn-java-concurrency-and-reactive-part-016.md)

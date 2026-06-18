# learn-java-jakarta-part-022.md

# Bagian 22 — Jakarta Concurrency (`jakarta.enterprise.concurrent`): Managed Threads, Async Task, Context Propagation, dan Resource Safety

> Target pembaca: Java engineer yang ingin memahami concurrency di Jakarta EE secara benar: bukan sekadar `new Thread(...)`, tetapi **managed concurrency** yang menjaga integritas container, context propagation, lifecycle, security context, classloader, JNDI, transaction boundary, cancellation, scheduled execution, dan observability.
>
> Fokus bagian ini: Jakarta Concurrency 3.1, `ManagedExecutorService`, `ManagedScheduledExecutorService`, `ContextService`, `ManagedThreadFactory`, `ManagedTask`, `ManagedTaskListener`, `Trigger`, `@Asynchronous`, managed executor definitions, context propagation, transaction behavior, cancellation, timeouts, virtual threads, structured concurrency mindset, and production failure modes.

---

## Daftar Isi

1. [Orientasi: Kenapa Tidak Boleh Sembarangan Membuat Thread di Jakarta EE?](#1-orientasi-kenapa-tidak-boleh-sembarangan-membuat-thread-di-jakarta-ee)
2. [Mental Model: Container-Managed Concurrency](#2-mental-model-container-managed-concurrency)
3. [Jakarta Concurrency 3.1 dalam Jakarta EE 11](#3-jakarta-concurrency-31-dalam-jakarta-ee-11)
4. [Jakarta Concurrency vs Java SE Concurrency](#4-jakarta-concurrency-vs-java-se-concurrency)
5. [Dependency, Provider, dan Runtime](#5-dependency-provider-dan-runtime)
6. [Peta API `jakarta.enterprise.concurrent`](#6-peta-api-jakartaenterpriseconcurrent)
7. [`ManagedExecutorService`: Async Task Executor](#7-managedexecutorservice-async-task-executor)
8. [`ManagedScheduledExecutorService`: Scheduled Task Executor](#8-managedscheduledexecutorservice-scheduled-task-executor)
9. [`ManagedThreadFactory`: Managed Thread Creation](#9-managedthreadfactory-managed-thread-creation)
10. [`ContextService`: Contextual Proxy dan Context Propagation](#10-contextservice-contextual-proxy-dan-context-propagation)
11. [Context Propagation: Apa yang Dibawa ke Thread Baru?](#11-context-propagation-apa-yang-dibawa-ke-thread-baru)
12. [Transaction Boundary: Kenapa Transaction Submitter Tidak Otomatis Ikut?](#12-transaction-boundary-kenapa-transaction-submitter-tidak-otomatis-ikut)
13. [`UserTransaction` dalam Managed Task](#13-usertransaction-dalam-managed-task)
14. [Security Context dan Principal Propagation](#14-security-context-dan-principal-propagation)
15. [ClassLoader, JNDI, CDI, dan Request Context](#15-classloader-jndi-cdi-dan-request-context)
16. [`ManagedTask` dan Execution Properties](#16-managedtask-dan-execution-properties)
17. [`ManagedTaskListener`: Observing Task Lifecycle](#17-managedtasklistener-observing-task-lifecycle)
18. [Cancellation, Timeout, dan Interrupt](#18-cancellation-timeout-dan-interrupt)
19. [`CompletableFuture` dan Async Composition](#19-completablefuture-dan-async-composition)
20. [`@Asynchronous` Method](#20-asynchronous-method)
21. [Managed Executor Definition dan Resource Configuration](#21-managed-executor-definition-dan-resource-configuration)
22. [CDI Injection untuk Concurrency Resources](#22-cdi-injection-untuk-concurrency-resources)
23. [Virtual Threads di Jakarta Concurrency 3.1](#23-virtual-threads-di-jakarta-concurrency-31)
24. [Managed Concurrency vs Messaging vs Batch vs Scheduler](#24-managed-concurrency-vs-messaging-vs-batch-vs-scheduler)
25. [Designing Async Boundaries](#25-designing-async-boundaries)
26. [Backpressure dan Bounded Concurrency](#26-backpressure-dan-bounded-concurrency)
27. [Error Handling](#27-error-handling)
28. [Observability: Logging, Metrics, Tracing](#28-observability-logging-metrics-tracing)
29. [Performance Engineering](#29-performance-engineering)
30. [Testing Strategy](#30-testing-strategy)
31. [Production Failure Modes](#31-production-failure-modes)
32. [Best Practices dan Anti-Patterns](#32-best-practices-dan-anti-patterns)
33. [Checklist Review](#33-checklist-review)
34. [Case Study 1: Async Report Generation](#34-case-study-1-async-report-generation)
35. [Case Study 2: Parallel External API Calls](#35-case-study-2-parallel-external-api-calls)
36. [Case Study 3: Scheduled Cleanup yang Salah Desain](#36-case-study-3-scheduled-cleanup-yang-salah-desain)
37. [Case Study 4: Thread Leak karena `Executors.newFixedThreadPool`](#37-case-study-4-thread-leak-karena-executorsnewfixedthreadpool)
38. [Latihan Bertahap](#38-latihan-bertahap)
39. [Mini Project: Jakarta Concurrency Runtime Lab](#39-mini-project-jakarta-concurrency-runtime-lab)
40. [Referensi Resmi](#40-referensi-resmi)

---

# 1. Orientasi: Kenapa Tidak Boleh Sembarangan Membuat Thread di Jakarta EE?

Di Java SE, kamu mungkin terbiasa:

```java
new Thread(() -> doWork()).start();
```

atau:

```java
ExecutorService executor = Executors.newFixedThreadPool(10);
executor.submit(task);
```

Di Jakarta EE, pola ini berbahaya jika dilakukan sembarangan.

Kenapa?

Karena Jakarta EE container mengelola banyak hal di sekitar thread:

- security context;
- naming context / JNDI;
- classloader;
- CDI context;
- transaction context;
- resource lifecycle;
- request/application lifecycle;
- application start/stop;
- monitoring;
- thread pool governance;
- shutdown behavior;
- connection/resource association.

Jika kamu membuat thread sendiri, thread itu berada di luar kontrol container.

## 1.1 Masalah unmanaged thread

Unmanaged thread bisa menyebabkan:

- security context hilang;
- classloader leak saat redeploy;
- JNDI lookup gagal;
- CDI/request context tidak aktif;
- transaction context kacau;
- resource tidak dibersihkan;
- thread tetap hidup setelah application undeploy;
- server shutdown lambat;
- thread pool tidak termonitor;
- resource starvation;
- memory leak;
- unpredictable behavior antar runtime.

## 1.2 Jakarta EE mindset

Di Jakarta EE:

```text
Container owns runtime.
Application asks container for managed resources.
```

Concurrency pun harus dikelola oleh container.

## 1.3 Jakarta Concurrency hadir untuk itu

Jakarta Concurrency menyediakan cara standard untuk:

- submit async task;
- schedule task;
- create managed thread;
- propagate context;
- use Java SE concurrency style safely in Jakarta EE;
- let container manage lifecycle.

## 1.4 Prinsip utama

```text
Do not create unmanaged threads in Jakarta EE application code.
Use managed concurrency resources.
```

---

# 2. Mental Model: Container-Managed Concurrency

Jakarta Concurrency adalah bridge antara Java SE concurrency dan Jakarta EE container.

## 2.1 Java SE world

```text
application creates executor
application owns thread lifecycle
application owns shutdown
application manually propagates context
```

## 2.2 Jakarta EE world

```text
container creates executor
container owns thread lifecycle
container controls shutdown
container propagates selected context
container enforces resource policies
```

## 2.3 Flow

```text
Request thread / component method
  ↓
submit task to ManagedExecutorService
  ↓
container captures component context
  ↓
task executes on managed thread
  ↓
container applies context
  ↓
task completes
  ↓
context restored/cleaned
```

## 2.4 Key concept: contextual task

A task submitted to managed executor can run as extension of the submitting component context.

This matters because task may need:

- application classloader;
- security identity;
- JNDI naming environment;
- CDI integration;
- resource access.

## 2.5 Managed does not mean unlimited

Managed executor is still bounded by runtime configuration.

You need:

- queue limits;
- concurrency limits;
- timeout;
- cancellation;
- monitoring;
- backpressure.

Managed concurrency gives safe integration, not infinite capacity.

---

# 3. Jakarta Concurrency 3.1 dalam Jakarta EE 11

Jakarta Concurrency 3.1 is release for Jakarta EE 11.

Its purpose: allow application components to use concurrency without compromising container integrity while preserving Jakarta EE platform benefits.

## 3.1 Why 3.1 matters

Jakarta EE 11 aligns with modern Java and Jakarta namespace updates.

Concurrency 3.1 includes improvements around:

- injection of concurrency resources;
- context propagation;
- managed executor definitions;
- virtual-thread-friendly execution model in modern runtimes;
- asynchronous method support evolution.

Exact feature support still depends runtime implementation.

## 3.2 Four core managed objects

The specification introduces four primary managed objects:

```text
ManagedExecutorService
ManagedScheduledExecutorService
ContextService
ManagedThreadFactory
```

## 3.3 Core purpose

The spec standardizes:

- centralized manageable executor objects;
- Java SE concurrency utility use in Jakarta EE;
- propagation of container runtime contextual information to other threads.

## 3.4 What it does not guarantee

Jakarta Concurrency does not automatically make async code:

- transactionally atomic;
- idempotent;
- resilient;
- ordered;
- resource bounded;
- safe from race conditions;
- persistent across restart.

You still design these.

## 3.5 Namespace

Modern package:

```java
jakarta.enterprise.concurrent
```

Old Java EE package:

```java
javax.enterprise.concurrent
```

---

# 4. Jakarta Concurrency vs Java SE Concurrency

## 4.1 Java SE

Examples:

```java
Thread
ExecutorService
ScheduledExecutorService
ThreadFactory
CompletableFuture
ForkJoinPool
Timer
```

## 4.2 Jakarta Concurrency equivalents

```text
ExecutorService              → ManagedExecutorService
ScheduledExecutorService     → ManagedScheduledExecutorService
ThreadFactory                → ManagedThreadFactory
manual context propagation   → ContextService
```

## 4.3 Why not plain `ExecutorService`?

Plain executor:

- not known by container;
- not automatically stopped on undeploy;
- no Jakarta context propagation;
- no managed resource governance;
- no standardized runtime configuration.

## 4.4 Why not `ForkJoinPool.commonPool()`?

`CompletableFuture.supplyAsync(...)` without executor uses common pool.

In Jakarta EE, this can run outside container-managed threads.

Bad:

```java
CompletableFuture.supplyAsync(() -> service.doWork());
```

Better:

```java
CompletableFuture.supplyAsync(() -> service.doWork(), managedExecutor);
```

## 4.5 Why not `java.util.Timer`?

Timer creates unmanaged thread and has poor error behavior.

Use `ManagedScheduledExecutorService`.

## 4.6 Still use Java SE constructs?

Yes, but with managed executor/factory and context services.

---

# 5. Dependency, Provider, dan Runtime

## 5.1 Maven dependency

```xml
<dependency>
  <groupId>jakarta.enterprise.concurrent</groupId>
  <artifactId>jakarta.enterprise.concurrent-api</artifactId>
  <version>3.1.0</version>
  <scope>provided</scope>
</dependency>
```

In Jakarta EE 11 runtime, API is typically provided.

## 5.2 API jar is not runtime

API jar does not create managed thread pools.

Runtime/container must provide implementation.

## 5.3 Jakarta EE runtime

Common runtimes may expose default resources:

```text
java:comp/DefaultManagedExecutorService
java:comp/DefaultManagedScheduledExecutorService
java:comp/DefaultContextService
java:comp/DefaultManagedThreadFactory
```

Exact names/config can vary by runtime/spec version.

## 5.4 Resource configuration

Executor behavior is runtime-configured:

- max async;
- queue size;
- hung task threshold;
- context propagation;
- thread priority;
- virtual thread usage;
- rejection policy;
- schedule behavior.

## 5.5 Do not assume all runtimes behave identically

Spec defines contract, but capacity/config/monitoring are vendor/runtime-specific.

Document assumptions.

## 5.6 Provided scope

Avoid packaging API duplicate if container provides it.

---

# 6. Peta API `jakarta.enterprise.concurrent`

Core interfaces/classes:

```text
ManagedExecutorService
ManagedScheduledExecutorService
ManagedThreadFactory
ContextService
ManagedTask
ManagedTaskListener
Trigger
ZonedTrigger
AbortedException
SkippedException
Asynchronous
Asynchronous.Result
ManagedExecutorDefinition
ManagedScheduledExecutorDefinition
ManagedThreadFactoryDefinition
ContextServiceDefinition
```

There is also SPI package:

```text
jakarta.enterprise.concurrent.spi
```

for thread context provider integration.

## 6.1 ManagedExecutorService

Executor for async tasks.

## 6.2 ManagedScheduledExecutorService

Scheduled executor for delayed/periodic tasks.

## 6.3 ContextService

Creates contextual proxies that run with captured context.

## 6.4 ManagedThreadFactory

Creates container-managed threads.

## 6.5 ManagedTask

Optional interface to provide execution metadata/listener/properties.

## 6.6 ManagedTaskListener

Observes lifecycle events of task/future.

## 6.7 Trigger

Advanced scheduling rule.

## 6.8 Asynchronous

Annotation/model for async methods in Jakarta Concurrency.

---

# 7. `ManagedExecutorService`: Async Task Executor

`ManagedExecutorService` extends Java SE `ExecutorService` to submit tasks for execution in Jakarta EE environment.

## 7.1 Basic usage

```java
@Resource
ManagedExecutorService executor;

public Future<String> startWork() {
    return executor.submit(() -> {
        return doWork();
    });
}
```

## 7.2 CDI injection in Jakarta Concurrency 3.1

Modern runtimes may allow:

```java
@Inject
ManagedExecutorService executor;
```

depending default resource availability/config.

## 7.3 Short-duration async tasks

Spec API docs say common use is short-duration asynchronous tasks, such as async methods or async servlet processing.

Do not use managed executor for unbounded long-running daemon loops unless designed and configured.

## 7.4 Submit Runnable

```java
Future<?> future = executor.submit(() -> {
    process();
});
```

## 7.5 Submit Callable

```java
Future<Result> future = executor.submit(() -> {
    return computeResult();
});
```

## 7.6 Execute fire-and-forget

```java
executor.execute(() -> {
    sendMetric();
});
```

Fire-and-forget still needs error logging, timeout, and lifecycle awareness.

## 7.7 Lifecycle methods forbidden

Application must not shut down managed executor.

Calling:

```java
executor.shutdown();
executor.shutdownNow();
executor.awaitTermination(...);
```

throws or is disallowed by managed contract.

The container owns lifecycle.

## 7.8 Transaction behavior

Tasks run without explicit transaction from submitting thread.

If task needs transaction, use `UserTransaction` or call transactional managed service appropriately.

## 7.9 Rejection

Task submission can fail if executor overloaded/stopped.

Handle:

```java
RejectedExecutionException
```

## 7.10 Do not block request blindly

Submitting work and immediately calling:

```java
future.get()
```

inside request can defeat async benefit.

Use only when parallelizing independent work with timeout.

---

# 8. `ManagedScheduledExecutorService`: Scheduled Task Executor

`ManagedScheduledExecutorService` extends scheduled executor behavior in managed environment.

## 8.1 Delayed task

```java
@Resource
ManagedScheduledExecutorService scheduler;

public ScheduledFuture<?> remindLater() {
    return scheduler.schedule(
        () -> sendReminder(),
        10,
        TimeUnit.MINUTES
    );
}
```

## 8.2 Periodic task

```java
scheduler.scheduleAtFixedRate(
    () -> refreshCache(),
    0,
    5,
    TimeUnit.MINUTES
);
```

## 8.3 Fixed rate vs fixed delay

Fixed rate:

```text
try to run according to regular schedule
```

Fixed delay:

```text
wait delay after previous execution completes
```

## 8.4 Avoid overlap

Periodic task can overlap or backlog depending duration/policy.

Design task to avoid concurrent same-job execution if unsafe.

## 8.5 Use Trigger for advanced scheduling

`Trigger` lets applications plug in rules for when/how often a task should run.

## 8.6 Scheduled is not persistent scheduler

Managed scheduled executor is usually in-memory runtime scheduling.

If server restarts, scheduled tasks may be lost unless runtime provides persistence.

For business-critical schedules, use:

- Jakarta Batch job repository;
- database-backed scheduler;
- external scheduler;
- message delayed queue with persistence.

## 8.7 Good use cases

- refresh local cache;
- short delayed task;
- internal periodic housekeeping;
- timeout cleanup;
- temporary retry.

## 8.8 Bad use cases

- legal deadline;
- payroll processing;
- monthly billing source of truth;
- long-running critical batch;
- distributed cluster singleton task without coordination.

---

# 9. `ManagedThreadFactory`: Managed Thread Creation

`ManagedThreadFactory` is a manageable version of Java SE `ThreadFactory`.

## 9.1 Why exists?

Some libraries accept `ThreadFactory` but create their own executor internally.

You can supply managed thread factory so created threads are container-managed.

## 9.2 Basic usage

```java
@Resource
ManagedThreadFactory threadFactory;

Thread t = threadFactory.newThread(() -> {
    doWork();
});
t.start();
```

## 9.3 Prefer executor first

Use `ManagedExecutorService` when possible.

Use `ManagedThreadFactory` when:

- integrating library requiring thread factory;
- custom executor unavoidable;
- need custom thread creation with container context.

## 9.4 Still not free pass

Even managed thread must be controlled:

- lifecycle;
- shutdown;
- interruption;
- error handling;
- resource cleanup.

## 9.5 Avoid long-running unmanaged loops

If you create a managed thread that loops forever, ensure it stops on application shutdown.

## 9.6 Naming

Runtime may name managed threads for monitoring.

If configurable, use descriptive names.

## 9.7 Virtual thread consideration

Modern runtimes may use virtual threads under managed executor/factory. Do not assume; configure/test.

---

# 10. `ContextService`: Contextual Proxy dan Context Propagation

`ContextService` creates contextual objects/proxies.

It captures container context and applies it later when proxy is invoked.

## 10.1 Basic concept

```text
capture context now
  ↓
create proxy around object/callback
  ↓
invoke later on another thread
  ↓
runs with captured context
```

## 10.2 Use cases

- pass callback to non-Jakarta library;
- JMX notification listener;
- message listener callback;
- custom executor integration;
- framework/plugin that invokes later.

## 10.3 Example concept

```java
@Resource
ContextService contextService;

Runnable contextual =
    contextService.createContextualProxy(
        (Runnable) () -> doWork(),
        Runnable.class
    );

someLibrary.registerCallback(contextual);
```

Exact overload/signature depends API version.

## 10.4 Why not just lambda?

Plain lambda invoked later may not have Jakarta context.

Contextual proxy ensures configured context propagation.

## 10.5 ContextService vs ManagedExecutorService

ManagedExecutorService is for submitting tasks to managed executor.

ContextService is for making contextual object to be invoked elsewhere.

## 10.6 Transaction behavior

ContextService can optionally handle transaction context behavior depending configuration. Default behavior in spec includes transaction management rules; read runtime configuration carefully.

## 10.7 Don't capture too much

Context capture can retain references.

Avoid creating contextual proxies and storing forever without lifecycle.

---

# 11. Context Propagation: Apa yang Dibawa ke Thread Baru?

Context propagation means selected container context from submitting/invoking component is applied to task thread.

## 11.1 Common propagated contexts

Specification requires/mentions important contexts such as:

- naming context;
- classloader;
- security information.

Runtime may propagate more:

- CDI context;
- application context;
- locale;
- transaction behavior configuration;
- custom thread context providers.

## 11.2 Security context

If container supports security context, it must propagate it to execution thread according to spec.

## 11.3 Classloader context

Without correct classloader, app classes/resources may not load.

## 11.4 JNDI context

Resource lookup may depend on component naming context.

## 11.5 CDI context

CDI context propagation depends runtime/config and active scopes.

Do not assume request scope survives arbitrary async execution.

## 11.6 Request context caution

After HTTP request ends, request-scoped beans may no longer be valid.

Do not submit task that uses request-scoped object after request completes unless context explicitly supported and safe.

## 11.7 Context is not data copy

If you need business data, pass immutable DTO explicitly.

Bad:

```java
executor.submit(() -> useHttpServletRequest(request));
```

Better:

```java
String userId = currentUser.id();
UUID caseId = command.caseId();

executor.submit(() -> process(userId, caseId));
```

## 11.8 Context propagation cost

Capturing/restoring context has overhead.

Use intentionally.

---

# 12. Transaction Boundary: Kenapa Transaction Submitter Tidak Otomatis Ikut?

Managed executor tasks run outside the transaction scope of submitting thread.

If the submitting thread has active transaction, it is not automatically continued in task.

## 12.1 Why?

Transactions are thread-bound and resource-bound.

Propagating one transaction across async threads is dangerous:

- concurrent access to same transaction;
- unclear commit/rollback ownership;
- resource manager limitations;
- isolation problems.

## 12.2 Example

```java
@Transactional
public void approveCase(CaseId id) {
    caseRepository.approve(id);

    executor.submit(() -> {
        auditRepository.insert(...);
    });

    // transaction commits/rollbacks here
}
```

The async task is not part of the same transaction.

## 12.3 Danger

If main transaction rolls back but async task already ran, audit may record false event.

## 12.4 Correct approach

If side effect depends on DB commit:

- use outbox;
- after-commit hook if supported;
- message queue after commit;
- transactional event/outbox.

## 12.5 Async task transaction

If task needs transaction, start its own transaction:

- call `@Transactional` service from task;
- use `UserTransaction`;
- use container-managed component boundary.

## 12.6 Rule

```text
Async boundary is also consistency boundary.
```

Document it.

---

# 13. `UserTransaction` dalam Managed Task

Managed executor implementations must support user-managed global transaction demarcation using `jakarta.transaction.UserTransaction`.

## 13.1 Example

```java
@Resource
UserTransaction tx;

@Resource
ManagedExecutorService executor;

public Future<?> submit() {
    return executor.submit(() -> {
        try {
            tx.begin();
            doDatabaseWork();
            tx.commit();
        } catch (Exception e) {
            try {
                tx.rollback();
            } catch (Exception rollbackError) {
                e.addSuppressed(rollbackError);
            }
            throw e;
        }
    });
}
```

## 13.2 Prefer `@Transactional` service

Often cleaner:

```java
executor.submit(() -> transactionalWorker.process(command));
```

where:

```java
@ApplicationScoped
public class TransactionalWorker {
    @Transactional
    public void process(Command command) { ... }
}
```

But self-invocation/proxy rules apply.

## 13.3 Transaction timeout

Async tasks must respect transaction timeout.

Long tasks should be split.

## 13.4 Avoid blocking external calls in transaction

Do not hold transaction across slow remote calls.

## 13.5 Error handling

Rollback failure should be logged and attached.

## 13.6 Idempotency

If task can be retried, transaction alone is not enough. Make it idempotent.

---

# 14. Security Context dan Principal Propagation

## 14.1 Submitter identity

A managed task can run with component identity of submitter.

This is useful when task needs security-sensitive resource access.

## 14.2 Example

```java
Principal p = securityContext.getCallerPrincipal();

executor.submit(() -> {
    Principal inside = securityContext.getCallerPrincipal();
    ...
});
```

Depending runtime/context propagation, inside may see submitter principal.

## 14.3 Security caution

Do not assume user authorization remains valid later.

If async task runs after user role revoked, captured context may be stale.

## 14.4 For long-running work

Prefer passing actor identity explicitly and rechecking authorization/state when processing.

## 14.5 Audit

Record:

- submitter;
- task id;
- start/end;
- outcome.

## 14.6 Least privilege

For background system tasks, use service identity rather than arbitrary user context if appropriate.

## 14.7 Don't leak context

Context must be cleared/restored after task. Managed runtime handles configured context, but avoid ThreadLocal leaks in your own code.

---

# 15. ClassLoader, JNDI, CDI, dan Request Context

## 15.1 ClassLoader

Managed threads need correct application classloader.

Unmanaged threads can hold old classloader after redeploy.

This causes classloader leak.

## 15.2 JNDI

JNDI lookup:

```java
InitialContext.doLookup("java:comp/env/...")
```

depends on naming context.

Managed tasks can preserve it.

## 15.3 CDI

Injected beans can be used if context active.

But request/session conversation scopes can be tricky.

## 15.4 Request context

Async task should not depend on `HttpServletRequest` object after request returns.

## 15.5 Copy data

Extract needed data:

```java
record ReportRequest(UserId userId, ReportId reportId, Locale locale) {}
```

Submit that.

## 15.6 Resource handles

Do not pass open `EntityManager`, JDBC `Connection`, `InputStream`, or request object across async boundary.

Open resources inside task.

## 15.7 Serialization

If task may be stored/retried/persisted by provider, ensure data is serializable. Spec default transient executor tasks may not persist across restart.

---

# 16. `ManagedTask` dan Execution Properties

A task submitted to managed executor can optionally implement `ManagedTask`.

## 16.1 Purpose

`ManagedTask` can provide:

- identifying information;
- a `ManagedTaskListener`;
- additional execution properties.

## 16.2 Example concept

```java
public class GenerateReportTask implements Callable<ReportResult>, ManagedTask {

    private final ReportRequest request;

    public GenerateReportTask(ReportRequest request) {
        this.request = request;
    }

    @Override
    public ReportResult call() {
        return generate(request);
    }

    @Override
    public ManagedTaskListener getManagedTaskListener() {
        return new ReportTaskListener(request.reportId());
    }

    @Override
    public Map<String, String> getExecutionProperties() {
        return Map.of(
            ManagedTask.IDENTITY_NAME, "generate-report-" + request.reportId()
        );
    }
}
```

Exact constants/properties should follow API docs.

## 16.3 Task identity

Identity helps monitoring/logging.

## 16.4 Listener

Listener receives lifecycle notifications.

## 16.5 Execution properties

Properties may influence runtime-specific behavior.

Do not rely on non-portable properties without documentation.

## 16.6 Keep task small

Task object should contain immutable request data, not live container resources.

---

# 17. `ManagedTaskListener`: Observing Task Lifecycle

`ManagedTaskListener` monitors the state of a task's `Future`.

## 17.1 Events

Conceptually includes events such as:

- task submitted;
- task starting;
- task done;
- task aborted.

Exact callback names follow API.

## 17.2 Use cases

- metrics;
- logging;
- auditing;
- cleanup;
- task status update;
- tracing.

## 17.3 Example concept

```java
public class ReportTaskListener implements ManagedTaskListener {

    @Override
    public void taskStarting(Future<?> future, ManagedExecutorService executor, Object task) {
        ...
    }

    @Override
    public void taskDone(Future<?> future, ManagedExecutorService executor, Object task, Throwable exception) {
        ...
    }
}
```

## 17.4 Don't do heavy work in listener

Listener should be fast.

## 17.5 Exception in listener

Listener failure should not break task processing unexpectedly.

Log safely.

## 17.6 Observability alternative

You can also wrap task:

```java
executor.submit(() -> {
    long start = clock.millis();
    try {
        return work();
    } finally {
        metrics.record(...);
    }
});
```

---

# 18. Cancellation, Timeout, dan Interrupt

## 18.1 Future cancellation

```java
Future<?> future = executor.submit(task);
future.cancel(true);
```

## 18.2 Interrupt is cooperative

`cancel(true)` may interrupt thread.

Task must cooperate:

```java
if (Thread.currentThread().isInterrupted()) {
    return;
}
```

or handle `InterruptedException`.

## 18.3 Timeout waiting

```java
try {
    Result r = future.get(5, TimeUnit.SECONDS);
} catch (TimeoutException e) {
    future.cancel(true);
}
```

## 18.4 Do not swallow interrupt

Bad:

```java
catch (InterruptedException e) {
    // ignore
}
```

Better:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new TaskCancelledException(e);
}
```

## 18.5 Resource cleanup

Task must cleanup:

- DB connection;
- file handle;
- locks;
- MDC;
- temporary files.

## 18.6 Scheduled cancellation

Cancel scheduled future when no longer needed.

## 18.7 Application shutdown

Container may cancel tasks during application stop.

Task should tolerate cancellation.

---

# 19. `CompletableFuture` dan Async Composition

## 19.1 Use managed executor

Bad:

```java
CompletableFuture.supplyAsync(() -> callService());
```

Uses common pool.

Good:

```java
CompletableFuture.supplyAsync(() -> callService(), managedExecutor);
```

## 19.2 Parallel calls

```java
CompletableFuture<Customer> customer =
    CompletableFuture.supplyAsync(() -> customerClient.get(id), executor);

CompletableFuture<Account> account =
    CompletableFuture.supplyAsync(() -> accountClient.get(id), executor);

return customer.thenCombine(account, Combined::new)
    .orTimeout(3, TimeUnit.SECONDS);
```

## 19.3 Beware blocking join

```java
future.join()
```

blocks current thread.

Use timeouts and bounded concurrency.

## 19.4 Exception handling

```java
future.exceptionally(ex -> fallback());
```

or:

```java
future.handle((value, ex) -> ...)
```

## 19.5 Context propagation

Stages can run on different executors.

Use managed executor in async stages:

```java
thenApplyAsync(fn, executor)
```

## 19.6 Structured thinking

Group async operations by parent request.

Cancel siblings when parent fails if possible.

Java structured concurrency concepts can inspire design even if not directly standardized in Jakarta Concurrency API.

## 19.7 Do not use async to hide slow dependency

If dependency is slow, use timeout, bulkhead, rate limit, caching, circuit breaker.

---

# 20. `@Asynchronous` Method

Jakarta Concurrency 3.1 specification includes asynchronous method support through `jakarta.enterprise.concurrent.Asynchronous`.

## 20.1 Concept

Annotate method to run asynchronously via managed executor.

Example concept:

```java
@ApplicationScoped
public class ReportService {

    @Asynchronous
    public CompletionStage<ReportResult> generate(ReportRequest request) {
        return CompletableFuture.completedFuture(doGenerate(request));
    }
}
```

Exact supported return types and behavior should follow API docs/runtime.

## 20.2 Why useful?

Less boilerplate than explicit executor submit.

## 20.3 Return type

Async methods can return completion-stage-like result or void depending API rules.

## 20.4 Transactional interaction

Spec defines rules when asynchronous method is also annotated with `@Transactional`; supported transactional types are constrained.

Always verify API docs for exact allowed `TxType`.

## 20.5 Rejection

If provider cannot accept async method for execution, caller may receive `RejectedExecutionException`.

## 20.6 Self-invocation issue

Like CDI interceptors, annotation-based async often requires invocation through managed proxy.

Bad:

```java
this.asyncMethod();
```

may not be intercepted.

Good:

```java
@Inject
ReportService selfProxy;
selfProxy.asyncMethod();
```

or call from another bean.

## 20.7 Use explicit executor when control needed

For fine control:

- executor selection;
- timeout;
- future aggregation;
- listener;
- custom task identity;

use `ManagedExecutorService`.

---

# 21. Managed Executor Definition dan Resource Configuration

Jakarta Concurrency supports annotations to define managed objects.

## 21.1 ManagedExecutorDefinition

Example concept:

```java
@ManagedExecutorDefinition(
    name = "java:app/concurrent/reportExecutor",
    maxAsync = 10
)
public class ConcurrencyResources {
}
```

Exact attributes follow API docs.

## 21.2 ManagedScheduledExecutorDefinition

```java
@ManagedScheduledExecutorDefinition(
    name = "java:app/concurrent/scheduler"
)
```

## 21.3 ContextServiceDefinition

Defines context service with context propagation configuration.

## 21.4 ManagedThreadFactoryDefinition

Defines managed thread factory.

## 21.5 Why define resources?

Because different workloads need different executors:

```text
reportExecutor: CPU/IO bounded report generation
emailExecutor: SMTP sends
shortTaskExecutor: low latency async
scheduler: periodic maintenance
```

## 21.6 Avoid one executor for everything

One overloaded executor can cause unrelated features to fail.

## 21.7 Runtime config

Even with annotation, production may override/tune runtime resource.

Document:

- max concurrency;
- queue capacity;
- timeout;
- context propagation;
- virtual thread setting;
- monitoring name.

---

# 22. CDI Injection untuk Concurrency Resources

Jakarta Concurrency 3.1 supports injection of managed resources such as `ManagedExecutorService` and `ContextService` as CDI beans in compatible runtimes.

## 22.1 Example

```java
@Inject
ManagedExecutorService executor;
```

## 22.2 Qualified resources

If multiple executors are defined, qualifiers or resource names may be needed.

Example concept:

```java
@Inject
@ReportExecutor
ManagedExecutorService reportExecutor;
```

depending definition/qualifier support.

## 22.3 `@Resource`

Traditional Jakarta EE style:

```java
@Resource(lookup = "java:app/concurrent/reportExecutor")
ManagedExecutorService reportExecutor;
```

## 22.4 Prefer explicit executor for workload

Do not inject default executor everywhere without capacity design.

## 22.5 Testing

In unit tests, inject plain executor adapter/fake.

In integration tests, test real managed executor.

## 22.6 Constructor injection

Where supported, constructor injection improves testability.

---

# 23. Virtual Threads di Jakarta Concurrency 3.1

Java virtual threads are important in modern Java.

Jakarta Concurrency 3.1 targets Jakarta EE 11 and modern runtimes can expose managed executors backed by virtual threads.

## 23.1 What virtual threads help

Virtual threads reduce cost of blocking operations when many concurrent tasks mostly wait on IO.

Useful for:

- HTTP calls;
- DB waits;
- file IO;
- simple blocking code with high concurrency.

## 23.2 What virtual threads do not fix

They do not fix:

- DB connection pool exhaustion;
- external API rate limits;
- CPU bottleneck;
- lock contention;
- memory pressure;
- transaction timeout;
- bad retry storm;
- unbounded queue.

## 23.3 Managed virtual threads

Important: even if using virtual threads, use container-managed virtual threads/executors.

Do not bypass container by directly using `Thread.ofVirtual()` in Jakarta EE app unless runtime guidance permits.

## 23.4 Pinning/monitoring

Virtual thread performance can be affected by blocking inside synchronized/native code.

Monitor.

## 23.5 Bounded concurrency still needed

Virtual thread makes threads cheap, not downstream capacity infinite.

Use semaphores/bulkheads/rate limits.

## 23.6 Test with target runtime

Do not assume every Jakarta EE runtime uses virtual threads or same configuration.

---

# 24. Managed Concurrency vs Messaging vs Batch vs Scheduler

## 24.1 Managed concurrency

Good for:

- short async tasks;
- parallel calls within request;
- internal delayed task;
- non-persistent async execution.

## 24.2 Messaging

Good for:

- durable async work;
- retry/DLQ;
- decoupling services;
- queue/topic semantics;
- survive process restart.

## 24.3 Batch

Good for:

- long-running jobs;
- checkpoint/restart;
- chunk processing;
- partitioning;
- job repository.

## 24.4 External scheduler

Good for:

- persistent scheduled business jobs;
- cluster coordination;
- cron-like operations;
- deadline-driven workflows.

## 24.5 Decision table

| Requirement | Prefer |
|---|---|
| Run short background calculation | ManagedExecutorService |
| Parallelize 3 API calls in one request | ManagedExecutorService + CompletableFuture |
| Send email reliably after commit | Messaging/outbox |
| Process 10M rows with restart | Jakarta Batch |
| Run daily billing at midnight cluster-wide | Batch/external scheduler |
| Retry with DLQ | Messaging |
| Schedule in-memory cache refresh | ManagedScheduledExecutorService |
| Work must survive server restart | Messaging/Batch/DB scheduler |

## 24.6 Key distinction

Managed executor tasks are generally transient.

Messaging/batch provide durable processing semantics.

---

# 25. Designing Async Boundaries

## 25.1 Async boundary changes semantics

When you call async, you split:

```text
caller transaction
caller security timing
error propagation
response timing
resource lifecycle
```

## 25.2 Questions before async

1. Who owns task result?
2. Where is status stored?
3. What if task fails?
4. Can task be retried?
5. Is task idempotent?
6. Does task need transaction?
7. Does task need user context?
8. What if app shuts down?
9. What if executor rejects?
10. How is task observed?

## 25.3 Fire-and-forget is dangerous

If result matters, it is not fire-and-forget.

Store task record.

## 25.4 Task identity

Give every significant async task an ID.

```text
taskId
correlationId
submittedBy
businessReference
```

## 25.5 Status model

```text
PENDING
RUNNING
SUCCEEDED
FAILED
CANCELLED
TIMED_OUT
```

## 25.6 Async result

For request-response:

- return `202 Accepted`;
- provide operation ID;
- allow polling/SSE/webhook.

## 25.7 Error visibility

Never let async errors disappear in logs only.

---

# 26. Backpressure dan Bounded Concurrency

## 26.1 Why backpressure?

If requests submit tasks faster than executor can process, queue grows.

Eventually:

- memory pressure;
- latency spike;
- task timeout;
- rejection;
- server instability.

## 26.2 Bounded executor

Configure max concurrency and queue size.

## 26.3 Rejection strategy

When overloaded:

- reject with 429/503;
- degrade feature;
- queue externally;
- apply rate limit.

## 26.4 Bulkhead

Separate executors per workload.

```text
reportExecutor
emailExecutor
externalApiExecutor
```

A slow report should not block security audit tasks.

## 26.5 Downstream limits

Concurrency should respect:

- DB pool size;
- external API quota;
- SMTP rate;
- file system throughput.

## 26.6 Semaphores

Even with managed executor, use semaphore/rate limiter for downstream resource if needed.

## 26.7 Queue length metric

Executor queue length should be monitored if runtime exposes it.

---

# 27. Error Handling

## 27.1 Future exceptions

Exceptions in Callable are captured in Future.

```java
try {
    future.get();
} catch (ExecutionException e) {
    Throwable cause = e.getCause();
}
```

## 27.2 Runnable exceptions

Uncaught exception should be logged/propagated via Future/listener.

Do not ignore.

## 27.3 CompletableFuture exceptions

```java
future.exceptionally(ex -> {
    log.error("Task failed", ex);
    return fallback;
});
```

## 27.4 Async method exceptions

If method returns future/stage, complete exceptionally.

If void async method fails, ensure runtime/logging captures it.

## 27.5 Retry

Retry only if operation idempotent and failure transient.

## 27.6 Timeout

Every remote call inside async task needs timeout.

## 27.7 Compensation

If async task partially succeeds, define compensation or repair workflow.

## 27.8 Error category

Classify:

- transient;
- permanent;
- cancellation;
- timeout;
- overload;
- programming bug.

---

# 28. Observability: Logging, Metrics, Tracing

## 28.1 Logs

Include:

- taskId;
- correlationId;
- executorName;
- submittedBy;
- taskType;
- start/end;
- duration;
- outcome;
- exception category.

## 28.2 MDC

MDC/ThreadLocal may not automatically propagate unless configured.

If you set MDC manually, clear it.

## 28.3 Metrics

Track:

- submitted tasks;
- running tasks;
- completed tasks;
- failed tasks;
- cancelled tasks;
- rejected tasks;
- task duration;
- queue depth;
- executor saturation.

## 28.4 Tracing

Create span for async task.

Propagate trace context explicitly or through context provider.

## 28.5 Task lifecycle

Use `ManagedTaskListener` or wrappers to record lifecycle.

## 28.6 Alerting

Alert on:

- rejection spike;
- queue growth;
- high task latency;
- failure spike;
- stuck tasks;
- scheduled task missed run.

---

# 29. Performance Engineering

## 29.1 Identify workload type

CPU-bound:

```text
limit to CPU cores
```

IO-bound:

```text
more concurrency possible, but bounded by downstream
```

## 29.2 CPU-bound tasks

Too many concurrent CPU tasks degrade throughput.

Use small executor.

## 29.3 IO-bound tasks

Virtual threads/managed executor can help, but DB/API pools are limits.

## 29.4 Blocking

Managed threads are still resources.

Use timeouts.

## 29.5 Allocation

Many small async tasks can create overhead.

Batch or combine if needed.

## 29.6 Scheduling overhead

Do not schedule millions of tasks in memory.

Use queue/batch/database scheduler.

## 29.7 ThreadLocal overhead

Large ThreadLocal context can hurt performance and leak memory.

## 29.8 Measuring

Use:

- JFR;
- thread dumps;
- executor metrics;
- application metrics;
- load test;
- profiler.

## 29.9 Don't optimize blindly

Async can improve latency but also increase complexity.

Measure.

---

# 30. Testing Strategy

## 30.1 Unit test business task

Extract task logic to normal service.

Test synchronously.

## 30.2 Integration test managed executor

Verify:

- task runs;
- context available;
- security context behavior;
- transaction behavior;
- cancellation;
- rejection if possible;
- shutdown behavior.

## 30.3 Fake executor

For unit tests:

```java
class DirectExecutor implements Executor {
    public void execute(Runnable r) { r.run(); }
}
```

## 30.4 CompletableFuture tests

Use deterministic executor to avoid timing flakes.

## 30.5 Timeout tests

Test task timeout/cancel.

## 30.6 Concurrency tests

Test race conditions with multiple tasks.

## 30.7 Load tests

Submit tasks under realistic load.

Monitor saturation and rejection.

## 30.8 Shutdown tests

Deploy/undeploy app and ensure tasks/threads do not leak.

## 30.9 Context tests

Compare:

- managed executor;
- unmanaged executor.

Observe classloader/security/JNDI/context behavior.

---

# 31. Production Failure Modes

## 31.1 Thread leak after redeploy

Cause:

- custom executor/new thread not shut down.

Fix:

- use managed executor/factory.

## 31.2 Context missing

Cause:

- common pool/unmanaged thread.

Symptoms:

- security principal null;
- JNDI lookup failure;
- CDI context inactive;
- class not found.

## 31.3 Transaction inconsistency

Cause:

- async task assumed submitter transaction.

Fix:

- outbox/new transaction/application design.

## 31.4 Rejected tasks

Cause:

- executor overloaded/stopped.

Fix:

- handle rejection/backpressure.

## 31.5 Silent async failures

Cause:

- fire-and-forget exception only logs or ignored.

Fix:

- task status, listener, metrics.

## 31.6 Stuck tasks

Cause:

- no timeout on external call.

Fix:

- timeouts/cancel/monitor.

## 31.7 Executor starvation

Cause:

- all threads blocked on slow downstream.

Fix:

- bulkheads, separate executor, timeout, rate limit.

## 31.8 Scheduled task overlap

Cause:

- task duration longer than interval.

Fix:

- lock/singleton guard/fixed delay/external scheduler.

## 31.9 Request object used after request ends

Cause:

- task captures `HttpServletRequest`.

Fix:

- copy immutable data.

## 31.10 Common pool contamination

Cause:

- `CompletableFuture.supplyAsync` without executor.

Fix:

- pass managed executor.

## 31.11 Virtual thread overload

Cause:

- virtual threads enable too many concurrent DB/API calls.

Fix:

- downstream bulkhead.

## 31.12 Memory leak by contextual proxy

Cause:

- long-lived proxy captures application/request context.

Fix:

- lifecycle management, avoid request context capture.

---

# 32. Best Practices dan Anti-Patterns

## 32.1 Best practices

- Use `ManagedExecutorService` instead of `Executors`.
- Use `ManagedScheduledExecutorService` instead of `Timer`.
- Use `ManagedThreadFactory` only when executor is not enough.
- Use `ContextService` for callbacks invoked by external libraries.
- Pass immutable DTOs to tasks.
- Do not pass request/entity manager/connection to async task.
- Treat async boundary as consistency boundary.
- Use timeouts and cancellation.
- Handle `RejectedExecutionException`.
- Use separate executors/bulkheads per workload.
- Monitor task queue, duration, failure, rejection.
- Make important tasks durable through messaging/batch/outbox.
- Use managed executor with `CompletableFuture`.
- Test with target runtime.

## 32.2 Anti-pattern: `Executors.newFixedThreadPool` in Jakarta EE

Creates unmanaged threads.

## 32.3 Anti-pattern: Fire-and-forget important work

If work matters, store state and observe outcome.

## 32.4 Anti-pattern: Async inside transaction expecting atomicity

Async task is not same transaction.

## 32.5 Anti-pattern: Capturing request object

Request lifecycle ends.

## 32.6 Anti-pattern: One default executor for everything

No isolation.

## 32.7 Anti-pattern: No timeout

Stuck tasks exhaust executor.

## 32.8 Anti-pattern: `CompletableFuture` common pool

Runs outside container.

## 32.9 Anti-pattern: Using scheduled executor as persistent business scheduler

Use batch/database/external scheduler for durable business schedules.

---

# 33. Checklist Review

## 33.1 Resource choice

- [ ] Managed executor used?
- [ ] Scheduled executor used for scheduling?
- [ ] Managed thread factory only when necessary?
- [ ] ContextService used for external callbacks?
- [ ] No raw `new Thread`?
- [ ] No raw `Executors`?

## 33.2 Task design

- [ ] Task has ID/correlation ID?
- [ ] Immutable input DTO?
- [ ] No request object captured?
- [ ] No open connection/entity manager passed?
- [ ] Timeout set for remote calls?
- [ ] Cancellation handled?
- [ ] Interrupt respected?

## 33.3 Transaction/security

- [ ] Transaction boundary explicit?
- [ ] No assumption submitter transaction propagates?
- [ ] Security context behavior understood?
- [ ] Authorization rechecked if needed?

## 33.4 Capacity

- [ ] Executor bounded?
- [ ] Queue capacity known?
- [ ] Rejection handled?
- [ ] Workload isolated?
- [ ] Downstream bulkhead?

## 33.5 Observability

- [ ] Task metrics?
- [ ] Rejection metric?
- [ ] Failure logging?
- [ ] Tracing/correlation?
- [ ] Alerting for saturation?

## 33.6 Durability

- [ ] If work must survive restart, use messaging/batch/outbox?
- [ ] Retry/idempotency designed?
- [ ] Task status stored if user-visible?

---

# 34. Case Study 1: Async Report Generation

## 34.1 Requirement

User requests report generation.

Report takes 30 seconds.

HTTP request should not wait.

## 34.2 Bad design

```java
@GET
public Response generate() {
    byte[] report = reportService.generate(); // 30s
    return Response.ok(report).build();
}
```

## 34.3 Better design

```text
POST /reports
  ↓
create report_job row PENDING
  ↓
submit async task
  ↓
return 202 + reportJobId
```

Task:

```text
load job
mark RUNNING
generate report
store result
mark SUCCEEDED
```

## 34.4 If report must survive restart

Use Jakarta Batch or messaging, not transient managed executor only.

## 34.5 Idempotency

Same request key should not create duplicate report jobs if retry.

## 34.6 Observability

Expose:

```http
GET /reports/{id}
```

with status.

---

# 35. Case Study 2: Parallel External API Calls

## 35.1 Requirement

Endpoint needs data from three external services.

Sequential time:

```text
A 300ms + B 400ms + C 500ms = 1200ms
```

Parallel can reduce latency to roughly max call.

## 35.2 Design

```java
CompletableFuture<A> a =
    CompletableFuture.supplyAsync(() -> clientA.get(), executor);

CompletableFuture<B> b =
    CompletableFuture.supplyAsync(() -> clientB.get(), executor);

CompletableFuture<C> c =
    CompletableFuture.supplyAsync(() -> clientC.get(), executor);

Combined result = a.thenCombine(b, ...)
```

## 35.3 Must include

- timeout per call;
- overall timeout;
- fallback policy;
- circuit breaker;
- bulkhead per downstream;
- cancellation on failure;
- tracing.

## 35.4 Danger

Parallel calls increase load on downstream.

If endpoint QPS high, downstream can be overwhelmed.

## 35.5 Lesson

Async improves latency but can increase pressure. Use bulkheads.

---

# 36. Case Study 3: Scheduled Cleanup yang Salah Desain

## 36.1 Requirement

Delete expired temporary files every 5 minutes.

## 36.2 Acceptable use

Managed scheduled executor can run cleanup task.

## 36.3 Pitfall

In cluster with 5 nodes, all nodes run cleanup concurrently.

## 36.4 Fix

If cleanup is safe/idempotent:

```text
multiple nodes okay
```

If not:

- use DB lock;
- leader election;
- external scheduler;
- batch job.

## 36.5 Pitfall 2

Cleanup takes 10 minutes but scheduled every 5 minutes.

Fix:

- fixed delay;
- non-overlap guard;
- skip if previous still running.

## 36.6 Lesson

Scheduling is not just interval. It is cluster and overlap design.

---

# 37. Case Study 4: Thread Leak karena `Executors.newFixedThreadPool`

## 37.1 Bad code

```java
@ApplicationScoped
public class BadAsyncService {
    private final ExecutorService executor = Executors.newFixedThreadPool(10);

    public void runAsync(Runnable r) {
        executor.submit(r);
    }
}
```

## 37.2 Problem

On redeploy:

- executor threads may remain;
- old classloader retained;
- memory leak;
- app behavior duplicated;
- shutdown issues.

## 37.3 Fix

```java
@Resource
ManagedExecutorService executor;
```

or:

```java
@Inject
ManagedExecutorService executor;
```

## 37.4 If custom executor unavoidable

Use managed thread factory and lifecycle hooks carefully, but prefer managed executor.

## 37.5 Lesson

Thread lifecycle belongs to container.

---

# 38. Latihan Bertahap

## Latihan 1 — Submit Callable

Use `ManagedExecutorService.submit`.

Return `Future`.

## Latihan 2 — CompletableFuture with managed executor

Use `supplyAsync(..., managedExecutor)`.

Compare with common pool.

## Latihan 3 — Context propagation

Log principal/classloader/JNDI in request and task.

## Latihan 4 — Transaction boundary

Submit task inside `@Transactional` method.

Observe transaction behavior.

## Latihan 5 — UserTransaction

Begin/commit transaction inside managed task.

## Latihan 6 — Cancellation

Submit long task.

Cancel and handle interrupt.

## Latihan 7 — Scheduled task

Use `ManagedScheduledExecutorService`.

Implement non-overlap guard.

## Latihan 8 — ContextService

Create contextual proxy callback and invoke from external executor/library simulation.

## Latihan 9 — Rejection/backpressure

Configure small executor/queue if runtime supports.

Submit many tasks and handle rejection.

## Latihan 10 — Shutdown leak test

Deploy/undeploy app repeatedly.

Verify no unmanaged threads remain.

---

# 39. Mini Project: Jakarta Concurrency Runtime Lab

## 39.1 Goal

Create:

```text
jakarta-concurrency-runtime-lab/
```

## 39.2 Modules

```text
managed-executor-basic/
completable-future-managed/
scheduled-executor/
context-service-callback/
managed-thread-factory/
transaction-boundary/
security-context/
cancellation-timeout/
bulkhead-executors/
observability/
```

## 39.3 Deliverables

```text
README.md
CONCURRENCY-MENTAL-MODEL.md
MANAGED-THREADS.md
CONTEXT-PROPAGATION.md
TRANSACTION-BOUNDARY.md
ASYNC-DESIGN.md
BACKPRESSURE.md
VIRTUAL-THREADS.md
OBSERVABILITY.md
FAILURE-MODES.md
```

## 39.4 Required experiments

1. Compare managed vs unmanaged thread.
2. Submit tasks with managed executor.
3. Use managed executor with CompletableFuture.
4. Schedule periodic cleanup.
5. Cancel running task.
6. Propagate security context.
7. Show transaction not propagated.
8. Use `UserTransaction`.
9. Simulate executor saturation.
10. Test redeploy for thread leak.

## 39.5 Evaluation questions

1. Why is `new Thread` dangerous in Jakarta EE?
2. What does `ManagedExecutorService` provide?
3. What does `ContextService` capture?
4. Why is transaction not propagated automatically?
5. When should you use messaging instead of managed executor?
6. What is backpressure?
7. Why is common pool problematic?
8. What does cancellation require?
9. What do virtual threads not solve?
10. What metrics reveal executor saturation?

---

# 40. Referensi Resmi

Referensi utama:

1. Jakarta Concurrency 3.1  
   https://jakarta.ee/specifications/concurrency/3.1/

2. Jakarta Concurrency 3.1 Specification  
   https://jakarta.ee/specifications/concurrency/3.1/jakarta-concurrency-spec-3.1.pdf

3. Jakarta Concurrency API Docs — `ManagedExecutorService`  
   https://jakarta.ee/specifications/concurrency/3.1/apidocs/jakarta.concurrency/jakarta/enterprise/concurrent/managedexecutorservice

4. Jakarta Concurrency Tutorial  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/supporttechs/concurrency-utilities/concurrency-utilities.html

5. Jakarta Concurrency Explained  
   https://jakarta.ee/learn/specification-guides/concurrency-explained/

6. Jakarta Transactions 2.0  
   https://jakarta.ee/specifications/transactions/2.0/

7. Jakarta CDI 4.1  
   https://jakarta.ee/specifications/cdi/4.1/

8. Jakarta Servlet 6.1  
   https://jakarta.ee/specifications/servlet/6.1/

9. Jakarta Messaging 3.1  
   https://jakarta.ee/specifications/messaging/3.1/

10. Jakarta Batch 2.1  
    https://jakarta.ee/specifications/batch/2.1/

---

# Penutup

Jakarta Concurrency adalah standard untuk menggunakan concurrency di Jakarta EE tanpa merusak integritas container.

Mental model ringkas:

```text
ManagedExecutorService:
  async task execution

ManagedScheduledExecutorService:
  delayed/periodic task execution

ManagedThreadFactory:
  managed thread creation for integration cases

ContextService:
  contextual proxy and context propagation

ManagedTask / ManagedTaskListener:
  task identity, properties, lifecycle observation

@Asynchronous:
  annotation-based async method execution
```

Prinsip paling penting:

```text
Async boundary is also a lifecycle, context, transaction, and consistency boundary.
```

Jangan gunakan async hanya untuk “biar cepat”. Gunakan async jika boundary-nya jelas:

- siapa owner task;
- apa statusnya;
- apa yang terjadi jika gagal;
- apakah task durable;
- apakah idempotent;
- bagaimana timeout/cancel/retry;
- bagaimana backpressure;
- bagaimana monitoring.

Engineer top-tier tidak hanya tahu `executor.submit`. Ia tahu kenapa unmanaged thread berbahaya di container, kenapa transaction submitter tidak ikut ke task, kenapa common pool bermasalah, kenapa virtual thread bukan solusi capacity, dan kapan harus memilih messaging/batch/outbox daripada transient async executor.

Bagian berikutnya akan membahas **Jakarta Enterprise Beans (`jakarta.ejb`)**: stateless/stateful/singleton beans, transaction/security/interceptor model, timer service, concurrency, MDB, legacy relevance, and how to reason about EJB in modern Jakarta EE.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 21 — Jakarta Batch (`jakarta.batch`): Job, Step, Chunk, Checkpoint, Restartability, dan Production Batch Processing](./learn-java-jakarta-part-021.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Bagian 23 — Jakarta Enterprise Beans (`jakarta.ejb`): Session Bean, MDB, Transaction, Security, Timer, dan Legacy-Modern Boundary](./learn-java-jakarta-part-023.md)

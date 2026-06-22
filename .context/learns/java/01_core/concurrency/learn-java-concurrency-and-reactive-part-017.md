# learn-java-concurrency-and-reactive-part-017.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 017  
# Scoped Values and Context Passing: Explicit Context, ThreadLocal Alternatives, Immutable Ambient Context, Virtual Threads, and Structured Concurrency

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **017**  
> Fokus: memahami **Scoped Values** dan strategi context passing modern di Java. Kita akan membahas masalah ambient context, explicit context passing, `ThreadLocal`, `InheritableThreadLocal`, `ScopedValue`, lexical/dynamic scope, immutability, lifetime, inheritance to structured child tasks, virtual threads, request context, tenant/security/correlation/deadline context, migration, testing, dan production design.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Masalah Context Passing di Aplikasi Concurrent](#2-masalah-context-passing-di-aplikasi-concurrent)
3. [Apa Itu Context](#3-apa-itu-context)
4. [Explicit Context Passing](#4-explicit-context-passing)
5. [Ambient Context](#5-ambient-context)
6. [ThreadLocal sebagai Ambient Context](#6-threadlocal-sebagai-ambient-context)
7. [Masalah ThreadLocal](#7-masalah-threadlocal)
8. [InheritableThreadLocal dan Kenapa Tidak Cukup](#8-inheritablethreadlocal-dan-kenapa-tidak-cukup)
9. [Scoped Value: Konsep Dasar](#9-scoped-value-konsep-dasar)
10. [Scoped Value sebagai Implicit Parameter](#10-scoped-value-sebagai-implicit-parameter)
11. [Lexical Scope dan Dynamic Extent](#11-lexical-scope-dan-dynamic-extent)
12. [Immutability by Design](#12-immutability-by-design)
13. [API Dasar ScopedValue](#13-api-dasar-scopedvalue)
14. [`where` and `run`](#14-where-and-run)
15. [`call` for Returning Values](#15-call-for-returning-values)
16. [`get`, `isBound`, and Failure When Unbound](#16-get-isbound-and-failure-when-unbound)
17. [Nested Bindings](#17-nested-bindings)
18. [Scoped Values and StructuredTaskScope](#18-scoped-values-and-structuredtaskscope)
19. [Child Thread Inheritance](#19-child-thread-inheritance)
20. [Scoped Values and Virtual Threads](#20-scoped-values-and-virtual-threads)
21. [Scoped Values vs ThreadLocal](#21-scoped-values-vs-threadlocal)
22. [Scoped Values vs Method Parameters](#22-scoped-values-vs-method-parameters)
23. [Designing ExecutionContext](#23-designing-executioncontext)
24. [Tenant Context](#24-tenant-context)
25. [Security Context](#25-security-context)
26. [Correlation and Trace Context](#26-correlation-and-trace-context)
27. [Deadline Context](#27-deadline-context)
28. [Locale and Formatting Context](#28-locale-and-formatting-context)
29. [What Not to Put in Scoped Values](#29-what-not-to-put-in-scoped-values)
30. [Context Boundaries](#30-context-boundaries)
31. [Context Propagation to Executors](#31-context-propagation-to-executors)
32. [Context in Reactive Pipelines](#32-context-in-reactive-pipelines)
33. [Migration from ThreadLocal](#33-migration-from-threadlocal)
34. [Testing Scoped Values](#34-testing-scoped-values)
35. [Observability and Debugging](#35-observability-and-debugging)
36. [Mini Case Study: Request Context](#36-mini-case-study-request-context)
37. [Mini Case Study: Tenant-Safe Repository](#37-mini-case-study-tenant-safe-repository)
38. [Mini Case Study: Structured Fan-Out with Scoped Context](#38-mini-case-study-structured-fan-out-with-scoped-context)
39. [Common Anti-Patterns](#39-common-anti-patterns)
40. [Best Practices](#40-best-practices)
41. [Decision Matrix](#41-decision-matrix)
42. [Latihan](#42-latihan)
43. [Ringkasan](#43-ringkasan)
44. [Referensi](#44-referensi)

---

# 1. Tujuan Bagian Ini

Dalam aplikasi backend, hampir semua request membawa context:

```text
requestId
correlationId
tenantId
user/security principal
locale/timezone
deadline
trace/span context
feature flag snapshot
```

Pertanyaan penting:

```text
Bagaimana context ini tersedia di layer bawah tanpa membuat setiap method signature menjadi sangat panjang?
Bagaimana context ini aman saat berpindah thread?
Bagaimana mencegah context leak antar request?
Bagaimana membuat child virtual threads mewarisi context secara aman?
```

Selama bertahun-tahun, Java banyak memakai `ThreadLocal`.

Tetapi `ThreadLocal` punya masalah:

- mutable;
- harus `remove`;
- leak di thread pool;
- tidak otomatis cross thread boundary;
- `InheritableThreadLocal` tidak cocok untuk executor;
- overhead/risiko tinggi pada virtual threads;
- dependency tersembunyi.

Scoped Values hadir sebagai alternatif modern untuk **immutable scoped context**.

JEP 506 memperkenalkan scoped values untuk berbagi immutable data dengan callees dalam thread dan child threads; JEP tersebut menyatakan scoped values lebih mudah dipahami daripada thread-local variables dan punya biaya ruang/waktu lebih rendah, khususnya saat digunakan bersama virtual threads dan structured concurrency.

Target bagian ini:

```text
Mampu memilih antara explicit context, ThreadLocal, ScopedValue,
dan framework-specific context berdasarkan lifecycle, mutability,
thread boundary, dan correctness.
```

---

# 2. Masalah Context Passing di Aplikasi Concurrent

Bayangkan request masuk:

```text
GET /cases/123
tenant = CEA
user = fajar
correlationId = abc-123
deadline = now + 2s
```

Layer yang butuh context:

```text
Controller
  -> Service
      -> Repository
      -> Permission Client
      -> Audit Logger
      -> Metrics
      -> SQL Filter
```

Jika semua context dilewatkan manual:

```java
repository.findCase(context, caseId);
permissionClient.check(context, userId, caseId);
audit.log(context, event);
```

Ini explicit dan aman, tetapi kadang verbose.

Jika memakai ambient context:

```java
TenantContext.current()
SecurityContext.current()
CorrelationContext.current()
```

Method signature bersih, tetapi dependency tersembunyi.

## 2.1 Concurrent complication

Context harus aman saat:

- request diproses di virtual thread;
- child subtasks dibuat;
- executor dipakai;
- request timeout/cancel;
- thread reuse terjadi;
- logging async;
- reactive pipeline berpindah scheduler.

## 2.2 Main rule

```text
Context passing is a lifecycle problem, not just an API convenience problem.
```

---

# 3. Apa Itu Context

Context adalah metadata yang mempengaruhi eksekusi tetapi bukan selalu bagian dari domain payload.

Contoh:

## 3.1 Identity context

```text
userId, roles, permissions
```

## 3.2 Tenancy context

```text
tenantId, schema, data partition
```

## 3.3 Observability context

```text
requestId, correlationId, traceId, spanId
```

## 3.4 Time context

```text
deadline, timeout budget, timezone
```

## 3.5 Feature context

```text
feature flags, experiment cohort
```

## 3.6 Main rule

```text
Context should be small, immutable, and scoped to a clear unit of work.
```

---

# 4. Explicit Context Passing

Explicit context:

```java
CaseDetails loadCase(ExecutionContext context, CaseId caseId) {
    CaseRecord record = repository.find(context.tenantId(), caseId);
    Permission permission = permissionClient.check(context.user(), caseId);
    return assemble(record, permission);
}
```

## 4.1 Pros

- visible dependency;
- easy testing;
- safe across threads;
- no cleanup;
- no hidden global state;
- works with reactive/async/virtual threads.

## 4.2 Cons

- parameter plumbing;
- method signature noise;
- low-level utilities may receive context they do not need;
- cross-cutting concerns may spread.

## 4.3 Best for

- business-critical tenant/security/deadline;
- API boundary clarity;
- domain services;
- async task payload.

## 4.4 Main rule

```text
For correctness-critical context, explicit is often better than convenient.
```

---

# 5. Ambient Context

Ambient context means context can be read without explicit parameter.

Example:

```java
TenantId tenant = TenantContext.current();
```

## 5.1 Pros

- less parameter plumbing;
- useful for cross-cutting concerns;
- convenient for logging/tracing;
- can integrate with frameworks.

## 5.2 Cons

- hidden dependencies;
- hard testing;
- thread-bound semantics;
- leak risk;
- unclear lifetime;
- propagation complexity.

## 5.3 Main rule

```text
Ambient context must have strict scope and lifecycle, or it becomes hidden global state.
```

---

# 6. ThreadLocal sebagai Ambient Context

ThreadLocal example:

```java
final class RequestContextHolder {
    private static final ThreadLocal<ExecutionContext> CURRENT =
        new ThreadLocal<>();

    static void set(ExecutionContext context) {
        CURRENT.set(context);
    }

    static ExecutionContext current() {
        ExecutionContext context = CURRENT.get();
        if (context == null) {
            throw new IllegalStateException("No context");
        }
        return context;
    }

    static void clear() {
        CURRENT.remove();
    }
}
```

Boundary:

```java
RequestContextHolder.set(context);
try {
    service.handle(request);
} finally {
    RequestContextHolder.clear();
}
```

## 6.1 Works but fragile

It works if:

- same thread;
- cleanup always happens;
- no async boundary;
- values small;
- lifecycle clear.

## 6.2 Main rule

```text
ThreadLocal is mutable ambient context bound to thread lifetime.
```

---

# 7. Masalah ThreadLocal

## 7.1 Leak

If not removed in thread pool, value may persist.

## 7.2 Wrong context

Worker thread reused for another request.

## 7.3 Async missing context

New executor task has no value.

## 7.4 Propagation complexity

Need wrapper capture/install/restore.

## 7.5 Mutable context

Value can be changed by callees.

## 7.6 Lifetime unclear

Value persists until removed.

## 7.7 Virtual thread cardinality

Heavy ThreadLocal values become expensive with many virtual threads.

## 7.8 Main rule

```text
ThreadLocal solves parameter plumbing by creating lifecycle and propagation risk.
```

---

# 8. InheritableThreadLocal dan Kenapa Tidak Cukup

`InheritableThreadLocal` copies parent value to child thread at child thread creation.

This sounds useful:

```java
static final InheritableThreadLocal<ExecutionContext> CTX =
    new InheritableThreadLocal<>();
```

## 8.1 Problem with executor pools

Thread pool worker threads are often created before request context.

So value is not inherited per task.

## 8.2 Stale value

Worker may inherit something once and keep it.

## 8.3 Mutable shared reference

Parent/child may share same mutable object reference.

## 8.4 Too broad

Context may be inherited by threads that should not receive it.

## 8.5 Main rule

```text
InheritableThreadLocal is creation-time inheritance,
not structured task context propagation.
```

---

# 9. Scoped Value: Konsep Dasar

Scoped Value adalah mechanism untuk membuat value tersedia dalam scope tertentu.

Concept:

```java
ScopedValue.where(KEY, value)
    .run(() -> {
        // KEY.get() available here
    });

// outside: not available
```

Oracle Java SE 25 guide describes a scoped value as a value that may be safely and efficiently shared to methods without using method parameters.

## 9.1 Key idea

Unlike ThreadLocal:

```text
value is bound for a scope,
not set until removed manually.
```

## 9.2 Immutable mindset

Scoped values are intended for immutable data.

## 9.3 Main rule

```text
ScopedValue is bounded immutable ambient context.
```

---

# 10. Scoped Value sebagai Implicit Parameter

Oracle early-access API wording describes `ScopedValue` as a way to pass data to a faraway method without method parameters, effectively acting as an implicit method parameter.

Example:

```java
private static final ScopedValue<ExecutionContext> CONTEXT =
    ScopedValue.newInstance();

void controller(Request request) {
    ExecutionContext context = createContext(request);

    ScopedValue.where(CONTEXT, context)
        .run(() -> service.handle(request.command()));
}

void repositoryCall() {
    TenantId tenant = CONTEXT.get().tenantId();
}
```

## 10.1 Hidden but scoped

Dependency is still ambient, but lifetime is bounded by lexical scope.

## 10.2 Main rule

```text
ScopedValue gives implicit parameters with explicit lifetime.
```

---

# 11. Lexical Scope dan Dynamic Extent

Scoped value binding exists during execution of a code block.

```java
ScopedValue.where(CONTEXT, context)
    .run(() -> service.handle());
```

Inside `service.handle()` and callees:

```java
CONTEXT.get()
```

works.

After `run()` exits:

```java
CONTEXT.get()
```

fails if no outer binding.

## 11.1 Dynamic extent

It applies to call tree executed within the scope.

## 11.2 Main rule

```text
ScopedValue binding is temporary and automatically removed when scope exits.
```

---

# 12. Immutability by Design

Scoped values should hold immutable data.

Good:

```java
record ExecutionContext(
    TenantId tenantId,
    UserSnapshot user,
    String correlationId,
    Instant deadline
) {}
```

Bad:

```java
ScopedValue<Map<String, Object>> MUTABLE_CONTEXT;
```

## 12.1 Why immutable?

If callees can mutate context, hidden side effects return.

## 12.2 Main rule

```text
Scoped Values are safest when values are immutable snapshots.
```

---

# 13. API Dasar ScopedValue

Conceptual API:

```java
ScopedValue<T> key = ScopedValue.newInstance();
```

Operations:

```java
ScopedValue.where(key, value).run(runnable);
ScopedValue.where(key, value).call(callable);
key.get();
key.isBound();
```

Exact APIs can evolve by Java version, but these are the core mental operations.

## 13.1 Key as static final

```java
private static final ScopedValue<ExecutionContext> CONTEXT =
    ScopedValue.newInstance();
```

## 13.2 Main rule

```text
A ScopedValue object is the key; binding supplies the value for a scope.
```

---

# 14. `where` and `run`

Example:

```java
ScopedValue.where(CONTEXT, context)
    .run(() -> {
        service.handle(command);
    });
```

Inside:

```java
ExecutionContext ctx = CONTEXT.get();
```

## 14.1 No manual cleanup

Cleanup automatic when `run` returns or throws.

## 14.2 Exception path safe

If exception thrown, binding still exits.

## 14.3 Main rule

```text
where(...).run(...) is ThreadLocal set/use/remove without mutable cleanup burden.
```

---

# 15. `call` for Returning Values

If block returns value:

```java
Response response =
    ScopedValue.where(CONTEXT, context)
        .call(() -> service.handle(command));
```

## 15.1 Checked exceptions

Depending functional interface/API version, exceptions may be supported.

## 15.2 Main rule

```text
Use call when scoped computation produces a result.
```

---

# 16. `get`, `isBound`, and Failure When Unbound

Inside scope:

```java
ExecutionContext context = CONTEXT.get();
```

Outside:

```java
CONTEXT.get(); // throws if unbound
```

Use:

```java
if (CONTEXT.isBound()) {
    ...
}
```

## 16.1 Prefer fail fast

For required context:

```java
static ExecutionContext current() {
    return CONTEXT.get();
}
```

Failing fast is better than silently using null/default tenant/security.

## 16.2 Main rule

```text
Required scoped context should fail fast when unbound.
```

---

# 17. Nested Bindings

Scoped values can be rebound in nested scopes.

```java
ScopedValue.where(CONTEXT, outer)
    .run(() -> {
        // CONTEXT = outer

        ScopedValue.where(CONTEXT, inner)
            .run(() -> {
                // CONTEXT = inner
            });

        // CONTEXT = outer again
    });
```

## 17.1 Useful for

- impersonation scope;
- sub-request context;
- test override;
- nested deadline.

## 17.2 Caution

Do not overuse rebinding; it can confuse readers.

## 17.3 Main rule

```text
Nested binding is scoped override, automatically restored.
```

---

# 18. Scoped Values and StructuredTaskScope

Java SE 25 `StructuredTaskScope` docs state that when a `ScopedValue` is bound in the thread executing the task, the binding is inherited by threads created to execute subtasks. It further explains that scoped values can safely and efficiently share values with methods executed by subtasks forked in the scope.

Concept:

```java
ScopedValue.where(CONTEXT, context)
    .run(() -> {
        try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
            var user = scope.fork(() -> userClient.load(CONTEXT.get()));
            var cases = scope.fork(() -> caseClient.load(CONTEXT.get()));

            scope.join();
            scope.throwIfFailed();

            return combine(user.get(), cases.get());
        }
    });
```

## 18.1 Why powerful

Child tasks inherit immutable context without manual ThreadLocal propagation.

## 18.2 Main rule

```text
Scoped Values + StructuredTaskScope provide safe parent-to-child context sharing.
```

---

# 19. Child Thread Inheritance

Scoped value inheritance is limited to structured cases.

This is different from arbitrary executor propagation.

## 19.1 Good

```text
parent scope -> structured child tasks -> join -> close
```

## 19.2 Not arbitrary global propagation

Do not assume every executor task receives scoped values unless API explicitly supports capture/inheritance semantics.

## 19.3 Main rule

```text
Scoped Value inheritance is designed for bounded child tasks, not detached background work.
```

---

# 20. Scoped Values and Virtual Threads

Scoped values are designed to work well with virtual threads.

JEP 506 says scoped values have lower space and time costs especially when used with virtual threads and structured concurrency.

## 20.1 Why better than ThreadLocal in virtual-thread apps

- bounded lifetime;
- immutable values;
- no remove;
- efficient sharing;
- works with structured child tasks.

## 20.2 Main rule

```text
For virtual-thread request context, Scoped Values are usually a better fit than mutable ThreadLocal.
```

---

# 21. Scoped Values vs ThreadLocal

| Aspect | ThreadLocal | ScopedValue |
|---|---|---|
| Value mutability | mutable set/remove | immutable scoped binding |
| Lifetime | until remove/thread death | lexical/dynamic scope |
| Cleanup | manual | automatic |
| Leak risk | high if forgotten | lower |
| Propagation | manual/inheritable quirks | structured child inheritance |
| Virtual thread cost | can be high | designed lower cost |
| Use case | legacy per-thread state | immutable context |
| Hidden dependency | yes | yes but bounded |

## 21.1 Main rule

```text
ThreadLocal is mutable per-thread storage.
ScopedValue is immutable scoped context.
```

---

# 22. Scoped Values vs Method Parameters

## 22.1 Method parameters

Best for core business dependencies.

```java
repository.findByTenant(tenantId, id);
```

## 22.2 Scoped values

Best for cross-cutting context used far down call tree.

```java
Correlation.current()
Deadline.current()
```

## 22.3 Hybrid

Use explicit context at service boundary, scoped values for framework/cross-cutting utilities.

## 22.4 Main rule

```text
Do not use ScopedValue to hide important domain inputs.
Use it for scoped ambient metadata.
```

---

# 23. Designing ExecutionContext

A good context object:

```java
record ExecutionContext(
    TenantId tenantId,
    UserSnapshot user,
    String correlationId,
    Instant deadline,
    Locale locale
) {
    Duration remaining() {
        return Duration.between(Instant.now(), deadline);
    }
}
```

## 23.1 Requirements

- immutable;
- small;
- no live request/entity objects;
- no mutable maps unless copied;
- no large payloads;
- contains only valid-for-scope data.

## 23.2 Main rule

```text
ExecutionContext should be a small immutable snapshot of execution metadata.
```

---

# 24. Tenant Context

Tenant is correctness-critical.

Options:

## 24.1 Explicit

```java
repository.findCases(context.tenantId(), filter);
```

## 24.2 Scoped

```java
TenantId tenant = EXECUTION_CONTEXT.get().tenantId();
```

## 24.3 Safety

Fail if missing.

Never default to “all tenants”.

## 24.4 Main rule

```text
Tenant context must fail closed.
No tenant context should never mean all tenants.
```

---

# 25. Security Context

Security context should be immutable snapshot:

```java
record UserSnapshot(
    UserId userId,
    Set<Role> roles
) {
    UserSnapshot {
        roles = Set.copyOf(roles);
    }
}
```

## 25.1 Do not store mutable principal/session

Avoid live session/request objects.

## 25.2 Impersonation

Nested scoped binding can represent controlled impersonation:

```java
ScopedValue.where(CONTEXT, impersonatedContext)
    .run(() -> adminAction());
```

Audit carefully.

## 25.3 Main rule

```text
Security context in ScopedValue should be immutable, minimal, and auditable.
```

---

# 26. Correlation and Trace Context

Scoped values can store:

```text
correlationId
traceId
span context
```

## 26.1 Logging bridge

Logging frameworks may still use MDC/ThreadLocal.

Bridge at boundary:

```java
ScopedValue.where(CONTEXT, context)
    .run(() -> {
        MDC.put("correlationId", context.correlationId());
        try {
            service.handle();
        } finally {
            MDC.clear();
        }
    });
```

## 26.2 Better integration

Frameworks may provide tracing context propagation.

## 26.3 Main rule

```text
ScopedValue can be source of truth; MDC can be a logging adapter.
```

---

# 27. Deadline Context

Deadline should be context, not random timeout constants.

```java
record ExecutionContext(Instant deadline) {
    Duration remaining() {
        Duration remaining = Duration.between(Instant.now(), deadline);
        return remaining.isNegative() ? Duration.ZERO : remaining;
    }
}
```

Child calls:

```java
client.call(request, context.remaining());
```

## 27.1 Structured scope

Parent deadline bounds all child tasks.

## 27.2 Main rule

```text
Deadline context makes timeout budgeting composable.
```

---

# 28. Locale and Formatting Context

Locale/timezone may be request-specific.

Use context:

```java
record ExecutionContext(Locale locale, ZoneId zoneId) {}
```

## 28.1 Avoid static mutable formatters

Use immutable formatters or local instances.

## 28.2 Main rule

```text
Locale/timezone are good scoped metadata, but formatting objects should remain thread-safe/immutable.
```

---

# 29. What Not to Put in Scoped Values

Avoid:

## 29.1 Large payloads

Request body, huge DTOs, file bytes.

## 29.2 Mutable collections

Maps/lists that callees mutate.

## 29.3 Live framework objects

`HttpServletRequest`, ORM entities, EntityManager.

## 29.4 Transaction resources

Do not use scoped values to bypass transaction framework semantics.

## 29.5 Business domain data required by method

Pass as parameter.

## 29.6 Main rule

```text
ScopedValue should carry small immutable metadata, not mutable application state.
```

---

# 30. Context Boundaries

Bind context at boundary:

## 30.1 HTTP request boundary

```java
ScopedValue.where(CONTEXT, context)
    .run(() -> controller.handle(command));
```

## 30.2 Message consumer boundary

```java
ScopedValue.where(CONTEXT, messageContext)
    .run(() -> handler.handle(message));
```

## 30.3 Job boundary

```java
ScopedValue.where(CONTEXT, jobContext)
    .run(() -> jobRunner.run(job));
```

## 30.4 Test boundary

```java
ScopedValue.where(CONTEXT, testContext)
    .run(() -> serviceUnderTest.call());
```

## 30.5 Main rule

```text
Bind context at entry boundary, not randomly in the middle of business logic.
```

---

# 31. Context Propagation to Executors

Scoped values do not mean arbitrary detached executor tasks should inherit request context.

If task outlives request, it should receive durable explicit payload.

Bad:

```java
executor.submit(() -> auditWithCurrentContext());
```

Better:

```java
AuditCommand command = AuditCommand.from(context, event);
executor.submit(() -> audit(command));
```

## 31.1 For child tasks

Use structured concurrency.

## 31.2 For background tasks

Use explicit immutable command.

## 31.3 Main rule

```text
Structured children inherit context.
Detached work receives explicit payload.
```

---

# 32. Context in Reactive Pipelines

Reactive pipelines may not use Java call stack/thread scope the same way.

Use framework reactive context.

Example concept:

```text
Reactor Context
```

rather than ThreadLocal/ScopedValue for async stream propagation.

## 32.1 Boundary bridge

At boundary, convert scoped context to reactive context if needed.

## 32.2 Main rule

```text
ScopedValue is call-scope oriented.
Reactive pipelines need reactive context semantics.
```

---

# 33. Migration from ThreadLocal

## 33.1 Inventory

List ThreadLocals:

- MDC;
- security;
- tenant;
- transaction;
- locale;
- cache/buffer.

## 33.2 Classify

- immutable request context -> ScopedValue candidate;
- logging adapter -> maybe MDC bridge;
- transaction framework -> leave framework-managed;
- heavy cache -> remove/rethink;
- mutable context -> redesign.

## 33.3 Migrate boundary

Replace:

```java
ThreadLocal.set(context);
try {
    service.call();
} finally {
    ThreadLocal.remove();
}
```

with:

```java
ScopedValue.where(CONTEXT, context)
    .run(() -> service.call());
```

## 33.4 Keep compatibility adapter

```java
static ExecutionContext current() {
    if (SCOPED_CONTEXT.isBound()) {
        return SCOPED_CONTEXT.get();
    }
    return LEGACY_THREAD_LOCAL.get();
}
```

temporarily.

## 33.5 Main rule

```text
Migrate ThreadLocal to ScopedValue by lifecycle boundary, not by search-and-replace.
```

---

# 34. Testing Scoped Values

## 34.1 Test bound case

```java
ScopedValue.where(CONTEXT, context)
    .run(() -> assertEquals(context, service.currentContext()));
```

## 34.2 Test unbound case

Required context should throw.

## 34.3 Test nested binding

Outer restored after inner.

## 34.4 Test structured child inheritance

Fork child in `StructuredTaskScope` and assert context visible.

## 34.5 Test no leak

After scope exits, `isBound` false.

## 34.6 Main rule

```text
ScopedValue tests should assert scope lifetime.
```

---

# 35. Observability and Debugging

## 35.1 Log context boundary

Record context creation:

```text
requestId, tenantId, userId, deadline
```

## 35.2 Child task metrics

Ensure child tasks report same correlation ID.

## 35.3 Fail fast

If context missing, throw with clear message.

## 35.4 Avoid dumping secrets

Security context should not log tokens/credentials.

## 35.5 Main rule

```text
Scoped context should improve traceability without leaking sensitive data.
```

---

# 36. Mini Case Study: Request Context

## 36.1 Context

```java
record ExecutionContext(
    String correlationId,
    TenantId tenantId,
    UserSnapshot user,
    Instant deadline
) {}
```

## 36.2 Binding

```java
private static final ScopedValue<ExecutionContext> CONTEXT =
    ScopedValue.newInstance();

Response handle(HttpRequest request) throws Exception {
    ExecutionContext context = createContext(request);

    return ScopedValue.where(CONTEXT, context)
        .call(() -> controller.handle(toCommand(request)));
}
```

## 36.3 Usage

```java
class AuditService {
    void audit(Event event) {
        ExecutionContext context = CONTEXT.get();
        writeAudit(context.tenantId(), context.user().userId(), event);
    }
}
```

## 36.4 Lesson

```text
ScopedValue makes request context available to deep callees with bounded lifetime.
```

---

# 37. Mini Case Study: Tenant-Safe Repository

## 37.1 Dangerous

```java
List<Case> findCases(Filter filter) {
    TenantId tenant = TenantContext.currentOrDefaultAll();
    ...
}
```

Default all tenants is dangerous.

## 37.2 Better

```java
List<Case> findCases(Filter filter) {
    TenantId tenant = CONTEXT.get().tenantId();
    return queryTenant(tenant, filter);
}
```

If unbound, fail.

## 37.3 Even clearer

```java
List<Case> findCases(TenantId tenant, Filter filter)
```

## 37.4 Lesson

```text
For tenant isolation, missing context must fail closed.
```

---

# 38. Mini Case Study: Structured Fan-Out with Scoped Context

## 38.1 Binding parent context

```java
return ScopedValue.where(CONTEXT, context)
    .call(() -> loadDashboard(command));
```

## 38.2 Fan-out

```java
Dashboard loadDashboard(Command command) throws Exception {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        var profile = scope.fork(() -> profileClient.load(CONTEXT.get()));
        var cases = scope.fork(() -> caseClient.load(CONTEXT.get()));
        var sla = scope.fork(() -> slaClient.load(CONTEXT.get()));

        scope.join();
        scope.throwIfFailed();

        return new Dashboard(profile.get(), cases.get(), sla.get());
    }
}
```

## 38.3 Benefit

Child tasks inherit immutable context through structured scope.

## 38.4 Lesson

```text
ScopedValue + StructuredTaskScope is the modern replacement for many ThreadLocal propagation wrappers.
```

---

# 39. Common Anti-Patterns

## 39.1 Using ScopedValue for mutable data

Defeats safety.

## 39.2 Hiding domain inputs

Business-critical method inputs become invisible.

## 39.3 Binding too deep

Context created in random utility, not boundary.

## 39.4 Storing huge objects

Memory retention.

## 39.5 Using ScopedValue for transactions manually

Bypasses framework semantics.

## 39.6 Assuming arbitrary executor propagation

Detached tasks need explicit payload.

## 39.7 Logging secrets from context

Security leak.

## 39.8 Overusing nested bindings

Hard to reason.

## 39.9 Mixing ThreadLocal and ScopedValue without clear precedence

Confusing behavior.

## 39.10 Defaulting missing tenant/security context

Fail open bug.

---

# 40. Best Practices

## 40.1 Keep context immutable

Use records and immutable collections.

## 40.2 Keep context small

Only metadata.

## 40.3 Bind at entry boundary

HTTP/message/job/test boundary.

## 40.4 Fail fast when required context missing

No silent defaults.

## 40.5 Use explicit parameters for domain inputs

Do not hide everything.

## 40.6 Use StructuredTaskScope for child task inheritance

Avoid ad hoc executor propagation.

## 40.7 Use explicit payload for detached work

Audit/event/job command.

## 40.8 Bridge to MDC carefully

MDC is logging adapter, not source of truth.

## 40.9 Audit security/tenant data

No tokens/secrets in logs.

## 40.10 Migrate gradually

By lifecycle boundary.

---

# 41. Decision Matrix

| Need | Recommended |
|---|---|
| Business input required by method | explicit parameter |
| Request metadata deep in stack | ScopedValue |
| Tenant ID in repository | explicit or ScopedValue fail-closed |
| Security user snapshot | explicit or ScopedValue immutable snapshot |
| Correlation ID for logging | ScopedValue + MDC bridge |
| Deadline propagation | explicit context or ScopedValue |
| Child tasks in StructuredTaskScope | ScopedValue |
| Detached background job | explicit immutable command |
| Reactive pipeline | reactive context |
| Legacy framework expects ThreadLocal | bridge/adapter |
| Transaction context | framework-managed |
| Heavy per-thread buffer | avoid ScopedValue/ThreadLocal |
| Test context | ScopedValue boundary |

---

# 42. Latihan

## Latihan 1 — ExecutionContext Record

Buat immutable `ExecutionContext` dengan tenant, user, correlationId, dan deadline.

## Latihan 2 — ScopedValue Binding

Tulis pseudo-code binding context di HTTP boundary.

## Latihan 3 — Fail Fast

Buat helper `currentContext()` yang throw jika unbound.

## Latihan 4 — Nested Binding

Simulasikan outer context dan inner impersonation context. Jelaskan restore behavior.

## Latihan 5 — Structured Inheritance

Tulis pseudo-code `StructuredTaskScope` dengan dua child yang membaca scoped context.

## Latihan 6 — ThreadLocal Migration

Ambil `ThreadLocal<TenantId>` dan rancang migrasi ke `ScopedValue<ExecutionContext>`.

## Latihan 7 — Detached Task

Jelaskan kenapa detached audit task harus menerima explicit `AuditCommand`, bukan mengandalkan scoped context.

## Latihan 8 — Reactive Context

Jelaskan kenapa ScopedValue tidak otomatis cocok untuk reactive pipeline.

## Latihan 9 — Security Review

Tentukan field apa yang aman dan tidak aman disimpan dalam security context snapshot.

## Latihan 10 — Decision Practice

Pilih explicit parameter, ScopedValue, ThreadLocal, atau reactive context untuk 10 kasus berbeda di aplikasi.

---

# 43. Ringkasan

Scoped Values adalah mekanisme modern untuk immutable scoped context di Java.

Core lessons:

- Context passing adalah masalah lifecycle.
- Explicit context paling jelas untuk correctness-critical data.
- Ambient context mengurangi parameter plumbing tetapi menyembunyikan dependency.
- ThreadLocal adalah mutable per-thread ambient context.
- ThreadLocal punya risiko leak, stale context, propagation complexity, dan virtual-thread cardinality cost.
- InheritableThreadLocal adalah creation-time inheritance, bukan task-scope propagation.
- ScopedValue memberi immutable binding dalam scope.
- ScopedValue bertindak seperti implicit parameter dengan explicit lifetime.
- Binding otomatis hilang saat scope selesai.
- Nested binding otomatis restore outer binding.
- Scoped Values cocok dengan StructuredTaskScope; child subtasks dapat mewarisi binding.
- Scoped Values didesain untuk virtual threads dan structured concurrency.
- ScopedValue bukan pengganti semua method parameters.
- Context object harus kecil, immutable, dan valid untuk scope.
- Tenant/security context harus fail closed.
- Detached/background tasks harus menerima explicit immutable command.
- Reactive pipelines butuh reactive context semantics.
- Migrasi dari ThreadLocal harus berdasarkan lifecycle boundary.

Main rule:

```text
Use explicit parameters for domain truth,
ScopedValue for bounded immutable execution context,
ThreadLocal only for legacy/thread-bound compatibility,
and never let context outlive its scope.
```

---

# 44. Referensi

1. OpenJDK JEP 506 — Scoped Values  
   https://openjdk.org/jeps/506

2. Oracle Java SE 25 Guide — Scoped Values  
   https://docs.oracle.com/en/java/javase/25/core/scoped-values.html

3. Java SE 25 — `StructuredTaskScope`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html

4. Java SE 25 — `ScopedValue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html

5. OpenJDK JEP 505 — Structured Concurrency  
   https://openjdk.org/jeps/505

6. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

7. Java SE 25 — `ThreadLocal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadLocal.html

8. Java SE 25 — `InheritableThreadLocal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/InheritableThreadLocal.html

9. Java SE 25 — `Executors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html

10. Java SE 25 — Preview List  
    https://docs.oracle.com/en/java/javase/25/docs/api/preview-list.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-concurrency-and-reactive-part-016.md">⬅️ Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 016</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-concurrency-and-reactive-part-018.md">Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 018 ➡️</a>
</div>

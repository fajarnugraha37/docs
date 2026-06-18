# learn-java-concurrency-and-reactive-part-012.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 012  
# ThreadLocal: Power, Danger, Memory Leak, Context Propagation, InheritableThreadLocal, MDC, Security Context, Virtual Threads, and Scoped Values

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **012**  
> Fokus: memahami `ThreadLocal` sebagai mekanisme menyimpan data per-thread, sekaligus memahami bahaya tersembunyi: memory leak di thread pool, context leak antar request, lifecycle yang tidak jelas, propagation yang salah, `InheritableThreadLocal`, MDC/security/tenant context, virtual threads, dan alternatif modern seperti explicit context passing serta Scoped Values.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa ThreadLocal Ada](#2-kenapa-threadlocal-ada)
3. [Mental Model ThreadLocal](#3-mental-model-threadlocal)
4. [API Dasar ThreadLocal](#4-api-dasar-threadlocal)
5. [`initialValue` dan `withInitial`](#5-initialvalue-dan-withinitial)
6. [ThreadLocal Bukan Global Variable Biasa](#6-threadlocal-bukan-global-variable-biasa)
7. [Use Case Umum](#7-use-case-umum)
8. [Request Context](#8-request-context)
9. [Logging MDC](#9-logging-mdc)
10. [Security Context](#10-security-context)
11. [Tenant Context](#11-tenant-context)
12. [Transaction Context](#12-transaction-context)
13. [The Golden Rule: Set, Use, Remove](#13-the-golden-rule-set-use-remove)
14. [Memory Leak di Thread Pool](#14-memory-leak-di-thread-pool)
15. [Context Leak Antar Request](#15-context-leak-antar-request)
16. [ThreadLocal with ExecutorService](#16-threadlocal-with-executorservice)
17. [Context Propagation Wrapper](#17-context-propagation-wrapper)
18. [Why Propagation Is Hard](#18-why-propagation-is-hard)
19. [InheritableThreadLocal](#19-inheritablethreadlocal)
20. [InheritableThreadLocal Pitfalls](#20-inheritablethreadlocal-pitfalls)
21. [ThreadLocal and Virtual Threads](#21-threadlocal-and-virtual-threads)
22. [Virtual Threads: Less Pool Leak, More Cardinality Risk](#22-virtual-threads-less-pool-leak-more-cardinality-risk)
23. [ThreadLocal and Structured Concurrency](#23-threadlocal-and-structured-concurrency)
24. [Scoped Values as Modern Alternative](#24-scoped-values-as-modern-alternative)
25. [ThreadLocal vs Scoped Value](#25-threadlocal-vs-scoped-value)
26. [Explicit Context Passing](#26-explicit-context-passing)
27. [Context Object Pattern](#27-context-object-pattern)
28. [ThreadLocal for Caches and Buffers](#28-threadlocal-for-caches-and-buffers)
29. [ThreadLocalRandom](#29-threadlocalrandom)
30. [ClassLoader Leak in Application Servers](#30-classloader-leak-in-application-servers)
31. [Testing ThreadLocal Code](#31-testing-threadlocal-code)
32. [Observability and Debugging](#32-observability-and-debugging)
33. [Production Hygiene Checklist](#33-production-hygiene-checklist)
34. [Mini Case Study: User Context Leak](#34-mini-case-study-user-context-leak)
35. [Mini Case Study: MDC Missing in Async Task](#35-mini-case-study-mdc-missing-in-async-task)
36. [Mini Case Study: ThreadLocal Cache Explosion with Virtual Threads](#36-mini-case-study-threadlocal-cache-explosion-with-virtual-threads)
37. [Common Anti-Patterns](#37-common-anti-patterns)
38. [Best Practices](#38-best-practices)
39. [Decision Matrix](#39-decision-matrix)
40. [Latihan](#40-latihan)
41. [Ringkasan](#41-ringkasan)
42. [Referensi](#42-referensi)

---

# 1. Tujuan Bagian Ini

`ThreadLocal` terlihat sederhana:

```java
private static final ThreadLocal<String> CURRENT_USER = new ThreadLocal<>();

CURRENT_USER.set("fajar");
String user = CURRENT_USER.get();
CURRENT_USER.remove();
```

Tetapi di production, `ThreadLocal` adalah salah satu sumber bug paling licin:

- data user A muncul di request user B;
- log correlation ID hilang di async task;
- memory leak karena thread pool reuse;
- security context stale;
- tenant context salah;
- transaction context dipakai di thread yang salah;
- test saling mempengaruhi;
- virtual threads menciptakan terlalu banyak ThreadLocal values;
- classloader leak saat redeploy aplikasi.

Java SE 25 mendokumentasikan `ThreadLocal` sebagai variabel per-thread: setiap thread yang mengaksesnya punya copy sendiri yang diinisialisasi secara independen. Biasanya `ThreadLocal` dideklarasikan sebagai `private static` field untuk mengasosiasikan state dengan thread seperti user ID atau transaction ID.

Target bagian ini:

```text
Mampu memakai ThreadLocal dengan aman, tahu kapan menghindarinya,
dan tahu alternatif seperti explicit context dan Scoped Values.
```

---

# 2. Kenapa ThreadLocal Ada

ThreadLocal ada untuk kasus ketika banyak layer kode perlu mengakses context yang sama tanpa menambah parameter di setiap method.

Contoh call stack:

```text
Controller
  -> Service
      -> Repository
          -> SQL Logger
```

Semua layer mungkin butuh:

- correlation ID;
- tenant ID;
- current user;
- locale;
- transaction context;
- trace/span context.

Tanpa ThreadLocal:

```java
service.process(request, context);
repository.save(entity, context);
logger.log(sql, context);
```

Dengan ThreadLocal:

```java
RequestContextHolder.set(context);

service.process(request); // inner layers call RequestContextHolder.get()
```

## 2.1 Convenience

ThreadLocal mengurangi parameter plumbing.

## 2.2 Hidden dependency

Tetapi convenience ini membuat dependency tersembunyi.

Method terlihat seperti:

```java
repository.save(entity);
```

Padahal diam-diam bergantung pada:

```java
TenantContext.get()
SecurityContext.get()
TransactionContext.get()
```

## 2.3 Main rule

```text
ThreadLocal trades explicit parameters for hidden ambient context.
Use it only when that trade-off is worth it.
```

---

# 3. Mental Model ThreadLocal

ThreadLocal bukan map global sederhana.

Lebih tepat:

```text
Every Thread has its own internal map:
  ThreadLocal key -> value
```

Jika ada:

```java
static final ThreadLocal<RequestContext> CTX = new ThreadLocal<>();
```

Maka:

```text
Thread-1: CTX -> RequestContext(A)
Thread-2: CTX -> RequestContext(B)
Thread-3: no value
```

`CTX.get()` pada masing-masing thread mengembalikan value berbeda.

## 3.1 Same ThreadLocal object, different per-thread values

Object ThreadLocal sama, tetapi value per thread berbeda.

## 3.2 Value belongs to thread lifetime

Jika thread hidup lama, value bisa ikut hidup lama.

Ini penting untuk thread pool.

## 3.3 Main rule

```text
ThreadLocal value lifetime is tied to the thread unless explicitly removed.
```

---

# 4. API Dasar ThreadLocal

## 4.1 Create

```java
private static final ThreadLocal<RequestContext> CURRENT_CONTEXT =
    new ThreadLocal<>();
```

## 4.2 Set

```java
CURRENT_CONTEXT.set(context);
```

## 4.3 Get

```java
RequestContext context = CURRENT_CONTEXT.get();
```

Returns null if no value and no initial value.

## 4.4 Remove

```java
CURRENT_CONTEXT.remove();
```

Removes current thread's value.

## 4.5 Pattern

```java
CURRENT_CONTEXT.set(context);
try {
    doWork();
} finally {
    CURRENT_CONTEXT.remove();
}
```

## 4.6 Main rule

```text
Every set must have a matching remove in finally unless lifetime is truly thread lifetime.
```

---

# 5. `initialValue` dan `withInitial`

## 5.1 Override initialValue

```java
private static final ThreadLocal<DateFormat> FORMAT =
    new ThreadLocal<>() {
        @Override
        protected DateFormat initialValue() {
            return new SimpleDateFormat("yyyy-MM-dd");
        }
    };
```

## 5.2 withInitial

```java
private static final ThreadLocal<StringBuilder> BUFFER =
    ThreadLocal.withInitial(() -> new StringBuilder(1024));
```

## 5.3 Caution

Initial value is per thread.

In platform thread pool:

```text
one buffer per worker thread
```

In virtual threads:

```text
potentially one buffer per virtual thread
```

This can explode memory.

## 5.4 Main rule

```text
ThreadLocal.withInitial creates per-thread values.
Think about thread cardinality before storing heavy objects.
```

---

# 6. ThreadLocal Bukan Global Variable Biasa

ThreadLocal looks like global variable because field often static.

```java
static final ThreadLocal<TenantId> TENANT = new ThreadLocal<>();
```

But value is not global.

It is per-thread.

## 6.1 Hidden global key

The key is global, the value is local to thread.

## 6.2 Consequence

If execution moves to another thread, value is missing.

Example:

```java
TENANT.set(tenantId);

executor.submit(() -> {
    TENANT.get(); // likely null unless propagated
});
```

## 6.3 Main rule

```text
ThreadLocal context does not automatically cross thread boundaries.
```

---

# 7. Use Case Umum

ThreadLocal is commonly used for:

## 7.1 Logging MDC

Correlation/request ID in logs.

## 7.2 Security context

Current authenticated principal.

## 7.3 Tenant context

Multi-tenant routing/filtering.

## 7.4 Locale/timezone

Request-specific formatting.

## 7.5 Transaction context

Framework-managed transaction resources.

## 7.6 Trace/span context

Distributed tracing.

## 7.7 Per-thread reusable object

Buffers, formatters, parsers.

## 7.8 Main rule

```text
ThreadLocal is best for small, request-scoped ambient metadata,
not arbitrary business state.
```

---

# 8. Request Context

Example:

```java
record RequestContext(
    String requestId,
    String correlationId,
    UserId userId,
    TenantId tenantId,
    Instant deadline
) {}
```

Holder:

```java
final class RequestContextHolder {
    private static final ThreadLocal<RequestContext> CURRENT =
        new ThreadLocal<>();

    static void set(RequestContext context) {
        CURRENT.set(context);
    }

    static RequestContext get() {
        RequestContext context = CURRENT.get();
        if (context == null) {
            throw new IllegalStateException("No request context bound");
        }
        return context;
    }

    static void clear() {
        CURRENT.remove();
    }
}
```

Servlet filter style:

```java
RequestContextHolder.set(context);
try {
    chain.doFilter(request, response);
} finally {
    RequestContextHolder.clear();
}
```

## 8.1 Main rule

```text
Bind request context at boundary, clear it at boundary.
```

---

# 9. Logging MDC

MDC usually uses ThreadLocal internally.

Pattern:

```java
MDC.put("correlationId", correlationId);
try {
    service.handle(request);
} finally {
    MDC.clear();
}
```

## 9.1 Async problem

If task runs on another thread, MDC may be missing.

```java
executor.submit(() -> log.info("async work"));
```

## 9.2 Wrapper

Capture MDC map and restore in worker.

Pseudo-code:

```java
Map<String, String> captured = MDC.getCopyOfContextMap();

executor.submit(() -> {
    Map<String, String> previous = MDC.getCopyOfContextMap();
    try {
        MDC.setContextMap(captured);
        doWork();
    } finally {
        if (previous == null) {
            MDC.clear();
        } else {
            MDC.setContextMap(previous);
        }
    }
});
```

## 9.3 Main rule

```text
MDC is thread-local. Async boundaries need explicit MDC propagation or reconstruction.
```

---

# 10. Security Context

Security frameworks often store current user in ThreadLocal.

## 10.1 Danger

If not cleared:

```text
request B may see request A user
```

## 10.2 Async danger

If not propagated:

```text
async task may run without user
```

If propagated wrongly:

```text
async task may run as stale/wrong user
```

## 10.3 Better for async tasks

Pass explicit security snapshot:

```java
record SecuritySnapshot(UserId userId, Set<Role> roles) {}
```

## 10.4 Main rule

```text
Security context must be explicitly bounded and cleared.
Wrong context is a security bug, not just a concurrency bug.
```

---

# 11. Tenant Context

Tenant context often controls:

- database schema;
- row filters;
- API credentials;
- cache namespace;
- routing.

## 11.1 Danger

Stale tenant context can cause data leakage.

```text
Tenant A request processed under Tenant B context
```

## 11.2 Avoid hidden tenant dependency when possible

Prefer explicit tenant parameter in domain/service APIs.

```java
repository.findCases(tenantId, filter);
```

instead of:

```java
repository.findCases(filter); // hidden TenantContext.get()
```

## 11.3 Main rule

```text
Tenant context bugs are data isolation bugs.
Prefer explicit tenant IDs for business-critical paths.
```

---

# 12. Transaction Context

Many transaction frameworks bind transaction/session resources to current thread.

## 12.1 Async boundary problem

```java
@Transactional
void handle() {
    executor.submit(() -> repository.save(entity));
}
```

The async task runs on another thread.

It likely does not share the same transaction context.

## 12.2 Better

Async task opens its own transaction:

```java
executor.submit(() -> transactionalService.process(command));
```

## 12.3 Main rule

```text
Do not assume ThreadLocal transaction context crosses executor boundaries.
```

---

# 13. The Golden Rule: Set, Use, Remove

The safe ThreadLocal pattern:

```java
CURRENT.set(value);
try {
    doWork();
} finally {
    CURRENT.remove();
}
```

## 13.1 Why remove, not set null?

`remove` removes entry for current thread.

```java
CURRENT.remove();
```

Setting null may leave entry structure around depending implementation behavior and still expresses unclear lifecycle.

## 13.2 Nested context

If context can be nested, restore previous value.

```java
RequestContext previous = CURRENT.get();
CURRENT.set(next);
try {
    doWork();
} finally {
    if (previous == null) {
        CURRENT.remove();
    } else {
        CURRENT.set(previous);
    }
}
```

## 13.3 Main rule

```text
ThreadLocal must be scoped.
Scope means restore or remove in finally.
```

---

# 14. Memory Leak di Thread Pool

Thread pools reuse platform threads.

Example:

```java
static final ThreadLocal<byte[]> BUFFER =
    ThreadLocal.withInitial(() -> new byte[10 * 1024 * 1024]);
```

Pool has 100 threads:

```text
100 × 10MB = 1GB retained
```

Even after task ends, thread lives, ThreadLocal value lives.

## 14.1 Request data leak

```java
CURRENT_REQUEST.set(largeRequestObject);
// no remove
```

Worker thread retains request.

## 14.2 Why pool makes it worse

Thread lifetime >> request lifetime.

## 14.3 Main rule

```text
In thread pools, ThreadLocal values can live as long as worker threads.
Always remove request-scoped values.
```

---

# 15. Context Leak Antar Request

Thread pool worker:

```text
worker-1 handles request A
sets CURRENT_USER = Alice
forgets remove
worker-1 handles request B
CURRENT_USER still Alice
```

This can cause:

- wrong logs;
- wrong tenant;
- wrong authorization;
- wrong audit;
- data leak.

## 15.1 Test may not catch

If each test uses new thread, leak invisible.

Production pool reuse exposes it.

## 15.2 Main rule

```text
For request-scoped ThreadLocal, forgetting remove is correctness and security bug.
```

---

# 16. ThreadLocal with ExecutorService

Submitting task to executor changes thread.

ThreadLocal is not automatically available.

```java
RequestContextHolder.set(context);

executor.submit(() -> {
    RequestContextHolder.get(); // may fail/null
});
```

## 16.1 Capture and install

```java
RequestContext captured = RequestContextHolder.getOrNull();

executor.submit(() -> {
    RequestContext previous = RequestContextHolder.getOrNull();
    try {
        if (captured != null) {
            RequestContextHolder.set(captured);
        }
        doWork();
    } finally {
        if (previous == null) {
            RequestContextHolder.clear();
        } else {
            RequestContextHolder.set(previous);
        }
    }
});
```

## 16.2 But be careful

Propagating context may be wrong if task outlives request.

## 16.3 Main rule

```text
Context propagation must be intentional, not automatic by accident.
```

---

# 17. Context Propagation Wrapper

A generic wrapper:

```java
record ContextSnapshot(
    RequestContext requestContext,
    SecuritySnapshot security,
    Map<String, String> mdc
) {}

final class ContextAwareExecutor implements Executor {
    private final Executor delegate;

    ContextAwareExecutor(Executor delegate) {
        this.delegate = delegate;
    }

    @Override
    public void execute(Runnable command) {
        ContextSnapshot captured = ContextSnapshot.capture();

        delegate.execute(() -> {
            ContextSnapshot previous = ContextSnapshot.capture();
            try {
                captured.install();
                command.run();
            } finally {
                previous.install();
            }
        });
    }
}
```

## 17.1 Requirements

- capture only immutable/safe data;
- restore previous context;
- clear missing values;
- avoid propagating transaction context blindly;
- define task lifetime.

## 17.2 Main rule

```text
A context propagation wrapper must restore previous state, not just set new state.
```

---

# 18. Why Propagation Is Hard

Propagation is hard because contexts differ.

## 18.1 Logging context

Usually safe to propagate snapshot.

## 18.2 Security context

May or may not be safe depending async task semantics.

## 18.3 Transaction context

Usually unsafe to propagate manually.

## 18.4 Request deadline

Should be propagated, but task should honor it.

## 18.5 Tenant

Should be explicit and immutable.

## 18.6 Large objects

Should not be propagated.

## 18.7 Main rule

```text
Do not propagate “everything”.
Propagate only context that is valid for the child task lifetime.
```

---

# 19. InheritableThreadLocal

`InheritableThreadLocal` lets child threads inherit parent thread-local values when child thread is created. Java SE 25 docs describe it as preferred over ordinary ThreadLocal when per-thread attributes such as user ID or transaction ID must be automatically transmitted to child threads.

Example:

```java
static final InheritableThreadLocal<String> USER =
    new InheritableThreadLocal<>();
```

Parent:

```java
USER.set("alice");
Thread.ofPlatform().start(() -> {
    System.out.println(USER.get()); // alice
});
```

## 19.1 Child value

Can override:

```java
protected T childValue(T parentValue)
```

## 19.2 Thread.Builder opt-out

Java SE 25 `Thread` docs note that during creation of a new thread it is possible to opt out of receiving initial values for inheritable-thread-local variables.

## 19.3 Main rule

```text
InheritableThreadLocal copies context at thread creation, not at task submission.
```

---

# 20. InheritableThreadLocal Pitfalls

## 20.1 Thread pool problem

Pool threads are created before request context.

So inherited value is not per submitted task.

## 20.2 Stale context

If worker inherited context once, it may persist incorrectly.

## 20.3 Mutable inherited object

Parent and child may share same mutable reference unless copied.

## 20.4 Too broad propagation

Sensitive context may reach child threads unintentionally.

## 20.5 Virtual threads

Creating many child virtual threads may inherit context widely, increasing memory and hidden dependencies.

## 20.6 Main rule

```text
InheritableThreadLocal is rarely the right solution for executor task context propagation.
```

---

# 21. ThreadLocal and Virtual Threads

Virtual threads are still `Thread`.

They support ThreadLocal.

JEP 444 finalized virtual threads and states that virtual threads support thread-local variables, partly for compatibility with existing code.

## 21.1 Good news

With virtual-thread-per-task, each task gets fresh virtual thread.

This reduces classic platform pool leak across requests.

## 21.2 Bad news

If every virtual thread initializes heavy ThreadLocal value, memory explodes.

Example:

```java
static final ThreadLocal<byte[]> BUFFER =
    ThreadLocal.withInitial(() -> new byte[1024 * 1024]);
```

100,000 virtual threads:

```text
potentially huge memory
```

## 21.3 Main rule

```text
Virtual threads reduce thread reuse leaks,
but make per-thread storage cardinality much larger.
```

---

# 22. Virtual Threads: Less Pool Leak, More Cardinality Risk

Platform pool risk:

```text
stale value reused by next request on same worker
```

Virtual thread per task risk:

```text
too many ThreadLocal values because too many threads
```

## 22.1 Avoid heavy per-thread caches

Old pattern:

```java
ThreadLocal<Buffer> reusableBuffer
```

May be okay with 50 platform workers.

Bad with 50,000 virtual threads.

## 22.2 Prefer local variables

```java
byte[] buffer = new byte[size];
```

or object pooling carefully if truly needed.

## 22.3 Main rule

```text
Do not carry platform-thread-era ThreadLocal cache patterns into virtual-thread-per-task systems blindly.
```

---

# 23. ThreadLocal and Structured Concurrency

Structured concurrency creates child tasks with clear parent lifetime.

ThreadLocal can still be awkward:

- mutable;
- unbounded lifetime unless removed;
- hidden dependencies;
- inheritance semantics can be surprising.

Scoped Values were designed partly to work better with child threads and structured concurrency.

## 23.1 Main rule

```text
For parent-to-child immutable context in structured concurrency,
prefer scoped values or explicit parameters over mutable ThreadLocal.
```

---

# 24. Scoped Values as Modern Alternative

JEP 506 introduces Scoped Values, which enable sharing immutable data with callees in a thread and child threads. The JEP states that Scoped Values are easier to reason about than thread-local variables and have lower space/time costs, especially with virtual threads and structured concurrency.

Conceptual example:

```java
private static final ScopedValue<RequestContext> REQUEST_CONTEXT =
    ScopedValue.newInstance();

ScopedValue.where(REQUEST_CONTEXT, context)
    .run(() -> service.handle(request));
```

Inside:

```java
RequestContext context = REQUEST_CONTEXT.get();
```

## 24.1 Key idea

Value is bound for a lexical/dynamic scope.

After scope exits, value is gone automatically.

## 24.2 Immutable data

Scoped values are intended for immutable context.

## 24.3 Better lifetime

Unlike ThreadLocal, lifetime is bounded by scope.

## 24.4 Main rule

```text
Scoped Values are a safer model for bounded, immutable, parent-to-callee context.
```

---

# 25. ThreadLocal vs Scoped Value

| Aspect | ThreadLocal | Scoped Value |
|---|---|---|
| Mutability | mutable set/remove | immutable binding |
| Lifetime | unbounded unless removed | bounded by scope |
| Propagation | manual/inheritable quirks | designed for callees/child threads |
| Leak risk | high if remove forgotten | lower due to scope |
| Use case | legacy context, per-thread state | immutable request context |
| Virtual thread fit | compatible but can be costly | designed to be efficient |
| Reasoning | hidden mutable ambient state | scoped immutable ambient value |

## 25.1 Migration mindset

ThreadLocal:

```java
CURRENT_USER.set(user);
try {
    service.call();
} finally {
    CURRENT_USER.remove();
}
```

Scoped Value:

```java
ScopedValue.where(CURRENT_USER, user)
    .run(() -> service.call());
```

## 25.2 Main rule

```text
If context is immutable and naturally scoped, Scoped Value is usually a better mental model.
```

---

# 26. Explicit Context Passing

The simplest and clearest approach:

```java
service.handle(request, context);
repository.findCases(context.tenantId(), filter);
```

## 26.1 Pros

- explicit dependencies;
- easy testing;
- no thread boundary bug;
- no cleanup leak;
- easier reasoning;
- works with virtual threads/reactive.

## 26.2 Cons

- parameter plumbing;
- method signature noise;
- cross-cutting concerns can spread.

## 26.3 Main rule

```text
For business-critical context like tenant/security/deadline,
prefer explicit context unless framework constraints justify ambient context.
```

---

# 27. Context Object Pattern

Instead of many parameters:

```java
record ExecutionContext(
    TenantId tenantId,
    UserId userId,
    String correlationId,
    Instant deadline,
    Locale locale
) {}
```

Use:

```java
service.process(context, command);
```

## 27.1 Make it immutable

Use records and immutable components.

## 27.2 Do not put everything

Avoid giant god context.

## 27.3 Main rule

```text
A small immutable context object is often better than many ThreadLocals.
```

---

# 28. ThreadLocal for Caches and Buffers

Old use case:

```java
private static final ThreadLocal<StringBuilder> BUFFER =
    ThreadLocal.withInitial(() -> new StringBuilder(4096));
```

## 28.1 Works sometimes

With small bounded platform thread pool, it can reduce allocation.

## 28.2 Risks

- retained memory per thread;
- dirty state if not reset;
- huge memory with many virtual threads;
- classloader leak;
- unnecessary with modern GC.

## 28.3 Safer

Use local allocation unless profiling proves problem.

```java
StringBuilder buffer = new StringBuilder(4096);
```

## 28.4 Main rule

```text
ThreadLocal caches are performance optimizations with lifecycle cost.
Do not use without measurement.
```

---

# 29. ThreadLocalRandom

`ThreadLocalRandom` avoids contention in random number generation.

Use:

```java
int value = ThreadLocalRandom.current().nextInt(100);
```

## 29.1 Do not manually store Random in ThreadLocal casually

Use the built-in utility where appropriate.

## 29.2 Security

For cryptographic randomness, use `SecureRandom`, not ThreadLocalRandom.

## 29.3 Main rule

```text
Use ThreadLocalRandom for non-cryptographic concurrent random values.
```

---

# 30. ClassLoader Leak in Application Servers

In app servers, worker threads may outlive application classloader.

If ThreadLocal value references application classes and not removed:

```text
container thread -> ThreadLocalMap -> app object -> app classloader
```

Redeploy cannot GC old app.

## 30.1 Common causes

- static ThreadLocal in app code;
- values not removed;
- third-party libraries;
- large context objects;
- thread pools not stopped.

## 30.2 Main rule

```text
In managed containers, ThreadLocal cleanup is also classloader hygiene.
```

---

# 31. Testing ThreadLocal Code

## 31.1 Clear before/after tests

```java
@BeforeEach
void setUp() {
    ContextHolder.clear();
}

@AfterEach
void tearDown() {
    ContextHolder.clear();
}
```

## 31.2 Test leak

Run two logical requests on same single-thread executor.

```java
ExecutorService executor = Executors.newSingleThreadExecutor();
```

Request A sets context but forgets remove.

Request B checks no context.

## 31.3 Test async propagation

Verify expected context in worker.

## 31.4 Main rule

```text
ThreadLocal tests should simulate thread reuse.
```

---

# 32. Observability and Debugging

## 32.1 Symptoms

- wrong user in logs;
- missing correlation ID in async logs;
- tenant mismatch;
- memory retained after request;
- test order dependency;
- redeploy memory leak.

## 32.2 What to inspect

- boundaries where set/remove happen;
- executor submissions;
- MDC propagation;
- security context wrappers;
- thread pool reuse;
- heap dump retaining paths;
- ThreadLocal values;
- virtual thread count.

## 32.3 Add guardrails

- context required checks;
- clear filters;
- wrappers;
- tests;
- metrics for missing context;
- request ID in all logs.

## 32.4 Main rule

```text
Most ThreadLocal bugs are boundary bugs:
request boundary, async boundary, lifecycle boundary.
```

---

# 33. Production Hygiene Checklist

For every ThreadLocal, document:

```text
What value type?
Who sets it?
At what boundary?
Who removes it?
Can it be nested?
Can it cross async boundary?
Is value immutable?
How big can value be?
Does it contain security/tenant data?
Does it work with virtual threads?
Does it need migration to ScopedValue?
```

## 33.1 Code checklist

- `private static final`;
- no large mutable values;
- set in boundary;
- remove in finally;
- restore previous if nested;
- tests simulate thread reuse;
- no transaction propagation hack;
- no hidden business-critical dependency if avoidable.

## 33.2 Main rule

```text
Every ThreadLocal must have a lifecycle policy.
```

---

# 34. Mini Case Study: User Context Leak

## 34.1 Broken

```java
static final ThreadLocal<UserId> CURRENT_USER = new ThreadLocal<>();

void handle(Request request) {
    CURRENT_USER.set(request.userId());
    service.process(request);
}
```

No remove.

## 34.2 Failure

Worker handles Alice then Bob.

Bob request may still see Alice if Bob path does not set/clear correctly.

## 34.3 Fix

```java
void handle(Request request) {
    CURRENT_USER.set(request.userId());
    try {
        service.process(request);
    } finally {
        CURRENT_USER.remove();
    }
}
```

## 34.4 Better

Use immutable `ExecutionContext`.

```java
service.process(context, command);
```

## 34.5 Lesson

```text
Request-scoped ThreadLocal must be cleared in finally.
```

---

# 35. Mini Case Study: MDC Missing in Async Task

## 35.1 Problem

```java
MDC.put("correlationId", correlationId);

executor.submit(() -> {
    log.info("Async work"); // no correlationId
});
```

## 35.2 Cause

Worker thread has different MDC ThreadLocal.

## 35.3 Fix

Capture MDC snapshot and install in worker.

```java
Map<String, String> captured = MDC.getCopyOfContextMap();

executor.submit(() -> {
    try {
        if (captured != null) {
            MDC.setContextMap(captured);
        }
        doWork();
    } finally {
        MDC.clear();
    }
});
```

## 35.4 Better wrapper

Centralize in context-aware executor.

## 35.5 Lesson

```text
Async logging context requires explicit propagation.
```

---

# 36. Mini Case Study: ThreadLocal Cache Explosion with Virtual Threads

## 36.1 Code

```java
static final ThreadLocal<byte[]> SCRATCH =
    ThreadLocal.withInitial(() -> new byte[1024 * 1024]);
```

## 36.2 Old platform pool

100 workers:

```text
~100MB scratch
```

## 36.3 Virtual-thread-per-task

50,000 concurrent virtual threads:

```text
potentially enormous memory pressure
```

## 36.4 Fix

- local buffer;
- smaller allocation;
- pooled resource with limit;
- streaming design;
- avoid per-thread heavy cache.

## 36.5 Lesson

```text
ThreadLocal cache patterns must be re-evaluated for virtual threads.
```

---

# 37. Common Anti-Patterns

## 37.1 Static ThreadLocal as hidden global state

Used everywhere without lifecycle.

## 37.2 No remove

Memory/context leak.

## 37.3 Storing large request object

Retention and leak.

## 37.4 Storing mutable context

Unexpected mutation across layers.

## 37.5 Propagating transaction context manually

Dangerous.

## 37.6 InheritableThreadLocal with thread pools

Wrong semantics.

## 37.7 ThreadLocal cache in virtual-thread-per-task app

Memory explosion.

## 37.8 Business logic depends on ThreadLocal silently

Hard tests and hidden coupling.

## 37.9 Clearing only on success

Exception path leaks context.

## 37.10 Setting null instead of remove

Unclear lifecycle.

---

# 38. Best Practices

## 38.1 Prefer explicit context for business-critical data

Tenant/security/deadline should often be explicit.

## 38.2 Use ThreadLocal for small scoped metadata

Logging/correlation context can be reasonable.

## 38.3 Always remove in finally

Non-negotiable for request-scoped values.

## 38.4 Restore previous context for nesting

Avoid breaking outer scope.

## 38.5 Propagate only immutable snapshots

No live request/entity objects.

## 38.6 Avoid heavy ThreadLocal values

Especially with virtual threads.

## 38.7 Avoid InheritableThreadLocal with executors

Use explicit capture/install.

## 38.8 Test with thread reuse

Single-thread executor tests catch leaks.

## 38.9 Consider Scoped Values

For immutable scoped context on modern Java.

## 38.10 Document lifecycle

Every ThreadLocal must have owner and boundary.

---

# 39. Decision Matrix

| Need | Recommended |
|---|---|
| Correlation ID in sync request logs | MDC/ThreadLocal with clear filter |
| Correlation ID across async task | explicit MDC propagation wrapper |
| Tenant ID for repository | explicit parameter preferred |
| Security context | explicit snapshot or framework-managed with strict clear |
| Transaction context | framework-managed; do not manually propagate |
| Request deadline | explicit context object |
| Small per-thread formatter in bounded platform pool | ThreadLocal possible |
| Heavy buffer in virtual threads | avoid ThreadLocal |
| Parent-to-child immutable context | Scoped Value / explicit context |
| Context in reactive pipeline | reactive context, not ThreadLocal |
| Per-request mutable state | request-confined object or immutable snapshot |
| Executor task context | capture/install/restore wrapper |
| Durable async job | persist command/context, not ThreadLocal |

---

# 40. Latihan

## Latihan 1 — Safe Holder

Buat `RequestContextHolder` dengan `set`, `get`, `getOrNull`, dan `clear`.

## Latihan 2 — Finally Remove

Refactor kode yang set ThreadLocal tanpa `finally`.

## Latihan 3 — Leak Test

Gunakan single-thread executor untuk membuktikan context leak antar logical requests.

## Latihan 4 — MDC Propagation

Buat wrapper `Runnable` yang capture dan restore MDC.

## Latihan 5 — Nested Context

Implementasikan helper `withContext(context, runnable)` yang restore previous context.

## Latihan 6 — InheritableThreadLocal

Buat contoh inheritance ke child thread, lalu jelaskan kenapa tidak cocok untuk executor pool.

## Latihan 7 — Virtual Thread Memory

Hitung potensi memory jika ThreadLocal buffer 512KB dipakai oleh 20.000 virtual threads.

## Latihan 8 — Explicit Context

Refactor service yang membaca `TenantContext.get()` menjadi menerima `ExecutionContext`.

## Latihan 9 — Scoped Value Sketch

Tulis pseudo-code penggunaan Scoped Value untuk request context.

## Latihan 10 — Audit Checklist

Ambil satu ThreadLocal di project dan jawab: siapa set, siapa remove, value besar atau kecil, immutable atau mutable, async boundary ada atau tidak?

---

# 41. Ringkasan

ThreadLocal adalah tool kuat tetapi berbahaya jika lifecycle tidak jelas.

Core lessons:

- ThreadLocal memberi value berbeda untuk setiap thread.
- ThreadLocal sering dipakai untuk user ID, transaction ID, MDC, security, tenant, locale, trace context.
- ThreadLocal adalah hidden ambient context.
- Value tidak otomatis cross thread boundary.
- Set harus dipasangkan dengan remove di finally.
- Thread pools memperpanjang lifetime ThreadLocal values.
- Lupa remove dapat menyebabkan memory leak dan context leak antar request.
- Async task butuh explicit context propagation.
- Propagation harus capture immutable/safe context dan restore previous state.
- InheritableThreadLocal menyalin value saat child thread dibuat, bukan saat task submitted.
- InheritableThreadLocal sering salah untuk executor pools.
- Virtual threads mendukung ThreadLocal, tetapi heavy ThreadLocal values bisa menyebabkan memory pressure besar.
- Scoped Values menyediakan alternatif modern untuk immutable scoped context.
- Explicit context passing sering paling jelas untuk business-critical context.
- ThreadLocal caches harus dipakai hanya jika terukur dan bounded.
- Test ThreadLocal dengan thread reuse.

Main rule:

```text
ThreadLocal is safe only when scoped.
If you cannot name its owner, boundary, cleanup, propagation policy,
and value size, do not use it.
```

---

# 42. Referensi

1. Java SE 25 — `ThreadLocal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadLocal.html

2. Oracle Java SE 25 Guide — Thread-Local Variables  
   https://docs.oracle.com/en/java/javase/25/core/thread-local-variables.html

3. Java SE 25 — `InheritableThreadLocal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/InheritableThreadLocal.html

4. Java SE 25 — `Thread`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html

5. Oracle Java SE 25 Guide — Virtual Threads  
   https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html

6. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

7. OpenJDK JEP 506 — Scoped Values  
   https://openjdk.org/jeps/506

8. OpenJDK JEP 505 — Structured Concurrency  
   https://openjdk.org/jeps/505

9. Java SE 25 — `Executors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html

10. Java SE 25 — `ExecutorService`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-concurrency-and-reactive-part-011.md](./learn-java-concurrency-and-reactive-part-011.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-concurrency-and-reactive-part-013.md](./learn-java-concurrency-and-reactive-part-013.md)

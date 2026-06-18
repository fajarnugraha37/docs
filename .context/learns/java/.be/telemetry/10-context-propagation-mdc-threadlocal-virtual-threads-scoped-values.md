# Part 10 — Context Propagation: MDC, ThreadLocal, Virtual Threads, Scoped Values

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> Scope: Java 8 sampai Java 25  
> Fokus: bagaimana membawa diagnostic context secara benar melewati thread, executor, async flow, virtual thread, structured concurrency, logging framework, dan OpenTelemetry.

---

## 0. Tujuan Part Ini

Setelah memahami structured logging, kita masuk ke salah satu akar masalah observability paling sulit di Java backend: **context propagation**.

Di production, error jarang terjadi dalam satu method linear sederhana. Biasanya flow melewati:

```text
HTTP request
  -> security filter
  -> controller/resource
  -> service
  -> database
  -> external API
  -> executor / CompletableFuture
  -> message broker
  -> consumer
  -> batch retry
  -> scheduler compensation
```

Jika setiap log hanya berisi pesan seperti:

```text
ERROR Failed to process request
```

maka log itu hampir tidak berguna. Engineer perlu tahu:

```text
request.id       = apa?
correlation.id   = apa?
trace.id         = apa?
span.id          = apa?
user.id          = siapa? kalau aman disimpan
tenant.id        = tenant/agency mana?
case.id          = business entity mana?
message.id       = message broker event mana?
job.execution.id = batch execution mana?
```

Masalahnya: context tersebut harus tetap ada walaupun execution berpindah thread, masuk ke executor, masuk ke reactive pipeline, pindah service, dikirim lewat HTTP header, masuk message broker, atau dijalankan ulang oleh scheduler.

Part ini membahas mental model dan engineering pattern untuk itu.

---

## 1. Core Mental Model: Context Is Runtime Identity

Context propagation adalah kemampuan membawa **runtime identity** dari satu titik eksekusi ke titik lain.

Context bukan sekadar data tambahan. Context adalah jawaban dari pertanyaan:

> “Event ini bagian dari flow yang mana?”

Tanpa context, log adalah potongan kejadian terisolasi.

Dengan context, log menjadi bagian dari timeline.

Contoh tanpa context:

```text
INFO Calling payment service
ERROR Timeout calling payment service
INFO Retrying request
ERROR Failed to update status
```

Contoh dengan context:

```json
{
  "timestamp": "2026-06-18T09:00:00.123+07:00",
  "level": "ERROR",
  "event.name": "payment.call.failed",
  "trace.id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span.id": "00f067aa0ba902b7",
  "correlation.id": "corr-20260618-000123",
  "request.id": "req-9912",
  "case.id": "CASE-2026-10022",
  "dependency.name": "payment-service",
  "error.type": "java.net.SocketTimeoutException",
  "outcome": "failure"
}
```

Sekarang engineer bisa menghubungkan:

- request dari user,
- trace antar-service,
- log application,
- metric error rate,
- span dependency call,
- retry event,
- final failure.

Inilah inti context propagation.

---

## 2. Context Bukan Satu Jenis ID

Salah satu kesalahan umum adalah menganggap semua ID sama.

Di sistem nyata, beberapa ID memiliki fungsi berbeda.

| Field | Fungsi | Scope | Biasanya Dibuat Oleh |
|---|---|---|---|
| `trace.id` | Menghubungkan distributed trace | distributed request flow | tracing system / OTel |
| `span.id` | Mengidentifikasi operasi dalam trace | satu operation/span | tracing system / OTel |
| `correlation.id` | Menghubungkan business/technical flow lintas boundary | bisa lebih luas dari trace | gateway/service pertama |
| `request.id` | Mengidentifikasi inbound HTTP request | satu request hop | gateway/web container/app |
| `message.id` | Mengidentifikasi message broker event | satu message | producer/broker |
| `job.execution.id` | Mengidentifikasi batch/scheduler execution | satu run job | batch framework/app |
| `case.id` / `order.id` | Business entity identity | domain-specific | domain system |
| `tenant.id` / `agency.id` | Multi-tenant partition | tenant/account/agency | auth/domain layer |
| `user.id` | Actor identity | authenticated user/session | identity provider/app |

Context propagation bukan berarti semua field selalu ada. Prinsipnya:

> Propagate the IDs needed to reconstruct causality and impact.

---

## 3. The Context Boundary Problem

Context biasanya hilang di boundary.

Boundary adalah titik di mana flow berpindah dari satu execution model ke execution model lain.

Contoh boundary:

```text
HTTP request -> controller
controller -> executor
thread A -> thread B
service A -> service B
producer -> broker -> consumer
scheduler -> job execution
batch step -> chunk processor
virtual thread parent -> child task
reactive operator -> subscriber callback
```

Jika context hanya disimpan di local variable, context harus dikirim manual ke setiap method.

Jika context disimpan di `ThreadLocal`, context bisa hilang saat berpindah thread.

Jika context dikirim lewat HTTP header, context harus diextract dan diinject secara konsisten.

Jika context disimpan di MDC, log bisa berisi context, tetapi context belum tentu ikut pindah ke async task.

Karena itu context propagation harus dipahami sebagai desain lintas-layer.

---

## 4. Context Carrier: Di Mana Context Disimpan?

Context dapat disimpan di beberapa tempat.

### 4.1 Method Parameter

```java
void process(RequestContext ctx, Command command) {
    service.handle(ctx, command);
}
```

Kelebihan:

- explicit,
- testable,
- mudah dipahami,
- tidak magic,
- aman untuk async jika dikirim manual.

Kekurangan:

- melebar ke banyak method,
- bisa mengotori domain API,
- sulit jika context dipakai cross-cutting concern seperti logging/tracing/security.

Method parameter cocok untuk domain-critical context seperti:

- tenant,
- authenticated actor,
- command metadata,
- idempotency key,
- case/process ID.

### 4.2 ThreadLocal

```java
private static final ThreadLocal<RequestContext> CURRENT = new ThreadLocal<>();
```

Kelebihan:

- tidak perlu mengubah signature banyak method,
- mudah untuk cross-cutting concern,
- banyak framework Java lama memakai pola ini.

Kekurangan:

- context melekat ke thread, bukan logical flow,
- rawan leak di thread pool,
- rawan hilang di async execution,
- sulit dianalisis,
- berpotensi mahal/bermasalah jika digunakan sembarangan di banyak virtual thread.

ThreadLocal cocok untuk framework-level concern, bukan domain state utama.

### 4.3 MDC / ThreadContext

MDC adalah diagnostic context untuk logging.

SLF4J menyediakan `MDC` sebagai facade. Logback dan Log4j2 memiliki implementasi MDC/ThreadContext masing-masing.

Contoh:

```java
MDC.put("correlation.id", correlationId);
MDC.put("request.id", requestId);
try {
    log.info("request received");
    chain.doFilter(request, response);
} finally {
    MDC.clear();
}
```

MDC bagus untuk memperkaya log, tetapi jangan jadikan MDC sebagai source of truth domain.

Rule penting:

> MDC is a logging projection of context, not the authoritative context model.

### 4.4 OpenTelemetry Context

OpenTelemetry memiliki context sendiri untuk trace/span/baggage propagation.

Context OTel membawa:

- active span,
- trace context,
- baggage,
- propagation metadata.

OTel context dapat diextract dari inbound request dan diinject ke outbound request/message.

MDC dan OTel context sering perlu disinkronkan agar log memiliki `trace.id` dan `span.id`.

### 4.5 ScopedValue Java 20–25

Scoped Values adalah mekanisme Java modern untuk membagikan immutable data dalam dynamic scope. Scoped Values mulai sebagai incubator di JDK 20, preview di JDK 21, mengalami beberapa preview lanjutan, dan difinalkan di JDK 25.

Mental model ScopedValue:

```text
bind value for this execution scope
  run code
    any method below can read it
  scope ends
value no longer accessible
```

Berbeda dari `ThreadLocal`, ScopedValue memiliki lifetime yang jelas dan immutable binding.

Contoh konseptual Java modern:

```java
static final ScopedValue<RequestContext> REQUEST_CONTEXT = ScopedValue.newInstance();

ScopedValue.where(REQUEST_CONTEXT, ctx).run(() -> {
    service.handle(command);
});

// inside service
RequestContext ctx = REQUEST_CONTEXT.get();
```

Scoped Values sangat relevan untuk virtual threads dan structured concurrency karena context bisa dibagikan secara lebih aman ke method/child execution dalam scope yang jelas.

---

## 5. Java Version Landscape: Java 8 sampai Java 25

Context propagation strategy berubah tergantung Java version.

| Java Version | Practical Context Strategy |
|---|---|
| Java 8 | ThreadLocal, MDC, executor wrapper, servlet filter, manual OTel context if library supports |
| Java 11 | Sama seperti Java 8, lebih umum di microservices modern |
| Java 17 | Baseline enterprise modern, cocok untuk OTel agent, Spring Boot 3 awal tidak mendukung Java 8 |
| Java 21 | Virtual threads production-ready, ScopedValue preview, structured concurrency preview |
| Java 22–24 | ScopedValue preview refinement |
| Java 25 | ScopedValue final, semakin relevan untuk context immutable modern |

Prinsip lintas versi:

- Java 8–17: context propagation umumnya berbasis ThreadLocal/MDC + wrapper.
- Java 21+: virtual threads mengubah cost model dan thread lifecycle.
- Java 25+: ScopedValue dapat mulai dipertimbangkan sebagai carrier context yang lebih eksplisit lifetimenya.

---

## 6. MDC Deep Dive

MDC adalah singkatan dari Mapped Diagnostic Context.

Secara konsep, MDC adalah map per thread:

```text
current thread
  MDC map:
    correlation.id = corr-123
    request.id     = req-456
    user.id        = user-789
```

Logger layout mengambil MDC saat log event dibuat.

Contoh Logback pattern:

```xml
<pattern>%d %-5level [%thread] trace=%X{trace.id} corr=%X{correlation.id} req=%X{request.id} %logger - %msg%n</pattern>
```

Contoh Log4j2 pattern:

```xml
<PatternLayout pattern="%d %-5p [%t] trace=%X{trace.id} corr=%X{correlation.id} %c - %m%n"/>
```

Untuk JSON logging, MDC biasanya diekspor sebagai fields.

Contoh output:

```json
{
  "timestamp": "2026-06-18T09:00:00.000+07:00",
  "level": "INFO",
  "message": "request received",
  "correlation.id": "corr-123",
  "request.id": "req-456"
}
```

---

## 7. MDC Lifecycle Rule

MDC harus selalu mengikuti pola:

```java
MDC.put("correlation.id", correlationId);
try {
    doWork();
} finally {
    MDC.remove("correlation.id");
}
```

Atau jika banyak field:

```java
try {
    MDC.put("correlation.id", correlationId);
    MDC.put("request.id", requestId);
    MDC.put("tenant.id", tenantId);
    chain.doFilter(request, response);
} finally {
    MDC.clear();
}
```

Namun `MDC.clear()` harus hati-hati jika framework lain juga mengisi MDC. Dalam filter paling luar, `clear()` biasanya aman. Dalam library/helper, lebih aman restore previous context.

Pattern restore:

```java
Map<String, String> previous = MDC.getCopyOfContextMap();
try {
    MDC.put("operation", "case.submit");
    doWork();
} finally {
    if (previous == null) {
        MDC.clear();
    } else {
        MDC.setContextMap(previous);
    }
}
```

Rule:

> Whoever sets context must either remove it or restore the previous context.

---

## 8. MDC Leak in Thread Pools

Thread pool menggunakan ulang thread.

Jika request A menaruh MDC lalu tidak membersihkan, request B yang kebetulan memakai thread yang sama bisa mewarisi context request A.

Contoh masalah:

```text
request A on http-nio-8080-exec-7
  MDC correlation.id = corr-A
  exception occurs
  MDC not cleared

request B on same thread
  logs show correlation.id = corr-A
```

Dampak:

- forensic salah,
- incident timeline salah,
- security risk,
- tenant/user leakage,
- audit evidence rusak.

Karena itu filter harus memakai `finally`.

---

## 9. Servlet Filter Pattern untuk MDC

Untuk servlet-based stack:

```java
public final class CorrelationMdcFilter implements Filter {

    private static final String CORRELATION_ID = "correlation.id";
    private static final String REQUEST_ID = "request.id";

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        String incomingCorrelationId = request.getHeader("X-Correlation-Id");
        String correlationId = isUsableId(incomingCorrelationId)
                ? incomingCorrelationId
                : newCorrelationId();

        String requestId = newRequestId();

        Map<String, String> previous = MDC.getCopyOfContextMap();
        try {
            MDC.put(CORRELATION_ID, correlationId);
            MDC.put(REQUEST_ID, requestId);

            response.setHeader("X-Correlation-Id", correlationId);
            response.setHeader("X-Request-Id", requestId);

            chain.doFilter(request, response);
        } finally {
            if (previous == null) {
                MDC.clear();
            } else {
                MDC.setContextMap(previous);
            }
        }
    }

    private static boolean isUsableId(String value) {
        return value != null && value.length() <= 128 && value.matches("[A-Za-z0-9._:-]+" );
    }

    private static String newCorrelationId() {
        return UUID.randomUUID().toString();
    }

    private static String newRequestId() {
        return UUID.randomUUID().toString();
    }
}
```

Important design points:

1. Do not blindly trust incoming header.
2. Validate length and character set.
3. Return correlation ID in response for supportability.
4. Always restore/clear MDC.
5. Do not put secrets or raw token values into MDC.

---

## 10. Context Object Pattern

MDC is not enough. A richer application usually needs an explicit context object.

```java
public record RequestContext(
        String correlationId,
        String requestId,
        String traceId,
        String spanId,
        String tenantId,
        String userId,
        String module,
        Instant startedAt
) {}
```

Then project it into MDC:

```java
public final class MdcProjection {

    public static Map<String, String> capture() {
        return MDC.getCopyOfContextMap();
    }

    public static void apply(RequestContext ctx) {
        putIfPresent("correlation.id", ctx.correlationId());
        putIfPresent("request.id", ctx.requestId());
        putIfPresent("trace.id", ctx.traceId());
        putIfPresent("span.id", ctx.spanId());
        putIfPresent("tenant.id", ctx.tenantId());
        putIfPresent("user.id", ctx.userId());
        putIfPresent("module", ctx.module());
    }

    private static void putIfPresent(String key, String value) {
        if (value != null && !value.isBlank()) {
            MDC.put(key, value);
        }
    }
}
```

Architecture rule:

```text
RequestContext = authoritative request metadata
MDC            = logging projection
OTel Context   = tracing propagation context
HTTP headers   = network propagation carrier
```

Do not collapse all these into one thing.

---

## 11. Executor Boundary Problem

This is the classic MDC bug:

```java
MDC.put("correlation.id", "corr-123");
executor.submit(() -> {
    log.info("async task started"); // MDC may be empty here
});
```

Why?

Because MDC is usually backed by `ThreadLocal`, and the async task runs on another thread.

Solution: capture context at submission time, restore it during execution.

```java
public final class MdcAwareRunnable implements Runnable {

    private final Runnable delegate;
    private final Map<String, String> capturedContext;

    public MdcAwareRunnable(Runnable delegate) {
        this.delegate = delegate;
        this.capturedContext = MDC.getCopyOfContextMap();
    }

    @Override
    public void run() {
        Map<String, String> previous = MDC.getCopyOfContextMap();
        try {
            if (capturedContext == null) {
                MDC.clear();
            } else {
                MDC.setContextMap(capturedContext);
            }
            delegate.run();
        } finally {
            if (previous == null) {
                MDC.clear();
            } else {
                MDC.setContextMap(previous);
            }
        }
    }
}
```

Usage:

```java
executor.submit(new MdcAwareRunnable(() -> {
    log.info("async task started");
}));
```

For `Callable`:

```java
public final class MdcAwareCallable<T> implements Callable<T> {

    private final Callable<T> delegate;
    private final Map<String, String> capturedContext;

    public MdcAwareCallable(Callable<T> delegate) {
        this.delegate = delegate;
        this.capturedContext = MDC.getCopyOfContextMap();
    }

    @Override
    public T call() throws Exception {
        Map<String, String> previous = MDC.getCopyOfContextMap();
        try {
            if (capturedContext == null) {
                MDC.clear();
            } else {
                MDC.setContextMap(capturedContext);
            }
            return delegate.call();
        } finally {
            if (previous == null) {
                MDC.clear();
            } else {
                MDC.setContextMap(previous);
            }
        }
    }
}
```

---

## 12. ExecutorService Decorator Pattern

Rather than wrapping every task manually, wrap the executor.

```java
public final class MdcAwareExecutorService extends AbstractExecutorService {

    private final ExecutorService delegate;

    public MdcAwareExecutorService(ExecutorService delegate) {
        this.delegate = Objects.requireNonNull(delegate);
    }

    @Override
    public void execute(Runnable command) {
        delegate.execute(new MdcAwareRunnable(command));
    }

    @Override
    public <T> Future<T> submit(Callable<T> task) {
        return delegate.submit(new MdcAwareCallable<>(task));
    }

    @Override
    public Future<?> submit(Runnable task) {
        return delegate.submit(new MdcAwareRunnable(task));
    }

    @Override
    public <T> Future<T> submit(Runnable task, T result) {
        return delegate.submit(new MdcAwareRunnable(task), result);
    }

    @Override
    public void shutdown() {
        delegate.shutdown();
    }

    @Override
    public List<Runnable> shutdownNow() {
        return delegate.shutdownNow();
    }

    @Override
    public boolean isShutdown() {
        return delegate.isShutdown();
    }

    @Override
    public boolean isTerminated() {
        return delegate.isTerminated();
    }

    @Override
    public boolean awaitTermination(long timeout, TimeUnit unit) throws InterruptedException {
        return delegate.awaitTermination(timeout, unit);
    }
}
```

Caution:

`ExecutorService` has many methods. If using custom wrappers, ensure all submission paths are covered.

In Spring, prefer `TaskDecorator` where available.

---

## 13. Spring TaskDecorator Pattern

In Spring-based applications:

```java
@Bean
public TaskDecorator mdcTaskDecorator() {
    return runnable -> {
        Map<String, String> captured = MDC.getCopyOfContextMap();
        return () -> {
            Map<String, String> previous = MDC.getCopyOfContextMap();
            try {
                if (captured == null) {
                    MDC.clear();
                } else {
                    MDC.setContextMap(captured);
                }
                runnable.run();
            } finally {
                if (previous == null) {
                    MDC.clear();
                } else {
                    MDC.setContextMap(previous);
                }
            }
        };
    };
}

@Bean
public ThreadPoolTaskExecutor applicationTaskExecutor(TaskDecorator mdcTaskDecorator) {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(16);
    executor.setMaxPoolSize(64);
    executor.setQueueCapacity(1000);
    executor.setThreadNamePrefix("app-worker-");
    executor.setTaskDecorator(mdcTaskDecorator);
    executor.initialize();
    return executor;
}
```

This is a practical baseline for `@Async`, scheduled work, and manually injected task executors.

---

## 14. CompletableFuture Context Propagation

`CompletableFuture` often loses MDC because it uses ForkJoinPool common pool unless an executor is specified.

Bad:

```java
CompletableFuture.supplyAsync(() -> {
    log.info("loading data");
    return loadData();
});
```

Better:

```java
CompletableFuture.supplyAsync(() -> {
    log.info("loading data");
    return loadData();
}, mdcAwareExecutor);
```

For chained stages:

```java
CompletableFuture
        .supplyAsync(() -> loadCustomer(customerId), mdcAwareExecutor)
        .thenApplyAsync(customer -> enrich(customer), mdcAwareExecutor)
        .thenAcceptAsync(result -> save(result), mdcAwareExecutor);
```

Important:

- `thenApply` may run on the completing thread.
- `thenApplyAsync` runs on an executor.
- If no executor is specified, common pool is used.
- Context propagation should be consistent for all async stages.

---

## 15. Reactor Context vs MDC

Reactive programming does not map cleanly to thread-local thinking.

In Reactor, execution may hop threads. A single logical flow can run on multiple threads.

Bad assumption:

```text
one request = one thread = one MDC map
```

Reactive reality:

```text
one request = many operators = possibly many threads = logical context in Reactor Context
```

Reactor has `Context`, which is bound to subscriber flow rather than a thread.

Conceptual pattern:

```java
Mono.deferContextual(ctx -> {
    String correlationId = ctx.get("correlation.id");
    return callService(correlationId);
});
```

For logging, you typically need hooks or operators that copy Reactor Context into MDC at logging boundaries.

Design rule:

> In reactive systems, logical context belongs in reactive Context, while MDC is only a temporary projection around log emission.

Do not rely only on ThreadLocal MDC in reactive applications.

---

## 16. Virtual Threads: What Changes?

Java virtual threads change the thread cost model.

With platform threads:

```text
expensive thread
thread pool reuse common
ThreadLocal leak risk due to reuse
```

With virtual threads:

```text
cheap thread
often one virtual thread per task/request
less need for pooling virtual threads
ThreadLocal leak from reuse is less central
but ThreadLocal count and payload can still matter
```

Important nuance:

Virtual threads do not magically solve context propagation.

If a logical flow stays on one virtual thread, MDC/ThreadLocal works similarly.

But context still needs handling when:

- creating child tasks,
- using executor boundaries,
- interacting with platform-thread pools,
- using `CompletableFuture`,
- entering reactive libraries,
- crossing process/network boundary,
- using libraries that offload work internally.

Virtual threads reduce some thread pool reuse problems but do not replace explicit context design.

---

## 17. ThreadLocal with Virtual Threads

ThreadLocal is supported with virtual threads, but overuse can create cost and lifecycle complexity.

Problem patterns:

1. Large object stored in ThreadLocal per virtual thread.
2. Many framework ThreadLocals initialized per request.
3. Context forgotten in child execution.
4. Libraries assuming long-lived pooled threads.
5. Mutable context shared accidentally.

Better pattern:

- keep ThreadLocal/MDC values small,
- store IDs, not heavy objects,
- avoid large maps per request,
- clear/restore context anyway,
- prefer immutable context objects,
- consider ScopedValue for read-only context in Java 25+.

---

## 18. ScopedValue Mental Model

ScopedValue is closer to “implicit immutable parameter with bounded lifetime” than to global state.

Compare:

```text
ThreadLocal:
  set value on current thread
  value remains until removed or overwritten
  mutable lifecycle is easy to misuse

ScopedValue:
  bind value for a lexical/dynamic scope
  value available only inside that scope
  immutable binding
  scope exit removes accessibility
```

Conceptual Java 25 style:

```java
public final class CurrentRequest {
    public static final ScopedValue<RequestContext> CONTEXT = ScopedValue.newInstance();

    private CurrentRequest() {}
}

ScopedValue.where(CurrentRequest.CONTEXT, requestContext)
        .run(() -> applicationService.handle(command));
```

Inside downstream code:

```java
RequestContext ctx = CurrentRequest.CONTEXT.get();
log.info("handling command for requestId={}", ctx.requestId());
```

Benefits:

- bounded lifetime,
- immutable context binding,
- safer with child tasks in structured concurrency,
- less accidental leakage than ThreadLocal,
- clearer reasoning.

Limitations:

- not available as final API before Java 25,
- library ecosystem adoption takes time,
- MDC/logging frameworks are still ThreadLocal-oriented,
- not a direct replacement for network propagation,
- not a direct replacement for OTel Context.

---

## 19. ScopedValue + MDC Projection

Even with ScopedValue, logging frameworks still often read MDC/ThreadContext.

So one practical design is:

```text
ScopedValue<RequestContext> = authoritative scoped context
MDC                       = logging projection around log emission or request scope
OTel Context              = tracing context
```

At request boundary:

```java
ScopedValue.where(CurrentRequest.CONTEXT, ctx).run(() -> {
    Map<String, String> previous = MDC.getCopyOfContextMap();
    try {
        MdcProjection.apply(ctx);
        chain.doFilter(request, response);
    } finally {
        restore(previous);
    }
});
```

This is not always necessary if your framework already synchronizes trace/MDC fields. But the model is important.

---

## 20. OpenTelemetry Context Propagation

OpenTelemetry context propagation allows telemetry signals to be correlated across service and process boundaries.

For distributed tracing, common propagation uses W3C Trace Context headers:

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
tracestate: vendor-specific-state
```

OpenTelemetry also supports Baggage for propagating key-value metadata across process boundaries.

Important distinction:

```text
Trace Context = trace identity
Baggage       = cross-process key-value metadata
MDC           = local logging context
```

Do not put sensitive data in baggage.

Baggage travels across boundaries and may be visible to downstream systems.

---

## 21. OTel Context vs MDC

OTel Context and MDC solve different problems.

| Concern | OTel Context | MDC |
|---|---|---|
| Distributed trace propagation | Yes | No |
| Log enrichment | Indirectly | Yes |
| Cross-process propagation | Yes, through propagators | No |
| Logging framework integration | Via log instrumentation/bridges | Native in logging frameworks |
| Carries active span | Yes | No |
| Should store business entity IDs | Sometimes as attributes/baggage with caution | Yes, if safe and useful |

Practical rule:

> Use OTel Context for tracing causality; use MDC for log enrichment; synchronize only the fields needed for log correlation.

---

## 22. Inbound HTTP Context Extraction

At inbound HTTP boundary, do this:

1. Extract `traceparent` and `tracestate` using OTel propagator.
2. Extract or create `correlation.id`.
3. Create local `request.id`.
4. Build `RequestContext`.
5. Bind/provide context to application logic.
6. Project selected fields into MDC.
7. Add response headers where appropriate.
8. Clear/restore context in `finally`.

Conceptual flow:

```text
HTTP headers
  -> OTel extractor
  -> active span/context
  -> app RequestContext
  -> MDC projection
  -> logs/traces/metrics
```

---

## 23. Outbound HTTP Context Injection

For outbound HTTP, propagate:

1. Trace context.
2. Correlation ID.
3. Idempotency key if relevant.
4. Tenant/user only if contractually safe and needed.

Example headers:

```text
traceparent: 00-...
tracestate: ...
X-Correlation-Id: corr-123
X-Request-Id: req-local-456
Idempotency-Key: idem-789
```

Caution:

- `X-Request-Id` may be local to a hop; do not confuse with trace ID.
- Avoid forwarding user identifiers to external vendors unless part of contract.
- Avoid forwarding internal case IDs to public systems if sensitive.
- Validate incoming IDs before reusing them.

---

## 24. Messaging Context Propagation

Messaging breaks simple request/response assumptions.

Producer side:

```text
current context
  -> inject trace context into message headers
  -> inject correlation.id
  -> set message.id
  -> log produced event
```

Consumer side:

```text
message headers
  -> extract trace/correlation context
  -> create consumer processing context
  -> project to MDC
  -> process message
  -> clear context
```

Recommended message headers:

```text
traceparent
tracestate
correlation.id
message.id
producer.service
producer.timestamp
retry.count
causation.id
```

`causation.id` can identify the event/message that caused this new event.

This is useful in event-driven systems:

```text
CommandSubmitted message.id=m1
  -> CaseCreated message.id=m2 causation.id=m1
  -> NotificationRequested message.id=m3 causation.id=m2
```

---

## 25. Batch and Scheduler Context

Batch/scheduler flow does not start from user HTTP request.

So create context at job boundary:

```text
job.name
job.execution.id
job.schedule.id
trigger.type
started.at
attempt
partition.id
chunk.id
```

Example:

```java
MDC.put("job.name", "case-expiry-scan");
MDC.put("job.execution.id", executionId);
MDC.put("job.attempt", String.valueOf(attempt));
try {
    runJob();
} finally {
    MDC.clear();
}
```

For chunk-based processing:

```text
job.execution.id = job-20260618-001
chunk.id         = chunk-42
record.id        = CASE-123 only at DEBUG or error-specific event
```

Avoid logging one INFO per record for high-volume batch unless required.

---

## 26. Context Propagation in State Machines and Workflows

For case management/regulatory systems, context should include workflow identities.

Useful fields:

```text
workflow.instance.id
workflow.definition.key
workflow.version
state.from
state.to
transition.name
actor.id
case.id
module
decision.id
```

For state transitions, context is not only diagnostic. It supports defensibility.

Example structured log:

```json
{
  "event.name": "case.state.transitioned",
  "case.id": "CASE-2026-0021",
  "workflow.instance.id": "wf-9912",
  "state.from": "PENDING_REVIEW",
  "state.to": "APPROVED",
  "transition.name": "approve",
  "actor.id": "user-123",
  "correlation.id": "corr-abc",
  "outcome": "success"
}
```

Do not rely solely on diagnostic logs for legal audit. Use a dedicated audit trail for authoritative audit requirements.

---

## 27. Context Safety: What Must Not Be Propagated

Never blindly propagate everything.

Avoid propagating:

- passwords,
- access tokens,
- refresh tokens,
- session cookies,
- raw authorization headers,
- full NRIC/NIK/passport values,
- raw personal addresses,
- full request body,
- full SQL with sensitive literal values,
- internal-only privilege flags,
- sensitive security decision internals,
- large payloads.

Context should be:

- small,
- bounded,
- non-secret,
- useful for diagnosis,
- safe across the boundary it crosses.

Rule:

> Context propagation increases observability and blast radius at the same time. Propagate only what the next boundary is allowed to know.

---

## 28. Correlation ID Trust Model

Incoming correlation ID is user-controlled if it enters from the internet.

Risks:

1. Log injection.
2. Extremely long header causing log/storage abuse.
3. Collision with real IDs.
4. Malicious value designed to break JSON/log query.
5. Cross-tenant confusion.

Mitigation:

```java
private static String sanitizeCorrelationId(String raw) {
    if (raw == null || raw.isBlank()) {
        return UUID.randomUUID().toString();
    }
    if (raw.length() > 128) {
        return UUID.randomUUID().toString();
    }
    if (!raw.matches("[A-Za-z0-9._:-]+")) {
        return UUID.randomUUID().toString();
    }
    return raw;
}
```

Better:

- accept external correlation ID as `external.correlation.id`,
- generate internal correlation ID separately if trust boundary requires it.

---

## 29. Context Cardinality

Context fields can explode observability cost.

High-cardinality fields:

- `user.id`,
- `case.id`,
- `order.id`,
- `session.id`,
- `request.id`,
- `trace.id`,
- `span.id`,
- `message.id`.

High cardinality is acceptable in logs/traces but dangerous in metrics labels.

Rule:

```text
Logs: high-cardinality fields are usually acceptable.
Traces: high-cardinality attributes may be acceptable with care.
Metrics: high-cardinality labels are dangerous and often unacceptable.
```

Do not turn `case.id` into a Prometheus label.

---

## 30. Context Model for Java Services

A strong context model separates categories.

```java
public record RuntimeContext(
        TraceContext trace,
        RequestIdentity request,
        ActorIdentity actor,
        TenantIdentity tenant,
        WorkflowIdentity workflow,
        OperationIdentity operation
) {}

public record TraceContext(
        String traceId,
        String spanId
) {}

public record RequestIdentity(
        String correlationId,
        String requestId,
        String idempotencyKey
) {}

public record ActorIdentity(
        String userId,
        String authMethod,
        String clientId
) {}

public record TenantIdentity(
        String tenantId,
        String agencyId
) {}

public record WorkflowIdentity(
        String caseId,
        String workflowInstanceId,
        String state
) {}

public record OperationIdentity(
        String operationName,
        String module
) {}
```

This model avoids dumping all context into one arbitrary map.

---

## 31. Context Scope Levels

Not all context has the same lifetime.

| Context | Lifetime |
|---|---|
| `trace.id` | distributed trace flow |
| `span.id` | one operation/span |
| `request.id` | one inbound request hop |
| `correlation.id` | logical operation, may cross retries/services |
| `idempotency.key` | deduplication window |
| `job.execution.id` | one job run |
| `case.id` | domain entity lifetime |
| `tenant.id` | user/session/request-specific partition |

Do not put a long-lived entity ID and short-lived span ID into the same conceptual bucket.

---

## 32. Context Propagation Anti-Patterns

### 32.1 Storing Context Only in MDC

Bad:

```java
String tenantId = MDC.get("tenant.id");
repository.queryByTenant(tenantId);
```

Why bad?

MDC is logging infrastructure. Domain/security logic should not depend on logging state.

Better:

```java
service.handle(command, tenantContext);
```

### 32.2 Not Clearing MDC

Bad:

```java
MDC.put("user.id", userId);
chain.doFilter(request, response);
```

Better:

```java
try {
    MDC.put("user.id", userId);
    chain.doFilter(request, response);
} finally {
    MDC.clear();
}
```

### 32.3 Propagating Too Much

Bad:

```text
baggage: user.email=john@example.com, access.token=..., full.name=...
```

Better:

```text
baggage: tenant.id=t-123, correlation.id=corr-456
```

Even then, validate whether baggage is appropriate.

### 32.4 Generating New Correlation ID at Every Service

Bad:

```text
service A corr=A
service B corr=B
service C corr=C
```

Better:

```text
service A/B/C share correlation.id
trace contains service spans
each service may also create local request.id
```

### 32.5 Using Request ID as Trace ID

Bad:

```text
X-Request-Id used as trace.id
```

Better:

```text
trace.id = tracing system identity
request.id = local request identity
correlation.id = business/logical flow identity
```

---

## 33. Context Propagation Decision Matrix

| Scenario | Recommended Context Strategy |
|---|---|
| Simple servlet MVC app | Servlet filter + MDC + correlation response header |
| Spring MVC + executor | Servlet filter + TaskDecorator/Executor wrapper |
| CompletableFuture-heavy app | Always pass context-aware executor |
| Reactive WebFlux app | Reactor Context as source, MDC projection at log boundary |
| Java 21 virtual thread request-per-task | Small MDC/ThreadLocal acceptable, still clear/restore |
| Java 25 modern internal service | Consider ScopedValue for immutable request context + MDC projection |
| Distributed microservices | OTel context + W3C Trace Context + correlation header |
| Messaging consumer | Extract trace/correlation from message headers, project to MDC |
| Batch/scheduler | Create job execution context at job boundary |
| Regulatory workflow | Add workflow/case/state context, separate audit trail |

---

## 34. Production Context Propagation Standard

A mature Java service should define a written standard.

Example standard:

### 34.1 Required Inbound Fields

For every inbound request:

```text
correlation.id
request.id
service.name
environment
```

If tracing enabled:

```text
trace.id
span.id
```

If authenticated and safe:

```text
actor.id
client.id
tenant.id
```

If domain operation:

```text
module
operation
case.id/order.id/process.id where relevant
```

### 34.2 Header Rules

Accept:

```text
traceparent
tracestate
X-Correlation-Id
Idempotency-Key
```

Generate:

```text
X-Request-Id
X-Correlation-Id if absent/invalid
```

Return:

```text
X-Correlation-Id
X-Request-Id
```

### 34.3 Logging Rules

Every application log should include:

```text
timestamp
level
service.name
environment
logger/thread
correlation.id
request.id if request-bound
trace.id/span.id if tracing-enabled
event.name
outcome when applicable
```

### 34.4 Async Rules

All application executors must be context-aware.

Forbidden:

```java
CompletableFuture.supplyAsync(task); // no executor
```

Required:

```java
CompletableFuture.supplyAsync(task, contextAwareExecutor);
```

### 34.5 Security Rules

Forbidden in context:

```text
password
token
cookie
raw authorization header
full PII
large payload
```

---

## 35. Troubleshooting Missing Context

When logs miss context, diagnose systematically.

### 35.1 Symptom: Context Exists in Controller but Missing in Async Task

Likely cause:

- executor boundary not decorated,
- `CompletableFuture` uses common pool,
- manually created thread,
- library offloads internally.

Check:

- thread name,
- executor config,
- task decorator,
- wrapper coverage.

### 35.2 Symptom: Wrong User/Correlation ID Appears

Likely cause:

- MDC not cleared,
- previous context leaked in pooled thread,
- nested context not restored,
- mutable context reused.

Check:

- `finally` blocks,
- filter ordering,
- exception paths,
- executor wrappers.

### 35.3 Symptom: Trace ID Exists but Correlation ID Missing

Likely cause:

- OTel instrumentation working,
- custom correlation filter missing or ordered incorrectly,
- log layout does not include MDC field,
- JSON encoder excludes MDC.

### 35.4 Symptom: Correlation ID Exists but Trace ID Missing

Likely cause:

- OTel agent not enabled,
- trace sampling not recording,
- log injection of trace ID not configured,
- unsupported framework instrumentation,
- manual spans not active.

### 35.5 Symptom: Context Missing Only in Error Logs

Likely cause:

- exception handled outside request context,
- async callback after request scope ended,
- error handler clears MDC too early,
- logging happens in another thread.

---

## 36. Testing Context Propagation

Context propagation must be tested.

### 36.1 Unit Test MDC Wrapper

```java
@Test
void propagatesMdcToRunnable() {
    MDC.put("correlation.id", "corr-123");

    AtomicReference<String> seen = new AtomicReference<>();

    Runnable wrapped = new MdcAwareRunnable(() -> {
        seen.set(MDC.get("correlation.id"));
    });

    MDC.clear();
    wrapped.run();

    assertEquals("corr-123", seen.get());
}
```

### 36.2 Test Cleanup

```java
@Test
void restoresPreviousMdcAfterRunnable() {
    MDC.put("correlation.id", "outer");

    Runnable wrapped;
    try {
        MDC.put("correlation.id", "captured");
        wrapped = new MdcAwareRunnable(() -> {
            assertEquals("captured", MDC.get("correlation.id"));
        });
    } finally {
        MDC.put("correlation.id", "outer");
    }

    wrapped.run();

    assertEquals("outer", MDC.get("correlation.id"));
}
```

### 36.3 Integration Test HTTP Header

Test:

- incoming `X-Correlation-Id` is accepted if valid,
- invalid one is replaced,
- response includes correlation ID,
- logs contain correlation ID,
- async task logs contain same correlation ID.

---

## 37. Practical Lab 1: Build a Correlation Filter

Objective:

- create inbound servlet filter,
- extract/generate correlation ID,
- create request ID,
- put both into MDC,
- return both in response header,
- clear/restore MDC.

Expected output:

```text
INFO event.name=http.request.received correlation.id=corr-abc request.id=req-123
INFO event.name=http.request.completed correlation.id=corr-abc request.id=req-123 status=200 duration.ms=42
```

---

## 38. Practical Lab 2: Propagate MDC Through Executor

Objective:

- create normal executor,
- show missing MDC in async task,
- create context-aware executor,
- show context preserved,
- prove cleanup.

Expected learning:

```text
Context must be captured at submit time, not at execution time.
```

Why?

Because execution may occur later on a different thread after the submitting thread already changed or cleared MDC.

---

## 39. Practical Lab 3: CompletableFuture Context Loss

Objective:

- create `CompletableFuture.supplyAsync` without executor,
- observe missing context,
- add context-aware executor,
- chain stages,
- compare logs.

Important observation:

```text
CompletableFuture default async behavior is rarely what you want in production services.
```

---

## 40. Practical Lab 4: Java 25 ScopedValue Prototype

Objective:

- define `RequestContext`,
- bind with ScopedValue,
- read context from downstream method,
- compare with ThreadLocal,
- discuss MDC projection.

Conceptual code:

```java
public record RequestContext(String correlationId, String requestId) {}

public final class Current {
    static final ScopedValue<RequestContext> REQUEST = ScopedValue.newInstance();
}

public void handle(RequestContext ctx) {
    ScopedValue.where(Current.REQUEST, ctx).run(() -> {
        service.process();
    });
}

public void process() {
    RequestContext ctx = Current.REQUEST.get();
    log.info("processing request {}", ctx.requestId());
}
```

Expected learning:

```text
ScopedValue gives bounded immutable context, but logging integration still needs explicit projection if the logger reads MDC.
```

---

## 41. Context Propagation Checklist

Before considering a Java service production-grade, verify:

- [ ] inbound HTTP extracts or creates correlation ID,
- [ ] response includes correlation/request ID,
- [ ] MDC is cleared/restored in `finally`,
- [ ] async executors are context-aware,
- [ ] `CompletableFuture` uses explicit executor,
- [ ] message producer injects trace/correlation headers,
- [ ] message consumer extracts trace/correlation headers,
- [ ] batch/scheduler creates execution context,
- [ ] log layout includes correlation/request/trace/span IDs,
- [ ] sensitive fields are not propagated,
- [ ] high-cardinality fields are not used as metric labels,
- [ ] context propagation is tested,
- [ ] OTel context and MDC responsibilities are separated,
- [ ] Java 21+ virtual thread behavior is reviewed,
- [ ] Java 25+ ScopedValue adoption strategy is clear if used.

---

## 42. Top 1% Engineering Lens

A strong engineer does not ask only:

> “How do I put correlation ID in logs?”

A stronger question is:

> “What is the lifecycle, authority, trust boundary, propagation path, and cleanup rule of each runtime identity?”

For every context field, ask:

1. Who creates it?
2. Who owns it?
3. Is it trusted?
4. Is it safe to propagate?
5. Is it local or distributed?
6. Is it diagnostic, security, audit, or domain context?
7. What is its lifetime?
8. What happens on retry?
9. What happens on async boundary?
10. What happens on message redelivery?
11. What happens if it is missing?
12. What happens if it is malicious?
13. What happens if it has high cardinality?
14. Should it be in logs, traces, metrics, audit trail, or none?

That is the difference between adding logging and designing diagnosability.

---

## 43. Summary

Context propagation is the connective tissue of observability.

Without it:

- logs are isolated,
- traces are incomplete,
- metrics cannot be explained,
- incidents take longer,
- audit/debug timelines become unreliable.

With good context propagation:

- every runtime event belongs to a flow,
- every dependency call can be correlated,
- every async task can be traced back,
- every retry/redelivery has identity,
- every incident can be reconstructed faster.

Core rules:

1. Treat context as runtime identity.
2. Separate authoritative context from logging projection.
3. Use MDC for logs, not domain logic.
4. Always clear or restore MDC.
5. Capture context at async submission time.
6. Use OTel Context for distributed tracing.
7. Use headers/message metadata for cross-process propagation.
8. Keep propagated context small and safe.
9. Be careful with high-cardinality values.
10. Consider ScopedValue for immutable scoped context in Java 25+.

---

## 44. What Comes Next

Next part:

```text
Part 11 — Correlation ID, Trace ID, Request ID, Idempotency Key, Causality
```

Part 10 taught how context travels.

Part 11 will go deeper into the semantics of identity itself:

- when to create ID,
- when to reuse ID,
- how trace/correlation/request/message/idempotency IDs differ,
- how to model causality in distributed systems,
- how to avoid misleading correlation.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./09-structured-logging-from-human-text-to-machine-queryable-events.md">⬅️ Part 9 — Structured Logging: From Human Text to Machine-Queryable Events</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./11-correlation-id-trace-id-request-id-idempotency-key-causality.md">Part 11 — Correlation ID, Trace ID, Request ID, Idempotency Key, Causality ➡️</a>
</div>

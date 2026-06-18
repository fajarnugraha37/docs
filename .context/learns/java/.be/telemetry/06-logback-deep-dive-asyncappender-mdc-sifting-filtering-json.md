# Part 6 — Logback Deep Dive II: AsyncAppender, MDC, Sifting, Filtering, JSON

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> File: `06-logback-deep-dive-asyncappender-mdc-sifting-filtering-json.md`  
> Target: Java 8–25, SLF4J 1.x/2.x, Logback 1.2–1.5+, Spring Boot/non-Spring, container/Kubernetes and VM deployments

---

## 0. Tujuan Bagian Ini

Di Part 5 kita sudah membahas fondasi Logback: arsitektur, konfigurasi, appender, encoder, layout, rolling file, dan baseline production config.

Bagian ini masuk ke area yang lebih berbahaya dan lebih menentukan kualitas engineer di production:

1. bagaimana logging tidak ikut menjatuhkan aplikasi saat traffic tinggi;
2. bagaimana context seperti `traceId`, `requestId`, `userId`, `tenantId`, `caseId`, `jobId`, dan `correlationId` tetap ikut sampai ke log;
3. bagaimana mencegah MDC leak di thread pool, async flow, dan virtual-thread era;
4. bagaimana melakukan routing log berdasarkan context;
5. bagaimana membuat filter log yang presisi tanpa menyembunyikan evidence penting;
6. bagaimana menghasilkan JSON log yang queryable, aman, dan murah untuk di-ingest;
7. bagaimana membaca failure mode Logback saat incident.

Part ini bukan sekadar konfigurasi `AsyncAppender`. Ini adalah cara berpikir tentang **logging as a bounded, lossy-or-blocking runtime subsystem**.

Logging bukan operasi gratis. Logging memakai CPU, memory, allocation, lock, queue, encoder, dan IO. Saat sistem sedang sehat, biaya logging terasa kecil. Saat sistem sedang incident, logging sering meningkat drastis justru ketika resource sedang terbatas. Engineer yang matang harus memahami trade-off ini.

---

## 1. Mental Model: Logback Advanced Pipeline

Pada level sederhana, Logback pipeline terlihat seperti ini:

```text
application code
   |
   | logger.info(...)
   v
SLF4J API
   |
   v
Logback logger
   |
   | level check
   | marker/filter check
   | create LoggingEvent
   v
Appender chain
   |
   +--> sync appender --> encoder/layout --> output stream
   |
   +--> async appender --> queue --> worker thread --> real appender --> encoder/layout --> output stream
   |
   +--> sifting appender --> choose appender by discriminator/MDC --> output
```

Ada beberapa boundary penting:

| Boundary | Risiko |
|---|---|
| Call site | string concat, expensive argument, stack trace creation |
| Event creation | allocation, snapshot MDC, caller data cost |
| Async queue | drop, block, memory pressure, reorder perception |
| Worker thread | throughput bottleneck, stuck output |
| Encoder/layout | JSON serialization, stack trace formatting, caller data |
| Output | stdout blocking, file IO, disk full, network appender failure |
| Collector/agent | ingestion lag, truncation, parsing failure |

Mental model top-tier: **Logback is not only a logger. It is a runtime event transport with limited buffer and configurable loss semantics.**

---

## 2. Kenapa Async Logging Ada

Synchronous logging berarti thread aplikasi ikut melakukan pekerjaan logging sampai event benar-benar ditulis ke target output.

```text
request thread
   -> business logic
   -> logger.info()
      -> encode message
      -> write stdout/file
      -> flush/lock/IO wait maybe
   -> continue business logic
```

Async logging memindahkan sebagian pekerjaan ke worker thread:

```text
request thread
   -> business logic
   -> logger.info()
      -> create event
      -> enqueue event
   -> continue business logic

async logging worker
   -> dequeue event
   -> encode
   -> write stdout/file
```

Async logging biasanya dipakai untuk mengurangi latency impact pada thread aplikasi. Tetapi async logging tidak menghilangkan biaya logging. Ia hanya memindahkan biaya ke queue dan worker thread.

Trade-off utamanya:

| Mode | Benefit | Cost |
|---|---|---|
| Synchronous | predictable, fewer dropped logs, easier reasoning | application thread bisa tertahan oleh IO/encoder |
| Asynchronous | application thread lebih cepat release | queue memory, drop/block semantics, delayed logs, harder failure reasoning |

Async logging cocok jika:

1. log volume cukup tinggi;
2. output relatif lambat dibanding request path;
3. latency request path penting;
4. kehilangan sebagian low-value logs bisa diterima;
5. konfigurasi queue/drop/backpressure dipahami.

Async logging berbahaya jika:

1. semua log harus durable;
2. audit log diproses lewat appender async yang boleh drop;
3. queue terlalu kecil;
4. log storm terjadi saat incident;
5. encoder JSON terlalu berat;
6. output lambat/stuck;
7. tidak ada monitoring dropped log/queue symptoms.

---

## 3. Logback `AsyncAppender`: Cara Kerja

`AsyncAppender` di Logback membungkus satu atau lebih appender target, tetapi secara praktik production biasanya satu async appender membungkus satu real appender.

```xml
<appender name="CONSOLE_JSON" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LogstashEncoder"/>
</appender>

<appender name="ASYNC_CONSOLE" class="ch.qos.logback.classic.AsyncAppender">
    <queueSize>8192</queueSize>
    <discardingThreshold>0</discardingThreshold>
    <neverBlock>false</neverBlock>
    <appender-ref ref="CONSOLE_JSON"/>
</appender>

<root level="INFO">
    <appender-ref ref="ASYNC_CONSOLE"/>
</root>
```

Secara konsep:

```text
application thread
   create ILoggingEvent
   prepare event for deferred processing
   enqueue event

worker thread
   take ILoggingEvent from queue
   call child appender
```

Hal penting: event harus membawa snapshot data yang dibutuhkan sebelum dipindahkan ke thread worker. Jika tidak, worker bisa melihat state yang salah atau hilang. Karena itu Logback melakukan preprocessing tertentu terhadap event, termasuk MDC/certain lazy fields, sebelum async handoff.

---

## 4. Parameter Penting `AsyncAppender`

### 4.1 `queueSize`

`queueSize` menentukan kapasitas buffer event.

```xml
<queueSize>8192</queueSize>
```

Queue yang terlalu kecil:

1. cepat penuh saat burst;
2. log mudah dropped atau request thread blocked;
3. incident visibility turun saat paling dibutuhkan.

Queue yang terlalu besar:

1. memakai memory lebih banyak;
2. bisa menyembunyikan output bottleneck terlalu lama;
3. saat shutdown, flush bisa lebih lama;
4. delay log menjadi besar;
5. jika event besar, heap pressure naik.

Rule of thumb awal:

| Traffic/Log Volume | Starting Queue Size |
|---|---:|
| Small service | 1,024–4,096 |
| Medium service | 8,192–16,384 |
| High-throughput service | 32,768+ dengan testing |
| Audit/security critical | jangan bergantung pada lossy async appender |

Tapi sizing yang benar harus berdasarkan:

```text
required_buffer_seconds = expected_burst_log_events / appender_drain_rate
queue_size >= peak_log_events_per_second * tolerated_burst_seconds
```

Contoh:

```text
peak burst log rate     = 20,000 events/sec
console drain rate      = 8,000 events/sec
burst duration          = 2 sec
minimum queue estimate  = 40,000 events
```

Ini belum menghitung event size dan heap pressure.

---

### 4.2 `discardingThreshold`

`discardingThreshold` menentukan kapan Logback mulai membuang event yang dianggap discardable saat queue mulai penuh. Pada `AsyncAppender` klasik, event level rendah seperti TRACE, DEBUG, dan INFO dapat dianggap discardable untuk menjaga WARN/ERROR tetap lewat.

Contoh:

```xml
<discardingThreshold>0</discardingThreshold>
```

`0` berarti jangan discard berdasarkan threshold normal; namun ini bukan berarti tidak pernah kehilangan log dalam semua kondisi. Jika `neverBlock=true` dan queue penuh, event tetap bisa tidak masuk queue.

Pilihan desain:

| Setting | Makna Praktis |
|---|---|
| default | lebih rela membuang low-level event saat queue mendekati penuh |
| `0` | usahakan tidak discard low-level event karena threshold |
| tinggi | lebih agresif membuang low-value logs |

Kapan `discardingThreshold=0` masuk akal?

1. log volume terkendali;
2. INFO log dianggap penting untuk forensic timeline;
3. queue cukup besar;
4. blocking masih dapat diterima.

Kapan default/aggressive discarding masuk akal?

1. high-throughput service;
2. DEBUG/INFO sangat noisy;
3. ERROR/WARN lebih penting daripada completeness INFO;
4. latency request path lebih penting daripada low-value log completeness.

---

### 4.3 `neverBlock`

`neverBlock` menentukan apakah application thread boleh diblok saat queue penuh.

```xml
<neverBlock>false</neverBlock>
```

| `neverBlock` | Behavior | Trade-off |
|---|---|---|
| `false` | request thread bisa block saat queue penuh | log lebih complete, latency bisa rusak |
| `true` | request thread tidak block; event bisa dropped | latency lebih terlindungi, evidence bisa hilang |

Tidak ada jawaban universal. Pilihan harus mengikuti jenis log.

Untuk diagnostic logs:

```text
neverBlock=true mungkin acceptable jika sistem lebih penting tetap melayani traffic.
```

Untuk audit/security logs:

```text
neverBlock=true biasanya berbahaya jika event wajib tercatat.
```

Namun audit log idealnya tidak hanya mengandalkan appender biasa. Audit event critical sebaiknya punya pipeline durable: database append-only, outbox, event stream, WORM storage, atau mekanisme khusus sesuai requirement.

---

### 4.4 `includeCallerData`

Caller data seperti class/method/line number terlihat menarik:

```text
com.example.OrderService.submit(OrderService.java:141)
```

Tetapi caller data mahal karena perlu stack walking.

```xml
<includeCallerData>false</includeCallerData>
```

Gunakan caller data hanya jika:

1. benar-benar dibutuhkan;
2. log volume rendah;
3. tidak ada cara lebih murah lewat logger name/event name;
4. sudah diuji impact-nya.

Untuk production high-throughput, default yang sehat: **matikan caller data**.

---

### 4.5 `maxFlushTime`

Saat shutdown, async appender mencoba flush event tersisa.

```xml
<maxFlushTime>5000</maxFlushTime>
```

Risiko:

1. terlalu pendek: log terakhir hilang;
2. terlalu panjang: shutdown lambat;
3. container termination grace period habis;
4. Kubernetes kill sebelum flush selesai.

Untuk Kubernetes, align dengan:

1. `terminationGracePeriodSeconds`;
2. preStop hook;
3. collector drain behavior;
4. application graceful shutdown.

---

## 5. AsyncAppender Decision Matrix

| Use Case | Async? | Recommended Semantics |
|---|---|---|
| Normal application diagnostic log | yes, often | bounded queue, maybe non-blocking depending SLO |
| High-volume debug/trace log | yes, but sampled/rate-limited | discard aggressively |
| Error log | yes, but avoid dropping | `discardingThreshold=0`, `neverBlock=false` if acceptable |
| Audit log | usually not via lossy async appender only | durable pipeline |
| Security event | depends severity | high severity durable; low severity async ok |
| Access log | often async | structured, sampled if enormous |
| Batch progress log | maybe | include job/chunk IDs |
| Payment/regulatory state transition | avoid lossy-only | database/event store + diagnostic log |

Key principle:

```text
Do not send every class of evidence through the same loss semantics.
```

Application diagnostic logs and compliance audit records are not the same artifact.

---

## 6. Async Logging Failure Modes

### 6.1 Queue Saturation

Symptoms:

1. latency spike around logging-heavy code;
2. missing INFO/DEBUG logs;
3. WARN/ERROR still appear but timeline has gaps;
4. CPU in logging worker high;
5. application thread blocked in queue put;
6. heap usage rises due to queued events.

Causes:

1. log storm;
2. slow stdout/file IO;
3. slow JSON encoder;
4. stack traces too large;
5. collector backpressure;
6. disk slow/full;
7. network appender blocking.

Diagnosis:

1. compare log event rate before/after incident;
2. inspect thread dumps for async appender worker;
3. profile encoder/writer cost;
4. check stdout/collector metrics;
5. check disk IO and container logs driver.

---

### 6.2 Dropped Logs

Dropped logs are especially dangerous because they create false absence.

Bad conclusion:

```text
There is no log, therefore it did not happen.
```

Better conclusion:

```text
There is no log in this pipeline. Check whether the event could be filtered, dropped, sampled, not flushed, lost during restart, or rejected by collector.
```

Design mitigation:

1. explicit event counters for important events;
2. separate durable pipeline for audit;
3. health metrics for logging collector;
4. conservative drop policy for WARN/ERROR;
5. startup/shutdown logs synchronous or carefully flushed;
6. bounded log volume.

---

### 6.3 Logging-Induced Outage

A service can degrade because logging becomes too expensive.

Common patterns:

```java
log.info("large response body={}", responseBody);
log.error("failed", exceptionWithHugeSuppressedTree);
log.debug("entity={}", entity); // entity.toString() triggers lazy loading or huge graph
```

Symptoms:

1. high CPU in JSON serialization;
2. GC pressure due to log allocations;
3. disk full;
4. stdout write blocked;
5. collector overwhelmed;
6. request latency increases exactly when log volume increases.

Prevention:

1. do not log full request/response bodies by default;
2. cap string length;
3. avoid entity graph `toString()`;
4. use structured fields, not huge blob messages;
5. rate-limit repetitive failures;
6. use event code and IDs to retrieve details from source system if needed.

---

## 7. MDC Deep Dive

MDC means **Mapped Diagnostic Context**. In SLF4J/Logback, MDC stores contextual fields associated with the current thread. Logback layouts/encoders can read these fields and put them into log output.

Typical fields:

| Field | Meaning |
|---|---|
| `trace_id` | distributed trace id |
| `span_id` | current span id |
| `correlation_id` | cross-system business/technical correlation |
| `request_id` | inbound request instance id |
| `tenant_id` | tenant/agency/org boundary |
| `user_id` | authenticated user identifier, ideally non-sensitive/internal id |
| `case_id` | domain case/process id |
| `job_id` | batch/scheduler execution id |
| `module` | application module |
| `operation` | stable operation/event group |

Example:

```java
import org.slf4j.MDC;

MDC.put("correlation_id", correlationId);
MDC.put("request_id", requestId);
MDC.put("tenant_id", tenantId);
try {
    service.handle(request);
} finally {
    MDC.clear();
}
```

Pattern layout:

```xml
<pattern>%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level [%thread] %logger{36} trace_id=%X{trace_id} correlation_id=%X{correlation_id} request_id=%X{request_id} - %msg%n%ex</pattern>
```

JSON encoder normally emits MDC as fields or nested object depending encoder configuration.

---

## 8. MDC Is Thread-Local: Why That Matters

MDC is usually backed by thread-local state. That means:

```text
MDC data belongs to current thread, not automatically to request, task, span, or business transaction.
```

This is the source of most MDC bugs.

### 8.1 Servlet Request Works Because One Thread Handles Request — Until It Does Not

Simple servlet flow:

```text
HTTP request
   -> servlet filter sets MDC
   -> controller/service logs
   -> servlet filter clears MDC
```

Works if processing remains on the same thread.

Breaks when:

1. work is submitted to another executor;
2. `CompletableFuture` uses common pool;
3. async servlet processing occurs;
4. Reactor pipeline switches thread;
5. scheduled task runs without context;
6. virtual thread migration/usage changes assumptions;
7. pooled thread reuses old MDC if not cleared.

---

## 9. MDC Correctness Invariants

A robust MDC design follows these invariants:

### Invariant 1 — Context is established at boundary

Inbound boundary examples:

1. HTTP filter/interceptor;
2. gRPC interceptor;
3. message consumer wrapper;
4. batch job launcher;
5. scheduler wrapper;
6. CLI command entrypoint;
7. integration callback handler.

Do not randomly create correlation IDs deep in service methods unless that method is the real boundary.

---

### Invariant 2 — Context is cleared at boundary exit

Always:

```java
try {
    chain.doFilter(request, response);
} finally {
    MDC.clear();
}
```

Never rely on container/thread-pool cleanup.

---

### Invariant 3 — Context propagation is explicit across async boundaries

Bad:

```java
CompletableFuture.runAsync(() -> {
    log.info("async work started"); // likely missing request context
});
```

Better:

```java
Map<String, String> context = MDC.getCopyOfContextMap();
CompletableFuture.runAsync(wrapWithMdc(context, () -> {
    log.info("async work started");
}));
```

---

### Invariant 4 — Context keys are governed

Avoid random keys:

```text
corrId
correlationId
correlation_id
xCorrelationId
request-id
req_id
```

Pick one canonical schema.

Recommended low-friction schema:

```text
trace_id
span_id
correlation_id
request_id
tenant_id
user_id
case_id
job_id
module
operation
```

---

### Invariant 5 — Context values are bounded and safe

MDC should not contain:

1. full JWT;
2. access token;
3. session cookie;
4. full request body;
5. unbounded user input;
6. large JSON;
7. sensitive PII unless explicitly allowed and protected.

---

## 10. Servlet Filter for MDC

Example production-grade filter:

```java
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Optional;
import java.util.UUID;

public final class DiagnosticContextFilter extends OncePerRequestFilter {

    private static final String HEADER_CORRELATION_ID = "X-Correlation-Id";
    private static final String HEADER_REQUEST_ID = "X-Request-Id";

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String correlationId = firstNonBlank(
                request.getHeader(HEADER_CORRELATION_ID),
                UUID.randomUUID().toString()
        );
        String requestId = firstNonBlank(
                request.getHeader(HEADER_REQUEST_ID),
                UUID.randomUUID().toString()
        );

        MDC.put("correlation_id", sanitize(correlationId, 128));
        MDC.put("request_id", sanitize(requestId, 128));
        MDC.put("http_method", request.getMethod());
        MDC.put("http_route", safeRoute(request));

        response.setHeader(HEADER_CORRELATION_ID, correlationId);
        response.setHeader(HEADER_REQUEST_ID, requestId);

        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.clear();
        }
    }

    private static String firstNonBlank(String candidate, String fallback) {
        if (candidate == null || candidate.isBlank()) {
            return fallback;
        }
        return candidate;
    }

    private static String sanitize(String value, int maxLength) {
        if (value == null) {
            return "";
        }
        String normalized = value.replace('\n', '_').replace('\r', '_').trim();
        return normalized.length() <= maxLength ? normalized : normalized.substring(0, maxLength);
    }

    private static String safeRoute(HttpServletRequest request) {
        // Prefer framework route pattern if available, e.g. /cases/{caseId}, not raw /cases/123456.
        Object pattern = request.getAttribute("org.springframework.web.servlet.HandlerMapping.bestMatchingPattern");
        return Optional.ofNullable(pattern)
                .map(Object::toString)
                .orElse(request.getRequestURI());
    }
}
```

Important notes:

1. `http_route` should prefer route template, not raw URL with IDs.
2. Header values must be sanitized against log injection.
3. MDC must be cleared in `finally`.
4. Response should echo correlation ID for support/debugging.
5. In real OTel-enabled systems, use W3C trace context for distributed trace identity and treat `correlation_id` as business/operational correlation if needed.

---

## 11. MDC Propagation for Executor

### 11.1 Generic Wrapper

```java
import org.slf4j.MDC;

import java.util.Map;
import java.util.concurrent.Callable;

public final class MdcPropagation {

    private MdcPropagation() {}

    public static Runnable wrap(Runnable task) {
        Map<String, String> captured = MDC.getCopyOfContextMap();
        return () -> {
            Map<String, String> previous = MDC.getCopyOfContextMap();
            try {
                setContext(captured);
                task.run();
            } finally {
                setContext(previous);
            }
        };
    }

    public static <T> Callable<T> wrap(Callable<T> task) {
        Map<String, String> captured = MDC.getCopyOfContextMap();
        return () -> {
            Map<String, String> previous = MDC.getCopyOfContextMap();
            try {
                setContext(captured);
                return task.call();
            } finally {
                setContext(previous);
            }
        };
    }

    private static void setContext(Map<String, String> context) {
        MDC.clear();
        if (context != null && !context.isEmpty()) {
            MDC.setContextMap(context);
        }
    }
}
```

Why restore previous context instead of always clear?

Because wrapper may run inside another context. Restoring makes it composable.

---

### 11.2 ExecutorService Decorator

```java
import java.util.Collection;
import java.util.List;
import java.util.concurrent.*;
import java.util.stream.Collectors;

public final class MdcAwareExecutorService extends AbstractExecutorService {

    private final ExecutorService delegate;

    public MdcAwareExecutorService(ExecutorService delegate) {
        this.delegate = delegate;
    }

    @Override
    public void execute(Runnable command) {
        delegate.execute(MdcPropagation.wrap(command));
    }

    @Override
    public <T> Future<T> submit(Callable<T> task) {
        return delegate.submit(MdcPropagation.wrap(task));
    }

    @Override
    public Future<?> submit(Runnable task) {
        return delegate.submit(MdcPropagation.wrap(task));
    }

    @Override
    public <T> Future<T> submit(Runnable task, T result) {
        return delegate.submit(MdcPropagation.wrap(task), result);
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

This is only a baseline. In Spring, prefer `TaskDecorator` for `ThreadPoolTaskExecutor`.

---

### 11.3 Spring `TaskDecorator`

```java
import org.slf4j.MDC;
import org.springframework.core.task.TaskDecorator;

import java.util.Map;

public final class MdcTaskDecorator implements TaskDecorator {

    @Override
    public Runnable decorate(Runnable runnable) {
        Map<String, String> captured = MDC.getCopyOfContextMap();
        return () -> {
            Map<String, String> previous = MDC.getCopyOfContextMap();
            try {
                MDC.clear();
                if (captured != null) {
                    MDC.setContextMap(captured);
                }
                runnable.run();
            } finally {
                MDC.clear();
                if (previous != null) {
                    MDC.setContextMap(previous);
                }
            }
        };
    }
}
```

Configuration:

```java
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

@Bean
public Executor applicationTaskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(16);
    executor.setMaxPoolSize(64);
    executor.setQueueCapacity(1000);
    executor.setThreadNamePrefix("app-worker-");
    executor.setTaskDecorator(new MdcTaskDecorator());
    executor.initialize();
    return executor;
}
```

---

## 12. MDC with `CompletableFuture`

Problem:

```java
CompletableFuture.supplyAsync(() -> service.compute())
        .thenApply(result -> service.transform(result));
```

Without explicit executor, it uses common pool for async stages. MDC usually does not propagate.

Better:

```java
Executor mdcExecutor = new MdcAwareExecutorService(Executors.newFixedThreadPool(16));

CompletableFuture.supplyAsync(MdcPropagation.wrap(() -> service.compute()), mdcExecutor)
        .thenApplyAsync(result -> service.transform(result), mdcExecutor);
```

But avoid wrapping twice if executor already decorates tasks. Pick one standard.

Recommended standard:

1. all async execution must use named, managed executors;
2. managed executors must propagate diagnostic context;
3. prohibit accidental `ForkJoinPool.commonPool()` for request-related work;
4. use static analysis/code review to reject raw `CompletableFuture.supplyAsync(... )` without executor.

---

## 13. MDC with Virtual Threads Java 21+

Virtual threads change the cost model and operational behavior, but do not remove the need for diagnostic context.

Key points:

1. `ThreadLocal` works with virtual threads, but millions of virtual threads with many ThreadLocal values can become costly.
2. MDC is still per-thread context.
3. Virtual threads reduce thread reuse leak risk compared with pooled platform threads if each task gets a fresh virtual thread.
4. But if context is not set at task boundary, logs still lack context.
5. In Java 20+ and beyond, Scoped Values become a better mental model for immutable request context in some designs, but logging frameworks still commonly read MDC/ThreadLocal.

Virtual thread example:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    executor.submit(MdcPropagation.wrap(() -> {
        log.info("work on virtual thread");
    }));
}
```

For Java 21+ systems, consider separating:

```text
canonical context = immutable RequestContext object / OTel Context / ScopedValue
logging compatibility = copy selected fields into MDC at logging boundary or task boundary
```

Do not let MDC become your only source of truth for context.

---

## 14. MDC Leak: The Silent Production Bug

MDC leak happens when pooled thread handles request A, keeps MDC, then later handles request B and logs A's context.

Example bad code:

```java
MDC.put("user_id", userId);
service.handle();
// no clear
```

Potential result:

```json
{"message":"updated case","user_id":"alice","case_id":"CASE-B"}
```

If `alice` is from previous request, this is a forensic and security problem.

### Detection

1. Look for impossible combinations: user A with tenant B.
2. Add tests where same thread handles two simulated requests.
3. Use servlet filter with `finally MDC.clear()`.
4. In executor wrapper, restore previous context.
5. During development, optionally assert MDC empty at boundary start.

Example test:

```java
@Test
void mdcMustNotLeakBetweenRequests() throws Exception {
    ExecutorService executor = Executors.newSingleThreadExecutor();

    executor.submit(() -> {
        MDC.put("request_id", "A");
        // simulate missing clear bug
    }).get();

    Future<String> result = executor.submit(() -> MDC.get("request_id"));

    assertThat(result.get()).isNull(); // will fail if no cleanup policy
}
```

In reality, cleanup should be in boundary/filter/decorator, not every business method.

---

## 15. `SiftingAppender`: Context-Based Routing

`SiftingAppender` routes events to dynamically selected appenders based on discriminator value, often MDC.

Use cases:

1. per-tenant file logs in non-container legacy systems;
2. per-job logs for batch processing;
3. separating audit/security logs by marker/context;
4. short-lived diagnostic capture by request/session/job.

Example per-job file:

```xml
<appender name="JOB_SIFT" class="ch.qos.logback.classic.sift.SiftingAppender">
    <discriminator>
        <key>job_id</key>
        <defaultValue>unknown-job</defaultValue>
    </discriminator>
    <sift>
        <appender name="JOB-${job_id}" class="ch.qos.logback.core.rolling.RollingFileAppender">
            <file>logs/jobs/${job_id}.log</file>
            <rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
                <fileNamePattern>logs/jobs/${job_id}.%d{yyyy-MM-dd}.%i.log.gz</fileNamePattern>
                <maxFileSize>50MB</maxFileSize>
                <maxHistory>7</maxHistory>
                <totalSizeCap>5GB</totalSizeCap>
            </rollingPolicy>
            <encoder>
                <pattern>%d %-5level [%thread] %logger - %msg%n%ex</pattern>
            </encoder>
        </appender>
    </sift>
</appender>
```

### SiftingAppender Risks

| Risk | Explanation |
|---|---|
| unbounded appender creation | high-cardinality discriminator creates many appenders/files |
| disk explosion | per-user/per-request files are dangerous |
| file descriptor exhaustion | many active files |
| cleanup complexity | dynamic appenders need lifecycle/timeout management |
| cardinality leak | IDs in file paths/log routing |

Safe discriminator values:

1. environment;
2. module;
3. bounded job type;
4. bounded tenant group, if count is small and approved;
5. known batch execution ID only for controlled offline jobs.

Dangerous discriminator values:

1. user ID;
2. request ID;
3. trace ID;
4. raw session ID;
5. arbitrary header;
6. case ID if unbounded and high volume.

Rule:

```text
Do not use SiftingAppender with high-cardinality values unless the lifecycle and storage budget are explicitly bounded.
```

---

## 16. Filtering in Logback

Filters decide whether a log event should pass.

Filtering can happen at:

1. logger level;
2. appender filter;
3. turbo filter;
4. evaluator/filter expression;
5. downstream collector/query layer.

### 16.1 Threshold Filter

```xml
<appender name="ERROR_FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
    <file>logs/error.log</file>
    <filter class="ch.qos.logback.classic.filter.ThresholdFilter">
        <level>ERROR</level>
    </filter>
    <encoder>
        <pattern>%d %-5level %logger - %msg%n%ex</pattern>
    </encoder>
</appender>
```

Use for routing events of minimum level to a target.

---

### 16.2 Level Filter

```xml
<filter class="ch.qos.logback.classic.filter.LevelFilter">
    <level>WARN</level>
    <onMatch>ACCEPT</onMatch>
    <onMismatch>DENY</onMismatch>
</filter>
```

Use when exact level matters.

---

### 16.3 Marker-Based Filter

Markers can route special events.

Application code:

```java
import org.slf4j.Marker;
import org.slf4j.MarkerFactory;

private static final Marker SECURITY = MarkerFactory.getMarker("SECURITY");

log.warn(SECURITY, "login_failed user_id={} reason={}", userId, reason);
```

Filter idea:

```xml
<filter class="ch.qos.logback.classic.filter.MarkerFilter">
    <marker>SECURITY</marker>
    <onMatch>ACCEPT</onMatch>
    <onMismatch>DENY</onMismatch>
</filter>
```

Marker is useful when the same level does not imply same routing.

Example:

```text
WARN dependency timeout        -> application log
WARN login failed             -> security log
WARN invalid user input       -> maybe application/business diagnostic
```

---

### 16.4 TurboFilter

Turbo filters run earlier in the logging pipeline and can make decisions before full event construction in some cases.

Use carefully for:

1. dynamic log level control;
2. marker-based early denial;
3. rate-limiting noisy loggers;
4. security-sensitive suppression.

Avoid overly complex TurboFilters. If filter logic becomes business logic, your logging subsystem becomes a hidden policy engine.

---

## 17. Filtering Strategy: Do Not Hide Evidence Blindly

Filtering is powerful but dangerous.

Bad filtering:

```text
Drop all exceptions containing "timeout" because they are noisy.
```

Better:

```text
Aggregate repetitive timeout logs, preserve count metrics, keep sampled exemplars, emit summary event per time window.
```

Filtering principles:

1. Prefer reducing at source over dropping downstream.
2. Never hide ERROR without replacement metric/counter.
3. Preserve at least sampled exemplars for incident forensic.
4. Security/audit events need separate policy.
5. Document every production filter.
6. Test filters with representative events.

---

## 18. JSON Logging with Logback

Plain text logs are easy for humans but hard for machines. JSON logs are easier to query and correlate.

Plain text:

```text
2026-06-18 10:15:01 INFO OrderService - submitted order 123 for user 456
```

JSON:

```json
{
  "timestamp": "2026-06-18T10:15:01.123Z",
  "level": "INFO",
  "logger": "com.example.OrderService",
  "thread": "http-nio-8080-exec-7",
  "message": "order submitted",
  "event_name": "order.submitted",
  "order_id": "123",
  "user_id": "456",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7"
}
```

The important change is not just format. It is schema discipline.

---

## 19. JSON Logging Options in Logback

Logback core/classic does not historically focus on first-class structured JSON application logs the same way some ecosystems do, so many Java systems use an encoder library such as `logstash-logback-encoder`.

Common options:

| Option | Use Case |
|---|---|
| PatternLayout text | local dev, simple apps |
| PatternLayout with key=value | transitional systems |
| JSON encoder | production machine-queryable logs |
| Spring Boot structured logging properties | Spring Boot modern baseline if enough |
| Custom encoder/provider | strict enterprise schema |

Example dependency:

```xml
<dependency>
    <groupId>net.logstash.logback</groupId>
    <artifactId>logstash-logback-encoder</artifactId>
    <version>${logstash-logback-encoder.version}</version>
</dependency>
```

Gradle:

```gradle
dependencies {
    runtimeOnly("net.logstash.logback:logstash-logback-encoder:${logstashLogbackEncoderVersion}")
}
```

Always check compatibility among:

1. Java version;
2. Logback version;
3. SLF4J version;
4. Spring Boot managed dependency version;
5. encoder library version.

---

## 20. JSON Console Appender Baseline

For Kubernetes/container deployment, stdout JSON is usually preferred:

```xml
<configuration>
    <appender name="JSON_CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <customFields>{"service.name":"case-service","deployment.environment":"prod"}</customFields>
            <includeMdc>true</includeMdc>
            <includeStructuredArguments>true</includeStructuredArguments>
            <includeNonStructuredArguments>false</includeNonStructuredArguments>
        </encoder>
    </appender>

    <appender name="ASYNC_JSON_CONSOLE" class="ch.qos.logback.classic.AsyncAppender">
        <queueSize>8192</queueSize>
        <discardingThreshold>0</discardingThreshold>
        <neverBlock>false</neverBlock>
        <appender-ref ref="JSON_CONSOLE"/>
    </appender>

    <root level="INFO">
        <appender-ref ref="ASYNC_JSON_CONSOLE"/>
    </root>
</configuration>
```

This is a baseline, not universal final config.

Review before production:

1. field names match organization schema;
2. stack traces are accepted by collector;
3. multiline behavior is safe;
4. large fields are capped;
5. MDC does not leak PII/secrets;
6. async queue behavior matches SLO;
7. stdout collector can handle peak volume.

---

## 21. Structured Arguments vs MDC vs Message

There are three common places to put data.

### 21.1 Message

```java
log.info("user {} submitted case {}", userId, caseId);
```

Good for human reading, weaker for querying.

### 21.2 MDC

```java
MDC.put("user_id", userId);
MDC.put("case_id", caseId);
log.info("case submitted");
```

Good for context repeated across many logs in one request/task.

### 21.3 Structured Argument

With logstash-logback-encoder style:

```java
import static net.logstash.logback.argument.StructuredArguments.kv;

log.info("case submitted {} {}",
        kv("case_id", caseId),
        kv("case_type", caseType));
```

Good for fields specific to one event.

Decision:

| Data | Put In |
|---|---|
| request-wide context | MDC |
| event-specific field | structured argument/key-value |
| human explanation | message |
| trace/span identity | MDC or OTel log correlation integration |
| secret/token | nowhere |
| high-cardinality but necessary ID | structured field, but not metric label |

---

## 22. Designing JSON Log Schema

A useful production schema separates stable categories.

```json
{
  "@timestamp": "2026-06-18T10:15:01.123Z",
  "level": "INFO",
  "message": "case transition completed",
  "logger": "com.example.caseworkflow.CaseStateMachine",
  "thread": "http-nio-8080-exec-2",
  "service.name": "case-service",
  "service.version": "2026.06.18.1",
  "deployment.environment": "prod",
  "event.name": "case.transition.completed",
  "event.category": "state_transition",
  "event.outcome": "success",
  "trace_id": "...",
  "span_id": "...",
  "correlation_id": "...",
  "request_id": "...",
  "tenant_id": "...",
  "case_id": "...",
  "from_state": "SUBMITTED",
  "to_state": "UNDER_REVIEW",
  "actor_type": "USER",
  "duration_ms": 37
}
```

Recommended field groups:

| Group | Example Fields |
|---|---|
| time/severity | `@timestamp`, `level` |
| source | `logger`, `thread`, `class`, `method` if needed |
| service | `service.name`, `service.version`, `deployment.environment` |
| event | `event.name`, `event.category`, `event.outcome`, `event.reason_code` |
| trace | `trace_id`, `span_id`, `correlation_id`, `request_id` |
| domain | `case_id`, `tenant_id`, `module`, `workflow_id` |
| error | `error.type`, `error.message`, `error.stack_trace`, `error.code` |
| dependency | `peer.service`, `http.method`, `http.status_code`, `db.system` |
| performance | `duration_ms`, `attempt`, `retry_count` |

Important: choose whether to use snake_case, dotted names, or OpenTelemetry semantic convention style. Mixing all styles randomly will hurt queryability.

---

## 23. Avoid JSON Log Anti-Patterns

### 23.1 JSON Inside Message String

Bad:

```java
log.info("{\"event\":\"case_submitted\",\"caseId\":\"{}\"}", caseId);
```

This produces JSON-looking text inside the message, not necessarily structured fields.

Better:

```java
log.info("case submitted {}", kv("case_id", caseId));
```

---

### 23.2 Unbounded Object Logging

Bad:

```java
log.info("request={}", request);
log.info("entity={}", entity);
log.info("responseBody={}", responseBody);
```

Risks:

1. huge logs;
2. PII exposure;
3. lazy loading;
4. recursive `toString()`;
5. GC pressure;
6. ingestion cost spike.

Better:

```java
log.info("case submission received {} {} {}",
        kv("case_id", caseId),
        kv("request_size_bytes", requestSize),
        kv("attachment_count", attachmentCount));
```

---

### 23.3 Dynamic Field Names

Bad:

```json
{
  "module_case_management": "ok",
  "module_appeal": "ok"
}
```

Better:

```json
{
  "module": "case_management",
  "event.outcome": "success"
}
```

Dynamic field names cause mapping explosion in some log stores.

---

### 23.4 High-Cardinality Routing

Bad:

```xml
<key>request_id</key>
```

for `SiftingAppender` file routing.

Every request could create a file/appender.

---

## 24. Spring Boot Structured Logging Note

Modern Spring Boot versions include structured logging support via properties such as console/file structured format configuration. This can be useful when the built-in formats match your target platform enough.

But custom enterprise schemas often still need explicit `logback-spring.xml` and/or encoder configuration.

Decision:

| Need | Approach |
|---|---|
| simple ECS/GELF/Logstash-like output supported by Boot | Boot properties may be enough |
| strict custom schema | custom Logback config |
| advanced providers/masking | logstash-logback-encoder/custom provider |
| separate security/audit routing | explicit appenders/filters |

---

## 25. Redaction and Masking

Structured logging makes sensitive fields easier to find, but also easier to leak consistently.

Never log:

1. password;
2. access token;
3. refresh token;
4. session cookie;
5. private key;
6. full JWT;
7. Authorization header;
8. raw identity document;
9. full address/phone/email unless policy allows;
10. full request/response body by default.

Recommended pattern:

```java
log.info("external call failed {} {} {}",
        kv("peer.service", "onemap"),
        kv("http.status_code", status),
        kv("error.code", errorCode));
```

Instead of:

```java
log.warn("external call failed request={} response={}", requestBody, responseBody);
```

### 25.1 Basic Sanitizer

```java
public final class LogSanitizer {

    private LogSanitizer() {}

    public static String safeId(String value) {
        if (value == null) return null;
        String normalized = value.replace('\n', '_').replace('\r', '_').trim();
        return normalized.length() <= 128 ? normalized : normalized.substring(0, 128);
    }

    public static String maskEmail(String email) {
        if (email == null || email.isBlank()) return email;
        int at = email.indexOf('@');
        if (at <= 1) return "***";
        return email.charAt(0) + "***" + email.substring(at);
    }

    public static String fixedHashDisplay(String value) {
        // Use keyed HMAC in real systems if this is for safe correlation.
        // Do not use plain unsalted hash for sensitive identifiers.
        return value == null ? null : Integer.toHexString(value.hashCode());
    }
}
```

For serious compliance, implement centralized redaction in:

1. logging utility;
2. encoder provider;
3. API gateway;
4. collector processor;
5. code review rules;
6. tests scanning logs.

Do not rely only on developer discipline.

---

## 26. Log Injection

Log injection happens when untrusted input manipulates log structure.

Example attack input:

```text
john@example.com
ERROR admin login successful user=attacker
```

If logged raw in text logs, it can forge lines.

Mitigation:

1. sanitize CR/LF in user-controlled fields;
2. prefer JSON encoder that escapes strings properly;
3. still cap length;
4. do not put raw input as field names;
5. validate/sanitize correlation ID headers.

Example:

```java
private static String safeHeader(String value) {
    if (value == null) return null;
    String cleaned = value.replace('\r', '_').replace('\n', '_').trim();
    return cleaned.length() <= 128 ? cleaned : cleaned.substring(0, 128);
}
```

---

## 27. Pattern Library: Production Logback Configs

### 27.1 Local Development Text Logs

```xml
<configuration>
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%d{HH:mm:ss.SSS} %-5level [%thread] %logger{36} trace=%X{trace_id} corr=%X{correlation_id} - %msg%n%ex{short}</pattern>
        </encoder>
    </appender>

    <root level="INFO">
        <appender-ref ref="CONSOLE"/>
    </root>
</configuration>
```

Why text for local?

1. easier human scanning;
2. less noise;
3. IDE console friendly.

But ensure local does not hide production-only structured fields entirely.

---

### 27.2 Production Kubernetes JSON Console

```xml
<configuration>
    <property name="SERVICE_NAME" value="${SERVICE_NAME:-case-service}"/>
    <property name="ENVIRONMENT" value="${ENVIRONMENT:-local}"/>

    <appender name="JSON_CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <customFields>{"service.name":"${SERVICE_NAME}","deployment.environment":"${ENVIRONMENT}"}</customFields>
            <includeMdc>true</includeMdc>
            <includeStructuredArguments>true</includeStructuredArguments>
        </encoder>
    </appender>

    <appender name="ASYNC_JSON" class="ch.qos.logback.classic.AsyncAppender">
        <queueSize>${LOGBACK_ASYNC_QUEUE_SIZE:-8192}</queueSize>
        <discardingThreshold>${LOGBACK_DISCARDING_THRESHOLD:-0}</discardingThreshold>
        <neverBlock>${LOGBACK_NEVER_BLOCK:-false}</neverBlock>
        <maxFlushTime>${LOGBACK_MAX_FLUSH_TIME_MS:-5000}</maxFlushTime>
        <includeCallerData>false</includeCallerData>
        <appender-ref ref="JSON_CONSOLE"/>
    </appender>

    <root level="${ROOT_LOG_LEVEL:-INFO}">
        <appender-ref ref="ASYNC_JSON"/>
    </root>
</configuration>
```

---

### 27.3 Separate Security Log by Marker

```xml
<configuration>
    <appender name="SECURITY_JSON" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <customFields>{"log.category":"security"}</customFields>
        </encoder>
        <filter class="ch.qos.logback.classic.filter.MarkerFilter">
            <marker>SECURITY</marker>
            <onMatch>ACCEPT</onMatch>
            <onMismatch>DENY</onMismatch>
        </filter>
    </appender>

    <appender name="APP_JSON" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <customFields>{"log.category":"application"}</customFields>
        </encoder>
    </appender>

    <root level="INFO">
        <appender-ref ref="SECURITY_JSON"/>
        <appender-ref ref="APP_JSON"/>
    </root>
</configuration>
```

Warning: with this simple setup, SECURITY events may appear in both appenders unless APP_JSON has a deny marker filter. Decide intentionally.

---

### 27.4 Deny Security Marker from General Appender

```xml
<filter class="ch.qos.logback.classic.filter.MarkerFilter">
    <marker>SECURITY</marker>
    <onMatch>DENY</onMatch>
    <onMismatch>NEUTRAL</onMismatch>
</filter>
```

Use with caution. If security appender fails and general appender denies, you lose security logs. For critical evidence, prefer fail-safe duplication or durable pipeline.

---

## 28. Observability of Logging Itself

Logging subsystem should be observable.

What to watch:

1. app log event rate by level;
2. log ingestion rate;
3. collector error count;
4. collector queue/backpressure;
5. dropped log count if available;
6. application latency around log storm;
7. disk usage for file logs;
8. stdout/container log driver errors;
9. async appender queue symptoms;
10. number of dynamic appenders/files if using sifting.

Logback `AsyncAppender` does not always expose convenient built-in metrics out of the box. In mature systems, consider:

1. wrapping/extension for metrics;
2. collector-side dropped log metrics;
3. log volume dashboards;
4. alert on sudden ERROR log rate increase;
5. alert on sudden log rate drop to zero for live service;
6. alert on parser failure rate.

Important metric patterns:

```text
logs_ingested_total{service,level}
log_parse_errors_total{service}
log_pipeline_dropped_total{collector,reason}
container_log_bytes_total{namespace,pod}
```

But avoid putting high-cardinality fields like `request_id` or `trace_id` in metric labels.

---

## 29. Troubleshooting Missing Logs

When a log is missing, reason by pipeline stage.

```text
Was logger call executed?
   |
   +-- no: code path not reached / exception before logging / feature flag
   |
   +-- yes
       |
       +-- level enabled?
       |     +-- no: logger/root level config
       |
       +-- filter accepted?
       |     +-- no: marker/filter/turbo filter
       |
       +-- event created correctly?
       |     +-- no: exception in argument toString/supplier?
       |
       +-- async queue accepted?
       |     +-- no: queue full/drop/neverBlock
       |
       +-- child appender wrote?
       |     +-- no: appender stopped/output failure
       |
       +-- encoder produced valid output?
       |     +-- no: encoder exception/malformed JSON
       |
       +-- collector ingested?
       |     +-- no: stdout rotation/agent/collector issue
       |
       +-- query found it?
             +-- no: wrong time range/timezone/index/field/parser
```

Checklist:

1. verify effective log level;
2. check Logback status output;
3. search raw container logs before log store;
4. search by timestamp and pod, not only correlation ID;
5. check collector parse errors;
6. check app restart time;
7. check async drop/block policy;
8. check filters and markers;
9. check timezone;
10. check if event field names changed.

---

## 30. Troubleshooting Duplicate Logs

Duplicate logs usually come from additivity or multiple appenders.

Symptoms:

```text
same event printed twice
same JSON appears in two categories
same exception stack repeated many times
```

Causes:

1. child logger has appender and additivity true;
2. root logger and package logger both attach same appender;
3. Spring Boot default config plus custom config both active;
4. bridge loops/multiple bindings;
5. appender referenced twice;
6. security/audit routing duplicates intentionally but not labelled.

Fix:

```xml
<logger name="com.example.noisy" level="DEBUG" additivity="false">
    <appender-ref ref="SPECIAL"/>
</logger>
```

But use `additivity=false` carefully. It can also accidentally stop logs from reaching root appenders.

---

## 31. Troubleshooting Bad JSON Logs

Symptoms:

1. logs appear as plain text, not JSON;
2. JSON is nested as string under `message`;
3. multiline stack trace breaks parser;
4. fields missing;
5. MDC missing;
6. field type conflict in log store;
7. timestamp parsed incorrectly;
8. ingestion rejected due to size.

Root causes:

1. wrong appender/encoder active;
2. local profile config active in prod;
3. collector expects different format;
4. stack trace not encoded as JSON field;
5. dynamic field type changes, e.g. `status` sometimes string sometimes number;
6. field names contain unsupported characters;
7. too-large message.

Fix discipline:

1. validate one log line as JSON in CI;
2. snapshot test fields;
3. enforce schema for required fields;
4. cap field lengths;
5. keep field types stable;
6. avoid dynamic fields.

---

## 32. Testing Logging Behavior

Logging should be tested when it is part of operational contract.

### 32.1 Unit Test: Event Emitted

Use a test appender or list appender.

```java
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import static org.assertj.core.api.Assertions.assertThat;

class CaseServiceLoggingTest {

    @Test
    void logsStateTransition() {
        Logger logger = (Logger) LoggerFactory.getLogger(CaseService.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);

        try {
            new CaseService().transition("CASE-1", "SUBMITTED", "UNDER_REVIEW");

            assertThat(appender.list)
                    .anySatisfy(event -> {
                        assertThat(event.getFormattedMessage()).contains("case transition completed");
                        assertThat(event.getLevel().toString()).isEqualTo("INFO");
                    });
        } finally {
            logger.detachAppender(appender);
        }
    }
}
```

Test only important logs. Do not make every message text brittle.

---

### 32.2 Integration Test: MDC Exists

```java
@Test
void requestLogsContainCorrelationId() {
    // Send request with X-Correlation-Id
    // Capture logs via test appender
    // Assert MDC property exists on ILoggingEvent
}
```

Focus on fields, not exact text.

---

### 32.3 CI Smoke Test: JSON Log is Parseable

During app startup test, capture one log line and parse it as JSON. Assert required fields:

```text
@timestamp
level
message
logger
service.name
deployment.environment
correlation_id or trace_id for request logs
```

This catches many production surprises.

---

## 33. Java 8–25 Considerations

### Java 8

1. no virtual threads;
2. thread pools dominate;
3. MDC leak risk high;
4. old SLF4J/Logback versions common;
5. Java 8 date/time support available but many legacy configs remain;
6. container awareness weaker depending JVM update level.

### Java 11/17

1. common enterprise LTS baselines;
2. better container support;
3. modern Logback/Spring Boot versions common;
4. JFR available in OpenJDK builds;
5. structured logging easier to standardize.

### Java 21

1. virtual threads mainstream;
2. structured concurrency preview/incubator depending version;
3. MDC still works but context design needs reevaluation;
4. thread names may be less useful when using many virtual threads;
5. prefer trace IDs and operation names over relying on thread identity.

### Java 25

1. modern runtime features around scoped values/structured concurrency mature further;
2. context propagation strategy should distinguish canonical context from logging compatibility;
3. old ThreadLocal-heavy patterns should be reviewed.

Important conclusion:

```text
MDC is a logging compatibility mechanism, not necessarily the ideal canonical context model for Java 21+ designs.
```

---

## 34. Production Checklist

### AsyncAppender Checklist

- [ ] Queue size chosen based on measured burst, not copied blindly.
- [ ] `neverBlock` decision documented.
- [ ] `discardingThreshold` decision documented.
- [ ] Audit/security logs not accidentally lossy.
- [ ] Caller data disabled unless explicitly justified.
- [ ] Shutdown flush time aligned with container grace period.
- [ ] Log storm behavior tested.
- [ ] Output target throughput tested.

### MDC Checklist

- [ ] Context set at inbound boundary.
- [ ] Context cleared in `finally`.
- [ ] Async executors propagate context.
- [ ] No raw token/secret in MDC.
- [ ] Header values sanitized.
- [ ] Key names standardized.
- [ ] MDC leak tested.
- [ ] Reactor/CompletableFuture/scheduler boundaries reviewed.

### Sifting/Filtering Checklist

- [ ] Discriminator cardinality bounded.
- [ ] File descriptor/disk risk assessed.
- [ ] Filters documented.
- [ ] Important dropped events replaced by metric/sample/durable event.
- [ ] Marker routing tested.

### JSON Checklist

- [ ] Logs are valid one-line JSON.
- [ ] Required fields always present.
- [ ] Field names stable.
- [ ] Field types stable.
- [ ] Stack traces parse correctly.
- [ ] Large fields capped.
- [ ] PII/secrets redacted.
- [ ] Collector/parser tested.

---

## 35. Practical Labs

### Lab 1 — Build Async Logback Config

Create:

1. `CONSOLE_JSON` appender;
2. `ASYNC_CONSOLE` wrapper;
3. environment-configurable queue size;
4. `discardingThreshold` and `neverBlock` toggles;
5. one endpoint that emits 10,000 logs for stress testing.

Observe:

1. request latency;
2. log completeness;
3. CPU;
4. heap allocation;
5. collector behavior.

---

### Lab 2 — MDC Servlet Filter

Implement:

1. incoming `X-Correlation-Id`;
2. generated request ID;
3. route template;
4. response header echo;
5. `finally MDC.clear()`.

Test:

1. request with header;
2. request without header;
3. malicious header with newline;
4. two sequential requests on same thread.

---

### Lab 3 — MDC Executor Propagation

Create:

1. controller logs request;
2. async service logs work;
3. compare with and without MDC-aware executor.

Expected:

```text
without propagation: async log missing correlation_id
with propagation: async log contains correlation_id
```

---

### Lab 4 — SiftingAppender Risk Simulation

Configure SiftingAppender by `request_id` in local environment.

Send 1,000 requests.

Observe:

1. number of files;
2. file handles;
3. cleanup difficulty;
4. disk usage.

Then replace discriminator with bounded `job_type` and compare.

---

### Lab 5 — JSON Schema Contract Test

Emit a sample log and assert:

1. parseable JSON;
2. `service.name` exists;
3. `deployment.environment` exists;
4. `event.name` exists for business events;
5. `correlation_id` exists for request logs;
6. no forbidden keys such as `password`, `authorization`, `token`.

---

## 36. Common Interview/Review Questions

1. Why is async logging not automatically safer than sync logging?
2. What happens when Logback async queue is full?
3. When would you choose `neverBlock=true`?
4. Why is MDC leak dangerous?
5. How do you propagate MDC across `CompletableFuture`?
6. Why should audit logs not rely only on lossy async logging?
7. Why is caller data expensive?
8. When is `SiftingAppender` dangerous?
9. What fields should always exist in JSON logs?
10. How do you investigate missing logs?
11. How do you avoid logging PII/secrets?
12. How do virtual threads change MDC reasoning?
13. Why should field names be stable?
14. Why is JSON-in-message not structured logging?
15. How do you detect duplicate logs?

---

## 37. Ringkasan Mental Model

Logback advanced engineering is about controlling trade-offs:

```text
completeness vs latency
human readability vs machine queryability
local simplicity vs production schema discipline
context richness vs PII/security risk
filtering noise vs losing evidence
async performance vs drop/block ambiguity
routing precision vs cardinality explosion
```

The mature engineer does not ask only:

```text
How do I configure async logging?
```

They ask:

```text
Which evidence can be dropped?
Which evidence must be durable?
Which context must follow the request/task?
What is the blast radius if logs are delayed, duplicated, or missing?
How will I prove what happened during an incident?
How will the logging subsystem behave under stress?
```

That is the difference between using a logging framework and engineering an observability-grade logging subsystem.

---

## 38. Output yang Harus Kamu Kuasai Setelah Part Ini

Setelah menyelesaikan bagian ini, kamu seharusnya mampu:

1. menjelaskan cara kerja `AsyncAppender` secara runtime;
2. memilih `queueSize`, `discardingThreshold`, dan `neverBlock` secara sadar;
3. menjelaskan risiko dropped logs dan blocked request threads;
4. mendesain MDC schema yang aman;
5. mencegah MDC leak;
6. membuat servlet filter untuk correlation/request context;
7. membuat executor/task decorator untuk MDC propagation;
8. memahami impact virtual threads terhadap diagnostic context;
9. memakai `SiftingAppender` hanya untuk bounded cardinality;
10. mendesain filter tanpa kehilangan evidence penting;
11. menghasilkan JSON logs yang queryable;
12. membedakan message, MDC, dan structured arguments;
13. membuat checklist production readiness logging;
14. troubleshoot missing logs, duplicate logs, and malformed JSON logs.

---

## 39. Koneksi ke Part Berikutnya

Part berikutnya akan berpindah ke backend lain:

```text
Part 7 — Log4j2 Deep Dive I: Architecture, Configuration, Appenders, Layouts
```

Di sana kita akan membedah Log4j2 sebagai backend logging yang berbeda secara arsitektural dari Logback, terutama pada konfigurasi, plugin system, layout, appender model, dan ecosystem integration. Setelah itu Part 8 akan masuk ke AsyncLogger, Disruptor, garbage-free logging, routing, dan security.



<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 5 — Logback Deep Dive I: Architecture, Configuration, Appenders, Encoders](./05-logback-deep-dive-architecture-configuration-appenders-encoders.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 7 — Log4j2 Deep Dive I: Architecture, Configuration, Appenders, Layouts](./07-log4j2-deep-dive-architecture-configuration-appenders-layouts.md)

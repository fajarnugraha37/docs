# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-025
# Observability II: Metrics, OpenTelemetry, Tracing, Profiling, Health Checks

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Part: `025`  
> Topik: Observability II: Metrics, OpenTelemetry, Tracing, Profiling, Health Checks  
> Status: Materi lanjutan advance — tidak mengulang dasar logging dari Part 024  
> Target: Software engineer yang mampu mendesain observability production-grade untuk Quarkus service: metrics, tracing, health checks, probes, profiling, dashboard, SLO, dan incident diagnosis

---

## 0. Ringkasan Besar

Part sebelumnya membahas logging, structured logs, correlation, MDC, dan audit trail.

Part ini melengkapi observability dengan sinyal lain:

1. **Metrics**
   - berapa banyak,
   - seberapa cepat,
   - seberapa sering gagal,
   - kapasitas/saturasi.

2. **Tracing**
   - request ini melewati apa saja,
   - dependency mana yang lambat,
   - span mana yang gagal,
   - service mana yang menjadi bottleneck.

3. **Health Checks**
   - apakah service hidup,
   - apakah service siap menerima traffic,
   - apakah startup sudah selesai,
   - apakah dependency critical tersedia.

4. **Profiling**
   - CPU habis di mana,
   - memory dialokasikan oleh siapa,
   - lock/thread blocking di mana,
   - native/JVM behavior berbeda apa.

5. **SLO and Alerting**
   - bagaimana mendefinisikan sehat dari sisi user/business,
   - kapan harus membangunkan engineer,
   - kapan hanya dashboard,
   - kapan alert adalah noise.

Quarkus menyediakan observability ecosystem melalui extension seperti OpenTelemetry, Micrometer, SmallRye Health, logging, Dev Services observability stack, dan integrasi Kubernetes/cloud-native. Dokumentasi resmi Quarkus menempatkan observability sebagai kemampuan untuk memungkinkan manusia bertanya dan menjawab pertanyaan tentang sistem. Rujukan utama: Quarkus Observability, OpenTelemetry, Micrometer, SmallRye Health, dan Observability Dev Services LGTM. 

---

## 1. Mental Model: Observability Bukan Monitoring Dashboard

Monitoring tradisional sering berarti:

```text
CPU tinggi?
Memory tinggi?
Service up?
```

Observability yang baik menjawab pertanyaan yang belum kamu prediksi sebelumnya.

Contoh pertanyaan production:

```text
Kenapa submit application lambat untuk tenant tertentu?
Apakah latency naik karena DB atau external identity API?
Apakah error 500 berasal dari validation bug atau timeout dependency?
Apakah job expiry masih berjalan?
Apakah Kafka consumer lag bertambah karena downstream circuit open?
Apakah native image mengurangi memory tetapi menaikkan CPU?
Apakah readiness probe terlalu agresif sehingga pod flapping?
Apakah p99 latency naik meskipun p50 stabil?
Apakah user melihat stale cache?
```

Observability bukan sekadar memasang Grafana.

Observability adalah desain evidence.

```text
Logs menjelaskan event.
Metrics menjelaskan jumlah/trend.
Traces menjelaskan perjalanan request.
Profiles menjelaskan penggunaan resource internal.
Health checks menjelaskan lifecycle readiness.
Audit trail menjelaskan keputusan bisnis/security.
```

---

## 2. Observability Stack in Quarkus

Quarkus menyediakan beberapa jalur observability:

1. **OpenTelemetry**
   - tracing,
   - metrics/logging integration tergantung konfigurasi/extension,
   - OTLP export,
   - context propagation.

2. **Micrometer**
   - metrics abstraction,
   - counters, gauges, timers, distribution summaries,
   - Prometheus/OpenMetrics endpoint,
   - runtime and application metrics.

3. **SmallRye Health**
   - liveness,
   - readiness,
   - startup health checks,
   - Kubernetes/cloud-native probe integration.

4. **Logging / JSON Logging**
   - structured log,
   - MDC,
   - correlation.

5. **Observability Dev Services**
   - local/dev orchestration of observability backend.
   - Grafana OTel LGTM image can bundle OpenTelemetry Collector, Prometheus, Tempo, Loki, and Grafana for dev/test visualization.

Quarkus Observability guide is the entry point for choosing these extensions. OpenTelemetry guide explains OTel use for interactive web applications. Micrometer guide describes metrics types and registry abstraction. SmallRye Health guide explains health information for cloud environments where automated processes decide restart/discard behavior. Observability Dev Services LGTM provides an all-in-one local stack forwarding telemetry to Prometheus, Tempo, Loki, and Grafana.

---

## 3. Metrics vs Logs vs Traces: Do Not Use One Signal for Everything

### 3.1 Metrics

Good for:

```text
How many?
How often?
How slow?
How saturated?
How many failures?
Is trend changing?
```

Examples:

```text
http.server.requests count/duration
db.connection.pool.active
external.identity.timeout.total
job.run.duration
cache.hit.ratio
queue.consumer.lag
```

### 3.2 Logs

Good for:

```text
What exactly happened at this moment?
What was the error classification?
What business object was affected?
```

### 3.3 Traces

Good for:

```text
Where did time go in this request?
Which service/span failed?
What dependency chain was involved?
```

### 3.4 Profiles

Good for:

```text
Where is CPU spent?
Who allocates memory?
Which lock blocks threads?
Why native/JVM behavior differs?
```

### 3.5 Health Checks

Good for:

```text
Should orchestrator send traffic?
Should orchestrator restart this pod?
Is startup complete?
```

Anti-pattern:

```text
Using logs to count high-volume events.
Using metrics to store user IDs.
Using traces as audit.
Using health checks as full dependency monitor.
Using liveness to signal downstream outage.
```

---

## 4. Metrics Fundamentals

Metrics are numeric time-series.

Common meter types:

1. **Counter**
   - monotonically increasing count.
   - Example: total requests, total failures.

2. **Gauge**
   - current value.
   - Example: active connections, queue depth.

3. **Timer**
   - duration distribution + count.
   - Example: request latency, DB query latency.

4. **Distribution Summary**
   - distribution of sizes.
   - Example: payload size, batch size.

5. **Long Task Timer**
   - duration of currently running long tasks.
   - Example: background job running time.

Micrometer provides an abstraction layer with meter types and registries, and Quarkus integrates Micrometer to collect runtime, extension, and application metrics.

---

## 5. RED and USE Metrics

### 5.1 RED Metrics

For request/transaction oriented services:

```text
Rate
Errors
Duration
```

Examples:

```text
request rate
error rate
duration p50/p95/p99
```

Useful for:

- HTTP APIs,
- REST clients,
- messaging consumers,
- business operations.

### 5.2 USE Metrics

For resources:

```text
Utilization
Saturation
Errors
```

Examples:

```text
CPU utilization
DB pool active/pending
worker queue size
Kafka lag
memory usage
disk IO
thread pool saturation
```

Use both.

RED tells you user impact.

USE tells you resource pressure.

---

## 6. Metric Naming Principles

Metric names should be:

- stable,
- low-cardinality,
- semantically clear,
- unit-aware,
- consistent across services,
- not tied to implementation details too tightly.

Examples:

```text
application_submission_total
application_submission_duration_seconds
external_call_total
external_call_duration_seconds
job_run_total
job_run_duration_seconds
cache_operation_total
message_processing_duration_seconds
```

Labels/tags:

```text
service
environment
operation
status
error_code
dependency
method
path_template
job_name
tenant_class optional
```

Avoid labels:

```text
user_id
email
application_id
case_id
raw_url
stack_trace
request_body
session_id
idempotency_key
```

High-cardinality labels can damage metrics backend.

Rule:

```text
Business object IDs belong in logs/traces/audit, not metric labels.
```

---

## 7. Micrometer in Quarkus

### 7.1 Add Extension

```bash
./mvnw quarkus:add-extension -Dextensions="micrometer"
```

For Prometheus registry:

```bash
./mvnw quarkus:add-extension -Dextensions="micrometer-registry-prometheus"
```

Conceptual dependency:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-micrometer</artifactId>
</dependency>
```

Prometheus:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-micrometer-registry-prometheus</artifactId>
</dependency>
```

### 7.2 MeterRegistry

```java
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class ApplicationMetrics {

    private final MeterRegistry registry;

    public ApplicationMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    public void recordSubmissionSuccess() {
        registry.counter(
                "application_submission_total",
                "result", "success"
        ).increment();
    }
}
```

### 7.3 Timer

```java
import io.micrometer.core.instrument.Timer;

public void submit() {
    Timer.Sample sample = Timer.start(registry);

    try {
        submissionService.submit();
        registry.counter("application_submission_total", "result", "success").increment();
    } catch (Exception e) {
        registry.counter("application_submission_total", "result", "failure").increment();
        throw e;
    } finally {
        sample.stop(registry.timer("application_submission_duration_seconds"));
    }
}
```

Better encapsulate metric logic to avoid duplicate boilerplate.

---

## 8. Application Metrics Design

Do not only rely on framework metrics.

Framework metrics tell:

```text
HTTP request latency
JVM memory
thread pools
DB pools
```

Application metrics tell:

```text
How many applications submitted?
How many approvals failed due to state conflict?
How many case escalations are overdue?
How many job items failed final?
How many external identity lookups timed out?
How much stale cache served?
```

Examples:

```text
application_state_transition_total{transition,result}
authorization_decision_total{operation,decision,reason}
external_call_total{dependency,operation,result}
job_item_total{job_name,status}
outbox_pending_total{channel}
message_processing_total{channel,event_type,result}
cache_stale_served_total{cache_name}
```

Metric design should mirror domain operations.

---

## 9. Avoid Metric Cardinality Explosion

Bad:

```java
registry.counter(
    "application_submission_total",
    "applicationId", applicationId
).increment();
```

If there are millions of applications, metrics backend explodes.

Better:

```java
registry.counter(
    "application_submission_total",
    "result", "success",
    "module", "application-management"
).increment();
```

Put `applicationId` in logs/audit/trace.

### 9.1 Cardinality Review Checklist

For every label:

```text
How many possible values?
Can it grow unbounded?
Can it contain PII?
Is it useful for aggregation?
Could it create one series per user/object/request?
```

Allowed-ish:

- status,
- method,
- path template,
- dependency,
- operation,
- result,
- error class/code with bounded taxonomy,
- job name.

Dangerous:

- user ID,
- tenant ID if many tenants,
- object ID,
- raw exception message,
- raw URL,
- request parameter.

---

## 10. Histograms and Percentiles

Latency averages are weak.

Bad:

```text
avg latency = 120ms
```

Could hide:

```text
p50 = 40ms
p95 = 800ms
p99 = 4s
```

For user experience, p95/p99 matter.

Micrometer supports timers/distribution statistics depending on registry/config.

Guidelines:

- expose percentiles carefully,
- use histograms for Prometheus where appropriate,
- define SLO buckets,
- avoid unnecessary histogram cardinality,
- measure external dependencies separately from inbound latency.

Example metrics:

```text
http_server_requests_seconds_bucket
external_call_duration_seconds_bucket
job_run_duration_seconds_bucket
```

---

## 11. OpenTelemetry in Quarkus

OpenTelemetry provides a standard for telemetry:

- traces,
- metrics,
- logs,
- context propagation,
- OTLP exporter.

Quarkus OpenTelemetry guide explains how Quarkus applications can use OTel for observability, especially interactive web apps. OTel is signal-independent at core, and Quarkus integrates it with HTTP, REST client, and other extensions depending on configuration.

### 11.1 Add Extension

```bash
./mvnw quarkus:add-extension -Dextensions="opentelemetry"
```

Conceptual dependency:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-opentelemetry</artifactId>
</dependency>
```

### 11.2 OTLP Exporter Concept

```properties
quarkus.otel.exporter.otlp.endpoint=http://otel-collector:4317
quarkus.otel.service.name=application-service
```

Exact property names should be verified against selected Quarkus version.

### 11.3 Trace Context

OpenTelemetry uses trace context to correlate spans across services.

HTTP headers commonly include:

```text
traceparent
tracestate
baggage
```

Do not invent custom trace propagation if OTel is enabled.

Still keep business correlation ID separately.

---

## 12. Tracing Fundamentals

A trace is a tree/graph of spans.

Example:

```text
Trace: POST /applications
  Span: HTTP POST /applications
    Span: validate request
    Span: identity-api GET /identity/{id}
    Span: DB insert application
    Span: outbox insert
```

Span fields:

```text
traceId
spanId
parentSpanId
name
start/end time
attributes/tags
events
status
```

Good span names are low-cardinality:

```text
POST /applications
identity-api GET /identity/{id}
db.application.insert
application.submit
```

Bad span names:

```text
GET /identity/S1234567A
submit APP-123 by user U-456
```

Use attributes for detail, but avoid high-cardinality/PII in attributes.

---

## 13. Manual Spans

Automatic instrumentation is helpful but not enough.

Add manual spans for important domain operations.

Example conceptual:

```java
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class ApplicationSubmissionService {

    private final Tracer tracer;

    public ApplicationSubmissionService(Tracer tracer) {
        this.tracer = tracer;
    }

    public void submit(SubmitCommand command) {
        Span span = tracer.spanBuilder("application.submit").startSpan();

        try (var scope = span.makeCurrent()) {
            span.setAttribute("module", "application-management");
            span.setAttribute("operation", "submit");
            span.setAttribute("tenant", command.tenantClass()); // avoid high cardinality if needed

            // business logic
        } catch (Exception e) {
            span.recordException(e);
            span.setStatus(io.opentelemetry.api.trace.StatusCode.ERROR);
            throw e;
        } finally {
            span.end();
        }
    }
}
```

Do not add sensitive attributes.

---

## 14. Span Attribute Discipline

Good attributes:

```text
operation=submit_application
module=application-management
dependency=identity-api
result=success/failure
error_code=IDENTITY_TIMEOUT
retryable=true
cache_hit=true
job_name=expiry-job
```

Dangerous attributes:

```text
nric
email
full address
applicationId if high cardinality and exported widely
access token
raw SQL with parameters
request body
```

Tracing backends may store data widely. Treat span attributes as logs.

---

## 15. Tracing External Calls

Outbound HTTP client spans should show:

```text
dependency
method
path template
status code
duration
retry attempts if visible
error classification
```

Do not use raw URL path with IDs as span name.

Better:

```text
identity-api GET /identity/{id}
```

Tracing should answer:

```text
Was request slow because external API was slow?
Which dependency consumed most time?
Was retry attempted?
Was circuit open?
```

---

## 16. Tracing Messaging

For messaging:

```text
producer span
broker propagation
consumer span
message processing span
```

Include:

```text
channel
topic
partition maybe
consumer group
event_type
event_version
message_id
correlation_id
```

But avoid unbounded IDs as metric labels; trace attributes can tolerate more but still should be controlled.

Messaging trace context requires propagation through message headers.

---

## 17. Tracing Background Jobs

Jobs are not HTTP requests, but they still need traces.

Trace:

```text
job.run application-expiry
  -> scan candidates
  -> process batch 1
  -> db update
  -> outbox insert
  -> process batch 2
```

For huge jobs, do not create span per item if millions of items.

Use:

- job run span,
- partition/batch spans,
- sampled item spans only for failures,
- metrics for counts,
- logs/item_result table for details.

---

## 18. Metrics and Tracing Together

Metrics tell:

```text
external identity p99 latency is high
```

Traces tell:

```text
which request path and span causes it
```

Logs tell:

```text
specific error event with correlation ID
```

Audit tells:

```text
business action affected
```

Use flow:

```text
Alert fires on metric
  -> open dashboard
  -> find affected dependency/operation
  -> inspect traces for slow/failing requests
  -> use correlation ID to query logs
  -> use business ID to inspect audit/domain records
```

This is observability workflow.

---

## 19. Health Checks in Quarkus

Quarkus SmallRye Health implements MicroProfile Health and exposes health endpoints useful in cloud environments.

Add extension:

```bash
./mvnw quarkus:add-extension -Dextensions="smallrye-health"
```

Conceptual dependency:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-smallrye-health</artifactId>
</dependency>
```

Health endpoints typically include:

```text
/q/health
/q/health/live
/q/health/ready
/q/health/started
```

Exact paths depend on non-application root path configuration.

---

## 20. Liveness vs Readiness vs Startup

### 20.1 Liveness

Question:

```text
Should orchestrator restart this container?
```

Liveness should fail only if process is broken and restart may help.

Do not fail liveness because:

- external dependency down,
- DB temporarily unavailable,
- Kafka lag high,
- downstream 503,
- background job failed.

If liveness fails, Kubernetes restarts pod. Restarting app because DB is down may create restart storm.

### 20.2 Readiness

Question:

```text
Should orchestrator send traffic to this pod?
```

Readiness can depend on:

- app initialized,
- DB connection available if required for serving traffic,
- essential configuration loaded,
- critical dependency ready depending design.

If readiness fails, pod stays running but receives no traffic.

### 20.3 Startup

Question:

```text
Has application completed startup initialization?
```

Startup probe prevents liveness from killing slow-starting app too early.

Useful for:

- JVM app with slow startup,
- native app with warmup,
- heavy schema/init validation,
- cache warmup if critical.

---

## 21. Implementing Health Checks

### 21.1 Readiness Check

```java
import org.eclipse.microprofile.health.HealthCheck;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.Readiness;
import jakarta.enterprise.context.ApplicationScoped;

@Readiness
@ApplicationScoped
public class DatabaseReadinessCheck implements HealthCheck {

    private final DatabasePing databasePing;

    public DatabaseReadinessCheck(DatabasePing databasePing) {
        this.databasePing = databasePing;
    }

    @Override
    public HealthCheckResponse call() {
        boolean ok = databasePing.isAvailable();

        return HealthCheckResponse.named("database")
                .status(ok)
                .withData("critical", true)
                .build();
    }
}
```

### 21.2 Liveness Check

```java
import org.eclipse.microprofile.health.Liveness;

@Liveness
@ApplicationScoped
public class ApplicationLivenessCheck implements HealthCheck {

    @Override
    public HealthCheckResponse call() {
        return HealthCheckResponse.up("application");
    }
}
```

Do not make liveness perform slow DB/external calls.

### 21.3 Startup Check

```java
import org.eclipse.microprofile.health.Startup;

@Startup
@ApplicationScoped
public class StartupCompletedCheck implements HealthCheck {

    private final StartupState startupState;

    public StartupCompletedCheck(StartupState startupState) {
        this.startupState = startupState;
    }

    @Override
    public HealthCheckResponse call() {
        return HealthCheckResponse.named("startup")
                .status(startupState.isCompleted())
                .build();
    }
}
```

---

## 22. Health Check Anti-Patterns

### 22.1 Liveness Depends on Database

DB goes down, all pods restart, DB gets more load, system worsens.

### 22.2 Readiness Depends on Optional Dependency

Recommendation service down should not remove core API from load balancer if core function still works.

### 22.3 Health Check Too Slow

Health endpoint itself becomes expensive.

### 22.4 Health Check Mutates State

Health check should not write business data.

### 22.5 Health Check Calls Many Dependencies

Health endpoint becomes distributed transaction of all dependencies.

### 22.6 Health Endpoint Exposes Secrets

Do not expose URLs, credentials, sensitive config.

### 22.7 Green Health But Broken Business Path

Health checks should be complemented by synthetic checks and business metrics.

---

## 23. Kubernetes Probes

In Kubernetes:

```text
livenessProbe -> restart container if failing
readinessProbe -> remove pod from service endpoints if failing
startupProbe -> protect slow startup from premature liveness restart
```

With SmallRye Health extension, Quarkus Kubernetes extension can add readiness/liveness probes to generated resources. Official deployment guide notes adding SmallRye Health makes adding readiness and liveness probes straightforward for Kubernetes generated deployment resources.

Example conceptual YAML:

```yaml
livenessProbe:
  httpGet:
    path: /q/health/live
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /q/health/ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 3

startupProbe:
  httpGet:
    path: /q/health/started
    port: 8080
  periodSeconds: 5
  failureThreshold: 30
```

Probe tuning matters.

Too aggressive:

```text
pod flapping
restart loop
traffic instability
```

Too lenient:

```text
bad pod receives traffic too long
failure detection slow
```

---

## 24. Observability for JVM Runtime

Quarkus app on JVM still has JVM runtime metrics:

- heap used,
- non-heap used,
- GC count/time,
- thread count,
- class loading,
- CPU,
- memory pools,
- direct buffers,
- Netty/Vert.x event loops if exposed,
- connection pools.

Important metrics:

```text
jvm_memory_used_bytes
jvm_gc_pause_seconds
jvm_threads_live_threads
process_cpu_usage
system_cpu_usage
http_server_requests_seconds
agroal_active_count
agroal_available_count
agroal_awaiting_count
```

Exact metric names depend on registry and extension.

### 24.1 JVM Metrics Interpretation

High heap usage alone is not always bad.

Ask:

```text
Is GC pause increasing?
Is allocation rate high?
Is live set growing?
Is memory near container limit?
Is RSS increasing?
Is native/direct memory growing?
Is there OOM risk?
```

---

## 25. Observability for Native Image

Native image changes runtime behavior.

Common differences:

```text
startup faster
RSS often lower
GC/runtime differs
reflection/dynamic behavior limited
profiling tools differ
JVM metrics may not all exist in same form
stack traces may differ
```

Native mode observability must be tested separately.

Do not assume JVM dashboard works unchanged for native.

Need validate:

- metrics exported,
- health endpoints,
- trace export,
- logs/JSON,
- TLS/client metrics,
- memory/RSS,
- CPU under load,
- startup time,
- readiness timing,
- profiling approach.

---

## 26. Profiling: When Metrics Are Not Enough

Metrics show symptoms:

```text
CPU high
latency high
memory high
GC high
```

Profiling shows causes:

```text
which method consumes CPU
which allocation path creates garbage
which lock blocks
which thread is stuck
which native call is expensive
```

Types:

1. CPU profiling.
2. Allocation profiling.
3. Wall-clock profiling.
4. Lock profiling.
5. Thread dump analysis.
6. Heap dump analysis.
7. Native image profiling.
8. Async profiler/JFR depending runtime.

### 26.1 Java Flight Recorder

For JVM mode, JFR is valuable:

- low overhead,
- CPU samples,
- allocation events,
- lock events,
- GC,
- threads,
- IO,
- exceptions,
- custom events if added.

Use for:

- performance investigation,
- production-like load test,
- incident capture if allowed.

### 26.2 Thread Dumps

Thread dumps answer:

```text
What are threads doing right now?
Are workers blocked?
Is event loop blocked?
Are many threads waiting for DB pool?
Is there deadlock?
```

In Quarkus reactive applications, also watch event loop blocking.

### 26.3 Heap Dumps

Heap dumps answer:

```text
What objects occupy memory?
Is cache too large?
Are request objects retained?
Is there classloader leak?
Are byte arrays/direct buffers growing?
```

Heap dumps can contain sensitive data. Handle securely.

---

## 27. Event Loop and Worker Observability

For Quarkus reactive core:

Watch:

- event loop blocked warnings,
- worker pool saturation,
- request queueing,
- blocked thread detection,
- reactive pipeline latency,
- Mutiny failure rate,
- HTTP client pending requests.

If event loop is blocked:

```text
Small blocking code can degrade many concurrent requests.
```

Metrics/traces/logs should help answer:

```text
Which endpoint blocks?
Which operation is on event loop?
Is JDBC called from event loop?
Is file IO blocking?
Is CPU-heavy mapping running on event loop?
```

---

## 28. Database Pool Observability

For Quarkus with JDBC/Agroal, watch:

```text
active connections
available connections
awaiting/pending requests
max pool size
connection acquisition time
validation failures
leak detection
query latency
transaction duration
```

Symptoms:

```text
awaiting count > 0
active == max
request latency rising
timeouts increasing
```

Causes:

- pool too small,
- slow queries,
- transaction too long,
- external call inside transaction,
- connection leak,
- job consumes pool,
- DB CPU high.

Metrics should be paired with DB-side observability.

---

## 29. Messaging Observability

For Kafka/RabbitMQ/AMQP:

Metrics:

```text
consumer lag
message processing duration
message processing failures
ack/nack count
retry count
DLQ count
poll duration
in-flight messages
queue depth
redelivery count
```

Logs:

```text
message_processing_failed
message_moved_to_dlq
consumer_paused
consumer_resumed
```

Traces:

```text
producer span
consumer span
processing span
external call span
```

Business metric:

```text
application_events_processed_total
case_escalations_published_total
outbox_pending_total
```

---

## 30. Cache Observability

Metrics:

```text
cache_hit_total
cache_miss_total
cache_hit_ratio
cache_load_duration
cache_load_failure
cache_eviction_total
cache_size
stale_cache_served_total
redis_timeout_total
redis_latency
```

Trace/log:

```text
cache_miss_load_started
cache_invalidation
cache_stale_served
```

Beware:

```text
High hit ratio can mean high stale data.
```

Include freshness metrics for critical caches.

---

## 31. Job Observability

From Part 020:

Metrics:

```text
job_runs_total{job_name,status}
job_run_duration_seconds{job_name}
job_items_total{job_name,status}
job_retry_total{job_name,error_code}
job_current_running{job_name}
job_last_success_timestamp{job_name}
job_lag_seconds{job_name}
```

Health:

```text
Do not fail liveness because job failed.
Expose job status separately.
```

Alert:

```text
No successful run for X hours.
Job stuck RUNNING without heartbeat.
DLQ/final failures exceed threshold.
Lag exceeds SLA.
```

---

## 32. SLI, SLO, and Error Budget

### 32.1 SLI

Service Level Indicator = measurement.

Examples:

```text
request success rate
request latency p95
job completion freshness
message processing lag
availability
```

### 32.2 SLO

Service Level Objective = target.

Examples:

```text
99.9% of submit requests complete successfully monthly.
95% of submit requests complete under 2 seconds.
Daily expiry job completes by 03:00.
Kafka consumer lag remains under 5 minutes.
```

### 32.3 Error Budget

Error budget = allowed failure.

If SLO is 99.9%, error budget is 0.1%.

Use error budget to decide:

- release pace,
- risk acceptance,
- incident severity,
- engineering priority.

Without SLO, alerting becomes subjective.

---

## 33. Alert Design

Alert should be:

- actionable,
- tied to user/business impact,
- not too noisy,
- has runbook,
- severity-classified.

### 33.1 Good Alerts

```text
p95 latency > SLO for 10 minutes
5xx rate > threshold
circuit open for critical dependency
DB pool awaiting > 0 sustained
no successful job run within SLA
message DLQ increasing
readiness failing across multiple pods
error budget burn rate too high
```

### 33.2 Bad Alerts

```text
CPU > 70% once
one request failed
one GC pause
one retry
one cache miss
one 404
```

### 33.3 Multi-Window Burn Rate

For mature systems, use burn-rate alerts:

```text
Fast burn: severe immediate issue.
Slow burn: sustained degradation.
```

Example:

```text
2% errors for 5 minutes may be urgent.
0.2% errors for 6 hours may also matter.
```

---

## 34. Dashboard Design

Dashboards should answer questions.

### 34.1 Service Overview Dashboard

Include:

- request rate,
- error rate,
- duration p50/p95/p99,
- saturation,
- dependency health,
- pod count/restarts,
- readiness,
- JVM/native memory,
- CPU,
- DB pool,
- top errors.

### 34.2 Dependency Dashboard

Per dependency:

- call rate,
- latency,
- error rate,
- timeout,
- retry,
- circuit state,
- bulkhead rejection,
- rate limit,
- fallback used.

### 34.3 Business Operation Dashboard

For domain operations:

- submit count,
- approval count,
- rejection count,
- state transition failures,
- authorization denied,
- job status,
- outbox backlog,
- case SLA breach count.

### 34.4 Anti-Pattern Dashboard

Bad dashboard:

```text
100 panels nobody reads.
No SLO line.
No owner.
No runbook.
No relationship to alerts.
```

Good dashboard:

```text
Can answer: what is broken, who is affected, where is bottleneck, what to do next.
```

---

## 35. Observability Dev Services

Quarkus Observability Dev Services provides local observability backend orchestration.

The LGTM Dev Service uses Grafana OTel-LGTM image, bundling:

- OpenTelemetry Collector,
- Prometheus for metrics,
- Tempo for traces,
- Loki for logs,
- Grafana for visualization.

This is useful for:

- local development,
- demo,
- integration testing,
- training developers to use telemetry,
- validating instrumentation before production.

Do not confuse local LGTM dev stack with production observability architecture.

Production needs:

- retention,
- HA,
- access control,
- storage sizing,
- alerting,
- backup,
- governance,
- cost control.

---

## 36. Observability as Code

Treat observability assets as code:

- dashboard JSON,
- alert rules,
- recording rules,
- SLO definitions,
- log queries,
- runbooks,
- instrumentation conventions.

Store in repository.

Review in PR.

Version with service.

Why?

Because dashboards drift if maintained manually.

A top-tier team ships:

```text
feature + metrics + logs + traces + dashboard + alert + runbook
```

---

## 37. Production Readiness Observability Checklist

### 37.1 Metrics

- [ ] HTTP RED metrics.
- [ ] Dependency RED metrics.
- [ ] JVM/native runtime metrics.
- [ ] DB pool metrics.
- [ ] cache metrics.
- [ ] messaging metrics.
- [ ] job metrics.
- [ ] business operation metrics.
- [ ] bounded labels/cardinality.
- [ ] p95/p99 where relevant.

### 37.2 Tracing

- [ ] OpenTelemetry enabled.
- [ ] service name configured.
- [ ] OTLP exporter configured.
- [ ] trace context propagated.
- [ ] outbound HTTP traced.
- [ ] messaging traced where needed.
- [ ] important domain spans added.
- [ ] sensitive attributes avoided.
- [ ] sampling policy defined.

### 37.3 Health

- [ ] liveness endpoint safe.
- [ ] readiness endpoint meaningful.
- [ ] startup endpoint if needed.
- [ ] probes tuned.
- [ ] optional dependency not breaking readiness.
- [ ] health endpoint does not expose secrets.
- [ ] health checks are fast.

### 37.4 Profiling

- [ ] JVM profiling plan.
- [ ] native profiling plan if native deployment.
- [ ] JFR/async profiler strategy.
- [ ] thread dump procedure.
- [ ] heap dump security policy.
- [ ] load test captures profiles.

### 37.5 Alerting

- [ ] SLO defined.
- [ ] alert tied to user/business impact.
- [ ] severity levels.
- [ ] runbook linked.
- [ ] dashboard linked.
- [ ] noisy alerts removed.
- [ ] burn-rate alerts if mature.

### 37.6 Dashboard

- [ ] service overview.
- [ ] dependency dashboard.
- [ ] business operation dashboard.
- [ ] job/messaging dashboard.
- [ ] SLO lines visible.
- [ ] dashboard owned by team.
- [ ] dashboard versioned as code.

---

## 38. Case Study: Application Submission Latency

Incident:

```text
Users report application submission is slow.
```

### 38.1 Metrics First

Check:

```text
http_server_duration p95/p99 for POST /applications
error rate
request rate
DB pool awaiting
identity-api latency
risk-api latency
GC pause
CPU
```

Suppose:

```text
POST /applications p99 = 8s
identity-api p99 = 7s
DB pool normal
CPU normal
```

Hypothesis:

```text
External identity API is bottleneck.
```

### 38.2 Traces

Inspect slow traces:

```text
POST /applications
  -> validate 20ms
  -> identity-api 7100ms
  -> db insert 50ms
```

### 38.3 Logs

Query:

```text
event=external_call_timeout dependency=identity-api
```

Find:

```text
timeouts increased after 10:15
retry attempts doubled
circuit breaker opened
```

### 38.4 Action

Depending policy:

```text
reduce retry
open circuit faster
use controlled user error
contact dependency owner
disable optional enrichment if identity not mandatory
```

### 38.5 Postmortem

Add:

- better alert on identity-api p95,
- dashboard panel,
- runbook,
- adjust timeout budget,
- test retry storm.

---

## 39. Case Study: Pod Restart Loop

Incident:

```text
Pods restart repeatedly after DB outage.
```

Metrics/logs:

```text
liveness probe failing
DB unavailable
Kubernetes restarts pods
```

Root cause:

```text
Liveness check depended on DB.
```

Fix:

```text
Move DB check to readiness.
Keep liveness process-local.
Tune startup/readiness.
```

Lesson:

```text
Liveness answers "should restart".
Readiness answers "should receive traffic".
```

---

## 40. Case Study: Native Image Memory

Observation:

```text
Native image has lower startup time and lower RSS at idle,
but CPU spikes under load.
```

Needed observability:

- request latency p95/p99,
- CPU per pod,
- RSS,
- GC/native memory behavior,
- external call latency,
- profiling under realistic load,
- compare JVM vs native with same traffic.

Conclusion should be based on workload:

```text
Native is not automatically better for every service.
Measure startup, memory, CPU, throughput, p99, and operability.
```

---

## 41. Common Anti-Patterns

### 41.1 Metrics With High-Cardinality Labels

Kills metrics backend.

### 41.2 No Business Metrics

System looks healthy but business flow broken.

### 41.3 Traces Without Logs Correlation

Trace shows span failed but no detailed event.

### 41.4 Logs Without Trace/Correlation

Logs cannot be connected to request.

### 41.5 Liveness Checks Dependencies

Causes restart storms.

### 41.6 Readiness Too Broad

Optional dependency removes service from traffic.

### 41.7 Dashboard Without SLO

Pretty graphs, no decision.

### 41.8 Alert Without Runbook

Human wakes up but does not know what to do.

### 41.9 Profiling Only After Incident

Need baseline profiles before incident.

### 41.10 Sampling Critical Failures

Missing rare but important evidence.

### 41.11 Treating Dev Observability Stack as Production

Local LGTM is not production HA observability.

### 41.12 No Native Observability Validation

Native artifact behaves differently but dashboard assumed same.

---

## 42. Implementation Blueprint: Business Metrics Service

```java
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class BusinessMetrics {

    private final MeterRegistry registry;

    public BusinessMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    public void applicationSubmitted(String result) {
        registry.counter(
                "application_submission_total",
                "result", result
        ).increment();
    }

    public Timer.Sample startSubmissionTimer() {
        return Timer.start(registry);
    }

    public void stopSubmissionTimer(Timer.Sample sample, String result) {
        sample.stop(registry.timer(
                "application_submission_duration_seconds",
                "result", result
        ));
    }

    public void authorizationDecision(String operation, String decision, String reason) {
        registry.counter(
                "authorization_decision_total",
                "operation", operation,
                "decision", decision,
                "reason", reason
        ).increment();
    }
}
```

Use bounded `reason` taxonomy.

Do not use raw exception/user input as label.

---

## 43. Implementation Blueprint: Traced Domain Operation

```java
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.api.trace.Tracer;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class TracedSubmissionService {

    private final Tracer tracer;
    private final SubmissionService delegate;
    private final BusinessMetrics metrics;

    public TracedSubmissionService(
            Tracer tracer,
            SubmissionService delegate,
            BusinessMetrics metrics
    ) {
        this.tracer = tracer;
        this.delegate = delegate;
        this.metrics = metrics;
    }

    public SubmissionResult submit(SubmitCommand command) {
        Span span = tracer.spanBuilder("application.submit").startSpan();
        var sample = metrics.startSubmissionTimer();

        try (var scope = span.makeCurrent()) {
            span.setAttribute("module", "application-management");
            span.setAttribute("operation", "submit_application");

            SubmissionResult result = delegate.submit(command);

            span.setAttribute("result", "success");
            metrics.applicationSubmitted("success");
            metrics.stopSubmissionTimer(sample, "success");

            return result;
        } catch (BusinessException e) {
            span.setAttribute("result", "business_failure");
            span.setAttribute("error_code", e.code());
            span.setStatus(StatusCode.ERROR);
            metrics.applicationSubmitted("business_failure");
            metrics.stopSubmissionTimer(sample, "business_failure");
            throw e;
        } catch (Exception e) {
            span.recordException(e);
            span.setAttribute("result", "technical_failure");
            span.setStatus(StatusCode.ERROR);
            metrics.applicationSubmitted("technical_failure");
            metrics.stopSubmissionTimer(sample, "technical_failure");
            throw e;
        } finally {
            span.end();
        }
    }
}
```

This is conceptual. In real code, avoid over-wrapping every service manually; use patterns/interceptors carefully.

---

## 44. Implementation Blueprint: Health Checks

```java
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.health.HealthCheck;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.Liveness;
import org.eclipse.microprofile.health.Readiness;

@Liveness
@ApplicationScoped
public class LivenessCheck implements HealthCheck {

    @Override
    public HealthCheckResponse call() {
        return HealthCheckResponse.up("app-live");
    }
}
```

Readiness:

```java
@Readiness
@ApplicationScoped
public class ReadinessCheck implements HealthCheck {

    private final CriticalDependencyChecker checker;

    public ReadinessCheck(CriticalDependencyChecker checker) {
        this.checker = checker;
    }

    @Override
    public HealthCheckResponse call() {
        boolean ready = checker.isReadyFast();

        return HealthCheckResponse.named("critical-dependencies")
                .status(ready)
                .withData("db", checker.databaseStatus())
                .build();
    }
}
```

Guidelines:

```text
isReadyFast() must be fast.
Do not perform heavy queries.
Do not expose sensitive details.
```

---

## 45. Latihan

### Latihan 1 — Design Metrics

Untuk service `Case Management`, desain metrics untuk:

1. create case,
2. assign case,
3. approve case,
4. reject case,
5. escalate overdue case,
6. authorization denied,
7. external identity API,
8. outbox publisher,
9. scheduled escalation job,
10. Kafka consumer.

Untuk tiap metric, tentukan:

- name,
- type,
- labels,
- cardinality risk,
- SLO relevance.

### Latihan 2 — Trace Design

Buat trace structure untuk:

```text
POST /applications/{id}/approve
```

Dengan operasi:

- auth check,
- load application,
- risk verification,
- state transition,
- audit insert,
- outbox insert,
- response.

Tentukan span names dan attributes yang aman.

### Latihan 3 — Probe Review

Evaluasi apakah dependency berikut boleh masuk liveness/readiness/startup:

1. database,
2. Redis cache,
3. email provider,
4. identity provider,
5. Kafka broker,
6. local config loaded,
7. background job last success,
8. disk writable,
9. external reporting API,
10. OpenTelemetry collector.

Jelaskan reasoning.

### Latihan 4 — Alert Design

Buat alert untuk:

1. submit application p95 latency breach,
2. identity API timeout,
3. DB pool saturation,
4. no successful nightly job,
5. Kafka DLQ growth,
6. high authorization denied spike,
7. cache stale served too often,
8. pod readiness flapping.

Untuk tiap alert:

- severity,
- threshold,
- duration,
- dashboard,
- runbook action.

---

## 46. Ringkasan Invariants

Ingat invariants berikut:

```text
Observability is the ability to answer questions about the system.
Metrics show trend and magnitude.
Logs show discrete evidence.
Traces show request path.
Profiles show internal resource cause.
Health checks guide orchestration lifecycle.
Audit trail proves business/security decisions.
Use RED for request paths.
Use USE for resources.
Avoid high-cardinality metric labels.
Do not put PII/secrets in metrics/traces/logs.
Liveness should not depend on external dependencies.
Readiness decides traffic eligibility.
Startup protects slow initialization.
SLO defines what healthy means.
Alerts need runbooks.
Dashboards need ownership.
Native and JVM observability must both be validated.
Dev observability stack is not production observability.
```

---

## 47. Referensi Resmi yang Relevan

Referensi yang perlu dibaca saat implementasi nyata:

- Quarkus Observability guide.
- Quarkus OpenTelemetry guide.
- Quarkus Micrometer Metrics guide.
- Quarkus Micrometer tutorial.
- Quarkus SmallRye Health guide.
- Quarkus Observability Dev Services guide.
- Quarkus Observability Dev Services with Grafana OTel LGTM guide.
- Quarkus Kubernetes deployment guide for probes.
- Quarkus Logging and JSON logging guides.
- Quarkus Native Image reference.

---

## 48. Kapan Seri Ini Lanjut ke Part Berikutnya

Part ini menyelesaikan observability tahap kedua: metrics, tracing, health checks, profiling, SLO, dashboard, dan alerting.

Bagian berikutnya:

```text
Part 026 — Testing I: Unit, Component, QuarkusTest, Profiles, Mocking, Continuous Testing
```

Di part berikutnya, fokus bergeser ke testing engineering:

- test pyramid di Quarkus,
- `@QuarkusTest`,
- `@QuarkusUnitTest`,
- `@QuarkusComponentTest`,
- test profiles,
- CDI mocking,
- config override,
- Dev Services in tests,
- REST Assured,
- deterministic tests,
- continuous testing,
- test speed and isolation,
- avoiding slow/flaky enterprise suites.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-024.md">⬅️ Observability I: Logging, Structured Logs, Correlation, MDC, Audit Trail</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-026.md">Testing I: Unit, Component, QuarkusTest, Profiles, Mocking, Continuous Testing ➡️</a>
</div>

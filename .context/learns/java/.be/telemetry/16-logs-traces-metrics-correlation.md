# Part 16 — Logs + Traces + Metrics Correlation

Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
Scope: Java 8–25, SLF4J, Logback, Log4j2, OpenTelemetry, production observability engineering  
Status: Part 16 of 35

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas tiga fondasi besar:

1. **Logging** sebagai event evidence.
2. **Tracing** sebagai causal execution story.
3. **Metrics** sebagai agregasi numerik perilaku runtime.

Part ini menyatukan semuanya.

Engineer biasa sering melihat logs, traces, dan metrics sebagai tiga dashboard berbeda. Engineer senior melihatnya sebagai tiga bentuk representasi dari satu kenyataan runtime yang sama.

Masalah produksi jarang datang dalam bentuk yang rapi. Biasanya bentuknya seperti ini:

- latency naik, tetapi error rate belum naik;
- error hanya terjadi pada tenant tertentu;
- log menunjukkan timeout, tetapi DB terlihat sehat;
- trace sampling tidak menangkap request yang gagal;
- metrics menunjukkan pool saturation, tetapi thread dump tidak langsung jelas;
- satu request sukses dari sisi HTTP, tetapi business process sebenarnya gagal di async consumer;
- dashboard merah, tetapi root cause ada di deployment/configuration change 20 menit sebelumnya.

Correlation adalah kemampuan untuk berpindah antar-signal tanpa kehilangan identitas, waktu, konteks, dan kausalitas.

Tujuan part ini adalah membuat kita mampu:

1. Mendesain log, trace, dan metric agar saling terhubung.
2. Menentukan ID apa yang harus muncul di mana.
3. Melakukan investigasi dari metric spike ke trace spesifik.
4. Melakukan investigasi dari log error ke trace lengkap.
5. Melakukan investigasi dari trace lambat ke metric resource/dependency.
6. Menghindari anti-pattern observability yang mahal tetapi tidak menjawab root cause.
7. Membuat playbook korelasi untuk Java services di production.

---

## 1. Core Mental Model: Three Views of One Runtime Reality

Anggap satu request masuk ke service Java:

```text
Client
  -> API Gateway
    -> Java Service A
      -> Database
      -> Java Service B
        -> Message Broker
          -> Java Consumer C
```

Dari request yang sama, kita bisa menghasilkan beberapa signal:

```text
METRICS
  http.server.request.duration{route="POST /cases"}
  http.server.request.count{status="500"}
  hikaricp.connections.pending
  jvm.gc.pause
  queue.consumer.lag

TRACES
  trace.id=4bf92f3577b34da6a3ce929d0e0e4736
    span: POST /cases
      span: validate_case_submission
      span: SELECT applicant_profile
      span: POST /screening
      span: publish case.submitted
        span: consume case.submitted

LOGS
  case.submission.started trace.id=... correlation.id=...
  dependency.call.failed trace.id=... span.id=...
  case.state.transition.failed trace.id=... case.id=...
```

Ketiganya menjawab pertanyaan berbeda:

| Signal | Pertanyaan utama | Kekuatan | Kelemahan |
|---|---|---|---|
| Metrics | Seberapa sering, seberapa lambat, seberapa besar, seberapa penuh? | Murah, agregatif, cocok untuk alerting | Tidak memberi detail kejadian individual |
| Traces | Request ini melewati apa saja dan lambat/gagal di mana? | Kausal, lintas-service, timeline jelas | Sampling bisa menyembunyikan kejadian; bisa mahal jika terlalu detail |
| Logs | Event spesifik apa yang terjadi dan dengan konteks apa? | Detail, fleksibel, forensic | Noise tinggi, biaya storage besar, sulit jika tidak structured |

Correlation membuat ketiganya menjadi sistem navigasi:

```text
Metric anomaly
  -> representative trace
    -> relevant logs
      -> runtime resource metrics
        -> root cause hypothesis
```

Atau:

```text
Error log
  -> trace.id
    -> full distributed trace
      -> slow dependency span
        -> DB pool metric / query metric
          -> mitigation
```

---

## 2. Why Correlation Is Hard

Correlation terdengar sederhana: masukkan `trace_id` ke log. Tetapi di sistem nyata, masalahnya lebih luas.

### 2.1 Signal hidup di sistem berbeda

Log mungkin masuk ke Elasticsearch/OpenSearch/Loki/Splunk. Metrics mungkin masuk ke Prometheus/Mimir/CloudWatch. Traces mungkin masuk ke Jaeger/Tempo/Datadog/New Relic/Honeycomb/Elastic APM.

Jika setiap backend punya naming, timestamp, environment, dan service identity berbeda, korelasi menjadi manual.

Contoh buruk:

```json
// log
{
  "service": "case-service",
  "env": "uat",
  "traceId": "abc"
}
```

```text
# metric
http_server_requests_seconds_count{application="case-mgmt", namespace="aceas-uat"}
```

```text
# trace resource
service.name="case-api"
deployment.environment.name="UAT"
```

Tiga nama service berbeda:

```text
case-service
case-mgmt
case-api
```

Saat incident, ini membuang waktu.

### 2.2 Timestamp tidak selalu sejalan

Log timestamp bisa berasal dari application clock. Metrics scrape timestamp bisa berasal dari Prometheus/collector. Trace span timestamp bisa berasal dari SDK. Jika node clock skew, event ordering menjadi menipu.

### 2.3 Context hilang di async boundary

Common failure:

```text
HTTP request has trace.id
  -> CompletableFuture runs on commonPool
    -> MDC lost
      -> logs have no trace.id
```

Atau:

```text
Producer publishes message with trace context
  -> consumer does not extract context
    -> new unrelated trace begins
```

### 2.4 Sampling menghilangkan trace yang diperlukan

Jika head sampling hanya 1%, sebagian besar request tidak punya trace detail. Error log bisa punya `trace.id`, tetapi trace-nya mungkin tidak disimpan.

### 2.5 Cardinality menghancurkan metrics

Korelasi tidak boleh berarti semua ID masuk ke metric label.

Contoh sangat buruk:

```text
http_request_duration_seconds{trace_id="abc", user_id="u123", case_id="c456"}
```

Ini membuat time series meledak.

Rule besar:

```text
IDs boleh masuk logs dan traces.
IDs biasanya tidak boleh masuk metric labels.
```

Kecuali sebagai exemplar atau mekanisme khusus yang memang dirancang untuk menghubungkan metric sample ke trace.

---

## 3. Correlation Vocabulary

Sebelum desain, kita perlu vocabulary yang stabil.

### 3.1 Resource identity

Resource identity menjawab: telemetry ini berasal dari komponen apa?

Field umum:

```text
service.name
service.namespace
service.version
deployment.environment.name
host.name
container.name
k8s.namespace.name
k8s.pod.name
k8s.container.name
cloud.provider
cloud.region
```

Resource identity harus konsisten di logs, traces, dan metrics.

Contoh:

```text
service.name=case-service
service.namespace=aceas
deployment.environment.name=uat
service.version=2026.06.18-rc1
```

### 3.2 Trace identity

Trace identity menjawab: event ini bagian dari distributed execution mana?

Field:

```text
trace.id
span.id
trace.flags
```

Untuk log correlation minimal:

```json
{
  "trace.id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span.id": "00f067aa0ba902b7"
}
```

### 3.3 Business correlation identity

Trace ID biasanya hidup pada satu distributed execution. Tetapi business flow bisa lebih panjang dari satu request.

Field:

```text
correlation.id
case.id
application.id
workflow.instance.id
job.execution.id
message.id
idempotency.key
```

Contoh:

```text
correlation.id = user-visible/business flow correlation
trace.id       = technical distributed trace
case.id        = domain entity being affected
```

Jangan memaksa semua kebutuhan korelasi memakai `trace.id`.

### 3.4 Actor identity

Actor identity menjawab: siapa/apa yang memicu action?

Field:

```text
user.id
user.type
actor.id
actor.type
client.id
service.account.id
```

Perlu redaction/privacy policy. Jangan log nama lengkap, email, NRIC/NIK/passport, token, atau claim sensitif kecuali sangat perlu dan sudah disetujui governance.

### 3.5 Causal identity

Causal identity menjawab: event ini disebabkan oleh event mana?

Field:

```text
event.id
causation.id
parent.event.id
message.id
source.message.id
```

Ini sangat berguna untuk async workflow.

---

## 4. Minimum Correlation Contract

Aplikasi Java production-grade sebaiknya punya kontrak minimal seperti ini.

### 4.1 Required in every log event

```json
{
  "@timestamp": "2026-06-18T12:00:00.123Z",
  "severity": "INFO",
  "service.name": "case-service",
  "service.version": "2026.06.18-rc1",
  "deployment.environment.name": "uat",
  "logger.name": "com.example.case.SubmissionService",
  "thread.name": "http-nio-8080-exec-4",
  "event.name": "case.submission.accepted",
  "message": "Case submission accepted",
  "trace.id": "...",
  "span.id": "...",
  "correlation.id": "..."
}
```

### 4.2 Required in every trace resource/span

Resource:

```text
service.name
service.version
deployment.environment.name
service.namespace
```

Span:

```text
span.name
span.kind
span.status
error.type when error
http.route / db.system / messaging.system when applicable
```

Custom domain attributes only when useful:

```text
case.module
case.operation
workflow.name
job.name
```

Avoid high-cardinality attributes unless needed for investigation and allowed by retention/cost policy.

### 4.3 Required in metrics

Metric labels should identify aggregation dimensions, not individual executions.

Good:

```text
http.server.request.duration{
  service.name="case-service",
  deployment.environment.name="uat",
  http.route="/cases/{caseId}/submit",
  http.request.method="POST",
  http.response.status_code="500"
}
```

Bad:

```text
http.server.request.duration{
  trace.id="...",
  user.id="...",
  case.id="..."
}
```

### 4.4 Allowed correlation patterns

| Need | Use |
|---|---|
| Log to trace | `trace.id`, `span.id` in logs |
| Trace to logs | backend query by `trace.id` |
| Metric to trace | exemplars, trace-aware backend, selected trace IDs |
| Trace to metric | resource attributes + span attributes + time window |
| Business journey | `correlation.id`, `case.id`, `workflow.instance.id` in logs/traces |
| Async causality | `message.id`, `causation.id`, span links |
| Audit review | audit event ID + actor + target + outcome + reason |

---

## 5. Logs to Traces Correlation

### 5.1 Goal

Saat menemukan log error:

```json
{
  "event.name": "dependency.call.failed",
  "message": "Screening API call failed",
  "trace.id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span.id": "00f067aa0ba902b7",
  "external.system": "screening-engine",
  "error.type": "java.net.SocketTimeoutException"
}
```

Kita ingin bisa membuka trace yang sama dan melihat:

```text
POST /cases/{id}/submit
  validate_request                         12 ms
  load_profile                             30 ms
  call_screening_engine                  5000 ms ERROR
  persist_failure_state                    40 ms
```

Log memberi detail event. Trace memberi timeline dan causal path.

### 5.2 Required mechanism

Untuk logs -> traces, log event harus mengandung:

```text
trace.id
span.id
```

Di Java, sumber trace context biasanya OpenTelemetry current `Context`.

Framework logging bisa mendapatkan trace ID melalui:

1. OpenTelemetry Java agent log correlation.
2. Manual MDC enrichment.
3. Logging bridge/exporter.
4. Custom appender/layout integration.

### 5.3 MDC enrichment pattern

Untuk aplikasi berbasis servlet/Spring MVC:

```java
public final class CorrelationLoggingFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {

        Span span = Span.current();
        SpanContext spanContext = span.getSpanContext();

        try {
            if (spanContext.isValid()) {
                MDC.put("trace.id", spanContext.getTraceId());
                MDC.put("span.id", spanContext.getSpanId());
            }

            HttpServletRequest http = (HttpServletRequest) request;
            String correlationId = getOrCreateCorrelationId(http);
            MDC.put("correlation.id", correlationId);

            chain.doFilter(request, response);
        } finally {
            MDC.remove("trace.id");
            MDC.remove("span.id");
            MDC.remove("correlation.id");
        }
    }

    private String getOrCreateCorrelationId(HttpServletRequest request) {
        String incoming = request.getHeader("X-Correlation-Id");
        if (incoming != null && incoming.matches("[A-Za-z0-9._:-]{8,128}")) {
            return incoming;
        }
        return UUID.randomUUID().toString();
    }
}
```

Important nuance:

```text
MDC is logging context.
OpenTelemetry Context is tracing context.
They are related, but not the same object.
```

### 5.4 Logback pattern

Human-readable local pattern:

```xml
<pattern>%d{ISO8601} %-5level [%thread] trace=%X{trace.id} span=%X{span.id} corr=%X{correlation.id} %logger - %msg%n%ex</pattern>
```

JSON production pattern should emit fields, not embed them inside message.

Example with logstash-logback-encoder style:

```xml
<encoder class="net.logstash.logback.encoder.LoggingEventCompositeJsonEncoder">
  <providers>
    <timestamp/>
    <logLevel/>
    <loggerName/>
    <threadName/>
    <mdc/>
    <message/>
    <stackTrace/>
  </providers>
</encoder>
```

### 5.5 Log4j2 pattern

```xml
<JsonTemplateLayout eventTemplateUri="classpath:LogstashJsonEventLayoutV1.json"/>
```

Or explicit ThreadContext fields depending on your template.

```java
ThreadContext.put("trace.id", spanContext.getTraceId());
ThreadContext.put("span.id", spanContext.getSpanId());
```

### 5.6 Common failure modes

#### Missing trace ID in logs

Likely causes:

1. Log happens outside active span.
2. MDC is not populated.
3. Async boundary lost context.
4. Logging layout does not include MDC/ThreadContext field.
5. OTel agent log correlation disabled or unsupported in current setup.
6. Different logging backend than expected.

#### Wrong trace ID in logs

Likely causes:

1. MDC not cleared in thread pool.
2. Request context reused accidentally.
3. Async task inherited stale MDC.
4. Manual context propagation copied old context.

#### Logs have trace ID but backend cannot link

Likely causes:

1. Field name mismatch: `traceId` vs `trace.id` vs `trace_id`.
2. Backend expects hexadecimal trace ID format.
3. Trace was sampled out.
4. Logs and traces have different `service.name`/environment.
5. Time range mismatch.

---

## 6. Traces to Logs Correlation

### 6.1 Goal

Saat membuka trace lambat, kita ingin melihat log event relevan pada trace tersebut.

Example trace:

```text
Trace 4bf92f...

POST /cases/{id}/submit                    6200 ms
  validate_case_submission                   80 ms
  load_case_profile                         120 ms
  call_screening_engine                    5000 ms
  persist_submission_result                 300 ms
```

Pertanyaan berikutnya:

```text
Apa input domain-nya?
Apa rule decision-nya?
Retry terjadi berapa kali?
Error detail-nya apa?
Apakah ada state transition yang gagal?
```

Trace tidak selalu cocok untuk semua detail. Logs mengisi gap.

### 6.2 Query pattern

Query logs by trace ID:

```text
trace.id = "4bf92f3577b34da6a3ce929d0e0e4736"
```

Sort by timestamp ascending.

Expected result:

```text
12:00:00.100 case.submission.started
12:00:00.180 case.validation.completed
12:00:00.310 dependency.call.started external.system=screening-engine
12:00:05.312 dependency.call.timeout external.system=screening-engine
12:00:05.315 retry.scheduled attempt=2
12:00:06.000 case.submission.failed reason=SCREENING_TIMEOUT
```

### 6.3 Span event vs log event

A subtle design decision: should you put something as a span event or a log?

Use span event when:

- it is tightly tied to a span lifecycle;
- it helps explain timing or state inside that span;
- it is useful only when looking at a trace;
- it has limited volume.

Use log event when:

- it is operationally important even without trace;
- it may be queried independently;
- it has audit/security/business diagnostic value;
- it needs retention different from traces;
- it may be produced even when trace sampling drops the trace.

Often use both, but not with identical payload.

Bad duplication:

```text
log: "Screening timeout"
span event: "Screening timeout"
```

Better:

```text
span event:
  name=retry.scheduled
  attributes:
    retry.attempt=2
    retry.delay.ms=750

log event:
  event.name=dependency.call.failed
  external.system=screening-engine
  timeout.ms=5000
  error.type=java.net.SocketTimeoutException
  business.operation=case.submit
```

---

## 7. Metrics to Traces Correlation

### 7.1 Goal

Saat dashboard menunjukkan latency spike:

```text
p95 http.server.request.duration for POST /cases/{id}/submit increased from 300 ms to 5 s
```

Kita ingin membuka contoh trace yang mewakili spike tersebut.

### 7.2 Why metrics alone are insufficient

Metric bisa berkata:

```text
p95 latency = 5s
```

Tapi metric tidak otomatis menjawab:

```text
Request mana yang lambat?
Tenant mana?
Dependency mana?
Code path mana?
Apakah lambat karena DB, HTTP dependency, lock, GC, CPU, thread pool, atau queue?
```

### 7.3 Exemplar concept

Exemplar adalah contoh pengukuran individual yang menempel pada metric sample dan biasanya membawa trace ID. Dengan exemplar, chart latency dapat menunjuk ke trace spesifik.

Conceptual example:

```text
http.server.request.duration_bucket{route="/cases/{id}/submit", le="5"} 42
  exemplar: trace_id="4bf92f3577b34da6a3ce929d0e0e4736" value=4.8 timestamp=...
```

Flow:

```text
Metric spike
  -> click exemplar
    -> open trace
      -> inspect slow span
        -> query logs by trace.id
```

### 7.4 When exemplars are useful

Exemplars are especially useful for:

1. High latency outliers.
2. Error spikes.
3. Rare slow dependency calls.
4. Tenant-specific performance investigation.
5. Connecting SLO burn to real request examples.

### 7.5 When exemplars are not enough

Exemplars are samples. They do not replace:

- full metrics aggregation;
- trace sampling strategy;
- logs for forensic detail;
- profiles for CPU/allocation root cause;
- thread dumps for blocking/pool exhaustion;
- JFR for JVM-level diagnosis.

### 7.6 Avoid trace ID as metric label

Wrong:

```text
http.server.duration{trace_id="abc"}
```

Correct:

```text
http.server.duration{route="/cases/{id}/submit", method="POST", status="500"}
  exemplar trace_id="abc"
```

The difference is critical:

```text
Metric label = aggregation dimension.
Exemplar = reference to individual example.
```

---

## 8. Traces to Metrics Correlation

### 8.1 Goal

Saat melihat trace lambat:

```text
call_database_search took 4.8s
```

Kita ingin tahu apakah ini:

1. Satu request aneh.
2. Semua request ke route ini lambat.
3. Semua query database lambat.
4. Hanya pod tertentu lambat.
5. Terjadi bersamaan dengan GC.
6. Terjadi bersamaan dengan DB pool pending.
7. Terjadi bersamaan dengan CPU throttling.

Trace memberi contoh individual. Metrics memberi konteks populasi.

### 8.2 Trace-to-metric investigation pattern

From trace, extract:

```text
service.name
service.version
deployment.environment.name
http.route
http.method
http.status_code
db.system
db.operation
server.address
pod/container/node if available
time window
```

Then query metrics around that time window:

```text
HTTP latency by route
HTTP error rate by route
DB pool active/pending/timeout
DB query duration by operation/fingerprint
JVM GC pause
JVM heap after GC
CPU usage/throttling
Thread count
Queue lag
External dependency duration/error
```

### 8.3 Time-window discipline

Always anchor queries around the trace time.

Bad:

```text
Look at today's dashboard.
```

Better:

```text
Trace started 2026-06-18T12:00:00Z.
Inspect metrics from 11:55 to 12:10.
Compare with 11:30 to 11:45 healthy baseline.
```

### 8.4 Service instance correlation

If trace resource includes pod/host/container identity, you can ask:

```text
Was only this pod unhealthy?
```

Useful metrics:

```text
process.cpu.usage
container.cpu.usage
container.cpu.throttling
jvm.memory.used
jvm.gc.pause
jvm.thread.count
http.server.active_requests
```

If only one pod shows problem, suspect:

- noisy neighbor;
- bad deployment on one replica;
- memory leak local to instance;
- stuck thread pool;
- bad connection pool state;
- node-level issue;
- DNS/cache/socket issue.

If all pods show problem, suspect:

- dependency outage;
- traffic spike;
- config rollout;
- database saturation;
- shared cache/broker issue;
- upstream behavior change.

---

## 9. Correlation in Java HTTP Services

### 9.1 Inbound HTTP

For an inbound request, desired correlation flow:

```text
Incoming headers:
  traceparent
  tracestate
  baggage
  X-Correlation-Id
  Idempotency-Key

Application context:
  trace.id
  span.id
  correlation.id
  request.id
  idempotency.key

Logs:
  include trace.id, span.id, correlation.id, event.name, outcome

Metrics:
  route/method/status/duration, no request-specific IDs

Trace:
  server span with route/method/status and domain span children
```

### 9.2 Inbound filter pattern

```java
public final class RuntimeIdentityFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        String correlationId = sanitizeOrGenerate(request.getHeader("X-Correlation-Id"));
        String requestId = UUID.randomUUID().toString();
        String idempotencyKey = sanitizeNullable(request.getHeader("Idempotency-Key"));

        long startNanos = System.nanoTime();
        try {
            MDC.put("correlation.id", correlationId);
            MDC.put("request.id", requestId);
            if (idempotencyKey != null) {
                MDC.put("idempotency.key", idempotencyKey);
            }

            response.setHeader("X-Correlation-Id", correlationId);
            response.setHeader("X-Request-Id", requestId);

            log.info("request.accepted method={} path={}", request.getMethod(), request.getRequestURI());
            chain.doFilter(req, res);
        } finally {
            long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);
            log.info("request.completed method={} path={} status={} duration.ms={}",
                    request.getMethod(),
                    request.getRequestURI(),
                    response.getStatus(),
                    durationMs);
            MDC.clear();
        }
    }

    private String sanitizeOrGenerate(String value) {
        if (value != null && value.matches("[A-Za-z0-9._:-]{8,128}")) {
            return value;
        }
        return UUID.randomUUID().toString();
    }

    private String sanitizeNullable(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        if (!value.matches("[A-Za-z0-9._:-]{8,128}")) {
            return null;
        }
        return value;
    }
}
```

### 9.3 Outbound HTTP

Outbound call should propagate:

```text
traceparent/tracestate via OpenTelemetry instrumentation
X-Correlation-Id manually or via client interceptor
Idempotency-Key only when semantically relevant
```

Example with Java 11+ `HttpClient` wrapper:

```java
public HttpRequest withCorrelationHeaders(HttpRequest original) {
    HttpRequest.Builder builder = HttpRequest.newBuilder(original.uri())
            .method(original.method(), original.bodyPublisher().orElse(HttpRequest.BodyPublishers.noBody()));

    MDC.getCopyOfContextMap().forEach((key, value) -> {
        if ("correlation.id".equals(key)) {
            builder.header("X-Correlation-Id", value);
        }
    });

    return builder.build();
}
```

In practice, prefer client interceptors for OkHttp, Apache HttpClient, WebClient, RestTemplate, or Feign, depending on stack.

---

## 10. Correlation in Messaging and Async Workflows

HTTP correlation is linear. Messaging correlation is graph-shaped.

### 10.1 Producer side

When publishing a message:

```text
Current trace context
  -> injected into message headers
Business correlation ID
  -> message header
Message ID
  -> generated by broker or app
Causation ID
  -> previous event ID or command ID
```

Message headers example:

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
X-Correlation-Id: corr-20260618-abc
X-Message-Id: msg-001
X-Causation-Id: event-previous-999
```

Producer log:

```json
{
  "event.name": "message.publish.succeeded",
  "messaging.system": "rabbitmq",
  "messaging.destination.name": "case.submitted",
  "message.id": "msg-001",
  "correlation.id": "corr-20260618-abc",
  "trace.id": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

### 10.2 Consumer side

Consumer must extract trace context.

```text
Message headers
  -> extract trace context
    -> start CONSUMER span
      -> set MDC from span context and message headers
        -> process message
          -> publish next event with propagated context
```

Consumer log:

```json
{
  "event.name": "message.consume.started",
  "message.id": "msg-001",
  "correlation.id": "corr-20260618-abc",
  "trace.id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "consumer.group": "case-workflow-consumer"
}
```

### 10.3 Span links for async causality

In async systems, parent-child span relation can be misleading if processing happens much later or fan-in/fan-out occurs.

Use span links conceptually when:

- one consumer span is caused by one or more producer spans;
- batch job processes many messages;
- workflow continues after a long delay;
- event replay processes old events;
- fan-in combines multiple upstream events.

Example mental model:

```text
Trace A: request creates command
Trace B: scheduled processor handles command later
  Span B links to Span A context
```

Do not force everything into one giant trace if the business process lasts hours/days.

Use:

```text
trace.id for technical execution
correlation.id/workflow.instance.id for long-lived business journey
span links for causal relationship between executions
```

---

## 11. Correlation in Batch and Scheduler Jobs

Batch jobs often have no incoming HTTP trace. You must create runtime identity explicitly.

### 11.1 Required IDs

```text
job.name
job.execution.id
job.trigger.type
job.scheduled.time
job.actual.start.time
chunk.id
record.count
success.count
failure.count
correlation.id optional if job belongs to business flow
```

### 11.2 Trace design

```text
Span: batch job execution
  Span: load input partition 1
  Span: process chunk 1
  Span: write output chunk 1
  Span: process chunk 2
```

Do not create one span per row for millions of rows.

Use logs for sample failures:

```json
{
  "event.name": "batch.record.failed",
  "job.name": "case-expiry-reminder",
  "job.execution.id": "job-20260618-0001",
  "chunk.id": "chunk-0042",
  "record.index": 9812,
  "error.type": "ValidationException",
  "error.code": "INVALID_EMAIL"
}
```

Use metrics for aggregation:

```text
batch.records.processed{job.name="case-expiry-reminder", outcome="success"}
batch.records.processed{job.name="case-expiry-reminder", outcome="failure"}
batch.execution.duration{job.name="case-expiry-reminder"}
```

Do not use record ID as metric label.

---

## 12. Correlation in State Machines and Regulatory Workflows

In complex case management/regulatory systems, runtime correlation is not just technical. It supports auditability and defensibility.

### 12.1 Important IDs

```text
case.id
application.id
workflow.instance.id
state.transition.id
actor.id
actor.type
reason.code
decision.code
correlation.id
trace.id
```

### 12.2 Example state transition evidence

```json
{
  "event.name": "case.state.transition.completed",
  "case.id": "CASE-2026-000123",
  "workflow.instance.id": "WF-2026-7788",
  "state.previous": "PENDING_REVIEW",
  "state.next": "APPROVED",
  "actor.type": "officer",
  "actor.id.hash": "sha256:...",
  "reason.code": "REVIEW_COMPLETED",
  "correlation.id": "corr-abc",
  "trace.id": "4bf92f...",
  "outcome": "success"
}
```

### 12.3 Trace vs audit log

Do not rely on trace retention for audit evidence.

Trace:

```text
Good for technical diagnosis.
Retention often shorter.
May be sampled.
May omit sensitive business context.
```

Audit log:

```text
Good for accountability and defensibility.
Must not be sampled.
Retention usually longer.
Must have stricter integrity/access controls.
```

But they should still correlate:

```text
audit.event.id
trace.id
correlation.id
case.id
```

---

## 13. Correlation Anti-Patterns

### 13.1 Dashboard-first observability

Bad pattern:

```text
Create dashboard first.
Add random logs later.
Hope incident can be solved.
```

Better:

```text
Define production questions.
Define signal contract.
Implement logs/traces/metrics.
Validate during load/failure testing.
```

### 13.2 Trace ID everywhere, semantics nowhere

Bad:

```json
{
  "trace.id": "abc",
  "message": "failed"
}
```

Trace ID alone does not explain domain, dependency, actor, or outcome.

Better:

```json
{
  "trace.id": "abc",
  "event.name": "dependency.call.failed",
  "external.system": "screening-engine",
  "operation.name": "screenApplicant",
  "outcome": "failure",
  "error.type": "SocketTimeoutException",
  "timeout.ms": 5000,
  "retry.attempt": 2
}
```

### 13.3 Metric labels with IDs

Bad:

```text
case_transition_total{case_id="CASE-123", user_id="U-9"}
```

Better:

```text
case_transition_total{module="licensing", from_state="pending_review", to_state="approved", outcome="success"}
```

Keep case/user IDs in logs/traces if needed, with privacy controls.

### 13.4 Sampling without error strategy

Bad:

```text
Sample 1% of all traces uniformly.
```

This may drop rare errors.

Better:

```text
Head sample normal traffic.
Always keep error traces if possible.
Use tail sampling in collector for latency/error policies where platform supports it.
Ensure logs remain available even when traces are sampled out.
```

### 13.5 Duplicated but inconsistent fields

Bad:

```text
MDC key: traceId
JSON field: trace_id
OTel field: trace.id
Backend index: traceID
```

Pick a standard and map deliberately.

### 13.6 Putting business secrets in baggage

Baggage can propagate across service boundaries. Do not put sensitive data there.

Bad:

```text
baggage: nric=S1234567A,email=user@example.com,token=...
```

Better:

```text
baggage: tenant.tier=gold,workflow.type=renewal
```

Even this should be governed.

---

## 14. Cross-Signal Investigation Patterns

This section is the operational heart of Part 16.

### 14.1 Pattern A: Metric anomaly -> trace -> logs

Symptom:

```text
p95 latency for POST /cases/{id}/submit increased to 5 seconds.
```

Steps:

1. Identify route, service, environment, and time window.
2. Check if latency is global or isolated by pod/version/zone/tenant-safe dimension.
3. Open exemplar/slow trace if available.
4. Inspect slowest span.
5. Query logs by `trace.id`.
6. Check dependency and JVM metrics around same time.
7. Form hypothesis.
8. Validate with more traces/logs/metrics.

Decision tree:

```text
Slow span is DB?
  -> check DB pool pending, active, timeout, query duration, DB CPU/locks

Slow span is external HTTP?
  -> check dependency duration/error, retry count, timeout, circuit breaker

Slow span is internal business method?
  -> check CPU profile, allocation profile, lock/thread dump, JFR

No slow child span but root span slow?
  -> missing instrumentation, thread starvation, queue wait, servlet container wait
```

### 14.2 Pattern B: Error log -> trace -> population metric

Symptom:

```json
{"event.name":"case.submission.failed","error.code":"SCREENING_TIMEOUT","trace.id":"abc"}
```

Steps:

1. Open trace by `trace.id`.
2. Confirm failing span and error type.
3. Query logs by `correlation.id` for broader business flow.
4. Query metrics for error rate by route/dependency.
5. Determine blast radius:
   - one request?
   - one user?
   - one tenant?
   - one pod?
   - all traffic?
6. Check recent deployments/config changes.

### 14.3 Pattern C: Trace shows dependency slow -> metric confirms saturation

Trace:

```text
HikariCP getConnection took 3000 ms
```

Metrics to check:

```text
hikaricp.connections.active
hikaricp.connections.idle
hikaricp.connections.pending
hikaricp.connections.timeout
jdbc.query.duration
http.server.active_requests
jvm.thread.count
```

Possible root causes:

1. DB slow causing connections held longer.
2. App thread pool increased, DB pool unchanged.
3. Connection leak.
4. Long transaction.
5. N+1 query pattern.
6. Lock wait/deadlock.
7. Downstream backpressure causing transaction to remain open.

### 14.4 Pattern D: Metrics show high CPU -> profile -> logs/traces

Metrics:

```text
process.cpu.usage high
http latency high
GC normal
```

Next:

1. Capture CPU profile / JFR.
2. Identify hot methods.
3. Correlate time window with traces/routes.
4. Query logs for route/event frequency.
5. Determine if CPU is caused by traffic, specific input, retry storm, serialization, regex, crypto, compression, JSON/XML mapping, logging overhead.

### 14.5 Pattern E: Queue lag -> consumer trace/logs -> dependency metrics

Metrics:

```text
messaging.consumer.lag increasing
message.processing.duration p95 high
```

Next:

1. Inspect consumer traces.
2. Query logs by `job.execution.id`, `message.id`, or `correlation.id`.
3. Check consumer error/retry/dead-letter metrics.
4. Check external dependency called by consumer.
5. Check consumer concurrency/thread pool.
6. Check poison message patterns.

---

## 15. Java Implementation Blueprint

### 15.1 Common context object

Even with MDC and OTel Context, keep domain runtime identity explicit at application boundary.

```java
public record RuntimeIdentity(
        String correlationId,
        String requestId,
        String idempotencyKey,
        String caseId,
        String workflowInstanceId
) {
    public Map<String, String> toMdcMap() {
        Map<String, String> values = new LinkedHashMap<>();
        put(values, "correlation.id", correlationId);
        put(values, "request.id", requestId);
        put(values, "idempotency.key", idempotencyKey);
        put(values, "case.id", caseId);
        put(values, "workflow.instance.id", workflowInstanceId);
        return values;
    }

    private static void put(Map<String, String> map, String key, String value) {
        if (value != null && !value.isBlank()) {
            map.put(key, value);
        }
    }
}
```

### 15.2 Scoped MDC helper

```java
public final class MdcScope implements AutoCloseable {
    private final Map<String, String> previous;

    private MdcScope(Map<String, String> next) {
        this.previous = MDC.getCopyOfContextMap();
        MDC.clear();
        if (next != null) {
            next.forEach(MDC::put);
        }
    }

    public static MdcScope with(Map<String, String> values) {
        return new MdcScope(values);
    }

    @Override
    public void close() {
        MDC.clear();
        if (previous != null) {
            previous.forEach(MDC::put);
        }
    }
}
```

Usage:

```java
try (MdcScope ignored = MdcScope.with(identity.toMdcMap())) {
    log.info("case.submission.started case.id={}", identity.caseId());
    submissionService.submit(command);
}
```

### 15.3 OTel span helper

```java
public final class TracingSupport {
    private final Tracer tracer;

    public TracingSupport(OpenTelemetry openTelemetry) {
        this.tracer = openTelemetry.getTracer("case-service-manual");
    }

    public <T> T inSpan(String spanName, Map<String, String> attributes, Supplier<T> action) {
        Span span = tracer.spanBuilder(spanName).startSpan();
        try (Scope scope = span.makeCurrent()) {
            attributes.forEach(span::setAttribute);
            return action.get();
        } catch (RuntimeException ex) {
            span.recordException(ex);
            span.setStatus(StatusCode.ERROR, ex.getClass().getSimpleName());
            throw ex;
        } finally {
            span.end();
        }
    }
}
```

### 15.4 Metrics helper principle

Do not pass identity IDs as labels.

Bad:

```java
Counter.builder("case.submission.total")
        .tag("case.id", caseId)
        .register(registry)
        .increment();
```

Good:

```java
Counter.builder("case.submission.total")
        .tag("module", "licensing")
        .tag("outcome", "success")
        .register(registry)
        .increment();
```

If you need to diagnose a specific case ID, use logs/traces.

---

## 16. Sampling and Retention Strategy

Correlation fails when retention/sampling policies conflict.

### 16.1 Logs retention

Typical pattern:

```text
DEBUG logs: local/dev only or short retention
INFO application logs: moderate retention
WARN/ERROR logs: longer retention
security/audit logs: longest retention, stricter access
```

### 16.2 Trace retention

Traces may be sampled and retained for shorter windows.

Strategy:

```text
Keep enough traces for performance debugging.
Prefer keeping error and high-latency traces.
Use tail sampling where available to decide after outcome/duration is known.
```

### 16.3 Metrics retention

Metrics are often retained longer than traces because aggregated data is smaller.

Strategy:

```text
High-resolution metrics: short retention
Downsampled metrics: longer retention
SLO metrics: longest operational retention
```

### 16.4 Audit retention

Audit is not observability retention. It has a different purpose.

Do not sample audit logs.

---

## 17. Designing Correlation Queries

Good observability design starts from the questions.

### 17.1 Incident questions

For every critical service, you should be able to answer:

```text
Which route is failing?
Which dependency is slow?
Which version introduced the issue?
Which pods are affected?
Which tenants/modules are affected?
Which workflow states are stuck?
Which job execution failed?
Which messages are being retried?
Which traces represent the worst p99 cases?
Which logs explain the failing trace?
```

### 17.2 Query templates

#### Find logs for a trace

```text
trace.id = "<trace-id>"
```

#### Find logs for a business flow

```text
correlation.id = "<correlation-id>"
```

#### Find failed state transitions

```text
event.name = "case.state.transition.failed"
and workflow.name = "licensing-application"
and @timestamp between T1 and T2
```

#### Find dependency timeout logs

```text
event.name = "dependency.call.failed"
and external.system = "screening-engine"
and error.type contains "Timeout"
```

#### Find metric blast radius

```text
rate(http.server.request.count{service.name="case-service", status_code=~"5.."}[5m])
```

#### Find high-latency route

```text
histogram_quantile(0.95, sum by (le, http_route) (rate(http_server_request_duration_bucket[5m])))
```

Exact query syntax depends on backend, but the thinking pattern is stable.

---

## 18. Validation: How to Know Correlation Works

Do not wait for production incident.

### 18.1 Local validation

Run one request and verify:

```text
One HTTP request creates one trace.
All logs inside request contain trace.id/span.id/correlation.id.
Metrics increment route count/duration without request-specific IDs.
Outbound HTTP propagates trace context.
```

### 18.2 Async validation

Publish one message and verify:

```text
Producer log has message.id/correlation.id/trace.id.
Consumer trace is linked or continued correctly.
Consumer logs have message.id/correlation.id/trace.id.
Queue metrics reflect publish/consume.
```

### 18.3 Failure validation

Inject failures:

```text
Dependency timeout
DB pool exhaustion
Validation failure
Authorization failure
Consumer retry
Dead-letter message
```

For each failure, verify:

```text
Alert metric fires.
Trace identifies failing boundary.
Logs explain event context.
Error code is stable.
No sensitive data leaked.
```

### 18.4 Load validation

Under load:

```text
Logging does not dominate CPU.
Metrics cardinality remains bounded.
Trace sampling cost is acceptable.
MDC does not leak between requests.
Async logging queue does not silently drop critical logs.
```

---

## 19. Production Readiness Checklist

### 19.1 Identity consistency

- [ ] `service.name` is identical across logs, metrics, traces.
- [ ] `deployment.environment.name` is identical across signals.
- [ ] `service.version` is present.
- [ ] Kubernetes/container metadata is attached consistently.
- [ ] `trace.id` and `span.id` appear in logs when active span exists.
- [ ] `correlation.id` exists for inbound request and async flows.
- [ ] Business IDs are logged only when allowed and protected.

### 19.2 Logs

- [ ] Logs are structured JSON in production.
- [ ] Logs contain `event.name`, `outcome`, and relevant context.
- [ ] Stack traces are logged once at ownership boundary.
- [ ] Sensitive fields are redacted/masked.
- [ ] Log level semantics are enforced.
- [ ] MDC cleanup is guaranteed.

### 19.3 Traces

- [ ] Auto-instrumentation covers inbound/outbound HTTP, JDBC, messaging where applicable.
- [ ] Manual spans cover business-critical operations.
- [ ] Span names are low-cardinality.
- [ ] Span attributes follow semantic conventions where possible.
- [ ] Exceptions are recorded on relevant spans.
- [ ] Sampling policy preserves useful error/latency traces.

### 19.4 Metrics

- [ ] RED metrics exist for services/routes.
- [ ] USE metrics exist for critical resources.
- [ ] JVM metrics exist.
- [ ] DB pool metrics exist.
- [ ] Messaging lag/processing metrics exist.
- [ ] Metrics labels avoid high-cardinality IDs.
- [ ] SLO/alerting metrics are clearly defined.

### 19.5 Cross-signal

- [ ] Logs can be queried by `trace.id`.
- [ ] Traces can link to logs.
- [ ] Metrics can link to traces via exemplars or backend support.
- [ ] Dashboards include service/version/environment filters.
- [ ] Incident playbooks include cross-signal navigation steps.
- [ ] Correlation has been tested under async and failure scenarios.

---

## 20. Mini Case Study: Latency Spike in Case Submission

### 20.1 Symptom

Alert:

```text
p95 latency for POST /cases/{id}/submit > 5s for 10 minutes
```

### 20.2 Metrics view

```text
http.server.duration p95 high
http.server.error.rate slightly high
hikaricp.connections.pending high
jvm.gc.pause normal
cpu usage normal
```

Initial inference:

```text
Not likely CPU or GC.
Likely waiting on DB connections or long DB calls.
```

### 20.3 Trace view

Representative trace:

```text
POST /cases/{id}/submit                  6100 ms
  validate_payload                         20 ms
  load_user_profile                       120 ms
  evaluate_eligibility_rules              300 ms
  acquire_db_connection                  3000 ms
  update_case_state                      2500 ms
```

Inference:

```text
Connection acquisition is slow and DB update is slow.
Need determine if pool is too small, query is blocked, or transaction holds connection too long.
```

### 20.4 Logs by trace ID

```json
{
  "event.name": "case.state.transition.started",
  "case.id": "CASE-2026-001",
  "state.previous": "DRAFT",
  "state.next": "SUBMITTED",
  "trace.id": "abc"
}
```

```json
{
  "event.name": "dependency.db.connection.acquire.slow",
  "duration.ms": 3021,
  "pool.active": 50,
  "pool.pending": 17,
  "trace.id": "abc"
}
```

```json
{
  "event.name": "case.state.transition.completed",
  "duration.ms": 2500,
  "trace.id": "abc"
}
```

### 20.5 Wider metrics

```text
hikaricp.connections.active = max
hikaricp.connections.pending rising
jdbc.update.duration p95 rising
db.lock.wait metric rising
```

### 20.6 Hypothesis

```text
DB lock contention causes transactions to hold connections longer.
Connection pool becomes saturated.
Request latency increases due to waiting for connection.
```

### 20.7 Additional evidence

Query logs for state transition route:

```text
event.name="case.state.transition.started"
state.next="SUBMITTED"
```

Finds increased retries from duplicate submit attempts.

Trace shows duplicate requests with same idempotency key missing.

### 20.8 Root cause candidate

```text
Recent frontend change allowed double submission.
Backend idempotency protection was incomplete for this route.
Duplicate submissions caused competing state updates and DB lock wait.
Lock wait increased transaction duration.
Long transactions saturated DB pool.
```

### 20.9 Mitigation

```text
Enable frontend submit button guard.
Add backend idempotency lock/check.
Reduce transaction scope.
Add DB index/lock ordering review if needed.
Temporarily increase pool only if DB can handle it.
```

### 20.10 Observability improvement

Add:

```text
idempotency.key presence metric by route/outcome
case.duplicate_submission.detected log event
state.transition.conflict metric
DB lock wait dashboard
trace span around idempotency check
```

This is the difference between raw telemetry and useful evidence.

---

## 21. Practical Labs

### Lab 1 — Log-to-trace correlation

Build a small Spring Boot or servlet app with:

```text
GET /hello
GET /fail
```

Requirements:

1. Install OpenTelemetry Java agent.
2. Configure structured JSON logging.
3. Ensure logs contain `trace.id` and `span.id`.
4. Trigger `/fail`.
5. Find error log.
6. Open trace by trace ID.

Expected learning:

```text
You understand how active trace context becomes log correlation fields.
```

### Lab 2 — Metric-to-trace using exemplar concept

Requirements:

1. Create histogram metric for request duration.
2. Generate slow request.
3. Ensure backend can show exemplar or simulate with trace ID in selected slow log.
4. Move from latency chart to representative trace.

Expected learning:

```text
You understand why metric labels must stay bounded and exemplars are references, not labels.
```

### Lab 3 — Async context propagation

Requirements:

1. HTTP endpoint publishes message or submits `CompletableFuture`.
2. Log before async boundary and inside async task.
3. First run without context propagation.
4. Then add MDC/OTel context propagation.
5. Compare logs/traces.

Expected learning:

```text
You can diagnose missing trace/correlation IDs across async boundaries.
```

### Lab 4 — Duplicate request incident

Requirements:

1. Simulate duplicate POST with same payload.
2. Add idempotency key.
3. Log state transition and idempotency decision.
4. Trace duplicate path.
5. Metric duplicate detection count.

Expected learning:

```text
You understand technical trace ID vs business idempotency identity.
```

---

## 22. Key Takeaways

1. Logs, traces, and metrics are not competing tools. They are different projections of runtime behavior.
2. Correlation requires consistent identity across signals.
3. `trace.id` and `span.id` are the bridge from logs to traces.
4. Metrics should not use request-specific IDs as labels.
5. Exemplars are the right mental model for linking aggregate metrics to individual traces.
6. Async systems require explicit propagation of trace and business correlation context.
7. Audit logs and traces have different purposes and retention models, but they should be cross-referenceable.
8. Correlation must be validated before production incidents.
9. A strong observability system is query-first, not dashboard-first.
10. The top-tier skill is not collecting more telemetry; it is designing evidence that answers production questions quickly and defensibly.

---

## 23. References

- OpenTelemetry Java documentation — telemetry generation and collection for Java using API/SDKs, including metrics, logs, and traces: https://opentelemetry.io/docs/languages/java/
- OpenTelemetry Semantic Conventions — common names for operations and data across traces, metrics, logs, profiles, and resources: https://opentelemetry.io/docs/concepts/semantic-conventions/
- OpenTelemetry Logs specification — LogRecords can include TraceId and SpanId to correlate logs and traces: https://opentelemetry.io/docs/specs/otel/logs/
- OpenTelemetry Java Instrumentation — Java agent for Java 8+ applications: https://github.com/open-telemetry/opentelemetry-java-instrumentation
- Prometheus exemplar storage — exemplars can reference data outside the MetricSet, commonly trace IDs: https://prometheus.io/docs/prometheus/latest/feature_flags/
- Grafana exemplars — exemplars connect metric trends to individual traces: https://grafana.com/docs/grafana/latest/fundamentals/exemplars/

---

## 24. Status Seri

Selesai sampai: **Part 16 — Logs + Traces + Metrics Correlation**  
Belum selesai.  
Berikutnya: **Part 17 — Logging Performance: Cost Model, Allocation, Locking, IO, Backpressure**



<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 15 — Metrics Engineering: RED, USE, JVM, Application, Business Metrics](./15-metrics-engineering-red-use-jvm-application-business-metrics.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 17 — Logging Performance: Cost Model, Allocation, Locking, IO, Backpressure](./17-logging-performance-cost-model-allocation-locking-io-backpressure.md)

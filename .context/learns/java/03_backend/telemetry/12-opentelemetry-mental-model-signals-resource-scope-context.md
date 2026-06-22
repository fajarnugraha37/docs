# Part 12 — OpenTelemetry Mental Model: Signals, Resource, Scope, Context

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> Fokus: Java 8 sampai Java 25  
> Posisi: setelah logging semantics, structured logging, dan context/correlation identity; sebelum Java agent, manual tracing, metrics engineering, dan correlation playbook.

---

## 0. Tujuan Part Ini

Part ini membangun mental model OpenTelemetry atau OTel dari sisi engineer Java yang ingin mampu mendesain observability system, bukan sekadar memasang agent dan berharap dashboard muncul.

Setelah part ini, target pemahaman adalah:

1. Mampu menjelaskan apa itu OpenTelemetry tanpa menyederhanakan menjadi “library tracing”.
2. Mampu membedakan API, SDK, instrumentation, agent, collector, exporter, backend, dan semantic conventions.
3. Mampu memahami tiga signal utama: traces, metrics, logs.
4. Mampu memahami konsep `Resource`, `Instrumentation Scope`, `Context`, `Span`, `Metric Instrument`, dan `LogRecord`.
5. Mampu memilih kapan memakai auto instrumentation, manual instrumentation, atau kombinasi keduanya.
6. Mampu membaca pipeline telemetry dari aplikasi Java sampai backend observability.
7. Mampu melihat risiko desain: cardinality explosion, over-instrumentation, sampling bias, missing context, wrong resource identity, dan vendor lock-in.
8. Mampu menyiapkan fondasi untuk part berikutnya: Java agent rollout, manual tracing, metrics engineering, dan signal correlation.

Part ini bukan tutorial klik-dashboard. Ini adalah cara berpikir.

---

## 1. Core Mental Model

OpenTelemetry adalah standard dan toolkit untuk menghasilkan, mengumpulkan, memproses, dan mengekspor telemetry.

Telemetry adalah bukti runtime yang dikirim oleh aplikasi dan infrastruktur untuk menjelaskan perilaku sistem.

Dalam Java service, OpenTelemetry biasanya hadir sebagai kombinasi:

```text
Application Code
  -> OTel API
  -> OTel SDK or Java Agent instrumentation
  -> Exporter
  -> OTel Collector
  -> Observability Backend
  -> Query / Dashboard / Alert / Incident Investigation
```

Namun mental model yang lebih tepat adalah:

```text
Runtime Behavior
  -> observed as signals
  -> enriched with identity and context
  -> normalized by semantic conventions
  -> transported through telemetry protocol
  -> processed by pipeline
  -> queried during engineering decision-making
```

OpenTelemetry bukan tujuan akhir. Tujuan akhirnya adalah kemampuan menjawab pertanyaan produksi:

1. Request mana yang lambat?
2. Dependency mana yang menyebabkan latency?
3. Tenant/user/module mana yang terdampak?
4. Error terjadi sebelum atau sesudah retry?
5. Apakah bottleneck ada di service, database, queue, network, GC, CPU, atau downstream?
6. Apakah deploy terbaru mengubah latency distribution?
7. Apakah ini global, regional, pod-specific, endpoint-specific, atau customer-specific?
8. Apakah log, trace, dan metric berbicara tentang kejadian yang sama?

OpenTelemetry adalah bahasa bersama untuk membangun jawaban tersebut.

---

## 2. OpenTelemetry Bukan Sekadar Tracing

Kesalahan umum:

```text
OpenTelemetry = distributed tracing
```

Itu kurang lengkap.

OpenTelemetry mencakup tiga signal utama:

```text
1. Traces  -> request/workflow journey
2. Metrics -> numerical time-series behavior
3. Logs    -> discrete event records
```

Selain itu, OTel juga mendefinisikan konsep pendukung:

```text
Resource                -> entity that produced telemetry
Instrumentation Scope   -> instrumentation library/module that produced telemetry
Context                 -> propagation state across execution boundaries
Semantic Conventions    -> standard naming/modeling rules
Exporters               -> transport out of process
Collector               -> receive/process/export telemetry
OTLP                    -> OpenTelemetry Protocol
```

Jadi, OTel adalah observability data model + API + SDK + instrumentation ecosystem + pipeline architecture.

---

## 3. Kenapa OpenTelemetry Penting untuk Java Engineer

Java ecosystem historically memiliki banyak cara observability:

```text
Logging:
  - JUL
  - Log4j
  - Logback
  - SLF4J

Metrics:
  - JMX
  - Dropwizard Metrics
  - Micrometer
  - Prometheus client

Tracing:
  - Zipkin Brave
  - OpenTracing
  - Jaeger client
  - vendor SDK

Profiling/diagnostics:
  - JFR
  - jcmd
  - async-profiler
```

Masalahnya, jika setiap library dan setiap vendor punya model sendiri, maka sistem menjadi fragmented:

```text
Log uses correlationId=A
Trace uses trace_id=B
Metric label uses requestType=C
Dashboard groups by serviceName=D
Backend uses resource.service.name=E
```

Hasilnya:

```text
Data exists, but cannot be correlated.
```

OpenTelemetry mencoba menyelesaikan ini dengan standardisasi:

1. Satu API lintas vendor.
2. Satu data model lintas signal.
3. Satu protocol umum: OTLP.
4. Satu konsep resource identity.
5. Satu mekanisme context propagation.
6. Semantic conventions untuk service, HTTP, DB, messaging, RPC, runtime, host, container, Kubernetes, dan lainnya.

Bagi Java engineer senior, OTel penting karena banyak masalah produksi tidak bisa diselesaikan dengan log saja.

---

## 4. Vocabulary Fundamental

### 4.1 Telemetry

Telemetry adalah data yang dikirim oleh sistem untuk menjelaskan perilaku runtime.

Contoh:

```json
{
  "timestamp": "2026-06-18T10:15:20.123Z",
  "service.name": "case-service",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "event.name": "case.transition.completed",
  "case.id": "CASE-2026-0001",
  "from_state": "DRAFT",
  "to_state": "SUBMITTED"
}
```

Telemetry bukan hanya logs. Ini bisa berupa trace span, metric point, log record, event, profile, atau JFR event. Dalam scope OTel, fokus utama adalah traces, metrics, logs.

---

### 4.2 Instrumentation

Instrumentation adalah kode atau mekanisme yang menghasilkan telemetry.

Ada dua jenis besar:

```text
Auto instrumentation:
  - agent/library automatically instruments frameworks and clients
  - examples: servlet, Spring MVC, JDBC, OkHttp, Kafka, RabbitMQ

Manual instrumentation:
  - developer explicitly creates spans, metrics, log correlation, attributes
  - examples: business workflow span, case transition attribute, idempotency event
```

Auto instrumentation menjawab:

```text
Which technical calls happened?
```

Manual instrumentation menjawab:

```text
What did this mean in our domain?
```

Top-tier observability biasanya memakai keduanya.

---

### 4.3 API

OTel API adalah kontrak yang dipakai instrumentation code untuk merekam telemetry.

Di Java:

```java
Tracer tracer = GlobalOpenTelemetry.getTracer("com.example.case-service");
Span span = tracer.spanBuilder("case.submit").startSpan();
```

API seharusnya aman dipakai oleh library karena bisa no-op jika SDK tidak dikonfigurasi.

Mental model:

```text
API = how code expresses telemetry intent
```

---

### 4.4 SDK

SDK adalah implementation yang memproses telemetry dari API.

SDK bertanggung jawab untuk:

1. Membuat span processor.
2. Mengatur sampler.
3. Membuat metric reader.
4. Mengatur log record processor.
5. Menambahkan resource attributes.
6. Mengekspor data via exporter.
7. Batch, queue, retry, dan shutdown behavior.

Mental model:

```text
SDK = runtime engine that turns telemetry intent into exported data
```

---

### 4.5 Exporter

Exporter mengirim telemetry keluar dari proses aplikasi.

Contoh tujuan:

```text
- OTLP endpoint
- OpenTelemetry Collector
- Prometheus scrape endpoint
- logging exporter for local debugging
- vendor-specific backend
```

Mental model:

```text
Exporter = transport adapter
```

---

### 4.6 Collector

OpenTelemetry Collector adalah proses terpisah untuk menerima, memproses, dan meneruskan telemetry.

Pipeline collector biasanya:

```text
Receivers -> Processors -> Exporters
```

Contoh:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
      http:

processors:
  batch:
  memory_limiter:
  resource:
  attributes:

exporters:
  otlp/vendor:
    endpoint: observability-vendor.example.com:4317
```

Mental model:

```text
Collector = telemetry gateway and processing pipeline
```

Collector penting karena aplikasi sebaiknya tidak terlalu tahu vendor backend.

---

### 4.7 Backend

Backend adalah tempat telemetry disimpan, di-query, divisualisasikan, dan digunakan untuk alert.

Contoh kategori:

```text
- tracing backend
- metrics backend
- log analytics backend
- APM platform
- SIEM
- long-term storage
```

Mental model:

```text
Backend = query and decision layer
```

OTel bukan backend. OTel membantu mengirim data ke backend.

---

## 5. Three Signals: Traces, Metrics, Logs

### 5.1 Trace

Trace menjelaskan perjalanan satu unit kerja.

Unit kerja bisa berupa:

1. HTTP request.
2. gRPC call.
3. Message consumption.
4. Batch item processing.
5. Scheduler execution.
6. Case workflow transition.
7. File import.
8. External API synchronization.

Trace terdiri dari span.

```text
Trace
 ├── Span: HTTP POST /cases
 │    ├── Span: validate request
 │    ├── Span: SELECT user permission
 │    ├── Span: INSERT case
 │    ├── Span: publish case-submitted event
 │    └── Span: send notification
```

Trace menjawab:

```text
Where did time go?
```

Trace bagus untuk:

1. Latency breakdown.
2. Distributed call chain.
3. Dependency timing.
4. Error path reconstruction.
5. Retry visualization.
6. N+1 call detection.
7. Async causality.

Trace kurang bagus untuk:

1. Aggregate rate by itself.
2. Long-term trend without metrics.
3. Searching all business events if sampling is enabled.
4. Compliance audit as sole source of truth.

---

### 5.2 Metric

Metric adalah nilai numerik dalam time series.

Contoh:

```text
http.server.request.duration
http.server.request.count
jvm.memory.used
jvm.gc.pause.duration
db.client.operation.duration
hikaricp.connections.active
queue.consumer.lag
case.submission.count
```

Metric menjawab:

```text
How much? How often? How bad? Is it getting worse?
```

Metric bagus untuk:

1. Alerting.
2. SLO tracking.
3. Trend analysis.
4. Capacity planning.
5. Saturation detection.
6. Rate and ratio computation.
7. Fleet-wide aggregate view.

Metric kurang bagus untuk:

1. Explaining one specific request.
2. Showing stack trace.
3. Detailed causality.
4. Arbitrary high-cardinality debugging.

---

### 5.3 Log

Log adalah event record.

Contoh:

```json
{
  "timestamp": "2026-06-18T10:15:20.123Z",
  "severity": "INFO",
  "event.name": "case.submission.accepted",
  "trace.id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "case.id": "CASE-2026-0001",
  "actor.id": "u-123",
  "outcome": "success"
}
```

Log menjawab:

```text
What event happened with what context?
```

Log bagus untuk:

1. Discrete event evidence.
2. Error detail.
3. Business state transitions.
4. Security events.
5. Audit-supporting diagnostics.
6. Forensic timeline.
7. Rare event investigation.

Log kurang bagus untuk:

1. High-frequency numeric trend if used alone.
2. Latency breakdown across services without trace context.
3. Alerting at huge scale if no metric extraction.
4. Querying when schema is inconsistent.

---

## 6. Signal Selection: Which Signal Answers Which Question?

| Question | Best Primary Signal | Supporting Signal |
|---|---:|---:|
| Is the system healthy? | Metrics | Logs/traces |
| Which endpoint is slow? | Metrics | Traces |
| Why was this one request slow? | Trace | Logs/JFR |
| Which dependency caused latency? | Trace | Metrics |
| How many requests failed? | Metrics | Logs |
| What exact error happened? | Logs | Trace |
| Which customer/tenant was impacted? | Logs/traces | Metrics if safe cardinality |
| Did a deploy change behavior? | Metrics | Traces/logs |
| Is there thread starvation? | Metrics/JFR/thread dump | Logs |
| Is there GC pressure? | Metrics/JFR/GC logs | Profiles |
| Was a security-sensitive action attempted? | Security logs | Traces |
| Is there a memory leak? | Heap dump/profile/JFR | Metrics/logs |

A top-tier engineer does not ask “Should I log this?” first.

They ask:

```text
What question will we need to answer later?
Which evidence answers that question with the least noise and lowest cost?
```

---

## 7. Resource: Who Produced This Telemetry?

`Resource` describes the entity that produced telemetry.

For Java service, important resource attributes are usually:

```text
service.name
service.namespace
service.version
service.instance.id
deployment.environment.name
host.name
container.name
k8s.namespace.name
k8s.pod.name
k8s.container.name
cloud.provider
cloud.region
```

Example:

```text
service.name=case-service
service.namespace=aceas
service.version=2026.06.18-rc1
deployment.environment.name=uat
k8s.namespace.name=aceas-uat
k8s.pod.name=case-service-7fd9dc5d6c-lq2kp
```

Resource identity is not cosmetic. It controls whether telemetry can be grouped correctly.

Bad resource design:

```text
service.name=app
service.name=backend
service.name=java-service
service.name=case-service-v1.2.3
```

Problems:

1. Too generic.
2. Version encoded into service name.
3. Different teams naming same service differently.
4. Dashboard grouping breaks.
5. Service map becomes useless.

Better:

```text
service.name=case-service
service.version=1.2.3
service.namespace=aceas
```

### 7.1 Resource vs Attribute

Not every field belongs in resource.

Resource is stable identity of telemetry producer.

Span/log/metric attributes describe the event or measurement.

Example:

```text
Resource:
  service.name=case-service
  deployment.environment.name=prod
  k8s.pod.name=case-service-abc123

Span attributes:
  http.request.method=POST
  url.path=/cases
  case.operation=submit

Log attributes:
  event.name=case.submission.failed
  error.type=ValidationException

Metric attributes:
  http.route=/cases
  http.response.status_code=400
```

Do not put request-specific fields into resource.

Wrong:

```text
resource.case.id=CASE-123
resource.user.id=u-123
```

This causes resource cardinality explosion and invalid grouping.

---

## 8. Instrumentation Scope: Who Instrumented This?

Instrumentation Scope describes the library/module responsible for producing telemetry.

Example:

```text
name=com.example.case.workflow
version=1.4.0
```

For auto instrumentation, scope might be tied to instrumentation library:

```text
io.opentelemetry.servlet-3.0
io.opentelemetry.jdbc
io.opentelemetry.spring-webmvc
```

For manual instrumentation, choose meaningful scope names:

```java
Tracer tracer = openTelemetry.getTracer(
    "com.example.case.workflow",
    "1.0.0"
);
```

Mental model:

```text
Resource tells who emitted telemetry.
Instrumentation scope tells which instrumentation produced it.
Span/log/metric attributes tell what happened.
```

Why scope matters:

1. Debugging duplicate telemetry.
2. Knowing whether data came from auto or manual instrumentation.
3. Filtering noisy instrumentation.
4. Versioning internal instrumentation libraries.
5. Governance across shared platform modules.

---

## 9. Context: The Invisible Link Between Signals

Context is runtime state that flows with execution.

It carries things like:

```text
trace id
span id
baggage
current span
correlation identity
```

Without context propagation:

```text
Service A trace starts.
Service B receives request but starts unrelated trace.
Logs do not contain trace id.
Metrics cannot link to exemplar.
Investigation becomes manual guesswork.
```

With context propagation:

```text
Service A trace id = T1
HTTP header carries T1
Service B continues T1
Service B logs include T1
Metric exemplar links to span in T1
```

### 9.1 In-Process Context

Inside one Java process:

```text
request thread -> service method -> repository call -> http client call
```

Context must survive:

1. Method calls.
2. Executors.
3. CompletableFuture.
4. Reactor chain.
5. Virtual threads.
6. Scheduled tasks.
7. Message listener boundaries.

### 9.2 Cross-Process Context

Across services:

```text
HTTP/gRPC/message headers carry context.
```

Common standard:

```text
traceparent
tracestate
baggage
```

### 9.3 Context Is Not Business State

Do not abuse context as hidden mutable business payload.

Bad:

```text
Put full user profile into baggage.
Put entire permission set into context.
Put request body into context.
```

Good:

```text
trace id
span id
small tenant id if allowed
correlation id
safe routing/debug attributes
```

Context should be small, bounded, and safe.

---

## 10. Trace Model Deep Dive

### 10.1 Trace

A trace is a tree or graph of spans representing one distributed operation.

```text
Trace ID = globally unique operation identity
```

Example:

```text
POST /cases/submit
  -> validate payload
  -> query applicant
  -> insert case
  -> publish event
  -> call notification service
```

### 10.2 Span

A span represents a timed operation.

Important fields:

```text
trace id
span id
parent span id
name
kind
start timestamp
end timestamp
duration
status
attributes
events
links
```

Span kinds:

```text
SERVER    inbound server request
CLIENT    outbound client request
PRODUCER  publish message
CONSUMER  consume message
INTERNAL  internal operation
```

### 10.3 Span Name

Span name should be low-cardinality.

Bad:

```text
GET /cases/CASE-2026-0001
submit case CASE-2026-0001 for user u-123
```

Good:

```text
GET /cases/{caseId}
case.submit
```

Put specific values in attributes if safe and needed.

### 10.4 Span Attributes

Attributes describe operation properties.

Examples:

```text
http.request.method=POST
url.path=/cases/submit
http.route=/cases/submit
db.system=oracle
db.operation=SELECT
messaging.system=rabbitmq
messaging.destination.name=case-submitted
case.operation=submit
case.state.from=DRAFT
case.state.to=SUBMITTED
```

Avoid high-cardinality fields unless intentionally controlled.

Risky:

```text
user.id
email
full URL with query string
case.id
raw SQL with literals
request.body
```

### 10.5 Span Events

Span event is a timestamped event inside span.

Use for:

1. Retry attempt.
2. Fallback selected.
3. Validation stage failed.
4. Cache miss/hit if important.
5. State transition checkpoint.
6. Exception event.

Example:

```java
span.addEvent("case.validation.completed", Attributes.of(
    stringKey("validation.outcome"), "success"
));
```

Do not turn every log into span event. Span event volume can explode.

### 10.6 Span Links

Links connect spans that are related but not parent-child.

Useful for:

1. Batch processing multiple input messages.
2. Fan-in workflows.
3. Queue redelivery.
4. Async event causation.
5. Retry across different trace roots.

Example:

```text
Batch job span links to 100 message traces.
```

---

## 11. Metrics Model Deep Dive

OTel metrics are produced through instruments.

Common instrument types:

```text
Counter
UpDownCounter
Histogram
Gauge / ObservableGauge
ObservableCounter
ObservableUpDownCounter
```

### 11.1 Counter

Monotonically increasing value.

Use for:

```text
requests total
errors total
messages consumed
cases submitted
retry attempts
```

Do not decrement counter.

### 11.2 UpDownCounter

Can increase or decrease.

Use for:

```text
active sessions
in-flight jobs
queue depth if manually observed
active connections
```

### 11.3 Histogram

Records distribution.

Use for:

```text
request duration
DB query duration
external API latency
queue processing duration
file import duration
```

Histogram is essential for percentiles/SLO.

### 11.4 Gauge

Measures current value.

Use for:

```text
heap used
thread count
connection pool active
queue depth
CPU utilization
```

### 11.5 Metric Attributes

Metric attributes become dimensions.

Good:

```text
http.route=/cases/{caseId}
http.request.method=GET
http.response.status_code=200
error.type=TimeoutException
```

Dangerous:

```text
user.id=u-123
case.id=CASE-123
raw_url=/cases/CASE-123?token=abc
exception.message=ORA-00001 unique constraint XYZ_123
```

Metrics cardinality explosion is one of the fastest ways to destroy observability cost and performance.

---

## 12. Logs Model in OpenTelemetry

OTel treats logs as first-class telemetry signal.

Important fields in a log record:

```text
timestamp
observed timestamp
severity text
severity number
body
attributes
trace id
span id
resource
instrumentation scope
```

This makes logs correlatable with traces and resources.

### 12.1 OTel Logs vs Application Logging Framework

Java applications usually already log through SLF4J + Logback/Log4j2.

OTel log support does not mean every application must directly call OTel log API.

Common patterns:

```text
Pattern A:
  App logs JSON to stdout
  Collector/Filebeat/Fluent Bit ingests logs
  Trace/span IDs included in JSON fields

Pattern B:
  Appender exports logs directly as OTel LogRecords

Pattern C:
  Agent captures logs and correlates them with trace context
```

Top-tier design rule:

```text
Do not break existing operational logging just to chase pure OTel logs.
First ensure log schema, trace correlation, and ingestion reliability.
```

### 12.2 Log Body vs Attributes

Bad:

```json
{
  "body": "User u-123 submitted case CASE-001 with status success and tenant aceas"
}
```

Better:

```json
{
  "body": "case submission completed",
  "attributes": {
    "event.name": "case.submission.completed",
    "case.id": "CASE-001",
    "tenant.id": "aceas",
    "outcome": "success"
  }
}
```

For machine query, attributes matter.

---

## 13. Semantic Conventions

Semantic conventions define standard attribute names and meanings.

Examples:

```text
service.name
service.version
http.request.method
http.response.status_code
url.path
server.address
db.system
db.operation
messaging.system
messaging.destination.name
exception.type
exception.message
exception.stacktrace
```

Why this matters:

1. Dashboards can be reused.
2. Vendor tools can understand telemetry.
3. Teams avoid naming chaos.
4. Service maps become meaningful.
5. Query language becomes predictable.

Without semantic conventions:

```text
team A: status_code
team B: httpStatus
team C: response.status
team D: code
```

With conventions:

```text
http.response.status_code
```

### 13.1 Domain Attributes

OTel semantic conventions cannot cover every business domain.

For domain-specific fields, create internal conventions:

```text
case.id
case.type
case.operation
case.state.from
case.state.to
workflow.instance.id
workflow.transition.id
agency.id
module.name
```

Governance rule:

```text
Use official semantic conventions where they exist.
Use internal domain conventions where official ones do not exist.
Do not invent synonyms casually.
```

---

## 14. OTLP: Telemetry Transport

OTLP is OpenTelemetry Protocol.

It can send:

```text
traces
metrics
logs
```

Common transports:

```text
gRPC
HTTP/protobuf
HTTP/json in some contexts
```

Typical Java app config:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

or:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
```

### 14.1 App to Backend Direct vs App to Collector

Direct:

```text
Java app -> vendor backend
```

Pros:

1. Simpler initial setup.
2. Fewer moving parts.

Cons:

1. Vendor coupling in app config.
2. Harder to transform/filter centrally.
3. Harder to buffer or protect backend.
4. Reconfiguration requires app rollout.

Collector:

```text
Java app -> OTel Collector -> backend(s)
```

Pros:

1. Central processing.
2. Multi-export support.
3. Redaction/filtering.
4. Batching/retry.
5. Vendor-neutral application config.
6. Easier migration.

Cons:

1. More infrastructure.
2. Collector must be operated reliably.
3. Pipeline misconfig can drop telemetry.

Production-grade systems usually prefer collector.

---

## 15. OpenTelemetry Collector Mental Model

Collector pipelines are usually signal-specific.

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/vendor]

    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/vendor]

    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/vendor]
```

### 15.1 Receivers

Receivers accept telemetry.

Examples:

```text
otlp
prometheus
jaeger
zipkin
filelog
hostmetrics
```

### 15.2 Processors

Processors modify, enrich, drop, batch, or sample telemetry.

Examples:

```text
batch
memory_limiter
attributes
resource
filter
tailsampling
span
transform
```

### 15.3 Exporters

Exporters send telemetry to destination.

Examples:

```text
otlp
prometheusremotewrite
logging/debug
file
vendor exporters
```

### 15.4 Collector Deployment Patterns

```text
1. Agent/DaemonSet per node
2. Sidecar per service
3. Gateway collector per cluster/environment
4. Hybrid: DaemonSet + gateway
```

For Kubernetes:

```text
App pod -> node collector daemonset -> gateway collector -> backend
```

For simpler environments:

```text
App -> gateway collector -> backend
```

---

## 16. Java Integration Options

### 16.1 Zero-Code Java Agent

Java agent attaches at JVM startup:

```bash
java -javaagent:/opt/opentelemetry-javaagent.jar -jar app.jar
```

It dynamically instruments supported libraries/frameworks.

Good for:

1. Fast rollout.
2. Baseline traces for HTTP/JDBC/messaging.
3. Standard JVM/runtime metrics.
4. Services with limited ability to change code.
5. Uniform platform-level observability.

Limitations:

1. Does not understand your domain semantics.
2. May create too much or too little detail.
3. May need config suppression/tuning.
4. Needs version compatibility testing.
5. Auto spans may be insufficient for workflow/state-machine diagnosis.

### 16.2 Manual SDK Instrumentation

Application configures OTel SDK and creates telemetry explicitly.

Good for:

1. Domain spans.
2. Business metrics.
3. Custom attributes.
4. Special async workflow.
5. Library instrumentation.

Costs:

1. More code.
2. Requires discipline.
3. Risk of inconsistent attributes.
4. Risk of high cardinality.

### 16.3 Library Instrumentation

If you build shared libraries, prefer OTel API, not SDK.

Library should not force exporter/backend choice.

Good library behavior:

```text
- depend on opentelemetry-api
- create spans/metrics through API
- no global SDK side effects
- no hardcoded exporter
- low overhead when no SDK configured
```

### 16.4 Spring Boot Starter

In Spring Boot ecosystem, OTel integration can be done through starter or agent depending on platform strategy.

Decision depends on:

1. How much control application team wants.
2. Whether platform team enforces agent rollout.
3. Whether Micrometer is already central.
4. Required log correlation model.
5. Operational risk appetite.

---

## 17. Java 8 sampai Java 25 Considerations

### 17.1 Java 8

Common environment:

```text
- legacy servlet apps
- older Spring Boot
- older app servers
- thread pool heavy
- no virtual threads
- limited modern JFR availability depending distribution
```

OTel Java agent supports Java 8+ in modern documentation, making it attractive for legacy modernization.

Key concerns:

1. Classpath conflicts.
2. Old HTTP/JDBC libraries.
3. Older TLS/cert behavior.
4. Performance overhead on smaller heaps.
5. App server classloader behavior.

### 17.2 Java 11/17

Common production baseline.

Advantages:

1. Better container awareness than Java 8.
2. Better JFR availability.
3. Unified logging.
4. Stronger support ecosystem.
5. Modern Spring Boot versions often target these.

### 17.3 Java 21

Important because of virtual threads.

Effects:

1. More concurrency possible.
2. Thread names less useful as request identity.
3. ThreadLocal/MDC assumptions need review.
4. Context propagation remains critical.
5. Blocking spans may appear differently under virtual threads.

### 17.4 Java 25

Java 25 includes modern language/runtime evolution, including finalized Scoped Values. For observability, the important idea is that immutable scoped context becomes a better primitive than uncontrolled mutable ThreadLocal in many structured concurrency scenarios.

Implication:

```text
Future Java observability design should not depend solely on thread identity.
It should depend on explicit context propagation and structured context boundaries.
```

---

## 18. Auto Instrumentation vs Manual Instrumentation Decision Matrix

| Need | Auto Agent | Manual Instrumentation | Both |
|---|---:|---:|---:|
| HTTP inbound traces | Excellent | Optional | Common |
| JDBC spans | Excellent | Optional enrichment | Common |
| External HTTP client spans | Excellent | Optional enrichment | Common |
| Business workflow spans | Poor | Excellent | Best |
| State transition evidence | Poor | Excellent | Best |
| Business metrics | Poor | Excellent | Best |
| Legacy service quick rollout | Excellent | Later | Best staged approach |
| Fine-grained domain causality | Limited | Excellent | Best |
| Low operational effort | Good | Medium/high | Medium |
| Governance consistency | Good via platform | Requires review | Best with standards |

Recommended strategy:

```text
Start with agent for baseline technical telemetry.
Add manual instrumentation only where it answers domain or troubleshooting questions the agent cannot answer.
Govern attributes and cardinality from the beginning.
```

---

## 19. Sampling Mental Model

Sampling decides which traces/logs/events are kept or exported.

### 19.1 Head Sampling

Decision made at trace start.

Example:

```text
Keep 10% of traces.
```

Pros:

1. Simple.
2. Cheap.
3. Works in SDK/agent.

Cons:

1. May drop rare errors.
2. Cannot know future latency/error at request start.
3. Can bias investigation.

### 19.2 Tail Sampling

Decision made after trace completes, usually in collector.

Can keep traces based on:

```text
- error status
- high latency
- specific route
- tenant/module
- random percentage
```

Pros:

1. Better signal quality.
2. Can retain important traces.
3. Useful for incident investigation.

Cons:

1. Requires buffering.
2. More collector complexity.
3. Higher memory/cost.

### 19.3 Sampling and Logs

Do not assume trace sampling is safe for audit or critical business logs.

If a business event must be retained:

```text
It must be logged or persisted independently of trace sampling.
```

Trace sampling is for observability cost control, not compliance retention.

---

## 20. Cardinality: The Silent Observability Killer

Cardinality is number of distinct values for a field/dimension.

Low cardinality:

```text
http.method = GET/POST/PUT/DELETE
http.status_code = 200/400/500
service.name = known service list
environment = dev/uat/prod
```

High cardinality:

```text
user.id
case.id
email
session.id
request.id
trace.id
full URL with IDs
exception.message with dynamic values
raw SQL with literals
```

High cardinality effects:

1. Metrics backend cost explosion.
2. Slow queries.
3. Memory pressure in collectors/backends.
4. Dashboard unusability.
5. Alert instability.
6. Dropped telemetry.

Rule:

```text
High-cardinality values may be acceptable in logs/traces when needed and safe.
They are usually dangerous as metric labels.
```

Decision table:

| Field | Logs | Traces | Metrics |
|---|---:|---:|---:|
| `trace.id` | Yes | Native | No label |
| `request.id` | Yes | Sometimes | No |
| `user.id` | Carefully | Carefully | Usually no |
| `case.id` | Carefully | Carefully | Usually no |
| `http.route` | Yes | Yes | Yes |
| `http.status_code` | Yes | Yes | Yes |
| `error.type` | Yes | Yes | Yes if bounded |
| `exception.message` | Yes with care | Yes with care | No |

---

## 21. Resource and Attribute Naming Standard for Java Services

A practical baseline:

### 21.1 Resource Attributes

```text
service.name
service.namespace
service.version
service.instance.id
deployment.environment.name
cloud.provider
cloud.region
k8s.namespace.name
k8s.pod.name
k8s.container.name
host.name
process.runtime.name
process.runtime.version
```

### 21.2 Common Span Attributes

```text
operation.name
component
module.name
case.operation
workflow.name
workflow.instance.id
retry.count
outcome
error.type
```

### 21.3 HTTP Attributes

Prefer semantic convention names where possible:

```text
http.request.method
http.response.status_code
http.route
url.path
server.address
server.port
client.address
user_agent.original
```

### 21.4 Database Attributes

```text
db.system
db.namespace
db.operation
db.collection.name
db.query.summary
```

Avoid raw SQL with literals as high-volume attribute unless carefully controlled.

### 21.5 Messaging Attributes

```text
messaging.system
messaging.operation
messaging.destination.name
messaging.message.id
messaging.batch.message_count
```

### 21.6 Domain Attributes

```text
case.type
case.operation
case.state.from
case.state.to
workflow.name
module.name
agency.id
```

Govern domain attributes like API contracts.

---

## 22. Typical Java OTel Pipeline Designs

### 22.1 Minimal Local Development

```text
Java app + OTel agent
  -> console/logging exporter
  -> local collector or local backend
```

Good for learning.

Not enough for production.

### 22.2 Production Kubernetes Baseline

```text
Java service pod
  - OTel Java agent
  - JSON logs to stdout
  - OTLP traces/metrics/logs to collector

OTel Collector DaemonSet or Gateway
  - receive OTLP
  - enrich resource with k8s metadata
  - batch
  - memory limit
  - export to backend

Backend
  - dashboards
  - traces
  - log search
  - alerts
```

### 22.3 Hybrid Existing Logging Stack

```text
Java service
  - SLF4J + Logback/Log4j2 JSON stdout
  - trace/span IDs in MDC
  - OTel agent exports traces/metrics

Log pipeline
  - Fluent Bit/Filebeat/Collector filelog receiver
  - parse JSON logs
  - backend log analytics
```

This is common because organizations already have log pipelines.

### 22.4 Regulated Enterprise Baseline

```text
Application logs:
  - diagnostic logs
  - security logs
  - audit-supporting logs
  - redacted structured fields

OTel:
  - traces sampled
  - metrics retained for SLO/capacity
  - logs correlated with traces

Audit system:
  - separate immutable audit records
  - not dependent on trace sampling
```

Important distinction:

```text
Observability is not automatically audit compliance.
```

---

## 23. OpenTelemetry and Existing Java Tools

### 23.1 OTel vs SLF4J

SLF4J is logging facade.

OTel is observability framework.

They complement each other.

```text
SLF4J produces application log events.
OTel provides trace context and can correlate/export logs.
```

### 23.2 OTel vs Micrometer

Micrometer is metrics instrumentation facade widely used in Spring ecosystem.

OTel can export metrics and has its own metrics API/SDK.

In Spring systems, you may see:

```text
Spring Boot Actuator + Micrometer + Prometheus
OTel Java agent + traces
OTel Collector receives Prometheus/OTLP
```

Decision should consider existing platform standards.

### 23.3 OTel vs JFR

OTel captures service-level telemetry.

JFR captures JVM/runtime-level events.

They answer different questions.

```text
OTel: Which request/dependency/workflow is slow?
JFR: What was JVM doing internally during that time?
```

Best incident analysis often uses both.

### 23.4 OTel vs async-profiler

OTel trace tells where latency occurs at logical operation boundaries.

Profiler tells where CPU/allocation/lock time is spent inside code.

Example:

```text
Trace: /reports/generate spends 7s in renderReport
Profiler: 68% CPU in regex/date formatting/template rendering
```

---

## 24. Anti-Patterns

### 24.1 “Install Agent, Done”

Agent gives baseline technical telemetry.

It does not give domain meaning.

Missing:

1. Business workflow names.
2. State transition context.
3. Idempotency semantics.
4. Actor/tenant/module governance.
5. Security event modeling.

### 24.2 “Put Everything as Attributes”

More attributes do not mean better observability.

They can create:

1. Privacy risk.
2. Cardinality explosion.
3. Cost explosion.
4. Query confusion.
5. Slower ingestion.

### 24.3 “Every Method Gets a Span”

Bad tracing:

```text
span: validateInput
span: mapDto
span: callHelper
span: convertDate
span: buildResponse
```

This creates noise.

Better tracing:

```text
span: case.submit
span: authorization.check
span: case.persist
span: notification.publish
```

Trace meaningful boundaries, not every Java method.

### 24.4 “Use Trace as Audit Trail”

Trace sampling, retention, and backend behavior may not satisfy audit requirements.

Audit requires independent design.

### 24.5 “Metrics with IDs”

Bad:

```text
case_submission_total{case_id="CASE-123"}
```

This explodes cardinality.

Better:

```text
case_submission_total{case_type="renewal", outcome="success"}
```

### 24.6 “Context as Global Mutable Bag”

Bad:

```text
Context stores user object, request body, permissions, tokens.
```

Better:

```text
Context stores minimal safe propagation identifiers.
Business data stays explicit in code.
```

---

## 25. Example: Case Submission Flow Observability Design

Imagine Java service:

```text
POST /cases/{caseId}/submit
```

Flow:

```text
1. Authenticate user
2. Authorize operation
3. Validate case state
4. Persist transition
5. Publish message
6. Return response
```

### 25.1 Trace Design

```text
Trace: POST /cases/{caseId}/submit
  Span SERVER: POST /cases/{caseId}/submit
    Span INTERNAL: authorization.check
    Span INTERNAL: case.transition.validate
    Span CLIENT: Oracle UPDATE case
    Span PRODUCER: RabbitMQ publish case-submitted
```

### 25.2 Span Attributes

```text
case.operation=submit
case.type=licensing
case.state.from=DRAFT
case.state.to=SUBMITTED
module.name=case-management
outcome=success
```

Be careful with `case.id`. It may be useful in trace/logs but should be governed for privacy/cardinality.

### 25.3 Metrics

```text
case_transition_total{operation="submit", outcome="success"}
case_transition_duration_seconds{operation="submit"}
http.server.request.duration{http.route="/cases/{caseId}/submit", http.method="POST"}
message_publish_total{destination="case-submitted", outcome="success"}
```

### 25.4 Logs

```json
{
  "event.name": "case.transition.completed",
  "severity": "INFO",
  "trace.id": "...",
  "span.id": "...",
  "correlation.id": "...",
  "case.id": "CASE-2026-0001",
  "case.operation": "submit",
  "case.state.from": "DRAFT",
  "case.state.to": "SUBMITTED",
  "outcome": "success"
}
```

### 25.5 Incident Query

If latency spikes:

1. Metrics show p95 `POST /cases/{caseId}/submit` increased.
2. Trace shows most time in Oracle update.
3. Logs show specific module/state transition impacted.
4. DB metrics show lock wait.
5. JFR/thread dump can confirm blocked threads if needed.

This is how signals compose.

---

## 26. Example: External API Timeout

Flow:

```text
Case service -> Identity service -> External MyInfo API
```

### 26.1 Trace

```text
Trace: POST /identity/refresh
  Span SERVER: POST /identity/refresh
    Span CLIENT: POST https://myinfo.example/token
    Span CLIENT: GET https://myinfo.example/person
```

Attributes:

```text
server.address=myinfo.example
http.request.method=GET
http.response.status_code=504
error.type=java.net.SocketTimeoutException
retry.count=2
```

### 26.2 Metrics

```text
http.client.request.duration{server.address="myinfo.example", outcome="timeout"}
external_dependency_error_total{dependency="myinfo", error_type="timeout"}
```

### 26.3 Logs

```json
{
  "event.name": "external_api.call.failed",
  "dependency.name": "myinfo",
  "operation": "person.lookup",
  "timeout.ms": 3000,
  "retry.count": 2,
  "outcome": "timeout",
  "error.type": "SocketTimeoutException"
}
```

### 26.4 Troubleshooting

Good observability lets you distinguish:

```text
- network connect timeout
- read timeout
- auth token failure
- rate limit
- downstream 5xx
- local thread starvation
- connection pool exhaustion
```

Without trace/metric/log alignment, all of those become “API slow”.

---

## 27. Configuration Baseline: Java Agent to Collector

Example JVM startup:

```bash
java \
  -javaagent:/opt/opentelemetry-javaagent.jar \
  -Dotel.service.name=case-service \
  -Dotel.resource.attributes=service.namespace=aceas,deployment.environment.name=uat,service.version=1.2.3 \
  -Dotel.exporter.otlp.endpoint=http://otel-collector:4318 \
  -Dotel.exporter.otlp.protocol=http/protobuf \
  -Dotel.traces.sampler=parentbased_traceidratio \
  -Dotel.traces.sampler.arg=0.10 \
  -jar app.jar
```

Equivalent environment variable style:

```bash
OTEL_SERVICE_NAME=case-service
OTEL_RESOURCE_ATTRIBUTES=service.namespace=aceas,deployment.environment.name=uat,service.version=1.2.3
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.10
```

Production notes:

1. Prefer env vars for container deployment.
2. Do not encode version into service name.
3. Use collector DNS, not vendor endpoint, if using collector.
4. Make sampler explicit.
5. Validate resource attributes in backend.
6. Ensure logs include trace/span IDs.

---

## 28. Minimal Manual Span Example

```java
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;

public final class CaseSubmissionService {

    private static final Tracer tracer = GlobalOpenTelemetry
            .getTracer("com.example.case.workflow", "1.0.0");

    public void submitCase(String caseType, String fromState, String toState) {
        Span span = tracer.spanBuilder("case.submit")
                .setAttribute("case.type", caseType)
                .setAttribute("case.state.from", fromState)
                .setAttribute("case.state.to", toState)
                .startSpan();

        try (Scope scope = span.makeCurrent()) {
            span.addEvent("case.validation.started");

            // validate
            // persist
            // publish message

            span.addEvent("case.transition.completed", Attributes.of(
                    AttributeKey.stringKey("outcome"), "success"
            ));
        } catch (Exception e) {
            span.recordException(e);
            span.setStatus(StatusCode.ERROR, e.getClass().getSimpleName());
            throw e;
        } finally {
            span.end();
        }
    }
}
```

Design notes:

1. Span name is low-cardinality: `case.submit`.
2. Attributes describe business operation.
3. Exception is recorded once.
4. `Scope` makes span current for nested operations.
5. `finally` ensures span is ended.

---

## 29. Minimal Manual Metric Example

```java
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.metrics.LongCounter;
import io.opentelemetry.api.metrics.Meter;

public final class CaseMetrics {

    private static final Meter meter = GlobalOpenTelemetry
            .getMeter("com.example.case.metrics");

    private static final LongCounter caseTransitions = meter
            .counterBuilder("case.transition.count")
            .setDescription("Number of case state transitions")
            .setUnit("{transition}")
            .build();

    public void recordTransition(String operation, String outcome) {
        caseTransitions.add(1, Attributes.builder()
                .put("case.operation", operation)
                .put("outcome", outcome)
                .build());
    }
}
```

Metric attribute caution:

```text
operation=submit      OK
outcome=success/error OK
case.id=CASE-123      usually bad for metrics
user.id=u-123         usually bad for metrics
```

---

## 30. Logs and Trace Correlation Example

With SLF4J:

```java
log.info("case submission completed caseType={} outcome={}", caseType, "success");
```

Better with structured logging if backend supports key-value:

```java
log.atInfo()
   .setMessage("case submission completed")
   .addKeyValue("event.name", "case.submission.completed")
   .addKeyValue("case.type", caseType)
   .addKeyValue("outcome", "success")
   .log();
```

The log pipeline should enrich/include:

```text
trace.id
span.id
service.name
service.version
deployment.environment.name
```

Important:

```text
The application should not manually invent trace.id.
Trace ID must come from OTel trace context.
```

---

## 31. Production Readiness Checklist

### 31.1 Resource Identity

- [ ] `service.name` is stable and unique.
- [ ] `service.version` is set.
- [ ] `deployment.environment.name` is set.
- [ ] Kubernetes attributes are enriched if running in Kubernetes.
- [ ] Instance identity is available.
- [ ] Version is not embedded in service name.

### 31.2 Context Propagation

- [ ] HTTP inbound continues incoming trace context.
- [ ] HTTP outbound injects trace context.
- [ ] Messaging producer injects context where appropriate.
- [ ] Messaging consumer extracts context where appropriate.
- [ ] Executor/async boundaries preserve context.
- [ ] Logs include trace/span IDs.

### 31.3 Traces

- [ ] Agent captures basic server/client/db spans.
- [ ] Manual spans exist for important domain workflows.
- [ ] Span names are low-cardinality.
- [ ] Attributes follow semantic conventions.
- [ ] Errors are recorded with exception type/status.
- [ ] Sampling policy is explicit.

### 31.4 Metrics

- [ ] RED metrics exist for HTTP/RPC endpoints.
- [ ] JVM metrics are available.
- [ ] DB pool metrics are available.
- [ ] External dependency metrics are available.
- [ ] Business metrics are bounded-cardinality.
- [ ] Histograms are configured for latency/SLO.

### 31.5 Logs

- [ ] Logs are structured.
- [ ] Logs include correlation IDs.
- [ ] Logs include trace/span IDs when available.
- [ ] PII and secrets are redacted.
- [ ] Error logs include exception class and stack trace where appropriate.
- [ ] Audit events are not dependent on trace sampling.

### 31.6 Collector

- [ ] Collector has memory limiter.
- [ ] Collector has batch processor.
- [ ] Collector failure behavior is understood.
- [ ] Pipeline per signal is configured.
- [ ] Telemetry drop metrics are monitored.
- [ ] Backend exporter errors are monitored.

### 31.7 Governance

- [ ] Attribute naming standard exists.
- [ ] Cardinality policy exists.
- [ ] Sampling policy exists.
- [ ] Retention policy exists.
- [ ] Sensitive-data policy exists.
- [ ] Observability review is part of PR/release review.

---

## 32. Troubleshooting OTel Itself

Observability pipeline can fail too.

### 32.1 No Traces

Possible causes:

1. Agent not attached.
2. Wrong `-javaagent` path.
3. Exporter endpoint wrong.
4. Collector not reachable.
5. Sampling set to zero.
6. Instrumentation disabled.
7. Backend query filters wrong environment/service.
8. Clock skew.

Diagnosis:

```bash
ps -ef | grep java
printenv | grep OTEL
curl http://otel-collector:4318
```

Check agent startup logs.

### 32.2 Missing Child Spans

Possible causes:

1. Library unsupported.
2. Async context lost.
3. Manual instrumentation forgot `makeCurrent()`.
4. Outbound client not instrumented.
5. Instrumentation disabled.

### 32.3 Broken Trace Across Services

Possible causes:

1. Header not propagated.
2. Gateway strips `traceparent`.
3. Message broker headers not copied.
4. Custom HTTP client not instrumented.
5. Trust boundary generating new root trace intentionally.

### 32.4 Too Much Telemetry

Possible causes:

1. Sampling too high.
2. Debug spans enabled.
3. High-cardinality attributes.
4. Every method manually spanned.
5. Logs exported twice.
6. Duplicate agent/starter instrumentation.

### 32.5 Duplicate Spans

Possible causes:

1. Java agent + manual instrumentation for same boundary.
2. Agent + Spring starter both instrumenting same library.
3. Multiple bridges/exporters.
4. Proxy/gateway creates spans plus app creates duplicate server spans.

### 32.6 Wrong Service Name

Possible causes:

1. Missing `OTEL_SERVICE_NAME`.
2. Default service name from jar/class.
3. Different env var per deployment.
4. Version included in service name.
5. Helm chart mismatch.

---

## 33. Top 1% Engineer Heuristics

### 33.1 Think in Questions Before Signals

Bad:

```text
Let's add logs everywhere.
```

Good:

```text
What production question are we trying to answer?
Which signal answers it best?
What context is required to correlate it?
What is the cost and risk?
```

### 33.2 Keep Technical and Domain Telemetry Separate but Correlated

Technical telemetry:

```text
HTTP, DB, queue, GC, thread, CPU, memory
```

Domain telemetry:

```text
case transition, approval workflow, SLA breach, compliance action
```

They should be correlated through trace/correlation IDs, not mixed randomly.

### 33.3 Design Low-Cardinality First

Start with stable dimensions.

Add high-cardinality values only where the backend/signal can handle them and the diagnostic value is clear.

### 33.4 Treat Observability as Runtime Contract

Observability fields are not casual strings.

They are contracts consumed by:

1. Dashboards.
2. Alerts.
3. Runbooks.
4. Incident responders.
5. SREs.
6. Security teams.
7. Audit/compliance support.

Breaking field names breaks production operations.

### 33.5 Do Not Outsource Understanding to Vendor Magic

APM tools can visualize data.

They cannot decide your domain semantics.

A top engineer designs the telemetry model intentionally.

---

## 34. Practical Lab 1 — Draw Your Service Telemetry Map

Pick one Java service.

Draw:

```text
Inbound request/message
  -> internal operations
  -> database calls
  -> external API calls
  -> outgoing messages
  -> logs
  -> metrics
  -> traces
```

For each boundary, answer:

1. Is there a span?
2. Is there a metric?
3. Is there a structured log?
4. Which IDs are propagated?
5. Which attributes are safe?
6. Which fields are high-cardinality?
7. Which signal is used for alerting?
8. Which signal is used for forensic analysis?

---

## 35. Practical Lab 2 — Define Resource Attributes

Create a resource attribute standard for your services.

Example:

```text
service.name=case-service
service.namespace=aceas
service.version=${APP_VERSION}
deployment.environment.name=${ENV}
k8s.namespace.name=${K8S_NAMESPACE}
k8s.pod.name=${HOSTNAME}
cloud.provider=aws
cloud.region=ap-southeast-1
```

Validate:

1. Service name stable?
2. Version separate?
3. Environment consistent?
4. Works in local/dev/uat/prod?
5. No request-specific data?

---

## 36. Practical Lab 3 — Identify Manual Instrumentation Gaps

Given auto agent baseline, list what it cannot know.

Example for case management:

```text
- case state transition
- approval escalation path
- SLA clock start/stop
- assignment rule selected
- idempotency conflict
- duplicate submission detection
- regulatory decision milestone
```

For each item, decide:

```text
Should this be a span attribute, span event, metric, log, or audit record?
```

---

## 37. Practical Lab 4 — Cardinality Review

Review these potential attributes:

```text
case.id
case.type
user.id
agency.id
http.route
url.full
error.type
exception.message
trace.id
request.id
sql.text
sql.operation
queue.name
message.id
```

Classify each:

```text
Safe for metric label?
Safe for span attribute?
Safe for log field?
Requires masking/redaction?
Requires sampling?
Should be forbidden?
```

Expected direction:

```text
http.route       -> metric/span/log safe
case.type        -> metric/span/log safe if bounded
error.type       -> metric/span/log safe if bounded
case.id          -> log/span with care, not metric
user.id          -> log/span with privacy care, not metric
url.full         -> risky; prefer route/path without secrets
exception.message-> log/span with care, not metric
trace.id         -> log field/native trace, not metric label
```

---

## 38. Mini Case Study — “We Have Traces, But Still Cannot Debug”

Situation:

```text
A Java service has OTel agent installed.
Traces show HTTP and JDBC spans.
During incident, users report submitted cases are stuck.
Dashboard shows normal HTTP latency.
DB spans look normal.
Logs are text-only and no trace ID.
Queue has backlog.
No business metric exists for case state transition.
```

Why debugging fails:

1. Agent sees technical calls but not domain workflow.
2. Queue backlog may be outside request trace if async context not propagated.
3. Logs cannot be linked to traces.
4. No metric tracks case stuck by state.
5. No state transition event logs.
6. HTTP latency is normal because request accepted but async processing failed later.

Fix:

1. Add workflow/job execution IDs.
2. Propagate trace/correlation context to messages.
3. Add spans for async consumer processing.
4. Add business metric:

```text
case_state_transition_total{from_state,to_state,outcome}
case_stuck_count{state,age_bucket}
```

5. Add structured logs:

```text
event.name=case.transition.started
event.name=case.transition.completed
event.name=case.transition.failed
```

6. Add DLQ/consumer lag metrics.
7. Add alert on stuck count and backlog, not only HTTP latency.

Lesson:

```text
Technical auto instrumentation is necessary but not sufficient for domain observability.
```

---

## 39. Summary

OpenTelemetry is a framework and ecosystem for producing, collecting, processing, and exporting telemetry data. For Java engineers, its value is not just in automatic traces, but in creating a consistent model across logs, metrics, and traces.

The core ideas:

1. Traces explain operation journey and latency breakdown.
2. Metrics explain aggregate behavior and support alerting/SLOs.
3. Logs explain discrete events and forensic detail.
4. Resource identifies who produced telemetry.
5. Instrumentation scope identifies what instrumentation produced telemetry.
6. Context connects distributed operations and signals.
7. Semantic conventions make telemetry queryable and reusable.
8. Collector centralizes telemetry processing and vendor decoupling.
9. Auto instrumentation gives baseline technical visibility.
10. Manual instrumentation adds domain meaning.
11. Sampling, cardinality, and privacy must be designed intentionally.
12. Observability is a runtime contract, not a dashboard decoration.

The most important mental model:

```text
OpenTelemetry does not automatically make a system observable.
It gives you standard tools and data models.
You still must design meaningful telemetry.
```

---

## 40. What Comes Next

Part berikutnya:

```text
Part 13 — OpenTelemetry Java Agent: Zero-Code Instrumentation for Java 8+
```

Kita akan masuk ke praktik production rollout:

1. Cara attach Java agent.
2. Konfigurasi environment variables.
3. Service/resource attributes.
4. Exporter endpoint.
5. Sampler.
6. Propagator.
7. Supported instrumentation.
8. Spring Boot/Tomcat/JDBC/HTTP client behavior.
9. Log correlation.
10. Metrics dari agent.
11. Suppression/tuning.
12. Rollout strategy di Kubernetes.
13. Failure modes dan troubleshooting.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./11-correlation-id-trace-id-request-id-idempotency-key-causality.md">⬅️ Part 11 — Correlation ID, Trace ID, Request ID, Idempotency Key, Causality</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./13-opentelemetry-java-agent-zero-code-instrumentation-java-8-plus.md">Part 13 — OpenTelemetry Java Agent: Zero-Code Instrumentation for Java 8+ ➡️</a>
</div>

# Part 13 — OpenTelemetry Java Agent: Zero-Code Instrumentation for Java 8+

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> Module: Observability with OpenTelemetry  
> Java range: Java 8 sampai Java 25  
> Fokus: OpenTelemetry Java Agent, zero-code instrumentation, rollout produksi, konfigurasi, failure mode, dan strategy integrasi dengan logging/tracing/metrics.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami cara kerja **OpenTelemetry Java Agent** secara mental model, bukan hanya menambahkan `-javaagent`.
2. Menentukan kapan memakai **zero-code instrumentation**, kapan memakai **manual instrumentation**, dan kapan menggabungkan keduanya.
3. Mengonfigurasi agent untuk Java 8 sampai Java 25 secara production-grade.
4. Mendesain rollout agent secara aman: local, DEV, UAT, canary, production.
5. Mengetahui signal apa saja yang otomatis tertangkap dan signal apa yang tetap perlu ditambahkan secara manual.
6. Mendiagnosis masalah umum: tidak ada trace, trace terputus, service name salah, duplicate spans, overhead tinggi, missing context, exporter gagal, collector tidak menerima data.
7. Menghubungkan Java agent dengan logging, MDC, trace ID, metrics, dan incident troubleshooting.
8. Membangun baseline configuration yang bisa dipakai untuk Spring Boot, servlet container, fat jar, VM, Docker, dan Kubernetes.

---

## 1. Posisi OpenTelemetry Java Agent dalam Arsitektur Observability

OpenTelemetry Java Agent adalah mekanisme **zero-code instrumentation**. Artinya, aplikasi Java dapat menghasilkan telemetry tanpa harus mengubah source code aplikasi terlebih dahulu.

Namun, “zero-code” tidak berarti “zero-design”. Agent hanya menjawab sebagian masalah:

- menangkap inbound HTTP request,
- menangkap outbound HTTP call,
- menangkap JDBC call,
- menangkap messaging operation,
- menangkap beberapa framework/library populer,
- mengisi trace context otomatis,
- mengirim telemetry ke collector/exporter.

Agent **tidak otomatis memahami domain bisnis**:

- case sedang berada di state apa,
- approval transition valid atau tidak,
- retry ini idempotent atau tidak,
- user action ini regulatory-significant atau tidak,
- batch ini partially completed atau logically failed,
- error ini expected business rejection atau technical failure.

Jadi posisi agent adalah:

```text
OpenTelemetry Java Agent
    = automatic boundary instrumentation
    = dependency call visibility
    = baseline distributed tracing
    = low-friction observability bootstrap

Manual instrumentation
    = business/domain meaning
    = custom spans/events/attributes
    = high-value diagnostic enrichment
    = workflow-aware causality
```

Top-tier engineer tidak melihat Java agent sebagai magic. Ia melihatnya sebagai **runtime evidence bootstrapper**.

---

## 2. Apa Sebenarnya Java Agent Itu?

Di JVM, Java agent adalah komponen yang dipasang melalui opsi:

```bash
-javaagent:/path/to/opentelemetry-javaagent.jar
```

Saat JVM startup, agent mendapat kesempatan untuk melakukan instrumentation pada bytecode class yang dimuat JVM.

Mental model sederhana:

```text
Application code
    |
    | class loading
    v
OpenTelemetry Java Agent intercepts known libraries/frameworks
    |
    | injects telemetry hooks
    v
Instrumented runtime behavior
    |
    | creates spans/metrics/log correlation data
    v
OpenTelemetry SDK inside agent
    |
    | exports via OTLP / configured exporter
    v
Collector / backend
```

Contoh library/framework yang biasanya dapat diinstrumentasi otomatis tergantung versi agent dan library:

- Servlet API / Tomcat / Jetty / Undertow,
- Spring Web MVC,
- Spring WebFlux,
- JAX-RS,
- JDBC,
- Hibernate,
- HikariCP,
- OkHttp,
- Apache HttpClient,
- Java HTTP Client,
- gRPC,
- Kafka,
- RabbitMQ,
- Redis clients tertentu,
- logging framework tertentu untuk log correlation.

Agent tidak mengubah source code repository. Namun ia tetap mengubah runtime behavior melalui bytecode instrumentation.

Karena itu, agent harus dianggap sebagai **runtime dependency** dengan risk management seperti dependency produksi lain.

---

## 3. Kenapa Java Agent Penting untuk Engineer Senior/Top 1%

Di sistem besar, observability sering gagal bukan karena tidak ada tool, tetapi karena instrumentasi tidak konsisten.

Masalah umum sebelum agent:

1. Setiap service membuat tracing sendiri-sendiri.
2. Nama span tidak konsisten.
3. Trace context hilang di HTTP client tertentu.
4. JDBC call tidak terlihat.
5. Queue producer/consumer tidak terhubung.
6. Logging punya correlation ID sendiri, tracing punya trace ID sendiri.
7. Tim sulit memulai karena manual instrumentation dianggap terlalu mahal.

Java agent memberi baseline yang seragam.

Tetapi nilai terbesar bukan “trace muncul di UI”. Nilai sebenarnya adalah:

```text
agent makes invisible boundaries visible
```

Boundary yang dimaksud:

- request masuk,
- call keluar,
- query database,
- message publish,
- message consume,
- job execution,
- framework handler,
- error propagation.

Ketika boundary terlihat, engineer dapat mulai bertanya:

- Apakah latency berasal dari aplikasi atau dependency?
- Apakah error terjadi sebelum atau sesudah DB call?
- Apakah retry membuat duplicate operation?
- Apakah queue consumer lambat karena processing atau downstream call?
- Apakah satu tenant/case/user/module saja yang terdampak?
- Apakah deploy baru mengubah shape trace?

---

## 4. Zero-Code Instrumentation Tidak Sama dengan Complete Observability

Kesalahan besar: memasang agent lalu merasa observability selesai.

Agent memberi:

```text
technical call graph
```

Tetapi sistem bisnis butuh:

```text
causal domain graph
```

Contoh trace otomatis:

```text
POST /api/cases/{id}/approve
  -> SELECT ... FROM CASE
  -> UPDATE CASE
  -> POST https://notification-service/send
```

Itu berguna, tetapi belum cukup.

Yang masih tidak diketahui:

- case sebelumnya state apa?
- transition dari state lama ke state baru valid atau tidak?
- approval dilakukan oleh role apa?
- rule mana yang dievaluasi?
- downstream notification mandatory atau best-effort?
- error notification harus rollback approval atau tidak?
- apakah request ini duplicate submit?
- idempotency key apa?

Maka span otomatis perlu diperkaya manual:

```text
case.workflow.transition
  attributes:
    case.id_hash = "..."
    case.type = "LICENCE_RENEWAL"
    from_state = "PENDING_REVIEW"
    to_state = "APPROVED"
    actor.role = "OFFICER"
    decision.outcome = "APPROVED"
    idempotency.key_hash = "..."
```

Prinsipnya:

```text
Use agent for infrastructure/framework visibility.
Use manual instrumentation for business meaning.
```

---

## 5. Agent vs SDK vs API vs Collector

Banyak engineer mencampuradukkan istilah ini.

### 5.1 OpenTelemetry API

API adalah interface yang digunakan kode aplikasi/library untuk membuat spans, metrics, logs.

Contoh konsep:

- `Tracer`,
- `Span`,
- `Meter`,
- `Context`.

API sebaiknya aman dipakai library karena API bisa menjadi no-op bila SDK tidak dipasang.

### 5.2 OpenTelemetry SDK

SDK adalah implementation yang memproses telemetry:

- sampling,
- span processor,
- metric reader,
- exporter,
- resource detection,
- batching.

### 5.3 OpenTelemetry Java Agent

Agent adalah runtime package yang:

- attach ke JVM,
- melakukan bytecode instrumentation,
- membawa konfigurasi SDK/exporter,
- mengirim data keluar.

### 5.4 OpenTelemetry Collector

Collector adalah proses terpisah yang menerima, memproses, dan mengekspor telemetry.

Collector biasanya berisi pipeline:

```text
receivers -> processors -> exporters
```

Contoh:

```text
application JVM
  -> OTLP exporter
  -> OpenTelemetry Collector
  -> observability backend
```

### 5.5 Hubungan Mereka

```text
Application code may use OTel API manually
        |
Java agent automatically instruments libraries
        |
Both produce telemetry into SDK runtime
        |
SDK exports OTLP
        |
Collector receives/processes/exports
        |
Backend stores/visualizes/query
```

---

## 6. Kapan Memakai Java Agent?

Gunakan Java agent ketika:

1. Kamu butuh visibility cepat tanpa refactor besar.
2. Banyak service Java dan ingin standardisasi baseline.
3. Kamu ingin trace untuk HTTP/JDBC/messaging secara otomatis.
4. Kamu ingin konsistensi propagasi trace context.
5. Kamu ingin observability rollout bertahap.
6. Kamu ingin mengurangi beban developer untuk instrumentation boilerplate.
7. Aplikasi memakai framework/library yang didukung agent.

Jangan mengandalkan agent saja ketika:

1. Flow bisnis kompleks.
2. State machine penting.
3. Regulatory/audit defensibility penting.
4. Kamu perlu domain attributes.
5. Kamu butuh custom event untuk lifecycle tertentu.
6. Aplikasi memakai library internal/custom yang tidak terinstrumentasi.
7. Async workflow memiliki causality yang tidak bisa ditebak agent.

Decision matrix:

| Situasi | Agent | Manual Instrumentation | Catatan |
|---|---:|---:|---|
| HTTP inbound/outbound umum | Ya | Opsional | Agent cukup sebagai baseline |
| JDBC query visibility | Ya | Kadang | Tambahkan manual untuk business transaction |
| Approval workflow | Tidak cukup | Ya | Agent tidak tahu state transition |
| Batch job chunk processing | Sebagian | Ya | Perlu job/chunk/item attributes |
| Messaging producer/consumer | Ya jika library supported | Ya untuk causality bisnis | Perlu message id, retry count, DLQ reason |
| Security/audit event | Tidak | Ya | Harus explicit dan controlled |
| Performance profiling | Tidak | Tidak | Gunakan JFR/profiler, bukan tracing saja |

---

## 7. Deployment Model

### 7.1 Local Development

Contoh local:

```bash
java \
  -javaagent:./opentelemetry-javaagent.jar \
  -Dotel.service.name=case-service-local \
  -Dotel.resource.attributes=deployment.environment=local,service.version=dev \
  -Dotel.exporter.otlp.endpoint=http://localhost:4318 \
  -Dotel.traces.exporter=otlp \
  -Dotel.metrics.exporter=otlp \
  -Dotel.logs.exporter=none \
  -jar app.jar
```

Catatan:

- Untuk local, logs exporter bisa dimatikan bila belum siap.
- Trace dapat dikirim ke collector lokal.
- Jangan memaksa semua developer setup backend kompleks jika goal hanya smoke test instrumentation.

### 7.2 Spring Boot Fat Jar

```bash
java \
  -javaagent:/opt/otel/opentelemetry-javaagent.jar \
  -Dotel.service.name=case-service \
  -Dotel.resource.attributes=deployment.environment=dev,service.version=1.4.2 \
  -Dotel.exporter.otlp.endpoint=http://otel-collector:4318 \
  -jar case-service.jar
```

### 7.3 Docker

```dockerfile
FROM eclipse-temurin:21-jre

WORKDIR /app
COPY app.jar /app/app.jar
COPY opentelemetry-javaagent.jar /otel/opentelemetry-javaagent.jar

ENV JAVA_TOOL_OPTIONS="-javaagent:/otel/opentelemetry-javaagent.jar"
ENV OTEL_SERVICE_NAME="case-service"
ENV OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-collector:4318"
ENV OTEL_TRACES_EXPORTER="otlp"
ENV OTEL_METRICS_EXPORTER="otlp"
ENV OTEL_LOGS_EXPORTER="none"

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Lebih fleksibel jika `JAVA_TOOL_OPTIONS` diinject dari deployment manifest, bukan baked ke image.

### 7.4 Kubernetes

Contoh environment-based config:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
spec:
  template:
    metadata:
      labels:
        app: case-service
    spec:
      containers:
        - name: case-service
          image: registry.example.com/case-service:1.4.2
          env:
            - name: JAVA_TOOL_OPTIONS
              value: "-javaagent:/otel/opentelemetry-javaagent.jar"
            - name: OTEL_SERVICE_NAME
              value: "case-service"
            - name: OTEL_RESOURCE_ATTRIBUTES
              value: "deployment.environment=uat,service.version=1.4.2,service.namespace=aceas"
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: "http://otel-collector.observability.svc.cluster.local:4318"
            - name: OTEL_TRACES_EXPORTER
              value: "otlp"
            - name: OTEL_METRICS_EXPORTER
              value: "otlp"
            - name: OTEL_LOGS_EXPORTER
              value: "none"
```

Catatan penting:

- Pastikan agent JAR tersedia di container path.
- Bisa memakai init container untuk mengambil agent.
- Bisa memakai operator auto-injection jika platform sudah mature.
- Untuk environment regulated, pin versi agent dan jangan auto-upgrade diam-diam.

---

## 8. Konfigurasi Dasar yang Wajib Dipahami

Konfigurasi dapat diberikan via:

1. system properties `-D...`,
2. environment variables `OTEL_...`,
3. configuration file,
4. agent-specific options,
5. declarative YAML configuration untuk kebutuhan kompleks.

Secara umum, environment variables lebih cocok untuk container/Kubernetes.

### 8.1 Service Name

```bash
OTEL_SERVICE_NAME=case-service
```

Service name adalah identitas paling penting.

Buruk:

```text
app
backend
java-service
spring-boot
```

Baik:

```text
case-service
application-management-service
notification-dispatcher
interface-connector
```

Rule:

- stabil antar deployment,
- tidak menyertakan version,
- tidak menyertakan pod name,
- tidak menyertakan environment,
- merepresentasikan logical service.

### 8.2 Resource Attributes

```bash
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=uat,service.version=1.4.2,service.namespace=aceas
```

Resource attributes menjawab:

```text
telemetry ini berasal dari service apa, versi apa, environment apa, namespace apa, runtime apa?
```

Contoh field berguna:

```text
service.name=case-service
service.namespace=aceas
service.version=1.4.2
deployment.environment=prod
cloud.provider=aws
cloud.platform=aws_eks
k8s.namespace.name=aceas-prod
k8s.cluster.name=prod-cluster
```

Jangan menaruh high-cardinality values di resource attributes:

- request id,
- user id,
- case id,
- session id,
- pod uid jika tidak benar-benar dibutuhkan backend.

### 8.3 OTLP Endpoint

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

Biasanya:

- `4317` untuk OTLP/gRPC,
- `4318` untuk OTLP/HTTP.

Pastikan protocol/exporter sesuai dengan endpoint collector.

### 8.4 Exporter Selection

```bash
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=none
```

Untuk rollout awal, sering lebih aman:

```text
traces: enabled
metrics: enabled jika backend siap
logs: disabled dulu jika logging pipeline sudah ada
```

Mengaktifkan OTel logs tanpa pipeline matang bisa menghasilkan duplicate log ingestion atau cost spike.

### 8.5 Propagators

```bash
OTEL_PROPAGATORS=tracecontext,baggage
```

Default modern biasanya mendukung W3C Trace Context. Untuk migrasi dari sistem lama, mungkin perlu propagator tambahan seperti B3 atau vendor-specific propagator.

Rule:

```text
Use W3C tracecontext as default standard.
Add legacy propagators only during migration/interoperability phase.
```

### 8.6 Sampling

Contoh always on:

```bash
OTEL_TRACES_SAMPLER=always_on
```

Contoh parent-based ratio:

```bash
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

Sampling harus disesuaikan dengan:

- traffic volume,
- cost,
- incident debugging needs,
- environment,
- criticality service.

Untuk DEV/UAT:

```text
always_on sering masuk akal
```

Untuk PROD high traffic:

```text
parentbased_traceidratio atau tail sampling via collector lebih realistis
```

### 8.7 Agent Debug

```bash
OTEL_JAVAAGENT_DEBUG=true
```

Gunakan hanya sementara. Output debug sangat verbose dan bisa mengganggu log pipeline.

---

## 9. Production Baseline Configuration

### 9.1 Minimal Safe Baseline

```bash
OTEL_SERVICE_NAME=case-service
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=prod,service.namespace=aceas,service.version=1.4.2
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.observability.svc.cluster.local:4318
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=none
OTEL_PROPAGATORS=tracecontext,baggage
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

### 9.2 DEV/UAT Baseline

```bash
OTEL_SERVICE_NAME=case-service
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=uat,service.namespace=aceas,service.version=1.4.2
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.observability.svc.cluster.local:4318
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=none
OTEL_PROPAGATORS=tracecontext,baggage
OTEL_TRACES_SAMPLER=always_on
```

### 9.3 Local Baseline

```bash
OTEL_SERVICE_NAME=case-service-local
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=local,service.namespace=aceas,service.version=dev
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=none
OTEL_LOGS_EXPORTER=none
OTEL_PROPAGATORS=tracecontext,baggage
OTEL_TRACES_SAMPLER=always_on
```

---

## 10. Resource Naming: Kesalahan yang Sering Mahal

Observability backend sangat bergantung pada resource identity.

Kesalahan umum:

```text
service.name = case-service-prod
service.name = case-service-1.4.2
service.name = case-service-pod-abc123
service.name = springboot
service.name = java
```

Akibatnya:

- dashboard pecah per versi/pod,
- service map kacau,
- alert rule sulit stabil,
- trend historis tidak bisa dibandingkan,
- cost naik karena cardinality.

Pattern yang benar:

```text
service.name = case-service
service.namespace = aceas
service.version = 1.4.2
deployment.environment = prod
k8s.namespace.name = aceas-prod
k8s.pod.name = case-service-abc123
```

`service.name` harus logical dan stabil.

---

## 11. Apa yang Otomatis Terlihat dari Agent?

Agent biasanya dapat membuat spans seperti:

```text
HTTP server span
HTTP client span
JDBC client span
messaging producer span
messaging consumer span
framework/internal spans tertentu
```

Contoh trace:

```text
POST /api/cases/{caseId}/approve
  -> SELECT aceas_case WHERE id = ?
  -> UPDATE aceas_case SET status = ?
  -> POST notification-service /send
```

Dari trace ini kamu dapat melihat:

- total latency request,
- latency DB,
- latency external call,
- error status,
- dependency call path,
- service-to-service relationship.

Tetapi kamu belum tentu melihat:

- rule bisnis yang gagal,
- state transition detail,
- approval reason,
- retry semantic,
- domain-specific outcome,
- tenant/case/module grouping jika tidak ditambahkan.

---

## 12. Span Naming dari Agent

Auto instrumentation biasanya membuat span name berbasis framework semantic convention.

Contoh:

```text
GET /api/cases/{id}
POST /api/cases/{id}/approve
SELECT aceas_case
POST
```

Masalah umum:

1. Route template tidak terdeteksi, sehingga span name menjadi high-cardinality:

```text
GET /api/cases/12345
GET /api/cases/12346
GET /api/cases/12347
```

Ini buruk.

Yang benar:

```text
GET /api/cases/{id}
```

2. JDBC span terlalu generic:

```text
SELECT
```

Ini normal untuk keamanan dan cardinality. Jangan memaksa raw SQL penuh ke attribute/span name.

3. Internal async operation tidak terlihat.

Solusi: manual span.

---

## 13. Attribute Discipline

OpenTelemetry attribute harus berguna, tetapi tidak menghancurkan cardinality.

### 13.1 Good Attributes

```text
http.request.method=POST
http.route=/api/cases/{id}/approve
http.response.status_code=200
db.system=oracle
db.operation=SELECT
server.address=notification-service
messaging.system=rabbitmq
messaging.operation=process
service.version=1.4.2
deployment.environment=prod
```

### 13.2 Dangerous Attributes

```text
user.email=person@example.com
access.token=...
full.request.body=...
full.sql.query=SELECT ... literal values ...
case.id=raw identifier if sensitive/high-cardinality
session.id=...
```

### 13.3 Safer Domain Attributes

```text
case.type=RENEWAL
case.status.from=PENDING_REVIEW
case.status.to=APPROVED
case.id_hash=sha256:...
actor.role=OFFICER
workflow.name=licence-renewal
operation.idempotent=true
```

Rule:

```text
Attribute should help grouping, filtering, or diagnosing.
It should not leak secrets or explode cardinality.
```

---

## 14. Logs Integration

OpenTelemetry Java Agent dapat berhubungan dengan logging dalam beberapa cara tergantung konfigurasi dan framework:

1. Trace context injection ke MDC/ThreadContext.
2. Capture log events sebagai OTel log signal.
3. Correlating logs with traces in backend.

Untuk banyak organisasi, pendekatan awal yang aman:

```text
Keep existing log pipeline.
Inject trace_id/span_id into structured logs.
Do not export logs via OTel until pipeline/cost/schema is ready.
```

Contoh Logback pattern:

```xml
<pattern>%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level [%thread] trace_id=%X{trace_id} span_id=%X{span_id} logger=%logger{36} - %msg%n</pattern>
```

Contoh Log4j2 pattern:

```xml
<PatternLayout pattern="%d{ISO8601} %-5p [%t] trace_id=%X{trace_id} span_id=%X{span_id} %c - %m%n"/>
```

Untuk JSON structured logging, trace fields harus menjadi field eksplisit:

```json
{
  "timestamp": "2026-06-18T12:00:00.000+07:00",
  "severity": "INFO",
  "service.name": "case-service",
  "trace.id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span.id": "00f067aa0ba902b7",
  "event.name": "case.approval.completed",
  "case.type": "RENEWAL",
  "outcome": "success"
}
```

---

## 15. Metrics Integration

Agent dapat menghasilkan metrics runtime/framework tergantung versi dan konfigurasi.

Metrics yang umum penting:

- JVM memory,
- GC,
- thread count,
- class loading,
- CPU/process,
- HTTP server duration,
- HTTP client duration,
- DB client duration,
- connection pool metrics jika instrumentation tersedia,
- messaging metrics jika tersedia.

Namun jangan langsung menganggap semua metrics perlu alert.

Production metric maturity:

```text
Phase 1: collect baseline
Phase 2: dashboard useful service health
Phase 3: define SLI/SLO
Phase 4: alert only on actionable symptoms
Phase 5: correlate metrics with traces/logs/profiles
```

---

## 16. Traces Integration

Traces dari agent memberi visibility utama.

Good trace menjawab:

1. Request masuk dari mana?
2. Service apa saja dilewati?
3. Dependency mana yang lambat?
4. Error terjadi di span mana?
5. Retry terjadi berapa kali?
6. Apakah downstream call masih dalam trace yang sama?
7. Apakah async consumer punya link ke producer?

Trace yang buruk biasanya:

- span terlalu banyak,
- span terlalu sedikit,
- span name high-cardinality,
- context terputus,
- service.name salah,
- error tidak direkam,
- sampling menyembunyikan issue penting.

---

## 17. Sampling Strategy

Sampling adalah keputusan evidence economics.

Tidak semua trace harus disimpan, tetapi trace yang hilang tidak bisa dianalisis.

### 17.1 Head Sampling

Head sampling memutuskan saat trace dimulai.

Kelebihan:

- murah,
- mudah,
- overhead lebih terkendali.

Kekurangan:

- trace error/slow bisa tidak tersimpan jika keburu tidak sampled.

### 17.2 Parent-Based Sampling

Jika upstream sampled, downstream mengikuti.

Ini penting agar trace tidak terpotong.

### 17.3 Tail Sampling

Tail sampling memutuskan setelah melihat trace lengkap, biasanya di collector/backend.

Kelebihan:

- bisa simpan semua error,
- bisa simpan slow trace,
- bisa simpan trace tenant/service tertentu.

Kekurangan:

- butuh collector/backend capability,
- memory/buffer lebih besar,
- konfigurasi lebih kompleks.

### 17.4 Practical Strategy

DEV/UAT:

```text
always_on
```

PROD medium traffic:

```text
parentbased_traceidratio 0.1 or 0.2
```

PROD high traffic dengan collector matang:

```text
head sample moderate + tail sampling important traces
```

Critical incident temporary mode:

```text
increase sampling for affected service/window only
```

Jangan menaikkan sampling global tanpa cost/risk review.

---

## 18. Rollout Strategy Produksi

Java agent harus di-rollout seperti perubahan runtime.

### 18.1 Phase 0 — Inventory

Kumpulkan:

- Java version,
- framework version,
- app server/container,
- startup command,
- deployment model,
- existing logging framework,
- existing metrics/tracing,
- traffic level,
- latency budget,
- memory headroom,
- CPU headroom.

### 18.2 Phase 1 — Local Smoke Test

Validasi:

- app bisa start,
- agent log tidak error fatal,
- trace muncul,
- service.name benar,
- endpoint collector benar,
- shutdown normal.

### 18.3 Phase 2 — DEV

Validasi:

- inbound trace,
- outbound trace,
- DB span,
- log correlation,
- no duplicate logging,
- no major latency overhead,
- no memory abnormality.

### 18.4 Phase 3 — UAT Load-Like Test

Validasi:

- trace volume,
- backend ingestion capacity,
- collector CPU/memory,
- app CPU/memory,
- p95/p99 latency,
- sampling behavior,
- route/span name cardinality.

### 18.5 Phase 4 — Production Canary

Rollout:

```text
1 pod / 1 instance only
observe 30–60 minutes or enough traffic window
compare with non-agent instances
```

Compare:

- CPU,
- heap,
- GC,
- latency,
- error rate,
- startup time,
- log volume,
- collector ingestion.

### 18.6 Phase 5 — Gradual Rollout

Increase:

```text
10% -> 25% -> 50% -> 100%
```

Or per service criticality.

### 18.7 Phase 6 — Governance

After rollout:

- pin agent version,
- document config,
- monitor agent release notes,
- create rollback plan,
- define owner,
- define sampling policy,
- define instrumentation review.

---

## 19. Rollback Plan

A good agent rollout always has rollback.

Rollback options:

1. Remove `-javaagent` from startup.
2. Set exporters to `none` temporarily.
3. Disable specific instrumentation.
4. Reduce sampling.
5. Route to local/noop collector during emergency.

Emergency disable example:

```bash
OTEL_TRACES_EXPORTER=none
OTEL_METRICS_EXPORTER=none
OTEL_LOGS_EXPORTER=none
```

But note: disabling exporters may not remove all instrumentation overhead. Full rollback is removing agent from JVM startup.

---

## 20. Disabling Specific Instrumentation

Kadang satu instrumentation bermasalah.

Contoh alasan:

- library version edge case,
- duplicate spans,
- performance issue,
- context propagation conflict,
- unsupported custom wrapper.

Pattern konfigurasi biasanya berbentuk:

```bash
OTEL_INSTRUMENTATION_<NAME>_ENABLED=false
```

Nama detail bergantung instrumentation. Selalu cek dokumentasi versi agent yang dipakai.

Prinsip:

```text
Do not disable globally before identifying offender.
Disable the smallest problematic instrumentation.
```

---

## 21. Java 8 sampai Java 25 Considerations

### 21.1 Java 8

Karakteristik:

- banyak legacy framework,
- older servlet/app server,
- classloader lebih rawan,
- TLS/cipher/runtime issue lebih mungkin,
- container awareness lebih terbatas dibanding JDK modern.

Perhatian:

- agent support Java 8+, tetapi library/framework version tetap perlu dicek,
- jangan pakai syntax/config yang mengasumsikan Java modern,
- perhatikan PermGen tidak relevan untuk Java 8, tetapi Metaspace ada.

### 21.2 Java 11/17

Karakteristik:

- LTS modern baseline,
- container awareness lebih baik,
- JPMS ada sejak Java 9,
- reflective access warning bisa muncul untuk tooling tertentu.

Perhatian:

- pastikan agent kompatibel dengan module access,
- cek illegal reflective access/log noise.

### 21.3 Java 21

Karakteristik:

- virtual threads stable,
- banyak Spring Boot modern mulai mendukung Java 21,
- observability context perlu dipikir ulang untuk thread model.

Perhatian:

- auto instrumentation tidak berarti semua virtual-thread async boundary otomatis meaningful,
- MDC/ThreadLocal propagation tetap perlu discipline,
- profiling dan thread dump interpretation berubah.

### 21.4 Java 25

Karakteristik:

- modern runtime dengan fitur platform terbaru,
- `ScopedValue` final di Java 25,
- observability context dapat bergerak ke model immutable scoped context untuk code manual tertentu.

Perhatian:

- agent masih bekerja sebagai bytecode instrumentation,
- context strategy aplikasi bisa menggabungkan OTel Context + explicit domain context + ScopedValue di kode modern,
- tetap uji compatibility agent release terhadap Java versi baru.

---

## 22. Spring Boot Integration Notes

Untuk Spring Boot, agent sering memberikan visibility besar langsung:

- HTTP server spans,
- RestTemplate/WebClient/HTTP client spans,
- JDBC spans,
- Hibernate/JPA spans,
- logging correlation,
- Micrometer bridge tergantung setup.

Tetapi Spring Boot juga punya observability ecosystem sendiri, terutama pada versi modern.

Decision:

```text
Use Java agent for broad automatic instrumentation.
Use Spring/Micrometer/OTel manual instrumentation where domain or custom metrics needed.
Avoid duplicate instrumentation from overlapping setup.
```

Risiko duplicate:

- agent instrumentation aktif,
- framework instrumentation manual juga aktif,
- library wrapper membuat span sendiri,
- logs diekspor dari dua pipeline.

Checklist Spring Boot:

1. Apakah app memakai Logback default atau Log4j2?
2. Apakah trace ID muncul di logs?
3. Apakah Actuator metrics juga dikirim ke backend lain?
4. Apakah ada duplicate HTTP/JDBC spans?
5. Apakah route template terbaca benar?
6. Apakah exception tercatat pada server span?
7. Apakah async executor kehilangan context?

---

## 23. Servlet Container dan App Server Notes

Untuk WAR deployment di Tomcat/JBoss/WebLogic/WebSphere/Payara, problem utamanya adalah classloader dan startup ownership.

Pertanyaan penting:

1. Agent dipasang di JVM app server atau aplikasi?
2. Semua WAR di JVM yang sama akan terinstrumentasi?
3. Apakah service.name bisa berbeda per application?
4. Apakah collector endpoint sama untuk semua app?
5. Apakah ada library conflict di shared classloader?

Untuk multi-app server dalam satu JVM, service identity bisa rumit. Jika memungkinkan, modernisasi ke one service per JVM/container membuat observability jauh lebih bersih.

---

## 24. Kubernetes Operator Auto-Injection

OpenTelemetry Operator dapat melakukan auto-injection agent di Kubernetes.

Keuntungan:

- tidak perlu rebuild image,
- konfigurasi centralized,
- rollout lebih konsisten,
- cocok untuk platform team.

Risiko:

- perubahan agent bisa masuk ke banyak service sekaligus,
- debugging lebih abstrak,
- governance harus kuat,
- regulated environment mungkin butuh explicit approval.

Prinsip:

```text
Operator injection is a platform capability.
Do not use it as uncontrolled magic mutation.
```

Gunakan jika:

- platform observability sudah mature,
- version pinning jelas,
- namespace/service opt-in jelas,
- rollback cepat,
- change management ada.

---

## 25. Security and Compliance Considerations

Agent melihat banyak boundary runtime. Maka security penting.

### 25.1 Jangan Leak Data Sensitif

Hindari:

- raw request body,
- raw response body,
- authorization header,
- cookie,
- token,
- password,
- API key,
- personal identifier,
- full SQL literal values.

### 25.2 Header Capture

Beberapa agent/instrumentation dapat dikonfigurasi untuk capture HTTP headers.

Default policy:

```text
Do not capture arbitrary headers.
Allowlist only safe headers.
```

Contoh safe-ish:

```text
x-request-id
x-correlation-id
traceparent
```

Contoh unsafe:

```text
authorization
cookie
set-cookie
x-api-key
```

### 25.3 Attribute Redaction

Jika menambahkan manual attributes, gunakan naming dan redaction policy.

Buruk:

```text
user.email=fajar@example.com
nric=S1234567A
access_token=...
```

Lebih aman:

```text
user.id_hash=sha256:...
actor.role=OFFICER
tenant.code=CEA
```

### 25.4 Collector Boundary

Collector harus dianggap sensitive component karena menerima telemetry yang mungkin berisi metadata penting.

Pastikan:

- network policy,
- TLS bila lintas boundary,
- authentication bila perlu,
- access control backend,
- retention policy,
- data residency policy.

---

## 26. Performance and Overhead Model

Agent menambah overhead karena:

1. bytecode instrumentation,
2. context propagation,
3. span creation,
4. attribute collection,
5. sampling decision,
6. batching/exporting,
7. metrics collection,
8. log correlation/exporting.

Overhead biasanya manageable, tetapi tidak boleh diasumsikan nol.

### 26.1 Cost Drivers

- high request rate,
- high span count per request,
- high attribute count,
- expensive attribute values,
- high sampling ratio,
- exporting logs via OTel,
- collector/network latency,
- instrumentasi library yang sangat hot path,
- synchronous exporter misconfiguration,
- debug logging agent aktif.

### 26.2 Overhead Budget

Sebelum production:

```text
Measure before/after:
- startup time
- CPU
- heap usage
- allocation rate
- GC pause
- p95/p99 latency
- throughput
- error rate
```

Jangan hanya melihat average latency.

### 26.3 Span Count Budget

Setiap request tidak boleh menghasilkan span tak terkendali.

Example dangerous trace:

```text
GET /search
  -> 500 Redis spans
  -> 300 JDBC spans
  -> 200 HTTP spans
```

Itu mungkin benar secara teknis, tapi mahal dan sulit dibaca.

Solusi:

- sampling,
- disable noisy instrumentation,
- aggregate manually where appropriate,
- fix underlying N+1/query explosion,
- instrument business operation at useful granularity.

---

## 27. Collector as Control Plane

Untuk production, jangan kirim langsung dari setiap service ke vendor backend jika bisa dihindari.

Lebih baik:

```text
service -> local/cluster collector -> backend
```

Collector memberi:

- batching,
- retry,
- tail sampling,
- filtering,
- enrichment,
- routing,
- vendor isolation,
- traffic control.

Namun collector juga bisa menjadi bottleneck.

Monitor collector:

- receiver accepted/refused spans,
- exporter queue size,
- dropped spans,
- retry count,
- memory limiter events,
- CPU/memory usage,
- backend export errors.

Collector failure mode:

```text
Application seems fine, but observability goes dark.
```

Karena itu collector harus punya observability juga.

---

## 28. Troubleshooting: Trace Tidak Muncul

Diagnosis flow:

### Step 1 — Agent Loaded?

Cek startup logs.

Apakah ada indikasi agent aktif?

Jika tidak:

- `-javaagent` path salah,
- `JAVA_TOOL_OPTIONS` tidak terbaca,
- container tidak punya file agent,
- startup script override,
- app server JVM arg salah lokasi.

### Step 2 — Exporter Enabled?

Cek:

```bash
OTEL_TRACES_EXPORTER
OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_EXPORTER_OTLP_PROTOCOL
```

### Step 3 — Collector Reachable?

Dari pod/VM:

```bash
curl -v http://otel-collector:4318/
```

Untuk gRPC, gunakan tooling yang sesuai.

### Step 4 — Sampling Dropping?

Set sementara di DEV:

```bash
OTEL_TRACES_SAMPLER=always_on
```

### Step 5 — Backend Query Salah?

Cek:

- service name,
- environment,
- time range,
- namespace,
- trace ingestion delay.

### Step 6 — Instrumentation Supported?

Jika request path tidak melalui framework yang didukung, agent mungkin tidak membuat span.

### Step 7 — Debug Temporarily

```bash
OTEL_JAVAAGENT_DEBUG=true
```

Matikan kembali setelah investigasi.

---

## 29. Troubleshooting: Context Terputus

Gejala:

```text
frontend trace -> service A
service A -> service B appears as separate trace
```

Kemungkinan:

1. HTTP client tidak terinstrumentasi.
2. Header propagation dihapus gateway/proxy.
3. Service B tidak menerima propagator yang sama.
4. Custom client tidak memakai standard library.
5. Async boundary kehilangan context.
6. Manual thread creation tidak propagate context.
7. Messaging headers tidak diteruskan.

Diagnosis:

- cek `traceparent` outbound dari service A,
- cek `traceparent` inbound ke service B,
- cek propagator config,
- cek library support,
- cek gateway/header allowlist,
- cek custom wrapper.

Rule:

```text
A broken trace is usually a broken context boundary.
Find the boundary where traceparent disappears.
```

---

## 30. Troubleshooting: Duplicate Spans

Gejala:

```text
HTTP request muncul dua kali
JDBC query span duplicate
client span nested aneh
```

Kemungkinan:

1. Agent + manual instrumentation overlap.
2. Agent + framework starter overlap.
3. Agent + vendor agent overlap.
4. Library wrapped dua kali.
5. Bridge/exporter ganda.

Solusi:

- disable salah satu instrumentation,
- jangan menjalankan dua tracing agents kecuali sangat paham interop-nya,
- cek dependency tree,
- cek auto-config Spring/Micrometer,
- cek collector duplicate routing.

---

## 31. Troubleshooting: Service Map Kacau

Gejala:

- service muncul sebagai `unknown_service:java`,
- satu service muncul banyak nama,
- environment bercampur,
- versi dianggap service berbeda.

Diagnosis:

- `OTEL_SERVICE_NAME` kosong/salah,
- `service.name` di resource attributes override tidak konsisten,
- config per pod berbeda,
- deployment template memakai pod name untuk service name,
- multiple app dalam satu JVM.

Fix:

```bash
OTEL_SERVICE_NAME=case-service
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=prod,service.namespace=aceas,service.version=1.4.2
```

---

## 32. Troubleshooting: Overhead Tinggi

Gejala:

- CPU naik setelah agent,
- latency p99 naik,
- allocation rate naik,
- GC lebih sering,
- collector/backpressure error,
- log volume naik.

Diagnosis:

1. Bandingkan instance dengan dan tanpa agent.
2. Cek sampling ratio.
3. Cek span count per request.
4. Cek high-volume instrumentation.
5. Cek logs exporter.
6. Cek agent debug aktif.
7. Cek collector latency/exporter queue.
8. Profiling dengan JFR/async-profiler jika perlu.

Mitigasi:

- reduce sampling,
- disable noisy instrumentation,
- disable logs exporter,
- tune collector,
- add collector capacity,
- remove high-cardinality attributes,
- rollback agent jika berdampak produksi.

---

## 33. Troubleshooting: Logs Tidak Punya Trace ID

Kemungkinan:

1. Log correlation instrumentation belum aktif/supported.
2. Pattern/layout tidak mencetak MDC field.
3. Logging backend tidak kompatibel.
4. Log terjadi di thread yang tidak punya active span.
5. Async executor kehilangan context.
6. Log terjadi sebelum request span dibuat atau setelah span closed.

Diagnosis:

- cek apakah trace muncul di backend,
- cek MDC keys yang dipakai (`trace_id`, `span_id`, atau variant backend),
- cek pattern JSON/text,
- cek async boundary,
- cek logs inside request handler vs background thread.

Prinsip:

```text
Trace-log correlation requires both active context and logging layout support.
```

---

## 34. Agent Configuration Anti-Patterns

### Anti-pattern 1 — Service Name Mengandung Environment

Buruk:

```text
case-service-prod
case-service-uat
```

Baik:

```text
service.name=case-service
deployment.environment=prod
```

### Anti-pattern 2 — Always On Sampling di High-Traffic Production

Buruk jika traffic besar:

```text
OTEL_TRACES_SAMPLER=always_on
```

Baik:

```text
parentbased_traceidratio + tail sampling for errors/slow traces
```

### Anti-pattern 3 — Capture Semua Header

Buruk:

```text
capture all request headers
```

Baik:

```text
allowlist safe correlation headers only
```

### Anti-pattern 4 — Mengaktifkan OTel Logs Tanpa Strategy

Akibat:

- duplicate log ingestion,
- cost spike,
- schema mismatch,
- missing redaction.

### Anti-pattern 5 — Auto-Updating Agent

Buruk:

```text
always download latest agent at container startup
```

Baik:

```text
pin version, test, rollout, rollback
```

### Anti-pattern 6 — Agent Dipasang Tanpa Ownership

Observability harus punya owner:

- platform owner,
- service owner,
- dashboard owner,
- alert owner,
- cost owner.

---

## 35. Combining Agent with Manual Instrumentation

Agent baseline:

```text
HTTP/JDBC/messaging spans
```

Manual enrichment:

```text
business span/event/attribute
```

Example:

```java
Span span = tracer.spanBuilder("case.workflow.transition")
    .setAttribute("workflow.name", "licence-renewal")
    .setAttribute("case.type", "RENEWAL")
    .setAttribute("case.status.from", fromState)
    .setAttribute("case.status.to", toState)
    .setAttribute("actor.role", actorRole)
    .startSpan();

try (Scope scope = span.makeCurrent()) {
    transitionService.transition(command);
    span.setAttribute("outcome", "success");
} catch (BusinessRuleException e) {
    span.setAttribute("outcome", "rejected");
    span.setAttribute("error.type", e.getClass().getSimpleName());
    span.addEvent("business_rule_rejected");
    throw e;
} catch (Exception e) {
    span.recordException(e);
    span.setStatus(StatusCode.ERROR);
    throw e;
} finally {
    span.end();
}
```

Rule:

```text
Manual spans should represent meaningful domain or architectural boundaries.
Do not wrap every small method.
```

---

## 36. Practical Lab 1 — Run Java Agent Locally

### Goal

Menjalankan Spring Boot/simple Java app dengan Java agent dan mengirim trace ke collector lokal.

### Steps

1. Download/pin `opentelemetry-javaagent.jar`.
2. Jalankan collector lokal.
3. Start aplikasi:

```bash
java \
  -javaagent:./opentelemetry-javaagent.jar \
  -Dotel.service.name=demo-case-service \
  -Dotel.resource.attributes=deployment.environment=local,service.version=dev \
  -Dotel.exporter.otlp.endpoint=http://localhost:4318 \
  -Dotel.traces.exporter=otlp \
  -Dotel.metrics.exporter=none \
  -Dotel.logs.exporter=none \
  -jar target/demo.jar
```

4. Hit endpoint:

```bash
curl http://localhost:8080/api/cases/123
```

5. Verifikasi:

- trace muncul,
- service name benar,
- route name tidak high-cardinality,
- DB span muncul jika ada DB call,
- error span muncul saat endpoint error.

---

## 37. Practical Lab 2 — Add Trace ID to Logs

### Goal

Log aplikasi memiliki `trace.id` dan `span.id`.

### Logback Example

```xml
<configuration>
  <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
    <encoder>
      <pattern>%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level service=case-service trace_id=%X{trace_id} span_id=%X{span_id} thread=%thread logger=%logger{36} - %msg%n</pattern>
    </encoder>
  </appender>

  <root level="INFO">
    <appender-ref ref="STDOUT" />
  </root>
</configuration>
```

### Test

1. Jalankan dengan agent.
2. Hit endpoint.
3. Pastikan log dalam request memiliki trace/span ID.
4. Bandingkan dengan log startup/background yang mungkin tidak punya active span.

---

## 38. Practical Lab 3 — Detect Context Break

### Scenario

Service A call Service B, tetapi trace terpisah.

### Investigation

1. Capture outbound headers dari Service A.
2. Pastikan ada:

```text
traceparent: 00-<trace-id>-<span-id>-<flags>
```

3. Capture inbound headers di Service B.
4. Jika hilang, cek gateway/proxy.
5. Jika ada tapi trace tetap terpisah, cek propagator config.
6. Jika custom HTTP client, cek supported instrumentation.

### Expected Learning

Context break selalu terjadi di boundary. Jangan menebak dari UI trace saja; cari header/context di boundary.

---

## 39. Practical Lab 4 — Canary Overhead Measurement

### Goal

Membandingkan service dengan dan tanpa agent.

### Metrics

Ambil sebelum/sesudah:

- CPU,
- heap,
- GC count/pause,
- p50/p95/p99 latency,
- throughput,
- error rate,
- span/sec,
- collector accepted/dropped spans.

### Decision

Agent boleh lanjut rollout jika:

- error rate tidak naik,
- p99 tidak memburuk signifikan,
- CPU/memory masih dalam budget,
- collector tidak drop data,
- trace volume sesuai estimasi,
- logs tidak duplicate/cost spike.

---

## 40. Practical Lab 5 — Disable Noisy Instrumentation

### Scenario

Satu library menghasilkan terlalu banyak span.

### Steps

1. Identifikasi span name/instrumentation source.
2. Cek dokumentasi instrumentation name untuk agent version.
3. Disable instrumentation paling kecil.
4. Deploy ke DEV.
5. Bandingkan span volume dan diagnostic value.
6. Jangan disable seluruh tracing kecuali emergency.

---

## 41. Production Readiness Checklist

### Agent Binary

- [ ] Agent version dipin.
- [ ] Source download trusted.
- [ ] Checksum/verifikasi tersedia jika proses mengharuskan.
- [ ] Tidak auto-download latest di production startup.
- [ ] Release notes dibaca sebelum upgrade.

### Startup

- [ ] `-javaagent` aktif di environment target.
- [ ] Startup app tidak gagal.
- [ ] Agent log normal.
- [ ] Rollback startup jelas.

### Resource Identity

- [ ] `OTEL_SERVICE_NAME` stabil.
- [ ] `service.version` benar.
- [ ] `deployment.environment` benar.
- [ ] Namespace/service grouping benar.

### Exporter

- [ ] OTLP endpoint benar.
- [ ] Protocol/port sesuai.
- [ ] Collector reachable.
- [ ] Retry/backpressure dipahami.

### Sampling

- [ ] DEV/UAT sampling sesuai.
- [ ] PROD sampling sesuai cost/traffic.
- [ ] Parent-based behavior dipahami.
- [ ] Tail sampling dipertimbangkan jika perlu.

### Logs

- [ ] Trace ID/span ID muncul di logs.
- [ ] Logs exporter tidak duplicate kecuali disengaja.
- [ ] Sensitive fields tidak bocor.
- [ ] Log schema tetap valid.

### Security

- [ ] Header capture allowlist.
- [ ] Body capture disabled kecuali sangat controlled.
- [ ] Secrets tidak masuk attributes/logs.
- [ ] Collector/backend access controlled.

### Performance

- [ ] CPU before/after dibandingkan.
- [ ] Heap/GC before/after dibandingkan.
- [ ] p95/p99 latency dibandingkan.
- [ ] Span volume masuk budget.
- [ ] Collector tidak drop data.

### Governance

- [ ] Owner jelas.
- [ ] Upgrade policy jelas.
- [ ] Rollback policy jelas.
- [ ] Dashboard/alert updated.
- [ ] Service onboarding template tersedia.

---

## 42. Mini Case Study — Agent Rollout Membuat Trace Ada, Tetapi Incident Tetap Sulit

### Situation

Tim memasang OpenTelemetry Java Agent ke `case-service`, `notification-service`, dan `document-service`.

Trace sudah muncul.

Saat UAT, user melaporkan approval kadang lambat dan kadang notification tidak terkirim.

Trace menunjukkan:

```text
POST /api/cases/{id}/approve
  -> SELECT CASE
  -> UPDATE CASE
  -> POST notification-service /send
       -> POST document-service /render
```

Kadang `document-service /render` lambat.

### Initial Mistake

Tim menyimpulkan:

```text
document-service lambat, jadi root cause ada di document-service
```

Tetapi setelah dicek:

- hanya case type tertentu yang lambat,
- hanya ketika template tertentu dipakai,
- notification retry kadang duplicate,
- approval sudah committed sebelum notification selesai,
- user melihat status approved tetapi email belum terkirim.

### Missing Evidence

Agent memberi technical trace, tetapi tidak memberi:

- `case.type`,
- `template.code`,
- `workflow.transition`,
- `notification.mode`,
- `retry.count`,
- `idempotency.key`,
- `post_commit_dispatch=true/false`.

### Correct Fix

Tambahkan manual span/event:

```text
case.approval.transition
notification.dispatch.requested
template.render.requested
notification.retry.scheduled
```

Tambahkan attributes aman:

```text
case.type=RENEWAL
template.code=APPROVAL_NOTICE_V3
notification.channel=EMAIL
retry.count=1
operation.idempotent=true
```

### Lesson

```text
Agent shows where time went.
Manual instrumentation explains why the system chose that path.
```

---

## 43. Mental Model Ringkas

OpenTelemetry Java Agent adalah:

```text
runtime visibility bootstrap
```

Bukan:

```text
complete observability solution
```

Agent paling kuat untuk:

- HTTP boundary,
- DB boundary,
- messaging boundary,
- dependency map,
- baseline traces,
- trace-log correlation.

Agent paling lemah untuk:

- business semantics,
- workflow state,
- regulatory meaning,
- idempotency semantics,
- custom async causality,
- incident reasoning tanpa domain context.

Top-tier usage pattern:

```text
1. Install agent for consistent automatic visibility.
2. Standardize service/resource identity.
3. Correlate logs with trace/span IDs.
4. Control sampling and cardinality.
5. Add manual domain spans/events where value is high.
6. Roll out gradually and measure overhead.
7. Treat agent and collector as production runtime components.
```

---

## 44. Output Akhir Bagian Ini

Setelah bagian ini, kamu harus bisa menghasilkan artefak berikut:

1. Baseline `JAVA_TOOL_OPTIONS` untuk Java agent.
2. Environment variable config untuk local/DEV/UAT/PROD.
3. Service naming standard.
4. Resource attributes standard.
5. Sampling policy awal.
6. Logging correlation config.
7. Canary rollout checklist.
8. Rollback plan.
9. Troubleshooting flow untuk:
   - trace tidak muncul,
   - context terputus,
   - duplicate spans,
   - overhead tinggi,
   - service map kacau,
   - logs tanpa trace ID.
10. Decision rule kapan menambahkan manual instrumentation.

---

## 45. Latihan Mandiri

### Exercise 1 — Service Identity Review

Ambil 5 service Java di sistemmu. Tentukan:

```text
service.name
service.namespace
service.version
deployment.environment
```

Pastikan `service.name` tidak mengandung environment, version, pod name, hostname, atau random suffix.

### Exercise 2 — Trace Boundary Map

Untuk satu flow penting, gambar boundary:

```text
browser -> API gateway -> service A -> DB -> service B -> queue -> worker -> external API
```

Tandai boundary yang kemungkinan otomatis terinstrumentasi agent dan boundary yang perlu manual instrumentation.

### Exercise 3 — Sampling Decision

Untuk service dengan 500 RPS, estimasi:

- spans/request,
- spans/sec,
- trace volume/day,
- sampling ratio yang realistis.

### Exercise 4 — Context Break Drill

Simulasikan service A call service B tanpa meneruskan `traceparent`. Lihat bagaimana trace terpecah. Lalu perbaiki.

### Exercise 5 — Manual Enrichment

Pilih satu domain operation dan tambahkan manual span dengan attributes aman, low-cardinality, dan berguna.

---

## 46. Referensi Resmi yang Disarankan

Pelajari langsung dari sumber resmi berikut ketika implementasi:

1. OpenTelemetry Java Agent documentation.
2. OpenTelemetry Java zero-code instrumentation documentation.
3. OpenTelemetry Java agent configuration documentation.
4. OpenTelemetry SDK environment variable specification.
5. OpenTelemetry Java supported libraries list.
6. OpenTelemetry Java instrumentation GitHub repository.
7. OpenTelemetry semantic conventions.
8. W3C Trace Context specification.
9. OpenTelemetry Collector documentation.

---

## 47. Ringkasan

OpenTelemetry Java Agent adalah cara paling cepat untuk membuat sistem Java memiliki baseline distributed tracing dan telemetry tanpa refactor besar. Ia sangat berguna untuk Java 8 sampai Java 25, terutama ketika organisasi memiliki banyak service dan ingin standardisasi observability.

Namun, Java agent bukan pengganti engineering judgement.

Engineer kuat akan bertanya:

- service identity sudah benar atau belum?
- trace context propagate atau terputus?
- sampling menyembunyikan error penting atau tidak?
- span name aman dari cardinality explosion atau tidak?
- logs sudah punya trace/span ID atau belum?
- telemetry mengandung PII/secrets atau tidak?
- overhead sudah diukur atau hanya diasumsikan?
- agent memberi call graph, tapi domain meaning ditambahkan di mana?

Jika kamu bisa menjawab pertanyaan-pertanyaan ini, kamu tidak hanya “memasang OpenTelemetry”. Kamu mulai mengoperasikan observability sebagai bagian dari architecture dan production engineering.

---

## 48. Status Series

Selesai sampai: **Part 13 — OpenTelemetry Java Agent: Zero-Code Instrumentation for Java 8+**.

Belum selesai. Berikutnya:

**Part 14 — Manual Tracing: Span Design, Boundaries, Attributes, Events, Errors**.


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 12 — OpenTelemetry Mental Model: Signals, Resource, Scope, Context](./12-opentelemetry-mental-model-signals-resource-scope-context.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 14 — Manual Tracing: Span Design, Boundaries, Attributes, Events, Errors](./14-manual-tracing-span-design-boundaries-attributes-events-errors.md)

# learn-java-deployment-runtime-release-delivery-engineering

# Part 21 — Observability-Ready Deployment

> Target pembelajaran: setelah bagian ini, kamu tidak lagi melihat observability sebagai “tambahan monitoring setelah aplikasi live”, tetapi sebagai bagian dari kontrak deployment. Aplikasi Java yang production-grade harus bisa menjawab: apakah versi yang baru benar-benar berjalan, apakah sehat, apakah traffic masuk, apakah dependency sehat, apakah latency berubah, apakah error meningkat, apakah memory/GC/thread/pool stabil, dan apakah kita punya bukti teknis untuk rollback atau melanjutkan rollout.

---

## 1. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membahas deployment dari banyak sisi:

- artifact dan runtime;
- OS/container/Kubernetes process contract;
- configuration dan JVM options;
- Dockerfile dan custom runtime image;
- classpath/classloader failure;
- app server/Spring Boot/Kubernetes;
- probes dan graceful shutdown;
- resource sizing;
- release strategy;
- schema migration;
- stateful workloads;
- secret/certificate rotation.

Semua itu belum cukup kalau setelah deploy kita tidak bisa membuktikan keadaan sistem.

Deployment yang matang bukan hanya:

```text
kubectl apply succeeded
pipeline green
pod Running
health endpoint UP
```

Deployment yang matang adalah:

```text
Versi baru menerima traffic yang benar,
latency dan error rate tetap dalam batas,
dependency behavior normal,
resource usage masuk budget,
log dan trace bisa dikorelasikan,
failure bisa didiagnosis tanpa redeploy,
dan rollback decision bisa dibuat berdasarkan signal, bukan firasat.
```

Part ini membahas **observability-ready deployment**: bagaimana aplikasi Java disiapkan agar bisa dioperasikan, diverifikasi, dan didiagnosis sejak detik pertama setelah rilis.

---

## 2. Observability Bukan Monitoring Biasa

### 2.1 Monitoring

Monitoring biasanya menjawab pertanyaan yang sudah kita tahu sebelumnya:

```text
Apakah CPU tinggi?
Apakah memory penuh?
Apakah endpoint /health UP?
Apakah disk hampir penuh?
Apakah error rate naik?
```

Monitoring cocok untuk known-knowns.

### 2.2 Observability

Observability lebih luas. Ia membantu menjawab pertanyaan yang belum kita tahu sebelumnya:

```text
Kenapa request tertentu lambat hanya untuk tenant tertentu?
Kenapa setelah deploy versi baru, hanya workflow tertentu gagal?
Kenapa error hanya muncul saat consumer RabbitMQ berpindah node?
Kenapa memory naik padahal heap terlihat aman?
Kenapa DB pool habis hanya di satu zone?
Kenapa rollback tidak langsung menurunkan error?
```

Observability cocok untuk unknown-unknowns.

### 2.3 Deployment-ready observability

Observability-ready deployment berarti setiap release membawa kemampuan diagnosis sebagai bagian dari paket deployment.

Minimal, setiap versi aplikasi harus bisa menjawab:

| Pertanyaan | Signal yang Dibutuhkan |
|---|---|
| Versi apa yang berjalan? | build info, git SHA, image digest, artifact version |
| Instance mana yang menerima request? | pod/host/container id, instance id |
| Request ini melewati komponen mana? | trace id, span id, correlation id |
| Mengapa request gagal? | structured error log, exception class, dependency status |
| Apakah performa berubah setelah deploy? | latency histogram, throughput, error rate, GC, CPU, pool metrics |
| Apakah dependency sehat? | DB/cache/queue/client metrics, dependency span |
| Apakah failure bisa dibuktikan? | logs + metrics + traces + events + runtime dumps |

---

## 3. Mental Model: The Five Observation Planes

Untuk Java deployment, gunakan lima observation planes.

```text
+-------------------------------------------------------------+
| 5. Business / Workflow Plane                                |
|    case submitted, payment completed, appeal escalated       |
+-------------------------------------------------------------+
| 4. Application Plane                                        |
|    HTTP, jobs, queues, errors, validation, use case latency   |
+-------------------------------------------------------------+
| 3. JVM Plane                                                |
|    heap, GC, threads, classloading, JFR, safepoints          |
+-------------------------------------------------------------+
| 2. Runtime / Container / OS Plane                           |
|    CPU, RSS, file descriptors, signals, network, OOMKilled   |
+-------------------------------------------------------------+
| 1. Platform Plane                                           |
|    pod, node, service, ingress, deployment, autoscaler        |
+-------------------------------------------------------------+
```

Top 1% engineer tidak hanya melihat satu layer.

Contoh:

```text
Symptom:
  POST /applications latency naik setelah deploy.

Engineer dangkal:
  CPU normal, pod Running, /health UP.

Engineer matang:
  Cek trace untuk POST /applications.
  Cek DB span latency.
  Cek pool active/idle/pending.
  Cek GC pause.
  Cek thread pool queue.
  Cek pod CPU throttling.
  Cek apakah hanya versi baru.
  Cek apakah hanya zone tertentu.
  Cek apakah schema migration menambah lock/plan change.
```

---

## 4. Observability Harus Menjadi Deployment Contract

Observability sering gagal karena diperlakukan sebagai urusan platform/SRE saja. Padahal sinyal terbaik sering hanya bisa disediakan oleh aplikasi.

Deployment contract seharusnya menyatakan:

```text
Setiap service wajib menyediakan:
- structured logs;
- stable correlation id;
- version/build metadata;
- health/readiness signal;
- metrics endpoint atau exporter;
- distributed tracing propagation;
- runtime diagnostics switch;
- safe dump strategy;
- dashboard baseline;
- alert baseline;
- post-deployment verification checklist.
```

Tanpa itu, deployment menjadi black box.

---

## 5. Logs: Dari Text Dump ke Evidence Stream

### 5.1 Fungsi log dalam deployment

Log bukan tempat membuang semua informasi. Dalam deployment, log berfungsi sebagai:

1. **evidence** — bukti apa yang terjadi;
2. **timeline** — urutan kejadian;
3. **context** — siapa/request/job/entity apa yang terpengaruh;
4. **diagnostic breadcrumb** — petunjuk untuk RCA;
5. **audit-supporting material** — terutama untuk sistem enterprise/regulatory.

### 5.2 Log yang buruk

Contoh log buruk:

```text
Error processing request
```

Masalah:

- tidak tahu request id;
- tidak tahu endpoint;
- tidak tahu user/tenant/entity;
- tidak tahu dependency;
- tidak tahu exception;
- tidak tahu versi aplikasi;
- tidak tahu instance;
- tidak tahu apakah retry terjadi.

### 5.3 Log yang lebih berguna

```json
{
  "timestamp": "2026-06-18T07:12:31.293+07:00",
  "level": "ERROR",
  "service": "case-service",
  "version": "2.17.4",
  "git_sha": "a13f9c2",
  "environment": "prod",
  "pod": "case-service-7788dbf9f7-9x2lm",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "correlation_id": "REQ-20260618-00012993",
  "operation": "submit_case",
  "entity_type": "case",
  "entity_id_hash": "sha256:8a1f...",
  "outcome": "failed",
  "exception_class": "java.sql.SQLTransientConnectionException",
  "message": "DB connection acquisition timed out",
  "duration_ms": 8021
}
```

Catatan penting:

- jangan log PII mentah;
- jangan log token/secret;
- gunakan hash/tokenized id untuk entity sensitif;
- simpan correlation metadata, bukan data rahasia.

---

## 6. Structured Logging

### 6.1 Kenapa structured logging penting

Text log mudah dibaca manusia, tetapi sulit di-query secara akurat.

Structured log memungkinkan query seperti:

```text
service = case-service
AND version = 2.17.4
AND operation = submit_case
AND exception_class = SQLTransientConnectionException
AND environment = prod
```

Ini jauh lebih kuat daripada grep string.

### 6.2 Field minimal untuk Java service

Field baseline:

| Field | Tujuan |
|---|---|
| timestamp | waktu event |
| level | INFO/WARN/ERROR |
| service | nama service |
| environment | dev/sit/uat/prod |
| version | versi aplikasi |
| git_sha | trace ke source |
| image_digest | trace ke container image |
| pod/host | instance runtime |
| thread | useful untuk Java debugging |
| logger | source logger |
| trace_id | distributed tracing |
| span_id | span saat ini |
| correlation_id | business/request correlation |
| operation | use case semantic |
| outcome | success/failure |
| duration_ms | waktu operasi |
| exception_class | klasifikasi error |

### 6.3 MDC di Java

Di Java logging ecosystem, correlation context sering ditempatkan di MDC atau ThreadContext.

Contoh dengan SLF4J MDC:

```java
import org.slf4j.MDC;

public class CorrelationFilter {
    public void doFilter(Request request, Response response, FilterChain chain) {
        String correlationId = resolveOrCreateCorrelationId(request);
        try {
            MDC.put("correlation_id", correlationId);
            MDC.put("operation", resolveOperation(request));
            chain.doFilter(request, response);
        } finally {
            MDC.clear();
        }
    }
}
```

Critical invariant:

```text
MDC harus dibersihkan.
```

Kalau tidak, thread pool reuse bisa menyebabkan request A membawa correlation id request B.

### 6.4 Virtual threads warning

Dengan virtual threads, MDC behavior bergantung framework/logging integration. Jangan asumsikan semua context propagation otomatis bekerja sama seperti platform thread.

Deployment validation untuk Java 21+ harus memasukkan test:

```text
Apakah trace id/correlation id tetap benar pada:
- virtual thread request handler?
- async task?
- CompletableFuture?
- scheduler?
- queue consumer?
- reactive pipeline?
```

---

## 7. Logging di Container dan Kubernetes

### 7.1 Container log principle

Untuk containerized Java apps, default sehat adalah:

```text
application logs -> stdout/stderr
container runtime -> node log file/CRI
agent/collector -> central log platform
```

Kubernetes logging architecture menjelaskan bahwa container runtime menangani output aplikasi ke stdout/stderr dan kubelet memakai format logging CRI yang distandardisasi.

### 7.2 Jangan menulis log utama hanya ke file lokal container

Anti-pattern:

```text
/opt/app/logs/application.log only
```

Masalah:

- hilang saat pod mati;
- sulit dikumpulkan tanpa sidecar/volume;
- bisa memenuhi ephemeral disk;
- tidak natural untuk Kubernetes;
- tidak muncul di `kubectl logs`.

Boleh menulis file lokal untuk kebutuhan khusus seperti audit buffer atau diagnostic dump, tetapi log operasional utama sebaiknya ke stdout/stderr.

### 7.3 Log level deployment strategy

Log level harus bisa dikontrol tanpa rebuild.

Pattern:

```text
Normal:
  root INFO
  application INFO
  framework WARN/INFO
  SQL DEBUG disabled

Incident temporary:
  specific package DEBUG for 15-30 minutes
  never enable global DEBUG in production without capacity review
```

Risiko global DEBUG:

- throughput turun;
- storage meledak;
- PII/secret leakage;
- latency naik;
- log collector overload;
- signal tenggelam oleh noise.

---

## 8. Metrics: Signal yang Bisa Diukur dan Dibandingkan

### 8.1 Metrics berbeda dari logs

Log menjelaskan event individual.
Metrics menjelaskan agregasi numerik.

Contoh:

```text
http_server_requests_seconds_count
http_server_requests_seconds_bucket
jvm_memory_used_bytes
hikaricp_connections_active
rabbitmq_consumer_unacked_messages
process_cpu_usage
```

Metrics cocok untuk:

- alert;
- dashboard;
- trend;
- SLO;
- capacity planning;
- canary analysis;
- regression detection.

### 8.2 RED dan USE

Untuk service request/response, gunakan RED:

```text
Rate     = request throughput
Errors   = failed request rate
Duration = latency distribution
```

Untuk resource, gunakan USE:

```text
Utilization = seberapa penuh resource dipakai
Saturation  = antrean/backpressure
Errors      = error resource
```

Contoh Java service:

| Area | Metrics |
|---|---|
| HTTP | request count, 4xx, 5xx, latency histogram |
| JVM | heap, non-heap, GC pause, threads, classes |
| DB pool | active, idle, pending, timeout |
| Queue | consumed, failed, retry, dead-letter, lag/unacked |
| Cache | hit/miss, latency, error |
| CPU | usage, throttling, load |
| Memory | RSS, heap, direct, metaspace |
| Deployment | version label, pod label, zone label |

### 8.3 Histogram, bukan average saja

Average latency sering menipu.

Contoh:

```text
99 request = 50 ms
1 request  = 10_000 ms
average    = 149.5 ms
```

Average terlihat cukup baik, padahal satu request sangat buruk.

Untuk deployment verification, lihat:

```text
p50
p90
p95
p99
max atau high percentile approximation
```

### 8.4 Cardinality discipline

Metrics bisa menghancurkan observability platform jika label terlalu granular.

Buruk:

```text
http_requests_total{user_id="123456"}
http_requests_total{case_id="CASE-2026-000001"}
http_requests_total{request_id="..."}
```

Baik:

```text
http_requests_total{service="case-service", method="POST", route="/cases", status="201", version="2.17.4"}
```

Rule:

```text
Logs boleh high-cardinality.
Traces boleh high-cardinality.
Metrics harus low-cardinality.
```

---

## 9. Java Metrics Baseline

### 9.1 JVM metrics yang wajib ada

| Metric Family | Kenapa Penting |
|---|---|
| heap used/committed/max | mendeteksi pressure dan leak |
| non-heap/metaspace | classloading/framework leak |
| GC pause count/time | latency impact |
| thread count | runaway thread/platform thread issue |
| daemon/non-daemon threads | shutdown diagnosis |
| class loaded/unloaded | classloader leak |
| direct buffer memory | Netty/NIO/DB driver impact |
| process CPU | actual CPU usage |
| system/container CPU | saturation context |
| file descriptors | leak/socket issue |

### 9.2 Application metrics yang wajib ada

Untuk HTTP service:

```text
request count by route/method/status
request latency histogram by route/method
exception count by exception class
in-flight requests
```

Untuk DB:

```text
pool active
pool idle
pool pending/acquire time
pool max
connection timeout count
query latency by operation category, not raw SQL
```

Untuk queue consumer:

```text
message consumed count
message failed count
retry count
dead-letter count
processing duration
consumer lag/unacked
active consumer count
```

Untuk scheduler/job:

```text
job start count
job success/failure count
job duration
job currently running
last successful run timestamp
skipped run count
lock acquisition failure count
```

### 9.3 Business/workflow metrics

Untuk sistem enforcement/case management, application metrics saja tidak cukup.

Contoh business/workflow metrics:

```text
case_submitted_total
case_escalated_total
case_assignment_failed_total
appeal_created_total
letter_generation_failed_total
sla_breach_detected_total
payment_reconciliation_failed_total
```

Hati-hati: jangan memasukkan identifier sensitif sebagai label.

Gunakan label stabil dan rendah cardinality:

```text
module="case"
workflow="escalation"
outcome="success|failure"
channel="internal|internet"
```

---

## 10. Health, Readiness, Liveness, and Observability

### 10.1 Health bukan observability penuh

Health endpoint menjawab:

```text
Apakah instance ini boleh dianggap hidup/sehat untuk tujuan tertentu?
```

Ia tidak menjawab semua pertanyaan diagnosis.

### 10.2 Bedakan liveness dan readiness

Liveness:

```text
Apakah process perlu direstart?
```

Readiness:

```text
Apakah instance boleh menerima traffic?
```

Kesalahan umum:

```text
liveness check bergantung ke database
```

Jika DB down sementara, semua pod restart massal. Ini bisa memperparah incident.

### 10.3 Health groups

Untuk Spring Boot modern, Actuator mendukung production-ready endpoints dan health groups. Pattern yang sehat:

```text
/livez
  shallow: process alive, event loop/container responsive

/readyz
  application initialized, critical dependency available, not draining

/actuator/health
  internal detailed health for authenticated operators
```

### 10.4 Health signal harus punya semantics jelas

Contoh readiness harus false jika:

- app masih startup;
- schema belum compatible;
- secret/cert belum loaded;
- app sedang draining;
- DB pool tidak bisa acquire connection;
- critical downstream unavailable dan service tidak punya fallback;
- consumer belum siap menerima message.

Readiness tidak harus false jika:

- optional dependency down;
- non-critical reporting service down;
- external enrichment service down tapi request bisa degrade;
- metrics exporter down tetapi service masih melayani user.

---

## 11. Distributed Tracing

### 11.1 Kenapa tracing penting untuk deployment

Dalam distributed system, satu request bisa melewati:

```text
Ingress
API gateway
Frontend BFF
Case service
Document service
Database
Redis
RabbitMQ
Notification service
SMTP provider
```

Log per service tidak cukup kalau tidak bisa dikorelasikan.

Distributed tracing memberikan:

```text
trace = perjalanan end-to-end request
span  = satu operasi dalam perjalanan itu
```

### 11.2 Trace context

Trace context harus dipropagasikan lewat:

- HTTP headers;
- gRPC metadata;
- message headers;
- async task context;
- scheduled job context jika memicu downstream call.

Untuk message queue, jangan hanya trace HTTP request awal. Propagasi trace/correlation ke message headers.

### 11.3 Correlation ID vs Trace ID

Jangan mencampur semua konsep.

| ID | Sumber | Fungsi |
|---|---|---|
| trace_id | observability/tracing system | korelasi teknis antar span |
| span_id | tracing system | unit operasi spesifik |
| correlation_id | aplikasi/gateway | korelasi request/business flow |
| business_id | domain | case/application/payment id, biasanya sensitif |
| idempotency_key | client/app | deduplication/retry safety |

Pattern matang:

```text
trace_id: untuk observability technical path
correlation_id: untuk support/RCA lintas log
business id: masked/hashed jika masuk log
```

### 11.4 OpenTelemetry Java Agent

OpenTelemetry Java agent menyediakan zero-code instrumentation untuk aplikasi Java 8+ dengan attach Java agent, dan dapat menginstrumentasi banyak framework/library umum seperti inbound requests, outbound HTTP, database calls, dan lainnya.

Contoh deployment:

```bash
java \
  -javaagent:/otel/opentelemetry-javaagent.jar \
  -Dotel.service.name=case-service \
  -Dotel.resource.attributes=deployment.environment=prod,service.version=2.17.4 \
  -Dotel.exporter.otlp.endpoint=http://otel-collector:4317 \
  -jar app.jar
```

### 11.5 Agent bukan magic

Agent membantu, tetapi tidak cukup untuk domain-level observability.

Agent bisa melihat:

```text
HTTP call
JDBC query
Redis call
Kafka/Rabbit client operation
```

Agent biasanya tidak tahu:

```text
case escalation semantics
approval workflow stage
regulatory decision type
business SLA category
manual override reason
```

Untuk itu perlu manual instrumentation atau structured business logs/metrics.

---

## 12. OpenTelemetry Deployment Model

### 12.1 Typical architecture

```text
Java App
  | logs/metrics/traces
  v
OpenTelemetry SDK / Java Agent
  |
  v
OpenTelemetry Collector
  |-- traces -> Jaeger/Tempo/Datadog/New Relic/etc
  |-- metrics -> Prometheus/OTLP backend
  |-- logs -> log backend
```

### 12.2 Kenapa pakai collector

Collector memberikan boundary operasional:

- aplikasi tidak perlu tahu backend observability final;
- bisa retry/buffer/filter;
- bisa enrich resource attributes;
- bisa route telemetry per environment;
- bisa menghindari vendor lock-in langsung di aplikasi;
- bisa centralize sampling policy.

### 12.3 Resource attributes wajib

Minimal:

```text
service.name
service.version
deployment.environment
cloud.region
k8s.cluster.name
k8s.namespace.name
k8s.pod.name
container.image.name
container.image.tag
container.image.digest
```

Untuk release verification, `service.version` dan image digest sangat penting.

---

## 13. Sampling Strategy

### 13.1 Semua trace disimpan?

Di production traffic tinggi, menyimpan semua trace bisa mahal.

Sampling options:

| Strategy | Kegunaan | Risiko |
|---|---|---|
| head-based sampling | murah, simple | bisa membuang trace error penting |
| tail-based sampling | simpan berdasarkan hasil akhir/error/latency | perlu collector/backend support |
| always sample errors | RCA lebih mudah | volume naik saat incident |
| sample canary higher | release validation lebih kuat | konfigurasi lebih kompleks |

### 13.2 Deployment-aware sampling

Saat canary:

```text
stable version: 5% sample
canary version: 50-100% sample sementara
error traces: 100% sample
slow traces: 100% sample di atas threshold
```

Ini membantu membandingkan versi baru dengan data cukup.

---

## 14. Java Flight Recorder sebagai Deployment Safety Net

### 14.1 Apa itu JFR

JDK Flight Recorder adalah observability/monitoring framework bawaan HotSpot JVM. Dokumentasi Oracle menyatakan JFR terintegrasi ke JVM, memiliki overhead sangat kecil, dan dapat digunakan di production untuk mengumpulkan diagnostic/profiling data seperti thread samples, lock profiles, dan GC details.

### 14.2 Kenapa JFR relevan untuk deployment

Saat deployment menyebabkan masalah halus seperti:

- lock contention;
- thread starvation;
- GC pause regression;
- allocation spike;
- classloading anomaly;
- socket read timeout burst;
- CPU hot method;
- virtual thread pinning;
- blocked threads;
- exception storm;

logs dan metrics sering tidak cukup. JFR bisa memberi detail runtime tanpa selalu perlu redeploy.

### 14.3 Default JFR deployment pattern

Untuk service penting, pertimbangkan continuous recording dengan rolling disk buffer.

Contoh:

```bash
java \
  -XX:StartFlightRecording=filename=/var/log/app/recording.jfr,settings=profile,dumponexit=true,maxage=30m,maxsize=256m \
  -jar app.jar
```

Alternatif on-demand dengan `jcmd`:

```bash
jcmd <pid> JFR.start name=incident settings=profile delay=0s duration=5m filename=/tmp/incident.jfr
jcmd <pid> JFR.dump name=incident filename=/tmp/incident-dump.jfr
jcmd <pid> JFR.stop name=incident
```

### 14.4 Container warning

Agar bisa mengambil JFR/thread dump/heap dump dalam container:

- image harus punya tool diagnostik atau ada debug/ephemeral container;
- process user/permissions harus memungkinkan attach;
- filesystem harus punya writable path cukup;
- security hardening mungkin memblokir attach;
- dump file harus bisa diekstrak sebelum pod hilang.

Observability-ready deployment harus memutuskan ini sebelum incident.

---

## 15. Thread Dump, Heap Dump, and Crash Artifacts

### 15.1 Thread dump

Thread dump berguna untuk:

- deadlock;
- thread starvation;
- stuck request;
- blocked DB calls;
- executor saturation;
- runaway scheduler;
- shutdown hang.

Command:

```bash
jcmd <pid> Thread.print > /tmp/thread-dump.txt
```

atau:

```bash
kill -3 <pid>
```

`kill -3` mencetak thread dump ke stdout/stderr process Java. Di Kubernetes, ini bisa masuk container logs.

### 15.2 Heap dump

Heap dump berguna untuk memory leak, tetapi berbahaya secara operasional.

Risiko:

- file sangat besar;
- bisa mengandung PII/secret;
- bisa memenuhi disk;
- bisa memperlambat aplikasi;
- perlu akses aman untuk transfer/analisis.

Pattern JVM option:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
-XX:ErrorFile=/dumps/hs_err_pid%p.log
```

### 15.3 Dump strategy harus eksplisit

Deployment harus menjawab:

```text
Dump disimpan di mana?
Berapa kapasitas path tersebut?
Siapa boleh mengambil dump?
Apakah dump dienkripsi?
Bagaimana dump dibersihkan?
Apakah dump boleh dibuat di production?
Bagaimana jika pod restart dan dump hilang?
```

---

## 16. GC Logs sebagai Deployment Regression Signal

### 16.1 Kenapa GC logs masih penting

Metrics memberi agregasi GC pause. GC log memberi detail timeline.

Berguna untuk:

- membandingkan before/after deploy;
- melihat allocation rate;
- melihat pause reason;
- melihat heap pressure;
- melihat full GC;
- melihat humongous allocation pada G1;
- melihat ZGC/Shenandoah behavior.

### 16.2 Java 8 vs Java 9+

Java 8 menggunakan flags legacy seperti:

```bash
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/var/log/app/gc.log
-XX:+UseGCLogFileRotation
-XX:NumberOfGCLogFiles=5
-XX:GCLogFileSize=20M
```

Java 9+ menggunakan unified logging:

```bash
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=20M
```

### 16.3 Container consideration

Jika log utama ke stdout, GC log bisa:

- diarahkan ke stdout dengan `-Xlog:gc*:stdout...`; atau
- diarahkan ke file dengan volume/log collector khusus.

Untuk Kubernetes, hati-hati file GC log di ephemeral filesystem.

---

## 17. Deployment Metadata: Version, Build, Commit, Image Digest

### 17.1 Setiap telemetry harus bisa dihubungkan ke release

Tanpa metadata release, kita tidak bisa menjawab:

```text
Apakah error hanya terjadi di versi baru?
Apakah pod ini benar-benar menjalankan image baru?
Apakah rollback sudah efektif?
Apakah dua versi berjalan bersamaan?
```

### 17.2 Metadata baseline

Masukkan ke:

- application endpoint `/info`;
- logs;
- metrics labels;
- trace resource attributes;
- Kubernetes labels/annotations;
- release notes;
- dashboard variables.

Field:

```text
application.name
application.version
git.commit
build.time
build.number
image.tag
image.digest
java.version
runtime.vendor
config.version
migration.version
```

### 17.3 Spring Boot build info

Untuk Spring Boot, build info bisa diekspos via Actuator `/actuator/info` jika build plugin dikonfigurasi. Namun jangan menaruh data sensitif di info endpoint.

---

## 18. Post-Deployment Verification Signals

Setelah deploy, jangan hanya cek pod Running.

### 18.1 Technical checks

```text
- semua pod versi baru ready;
- tidak ada restart spike;
- startup time normal;
- readiness stabil;
- liveness tidak restart;
- CPU/memory/RSS dalam expected range;
- GC pause tidak naik signifikan;
- thread count stabil;
- DB pool active/pending normal;
- HTTP 5xx tidak naik;
- latency p95/p99 tidak naik;
- downstream error tidak naik;
- queue retry/DLQ tidak naik;
- log ERROR/WARN tidak melonjak;
- traces menunjukkan dependency path normal.
```

### 18.2 Business checks

```text
- login berhasil;
- submit workflow berhasil;
- approval/escalation path berhasil;
- document generation berhasil;
- notification/email path berhasil;
- scheduler/job tidak duplicate;
- queue consumer memproses message;
- no SLA-critical backlog increase;
- no unexpected business validation failures.
```

### 18.3 Version-scoped comparison

Selalu bandingkan berdasarkan version label:

```text
version="2.17.3" vs version="2.17.4"
```

Jika semua metric digabung, regression kecil pada canary bisa tersembunyi.

---

## 19. Dashboard Design untuk Deployment

### 19.1 Dashboard bukan wall decoration

Dashboard deployment harus menjawab decision:

```text
continue rollout?
pause rollout?
rollback?
investigate only?
ignore as unrelated?
```

### 19.2 Dashboard minimal per service

Panel:

1. deployment version distribution;
2. request rate by version;
3. error rate by version;
4. latency p50/p95/p99 by version;
5. top exception classes;
6. DB pool active/pending/timeout;
7. JVM heap/RSS;
8. GC pause;
9. CPU usage/throttling;
10. pod restarts;
11. queue retry/DLQ/lag if applicable;
12. downstream dependency latency/error;
13. log error count by version;
14. trace error/slow trace samples.

### 19.3 Golden deployment dashboard

```text
Time range:
  last 30m, last 2h, last 24h

Dimensions:
  service
  version
  environment
  namespace
  zone/node
  route/operation

Decisions:
  green  = continue rollout
  amber  = pause and inspect
  red    = rollback or mitigate
```

---

## 20. Alerting: Alert on Symptoms, Not Every Cause

### 20.1 Bad alerts

```text
CPU > 80% for 1 minute
Heap > 70%
One ERROR log found
One pod restarted
```

These create noise.

### 20.2 Better alerts

```text
5xx rate > SLO threshold for 5 minutes
p95 latency > threshold and traffic > minimum
DB connection acquisition timeout > threshold
queue DLQ increased > threshold
readiness unavailable replicas > threshold
error budget burn rate high
```

### 20.3 Deployment-specific alerts

During rollout:

```text
new version 5xx rate > stable version by N%
new version p95 latency > stable version by N%
new version restart count > 0 within 10 minutes
new version readiness flaps > threshold
canary trace error rate > stable baseline
```

---

## 21. Observability for Rollback Decision

Rollback should not be emotional.

### 21.1 Rollback triggers

Strong rollback signals:

- 5xx increase tied to new version;
- p95/p99 latency regression tied to new version;
- data corruption risk;
- DB migration incompatibility;
- queue poison message increase;
- pod crash loop;
- security/config/cert failure;
- critical business workflow failure;
- unbounded resource growth.

Weak signals that need investigation:

- one isolated error;
- unrelated downstream outage;
- traffic spike unrelated to version;
- noisy log from non-critical path;
- transient startup warning.

### 21.2 Rollback evidence packet

For enterprise release, capture:

```text
- release version;
- deployment time;
- affected services;
- metric screenshots/links;
- trace examples;
- log query links;
- error class summary;
- suspected blast radius;
- rollback action time;
- post-rollback verification.
```

---

## 22. Observability for Message Consumers and Jobs

HTTP observability is not enough.

### 22.1 Queue consumer logs

Each message processing attempt should carry:

```text
message_id
correlation_id
trace_id if propagated
consumer_name
queue/topic
attempt_number
idempotency_key
business operation
outcome
duration_ms
failure_category
```

### 22.2 Queue consumer metrics

```text
messages_consumed_total
messages_failed_total
message_processing_duration_seconds
message_retry_total
message_dead_letter_total
consumer_active_count
consumer_inflight_count
```

### 22.3 Scheduler/job observability

For scheduled jobs:

```text
job_last_start_time
job_last_success_time
job_last_failure_time
job_duration_seconds
job_running
job_skipped_total
job_lock_acquisition_failed_total
job_records_processed_total
job_records_failed_total
```

Important invariant:

```text
A job that silently stops running is an incident.
```

So you need stale-job detection, not only failure detection.

---

## 23. Observability for Database-Aware Deployment

After schema migration, watch:

```text
query latency by operation
DB pool pending/acquire time
deadlocks
lock wait
connection timeout
slow query count
rows processed by backfill
migration duration
schema version
application version compatibility
```

For Java app, DB pool metrics are often the first symptom.

Example incident pattern:

```text
New version adds extra DB call per request.
CPU still normal.
Heap still normal.
But Hikari pending connections rise.
Request latency p99 rises.
Timeout starts.
HTTP 5xx rises.
```

Without DB pool metrics, this looks like random slowness.

---

## 24. Observability for Secret/Certificate Rotation

When rotating secrets/certs, expose safe signals:

```text
certificate_expiry_days
truststore_loaded_timestamp
active_credential_version
secret_reload_success_total
secret_reload_failure_total
tls_handshake_failure_total
oauth_token_request_failure_total
```

Never expose secret values.

For certs, alert well before expiry:

```text
<= 30 days: warning
<= 14 days: urgent
<= 7 days: critical
<= 1 day: emergency
```

---

## 25. Observability for Java 8–25 Differences

### 25.1 Java 8

Watch:

- legacy GC logging flags;
- PermGen no longer for Java 8, but Metaspace still native memory;
- older TLS defaults in some update levels;
- older container awareness limitations depending exact update;
- older app servers/logging stacks;
- weaker default diagnostics setup in legacy deployments.

### 25.2 Java 11/17

Watch:

- module encapsulation warnings/errors;
- newer GC logging with `-Xlog`;
- container-aware ergonomics;
- stronger TLS/security defaults;
- classpath/module migration issues.

### 25.3 Java 21/25

Watch:

- virtual thread observability;
- structured concurrency preview/feature usage if applicable;
- updated JFR events;
- modern GC behavior;
- framework compatibility;
- monitoring agents compatibility with newer bytecode/runtime.

Critical rule:

```text
Every Java upgrade must include observability agent compatibility validation.
```

---

## 26. OpenTelemetry Agent Compatibility and Deployment Risk

Java agents modify runtime behavior through instrumentation.

Deployment risk:

- startup slowdown;
- classloading issue;
- instrumentation bug;
- memory overhead;
- high-cardinality span attributes;
- exporter backpressure;
- broken context propagation;
- conflict with other agents.

If using multiple agents:

```text
-javaagent:otel.jar
-javaagent:apm-vendor.jar
-javaagent:security-agent.jar
```

Be careful. Agent order can matter.

Deployment checklist:

```text
- agent version pinned;
- compatible with Java runtime version;
- compatible with framework version;
- exporter endpoint configured;
- failure mode understood if collector down;
- sampling configured;
- overhead measured;
- sensitive attributes filtered;
- startup verified;
- rollback path available.
```

---

## 27. Sensitive Data and Observability

Observability can leak data.

### 27.1 Never log

```text
password
access token
refresh token
authorization header
session cookie
private key
client secret
full NRIC/NIK/passport
raw personal address
full email body if sensitive
unmasked payment data
```

### 27.2 Be careful with traces

Auto-instrumentation can capture:

- URL path;
- query string;
- SQL statement;
- HTTP headers if configured;
- exception messages;
- messaging headers.

Policy:

```text
Do not enable broad header/body capture in production unless reviewed.
Sanitize query parameters.
Parameterize SQL.
Mask business identifiers.
```

### 27.3 Log redaction must be tested

Do not assume redaction works. Add tests for:

```text
Authorization: Bearer xxx
password=xxx
client_secret=xxx
Set-Cookie
NRIC/NIK-like pattern
email content
```

---

## 28. Observability Failure Modes

### 28.1 Telemetry pipeline down

If collector/log backend is down, app should not fail user traffic by default.

Desired:

```text
telemetry degraded
app continues serving
backpressure bounded
logs not blocking forever
```

Bad:

```text
observability exporter blocks request threads
log appender blocks all writes
disk fills because collector down
```

### 28.2 Too much telemetry

Symptoms:

- CPU overhead;
- memory overhead;
- network egress spike;
- observability bill spike;
- dropped spans/logs;
- delayed ingestion;
- noisy dashboards.

Mitigation:

- sampling;
- cardinality control;
- log level control;
- attribute filtering;
- route-level aggregation;
- retention policy.

### 28.3 Missing deployment labels

If version label missing, canary analysis becomes weak.

This is a deployment bug.

---

## 29. Implementation Blueprint: Spring Boot on Kubernetes

### 29.1 JVM command

```bash
java \
  -javaagent:/otel/opentelemetry-javaagent.jar \
  -Dotel.service.name=case-service \
  -Dotel.resource.attributes=deployment.environment=prod,service.version=${APP_VERSION},git.sha=${GIT_SHA} \
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/dumps \
  -XX:ErrorFile=/dumps/hs_err_pid%p.log \
  -Xlog:gc*,safepoint:stdout:time,uptime,level,tags \
  -jar /app/app.jar
```

### 29.2 Kubernetes labels

```yaml
metadata:
  labels:
    app.kubernetes.io/name: case-service
    app.kubernetes.io/version: "2.17.4"
    app.kubernetes.io/component: backend
    app.kubernetes.io/part-of: case-management
```

### 29.3 Environment variables

```yaml
env:
  - name: APP_VERSION
    value: "2.17.4"
  - name: GIT_SHA
    value: "a13f9c2"
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: "http://otel-collector.observability:4317"
  - name: OTEL_TRACES_SAMPLER
    value: "parentbased_traceidratio"
  - name: OTEL_TRACES_SAMPLER_ARG
    value: "0.10"
```

### 29.4 Probes

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/startup
    port: 8080
  failureThreshold: 60
  periodSeconds: 2

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 2

livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3
```

### 29.5 Logging pattern

For Logback JSON, conceptual fields:

```text
%timestamp
%level
%logger
%thread
%message
%exception
%mdc{trace_id}
%mdc{span_id}
%mdc{correlation_id}
%mdc{operation}
service/version/environment from env
```

---

## 30. Production Checklist

### 30.1 Before deploy

```text
[ ] service/version/git metadata present
[ ] logs structured
[ ] correlation id works
[ ] trace propagation works for HTTP and messaging
[ ] metrics endpoint/exporter works
[ ] health/readiness/liveness semantics reviewed
[ ] dashboards have version filter
[ ] alerts are not overly noisy
[ ] JFR/thread dump strategy exists
[ ] heap dump path and security reviewed
[ ] GC logging configured appropriately
[ ] sensitive data redaction tested
[ ] telemetry collector failure mode tested
[ ] canary comparison queries ready
```

### 30.2 During deploy

```text
[ ] new version receives expected traffic
[ ] readiness stable
[ ] restarts zero or expected
[ ] 5xx stable
[ ] latency p95/p99 stable
[ ] DB pool stable
[ ] GC stable
[ ] CPU/memory stable
[ ] no exception spike
[ ] no queue retry/DLQ spike
[ ] traces show expected path
```

### 30.3 After deploy

```text
[ ] business smoke checks passed
[ ] no delayed job failure
[ ] no backlog growth
[ ] no certificate/secret reload issue
[ ] dashboard reviewed
[ ] deployment evidence captured
[ ] rollback window decision made
[ ] release note updated if needed
```

---

## 31. Common Anti-Patterns

### Anti-pattern 1: Health endpoint is the only check

`/health = UP` does not prove release is safe.

### Anti-pattern 2: Logs without correlation id

In distributed systems, uncorrelated logs are fragments, not evidence.

### Anti-pattern 3: Metrics without version label

Cannot compare old vs new release.

### Anti-pattern 4: Logging raw business payloads

Useful today, compliance incident tomorrow.

### Anti-pattern 5: Global DEBUG in production

Often creates a second incident.

### Anti-pattern 6: Heap dump enabled without storage/security plan

Can crash disk or leak sensitive data.

### Anti-pattern 7: Observability agent upgraded together with app release

If incident happens, you now have two moving parts.

### Anti-pattern 8: Dashboards that do not answer decisions

Pretty charts are not operational control.

---

## 32. Top 1% Mental Model

A strong deployment engineer thinks like this:

```text
A release is not complete when the new artifact runs.
A release is complete when the system can prove:
- what version is running;
- where it is running;
- what traffic it receives;
- how it behaves vs baseline;
- what dependencies it touches;
- what errors it produces;
- what resources it consumes;
- what business workflows are affected;
- whether we should continue, pause, rollback, or mitigate.
```

Observability is not a dashboard project. It is a deployment safety system.

---

## 33. Final Summary

Di Part 21 ini kita membahas:

- perbedaan monitoring dan observability;
- lima observation planes untuk Java deployment;
- logs sebagai evidence stream;
- structured logging dan MDC;
- metrics, RED/USE, histogram, cardinality;
- JVM/application/business metrics baseline;
- health/readiness/liveness semantics;
- distributed tracing dan OpenTelemetry Java agent;
- sampling strategy;
- JFR, thread dump, heap dump, crash artifacts;
- GC logs;
- deployment metadata;
- post-deployment verification;
- dashboards dan alerting;
- rollback decision evidence;
- observability untuk jobs, queues, DB migration, secret/cert rotation;
- Java 8–25 observability differences;
- sensitive data risks;
- implementation blueprint;
- production checklist dan anti-patterns.

Core principle:

```text
Deployment without observability is gambling.
Deployment with observability is controlled change.
```

---

# Status Series

Selesai: **Part 21 dari 35**.

Belum selesai. Lanjut ke:

**Part 22 — Deployment Verification: Smoke Test, Health Gate, Synthetic Check, Contract Check**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 20 — Configuration, Secret Rotation, Certificate Rotation, and Truststore Deployment](./learn-java-deployment-runtime-release-delivery-engineering-part-20-configuration-secret-certificate-truststore-deployment.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 22 — Deployment Verification: Smoke Test, Health Gate, Synthetic Check, Contract Check](./learn-java-deployment-runtime-release-delivery-engineering-part-22-deployment-verification-check.md)

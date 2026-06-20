# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-025

# Part 025 — Observability: Logs, Metrics, Traces, Correlation IDs, and Process-Aware Monitoring

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Bagian: `025`  
> Topik: Observability untuk Camunda 8 / Zeebe dan Java worker production-grade  
> Target: Java engineer yang ingin mampu mendesain, mengoperasikan, men-debug, dan mempertanggungjawabkan sistem process orchestration berbasis Camunda 8 di production.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas reliability engineering: failure modes, broker/gateway/worker/exporter/secondary storage failure, backup/restore, RPO/RTO, retry storm, unknown outcome, dan reconciliation.

Bagian ini menjawab pertanyaan lanjutan yang sangat praktis:

> Kalau sistem Camunda 8 production mulai lambat, stuck, membuat incident, kehilangan SLA, atau menghasilkan keputusan bisnis yang salah, bagaimana kita tahu apa yang terjadi?

Observability di Camunda 8 tidak cukup dengan:

- log aplikasi Java,
- CPU/memory Kubernetes,
- Prometheus broker metrics,
- tracing HTTP call,
- Operate screenshot,
- atau dashboard business KPI saja.

Semua itu hanya potongan. Di orchestration system, satu kegagalan bisa tersebar di beberapa lapisan:

```text
BPMN model
  -> process instance
    -> flow node
      -> job
        -> Java worker
          -> domain service
            -> database
              -> external API
                -> message callback
                  -> exporter
                    -> Operate / Tasklist / Optimize / custom projection
```

Observability production-grade berarti kita mampu menghubungkan semua lapisan itu menjadi satu cerita kausal:

```text
Business case ABC-2026-0001 terlambat karena
  process instance 2251799813...
    menunggu service task VerifyApplicant
      job type applicant.verification.v2
        gagal 3 kali karena downstream Registry API timeout
          worker pod aceas-verification-worker-7f9d... mengalami latency spike
            karena connection pool saturated
              dan retry policy memperbesar pressure
                sehingga incident dibuat pada 2026-06-21T02:14:03+07:00
```

Itulah level observability yang dibutuhkan oleh engineer top-level: bukan hanya tahu “ada error”, tetapi bisa menjelaskan **where, why, impact, blast radius, recovery action, and prevention**.

---

## 1. Mental Model: Observability untuk Process Orchestration

Observability biasa menjawab:

```text
Apakah service saya sehat?
```

Process-aware observability menjawab:

```text
Apakah proses bisnis yang saya orkestrasi berjalan benar, tepat waktu, aman, dan bisa dipertanggungjawabkan?
```

Perbedaannya besar.

Sebuah worker bisa terlihat sehat secara teknis:

```text
CPU rendah
memory stabil
pod Running
no HTTP 500
```

Tetapi dari sudut pandang proses:

```text
- job backlog naik
- task SLA terlewat
- incident muncul
- message callback tidak ter-correlate
- user task queue tidak bergerak
- Optimize menunjukkan cycle time memburuk
```

Sebaliknya, process instance bisa terlihat stuck di Operate, tetapi akar masalahnya bukan engine:

```text
- downstream API rate limited
- token expired
- worker deployment salah profile
- variable schema berubah
- external callback dikirim ke correlation key lama
- exporter lag membuat Operate belum update
```

Jadi mental model observability Camunda 8 adalah:

```text
Observability = kemampuan membangun hubungan kausal antara:

1. orchestration state,
2. technical execution,
3. human work,
4. external systems,
5. platform health,
6. business outcome.
```

---

## 2. Empat Layer Observability Camunda 8

Untuk Camunda 8, observability harus minimal mencakup empat layer.

### 2.1 Platform Observability

Ini menjawab:

```text
Apakah platform Camunda 8 sehat?
```

Objek yang diamati:

- Zeebe Gateway,
- Zeebe Broker,
- partitions,
- replication,
- exporters,
- Operate,
- Tasklist,
- Optimize,
- Identity,
- Connectors runtime,
- Elasticsearch/OpenSearch,
- Kubernetes nodes/pods/PVC,
- network/ingress/service mesh.

Contoh sinyal:

```text
- broker unavailable
- partition leader unavailable
- exporter lag
- disk pressure
- backpressure active
- gateway request latency naik
- secondary storage indexing lambat
- Operate import lag
```

### 2.2 Worker Observability

Ini menjawab:

```text
Apakah Java worker saya mengambil, memproses, dan menyelesaikan job dengan benar?
```

Objek yang diamati:

- job type,
- worker name,
- activation count,
- completion count,
- failure count,
- BPMN error count,
- retry exhaustion,
- active job count,
- handler latency,
- downstream latency,
- idempotency hit/miss,
- outbox/inbox status,
- worker shutdown/drain behavior.

### 2.3 Process Observability

Ini menjawab:

```text
Apakah process instance berjalan sesuai model, SLA, dan business expectation?
```

Objek yang diamati:

- BPMN process id,
- process definition version,
- process instance key,
- business key / case id,
- flow node id,
- incident,
- timer,
- message subscription,
- user task,
- cycle time,
- waiting time,
- retries,
- compensation/escalation.

### 2.4 Business Observability

Ini menjawab:

```text
Apa dampaknya ke bisnis, user, regulator, SLA, dan operasi manusia?
```

Objek yang diamati:

- jumlah case masuk,
- jumlah case completed,
- pending queue,
- aging,
- SLA breach,
- rejection reason,
- appeal rate,
- manual override,
- regulatory deadline,
- workload by team/group,
- decision consistency,
- audit gap.

Layer ini biasanya tidak bisa hanya bergantung pada metrics broker. Ia perlu variable yang dirancang, projection yang benar, dan definisi KPI yang eksplisit.

---

## 3. Command Path vs Read Path: Kesalahan Observability yang Sering Terjadi

Camunda 8 memiliki perbedaan penting:

```text
Command/write path:
  Java Client / REST / gRPC
    -> Gateway
      -> Broker / partition
        -> durable stream + state

Read/projection path:
  Broker stream
    -> exporter/importer
      -> Elasticsearch/OpenSearch or component storage
        -> Operate / Tasklist / Optimize / custom dashboard
```

Akibatnya:

```text
Operate, Tasklist, Optimize, dan custom read model adalah projection.
```

Projection bisa lag. Jadi jangan membuat kesimpulan seperti:

```text
Operate belum update = command gagal
```

Yang lebih benar:

```text
Operate belum update bisa berarti:
- command memang gagal,
- command sukses tapi belum diekspor,
- exporter lag,
- secondary storage indexing lambat,
- Operate importer tertunda,
- browser/UI stale,
- query filter salah,
- user tidak punya akses melihat instance/tenant.
```

Dalam incident triage, selalu bedakan:

```text
1. Did the command reach the broker?
2. Did the broker accept or reject it?
3. Did the state transition happen?
4. Was the record exported?
5. Was the projection updated?
6. Was the UI/API reading the projection correctly?
```

Jika tidak membedakan command path dan read path, engineer mudah melakukan tindakan yang salah:

```text
- re-trigger process padahal process sudah dibuat,
- resend message padahal message sudah buffered,
- retry external API padahal side effect sudah terjadi,
- resolve incident tanpa tahu apakah variable repair valid,
- menyalahkan worker padahal exporter lag.
```

---

## 4. Sinyal Utama: Logs, Metrics, Traces, Events, and Projections

Observability bukan satu alat. Ia kombinasi beberapa jenis sinyal.

### 4.1 Logs

Logs adalah narasi kejadian.

Cocok untuk:

- debugging detail,
- error context,
- decision reason,
- variable validation failure,
- external API response classification,
- worker lifecycle,
- correlation id propagation,
- audit-like technical explanation.

Tidak cocok untuk:

- high-cardinality aggregate dashboard,
- real-time SLA counting,
- reliable audit source tunggal,
- long-term analytics tanpa pipeline khusus.

### 4.2 Metrics

Metrics adalah angka time-series.

Cocok untuk:

- alerting,
- trend,
- saturation,
- latency percentile,
- throughput,
- error rate,
- backlog,
- SLO tracking.

Tidak cocok untuk:

- menjelaskan satu case spesifik secara lengkap,
- menyimpan payload detail,
- business audit individual.

### 4.3 Traces

Traces adalah hubungan antar operation dalam satu request/flow teknis.

Cocok untuk:

- melihat latency breakdown,
- hubungan inbound API -> worker -> DB -> external API,
- propagation antar microservice,
- root cause latency.

Tantangan di Camunda:

```text
Process instance berjalan lama dan asynchronous.
```

Jadi trace tradisional tidak selalu mencakup seluruh lifecycle process. Kita butuh correlation key yang menyambungkan trace teknis yang terpisah.

### 4.4 Events / Exported Records

Exported records adalah jejak proses dari engine.

Cocok untuk:

- process timeline,
- audit projection,
- custom monitoring,
- process analytics,
- incident reconstruction,
- SLA calculation,
- external compliance reporting.

Perlu hati-hati:

- exporter lag,
- storage retention,
- schema evolution,
- PII masking,
- index cost,
- replay semantics.

### 4.5 Projections

Projection adalah read model hasil transformasi stream/event.

Contoh:

- Operate process view,
- Tasklist task queue,
- Optimize analytics,
- custom audit timeline,
- custom SLA dashboard,
- custom case status table.

Projection harus diperlakukan sebagai eventually consistent view, bukan satu-satunya sumber kebenaran command execution.

---

## 5. Minimum Correlation Fields untuk Java Worker

Tanpa correlation fields yang konsisten, logs dan traces akan menjadi noise.

Untuk setiap log worker, minimal sertakan:

```text
- trace_id
- span_id
- correlation_id
- business_key / case_id
- process_instance_key
- process_definition_key
- bpmn_process_id
- process_version
- flow_node_id / element_id
- job_key
- job_type
- worker_name
- tenant_id
- retries_left
- attempt_number jika tersedia dari dedup store atau custom state
- command_id / operation_id untuk external side effect
```

Tidak semua field selalu tersedia di semua titik. Tetapi prinsipnya:

```text
Setiap kejadian worker harus bisa dikaitkan kembali ke process instance dan business entity.
```

Contoh log buruk:

```text
ERROR Failed to verify applicant
```

Contoh log lebih baik:

```json
{
  "level": "ERROR",
  "message": "Applicant verification failed due to downstream timeout",
  "service": "verification-worker",
  "environment": "prod",
  "workerName": "verification-worker-prod-a",
  "jobType": "applicant.verify.v2",
  "jobKey": "2251799814023312",
  "processInstanceKey": "2251799813988841",
  "bpmnProcessId": "regulatory_application_review",
  "processVersion": 17,
  "elementId": "Task_VerifyApplicant",
  "businessKey": "APP-2026-000193",
  "tenantId": "cea",
  "correlationId": "corr-01JY...",
  "externalSystem": "registry-api",
  "externalOperationId": "verify:APP-2026-000193:v2",
  "retriesLeft": 2,
  "durationMs": 5031,
  "errorClass": "DOWNSTREAM_TIMEOUT",
  "retryable": true
}
```

Kunci penting:

```text
Log bukan hanya untuk manusia membaca error.
Log adalah data structure untuk forensics.
```

---

## 6. Correlation ID vs Business Key vs Process Instance Key vs Job Key

Empat identifier ini sering tertukar.

### 6.1 Correlation ID

Correlation ID adalah identifier teknis untuk menghubungkan operasi lintas service.

Contoh:

```text
HTTP request from API Gateway
  -> process starter
    -> Camunda command
      -> worker
        -> downstream API
```

Correlation ID bagus untuk tracing request teknis, tetapi belum tentu stabil selama lifecycle proses panjang.

### 6.2 Business Key / Case ID

Business key adalah identifier domain.

Contoh:

```text
APP-2026-000193
CASE-2026-000044
APPEAL-2026-000007
ENF-2026-000011
```

Ini yang biasanya dipahami user, regulator, support team, dan business dashboard.

### 6.3 Process Instance Key

Process instance key adalah identifier engine untuk satu instance.

Ini penting untuk:

- Operate lookup,
- incident lookup,
- exported record correlation,
- command targeting,
- technical debugging.

Tetapi jangan jadikan ini identifier utama untuk user-facing domain. Ia engine-specific.

### 6.4 Job Key

Job key adalah identifier satu job activation/execution obligation.

Ini penting untuk:

- worker logs,
- completion/failure command,
- timeout/duplicate execution analysis,
- idempotency support.

Tetapi job key bukan business operation identity yang cukup untuk external side effect. Jika job di-recreated atau process dimigrasi, strategi idempotency harus tetap domain-safe.

### 6.5 Mapping Praktis

Gunakan pola berikut:

```text
business_key:
  identifier domain utama

process_instance_key:
  identifier engine instance

job_key:
  identifier technical execution attempt/lease

correlation_id:
  identifier request/trace lintas service

operation_id:
  identifier idempotent external side effect
```

Contoh operation ID:

```text
verify-applicant:APP-2026-000193:v2
send-notification:APP-2026-000193:APPROVAL_EMAIL:v1
reserve-payment:INVOICE-2026-0011:v1
```

---

## 7. Observability Context Propagation di Java Worker

Worker execution biasanya dimulai dari job activation, bukan inbound HTTP request. Artinya tidak selalu ada trace context dari upstream.

Solusi:

```text
1. Simpan correlation_id di process variable saat process dibuat.
2. Worker membaca correlation_id dari variable.
3. Worker memasukkan field itu ke MDC/log context.
4. Worker membuat span baru dengan link/attribute ke process_instance_key/job_key.
5. Outbound HTTP/gRPC message membawa correlation_id dan traceparent jika tersedia.
```

### 7.1 Contoh MDC Scope

```java
public final class WorkerLogContext implements AutoCloseable {
    private final Map<String, String> previous = new HashMap<>();
    private final List<String> keys = List.of(
            "correlationId",
            "businessKey",
            "processInstanceKey",
            "jobKey",
            "jobType",
            "elementId",
            "tenantId"
    );

    private WorkerLogContext(Map<String, String> values) {
        for (String key : keys) {
            previous.put(key, MDC.get(key));
            String value = values.get(key);
            if (value != null && !value.isBlank()) {
                MDC.put(key, value);
            }
        }
    }

    public static WorkerLogContext fromJob(ActivatedJob job, Map<String, Object> vars) {
        Map<String, String> values = new HashMap<>();
        values.put("processInstanceKey", String.valueOf(job.getProcessInstanceKey()));
        values.put("jobKey", String.valueOf(job.getKey()));
        values.put("jobType", job.getType());
        values.put("elementId", job.getElementId());
        values.put("tenantId", job.getTenantId());
        values.put("businessKey", stringVar(vars, "businessKey"));
        values.put("correlationId", stringVar(vars, "correlationId"));
        return new WorkerLogContext(values);
    }

    private static String stringVar(Map<String, Object> vars, String name) {
        Object value = vars.get(name);
        return value == null ? null : String.valueOf(value);
    }

    @Override
    public void close() {
        for (String key : keys) {
            String oldValue = previous.get(key);
            if (oldValue == null) {
                MDC.remove(key);
            } else {
                MDC.put(key, oldValue);
            }
        }
    }
}
```

Pemakaian:

```java
@JobWorker(type = "applicant.verify.v2", autoComplete = false)
public void handleApplicantVerification(ActivatedJob job, JobClient client) {
    Map<String, Object> vars = job.getVariablesAsMap();

    try (WorkerLogContext ignored = WorkerLogContext.fromJob(job, vars)) {
        log.info("Starting applicant verification");
        // business execution
        log.info("Applicant verification completed");
    }
}
```

Catatan:

```text
Contoh ini menunjukkan pola; class dan import aktual perlu mengikuti versi Camunda Java Client / Spring Boot Starter yang digunakan.
```

---

## 8. Structured Logging Design

Untuk worker production-grade, hindari log bebas tanpa struktur.

Gunakan JSON logs atau setidaknya structured key-value logs.

### 8.1 Event Log Taxonomy

Tentukan event name konsisten:

```text
worker.job.received
worker.job.started
worker.job.validation_failed
worker.idempotency.hit
worker.idempotency.miss
worker.external_call.started
worker.external_call.succeeded
worker.external_call.failed
worker.job.completed
worker.job.failed_retryable
worker.job.failed_non_retryable
worker.job.bpmn_error_thrown
worker.job.incident_expected
worker.shutdown.started
worker.shutdown.draining
worker.shutdown.completed
```

Mengapa penting?

Karena event name yang konsisten memungkinkan query seperti:

```text
count worker.job.failed_retryable by jobType, errorClass
p95 durationMs for worker.external_call.succeeded where externalSystem=registry-api
search worker.idempotency.hit where businessKey=APP-2026-000193
```

### 8.2 Log Level Policy

Gunakan policy eksplisit:

| Kondisi | Level |
|---|---:|
| Worker started/stopped | INFO |
| Job started/completed | INFO atau DEBUG tergantung volume |
| Business rejection expected | INFO/WARN |
| Retryable downstream failure | WARN |
| Non-retryable technical corruption | ERROR |
| Incident expected after retries exhausted | ERROR |
| Duplicate idempotency replay | INFO |
| Sensitive payload | Jangan log |

Jangan menjadikan semua retryable failure sebagai ERROR jika sistem retry memang expected. Tetapi ketika retry budget hampir habis, naikkan severity.

### 8.3 Jangan Log Variable Mentah

Anti-pattern:

```java
log.info("Job variables: {}", job.getVariables());
```

Risiko:

- PII bocor,
- secret bocor,
- payload besar membebani logging pipeline,
- biaya observability naik,
- compliance risk,
- log search menjadi noise.

Lebih baik:

```java
log.info("Job variables summary: variableNames={}, payloadBytes={}, schemaVersion={}",
        vars.keySet(),
        estimatePayloadBytes(job),
        vars.get("schemaVersion"));
```

Jika butuh debug payload, gunakan:

- masking,
- sampling,
- environment non-prod,
- explicit support procedure,
- short retention,
- approval untuk production sensitive data.

---

## 9. Metrics Design untuk Camunda 8 Worker

Metrics harus menjawab tiga pertanyaan:

```text
1. Apakah worker menerima job?
2. Apakah worker menyelesaikan job dengan sukses?
3. Apakah worker memperlambat atau merusak proses?
```

### 9.1 Core Worker Metrics

Minimal:

```text
camunda_worker_job_started_total
camunda_worker_job_completed_total
camunda_worker_job_failed_total
camunda_worker_bpmn_error_total
camunda_worker_job_duration_seconds
camunda_worker_external_call_duration_seconds
camunda_worker_idempotency_hit_total
camunda_worker_idempotency_miss_total
camunda_worker_active_jobs
camunda_worker_shutdown_drain_seconds
```

Tag/label yang berguna:

```text
job_type
worker_name
process_id
element_id
tenant_id
environment
error_class
external_system
outcome
```

### 9.2 Hati-hati High Cardinality

Jangan gunakan label metrics seperti:

```text
process_instance_key
job_key
business_key
correlation_id
error_message bebas
customer_id
user_id
```

Kenapa?

Karena metrics backend seperti Prometheus akan membuat time series baru untuk setiap kombinasi label. Ini bisa membuat cardinality explosion.

Gunakan high-cardinality identifier di logs/traces, bukan metrics labels.

### 9.3 Recommended Metric Label Rule

```text
Metrics labels = low-cardinality dimensions for aggregate analysis.
Logs/traces = high-cardinality identifiers for specific case analysis.
```

Contoh baik:

```text
camunda_worker_job_duration_seconds{
  job_type="applicant.verify.v2",
  worker_name="verification-worker",
  external_system="registry-api",
  outcome="success"
}
```

Contoh buruk:

```text
camunda_worker_job_duration_seconds{
  business_key="APP-2026-000193",
  process_instance_key="2251799813988841",
  job_key="2251799814023312"
}
```

---

## 10. Micrometer Metrics di Spring Worker

Camunda Spring Boot Starter menyediakan beberapa metrics yang bisa diekspos melalui Spring Actuator ketika Actuator tersedia. Dokumentasi Camunda menyebut metric seperti invocations untuk job workers dengan tag job type dan action. Selain bawaan, sistem production biasanya tetap perlu custom metrics domain/worker-specific.

Contoh custom metric dengan Micrometer:

```java
@Component
public final class WorkerMetrics {
    private final MeterRegistry registry;

    public WorkerMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    public Timer jobTimer(String jobType, String outcome) {
        return Timer.builder("app.camunda.worker.job.duration")
                .tag("job_type", jobType)
                .tag("outcome", outcome)
                .publishPercentileHistogram()
                .register(registry);
    }

    public void incrementFailure(String jobType, String errorClass, boolean retryable) {
        Counter.builder("app.camunda.worker.job.failure")
                .tag("job_type", jobType)
                .tag("error_class", errorClass)
                .tag("retryable", String.valueOf(retryable))
                .register(registry)
                .increment();
    }

    public void incrementBpmnError(String jobType, String errorCode) {
        Counter.builder("app.camunda.worker.bpmn_error")
                .tag("job_type", jobType)
                .tag("error_code", errorCode)
                .register(registry)
                .increment();
    }
}
```

Pemakaian:

```java
@JobWorker(type = "applicant.verify.v2", autoComplete = false)
public void verify(ActivatedJob job, JobClient client) {
    Timer.Sample sample = Timer.start(meterRegistry);
    String outcome = "unknown";

    try {
        // execute domain logic
        outcome = "success";
        client.newCompleteCommand(job.getKey()).send().join();
    } catch (BusinessRejectionException ex) {
        outcome = "bpmn_error";
        workerMetrics.incrementBpmnError(job.getType(), ex.errorCode());
        client.newThrowErrorCommand(job.getKey())
                .errorCode(ex.errorCode())
                .errorMessage(ex.getMessage())
                .send()
                .join();
    } catch (Exception ex) {
        outcome = "failed";
        workerMetrics.incrementFailure(job.getType(), classify(ex), true);
        client.newFailCommand(job.getKey())
                .retries(Math.max(0, job.getRetries() - 1))
                .errorMessage(safeMessage(ex))
                .send()
                .join();
    } finally {
        sample.stop(workerMetrics.jobTimer(job.getType(), outcome));
    }
}
```

Catatan penting:

```text
Jangan membuat metric baru di hot path dengan kombinasi tag tidak terkendali.
```

Di production, sebaiknya meter sudah distandardisasi melalui helper class.

---

## 11. Zeebe / Camunda Platform Metrics

Camunda Self-Managed components mengekspos metrics untuk monitoring. Camunda menggunakan Micrometer sebagai facade untuk export metrics ke implementasi seperti Prometheus, OpenTelemetry, Datadog, dan Dynatrace. Untuk platform production, Prometheus + Grafana sering menjadi baseline, tetapi prinsipnya sama untuk backend observability lain.

Platform metrics yang perlu diperhatikan:

### 11.1 Broker Metrics

Pantau:

```text
- command processing latency
- job creation/activation/completion/failure rate
- incident count/rate
- partition health
- leader/follower status
- stream processor lag
- exporter lag
- disk usage
- snapshot activity
- backpressure state
```

Interpretasi:

```text
Broker CPU tinggi + processing latency tinggi
  -> broker processing bottleneck

Exporter lag naik + broker processing normal
  -> read-side/projection pressure

Disk usage tinggi + snapshot/export slow
  -> storage pressure risk

Leader unavailable
  -> availability issue at partition level
```

### 11.2 Gateway Metrics

Pantau:

```text
- request rate
- request latency
- rejected command count
- authentication/authorization failure
- client connection behavior
- REST/gRPC request errors
```

Gateway adalah entry point. Jika gateway latency tinggi, semua client command bisa terdampak walaupun broker masih sehat.

### 11.3 Exporter Metrics

Pantau:

```text
- exporter position
- exporter lag
- export error count
- export latency
- secondary storage write failure
```

Jika exporter lag, Operate/Tasklist/Optimize/custom projection bisa terlambat.

### 11.4 Operate/Tasklist/Optimize Metrics

Pantau:

```text
- importer lag
- API latency
- query latency
- index/storage error
- task import delay
- Optimize import delay
```

Jangan hanya memonitor UI uptime. UI bisa hidup tetapi datanya stale.

### 11.5 Elasticsearch/OpenSearch Metrics

Pantau:

```text
- cluster health
- index write latency
- indexing queue
- disk watermark
- JVM heap
- GC pause
- shard allocation
- search latency
- rejected writes/searches
```

Camunda observability sering gagal karena secondary storage dianggap “hanya dependency”. Padahal Operate, Tasklist, Optimize, dan analytics sangat bergantung pada read-side storage.

---

## 12. Backpressure Observability

Backpressure adalah sinyal bahwa sistem sedang melindungi dirinya dari overload.

Jangan melihat backpressure sebagai error biasa. Ia adalah mekanisme survival.

### 12.1 Gejala

```text
- command rejected karena RESOURCE_EXHAUSTED / backpressure
- process instance start rate turun
- job completion command lambat
- worker melihat command send failure
- retry client meningkat
- latency gateway naik
```

### 12.2 Penyebab Umum

```text
- broker CPU/disk bottleneck
- partition overload
- payload terlalu besar
- exporter lambat
- secondary storage lambat
- terlalu banyak process instance start
- worker completion burst
- retry storm
```

### 12.3 Observability yang Dibutuhkan

Untuk memahami backpressure, gabungkan:

```text
- gateway rejected command metric
- broker processing latency
- partition leader distribution
- exporter lag
- worker command failure logs
- client retry metrics
- process start/completion throughput
- payload size metrics
```

Jika hanya melihat worker error, engineer mungkin salah menaikkan worker replica. Padahal akar masalah bisa broker/exporter/storage.

---

## 13. Job Backlog dan Worker Health

Job backlog adalah sinyal penting, tetapi definisinya perlu hati-hati.

Pertanyaan yang harus dijawab:

```text
1. Apakah job dibuat lebih cepat dari diselesaikan?
2. Apakah worker tidak aktif?
3. Apakah worker aktif tetapi lambat?
4. Apakah worker gagal terus?
5. Apakah job type tertentu saja yang backlog?
6. Apakah tenant tertentu saja terdampak?
7. Apakah downstream dependency menjadi bottleneck?
```

### 13.1 Worker Metrics Interpretation

```text
job activation rate = 0
  -> no job available, wrong job type, worker disconnected, auth issue, tenant mismatch, or BPMN not reaching task

activation rate high + completion rate low
  -> worker slow, downstream slow, handler blocked, thread pool saturated

failure rate high + retries decreasing
  -> incident risk

BPMN error high
  -> business rejection pattern; mungkin normal atau model issue

idempotency hit high
  -> duplicate execution/retry/network uncertainty meningkat
```

### 13.2 Worker Log Events

Cari event:

```text
worker.job.started
worker.external_call.started
worker.external_call.failed
worker.job.failed_retryable
worker.job.completed
```

Jika `worker.job.started` ada tetapi `worker.job.completed` jarang, berarti bottleneck ada di handler/downstream.

Jika `worker.job.started` tidak ada, berarti masalah lebih awal:

```text
- job tidak tercipta,
- worker tidak activate,
- job type mismatch,
- tenant mismatch,
- worker disconnected,
- credential salah,
- gateway unavailable,
- process instance belum mencapai service task.
```

---

## 14. Process-Aware Alerting

Alert yang baik harus actionable.

Alert buruk:

```text
CPU > 80%
```

Alert lebih baik:

```text
Zeebe broker CPU > 80% selama 10 menit dan command processing latency p95 > threshold
```

Alert lebih process-aware:

```text
Job type applicant.verify.v2 failure rate > 10% selama 15 menit dan active incidents bertambah untuk process regulatory_application_review
```

Alert business-aware:

```text
Applications pending verification older than 2 business days > 50 dan backlog growth rate positif selama 1 jam
```

### 14.1 Alert Categories

Gunakan kategori berikut:

```text
1. Availability alerts
2. Saturation alerts
3. Error-rate alerts
4. Latency alerts
5. Backlog alerts
6. Incident alerts
7. SLA/business alerts
8. Data quality alerts
9. Projection lag alerts
10. Security/auth alerts
```

### 14.2 Alert Examples

| Alert | Meaning | First Action |
|---|---|---|
| Gateway request error spike | Client command path impacted | Check gateway auth/network/broker connectivity |
| Broker partition unhealthy | Orchestration availability risk | Check broker pods, raft/leader, disk |
| Exporter lag increasing | Read model stale risk | Check secondary storage and exporter errors |
| Job failure rate high for job type | Worker/downstream/domain issue | Check worker logs by job type/error class |
| Incident count increasing | Process execution blocked | Triage top incident type in Operate |
| Task queue aging high | Human work bottleneck | Check assignment/group/workload/SLA |
| Message correlation failure high | Integration/correlation bug | Check correlation keys and message IDs |
| Idempotency conflict high | Duplicate command or schema mismatch | Check retry/client/outbox design |

---

## 15. SLO Design untuk Camunda 8

SLO bukan hanya service uptime. Untuk process orchestration, SLO harus mencakup process outcome.

### 15.1 Platform SLO

Contoh:

```text
99.9% of Camunda command requests accepted within 500ms over 30 days
```

Tapi ini belum cukup.

### 15.2 Worker SLO

Contoh:

```text
99% of applicant.verify.v2 jobs completed or classified as business rejection within 2 minutes of activation
```

### 15.3 Process SLO

Contoh:

```text
95% of new application processes reach human review task within 10 minutes after submission
```

### 15.4 Business SLA/SLO

Contoh:

```text
98% of standard applications receive decision within 5 working days, excluding applicant wait time.
```

Yang penting:

```text
Define what clock starts, what clock stops, and what time is excluded.
```

Untuk regulatory workflow, ini sangat penting karena “SLA breach” harus defensible.

---

## 16. Process Timeline Observability

Untuk satu case, support engineer harus bisa membaca timeline:

```text
2026-06-21T09:00:00+07:00 application submitted
2026-06-21T09:00:02+07:00 process instance created
2026-06-21T09:00:05+07:00 VerifyApplicant job created
2026-06-21T09:00:07+07:00 worker activated job
2026-06-21T09:00:12+07:00 Registry API timeout
2026-06-21T09:00:12+07:00 job failed retries=2
2026-06-21T09:01:12+07:00 retry activated
2026-06-21T09:01:15+07:00 job completed
2026-06-21T09:01:16+07:00 Review user task created
2026-06-21T10:05:00+07:00 reviewer claimed task
2026-06-21T10:20:00+07:00 task completed APPROVED
```

Sumber data timeline bisa kombinasi:

- exported records,
- Operate API/UI,
- Tasklist events/API,
- worker logs,
- domain DB audit,
- external API logs,
- custom audit projection.

Jangan mengandalkan satu sumber untuk semua kebutuhan.

---

## 17. Observability untuk Incident

Incident bukan hanya error. Incident adalah process instance blocked state yang butuh intervensi atau perbaikan.

### 17.1 Incident Dashboard Minimal

```text
- active incidents by process id
- active incidents by process version
- active incidents by element id
- active incidents by job type
- active incidents by error type/error message class
- incident age distribution
- newly created incidents per hour
- resolved incidents per hour
- recurring incidents after resolution
- incidents by tenant/environment
```

### 17.2 Incident Triage Questions

```text
1. Incident terjadi di process/version mana?
2. Di element/job type mana?
3. Error class apa?
4. Apakah baru setelah deployment?
5. Apakah semua tenant atau tenant tertentu?
6. Apakah external system tertentu?
7. Apakah variable schema berubah?
8. Apakah retries habis karena transient issue atau deterministic bug?
9. Apakah aman retry setelah repair?
10. Apakah ada side effect eksternal yang sudah terjadi?
```

### 17.3 Incident Anti-Pattern

```text
Resolve incident first, think later.
```

Untuk production-grade, resolve incident harus mengikuti checklist:

```text
- root cause identified or bounded,
- variable repair validated,
- side effect outcome known or reconciled,
- worker version compatible,
- retry safe,
- audit note recorded,
- blast radius checked.
```

---

## 18. Observability untuk Message Correlation

Message correlation sering menjadi sumber bug halus.

Pantau:

```text
- messages published total by message name
- message correlation success/failure
- duplicate message id
- buffered message count/age jika tersedia dari projection/custom tracking
- callback received without matching process
- process waiting for message too long
- message TTL expiry rate
```

Log setiap inbound callback:

```json
{
  "event": "inbound_callback.received",
  "messageName": "RegistryVerificationCompleted",
  "businessKey": "APP-2026-000193",
  "correlationKey": "APP-2026-000193",
  "messageId": "registry:APP-2026-000193:result:v1",
  "externalSystem": "registry-api",
  "callbackTimestamp": "2026-06-21T09:01:10+07:00"
}
```

Log publish ke Camunda:

```json
{
  "event": "camunda.message.publish.requested",
  "messageName": "RegistryVerificationCompleted",
  "correlationKey": "APP-2026-000193",
  "messageId": "registry:APP-2026-000193:result:v1",
  "ttlMs": 86400000
}
```

Pertanyaan penting saat correlation issue:

```text
- message name cocok?
- correlation key cocok?
- tenant cocok?
- process sedang menunggu message?
- message datang terlalu cepat?
- TTL cukup?
- duplicate message id?
- process version berubah?
- callback dikirim ke environment yang benar?
```

---

## 19. Observability untuk Timer dan SLA

Timer issue sering terlihat sebagai “process stuck”, padahal process memang sedang menunggu waktu.

Pantau:

```text
- number of active timers by process/element
- timers due soon
- overdue timers
- timer-triggered escalations
- SLA breach candidates
- average wait time at timer boundary
```

Log saat menghitung deadline:

```json
{
  "event": "deadline.calculated",
  "businessKey": "APP-2026-000193",
  "slaType": "STANDARD_APPLICATION_REVIEW",
  "submittedAt": "2026-06-21T09:00:00+07:00",
  "deadlineAt": "2026-06-26T17:00:00+07:00",
  "businessCalendar": "SG_WORKING_DAY_V1",
  "excludedWaitingState": false
}
```

Jangan hanya menyimpan timer expression tanpa menyimpan alasan deadline.

Untuk regulatory defensibility, simpan:

```text
- input timestamp,
- timezone,
- calendar version,
- exclusion rule,
- computed deadline,
- who/what changed deadline,
- reason for extension.
```

---

## 20. Observability untuk User Tasks dan Workload

Human workflow observability harus menjawab:

```text
Siapa/kelompok mana yang punya pekerjaan, berapa lama, mengapa belum selesai, dan apakah sudah melewati SLA?
```

Metrics/projection:

```text
- open tasks by candidate group
- open tasks by assignee
- task age percentiles
- claim latency
- completion latency
- returned/unassigned tasks
- reassignment count
- overdue tasks
- task outcome distribution
- workload by team
```

Log/audit event:

```text
task.created
task.claimed
task.assigned
task.returned
task.completed
task.cancelled
task.escalated
task.reassigned
task.due_date_changed
```

Untuk custom task app, selalu log:

```text
- task id/user task key,
- process instance key,
- business key,
- user id,
- group/role at action time,
- decision outcome,
- submitted form version,
- validation result,
- optimistic locking/conflict result.
```

---

## 21. Observability untuk External Side Effects

External side effect adalah titik paling berbahaya karena Camunda hanya tahu job berhasil/gagal, bukan selalu tahu apakah downstream benar-benar melakukan efek.

Contoh side effect:

- kirim email,
- reserve payment,
- update registry,
- create document,
- notify external agency,
- create case in legacy system,
- call screening engine.

Untuk setiap side effect, observability minimal:

```text
- operation_id
- idempotency_key
- external_system
- request_hash
- response_status
- external_reference_id
- attempt_count
- final_outcome
- reconciliation_status
```

Contoh outbox table fields:

```text
id
operation_id
business_key
process_instance_key
job_key
job_type
external_system
request_hash
status
attempt_count
last_error_class
external_reference_id
created_at
updated_at
completed_at
```

Tanpa ini, ketika worker timeout setelah external call, Anda tidak bisa menjawab:

```text
Apakah efek eksternal sudah terjadi?
```

Dan kalau tidak bisa menjawab itu, retry bisa berbahaya.

---

## 22. Distributed Tracing untuk Worker

Tracing membantu melihat latency breakdown.

Namun di Camunda, jangan berharap satu trace mencakup seluruh lifecycle process selama berhari-hari.

Gunakan dua konsep:

```text
1. Trace untuk satu execution segment.
2. Correlation/business/process identifiers untuk menyambungkan segment.
```

Contoh segment:

```text
segment A: SubmitApplication HTTP request -> create process instance
segment B: VerifyApplicant worker -> Registry API -> DB
segment C: Callback handler -> publish message
segment D: Task completion API -> complete user task
segment E: NotifyApplicant worker -> Email service
```

Setiap segment punya trace sendiri, tetapi semua punya:

```text
businessKey=APP-2026-000193
processInstanceKey=2251799813988841
correlationId=corr-...
```

### 22.1 Span Attributes

Untuk OpenTelemetry span, gunakan attributes seperti:

```text
camunda.process.instance_key
camunda.process.definition_key
camunda.process.bpmn_process_id
camunda.process.version
camunda.job.key
camunda.job.type
camunda.element.id
camunda.tenant.id
app.business_key
app.operation_id
app.external_system
```

Hindari payload besar sebagai span attribute.

---

## 23. Dashboard Design

Dashboard harus dibagi sesuai persona.

### 23.1 Platform Dashboard

Audience:

- platform engineer,
- SRE,
- DevOps,
- runtime owner.

Panel:

```text
- gateway request rate/latency/errors
- broker health
- partition leadership
- processing latency
- backpressure
- exporter lag
- disk/PVC usage
- JVM heap/GC
- pod restarts
- Elasticsearch/OpenSearch health
```

### 23.2 Worker Dashboard

Audience:

- Java engineer,
- service owner.

Panel:

```text
- job activations/completions/failures by job type
- handler latency p50/p95/p99
- active jobs
- downstream latency
- idempotency hit/miss
- retry exhaustion
- BPMN error count
- worker pod restart
- thread pool / connection pool saturation
```

### 23.3 Process Dashboard

Audience:

- process owner,
- support lead,
- BA/QA,
- TL.

Panel:

```text
- process instances started/completed/cancelled
- active instances by state
- incidents by process/element
- cycle time
- SLA breach risk
- bottleneck element
- message wait age
- timer wait count
```

### 23.4 Business Dashboard

Audience:

- operations manager,
- regulatory owner,
- management.

Panel:

```text
- submitted applications
- completed decisions
- pending by stage
- overdue by team
- approval/rejection rate
- appeal rate
- enforcement escalation count
- average processing days
- percentile processing days
```

Jangan mencampur semua persona dalam satu dashboard raksasa. Itu akan menjadi noisy dan tidak actionable.

---

## 24. Runbook-Driven Observability

Dashboard tanpa runbook hanya dekorasi.

Untuk setiap alert, tulis:

```text
- What does this alert mean?
- What is the user/business impact?
- What are the first 5 checks?
- Which dashboard panels matter?
- Which log queries matter?
- Which Operate/Tasklist view matters?
- What should not be done?
- When to escalate?
- How to verify recovery?
- What evidence must be recorded?
```

Contoh:

```text
Alert: applicant.verify.v2 failure rate > 20% for 10 minutes

Impact:
  New applications may not reach review task.

First checks:
  1. Check worker logs by job_type=applicant.verify.v2 and error_class.
  2. Check downstream Registry API latency/error dashboard.
  3. Check active incidents in Operate for element Task_VerifyApplicant.
  4. Check recent deployment of verification-worker.
  5. Check idempotency/outbox table for stuck operations.

Do not:
  - blindly increase retries,
  - manually complete jobs,
  - resolve incidents before side effect status is known.

Recovery validation:
  - failure rate returns to baseline,
  - incident count stops increasing,
  - backlog decreases,
  - sample business keys reach review task.
```

---

## 25. Log Query Patterns

Useful queries depend on your log backend, but conceptually:

### 25.1 Find All Logs for One Case

```text
businessKey="APP-2026-000193"
```

### 25.2 Find Worker Failures by Job Type

```text
service="verification-worker"
AND jobType="applicant.verify.v2"
AND event="worker.job.failed_retryable"
```

### 25.3 Find Incident-Causing Errors

```text
event="worker.job.failed_retryable"
AND retriesLeft=0
```

### 25.4 Find Downstream Timeout Pattern

```text
externalSystem="registry-api"
AND errorClass="DOWNSTREAM_TIMEOUT"
```

### 25.5 Find Duplicate/Idempotent Replays

```text
event="worker.idempotency.hit"
AND jobType="applicant.verify.v2"
```

### 25.6 Find After Deployment Regression

```text
service="verification-worker"
AND version="2026.06.21-14"
AND level >= WARN
```

---

## 26. Metrics Query Patterns

Examples in Prometheus-style thinking.

### 26.1 Job Failure Rate

```promql
sum(rate(app_camunda_worker_job_failure_total[5m])) by (job_type, error_class)
```

### 26.2 Job Completion Rate

```promql
sum(rate(app_camunda_worker_job_completed_total[5m])) by (job_type)
```

### 26.3 Handler p95 Latency

```promql
histogram_quantile(
  0.95,
  sum(rate(app_camunda_worker_job_duration_seconds_bucket[5m])) by (le, job_type)
)
```

### 26.4 External API p99 Latency

```promql
histogram_quantile(
  0.99,
  sum(rate(app_camunda_worker_external_call_duration_seconds_bucket[5m])) by (le, external_system)
)
```

### 26.5 Failure-to-Completion Ratio

```promql
sum(rate(app_camunda_worker_job_failure_total[5m])) by (job_type)
/
sum(rate(app_camunda_worker_job_completed_total[5m])) by (job_type)
```

Catatan:

```text
PromQL aktual harus disesuaikan dengan nama metric dan label di runtime Anda.
```

---

## 27. Observability untuk Deployment dan Release

Setiap deployment worker/BPMN harus bisa dihubungkan ke perubahan sinyal.

Log deployment event:

```text
- application version
- git commit
- image tag
- BPMN process version
- job type versions supported
- variable schema versions supported
- config profile
- Camunda client version
- Java version
```

Dashboard release overlay:

```text
vertical marker: worker version deployed
vertical marker: BPMN version deployed
vertical marker: Camunda cluster upgraded
```

Regression detection:

```text
- failure rate after deployment
- incident count after deployment
- p95 latency after deployment
- process completion rate after deployment
- task aging after deployment
```

Part penting:

```text
Deploying BPMN and workers independently without observability linkage is dangerous.
```

Kalau process version 18 mulai menghasilkan job type baru tetapi worker version lama tidak support, observability harus segera menunjukkan:

```text
- jobs created but not activated,
- incidents or backlog at new element,
- job type with zero worker activation.
```

---

## 28. Observability untuk Multi-Tenancy

Jika cluster melayani banyak tenant, observability harus menjawab:

```text
Apakah masalah global atau tenant-specific?
```

Tambahkan `tenant_id` sebagai label/log field dengan hati-hati.

Untuk metrics, tenant biasanya low-cardinality jika jumlah tenant terbatas. Jika ribuan tenant, jangan label semua metrics dengan tenant.

Alternative:

```text
- tenant tier,
- region,
- agency/group,
- sampled tenant-specific dashboard,
- custom analytics table untuk per-tenant report.
```

Pertanyaan triage:

```text
- semua tenant gagal atau satu tenant?
- tenant tersebut punya Identity mapping berbeda?
- tenant tersebut punya process version berbeda?
- tenant tersebut punya downstream endpoint berbeda?
- tenant tersebut punya worker route berbeda?
- tenant tersebut punya data volume abnormal?
```

---

## 29. Security Observability

Security observability untuk Camunda 8 mencakup:

```text
- failed authentication to Camunda API
- failed authorization
- token expiry pattern
- unexpected tenant access denial
- worker credential failure
- connector secret lookup failure
- user task unauthorized action
- admin action in Operate/Tasklist/Identity
- suspicious batch operation
- excessive process instance cancellation/modification
```

Log admin/support action:

```text
- actor
- action
- target process instance/task/incident
- timestamp
- reason
- before/after where safe
- approval reference if required
```

Untuk regulated workflow, manual operation seperti:

```text
- variable edit,
- incident resolve,
- process cancel,
- task reassignment,
- process instance modification,
```

harus masuk audit trail terpisah dari technical logs.

---

## 30. PII dan Observability

Observability sering menjadi jalur kebocoran data.

Aturan:

```text
Do not make logs the shadow database.
```

Jangan log:

- NRIC/passport number,
- full name jika tidak perlu,
- email/phone tanpa masking,
- alamat,
- token,
- secret,
- full document text,
- full form payload,
- medical/legal sensitive info,
- raw MyInfo/Singpass payload,
- raw external API response.

Gunakan:

```text
- business key internal,
- masked value,
- hash for matching,
- reference id,
- classification code,
- reason code,
- field presence boolean,
- validation error code.
```

Contoh:

```json
{
  "event": "worker.validation_failed",
  "businessKey": "APP-2026-000193",
  "field": "postalCode",
  "errorCode": "INVALID_POSTAL_CODE_FORMAT"
}
```

Bukan:

```json
{
  "event": "worker.validation_failed",
  "payload": {
    "name": "...",
    "nric": "...",
    "address": "..."
  }
}
```

---

## 31. Audit vs Observability

Audit dan observability berkaitan, tetapi tidak sama.

### 31.1 Observability

Tujuan:

```text
Debug, monitor, detect, operate.
```

Karakteristik:

- high volume,
- short/medium retention,
- sampling mungkin ada,
- technical detail,
- optimized for query/alert.

### 31.2 Audit

Tujuan:

```text
Explain, prove, comply, reconstruct official decision history.
```

Karakteristik:

- controlled schema,
- longer retention,
- immutability/tamper-evidence,
- business/legal meaning,
- access controlled,
- not sampled,
- defensible.

### 31.3 Practical Rule

```text
Observability boleh membantu audit investigation,
tetapi jangan jadikan log observability sebagai official audit trail tunggal.
```

Untuk Camunda 8, official audit projection bisa dibangun dari:

- process exported records,
- user task actions,
- domain decision events,
- support/admin action events,
- external side-effect ledger.

---

## 32. Custom Process Monitoring Projection

Untuk enterprise/regulatory platform, sering perlu custom projection.

Contoh table:

```text
case_process_status
-------------------
business_key
process_instance_key
bpmn_process_id
process_version
current_stage
current_element_id
current_assignee
current_candidate_group
status
sla_deadline
sla_state
incident_state
last_event_time
updated_at
```

Contoh `case_process_timeline`:

```text
id
business_key
process_instance_key
event_time
event_type
stage
element_id
job_type
actor_type
actor_id
outcome
reason_code
source
metadata_json
```

Manfaat:

- custom dashboard cepat,
- regulatory report,
- case UI status,
- SLA calculation,
- support query by business key,
- historical analytics.

Risiko:

- projection lag,
- duplicate event handling,
- schema evolution,
- replay handling,
- PII leakage,
- divergence from engine state.

Solusi:

```text
Treat custom projection as derived read model.
Make it idempotent.
Record source event position/id.
Support replay.
Expose freshness/lag.
```

---

## 33. Freshness and Lag Indicators

Setiap read-side dashboard harus punya indikator freshness:

```text
Last imported event time: 2026-06-21T10:30:00+07:00
Current wall time:        2026-06-21T10:31:20+07:00
Projection lag:           80 seconds
```

Tanpa freshness indicator, user bisa mengira dashboard real-time padahal tertinggal.

Untuk Operate/Tasklist/Optimize/custom projection:

```text
- tampilkan last update time,
- monitor importer/exporter lag,
- alert jika lag melewati threshold,
- jangan membuat automation command berdasarkan stale projection tanpa guard.
```

---

## 34. Observability Failure Modes

Observability juga bisa gagal.

### 34.1 Logging Pipeline Down

Dampak:

```text
- worker tetap berjalan,
- tetapi debugging hilang,
- compliance investigation terganggu jika salah mengandalkan log.
```

Mitigasi:

```text
- non-blocking logging,
- bounded queue,
- fallback local/stdout,
- alert on log ingestion gap,
- separate audit pipeline untuk critical events.
```

### 34.2 Metrics Backend Down

Dampak:

```text
- alert hilang,
- dashboard kosong,
- incident detection lambat.
```

Mitigasi:

```text
- blackbox checks,
- multi-layer alerts,
- platform health alarms,
- runbook for observability outage.
```

### 34.3 Tracing Sampling Too Aggressive

Dampak:

```text
- rare failures tidak terlihat.
```

Mitigasi:

```text
- tail-based sampling untuk error/slow traces,
- always sample support/debug business key during incident,
- keep logs with identifiers.
```

### 34.4 High Cardinality Explosion

Dampak:

```text
- metrics backend mahal/lambat/down,
- dashboard tidak usable.
```

Mitigasi:

```text
- cardinality budget,
- label review,
- no businessKey/jobKey/processInstanceKey in metrics label,
- use logs/traces for case-specific ID.
```

---

## 35. End-to-End Example: Application Verification Incident

Scenario:

```text
Process: regulatory_application_review
Element: Task_VerifyApplicant
Job type: applicant.verify.v2
External system: Registry API
Business key: APP-2026-000193
```

### 35.1 Alert Fires

```text
Alert:
  applicant.verify.v2 failure rate > 25% for 10 minutes
  active incidents increasing
```

### 35.2 First Dashboard View

Worker dashboard:

```text
- failure rate naik sejak 09:15
- external API p95 latency naik ke 8s
- completion rate turun
- idempotency miss normal
```

Platform dashboard:

```text
- gateway normal
- broker normal
- exporter lag normal
```

Process dashboard:

```text
- process stuck at Task_VerifyApplicant
- review task creation rate turun
```

Business dashboard:

```text
- pending verification backlog naik
- SLA breach not yet, but risk increasing
```

### 35.3 Log Investigation

Query:

```text
jobType="applicant.verify.v2" AND errorClass="DOWNSTREAM_TIMEOUT"
```

Find:

```json
{
  "event": "worker.external_call.failed",
  "externalSystem": "registry-api",
  "errorClass": "DOWNSTREAM_TIMEOUT",
  "durationMs": 10000,
  "retryable": true
}
```

### 35.4 Root Cause Bound

Likely:

```text
Registry API latency spike.
```

But check:

```text
- recent worker deployment? no
- registry API status? degraded
- connection pool saturated? yes, because timeout too high and concurrency too high
- retry storm? beginning
```

### 35.5 Action

```text
- reduce worker maxJobsActive temporarily,
- increase retry backoff,
- coordinate with Registry API team,
- prevent retry storm,
- monitor backlog drain,
- do not manually resolve incidents until downstream stable,
- reconcile any unknown external operations.
```

### 35.6 Recovery Verification

```text
- external latency normal
- failure rate normal
- job completion rate > creation rate
- active incidents decreasing
- backlog decreasing
- sample business keys progress to Review task
```

### 35.7 Post-Incident Improvement

```text
- add circuit breaker metric,
- add external dependency SLO,
- tune timeout and maxJobsActive,
- add retry budget alert,
- add dashboard panel for verification backlog age,
- add runbook warning against blind incident retry.
```

---

## 36. Production Observability Checklist

### 36.1 Worker Logging Checklist

- [ ] Every worker log includes job type.
- [ ] Every worker log includes job key when available.
- [ ] Every worker log includes process instance key.
- [ ] Every worker log includes business key/case id.
- [ ] Every worker log includes correlation id.
- [ ] Every worker log includes tenant id if multi-tenant.
- [ ] Error logs include error class, retryable flag, and retries left.
- [ ] Logs do not contain raw sensitive variables.
- [ ] External calls include operation id and external system name.
- [ ] Idempotency hit/miss is logged.

### 36.2 Worker Metrics Checklist

- [ ] Job started/completed/failed counters.
- [ ] BPMN error counter.
- [ ] Job duration histogram.
- [ ] External dependency latency histogram.
- [ ] Idempotency hit/miss counters.
- [ ] Active jobs gauge.
- [ ] Retry exhaustion metric.
- [ ] Labels are low-cardinality.
- [ ] No business key/process instance key/job key in metric labels.

### 36.3 Platform Metrics Checklist

- [ ] Gateway latency/error dashboard.
- [ ] Broker health dashboard.
- [ ] Partition/leader dashboard.
- [ ] Backpressure dashboard.
- [ ] Exporter lag dashboard.
- [ ] Operate/Tasklist/Optimize importer lag dashboard.
- [ ] Elasticsearch/OpenSearch health dashboard.
- [ ] PVC/disk dashboard.
- [ ] Pod restart dashboard.

### 36.4 Process Monitoring Checklist

- [ ] Active instances by process/stage.
- [ ] Incidents by process/version/element/job type.
- [ ] Message wait age.
- [ ] Timer wait age.
- [ ] User task age.
- [ ] Cycle time percentiles.
- [ ] SLA breach/risk dashboard.
- [ ] Process version comparison.

### 36.5 Business Monitoring Checklist

- [ ] Business volume dashboard.
- [ ] Pending/aging dashboard.
- [ ] Completion/rejection dashboard.
- [ ] Workload by group/assignee.
- [ ] SLA clock definition documented.
- [ ] Manual override tracked.
- [ ] Audit projection separated from technical logs.

### 36.6 Runbook Checklist

- [ ] Every critical alert has runbook.
- [ ] Runbook identifies first dashboard.
- [ ] Runbook includes log queries.
- [ ] Runbook includes Operate/Tasklist steps.
- [ ] Runbook includes “do not do this” section.
- [ ] Runbook defines recovery verification.
- [ ] Runbook defines escalation path.
- [ ] Runbook defines evidence to capture.

---

## 37. Anti-Patterns

### 37.1 Only Monitoring Pods

```text
Pod Running != process healthy.
```

A worker pod can run while job type mismatch causes zero activations.

### 37.2 Only Using Operate Manually

Operate is powerful, but manual inspection does not scale.

Use Operate for triage, but build aggregate monitoring and alerts.

### 37.3 Logging Everything

More logs do not mean better observability.

Unstructured, sensitive, huge logs increase cost and risk.

### 37.4 Metrics with High Cardinality IDs

Do not put process instance key, job key, business key, user id, or correlation id into metric labels.

### 37.5 Alerting on Symptoms Without Context

Alert:

```text
Job failures > 0
```

may be useless if business rejections are expected.

Classify failures.

### 37.6 No Deployment Markers

Without release markers, after-incident diagnosis becomes guesswork.

### 37.7 No Projection Lag Awareness

If read-side lag is invisible, support team may make wrong decisions from stale data.

### 37.8 No Idempotency Observability

If duplicate execution happens and you cannot see idempotency behavior, you are blind at the most dangerous part of distributed workflow.

### 37.9 Treating Audit and Logs as Same Thing

Logs are not automatically audit trail.

### 37.10 No Business Key in Logs

If logs only have technical IDs, support cannot answer user-facing questions quickly.

---

## 38. Practical Reference Architecture

```text
                         ┌──────────────────────────────┐
                         │        Business Users         │
                         └──────────────┬───────────────┘
                                        │
                                        v
┌─────────────────┐       ┌──────────────────────────────┐
│ Process Starter │──────>│       Camunda Gateway         │
└───────┬─────────┘       └──────────────┬───────────────┘
        │                                │
        │ logs/traces                    v
        │                     ┌─────────────────────┐
        │                     │    Zeebe Brokers    │
        │                     │ partitions + stream │
        │                     └──────────┬──────────┘
        │                                │ exported records
        v                                v
┌─────────────────┐       ┌──────────────────────────────┐
│ Observability   │<──────│ Elasticsearch / OpenSearch    │
│ logs/metrics/   │       └───────┬──────────┬───────────┘
│ traces          │               │          │
└───────┬─────────┘               v          v
        │                    ┌─────────┐ ┌──────────┐
        │                    │ Operate │ │ Tasklist │
        │                    └─────────┘ └──────────┘
        │                         │          │
        │                         v          v
        │                    support UI   human work
        │
        v
┌─────────────────────────────────────────────────────────┐
│                 Java Worker Services                    │
│ logs: job/process/business/correlation ids              │
│ metrics: job duration/failure/external latency          │
│ traces: worker span + downstream calls                  │
│ ledgers: idempotency/outbox/reconciliation              │
└───────────────┬─────────────────────────────┬───────────┘
                │                             │
                v                             v
        ┌──────────────┐              ┌────────────────┐
        │ Domain DB    │              │ External APIs   │
        │ Audit/Outbox │              │ Registry/Email  │
        └──────────────┘              └────────────────┘
```

Key idea:

```text
No single box owns all observability.
The architecture must propagate identity and correlation across all boxes.
```

---

## 39. Design Heuristics untuk Engineer Senior/Staff

1. **Every process instance must be explainable by business key.**
2. **Every worker job must be traceable to process instance and element id.**
3. **Every external side effect must have operation id and reconciliation path.**
4. **Metrics are for aggregate behavior; logs/traces are for individual cases.**
5. **Projection lag is normal; make it visible.**
6. **Operate is a support view, not a replacement for observability engineering.**
7. **Retries without retry observability become retry storms.**
8. **Incident count without classification is noise.**
9. **Business SLA must define clock start, stop, pause, and exclusion.**
10. **Audit and observability must cooperate but not collapse into one weak mechanism.**
11. **Worker health must be measured by job outcome, not pod status.**
12. **A dashboard without a runbook is not operational readiness.**
13. **Do not log data you would not want leaked.**
14. **High-cardinality labels are observability debt.**
15. **If you cannot correlate across systems, you do not have distributed observability.**

---

## 40. What You Should Be Able to Explain After This Part

Setelah memahami bagian ini, Anda harus bisa menjawab:

1. Mengapa Camunda 8 observability berbeda dari observability service biasa?
2. Apa beda platform observability, worker observability, process observability, dan business observability?
3. Mengapa Operate/Tasklist/Optimize harus dipahami sebagai projection/read-side?
4. Field apa yang wajib ada di log Java worker?
5. Mengapa business key tidak boleh menjadi metric label?
6. Bagaimana mendesain metric untuk job failure dan latency?
7. Apa yang harus dipantau untuk broker, gateway, exporter, dan secondary storage?
8. Bagaimana membedakan worker slow, downstream slow, broker backpressure, dan exporter lag?
9. Bagaimana observability membantu incident triage?
10. Bagaimana mendesain observability untuk message correlation?
11. Bagaimana mendesain observability untuk timer/SLA?
12. Bagaimana membedakan audit trail dan observability logs?
13. Apa risiko logging variable payload mentah?
14. Bagaimana membuat dashboard untuk platform, worker, process, dan business persona?
15. Mengapa setiap alert harus punya runbook?

---

## 41. Latihan Desain

Ambil satu process Camunda 8 yang Anda desain, lalu buat observability plan:

```text
Process:
  <nama process>

Business key:
  <identifier domain>

Critical job types:
  - <job type 1>
  - <job type 2>

Critical external systems:
  - <system 1>
  - <system 2>

Critical human tasks:
  - <task 1>
  - <task 2>

SLA clocks:
  - <clock start>
  - <clock stop>
  - <pause condition>
  - <breach threshold>

Logs required:
  - <event names>

Metrics required:
  - <metric names>

Traces required:
  - <span attributes>

Dashboards:
  - platform
  - worker
  - process
  - business

Alerts:
  - <alert 1>
  - <alert 2>

Runbooks:
  - <runbook 1>
  - <runbook 2>

Audit separation:
  - <what goes to audit trail>
  - <what stays in observability logs>
```

Jika Anda tidak bisa mengisi template ini, berarti proses belum production-ready.

---

## 42. Ringkasan

Camunda 8 / Zeebe observability harus dipahami sebagai observability untuk distributed process orchestration, bukan hanya observability aplikasi Java.

Inti dari bagian ini:

```text
A production-grade Camunda 8 system must make process execution explainable.
```

Explainable berarti:

```text
- tahu process instance mana,
- tahu business entity mana,
- tahu job mana,
- tahu worker mana,
- tahu external side effect mana,
- tahu human task mana,
- tahu timer/SLA mana,
- tahu incident mana,
- tahu projection lag atau tidak,
- tahu dampak bisnisnya.
```

Tanpa itu, sistem orchestration mungkin tetap “berjalan”, tetapi tidak bisa dioperasikan secara aman.

Top 1% engineer tidak hanya bisa membuat BPMN dan worker berjalan. Ia bisa membuat proses itu:

```text
observable,
debuggable,
auditable,
measurable,
recoverable,
and defensible.
```

---

## 43. Referensi

Referensi utama yang relevan untuk bagian ini:

- Camunda Docs — Camunda components metrics: `https://docs.camunda.io/docs/self-managed/operational-guides/monitoring/metrics/`
- Camunda Docs — Camunda exporters: `https://docs.camunda.io/docs/self-managed/concepts/exporters/`
- Camunda Docs — Zeebe architecture: `https://docs.camunda.io/docs/components/zeebe/technical-concepts/architecture/`
- Camunda Docs — Camunda Spring Boot Starter configuration and metrics: `https://docs.camunda.io/docs/apis-tools/camunda-spring-boot-starter/configuration/`
- Camunda Docs — Job worker with Camunda Java Client: `https://docs.camunda.io/docs/apis-tools/java-client/job-worker/`
- Camunda Docs — Kubernetes reference architecture: `https://docs.camunda.io/docs/self-managed/reference-architecture/kubernetes/`
- Camunda Docs — Elasticsearch exporter: `https://docs.camunda.io/docs/self-managed/components/orchestration-cluster/zeebe/exporters/elasticsearch-exporter/`
- Camunda Blog — Performance Tuning in Camunda 8: `https://camunda.com/blog/2025/01/performance-tuning-camunda-8/`

---

## 44. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-026.md
```

Judul:

```text
Part 026 — Testing Strategy: BPMN, Workers, Integration Tests, Testcontainers, and Contract Tests
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-024.md">⬅️ Part 024 — Reliability Engineering: Failure Modes, Recovery, Backups, Snapshots, and DR</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-026.md">Part 026 — Testing Strategy: BPMN, Workers, Integration Tests, Testcontainers, and Contract Tests ➡️</a>
</div>

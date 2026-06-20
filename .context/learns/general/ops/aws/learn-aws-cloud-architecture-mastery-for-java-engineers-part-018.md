# learn-aws-cloud-architecture-mastery-for-java-engineers-part-018.md

# Part 018 — Observability on AWS: CloudWatch, X-Ray, Logs, Metrics, Traces, Alarms

> Target pembaca: Java software engineer / tech lead yang sudah memahami backend, HTTP, Docker, Kubernetes, database, messaging, dan ingin memahami observability di AWS sebagai kemampuan produksi, bukan sekadar “lihat log di CloudWatch”.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- AWS sebagai platform control plane dan data plane;
- account, IAM, credentials, VPC, traffic entry;
- compute choices: EC2, ECS/Fargate, Lambda;
- storage dan managed data;
- event integration dan workflow;
- security architecture.

Sekarang kita masuk ke **observability**.

Observability bukan topik dekoratif. Observability adalah mekanisme agar sistem produksi dapat:

1. diketahui kondisinya;
2. dijelaskan perilakunya;
3. didiagnosis saat gagal;
4. dikendalikan selama incident;
5. dibuktikan secara operasional dan audit;
6. ditingkatkan secara berulang.

Untuk sistem AWS yang serius, pertanyaan utama bukan:

> “Apakah kita punya log?”

Pertanyaan yang lebih benar:

> “Saat user journey gagal, bisakah kita menemukan where, why, blast radius, owner, impact, dan next action dalam waktu yang dapat diterima?”

---

## 1. Mental Model: Monitoring vs Observability

### 1.1 Monitoring

Monitoring menjawab pertanyaan yang sudah kita prediksi sebelumnya.

Contoh:

- CPU > 80%?
- error rate > 5%?
- queue depth > 10.000?
- Lambda throttled?
- ALB target unhealthy?
- RDS storage almost full?

Monitoring cocok untuk known-knowns.

### 1.2 Observability

Observability menjawab pertanyaan baru terhadap sistem yang sedang berjalan, tanpa harus deploy kode baru setiap kali butuh insight.

Contoh:

- Kenapa hanya tenant tertentu yang error?
- Apakah masalah muncul setelah deployment tertentu?
- Apakah latency naik karena downstream payment service, database, S3, atau internal thread pool?
- Apakah event tertentu diproses dua kali?
- Request mana yang menghasilkan state transition ilegal?
- Kenapa workflow case approval stuck di state tertentu?
- Apakah incident ini security issue, capacity issue, data issue, atau config issue?

Observability cocok untuk unknown-unknowns.

### 1.3 Observability bukan satu tool

Di AWS, observability biasanya terdiri dari kombinasi:

- **logs**: bukti naratif kejadian;
- **metrics**: angka agregat untuk tren, alert, dan SLO;
- **traces**: aliran request lintas service;
- **events**: perubahan resource/platform;
- **alarms**: deteksi kondisi abnormal;
- **dashboards**: shared operational view;
- **runbooks**: tindakan saat sinyal tertentu terjadi;
- **audit trails**: siapa melakukan apa, kapan, dari mana;
- **deployment markers**: korelasi perubahan dengan gejala.

Tool AWS yang sering terlibat:

- Amazon CloudWatch Logs;
- CloudWatch Metrics;
- CloudWatch Alarms;
- CloudWatch Dashboards;
- CloudWatch Logs Insights;
- CloudWatch Embedded Metric Format;
- CloudWatch Application Signals;
- AWS X-Ray;
- AWS Distro for OpenTelemetry;
- CloudTrail;
- AWS Config;
- EventBridge;
- AWS Health;
- Service-specific metrics: ALB, ECS, Lambda, RDS, DynamoDB, SQS, etc.

---

## 2. Observability sebagai Feedback Loop Produksi

Sistem produksi tanpa observability adalah sistem yang hanya bisa dipercaya ketika semua berjalan normal.

Observability yang baik membentuk loop:

```text
User Journey
   ↓
Application Behavior
   ↓
Telemetry Emission
   ↓
Aggregation / Correlation / Retention
   ↓
Detection / Alerting / Dashboard
   ↓
Diagnosis
   ↓
Mitigation
   ↓
Learning / Fix / Design Improvement
```

Loop ini gagal jika salah satu elemen berikut hilang:

- aplikasi tidak emit telemetry;
- telemetry tidak punya correlation id;
- logs tidak structured;
- metric terlalu high-cardinality;
- alarm terlalu noisy;
- dashboard hanya resource-centric, bukan journey-centric;
- tidak ada runbook;
- tidak ada owner;
- tidak ada deployment marker;
- tidak ada log retention yang sesuai;
- tidak ada akses saat incident;
- tidak ada audit trail.

Top engineer tidak hanya menambahkan log. Mereka mendesain **observability contract**.

---

## 3. Tiga Pilar Telemetry: Logs, Metrics, Traces

### 3.1 Logs

Logs adalah catatan kejadian diskrit.

Gunakan logs untuk:

- menjelaskan event penting;
- menyimpan konteks debugging;
- mencatat state transition;
- mencatat keputusan bisnis penting;
- mencatat error detail;
- menghubungkan request dengan actor, tenant, case, dan workflow;
- forensic analysis.

Logs bagus untuk detail. Logs buruk untuk alert langsung jika volume besar dan query mahal.

### 3.2 Metrics

Metrics adalah angka yang dapat diagregasi dari waktu ke waktu.

Gunakan metrics untuk:

- alarm;
- dashboard;
- SLO;
- trend;
- capacity planning;
- autoscaling;
- cost awareness.

Metric bagus untuk deteksi cepat. Metric buruk untuk menjelaskan detail individual request.

### 3.3 Traces

Traces menunjukkan perjalanan request atau workflow lintas komponen.

Gunakan traces untuk:

- melihat dependency chain;
- mengetahui span mana yang lambat;
- menemukan downstream bottleneck;
- menghubungkan frontend/API/worker/database/API call;
- memahami distributed transaction path;
- root cause latency.

Trace bagus untuk korelasi lintas service. Trace buruk jika sampling terlalu agresif atau instrumentation tidak konsisten.

### 3.4 Relasi ideal

```text
Metric tells you something is wrong.
Trace tells you where it is wrong.
Log tells you why it is wrong.
Runbook tells you what to do next.
```

---

## 4. Amazon CloudWatch: Bukan Hanya Tempat Log

CloudWatch adalah observability platform utama di AWS. Ia mencakup logs, metrics, alarms, dashboards, events, synthetics, application monitoring, dan integrasi dengan banyak AWS service.

Mental model penting:

```text
AWS Service / Application
   ↓ emits
Logs / Metrics / Traces / Events
   ↓ stored / processed
CloudWatch / X-Ray / ADOT / CloudTrail
   ↓ queried / alarmed / visualized
Insights / Alarms / Dashboards / Application Signals
   ↓ action
SNS / Pager / Incident workflow / Auto remediation
```

CloudWatch tidak otomatis membuat sistem observable. Ia hanya platform penerimaan dan analisis. Kualitas observability tetap bergantung pada desain telemetry aplikasi.

---

## 5. CloudWatch Logs

### 5.1 Core concepts

CloudWatch Logs memiliki konsep:

- **log group**: container log logical;
- **log stream**: sequence log dari sumber tertentu;
- **log event**: satu record log;
- **retention policy**: berapa lama log disimpan;
- **metric filter**: ekstraksi metric dari log;
- **subscription filter**: forwarding log ke destination lain;
- **Logs Insights**: query log interaktif;
- **Live Tail**: melihat log real-time.

Contoh log group:

```text
/aws/lambda/case-decision-handler
/aws/ecs/case-api/prod
/application/case-management/prod/api
/application/case-management/prod/worker
/audit/case-management/prod/domain-events
```

### 5.2 Log group naming convention

Gunakan naming convention yang membuat ownership dan environment jelas.

Format yang baik:

```text
/application/<domain>/<env>/<component>
/audit/<domain>/<env>/<stream>
/platform/<env>/<component>
/security/<env>/<source>
```

Contoh:

```text
/application/enforcement/prod/case-api
/application/enforcement/prod/document-worker
/application/enforcement/prod/notification-worker
/audit/enforcement/prod/domain-events
/security/prod/authz-decisions
```

Hindari:

```text
/logs
/app
/backend
/prod
/test
```

Nama log harus membantu saat incident, bukan hanya saat setup.

### 5.3 Structured logging

Untuk Java production system, gunakan JSON structured logging.

Contoh log buruk:

```text
Case approved successfully
```

Masalah:

- tidak ada case id;
- tidak ada actor;
- tidak ada tenant;
- tidak ada correlation id;
- tidak ada decision id;
- sulit dicari;
- tidak machine-readable.

Contoh log baik:

```json
{
  "timestamp": "2026-06-20T10:15:23.211Z",
  "level": "INFO",
  "service": "case-api",
  "env": "prod",
  "version": "2026.06.20-1a2b3c4",
  "event": "case.approval.completed",
  "tenant_id": "tenant-042",
  "case_id": "case-98321",
  "actor_id": "user-701",
  "workflow_execution_id": "exec-abc123",
  "correlation_id": "corr-9f32",
  "request_id": "req-281",
  "decision": "APPROVED",
  "duration_ms": 184
}
```

Structured logging memungkinkan:

- query by field;
- metric extraction;
- audit correlation;
- sampling;
- alert enrichment;
- event replay analysis;
- tenant impact analysis.

### 5.4 Log levels

Gunakan log level sebagai contract.

| Level | Makna | Contoh |
|---|---|---|
| TRACE | detail sangat rendah, biasanya disabled di prod | field-level parser step |
| DEBUG | debugging internal, biasanya sampled/disabled | generated query, intermediate state |
| INFO | business/technical event normal | case approved, message processed |
| WARN | abnormal tetapi recovered | retry succeeded, stale callback ignored |
| ERROR | failure yang butuh perhatian | command failed, downstream unavailable |
| FATAL | proses tidak bisa lanjut | boot failure, corrupted critical config |

Anti-pattern:

- semua error sebagai INFO;
- semua business event sebagai ERROR;
- log exception tanpa stack trace;
- log stack trace untuk expected business rejection;
- log PII penuh;
- log secret;
- log payload besar tanpa redaction.

### 5.5 Apa yang wajib ada dalam log aplikasi Java

Minimal field:

```text
timestamp
level
service
environment
version
host/container/function id
correlation_id
request_id / message_id
operation
outcome
latency_ms
error_type
error_code
tenant_id jika multi-tenant
actor_id jika human initiated
resource id/domain id jika relevan
```

Untuk regulated workflow:

```text
case_id
workflow_id
state_from
state_to
decision
reason_code
policy_version
rule_version
approver_id
execution_id
causation_id
```

### 5.6 Redaction dan data protection

Observability tidak boleh menjadi kebocoran data.

Jangan log:

- password;
- token;
- access key;
- refresh token;
- full authorization header;
- secret value;
- private key;
- full PII jika tidak perlu;
- dokumen evidence mentah;
- payment data sensitif;
- signed URL panjang jika bisa membuka data.

Gunakan:

- redaction middleware;
- allowlist field logging;
- hashing untuk lookup non-reversible;
- token fingerprint;
- payload truncation;
- structured domain event yang aman;
- log retention sesuai klasifikasi data.

### 5.7 CloudWatch Logs Insights

CloudWatch Logs Insights digunakan untuk query log.

Contoh: error rate per service:

```sql
fields @timestamp, service, level, event, error_type
| filter level = "ERROR"
| stats count(*) as errors by service, error_type
| sort errors desc
```

Contoh: latency p95 per operation:

```sql
fields @timestamp, operation, duration_ms
| filter ispresent(duration_ms)
| stats pct(duration_ms, 95) as p95, pct(duration_ms, 99) as p99, count(*) as requests by operation
| sort p95 desc
```

Contoh: impact tenant saat incident:

```sql
fields @timestamp, tenant_id, case_id, event, error_type
| filter level = "ERROR"
| filter @timestamp >= ago(2h)
| stats count(*) as error_count, count_distinct(case_id) as affected_cases by tenant_id, error_type
| sort error_count desc
```

Contoh: mencari retry storm:

```sql
fields @timestamp, service, operation, attempt, error_type, correlation_id
| filter event = "downstream.call.failed"
| stats count(*) as failures, max(attempt) as max_attempt by service, operation, error_type, bin(5m)
| sort failures desc
```

### 5.8 Retention policy

Jangan biarkan log retention default tanpa keputusan.

Pertimbangkan:

- debugging log: 7–30 hari;
- production operational log: 30–90 hari;
- audit/domain event log: sesuai regulasi;
- security log: lebih panjang;
- raw verbose log: pendek;
- exported archive ke S3 untuk long-term retention.

Retention adalah trade-off:

```text
retention longer = better forensic ability + higher cost + higher data exposure surface
retention shorter = lower cost + lower exposure + weaker investigation ability
```

### 5.9 Subscription filter

Subscription filter dapat mengirim log ke:

- Lambda;
- Kinesis Data Streams;
- Firehose;
- OpenSearch;
- third-party SIEM.

Gunakan untuk:

- central log pipeline;
- security analytics;
- long-term archive;
- real-time anomaly extraction;
- cross-account log aggregation.

Hati-hati:

- subscription failure;
- destination throttling;
- recursive logging;
- cost fanout;
- PII propagation;
- missing encryption boundary.

---

## 6. CloudWatch Metrics

### 6.1 Metric mental model

Metric adalah time series.

Metric terdiri dari:

```text
namespace
metric name
dimensions
timestamp
value
unit
statistic
period
```

Contoh:

```text
Namespace: CaseManagement/Workflow
MetricName: CaseTransitionLatency
Dimensions: Environment=prod, Service=case-api, Transition=SUBMITTED_TO_REVIEW
Value: 184
Unit: Milliseconds
```

### 6.2 AWS service metrics

AWS service secara otomatis menerbitkan banyak metric.

Contoh:

ALB:

- RequestCount;
- TargetResponseTime;
- HTTPCode_Target_5XX_Count;
- HTTPCode_ELB_5XX_Count;
- HealthyHostCount;
- TargetConnectionErrorCount.

ECS:

- CPUUtilization;
- MemoryUtilization;
- running task count;
- pending task count.

Lambda:

- Invocations;
- Errors;
- Duration;
- Throttles;
- ConcurrentExecutions;
- IteratorAge;
- DeadLetterErrors.

SQS:

- ApproximateNumberOfMessagesVisible;
- ApproximateAgeOfOldestMessage;
- NumberOfMessagesSent;
- NumberOfMessagesReceived;
- NumberOfMessagesDeleted.

DynamoDB:

- ConsumedReadCapacityUnits;
- ConsumedWriteCapacityUnits;
- ThrottledRequests;
- UserErrors;
- SystemErrors;
- SuccessfulRequestLatency.

RDS:

- CPUUtilization;
- FreeStorageSpace;
- DatabaseConnections;
- ReadLatency;
- WriteLatency;
- ReplicaLag.

### 6.3 Custom metrics

AWS service metrics tidak cukup untuk aplikasi serius.

Kita butuh domain/application metrics:

```text
CaseCreatedCount
CaseApprovedCount
CaseRejectedCount
CaseTransitionLatency
EvidenceUploadFailureCount
DocumentProcessingDuration
NotificationDeliveryFailureCount
PolicyEvaluationDuration
ManualReviewQueueDepth
StuckWorkflowCount
TenantThrottleCount
IdempotencyConflictCount
```

Custom metrics harus menggambarkan user journey dan domain behavior.

### 6.4 Metric dimensions

Dimension berguna untuk slicing.

Contoh dimension baik:

```text
Environment
Service
Operation
Outcome
Transition
QueueName
Dependency
```

Contoh dimension berbahaya:

```text
UserId
RequestId
CaseId
CorrelationId
Email
DocumentId
```

Masalah dimension high-cardinality:

- biaya tinggi;
- query sulit;
- alarm tidak manageable;
- time series meledak;
- noise operasional.

Rule praktis:

> Jangan jadikan field unik per request sebagai metric dimension. Simpan itu di log/trace.

### 6.5 Business metrics vs technical metrics

Technical metric:

```text
CPUUtilization
MemoryUtilization
5XXCount
QueueDepth
LatencyP95
DBConnections
```

Business metric:

```text
CaseSubmitted
CaseApproved
CaseRejected
EvidenceAccepted
SLADeadlineMissed
InvestigationEscalated
ManualReviewBacklog
```

Top engineer butuh keduanya.

Technical metric memberi tahu mesin bermasalah.

Business metric memberi tahu user journey dan outcome bisnis terdampak.

### 6.6 Embedded Metric Format

CloudWatch Embedded Metric Format atau EMF memungkinkan aplikasi menulis log JSON yang mengandung metric, lalu CloudWatch mengekstrak metric tersebut.

Keuntungan:

- metric dan log detail berada dalam satu event;
- tidak perlu blocking API call untuk setiap metric;
- cocok untuk Lambda dan service yang sudah logging ke stdout;
- mudah menyertakan konteks debugging.

Contoh EMF sederhana:

```json
{
  "_aws": {
    "Timestamp": 1781950523000,
    "CloudWatchMetrics": [
      {
        "Namespace": "CaseManagement/Workflow",
        "Dimensions": [["Environment", "Service", "Transition"]],
        "Metrics": [
          { "Name": "TransitionLatencyMs", "Unit": "Milliseconds" },
          { "Name": "TransitionCount", "Unit": "Count" }
        ]
      }
    ]
  },
  "Environment": "prod",
  "Service": "case-api",
  "Transition": "SUBMITTED_TO_REVIEW",
  "TransitionLatencyMs": 184,
  "TransitionCount": 1,
  "case_id": "case-98321",
  "correlation_id": "corr-9f32"
}
```

Perhatikan:

- `case_id` dan `correlation_id` ada sebagai log field;
- bukan sebagai metric dimension;
- dimension tetap low-cardinality.

---

## 7. CloudWatch Alarms

### 7.1 Alarm bukan dashboard

Dashboard untuk manusia melihat.

Alarm untuk manusia/automation bertindak.

Alarm yang baik harus punya:

- kondisi jelas;
- severity jelas;
- owner jelas;
- impact jelas;
- runbook jelas;
- threshold yang masuk akal;
- tindakan yang mungkin dilakukan.

Alarm buruk:

```text
CPU > 70%
```

Tanpa konteks:

- service apa?
- berapa lama?
- apakah user impact?
- apakah autoscaling sedang berjalan?
- apa tindakan operator?

Alarm lebih baik:

```text
case-api-prod high 5xx rate > 2% for 5 minutes AND request count > 100/min
Impact: users may fail to submit or approve cases
Runbook: rb-case-api-5xx
Owner: enforcement-platform
```

### 7.2 Alarm states

CloudWatch alarm memiliki state:

- `OK`;
- `ALARM`;
- `INSUFFICIENT_DATA`.

`INSUFFICIENT_DATA` tidak boleh diabaikan secara buta.

Kadang itu berarti:

- service tidak emit metric;
- deployment gagal;
- logging/metric pipeline rusak;
- workload idle;
- metric dimension berubah;
- IAM permission hilang;
- region/account salah.

### 7.3 Evaluation period dan datapoints

Alarm harus menghindari false positive dan false negative.

Contoh:

```text
Period: 1 minute
EvaluationPeriods: 5
DatapointsToAlarm: 3
Threshold: error rate > 2%
```

Artinya: alarm jika 3 dari 5 menit terakhir melanggar threshold.

Untuk sistem high traffic, periode pendek mungkin valid.

Untuk sistem low traffic, gunakan pendekatan berbeda:

- absolute error count;
- synthetic canary;
- heartbeat;
- stale job detector;
- SLO burn rate;
- event age.

### 7.4 Composite alarms

Composite alarm menggabungkan beberapa alarm.

Contoh:

```text
ALARM if:
  case-api-5xx-high
AND
  case-api-request-volume-normal
AND NOT
  planned-maintenance
```

Manfaat:

- mengurangi noise;
- membuat health indicator aplikasi;
- membedakan symptom dan impact;
- mencegah paging saat maintenance.

### 7.5 Alarm design by layer

Layer traffic entry:

- Route 53 health check failed;
- ALB 5xx;
- target 5xx;
- target response time p95;
- unhealthy host count.

Layer compute:

- ECS service running tasks below desired;
- ECS deployment failed;
- Lambda error rate;
- Lambda throttles;
- EC2 ASG capacity below minimum.

Layer data:

- RDS CPU/storage/connections;
- DynamoDB throttles;
- ElastiCache evictions;
- OpenSearch cluster health;
- S3 4xx/5xx if enabled.

Layer integration:

- SQS oldest message age;
- DLQ message count;
- EventBridge failed invocations;
- Kinesis iterator age;
- Step Functions executions failed/timed out.

Layer business:

- case submission failure rate;
- stuck workflow count;
- SLA deadline missed;
- manual review backlog;
- evidence processing delay.

### 7.6 Alert fatigue

Alert fatigue terjadi ketika alarm terlalu banyak, terlalu noisy, atau tidak actionable.

Gejala:

- engineer mute alert;
- on-call mengabaikan alert;
- alert tidak punya runbook;
- alert resolve sendiri tanpa analisis;
- low-severity alert masuk paging channel;
- alarm dibuat untuk setiap metric tanpa ownership.

Prinsip:

```text
Every paging alarm must represent user impact, imminent user impact, or loss of diagnostic capability.
```

---

## 8. Dashboards

Dashboard bukan pengganti alarm.

Dashboard berguna untuk:

- shared situational awareness;
- incident room;
- release monitoring;
- capacity review;
- business health review;
- executive summary;
- platform health.

### 8.1 Dashboard types

#### Service dashboard

Untuk satu service.

Isi:

- request rate;
- error rate;
- latency p50/p95/p99;
- CPU/memory;
- deployment version;
- dependency errors;
- downstream latency;
- queue depth jika worker;
- recent alarms.

#### Journey dashboard

Untuk user journey.

Contoh journey: “submit case”.

Isi:

- submission attempt count;
- validation failure count;
- API latency;
- DB write latency;
- evidence upload errors;
- workflow start latency;
- notification send status;
- end-to-end success rate.

#### Platform dashboard

Untuk platform team.

Isi:

- account health;
- region health;
- deployment pipeline;
- shared networking;
- shared logging;
- certificate expiry;
- quota usage;
- cost anomaly.

#### Executive/operational dashboard

Untuk outcome.

Isi:

- total cases processed;
- backlog;
- SLA compliance;
- average review time;
- stuck workflow;
- tenant impact.

### 8.2 Dashboard anti-pattern

- terlalu banyak widget;
- semua metric dimasukkan;
- tidak ada urutan diagnosis;
- tidak ada threshold visual;
- tidak ada link ke runbook;
- tidak ada deployment marker;
- tidak ada owner;
- dashboard tidak pernah dipakai saat incident.

Dashboard yang baik mengikuti flow diagnosis:

```text
Is there user impact?
Where is it?
When did it start?
What changed?
Which dependency is failing?
How big is the blast radius?
What action should we take?
```

---

## 9. AWS X-Ray dan Distributed Tracing

### 9.1 Trace mental model

Trace merepresentasikan satu request atau workflow execution.

Komponen:

- trace id;
- segment;
- subsegment;
- annotation;
- metadata;
- service graph.

Contoh request:

```text
Client
  → CloudFront
  → ALB
  → case-api
      → authorization-service
      → policy-service
      → DynamoDB
      → S3
      → EventBridge
  → response
```

Tanpa tracing, kita hanya melihat banyak log terpisah.

Dengan tracing, kita bisa melihat path dan latency contribution.

### 9.2 Apa yang harus ditrace

Trace:

- incoming HTTP request;
- outgoing HTTP call;
- database query atau operation;
- AWS SDK call;
- queue publish;
- message consumption;
- workflow task;
- expensive business operation;
- policy evaluation;
- external dependency call.

Jangan trace payload besar atau data sensitif.

### 9.3 Annotation vs metadata

Gunakan annotation untuk field yang ingin difilter/index.

Contoh annotation:

```text
environment=prod
service=case-api
tenant_tier=enterprise
operation=SubmitCase
outcome=success
```

Gunakan metadata untuk detail debugging yang tidak perlu index.

Contoh metadata:

```text
validation_rule_count=14
feature_flags={...}
policy_version=2026.06.19
```

Jangan gunakan field high-cardinality secara sembarangan sebagai indexed annotation.

### 9.4 Sampling

Tracing semua request bisa mahal dan berat.

Sampling strategy:

- sample semua error;
- sample sebagian success;
- sample critical operation lebih tinggi;
- sample low-value endpoint lebih rendah;
- gunakan dynamic sampling jika tersedia;
- jangan sampai sampling membuat rare failure hilang.

### 9.5 X-Ray vs OpenTelemetry

AWS X-Ray adalah AWS-native tracing service.

OpenTelemetry adalah standard instrumentation portable.

AWS Distro for OpenTelemetry atau ADOT membantu mengirim telemetry ke AWS services seperti CloudWatch dan X-Ray.

Untuk Java architecture modern, pola yang sehat:

```text
Java application
  → OpenTelemetry instrumentation
  → ADOT Collector / agent
  → X-Ray / CloudWatch / Managed Prometheus / other backend
```

Keuntungan:

- vendor-neutral instrumentation;
- correlated metrics/traces;
- standard semantic conventions;
- easier future migration;
- consistent across EC2/ECS/EKS/Lambda with caveats.

### 9.6 Tracing Java service

Untuk Java service, perhatikan:

- servlet/filter instrumentation;
- WebFlux/Reactor context propagation;
- gRPC interceptors;
- AWS SDK instrumentation;
- JDBC instrumentation;
- thread pool context propagation;
- MDC correlation;
- async execution;
- CompletableFuture context;
- queue message propagation.

Common failure:

```text
Trace stops at async boundary.
```

Penyebab:

- context tidak dipropagate ke thread lain;
- MDC hilang;
- executor tidak wrapped;
- message header tidak membawa traceparent/correlation id;
- worker membuat trace baru tanpa parent link.

---

## 10. Correlation ID, Causation ID, dan Trace Context

### 10.1 Correlation ID

Correlation ID menghubungkan semua telemetry untuk satu user journey/request.

Contoh:

```text
correlation_id = corr-20260620-abc123
```

Harus muncul di:

- API logs;
- worker logs;
- domain event;
- queue message attribute;
- trace attribute;
- error response;
- audit event jika aman;
- support ticket.

### 10.2 Request ID

Request ID biasanya satu request teknis.

```text
correlation_id = journey lintas service
request_id = satu HTTP request/message processing attempt
```

### 10.3 Causation ID

Causation ID menjelaskan event mana yang menyebabkan event berikutnya.

Contoh:

```text
Command SubmitCase
  causation_id = request-001
  emits CaseSubmitted event event-101

CaseSubmitted event event-101
  causes StartReviewWorkflow command command-201
```

Ini penting untuk audit dan replay.

### 10.4 Trace context

Untuk distributed tracing modern, gunakan W3C Trace Context (`traceparent`, `tracestate`) bila memungkinkan.

Tetapi jangan menganggap trace id cukup untuk domain audit. Trace id adalah observability concern, bukan domain identifier.

Minimal propagation di message:

```json
{
  "message_id": "msg-123",
  "correlation_id": "corr-abc",
  "causation_id": "event-101",
  "traceparent": "00-...",
  "tenant_id": "tenant-042",
  "schema_version": "1.0"
}
```

---

## 11. SLO, SLI, Error Budget

### 11.1 Kenapa CPU bukan SLO

CPU tinggi bukan otomatis user impact.

SLO harus mendekati pengalaman user atau business process.

Contoh SLI:

- API availability;
- successful request rate;
- p95 latency;
- workflow completion time;
- queue processing delay;
- document processing success;
- notification delivery latency;
- case transition success rate.

### 11.2 SLI examples

API SLI:

```text
successful_requests / total_valid_requests
```

Latency SLI:

```text
percentage of valid submit-case requests completed under 500ms
```

Workflow SLI:

```text
percentage of case submissions that enter REVIEW state within 2 minutes
```

Worker SLI:

```text
percentage of document processing jobs completed within 5 minutes
```

Queue SLI:

```text
oldest message age < 120 seconds for 99% of 5-minute windows
```

### 11.3 SLO examples

```text
99.9% of valid SubmitCase requests succeed over 30 days.
95% of SubmitCase requests complete under 500ms over 7 days.
99% of uploaded evidence documents are virus-scanned and indexed within 5 minutes.
99.5% of case workflows transition from SUBMITTED to REVIEW_READY within 2 minutes.
```

### 11.4 Error budget

Error budget = allowed unreliability.

Jika SLO 99.9%, error budget adalah 0.1%.

Gunakan error budget untuk:

- release decision;
- operational risk;
- reliability investment;
- balancing speed vs stability.

Jika error budget habis, keputusan engineering mungkin berubah:

- freeze risky release;
- prioritize reliability fix;
- reduce dependency risk;
- improve retry/backoff;
- increase capacity;
- fix observability gaps.

---

## 12. Observability per Compute Runtime

### 12.1 EC2

Telemetry sources:

- application logs;
- CloudWatch Agent;
- system metrics;
- disk metrics;
- process metrics;
- custom app metrics;
- ALB metrics;
- ASG metrics;
- SSM inventory;
- CloudTrail.

Key concerns:

- install/configure CloudWatch Agent;
- log file path consistency;
- instance identity;
- AMI version tagging;
- lifecycle hook logging;
- graceful shutdown events;
- disk full detection;
- NTP/time sync;
- patch state.

Important metrics:

```text
CPUUtilization
MemoryUtilization
DiskUsedPercent
StatusCheckFailed
TargetResponseTime
HTTPCode_Target_5XX_Count
HealthyHostCount
```

### 12.2 ECS/Fargate

Telemetry sources:

- container stdout/stderr;
- awslogs driver or FireLens;
- ECS service events;
- task state change events;
- Container Insights;
- ALB metrics;
- application metrics;
- traces via ADOT sidecar/agent.

Key concerns:

- task id as instance identity;
- task definition revision;
- image digest;
- deployment id;
- container restart reason;
- OOMKilled;
- health check failures;
- desired vs running task count.

Important metrics:

```text
CPUUtilization
MemoryUtilization
RunningTaskCount
PendingTaskCount
DeploymentFailed
TargetResponseTime
HTTP 5xx
QueueDepth for workers
```

### 12.3 Lambda

Telemetry sources:

- CloudWatch Logs;
- Lambda service metrics;
- X-Ray/ADOT;
- Lambda Insights;
- application EMF metrics;
- function URL/API Gateway metrics;
- event source metrics.

Key concerns:

- cold start;
- duration;
- timeout;
- memory usage;
- throttles;
- concurrent executions;
- iterator age;
- SQS batch partial failures;
- DLQ/destination failures.

Important metrics:

```text
Invocations
Errors
Duration
Throttles
ConcurrentExecutions
IteratorAge
DeadLetterErrors
AsyncEventAge
```

### 12.4 Step Functions

Telemetry sources:

- execution history;
- CloudWatch metrics;
- CloudWatch Logs if enabled;
- X-Ray tracing if enabled;
- EventBridge events;
- service integration failures.

Key concerns:

- execution failed/timed out;
- state retry loops;
- stuck callback;
- Map concurrency;
- payload limit;
- redrive behavior;
- compensation visibility;
- business state divergence.

Important metrics:

```text
ExecutionsStarted
ExecutionsSucceeded
ExecutionsFailed
ExecutionsTimedOut
ExecutionThrottled
ActivityScheduleTime
ActivityRunTime
LambdaFunctionFailed
```

---

## 13. Observability untuk Event-Driven Architecture

Event-driven system sering sulit di-debug karena tidak ada single request thread.

### 13.1 Message observability contract

Setiap message/event sebaiknya membawa:

```json
{
  "event_id": "evt-123",
  "event_type": "CaseSubmitted",
  "schema_version": "1.0",
  "occurred_at": "2026-06-20T10:15:23Z",
  "producer": "case-api",
  "correlation_id": "corr-abc",
  "causation_id": "cmd-789",
  "tenant_id": "tenant-042",
  "traceparent": "00-..."
}
```

### 13.2 Queue metrics that matter

Untuk SQS worker, CPU tidak cukup.

Yang penting:

- age of oldest message;
- visible messages;
- inflight messages;
- processing success rate;
- processing latency;
- DLQ count;
- retry count;
- poison message count;
- idempotency conflict count.

### 13.3 Consumer log fields

Consumer log minimal:

```text
message_id
receipt_attempt
event_id
event_type
correlation_id
consumer_service
processing_duration_ms
outcome
error_type
idempotency_result
```

### 13.4 DLQ observability

DLQ bukan solusi jika tidak dimonitor.

Harus ada:

- DLQ message count alarm;
- oldest DLQ message alarm;
- DLQ replay runbook;
- poison message classification;
- safe replay tooling;
- audit of discarded messages;
- dashboard by event type.

---

## 14. Observability untuk Regulatory / Case Management System

Untuk sistem regulatory, observability harus melayani tiga kebutuhan:

1. **operational diagnosis** — mengapa sistem gagal;
2. **business traceability** — apa yang terjadi pada case;
3. **audit defensibility** — siapa/apa yang mengambil keputusan, berdasarkan versi aturan apa.

### 14.1 Jangan campur application log dan audit log

Application log:

- untuk debugging;
- boleh verbose;
- retention lebih pendek;
- bisa berubah format;
- tidak selalu immutable.

Audit/domain event log:

- untuk evidence;
- harus stabil;
- retention lebih panjang;
- harus dilindungi;
- harus memiliki schema/version;
- harus tahan manipulasi;
- tidak boleh bergantung pada log level.

### 14.2 Domain telemetry examples

Case transition:

```json
{
  "event": "case.state_transitioned",
  "case_id": "case-98321",
  "tenant_id": "tenant-042",
  "from_state": "SUBMITTED",
  "to_state": "UNDER_REVIEW",
  "actor_type": "USER",
  "actor_id": "user-701",
  "reason_code": "INITIAL_REVIEW_STARTED",
  "policy_version": "2026.06.01",
  "workflow_execution_id": "exec-abc123",
  "correlation_id": "corr-9f32",
  "occurred_at": "2026-06-20T10:15:23Z"
}
```

Policy evaluation:

```json
{
  "event": "policy.evaluated",
  "case_id": "case-98321",
  "policy_id": "enforcement-escalation-policy",
  "policy_version": "2026.06.01",
  "input_hash": "sha256:...",
  "decision": "ESCALATE_TO_SUPERVISOR",
  "duration_ms": 42,
  "correlation_id": "corr-9f32"
}
```

### 14.3 Metrics for case management

```text
CaseSubmissionSuccessRate
CaseTransitionFailureCount
InvalidTransitionAttemptCount
ManualReviewBacklog
SLADeadlineMissedCount
EscalationCreatedCount
PolicyEvaluationLatencyP95
WorkflowStuckCount
EvidenceProcessingDelayP95
NotificationDeliveryFailureRate
```

### 14.4 Key dashboards

- case intake health;
- workflow state distribution;
- SLA risk;
- stuck workflow;
- tenant impact;
- document processing pipeline;
- notification pipeline;
- policy evaluation health;
- audit event emission health;
- deployment impact.

---

## 15. Java Implementation Guidance

### 15.1 Logging stack

Common Java choices:

- SLF4J facade;
- Logback or Log4j2 backend;
- JSON encoder;
- MDC for correlation context;
- OpenTelemetry instrumentation;
- Micrometer for metrics;
- AWS SDK instrumentation if supported by chosen stack;
- CloudWatch agent / awslogs / FireLens depending runtime.

### 15.2 MDC pattern

At HTTP entry:

```java
public class CorrelationFilter implements Filter {
  @Override
  public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
      throws IOException, ServletException {

    HttpServletRequest http = (HttpServletRequest) request;
    String correlationId = Optional.ofNullable(http.getHeader("X-Correlation-Id"))
        .filter(s -> !s.isBlank())
        .orElse(UUID.randomUUID().toString());

    try {
      MDC.put("correlation_id", correlationId);
      MDC.put("request_id", UUID.randomUUID().toString());
      chain.doFilter(request, response);
    } finally {
      MDC.clear();
    }
  }
}
```

Caveat:

- MDC berbasis thread-local;
- async/reactive context butuh propagation khusus;
- thread pool dapat menyebabkan context leak jika tidak clear;
- jangan simpan PII mentah di MDC.

### 15.3 Logging domain event

```java
log.info("case.state_transitioned",
    kv("case_id", caseId),
    kv("tenant_id", tenantId),
    kv("from_state", fromState),
    kv("to_state", toState),
    kv("actor_id", actorId),
    kv("policy_version", policyVersion),
    kv("correlation_id", correlationId));
```

Konsepnya:

- message stabil;
- fields eksplisit;
- queryable;
- tidak bergantung pada string parsing.

### 15.4 Metrics with Micrometer

Contoh metric:

```java
Timer.Sample sample = Timer.start(meterRegistry);
try {
  transitionService.transition(command);
  meterRegistry.counter("case.transition.count",
      "transition", "SUBMITTED_TO_REVIEW",
      "outcome", "success").increment();
} catch (Exception ex) {
  meterRegistry.counter("case.transition.count",
      "transition", "SUBMITTED_TO_REVIEW",
      "outcome", "failure",
      "error_type", ex.getClass().getSimpleName()).increment();
  throw ex;
} finally {
  sample.stop(meterRegistry.timer("case.transition.latency",
      "transition", "SUBMITTED_TO_REVIEW"));
}
```

Caution:

- jangan gunakan `case_id` sebagai tag;
- jaga cardinality;
- define metric name convention;
- define unit;
- define owner.

### 15.5 AWS SDK call logging

Jangan log full request payload untuk semua AWS SDK call.

Log secara selektif:

```text
operation
service
resource logical name
attempt
duration_ms
status
error code
request id dari AWS response jika tersedia
```

Contoh:

```json
{
  "event": "aws.sdk.call.completed",
  "aws_service": "dynamodb",
  "operation": "PutItem",
  "table": "case-events-prod",
  "duration_ms": 28,
  "attempt": 1,
  "outcome": "success",
  "aws_request_id": "...",
  "correlation_id": "corr-abc"
}
```

---

## 16. Observability as Code

Observability harus didefinisikan sebagai code.

IaC harus mencakup:

- log groups;
- retention policy;
- KMS encryption;
- metric filters;
- alarms;
- composite alarms;
- dashboards;
- SNS topics;
- notification routing;
- EventBridge rules;
- Synthetics canaries;
- X-Ray/Tracing config;
- CloudWatch agent config;
- OpenTelemetry collector config;
- IAM permissions untuk telemetry emission;
- tags/ownership.

Jika observability dibuat manual di console:

- drift tinggi;
- sulit replicate antar environment;
- sulit review;
- sulit rollback;
- alarm hilang saat recreate;
- dashboard tidak konsisten.

### 16.1 Example alarm naming

```text
<env>-<service>-<symptom>-<severity>
prod-case-api-high-5xx-page
prod-case-worker-dlq-nonempty-ticket
prod-evidence-pipeline-oldest-message-age-page
prod-workflow-stuck-case-warning
```

### 16.2 Tags

Setiap observability resource sebaiknya punya tag:

```text
Environment
Service
Owner
CostCenter
Criticality
RunbookUrl
DataClassification
```

---

## 17. Failure Mode Catalog

### 17.1 Logs tidak muncul

Possible causes:

- application tidak menulis stdout/file yang benar;
- log driver salah;
- IAM role tidak punya permission;
- CloudWatch agent mati;
- log group tidak dibuat;
- network egress ke CloudWatch Logs gagal;
- endpoint policy deny;
- region salah;
- quota/throttling;
- app crash sebelum flush.

Diagnosis:

- cek runtime-specific log path;
- cek IAM;
- cek CloudWatch agent status;
- cek ECS task events/Lambda logs/EC2 system logs;
- cek VPC endpoint;
- cek error di agent.

### 17.2 Metric tidak muncul

Possible causes:

- namespace salah;
- dimension berubah;
- EMF invalid;
- timestamp terlalu lama/masa depan;
- permission deny;
- high cardinality explosion;
- app tidak melewati code path;
- batch metric belum flush.

### 17.3 Alarm noisy

Possible causes:

- threshold terlalu rendah;
- period terlalu pendek;
- tidak mempertimbangkan traffic volume;
- metric sparse;
- tidak ada composite logic;
- alarm symptom bukan impact;
- deployment/maintenance tidak disilence;
- autoscaling normal dianggap incident.

### 17.4 Trace putus

Possible causes:

- async context hilang;
- message tidak membawa trace context;
- service tidak instrumented;
- sampling terlalu rendah;
- downstream tidak propagate header;
- custom thread pool tidak propagate context;
- collector/daemon tidak reachable.

### 17.5 Incident sulit didiagnosis

Possible causes:

- tidak ada correlation id;
- logs unstructured;
- metrics hanya infrastructure;
- tidak ada domain metrics;
- dashboard tidak mengikuti user journey;
- runbook tidak ada;
- alert tidak punya owner;
- deployment marker tidak ada;
- telemetry antar service tidak konsisten.

### 17.6 Cost telemetry membengkak

Possible causes:

- log terlalu verbose;
- payload besar di log;
- high-cardinality metrics;
- terlalu banyak custom metrics;
- trace sampling terlalu tinggi;
- retention terlalu panjang;
- duplicate log shipping;
- debug logs enabled di prod.

---

## 18. Observability Design Checklist

### 18.1 Per service

- [ ] Service punya log group dengan retention jelas.
- [ ] Log structured JSON.
- [ ] Correlation ID tersedia di semua log.
- [ ] Request ID/message ID tersedia.
- [ ] Error log memuat error type dan safe context.
- [ ] No secrets/PII leakage.
- [ ] Metrics mencakup request rate, error rate, latency, saturation.
- [ ] Business metrics tersedia.
- [ ] Tracing enabled untuk critical path.
- [ ] Downstream dependency calls visible.
- [ ] Alarm actionable dan punya owner.
- [ ] Dashboard mengikuti diagnosis flow.
- [ ] Runbook tersedia.
- [ ] Deployment version muncul di telemetry.

### 18.2 Per user journey

- [ ] Ada SLI dan SLO.
- [ ] Ada end-to-end success metric.
- [ ] Ada latency metric.
- [ ] Ada business failure classification.
- [ ] Ada trace/correlation lintas service.
- [ ] Ada dashboard journey.
- [ ] Ada alert untuk impact.
- [ ] Ada runbook.

### 18.3 Per regulated workflow

- [ ] Domain audit event tidak bergantung pada app log biasa.
- [ ] State transition tercatat.
- [ ] Actor dan reason code tercatat.
- [ ] Policy/rule version tercatat.
- [ ] Workflow execution id tercatat.
- [ ] Evidence/action hash jika perlu.
- [ ] Retention dan immutability jelas.
- [ ] Access ke audit log dikontrol.
- [ ] Replay/diagnosis aman.

---

## 19. Architecture Decision Record Template

```markdown
# ADR: Observability Architecture for <Service/Workload>

## Context
<Workload, criticality, user journeys, runtime, regulatory needs>

## Goals
- Detect user impact quickly.
- Diagnose failures across services.
- Support audit and forensic requirements.
- Control telemetry cost.

## Telemetry Sources
- Logs:
- Metrics:
- Traces:
- Audit events:
- Deployment markers:

## Correlation Strategy
- correlation_id:
- request_id:
- causation_id:
- trace context:
- message attributes:

## Logging Decision
- format:
- required fields:
- redaction:
- retention:
- subscription:

## Metrics Decision
- namespace:
- dimensions:
- custom metrics:
- business metrics:
- cardinality controls:

## Tracing Decision
- instrumentation:
- sampling:
- context propagation:
- collector/backend:

## Alarms
- paging alarms:
- ticket alarms:
- composite alarms:
- maintenance handling:

## Dashboards
- service dashboard:
- journey dashboard:
- platform dashboard:

## Security and Compliance
- encryption:
- access control:
- PII handling:
- audit retention:

## Cost Controls
- log retention:
- sampling:
- metric cardinality:
- archive strategy:

## Failure Modes
- telemetry pipeline failure:
- missing logs:
- noisy alarm:
- trace gap:
- high cost:

## Consequences
<Trade-offs accepted>
```

---

## 20. Practical Exercise

Desain observability untuk workload berikut:

```text
A regulated case management platform receives enforcement case submissions.
Users upload evidence documents.
A Java API validates the submission.
A workflow starts manual/automated review.
A document worker scans and indexes evidence.
A notification worker sends status updates.
A policy service evaluates escalation rules.
```

Tugas:

1. Definisikan 5 user journeys paling penting.
2. Untuk setiap journey, tentukan SLI dan SLO.
3. Tentukan required log fields.
4. Tentukan custom metrics.
5. Tentukan trace boundaries.
6. Tentukan alarm yang paging dan non-paging.
7. Tentukan dashboard incident.
8. Tentukan audit event yang harus immutable.
9. Tentukan retention policy.
10. Tentukan cost control.

Contoh expected output:

```text
Journey: Submit Case
SLI: valid submissions that reach SUBMITTED state / valid submission attempts
SLO: 99.9% over 30 days
Latency SLO: p95 under 700ms
Key logs: case.submission.received, case.validation.failed, case.created, workflow.started
Metrics: CaseSubmissionCount, CaseSubmissionFailureCount, CaseSubmissionLatency
Trace: API → policy-service → DynamoDB → EventBridge → Step Functions
Paging alarm: submission failure rate > 2% for 5 min with volume > 100 req/min
Ticket alarm: p95 latency > 1s for 30 min
Audit event: CaseSubmitted
Retention: app logs 90 days, audit events 7 years or per regulation
```

---

## 21. Key Takeaways

1. Observability adalah desain sistem, bukan fitur tambahan.
2. Logs, metrics, dan traces punya fungsi berbeda; jangan pakai satu untuk semua.
3. Metric memberi sinyal cepat, trace menunjukkan lokasi, log menjelaskan detail.
4. Correlation ID adalah tulang punggung diagnosis distributed system.
5. Structured logging adalah default untuk Java production workloads.
6. Business metrics sama pentingnya dengan infrastructure metrics.
7. Alarm harus actionable, punya owner, dan punya runbook.
8. Dashboard harus mengikuti flow diagnosis, bukan sekadar menampilkan semua metric.
9. Tracing harus menyeberangi async boundary dan message boundary.
10. Observability harus memperhatikan data protection dan cost.
11. Untuk regulated workflow, audit log/domain event harus dipisahkan dari application log biasa.
12. Observability yang baik mempercepat incident response dan memperkuat defensibility sistem.

---

## 22. Referensi Resmi AWS

- Amazon CloudWatch Documentation
- Amazon CloudWatch Logs
- CloudWatch Logs Insights query syntax
- CloudWatch Metrics
- CloudWatch Alarms
- CloudWatch Composite Alarms
- CloudWatch Embedded Metric Format
- CloudWatch Application Signals
- AWS X-Ray Developer Guide
- AWS X-Ray Concepts
- AWS X-Ray Java / OpenTelemetry guidance
- AWS Distro for OpenTelemetry
- AWS Well-Architected Framework — Operational Excellence Pillar
- AWS Well-Architected Framework — Reliability Pillar
- AWS Well-Architected Framework — Security Pillar

---

## 23. Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-019.md
```

Judul:

```text
Reliability Engineering on AWS: Multi-AZ, Backup, Restore, DR, dan Chaos Thinking
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-017.md">⬅️ Part 017 — Security Architecture II: KMS, Policy Composition, Cross-Account Access, dan Data Protection</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-019.md">Part 019 — Reliability Engineering on AWS: Multi-AZ, Backup, Restore, DR, dan Chaos Thinking ➡️</a>
</div>

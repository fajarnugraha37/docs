# learn-java-bpmn-camunda-process-orchestration-engineering

## Part 21 — Observability: Logs, Metrics, Tracing, Audit, and Operability

> Seri: `learn-java-bpmn-camunda-process-orchestration-engineering`  
> Part: `21 / 30`  
> Level: Advanced  
> Fokus: observability dan operability workflow/process orchestration berbasis Java + Camunda 7/8  
> Target pembaca: software engineer / tech lead yang perlu membuat sistem workflow production-grade, audit-ready, dan supportable

---

## 0. Tujuan Part Ini

Pada aplikasi CRUD biasa, observability sering cukup dijawab dengan:

- log request/response,
- HTTP latency,
- error rate,
- database slow query,
- trace antar service.

Pada workflow engine, itu belum cukup.

Sistem BPMN/Camunda membawa dimensi tambahan:

- process instance bisa hidup berhari-hari, berminggu-minggu, bahkan bertahun-tahun,
- process bisa berhenti di wait state,
- failure bisa berupa incident engine, failed job, stuck human task, missing external message, expired SLA, atau decision yang salah,
- satu business case bisa melewati banyak service, user, timer, approval, document, dan external system,
- auditor tidak hanya bertanya “kenapa API error?”, tetapi “kenapa kasus ini diputuskan seperti ini pada tanggal tersebut oleh officer tersebut berdasarkan rule tersebut?”.

Jadi observability workflow bukan hanya technical observability. Ia harus menggabungkan:

1. **technical telemetry** — logs, metrics, traces, health, resource usage;
2. **process telemetry** — instance state, active step, duration, incident, retry, path taken;
3. **business telemetry** — SLA, backlog, aging, decision outcome, approval queue, breach;
4. **audit telemetry** — who did what, when, why, from where, under what authority, based on what data;
5. **operational repair telemetry** — what was repaired, by whom, why, before/after state.

Mental model utama:

> A workflow system is observable only when an engineer can answer:  
> **“Where is this case now, how did it get here, why is it stuck or delayed, what can safely be done next, and can we prove it later?”**

---

## 1. Observability Workflow Berbeda dari Observability API

### 1.1 API-centric observability

Pada API biasa, pertanyaan utamanya:

- request mana yang lambat?
- endpoint mana yang error?
- service mana yang down?
- query mana yang mahal?
- trace mana yang gagal?

Unit analisisnya biasanya:

```text
HTTP request -> service call -> DB query -> response
```

Durasi hidup unit ini pendek: milidetik sampai detik.

### 1.2 Workflow-centric observability

Pada workflow, pertanyaan utamanya berbeda:

- process instance ini sedang di step apa?
- kenapa process berhenti di step tersebut?
- siapa yang harus action?
- SLA mana yang hampir breach?
- message eksternal sudah datang atau belum?
- job worker gagal karena data, dependency, code bug, atau retry habis?
- process version mana yang dipakai instance ini?
- decision rule mana yang menghasilkan outcome ini?
- apakah ada repair manual?
- apakah repair tersebut sah secara audit?

Unit analisisnya:

```text
Business case -> process instance -> element instance -> job/task/message/timer -> domain effect -> audit event
```

Durasi hidup unit ini panjang: menit, hari, bulan, atau tahun.

### 1.3 Konsekuensi desain

Observability API bisa cukup dengan log line per request. Workflow tidak bisa.

Workflow memerlukan identifier lintas-layer:

```text
caseId
businessKey
processDefinitionId
processDefinitionVersion
processInstanceKey
flowNodeId
flowNodeName
elementInstanceKey
jobKey
jobType
taskId
messageName
correlationKey
externalEventId
actorId
requestId
traceId
```

Tanpa identifier ini, production support berubah menjadi investigasi manual yang mahal.

---

## 2. Lima Layer Observability dalam Sistem Camunda

Sistem Java + Camunda sebaiknya dipantau sebagai lima layer, bukan satu layer.

```text
[Business Layer]
  SLA, backlog, aging, queue, breach, business outcome

[Process Layer]
  process instance, BPMN element, incidents, active tokens, path taken

[Worker/Application Layer]
  Java worker latency, errors, retries, idempotency, external calls

[Engine/Platform Layer]
  Zeebe/Camunda broker, gateway, exporter, Operate, Tasklist, Identity

[Infrastructure Layer]
  CPU, memory, disk, network, Kubernetes, DB/search store, message broker
```

Kesalahan umum adalah hanya memonitor infrastructure layer:

```text
CPU OK
Memory OK
Pod running
```

Tetapi process bisa tetap gagal:

```text
2000 application cases stuck at Wait for Payment Confirmation
500 user tasks overdue
300 jobs repeatedly fail due to invalid payload
Message correlation key mismatch silently accumulates
```

Top engineer tidak hanya bertanya “pod hidup atau tidak”, tetapi:

> “Apakah business process masih bergerak secara sehat?”

---

## 3. Identifier Strategy: Tulang Punggung Observability

Observability workflow gagal jika identifier tidak konsisten.

### 3.1 Identifier yang perlu dibedakan

| Identifier | Arti | Sumber | Contoh |
|---|---|---|---|
| `caseId` | ID domain case/application | domain DB | `APP-2026-000123` |
| `businessKey` | business correlation identifier | application | `APP-2026-000123` |
| `processInstanceKey` | ID runtime instance di Camunda 8 | Zeebe | `2251799813685249` |
| `processDefinitionId` | BPMN process id | BPMN model | `licensing_application_process` |
| `processVersion` | versi deployed process | engine | `17` |
| `elementId` | BPMN element id | BPMN XML | `task_validate_documents` |
| `elementInstanceKey` | runtime execution of BPMN element | engine | numeric key |
| `jobKey` | runtime job id | engine | numeric key |
| `jobType` | worker job type | BPMN extension | `validate-documents` |
| `taskId` | user task id | Tasklist/API | UUID/key |
| `messageName` | BPMN message name | BPMN model | `PaymentReceived` |
| `correlationKey` | key untuk message correlation | domain/process variable | `APP-2026-000123` |
| `traceId` | distributed tracing id | OpenTelemetry | trace id |
| `requestId` | inbound request id | API gateway/app | UUID |

### 3.2 Rule utama

Jangan memilih satu ID untuk semua kebutuhan.

Misalnya:

- `caseId` cocok untuk user dan auditor.
- `processInstanceKey` cocok untuk Operate/engine lookup.
- `traceId` cocok untuk request runtime.
- `jobKey` cocok untuk worker execution.
- `messageName + correlationKey` cocok untuk event correlation.

### 3.3 Standard MDC logging context

Di Java/Spring Boot, setiap worker handler sebaiknya memasang MDC:

```java
MDC.put("caseId", caseId);
MDC.put("businessKey", businessKey);
MDC.put("processInstanceKey", String.valueOf(job.getProcessInstanceKey()));
MDC.put("elementId", job.getElementId());
MDC.put("elementInstanceKey", String.valueOf(job.getElementInstanceKey()));
MDC.put("jobKey", String.valueOf(job.getKey()));
MDC.put("jobType", job.getType());
MDC.put("processDefinitionKey", String.valueOf(job.getProcessDefinitionKey()));
```

Lalu pastikan MDC dibersihkan:

```java
try {
    handle(job);
} finally {
    MDC.clear();
}
```

Tanpa `finally`, thread pool dapat mewarisi MDC dari job sebelumnya.

Ini sangat berbahaya karena log case A bisa tercatat sebagai case B.

---

## 4. Logging: Jangan Hanya “Ada Error”

### 4.1 Log harus menjawab pertanyaan operasional

Bad log:

```text
Failed to validate document
```

Better log:

```json
{
  "event": "DOCUMENT_VALIDATION_FAILED",
  "caseId": "APP-2026-000123",
  "processInstanceKey": "2251799813685249",
  "elementId": "task_validate_documents",
  "jobKey": "2251799813689999",
  "jobType": "validate-documents",
  "attempt": 2,
  "remainingRetries": 1,
  "failureCategory": "EXTERNAL_DEPENDENCY_TIMEOUT",
  "externalSystem": "document-service",
  "durationMs": 3200,
  "action": "FAIL_JOB_WITH_RETRY"
}
```

Good log bukan log yang panjang, tetapi log yang menjawab:

- proses apa?
- case apa?
- step apa?
- job apa?
- gagal kenapa?
- akan diapakan?
- apakah retry?
- apakah perlu operator?

### 4.2 Event-based logging

Untuk workflow, gunakan log berbasis event name, bukan kalimat bebas.

Contoh event:

```text
PROCESS_START_REQUESTED
PROCESS_INSTANCE_STARTED
JOB_ACTIVATED
JOB_COMPLETED
JOB_FAILED_RETRYABLE
JOB_FAILED_NON_RETRYABLE
BPMN_ERROR_THROWN
MESSAGE_PUBLISH_REQUESTED
MESSAGE_CORRELATED
MESSAGE_CORRELATION_FAILED
USER_TASK_ASSIGNED
USER_TASK_COMPLETED
SLA_TIMER_TRIGGERED
INCIDENT_CREATED
INCIDENT_RESOLVED
MANUAL_REPAIR_APPLIED
COMPENSATION_STARTED
COMPENSATION_COMPLETED
```

Dengan event names konsisten, logs bisa di-query, dihitung, dan dijadikan alert.

### 4.3 Jangan log sensitive variable

Process variable sering berisi:

- NRIC/NIK/passport,
- address,
- email,
- phone,
- document metadata,
- officer notes,
- legal remarks,
- payment details.

Aturan:

```text
Never log full process variables by default.
```

Log hanya:

- ID referensi,
- hash/masked value,
- field non-sensitive,
- classification,
- error code,
- count/size.

Bad:

```java
log.info("Variables: {}", job.getVariables());
```

Better:

```java
log.info("Validating application documents: caseId={}, documentCount={}, applicantType={}",
    caseId,
    command.documentIds().size(),
    command.applicantType());
```

### 4.4 Log level discipline

| Level | Digunakan untuk |
|---|---|
| TRACE | debugging lokal, jarang production |
| DEBUG | detail developer, disabled by default |
| INFO | business/technical milestone normal |
| WARN | abnormal tapi recoverable |
| ERROR | failure yang butuh perhatian atau menyebabkan process stuck/incident |

Contoh:

- retryable timeout dependency: `WARN`
- invalid business input yang dilempar sebagai BPMN error: `INFO` atau `WARN`, tergantung konteks
- incident karena retry habis: `ERROR`
- manual repair applied: `WARN` atau audit event khusus

Jangan menjadikan semua business exception sebagai `ERROR`. Kalau applicant tidak eligible dan process memang lanjut ke rejection path, itu bukan error sistem.

---

## 5. Metrics: Dari “Service Sehat” ke “Process Sehat”

### 5.1 Metrics platform Camunda

Camunda 8 self-managed memiliki dukungan metrics untuk komponen platform. Dokumentasi Camunda menyebut built-in support untuk Prometheus dan OpenTelemetry; default configuration mengekspor Prometheus metrics via scraping endpoint. Ini penting untuk monitoring Zeebe, gateway, exporter, dan komponen lain. Camunda juga mendokumentasikan bahwa Java job worker dapat memakai metrics melalui Micrometer. Referensi resmi: Camunda metrics/monitoring dan job worker docs.  

Metrics engine/platform biasanya menjawab:

- broker hidup atau tidak,
- request rate,
- command processing,
- exporter lag,
- partition health,
- gateway latency,
- incident count,
- job activation/completion behavior.

Tetapi metrics platform saja belum cukup untuk business observability.

### 5.2 Metrics application/worker

Worker Java perlu metrics sendiri:

```text
camunda_worker_jobs_activated_total{jobType}
camunda_worker_jobs_completed_total{jobType}
camunda_worker_jobs_failed_total{jobType, failureCategory}
camunda_worker_bpmn_errors_total{jobType, errorCode}
camunda_worker_job_duration_seconds{jobType}
camunda_worker_external_call_duration_seconds{externalSystem, operation}
camunda_worker_idempotency_hits_total{jobType}
camunda_worker_idempotency_conflicts_total{jobType}
camunda_worker_retries_exhausted_total{jobType}
```

### 5.3 Process/business metrics

Process metrics berbeda:

```text
process_instances_started_total{processId, version}
process_instances_completed_total{processId, version, outcome}
process_instances_cancelled_total{processId, reason}
process_instances_active{processId, version}
process_instances_stuck{processId, elementId}
process_step_duration_seconds{processId, elementId}
user_tasks_open{taskType, candidateGroup}
user_tasks_overdue{taskType, candidateGroup}
sla_breaches_total{processId, slaType}
message_correlation_failures_total{messageName, reason}
manual_repairs_total{processId, repairType}
```

Technical dashboard yang tidak punya business metrics akan membuat platform terlihat sehat padahal business sedang macet.

### 5.4 Golden signals untuk workflow

Untuk service biasa, golden signals sering berupa latency, traffic, errors, saturation.

Untuk workflow, tambah:

| Signal | Pertanyaan |
|---|---|
| Start rate | Berapa process baru masuk? |
| Completion rate | Berapa process selesai? |
| Aging | Berapa lama process berada di step tertentu? |
| Backlog | Berapa task/job menunggu? |
| Incident rate | Berapa process stuck karena failure? |
| Retry exhaustion | Berapa job sampai retry habis? |
| SLA breach | Berapa business deadline lewat? |
| Correlation failure | Berapa event tidak bisa dicocokkan? |
| Manual repair | Berapa banyak operator harus intervensi? |
| Version distribution | Instance aktif tersebar di versi berapa? |

### 5.5 Metrics anti-pattern

Anti-pattern:

```text
Kita punya Prometheus, berarti observable.
```

Salah.

Prometheus hanya alat. Observability lahir dari pertanyaan yang benar dan instrumentation yang sesuai.

---

## 6. Distributed Tracing: Menghubungkan Process, Worker, dan External System

### 6.1 Trace dalam workflow tidak selalu linear

HTTP trace biasanya linear:

```text
API -> service A -> service B -> DB
```

Workflow trace bisa diskontinu:

```text
Day 1: Start Application Process
Day 2: Officer completes Review Task
Day 3: Timer triggers escalation
Day 4: External agency sends message
Day 5: Worker generates certificate
```

Satu process instance tidak selalu cocok menjadi satu trace panjang. Trace biasanya cocok untuk eksekusi pendek:

- start process request,
- worker handling job,
- task completion request,
- message publish request,
- external API call.

Untuk long-running correlation, gunakan business/process IDs sebagai link antar trace.

### 6.2 Trace boundary yang disarankan

Gunakan trace untuk setiap operation:

```text
POST /applications/{id}/submit
  -> start process instance

Worker validate-documents
  -> DB read
  -> document service call
  -> complete job

POST /tasks/{id}/complete
  -> authorization check
  -> domain update
  -> complete user task

POST /webhooks/payment
  -> validate signature
  -> store inbound event
  -> publish Camunda message
```

Setiap trace harus diberi attributes:

```text
case.id
business.key
process.id
process.version
process.instance.key
element.id
job.key
job.type
message.name
correlation.key
task.id
actor.id
```

### 6.3 OpenTelemetry attributes example

```java
Span span = tracer.spanBuilder("camunda.worker.validate-documents")
    .setAttribute("case.id", caseId)
    .setAttribute("process.instance.key", String.valueOf(job.getProcessInstanceKey()))
    .setAttribute("element.id", job.getElementId())
    .setAttribute("job.key", String.valueOf(job.getKey()))
    .setAttribute("job.type", job.getType())
    .startSpan();

try (Scope scope = span.makeCurrent()) {
    handler.handle(command);
    span.setStatus(StatusCode.OK);
} catch (Exception e) {
    span.recordException(e);
    span.setStatus(StatusCode.ERROR);
    throw e;
} finally {
    span.end();
}
```

### 6.4 Trace propagation to external system

Jika worker memanggil external API, propagasikan trace context:

```text
traceparent
tracestate
x-request-id
x-correlation-id
```

Tetapi jangan bergantung pada external system untuk memahami process instance. Selalu simpan mapping internal:

```text
caseId -> processInstanceKey -> externalRequestId -> externalResponseEventId
```

---

## 7. Audit Trail: Bukan Sama dengan Log

### 7.1 Perbedaan log dan audit

| Aspek | Log | Audit |
|---|---|---|
| Tujuan | debugging/operation | accountability/evidence |
| Audience | engineer/operator | auditor/legal/business |
| Retention | relatif pendek | panjang sesuai regulasi |
| Format | technical event | business event |
| Mutability | bisa rotate/delete | harus controlled/immutable-ish |
| Isi | error, latency, stacktrace | actor, action, decision, reason, before/after |

Log menjawab:

```text
Kenapa service error?
```

Audit menjawab:

```text
Siapa menyetujui case ini, kapan, berdasarkan data apa, dengan alasan apa, dan apakah dia berwenang?
```

### 7.2 Audit event minimal

Untuk regulatory workflow, audit event sebaiknya punya:

```text
auditEventId
caseId
processInstanceKey
processDefinitionId
processDefinitionVersion
elementId
elementName
action
actorType
actorId
actorName/role snapshot
candidateGroup/permission snapshot
occurredAt
reasonCode
reasonText/reference
beforeState
afterState
businessOutcome
sourceIp/userAgent for human action
requestId/traceId
relatedDocumentIds
relatedDecisionId
relatedTaskId
repairFlag
```

### 7.3 Actor snapshot penting

Jangan hanya simpan `actorId`.

Jika dua tahun kemudian role user berubah, auditor tetap perlu tahu role saat action dilakukan.

Simpan snapshot:

```json
{
  "actorId": "u12345",
  "displayName": "Officer A",
  "rolesAtAction": ["LICENSING_REVIEWER"],
  "unitAtAction": "Enforcement Division",
  "delegation": null
}
```

### 7.4 Decision audit

Jika memakai DMN, audit bukan hanya outcome:

Bad:

```text
Application rejected
```

Better:

```json
{
  "decisionId": "eligibility_decision",
  "decisionVersion": 12,
  "inputSnapshotRef": "audit-input-789",
  "matchedRuleIds": ["R-17"],
  "output": {
    "eligible": false,
    "reasonCode": "MISSING_MANDATORY_DOCUMENT"
  }
}
```

### 7.5 Audit repair

Manual repair adalah area sensitif.

Repair harus diaudit seperti business action:

```json
{
  "action": "PROCESS_VARIABLE_REPAIRED",
  "caseId": "APP-2026-000123",
  "processInstanceKey": "2251799813685249",
  "elementId": "task_wait_payment",
  "repairType": "VARIABLE_CORRECTION",
  "before": {
    "paymentStatus": "UNKNOWN"
  },
  "after": {
    "paymentStatus": "PAID"
  },
  "reasonCode": "PAYMENT_GATEWAY_CALLBACK_MISSED",
  "approvedBy": "ops-lead-01",
  "performedBy": "support-02",
  "occurredAt": "2026-06-17T10:00:00+07:00"
}
```

Tanpa audit repair, production fix bisa menjadi risiko legal.

---

## 8. Camunda Operate: Process State Visibility

### 8.1 Peran Operate

Operate bukan pengganti logging, metrics, atau audit trail. Operate adalah operational console untuk melihat state process instance, incident, variables, dan history eksekusi di Camunda 8.

Camunda docs menjelaskan bahwa Operate dapat dipakai untuk inspect process instance, melihat instance history dan variables, serta menangani incident. Incidents dalam Camunda 8 merepresentasikan error condition yang mencegah process instance maju dan membutuhkan user/operator intervention.

### 8.2 Apa yang bisa dilihat di Operate

Biasanya operator ingin melihat:

- process instance key,
- BPMN diagram dengan active token,
- current active element,
- incident marker,
- variable values,
- executed path,
- error message,
- retries,
- process version.

### 8.3 Apa yang tidak cukup dari Operate

Operate tidak otomatis menjawab semua pertanyaan business:

- apakah officer yang approve memang authorized menurut aplikasi?
- apakah rule decision benar menurut policy yang berlaku saat itu?
- apakah external payment sudah masuk ke domain DB?
- apakah document file benar-benar tersimpan?
- apakah repair sudah disetujui?
- apakah SLA business calendar menghitung hari libur lokal?

Karena itu, desain observability harus menggabungkan:

```text
Operate
+ application logs
+ metrics
+ traces
+ domain audit trail
+ business dashboard
+ runbook
```

### 8.4 Operate as repair tool

Operate bisa membantu melihat dan memperbaiki instance tertentu, tetapi prinsipnya:

```text
Repair should be controlled, authorized, auditable, and reversible where possible.
```

Jangan menjadikan Operate sebagai “admin bebas edit process” tanpa governance.

---

## 9. Dashboard Design

### 9.1 Dashboard 1 — Platform Health

Audience: platform engineer / SRE.

Pertanyaan:

- apakah Zeebe cluster sehat?
- apakah gateway menerima traffic normal?
- apakah exporter/search store lag?
- apakah pod restart?
- apakah CPU/memory/disk/network sehat?

Panel:

```text
Zeebe broker health
Gateway request rate/latency/error
Partition status
Exporter lag
Command processing latency
Incident count
Pod restarts
CPU/memory
Disk usage
Search store health
```

### 9.2 Dashboard 2 — Worker Health

Audience: backend engineer.

Pertanyaan:

- worker mana yang lambat?
- job type mana yang banyak fail?
- external dependency mana yang bermasalah?
- retry habis di mana?
- idempotency conflict terjadi?

Panel:

```text
Jobs activated/completed/failed by jobType
Worker duration p50/p95/p99
External call duration/error
Retries exhausted
BPMN errors thrown
Idempotency hit/conflict
Worker pod availability
Queue/backlog approximation
```

### 9.3 Dashboard 3 — Business Process Health

Audience: PM, business ops, support lead, tech lead.

Pertanyaan:

- berapa case masuk hari ini?
- berapa selesai?
- berapa pending?
- step mana yang bottleneck?
- SLA breach di mana?
- officer group mana backlog-nya tinggi?

Panel:

```text
Started/completed/cancelled process count
Active instance by step
Average duration by process/step
Open user tasks by candidate group
Overdue user tasks
SLA nearing breach
SLA breached
Process outcome distribution
Manual repair count
```

### 9.4 Dashboard 4 — Incident & Repair

Audience: support engineer / incident commander.

Pertanyaan:

- incident apa yang aktif?
- sudah berapa lama?
- process dan step apa?
- owner siapa?
- apakah ada retry storm?
- apakah repair dilakukan?

Panel:

```text
Open incidents by process/element/jobType
Incident age distribution
Top error messages/categories
Retries exhausted by jobType
Manual repair actions
Resolved incident count
Mean time to acknowledge
Mean time to repair
```

### 9.5 Dashboard 5 — Audit/Compliance

Audience: compliance/security/audit.

Pertanyaan:

- action privileged apa yang terjadi?
- siapa melakukan manual repair?
- siapa override decision?
- apakah ada unauthorized attempt?
- apakah task completion sesuai role?

Panel:

```text
Privileged actions
Manual repair approvals
Decision overrides
Task reassignment
Access denied events
Role snapshot anomalies
Sensitive data access events
Audit export status
```

---

## 10. Alerting: Hindari Noise, Fokus pada Failure yang Actionable

### 10.1 Alert bukan dashboard

Dashboard untuk melihat. Alert untuk membangunkan orang.

Bad alert:

```text
camunda_job_failed_total increased
```

Ini bisa normal karena retryable failure sementara.

Better alert:

```text
High retries exhausted for jobType=generate-certificate over 10 minutes
```

Atau:

```text
Open incidents for process=licensing_application older than 30 minutes
```

### 10.2 Alert yang disarankan

| Alert | Condition | Kenapa penting |
|---|---|---|
| Incident spike | incident count naik tajam | process stuck |
| Old incident | incident age > threshold | repair tidak jalan |
| Worker failure spike | failed jobs tinggi untuk jobType | bug/dependency issue |
| Retry exhaustion | retry habis | butuh manual/bug fix |
| No completion | process started normal tapi completed drop | bottleneck sistemik |
| User task backlog | open tasks tinggi | operational bottleneck |
| SLA breach | SLA breached > threshold | business risk |
| Message correlation failure | correlation fail spike | integration/key mismatch |
| Exporter lag | lag tinggi | Operate/read model stale |
| Worker unavailable | no active worker/pod | process tidak bisa maju |

### 10.3 Alert harus punya runbook link

Setiap alert harus menjawab:

```text
What happened?
Why do we care?
Who owns it?
Where to inspect?
What first action?
What not to do?
How to escalate?
```

Contoh alert annotation:

```yaml
summary: "High incidents for validate-documents worker"
description: "More than 20 incidents in 10m for jobType=validate-documents"
runbook: "https://internal/runbooks/camunda/validate-documents-incident"
owners: "backend-workflow-team"
dashboards: "grafana/camunda-worker-health"
operateSearch: "processId=licensing_application_process elementId=task_validate_documents"
```

---

## 11. Runbook-driven Observability

Observability tanpa runbook membuat engineer tetap bingung.

### 11.1 Runbook untuk incident job

Template:

```markdown
# Runbook: Failed Job Incident

## Symptoms
- Open incident in Operate
- jobType: `<job-type>`
- elementId: `<element-id>`

## First Checks
1. Check Operate instance variables.
2. Check application logs by processInstanceKey/jobKey.
3. Check worker metrics for jobType.
4. Check external dependency health.
5. Check recent deployment.

## Classify Failure
- Invalid business data?
- External dependency down?
- Timeout?
- Code bug?
- Configuration/secret expired?
- Duplicate/side-effect ambiguity?

## Safe Actions
- If external dependency recovered: increase retries.
- If variable invalid and approved: correct variable with audit record.
- If code bug fixed: redeploy worker, then retry.
- If side effect uncertain: reconcile external system before retry.

## Dangerous Actions
- Do not blindly retry payment/certificate/email jobs.
- Do not edit variables without audit approval.
- Do not cancel process without business owner approval.

## Escalation
- Backend TL
- Business ops
- Platform/SRE
```

### 11.2 Runbook untuk missing message

```markdown
# Runbook: Missing Message Correlation

## Symptoms
- Process stuck at message catch event
- External system claims it sent event

## Checks
1. Search inbound_event table by caseId/correlationKey.
2. Search logs by externalEventId.
3. Check messageName/correlationKey mapping.
4. Check TTL expiration.
5. Check duplicate/stale status.
6. Check process instance active element.

## Safe Actions
- If event received but not published: replay from inbound_event table.
- If wrong correlation key: require approved repair/replay.
- If process already timed out: follow late event policy.

## Dangerous Actions
- Do not publish synthetic message without evidence.
- Do not reuse correlation key across unrelated process instances.
```

### 11.3 Runbook untuk SLA breach

```markdown
# Runbook: SLA Breach

## Symptoms
- User task overdue
- SLA dashboard breach count increased

## Checks
1. Identify process and task group.
2. Check assignment/candidate group.
3. Check business calendar calculation.
4. Check if task is waiting for external dependency.
5. Check if escalation timer fired.
6. Check if notification sent.

## Safe Actions
- Escalate to supervisor group.
- Reassign task if authorized.
- Record reason for SLA breach.

## Dangerous Actions
- Do not silently extend due date.
- Do not complete task on behalf of officer without authorization.
```

---

## 12. Observability for User Tasks

Human workflow needs dedicated observability.

### 12.1 Metrics user task

```text
user_tasks_created_total{taskType, candidateGroup}
user_tasks_completed_total{taskType, candidateGroup, outcome}
user_tasks_open{taskType, candidateGroup}
user_tasks_overdue{taskType, candidateGroup}
user_task_duration_seconds{taskType, candidateGroup}
user_task_claim_latency_seconds{taskType, candidateGroup}
user_task_reassignment_total{taskType, fromGroup, toGroup}
user_task_escalation_total{taskType, escalationLevel}
```

### 12.2 Audit user task

Audit event untuk user task completion harus menyimpan:

```text
taskId
caseId
processInstanceKey
taskDefinitionId
taskName
actorId
actorRoleSnapshot
action: CLAIM/ASSIGN/COMPLETE/REASSIGN/CANCEL
outcome
reasonCode
submittedFormDataRef
beforeState
afterState
occurredAt
ip/userAgent
```

### 12.3 Common issue: stuck human tasks

Sebuah task bisa stuck karena:

- candidate group salah,
- user tidak punya permission,
- due date tidak diset,
- assignment ke user yang cuti/resign,
- UI filter salah,
- process version baru mengubah task id,
- task completed di domain app tapi tidak completed di engine,
- task completed di engine tapi domain update gagal.

Observability harus bisa membedakan ini.

---

## 13. Observability for Message Correlation

Message correlation failure sering sulit dilihat jika tidak di-instrument.

### 13.1 Metrics

```text
messages_received_total{messageName, sourceSystem}
messages_published_total{messageName}
messages_correlated_total{messageName}
messages_correlation_failed_total{messageName, reason}
messages_duplicate_total{messageName}
messages_stale_total{messageName}
messages_late_after_timeout_total{messageName}
messages_buffered_total{messageName}
```

### 13.2 Failure reason taxonomy

```text
NO_ACTIVE_SUBSCRIPTION
WRONG_CORRELATION_KEY
DUPLICATE_EVENT
STALE_EVENT
MESSAGE_TTL_EXPIRED
PROCESS_ALREADY_COMPLETED
PROCESS_ALREADY_CANCELLED
MESSAGE_NAME_MISMATCH
INVALID_SIGNATURE
INVALID_PAYLOAD
```

### 13.3 Inbound event table

Jangan hanya langsung publish message ke Camunda dari webhook lalu lupa.

Gunakan inbound event table:

```sql
CREATE TABLE inbound_event (
    event_id              VARCHAR(100) PRIMARY KEY,
    source_system         VARCHAR(100) NOT NULL,
    message_name          VARCHAR(100) NOT NULL,
    correlation_key       VARCHAR(200) NOT NULL,
    case_id               VARCHAR(100),
    payload_ref           VARCHAR(500),
    payload_hash          VARCHAR(100),
    received_at           TIMESTAMP NOT NULL,
    status                VARCHAR(50) NOT NULL,
    failure_reason        VARCHAR(100),
    process_instance_key  VARCHAR(100),
    published_at          TIMESTAMP,
    correlated_at         TIMESTAMP
);
```

Ini membantu:

- replay,
- dedup,
- audit,
- reconciliation,
- debugging.

---

## 14. Observability for Timers and SLA

Timer yang tidak diamati akan menjadi silent bottleneck.

### 14.1 Metrics timer/SLA

```text
sla_started_total{slaType, processId}
sla_paused_total{slaType, reason}
sla_resumed_total{slaType}
sla_breached_total{slaType, processId}
timer_triggered_total{timerType, elementId}
reminder_sent_total{taskType, reminderLevel}
escalation_triggered_total{taskType, escalationLevel}
late_event_after_timeout_total{messageName}
```

### 14.2 Audit SLA

SLA audit harus bisa menjawab:

- kapan SLA dimulai?
- kapan paused?
- kenapa paused?
- kapan resumed?
- due date dihitung berdasarkan calendar apa?
- siapa override due date?
- escalation dikirim ke siapa?
- breach reason apa?

### 14.3 Late event policy

Jika payment confirmation datang setelah payment deadline:

Observability harus merekam:

```text
Event received after timeout
Process already moved to cancellation/rejection path
Late event handling policy applied
Manual reconciliation required or auto-refund triggered
```

Tanpa ini, late event bisa hilang diam-diam.

---

## 15. Observability for Idempotency and Side Effects

Worker reliability tidak lengkap tanpa observability idempotency.

### 15.1 Metrics

```text
idempotency_attempt_total{operation}
idempotency_first_execution_total{operation}
idempotency_duplicate_same_result_total{operation}
idempotency_conflict_total{operation}
idempotency_in_progress_total{operation}
side_effect_ambiguous_total{operation, externalSystem}
reconciliation_required_total{operation, externalSystem}
```

### 15.2 Log event

```json
{
  "event": "IDEMPOTENCY_DUPLICATE_DETECTED",
  "operation": "generate-certificate",
  "idempotencyKey": "APP-2026-000123:generate-certificate:v1",
  "caseId": "APP-2026-000123",
  "processInstanceKey": "2251799813685249",
  "jobKey": "2251799813690000",
  "previousResultStatus": "SUCCESS",
  "action": "RETURN_PREVIOUS_RESULT_AND_COMPLETE_JOB"
}
```

### 15.3 Side-effect ambiguity

Dangerous case:

```text
Worker calls payment API
Payment API times out
Worker does not know if payment succeeded
Worker retries
Duplicate charge possible
```

Observability requirement:

```text
SIDE_EFFECT_AMBIGUOUS
externalRequestId
idempotencyKey
reconciliationStatus
manualReviewRequired
```

Do not hide ambiguity as a normal timeout.

---

## 16. Observability Data Model

Untuk serious workflow platform, sering dibutuhkan projection/read model sendiri.

### 16.1 Process tracking table

```sql
CREATE TABLE process_case_tracking (
    case_id                  VARCHAR(100) PRIMARY KEY,
    business_key             VARCHAR(100) NOT NULL,
    process_instance_key     VARCHAR(100) NOT NULL,
    process_definition_id    VARCHAR(200) NOT NULL,
    process_version          INTEGER NOT NULL,
    current_state            VARCHAR(100) NOT NULL,
    current_element_id       VARCHAR(200),
    current_element_name     VARCHAR(300),
    started_at               TIMESTAMP NOT NULL,
    last_moved_at            TIMESTAMP NOT NULL,
    completed_at             TIMESTAMP,
    outcome                  VARCHAR(100),
    incident_status          VARCHAR(50),
    sla_status               VARCHAR(50),
    updated_at               TIMESTAMP NOT NULL
);
```

### 16.2 Step history table

```sql
CREATE TABLE process_step_history (
    id                       VARCHAR(100) PRIMARY KEY,
    case_id                  VARCHAR(100) NOT NULL,
    process_instance_key     VARCHAR(100) NOT NULL,
    element_id               VARCHAR(200) NOT NULL,
    element_name             VARCHAR(300),
    element_type             VARCHAR(100),
    entered_at               TIMESTAMP NOT NULL,
    exited_at                TIMESTAMP,
    duration_ms              BIGINT,
    outcome                  VARCHAR(100),
    incident_flag            BOOLEAN DEFAULT FALSE
);
```

### 16.3 Why not only query Camunda?

Karena application often needs:

- business filtering,
- custom SLA logic,
- reporting by agency/unit/officer,
- long retention,
- audit immutability,
- business dashboard,
- cross-process aggregation,
- data warehouse export.

Camunda/Operate is operational runtime visibility. Domain reporting often needs its own projection.

---

## 17. Failure Diagnosis Mental Model

Ketika sebuah case stuck, jangan langsung retry. Diagnosis dulu.

### 17.1 Stuck process decision tree

```text
Case stuck
│
├─ Is there an active incident?
│  ├─ Yes -> inspect jobType, elementId, error, retries
│  └─ No
│
├─ Is it waiting at user task?
│  ├─ Yes -> check assignment, candidate group, due date, UI visibility
│  └─ No
│
├─ Is it waiting at message catch event?
│  ├─ Yes -> check inbound event, correlation key, TTL, external system
│  └─ No
│
├─ Is it waiting at timer?
│  ├─ Yes -> check due date/timezone/business calendar
│  └─ No
│
├─ Is worker available for job type?
│  ├─ No -> deploy/restart worker
│  └─ Yes
│
├─ Is process waiting for parallel join?
│  ├─ Yes -> identify unfinished branch
│  └─ No
│
└─ Inspect process model/version and history
```

### 17.2 Do not confuse symptoms

| Symptom | Possible causes |
|---|---|
| Incident | retry exhausted, uncaught BPMN error, bad expression, variable missing |
| User task overdue | business backlog, wrong assignment, user unavailable, UI bug |
| Message not correlated | wrong key, no subscription, event early/late, TTL expired |
| Timer not triggered | timezone, wrong expression, engine issue, expectation mismatch |
| Process not completing | parallel join waiting, hidden branch, external wait, incident |
| Duplicate external effect | worker retry, timeout after success, missing idempotency |

---

## 18. Java/Spring Boot Observability Blueprint

### 18.1 Dependencies concept

Di Java 17/21 Spring Boot, typical stack:

```text
Spring Boot Actuator
Micrometer
Prometheus registry
OpenTelemetry Java agent or SDK
Structured JSON logging
Logback encoder
Camunda Spring Boot Starter / Java Client
```

### 18.2 Worker wrapper pattern

Jangan taruh observability manual berulang di setiap worker.

Buat wrapper:

```java
public final class ObservableJobHandler<T> {

    private final MeterRegistry meterRegistry;
    private final Tracer tracer;
    private final JobVariableMapper<T> mapper;
    private final BusinessJobHandler<T> delegate;

    public void handle(ActivatedJob job, JobClient client) {
        String jobType = job.getType();
        Timer.Sample sample = Timer.start(meterRegistry);

        Span span = tracer.spanBuilder("camunda.job." + jobType)
            .setAttribute("camunda.job.type", jobType)
            .setAttribute("camunda.job.key", String.valueOf(job.getKey()))
            .setAttribute("camunda.process.instance.key", String.valueOf(job.getProcessInstanceKey()))
            .setAttribute("camunda.element.id", job.getElementId())
            .startSpan();

        try (Scope scope = span.makeCurrent()) {
            installMdc(job);

            T command = mapper.from(job);
            BusinessJobResult result = delegate.handle(command);

            client.newCompleteCommand(job.getKey())
                .variables(result.variables())
                .send()
                .join();

            meterRegistry.counter("camunda.worker.jobs.completed", "jobType", jobType).increment();
            span.setStatus(StatusCode.OK);

        } catch (BusinessBpmnException e) {
            meterRegistry.counter("camunda.worker.bpmn_errors", "jobType", jobType, "errorCode", e.errorCode()).increment();
            span.recordException(e);
            span.setAttribute("camunda.error.type", "BPMN_ERROR");

            client.newThrowErrorCommand(job.getKey())
                .errorCode(e.errorCode())
                .errorMessage(e.getMessage())
                .send()
                .join();

        } catch (RetryableTechnicalException e) {
            meterRegistry.counter("camunda.worker.jobs.failed", "jobType", jobType, "category", e.category()).increment();
            span.recordException(e);
            span.setStatus(StatusCode.ERROR);

            client.newFailCommand(job.getKey())
                .retries(Math.max(job.getRetries() - 1, 0))
                .errorMessage(e.getMessage())
                .retryBackoff(Duration.ofSeconds(30))
                .send()
                .join();

        } catch (Exception e) {
            meterRegistry.counter("camunda.worker.jobs.failed", "jobType", jobType, "category", "UNKNOWN").increment();
            span.recordException(e);
            span.setStatus(StatusCode.ERROR);

            client.newFailCommand(job.getKey())
                .retries(0)
                .errorMessage("Unhandled worker failure: " + e.getClass().getSimpleName())
                .send()
                .join();

        } finally {
            sample.stop(meterRegistry.timer("camunda.worker.job.duration", "jobType", jobType));
            MDC.clear();
            span.end();
        }
    }

    private void installMdc(ActivatedJob job) {
        MDC.put("processInstanceKey", String.valueOf(job.getProcessInstanceKey()));
        MDC.put("elementId", job.getElementId());
        MDC.put("elementInstanceKey", String.valueOf(job.getElementInstanceKey()));
        MDC.put("jobKey", String.valueOf(job.getKey()));
        MDC.put("jobType", job.getType());
    }
}
```

Ini skeleton, bukan copy-paste final. Dalam production, completion/fail/throw commands juga perlu timeout handling, error handling, dan idempotency semantics.

### 18.3 Centralized error classification

Jangan setiap worker menentukan retry sesuka hati.

Buat classifier:

```java
public enum FailureDisposition {
    COMPLETE_WITH_RESULT,
    THROW_BPMN_ERROR,
    FAIL_WITH_RETRY,
    FAIL_NO_RETRY_INCIDENT,
    REQUIRE_RECONCILIATION
}
```

Lalu observability bisa konsisten:

```text
failure_disposition_total{jobType, disposition}
```

---

## 19. Correlating Camunda 7 and Camunda 8 Observability

### 19.1 Camunda 7

Camunda 7 observability sering terkait:

- process engine database,
- Cockpit,
- job executor,
- runtime/history tables,
- application logs,
- delegate execution,
- external task worker.

Useful identifiers:

```text
processInstanceId
executionId
activityId
jobId
taskId
businessKey
processDefinitionId
```

### 19.2 Camunda 8

Camunda 8 observability lebih terdistribusi:

- Zeebe broker/gateway,
- partitions,
- exporters,
- Operate/Tasklist read models,
- Java workers,
- search store,
- Identity,
- connectors.

Useful identifiers:

```text
processInstanceKey
elementInstanceKey
processDefinitionKey
jobKey
jobType
elementId
businessKey/correlationKey
```

### 19.3 Migration implication

Jika migrasi dari Camunda 7 ke 8, observability harus ikut dimigrasikan.

Jangan hanya convert BPMN.

Checklist migrasi observability:

```text
[ ] Business key mapping preserved
[ ] Process instance id/key mapping strategy defined
[ ] Logs updated with Camunda 8 identifiers
[ ] Metrics updated from job executor/delegate model to worker model
[ ] Incident runbooks rewritten
[ ] Cockpit-based support flows replaced with Operate-based flows
[ ] Tasklist/user task integration updated
[ ] Audit trail remains continuous across migration
[ ] Dashboards updated
[ ] Alert rules updated
```

---

## 20. Regulatory Defensibility: “Explain This Case Two Years Later”

Untuk regulatory systems, observability harus melewati test ini:

> Jika auditor memilih satu case random dua tahun dari sekarang, bisakah kita menjelaskan seluruh lifecycle-nya?

Harus bisa menjawab:

1. Process version mana yang digunakan?
2. Case masuk dari channel mana?
3. Data awal apa yang digunakan?
4. Dokumen apa yang tersedia?
5. Decision rule mana yang dievaluasi?
6. Officer siapa yang review?
7. Role/authority officer saat itu apa?
8. Task mana yang overdue?
9. SLA dihitung bagaimana?
10. Apakah ada escalation?
11. Apakah ada manual repair?
12. Siapa approve repair?
13. External system apa yang dipanggil?
14. Apakah ada retry/failure?
15. Outcome final apa dan alasannya?

Kalau jawabannya tersebar di log volatile 7 hari, berarti sistem tidak audit-ready.

---

## 21. Worked Example: Licensing Application Stuck

### 21.1 Scenario

Case:

```text
caseId = APP-2026-000123
process = licensing_application_process
current complaint = applicant says status has not moved for 5 days
```

### 21.2 Investigation path

Step 1 — Search business dashboard:

```text
caseId APP-2026-000123
status: WAITING_FOR_EXTERNAL_AGENCY_RESPONSE
active since: 2026-06-12
SLA: due 2026-06-19
incident: no
```

Step 2 — Search Operate:

```text
processInstanceKey: 2251799813685249
active element: event_wait_external_agency_response
messageName: ExternalAgencyResponseReceived
correlationKey: APP-2026-000123
```

Step 3 — Search inbound event table:

```text
No event received from agency-system for caseId APP-2026-000123
```

Step 4 — Check integration logs:

```text
No webhook call received
```

Step 5 — Check external agency status API:

```text
External agency completed review on 2026-06-14
Webhook delivery failed due to 401 expired credentials
```

Step 6 — Classification:

```text
External callback missed due to credential issue.
Process is correctly waiting.
No process incident because engine is not broken.
Operational integration issue.
```

Step 7 — Repair:

```text
1. Refresh webhook credential.
2. Replay agency event from trusted external API response.
3. Store inbound_event with source evidence.
4. Publish message with correct correlation key.
5. Audit manual replay.
```

Step 8 — Audit event:

```json
{
  "action": "EXTERNAL_EVENT_REPLAYED",
  "caseId": "APP-2026-000123",
  "messageName": "ExternalAgencyResponseReceived",
  "correlationKey": "APP-2026-000123",
  "sourceEvidence": "agency-api-response-20260617-001",
  "reasonCode": "WEBHOOK_DELIVERY_FAILED_EXPIRED_CREDENTIAL",
  "performedBy": "support-02",
  "approvedBy": "ops-lead-01"
}
```

This is observable. Not because logs exist, but because the system can explain and repair safely.

---

## 22. Common Anti-patterns

### 22.1 Logging full process variables

Problem:

```text
PII leakage, secrets leakage, log explosion.
```

Fix:

```text
Log references, counts, classification, IDs, masked values.
```

### 22.2 No business key

Problem:

```text
Operate has processInstanceKey, business user has case number, support cannot connect them.
```

Fix:

```text
Always persist mapping caseId/businessKey/processInstanceKey.
```

### 22.3 Only platform metrics

Problem:

```text
Zeebe healthy, but 1000 tasks overdue.
```

Fix:

```text
Add business/process/task metrics.
```

### 22.4 Alert on every retry

Problem:

```text
Alert fatigue.
```

Fix:

```text
Alert on retry exhaustion, incident age, breach, spike, and business impact.
```

### 22.5 No manual repair audit

Problem:

```text
Production fix cannot be justified later.
```

Fix:

```text
Repair actions require reason, before/after, approval, actor snapshot.
```

### 22.6 Trace without process identifiers

Problem:

```text
Trace shows service calls but cannot map to business case.
```

Fix:

```text
Add caseId/processInstanceKey/jobKey/taskId attributes.
```

### 22.7 Dashboard without owner

Problem:

```text
Everyone sees red panel, nobody acts.
```

Fix:

```text
Each dashboard/alert needs owner and runbook.
```

---

## 23. Production Readiness Checklist

### 23.1 Identifier

```text
[ ] caseId/businessKey defined
[ ] processInstanceKey persisted in domain tracking table
[ ] jobKey/jobType logged in worker
[ ] taskId logged/audited for human actions
[ ] messageName/correlationKey logged for message events
[ ] traceId/requestId propagated
```

### 23.2 Logs

```text
[ ] structured JSON logs
[ ] consistent event names
[ ] MDC installed and cleared
[ ] no full variable dump
[ ] error classification logged
[ ] side-effect ambiguity explicitly logged
```

### 23.3 Metrics

```text
[ ] platform metrics scraped
[ ] worker metrics instrumented
[ ] business process metrics available
[ ] user task backlog/aging metrics available
[ ] SLA metrics available
[ ] message correlation failure metrics available
[ ] idempotency metrics available
```

### 23.4 Tracing

```text
[ ] worker spans created
[ ] task completion traces created
[ ] message publish traces created
[ ] external API trace propagation enabled
[ ] process identifiers added as span attributes
```

### 23.5 Audit

```text
[ ] human action audit trail
[ ] decision audit snapshot
[ ] manual repair audit
[ ] actor role snapshot
[ ] before/after state for sensitive actions
[ ] retention policy defined
```

### 23.6 Dashboards

```text
[ ] platform health dashboard
[ ] worker health dashboard
[ ] business process dashboard
[ ] incident/repair dashboard
[ ] audit/security dashboard
```

### 23.7 Alerting

```text
[ ] actionable alerts only
[ ] incident spike alert
[ ] old incident alert
[ ] SLA breach alert
[ ] worker unavailable alert
[ ] message correlation failure alert
[ ] exporter/search lag alert
[ ] each alert has runbook and owner
```

### 23.8 Runbooks

```text
[ ] failed job incident runbook
[ ] missing message runbook
[ ] overdue task runbook
[ ] SLA breach runbook
[ ] duplicate side effect runbook
[ ] manual repair runbook
```

---

## 24. Ringkasan Mental Model

Observability workflow bukan hanya “bisa lihat log”.

Workflow observable jika kita bisa menjawab lima pertanyaan:

```text
1. Where is the case now?
2. How did it get there?
3. Why is it delayed, failed, or stuck?
4. What is safe to do next?
5. Can we prove all of this later?
```

Camunda menyediakan process runtime visibility melalui engine, Operate, Tasklist, incidents, variables, dan platform metrics. Tetapi sistem production-grade tetap membutuhkan instrumentation di Java worker, domain audit trail, process tracking projection, business dashboards, runbooks, dan governance repair.

Top 1% engineer tidak hanya membuat BPMN berjalan. Mereka membuat proses:

- observable,
- explainable,
- supportable,
- auditable,
- repairable,
- safe under failure.

Itulah perbedaan antara “workflow demo” dan “workflow platform yang bisa hidup di production”.

---

## 25. Apa yang Harus Dikuasai Setelah Part Ini

Setelah memahami bagian ini, kamu harus bisa:

1. membedakan log, metrics, trace, audit, dan process telemetry;
2. mendesain identifier strategy untuk Camunda process;
3. membuat structured logging untuk Java worker;
4. menentukan business/process metrics yang benar;
5. membuat alert yang actionable;
6. membangun runbook diagnosis untuk incident, missing message, dan SLA breach;
7. memahami peran Operate tanpa menjadikannya satu-satunya observability layer;
8. mendesain audit trail untuk regulatory workflow;
9. menghindari PII leakage dari process variable logging;
10. menghubungkan process instance dengan domain case, worker execution, user task, external event, dan trace.

---

## 26. Transisi ke Part Berikutnya

Part ini membahas cara melihat dan memahami sistem workflow ketika berjalan.

Part berikutnya akan membahas apa yang harus dilakukan ketika sistem workflow bermasalah di production:

- incident taxonomy,
- stuck process,
- retry repair,
- variable correction,
- process modification,
- cancellation,
- migration,
- audit-safe repair,
- operational runbook engineering.

Lanjut ke:

> **Part 22 — Production Operations: Incidents, Repair, Migration, and Runbook Engineering**

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 20 — Testing BPMN and Camunda Applications](./learn-java-bpmn-camunda-part-20-testing-bpmn-and-camunda-applications.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 22 — Production Operations: Incidents, Repair, Migration, and Runbook Engineering](./learn-java-bpmn-camunda-part-22-production-ops-incidents-repair-migration-runbook-engineering.md)

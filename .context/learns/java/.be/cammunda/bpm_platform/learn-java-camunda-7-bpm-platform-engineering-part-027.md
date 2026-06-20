# learn-java-camunda-7-bpm-platform-engineering-part-027.md

# Part 027 — Observability and Troubleshooting: Metrics, Logs, Cockpit, SQL Diagnostics, and Incident Forensics

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `027`  
> Topik: Observability, troubleshooting, forensic analysis, dan production incident playbook untuk Camunda BPM Platform 7.x  
> Target pembaca: engineer senior/principal yang perlu mengoperasikan Camunda 7 sebagai workflow platform produksi, bukan sekadar menulis BPMN/delegate.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami observability Camunda 7 sebagai gabungan antara **engine observability**, **business process observability**, dan **platform observability**.
2. Menentukan metrik apa yang penting untuk Job Executor, external task, incident, history cleanup, database, dan user task queue.
3. Membaca gejala produksi dari tabel Camunda tanpa melakukan mutation manual terhadap database engine.
4. Men-debug process instance yang terlihat stuck, duplicate, retry terus, gagal correlation, gagal timer, atau terkena optimistic locking storm.
5. Membedakan masalah modelling, masalah transaction boundary, masalah worker, masalah database, masalah deployment, dan masalah integration downstream.
6. Mendesain logging dan correlation id strategy agar satu business case bisa ditelusuri melewati frontend, domain API, Camunda engine, delegate, worker, DB, message broker, dan external system.
7. Membuat runbook operasional yang aman: kapan retry, kapan suspend, kapan modify process instance, kapan migrate, kapan cancel, kapan restore, dan kapan escalate ke DBA/platform team.

Bagian ini bukan tutorial “cara membuka Cockpit”. Fokusnya adalah **cara berpikir forensik** ketika Camunda 7 berjalan di produksi.

---

## 2. Mental Model: Camunda 7 Observability Itu Multi-Layer

Camunda 7 bukan sekadar aplikasi Java biasa. Ia adalah **durable process state machine** yang menulis state ke database, melanjutkan execution lewat Job Executor, menerima command dari API, menjalankan delegate/worker, dan menyimpan history/audit projection.

Karena itu, observability-nya tidak bisa hanya berupa:

```text
CPU tinggi -> tambah pod
```

atau:

```text
Ada incident -> klik retry
```

Mental model yang lebih benar:

```text
Business Event
   -> Domain/API Layer
      -> Camunda Command
         -> CommandContext
            -> Runtime Table Mutation
            -> Job/Event/Task/Variable Change
            -> Commit/Rollback
               -> Job Executor / Worker / Human Task / Message / Timer
                  -> External Side Effect
                     -> History/Audit/Projection
```

Setiap layer punya sinyal observability berbeda.

| Layer | Yang diamati | Contoh sinyal |
|---|---|---|
| Business process | SLA, aging, state distribution, escalation, stuck case | case pending review > 7 hari, appeal overdue |
| Engine runtime | execution, task, job, variable, event subscription, incident | ACT_RU_JOB menumpuk, incident naik |
| Job Executor | acquisition, lock, retries, due jobs, execution time | job due tapi tidak dieksekusi |
| External worker | fetch rate, lock duration, failure, completion, BPMN error | lock expired, duplicate completion |
| Database | query latency, locks, bloat, index usage, connection pool | ACT_RU_JOB hot, ACT_HI_* besar |
| Application runtime | JVM memory, GC, thread pool, HTTP latency, logs | thread pool saturated |
| Integration | downstream timeout/error, duplicate command, idempotency | email terkirim dua kali, payment retry |
| Security/audit | actor, operation log, tenant, authorization failure | unauthorized task complete attempt |

Top 1% engineer tidak melihat incident sebagai “error Camunda”. Ia bertanya:

1. State apa yang sedang ditahan engine?
2. Boundary transaksi terakhir di mana?
3. Siapa retry owner-nya?
4. Apakah side effect sudah terjadi?
5. Apakah masalahnya recoverable dengan retry, atau butuh compensation?
6. Apakah data runtime, history, dan domain audit konsisten?
7. Apakah operator action akan memperbaiki atau memperburuk state?

---

## 3. Observability Bukan Hanya Monitoring

Ada perbedaan penting:

| Istilah | Makna |
|---|---|
| Monitoring | Mengukur kondisi sistem dan memberi alert |
| Observability | Kemampuan memahami internal state dari external signals |
| Troubleshooting | Menemukan penyebab gangguan spesifik |
| Forensics | Merekonstruksi kronologi dan causal chain setelah kejadian |
| Operations | Mengambil tindakan aman untuk memulihkan sistem |

Untuk Camunda 7, observability yang baik harus bisa menjawab:

```text
Untuk case business X:
- Process instance mana yang mewakilinya?
- Definition version berapa?
- Activity apa yang aktif?
- Ada user task aktif?
- Ada job due?
- Ada external task locked?
- Ada event subscription menunggu message?
- Ada incident?
- Retry terakhir kapan?
- Error message terakhir apa?
- Variable penting apa nilainya?
- Siapa actor terakhir?
- Side effect eksternal apa yang sudah terjadi?
- Apakah history menunjukkan timeline yang masuk akal?
```

Jika sistem tidak bisa menjawab pertanyaan ini dalam incident call, observability-nya belum cukup.

---

## 4. Camunda 7 Runtime Signals: Apa Yang Harus Dipantau

### 4.1 Job Signals

Job adalah pusat banyak problem production karena async continuation, timer, failed retry, dan internal background work memakai job.

Pantau minimal:

| Signal | Kenapa penting |
|---|---|
| due job count | Menunjukkan backlog job yang sudah seharusnya dieksekusi |
| locked job count | Menunjukkan job sedang dimiliki executor |
| failed job count | Menunjukkan job dengan retries rendah/habis |
| incident count | Menunjukkan process stuck butuh intervensi |
| average job age | Mengukur delay dari due date ke execution |
| retry distribution | Menunjukkan retry storm atau downstream instability |
| job acquisition latency | Menunjukkan executor/DB bottleneck |
| job execution duration | Menunjukkan delegate/operation lambat |
| lock expiration pattern | Menunjukkan job execution lebih lama dari lock time atau node mati |

SQL diagnosis dasar:

```sql
-- Due jobs waiting to be acquired
select count(*) as due_jobs
from ACT_RU_JOB
where DUEDATE_ <= current_timestamp
  and LOCK_OWNER_ is null
  and RETRIES_ > 0;
```

```sql
-- Jobs currently locked
select LOCK_OWNER_, count(*) as locked_jobs
from ACT_RU_JOB
where LOCK_OWNER_ is not null
  and LOCK_EXP_TIME_ > current_timestamp
 group by LOCK_OWNER_
 order by locked_jobs desc;
```

```sql
-- Failed jobs / retries exhausted
select RETRIES_, count(*) as job_count
from ACT_RU_JOB
 group by RETRIES_
 order by RETRIES_;
```

```sql
-- Oldest due jobs
select ID_, TYPE_, HANDLER_TYPE_, DUEDATE_, LOCK_OWNER_, LOCK_EXP_TIME_, RETRIES_, EXCEPTION_MSG_
from ACT_RU_JOB
where DUEDATE_ <= current_timestamp
order by DUEDATE_ asc;
```

Interpretasi:

- Due jobs tinggi + tidak locked: acquisition tidak jalan, executor mati, deployment-aware mismatch, DB query lambat, atau executor disabled.
- Locked jobs tinggi + tidak selesai: executor lambat, delegate stuck, external dependency lambat, thread pool saturated, atau lock time terlalu panjang.
- Retries 0 banyak: incident storm.
- RETRIES_ turun tapi exception message sama: kemungkinan downstream persistent failure.
- LOCK_EXP_TIME_ masa lalu tapi LOCK_OWNER_ masih ada: lease expired; job bisa diambil node lain.

### 4.2 Incident Signals

Incident bukan sekadar error log. Incident berarti engine menandai state yang tidak bisa dilanjutkan otomatis.

Pantau:

| Signal | Makna |
|---|---|
| active incident count | jumlah state stuck |
| incident age | risiko SLA dan audit |
| incident by process definition | model/delegate bermasalah |
| incident by activity id | titik failure spesifik |
| incident by error message | root cause cluster |
| repeated incident after retry | retry tidak menyelesaikan root cause |

SQL:

```sql
select PROC_DEF_ID_, ACTIVITY_ID_, INCIDENT_TYPE_, count(*) as cnt
from ACT_RU_INCIDENT
 group by PROC_DEF_ID_, ACTIVITY_ID_, INCIDENT_TYPE_
 order by cnt desc;
```

```sql
select ID_, PROC_INST_ID_, EXECUTION_ID_, ACTIVITY_ID_, INCIDENT_TYPE_, INCIDENT_MSG_, CREATE_TIME_
from ACT_RU_INCIDENT
order by CREATE_TIME_ asc;
```

Operational rule:

```text
Retry incident hanya aman jika:
1. root cause sudah diperbaiki, atau
2. failure bersifat transient, dan
3. side effect delegate/worker idempotent, dan
4. process state belum dimodifikasi manual dengan cara yang mengubah asumsi delegate.
```

Jika tidak, retry bisa menciptakan duplicate email, duplicate payment, duplicate document generation, atau inconsistent external state.

### 4.3 External Task Signals

External task punya observability berbeda dari job executor.

Pantau:

| Signal | Kenapa penting |
|---|---|
| open external tasks per topic | backlog worker |
| locked external tasks per worker | worker distribution |
| expired lock count | worker terlalu lambat/mati |
| retries distribution | failure rate |
| oldest locked task | stuck worker |
| completion latency | throughput downstream |
| BPMN error count | business alternative frequency |
| failure reason clusters | downstream/contract issue |

SQL:

```sql
select TOPIC_NAME_, count(*) as open_tasks
from ACT_RU_EXT_TASK
where SUSPENSION_STATE_ = 1
 group by TOPIC_NAME_
 order by open_tasks desc;
```

```sql
select TOPIC_NAME_, WORKER_ID_, count(*) as locked_tasks
from ACT_RU_EXT_TASK
where LOCK_EXP_TIME_ > current_timestamp
 group by TOPIC_NAME_, WORKER_ID_
 order by locked_tasks desc;
```

```sql
select TOPIC_NAME_, RETRIES_, count(*) as cnt
from ACT_RU_EXT_TASK
 group by TOPIC_NAME_, RETRIES_
 order by TOPIC_NAME_, RETRIES_;
```

Common interpretation:

- Open task menumpuk tanpa lock: worker tidak fetch, topic salah, authorization REST salah, worker down, network blocked.
- Locked task menumpuk: worker terlalu lambat, lock duration terlalu panjang, graceful shutdown buruk.
- Lock expired berulang: lock duration terlalu pendek atau processing melebihi estimasi.
- Retries 0 banyak: worker melaporkan technical failure terus dan butuh intervention.

### 4.4 User Task Signals

User task adalah human queue. Masalahnya sering bukan technical error, tetapi operational bottleneck.

Pantau:

| Signal | Makna |
|---|---|
| open task count by task definition | bottleneck step |
| task age | SLA risk |
| due date overdue | breach risk |
| assignee distribution | workload imbalance |
| candidate group backlog | team bottleneck |
| claim age | user mengambil tapi tidak menyelesaikan |
| completion rollback count | downstream failure setelah complete |

SQL:

```sql
select TASK_DEF_KEY_, count(*) as task_count
from ACT_RU_TASK
 group by TASK_DEF_KEY_
 order by task_count desc;
```

```sql
select ID_, PROC_INST_ID_, TASK_DEF_KEY_, NAME_, ASSIGNEE_, CREATE_TIME_, DUE_DATE_
from ACT_RU_TASK
where DUE_DATE_ is not null
  and DUE_DATE_ < current_timestamp
order by DUE_DATE_ asc;
```

```sql
select ASSIGNEE_, count(*) as assigned_tasks
from ACT_RU_TASK
where ASSIGNEE_ is not null
 group by ASSIGNEE_
 order by assigned_tasks desc;
```

Human task observability harus menggabungkan Camunda data dengan domain data:

```text
Task age saja tidak cukup.
Butuh juga:
- case priority
- case type
- jurisdiction
- officer group
- SLA policy
- applicant/entity risk
- legal deadline
- evidence completeness
```

Karena itu enterprise queue biasanya butuh projection/read model.

### 4.5 Event Subscription Signals

Message, signal, conditional event, compensation, dan event subprocess menghasilkan subscription state tertentu.

Pantau:

| Signal | Makna |
|---|---|
| message subscription count | process menunggu external event |
| old subscriptions | proses lama menunggu event yang mungkin tidak datang |
| subscription by event name | integration bottleneck |
| correlation failures | event datang tapi tidak match |
| duplicate correlation attempts | event producer mengulang |

SQL:

```sql
select EVENT_TYPE_, EVENT_NAME_, count(*) as cnt
from ACT_RU_EVENT_SUBSCR
 group by EVENT_TYPE_, EVENT_NAME_
 order by cnt desc;
```

```sql
select ID_, EVENT_TYPE_, EVENT_NAME_, PROC_INST_ID_, EXECUTION_ID_, ACTIVITY_ID_, CREATED_
from ACT_RU_EVENT_SUBSCR
order by CREATED_ asc;
```

Forensics untuk message correlation:

```text
1. Apakah event subscription ada?
2. EVENT_NAME_ sesuai dengan message name?
3. PROC_INST_ID_/business key/correlation variable sesuai?
4. Apakah event datang sebelum subscription dibuat?
5. Apakah event datang setelah process lanjut/cancel?
6. Apakah ada duplicate event?
7. Apakah ingestion layer menyimpan raw event dan dedup status?
```

---

## 5. Business Observability: Jangan Hanya Melihat Engine

Camunda metric seperti job count dan incident count penting, tetapi tidak cukup. Workflow platform harus punya business KPIs.

Contoh regulatory case management:

| Business metric | Pertanyaan |
|---|---|
| case in review count | Berapa case sedang menunggu officer? |
| average review age | Berapa lama review rata-rata? |
| SLA breach count | Berapa case melewati deadline? |
| reopened case count | Apakah quality issue meningkat? |
| escalation count | Apakah kapasitas tim kurang? |
| appeal rate | Apakah decision logic dipertanyakan? |
| manual override count | Apakah rule/process terlalu kaku? |
| incident by module | Modul mana paling tidak stabil? |

Business observability idealnya tidak query langsung dari `ACT_HI_*` setiap dashboard refresh. Gunakan projection:

```text
Camunda runtime/history/domain events
   -> projection pipeline
      -> case_work_queue_view
      -> sla_dashboard_view
      -> officer_workload_view
      -> audit_timeline_view
```

Kenapa?

1. Query operational engine DB untuk dashboard berat bisa memperlambat process engine.
2. Camunda history bukan domain audit lengkap.
3. Business timeline sering butuh data dari banyak sistem.
4. Query format engine bisa berubah antar versi.
5. Projection bisa dioptimalkan untuk UI/reporting.

---

## 6. Logging Strategy

### 6.1 Logging Yang Dibutuhkan

Minimal semua log di application/delegate/worker/domain API harus membawa:

| Field | Makna |
|---|---|
| correlationId | trace lintas service/request |
| businessKey | anchor business case |
| processInstanceId | anchor Camunda runtime |
| processDefinitionKey | jenis process |
| activityId | posisi BPMN |
| taskId | jika user task |
| jobId | jika async job |
| externalTaskId | jika external worker |
| tenantId | jika multi-tenant |
| userId / serviceAccount | actor |
| commandName | operasi yang dilakukan |
| outcome | success/failure/retry/bpmn-error |
| exceptionClass | tipe error teknis |
| errorCode | business error code atau integration error code |

Contoh log JSON:

```json
{
  "timestamp": "2026-06-20T13:22:01.123Z",
  "level": "ERROR",
  "service": "case-workflow-service",
  "correlationId": "req-9f83a2",
  "businessKey": "CASE-2026-000918",
  "processInstanceId": "7f1d...",
  "processDefinitionKey": "enforcement_case",
  "activityId": "send_notice",
  "jobId": "92ab...",
  "tenantId": "agency-a",
  "commandName": "sendNotice",
  "outcome": "technical_failure_retryable",
  "exceptionClass": "SocketTimeoutException",
  "errorCode": "NOTICE_SERVICE_TIMEOUT",
  "message": "Notice service timed out after 10s"
}
```

### 6.2 MDC Propagation

Di Java application, gunakan MDC untuk memasukkan correlation context ke setiap log.

Contoh filter HTTP:

```java
public final class CorrelationIdFilter implements javax.servlet.Filter {

    private static final String HEADER = "X-Correlation-Id";

    @Override
    public void doFilter(
            javax.servlet.ServletRequest request,
            javax.servlet.ServletResponse response,
            javax.servlet.FilterChain chain
    ) throws java.io.IOException, javax.servlet.ServletException {

        javax.servlet.http.HttpServletRequest httpRequest =
                (javax.servlet.http.HttpServletRequest) request;
        javax.servlet.http.HttpServletResponse httpResponse =
                (javax.servlet.http.HttpServletResponse) response;

        String correlationId = httpRequest.getHeader(HEADER);
        if (correlationId == null || correlationId.isBlank()) {
            correlationId = java.util.UUID.randomUUID().toString();
        }

        org.slf4j.MDC.put("correlationId", correlationId);
        httpResponse.setHeader(HEADER, correlationId);

        try {
            chain.doFilter(request, response);
        } finally {
            org.slf4j.MDC.remove("correlationId");
        }
    }
}
```

Untuk Java 8, `String.isBlank()` belum ada. Gunakan helper:

```java
private static boolean isBlank(String value) {
    return value == null || value.trim().isEmpty();
}
```

### 6.3 Propagasi Context ke Delegate

Delegate bisa menambahkan data Camunda ke MDC selama execution.

```java
@Component
public final class SendNoticeDelegate implements JavaDelegate {

    private final NoticeApplicationService noticeService;

    public SendNoticeDelegate(NoticeApplicationService noticeService) {
        this.noticeService = noticeService;
    }

    @Override
    public void execute(DelegateExecution execution) throws Exception {
        putCamundaMdc(execution);
        try {
            String caseId = (String) execution.getVariable("caseId");
            noticeService.sendNotice(caseId);
        } finally {
            clearCamundaMdc();
        }
    }

    private static void putCamundaMdc(DelegateExecution execution) {
        org.slf4j.MDC.put("processInstanceId", execution.getProcessInstanceId());
        org.slf4j.MDC.put("processDefinitionId", execution.getProcessDefinitionId());
        org.slf4j.MDC.put("activityId", execution.getCurrentActivityId());
        org.slf4j.MDC.put("businessKey", execution.getProcessBusinessKey());
        if (execution.getTenantId() != null) {
            org.slf4j.MDC.put("tenantId", execution.getTenantId());
        }
    }

    private static void clearCamundaMdc() {
        org.slf4j.MDC.remove("processInstanceId");
        org.slf4j.MDC.remove("processDefinitionId");
        org.slf4j.MDC.remove("activityId");
        org.slf4j.MDC.remove("businessKey");
        org.slf4j.MDC.remove("tenantId");
    }
}
```

Important nuance:

```text
MDC is thread-local.
Camunda job execution, HTTP request handling, external worker execution, and async callbacks may run in different threads.
Therefore context must be explicitly reconstructed at each boundary.
```

### 6.4 Log Levels

Recommended log shape:

| Event | Level |
|---|---|
| normal process start/complete | INFO, but sampled if high volume |
| domain decision | INFO/AUDIT |
| technical retryable failure | WARN |
| incident/retries exhausted | ERROR |
| expected BPMN business alternative | INFO or WARN depending severity |
| authorization denial | WARN/security audit |
| duplicate idempotent request | INFO |
| unexpected invariant violation | ERROR |

Avoid:

```text
- logging all variables blindly
- logging serialized object payload
- logging PII/evidence/full document content
- logging secrets/tokens
- logging stack trace repeatedly on every retry without aggregation
```

---

## 7. Metrics Strategy

### 7.1 Engine Metrics

Camunda 7 has process engine metrics that can be exposed/queried depending on edition/configuration/runtime. Treat them as engine-level signals, not full business metrics.

Useful categories:

| Category | Examples |
|---|---|
| activity/job execution | executed activity, job acquisition/execution |
| process starts | process instance start count |
| decision evaluation | DMN evaluation count |
| external task | acquisition/completion/failure depending instrumentation |
| history cleanup | cleanup duration/backlog if instrumented |

But do not rely only on built-in metrics. Add application-level metrics around:

```text
- process start latency
- task completion latency
- message correlation success/failure
- external task fetch/complete/failure rate
- delegate execution duration
- outbound integration latency
- idempotency duplicate count
- incident creation count
- job retry count
```

### 7.2 Suggested Metric Names

For a Prometheus-like environment:

```text
camunda_process_start_total{process_key, tenant_id, outcome}
camunda_task_complete_total{task_key, process_key, outcome}
camunda_message_correlate_total{message_name, outcome}
camunda_job_due_count{process_key, activity_id}
camunda_incident_active_count{process_key, activity_id, incident_type}
camunda_external_task_open_count{topic}
camunda_external_task_complete_total{topic, outcome}
camunda_delegate_duration_seconds{delegate, activity_id, outcome}
camunda_worker_lock_expired_total{topic, worker}
camunda_business_sla_breach_count{case_type, sla_policy}
```

Do not put high-cardinality labels such as raw process instance id, business key, error message, or user id into metrics labels. Put them in logs/traces instead.

Bad:

```text
camunda_task_complete_total{businessKey="CASE-2026-000001"}
```

Good:

```text
camunda_task_complete_total{process_key="enforcement_case", task_key="review_case", outcome="success"}
```

### 7.3 Alerting

Good alerts are symptom + impact based.

Examples:

| Alert | Condition | Why |
|---|---|---|
| Incident storm | active incidents increase rapidly | process stuck, operator needed |
| Due job backlog | due jobs older than threshold | executor/downstream/DB issue |
| External task backlog | open tasks by topic above baseline | worker/downstream capacity issue |
| Lock expiration spike | expired external task locks | worker timeout/duplicate risk |
| Message correlation failures | sudden increase | integration contract/race issue |
| History cleanup lag | cleanup backlog increasing | storage risk |
| Task SLA breach | overdue task count rising | business/regulatory risk |
| DB connection saturation | pool near max | systemic runtime issue |
| DB lock wait high | query/transaction contention | possible outage precursor |

Poor alerts:

```text
CPU > 80% for 5 minutes
```

This can be useful as infrastructure signal, but not enough. Better:

```text
Due job backlog age p95 > 10 minutes AND active job executor nodes > 0
```

or:

```text
External task open count for topic send-notice > 500 for 15 minutes AND worker completion rate < baseline
```

---

## 8. Cockpit as Operational Console

Camunda Cockpit is useful for:

- inspecting process instance state,
- viewing BPMN diagram with active tokens,
- checking incidents,
- retrying failed jobs,
- inspecting variables,
- modifying process instances,
- suspending/activating process definitions or instances,
- batch operations in Enterprise editions.

But Cockpit is not a complete observability solution.

| Cockpit good for | Cockpit weak for |
|---|---|
| per-instance investigation | fleet-level analytics |
| operator action | business dashboard |
| visualizing active activity | correlation across distributed services |
| incident retry | root cause from downstream systems |
| variable inspection | PII-safe analytics |

Operational rule:

```text
Cockpit is a scalpel, not a dashboard.
```

Dangerous operations in Cockpit/API:

| Operation | Risk |
|---|---|
| retry failed job | duplicate side effect if delegate not idempotent |
| modify process instance | bypasses normal business path |
| set variable | changes branch conditions or audit assumptions |
| delete process instance | may orphan business state |
| suspend process definition | can block unrelated cases |
| migrate instances | can break variable/delegate compatibility |

Every privileged action should be audited with:

```text
- operator
- time
- process instance id
- reason
- before/after state
- variables changed
- expected business impact
- approval/reference ticket
```

---

## 9. SQL Diagnostics: Safe Read-Only Forensics

### 9.1 Rule of Thumb

Safe:

```text
SELECT from ACT_* for diagnostics.
Use engine API for mutation.
```

Dangerous:

```text
UPDATE/DELETE/INSERT into ACT_* manually.
```

Manual mutation can bypass:

- entity cache expectations,
- revision/optimistic locking,
- history consistency,
- event dispatch,
- job semantics,
- authorization,
- incident lifecycle,
- deployment cache,
- schema version compatibility.

### 9.2 Find Process Instance by Business Key

```sql
select ID_, PROC_INST_ID_, BUSINESS_KEY_, PROC_DEF_ID_, START_TIME_, END_TIME_, STATE_
from ACT_HI_PROCINST
where BUSINESS_KEY_ = :businessKey
order by START_TIME_ desc;
```

Runtime only:

```sql
select ID_, PROC_INST_ID_, BUSINESS_KEY_, PROC_DEF_ID_, ACT_ID_, IS_ACTIVE_, IS_CONCURRENT_, IS_SCOPE_
from ACT_RU_EXECUTION
where BUSINESS_KEY_ = :businessKey;
```

### 9.3 Active Runtime State

```sql
select ID_, PROC_INST_ID_, PARENT_ID_, ACT_ID_, IS_ACTIVE_, IS_CONCURRENT_, IS_SCOPE_, SUSPENSION_STATE_
from ACT_RU_EXECUTION
where PROC_INST_ID_ = :processInstanceId
order by PARENT_ID_, ID_;
```

Interpretation:

- multiple rows can be normal because execution tree is hierarchical,
- `ACT_ID_` can be null on scope/container executions,
- active leaf executions usually indicate where process waits,
- event subprocess/boundary/multi-instance can create non-obvious structure.

### 9.4 Active User Tasks

```sql
select ID_, NAME_, TASK_DEF_KEY_, ASSIGNEE_, OWNER_, CREATE_TIME_, DUE_DATE_, FOLLOW_UP_DATE_, PRIORITY_
from ACT_RU_TASK
where PROC_INST_ID_ = :processInstanceId
order by CREATE_TIME_;
```

### 9.5 Active Jobs

```sql
select ID_, TYPE_, HANDLER_TYPE_, HANDLER_CFG_, EXECUTION_ID_, PROCESS_INSTANCE_ID_,
       DUEDATE_, LOCK_OWNER_, LOCK_EXP_TIME_, RETRIES_, EXCEPTION_MSG_
from ACT_RU_JOB
where PROCESS_INSTANCE_ID_ = :processInstanceId
order by DUEDATE_;
```

### 9.6 External Tasks

```sql
select ID_, TOPIC_NAME_, WORKER_ID_, LOCK_EXP_TIME_, RETRIES_, ERROR_MSG_, ACT_ID_, PROC_INST_ID_
from ACT_RU_EXT_TASK
where PROC_INST_ID_ = :processInstanceId;
```

### 9.7 Event Subscriptions

```sql
select ID_, EVENT_TYPE_, EVENT_NAME_, EXECUTION_ID_, PROC_INST_ID_, ACTIVITY_ID_, CREATED_
from ACT_RU_EVENT_SUBSCR
where PROC_INST_ID_ = :processInstanceId;
```

### 9.8 Incidents

```sql
select ID_, INCIDENT_TYPE_, INCIDENT_MSG_, EXECUTION_ID_, ACTIVITY_ID_, CAUSE_INCIDENT_ID_, ROOT_CAUSE_INCIDENT_ID_, CREATE_TIME_
from ACT_RU_INCIDENT
where PROC_INST_ID_ = :processInstanceId
order by CREATE_TIME_;
```

### 9.9 Variables

```sql
select NAME_, TYPE_, TEXT_, TEXT2_, LONG_, DOUBLE_, BYTEARRAY_ID_, EXECUTION_ID_, TASK_ID_
from ACT_RU_VARIABLE
where PROC_INST_ID_ = :processInstanceId
order by NAME_;
```

Be careful with `BYTEARRAY_ID_`: content might contain serialized object, JSON, XML, binary file, exception detail, or sensitive data.

### 9.10 History Timeline

Activity timeline:

```sql
select ACT_ID_, ACT_NAME_, ACT_TYPE_, START_TIME_, END_TIME_, DURATION_, ASSIGNEE_, DELETE_REASON_
from ACT_HI_ACTINST
where PROC_INST_ID_ = :processInstanceId
order by START_TIME_, END_TIME_;
```

Task timeline:

```sql
select ID_, TASK_DEF_KEY_, NAME_, ASSIGNEE_, OWNER_, START_TIME_, END_TIME_, DURATION_, DELETE_REASON_
from ACT_HI_TASKINST
where PROC_INST_ID_ = :processInstanceId
order by START_TIME_;
```

Variable history:

```sql
select NAME_, VAR_TYPE_, CREATE_TIME_, REV_, TEXT_, TEXT2_, LONG_, DOUBLE_
from ACT_HI_VARINST
where PROC_INST_ID_ = :processInstanceId
order by NAME_;
```

Detailed variable changes if history level supports it:

```sql
select TIME_, NAME_, VAR_TYPE_, TEXT_, TEXT2_, LONG_, DOUBLE_, ACT_INST_ID_, TASK_ID_, USER_OPERATION_ID_
from ACT_HI_DETAIL
where PROC_INST_ID_ = :processInstanceId
order by TIME_;
```

---

## 10. Troubleshooting Playbooks

### 10.1 Process Instance “Stuck”

Symptom:

```text
Case tidak bergerak.
User bilang sudah submit/complete.
Tidak ada error jelas di UI.
```

Diagnosis path:

```text
1. Find process instance by business key.
2. Check runtime execution tree.
3. Check active user task.
4. Check active job.
5. Check external task.
6. Check event subscription.
7. Check incident.
8. Check history last completed activity.
9. Check logs around last command.
10. Check domain state and side effects.
```

Decision matrix:

| Finding | Meaning | Action |
|---|---|---|
| active user task | waiting human | check assignment/work queue |
| due job not locked | job executor/acquisition issue | inspect executor/node/DB |
| locked job old | delegate/node stuck | inspect node logs/thread dump |
| external task unlocked | worker not fetching | inspect worker/topic/auth/network |
| external task locked old | worker stuck/lock too long | inspect worker logs; consider lock expiry |
| event subscription | waiting message | check inbound event/correlation |
| incident | retries exhausted | inspect root cause before retry |
| no runtime, history ended | process completed/cancelled | check outcome/delete reason |

### 10.2 User Completed Task But It Reappeared

Likely cause:

```text
Task completion command reached downstream synchronous step.
Downstream step failed.
Transaction rolled back.
User task completion rolled back too.
```

Check:

```sql
select *
from ACT_RU_TASK
where ID_ = :taskId;
```

Check logs at task completion time.

Fix pattern:

```text
Place asyncAfter on user task or asyncBefore on risky downstream service task.
Then task completion commits first; downstream failure becomes retryable job/incident.
```

But only do this when business semantics allow it. If downstream validation must be atomic with task completion, async boundary may be wrong.

### 10.3 Duplicate Email / Duplicate External Call

Likely causes:

- job retried after failure,
- transaction rollback after side effect,
- lock expired and another executor/worker repeated work,
- operator retried incident,
- external worker timed out after sending side effect but before `complete()`.

Diagnosis:

```text
1. Find activity responsible for side effect.
2. Check whether it is async job/external task.
3. Check retry count/history log.
4. Check external idempotency key.
5. Check external system duplicate records.
6. Check whether success was recorded transactionally.
```

Correct design:

```text
sideEffectId = processInstanceId + ':' + activityId + ':' + businessCommandType
```

Store side effect attempt/result in domain/idempotency table before/after call using clear state machine:

```text
NEW -> IN_PROGRESS -> SUCCEEDED
                -> FAILED_RETRYABLE
                -> FAILED_FINAL
```

### 10.4 Due Jobs Not Executed

Check:

```sql
select count(*)
from ACT_RU_JOB
where DUEDATE_ <= current_timestamp
  and LOCK_OWNER_ is null
  and RETRIES_ > 0;
```

Then check:

1. Is Job Executor enabled?
2. Are engine nodes alive?
3. Is deployment-aware job executor filtering out deployments?
4. Are jobs suspended?
5. Are DB queries slow/blocked?
6. Are acquisition threads running?
7. Is thread pool saturated?
8. Are all nodes pointing to same DB/schema?
9. Are clocks skewed between nodes/DB?
10. Is there a large backlog causing starvation?

Common fix:

- enable executor,
- register deployment for job executor,
- scale nodes carefully,
- fix DB index/query issue,
- tune acquisition/thread pool,
- reduce downstream execution time,
- add async boundaries carefully,
- prioritize jobs if required.

### 10.5 Incident Retry Does Not Work

Symptom:

```text
Operator retries failed job, but incident returns.
```

Possible causes:

| Cause | Explanation |
|---|---|
| root cause not fixed | downstream still failing |
| bad variable | delegate reads invalid data |
| incompatible code | process instance old, delegate code new |
| missing class | deployment/classloader issue |
| auth/secret issue | worker/delegate cannot call target |
| DB constraint | process variable/domain table invalid |
| idempotency state blocked | previous attempt partially succeeded |

Safe retry checklist:

```text
1. Read exception message and stack trace.
2. Identify activity/delegate/topic.
3. Check whether downstream dependency is healthy.
4. Check variables required by delegate.
5. Check deployment version and classpath.
6. Check idempotency/side effect state.
7. Retry one instance first.
8. Observe result.
9. Bulk retry only after confidence.
```

### 10.6 Message Correlation Failed

Symptoms:

- `MismatchingMessageCorrelationException`,
- event arrives but process does not continue,
- process is waiting but wrong instance correlated,
- duplicate correlation error.

Check:

```sql
select EVENT_NAME_, PROC_INST_ID_, EXECUTION_ID_, ACTIVITY_ID_, CREATED_
from ACT_RU_EVENT_SUBSCR
where EVENT_TYPE_ = 'message'
order by CREATED_ desc;
```

Questions:

1. Is message name exactly correct?
2. Is process instance waiting at the message catch event?
3. Is the business key/correlation variable correct?
4. Is there exactly one matching subscription?
5. Did the event arrive too early?
6. Was correlation attempted on wrong tenant?
7. Did variable scope hide the correlation variable?
8. Was the process definition version changed?

Design fix:

```text
External event -> Inbox table -> Deduplicate -> Correlate command -> Record result
```

Never rely on raw Camunda correlation call as the only record of inbound event.

### 10.7 Optimistic Locking Storm

Symptoms:

- many `OptimisticLockingException`,
- parallel jobs retrying repeatedly,
- process slow but not clearly failed,
- DB row updates conflict.

Likely modelling causes:

- multiple parallel branches update same process variable,
- multi-instance writes to parent variable,
- concurrent message correlation updates same execution,
- non-exclusive jobs on same process instance,
- listener updates shared variable from many paths,
- high fan-in gateway conflict.

Diagnosis:

```text
1. Find process definition/activity with high conflict logs.
2. Check whether parallel branches update same variable/execution.
3. Check job exclusivity.
4. Check async boundaries around parallel sections.
5. Check multi-instance variable aggregation pattern.
```

Fix patterns:

| Pattern | Use when |
|---|---|
| local variables per branch | parallel branches need independent result |
| aggregate after join | parent variable should be updated once |
| exclusive jobs | serialize jobs per process instance |
| reduce parallelism | DB state conflict too high |
| idempotent retry | conflicts are acceptable/transient |
| external aggregation table | result volume large or cross-process |

### 10.8 Timer Not Firing

Check:

1. Is Job Executor running?
2. Is timer job in `ACT_RU_JOB`?
3. Is due date in future because timezone/date expression wrong?
4. Is process definition/instance suspended?
5. Is job locked by dead/stuck executor?
6. Are retries exhausted?
7. Is clock skew present?
8. Is acquisition backlog delaying timer?

SQL:

```sql
select ID_, TYPE_, HANDLER_TYPE_, DUEDATE_, LOCK_OWNER_, LOCK_EXP_TIME_, RETRIES_, EXCEPTION_MSG_
from ACT_RU_JOB
where TYPE_ = 'timer'
order by DUEDATE_;
```

If no job exists:

- process may not have reached timer wait state,
- timer start event deployment may not have registered correctly,
- timer expression may not evaluate,
- model version may differ from expected.

### 10.9 External Task Completed But Process Did Not Continue

Possible causes:

- `complete()` call failed after worker side effect,
- wrong external task id,
- lock expired before complete,
- worker unauthorized,
- variable serialization error during complete,
- downstream synchronous continuation failed after complete command,
- engine rolled back.

Design mitigation:

```text
Worker operation should be split into:
1. fetch and lock
2. idempotent external work
3. complete with minimal variables
4. handle complete failure as uncertain outcome
5. reconcile by checking Camunda state and idempotency state
```

---

## 11. Thread Dumps and JVM Diagnostics

Sometimes SQL and Cockpit are not enough. If job/execution appears stuck inside Java runtime:

Capture:

- thread dump,
- heap metrics,
- GC logs,
- connection pool metrics,
- HTTP client pool metrics,
- DB session/query state,
- worker thread pool state.

Look for:

| Symptom | Possible issue |
|---|---|
| many job executor threads blocked on HTTP | downstream slow/no timeout |
| many threads waiting for DB connection | pool exhausted |
| long GC pauses | memory pressure/large variables |
| deadlock | lock ordering issue in application code |
| blocked on synchronized delegate | singleton stateful delegate bug |
| waiting on external library | bad timeout/retry config |

Production delegate rules:

```text
- Always set outbound timeouts.
- Avoid unbounded retries inside delegate.
- Avoid synchronized blocks around remote calls.
- Avoid blocking job executor thread for long-running work.
- Prefer external task for slow/remote/polyglot workloads.
- Keep delegate stateless.
```

---

## 12. Tracing Strategy

Distributed tracing is useful, but Camunda 7 is not automatically a perfect trace root because process execution spans minutes/days/months and may cross many transactions.

Use tracing for:

- API call that starts process,
- task completion command,
- delegate HTTP call,
- external worker processing,
- message correlation command,
- job execution attempt.

Use business/process timeline for:

- entire process lifetime,
- SLA state,
- audit reconstruction,
- long-running human workflow.

Do not expect one OpenTelemetry trace to represent a 90-day enforcement case cleanly. Use:

```text
trace/span = technical transaction attempt
process timeline = durable business lifecycle
```

Recommended propagation fields:

```text
X-Correlation-Id
X-Business-Key
X-Process-Instance-Id
X-Request-Id
X-Idempotency-Key
```

But be careful not to expose internal process instance ids to untrusted external parties unless your threat model allows it.

---

## 13. Forensic Reconstruction Template

When investigating an incident, write the timeline like this:

```text
Business Key: CASE-2026-000918
Process Instance: 7f1d...
Process Definition: enforcement_case:23:abc...
Tenant: agency-a

T0 2026-06-20 09:10:11
- User submitted application.
- Domain state: SUBMITTED.
- Process started.

T1 2026-06-20 09:10:12
- Service task validate_application executed.
- Result: OK.

T2 2026-06-20 09:10:13
- User task review_case created.
- Candidate group: senior-officer.

T3 2026-06-20 13:22:01
- User officer-a completed review_case with decision APPROVE.
- Downstream async job send_notice created.

T4 2026-06-20 13:22:02
- Job send_notice failed due to NOTICE_SERVICE_TIMEOUT.
- Retries left: 2.

T5 2026-06-20 13:27:02
- Retry failed again.
- Retries left: 1.

T6 2026-06-20 13:32:02
- Retry failed again.
- Incident created.

Current state:
- Active incident at send_notice.
- Notice service outage confirmed.
- No notice idempotency success record found.

Recovery:
- Wait for notice service restore.
- Retry one incident.
- Confirm notice generated once.
- Bulk retry remaining similar incidents.
```

This style matters because it separates:

- facts,
- inferred cause,
- current state,
- side effect status,
- proposed recovery,
- risk.

---

## 14. Operator Action Decision Tree

Before taking action:

```text
Is this a technical failure, business alternative, or model bug?
```

Decision tree:

```text
Incident exists?
  yes -> root cause known?
      no -> investigate logs/variables/downstream first
      yes -> side effect idempotent?
          no -> check external state before retry
          yes -> retry one instance
  no -> is process waiting at user task?
      yes -> assignment/workload/SLA issue
      no -> is job due?
          yes -> executor/acquisition issue
          no -> event subscription?
              yes -> missing/correlation event issue
              no -> check completion/cancel/history
```

Operation choices:

| Action | Use when | Risk |
|---|---|---|
| retry job | transient technical issue fixed | duplicate side effect |
| set retries | failed job should be attempted again | hides root cause if abused |
| set variable | wrong/missing variable blocking execution | audit/semantic drift |
| modify process instance | process needs manual correction | bypasses model invariants |
| correlate message | event was missed but valid | duplicate/late event |
| suspend instance | freeze problematic process | SLA impact |
| delete/cancel instance | business process invalid/abandoned | orphan external/domain state |
| migrate instance | definition bug fixed in new version | compatibility risk |
| compensation/manual task | side effect already happened | requires business approval |

---

## 15. Observability Anti-Patterns

### 15.1 Only Monitoring Infrastructure

Bad:

```text
Pods healthy, CPU normal, therefore workflow healthy.
```

Reality:

- process can be stuck at incident,
- worker can be dead while engine pod healthy,
- user task SLA can breach with zero technical errors,
- message correlation can fail silently if inbound event layer discards events,
- history cleanup can lag until storage incident.

### 15.2 Treating Cockpit as Audit System

Cockpit is operational. Regulatory audit needs domain-level evidence.

### 15.3 Logging Variables Blindly

Variables can contain PII, serialized objects, documents, tokens, decision data, or sensitive evidence.

### 15.4 Alerting on Every Retry

Retry is sometimes normal. Alert on:

- retry exhaustion,
- retry storm,
- retry age,
- repeated same error cluster,
- business impact.

### 15.5 Manual DB Fixes

Manual mutation may “fix display” but corrupt engine assumptions.

### 15.6 No Idempotency Evidence

If duplicate side effect happens, logs alone may not prove whether external action succeeded. Use idempotency table/outbox/inbox.

### 15.7 No Process Version in Logs

Without process definition id/version, debugging long-running instance after deployment becomes guesswork.

### 15.8 No Tenant/Agency Context

Multi-tenant incidents without tenant labels cause overbroad recovery actions.

---

## 16. Reference Runbooks

### 16.1 Failed Job Incident Runbook

```text
Trigger:
- active incident count > 0
- failed job retries = 0

Steps:
1. Identify process definition, activity id, exception message.
2. Group incidents by same root cause.
3. Pick one representative instance.
4. Inspect variables required by failing activity.
5. Inspect delegate/worker logs with processInstanceId/jobId/businessKey.
6. Check downstream health and recent deployment changes.
7. Check idempotency/side effect status.
8. Fix root cause.
9. Retry one instance.
10. Verify process moves correctly.
11. Retry batch if safe.
12. Record operator action and incident summary.
```

### 16.2 Job Backlog Runbook

```text
Trigger:
- due job age p95 above threshold
- due job count increasing

Steps:
1. Confirm Job Executor enabled and nodes alive.
2. Count due/unlocked/locked/retry-exhausted jobs.
3. Check DB CPU/lock wait/query latency.
4. Check thread pool saturation.
5. Check downstream latency in delegates.
6. Check acquisition logs.
7. Check deployment-aware registration.
8. Scale carefully only after DB capacity verified.
9. Consider suspending noisy process if causing platform-wide impact.
10. Document root cause and tuning change.
```

### 16.3 External Task Backlog Runbook

```text
Trigger:
- external task open count by topic increasing

Steps:
1. Check worker pods/processes alive.
2. Check worker fetch-and-lock success.
3. Check topic name/version.
4. Check worker auth to REST API.
5. Check locked vs unlocked external tasks.
6. Check worker logs by topic and externalTaskId.
7. Check downstream dependency latency.
8. Check lock duration vs processing duration.
9. Scale worker if downstream and DB can handle it.
10. Reset retries only after root cause is fixed.
```

### 16.4 Message Correlation Runbook

```text
Trigger:
- inbound event not reflected in process
- correlation error rate rising

Steps:
1. Find raw inbound event in inbox/log.
2. Verify idempotency key and duplicate status.
3. Verify message name.
4. Verify business key/correlation variables.
5. Check ACT_RU_EVENT_SUBSCR.
6. Check tenant.
7. Check process instance state/history.
8. If event is early, keep/replay from inbox when subscription exists.
9. If event is late, route to exception handling/manual review.
10. Never blindly replay all events without deduplication.
```

---

## 17. Production Dashboard Blueprint

A useful Camunda 7 dashboard should have at least these panels:

### Engine Health

```text
- active process instances by definition
- active incidents by definition/activity
- due job count and age
- failed job retries distribution
- job acquisition/execution rate
- external task backlog by topic
- event subscription age by message
```

### Business Flow

```text
- cases by lifecycle state
- task backlog by queue/group
- overdue tasks
- SLA breach count
- escalations created
- average time per activity/task
- reopen/rework rate
```

### Operations

```text
- history cleanup progress
- ACT_GE_BYTEARRAY growth
- DB connection pool usage
- slow queries
- engine node count
- worker fleet status
- downstream dependency errors
```

### Security/Audit

```text
- failed authorization attempts
- privileged Cockpit/API operations
- process instance modifications
- variable changes by operator
- tenant boundary violations
```

---

## 18. Java 8–25 Considerations

The observability concepts are stable, but Java runtime changes affect implementation.

### Java 8

Constraints:

- no built-in `HttpClient`,
- weaker modern observability ecosystem,
- less convenient time/string APIs compared with later versions,
- old Spring/Camunda combinations more likely.

Use:

- SLF4J MDC,
- mature HTTP client with explicit timeout,
- JMX/Micrometer if available,
- disciplined structured logging.

### Java 11/17

Improvement:

- modern TLS/runtime support,
- better container awareness,
- better GC options,
- common baseline for enterprise upgrades.

### Java 21

Improvement:

- stronger runtime baseline,
- virtual threads available in Java platform.

Caution:

```text
Do not blindly run Camunda job executor work on virtual threads unless the whole runtime/framework/database/transaction model is validated.
Camunda 7 job executor and container integration were designed around classic thread pool assumptions.
```

Virtual threads may help application-side blocking I/O, but they do not remove:

- DB contention,
- transaction boundaries,
- job locks,
- idempotency needs,
- history write amplification.

### Java 25

Treat Java 25 as future/runtime compatibility planning for this series. Always validate:

```text
Camunda 7 minor version + Spring/EE runtime + JDBC driver + application server + database + Java version.
```

Do not assume because Java app compiles that Camunda 7 platform combination is supported.

---

## 19. Top 1% Engineering Heuristics

### Heuristic 1: A process is not stuck until you know what it is waiting for

Waiting can be correct:

- user task,
- message,
- timer,
- external task,
- failed job incident,
- suspended state.

### Heuristic 2: Retry is a state transition, not a button

Before retry, ask:

```text
What already happened externally?
```

### Heuristic 3: Logs explain attempts; history explains lifecycle; domain audit explains legality

Do not confuse them.

### Heuristic 4: Metrics need labels, but not infinite labels

Use process key/activity/topic/outcome. Avoid business key/user id/error message as metrics labels.

### Heuristic 5: SQL is for diagnosis, API is for mutation

Manual table mutation is an emergency and must be treated like surgery.

### Heuristic 6: Every wait state should be explainable to an operator

If no one can explain why process waits, model is not operationally mature.

### Heuristic 7: Every side effect must have idempotency evidence

Without it, incident recovery becomes guesswork.

### Heuristic 8: Cockpit is powerful; power needs governance

Privileged operations must be audited and access-controlled.

---

## 20. Checklist: Camunda 7 Observability Readiness

### Engine

- [ ] Job Executor metrics monitored.
- [ ] Due job backlog alert exists.
- [ ] Incident count/age alert exists.
- [ ] Failed job retry distribution visible.
- [ ] External task backlog visible.
- [ ] Event subscription age visible.
- [ ] History cleanup monitored.

### Logs

- [ ] Logs are structured.
- [ ] Correlation id propagated.
- [ ] Business key logged where safe.
- [ ] Process instance id logged internally.
- [ ] Activity id/task id/job id/external task id logged when available.
- [ ] Tenant id logged for multi-tenant system.
- [ ] PII/secrets are masked.

### Business

- [ ] Work queue dashboard exists.
- [ ] SLA breach dashboard exists.
- [ ] Case lifecycle state dashboard exists.
- [ ] Escalation metric exists.
- [ ] Operator action audit exists.

### Recovery

- [ ] Failed job runbook exists.
- [ ] External task runbook exists.
- [ ] Message correlation runbook exists.
- [ ] Timer runbook exists.
- [ ] Optimistic locking runbook exists.
- [ ] Process modification governance exists.
- [ ] Idempotency evidence exists for side effects.

### Security

- [ ] Cockpit/Admin access restricted.
- [ ] REST API secured.
- [ ] Privileged operations audited.
- [ ] Variable inspection controlled.
- [ ] Tenant-aware dashboards and operations exist.

---

## 21. Mini Case Study: Stuck Enforcement Notice

Scenario:

```text
A regulatory case is approved, but the enforcement notice is not sent.
User sees case status: Approved.
Applicant has not received notice.
```

Naive conclusion:

```text
Camunda failed.
Click retry.
```

Better investigation:

1. Find business key in `ACT_HI_PROCINST`.
2. Check active runtime: process is at `send_notice` async service task.
3. Check `ACT_RU_JOB`: retries 0, incident exists.
4. Check exception: `SocketTimeoutException` from notice service.
5. Check idempotency table: no `noticeId` created.
6. Check notice service dashboard: outage from 13:20–13:40.
7. Retry one instance after service recovery.
8. Confirm notice created once.
9. Bulk retry incidents with same root cause.
10. Record incident RCA and action.

Correct conclusion:

```text
Process state is recoverable at async job boundary.
No external side effect success recorded.
Root cause was downstream notice service timeout.
Retry is safe after service recovery.
```

If idempotency table showed notice already sent, recovery would be different:

```text
Do not retry blindly.
Manually correlate/advance or mark as sent based on verified notice id, with audit approval.
```

---

## 22. What This Part Prepared You For

This part builds the operational lens needed for the rest of the series.

You should now be able to reason about:

- why process observability is not just logs,
- why Camunda DB diagnostics are powerful but dangerous,
- why retry needs idempotency evidence,
- why Cockpit must be governed,
- why business SLA dashboard is different from engine health dashboard,
- why stuck workflow investigation starts by identifying what the engine is waiting for,
- why incident recovery is a controlled state transition.

The next part, `part-028`, will focus on **Testing Strategy**: unit tests, process scenario tests, integration tests, migration tests, contract tests, timer tests, external task tests, failure injection, and CI/CD strategy for Camunda 7 process applications.

---

## 23. References

- Camunda 7.24 Manual — Job Executor: https://docs.camunda.org/manual/7.24/user-guide/process-engine/the-job-executor/
- Camunda 7.24 Manual — Error Handling: https://docs.camunda.org/manual/7.24/user-guide/process-engine/error-handling/
- Camunda 7.24 Manual — Transactions in Processes: https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/
- Camunda 7.24 Manual — History: https://docs.camunda.org/manual/7.24/user-guide/process-engine/history/
- Camunda 7.24 Manual — History Cleanup: https://docs.camunda.org/manual/7.24/user-guide/process-engine/history/history-cleanup/
- Camunda 7.24 Manual — Database Schema: https://docs.camunda.org/manual/7.24/user-guide/process-engine/database/database-schema/
- Camunda 7.24 REST API: https://docs.camunda.org/rest/camunda-bpm-platform/7.24/
- Camunda Docs — Operating Camunda 7: https://docs.camunda.io/docs/8.7/components/best-practices/operations/operating-camunda-c7/
- Camunda Blog — The Job Executor: What Is Going on in My Process Engine?: https://camunda.com/blog/2019/10/job-executor-what-is-going-on-in-my-process-engine/

---

## Status Seri

- Part ini: `part-027` selesai.
- Seri belum selesai.
- Lanjut ke: `learn-java-camunda-7-bpm-platform-engineering-part-028.md`.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-026.md">⬅️ Part 026 — Database Operations: Indexing, Cleanup, Archival, Partitioning, Vacuum/Shrink, and Maintenance Windows</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-028.md">Part 028 — Testing Strategy: Unit, Process Scenario, Integration, Contract, Migration, and Chaos Testing ➡️</a>
</div>

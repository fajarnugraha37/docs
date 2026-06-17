# Part 15 — Observability for Managed Async Workloads

**Series:** `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
**File:** `15-observability-for-managed-async-workloads.md`  
**Scope:** Java 8–25, Java EE/Jakarta EE managed concurrency, Jakarta Concurrency, Jakarta Batch, MicroProfile-style telemetry, JVM/JFR/thread-dump diagnostics, production operations  
**Baseline:** Jakarta EE 11, Jakarta Concurrency 3.1, Jakarta Batch 2.1, Java 21+ virtual threads, Java 25 observability context

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Mendesain observability untuk async workload, bukan hanya synchronous REST request.
2. Membedakan **technical log**, **business audit**, **metrics**, **trace**, **profile**, dan **runtime diagnostic**.
3. Membangun mental model observability untuk:
   - `ManagedExecutorService`
   - `ManagedScheduledExecutorService`
   - `ContextService`
   - `CompletableFuture`
   - virtual threads
   - Jakarta Batch
   - background worker
   - fan-out/fan-in task
   - external API integration
4. Menentukan correlation strategy yang benar untuk request → async task → batch job → downstream call.
5. Mencegah hilangnya MDC/log context ketika task berpindah thread.
6. Mendesain metrics untuk queue, active task, latency, timeout, retry, cancellation, rejection, backlog, dan stuck task.
7. Menggunakan thread dump, JFR, JMX, dan runtime telemetry untuk mendiagnosis async failure.
8. Mendesain dashboard dan alert yang benar-benar actionable.
9. Memisahkan audit trail yang defensible dari log teknis yang noisy.
10. Menyusun production checklist agar async workload tidak menjadi “black box”.

---

## 2. Problem yang Diselesaikan

Pada synchronous request biasa, observability relatif mudah:

```text
HTTP request masuk
  -> controller/resource
  -> service
  -> repository
  -> response keluar
```

Log, metrics, dan trace biasanya mengikuti satu thread request atau satu logical request span.

Async workload berbeda:

```text
HTTP request masuk
  -> validasi
  -> submit task ke executor
  -> response 202 Accepted

Beberapa detik/menit kemudian:
  -> task berjalan di managed thread lain
  -> mungkin membuat transaction baru
  -> mungkin memanggil API eksternal
  -> mungkin retry
  -> mungkin gagal sebagian
  -> mungkin di-cancel
  -> mungkin berjalan setelah user logout
```

Tanpa observability yang benar, operator hanya melihat:

```text
User: Saya sudah submit, statusnya tidak berubah.
Developer: Di log tidak kelihatan error.
DBA: Ada query berat jam 02:13.
Infra: CPU naik, tapi pod tidak restart.
QA: Kadang berhasil, kadang timeout.
```

Masalah sebenarnya bisa saja:

- task masih antre di executor
- executor saturated
- queue terlalu panjang
- task rejected tapi error tidak dilog
- `CompletableFuture` gagal tapi exception tidak di-observe
- MDC hilang setelah async boundary
- trace terputus
- retry storm ke downstream
- DB pool exhausted
- partition batch tidak balance
- satu item poison menyebabkan job restart berkali-kali
- virtual thread banyak tetapi bottleneck sebenarnya connection pool
- scheduled job berjalan di semua node cluster
- cancellation signal diterima tetapi task tidak cooperative
- task masih berjalan setelah deployment mulai shutdown

Bagian ini membahas cara membuat semua itu terlihat.

---

## 3. Mental Model: Observability Bukan Logging

### 3.1 Logging hanya satu dimensi

Logging menjawab:

```text
Apa yang terjadi menurut kode aplikasi?
```

Metrics menjawab:

```text
Seberapa sering, seberapa lama, dan seberapa parah?
```

Tracing menjawab:

```text
Aliran eksekusi logical request/task melewati komponen apa saja?
```

Audit menjawab:

```text
Siapa melakukan apa, atas dasar apa, kapan, terhadap objek bisnis mana, dan hasilnya apa?
```

Profiling/JFR menjawab:

```text
Apa yang dilakukan JVM/runtime secara detail saat sistem lambat atau stuck?
```

Thread dump menjawab:

```text
Thread sedang berada di mana sekarang?
```

Health check menjawab:

```text
Apakah instance ini pantas menerima traffic atau masih hidup?
```

Control plane menjawab:

```text
Task/job mana yang running, queued, failed, stopped, retrying, atau perlu operator action?
```

Untuk async workload, semua layer ini harus saling melengkapi.

---

## 4. Observability Taxonomy untuk Async Workload

Gunakan taxonomy berikut:

| Layer | Pertanyaan | Contoh Data |
|---|---|---|
| Log | Apa event teknis yang terjadi? | task started, task failed, retry scheduled |
| Metric | Berapa banyak dan seberapa lama? | queue depth, active tasks, p95 duration |
| Trace | Alur eksekusi melintasi service apa? | request span → async span → HTTP client span |
| Audit | Apa dampak bisnis dan siapa aktornya? | initiatedBy, entityId, old/new status |
| Profile | Kenapa CPU/memory/lock tinggi? | JFR event, allocation hotspot |
| Runtime dump | Thread/lock sedang stuck di mana? | thread dump, virtual thread dump |
| Control plane | Apa status workload sekarang? | job execution table, task state table |
| Alert | Kapan perlu tindakan manusia? | stuck > SLA, rejection > 0, backlog growing |

Kesalahan umum engineer menengah adalah mencoba menjawab semuanya dengan log. Engineer senior membedakan tiap pertanyaan dan memakai sinyal yang tepat.

---

## 5. Core Principle: Async Work Must Have a Stable Identity

Task asynchronous harus punya identitas stabil.

Minimal identity:

```text
taskId
correlationId
requestId / traceId
submittedAt
submittedBy / initiatedBy
workloadType
businessKey
status
attempt
```

Untuk Jakarta Batch:

```text
jobName
jobInstanceId
jobExecutionId
stepExecutionId
partitionId
checkpointPosition
batchStatus
exitStatus
```

Tanpa identity stabil, tidak mungkin menjawab:

- task ini berasal dari request mana?
- user mana yang memulai?
- entity bisnis mana yang terdampak?
- task sudah pernah dicoba berapa kali?
- error ini dari attempt ke berapa?
- job execution ini restart dari execution mana?
- partition ini memproses range apa?
- apakah kegagalan ini duplicate atau unique?

### 5.1 Identity tidak boleh hanya bergantung pada thread name

Thread name berguna, tetapi tidak cukup.

```text
managed-executor-thread-17
```

Nama itu tidak menjawab:

- task apa yang berjalan?
- siapa yang submit?
- case/application mana yang diproses?
- correlation ID apa?
- attempt ke berapa?

Thread adalah execution vehicle. Task adalah logical work. Observability harus mengikuti logical work, bukan hanya thread.

---

## 6. Correlation ID, Trace ID, Request ID, Task ID: Jangan Dicampur

Banyak sistem menyamakan semua ID ini menjadi satu. Itu kadang cukup untuk sistem kecil, tetapi tidak cukup untuk enterprise async workload.

### 6.1 Request ID

`requestId` biasanya merepresentasikan satu HTTP request masuk.

```text
requestId = req-20260617-000123
```

Cocok untuk:

- debug request-response
- access log
- API gateway log
- WAF log

Tidak cukup untuk async workload karena request sudah selesai sebelum task selesai.

### 6.2 Trace ID

`traceId` merepresentasikan distributed trace logical operation.

```text
traceId = 4bf92f3577b34da6a3ce929d0e0e4736
```

Cocok untuk:

- service-to-service tracing
- span relationship
- latency breakdown
- OpenTelemetry-style propagation

### 6.3 Correlation ID

`correlationId` adalah business/operational correlation yang kamu kontrol.

```text
correlationId = corr-case-escalation-20260617-000044
```

Cocok untuk:

- menghubungkan request, async task, email, batch job, audit record
- debugging lintas sistem yang belum semuanya mendukung tracing
- log search manusia

### 6.4 Task ID

`taskId` adalah identity untuk satu unit async work.

```text
taskId = task-01JY0B2C9KX8BQZ7R9W1ZP3KQE
```

Cocok untuk:

- status task
- retry attempt
- cancellation
- admin UI
- deduplication

### 6.5 Job Execution ID

Untuk Jakarta Batch, job repository punya identity sendiri.

```text
jobName = NightlyCaseAgeingJob
jobExecutionId = 78231
stepExecutionId = 78232
```

Cocok untuk:

- restart
- query execution
- step-level status
- batch administration

### 6.6 Recommended mapping

```text
HTTP Request
  requestId     = per inbound HTTP request
  traceId       = distributed tracing context
  correlationId = business operation correlation

Async Task
  taskId        = durable async unit
  traceId       = continued or linked trace
  correlationId = same business operation correlation

Batch Job
  jobExecutionId = Jakarta Batch runtime identity
  correlationId  = business operation correlation / submitted request correlation
  taskId          = optional wrapper if launched from async task/request table
```

Rule:

```text
requestId may end early.
correlationId must survive.
taskId must identify executable work.
jobExecutionId must identify batch runtime execution.
traceId should connect spans where tracing is available.
```

---

## 7. MDC and Async Boundary

MDC atau mapped diagnostic context sering dipakai agar setiap log otomatis punya field seperti:

```text
correlationId=...
userId=...
taskId=...
jobExecutionId=...
```

Masalahnya: MDC biasanya berbasis `ThreadLocal`.

Pada synchronous request:

```text
request thread sets MDC
service logs use MDC
request completes
filter clears MDC
```

Pada async task:

```text
request thread sets MDC
submit task to executor
request thread clears MDC
task runs on different thread
MDC may be missing
```

Atau lebih buruk:

```text
task thread previously used by another task
old MDC not cleared
task logs wrong user/correlationId
```

Ini fatal secara audit/debugging.

### 7.1 Prinsip MDC untuk async work

Setiap task harus:

1. Capture context yang boleh dibawa.
2. Set MDC saat task mulai.
3. Clear/restore MDC saat task selesai.
4. Tidak mengandalkan leftover thread context.
5. Tidak membawa data sensitif berlebihan.

### 7.2 Contoh wrapper sederhana

```java
public final class ObservedTask implements Runnable {
    private final Runnable delegate;
    private final Map<String, String> mdc;

    public ObservedTask(Runnable delegate, Map<String, String> mdc) {
        this.delegate = Objects.requireNonNull(delegate);
        this.mdc = Map.copyOf(mdc);
    }

    @Override
    public void run() {
        Map<String, String> previous = MDC.getCopyOfContextMap();
        try {
            MDC.setContextMap(mdc);
            delegate.run();
        } finally {
            if (previous == null) {
                MDC.clear();
            } else {
                MDC.setContextMap(previous);
            }
        }
    }
}
```

Catatan:

- Contoh ini memakai MDC SLF4J/logback-style secara konseptual.
- Dalam Jakarta EE, context container seperti security/classloader/naming sebaiknya tetap ditangani oleh managed executor/context service.
- MDC adalah application diagnostic context, bukan pengganti Jakarta `ContextService`.

### 7.3 Jangan propagasi semua MDC secara membabi buta

Tidak semua field request pantas dibawa ke async task.

Hindari membawa:

- access token
- session ID mentah
- cookie
- raw Authorization header
- PII lengkap
- payload besar
- mutable object reference

Bawa field yang memang dibutuhkan:

```text
correlationId
traceId
taskId
jobExecutionId
initiatedBy
businessKey
workloadType
attempt
```

---

## 8. Structured Logging untuk Async Work

Async logs harus machine-queryable.

Buruk:

```text
Processing started
Something failed
Done
```

Lebih baik:

```json
{
  "event": "async_task_started",
  "taskId": "task-01JY0B2C9KX8BQZ7R9W1ZP3KQE",
  "correlationId": "corr-case-escalation-20260617-000044",
  "workloadType": "CASE_ESCALATION_EVALUATION",
  "businessKey": "CASE-2026-000981",
  "attempt": 1,
  "submittedBy": "user-12345",
  "executor": "case-work-executor",
  "thread": "managed-exec-14"
}
```

### 8.1 Event taxonomy

Gunakan event name yang stabil:

```text
async_task_submitted
async_task_accepted
async_task_rejected
async_task_started
async_task_completed
async_task_failed
async_task_cancel_requested
async_task_cancelled
async_task_timeout
async_task_retry_scheduled
async_task_retry_exhausted
async_task_dead_lettered
```

Untuk scheduled workload:

```text
scheduled_trigger_fired
scheduled_trigger_skipped_overlap
scheduled_trigger_lock_acquired
scheduled_trigger_lock_failed
scheduled_execution_started
scheduled_execution_completed
scheduled_execution_failed
```

Untuk batch:

```text
batch_job_started
batch_job_completed
batch_job_failed
batch_job_stopped
batch_step_started
batch_step_completed
batch_chunk_committed
batch_item_skipped
batch_item_retried
batch_partition_started
batch_partition_completed
checkpoint_saved
```

### 8.2 Log levels

| Event | Level | Catatan |
|---|---:|---|
| task submitted | INFO/DEBUG | INFO jika penting secara operasional |
| task started/completed | INFO/DEBUG | INFO untuk critical workload, DEBUG untuk high-volume |
| retry scheduled | WARN | Jika retry menunjukkan downstream/temporary failure |
| rejection | WARN/ERROR | ERROR jika user-visible atau data loss risk |
| timeout | WARN/ERROR | Bergantung SLA |
| permanent failure | ERROR | Harus actionable |
| cancellation requested | INFO | Bukan error |
| cancellation ignored | WARN | Risky |
| stuck detected | ERROR | Butuh operator action |

### 8.3 Jangan log payload besar

Async workload sering memproses data besar. Jangan log:

- full file content
- full JSON payload
- full XML payload
- full CLOB/BLOB
- access token
- secret
- PII mentah

Log metadata:

```text
fileName
fileSize
checksum
recordCount
entityId
schemaVersion
payloadHash
```

---

## 9. Metrics: Sinyal yang Harus Ada

Metrics harus menjawab health workload secara kuantitatif.

### 9.1 Executor metrics

Minimal:

```text
executor_active_tasks
executor_pool_size
executor_queue_depth
executor_queue_capacity
executor_completed_tasks_total
executor_rejected_tasks_total
executor_task_duration_seconds
executor_task_wait_time_seconds
executor_task_timeout_total
executor_task_cancelled_total
executor_task_failed_total
```

Yang sering dilupakan:

```text
executor_task_wait_time_seconds
```

Task duration hanya mengukur waktu running. Tetapi user sering menunggu karena task antre.

```text
total latency = queue wait time + execution time + retry delay + downstream latency
```

### 9.2 Queue wait time

Saat submit:

```java
Instant submittedAt = Instant.now();
```

Saat run mulai:

```java
Duration waitTime = Duration.between(submittedAt, Instant.now());
```

Metric:

```text
async_task_wait_seconds{workloadType="CASE_ESCALATION"}
```

Jika wait time naik tetapi execution time stabil, masalahnya capacity/admission/queue.

Jika execution time naik tetapi wait time stabil, masalahnya processing/downstream.

Jika keduanya naik, sistem sudah overload.

### 9.3 Workload metrics

Gunakan label/dimension yang aman:

```text
workloadType
executorName
result
exceptionClass
attempt
priority
module
```

Hati-hati cardinality tinggi.

Jangan jadikan `taskId`, `userId`, `caseId`, atau `fileName` sebagai metric label di Prometheus-style systems. Itu bisa menghancurkan time-series cardinality.

Gunakan `taskId` di log/trace, bukan metric label.

### 9.4 Retry metrics

```text
async_retry_attempts_total{workloadType, exceptionClass}
async_retry_exhausted_total{workloadType}
async_retry_delay_seconds{workloadType}
```

Interpretasi:

- retry naik sedikit: normal transient failure
- retry naik tajam: downstream degrade
- retry exhausted naik: permanent incident/data issue
- retry delay terlalu rendah: retry storm risk

### 9.5 Rejection metrics

```text
async_task_rejected_total{workloadType, reason}
```

Reason examples:

```text
queue_full
bulkhead_full
rate_limit_exceeded
shutdown_in_progress
duplicate_task
invalid_state
```

Rejection bukan selalu buruk. Dalam system design yang sehat, rejection bisa menjadi bentuk backpressure.

Yang buruk adalah rejection tanpa visibility.

### 9.6 Cancellation metrics

```text
async_task_cancel_requested_total
async_task_cancelled_total
async_task_cancel_ignored_total
async_task_cancel_latency_seconds
```

`cancel latency` adalah waktu dari cancel request sampai task benar-benar berhenti.

Jika cancel latency tinggi:

- task tidak check interruption/cancel flag
- blocking call tidak punya timeout
- DB query tidak bisa dihentikan cepat
- external API call menggantung
- chunk size terlalu besar

### 9.7 Batch metrics

Untuk Jakarta Batch:

```text
batch_job_execution_total{jobName, status}
batch_job_duration_seconds{jobName}
batch_step_duration_seconds{jobName, stepName}
batch_step_read_count_total{jobName, stepName}
batch_step_write_count_total{jobName, stepName}
batch_step_skip_count_total{jobName, stepName, phase}
batch_step_retry_count_total{jobName, stepName}
batch_checkpoint_total{jobName, stepName}
batch_partition_duration_seconds{jobName, stepName, partitionId?}
batch_partition_failed_total{jobName, stepName}
```

Untuk metric label, `partitionId` bisa high-cardinality jika sangat banyak. Gunakan hati-hati.

Lebih aman:

```text
partitionBucket
partitionStrategy
```

### 9.8 External dependency metrics

Async workload sering gagal karena downstream.

Minimal:

```text
external_call_duration_seconds{system, operation, result}
external_call_total{system, operation, statusClass}
external_call_timeout_total{system, operation}
external_call_rate_limited_total{system, operation}
external_call_circuit_open_total{system}
```

Untuk API rate limit:

```text
external_rate_limit_tokens_available
external_rate_limit_wait_seconds
external_429_total
```

### 9.9 DB pool pressure metrics

Virtual threads dan async fan-out sering membuat aplikasi terlihat scalable padahal DB pool menjadi bottleneck.

Pantau:

```text
db_pool_active_connections
db_pool_idle_connections
db_pool_pending_threads
db_connection_acquire_seconds
db_query_duration_seconds
db_transaction_duration_seconds
db_deadlock_total
db_lock_wait_seconds
```

Jika `db_connection_acquire_seconds` naik, menambah executor thread biasanya memperparah masalah.

---

## 10. Trace: Async Boundary Harus Terlihat

Distributed tracing mudah pada synchronous call, tetapi async boundary sering memutus trace.

### 10.1 Trace structure ideal

```text
HTTP POST /case/{id}/evaluate-escalation
  span: validate request
  span: create job request
  span: submit async task

Async Task: case escalation evaluation
  span: load case
  span: evaluate rules
  span: update escalation state
  span: publish outbox event

External Worker / Email Dispatcher
  span: consume outbox
  span: call email service
```

Ada dua cara utama menghubungkan trace async:

1. **Continue trace**: async task menjadi child dari request span.
2. **Link trace**: async task punya trace baru tetapi linked ke request span.

Untuk task yang berjalan lama setelah request selesai, link sering lebih realistis.

### 10.2 Span attributes

Contoh attributes:

```text
async.task.id
a async.task.type
async.task.attempt
async.task.submitted_at
async.task.started_at
async.task.wait_ms
async.executor.name
business.entity.type
business.entity.id
batch.job.name
batch.job.execution_id
batch.step.name
```

Hindari PII.

### 10.3 Trace vs audit

Trace bukan audit.

Trace bagus untuk latency dan dependency flow.

Audit bagus untuk defensibility:

```text
User A requested escalation evaluation for Case X at time T.
System evaluated rules version R.
Outcome changed from PendingReview to Escalated.
Reason codes: overdue_days>30, high_risk_flag=true.
```

Trace bisa disampling. Audit tidak boleh hilang karena sampling.

---

## 11. `CompletableFuture` Observability

`CompletableFuture` punya failure mode observability khusus.

### 11.1 Exception bisa diam

Contoh buruk:

```java
CompletableFuture.runAsync(() -> {
    doWork();
}, managedExecutor);
```

Jika future tidak pernah di-observe, exception bisa tidak terlihat dengan jelas oleh caller.

Lebih baik:

```java
CompletableFuture<Void> future = CompletableFuture
    .runAsync(observedRunnable(taskContext, () -> doWork()), managedExecutor)
    .whenComplete((result, error) -> {
        if (error != null) {
            taskMetrics.failed(taskContext, error);
            taskLogger.failed(taskContext, error);
        } else {
            taskMetrics.completed(taskContext);
            taskLogger.completed(taskContext);
        }
    });
```

### 11.2 Setiap stage penting harus terlihat

```java
CompletableFuture<CaseData> load = supplyObserved("load-case", () -> loadCase(caseId));
CompletableFuture<RulesResult> eval = load.thenApplyAsync(
    observedFn("evaluate-rules", data -> evaluate(data)),
    managedExecutor
);
CompletableFuture<Void> save = eval.thenAcceptAsync(
    observedConsumer("save-result", result -> saveResult(result)),
    managedExecutor
);
```

Jika hanya total duration yang terlihat, kamu tidak tahu bottleneck di load, evaluate, atau save.

### 11.3 Fan-out/fan-in metrics

Untuk fan-out:

```text
fanout_started_total
fanout_branch_total
fanout_branch_failed_total
fanout_branch_duration_seconds
fanout_join_duration_seconds
fanout_cancelled_branches_total
```

Pertanyaan penting:

- berapa branch dibuat?
- branch mana lambat?
- apakah semua branch wajib sukses?
- apakah failure satu branch membatalkan branch lain?
- apakah join timeout terjadi?

### 11.4 Timeout tidak sama dengan stop

`orTimeout` membuat future selesai secara exceptional jika timeout, tetapi underlying task belum tentu berhenti.

Maka observability harus membedakan:

```text
future_timeout
underlying_task_stopped
underlying_task_still_running
```

---

## 12. Jakarta Concurrency Observability Pattern

### 12.1 Task envelope

Buat envelope untuk semua async task.

```java
public record AsyncTaskContext(
    String taskId,
    String correlationId,
    String traceId,
    String workloadType,
    String businessKey,
    String initiatedBy,
    int attempt,
    Instant submittedAt
) {}
```

Wrapper:

```java
public final class ObservedCallable<T> implements Callable<T> {
    private final AsyncTaskContext context;
    private final Callable<T> delegate;
    private final AsyncMetrics metrics;
    private final AsyncAudit audit;

    public ObservedCallable(
        AsyncTaskContext context,
        Callable<T> delegate,
        AsyncMetrics metrics,
        AsyncAudit audit
    ) {
        this.context = context;
        this.delegate = delegate;
        this.metrics = metrics;
        this.audit = audit;
    }

    @Override
    public T call() throws Exception {
        Instant startedAt = Instant.now();
        Duration wait = Duration.between(context.submittedAt(), startedAt);

        Map<String, String> previous = MDC.getCopyOfContextMap();
        try {
            MDC.put("taskId", context.taskId());
            MDC.put("correlationId", context.correlationId());
            MDC.put("workloadType", context.workloadType());
            MDC.put("businessKey", context.businessKey());
            MDC.put("attempt", Integer.toString(context.attempt()));

            metrics.taskStarted(context, wait);
            audit.taskStarted(context, startedAt);

            T result = delegate.call();

            metrics.taskCompleted(context, Duration.between(startedAt, Instant.now()));
            audit.taskCompleted(context, Instant.now());

            return result;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            metrics.taskInterrupted(context);
            audit.taskInterrupted(context, Instant.now());
            throw e;
        } catch (Exception e) {
            metrics.taskFailed(context, e);
            audit.taskFailed(context, e, Instant.now());
            throw e;
        } finally {
            if (previous == null) {
                MDC.clear();
            } else {
                MDC.setContextMap(previous);
            }
        }
    }
}
```

### 12.2 Submit path harus observable

Bukan hanya running task.

```java
public <T> Future<T> submitObserved(
    AsyncTaskContext context,
    Callable<T> work
) {
    try {
        metrics.taskSubmitted(context);
        audit.taskSubmitted(context, Instant.now());

        return managedExecutor.submit(
            new ObservedCallable<>(context, work, metrics, audit)
        );
    } catch (RejectedExecutionException e) {
        metrics.taskRejected(context, "executor_rejected");
        audit.taskRejected(context, "executor_rejected", Instant.now());
        throw e;
    }
}
```

Jika submit path tidak observable, kamu tidak tahu apakah task gagal sebelum masuk executor.

---

## 13. Jakarta Batch Observability Pattern

Jakarta Batch sudah punya job repository, tetapi job repository bukan observability lengkap.

Ia memberi status runtime, tetapi kamu tetap butuh:

- metrics
- structured logs
- business audit
- trace untuk external call
- dashboard
- operator actions

### 13.1 Job-level observability

Pada job start:

```text
jobName
jobExecutionId
jobInstanceId
correlationId
submittedBy
parametersHash
inputManifest
startedAt
```

Pada job end:

```text
batchStatus
exitStatus
duration
readCount
writeCount
skipCount
retryCount
failureSummary
outputManifest
```

### 13.2 Step-level observability

```text
jobExecutionId
stepExecutionId
stepName
readCount
processSkipCount
writeSkipCount
rollbackCount
commitCount
checkpointCount
duration
```

### 13.3 Item-level observability

Jangan log semua item sukses jika volume besar.

Log/audit item-level untuk:

- skipped item
- failed item
- retried item after threshold
- suspicious business outcome
- manually corrected item
- compliance-relevant decision

Contoh skipped record:

```json
{
  "event": "batch_item_skipped",
  "jobName": "ExternalRegistrySyncJob",
  "jobExecutionId": 78231,
  "stepName": "syncRegistryRecords",
  "recordKey": "REG-2026-00077",
  "phase": "process",
  "exceptionClass": "InvalidRegistryStatusException",
  "reasonCode": "UNKNOWN_STATUS",
  "correlationId": "corr-registry-sync-20260617"
}
```

### 13.4 Checkpoint observability

Checkpoint adalah inti restartability. Maka checkpoint harus terlihat.

```text
checkpoint_saved_total{jobName, stepName}
checkpoint_position{jobName, stepName}
checkpoint_duration_seconds{jobName, stepName}
```

Structured log:

```json
{
  "event": "checkpoint_saved",
  "jobExecutionId": 78231,
  "stepName": "readCases",
  "position": "caseId>CASE-2026-000900",
  "readCount": 5000,
  "writeCount": 4987
}
```

### 13.5 Partition observability

Partitioning tanpa observability = chaos.

Pantau:

```text
partition_count
partition_started_total
partition_completed_total
partition_failed_total
partition_duration_seconds
partition_item_count
partition_skew_ratio
```

`partition_skew_ratio` dapat dihitung:

```text
max(partition_duration) / median(partition_duration)
```

Jika skew tinggi, partitioning strategy buruk.

Contoh:

```text
Partition A: 2 minutes
Partition B: 3 minutes
Partition C: 45 minutes
Partition D: 2 minutes
```

Problem bukan jumlah thread. Problem adalah distribusi workload.

---

## 14. Thread Dump Diagnostics

Thread dump masih penting, bahkan di era virtual threads.

### 14.1 Apa yang dicari di thread dump

Untuk platform threads:

- banyak thread `RUNNABLE` di CPU-bound code
- banyak thread `WAITING` pada queue
- banyak thread `BLOCKED` pada monitor lock
- thread menunggu DB connection pool
- thread stuck di socket read
- deadlock
- pool worker semua menjalankan workload yang sama
- scheduled executor thread stuck terlalu lama

### 14.2 Thread name matters

Beri nama executor/workload jika platform mendukung.

Contoh nama berguna:

```text
case-eval-executor-7
registry-sync-executor-3
batch-partition-worker-12
email-outbox-worker-2
```

Nama buruk:

```text
pool-1-thread-1
Thread-17
```

Dalam Jakarta EE, thread name kadang dikontrol container. Jika tidak bisa mengubah thread name, pastikan MDC/log/metrics punya `executorName` dan `workloadType`.

### 14.3 Reading blocked threads

Contoh thread dump symptom:

```text
"case-eval-executor-7" BLOCKED on com.example.RuleCache
"case-eval-executor-8" BLOCKED on com.example.RuleCache
"case-eval-executor-9" BLOCKED on com.example.RuleCache
```

Kemungkinan:

- shared synchronized cache bottleneck
- lazy initialization under lock
- global lock around remote call
- rules engine not thread-safe

### 14.4 Threads waiting for DB connection

Symptom:

```text
at com.zaxxer.hikari.pool.HikariPool.getConnection(...)
```

Interpretasi:

- executor concurrency > DB pool capacity
- transaction terlalu lama
- connection leak
- downstream DB slow
- batch commit interval terlalu besar

Solusi bukan langsung tambah thread. Biasanya:

- batasi executor concurrency
- kurangi partition count
- tune query
- perbaiki transaction scope
- naikkan pool hanya jika DB sanggup

---

## 15. JFR untuk Async dan Virtual Threads

JDK Flight Recorder adalah observability/profiling framework built-in di HotSpot JVM dengan overhead rendah dan event runtime yang kaya. Pada Java modern, JFR sangat berguna untuk memahami CPU, allocation, lock, socket, file I/O, GC, dan virtual thread behavior.

### 15.1 Kapan memakai JFR

Gunakan JFR ketika:

- CPU tinggi tapi log tidak menjelaskan
- latency naik tanpa error
- virtual threads banyak tetapi throughput tidak naik
- GC pause/allocation tinggi
- lock contention dicurigai
- DB/API call lambat tapi perlu bukti runtime
- thread dump terlalu statis
- ingin melihat event timeline

### 15.2 JFR events yang relevan

Kategori penting:

```text
Execution samples
Allocation events
Monitor blocked / monitor enter
Thread sleep / park
Socket read/write
File read/write
GC events
Exception events
Virtual thread start/end/pinned/submission/failure events where available
```

Oracle JDK 25 documentation menyebut JFR dapat mengeluarkan event terkait virtual threads seperti `jdk.VirtualThreadStart` dan `jdk.VirtualThreadEnd`; event-event semacam ini membantu mengamati lifecycle virtual thread ketika workload sudah memakai Java 21+. JEP 444 juga menekankan virtual threads sebagai lightweight threads yang tetap bisa diamati, bukan sekadar abstraksi tersembunyi.

### 15.3 JFR command examples

Start recording:

```bash
jcmd <pid> JFR.start name=async-profile settings=profile duration=120s filename=/tmp/async-profile.jfr
```

Check recording:

```bash
jcmd <pid> JFR.check
```

Dump recording:

```bash
jcmd <pid> JFR.dump name=async-profile filename=/tmp/async-profile.jfr
```

Stop recording:

```bash
jcmd <pid> JFR.stop name=async-profile
```

### 15.4 What to look for

#### CPU-bound async task

Symptoms:

```text
High CPU samples in rule evaluation / serialization / encryption / regex / XML parsing
Executor active tasks high
Queue wait increasing
DB normal
```

Action:

- reduce concurrency if CPU saturated
- optimize hotspot
- split workload
- avoid unbounded parallelism

#### Blocking I/O bottleneck

Symptoms:

```text
Many socket read events
External call duration high
Executor active high
CPU moderate/low
```

Action:

- add timeout
- rate limit
- bulkhead per downstream
- circuit breaker
- async external job queue

#### Lock contention

Symptoms:

```text
Monitor blocked events
Threads blocked on same class/object
Low CPU but high latency
```

Action:

- remove global lock
- use immutable snapshot
- shard lock
- use concurrent structures
- avoid remote call inside synchronized block

#### Allocation pressure

Symptoms:

```text
High allocation in JSON/XML mapping
GC frequent
Batch step memory increasing
```

Action:

- stream instead of load all
- reuse buffers carefully
- reduce object churn
- chunk size tuning
- avoid collecting all futures/results in memory

---

## 16. Health Check vs Readiness vs Workload Health

Health checks are often misused.

### 16.1 Liveness

Liveness answers:

```text
Should this process be restarted?
```

Do not fail liveness merely because one batch job failed.

### 16.2 Readiness

Readiness answers:

```text
Should this instance receive traffic?
```

Readiness may fail if:

- DB unavailable
- required downstream unavailable and no degradation possible
- executor critical queue completely saturated
- app is shutting down

### 16.3 Workload health

Workload health answers:

```text
Is this async/batch subsystem healthy?
```

Examples:

```text
case-eval queue depth = 12000
oldest task age = 90 minutes
rejection rate = 15/min
batch failure rate = 60%
registry sync lag = 4 hours
```

This should feed dashboard and alerting, but not always readiness/liveness.

### 16.4 Kubernetes concern

If readiness fails because batch queue is full, Kubernetes may remove pods from service. That may help request traffic, but may also reduce processing capacity depending on architecture.

Do not blindly tie workload saturation to pod restart.

Restarting an overloaded pod usually does not fix overload. It may lose in-memory queue and make things worse.

---

## 17. Dashboard Design

### 17.1 Executor dashboard

Panels:

```text
Active tasks by executor
Queue depth by executor
Oldest queued task age
Task wait time p50/p95/p99
Task execution duration p50/p95/p99
Task result rate: success/failure/cancel/reject/timeout
Retry rate
Rejection reason
DB connection acquire latency
Downstream latency per system
```

Interpretation matrix:

| Symptom | Likely Cause |
|---|---|
| queue depth high, active at max | capacity saturated |
| active low, queue high | stuck scheduler/dispatcher or broken executor config |
| wait high, duration normal | underprovisioned executor/admission issue |
| duration high, wait normal | downstream or processing slow |
| rejection high, queue full | overload/backpressure triggered |
| retry high, downstream 5xx high | downstream incident |
| DB acquire latency high | pool exhausted or DB slow |

### 17.2 Batch dashboard

Panels:

```text
Running jobs by jobName
Failed jobs by jobName
Job duration trend
Step duration trend
Read/write throughput
Skip count by reason
Retry count by reason
Checkpoint count and interval
Partition skew
Oldest running job
Jobs stuck in STARTED/STARTING/STOPPING
Restart count
```

### 17.3 Control plane view

For operator/admin UI:

```text
Task ID
Workload type
Business key
Submitted by
Submitted at
Started at
Duration
Attempt
Status
Last error
Next retry at
Cancel action
Retry action
Audit link
Trace link
Logs link
```

For batch:

```text
Job name
Job execution ID
Parameters summary
Submitted by
Status
Exit status
Started/completed
Current step
Read/write/skip count
Failure summary
Restart button
Stop button
Audit link
```

---

## 18. Alert Design

Alert harus actionable. Jangan alert semua noise.

### 18.1 Good alerts

```text
Oldest queued task age > SLA for 10 minutes
Task rejection rate > 0 for critical workload for 5 minutes
Batch job failed for required nightly process
Batch job running longer than historical p99 + threshold
Retry exhausted count > 0
DB connection acquire p95 > 2 seconds for 10 minutes
Downstream 429 rate > threshold
Scheduled trigger skipped 3 consecutive runs
Stuck task detected > max allowed duration
```

### 18.2 Bad alerts

```text
Any exception logged
CPU > 70% for 1 minute
One retry happened
One slow item happened
Queue depth > 0
Any virtual thread created
```

Bad alerts create alert fatigue.

### 18.3 Multi-signal alert

Lebih baik:

```text
IF queue_depth increasing
AND oldest_task_age > SLA
AND active_tasks == max_concurrency
THEN alert executor saturation
```

Atau:

```text
IF retry_rate high
AND downstream_5xx high
AND circuit_open_total increasing
THEN alert downstream incident
```

---

## 19. Audit Trail vs Technical Log

Async enterprise systems sering salah mencampur audit dengan log.

### 19.1 Technical log

Tujuan:

- debugging
- troubleshooting
- performance analysis
- incident investigation

Karakter:

- noisy
- bisa sampling/retention lebih pendek
- teknis
- boleh berubah format sepanjang pipeline mendukung

### 19.2 Audit trail

Tujuan:

- accountability
- regulatory evidence
- business defensibility
- legal/compliance review

Karakter:

- durable
- structured
- queryable
- tidak bergantung sampling
- punya retention policy
- harus jelas aktor, objek, aksi, hasil, alasan

### 19.3 Async audit fields

Untuk async task:

```text
auditId
correlationId
taskId
workloadType
businessEntityType
businessEntityId
initiatedBy
initiatedAt
acceptedAt
startedAt
completedAt
executedBy
executionMode
attempt
status
outcome
reasonCode
failureCode
sourceRequestId
sourceIp? optional and privacy-aware
```

Untuk system identity:

```text
initiatedBy = user-123
executedBy = system:case-escalation-worker
```

Ini lebih defensible daripada hanya:

```text
SYSTEM updated case status.
```

### 19.4 Regulatory case example

Buruk:

```text
Case status changed to ESCALATED by SYSTEM.
```

Baik:

```text
Case CASE-2026-000981 escalation evaluation was requested by user-123 at 2026-06-17T09:01:14+07:00.
The evaluation was executed by system:case-escalation-worker under ruleset ESC-RULES-v2026.06.
The case changed from UNDER_REVIEW to ESCALATED because overdueDays=45 and riskScore=87 exceeded configured thresholds.
Correlation ID: corr-case-escalation-20260617-000044.
Task ID: task-01JY0B2C9KX8BQZ7R9W1ZP3KQE.
```

---

## 20. Stuck Task Detection

Async workload butuh stuck detection eksplisit.

### 20.1 Stuck means what?

A task is stuck if:

```text
now - startedAt > expectedMaxDuration
AND task has no progress signal
AND task has not completed/cancelled/failed
```

Progress signal bisa berupa:

- last heartbeat
- records processed count increased
- checkpoint advanced
- downstream call completed
- log event
- step progress

### 20.2 Heartbeat pattern

Task table:

```sql
CREATE TABLE async_task_execution (
    task_id          VARCHAR(64) PRIMARY KEY,
    workload_type    VARCHAR(100) NOT NULL,
    status           VARCHAR(30) NOT NULL,
    submitted_at     TIMESTAMP NOT NULL,
    started_at       TIMESTAMP NULL,
    completed_at     TIMESTAMP NULL,
    last_heartbeat_at TIMESTAMP NULL,
    progress_current NUMBER NULL,
    progress_total   NUMBER NULL,
    attempt          NUMBER NOT NULL,
    last_error_code  VARCHAR(100) NULL,
    last_error_text  VARCHAR(1000) NULL
);
```

During processing:

```java
progressReporter.heartbeat(taskId, processed, total);
```

Detector:

```sql
SELECT task_id, workload_type, started_at, last_heartbeat_at
FROM async_task_execution
WHERE status = 'RUNNING'
  AND last_heartbeat_at < SYSTIMESTAMP - INTERVAL '10' MINUTE;
```

### 20.3 Jakarta Batch progress

For batch, progress is often:

```text
readCount
writeCount
commitCount
checkpoint position
current partition status
```

If read/write count does not change for a long time while job remains STARTED, investigate.

---

## 21. Observability for Shutdown and Redeploy

Async workload must be observable during shutdown.

Events:

```text
application_shutdown_started
executor_shutdown_started
task_cancel_requested_due_to_shutdown
task_completed_during_grace_period
task_not_completed_before_shutdown
batch_stop_requested_due_to_shutdown
batch_checkpoint_saved_before_shutdown
```

Metrics:

```text
shutdown_in_progress
shutdown_tasks_remaining
shutdown_forced_termination_total
```

Kubernetes/EKS style concern:

```text
SIGTERM received
readiness false
stop accepting new work
request running tasks to stop
save checkpoint
wait grace period
exit
```

If shutdown is not observable, rolling deployment becomes a source of silent data corruption or duplicate work.

---

## 22. Observability for Scheduled Workloads

Scheduled workload has unique problems.

### 22.1 What to record

```text
scheduleName
scheduledFireTime
actualFireTime
delay
nodeId
lockAcquired
skippedReason
executionId
previousExecutionStatus
```

### 22.2 Cluster schedule events

```text
scheduled_trigger_fired{node=A}
scheduled_lock_acquired{node=A}
scheduled_lock_failed{node=B}
scheduled_execution_started{node=A}
```

This makes it clear that node B did not fail; it correctly skipped because node A owned the cluster lock.

### 22.3 Overlap prevention

If a schedule fires every 5 minutes but job takes 20 minutes:

```text
scheduled_overlap_skipped_total
scheduled_execution_duration_seconds
scheduled_fire_delay_seconds
```

Alert if overlap skipped too many times:

```text
schedule skipped 3 consecutive runs because previous run still active
```

---

## 23. Observability for Virtual Threads

Virtual threads change some diagnostics.

### 23.1 What improves

- thread-per-task model becomes easier to reason about
- blocking stack traces often align with logical tasks
- high concurrency I/O is easier
- virtual threads are represented as `Thread` objects

### 23.2 What becomes dangerous

Because virtual threads are cheap, developers may create too many concurrent operations against limited resources:

```text
10,000 virtual threads
100 DB connections
external API limit 300/min
```

Metrics must focus on constrained resources:

```text
DB pool acquire latency
external rate limit wait
active downstream calls
bulkhead usage
queue/backlog
```

Not merely thread count.

### 23.3 Useful virtual-thread diagnostics

Monitor:

```text
virtual thread count where available
JFR virtual thread events
socket read/write duration
monitor blocked/pinning-related symptoms where relevant
carrier thread utilization
DB connection pressure
```

Important mental model:

```text
Virtual threads reduce the cost of waiting.
They do not increase downstream capacity.
```

---

## 24. Error Classification for Observability

Do not just count exceptions. Classify them.

### 24.1 Error taxonomy

```text
TRANSIENT_DOWNSTREAM
RATE_LIMITED
TIMEOUT
VALIDATION_ERROR
AUTHORIZATION_ERROR
CONFLICT
DUPLICATE
POISON_RECORD
RESOURCE_EXHAUSTED
BUG
DATA_INTEGRITY
CANCELLED
SHUTDOWN
```

### 24.2 Why classification matters

Same exception count can imply different actions.

| Error | Retry? | Alert? | Operator Action |
|---|---:|---:|---|
| transient 503 | yes | if sustained | monitor downstream |
| 429 | delayed retry | if rate high | reduce rate/concurrency |
| validation error | no | maybe | fix data/input |
| poison record | no after threshold | yes if critical | quarantine/manual review |
| duplicate | no | usually no | idempotency working |
| DB deadlock | maybe | if repeated | inspect locking/order |
| bug/null pointer | no | yes | fix code |
| shutdown | no | no if planned | ensure restart/checkpoint |

### 24.3 Exception normalization

Do not expose raw exception class everywhere as primary business signal.

Create normalized failure code:

```java
public enum AsyncFailureCode {
    DOWNSTREAM_TIMEOUT,
    DOWNSTREAM_RATE_LIMITED,
    VALIDATION_FAILED,
    AUTHORIZATION_FAILED,
    DUPLICATE_REQUEST,
    DB_DEADLOCK,
    DB_CONNECTION_TIMEOUT,
    POISON_RECORD,
    INTERNAL_BUG,
    CANCELLED_BY_USER,
    CANCELLED_BY_SHUTDOWN
}
```

Use raw exception in logs; use normalized code in dashboard/audit.

---

## 25. Common Failure Modes and Their Observability Signals

### 25.1 Executor saturation

Signals:

```text
active tasks at max
queue depth increasing
wait time p95 increasing
rejection count maybe increasing
CPU or DB/API bottleneck visible
```

Actions:

- reduce admission
- split workload/bulkhead
- scale if bottleneck allows
- tune concurrency
- defer to durable queue/batch

### 25.2 Queue explosion

Signals:

```text
queue depth monotonically increasing
oldest queued task age increasing
memory usage increasing if in-memory queue
```

Actions:

- bounded queue
- reject/defer
- durable queue with TTL/SLA
- admission control

### 25.3 Lost context

Signals:

```text
logs missing correlationId/taskId
trace broken at async boundary
audit says SYSTEM without initiatedBy
```

Actions:

- task envelope
- MDC wrapper
- ContextService
- explicit audit fields

### 25.4 Silent `CompletableFuture` failure

Signals:

```text
task submitted but no completion log
exception appears only in debug or not at all
user-visible status stuck
```

Actions:

- always observe terminal stage
- persist task status
- use `whenComplete`
- avoid fire-and-forget without supervision

### 25.5 Batch stuck in STARTED

Signals:

```text
job status STARTED for too long
read/write count no progress
no checkpoint advancement
thread dump shows blocked DB/API/lock
```

Actions:

- inspect step/partition
- check DB locks
- check downstream
- request stop if safe
- restart from checkpoint

### 25.6 Retry storm

Signals:

```text
retry count spikes
external 5xx/429 spikes
queue grows
downstream latency worsens
```

Actions:

- exponential backoff + jitter
- circuit breaker
- rate limit
- pause workload
- dead-letter after threshold

### 25.7 Duplicate cluster execution

Signals:

```text
same schedule execution on multiple nodes
same businessKey processed concurrently
unique constraint violations
idempotency duplicate count increasing
```

Actions:

- cluster lock
- unique job request key
- idempotency key
- DB constraint
- single scheduler leader

---

## 26. Implementation Blueprint: Async Observability Module

### 26.1 Components

```text
AsyncTaskContext
AsyncTaskRepository
AsyncTaskMetrics
AsyncTaskAuditService
AsyncTaskLogger
ObservedRunnable / ObservedCallable
ObservedExecutorFacade
CancellationRegistry
ProgressReporter
FailureClassifier
```

### 26.2 Flow

```text
1. Request validates operation.
2. Create correlationId if absent.
3. Create durable task record with status SUBMITTED.
4. Submit observed task to ManagedExecutorService.
5. On acceptance, status remains QUEUED/SUBMITTED.
6. When task starts, update RUNNING, record wait time.
7. Task periodically heartbeats/progresses.
8. On success, update COMPLETED.
9. On retryable failure, update RETRY_SCHEDULED.
10. On permanent failure, update FAILED/DEAD_LETTERED.
11. On cancel, update CANCELLING then CANCELLED.
```

### 26.3 State model

```text
SUBMITTED
  -> QUEUED
  -> RUNNING
  -> COMPLETED
  -> FAILED
  -> RETRY_SCHEDULED
  -> CANCEL_REQUESTED
  -> CANCELLED
  -> DEAD_LETTERED
  -> REJECTED
```

Do not use only boolean flags.

### 26.4 Durable task table example

```sql
CREATE TABLE async_task (
    task_id             VARCHAR2(64) PRIMARY KEY,
    correlation_id      VARCHAR2(128) NOT NULL,
    trace_id            VARCHAR2(128),
    workload_type       VARCHAR2(100) NOT NULL,
    business_key        VARCHAR2(200),
    status              VARCHAR2(40) NOT NULL,
    attempt             NUMBER(10) NOT NULL,
    max_attempts        NUMBER(10) NOT NULL,
    submitted_by        VARCHAR2(100),
    executed_by         VARCHAR2(100),
    submitted_at        TIMESTAMP NOT NULL,
    accepted_at         TIMESTAMP,
    started_at          TIMESTAMP,
    last_heartbeat_at   TIMESTAMP,
    completed_at        TIMESTAMP,
    next_retry_at       TIMESTAMP,
    cancel_requested_at TIMESTAMP,
    last_failure_code   VARCHAR2(100),
    last_failure_class  VARCHAR2(300),
    last_failure_text   VARCHAR2(1000),
    progress_current    NUMBER(19),
    progress_total      NUMBER(19),
    version             NUMBER(19) NOT NULL
);

CREATE INDEX idx_async_task_status_retry
    ON async_task(status, next_retry_at);

CREATE INDEX idx_async_task_correlation
    ON async_task(correlation_id);

CREATE INDEX idx_async_task_business
    ON async_task(workload_type, business_key);
```

---

## 27. Testing Observability

Observability must be tested, not assumed.

### 27.1 Unit tests

Test:

- MDC set during task
- MDC restored/cleared after task
- success metric emitted
- failure metric emitted
- rejection metric emitted
- audit event written
- failure classified correctly
- interrupted exception preserves interrupt flag

### 27.2 Integration tests

Test:

- task submitted via managed executor
- status transitions persisted
- correlation ID appears in logs
- timeout path updates status
- cancellation path updates status
- retry path schedules next attempt
- duplicate task rejected/deduped

### 27.3 Chaos/failure tests

Inject:

- downstream timeout
- downstream 429
- DB connection exhaustion
- executor rejection
- JVM shutdown/pod termination
- batch step exception
- partition failure
- poison record

Verify:

- dashboard signals show issue
- alert fires only when threshold met
- audit remains consistent
- restart/cancel works

### 27.4 Log assertion example

Do not only assert message text. Assert structured fields.

```text
event=async_task_failed
taskId exists
correlationId exists
failureCode=DOWNSTREAM_TIMEOUT
attempt=2
```

---

## 28. Production Runbook

### 28.1 When user says: “Task is stuck”

Check:

1. Find task by business key/correlation ID.
2. Check status.
3. Check submitted/started/heartbeat timestamps.
4. Check queue wait metrics.
5. Check executor active/queue metrics.
6. Check last failure/retry info.
7. Check trace/log by taskId.
8. Check DB pool/downstream metrics.
9. If running too long, inspect thread dump/JFR.
10. Cancel/retry only if idempotency/restart rules allow.

### 28.2 When batch failed

Check:

1. Job execution ID.
2. Batch status and exit status.
3. Failed step.
4. Read/write/skip/retry counts.
5. Last checkpoint.
6. Failure classification.
7. Whether failed items are poison or transient.
8. Whether restart is safe.
9. Whether external side effects are idempotent.
10. Audit outcome and affected records.

### 28.3 When queue is growing

Check:

1. Arrival rate vs completion rate.
2. Active tasks vs max concurrency.
3. Execution duration trend.
4. Queue wait trend.
5. DB pool acquire latency.
6. Downstream latency/error rate.
7. Retry rate.
8. Recent deployment/config change.
9. Cluster node count.
10. Whether backpressure/rejection is working.

### 28.4 When CPU high

Check:

1. JFR CPU samples.
2. Active workload type.
3. Executor active tasks.
4. Recent batch/partition job.
5. Serialization/XML/JSON hotspots.
6. Encryption/compression/hash hotspots.
7. Regex/rules engine hotspots.
8. Thread dump RUNNABLE stacks.
9. GC/allocation pressure.
10. Reduce concurrency if CPU saturated.

---

## 29. Best Practices

1. Every async task must have a stable `taskId`.
2. Every business operation spanning async boundaries must have a `correlationId`.
3. Do not rely on request ID after request completion.
4. Always observe `CompletableFuture` terminal completion.
5. Never use metric labels with high-cardinality IDs such as `taskId` or `caseId`.
6. Use structured logs with stable event names.
7. Separate technical logs from business audit.
8. Record queue wait time, not only execution time.
9. Track oldest queued task age.
10. Track rejection count and reason.
11. Track cancellation requested vs cancellation completed.
12. Track retry attempts and retry exhaustion.
13. Track batch step/partition metrics, not only job status.
14. Use JFR for CPU/allocation/lock/I/O investigation.
15. Use thread dumps for immediate stuck diagnosis.
16. Make shutdown events visible.
17. Make scheduled lock/skip behavior visible in cluster.
18. Classify failures into normalized failure codes.
19. Store durable task/job status for long-running async work.
20. Design dashboards around operator decisions, not vanity graphs.

---

## 30. Anti-Patterns

### 30.1 Fire-and-forget without supervision

```java
managedExecutor.submit(() -> doWork());
```

No task ID, no status, no failure handling, no audit.

### 30.2 Log-only observability

```text
We can grep logs if something happens.
```

This fails under concurrency, retries, high volume, and regulatory review.

### 30.3 High-cardinality metric labels

```text
async_task_duration_seconds{taskId="...", caseId="..."}
```

This can damage metrics infrastructure.

### 30.4 Audit through technical logs

```text
INFO Case updated by SYSTEM
```

Not defensible enough.

### 30.5 Missing wait time

Only measuring execution time hides queue saturation.

### 30.6 Silent `CompletableFuture`

Not storing/observing the future means exceptions can vanish from operational view.

### 30.7 Dashboard without runbook

Graphs without interpretation are decoration.

### 30.8 Restarting pods to fix stuck batch

Restart may make things worse if checkpoint/idempotency is not sound.

### 30.9 Sampling audit events

Trace/log sampling is fine. Audit sampling is not.

### 30.10 Treating virtual thread count as capacity

Capacity is usually DB/API/CPU/lock, not thread count.

---

## 31. Step-by-Step Design Exercise

Scenario:

```text
User requests bulk recalculation of enforcement escalation for 50,000 cases.
System returns 202 Accepted.
Work runs asynchronously.
Each case may update status and create audit record.
Some cases call external registry API.
```

### 31.1 Identify identities

```text
correlationId = corr-bulk-escalation-20260617-001
taskId = task-bulk-escalation-001
workloadType = BULK_ESCALATION_RECALCULATION
businessKey = BULK-REQ-20260617-001
initiatedBy = user-123
```

### 31.2 Define task state

```text
SUBMITTED -> RUNNING -> COMPLETED
                    -> FAILED
                    -> RETRY_SCHEDULED
                    -> CANCEL_REQUESTED -> CANCELLED
```

### 31.3 Define logs

```text
bulk_escalation_submitted
bulk_escalation_started
bulk_escalation_progress
bulk_escalation_case_failed
bulk_escalation_completed
bulk_escalation_failed
```

### 31.4 Define metrics

```text
bulk_escalation_cases_processed_total
bulk_escalation_cases_failed_total
bulk_escalation_duration_seconds
bulk_escalation_external_call_duration_seconds
bulk_escalation_queue_wait_seconds
bulk_escalation_retry_total
```

### 31.5 Define audit

For request-level:

```text
Bulk recalculation requested by user-123 for filter X.
```

For case-level status change:

```text
Case CASE-001 changed from REVIEW to ESCALATED by system worker.
Initiated by user-123.
Rule version R.
Reason codes [...].
```

### 31.6 Define dashboard

```text
Current running bulk requests
Cases processed/sec
Failure count by reason
External registry latency
Oldest running task
Cancel/retry actions
```

### 31.7 Define alert

```text
Bulk escalation task running > 2x historical p99
External registry 429 > threshold
Case failure rate > 5%
No heartbeat for 10 minutes
```

This is how observability becomes part of design, not an afterthought.

---

## 32. Checklist

Before shipping async workload, verify:

### Identity

- [ ] Every task has `taskId`.
- [ ] Every cross-boundary operation has `correlationId`.
- [ ] Batch job execution ID is linked to business correlation.
- [ ] `initiatedBy` and `executedBy` are distinguished.

### Logging

- [ ] Structured logs exist.
- [ ] Stable event names exist.
- [ ] MDC is propagated safely.
- [ ] MDC is cleared/restored.
- [ ] Sensitive data is not logged.

### Metrics

- [ ] Queue depth measured.
- [ ] Oldest queued task age measured.
- [ ] Wait time measured.
- [ ] Execution duration measured.
- [ ] Rejection count measured.
- [ ] Retry/cancel/timeout metrics measured.
- [ ] DB/downstream pressure measured.
- [ ] High-cardinality labels avoided.

### Tracing

- [ ] Async boundary is represented.
- [ ] Trace is continued or linked intentionally.
- [ ] Important spans have workload attributes.

### Audit

- [ ] Audit is durable.
- [ ] Audit is not sampled.
- [ ] Business actor/object/action/outcome are recorded.
- [ ] System execution identity is explicit.

### Runtime diagnostics

- [ ] Thread dump procedure exists.
- [ ] JFR procedure exists.
- [ ] Stuck task detection exists.
- [ ] Shutdown behavior is observable.

### Operations

- [ ] Dashboard exists.
- [ ] Alerts are actionable.
- [ ] Runbook exists.
- [ ] Cancel/retry/restart semantics are clear.

---

## 33. Summary

Observability for managed async workload is not “add more logs”.

The core mental model:

```text
Async work must be identifiable,
measurable,
traceable,
auditable,
cancellable,
and diagnosable across lifecycle boundaries.
```

Important conclusions:

1. Request ID ends with the request; correlation ID must survive async work.
2. Task ID identifies executable work; job execution ID identifies Jakarta Batch runtime execution.
3. MDC is useful but dangerous if not captured/restored/cleared explicitly.
4. Metrics must include queue wait time, active count, queue depth, rejection, retry, timeout, cancellation, and oldest task age.
5. Trace helps explain flow and latency, but audit explains accountability and business outcome.
6. `CompletableFuture` must always have terminal observation.
7. Jakarta Batch job repository is necessary but not sufficient for production observability.
8. JFR and thread dumps remain essential for diagnosing CPU, blocking, lock, allocation, and virtual-thread behavior.
9. Virtual threads improve the execution model but do not remove capacity bottlenecks.
10. A system that cannot explain its async state is not production-ready.

---

## 34. References

- Jakarta Concurrency 3.1 Specification — `https://jakarta.ee/specifications/concurrency/3.1/jakarta-concurrency-spec-3.1`
- Jakarta Concurrency 3.1 API — `https://jakarta.ee/specifications/concurrency/3.1/apidocs/`
- Jakarta EE 11 Release — `https://jakarta.ee/release/11/`
- Jakarta Batch 2.1 — `https://jakarta.ee/specifications/batch/2.1/`
- Java SE 25 Documentation — `https://docs.oracle.com/en/java/javase/25/`
- Java SE 25 Virtual Threads Guide — `https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html`
- JEP 444: Virtual Threads — `https://openjdk.org/jeps/444`
- JDK Flight Recorder Guide — `https://dev.java/learn/jvm/jfr/`
- MicroProfile Metrics — `https://microprofile.io/specifications/microprofile-metrics/`
- MicroProfile Telemetry — `https://microprofile.io/specifications/microprofile-telemetry/`

---

## 35. Next Part

Part berikutnya:

```text
Part 16 — Production Failure Modes in Jakarta Concurrency
File: 16-production-failure-modes-jakarta-concurrency.md
```

Bagian berikutnya akan membahas failure modes secara lebih eksplisit: redeploy leak, classloader leak, executor exhaustion, queue explosion, deadlock/starvation, lost context, duplicate execution, zombie task, cluster duplicate schedule, slow downstream collapse, dan diagnostic playbook.

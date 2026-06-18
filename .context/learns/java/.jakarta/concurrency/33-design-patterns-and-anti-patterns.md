# Part 33 — Design Patterns and Anti-Patterns

> Seri: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `33-design-patterns-and-anti-patterns.md`  
> Fokus: pola desain dan anti-pattern untuk Jakarta/Javax Concurrency dan Jakarta/Javax Batch pada sistem enterprise production-grade.  
> Baseline stabil: Jakarta EE 11, Jakarta Concurrency 3.1, Jakarta Batch 2.1.  
> Cakupan Java: Java 8 sampai Java 25.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Mengenali pola desain yang tepat untuk workload asynchronous, scheduled, dan batch di Jakarta EE.
2. Membedakan antara concurrency sebagai mekanisme eksekusi dan batch sebagai mekanisme orchestration stateful.
3. Memilih pattern berdasarkan invariant: durability, idempotency, restartability, fairness, auditability, transaction boundary, dan operational control.
4. Menghindari anti-pattern yang terlihat sederhana di kode tetapi berbahaya di production.
5. Mendesain workload yang dapat dihentikan, diulang, dilanjutkan, diamati, diaudit, dan dikendalikan.
6. Membuat keputusan arsitektural: kapan memakai `ManagedExecutorService`, `ManagedScheduledExecutorService`, Jakarta Batch, messaging, Kubernetes Job, atau workflow engine.
7. Menggunakan Java 8–25 secara rasional, termasuk `CompletableFuture`, virtual threads, structured concurrency preview, dan scoped values, tanpa merusak kontrak container Jakarta EE.

Bagian ini bukan katalog “tips”. Ini adalah synthesis layer dari Part 0–32.

---

## 2. Problem yang Diselesaikan

Di banyak sistem enterprise, masalah concurrency dan batch tidak muncul karena developer tidak tahu API. Masalah muncul karena developer memilih **shape eksekusi yang salah**.

Contoh:

```java
new Thread(() -> generateAllReports()).start();
```

Kode ini terlihat sederhana, tetapi menyembunyikan pertanyaan penting:

- Siapa pemilik thread itu?
- Apa yang terjadi saat aplikasi redeploy?
- Bagaimana task dihentikan?
- Apakah security identity terbawa?
- Apakah transaction terbawa?
- Bagaimana progress disimpan?
- Kalau server mati di tengah jalan, apakah job hilang?
- Kalau user klik dua kali, apakah job duplicate?
- Kalau external API lambat, apakah request thread ikut tertahan?
- Apakah operation team bisa melihat statusnya?
- Apakah auditor bisa tahu input, output, skipped record, dan failure reason?

Pattern yang baik menjawab pertanyaan itu secara eksplisit.

Anti-pattern yang buruk biasanya justru menyembunyikan jawaban.

---

## 3. Mental Model Utama

### 3.1 Pattern bukan template kode

Pattern bukan sekadar struktur class.

Pattern adalah jawaban terhadap kombinasi:

```text
Workload shape
+ failure model
+ consistency requirement
+ runtime constraint
+ operational need
+ audit/compliance need
= design pattern
```

Pattern yang sama bisa benar di satu sistem dan salah di sistem lain.

Contoh:

- Fire-and-forget executor bisa cocok untuk best-effort metrics enrichment.
- Fire-and-forget executor salah untuk generate legal notice yang wajib terkirim dan diaudit.

### 3.2 Anti-pattern sering terlihat benar pada happy path

Anti-pattern jarang gagal di local test.

Anti-pattern gagal pada kondisi:

- redeploy
- node restart
- duplicate request
- DB slow
- downstream 429
- transaction timeout
- partial write
- stuck thread
- cluster scaling
- user session expired
- audit investigation

Top-tier engineer membedakan **works once** dari **survives production**.

### 3.3 Desain concurrency harus menjaga invariant

Invariant penting:

| Invariant | Pertanyaan |
|---|---|
| Lifecycle ownership | Siapa yang boleh membuat, menjalankan, menghentikan execution? |
| Capacity bound | Berapa maksimum concurrent work? |
| Queue bound | Berapa maksimum backlog? |
| Context correctness | Context apa yang wajib dibawa dan apa yang tidak boleh dibawa? |
| Transaction boundary | Unit commit/rollback-nya apa? |
| Idempotency | Aman tidak jika dieksekusi ulang? |
| Restartability | Bisa lanjut dari titik aman? |
| Auditability | Bisa dibuktikan siapa melakukan apa, kapan, atas input apa? |
| Observability | Bisa dilihat state dan bottleneck-nya? |
| Cluster ownership | Di node mana pekerjaan berjalan dan bagaimana duplicate dicegah? |

Jika sebuah desain tidak menjawab invariant ini, desain itu belum selesai.

---

## 4. Pattern Map: Kapan Memakai Apa?

### 4.1 Execution model decision table

| Kebutuhan | Model yang biasanya cocok | Catatan |
|---|---|---|
| Response harus langsung selesai | request thread biasa | Jangan offload jika tidak perlu |
| Request butuh fan-out singkat | managed executor / managed `CompletableFuture` | Harus ada timeout dan bounded concurrency |
| Task async ringan, tidak wajib durable | `ManagedExecutorService` | Cocok untuk low-risk async offload |
| Task periodik sederhana | `ManagedScheduledExecutorService` | Hati-hati cluster duplicate |
| Task besar, durable, restartable | Jakarta Batch | Cocok untuk job stateful |
| Task event-driven durable | messaging/outbox | Cocok untuk decoupling dan replay |
| Task eksternal dengan approval/state panjang | workflow engine | Cocok untuk human workflow dan long-running process |
| Task infra/container-native one-off | Kubernetes Job | Cocok untuk ops-level workloads |
| High-volume streaming | stream processor | Batch bukan pilihan utama |

### 4.2 Rule of thumb

```text
If work must survive process crash -> do not keep state only in memory.
If work can be retried -> design idempotency first.
If work is long-running -> design stop/restart first.
If work touches external systems -> design reconciliation first.
If work is regulated -> design audit first.
If work is parallel -> design capacity and fairness first.
```

---

# 5. Design Patterns

---

## Pattern 1 — Managed Async Command

### Problem

Request perlu memicu pekerjaan asynchronous, tetapi pekerjaan tidak cukup penting untuk membutuhkan durable job repository.

Contoh:

- refresh cache non-critical
- recalculate derived view kecil
- send non-critical notification hint
- warm-up metadata
- asynchronous audit enrichment yang masih bisa direkonstruksi

### Solution

Representasikan pekerjaan sebagai command object, submit ke `ManagedExecutorService`, dan pastikan:

- executor dikelola container
- task bounded
- timeout jelas
- error ditangkap
- correlation ID terbawa
- task tidak memegang request object mentah

### Shape

```text
HTTP request
    -> validate intent
    -> create AsyncCommand
    -> submit to ManagedExecutorService
    -> return accepted / immediate response

Managed task
    -> restore minimal context
    -> execute bounded work
    -> emit metrics/audit/log
    -> complete/fail gracefully
```

### Example

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.concurrent.ManagedExecutorService;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.concurrent.Future;

@ApplicationScoped
public class AsyncCommandDispatcher {

    @Resource
    private ManagedExecutorService executor;

    public Future<AsyncResult> dispatch(AsyncCommand command) {
        return executor.submit(() -> {
            try {
                command.validateExecutionPreconditions();
                command.execute();
                return AsyncResult.success(command.commandId());
            } catch (Exception ex) {
                command.recordFailure(ex);
                return AsyncResult.failed(command.commandId(), ex.getClass().getName(), ex.getMessage());
            }
        });
    }
}
```

### Invariants

- Command immutable after creation.
- No raw `HttpServletRequest`, `EntityManager`, or request-scoped bean stored inside command.
- Task has explicit timeout/cancellation policy.
- Failure is observable.

### When to use

Use when:

- work is short
- loss is acceptable or recoverable
- no strict restart requirement
- no long-running transaction
- no heavy side effect requiring audit-level state machine

### When not to use

Do not use for:

- payment/legal/enforcement action
- bulk data migration
- external side effects that must be exactly tracked
- multi-minute or multi-hour jobs
- workloads requiring restart after crash

### Common failure prevented

- unmanaged thread leak
- invisible background task
- lost container context
- request latency inflation

---

## Pattern 2 — Durable Job Request

### Problem

User/API triggers long-running work that must survive restart and be visible to operations.

Examples:

- bulk correspondence generation
- nightly escalation evaluation
- external registry synchronization
- regulatory case ageing recalculation
- large export

### Solution

Persist a `job_request` row before execution. Then a controlled worker or Jakarta Batch job picks it up.

### Shape

```text
Client request
    -> validate permission
    -> validate parameters
    -> insert job_request(PENDING)
    -> return jobRequestId

Worker / Batch launcher
    -> claim PENDING request
    -> start Jakarta Batch job with parameters
    -> update request state
    -> expose status API
```

### Suggested table

```sql
CREATE TABLE job_request (
    id                  VARCHAR2(64) PRIMARY KEY,
    job_type            VARCHAR2(100) NOT NULL,
    request_key         VARCHAR2(200) NOT NULL,
    status              VARCHAR2(30) NOT NULL,
    requested_by        VARCHAR2(100) NOT NULL,
    requested_at        TIMESTAMP NOT NULL,
    approved_by         VARCHAR2(100),
    approved_at         TIMESTAMP,
    parameters_json     CLOB NOT NULL,
    batch_execution_id  NUMBER,
    correlation_id      VARCHAR2(100),
    idempotency_key     VARCHAR2(200) NOT NULL,
    failure_code        VARCHAR2(100),
    failure_message     VARCHAR2(1000),
    version             NUMBER DEFAULT 0 NOT NULL,
    CONSTRAINT uq_job_request_idem UNIQUE (job_type, idempotency_key)
);
```

### State machine

```text
DRAFT / PENDING_APPROVAL
        -> APPROVED
        -> QUEUED
        -> RUNNING
        -> SUCCEEDED
        -> FAILED_RETRYABLE
        -> FAILED_FINAL
        -> STOPPING
        -> STOPPED
        -> ABANDONED
```

### Invariants

- Request exists before work starts.
- Duplicate request prevented by idempotency key.
- Runtime execution linked to request row.
- Operator can inspect state.
- Restart can derive next action from persisted state.

### Why this matters

Jakarta Batch has its own repository, but application-level job request still matters because batch repository is technical execution state. Business control plane usually needs:

- approval
- authorization
- business parameters
- requester identity
- reason
- evidence
- retention
- duplicate prevention
- UI/API state

### When to use

Use for important asynchronous work.

### When not to use

Do not overuse for trivial async tasks where in-memory execution is acceptable.

---

## Pattern 3 — Outbox-Driven Batch

### Problem

Batch processing changes internal state and must call external systems. If DB commit succeeds but API call fails, or API call succeeds but DB update fails, state becomes inconsistent.

### Solution

Separate internal state transition from external side effect using an outbox table.

### Shape

```text
Batch chunk transaction
    -> update internal records
    -> insert outbox event
    -> commit

Outbox dispatcher
    -> read pending outbox events
    -> call external API with idempotency key
    -> record response
    -> mark SENT / FAILED_RETRYABLE / FAILED_FINAL
```

### Example outbox table

```sql
CREATE TABLE integration_outbox (
    id                  VARCHAR2(64) PRIMARY KEY,
    event_type          VARCHAR2(100) NOT NULL,
    aggregate_type      VARCHAR2(100) NOT NULL,
    aggregate_id        VARCHAR2(100) NOT NULL,
    idempotency_key     VARCHAR2(200) NOT NULL,
    payload_json        CLOB NOT NULL,
    status              VARCHAR2(30) NOT NULL,
    attempt_count       NUMBER DEFAULT 0 NOT NULL,
    next_attempt_at     TIMESTAMP,
    last_error_code     VARCHAR2(100),
    last_error_message  VARCHAR2(1000),
    created_at          TIMESTAMP NOT NULL,
    sent_at             TIMESTAMP,
    CONSTRAINT uq_outbox_idem UNIQUE (event_type, idempotency_key)
);
```

### Invariants

- Internal DB state and outbox insert commit atomically.
- External side effect is retried independently.
- External call uses idempotency key.
- Response is persisted.
- Reconciliation is possible.

### Why not call external API directly inside chunk?

Because chunk rollback cannot rollback external API.

If direct call is unavoidable, then writer must be idempotent and must persist enough evidence to reconcile.

### When to use

Use when batch produces external side effects.

### When not to use

If side effect is truly read-only, no outbox may be needed.

---

## Pattern 4 — Idempotent Writer

### Problem

Batch writer may run more than once for the same item/chunk due to retry, restart, failure after partial side effect, or uncertain external response.

### Solution

Design writer so repeated execution with the same logical item does not create incorrect duplicate effects.

### Techniques

1. Natural key upsert.
2. Idempotency key table.
3. Deduplication by business operation ID.
4. External API idempotency key.
5. Compare-and-set state transition.
6. Versioned optimistic locking.
7. Write-once effect ledger.

### Example: effect ledger

```sql
CREATE TABLE batch_effect_ledger (
    effect_key      VARCHAR2(200) PRIMARY KEY,
    job_name        VARCHAR2(100) NOT NULL,
    job_execution_id NUMBER NOT NULL,
    item_key        VARCHAR2(200) NOT NULL,
    effect_type     VARCHAR2(100) NOT NULL,
    status          VARCHAR2(30) NOT NULL,
    created_at      TIMESTAMP NOT NULL
);
```

### Java sketch

```java
public void writeItems(List<Object> items) throws Exception {
    for (Object raw : items) {
        CaseEscalation item = (CaseEscalation) raw;
        String effectKey = "ESCALATE:" + item.caseId() + ":" + item.targetStage();

        if (effectLedger.exists(effectKey)) {
            metrics.increment("batch.writer.duplicate_suppressed");
            continue;
        }

        caseRepository.transitionIfCurrentState(
            item.caseId(),
            item.expectedCurrentStage(),
            item.targetStage()
        );

        effectLedger.insert(effectKey, "ESCALATION", "SUCCEEDED");
    }
}
```

### Invariants

- Logical operation has stable key.
- Duplicate execution is no-op or converges to same state.
- Partial failure can be reconciled.

### Anti-invariant

```text
Every retry creates a new row/email/payment/notice.
```

That is not batch-safe.

---

## Pattern 5 — Resumable Reader

### Problem

Batch reads large input. Failure occurs halfway. Restart must continue from a known safe point.

### Solution

Reader maintains checkpoint state and resumes deterministically.

### Good checkpoint state

- last processed primary key
- file byte offset if encoding-safe
- line number plus file hash
- page cursor token if stable
- partition range and current offset

### Bad checkpoint state

- in-memory index only
- timestamp query without stable ordering
- page number over mutable dataset
- non-deterministic sort
- cursor dependent on expired DB session

### Example

```java
public class CaseKeysetReader implements ItemReader {

    private long lastSeenId;
    private Iterator<CaseRow> currentPage;

    @Override
    public void open(Serializable checkpoint) {
        this.lastSeenId = checkpoint == null ? 0L : (Long) checkpoint;
        this.currentPage = List.<CaseRow>of().iterator();
    }

    @Override
    public Object readItem() {
        if (!currentPage.hasNext()) {
            currentPage = loadNextPageAfter(lastSeenId).iterator();
            if (!currentPage.hasNext()) {
                return null;
            }
        }

        CaseRow row = currentPage.next();
        lastSeenId = row.id();
        return row;
    }

    @Override
    public Serializable checkpointInfo() {
        return lastSeenId;
    }

    @Override
    public void close() {
        // close resources if any
    }
}
```

### Invariants

- Ordering is stable.
- Checkpoint is serializable.
- Restart does not skip unprocessed item.
- Restart does not reprocess unsafe item without idempotency.

---

## Pattern 6 — Checkpointed File Ingestion

### Problem

Large file ingestion must support restart, validation, quarantine, archive, and audit.

### Solution

Treat file as governed input artifact, not just stream.

### Shape

```text
landing/
    -> validate manifest/checksum
    -> move atomically to processing/
    -> stream parse
    -> chunk write with checkpoint
    -> produce error report
    -> move to archive/ or quarantine/
```

### Required metadata

- file name
- file size
- checksum
- producer
- received timestamp
- schema version
- record count if available
- manifest ID
- job execution ID
- processing status

### Invariants

- File is immutable during processing.
- Restart verifies same file via checksum.
- Bad records are traceable to line/record number.
- Archive/quarantine is deterministic.

### Failure prevented

- partial file read
- changed file during restart
- duplicate ingestion
- unverifiable input

---

## Pattern 7 — Fan-Out/Fan-In with Bounded Executor

### Problem

Request or batch step needs call multiple independent operations concurrently.

### Solution

Fan out tasks into a managed, bounded executor; fan in results with timeout, cancellation, and partial-failure policy.

### Shape

```text
Parent operation
    -> create bounded child tasks
    -> submit to managed executor
    -> wait with deadline
    -> cancel unfinished tasks
    -> aggregate result
    -> decide success/partial/failure
```

### Example with `CompletableFuture`

```java
public CompletionStage<AggregateResult> aggregate(CaseId caseId) {
    CompletableFuture<Profile> profile = CompletableFuture.supplyAsync(
        () -> profileClient.fetch(caseId),
        managedExecutor
    );

    CompletableFuture<Risk> risk = CompletableFuture.supplyAsync(
        () -> riskClient.fetch(caseId),
        managedExecutor
    );

    CompletableFuture<History> history = CompletableFuture.supplyAsync(
        () -> historyClient.fetch(caseId),
        managedExecutor
    );

    return CompletableFuture.allOf(profile, risk, history)
        .orTimeout(3, TimeUnit.SECONDS)
        .handle((ignored, ex) -> {
            if (ex != null) {
                profile.cancel(true);
                risk.cancel(true);
                history.cancel(true);
                return AggregateResult.partial(caseId, ex);
            }
            return AggregateResult.complete(profile.join(), risk.join(), history.join());
        });
}
```

### Invariants

- Parent has deadline.
- Child tasks are bounded.
- Executor is managed.
- Cancellation is attempted.
- Aggregation policy explicit.

### Java 21+ note

Virtual threads reduce cost of blocking fan-out, but do not remove need for:

- deadline
- cancellation
- context
- capacity control
- downstream rate limit

### Java 25 note

Structured Concurrency preview gives a stronger conceptual model for parent-child tasks, but portable Jakarta EE usage still depends on server support and container contract.

---

## Pattern 8 — Bulkhead Executor

### Problem

Different workload classes compete for same executor and starve each other.

Example:

- report generation consumes all threads
- request-side enrichment slows down
- batch partition workers exhaust DB pool

### Solution

Separate executors/capacity pools per workload class.

### Shape

```text
executor.user-facing-fast     -> small queue, low latency
executor.batch-heavy          -> limited parallelism
executor.external-api         -> rate-limit aware
executor.notification         -> best effort
executor.maintenance          -> off-hours only
```

### Invariants

- One workload class cannot consume all execution capacity.
- Queue and active count are observable per bulkhead.
- Rejection policy matches business criticality.

### Sizing example

```text
DB pool = 50
Request reserve = 30 connections
Batch max DB concurrency = 10 connections
Maintenance reserve = 5 connections
Emergency margin = 5 connections
```

Batch executor should not have 50 concurrent DB writers just because DB pool has 50 connections.

### Failure prevented

- noisy neighbor
- retry storm collapse
- background job killing online traffic

---

## Pattern 9 — Cluster Singleton Scheduler

### Problem

`ManagedScheduledExecutorService` runs in every application node. In a cluster, each node may start the same job.

### Solution

Use scheduler only to trigger a guarded claim. A DB lock, lease, or job request uniqueness rule prevents duplicate execution.

### Shape

```text
Every node wakes up
    -> try acquire lease/job key
    -> only winner launches job
    -> loser exits
```

### Lease table

```sql
CREATE TABLE cluster_lease (
    lease_name      VARCHAR2(100) PRIMARY KEY,
    owner_id        VARCHAR2(100) NOT NULL,
    acquired_at     TIMESTAMP NOT NULL,
    expires_at      TIMESTAMP NOT NULL,
    version         NUMBER NOT NULL
);
```

### Invariants

- Lease has expiry.
- Owner renews lease if long-running.
- Job launch remains idempotent even if lease handoff is imperfect.
- Duplicate job start is blocked by business key.

### Important nuance

Lease alone is not enough. Use both:

```text
lease for leadership
+ unique job request key for duplicate prevention
```

---

## Pattern 10 — Batch Control Plane

### Problem

`JobOperator` exposes runtime operations, but production users need governed access, validation, audit, status, retry, and approval.

### Solution

Build an application-level control plane around Jakarta Batch.

### Capabilities

- start job
- stop job
- restart execution
- abandon execution
- inspect execution
- list job instances
- validate parameters
- enforce authorization
- prevent duplicate launch
- require approval for risky jobs
- record audit evidence
- expose metrics/status

### Shape

```text
Admin/API/UI
    -> Batch Control Service
        -> authorization
        -> parameter validation
        -> duplicate check
        -> job_request update
        -> JobOperator.start/restart/stop
        -> audit event
```

### Invariants

- No direct arbitrary job start from UI.
- Job parameters are validated by job type.
- Operator action is audited.
- Restart/abandon requires policy.

### Anti-pattern avoided

```text
Expose JobOperator directly as generic endpoint:
POST /batch/start?jobName=anything&param=anything
```

This is operationally dangerous.

---

## Pattern 11 — Explicit Exit Status Contract

### Problem

Complex job graphs use `exit-status` to route transitions. If exit statuses are ad hoc strings, JSL becomes brittle.

### Solution

Define exit status as a stable contract.

### Example enum

```java
public enum BatchExitStatus {
    COMPLETED,
    COMPLETED_WITH_SKIPS,
    NO_INPUT,
    VALIDATION_FAILED,
    RETRYABLE_DOWNSTREAM_FAILURE,
    PERMANENT_BUSINESS_FAILURE,
    STOPPED_BY_OPERATOR
}
```

### JSL example

```xml
<step id="validateInput" next="processRecords">
    <batchlet ref="inputValidationBatchlet"/>
    <next on="COMPLETED" to="processRecords"/>
    <end on="NO_INPUT" exit-status="NO_INPUT"/>
    <fail on="VALIDATION_FAILED" exit-status="VALIDATION_FAILED"/>
</step>
```

### Invariants

- Exit statuses are documented.
- Routing does not depend on exception class names alone.
- Operators understand final status.
- Audit reports status with business meaning.

---

## Pattern 12 — Retry Budget

### Problem

Unlimited or poorly controlled retry can overload downstream systems and extend batch windows unpredictably.

### Solution

Define retry budget per job/step/downstream.

### Budget dimensions

- max attempts per item
- max retry duration
- max total retry count per job
- max retry rate per downstream
- max percentage of failed records
- stop threshold for systemic failure

### Shape

```text
If 5 records fail transiently -> retry item-level.
If 50% records fail due to same API -> stop job, mark downstream outage.
If one poison record fails repeatedly -> skip/quarantine.
```

### Invariants

- Retry cannot exceed SLA window silently.
- Retry does not create storm.
- Systemic failure stops early.
- Poison data is isolated.

---

## Pattern 13 — Poison Record Quarantine

### Problem

One bad record can repeatedly fail a batch or pollute retry behavior.

### Solution

Classify poison records and move them to a durable quarantine/error table with enough context for remediation.

### Quarantine table

```sql
CREATE TABLE batch_record_error (
    id                  VARCHAR2(64) PRIMARY KEY,
    job_execution_id    NUMBER NOT NULL,
    step_execution_id   NUMBER,
    input_reference     VARCHAR2(500),
    record_key          VARCHAR2(200),
    error_class         VARCHAR2(300),
    error_code          VARCHAR2(100),
    error_message       VARCHAR2(1000),
    raw_payload         CLOB,
    normalized_payload  CLOB,
    remediation_status  VARCHAR2(30) NOT NULL,
    created_at          TIMESTAMP NOT NULL
);
```

### Invariants

- Skipped record is not lost.
- Reason is recorded.
- Remediation can be tracked.
- Reprocessing is possible after correction.

---

## Pattern 14 — Reconciliation Job

### Problem

External systems may return uncertain results. Network timeout does not prove operation failed.

### Solution

Separate “send” from “reconcile”. A reconciliation job checks actual external state and converges local state.

### Shape

```text
Outbound request timed out
    -> mark UNKNOWN
    -> reconciliation job queries external status
    -> mark SENT / FAILED / NEEDS_MANUAL_REVIEW
```

### Invariants

- Unknown state is explicit.
- Retry does not blindly duplicate side effect.
- External source of truth can be consulted.
- Manual review path exists.

### Use cases

- payment
- notification delivery
- document submission
- regulatory registry update
- case transfer to external agency

---

## Pattern 15 — Snapshot Input Set

### Problem

Batch query reads records while online system continues modifying data. Result set changes during execution.

### Solution

Create stable input snapshot before processing.

### Options

1. Materialize IDs into `batch_input_item`.
2. Mark records with `batch_run_id`.
3. Use database snapshot/temporary table.
4. Use export manifest.

### Table

```sql
CREATE TABLE batch_input_item (
    job_request_id   VARCHAR2(64) NOT NULL,
    partition_id     VARCHAR2(64),
    item_key         VARCHAR2(200) NOT NULL,
    status           VARCHAR2(30) NOT NULL,
    created_at       TIMESTAMP NOT NULL,
    PRIMARY KEY (job_request_id, item_key)
);
```

### Invariants

- Input set is stable.
- Restart processes same logical set.
- Audit can prove what was included/excluded.
- Partitioning is deterministic.

### When to use

Use for regulated jobs where “what was processed” must be defensible.

---

## Pattern 16 — Work Claiming with Lease

### Problem

Multiple workers/partitions/nodes need process records without duplication.

### Solution

Workers claim records using status transition and lease expiry.

### Shape

```text
PENDING -> CLAIMED(owner, expiresAt) -> PROCESSING -> DONE
                                      -> FAILED_RETRYABLE
                                      -> FAILED_FINAL
```

### SQL sketch

```sql
UPDATE work_item
SET status = 'CLAIMED',
    owner_id = ?,
    lease_expires_at = ?,
    version = version + 1
WHERE id = ?
  AND status = 'PENDING'
  AND version = ?;
```

### Invariants

- Claim is atomic.
- Stale claim expires.
- Duplicate processing is suppressed by idempotent writer.
- Owner identity is observable.

---

## Pattern 17 — Application-Level Correlation Envelope

### Problem

Async and batch work crosses request, thread, transaction, and node boundaries. Raw MDC/thread context is not enough.

### Solution

Create an explicit correlation envelope and pass/persist it.

### Example

```java
public record WorkEnvelope(
    String correlationId,
    String jobRequestId,
    String jobExecutionId,
    String initiatedBy,
    String effectiveActor,
    String tenantId,
    String reason,
    Instant requestedAt
) {}
```

### Invariants

- Correlation is data, not accidental thread-local state.
- Logs, metrics, audit, and job status share same identity.
- Restart can reconstruct context.

---

## Pattern 18 — Stop-Aware Processor

### Problem

Operators call stop, but job continues for too long or leaves partial state.

### Solution

Processor/writer/batchlet checks stop signal at safe points and exits cooperatively.

### Shape

```text
for each chunk/item/page:
    check stop requested
    process bounded unit
    persist safe progress
    check deadline
```

### Invariants

- Stop is not ignored.
- Stop occurs at safe boundary.
- Progress is checkpointed.
- Restart resumes safely.

---

## Pattern 19 — Operational Dashboard by Workload Class

### Problem

Async/batch execution exists but operators cannot tell what is happening.

### Solution

Expose metrics/status grouped by workload class.

### Dashboard sections

- queued jobs
- running jobs
- failed jobs
- retrying jobs
- stopped jobs
- average duration
- p95/p99 duration
- chunk duration
- records/sec
- skip count
- retry count
- rejection count
- queue wait time
- downstream error rate
- DB pool usage

### Invariants

- Operators see backlog before SLA breach.
- Failures are grouped by cause.
- Stuck tasks are visible.
- Capacity decisions use evidence.

---

## Pattern 20 — Compensation Path

### Problem

Some side effects cannot be rolled back transactionally.

### Solution

Define compensating actions as explicit steps, not hidden catch blocks.

### Example

```text
generate notices
    -> send notices
    -> if partial send failure:
        -> produce correction report
        -> notify operator
        -> mark affected cases NEEDS_REVIEW
```

### Invariants

- Compensation is visible.
- Compensation has audit trail.
- Compensation is idempotent.
- Manual review is explicit when automation cannot safely decide.

---

# 6. Anti-Patterns

---

## Anti-Pattern 1 — `new Thread()` inside Jakarta EE Application Code

### Shape

```java
new Thread(() -> doWork()).start();
```

### Why it looks attractive

- Easy.
- Works locally.
- No configuration.
- Immediate async behavior.

### Why it is dangerous

- Container does not own lifecycle.
- Context may be missing or stale.
- Redeploy may leak thread/classloader.
- Shutdown may hang or abandon work.
- Security identity unclear.
- Monitoring absent.
- Capacity uncontrolled.

### Better alternatives

- `ManagedExecutorService`
- `ManagedScheduledExecutorService`
- Jakarta Batch
- messaging/outbox
- Kubernetes Job for infra-level workloads

### Heuristic

If application server did not create or manage the thread, assume it is suspect unless you have a very strong, documented reason.

---

## Anti-Pattern 2 — Using `ForkJoinPool.commonPool()` in Jakarta EE

### Shape

```java
CompletableFuture.supplyAsync(() -> doWork());
```

Without executor, async stages often use common pool.

### Why dangerous

- Not container-managed.
- Shared global JVM resource.
- Context not propagated reliably.
- Hard to isolate workload.
- Blocking calls can starve unrelated computations.

### Better

```java
CompletableFuture.supplyAsync(() -> doWork(), managedExecutor);
```

### Invariant

Every async boundary should declare its executor intentionally.

---

## Anti-Pattern 3 — Unbounded Queue

### Shape

```text
executor queue = unlimited
```

### Why dangerous

Unbounded queues convert overload into:

- memory growth
- latency explosion
- stale work
- delayed failure
- OOM

### Better

Use bounded queue and explicit rejection/defer policy.

### Correct question

Not:

```text
How do we avoid rejecting work?
```

But:

```text
What should the system do when accepting more work would violate SLA or stability?
```

---

## Anti-Pattern 4 — Long Transaction Batch

### Shape

```text
Start transaction
    process 1 million records
Commit
```

### Why dangerous

- huge undo/redo
- locks held too long
- rollback expensive
- restart impossible or painful
- online workload blocked
- transaction timeout

### Better

Chunk transactions with checkpoint and idempotent writer.

### Invariant

Transaction should bound failure, not enlarge it.

---

## Anti-Pattern 5 — Non-Idempotent Writer

### Shape

```java
for (Item item : items) {
    insertNewNotice(item);
    sendEmail(item);
}
```

Every retry creates another notice/email.

### Why dangerous

- duplicate legal notices
- duplicate payments
- duplicate external submissions
- corrupted audit trail

### Better

- effect ledger
- idempotency key
- unique business operation key
- outbox
- compare-and-set transition

---

## Anti-Pattern 6 — Business Logic Hidden in Listener

### Shape

```java
public class MyStepListener implements StepListener {
    public void afterStep() {
        // update cases, send emails, trigger next business process
    }
}
```

### Why dangerous

- JSL does not show real behavior.
- Testing becomes indirect.
- Retry/restart semantics unclear.
- Listener ordering may surprise.
- Business failure becomes lifecycle failure.

### Better

Use listener for:

- metrics
- audit hook
- notification intent
- cleanup
- diagnostics

Put business work in:

- batchlet
- item processor/writer
- explicit step
- explicit outbox event

---

## Anti-Pattern 7 — Over-Partitioning

### Shape

```text
partition count = 500
DB pool = 50
external API limit = 300/min
```

### Why dangerous

- DB pool exhaustion
- lock contention
- downstream 429
- context switching overhead
- skew amplified
- harder restart

### Better

Partition count should be derived from bottleneck capacity.

```text
safe partition count <= min(DB capacity, API capacity, CPU capacity, memory capacity, fairness budget)
```

---

## Anti-Pattern 8 — Job XML Spaghetti

### Shape

JSL contains many tangled transitions, unclear exit statuses, hidden decision logic, and overloaded steps.

### Why dangerous

- hard to reason
- hard to operate
- hard to audit
- hard to restart safely
- wrong tool for business workflow

### Better

- keep JSL as execution graph
- use stable exit status contract
- avoid too many conditional branches
- move long-running human/business workflow to workflow engine

### Heuristic

If you need BPMN-like semantics, Jakarta Batch may not be enough.

---

## Anti-Pattern 9 — Ignoring Stop/Restart Semantics

### Shape

```java
public String process() {
    while (true) {
        doWork();
    }
}
```

No stop check. No checkpoint. No safe boundary.

### Why dangerous

- operator cannot stop gracefully
- shutdown kills work mid-effect
- restart duplicates or skips
- batch window spills over

### Better

- cooperative stop
- chunk/checkpoint
- deadline check
- state machine
- idempotency

---

## Anti-Pattern 10 — Treating Virtual Threads as Infinite Capacity

### Shape

```text
Use virtual threads
Therefore launch 100,000 external API calls
```

### Why dangerous

Virtual threads reduce thread cost, not downstream cost.

Bottlenecks remain:

- DB connections
- API limits
- CPU
- memory
- locks
- transaction log
- object allocation
- remote SLA

### Better

Use virtual threads with explicit capacity control.

```text
virtual threads + semaphore/bulkhead/rate limit + managed lifecycle
```

---

## Anti-Pattern 11 — Holding Request Context Beyond Request Lifetime

### Shape

```java
class AsyncTask implements Runnable {
    @Inject HttpServletRequest request;
    public void run() {
        use(request.getUserPrincipal());
    }
}
```

### Why dangerous

- request context may be invalid
- session may expire
- object may not be thread-safe
- identity semantics unclear

### Better

Capture minimal durable facts:

```text
userId, roles snapshot if appropriate, requestId, reason, tenantId, parameters
```

Then re-authorize as needed at execution time.

---

## Anti-Pattern 12 — Authorization Only at Execution Time

### Problem

User submits job while authorized. Later role changes. Should job still run?

### Incorrect simplification

Only check at execution time or only check at enqueue time.

### Better

Define policy explicitly:

| Action | Check |
|---|---|
| submit job | requester has permission to request |
| approve job | approver has permission to approve |
| execute job | system identity has permission to execute |
| affect record | operation allowed by captured/validated business rule |
| stop/restart | operator has runtime permission |

### Invariant

Authorization is multi-stage for long-running work.

---

## Anti-Pattern 13 — Silent Partial Success

### Shape

Batch completes even though 10% records failed, but nobody knows.

### Why dangerous

- false confidence
- regulatory reporting inaccurate
- missed remediation
- audit gap

### Better

Define partial success status.

```text
COMPLETED
COMPLETED_WITH_SKIPS
COMPLETED_WITH_RETRIES
FAILED_RETRYABLE
FAILED_FINAL
NEEDS_MANUAL_REVIEW
```

---

## Anti-Pattern 14 — Retry Everything

### Shape

```xml
<retryable-exception-classes>
    <include class="java.lang.Exception"/>
</retryable-exception-classes>
```

### Why dangerous

- retries validation failures
- retries permission failures
- retries poison data
- causes retry storm
- hides systemic failure

### Better

Classify exceptions.

| Exception type | Action |
|---|---|
| network timeout | retry with budget |
| 429 | rate-limit/backoff |
| 400 validation | skip/quarantine/fail |
| 401/403 | fail/system intervention |
| optimistic conflict | retry small number or re-read |
| poison record | skip/quarantine |

---

## Anti-Pattern 15 — No Reconciliation for External Side Effects

### Shape

```text
timeout = failure
retry = send again
```

### Why dangerous

Timeout means unknown, not failure.

### Better

Use UNKNOWN state and reconciliation.

---

## Anti-Pattern 16 — One Executor for Everything

### Shape

```text
all async work -> defaultManagedExecutor
```

### Why dangerous

- no isolation
- no workload-specific metrics
- no fairness
- no capacity governance

### Better

Use workload-specific managed executors or logical bulkheads.

---

## Anti-Pattern 17 — Batch as Workflow Engine

### Shape

Batch job models complex human approvals, waits days, has many manual branches, compensation, escalation timers, and business process state.

### Why dangerous

Jakarta Batch is good for computational/data processing jobs, not necessarily long-running human business processes.

### Better

Use workflow/BPMN engine for human/process lifecycle, and call Jakarta Batch for heavy data-processing steps.

---

## Anti-Pattern 18 — Workflow Engine as Batch Engine

### Shape

Workflow engine loops over millions of records one by one.

### Why dangerous

- huge process instance overhead
- poor throughput
- difficult bulk tuning
- workflow history explosion

### Better

Workflow orchestrates. Batch processes.

```text
Workflow: approve bulk operation
Batch: process 5 million records
Workflow: handle result/manual remediation
```

---

## Anti-Pattern 19 — Metrics Without Labels or Meaning

### Shape

```text
job.duration = 3600
```

No job name, partition, status, downstream, failure class.

### Better

Metrics should answer operational questions.

```text
batch.step.duration{job="case-ageing", step="evaluate", status="success"}
batch.item.skipped{job="registry-sync", reason="validation"}
async.task.rejected{executor="external-api", workload="onemap-sync"}
```

---

## Anti-Pattern 20 — Audit as Log File

### Shape

```text
INFO user started batch
INFO batch done
```

### Why insufficient

Logs are not structured business evidence.

### Better

Audit table/event with:

- actor
- action
- target
- parameters hash
- input manifest
- job request ID
- job execution ID
- before/after state if relevant
- result
- failure reason
- timestamp
- correlation ID

---

# 7. Pattern Selection Framework

Use this framework before choosing a design.

## 7.1 Question 1 — Is the work durable?

```text
Can this work be lost if JVM crashes?
```

If no, managed executor may be enough.

If yes, persist a job request/outbox/message/batch execution.

## 7.2 Question 2 — Is the work restartable?

```text
Can we continue after partial completion?
```

If yes, design checkpoint.

If no, design idempotent restart from beginning or fail-fast manual recovery.

## 7.3 Question 3 — Is the side effect external?

```text
Can database rollback undo it?
```

If no, use outbox/idempotency/reconciliation.

## 7.4 Question 4 — Is the input set stable?

```text
Can records change while job runs?
```

If yes, consider snapshot input set.

## 7.5 Question 5 — Is the job regulated/audited?

```text
Will someone ask who did what, based on which input, and why?
```

If yes, design audit first.

## 7.6 Question 6 — Is parallelism bottleneck-aware?

```text
What resource becomes saturated first?
```

Parallelism must respect bottleneck.

## 7.7 Question 7 — Is stop behavior defined?

```text
What happens when operator stops the job?
```

If answer is unclear, job is not production-ready.

---

# 8. Composite Architecture Examples

## 8.1 Regulatory case ageing recalculation

### Requirements

- nightly
- millions of cases
- deterministic input
- restartable
- audit summary
- no external side effect

### Recommended pattern composition

```text
Cluster Singleton Scheduler
+ Durable Job Request
+ Snapshot Input Set
+ Jakarta Batch Chunk Step
+ Resumable Reader
+ Idempotent Writer
+ Explicit Exit Status Contract
+ Operational Dashboard
```

### Why

Work is large, stateful, and must be restartable. Jakarta Batch fits.

---

## 8.2 External registry synchronization

### Requirements

- call external API
- rate limited
- uncertain timeout
- reconcile status
- record-level error handling

### Pattern composition

```text
Durable Job Request
+ Snapshot Input Set
+ Partitioning with Rate Limit
+ Outbox-Driven Batch
+ Idempotent Writer
+ Retry Budget
+ Reconciliation Job
+ Poison Record Quarantine
```

### Why

External side effects require outbox/idempotency/reconciliation, not direct blind retry.

---

## 8.3 User-triggered export report

### Requirements

- user starts export
- long-running
- downloadable artifact
- status visible
- duplicate prevention

### Pattern composition

```text
Durable Job Request
+ Batch Control Plane
+ Batchlet or Chunk Step
+ Checkpointed File Export
+ Idempotent Artifact Naming
+ Audit Event
+ Dashboard Status
```

### Why

The user should not wait on request thread. The artifact should be generated durably.

---

## 8.4 Short request enrichment

### Requirements

- call 3 internal services
- response deadline 2 seconds
- no durable need

### Pattern composition

```text
Managed Async Command or Fan-Out/Fan-In
+ ManagedExecutorService
+ Timeout
+ Cancellation
+ Partial Result Policy
+ Metrics
```

### Why

Durable batch would be overkill. But executor/context/deadline still matter.

---

# 9. Java 8–25 Considerations

## 9.1 Java 8 baseline

Available:

- `ExecutorService`
- `Future`
- `CompletableFuture`
- parallel streams
- Java EE/Jakarta managed concurrency depending on server

Risk:

- common pool misuse
- parallel stream inside container
- no virtual threads

Recommendation:

- Use `ManagedExecutorService` explicitly.
- Avoid implicit async executor.
- Keep task small and bounded.

## 9.2 Java 11/17 era

Improvements:

- better runtime ergonomics
- better GC options
- stronger TLS/security defaults
- production baseline for many Jakarta servers

Recommendation:

- Keep same managed concurrency principles.
- Improve observability and GC tuning.

## 9.3 Java 21 era

Major addition:

- virtual threads final

Impact:

- blocking workload can scale better
- thread-per-task model becomes viable again in Java SE
- but Jakarta EE still needs container-managed lifecycle/context

Recommendation:

- Use virtual threads only through managed resources/server-supported configuration where possible.
- Still enforce DB/API concurrency limits.

## 9.4 Java 25 era

Relevant features:

- structured concurrency preview
- scoped values
- virtual thread observability improvements from recent JDK evolution

Recommendation:

- Learn mental model.
- Use cautiously in portable Jakarta EE code.
- Do not base enterprise portability on preview APIs unless platform policy allows.

---

# 10. Jakarta/Javax Migration Considerations

## 10.1 Namespace migration

Older Java EE APIs use:

```java
javax.enterprise.concurrent.ManagedExecutorService
javax.batch.api.Batchlet
```

Jakarta EE uses:

```java
jakarta.enterprise.concurrent.ManagedExecutorService
jakarta.batch.api.Batchlet
```

## 10.2 Migration risks

- dependency mismatch
- server version mismatch
- classpath contains both `javax` and `jakarta`
- third-party library still on old namespace
- batch repository schema differences by implementation
- JSL artifact names or injection behavior changes

## 10.3 Strategy

- Identify platform target first.
- Align dependencies with server runtime.
- Avoid mixing `javax` and `jakarta` in same module unless isolated.
- Test batch restart across migration.
- Test executor/context behavior after migration.

---

# 11. Best Practices Checklist

## 11.1 Managed concurrency checklist

- [ ] No unmanaged `new Thread()` for application work.
- [ ] No accidental `ForkJoinPool.commonPool()` for container workload.
- [ ] Executor is managed and workload-specific where needed.
- [ ] Queue is bounded.
- [ ] Rejection policy is explicit.
- [ ] Timeout is explicit.
- [ ] Cancellation is cooperative.
- [ ] Context propagation is intentional.
- [ ] Transaction does not cross async boundary accidentally.
- [ ] Metrics exist for active, queued, completed, failed, rejected, cancelled.

## 11.2 Batch checklist

- [ ] Job parameters are validated.
- [ ] Job request is durable if business-critical.
- [ ] Duplicate launch is prevented.
- [ ] Input set is stable or mutation-safe.
- [ ] Reader checkpoint is deterministic.
- [ ] Writer is idempotent.
- [ ] External side effects use outbox/idempotency/reconciliation.
- [ ] Skip/retry rules are classified.
- [ ] Stop/restart behavior is tested.
- [ ] Partitioning respects bottleneck capacity.
- [ ] Exit statuses are documented.
- [ ] Audit evidence is structured.
- [ ] Dashboard exposes progress and failure causes.

## 11.3 Compliance checklist

- [ ] Who requested the job?
- [ ] Who approved it?
- [ ] Who executed it?
- [ ] What parameters were used?
- [ ] What input set was processed?
- [ ] Which records succeeded?
- [ ] Which records skipped/failed?
- [ ] What side effects were produced?
- [ ] What evidence is retained?
- [ ] Can the job be reconstructed later?

---

# 12. Testing Strategy for Patterns

## 12.1 Tests for idempotency

Run writer twice with same item.

Expected:

- one logical effect
- duplicate suppressed
- no corrupted state

## 12.2 Tests for restartability

Simulate failure after N chunks.

Expected:

- restart resumes from checkpoint
- no lost item
- duplicate item harmless

## 12.3 Tests for duplicate launch

Submit same job twice concurrently.

Expected:

- one accepted
- one deduplicated/rejected

## 12.4 Tests for stop

Stop job during processing.

Expected:

- stop observed at safe point
- state is STOPPED
- restart continues safely

## 12.5 Tests for downstream failure

Simulate:

- timeout
- 429
- 500
- 400
- unknown response

Expected:

- classification correct
- retry budget respected
- poison records quarantined
- unknown states reconciled

## 12.6 Tests for cluster duplicate

Run two nodes/schedulers.

Expected:

- only one job request created or claimed
- lease behavior observable
- stale lease recovers

---

# 13. Design Review Questions

Use these questions in architecture review.

1. What exactly is the unit of work?
2. Is the unit of work durable?
3. What happens if the JVM dies after half the work?
4. What happens if the user submits the same request twice?
5. What is the transaction boundary?
6. What external side effects exist?
7. Is each side effect idempotent?
8. What is the checkpoint?
9. What is the stop boundary?
10. What is the retry budget?
11. What is classified as poison data?
12. What happens if downstream returns unknown result?
13. How is parallelism bounded?
14. What resource is the bottleneck?
15. How are request workloads protected from batch workloads?
16. What is the audit evidence?
17. What dashboard tells us job is stuck?
18. What is the manual remediation path?
19. What is the cluster ownership model?
20. What makes this design safe during redeploy?

If a team cannot answer these, it has not designed workload orchestration yet. It has only written async code.

---

# 14. Compact Pattern-to-Problem Matrix

| Problem | Recommended pattern |
|---|---|
| Short async offload | Managed Async Command |
| Long-running user-triggered job | Durable Job Request |
| DB + external API side effect | Outbox-Driven Batch |
| Retry/restart duplicates | Idempotent Writer |
| Large restartable input | Resumable Reader |
| Large file ingestion | Checkpointed File Ingestion |
| Concurrent service calls | Fan-Out/Fan-In with Bounded Executor |
| Workload interference | Bulkhead Executor |
| Cluster duplicate schedule | Cluster Singleton Scheduler |
| Admin start/stop/restart | Batch Control Plane |
| Complex JSL routing | Explicit Exit Status Contract |
| Retry storm | Retry Budget |
| Bad input record | Poison Record Quarantine |
| Uncertain external result | Reconciliation Job |
| Mutable input set | Snapshot Input Set |
| Multi-node claiming | Work Claiming with Lease |
| Lost correlation | Application-Level Correlation Envelope |
| Unstoppable job | Stop-Aware Processor |
| Poor operations visibility | Operational Dashboard |
| Non-rollbackable side effect | Compensation Path |

---

# 15. Thought Experiment

Imagine a regulatory platform needs a new feature:

> Every night, evaluate all active cases. If a case breaches SLA, escalate it, generate a notice, and notify an external registry. Some cases may have invalid data. External registry has a rate limit of 300 requests/minute. Operators must be able to stop and restart the job. Audit must prove which cases were processed and why.

A weak design:

```text
Scheduled method runs every night.
It queries all active cases.
It loops through them.
It updates DB and calls API.
It logs failures.
```

A stronger design:

```text
Cluster Singleton Scheduler
    -> Durable Job Request
    -> Snapshot Input Set
    -> Jakarta Batch partitioned chunk step
    -> Idempotent escalation writer
    -> Outbox event for registry notification
    -> External API dispatcher with rate limit
    -> Poison record quarantine
    -> Reconciliation job for unknown API results
    -> Explicit exit status
    -> Structured audit evidence
    -> Operational dashboard
```

The second design is more complex. But the complexity is not accidental. It corresponds to real production requirements:

- duplicate prevention
- restartability
- auditability
- external side-effect safety
- rate-limit compliance
- operator control
- remediation

Top-tier engineering is not about making every design complex. It is about putting complexity exactly where the failure model requires it.

---

# 16. Summary

Design patterns in Jakarta Concurrency and Jakarta Batch are not about memorizing API usage. They are about preserving system invariants under real production conditions.

Key conclusions:

1. Use managed concurrency when execution is asynchronous but still belongs inside Jakarta EE container lifecycle.
2. Use Jakarta Batch when work is long-running, stateful, restartable, and operationally controlled.
3. Use durable job request when business intent must survive process failure and be governed.
4. Use outbox when database transaction and external side effect cannot be atomic together.
5. Use idempotent writer because retry/restart/partition failure will eventually happen.
6. Use resumable reader and checkpointing because large jobs cannot safely restart from scratch without careful design.
7. Use bulkheads because background work must not consume all shared capacity.
8. Use cluster singleton/lease/unique keys because scheduled jobs in clusters duplicate easily.
9. Use explicit exit statuses because batch graph routing is an operational contract.
10. Avoid anti-patterns that work on happy path but fail during redeploy, restart, overload, partial failure, or audit review.

The central mental model:

```text
Concurrency gives execution.
Batch gives stateful progress.
Patterns give safety.
Operations give control.
Audit gives defensibility.
```

---

# 17. Latihan

## Latihan 1 — Pattern selection

Untuk tiap workload berikut, pilih pattern yang cocok dan jelaskan alasannya:

1. Refresh cache setelah konfigurasi berubah.
2. Generate 500.000 PDF notice.
3. Sync data license holder ke external registry dengan 429 rate limit.
4. Export report besar yang diminta user.
5. Recalculate case SLA setiap malam.
6. Call 4 service internal untuk enrich response API.
7. Process CSV 2 GB dari agency eksternal.
8. Stop job yang sudah memproses 70% record.

## Latihan 2 — Anti-pattern diagnosis

Diberikan desain:

```text
A scheduled job runs in every pod.
Each pod queries pending records.
Each pod calls external API directly.
Failures are logged.
Retry is configured for all exceptions.
No unique key exists.
No checkpoint exists.
```

Identifikasi minimal 10 risiko production.

## Latihan 3 — Design correction

Ubah desain di atas menjadi desain production-grade menggunakan pattern dari bagian ini.

## Latihan 4 — Audit defensibility

Untuk batch “bulk enforcement escalation”, definisikan audit fields yang wajib ada agar bisa menjawab:

- siapa yang meminta
- siapa yang menyetujui
- input mana yang diproses
- rule mana yang dipakai
- record mana yang berubah
- notice mana yang dikirim
- external registry call mana yang berhasil/gagal
- bagaimana restart dilakukan

---

# 18. Penutup Part 33

Part ini menyelesaikan katalog pattern dan anti-pattern untuk Jakarta Concurrency dan Jakarta Batch.

Setelah ini, seri masuk ke bagian end-to-end case study. Di sana pattern-pattern ini akan digabungkan menjadi satu desain menyeluruh untuk workload orchestration di sistem regulatory case management.

Status seri: **belum selesai**.

Bagian berikutnya:

```text
Part 34 — End-to-End Case Study: Regulatory Case Management Workload Orchestration
File: 34-end-to-end-case-study-regulatory-case-management-workload-orchestration.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 32 — Security, Audit, and Compliance for Batch Workloads](./32-security-audit-compliance-batch-workloads.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 34 — End-to-End Case Study: Regulatory Case Management Workload Orchestration](./34-end-to-end-case-study-regulatory-case-management-workload-orchestration.md)

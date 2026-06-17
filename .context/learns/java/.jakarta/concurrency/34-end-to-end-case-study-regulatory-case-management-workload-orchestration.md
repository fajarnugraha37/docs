# Part 34 — End-to-End Case Study: Regulatory Case Management Workload Orchestration

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `34-end-to-end-case-study-regulatory-case-management-workload-orchestration.md`  
> Scope: Java 8–25, Java EE/Jakarta EE, Jakarta Concurrency, Jakarta Batch, production-grade regulatory case management workload orchestration.

---

## 1. Tujuan Pembelajaran

Pada bagian sebelumnya kita sudah membahas primitive dan konsep secara terpisah: managed executor, context propagation, transaction boundary, security identity, observability, failure modes, Jakarta Batch job model, chunk, checkpoint, skip/retry, partitioning, external API batch, clustered execution, performance, compliance, dan pattern/anti-pattern.

Bagian ini menyatukan semuanya ke dalam satu studi kasus end-to-end.

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Mendesain workload orchestration untuk sistem regulatori/case management yang aman secara teknis dan defensible secara audit.
2. Memilih execution model yang tepat antara request thread, managed executor, Jakarta Batch, durable job request, outbox, scheduler, dan external orchestrator.
3. Menerjemahkan business requirement seperti “nightly ageing”, “external registry sync”, “bulk correspondence”, dan “enforcement escalation” menjadi job graph yang restartable dan observable.
4. Mendesain control plane batch yang punya authorization, approval, duplicate prevention, stop/restart semantics, dan audit trail.
5. Mendesain data plane batch yang punya checkpointing, idempotency, transaction boundary, retry classification, rate limit control, dan reconciliation.
6. Membuat failure simulation matrix untuk membuktikan sistem tahan terhadap DB timeout, API 429, pod restart, duplicate job request, partial writer failure, dan deployment interruption.
7. Menghasilkan mental model production-grade: batch bukan loop besar, async bukan sekadar thread, dan orchestration bukan sekadar schedule.

---

## 2. Problem yang Diselesaikan

Bayangkan sebuah platform regulatory case management. Sistem ini mengelola lifecycle kasus enforcement dari intake sampai closure. Ada banyak entity yang saling terkait:

- case
- complaint
- inspection
- investigation
- enforcement action
- correspondence
- party/person/entity profile
- risk score
- ageing/SLA
- escalation
- audit trail
- external registry reference
- document artifact
- notification
- officer/team assignment

Sistem harus menjalankan beberapa workload background besar:

1. **Nightly case ageing recalculation**  
   Menghitung ulang umur kasus, SLA state, warning threshold, overdue state, dan escalation candidate.

2. **External registry sync**  
   Menyinkronkan data entity/person/company dari external registry atau government API, dengan rate limit dan token lifecycle.

3. **Bulk correspondence generation**  
   Membuat surat/notifikasi untuk case yang memenuhi kriteria tertentu, menghasilkan document artifact, lalu mengirim notification secara terkendali.

4. **Enforcement escalation evaluation**  
   Mengevaluasi rule escalation lintas module: misalnya overdue + high risk + repeated non-compliance + no active appeal.

5. **Audit-safe restart and recovery**  
   Jika job gagal di tengah, restart tidak boleh membuat duplicate notification, duplicate escalation, duplicate document, atau audit attribution yang hilang.

Problem ini terlihat seperti “batch processing”. Tapi secara production, ini adalah kombinasi:

- durable job request
- Jakarta Batch job graph
- chunk-oriented DB processing
- partitioning
- managed async fan-out
- outbox pattern
- external API integration
- retry/backoff/rate limit
- audit/evidence generation
- operational control plane
- reconciliation

Kalau salah desain, failure yang muncul biasanya bukan compile error. Failure-nya berupa:

- case dieskalasi dua kali
- surat terkirim dua kali
- audit mengatakan user A memulai job, tapi actual side effect berjalan sebagai anonymous/system tanpa attribution
- job terlihat completed, tapi sebagian data gagal diproses
- restart mengulang external API side effect
- batch mengunci table case dan mengganggu online users
- scheduler berjalan di semua pod sehingga job duplicate
- partitioning mempercepat sampai DB connection pool jebol
- retry storm membuat external API memblokir sistem

---

## 3. Mental Model Utama

### 3.1 Workload orchestration adalah koordinasi stateful, bukan sekadar eksekusi kode

Kode seperti ini tampak sederhana:

```java
for (Case c : cases) {
    recalculateAgeing(c);
    if (shouldEscalate(c)) {
        escalate(c);
    }
}
```

Tetapi production workload membutuhkan jawaban atas pertanyaan:

- Kalau proses mati setelah 60% item selesai, lanjut dari mana?
- Kalau item ke-100 gagal karena data invalid, apakah seluruh job gagal?
- Kalau external API timeout setelah menerima request tapi sebelum kita menerima response, apakah aman retry?
- Kalau officer stop job, apakah job berhenti segera atau setelah chunk selesai?
- Kalau dua admin start job yang sama, siapa yang menang?
- Kalau job berjalan saat deployment, apakah pod termination menyebabkan partial state?
- Kalau batch mengubah SLA state, apakah audit trail bisa menjelaskan alasan dan versi rule yang dipakai?

Top-tier engineer melihat batch sebagai **state machine besar**.

Setiap job punya:

```text
REQUESTED -> APPROVED -> STARTING -> RUNNING -> STOPPING -> STOPPED
                                      |          
                                      +-> COMPLETED
                                      +-> FAILED
                                      +-> ABANDONED
```

Setiap item juga punya lifecycle:

```text
DISCOVERED -> CLAIMED -> PROCESSING -> SUCCEEDED
                         |            
                         +-> RETRYABLE_FAILED
                         +-> PERMANENT_FAILED
                         +-> SKIPPED
                         +-> COMPENSATION_REQUIRED
```

Setiap external side effect punya lifecycle:

```text
INTENT_RECORDED -> DISPATCHING -> ACKNOWLEDGED
                    |            
                    +-> RETRY_PENDING
                    +-> DEAD_LETTERED
                    +-> RECONCILIATION_REQUIRED
```

### 3.2 Ada tiga plane yang harus dipisahkan

Untuk workload enterprise, pisahkan desain menjadi tiga plane.

#### 1. Control plane

Control plane menjawab:

- siapa boleh start job?
- parameter apa yang valid?
- apakah perlu approval?
- apakah job boleh berjalan sekarang?
- apakah job yang sama sudah running?
- bagaimana stop/restart/abandon dilakukan?
- bagaimana operator melihat status?
- bagaimana audit action operator dicatat?

#### 2. Data plane

Data plane menjawab:

- item apa yang diproses?
- bagaimana item diklaim?
- bagaimana transaction boundary?
- bagaimana checkpoint?
- bagaimana idempotency?
- bagaimana retry/skip?
- bagaimana side effect dikontrol?
- bagaimana result dicatat?

#### 3. Observability/evidence plane

Observability/evidence plane menjawab:

- apa correlation ID job?
- berapa item sukses/gagal/skipped?
- item mana yang gagal dan kenapa?
- rule version apa yang dipakai?
- input manifest apa?
- output artifact apa?
- siapa yang request/approve/execute?
- kapan mulai/selesai?
- bagaimana membuktikan tidak ada duplicate side effect?

Kesalahan umum adalah mencampur semua hal ini dalam satu method `runNightlyJob()`.

---

## 4. Case Study Domain

Kita akan memakai domain berikut.

### 4.1 Entity utama

```text
CASE_FILE
- case_id
- case_no
- status
- risk_level
- assigned_team_id
- assigned_officer_id
- opened_at
- closed_at
- current_sla_state
- current_ageing_days
- current_escalation_level
- version
- updated_at

CASE_MILESTONE
- milestone_id
- case_id
- milestone_type
- milestone_date
- created_at

CASE_ESCALATION
- escalation_id
- case_id
- escalation_level
- reason_code
- rule_version
- effective_at
- created_by
- idempotency_key
- created_at

CASE_CORRESPONDENCE
- correspondence_id
- case_id
- template_code
- recipient_id
- document_id
- status
- idempotency_key
- created_at

EXTERNAL_REGISTRY_SYNC_STATE
- entity_id
- registry_type
- last_synced_at
- sync_status
- external_version
- retry_count
- next_retry_at

BATCH_JOB_REQUEST
- request_id
- job_name
- business_key
- requested_by
- approved_by
- status
- parameters_json
- idempotency_key
- requested_at
- approved_at
- started_at
- completed_at
- jakarta_execution_id

BATCH_ITEM_RESULT
- result_id
- request_id
- item_type
- item_key
- partition_id
- status
- attempt_count
- error_code
- error_message
- before_hash
- after_hash
- idempotency_key
- created_at
- updated_at

OUTBOX_EVENT
- event_id
- aggregate_type
- aggregate_id
- event_type
- payload_json
- idempotency_key
- status
- attempt_count
- next_retry_at
- created_at
- dispatched_at
```

### 4.2 Workload yang akan didesain

Kita akan membangun job bernama:

```text
regulatory-nightly-orchestration
```

Job ini terdiri dari beberapa tahap:

1. Validate job request and capture execution context.
2. Discover eligible cases.
3. Recalculate case ageing.
4. Evaluate enforcement escalation.
5. Generate correspondence intent.
6. Dispatch external registry sync requests through controlled outbox/API integration.
7. Generate summary report and evidence manifest.

Kita tidak akan membuat semua side effect terjadi langsung di satu transaksi besar. Prinsipnya:

> Batch job boleh menentukan intent dan state transition, tetapi side effect eksternal harus durable, idempotent, observable, dan bisa direkonsiliasi.

---

## 5. Architecture Overview

### 5.1 Text diagram

```text
+-----------------------+
| Admin / Scheduler     |
+-----------+-----------+
            |
            v
+-----------------------+
| Batch Control Plane   |
| - authz               |
| - validation          |
| - duplicate check     |
| - approval            |
| - audit               |
+-----------+-----------+
            |
            | JobOperator.start(job, params)
            v
+-------------------------------+
| Jakarta Batch Runtime         |
| Job: regulatory-nightly-*     |
|                               |
| Step 1 validate request       |
| Step 2 discover candidates    |
| Step 3 ageing chunk step      |
| Step 4 escalation chunk step  |
| Step 5 correspondence intent  |
| Step 6 registry sync intent   |
| Step 7 summary/evidence       |
+---------------+---------------+
                |
                v
+-------------------------------+
| Database                      |
| - CASE_FILE                   |
| - BATCH_JOB_REQUEST           |
| - BATCH_ITEM_RESULT           |
| - OUTBOX_EVENT                |
| - AUDIT_TRAIL                 |
+---------------+---------------+
                |
                v
+-------------------------------+
| Outbox Dispatcher             |
| - ManagedExecutorService      |
| - rate limit                  |
| - retry/backoff               |
| - idempotency                 |
| - circuit breaker             |
+---------------+---------------+
                |
                v
+-------------------------------+
| External Systems              |
| - registry API                |
| - notification gateway        |
| - document service            |
+-------------------------------+
```

### 5.2 Kenapa outbox dipisahkan dari batch?

Karena batch job dan external API punya reliability model berbeda.

Batch DB update bisa dikontrol dengan transaction + checkpoint. External API tidak bisa di-rollback oleh database transaction.

Kalau batch melakukan ini langsung:

```java
updateCase();
externalApi.sendLetter();
commit();
```

maka ada window berbahaya:

- API sukses, DB commit gagal: external side effect terjadi tanpa state lokal.
- DB commit sukses, API timeout: tidak jelas apakah external side effect terjadi.
- Job restart: kemungkinan mengirim ulang.

Outbox mengubah pola menjadi:

```text
DB transaction:
  update case
  insert outbox intent with idempotency key
commit

Separate dispatcher:
  read pending outbox
  call external API with idempotency key
  mark dispatched/failed/retry
```

Ini membuat side effect menjadi:

- durable
- retryable
- observable
- idempotent
- auditable
- reconcilable

---

## 6. Control Plane Design

### 6.1 REST endpoint untuk start job

Contoh endpoint:

```http
POST /internal/batch/job-requests
Content-Type: application/json
Authorization: Bearer <token>

{
  "jobName": "regulatory-nightly-orchestration",
  "businessDate": "2026-06-17",
  "scope": {
    "teamIds": ["ENF-A", "ENF-B"],
    "riskLevels": ["HIGH", "MEDIUM"]
  },
  "dryRun": false,
  "reason": "Nightly SLA and enforcement recalculation"
}
```

Endpoint ini **tidak langsung menjalankan business loop**. Ia membuat durable request.

### 6.2 Validasi control plane

Validasi minimal:

1. Caller punya permission start job.
2. Job name terdaftar.
3. Parameter valid secara schema.
4. Business date tidak ambigu.
5. Scope tidak terlalu luas tanpa approval.
6. Tidak ada job yang sama sedang running untuk business key yang sama.
7. Dry-run mode jelas.
8. Reason wajib.
9. Idempotency key dihitung deterministik.

Contoh business key:

```text
jobName + businessDate + scopeHash + dryRun
```

Contoh idempotency key:

```text
SHA-256("regulatory-nightly-orchestration|2026-06-17|scopeHash|dryRun=false")
```

### 6.3 Duplicate launch prevention

Buat unique constraint:

```sql
CREATE UNIQUE INDEX UK_BATCH_JOB_REQUEST_IDEMP
ON BATCH_JOB_REQUEST (idempotency_key);
```

Lalu flow:

```text
try insert job request
  if success -> created
  if unique violation -> return existing request
```

Ini lebih aman daripada:

```text
select existing
if not found insert
```

karena select-then-insert race condition di cluster.

### 6.4 Start Jakarta Batch job

Pseudo-code:

```java
@RequestScoped
@Path("/internal/batch/job-requests")
public class BatchControlResource {

    @Inject
    JobRequestService jobRequestService;

    @Inject
    jakarta.batch.operations.JobOperator jobOperator;

    @POST
    @Transactional
    public Response createJobRequest(StartJobRequest req) {
        AuthenticatedUser caller = requireAuthorizedUser("BATCH_START");

        JobRequest saved = jobRequestService.createOrReturnExisting(req, caller);

        if (saved.isAlreadyStarted()) {
            return Response.status(200).entity(saved.toDto()).build();
        }

        Properties params = new Properties();
        params.setProperty("requestId", saved.requestId().toString());
        params.setProperty("businessDate", req.businessDate().toString());
        params.setProperty("dryRun", String.valueOf(req.dryRun()));
        params.setProperty("correlationId", saved.correlationId());
        params.setProperty("requestedBy", caller.userId());

        long executionId = jobOperator.start("regulatory-nightly-orchestration", params);

        jobRequestService.markStarted(saved.requestId(), executionId);

        return Response.accepted(saved.toDto()).build();
    }
}
```

Catatan penting:

- Pada implementasi nyata, perlu hati-hati menaruh `jobOperator.start()` di dalam transaction method. Beberapa sistem lebih aman membuat request dulu, commit, lalu start job melalui dispatcher/control worker agar tidak terjadi mismatch jika transaction rollback setelah `start()`.
- Untuk production defensibility, lebih baik memakai state `APPROVED` lalu background control-plane executor memulai job dan menulis `jakarta_execution_id` setelah start sukses.

### 6.5 Safer control-plane sequence

```text
POST request
  validate
  insert BATCH_JOB_REQUEST status=REQUESTED/APPROVED
  commit

Control-plane launcher
  claim APPROVED request
  call JobOperator.start
  update status=RUNNING, execution_id=...
```

Keuntungan:

- request durable sebelum job start
- failure start bisa diretry
- tidak ada side effect batch start yang menggantung pada HTTP transaction
- lebih mudah audit dan approval

---

## 7. Job Graph Design

### 7.1 JSL high-level graph

```xml
<job id="regulatory-nightly-orchestration" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">

    <properties>
        <property name="jobType" value="REGULATORY_NIGHTLY"/>
    </properties>

    <step id="validate-request" next="discover-candidates">
        <batchlet ref="validateRequestBatchlet"/>
    </step>

    <step id="discover-candidates" next="ageing-recalculation">
        <batchlet ref="discoverCandidatesBatchlet"/>
    </step>

    <step id="ageing-recalculation" next="escalation-evaluation">
        <chunk item-count="100">
            <reader ref="caseAgeingReader"/>
            <processor ref="caseAgeingProcessor"/>
            <writer ref="caseAgeingWriter"/>
        </chunk>
    </step>

    <step id="escalation-evaluation" next="correspondence-intent">
        <chunk item-count="50">
            <reader ref="escalationCandidateReader"/>
            <processor ref="escalationProcessor"/>
            <writer ref="escalationWriter"/>
        </chunk>
    </step>

    <step id="correspondence-intent" next="registry-sync-intent">
        <chunk item-count="50">
            <reader ref="correspondenceCandidateReader"/>
            <processor ref="correspondenceIntentProcessor"/>
            <writer ref="correspondenceIntentWriter"/>
        </chunk>
    </step>

    <step id="registry-sync-intent" next="generate-evidence-report">
        <chunk item-count="100">
            <reader ref="registrySyncCandidateReader"/>
            <processor ref="registrySyncIntentProcessor"/>
            <writer ref="registrySyncIntentWriter"/>
        </chunk>
    </step>

    <step id="generate-evidence-report">
        <batchlet ref="evidenceReportBatchlet"/>
    </step>

</job>
```

### 7.2 Kenapa graph dibuat sequential?

Tidak semua hal harus diparalelkan.

Urutan di atas mempertahankan invariant:

1. Candidate discovery harus selesai sebelum ageing recalculation.
2. Escalation evaluation bergantung pada ageing state terbaru.
3. Correspondence intent bergantung pada escalation result.
4. Registry sync intent dapat bergantung pada entity yang terlibat dalam candidate.
5. Evidence report harus dibuat setelah semua step utama selesai.

Kalau ada step yang independen, split bisa digunakan. Namun split tidak otomatis lebih baik. Ia menambah:

- resource contention
- failure complexity
- evidence aggregation complexity
- cancellation complexity
- transaction pressure

### 7.3 Candidate table

Daripada setiap step melakukan query besar sendiri, step discovery membuat snapshot kandidat:

```sql
CREATE TABLE BATCH_CASE_CANDIDATE (
    request_id        VARCHAR2(36) NOT NULL,
    case_id           VARCHAR2(36) NOT NULL,
    case_no           VARCHAR2(64) NOT NULL,
    partition_key     VARCHAR2(64),
    risk_level        VARCHAR2(20),
    assigned_team_id  VARCHAR2(64),
    discovered_at     TIMESTAMP NOT NULL,
    status            VARCHAR2(30) NOT NULL,
    PRIMARY KEY (request_id, case_id)
);
```

Keuntungan snapshot candidate:

- job punya input manifest stabil
- restart tidak berubah karena data baru masuk
- audit bisa menjelaskan item yang dipilih
- partitioning lebih deterministic
- performance query lebih predictable

Trade-off:

- membutuhkan storage tambahan
- perlu cleanup/retention
- perlu jelas apakah batch memproses snapshot atau live data

Untuk sistem regulatori, snapshot sering lebih defensible daripada query live yang berubah-ubah selama job berjalan.

---

## 8. Step 1 — Validate Request Batchlet

### 8.1 Responsibility

`validate-request` memastikan request masih valid saat job mulai.

Kenapa perlu divalidasi ulang? Karena ada gap antara request dibuat dan job dieksekusi. Dalam gap itu:

- user permission bisa berubah
- job bisa dibatalkan
- business date bisa ditutup
- maintenance window bisa dimulai
- parameter bisa dianggap invalid oleh rule baru

### 8.2 Pseudo-code

```java
@Named
@Dependent
public class ValidateRequestBatchlet implements Batchlet {

    @Inject
    JobContext jobContext;

    @Inject
    JobRequestRepository jobRequestRepository;

    @Inject
    BatchAuditService auditService;

    @Override
    public String process() {
        String requestId = jobContext.getProperties().getProperty("requestId");
        String correlationId = jobContext.getProperties().getProperty("correlationId");

        JobRequest request = jobRequestRepository.findForUpdate(requestId)
            .orElseThrow(() -> new IllegalStateException("Job request not found: " + requestId));

        if (!request.isRunnable()) {
            auditService.recordJobRejected(requestId, correlationId, request.status(), "Request is not runnable");
            return "INVALID_REQUEST";
        }

        request.markValidated();
        jobRequestRepository.save(request);

        auditService.recordJobValidated(requestId, correlationId);
        return "VALID";
    }

    @Override
    public void stop() {
        // Fast batchlet. No long-running loop here.
    }
}
```

### 8.3 Exit status routing

Dalam JSL, bisa dibuat:

```xml
<step id="validate-request">
    <batchlet ref="validateRequestBatchlet"/>
    <next on="VALID" to="discover-candidates"/>
    <fail on="INVALID_REQUEST" exit-status="REQUEST_INVALID"/>
</step>
```

Jangan membiarkan invalid request jatuh sebagai generic exception bila secara domain ini expected rejection.

---

## 9. Step 2 — Discover Candidates

### 9.1 Responsibility

Step ini menentukan input set job.

Input set harus menjawab:

- case apa yang termasuk?
- berdasarkan rule/filter apa?
- pada waktu kapan snapshot dibuat?
- rule version apa?
- parameter apa?
- apakah dry-run?

### 9.2 Candidate discovery query

Contoh:

```sql
INSERT INTO BATCH_CASE_CANDIDATE (
    request_id,
    case_id,
    case_no,
    partition_key,
    risk_level,
    assigned_team_id,
    discovered_at,
    status
)
SELECT
    :requestId,
    c.case_id,
    c.case_no,
    MOD(ORA_HASH(c.case_id), :partitionCount) AS partition_key,
    c.risk_level,
    c.assigned_team_id,
    SYSTIMESTAMP,
    'DISCOVERED'
FROM CASE_FILE c
WHERE c.status IN ('OPEN', 'UNDER_INVESTIGATION', 'PENDING_ACTION')
  AND c.risk_level IN (:riskLevels)
  AND c.assigned_team_id IN (:teamIds)
  AND NOT EXISTS (
      SELECT 1
      FROM BATCH_CASE_CANDIDATE existing
      WHERE existing.request_id = :requestId
        AND existing.case_id = c.case_id
  );
```

### 9.3 Idempotency discovery

Discovery harus idempotent. Jika batchlet restart, insert tidak boleh duplicate. Gunakan:

- primary key `(request_id, case_id)`
- insert-ignore/merge/upsert sesuai DB
- status candidate yang jelas

### 9.4 Snapshot vs live query

Ada dua model.

#### Snapshot model

Candidate disimpan di table.

Cocok untuk:

- audit ketat
- long-running job
- restartability
- approval-based batch
- regulatory evidence

#### Live query model

Setiap step query langsung dari business table.

Cocok untuk:

- job pendek
- low compliance risk
- data sangat dinamis
- tidak perlu input manifest ketat

Untuk case management regulatori, pilih snapshot model.

---

## 10. Step 3 — Ageing Recalculation Chunk Step

### 10.1 Reader

Reader membaca candidate berdasarkan request ID dan checkpoint terakhir.

Keyset approach:

```java
@Named
@Dependent
public class CaseAgeingReader implements ItemReader {

    @Inject
    JobContext jobContext;

    @Inject
    CaseCandidateRepository candidateRepository;

    private String requestId;
    private String lastCaseId;
    private Iterator<CaseCandidate> buffer = Collections.emptyIterator();

    @Override
    public void open(Serializable checkpoint) {
        this.requestId = jobContext.getProperties().getProperty("requestId");
        this.lastCaseId = checkpoint == null ? null : (String) checkpoint;
    }

    @Override
    public Object readItem() {
        if (!buffer.hasNext()) {
            List<CaseCandidate> next = candidateRepository.fetchNextPage(requestId, lastCaseId, 200);
            if (next.isEmpty()) {
                return null;
            }
            buffer = next.iterator();
        }

        CaseCandidate item = buffer.next();
        lastCaseId = item.caseId();
        return item;
    }

    @Override
    public Serializable checkpointInfo() {
        return lastCaseId;
    }

    @Override
    public void close() {
        // release cursor/resources if any
    }
}
```

Key point:

- checkpoint menyimpan posisi durable
- reader tidak menyimpan semua item di memory
- ordering harus deterministic
- `lastCaseId` harus stabil dan monotonic untuk request tersebut

### 10.2 Processor

Processor menghitung result tanpa side effect.

```java
@Named
@Dependent
public class CaseAgeingProcessor implements ItemProcessor {

    @Inject
    CaseRepository caseRepository;

    @Inject
    SlaRuleService slaRuleService;

    @Override
    public Object processItem(Object item) {
        CaseCandidate candidate = (CaseCandidate) item;

        CaseFile caseFile = caseRepository.find(candidate.caseId())
            .orElseThrow(() -> new CaseMissingException(candidate.caseId()));

        AgeingResult result = slaRuleService.calculate(
            caseFile,
            LocalDate.parse(candidate.businessDate()),
            RuleVersion.current()
        );

        return new AgeingUpdateCommand(
            candidate.caseId(),
            result.ageingDays(),
            result.slaState(),
            result.ruleVersion(),
            deterministicIdempotencyKey(candidate.requestId(), candidate.caseId(), "AGEING")
        );
    }
}
```

Processor idealnya:

- deterministic
- side-effect free
- tidak update DB
- tidak call external API
- menghasilkan command/result

### 10.3 Writer

Writer melakukan update secara idempotent.

```java
@Named
@Dependent
public class CaseAgeingWriter implements ItemWriter {

    @Inject
    CaseRepository caseRepository;

    @Inject
    BatchItemResultRepository resultRepository;

    @Inject
    AuditTrailService auditTrailService;

    @Override
    public void writeItems(List<Object> items) {
        for (Object obj : items) {
            AgeingUpdateCommand cmd = (AgeingUpdateCommand) obj;

            if (resultRepository.alreadySucceeded(cmd.idempotencyKey())) {
                continue;
            }

            CaseFile before = caseRepository.findForUpdate(cmd.caseId())
                .orElseThrow(() -> new CaseMissingException(cmd.caseId()));

            CaseFile after = before.withAgeing(cmd.ageingDays(), cmd.slaState());

            if (!before.sameAgeingAs(after)) {
                caseRepository.save(after);
                auditTrailService.recordCaseAgeingChanged(before, after, cmd.ruleVersion(), cmd.idempotencyKey());
            }

            resultRepository.markSucceeded(
                cmd.requestId(),
                "CASE_AGEING",
                cmd.caseId(),
                cmd.idempotencyKey(),
                hash(before),
                hash(after)
            );
        }
    }

    @Override
    public void open(Serializable checkpoint) {}

    @Override
    public Serializable checkpointInfo() { return null; }

    @Override
    public void close() {}
}
```

### 10.4 Transaction boundary

Setiap chunk harus membentuk transaction boundary kecil:

```text
read/process N items
writer writes N items
commit transaction
checkpoint stored
```

Jika writer gagal di tengah chunk, transaction rollback. Saat restart, chunk dapat diproses ulang. Karena writer idempotent, reprocessing aman.

---

## 11. Step 4 — Enforcement Escalation Evaluation

### 11.1 Domain rule

Contoh rule:

```text
Escalate to Level 1 if:
- case is OPEN/UNDER_INVESTIGATION
- SLA state is WARNING or OVERDUE
- risk level is HIGH or MEDIUM
- no active appeal
- no existing escalation at same level for same reason and rule version
```

### 11.2 Escalation idempotency key

```text
caseId + escalationLevel + reasonCode + ruleVersion
```

Buat unique constraint:

```sql
CREATE UNIQUE INDEX UK_CASE_ESCALATION_IDEMP
ON CASE_ESCALATION (idempotency_key);
```

### 11.3 Writer pattern

```java
public void writeItems(List<Object> items) {
    for (Object obj : items) {
        EscalationCommand cmd = (EscalationCommand) obj;

        if (escalationRepository.existsByIdempotencyKey(cmd.idempotencyKey())) {
            resultRepository.markSucceededIfAbsent(cmd.asItemResult());
            continue;
        }

        CaseFile caseFile = caseRepository.findForUpdate(cmd.caseId())
            .orElseThrow(() -> new CaseMissingException(cmd.caseId()));

        if (!cmd.stillApplicableTo(caseFile)) {
            resultRepository.markSkipped(
                cmd.requestId(),
                "ESCALATION",
                cmd.caseId(),
                "NO_LONGER_APPLICABLE"
            );
            continue;
        }

        escalationRepository.insert(new CaseEscalation(
            cmd.caseId(),
            cmd.level(),
            cmd.reasonCode(),
            cmd.ruleVersion(),
            cmd.effectiveAt(),
            "BATCH_SYSTEM",
            cmd.idempotencyKey()
        ));

        auditTrailService.recordEscalationCreated(cmd);
        resultRepository.markSucceeded(cmd.asItemResult());
    }
}
```

### 11.4 Kenapa perlu re-check di writer?

Processor membaca data, lalu writer menulis. Di antara dua momen itu, data bisa berubah oleh user online atau job lain.

Karena itu writer harus memvalidasi ulang invariant penting:

- case masih open
- tidak ada escalation duplicate
- status tidak berubah menjadi closed
- appeal tidak baru aktif

Ini disebut **write-time validation**.

---

## 12. Step 5 — Bulk Correspondence Intent

### 12.1 Jangan langsung generate/send di writer utama

Correspondence biasanya punya beberapa side effect:

- render template
- generate PDF/document
- store document
- send email/SMS/letter gateway
- update correspondence status
- audit notification

Kalau semua dilakukan di chunk writer, batch menjadi sulit restart dan rawan duplicate side effect.

Lebih baik writer membuat durable intent:

```text
CASE_CORRESPONDENCE status=PENDING_GENERATION
OUTBOX_EVENT type=GENERATE_CORRESPONDENCE
```

### 12.2 Idempotency key

```text
caseId + templateCode + recipientId + businessDate + reasonCode
```

Unique constraint:

```sql
CREATE UNIQUE INDEX UK_CASE_CORRESPONDENCE_IDEMP
ON CASE_CORRESPONDENCE (idempotency_key);

CREATE UNIQUE INDEX UK_OUTBOX_IDEMP
ON OUTBOX_EVENT (idempotency_key);
```

### 12.3 Writer

```java
public void writeItems(List<Object> items) {
    for (Object obj : items) {
        CorrespondenceIntentCommand cmd = (CorrespondenceIntentCommand) obj;

        if (correspondenceRepository.existsByIdempotencyKey(cmd.idempotencyKey())) {
            resultRepository.markSucceededIfAbsent(cmd.asItemResult());
            continue;
        }

        Correspondence correspondence = correspondenceRepository.insertPending(cmd);

        outboxRepository.insertIfAbsent(new OutboxEvent(
            "CASE_CORRESPONDENCE",
            correspondence.id(),
            "GENERATE_CORRESPONDENCE",
            cmd.toPayloadJson(),
            cmd.idempotencyKey()
        ));

        auditTrailService.recordCorrespondenceIntentCreated(cmd);
        resultRepository.markSucceeded(cmd.asItemResult());
    }
}
```

### 12.4 Why this is stronger

Jika batch restart:

- correspondence unique key mencegah duplicate
- outbox unique key mencegah duplicate event
- dispatcher dapat retry side effect
- reconciliation dapat menemukan correspondence stuck in pending

---

## 13. Step 6 — External Registry Sync Intent

### 13.1 Problem

External registry API mungkin punya:

- rate limit
- token expiration
- intermittent 5xx
- 401/403
- 429
- inconsistent latency
- maintenance window
- partial response
- duplicate request behavior tidak jelas

Batch tidak boleh memperlakukan external API seperti local method.

### 13.2 Intent-first model

Batch membuat sync intent:

```text
EXTERNAL_REGISTRY_SYNC_STATE status=PENDING
OUTBOX_EVENT type=SYNC_REGISTRY_ENTITY
```

Dispatcher mengirim dengan rate control.

### 13.3 ManagedExecutorService untuk dispatcher

Contoh dispatcher:

```java
@ApplicationScoped
public class OutboxDispatcher {

    @Inject
    ManagedExecutorService executor;

    @Inject
    OutboxRepository outboxRepository;

    @Inject
    RegistryClient registryClient;

    @Inject
    RateLimiter rateLimiter;

    public void dispatchBatch() {
        List<OutboxEvent> events = outboxRepository.claimPending("SYNC_REGISTRY_ENTITY", 100);

        List<CompletableFuture<Void>> futures = events.stream()
            .map(event -> CompletableFuture.runAsync(() -> dispatchOne(event), executor))
            .toList();

        for (CompletableFuture<Void> future : futures) {
            try {
                future.join();
            } catch (CompletionException e) {
                // individual event failure is recorded inside dispatchOne
            }
        }
    }

    private void dispatchOne(OutboxEvent event) {
        rateLimiter.acquirePermit();

        try {
            RegistryResponse response = registryClient.sync(event.payload(), event.idempotencyKey());
            outboxRepository.markDispatched(event.eventId(), response.externalReference());
        } catch (TooManyRequestsException e) {
            outboxRepository.markRetry(event.eventId(), backoffWithJitter(event.attemptCount()));
        } catch (UnauthorizedException e) {
            // token refresh policy should be centralized in client
            outboxRepository.markRetry(event.eventId(), shortBackoff());
        } catch (PermanentRegistryException e) {
            outboxRepository.markDeadLetter(event.eventId(), e.errorCode(), e.getMessage());
        } catch (Exception e) {
            outboxRepository.markRetry(event.eventId(), backoffWithJitter(event.attemptCount()));
        }
    }
}
```

### 13.4 Important nuance

`CompletableFuture.runAsync(..., executor)` harus memakai `ManagedExecutorService`, bukan default common pool, agar tetap berada dalam container-governed execution.

Namun jangan salah paham: managed executor tidak otomatis menyelesaikan:

- rate limit
- idempotency
- external duplicate
- retry budget
- reconciliation

Itu tetap tanggung jawab desain aplikasi.

---

## 14. Step 7 — Evidence Report Batchlet

### 14.1 Tujuan

Regulatory batch tidak selesai hanya karena status job `COMPLETED`. Ia harus menghasilkan evidence yang menjawab:

- job apa yang dijalankan?
- siapa yang request/approve?
- parameter apa?
- input item apa?
- berapa item sukses/gagal/skipped?
- rule version apa?
- output apa?
- side effect intent apa?
- error apa yang terjadi?
- apakah ada pending outbox?
- apakah job dry-run atau actual?

### 14.2 Evidence manifest

Contoh JSON:

```json
{
  "requestId": "REQ-20260617-001",
  "jobName": "regulatory-nightly-orchestration",
  "businessDate": "2026-06-17",
  "dryRun": false,
  "requestedBy": "user-123",
  "approvedBy": "manager-456",
  "executionId": 90210,
  "startedAt": "2026-06-17T22:00:00+07:00",
  "completedAt": "2026-06-17T22:43:11+07:00",
  "ruleVersions": {
    "slaAgeing": "SLA-2026.06",
    "escalation": "ESC-2026.04"
  },
  "counts": {
    "candidates": 15230,
    "ageingUpdated": 14988,
    "escalationsCreated": 384,
    "correspondenceIntentCreated": 381,
    "registrySyncIntentCreated": 732,
    "skipped": 242,
    "failed": 0
  },
  "outbox": {
    "pending": 1113,
    "dispatched": 0,
    "deadLetter": 0
  },
  "evidenceArtifacts": [
    "s3://.../input-manifest.csv",
    "s3://.../item-results.csv",
    "s3://.../summary.json"
  ]
}
```

### 14.3 Why pending outbox is not necessarily failure

Batch may complete after recording side effect intents. The outbox dispatcher may continue after batch completion.

So distinguish:

```text
Batch job completed = intents created successfully
External side effects completed = outbox dispatched successfully
```

For audit UI, show both.

Do not lie to users by saying “letters sent” when batch only created `PENDING_SEND` intents.

---

## 15. Dry Run Mode

### 15.1 Why dry run matters

For regulatory systems, dry run enables:

- preview affected cases
- validate rule changes
- estimate volume
- detect unintended mass escalation
- produce review report before actual execution

### 15.2 Dry run invariant

Dry run must not create real side effects.

Allowed:

- candidate snapshot
- item result preview
- summary report
- simulated escalation/correspondence rows in separate preview tables

Not allowed:

- updating case status
- creating actual escalation
- creating actual correspondence
- dispatching outbox
- external API calls that mutate remote state

### 15.3 Implementation pattern

```java
public interface AgeingWriterStrategy {
    void write(AgeingUpdateCommand cmd);
}

@ApplicationScoped
public class ActualAgeingWriterStrategy implements AgeingWriterStrategy {
    public void write(AgeingUpdateCommand cmd) {
        // update CASE_FILE + audit + result
    }
}

@ApplicationScoped
public class DryRunAgeingWriterStrategy implements AgeingWriterStrategy {
    public void write(AgeingUpdateCommand cmd) {
        // insert preview result only
    }
}
```

Avoid sprinkling `if (dryRun)` everywhere until logic becomes unreadable. Use strategy per side-effect category.

---

## 16. Partitioning Strategy

### 16.1 When to partition

Partition if:

- candidate volume is large
- workload per item is independent
- database can sustain parallelism
- idempotency exists
- partition-local failure can be isolated
- observability is partition-aware

Do not partition just because it is available.

### 16.2 Partition key options

For case workload:

1. By `assigned_team_id`
   - good for fairness and operational reporting
   - bad if teams are skewed

2. By hash of `case_id`
   - good distribution
   - less meaningful operationally

3. By risk level
   - business meaningful
   - likely skewed

4. By opened date range
   - useful for ageing
   - skewed if backlog clustered

Recommended hybrid:

```text
partition_key = hash(case_id) mod N
with metrics grouped by team/risk separately
```

### 16.3 Partition count sizing

Start from downstream constraints:

```text
max DB connections available for batch = 20
average connections per partition = 1
reserve safety margin = 30%
max partitions = floor(20 * 0.7) = 14
```

Then consider CPU, lock contention, and writer cost.

Better initial setting:

```text
partition count = 4 or 8
commit interval = 50 or 100
measure
increase slowly
```

### 16.4 Skew detection

Record per partition:

- item count
- duration
- average item time
- retry count
- skip count
- DB wait time
- external API wait time

If one partition takes 5x longer, parallelism is limited by skew.

---

## 17. Transaction and Locking Strategy

### 17.1 Avoid full-table locks

Never do:

```sql
UPDATE CASE_FILE
SET current_ageing_days = ...
WHERE status IN (...);
```

without careful batching, filtering, and observability.

### 17.2 Use small chunk transactions

Each chunk updates a bounded set of cases.

Benefits:

- shorter locks
- lower undo/redo pressure
- restartable checkpoint
- less blast radius

### 17.3 Optimistic locking

If online users can update cases during batch, use version checks.

```sql
UPDATE CASE_FILE
SET current_ageing_days = :ageingDays,
    current_sla_state = :slaState,
    version = version + 1,
    updated_at = SYSTIMESTAMP
WHERE case_id = :caseId
  AND version = :expectedVersion;
```

If update count is 0:

- reload
- re-evaluate
- skip if no longer applicable
- retry if safe

### 17.4 Pessimistic locking

Use cautiously:

```sql
SELECT * FROM CASE_FILE
WHERE case_id = :caseId
FOR UPDATE;
```

Good for preventing duplicate escalation when combined with unique constraint. Bad if held too long or used on large scans.

### 17.5 The invariant

> Batch must not hold locks while waiting for external systems.

This is non-negotiable.

---

## 18. Audit Model

### 18.1 Audit dimensions

For each meaningful mutation, record:

- job request ID
- execution ID
- correlation ID
- item key
- initiated by
- approved by
- executed by
- rule version
- before value
- after value
- reason code
- idempotency key
- timestamp

### 18.2 InitiatedBy vs ExecutedBy

In async/batch systems, these are different:

```text
initiatedBy = human/admin/scheduler identity that requested job
approvedBy = human/role that approved execution
executedBy = system identity or batch runtime identity
```

Do not pretend the human user personally performed every row update at 02:00 if actual execution was a system batch. Instead record both.

### 18.3 Audit example

```json
{
  "activity": "CASE_ESCALATION_CREATED",
  "caseId": "CASE-123",
  "jobRequestId": "REQ-20260617-001",
  "executionId": "90210",
  "correlationId": "corr-abc",
  "initiatedBy": "ops.user",
  "approvedBy": "ops.manager",
  "executedBy": "BATCH_SYSTEM",
  "reasonCode": "OVERDUE_HIGH_RISK",
  "ruleVersion": "ESC-2026.04",
  "before": {
    "escalationLevel": 0
  },
  "after": {
    "escalationLevel": 1
  },
  "idempotencyKey": "...",
  "occurredAt": "2026-06-17T22:21:04+07:00"
}
```

### 18.4 Audit is not logging

Logs are for engineers. Audit is for governance, compliance, dispute resolution, and reconstruction.

A log line may say:

```text
Processed case CASE-123
```

Audit must say:

```text
Case CASE-123 was escalated from level 0 to 1 because rule ESC-2026.04 matched overdue high-risk criteria, initiated by job request REQ-..., approved by ..., executed by batch system at ..., idempotency key ...
```

---

## 19. Observability Dashboard

### 19.1 Control plane metrics

- job requests created
- job requests approved
- job requests rejected
- duplicate start attempts
- job start failures
- currently running jobs
- average queue time before start

### 19.2 Data plane metrics

Per job/step/partition:

- items discovered
- items processed
- items succeeded
- items skipped
- items failed
- retries
- chunk duration
- commit duration
- DB update duration
- reader lag
- writer latency

### 19.3 Outbox metrics

- pending events
- claimed events
- dispatched events
- retry pending
- dead-lettered
- average dispatch latency
- 429 count
- 5xx count
- token refresh count
- circuit breaker open count

### 19.4 Alert examples

Alert if:

```text
pending outbox age > 30 minutes
batch job RUNNING > expected duration + 50%
dead-letter count > 0
same job business key duplicate attempt > threshold
chunk p95 duration > baseline * 3
DB connection pool usage > 85% for 10 minutes
external API 429 rate > 5% for 5 minutes
```

### 19.5 Correlation

Every log/event/metric/audit must carry:

- request ID
- execution ID
- step name
- partition ID if any
- correlation ID
- item key when applicable

Without this, forensic debugging becomes guesswork.

---

## 20. Failure Simulation Matrix

Top-tier design includes intentional failure simulation.

### 20.1 DB timeout during ageing writer

Scenario:

```text
Writer updates case rows. DB timeout occurs after several rows in chunk.
```

Expected behavior:

- transaction rollback for current chunk
- checkpoint not advanced for failed chunk
- job fails or retries according to classification
- restart reprocesses chunk
- idempotency prevents duplicate audit/result if partial state somehow existed

Test assertions:

- no partial committed updates inside failed chunk
- no duplicate escalation/correspondence
- item result remains accurate
- restart completes successfully

### 20.2 External API 429

Scenario:

```text
Registry API returns 429 for 20% calls.
```

Expected behavior:

- dispatcher records retry with backoff + jitter
- no tight retry loop
- no DB locks held while waiting
- outbox remains pending/retry
- batch job can complete intent creation
- dashboard shows 429 metrics

Test assertions:

- retry schedule spaced out
- max attempts enforced
- no duplicate remote mutation beyond idempotency contract
- dead-letter after retry budget exhausted

### 20.3 Pod restart during chunk processing

Scenario:

```text
Pod killed while chunk step is running.
```

Expected behavior:

- current uncommitted transaction rolls back
- last checkpoint remains previous chunk
- job execution marked failed/stopped depending runtime behavior
- operator can restart
- reader resumes from checkpoint

Test assertions:

- already committed chunks not re-mutated unsafely
- current chunk reprocessed safely
- evidence shows interruption
- no zombie lock remains

### 20.4 Duplicate job request

Scenario:

```text
Two admins or scheduler instances submit same businessDate/scope at same time.
```

Expected behavior:

- unique idempotency key allows only one request
- second request returns existing job request
- only one Jakarta Batch execution starts

Test assertions:

- one row in BATCH_JOB_REQUEST
- one execution ID
- duplicate attempt audit recorded

### 20.5 Partial correspondence writer failure

Scenario:

```text
Writer creates correspondence row but fails before outbox event.
```

If both are in same DB transaction:

- transaction rollback
- restart creates both again

If not same transaction:

- design bug unless reconciler repairs missing outbox

Expected design:

- correspondence intent and outbox insert in same transaction
- unique keys on both
- reconciliation job detects mismatch anyway

### 20.6 Deployment while job running

Scenario:

```text
Rolling deployment kills old pod while job is running.
```

Expected behavior:

- graceful shutdown gives stop window
- job stops at safe boundary if supported
- unfinished work restartable
- scheduler/launcher does not start duplicate job on new pod
- readiness prevents new work during shutdown

Test assertions:

- no duplicate execution
- no zombie claimed outbox events
- restart from checkpoint works

---

## 21. Reconciliation Jobs

Even with good design, distributed systems need reconciliation.

### 21.1 Why reconciliation exists

Because reality includes:

- timeout after external success
- DB commit ambiguity
- operator manual fixes
- external system delayed processing
- network partition
- deployment interruption
- bug in old version

### 21.2 Reconciliation examples

1. Correspondence with `PENDING_GENERATION` older than threshold but no outbox event.
2. Outbox event marked `DISPATCHING` too long due to pod death.
3. External registry says entity updated but local sync state still pending.
4. Case escalation exists but item result not marked succeeded.
5. Job completed but evidence report missing.

### 21.3 Reconciliation pattern

```text
find inconsistent state
classify inconsistency
repair if deterministic and safe
else create manual review task
record audit evidence
```

### 21.4 Example SQL

```sql
SELECT c.correspondence_id
FROM CASE_CORRESPONDENCE c
LEFT JOIN OUTBOX_EVENT o
  ON o.aggregate_type = 'CASE_CORRESPONDENCE'
 AND o.aggregate_id = c.correspondence_id
WHERE c.status = 'PENDING_GENERATION'
  AND o.event_id IS NULL
  AND c.created_at < SYSTIMESTAMP - INTERVAL '10' MINUTE;
```

This query detects missing outbox intent.

---

## 22. Stop, Restart, and Abandon Semantics

### 22.1 Stop

Stop should mean:

```text
Do not start more work; complete or rollback current safe unit; persist state; allow restart.
```

Stop should not mean:

```text
kill thread immediately and corrupt state
```

### 22.2 Restart

Restart should mean:

```text
Resume from last durable checkpoint or reconstruct safe state from item result/outbox/idempotency keys.
```

### 22.3 Abandon

Abandon should mean:

```text
This execution will not be restarted.
```

But business side effects already committed still exist. Abandon is not rollback.

### 22.4 Operator UI warning

Before abandon:

```text
This action does not undo already committed case updates, escalation records, correspondence intents, or outbox events. Use reconciliation/compensation if business reversal is required.
```

---

## 23. Compensation Design

Some side effects cannot be undone automatically. But some require compensating action.

### 23.1 Examples

- Wrong escalation created: create reversal/correction record, do not delete silently.
- Wrong correspondence generated but not sent: void document and mark superseded.
- Wrong correspondence sent: send correction notice, record incident.
- Wrong registry sync: create manual review and correction task.

### 23.2 Compensation is business workflow, not exception handling

Do not hide compensation inside catch block.

Model it explicitly:

```text
COMPENSATION_REQUIRED -> COMPENSATION_APPROVED -> COMPENSATION_EXECUTED -> COMPENSATED
```

### 23.3 Audit requirement

Every compensation must link to:

- original job request
- original item result
- original side effect
- reason for compensation
- approver
- executor
- timestamp

---

## 24. Security Model

### 24.1 Permissions

Possible permissions:

```text
BATCH_JOB_VIEW
BATCH_JOB_START
BATCH_JOB_APPROVE
BATCH_JOB_STOP
BATCH_JOB_RESTART
BATCH_JOB_ABANDON
BATCH_JOB_DOWNLOAD_EVIDENCE
BATCH_JOB_REPROCESS_ITEM
BATCH_JOB_COMPENSATE
```

### 24.2 Separation of duties

For high-risk jobs:

```text
requester != approver
```

For production jobs:

```text
operator can stop/restart, but cannot alter job parameter after approval
```

### 24.3 Parameter tampering

Never trust job parameters blindly. Store canonical parameter JSON in `BATCH_JOB_REQUEST`, then batch reads request by `requestId`.

Do not let caller pass arbitrary SQL/filter snippets.

Bad:

```json
{
  "whereClause": "status = 'OPEN' OR 1=1"
}
```

Good:

```json
{
  "riskLevels": ["HIGH"],
  "teamIds": ["ENF-A"],
  "businessDate": "2026-06-17"
}
```

Validate against allowlisted values.

---

## 25. Configuration Model

### 25.1 Runtime parameters

```text
businessDate
requestId
correlationId
dryRun
partitionCount
commitInterval
maxRetries
rateLimitPerMinute
```

### 25.2 What should not be dynamic without governance

- SQL query structure
- escalation rule expression
- target endpoint
- security identity
- approval bypass flag
- max partition count beyond safe bound
- arbitrary template code outside allowlist

### 25.3 Version all rules

Rule version must be recorded in result/audit.

```text
SLA_RULE_VERSION = SLA-2026.06
ESCALATION_RULE_VERSION = ESC-2026.04
CORRESPONDENCE_RULE_VERSION = CORR-2026.02
```

Without rule version, future reconstruction becomes weak.

---

## 26. Testing Strategy

### 26.1 Unit tests

Test pure services:

- SLA ageing calculation
- escalation rule evaluation
- idempotency key generation
- retry classification
- dry-run strategy

### 26.2 Integration tests

Test DB interactions:

- chunk writer rollback
- unique constraint duplicate prevention
- checkpoint restart
- candidate discovery idempotency
- outbox same-transaction insert

### 26.3 Contract tests

Test external systems:

- 200 success
- 401 token refresh
- 403 permanent failure
- 429 retry/backoff
- 500 retry
- timeout ambiguity
- duplicate idempotency key behavior

### 26.4 Chaos/failure tests

- kill pod during chunk
- kill pod during outbox dispatch
- DB timeout
- slow DB
- external API 429 burst
- duplicate scheduler
- redeploy during job
- network partition simulation

### 26.5 Audit tests

Assert audit trail contains:

- requester
- approver
- executor
- reason
- rule version
- before/after
- item key
- idempotency key
- correlation ID

---

## 27. Example Package Structure

```text
com.example.regulatory.batch
  control
    BatchControlResource.java
    JobRequestService.java
    JobRequestRepository.java
    BatchAuthorizationService.java
  job
    ValidateRequestBatchlet.java
    DiscoverCandidatesBatchlet.java
    EvidenceReportBatchlet.java
  ageing
    CaseAgeingReader.java
    CaseAgeingProcessor.java
    CaseAgeingWriter.java
    AgeingRuleService.java
  escalation
    EscalationCandidateReader.java
    EscalationProcessor.java
    EscalationWriter.java
    EscalationRuleService.java
  correspondence
    CorrespondenceCandidateReader.java
    CorrespondenceIntentProcessor.java
    CorrespondenceIntentWriter.java
  registry
    RegistrySyncCandidateReader.java
    RegistrySyncIntentProcessor.java
    RegistrySyncIntentWriter.java
  outbox
    OutboxDispatcher.java
    OutboxRepository.java
    OutboxEvent.java
  audit
    BatchAuditService.java
    AuditTrailService.java
  observability
    BatchMetrics.java
    BatchCorrelation.java
  reconciliation
    CorrespondenceReconciliationJob.java
    OutboxReconciliationJob.java
```

---

## 28. Common Design Mistakes in This Case Study

### Mistake 1 — Starting job directly from HTTP request and assuming it is safe

Problem:

- HTTP timeout does not mean job failed
- transaction mismatch possible
- duplicate user retry possible

Better:

- durable job request
- idempotency key
- separate launcher/control-plane state

### Mistake 2 — Doing external API calls inside chunk transaction

Problem:

- locks held while waiting
- rollback cannot undo API
- retry ambiguity

Better:

- outbox intent inside transaction
- dispatcher outside transaction
- idempotency key + reconciliation

### Mistake 3 — No candidate snapshot

Problem:

- restart processes different data
- audit cannot prove input set
- job result non-deterministic

Better:

- snapshot candidate table
- manifest/evidence

### Mistake 4 — No item-level result table

Problem:

- operator only sees job failed
- cannot reprocess subset
- poor audit

Better:

- `BATCH_ITEM_RESULT`
- status per item
- error classification

### Mistake 5 — Treating completion as success of all side effects

Problem:

- batch completed may only mean intents created
- outbox may still be pending

Better:

- separate batch status from side-effect dispatch status

### Mistake 6 — Partitioning without downstream capacity

Problem:

- DB pool exhaustion
- API rate limit breach
- lock contention

Better:

- partition count derived from capacity
- rate limiter
- metrics-driven tuning

### Mistake 7 — Audit as log lines

Problem:

- cannot reconstruct decision
- not defensible

Better:

- structured audit trail
- rule version
- before/after
- initiated/approved/executed identity

---

## 29. Production Readiness Checklist

### 29.1 Control plane

- [ ] Job request stored durably before execution.
- [ ] Idempotency key prevents duplicate launch.
- [ ] Authorization checked for start/stop/restart/abandon.
- [ ] Approval workflow exists for high-risk jobs.
- [ ] Parameters validated against allowlist/schema.
- [ ] Job request has business key.
- [ ] Operator action audit exists.

### 29.2 Job graph

- [ ] Steps have clear responsibility.
- [ ] Exit statuses are intentional.
- [ ] Failure routing is explicit.
- [ ] Dry-run path is safe.
- [ ] Evidence report generated.

### 29.3 Chunk/restart

- [ ] Reader checkpoint is deterministic.
- [ ] Commit interval is bounded.
- [ ] Writer is idempotent.
- [ ] Restart test exists.
- [ ] Skip/retry classification documented.
- [ ] Poison records produce evidence.

### 29.4 Database

- [ ] No long-running transaction.
- [ ] No external call while holding DB lock.
- [ ] Unique keys protect side effects.
- [ ] Optimistic/pessimistic locking strategy defined.
- [ ] DB pool capacity reserved.
- [ ] Query plans tested at production-like volume.

### 29.5 External systems

- [ ] Outbox pattern used for side effects.
- [ ] Idempotency key sent where supported.
- [ ] 401/403/429/5xx classification exists.
- [ ] Retry budget exists.
- [ ] Backoff with jitter exists.
- [ ] Dead-letter and reconciliation exist.

### 29.6 Observability

- [ ] Correlation ID propagated.
- [ ] Metrics per job/step/partition.
- [ ] Item-level result visible.
- [ ] Outbox dashboard exists.
- [ ] Alerts for stuck/pending/dead-letter.
- [ ] Logs include request/execution/item identifiers.

### 29.7 Compliance

- [ ] Audit trail records initiatedBy/approvedBy/executedBy.
- [ ] Rule versions recorded.
- [ ] Input manifest exists.
- [ ] Output manifest exists.
- [ ] Evidence retention defined.
- [ ] Sensitive data masked in logs/reports.

### 29.8 Cluster/Kubernetes

- [ ] Duplicate scheduler prevented.
- [ ] Pod termination behavior tested.
- [ ] Graceful shutdown configured.
- [ ] Claimed outbox events can be recovered.
- [ ] Rolling deployment strategy documented.
- [ ] Job restart procedure documented.

---

## 30. The Top 1% Mental Model

A junior implementation sees the requirement as:

```text
Run a nightly job that updates cases.
```

A stronger developer sees:

```text
Use Jakarta Batch with reader/processor/writer.
```

A senior engineer sees:

```text
Use chunking, checkpointing, and retry handling.
```

A top-tier engineer sees the whole system:

```text
This is a governed, stateful, restartable workload orchestration problem.

We need:
- durable job request
- duplicate prevention
- authorization and approval
- stable input manifest
- explicit job graph
- bounded chunk transaction
- idempotent writer
- side-effect outbox
- managed executor dispatcher
- rate limit and retry budget
- item result table
- audit and evidence manifest
- failure simulation
- reconciliation
- operator control plane
- cluster-safe execution
- production dashboard
```

The distinction is not more code. The distinction is **knowing where correctness can be lost**.

---

## 31. Summary

Dalam studi kasus ini, kita membangun mental model end-to-end untuk workload orchestration pada regulatory case management platform.

Prinsip utamanya:

1. **Control plane terpisah dari data plane.**  
   Start/stop/restart/approval/audit tidak boleh dicampur sembarangan dengan item processing.

2. **Batch job adalah state machine.**  
   Job, step, item, side effect, outbox, dan evidence semuanya punya lifecycle.

3. **Candidate snapshot membuat input defensible.**  
   Regulatory batch perlu tahu item apa yang diproses dan kenapa.

4. **Chunk transaction harus kecil dan restartable.**  
   Commit interval, checkpoint, idempotent writer, dan item result adalah inti reliability.

5. **External side effect harus melalui durable intent/outbox.**  
   Jangan memanggil external API sambil menahan DB transaction.

6. **Idempotency adalah syarat restart.**  
   Tanpa idempotency, retry/restart hanya menunda corruption.

7. **Audit berbeda dari log.**  
   Audit harus menjelaskan decision, actor, rule version, before/after, reason, dan evidence.

8. **Observability harus didesain sejak awal.**  
   Kalau job gagal, operator harus tahu item mana, step mana, partition mana, dan side effect mana.

9. **Cluster execution butuh ownership dan coordination.**  
   Multi-pod tidak otomatis aman.

10. **Production readiness dibuktikan dengan failure simulation.**  
    Jangan percaya desain batch yang belum diuji dengan timeout, restart, duplicate request, 429, dan partial failure.

---

## 32. Latihan / Thought Experiment

### Exercise 1 — Design duplicate prevention

Kamu punya job:

```text
monthly-license-renewal-notification
```

Parameter:

```text
month = 2026-07
licenseType = SALESPERSON
region = ALL
```

Tentukan:

- business key
- idempotency key
- unique constraint
- behavior jika request duplicate masuk bersamaan

### Exercise 2 — Classify side effects

Untuk setiap action berikut, tentukan apakah boleh dilakukan langsung di chunk writer atau harus lewat outbox:

1. Update `CASE_FILE.current_ageing_days`
2. Insert `CASE_ESCALATION`
3. Generate PDF letter in external document service
4. Send email notification
5. Insert `BATCH_ITEM_RESULT`
6. Call external registry update API
7. Record audit trail in same DB

### Exercise 3 — Restart reasoning

Chunk size = 100. Job sudah commit sampai item 500. Saat memproses item 560, pod mati.

Jawab:

- checkpoint terakhir kemungkinan di item berapa?
- item mana yang mungkin diproses ulang?
- apa syarat agar reprocessing aman?
- audit apa yang harus dicek setelah restart?

### Exercise 4 — Dry run design

Desain dry-run untuk enforcement escalation evaluation.

Tentukan:

- table/field mana yang boleh ditulis
- table/field mana yang tidak boleh ditulis
- bagaimana preview result direpresentasikan
- bagaimana approval actual run menggunakan hasil dry-run

### Exercise 5 — Reconciliation

Outbox event `GENERATE_CORRESPONDENCE` berstatus `DISPATCHING` selama 2 jam.

Tentukan:

- kemungkinan root cause
- query pendeteksi
- repair action otomatis
- kapan perlu manual review
- audit evidence yang harus dibuat

---

## 33. Referensi Resmi dan Relevan

- Jakarta Batch 2.1 Specification — job model, JSL, chunk, checkpoint/restart, skip/retry, partitioning, and runtime operations.
- Jakarta Batch 2.1 API — `JobOperator`, `ItemReader`, `ItemProcessor`, `ItemWriter`, `Batchlet`, listeners, partition APIs.
- Jakarta Concurrency 3.1 Specification — managed executor, scheduled executor, thread factory, context service, and container-integrity model.
- Jakarta EE 11 Release — platform baseline including Jakarta Batch 2.1 and Jakarta Concurrency 3.1.
- Jakarta EE Tutorial — Batch Processing and Concurrency Utilities chapters.
- MicroProfile Fault Tolerance — timeout, retry, bulkhead, circuit breaker, fallback semantics useful around external API dispatchers.
- Java SE 21–25 — virtual threads, structured concurrency preview, scoped values, and modern observability considerations.

---

## 34. Status Seri

Seri belum selesai.

Bagian ini adalah:

```text
Part 34 — End-to-End Case Study: Regulatory Case Management Workload Orchestration
```

Bagian berikutnya:

```text
Part 35 — Final Synthesis: Choosing the Right Execution Model
File: 35-final-synthesis-choosing-the-right-execution-model.md
```

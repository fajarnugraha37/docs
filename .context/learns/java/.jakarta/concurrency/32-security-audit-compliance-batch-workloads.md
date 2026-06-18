# Part 32 — Security, Audit, and Compliance for Batch Workloads

**Series:** `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
**File:** `32-security-audit-compliance-batch-workloads.md`  
**Scope:** Java 8–25, Java EE / Jakarta EE, Jakarta Batch, Jakarta Security, Jakarta Concurrency, enterprise/regulatory workloads  
**Position in series:** Part 32 of 35  

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Mendesain batch workload yang aman dari sisi **authorization, audit, data protection, job parameter integrity, dan operational governance**.
2. Membedakan security untuk request online biasa dengan security untuk **long-running/offline/background execution**.
3. Menentukan siapa yang boleh melakukan operasi batch:
   - start
   - stop
   - restart
   - abandon
   - inspect
   - approve
   - override
   - reprocess
4. Mendesain audit trail yang defensible untuk workload regulatori/enforcement.
5. Menghindari kebocoran sensitive data melalui:
   - job parameters
   - logs
   - checkpoint state
   - exception stack trace
   - temporary files
   - exported reports
   - object storage
   - notification payload
6. Mendesain batch evidence model yang bisa menjawab pertanyaan audit seperti:
   - siapa meminta job?
   - siapa menyetujui?
   - input apa yang dipakai?
   - record mana yang diproses?
   - record mana yang gagal?
   - output apa yang dihasilkan?
   - apakah job bisa diulang dengan hasil konsisten?
7. Membangun mental model bahwa batch security bukan hanya authentication, tetapi **control-plane governance + data-plane protection + evidence lifecycle**.

---

## 2. Problem yang Diselesaikan

Batch workload sering dianggap sebagai pekerjaan internal sehingga security-nya disepelekan.

Contoh mindset yang berbahaya:

> “Ini cuma nightly job.”  
> “Ini cuma admin endpoint.”  
> “Ini cuma batch file internal.”  
> “Yang penting job sukses.”

Dalam sistem enterprise, terutama sistem regulatori, batch sering justru lebih sensitif daripada request online biasa karena batch dapat:

- memproses ribuan/mutaan/ratusan juta record sekaligus;
- mengubah status case secara massal;
- mengirim correspondence massal;
- menarik data dari external registry;
- menghasilkan laporan official;
- melakukan recalculation penalty/SLA/ageing;
- menyentuh PII, financial data, legal data, enforcement data;
- menjalankan action setelah user sudah logout;
- berjalan tanpa pengawasan langsung manusia;
- menghasilkan evidence yang dipakai untuk audit, dispute, appeal, atau litigation.

Karena itu security batch harus menjawab tiga kelas pertanyaan.

### 2.1 Control-plane question

Siapa boleh mengontrol batch?

- Siapa boleh start job?
- Siapa boleh stop job?
- Siapa boleh restart failed job?
- Siapa boleh abandon execution?
- Siapa boleh override parameter?
- Siapa boleh melihat result/error detail?
- Siapa boleh download output file?

### 2.2 Data-plane question

Data apa yang disentuh batch dan bagaimana dilindungi?

- Apakah job membaca PII?
- Apakah job menulis enforcement decision?
- Apakah job memanggil external API?
- Apakah job menghasilkan file sensitif?
- Apakah job menyimpan checkpoint yang berisi data rahasia?
- Apakah error report mengandung PII?

### 2.3 Evidence-plane question

Apakah kita bisa membuktikan apa yang terjadi?

- Input apa yang digunakan?
- Versi kode/config apa yang menjalankan job?
- Parameter apa yang dipakai?
- Berapa record sukses/gagal/skipped?
- Siapa yang menginisiasi?
- Siapa yang menyetujui?
- Kapan mulai dan selesai?
- Node/pod mana yang menjalankan?
- Apa exit status final?
- Apakah output dapat diverifikasi checksum-nya?
- Apakah restart memproses ulang record dengan aman?

Top-tier engineer tidak memperlakukan batch sebagai loop teknis. Ia memperlakukan batch sebagai **governed execution system**.

---

## 3. Mental Model: Batch Has Three Planes

Agar desain jelas, pisahkan batch workload menjadi tiga plane.

```text
+-------------------------------------------------------------+
|                    Batch Control Plane                       |
|-------------------------------------------------------------|
| Who can start/stop/restart?                                  |
| Who approves?                                                |
| Which parameters are allowed?                                |
| Duplicate launch prevention                                  |
| JobOperator wrapper/API/admin UI                             |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                    Batch Execution Plane                     |
|-------------------------------------------------------------|
| Job/Step/Chunk/Batchlet                                      |
| Reader/Processor/Writer                                      |
| Transaction boundary                                         |
| Retry/skip/checkpoint/restart                                |
| External API/DB/file side effects                            |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                    Batch Evidence Plane                      |
|-------------------------------------------------------------|
| Audit trail                                                  |
| Input manifest                                               |
| Output manifest                                              |
| Checksum                                                     |
| Error report                                                 |
| Execution metrics                                            |
| Retention and archival                                       |
+-------------------------------------------------------------+
```

### 3.1 Control plane

Control plane adalah sisi yang mengatur eksekusi.

Contoh:

- REST endpoint `/batch/jobs/{jobName}/start`
- admin UI
- scheduler
- approval workflow
- `JobOperator` wrapper
- job request table
- role/permission model

Control plane tidak boleh hanya menjadi thin wrapper yang langsung memanggil `JobOperator.start(...)` tanpa governance.

### 3.2 Execution plane

Execution plane adalah tempat job benar-benar berjalan.

Contoh:

- JSL
- batchlet
- chunk step
- partitioned step
- reader/processor/writer
- listener
- transaction
- checkpoint
- retry/skip

Execution plane harus menerima parameter yang sudah divalidasi dan tidak memutuskan authorization utama sendiri.

### 3.3 Evidence plane

Evidence plane adalah hasil jejak yang bisa diverifikasi.

Contoh:

- audit log
- job_execution table
- job_request table
- input manifest
- output manifest
- record-level error table
- checksum
- reconciliation report
- approval record

Evidence plane harus didesain dari awal, bukan ditambahkan setelah incident.

---

## 4. Jakarta Batch Security Reality

Jakarta Batch menyediakan API dan runtime model untuk batch execution. Namun security control-nya tidak selalu fully prescribed oleh specification.

`JobOperator` menyediakan operasi untuk start, stop, restart, dan inspect job history. API documentation menyatakan bahwa `JobOperator` sendiri tidak memaksakan security constraints; implementer dapat membatasi metode dengan security scheme pilihannya sendiri.

Implikasinya:

- Jangan berasumsi bahwa semua server menerapkan authorization sama.
- Jangan expose `JobOperator` langsung ke endpoint publik/internal tanpa wrapper.
- Buat application-level control plane yang eksplisit.
- Log semua administrative action.
- Validasi job name dan parameter.
- Gunakan RBAC/ABAC sesuai sensitivitas job.

Jakarta Batch mendefinisikan API Java dan JSL XML untuk membangun batch job reusable dan parameterized. Di Jakarta EE 11, Batch 2.1 menjadi bagian dari platform, sedangkan Jakarta Batch 2.2 masih under development untuk Jakarta EE 12. Jakarta Security 4.0 adalah bagian dari Jakarta EE 11 dan menyediakan `SecurityContext` sebagai access point programmatic security; tetapi availability `SecurityContext` di luar servlet/EJB container harus dipahami berdasarkan runtime/spec behavior. 

---

## 5. Threat Model untuk Batch Workload

Security yang kuat dimulai dari threat model.

### 5.1 Unauthorized job launch

Seseorang menjalankan batch yang seharusnya tidak boleh dijalankan.

Contoh dampak:

- bulk update status case;
- mengirim ribuan email resmi;
- generate regulatory report prematur;
- trigger sync external system;
- reprocess data lama;
- menjalankan job mahal yang mengganggu sistem online.

Mitigasi:

- permission per job;
- operation-specific permission;
- approval untuk high-risk job;
- job parameter validation;
- immutable job request record;
- audit trail.

### 5.2 Unauthorized restart/reprocess

Restart terlihat harmless, tetapi bisa berbahaya.

Contoh:

- writer tidak idempotent;
- external email terkirim ulang;
- penalty dihitung ulang dengan config baru;
- output report baru berbeda dari report lama;
- external API dipanggil ulang dan mengubah state partner.

Mitigasi:

- restart permission terpisah dari start permission;
- restart eligibility check;
- idempotency key;
- output versioning;
- approval untuk restart setelah partial side effect.

### 5.3 Parameter tampering

Job parameter adalah attack surface.

Contoh parameter berbahaya:

```text
agencyId=ALL
fromDate=1900-01-01
toDate=2099-12-31
force=true
skipValidation=true
outputPath=/public/export
caseStatus=CLOSED
includePII=true
```

Mitigasi:

- whitelist parameter;
- type validation;
- range validation;
- enum validation;
- cross-field validation;
- authorization based on parameter scope;
- reject unknown parameter;
- signed/immutable request payload for approval.

### 5.4 Data exfiltration through output

Batch export/report sering menjadi jalan keluar data.

Contoh:

- CSV berisi NRIC/passport/email/phone;
- JSON dump internal case;
- report dikirim email tanpa encryption;
- temporary file tertinggal di shared volume;
- object storage ACL terlalu longgar.

Mitigasi:

- output classification;
- encryption at rest;
- short-lived signed URL;
- access control per output;
- checksum + manifest;
- retention policy;
- masking/minimization.

### 5.5 Sensitive data leakage in logs/checkpoint

Batch sering logging detail record agar mudah debugging. Ini berbahaya.

Contoh:

```text
ERROR Failed to process applicant NRIC=S1234567A name=John Tan address=...
```

Mitigasi:

- structured logging dengan redaction;
- log record reference, bukan full PII;
- error table encrypted/masked;
- checkpoint state tidak menyimpan payload sensitif;
- exception sanitizer.

### 5.6 Privilege escalation through system identity

Batch sering berjalan sebagai system user.

Risiko:

- user biasa memicu job yang berjalan dengan privilege superuser;
- approval dilewati;
- audit hanya mencatat `SYSTEM`, bukan requester;
- authorization dilakukan di execution time dengan system identity, bukan request scope.

Mitigasi:

- bedakan `requestedBy`, `approvedBy`, `executedBy`;
- authorization at enqueue time;
- scoped service identity;
- least privilege per job;
- business permission check sebelum job request accepted.

### 5.7 Replay and duplicate execution

Seseorang atau sistem memulai job yang sama berulang.

Mitigasi:

- idempotency key;
- unique active job constraint;
- semantic duplicate detection;
- job request state machine;
- natural business key.

### 5.8 Insider misuse

Internal admin bukan berarti semua boleh.

Mitigasi:

- separation of duties;
- approval untuk destructive/mass jobs;
- maker-checker;
- immutable audit;
- anomaly detection;
- periodic access review.

---

## 6. Authorization Model untuk Batch

Authorization batch harus lebih granular daripada sekadar `ROLE_ADMIN`.

### 6.1 Bad model

```text
ROLE_ADMIN can do everything
```

Problem:

- terlalu luas;
- sulit diaudit;
- tidak ada separation of duties;
- restart destructive job sama mudahnya dengan view status;
- tidak membedakan job low-risk dan high-risk.

### 6.2 Better model

Gunakan permission berbasis operasi dan job.

```text
batch:job:view
batch:job:start:<jobName>
batch:job:stop:<jobName>
batch:job:restart:<jobName>
batch:job:abandon:<jobName>
batch:job:approve:<jobName>
batch:job:download-output:<jobName>
batch:job:view-errors:<jobName>
batch:job:override-parameter:<jobName>:<parameterName>
```

Contoh mapping:

| Operation | Low-risk job | High-risk job |
|---|---:|---:|
| View status | Operator | Operator |
| Start | Operator | Supervisor approval |
| Stop | Operator | Supervisor |
| Restart | Operator | Supervisor + risk check |
| Abandon | Admin | Admin + audit reason |
| Download output | Authorized business user | Restricted + approval |
| View error detail | Support | Data-protection restricted |

### 6.3 Job sensitivity classification

Setiap job harus diklasifikasikan.

| Class | Description | Example | Governance |
|---|---|---|---|
| C0 | Read-only technical | cache warmup | low |
| C1 | Read-only business | generate aggregate report | medium |
| C2 | Internal data mutation | recalculate SLA ageing | medium-high |
| C3 | External side effect | send email/API sync | high |
| C4 | Legal/regulatory effect | enforcement escalation, penalty | very high |
| C5 | Sensitive export | PII/legal/financial export | very high |

### 6.4 Authorization at enqueue time vs execution time

Batch sering tidak langsung berjalan saat request dibuat.

```text
User request time: 10:00
Job starts:        10:15
Job finishes:      11:30
```

Pertanyaannya:

- authorization dicek kapan?
- jika user role dicabut pukul 10:05, job tetap boleh jalan?
- jika approval dicabut sebelum start?
- jika data scope berubah?

Pola yang sehat:

1. Validasi requester pada enqueue time.
2. Simpan immutable request context:
   - requestedBy
   - requestedRoleSnapshot
   - requestedScope
   - requestedAt
   - justification
3. Untuk high-risk job, require approval.
4. Sebelum execution, lakukan pre-flight check:
   - request masih valid?
   - approval masih valid?
   - job tidak expired?
   - parameter masih allowed?
5. Execution berjalan sebagai service identity terbatas, bukan impersonation liar.
6. Audit tetap mencatat requester/approver/effective executor.

---

## 7. Identity Model: RequestedBy, ApprovedBy, ExecutedBy

Salah satu kesalahan audit paling umum adalah semua batch activity dicatat sebagai `SYSTEM`.

Itu tidak cukup.

### 7.1 Tiga identitas utama

```text
requestedBy  = manusia/sistem yang meminta job
approvedBy   = manusia/sistem yang menyetujui job, jika perlu
executedBy   = service identity/runtime yang menjalankan job
```

Contoh:

```json
{
  "jobName": "case-ageing-recalculation",
  "requestedBy": "fajar.nugraha",
  "approvedBy": "supervisor.akbar",
  "executedBy": "svc-batch-case",
  "executionId": 982211,
  "reason": "Monthly ageing reconciliation before enforcement review"
}
```

### 7.2 Jangan pilih salah satu saja

| Hanya mencatat | Problem |
|---|---|
| `requestedBy` saja | tidak tahu service identity yang melakukan side effect |
| `executedBy` saja | tidak tahu manusia/flow yang memicu |
| `approvedBy` saja | tidak tahu pemohon dan executor |
| `SYSTEM` saja | tidak defensible |

### 7.3 Effective identity

Kadang audit perlu mencatat effective actor.

```text
effectiveActor = requestedBy + approvedBy + executedBy + jobName + parameterScope
```

Ini bukan satu user tunggal, tetapi komposisi konteks eksekusi.

### 7.4 System-initiated job

Untuk scheduled nightly job:

```text
requestedBy = SCHEDULER
approvedBy  = POLICY:PRE_APPROVED
executedBy  = svc-batch-nightly
reason      = scheduled policy <policy-id>
```

Jangan kosongkan requester hanya karena tidak ada manusia.

---

## 8. Job Request State Machine

Untuk batch penting, jangan langsung start job dari UI. Buat job request state machine.

```text
DRAFT
  |
  v
SUBMITTED
  |
  +--> REJECTED
  |
  v
APPROVED
  |
  v
QUEUED
  |
  v
RUNNING
  |
  +--> STOP_REQUESTED
  |        |
  |        v
  |      STOPPED
  |
  +--> FAILED
  |
  +--> COMPLETED
  |
  +--> COMPLETED_WITH_ERRORS
  |
  v
ARCHIVED
```

### 8.1 Why state machine matters

State machine mencegah operasi ilegal.

Contoh invariant:

| Invariant | Reason |
|---|---|
| hanya `SUBMITTED` yang bisa di-approve | mencegah approval setelah job berubah |
| hanya `APPROVED` yang bisa di-queue | mencegah bypass approval |
| hanya `FAILED`/`STOPPED` yang bisa direstart | mencegah duplicate running |
| `COMPLETED` immutable | mencegah evidence berubah |
| `ABANDONED` perlu reason | operational accountability |

### 8.2 Job request table

Contoh skema konseptual:

```sql
CREATE TABLE batch_job_request (
    request_id             VARCHAR(64) PRIMARY KEY,
    job_name               VARCHAR(200) NOT NULL,
    request_status         VARCHAR(40) NOT NULL,
    requested_by           VARCHAR(200) NOT NULL,
    requested_at           TIMESTAMP NOT NULL,
    approved_by            VARCHAR(200),
    approved_at            TIMESTAMP,
    approval_policy_id     VARCHAR(100),
    execution_id           BIGINT,
    parameter_hash         VARCHAR(128) NOT NULL,
    parameter_json         CLOB NOT NULL,
    parameter_redacted_json CLOB NOT NULL,
    business_key           VARCHAR(300),
    idempotency_key        VARCHAR(300),
    reason                 VARCHAR(1000),
    risk_class             VARCHAR(20) NOT NULL,
    created_at             TIMESTAMP NOT NULL,
    updated_at             TIMESTAMP NOT NULL
);
```

### 8.3 Unique constraint for duplicate prevention

```sql
CREATE UNIQUE INDEX uq_batch_active_business_key
ON batch_job_request (
    job_name,
    business_key,
    CASE
      WHEN request_status IN ('SUBMITTED', 'APPROVED', 'QUEUED', 'RUNNING', 'STOP_REQUESTED')
      THEN 'ACTIVE'
      ELSE request_id
    END
);
```

Actual syntax berbeda per database. Intinya: **jangan izinkan dua active request yang semantically sama**.

---

## 9. Secure JobOperator Wrapper

Jangan expose `JobOperator` langsung. Buat wrapper/service.

### 9.1 Bad example

```java
@Path("/admin/batch")
public class BadBatchResource {

    @POST
    @Path("/{jobName}/start")
    public Response start(@PathParam("jobName") String jobName,
                          Map<String, String> params) throws Exception {
        JobOperator op = BatchRuntime.getJobOperator();
        long id = op.start(jobName, new Properties());
        return Response.ok(id).build();
    }
}
```

Problem:

- job name bebas;
- parameter tidak divalidasi;
- authorization tidak jelas;
- tidak ada audit;
- tidak ada duplicate prevention;
- tidak ada risk classification;
- tidak ada approval;
- tidak ada idempotency;
- tidak ada reason.

### 9.2 Better shape

```java
@ApplicationScoped
public class BatchControlService {

    @Inject SecurityContext securityContext;
    @Inject BatchJobCatalog jobCatalog;
    @Inject BatchAuthorizationService authorizationService;
    @Inject BatchParameterValidator parameterValidator;
    @Inject BatchRequestRepository requestRepository;
    @Inject BatchAuditService auditService;

    public BatchRequestId submit(StartBatchCommand command) {
        String actor = currentActor();

        BatchJobDefinition definition = jobCatalog.requireKnownJob(command.jobName());

        authorizationService.assertCanSubmit(actor, definition, command.parameters());

        ValidatedBatchParameters validated =
            parameterValidator.validate(definition, command.parameters());

        BatchJobRequest request = BatchJobRequest.submitted(
            definition.name(),
            actor,
            validated.redacted(),
            validated.secure(),
            command.reason(),
            definition.riskClass(),
            validated.businessKey(),
            validated.idempotencyKey()
        );

        requestRepository.insertWithDuplicateProtection(request);

        auditService.recordSubmitted(request);

        return request.id();
    }

    public long startApproved(BatchRequestId requestId) throws Exception {
        BatchJobRequest request = requestRepository.requireApproved(requestId);
        BatchJobDefinition definition = jobCatalog.requireKnownJob(request.jobName());

        authorizationService.assertSystemCanExecute(definition);

        Properties props = request.toBatchProperties();
        props.setProperty("requestId", request.id().value());
        props.setProperty("requestedBy", request.requestedBy());
        props.setProperty("approvedBy", request.approvedBy().orElse(""));
        props.setProperty("parameterHash", request.parameterHash());

        long executionId = BatchRuntime.getJobOperator().start(definition.jslName(), props);

        requestRepository.markQueuedOrRunning(request.id(), executionId);
        auditService.recordStarted(request, executionId);

        return executionId;
    }

    private String currentActor() {
        Principal p = securityContext.getCallerPrincipal();
        if (p == null) {
            throw new SecurityException("Unauthenticated caller");
        }
        return p.getName();
    }
}
```

### 9.3 Design point

`JobOperator` tetap dipakai, tetapi tidak menjadi policy engine.

```text
User/API/Scheduler
      |
      v
BatchControlService
      |-- authorization
      |-- validation
      |-- approval
      |-- duplicate prevention
      |-- audit
      |-- parameter redaction
      v
JobOperator
      v
Jakarta Batch runtime
```

---

## 10. Job Parameter Security

Job parameter sering terlihat kecil, tetapi efeknya besar.

### 10.1 Parameter taxonomy

| Parameter type | Example | Risk |
|---|---|---|
| scope | agencyId, caseType | unauthorized data access |
| time window | fromDate/toDate | huge processing, wrong report |
| mode | dryRun, force, reprocess | bypass safety |
| output | outputFormat, destination | data exfiltration |
| external | endpoint, partnerCode | wrong integration target |
| tuning | partitionCount, commitInterval | overload |
| feature flag | includePII, skipValidation | compliance breach |

### 10.2 Validation layers

Parameter validation should include:

1. Type validation
2. Required/optional validation
3. Enum validation
4. Range validation
5. Cross-field validation
6. Authorization validation
7. Risk validation
8. Operational validation
9. Duplicate validation
10. Redaction classification

Example:

```java
public ValidatedBatchParameters validateAgeingJob(Map<String, String> raw, Actor actor) {
    String agencyId = requireEnum(raw, "agencyId", allowedAgenciesFor(actor));
    LocalDate asOfDate = requireDate(raw, "asOfDate");
    boolean dryRun = parseBoolean(defaultValue(raw, "dryRun", "true"));

    if (asOfDate.isAfter(LocalDate.now())) {
        throw new InvalidBatchParameterException("asOfDate cannot be in the future");
    }

    if (!dryRun && !actor.hasPermission("batch:case-ageing:commit")) {
        throw new ForbiddenBatchParameterException("Commit mode requires stronger permission");
    }

    String businessKey = "case-ageing:" + agencyId + ":" + asOfDate;

    return ValidatedBatchParameters.builder()
        .put("agencyId", agencyId, Sensitivity.INTERNAL)
        .put("asOfDate", asOfDate.toString(), Sensitivity.INTERNAL)
        .put("dryRun", Boolean.toString(dryRun), Sensitivity.PUBLIC_AUDIT_SAFE)
        .businessKey(businessKey)
        .idempotencyKey(hash("case-ageing", agencyId, asOfDate, dryRun))
        .build();
}
```

### 10.3 Reject unknown parameters

Unknown parameter should not be silently ignored.

Bad:

```text
skipValidation=true
```

If application ignores it today, a future version may start honoring it accidentally.

Better:

```text
Unknown parameter: skipValidation
```

### 10.4 Parameter hash

Store a hash of canonical parameter representation.

```text
parameterHash = SHA-256(canonicalJson(parameters))
```

Uses:

- detect tampering;
- compare approved parameter vs executed parameter;
- evidence integrity;
- duplicate detection;
- reproduce execution.

---

## 11. Secrets Handling

Batch often needs credentials:

- database credential;
- external API token;
- SFTP key;
- object storage credential;
- encryption key;
- signing key;
- partner client secret.

### 11.1 Never pass secrets as job parameters

Bad:

```text
apiClientSecret=abc123
sftpPassword=password123
token=eyJhbGciOi...
```

Problems:

- stored in job repository;
- appears in logs;
- visible in admin UI;
- included in error report;
- hard to rotate;
- leaks via thread dump/config dump.

Better:

```text
credentialRef=partner-registry-prod
```

Execution resolves secret from approved secret source:

```text
credentialRef -> Secret Manager / Vault / KMS / SSM / server credential store
```

### 11.2 Secret reference validation

Even `credentialRef` must be validated.

Example:

| Job | Allowed credentialRef |
|---|---|
| registry-sync | `registry-prod`, `registry-uat` |
| email-bulk-send | `mail-gateway-prod` |
| report-upload | `s3-report-prod` |

Do not allow arbitrary secret reference.

### 11.3 Token lifecycle

Batch duration can exceed token lifetime.

Design:

- short-lived access token;
- refresh under lock;
- do not log token;
- handle 401 once with refresh;
- avoid token refresh storm in partitioned job;
- store refresh metadata without secret leakage.

---

## 12. Sensitive Data Handling

### 12.1 Data classification

Classify fields.

| Classification | Example | Handling |
|---|---|---|
| Public | batch name | log allowed |
| Internal | case ID | log with care |
| Confidential | investigation notes | mask/restrict |
| PII | name, email, phone, identifier | minimize/mask/encrypt |
| Legal-sensitive | enforcement decision, appeal outcome | strict audit |
| Secret | tokens/passwords/keys | never log/store raw |

### 12.2 Minimize payload in batch metadata

Do not store full records in:

- job parameters;
- checkpoint info;
- MDC;
- error message;
- listener context;
- execution properties;
- notification text.

Prefer references:

```text
recordId=CASE-2026-000123
inputManifestId=MANIFEST-2026-06-17-001
errorReportId=ERR-982211
```

### 12.3 Checkpoint safety

Checkpoint must be serializable and durable, but not a dumping ground.

Bad checkpoint:

```java
public class BadCheckpoint implements Serializable {
    List<ApplicantRecord> alreadyReadRecords; // contains PII
    String apiToken;
    String rawCsvLineWithSensitiveData;
}
```

Better checkpoint:

```java
public class SafeCheckpoint implements Serializable {
    long lastProcessedOffset;
    String lastBusinessKey;
    String inputManifestId;
    String fileChecksum;
}
```

### 12.4 Error detail strategy

Do not put sensitive details in generic logs.

Use layered error detail:

```text
Operational log:
  executionId=982211 recordRef=CASE-00123 errorCode=INVALID_STATUS

Restricted error table:
  recordRef=CASE-00123 details=<encrypted/masked business detail>

User-facing report:
  row=152 status=FAILED reason=Invalid case status transition
```

---

## 13. Audit Trail Design

Audit trail harus bisa menjawab “what happened” secara defensible.

### 13.1 Audit dimensions

Minimal dimensions:

| Dimension | Example |
|---|---|
| jobName | `case-ageing-recalculation` |
| requestId | `REQ-20260617-0001` |
| executionId | `982211` |
| jobInstanceId | runtime-specific |
| requestedBy | `fajar.nugraha` |
| approvedBy | `supervisor.akbar` |
| executedBy | `svc-batch-case` |
| requestTime | timestamp |
| startTime | timestamp |
| endTime | timestamp |
| parametersRedacted | JSON |
| parameterHash | SHA-256 |
| inputManifest | ID/checksum |
| outputManifest | ID/checksum |
| recordCounts | success/failed/skipped/retried |
| finalStatus | completed/failed/stopped |
| exitStatus | business exit status |
| codeVersion | git SHA/build version |
| configVersion | config hash |
| nodeId | pod/host |
| reason | business justification |

### 13.2 Audit events

Record events, not just final row.

```text
JOB_REQUEST_SUBMITTED
JOB_REQUEST_APPROVED
JOB_REQUEST_REJECTED
JOB_STARTED
STEP_STARTED
CHUNK_COMMITTED
RECORD_SKIPPED
RETRY_EXHAUSTED
JOB_STOP_REQUESTED
JOB_STOPPED
JOB_FAILED
JOB_COMPLETED
OUTPUT_GENERATED
OUTPUT_DOWNLOADED
JOB_RESTART_REQUESTED
JOB_RESTARTED
JOB_ABANDONED
```

### 13.3 Audit log should be append-only

Avoid overwriting evidence.

Bad:

```sql
UPDATE batch_audit SET status = 'COMPLETED' WHERE execution_id = ?;
```

Better:

```sql
INSERT INTO batch_audit_event (... event_type, event_time, payload_hash ...);
```

Maintain projection table separately for dashboard.

```text
append-only audit event table  -> source of evidence
batch execution summary table  -> query/dashboard projection
```

### 13.4 Audit and observability are different

| Aspect | Observability | Audit |
|---|---|---|
| Purpose | diagnose system behavior | prove business/action history |
| Audience | engineers/operators | auditors/business/legal/security |
| Retention | shorter | longer |
| Mutability | can aggregate/drop | should be immutable/tamper-evident |
| Content | latency, queue, error | actor, decision, input, output, reason |
| Sensitive data | should avoid | may contain restricted evidence |

Do not rely only on application logs for audit.

---

## 14. Input Manifest and Output Manifest

For compliance, batch file/report jobs need manifests.

### 14.1 Input manifest

Input manifest records what input was processed.

Example:

```json
{
  "manifestId": "IN-MANIFEST-20260617-001",
  "sourceType": "S3_OBJECT",
  "sourceUri": "s3://internal-bucket/inbox/case-update-20260617.csv",
  "fileName": "case-update-20260617.csv",
  "sizeBytes": 81237721,
  "sha256": "...",
  "recordCountDeclared": 120000,
  "recordCountRead": 120000,
  "receivedAt": "2026-06-17T01:00:00Z",
  "validatedAt": "2026-06-17T01:03:00Z",
  "schemaVersion": "case-update-v3",
  "producer": "external-registry"
}
```

### 14.2 Output manifest

Output manifest records what output was produced.

```json
{
  "manifestId": "OUT-MANIFEST-20260617-001",
  "executionId": 982211,
  "outputs": [
    {
      "type": "SUCCESS_REPORT",
      "uri": "s3://restricted/reports/success-982211.csv.enc",
      "sha256": "...",
      "recordCount": 119700
    },
    {
      "type": "ERROR_REPORT",
      "uri": "s3://restricted/reports/errors-982211.csv.enc",
      "sha256": "...",
      "recordCount": 300
    }
  ],
  "generatedAt": "2026-06-17T02:30:00Z",
  "retentionClass": "REGULATORY_7_YEARS"
}
```

### 14.3 Why manifests matter

Manifests help answer:

- was the input complete?
- did we process the right file?
- did file change after approval?
- did output match expected count?
- can output be verified later?
- can job be replayed safely?

---

## 15. Approval and Maker-Checker Pattern

High-risk batch should not run based on one actor action.

### 15.1 When approval is needed

Require approval for jobs that:

- mutate many business records;
- trigger external communication;
- export sensitive data;
- perform legal/regulatory status changes;
- reprocess historical data;
- override validation;
- run outside normal schedule;
- use broad data scope such as `ALL`;
- require emergency/manual intervention.

### 15.2 Maker-checker invariant

```text
requestedBy != approvedBy
```

Also:

```text
approver must have permission for same or broader scope
approver must see parameter summary and risk summary
approved parameter hash must equal executed parameter hash
```

### 15.3 Approval record

```json
{
  "requestId": "REQ-20260617-0001",
  "approvedBy": "supervisor.akbar",
  "approvedAt": "2026-06-17T09:12:00+07:00",
  "approvalDecision": "APPROVED",
  "approvalReason": "Verified monthly recalculation scope",
  "approvedParameterHash": "...",
  "riskClass": "C4"
}
```

---

## 16. Dry Run, Preview, and Commit Mode

For risky jobs, support dry run.

### 16.1 Dry run semantics

Dry run should answer:

- how many records would be affected?
- which categories would change?
- what errors would occur?
- what external side effects would be scheduled?
- what output would be generated?

Dry run must not:

- mutate final business state;
- send external notification;
- update legal status;
- write irreversible output as official;
- consume one-time external operation.

### 16.2 Preview artifact

Dry run can produce preview report.

```text
request -> dry run -> preview report -> approval -> commit run
```

### 16.3 Parameter hash link

Commit run should link to dry-run result.

```text
dryRunParameterHash == commitParameterHash except dryRun=false
```

Or define canonical comparison that ignores the `dryRun` flag.

### 16.4 Caveat

Dry run is not a perfect prediction if data changes between dry run and commit.

Mitigation:

- snapshot input;
- lock input manifest;
- use `asOfDate`;
- compare expected affected count;
- expire approval after time window;
- require re-approval if drift is too high.

---

## 17. Record-Level Evidence

Some jobs need only summary. Others need record-level evidence.

### 17.1 When record-level evidence is needed

Use record-level audit if job:

- changes regulatory/legal status;
- sends correspondence;
- applies penalty;
- changes assignment/escalation;
- imports external decisions;
- skips invalid records;
- generates official report.

### 17.2 Record-level result table

```sql
CREATE TABLE batch_record_result (
    execution_id       BIGINT NOT NULL,
    step_name          VARCHAR(200) NOT NULL,
    partition_id       VARCHAR(100),
    record_ref         VARCHAR(200) NOT NULL,
    idempotency_key    VARCHAR(300),
    result_status      VARCHAR(40) NOT NULL,
    error_code         VARCHAR(100),
    error_message_safe VARCHAR(1000),
    attempt_count      INT NOT NULL,
    before_hash        VARCHAR(128),
    after_hash         VARCHAR(128),
    processed_at       TIMESTAMP NOT NULL,
    PRIMARY KEY (execution_id, step_name, record_ref)
);
```

### 17.3 Before/after hash

For sensitive data, do not store full before/after snapshot unless required.

Store hash:

```text
beforeHash = hash(canonicalBusinessStateBefore)
afterHash  = hash(canonicalBusinessStateAfter)
```

This supports tamper detection without excessive data retention.

### 17.4 Full snapshot caution

Full snapshot may be required for some compliance cases, but it increases:

- data storage risk;
- privacy risk;
- retention obligation;
- breach impact;
- access-control complexity.

Use it deliberately.

---

## 18. Output Access Control

Generating output securely is only half the problem. Downloading/viewing it must also be governed.

### 18.1 Output classification

```text
outputClassification = PUBLIC_INTERNAL | CONFIDENTIAL | PII | LEGAL_SENSITIVE | SECRET
```

### 18.2 Access rules

| Output type | Access |
|---|---|
| aggregate metrics | operator/support |
| success report with case refs | business owner |
| error report with PII | restricted data role |
| legal decision export | legal/regulatory role |
| secret/token diagnostic | should not exist |

### 18.3 Download audit

Audit every sensitive output access:

```text
OUTPUT_DOWNLOAD_REQUESTED
OUTPUT_DOWNLOAD_GRANTED
OUTPUT_DOWNLOAD_DENIED
OUTPUT_DOWNLOAD_COMPLETED
```

Include:

- actor;
- output manifest id;
- reason;
- IP/device if applicable;
- timestamp;
- retention class;
- access policy version.

### 18.4 Time-limited access

Prefer short-lived signed access for object storage.

But signed URL alone is not authorization. Authorization must happen before issuing URL.

---

## 19. Retention and Archival

Batch evidence has lifecycle.

### 19.1 Retention categories

| Artifact | Example retention |
|---|---:|
| technical logs | 30–180 days |
| metrics | 30–395 days |
| audit event | 3–7+ years depending regulation |
| official report output | 7+ years |
| temporary staging file | hours/days |
| error report with PII | shortest necessary |
| checkpoint state | until restart window expires |
| job repository metadata | operational + audit requirement |

Actual retention must follow organization/legal policy.

### 19.2 Retention invariant

```text
temporary data should not outlive its purpose
regulatory evidence should not disappear before its obligation
```

### 19.3 Archive manifest

When archiving evidence:

```json
{
  "archiveBatchId": "ARCH-20260617-001",
  "artifactType": "BATCH_OUTPUT",
  "artifactId": "OUT-MANIFEST-20260617-001",
  "sourceUri": "...",
  "archiveUri": "...",
  "sourceSha256": "...",
  "archiveSha256": "...",
  "archivedAt": "2026-06-17T10:00:00Z",
  "retentionUntil": "2033-06-17"
}
```

### 19.4 Deletion audit

Deletion must also be auditable.

```text
ARTIFACT_RETENTION_EXPIRED
ARTIFACT_DELETE_REQUESTED
ARTIFACT_DELETED
ARTIFACT_DELETE_FAILED
```

---

## 20. Compliance-Oriented Batch Design for Regulatory Systems

Dalam sistem regulatori/enforcement, batch sering mempengaruhi lifecycle case.

Contoh:

- auto escalation if SLA breached;
- nightly ageing calculation;
- compliance risk score refresh;
- external registry sync;
- enforcement letter generation;
- survey/report aggregation;
- appeal deadline evaluation;
- licence renewal expiry processing.

### 20.1 Regulatory invariants

Untuk batch seperti ini, invariants penting:

```text
No case status changes without traceable rule version.
No escalation without input evidence.
No correspondence without recipient/output audit.
No penalty recalculation without parameter/config version.
No restart that duplicates official side effects.
No manual override without reason and approver.
```

### 20.2 Rule versioning

Jika batch memakai rule:

```text
ruleSetId=ENFORCEMENT_ESCALATION_V7
ruleSetHash=SHA-256(...)
```

Audit harus tahu rule mana yang dipakai.

### 20.3 Config versioning

Jika batch memakai config:

- threshold;
- SLA days;
- risk weight;
- agency mapping;
- template version;
- external endpoint mapping;

simpan config hash/version.

### 20.4 Template versioning

Untuk correspondence/report:

```text
templateId=NOTICE_OF_NON_COMPLIANCE
templateVersion=2026.06.01
templateHash=...
```

Agar nanti bisa menjelaskan isi surat yang dikirim.

---

## 21. Batch Security Architecture Pattern

### 21.1 Reference architecture

```text
+-------------------+
| Admin UI/API       |
+---------+---------+
          |
          v
+-------------------+
| AuthN/AuthZ Layer  |
| SecurityContext    |
+---------+---------+
          |
          v
+----------------------------+
| Batch Control Service       |
| - job catalog               |
| - parameter validation      |
| - permission check          |
| - approval policy           |
| - duplicate prevention      |
| - audit event               |
+------------+---------------+
             |
             v
+----------------------------+
| Job Request Repository      |
| immutable request/evidence  |
+------------+---------------+
             |
             v
+----------------------------+
| JobOperator Wrapper         |
+------------+---------------+
             |
             v
+----------------------------+
| Jakarta Batch Runtime       |
| JSL / batchlet / chunk      |
+------------+---------------+
             |
             v
+----------------------------+
| Evidence and Output Layer   |
| audit / manifest / report   |
+----------------------------+
```

### 21.2 Job catalog

Create explicit job catalog.

```java
public record BatchJobDefinition(
    String name,
    String jslName,
    RiskClass riskClass,
    Set<String> allowedOperations,
    ParameterSchema parameterSchema,
    ApprovalPolicy approvalPolicy,
    OutputPolicy outputPolicy,
    RetentionPolicy retentionPolicy
) {}
```

This prevents arbitrary job names from being launched.

### 21.3 Parameter schema

```java
public record ParameterSpec(
    String name,
    ParameterType type,
    boolean required,
    Sensitivity sensitivity,
    boolean affectsBusinessKey,
    boolean requiresApprovalWhenChanged,
    Set<String> allowedValues
) {}
```

---

## 22. Example: Secure Batch Start Flow

### 22.1 Command

```java
public record StartBatchCommand(
    String jobName,
    Map<String, String> parameters,
    String reason
) {}
```

### 22.2 Submit endpoint

```java
@Path("/batch/requests")
@ApplicationScoped
public class BatchRequestResource {

    @Inject BatchControlService batchControlService;

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response submit(StartBatchCommand command) {
        BatchRequestId requestId = batchControlService.submit(command);
        return Response.accepted(Map.of("requestId", requestId.value())).build();
    }
}
```

### 22.3 Approval endpoint

```java
@Path("/batch/requests/{requestId}/approval")
@ApplicationScoped
public class BatchApprovalResource {

    @Inject BatchApprovalService approvalService;

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    public Response approve(@PathParam("requestId") String requestId,
                            ApprovalDecisionCommand command) {
        approvalService.decide(new BatchRequestId(requestId), command);
        return Response.noContent().build();
    }
}
```

### 22.4 Launcher

```java
@ApplicationScoped
public class ApprovedBatchLauncher {

    @Inject BatchControlService controlService;
    @Inject BatchRequestRepository repository;

    public void launchReadyRequests() {
        List<BatchRequestId> ready = repository.findApprovedReadyToRun(50);
        for (BatchRequestId id : ready) {
            try {
                controlService.startApproved(id);
            } catch (Exception e) {
                repository.markLaunchFailed(id, safeMessage(e));
            }
        }
    }
}
```

### 22.5 Why separate submit and launch?

Benefits:

- approval can happen asynchronously;
- duplicate prevention centralized;
- scheduler can launch approved jobs;
- REST request does not need to block;
- retries can handle temporary runtime error;
- audit state exists before `JobOperator.start`.

---

## 23. Example: Audit Event Writer

```java
@ApplicationScoped
public class BatchAuditService {

    @Inject AuditEventRepository repository;

    public void recordSubmitted(BatchJobRequest request) {
        repository.append(AuditEvent.builder()
            .type("BATCH_JOB_REQUEST_SUBMITTED")
            .businessKey(request.businessKey())
            .actor(request.requestedBy())
            .requestId(request.id().value())
            .jobName(request.jobName())
            .payloadRedacted(request.redactedPayload())
            .payloadHash(request.parameterHash())
            .occurredAt(Instant.now())
            .build());
    }

    public void recordStarted(BatchJobRequest request, long executionId) {
        repository.append(AuditEvent.builder()
            .type("BATCH_JOB_STARTED")
            .actor("svc-batch")
            .requestId(request.id().value())
            .executionId(executionId)
            .jobName(request.jobName())
            .payloadHash(request.parameterHash())
            .occurredAt(Instant.now())
            .build());
    }
}
```

Important:

- payload redacted;
- hash retained;
- actor explicit;
- append-only;
- event type stable.

---

## 24. Example: Secure Listener for Evidence

```java
@Named
public class EvidenceJobListener implements JobListener {

    @Inject JobContext jobContext;
    @Inject BatchEvidenceService evidenceService;

    @Override
    public void beforeJob() {
        Properties p = jobContext.getProperties();

        evidenceService.recordJobStarted(
            p.getProperty("requestId"),
            jobContext.getExecutionId(),
            p.getProperty("requestedBy"),
            p.getProperty("approvedBy"),
            p.getProperty("parameterHash")
        );
    }

    @Override
    public void afterJob() {
        evidenceService.recordJobFinished(
            jobContext.getExecutionId(),
            jobContext.getBatchStatus().name(),
            jobContext.getExitStatus()
        );
    }
}
```

Listener is for evidence, not hidden business logic.

---

## 25. Handling Stop, Restart, and Abandon Securely

### 25.1 Stop

Stop can be operationally sensitive.

Questions:

- Who requested stop?
- Why?
- Is stop safe now?
- Will partial output be marked invalid?
- Are external side effects already emitted?

Audit:

```text
JOB_STOP_REQUESTED actor reason timestamp
JOB_STOP_ACKNOWLEDGED runtime timestamp
JOB_STOPPED final checkpoint timestamp
```

### 25.2 Restart

Restart must validate:

- original execution status;
- checkpoint exists;
- parameter compatibility;
- code/config compatibility;
- side-effect idempotency;
- input manifest still available;
- output from previous run handled;
- requester has restart permission.

### 25.3 Abandon

Abandon means runtime should no longer consider execution restartable.

Require:

- strong permission;
- mandatory reason;
- impact assessment;
- audit event;
- link to replacement execution if any.

---

## 26. Secure Error Handling

### 26.1 Do not leak internal details

Bad API response:

```json
{
  "error": "ORA-01017 invalid username/password; logon denied for user BATCH_PROD with password ..."
}
```

Better:

```json
{
  "errorCode": "BATCH_LAUNCH_FAILED",
  "message": "Batch request could not be launched. Contact support with correlationId.",
  "correlationId": "corr-982211"
}
```

### 26.2 Error code catalog

Create stable error codes.

```text
BATCH_PARAM_INVALID
BATCH_PERMISSION_DENIED
BATCH_DUPLICATE_ACTIVE_REQUEST
BATCH_APPROVAL_REQUIRED
BATCH_INPUT_MANIFEST_NOT_FOUND
BATCH_RESTART_NOT_ALLOWED
BATCH_OUTPUT_ACCESS_DENIED
BATCH_SECRET_REF_DENIED
BATCH_EXECUTION_FAILED
```

### 26.3 Restricted diagnostics

Full diagnostics should go to restricted channel/table.

---

## 27. Multi-Tenant / Multi-Agency Batch Security

For multi-agency systems, parameter scope and data scope must align.

### 27.1 Scope invariant

```text
actor.allowedAgencyScope must contain jobParameter.agencyId
```

For `agencyId=ALL`:

```text
requires global permission + approval + risk elevation
```

### 27.2 Partition scope

Partitioning by tenant/agency can improve security and audit.

```text
partition 0 -> agency A
partition 1 -> agency B
partition 2 -> agency C
```

Each partition result should record scope.

### 27.3 Cross-tenant output risk

Never combine tenant-sensitive output unless consumer is authorized for all included scopes.

---

## 28. Kubernetes / Cloud Runtime Security Considerations

When Jakarta Batch runs on Kubernetes/EKS/OpenShift/etc, add infrastructure security.

### 28.1 Pod identity

Use least-privilege service account.

Do not give batch pod broad permissions if job only needs specific secret/object path.

### 28.2 Object storage policy

Restrict:

- input bucket path;
- output bucket path;
- quarantine path;
- archive path;
- KMS key usage.

### 28.3 Temporary storage

Watch:

- local `/tmp` files;
- shared PVC;
- node ephemeral disk;
- crash dumps;
- heap dumps;
- JFR files.

Sensitive temporary files must be:

- encrypted if needed;
- permission restricted;
- deleted after use;
- excluded from generic support bundle.

### 28.4 Deployment version

Record:

- image digest;
- git SHA;
- config map version;
- secret version reference;
- JSL version.

---

## 29. Testing Security, Audit, and Compliance

### 29.1 Authorization tests

Test matrix:

| Scenario | Expected |
|---|---|
| unauthenticated start | denied |
| unauthorized job | denied |
| authorized view only tries start | denied |
| operator starts low-risk job | accepted |
| operator starts high-risk job | approval required |
| same user approves own request | denied |
| approver outside scope | denied |
| unknown job name | denied/not found safe |
| unknown parameter | rejected |
| broad scope without permission | denied |

### 29.2 Parameter tampering tests

- change parameter after approval;
- add unknown parameter;
- modify date range;
- switch `dryRun=false`;
- change output destination;
- use unauthorized credentialRef;
- use path traversal in output path;
- use huge partition count.

### 29.3 Audit completeness tests

For each job:

- submitted event exists;
- approved/rejected event exists if applicable;
- started event exists;
- finished event exists;
- parameter hash matches;
- output manifest exists;
- error report exists if errors;
- actor fields populated;
- code/config version recorded.

### 29.4 Data leakage tests

Scan logs/output/checkpoints for:

- token;
- password;
- NRIC/passport/identifier;
- email/phone/address;
- raw payload;
- stack trace with secret;
- signed URL;
- full SQL with sensitive bind values.

### 29.5 Restart security tests

- unauthorized restart denied;
- restart with changed parameter denied unless explicit policy;
- restart after code version incompatible denied/warned;
- restart with missing input manifest denied;
- restart after partial external side effect uses idempotency.

---

## 30. Production Checklist

### 30.1 Control plane

- [ ] All batch operations go through application control service.
- [ ] `JobOperator` is not directly exposed.
- [ ] Job catalog whitelist exists.
- [ ] Permission is job-specific and operation-specific.
- [ ] High-risk jobs require approval.
- [ ] Maker-checker enforced where needed.
- [ ] Duplicate active request prevention exists.
- [ ] Stop/restart/abandon require permission and reason.

### 30.2 Parameters

- [ ] Unknown parameters rejected.
- [ ] Parameter types validated.
- [ ] Parameter ranges validated.
- [ ] Parameter scope authorized.
- [ ] Parameter hash stored.
- [ ] Redacted parameter JSON stored separately.
- [ ] Secrets are not passed as parameters.
- [ ] Credential references are whitelisted.

### 30.3 Data protection

- [ ] Sensitive fields classified.
- [ ] Logs redacted.
- [ ] Checkpoint state does not contain secrets/PII payload.
- [ ] Temporary files are controlled.
- [ ] Output encrypted/restricted where needed.
- [ ] Error reports are masked or restricted.

### 30.4 Audit/evidence

- [ ] requestedBy, approvedBy, executedBy captured.
- [ ] requestId and executionId linked.
- [ ] input manifest captured.
- [ ] output manifest captured.
- [ ] checksum captured.
- [ ] record counts captured.
- [ ] skipped/retried/failed records captured.
- [ ] code/config/template/rule versions captured.
- [ ] audit events are append-only.
- [ ] sensitive output download audited.

### 30.5 Retention

- [ ] Retention class defined per artifact.
- [ ] Temporary data cleanup exists.
- [ ] Evidence retention meets policy.
- [ ] Archive checksum recorded.
- [ ] Deletion is audited.

---

## 31. Anti-Patterns

### 31.1 Exposing raw JobOperator

```text
/admin/batch/start?job=anything
```

This bypasses governance.

### 31.2 `ROLE_ADMIN` does everything

Too coarse for sensitive workload.

### 31.3 Logging raw record payload

Debug convenience becomes compliance breach.

### 31.4 Storing secrets in job parameters

Job repository becomes secret leak.

### 31.5 Audit only says `SYSTEM`

Not defensible.

### 31.6 Restart without idempotency

Can duplicate side effects.

### 31.7 Approval without parameter hash

Approver may approve one thing while runtime executes another.

### 31.8 Output generated securely but downloaded freely

Output access is part of security boundary.

### 31.9 Checkpoint contains sensitive full payload

Checkpoint is operational state, not payload archive.

### 31.10 Listener as hidden business policy

Makes audit and testing unclear.

---

## 32. Design Exercise: Enforcement Escalation Batch

Scenario:

Nightly batch escalates cases whose response deadline has passed.

Required behavior:

- read open cases;
- evaluate SLA rule;
- update escalation status;
- generate audit evidence;
- optionally generate correspondence;
- support dry run;
- support restart;
- avoid duplicate escalation;
- allow manual run by supervisor.

### 32.1 Secure parameter schema

```text
asOfDate: required date, cannot be future
agencyId: required enum or ALL with global permission
mode: DRY_RUN | COMMIT
ruleSetId: required, must be active
sendCorrespondence: boolean, requires approval if true
```

### 32.2 Authorization

```text
DRY_RUN agency scope -> batch:escalation:preview
COMMIT agency scope  -> batch:escalation:commit + approval
ALL scope            -> global escalation permission + approval
sendCorrespondence   -> correspondence permission + approval
```

### 32.3 Evidence

Capture:

- requestId;
- executionId;
- requestedBy;
- approvedBy;
- executedBy;
- asOfDate;
- agencyId;
- ruleSetId/ruleSetHash;
- cases evaluated;
- cases escalated;
- cases skipped;
- correspondence generated;
- output manifest;
- error report.

### 32.4 Idempotency

Natural key:

```text
caseId + escalationRuleId + asOfDate
```

Before writing escalation:

```sql
INSERT INTO case_escalation_event (... idempotency_key ...)
VALUES (...)
```

with unique constraint on idempotency key.

### 32.5 Audit event

```json
{
  "eventType": "CASE_ESCALATED_BY_BATCH",
  "caseId": "CASE-2026-00123",
  "executionId": 982211,
  "requestId": "REQ-20260617-0001",
  "ruleSetId": "ESCALATION_V7",
  "ruleHash": "...",
  "requestedBy": "scheduler",
  "approvedBy": "POLICY:PRE_APPROVED",
  "executedBy": "svc-batch-enforcement",
  "occurredAt": "2026-06-17T02:10:00Z"
}
```

---

## 33. Top 1% Mental Model

A strong engineer sees batch security as a set of invariants.

```text
No operation without authorization.
No high-risk operation without approval.
No execution without immutable request.
No approval without parameter hash.
No side effect without idempotency.
No output without access policy.
No sensitive data in logs/checkpoints.
No restart without compatibility check.
No compliance claim without evidence.
No evidence without retention policy.
```

This is the difference between:

```text
“we have a batch job”
```

and:

```text
“we have a governed, auditable, secure, restartable workload execution system.”
```

---

## 34. Ringkasan

Security, audit, dan compliance untuk batch workload mencakup tiga plane:

1. **Control plane**  
   Mengatur siapa boleh melakukan apa: start, stop, restart, approve, abandon, download, inspect.

2. **Execution plane**  
   Menjalankan job dengan parameter yang valid, identity yang jelas, idempotency, restartability, dan least privilege.

3. **Evidence plane**  
   Membuktikan input, output, actor, approval, parameter, code/config version, record result, error, checksum, dan retention.

Jakarta Batch menyediakan execution model dan `JobOperator`, tetapi application tetap harus membangun governance layer. `JobOperator` sendiri tidak memaksakan security constraints secara universal; karena itu production-grade system harus memiliki wrapper/control plane sendiri.

Dalam sistem regulatori, batch bukan pekerjaan belakang layar biasa. Batch dapat menjadi bagian dari decision pipeline, enforcement lifecycle, correspondence generation, dan audit evidence. Karena itu desainnya harus defensible sejak awal.

---

## 35. Latihan / Thought Experiment

### Latihan 1

Ambil satu batch job yang kamu kenal. Tentukan:

- risk class;
- allowed operations;
- required permissions;
- approval policy;
- parameter schema;
- output classification;
- retention policy.

### Latihan 2

Untuk job yang bisa di-restart, jawab:

- apakah restart boleh dilakukan siapa saja?
- apakah parameter boleh berubah?
- apakah side effect sudah idempotent?
- apakah output sebelumnya invalidated?
- apakah audit membedakan first execution dan restart execution?

### Latihan 3

Buat audit event list untuk job `bulk-correspondence-generation`.

Minimal event:

- request submitted;
- approved;
- started;
- template resolved;
- recipient manifest created;
- correspondence generated;
- correspondence sent;
- failed recipient recorded;
- output manifest created;
- job completed.

### Latihan 4

Cari lima tempat potensial PII bocor dalam batch system:

- parameter;
- log;
- checkpoint;
- error report;
- output file;
- temp file;
- notification;
- trace;
- dashboard;
- support bundle.

Untuk setiap tempat, definisikan mitigation.

---

## 36. Koneksi ke Part Berikutnya

Bagian ini membahas bagaimana batch workload diamankan dan dibuat defensible.

Part berikutnya akan membahas:

**Part 33 — Design Patterns and Anti-Patterns**

Kita akan mengompilasi pattern-pattern utama dari seluruh seri sejauh ini:

- async command;
- durable job request;
- outbox-driven batch;
- idempotent writer;
- resumable reader;
- checkpointed file ingestion;
- fan-out/fan-in;
- bulkhead executor;
- cluster singleton scheduler;
- batch control plane;
- dan anti-pattern yang harus dihindari.

---

## 37. Status Seri

Seri belum selesai.

Saat ini selesai sampai:

```text
Part 32 — Security, Audit, and Compliance for Batch Workloads
```

Berikutnya:

```text
Part 33 — Design Patterns and Anti-Patterns
File: 33-design-patterns-and-anti-patterns.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 31 — Performance Engineering for Jakarta Batch](./31-performance-engineering-jakarta-batch.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 33 — Design Patterns and Anti-Patterns](./33-design-patterns-and-anti-patterns.md)

</div>
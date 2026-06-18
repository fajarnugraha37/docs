# learn-java-bpmn-camunda-process-orchestration-engineering

## Part 6 — Java Client Engineering: From API Call to Production-grade Worker

> Seri: **Java BPMN, Camunda, Process Orchestration Engineering**  
> Target: engineer Java yang ingin naik dari sekadar “bisa memanggil Camunda API” menjadi engineer yang mampu membangun **production-grade process worker architecture** untuk long-running business process.  
> Scope Java: Java 8 sampai Java 25.  
> Fokus utama: Camunda 8 Java Client, job worker, lifecycle, reliability, idempotency, error handling, concurrency, graceful shutdown, observability, dan boundary dengan domain service.

---

# 0. Posisi Part Ini dalam Seri

Pada Part 0 sampai Part 5, kita membangun fondasi:

1. BPMN bukan gambar, tetapi kontrak eksekusi.
2. Process engine bukan database domain, tetapi coordinator.
3. Camunda 8/Zeebe memiliki runtime berbasis broker, gateway, partition, stream processor, job activation, dan exporter.
4. Worker Java adalah tempat business logic dan integration logic hidup.

Part ini masuk ke titik krusial:

> Bagaimana cara menulis Java client dan job worker yang benar-benar layak production?

Bukan sekadar:

```java
client.newCompleteCommand(job.getKey()).send().join();
```

Tetapi memahami:

- kapan command berhasil tapi response gagal diterima,
- kapan worker crash setelah side effect,
- kapan job timeout lalu diambil worker lain,
- kapan retry engine berbeda dari retry aplikasi,
- kapan BPMN error lebih tepat daripada fail job,
- kapan variable update menjadi kontrak proses,
- bagaimana mendesain worker agar bisa diskalakan horizontal,
- bagaimana menjaga worker aman saat rolling deployment,
- bagaimana menggunakan Java modern tanpa merusak reliability model.

---

# 1. Referensi Versi dan Terminologi

Camunda 8 mengalami perubahan penting pada API/client naming.

Pada Camunda 8.8, **Camunda Java Client** menggantikan **Zeebe Java Client**. Dokumentasi resmi Camunda menyebut Camunda Java Client sebagai pengganti Zeebe Java Client mulai versi 8.8, dengan REST sebagai default protocol dan gRPC tetap dapat dikonfigurasi. Zeebe Java Client direncanakan dihapus pada Camunda 8.10.

Konsekuensinya:

- Untuk proyek baru, gunakan **Camunda Java Client**.
- Hindari membuat desain baru yang bergantung penuh pada package/class lama Zeebe Client.
- Untuk legacy Camunda 8.7 ke bawah, masih banyak contoh memakai `ZeebeClient`; pahami konsepnya, tetapi arah migrasinya ke Camunda client baru.
- Untuk Spring Boot, Camunda menyediakan Spring Boot Starter untuk integrasi Camunda 8 API melalui REST/gRPC.

Dalam materi ini, istilah yang dipakai:

| Istilah | Makna |
|---|---|
| Camunda Java Client | Client Java modern untuk Camunda 8 orchestration cluster |
| Zeebe | Process automation engine di Camunda 8 |
| Gateway | Entry point client ke Zeebe cluster |
| Broker | Node runtime yang memproses command/event process |
| Job | Unit work yang dibuat engine ketika token mencapai service task |
| Job worker | Aplikasi eksternal yang mengambil job, menjalankan logic, lalu complete/fail/error |
| Job type | String contract antara BPMN service task dan worker |
| Activated job | Job yang sudah diberikan engine kepada worker untuk dikerjakan |
| Job timeout | Durasi lock/lease job; bila habis, job bisa diaktifkan lagi oleh worker lain |
| BPMN error | Business error yang dilempar ke process model dan dapat ditangkap boundary error event |
| Incident | Keadaan proses stuck karena engine tidak bisa melanjutkan tanpa intervensi |

---

# 2. Mental Model Utama: Java Client Bukan ORM untuk Process Engine

Kesalahan awal yang sering terjadi adalah menganggap Camunda client seperti repository atau ORM:

```text
Application -> Camunda Client -> Save process state
```

Model ini menyesatkan.

Model yang lebih benar:

```text
Java Application
  ├─ sends command to orchestration cluster
  ├─ subscribes/activates jobs from orchestration cluster
  ├─ executes business/integration side effects
  ├─ reports completion/failure/business error
  └─ maintains its own domain consistency/idempotency
```

Camunda client adalah **command and work API** menuju process runtime.

Ia bukan:

- domain repository,
- transaction manager aplikasi,
- replacement database,
- message broker umum,
- remote procedure call wrapper,
- magic exactly-once executor.

Camunda/Zeebe mengoordinasikan flow. Worker Java menjalankan kerja nyata.

Implikasinya:

1. Worker harus idempotent.
2. Worker harus bisa dipanggil ulang.
3. Worker tidak boleh bergantung pada assumption “job hanya sekali dieksekusi”.
4. Worker harus memisahkan business failure dari technical failure.
5. Worker harus mengontrol external side effect dengan baik.
6. Worker harus punya observability sendiri.
7. Domain database tetap menjadi source of truth domain.
8. Process variable hanya membawa process execution context yang perlu.

---

# 3. Java Client Responsibility Map

Camunda Java Client biasanya dipakai untuk beberapa kelompok operasi.

## 3.1 Deployment Operation

Untuk deploy BPMN/DMN/resource:

```text
Java App / CI Pipeline
  -> deploy resource
  -> process definition version created
```

Dalam production, deployment sering lebih cocok dilakukan oleh pipeline, bukan oleh aplikasi runtime setiap startup.

Anti-pattern:

```text
Every application startup deploys BPMN blindly.
```

Risikonya:

- versi process terus bertambah tanpa kontrol,
- rollback sulit,
- environment drift,
- audit deployment tidak jelas,
- model yang belum disetujui bisa ikut terdeploy.

Production-grade approach:

```text
CI/CD pipeline
  -> validate BPMN
  -> run process tests
  -> deploy BPMN to target environment
  -> record artifact version
  -> link deployment to release/change ticket
```

## 3.2 Process Instance Operation

Untuk memulai process:

```text
client
  .newCreateInstanceCommand()
  .bpmnProcessId("application-review-process")
  .latestVersion()
  .variables(vars)
  .send()
```

Pertanyaan desain penting:

- Siapa yang boleh start process?
- Apa idempotency key untuk start process?
- Apakah satu application hanya boleh punya satu active process?
- Apakah process start harus sinkron dengan domain transaction?
- Bagaimana jika domain entity sudah created tapi process start gagal?
- Bagaimana jika process start berhasil tapi response timeout?

## 3.3 Message Operation

Untuk publish/correlate message ke process yang sedang menunggu:

```text
External event
  -> application receives event
  -> publish message to Camunda with correlation key
  -> waiting process continues
```

Hal kritis:

- correlation key harus stabil,
- message name harus contract-level,
- duplicate message harus aman,
- message TTL harus sesuai race condition,
- event arrival before wait state harus dipikirkan.

## 3.4 Job Worker Operation

Ini pusat Part 6.

Worker:

```text
1. subscribe/activate job by type
2. receive job variables
3. execute business/integration logic
4. complete job with output variables
   or fail job with retry decrement
   or throw BPMN error
```

Service task di BPMN tidak menjalankan Java code secara embedded. Ia membuat job yang diambil worker.

## 3.5 Query/Operate Operation

Camunda 8 memisahkan write-side engine dengan read-side/exporter/tools seperti Operate. Untuk operasi support, query runtime sering dilakukan melalui Operate/API terkait, bukan memperlakukan broker sebagai database query bebas.

Mental model:

```text
Write side:
  Command -> Zeebe broker -> event stream -> state transition

Read side:
  Exporter -> Operate/Search storage -> operational query
```

---

# 4. Anatomy of a Production-grade Worker

Worker minimal:

```java
worker = client
    .newWorker()
    .jobType("send-notification")
    .handler((jobClient, job) -> {
        // do work
        jobClient.newCompleteCommand(job.getKey()).send().join();
    })
    .open();
```

Production worker seharusnya dipikirkan sebagai komponen dengan boundary jelas:

```text
JobWorker Adapter
  -> validate input variables
  -> create execution context/correlation id
  -> call application service
  -> classify result/failure
  -> write idempotency/audit/outbox if needed
  -> complete/fail/throw BPMN error
  -> emit logs/metrics/traces
```

Struktur ideal:

```text
com.example.workflow
  ├─ client
  │   └─ CamundaClientConfig
  ├─ worker
  │   ├─ SendNotificationWorker
  │   ├─ ValidateApplicationWorker
  │   └─ GenerateDocumentWorker
  ├─ contract
  │   ├─ variables
  │   ├─ errors
  │   └─ jobtypes
  ├─ service
  │   └─ domain application services
  ├─ idempotency
  │   └─ ProcessedJobRepository
  ├─ observability
  │   └─ WorkflowObservation
  └─ support
      └─ WorkerErrorClassifier
```

Worker bukan tempat semua logic dicampur.

Worker adalah adapter antara:

```text
Process runtime contract <-> Domain/application service
```

---

# 5. Job Type sebagai Public Contract

Job type terlihat seperti string sederhana:

```text
validate-application
send-email
create-invoice
sync-to-external-system
```

Namun dalam production, job type adalah **contract** antara BPMN model dan worker deployment.

Jika BPMN service task memakai job type `validate-application`, maka minimal harus ada worker yang:

1. aktif di environment tersebut,
2. subscribe job type tersebut,
3. compatible dengan variable contract,
4. compatible dengan expected BPMN output/error,
5. punya permission/credential untuk side effect yang dibutuhkan.

## 5.1 Naming Convention Job Type

Buruk:

```text
service-task-1
javaDelegate
processStep
handle
callApi
```

Lebih baik:

```text
application.validate-submission
application.reserve-case-number
document.generate-notice
notification.send-case-update
external.sync-license-registry
payment.verify-receipt
```

Pattern:

```text
<bounded-context>.<business-capability>
```

Contoh:

```text
case.assign-officer
case.calculate-sla
case.generate-referral-letter
enforcement.create-inspection-task
appeal.register-appeal
```

Keuntungan:

- jelas ownership-nya,
- mudah routing worker,
- mudah observability,
- mudah capacity planning,
- mudah review BPMN,
- menghindari string generik yang tidak bermakna.

## 5.2 Job Type Versioning

Pertanyaan sulit:

> Jika input/output contract berubah, apakah job type perlu diganti?

Jawaban: tergantung kompatibilitas.

Backward-compatible change:

```text
Input lama tetap diterima.
Output lama tetap tersedia.
Field baru optional.
```

Bisa tetap pakai job type sama.

Breaking change:

```text
Input wajib berubah.
Output lama hilang.
Error code berubah.
Meaning berubah.
```

Pertimbangkan versioned job type:

```text
application.validate-submission.v2
```

Namun jangan versioning terlalu cepat. Banyak organisasi akhirnya punya:

```text
validate-v1
validate-v2
validate-v3-final
validate-new
validate-new2
```

Lebih baik buat compatibility policy.

---

# 6. Variable Contract di Worker

Worker menerima variables dari process.

Kesalahan umum:

```java
Map<String, Object> vars = job.getVariablesAsMap();
String id = (String) vars.get("id");
```

Ini cepat, tetapi rapuh.

Production-grade worker perlu explicit contract.

## 6.1 Input DTO

Contoh:

```java
public final class ValidateApplicationInput {
    private String applicationId;
    private String applicantType;
    private String submittedBy;
    private String correlationId;

    public String getApplicationId() { return applicationId; }
    public String getApplicantType() { return applicantType; }
    public String getSubmittedBy() { return submittedBy; }
    public String getCorrelationId() { return correlationId; }
}
```

Worker:

```java
ValidateApplicationInput input = objectMapper.readValue(
    job.getVariables(),
    ValidateApplicationInput.class
);
```

Atau jika client menyediakan helper mapping:

```java
ValidateApplicationInput input = job.getVariablesAsType(ValidateApplicationInput.class);
```

Manfaat DTO:

- contract terlihat,
- validation bisa eksplisit,
- testing lebih mudah,
- schema evolution lebih terkontrol,
- error handling bisa lebih akurat,
- tidak semua variable proses terbaca sembarangan.

## 6.2 Output DTO / Map Minimal

Worker sebaiknya hanya mengembalikan variable yang diperlukan proses.

Buruk:

```java
Map<String, Object> output = Map.of(
    "application", fullApplicationEntity,
    "officer", officerEntity,
    "documents", allDocuments,
    "config", config
);
```

Lebih baik:

```java
Map<String, Object> output = Map.of(
    "validationStatus", "PASSED",
    "riskLevel", "LOW",
    "requiresManualReview", false
);
```

Prinsip:

> Worker output harus berupa process signal, bukan dump domain aggregate.

## 6.3 Variable Scope Discipline

Variable global process tidak boleh menjadi tempat sampah.

Gunakan prinsip:

| Data | Simpan di mana? |
|---|---|
| Domain entity lengkap | Domain database |
| Document content/file | Object storage/document service |
| Process routing decision | Process variable |
| External request/response besar | Audit/integration log, bukan process variable penuh |
| Sensitive PII | Minimize/mask/reference |
| Correlation id | Process variable + log MDC |
| Business key | Process variable + domain DB |

---

# 7. Command Lifecycle: Send, Persist, Response, and Ambiguity

Saat Java client mengirim command:

```text
client -> gateway -> broker -> stream -> state transition -> response
```

Failure tidak selalu berarti command tidak terjadi.

## 7.1 Ambiguous Failure Window

Contoh:

```text
T1 client sends create process command
T2 gateway forwards command
T3 broker accepts command and creates process instance
T4 network fails before response reaches client
T5 client sees timeout
```

Dari sisi client:

```text
timeout
```

Dari sisi engine:

```text
process instance already created
```

Jika aplikasi retry tanpa idempotency, bisa membuat process instance ganda.

## 7.2 Implication for Start Process

Buruk:

```java
public void submitApplication(String applicationId) {
    client.newCreateInstanceCommand()
        .bpmnProcessId("application-review")
        .latestVersion()
        .variables(Map.of("applicationId", applicationId))
        .send()
        .join();
}
```

Jika timeout, caller tidak tahu process sudah start atau belum.

Lebih aman:

```text
Domain DB:
  application_id
  workflow_start_requested_at
  workflow_process_instance_key nullable
  workflow_status
  start_command_id / idempotency_key
```

Lalu gunakan pattern:

```text
1. Persist domain submission.
2. Persist workflow start request with idempotency key.
3. Start process.
4. Store returned processInstanceKey.
5. If timeout, reconcile by business key / start request state / operational query.
```

Atau gunakan outbox:

```text
Domain transaction
  -> insert application
  -> insert outbox event APPLICATION_SUBMITTED

Outbox publisher
  -> start process
  -> mark outbox processed
```

---

# 8. Create Process Instance from Java

Conceptual code:

```java
Map<String, Object> variables = Map.of(
    "applicationId", applicationId,
    "businessKey", applicationId,
    "submittedBy", userId,
    "correlationId", correlationId
);

ProcessInstanceEvent event = client
    .newCreateInstanceCommand()
    .bpmnProcessId("application-review-process")
    .latestVersion()
    .variables(variables)
    .send()
    .join();

long processInstanceKey = event.getProcessInstanceKey();
```

Design review questions:

1. Is `applicationId` unique?
2. Can the same application start multiple processes?
3. What if user double-clicks submit?
4. What if frontend retries HTTP request?
5. What if backend times out after process was created?
6. Where is `processInstanceKey` stored?
7. Who can cancel/migrate/repair this process later?
8. How do support users find the process from business ID?

Production pattern:

```text
application table
  id
  workflow_process_instance_key
  workflow_process_definition_id
  workflow_version
  workflow_status
  workflow_correlation_id
```

---

# 9. Deploying BPMN from Java vs Pipeline

You can deploy from Java:

```java
client.newDeployResourceCommand()
    .addResourceFromClasspath("bpmn/application-review.bpmn")
    .send()
    .join();
```

But production deployment should be intentional.

## 9.1 Local/Dev Use

Good for:

- local developer iteration,
- integration tests,
- demo apps,
- ephemeral environments.

## 9.2 Production Use

Prefer:

```text
BPMN artifact stored in repository
  -> validate BPMN
  -> process tests
  -> approval/change process
  -> deploy via CI/CD
  -> tag release
  -> record deployment metadata
```

Why?

Because BPMN is executable business behavior.

Deploying BPMN is closer to deploying code than uploading a diagram.

## 9.3 Deployment Metadata

Record:

- Git commit SHA,
- BPMN file checksum,
- process ID,
- process version,
- environment,
- deployer,
- change ticket,
- release version,
- deployment timestamp.

This matters for audit and rollback investigation.

---

# 10. Publish Message and Correlation Key

Message publish conceptual code:

```java
client.newPublishMessageCommand()
    .messageName("PaymentReceived")
    .correlationKey(applicationId)
    .timeToLive(Duration.ofHours(2))
    .variables(Map.of(
        "paymentReference", paymentReference,
        "paidAt", paidAt.toString()
    ))
    .send()
    .join();
```

Message design is one of the most failure-prone parts.

## 10.1 Message Name

Message name should represent business event, not technical source.

Bad:

```text
kafka-message
callback
api-response
payment-service-event
```

Better:

```text
PaymentReceived
ApplicantResubmittedDocument
ExternalRegistryConfirmed
InspectionCompleted
AppealSubmitted
```

## 10.2 Correlation Key

Correlation key must be stable and deterministic.

Common candidates:

- application ID,
- case ID,
- appeal ID,
- payment reference,
- external request ID.

Avoid:

- random generated ID unknown to sender,
- mutable status,
- user display name,
- email address if user can change it,
- non-unique business attribute.

## 10.3 Message Race

Failure scenario:

```text
T1 external callback arrives
T2 app publishes message
T3 process has not yet reached message catch event
T4 message has zero/short TTL
T5 message expires
T6 process waits forever
```

Mitigation:

- appropriate message TTL,
- event inbox table,
- retry publisher,
- process design that creates subscription before external request,
- correlate by stable key,
- operational dashboard for unmatched callbacks.

---

# 11. Complete Job Correctly

Simplified:

```java
jobClient.newCompleteCommand(job.getKey())
    .variables(Map.of("approved", true))
    .send()
    .join();
```

But completion happens after work. The hard part is what happens before completion.

## 11.1 Side Effect Before Complete

Example:

```text
Worker sends email
Worker completes job
```

Failure:

```text
T1 Worker sends email successfully
T2 Worker crashes before complete command
T3 Job timeout expires
T4 Another worker picks same job
T5 Email sent again
```

Therefore:

```text
Side effect must be idempotent or deduplicated.
```

## 11.2 Complete Before Side Effect?

Alternative:

```text
Worker completes job
Worker sends email
```

Failure:

```text
T1 Worker completes job
T2 Process moves on
T3 Worker crashes before sending email
T4 Email never sent
```

So completing first is usually wrong for required side effects.

## 11.3 Correct Pattern

Use idempotency/outbox:

```text
Worker receives job
  -> within domain transaction:
      insert notification_outbox if not exists by idempotency key
      mark job side-effect requested/processed
  -> commit
  -> complete job

Outbox publisher sends email exactly-once-ish with provider idempotency/dedup
```

Or:

```text
Worker receives job
  -> check processed_job table
  -> if already processed, complete job with same output
  -> else do idempotent business action
  -> record result
  -> complete job
```

---

# 12. Fail Job vs Throw BPMN Error

This distinction is critical.

## 12.1 `failJob`

Use for technical failure where the same BPMN path should retry or eventually incident.

Examples:

- REST API timeout,
- database temporary unavailable,
- network error,
- rate limit,
- deadlock,
- transient authentication token issue,
- worker dependency temporarily down.

Meaning:

```text
The task could not be completed now.
Try again later / reduce retries / create incident if exhausted.
```

## 12.2 BPMN Error

Use for business failure that should be handled by the process model.

Examples:

- applicant is ineligible,
- validation failed,
- payment rejected,
- document invalid,
- external registry says license does not exist,
- duplicate active application detected,
- officer cannot approve own submission.

Meaning:

```text
The business outcome is known.
Continue process via modeled error path.
```

## 12.3 Incident

Incident means process cannot advance without intervention.

Examples:

- retries exhausted,
- unhandled BPMN error,
- missing variable causes expression failure,
- job worker repeatedly fails,
- message correlation/design issue creates stuck process.

## 12.4 Decision Table

| Situation | Worker Action | BPMN Modeling |
|---|---|---|
| External API timeout | Fail job | Retry/incident |
| Validation says rejected | Throw BPMN error or complete with status | Boundary error / gateway |
| Required variable missing due to model bug | Fail job, likely incident | Fix model/data |
| Applicant document invalid | BPMN error or output `documentValid=false` | Resubmission path |
| Email service down | Fail job | Retry then incident/escalation |
| Email address invalid | BPMN error/business output | Ask applicant to correct |
| Unauthorized worker credential | Fail job, incident | Ops/security repair |
| Duplicate callback | Ignore/idempotent complete | No BPMN error |

## 12.5 Anti-pattern

Bad:

```text
Every exception -> fail job
```

This turns business outcomes into incidents.

Also bad:

```text
Every exception -> BPMN error
```

This hides technical failures as business branches.

Top-tier worker design needs **failure classification**.

---

# 13. Worker Error Classifier

A good worker has explicit error taxonomy.

```java
public enum WorkflowFailureType {
    TECHNICAL_RETRYABLE,
    TECHNICAL_NON_RETRYABLE,
    BUSINESS_ERROR,
    VALIDATION_CONTRACT_ERROR,
    SECURITY_ERROR,
    DUPLICATE_ALREADY_PROCESSED
}
```

Classifier:

```java
public final class WorkerErrorClassifier {

    public WorkflowFailure classify(Throwable t) {
        if (t instanceof ExternalTimeoutException) {
            return WorkflowFailure.retryable("EXTERNAL_TIMEOUT");
        }
        if (t instanceof RateLimitException) {
            return WorkflowFailure.retryableWithBackoff("RATE_LIMITED", Duration.ofMinutes(1));
        }
        if (t instanceof ApplicantIneligibleException) {
            return WorkflowFailure.bpmnError("APPLICANT_INELIGIBLE");
        }
        if (t instanceof InvalidWorkerInputException) {
            return WorkflowFailure.nonRetryableIncident("INVALID_WORKER_INPUT");
        }
        return WorkflowFailure.retryable("UNKNOWN_TECHNICAL_ERROR");
    }
}
```

Worker handler:

```java
try {
    Output output = service.execute(input);
    complete(job, output);
} catch (Throwable t) {
    WorkflowFailure failure = classifier.classify(t);
    handleFailure(job, failure, t);
}
```

This looks bureaucratic, but it prevents chaos in production.

---

# 14. Retry Design

Retry can happen in many layers:

```text
HTTP client retry
DB retry
Spring retry
Worker retry
Camunda job retry
BPMN timer retry
Manual retry
```

Uncontrolled retry creates retry storm.

## 14.1 Retry Layer Rule

Use the lowest sensible retry for very short transient glitches.

Use Camunda job retry for workflow-level task retry.

Use BPMN timer retry for business-visible waiting/retry.

Example:

| Failure | Suggested Retry Layer |
|---|---|
| HTTP connection reset once | HTTP client short retry |
| External service down for minutes | Camunda job retry/backoff |
| Payment pending for hours | BPMN timer/event loop |
| Applicant must resubmit document | BPMN human flow |
| Database deadlock | transaction retry or job retry |
| Invalid input contract | no retry; incident/repair |

## 14.2 Retry Count Meaning

Do not set retries blindly.

Bad:

```text
retries = 999
```

Bad:

```text
retries = 0 for all failures
```

Design retry by failure class:

```text
External timeout: 3 retries with exponential backoff
Rate limit: retry after 60s/180s/300s
Invalid payload: 0 retry -> incident
Business rejection: BPMN error -> no technical retry
```

## 14.3 Backoff

Backoff prevents hammering dependencies.

A worker failure command can include retry backoff depending on API/client capability.

Conceptual:

```java
jobClient.newFailCommand(job.getKey())
    .retries(job.getRetries() - 1)
    .retryBackoff(Duration.ofSeconds(30))
    .errorMessage("External registry timeout")
    .send()
    .join();
```

## 14.4 Retry Exhaustion

When retries reach zero, incident appears.

Incident is not always bad. It is an operational stop sign:

```text
Process cannot safely continue.
Human/operator must inspect.
```

But high incident count means design or dependency problem.

---

# 15. Idempotency: The Non-negotiable Worker Requirement

Camunda job workers operate in a distributed system. Job timeout can cause a job to be reassigned to another worker. Documentation notes that a timeout may lead to two workers working on the same job, and only one completion succeeds while the other can be rejected.

Therefore:

> Any production worker must tolerate duplicate execution.

## 15.1 Idempotency Key Candidates

| Candidate | Use Case |
|---|---|
| `jobKey` | Unique activation job, but not always ideal for business side effect dedup across retries |
| `processInstanceKey` | Per process instance dedup |
| `elementInstanceKey` | Per BPMN element execution; often useful for service task side effect |
| `applicationId + stepName` | Business stable dedup |
| external command ID | Best for external API idempotency if supported |
| outbox event ID | Best for async side effect |

For service task side effect, a strong pattern:

```text
idempotency_key = processInstanceKey + ':' + elementInstanceKey + ':' + jobType
```

Or business-level:

```text
idempotency_key = applicationId + ':send-submission-confirmation'
```

Choice depends on whether repeated process step should repeat side effect.

## 15.2 Idempotency Table

```sql
CREATE TABLE workflow_idempotency_record (
    idempotency_key        VARCHAR(200) PRIMARY KEY,
    process_instance_key   VARCHAR(50) NOT NULL,
    element_instance_key   VARCHAR(50),
    job_type               VARCHAR(150) NOT NULL,
    business_key           VARCHAR(100),
    status                 VARCHAR(30) NOT NULL,
    result_json            CLOB,
    error_code             VARCHAR(100),
    created_at             TIMESTAMP NOT NULL,
    updated_at             TIMESTAMP NOT NULL
);
```

Statuses:

```text
STARTED
SUCCEEDED
FAILED_BUSINESS
FAILED_TECHNICAL
```

## 15.3 Idempotent Worker Flow

```text
Worker receives job
  -> compute idempotency key
  -> try insert STARTED
      if duplicate and SUCCEEDED:
          complete job with stored output
      if duplicate and STARTED too old:
          decide takeover/retry safely
      if duplicate and FAILED_BUSINESS:
          throw same BPMN error
  -> execute business logic
  -> store result
  -> complete job
```

Pseudo Java:

```java
public void handle(JobClient jobClient, ActivatedJob job) {
    WorkerContext ctx = WorkerContext.from(job);
    String key = idempotencyKey(ctx);

    IdempotencyRecord existing = repository.find(key);
    if (existing != null && existing.isSucceeded()) {
        complete(jobClient, job, existing.resultAsMap());
        return;
    }

    repository.insertStartedIfAbsent(key, ctx);

    try {
        Output output = service.execute(inputFrom(job));
        repository.markSucceeded(key, output);
        complete(jobClient, job, output.toVariables());
    } catch (BusinessException e) {
        repository.markBusinessFailed(key, e.code());
        throwBpmnError(jobClient, job, e.code(), e.getMessage());
    } catch (Exception e) {
        repository.markTechnicalFailed(key, e);
        fail(jobClient, job, e);
    }
}
```

---

# 16. Worker Transaction Boundary

Worker often touches domain DB and Camunda engine.

There is no single ACID transaction across:

```text
Domain DB + Camunda broker + external API
```

So you must design for partial failure.

## 16.1 Domain DB Then Complete Job

```text
T1 update domain DB
T2 complete Camunda job
```

Failure between T1 and T2:

```text
Domain updated, job not completed, job retries, duplicate domain update risk.
```

Mitigation:

- idempotency record,
- domain operation naturally idempotent,
- unique constraint,
- compare-and-set state transition,
- complete with stored result on retry.

## 16.2 Complete Job Then Domain DB

```text
T1 complete Camunda job
T2 update domain DB
```

Failure between T1 and T2:

```text
Process moved on, domain DB not updated.
```

Usually worse.

## 16.3 Recommended Default

For required domain side effect:

```text
1. Make side effect durable/idempotent in domain DB.
2. Complete job after durable success.
3. On retry, detect prior success and complete again.
```

## 16.4 Outbox for External Side Effects

For email, webhook, file transfer, external API:

```text
Worker transaction:
  -> store domain state
  -> insert outbox command
  -> mark worker idempotency succeeded
  -> complete job

Outbox dispatcher:
  -> sends external side effect
  -> retries independently
  -> records provider response
```

But be careful:

If process must wait until actual external success, then outbox dispatch completion should correlate back via message or another worker step.

---

# 17. Worker Concurrency Model

Worker concurrency is controlled by:

- number of application instances,
- number of workers per instance,
- max jobs active,
- handler thread pool,
- job timeout,
- external dependency throughput,
- DB pool size,
- CPU/memory,
- rate limits.

## 17.1 Max Jobs Active

`maxJobsActive` controls how many jobs a worker can have activated but not completed.

Too low:

```text
underutilization
```

Too high:

```text
job timeout risk
memory pressure
DB pool exhaustion
external API overload
long tail latency
```

Rule of thumb:

```text
maxJobsActive <= handlerConcurrency * expectedProcessingWindowFactor
```

If a handler takes 5 seconds and job timeout is 30 seconds, don't activate hundreds of jobs per instance unless you can truly process them.

## 17.2 Thread Pool Size

For blocking IO worker:

```text
thread count roughly tied to concurrent IO calls
```

For CPU-heavy worker:

```text
thread count roughly tied to CPU cores
```

For virtual threads Java 21+:

- useful for blocking IO concurrency,
- not magic for external rate limits,
- not magic for DB pool limits,
- still needs max jobs active discipline.

## 17.3 DB Connection Pool Constraint

If worker concurrency is 100 but DB pool is 20, you may create backlog.

Capacity equation:

```text
effective throughput = min(
  engine job supply,
  worker concurrency,
  DB capacity,
  external API rate limit,
  CPU capacity,
  downstream queue capacity
)
```

## 17.4 External Rate Limit

If external API allows 300/min, do not set worker concurrency to 500 and hope retry fixes it.

Use:

- rate limiter,
- bulkhead,
- token bucket,
- worker partition by tenant/domain,
- retry backoff on 429.

---

# 18. Job Timeout / Activation Timeout

Job timeout is a lease.

```text
Worker activates job for 30 seconds.
If not completed/failed before timeout, job can be activated again.
```

## 18.1 Timeout Too Short

Risk:

```text
long-running handler still working
job reactivated by another worker
duplicate side effect
completion rejected for one worker
```

## 18.2 Timeout Too Long

Risk:

```text
worker crashes
job waits too long before retry
slow recovery
SLA delay
```

## 18.3 Timeout Design

Set timeout based on:

```text
P99 handler duration + network margin + downstream variability
```

But if task can take minutes, ask:

> Should this be one service task or should it be modeled as async request + message callback?

Example:

Bad:

```text
Service task calls external system and blocks 15 minutes.
```

Better:

```text
Service task sends request
  -> complete
  -> process waits at message catch event
  -> external callback/message resumes process
```

---

# 19. Long-running External Calls: Do Not Hold Job Forever

A worker should not hold a job while waiting for human/external async work.

Bad:

```text
Worker starts external verification
Worker polls every 30s inside same job handler
Worker completes after 20 minutes
```

Problems:

- job timeout tuning becomes ugly,
- worker thread occupied,
- duplicate execution risk,
- poor visibility,
- hard cancellation,
- hard SLA modeling.

Better BPMN:

```text
Service Task: Send verification request
  -> Intermediate Message Catch: VerificationCompleted
  -> Continue
```

Java:

```text
Worker sends request with correlation key
Completes job
External callback arrives later
Application publishes message to Camunda
```

This aligns with BPMN long-running process semantics.

---

# 20. Graceful Shutdown

Rolling deployment can break workers if shutdown is careless.

Bad shutdown:

```text
Kubernetes sends SIGTERM
App exits immediately
Activated jobs are abandoned
Jobs timeout later
Process delayed
Side effects may be mid-flight
```

Production shutdown should:

1. stop accepting/activating new jobs,
2. allow in-flight jobs to finish within grace period,
3. fail or release safely if possible,
4. close client,
5. emit shutdown logs/metrics.

Conceptual:

```java
@PreDestroy
public void shutdown() {
    worker.close(); // stop fetching new jobs
    executor.shutdown();
    executor.awaitTermination(30, TimeUnit.SECONDS);
    client.close();
}
```

Kubernetes:

```yaml
terminationGracePeriodSeconds: 60
```

Readiness:

```text
Before shutdown: readiness false
Then stop worker activation
Then drain
```

## 20.1 Shutdown and Idempotency

Even graceful shutdown can be interrupted.

Therefore graceful shutdown reduces duplicates but does not replace idempotency.

---

# 21. Worker Health Check

A worker service can be “UP” from HTTP perspective but useless for workflow.

Health should consider:

- can app reach Camunda gateway?
- are credentials valid?
- can worker activate jobs?
- is domain DB reachable?
- are critical downstream dependencies reachable?
- is worker not overloaded?
- are queues/outbox not stuck?

But avoid health checks that overload Camunda.

Separate:

```text
liveness: app process alive
readiness: app ready to receive/activate work
workflow health: operational metric/dashboard
```

---

# 22. Observability in Java Worker

Worker logs need process context.

At minimum include:

- process instance key,
- process definition id,
- element id,
- element instance key,
- job key,
- job type,
- business key/application id,
- correlation id,
- attempt/retry count,
- worker instance id.

## 22.1 MDC Pattern

```java
try (MdcScope scope = MdcScope.put(Map.of(
    "processInstanceKey", String.valueOf(job.getProcessInstanceKey()),
    "elementId", job.getElementId(),
    "jobKey", String.valueOf(job.getKey()),
    "jobType", job.getType(),
    "businessKey", businessKey
))) {
    handler.execute(job);
}
```

Log example:

```text
INFO workflow.worker.started jobType=application.validate-submission processInstanceKey=2251799813685251 applicationId=APP-2026-0001
INFO workflow.worker.completed jobType=application.validate-submission durationMs=183 validationStatus=PASSED
```

## 22.2 Metrics

Recommended metrics:

```text
workflow_worker_jobs_started_total{jobType}
workflow_worker_jobs_completed_total{jobType}
workflow_worker_jobs_failed_total{jobType,errorType}
workflow_worker_bpmn_errors_total{jobType,errorCode}
workflow_worker_duration_seconds{jobType}
workflow_worker_active_jobs{jobType}
workflow_worker_retry_remaining{jobType}
workflow_worker_idempotency_hit_total{jobType}
workflow_worker_external_call_duration_seconds{dependency}
workflow_worker_external_call_failed_total{dependency,errorType}
```

## 22.3 Tracing

A trace should cross:

```text
HTTP request / event consumer
  -> start process / publish message
  -> worker activation
  -> domain service
  -> DB/external API
  -> complete/fail/error command
```

But distributed tracing across async workflow is not automatic. You need correlation IDs.

---

# 23. Security and Credential Handling

Java client needs credentials depending on SaaS/self-managed configuration.

Do not hardcode:

```java
clientSecret = "abc123";
```

Use:

- environment variables,
- Kubernetes Secret,
- AWS SSM/Secrets Manager,
- Vault,
- workload identity where available,
- secret rotation plan.

## 23.1 Principle of Least Privilege

Separate clients for:

- deployment,
- runtime worker,
- operational support,
- reporting/query,
- admin.

Worker should not have admin powers unless needed.

## 23.2 Multi-environment Safety

Use explicit configuration:

```text
CAMUNDA_ENV=dev|uat|prod
CAMUNDA_CLUSTER_ID=...
CAMUNDA_AUTH_URL=...
CAMUNDA_CLIENT_ID=...
```

Add startup guardrails:

```text
Refuse to start prod worker if profile != prod but endpoint is prod.
Refuse to deploy BPMN from local profile to prod.
```

---

# 24. Spring Boot Integration Pattern

Spring Boot worker architecture:

```text
@SpringBootApplication
  -> CamundaClient bean
  -> Worker beans
  -> Domain services
  -> Repositories
  -> Observability
```

## 24.1 Avoid Fat Worker Methods

Bad:

```java
@JobWorker(type = "validate-application")
public Map<String, Object> validate(ActivatedJob job) {
    // parse variables
    // call DB
    // call API
    // decide status
    // send email
    // write audit
    // handle all exceptions
    // return variables
}
```

Better:

```java
@JobWorker(type = JobTypes.VALIDATE_APPLICATION)
public Map<String, Object> validate(ActivatedJob job) {
    return workflowExecutor.execute(job, ValidateApplicationInput.class, service::validate);
}
```

Where `workflowExecutor` centralizes:

- parsing,
- validation,
- MDC,
- metrics,
- failure classification,
- idempotency,
- complete/fail/error if manually controlled.

## 24.2 Annotation vs Programmatic Worker

Spring annotation workers are ergonomic.

Programmatic workers give more explicit lifecycle control.

Use annotation when:

- simple service task,
- conventional config,
- team familiar with starter,
- no special lifecycle requirement.

Use programmatic worker when:

- dynamic job type registration,
- custom executor,
- custom backpressure/rate limit,
- per-worker lifecycle management,
- advanced shutdown behavior.

---

# 25. Java 8 to Java 25 Considerations

The user's target is Java 8–25. BPMN/Camunda engineering should account for mixed runtime realities.

## 25.1 Java 8

Constraints:

- no records,
- no var,
- no virtual threads,
- older TLS/library issues possible,
- older dependency compatibility risk.

Style:

```java
public final class InputDto {
    private String applicationId;
    public String getApplicationId() { return applicationId; }
    public void setApplicationId(String applicationId) { this.applicationId = applicationId; }
}
```

Use:

- explicit DTOs,
- CompletableFuture carefully,
- mature HTTP clients,
- conservative dependency versions.

## 25.2 Java 11/17

Good enterprise baseline.

Use:

- `var` moderately,
- improved TLS/runtime,
- better GC,
- stronger container support,
- records if Java 16+.

## 25.3 Java 21

Useful additions:

- virtual threads,
- structured concurrency preview/incubation depending version,
- better runtime performance,
- modern GC,
- records/sealed classes/pattern matching.

Virtual thread worker consideration:

```text
Good for blocking IO-heavy worker.
Not a replacement for rate limiting.
Not a replacement for idempotency.
Not a replacement for DB pool sizing.
```

## 25.4 Java 25

As a future/current modern Java target in this series, assume:

- prefer language clarity,
- strong records/sealed domain contracts,
- modern concurrency where stable,
- observability-friendly code,
- avoid overusing preview features for core production workflow unless policy permits.

## 25.5 Cross-version Contract

If some services run Java 8 and others Java 21/25:

- keep process variables JSON-compatible,
- avoid Java-specific serialized objects,
- avoid class-name-based serialization,
- use schema/version fields,
- keep worker contract language-neutral where possible.

---

# 26. DTO Design with Records and Sealed Classes

Java 17+ example:

```java
public record ValidateApplicationInput(
    String applicationId,
    String applicantType,
    String submittedBy,
    String correlationId
) {}

public sealed interface ValidateApplicationResult
        permits ValidationPassed, ValidationRejected {}

public record ValidationPassed(String riskLevel) implements ValidateApplicationResult {}

public record ValidationRejected(String reasonCode, String message)
        implements ValidateApplicationResult {}
```

Mapping result to BPMN:

```java
ValidateApplicationResult result = service.validate(input);

if (result instanceof ValidationPassed passed) {
    complete(job, Map.of(
        "validationStatus", "PASSED",
        "riskLevel", passed.riskLevel()
    ));
} else if (result instanceof ValidationRejected rejected) {
    throwBpmnError(job, rejected.reasonCode(), rejected.message());
}
```

This makes business outcomes explicit.

---

# 27. Worker Output as Stable Process Contract

Output variables should be documented like API response fields.

Example job type contract:

```yaml
jobType: application.validate-submission
input:
  applicationId: string, required
  applicantType: string, required
  submittedBy: string, required
output:
  validationStatus: PASSED | REQUIRES_REVIEW
  riskLevel: LOW | MEDIUM | HIGH
bpmnErrors:
  APPLICANT_INELIGIBLE
  DUPLICATE_ACTIVE_APPLICATION
technicalFailures:
  EXTERNAL_REGISTRY_TIMEOUT
  DATABASE_UNAVAILABLE
idempotency:
  key: applicationId + ':validate-submission'
owner:
  team: application-platform
```

This kind of contract prevents BPMN and worker drifting apart.

---

# 28. Worker Registry and Ownership

For large systems, create a worker registry.

| Job Type | Owning Service | Owner Team | Input Contract | Output Contract | BPMN Errors | SLA | Idempotency |
|---|---|---|---|---|---|---|---|
| `application.validate-submission` | application-worker | App Team | v1 | v1 | INELIGIBLE, DUPLICATE | 5s | appId+step |
| `document.generate-notice` | document-worker | Document Team | v2 | v1 | TEMPLATE_NOT_FOUND | 30s | caseId+docType |
| `notification.send-case-update` | notification-worker | Platform Team | v1 | v1 | INVALID_RECIPIENT | 10s | notificationId |

Without ownership, incidents become blame games.

---

# 29. Worker Deployment Topologies

## 29.1 Monolithic Worker Service

```text
one application contains all workers
```

Pros:

- simple deployment,
- shared config,
- easy local development.

Cons:

- scaling all or nothing,
- failure blast radius,
- mixed ownership,
- noisy neighbor between job types.

## 29.2 Domain Worker Service

```text
application-worker
case-worker
document-worker
notification-worker
```

Pros:

- aligns with bounded contexts,
- independent scaling,
- clearer ownership,
- better resource control.

Cons:

- more deployments,
- more configs,
- more coordination.

## 29.3 One Worker per Job Type

Usually too granular unless job is very heavy or regulated.

Pros:

- precise scaling,
- isolation.

Cons:

- operational overhead,
- many services,
- fragmented code.

## 29.4 Recommended Default

Use bounded-context worker services:

```text
one service owns related job types within a domain boundary
```

---

# 30. Worker and Domain State Machine

Many enterprise systems already have domain statuses:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
APPROVED
REJECTED
CANCELLED
```

BPMN process also has state.

Do not duplicate blindly.

## 30.1 Domain State

Answers:

```text
What is the business object status?
```

Used by:

- UI,
- reporting,
- authorization,
- search,
- business rules,
- downstream systems.

## 30.2 Process State

Answers:

```text
Where is the workflow token now?
```

Used by:

- orchestration,
- wait states,
- timers,
- incident repair,
- process monitoring.

## 30.3 Sync Pattern

Worker at key milestones updates domain state idempotently:

```text
Process reaches "Mark Application Under Review"
  -> worker updates application.status = UNDER_REVIEW
  -> complete job
```

But do not mirror every BPMN node into domain status.

Only expose meaningful business milestones.

---

# 31. Testing Java Client and Worker Code

Testing will be covered deeply in Part 20, but Part 6 needs baseline.

## 31.1 Unit Test Worker Service

Test domain service independent of Camunda.

```text
input DTO -> domain service -> result/error
```

## 31.2 Worker Adapter Test

Test:

- variable parsing,
- missing variables,
- output mapping,
- BPMN error mapping,
- fail job mapping,
- idempotency hit.

## 31.3 Integration Test

Test with Camunda test tooling/Testcontainers where appropriate:

```text
deploy BPMN
start process
worker completes job
assert process reaches expected state
```

## 31.4 Failure Tests

Mandatory:

- duplicate job execution,
- worker crash after domain update,
- external timeout,
- BPMN business error,
- retries exhausted,
- invalid variable payload,
- message arrives before wait state.

---

# 32. Example: Regulatory Application Validation Worker

## 32.1 BPMN Service Task

```text
Service Task: Validate Application Submission
Job Type: application.validate-submission
Input:
  applicationId
  submittedBy
Output:
  validationStatus
  riskLevel
BPMN Errors:
  APPLICANT_INELIGIBLE
  DUPLICATE_ACTIVE_APPLICATION
```

## 32.2 Worker Flow

```text
1. Receive job.
2. Extract applicationId.
3. Build idempotency key: applicationId + ':validate-submission'.
4. If previous result exists, complete/throw same result.
5. Load application from domain DB.
6. Validate applicant eligibility.
7. Check duplicate active application.
8. Compute risk level.
9. Persist validation result.
10. Complete job with minimal output variables.
```

## 32.3 Pseudo Code

```java
public final class ValidateApplicationWorker {

    private final ApplicationValidationService service;
    private final WorkflowIdempotencyService idempotency;
    private final WorkerCommandAdapter commandAdapter;

    public void handle(JobClient jobClient, ActivatedJob job) {
        WorkerContext ctx = WorkerContext.from(job);
        ValidateApplicationInput input = ctx.variablesAs(ValidateApplicationInput.class);

        String key = input.applicationId() + ":validate-submission";

        idempotency.withIdempotency(key, ctx, existing -> {
            if (existing.isSucceeded()) {
                commandAdapter.complete(jobClient, job, existing.resultVariables());
                return;
            }
            if (existing.isBusinessFailed()) {
                commandAdapter.throwBpmnError(jobClient, job, existing.errorCode(), existing.errorMessage());
                return;
            }

            try {
                ValidationResult result = service.validate(input.applicationId(), input.submittedBy());

                if (result instanceof ValidationPassed passed) {
                    Map<String, Object> vars = Map.of(
                        "validationStatus", "PASSED",
                        "riskLevel", passed.riskLevel()
                    );
                    idempotency.markSucceeded(key, vars);
                    commandAdapter.complete(jobClient, job, vars);
                    return;
                }

                if (result instanceof ValidationRejected rejected) {
                    idempotency.markBusinessFailed(key, rejected.code(), rejected.message());
                    commandAdapter.throwBpmnError(jobClient, job, rejected.code(), rejected.message());
                    return;
                }

                throw new IllegalStateException("Unknown validation result");

            } catch (ExternalRegistryTimeoutException e) {
                commandAdapter.failRetryable(jobClient, job, e, Duration.ofSeconds(30));
            } catch (Exception e) {
                commandAdapter.failRetryable(jobClient, job, e, Duration.ofSeconds(10));
            }
        });
    }
}
```

This is intentionally verbose. Production workflow code should be explicit about outcome.

---

# 33. Example: Async External Verification Pattern

## 33.1 Bad Model

```text
Service Task: Verify External Registry
  worker calls external API
  worker polls until result ready
  worker completes after 10 minutes
```

## 33.2 Better Model

```text
Service Task: Submit External Registry Verification Request
  -> Intermediate Message Catch: External Registry Verification Completed
  -> Gateway: Result valid?
```

## 33.3 Java Flow

Worker:

```text
submit request to external registry with callback URL and correlation key
store request id
complete job
```

Callback API:

```text
receive external callback
validate signature
persist callback event in inbox
publish Camunda message with correlation key
mark inbox processed
```

This is more production-friendly because:

- worker does not block,
- process explicitly waits,
- callback can be retried,
- timeout can be modeled with timer boundary/intermediate timer,
- support can see waiting state.

---

# 34. Worker Command Adapter

Centralize Camunda command behavior.

```java
public final class WorkerCommandAdapter {

    public void complete(JobClient client, ActivatedJob job, Map<String, Object> variables) {
        client.newCompleteCommand(job.getKey())
            .variables(variables)
            .send()
            .join();
    }

    public void failRetryable(JobClient client, ActivatedJob job, Exception e, Duration backoff) {
        int remaining = Math.max(job.getRetries() - 1, 0);

        client.newFailCommand(job.getKey())
            .retries(remaining)
            .retryBackoff(backoff)
            .errorMessage(safeMessage(e))
            .send()
            .join();
    }

    public void throwBpmnError(JobClient client, ActivatedJob job, String code, String message) {
        client.newThrowErrorCommand(job.getKey())
            .errorCode(code)
            .errorMessage(message)
            .send()
            .join();
    }
}
```

Benefits:

- consistent retry decrement,
- safe error message handling,
- no duplicated command code,
- easier metrics,
- easier migration from Zeebe client to Camunda client,
- easier testing.

---

# 35. Safe Error Messages

Do not put secrets/PII/full stack traces into incident messages.

Bad:

```text
errorMessage = exception.toString() + requestBody + token
```

Better:

```text
errorMessage = "External registry timeout. correlationId=abc, dependency=registry, errorCode=REGISTRY_TIMEOUT"
```

Store detailed debug data in secure logs with proper access control.

Incident messages are operational artifacts and may be visible to support users.

---

# 36. Backward Compatibility with Old Zeebe Client Code

Many examples online still use:

```java
ZeebeClient client = ZeebeClient.newClientBuilder()...
```

Newer direction is Camunda Java Client.

Migration strategy:

1. Isolate client usage behind internal adapter.
2. Avoid leaking client-specific classes deep into domain service.
3. Keep worker contracts independent.
4. Use your own `WorkflowClientPort` and `WorkerCommandPort`.
5. Migrate infrastructure layer without touching domain logic.

Example port:

```java
public interface WorkflowRuntimeClient {
    ProcessStartResult startProcess(String processId, Map<String, Object> variables);
    void publishMessage(String name, String correlationKey, Map<String, Object> variables, Duration ttl);
}
```

This avoids vendor API spread.

---

# 37. Anti-patterns in Java Client Engineering

## 37.1 Worker as Transaction Script Dump

Symptom:

```text
One 500-line handler method.
```

Fix:

```text
Worker adapter + domain service + error classifier + idempotency service.
```

## 37.2 No Idempotency

Symptom:

```text
Duplicate emails, duplicate payments, duplicate case numbers.
```

Fix:

```text
Business idempotency key, unique constraints, outbox/inbox.
```

## 37.3 Process Variables as Database

Symptom:

```text
Full application JSON stored in Camunda variables.
```

Fix:

```text
Store application in domain DB; pass applicationId and routing signals.
```

## 37.4 Blind Retry

Symptom:

```text
Every error retried 10 times.
```

Fix:

```text
Failure classifier.
```

## 37.5 Business Error as Incident

Symptom:

```text
Invalid document creates technical incident.
```

Fix:

```text
Model invalid document path with BPMN error/gateway.
```

## 37.6 Blocking Long External Process in Worker

Symptom:

```text
Worker waits 20 minutes for external approval.
```

Fix:

```text
Send request, complete job, wait for message callback.
```

## 37.7 Deploy on Every Startup

Symptom:

```text
Every pod restart creates new process version.
```

Fix:

```text
CI/CD deployment pipeline.
```

## 37.8 No Operational Context in Logs

Symptom:

```text
NullPointerException in worker.
No processInstanceKey.
No jobType.
No applicationId.
```

Fix:

```text
MDC + structured logs + metrics.
```

---

# 38. Production Checklist for Java Worker

Before promoting worker to production, answer these.

## 38.1 Contract

- What job type does it handle?
- What BPMN models use it?
- What input variables are required?
- What output variables are produced?
- What BPMN errors can it throw?
- What technical errors can it fail with?
- What is the owner team?

## 38.2 Idempotency

- What is the idempotency key?
- What happens if job executes twice?
- What happens if worker crashes after side effect?
- What happens if complete command times out?
- Can duplicate external request be safely handled?

## 38.3 Retry

- Which failures are retryable?
- Which failures are non-retryable?
- What is retry count?
- What is retry backoff?
- What creates incident?
- What should support do when incident appears?

## 38.4 Timeout

- What is P95/P99 duration?
- What is job timeout?
- Can task exceed timeout?
- Should long-running work be modeled as message callback?

## 38.5 Concurrency

- What is max jobs active?
- What is worker thread pool size?
- What is DB pool size?
- What is external API rate limit?
- Can worker be horizontally scaled?
- Does scaling create duplicate side effects?

## 38.6 Observability

- Are processInstanceKey/jobKey/jobType/businessKey logged?
- Are success/failure metrics emitted?
- Are BPMN errors counted?
- Are retries visible?
- Are idempotency hits visible?
- Are external dependency metrics visible?

## 38.7 Security

- Where are credentials stored?
- Does worker have least privilege?
- Are sensitive variables minimized?
- Are error messages sanitized?
- Are audit logs protected?

## 38.8 Deployment

- Does startup deploy BPMN? If yes, why?
- Is graceful shutdown configured?
- Is readiness tied to worker availability?
- Can old and new worker versions run together?
- Is rollback safe?

---

# 39. A Practical Worker Template

Below is a conceptual template. Adapt to actual Camunda Java Client/Spring Starter APIs used by your project version.

```java
public abstract class AbstractWorkflowWorker<I, O> {

    private final ObjectMapper objectMapper;
    private final WorkerErrorClassifier errorClassifier;
    private final WorkerCommandAdapter commandAdapter;
    private final WorkflowIdempotencyService idempotencyService;

    protected AbstractWorkflowWorker(
        ObjectMapper objectMapper,
        WorkerErrorClassifier errorClassifier,
        WorkerCommandAdapter commandAdapter,
        WorkflowIdempotencyService idempotencyService
    ) {
        this.objectMapper = objectMapper;
        this.errorClassifier = errorClassifier;
        this.commandAdapter = commandAdapter;
        this.idempotencyService = idempotencyService;
    }

    public final void handle(JobClient jobClient, ActivatedJob job) {
        WorkerContext ctx = WorkerContext.from(job);

        try (MdcScope ignored = MdcScope.from(ctx)) {
            I input = parseInput(job);
            String idempotencyKey = idempotencyKey(ctx, input);

            IdempotencyRecord existing = idempotencyService.find(idempotencyKey);
            if (existing != null && existing.isTerminal()) {
                replayTerminalResult(jobClient, job, existing);
                return;
            }

            idempotencyService.markStartedIfAbsent(idempotencyKey, ctx);

            O output = execute(input, ctx);
            Map<String, Object> variables = outputVariables(output);

            idempotencyService.markSucceeded(idempotencyKey, variables);
            commandAdapter.complete(jobClient, job, variables);

        } catch (Throwable t) {
            WorkflowFailure failure = errorClassifier.classify(t);
            handleFailure(jobClient, job, failure, t);
        }
    }

    protected abstract Class<I> inputType();

    protected abstract String idempotencyKey(WorkerContext ctx, I input);

    protected abstract O execute(I input, WorkerContext ctx) throws Exception;

    protected abstract Map<String, Object> outputVariables(O output);

    private I parseInput(ActivatedJob job) throws IOException {
        return objectMapper.readValue(job.getVariables(), inputType());
    }

    private void replayTerminalResult(JobClient jobClient, ActivatedJob job, IdempotencyRecord existing) {
        if (existing.isSucceeded()) {
            commandAdapter.complete(jobClient, job, existing.resultVariables());
            return;
        }
        if (existing.isBusinessFailed()) {
            commandAdapter.throwBpmnError(jobClient, job, existing.errorCode(), existing.errorMessage());
            return;
        }
        throw new IllegalStateException("Cannot replay non-terminal idempotency state");
    }

    private void handleFailure(JobClient jobClient, ActivatedJob job, WorkflowFailure failure, Throwable t) {
        switch (failure.type()) {
            case BUSINESS_ERROR -> commandAdapter.throwBpmnError(
                jobClient,
                job,
                failure.code(),
                failure.safeMessage()
            );
            case TECHNICAL_RETRYABLE -> commandAdapter.failRetryable(
                jobClient,
                job,
                t,
                failure.backoff()
            );
            case TECHNICAL_NON_RETRYABLE, VALIDATION_CONTRACT_ERROR, SECURITY_ERROR ->
                commandAdapter.failNonRetryable(jobClient, job, t, failure.safeMessage());
            default -> commandAdapter.failRetryable(jobClient, job, t, Duration.ofSeconds(10));
        }
    }
}
```

The exact API names may differ by client version, but the architecture is stable:

```text
parse -> validate -> idempotency -> execute -> classify -> complete/fail/error -> observe
```

---

# 40. How Top 1% Engineers Think About Camunda Java Client

Average view:

```text
Service task calls Java worker.
Worker does business logic.
Complete job.
```

Top-tier view:

```text
A service task creates a durable work item in a distributed orchestration system.
A Java worker leases that work item under timeout.
The worker may execute more than once.
External side effects may succeed while Camunda completion fails.
Camunda state and domain DB state are not in one transaction.
Every command has ambiguous failure windows.
Business errors and technical failures must be separated.
Process variables are public execution contract, not random Java object memory.
Worker code must be observable, idempotent, version-compatible, and operationally repairable.
```

That mental shift is the difference between a demo and a production workflow platform.

---

# 41. Summary

In this part, we learned:

1. Camunda Java Client is a command/work API, not an ORM.
2. Job type is a public contract between BPMN and worker deployment.
3. Worker input/output variables must be treated like schema contracts.
4. Command timeouts can be ambiguous; retry without idempotency can duplicate process or side effects.
5. `complete`, `fail`, and `throw BPMN error` mean different things.
6. Job workers must be idempotent because duplicate execution is possible.
7. Domain DB and Camunda broker are not in one ACID transaction.
8. Long-running external waits should be modeled as async request + message catch, not blocking worker thread.
9. Worker concurrency must be sized against DB pool, external rate limit, timeout, and throughput.
10. Graceful shutdown helps but does not replace idempotency.
11. Observability must include workflow identifiers.
12. Security must separate deployment/runtime/admin credentials.
13. Java 8–25 differences affect implementation style, but not distributed workflow invariants.
14. Production-grade worker architecture is adapter + domain service + idempotency + error classifier + observability.

---

# 42. References

- Camunda 8 Docs — Java Client Getting Started. Notes that Camunda Java Client replaces Zeebe Java Client as of 8.8, uses REST by default with gRPC configurable, and Zeebe Java Client is planned for removal in 8.10.
- Camunda 8 Docs — Job Workers. Describes job worker behavior, polling/activation, streaming, metrics, multi-tenancy, and production implementation concerns.
- Camunda 8 Docs — Job Worker Concepts. Describes job activation timeout and the possibility that a job can be reassigned to another worker if not completed or failed within timeout.
- Camunda 8 Docs — Dealing with Problems and Exceptions. Explains technical exception handling in job workers and distinction between worker retry behavior and process-level handling.
- Camunda 8 Docs — Incidents. Describes incidents as problems in process execution that prevent a process instance from advancing and require resolution.
- Camunda 8 Docs — Orchestration Cluster API Authentication. Describes authentication and authorization for orchestration cluster APIs.

---

# 43. Status Seri

Selesai sejauh ini:

- Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer
- Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract
- Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses
- Part 3 — BPMN Modeling Discipline: Membuat Process Model yang Bisa Hidup di Production
- Part 4 — Camunda Landscape: Camunda 7 vs Camunda 8
- Part 5 — Camunda 8 Runtime Internals: Zeebe Mental Model
- Part 6 — Java Client Engineering: From API Call to Production-grade Worker

Seri belum selesai.

Berikutnya:

**Part 7 — Job Worker Reliability: Idempotency, Retry, Backoff, Poison Jobs**

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-05-camunda-8-runtime-internals-zeebe-mental-model.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-07-job-worker-reliability-idempotency-retry-backoff-poison-jobs.md)

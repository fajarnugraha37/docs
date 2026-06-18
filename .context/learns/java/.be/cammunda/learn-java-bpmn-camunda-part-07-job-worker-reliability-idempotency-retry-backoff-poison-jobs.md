# learn-java-bpmn-camunda-process-orchestration-engineering

## Part 7 — Job Worker Reliability: Idempotency, Retry, Backoff, Poison Jobs

> Seri: **Java BPMN, Camunda, Process Orchestration Engineering**  
> Level: Advanced / Production Engineering  
> Target: Java 8 hingga Java 25  
> Fokus: reliability worker, failure model, side effect safety, retry strategy, poison job, incident handling, dan production-grade recovery.

---

# 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas:

- BPMN sebagai execution contract.
- Camunda 7 vs Camunda 8.
- Zeebe mental model.
- Java client dan worker architecture.

Sekarang kita masuk ke bagian yang sering membedakan engineer biasa dari engineer yang benar-benar production-minded:

> **Bagaimana memastikan job worker tetap benar walaupun proses dieksekusi ulang, worker crash, network timeout, external API lambat, database commit berhasil tapi complete job gagal, atau job yang sama diambil worker lain?**

Di workflow engine seperti Camunda 8, reliability tidak boleh diasumsikan dari fakta bahwa proses sudah dimodelkan di BPMN.

BPMN hanya memberi struktur eksekusi. Reliability muncul dari desain gabungan antara:

1. BPMN model.
2. Worker implementation.
3. Idempotency strategy.
4. Retry policy.
5. Timeout policy.
6. External system contract.
7. Persistence pattern.
8. Observability.
9. Manual repair path.
10. Operational discipline.

Kalau bagian ini lemah, diagram BPMN yang rapi tetap bisa menghasilkan:

- duplicate payment,
- duplicate email,
- duplicate approval action,
- stuck process,
- invisible failure,
- endless retry,
- inconsistent domain state,
- audit trail yang tidak bisa dipertanggungjawabkan.

Part ini akan membangun mental model dan pattern teknis untuk menghindari itu.

---

# 1. Core Mental Model: Worker Reliability Tidak Sama dengan Method Reliability

Dalam aplikasi Java biasa, kita sering berpikir seperti ini:

```java
public void approveApplication(String applicationId) {
    validate(applicationId);
    updateStatus(applicationId, APPROVED);
    sendEmail(applicationId);
}
```

Kalau method sukses, selesai.
Kalau exception, rollback atau retry.

Tapi di workflow orchestration, satu service task biasanya berada dalam sistem yang lebih kompleks:

```text
Camunda process instance
  -> creates job
      -> worker activates job
          -> worker calls domain service
              -> domain DB writes
              -> external API calls
              -> file/email/payment side effects
          -> worker completes job
              -> engine moves token forward
```

Ada banyak titik gagal:

```text
[1] Worker activated job, then crashed before doing anything.
[2] Worker updated DB, then crashed before completing job.
[3] Worker called external API, external API succeeded, network response lost.
[4] Worker completed job, but client did not receive response.
[5] Job timeout expired while worker was still processing.
[6] Another worker picked up same job after timeout.
[7] Worker failed job repeatedly until retries exhausted.
[8] Incident created, operator retries after fixing data.
[9] Same business command is replayed after deployment restart.
```

Maka aturan dasarnya:

> **A worker must be safe to execute more than once for the same business intent.**

Bukan berarti worker harus selalu menghasilkan side effect berkali-kali. Justru sebaliknya:

> **Worker boleh dipanggil berkali-kali, tetapi business effect harus tetap satu kali secara benar.**

Ini inti idempotency.

---

# 2. At-least-once Execution: Asumsi Paling Aman

Dalam distributed system, kita tidak boleh mendesain worker dengan asumsi exactly-once execution.

Camunda 8 job worker model lebih aman dipahami sebagai:

```text
Engine ensures durable orchestration state.
Worker execution is at-least-once from the business side-effect perspective.
```

Artinya:

- job bisa diaktifkan worker,
- worker diberi timeout,
- kalau tidak selesai dalam timeout, job dapat tersedia lagi,
- worker lain bisa mengambil job yang sama,
- operator bisa retry incident,
- deployment restart bisa mengulang pekerjaan.

Ini bukan bug. Ini konsekuensi normal distributed orchestration.

## 2.1 Kenapa Exactly-once Hampir Selalu Ilusi

Exactly-once sulit karena worker biasanya bicara dengan banyak sistem:

```text
Camunda
  -> Java worker
      -> Application DB
      -> External payment gateway
      -> Email provider
      -> Document service
      -> Audit service
      -> Kafka/RabbitMQ
```

Agar exactly-once benar-benar terjadi, semua sistem itu harus berbagi satu atomic transaction global.

Dalam praktik enterprise modern:

- HTTP API tidak ikut transaksi database lokal.
- Email provider tidak bisa rollback.
- Payment provider tidak bisa dianggap idempotent tanpa idempotency key.
- Kafka publish dan DB commit butuh outbox kalau mau konsisten.
- Camunda completion dan domain DB commit tidak dalam satu local transaction.

Maka pendekatan yang benar bukan mengejar exactly-once execution, melainkan:

> **At-least-once execution + idempotent effect + observable recovery.**

---

# 3. Job Lifecycle Reliability View

Secara sederhana, job worker lifecycle:

```text
Service task reached
  -> job created
  -> worker activates job
  -> job locked/assigned temporarily
  -> worker executes business logic
  -> worker completes job / fails job / throws BPMN error
  -> process token moves / retry scheduled / incident raised / error boundary path taken
```

Reliability concern ada di setiap edge.

## 3.1 Job Created

Engine sudah mencapai service task dan membuat job.

Risiko:

- worker belum tersedia,
- worker type salah,
- job type typo,
- variable missing,
- incompatible worker version.

Mitigasi:

- deployment validation,
- job type constant,
- model-worker compatibility test,
- worker readiness check,
- incident alerting.

## 3.2 Job Activated

Worker mengambil job dengan timeout tertentu.

Risiko:

- worker mengambil terlalu banyak job,
- job timeout terlalu pendek,
- job menunggu di queue internal worker sebelum diproses,
- worker crash,
- worker lambat karena external API.

Mitigasi:

- `maxJobsActive` disesuaikan dengan thread/concurrency aktual,
- timeout lebih besar dari worst-case processing time,
- backpressure,
- worker-level queue monitoring,
- graceful shutdown.

## 3.3 Worker Executes Side Effects

Ini bagian paling berbahaya.

Risiko:

- DB write sukses, complete job gagal,
- external call sukses, response timeout,
- duplicate execution,
- partial side effects,
- non-idempotent downstream.

Mitigasi:

- idempotency key,
- dedup table,
- outbox,
- inbox,
- command status table,
- external reference tracking,
- compensation strategy.

## 3.4 Worker Completes Job

Worker memberi tahu engine bahwa job selesai.

Risiko:

- complete command gagal karena network,
- job sudah timeout,
- job already completed by another worker,
- variables payload invalid,
- engine unavailable sementara.

Mitigasi:

- treat completion failure carefully,
- do not blindly repeat side effect,
- check local idempotency state,
- allow process retry to re-enter safely,
- log correlation.

## 3.5 Worker Fails Job

Worker melaporkan technical failure.

Risiko:

- retry terlalu agresif,
- retry menekan external system yang sedang down,
- retry menyembunyikan business error,
- retries habis dan incident muncul tanpa konteks.

Mitigasi:

- error classification,
- retry count governance,
- backoff,
- incident message yang informatif,
- variable diagnostic minimal.

## 3.6 Worker Throws BPMN Error

Worker menyatakan business exception yang dimodelkan di BPMN.

Risiko:

- semua exception dilempar sebagai BPMN error,
- technical outage dianggap business rejection,
- process lanjut ke jalur salah,
- audit misleading.

Mitigasi:

- pisahkan technical failure vs business outcome,
- BPMN error hanya untuk expected business alternative,
- technical failure gunakan fail job/retry/incident.

---

# 4. Failure Taxonomy: Jangan Samakan Semua Error

Top engineer tidak mulai dari `catch (Exception e)`.

Top engineer mulai dari klasifikasi failure.

## 4.1 Technical Transient Failure

Contoh:

- HTTP 503.
- Connection timeout.
- Database temporary unavailable.
- Rate limit sementara.
- Network partition.
- DNS failure.
- Broker/gateway unavailable.

Karakter:

- mungkin berhasil kalau dicoba lagi,
- tidak mengubah business meaning,
- cocok untuk retry dengan backoff.

Action:

```text
fail job with retries > 0
```

## 4.2 Technical Permanent Failure

Contoh:

- configuration missing,
- invalid credential,
- schema mismatch,
- endpoint salah,
- worker incompatible dengan BPMN variable,
- serialization error karena deployment bug.

Karakter:

- retry otomatis tidak akan membantu,
- perlu deploy/config/data fix,
- cocok menjadi incident.

Action:

```text
fail job with retries = 0
raise incident with diagnostic message
```

## 4.3 Business Expected Alternative

Contoh:

- applicant not eligible,
- payment declined,
- document incomplete,
- duplicate submission found,
- officer rejected application,
- regulatory threshold exceeded.

Karakter:

- bukan system failure,
- merupakan bagian dari business process,
- harus dimodelkan eksplisit di BPMN.

Action:

```text
throw BPMN error
or complete with decision variable then route by gateway
```

## 4.4 Business Unexpected Invariant Violation

Contoh:

- application approved but no applicant exists,
- case assigned to inactive officer,
- approval attempted after case closed,
- payment received for cancelled application.

Karakter:

- data/business state rusak,
- retry mungkin tidak membantu,
- butuh investigation.

Action:

```text
fail job to incident
or route to manual repair subprocess if modeled
```

## 4.5 Duplicate/Replay Condition

Contoh:

- same worker command executed twice,
- same external callback received twice,
- same process message published twice,
- same payment notification repeated.

Karakter:

- bisa normal dalam distributed systems,
- bukan selalu error,
- harus ditangani sebagai idempotency concern.

Action:

```text
return previous result
complete safely
ignore duplicate if already applied
```

## 4.6 Poison Job

Poison job adalah job yang hampir pasti gagal terus karena data/model/config bermasalah.

Contoh:

- required variable absent,
- variable type berubah dari object ke string,
- invalid enum value,
- domain entity tidak ditemukan,
- downstream contract berubah,
- BPMN model salah route,
- worker versi lama membaca variable versi baru.

Karakter:

- retry otomatis hanya membuang resource,
- perlu diagnosis,
- harus menjadi incident atau repair path.

Action:

```text
fail job with retries = 0 after classification
include actionable error message
```

---

# 5. Idempotency: Definisi yang Benar

Idempotency sering disalahpahami sebagai “kalau dipanggil dua kali hasilnya sama”. Itu terlalu umum.

Dalam worker engineering, definisi yang lebih operasional:

> **Idempotency adalah kemampuan worker untuk menerima ulang command yang sama tanpa menggandakan business effect dan tanpa membuat state kontradiktif.**

Contoh tidak idempotent:

```java
emailService.sendApprovalEmail(applicationId);
```

Kalau worker dieksekusi ulang, email terkirim dua kali.

Contoh lebih aman:

```java
notificationService.sendOnce(
    "APPROVAL_EMAIL",
    applicationId,
    recipient,
    payload
);
```

Service menyimpan bahwa `APPROVAL_EMAIL` untuk `applicationId` sudah pernah dikirim.

## 5.1 Idempotency Bukan Hanya Untuk Payment

Banyak engineer hanya menganggap idempotency penting untuk payment.

Padahal idempotency juga penting untuk:

- email,
- SMS,
- document generation,
- case assignment,
- approval transition,
- task creation,
- external API update,
- Kafka publish,
- audit event,
- file upload,
- notification,
- license issuance,
- status transition.

Dalam regulatory/case management system, duplicate action bisa berbahaya secara administratif:

- dua surat keputusan,
- dua nomor referensi,
- dua approval note,
- dua reminder legal,
- dua assignment officer,
- dua audit event yang membingungkan,
- dua status transition yang membuat timeline sulit dipertanggungjawabkan.

---

# 6. Memilih Idempotency Key

Idempotency key harus mewakili **business intent**, bukan sekadar technical request.

Candidate key:

```text
processInstanceKey
elementInstanceKey
jobKey
businessKey
applicationId
caseId
commandType
externalReference
attemptNumber
```

Tidak semua cocok untuk semua kasus.

## 6.1 `jobKey`

Kelebihan:

- unik untuk job tertentu,
- mudah dari Camunda job.

Kekurangan:

- kalau process migration/retry/repair membuat job baru, business intent bisa sama tapi jobKey berbeda,
- terlalu technical.

Cocok untuk:

- logging,
- worker attempt tracing,
- low-level diagnostic.

Kurang cocok untuk:

- business idempotency jangka panjang.

## 6.2 `processInstanceKey`

Kelebihan:

- stabil sepanjang process instance,
- bagus untuk correlation.

Kekurangan:

- terlalu luas; satu process bisa punya banyak service task berbeda,
- tidak cukup untuk membedakan action.

Cocok untuk:

- process-level dedup,
- tracing,
- audit grouping.

## 6.3 `elementInstanceKey`

Kelebihan:

- lebih spesifik ke eksekusi element tertentu,
- bagus untuk service task invocation.

Kekurangan:

- masih technical,
- bisa berubah pada migration/repair tertentu.

Cocok untuk:

- worker command dedup internal.

## 6.4 `businessKey` / Domain ID

Contoh:

```text
applicationId = APP-2026-000123
caseId = CASE-2026-009991
paymentId = PAY-2026-774321
```

Kelebihan:

- business meaningful,
- stabil lintas sistem,
- mudah diaudit.

Kekurangan:

- perlu dikombinasikan dengan action type.

Cocok untuk:

- external idempotency,
- domain state transition,
- audit,
- dedup table.

## 6.5 Composite Idempotency Key

Biasanya yang paling benar adalah composite key:

```text
<businessEntityId>:<commandType>:<commandVersion>
```

Contoh:

```text
APP-2026-000123:SEND_APPROVAL_EMAIL:v1
APP-2026-000123:GENERATE_APPROVAL_LETTER:v2
CASE-2026-000981:ASSIGN_LEAD_OFFICER:v1
PAY-2026-003991:CAPTURE_PAYMENT:v1
```

Atau untuk worker-level command:

```text
<processDefinitionKey>:<processInstanceKey>:<elementId>:<businessEntityId>:<commandType>
```

Contoh:

```text
license-application:2251799813686012:generateApprovalLetter:APP-2026-000123:GENERATE_DOCUMENT
```

Prinsip:

> **Idempotency key harus cukup stabil untuk replay, cukup spesifik untuk mencegah false duplicate, dan cukup meaningful untuk audit.**

---

# 7. Idempotency Pattern 1: Natural Idempotent State Transition

Contoh domain transition:

```text
SUBMITTED -> UNDER_REVIEW -> APPROVED
```

Worker `approve-application` bisa dibuat idempotent:

```java
public ApprovalResult approve(String applicationId, String commandId) {
    Application app = repository.findByIdForUpdate(applicationId);

    if (app.status() == APPROVED) {
        return ApprovalResult.alreadyApproved(app.approvalRef());
    }

    if (app.status() != UNDER_REVIEW) {
        throw new InvalidStateException(app.status());
    }

    String approvalRef = referenceGenerator.nextApprovalRef();
    app.approve(approvalRef);
    repository.save(app);

    return ApprovalResult.approved(approvalRef);
}
```

Jika worker dipanggil ulang setelah status sudah `APPROVED`, ia tidak membuat approval baru.

Namun hati-hati:

- kalau `referenceGenerator.nextApprovalRef()` sudah dipanggil sebelum crash, ref bisa loncat,
- kalau ada audit insert setiap retry, audit bisa duplicate,
- kalau email dikirim setelah approve, email tetap perlu idempotent.

Natural idempotency baik, tetapi sering tidak cukup.

---

# 8. Idempotency Pattern 2: Command Dedup Table

Buat table khusus untuk mencatat command yang sudah diproses.

Contoh schema:

```sql
CREATE TABLE WORKFLOW_COMMAND_DEDUP (
    IDEMPOTENCY_KEY      VARCHAR2(300) PRIMARY KEY,
    PROCESS_INSTANCE_KEY VARCHAR2(64) NOT NULL,
    ELEMENT_ID           VARCHAR2(200) NOT NULL,
    BUSINESS_ENTITY_ID   VARCHAR2(100) NOT NULL,
    COMMAND_TYPE         VARCHAR2(100) NOT NULL,
    STATUS               VARCHAR2(30) NOT NULL,
    RESULT_JSON          CLOB,
    ERROR_CODE           VARCHAR2(100),
    CREATED_AT           TIMESTAMP NOT NULL,
    UPDATED_AT           TIMESTAMP NOT NULL
);
```

Status:

```text
STARTED
SUCCEEDED
FAILED_RETRYABLE
FAILED_PERMANENT
```

Flow:

```text
worker receives job
  -> compute idempotency key
  -> insert STARTED
      -> if duplicate key:
          -> read existing status
          -> if SUCCEEDED: return previous result and complete job
          -> if STARTED and stale: decide takeover/retry
          -> if FAILED_PERMANENT: fail job to incident
  -> execute business logic
  -> save result as SUCCEEDED
  -> complete Camunda job
```

## 8.1 Pseudocode

```java
public void handle(JobClient client, ActivatedJob job) {
    String applicationId = variable(job, "applicationId");
    String key = idempotencyKey(job, applicationId, "GENERATE_APPROVAL_LETTER", "v1");

    CommandRecord record = dedup.tryStart(key, job);

    if (record.isAlreadySucceeded()) {
        client.newCompleteCommand(job.getKey())
            .variables(record.resultVariables())
            .send()
            .join();
        return;
    }

    try {
        GenerateLetterResult result = letterService.generateOnce(applicationId, key);
        dedup.markSucceeded(key, result.toJson());

        client.newCompleteCommand(job.getKey())
            .variables(Map.of(
                "approvalLetterId", result.letterId(),
                "approvalLetterUrl", result.url()
            ))
            .send()
            .join();
    } catch (RetryableExternalException e) {
        dedup.markRetryableFailure(key, e.code());
        failWithRetry(client, job, e);
    } catch (PermanentBusinessInvariantException e) {
        dedup.markPermanentFailure(key, e.code());
        failToIncident(client, job, e);
    }
}
```

## 8.2 Critical Design Point

Dedup table harus commit bersama domain state kalau memungkinkan.

```text
Same local DB transaction:
  - insert/update domain state
  - insert/update command dedup state
  - insert outbox event if needed
```

Jangan membuat dedup table di database terpisah tanpa alasan kuat, karena justru menambah failure window.

---

# 9. Idempotency Pattern 3: Outbox Pattern

Outbox digunakan ketika worker harus mengubah database lokal dan mengirim event/message ke luar.

Masalah:

```text
worker updates application status APPROVED
worker publishes Kafka event ApplicationApproved
```

Kalau DB commit sukses tapi publish gagal, state berubah tapi event hilang.
Kalau publish sukses tapi DB rollback, event palsu terkirim.

Outbox pattern:

```text
single DB transaction:
  update application status
  insert outbox event

separate publisher:
  reads outbox
  publishes event
  marks outbox as published
```

Schema:

```sql
CREATE TABLE OUTBOX_EVENT (
    EVENT_ID        VARCHAR2(100) PRIMARY KEY,
    AGGREGATE_TYPE  VARCHAR2(100) NOT NULL,
    AGGREGATE_ID    VARCHAR2(100) NOT NULL,
    EVENT_TYPE      VARCHAR2(100) NOT NULL,
    EVENT_VERSION   NUMBER NOT NULL,
    PAYLOAD_JSON    CLOB NOT NULL,
    STATUS          VARCHAR2(30) NOT NULL,
    CREATED_AT      TIMESTAMP NOT NULL,
    PUBLISHED_AT    TIMESTAMP NULL
);
```

Worker:

```java
transactionTemplate.executeWithoutResult(tx -> {
    application.approve(commandId);
    applicationRepository.save(application);

    outboxRepository.insert(new OutboxEvent(
        commandId,
        "Application",
        application.id(),
        "ApplicationApproved",
        1,
        payload
    ));
});
```

Publisher:

```java
List<OutboxEvent> events = outboxRepository.findPending(limit);
for (OutboxEvent event : events) {
    kafka.publish(event.topic(), event.key(), event.payload());
    outboxRepository.markPublished(event.eventId());
}
```

## 9.1 Hubungan Outbox dengan Camunda

Worker tidak harus publish langsung setelah complete job.

Model yang lebih stabil:

```text
Camunda service task
  -> worker updates domain DB + outbox in one transaction
  -> worker completes job
  -> outbox publisher emits event eventually
```

Trade-off:

- event tidak real-time strict,
- tapi consistency jauh lebih kuat.

Untuk regulatory system, ini biasanya lebih baik.

---

# 10. Idempotency Pattern 4: Inbox Pattern

Inbox digunakan saat worker/process menerima event dari luar.

Contoh:

```text
Payment provider sends webhook PaymentCaptured
RabbitMQ/Kafka emits DocumentSigned
External agency sends ReviewCompleted
```

Webhook/event bisa duplicate.

Inbox pattern:

```sql
CREATE TABLE INBOX_MESSAGE (
    MESSAGE_ID       VARCHAR2(100) PRIMARY KEY,
    SOURCE_SYSTEM    VARCHAR2(100) NOT NULL,
    MESSAGE_TYPE     VARCHAR2(100) NOT NULL,
    BUSINESS_KEY     VARCHAR2(100) NOT NULL,
    PAYLOAD_JSON     CLOB NOT NULL,
    STATUS           VARCHAR2(30) NOT NULL,
    RECEIVED_AT      TIMESTAMP NOT NULL,
    PROCESSED_AT     TIMESTAMP NULL
);
```

Flow:

```text
receive external event
  -> insert inbox message by external message id
  -> if duplicate: ignore/return OK
  -> process message
  -> publish Camunda message with correlation key
  -> mark inbox processed
```

Jika event digunakan untuk Camunda message correlation:

```text
external event
  -> inbox dedup
  -> publish Camunda message
  -> process instance catches message
```

Idempotency harus ada sebelum message correlation, karena engine bisa menerima duplicate message kalau tidak dikendalikan.

---

# 11. Idempotency Pattern 5: External Idempotency Key

Banyak provider modern menyediakan idempotency key.

Contoh konseptual:

```http
POST /payments/capture
Idempotency-Key: PAY-2026-000123:CAPTURE:v1
```

Kalau request yang sama dikirim ulang, provider mengembalikan hasil yang sama, bukan membuat payment baru.

Dalam worker:

```java
String idempotencyKey = "PAY-" + paymentId + ":CAPTURE:v1";
PaymentCaptureResult result = paymentClient.capture(paymentId, amount, idempotencyKey);
```

Namun jangan percaya external idempotency saja.

Tetap simpan local record:

```text
local command key
external idempotency key
external transaction id
status
last response
```

Kenapa?

Karena saat incident repair, audit, atau dispute, kita perlu menjawab:

- request apa yang dikirim,
- kapan dikirim,
- idempotency key apa,
- provider response apa,
- external reference apa,
- apakah retry terjadi,
- apakah duplicate dicegah.

---

# 12. Retry: Bukan Sekadar “Coba Lagi 3 Kali”

Retry yang buruk bisa lebih berbahaya daripada tidak retry.

Retry bisa:

- memperbaiki transient failure,
- memperparah overload,
- menggandakan side effect,
- menyembunyikan bug,
- membuat incident terlambat terlihat,
- menyebabkan SLA miss.

## 12.1 Retry Harus Berdasarkan Error Classification

Contoh classification:

| Error | Retry? | Action |
|---|---:|---|
| HTTP 503 | Ya | Retry dengan backoff |
| HTTP 429 | Ya | Retry dengan rate-limit-aware backoff |
| HTTP timeout sebelum response | Ya, tapi idempotent | Retry dengan idempotency key |
| HTTP 400 validation | Tidak | BPMN error atau incident tergantung business meaning |
| HTTP 401 credential expired | Mungkin | Refresh token lalu retry terbatas |
| HTTP 403 forbidden | Tidak | Incident/config/security investigation |
| DB deadlock | Ya | Retry terbatas |
| Unique constraint idempotency duplicate | Bukan error | Return previous result |
| Missing required variable | Tidak | Incident |
| Payment declined | Tidak technical retry | BPMN business error |

## 12.2 Retry Layering Problem

Retry bisa terjadi di beberapa layer:

```text
HTTP client retry
Spring retry
Worker code retry
Camunda job retry
Operator retry
External provider retry/webhook retry
```

Kalau semua layer retry tanpa koordinasi, hasilnya bisa chaos.

Contoh buruk:

```text
HTTP client retry: 3x
Spring retry: 3x
Camunda job retry: 5x
Operator retry: manual
Total possible downstream call: 3 * 3 * 5 = 45 calls
```

Prinsip:

> **Pilih retry layer secara sadar. Jangan biarkan semua library retry sendiri-sendiri.**

## 12.3 Recommended Retry Responsibility

Untuk workflow worker:

```text
Very short local retry:
  - for tiny transient glitches
  - e.g. DB deadlock, connection reset
  - milliseconds/seconds

Camunda job retry:
  - for process-visible technical retry
  - seconds/minutes
  - visible in Operate/monitoring

Manual incident retry:
  - after human repair/config fix/data correction
```

Jangan pakai local retry panjang sampai worker menahan job terlalu lama dan timeout.

---

# 13. Backoff Strategy

Backoff adalah jeda antar retry.

Tanpa backoff:

```text
external system down
  -> all workers retry immediately
  -> external system receives more traffic
  -> outage worsens
```

Dengan backoff:

```text
failure
  -> wait 5s
  -> retry
  -> wait 30s
  -> retry
  -> wait 2m
  -> retry
  -> incident
```

## 13.1 Fixed Backoff

```text
retry every 30 seconds
```

Kelebihan:

- simple,
- predictable.

Kekurangan:

- bisa sinkron antar banyak worker,
- kurang baik untuk outage besar.

## 13.2 Exponential Backoff

```text
1s -> 2s -> 4s -> 8s -> 16s
```

Kelebihan:

- mengurangi pressure.

Kekurangan:

- bisa terlalu lama kalau tidak dibatasi.

## 13.3 Exponential Backoff with Jitter

```text
baseDelay * 2^attempt + random jitter
```

Kelebihan:

- menghindari retry storm serentak.

Cocok untuk:

- HTTP 503,
- network instability,
- distributed worker fleet.

## 13.4 Rate-limit-aware Backoff

Untuk HTTP 429:

- hormati `Retry-After` kalau tersedia,
- gunakan token bucket/leaky bucket,
- jangan biarkan semua process instance retry bersamaan.

---

# 14. Job Timeout: Salah Tuning Bisa Menciptakan Duplicate Execution

Job timeout adalah waktu job “dipegang” worker setelah activation.

Kalau worker tidak menyelesaikan dalam timeout, job bisa tersedia untuk worker lain.

Ini penting:

```text
job timeout < actual processing time
  -> job timeout expires
  -> another worker activates same job
  -> duplicate execution risk
```

## 14.1 Timeout Harus Memperhitungkan Queue Internal Worker

Misal:

```text
worker threads = 5
maxJobsActive = 50
average job duration = 10s
job timeout = 30s
```

Worker mengambil 50 job, tapi hanya 5 diproses sekaligus.

Batch terakhir bisa menunggu lama sebelum mulai diproses:

```text
50 jobs / 5 threads = 10 waves
10 waves * 10s = 100s
```

Timeout 30s terlalu pendek. Banyak job timeout sebelum diproses.

Prinsip:

> **maxJobsActive harus disesuaikan dengan concurrency aktual dan job timeout.**

Formula kasar:

```text
jobTimeout >= queueWaitWorstCase + processingP95/P99 + networkBuffer
```

Dengan:

```text
queueWaitWorstCase = ((maxJobsActive / workerConcurrency) - 1) * processingP95
```

Contoh:

```text
maxJobsActive = 20
workerConcurrency = 5
processingP95 = 8s
networkBuffer = 5s

queueWaitWorstCase = ((20/5)-1) * 8s = 24s
jobTimeout >= 24s + 8s + 5s = 37s
```

Maka timeout 45–60s lebih masuk akal.

## 14.2 Timeout Terlalu Panjang Juga Bermasalah

Kalau timeout terlalu panjang:

- job yang worker-nya crash lama baru bisa diambil ulang,
- recovery lambat,
- SLA bisa terganggu,
- incident terlihat terlambat.

Trade-off:

```text
short timeout -> duplicate risk naik
long timeout  -> recovery delay naik
```

Solusi:

- ukur processing time,
- pisahkan job cepat dan job lambat,
- jangan campur external API lambat dengan job type cepat,
- gunakan worker type berbeda,
- gunakan heartbeat/extend timeout jika supported dan sesuai kasus,
- desain long task sebagai beberapa step BPMN lebih kecil.

---

# 15. Poison Job: Mengenali dan Menghentikan Retry yang Tidak Berguna

Poison job adalah job yang akan gagal terus karena masalah yang tidak transient.

## 15.1 Tanda Poison Job

- error sama persis di setiap attempt,
- missing variable,
- invalid enum,
- validation permanent,
- config missing,
- external 400,
- NPE karena payload tidak kompatibel,
- process model mengirim data versi lama ke worker versi baru,
- domain state invalid.

## 15.2 Bad Handling

```java
catch (Exception e) {
    failJob(job, retries - 1);
}
```

Ini membuat semua failure dianggap retryable.

Akibat:

- retries habis tanpa informasi baik,
- external system ditekan ulang,
- incident terlambat,
- operator tidak tahu akar masalah,
- SLA terbakar.

## 15.3 Better Handling

```java
catch (MissingVariableException e) {
    failToIncident(job, "MISSING_REQUIRED_VARIABLE", e.getMessage());
} catch (InvalidBusinessStateException e) {
    failToIncident(job, "INVALID_DOMAIN_STATE", e.getMessage());
} catch (RateLimitedException e) {
    failWithRetry(job, "RATE_LIMITED", e.retryAfter());
} catch (TemporaryUnavailableException e) {
    failWithBackoff(job, "DOWNSTREAM_UNAVAILABLE");
}
```

## 15.4 Poison Job Checklist

Sebuah error sebaiknya langsung incident jika:

- retry tidak akan mengubah input,
- error berasal dari variable/model/config,
- error berasal dari deployment mismatch,
- error berasal dari invalid domain invariant,
- error butuh data repair,
- error butuh operator decision.

---

# 16. Incident: Bukan Kegagalan Sistem, Tapi Mekanisme Recovery

Incident sering dianggap “hal buruk”. Sebenarnya incident adalah mekanisme penting.

Incident berarti:

```text
process instance is blocked at a specific point
because engine/worker cannot continue safely
without intervention or correction
```

Incident lebih baik daripada:

- silent failure,
- retry endless,
- process lanjut dengan data salah,
- duplicate side effect,
- operator tidak tahu ada masalah.

## 16.1 Incident Harus Actionable

Jangan membuat incident message seperti ini:

```text
NullPointerException
```

Atau:

```text
Failed
```

Buat message seperti:

```text
MISSING_REQUIRED_VARIABLE: approvalDecision is required by worker complete-review-task v2.
ProcessInstanceKey=2251799813686012, elementId=completeReview, applicationId=APP-2026-000123.
Expected variable schema: ReviewCompletionVariables/v2.
Recommended action: inspect task completion payload or migrate variable approvalDecision.
```

Incident message harus menjawab:

- apa yang gagal,
- kenapa gagal,
- entity apa terdampak,
- process instance mana,
- worker version apa,
- apakah retry aman,
- apa action operator.

## 16.2 Incident Variables

Kadang diagnostic bisa disimpan sebagai variable.

Namun hati-hati:

- jangan simpan stack trace panjang ke process variable,
- jangan simpan PII rahasia,
- jangan simpan token/secret,
- jangan bloat variable payload.

Lebih baik:

```text
incidentCode
incidentCategory
incidentCorrelationId
incidentBusinessEntityId
```

Detail panjang simpan di log/observability system.

---

# 17. BPMN Error vs Failed Job vs Incident

Ini salah satu keputusan paling penting.

## 17.1 BPMN Error

Gunakan BPMN error untuk expected business alternative.

Contoh:

```text
Payment declined
Applicant not eligible
Required document incomplete
Duplicate active license exists
```

BPMN model harus punya path:

```text
Service Task: Validate Eligibility
  boundary error: Not Eligible
      -> Notify Applicant
      -> End: Rejected
```

## 17.2 Failed Job with Retry

Gunakan untuk technical transient failure.

Contoh:

```text
External API timeout
HTTP 503
DB deadlock
Temporary network issue
```

Process tidak perlu berubah jalur business. Ia hanya menunggu retry.

## 17.3 Incident

Gunakan saat engine/worker tidak bisa lanjut aman.

Contoh:

```text
Missing variable
Invalid payload schema
Config missing
Permanent external integration issue
Domain invariant violation
Retries exhausted
```

## 17.4 Decision Table

| Situation | BPMN Error | Fail Job Retry | Incident |
|---|---:|---:|---:|
| Payment declined | Yes | No | No |
| Payment provider timeout | No | Yes | If exhausted |
| Missing payment amount variable | No | No | Yes |
| Applicant not eligible | Yes | No | No |
| Eligibility API 503 | No | Yes | If exhausted |
| Invalid enum from worker deployment mismatch | No | No | Yes |
| Officer rejects application | Usually no error; normal completion variable | No | No |
| DB deadlock | No | Yes | If repeated/exhausted |

---

# 18. The Dangerous Window: Side Effect Succeeded, Job Completion Failed

Ini failure window paling penting.

```text
worker calls payment provider
payment capture succeeds
worker calls complete job
network failure
worker does not know if complete succeeded
job later retried
worker calls payment provider again
```

Kalau tidak idempotent, duplicate payment.

## 18.1 Correct Handling

Worker harus menyimpan external result sebelum complete job.

Flow:

```text
activate job
  -> compute idempotency key
  -> check local command table
  -> call external provider with idempotency key
  -> persist provider result locally
  -> complete Camunda job with result variables
```

Jika complete job gagal dan job dieksekusi ulang:

```text
activate same/retried job
  -> compute same idempotency key
  -> find local command SUCCEEDED
  -> do not call provider again
  -> complete job with stored result variables
```

## 18.2 Required Data

Local table harus menyimpan:

```text
idempotencyKey
businessEntityId
externalRequestPayloadHash
externalIdempotencyKey
externalTransactionId
externalStatus
resultVariables
status
createdAt
updatedAt
```

---

# 19. Worker Transaction Boundary

Worker sering melakukan:

```text
read process variables
validate domain state
update domain DB
call external API
insert audit
complete job
```

Tidak semuanya bisa dalam satu transaction.

## 19.1 Bad Pattern: One Giant Method Without Boundary Awareness

```java
@Transactional
public void handleJob(ActivatedJob job) {
    application.approve();
    paymentClient.capture();
    emailClient.send();
    completeJob(job);
}
```

Masalah:

- external HTTP call di dalam DB transaction,
- transaction terbuka terlalu lama,
- rollback DB tidak rollback external side effect,
- complete job bukan bagian dari DB transaction,
- timeout risk tinggi.

## 19.2 Better Pattern: Explicit Steps

```text
Step 1: Validate and reserve local command
Step 2: Execute external side effect with idempotency key
Step 3: Persist external result
Step 4: Complete Camunda job
Step 5: Publish eventual notifications via outbox
```

Pseudo:

```java
CommandRecord command = transactionTemplate.execute(tx ->
    commandService.reserve(commandKey, jobMetadata)
);

if (command.succeeded()) {
    completeWithStoredResult(job, command);
    return;
}

ExternalResult result = externalClient.call(command.externalIdempotencyKey());

transactionTemplate.executeWithoutResult(tx ->
    commandService.markSucceeded(commandKey, result)
);

completeJob(job, result.toVariables());
```

---

# 20. Worker Concurrency and Local Locks

Horizontal worker scaling means multiple JVMs can process jobs concurrently.

Within one JVM:

```text
worker threads > 1
```

Across pods:

```text
worker pod A
worker pod B
worker pod C
```

Risiko:

- two workers update same application,
- duplicate command racing,
- stale read,
- optimistic lock exception,
- duplicate external call before dedup commit.

## 20.1 Use Database Uniqueness

Application-level `if exists` is not enough.

Bad:

```java
if (!repository.existsByKey(idempotencyKey)) {
    repository.insert(record);
}
```

Race:

```text
worker A checks: not exists
worker B checks: not exists
worker A inserts
worker B inserts
```

Better:

```sql
ALTER TABLE WORKFLOW_COMMAND_DEDUP
ADD CONSTRAINT UK_WORKFLOW_COMMAND_DEDUP_KEY UNIQUE (IDEMPOTENCY_KEY);
```

Then:

```java
try {
    insertCommand(idempotencyKey);
} catch (DuplicateKeyException e) {
    return loadExistingCommand(idempotencyKey);
}
```

## 20.2 Domain Aggregate Locking

For sensitive transitions:

- optimistic locking with version column,
- pessimistic lock `SELECT ... FOR UPDATE`,
- single writer per aggregate,
- command table with unique constraint.

Example:

```sql
ALTER TABLE APPLICATION ADD VERSION NUMBER DEFAULT 0 NOT NULL;
```

```java
UPDATE APPLICATION
SET STATUS = ?, VERSION = VERSION + 1
WHERE APPLICATION_ID = ?
  AND VERSION = ?
  AND STATUS = 'UNDER_REVIEW';
```

If affected rows = 0, reload and classify:

- already approved -> idempotent success,
- invalid status -> business invariant issue.

---

# 21. Retry and Idempotency by Side Effect Type

## 21.1 Email

Email cannot be unsent.

Pattern:

```text
notification table with unique notification intent
```

Key:

```text
APP-2026-000123:SEND_APPROVAL_EMAIL:v1
```

Flow:

```text
if notification already SENT:
    return previous notification id
else:
    create notification record PENDING
    send email
    mark SENT
```

Even better:

- worker inserts notification request,
- separate notification service sends once,
- process waits for message/callback only if needed.

## 21.2 Document Generation

Document generation can create duplicate files/reference numbers.

Pattern:

```text
document intent key
```

```text
APP-2026-000123:APPROVAL_LETTER:v3
```

Store:

- template version,
- input hash,
- generated document id,
- storage URI,
- checksum,
- generated by process instance.

If duplicate request with same input hash:

- return existing document.

If same key but different input hash:

- incident or explicit regeneration version.

## 21.3 Payment

Payment must use external idempotency key if provider supports it.

Store:

- payment command id,
- provider idempotency key,
- provider transaction id,
- amount,
- currency,
- status,
- response hash.

Never use random UUID generated per retry as idempotency key.

Bad:

```java
String idempotencyKey = UUID.randomUUID().toString();
```

Good:

```java
String idempotencyKey = paymentId + ":CAPTURE:v1";
```

## 21.4 External Status Update

Example:

```text
notify external agency that case is approved
```

Pattern:

- outbox event,
- idempotent receiver if possible,
- local delivery attempt table,
- correlation id.

## 21.5 Audit Event

Audit event is tricky.

Duplicate audit events can confuse investigation.

Pattern:

```text
audit event id = deterministic business event id
```

Example:

```text
APP-2026-000123:STATUS_CHANGED:UNDER_REVIEW_TO_APPROVED:v1
```

If same event emitted twice, audit service should reject/ignore duplicate.

---

# 22. Complete Job Variables: Avoid Non-deterministic Result on Replay

When worker completes job, it may send variables:

```java
complete(job, Map.of(
    "approvalRef", approvalRef,
    "approvedAt", Instant.now().toString()
));
```

If complete failed and worker retries, `approvedAt` might change.

Better:

- generate once,
- persist result,
- replay same result.

Bad:

```java
String approvalRef = referenceGenerator.next();
Instant approvedAt = Instant.now();
complete(job, variables(approvalRef, approvedAt));
```

Good:

```java
ApprovalResult result = approvalService.approveOnce(applicationId, commandKey);
complete(job, result.toProcessVariables());
```

`approveOnce` persists:

- approvalRef,
- approvedAt,
- approver,
- decision.

Replay returns same result.

---

# 23. Handling Completion Failure

What if business logic succeeded, but `completeJob` failed?

Do not immediately redo business logic.

Recommended sequence:

```text
1. Log completion failure with job key/process key/command key.
2. Do not mark domain command as failed if business side effect succeeded.
3. Let job retry or timeout.
4. On next activation, detect command SUCCEEDED.
5. Complete job again with stored variables.
```

## 23.1 Pseudocode

```java
try {
    completeJob(job, resultVariables);
} catch (Exception e) {
    log.warn("Job completion failed after business success", kv(...), e);
    // Do not undo successful side effect blindly.
    // Do not call external API again.
    // Let reactivation repair via idempotency table.
    throw e;
}
```

If worker framework auto-fails job on exception, ensure handler behavior does not mark business command failed incorrectly.

---

# 24. Heartbeat / Extend Lock / Long-running Work

Some work takes long:

- generating large report,
- calling slow legacy system,
- scanning document,
- batch validation,
- waiting for file transfer.

Do not simply set huge timeout for everything.

Options:

## 24.1 Split Work into Smaller BPMN Steps

Instead of:

```text
Service Task: Process Entire Batch
```

Use:

```text
Start Batch
  -> Validate Batch Metadata
  -> Multi-instance Process Item
  -> Aggregate Result
  -> Complete Batch
```

## 24.2 Async External Job Pattern

Worker starts external job and completes service task quickly:

```text
Service Task: Submit Document Scan
  -> external scan job created
  -> process waits at Message Catch: Scan Completed
```

External system callback publishes message to process.

This is often better than holding a job for minutes/hours.

## 24.3 Extend Timeout Carefully

If client supports extending job timeout/lease, use it only when:

- work is truly ongoing,
- progress is observable,
- timeout extension stops if worker unhealthy,
- side effects are idempotent anyway.

Still assume duplicate execution can happen.

---

# 25. Backpressure and Bulkhead

Worker reliability is not only correctness. It is also protecting dependencies.

## 25.1 Backpressure Sources

- Camunda broker backpressure.
- Worker internal queue full.
- External API rate limit.
- Database connection pool saturation.
- Thread pool saturation.
- CPU/memory pressure.

## 25.2 Bulkhead by Job Type

Do not run all job types in one unbounded worker pool.

Bad:

```text
same worker pool:
  send-email
  capture-payment
  generate-document
  call-legacy-agency
  update-case-status
```

If `call-legacy-agency` hangs, all job types suffer.

Better:

```text
payment-worker pool
notification-worker pool
document-worker pool
legacy-agency-worker pool
case-state-worker pool
```

Each has:

- own concurrency,
- own timeout,
- own retry policy,
- own rate limit,
- own circuit breaker.

## 25.3 Rate Limit at Worker Boundary

If downstream limit is 300/minute, do not rely on retries after 429.

Throttle before calling:

```text
worker activation concurrency
  + token bucket
  + queue limit
  + backoff on 429
```

---

# 26. Circuit Breaker with Workflow Workers

Circuit breaker prevents repeated calls to unhealthy dependency.

States:

```text
CLOSED -> calls allowed
OPEN -> calls rejected immediately
HALF_OPEN -> limited probe calls
```

In worker:

```text
if circuit open:
    fail job with retry/backoff
else:
    call downstream
```

Important:

- circuit open should not become BPMN error,
- it is technical failure,
- fail job with retry or incident after threshold.

## 26.1 Beware of Local Circuit Breaker Across Pods

If each pod has local circuit breaker, behavior can be inconsistent.

For high-volume critical dependency:

- expose shared health signal,
- central rate limit,
- dependency-level dashboard,
- coordinated backoff if possible.

---

# 27. Observability for Worker Reliability

You cannot operate what you cannot see.

Minimum log context:

```text
processDefinitionId/processId
processInstanceKey
elementId
elementInstanceKey
jobKey
jobType
workerName
businessKey/applicationId/caseId
idempotencyKey
attempt/retries
correlationId
externalReference
errorCategory
errorCode
```

## 27.1 Metrics

Worker metrics:

```text
jobs_activated_total{jobType}
jobs_completed_total{jobType}
jobs_failed_total{jobType,errorCategory}
jobs_bpmn_error_total{jobType,errorCode}
job_processing_duration_seconds{jobType}
job_completion_failure_total{jobType}
job_timeout_suspected_total{jobType}
idempotency_duplicate_total{commandType}
external_call_duration_seconds{system,operation}
external_call_failure_total{system,operation,errorClass}
incident_created_total{jobType,errorCode}
```

## 27.2 Alerts

Alert examples:

```text
High incident count for jobType=generate-approval-letter
Retry exhaustion increased in last 15 minutes
Payment capture duplicate detected
Job processing p99 > job timeout * 0.8
External API 429 rate > threshold
Worker active jobs near max for sustained period
No completions for active job type
```

## 27.3 Trace

Distributed trace should show:

```text
Camunda job activation
  -> worker handler
      -> domain DB
      -> external API
      -> outbox insert
  -> complete job
```

But be careful not to put PII/secrets into trace attributes.

---

# 28. Manual Repair Path

Reliability includes human repair.

For every critical service task, ask:

```text
If this fails in production, who repairs it?
What information do they need?
Can retry safely happen after repair?
Can variables be corrected?
Can domain state be corrected?
Can duplicate side effects be detected?
What audit note is required?
```

## 28.1 Repair Types

| Repair Type | Example |
|---|---|
| Retry only | External system recovered |
| Variable correction | Missing/invalid variable fixed |
| Domain data correction | Application state repaired |
| Config correction | Endpoint/credential fixed |
| Manual compensation | Duplicate notification/payment/document corrected |
| Process cancellation | Process cannot continue |
| Process migration | Model bug fixed in new version |
| Manual completion | Rare, high-governance only |

## 28.2 Repair Record

For regulatory systems, repair should be auditable:

```text
repairId
processInstanceKey
businessEntityId
incidentId
repairAction
beforeState
afterState
operator
reason
approvedBy
timestamp
```

Do not let production support silently mutate variables without trace.

---

# 29. Worker Reliability Architecture Template

Recommended structure:

```text
workflow-worker-service
├── config
│   ├── CamundaClientConfig
│   ├── WorkerConcurrencyConfig
│   └── RetryPolicyConfig
├── workflow
│   ├── JobTypes
│   ├── VariableContracts
│   ├── WorkerMetadata
│   └── CamundaCommandAdapter
├── worker
│   ├── GenerateApprovalLetterWorker
│   ├── CapturePaymentWorker
│   └── NotifyApplicantWorker
├── idempotency
│   ├── IdempotencyKeyFactory
│   ├── CommandDedupRepository
│   └── CommandExecutionService
├── domain
│   ├── ApplicationService
│   ├── PaymentService
│   └── DocumentService
├── integration
│   ├── PaymentClient
│   ├── DocumentClient
│   └── NotificationClient
├── outbox
│   ├── OutboxEvent
│   ├── OutboxRepository
│   └── OutboxPublisher
├── observability
│   ├── WorkflowLogger
│   ├── WorkerMetrics
│   └── CorrelationContext
└── error
    ├── ErrorClassifier
    ├── RetryableWorkflowException
    ├── PermanentWorkflowException
    └── BusinessBpmnException
```

---

# 30. Error Classifier Pattern

Centralize classification.

```java
public enum WorkerFailureAction {
    COMPLETE_AS_DUPLICATE_SUCCESS,
    THROW_BPMN_ERROR,
    FAIL_WITH_RETRY,
    FAIL_TO_INCIDENT
}
```

```java
public final class WorkerErrorClassifier {

    public WorkerFailureAction classify(Throwable t) {
        if (t instanceof DuplicateCommandAlreadySucceededException) {
            return WorkerFailureAction.COMPLETE_AS_DUPLICATE_SUCCESS;
        }
        if (t instanceof BusinessExpectedException) {
            return WorkerFailureAction.THROW_BPMN_ERROR;
        }
        if (t instanceof RateLimitedException) {
            return WorkerFailureAction.FAIL_WITH_RETRY;
        }
        if (t instanceof TemporaryUnavailableException) {
            return WorkerFailureAction.FAIL_WITH_RETRY;
        }
        if (t instanceof MissingVariableException) {
            return WorkerFailureAction.FAIL_TO_INCIDENT;
        }
        if (t instanceof InvalidDomainInvariantException) {
            return WorkerFailureAction.FAIL_TO_INCIDENT;
        }
        return WorkerFailureAction.FAIL_TO_INCIDENT;
    }
}
```

This avoids random per-worker `catch` behavior.

---

# 31. Production-grade Worker Skeleton

Conceptual Java skeleton:

```java
public final class ReliableJobHandler<I, O> {

    private final VariableMapper<I> variableMapper;
    private final IdempotencyKeyFactory keyFactory;
    private final CommandExecutionService commandExecutionService;
    private final BusinessHandler<I, O> businessHandler;
    private final WorkerErrorClassifier errorClassifier;
    private final CamundaJobCommander camunda;
    private final WorkerMetrics metrics;

    public void handle(ActivatedJob job) {
        WorkerContext context = WorkerContext.from(job);
        long started = System.nanoTime();

        try {
            I input = variableMapper.map(job.getVariablesAsMap());
            String idempotencyKey = keyFactory.create(context, input);

            CommandResult<O> commandResult = commandExecutionService.executeOnce(
                idempotencyKey,
                context,
                () -> businessHandler.handle(input, context)
            );

            camunda.complete(job, commandResult.outputVariables());
            metrics.completed(context, elapsed(started));

        } catch (Throwable t) {
            WorkerFailureAction action = errorClassifier.classify(t);
            handleFailure(job, context, t, action);
        }
    }

    private void handleFailure(
        ActivatedJob job,
        WorkerContext context,
        Throwable t,
        WorkerFailureAction action
    ) {
        switch (action) {
            case THROW_BPMN_ERROR -> camunda.throwBpmnError(job, toBusinessError(t));
            case FAIL_WITH_RETRY -> camunda.failWithRetry(job, toRetryPolicy(t));
            case FAIL_TO_INCIDENT -> camunda.failToIncident(job, toIncidentMessage(context, t));
            case COMPLETE_AS_DUPLICATE_SUCCESS -> camunda.complete(job, recoverVariables(t));
        }
    }
}
```

In Java 8, replace switch expression/arrow with classic switch.
In Java 21+, you can use records/sealed classes/pattern matching where appropriate, but do not make reliability depend on language novelty.

---

# 32. Java 8–25 Considerations

## 32.1 Java 8

Constraints:

- no records,
- no sealed classes,
- less ergonomic async model,
- older TLS/library compatibility concerns.

Recommendation:

- explicit DTO classes,
- clear checked/unchecked exception taxonomy,
- stable dependency versions,
- avoid clever concurrency.

## 32.2 Java 11/17

Good baseline for enterprise:

- better HTTP client in Java 11,
- better GC options,
- stronger TLS/defaults,
- mature Spring Boot support depending version.

Recommendation:

- use immutable DTO style,
- structured package boundary,
- resilient HTTP clients,
- explicit metrics/logging.

## 32.3 Java 21

Useful features:

- virtual threads,
- records,
- pattern matching,
- better GC/runtime performance.

But warning:

> Virtual threads improve blocking scalability; they do not solve idempotency, retry, timeout, or side-effect correctness.

Use virtual threads carefully for blocking HTTP/DB calls, but still apply:

- connection pool limits,
- rate limits,
- downstream bulkheads,
- job timeout sizing,
- idempotency.

## 32.4 Java 25

As a newer generation runtime, Java 25 can improve platform ergonomics/performance depending adopted features and library support.

But for workflow reliability, the invariant remains the same:

```text
language version improves implementation ergonomics,
not distributed correctness by itself.
```

---

# 33. Regulatory Case Management Example

Scenario:

```text
Application submitted
  -> officer review
  -> eligibility validation
  -> payment verification
  -> approval letter generation
  -> applicant notification
  -> license activation
```

Critical workers:

```text
validate-eligibility
verify-payment
create-approval-record
generate-approval-letter
send-approval-notification
activate-license
```

## 33.1 Failure Analysis

### `validate-eligibility`

Possible outcomes:

- eligible,
- not eligible,
- external eligibility service unavailable,
- applicant data missing.

Handling:

```text
not eligible -> BPMN business path
service unavailable -> retry
missing applicant data -> incident/manual repair
```

### `verify-payment`

Possible outcomes:

- paid,
- unpaid,
- payment declined,
- provider timeout,
- duplicate payment notification.

Handling:

```text
unpaid -> wait for payment message/timer expiry
payment declined -> BPMN path
provider timeout -> retry with idempotent query
notification duplicate -> inbox dedup
```

### `generate-approval-letter`

Possible outcomes:

- generated,
- template missing,
- document service timeout,
- same letter already generated.

Handling:

```text
already generated -> complete with existing document id
timeout -> retry
template missing -> incident
input changed for same letter key -> incident or v2 generation policy
```

### `send-approval-notification`

Possible outcomes:

- sent,
- email provider timeout,
- duplicate request,
- invalid recipient.

Handling:

```text
sent duplicate -> complete success
provider timeout -> retry with notification intent dedup
invalid recipient -> BPMN/manual correction path or incident depending process
```

### `activate-license`

Possible outcomes:

- license activated,
- already active,
- invalid application state,
- duplicate license conflict.

Handling:

```text
already active -> idempotent success
invalid state -> incident
conflict -> manual review/business exception depending rule
```

---

# 34. Common Anti-patterns

## 34.1 Worker Without Idempotency

```java
public void handle(ActivatedJob job) {
    paymentClient.capture(...);
    complete(job);
}
```

This is unsafe.

## 34.2 Random Idempotency Key

```java
String key = UUID.randomUUID().toString();
```

This defeats replay protection.

## 34.3 All Exceptions Are Retried

```java
catch (Exception e) {
    fail(job, retries - 1);
}
```

This turns permanent bugs into slow incidents.

## 34.4 All Exceptions Are BPMN Errors

```java
catch (Exception e) {
    throwBpmnError("ERROR");
}
```

This hides technical failure as business flow.

## 34.5 Long DB Transaction Around External Call

```java
@Transactional
void handle() {
    updateDb();
    httpCall();
    completeJob();
}
```

This causes lock contention and false rollback assumptions.

## 34.6 `maxJobsActive` Too High

Worker activates more jobs than it can process before timeout.

## 34.7 No Incident Message

Incident exists but operator cannot act.

## 34.8 Process Variables as Error Dumpster

Dumping huge exception payloads into process variables creates performance/security problems.

## 34.9 No Manual Repair Governance

Operators mutate variables or DB rows without trace.

---

# 35. Design Checklist: Worker Reliability Review

Before approving a worker design, answer:

## 35.1 Job Contract

- What is the job type?
- What process variables are required?
- What variables are produced?
- Is the variable schema versioned?
- Is job type stable and tested against BPMN model?

## 35.2 Failure Classification

- Which failures are business alternatives?
- Which failures are transient technical?
- Which failures are permanent technical?
- Which failures should become incidents immediately?
- Which failures require manual repair?

## 35.3 Idempotency

- What is the idempotency key?
- Is it deterministic?
- Is it business-meaningful?
- Is it stable across retry?
- Is there a unique constraint?
- What happens if duplicate arrives after success?
- What happens if duplicate arrives while first attempt is in progress?

## 35.4 Side Effects

- Does worker call external API?
- Is external API idempotent?
- Is external idempotency key used?
- Is external reference persisted?
- Can side effect be compensated?
- What if response is lost after success?

## 35.5 Retry

- Which layer retries?
- Is retry count bounded?
- Is there backoff?
- Is there jitter?
- Are 429/503 handled differently?
- Are permanent errors excluded from retry?

## 35.6 Timeout and Concurrency

- What is processing p95/p99?
- What is job timeout?
- What is maxJobsActive?
- What is worker concurrency?
- Can internal queue exceed timeout?
- Are slow jobs separated from fast jobs?

## 35.7 Observability

- Are processInstanceKey/jobKey/businessKey logged?
- Are idempotency keys logged safely?
- Are metrics emitted?
- Are incidents actionable?
- Is there alerting on retry exhaustion?

## 35.8 Repair

- How is incident repaired?
- Is retry after repair safe?
- Can variables be corrected safely?
- Is repair audited?
- Is operator runbook available?

---

# 36. Mental Model Summary

A reliable Camunda worker is not just code that “does the service task”.

A reliable worker is a small distributed system participant with explicit answers to:

```text
What if I run twice?
What if I crash halfway?
What if external system succeeds but I do not know?
What if Camunda retries me?
What if another worker runs the same job?
What if the data is wrong?
What if retry will never help?
What if an operator must repair this later?
Can I explain this process instance one year from now?
```

The top 1% mindset:

> **Do not design for the happy path plus catch block. Design for replay, partial success, duplicate delivery, timeout, repair, and audit.**

---

# 37. Practical Rules of Thumb

1. Treat every worker as at-least-once.
2. Never perform non-idempotent side effects without an idempotency key.
3. Never use random UUID per retry as idempotency key.
4. Persist external result before completing job.
5. Complete retry using stored result, not regenerated result.
6. Separate business errors from technical failures.
7. Use BPMN error for expected business alternatives only.
8. Use fail job/retry for transient technical failures.
9. Use incident for permanent or unsafe continuation failures.
10. Make incident messages actionable.
11. Tune `maxJobsActive`, concurrency, and timeout together.
12. Do not let all libraries retry independently.
13. Use outbox for DB + event consistency.
14. Use inbox for external duplicate event deduplication.
15. Keep process variables small and contractual.
16. Build repair and audit path before production.
17. Test duplicate execution explicitly.
18. Test completion failure after business success.
19. Test job timeout and reactivation.
20. Monitor retry exhaustion and duplicate detection.

---

# 38. Exercises

## Exercise 1 — Identify Failure Type

Classify each as:

- BPMN error,
- fail job with retry,
- incident,
- idempotent duplicate success.

Cases:

1. Email provider returns 503.
2. Applicant is not eligible due to age threshold.
3. Required variable `applicationId` missing.
4. Payment capture succeeded yesterday and worker receives same command today.
5. Database deadlock during status update.
6. External API returns 401 due to expired token.
7. Document template ID does not exist.
8. Officer rejects application.
9. Worker crashes after generating approval letter but before completing job.
10. Process message arrives twice from webhook.

Expected thinking:

- separate business outcome from technical failure,
- distinguish duplicate from error,
- ask whether retry changes anything.

## Exercise 2 — Design Idempotency Key

Design idempotency keys for:

1. Generate approval letter.
2. Send reminder email.
3. Capture payment.
4. Assign lead officer.
5. Publish `ApplicationApproved` event.

Check:

- stable across retry,
- specific to command,
- business meaningful,
- versioned if output changes.

## Exercise 3 — Timeout Tuning

Given:

```text
worker concurrency = 8
maxJobsActive = 64
processing p95 = 5 seconds
network buffer = 5 seconds
```

Estimate minimum job timeout.

```text
queueWaitWorstCase = ((64/8)-1) * 5 = 35s
minimum timeout = 35 + 5 + 5 = 45s
```

Use higher value after observing p99.

## Exercise 4 — Completion Failure Design

Design flow for:

```text
generate approval letter succeeds
local DB stores document id
complete job fails due to network
job retries
```

Expected solution:

- command table stores success,
- retry reads stored result,
- no new document generated,
- complete job with same document variables.

---

# 39. What We Deliberately Did Not Repeat

Karena seri sebelumnya sudah membahas banyak fondasi Java/backend, bagian ini tidak mengulang detail umum tentang:

- Java exception basics,
- SQL transaction basics,
- HTTP client basics,
- general retry library usage,
- general microservice architecture,
- JPA/Hibernate mapping,
- Jackson serialization basics,
- Kubernetes deployment basics,
- generic logging setup.

Yang dibahas di sini adalah bagaimana semua fondasi itu dipakai dalam konteks **Camunda/BPMN job worker reliability**.

---

# 40. Closing

Part ini adalah salah satu fondasi produksi paling penting untuk Camunda 8.

Kalau BPMN adalah peta proses, maka worker reliability adalah rem, seatbelt, blackbox recorder, dan emergency procedure dari sistem.

Tanpa ini, workflow engine hanya memindahkan kompleksitas dari kode imperative ke diagram visual, tetapi failure-nya tetap liar.

Dengan ini, workflow menjadi:

- replay-safe,
- duplicate-safe,
- retry-aware,
- incident-aware,
- auditable,
- repairable,
- production-operable.

---

# Status Seri

Selesai sejauh ini:

- Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer
- Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract
- Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses
- Part 3 — BPMN Modeling Discipline: Membuat Process Model yang Bisa Hidup di Production
- Part 4 — Camunda Landscape: Camunda 7 vs Camunda 8
- Part 5 — Camunda 8 Runtime Internals: Zeebe Mental Model
- Part 6 — Java Client Engineering: From API Call to Production-grade Worker
- Part 7 — Job Worker Reliability: Idempotency, Retry, Backoff, Poison Jobs

Seri belum selesai.

Berikutnya:

**Part 8 — Process Variables: Data Contract, Scope, Serialization, and Governance**

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-06-java-client-engineering-production-grade-worker.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Learn Java BPMN & Camunda Process Orchestration Engineering](./learn-java-bpmn-camunda-part-08-process-variables-data-contract-scope-serialization-governance.md)

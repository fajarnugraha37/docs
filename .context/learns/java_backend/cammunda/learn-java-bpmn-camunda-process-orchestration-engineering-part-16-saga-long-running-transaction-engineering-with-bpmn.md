# Learn Java BPMN, Camunda, and Process Orchestration Engineering

## Part 16 — Saga and Long-running Transaction Engineering with BPMN

> Seri: `learn-java-bpmn-camunda-process-orchestration-engineering`  
> Target: Java 8 sampai Java 25  
> Fokus: Saga, long-running transaction, compensation, retry, idempotency, manual repair, orchestration, dan auditability dalam sistem enterprise/regulatory.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

- BPMN sebagai execution contract.
- Camunda 7 vs Camunda 8.
- Zeebe mental model.
- Java worker production-grade.
- Job reliability.
- Process variable governance.
- BPMN error, incident, escalation, compensation.
- Human workflow.
- DMN.
- Message correlation.
- Timer/SLA.
- Parallelism dan multi-instance.
- Subprocess dan call activity.

Part ini menyatukan banyak konsep itu ke satu problem besar: **bagaimana menjaga konsistensi proses bisnis panjang yang melibatkan banyak sistem, manusia, database, event, dan external side effect tanpa mengandalkan satu transaksi database global.**

Inilah domain **saga** dan **long-running transaction engineering**.

---

## 1. Problem Utama: Transaksi Database Tidak Cukup Untuk Proses Bisnis Panjang

Dalam aplikasi CRUD sederhana, transaksi biasanya berarti:

```text
BEGIN TRANSACTION
  update table A
  insert table B
  delete table C
COMMIT
```

Jika gagal:

```text
ROLLBACK
```

Model ini cocok jika semua operasi:

1. Terjadi dalam satu database.
2. Durasi pendek.
3. Tidak menunggu manusia.
4. Tidak menunggu external system.
5. Tidak memanggil API yang punya side effect permanen.
6. Tidak melibatkan email, file, payment, notification, atau event yang sudah terkirim.

Namun workflow enterprise biasanya seperti ini:

```text
Applicant submits application
  -> System validates documents
  -> Officer reviews
  -> External agency gives clearance
  -> Payment requested
  -> Payment confirmed
  -> License generated
  -> Notification sent
  -> Audit archived
```

Proses ini bisa berlangsung:

- beberapa menit,
- beberapa jam,
- beberapa hari,
- beberapa minggu,
- bahkan beberapa bulan.

Selama proses berjalan:

- user bisa submit ulang dokumen,
- officer bisa reject,
- external agency bisa timeout,
- payment bisa sukses tapi callback terlambat,
- license generation bisa gagal,
- notification bisa terkirim dua kali,
- policy bisa berubah,
- process version bisa berubah,
- application bisa dibatalkan,
- case bisa direopen.

Tidak mungkin semua ini dibungkus dalam satu database transaction.

### Core Realization

> Long-running business process tidak diselesaikan dengan rollback teknis. Ia diselesaikan dengan explicit state, retry, compensation, manual repair, dan audit trail.

---

## 2. ACID Transaction vs Long-running Business Transaction

### 2.1 ACID Transaction

ACID transaction adalah transaction lokal yang biasanya berlaku di satu resource manager, misalnya satu database.

Karakteristik:

| Aspek | ACID Transaction |
|---|---|
| Durasi | Pendek |
| Scope | Satu DB / satu transaction manager |
| Failure handling | Rollback |
| Visibility | Biasanya internal system |
| Human interaction | Tidak cocok |
| External side effect | Berbahaya jika masuk transaction |
| Audit business | Perlu dibangun terpisah |

Contoh:

```java
@Transactional
public void approveApplication(Long applicationId) {
    Application app = applicationRepository.findByIdForUpdate(applicationId);
    app.approve();
    auditRepository.insert(...);
}
```

Ini bagus untuk update lokal yang cepat.

Tapi tidak cukup untuk:

```text
Approve application
  -> call payment gateway
  -> generate license PDF
  -> send email
  -> update external regulator
  -> wait for callback
```

### 2.2 Long-running Business Transaction

Long-running transaction adalah transaksi bisnis yang selesai ketika seluruh business objective tercapai, bukan ketika satu database commit selesai.

Karakteristik:

| Aspek | Long-running Business Transaction |
|---|---|
| Durasi | Lama |
| Scope | Banyak sistem / manusia / event |
| Failure handling | Retry, compensate, escalate, repair |
| Visibility | Harus terlihat secara operasional |
| Human interaction | Umum |
| External side effect | Normal |
| Audit business | Wajib |

Contoh:

```text
Application Approval Transaction
  started when applicant submits form
  completed when license is issued or application is finally rejected/cancelled
```

---

## 3. Apa Itu Saga?

Saga adalah pola untuk mengelola long-running transaction yang dipecah menjadi beberapa local transaction.

Setiap step melakukan local transaction sendiri.

Jika step berikutnya gagal, sistem tidak melakukan rollback database global. Sistem menjalankan **compensating transaction** untuk membalikkan atau mengoreksi efek bisnis dari step sebelumnya.

### 3.1 Bentuk Umum Saga

```text
T1 -> T2 -> T3 -> T4
```

Jika `T3` gagal:

```text
T1 -> T2 -> T3 failed
      <- C2 <- C1
```

Keterangan:

- `T1`, `T2`, `T3`, `T4` = forward transactions.
- `C1`, `C2`, `C3` = compensating transactions.

### 3.2 Contoh Sederhana

```text
Reserve appointment slot
  -> Collect payment
  -> Generate confirmation letter
  -> Send notification
```

Jika generate confirmation letter gagal setelah payment sukses:

```text
Reserve appointment slot     SUCCESS
Collect payment              SUCCESS
Generate confirmation letter FAILED
Refund payment               COMPENSATION
Release appointment slot     COMPENSATION
Notify applicant             MANUAL/AUTO
```

### 3.3 Saga Bukan Rollback

Ini penting.

Rollback teknis:

```text
Undo database changes as if they never happened.
```

Compensation bisnis:

```text
Perform a new business action that semantically reverses, neutralizes, or corrects the previous action.
```

Contoh:

| Forward Action | Compensation |
|---|---|
| Take payment | Refund payment |
| Reserve slot | Release slot |
| Issue license | Revoke license |
| Send email | Send correction email |
| Publish event | Publish reversal/correction event |
| Create external case | Close/cancel external case |

Compensation tidak menghapus sejarah. Justru ia menambah sejarah.

Dalam sistem regulatory, ini sangat penting karena audit tidak boleh menyembunyikan fakta bahwa sesuatu pernah terjadi.

---

## 4. Mengapa BPMN Cocok Untuk Saga?

BPMN cocok untuk saga karena saga sebenarnya adalah proses eksplisit:

```text
Do A
If A succeeds, do B
If B fails, compensate A
If compensation fails, escalate to human
If external callback arrives late, decide how to handle it
```

BPMN menyediakan bahasa visual dan executable untuk menggambarkan:

- forward step,
- error path,
- compensation path,
- timer path,
- message callback,
- manual repair,
- escalation,
- audit checkpoint.

### 4.1 Saga Dalam BPMN

Representasi umum:

```text
(Start)
  -> [Reserve Resource]
  -> [Take Payment]
  -> [Generate License]
  -> [Notify Applicant]
  -> (End)

If Generate License fails:
  -> [Refund Payment]
  -> [Release Resource]
  -> [Manual Review]
```

Atau dengan compensation event:

```text
[Reserve Resource] -- compensation handler --> [Release Resource]
[Take Payment]    -- compensation handler --> [Refund Payment]
[Issue License]   -- compensation handler --> [Revoke License]
```

Saat compensation throw event terjadi, compensation handler untuk aktivitas yang sudah selesai dapat dipanggil.

### 4.2 BPMN Membuat Saga Terlihat

Tanpa BPMN, saga sering tersebar di:

- event consumer,
- scheduled job,
- service method,
- database status,
- retry table,
- manual SQL script,
- hidden if/else.

Dengan BPMN, kita bisa melihat:

```text
What was done?
What is pending?
What failed?
What can be retried?
What must be compensated?
Who must decide?
What is the audit explanation?
```

---

## 5. Dua Model Saga: Orchestration vs Choreography

### 5.1 Orchestration-based Saga

Ada satu coordinator yang menentukan step berikutnya.

Dalam konteks seri ini, coordinator-nya adalah BPMN process engine.

```text
Process Engine
  -> Command Service A
  <- Result A
  -> Command Service B
  <- Result B
  -> Command Service C
  <- Result C
```

Kelebihan:

- process visibility tinggi,
- error handling eksplisit,
- audit lebih mudah,
- cocok untuk human workflow,
- cocok untuk SLA/escalation,
- cocok untuk regulatory process.

Kekurangan:

- coordinator bisa menjadi pusat coupling,
- process model bisa membesar,
- semua flow terlihat seperti dikendalikan pusat,
- perlu disiplin boundary agar tidak jadi distributed monolith.

### 5.2 Choreography-based Saga

Tidak ada central coordinator. Setiap service bereaksi terhadap event.

```text
ApplicationSubmitted event
  -> Document Service validates
  -> DocumentValidated event
  -> Payment Service requests payment
  -> PaymentConfirmed event
  -> License Service issues license
```

Kelebihan:

- service lebih autonomous,
- cocok untuk event-driven architecture,
- decoupling lebih tinggi secara teknis,
- scalable secara organisasi jika boundary matang.

Kekurangan:

- sulit melihat end-to-end state,
- failure path tersebar,
- audit end-to-end lebih sulit,
- retry/compensation tersebar,
- debugging sulit,
- tidak ideal untuk proses regulatory yang perlu explanation chain.

### 5.3 Decision Matrix

| Kebutuhan | Orchestration BPMN | Choreography Event |
|---|---:|---:|
| Human approval | Sangat cocok | Kurang eksplisit |
| SLA/escalation | Sangat cocok | Perlu custom logic |
| Audit end-to-end | Sangat cocok | Sulit |
| Regulatory explanation | Sangat cocok | Sulit |
| High-volume autonomous events | Bisa, tapi hati-hati | Sangat cocok |
| Loose domain autonomy | Sedang | Sangat cocok |
| Business-readable process | Sangat cocok | Rendah |
| Failure path eksplisit | Sangat cocok | Tersebar |

### 5.4 Hybrid Model Yang Sering Paling Realistis

Top 1% engineer jarang fanatik pada satu model.

Model yang sering terbaik:

```text
BPMN orchestrates the business process.
Domain services own their data and invariants.
Events publish facts to the wider ecosystem.
Workers bridge process commands to domain actions.
Outbox/inbox ensures reliable event delivery and deduplication.
```

Diagram:

```text
          +---------------------+
          | BPMN Process Engine |
          +----------+----------+
                     |
                     | command/job
                     v
+--------------------+--------------------+
| Java Worker / Process Adapter           |
+--------------------+--------------------+
                     |
                     | transactional local call
                     v
+--------------------+--------------------+
| Domain Service / Database               |
| - owns invariants                        |
| - writes state                           |
| - writes outbox                          |
+--------------------+--------------------+
                     |
                     | async event
                     v
+--------------------+--------------------+
| Kafka/RabbitMQ/Webhook Consumers         |
+-----------------------------------------+
```

---

## 6. Saga Step Anatomy

Setiap saga step harus dipikirkan sebagai unit yang punya kontrak lengkap.

Template:

```text
Step Name:
  Business intent:
  Input:
  Output:
  Local transaction:
  External side effect:
  Idempotency key:
  Retry policy:
  Compensation:
  Failure classification:
  Timeout behavior:
  Manual repair path:
  Audit record:
  Security boundary:
```

Contoh:

```text
Step Name:
  Reserve Exam Seat

Business intent:
  Reserve one seat for applicant in selected exam session.

Input:
  applicationId, applicantId, examSessionId

Output:
  reservationId, reservationExpiryAt

Local transaction:
  Insert reservation row with RESERVED status.

External side effect:
  None if reservation is internal.

Idempotency key:
  applicationId + examSessionId + commandType=RESERVE_EXAM_SEAT

Retry policy:
  Retry transient DB/network failure.
  Do not retry if seat full.

Compensation:
  Release reservation if payment/application fails.

Failure classification:
  - SeatFull: BPMN business error
  - DBTimeout: technical retry
  - UnknownAfterCommit: reconciliation required

Timeout behavior:
  Reservation expires after configured business duration.

Manual repair path:
  Officer can manually release or confirm reservation.

Audit record:
  who/what/when/reason/source correlation id.

Security boundary:
  Only process worker service can reserve system-level seat.
```

---

## 7. Local Transaction Pattern Inside Saga Step

Setiap forward step harus melakukan local transaction secara aman.

### 7.1 Bad Pattern: External Call Inside DB Transaction

```java
@Transactional
public void approveAndNotify(Long applicationId) {
    Application app = repository.findById(applicationId);
    app.approve();

    emailClient.sendApprovalEmail(app.getEmail()); // bad inside DB tx

    repository.save(app);
}
```

Masalah:

- Jika email sukses tapi DB commit gagal, email sudah terkirim.
- Jika DB lock lama, external call memperpanjang transaction.
- Jika external API lambat, connection pool tertahan.
- Retry method bisa mengirim email dua kali.

### 7.2 Better Pattern: Local State + Outbox

```java
@Transactional
public void approveApplication(ApproveApplicationCommand cmd) {
    Application app = repository.findByIdForUpdate(cmd.applicationId());

    app.approve(cmd.officerId(), cmd.reason());

    outboxRepository.insert(new OutboxEvent(
        cmd.commandId(),
        "ApplicationApproved",
        app.getId(),
        toJson(...)
    ));

    auditRepository.insert(...);
}
```

Lalu publisher async mengirim event/email command.

### 7.3 Worker Completion Setelah Local Commit

Dalam Camunda 8 worker:

```text
1. Activate job
2. Execute local transaction
3. Commit local transaction
4. Complete Camunda job
```

Failure window:

```text
Local transaction committed, but completeJob failed.
```

Konsekuensi:

- Job bisa di-deliver ulang.
- Worker harus idempotent.
- Local command table harus mendeteksi bahwa side effect sudah dilakukan.
- Worker dapat complete job ulang dengan output yang sama.

---

## 8. Idempotency Dalam Saga

Saga tanpa idempotency adalah bom waktu.

### 8.1 Kenapa Duplicate Bisa Terjadi?

Duplicate bisa muncul karena:

- job timeout,
- worker crash,
- network timeout setelah external side effect sukses,
- retry otomatis,
- event redelivery,
- manual retry dari Operate,
- user klik submit dua kali,
- callback payment dikirim ulang,
- scheduler menjalankan command ulang,
- deployment restart.

### 8.2 Idempotency Key Design

Idempotency key harus merepresentasikan business command, bukan sekadar request teknis.

Contoh buruk:

```text
UUID.randomUUID() per retry
```

Kenapa buruk?

Karena retry akan dianggap command baru.

Contoh lebih baik:

```text
applicationId + commandType + processInstanceKey + elementId
```

Atau:

```text
paymentReference + commandType=CAPTURE_PAYMENT
```

Atau:

```text
licenseApplicationNo + commandType=ISSUE_LICENSE
```

### 8.3 Command Dedup Table

```sql
CREATE TABLE processed_command (
    idempotency_key      VARCHAR(200) PRIMARY KEY,
    command_type         VARCHAR(100) NOT NULL,
    aggregate_id         VARCHAR(100) NOT NULL,
    status               VARCHAR(30)  NOT NULL,
    result_payload       CLOB,
    error_code           VARCHAR(100),
    created_at           TIMESTAMP NOT NULL,
    updated_at           TIMESTAMP NOT NULL
);
```

Flow:

```text
Worker receives job
  -> derive idempotency key
  -> try insert processed_command IN_PROGRESS
  -> if duplicate SUCCESS, return previous result
  -> if duplicate IN_PROGRESS, decide wait/fail/retry
  -> execute domain action
  -> mark SUCCESS with result
  -> complete job
```

### 8.4 Java Skeleton

```java
public final class SagaStepExecutor {

    private final ProcessedCommandRepository commandRepository;
    private final TransactionTemplate transactionTemplate;

    public <R> R executeIdempotently(
            String idempotencyKey,
            String commandType,
            Supplier<R> action,
            Function<R, String> resultSerializer
    ) {
        ProcessedCommand existing = commandRepository.find(idempotencyKey);

        if (existing != null && existing.isSuccess()) {
            return existing.resultAsObject();
        }

        return transactionTemplate.execute(status -> {
            ProcessedCommand insertedOrExisting =
                    commandRepository.insertIfAbsent(idempotencyKey, commandType);

            if (insertedOrExisting.isSuccess()) {
                return insertedOrExisting.resultAsObject();
            }

            R result = action.get();

            commandRepository.markSuccess(
                    idempotencyKey,
                    resultSerializer.apply(result)
            );

            return result;
        });
    }
}
```

Catatan:

- Implementasi sebenarnya harus memperhatikan locking.
- `IN_PROGRESS` yang stale perlu recovery.
- Jangan menyimpan payload besar di table ini jika hasil besar.
- Simpan reference jika perlu.

---

## 9. Compensation Engineering

Compensation adalah aksi bisnis untuk memperbaiki efek aksi sebelumnya.

### 9.1 Compensation Harus Explicit

Jangan menulis:

```text
If failed, rollback previous steps.
```

Tulis:

```text
If license issuance fails after payment captured:
  1. Refund payment using original payment reference.
  2. Release reserved license number.
  3. Mark application as PAYMENT_REFUNDED_DUE_TO_ISSUANCE_FAILURE.
  4. Notify applicant.
  5. Create audit record.
```

### 9.2 Compensation Bisa Gagal

Ini sering dilupakan.

Refund bisa gagal.
Release resource bisa gagal.
External agency cancellation bisa timeout.
Revoke license bisa butuh approval.
Correction email bisa gagal terkirim.

Maka compensation sendiri perlu:

- idempotency,
- retry,
- timeout,
- incident,
- manual repair,
- audit trail.

### 9.3 Compensation Step Template

```text
Compensation Name:
  Original action compensated:
  Compensation trigger:
  Preconditions:
  Idempotency key:
  External reference required:
  Expected result:
  Retry policy:
  Failure handling:
  Manual fallback:
  Audit text:
```

Contoh:

```text
Compensation Name:
  Refund Application Fee

Original action compensated:
  Capture Application Fee

Compensation trigger:
  Application cannot proceed after payment captured.

Preconditions:
  paymentStatus = CAPTURED
  refundStatus not in (REFUNDED, REFUND_REQUESTED)

Idempotency key:
  originalPaymentReference + REFUND

External reference required:
  paymentReference, amount, currency

Expected result:
  refundReference, refundStatus

Retry policy:
  Retry transient payment gateway error 5 times.

Failure handling:
  Create incident and manual finance review task.

Manual fallback:
  Finance officer performs manual refund and records reference.

Audit text:
  Application fee refunded due to failed license issuance.
```

### 9.4 Compensation Tidak Selalu Mengembalikan Ke Status Awal

Contoh:

```text
Before payment: APPLICATION_PENDING_PAYMENT
After failed issuance + refund: APPLICATION_REFUNDED_AFTER_ISSUANCE_FAILURE
```

Bukan:

```text
APPLICATION_PENDING_PAYMENT
```

Kenapa?

Karena sejarah berbeda.

Status akhir harus menjelaskan perjalanan bisnis, bukan menipu seolah-olah payment tidak pernah terjadi.

---

## 10. Forward Recovery vs Backward Recovery

### 10.1 Backward Recovery

Backward recovery berarti membalikkan step yang sudah berhasil.

```text
Reserve seat -> Capture payment -> Issue license fails
  -> Refund payment
  -> Release seat
```

Cocok jika:

- proses tidak boleh lanjut,
- step sebelumnya bisa dibalik,
- business ingin kembali ke safe terminal state.

### 10.2 Forward Recovery

Forward recovery berarti memperbaiki dan melanjutkan proses, bukan membalikkan.

```text
Reserve seat -> Capture payment -> Issue license fails due to PDF service down
  -> Retry issue license
  -> Manual regenerate license
  -> Continue notification
```

Cocok jika:

- step sebelumnya valid,
- kegagalan bersifat teknis,
- business objective masih bisa dicapai,
- compensation justru merugikan.

### 10.3 Decision Matrix

| Failure | Better Recovery |
|---|---|
| Payment gateway timeout before knowing result | Reconcile/forward recovery |
| Seat no longer available before payment | Business error/backward or alternate path |
| License PDF service down | Forward recovery |
| Applicant found ineligible after payment | Backward compensation/refund |
| Notification email failed | Forward retry/manual resend |
| External agency rejects | Business path, not technical compensation |
| License issued with wrong data | Correct/revoke/reissue, case-specific |

### 10.4 Top 1% Rule

> Jangan kompensasi hanya karena ada error. Pertama klasifikasikan apakah business objective masih bisa dicapai dengan aman.

---

## 11. Saga Failure Classification

Failure dalam saga harus diklasifikasikan.

### 11.1 Technical Transient Failure

Contoh:

- HTTP 503,
- network timeout,
- database deadlock,
- temporary DNS issue,
- rate limit sementara.

Action:

```text
fail job with retry/backoff
```

### 11.2 Technical Permanent Failure

Contoh:

- invalid service configuration,
- missing credential,
- incompatible payload schema,
- required field missing due to bug,
- unmapped enum.

Action:

```text
create incident / stop for operator repair
```

### 11.3 Business Expected Failure

Contoh:

- applicant not eligible,
- payment declined,
- duplicate application,
- clearance rejected,
- document expired.

Action:

```text
throw BPMN error or follow modeled gateway path
```

### 11.4 Business Exceptional Failure

Contoh:

- suspicious payment,
- conflicting agency response,
- manual investigation required,
- regulatory override needed.

Action:

```text
escalate to human task / investigation subprocess
```

### 11.5 Ambiguous Failure

Contoh:

- timeout after calling payment capture,
- worker crash after issuing license but before saving reference,
- external API returned 500 but actually processed request,
- callback delayed.

Action:

```text
reconciliation before retry or compensation
```

This is one of the most important categories.

Ambiguous failure cannot be solved by blind retry.

---

## 12. Ambiguous Side Effect Problem

### 12.1 The Dangerous Window

```text
Worker calls external API
External API succeeds
Network response lost
Worker thinks it failed
Worker retries
External API performs duplicate side effect
```

Example:

```text
Payment captured twice.
License issued twice.
Email sent twice.
External case created twice.
```

### 12.2 Prevention Strategy

Use external idempotency key if the external system supports it.

```text
Idempotency-Key: applicationId + paymentCommandId
```

Store external reference.

```text
paymentReference
licenseReference
externalCaseReference
notificationReference
```

Use reconciliation endpoint before retry.

```text
GET /payments/by-idempotency-key/{key}
GET /licenses/by-application/{applicationNo}
GET /external-cases/by-correlation/{correlationId}
```

### 12.3 BPMN Pattern

```text
[Capture Payment]
   boundary error/incident? no direct blind compensation
   -> [Reconcile Payment Status]
        -> if captured: continue
        -> if not captured: retry capture
        -> if unknown: manual finance review
```

### 12.4 Java Pseudo-code

```java
PaymentResult capturePayment(CapturePaymentCommand cmd) {
    String idemKey = cmd.applicationId() + ":CAPTURE_PAYMENT";

    PaymentRecord existing = paymentRepository.findByIdempotencyKey(idemKey);
    if (existing != null && existing.isCaptured()) {
        return existing.toResult();
    }

    try {
        PaymentGatewayResponse response = gateway.capture(
                cmd.amount(),
                cmd.currency(),
                idemKey
        );

        return paymentRepository.markCaptured(idemKey, response.reference());

    } catch (TimeoutException ex) {
        PaymentGatewayStatus status = gateway.lookupByIdempotencyKey(idemKey);

        if (status.isCaptured()) {
            return paymentRepository.markCaptured(idemKey, status.reference());
        }

        if (status.isNotFound()) {
            throw new RetryableTechnicalException("Payment capture uncertain but not found yet", ex);
        }

        throw new AmbiguousSideEffectException("Payment capture status unknown", ex);
    }
}
```

---

## 13. Saga With BPMN Error vs Incident vs Compensation

A common confusion:

```text
When should I throw BPMN error?
When should I fail job?
When should I compensate?
When should I create human task?
```

### 13.1 Decision Table

| Situation | BPMN Action |
|---|---|
| Payment declined | BPMN error/business path |
| Payment API down | fail job with retry |
| Payment status unknown | reconciliation path or incident |
| Payment captured but later process impossible | compensation refund |
| Refund fails | incident/manual finance task |
| Applicant ineligible | BPMN business path |
| Worker bug | incident |
| Officer override required | user task/escalation |
| SLA expired | timer path |
| External agency rejected | modeled business result |

### 13.2 Mental Model

```text
Business expected outcome -> BPMN path
Technical temporary failure -> retry
Technical unrecoverable failure -> incident
Previous completed step no longer desired -> compensation
Human judgment required -> user task/escalation
Unknown side effect -> reconciliation
```

---

## 14. Modeling Saga in BPMN

### 14.1 Simple Explicit Compensation Model

```text
(Start)
  -> [Reserve Seat]
  -> [Capture Payment]
  -> [Issue License]
  -> [Send Notification]
  -> (End Success)

[Issue License] failure:
  -> [Refund Payment]
  -> [Release Seat]
  -> [Notify Failure]
  -> (End Compensated)
```

This is simple and very readable.

Use this when:

- compensation path is small,
- business wants explicit visibility,
- engine support for compensation event is not desired or not mature in your target version,
- you want precise custom ordering.

### 14.2 BPMN Compensation Event Model

Conceptually:

```text
[Reserve Seat] has compensation handler [Release Seat]
[Capture Payment] has compensation handler [Refund Payment]
[Issue License] has compensation handler [Revoke License]

If later failure occurs:
  -> throw compensation
  -> engine invokes relevant compensation handlers for completed activities
```

Use this when:

- compensation follows completed activity semantics,
- model readability remains good,
- runtime supports required compensation semantics,
- team understands compensation behavior deeply.

### 14.3 Manual Repair Model

```text
[Capture Payment]
  -> [Issue License]
       technical failure retries exhausted
       -> incident / operator repair
       -> [Manual License Issuance Task]
       -> [Record Manual Result]
       -> continue
```

Use this when:

- compensation is risky,
- human can repair better,
- business objective should continue,
- failure is exceptional but recoverable.

### 14.4 Reconciliation Model

```text
[Call External System]
  -> timeout/unknown
  -> [Reconcile External Status]
       -> found success: continue
       -> found failure: retry or business path
       -> still unknown: manual review
```

Use this for:

- payment,
- license issuance,
- external case creation,
- document signing,
- third-party submission.

---

## 15. Saga State Modeling

Saga state should not exist only in Camunda variables.

### 15.1 Process State vs Domain State

Process state:

```text
Currently waiting for payment confirmation.
Currently compensating payment.
Currently awaiting officer decision.
```

Domain state:

```text
Application status = PENDING_PAYMENT
Payment status = CAPTURED
License status = ISSUED
Refund status = REQUESTED
```

Process engine coordinates.
Domain database owns business facts.

### 15.2 Recommended Domain Tables

Example:

```sql
APPLICATION
  id
  application_no
  status
  applicant_id
  current_process_instance_key
  created_at
  updated_at

PAYMENT
  id
  application_id
  idempotency_key
  payment_reference
  status
  amount
  currency
  captured_at
  refunded_at

LICENSE
  id
  application_id
  license_no
  status
  issued_at
  revoked_at

SAGA_AUDIT
  id
  application_id
  process_instance_key
  element_id
  action
  result
  reason
  actor_type
  actor_id
  created_at
```

### 15.3 Why Not Store Everything in Process Variables?

Because:

- variable query may not be optimized as domain query,
- variable schema evolution is harder,
- sensitive data exposure risk,
- audit domain needs structured records,
- reporting needs stable domain tables,
- process instance can end but domain facts remain.

Use process variables for execution context.
Use domain tables for business truth.

---

## 16. Saga and Outbox/Inbox

### 16.1 Outbox For Reliable Event Publishing

In saga, local transaction often needs to publish event.

Bad:

```text
DB commit success, event publish fails
```

Outbox solves this:

```text
Local DB transaction:
  update application
  insert outbox event
commit

Publisher:
  read outbox
  publish to broker
  mark published
```

### 16.2 Inbox For Reliable Event Consumption

When receiving event/callback:

```text
Receive PaymentConfirmed event
  -> check event_id in inbox
  -> if already processed, ignore/return OK
  -> persist inbox record
  -> update payment/application
  -> correlate message to Camunda
```

### 16.3 Inbox + Camunda Message Correlation

Flow:

```text
Payment callback received
  -> validate signature
  -> store inbound event idempotently
  -> update payment status locally
  -> publish/correlate BPMN message PaymentConfirmed
  -> mark event processed
```

If correlation fails because process not waiting yet:

- use message TTL if appropriate,
- store pending event,
- retry correlation,
- or use deterministic process state check.

---

## 17. Worker Design For Saga Steps

### 17.1 Worker Responsibility

A worker should:

1. Deserialize variables.
2. Validate command input.
3. Derive idempotency key.
4. Execute domain action transactionally.
5. Classify failures.
6. Return minimal result variables.
7. Emit metrics/logs.
8. Never hide ambiguous side effects.

A worker should not:

- own full process logic,
- perform large branching hidden from BPMN,
- store domain truth only in variables,
- perform blind retry for unknown side effects,
- swallow business exceptions as technical retry.

### 17.2 Worker Skeleton

```java
@JobWorker(type = "capture-payment")
public Map<String, Object> capturePayment(JobClient client, ActivatedJob job) {
    CapturePaymentVariables vars = variableMapper.map(job, CapturePaymentVariables.class);

    String idempotencyKey = vars.applicationId() + ":CAPTURE_PAYMENT";

    try {
        PaymentResult result = sagaStepExecutor.executeIdempotently(
                idempotencyKey,
                "CAPTURE_PAYMENT",
                () -> paymentService.capture(vars.applicationId(), vars.amount(), vars.currency()),
                json::write
        );

        return Map.of(
                "paymentStatus", result.status(),
                "paymentReference", result.reference()
        );

    } catch (PaymentDeclinedException ex) {
        throw new BpmnBusinessError("PAYMENT_DECLINED", ex.getMessage());

    } catch (AmbiguousSideEffectException ex) {
        throw new NonRetryableIncidentException("PAYMENT_STATUS_UNKNOWN", ex);

    } catch (TransientExternalException ex) {
        throw new RetryableTechnicalException("Payment gateway unavailable", ex);
    }
}
```

The exact annotation/API depends on the worker framework used, but the structure is stable.

---

## 18. Saga Retry Policy

### 18.1 Retry Is Not One Thing

Different retries:

| Retry Type | Purpose | Example |
|---|---|---|
| Job retry | Technical worker failure | API 503 |
| Business retry | Business re-attempt after user action | resubmit document |
| Message retry | Event correlation failed | process not waiting yet |
| Compensation retry | Compensation failed | refund API down |
| Manual retry | Operator decides to retry | after config fixed |

### 18.2 Retry Policy Example

```text
capture-payment:
  transient network failure: retry 5 times with exponential backoff
  payment declined: BPMN business path, no retry
  unknown status: reconciliation path
  invalid credential: incident, no automatic retry until config fixed
```

### 18.3 Backoff Strategy

Example:

```text
attempt 1: immediate
attempt 2: 30 seconds
attempt 3: 2 minutes
attempt 4: 10 minutes
attempt 5: 30 minutes
then incident/manual review
```

Do not retry aggressively if external system has rate limit.

---

## 19. Saga With Human Task

Not all saga decisions are technical.

Example:

```text
External agency response conflicts with internal assessment.
```

Do not hide this in code.

Model:

```text
[Receive Agency Response]
  -> [Evaluate Conflict]
      -> no conflict: continue
      -> conflict: [Senior Officer Review]
            -> proceed
            -> reject
            -> request clarification
```

Human task must capture:

- decision,
- reason,
- actor,
- timestamp,
- attachments/evidence,
- policy reference,
- override justification.

---

## 20. Saga Auditability

Saga audit must answer:

```text
What was attempted?
What succeeded?
What failed?
What was retried?
What was compensated?
Who approved manual override?
What external reference proves the side effect?
What policy was used?
What was the final business outcome?
```

### 20.1 Audit Record Template

```json
{
  "applicationId": "APP-2026-000123",
  "processInstanceKey": "2251799813685249",
  "sagaStep": "CAPTURE_PAYMENT",
  "action": "PAYMENT_CAPTURED",
  "result": "SUCCESS",
  "externalReference": "PAY-998877",
  "idempotencyKey": "APP-2026-000123:CAPTURE_PAYMENT",
  "actorType": "SYSTEM_WORKER",
  "workerName": "payment-worker",
  "timestamp": "2026-06-17T08:30:00+07:00",
  "reason": "Application fee required before issuance"
}
```

### 20.2 Compensation Audit

```json
{
  "applicationId": "APP-2026-000123",
  "sagaStep": "REFUND_PAYMENT",
  "compensates": "CAPTURE_PAYMENT",
  "action": "PAYMENT_REFUNDED",
  "result": "SUCCESS",
  "originalReference": "PAY-998877",
  "compensationReference": "REF-112233",
  "reason": "License issuance failed after payment capture",
  "timestamp": "2026-06-17T09:15:00+07:00"
}
```

---

## 21. Saga Observability

Metrics:

```text
saga_started_total
saga_completed_total
saga_compensated_total
saga_failed_total
saga_manual_repair_total
saga_step_duration_seconds
saga_step_retry_total
saga_compensation_failure_total
saga_ambiguous_side_effect_total
```

Logs should include:

- process instance key,
- business key,
- application ID,
- job key,
- element ID,
- idempotency key,
- external reference,
- retry count,
- failure class.

Trace should cross:

```text
Camunda job -> Java worker -> domain service -> database -> external API -> outbox event
```

---

## 22. Saga Versioning

Saga models change over time.

Questions:

1. What happens to running instances?
2. Can old process continue with old worker contract?
3. Does compensation still exist for old step?
4. Did variable schema change?
5. Did external reference format change?
6. Can old payment be refunded using new refund logic?

### 22.1 Compatibility Rule

If a forward step exists in version N, its compensation must remain executable while any instance of version N may still need it.

Do not delete compensation capability just because new process version no longer uses that step.

### 22.2 Worker Version Strategy

Options:

```text
Same worker supports old and new variable contract.
```

or:

```text
Different job types per major behavior version:
  capture-payment-v1
  capture-payment-v2
```

or:

```text
Same job type but version field in variables:
  paymentContractVersion = 2
```

Choose based on blast radius and migration complexity.

---

## 23. Saga Testing Strategy

### 23.1 Test Categories

| Test | Purpose |
|---|---|
| Worker unit test | Failure classification/idempotency |
| Domain transaction test | Local invariants |
| BPMN path test | Process path correctness |
| Compensation test | Undo/correction semantics |
| Duplicate job test | Idempotency |
| Timeout ambiguity test | Reconciliation |
| Message duplicate test | Inbox dedup |
| Manual repair test | Operator path |
| Migration test | Old instances survive |

### 23.2 Critical Test Scenarios

For each saga:

```text
1. All steps succeed.
2. Step 1 fails before side effect.
3. Step 2 fails after Step 1 succeeds.
4. Step 3 fails after payment captured.
5. Compensation succeeds.
6. Compensation fails and creates manual task/incident.
7. Worker crashes after local commit before job completion.
8. External timeout occurs after side effect succeeds.
9. Duplicate callback arrives.
10. Manual repair completes process.
```

### 23.3 Example Test Matrix

```text
Scenario: License issuance fails after payment capture
Expected:
  payment captured = true
  license issued = false
  refund requested = true
  application status = REFUND_PENDING or COMPENSATED
  audit contains CAPTURE_PAYMENT and REFUND_PAYMENT
  process ends in compensated state or waits for finance review
```

---

## 24. Regulatory Case Management Example

### 24.1 Scenario

A professional license application process:

```text
Submit Application
  -> Validate Documents
  -> Reserve License Number
  -> Request Payment
  -> Capture Payment
  -> External Clearance
  -> Issue License
  -> Notify Applicant
```

### 24.2 Forward Steps

| Step | Local State | External Side Effect |
|---|---|---|
| Validate Documents | document check result | none |
| Reserve License Number | license no reserved | maybe internal only |
| Request Payment | payment requested | payment link created |
| Capture Payment | payment captured | payment gateway charge |
| External Clearance | clearance requested | external agency request |
| Issue License | license issued | document/signing system |
| Notify Applicant | notification record | email/SMS sent |

### 24.3 Compensation Steps

| Forward Step | Compensation |
|---|---|
| Reserve License Number | Release license number |
| Capture Payment | Refund payment |
| External Clearance Request | Cancel/close external request if allowed |
| Issue License | Revoke license / mark issued-in-error |
| Notify Applicant | Send correction notice |

### 24.4 Failure Example

```text
Payment captured successfully.
External clearance returns REJECTED.
```

Possible path:

```text
[Capture Payment] SUCCESS
[Wait External Clearance] REJECTED
[Refund Payment]
[Release License Number]
[Notify Rejection and Refund]
[Close Application as Rejected After Payment]
```

Do not set status back to:

```text
REJECTED
```

Better:

```text
REJECTED_REFUND_INITIATED
REJECTED_REFUNDED
```

because payment/refund history matters.

### 24.5 Ambiguous Example

```text
Issue License API timed out.
```

Danger:

- License may already be issued.
- Retrying may issue duplicate license.

Better path:

```text
[Issue License]
  timeout
  -> [Reconcile License By Application No]
       -> found issued: continue notification
       -> not found: retry issue
       -> unknown: manual license ops review
```

---

## 25. BPMN Modeling Patterns For Saga

### 25.1 Explicit Forward/Compensation Path

Best for readability.

```text
A -> B -> C
     C failure -> compensate B -> compensate A
```

### 25.2 Compensation Event Pattern

Best when compensation semantics match BPMN compensation behavior.

```text
Activities declare compensation handlers.
Compensation throw event invokes handlers for completed activities.
```

### 25.3 Reconciliation Before Retry Pattern

Best for external side effects.

```text
Call external system
  -> timeout
  -> reconcile
  -> decide retry/continue/manual
```

### 25.4 Manual Repair Pattern

Best for exceptional operational failures.

```text
technical incident
  -> operator fixes data/config
  -> retry job
```

or:

```text
business ambiguity
  -> officer task
  -> choose proceed/reject/compensate
```

### 25.5 Pivot Transaction Pattern

In saga literature, a pivot transaction is the point after which backward compensation may no longer be the default.

Example:

```text
Before license issuance:
  can refund/reject.

After license issuance:
  may need revoke/reissue/legal audit, not simple rollback.
```

BPMN should make pivot visible.

```text
[Issue License]  <-- pivot
```

---

## 26. Anti-patterns

### 26.1 Blind Retry After Unknown Side Effect

```text
Payment timeout -> retry capture
```

Could double charge.

Better:

```text
Payment timeout -> reconcile -> retry only if safe
```

### 26.2 Compensation As Delete

```sql
DELETE FROM license WHERE application_id = ?
```

Bad for regulatory audit.

Better:

```text
license status = REVOKED / ISSUED_IN_ERROR
audit reason recorded
```

### 26.3 Process Variable As Saga Database

Bad:

```text
paymentStatus only in Camunda variable
licenseStatus only in Camunda variable
```

Better:

```text
Domain tables own payment/license facts.
Process variables carry references and routing state.
```

### 26.4 Hidden Saga In Worker Code

Bad:

```text
One service task named "Process Application" does 15 steps internally.
```

Better:

```text
BPMN shows meaningful business checkpoints.
Workers execute bounded actions.
```

### 26.5 Compensation Without Idempotency

Bad:

```text
Refund payment every time compensation worker runs.
```

Better:

```text
Refund by original payment reference + refund idempotency key.
```

### 26.6 No Manual Repair Path

Bad assumption:

```text
All failures are solved by retry.
```

Reality:

```text
Some failures need human judgment, finance ops, data correction, or policy decision.
```

---

## 27. Design Review Checklist

Use this checklist before approving a saga design.

### 27.1 Business Semantics

- What is the business transaction boundary?
- What is the success terminal state?
- What are possible failure terminal states?
- What is the pivot point?
- Which steps are reversible?
- Which steps are not reversible?
- Which failures are business outcomes, not technical errors?

### 27.2 Step Contract

For every step:

- Is input explicit?
- Is output explicit?
- Is idempotency key defined?
- Is local transaction boundary known?
- Is external side effect known?
- Is retry policy known?
- Is compensation defined?
- Is manual repair path defined?
- Is audit record defined?

### 27.3 Compensation

- Is compensation semantically correct?
- Can compensation fail?
- Is compensation idempotent?
- Does compensation preserve audit history?
- Is compensation order correct?
- Is manual fallback available?

### 27.4 Ambiguity

- What happens after external timeout?
- Is reconciliation available?
- Is duplicate callback safe?
- Is duplicate job safe?
- Is delayed event safe?
- Is stale event rejected?

### 27.5 Data

- Are domain facts stored in domain DB?
- Are variables minimal?
- Are sensitive values minimized?
- Are external references stored?
- Is schema versioning planned?

### 27.6 Operations

- Can operator see stuck saga?
- Can operator retry safely?
- Can operator repair variables/data safely?
- Are alerts defined?
- Are runbooks written?
- Are metrics available?

---

## 28. Java 8–25 Considerations

### 28.1 Java 8

In Java 8 environments:

- use explicit executor services,
- avoid relying on modern records/sealed classes,
- use immutable DTO discipline manually,
- be careful with CompletableFuture thread pools,
- keep worker logic simple and testable.

### 28.2 Java 11/17

In Java 11/17:

- better HTTP client available from Java 11,
- improved GC/runtime stability,
- records available in Java 16+,
- good baseline for enterprise Camunda workers.

### 28.3 Java 21/25

In Java 21+:

- virtual threads can simplify blocking I/O workers,
- structured concurrency can improve bounded parallel orchestration inside worker code,
- pattern matching/records improve variable contract modeling,
- but do not use virtual threads to hide bad backpressure design.

Important:

> BPMN controls business concurrency. Java controls technical concurrency. Do not let Java concurrency accidentally violate process-level invariants.

---

## 29. Mental Model Summary

Saga engineering is not about drawing compensation arrows.

It is about designing a business transaction that remains explainable when reality becomes messy.

Key mental models:

```text
ACID rollback is local.
Business correction is explicit.
External side effects are never assumed safe.
Retry requires classification.
Compensation is a new business action.
Unknown outcome requires reconciliation.
Worker must be idempotent.
Process engine coordinates, domain services own truth.
Audit is part of the design, not an afterthought.
Manual repair is a first-class path.
```

---

## 30. Practical Heuristics

1. If a step calls an external system, assume duplicate and timeout will happen.
2. If a step has side effect, define idempotency before coding.
3. If a step can succeed but the response can be lost, define reconciliation.
4. If a step can no longer be desired after success, define compensation.
5. If compensation can fail, define manual repair.
6. If business users care about the decision, model it in BPMN/DMN, not hidden code.
7. If operators must support it at 2 AM, expose state, references, and safe retry.
8. If auditors ask two years later, preserve facts, not just final status.
9. If process variables grow huge, move data to domain storage and keep references.
10. If workflow becomes too centralized, reconsider boundary and event choreography.

---

## 31. Minimal Saga Design Template

```text
Saga Name:

Business Objective:

Start Trigger:

Success End State:

Failure End States:

Pivot Point:

Forward Steps:
  1. Step name
     - owner service
     - local transaction
     - side effect
     - idempotency key
     - output reference

Compensation Steps:
  1. Compensates which forward step
     - business meaning
     - idempotency key
     - retry policy
     - manual fallback

Business Errors:

Technical Failures:

Ambiguous Outcomes:

Reconciliation Strategy:

Manual Repair Tasks:

Audit Records:

Metrics and Alerts:

Versioning Strategy:

Testing Matrix:
```

---

## 32. What You Should Be Able To Do After This Part

After this part, you should be able to:

1. Explain why long-running business transactions cannot rely on ACID rollback.
2. Model a saga using BPMN.
3. Distinguish orchestration-based saga from choreography-based saga.
4. Design forward recovery and backward compensation.
5. Classify failures into technical, business, ambiguous, and manual-review categories.
6. Design idempotent saga workers.
7. Avoid duplicate external side effects.
8. Use reconciliation before retrying dangerous operations.
9. Define compensation that preserves audit history.
10. Build a design checklist for regulatory-grade saga processes.

---

## 33. References

- Camunda 8 Documentation — Compensation events: https://docs.camunda.io/docs/components/modeler/bpmn/compensation-events/
- Camunda 8 Documentation — Compensation handlers: https://docs.camunda.io/docs/components/modeler/bpmn/compensation-handler/
- Camunda 8 Documentation — Dealing with problems and exceptions: https://docs.camunda.io/docs/components/best-practices/development/dealing-with-problems-and-exceptions/
- Camunda 8 Documentation — Job workers: https://docs.camunda.io/docs/components/concepts/job-workers/
- Camunda 8 Documentation — Messages: https://docs.camunda.io/docs/components/concepts/messages/
- Camunda Best Practices Overview: https://docs.camunda.io/docs/components/best-practices/best-practices-overview/
- BPMN 2.0 Specification, OMG: https://www.omg.org/spec/BPMN/2.0.2/

---

## 34. Status Seri

Selesai sampai bagian ini:

- Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer
- Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract
- Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses
- Part 3 — BPMN Modeling Discipline: Membuat Process Model yang Bisa Hidup di Production
- Part 4 — Camunda Landscape: Camunda 7 vs Camunda 8
- Part 5 — Camunda 8 Runtime Internals: Zeebe Mental Model
- Part 6 — Java Client Engineering: From API Call to Production-grade Worker
- Part 7 — Job Worker Reliability: Idempotency, Retry, Backoff, Poison Jobs
- Part 8 — Process Variables: Data Contract, Scope, Serialization, and Governance
- Part 9 — BPMN Error, Technical Failure, Incident, Escalation, and Compensation
- Part 10 — Human Workflow: User Task, Assignment, Forms, SLA, and Authorization
- Part 11 — DMN and Decision Engineering: Separating Flow from Decision Logic
- Part 12 — Message Correlation and Event-driven Process Design
- Part 13 — Timers, SLA, Timeout, Expiry, and Scheduled Process Behavior
- Part 14 — Multi-instance, Parallelism, Fan-out/Fan-in, and Concurrency Control
- Part 15 — Subprocess, Call Activity, Reusable Process, and Process Composition
- Part 16 — Saga and Long-running Transaction Engineering with BPMN

Seri belum selesai.

Berikutnya:

- Part 17 — Camunda 7 Deep Dive: Embedded Engine, Job Executor, Transactions, and Spring Boot


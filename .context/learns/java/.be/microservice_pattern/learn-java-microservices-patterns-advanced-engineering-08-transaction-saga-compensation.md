# learn-java-microservices-patterns-advanced-engineering — Part 8
# Transaction Pattern: Local Transaction, Saga, and Compensation

> Seri: `learn-java-microservices-patterns-advanced-engineering`  
> Part: `08`  
> Filename: `learn-java-microservices-patterns-advanced-engineering-08-transaction-saga-compensation.md`  
> Status seri: **belum selesai** — ini adalah Part 8 dari 35.

---

## 0. Tujuan Part Ini

Setelah mempelajari synchronous API, asynchronous messaging, dan event-driven architecture, pertanyaan paling penting berikutnya adalah:

> Kalau satu business operation menyentuh banyak service, bagaimana menjaga correctness tanpa mengembalikan semua service ke satu database transaction global?

Part ini membahas **transaction pattern** untuk microservices:

1. Local transaction.
2. Distributed transaction dan kenapa sering tidak cocok.
3. Saga pattern.
4. Choreography-based saga.
5. Orchestration-based saga.
6. Compensation.
7. Semantic rollback.
8. Timeout, retry, idempotency, concurrency, dan isolation gap.
9. Saga state machine.
10. Auditability dan regulatory defensibility.
11. Failure matrix.
12. Java 8–25 design considerations.

Yang perlu diingat sejak awal:

> Saga bukan cara membuat distributed transaction terasa seperti local transaction. Saga adalah cara mendesain business process yang menerima bahwa sistem terdistribusi hanya bisa mencapai konsistensi lewat rangkaian perubahan lokal, observability, idempotency, compensation, dan reconciliation.

---

## 1. Masalah Dasar: Transaction Boundary Berubah Ketika Service Dipisah

Di monolith dengan satu database, banyak business operation terasa sederhana:

```text
begin transaction
  insert application
  update applicant profile
  reserve quota
  create audit trail
  create notification
commit
```

Selama semua tabel berada di satu database dan satu transaction manager, ACID transaction bisa menjaga atomicity.

Namun di microservices yang benar, masing-masing service memiliki data sendiri:

```text
Application Service  -> application_db
Profile Service      -> profile_db
Quota Service        -> quota_db
Audit Service        -> audit_db
Notification Service -> notification_db / broker
```

Maka operasi bisnis yang sama berubah menjadi proses terdistribusi:

```text
Submit Application
  -> Application Service creates application
  -> Profile Service validates applicant
  -> Quota Service reserves quota
  -> Audit Service records action
  -> Notification Service sends email
```

Pertanyaan correctness-nya:

1. Bagaimana jika Application berhasil tetapi Quota gagal?
2. Bagaimana jika Quota berhasil tetapi Notification gagal?
3. Bagaimana jika Notification terkirim tetapi Audit gagal?
4. Bagaimana jika retry membuat Quota reserved dua kali?
5. Bagaimana jika service restart di tengah proses?
6. Bagaimana jika user menekan submit dua kali?
7. Bagaimana jika message datang terlambat?
8. Bagaimana jika compensation gagal?
9. Bagaimana jika aturan bisnis berubah saat saga lama masih berjalan?

Inilah alasan transaction pattern dalam microservices jauh lebih dalam daripada sekadar “pakai saga”.

---

## 2. Local Transaction: Unit Correctness Paling Fundamental

Dalam microservices, prinsip dasarnya:

> Setiap service hanya boleh melakukan ACID transaction terhadap data yang ia miliki.

Contoh:

```text
Application Service local transaction:
  - insert application
  - insert application_status_history
  - insert outbox event ApplicationSubmitted
```

Dalam satu local transaction, service masih boleh menjaga invariant lokal:

1. Application number unik.
2. Status transition valid.
3. Actor authorized untuk command tersebut.
4. Required fields lengkap.
5. Outbox event tercatat atomically dengan perubahan state.

Contoh Java pseudo-code:

```java
@Transactional
public SubmitApplicationResult submit(SubmitApplicationCommand command) {
    IdempotencyRecord idempotency = idempotencyRepository.tryStart(
            command.idempotencyKey(),
            command.actorId(),
            command.applicationDraftId()
    );

    if (idempotency.isCompleted()) {
        return idempotency.previousResult();
    }

    Application application = Application.submit(
            command.applicationDraftId(),
            command.actorId(),
            clock.instant()
    );

    applicationRepository.save(application);

    outboxRepository.save(OutboxMessage.from(
            "ApplicationSubmitted",
            application.id(),
            application.version(),
            command.correlationId(),
            command.actorId()
    ));

    idempotencyRepository.complete(command.idempotencyKey(), application.id());

    return SubmitApplicationResult.accepted(application.id());
}
```

Hal penting:

```text
State change + outbox message + idempotency record
harus berada dalam local transaction yang sama.
```

Kalau tidak, kita masuk ke **dual-write problem**:

```text
DB commit berhasil, event publish gagal
atau
Event publish berhasil, DB commit gagal
```

Saga yang kuat hampir selalu membutuhkan fondasi local transaction yang benar.

---

## 3. Distributed Transaction dan Kenapa Sering Tidak Cocok

Distributed transaction mencoba menjaga atomicity lintas resource:

```text
Service A DB
Service B DB
Message broker
External system
```

Secara klasik, pendekatan ini memakai **two-phase commit**:

```text
Phase 1: prepare
Phase 2: commit / abort
```

Secara teori menarik. Secara praktik microservices modern sering menghindarinya karena:

1. Coupling tinggi antar resource.
2. Membutuhkan transaction coordinator.
3. Blocking saat coordinator/resource gagal.
4. Sulit untuk heterogenous systems.
5. Tidak cocok untuk broker/external API yang tidak mendukung XA/2PC.
6. Menahan lock terlalu lama.
7. Menurunkan availability.
8. Membuat service tidak benar-benar autonomous.
9. Sulit di-scale dan di-debug.
10. Tidak cocok untuk human task atau long-running process.

Banyak business operation bukan “database rollback”, tetapi **business correction**.

Contoh:

```text
Jika email sudah terkirim, tidak ada rollback teknis yang bisa membuat user “tidak pernah menerima email”.
```

Yang bisa dilakukan:

```text
send correction email
mark previous notification as superseded
record audit trail
continue with corrected state
```

Itulah wilayah saga dan compensation.

---

## 4. Apa Itu Saga?

Saga adalah rangkaian **local transaction** yang bersama-sama membentuk satu business process lintas service.

Setiap step:

1. Melakukan local transaction pada service pemilik data.
2. Menghasilkan event atau response.
3. Memicu step berikutnya.
4. Jika step tertentu gagal, proses menjalankan compensation terhadap step yang sudah selesai.

Model sederhana:

```text
T1 -> T2 -> T3 -> T4

Jika T3 gagal:
  C2 -> C1
```

Keterangan:

```text
T1 = local transaction 1
T2 = local transaction 2
T3 = local transaction 3
C2 = compensation untuk T2
C1 = compensation untuk T1
```

Saga cocok ketika:

1. Business process lintas service.
2. Strong atomic transaction tidak realistis.
3. Eventual consistency dapat diterima.
4. Setiap step punya semantic compensation atau correction path.
5. Proses bisa direpresentasikan sebagai state machine.
6. Observability dan audit trail penting.
7. Ada kemungkinan step berlangsung lama.

Saga tidak cocok ketika:

1. Invariant harus strong real-time lintas resource.
2. Tidak ada compensation yang sah secara bisnis.
3. Data harus atomically visible bersama-sama.
4. User tidak bisa menerima intermediate state.
5. External side effect irreversible dan tidak punya correction mechanism.
6. Team belum siap mengelola distributed failure.

---

## 5. Saga Bukan Rollback Database

Kesalahan paling umum:

> Menganggap compensation sama dengan rollback.

Rollback database berarti:

```text
perubahan tidak pernah terjadi
```

Compensation berarti:

```text
perubahan sudah terjadi, lalu dibuat perubahan baru untuk mengoreksi atau menetralkan efeknya
```

Contoh database rollback:

```text
insert row A
insert row B gagal
rollback
row A tidak pernah terlihat
```

Contoh compensation:

```text
Application submitted
Quota reserved
Payment failed
Quota released
Application marked as submission_failed
Audit trail records all steps
```

History tetap ada.

Dalam sistem regulated, ini justru penting:

```text
Yang benar bukan menghapus jejak kegagalan,
tetapi mencatat bahwa tindakan pernah dilakukan dan kemudian dikoreksi.
```

---

## 6. Semantic Compensation

Compensation harus didesain secara domain-specific.

Contoh buruk:

```text
DELETE FROM quota_reservation WHERE reservation_id = ?
```

Contoh lebih baik:

```text
ReserveQuota
  -> status: RESERVED

ReleaseQuota
  -> status: RELEASED
  -> reason: APPLICATION_SUBMISSION_FAILED
  -> releasedBy: SYSTEM
  -> releasedAt: timestamp
```

Kenapa lebih baik?

1. Audit trail jelas.
2. Idempotency lebih mudah.
3. Business meaning eksplisit.
4. Bisa direkonsiliasi.
5. Bisa dipertanggungjawabkan.
6. Bisa dianalisis saat incident.

Compensation harus menjawab:

1. Apa efek step yang ingin dikompensasi?
2. Apakah efek itu reversible?
3. Apakah reversal bersifat teknis atau bisnis?
4. Apakah reversal butuh approval manusia?
5. Apakah reversal boleh dilakukan otomatis?
6. Apakah compensation dapat gagal?
7. Bagaimana retry compensation?
8. Bagaimana jika compensation dilakukan dua kali?
9. Apa audit evidence-nya?

---

## 7. Jenis Step Dalam Saga

Tidak semua step sama.

### 7.1 Pure Local State Step

Contoh:

```text
Create application record
Mark case as pending_review
Create internal assignment
```

Biasanya mudah dikompensasi dengan state transition baru.

### 7.2 Resource Reservation Step

Contoh:

```text
Reserve quota
Reserve appointment slot
Reserve license number
Reserve inventory
```

Biasanya butuh:

1. Reservation id.
2. Expiry time.
3. Release command.
4. Idempotency key.
5. Reconciliation job.

### 7.3 External Side Effect Step

Contoh:

```text
Send email
Call payment gateway
Submit file to external agency
Trigger downstream legal action
```

Paling sulit karena efeknya bisa irreversible.

Strategi:

1. Delay external side effect sampai step kritikal selesai.
2. Gunakan pending state dulu.
3. Gunakan confirmation step.
4. Buat correction event.
5. Buat manual review path.
6. Catat audit trail lengkap.

### 7.4 Human Task Step

Contoh:

```text
Officer approves
Supervisor endorses
Applicant resubmits
Legal team reviews
```

Tidak bisa diperlakukan seperti API call biasa.

Butuh:

1. Long-running state.
2. SLA timer.
3. Escalation.
4. Cancellation.
5. Assignment change.
6. Versioned decision rule.
7. Audit trail.

### 7.5 Irreversible Business Step

Contoh:

```text
License officially issued
Legal notice served
Payment captured
External agency notified
```

Untuk step seperti ini, compensation mungkin bukan “undo”, tetapi:

```text
revoke
supersede
amend
refund
correct
notify correction
manual investigation
```

---

## 8. Saga Coordination Style

Ada dua gaya koordinasi utama:

1. Choreography.
2. Orchestration.

Keduanya valid. Keduanya bisa buruk jika salah konteks.

---

## 9. Choreography-Based Saga

Dalam choreography, tidak ada central coordinator. Setiap service bereaksi terhadap event dan menerbitkan event berikutnya.

Contoh:

```text
Application Service
  emits ApplicationSubmitted

Profile Service
  consumes ApplicationSubmitted
  validates profile
  emits ApplicantProfileValidated

Quota Service
  consumes ApplicantProfileValidated
  reserves quota
  emits QuotaReserved

Application Service
  consumes QuotaReserved
  marks application ReadyForReview
```

Failure:

```text
Quota Service emits QuotaReservationFailed
Application Service marks application SubmissionFailed
Profile Service may release temporary validation hold if needed
```

### 9.1 Kelebihan Choreography

1. Tidak ada central orchestrator.
2. Service lebih autonomous.
3. Cocok untuk simple linear process.
4. Natural untuk event-driven systems.
5. Mudah menambahkan passive consumer.
6. Throughput bisa tinggi.
7. Loose temporal coupling.

### 9.2 Kekurangan Choreography

1. Global process sulit dilihat.
2. Debugging lebih sulit.
3. Dependency tersembunyi dalam event subscription.
4. Risk event soup.
5. Compensation tersebar.
6. Sulit mengelola timeout global.
7. Sulit mengetahui “saga sekarang di state apa”.
8. Sulit untuk complex branching.
9. Testing end-to-end lebih berat.
10. Ownership process bisa kabur.

### 9.3 Kapan Choreography Cocok

Gunakan choreography jika:

1. Flow sederhana.
2. Event punya business meaning jelas.
3. Tidak banyak branching.
4. Tidak perlu central visibility kuat.
5. Setiap service benar-benar punya autonomy.
6. Failure handling lokal cukup.
7. Fan-out terkendali.

Contoh cocok:

```text
UserRegistered
  -> Email service sends welcome email
  -> Analytics service records signup
  -> CRM service updates lead
```

### 9.4 Kapan Choreography Berbahaya

Berbahaya jika:

1. Ada banyak conditional branch.
2. Ada long-running workflow.
3. Ada SLA/escalation.
4. Ada human approval.
5. Ada compensation kompleks.
6. Ada regulatory audit requirement kuat.
7. Ada banyak consumer yang mengubah state penting.
8. Tidak ada event catalog.

Contoh smell:

```text
ApplicationSubmitted
  -> 12 services consume
  -> 7 services emit follow-up events
  -> 3 services compensate partially
  -> no one owns global flow
```

Ini biasanya menjadi distributed spaghetti.

---

## 10. Orchestration-Based Saga

Dalam orchestration, ada coordinator yang eksplisit menyimpan state saga dan memerintahkan participant melakukan step.

Contoh:

```text
ApplicationSubmissionSaga
  1. Ask Profile Service to validate applicant
  2. Ask Quota Service to reserve quota
  3. Ask Application Service to mark submitted
  4. Ask Notification Service to send confirmation
```

Jika step gagal:

```text
ApplicationSubmissionSaga
  - tells Quota Service to release reservation
  - tells Application Service to mark submission failed
  - tells Audit Service to record failed saga
```

### 10.1 Kelebihan Orchestration

1. Process terlihat jelas.
2. State saga eksplisit.
3. Timeout global lebih mudah.
4. Compensation lebih terstruktur.
5. Cocok untuk complex workflow.
6. Cocok untuk human task.
7. Cocok untuk regulatory audit.
8. Testing process lebih mudah.
9. Debugging lebih mudah.
10. Ownership process lebih jelas.

### 10.2 Kekurangan Orchestration

1. Orchestrator bisa menjadi god service.
2. Participant bisa menjadi anemic service.
3. Coupling ke process definition meningkat.
4. Bottleneck jika tidak didesain benar.
5. Orchestrator failure harus ditangani serius.
6. Risk central business logic terlalu besar.
7. Versioning workflow lebih sulit.

### 10.3 Kapan Orchestration Cocok

Gunakan orchestration jika:

1. Process panjang.
2. Ada banyak branch.
3. Ada compensation kompleks.
4. Ada timer/SLA.
5. Ada manual task.
6. Ada audit requirement tinggi.
7. Ada kebutuhan melihat status proses.
8. Ada regulatory lifecycle.
9. Ada need for deterministic process replay.

Contoh cocok:

```text
License Application Processing
  -> submit
  -> validate
  -> screen
  -> assign officer
  -> request clarification
  -> review
  -> approve/reject
  -> payment
  -> issue license
  -> notify applicant
```

---

## 11. Choreography vs Orchestration Decision Matrix

| Dimension | Prefer Choreography | Prefer Orchestration |
|---|---|---|
| Flow complexity | Simple | Complex |
| Branching | Low | High |
| Human task | Rare | Common |
| Timeout/SLA | Local | Global/process-level |
| Compensation | Simple | Multi-step/semantic |
| Audit requirement | Moderate | High |
| Debuggability need | Moderate | High |
| Team autonomy | High | Balanced with process ownership |
| Process visibility | Less important | Critical |
| Event fan-out | Controlled | Needs governance |
| Regulatory lifecycle | Usually no | Usually yes |
| Workflow versioning | Simple | Explicitly managed |

Rule of thumb:

```text
Use choreography for propagation.
Use orchestration for process control.
```

---

## 12. Saga State Machine

A saga should be modeled as a state machine, not a pile of callbacks.

Example:

```text
STARTED
  -> PROFILE_VALIDATION_REQUESTED
  -> PROFILE_VALIDATED
  -> QUOTA_RESERVATION_REQUESTED
  -> QUOTA_RESERVED
  -> APPLICATION_MARK_SUBMITTED_REQUESTED
  -> APPLICATION_SUBMITTED
  -> NOTIFICATION_REQUESTED
  -> COMPLETED
```

Failure states:

```text
PROFILE_VALIDATION_FAILED
QUOTA_RESERVATION_FAILED
APPLICATION_SUBMISSION_FAILED
NOTIFICATION_FAILED
COMPENSATING
COMPENSATION_FAILED
FAILED_REQUIRES_MANUAL_REVIEW
```

State machine matters because it gives you:

1. Resume point after crash.
2. Explicit valid transitions.
3. Audit trail.
4. Retry boundary.
5. Timeout boundary.
6. Manual intervention point.
7. Monitoring dimension.
8. Workflow versioning anchor.

Pseudo-schema:

```sql
CREATE TABLE application_submission_saga (
    saga_id              VARCHAR(64) PRIMARY KEY,
    business_key          VARCHAR(128) NOT NULL,
    state                 VARCHAR(64) NOT NULL,
    version               BIGINT NOT NULL,
    correlation_id        VARCHAR(128) NOT NULL,
    idempotency_key       VARCHAR(128) NOT NULL,
    applicant_id          VARCHAR(64) NOT NULL,
    application_id        VARCHAR(64),
    quota_reservation_id  VARCHAR(64),
    failure_code          VARCHAR(128),
    failure_reason        VARCHAR(1024),
    created_at            TIMESTAMP NOT NULL,
    updated_at            TIMESTAMP NOT NULL
);
```

Optimistic locking:

```sql
UPDATE application_submission_saga
SET state = ?, version = version + 1, updated_at = ?
WHERE saga_id = ? AND version = ?;
```

If update count is `0`, another worker already advanced the saga.

---

## 13. Saga Step Contract

Every saga step should have a contract like this:

```text
Step Name:
Input:
Output:
Owner Service:
Local Transaction:
Success Event/Response:
Failure Event/Response:
Retryable Failures:
Non-Retryable Failures:
Timeout:
Compensation:
Compensation Idempotency:
Audit Evidence:
Manual Recovery Path:
```

Example:

```text
Step Name: Reserve Quota
Input: applicationId, applicantId, quotaType, idempotencyKey
Owner Service: Quota Service
Local Transaction:
  - create reservation if not exists
  - mark quota count reserved
  - emit QuotaReserved
Success Event: QuotaReserved
Failure Event: QuotaReservationRejected
Retryable Failures:
  - timeout
  - transient database error
  - broker unavailable
Non-Retryable Failures:
  - quota exhausted
  - applicant not eligible
Timeout: 10 seconds for API command; reservation expires in 15 minutes
Compensation: ReleaseQuota
Compensation Idempotency: release by reservationId
Audit Evidence: reservation status history
Manual Recovery Path: officer/admin can force release stuck reservation
```

Without this contract, saga implementation usually becomes fragile.

---

## 14. Retry in Saga

Retry is necessary, but dangerous.

Retry is safe only if:

1. The operation is idempotent.
2. Timeout is bounded.
3. Retry count is bounded.
4. Backoff and jitter are used.
5. Retry is classified by error type.
6. There is observability.
7. There is a stop condition.

Bad retry:

```java
while (true) {
    quotaClient.reserveQuota(request);
}
```

Better conceptual policy:

```text
Transient failure:
  retry up to 3 attempts
  exponential backoff
  jitter
  then mark step WAITING_RETRY or FAILED_REQUIRES_REVIEW

Business rejection:
  do not retry
  start compensation or terminal failure

Unknown result:
  query by idempotency key / business key before retry
```

Important distinction:

```text
Timeout does not mean failure.
Timeout means the caller stopped waiting.
The callee may still have completed the operation.
```

Therefore every step that can time out needs:

1. Idempotency key.
2. Business key.
3. Query/status endpoint or event.
4. Deduplication.
5. Reconciliation.

---

## 15. Timeout in Saga

Timeout exists at multiple levels:

### 15.1 Call Timeout

```text
How long should caller wait for one remote request?
```

Example:

```text
Quota reserve API timeout: 2 seconds
```

### 15.2 Step Timeout

```text
How long can this saga step remain incomplete?
```

Example:

```text
Wait for QuotaReserved event: 30 seconds
```

### 15.3 Business Timeout

```text
How long can the business process remain in this state?
```

Example:

```text
Applicant must submit clarification within 14 calendar days
```

### 15.4 Compensation Timeout

```text
How long can compensation remain incomplete before manual intervention?
```

Example:

```text
Quota release must complete within 5 minutes or alert operations
```

A mature saga design separates all four.

---

## 16. Isolation Problem in Saga

ACID transaction gives isolation. Saga usually does not.

Example:

```text
Saga A reserves quota.
Saga B reads available quota.
Saga C cancels reservation.
```

Intermediate states are visible unless explicitly hidden.

Problems:

1. Dirty business read.
2. Lost update.
3. Overbooking.
4. Concurrent cancellation.
5. Duplicate approval.
6. Stale read model.
7. Conflicting compensation.

Countermeasures:

1. Optimistic locking.
2. Pessimistic lock inside one service boundary.
3. Reservation pattern.
4. Versioned state transitions.
5. Semantic lock.
6. Idempotency key.
7. Unique constraints.
8. Process state check.
9. Compensatable design.
10. Reconciliation job.

Semantic lock example:

```text
Application status = SUBMISSION_IN_PROGRESS

While in this state:
  - user cannot resubmit
  - officer cannot approve
  - system can complete or fail submission
```

This is not a database lock. It is a domain-level guard.

---

## 17. Semantic Lock Pattern

Semantic lock means marking a domain object as temporarily controlled by a process.

Example:

```text
Application DRAFT
  -> SUBMISSION_IN_PROGRESS
  -> SUBMITTED
```

While `SUBMISSION_IN_PROGRESS`, conflicting commands are rejected or queued.

Pseudo-code:

```java
public void startSubmission(ApplicationId id, Actor actor) {
    Application app = repository.getForUpdate(id);

    if (app.status() != ApplicationStatus.DRAFT) {
        throw new InvalidTransitionException(app.status(), "SUBMISSION_IN_PROGRESS");
    }

    app.transitionTo(ApplicationStatus.SUBMISSION_IN_PROGRESS, actor, clock.instant());
    repository.save(app);
}
```

This protects business correctness even when the saga spans multiple services.

---

## 18. Reservation Pattern

Reservation is useful when a resource must be tentatively held.

Example:

```text
Reserve quota before application is fully submitted.
```

Reservation lifecycle:

```text
REQUESTED
RESERVED
CONFIRMED
RELEASED
EXPIRED
```

Rules:

1. Reservation has id.
2. Reservation has owner/business key.
3. Reservation has expiry.
4. Confirm is idempotent.
5. Release is idempotent.
6. Expiry job handles abandoned reservations.
7. Audit trail records every transition.

Example:

```java
public Reservation reserve(ReserveQuotaCommand command) {
    Optional<Reservation> existing = repository.findByIdempotencyKey(command.idempotencyKey());
    if (existing.isPresent()) {
        return existing.get();
    }

    Quota quota = quotaRepository.find(command.quotaType());
    if (!quota.canReserve(1)) {
        throw new QuotaExhaustedException(command.quotaType());
    }

    Reservation reservation = quota.reserve(
            command.applicationId(),
            command.idempotencyKey(),
            clock.instant().plus(Duration.ofMinutes(15))
    );

    quotaRepository.save(quota);
    reservationRepository.save(reservation);
    return reservation;
}
```

---

## 19. Compensation Ordering

If saga performs steps:

```text
T1 -> T2 -> T3
```

Compensation often runs in reverse:

```text
C3 -> C2 -> C1
```

But not always.

Example:

```text
T1: create application
T2: reserve quota
T3: send notification
```

If notification fails, maybe you do not release quota immediately. Perhaps application remains submitted, and notification is retried.

If quota fails, then application submission may fail.

Meaning:

```text
Compensation ordering is a business decision, not a mechanical stack unwind.
```

Ask:

1. Which completed steps must be compensated?
2. Which completed steps should remain?
3. Which completed steps require correction instead of undo?
4. Which compensation must happen before another?
5. Which compensation can happen in parallel?
6. Which compensation needs human approval?

---

## 20. Saga Failure Taxonomy

### 20.1 Transient Technical Failure

Examples:

```text
network timeout
DB connection exhausted
broker temporarily unavailable
HTTP 503
```

Strategy:

```text
retry with bounded backoff and jitter
```

### 20.2 Permanent Technical Failure

Examples:

```text
schema mismatch
invalid endpoint config
unknown event version
serialization failure
```

Strategy:

```text
stop, alert, fix deployment/config/data, replay or resume
```

### 20.3 Business Rejection

Examples:

```text
quota exhausted
applicant not eligible
duplicate application not allowed
```

Strategy:

```text
transition to business failure state, compensate if needed
```

### 20.4 Unknown Outcome

Examples:

```text
request timed out after callee may have committed
connection dropped after response was sent
consumer processed but ack failed
```

Strategy:

```text
query by idempotency key / observe event / reconcile before retrying side effect
```

### 20.5 Compensation Failure

Examples:

```text
release quota failed
refund failed
external correction call failed
```

Strategy:

```text
retry compensation, escalate, mark manual review, preserve evidence
```

### 20.6 Data Conflict

Examples:

```text
application cancelled while submission saga running
quota reservation expired before confirmation
approval rule version changed
```

Strategy:

```text
state guard, version check, domain-specific resolution
```

---

## 21. Failure Matrix Example

| Step | Failure | Retry? | Compensate? | Terminal State | Manual Review? |
|---|---|---:|---:|---|---:|
| Validate profile | Timeout | Yes | No | WAITING_PROFILE_VALIDATION | If repeated |
| Validate profile | Applicant invalid | No | No | REJECTED_PROFILE_INVALID | No |
| Reserve quota | Timeout | Yes, after status check | Maybe | WAITING_QUOTA_RESERVATION | If unknown |
| Reserve quota | Quota exhausted | No | Application semantic unlock | SUBMISSION_FAILED_QUOTA | No |
| Mark submitted | DB transient error | Yes | Release quota if terminal | WAITING_APPLICATION_SUBMIT | If repeated |
| Send notification | Email provider down | Yes | Usually no | SUBMITTED_NOTIFICATION_PENDING | No initially |
| Release quota | Timeout | Yes | Compensation of compensation? usually manual | COMPENSATION_PENDING | Yes if repeated |

A top-tier design does not say:

```text
If error then rollback.
```

It says:

```text
For this specific step, this specific failure means this specific recovery path.
```

---

## 22. Idempotency in Saga

Every command emitted by a saga should have an idempotency key.

Example key design:

```text
{processName}:{sagaId}:{stepName}:{attemptGroup}
```

Example:

```text
application-submission:SG-123:reserve-quota:v1
application-submission:SG-123:release-quota:v1
```

Participant stores processed command:

```sql
CREATE TABLE processed_command (
    idempotency_key VARCHAR(128) PRIMARY KEY,
    command_type    VARCHAR(128) NOT NULL,
    business_key    VARCHAR(128) NOT NULL,
    result_ref      VARCHAR(128),
    status          VARCHAR(32) NOT NULL,
    processed_at    TIMESTAMP NOT NULL
);
```

Participant behavior:

```text
if idempotency key exists and completed:
    return previous result
else if idempotency key exists and in progress:
    return accepted/in progress
else:
    process command atomically with idempotency record
```

Idempotency is not optional in saga. It is the replacement for atomic global rollback.

---

## 23. Saga and Outbox/Inbox

A durable saga usually needs:

1. Saga state table.
2. Outbox table.
3. Inbox/processed-message table.
4. Dead-letter handling.
5. Reconciliation job.

### 23.1 Orchestrator Local Transaction

```text
begin transaction
  update saga state
  insert command into outbox
commit
```

### 23.2 Participant Local Transaction

```text
begin transaction
  deduplicate incoming command via inbox/idempotency key
  update local state
  insert reply event into outbox
commit
```

This prevents:

```text
state changed but command not sent
command sent but state not changed
reply emitted twice with different meaning
```

Part 9 will go deeper into outbox/inbox/CDC.

---

## 24. Java Implementation Model

### 24.1 Plain Java Saga Core

Keep saga logic independent from framework where possible.

```java
public enum SubmissionSagaState {
    STARTED,
    PROFILE_VALIDATION_REQUESTED,
    PROFILE_VALIDATED,
    QUOTA_RESERVATION_REQUESTED,
    QUOTA_RESERVED,
    APPLICATION_SUBMISSION_REQUESTED,
    APPLICATION_SUBMITTED,
    NOTIFICATION_REQUESTED,
    COMPLETED,
    COMPENSATING,
    FAILED,
    FAILED_REQUIRES_MANUAL_REVIEW
}
```

```java
public final class ApplicationSubmissionSaga {
    private final SagaId id;
    private final ApplicationId applicationId;
    private final ApplicantId applicantId;
    private SubmissionSagaState state;
    private long version;

    public List<SagaCommand> start() {
        requireState(SubmissionSagaState.STARTED);
        this.state = SubmissionSagaState.PROFILE_VALIDATION_REQUESTED;
        return List.of(new ValidateApplicantProfileCommand(id, applicantId));
    }

    public List<SagaCommand> on(ProfileValidated event) {
        requireState(SubmissionSagaState.PROFILE_VALIDATION_REQUESTED);
        this.state = SubmissionSagaState.PROFILE_VALIDATED;
        this.state = SubmissionSagaState.QUOTA_RESERVATION_REQUESTED;
        return List.of(new ReserveQuotaCommand(id, applicationId));
    }

    public List<SagaCommand> on(QuotaReserved event) {
        requireState(SubmissionSagaState.QUOTA_RESERVATION_REQUESTED);
        this.state = SubmissionSagaState.QUOTA_RESERVED;
        this.state = SubmissionSagaState.APPLICATION_SUBMISSION_REQUESTED;
        return List.of(new MarkApplicationSubmittedCommand(id, applicationId));
    }

    public List<SagaCommand> on(QuotaReservationRejected event) {
        requireState(SubmissionSagaState.QUOTA_RESERVATION_REQUESTED);
        this.state = SubmissionSagaState.FAILED;
        return List.of(new MarkApplicationSubmissionFailedCommand(id, applicationId, event.reason()));
    }

    private void requireState(SubmissionSagaState expected) {
        if (this.state != expected) {
            throw new IllegalStateException("Expected " + expected + " but was " + this.state);
        }
    }
}
```

The application service layer persists state and outbox atomically:

```java
@Transactional
public void handle(ProfileValidated event) {
    ApplicationSubmissionSaga saga = sagaRepository.getById(event.sagaId());
    List<SagaCommand> commands = saga.on(event);

    sagaRepository.save(saga);
    commands.forEach(command -> outboxRepository.save(OutboxMessage.from(command)));
}
```

### 24.2 Framework Positioning

Possible implementation styles:

```text
Spring Boot + transactional repository + outbox publisher
Quarkus + Panache/JPA/JDBC + messaging extension
Jakarta EE + JTA local transaction + messaging
MicroProfile + Fault Tolerance + Reactive Messaging
Workflow engine such as Camunda/Temporal-style orchestration
Plain Java core + adapter-specific infrastructure
```

The important part is not the framework. The important part is:

```text
saga state transition + outbound command/event must be atomic locally.
```

---

## 25. Java 8–25 Considerations

### 25.1 Java 8

Java 8 is still common in legacy enterprise systems.

Relevant constraints:

1. No records.
2. No sealed classes.
3. No modern switch expressions.
4. CompletableFuture exists but virtual threads do not.
5. More boilerplate for immutable command/event types.

Design implication:

```text
Use explicit final classes, builders/factories, defensive copying, and clear package boundaries.
```

### 25.2 Java 11

Java 11 adds a standard HTTP client.

Design implication:

```text
Can reduce dependency on third-party HTTP client for simple orchestrator calls, but still need robust timeout/retry/idempotency discipline.
```

### 25.3 Java 17

Java 17 gives strong baseline for modern enterprise:

1. Records.
2. Sealed classes.
3. Pattern matching improvements.
4. Stronger JVM/container maturity.

Saga commands/events can become more expressive:

```java
public sealed interface SagaSignal permits ProfileValidated, QuotaReserved, QuotaReservationRejected {
    SagaId sagaId();
}

public record ProfileValidated(SagaId sagaId, ApplicantId applicantId) implements SagaSignal {}
public record QuotaReserved(SagaId sagaId, ReservationId reservationId) implements SagaSignal {}
public record QuotaReservationRejected(SagaId sagaId, String reason) implements SagaSignal {}
```

### 25.4 Java 21

Java 21 virtual threads matter for orchestrators that perform blocking IO.

But beware:

```text
Virtual threads do not solve distributed correctness.
```

They can help with:

1. Simpler blocking style orchestration.
2. Higher concurrency for IO-bound command dispatch.
3. Less pressure to use complex reactive chains.

But still need:

1. Bounded concurrency.
2. Timeouts.
3. Backpressure.
4. Idempotency.
5. Durable state.

### 25.5 Java 25

Java 25 as modern baseline continues JVM/runtime evolution, but the architectural truth remains unchanged:

```text
New Java features improve expression and runtime efficiency.
They do not remove partial failure, unknown outcomes, or compensation complexity.
```

Use newer Java features to make saga models clearer, not to hide business semantics.

---

## 26. Synchronous Saga vs Asynchronous Saga

### 26.1 Synchronous Saga

Example:

```text
Orchestrator calls Profile API
then Quota API
then Application API
then Notification API
```

Pros:

1. Simple mental model.
2. Easier local debugging.
3. Immediate response possible.

Cons:

1. Temporal coupling.
2. Caller waits longer.
3. Cascade failure risk.
4. Timeout ambiguity.
5. Less resilient for long process.

Use only for short, bounded, low-risk flows.

### 26.2 Asynchronous Saga

Example:

```text
Orchestrator writes command to outbox
participant consumes command
participant emits reply event
orchestrator advances state
```

Pros:

1. Durable.
2. Better for long-running process.
3. Better failure isolation.
4. Natural retry/replay.
5. Better for workflow state.

Cons:

1. More moving parts.
2. Eventual consistency.
3. More observability needed.
4. More complex testing.

Use for important business workflows.

---

## 27. User Experience for Saga

A saga often cannot honestly return:

```text
200 OK completed
```

It may need to return:

```text
202 Accepted
operationId: SG-123
status: SUBMISSION_IN_PROGRESS
```

Then UI polls or subscribes:

```text
GET /operations/SG-123
```

Response:

```json
{
  "operationId": "SG-123",
  "state": "QUOTA_RESERVATION_REQUESTED",
  "businessStatus": "Submission is being processed",
  "retryable": false,
  "lastUpdatedAt": "2026-06-19T10:15:30Z"
}
```

UX must represent truth:

1. Submitted.
2. Processing.
3. Pending external system.
4. Pending officer review.
5. Failed with reason.
6. Needs user action.
7. Completed.

Bad UX hides eventual consistency and creates support tickets.

---

## 28. Auditability and Regulatory Defensibility

For regulatory systems, saga must answer:

1. Who initiated the process?
2. When was it initiated?
3. What rules applied?
4. Which service performed each step?
5. Which data version was used?
6. Which external calls were made?
7. Which step failed?
8. Was failure technical or business?
9. Was compensation executed?
10. Who approved manual override?
11. Was the applicant notified?
12. Is there evidence of final state?

Audit event example:

```json
{
  "auditType": "SAGA_STEP_COMPLETED",
  "sagaId": "SG-123",
  "processName": "ApplicationSubmission",
  "stepName": "ReserveQuota",
  "stateBefore": "QUOTA_RESERVATION_REQUESTED",
  "stateAfter": "QUOTA_RESERVED",
  "actorType": "SYSTEM",
  "correlationId": "COR-789",
  "causationId": "EVT-456",
  "occurredAt": "2026-06-19T10:15:30Z",
  "evidenceRef": "quotaReservation:QR-001"
}
```

A serious system separates:

```text
Operational logs       -> debugging
Business audit trail   -> accountability
Technical trace        -> distributed causality
Saga state             -> process recovery
```

Do not mix them into one vague “log”.

---

## 29. Reconciliation

Even with saga, some cases will become inconsistent.

Examples:

1. Event lost before outbox relay is fixed.
2. External system completed but callback failed.
3. Compensation stuck.
4. Manual DB correction happened.
5. Deployment bug produced invalid state.
6. Consumer bug skipped event.

Reconciliation is a planned repair process.

Reconciliation job asks:

```text
Which saga instances are stuck?
Which external state disagrees with internal state?
Which reservation expired but was not released?
Which completed application lacks notification?
Which compensation failed too many times?
```

Example query:

```sql
SELECT saga_id, state, updated_at
FROM application_submission_saga
WHERE state IN (
    'PROFILE_VALIDATION_REQUESTED',
    'QUOTA_RESERVATION_REQUESTED',
    'COMPENSATING'
)
AND updated_at < CURRENT_TIMESTAMP - INTERVAL '15' MINUTE;
```

Reconciliation should be:

1. Idempotent.
2. Audited.
3. Rate-limited.
4. Observable.
5. Safe to resume.
6. Able to escalate to human.

---

## 30. Saga Versioning

Long-running sagas may live across deployments.

Problem:

```text
Saga started with workflow v1.
Deployment introduces workflow v2.
Saga v1 still waiting for applicant clarification.
```

Options:

### 30.1 Version Pinning

Saga instance stores workflow version.

```text
sagaId=SG-123, workflowVersion=1
```

It continues with v1 logic.

### 30.2 Migration

Move saga from v1 to v2 using explicit migration logic.

```text
v1 state WAITING_QUOTA
 -> v2 state WAITING_RESOURCE_RESERVATION
```

Must be audited.

### 30.3 New Version Only for New Instances

Existing saga continues old version. New saga uses new version.

Usually safest.

### 30.4 Terminate and Restart

Only acceptable if business allows it.

Saga versioning checklist:

1. Is workflow version stored?
2. Are commands/events versioned?
3. Are old handlers retained?
4. Are old states still understood?
5. Can stuck old saga be resumed?
6. Is migration audited?
7. Is manual correction possible?

---

## 31. Anti-Patterns

### 31.1 Fake Saga With One Big Synchronous Chain

```text
API Gateway -> A -> B -> C -> D -> E
```

All services wait on each other. Any failure collapses the chain.

This is not robust saga. It is distributed transaction without transaction guarantees.

### 31.2 Compensation as DELETE

Deleting records to “undo” destroys auditability.

Prefer status transition and correction records.

### 31.3 No Idempotency

If every retry can create a new side effect, saga is unsafe.

### 31.4 No Saga State

If process state exists only in logs/events, recovery is fragile.

### 31.5 Choreography Without Ownership

If everyone emits and consumes events but no one owns the process, failure analysis becomes painful.

### 31.6 Orchestrator as God Service

If orchestrator owns all business rules and participants become dumb CRUD services, autonomy is lost.

### 31.7 Retrying Business Rejection

Retrying `quota exhausted` or `applicant not eligible` wastes capacity and hides real outcome.

### 31.8 No Manual Recovery

Some failures need human resolution. Pretending all failures are automated is unrealistic.

### 31.9 External Side Effect Too Early

Sending irreversible notification/payment/legal action before critical validation creates hard compensation.

### 31.10 No Reconciliation

Saga without reconciliation assumes distributed systems never produce unknown outcomes.

That assumption is false.

---

## 32. Design Example: Application Submission Saga

### 32.1 Business Goal

Applicant submits a license application.

The system must:

1. Validate applicant profile.
2. Reserve quota.
3. Mark application submitted.
4. Record audit trail.
5. Notify applicant.

### 32.2 Services

```text
Application Service
Profile Service
Quota Service
Audit Service
Notification Service
```

### 32.3 Saga Style

Use orchestration because:

1. Submission process has business visibility.
2. Quota needs compensation.
3. Audit is important.
4. Notification failure should not necessarily fail submission.
5. Future workflow may include screening, payment, and officer assignment.

### 32.4 States

```text
STARTED
PROFILE_VALIDATION_REQUESTED
PROFILE_VALIDATED
QUOTA_RESERVATION_REQUESTED
QUOTA_RESERVED
APPLICATION_SUBMISSION_REQUESTED
APPLICATION_SUBMITTED
NOTIFICATION_REQUESTED
COMPLETED
FAILED_PROFILE_INVALID
FAILED_QUOTA_UNAVAILABLE
COMPENSATING_QUOTA
FAILED_REQUIRES_MANUAL_REVIEW
```

### 32.5 Step Behavior

| Step | Success | Business Failure | Technical Failure |
|---|---|---|---|
| Validate profile | continue | fail submission | retry/status check |
| Reserve quota | continue | fail submission | retry/status check |
| Mark submitted | continue | compensate quota | retry |
| Notify applicant | complete with notification pending/retry | not usually fatal | retry async |

### 32.6 Compensation

If application cannot be submitted after quota reserved:

```text
Release quota reservation
Mark application SUBMISSION_FAILED
Record audit trail
Notify applicant if appropriate
```

If notification fails after application submitted:

```text
Do not undo application.
Retry notification.
Expose notification pending state.
Escalate if repeated failure.
```

This distinction is crucial.

---

## 33. Production Readiness Checklist

Before deploying saga-based workflow, verify:

### 33.1 Domain

- [ ] Each step has clear business meaning.
- [ ] Each step has owner service.
- [ ] Each failure type is classified.
- [ ] Each compensation has domain semantics.
- [ ] Irreversible steps are identified.
- [ ] Manual recovery path exists.

### 33.2 State

- [ ] Saga state is durable.
- [ ] State transitions are validated.
- [ ] Optimistic locking protects concurrent updates.
- [ ] Workflow version is stored.
- [ ] Terminal states are explicit.
- [ ] Stuck states are detectable.

### 33.3 Messaging

- [ ] Outbox is used for reliable publishing.
- [ ] Inbox/idempotency is used for consuming.
- [ ] Command/event envelope includes correlation and causation ids.
- [ ] Duplicate messages are safe.
- [ ] Out-of-order messages are handled.
- [ ] DLQ/parking lot exists.

### 33.4 Timeout and Retry

- [ ] Call timeout is defined.
- [ ] Step timeout is defined.
- [ ] Business timeout is defined.
- [ ] Retry policy is bounded.
- [ ] Retry uses backoff and jitter.
- [ ] Unknown outcome has status-check path.

### 33.5 Compensation

- [ ] Compensation is idempotent.
- [ ] Compensation failure is handled.
- [ ] Compensation is audited.
- [ ] Compensation can be retried/resumed.
- [ ] Compensation can escalate to manual review.

### 33.6 Observability

- [ ] Saga id is logged.
- [ ] Correlation id is propagated.
- [ ] Step latency is measured.
- [ ] Step failure count is measured.
- [ ] Compensation count is measured.
- [ ] Stuck saga count is measured.
- [ ] Business outcome metrics exist.

### 33.7 Operations

- [ ] Runbook exists.
- [ ] Replay/resume procedure exists.
- [ ] Manual correction procedure exists.
- [ ] Alert thresholds exist.
- [ ] Dashboard exists.
- [ ] Reconciliation job exists.

---

## 34. Senior/Principal Engineer Review Questions

Use these questions during architecture review:

1. What is the local transaction boundary of each service?
2. Which invariant is local, and which is eventual?
3. Why is distributed transaction not used here?
4. What is the saga owner?
5. Is choreography or orchestration chosen deliberately?
6. Where is saga state stored?
7. Can the saga resume after crash?
8. What happens if a command is delivered twice?
9. What happens if a reply event arrives late?
10. What happens if timeout occurs but callee committed?
11. Which failures are retryable?
12. Which failures are business terminal?
13. Which steps require compensation?
14. Which steps are irreversible?
15. Can compensation fail?
16. How is compensation retried?
17. What requires manual intervention?
18. How is audit trail generated?
19. How is workflow version handled?
20. How are stuck saga instances found?
21. How is user experience represented during in-progress state?
22. What is the reconciliation strategy?
23. What is the rollback/roll-forward deployment strategy?
24. What is the blast radius if orchestrator is down?
25. What is the blast radius if broker is down?

---

## 35. Mental Model Ringkas

Saga is not:

```text
distributed rollback
```

Saga is:

```text
a durable, observable, compensatable, eventually consistent business process
composed of local transactions owned by autonomous services.
```

Local transaction gives:

```text
atomic correctness inside one service boundary
```

Saga gives:

```text
coordinated business progress across service boundaries
```

Compensation gives:

```text
business correction after already-visible effects
```

Idempotency gives:

```text
safety under retry and duplicate delivery
```

Outbox/inbox gives:

```text
reliable state-message coupling
```

Reconciliation gives:

```text
repair path for unknown and inconsistent outcomes
```

Audit gives:

```text
defensibility and accountability
```

---

## 36. Practical Exercises

### Exercise 1 — Identify Local Transactions

Given this process:

```text
Submit application
Validate applicant
Reserve quota
Assign officer
Notify applicant
```

For each service, define:

1. Owned data.
2. Local transaction.
3. Outbox event.
4. Idempotency key.
5. Failure mode.

### Exercise 2 — Build Failure Matrix

Create a matrix:

```text
Step | Failure Type | Retry | Compensation | Manual Review | Audit Evidence
```

### Exercise 3 — Choreography vs Orchestration

Decide which style fits:

1. User signup welcome flow.
2. License application approval.
3. Payment + inventory + shipment.
4. Case escalation workflow.
5. Audit data export.

Explain why.

### Exercise 4 — Compensation Design

For each operation, define compensation:

```text
Reserve quota
Send email
Issue license
Assign officer
Submit external file
```

Classify as:

```text
reversible
semantically compensatable
irreversible but correctable
manual only
```

### Exercise 5 — Saga State Machine

Draw a state machine for:

```text
Application Renewal
```

Include:

1. Happy path.
2. Payment failure.
3. Applicant clarification.
4. Officer rejection.
5. External system timeout.
6. Compensation failure.

---

## 37. Key Takeaways

1. Microservices force transaction boundaries to become explicit.
2. Local transaction remains the foundation of correctness.
3. Distributed transaction is often avoided because it couples availability and autonomy.
4. Saga coordinates multiple local transactions.
5. Compensation is business correction, not technical rollback.
6. Choreography is good for simple event propagation.
7. Orchestration is better for complex, auditable, long-running workflows.
8. Saga needs durable state.
9. Idempotency is mandatory.
10. Timeout creates unknown outcome, not guaranteed failure.
11. Compensation must itself be retryable, idempotent, and observable.
12. Reconciliation is not optional in serious systems.
13. Auditability is first-class in regulated systems.
14. Java version affects expression and runtime model, but not the distributed-systems truth.
15. A top-tier engineer designs saga by failure matrix, not by framework tutorial.

---

## 38. References

- Microservices.io — Saga Pattern: https://microservices.io/patterns/data/saga.html
- Microservices.io — Transactional Outbox Pattern: https://microservices.io/patterns/data/transactional-outbox.html
- Microservices.io — Idempotent Consumer Pattern: https://microservices.io/patterns/communication-style/idempotent-consumer.html
- Microsoft Azure Architecture Center — Saga Distributed Transactions Pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/saga
- Microsoft Azure Architecture Center — Compensating Transaction Pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction
- Temporal Blog — Saga Compensating Transactions: https://temporal.io/blog/compensating-actions-part-of-a-complete-breakfast-with-sagas
- OpenJDK JDK 25 Project: https://openjdk.org/projects/jdk/25/

---

## 39. Status Seri

Seri **belum selesai**.

Progress saat ini:

```text
Completed: Part 0 sampai Part 8
Current:   Part 8 — Transaction Pattern: Local Transaction, Saga, and Compensation
Next:      Part 9 — Transactional Outbox, Inbox, CDC, and Reliable Publishing
Total:     35 part
```

File berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-09-outbox-inbox-cdc-reliable-publishing.md
```

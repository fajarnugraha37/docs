# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-029.md

# Part 029 — Advanced Orchestration Patterns: Saga, Compensation, Process Choreography, and Long-Running Transactions

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Bagian: `029`  
> Topik: `Advanced Orchestration Patterns: Saga, Compensation, Process Choreography, and Long-Running Transactions`  
> Target: Java engineer / tech lead / architect yang ingin mampu mendesain orchestration system yang aman untuk distributed transaction, external side effect, regulatory process, dan long-running business consistency.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Membedakan **database transaction**, **distributed transaction**, **saga**, **compensation**, **reservation-confirmation**, **forward recovery**, dan **manual repair**.
2. Mendesain Camunda 8 process untuk long-running business transaction tanpa berharap ada atomic commit lintas service.
3. Menentukan kapan memakai:
   - BPMN compensation event,
   - BPMN error,
   - incident,
   - message event,
   - timer event,
   - event subprocess,
   - call activity,
   - dan Java worker idempotency layer.
4. Menghindari anti-pattern seperti “rollback mindset” yang salah, non-idempotent compensation, process model sebagai service call graph, dan retry storm.
5. Mendesain saga yang audit-friendly, observable, dan cocok untuk domain regulasi, case management, approval, payment-like flow, document issuance, enforcement, appeal, atau external verification.
6. Membuat Java worker yang aman ketika proses melibatkan side effect eksternal: payment, notification, document generation, reservation, status update, external API submission, dan cross-system synchronization.

---

## 1. Masalah Besar: Business Transaction Tidak Sama dengan Database Transaction

Di aplikasi monolitik tradisional, kita sering nyaman dengan pola:

```java
@Transactional
public void submitApplication() {
    saveApplication();
    saveDocuments();
    saveAuditTrail();
    updateStatus();
}
```

Jika satu langkah gagal, database rollback. State kembali seperti semula.

Namun orchestration modern jarang sesederhana itu. Sebuah workflow Camunda 8 dapat melibatkan:

- database internal service A,
- service B milik tim lain,
- payment provider,
- government API,
- email/SMS gateway,
- document management system,
- user task approval,
- human review selama beberapa hari,
- external callback,
- deadline statutory,
- dan audit requirement.

Tidak ada satu database transaction yang bisa membungkus semuanya. Bahkan jika secara teknis ada two-phase commit, sering tidak realistis karena:

1. external system tidak mendukung XA transaction,
2. human task bisa berlangsung berjam-jam/hari,
3. API call yang sudah sukses tidak bisa “di-rollback” secara teknis,
4. message sudah terkirim ke pihak eksternal,
5. business rule butuh jejak audit, bukan penghapusan jejak,
6. distributed lock panjang adalah risiko availability dan operability.

Jadi mental model yang benar bukan:

```text
Do A, do B, do C; kalau gagal rollback semua seperti tidak pernah terjadi.
```

Melainkan:

```text
Do A, remember outcome, do B, remember outcome, do C.
If later step fails, execute explicit business recovery action based on facts that already happened.
```

Dalam Camunda 8, process instance menjadi **durable coordinator of progress**, bukan atomic transaction manager.

---

## 2. Dari ACID ke Saga

### 2.1 ACID transaction

ACID cocok untuk boundary sempit:

- satu database,
- satu aggregate consistency boundary,
- operasi cepat,
- state dapat dikunci sementara,
- rollback teknis masih valid.

Contoh:

```text
Insert application row + insert audit row + update local status.
```

### 2.2 Saga

Saga adalah pola untuk mengelola **long-running distributed business transaction** sebagai urutan langkah-langkah lokal, di mana setiap langkah memiliki:

1. aksi utama,
2. outcome yang disimpan,
3. kemungkinan retry,
4. kemungkinan compensation/recovery.

Bentuk umum:

```text
T1 -> T2 -> T3 -> T4
```

Jika `T3` gagal setelah `T1` dan `T2` sukses, recovery-nya bukan database rollback, tetapi explicit action:

```text
C2 -> C1
```

Misalnya:

```text
Reserve inventory       -> Cancel inventory reservation
Authorize payment       -> Void authorization
Create shipment order   -> Cancel shipment order
Notify customer         -> Send correction notification
```

### 2.3 Penting: compensation bukan selalu inverse operation

Banyak engineer menganggap compensation = rollback. Ini framing yang lemah.

Compensation lebih tepat disebut:

```text
business action that makes the system acceptable again after a previous successful action is no longer desired.
```

Contoh:

| Aksi Awal | Compensation yang Realistis |
|---|---|
| Charge payment | Refund payment, bukan menghapus charge |
| Send email approval | Send correction/revocation notice |
| Issue license | Revoke/suspend license |
| Reserve appointment slot | Release slot |
| Create case in external system | Close/cancel external case |
| Publish decision | Publish amended decision |

Compensation sering menghasilkan **state baru**, bukan menghapus state lama.

---

## 3. Kenapa Camunda 8 Cocok untuk Saga

Camunda 8/Zeebe cocok untuk saga karena ia memberi:

1. **Durable process state**  
   Progress proses disimpan oleh engine, bukan memori aplikasi worker.

2. **Wait state**  
   Proses bisa menunggu message, timer, user task, atau job tanpa thread Java tetap hidup.

3. **Externalized worker model**  
   Business execution dilakukan oleh worker, sehingga service tetap stateless dan bisa diskalakan.

4. **Explicit visual recovery path**  
   Error, timeout, escalation, compensation, dan manual repair bisa dimodelkan eksplisit.

5. **Operational visibility**  
   Operate memberi permukaan untuk melihat instance, incident, variable, dan flow node state.

6. **Asynchronous integration**  
   Message correlation memungkinkan external event memperbarui state process instance.

Camunda documentation menjelaskan compensation event sebagai mekanisme untuk membatalkan/menangani ulang aktivitas yang sudah berhasil ketika hasilnya tidak lagi diinginkan. Dalam compensation handler, saat compensation throw event dicapai, handler untuk aktivitas yang sudah complete dapat dipanggil; jika aktivitas complete beberapa kali, handler dapat dipanggil sesuai jumlah completion tersebut.

---

## 4. Fundamental Distinction: Orchestration vs Choreography

### 4.1 Orchestration

Dalam orchestration, ada coordinator eksplisit.

```text
Camunda Process
  -> call ReserveInventory worker
  -> call AuthorizePayment worker
  -> wait for WarehousePacked message
  -> call CreateShipment worker
  -> complete order
```

Coordinator tahu urutan, deadline, dan recovery path.

Kelebihan:

- proses mudah dibaca,
- end-to-end visibility jelas,
- cocok untuk human workflow,
- cocok untuk regulatory/audit,
- cocok untuk SLA/deadline,
- cocok untuk complex exception handling.

Kekurangan:

- coordinator bisa menjadi pusat coupling jika model terlalu detail,
- semua perubahan proses cenderung melewati workflow governance,
- butuh disiplin contract/job type/message.

### 4.2 Choreography

Dalam choreography, setiap service bereaksi terhadap event.

```text
OrderCreated event
  -> Inventory reserves -> InventoryReserved event
  -> Payment authorizes -> PaymentAuthorized event
  -> Shipping prepares -> ShipmentCreated event
```

Tidak ada satu model pusat yang mengontrol semua.

Kelebihan:

- service autonomy tinggi,
- natural untuk event-driven architecture,
- tidak ada central orchestrator untuk flow sederhana,
- scalable untuk domain event broadcast.

Kekurangan:

- end-to-end flow sulit dilihat,
- recovery tersebar,
- audit dan SLA bisa sulit,
- debugging cross-service lebih berat,
- “who owns the process?” sering tidak jelas.

### 4.3 Hybrid yang sering paling realistis

Untuk sistem enterprise besar, pilihan terbaik sering hybrid:

```text
Camunda orchestrates the business lifecycle.
Domain services still publish domain events internally.
```

Contoh:

```text
Application process orchestrated by Camunda
  -> Eligibility service decides eligibility and publishes EligibilityChecked
  -> Document service manages document lifecycle internally
  -> Payment service manages payment state internally
  -> Camunda waits for high-level messages only
```

Camunda tidak perlu mengatur setiap internal micro-step. Ia cukup mengatur **business milestones**.

---

## 5. Saga Pattern Taxonomy

Ada beberapa bentuk saga yang perlu dibedakan.

---

### 5.1 Linear Saga

Bentuk paling sederhana:

```text
Step A -> Step B -> Step C -> Done
```

Jika C gagal:

```text
Compensate B -> Compensate A -> Failed
```

Cocok untuk:

- order fulfillment sederhana,
- onboarding bertahap,
- provisioning resource,
- sequential approval dengan external reservation.

Kelemahan:

- jika terlalu banyak langkah, model menjadi panjang,
- compensation chain bisa kompleks,
- perlu state outcome per step.

---

### 5.2 Branching Saga

Business path berbeda berdasarkan outcome.

```text
Check eligibility
  -> eligible: reserve slot -> approve
  -> not eligible: reject
  -> incomplete: request more info
```

Kompensasi tergantung path yang benar-benar terjadi.

Prinsip:

```text
Never compensate what did not complete.
```

Karena itu worker perlu menghasilkan variables seperti:

```json
{
  "slotReserved": true,
  "slotReservationId": "RSV-123",
  "paymentAuthorized": false
}
```

Namun lebih baik daripada boolean tersebar, gunakan structured operation ledger.

---

### 5.3 Parallel Saga

Beberapa aksi berjalan paralel:

```text
        -> Verify identity
Submit  -> Check blacklist
        -> Validate documents
```

Jika salah satu gagal, apakah yang lain harus dihentikan? Tergantung domain.

Pilihan desain:

1. **fail-fast cancellation**  
   Begitu satu cabang fatal gagal, cancel cabang lain.

2. **collect-all outcome**  
   Tunggu semua cabang selesai untuk memberikan keputusan lengkap.

3. **partial continuation**  
   Cabang tertentu tetap berjalan meskipun cabang lain gagal.

4. **human review fallback**  
   Jika hasil tidak konsisten, route ke reviewer manusia.

Untuk regulatory system, collect-all sering lebih defensible karena reviewer dapat melihat semua failure reason.

---

### 5.4 Reservation-Confirmation-Cancellation Saga

Ini pattern paling aman untuk external side effect yang mahal.

Daripada langsung melakukan irreversible operation:

```text
Charge payment
```

lebih baik:

```text
Authorize payment -> Capture payment later
```

Atau:

```text
Reserve license number -> Confirm issuance later
```

Bentuk:

```text
Reserve resource
Perform checks
If success -> Confirm reservation
If failure -> Cancel reservation
```

Contoh:

```text
Reserve appointment slot
Wait for payment
If paid -> Confirm appointment
If timeout -> Release slot
```

Ini lebih baik karena cancellation terhadap reservation sering lebih murah daripada compensation terhadap final action.

---

### 5.5 Forward Recovery Saga

Kadang compensation tidak diinginkan. Lebih baik memperbaiki dan lanjut.

Contoh:

```text
Generate certificate failed due to temporary template service outage.
```

Kita tidak perlu rollback approval. Kita perlu retry/recover certificate generation.

Forward recovery berarti:

```text
Previous business decision remains valid.
Repair the failed later step and continue.
```

Cocok untuk:

- document generation,
- notification delivery,
- sync to downstream system,
- report update,
- audit export,
- non-critical external propagation.

---

### 5.6 Manual Repair Saga

Beberapa failure tidak boleh otomatis diselesaikan.

Contoh:

- payment captured but order creation failed,
- external government API returns ambiguous status,
- duplicate license number detected,
- user identity mismatch,
- deadline already breached,
- compensation itself failed.

Process harus masuk:

```text
Manual Investigation / Repair Required
```

Ini bukan kegagalan desain. Dalam sistem enterprise, manual repair adalah bagian dari reliability design.

---

## 6. BPMN Building Blocks untuk Saga di Camunda 8

---

### 6.1 Service Task

Service task membuat job yang diambil worker.

Gunakan untuk:

- reserve resource,
- call external API,
- persist domain command,
- generate document,
- send notification,
- invoke decision service.

Rule:

```text
Setiap service task yang punya side effect harus punya idempotency strategy.
```

---

### 6.2 BPMN Error

BPMN error cocok untuk business failure yang sudah diprediksi.

Contoh:

```text
INSUFFICIENT_BALANCE
NOT_ELIGIBLE
DOCUMENT_INVALID
RESERVATION_REJECTED
```

BPMN error bukan untuk:

- network timeout,
- database unavailable,
- worker crash,
- unknown exception,
- serialization bug.

Untuk error teknis, gunakan job failure/retry/incident.

---

### 6.3 Incident

Incident menandakan process tidak bisa lanjut tanpa repair.

Cocok untuk:

- variable invalid,
- expression error,
- retries exhausted,
- worker repeatedly failed,
- operational issue yang perlu intervensi.

Jangan jadikan incident sebagai business rejection normal.

---

### 6.4 Compensation Event

Compensation digunakan untuk undo/reversal/recovery terhadap aktivitas yang sudah complete.

Pola BPMN:

```text
[Activity A] --associated compensation--> [Compensate A]
...
[Throw Compensation]
```

Ketika compensation throw dicapai, compensation handler untuk aktivitas yang sudah completed dapat dijalankan.

Gunakan untuk:

- cancel reservation,
- void authorization,
- close external record,
- revoke issued entitlement,
- send revocation notice,
- reverse provisioning.

Jangan gunakan compensation jika:

- step belum pernah sukses,
- recovery hanya retry teknis,
- business path lebih baik memakai error boundary,
- kamu tidak punya idempotent compensation action.

---

### 6.5 Message Event

Message event cocok untuk external asynchronous outcome.

Contoh:

```text
PaymentAuthorized
ShipmentCreated
ExternalReviewCompleted
DocumentSigned
BankCallbackReceived
```

Camunda message correlation membutuhkan message name dan correlation key. Pesan yang dipublikasikan harus cocok dengan subscription process instance yang sedang menunggu, berdasarkan nama message dan correlation key.

Gunakan message event untuk:

- callback eksternal,
- event dari service lain,
- human action dari custom UI,
- asynchronous batch result,
- cancellation request.

---

### 6.6 Timer Event

Timer event memberi batas waktu.

Contoh:

```text
Wait for payment for PT2H
Wait for agency response until statutoryDueDate
Escalate if reviewer does not act in 3 days
```

Timer sangat penting untuk saga karena long-running process tidak boleh menunggu selamanya.

---

### 6.7 Event Subprocess

Event subprocess cocok untuk cross-cutting interruption:

- cancellation request,
- deadline breach,
- fraud detected,
- case withdrawn,
- global timeout,
- external revocation.

Pola:

```text
Main process running
Event subprocess catches CancelRequested message
  -> execute compensation/recovery
  -> mark process cancelled
```

---

### 6.8 Call Activity

Call activity cocok untuk reusable saga fragment.

Contoh:

- payment authorization subprocess,
- document verification subprocess,
- external agency consultation subprocess,
- notification dispatch subprocess.

Rule:

```text
Call activity should represent a reusable business capability, not a random technical helper.
```

---

## 7. Model Saga sebagai State Machine yang Audit-Friendly

Untuk menjadi kuat secara production dan regulatory, jangan hanya menggambar happy path. Model harus menjawab:

1. Apa state business setelah setiap langkah?
2. Apakah step sudah committed secara eksternal?
3. Apa evidence yang disimpan?
4. Apakah step bisa diulang?
5. Apakah step bisa dibatalkan?
6. Siapa yang boleh melakukan manual override?
7. Bagaimana reviewer menjelaskan keputusan akhir?
8. Apa yang terjadi jika callback datang terlambat?
9. Apa yang terjadi jika compensation gagal?
10. Apa deadline dan escalation path?

Contoh lifecycle:

```text
SUBMITTED
ELIGIBILITY_CHECKING
ELIGIBILITY_PASSED
SLOT_RESERVED
PAYMENT_PENDING
PAYMENT_AUTHORIZED
UNDER_REVIEW
APPROVED
ISSUANCE_PENDING
ISSUED
CANCELLED
REJECTED
REPAIR_REQUIRED
```

BPMN mengatur journey, domain state menyimpan truth business.

Jangan menjadikan Camunda variable sebagai satu-satunya source of truth domain. Untuk regulatory/case system, domain database tetap harus menyimpan case/application state, evidence, actor, timestamps, dan decisions.

---

## 8. Operation Ledger: Fondasi Saga yang Serius

Salah satu teknik paling kuat adalah **operation ledger**.

Ledger menyimpan side effect yang pernah dicoba/dilakukan.

Contoh tabel:

```sql
CREATE TABLE orchestration_operation_ledger (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    process_instance_key VARCHAR(64) NOT NULL,
    business_key VARCHAR(128) NOT NULL,
    operation_type VARCHAR(100) NOT NULL,
    operation_key VARCHAR(200) NOT NULL,
    request_hash VARCHAR(128) NOT NULL,
    status VARCHAR(40) NOT NULL,
    external_reference VARCHAR(200),
    result_payload CLOB,
    error_code VARCHAR(100),
    error_message VARCHAR(1000),
    attempt_count INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    UNIQUE (operation_type, operation_key)
);
```

Contoh operation:

```text
RESERVE_SLOT / application-123 / SUCCESS / RSV-999
AUTHORIZE_PAYMENT / payment-abc / SUCCESS / AUTH-888
CANCEL_SLOT_RESERVATION / RSV-999 / SUCCESS
SEND_APPROVAL_EMAIL / application-123-v2 / SUCCESS
```

Kegunaan:

1. idempotency,
2. duplicate job handling,
3. replay result,
4. compensation decision,
5. audit trail,
6. reconciliation,
7. support debugging,
8. cross-system evidence.

---

## 9. Java Worker Pattern: Idempotent Saga Step

Contoh service task:

```text
Job type: reserve-slot.v1
```

Worker harus menjalankan pola:

```text
1. Build deterministic operation key.
2. Check operation ledger.
3. If SUCCESS exists, return previous result.
4. If IN_PROGRESS stale, decide repair/retry policy.
5. If absent, insert STARTED.
6. Call external system with idempotency key if supported.
7. Store external reference and result.
8. Complete Zeebe job.
```

Pseudo Java:

```java
public final class ReserveSlotWorker {

    private final OperationLedger ledger;
    private final SlotGateway slotGateway;

    public ReserveSlotResult handle(ReserveSlotCommand command) {
        OperationKey key = OperationKey.of(
                "RESERVE_SLOT",
                command.applicationId()
        );

        Operation existing = ledger.findByKey(key);
        if (existing != null && existing.isSuccess()) {
            return ReserveSlotResult.from(existing.resultPayload());
        }

        String requestHash = command.stableHash();
        Operation op = ledger.startOrReuse(key, requestHash);

        try {
            ExternalReservation reservation = slotGateway.reserveSlot(
                    command.preferredSlot(),
                    key.value()
            );

            ledger.markSuccess(
                    op.id(),
                    reservation.reservationId(),
                    reservation.toJson()
            );

            return new ReserveSlotResult(
                    true,
                    reservation.reservationId()
            );
        } catch (SlotUnavailableException e) {
            ledger.markBusinessRejected(op.id(), "SLOT_UNAVAILABLE", e.getMessage());
            throw new BpmnBusinessError("SLOT_UNAVAILABLE", e.getMessage());
        } catch (ExternalTimeoutException e) {
            ledger.markUnknown(op.id(), "TIMEOUT", e.getMessage());
            throw new RetryableTechnicalException(e);
        }
    }
}
```

Hal penting:

- operation key stabil,
- request hash mencegah key sama dengan payload berbeda,
- business rejection dipisahkan dari technical failure,
- timeout disimpan sebagai unknown, bukan langsung failed,
- result sukses bisa direplay.

---

## 10. Java Worker Pattern: Idempotent Compensation

Compensation juga harus idempotent.

Contoh:

```text
Job type: cancel-slot-reservation.v1
```

Pseudo Java:

```java
public final class CancelSlotReservationWorker {

    private final OperationLedger ledger;
    private final SlotGateway slotGateway;

    public CancelReservationResult handle(CancelReservationCommand command) {
        if (command.reservationId() == null || command.reservationId().isBlank()) {
            return CancelReservationResult.noop("No reservation was created");
        }

        OperationKey key = OperationKey.of(
                "CANCEL_SLOT_RESERVATION",
                command.reservationId()
        );

        Operation existing = ledger.findByKey(key);
        if (existing != null && existing.isSuccess()) {
            return CancelReservationResult.alreadyCancelled(command.reservationId());
        }

        Operation op = ledger.startOrReuse(key, command.stableHash());

        try {
            slotGateway.cancelReservation(command.reservationId(), key.value());
            ledger.markSuccess(op.id(), command.reservationId(), "{\"cancelled\":true}");
            return CancelReservationResult.cancelled(command.reservationId());
        } catch (ReservationAlreadyCancelledException e) {
            ledger.markSuccess(op.id(), command.reservationId(), "{\"alreadyCancelled\":true}");
            return CancelReservationResult.alreadyCancelled(command.reservationId());
        } catch (ReservationNotFoundException e) {
            ledger.markSuccess(op.id(), command.reservationId(), "{\"notFoundTreatedAsCancelled\":true}");
            return CancelReservationResult.notFoundTreatedAsCancelled(command.reservationId());
        } catch (ExternalTimeoutException e) {
            ledger.markUnknown(op.id(), "TIMEOUT", e.getMessage());
            throw new RetryableTechnicalException(e);
        }
    }
}
```

Compensation idempotency rule:

```text
If the desired compensated state is already true, return success.
```

Contoh:

- already cancelled = success,
- already refunded = success,
- already revoked = success,
- already released = success.

---

## 11. Compensation Ordering

Dalam saga, compensation biasanya berjalan reverse order:

```text
T1 reserve slot
T2 authorize payment
T3 create external case

Failure after T3:
C3 close external case
C2 void payment authorization
C1 release slot
```

Kenapa reverse order?

Karena step belakangan sering bergantung pada step sebelumnya.

Namun reverse order bukan hukum absolut. Domain bisa menentukan urutan lain.

Contoh:

```text
If payment captured and license issued,
first suspend/revoke license,
then refund payment,
then notify user.
```

Atau:

```text
If external case created and documents uploaded,
archive documents before closing case.
```

Rule:

```text
Compensation order is a business consistency decision, not merely stack unwinding.
```

---

## 12. BPMN Compensation vs Explicit Recovery Flow

Ada dua cara umum memodelkan compensation.

---

### 12.1 Native BPMN Compensation

Bentuk:

```text
Task A + compensation handler A
Task B + compensation handler B
Throw compensation event
```

Kelebihan:

- sesuai BPMN semantics,
- visual menunjukkan aktivitas mana yang bisa dikompensasi,
- engine membantu memanggil compensation handler untuk aktivitas completed.

Kekurangan:

- bisa kurang eksplisit untuk business user,
- debugging lebih butuh pemahaman BPMN advanced,
- ordering dan conditional compensation perlu hati-hati,
- tidak semua tim nyaman membaca simbol compensation.

---

### 12.2 Explicit Recovery Flow

Bentuk:

```text
Reserve Slot
Authorize Payment
If later failure:
  Void Payment
  Release Slot
  Mark Cancelled
```

Kelebihan:

- sangat jelas bagi business/support,
- mudah diberi user task manual repair,
- mudah diberi timer/escalation,
- mudah diberi conditional gateway.

Kekurangan:

- model bisa lebih verbose,
- risk mengulang pola di banyak proses,
- perlu disiplin agar tidak lupa recovery step.

---

### 12.3 Rekomendasi praktis

Untuk regulatory/case management enterprise:

```text
Gunakan explicit recovery flow jika clarity, audit, dan support lebih penting daripada compact BPMN.
```

Gunakan native compensation jika:

- tim sudah matang dengan BPMN compensation,
- pattern benar-benar “undo completed activities”,
- compensation scope jelas,
- model tidak perlu banyak manual branch.

---

## 13. Long-Running Transaction dengan Human Task

Saga yang melibatkan manusia lebih sulit karena waktu panjang.

Contoh:

```text
Submit application
Reserve interview slot
Wait for officer review
Wait for applicant clarification
Approve/reject
Issue certificate
```

Risiko:

1. reserved resource expired,
2. rule berubah saat proses berjalan,
3. applicant withdraws application,
4. officer leaves organization,
5. deadline breach,
6. duplicate human action,
7. external system changes status independently.

Desain yang kuat:

```text
Every human task decision must be interpreted against current domain state.
```

Jangan hanya percaya form submit.

Worker/task completion handler harus mengecek:

- task masih valid,
- case belum cancelled,
- user masih authorized,
- version/eTag cocok,
- deadline belum melarang action,
- required evidence ada,
- decision transition valid.

---

## 14. Reservation Pattern untuk Human Workflow

Jika resource harus disimpan selama menunggu manusia, pakai reservation expiry.

Contoh:

```text
Reserve slot for applicant
User task: confirm attendance within 48h
Boundary timer 48h:
  Release slot
  Mark confirmation expired
```

Jangan simpan reservation tanpa expiry.

Model:

```text
Reserve Slot
  -> Wait for Confirmation
       -> confirmed: Confirm Slot
       -> timeout: Release Slot
```

Variable:

```json
{
  "slotReservation": {
    "reservationId": "RSV-123",
    "reservedAt": "2026-06-21T09:00:00+07:00",
    "expiresAt": "2026-06-23T09:00:00+07:00",
    "status": "RESERVED"
  }
}
```

Domain DB tetap menyimpan reservation state; variable hanya orchestration snapshot.

---

## 15. Payment-like Saga Pattern

Payment adalah contoh klasik karena side effect-nya sensitif.

Pattern yang baik:

```text
Create order
Authorize payment
Reserve goods
If goods reserved -> Capture payment
If goods unavailable -> Void authorization
If capture unknown -> Reconcile
If refund needed -> Refund payment
```

Jangan desain:

```text
Charge payment first
Then hope everything else works
```

Untuk payment-like external action, status harus membedakan:

```text
NOT_ATTEMPTED
REQUESTED
SUCCEEDED
FAILED
UNKNOWN
COMPENSATION_REQUESTED
COMPENSATED
COMPENSATION_UNKNOWN
REPAIR_REQUIRED
```

`UNKNOWN` adalah state penting. Timeout tidak berarti gagal.

---

## 16. External Callback Saga Pattern

Banyak proses menunggu external callback.

Contoh:

```text
Submit to external agency
Wait for AgencyDecisionReceived message
If no response by due date -> escalate
```

Model:

```text
Submit External Request
Intermediate Message Catch: AgencyDecisionReceived
Boundary Timer: Due date exceeded
```

Message design:

```text
messageName: AgencyDecisionReceived
correlationKey: externalRequestId or caseId
messageId: providerEventId
TTL: based on expected early arrival window
```

Anti-pattern:

```text
Use processInstanceKey as callback correlation key exposed to external party.
```

Lebih baik expose stable business/external reference:

```text
applicationRefNo
externalRequestId
caseReference
```

Process instance key adalah engine identifier, bukan public business contract.

---

## 17. Cancellation Saga Pattern

Cancellation bisa datang kapan saja.

Sumber cancellation:

- user withdraws application,
- fraud detected,
- deadline expired,
- duplicate submission found,
- admin cancels case,
- upstream process cancelled.

Gunakan event subprocess:

```text
Message Start Event in Event Subprocess: CancelRequested
  -> Determine completed side effects
  -> Execute compensation/recovery
  -> Mark Cancelled
```

Penting:

```text
Cancellation is not just stopping the process token.
Cancellation must reconcile external commitments already made.
```

Jika hanya terminate process tanpa recovery, external systems bisa tertinggal dalam state salah.

---

## 18. Timeout Saga Pattern

Timeout ada beberapa jenis:

| Timeout | Makna | Recovery |
|---|---|---|
| Job timeout | worker tidak complete tepat waktu | retry/duplicate execution possible |
| HTTP client timeout | client tidak menerima respons | outcome unknown |
| Business SLA timeout | deadline business terlewati | escalate/cancel/reject/manual review |
| External callback timeout | pihak luar tidak merespons | query status/escalate/cancel |
| Reservation expiry | resource hold expired | release resource/ask user redo |

Jangan campur semua timeout sebagai satu error generik.

Contoh desain:

```text
Submit External Request
Wait for Callback
Boundary Timer: PT24H
  -> Query External Status
      -> completed: continue
      -> still pending: escalate
      -> not found: manual repair
```

---

## 19. Saga dengan Multi-Instance

Contoh:

```text
Verify 10 documents in parallel
```

Pertanyaan desain:

1. Apakah semua dokumen harus sukses?
2. Apakah satu gagal langsung reject?
3. Apakah perlu collect all reasons?
4. Apakah compensation per item?
5. Bagaimana partial success disimpan?
6. Bagaimana retry item tertentu?
7. Bagaimana menghindari hot partition/job flood?

Variable output sebaiknya structured:

```json
{
  "documentVerificationResults": [
    {
      "documentId": "DOC-1",
      "status": "PASSED",
      "verificationRef": "VR-1"
    },
    {
      "documentId": "DOC-2",
      "status": "FAILED",
      "reasonCode": "EXPIRED"
    }
  ]
}
```

Untuk high-cardinality item, jangan simpan semua detail besar di process variable. Simpan ringkasan; detail di domain/read model.

---

## 20. Saga dan Transaction Boundary di Java

Worker sering melakukan:

1. update local DB,
2. call external API,
3. complete Camunda job.

Tidak ada atomic transaction antara DB, external API, dan Zeebe.

Ada beberapa pola.

---

### 20.1 External call then DB save then complete job

Risiko:

```text
External succeeds, DB save fails.
```

Recovery sulit jika external reference hilang.

---

### 20.2 DB save STARTED, external call, DB save SUCCESS, complete job

Lebih baik.

Risiko:

```text
External succeeds, DB SUCCESS saved, complete job fails.
```

Jika job diulang, ledger replay result dan complete lagi.

---

### 20.3 Complete job before external call

Biasanya salah untuk side effect yang diperlukan oleh proses.

Risiko:

```text
Process continues as if side effect happened, but external call fails.
```

Gunakan hanya jika external side effect memang asynchronous best-effort dan punya proses terpisah.

---

### 20.4 Outbox pattern

Worker menyimpan command ke outbox dalam DB transaction lokal, lalu dispatcher mengirim ke external system.

Model:

```text
Worker receives job
  -> store operation + outbox event
  -> complete job? maybe wait or continue depending semantics
Dispatcher sends external command
External callback returns result
Process continues via message
```

Cocok untuk:

- high reliability external dispatch,
- event-driven domain service,
- decoupled integration,
- exactly-once-ish local persistence.

Namun jangan complete process step terlalu dini jika process harus menunggu external outcome.

---

## 21. Message Correlation untuk Saga Progress

Pattern:

```text
Camunda process sends request to external service
External service later publishes message back
Camunda correlates message to waiting process instance
```

Important fields:

```json
{
  "messageName": "PaymentAuthorized",
  "correlationKey": "PAY-REQ-123",
  "messageId": "provider-event-789",
  "timeToLive": "PT24H",
  "variables": {
    "paymentStatus": "AUTHORIZED",
    "authorizationId": "AUTH-456"
  }
}
```

Rules:

1. correlation key harus stabil,
2. message ID harus mencegah duplicate processing jika tersedia,
3. TTL harus cukup untuk early-arriving message,
4. callback handler harus validate signature/auth,
5. process harus punya timeout path,
6. late message harus punya policy.

Late message policies:

| Condition | Policy |
|---|---|
| Process already completed | Store as late event, ignore or reconcile |
| Process cancelled | Store and compare with cancellation reason |
| Compensation already executed | Check if external action conflicts |
| Unknown business key | Quarantine for manual review |

---

## 22. Idempotency Key Strategy untuk Saga

Jangan asal pilih key.

| Operation | Candidate Idempotency Key |
|---|---|
| Reserve slot | `applicationId + reservationPurpose + version` |
| Authorize payment | `paymentRequestId` |
| Capture payment | `authorizationId + captureAttemptNo` |
| Refund payment | `paymentId + refundReason + refundSequence` |
| Send notification | `caseId + notificationType + templateVersion + recipient` |
| Create external case | `caseId + targetSystem` |
| Revoke license | `licenseId + revocationDecisionId` |

Job key sendiri sering tidak cukup karena jika process model berubah atau compensation diulang, business operation tetap harus dikenali secara business-stable.

Process instance key juga tidak selalu cukup karena:

- satu process bisa melakukan operation yang sama beberapa kali,
- migration/retry bisa mengubah context,
- compensation mungkin perlu key berbasis external reference.

Rule:

```text
Idempotency key should identify the business operation, not merely the technical job attempt.
```

---

## 23. Saga Failure Matrix

Untuk setiap step, buat matrix.

Contoh step: `Authorize Payment`.

| Failure | Meaning | BPMN Handling | Worker Handling | Data Handling |
|---|---|---|---|---|
| insufficient balance | business rejection | BPMN error | throw BPMN error | store rejected reason |
| provider 503 | transient technical | job failure retry | fail job with backoff | attempt log |
| HTTP timeout | unknown | retry or status query | mark UNKNOWN | reconciliation needed |
| duplicate request | already processed | continue | replay result | ledger success |
| invalid payload | modelling/contract bug | incident | fail no retries or incident | store diagnostic |
| fraud suspected | business escalation | route to review | BPMN error/escalation | evidence |

Top 1% engineer tidak hanya menulis handler. Ia membuat matrix seperti ini sebelum production.

---

## 24. Compensation Failure Matrix

Compensation juga bisa gagal.

Contoh: `Refund Payment`.

| Failure | Meaning | Handling |
|---|---|---|
| refund success | compensated | continue |
| already refunded | compensated | continue |
| payment not found | maybe no-op or repair | domain-specific |
| refund rejected | cannot compensate automatically | manual repair |
| provider timeout | unknown | query/retry/reconcile |
| provider down | transient | retry with backoff |
| amount mismatch | data corruption/risk | incident/manual review |

Jangan buat compensation worker yang hanya:

```java
try refund; catch Exception -> throw
```

Itu belum production-grade.

---

## 25. BPMN Modelling Pattern: Explicit Saga with Manual Repair

Textual diagram:

```text
Start
  -> Reserve Slot
      error SLOT_UNAVAILABLE -> Reject Application
  -> Authorize Payment
      error PAYMENT_REJECTED -> Release Slot -> Reject Application
  -> Officer Review User Task
      rejected -> Void Payment -> Release Slot -> Reject Application
      approved -> Capture Payment
          technical incident -> Manual Repair
  -> Issue Certificate
      technical incident -> Manual Repair
  -> Notify Applicant
  -> End

Event Subprocess: ApplicantWithdrawn
  -> Determine Current Commitments
  -> If payment authorized/captured: Void/Refund
  -> If slot reserved: Release Slot
  -> Mark Withdrawn
  -> End
```

Keunggulan:

- business user bisa membaca outcome,
- support tahu repair path,
- compensation eksplisit,
- cancellation global tertangani,
- deadline bisa ditambahkan.

---

## 26. BPMN Modelling Pattern: Native Compensation

Textual diagram:

```text
Transaction Subprocess:
  Reserve Slot + Compensation Handler Release Slot
  Authorize Payment + Compensation Handler Void Payment
  Create External Case + Compensation Handler Close External Case
  If later failure -> Throw Compensation
```

Cocok jika:

- semua compensation secara natural attached ke activity,
- compensation hanya dipanggil saat flow gagal/cancel,
- tidak banyak conditional manual repair,
- tim paham simbol BPMN compensation.

Caution:

```text
Native compensation can hide operational complexity if team does not understand compensation semantics deeply.
```

---

## 27. Choreography vs Orchestration Decision Framework

Gunakan orchestration jika:

1. flow end-to-end harus terlihat,
2. banyak human task,
3. ada SLA/deadline,
4. ada audit/regulatory explanation,
5. banyak exception path,
6. business owner ingin memahami proses,
7. operasi support butuh dashboard process instance,
8. compensation harus dikontrol.

Gunakan choreography jika:

1. event hanya broadcast fakta domain,
2. downstream reaction independent,
3. tidak ada satu owner journey,
4. flow sederhana dan stabil,
5. service autonomy lebih penting,
6. failure lokal dapat ditangani lokal.

Gunakan hybrid jika:

1. process high-level perlu orchestrator,
2. internal service behavior tetap event-driven,
3. Camunda hanya menunggu milestone event,
4. service tidak ingin diekspos sebagai setiap micro-step BPMN.

---

## 28. Regulatory Enforcement Saga Example

Contoh domain:

```text
Complaint received
Preliminary screening
Create case
Assign officer
Request information from regulated entity
Wait for response
Assess evidence
Issue warning / escalate enforcement / close case
```

Saga side effects:

| Step | Side Effect | Compensation/Recovery |
|---|---|---|
| Create case number | case reference allocated | mark void/cancelled, not delete |
| Send information request | legal notice sent | send correction/withdrawal notice |
| Reserve hearing slot | slot held | release slot |
| Publish warning | external/legal effect | issue correction/revocation, manual approval |
| Create enforcement action | external case opened | close/suspend external action |

Regulatory principle:

```text
Do not erase; supersede with corrected state.
```

Dalam sistem regulasi, compensation sering bukan “undo”, tetapi:

```text
record a defensible subsequent action that changes legal/operational status.
```

---

## 29. Audit Defensibility in Saga

Audit harus bisa menjawab:

1. Who initiated the process?
2. What step completed?
3. What external reference was created?
4. What decision caused compensation?
5. Was compensation successful?
6. If not, who repaired it?
7. What evidence supported the final state?
8. Was deadline breached?
9. Was user notified?
10. What version of process and worker ran?

Simpan:

- process instance key,
- BPMN process id/version,
- business key,
- worker version,
- operation key,
- external reference,
- request hash,
- response summary,
- actor,
- timestamp,
- decision reason,
- compensation reason,
- manual repair note.

---

## 30. Observability untuk Saga

Minimal logs:

```json
{
  "event": "saga.step.completed",
  "processInstanceKey": "2251799813685249",
  "bpmnProcessId": "application_review",
  "businessKey": "APP-2026-0001",
  "jobType": "authorize-payment.v1",
  "operationKey": "AUTHORIZE_PAYMENT:PAY-REQ-123",
  "externalReference": "AUTH-456",
  "status": "SUCCESS",
  "durationMs": 842,
  "workerVersion": "payment-worker:1.8.3"
}
```

Metrics:

- saga step duration,
- saga step failure count,
- compensation count,
- compensation failure count,
- unknown outcome count,
- manual repair count,
- retry exhausted count,
- late message count,
- duplicate message count,
- external provider timeout count,
- process cycle time.

Dashboards:

1. active saga by state,
2. pending compensation,
3. compensation failed,
4. unknown external outcomes,
5. manual repair queue,
6. SLA breach risk,
7. external dependency health.

---

## 31. Process Variables for Saga

Good variable:

```json
{
  "applicationId": "APP-2026-0001",
  "payment": {
    "paymentRequestId": "PAY-REQ-123",
    "status": "AUTHORIZED",
    "authorizationId": "AUTH-456",
    "authorizedAt": "2026-06-21T10:15:30+07:00"
  },
  "slot": {
    "reservationId": "RSV-999",
    "status": "RESERVED",
    "expiresAt": "2026-06-22T10:00:00+07:00"
  },
  "saga": {
    "currentPhase": "UNDER_REVIEW",
    "requiresCompensation": false,
    "lastOperationKey": "AUTHORIZE_PAYMENT:PAY-REQ-123"
  }
}
```

Bad variable:

```json
{
  "done": true,
  "success": false,
  "err": "failed",
  "data": "huge raw external response..."
}
```

Variable harus cukup untuk orchestration decision, bukan menjadi dump semua payload.

---

## 32. Worker Completion Variables

Worker complete job dengan variables yang stabil.

Contoh:

```java
client.newCompleteCommand(job.getKey())
        .variables(Map.of(
                "payment", Map.of(
                        "status", "AUTHORIZED",
                        "authorizationId", result.authorizationId(),
                        "paymentRequestId", command.paymentRequestId()
                )
        ))
        .send()
        .join();
```

Jangan complete dengan raw external response tanpa filter.

Risiko raw response:

- PII leakage,
- payload besar,
- schema volatile,
- Optimize/reporting berantakan,
- process expression rapuh.

---

## 33. Versioning Saga

Saga versioning sulit karena instance bisa hidup lama.

Hal yang harus diversify:

1. BPMN process version,
2. worker version,
3. job type version,
4. message name version,
5. variable schema version,
6. external API version,
7. compensation version.

Contoh job type:

```text
authorize-payment.v1
authorize-payment.v2
void-payment-authorization.v1
refund-payment.v1
```

Jangan upgrade worker secara breaking untuk job type lama.

Running process lama mungkin masih membuat job lama.

Rule:

```text
Support old job types until no running process instance can emit them.
```

---

## 34. Saga Testing Strategy

Test minimal:

1. happy path,
2. business rejection at each step,
3. technical retry at each step,
4. incident when retries exhausted,
5. compensation after failure,
6. compensation idempotency,
7. compensation failure,
8. duplicate job execution,
9. external timeout unknown outcome,
10. duplicate callback,
11. late callback,
12. cancellation during each major phase,
13. timer timeout path,
14. process version compatibility,
15. manual repair path.

Test matrix contoh:

| Scenario | Expected |
|---|---|
| Reserve succeeds, payment rejected | slot released, process rejected |
| Payment authorized, review rejected | payment voided, slot released |
| Capture payment timeout | process enters reconcile/manual repair |
| Applicant withdraws after approval before issuance | compensation path based on commitments |
| Duplicate worker execution after external success | ledger returns existing success |
| Compensation repeated | no duplicate refund/release |

---

## 35. Anti-Patterns

### 35.1 Treating Saga as Technical Rollback

Salah:

```text
If downstream fails, delete all records.
```

Benar:

```text
Record what happened, execute business recovery, preserve audit trail.
```

---

### 35.2 Non-Idempotent Compensation

Salah:

```text
refund() always creates a new refund.
```

Benar:

```text
refund(idempotencyKey) returns existing refund if already processed.
```

---

### 35.3 Compensation Without Evidence

Salah:

```text
Release slot because variable says slotReserved=true.
```

Benar:

```text
Release reservationId=RSV-123 because operation ledger confirms reserve success.
```

---

### 35.4 Infinite Retry on Business Failure

Salah:

```text
Retry insufficient balance forever.
```

Benar:

```text
Throw BPMN error PAYMENT_REJECTED and follow business path.
```

---

### 35.5 Completing Job Before Side Effect

Salah:

```text
Complete Zeebe job, then call external provider.
```

Jika provider gagal, process sudah lanjut berdasarkan fakta palsu.

---

### 35.6 Exposing Process Instance Key to External Systems

Process instance key adalah technical identifier. Untuk external correlation, gunakan business/external reference.

---

### 35.7 One Giant Saga Process

Jangan masukkan semua micro-step teknis ke satu BPMN besar.

Gunakan:

- call activity,
- subprocess,
- domain service abstraction,
- milestone events,
- custom read model.

---

### 35.8 Compensation for Everything

Tidak semua failure butuh compensation.

Kadang yang benar adalah:

- retry,
- status query,
- manual repair,
- human review,
- escalation,
- forward recovery.

---

## 36. Design Review Checklist

Sebelum saga production, tanya:

### Business Semantics

- Apa business transaction yang dikelola?
- Apa final states yang valid?
- Apa state intermediate yang valid?
- Apa yang irreversible?
- Apa yang legally/audit significant?

### Step Design

- Apa operation key setiap step?
- Apakah step idempotent?
- Apa business error yang expected?
- Apa technical failure yang retryable?
- Apa unknown outcome policy?

### Compensation

- Step mana yang perlu compensation?
- Compensation idempotent?
- Compensation order benar?
- Compensation failure masuk ke mana?
- Apakah compensation menghasilkan audit event?

### Message/Callback

- Apa correlation key?
- Apa message ID?
- Apa TTL?
- Apa duplicate policy?
- Apa late message policy?
- Apa security validation?

### Timeout/SLA

- Apa job timeout?
- Apa external callback timeout?
- Apa business deadline?
- Apa escalation path?
- Apa manual repair SLA?

### Data

- Variable apa yang dibutuhkan proses?
- Detail apa yang harus di domain DB?
- Operation ledger ada?
- External reference disimpan?
- PII diminimalkan?

### Operations

- Dashboard ada?
- Alert ada?
- Manual repair queue ada?
- Runbook ada?
- Reconciliation job ada?
- Support bisa menjelaskan state?

---

## 37. Reference Architecture: Saga-Capable Worker Service

```text
worker-service
├── process-contract
│   ├── jobtypes
│   ├── messages
│   ├── variables
│   └── errors
├── application
│   ├── ReserveSlotUseCase
│   ├── AuthorizePaymentUseCase
│   ├── CancelReservationUseCase
│   └── SagaDecisionService
├── domain
│   ├── OperationLedger
│   ├── OperationKey
│   ├── SagaStepStatus
│   └── CompensationPolicy
├── infrastructure
│   ├── camunda
│   │   ├── ReserveSlotWorker
│   │   ├── AuthorizePaymentWorker
│   │   └── MessagePublisher
│   ├── persistence
│   │   └── JdbcOperationLedgerRepository
│   └── external
│       ├── SlotGatewayHttpClient
│       └── PaymentGatewayHttpClient
└── observability
    ├── SagaLogger
    ├── SagaMetrics
    └── CorrelationContext
```

Principle:

```text
Camunda adapter translates job into use case.
Use case owns idempotency and business operation semantics.
External adapter owns protocol details.
Ledger owns durable evidence.
```

---

## 38. Staff-Level Heuristics

1. **A saga is a business consistency protocol, not just a BPMN diagram.**
2. **Every side effect must have an identity.**
3. **Every external call has at least three outcomes: success, failure, unknown.**
4. **Timeout is not proof of failure.**
5. **Compensation must be idempotent and auditable.**
6. **Do not compensate what did not complete.**
7. **Do not retry business rejection.**
8. **Do not model every microservice call; model business milestones.**
9. **Operate helps triage, but domain ledger proves side effects.**
10. **Manual repair is not shameful; invisible inconsistency is.**
11. **Long-running process means version compatibility is a production concern.**
12. **Late and duplicate messages are normal distributed-system events.**
13. **Saga state belongs both in process and domain model, with clear ownership.**
14. **Regulated systems usually supersede state; they do not erase history.**
15. **The best saga design is often reservation-confirmation, not compensation-after-final-action.**

---

## 39. Mini Case Study: License Issuance Saga

Scenario:

```text
Applicant applies for license.
System verifies eligibility.
Officer reviews.
Payment is authorized.
License number is reserved.
Final approval is granted.
Payment is captured.
License is issued.
Applicant is notified.
```

Happy path:

```text
Submit Application
-> Check Eligibility
-> Officer Review
-> Authorize Payment
-> Reserve License Number
-> Final Approval
-> Capture Payment
-> Issue License
-> Notify Applicant
-> End
```

Failure paths:

| Failure | Recovery |
|---|---|
| Eligibility fails | reject, no compensation |
| Officer rejects after payment auth | void payment auth |
| License reservation fails | void payment auth, manual review or reject |
| Capture payment unknown | reconcile with payment provider |
| Issue license fails after capture | forward recovery/manual repair, not refund immediately |
| Applicant withdraws before capture | void auth, release license number |
| Applicant withdraws after issuance | revocation process, not simple cancellation |

Important insight:

```text
After license is issued, cancellation is not the same process as pre-issuance withdrawal.
It may require revocation, audit, notice, appeal window, and legal authority.
```

This is why advanced orchestration is domain modelling, not just engine usage.

---

## 40. What This Part Gives You

Part ini membangun mental model advanced untuk Camunda 8 sebagai engine untuk long-running distributed business consistency.

Kamu sekarang harus melihat saga sebagai kombinasi:

```text
BPMN orchestration
+ idempotent Java workers
+ operation ledger
+ explicit compensation/recovery
+ message correlation
+ timeout/escalation
+ audit trail
+ manual repair
+ observability
```

Bukan sekadar:

```text
service task A -> service task B -> service task C
```

Top 1% engineer bukan hanya tahu simbol BPMN compensation. Ia bisa menjawab:

- apa yang sudah terjadi,
- apa yang belum terjadi,
- apa yang bisa diulang,
- apa yang harus dikompensasi,
- apa yang tidak boleh dikompensasi otomatis,
- apa yang perlu manual review,
- apa evidence-nya,
- dan bagaimana sistem tetap benar meskipun worker, network, external provider, atau manusia gagal.

---

## 41. Ringkasan

- Saga mengelola long-running business transaction dengan local transaction dan explicit recovery.
- Compensation bukan rollback teknis; ia adalah business recovery action.
- Camunda 8 cocok untuk saga karena durable process state, wait state, external workers, messages, timers, user tasks, dan operational visibility.
- Orchestration cocok untuk end-to-end lifecycle yang butuh visibility, SLA, human task, dan audit.
- Choreography cocok untuk autonomous event reaction; hybrid sering terbaik.
- Worker saga harus idempotent, memakai operation ledger, dan membedakan success/failure/unknown.
- Compensation juga harus idempotent dan auditable.
- Timeout bukan bukti failure.
- Message correlation harus punya correlation key, message ID, TTL, duplicate policy, dan late-message policy.
- Regulatory workflow sering tidak “undo”; ia membuat subsequent corrective action yang defensible.
- Production saga harus punya runbook, dashboard, manual repair queue, dan reconciliation process.

---

## 42. Referensi

- Camunda 8 Docs — Compensation events: https://docs.camunda.io/docs/components/modeler/bpmn/compensation-events/
- Camunda 8 Docs — Compensation handler: https://docs.camunda.io/docs/components/modeler/bpmn/compensation-handler/
- Camunda 8 Docs — Message events: https://docs.camunda.io/docs/components/modeler/bpmn/message-events/
- Camunda 8 Docs — Messages concept: https://docs.camunda.io/docs/components/concepts/messages/
- Camunda 8 Docs — Job workers: https://docs.camunda.io/docs/components/concepts/job-workers/
- Camunda 8 Docs — Dealing with problems and exceptions: https://docs.camunda.io/docs/components/best-practices/development/dealing-with-problems-and-exceptions/
- Camunda Blog — How a Bank Uses Compensation Events in Camunda 8: https://camunda.com/blog/2025/06/how-a-bank-uses-compensation-events-camunda-8/

---

## 43. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-030.md
```

Judul berikutnya:

```text
Part 030 — Case Management and Regulatory Lifecycle Modelling with Camunda 8
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-028.md">⬅️ Part 028 — Migration from Camunda 7 to Camunda 8: Strategy, Gaps, Refactoring, and Risk Control</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-030.md">Part 030 — Case Management and Regulatory Lifecycle Modelling with Camunda 8 ➡️</a>
</div>

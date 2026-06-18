# learn-java-reliability-part-022.md

# Part 022 — Consistency, Compensation, and Distributed Failure

> Seri: Graceful Shutdown, Error Handling, Exceptions, dan Reliability untuk Java Engineer  
> Status: Part 022 dari 030  
> Fokus: consistency, saga, compensation, distributed failure, outbox/inbox, event reliability, reconciliation, repair, dan human-in-the-loop recovery.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya, kita sudah membahas:

- failure mental model;
- Java exception semantics;
- exception taxonomy;
- fail-fast/fail-safe/fail-open/fail-closed;
- error contract API;
- exception translation;
- validation dan invariant;
- graceful shutdown;
- Kubernetes/container termination;
- in-flight request draining;
- worker, scheduler, queue consumer;
- transaction safety;
- idempotency;
- timeout/deadline/cancellation;
- retry;
- circuit breaker/bulkhead/rate limiter/time limiter;
- fallback/degradation;
- external integration reliability;
- persistence failure.

Part ini menggabungkan semua konsep itu ke area yang lebih sulit:

> Apa yang terjadi ketika satu business operation tidak bisa selesai dalam satu database transaction, satu service, satu process, atau satu synchronous request?

Di sistem enterprise/microservices, operasi bisnis sering menyentuh banyak boundary:

- database berbeda;
- service berbeda;
- message broker;
- external API;
- file storage;
- audit trail;
- notification;
- approval workflow;
- state machine;
- human decision;
- batch processing;
- downstream reporting;
- search index;
- cache;
- third-party provider.

Di titik ini, “pakai `@Transactional`” tidak cukup.

Yang dibutuhkan adalah desain distributed consistency.

---

## 1. Core Problem

### 1.1 Masalah utama

Dalam local transaction, kita sering berpikir:

```text
begin transaction
  update A
  update B
commit
```

Kalau gagal sebelum commit, rollback.

Kalau commit sukses, semua perubahan terlihat.

Tetapi dalam distributed system, bentuk realitanya lebih seperti ini:

```text
Service A DB transaction committed
Event to Service B maybe published
Service B maybe processed the event
External payment maybe captured
Notification maybe sent
Search index maybe updated
Audit maybe written
Response to client maybe failed
```

Tidak ada satu tombol rollback yang bisa mengembalikan semuanya secara atomik.

Distributed failure menyebabkan beberapa pertanyaan sulit:

- Apakah operasi sudah berhasil sebagian?
- Bagian mana yang sudah committed?
- Bagian mana yang belum menerima event?
- Apakah event terkirim dua kali?
- Apakah downstream sudah memproses tapi response gagal?
- Apakah compensation aman?
- Apakah compensation boleh dilakukan secara otomatis?
- Apakah butuh intervensi manusia?
- Bagaimana membuktikan final state valid?
- Bagaimana mencegah customer melihat state yang menyesatkan?

### 1.2 False assumption yang sering terjadi

Banyak engineer tidak sadar masih membawa mental model local transaction ke distributed system.

Contoh asumsi salah:

```text
Kalau service A sukses, berarti seluruh business operation sukses.
```

Salah.

Mungkin service A hanya membuat order, tetapi payment gagal.

```text
Kalau event sudah dipublish, berarti consumer pasti sudah memproses.
```

Salah.

Event bisa belum terkirim, tertahan, duplikat, out of order, atau masuk dead letter.

```text
Kalau consumer idempotent, berarti ordering tidak masalah.
```

Salah.

Idempotency menyelesaikan duplicate, bukan semantic ordering.

```text
Kalau compensation ada, berarti rollback distributed aman.
```

Salah.

Compensation sendiri adalah distributed operation yang bisa gagal.

```text
Kalau akhirnya consistent, user tidak akan terdampak.
```

Salah.

Eventual consistency tetap punya window di mana user, operator, atau downstream melihat state intermediate.

---

## 2. Mental Model: Consistency Is a State Management Problem

Distributed consistency bukan sekadar masalah data replication.

Distributed consistency adalah masalah state management lintas boundary.

Daripada berpikir:

```text
How do I make all services commit together?
```

Pikirkan:

```text
What states can the business process be in?
Which states are valid?
Which states are temporary?
Which states are terminal?
Which states require compensation?
Which states require retry?
Which states require human repair?
```

### 2.1 Dari atomic transaction ke recoverable workflow

Local transaction:

```text
all-or-nothing
```

Distributed workflow:

```text
make progress step by step
persist progress
detect failure
retry when safe
compensate when needed
reconcile when uncertain
repair when automatic recovery is unsafe
```

### 2.2 Distributed consistency bukan “semua sama setiap saat”

Dalam banyak sistem enterprise, target realistis bukan:

```text
All components always see exactly the same state at exactly the same time.
```

Target realistis:

```text
All components eventually converge to a valid business state,
and every intermediate state is explicit, observable, recoverable,
and defensible.
```

Kata kuncinya:

- explicit;
- observable;
- recoverable;
- defensible.

Kalau state intermediate tidak eksplisit, sistem akan punya “ghost state”.

Ghost state adalah state yang nyata terjadi di produksi tetapi tidak ada di model domain.

Contoh:

```text
Application status = SUBMITTED
Payment status = CHARGED
Document status = FAILED_TO_UPLOAD
Audit status = MISSING
Notification status = SENT
```

Kalau domain model hanya mengenal:

```text
DRAFT
SUBMITTED
APPROVED
REJECTED
```

maka kondisi di atas tidak punya tempat.

Akhirnya engineer melakukan patch ad-hoc:

- manual DB update;
- resend event manual;
- skip validation sementara;
- run script repair;
- retry job tanpa idempotency;
- ignore downstream mismatch.

Itu tanda distributed state belum dimodelkan dengan benar.

---

## 3. Vocabulary: Jangan Campur Istilah

### 3.1 Local transaction

Local transaction adalah transaksi dalam satu resource manager, biasanya satu database.

Contoh:

```text
Insert application
Insert application history
Insert audit trail
Commit dalam satu database
```

Ini masih bisa dilindungi oleh ACID transaction.

### 3.2 Distributed transaction

Distributed transaction adalah transaksi yang mencoba mengkoordinasikan commit lintas beberapa resource.

Contoh:

```text
DB A commit + DB B commit + message broker publish as one atomic unit
```

Secara teori bisa memakai 2PC/XA, tetapi dalam microservices/cloud architecture modern sering dihindari karena coupling, availability impact, operational complexity, dan boundary ownership.

### 3.3 Business transaction

Business transaction adalah operasi bisnis end-to-end dari sudut pandang domain.

Contoh:

```text
Submit application
Reserve inventory
Approve case
Issue licence
Collect payment
Register candidate
```

Business transaction bisa terdiri dari banyak local transaction.

### 3.4 Saga

Saga adalah pendekatan untuk membagi business transaction lintas service menjadi sequence local transaction.

Jika salah satu langkah gagal, saga menjalankan compensating transaction untuk membatalkan atau menetralkan efek bisnis dari langkah sebelumnya.

Bentuk konseptual:

```text
T1 -> T2 -> T3 -> T4

Jika T3 gagal:
  C2 -> C1
```

Di sini:

- `T1`, `T2`, `T3`, `T4` = local transactions;
- `C1`, `C2` = compensating transactions.

Penting:

> Compensation bukan database rollback. Compensation adalah aksi bisnis baru yang membawa sistem ke final state yang valid.

### 3.5 Compensation

Compensation adalah tindakan untuk membalik, menetralkan, atau mengoreksi efek bisnis dari step sebelumnya.

Contoh:

| Step | Compensation |
|---|---|
| Reserve stock | Release stock |
| Capture payment | Refund payment |
| Create provisional licence | Void licence |
| Allocate slot | Release slot |
| Send approval notification | Send correction/revocation notification |
| Mark application submitted | Mark application submission failed/cancelled |

Tidak semua aksi bisa benar-benar “undo”.

Contoh:

- email sudah terkirim;
- SMS sudah diterima;
- external party sudah melihat data;
- irreversible payment settlement;
- audit trail tidak boleh dihapus;
- legal decision sudah issued.

Maka compensation harus didesain sebagai business correction, bukan time travel.

### 3.6 Reconciliation

Reconciliation adalah proses membandingkan state antar-system untuk mendeteksi mismatch dan mengembalikan ke state valid.

Contoh:

```text
Local payment = PENDING
Provider payment = SUCCESS
```

Reconciliation bisa menghasilkan:

- update local status;
- retry missing event;
- create compensation;
- create manual review task;
- raise incident.

### 3.7 Repair

Repair adalah tindakan eksplisit untuk memperbaiki state yang rusak, stuck, atau ambigu.

Repair bisa:

- otomatis;
- semi otomatis;
- manual dengan approval;
- script controlled;
- workflow human-in-the-loop.

### 3.8 Convergence

Convergence adalah kondisi di mana semua component akhirnya mencapai state yang valid dan selaras secara bisnis.

Convergence tidak selalu berarti semua field identik.

Contoh:

```text
Order service: CANCELLED
Payment service: REFUNDED
Notification service: CANCELLATION_SENT
Audit service: ALL_EVENTS_RECORDED
```

Itu consistent secara bisnis walaupun tiap service punya state berbeda.

---

## 4. Why Distributed Failure Is Hard

### 4.1 Network uncertainty

Dalam distributed system, ketika remote call timeout, kita tidak tahu pasti:

- request tidak pernah sampai;
- request sampai tapi belum diproses;
- request diproses tapi response hilang;
- request diproses dan committed;
- request diproses dua kali karena retry;
- server crash setelah commit sebelum response;
- server sedang lambat tapi akan sukses nanti.

Timeout bukan bukti failure final.

Timeout adalah bukti bahwa caller tidak menerima outcome dalam budget waktu.

### 4.2 Partial commit

Service A bisa commit, lalu gagal publish event.

```text
DB commit success
Process killed before event publish
```

Tanpa outbox, downstream tidak tahu perubahan terjadi.

### 4.3 Duplicate delivery

Message broker dengan at-least-once delivery bisa mengirim message lebih dari sekali.

Consumer harus idempotent.

### 4.4 Out-of-order event

Event bisa diproses tidak sesuai urutan.

Contoh:

```text
ApplicationApproved processed before ApplicationSubmitted
```

Atau:

```text
PaymentRefunded processed before PaymentCaptured
```

### 4.5 Lost semantic context

Jika event terlalu tipis:

```json
{
  "applicationId": "A123",
  "status": "UPDATED"
}
```

consumer tidak tahu:

- update apa;
- sequence berapa;
- command asalnya;
- transition dari mana ke mana;
- apakah event lama atau baru;
- apakah event retried;
- apakah harus ignore, apply, atau reject.

### 4.6 Compensation can fail

Compensation sering dianggap penyelamat.

Padahal compensation juga bisa gagal:

- refund provider timeout;
- release inventory gagal;
- cancel booking ditolak karena sudah consumed;
- correction notification gagal dikirim;
- legal status tidak boleh diubah tanpa approval;
- downstream sudah melakukan side effect lanjutan.

Maka compensation harus punya state machine sendiri.

### 4.7 Human process is part of the system

Dalam enterprise/regulatory system, tidak semua recovery boleh otomatis.

Contoh:

- case sudah assigned ke officer;
- enforcement action sudah generated;
- licence sudah issued;
- audit evidence incomplete;
- external agency already notified;
- payment mismatch affects citizen/business.

Di sini, human-in-the-loop bukan kelemahan. Itu bagian dari safe recovery.

---

## 5. The Core Design Shift: From Atomicity to Explicit State Progression

### 5.1 Local atomicity tetap penting

Jangan salah paham.

Kita tetap butuh local ACID transaction.

Yang berubah adalah scope-nya.

Gunakan local transaction untuk menjaga invariant internal service:

```text
Application row + status history + domain event outbox + audit metadata
```

Dalam satu commit.

Tapi jangan berharap local transaction menyelesaikan whole business process lintas service.

### 5.2 Business operation harus punya process state

Contoh operasi `SubmitApplication`.

Model buruk:

```text
application.status = SUBMITTED
```

Model lebih defensible:

```text
DRAFT
SUBMISSION_REQUESTED
VALIDATION_PASSED
PAYMENT_PENDING
PAYMENT_CONFIRMED
DOCUMENT_LOCKED
SUBMISSION_COMPLETED
SUBMISSION_FAILED
SUBMISSION_CANCELLED
SUBMISSION_REQUIRES_REVIEW
```

Atau pisahkan:

```text
Application lifecycle status
Payment status
Document status
Submission process status
Notification status
```

Kuncinya bukan membuat status sebanyak mungkin.

Kuncinya adalah setiap failure window penting punya representasi eksplisit.

### 5.3 Intermediate state harus valid

State sementara tidak boleh dianggap “kotor”.

Contoh:

```text
PAYMENT_PENDING
```

adalah valid intermediate state.

Yang buruk adalah state ambigu:

```text
SUBMITTED but payment maybe not captured
```

### 5.4 Terminal state harus jelas

Terminal state adalah state yang tidak akan berubah kecuali repair khusus.

Contoh:

```text
COMPLETED
CANCELLED
FAILED_FINAL
EXPIRED
VOIDED
MANUAL_REPAIR_COMPLETED
```

Jangan biarkan process stuck tanpa terminal resolution.

---

## 6. Saga Pattern Deep Dive

### 6.1 Kapan saga diperlukan?

Saga cocok ketika:

- business operation menyentuh lebih dari satu service/database;
- tidak bisa memakai satu local transaction;
- setiap step bisa committed secara independen;
- kegagalan step berikutnya perlu ditangani dengan compensation;
- eventual consistency acceptable;
- setiap step punya semantic outcome jelas;
- proses bisa diretry/recover setelah crash.

Saga tidak cocok ketika:

- operasi harus strongly consistent real-time;
- compensation tidak mungkin;
- intermediate state tidak boleh terlihat;
- domain tidak bisa menerima eventual consistency;
- ada legal/regulatory requirement atomicity yang tidak bisa dinegosiasikan;
- tim belum bisa mengoperasikan observability/reconciliation.

### 6.2 Saga bukan distributed transaction murah

Saga bukan cara untuk mendapatkan ACID lintas service dengan lebih mudah.

Saga mengubah problem:

Dari:

```text
How to commit all at once?
```

Menjadi:

```text
How to safely progress, detect failure, compensate, reconcile, and converge?
```

### 6.3 Saga choreography

Dalam choreography, tidak ada central orchestrator.

Service saling bereaksi terhadap event.

Contoh:

```text
OrderCreated -> Payment service captures payment
PaymentCaptured -> Inventory service reserves stock
StockReserved -> Shipping service creates shipment
ShipmentCreated -> Order service confirms order
```

Kelebihan:

- loose coupling;
- service autonomy;
- natural event-driven model;
- tidak ada single orchestrator bottleneck.

Kekurangan:

- sulit melihat end-to-end process;
- logic tersebar;
- debugging sulit;
- failure path sulit dilacak;
- event cycle risk;
- sulit enforce global timeout;
- sulit human repair jika tidak ada process owner.

Cocok untuk:

- domain event propagation;
- proses sederhana;
- downstream independent;
- eventual notifications;
- non-critical projection updates.

### 6.4 Saga orchestration

Dalam orchestration, ada orchestrator/process manager yang mengatur step.

Contoh:

```text
SubmissionSaga
  1. validate application
  2. reserve slot
  3. capture payment
  4. lock document
  5. mark submitted
  6. send notification
```

Kelebihan:

- process eksplisit;
- easier monitoring;
- easier timeout;
- easier compensation;
- easier manual repair;
- cocok untuk regulatory workflow;
- satu tempat untuk melihat state machine.

Kekurangan:

- orchestrator bisa jadi coupling point;
- orchestrator harus reliable;
- command/reply complexity;
- service autonomy berkurang;
- harus hati-hati agar orchestrator tidak menjadi god service.

Cocok untuk:

- business process penting;
- long-running workflow;
- approval/enforcement lifecycle;
- payment + issuance;
- case management;
- operasi yang butuh auditability tinggi.

### 6.5 Hybrid saga

Dalam sistem nyata, sering perlu hybrid.

Contoh:

- core business process diatur orchestrator;
- downstream analytics/search/notification memakai choreography;
- external reconciliation berjalan batch;
- manual repair lewat operational workflow.

Jangan terjebak pilihan ideologis.

Pilih berdasarkan:

- criticality;
- observability need;
- compensation complexity;
- ownership;
- business audit requirement;
- failure blast radius.

---

## 7. Compensation Design

### 7.1 Compensation harus business-aware

Compensation bukan kebalikan teknis dari operasi.

Contoh salah:

```text
Jika issue licence gagal downstream, delete application row.
```

Kenapa salah?

Karena application mungkin sudah menjadi record legal/audit.

Lebih benar:

```text
Mark issuance as FAILED
Mark application as REQUIRES_REVIEW
Append audit event
Notify operator
```

### 7.2 Compensation harus idempotent

Karena compensation bisa diretry.

Contoh:

```java
void refundPayment(String paymentId, String compensationId) {
    if (refundRepository.existsByCompensationId(compensationId)) {
        return;
    }

    Payment payment = paymentRepository.findById(paymentId)
        .orElseThrow(() -> new PaymentNotFoundException(paymentId));

    if (payment.isAlreadyRefunded()) {
        refundRepository.recordNoop(compensationId, paymentId);
        return;
    }

    paymentProvider.refund(payment.providerChargeId(), compensationId);
    payment.markRefunded();
    refundRepository.recordSuccess(compensationId, paymentId);
}
```

`compensationId` penting agar retry compensation tidak melakukan refund dua kali.

### 7.3 Compensation harus punya state

Jangan modelkan compensation sebagai method void yang “semoga berhasil”.

Modelkan sebagai process:

```text
COMPENSATION_NOT_REQUIRED
COMPENSATION_REQUESTED
COMPENSATION_IN_PROGRESS
COMPENSATION_SUCCEEDED
COMPENSATION_FAILED_RETRYABLE
COMPENSATION_FAILED_FINAL
COMPENSATION_REQUIRES_MANUAL_REVIEW
```

### 7.4 Compensation tidak selalu reverse order sederhana

Dalam teori, compensation sering digambarkan reverse order:

```text
T1 -> T2 -> T3
C3 -> C2 -> C1
```

Dalam realitas, urutan compensation bisa berbeda.

Contoh:

```text
1. Reserve slot
2. Capture payment
3. Issue document
4. Notify external agency
```

Jika step 4 gagal, mungkin compensation bukan langsung void document.

Mungkin:

```text
retry notify external agency
if still failed, create manual notification task
keep document issued but mark external sync pending
```

Karena void document bisa lebih merusak daripada sync ulang.

### 7.5 Compensation harus memperhitungkan irreversible effect

Beberapa efek tidak bisa dibatalkan:

- email terkirim;
- audit log tertulis;
- customer melihat status;
- external system menerima data;
- legal decision issued;
- payment settled;
- file downloaded;
- notification opened.

Untuk efek irreversible, compensation biasanya berupa corrective action:

- correction notification;
- reversal record;
- refund;
- voiding;
- superseding record;
- manual acknowledgement;
- audit amendment;
- explanatory note.

---

## 8. Transactional Outbox Pattern

### 8.1 Masalah outbox

Problem klasik:

```text
@Transactional
public void submitApplication(Command command) {
    application.markSubmitted();
    repository.save(application);
    eventPublisher.publish(new ApplicationSubmitted(application.id()));
}
```

Ada failure window:

```text
DB commit success
process crashes before event publish
```

Atau:

```text
event published
DB rollback
```

Keduanya buruk.

### 8.2 Solusi outbox

Simpan domain change dan event dalam local DB transaction yang sama.

```text
begin transaction
  update application status
  insert audit trail
  insert outbox_event
commit
```

Lalu relay terpisah membaca outbox dan publish ke broker.

```text
outbox relay:
  find unpublished events
  publish event
  mark as published
```

### 8.3 Kenapa outbox bekerja?

Karena kita tidak mencoba membuat DB dan broker commit atomik.

Kita memastikan:

```text
Jika state berubah, event intent ikut tersimpan.
```

Jika process crash setelah commit, relay masih bisa publish dari outbox.

### 8.4 Outbox tetap butuh idempotent consumer

Outbox relay bisa publish event lebih dari sekali.

Contoh:

```text
publish success
crash before mark published
restart
publish again
```

Maka consumer tetap harus idempotent.

### 8.5 Minimal outbox schema

Contoh:

```sql
CREATE TABLE outbox_event (
    id                  VARCHAR(36) PRIMARY KEY,
    aggregate_type      VARCHAR(100) NOT NULL,
    aggregate_id        VARCHAR(100) NOT NULL,
    event_type          VARCHAR(100) NOT NULL,
    event_version       INTEGER NOT NULL,
    payload             CLOB NOT NULL,
    headers             CLOB NULL,
    status              VARCHAR(30) NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    next_attempt_at     TIMESTAMP NULL,
    attempt_count       INTEGER NOT NULL,
    last_error_code     VARCHAR(100) NULL,
    last_error_message  VARCHAR(1000) NULL,
    published_at        TIMESTAMP NULL
);

CREATE INDEX idx_outbox_event_status_next_attempt
ON outbox_event(status, next_attempt_at);

CREATE INDEX idx_outbox_event_aggregate
ON outbox_event(aggregate_type, aggregate_id, created_at);
```

Status:

```text
NEW
PUBLISHING
PUBLISHED
FAILED_RETRYABLE
FAILED_FINAL
```

### 8.6 Outbox event harus membawa metadata reliability

Minimal:

```json
{
  "eventId": "uuid",
  "eventType": "ApplicationSubmitted",
  "eventVersion": 1,
  "aggregateType": "Application",
  "aggregateId": "APP-123",
  "aggregateVersion": 12,
  "occurredAt": "2026-06-16T10:15:30Z",
  "producer": "application-service",
  "correlationId": "corr-...",
  "causationId": "cmd-...",
  "idempotencyKey": "idem-...",
  "payload": {}
}
```

Field penting:

| Field | Tujuan |
|---|---|
| `eventId` | dedup event |
| `eventType` | semantic event |
| `eventVersion` | schema evolution |
| `aggregateId` | target entity |
| `aggregateVersion` | ordering/stale detection |
| `occurredAt` | timeline reconstruction |
| `correlationId` | trace end-to-end |
| `causationId` | event causality |
| `idempotencyKey` | retry-safe command relation |

### 8.7 Outbox relay harus lease-safe

Jika beberapa relay instance berjalan, jangan publish event sama tanpa kontrol.

Pattern:

```sql
UPDATE outbox_event
SET status = 'PUBLISHING', locked_by = ?, locked_until = ?
WHERE id = ?
  AND status IN ('NEW', 'FAILED_RETRYABLE')
  AND (locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP)
```

Kemudian publish.

Setelah sukses:

```sql
UPDATE outbox_event
SET status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP
WHERE id = ?
```

Jika publish gagal:

```sql
UPDATE outbox_event
SET status = 'FAILED_RETRYABLE',
    attempt_count = attempt_count + 1,
    next_attempt_at = ?,
    last_error_code = ?,
    last_error_message = ?
WHERE id = ?
```

### 8.8 Outbox anti-pattern

Anti-pattern:

```text
Save DB, then publish event directly in same method without durable event record.
```

Anti-pattern:

```text
Delete outbox row immediately after publish, losing auditability and retry evidence.
```

Anti-pattern:

```text
No event version.
```

Anti-pattern:

```text
No aggregate version, making out-of-order detection hard.
```

Anti-pattern:

```text
Outbox relay has infinite retry with no DLQ/manual review.
```

---

## 9. Inbox Pattern and Idempotent Consumer

### 9.1 Why inbox?

Consumer menerima message.

Karena broker bisa deliver duplicate, consumer butuh dedup.

Inbox menyimpan message yang sudah diproses.

### 9.2 Minimal inbox schema

```sql
CREATE TABLE inbox_message (
    message_id          VARCHAR(36) PRIMARY KEY,
    source_service      VARCHAR(100) NOT NULL,
    message_type        VARCHAR(100) NOT NULL,
    aggregate_type      VARCHAR(100) NULL,
    aggregate_id        VARCHAR(100) NULL,
    received_at         TIMESTAMP NOT NULL,
    processed_at        TIMESTAMP NULL,
    status              VARCHAR(30) NOT NULL,
    attempt_count       INTEGER NOT NULL,
    last_error_code     VARCHAR(100) NULL,
    last_error_message  VARCHAR(1000) NULL
);
```

### 9.3 Consumer flow

```text
receive message
begin transaction
  if inbox already processed:
      ack message
      return
  insert inbox row as PROCESSING
  apply domain change idempotently
  mark inbox PROCESSED
commit
ack message
```

### 9.4 Java-style pseudocode

```java
@Transactional
public void handle(ApplicationSubmittedEvent event) {
    if (inboxRepository.isProcessed(event.eventId())) {
        return;
    }

    inboxRepository.recordProcessing(
        event.eventId(),
        event.producer(),
        event.eventType(),
        event.aggregateId()
    );

    CaseFile caseFile = caseFileRepository
        .findByApplicationId(event.applicationId())
        .orElseGet(() -> CaseFile.openFor(event.applicationId()));

    caseFile.applySubmission(event.aggregateVersion(), event.occurredAt());

    caseFileRepository.save(caseFile);
    inboxRepository.markProcessed(event.eventId());
}
```

### 9.5 Dedup saja tidak cukup

Consumer harus menjawab beberapa pertanyaan:

- Apakah event ini duplicate?
- Apakah event ini stale?
- Apakah event ini out of order?
- Apakah aggregate version compatible?
- Apakah event type masih dikenal?
- Apakah payload schema version supported?
- Apakah domain state saat ini menerima event ini?

### 9.6 Handling stale event

Contoh:

```text
Current application version = 10
Event aggregateVersion = 7
```

Event lama.

Pilihan:

- ignore as stale;
- record as ignored;
- alert if unexpected;
- trigger reconciliation.

Jangan diam-diam apply.

### 9.7 Handling future event

Contoh:

```text
Current application version = 7
Event aggregateVersion = 10
```

Ada gap.

Pilihan:

- buffer;
- retry later;
- request snapshot;
- trigger reconciliation;
- dead-letter jika gap tidak terselesaikan.

---

## 10. Missing Events, Duplicate Events, and Reordered Events

### 10.1 Duplicate event

Penyebab:

- producer retry;
- outbox relay crash after publish;
- broker redelivery;
- consumer crash before ack;
- manual replay;
- DLQ reprocess.

Mitigation:

- event ID;
- inbox table;
- idempotent domain operation;
- unique constraints;
- idempotency keys.

### 10.2 Missing event

Penyebab:

- no outbox;
- relay stuck;
- event filtered incorrectly;
- schema error prevents publish;
- topic misconfiguration;
- consumer disabled;
- retention expired;
- DLQ ignored;
- deployment bug.

Mitigation:

- outbox lag metric;
- unpublished event alert;
- reconciliation job;
- replay capability;
- audit event store;
- producer-consumer contract tests;
- dead-letter monitoring.

### 10.3 Reordered event

Penyebab:

- multiple partitions;
- parallel consumers;
- retry delay;
- redelivery;
- multi-topic propagation;
- manual replay.

Mitigation:

- partition by aggregate ID;
- aggregate version;
- sequence number;
- monotonic transition guard;
- buffering with timeout;
- reconciliation.

### 10.4 Poison event

Poison event adalah event yang selalu gagal diproses.

Penyebab:

- invalid payload;
- unknown schema version;
- impossible domain transition;
- missing reference data;
- consumer bug;
- data corruption.

Handling:

```text
retry limited times
classify error
move to DLQ or FAILED_FINAL
alert
create repair task
support replay after fix
```

Jangan infinite retry poison event di main queue.

---

## 11. Consistency Models in Application Design

### 11.1 Strong consistency

Semua read setelah write melihat hasil terbaru.

Cocok untuk:

- local aggregate invariant;
- financial ledger internal posting;
- unique constraints;
- seat/slot reservation critical section;
- authorization decision critical data.

Trade-off:

- lower availability under partition;
- coordination cost;
- latency;
- contention.

### 11.2 Eventual consistency

Data antar component akan converge setelah beberapa waktu.

Cocok untuk:

- projections;
- search index;
- reporting;
- notification;
- cross-service workflow;
- analytics;
- status propagation.

Butuh:

- explicit pending state;
- retry;
- reconciliation;
- observability;
- user messaging yang jujur.

### 11.3 Read-your-writes consistency

User yang melakukan write melihat hasilnya sendiri meskipun projection umum belum update.

Implementasi:

- read from primary service after command;
- session token/version;
- local command result;
- temporary UI state;
- polling until projection catches up.

### 11.4 Monotonic reads

User tidak melihat state mundur.

Contoh buruk:

```text
User sees APPROVED
refresh
User sees PENDING
```

Mitigation:

- version-aware cache;
- projection version;
- avoid stale replica for critical read;
- client-side last-seen version;
- monotonic state transition rules.

### 11.5 Causal consistency

Jika B disebabkan A, observer tidak boleh melihat B tanpa A.

Contoh:

```text
PaymentCaptured visible before OrderCreated
```

Mitigation:

- causation ID;
- dependency event check;
- process manager;
- event buffering;
- snapshot fetch;
- aggregate versioning.

---

## 12. State Machine for Distributed Workflow

### 12.1 Why state machine?

Distributed process tanpa state machine akan tersebar dalam if-else, cron, retry, dan manual script.

State machine memberi:

- allowed transitions;
- rejected transitions;
- terminal states;
- retry states;
- compensation states;
- manual repair states;
- audit trail;
- operational visibility.

### 12.2 Example: application submission workflow

```text
DRAFT
  -> SUBMISSION_REQUESTED
  -> VALIDATING
  -> VALIDATION_FAILED
  -> PAYMENT_PENDING
  -> PAYMENT_CONFIRMED
  -> DOCUMENT_LOCKING
  -> SUBMISSION_COMPLETED
```

Failure path:

```text
PAYMENT_PENDING
  -> PAYMENT_FAILED_RETRYABLE
  -> PAYMENT_FAILED_FINAL
  -> SUBMISSION_FAILED
```

Compensation path:

```text
DOCUMENT_LOCKING_FAILED_AFTER_PAYMENT
  -> REFUND_REQUESTED
  -> REFUND_SUCCEEDED
  -> SUBMISSION_CANCELLED
```

Manual path:

```text
REFUND_FAILED_FINAL
  -> MANUAL_REVIEW_REQUIRED
  -> MANUAL_REFUND_CONFIRMED
  -> SUBMISSION_CANCELLED
```

### 12.3 Transition table

| Current State | Event/Command | Guard | Next State | Side Effect |
|---|---|---|---|---|
| DRAFT | SubmitRequested | valid owner | SUBMISSION_REQUESTED | create saga |
| SUBMISSION_REQUESTED | ValidationPassed | required fields complete | PAYMENT_PENDING | request payment |
| PAYMENT_PENDING | PaymentCaptured | provider ref unique | PAYMENT_CONFIRMED | publish payment confirmed |
| PAYMENT_PENDING | PaymentFailed | final failure | SUBMISSION_FAILED | notify user |
| PAYMENT_CONFIRMED | DocumentLockFailed | payment captured | REFUND_REQUESTED | request refund |
| REFUND_REQUESTED | RefundSucceeded | refund id unique | SUBMISSION_CANCELLED | audit cancellation |
| REFUND_REQUESTED | RefundFailedFinal | attempts exhausted | MANUAL_REVIEW_REQUIRED | create ops task |

### 12.4 Guard matters

Transition harus punya guard.

Contoh:

```java
public void markPaymentConfirmed(PaymentCaptured event) {
    if (status != SubmissionStatus.PAYMENT_PENDING) {
        throw new InvalidStateTransitionException(
            status,
            "PaymentCaptured",
            SubmissionStatus.PAYMENT_CONFIRMED
        );
    }

    if (!event.applicationId().equals(this.applicationId)) {
        throw new InvariantViolationException("Payment event belongs to another application");
    }

    this.status = SubmissionStatus.PAYMENT_CONFIRMED;
    this.paymentReference = event.paymentReference();
}
```

Jangan apply event hanya karena ID ditemukan.

Pastikan transition semantically valid.

---

## 13. Forward Recovery vs Backward Recovery

### 13.1 Backward recovery

Backward recovery mencoba membatalkan efek sebelumnya.

Contoh:

- refund payment;
- release reservation;
- cancel booking;
- void generated certificate.

Cocok jika:

- efek bisa dibatalkan;
- cost pembatalan acceptable;
- final state cancellation lebih benar.

### 13.2 Forward recovery

Forward recovery mencoba menyelesaikan proses ke depan meskipun ada kegagalan sementara.

Contoh:

- retry external notification;
- rebuild search projection;
- re-send event;
- complete missing downstream sync;
- manually verify provider outcome then mark success.

Cocok jika:

- step sebelumnya valid;
- compensation lebih berisiko;
- failure hanya di propagation/sync;
- business outcome tetap seharusnya sukses.

### 13.3 Decision matrix

| Situation | Better Strategy |
|---|---|
| Payment captured, notification failed | Forward recovery |
| Payment captured, document issuance impossible | Compensation or manual review |
| Stock reserved, payment failed | Backward recovery |
| Licence issued, audit write delayed | Forward recovery + audit repair |
| External agency sync failed after legal decision | Forward recovery/manual sync |
| Duplicate event received | Idempotent no-op |
| Unknown provider outcome | Reconciliation before retry/compensation |

### 13.4 Dangerous mistake

Jangan otomatis compensate hanya karena downstream timeout.

Timeout outcome unknown.

Flow lebih aman:

```text
timeout
mark outcome UNKNOWN
query provider / reconcile
if confirmed success -> continue forward
if confirmed failure -> retry or compensate
if still unknown -> manual review / delayed reconciliation
```

---

## 14. Unknown Outcome Handling

### 14.1 Unknown is a valid state

Sistem sering salah karena hanya mengenal:

```text
SUCCESS
FAILED
```

Padahal distributed system butuh:

```text
SUCCESS
FAILED_RETRYABLE
FAILED_FINAL
UNKNOWN
PENDING_CONFIRMATION
MANUAL_REVIEW_REQUIRED
```

### 14.2 Example: payment timeout

```text
Submit payment capture
HTTP timeout
```

Kemungkinan:

- payment not received;
- payment received but not processed;
- payment captured;
- payment failed;
- response lost.

Jangan retry capture tanpa idempotency key.

Jangan refund tanpa tahu capture berhasil.

Jangan mark failed final tanpa reconciliation.

### 14.3 Unknown outcome state machine

```text
PAYMENT_CAPTURE_REQUESTED
  -> PAYMENT_CAPTURE_SUCCEEDED
  -> PAYMENT_CAPTURE_FAILED_RETRYABLE
  -> PAYMENT_CAPTURE_FAILED_FINAL
  -> PAYMENT_CAPTURE_UNKNOWN

PAYMENT_CAPTURE_UNKNOWN
  -> RECONCILIATION_PENDING
  -> PAYMENT_CAPTURE_SUCCEEDED
  -> PAYMENT_CAPTURE_FAILED_FINAL
  -> MANUAL_REVIEW_REQUIRED
```

### 14.4 Unknown outcome should alert based on age/severity

Tidak semua unknown perlu immediate page.

Tapi unknown tidak boleh hilang.

Metrics:

```text
unknown_outcome_total
unknown_outcome_age_seconds
unknown_outcome_by_provider
unknown_outcome_by_operation
reconciliation_success_total
reconciliation_failed_total
manual_review_required_total
```

Alert:

```text
unknown_outcome_age_seconds > threshold for critical operation
```

---

## 15. Reconciliation Design

### 15.1 Purpose

Reconciliation menjawab:

```text
What does each system believe happened?
Which belief is authoritative?
What action is needed to converge?
```

### 15.2 Source of truth is not always one system

Untuk beberapa data:

| Data | Source of Truth |
|---|---|
| Application domain status | Application service |
| Payment provider transaction status | Payment provider |
| Local payment record | Payment service |
| Search projection | Search index consumer |
| Audit evidence | Audit service/store |
| Notification delivery | Notification provider/system |

Reconciliation harus tahu authority per field/process.

### 15.3 Reconciliation flow

```text
select candidates
fetch local state
fetch remote/provider/downstream state
compare
classify mismatch
apply safe repair or create manual task
record reconciliation result
emit metrics/audit
```

### 15.4 Candidate selection

Candidates:

- old pending records;
- unknown outcome records;
- outbox events stuck;
- inbox failed records;
- DLQ messages;
- mismatch status;
- external callback not received;
- process exceeded SLA;
- records updated during incident window.

### 15.5 Reconciliation classification

| Mismatch | Classification | Action |
|---|---|---|
| Local pending, provider success | propagation delay or callback lost | mark success + continue workflow |
| Local success, provider failed | local false success | manual review or reverse local state |
| Local failed, provider success | dangerous mismatch | reconcile + possible compensation |
| Outbox unpublished old event | relay failure | publish/retry |
| Consumer projection missing | downstream lag/failure | replay event |
| Duplicate downstream record | idempotency defect | merge/repair/manual |
| Unknown schema event | compatibility defect | DLQ + fix consumer |

### 15.6 Reconciliation must be auditable

Every reconciliation action should record:

- what was compared;
- local value;
- remote value;
- authority decision;
- action taken;
- actor/system;
- timestamp;
- correlation ID;
- confidence;
- manual approval if any.

Example:

```json
{
  "reconciliationId": "rec-001",
  "entityType": "Payment",
  "entityId": "PAY-123",
  "localStatus": "UNKNOWN",
  "providerStatus": "CAPTURED",
  "decision": "MARK_LOCAL_CAPTURED",
  "authority": "PAYMENT_PROVIDER",
  "action": "CONTINUE_SUBMISSION_WORKFLOW",
  "confidence": "HIGH",
  "createdAt": "2026-06-16T10:00:00Z"
}
```

### 15.7 Automatic vs manual reconciliation

Automatic reconciliation cocok jika:

- mismatch classification deterministic;
- authority jelas;
- correction idempotent;
- risk rendah;
- audit cukup;
- rollback/repair path jelas.

Manual reconciliation diperlukan jika:

- legal/business impact besar;
- authority tidak jelas;
- data conflicting;
- compensation irreversible;
- user/customer impact tinggi;
- fraud/security concern;
- policy membutuhkan approval.

---

## 16. Repair Workflow

### 16.1 Repair is a first-class feature

Banyak sistem punya repair script tetapi tidak punya repair model.

Engineer top-tier mendesain repair sebagai fitur internal yang aman.

Repair harus:

- authenticated;
- authorized;
- audited;
- idempotent;
- validated;
- reversible jika memungkinkan;
- explainable;
- linked to incident/ticket;
- constrained by state machine;
- tested.

### 16.2 Repair command example

```java
public record RepairSubmissionStateCommand(
    String submissionId,
    SubmissionStatus expectedCurrentStatus,
    SubmissionStatus targetStatus,
    String reasonCode,
    String incidentId,
    String operatorId,
    String evidenceReference
) {}
```

### 16.3 Repair handler

```java
@Transactional
public void repairSubmissionState(RepairSubmissionStateCommand command) {
    SubmissionProcess process = repository.findByIdForUpdate(command.submissionId())
        .orElseThrow(() -> new SubmissionNotFoundException(command.submissionId()));

    if (process.status() != command.expectedCurrentStatus()) {
        throw new RepairPreconditionFailedException(
            process.status(),
            command.expectedCurrentStatus()
        );
    }

    if (!repairPolicy.isAllowed(process.status(), command.targetStatus(), command.reasonCode())) {
        throw new RepairNotAllowedException(process.status(), command.targetStatus());
    }

    process.repairTo(
        command.targetStatus(),
        command.reasonCode(),
        command.incidentId(),
        command.operatorId(),
        command.evidenceReference()
    );

    repository.save(process);
    outbox.save(DomainEvent.submissionRepaired(process));
}
```

### 16.4 Why expected current status matters

Repair command harus membawa expected current status untuk mencegah lost update.

Tanpa itu:

```text
Operator sees status UNKNOWN
System reconciles to SUCCESS
Operator repair command changes to FAILED
```

Dengan expected status, command gagal jika state sudah berubah.

### 16.5 Manual DB update is last resort

Manual DB update mungkin perlu dalam emergency, tetapi harus diperlakukan sebagai break-glass operation.

Minimum control:

- backup/snapshot;
- peer review;
- dry run select;
- transaction script;
- rollback script jika mungkin;
- audit ticket;
- post-action verification;
- postmortem;
- convert into safe repair feature if repeated.

---

## 17. Designing Event Contracts for Consistency

### 17.1 Event name harus meaningful

Bad:

```text
ApplicationUpdated
StatusChanged
DataSynced
ProcessCompleted
```

Better:

```text
ApplicationSubmitted
ApplicationSubmissionFailed
PaymentCaptureRequested
PaymentCaptured
PaymentCaptureOutcomeUnknown
LicenceIssued
LicenceVoided
ExternalAgencySyncFailed
```

### 17.2 Event should represent fact, not command

Event:

```text
PaymentCaptured
```

Command:

```text
CapturePayment
```

Jangan campur.

Event adalah fakta yang sudah terjadi.

Command adalah permintaan untuk melakukan sesuatu.

### 17.3 Event schema should include transition

Untuk workflow event, sertakan:

```json
{
  "previousStatus": "PAYMENT_PENDING",
  "newStatus": "PAYMENT_CONFIRMED",
  "transitionReason": "PROVIDER_CAPTURE_CONFIRMED"
}
```

Ini membantu consumer melakukan guard.

### 17.4 Event versioning

Event contract berubah.

Butuh:

- `eventVersion`;
- backward-compatible schema;
- consumer tolerance;
- contract tests;
- migration strategy;
- DLQ for unsupported version;
- replay plan.

### 17.5 Causation chain

Untuk reconstruct workflow:

```text
Command SubmitApplication
  caused ApplicationSubmissionRequested
    caused PaymentCaptureRequested
      caused PaymentCaptured
        caused ApplicationSubmitted
```

Simpan:

- correlation ID;
- causation ID;
- command ID;
- saga ID;
- aggregate ID;
- aggregate version.

---

## 18. Distributed Failure Scenarios

### 18.1 Scenario A: DB commit succeeded, event not published

Flow:

```text
Application status changed to SUBMITTED
Process crashed before publish ApplicationSubmitted
```

Impact:

- downstream does not create case;
- notification not sent;
- reporting missing;
- user sees submitted locally but other modules don't.

Mitigation:

- transactional outbox;
- outbox relay;
- outbox lag alert;
- reconciliation for submitted without event published.

### 18.2 Scenario B: Event published twice

Flow:

```text
Outbox relay publishes event
Crash before marking PUBLISHED
Restart publishes again
```

Impact:

- duplicate case created;
- duplicate notification;
- double charge if consumer bad.

Mitigation:

- inbox dedup;
- idempotent consumer;
- unique constraint;
- semantic idempotency key.

### 18.3 Scenario C: Payment timeout, retry without idempotency

Flow:

```text
Capture payment request times out
Caller retries with new request
Provider captures twice
```

Impact:

- double charge;
- refund needed;
- customer impact;
- incident.

Mitigation:

- idempotency key;
- unknown outcome state;
- provider reconciliation;
- retry only with same idempotency key.

### 18.4 Scenario D: Compensation failed

Flow:

```text
Stock reserved
Payment failed
Release stock API down
```

Impact:

- stock remains locked;
- customer cannot buy;
- inventory mismatch.

Mitigation:

- compensation state machine;
- retry with backoff;
- reconciliation;
- manual release workflow;
- reservation expiry.

### 18.5 Scenario E: Event out of order

Flow:

```text
PaymentCaptured arrives before PaymentRequested projection
```

Impact:

- consumer rejects event;
- projection missing captured payment;
- process stuck.

Mitigation:

- aggregate version;
- buffering;
- partition key;
- process manager;
- reconciliation.

### 18.6 Scenario F: Human action races with automated recovery

Flow:

```text
Operator manually marks case failed
Reconciliation job later marks it success from provider
```

Impact:

- contradictory state;
- audit inconsistency;
- user confusion.

Mitigation:

- repair expected-state precondition;
- state version;
- lock/manual hold state;
- operational ownership rules;
- reconciliation respects manual override states.

---

## 19. Java/Spring Implementation Model

### 19.1 Domain state transition should be inside aggregate

```java
public final class SubmissionProcess {
    private SubmissionStatus status;
    private long version;

    public void paymentCaptured(PaymentReference reference) {
        requireStatus(SubmissionStatus.PAYMENT_PENDING);
        this.status = SubmissionStatus.PAYMENT_CONFIRMED;
        this.version++;
        registerEvent(new PaymentConfirmedEvent(id, version, reference));
    }

    public void paymentOutcomeUnknown(String providerRequestId) {
        requireStatus(SubmissionStatus.PAYMENT_PENDING);
        this.status = SubmissionStatus.PAYMENT_OUTCOME_UNKNOWN;
        this.version++;
        registerEvent(new PaymentOutcomeUnknownEvent(id, version, providerRequestId));
    }

    private void requireStatus(SubmissionStatus expected) {
        if (this.status != expected) {
            throw new InvalidStateTransitionException(this.status, expected);
        }
    }
}
```

### 19.2 Transactional application service writes aggregate + outbox

```java
@Transactional
public void handlePaymentCaptured(PaymentCapturedCommand command) {
    SubmissionProcess process = repository.findByIdForUpdate(command.submissionId())
        .orElseThrow(() -> new SubmissionNotFoundException(command.submissionId()));

    process.paymentCaptured(command.paymentReference());

    repository.save(process);

    for (DomainEvent event : process.pullEvents()) {
        outboxRepository.save(OutboxEvent.from(event));
    }
}
```

### 19.3 Outbox relay

```java
public void publishBatch() {
    List<OutboxEvent> events = outboxRepository.claimNextBatch(workerId, batchSize, leaseUntil);

    for (OutboxEvent event : events) {
        try {
            broker.publish(event.topic(), event.key(), event.payload(), event.headers());
            outboxRepository.markPublished(event.id());
        } catch (TransientPublishException ex) {
            outboxRepository.markRetryableFailure(event.id(), retryPolicy.nextAttempt(event), ex);
        } catch (NonRetryablePublishException ex) {
            outboxRepository.markFinalFailure(event.id(), ex);
        }
    }
}
```

### 19.4 Consumer with inbox

```java
@Transactional
public void onMessage(EventEnvelope envelope) {
    if (inboxRepository.isProcessed(envelope.eventId())) {
        return;
    }

    inboxRepository.recordReceived(envelope);

    switch (envelope.eventType()) {
        case "PaymentCaptured" -> handlePaymentCaptured(envelope.to(PaymentCapturedEvent.class));
        case "PaymentFailed" -> handlePaymentFailed(envelope.to(PaymentFailedEvent.class));
        default -> throw new UnsupportedEventTypeException(envelope.eventType());
    }

    inboxRepository.markProcessed(envelope.eventId());
}
```

### 19.5 Important transaction boundary

Acknowledge broker message only after DB commit.

Conceptual flow:

```text
receive broker message
begin DB transaction
process domain change
insert inbox processed
commit DB transaction
ack broker message
```

If crash before ack, message may redeliver.

Inbox protects duplicate processing.

---

## 20. Observability for Distributed Consistency

### 20.1 Metrics

Essential metrics:

```text
outbox_unpublished_total
outbox_oldest_unpublished_age_seconds
outbox_publish_failure_total
outbox_publish_attempt_total
inbox_processing_failure_total
inbox_duplicate_message_total
saga_in_progress_total
saga_stuck_total
saga_compensation_started_total
saga_compensation_failed_total
reconciliation_candidate_total
reconciliation_success_total
reconciliation_failed_total
dlq_message_total
dlq_oldest_age_seconds
unknown_outcome_total
manual_repair_required_total
manual_repair_completed_total
```

### 20.2 Logs

Logs must include:

- correlation ID;
- saga ID;
- aggregate ID;
- aggregate version;
- event ID;
- message ID;
- idempotency key;
- transition from/to;
- retry attempt;
- compensation ID;
- reconciliation ID.

### 20.3 Traces

Trace should show:

```text
API command
  DB transaction
  outbox insert
  outbox relay publish
  broker delivery
  consumer inbox
  downstream state transition
```

Async tracing is harder but crucial.

### 20.4 Dashboards

Recommended dashboard sections:

1. Saga health.
2. Outbox health.
3. Inbox/consumer health.
4. DLQ health.
5. Unknown outcome health.
6. Reconciliation health.
7. Manual repair backlog.
8. Oldest stuck process by type.

---

## 21. Operational Runbook

### 21.1 Outbox stuck

Symptoms:

```text
outbox_oldest_unpublished_age_seconds high
outbox_unpublished_total increasing
```

Checks:

- relay running?
- DB lock issue?
- broker reachable?
- schema serialization error?
- poison event?
- lease stuck?

Actions:

- restart relay if safe;
- release expired lease;
- inspect failed events;
- move non-retryable to failed final;
- replay after fix;
- alert downstream if lag affects SLA.

### 21.2 DLQ growing

Checks:

- common event type?
- common schema version?
- common aggregate state?
- deployment regression?
- reference data missing?
- downstream dependency down?

Actions:

- classify retryable/non-retryable;
- fix consumer bug;
- deploy compatibility patch;
- replay DLQ in controlled batch;
- monitor duplicate handling.

### 21.3 Saga stuck

Checks:

- current state;
- last transition time;
- pending side effect;
- retry count;
- external provider status;
- compensation state;
- manual hold flag.

Actions:

- retry safe step;
- reconcile provider;
- initiate compensation;
- escalate manual review;
- repair state with approval.

### 21.4 Unknown payment outcome

Checks:

- provider request ID;
- idempotency key;
- provider transaction lookup;
- callback logs;
- local DB state;
- user-visible state.

Actions:

- query provider;
- mark success if captured;
- mark failed if definitively rejected;
- keep pending if provider still processing;
- manual review if provider response ambiguous.

---

## 22. Anti-Patterns

### 22.1 Distributed transaction thinking without distributed transaction mechanism

Bad:

```text
Call service A
Call service B
Call service C
If C fails, assume A and B can be rolled back easily
```

Reality:

A and B might already committed irreversible effects.

### 22.2 Fire-and-forget event without durability

Bad:

```java
repository.save(entity);
eventPublisher.publish(event);
```

without outbox.

### 22.3 Compensation without state

Bad:

```java
try {
    compensate();
} catch (Exception ignored) {
}
```

This creates hidden inconsistency.

### 22.4 Treating timeout as failure final

Bad:

```text
payment timeout -> mark payment failed -> retry with new request
```

Could cause double capture or false failure.

### 22.5 No manual repair path

Bad assumption:

```text
Everything can be auto-recovered.
```

Real systems need controlled manual recovery.

### 22.6 No reconciliation

Bad:

```text
If event-driven, everything eventually works.
```

No, events can be missing, stuck, duplicated, or rejected.

### 22.7 Overusing saga for simple local invariant

If everything is in one aggregate/database transaction, do not turn it into distributed workflow unnecessarily.

### 22.8 Choreography chaos

Bad:

```text
20 services subscribe to each other's events with no process owner.
```

Result:

- invisible workflow;
- hard debugging;
- event cycles;
- unclear compensation;
- unclear SLA.

### 22.9 Orchestrator god service

Bad:

```text
Orchestrator owns all domain rules and all data.
```

Orchestrator should coordinate process, not absorb every domain responsibility.

### 22.10 Event as database row replication

Bad:

```json
{
  "table": "application",
  "operation": "UPDATE",
  "columns": {}
}
```

for business event integration.

Better:

```text
ApplicationSubmitted
ApplicationSubmissionCancelled
PaymentCaptured
LicenceIssued
```

---

## 23. Design Checklist

### 23.1 Business process checklist

- [ ] Is the operation local or distributed?
- [ ] What are the local transaction boundaries?
- [ ] What are the business transaction boundaries?
- [ ] What intermediate states exist?
- [ ] Are intermediate states explicit?
- [ ] Which states are terminal?
- [ ] Which states are retryable?
- [ ] Which states require compensation?
- [ ] Which states require manual review?
- [ ] Is unknown outcome modeled?

### 23.2 Saga checklist

- [ ] Is saga actually needed?
- [ ] Choreography, orchestration, or hybrid?
- [ ] Who owns process state?
- [ ] Is there a saga ID?
- [ ] Are steps idempotent?
- [ ] Are compensations idempotent?
- [ ] Are timeouts explicit?
- [ ] Are retries bounded?
- [ ] Is stuck saga detectable?
- [ ] Is manual repair supported?

### 23.3 Event checklist

- [ ] Does event represent a fact?
- [ ] Is event name domain-specific?
- [ ] Does event have event ID?
- [ ] Does event have aggregate ID?
- [ ] Does event have aggregate version?
- [ ] Does event have schema version?
- [ ] Does event have correlation ID?
- [ ] Does event have causation ID?
- [ ] Can consumer detect duplicate?
- [ ] Can consumer detect stale/out-of-order event?

### 23.4 Outbox checklist

- [ ] Is event persisted in same transaction as aggregate change?
- [ ] Does relay have lease/claim mechanism?
- [ ] Is publish retry bounded/backoff?
- [ ] Is oldest unpublished event monitored?
- [ ] Is failed final state visible?
- [ ] Can events be replayed safely?
- [ ] Are consumers idempotent?

### 23.5 Inbox checklist

- [ ] Is message ID stored?
- [ ] Is processing status tracked?
- [ ] Is domain change and inbox processed marker in same transaction?
- [ ] Is ack after commit?
- [ ] Are duplicates no-op?
- [ ] Are poison messages classified?
- [ ] Is DLQ monitored?

### 23.6 Compensation checklist

- [ ] Is compensation business-valid?
- [ ] Is compensation idempotent?
- [ ] Does compensation have its own state?
- [ ] What if compensation fails?
- [ ] What if compensation outcome is unknown?
- [ ] Does compensation require approval?
- [ ] Is correction visible to audit/user/operator?

### 23.7 Reconciliation checklist

- [ ] What mismatches can happen?
- [ ] What is source of truth per field/process?
- [ ] What candidates are scanned?
- [ ] How often reconciliation runs?
- [ ] Is reconciliation action audited?
- [ ] Which actions are automatic?
- [ ] Which actions require manual review?
- [ ] Is reconciliation idempotent?

---

## 24. Example: Regulatory Application Submission

### 24.1 Scenario

User submits application.

Steps:

1. Validate application.
2. Lock submitted data.
3. Capture payment.
4. Create case file.
5. Generate audit trail.
6. Notify applicant.
7. Notify downstream agency.

### 24.2 Bad design

```text
Controller calls all services synchronously.
If any fails, return 500.
Some side effects may already happen.
No process state.
No reconciliation.
No outbox.
Manual DB repair when stuck.
```

Problems:

- payment may be captured but application remains draft;
- notification may be sent despite failed case creation;
- audit missing;
- retry may duplicate payment/case;
- user sees ambiguous result;
- operator cannot tell actual outcome.

### 24.3 Better design

Local transaction:

```text
application.status = SUBMISSION_REQUESTED
submission_process.status = VALIDATION_PENDING
outbox event = SubmissionRequested
commit
```

Process manager:

```text
SubmissionRequested
  -> validate
  -> lock data
  -> capture payment using idempotency key
  -> create case file idempotently
  -> mark submitted
  -> emit ApplicationSubmitted
  -> notify asynchronously
```

Failure handling:

```text
Payment timeout -> PAYMENT_OUTCOME_UNKNOWN -> reconciliation
Case creation duplicate -> idempotent success
Notification failure -> retry/degraded, not rollback submission
Downstream agency sync failure -> SYNC_PENDING + reconciliation/manual task
```

### 24.4 Final states

```text
SUBMISSION_COMPLETED
SUBMISSION_FAILED_VALIDATION
SUBMISSION_FAILED_PAYMENT
SUBMISSION_CANCELLED_REFUNDED
SUBMISSION_REQUIRES_MANUAL_REVIEW
SUBMISSION_SYNC_PENDING
```

### 24.5 Why this is better

Because every important outcome is represented.

No hidden partial success.

No ambiguous timeout.

No duplicate side effect without guard.

No silent missing event.

No manual repair without audit.

---

## 25. Review Questions

1. Apa perbedaan local transaction, distributed transaction, dan business transaction?
2. Mengapa saga bukan pengganti ACID transaction?
3. Apa perbedaan compensation dan rollback?
4. Mengapa compensation harus idempotent?
5. Mengapa timeout harus menghasilkan `UNKNOWN` dalam beberapa kasus?
6. Apa failure window yang diselesaikan oleh transactional outbox?
7. Mengapa outbox tetap membutuhkan idempotent consumer?
8. Apa fungsi inbox pattern?
9. Bagaimana mendeteksi event duplicate, stale, dan out-of-order?
10. Kapan lebih baik forward recovery daripada compensation?
11. Apa yang harus dicatat dalam reconciliation audit?
12. Mengapa manual repair harus menjadi first-class workflow?
13. Apa risiko choreography saga tanpa process owner?
14. Apa risiko orchestrator menjadi god service?
15. Bagaimana menentukan source of truth dalam reconciliation?

---

## 26. Key Takeaways

1. Distributed consistency adalah masalah state management, bukan hanya database problem.
2. Local ACID transaction tetap penting, tetapi scope-nya terbatas.
3. Business process lintas service harus dimodelkan sebagai explicit workflow.
4. Saga adalah sequence local transactions plus compensation/recovery logic.
5. Compensation bukan rollback; compensation adalah business correction.
6. Compensation bisa gagal, sehingga perlu state, retry, observability, dan manual path.
7. Timeout tidak selalu berarti gagal; sering kali berarti outcome unknown.
8. Unknown outcome harus dimodelkan sebagai state eksplisit.
9. Transactional outbox menghilangkan gap antara DB commit dan event publish intent.
10. Outbox tetap bisa publish duplicate, sehingga consumer harus idempotent.
11. Inbox membantu consumer dedup dan menjaga processing evidence.
12. Event harus membawa ID, version, aggregate version, correlation, dan causation.
13. Reconciliation adalah safety net wajib untuk distributed consistency.
14. Repair workflow harus aman, audited, authorized, dan constrained by state machine.
15. Sistem distributed yang reliable tidak menghindari inconsistency sepenuhnya; ia mendeteksi, membatasi, dan memperbaikinya secara eksplisit.

---

## 27. Referensi

- Microservices.io — Saga Pattern: https://microservices.io/patterns/data/saga.html
- Microservices.io — Transactional Outbox Pattern: https://microservices.io/patterns/data/transactional-outbox.html
- Microservices.io — Idempotent Consumer Pattern: https://microservices.io/patterns/communication-style/idempotent-consumer.html
- AWS Prescriptive Guidance — Saga Patterns: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga.html
- AWS Prescriptive Guidance — Saga Pattern for distributed transactions: https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/saga-pattern.html
- Azure Architecture Center — Compensating Transaction Pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction
- Azure Architecture Center — Saga Pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/saga
- Martin Fowler — Patterns of Distributed Systems: https://martinfowler.com/articles/patterns-of-distributed-systems/

---

## 28. Status Seri

```text
Part 022 / 030 completed
Seri belum selesai.
```

Part berikutnya:

```text
Part 023 — Observability for Errors and Reliability
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 021 — Data Reliability and Persistence Failure](./learn-java-reliability-part-021.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 023 — Observability for Errors and Reliability](./learn-java-reliability-part-023.md)

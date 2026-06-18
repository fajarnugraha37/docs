# learn-java-reliability-part-014.md

# Part 014 — Transaction Safety During Failure and Shutdown

> Seri: Graceful Shutdown, Error Handling, Exceptions, and Reliability untuk Java Engineer  
> Status: Part 014 dari 030  
> Fokus: transaction safety, failure window, commit uncertainty, rollback semantics, side effects, outbox, idempotency, dan shutdown-safe transactional design

---

## 0. Executive Summary

Di part sebelumnya kita sudah membahas graceful shutdown untuk HTTP request, scheduler, queue consumer, dan background worker. Tetapi ada satu masalah yang lebih dalam:

> Apa yang terjadi kalau sistem berhenti, timeout, crash, atau exception muncul **di tengah transaksi**?

Banyak engineer terlalu cepat berpikir:

> "Tenang, kan ada transaction. Kalau error, rollback."

Itu separuh benar dan separuh berbahaya.

Transaction memang memberi atomicity untuk resource tertentu, biasanya database lokal. Tetapi production system jarang hanya berisi satu operasi database. Biasanya satu request atau satu message processing dapat melibatkan:

- validasi state;
- update database;
- insert audit trail;
- publish event;
- call external API;
- kirim email;
- update cache;
- upload file;
- acquire/release distributed lock;
- acknowledge message;
- return response ke client.

Masalahnya: tidak semua operasi itu berada dalam satu transaction boundary yang sama. Bahkan ketika database transaction benar, failure bisa terjadi pada area abu-abu:

- database commit berhasil, tapi response ke client gagal;
- database commit berhasil, tapi message broker publish gagal;
- external API berhasil, tapi database rollback;
- message sudah di-ack, tapi database commit gagal;
- shutdown terjadi setelah side effect pertama tetapi sebelum checkpoint;
- timeout terjadi, tetapi server sebenarnya masih memproses;
- exception tertangkap, tetapi transaction sudah ditandai rollback-only;
- nested transaction tidak bekerja seperti yang dibayangkan;
- retry menjalankan command yang sebenarnya sudah berhasil sebagian.

Mental model utama part ini:

> Transaction safety bukan hanya memastikan `rollback()` dipanggil saat exception. Transaction safety adalah kemampuan sistem untuk mengetahui, membatasi, dan memulihkan state ketika failure terjadi pada setiap titik antara intent, mutation, commit, side effect, acknowledgement, dan response.

---

## 1. Core Problem

### 1.1 Masalah yang sering disederhanakan

Dalam aplikasi Java/Spring, kita sering menulis kode seperti ini:

```java
@Transactional
public void approveApplication(UUID applicationId) {
    Application app = applicationRepository.findById(applicationId)
            .orElseThrow(() -> new ApplicationNotFoundException(applicationId));

    app.approve();
    applicationRepository.save(app);

    emailClient.sendApprovalEmail(app.getApplicantEmail());
}
```

Sekilas terlihat rapi. Tetapi secara reliability, kode ini menyimpan banyak pertanyaan:

1. Kalau `emailClient.sendApprovalEmail` gagal, apakah update database rollback?
2. Kalau email berhasil terkirim lalu database commit gagal, apa yang terjadi?
3. Kalau method return sukses tetapi response HTTP gagal dikirim ke client, apakah client akan retry?
4. Kalau client retry, apakah approval akan diproses dua kali?
5. Kalau pod menerima SIGTERM saat email sedang dikirim, apakah transaction masih hidup?
6. Kalau database commit berhasil tetapi aplikasi mati sebelum log/audit/event dibuat, apakah sistem bisa direkonstruksi?
7. Kalau exception ditangkap di dalam method, apakah transaction tetap commit?
8. Kalau nested method menandai rollback-only, apakah outer method tahu?

Pertanyaan-pertanyaan ini adalah inti transaction safety.

---

### 1.2 Transaction tidak sama dengan business operation

Satu kekeliruan besar:

> Menganggap satu business operation otomatis sama dengan satu database transaction.

Padahal business operation sering terdiri dari banyak fase:

```text
Receive command
  -> validate input
  -> load state
  -> check invariant
  -> mutate aggregate
  -> persist mutation
  -> commit transaction
  -> emit event
  -> update cache
  -> return response
  -> external observers react
```

Database transaction hanya melindungi sebagian dari rangkaian itu.

Lebih tepatnya:

```text
Business operation
├── pre-transaction work
├── database transaction
│   ├── read current state
│   ├── validate state-dependent invariant
│   ├── write mutation
│   ├── write audit/outbox/idempotency record
│   └── commit / rollback
├── post-transaction side effects
├── client response
└── async follow-up work
```

Kalau desain tidak eksplisit membedakan fase ini, failure handling akan kacau.

---

## 2. Mental Model: Failure Window

### 2.1 Apa itu failure window?

Failure window adalah rentang waktu di mana failure dapat terjadi dan menghasilkan outcome berbeda.

Contoh sederhana:

```text
T0 receive request
T1 validate request
T2 begin transaction
T3 update database
T4 commit database
T5 send response
```

Failure pada T1 berbeda dengan failure pada T3, T4, atau T5.

| Failure point | Kemungkinan efek | Risiko utama |
|---|---:|---|
| Before begin transaction | Belum ada mutation | Aman retry |
| After begin, before write | Biasanya belum ada mutation | Aman rollback |
| After write, before commit | Mutation visible hanya dalam transaction | Rollback bisa membersihkan |
| During commit | Outcome bisa tidak pasti bagi aplikasi | Commit uncertainty |
| After commit, before response | State sudah berubah, client belum tentu tahu | Duplicate retry |
| After response | Operation dianggap selesai | Async side effect bisa tertinggal |

Top-tier engineer tidak hanya bertanya:

> "Apakah transaction rollback?"

Tapi bertanya:

> "Pada titik failure ini, state mana yang sudah berubah, siapa yang sudah melihatnya, dan apakah retry akan aman?"

---

### 2.2 Failure window harus dianalisis sebagai state transition

Misalnya approval application:

```text
DRAFT -> SUBMITTED -> APPROVED -> NOTIFIED
```

Jika approval dan notification dicampur dalam satu method tanpa state eksplisit, sistem sulit membedakan:

```text
APPROVED but not notified
APPROVED and notified
NOTIFICATION attempted but failed
UNKNOWN whether notification sent
```

Desain yang lebih reliable membuat state antara terlihat:

```text
SUBMITTED
  -> APPROVAL_COMMITTED
  -> NOTIFICATION_PENDING
  -> NOTIFICATION_SENT
  -> NOTIFICATION_FAILED_RETRYABLE
  -> NOTIFICATION_FAILED_FINAL
```

Atau menggunakan outbox:

```text
Application.status = APPROVED
Outbox(event=ApplicationApproved, status=PENDING)
```

Dengan begitu, kalau aplikasi mati setelah commit, event tetap bisa dikirim oleh worker lain.

---

## 3. ACID: Berguna, Tapi Jangan Disalahpahami

ACID sering disebut, tetapi sering tidak dihubungkan dengan failure design.

### 3.1 Atomicity

Atomicity berarti operasi dalam transaction berhasil semua atau gagal semua **di dalam resource yang sama**.

Contoh:

```sql
BEGIN;
UPDATE application SET status = 'APPROVED' WHERE id = ?;
INSERT INTO audit_trail (...);
COMMIT;
```

Kalau transaction rollback sebelum commit, dua perubahan itu tidak permanen.

Tetapi atomicity database tidak mencakup:

- email yang sudah terkirim;
- HTTP call yang sudah diterima external system;
- message broker publish di luar transaction;
- file yang sudah di-upload;
- cache yang sudah di-update;
- log yang sudah ditulis;
- client yang sudah menerima response.

Jadi kalimat yang benar:

> Database transaction memberi atomicity untuk mutation dalam database transaction itu, bukan untuk seluruh business operation lintas resource.

---

### 3.2 Consistency

Consistency dalam ACID berarti transaction membawa database dari satu state valid ke state valid lain sesuai constraint.

Tetapi database constraint tidak selalu cukup untuk business consistency.

Contoh:

```sql
CHECK (amount >= 0)
UNIQUE (application_no)
FOREIGN KEY (case_id)
```

Constraint ini penting, tetapi tidak otomatis menjamin:

- application hanya bisa approved setelah required documents complete;
- officer tidak boleh approve own case;
- appeal tidak boleh created setelah deadline;
- state transition harus mengikuti workflow;
- audit trail harus mencatat actor dan reason.

Business consistency perlu dijaga oleh kombinasi:

- domain invariant;
- database constraint;
- optimistic locking;
- state machine guard;
- audit requirement;
- idempotency rule;
- compensation/reconciliation.

---

### 3.3 Isolation

Isolation menentukan bagaimana transaksi concurrent saling melihat perubahan.

Reliability implication:

- `READ COMMITTED` dapat mengalami non-repeatable read;
- concurrent update dapat menyebabkan lost update jika tanpa optimistic locking;
- lock timeout bisa muncul di tengah operation;
- deadlock dapat menyebabkan salah satu transaction dibatalkan;
- retry database operation harus mempertimbangkan idempotency dan versioning.

Contoh lost update:

```text
T1 reads application version 5
T2 reads application version 5
T1 approves -> writes version 6
T2 rejects  -> writes version 6 or overwrites status
```

Solusi umum:

```text
UPDATE application
SET status = ?, version = version + 1
WHERE id = ? AND version = ?
```

Jika affected row = 0, berarti stale state/conflict.

---

### 3.4 Durability

Durability berarti setelah commit berhasil, perubahan harus bertahan sesuai guarantee database.

Tetapi dari sisi aplikasi, ada pertanyaan penting:

> Bagaimana jika aplikasi tidak menerima kepastian bahwa commit berhasil?

Inilah commit uncertainty.

---

## 4. Commit Uncertainty

### 4.1 Masalah `commit()` yang tidak memberi kepastian sempurna

Dalam JDBC/Spring, aplikasi biasanya melakukan:

```text
connection.commit()
```

Jika commit sukses, kita percaya transaction berhasil.

Jika commit gagal karena constraint violation sebelum commit, biasanya transaction gagal.

Tetapi ada kasus lebih sulit:

```text
Application sends COMMIT to database
Database receives COMMIT
Database commits transaction
Network connection breaks before ACK reaches application
Application sees SQLException / timeout
```

Dari perspektif aplikasi:

```text
commit outcome = unknown
```

State sebenarnya mungkin:

```text
A. commit failed
B. commit succeeded
C. database is still resolving
```

Jika aplikasi langsung retry tanpa idempotency, data bisa ganda.

---

### 4.2 Commit uncertainty dalam bentuk praktis

Contoh command:

```text
Create payment instruction
```

Failure terjadi saat commit:

```text
INSERT payment_instruction(idempotency_key='REQ-123', amount=100)
COMMIT -> connection lost
```

Client menerima 500 atau timeout lalu retry.

Tanpa idempotency:

```text
Retry creates second payment instruction
```

Dengan idempotency:

```text
Retry checks idempotency_key='REQ-123'
If exists -> return original result
If absent -> process
```

Kesimpulan:

> Commit uncertainty tidak bisa diselesaikan hanya dengan catch exception. Ia diselesaikan dengan deterministic operation identity.

---

### 4.3 Rule penting

Untuk command yang punya side effect penting:

```text
Every externally retriable command must have a stable operation identity.
```

Bentuk operation identity:

- idempotency key dari client;
- deterministic business key;
- message ID;
- command ID;
- unique constraint;
- outbox event ID;
- aggregate version;
- external reference number.

Tanpa operation identity, retry setelah uncertain commit adalah gambling.

---

## 5. Spring Transaction Semantics

### 5.1 `@Transactional` bukan magic block

Di Spring, `@Transactional` biasanya bekerja melalui proxy/AOP. Artinya transaction boundary aktif ketika method dipanggil melalui Spring proxy, bukan sekadar karena annotation ada di source code.

Anti-pattern umum:

```java
@Service
public class ApplicationService {

    public void submit(UUID id) {
        // self-invocation: transaction annotation pada doSubmit bisa tidak efektif
        doSubmit(id);
    }

    @Transactional
    public void doSubmit(UUID id) {
        // transactional work
    }
}
```

Karena `doSubmit` dipanggil dari object yang sama, call bisa melewati proxy.

Rule:

> Jangan mendesain transaction safety berdasarkan asumsi annotation bekerja. Pastikan boundary transaction benar-benar aktif.

---

### 5.2 Default rollback rule Spring

Secara default, Spring rollback untuk:

- `RuntimeException`;
- `Error`.

Dan tidak rollback untuk checked exception, kecuali dikonfigurasi dengan `rollbackFor` atau rule lain.

Contoh berbahaya:

```java
@Transactional
public void importFile(File file) throws IOException {
    repository.save(...);
    readNextFilePart(file); // throws IOException
}
```

Jika `IOException` adalah checked exception dan tidak ada `rollbackFor`, transaction bisa commit tergantung konfigurasi dan flow.

Lebih eksplisit:

```java
@Transactional(rollbackFor = IOException.class)
public void importFile(File file) throws IOException {
    repository.save(...);
    readNextFilePart(file);
}
```

Namun desain yang lebih baik sering menerjemahkan exception ke domain/technical unchecked exception yang meaningful:

```java
try {
    readNextFilePart(file);
} catch (IOException ex) {
    throw new ImportReadFailureException(file.getName(), ex);
}
```

Spring documentation menyatakan rollback declarative transaction dapat dikontrol dengan rollback rules, dan `@Transactional` default rollback pada `RuntimeException` dan `Error` tetapi bukan checked exception jika tidak dikonfigurasi.  
References:  
- https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/rolling-back.html  
- https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/annotation/Transactional.html

---

### 5.3 Catching exception bisa membuat transaction commit

Contoh:

```java
@Transactional
public void process(UUID id) {
    repository.save(...);

    try {
        externalClient.call();
    } catch (ExternalServiceException ex) {
        log.warn("External call failed", ex);
    }
}
```

Karena exception ditangkap dan method selesai normal, Spring melihat tidak ada exception keluar dari method. Transaction dapat commit.

Ini belum tentu salah. Tapi harus disengaja.

Pertanyaannya:

```text
Apakah external call failure boleh tetap commit database mutation?
```

Jika ya, maka simpan status eksplisit:

```java
@Transactional
public void process(UUID id) {
    Entity entity = repository.getReferenceById(id);
    entity.markProcessed();

    try {
        externalClient.call();
        entity.markExternalNotificationSent();
    } catch (ExternalServiceException ex) {
        entity.markExternalNotificationPendingRetry();
        outboxRepository.save(Outbox.retryExternalNotification(id));
    }
}
```

Jika tidak, jangan swallow exception:

```java
@Transactional
public void process(UUID id) {
    repository.save(...);
    externalClient.call(); // failure propagates and marks rollback
}
```

Tetapi memanggil external API di dalam transaction punya problem lain yang akan kita bahas.

---

### 5.4 Rollback-only surprise

Ada kasus inner operation gagal, menandai transaction rollback-only, tetapi exception ditangkap di outer layer.

Simplified:

```java
@Transactional
public void outer() {
    try {
        inner();
    } catch (RuntimeException ex) {
        log.warn("inner failed, continue");
    }

    repository.save(new OtherEntity());
}

@Transactional
public void inner() {
    repository.save(new Entity());
    throw new RuntimeException("fail");
}
```

Jika `inner` menggunakan transaction yang sama, failure bisa menandai transaction rollback-only. Outer method melanjutkan seolah aman, tetapi commit di akhir gagal.

Spring dapat melempar `UnexpectedRollbackException` ketika outer transaction mencoba commit padahal transaction sudah ditandai rollback-only.

Mental model:

```text
Catching an exception does not always restore transaction health.
```

Jika kamu ingin partial failure terisolasi, gunakan boundary yang benar:

- `REQUIRES_NEW` untuk transaction terpisah;
- `NESTED` jika savepoint didukung;
- atau pisahkan workflow menjadi step eksplisit.

---

## 6. Transaction Propagation and Reliability Meaning

### 6.1 `REQUIRED`

`REQUIRED` adalah default. Jika sudah ada transaction, ikut transaction tersebut; jika belum ada, buat baru.

Reliability meaning:

```text
Inner and outer work share same fate.
```

Jika satu gagal dan rollback, semua rollback.

Cocok untuk:

- satu aggregate mutation;
- mutation yang harus atomic bersama;
- audit record yang harus commit bersama mutation.

Berbahaya untuk:

- audit failure yang tidak boleh membatalkan business transaction;
- notification failure;
- best-effort logging;
- external integration.

---

### 6.2 `REQUIRES_NEW`

`REQUIRES_NEW` membuat transaction baru dan suspend transaction lama.

Reliability meaning:

```text
Inner work has independent fate.
```

Contoh audit failure isolation:

```java
@Transactional
public void approve(UUID id) {
    application.approve();
    auditService.recordAttempt(id); // REQUIRES_NEW
}
```

Tetapi hati-hati: jika audit commit berhasil lalu outer transaction rollback, audit akan mencatat attempt terhadap operation yang tidak jadi commit. Ini mungkin benar jika audit memang mencatat attempt, bukan success.

Rule:

> `REQUIRES_NEW` harus jelas secara semantic: apakah mencatat attempt, progress, failure, atau committed business fact?

---

### 6.3 `NESTED`

`NESTED` menggunakan savepoint dalam physical transaction yang sama jika didukung.

Reliability meaning:

```text
Partial rollback within same outer transaction.
```

Cocok untuk:

- batch import satu file, beberapa row gagal tapi batch tetap berjalan;
- optional sub-operation dalam satu DB transaction;
- savepoint-based rollback.

Tetapi tidak semua stack mendukungnya sama. Spring documentation menjelaskan `PROPAGATION_NESTED` biasanya dipetakan ke JDBC savepoints dan bekerja dengan JDBC resource transaction seperti `DataSourceTransactionManager`.  
Reference: https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html

---

### 6.4 Transaction propagation sebagai desain fate-sharing

Jangan mulai dari pertanyaan:

> "Pakai propagation apa?"

Mulai dari pertanyaan:

> "Operasi mana yang harus share fate, dan operasi mana yang harus punya fate terpisah?"

| Relationship | Propagation candidate | Meaning |
|---|---:|---|
| Must commit/rollback together | `REQUIRED` | Same fate |
| Must survive outer rollback | `REQUIRES_NEW` | Independent fate |
| May rollback partially within outer unit | `NESTED` | Savepoint fate |
| Must not run in transaction | `NOT_SUPPORTED` | Avoid long transaction |
| Must fail if no transaction | `MANDATORY` | Enforce caller boundary |

---

## 7. External Side Effects Inside Transaction

### 7.1 The classic dangerous pattern

```java
@Transactional
public void approve(UUID id) {
    Application app = applicationRepository.get(id);
    app.approve();

    externalCaseSystem.notifyApproved(app.toPayload());
}
```

Possible timelines:

#### Timeline A — external fails before DB commit

```text
DB update in transaction
External call fails
Exception propagates
DB rollback
```

Looks safe.

#### Timeline B — external succeeds, DB commit fails

```text
DB update in transaction
External call succeeds
DB commit fails
```

Now external system believes application approved, local DB does not.

#### Timeline C — external succeeds, app crashes before commit

```text
DB update in transaction
External call succeeds
Pod killed
DB connection closes -> rollback
```

External side effect remains.

#### Timeline D — external call slow while DB transaction open

```text
DB row lock held
External API slow 20s
Other transactions blocked
Connection occupied
Shutdown waiting
Retry storm increases pressure
```

This causes capacity/reliability degradation.

---

### 7.2 Rule: do not call slow/unreliable external systems while holding DB transaction unless intentionally justified

Default rule:

```text
Avoid external I/O inside database transaction.
```

Reason:

- extends lock duration;
- increases deadlock/timeout risk;
- couples DB transaction fate with external latency;
- creates impossible atomicity expectation;
- complicates shutdown;
- complicates retry;
- can cause resource exhaustion.

Exception cases exist, but must be justified explicitly.

---

### 7.3 Better pattern: persist intent, then perform side effect asynchronously

```java
@Transactional
public ApprovalResult approve(UUID id, CommandMetadata metadata) {
    Application app = applicationRepository.get(id);
    app.approve(metadata.actor());

    outboxRepository.save(OutboxEvent.applicationApproved(app.id()));

    return ApprovalResult.approved(app.id(), app.version());
}
```

Then worker:

```java
public void publishPendingOutboxEvents() {
    List<OutboxEvent> events = outboxRepository.lockNextBatch();

    for (OutboxEvent event : events) {
        try {
            broker.publish(event.topic(), event.payload());
            outboxRepository.markPublished(event.id());
        } catch (TransientBrokerException ex) {
            outboxRepository.markRetryableFailure(event.id(), ex);
        }
    }
}
```

Now database state and event intent commit atomically.

If app crashes after commit, event remains pending.

---

## 8. Transactional Outbox Pattern

### 8.1 Problem solved by outbox

Without outbox:

```text
Update DB
Publish message
```

Failure windows:

```text
DB commit succeeds, publish fails
Publish succeeds, DB commit fails
App crashes between DB commit and publish
```

With outbox:

```text
Single DB transaction:
  update business table
  insert outbox event
commit

Separate relay:
  read outbox
  publish message
  mark published
```

The transactional outbox pattern is commonly used when a service must update its database and send messages/events without relying on distributed two-phase commit. The core idea is to store the message/event in the same database transaction as the aggregate mutation, then relay it asynchronously.  
Reference: https://microservices.io/patterns/data/transactional-outbox.html

---

### 8.2 Outbox table design

Example:

```sql
CREATE TABLE outbox_event (
    id                  UUID PRIMARY KEY,
    aggregate_type      VARCHAR(100) NOT NULL,
    aggregate_id        UUID NOT NULL,
    event_type          VARCHAR(100) NOT NULL,
    event_version       INTEGER NOT NULL,
    payload_json        TEXT NOT NULL,
    status              VARCHAR(30) NOT NULL,
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    next_attempt_at     TIMESTAMP NULL,
    locked_by           VARCHAR(100) NULL,
    locked_until        TIMESTAMP NULL,
    created_at          TIMESTAMP NOT NULL,
    published_at        TIMESTAMP NULL,
    last_error_code     VARCHAR(100) NULL,
    last_error_message  TEXT NULL
);

CREATE INDEX idx_outbox_event_polling
ON outbox_event (status, next_attempt_at, created_at);

CREATE INDEX idx_outbox_event_aggregate
ON outbox_event (aggregate_type, aggregate_id, created_at);
```

Status model:

```text
PENDING
  -> LOCKED
  -> PUBLISHED
  -> RETRYABLE_FAILURE
  -> DEAD
```

Or simpler:

```text
PENDING / PUBLISHED / DEAD
```

with lock columns.

---

### 8.3 Writing outbox in same transaction

```java
@Transactional
public void approveApplication(ApproveApplicationCommand command) {
    Application app = applicationRepository.findForUpdate(command.applicationId())
            .orElseThrow(() -> new ApplicationNotFoundException(command.applicationId()));

    app.approve(command.actor(), command.reason());

    OutboxEvent event = OutboxEvent.create(
            "Application",
            app.id(),
            "ApplicationApproved",
            1,
            json.serialize(new ApplicationApprovedPayload(app.id(), app.approvedAt()))
    );

    applicationRepository.save(app);
    outboxRepository.save(event);
}
```

Guarantee:

```text
If approval commits, outbox event exists.
If approval rolls back, outbox event does not exist.
```

---

### 8.4 Publishing outbox safely

Simplified worker:

```java
public void publishBatch() {
    List<OutboxEvent> events = outboxRepository.claimNextBatch(workerId, clock.now());

    for (OutboxEvent event : events) {
        publishOne(event);
    }
}

private void publishOne(OutboxEvent event) {
    try {
        messageBroker.publish(
                event.topic(),
                event.id().toString(),
                event.payloadJson()
        );

        outboxRepository.markPublished(event.id(), clock.now());
    } catch (TransientBrokerException ex) {
        outboxRepository.markRetry(event.id(), nextBackoff(event), ex);
    } catch (PermanentBrokerException ex) {
        outboxRepository.markDead(event.id(), ex);
    }
}
```

Important:

- Message key/event id should be stable.
- Consumer must be idempotent.
- Publisher may publish then fail before marking published.
- Therefore duplicates are possible.

Outbox does not guarantee exactly-once end-to-end. It gives:

```text
At-least-once publish with durable intent.
```

Consumer idempotency is still required.

---

### 8.5 Outbox duplicate window

Timeline:

```text
T1 worker reads outbox event E1
T2 worker publishes E1 to broker successfully
T3 worker crashes before markPublished(E1)
T4 another worker later reads E1 again
T5 E1 is published again
```

Therefore:

```text
Outbox makes missing event unlikely; it does not eliminate duplicate event.
```

Consumer must handle duplicate by:

- inbox table;
- processed message ID table;
- idempotent update;
- aggregate version check;
- unique constraint;
- natural idempotency.

---

## 9. Inbox Pattern for Consumers

### 9.1 Why consumer idempotency matters

Queue/message systems often provide at-least-once delivery. Even when broker guarantees are strong, application-level duplication can still occur due to:

- consumer crash after DB commit before ack;
- broker redelivery;
- outbox duplicate publish;
- manual replay;
- partition rebalance;
- timeout;
- retry.

Consumer must assume:

```text
Same message may be processed more than once.
```

---

### 9.2 Inbox table

```sql
CREATE TABLE inbox_message (
    message_id      UUID PRIMARY KEY,
    source          VARCHAR(100) NOT NULL,
    received_at     TIMESTAMP NOT NULL,
    processed_at    TIMESTAMP NULL,
    status          VARCHAR(30) NOT NULL
);
```

Consumer flow:

```text
Begin DB transaction
  Insert inbox_message(message_id)
  If duplicate key -> already processed or in progress
  Apply business mutation
  Mark inbox processed
Commit
Ack message
```

Java sketch:

```java
@Transactional
public ProcessingResult consume(ApplicationApprovedEvent event) {
    boolean firstTime = inboxRepository.tryInsert(event.messageId(), event.source());

    if (!firstTime) {
        return ProcessingResult.duplicateIgnored();
    }

    downstreamProjection.apply(event);
    inboxRepository.markProcessed(event.messageId());

    return ProcessingResult.processed();
}
```

Ack must happen after commit.

---

## 10. Message Acknowledgement and Transaction Boundary

### 10.1 Dangerous order: ack before commit

```text
Receive message
Ack message
Begin DB transaction
Update DB
Commit fails
```

Message is lost from broker but DB mutation did not happen.

### 10.2 Safer order: commit before ack

```text
Receive message
Begin DB transaction
Update DB
Commit
Ack message
```

If app crashes after commit before ack:

```text
Broker redelivers message
Consumer must deduplicate
```

This is better because duplicate is easier to handle than silent loss.

Rule:

> Prefer duplicate processing risk over message loss, then design idempotency.

---

### 10.3 Consumer processing matrix

| Failure point | Ack state | DB state | Result | Required protection |
|---|---:|---:|---|---|
| Before processing | not acked | unchanged | redelivery | normal retry |
| During DB transaction | not acked | rollback | redelivery | idempotent command |
| After DB commit before ack | not acked | committed | duplicate redelivery | inbox/idempotency |
| After ack | acked | committed | success | none |
| Ack before DB commit then crash | acked | unknown/rollback | message loss | avoid this order |

---

## 11. Idempotency and Transaction Safety

Part 015 akan membahas idempotency secara khusus, tetapi part ini perlu fondasi awal.

### 11.1 Idempotency as transaction recovery primitive

Idempotency adalah kemampuan menjalankan operasi yang sama lebih dari sekali tanpa mengubah outcome secara salah.

Dalam transaction safety, idempotency menyelesaikan masalah:

- uncertain commit;
- timeout after success;
- retry after crash;
- duplicate message;
- repeated callback;
- client retry;
- manual replay.

Tanpa idempotency, retry adalah risiko data corruption.

---

### 11.2 Idempotency record must be in same transaction as business mutation

Bad:

```text
Insert business row
Commit
Insert idempotency record
```

Failure between commit and idempotency record means retry cannot detect success.

Better:

```text
Begin transaction
  Insert idempotency record
  Apply business mutation
  Store response summary/result reference
Commit
```

Example schema:

```sql
CREATE TABLE idempotency_record (
    idempotency_key     VARCHAR(200) PRIMARY KEY,
    command_type        VARCHAR(100) NOT NULL,
    request_hash        VARCHAR(128) NOT NULL,
    status              VARCHAR(30) NOT NULL,
    result_reference    VARCHAR(200) NULL,
    response_json       TEXT NULL,
    created_at          TIMESTAMP NOT NULL,
    completed_at        TIMESTAMP NULL
);
```

Flow:

```text
Receive command with key K
Begin transaction
  Try insert idempotency_record(K, IN_PROGRESS)
  If duplicate:
    compare request hash
    if completed -> return previous result
    if in progress -> return 409/425/202 depending design
  Apply mutation
  Mark idempotency completed with result
Commit
Return result
```

---

## 12. Transaction Timeout and Shutdown Timeout

### 12.1 Transaction timeout is not shutdown timeout

Transaction timeout answers:

```text
How long may this transaction remain active?
```

Shutdown timeout answers:

```text
How long may this process take to stop gracefully?
```

Request timeout answers:

```text
How long will client/proxy wait for response?
```

These budgets interact.

Bad design:

```text
HTTP timeout: 10s
Transaction timeout: 60s
Shutdown grace: 30s
External call inside transaction: can wait 45s
```

Outcome:

- client gives up at 10s;
- transaction may continue;
- shutdown may occur while transaction is still active;
- retry may duplicate operation;
- DB locks held too long.

Better:

```text
HTTP deadline >= app deadline + response margin
App operation deadline controls all downstream calls
Transaction timeout <= operation deadline
Shutdown grace >= max safe drain time, or app rejects long work during draining
```

---

### 12.2 Shutdown-aware transaction admission

During draining, app should stop accepting new long transactional work.

Example:

```java
@Component
public class DrainingGuard {
    private final AtomicBoolean draining = new AtomicBoolean(false);

    public void startDraining() {
        draining.set(true);
    }

    public void rejectIfDraining(OperationProfile profile) {
        if (draining.get() && profile.isLongRunning()) {
            throw new ServiceDrainingException("Service is shutting down");
        }
    }
}
```

Use before starting transaction:

```java
public ApprovalResult approve(ApproveCommand command) {
    drainingGuard.rejectIfDraining(OperationProfile.WRITE_COMMAND);
    return transactionalApproval.approve(command);
}
```

Rule:

> Do not start work you cannot safely finish within the remaining shutdown budget.

---

## 13. Transaction Boundaries in Layered Architecture

### 13.1 Transaction should usually live at application service/use-case layer

Good boundary:

```text
Controller / Message Listener
  -> Application Service @Transactional
      -> Domain model
      -> Repository
      -> Outbox repository
  -> Return response / ack after commit
```

Avoid transaction boundary at:

- controller for complex workflows;
- repository only, if use case needs multiple repository operations atomic;
- too low-level helper methods;
- external client wrapper;
- view rendering/serialization layer.

Reason:

> Transaction boundary should match consistency boundary of the use case.

---

### 13.2 Read-only transaction

Read-only transaction can help:

- communicate intent;
- optimize some persistence behavior;
- prevent accidental writes depending stack;
- define consistent read boundary.

But do not assume read-only magically prevents all side effects.

```java
@Transactional(readOnly = true)
public ApplicationView getApplication(UUID id) {
    return repository.findView(id)
            .orElseThrow(() -> new ApplicationNotFoundException(id));
}
```

Reliability concern:

- long read transaction can still hold resources;
- lazy loading during serialization can escape transaction boundary;
- read from replica may be stale;
- read-your-write guarantee may not hold.

---

### 13.3 Transaction and lazy loading

Bad:

```java
@GetMapping("/{id}")
public ApplicationDto get(@PathVariable UUID id) {
    Application app = service.find(id);
    return mapper.toDto(app); // may trigger lazy load after transaction
}
```

If transaction closed, lazy loading fails. If Open Session in View is enabled, transaction/resource lifetime may extend into web rendering.

Reliability principle:

> Fetch and map inside a clear read boundary; do not let persistence behavior leak unpredictably into response serialization.

---

## 14. Designing Transactional State Machines

### 14.1 State transition must be atomic with evidence

For regulatory/workflow systems, state changes must often be accompanied by:

- actor;
- timestamp;
- reason;
- previous state;
- new state;
- correlation ID;
- command ID;
- audit trail;
- outbox event.

All should commit together if they represent the same business fact.

```text
BEGIN
  UPDATE application status SUBMITTED -> APPROVED
  INSERT audit_trail(previous=SUBMITTED, new=APPROVED, actor=...)
  INSERT outbox_event(ApplicationApproved)
  INSERT idempotency_record(command_id=...)
COMMIT
```

If audit trail is mandatory evidence, it must share fate with the state transition.

If audit logs attempt regardless of success/failure, then it may be separate `REQUIRES_NEW`, but semantic must say "attempt", not "success".

---

### 14.2 Guard transition with current state

Bad:

```java
app.setStatus(APPROVED);
repository.save(app);
```

Better:

```java
app.approve(actor, reason);
```

Domain method:

```java
public void approve(UserId actor, String reason) {
    if (status != ApplicationStatus.SUBMITTED) {
        throw new InvalidApplicationStateTransitionException(
                id,
                status,
                ApplicationStatus.APPROVED
        );
    }

    this.status = ApplicationStatus.APPROVED;
    this.approvedBy = actor;
    this.approvedAt = Instant.now();
    this.approvalReason = reason;
}
```

Database should also help where possible:

```sql
UPDATE application
SET status = 'APPROVED', version = version + 1
WHERE id = ?
  AND status = 'SUBMITTED'
  AND version = ?;
```

If row count 0:

```text
conflict / stale state / invalid transition
```

Not generic 500.

---

## 15. Rollback Is Not a Business Recovery Strategy

### 15.1 Rollback only works before commit

Rollback is useful when:

- failure occurs before commit;
- all relevant mutation is in the same transaction;
- no irreversible side effect escaped;
- transaction manager still controls the resource.

Rollback does not solve:

- commit succeeded but response failed;
- external API already called;
- email already sent;
- message already published;
- file already uploaded;
- downstream system already mutated;
- human already saw a result;
- another transaction already observed committed state.

---

### 15.2 After commit, use compensation or forward recovery

Once commit succeeds, recovery is usually not rollback but:

- compensate;
- retry remaining side effect;
- reconcile;
- mark pending;
- issue correction event;
- manual remediation;
- reverse transaction;
- create amendment.

Example:

```text
APPROVED committed
Notification failed
```

Do not rollback approval after commit just because notification failed.

Better:

```text
APPROVED
NOTIFICATION_PENDING_RETRY
```

Worker retries. If exhausted:

```text
NOTIFICATION_FAILED_FINAL
operator alert
manual resend option
```

---

## 16. Failure Scenarios and Correct Handling

### Scenario 1 — Exception before transaction starts

```text
Invalid request payload
```

Handling:

- return 400/validation error;
- no transaction needed;
- no retry needed unless client corrects input.

---

### Scenario 2 — Domain invariant fails inside transaction

```text
Application is already APPROVED
Command tries to REJECT
```

Handling:

- throw domain exception;
- rollback transaction;
- return conflict/invalid state response;
- do not retry blindly.

---

### Scenario 3 — Deadlock or lock timeout

```text
DB aborts transaction due to deadlock
```

Handling:

- classify as transient database failure;
- retry only if command is idempotent;
- use backoff;
- monitor frequency;
- investigate access order/indexing.

---

### Scenario 4 — Commit unknown

```text
Connection lost during commit
```

Handling:

- do not blindly retry without idempotency;
- client retry should use same idempotency key;
- server should check operation record/business key;
- return uncertain error only if result cannot be determined;
- reconciliation may be required.

---

### Scenario 5 — DB commit succeeds, response fails

```text
Client times out after server commits
```

Handling:

- retry with idempotency key;
- return previous result;
- avoid duplicate mutation;
- logs/traces should show original command ID.

---

### Scenario 6 — External API succeeds, DB rollback

```text
External side effect inside transaction
DB commit later fails
```

Handling:

- avoid this design;
- if unavoidable, external API must support idempotency/cancel/compensation;
- store external reference;
- reconcile local and external state.

---

### Scenario 7 — Message processed, DB committed, ack fails

```text
Broker redelivers message
```

Handling:

- inbox/idempotency table;
- duplicate ignored or previous result returned;
- ack after detecting duplicate.

---

### Scenario 8 — Shutdown during transaction

```text
SIGTERM received while request holds transaction
```

Handling:

- stop accepting new request;
- allow bounded drain;
- transaction must finish before shutdown budget;
- if interrupted, rollback or connection close rollback;
- operation must be retry-safe;
- avoid long external call inside transaction.

---

## 17. Anti-Patterns

### 17.1 `@Transactional` around everything

Bad:

```java
@Transactional
public Response doEverything() {
    validate();
    updateDb();
    callExternalApi();
    uploadFile();
    sendEmail();
    return response();
}
```

Problem:

- long transaction;
- lock held during I/O;
- external side effect not atomic;
- shutdown drain slow;
- rollback expectation false.

---

### 17.2 Swallowing exception inside transaction

```java
try {
    riskyOperation();
} catch (Exception ex) {
    log.error("failed", ex);
}
```

If business requires rollback, this is wrong.

Better:

- propagate;
- mark transaction rollback-only explicitly;
- record failure state intentionally;
- split fate with separate transaction.

---

### 17.3 Publishing event after commit without durable outbox

```java
@Transactional
public void approve() {
    updateDb();
}

public void controller() {
    service.approve();
    eventPublisher.publish(...); // app may crash here
}
```

Failure:

```text
DB says approved, no event emitted.
```

Better:

```text
update DB + insert outbox in same transaction
```

---

### 17.4 Ack before commit

Already discussed. This risks message loss.

---

### 17.5 Assuming rollback cancels external side effects

Rollback cannot unsend email, uncall HTTP API, or unpublish Kafka message unless specifically designed.

---

### 17.6 Using retry to hide transaction uncertainty

Retry without idempotency can duplicate writes.

---

### 17.7 Mixing business success with notification success

Bad:

```text
Approval failed because email failed
```

Maybe correct in some domains, but often wrong. Approval and notification should have separate states if notification is not part of approval invariant.

---

### 17.8 Treating all database exceptions as 500

Some DB exceptions indicate:

- conflict;
- duplicate command;
- stale state;
- validation issue;
- transient capacity issue;
- deadlock retry candidate;
- system outage.

Error contract should reflect classification.

---

## 18. Production Checklist

### 18.1 Transaction boundary checklist

For every write use case:

- [ ] What is the exact transaction boundary?
- [ ] Which mutations must commit together?
- [ ] Which side effects are outside transaction?
- [ ] Are there external calls inside transaction?
- [ ] If yes, why is it safe/necessary?
- [ ] What is the transaction timeout?
- [ ] What happens on shutdown during transaction?
- [ ] What happens if commit outcome is unknown?
- [ ] Is operation idempotent?
- [ ] Is there an idempotency key or unique business key?

---

### 18.2 Rollback checklist

- [ ] Which exceptions trigger rollback?
- [ ] Are checked exceptions handled correctly?
- [ ] Are exceptions swallowed inside transaction?
- [ ] Can transaction become rollback-only unexpectedly?
- [ ] Are rollback rules documented?
- [ ] Are domain exceptions mapped properly?

---

### 18.3 Side effect checklist

- [ ] Does operation send email/SMS/webhook/event?
- [ ] Does operation call external API?
- [ ] Does operation update cache?
- [ ] Does operation upload/delete file?
- [ ] Are side effects reversible?
- [ ] Are side effects idempotent?
- [ ] Are side effects driven by outbox or durable intent?
- [ ] Can side effects be retried safely?
- [ ] Is duplicate side effect acceptable/detectable?

---

### 18.4 Queue consumer checklist

- [ ] Is message ack after DB commit?
- [ ] Is duplicate message safe?
- [ ] Is inbox/dedup implemented?
- [ ] What happens if consumer crashes after commit before ack?
- [ ] What happens if ack succeeds before mutation?
- [ ] Is poison message handled?
- [ ] Is partial batch failure handled?

---

### 18.5 Outbox checklist

- [ ] Is outbox inserted in same transaction as business mutation?
- [ ] Is event ID stable?
- [ ] Is event payload sufficient?
- [ ] Is publish retry bounded/backoff?
- [ ] Is duplicate publish handled?
- [ ] Is consumer idempotent?
- [ ] Is dead-letter/dead status visible?
- [ ] Is outbox lag monitored?
- [ ] Is outbox cleanup/retention defined?

---

## 19. Example: Reliable Approval Use Case

### 19.1 Requirements

Use case:

```text
Officer approves application.
System must:
- change application status to APPROVED;
- write audit trail;
- publish ApplicationApproved event;
- send notification eventually;
- avoid duplicate approval on retry;
- survive shutdown after commit;
- expose deterministic result to client.
```

---

### 19.2 Tables

```sql
CREATE TABLE application (
    id              UUID PRIMARY KEY,
    status          VARCHAR(30) NOT NULL,
    version         BIGINT NOT NULL,
    approved_by     UUID NULL,
    approved_at     TIMESTAMP NULL
);

CREATE TABLE audit_trail (
    id              UUID PRIMARY KEY,
    entity_type     VARCHAR(100) NOT NULL,
    entity_id       UUID NOT NULL,
    action          VARCHAR(100) NOT NULL,
    actor_id        UUID NOT NULL,
    previous_state  VARCHAR(100) NULL,
    new_state       VARCHAR(100) NULL,
    created_at      TIMESTAMP NOT NULL,
    correlation_id  VARCHAR(100) NOT NULL
);

CREATE TABLE idempotency_record (
    idempotency_key     VARCHAR(200) PRIMARY KEY,
    command_type        VARCHAR(100) NOT NULL,
    request_hash        VARCHAR(128) NOT NULL,
    status              VARCHAR(30) NOT NULL,
    result_json         TEXT NULL,
    created_at          TIMESTAMP NOT NULL,
    completed_at        TIMESTAMP NULL
);

CREATE TABLE outbox_event (
    id              UUID PRIMARY KEY,
    aggregate_type  VARCHAR(100) NOT NULL,
    aggregate_id    UUID NOT NULL,
    event_type      VARCHAR(100) NOT NULL,
    payload_json    TEXT NOT NULL,
    status          VARCHAR(30) NOT NULL,
    created_at      TIMESTAMP NOT NULL
);
```

---

### 19.3 Application service

```java
@Service
public class ApproveApplicationUseCase {

    private final ApplicationRepository applicationRepository;
    private final AuditTrailRepository auditTrailRepository;
    private final IdempotencyService idempotencyService;
    private final OutboxRepository outboxRepository;
    private final Clock clock;

    @Transactional
    public ApproveApplicationResult approve(ApproveApplicationCommand command) {
        IdempotencyDecision decision = idempotencyService.startOrReturnExisting(
                command.idempotencyKey(),
                "ApproveApplication",
                command.requestHash()
        );

        if (decision.isAlreadyCompleted()) {
            return decision.previousResultAs(ApproveApplicationResult.class);
        }

        Application application = applicationRepository.findByIdForUpdate(command.applicationId())
                .orElseThrow(() -> new ApplicationNotFoundException(command.applicationId()));

        ApplicationStatus previous = application.status();

        application.approve(command.actorId(), command.reason(), clock.instant());

        auditTrailRepository.save(AuditTrail.stateTransition(
                "Application",
                application.id(),
                "APPROVE_APPLICATION",
                command.actorId(),
                previous.name(),
                application.status().name(),
                command.correlationId(),
                clock.instant()
        ));

        OutboxEvent event = OutboxEvent.create(
                "Application",
                application.id(),
                "ApplicationApproved",
                new ApplicationApprovedPayload(
                        application.id(),
                        application.approvedBy(),
                        application.approvedAt(),
                        command.correlationId()
                )
        );

        outboxRepository.save(event);

        ApproveApplicationResult result = ApproveApplicationResult.approved(
                application.id(),
                application.version(),
                application.approvedAt()
        );

        idempotencyService.complete(command.idempotencyKey(), result);

        return result;
    }
}
```

Important properties:

```text
application update + audit + idempotency completion + outbox event commit together
```

No email/external API inside the transaction.

---

### 19.4 Outbox notification worker

```java
@Component
public class ApplicationApprovedOutboxHandler {

    private final NotificationClient notificationClient;
    private final OutboxRepository outboxRepository;

    public void handle(OutboxEvent event) {
        ApplicationApprovedPayload payload = event.payloadAs(ApplicationApprovedPayload.class);

        try {
            notificationClient.sendApplicationApproved(
                    payload.applicationId(),
                    payload.approvedAt(),
                    event.id().toString() // stable idempotency key for notification provider if supported
            );

            outboxRepository.markPublished(event.id());
        } catch (NotificationRateLimitedException ex) {
            outboxRepository.markRetry(event.id(), Backoff.next(event.attemptCount()), ex);
        } catch (NotificationPermanentException ex) {
            outboxRepository.markDead(event.id(), ex);
        }
    }
}
```

---

## 20. Review Questions

Gunakan pertanyaan ini untuk mengevaluasi pemahaman:

1. Mengapa database transaction tidak otomatis membuat seluruh business operation atomic?
2. Apa itu commit uncertainty?
3. Mengapa retry setelah commit uncertainty berbahaya tanpa idempotency?
4. Apa default rollback behavior Spring untuk checked exception?
5. Mengapa catching exception di dalam `@Transactional` bisa menyebabkan commit?
6. Apa arti `REQUIRED` dari perspektif fate-sharing?
7. Kapan `REQUIRES_NEW` berguna dan kapan berbahaya?
8. Mengapa external API call di dalam DB transaction biasanya buruk?
9. Masalah apa yang diselesaikan transactional outbox?
10. Mengapa outbox masih membutuhkan consumer idempotency?
11. Mengapa ack message sebaiknya setelah DB commit?
12. Apa yang harus terjadi kalau service shutdown saat transaction sedang berjalan?
13. Mengapa audit trail mandatory sebaiknya commit bersama state transition?
14. Kapan rollback tidak cukup dan compensation diperlukan?
15. Apa saja evidence yang harus disimpan untuk workflow/regulatory state transition?

---

## 21. Key Takeaways

1. Transaction safety adalah tentang **failure window**, bukan hanya rollback.
2. Database transaction hanya atomic untuk resource yang dikontrol transaction tersebut.
3. Commit uncertainty membuat retry tanpa idempotency berbahaya.
4. Spring rollback default perlu dipahami; checked exception tidak selalu rollback.
5. Catching exception di dalam transaction harus disengaja secara semantic.
6. Transaction propagation adalah desain fate-sharing.
7. External side effect di dalam transaction biasanya menciptakan false atomicity.
8. Outbox membuat event intent durable bersama business mutation.
9. Outbox memberi at-least-once, bukan exactly-once end-to-end.
10. Consumer idempotency/inbox diperlukan untuk duplicate-safe processing.
11. Ack message setelah commit lebih aman daripada ack sebelum commit.
12. Rollback bukan recovery strategy setelah commit.
13. Shutdown-safe transaction design membutuhkan bounded work, idempotency, dan durable progress.
14. Untuk sistem workflow/regulatory, state transition, audit, idempotency, dan outbox harus dirancang sebagai satu consistency unit.

---

## 22. Practical Mental Model

Saat mendesain satu command, gambar timeline ini:

```text
Command received
  -> idempotency checked
  -> transaction begins
  -> state loaded
  -> invariant checked
  -> mutation applied
  -> audit written
  -> outbox written
  -> idempotency result stored
  -> commit attempted
  -> response returned
  -> outbox published asynchronously
  -> consumer processes idempotently
```

Lalu tanyakan pada setiap panah:

```text
If failure happens here:
- what has changed?
- who has observed it?
- can it be retried?
- can it duplicate?
- can it be reconstructed?
- can operator repair it?
- what evidence exists?
```

Inilah cara berpikir transaction safety yang matang.

---

## 23. References

- Spring Framework Documentation — Rolling Back a Declarative Transaction: https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/rolling-back.html
- Spring Framework Documentation — Transaction Propagation: https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html
- Spring Framework API — `@Transactional`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/annotation/Transactional.html
- Microservices.io — Transactional Outbox Pattern: https://microservices.io/patterns/data/transactional-outbox.html
- Java SE Documentation — JDBC and exception model references through Java platform documentation: https://docs.oracle.com/en/java/javase/

---

# End of Part 014

Part berikutnya: **Part 015 — Idempotency as Core Reliability Primitive**.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-reliability-part-013.md](./learn-java-reliability-part-013.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-reliability-part-015.md](./learn-java-reliability-part-015.md)

</div>
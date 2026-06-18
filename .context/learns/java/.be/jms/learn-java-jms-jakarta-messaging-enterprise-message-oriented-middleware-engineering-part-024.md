# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-024

# Part 24 — Idempotency and Deduplication Engineering: Dari API Design sampai Database Constraint

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Part: `024`  
> Topik: Idempotency, deduplication, inbox pattern, replay-safe handler, database constraint, dan state transition correctness  
> Target Java: Java 8 sampai Java 25  
> API terkait: JMS 1.1/2.0 `javax.jms`, Jakarta Messaging 3.x `jakarta.jms`

---

## 1. Tujuan Part Ini

Setelah mempelajari part ini, tujuan utamanya bukan hanya bisa berkata “buat consumer idempotent”. Tujuannya adalah mampu **mendesain, mengimplementasikan, menguji, dan mengoperasikan handler JMS yang tetap benar walaupun message dikirim ulang, diterima ganda, diproses ulang, atau direplay secara manual**.

Di sistem messaging enterprise, duplicate bukan edge case. Duplicate adalah konsekuensi normal dari delivery guarantee yang realistis.

Jika sistem memakai JMS dengan persistent delivery, acknowledgement, transaksi lokal, broker failover, consumer crash, network timeout, atau replay dari DLQ, maka duplicate harus dianggap sebagai bagian dari desain.

Part ini membahas:

1. Mengapa duplicate message dapat terjadi walaupun broker terlihat reliable.
2. Perbedaan idempotency dan deduplication.
3. Kenapa “cek dulu lalu insert” sering salah jika tidak atomic.
4. Cara mendesain idempotency key yang benar.
5. Cara membangun inbox table untuk consumer.
6. Cara memakai database constraint sebagai guardrail utama.
7. Cara membuat handler aman terhadap replay.
8. Cara mengelola duplicate untuk command, event, request/reply, dan saga.
9. Cara mendesain TTL dedup cache tanpa mengorbankan correctness.
10. Cara menguji failure window: crash sebelum ack, crash sesudah commit, duplicate redelivery, dan replay manual.

---

## 2. Posisi Part Ini dalam Seri

Part sebelumnya sudah membahas:

- queue semantics,
- topic semantics,
- acknowledgement,
- transaction model,
- reliability semantics,
- ordering,
- redelivery/retry/DLQ,
- request/reply,
- selectors,
- security,
- broker architecture,
- provider differences,
- Jakarta EE/Spring integration,
- JMS in microservices,
- schema and contract engineering.

Part ini adalah sambungan langsung dari Part 11 dan Part 13.

Part 11 menjelaskan bahwa **effectively-once** jauh lebih realistis daripada “exactly-once end-to-end”.  
Part 13 menjelaskan bahwa redelivery, DLQ, dan replay adalah realitas operasi.

Part ini menjawab pertanyaan berikut:

> Jika message bisa duplicate, bagaimana desain application state supaya tetap benar?

---

## 3. Core Mental Model

### 3.1 Messaging Reliability Berhenti di Boundary Tertentu

JMS/broker bisa membantu message tidak mudah hilang, tetapi broker tidak tahu apakah side effect bisnis sudah benar-benar terjadi.

Contoh:

```text
Consumer menerima message
  -> update database berhasil
  -> consumer crash sebelum ack
  -> broker mengirim ulang message
  -> consumer memproses lagi
```

Dari sudut broker:

```text
Message belum di-ack
Maka message harus dikirim ulang
```

Dari sudut database:

```text
Side effect pertama sudah terjadi
```

Dari sudut bisnis:

```text
Apakah side effect kedua boleh terjadi?
```

Inilah gap fundamental.

Broker tidak bisa otomatis tahu bahwa `approve case`, `charge payment`, `send email`, `create task`, `advance workflow`, atau `generate license` sudah terjadi.

Karena itu correctness harus dirancang di application layer.

---

### 3.2 Idempotency Adalah Properti Operasi, Bukan Properti Broker

Operasi disebut idempotent jika menjalankannya satu kali atau berkali-kali dengan input yang sama menghasilkan state akhir yang sama secara aman.

Contoh idempotent:

```text
Set application status to APPROVED if current status is SUBMITTED
```

Jika message yang sama diproses ulang, status tetap `APPROVED`.

Contoh tidak idempotent:

```text
Increment retry_count by 1
Insert new audit row without duplicate guard
Send email every time handler runs
Debit balance by amount
Create new task without unique business key
```

Masalahnya, banyak operasi bisnis terlihat sederhana tetapi sebenarnya tidak idempotent.

---

### 3.3 Deduplication Adalah Mekanisme; Idempotency Adalah Sifat Desain

Deduplication berarti sistem mendeteksi bahwa message sudah pernah diproses lalu mengabaikan, mengembalikan hasil lama, atau menjalankan path khusus.

Idempotency berarti pemrosesan ulang tidak merusak state.

Keduanya berbeda.

```text
Idempotency:
  Operasi aman dijalankan ulang.

Deduplication:
  Sistem mengenali input duplicate lalu mencegah efek ganda.
```

Deduplication membantu idempotency, tetapi tidak menggantikannya.

Sistem top-tier biasanya memakai keduanya:

```text
1. Message punya idempotency key.
2. Consumer mencatat key di inbox/dedup table secara atomic.
3. Business operation dirancang sebagai state transition yang aman.
4. External side effect diberi idempotency key atau outbox.
5. Replay tooling menghormati key dan policy.
```

---

## 4. Mengapa Duplicate Message Terjadi?

Duplicate dapat terjadi karena beberapa failure window.

### 4.1 Consumer Crash Setelah Side Effect, Sebelum Ack

```text
1. Consumer receive message M1.
2. Consumer update database berhasil.
3. Consumer crash sebelum session commit / ack.
4. Broker menganggap M1 belum selesai.
5. Broker redeliver M1.
```

Ini failure window paling umum.

Jika handler tidak idempotent, side effect terjadi dua kali.

---

### 4.2 Commit JMS Berhasil tetapi Client Tidak Tahu

```text
1. Producer mengirim message persistent.
2. Broker berhasil persist.
3. Response ack ke producer timeout.
4. Producer retry send.
5. Broker menerima duplicate logical message.
```

Dari producer, send pertama terlihat gagal.  
Dari broker, send pertama sudah masuk.

Jika producer retry tanpa stable business key, duplicate logical command masuk ke sistem.

---

### 4.3 Broker Failover dan Redelivery

Pada HA/failover, broker dapat mengirim ulang message yang status ack/commit-nya belum sepenuhnya tersinkronisasi atau belum terlihat oleh node baru.

Provider berbeda dapat memiliki detail behavior berbeda, tetapi prinsipnya sama:

```text
Jika sistem tidak yakin message sudah selesai, pilihan aman adalah redeliver.
```

Redelivery lebih aman daripada loss, tetapi memindahkan beban correctness ke consumer.

---

### 4.4 Manual Replay dari DLQ

Operator bisa memperbaiki data lalu replay message dari DLQ.

Replay dapat berisi:

- message yang benar-benar belum pernah sukses,
- message yang sebenarnya sudah sukses tetapi ack gagal,
- message lama dengan schema lama,
- message yang dependency-nya sudah berubah,
- message yang state target-nya sudah berpindah.

Karena itu replay harus dianggap sebagai duplicate-prone operation.

---

### 4.5 Request/Reply Timeout

```text
1. Client kirim request.
2. Server proses sukses.
3. Reply terlambat.
4. Client timeout lalu retry request.
5. Server menerima request duplicate.
```

Timeout bukan bukti bahwa request gagal.

Timeout hanya berarti caller tidak menerima hasil tepat waktu.

---

### 4.6 Producer Restart dan Outbox Relay Retry

Dalam outbox pattern:

```text
1. Service menulis outbox row.
2. Relay publish message.
3. Relay crash sebelum mark outbox row as published.
4. Relay restart.
5. Relay publish row yang sama lagi.
```

Outbox mencegah message hilang dari database transaction, tetapi relay tetap dapat mengirim duplicate.

Karena itu consumer tetap perlu idempotent.

---

## 5. Taxonomy: Duplicate Bisa Terjadi di Banyak Layer

Duplicate bukan hanya “message id sama dua kali”. Ada beberapa bentuk duplicate.

### 5.1 Transport Duplicate

Broker mengirim ulang message yang sama.

Ciri umum:

- `JMSRedelivered = true`,
- delivery count meningkat jika provider expose property,
- `JMSMessageID` bisa sama untuk redelivery message yang sama.

Tetapi jangan bergantung hanya pada `JMSMessageID` untuk business idempotency.

---

### 5.2 Logical Duplicate

Dua message berbeda secara transport, tetapi mewakili operasi bisnis yang sama.

Contoh:

```text
Message A:
  JMSMessageID = ID:broker-1001
  commandId    = approve-CASE-123-v7

Message B:
  JMSMessageID = ID:broker-1009
  commandId    = approve-CASE-123-v7
```

Secara broker message berbeda.  
Secara bisnis keduanya command yang sama.

Logical duplicate harus dideteksi dengan business idempotency key.

---

### 5.3 Semantic Duplicate

Dua message berbeda tetapi efeknya secara domain sama.

Contoh:

```text
approve CASE-123 by Officer A
approve CASE-123 by Officer A again
```

Mungkin commandId berbeda, tetapi state transition kedua tidak valid karena case sudah approved.

Semantic duplicate harus ditangani oleh domain invariant.

---

### 5.4 Replay Duplicate

Message lama diproses ulang setelah state bisnis sudah berubah jauh.

Contoh:

```text
M1: Submit application
M2: Approve application
M3: Issue license

Operator replay M1 karena pernah ada DLQ lama.
```

Jika handler tidak memeriksa state/version, replay M1 bisa merusak state.

---

## 6. JMS Message ID vs Business Idempotency Key

### 6.1 `JMSMessageID` Tidak Cukup sebagai Idempotency Key Bisnis

`JMSMessageID` adalah identifier dari provider/broker untuk message tertentu. Ia berguna untuk tracing dan observability.

Namun untuk idempotency bisnis, `JMSMessageID` sering tidak cukup karena:

1. Producer retry dapat menghasilkan message baru dengan `JMSMessageID` berbeda.
2. Outbox relay duplicate publish dapat menghasilkan message ID berbeda.
3. Migration/replay dapat membuat message baru dengan ID baru.
4. Cross-broker bridge dapat mengubah metadata.
5. Business operation yang sama bisa muncul dalam transport envelope berbeda.

Gunakan `JMSMessageID` untuk forensic tracing, bukan sebagai satu-satunya business dedup key.

---

### 6.2 Business Idempotency Key Harus Stabil

Idempotency key harus berasal dari identitas operasi bisnis, bukan dari kondisi runtime yang berubah.

Contoh buruk:

```text
idempotencyKey = UUID.randomUUID()
```

Ini tidak membantu, karena setiap retry mendapat key baru.

Contoh lebih baik:

```text
idempotencyKey = commandId
```

Contoh untuk command:

```json
{
  "messageType": "ApproveCaseCommand",
  "messageId": "msg-7f2a",
  "commandId": "cmd-2026-000091",
  "caseId": "CASE-123",
  "expectedVersion": 7,
  "approvedBy": "officer-01"
}
```

`commandId` harus dibuat sekali di edge/system asal dan dipertahankan pada retry.

---

### 6.3 Key Bisa Berbeda Berdasarkan Use Case

Tidak ada satu key universal.

| Use Case | Candidate Idempotency Key | Catatan |
|---|---|---|
| Command dari UI | `commandId` | Dibuat saat user action pertama kali diterima |
| Integration command dari service lain | `sourceSystem + sourceCommandId` | Hindari collision antar source |
| Domain event | `aggregateId + aggregateVersion + eventType` | Event version harus monotonik |
| Payment/debit | `paymentInstructionId` | Harus sama untuk retry payment yang sama |
| Email notification | `notificationIntentId` | Jangan pakai random email id tiap retry |
| Case workflow transition | `caseId + transitionId` atau `caseId + expectedVersion + action` | Tergantung domain invariant |
| Scheduled job message | `jobName + scheduledFireTime + targetId` | Hindari duplicate akibat scheduler retry |
| DLQ replay | original business key | Jangan generate key baru saat replay |

---

## 7. Desain Envelope untuk Idempotency

Part 23 sudah membahas schema/contract. Di sini kita spesifik pada field idempotency.

Contoh envelope:

```json
{
  "envelopeVersion": 1,
  "messageId": "msg-01HZZZ0001",
  "messageType": "CaseApprovedEvent",
  "idempotencyKey": "case:CASE-123:event:approved:v8",
  "correlationId": "corr-abc-123",
  "causationId": "cmd-approve-CASE-123-v7",
  "sourceSystem": "case-service",
  "occurredAt": "2026-06-18T10:15:30Z",
  "schemaVersion": "1.0",
  "payload": {
    "caseId": "CASE-123",
    "caseVersion": 8,
    "approvedBy": "officer-01"
  }
}
```

Field penting:

| Field | Fungsi |
|---|---|
| `messageId` | Identifier envelope/message logical |
| `idempotencyKey` | Key utama dedup consumer |
| `correlationId` | Trace end-to-end flow |
| `causationId` | Message/command penyebab message ini |
| `sourceSystem` | Namespace key dan audit source |
| `occurredAt` | Waktu kejadian domain/source |
| `schemaVersion` | Deserialization/compatibility |
| `payload.caseVersion` | Guard ordering/state transition |

Rule penting:

```text
idempotencyKey harus stabil across retry, replay, failover, dan publish ulang.
```

---

## 8. Pattern Utama: Inbox Table

### 8.1 Apa Itu Inbox Pattern?

Inbox pattern adalah pola consumer mencatat message yang diterima/diproses di database lokal service.

Tujuannya:

1. Mendeteksi duplicate.
2. Menyimpan status processing.
3. Membuat processing replay-safe.
4. Memberi audit trail consumer.
5. Menjadi boundary atomic antara dedup dan business side effect.

Skema konseptual:

```text
BROKER -> CONSUMER -> INBOX TABLE + BUSINESS TABLES
```

Inbox table biasanya berada di database service consumer, bukan database broker.

---

### 8.2 Minimal Inbox Table

Contoh PostgreSQL/Oracle-like conceptual schema:

```sql
CREATE TABLE message_inbox (
    consumer_name        VARCHAR(100) NOT NULL,
    idempotency_key      VARCHAR(300) NOT NULL,
    source_system        VARCHAR(100) NOT NULL,
    message_type         VARCHAR(150) NOT NULL,
    message_id           VARCHAR(150),
    correlation_id       VARCHAR(150),
    causation_id         VARCHAR(150),
    status               VARCHAR(30) NOT NULL,
    received_at          TIMESTAMP NOT NULL,
    started_at           TIMESTAMP,
    completed_at         TIMESTAMP,
    failed_at            TIMESTAMP,
    attempt_count        INTEGER NOT NULL,
    last_error_code      VARCHAR(100),
    last_error_message   VARCHAR(1000),
    payload_hash         VARCHAR(128),
    payload_snapshot     CLOB,
    PRIMARY KEY (consumer_name, idempotency_key)
);
```

Primary key:

```text
(consumer_name, idempotency_key)
```

Kenapa `consumer_name` masuk key?

Karena message yang sama mungkin valid diproses oleh beberapa consumer berbeda.

Contoh:

```text
CaseApprovedEvent
  -> notification-consumer
  -> reporting-consumer
  -> compliance-consumer
```

Masing-masing consumer perlu status dedup sendiri.

---

### 8.3 Inbox Status

Status umum:

| Status | Arti |
|---|---|
| `RECEIVED` | Message sudah dicatat, belum diproses |
| `PROCESSING` | Handler sedang memproses |
| `COMPLETED` | Business side effect selesai |
| `FAILED_RETRYABLE` | Gagal transient, boleh retry |
| `FAILED_PERMANENT` | Gagal permanent, perlu operator action |
| `SKIPPED_DUPLICATE` | Duplicate terdeteksi dan diabaikan |
| `IGNORED_STALE` | Message valid tapi sudah stale secara domain |

Namun minimal untuk idempotency, sering cukup:

```text
COMPLETED / not completed
```

Terlalu banyak status bisa memperumit jika tidak ada operational use case.

---

## 9. Atomicity: Dedup dan Side Effect Harus dalam Transaksi yang Sama

### 9.1 Anti-Pattern: Check Then Act Tanpa Constraint

Kode buruk:

```java
if (!inboxRepository.exists(consumerName, idempotencyKey)) {
    businessService.apply(message);
    inboxRepository.insertCompleted(consumerName, idempotencyKey);
}
```

Masalah race condition:

```text
Consumer A cek: belum ada
Consumer B cek: belum ada
Consumer A apply business side effect
Consumer B apply business side effect
Consumer A insert inbox
Consumer B insert inbox gagal / atau sukses jika tidak unique
```

Walaupun queue biasanya satu message ke satu consumer, duplicate logical bisa masuk dari retry producer, replay, bridge, atau manual republish.

Correctness tidak boleh bergantung pada asumsi tidak ada concurrency.

---

### 9.2 Gunakan Unique Constraint sebagai Arbiter

Database constraint harus menjadi sumber kebenaran dedup.

Pola:

```text
1. Coba insert inbox row dengan unique key.
2. Jika insert sukses, consumer ini pemilik processing.
3. Jika insert duplicate key, message sudah pernah diterima/diproses.
4. Handler mengambil keputusan berdasarkan status existing.
```

Constraint adalah primitive concurrency yang kuat.

---

### 9.3 Transaksi Ideal

```text
BEGIN DB TRANSACTION

  INSERT INTO message_inbox(... idempotency_key ..., status='PROCESSING')
  -- jika duplicate key: handle duplicate path

  Apply business state change

  UPDATE message_inbox SET status='COMPLETED'

COMMIT DB TRANSACTION

ACK / COMMIT JMS SESSION
```

Atomicity yang diinginkan:

```text
Inbox marker dan business side effect commit bersama.
```

Jika DB commit sukses tetapi JMS ack gagal, message akan redeliver, tetapi inbox sudah tahu bahwa message pernah selesai.

---

## 10. Consumer Algorithm yang Benar

### 10.1 Pseudocode High-Level

```text
onMessage(message):
  parsed = parse(message)
  key = parsed.idempotencyKey

  begin db transaction
    try insert inbox processing row
      if duplicate:
        existing = load inbox row
        if existing.status == COMPLETED:
          commit db transaction
          ack message
          return
        if existing.status == PROCESSING and old/stuck:
          decide recovery policy
        if existing.status == FAILED_RETRYABLE:
          decide retry policy
        else:
          decide skip/fail

    validate domain state
      if stale/already applied:
        mark inbox completed or ignored_stale
        commit
        ack
        return

    apply business side effect
    mark inbox completed
  commit db transaction

  ack message
```

Important invariant:

```text
Do not ack JMS before durable business decision is committed.
```

---

### 10.2 Java 8 Style Example dengan `javax.jms.MessageListener`

Contoh ini konseptual. Repository dan transaction abstraction disederhanakan.

```java
import javax.jms.Message;
import javax.jms.MessageListener;
import javax.jms.TextMessage;

public final class IdempotentCaseApprovedListener implements MessageListener {

    private final TransactionTemplate tx;
    private final InboxRepository inbox;
    private final CaseRepository cases;
    private final JsonMessageParser parser;
    private final String consumerName = "case-approved-consumer";

    public IdempotentCaseApprovedListener(
            TransactionTemplate tx,
            InboxRepository inbox,
            CaseRepository cases,
            JsonMessageParser parser) {
        this.tx = tx;
        this.inbox = inbox;
        this.cases = cases;
        this.parser = parser;
    }

    @Override
    public void onMessage(Message jmsMessage) {
        try {
            CaseApprovedEvent event = parse(jmsMessage);

            tx.execute(() -> {
                InboxInsertResult insert = inbox.tryInsertProcessing(
                        consumerName,
                        event.idempotencyKey(),
                        event.sourceSystem(),
                        event.messageType(),
                        event.messageId(),
                        event.correlationId(),
                        event.payloadHash()
                );

                if (insert == InboxInsertResult.DUPLICATE) {
                    InboxRecord existing = inbox.findRequired(consumerName, event.idempotencyKey());

                    if (existing.isCompleted()) {
                        return null;
                    }

                    if (existing.isIgnoredStale()) {
                        return null;
                    }

                    throw new DuplicateInProgressException(
                            "Duplicate message is not completed yet: " + event.idempotencyKey());
                }

                CaseAggregate aggregate = cases.findForUpdate(event.caseId());

                if (aggregate == null) {
                    inbox.markFailedPermanent(
                            consumerName,
                            event.idempotencyKey(),
                            "CASE_NOT_FOUND",
                            "Case not found: " + event.caseId());
                    return null;
                }

                if (aggregate.version() >= event.caseVersion()) {
                    inbox.markIgnoredStale(
                            consumerName,
                            event.idempotencyKey(),
                            "Aggregate already at version " + aggregate.version());
                    return null;
                }

                aggregate.applyApprovedEvent(event);
                cases.save(aggregate);

                inbox.markCompleted(consumerName, event.idempotencyKey());
                return null;
            });
        } catch (RuntimeException ex) {
            // In container-managed/session-transacted setup, throwing causes rollback/redelivery.
            // In manual CLIENT_ACK mode, do not acknowledge on failure.
            throw ex;
        }
    }

    private CaseApprovedEvent parse(Message message) {
        try {
            if (!(message instanceof TextMessage)) {
                throw new IllegalArgumentException("Expected TextMessage");
            }
            String json = ((TextMessage) message).getText();
            return parser.parseCaseApprovedEvent(json);
        } catch (Exception ex) {
            throw new MessageParsingException("Cannot parse message", ex);
        }
    }
}
```

Catatan:

1. `tryInsertProcessing` harus memakai unique constraint.
2. `findForUpdate` dipakai untuk menjaga state transition aggregate agar tidak race.
3. Stale event tidak selalu error; bisa menjadi no-op yang diaudit.
4. Exception dilempar agar container/session melakukan rollback jika memang retry diinginkan.
5. Untuk permanent error, jangan retry tanpa batas; mark permanent dan routing ke DLQ/parking lot perlu policy.

---

### 10.3 Modern Jakarta Style dengan `jakarta.jms.MessageListener`

```java
import jakarta.jms.Message;
import jakarta.jms.MessageListener;
import jakarta.jms.TextMessage;

public final class JakartaIdempotentListener implements MessageListener {

    private final UnitOfWork unitOfWork;
    private final InboxService inboxService;
    private final BusinessHandler businessHandler;

    public JakartaIdempotentListener(
            UnitOfWork unitOfWork,
            InboxService inboxService,
            BusinessHandler businessHandler) {
        this.unitOfWork = unitOfWork;
        this.inboxService = inboxService;
        this.businessHandler = businessHandler;
    }

    @Override
    public void onMessage(Message message) {
        ReceivedEnvelope envelope = readEnvelope(message);

        unitOfWork.inTransaction(() -> {
            IdempotencyDecision decision = inboxService.claim(
                    "regulatory-case-consumer",
                    envelope.idempotencyKey(),
                    envelope.messageType(),
                    envelope.messageId(),
                    envelope.correlationId());

            switch (decision.kind()) {
                case ALREADY_COMPLETED:
                    return;
                case CLAIMED:
                    ProcessingResult result = businessHandler.handle(envelope);
                    inboxService.finish(envelope.idempotencyKey(), result);
                    return;
                case IN_PROGRESS:
                    throw new RetryLaterException("Duplicate is currently in progress");
                case PERMANENTLY_FAILED:
                    return;
                default:
                    throw new IllegalStateException("Unsupported decision: " + decision.kind());
            }
        });
    }

    private ReceivedEnvelope readEnvelope(Message message) {
        try {
            if (!(message instanceof TextMessage textMessage)) {
                throw new IllegalArgumentException("Expected TextMessage");
            }
            return ReceivedEnvelope.fromJson(textMessage.getText());
        } catch (Exception ex) {
            throw new MessageParsingException("Invalid JMS message", ex);
        }
    }
}
```

Catatan Java version:

- Pattern matching `instanceof` seperti `message instanceof TextMessage textMessage` tersedia di Java modern, bukan Java 8.
- Untuk Java 8, gunakan cast eksplisit.
- Konsep idempotency tidak bergantung pada versi Java.

---

## 11. Database Constraint Patterns

### 11.1 Unique Key untuk Message Processing

```sql
ALTER TABLE message_inbox
ADD CONSTRAINT uq_message_inbox_consumer_key
UNIQUE (consumer_name, idempotency_key);
```

Ini guardrail paling penting.

---

### 11.2 Unique Key untuk Business Side Effect

Inbox saja kadang tidak cukup. Business table juga harus punya unique guard.

Contoh task generation:

```sql
CREATE TABLE case_task (
    task_id           VARCHAR(100) PRIMARY KEY,
    case_id           VARCHAR(100) NOT NULL,
    task_type         VARCHAR(100) NOT NULL,
    source_event_key  VARCHAR(300) NOT NULL,
    status            VARCHAR(30) NOT NULL,
    created_at        TIMESTAMP NOT NULL,
    CONSTRAINT uq_case_task_source_event UNIQUE (source_event_key)
);
```

Jika duplicate melewati layer inbox karena bug atau consumer name berubah, business constraint masih mencegah task duplicate.

Top-tier design memakai **defense in depth**:

```text
Message inbox constraint
+ business natural key constraint
+ state machine guard
+ observability alert
```

---

### 11.3 Unique Key untuk State Transition

Untuk workflow/case management:

```sql
CREATE TABLE case_transition_log (
    transition_id      VARCHAR(150) PRIMARY KEY,
    case_id            VARCHAR(100) NOT NULL,
    from_status        VARCHAR(50) NOT NULL,
    to_status          VARCHAR(50) NOT NULL,
    expected_version   BIGINT NOT NULL,
    new_version        BIGINT NOT NULL,
    command_id         VARCHAR(150) NOT NULL,
    created_at         TIMESTAMP NOT NULL,
    CONSTRAINT uq_case_transition_command UNIQUE (command_id),
    CONSTRAINT uq_case_transition_version UNIQUE (case_id, new_version)
);
```

Ini mencegah:

- command sama dieksekusi dua kali,
- dua transisi menghasilkan version sama,
- replay mengubah state tanpa trace.

---

## 12. Idempotency untuk Berbagai Jenis Message

### 12.1 Command Message

Command berarti instruksi untuk melakukan sesuatu.

Contoh:

```text
ApproveCaseCommand
GenerateInvoiceCommand
SendReminderCommand
CreateInspectionTaskCommand
```

Command harus punya `commandId`.

Rule:

```text
Retry command yang sama harus memakai commandId yang sama.
```

Command handler harus memeriksa:

1. Apakah commandId sudah pernah selesai?
2. Apakah target aggregate ada?
3. Apakah state target masih memungkinkan command?
4. Apakah expectedVersion cocok?
5. Apakah side effect eksternal juga idempotent?

Contoh invariant:

```text
ApproveCaseCommand hanya valid jika case.status = SUBMITTED dan case.version = expectedVersion.
```

Jika duplicate datang setelah status berubah ke APPROVED:

```text
Jika commandId sama: return previous success / no-op.
Jika commandId beda tetapi action sama: reject as invalid duplicate or conflict.
```

---

### 12.2 Domain Event

Domain event menyatakan sesuatu sudah terjadi.

Contoh:

```text
CaseApprovedEvent
LicenseIssuedEvent
PaymentReceivedEvent
InspectionCompletedEvent
```

Event idempotency key sering berbasis aggregate version:

```text
aggregateType + aggregateId + eventVersion
```

Contoh:

```text
Case:CASE-123:version:8:CaseApprovedEvent
```

Consumer harus menjaga:

1. Event lama tidak merusak projection.
2. Event duplicate tidak membuat row duplicate.
3. Event out-of-order tidak langsung diproses jika membutuhkan order.
4. Projection punya last_processed_version per aggregate jika ordering penting.

---

### 12.3 Integration Event

Integration event adalah event yang dikirim untuk service lain, bukan selalu event internal domain murni.

Ia harus lebih stabil dan compatibility-friendly.

Idempotency key bisa berupa:

```text
sourceSystem + eventId
```

atau:

```text
sourceSystem + aggregateId + aggregateVersion
```

Jangan ganti idempotency key hanya karena payload schema berubah.

---

### 12.4 Request/Reply

Request harus punya request id stabil.

```text
requestId = sourceSystem + businessOperationId
```

Server menyimpan hasil request:

```text
request_id | status | response_payload | completed_at
```

Jika request duplicate datang:

- jika completed, return cached response,
- jika processing, return in-progress/timeout/retry later,
- jika failed permanent, return same failure,
- jika retryable, sesuai policy.

Ini mirip idempotency key di HTTP APIs.

---

### 12.5 Notification Message

Notification sering dianggap aman duplicate, padahal tidak selalu.

Duplicate email/SMS bisa menjadi masalah compliance dan user trust.

Gunakan key:

```text
notificationIntentId
```

Contoh:

```text
case:CASE-123:notify:approval:v8:recipient:user-77
```

Business table:

```sql
CREATE TABLE notification_outbox (
    notification_intent_id VARCHAR(300) PRIMARY KEY,
    channel                VARCHAR(30) NOT NULL,
    recipient              VARCHAR(300) NOT NULL,
    subject                VARCHAR(500),
    body                   CLOB,
    status                 VARCHAR(30) NOT NULL,
    provider_message_id    VARCHAR(200),
    created_at             TIMESTAMP NOT NULL,
    sent_at                TIMESTAMP
);
```

Jika JMS duplicate masuk, insert duplicate gagal dan tidak mengirim email ulang.

---

## 13. Idempotency dan State Machine

Untuk sistem case management/regulatory lifecycle, idempotency terbaik sering berasal dari state machine.

### 13.1 Transition Guard

```text
Current state: SUBMITTED
Command: APPROVE
Expected version: 7
Allowed transition: SUBMITTED -> APPROVED
```

Handler:

```text
if command already processed:
  no-op / return previous result
else if current version != expectedVersion:
  reject stale/conflict
else if transition not allowed:
  reject invalid
else:
  apply transition and record commandId
```

---

### 13.2 Duplicate vs Conflict

Tidak semua “sudah berubah” berarti duplicate.

Contoh:

```text
Command A: approve CASE-123 expectedVersion=7 commandId=cmd-A
Command B: reject CASE-123 expectedVersion=7 commandId=cmd-B
```

Jika A sudah commit, B bukan duplicate. B adalah conflict/stale command.

Bedakan:

| Kondisi | Makna | Response |
|---|---|---|
| Same commandId already completed | Duplicate retry | Return success/no-op |
| Different commandId, same target, same old version | Conflict/stale | Reject or compensate |
| Same event version already applied | Duplicate event | No-op |
| Older event version | Stale replay | Ignore/audit |
| Future event version | Gap/out-of-order | Park/retry |

---

### 13.3 Version as Idempotency and Ordering Guard

Aggregate version sangat berguna.

```text
Case version 7 -> Approve -> Case version 8
```

Event:

```json
{
  "eventType": "CaseApprovedEvent",
  "caseId": "CASE-123",
  "previousVersion": 7,
  "newVersion": 8,
  "idempotencyKey": "case:CASE-123:event:v8"
}
```

Projection consumer:

```text
if event.newVersion <= projection.lastVersion:
  duplicate/stale -> ignore
if event.previousVersion != projection.lastVersion:
  gap/out-of-order -> park/retry
else:
  apply and set lastVersion = event.newVersion
```

---

## 14. External Side Effects

Idempotency menjadi lebih sulit jika handler memanggil sistem eksternal.

Contoh side effect eksternal:

- send email,
- call payment gateway,
- create document in DMS,
- call government API,
- issue certificate,
- push notification,
- submit report to external agency.

### 14.1 Jangan Panggil Eksternal Langsung Tanpa Outbox

Anti-pattern:

```text
onMessage:
  update DB
  call external API
  ack JMS
```

Failure window:

```text
DB commit sukses
external API sukses
consumer crash sebelum ack
message redeliver
external API dipanggil lagi
```

Lebih aman:

```text
onMessage:
  dalam DB transaction:
    record inbox
    update business state
    insert external_outbox intent with unique key
    mark inbox complete
  ack JMS

separate relay:
  send external request using idempotency key
  mark external_outbox sent
```

---

### 14.2 Jika Eksternal Mendukung Idempotency Key

Gunakan key yang sama pada retry.

```text
External-Idempotency-Key: paymentInstructionId
```

atau payload:

```json
{
  "requestId": "case:CASE-123:issue-license:v9",
  "caseId": "CASE-123"
}
```

Jika eksternal tidak mendukung idempotency, maka internal harus lebih hati-hati:

1. Simpan intent.
2. Simpan request hash.
3. Simpan response/result.
4. Jangan retry otomatis untuk ambiguous timeout tanpa reconciliation.
5. Sediakan operator workflow.

---

### 14.3 Ambiguous Timeout

Timeout bukan gagal.

```text
Consumer call external API
External API memproses sukses
Response timeout
Consumer tidak tahu hasil
```

Retry bisa menyebabkan duplicate external side effect.

Untuk external side effect berbahaya, policy harus:

```text
timeout -> UNKNOWN
UNKNOWN -> reconcile/check status
not immediate retry blindly
```

---

## 15. TTL Dedup Cache: Berguna, Tapi Bukan Source of Truth

### 15.1 Kapan Cache Berguna?

Dedup cache berguna untuk mengurangi beban DB ketika duplicate burst terjadi.

Contoh:

```text
Redis SETNX idempotencyKey ttl=24h
```

Namun cache tidak boleh menjadi satu-satunya guard untuk operation yang critical.

Kenapa?

1. Cache bisa evict.
2. Cache bisa restart.
3. TTL bisa expire sebelum replay lama.
4. Race condition jika tidak atomic dengan DB side effect.
5. Cache update bisa sukses sementara DB gagal.

Gunakan cache sebagai fast path, bukan correctness path.

---

### 15.2 Safe Cache Pattern

```text
1. Check cache.
2. Jika cache says completed, boleh short-circuit hanya untuk low-risk operation atau setelah yakin durable record ada.
3. Jika cache miss, masuk DB inbox transaction.
4. Setelah DB commit completed, populate cache.
```

Source of truth tetap DB.

---

### 15.3 TTL Harus Berdasarkan Replay Window

TTL tidak boleh asal.

Pertimbangkan:

- maksimum broker retention,
- maksimum DLQ replay age,
- audit/legal replay period,
- message expiry policy,
- operational incident recovery SLA,
- business duplicate risk.

Jika message dapat direplay 90 hari kemudian, cache TTL 24 jam tidak cukup sebagai dedup utama.

---

## 16. Payload Hash dan Duplicate Mismatch

Duplicate dengan idempotency key sama tetapi payload berbeda adalah sinyal bahaya.

Contoh:

```text
idempotencyKey = cmd-123
payload A = approve CASE-123 by officer A
payload B = approve CASE-999 by officer A
```

Ini bukan duplicate sehat. Ini idempotency key collision atau producer bug.

Karena itu inbox sebaiknya menyimpan `payload_hash`.

Saat duplicate datang:

```text
if same key and same payload hash:
  duplicate normal
if same key but different payload hash:
  reject as idempotency conflict
  alert
```

Contoh:

```java
if (existing.payloadHash() != null && !existing.payloadHash().equals(envelope.payloadHash())) {
    throw new IdempotencyConflictException(
            "Same idempotency key but different payload hash: " + envelope.idempotencyKey());
}
```

---

## 17. Handling Duplicate Path

Saat duplicate terdeteksi, jangan selalu langsung ack tanpa berpikir.

### 17.1 Existing Status: COMPLETED

```text
Action:
  no-op
  optionally log at debug/info
  ack message
```

Ini duplicate normal.

---

### 17.2 Existing Status: PROCESSING

Kemungkinan:

1. Consumer lain sedang proses.
2. Consumer lama crash dan status stuck.
3. Long-running process belum selesai.

Policy:

```text
if processing age < threshold:
  rollback / retry later
else:
  mark as stale processing and recover based on lock policy
```

Hati-hati mengambil alih PROCESSING. Pastikan tidak ada worker aktif yang masih berjalan.

---

### 17.3 Existing Status: FAILED_RETRYABLE

Bisa diproses ulang jika policy mengizinkan.

Pastikan attempt count/backoff dikendalikan.

---

### 17.4 Existing Status: FAILED_PERMANENT

Jangan retry otomatis kecuali ada operator action atau data repair.

Duplicate permanent failure biasanya harus:

```text
ack + leave audit
```

atau:

```text
route to parking lot for investigation
```

---

### 17.5 Existing Status: IGNORED_STALE

Biasanya no-op + ack.

Tetap simpan audit karena replay lama bisa penting secara forensik.

---

## 18. Inbox Claim: SQL Approaches

### 18.1 Insert First Pattern

Generic:

```sql
INSERT INTO message_inbox (
    consumer_name,
    idempotency_key,
    source_system,
    message_type,
    message_id,
    correlation_id,
    status,
    received_at,
    attempt_count,
    payload_hash
) VALUES (?, ?, ?, ?, ?, ?, 'PROCESSING', CURRENT_TIMESTAMP, 1, ?);
```

Jika duplicate key exception:

```text
load existing row and decide
```

---

### 18.2 PostgreSQL `ON CONFLICT DO NOTHING`

```sql
INSERT INTO message_inbox (
    consumer_name,
    idempotency_key,
    source_system,
    message_type,
    message_id,
    correlation_id,
    status,
    received_at,
    attempt_count,
    payload_hash
) VALUES (?, ?, ?, ?, ?, ?, 'PROCESSING', NOW(), 1, ?)
ON CONFLICT (consumer_name, idempotency_key) DO NOTHING;
```

Jika affected row = 1, claim berhasil.  
Jika affected row = 0, duplicate.

---

### 18.3 Oracle Pattern

Oracle dapat memakai insert biasa dan menangkap `ORA-00001` unique constraint violation.

Conceptual Java:

```java
try {
    jdbc.update(insertSql, params);
    return InboxInsertResult.INSERTED;
} catch (DuplicateKeyException ex) {
    return InboxInsertResult.DUPLICATE;
}
```

Jangan membangun correctness dengan `SELECT COUNT(*)` lalu insert tanpa unique constraint.

---

## 19. Isolation Level dan Locking

### 19.1 Unique Constraint Lebih Penting daripada Isolation Tinggi

Serializable isolation bisa mahal. Untuk dedup, unique constraint biasanya cukup dan lebih scalable.

Namun untuk aggregate state transition, gunakan locking/optimistic version.

Options:

1. Pessimistic lock:

```sql
SELECT * FROM cases WHERE case_id = ? FOR UPDATE;
```

2. Optimistic update:

```sql
UPDATE cases
SET status = 'APPROVED', version = version + 1
WHERE case_id = ?
  AND status = 'SUBMITTED'
  AND version = ?;
```

Jika affected rows = 0, command stale/conflict.

---

### 19.2 Atomic State Transition via Conditional Update

Pattern bagus:

```sql
UPDATE case_application
SET status = 'APPROVED',
    version = version + 1,
    approved_by = ?,
    approved_at = CURRENT_TIMESTAMP
WHERE case_id = ?
  AND status = 'SUBMITTED'
  AND version = ?;
```

Jika update sukses:

```text
transition applied
```

Jika update 0 row:

```text
already applied, stale, or invalid transition
```

Lalu cek current state untuk membedakan duplicate vs conflict.

---

## 20. Idempotency dan JMS Ack/Transaction Boundary

### 20.1 Ack Setelah DB Commit

Urutan aman umum:

```text
1. Receive JMS message.
2. Begin DB transaction.
3. Claim inbox.
4. Apply business state.
5. Commit DB transaction.
6. Ack/commit JMS.
```

Jika crash antara 5 dan 6:

```text
Message redelivered.
Inbox says completed.
Consumer no-op and ack.
```

Ini aman.

---

### 20.2 Ack Sebelum DB Commit Itu Berbahaya

```text
1. Ack JMS.
2. DB commit gagal.
```

Hasil:

```text
Message hilang dari broker.
Business side effect tidak terjadi.
```

Ini at-most-once bug.

---

### 20.3 XA Tidak Menghapus Kebutuhan Idempotency

JTA/XA bisa mengurangi beberapa failure window antara JMS dan DB, tetapi tidak menghapus duplicate secara keseluruhan.

Duplicate masih bisa datang dari:

- producer retry,
- outbox relay retry,
- manual replay,
- external side effect timeout,
- logical duplicate,
- cross-system integration.

Karena itu idempotency tetap wajib.

---

## 21. Idempotency di Spring JMS

### 21.1 Listener dengan Transactional DB

Konseptual:

```java
@Component
public class CaseCommandListener {

    private final InboxService inbox;
    private final CaseCommandHandler handler;

    public CaseCommandListener(InboxService inbox, CaseCommandHandler handler) {
        this.inbox = inbox;
        this.handler = handler;
    }

    @JmsListener(destination = "case.approve.command.queue", containerFactory = "jmsListenerContainerFactory")
    @Transactional
    public void onMessage(String json) {
        ApproveCaseCommand command = ApproveCaseCommand.fromJson(json);

        ClaimResult claim = inbox.claim(
                "case-command-listener",
                command.idempotencyKey(),
                command.messageId(),
                command.payloadHash());

        if (claim.isAlreadyCompleted()) {
            return;
        }

        if (claim.isConflict()) {
            throw new IdempotencyConflictException(command.idempotencyKey());
        }

        ProcessingResult result = handler.handle(command);
        inbox.complete(command.idempotencyKey(), result.summary());
    }
}
```

Important:

- DB transaction harus mencakup inbox + business update.
- JMS acknowledgement behavior tergantung listener container/session transaction config.
- Jika method throw exception, pastikan container menganggap processing gagal dan redelivery policy bekerja sesuai desain.

---

### 21.2 Jangan Letakkan Retry Aplikasi yang Menabrak Redelivery Tanpa Desain

Jika Spring Retry membungkus handler dan broker juga punya redelivery, total attempt bisa meledak.

Contoh:

```text
Spring retry 3x
Broker redelivery 10x
Total processing attempt = 30x
```

Jika setiap attempt menyentuh DB/external API, efeknya besar.

Gunakan satu policy yang jelas:

```text
Fast in-memory retry untuk error sangat transient kecil
Broker redelivery untuk retry antar transaksi
DLQ/parking lot untuk error persistent
```

---

## 22. Idempotency untuk Projection / Read Model

Projection consumer sering menerima event untuk membangun read model.

Masalah:

- duplicate event membuat row duplicate,
- out-of-order event membuat projection salah,
- replay lama menimpa data baru.

### 22.1 Projection Checkpoint per Aggregate

```sql
CREATE TABLE projection_checkpoint (
    projection_name       VARCHAR(100) NOT NULL,
    aggregate_type        VARCHAR(100) NOT NULL,
    aggregate_id          VARCHAR(100) NOT NULL,
    last_version          BIGINT NOT NULL,
    last_event_key        VARCHAR(300) NOT NULL,
    updated_at            TIMESTAMP NOT NULL,
    PRIMARY KEY (projection_name, aggregate_type, aggregate_id)
);
```

Handler:

```text
if event.version <= last_version:
  duplicate/stale -> ignore
if event.version > last_version + 1:
  gap -> park/retry
if event.version == last_version + 1:
  apply projection
```

---

### 22.2 Projection Idempotent Upsert

Gunakan upsert/merge berdasarkan natural key.

Contoh:

```sql
MERGE INTO case_read_model target
USING (SELECT ? AS case_id FROM dual) source
ON (target.case_id = source.case_id)
WHEN MATCHED THEN
  UPDATE SET status = ?, version = ?, updated_at = CURRENT_TIMESTAMP
WHEN NOT MATCHED THEN
  INSERT (case_id, status, version, updated_at)
  VALUES (?, ?, ?, CURRENT_TIMESTAMP);
```

Tetap harus dilindungi version check agar stale event tidak overwrite state baru.

---

## 23. Idempotency dan Audit Trail

Audit trail sering sengaja append-only. Tetapi duplicate audit row bisa menyesatkan.

Ada dua jenis audit:

1. **Processing audit**: mencatat setiap attempt.
2. **Business audit**: mencatat perubahan domain yang benar-benar terjadi.

Jangan campur keduanya.

Jika duplicate message diterima:

```text
Processing audit:
  boleh mencatat duplicate received

Business audit:
  jangan mencatat seolah-olah approval terjadi lagi
```

Skema:

```text
message_processing_audit
  - every receive/attempt/duplicate/redelivery

business_audit_trail
  - only actual domain state transition
```

---

## 24. Idempotency dan Replay Tooling

Replay tool harus idempotency-aware.

### 24.1 Replay Jangan Generate Idempotency Key Baru

Anti-pattern:

```text
Operator replay message dari DLQ
Tool membuat message envelope baru dengan idempotencyKey baru
Consumer memproses ulang side effect
```

Replay harus mempertahankan:

- original idempotency key,
- original correlation id,
- original causation id,
- original occurredAt,
- original message type,
- payload hash.

Boleh menambah metadata:

```json
{
  "replay": {
    "replayedAt": "2026-06-18T12:00:00Z",
    "replayedBy": "operator-01",
    "reason": "after data repair",
    "sourceDlqMessageId": "ID:broker-123"
  }
}
```

Tetapi jangan mengubah identitas bisnis operasi.

---

### 24.2 Replay Policy

Replay harus memutuskan:

| Kondisi | Action |
|---|---|
| Message belum pernah completed | process |
| Message completed dengan payload hash sama | no-op/skip |
| Message completed dengan payload hash beda | block + alert |
| Message stale terhadap aggregate version | ignore/mark stale |
| Message schema lama | transform/migrate or park |
| Message permanent failed | require operator override |

---

## 25. Idempotency Key Design Checklist

Key yang baik:

1. Stabil across retry.
2. Dibuat di source of intent, bukan di consumer.
3. Tidak random untuk setiap attempt.
4. Memiliki namespace source/consumer jika perlu.
5. Merepresentasikan operasi bisnis, bukan transport delivery.
6. Tidak terlalu panjang berlebihan.
7. Tidak mengandung PII jika disimpan/logged luas.
8. Dapat diaudit dan ditelusuri.
9. Tidak berubah saat schema payload berubah.
10. Dapat dipakai di external system jika diperlukan.

Contoh format:

```text
<source-system>:<operation-type>:<business-id>:<operation-id-or-version>
```

Contoh:

```text
aceas:case-approval:CASE-123:cmd-20260618-0001
case-service:event:CASE-123:v8
notification:case-approved:CASE-123:user-77:v8
```

---

## 26. Common Anti-Patterns

### 26.1 “Broker Sudah Persistent, Jadi Tidak Perlu Idempotency”

Persistent delivery mengurangi message loss, bukan duplicate business side effect.

---

### 26.2 “Pakai JMSMessageID Saja”

`JMSMessageID` tidak selalu sama untuk logical duplicate.

Gunakan business idempotency key.

---

### 26.3 “Cek Dulu Kalau Belum Ada Baru Insert”

Tanpa unique constraint, ini race-prone.

---

### 26.4 “Duplicate Tinggal Diabaikan Semua”

Duplicate dengan payload hash berbeda adalah bug serius.

---

### 26.5 “Retry Sampai Berhasil”

Retry tanpa classification bisa menyebabkan retry storm, duplicate external side effect, dan DLQ flood.

---

### 26.6 “Replay Pakai Message Baru”

Replay harus mempertahankan identitas operasi asli.

---

### 26.7 “Idempotency Cache Saja Cukup”

Cache tidak cukup untuk correctness critical path.

---

### 26.8 “Semua Operation Bisa Dibuat Idempotent dengan No-op”

Tidak semua duplicate adalah duplicate sehat. Ada conflict, stale command, payload mismatch, dan invalid transition.

---

## 27. Failure Scenario Walkthrough

### 27.1 Crash Setelah DB Commit Sebelum JMS Ack

```text
1. Receive M1.
2. Insert inbox PROCESSING.
3. Apply business state.
4. Mark inbox COMPLETED.
5. Commit DB.
6. Crash sebelum JMS ack.
7. Broker redeliver M1.
8. Consumer insert inbox -> duplicate.
9. Existing status COMPLETED.
10. Consumer no-op and ack.
```

Result:

```text
Correct. Side effect once.
```

---

### 27.2 Duplicate Producer Send dengan JMSMessageID Berbeda

```text
1. Producer send logical command cmd-123.
2. Send succeeds but producer timeout.
3. Producer sends cmd-123 again.
4. Broker stores two messages with different JMSMessageID.
5. Consumer processes first, completes inbox key cmd-123.
6. Consumer receives second, sees same idempotency key cmd-123.
7. No-op.
```

Result:

```text
Correct if idempotency key stable.
```

---

### 27.3 Same Key Different Payload

```text
1. Receive idempotencyKey=cmd-123 payloadHash=A.
2. Completed.
3. Later receive idempotencyKey=cmd-123 payloadHash=B.
```

Correct action:

```text
Do not no-op silently.
Raise idempotency conflict.
Alert.
Route to parking lot.
```

---

### 27.4 Replay Old Event

```text
Projection lastVersion = 10.
Replay event version = 8.
```

Correct action:

```text
Ignore as stale.
Record processing audit.
Do not overwrite projection.
```

---

### 27.5 Future Event Gap

```text
Projection lastVersion = 7.
Receive event version = 9.
```

Correct action:

```text
Do not apply.
Park/retry until version 8 arrives, or trigger repair.
```

---

## 28. Testing Strategy

### 28.1 Unit Tests

Test handler decision logic:

1. New message -> claim -> process -> complete.
2. Duplicate completed -> no-op.
3. Duplicate payload mismatch -> conflict.
4. Stale version -> ignored stale.
5. Future version -> parked/retry.
6. Invalid transition -> permanent failure.

---

### 28.2 Integration Tests with Real DB Constraint

Wajib test unique constraint, bukan mock saja.

Test:

```text
Two concurrent threads process same idempotency key.
Only one business side effect exists.
```

Pseudo:

```java
ExecutorService executor = Executors.newFixedThreadPool(2);
CountDownLatch start = new CountDownLatch(1);

Callable<Void> task = () -> {
    start.await();
    listener.handle(sameMessage);
    return null;
};

Future<Void> f1 = executor.submit(task);
Future<Void> f2 = executor.submit(task);
start.countDown();

await(f1, f2);

assertEquals(1, taskRepository.countBySourceEventKey(idempotencyKey));
assertEquals(1, inboxRepository.countCompleted(consumerName, idempotencyKey));
```

---

### 28.3 Failure Injection Tests

Simulate:

1. Crash/exception after DB commit before ack.
2. Exception before DB commit.
3. Duplicate send with different JMSMessageID.
4. DLQ replay.
5. External timeout ambiguous.
6. Payload hash mismatch.
7. Redelivery after rollback.

---

### 28.4 Replay Tests

Replay tests should verify:

- original idempotency key preserved,
- duplicate completed skipped,
- stale event ignored,
- payload mismatch blocked,
- operator metadata appended but business identity unchanged.

---

## 29. Observability for Idempotency

Metrics:

```text
jms.consumer.messages.received
jms.consumer.messages.completed
jms.consumer.messages.duplicates
jms.consumer.messages.idempotency_conflicts
jms.consumer.messages.stale_ignored
jms.consumer.messages.future_gap
jms.consumer.messages.permanent_failed
jms.consumer.messages.retryable_failed
inbox.processing.stuck.count
inbox.completed.count
inbox.conflict.count
```

Logs should include:

- idempotency key,
- message id,
- JMSMessageID,
- correlation id,
- causation id,
- consumer name,
- delivery count/redelivered flag if available,
- aggregate id/version,
- processing decision.

Example structured log:

```json
{
  "event": "jms_duplicate_message_skipped",
  "consumer": "case-approved-consumer",
  "idempotencyKey": "case:CASE-123:event:v8",
  "jmsMessageId": "ID:broker-123",
  "correlationId": "corr-abc",
  "status": "COMPLETED"
}
```

Alert on:

```text
idempotency_conflicts > 0
stuck PROCESSING rows above threshold
duplicate rate suddenly spikes
future event gap sustained
permanent failures increasing
```

---

## 30. Retention and Cleanup

Inbox table can grow large.

Cleanup must respect replay window.

Do not delete inbox rows earlier than:

```text
max(message retention, DLQ replay period, legal/audit requirement, business dispute window)
```

Possible retention strategy:

| Data | Retention |
|---|---|
| Completed low-risk messages | 30–90 days |
| Financial/legal/regulatory commands | months/years depending policy |
| Permanent failures | until resolved + audit retention |
| Idempotency conflicts | long retention |
| Payload snapshot | shorter, possibly redacted |
| Hash/metadata | longer |

If payload contains sensitive data, prefer storing hash + minimal metadata, not full payload forever.

---

## 31. Performance Considerations

Inbox table adds write cost. But for critical systems, this cost is usually acceptable.

Optimization options:

1. Keep payload snapshot optional.
2. Store payload hash instead of full payload for high-volume stream.
3. Partition inbox table by date.
4. Index by `(consumer_name, status, received_at)` for operations.
5. Use batch cleanup.
6. Use cache as fast path after durable completion.
7. Avoid excessive long text error columns in hot index.
8. Separate processing audit from dedup table if volume high.

Important:

```text
Do not optimize away correctness before measuring.
```

---

## 32. Applying This to Regulatory / Case Management Systems

Untuk sistem enforcement/case management, idempotency sangat penting karena message sering memicu:

- case state transition,
- SLA timer,
- assignment task,
- correspondence/email,
- document generation,
- audit log,
- integration with external agency,
- notification to officer/applicant,
- report/projection update.

Blueprint:

```text
Incoming JMS message
  -> parse envelope
  -> validate schema/version
  -> claim inbox by consumer + idempotency key
  -> lock/load case aggregate
  -> validate expected state/version
  -> apply state transition if valid
  -> write business audit only if transition occurs
  -> insert outbox for email/document/external API
  -> mark inbox completed
  -> commit DB
  -> ack JMS
```

For duplicate:

```text
incoming duplicate
  -> inbox completed
  -> no business transition
  -> no duplicate audit transition
  -> no duplicate email/document
  -> processing audit records duplicate receive
  -> ack JMS
```

This is the kind of design that can be defended in incident review.

---

## 33. Production Checklist

### 33.1 Producer Checklist

- [ ] Every command has stable `commandId`.
- [ ] Every event has stable `eventId` or `aggregateId + version`.
- [ ] Retry does not generate new business idempotency key.
- [ ] Outbox relay preserves original idempotency key.
- [ ] Message envelope includes correlation/causation id.
- [ ] Payload hash can be computed if duplicate conflict detection needed.

### 33.2 Consumer Checklist

- [ ] Consumer has unique `consumerName`.
- [ ] Inbox table has unique key `(consumer_name, idempotency_key)`.
- [ ] Business side effect and inbox completion commit together.
- [ ] JMS ack happens after DB commit.
- [ ] Duplicate completed is no-op.
- [ ] Same key different payload is conflict.
- [ ] State transition checks expected version/status.
- [ ] External side effects go through outbox or have idempotency key.
- [ ] DLQ replay preserves original key.

### 33.3 Database Checklist

- [ ] Unique constraint exists for inbox.
- [ ] Unique/natural constraints exist for business side effects.
- [ ] Aggregate updates are conditional/versioned.
- [ ] Inbox cleanup respects replay/audit retention.
- [ ] Indexes support duplicate lookup and operations dashboard.

### 33.4 Operations Checklist

- [ ] Duplicate rate is monitored.
- [ ] Idempotency conflict alert exists.
- [ ] Stuck processing rows are detected.
- [ ] Replay tool is idempotency-aware.
- [ ] Operator can see processing history.
- [ ] Permanent failures require explicit repair/override.

---

## 34. Top 1% Heuristics

1. **Treat duplicate as normal, not exceptional.**  
   If the design breaks on duplicate, the design is incomplete.

2. **Use business idempotency key, not transport id.**  
   `JMSMessageID` helps tracing; it is not enough for business correctness.

3. **Let the database arbitrate concurrency.**  
   Unique constraint beats check-then-act logic.

4. **Make side effect and dedup marker atomic.**  
   Inbox row and business update must commit together.

5. **Ack only after durable decision.**  
   Ack before commit is message loss territory.

6. **Differentiate duplicate, stale, and conflict.**  
   They are not the same operationally or semantically.

7. **External side effects need their own idempotency.**  
   Database idempotency does not automatically protect payment/email/API calls.

8. **Replay is a first-class workflow.**  
   Replay tooling must preserve identity and respect dedup state.

9. **Payload hash catches dangerous collisions.**  
   Same key with different payload should not silently no-op.

10. **Idempotency is part of domain design.**  
    It is not merely middleware glue.

---

## 35. Summary

Idempotency and deduplication are central to reliable JMS systems.

JMS can redeliver. Producers can retry. Brokers can fail over. Operators can replay DLQ. External systems can timeout after success. Therefore a production-grade JMS system must assume duplicate and design for it.

The safe foundation is:

```text
Stable business idempotency key
+ inbox table with unique constraint
+ atomic DB transaction for inbox and business state
+ state/version guard
+ external outbox/idempotency
+ replay-aware tooling
+ observability and retention policy
```

A beginner asks:

```text
How do I consume a JMS message?
```

A senior engineer asks:

```text
What happens if this message is processed twice after the database commit but before the ack?
```

A top-tier engineer designs so the answer is:

```text
The duplicate is detected, the domain state remains correct, no external side effect is repeated, the event is auditable, and the operator can safely replay or investigate it.
```

---

## 36. Latihan

### Latihan 1 — Design Idempotency Key

Untuk message berikut, tentukan idempotency key terbaik:

1. `ApproveCaseCommand`
2. `CaseApprovedEvent`
3. `SendCaseApprovalEmailCommand`
4. `GenerateLicenseDocumentCommand`
5. `SyncApplicantProfileEvent`
6. `DailySlaReminderCommand`

Jelaskan kenapa key tersebut stabil dan apa risiko collision-nya.

---

### Latihan 2 — Failure Window

Desain alur consumer untuk skenario:

```text
Consumer update DB sukses, lalu crash sebelum JMS ack.
```

Tulis:

1. table yang dibutuhkan,
2. transaction boundary,
3. duplicate handling path,
4. expected logs/metrics.

---

### Latihan 3 — Same Key Different Payload

Buat policy untuk kondisi:

```text
idempotencyKey sama, payloadHash berbeda.
```

Tentukan:

1. apakah message di-ack atau rollback,
2. apakah masuk DLQ/parking lot,
3. alert apa yang dikirim,
4. data apa yang harus disimpan untuk investigasi.

---

### Latihan 4 — Projection Consumer

Buat algorithm untuk projection yang menerima event:

```text
CaseSubmittedEvent v1
CaseAssignedEvent v2
CaseApprovedEvent v3
LicenseIssuedEvent v4
```

Pastikan projection aman terhadap:

1. duplicate v3,
2. replay v2 setelah v4,
3. v4 datang sebelum v3,
4. schema v2 lama.

---

## 37. Penutup Part 24

Part ini menyelesaikan fondasi correctness di sisi consumer dan side effect. Setelah ini, kita akan masuk ke engineering kapasitas: bagaimana throughput, latency, queue depth, consumer lag, dan backpressure harus dimodelkan agar sistem JMS tidak hanya benar, tetapi juga stabil saat traffic naik.

**Status seri:** belum selesai.  
**Selesai sampai:** Part 24 dari 35.  
**Berikutnya:** Part 25 — Backpressure and Capacity Engineering: Throughput, Latency, Queue Depth, Consumer Lag, dan Saturation.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-023.md">⬅️ Part 23 — Schema and Contract Engineering: Versioning, Compatibility, Envelope, Registry, dan Consumer Evolution</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-025.md">Part 25 — Backpressure and Capacity Engineering: Throughput, Latency, Queue Depth, Consumer Lag, dan Saturation ➡️</a>
</div>

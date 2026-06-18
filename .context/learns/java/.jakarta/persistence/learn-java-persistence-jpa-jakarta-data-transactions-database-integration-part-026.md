# Part 026 — Database Integration Patterns: Outbox, Inbox, CDC, Idempotency

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> File: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-026.md`  
> Target: Java 8 sampai Java 25, `javax.persistence` sampai `jakarta.persistence`, Spring/Jakarta/Hibernate ecosystem  
> Status: Part 026 dari 032

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami kenapa integrasi database dengan message broker, external API, cache, search index, email, file storage, dan service lain tidak bisa dianggap sebagai operasi atomik biasa.
2. Menjelaskan **dual-write problem** dengan failure matrix yang konkret.
3. Mendesain **transactional outbox pattern** untuk membuat perubahan database dan publikasi event menjadi reliable tanpa distributed transaction.
4. Mendesain **inbox pattern** dan **idempotent consumer** agar duplicate delivery tidak merusak data.
5. Memahami posisi **CDC / Change Data Capture** seperti Debezium dibanding polling publisher.
6. Mendesain **idempotency key** untuk HTTP command, message consumer, scheduled job, batch import, dan retry.
7. Menentukan ordering, deduplication, retry, dead-letter, dan poison-message strategy.
8. Memisahkan audit trail, domain event, integration event, outbox message, inbox record, dan CDC log.
9. Menghindari ilusi “exactly once” dan menggantinya dengan mental model **effectively-once through idempotent state transition**.
10. Menerapkan pattern ini dalam sistem besar seperti case management, regulatory workflow, payment-like command, notification, document generation, dan inter-service synchronization.

---

## 2. Mental Model: Database Commit Adalah Satu Dunia, Side Effect Adalah Dunia Lain

Persistence layer sering terlihat seperti ini:

```text
HTTP Request
  -> Service
     -> Update database
     -> Publish Kafka/RabbitMQ message
     -> Send email
     -> Update Redis
     -> Index Elasticsearch
  -> HTTP Response
```

Secara visual ini tampak linear. Namun secara failure model, ini bukan satu operasi atomik.

Database punya transaction log dan commit protocol sendiri. Message broker punya durability, acknowledgement, offset, routing, partition, retry, dan dead-letter semantics sendiri. Email provider, object storage, cache, external API, dan search engine juga punya failure behavior sendiri.

Kesalahan umum adalah menganggap semua side effect di atas bisa “ikut rollback” ketika transaction database rollback. Dalam mayoritas arsitektur modern, itu tidak benar.

Model yang lebih benar:

```text
                 ┌──────────────────────┐
                 │  Database Transaction │
                 │  - entity update      │
                 │  - audit row          │
Request ────────►│  - outbox row         │──── commit/rollback
                 └──────────────────────┘
                            │
                            │ after commit / CDC / polling
                            ▼
                 ┌──────────────────────┐
                 │  Side Effect World    │
                 │  - broker             │
                 │  - email              │
                 │  - external API       │
                 │  - cache/search       │
                 └──────────────────────┘
```

Kunci desain advanced adalah: **jangan mencampur dunia yang tidak punya atomic commit yang sama seolah-olah mereka satu transaction**.

---

## 3. Core Problem: Dual-Write Problem

Dual-write problem terjadi ketika satu use case harus menulis ke dua sistem berbeda, misalnya:

1. update row di database, lalu publish event ke Kafka/RabbitMQ;
2. update database, lalu panggil API service lain;
3. update database, lalu update Redis;
4. update database, lalu kirim email;
5. update database, lalu upload file;
6. update database, lalu index document ke Elasticsearch/OpenSearch.

Contoh sederhana:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    CaseFile caseFile = caseRepository.findById(command.caseId())
            .orElseThrow();

    caseFile.approve(command.approverId(), command.reason());

    caseRepository.save(caseFile);

    messageBroker.publish(new CaseApprovedEvent(caseFile.getId()));
}
```

Kode ini terlihat wajar. Masalahnya ada di semua titik berikut.

### 3.1 Failure Matrix

| Step | DB update | Broker publish | Hasil |
|---|---:|---:|---|
| Normal | success | success | OK |
| DB gagal sebelum publish | failed | not executed | OK, tidak ada perubahan |
| DB commit sukses, publish gagal | success | failed | data berubah tapi event hilang |
| Publish sukses, DB rollback | rollback | success | event palsu tersebar |
| Publish sukses, response HTTP timeout | success? | success? | client retry bisa duplicate |
| Publish timeout tetapi broker menerima | success | unknown | retry bisa duplicate |
| App crash setelah DB commit sebelum publish | success | not executed | event hilang |
| App crash setelah publish sebelum mark sent | success | success, status unknown | publish ulang bisa duplicate |

Kalau event dipakai service lain untuk sinkronisasi state, maka event hilang berarti downstream inconsistent. Kalau event palsu tersebar padahal DB rollback, downstream percaya sesuatu yang tidak pernah terjadi.

### 3.2 XA/2PC Bukan Jawaban Default

Secara teori, distributed transaction / XA / two-phase commit bisa mengoordinasikan commit antara resource berbeda. Dalam praktik microservice dan cloud-native system, ini sering dihindari karena:

- resource belum tentu mendukung XA secara benar;
- broker modern sering tidak memakai model XA tradisional;
- latency meningkat;
- availability menurun;
- operational complexity tinggi;
- failure recovery lebih sulit;
- cross-service transaction memperketat coupling;
- tidak cocok untuk banyak external side effect seperti email, HTTP API, object storage.

Untuk banyak sistem modern, solusi yang lebih realistis adalah:

```text
Local transaction + durable outbox + asynchronous delivery + idempotent consumer
```

---

## 4. Transactional Outbox Pattern

Transactional outbox menyelesaikan masalah “DB commit success tetapi event publish gagal” dengan memasukkan event yang harus dikirim ke tabel database yang sama dengan aggregate update.

Dalam satu transaction:

```text
BEGIN
  UPDATE case_file SET status = 'APPROVED' WHERE id = ?
  INSERT INTO audit_trail (...)
  INSERT INTO outbox_message (...)
COMMIT
```

Kemudian proses terpisah membaca `outbox_message` yang sudah commit dan mengirimkannya ke broker.

```text
┌───────────────┐
│ Use Case Tx   │
│ update entity │
│ insert outbox │
└──────┬────────┘
       │ commit
       ▼
┌───────────────┐
│ Outbox Table  │
└──────┬────────┘
       │ poll / CDC
       ▼
┌───────────────┐
│ Broker/Event  │
└───────────────┘
```

Christopher Richardson's microservices pattern catalog describes transactional outbox as a way to update business entities and send messages without a distributed transaction. Debezium's outbox event router documentation similarly frames outbox as a way to avoid inconsistencies between a service's internal database state and events consumed by other services.

### 4.1 Basic Outbox Table

Minimal schema:

```sql
CREATE TABLE outbox_message (
    id              VARCHAR(36) PRIMARY KEY,
    aggregate_type  VARCHAR(100) NOT NULL,
    aggregate_id    VARCHAR(100) NOT NULL,
    event_type      VARCHAR(200) NOT NULL,
    payload         CLOB NOT NULL,
    headers         CLOB NULL,
    status          VARCHAR(30) NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    available_at    TIMESTAMP NOT NULL,
    sent_at         TIMESTAMP NULL,
    attempt_count   INTEGER NOT NULL,
    last_error      CLOB NULL
);

CREATE INDEX idx_outbox_status_available
    ON outbox_message(status, available_at);

CREATE INDEX idx_outbox_aggregate
    ON outbox_message(aggregate_type, aggregate_id, created_at);
```

Lebih production-ready:

```sql
CREATE TABLE outbox_message (
    id                  VARCHAR(36) PRIMARY KEY,
    message_key          VARCHAR(200) NULL,
    aggregate_type       VARCHAR(100) NOT NULL,
    aggregate_id         VARCHAR(100) NOT NULL,
    aggregate_version    BIGINT NULL,
    event_type           VARCHAR(200) NOT NULL,
    event_version        INTEGER NOT NULL,
    payload              CLOB NOT NULL,
    payload_content_type VARCHAR(100) NOT NULL,
    headers              CLOB NULL,
    topic_name           VARCHAR(200) NOT NULL,
    partition_key        VARCHAR(200) NULL,
    trace_id             VARCHAR(100) NULL,
    correlation_id       VARCHAR(100) NULL,
    causation_id         VARCHAR(100) NULL,
    status               VARCHAR(30) NOT NULL,
    available_at         TIMESTAMP NOT NULL,
    created_at           TIMESTAMP NOT NULL,
    locked_by            VARCHAR(100) NULL,
    locked_until         TIMESTAMP NULL,
    attempt_count        INTEGER NOT NULL,
    max_attempts         INTEGER NOT NULL,
    sent_at              TIMESTAMP NULL,
    failed_at            TIMESTAMP NULL,
    last_error_code      VARCHAR(100) NULL,
    last_error_message   CLOB NULL
);
```

Status umum:

```text
PENDING -> PROCESSING -> SENT
PENDING -> PROCESSING -> FAILED_RETRYABLE -> PENDING
PENDING -> PROCESSING -> DEAD
```

Untuk CDC-based outbox, status sering tidak diperlukan karena connector membaca insert dari transaction log. Untuk polling publisher, status/lock/attempt diperlukan.

---

## 5. Outbox dengan JPA/Hibernate

### 5.1 Entity Design

```java
import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "outbox_message", indexes = {
        @Index(name = "idx_outbox_status_available", columnList = "status, availableAt"),
        @Index(name = "idx_outbox_aggregate", columnList = "aggregateType, aggregateId, createdAt")
})
public class OutboxMessage {

    @Id
    @Column(length = 36, nullable = false)
    private String id;

    @Column(nullable = false, length = 100)
    private String aggregateType;

    @Column(nullable = false, length = 100)
    private String aggregateId;

    private Long aggregateVersion;

    @Column(nullable = false, length = 200)
    private String eventType;

    @Column(nullable = false)
    private int eventVersion;

    @Lob
    @Column(nullable = false)
    private String payload;

    @Lob
    private String headers;

    @Column(nullable = false, length = 200)
    private String topicName;

    @Column(length = 200)
    private String partitionKey;

    @Column(length = 100)
    private String traceId;

    @Column(length = 100)
    private String correlationId;

    @Column(length = 100)
    private String causationId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private OutboxStatus status;

    @Column(nullable = false)
    private Instant availableAt;

    @Column(nullable = false)
    private Instant createdAt;

    private Instant sentAt;

    @Column(nullable = false)
    private int attemptCount;

    @Column(nullable = false)
    private int maxAttempts;

    @Lob
    private String lastErrorMessage;

    protected OutboxMessage() {
    }

    public static OutboxMessage pending(
            String id,
            String aggregateType,
            String aggregateId,
            Long aggregateVersion,
            String eventType,
            int eventVersion,
            String payload,
            String topicName,
            String partitionKey,
            String traceId,
            String correlationId,
            String causationId,
            Instant now
    ) {
        OutboxMessage message = new OutboxMessage();
        message.id = id;
        message.aggregateType = aggregateType;
        message.aggregateId = aggregateId;
        message.aggregateVersion = aggregateVersion;
        message.eventType = eventType;
        message.eventVersion = eventVersion;
        message.payload = payload;
        message.topicName = topicName;
        message.partitionKey = partitionKey;
        message.traceId = traceId;
        message.correlationId = correlationId;
        message.causationId = causationId;
        message.status = OutboxStatus.PENDING;
        message.availableAt = now;
        message.createdAt = now;
        message.attemptCount = 0;
        message.maxAttempts = 20;
        return message;
    }

    public void markSent(Instant now) {
        this.status = OutboxStatus.SENT;
        this.sentAt = now;
    }

    public void markRetryableFailure(String error, Instant nextAttemptAt) {
        this.attemptCount++;
        this.lastErrorMessage = error;
        if (attemptCount >= maxAttempts) {
            this.status = OutboxStatus.DEAD;
        } else {
            this.status = OutboxStatus.PENDING;
            this.availableAt = nextAttemptAt;
        }
    }
}
```

```java
public enum OutboxStatus {
    PENDING,
    PROCESSING,
    SENT,
    DEAD
}
```

### 5.2 Menulis Outbox dalam Use Case Transaction

```java
@Service
public class CaseApprovalService {

    private final CaseRepository caseRepository;
    private final OutboxRepository outboxRepository;
    private final JsonSerializer jsonSerializer;
    private final Clock clock;

    @Transactional
    public void approve(ApproveCaseCommand command) {
        CaseFile caseFile = caseRepository.findById(command.caseId())
                .orElseThrow(() -> new NotFoundException("case not found"));

        caseFile.approve(command.approverId(), command.reason(), Instant.now(clock));

        CaseApprovedEvent event = new CaseApprovedEvent(
                caseFile.getId(),
                caseFile.getVersion(),
                command.approverId(),
                command.reason(),
                Instant.now(clock)
        );

        OutboxMessage outbox = OutboxMessage.pending(
                UUID.randomUUID().toString(),
                "CaseFile",
                caseFile.getId().toString(),
                caseFile.getVersion(),
                "CaseApproved",
                1,
                jsonSerializer.toJson(event),
                "case-events",
                caseFile.getId().toString(),
                command.traceId(),
                command.correlationId(),
                command.commandId(),
                Instant.now(clock)
        );

        outboxRepository.save(outbox);
    }
}
```

Perhatikan: tidak ada `messageBroker.publish()` di dalam transaction utama.

Yang atomik adalah:

```text
case approved + audit row + outbox message
```

Bukan:

```text
case approved + actual broker delivery
```

---

## 6. Polling Publisher

Polling publisher adalah worker yang mengambil outbox pending, mengirim ke broker, lalu menandai message sebagai sent.

### 6.1 Basic Flow

```text
loop:
  SELECT pending outbox messages
  lock rows
  publish message
  mark as sent or retryable failed
```

### 6.2 Claiming Rows Safely

Untuk multi-worker, kamu perlu mencegah dua worker mengirim row yang sama bersamaan.

Pendekatan umum:

1. `SELECT ... FOR UPDATE SKIP LOCKED` di database yang mendukung;
2. update conditional `WHERE status='PENDING' AND available_at <= now`;
3. lease lock dengan `locked_by` dan `locked_until`;
4. partitioning berdasarkan shard key.

Contoh SQL dengan `SKIP LOCKED`:

```sql
SELECT *
FROM outbox_message
WHERE status = 'PENDING'
  AND available_at <= CURRENT_TIMESTAMP
ORDER BY created_at
FETCH FIRST 100 ROWS ONLY
FOR UPDATE SKIP LOCKED;
```

Lalu dalam transaction pendek:

```text
BEGIN
  select pending rows for update skip locked
  mark PROCESSING / assign locked_by
COMMIT
```

Setelah itu publish dilakukan di luar lock DB agar lock tidak ditahan selama broker/network call.

Namun ada trade-off: kalau publish dilakukan di luar transaction claiming, worker crash setelah publish tetapi sebelum mark sent dapat menyebabkan duplicate publish. Itu diterima jika consumer idempotent.

### 6.3 Worker Pseudocode

```java
@Component
public class OutboxPublisher {

    private final OutboxRepository outboxRepository;
    private final MessageBroker broker;
    private final TransactionTemplate transactionTemplate;
    private final Clock clock;

    public void publishBatch() {
        List<OutboxMessage> messages = transactionTemplate.execute(status ->
                outboxRepository.claimPending("worker-1", Instant.now(clock), 100)
        );

        for (OutboxMessage message : messages) {
            publishOne(message.getId());
        }
    }

    public void publishOne(String messageId) {
        OutboxMessage message = outboxRepository.findById(messageId)
                .orElseThrow();

        try {
            broker.publish(
                    message.getTopicName(),
                    message.getPartitionKey(),
                    message.getPayload(),
                    message.getHeaders()
            );

            transactionTemplate.executeWithoutResult(status ->
                    outboxRepository.markSent(messageId, Instant.now(clock))
            );
        } catch (TransientBrokerException ex) {
            transactionTemplate.executeWithoutResult(status ->
                    outboxRepository.markRetryableFailure(
                            messageId,
                            ex.getMessage(),
                            computeBackoff(message.getAttemptCount(), Instant.now(clock))
                    )
            );
        } catch (PermanentBrokerException ex) {
            transactionTemplate.executeWithoutResult(status ->
                    outboxRepository.markDead(messageId, ex.getMessage(), Instant.now(clock))
            );
        }
    }
}
```

### 6.4 Important Failure Case

```text
publish succeeds
app crashes before markSent
```

Message akan terkirim ulang setelah lease expired atau status kembali pending.

Karena itu, outbox tidak menjamin “exactly once delivery”. Outbox menjamin message tidak hilang selama database commit sukses. Duplicate tetap mungkin.

Solusi duplicate adalah idempotent consumer/inbox.

---

## 7. CDC-Based Outbox

CDC membaca transaction log database dan mengirim perubahan outbox ke broker.

Flow:

```text
Application Transaction
  INSERT outbox_message
      │
      ▼
Database transaction log / WAL / redo log
      │
      ▼
CDC connector
      │
      ▼
Message broker
```

Debezium Outbox Event Router adalah salah satu implementasi umum untuk membaca row outbox dan membentuk event broker. Dokumentasinya menjelaskan bahwa connector menangkap perubahan dalam outbox table, lalu merutekannya menjadi event.

### 7.1 Kelebihan CDC Outbox

- Tidak perlu polling query berkala.
- Lebih dekat ke transaction log, sehingga latency bisa rendah.
- Tidak perlu worker claim/lock table secara manual.
- Bisa scale dengan ekosistem Kafka Connect/Debezium.
- Cocok untuk event streaming.

### 7.2 Kekurangan CDC Outbox

- Operational complexity lebih tinggi.
- Perlu akses transaction log/replication slot/binlog/redo log.
- Schema evolution outbox harus hati-hati.
- Debugging melibatkan DB + connector + broker.
- Tidak semua environment managed DB memberi permission yang mudah.
- Failure mode pindah ke connector lag, offset, snapshot, schema registry, serialization.

### 7.3 Polling vs CDC

| Aspek | Polling Publisher | CDC Outbox |
|---|---|---|
| Implementasi awal | Lebih sederhana | Lebih kompleks |
| Latency | Bergantung interval polling | Biasanya lebih rendah |
| DB load | Query polling | Log-based read |
| Operational dependency | App worker | CDC platform |
| Retry control | Di aplikasi | Di connector/broker pipeline |
| Transform payload | Di aplikasi | SMT/connector/stream layer |
| Cocok untuk | aplikasi menengah, kontrol penuh | event streaming, scale besar |

---

## 8. Inbox Pattern

Outbox menyelesaikan sisi producer. Inbox menyelesaikan sisi consumer.

Masalah consumer:

```text
message diterima
update DB
ack broker
```

Failure matrix:

| Step | DB update | Broker ack | Hasil |
|---|---:|---:|---|
| Normal | success | success | OK |
| DB gagal | failed | no ack | message retry |
| DB commit sukses, ack gagal | success | failed/unknown | message duplicate |
| Consumer crash setelah commit sebelum ack | success | no ack | message duplicate |
| Handler timeout setelah partial side effect | unknown | no ack | retry bisa duplicate |

Karena broker bisa mengirim ulang, consumer harus idempotent.

Inbox pattern menyimpan `message_id` yang sudah diproses dalam database consumer.

```sql
CREATE TABLE inbox_message (
    message_id       VARCHAR(100) PRIMARY KEY,
    source_service   VARCHAR(100) NOT NULL,
    event_type       VARCHAR(200) NOT NULL,
    received_at      TIMESTAMP NOT NULL,
    processed_at     TIMESTAMP NULL,
    status           VARCHAR(30) NOT NULL,
    payload_hash     VARCHAR(100) NULL,
    last_error       CLOB NULL
);
```

### 8.1 Idempotent Consumer Flow

```text
BEGIN
  INSERT INTO inbox_message(message_id, status='PROCESSING')
    -- if duplicate key -> already processed/processing

  apply business side effect

  UPDATE inbox_message SET status='PROCESSED'
COMMIT

ACK broker
```

Kalau message dikirim ulang setelah commit tapi sebelum ack, insert inbox akan duplicate dan consumer dapat langsung ack tanpa mengulang side effect.

### 8.2 Consumer Example

```java
@Service
public class CaseApprovedConsumer {

    private final InboxRepository inboxRepository;
    private final ReadModelRepository readModelRepository;

    @Transactional
    public ConsumerResult handle(MessageEnvelope envelope) {
        boolean firstTime = inboxRepository.tryStart(
                envelope.messageId(),
                envelope.sourceService(),
                envelope.eventType(),
                envelope.payloadHash()
        );

        if (!firstTime) {
            return ConsumerResult.alreadyProcessed();
        }

        CaseApprovedEvent event = envelope.parsePayload(CaseApprovedEvent.class);

        readModelRepository.markApproved(
                event.caseId(),
                event.approvedAt(),
                event.approvedBy()
        );

        inboxRepository.markProcessed(envelope.messageId());

        return ConsumerResult.processed();
    }
}
```

`tryStart()` harus bergantung pada unique constraint/primary key, bukan `exists()` lalu insert.

```java
public boolean tryStart(String messageId, String source, String type, String hash) {
    try {
        entityManager.persist(new InboxMessage(messageId, source, type, hash));
        entityManager.flush();
        return true;
    } catch (PersistenceException ex) {
        if (isDuplicateKey(ex)) {
            return false;
        }
        throw ex;
    }
}
```

Kenapa `flush()`? Agar duplicate key diketahui di titik ini, bukan baru di akhir transaction setelah business side effect dilakukan.

---

## 9. Idempotency

Idempotency berarti menjalankan operasi yang sama lebih dari sekali menghasilkan efek akhir yang sama seperti menjalankannya sekali.

Contoh idempotent:

```text
set status = APPROVED if current status = UNDER_REVIEW
```

Contoh tidak idempotent:

```text
balance = balance - 100
send email
append audit row without dedup key
create document with random id
```

Namun banyak operasi tidak idempotent secara natural. Maka kita membuatnya idempotent dengan key, constraint, state machine, dan durable processing record.

### 9.1 HTTP Idempotency Key

Untuk command API:

```http
POST /cases/123/approve
Idempotency-Key: 4f2b3e9b-...
```

Schema:

```sql
CREATE TABLE idempotency_record (
    key             VARCHAR(100) PRIMARY KEY,
    request_hash    VARCHAR(128) NOT NULL,
    status          VARCHAR(30) NOT NULL,
    response_code   INTEGER NULL,
    response_body   CLOB NULL,
    created_at      TIMESTAMP NOT NULL,
    completed_at    TIMESTAMP NULL,
    expires_at      TIMESTAMP NOT NULL
);
```

Flow:

```text
BEGIN
  insert idempotency key
  if duplicate:
    compare request hash
    if completed -> return stored response
    if processing -> return 409/202 depending policy
  execute command
  store response
COMMIT
```

### 9.2 Request Hash

Idempotency key tidak cukup. Client bisa salah reuse key untuk payload berbeda.

Maka simpan hash canonical request:

```text
hash(method + path + normalized_body + principal + tenant)
```

Jika key sama tapi hash beda, return error:

```text
409 Conflict / 422 Unprocessable Entity: idempotency key reused with different request
```

### 9.3 Idempotency Scope

Key harus punya scope:

| Scope | Contoh |
|---|---|
| Global | `key` unique global |
| Per tenant | `(tenant_id, key)` |
| Per actor | `(tenant_id, actor_id, key)` |
| Per endpoint | `(tenant_id, endpoint, key)` |
| Per aggregate | `(aggregate_type, aggregate_id, key)` |

Untuk sistem multi-tenant, hindari global key tanpa tenant kecuali memang sengaja.

### 9.4 Idempotency dan Transaction Boundary

Idempotency record harus commit atomik dengan efek business.

```text
BEGIN
  insert idempotency record
  update case
  insert audit
  insert outbox
  update idempotency record completed
COMMIT
```

Kalau idempotency record commit tapi business update rollback, retry akan salah mengira command sudah selesai. Kalau business update commit tapi idempotency record rollback, retry bisa duplicate.

---

## 10. Ordering

Outbox dan messaging sering punya kebutuhan ordering.

Contoh:

```text
CaseSubmitted
CaseAssigned
CaseApproved
CaseClosed
```

Downstream read model bisa rusak jika menerima:

```text
CaseClosed sebelum CaseApproved
```

### 10.1 Ordering per Aggregate

Pattern umum: order dijamin per aggregate id, bukan global.

```text
partition key = aggregate_id
```

Untuk Kafka-like broker, message dengan key yang sama masuk partition yang sama sehingga order per key dapat dijaga.

### 10.2 Aggregate Version

Tambahkan `aggregate_version` ke event:

```json
{
  "eventId": "...",
  "aggregateType": "CaseFile",
  "aggregateId": "CASE-123",
  "aggregateVersion": 17,
  "eventType": "CaseApproved",
  "occurredAt": "2026-06-16T09:00:00Z"
}
```

Consumer bisa:

1. reject duplicate version;
2. buffer out-of-order event;
3. request rebuild/read repair;
4. process only if `version = last_version + 1`;
5. tolerate last-write-wins jika use case aman.

### 10.3 Global Ordering Hampir Selalu Mahal

Global ordering untuk semua event seluruh sistem biasanya:

- bottleneck;
- sulit scale;
- tidak diperlukan untuk kebanyakan domain;
- membuat unrelated aggregate saling menunggu.

Pilih ordering scope sekecil mungkin.

---

## 11. Domain Event vs Integration Event vs Outbox Message

Jangan campur semua konsep ini.

### 11.1 Domain Event

Event di dalam bounded context/domain model.

Contoh:

```java
public record CaseApproved(
        CaseId caseId,
        OfficerId approvedBy,
        Instant approvedAt
) implements DomainEvent {
}
```

Fungsi:

- mengekspresikan sesuatu yang terjadi dalam domain;
- dipakai untuk audit, notification planning, outbox creation;
- belum tentu bentuk payload eksternal.

### 11.2 Integration Event

Kontrak yang dikirim ke service lain.

Contoh:

```json
{
  "eventId": "...",
  "eventType": "case.approved.v1",
  "caseId": "...",
  "status": "APPROVED",
  "approvedAt": "..."
}
```

Fungsi:

- stabil untuk consumer;
- versioned;
- tidak membocorkan semua internal entity;
- bisa berbeda dari domain event internal.

### 11.3 Outbox Message

Record teknis yang menyimpan payload integration event dan metadata delivery.

```text
outbox_message = envelope teknis untuk delivery
```

### 11.4 Audit Trail

Audit adalah bukti historis.

Audit menjawab:

```text
siapa melakukan apa, kapan, dari mana, terhadap data apa, sebelum/sesudah apa, alasannya apa
```

Audit bukan pengganti outbox. Outbox bukan pengganti audit.

---

## 12. Event Envelope Design

Payload event sebaiknya punya envelope konsisten.

```json
{
  "messageId": "01JZ...",
  "eventType": "case.approved",
  "eventVersion": 1,
  "source": "case-service",
  "tenantId": "CEA",
  "aggregateType": "CaseFile",
  "aggregateId": "CASE-2026-000123",
  "aggregateVersion": 8,
  "occurredAt": "2026-06-16T09:12:33Z",
  "publishedAt": "2026-06-16T09:12:40Z",
  "correlationId": "...",
  "causationId": "...",
  "traceId": "...",
  "schemaVersion": 1,
  "payload": {
    "caseId": "CASE-2026-000123",
    "status": "APPROVED",
    "approvedBy": "OFFICER-001",
    "approvedAt": "2026-06-16T09:12:33Z"
  }
}
```

Important fields:

| Field | Purpose |
|---|---|
| `messageId` | deduplication/inbox key |
| `eventType` | routing and handler selection |
| `eventVersion` | payload compatibility |
| `source` | provenance |
| `tenantId` | tenant isolation |
| `aggregateId` | ordering and business reference |
| `aggregateVersion` | ordering/idempotency |
| `occurredAt` | domain occurrence time |
| `publishedAt` | delivery time |
| `correlationId` | request/workflow correlation |
| `causationId` | event/command that caused this event |
| `traceId` | distributed tracing |

---

## 13. Retry Strategy

Retry harus diklasifikasi.

### 13.1 Retriable

- broker temporarily unavailable;
- database deadlock;
- lock timeout;
- HTTP 503/504 external service;
- network timeout with unknown result;
- CDC connector temporary lag.

### 13.2 Non-Retriable

- invalid payload schema;
- missing mandatory business field;
- authorization permanently denied;
- unknown event type with no compatible handler;
- violated invariant due to bad producer contract;
- poison message.

### 13.3 Exponential Backoff with Jitter

```text
nextDelay = min(maxDelay, baseDelay * 2^attempt) + randomJitter
```

Jitter penting agar ribuan worker tidak retry bersamaan.

### 13.4 Dead Letter

Setelah retry limit:

```text
PENDING -> PROCESSING -> DEAD
```

Dead letter record harus menyimpan:

- message id;
- event type;
- payload;
- error class/code;
- stack trace ringkas;
- attempt count;
- first failure time;
- last failure time;
- owner/action required.

---

## 14. External API Calls

Outbox biasanya untuk event/message. Untuk external API command, pattern mirip tetapi butuh perhatian ekstra.

Contoh: setelah case approved, panggil external document generation service.

Jangan lakukan ini langsung dalam transaction utama:

```java
@Transactional
public void approve(...) {
    caseFile.approve(...);
    externalDocumentApi.generateCertificate(caseFile.getId()); // risky
}
```

Risiko:

- DB lock ditahan selama network call;
- API sukses tapi DB rollback;
- DB commit sukses tapi API call gagal;
- timeout unknown result;
- retry command bisa duplicate certificate;
- transaction timeout;
- connection pool exhausted.

Lebih aman:

```text
approve transaction:
  update case
  insert audit
  insert outbox CommandRequested/CertificateGenerationRequested

worker:
  consume outbox
  call external API with idempotency key
  update delivery status / insert result event
```

Untuk external API, gunakan idempotency key jika provider mendukung:

```http
POST /certificate
Idempotency-Key: case-CAS-123-version-8-certificate-v1
```

Jika provider tidak mendukung idempotency, desain local compensation atau reconciliation.

---

## 15. Cache dan Search Index Integration

Cache/search index tidak boleh dianggap source of truth.

### 15.1 Cache Invalidation via Outbox

```text
DB transaction:
  update case
  insert outbox CaseUpdated

consumer:
  evict Redis key case:{id}
  evict listing cache by tenant/module
```

Jangan update cache sebelum DB commit.

### 15.2 Search Index Update

```text
DB transaction:
  update case
  insert outbox CaseSearchIndexRequested

indexer:
  load latest case projection from DB
  update OpenSearch/Elasticsearch
```

Lebih baik indexer load latest state dari DB daripada percaya event payload sebagai full truth jika event bisa out-of-order.

### 15.3 Read Model Rebuild

Search/read model harus rebuildable.

Jika index corrupt:

```text
scan DB -> rebuild index/read model
```

Jika read model tidak bisa rebuild, ia diam-diam menjadi source of truth kedua.

---

## 16. File/Object Storage Integration

Masalah umum:

```text
upload file to S3/object storage
insert DB metadata
```

Failure:

- file uploaded, DB insert failed -> orphan file;
- DB insert success, file upload failed -> broken reference;
- retry uploads duplicate object;
- delete DB metadata, file delete failed.

Patterns:

1. Generate deterministic object key.
2. Use staging status.
3. Insert DB metadata first with `PENDING_UPLOAD` or `UPLOADED_PENDING_SCAN`.
4. Use outbox for antivirus scan/thumbnail/indexing.
5. Reconciliation job cleans orphan files and broken metadata.
6. Do not delete file synchronously inside business transaction; mark deletion requested and process async.

Example states:

```text
PENDING_UPLOAD -> UPLOADED -> SCANNING -> AVAILABLE
PENDING_DELETE -> DELETED
FAILED_SCAN -> QUARANTINED
```

---

## 17. Idempotent State Transitions

Untuk workflow/case management, idempotency harus masuk ke state machine.

Naive:

```java
caseFile.setStatus(APPROVED);
```

Better:

```java
caseFile.approve(commandId, approverId, reason, now);
```

Inside aggregate:

```java
public void approve(String commandId, String approverId, String reason, Instant now) {
    if (hasProcessedCommand(commandId)) {
        return;
    }

    if (status != CaseStatus.UNDER_REVIEW) {
        throw new InvalidStateTransitionException(status, CaseStatus.APPROVED);
    }

    this.status = CaseStatus.APPROVED;
    this.approvedBy = approverId;
    this.approvedAt = now;
    this.processedCommands.add(commandId);
    this.recordEvent(new CaseApproved(id, version + 1, approverId, now));
}
```

Namun menyimpan semua processed command di aggregate bisa membesar. Biasanya lebih baik:

```text
idempotency_record table
inbox_message table
unique business command table
```

Contoh unique constraint:

```sql
CREATE TABLE case_transition_command (
    command_id      VARCHAR(100) PRIMARY KEY,
    case_id         VARCHAR(100) NOT NULL,
    transition      VARCHAR(50) NOT NULL,
    request_hash    VARCHAR(128) NOT NULL,
    processed_at    TIMESTAMP NOT NULL
);
```

---

## 18. Exactly-Once Illusion

Banyak platform memakai istilah “exactly once”. Dalam desain aplikasi, lebih aman berpikir:

```text
At-least-once delivery + idempotent processing + durable deduplication = effectively-once business effect
```

Delivery duplicate tetap mungkin karena:

- producer retry setelah timeout;
- broker redelivery setelah ack gagal;
- consumer crash setelah commit sebelum ack;
- outbox publisher crash setelah publish sebelum mark sent;
- CDC connector restart;
- replay event;
- manual reprocessing.

Yang harus dijaga adalah **efek bisnis tidak duplicate**.

Contoh:

| Duplicate Delivery | Harus Aman Dengan |
|---|---|
| Duplicate `CaseApproved` | inbox message id + aggregate version |
| Duplicate `PaymentCaptured` | payment transaction id unique |
| Duplicate `EmailRequested` | notification dedup key |
| Duplicate document generation | deterministic document id/key |
| Duplicate assignment | unique active assignment constraint |

---

## 19. Database Constraints as Integration Safety Net

Idempotency dan dedup harus didukung database constraint.

Jangan hanya:

```java
if (!repository.existsByMessageId(id)) {
    repository.save(...);
}
```

Dalam concurrent consumer, dua thread bisa sama-sama melihat belum ada lalu insert bersamaan.

Gunakan:

```sql
ALTER TABLE inbox_message
ADD CONSTRAINT pk_inbox_message PRIMARY KEY (message_id);
```

Atau scoped:

```sql
ALTER TABLE inbox_message
ADD CONSTRAINT uq_inbox_scope UNIQUE (source_service, message_id);
```

Lalu handle duplicate key exception.

---

## 20. Transaction Synchronization and Transactional Events

Spring menyediakan `@TransactionalEventListener` yang dapat mengikat listener pada fase transaction, misalnya `AFTER_COMMIT`. Ini berguna untuk side effect ringan setelah commit, tetapi bukan pengganti outbox durable.

Contoh:

```java
@Component
public class CaseEventListener {

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void afterCommit(CaseApprovedApplicationEvent event) {
        // OK for best-effort local action, metrics, non-critical cache eviction
        // Risky for critical external delivery unless backed by outbox
    }
}
```

Risiko `AFTER_COMMIT` tanpa outbox:

```text
transaction commit sukses
app crash sebelum listener jalan
side effect hilang
```

Maka rule praktis:

| Need | Pattern |
|---|---|
| Critical integration event | outbox |
| Best-effort local in-memory listener | transactional event listener |
| Cache eviction yang bisa dipulihkan TTL/rebuild | transactional listener acceptable |
| Email/legal notification wajib | outbox/notification table |
| External API wajib | outbox/work queue + idempotency |

---

## 21. Event Versioning

Integration event adalah contract. Jangan mengubah payload sembarangan.

### 21.1 Compatible Change

Biasanya aman:

- menambah optional field;
- menambah enum value jika consumer tolerant;
- memperjelas field tanpa mengubah semantics;
- menambah metadata envelope.

### 21.2 Breaking Change

Berisiko:

- rename field;
- hapus field;
- ubah type;
- ubah meaning;
- ubah unit waktu/uang;
- ubah timezone semantics;
- ubah id format.

### 21.3 Version Strategy

```text
case.approved.v1
case.approved.v2
```

Atau:

```json
{
  "eventType": "case.approved",
  "eventVersion": 2
}
```

Consumer harus punya compatibility window. Producer tidak boleh menghapus versi lama sebelum semua consumer migrate.

---

## 22. Observability

Integrasi asinkron tanpa observability adalah blind spot.

### 22.1 Metrics Producer/Outbox

Monitor:

- `outbox_pending_count`;
- `outbox_oldest_pending_age_seconds`;
- `outbox_publish_success_total`;
- `outbox_publish_failure_total`;
- `outbox_dead_count`;
- `outbox_attempt_count_distribution`;
- publish latency;
- DB polling query duration;
- CDC lag;
- broker send latency.

### 22.2 Metrics Consumer/Inbox

Monitor:

- `consumer_lag`;
- `inbox_duplicate_count`;
- `inbox_processing_failure_total`;
- `inbox_dead_count`;
- handler processing latency;
- retry count;
- poison message count;
- out-of-order event count;
- version gap count.

### 22.3 Logs

Log fields:

```text
message_id
aggregate_type
aggregate_id
aggregate_version
event_type
event_version
tenant_id
correlation_id
causation_id
trace_id
attempt_count
status
error_code
```

### 22.4 Tracing

Trace propagation:

```text
HTTP request trace id
  -> DB transaction log metadata/outbox header
  -> broker message header
  -> consumer trace span
  -> downstream DB update
```

---

## 23. Security and Privacy

Event payload sering menjadi sumber data leakage.

Guidelines:

1. Jangan kirim seluruh entity sebagai event payload.
2. Jangan kirim field sensitif jika consumer tidak perlu.
3. Masking/encryption untuk PII jika diperlukan.
4. Tenant id wajib ada di envelope jika multi-tenant.
5. Authorization tidak boleh diasumsikan hanya karena event datang dari broker.
6. Audit access ke outbox/inbox payload.
7. Retention policy untuk outbox/inbox/dead letter.
8. Jangan simpan secret/token dalam payload.
9. Hindari payload yang berisi raw document content kecuali memang channel aman.
10. Pastikan replay event tidak membuka akses lintas tenant.

---

## 24. Retention, Archival, and Cleanup

Outbox/inbox akan tumbuh terus.

### 24.1 Outbox Retention

Policy:

```text
SENT older than 30/90/180 days -> archive/delete
DEAD -> retain until resolved + retention window
PENDING/PROCESSING -> never delete automatically
```

### 24.2 Inbox Retention

Inbox menyimpan dedup memory. Jika dihapus terlalu cepat, duplicate lama bisa diproses ulang.

Retention harus lebih panjang dari:

- broker retention;
- replay window;
- maximum retry window;
- disaster recovery replay window;
- legal/audit requirement.

### 24.3 Partitioning

Untuk table besar:

- partition by `created_at`;
- partition by tenant;
- separate archive table;
- indexes tuned for pending query;
- avoid LOB-heavy hot table if possible.

---

## 25. Production Failure Modes

### 25.1 Outbox Table Membesar

Symptoms:

- query pending lambat;
- index bloat;
- DB CPU naik;
- vacuum/segment issue;
- old pending message tidak terkirim.

Mitigation:

- index `(status, available_at, created_at)`;
- partition/archive;
- limit batch size;
- monitor oldest pending age;
- separate payload from status table jika LOB besar;
- backpressure producer jika backlog terlalu besar.

### 25.2 Duplicate Event Merusak Data

Cause:

- consumer tidak idempotent;
- tidak ada inbox/unique key;
- handler melakukan increment/append tanpa dedup.

Mitigation:

- inbox table;
- unique business key;
- aggregate version;
- idempotent update;
- test duplicate delivery.

### 25.3 Out-of-Order Event

Cause:

- wrong partition key;
- parallel publisher;
- multiple topics;
- replay;
- retry delay.

Mitigation:

- partition by aggregate id;
- aggregate version;
- per-aggregate sequence;
- consumer gap detection;
- rebuild/read repair.

### 25.4 Poison Message

Cause:

- bad payload;
- incompatible schema;
- missing reference data;
- bug in consumer.

Mitigation:

- max attempts;
- dead letter;
- alerting;
- replay tooling;
- schema compatibility checks.

### 25.5 Side Effect Succeeds But Local State Fails

Example:

```text
external API created certificate
local DB update result failed
```

Mitigation:

- use external idempotency key;
- reconcile by deterministic external reference;
- store attempt before call;
- result polling;
- compensation.

---

## 26. Design Pattern Matrix

| Problem | Pattern |
|---|---|
| DB update + event publish | transactional outbox |
| Message duplicate | inbox/idempotent consumer |
| HTTP retry duplicate command | idempotency key table |
| Event order per entity | partition key + aggregate version |
| External API unknown result | idempotency key + reconciliation |
| Search index sync | outbox + async indexer + rebuild |
| Cache invalidation | after-commit/outbox event + TTL fallback |
| Cross-service workflow | saga + outbox/inbox |
| Batch import retry | import batch id + row idempotency key |
| Duplicate notification | notification dedup key |
| Poison message | retry + dead letter + replay tooling |
| Critical audit | audit table in same DB transaction |
| Full data replication | CDC |

---

## 27. Case Management Example: Approve Case and Notify Systems

Use case:

```text
Officer approves case.
System must:
1. change case status;
2. write audit trail;
3. notify applicant;
4. update search index;
5. publish event to reporting service;
6. generate certificate;
7. prevent duplicate approval on retry.
```

### 27.1 Transaction Design

Inside one DB transaction:

```text
BEGIN
  insert idempotency_record(command_id)
  select case for update/version check
  update case_file status APPROVED
  insert audit_trail
  insert outbox case.approved.v1
  insert outbox applicant.notification.requested.v1
  insert outbox search.index.requested.v1
  insert outbox certificate.generation.requested.v1
  update idempotency_record completed
COMMIT
```

Outside transaction:

```text
outbox publisher/CDC publishes messages
consumers process idempotently
```

### 27.2 Why This Is Better

If DB rollback:

```text
no status change
no audit
no outbox
```

If app crash after commit:

```text
outbox remains durable
publisher can resume
```

If message duplicate:

```text
consumer inbox prevents duplicate side effect
```

If external certificate API timeout:

```text
retry with deterministic idempotency key
```

If search index fails:

```text
dead letter/retry/rebuild without rolling back approval
```

---

## 28. Coding Standards for Integration Patterns

### 28.1 Do

- Insert outbox row in same transaction as aggregate update.
- Use durable idempotency key for retryable commands.
- Use inbox table or unique business constraint for consumers.
- Include message id, event type, version, aggregate id, aggregate version, tenant id, trace/correlation id.
- Assume duplicate delivery.
- Assume out-of-order delivery unless ordering is explicitly designed.
- Use bounded retry with dead letter.
- Make downstream side effect idempotent.
- Use DB constraints for dedup.
- Monitor backlog and oldest pending age.
- Keep event payload minimal and versioned.
- Separate audit from integration event.

### 28.2 Do Not

- Publish critical broker message inside DB transaction without outbox.
- Call slow external API while holding DB transaction/lock.
- Treat `@TransactionalEventListener(AFTER_COMMIT)` as durable delivery.
- Use `exists()` check for dedup without unique constraint.
- Store entire JPA entity graph as event payload.
- Assume broker exactly-once semantics solves business idempotency.
- Delete inbox records before replay window expires.
- Ignore tenant and authorization in event processing.
- Let outbox table grow forever.
- Retry poison messages infinitely.

---

## 29. Testing Strategy

### 29.1 Unit Tests

Test pure components:

- event mapping;
- idempotency key hash;
- retry backoff;
- envelope validation;
- state transition idempotency.

### 29.2 Integration Tests

Use real database.

Test:

1. aggregate update and outbox insert commit atomically;
2. rollback removes both aggregate change and outbox;
3. duplicate idempotency key returns stored result;
4. duplicate inbox message does not repeat side effect;
5. outbox publisher retries transient failure;
6. dead letter after max attempts;
7. two workers do not claim same message;
8. crash simulation after publish before mark sent causes duplicate and consumer handles it;
9. event version compatibility;
10. retention cleanup does not delete pending/dead unexpectedly.

### 29.3 Failure Injection

Simulate:

- broker unavailable;
- DB deadlock;
- app crash after commit;
- consumer crash after DB commit before ack;
- duplicate message;
- out-of-order message;
- poison payload;
- external API timeout;
- CDC lag.

---

## 30. Checklist Desain

Sebelum approve design integration, jawab ini:

1. Apa source of truth?
2. Apa yang harus atomic dalam satu DB transaction?
3. Apa side effect eksternal yang tidak bisa rollback?
4. Apakah side effect itu critical atau best-effort?
5. Jika DB commit sukses tapi side effect gagal, bagaimana recovery?
6. Jika side effect sukses tapi response/app crash, bagaimana dedup?
7. Apa idempotency key-nya?
8. Unique constraint apa yang menjamin dedup?
9. Apa message id dan event version?
10. Apa ordering scope?
11. Apakah consumer aman terhadap duplicate?
12. Apakah consumer aman terhadap out-of-order?
13. Apa retry policy?
14. Kapan message masuk dead letter?
15. Bagaimana replay dilakukan?
16. Bagaimana event schema berevolusi?
17. Apakah payload mengandung data sensitif?
18. Apa retention policy?
19. Apa metric backlog dan lag?
20. Bagaimana incident response jika backlog naik?

---

## 31. Latihan / Scenario

### Scenario 1 — Approval Event Hilang

Sebuah service melakukan:

```text
update case status approved
publish RabbitMQ event
```

Kadang reporting service tidak mendapat event walau case sudah approved.

Tugas:

1. Buat failure matrix.
2. Desain outbox table.
3. Desain publisher worker.
4. Desain consumer idempotency.
5. Tentukan metric dan alert.

### Scenario 2 — Duplicate Email

Applicant kadang menerima email approval dua kali.

Tugas:

1. Identifikasi kemungkinan penyebab.
2. Tentukan dedup key untuk notification.
3. Desain notification table/inbox.
4. Tentukan kapan duplicate harus diabaikan.
5. Tentukan bagaimana replay email yang gagal.

### Scenario 3 — Search Index Tidak Konsisten

Search result menampilkan status lama setelah case di-update.

Tugas:

1. Jelaskan kenapa search index bukan source of truth.
2. Desain outbox event untuk indexing.
3. Tentukan apakah indexer memakai event payload atau load latest state dari DB.
4. Desain rebuild strategy.
5. Tentukan observability metric.

### Scenario 4 — External API Timeout

Certificate generation API timeout. Kadang certificate tetap terbentuk di external system.

Tugas:

1. Jelaskan unknown result problem.
2. Desain idempotency key untuk external API.
3. Jika provider tidak support idempotency, desain reconciliation.
4. Tentukan local status model.
5. Tentukan retry policy.

---

## 32. Ringkasan

Database integration bukan sekadar “setelah save lalu publish”. Ia adalah desain consistency boundary antar sistem yang tidak berbagi atomic commit.

Core mental model:

```text
Local DB transaction is reliable only inside its boundary.
Everything outside needs durable coordination, retry, idempotency, and reconciliation.
```

Pattern utama:

- **Transactional outbox**: agar perubahan database dan niat mengirim event commit atomik.
- **Inbox/idempotent consumer**: agar duplicate message tidak mengulang side effect.
- **Idempotency key**: agar retry command aman.
- **CDC**: membaca perubahan outbox dari transaction log untuk event streaming.
- **Aggregate version/partition key**: menjaga ordering per aggregate.
- **Dead letter/replay**: mengelola poison message dan recovery.
- **Observability**: memastikan backlog, lag, duplicate, retry, dan dead message terlihat.

Kalimat paling penting dari bagian ini:

> Outbox tidak membuat delivery menjadi exactly-once. Outbox membuat event tidak hilang setelah database commit. Exactly-once business effect dicapai lewat idempotent consumer, unique constraint, state machine, dan reconciliation.

---

## 33. Referensi Utama

- Jakarta Persistence 3.2 Specification dan `EntityManager` API — persistence context, flush, transaction interaction.
- Jakarta Transactions 2.0 Specification — transaction manager/resource manager/application interaction.
- Hibernate ORM User Guide — persistence context, flushing, transaction, batching, provider behavior.
- Spring Framework Transaction Documentation — transaction synchronization, `@TransactionalEventListener`, transaction propagation.
- Microservices.io — Transactional Outbox Pattern.
- Debezium Documentation — Outbox Event Router and CDC-based event routing.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 025 — Spring Transaction + JPA Integration Deep Dive](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-025.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 027 — Performance Engineering for JPA/Hibernate](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-027.md)

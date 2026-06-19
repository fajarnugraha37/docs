# Part 9 — Transactional Outbox, Inbox, CDC, and Reliable Publishing

Series: `learn-java-microservices-patterns-advanced-engineering`  
Filename: `learn-java-microservices-patterns-advanced-engineering-09-outbox-inbox-cdc-reliable-publishing.md`  
Status: Part 9 of 35  
Target: Java 8 sampai Java 25, dengan fokus production-grade microservices architecture.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas synchronous API, asynchronous messaging, event-driven architecture, dan Saga. Namun semua pola tersebut menyisakan satu pertanyaan fundamental:

> Bagaimana sebuah service bisa mengubah state lokal di database **dan** memberitahu dunia luar secara reliable tanpa distributed transaction?

Contoh sederhana:

```text
Application Service menerima command ApproveApplication.
Service harus:
1. update APPLICATION.status = APPROVED
2. publish event ApplicationApproved
```

Jika update database berhasil tetapi publish event gagal, sistem lain tidak pernah tahu bahwa application sudah approved. Jika publish event berhasil tetapi database rollback, sistem lain percaya sesuatu yang sebenarnya tidak terjadi.

Itulah **dual-write problem**.

Part ini membahas pola yang sering menjadi tulang punggung microservices production:

1. Transactional Outbox
2. Message Relay
3. Polling Publisher
4. CDC-based Publisher
5. Debezium-style Outbox Event Router
6. Transactional Inbox
7. Idempotent Consumer
8. Reliable Reprocessing
9. Outbox Cleanup
10. Operational Observability
11. Failure Mode Analysis
12. Java 8–25 implementation strategy

Target pemahaman setelah part ini:

- memahami mengapa `database.save(); broker.publish();` adalah bug arsitektur, bukan sekadar bug coding;
- mampu menjelaskan perbedaan **reliable publish**, **reliable consume**, dan **exactly-once business effect**;
- mampu mendesain tabel outbox/inbox yang aman;
- mampu memilih antara polling publisher dan CDC;
- mampu menjelaskan limitasi Kafka exactly-once semantics dalam konteks database lokal;
- mampu membangun mental model recovery ketika relay crash, broker down, consumer duplicate, schema berubah, replay dilakukan, atau ordering terganggu;
- mampu menulis Java implementation yang tidak bergantung pada magic framework.

---

## 1. Masalah Inti: Dual-Write Problem

Dual-write problem terjadi ketika satu business operation harus menulis ke dua resource berbeda yang tidak berada dalam satu atomic transaction.

Contoh:

```java
@Transactional
public void approve(ApproveApplicationCommand command) {
    Application app = repository.findById(command.applicationId());
    app.approve(command.actor());
    repository.save(app);

    eventPublisher.publish(new ApplicationApprovedEvent(app.id()));
}
```

Kode ini terlihat normal. Namun secara distributed systems, ada beberapa titik gagal:

```text
Case 1:
DB commit sukses
publish ke broker gagal
=> state sudah berubah, event hilang

Case 2:
publish ke broker sukses
DB commit gagal / rollback
=> event bohong, consumer melihat fact yang tidak valid

Case 3:
publish sukses
process crash sebelum response
client retry command
=> duplicate operation/event

Case 4:
DB commit sukses
process crash sebelum publish
=> tidak ada event

Case 5:
publish timeout, tetapi broker sebenarnya menerima message
service retry publish
=> duplicate event
```

Masalah ini tidak selesai hanya dengan `try/catch`, retry, atau `@Transactional` biasa, karena database dan message broker memiliki transaction coordinator yang berbeda.

Microservices yang sehat harus mengakui bahwa:

> Local database transaction hanya melindungi local state. Ia tidak otomatis melindungi message yang keluar dari process.

---

## 2. Mental Model: State Change dan Signal Harus Satu Nasib

Ketika service mengubah state dan perlu memberi tahu service lain, ada dua artefak penting:

```text
1. Business state
   Contoh: application.status = APPROVED

2. Integration signal
   Contoh: ApplicationApproved event
```

Agar reliable, keduanya harus punya hubungan berikut:

```text
Jika state berubah, signal harus eventually keluar.
Jika state tidak berubah, signal tidak boleh keluar sebagai fact final.
```

Transactional Outbox menyelesaikan ini dengan prinsip sederhana:

> Simpan state change dan signal ke database yang sama, dalam transaction yang sama.

Jadi operation menjadi:

```text
BEGIN TRANSACTION
  update application status
  insert outbox row ApplicationApproved
COMMIT
```

Setelah commit, proses terpisah akan membaca outbox dan publish ke broker.

Dengan ini:

```text
DB commit gagal  => state tidak berubah, outbox tidak ada
DB commit sukses => state berubah, outbox ada dan bisa dipublish ulang sampai berhasil
```

Transactional Outbox tidak membuat dunia menjadi exactly-once. Ia membuat publish menjadi **recoverable**.

---

## 3. Kenapa Bukan Distributed Transaction / 2PC?

Secara teoritis, kita bisa memakai distributed transaction atau two-phase commit antara database dan broker.

Namun dalam microservices modern, ini sering dihindari karena:

1. tidak semua broker mendukung XA/distributed transaction;
2. koordinasi lintas resource meningkatkan latency;
3. availability turun karena coordinator menjadi bottleneck;
4. failure recovery menjadi kompleks;
5. resource bisa terkunci lebih lama;
6. cloud-native infrastructure sering tidak dirancang untuk XA;
7. service autonomy turun karena semua resource harus ikut protocol yang sama.

Dalam banyak sistem enterprise, pilihan yang lebih praktis adalah:

```text
Local transaction + outbox + relay + idempotent consumer
```

Ini menggeser target dari:

```text
exactly-once distributed transaction
```

menjadi:

```text
at-least-once delivery + idempotent processing + eventual consistency
```

Top 1% engineer tidak bertanya “bagaimana membuat semua persis sekali secara magic?” tetapi:

```text
Di mana correctness boundary-nya?
Apa yang harus atomic?
Apa yang boleh eventual?
Apa yang harus idempotent?
Apa yang harus direkonsiliasi?
Apa yang harus diaudit?
```

---

## 4. Transactional Outbox Pattern

### 4.1 Definisi

Transactional Outbox adalah pattern di mana service tidak langsung publish message ke broker di tengah business transaction. Sebaliknya, service menyimpan message ke tabel outbox dalam database lokal yang sama dengan business data.

Struktur alurnya:

```text
Client / Consumer
      |
      v
Application Service
      |
      | local transaction
      v
+--------------------------+
| Service Database         |
|                          |
| business_table           |
| outbox_message           |
+--------------------------+
      |
      | relay reads committed outbox rows
      v
Message Broker / Stream
      |
      v
Consumers
```

### 4.2 Sifat Penting

Transactional Outbox menjamin:

```text
Jika business transaction commit, outbox row juga commit.
Jika business transaction rollback, outbox row juga rollback.
Jika publisher crash, outbox row masih tersimpan.
Jika broker down, outbox row bisa dicoba lagi.
```

Namun Transactional Outbox **tidak menjamin**:

```text
consumer hanya menerima satu kali;
message tidak pernah duplicate;
ordering global semua event;
business operation lintas service menjadi atomic;
consumer tidak gagal;
schema selalu compatible;
relay tidak butuh observability.
```

Karena itu outbox harus dipasangkan dengan:

```text
1. idempotent consumer
2. inbox/dedup table
3. retry policy
4. dead-letter / parking-lot strategy
5. monitoring lag
6. schema compatibility discipline
7. reconciliation
```

---

## 5. Outbox Table Design

Desain tabel outbox menentukan reliability dan operability. Tabel yang terlalu minimal akan menyulitkan recovery, audit, tracing, dan replay.

Contoh schema generik:

```sql
CREATE TABLE outbox_message (
    id                 VARCHAR(64) PRIMARY KEY,
    aggregate_type     VARCHAR(128) NOT NULL,
    aggregate_id       VARCHAR(128) NOT NULL,
    event_type         VARCHAR(256) NOT NULL,
    event_version      INTEGER NOT NULL,
    destination        VARCHAR(256) NULL,
    partition_key      VARCHAR(256) NULL,
    payload_json       CLOB NOT NULL,
    headers_json       CLOB NULL,
    status             VARCHAR(32) NOT NULL,
    attempt_count      INTEGER NOT NULL,
    next_attempt_at    TIMESTAMP NULL,
    last_error         CLOB NULL,
    occurred_at        TIMESTAMP NOT NULL,
    created_at         TIMESTAMP NOT NULL,
    published_at       TIMESTAMP NULL,
    locked_by          VARCHAR(128) NULL,
    locked_until       TIMESTAMP NULL,
    trace_id           VARCHAR(128) NULL,
    correlation_id     VARCHAR(128) NULL,
    causation_id       VARCHAR(128) NULL
);

CREATE INDEX idx_outbox_status_next_attempt
    ON outbox_message(status, next_attempt_at, created_at);

CREATE INDEX idx_outbox_aggregate
    ON outbox_message(aggregate_type, aggregate_id, created_at);
```

Untuk PostgreSQL, `JSONB` bisa dipakai. Untuk Oracle, `CLOB`, `BLOB`, atau native JSON type tergantung versi dan standard enterprise yang digunakan. Untuk MySQL, `JSON` bisa dipakai dengan pertimbangan indexing.

### 5.1 Field `id`

`id` harus globally unique. Pilihan:

```text
UUID v4
ULID
UUID v7
Snowflake-like id
business-derived deterministic id
```

Untuk outbox, id bukan hanya technical primary key. Ia menjadi deduplication key downstream.

Contoh:

```text
message id = 01HRXYZ...
consumer menyimpan message id ini di inbox
jika message datang ulang, consumer skip
```

### 5.2 Field `aggregate_type` dan `aggregate_id`

Digunakan untuk:

```text
ordering per aggregate;
replay per aggregate;
debugging;
partition key;
audit trace;
correlation dengan business entity.
```

Contoh:

```text
aggregate_type = Application
aggregate_id   = APP-2026-000123
```

### 5.3 Field `event_type` dan `event_version`

Jangan hanya menaruh payload tanpa type. Consumer perlu tahu semantic message.

Contoh:

```text
event_type    = ApplicationApproved
event_version = 3
```

Version penting karena event contract berubah lebih lambat daripada code.

### 5.4 Field `destination`

Bisa berupa:

```text
Kafka topic
RabbitMQ exchange + routing key
JMS destination
SNS topic
internal stream name
```

Namun hati-hati: jika destination terlalu bebas, producer bisa menjadi terlalu tahu routing fisik. Dalam sistem yang lebih matang, destination bisa diturunkan oleh relay dari `event_type` atau event catalog.

### 5.5 Field `partition_key`

Untuk Kafka/stream, partition key menentukan ordering dan distribution.

Umumnya:

```text
partition_key = aggregate_id
```

Ini menjaga ordering per aggregate.

Namun jika aggregate tertentu sangat panas, key tersebut bisa membuat hot partition. Maka perlu desain:

```text
business ordering need vs load distribution
```

### 5.6 Field `payload_json`

Payload harus berupa integration contract, bukan dump internal entity.

Buruk:

```json
{
  "applicationEntity": {
    "hibernateLazyField": "...",
    "internalStatusCode": "A1",
    "internalWorkflowNode": "N_17"
  }
}
```

Lebih baik:

```json
{
  "applicationId": "APP-2026-000123",
  "approvedAt": "2026-06-19T10:15:30Z",
  "approvedBy": "user-123",
  "approvalOutcome": "APPROVED",
  "caseType": "SALESPERSON_REGISTRATION"
}
```

### 5.7 Field `headers_json`

Header membawa metadata lintas sistem:

```json
{
  "messageId": "01HRXYZ...",
  "correlationId": "corr-abc",
  "causationId": "cmd-123",
  "traceId": "trace-789",
  "tenantId": "agency-a",
  "actorId": "user-123",
  "schemaVersion": "3",
  "producer": "application-service",
  "producerVersion": "2026.06.19-1"
}
```

### 5.8 Field `status`

Status minimal:

```text
PENDING
PROCESSING
PUBLISHED
FAILED
DEAD
```

Namun status outbox harus dipahami sebagai operational state, bukan business state.

Untuk CDC-based outbox, sering kali tidak perlu update status menjadi `PUBLISHED`, karena log-based connector membaca insert outbox dan langsung publish. Cleanup dilakukan dengan retention atau job terpisah.

### 5.9 Field `attempt_count`, `next_attempt_at`, `last_error`

Diperlukan untuk retry yang terkendali.

Tanpa ini, relay bisa membuat broker/service dependency overload.

Contoh retry schedule:

```text
attempt 1: immediate
attempt 2: +5 seconds
attempt 3: +30 seconds
attempt 4: +2 minutes
attempt 5: +10 minutes
then DEAD / parking lot
```

### 5.10 Field `locked_by`, `locked_until`

Untuk polling publisher multi-instance, perlu mekanisme claim row agar dua relay tidak mempublish row yang sama secara bersamaan.

Namun harus tetap diasumsikan duplicate bisa terjadi.

Kenapa?

```text
Relay A claim row
Relay A publish berhasil
Relay A crash sebelum update status PUBLISHED
locked_until expired
Relay B claim row
Relay B publish lagi
=> duplicate
```

Karena itu consumer tetap harus idempotent.

---

## 6. Writing Outbox in Java

### 6.1 Core Rule

Outbox row harus ditulis dalam transaction yang sama dengan business state.

```java
@Transactional
public void approve(ApproveApplicationCommand command) {
    Application application = applicationRepository.getById(command.applicationId());

    ApplicationApproved event = application.approve(
            command.actorId(),
            command.reason(),
            clock.instant()
    );

    applicationRepository.save(application);
    outboxRepository.save(OutboxMessage.from(event));
}
```

Yang penting:

```text
repository.save(application)
outboxRepository.save(message)
```

berada di transaction database yang sama.

### 6.2 Jangan Publish di `@Transactional` Method

Buruk:

```java
@Transactional
public void approve(...) {
    applicationRepository.save(application);
    kafkaTemplate.send("application-events", event);
}
```

Problem:

1. send bisa terjadi sebelum commit;
2. send bisa sukses tetapi transaction rollback;
3. commit bisa sukses tetapi send gagal;
4. send bisa async sehingga error tidak terlihat;
5. retry publish bisa duplicate.

### 6.3 Jangan Mengandalkan `afterCommit` Saja

Beberapa framework punya hook `afterCommit`.

Contoh konsep:

```java
TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
    @Override
    public void afterCommit() {
        eventPublisher.publish(event);
    }
});
```

Ini lebih baik daripada publish sebelum commit, tetapi tetap tidak cukup reliable.

Jika process crash setelah commit tetapi sebelum `afterCommit` selesai, event hilang.

`afterCommit` boleh dipakai untuk optimization, misalnya trigger relay lebih cepat, tetapi bukan sumber reliability.

Sumber reliability tetap outbox durable row.

---

## 7. Message Relay Pattern

Outbox row tidak berguna jika tidak ada relay yang memindahkannya ke broker.

Message Relay adalah komponen yang:

```text
1. membaca outbox row committed;
2. mengubah row menjadi broker message;
3. publish ke broker;
4. menandai row sebagai published atau membiarkannya untuk cleanup;
5. retry jika gagal;
6. expose metrics dan alert.
```

Ada dua pendekatan besar:

```text
1. Polling Publisher
2. Transaction Log Tailing / CDC Publisher
```

---

## 8. Polling Publisher

Polling publisher secara periodik membaca tabel outbox.

Alur:

```text
loop:
  SELECT PENDING rows WHERE next_attempt_at <= now LIMIT N
  claim rows
  publish each row
  mark PUBLISHED or retry/DEAD
  sleep small interval
```

### 8.1 Kelebihan

```text
Mudah dipahami
Tidak butuh CDC infrastructure
Bisa dibuat dengan JDBC biasa
Cocok untuk volume rendah-menengah
Mudah di-debug lewat tabel outbox
Bisa diterapkan di Java 8 legacy system
```

### 8.2 Kekurangan

```text
Polling menambah query load
Latency tergantung interval polling
Locking bisa kompleks
Ordering perlu hati-hati
Cleanup perlu dikelola
Multi-instance relay bisa duplicate
High volume bisa membebani database
```

### 8.3 Claiming Rows

PostgreSQL contoh:

```sql
SELECT id
FROM outbox_message
WHERE status = 'PENDING'
  AND (next_attempt_at IS NULL OR next_attempt_at <= now())
ORDER BY created_at
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Oracle juga mendukung `SKIP LOCKED` pada pattern tertentu.

Setelah row dipilih:

```sql
UPDATE outbox_message
SET status = 'PROCESSING',
    locked_by = ?,
    locked_until = ?,
    attempt_count = attempt_count + 1
WHERE id = ?;
```

### 8.4 Relay Pseudocode

```java
public final class OutboxRelay implements Runnable {
    private final OutboxRepository outboxRepository;
    private final BrokerPublisher publisher;
    private final Clock clock;

    @Override
    public void run() {
        while (!Thread.currentThread().isInterrupted()) {
            List<OutboxMessage> batch = outboxRepository.claimBatch(
                    "relay-1",
                    100,
                    clock.instant().plusSeconds(30)
            );

            for (OutboxMessage message : batch) {
                try {
                    publisher.publish(message.toBrokerRecord());
                    outboxRepository.markPublished(message.id(), clock.instant());
                } catch (RetriablePublishException e) {
                    outboxRepository.markRetry(
                            message.id(),
                            nextAttempt(message.attemptCount()),
                            e.getMessage()
                    );
                } catch (NonRetriablePublishException e) {
                    outboxRepository.markDead(message.id(), e.getMessage());
                }
            }

            sleepBrieflyIfBatchEmpty(batch);
        }
    }
}
```

### 8.5 Important: Mark Published After Broker Ack

Relay boleh menandai row `PUBLISHED` hanya setelah broker memberi acknowledgement yang cukup kuat.

Namun tetap ada race:

```text
publish succeeded
broker ack received
process crash before markPublished
row remains PROCESSING/PENDING
later republished
=> duplicate
```

Ini unavoidable tanpa distributed transaction antara DB dan broker.

Karena itu downstream idempotency wajib.

---

## 9. CDC-Based Publisher

CDC berarti Change Data Capture. Alih-alih polling tabel secara manual, connector membaca database transaction log.

Alur:

```text
Application transaction:
  update business table
  insert outbox row
  commit

Database WAL/binlog/redo log:
  contains committed outbox insert

CDC connector:
  reads log
  transforms outbox row
  publishes to broker
```

Contoh ekosistem:

```text
Debezium + Kafka Connect
Database redo/binlog/WAL
Outbox Event Router transform
Kafka topic per aggregate/event type
```

### 9.1 Kelebihan CDC

```text
Tidak perlu polling query terus-menerus
Mengikuti commit order database lebih natural
Lebih scalable untuk volume besar
Tidak perlu update status PUBLISHED per row
Mengurangi locking complexity
Cocok untuk event streaming platform
```

### 9.2 Kekurangan CDC

```text
Butuh infrastructure Kafka Connect/Debezium atau sejenis
Butuh akses transaction log database
Operational complexity lebih tinggi
Schema config lebih ketat
Debugging connector failure butuh skill khusus
Initial snapshot/backfill perlu hati-hati
Database-specific behavior penting
```

### 9.3 Debezium Outbox Event Router

Debezium menyediakan transform untuk outbox event routing. Secara konsep, row outbox dipetakan menjadi message dengan:

```text
aggregate id -> key
payload      -> value
event type   -> route/topic
metadata     -> headers
```

Default outbox model umumnya memakai kolom seperti:

```text
id
aggregatetype
aggregateid
type
payload
timestamp
```

Kita tidak harus mengikuti default secara membabi buta. Yang penting adalah memahami contract yang dihasilkan ke broker.

### 9.4 CDC dan Ordering

CDC biasanya menjaga order commit dari database log untuk satu source database/partition. Namun begitu message masuk broker, ordering bergantung pada:

```text
broker topic partitioning;
message key;
consumer parallelism;
consumer processing model;
retry/requeue behavior;
projection update strategy.
```

Jangan mengklaim global ordering kecuali desain benar-benar membuktikannya.

### 9.5 CDC dan Cleanup

Jika CDC membaca insert outbox row, kita perlu memastikan row tidak dihapus sebelum connector membacanya.

Cleanup rule:

```text
hapus outbox row hanya setelah retention window aman;
atau setelah connector offset sudah melewati row;
atau dengan partitioned table + time-based retention;
atau archive sebelum delete jika audit diperlukan.
```

Untuk sistem regulated, outbox bisa menjadi bagian dari technical audit. Jangan sembarang purge tanpa retention policy.

---

## 10. Polling vs CDC Decision Matrix

| Dimension | Polling Publisher | CDC Publisher |
|---|---|---|
| Setup complexity | rendah-menengah | tinggi |
| Infrastructure | app + DB | DB log + connector + broker |
| Latency | interval-based | near real-time |
| DB load | query polling | log-based |
| Operational skill | Java/SQL | CDC/Kafka Connect/DB log |
| Volume tinggi | bisa, tapi perlu tuning | lebih cocok |
| Legacy Java 8 | mudah | mungkin, tapi infra lebih berat |
| Debuggability | mudah via table status | perlu connector visibility |
| Per-message retry state | mudah di table | biasanya lewat connector/broker/DLQ |
| Ordering | perlu desain query/lock | commit-log-friendly, tetap perlu key |
| Cleanup | explicit status/retention | retention harus sinkron dengan connector |

Rule of thumb:

```text
Mulai dengan polling jika:
- volume rendah/menengah;
- tim belum siap CDC;
- butuh cepat dan mudah di-debug;
- legacy enterprise environment membatasi infra.

Pilih CDC jika:
- volume tinggi;
- broker/event streaming sudah platform standar;
- database log access tersedia;
- tim siap mengoperasikan connector;
- latency dan DB polling overhead menjadi masalah.
```

---

## 11. Transactional Inbox Pattern

Outbox menjawab pertanyaan:

```text
Bagaimana producer publish message secara reliable setelah local commit?
```

Inbox menjawab pertanyaan:

```text
Bagaimana consumer memproses message duplicate secara aman?
```

Karena outbox/relay/broker umumnya memberikan at-least-once delivery, consumer harus siap menerima message yang sama lebih dari sekali.

Transactional Inbox menyimpan message id yang sudah diproses di database consumer dalam transaction yang sama dengan business side effect.

Alur:

```text
Consumer receives message M
BEGIN TRANSACTION
  INSERT INTO inbox_message(message_id, consumer_name, received_at)
  perform business update
COMMIT
ACK broker
```

Jika message duplicate datang:

```text
INSERT inbox duplicate key fails
consumer knows message already processed
ACK without reprocessing side effect
```

### 11.1 Inbox Table Design

```sql
CREATE TABLE inbox_message (
    message_id       VARCHAR(64) NOT NULL,
    consumer_name    VARCHAR(128) NOT NULL,
    producer_name    VARCHAR(128) NULL,
    event_type       VARCHAR(256) NOT NULL,
    event_version    INTEGER NOT NULL,
    aggregate_type   VARCHAR(128) NULL,
    aggregate_id     VARCHAR(128) NULL,
    received_at      TIMESTAMP NOT NULL,
    processed_at     TIMESTAMP NULL,
    status           VARCHAR(32) NOT NULL,
    error_message    CLOB NULL,
    trace_id         VARCHAR(128) NULL,
    correlation_id   VARCHAR(128) NULL,
    PRIMARY KEY (message_id, consumer_name)
);
```

`consumer_name` penting karena satu service bisa punya beberapa independent handlers.

Contoh:

```text
message_id = 01HRXYZ
consumer_name = report-projection-consumer

message_id = 01HRXYZ
consumer_name = notification-consumer
```

Keduanya boleh memproses message yang sama untuk tujuan berbeda.

### 11.2 Consumer Pseudocode

```java
public void handle(BrokerMessage brokerMessage) {
    String messageId = brokerMessage.header("messageId");

    try {
        transactionTemplate.executeWithoutResult(tx -> {
            boolean firstTime = inboxRepository.tryStartProcessing(
                    messageId,
                    "application-read-model-consumer",
                    brokerMessage.metadata()
            );

            if (!firstTime) {
                return;
            }

            ApplicationApproved event = mapper.deserialize(brokerMessage.payload());
            readModelProjection.apply(event);

            inboxRepository.markProcessed(
                    messageId,
                    "application-read-model-consumer",
                    clock.instant()
            );
        });

        broker.ack(brokerMessage);
    } catch (Exception e) {
        broker.nackOrRetry(brokerMessage, e);
    }
}
```

### 11.3 Atomic Consumer Side Effect

Inbox row dan business update harus satu transaction.

Buruk:

```text
insert inbox commit
business update fails
message dianggap processed padahal effect tidak terjadi
```

Buruk juga:

```text
business update commit
insert inbox fails
message duplicate akan diproses ulang
```

Benar:

```text
BEGIN
  insert inbox
  update projection/business state
  mark inbox processed
COMMIT
```

---

## 12. Idempotent Consumer vs Inbox

Idempotent consumer adalah konsep. Inbox adalah salah satu implementasi.

Consumer bisa idempotent dengan beberapa cara:

### 12.1 Natural Idempotency

Contoh:

```sql
UPDATE application_read_model
SET status = 'APPROVED'
WHERE application_id = ?;
```

Jika dijalankan dua kali, hasil akhirnya sama.

Namun hati-hati: side effect lain mungkin tidak idempotent.

```text
send email twice
create notification twice
increment counter twice
append audit row twice
```

### 12.2 Unique Constraint

```sql
INSERT INTO notification(id, message_id, recipient, text)
VALUES (?, ?, ?, ?);
```

Dengan unique constraint pada `message_id`, duplicate bisa dicegah.

### 12.3 State Transition Guard

```sql
UPDATE application
SET status = 'APPROVED'
WHERE id = ?
  AND status = 'PENDING_REVIEW';
```

Jika event datang ulang setelah status approved, update count 0 dan dianggap duplicate/no-op.

### 12.4 Inbox Table

Inbox paling eksplisit dan audit-friendly.

Cocok jika:

```text
message processing punya side effect penting;
butuh audit apakah message sudah diproses;
perlu replay control;
perlu debugging duplicate;
ada banyak handler;
consumer tidak natural idempotent.
```

---

## 13. Exactly-Once: Bedakan Delivery, Processing, dan Business Effect

Istilah exactly-once sering membingungkan.

Kita harus membedakan:

```text
1. Exactly-once delivery
   Message dikirim ke consumer tepat satu kali.

2. Exactly-once processing
   Processing pipeline menerapkan transform tepat satu kali.

3. Exactly-once business effect
   Dampak bisnis yang terlihat terjadi tepat satu kali.
```

Dalam microservices dengan database lokal dan broker, target praktis biasanya:

```text
At-least-once delivery
+ idempotent processing
+ deduplication key
= effectively-once business effect
```

Kafka transactions bisa memberikan guarantees tertentu dalam Kafka ecosystem, terutama consume-process-produce di Kafka. Namun jika consumer juga menulis ke database eksternal, database write itu tidak otomatis menjadi bagian dari Kafka transaction kecuali ada desain tambahan.

Jadi jangan menyimpulkan:

```text
Kafka exactly-once enabled => seluruh bisnis exactly-once
```

Lebih tepat:

```text
Kafka exactly-once can help within Kafka boundaries,
but external side effects still require idempotency, transactional writes, or deduplication.
```

---

## 14. Outbox + Inbox End-to-End Flow

Gabungan pattern:

```text
Service A command handler
  BEGIN DB TX
    update business state
    insert outbox message M
  COMMIT

Relay A
  read outbox M
  publish M to broker

Broker
  deliver M to Service B

Service B consumer
  BEGIN DB TX
    insert inbox M for handler H
    update local state / projection
  COMMIT
  ACK broker
```

Failure handling:

```text
If Service A crashes before commit:
  no business state, no outbox, no event

If Service A crashes after commit:
  outbox remains, relay can publish later

If Relay publishes twice:
  Service B inbox deduplicates

If Service B crashes before commit:
  broker redelivers, inbox not committed, process again

If Service B crashes after commit but before ack:
  broker redelivers, inbox detects duplicate, ack safely
```

This is the core reliability story.

---

## 15. Outbox Message Design: Event Payload vs Reference

Ada dua gaya payload:

```text
1. event-carried state transfer
2. reference event / notification event
```

### 15.1 Event-Carried State Transfer

Event membawa data yang cukup untuk consumer memperbarui local read model tanpa call balik ke producer.

```json
{
  "applicationId": "APP-2026-000123",
  "status": "APPROVED",
  "approvedAt": "2026-06-19T10:15:30Z",
  "approvedBy": "user-123",
  "caseType": "SALESPERSON_REGISTRATION"
}
```

Kelebihan:

```text
consumer tidak perlu synchronous call ke producer;
lebih resilient;
cocok untuk materialized view;
cocok untuk replay.
```

Kekurangan:

```text
event payload lebih besar;
schema evolution lebih penting;
privacy/data minimization harus diperhatikan.
```

### 15.2 Reference Event

Event hanya memberi tahu bahwa sesuatu berubah.

```json
{
  "applicationId": "APP-2026-000123"
}
```

Consumer harus call producer untuk detail.

Kelebihan:

```text
payload kecil;
data sensitif tidak tersebar;
consumer selalu fetch latest state.
```

Kekurangan:

```text
menciptakan synchronous dependency;
consumer bisa gagal jika producer down;
replay tidak deterministic jika current state berubah;
risiko thundering herd saat banyak event.
```

Rule of thumb:

```text
Untuk event-driven projection, prefer event-carried state transfer.
Untuk security/privacy-sensitive event, gunakan minimal payload + controlled query API.
```

---

## 16. Ordering Strategy

Outbox sering dipakai untuk event terkait aggregate. Pertanyaan penting:

```text
Jika ApplicationSubmitted, ApplicationApproved, ApplicationRevoked terjadi berurutan,
apakah consumer melihat urutan yang sama?
```

### 16.1 Ordering Per Aggregate

Paling umum:

```text
partition key = aggregate_id
sequence number = aggregate_version
```

Event payload:

```json
{
  "applicationId": "APP-2026-000123",
  "aggregateVersion": 17,
  "eventType": "ApplicationApproved"
}
```

Consumer bisa menerapkan guard:

```text
accept event if version = current_version + 1
ignore if version <= current_version
park if version > current_version + 1
```

### 16.2 Global Ordering

Global ordering seluruh service biasanya mahal dan tidak diperlukan.

Pertanyaan yang lebih benar:

```text
Ordering apa yang dibutuhkan oleh invariant bisnis?
Per application?
Per case?
Per account?
Per tenant?
Per workflow instance?
```

### 16.3 Out-of-Order Handling

Consumer harus punya strategi:

```text
1. ignore stale event
2. park future event
3. re-fetch snapshot
4. rebuild projection from replay
5. mark projection inconsistent and reconcile
```

---

## 17. Replay and Reprocessing

Outbox/inbox membuat replay mungkin, tetapi replay bukan sekadar “kirim ulang semua event”.

### 17.1 Replay Questions

Sebelum replay, jawab:

```text
Apakah event handler deterministic?
Apakah side effect external akan terjadi ulang?
Apakah email/SMS akan terkirim ulang?
Apakah audit row akan double?
Apakah projection bisa rebuild dari nol?
Apakah event lama masih schema-compatible?
Apakah consumer lama masih aktif?
Apakah data sensitif dalam event lama masih boleh diproses?
```

### 17.2 Replay-Safe Handler

Handler replay-safe biasanya memisahkan:

```text
projection update: replayable
external notification: not replayable unless guarded
business command: usually not replayed as event
```

Contoh buruk:

```java
public void on(ApplicationApproved event) {
    projection.update(event);
    emailClient.sendApprovalEmail(event.applicationId());
}
```

Jika replay dilakukan, email terkirim ulang.

Lebih baik:

```text
ApplicationApproved -> update projection
ApplicationApproved -> create NotificationRequested command/event with dedup key
Notification service -> idempotent send
```

Atau handler membedakan mode replay:

```text
normal processing => allow side effects
replay processing => projection only
```

Namun mode replay harus dikontrol ketat agar tidak menjadi sumber inconsistency.

---

## 18. Cleanup and Retention

Outbox dan inbox akan tumbuh terus.

Tanpa cleanup:

```text
table bloat;
index bloat;
slow polling;
slow backup;
high storage cost;
maintenance window membesar.
```

### 18.1 Outbox Cleanup

Untuk polling publisher:

```sql
DELETE FROM outbox_message
WHERE status = 'PUBLISHED'
  AND published_at < now() - interval '14 days';
```

Namun untuk regulated system, lebih baik:

```text
archive -> verify -> delete
```

Atau pakai partitioning:

```text
outbox_message_2026_06_19
outbox_message_2026_06_20
...
drop old partition after retention
```

### 18.2 Inbox Cleanup

Inbox retention minimal harus lebih panjang dari kemungkinan duplicate redelivery/replay.

Jika broker bisa redeliver message lama dalam 7 hari, inbox retention 1 hari terlalu pendek.

Rule:

```text
inbox retention >= maximum duplicate/replay window
```

Untuk event replay historis, bisa perlu permanent dedup atau replay namespace berbeda.

### 18.3 Audit vs Operational Retention

Jangan campur semua tujuan dalam satu tabel hot path.

```text
outbox hot table     => operational publishing
outbox archive table => audit/history
object storage       => long-term retention
```

Untuk sistem regulated, event publication log bisa menjadi bukti bahwa signal pernah dikirim, tetapi biasanya audit bisnis tetap harus berada di audit domain tersendiri.

---

## 19. Failure Mode Matrix

### 19.1 Producer Side

| Failure | Consequence | Mitigation |
|---|---|---|
| DB transaction rollback | no state, no outbox | normal transaction semantics |
| DB commit succeeds, app crashes | outbox remains | relay publishes later |
| Outbox insert fails | transaction rollback | treat as command failure |
| Payload serialization fails before insert | transaction rollback | validate event creation before commit |
| Schema incompatible event inserted | bad event may publish | contract test + schema validation |

### 19.2 Relay Side

| Failure | Consequence | Mitigation |
|---|---|---|
| Relay down | outbox lag grows | monitor lag, restart, autoscale |
| Broker down | retry/backoff, lag grows | backoff, alert, capacity planning |
| Publish succeeds but mark published fails | duplicate later | idempotent consumer |
| Relay publishes bad routing | consumer missing event | event catalog, integration test |
| Poison outbox payload | repeated failure | DEAD status, parking lot, manual repair |

### 19.3 Consumer Side

| Failure | Consequence | Mitigation |
|---|---|---|
| Consumer crashes before DB commit | broker redelivers | transaction rollback + retry |
| Consumer commits but ack fails | duplicate delivery | inbox dedup |
| Handler non-idempotent | duplicate side effect | inbox, unique constraints, guards |
| Schema incompatible | message cannot process | tolerant reader, DLQ, versioning |
| Projection fails halfway | inconsistent read model | transactional projection update |

### 19.4 Operational Side

| Failure | Consequence | Mitigation |
|---|---|---|
| Cleanup deletes unprocessed outbox | event loss | safe retention policy |
| Inbox cleanup too aggressive | duplicates processed as new | retention >= duplicate window |
| CDC connector lag invisible | stale system | lag metrics + alert |
| Outbox table index bloat | relay slows | partitioning, vacuum/reorg, archive |
| Manual repair unsafe | duplicate/corrupt event | runbook + approval + audit |

---

## 20. Observability for Outbox/Inbox

Outbox pattern without observability becomes silent inconsistency.

Minimum metrics:

### 20.1 Producer Metrics

```text
outbox_rows_created_total{event_type}
outbox_create_failed_total{event_type}
outbox_payload_size_bytes{event_type}
```

### 20.2 Relay Metrics

```text
outbox_pending_count
outbox_processing_count
outbox_published_total{event_type,destination}
outbox_publish_failed_total{event_type,destination,error_type}
outbox_dead_count{event_type}
outbox_oldest_pending_age_seconds
outbox_publish_latency_seconds
outbox_relay_batch_size
outbox_relay_loop_duration_seconds
```

### 20.3 CDC Metrics

```text
cdc_connector_lag_seconds
cdc_connector_status
cdc_records_published_total
cdc_errors_total
cdc_offset_age
```

### 20.4 Consumer/Inbox Metrics

```text
inbox_processed_total{consumer,event_type}
inbox_duplicate_total{consumer,event_type}
inbox_failed_total{consumer,event_type,error_type}
inbox_processing_latency_seconds
consumer_lag
consumer_dlq_count
```

### 20.5 Critical Alerts

Alert yang berguna:

```text
oldest pending outbox age > SLA
outbox dead count increases
relay down for > N minutes
CDC connector not running
consumer lag grows continuously
DLQ count increases
inbox duplicate spike abnormal
publish success rate drops
```

Yang tidak cukup:

```text
CPU relay > 80%
```

CPU tinggi belum tentu business inconsistency. Outbox lag tinggi lebih penting.

---

## 21. Correlation, Causation, and Traceability

Outbox message harus membawa metadata untuk debugging lintas service.

### 21.1 Correlation ID

Mengelompokkan semua action dalam satu business flow.

```text
User submit application
Application service creates ApplicationSubmitted
Screening service processes it
Notification service sends email
All share same correlationId
```

### 21.2 Causation ID

Menunjukkan message/command yang menyebabkan event.

```text
commandId = CMD-123
outbox event causationId = CMD-123
next command causationId = messageId of previous event
```

### 21.3 Trace ID

Untuk distributed tracing.

Trace ID tidak selalu sama dengan correlation ID:

```text
trace id      => technical request trace
correlation id => business flow trace
```

Long-running workflow bisa punya banyak trace tetapi satu correlation.

---

## 22. Security and Privacy

Outbox/event sering menyebarkan data ke banyak consumer. Ini bisa menjadi risiko privacy.

Checklist:

```text
Apakah event payload mengandung PII?
Apakah semua consumer berhak menerima field itu?
Apakah topic ACL sudah sesuai?
Apakah data terenkripsi at rest dan in transit?
Apakah retention sesuai regulasi?
Apakah event lama perlu redaction?
Apakah right-to-delete/right-to-correct berdampak pada event log?
Apakah audit trail membocorkan rahasia?
```

Prinsip:

```text
Publish what consumers need, not what producer happens to have.
```

Untuk data sangat sensitif:

```text
minimal event + authorized query API
```

atau:

```text
topic per sensitivity level
consumer allowlist
field-level encryption
```

---

## 23. Java 8–25 Implementation Considerations

### 23.1 Java 8

Java 8 masih umum di sistem enterprise legacy.

Pertimbangan:

```text
Gunakan JDBC/JPA transaction biasa.
Hindari terlalu banyak magic async.
ExecutorService untuk relay.
CompletableFuture tersedia tetapi jangan jadikan substitute reliability.
Gunakan explicit DTO dan serializer.
```

Outbox pattern sangat cocok untuk Java 8 karena tidak membutuhkan fitur modern.

### 23.2 Java 11

Java 11 memberi baseline lebih baik:

```text
JDK HttpClient tersedia jika relay publish ke HTTP endpoint;
TLS/runtime lebih modern;
container awareness JVM lebih matang dibanding Java 8;
string/files API lebih nyaman.
```

### 23.3 Java 17

Java 17 cocok sebagai modern LTS enterprise baseline.

Pertimbangan:

```text
records untuk immutable message DTO;
sealed classes untuk event hierarchy;
pattern matching limited untuk clarity;
better GC/runtime behavior;
stronger encapsulation module ecosystem.
```

Contoh event DTO:

```java
public record ApplicationApprovedEvent(
        String messageId,
        String applicationId,
        long aggregateVersion,
        Instant approvedAt,
        String approvedBy
) {}
```

### 23.4 Java 21

Java 21 membawa virtual threads sebagai fitur final.

Relay polling dapat memakai virtual threads untuk blocking I/O, tetapi jangan salah paham:

```text
virtual threads improve concurrency model;
they do not solve dual-write problem;
they do not remove need for idempotency;
they do not make broker/database atomic.
```

Virtual threads bisa berguna untuk:

```text
parallel publish with bounded concurrency;
blocking JDBC relay code;
consumer handlers that call blocking dependencies;
```

Tetap gunakan concurrency limit.

### 23.5 Java 25

Java 25 sebagai LTS terbaru memberi runtime modern dan language improvements lebih lanjut, tetapi outbox correctness tidak bergantung pada fitur bahasa terbaru.

Prinsipnya:

```text
Correctness from transaction boundary + durable state + idempotency.
Performance/ergonomics from newer runtime.
```

Jangan menjual upgrade Java sebagai pengganti architecture fix.

---

## 24. Framework Positioning

### 24.1 Spring Boot / Spring Transaction

Spring memudahkan local transaction dengan `@Transactional`, `TransactionTemplate`, repository abstraction, Kafka/Rabbit integrations.

Namun Spring tidak otomatis membuat outbox.

Yang harus engineer desain:

```text
outbox table;
message schema;
transaction placement;
relay lifecycle;
retry policy;
dedup strategy;
metrics;
cleanup;
manual repair.
```

### 24.2 Quarkus / Debezium Outbox Extension

Quarkus memiliki integrasi dengan Debezium Outbox extension. Ini bisa mengurangi boilerplate, terutama jika CDC sudah menjadi platform.

Namun tetap pahami generated table/format dan routing behavior.

### 24.3 Jakarta EE / MicroProfile

Dalam Jakarta/MicroProfile stack:

```text
JTA/local transaction;
JPA/JDBC;
MicroProfile Reactive Messaging;
MicroProfile Config;
MicroProfile Fault Tolerance;
MicroProfile Telemetry;
```

bisa digunakan untuk membangun outbox/inbox dengan pola yang sama.

### 24.4 Plain Java

Plain Java tetap memungkinkan:

```text
DataSource + JDBC transaction
scheduled relay
broker client
manual serialization
metrics library
```

Pattern ini tidak milik framework tertentu.

---

## 25. Production-Grade Outbox Design Example

### 25.1 Domain Scenario

Regulatory application approval system:

```text
Application submitted by applicant.
Officer reviews.
Officer approves.
System must notify:
- licensing read model
- compliance screening
- notification service
- audit/reporting service
```

### 25.2 Command Handler

```java
@Transactional
public ApprovalResult approve(ApproveApplicationCommand command) {
    Application app = applicationRepository.getForUpdate(command.applicationId());

    ApplicationApproved approved = app.approve(
            command.officerId(),
            command.reason(),
            clock.instant()
    );

    applicationRepository.save(app);

    OutboxMessage outbox = OutboxMessage.builder()
            .id(messageIdGenerator.newId())
            .aggregateType("Application")
            .aggregateId(app.id().value())
            .eventType("ApplicationApproved")
            .eventVersion(1)
            .partitionKey(app.id().value())
            .payloadJson(json.serialize(approved.toIntegrationPayload()))
            .headersJson(json.serialize(EventHeaders.from(command)))
            .status("PENDING")
            .attemptCount(0)
            .occurredAt(approved.occurredAt())
            .createdAt(clock.instant())
            .correlationId(command.correlationId())
            .causationId(command.commandId())
            .traceId(command.traceId())
            .build();

    outboxRepository.insert(outbox);

    return ApprovalResult.accepted(app.id(), app.version());
}
```

### 25.3 Relay Behavior

```text
Every 500ms:
  claim up to 100 PENDING rows
  publish with key = partition_key
  wait for broker ack
  mark PUBLISHED
  on retriable error -> schedule retry
  on non-retriable error -> DEAD
```

### 25.4 Consumer Behavior

Licensing projection consumer:

```text
on ApplicationApproved:
  begin transaction
    insert inbox row(message id, consumer name)
    update licensing_read_model status = APPROVED
  commit
  ack broker
```

Notification consumer:

```text
on ApplicationApproved:
  begin transaction
    insert inbox row(message id, consumer name)
    insert notification_request with unique(message id, template)
  commit
  ack broker

notification sender:
  sends email idempotently using notification_request id
```

Compliance consumer:

```text
on ApplicationApproved:
  if screening required:
    create ScreeningRequested command/event with dedup key
```

---

## 26. Common Anti-Patterns

### 26.1 Publish Inside Transaction

```text
@Transactional method publishes to broker directly.
```

This creates false atomicity.

### 26.2 Publish After Commit Without Durable Record

Better than publish before commit, but still loses event if process crashes before publish.

### 26.3 Outbox Without Idempotent Consumer

Outbox can duplicate. If consumer is not idempotent, correctness still broken.

### 26.4 Treating Kafka Exactly-Once as Business Exactly-Once

Kafka guarantees do not automatically include external DB writes, email sending, third-party API calls, or regulatory side effects.

### 26.5 Generic Outbox Payload Dump

Dumping internal entity into outbox couples consumers to internal model.

### 26.6 No Outbox Lag Monitoring

Silent event backlog creates stale downstream systems.

### 26.7 Cleanup Too Aggressive

Deleting outbox/inbox rows before relay/duplicate window is safe creates event loss or duplicate processing.

### 26.8 One Global Outbox Table Without Partition Strategy

High-volume systems need partitioning, archiving, indexing, and storage planning.

### 26.9 Outbox as Business Audit Trail

Outbox is technical delivery mechanism. Business audit should be designed separately, though it may reference message ids.

### 26.10 No Manual Repair Runbook

Eventually, a poison message or bad schema will happen. Without repair runbook, team edits DB blindly.

---

## 27. Design Checklist

Before implementing outbox/inbox, answer:

### 27.1 Producer Side

```text
What business transaction creates the event?
Is event created only if business state commits?
Is payload integration-safe?
Does event include message id?
Does event include aggregate id?
Does event include event type/version?
Does event include occurredAt and publishedAt distinction?
Does event include correlation/causation/trace id?
Is partition key explicit?
Is schema compatible?
```

### 27.2 Relay Side

```text
Polling or CDC?
What is the publish acknowledgement condition?
What happens if broker is down?
What is retry/backoff policy?
What is max attempt?
What is dead-letter/parking strategy?
How is relay horizontally scaled?
How are rows claimed safely?
How is duplicate publish handled?
How is lag monitored?
```

### 27.3 Consumer Side

```text
Is consumer idempotent?
Is inbox table needed?
Is inbox write atomic with business effect?
What happens if ack fails after commit?
What happens if schema version is unknown?
What happens if event arrives out of order?
What happens during replay?
Are external side effects deduplicated?
```

### 27.4 Operations

```text
What is retention period?
How are old rows archived/deleted?
How is outbox table indexed?
How is table bloat handled?
What metrics exist?
What alerts exist?
What dashboard exists?
What is manual repair process?
Who owns the outbox relay?
Who owns event contracts?
```

---

## 28. Architecture Review Questions

A senior/principal engineer should ask:

1. What exact inconsistency does outbox prevent?
2. What inconsistency remains even after outbox?
3. Where is idempotency enforced?
4. What is the deduplication key?
5. Is the event payload a stable contract or internal entity dump?
6. What is the ordering guarantee?
7. What is the partition key?
8. Can this event be replayed safely?
9. What external side effects happen in consumers?
10. What is the maximum acceptable outbox lag?
11. How do we detect stuck relay?
12. How do we repair poison messages?
13. How do we evolve event schema?
14. How do we clean up outbox/inbox tables?
15. What is the retention policy?
16. Does the design leak sensitive data?
17. Does CDC have access to necessary database logs?
18. What happens if connector is down for 6 hours?
19. What happens if the same message is delivered after inbox cleanup?
20. Can we prove exactly-once business effect for critical side effects?

---

## 29. Mental Model Summary

The essential model:

```text
Local transaction gives atomic local state.
Outbox attaches outgoing signal to that local transaction.
Relay makes outgoing signal eventually visible.
Broker delivers at least once.
Inbox/idempotency makes duplicate delivery safe.
Reconciliation catches what architecture cannot perfectly guarantee.
Observability proves whether the pipeline is healthy.
```

Or shorter:

```text
Outbox protects producer correctness.
Inbox protects consumer correctness.
CDC/polling moves facts.
Idempotency protects business effects.
Monitoring protects trust.
```

---

## 30. Practical Exercise

### Exercise 1 — Identify Dual Writes

Ambil satu service nyata dan cari code seperti:

```text
save to DB + publish message
save to DB + call external API
save to DB + send email
save to DB + write file
save to DB + update cache
```

Klasifikasikan:

```text
Can external side effect be lost?
Can it happen twice?
Can it happen before DB commit?
Can it happen after rollback?
Can it be compensated?
Can it be idempotent?
```

### Exercise 2 — Design Outbox Table

Untuk event `CaseEscalated`, desain:

```text
outbox columns
message id
aggregate id
event payload
headers
partition key
status lifecycle
indexes
retention
```

### Exercise 3 — Design Inbox Consumer

Untuk consumer `SlaProjectionConsumer`, desain:

```text
inbox table
unique key
transaction boundary
out-of-order handling
duplicate handling
replay handling
```

### Exercise 4 — Failure Simulation

Simulasikan:

```text
relay crash after publish before markPublished
consumer crash after DB commit before broker ack
broker down for 30 minutes
schema incompatible event deployed
cleanup deletes inbox too early
```

Untuk setiap failure, tulis expected behavior dan required mitigation.

---

## 31. Key Takeaways

1. Dual-write problem adalah salah satu akar inconsistency paling umum dalam microservices.
2. Transactional Outbox membuat state change dan outgoing signal commit bersama di database lokal.
3. Outbox tidak mencegah duplicate publish; consumer tetap harus idempotent.
4. Polling publisher lebih sederhana, CDC publisher lebih scalable tetapi operationally lebih kompleks.
5. Inbox pattern menyimpan message yang sudah diproses agar duplicate delivery aman.
6. Exactly-once harus dijelaskan: delivery, processing, atau business effect.
7. Kafka transactions membantu dalam boundary Kafka, tetapi external DB/email/API tetap butuh idempotency/dedup.
8. Replay hanya aman jika handler dirancang replay-safe.
9. Cleanup harus mempertimbangkan relay lag, duplicate window, replay, dan audit retention.
10. Outbox/inbox tanpa observability hanya memindahkan bug menjadi silent backlog.

---

## 32. References

- Microservices.io — Transactional Outbox Pattern: https://microservices.io/patterns/data/transactional-outbox.html
- Microservices.io — Idempotent Consumer Pattern: https://microservices.io/patterns/communication-style/idempotent-consumer.html
- Debezium — Reliable Microservices Data Exchange With the Outbox Pattern: https://debezium.io/blog/2019/02/19/reliable-microservices-data-exchange-with-the-outbox-pattern/
- Debezium Documentation — Outbox Event Router: https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html
- Debezium — Change Data Capture Platform: https://debezium.io/
- Confluent Developer — Kafka Transactional Support and Exactly-Once Semantics: https://developer.confluent.io/courses/architecture/transactions/
- Martin Fowler — Patterns of Distributed Systems: https://martinfowler.com/articles/patterns-of-distributed-systems/
- Martin Fowler — What do you mean by “Event-Driven”?: https://martinfowler.com/articles/201701-event-driven.html

---

## 33. Status Seri

Part ini adalah **Part 9 dari 35**.

Seri belum selesai.

Part berikutnya:

```text
Part 10 — Consistency Pattern and Distributed Invariants
```

Filename berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-10-consistency-and-distributed-invariants.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-08-transaction-saga-compensation.md">⬅️ Part 8 — Transaction Pattern: Local Transaction, Saga, and Compensation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-10-consistency-and-distributed-invariants.md">Part 10 — Consistency Pattern and Distributed Invariants ➡️</a>
</div>

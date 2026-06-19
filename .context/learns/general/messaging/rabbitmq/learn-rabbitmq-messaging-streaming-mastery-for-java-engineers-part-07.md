# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-07.md

# Part 07 — Publisher Reliability: Confirms, Returns, Mandatory, Idempotent Publish

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami RabbitMQ sampai level desain produksi, bukan hanya bisa publish/consume.  
> Fokus part ini: membuat sisi publisher tidak “berharap pesan terkirim”, tetapi punya model eksplisit untuk mengetahui apakah pesan diterima broker, apakah pesan berhasil dirutekan, apa yang harus dilakukan saat gagal, dan bagaimana mencegah duplicate side effect saat retry.

---

## 1. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

- Part 00: orientasi RabbitMQ modern.
- Part 01: messaging semantics spesifik RabbitMQ.
- Part 02: AMQP 0-9-1 sebagai bahasa internal RabbitMQ.
- Part 03: exchange routing mastery.
- Part 04: queue semantics classic, quorum, stream.
- Part 05: local lab.
- Part 06: Java Client fundamentals tanpa Spring.

Sekarang kita masuk ke salah satu area paling sering menyebabkan data loss di sistem produksi: **publisher reliability**.

Banyak engineer merasa aman karena sudah melakukan ini:

```java
channel.basicPublish(exchange, routingKey, props, body);
```

Padahal secara reliability, kode itu hanya berarti:

> Aplikasi mencoba menulis bytes ke channel AMQP.

Itu belum otomatis berarti:

- broker sudah menerima pesan;
- exchange valid;
- pesan berhasil dirutekan ke minimal satu queue;
- pesan sudah persisted sesuai durability expectation;
- pesan aman jika broker crash;
- producer tahu apakah harus retry;
- retry tidak menciptakan duplicate business action.

Part ini membahas celah-celah itu.

---

## 2. Problem Utama: “Published” Bukan Berarti “Safe”

Di aplikasi bisnis, publisher sering berada setelah sebuah perubahan state penting:

```text
User submits evidence
    -> application saves evidence metadata to database
    -> application publishes EvidenceSubmitted message
    -> downstream services evaluate, notify, audit, escalate
```

Jika publish gagal diam-diam, database sudah berubah tetapi sistem lain tidak tahu.

Contoh dampak:

- case lifecycle macet;
- regulator tidak mendapat audit signal;
- notification tidak terkirim;
- SLA escalation tidak berjalan;
- reporting tidak sinkron;
- workflow terlihat inconsistent;
- incident sulit direkonstruksi.

Masalahnya: kegagalan publish sering bukan hard failure yang jelas.

Ia bisa berupa:

- connection putus setelah client mengirim sebagian data;
- broker menerima pesan tetapi response confirm hilang di network;
- exchange ada, tetapi routing key tidak match binding mana pun;
- queue ada, tetapi disk alarm membuat broker memblokir publisher;
- channel ditutup karena deklarasi topology invalid;
- publisher retry setelah timeout, padahal publish pertama sebenarnya sukses;
- broker menerima pesan tetapi producer crash sebelum menandai status lokal.

Jadi reliability publisher harus menjawab dua pertanyaan berbeda:

1. **Apakah broker menerima/menangani publish ini?**
2. **Apakah pesan ini berhasil dirutekan ke tempat yang diharapkan?**

RabbitMQ memberikan dua mekanisme utama:

- **publisher confirms** untuk mengetahui broker sudah menangani publish;
- **mandatory publish + returned messages** untuk mendeteksi pesan tidak bisa dirutekan.

Keduanya bukan pengganti idempotency dan bukan pengganti outbox pattern.

---

## 3. Mental Model Publisher Reliability

Bayangkan publish sebagai transaksi melewati beberapa boundary:

```text
Application memory
    |
    | 1. create message
    v
Java RabbitMQ client
    |
    | 2. write AMQP frame to TCP connection
    v
RabbitMQ node
    |
    | 3. exchange lookup
    v
Exchange routing
    |
    | 4. binding match
    v
Queue(s) / Stream
    |
    | 5. enqueue / persist / replicate depending on queue type and message properties
    v
Publisher confirm back to client
```

Setiap boundary punya failure mode.

| Boundary | Pertanyaan | Failure Mode |
|---|---|---|
| Application → client | Apakah message dibuat benar? | serialization error, missing metadata, invalid routing key |
| Client → TCP | Apakah bytes terkirim? | connection closed, timeout, flow control |
| TCP → broker | Apakah broker menerima frame? | broker down, network partition |
| Broker → exchange | Apakah exchange valid? | exchange tidak ada, channel exception |
| Exchange → queue | Apakah routing berhasil? | unroutable message |
| Queue storage | Apakah pesan aman? | transient message, non-durable queue, disk issue |
| Broker → publisher | Apakah confirm diterima? | confirm lost, publisher crash |

Publisher reliability bukan satu fitur. Ia adalah kombinasi:

```text
correct topology
+ durable entities
+ persistent messages
+ publisher confirms
+ mandatory publish / return handling
+ local publish state tracking
+ retry discipline
+ idempotent message identity
+ outbox if DB state is involved
```

---

## 4. Fire-and-Forget Publishing

Fire-and-forget adalah mode publish tanpa confirm dan tanpa mandatory return handling.

```java
channel.basicPublish(exchange, routingKey, props, body);
```

Dalam mode ini, aplikasi biasanya berasumsi bahwa tidak ada exception berarti sukses.

Asumsi ini lemah.

Kenapa?

Karena `basicPublish` bisa berhasil secara lokal hanya karena client berhasil menulis ke socket buffer. Ia belum tentu tahu apakah broker sudah benar-benar memproses pesan.

Fire-and-forget mungkin dapat diterima untuk:

- telemetry low-value;
- best-effort metrics;
- event debug sementara;
- local experimentation;
- data yang boleh hilang dan bisa diregenerasi.

Fire-and-forget tidak cocok untuk:

- workflow command;
- audit event;
- notification wajib;
- regulatory state transition;
- billing;
- case escalation;
- assignment;
- data synchronization yang tidak punya reconciliation path.

Rule praktis:

> Jika hilangnya satu pesan membuat sistem tidak bisa dijelaskan secara defensible, jangan pakai fire-and-forget.

---

## 5. Publisher Confirms

### 5.1 Apa Itu Publisher Confirm?

Publisher confirm adalah mekanisme RabbitMQ di mana broker mengirim acknowledgement balik ke publisher untuk pesan yang diterbitkan pada channel confirm mode.

Ini mirip secara bentuk dengan consumer acknowledgement, tetapi arahnya berbeda:

```text
consumer ack:
    consumer -> broker
    "message ini sudah saya proses, boleh dihapus / dianggap selesai"

publisher confirm:
    broker -> publisher
    "publish ini sudah saya tangani di sisi broker"
```

Untuk mengaktifkan confirm mode:

```java
channel.confirmSelect();
```

Setelah itu, RabbitMQ akan mengirim `basic.ack` atau `basic.nack` untuk publish di channel tersebut.

Dokumentasi resmi RabbitMQ menyebut publisher confirms sebagai mekanisme acknowledgement publisher, sedangkan reliability guide menjelaskan bahwa acknowledgement dipakai dua arah: consumer memberi tahu broker bahwa delivery sudah diproses, dan broker memberi tahu publisher bahwa publish sudah ditangani. Lihat dokumentasi resmi RabbitMQ tentang confirms dan reliability.  
Reference: https://www.rabbitmq.com/docs/confirms dan https://www.rabbitmq.com/docs/reliability

### 5.2 Apa yang Dikonfirmasi?

Publisher confirm mengonfirmasi bahwa broker sudah menerima dan menangani pesan sesuai semantics broker.

Namun penting: confirm bukan selalu berarti downstream consumer sudah memproses pesan.

Confirm menjawab:

```text
Apakah pesan sudah aman di boundary broker?
```

Bukan:

```text
Apakah consumer sudah sukses memproses pesan?
```

Untuk mengetahui consumer processing success, kamu butuh mekanisme lain:

- consumer ack internal;
- result event;
- state transition;
- workflow engine;
- monitoring;
- business-level acknowledgement.

### 5.3 Confirm dan Durability

Confirm harus dipahami bersama tiga hal:

1. durable exchange;
2. durable queue;
3. persistent message.

Jika exchange dan queue durable tetapi pesan tidak persistent, broker restart bisa menghilangkan pesan.

Jika pesan persistent tetapi queue tidak durable, queue hilang saat restart.

Jika queue durable dan message persistent, broker punya instruksi untuk menyimpan pesan secara durable sesuai queue semantics.

Untuk quorum queue, durability juga terkait replication quorum.

Pola minimal untuk command penting:

```java
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
        .deliveryMode(2) // persistent
        .contentType("application/json")
        .messageId(messageId)
        .correlationId(correlationId)
        .type("case.evidence.submitted.v1")
        .build();
```

`deliveryMode(2)` berarti persistent message dalam AMQP 0-9-1 convention.

Tetapi persistent message tanpa confirm tetap tidak cukup, karena publisher tidak tahu apakah broker benar-benar menerimanya.

### 5.4 Confirm Sequence Number

Pada channel confirm mode, RabbitMQ Java client menyediakan publish sequence number:

```java
long seqNo = channel.getNextPublishSeqNo();
channel.basicPublish(exchange, routingKey, mandatory, props, body);
```

Sequence number ini digunakan untuk menghubungkan publish lokal dengan confirm yang datang kemudian.

Mental model:

```text
seqNo 101 -> message A
seqNo 102 -> message B
seqNo 103 -> message C

broker later sends ack for 101
broker later sends ack for 102 with multiple=true maybe confirms up to 102
broker later sends nack for 103
```

`multiple=true` berarti ack/nack berlaku untuk semua sequence number sampai nilai tersebut.

Ini penting untuk asynchronous confirm.

---

## 6. Tiga Strategi Confirm

RabbitMQ Java tutorial resmi biasanya memperkenalkan tiga strategi:

1. publish individual lalu tunggu confirm;
2. publish batch lalu tunggu confirm;
3. asynchronous confirm listener.

Kita bahas sebagai design trade-off, bukan sekadar contoh kode.

---

## 7. Strategy 1: Individual Synchronous Confirm

### 7.1 Bentuk Dasar

```java
channel.confirmSelect();

channel.basicPublish(exchange, routingKey, props, body);
boolean confirmed = channel.waitForConfirms(5_000);

if (!confirmed) {
    throw new IllegalStateException("Message was not confirmed by broker");
}
```

### 7.2 Karakteristik

| Aspek | Nilai |
|---|---|
| Simplicity | sangat mudah |
| Throughput | buruk |
| Latency | tinggi per message |
| Failure handling | sederhana |
| Cocok untuk | low-throughput critical publish |

### 7.3 Kapan Cocok?

Cocok untuk:

- admin action jarang;
- manual workflow transition;
- low-volume command;
- prototype reliability;
- test code.

Tidak cocok untuk:

- high-throughput event publication;
- bursty producer;
- batch jobs;
- telemetry;
- outbox relay besar.

### 7.4 Masalah Tersembunyi

Jika kamu melakukan publish dalam HTTP request path:

```text
HTTP request
    -> DB transaction
    -> publish
    -> waitForConfirms
    -> return response
```

maka latency user ikut bergantung pada broker confirm latency.

Kadang ini benar. Kadang ini buruk.

Pertanyaannya:

> Apakah caller perlu tahu bahwa message sudah diterima broker sebelum request dianggap sukses?

Untuk command internal yang harus memicu proses downstream, mungkin ya.

Untuk event notification setelah state commit, lebih baik memakai outbox relay agar user request tidak langsung bergantung pada broker availability.

---

## 8. Strategy 2: Batch Synchronous Confirm

### 8.1 Bentuk Dasar

```java
channel.confirmSelect();

int batchSize = 100;
int outstanding = 0;

for (Message message : messages) {
    channel.basicPublish(
            message.exchange(),
            message.routingKey(),
            message.properties(),
            message.body()
    );
    outstanding++;

    if (outstanding == batchSize) {
        channel.waitForConfirmsOrDie(5_000);
        outstanding = 0;
    }
}

if (outstanding > 0) {
    channel.waitForConfirmsOrDie(5_000);
}
```

### 8.2 Karakteristik

| Aspek | Nilai |
|---|---|
| Simplicity | masih relatif mudah |
| Throughput | jauh lebih baik dari individual confirm |
| Failure attribution | lebih kasar |
| Cocok untuk | outbox relay, batch publish, controlled pipeline |

### 8.3 Trade-off Besar

Jika batch gagal, kamu tidak selalu tahu message mana yang gagal.

Biasanya kamu harus memperlakukan seluruh batch sebagai uncertain dan melakukan retry.

Itu berarti consumer harus idempotent.

Dalam sistem produksi, ini wajar.

Jangan mengejar “tidak pernah duplicate” di publisher layer. Kejar:

```text
No confirmed loss
+ bounded retry
+ duplicate-safe processing
+ observable publish state
```

### 8.4 Batch Confirm dalam Outbox Relay

Outbox relay cocok dengan batch confirm:

```text
SELECT pending outbox rows LIMIT 100
publish all rows
wait for confirms
mark rows as PUBLISHED
```

Tetapi ada failure window:

```text
publish all rows
broker confirms
process crashes before marking DB rows as PUBLISHED
```

Setelah restart, rows masih pending dan akan dipublish lagi.

Ini tidak bisa diselesaikan sempurna tanpa distributed transaction.

Solusinya:

- stable message id;
- idempotent consumer;
- dedup table/inbox;
- outbox relay retry;
- event semantic yang tahan duplicate.

---

## 9. Strategy 3: Asynchronous Publisher Confirms

### 9.1 Kenapa Perlu Async?

High-throughput publisher tidak bisa menunggu confirm satu per satu.

Async confirm memungkinkan publisher terus mengirim pesan dan menerima ack/nack melalui callback.

### 9.2 Bentuk Dasar

```java
channel.confirmSelect();

ConcurrentNavigableMap<Long, PendingPublish> outstandingConfirms = new ConcurrentSkipListMap<>();

ConfirmCallback ackCallback = (sequenceNumber, multiple) -> {
    if (multiple) {
        ConcurrentNavigableMap<Long, PendingPublish> confirmed =
                outstandingConfirms.headMap(sequenceNumber, true);
        confirmed.clear();
    } else {
        outstandingConfirms.remove(sequenceNumber);
    }
};

ConfirmCallback nackCallback = (sequenceNumber, multiple) -> {
    if (multiple) {
        ConcurrentNavigableMap<Long, PendingPublish> failed =
                outstandingConfirms.headMap(sequenceNumber, true);
        failed.values().forEach(PendingPublish::markForRetry);
        failed.clear();
    } else {
        PendingPublish failed = outstandingConfirms.remove(sequenceNumber);
        if (failed != null) {
            failed.markForRetry();
        }
    }
};

channel.addConfirmListener(ackCallback, nackCallback);
```

Publishing:

```java
long seqNo = channel.getNextPublishSeqNo();
outstandingConfirms.put(seqNo, pendingPublish);
channel.basicPublish(exchange, routingKey, true, props, body);
```

### 9.3 Race Condition yang Harus Dipahami

Urutan harus benar:

```java
long seqNo = channel.getNextPublishSeqNo();
outstandingConfirms.put(seqNo, pendingPublish);
channel.basicPublish(...);
```

Kenapa mapping dimasukkan sebelum publish?

Karena confirm bisa datang sangat cepat setelah publish. Jika publish dilakukan dulu lalu mapping dimasukkan belakangan, callback bisa mencoba menghapus sequence number yang belum ada di map.

### 9.4 Karakteristik

| Aspek | Nilai |
|---|---|
| Throughput | terbaik |
| Complexity | tinggi |
| Failure attribution | granular |
| Memory pressure | perlu dikontrol |
| Cocok untuk | production publisher, outbox relay, event publisher |

### 9.5 Outstanding Confirm Window

Async confirm butuh batas.

Jika publisher terus publish tanpa batas, `outstandingConfirms` bisa tumbuh besar saat broker lambat.

Buat limit:

```text
max in-flight publishes per channel
```

Contoh:

```java
Semaphore inFlight = new Semaphore(10_000);

inFlight.acquire();
long seqNo = channel.getNextPublishSeqNo();
outstandingConfirms.put(seqNo, pending);
channel.basicPublish(exchange, routingKey, true, props, body);

// in ack/nack callback:
inFlight.release(numberOfConfirmedMessages);
```

Ini adalah backpressure di sisi publisher.

---

## 10. Nack: Apa Artinya dan Apa yang Harus Dilakukan?

Publisher nack berarti broker tidak bisa memproses publish tersebut sebagai confirmed success.

Nack jarang terjadi dalam kondisi normal, tetapi harus tetap didesain.

Respon publisher:

1. tandai message sebagai failed/unknown;
2. retry dengan batas;
3. jangan retry tight loop;
4. gunakan exponential backoff;
5. jangan membuat message id baru untuk logical message yang sama;
6. catat failure reason jika tersedia;
7. expose metric.

Pseudocode:

```java
void handleNack(PendingPublish pending) {
    pending.incrementAttempt();

    if (pending.attempts() <= MAX_ATTEMPTS) {
        retryScheduler.schedule(pending, backoffFor(pending.attempts()));
    } else {
        publishFailureStore.markFailed(
                pending.messageId(),
                "Publisher nack after max attempts"
        );
        alerting.raise("rabbitmq.publisher.nack.exhausted", pending.messageId());
    }
}
```

Yang tidak boleh:

```java
while (true) {
    publishAgain();
}
```

Itu bisa membuat retry storm.

---

## 11. Returned Messages dan Mandatory Publish

### 11.1 Masalah Unroutable Message

Publisher confirm menjawab:

```text
broker menerima/menangani publish
```

Tetapi ada masalah lain:

```text
exchange valid, tetapi routing key tidak match binding mana pun
```

Dalam kasus ini, broker bisa menerima publish tetapi pesan tidak masuk ke queue mana pun.

Jika publisher tidak meminta return, pesan dapat hilang dari perspektif aplikasi.

### 11.2 Mandatory Flag

AMQP `mandatory` flag meminta broker mengembalikan pesan jika tidak dapat dirutekan ke queue.

```java
channel.basicPublish(exchange, routingKey, true, props, body);
```

Argumen `true` di atas adalah `mandatory`.

### 11.3 Return Listener

```java
channel.addReturnListener(returned -> {
    String exchange = returned.getExchange();
    String routingKey = returned.getRoutingKey();
    int replyCode = returned.getReplyCode();
    String replyText = returned.getReplyText();
    AMQP.BasicProperties properties = returned.getProperties();
    byte[] body = returned.getBody();

    // Persist, alert, or route to publisher-side failure handling
});
```

Returned message berarti:

```text
The broker could not route this message to any queue.
```

Biasanya ini adalah topology/configuration bug, bukan transient business error.

Contoh penyebab:

- routing key typo;
- binding belum dibuat;
- wrong vhost;
- exchange berubah;
- deployment order salah;
- environment-specific topology tidak sinkron;
- tenant routing key salah;
- feature flag mengirim message type baru tapi consumer topology belum siap.

### 11.4 Confirm + Return Ordering

Dalam praktik desain, jangan anggap confirm saja cukup untuk routedness.

Gunakan:

```text
mandatory=true
+ return listener
+ publisher confirms
```

Return handling harus dianggap sebagai failure path sendiri.

Design rule:

> Confirm tells you the broker handled the publish. Return tells you routing failed.

### 11.5 Apa yang Dilakukan Saat Message Returned?

Pilihan:

1. fail fast jika dalam synchronous use case;
2. simpan ke publisher failure table;
3. alert operational team;
4. hentikan outbox relay untuk message type tersebut;
5. jangan infinite retry sampai topology diperbaiki;
6. sertakan exchange, routing key, message type, message id, correlation id.

Contoh failure record:

```json
{
  "message_id": "evt-2026-06-19-001",
  "exchange": "case.events.topic",
  "routing_key": "case.evidence.submitted.v1",
  "reply_code": 312,
  "reply_text": "NO_ROUTE",
  "status": "UNROUTABLE",
  "created_at": "2026-06-19T10:15:30Z"
}
```

---

## 12. Exchange Not Found vs Unroutable

Dua failure ini berbeda.

### 12.1 Exchange Tidak Ada

Jika publish ke exchange yang tidak ada, channel biasanya ditutup oleh broker karena protocol exception.

Ini bukan returned message biasa.

Efeknya:

- channel menjadi invalid;
- publisher harus membuka channel baru;
- topology/deployment salah;
- alert harus keras.

### 12.2 Exchange Ada Tetapi Tidak Ada Binding Cocok

Jika exchange ada tetapi tidak ada queue match:

- dengan `mandatory=false`: pesan dapat dibuang;
- dengan `mandatory=true`: pesan dikembalikan ke publisher.

Design implication:

> Untuk publish penting, exchange existence dan routedness harus divalidasi berbeda.

---

## 13. Durable Publishing: Empat Syarat Minimal

Untuk pesan penting, minimal:

1. exchange durable;
2. queue durable;
3. message persistent;
4. publisher confirm enabled.

Untuk replicated durability:

5. gunakan quorum queue atau stream sesuai use case;
6. pastikan policy/topology benar;
7. pahami write confirmation semantics queue type.

Contoh deklarasi queue durable:

```java
channel.exchangeDeclare("case.commands.direct", BuiltinExchangeType.DIRECT, true);

channel.queueDeclare(
        "case-evidence-validator.q",
        true,   // durable
        false,  // exclusive
        false,  // autoDelete
        Map.of("x-queue-type", "quorum")
);

channel.queueBind(
        "case-evidence-validator.q",
        "case.commands.direct",
        "case.evidence.validate"
);
```

Persistent message:

```java
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
        .deliveryMode(2)
        .messageId(messageId)
        .correlationId(correlationId)
        .contentType("application/json")
        .type("case.evidence.validate.command.v1")
        .build();
```

---

## 14. The Publisher Reliability Ladder

Gunakan ladder ini untuk menilai maturity publisher.

### Level 0 — Fire and Forget

```text
basicPublish only
```

Risiko:

- silent loss;
- no routing detection;
- no retry discipline.

### Level 1 — Persistent Message + Durable Topology

```text
durable exchange
+ durable queue
+ persistent message
```

Masih kurang:

- publisher tidak tahu apakah broker menerima.

### Level 2 — Synchronous Publisher Confirm

```text
confirmSelect
+ waitForConfirms
```

Lebih aman, tapi throughput rendah.

### Level 3 — Mandatory Publish + Return Handling

```text
mandatory=true
+ return listener
+ confirms
```

Sekarang publisher tahu broker-side acceptance dan routing failure.

### Level 4 — Async Confirms + In-flight Bound

```text
confirm listener
+ sequence tracking
+ bounded outstanding publishes
```

Cocok untuk production throughput.

### Level 5 — Outbox + Idempotent Message Identity

```text
business DB transaction
+ outbox row
+ async relay
+ stable message id
+ confirms
+ consumer idempotency
```

Ini level yang biasanya dibutuhkan untuk business-critical systems.

### Level 6 — Observable and Operable Publisher

```text
metrics
+ alerting
+ failure table
+ replay tool
+ runbook
```

Ini level production ownership.

---

## 15. Idempotent Publish: Apa yang Bisa dan Tidak Bisa Dijamin

Istilah “idempotent publish” sering membingungkan.

Dalam RabbitMQ queue biasa, broker tidak otomatis deduplicate arbitrary AMQP messages seperti database unique constraint.

Jadi yang biasanya dimaksud adalah:

```text
Logical message identity remains stable across retries,
and downstream consumers can detect duplicates.
```

Contoh:

```text
message_id = evidence-submitted:{caseId}:{evidenceId}:{version}
```

Jika publisher retry, message id tetap sama.

Consumer menyimpan message id yang sudah diproses:

```sql
CREATE TABLE processed_message (
    consumer_name VARCHAR(200) NOT NULL,
    message_id VARCHAR(200) NOT NULL,
    processed_at TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_name, message_id)
);
```

Consumer processing:

```text
BEGIN
  INSERT INTO processed_message(consumer_name, message_id, processed_at)
  VALUES (?, ?, now())
  -- if duplicate key, skip

  perform business side effect
COMMIT
```

Jadi duplicate publish tidak menyebabkan duplicate business effect.

---

## 16. Retry Publish Tanpa Idempotency Itu Berbahaya

Misalnya publisher timeout menunggu confirm.

Kemungkinan sebenarnya:

| Kemungkinan | Apa yang Terjadi |
|---|---|
| Broker tidak menerima pesan | retry dibutuhkan |
| Broker menerima dan menyimpan pesan, confirm hilang | retry menciptakan duplicate |
| Broker menerima tetapi publisher crash sebelum mencatat sukses | restart akan retry |
| Broker menerima tetapi routing gagal dan return tidak diproses | perlu failure handling |

Publisher tidak selalu bisa membedakan semua kasus.

Maka retry publish harus diasumsikan dapat menghasilkan duplicate.

Rule:

> Any reliable publisher must assume that retry can duplicate a successfully accepted message.

Karena itu:

- jangan gunakan random UUID baru setiap retry untuk logical event yang sama;
- gunakan deterministic/stable message id;
- consumer harus idempotent;
- outbox row id dapat menjadi message id;
- business aggregate version dapat membantu dedup semantic.

---

## 17. Message ID Strategy

### 17.1 Random ID

```text
UUID.randomUUID()
```

Cocok untuk:

- message benar-benar baru;
- outbox row dibuat sekali lalu ID disimpan.

Tidak cocok jika:

- UUID dibuat ulang setiap retry.

### 17.2 Deterministic ID

```text
case-evidence-submitted:{caseId}:{evidenceId}:{eventVersion}
```

Cocok untuk:

- domain event yang punya natural uniqueness;
- dedup berbasis business event.

Risiko:

- salah memilih key bisa menganggap event berbeda sebagai duplicate.

### 17.3 Outbox ID

```text
outbox.id = ULID/UUID
message_id = outbox.id
```

Cocok untuk:

- transactional outbox;
- simple operational replay;
- tracking publish attempts.

Biasanya paling praktis.

### 17.4 Recommended Envelope

```json
{
  "message_id": "01JZ6P6J5Y4SP9ZMEZQ8KJ7ZHD",
  "message_type": "case.evidence.submitted.v1",
  "schema_version": 1,
  "producer": "case-service",
  "correlation_id": "corr-abc",
  "causation_id": "cmd-xyz",
  "occurred_at": "2026-06-19T10:15:30Z",
  "payload": {
    "case_id": "CASE-123",
    "evidence_id": "EVD-456"
  }
}
```

AMQP properties juga membawa metadata penting:

```java
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
        .messageId(envelope.messageId())
        .correlationId(envelope.correlationId())
        .type(envelope.messageType())
        .contentType("application/json")
        .deliveryMode(2)
        .timestamp(Date.from(envelope.occurredAt()))
        .headers(Map.of(
                "schema_version", envelope.schemaVersion(),
                "producer", envelope.producer(),
                "causation_id", envelope.causationId()
        ))
        .build();
```

---

## 18. Transactional Outbox Pattern

### 18.1 Problem yang Diselesaikan

Tanpa outbox:

```text
BEGIN DB TX
  update business table
COMMIT
publish message
```

Jika publish gagal setelah commit, state DB berubah tetapi message hilang.

Atau:

```text
publish message
BEGIN DB TX
  update business table
COMMIT
```

Jika DB commit gagal, message sudah terkirim untuk state yang tidak pernah terjadi.

Outbox menyelesaikan atomicity antara business state dan intent to publish dalam database yang sama.

### 18.2 Flow Outbox

```text
Application request
    |
    v
BEGIN DB TRANSACTION
    update business state
    insert outbox row
COMMIT
    |
    v
Outbox relay reads pending rows
    publish to RabbitMQ with confirms
    mark outbox row published
```

### 18.3 Outbox Table

```sql
CREATE TABLE outbox_message (
    id VARCHAR(64) PRIMARY KEY,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    message_type VARCHAR(200) NOT NULL,
    exchange_name VARCHAR(200) NOT NULL,
    routing_key VARCHAR(200) NOT NULL,
    payload_json TEXT NOT NULL,
    headers_json TEXT NOT NULL,
    status VARCHAR(30) NOT NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMP NULL,
    published_at TIMESTAMP NULL,
    last_error TEXT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_outbox_pending
ON outbox_message(status, next_attempt_at, created_at);
```

Statuses:

```text
PENDING
PUBLISHING
PUBLISHED
FAILED
UNROUTABLE
```

### 18.4 Relay Algorithm

```text
loop:
  fetch N pending rows with lock/skip locked
  mark as PUBLISHING or claim with lease
  publish with confirms
  if confirmed and not returned:
      mark PUBLISHED
  if returned:
      mark UNROUTABLE
  if nack/timeout:
      increment attempt_count
      schedule retry
  if max attempts exceeded:
      mark FAILED
```

### 18.5 Important Failure Windows

| Window | Scenario | Result | Required Defense |
|---|---|---|---|
| after DB commit before relay sees row | relay down | message delayed | monitor pending age |
| after publish before confirm | crash | unknown | retry with same id |
| after confirm before DB mark published | crash | duplicate on restart | consumer idempotency |
| after returned message before mark failed | crash | retry may return again | failure tracking |
| after mark published but before downstream consume | consumer down | queue stores message | queue monitoring |

Outbox does not eliminate duplicates.

Outbox eliminates **lost intent to publish** after DB commit.

---

## 19. Publisher State Machine

Reliable publisher sebaiknya punya state machine eksplisit.

```text
NEW
  -> SERIALIZED
  -> PUBLISH_ATTEMPTED
  -> CONFIRMED
  -> ROUTED_ASSUMED_OR_NOT_RETURNED
  -> PUBLISHED
```

Failure states:

```text
SERIALIZATION_FAILED
TOPOLOGY_FAILED
UNROUTABLE
NACKED
CONFIRM_TIMEOUT
CONNECTION_FAILED
MAX_RETRY_EXCEEDED
```

Outbox state machine:

```text
PENDING
  -> CLAIMED
  -> PUBLISHING
  -> PUBLISHED
  -> FAILED_RETRYABLE
  -> FAILED_PERMANENT
  -> UNROUTABLE
```

State machine membantu:

- observability;
- support tooling;
- replay;
- audit;
- operational triage;
- avoiding ambiguous “failed” bucket.

---

## 20. Confirm Timeout: Gagal atau Unknown?

Jika `waitForConfirms` timeout, jangan langsung berpikir message pasti gagal.

Timeout berarti:

```text
Publisher tidak menerima confirm dalam batas waktu.
```

Kemungkinan:

- broker lambat;
- network lambat;
- broker sudah menerima tapi confirm belum sampai;
- broker crash;
- connection broken;
- publisher overloaded;
- disk alarm/backpressure.

Status yang lebih akurat:

```text
UNKNOWN_CONFIRM_STATUS
```

Tindakan:

- retry dengan same message id;
- jangan generate logical message baru;
- log sebagai unknown, bukan pasti failed;
- metric khusus confirm timeout;
- cek broker health dan publisher blocked state.

---

## 21. Handling Connection Recovery

RabbitMQ Java client punya automatic recovery, tetapi ada batas penting.

Saat connection sedang recovering, publish dapat ditolak/exception dan client tidak otomatis membuffer semua outgoing messages untuk dipublish ulang. Dokumentasi Java client resmi menekankan bahwa aplikasi bertanggung jawab melacak message yang perlu dipublish ulang setelah recovery.  
Reference: https://www.rabbitmq.com/client-libraries/java-api-guide

Implication:

> Jangan serahkan reliability publisher sepenuhnya ke automatic connection recovery.

Automatic recovery membantu memulihkan:

- connection;
- channel;
- consumer;
- topology tertentu jika recovery topology aktif.

Tetapi aplikasi tetap harus menangani:

- publish in-flight;
- unconfirmed messages;
- retry;
- outbox state;
- idempotency.

---

## 22. A Production-Shaped Publisher Class

Contoh berikut bukan framework final, tetapi memberi bentuk mental model.

```java
import com.rabbitmq.client.AMQP;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.ConfirmCallback;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentNavigableMap;
import java.util.concurrent.ConcurrentSkipListMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeoutException;

public final class ReliableRabbitPublisher implements AutoCloseable {

    private final Channel channel;
    private final ConcurrentNavigableMap<Long, PendingPublish> outstanding = new ConcurrentSkipListMap<>();
    private final Semaphore inFlightLimit;
    private final PublishFailureHandler failureHandler;

    public ReliableRabbitPublisher(
            Channel channel,
            int maxInFlight,
            PublishFailureHandler failureHandler
    ) throws IOException {
        this.channel = channel;
        this.inFlightLimit = new Semaphore(maxInFlight);
        this.failureHandler = failureHandler;

        this.channel.confirmSelect();
        this.channel.addConfirmListener(ackCallback(), nackCallback());
        this.channel.addReturnListener(returned -> {
            String messageId = returned.getProperties().getMessageId();
            failureHandler.onReturned(new ReturnedPublish(
                    messageId,
                    returned.getExchange(),
                    returned.getRoutingKey(),
                    returned.getReplyCode(),
                    returned.getReplyText(),
                    returned.getBody()
            ));
        });
    }

    public void publish(PublishCommand command) throws IOException, InterruptedException {
        inFlightLimit.acquire();

        long seqNo = channel.getNextPublishSeqNo();

        AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
                .messageId(command.messageId())
                .correlationId(command.correlationId())
                .type(command.messageType())
                .contentType("application/json")
                .deliveryMode(2)
                .timestamp(java.util.Date.from(Instant.now()))
                .headers(Map.of(
                        "producer", command.producer(),
                        "schema_version", command.schemaVersion()
                ))
                .build();

        PendingPublish pending = new PendingPublish(
                command.messageId(),
                command.exchange(),
                command.routingKey(),
                command.body(),
                Instant.now()
        );

        outstanding.put(seqNo, pending);

        try {
            channel.basicPublish(
                    command.exchange(),
                    command.routingKey(),
                    true, // mandatory
                    props,
                    command.body()
            );
        } catch (IOException e) {
            outstanding.remove(seqNo);
            inFlightLimit.release();
            failureHandler.onPublishException(pending, e);
            throw e;
        }
    }

    private ConfirmCallback ackCallback() {
        return (sequenceNumber, multiple) -> {
            if (multiple) {
                var confirmed = outstanding.headMap(sequenceNumber, true);
                int count = confirmed.size();
                confirmed.values().forEach(failureHandler::onConfirmed);
                confirmed.clear();
                inFlightLimit.release(count);
            } else {
                PendingPublish pending = outstanding.remove(sequenceNumber);
                if (pending != null) {
                    failureHandler.onConfirmed(pending);
                    inFlightLimit.release();
                }
            }
        };
    }

    private ConfirmCallback nackCallback() {
        return (sequenceNumber, multiple) -> {
            if (multiple) {
                var failed = outstanding.headMap(sequenceNumber, true);
                int count = failed.size();
                failed.values().forEach(failureHandler::onNacked);
                failed.clear();
                inFlightLimit.release(count);
            } else {
                PendingPublish pending = outstanding.remove(sequenceNumber);
                if (pending != null) {
                    failureHandler.onNacked(pending);
                    inFlightLimit.release();
                }
            }
        };
    }

    @Override
    public void close() throws IOException, TimeoutException {
        channel.close();
    }
}
```

Supporting records:

```java
public record PublishCommand(
        String messageId,
        String correlationId,
        String messageType,
        String producer,
        Integer schemaVersion,
        String exchange,
        String routingKey,
        byte[] body
) {}

public record PendingPublish(
        String messageId,
        String exchange,
        String routingKey,
        byte[] body,
        Instant firstAttemptedAt
) {
    public void markForRetry() {
        // integrate with retry scheduler / outbox repository
    }
}

public record ReturnedPublish(
        String messageId,
        String exchange,
        String routingKey,
        int replyCode,
        String replyText,
        byte[] body
) {}

public interface PublishFailureHandler {
    void onConfirmed(PendingPublish pending);
    void onNacked(PendingPublish pending);
    void onReturned(ReturnedPublish returned);
    void onPublishException(PendingPublish pending, Exception exception);
}
```

Important caveat:

- this class is simplified;
- real production code needs channel lifecycle management;
- return and confirm correlation can be subtle;
- outbox integration should be transactional;
- channel should not be concurrently used without discipline.

---

## 23. Correlating Returns and Confirms

A returned message and a confirm are not the same event.

For an unroutable mandatory message, publisher may receive a return and also a confirm.

So if you mark message `PUBLISHED` merely on confirm, you may incorrectly mark an unroutable message as success.

Better state handling:

```text
PUBLISH_ATTEMPTED
  -> RETURNED_UNROUTABLE
  -> FAILED_PERMANENT

PUBLISH_ATTEMPTED
  -> CONFIRMED
  -> PUBLISHED only if no return was observed within expected handling model
```

But how long should publisher wait for return?

In many designs, return listener immediately marks by message id. If confirm and return race, state transition must handle both.

Practical approach for outbox:

- identify message by `message_id`;
- return listener marks outbox row `UNROUTABLE`;
- confirm listener attempts mark `CONFIRMED` only if not already `UNROUTABLE`;
- database update uses conditional state transition.

Example:

```sql
UPDATE outbox_message
SET status = 'PUBLISHED', published_at = now(), updated_at = now()
WHERE id = :id
  AND status IN ('PUBLISHING');
```

Return path:

```sql
UPDATE outbox_message
SET status = 'UNROUTABLE', last_error = :replyText, updated_at = now()
WHERE id = :id
  AND status IN ('PUBLISHING', 'PENDING');
```

This avoids blindly overwriting failure state.

---

## 24. Publisher Confirms with Multiple Channels

Sequence numbers are scoped to a channel.

Therefore this is wrong:

```text
one global map keyed only by sequence number across many channels
```

Because channel A sequence 42 and channel B sequence 42 are different publishes.

Use:

```text
(channelId, seqNo) -> pending publish
```

Or keep one outstanding map per channel.

For high throughput, common design:

```text
PublisherPool
  - PublisherWorker 1: one channel, one confirm map
  - PublisherWorker 2: one channel, one confirm map
  - PublisherWorker N: one channel, one confirm map
```

Do not share one channel across many publishing threads unless you fully understand client thread-safety constraints and ordering implications.

---

## 25. Backpressure on Publisher Side

Reliable publishing needs bounded buffers.

Unbounded publisher design:

```text
HTTP traffic spike
  -> application enqueues publish tasks in memory
  -> broker slows down
  -> confirms slow down
  -> outstanding map grows
  -> heap grows
  -> GC pressure
  -> application crash
```

Better:

- bounded in-flight confirms;
- bounded executor queue;
- outbox table as durable buffer;
- reject/admit requests based on system health;
- expose publisher blocked state;
- rate limit relay.

Backpressure layers:

| Layer | Mechanism |
|---|---|
| HTTP/API | rate limit, admission control |
| Application | bounded executor, semaphore |
| Outbox | DB-backed durable queue |
| Rabbit client | channel confirm window |
| Broker | connection blocking, flow control |
| Queue | max length, TTL, DLQ |

If publish is business-critical, in-memory queue alone is not enough.

---

## 26. Publisher Blocked Connection

RabbitMQ can block connections when broker resources are constrained, such as memory or disk alarms.

Publisher must treat this as a real operating condition.

Java client supports blocked listener:

```java
connection.addBlockedListener(new BlockedListener() {
    @Override
    public void handleBlocked(String reason) {
        log.warn("RabbitMQ connection blocked: {}", reason);
        // pause relay, trip circuit breaker, expose metric
    }

    @Override
    public void handleUnblocked() {
        log.info("RabbitMQ connection unblocked");
        // resume relay carefully
    }
});
```

When blocked:

- do not pile up infinite publish attempts;
- slow down outbox relay;
- keep DB outbox as buffer;
- alert if prolonged;
- inspect broker memory/disk metrics.

---

## 27. Publisher Error Taxonomy

Not all errors should be retried the same way.

| Error | Likely Type | Retry? | Action |
|---|---|---|---|
| Connection reset | transient/unknown | yes | retry with backoff |
| Confirm timeout | unknown | yes | retry same message id |
| Nack | transient or broker issue | yes bounded | retry, alert if repeated |
| Returned NO_ROUTE | configuration/topology | usually no tight retry | mark unroutable, alert |
| Exchange not found | deployment/config | no until fixed | fail channel, alert |
| Serialization error | application bug/data | no | mark failed permanent |
| Message too large | design bug | no | store payload externally |
| Auth failure | configuration/security | no | alert |
| Broker blocked | resource pressure | pause | backpressure |

A reliable publisher should not have one generic catch-all retry loop.

---

## 28. Serialization Boundary

Publisher reliability starts before RabbitMQ.

If serialization fails after business transaction commit but before outbox insert, you have a bug.

Best practice:

- construct event/command payload inside DB transaction;
- validate serializability before commit if possible;
- store serialized payload in outbox;
- relay publishes bytes, not reconstructs business object from current DB state.

Why?

Because reconstructing later can publish a different state.

Bad:

```text
outbox row stores only aggregate id
relay later queries current aggregate
publishes current state, not event-time state
```

Good:

```text
outbox row stores immutable serialized event payload
relay publishes exactly that payload
```

---

## 29. Publisher Reliability for Commands vs Events

### 29.1 Command Publish

Command means:

```text
please do this work
```

Example:

```text
case.evidence.validate
```

Reliability expectation:

- target queue should exist;
- unroutable is serious;
- duplicate command must be safe;
- timeout may cause retry;
- command handler should be idempotent by command id.

Recommended:

```text
direct exchange
+ quorum queue
+ mandatory publish
+ confirms
+ command_id
+ consumer idempotency
```

### 29.2 Event Publish

Event means:

```text
this already happened
```

Example:

```text
case.evidence.submitted.v1
```

Reliability expectation:

- event should not be lost;
- multiple subscribers may exist;
- zero subscribers may or may not be valid;
- audit may require stream copy;
- duplicate event must be safe.

Recommended:

```text
topic exchange
+ mandatory depending on routing policy
+ confirms
+ outbox
+ event_id
+ idempotent consumers
+ optional audit stream
```

Nuance:

For pub/sub events, sometimes no subscriber is acceptable. But for regulated audit events, no route is not acceptable.

Therefore define per message type:

```text
is_no_route_allowed?
```

### 29.3 Notification Publish

Notification means:

```text
someone/something should be informed
```

Reliability depends on business value.

For low-value notification, fire-and-forget may be acceptable.

For legal notice, treat as command/audit-grade.

### 29.4 Job Publish

Job means:

```text
do async work eventually
```

Recommended:

```text
quorum queue
+ persistent message
+ confirms
+ retry/DLQ
+ job id
+ idempotent worker
```

---

## 30. Topology Readiness Before Publishing

A reliable publisher should know whether topology is managed by:

1. application auto-declaration;
2. infrastructure provisioning;
3. CI/CD definitions import;
4. operator policies;
5. separate platform team.

Avoid ambiguous ownership.

### 30.1 Application Declares Topology

Pros:

- service self-contained;
- local dev easy;
- deployment simpler initially.

Cons:

- accidental topology drift;
- permission too broad;
- service can mutate broker topology unexpectedly.

### 30.2 Infrastructure Declares Topology

Pros:

- controlled production changes;
- least privilege;
- reviewable topology.

Cons:

- deployment ordering matters;
- local dev needs definitions;
- message type rollout needs coordination.

### 30.3 Recommended Split

For mature systems:

- production topology defined as code/definitions;
- application has write/read permission, not broad configure permission;
- local/test may auto-declare;
- CI validates topology exists before release.

Publisher must fail loudly if expected exchange is missing.

---

## 31. Observability for Publisher Reliability

Metrics to expose:

```text
rabbitmq_publisher_attempt_total{exchange,routing_key,message_type}
rabbitmq_publisher_confirm_ack_total{exchange,routing_key,message_type}
rabbitmq_publisher_confirm_nack_total{exchange,routing_key,message_type}
rabbitmq_publisher_confirm_timeout_total{exchange,routing_key,message_type}
rabbitmq_publisher_return_total{exchange,routing_key,reply_code,message_type}
rabbitmq_publisher_in_flight{publisher}
rabbitmq_publisher_confirm_latency_seconds{exchange,message_type}
rabbitmq_publisher_blocked{connection}
outbox_pending_total{message_type}
outbox_oldest_pending_age_seconds{message_type}
outbox_failed_total{message_type,reason}
outbox_unroutable_total{message_type}
```

Logs should include:

- message id;
- correlation id;
- causation id;
- exchange;
- routing key;
- message type;
- publish attempt;
- confirm latency;
- error class;
- reply code/text for returned message.

Example log:

```json
{
  "event": "rabbitmq_publish_returned",
  "message_id": "01JZ6P6J5Y4SP9ZMEZQ8KJ7ZHD",
  "correlation_id": "corr-abc",
  "exchange": "case.events.topic",
  "routing_key": "case.evidence.submitted.v1",
  "message_type": "case.evidence.submitted.v1",
  "reply_code": 312,
  "reply_text": "NO_ROUTE"
}
```

Alert candidates:

- any `UNROUTABLE` for critical command;
- confirm timeout spike;
- nack > 0 sustained;
- outbox oldest pending age exceeds SLA;
- publisher blocked for more than threshold;
- outbox failed rows > 0;
- publish latency p99 high.

---

## 32. Large Message Anti-Pattern

Publisher reliability is harder with large messages.

Problems:

- memory pressure;
- network pressure;
- disk pressure;
- queue replication cost;
- redelivery cost;
- DLQ inspection painful;
- confirm latency grows;
- consumers slow.

Better pattern:

```text
store large payload in object storage / database
publish reference + metadata + checksum
```

Example:

```json
{
  "message_id": "01JZ6P6J5Y4SP9ZMEZQ8KJ7ZHD",
  "message_type": "case.evidence.file_uploaded.v1",
  "payload": {
    "case_id": "CASE-123",
    "evidence_id": "EVD-456",
    "blob_uri": "s3://evidence-bucket/CASE-123/EVD-456",
    "sha256": "...",
    "size_bytes": 104857600
  }
}
```

RabbitMQ should carry coordination messages, not become a file transfer system.

---

## 33. Publisher Reliability and Regulatory Defensibility

For regulatory/case-management systems, ask:

- Can we prove that a message was intended to be published?
- Can we prove whether broker confirmed it?
- Can we identify if it was unroutable?
- Can we replay it safely?
- Can we show duplicate handling?
- Can we explain why a workflow did or did not progress?
- Can we reconstruct correlation from user action to downstream event?

Outbox table is not just technical reliability.

It is audit evidence.

Example evidence chain:

```text
case_state_transition row
    transition_id = T-123
    case_id = CASE-123
    from_state = EVIDENCE_PENDING
    to_state = EVIDENCE_SUBMITTED

outbox_message row
    id = O-456
    causation_id = T-123
    message_type = case.evidence.submitted.v1
    status = PUBLISHED
    published_at = ...

RabbitMQ publisher metric/log
    message_id = O-456
    confirm_latency_ms = 12

consumer inbox row
    consumer = risk-evaluator
    message_id = O-456
    processed_at = ...
```

This gives a defensible trace.

---

## 34. End-to-End Example: Evidence Submitted Event

### 34.1 Business Transaction

```java
@Transactional
public void submitEvidence(SubmitEvidenceCommand command) {
    Evidence evidence = evidenceRepository.save(command.toEvidence());

    CaseRecord caseRecord = caseRepository.findById(command.caseId())
            .orElseThrow();
    caseRecord.markEvidenceSubmitted(evidence.id());

    EvidenceSubmittedEvent event = new EvidenceSubmittedEvent(
            outboxIdGenerator.nextId(),
            command.correlationId(),
            command.commandId(),
            command.caseId(),
            evidence.id(),
            Instant.now()
    );

    outboxRepository.insert(OutboxMessage.fromEvent(
            event.messageId(),
            "case.events.topic",
            "case.evidence.submitted.v1",
            "case.evidence.submitted.v1",
            serialize(event),
            event.headers()
    ));
}
```

### 34.2 Relay

```java
public void relayBatch() {
    List<OutboxMessage> batch = outboxRepository.claimPending(100);

    for (OutboxMessage row : batch) {
        try {
            publisher.publish(new PublishCommand(
                    row.id(),
                    row.correlationId(),
                    row.messageType(),
                    "case-service",
                    row.schemaVersion(),
                    row.exchangeName(),
                    row.routingKey(),
                    row.payloadJson().getBytes(StandardCharsets.UTF_8)
            ));
        } catch (Exception e) {
            outboxRepository.markRetryableFailure(row.id(), e.getMessage());
        }
    }
}
```

### 34.3 Confirm Handler

```java
public void onConfirmed(PendingPublish pending) {
    outboxRepository.markPublishedIfPublishing(pending.messageId());
}
```

### 34.4 Return Handler

```java
public void onReturned(ReturnedPublish returned) {
    outboxRepository.markUnroutable(
            returned.messageId(),
            returned.exchange(),
            returned.routingKey(),
            returned.replyCode(),
            returned.replyText()
    );

    alerting.raiseCritical(
            "RabbitMQ message unroutable",
            Map.of(
                    "message_id", returned.messageId(),
                    "exchange", returned.exchange(),
                    "routing_key", returned.routingKey(),
                    "reply_text", returned.replyText()
            )
    );
}
```

### 34.5 Consumer Idempotency

```java
@Transactional
public void handle(EvidenceSubmittedEvent event) {
    boolean firstTime = inboxRepository.tryInsert(
            "risk-evaluator",
            event.messageId()
    );

    if (!firstTime) {
        return;
    }

    riskEvaluationRepository.createEvaluationRequest(
            event.caseId(),
            event.evidenceId(),
            event.messageId()
    );
}
```

---

## 35. Common Anti-Patterns

### 35.1 “No Exception Means Published”

Wrong.

No exception often means only that the client did not immediately detect failure.

Use confirms.

### 35.2 Persistent Message Without Confirm

Better than transient, but publisher still does not know whether broker received it.

### 35.3 Confirm Without Mandatory

Broker may confirm publish even when no queue received the message, depending on routing behavior and mandatory usage.

Use mandatory for messages that must route.

### 35.4 Mandatory Without Return Listener

Setting mandatory but ignoring returns defeats the purpose.

### 35.5 Retry with New Message ID

This destroys deduplication.

Retries for the same logical message must preserve identity.

### 35.6 Infinite Retry on NO_ROUTE

NO_ROUTE is usually topology/configuration failure.

Retrying every millisecond will not create a binding.

### 35.7 Publishing Inside DB Transaction and Waiting on Broker

Sometimes acceptable, but often couples DB locks to broker latency.

Prefer outbox for critical event publication after DB state change.

### 35.8 In-Memory Buffer as “Outbox”

If process crashes, buffer disappears.

Use durable outbox when business state matters.

### 35.9 One Shared Channel Across Many Threads

This causes subtle ordering, confirm, and concurrency problems.

Use disciplined channel ownership.

### 35.10 Marking Outbox Published Before Confirm

This creates false success.

Mark published after broker confirm, and handle returned messages carefully.

---

## 36. Design Checklist

For every publisher, answer these questions.

### Message Importance

- Can this message be lost?
- Can it be duplicated?
- Can it be delayed?
- What is the business impact of each?
- Is no route acceptable?

### Topology

- What exchange is used?
- Who owns the exchange?
- What routing key is used?
- Which queues are expected to bind?
- Is topology declared by app or infrastructure?
- Is exchange missing a deployment error?

### Durability

- Is exchange durable?
- Is queue durable?
- Is message persistent?
- Is queue type appropriate?
- Is quorum/stream needed?

### Confirm Handling

- Is confirm mode enabled?
- Is confirm synchronous or async?
- Is confirm timeout handled as unknown?
- Are nacks retried with backoff?
- Is in-flight publish bounded?

### Return Handling

- Is mandatory enabled for critical messages?
- Is return listener registered?
- Are returned messages persisted?
- Does return trigger alert?
- Can confirm overwrite returned state incorrectly?

### Idempotency

- Is message id stable across retries?
- Do consumers deduplicate?
- Is dedup transactional with side effect?
- Is duplicate behavior tested?

### Outbox

- Is DB state change tied to outbox insert?
- Is payload immutable in outbox?
- Is relay retry bounded?
- Is pending age monitored?
- Is replay safe?

### Observability

- Are publish attempts counted?
- Are confirms counted?
- Are nacks counted?
- Are returns counted?
- Is confirm latency measured?
- Is outbox backlog monitored?
- Are message id and correlation id logged?

---

## 37. Practical Heuristics

1. Use publisher confirms for any message that matters.
2. Use `mandatory=true` for messages that must route.
3. Treat returned messages as topology failures until proven otherwise.
4. Treat confirm timeout as unknown, not definite failure.
5. Retry publish with the same logical message id.
6. Assume retry can create duplicates.
7. Make consumers idempotent before enabling aggressive publisher retry.
8. Use outbox when message corresponds to committed DB state.
9. Never rely on automatic connection recovery as your only reliability mechanism.
10. Bound in-flight confirms.
11. Do not let publisher memory become an unbounded queue.
12. For business events, store immutable payload in outbox.
13. For large payloads, publish references, not blobs.
14. Separate transient failure from topology failure.
15. Alert on `NO_ROUTE` for critical messages.
16. Measure confirm latency.
17. Monitor oldest pending outbox age.
18. Prefer quorum queues for durable work queues.
19. Prefer stream/audit copy for replayable history.
20. Document whether zero subscribers is acceptable per event type.

---

## 38. Mini Lab

Use the local lab from part 05.

### Lab 1 — Confirm Success

1. Create durable exchange and queue.
2. Bind queue with routing key.
3. Enable confirm mode in Java publisher.
4. Publish persistent message.
5. Wait for confirm.
6. Observe queue depth in Management UI.

Expected:

```text
publish confirmed
message ready in queue
```

### Lab 2 — Unroutable Message

1. Publish to existing exchange.
2. Use routing key that has no binding.
3. Set `mandatory=true`.
4. Register return listener.

Expected:

```text
return listener receives NO_ROUTE
message does not enter queue
```

### Lab 3 — No Mandatory

1. Repeat Lab 2 with `mandatory=false`.

Expected:

```text
no returned message
message disappears from publisher perspective
```

Lesson:

```text
confirm alone is not routedness.
```

### Lab 4 — Exchange Missing

1. Publish to non-existing exchange.
2. Observe channel exception/closure.

Expected:

```text
channel becomes invalid
publisher must recreate channel
```

### Lab 5 — Confirm Timeout Simulation

1. Set very small confirm timeout.
2. Publish under artificial load.
3. Treat timeout as unknown.
4. Retry with same message id.
5. Verify consumer idempotency.

### Lab 6 — Outbox Duplicate

1. Insert outbox row.
2. Publish and receive confirm.
3. Simulate crash before marking `PUBLISHED`.
4. Restart relay.
5. Publish same outbox row again.
6. Verify consumer skips duplicate using inbox table.

---

## 39. Review Questions

1. What does publisher confirm guarantee?
2. What does publisher confirm not guarantee?
3. Why is `mandatory=true` needed?
4. What happens if an exchange does not exist?
5. What happens if exchange exists but no binding matches?
6. Why is confirm timeout an unknown state?
7. Why can retry create duplicates?
8. Why should message id remain stable across retry?
9. What problem does outbox solve?
10. What problem does outbox not solve?
11. Why must consumer idempotency be transactional with side effect?
12. Why is unbounded in-flight confirm map dangerous?
13. Why is publishing large messages to RabbitMQ often a bad idea?
14. How do you distinguish topology failure from transient broker failure?
15. What metrics would you alert on for publisher reliability?

---

## 40. Summary

Publisher reliability in RabbitMQ is not a single switch.

The core model is:

```text
persistent message + durable topology
    protects broker storage intent

publisher confirms
    tells publisher broker handled the publish

mandatory + return listener
    tells publisher routing failed

stable message id
    makes retry traceable and deduplicatable

outbox
    ties DB commit to publish intent

idempotent consumer
    makes duplicate retry safe

observability
    makes failures operable
```

The most dangerous misconception is:

```text
basicPublish returned without exception, therefore message is safe.
```

A production-grade Java publisher should instead be designed around:

- explicit confirm handling;
- explicit return handling;
- bounded in-flight publish;
- durable outbox for business-critical messages;
- stable message identity;
- retry with backoff;
- consumer idempotency;
- metrics and runbooks.

In RabbitMQ systems, reliability is a protocol feature plus an application discipline.

The broker can tell you a lot, but it cannot fix ambiguous business identity, missing idempotency, or a publisher that ignores failure signals.

---

## 41. What Comes Next

Part berikutnya:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-08.md
```

Topik:

```text
Consumer Reliability: Ack, Nack, Reject, Redelivery, Prefetch
```

Kita akan masuk ke sisi consumer:

- kapan ack boleh dikirim;
- kenapa auto-ack berbahaya;
- bagaimana redelivery bekerja;
- bagaimana prefetch mengontrol concurrency;
- bagaimana menghindari infinite retry loop;
- bagaimana consumer idempotency diimplementasikan dengan benar;
- bagaimana membangun handler yang aman terhadap crash, duplicate, dan poison message.

Status seri setelah part ini:

```text
Part 00 selesai
Part 01 selesai
Part 02 selesai
Part 03 selesai
Part 04 selesai
Part 05 selesai
Part 06 selesai
Part 07 selesai
Part 08 belum dimulai
...
Part 34 belum dimulai
```

Seri belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-06.md">⬅️ Part 06 — Java Client Fundamentals tanpa Spring</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-08.md">Part 08 — Consumer Reliability: Ack, Nack, Reject, Redelivery, Prefetch ➡️</a>
</div>

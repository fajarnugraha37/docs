# learn-kafka-event-streaming-mastery-for-java-engineers-part-008.md

# Part 008 — Delivery Semantics: At-Most-Once, At-Least-Once, Effectively-Once, Exactly-Once

> Seri: Kafka, Kafka Connect, ksqlDB, Kafka Streams, dan Event Streaming Mastery untuk Java Software Engineer  
> Posisi: Part 008 dari 034  
> Fokus: memahami guarantee pengiriman, pemrosesan, transaksi, idempotensi, duplicate handling, dan batas nyata dari istilah “exactly-once”.

---

## 0. Executive Summary

Bagian ini membahas salah satu topik Kafka yang paling sering disalahpahami: **delivery semantics**.

Banyak engineer mengatakan:

> “Kafka support exactly-once, jadi data pasti tidak akan double.”

Kalimat itu terlalu kasar dan berbahaya.

Yang lebih akurat:

> Kafka menyediakan mekanisme untuk menghindari duplicate write dari producer melalui **idempotent producer**, dan menyediakan **transactions** agar consume-transform-produce ke Kafka dapat dilakukan secara atomik. Namun guarantee tersebut tidak otomatis membuat seluruh sistem end-to-end exactly-once, terutama jika consumer melakukan side effect ke database, REST API, email, payment gateway, search index, atau sistem eksternal lain.

Jadi, ketika membahas semantics, kita harus selalu bertanya:

1. Semantics di layer mana?
2. Dari komponen mana ke komponen mana?
3. Apakah hanya Kafka-to-Kafka?
4. Apakah ada external side effect?
5. Apakah operasi downstream idempotent?
6. Apakah offset commit atomic dengan side effect?
7. Apa yang terjadi saat crash di titik terburuk?

Part ini akan membangun pemahaman dari dasar sampai desain production.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Membedakan **delivery semantics** dan **processing semantics**.
2. Menjelaskan perbedaan **at-most-once**, **at-least-once**, **effectively-once**, dan **exactly-once**.
3. Menjelaskan mengapa duplicate adalah kondisi normal di distributed systems.
4. Mendesain consumer yang aman terhadap retry, crash, dan rebalance.
5. Memahami cara kerja idempotent producer secara konseptual.
6. Memahami kapan Kafka transactions berguna dan kapan tidak cukup.
7. Menjelaskan peran `enable.idempotence`, `acks=all`, `transactional.id`, dan `isolation.level=read_committed`.
8. Mendesain idempotency key, deduplication table, outbox, dan inbox pattern.
9. Mengevaluasi klaim “exactly-once” secara kritis.
10. Membuat decision matrix untuk memilih semantics yang masuk akal.

---

## 2. Referensi Resmi dan Catatan Akurasi

Materi ini mengikuti model konsep dari dokumentasi resmi Apache Kafka dan Confluent:

- Apache Kafka Documentation: https://kafka.apache.org/documentation/
- Apache Kafka Producer Configs: https://kafka.apache.org/42/configuration/producer-configs/
- Confluent Kafka Delivery Semantics: https://docs.confluent.io/kafka/design/delivery-semantics.html
- Confluent Producer Configs: https://docs.confluent.io/platform/current/installation/configuration/producer-configs.html
- Confluent Transactions Course: https://developer.confluent.io/courses/architecture/transactions/
- KIP-98: Exactly Once Delivery and Transactional Messaging: https://cwiki.apache.org/confluence/display/KAFKA/KIP-98+-+Exactly+Once+Delivery+and+Transactional+Messaging

Catatan penting:

- Dokumentasi Apache Kafka menyebut Kafka menyediakan berbagai guarantee, termasuk kemampuan memproses event exactly-once.
- Dokumentasi Confluent menjelaskan bahwa Kafka secara default memberikan at-least-once delivery; at-most-once dapat dibuat dengan commit offset sebelum processing; transaksi digunakan untuk exactly-once semantics dalam pola tertentu.
- Producer config modern Kafka menyatakan `enable.idempotence` default-nya `true` jika tidak ada konfigurasi konflik; idempotence membutuhkan kondisi seperti `acks=all`, retries aktif, dan batas `max.in.flight.requests.per.connection` yang kompatibel.
- Untuk transactional read, consumer harus menggunakan `isolation.level=read_committed` agar tidak membaca data dari transaksi yang aborted.

---

## 3. Masalah Dasar: Distributed System Tidak Punya “Exactly Once” Gratis

Bayangkan consumer membaca event:

```text
Topic: payment-authorized
Partition: 3
Offset: 9281
Event: PaymentAuthorized(paymentId=PAY-123)
```

Consumer lalu melakukan:

1. Baca event dari Kafka.
2. Insert ke database `settlement`.
3. Commit offset ke Kafka.

Sekarang pertanyaannya:

> Apa yang terjadi jika process crash setelah insert ke database tetapi sebelum commit offset?

Saat consumer restart, Kafka melihat offset terakhir belum committed. Maka event offset `9281` akan dibaca lagi.

Hasilnya:

```text
Database side effect sudah terjadi.
Kafka offset belum committed.
Consumer membaca event yang sama lagi.
```

Jika insert tidak idempotent, settlement bisa double.

Ini bukan bug Kafka. Ini konsekuensi dari distributed system.

Kafka tidak tahu apakah database insert sudah berhasil. Database tidak tahu apakah Kafka offset sudah committed. Tanpa atomic transaction yang mencakup Kafka dan database, ada celah crash yang harus didesain.

---

## 4. Delivery Semantics vs Processing Semantics

Ini perbedaan paling penting.

### 4.1 Delivery Semantics

Delivery semantics menjawab:

> Berapa kali sebuah record dapat dikirim/dibaca oleh consumer?

Contoh:

- Record bisa tidak pernah sampai.
- Record bisa sampai sekali.
- Record bisa sampai lebih dari sekali.

Delivery semantics biasanya berbicara tentang hubungan antara Kafka dan client.

### 4.2 Processing Semantics

Processing semantics menjawab:

> Berapa kali efek bisnis dari record tersebut terjadi?

Contoh:

- Apakah saldo dipotong sekali?
- Apakah email terkirim sekali?
- Apakah case escalation dibuat sekali?
- Apakah fraud alert dihitung sekali?
- Apakah read model ter-update sekali?

Processing semantics jauh lebih sulit karena melibatkan side effect.

### 4.3 Tabel Perbedaan

| Aspek | Delivery Semantics | Processing Semantics |
|---|---|---|
| Fokus | Record dikirim/dibaca | Efek bisnis terjadi |
| Komponen | Kafka, producer, consumer | Kafka + aplikasi + DB/API/external system |
| Contoh pertanyaan | Apakah record bisa dibaca ulang? | Apakah invoice bisa dibuat dua kali? |
| Mudah dijamin Kafka? | Relatif lebih mudah | Tidak selalu |
| Butuh idempotency? | Kadang | Hampir selalu |

### 4.4 Mental Model

Jangan bertanya:

> “Apakah Kafka exactly-once?”

Tanya:

> “Exactly-once dari mana ke mana, untuk operasi apa, dan dengan side effect apa?”

---

## 5. The Four Practical Semantics

Secara praktis, kita akan memakai empat kategori:

```text
1. At-most-once
2. At-least-once
3. Effectively-once
4. Exactly-once
```

Masing-masing punya tempat.

---

## 6. At-Most-Once Semantics

### 6.1 Definisi

**At-most-once** berarti:

> Sebuah event diproses nol atau satu kali, tetapi tidak lebih dari satu kali.

Artinya duplicate dihindari dengan mengorbankan kemungkinan data hilang.

### 6.2 Pola Consumer

Pola umum:

```text
1. Read record from Kafka
2. Commit offset first
3. Process record
```

Jika consumer crash setelah commit offset tetapi sebelum processing selesai:

```text
Kafka menganggap record sudah selesai.
Aplikasi belum memproses record.
Record tidak akan dibaca ulang.
Data hilang dari perspektif bisnis.
```

### 6.3 Diagram Crash

```text
poll offset 100
   |
commit offset 101
   |
CRASH
   |
processing never happened
```

Hasil:

```text
duplicate: no
loss: yes
```

### 6.4 Kapan At-Most-Once Bisa Diterima?

At-most-once cocok untuk workload yang loss-tolerant:

1. Metrik non-kritis.
2. Clickstream sampling.
3. Debug telemetry.
4. Non-critical logging.
5. Sensor stream yang dikirim sangat sering dan boleh kehilangan sedikit data.

### 6.5 Kapan Tidak Boleh?

Jangan pakai at-most-once untuk:

1. Payment.
2. Order lifecycle.
3. Compliance audit.
4. Enforcement case state transition.
5. Fraud detection critical events.
6. Inventory decrement.
7. Customer notification yang legally required.

### 6.6 Java Consumer Contoh At-Most-Once

```java
while (running.get()) {
    ConsumerRecords<String, Event> records = consumer.poll(Duration.ofMillis(500));

    if (!records.isEmpty()) {
        // Commit before processing: at-most-once
        consumer.commitSync();

        for (ConsumerRecord<String, Event> record : records) {
            process(record.value());
        }
    }
}
```

Ini sengaja menunjukkan pola yang berisiko kehilangan data.

### 6.7 Invariant At-Most-Once

```text
Offset may be committed before side effect completes.
Therefore loss is possible.
Duplicate is minimized.
```

---

## 7. At-Least-Once Semantics

### 7.1 Definisi

**At-least-once** berarti:

> Event akan diproses minimal satu kali, tetapi bisa lebih dari satu kali.

Ini adalah mode yang paling umum dan sering menjadi default mental model Kafka consumer.

### 7.2 Pola Consumer

```text
1. Read record from Kafka
2. Process record
3. Commit offset after processing succeeds
```

Jika crash setelah processing tapi sebelum commit:

```text
Processing sudah terjadi.
Offset belum committed.
Event akan dibaca ulang.
Duplicate possible.
```

### 7.3 Diagram Crash

```text
poll offset 100
   |
process side effect
   |
CRASH
   |
offset not committed
   |
re-read offset 100
```

Hasil:

```text
loss: unlikely if retry eventually succeeds
duplicate: yes, possible
```

### 7.4 Java Consumer Contoh At-Least-Once

```java
while (running.get()) {
    ConsumerRecords<String, Event> records = consumer.poll(Duration.ofMillis(500));

    for (ConsumerRecord<String, Event> record : records) {
        process(record.value());
    }

    // Commit only after processing succeeds
    consumer.commitSync();
}
```

Ini lebih aman dari data loss, tetapi duplicate harus diterima sebagai kemungkinan normal.

### 7.5 Kelemahan Batch Commit

Kode di atas commit per batch. Jika batch berisi 500 record dan crash di record ke-499 sebelum commit, 498 record pertama bisa diproses ulang.

Contoh:

```text
batch: offsets 100..599
processed: 100..598
crash before commit
restart from 100
```

Maka duplicate bisa besar.

### 7.6 Commit Per Record

```java
while (running.get()) {
    ConsumerRecords<String, Event> records = consumer.poll(Duration.ofMillis(500));

    for (ConsumerRecord<String, Event> record : records) {
        process(record.value());

        TopicPartition tp = new TopicPartition(record.topic(), record.partition());
        OffsetAndMetadata nextOffset = new OffsetAndMetadata(record.offset() + 1);

        consumer.commitSync(Map.of(tp, nextOffset));
    }
}
```

Ini mengurangi reprocessing window, tetapi menurunkan throughput karena commit lebih sering.

### 7.7 Trade-Off

| Commit Strategy | Duplicate Window | Throughput | Latency | Risk |
|---|---:|---:|---:|---|
| Commit per batch | Lebih besar | Tinggi | Rendah | Duplicate batch |
| Commit per record | Kecil | Rendah | Lebih tinggi | Lebih banyak commit overhead |
| Commit per N records/time | Sedang | Sedang | Sedang | Umum untuk production |

### 7.8 At-Least-Once Adalah Baseline Realistis

Untuk kebanyakan sistem bisnis, asumsi paling sehat adalah:

```text
Kafka consumer can receive the same event more than once.
Your application must tolerate it.
```

---

## 8. Duplicate Adalah Normal, Bukan Edge Case

Distributed systems punya banyak titik crash:

1. Producer mengirim record, broker menulis record, ack hilang di network.
2. Consumer memproses record, process crash sebelum commit offset.
3. Consumer commit offset async, callback gagal/tidak terurut.
4. Rebalance terjadi saat processing belum selesai.
5. Database timeout setelah write sebenarnya berhasil.
6. HTTP API downstream timeout setelah side effect terjadi.
7. Retry framework mengulang operasi tanpa idempotency key.

Masing-masing bisa menghasilkan duplicate dari perspektif aplikasi.

### 8.1 Timeout Bukan Bukti Gagal

Misalnya:

```text
consumer -> payment API: create settlement
payment API creates settlement
network timeout before response
consumer retries
settlement created again
```

Aplikasi consumer melihat timeout, tetapi side effect sudah terjadi.

Ini sangat penting:

> Retry tanpa idempotency adalah duplicate generator.

---

## 9. Idempotency: Senjata Utama Melawan Duplicate

### 9.1 Definisi

Operasi disebut **idempotent** jika dijalankan berkali-kali dengan input yang sama menghasilkan efek akhir yang sama seperti dijalankan sekali.

Contoh idempotent:

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE case_id = 'CASE-123';
```

Jika dijalankan dua kali, status tetap `ESCALATED`.

Contoh tidak idempotent:

```sql
UPDATE accounts
SET balance = balance - 100
WHERE account_id = 'ACC-1';
```

Jika dijalankan dua kali, balance berkurang dua kali.

### 9.2 Idempotency Key

Untuk operasi bisnis, idempotency biasanya butuh key stabil:

```text
eventId
commandId
transactionId
caseTransitionId
paymentInstructionId
settlementId
correlationId + operationType
```

Key ini harus merepresentasikan **intent bisnis unik**, bukan offset Kafka.

### 9.3 Kenapa Offset Bukan Idempotency Key Bisnis?

Offset unik hanya dalam `(topic, partition)`.

Offset berubah jika:

1. Event direplay dari topic lain.
2. Event diproduce ulang ke cluster lain.
3. Data dimigrasikan.
4. Topic di-repartition.
5. Backfill membuat ulang event.

Gunakan offset untuk technical tracing, bukan identity bisnis utama.

### 9.4 Idempotency Table Pattern

```sql
CREATE TABLE processed_events (
    consumer_name      VARCHAR(100) NOT NULL,
    idempotency_key    VARCHAR(200) NOT NULL,
    processed_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    topic              VARCHAR(200),
    partition_no       INT,
    offset_no          BIGINT,
    PRIMARY KEY (consumer_name, idempotency_key)
);
```

Processing:

```java
@Transactional
public void handle(Event event, KafkaMetadata metadata) {
    boolean inserted = processedEventRepository.tryInsert(
        "case-escalation-consumer",
        event.idempotencyKey(),
        metadata.topic(),
        metadata.partition(),
        metadata.offset()
    );

    if (!inserted) {
        return; // duplicate, already processed
    }

    applyBusinessEffect(event);
}
```

### 9.5 Atomicity Requirement

Idempotency marker dan side effect harus berada dalam transaksi yang sama jika memungkinkan.

Benar:

```text
BEGIN DB TRANSACTION
  insert processed_event(idempotency_key)
  update case status
COMMIT
```

Salah:

```text
insert processed_event
COMMIT
update case status
CRASH
```

Jika marker committed tetapi effect gagal, event tidak akan diproses lagi.

### 9.6 Natural Idempotency

Beberapa operasi natural idempotent:

```sql
INSERT INTO case_status_projection(case_id, status, version)
VALUES (?, ?, ?)
ON CONFLICT (case_id)
DO UPDATE SET
    status = EXCLUDED.status,
    version = EXCLUDED.version
WHERE case_status_projection.version < EXCLUDED.version;
```

Dengan version guard, event lama tidak menimpa state baru.

---

## 10. Effectively-Once Semantics

### 10.1 Definisi

**Effectively-once** bukan guarantee native tunggal dari Kafka. Ini adalah desain aplikasi di mana duplicate delivery boleh terjadi, tetapi efek akhirnya tetap satu kali karena idempotency/deduplication.

Dengan kata lain:

```text
Delivery may be at-least-once.
Business effect is effectively once.
```

### 10.2 Contoh

Consumer menerima event yang sama tiga kali:

```text
EventId = EVT-777
Operation = EscalateCase(CASE-123)
```

Processing pertama:

```text
insert processed_events(EVT-777) -> success
update case status -> success
commit offset -> success
```

Processing kedua:

```text
insert processed_events(EVT-777) -> duplicate key
skip business effect
commit offset -> success
```

Efek akhir:

```text
Case escalated once.
```

### 10.3 Ini Biasanya Target Production

Untuk sistem bisnis dengan database, target realistis biasanya:

```text
At-least-once delivery + idempotent processing = effectively-once business effect
```

### 10.4 Kapan Effectively-Once Lebih Baik dari Mengejar Exactly-Once?

Effectively-once sering lebih cocok jika:

1. Consumer menulis ke database transaksional.
2. Consumer memanggil API eksternal.
3. Ada human workflow.
4. Ada audit requirement.
5. Ada retry dan DLQ.
6. Ada backfill/replay.
7. Ada multi-region replication.
8. Kafka transactions tidak mencakup semua side effect.

---

## 11. Kafka Producer Idempotence

### 11.1 Masalah Producer Retry

Producer mengirim record:

```text
producer -> broker: append record A
broker appends record A
broker sends ack
ack lost in network
producer retries record A
```

Tanpa idempotence, broker bisa menulis record A dua kali.

### 11.2 Idempotent Producer

Idempotent producer membuat broker bisa mendeteksi duplicate dari producer retry.

Secara konseptual Kafka menggunakan:

```text
producer id
producer epoch
sequence number per partition
```

Jika broker melihat sequence number yang sudah pernah diterima untuk producer-partition tertentu, duplicate bisa ditolak/dideduplicate.

### 11.3 Config Utama

```properties
enable.idempotence=true
acks=all
retries=2147483647
max.in.flight.requests.per.connection=5
```

Catatan:

- Pada Kafka modern, `enable.idempotence` dapat default `true` selama tidak ada config yang konflik.
- Idempotence membutuhkan `acks=all`.
- Idempotence membutuhkan retries aktif.
- `max.in.flight.requests.per.connection` harus berada dalam batas yang kompatibel.

### 11.4 Apa yang Dijamin?

Idempotent producer membantu mencegah duplicate append akibat retry producer dalam session/epoch yang valid.

Guarantee ini kuat untuk:

```text
producer -> Kafka broker
```

Tapi tidak otomatis menyelesaikan:

```text
consumer -> database
consumer -> REST API
consumer -> email service
consumer -> payment gateway
```

### 11.5 Idempotent Producer Bukan Transactional Producer

Idempotence:

```text
Avoid duplicate writes caused by producer retry.
```

Transaction:

```text
Atomically write multiple records/partitions and optionally commit consumed offsets with produced output.
```

---

## 12. Kafka Transactions

### 12.1 Masalah yang Diselesaikan

Kafka transactions terutama menyelesaikan pola:

```text
consume from Kafka
transform
produce to Kafka
commit consumed offsets
```

Kita ingin output records dan offset commit terjadi atomik.

Tanpa transaksi:

```text
consume input offset 100
produce output to topic B
crash before committing offset 101
restart
consume input offset 100 again
produce duplicate output to topic B
```

Dengan transaksi:

```text
consume input offset 100
begin transaction
produce output
send offset commit to transaction
commit transaction
```

Jika crash sebelum commit transaction, output tidak visible ke `read_committed` consumer dan offset tidak committed.

### 12.2 Config Utama Producer

```properties
enable.idempotence=true
transactional.id=case-stream-processor-1
acks=all
```

`transactional.id` harus stabil untuk instance producer yang sama secara logis, tetapi unik antar instance aktif.

### 12.3 Consumer Isolation Level

Consumer downstream harus memakai:

```properties
isolation.level=read_committed
```

Jika tidak, consumer bisa membaca record dari transaksi yang nantinya aborted.

### 12.4 Java Transactional Producer Skeleton

```java
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true");
props.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG, "case-transformer-0");
props.put(ProducerConfig.ACKS_CONFIG, "all");

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
producer.initTransactions();

try {
    producer.beginTransaction();

    producer.send(new ProducerRecord<>("case-derived-events", key, value));

    Map<TopicPartition, OffsetAndMetadata> offsets = Map.of(
        new TopicPartition(inputTopic, partition),
        new OffsetAndMetadata(inputOffset + 1)
    );

    producer.sendOffsetsToTransaction(offsets, consumer.groupMetadata());

    producer.commitTransaction();
} catch (Exception e) {
    producer.abortTransaction();
    throw e;
}
```

### 12.5 What Exactly Is Atomic?

Kafka transaction dapat membuat ini atomik:

```text
Produced records to Kafka topics
+
Consumed offsets committed to Kafka group
```

Tetapi bukan ini:

```text
Produced records to Kafka
+
Database commit
+
REST API call
+
Email sent
+
File uploaded
```

### 12.6 Transaction Boundary

Kafka transaction boundary berada di Kafka ecosystem.

```text
Kafka topic A -> Kafka app -> Kafka topic B
```

Ini cocok.

```text
Kafka topic A -> Kafka app -> PostgreSQL + external API
```

Ini tidak otomatis covered.

---

## 13. Exactly-Once Semantics: Apa Makna yang Benar?

### 13.1 Definisi Praktis

Dalam Kafka, exactly-once semantics terutama berarti:

> Dalam pola Kafka-to-Kafka, input offset processing dan output record production dapat dibuat atomik sehingga hasil transformasi tidak muncul dua kali kepada consumer `read_committed`, walaupun terjadi retry/crash.

### 13.2 Exactly-Once Bukan Berarti Event Tidak Pernah Dibaca Dua Kali

Aplikasi bisa saja membaca input yang sama lagi setelah crash. Yang dijamin adalah efek output transactional-nya tidak committed dua kali.

### 13.3 Exactly-Once Bukan Berarti Semua Side Effect Exactly Once

Jika aplikasi mengirim email di tengah transaction Kafka:

```text
begin Kafka transaction
produce output event
send email
crash before commit Kafka transaction
```

Kafka transaction aborted. Tapi email sudah terkirim.

Saat retry, email bisa terkirim lagi.

Kafka tidak bisa rollback email.

### 13.4 Exactly-Once Bukan Pengganti Idempotency

Untuk sistem nyata, tetap desain idempotency.

Bahkan dengan Kafka Streams exactly-once, jika topology melakukan external side effect manual, kamu tetap harus mengamankan side effect tersebut.

---

## 14. Kafka Streams Exactly-Once

Kafka Streams menyederhanakan penggunaan transactions untuk stream processing.

Config modern:

```properties
processing.guarantee=exactly_once_v2
```

Dengan ini Kafka Streams mengelola transactional producer, offset, state store changelog, dan output topic secara lebih terintegrasi.

### 14.1 Cocok Untuk

1. Kafka input ke Kafka output.
2. Stateful aggregation.
3. Stream-table join.
4. Derived topics.
5. Materialized view yang direpresentasikan via changelog topic.

### 14.2 Tetap Hati-Hati Jika Ada External Side Effect

Misalnya dalam `foreach()`:

```java
stream.foreach((key, value) -> {
    externalPaymentClient.call(value);
});
```

Ini bukan automatically exactly-once hanya karena Kafka Streams config exactly-once.

External side effect tetap harus idempotent.

---

## 15. Read Committed vs Read Uncommitted

### 15.1 `read_uncommitted`

Default behavior historis consumer adalah membaca semua record, termasuk record dari transaksi yang nantinya aborted.

```properties
isolation.level=read_uncommitted
```

Consumer bisa melihat:

```text
committed transactional records
aborted transactional records
non-transactional records
```

### 15.2 `read_committed`

```properties
isolation.level=read_committed
```

Consumer hanya melihat record yang committed dan non-transactional record. Record dari transaksi aborted tidak diberikan ke aplikasi.

### 15.3 Implikasi Latency

`read_committed` consumer dapat tertahan oleh open transaction karena broker harus menjaga batas visibility.

Jika ada transaksi lama yang belum committed/aborted, consumer read_committed bisa tampak lagging walau broker sehat.

### 15.4 Operational Risk

Transaction yang terlalu lama dapat menyebabkan:

1. Consumer latency meningkat.
2. Visibility delay.
3. Transaction timeout.
4. Operational confusion karena offset log terlihat maju tetapi consumer tidak menerima record.

---

## 16. Offset Commit Bukan Business Commit

Offset commit hanya berarti:

```text
Consumer group X menyatakan sudah selesai membaca sampai offset tertentu.
```

Offset commit tidak berarti:

```text
Database berhasil update.
Email berhasil dikirim.
Case lifecycle valid.
Audit trail lengkap.
```

Jangan pernah memakai offset commit sebagai satu-satunya bukti bisnis.

Untuk sistem regulatory/case management, bukti bisnis harus ada di domain store/audit log/event store yang punya semantic metadata.

---

## 17. Crash Matrix

Mari lihat beberapa titik crash.

### 17.1 Consumer to Database: At-Least-Once

```text
1. poll event
2. update DB
3. commit Kafka offset
```

| Crash Point | DB Effect | Offset Commit | Result |
|---|---:|---:|---|
| Before DB update | No | No | Retry, OK |
| During DB update unknown | Unknown | No | Retry may duplicate |
| After DB update before offset commit | Yes | No | Duplicate possible |
| After offset commit | Yes | Yes | OK |

### 17.2 Consumer Commit Before DB

```text
1. poll event
2. commit Kafka offset
3. update DB
```

| Crash Point | Offset Commit | DB Effect | Result |
|---|---:|---:|---|
| After offset before DB | Yes | No | Data loss |

### 17.3 Kafka Transactional Pipeline

```text
1. poll input
2. begin transaction
3. produce output
4. send offsets to transaction
5. commit transaction
```

| Crash Point | Output Visible? | Offset Committed? | Result |
|---|---:|---:|---|
| Before transaction commit | No | No | Retry input |
| After transaction commit | Yes | Yes | OK |

This is the strong Kafka-to-Kafka case.

---

## 18. Pattern: Idempotent Database Consumer

### 18.1 Problem

Consumer harus update database berdasarkan event Kafka.

Requirement:

```text
No lost event.
Duplicate event must not duplicate business effect.
```

### 18.2 Pattern

```text
Kafka at-least-once delivery
+
DB transaction
+
processed_events table
+
idempotency key
```

### 18.3 Flow

```text
poll event
begin DB transaction
insert idempotency key
if duplicate: rollback/commit no-op and commit Kafka offset
apply business mutation
commit DB transaction
commit Kafka offset
```

### 18.4 Pseudocode

```java
public void consume(ConsumerRecord<String, CaseEvent> record) {
    CaseEvent event = record.value();

    database.transaction(() -> {
        boolean firstTime = processedEvents.tryRegister(
            "case-projection-consumer",
            event.eventId(),
            record.topic(),
            record.partition(),
            record.offset()
        );

        if (!firstTime) {
            return;
        }

        caseProjection.apply(event);
    });

    consumer.commitSync(Map.of(
        new TopicPartition(record.topic(), record.partition()),
        new OffsetAndMetadata(record.offset() + 1)
    ));
}
```

### 18.5 Failure Behavior

If crash after DB commit before Kafka commit:

```text
event redelivered
processed_events duplicate key
business effect skipped
Kafka offset committed
```

Correct.

---

## 19. Pattern: Inbox

### 19.1 Problem

Kamu ingin menyimpan event yang diterima dari Kafka ke database lokal, lalu memprosesnya secara controlled.

### 19.2 Design

```text
Kafka consumer -> inbox table -> local worker -> business tables
```

### 19.3 Table

```sql
CREATE TABLE inbox_events (
    idempotency_key VARCHAR(200) PRIMARY KEY,
    event_type      VARCHAR(100) NOT NULL,
    payload         JSONB NOT NULL,
    status          VARCHAR(30) NOT NULL,
    received_at     TIMESTAMP NOT NULL,
    processed_at    TIMESTAMP NULL,
    retry_count     INT NOT NULL DEFAULT 0,
    last_error      TEXT NULL
);
```

### 19.4 Benefit

1. Kafka consumer cepat.
2. Processing bisa dikontrol lokal.
3. Retry bisa ditrack.
4. Poison event tidak selalu block Kafka partition.
5. Audit lebih jelas.

### 19.5 Cost

1. Ada storage tambahan.
2. Ada worker tambahan.
3. Ada state machine lokal.
4. Latency bertambah.

---

## 20. Pattern: Outbox

### 20.1 Problem

Service mengubah database dan publish event ke Kafka. Jika dua operasi ini dilakukan terpisah, ada dual-write problem.

```text
update DB
publish Kafka event
```

Crash di antara keduanya bisa menyebabkan DB berubah tetapi event tidak terbit.

### 20.2 Design

Dalam satu database transaction:

```text
update business table
insert outbox event row
commit
```

Lalu relay/CDC connector publish outbox row ke Kafka.

### 20.3 Table

```sql
CREATE TABLE outbox_events (
    event_id        VARCHAR(200) PRIMARY KEY,
    aggregate_type  VARCHAR(100) NOT NULL,
    aggregate_id    VARCHAR(200) NOT NULL,
    event_type      VARCHAR(100) NOT NULL,
    payload         JSONB NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    published_at    TIMESTAMP NULL
);
```

### 20.4 Why It Matters

Outbox menyelesaikan atomicity antara:

```text
business state change
+
event publication intent
```

Bukan dengan distributed transaction, tetapi dengan menjadikan event publication sebagai bagian dari transaksi database lokal.

### 20.5 Kafka Relation

Outbox sering dipadukan dengan:

1. Kafka Connect JDBC source.
2. Debezium CDC.
3. Custom relay publisher.

Part CDC/outbox akan dibahas lebih dalam di Part 016.

---

## 21. Pattern: Transactional Kafka-to-Kafka Processor

### 21.1 Problem

Membaca topic input, menghasilkan topic output, dan tidak ingin duplicate output saat crash.

### 21.2 Use Transaction

```text
begin Kafka transaction
read/process input
produce output events
send consumed offsets into transaction
commit Kafka transaction
```

### 21.3 Good Use Cases

1. Event enrichment.
2. Filtering.
3. Routing.
4. Aggregation output.
5. Stream processing pipeline.
6. Derived domain event.

### 21.4 Avoid For

1. Long-running business workflow.
2. Human approval.
3. External REST side effect.
4. Database transaction combined with Kafka transaction without careful design.

---

## 22. Pattern: Idempotent External API Call

### 22.1 Problem

Consumer memanggil external API.

```text
Kafka event -> REST API create payment
```

Network timeout bisa menyebabkan duplicate.

### 22.2 Requirement

External API harus menerima idempotency key.

```http
POST /payments
Idempotency-Key: PAY-INSTRUCTION-123
```

### 22.3 Flow

```text
consumer receives event
call API with idempotency key
if timeout, retry with same key
API returns same result or no-op
commit offset after success
```

### 22.4 Jika API Tidak Support Idempotency

Risikonya tinggi. Alternatif:

1. Jangan panggil langsung dari Kafka consumer.
2. Buat local command table.
3. Gunakan reconciliation job.
4. Minta provider support idempotency.
5. Tambahkan manual review untuk ambiguous timeout.
6. Batasi retry otomatis.

---

## 23. Decision Matrix

| Scenario | Recommended Semantics | Pattern |
|---|---|---|
| Metrics/debug logs | At-most-once atau at-least-once ringan | Batch commit |
| Business DB projection | Effectively-once | At-least-once + idempotency table |
| Kafka topic enrichment | Exactly-once Kafka-to-Kafka | Kafka transactions / Kafka Streams EOS |
| Payment side effect | Effectively-once with strong idempotency | Idempotency key + reconciliation |
| Email notification | At-least-once with dedup | Notification id + send log |
| Audit trail | At-least-once + immutable event id | Unique event id constraint |
| Search indexing | Effectively-once | Upsert by document id/version |
| Cache update | At-least-once acceptable | Last-write-wins/version guard |
| Case escalation | Effectively-once | Transition id + state machine guard |
| CDC pipeline | Depends on connector/source | Source offset + idempotent sink |

---

## 24. Java Engineer Perspective

### 24.1 Jangan Sembunyikan Semantics di Framework

Spring Kafka, Micronaut, Quarkus, atau custom framework tidak menghapus semantics Kafka.

Kamu tetap harus tahu:

1. Kapan offset committed.
2. Apa yang terjadi saat exception.
3. Apakah listener auto ack atau manual ack.
4. Apakah retry dilakukan sebelum atau sesudah commit.
5. Apakah DLQ publish bisa gagal.
6. Apakah DB transaction mencakup idempotency marker.
7. Apakah handler idempotent.

### 24.2 Config Bukan Pengganti Desain

Ini bagus:

```properties
enable.idempotence=true
acks=all
isolation.level=read_committed
```

Tetapi tetap belum menjawab:

```text
Apa yang terjadi jika consumer crash setelah database commit tapi sebelum offset commit?
```

### 24.3 Treat Duplicate as Test Case

Untuk setiap consumer bisnis, buat test:

```text
Given same event delivered twice
Then business effect happens once
```

Jika test itu gagal, consumer belum production-grade.

---

## 25. Regulatory / Case Management Perspective

Dalam sistem regulatory enforcement lifecycle, duplicate dan loss punya implikasi serius.

Contoh event:

```json
{
  "eventId": "EVT-2026-0001",
  "eventType": "CaseEscalated",
  "caseId": "CASE-991",
  "fromState": "UNDER_REVIEW",
  "toState": "ESCALATED",
  "reason": "SLA_BREACH",
  "occurredAt": "2026-06-19T09:10:00Z",
  "causationId": "EVT-2026-0000",
  "correlationId": "CASE-991"
}
```

### 25.1 Loss Risk

Jika event hilang:

1. Case tidak dieskalasi.
2. SLA breach tidak ditindak.
3. Audit trail tidak lengkap.
4. Regulator tidak bisa menjelaskan chronology.

### 25.2 Duplicate Risk

Jika event diproses dua kali:

1. Dua escalation task dibuat.
2. Dua notification terkirim.
3. Dua officer assignment dibuat.
4. Metrics regulatory enforcement salah.
5. Human user melihat workflow kacau.

### 25.3 Recommended Semantics

Untuk lifecycle event:

```text
At-least-once delivery
+
strict eventId uniqueness
+
state transition guard
+
audit append
+
idempotent projection
=
effectively-once business effect
```

### 25.4 State Transition Guard

```sql
UPDATE cases
SET status = 'ESCALATED', version = version + 1
WHERE case_id = :caseId
  AND status = 'UNDER_REVIEW'
  AND NOT EXISTS (
      SELECT 1 FROM processed_events
      WHERE idempotency_key = :eventId
  );
```

Better done in a clean transaction with explicit processed event insert.

### 25.5 Audit Rule

Correction should be event-based, not mutation-based.

Bad:

```text
Delete duplicate audit row manually.
```

Better:

```text
Append CorrectionIssued event explaining duplicate suppression or erroneous event.
```

---

## 26. Anti-Patterns

### 26.1 “We Enabled Idempotent Producer, So Whole System Is Exactly Once”

Wrong.

Idempotent producer protects producer-to-broker duplicate writes due to retry. It does not protect downstream side effects.

### 26.2 Commit Offset Before Business Processing

This creates at-most-once behavior and can lose business events.

### 26.3 No Idempotency Key

If event has no stable ID, deduplication becomes guesswork.

### 26.4 Using Kafka Offset as Business ID

Offset is technical position, not business identity.

### 26.5 Retrying External API Without Idempotency

This can create duplicate payment, duplicate notification, duplicate case action, or duplicate ticket.

### 26.6 DLQ as Garbage Bin

DLQ is not a semantics solution. DLQ only moves failure elsewhere. You still need replay, triage, and idempotent recovery.

### 26.7 Assuming Exactly-Once Means No Reprocessing

Even with transactions, reprocessing can happen. The point is atomic visibility/commit of output, not that code never sees input twice.

### 26.8 Long Kafka Transactions

Long-running transactions increase visibility delay, resource usage, and operational complexity.

### 26.9 Mixing Human Workflow Inside Kafka Transaction

Kafka transactions are for short technical atomicity, not human approval workflows.

---

## 27. Failure Modelling Exercises

### Exercise 1 — DB Projection

Flow:

```text
poll event
update projection table
commit offset
```

Crash after update before commit.

Question:

1. Will event be redelivered?
2. Can projection duplicate?
3. What table constraint prevents duplicate?
4. What if update is additive, like increment counter?

Expected reasoning:

- Event redelivered.
- Projection may duplicate if update is not idempotent.
- Use event id table or version guard.
- Counter increment is dangerous unless event id dedup exists.

### Exercise 2 — Kafka-to-Kafka Transform

Flow:

```text
consume A
produce B
commit offset A
```

Crash after produce B before commit offset A.

Question:

1. What happens without Kafka transaction?
2. What happens with Kafka transaction?

Expected reasoning:

- Without transaction, duplicate output B possible.
- With transaction and `read_committed`, output and offset are atomic.

### Exercise 3 — External Email

Flow:

```text
consume CaseEscalated
send email
commit offset
```

Crash after email before commit.

Question:

1. Can email be sent twice?
2. Can Kafka transaction prevent it?
3. What design helps?

Expected reasoning:

- Yes.
- Kafka transaction cannot rollback external email.
- Use notification id, send log, provider idempotency, or notification service with dedup.

---

## 28. Practical Checklist

Before shipping any Kafka consumer, answer:

1. What is the idempotency key?
2. Is the operation naturally idempotent?
3. If not, where is deduplication stored?
4. Is dedup marker committed atomically with business effect?
5. When is Kafka offset committed?
6. What happens if crash occurs after side effect before offset commit?
7. What happens if downstream timeout occurs after side effect succeeded?
8. Are retries bounded or infinite?
9. Where do poison records go?
10. Can DLQ be replayed safely?
11. Does replay create duplicate business effects?
12. Are old events allowed to overwrite newer state?
13. Is event ID stable across backfill/replay/migration?
14. Are duplicate metrics tracked?
15. Is there reconciliation for ambiguous external side effects?

---

## 29. Minimal Production Config Examples

### 29.1 Reliable Producer

```properties
acks=all
enable.idempotence=true
retries=2147483647
delivery.timeout.ms=120000
request.timeout.ms=30000
linger.ms=5
batch.size=32768
compression.type=zstd
```

Do not cargo-cult values. Tune based on workload.

### 29.2 Transactional Producer

```properties
acks=all
enable.idempotence=true
transactional.id=case-transformer-instance-0
transaction.timeout.ms=60000
```

### 29.3 Consumer for Transactional Topics

```properties
isolation.level=read_committed
enable.auto.commit=false
```

### 29.4 Business Consumer

```properties
enable.auto.commit=false
max.poll.records=100
max.poll.interval.ms=300000
```

Business safety is mostly in code and database design, not config alone.

---

## 30. Mental Model Summary

### 30.1 At-Most-Once

```text
Commit before processing.
No duplicate ideally.
Loss possible.
```

### 30.2 At-Least-Once

```text
Process before commit.
Loss minimized.
Duplicate possible.
```

### 30.3 Effectively-Once

```text
At-least-once delivery.
Idempotent business processing.
Duplicate delivery tolerated.
Final business effect once.
```

### 30.4 Exactly-Once

```text
Kafka-supported atomic consume-transform-produce.
Best suited for Kafka-to-Kafka pipelines.
Requires idempotence, transactions, and read_committed consumers.
Does not automatically cover external side effects.
```

---

## 31. The Strongest Practical Rule

For real systems, especially business/regulatory systems, use this rule:

```text
Assume every event can be delivered more than once.
Assume every downstream call can timeout after succeeding.
Assume every process can crash between any two lines of code.
Design the final business effect to be idempotent.
```

If your design survives that, it is Kafka-production-grade.

---

## 32. What You Should Remember

1. Kafka default practical consumer model is at-least-once.
2. At-least-once means duplicate is possible.
3. Duplicate is not rare; it is a normal failure outcome.
4. Idempotency is not optional for business consumers.
5. Idempotent producer solves producer retry duplication into Kafka.
6. Kafka transactions solve Kafka-to-Kafka atomicity.
7. `read_committed` is needed for consumers that should not see aborted transactional records.
8. Exactly-once does not automatically include database/API/email side effects.
9. Effectively-once is often the correct target for enterprise systems.
10. Always define the boundary of the guarantee.

---

## 33. Connection to Previous Parts

This part builds directly on:

- Part 004: Producer configs, `acks`, retries, idempotence.
- Part 006: Consumer poll loop, offset commit.
- Part 007: Rebalance and duplicate processing risk.

The key bridge is:

```text
Producer retry can duplicate writes.
Consumer crash/rebalance can duplicate reads.
Offset commit timing determines loss vs duplicate trade-off.
Delivery semantics are the language for reasoning about those outcomes.
```

---

## 34. Connection to Future Parts

This part prepares you for:

- Part 009: Event design and idempotency keys.
- Part 010: Schema governance and event evolution.
- Part 014-016: Kafka Connect, CDC, outbox/inbox.
- Part 019-021: Kafka Streams exactly-once and stateful processing.
- Part 026: Failure modelling.
- Part 027-028: Event-driven architecture and regulatory case management.

---

## 35. Final Takeaway

The most mature way to think about Kafka semantics is not:

```text
Can Kafka guarantee exactly-once?
```

The mature question is:

```text
For this specific workflow, what failure can happen between each step,
and what invariant prevents loss, duplication, or invalid business state?
```

Kafka gives powerful primitives:

```text
 durable log
 producer idempotence
 transactions
 offset tracking
 read_committed isolation
 replay
```

But the application must still define:

```text
 business identity
 idempotency boundary
 side-effect atomicity
 deduplication strategy
 recovery process
 audit semantics
```

That distinction is the difference between using Kafka and engineering with Kafka.

---

# Status Seri

Part 008 selesai.

Progress saat ini:

```text
Part 000 — selesai
Part 001 — selesai
Part 002 — selesai
Part 003 — selesai
Part 004 — selesai
Part 005 — selesai
Part 006 — selesai
Part 007 — selesai
Part 008 — selesai
```

Seri belum selesai. Masih ada Part 009 sampai Part 034.

Part berikutnya:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-009.md
```

Judul:

```text
Event Design: Facts, Commands, State Changes, and Domain Events
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-007.md">⬅️ Part 007 — Consumer Groups and Rebalancing: Assignment, Ownership, and Failure Modes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-009.md">Part 009 — Event Design: Facts, Commands, State Changes, and Domain Events ➡️</a>
</div>

# learn-kafka-event-streaming-mastery-for-java-engineers-part-017.md

# Part 017 — ksqlDB Fundamentals: Streams, Tables, Persistent Queries, Push/Pull Queries

> Seri: `learn-kafka-event-streaming-mastery-for-java-engineers`  
> Part: `017 / 034`  
> Fokus: memahami ksqlDB sebagai layer SQL untuk stream processing di atas Kafka, bukan sebagai database relasional biasa dan bukan sekadar CLI untuk melihat topic.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. Menjelaskan apa itu ksqlDB dan masalah apa yang diselesaikannya.
2. Membedakan ksqlDB, Kafka Streams, Kafka Connect, consumer API, dan SQL database tradisional.
3. Memahami `STREAM` dan `TABLE` sebagai dua view berbeda atas data Kafka.
4. Memahami perbedaan persistent query, push query, dan pull query.
5. Membaca dan menulis statement dasar `CREATE STREAM`, `CREATE TABLE`, `CREATE STREAM AS SELECT`, dan `CREATE TABLE AS SELECT`.
6. Menjelaskan bagaimana ksqlDB menjalankan query sebagai Kafka Streams application di belakang layar.
7. Memahami relationship antara ksqlDB objects, Kafka topics, schemas, keys, partitions, dan internal topics.
8. Mengidentifikasi kapan ksqlDB cocok digunakan dan kapan sebaiknya memakai Kafka Streams atau custom service.
9. Mendesain use case awal seperti filtering, projection, enrichment sederhana, materialized view, dan real-time monitoring.
10. Menghindari anti-pattern umum: memakai ksqlDB seperti OLTP database, mengabaikan key, salah memahami pull query, dan membuat topology tanpa governance.

---

## 2. Mental Model Utama

ksqlDB paling mudah dipahami sebagai:

```text
SQL interface + stream processing engine + materialized state + Kafka-native runtime
```

Lebih konkret:

```text
Kafka topics  ->  ksqlDB STREAM/TABLE  ->  SQL query  ->  Kafka Streams topology  ->  derived Kafka topics / materialized state
```

ksqlDB bukan:

```text
replacement untuk PostgreSQL
replacement untuk transactional database
BI warehouse
generic SQL engine untuk query historis besar
message queue browser
```

ksqlDB adalah cara untuk membuat aplikasi stream processing berbasis Kafka dengan SQL-like language.

Dokumentasi Confluent mendeskripsikan ksqlDB sebagai streaming SQL database yang dibuat untuk membangun aplikasi real-time/event-driven di atas Apache Kafka menggunakan sintaks SQL familiar. Secara arsitektur, ksqlDB menerjemahkan SQL statement menjadi logical plan, physical plan, lalu menjalankan Kafka Streams application. Persistent query dikelola sebagai stream/table dengan query yang terus berjalan.

Mental model yang lebih dalam:

```text
Kafka topic adalah log fisik.
ksqlDB STREAM adalah interpretasi topic sebagai rangkaian event immutable.
ksqlDB TABLE adalah interpretasi topic sebagai changelog dari state keyed.
Persistent query adalah proses yang berjalan terus-menerus.
Push query adalah subscription terhadap perubahan.
Pull query adalah request-response terhadap current materialized state.
```

---

## 3. Kenapa ksqlDB Ada?

Sebelum ksqlDB, pilihan umum untuk stream processing Kafka adalah:

1. Tulis consumer manual.
2. Tulis Kafka Streams application.
3. Pakai framework streaming eksternal seperti Flink/Spark.
4. Sink data ke database/warehouse lalu query di sana.

Masing-masing punya tempat, tetapi ada gap:

```text
Bagaimana kalau kita hanya butuh transform/filter/join/aggregate streaming sederhana sampai menengah,
tanpa menulis banyak Java code,
dan tetap Kafka-native?
```

ksqlDB mengisi gap itu.

Contoh problem yang cocok:

1. Ambil event transaksi mentah, filter hanya transaksi gagal, publish ke topic baru.
2. Gabungkan stream payment dengan table merchant profile.
3. Hitung jumlah event per user per window.
4. Buat materialized view latest case status by case id.
5. Expose pull query untuk membaca current state berdasarkan key.
6. Jalankan push query untuk monitoring event yang memenuhi kondisi tertentu.
7. Transform format field dan rename schema untuk downstream system.

Tanpa ksqlDB, kamu mungkin perlu menulis Java Kafka Streams application. Dengan ksqlDB, banyak hal bisa ditulis seperti:

```sql
CREATE STREAM failed_payments AS
SELECT *
FROM payments
WHERE status = 'FAILED'
EMIT CHANGES;
```

Tetapi jangan tertipu oleh bentuk SQL-nya. Query di atas bukan batch query yang selesai. Itu adalah persistent stream-processing job yang terus membaca topic input dan menulis hasil ke topic output.

---

## 4. ksqlDB dalam Kafka Ecosystem

Untuk memahami posisi ksqlDB, bandingkan dengan komponen lain:

| Komponen | Fungsi Utama | Cocok Untuk | Tidak Cocok Untuk |
|---|---|---|---|
| Kafka producer API | Menulis event ke Kafka | Aplikasi sumber event | Transformasi kompleks lintas stream |
| Kafka consumer API | Membaca event dari Kafka | Processing custom penuh | Banyak logic stateful tanpa framework |
| Kafka Streams | Library Java stream processing | Aplikasi stream processing production dengan logic kompleks | Tim yang butuh SQL-first/simple ops |
| Kafka Connect | Integrasi source/sink | CDC, database sink, object storage sink, connector reuse | Business logic domain kompleks |
| ksqlDB | SQL stream processing di atas Kafka | Transform, filter, join, aggregate, materialized view | OLTP, ad-hoc analytics berat, workflow kompleks |
| Schema Registry | Governance schema | Avro/Protobuf/JSON Schema contract | Menyimpan event data |

Relasi yang penting:

```text
ksqlDB memakai Kafka topics sebagai input/output.
ksqlDB memakai Kafka Streams sebagai execution engine.
ksqlDB dapat memakai Schema Registry untuk schema-aware serialization.
ksqlDB dapat membaca topic yang dibuat producer, Kafka Connect, CDC, atau aplikasi lain.
ksqlDB menghasilkan topic baru yang bisa dikonsumsi aplikasi downstream.
```

Jadi ksqlDB bukan komponen terpisah dari Kafka; ia adalah layer pemrosesan di atas Kafka.

---

## 5. Core Abstractions

ksqlDB memiliki beberapa abstraction utama:

```text
STREAM
TABLE
QUERY
CONNECTOR integration
MATERIALIZED VIEW
KEY
VALUE
SCHEMA
TOPIC
```

Bagian ini fokus pada empat yang paling fundamental:

1. Stream.
2. Table.
3. Persistent query.
4. Push/pull query.

---

## 6. STREAM: Topic sebagai Rangkaian Event Immutable

`STREAM` adalah representasi topic Kafka sebagai rangkaian event.

Mental model:

```text
STREAM = unbounded sequence of immutable rows
```

Contoh event:

```json
{"case_id":"C-1001","event_type":"CASE_OPENED","officer_id":"O-17","event_time":"2026-06-19T08:00:00Z"}
{"case_id":"C-1001","event_type":"EVIDENCE_ATTACHED","evidence_id":"E-900","event_time":"2026-06-19T08:10:00Z"}
{"case_id":"C-1001","event_type":"CASE_ESCALATED","reason":"SLA_RISK","event_time":"2026-06-19T08:45:00Z"}
```

Dalam ksqlDB, ini bisa dideklarasikan sebagai stream:

```sql
CREATE STREAM case_events (
  case_id VARCHAR KEY,
  event_type VARCHAR,
  officer_id VARCHAR,
  evidence_id VARCHAR,
  reason VARCHAR,
  event_time VARCHAR
) WITH (
  KAFKA_TOPIC='case.events.v1',
  VALUE_FORMAT='JSON',
  PARTITIONS=6
);
```

Makna penting:

1. `case_events` adalah logical object ksqlDB.
2. `case.events.v1` adalah Kafka topic fisik.
3. `case_id VARCHAR KEY` menyatakan key Kafka/logical key.
4. `VALUE_FORMAT='JSON'` menyatakan encoding value.
5. `PARTITIONS=6` dipakai jika ksqlDB perlu membuat topic; jika topic sudah ada, partisi mengikuti topic existing.

STREAM cocok untuk:

1. Event domain.
2. Clickstream.
3. Transaction event.
4. Audit event.
5. Sensor reading.
6. Case lifecycle event.
7. Command/notification stream yang tetap dimodelkan sebagai event input.

STREAM tidak menyimpan “latest row” secara konseptual. Ia menyimpan sejarah event.

---

## 7. TABLE: Topic sebagai Changelog dari State

`TABLE` adalah representasi keyed topic sebagai state terkini.

Mental model:

```text
TABLE = latest value per key derived from changelog stream
```

Misalnya topic `case.status.v1` berisi:

```text
offset 0: key=C-1001 value={status: OPEN}
offset 1: key=C-1002 value={status: OPEN}
offset 2: key=C-1001 value={status: UNDER_REVIEW}
offset 3: key=C-1001 value={status: ESCALATED}
```

Sebagai stream, semua record terlihat sebagai event berurutan.

Sebagai table, state terkini adalah:

```text
C-1001 -> ESCALATED
C-1002 -> OPEN
```

Deklarasi TABLE:

```sql
CREATE TABLE case_status (
  case_id VARCHAR PRIMARY KEY,
  status VARCHAR,
  assigned_unit VARCHAR,
  updated_at VARCHAR
) WITH (
  KAFKA_TOPIC='case.status.v1',
  VALUE_FORMAT='JSON'
);
```

Perhatikan kata `PRIMARY KEY`. Di ksqlDB table, key adalah pusat semantik. Tanpa key yang benar, table akan salah.

TABLE cocok untuk:

1. Reference data.
2. Latest state per entity.
3. Materialized view.
4. Profile table.
5. Current case status.
6. Merchant/account/customer profile.
7. Aggregation result.

TABLE bukan database OLTP. Ia tidak memberi transaction model seperti PostgreSQL. Ia adalah materialized state yang dibangun dari Kafka changelog.

---

## 8. Stream vs Table: Perbedaan yang Harus Menempel di Kepala

| Aspek | STREAM | TABLE |
|---|---|---|
| Mental model | Event history | Current state per key |
| Record meaning | Fact baru | Update terhadap state |
| Key role | Untuk partition/order/join | Identitas row/state |
| Query style | Observe events | Query materialized state |
| Contoh | `case_events` | `case_status_by_id` |
| Cocok untuk | Audit, lifecycle, transaction event | Profile, current status, aggregate result |
| Delete semantics | Event delete eksplisit sebagai event biasa | Tombstone bisa menghapus row |

Analogi sederhana:

```text
STREAM: “apa yang terjadi?”
TABLE: “apa keadaan terakhir?”
```

Dalam sistem regulatory/case management:

```text
CASE_OPENED, CASE_ASSIGNED, CASE_ESCALATED, CASE_CLOSED
```

adalah stream.

```text
case_id -> current status, current officer, current SLA state
```

adalah table.

---

## 9. Stream-Table Duality

Konsep penting di Kafka ecosystem adalah stream-table duality:

```text
A stream of changes can build a table.
A table can be represented as a stream of changes.
```

Contoh:

```text
Event stream:
C-1 status=OPEN
C-1 status=UNDER_REVIEW
C-1 status=ESCALATED
```

Jika direduksi berdasarkan key:

```text
Table:
C-1 -> ESCALATED
```

Jika table berubah, perubahan itu sendiri bisa dipublikasikan sebagai changelog stream:

```text
C-1 changed to OPEN
C-1 changed to UNDER_REVIEW
C-1 changed to ESCALATED
```

ksqlDB, Kafka Streams, log compaction, dan materialized view semuanya bergantung pada ide ini.

---

## 10. Query Type di ksqlDB

Dokumentasi ksqlDB membagi query menjadi tiga jenis utama:

1. Persistent query.
2. Push query.
3. Pull query.

Perbedaan ringkas:

| Query Type | Berjalan Terus? | Menulis Output? | Cocok Untuk |
|---|---:|---:|---|
| Persistent query | Ya | Ya, ke stream/table/topic baru | Pipeline stream processing |
| Push query | Ya sampai client berhenti | Tidak sebagai object permanen | Subscribe perubahan real-time |
| Pull query | Tidak, request-response | Tidak | Baca current state/materialized view |

---

## 11. Persistent Query

Persistent query adalah query server-side yang berjalan terus-menerus.

Biasanya dibuat oleh statement:

```sql
CREATE STREAM ... AS SELECT ... EMIT CHANGES;
CREATE TABLE ... AS SELECT ... EMIT CHANGES;
```

Contoh:

```sql
CREATE STREAM escalated_case_events AS
SELECT
  case_id,
  event_type,
  reason,
  event_time
FROM case_events
WHERE event_type = 'CASE_ESCALATED'
EMIT CHANGES;
```

Makna:

1. ksqlDB membaca `case_events` terus-menerus.
2. Setiap event yang memenuhi filter ditulis ke stream baru `escalated_case_events`.
3. Stream baru biasanya backed by Kafka topic baru.
4. Query tidak selesai setelah semua data saat ini dibaca.
5. Ketika event baru masuk, output baru bisa muncul.

Persistent query cocok untuk:

1. Transformasi permanen.
2. Derived topic.
3. Materialized view.
4. Enrichment pipeline.
5. Aggregate streaming.
6. Filtering event untuk downstream.
7. Preprocessing data sebelum sink.

Persistent query adalah aplikasi produksi. Perlakukan seperti service:

1. Ia punya lifecycle.
2. Ia punya state.
3. Ia bisa gagal.
4. Ia perlu monitoring.
5. Ia bisa menghasilkan internal topics.
6. Ia perlu ownership.
7. Ia punya cost.

---

## 12. Push Query

Push query adalah query yang membuat client subscribe ke perubahan real-time.

Contoh:

```sql
SELECT
  case_id,
  event_type,
  reason,
  event_time
FROM case_events
WHERE event_type = 'CASE_ESCALATED'
EMIT CHANGES;
```

Perhatikan: tidak ada `CREATE STREAM AS`. Ini bukan membuat object permanen. Ini seperti membuka subscription.

Makna:

```text
Client: “beri saya row baru yang cocok mulai sekarang/posisi tertentu.”
ksqlDB: mengirim hasil terus sampai query dihentikan.
```

Push query cocok untuk:

1. Dashboard real-time.
2. Debug stream secara controlled.
3. Operational monitoring.
4. Alert preview.
5. Async application flow.
6. Melihat perubahan materialized table.

Push query tidak cocok untuk:

1. Batch export besar.
2. Query OLAP kompleks.
3. Serving API request-response biasa.
4. Menjalankan business-critical pipeline permanen tanpa persistent query.

Jika query harus menjadi bagian dari production pipeline, gunakan persistent query, bukan push query ad-hoc.

---

## 13. Pull Query

Pull query adalah request-response query terhadap current state/materialized view.

Contoh:

```sql
SELECT
  case_id,
  status,
  assigned_unit,
  updated_at
FROM case_status_by_id
WHERE case_id = 'C-1001';
```

Makna:

```text
Client: “beri saya state terkini untuk key ini.”
ksqlDB: mencari di materialized state dan mengembalikan hasil, lalu selesai.
```

Pull query cocok untuk:

1. Lookup current state by key.
2. Serving read model sederhana.
3. Query materialized aggregate.
4. API internal dengan akses key-based.
5. Debug latest status.

Pull query tidak sama dengan SQL query di database relasional.

Batasan konseptual:

1. Biasanya harus berbasis key atau materialized state yang didukung.
2. Tidak cocok untuk scan bebas besar.
3. Tidak menggantikan PostgreSQL untuk relational query arbitrary.
4. State yang dibaca adalah hasil pemrosesan streaming, sehingga perlu memahami freshness, lag, dan consistency.

Pull query adalah cara membaca state yang sudah dimaterialisasi, bukan cara mengubah Kafka menjadi database OLTP umum.

---

## 14. Transient Query vs Persistent Query

Kadang istilah “transient query” muncul untuk query yang tidak disimpan sebagai persistent application.

Contoh push query:

```sql
SELECT * FROM case_events EMIT CHANGES;
```

Ia berjalan selama session/client masih aktif.

Persistent query:

```sql
CREATE STREAM case_events_sanitized AS
SELECT case_id, event_type, event_time
FROM case_events
EMIT CHANGES;
```

Ia menjadi bagian dari ksqlDB metadata dan tetap berjalan sampai dihentikan/drop.

Rule sederhana:

```text
Untuk inspeksi: push query.
Untuk pipeline: persistent query.
Untuk lookup state: pull query.
```

---

## 15. Anatomy: CREATE STREAM

Contoh sederhana:

```sql
CREATE STREAM payments (
  payment_id VARCHAR KEY,
  account_id VARCHAR,
  amount DECIMAL(12,2),
  currency VARCHAR,
  status VARCHAR,
  created_at VARCHAR
) WITH (
  KAFKA_TOPIC='payments.v1',
  VALUE_FORMAT='JSON',
  PARTITIONS=12
);
```

Yang perlu dipahami:

```text
payments                 -> nama object di ksqlDB
payment_id VARCHAR KEY   -> logical key mapping ke Kafka key
KAFKA_TOPIC              -> topic fisik
VALUE_FORMAT             -> format value
PARTITIONS               -> jumlah partition bila topic dibuat oleh ksqlDB
```

Jika topic sudah ada, kamu harus memastikan:

1. Format data sesuai.
2. Key sesuai dengan deklarasi.
3. Partition count sesuai kebutuhan query downstream.
4. Schema registry subject cocok bila memakai Avro/Protobuf/JSON Schema.

---

## 16. Anatomy: CREATE TABLE

Contoh:

```sql
CREATE TABLE accounts (
  account_id VARCHAR PRIMARY KEY,
  status VARCHAR,
  risk_level VARCHAR,
  updated_at VARCHAR
) WITH (
  KAFKA_TOPIC='accounts.current.v1',
  VALUE_FORMAT='JSON'
);
```

Yang penting:

1. `PRIMARY KEY` adalah identitas row.
2. Topic harus keyed by `account_id`.
3. Record dengan key sama dianggap update terhadap row yang sama.
4. Tombstone bisa menghapus row, tergantung format/topic semantics.
5. Table cocok untuk join enrichment.

Contoh stream-table join:

```sql
CREATE STREAM enriched_payments AS
SELECT
  p.payment_id,
  p.account_id,
  p.amount,
  p.currency,
  p.status,
  a.risk_level AS account_risk_level
FROM payments p
LEFT JOIN accounts a
  ON p.account_id = a.account_id
EMIT CHANGES;
```

Makna:

```text
Setiap payment event diperkaya dengan latest account state pada saat processing.
```

Ini bukan join database historis. Ini streaming join dengan semantics waktu dan state tertentu.

---

## 17. Anatomy: CREATE STREAM AS SELECT

`CREATE STREAM AS SELECT` sering disebut CSAS.

Contoh:

```sql
CREATE STREAM failed_payments AS
SELECT
  payment_id,
  account_id,
  amount,
  currency,
  created_at
FROM payments
WHERE status = 'FAILED'
EMIT CHANGES;
```

CSAS menghasilkan:

1. ksqlDB stream baru.
2. Kafka topic output baru.
3. Persistent query yang terus berjalan.

Kamu bisa mengatur topic output:

```sql
CREATE STREAM failed_payments
WITH (
  KAFKA_TOPIC='payments.failed.v1',
  VALUE_FORMAT='AVRO',
  PARTITIONS=12
) AS
SELECT
  payment_id,
  account_id,
  amount,
  currency,
  created_at
FROM payments
WHERE status = 'FAILED'
EMIT CHANGES;
```

Perhatikan bahwa output format bisa berbeda dari input, tergantung konfigurasi dan schema.

---

## 18. Anatomy: CREATE TABLE AS SELECT

`CREATE TABLE AS SELECT` sering disebut CTAS.

Contoh aggregate:

```sql
CREATE TABLE payment_count_by_account AS
SELECT
  account_id,
  COUNT(*) AS payment_count
FROM payments
GROUP BY account_id
EMIT CHANGES;
```

Makna:

1. ksqlDB membaca stream `payments`.
2. Mengelompokkan berdasarkan `account_id`.
3. Menjaga state count per account.
4. Menulis changelog hasil aggregate ke topic table output.
5. Membuat materialized table yang bisa dipakai untuk pull query.

Pull query:

```sql
SELECT
  account_id,
  payment_count
FROM payment_count_by_account
WHERE account_id = 'A-123';
```

Ini adalah pola umum:

```text
STREAM input -> CTAS aggregate -> materialized TABLE -> pull query / downstream topic
```

---

## 19. Keys: Hal Paling Penting yang Sering Diremehkan

Dalam ksqlDB, key menentukan:

1. Partitioning.
2. Join feasibility.
3. Grouping.
4. Table primary key.
5. Pull query lookup.
6. State store layout.
7. Repartitioning cost.

Contoh buruk:

```sql
CREATE STREAM case_events (
  event_id VARCHAR KEY,
  case_id VARCHAR,
  event_type VARCHAR
) WITH (...);
```

Jika hampir semua query butuh per `case_id`, tetapi key adalah `event_id`, maka:

1. Event per case tersebar antar partition.
2. Ordering per case tidak terjamin.
3. Aggregation by case perlu repartition.
4. Join by case lebih mahal.
5. Materialized state by case butuh topic internal tambahan.

Contoh lebih tepat untuk case lifecycle:

```sql
CREATE STREAM case_events (
  case_id VARCHAR KEY,
  event_id VARCHAR,
  event_type VARCHAR,
  event_time VARCHAR
) WITH (...);
```

Rule:

```text
Key harus mengikuti unit ordering dan unit state utama.
```

Untuk enforcement lifecycle:

```text
case_id biasanya key utama.
```

Untuk payment processing:

```text
account_id cocok untuk state/account risk aggregation.
payment_id cocok untuk dedup/payment status.
merchant_id cocok untuk merchant-level metrics.
```

Tidak ada satu key yang cocok untuk semua query. Karena itu topic design dan derived topic penting.

---

## 20. Repartitioning: Apa yang Terjadi Saat Key Berubah

Jika query melakukan `GROUP BY` atau `JOIN` berdasarkan field yang bukan key/partition alignment, ksqlDB bisa membuat repartition topic internal.

Contoh:

```sql
CREATE TABLE case_count_by_officer AS
SELECT
  officer_id,
  COUNT(*) AS total_cases
FROM case_events
GROUP BY officer_id
EMIT CHANGES;
```

Jika input key adalah `case_id`, tetapi grouping berdasarkan `officer_id`, maka data harus di-shuffle:

```text
case_events keyed by case_id
        ↓ repartition by officer_id
internal repartition topic
        ↓ aggregate
case_count_by_officer table
```

Repartitioning bukan salah. Tetapi harus sadar konsekuensinya:

1. Ada topic internal tambahan.
2. Ada network I/O tambahan.
3. Ada storage tambahan.
4. Ada latency tambahan.
5. Ada failure surface tambahan.
6. Ada governance/observability tambahan.

Rule production:

```text
Repartitioning boleh, tetapi jangan tidak sadar.
```

---

## 21. Internal Topics

ksqlDB dapat membuat internal topics untuk:

1. Repartitioning.
2. Changelog state store.
3. Query state.
4. Aggregation materialization.

Nama internal topic biasanya terkait application/query id.

Masalah yang sering terjadi:

1. Internal topic dianggap “sampah” lalu dihapus manual.
2. Retention/compaction salah diubah.
3. ACL tidak memperbolehkan ksqlDB membuat topic internal.
4. Monitoring hanya melihat topic bisnis, bukan internal topic.
5. Storage penuh karena state/changelog topic membesar.

Rule:

```text
Internal topic ksqlDB adalah bagian dari state aplikasi stream processing.
Jangan dihapus kecuali kamu paham dampaknya.
```

---

## 22. ksqlDB Query Lifecycle

Saat kamu menjalankan statement seperti:

```sql
CREATE TABLE case_count_by_status AS
SELECT
  status,
  COUNT(*) AS count
FROM case_status_events
GROUP BY status
EMIT CHANGES;
```

Secara konseptual ksqlDB melakukan:

```text
SQL statement
  -> parse
  -> analyze schema
  -> logical plan
  -> physical plan
  -> generate Kafka Streams topology
  -> create/read topics
  -> run processing tasks
  -> maintain state store
  -> write output changelog/topic
```

Implikasi:

1. Query bukan magic SQL engine terpisah.
2. Query bergantung pada Kafka partitions.
3. Query punya state lokal jika stateful.
4. Query scale mengikuti partition/task model.
5. Query failure mengikuti Kafka Streams failure model.
6. Query bisa punya lag.
7. Query bisa rebalance.

---

## 23. ksqlDB Server, CLI, REST API, dan Java Client

Komponen deployment umum:

```text
ksqlDB server cluster
  - menerima SQL statements
  - menyimpan metadata query
  - menjalankan query runtime
  - expose REST API

ksqlDB CLI
  - developer/admin interface
  - mengirim SQL ke server

ksqlDB Java client
  - aplikasi Java mengirim query/command ke ksqlDB

Kafka cluster
  - menyimpan input/output/internal topics

Schema Registry
  - schema metadata bila memakai Avro/Protobuf/JSON Schema
```

CLI bukan engine. CLI hanya client.

REST API penting untuk:

1. Deploy query via automation.
2. Execute pull/push query.
3. Manage streams/tables.
4. Integrasi dengan platform tooling.

Namun production governance harus menghindari “manual query sprawl”. Persistent query sebaiknya dikelola seperti code/IaC:

```text
SQL file -> review -> CI validation -> deploy pipeline -> observe
```

---

## 24. Format Data dan Schema

ksqlDB bisa bekerja dengan berbagai format value, seperti JSON, Avro, Protobuf, dan JSON Schema, tergantung environment dan konfigurasi.

Perbedaan praktis:

| Format | Kelebihan | Risiko |
|---|---|---|
| JSON | Mudah dibaca, cepat mulai | Governance lemah bila tanpa schema |
| Avro | Compact, schema evolution kuat | Butuh Schema Registry dan discipline |
| Protobuf | Strong contract, cocok lintas bahasa | Evolusi field number perlu hati-hati |
| JSON Schema | Lebih human-readable dengan schema | Bisa verbose |

Untuk production multi-team, hindari JSON tanpa schema governance untuk event kontrak publik.

Contoh Avro-backed stream:

```sql
CREATE STREAM case_events WITH (
  KAFKA_TOPIC='case.events.v1',
  VALUE_FORMAT='AVRO'
);
```

Jika schema tersedia di Schema Registry, ksqlDB dapat infer kolom.

Tetapi jangan bergantung buta pada inference. Untuk kontrak penting, pahami:

1. Subject naming.
2. Key schema vs value schema.
3. Compatibility mode.
4. Field optional/default.
5. Breaking change.
6. Schema ownership.

---

## 25. Event Time, Processing Time, dan Timestamp

ksqlDB memproses event yang punya timestamp. Timestamp bisa berasal dari Kafka record timestamp atau field tertentu.

Kenapa penting?

1. Windowing membutuhkan event time.
2. Late event behavior bergantung timestamp.
3. Monitoring latency perlu membedakan event time vs ingestion time.
4. Regulatory reconstruction perlu waktu domain yang jelas.

Contoh deklarasi timestamp:

```sql
CREATE STREAM case_events (
  case_id VARCHAR KEY,
  event_type VARCHAR,
  event_ts BIGINT
) WITH (
  KAFKA_TOPIC='case.events.v1',
  VALUE_FORMAT='JSON',
  TIMESTAMP='event_ts'
);
```

Rule:

```text
Untuk domain event, usahakan punya event_time eksplisit dari domain.
Jangan hanya mengandalkan waktu broker menerima record.
```

Untuk Part 017, windowing belum didalami. Itu masuk Part 018. Tetapi fondasi timestamp harus sudah ada.

---

## 26. Example End-to-End: Case Lifecycle Mini Pipeline

Kita buat contoh kecil untuk konteks regulatory/case management.

### 26.1 Input Topic: Case Events

Event sample:

```json
{"case_id":"C-1001","event_id":"E-1","event_type":"CASE_OPENED","officer_id":"O-17","severity":"MEDIUM","event_ts":1781856000000}
{"case_id":"C-1001","event_id":"E-2","event_type":"CASE_ESCALATED","officer_id":"O-17","severity":"HIGH","event_ts":1781856600000}
{"case_id":"C-1002","event_id":"E-3","event_type":"CASE_OPENED","officer_id":"O-20","severity":"LOW","event_ts":1781856900000}
```

### 26.2 Declare Stream

```sql
CREATE STREAM case_events (
  case_id VARCHAR KEY,
  event_id VARCHAR,
  event_type VARCHAR,
  officer_id VARCHAR,
  severity VARCHAR,
  event_ts BIGINT
) WITH (
  KAFKA_TOPIC='case.events.v1',
  VALUE_FORMAT='JSON',
  TIMESTAMP='event_ts'
);
```

### 26.3 Derive Escalation Stream

```sql
CREATE STREAM case_escalations
WITH (
  KAFKA_TOPIC='case.escalations.v1',
  VALUE_FORMAT='JSON'
) AS
SELECT
  case_id,
  event_id,
  officer_id,
  severity,
  event_ts
FROM case_events
WHERE event_type = 'CASE_ESCALATED'
EMIT CHANGES;
```

### 26.4 Build Current Case Status Table

Misalnya event stream punya event type yang bisa dimapping menjadi status.

```sql
CREATE TABLE case_current_status AS
SELECT
  case_id,
  LATEST_BY_OFFSET(event_type) AS latest_event_type,
  LATEST_BY_OFFSET(officer_id) AS current_officer_id,
  LATEST_BY_OFFSET(severity) AS current_severity,
  LATEST_BY_OFFSET(event_ts) AS last_event_ts
FROM case_events
GROUP BY case_id
EMIT CHANGES;
```

Catatan penting:

1. `LATEST_BY_OFFSET` berarti latest berdasarkan offset processing, bukan otomatis event-time semantic sempurna.
2. Jika event bisa datang out-of-order, status reconstruction harus dirancang lebih hati-hati.
3. Untuk regulatory lifecycle, kamu sering butuh state machine validation di aplikasi domain, bukan hanya `LATEST_BY_OFFSET`.

### 26.5 Pull Query Current Status

```sql
SELECT
  case_id,
  latest_event_type,
  current_officer_id,
  current_severity,
  last_event_ts
FROM case_current_status
WHERE case_id = 'C-1001';
```

### 26.6 Push Query Escalation Monitoring

```sql
SELECT
  case_id,
  officer_id,
  severity,
  event_ts
FROM case_escalations
EMIT CHANGES;
```

Pipeline mental model:

```text
case.events.v1
  -> case_events STREAM
  -> persistent query filter
  -> case.escalations.v1

case.events.v1
  -> aggregate by case_id
  -> case_current_status TABLE
  -> pull query by case_id
```

---

## 27. Example End-to-End: Payment Risk Enrichment

### 27.1 Streams and Tables

Payment stream:

```sql
CREATE STREAM payments (
  payment_id VARCHAR KEY,
  account_id VARCHAR,
  merchant_id VARCHAR,
  amount DECIMAL(12,2),
  currency VARCHAR,
  status VARCHAR,
  event_ts BIGINT
) WITH (
  KAFKA_TOPIC='payments.v1',
  VALUE_FORMAT='AVRO',
  TIMESTAMP='event_ts'
);
```

Account risk table:

```sql
CREATE TABLE account_risk (
  account_id VARCHAR PRIMARY KEY,
  risk_level VARCHAR,
  risk_score INT,
  updated_at BIGINT
) WITH (
  KAFKA_TOPIC='account.risk.current.v1',
  VALUE_FORMAT='AVRO'
);
```

### 27.2 Enrichment

```sql
CREATE STREAM enriched_payments
WITH (
  KAFKA_TOPIC='payments.enriched.v1',
  VALUE_FORMAT='AVRO'
) AS
SELECT
  p.payment_id,
  p.account_id,
  p.merchant_id,
  p.amount,
  p.currency,
  p.status,
  r.risk_level,
  r.risk_score,
  p.event_ts
FROM payments p
LEFT JOIN account_risk r
  ON p.account_id = r.account_id
EMIT CHANGES;
```

Important nuance:

```text
Setiap payment diperkaya dengan account_risk yang diketahui pada saat processing.
```

Jika risk profile datang terlambat setelah payment diproses, enrichment historis tidak otomatis berubah kecuali desainnya table-table/materialized atau reprocessing.

---

## 28. Java Engineer Perspective

Sebagai Java engineer, cara berpikir yang tepat:

```text
ksqlDB persistent query = aplikasi Kafka Streams yang dihasilkan dari SQL.
```

Jadi pertanyaan production-nya mirip aplikasi stream processing:

1. Apa input topic-nya?
2. Apa output topic-nya?
3. Apa key input/output-nya?
4. Apakah query stateless atau stateful?
5. Apakah ada repartition?
6. Apakah ada join?
7. Apakah ada state store?
8. Apakah ada changelog topic?
9. Bagaimana schema evolution-nya?
10. Bagaimana monitoring lag/throughput/error-nya?
11. Bagaimana query dideploy/rollback?
12. Bagaimana recovery jika output salah?

Jangan hanya bertanya:

```text
SQL-nya jalan atau tidak?
```

Tanyakan:

```text
Topology apa yang sebenarnya dibuat?
Failure mode apa yang muncul?
Kontrak data apa yang dihasilkan?
```

---

## 29. ksqlDB vs Kafka Streams: Decision Matrix

| Kebutuhan | ksqlDB | Kafka Streams |
|---|---:|---:|
| Filter/projection sederhana | Sangat cocok | Cocok tapi mungkin overkill |
| Aggregate sederhana | Cocok | Cocok |
| Join umum | Cocok, selama semantics dipahami | Cocok dengan kontrol lebih besar |
| Logic domain kompleks | Kurang cocok | Lebih cocok |
| Integrasi dengan Java domain model | Terbatas | Kuat |
| Custom error handling kompleks | Terbatas | Lebih fleksibel |
| Advanced testing deterministik | Ada, tapi lebih terbatas | Sangat kuat via TopologyTestDriver |
| Governance SQL pipeline | Cocok | Butuh code governance biasa |
| Developer SQL-first | Sangat cocok | Kurang cocok |
| Performance tuning granular | Terbatas | Lebih granular |
| Stateful app kompleks | Bisa, tapi hati-hati | Lebih cocok |

Rule praktis:

```text
Gunakan ksqlDB untuk pipeline deklaratif yang stabil, jelas, dan bisa diekspresikan natural dengan SQL.
Gunakan Kafka Streams jika business logic, state model, error handling, testing, atau lifecycle terlalu kompleks untuk SQL.
```

---

## 30. ksqlDB vs Kafka Connect

Kafka Connect memindahkan data antara Kafka dan sistem eksternal.

ksqlDB memproses data yang sudah berada di Kafka.

Contoh kombinasi:

```text
PostgreSQL CDC via Debezium Connect
  -> Kafka topics
  -> ksqlDB transform/enrich/aggregate
  -> Kafka topic curated
  -> Sink Connect to Elasticsearch/S3
```

Jangan pakai ksqlDB untuk menggantikan connector source/sink standard jika connector sudah ada.

Contoh salah:

```text
Custom ksqlDB trick untuk polling database.
```

Lebih tepat:

```text
Kafka Connect JDBC Source atau Debezium CDC.
```

---

## 31. ksqlDB vs Database SQL

Walaupun memakai SQL-like syntax, ksqlDB berbeda dari SQL database tradisional.

| Aspek | SQL Database | ksqlDB |
|---|---|---|
| Data model | Finite tables | Infinite streams + materialized tables |
| Query | Biasanya selesai | Bisa berjalan terus |
| Storage utama | Database storage engine | Kafka topics + state stores |
| Mutation | INSERT/UPDATE/DELETE transactional | Event/changelog processing |
| Join | Query-time over stored tables | Stream-time join semantics |
| Consistency | DB transaction/isolation | Kafka ordering + processing semantics |
| Workload | OLTP/OLAP tergantung DB | Stream processing |

Kesalahan umum:

```sql
SELECT * FROM huge_stream WHERE arbitrary_field = 'x';
```

Lalu berharap seperti indexed relational database.

ksqlDB bukan dirancang untuk arbitrary indexed lookup di semua field. Untuk lookup, desain materialized table dengan key yang benar.

---

## 32. Production Design Questions Sebelum Membuat Query

Sebelum membuat stream/table/query, jawab:

1. Apa business purpose query ini?
2. Apakah query ini ad-hoc, monitoring, atau pipeline permanen?
3. Apa input topic dan owner-nya?
4. Apa schema input dan compatibility policy-nya?
5. Apa output topic dan owner-nya?
6. Apa key input?
7. Apa key output?
8. Apakah query mengubah key?
9. Apakah query memicu repartition?
10. Apakah query stateful?
11. Berapa retention output topic?
12. Apakah output topic public contract atau private derived topic?
13. Apakah ada DLQ/error strategy?
14. Bagaimana observability-nya?
15. Bagaimana rollback jika logic salah?
16. Bagaimana backfill/reprocessing jika perlu?
17. Bagaimana akses ACL-nya?
18. Apakah query bisa diuji dengan sample events?
19. Apakah hasilnya deterministic untuk event out-of-order?
20. Apakah ksqlDB memang tool yang tepat?

---

## 33. Failure Modes

### 33.1 Salah Key

Gejala:

1. Join tidak menghasilkan data.
2. Aggregate salah.
3. Pull query tidak menemukan row.
4. Repartition internal membengkak.

Penyebab:

```text
Logical key di ksqlDB tidak sama dengan Kafka key fisik atau tidak sesuai unit state.
```

Mitigasi:

1. Inspect key/value topic.
2. Desain key dari awal.
3. Buat derived stream dengan repartition eksplisit jika perlu.
4. Dokumentasikan key contract.

### 33.2 Mengira Push Query adalah Production Pipeline

Gejala:

1. Query berhenti saat client disconnect.
2. Output tidak tersimpan sebagai topic baru.
3. Downstream kehilangan data.

Mitigasi:

```text
Gunakan CSAS/CTAS untuk pipeline permanen.
```

### 33.3 Pull Query Dipakai seperti Database General-Purpose

Gejala:

1. Query lambat/gagal.
2. Tidak bisa filter arbitrary field.
3. Serving API tidak scalable.

Mitigasi:

1. Materialize view sesuai access pattern.
2. Key-based lookup.
3. Sink ke database/search engine jika butuh query flexible.

### 33.4 Internal Topic Dihapus

Gejala:

1. Query gagal restart.
2. State hilang.
3. Reprocessing besar-besaran.
4. Output duplicate/inconsistent.

Mitigasi:

1. Jangan hapus internal topic sembarangan.
2. Kelola ACL dan retention dengan hati-hati.
3. Pahami topology sebelum cleanup.

### 33.5 Schema Evolution Merusak Query

Gejala:

1. Query gagal deserialize.
2. Field null unexpectedly.
3. Persistent query berhenti.
4. Output schema incompatible dengan downstream.

Mitigasi:

1. Pakai Schema Registry compatibility.
2. Test schema evolution.
3. Hindari breaking change tanpa versioning.
4. Treat output ksqlDB sebagai kontrak.

### 33.6 Late/Out-of-Order Events Menghasilkan State Salah

Gejala:

1. Latest status mundur.
2. Aggregation window berubah tidak sesuai ekspektasi.
3. Audit reconstruction beda dari domain truth.

Mitigasi:

1. Pahami event-time semantics.
2. Jangan pakai `LATEST_BY_OFFSET` jika domain membutuhkan event-time ordering ketat.
3. Validasi lifecycle di domain service/state machine bila perlu.
4. Bahas lebih dalam di Part 018.

---

## 34. Anti-Patterns

### Anti-Pattern 1 — “ksqlDB adalah PostgreSQL untuk Kafka”

Salah. ksqlDB adalah stream processing database, bukan OLTP relational database.

### Anti-Pattern 2 — Membuat Semua Topic Menjadi STREAM Tanpa Memikirkan TABLE

Jika data merepresentasikan latest state per key, TABLE mungkin lebih tepat.

### Anti-Pattern 3 — Membuat TABLE dari Topic Tanpa Key yang Benar

TABLE tanpa key yang benar akan menghasilkan state yang salah.

### Anti-Pattern 4 — `SELECT *` untuk Kontrak Publik

Output topic publik harus eksplisit field-nya.

Buruk:

```sql
CREATE STREAM output AS
SELECT * FROM input
EMIT CHANGES;
```

Lebih baik:

```sql
CREATE STREAM output AS
SELECT
  case_id,
  event_type,
  event_time
FROM input
EMIT CHANGES;
```

### Anti-Pattern 5 — Query Sprawl

Banyak persistent query dibuat manual dari CLI tanpa ownership, naming, monitoring, atau lifecycle.

### Anti-Pattern 6 — Mengabaikan Repartition Topic

Repartition bukan gratis. Ia adalah shuffle dengan cost.

### Anti-Pattern 7 — Tidak Membedakan Debug Query dan Production Query

Debug query boleh ad-hoc. Production query harus versioned, reviewed, observable.

### Anti-Pattern 8 — ksqlDB untuk Workflow Domain Kompleks

Jika butuh state machine, compensation, human approval, SLA branching, permission checks, dan audit decision logic kompleks, gunakan service domain/orchestrator. ksqlDB bisa membantu projection/enrichment, bukan menggantikan seluruh workflow engine.

---

## 35. Practical Naming Convention

Contoh naming object ksqlDB:

```text
STREAM case_events_raw
STREAM case_events_validated
STREAM case_escalations
TABLE  case_current_status
TABLE  case_count_by_status
```

Contoh naming topic:

```text
case.events.v1
case.escalations.v1
case.status.current.v1
case.metrics.status-count.v1
```

Rule:

1. Bedakan object ksqlDB dan Kafka topic.
2. Jangan beri nama terlalu generic.
3. Sertakan domain.
4. Sertakan semantic purpose.
5. Gunakan versioning untuk kontrak publik.
6. Jangan expose internal/intermediate topic tanpa sengaja.

---

## 36. Deployment and Lifecycle Thinking

Persistent query harus dikelola seperti artifact produksi.

Minimal lifecycle:

```text
Design
  -> SQL review
  -> sample event test
  -> schema compatibility check
  -> deploy to dev
  -> validate output topic
  -> deploy staging
  -> load/lag observation
  -> deploy production
  -> monitor
  -> evolve/deprecate
```

Checklist deploy:

1. Input topic exists.
2. Output topic naming approved.
3. Key semantics documented.
4. Schema compatibility verified.
5. ACL configured.
6. Internal topic creation allowed.
7. Query ID known.
8. Lag metrics available.
9. Error handling strategy known.
10. Rollback plan available.

---

## 37. Observability Basics untuk ksqlDB

Untuk Part 017, cukup pegang baseline ini:

1. Persistent query punya lag.
2. Query bisa gagal deserialize.
3. Query bisa berhenti/error.
4. State store bisa membesar.
5. Internal topic bisa menumpuk data.
6. Rebalance bisa terjadi.
7. Output topic harus dimonitor seperti topic biasa.
8. Pull query latency bergantung state/query routing.
9. Push query connection bisa terputus.

Metric yang perlu diamati:

```text
consumer lag per query
processing rate
error rate
deserialization failure
state store size
RocksDB/state metrics jika tersedia
internal topic size
output throughput
end-to-end latency
```

---

## 38. Security and Governance Basics

ksqlDB perlu permission untuk:

1. Membaca input topic.
2. Menulis output topic.
3. Membuat internal topic.
4. Membaca/menulis consumer group.
5. Mengakses Schema Registry.
6. Menjalankan query via REST/CLI.

Governance minimal:

1. Batasi siapa yang boleh membuat persistent query.
2. Audit statement yang dijalankan.
3. Pisahkan dev/staging/prod.
4. Jangan expose ksqlDB REST API tanpa kontrol.
5. Terapkan ACL topic.
6. Terapkan schema compatibility.
7. Review output topic sebagai data contract.

---

## 39. ksqlDB untuk Regulatory/Case Management

ksqlDB sangat berguna untuk read model/projection di sistem case management.

Contoh cocok:

1. Current case status by case id.
2. Count open cases by officer.
3. Escalation stream by severity.
4. SLA breach candidate stream.
5. Daily event count by case type.
6. Enrichment case event dengan officer/unit reference table.
7. Projection untuk dashboard real-time.
8. Filter event sensitif untuk downstream khusus.

Namun hati-hati:

1. Jangan menjadikan ksqlDB sebagai source of truth lifecycle state jika domain transition butuh validasi kompleks.
2. Jangan melakukan keputusan enforcement final hanya dengan query sederhana tanpa domain guardrail.
3. Jangan menghapus audit event; gunakan derived projection jika perlu masking/redaction.
4. Jangan mengandalkan `latest by offset` bila hukum/prosedur butuh event-time causal reconstruction.

Pola yang sehat:

```text
Domain service/state machine
  -> emits defensible domain events
  -> Kafka
  -> ksqlDB builds projections/alerts/materialized views
  -> downstream dashboard/search/reporting
```

---

## 40. Hands-On Mini Lab

### Goal

Membuat stream event case, filter escalation, materialize latest status, lalu query current state.

### Step 1 — Create Stream

```sql
CREATE STREAM case_events (
  case_id VARCHAR KEY,
  event_id VARCHAR,
  event_type VARCHAR,
  officer_id VARCHAR,
  severity VARCHAR,
  event_ts BIGINT
) WITH (
  KAFKA_TOPIC='case.events.v1',
  VALUE_FORMAT='JSON',
  PARTITIONS=6,
  TIMESTAMP='event_ts'
);
```

### Step 2 — Inspect Stream

```sql
SELECT *
FROM case_events
EMIT CHANGES;
```

Gunakan ini hanya untuk observasi/debug.

### Step 3 — Create Persistent Escalation Stream

```sql
CREATE STREAM case_escalations
WITH (
  KAFKA_TOPIC='case.escalations.v1',
  VALUE_FORMAT='JSON',
  PARTITIONS=6
) AS
SELECT
  case_id,
  event_id,
  officer_id,
  severity,
  event_ts
FROM case_events
WHERE event_type = 'CASE_ESCALATED'
EMIT CHANGES;
```

### Step 4 — Create Current Status Table

```sql
CREATE TABLE case_current_status
WITH (
  KAFKA_TOPIC='case.current-status.v1',
  VALUE_FORMAT='JSON'
) AS
SELECT
  case_id,
  LATEST_BY_OFFSET(event_type) AS latest_event_type,
  LATEST_BY_OFFSET(officer_id) AS current_officer_id,
  LATEST_BY_OFFSET(severity) AS current_severity,
  LATEST_BY_OFFSET(event_ts) AS last_event_ts
FROM case_events
GROUP BY case_id
EMIT CHANGES;
```

### Step 5 — Pull Query

```sql
SELECT *
FROM case_current_status
WHERE case_id = 'C-1001';
```

### Step 6 — Questions to Ask

1. Apa key input stream?
2. Apakah aggregation memerlukan repartition?
3. Apa topic output dari `case_escalations`?
4. Apa topic output dari `case_current_status`?
5. Apakah `LATEST_BY_OFFSET` cukup untuk regulatory correctness?
6. Apa yang terjadi jika event lama datang terlambat?
7. Apakah output topic adalah kontrak publik?
8. Siapa owner schema output?

---

## 41. Design Trade-Offs

### 41.1 SQL Simplicity vs Java Control

ksqlDB memudahkan ekspresi pipeline sederhana. Tetapi Java/Kafka Streams memberi kontrol lebih besar.

Trade-off:

```text
ksqlDB: faster to express, easier for SQL-capable teams, less boilerplate.
Kafka Streams: richer control, better for complex domain logic, easier custom testing.
```

### 41.2 Materialized View vs External Read Store

ksqlDB table bisa dipakai untuk pull query, tetapi tidak selalu cocok sebagai serving layer utama.

Gunakan ksqlDB pull query jika:

1. Lookup sederhana by key.
2. Throughput read masuk akal.
3. Query pattern terbatas.
4. Data freshness streaming penting.

Gunakan external store jika:

1. Butuh flexible search/filter.
2. Butuh pagination kompleks.
3. Butuh relational joins ad-hoc.
4. Butuh serving SLA/API publik tinggi.
5. Butuh query multi-dimensional.

### 41.3 Repartition vs Pre-Keyed Topic

Jika query utama selalu butuh key tertentu, lebih baik producer/topic awal didesain dengan key itu.

Namun jika banyak access pattern berbeda, derived repartition topic mungkin wajar.

### 41.4 ksqlDB as Shared Platform vs App-Owned Runtime

Dua model:

```text
Central ksqlDB cluster shared by many teams
App/team-specific ksqlDB deployment
```

Shared cluster:

1. Lebih efisien.
2. Butuh governance kuat.
3. Risiko noisy neighbor.

App-specific:

1. Ownership jelas.
2. Isolasi lebih baik.
3. Operasional lebih banyak.

---

## 42. Checklist Pemahaman

Kamu memahami Part 017 jika bisa menjawab:

1. Apa beda `STREAM` dan `TABLE`?
2. Apa beda persistent query, push query, dan pull query?
3. Mengapa `CREATE STREAM AS SELECT` menghasilkan persistent query?
4. Mengapa `CREATE TABLE AS SELECT` biasanya menghasilkan materialized state?
5. Mengapa key sangat penting di ksqlDB?
6. Apa itu repartition topic?
7. Mengapa push query bukan production pipeline?
8. Mengapa pull query bukan pengganti SQL database umum?
9. Apa hubungan ksqlDB dengan Kafka Streams?
10. Kapan lebih baik memakai Kafka Streams daripada ksqlDB?
11. Kapan lebih baik memakai Kafka Connect daripada ksqlDB?
12. Apa risiko menggunakan `LATEST_BY_OFFSET` untuk lifecycle state?
13. Apa yang harus dimonitor dari persistent query?
14. Apa governance minimal sebelum output topic dipakai downstream?

---

## 43. Ringkasan

ksqlDB adalah layer stream processing berbasis SQL di atas Kafka. Ia memungkinkan developer membuat transformasi, filter, join, aggregate, dan materialized view tanpa menulis aplikasi Kafka Streams manual.

Mental model utama:

```text
STREAM = event history
TABLE = current state per key
Persistent query = pipeline server-side yang terus berjalan
Push query = subscription real-time ke perubahan
Pull query = request-response lookup terhadap materialized state
```

Hal paling penting:

1. Jangan tertipu oleh SQL syntax; ksqlDB tetap stream processing.
2. Key menentukan correctness, ordering, join, aggregate, dan lookup.
3. Persistent query harus dikelola seperti aplikasi production.
4. Push query cocok untuk subscribe/debug/monitoring, bukan pipeline permanen.
5. Pull query cocok untuk key-based materialized lookup, bukan arbitrary OLTP/OLAP query.
6. ksqlDB memakai Kafka Streams di belakang layar, sehingga topology, partition, state, changelog, repartition, dan failure mode tetap relevan.
7. Untuk domain logic kompleks, Kafka Streams atau service domain sering lebih tepat.
8. Untuk integrasi source/sink, Kafka Connect biasanya lebih tepat.
9. Untuk regulatory/case management, ksqlDB sangat berguna sebagai projection/read model/alerting layer, bukan pengganti domain state machine.

---

## 44. Latihan Berpikir

### Exercise 1 — Stream or Table?

Klasifikasikan data berikut sebagai STREAM atau TABLE:

1. `CASE_OPENED`, `CASE_ASSIGNED`, `CASE_ESCALATED`.
2. Current officer assigned per case.
3. Merchant profile.
4. Payment authorization attempts.
5. Latest risk score per account.
6. Audit log decision events.

Jawaban yang diharapkan:

```text
1. STREAM
2. TABLE
3. TABLE
4. STREAM
5. TABLE
6. STREAM
```

### Exercise 2 — Query Type

Untuk kebutuhan berikut, pilih persistent/push/pull:

1. Membuat topic `failed_payments.v1` dari semua payment gagal.
2. Dashboard sementara untuk melihat case escalation real-time.
3. API internal membaca current case status by case id.
4. Aggregate count open cases by officer yang harus tersedia terus.

Jawaban:

```text
1. Persistent query
2. Push query
3. Pull query
4. Persistent query + pull query jika perlu serving current aggregate
```

### Exercise 3 — Key Design

Jika input `case_events` keyed by `event_id`, tetapi semua query penting by `case_id`, apa konsekuensinya?

Jawaban:

1. Ordering per case tidak terjamin.
2. Aggregation by case butuh repartition.
3. Join by case lebih mahal/sulit.
4. Pull query current status by case membutuhkan derived materialization.
5. Topic awal mungkin salah key untuk domain lifecycle.

### Exercise 4 — Tool Choice

Pilih tool terbaik:

1. CDC dari PostgreSQL ke Kafka.
2. Enrich payment events dengan account risk table.
3. Complex fraud engine dengan model Java, cache custom, dan fallback API.
4. Sink curated topic ke S3.
5. Materialized count by status untuk dashboard.

Jawaban:

```text
1. Kafka Connect/Debezium
2. ksqlDB atau Kafka Streams
3. Kafka Streams/custom service
4. Kafka Connect sink
5. ksqlDB cocok
```

---

## 45. Apa yang Akan Masuk Part 018

Part 018 akan masuk ke ksqlDB advanced:

1. Stream-stream join.
2. Stream-table join.
3. Table-table join.
4. Inner/left/outer semantics.
5. Event time vs processing time.
6. Tumbling window.
7. Hopping window.
8. Session window.
9. Grace period.
10. Late events.
11. Suppression.
12. Repartition topic.
13. Changelog topic.
14. State store.
15. Query explain/debugging.

Part 017 memberi fondasi. Part 018 akan membahas correctness semantics yang lebih tajam, terutama agar hasil query tidak “terlihat benar” tetapi salah secara domain.

---

## 46. Status Seri

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
Part 009 — selesai
Part 010 — selesai
Part 011 — selesai
Part 012 — selesai
Part 013 — selesai
Part 014 — selesai
Part 015 — selesai
Part 016 — selesai
Part 017 — selesai
Part 018 — berikutnya
...
Part 034 — belum selesai
```

Seri belum selesai. Masih ada Part 018 sampai Part 034.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-016.md">⬅️ Part 016 — CDC with Kafka: Database Logs, Debezium Mental Model, Outbox, and Ordering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-018.md">Part 018 — ksqlDB Advanced: Joins, Windows, Aggregations, Repartitioning, and State ➡️</a>
</div>

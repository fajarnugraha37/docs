# learn-kafka-event-streaming-mastery-for-java-engineers-part-014.md

# Part 014 — Kafka Connect Fundamentals: Source, Sink, Workers, Tasks, Converters

> Seri: Kafka, Kafka ksqlDB, Kafka Connect, dan Event Streaming Mastery untuk Java Software Engineer  
> Bagian: 014 dari 034  
> Status seri: belum selesai  
> Fokus: memahami Kafka Connect sebagai runtime integrasi data yang reusable, scalable, dan operasional, bukan sekadar tool import/export.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 013, kita sudah membangun fondasi Kafka dari bawah:

1. Kafka sebagai distributed commit log.
2. Topic, partition, offset, ordering, dan retention.
3. Broker internals: segment, page cache, replication, high watermark.
4. KRaft, controller quorum, metadata log.
5. Producer internals.
6. Partitioning strategy.
7. Consumer poll loop dan offset management.
8. Consumer group dan rebalancing.
9. Delivery semantics.
10. Event design.
11. Serialization dan schema governance.
12. Topic governance.
13. Security.

Sekarang kita masuk ke **Kafka Connect**.

Kafka Connect adalah bagian dari Kafka ecosystem yang sering terlihat “mudah” karena konfigurasinya deklaratif. Tetapi dalam production, Connect bisa menjadi salah satu komponen paling kritis karena ia berada di batas antara Kafka dan sistem eksternal: database, object storage, search engine, SaaS API, warehouse, cache, file system, mainframe bridge, dan sistem legacy.

Mental model utama Part 014:

```text
Kafka Connect adalah runtime standar untuk menjalankan connector yang memindahkan data
antara Kafka dan sistem eksternal, dengan manajemen task, offset, config, status,
serialization boundary, transform ringan, error handling, dan deployment lifecycle.
```

Apache Kafka mendeskripsikan Kafka Connect API sebagai API untuk membangun dan menjalankan reusable connector yang mengonsumsi atau memproduksi stream event dari dan ke external systems. Dalam praktik, banyak connector siap pakai tersedia sehingga engineer sering tidak perlu menulis connector sendiri.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Menjelaskan **mengapa Kafka Connect ada** dan masalah apa yang diselesaikannya.
2. Membedakan **source connector** dan **sink connector**.
3. Memahami komponen inti: **connector, task, worker, converter, transform, internal topic**.
4. Menjelaskan perbedaan **standalone mode** dan **distributed mode**.
5. Memahami bagaimana Connect menyimpan **config, offset, dan status**.
6. Memahami batas antara **converter**, **serializer**, dan **schema registry**.
7. Menggunakan Single Message Transform secara benar tanpa mengubah Connect menjadi stream processing engine.
8. Memahami error handling dasar: fail-fast, tolerate, DLQ.
9. Mengetahui kapan memakai Connect dan kapan lebih baik menulis custom producer/consumer.
10. Mampu mendesain connector deployment secara production-minded.

---

## 2. Masalah yang Diselesaikan Kafka Connect

Bayangkan kamu punya beberapa kebutuhan berikut:

1. Ambil perubahan dari PostgreSQL dan kirim ke Kafka.
2. Tulis event Kafka ke Elasticsearch/OpenSearch.
3. Simpan event Kafka ke S3/object storage sebagai file Parquet/JSON/Avro.
4. Ambil data dari SaaS API lalu publish ke Kafka.
5. Sink event dari Kafka ke JDBC database.
6. Stream audit event dari application topic ke data lake.
7. Copy metric/event dari legacy system ke Kafka.

Tanpa Kafka Connect, pendekatan umum adalah menulis service sendiri:

```text
External System -> Custom Producer -> Kafka
Kafka -> Custom Consumer -> External System
```

Untuk satu integrasi, ini tampak wajar. Tetapi saat integrasi menjadi banyak, kamu akan mengulang hal yang sama berkali-kali:

1. Connection handling.
2. Retry.
3. Offset/checkpoint.
4. Serialization.
5. Schema evolution.
6. Error handling.
7. Backpressure.
8. Parallelism.
9. Scaling.
10. Monitoring.
11. Reconfiguration.
12. Deployment.
13. Credential management.
14. Dead letter handling.
15. Graceful shutdown.

Kafka Connect dibuat untuk menstandarkan bagian-bagian generik ini.

Mental model:

```text
Custom integration service = kamu menulis runtime + business/integration logic.
Kafka Connect = runtime disediakan; kamu memilih connector + konfigurasi.
```

Ini bukan berarti Connect selalu lebih baik. Tetapi untuk banyak kasus integrasi data standar, Connect mengurangi boilerplate dan membuat operasional lebih konsisten.

---

## 3. Kafka Connect sebagai Runtime, Bukan Sekadar Library

Untuk Java engineer, penting membedakan:

```text
Kafka Producer API      -> library untuk mengirim record ke Kafka.
Kafka Consumer API      -> library untuk membaca record dari Kafka.
Kafka Streams API       -> library Java untuk stream processing.
Kafka Connect           -> runtime/framework untuk connector integration.
```

Kafka Connect bukan sekadar dependency yang kamu import ke aplikasi bisnis biasa. Biasanya Connect berjalan sebagai proses/service tersendiri:

```text
+-------------------+          +-------------------+
| External System   | <------> | Kafka Connect     |
| DB/API/S3/Search  |          | Workers + Tasks   |
+-------------------+          +---------+---------+
                                      |
                                      v
                                +------------+
                                | Kafka      |
                                | Cluster    |
                                +------------+
```

Connector plugin berjalan di dalam worker process Connect. Worker mengelola lifecycle connector dan task.

Analogi:

```text
Kafka Connect worker = application server untuk connector plugin.
Connector plugin     = aplikasi integrasi yang dideklarasikan via config.
Task                 = unit kerja paralel yang benar-benar membaca/menulis data.
```

---

## 4. Source Connector vs Sink Connector

Kafka Connect punya dua arah utama.

### 4.1 Source Connector

Source connector mengambil data dari external system lalu menulisnya ke Kafka.

```text
External System -> Kafka Connect Source -> Kafka Topic
```

Contoh:

```text
PostgreSQL CDC      -> Kafka
MySQL CDC           -> Kafka
JDBC polling        -> Kafka
SaaS API            -> Kafka
File directory      -> Kafka
MQ system           -> Kafka
```

Source connector biasanya bertanggung jawab untuk:

1. Mengambil data dari source.
2. Mengubah data menjadi `SourceRecord`.
3. Menentukan topic tujuan.
4. Menentukan key dan value.
5. Menyimpan source offset/checkpoint.
6. Menghasilkan record ke Kafka melalui Connect framework.

Pseudomodel:

```java
while (running) {
    List<SourceRecord> records = pollExternalSystem();
    connectFramework.sendToKafka(records);
    connectFramework.storeSourceOffsets(records);
}
```

Source connector tidak langsung memakai `KafkaProducer` dengan cara yang sama seperti aplikasi biasa; Connect framework yang menangani banyak aspek pengiriman.

### 4.2 Sink Connector

Sink connector membaca data dari Kafka lalu menulisnya ke external system.

```text
Kafka Topic -> Kafka Connect Sink -> External System
```

Contoh:

```text
Kafka -> S3/Object Storage
Kafka -> Elasticsearch/OpenSearch
Kafka -> JDBC Database
Kafka -> Data Warehouse
Kafka -> Redis/Cache
Kafka -> File
Kafka -> HTTP endpoint
```

Sink connector biasanya bertanggung jawab untuk:

1. Subscribe ke topic Kafka.
2. Menerima `SinkRecord` dari Connect framework.
3. Menulis record ke external system.
4. Mengelola batch write.
5. Melaporkan sukses/gagal.
6. Membiarkan Connect mengelola offset commit Kafka.

Pseudomodel:

```java
while (running) {
    Collection<SinkRecord> records = connectFramework.pollKafka();
    connector.writeToExternalSystem(records);
    connectFramework.commitKafkaOffsetsWhenSafe();
}
```

### 4.3 Perbedaan Risiko Source dan Sink

Source connector berisiko:

1. Duplicate ingestion dari source.
2. Missing data jika source offset salah.
3. Snapshot/streaming boundary error.
4. Source throttling.
5. Schema drift dari source.

Sink connector berisiko:

1. Duplicate write ke target.
2. Partial batch write.
3. Target throttling.
4. Target schema mismatch.
5. Offset committed sebelum side effect aman.
6. Poison record menghentikan pipeline.

Pattern penting:

```text
Source correctness = apakah semua data source masuk Kafka tanpa gap yang tidak disadari?
Sink correctness   = apakah side effect ke target aman terhadap retry dan duplicate?
```

---

## 5. Connector, Task, Worker: Tiga Konsep Paling Penting

### 5.1 Connector

Connector adalah logical job.

Contoh:

```json
{
  "name": "orders-jdbc-source",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "connection.url": "jdbc:postgresql://db:5432/app",
    "mode": "timestamp+incrementing",
    "topic.prefix": "db.orders."
  }
}
```

Connector menjawab:

```text
Integrasi apa yang ingin dijalankan?
Source/sink mana?
Konfigurasinya apa?
Berapa task paralel?
Topic mana?
Converter apa?
Transform apa?
Error handling apa?
```

Connector bukan selalu unit eksekusi tunggal. Connector dapat membuat beberapa task.

### 5.2 Task

Task adalah unit kerja paralel.

```text
Connector = job definition.
Task      = executable shard of work.
```

Contoh:

```text
S3 sink connector membaca topic dengan 12 partition.
Connector bisa membuat 4 task.
Masing-masing task menangani subset partition.
```

Task memungkinkan scaling.

Namun `tasks.max` bukan tombol ajaib. Parallelism aktual tergantung connector dan sumber/target:

1. Jumlah partition topic untuk sink.
2. Jumlah table/query/split untuk source.
3. Batas API external system.
4. Connector implementation.
5. Worker capacity.
6. Target write throughput.

Contoh:

```properties
tasks.max=8
```

Artinya connector boleh membuat hingga 8 task. Bukan jaminan selalu ada 8 task efektif.

### 5.3 Worker

Worker adalah proses Kafka Connect.

Worker menjalankan connector dan task.

```text
+---------------------+
| Connect Worker JVM  |
|---------------------|
| Connector plugin A  |
| Task A-0            |
| Task A-1            |
| Connector plugin B  |
| Task B-0            |
+---------------------+
```

Dalam distributed mode, beberapa worker membentuk worker group:

```text
+-------------+     +-------------+     +-------------+
| Worker 1    |     | Worker 2    |     | Worker 3    |
| Task A-0    |     | Task A-1    |     | Task B-0    |
+-------------+     +-------------+     +-------------+
        \              |              /
         \             |             /
          +-------------------------+
          | Kafka Cluster           |
          | config/offset/status    |
          +-------------------------+
```

Worker group melakukan assignment task ke worker. Jika worker mati, task dipindahkan ke worker lain.

---

## 6. Standalone Mode vs Distributed Mode

Kafka Connect punya dua mode utama.

### 6.1 Standalone Mode

Standalone mode menjalankan connector dalam satu proses worker. Config dan offset biasanya disimpan lokal/file tergantung konfigurasi.

Cocok untuk:

1. Development lokal.
2. Eksperimen.
3. POC kecil.
4. Single connector sederhana.
5. Debugging plugin.

Tidak ideal untuk production karena:

1. Tidak ada worker group HA.
2. Scaling terbatas.
3. Recovery lebih manual.
4. Offset/config/status tidak sekuat distributed mode.
5. Rolling operation tidak nyaman.

Mental model:

```text
Standalone = satu JVM, satu worker, cocok untuk belajar dan eksperimen.
```

### 6.2 Distributed Mode

Distributed mode menjalankan beberapa worker dalam satu group. Config, offset, dan status disimpan di Kafka internal topics.

Cocok untuk:

1. Production.
2. High availability.
3. Banyak connector.
4. Scaling task.
5. Centralized REST management.
6. Worker failure recovery.

Dalam distributed mode, Connect menyimpan:

```text
connector configs  -> config storage topic
source offsets     -> offset storage topic
task status        -> status storage topic
```

Apache Kafka user guide menjelaskan bahwa dalam distributed mode, Kafka Connect menyimpan offsets, configs, dan task statuses di Kafka topics, dan topik-topik ini sebaiknya dibuat/diatur dengan partition dan replication factor yang sesuai untuk production.

Mental model:

```text
Distributed = Connect workers adalah cluster mini yang state koordinasinya disimpan di Kafka.
```

---

## 7. Internal Topics Kafka Connect

Kafka Connect distributed mode membutuhkan internal topics.

Biasanya:

```properties
config.storage.topic=connect-configs
offset.storage.topic=connect-offsets
status.storage.topic=connect-status
```

### 7.1 Config Storage Topic

Menyimpan konfigurasi connector.

Karakteristik umum:

1. Compacted topic.
2. Menyimpan latest config per connector.
3. Harus highly available.
4. Biasanya single partition untuk konsistensi config ordering.

Jika topic ini rusak/hilang, Connect worker kehilangan definisi connector.

### 7.2 Offset Storage Topic

Menyimpan offset/checkpoint untuk source connector.

Untuk sink connector, offset konsumsi Kafka dikelola seperti consumer group offset, tetapi Connect juga punya mekanisme koordinasi task dan commit.

Offset storage topic penting untuk source connector karena source offset bukan selalu Kafka offset. Contoh:

```text
JDBC source        -> last incrementing id / timestamp
CDC source         -> binlog/WAL position
File source        -> file path + byte position
SaaS API source    -> cursor/page token/timestamp
```

Jika offset source hilang, source connector bisa:

1. Re-ingest data dari awal.
2. Skip data jika start position salah.
3. Gagal start karena tidak tahu posisi.
4. Membutuhkan manual recovery.

### 7.3 Status Storage Topic

Menyimpan status connector dan task.

Contoh status:

```text
RUNNING
PAUSED
FAILED
UNASSIGNED
```

Status topic membantu REST API menampilkan state connector/task.

### 7.4 Production Principle

Internal topics adalah bagian dari control plane Connect. Jangan memperlakukannya sebagai topic biasa yang boleh dihapus sembarangan.

Checklist:

```text
[ ] replication.factor sesuai production
[ ] cleanup.policy sesuai kebutuhan Connect
[ ] ACL hanya untuk Connect principal/admin
[ ] tidak dihapus oleh automation retention cleanup
[ ] monitoring under-replicated partition
[ ] backup/recovery strategy dipahami
```

---

## 8. Converter vs Serializer: Boundary yang Sering Membingungkan

Di aplikasi Kafka biasa, kita bicara tentang serializer/deserializer:

```java
ProducerRecord<K, V>
K -> Serializer<K>
V -> Serializer<V>
bytes -> Kafka
```

Di Kafka Connect, konsep yang lebih sering terlihat adalah **converter**.

Converter bertugas mengubah antara:

```text
Connect internal data model <-> bytes di Kafka
```

Kafka Connect memakai internal representation sendiri, seperti:

```text
Schema
Struct
Map
Array
primitive types
optional/default fields
```

Lalu converter mengubah representation ini ke format Kafka record.

Contoh converter:

```properties
key.converter=org.apache.kafka.connect.json.JsonConverter
value.converter=org.apache.kafka.connect.json.JsonConverter

key.converter.schemas.enable=true
value.converter.schemas.enable=true
```

Atau dengan Avro dan Schema Registry:

```properties
key.converter=io.confluent.connect.avro.AvroConverter
value.converter=io.confluent.connect.avro.AvroConverter
value.converter.schema.registry.url=http://schema-registry:8081
```

### 8.1 Serializer di Kafka Producer Biasa

```text
Java object -> serializer -> bytes -> Kafka
```

### 8.2 Converter di Kafka Connect

```text
External system data -> Connect Schema/Struct -> converter -> bytes -> Kafka
```

Untuk sink:

```text
Kafka bytes -> converter -> Connect Schema/Struct -> external system data
```

### 8.3 Mengapa Ini Penting?

Karena error format sering terjadi di converter boundary.

Contoh masalah:

```text
Topic berisi JSON tanpa schema.
Sink connector dikonfigurasi memakai AvroConverter.
Hasil: deserialization/conversion error.
```

Atau:

```text
Source connector menulis JSON with schema envelope.
Consumer aplikasi mengira value adalah plain JSON.
Hasil: kontrak data salah.
```

### 8.4 JsonConverter schemas.enable

Kafka Connect `JsonConverter` punya opsi `schemas.enable`.

Jika `schemas.enable=true`, format JSON Connect biasanya membawa schema dan payload.

Secara konseptual:

```json
{
  "schema": {
    "type": "struct",
    "fields": [
      { "field": "case_id", "type": "string" }
    ]
  },
  "payload": {
    "case_id": "CASE-123"
  }
}
```

Jika `schemas.enable=false`, payload bisa lebih plain:

```json
{
  "case_id": "CASE-123"
}
```

Trade-off:

```text
schemas.enable=true
+ schema eksplisit
+ cocok untuk Connect-to-Connect tertentu
- payload lebih verbose
- consumer non-Connect bisa bingung

schemas.enable=false
+ lebih sederhana untuk consumer umum
- schema governance lebih lemah
- type ambiguity lebih tinggi
```

Untuk production multi-team, Avro/Protobuf/JSON Schema dengan Schema Registry biasanya lebih kuat daripada plain JSON tanpa governance.

---

## 9. Key Converter dan Value Converter

Kafka record punya key dan value.

Connect punya converter terpisah:

```properties
key.converter=...
value.converter=...
```

Ini penting karena key dan value punya peran berbeda.

Key menentukan:

1. Partitioning.
2. Ordering domain.
3. Compaction identity.
4. Upsert/delete semantics di sink tertentu.
5. Deduplication basis.

Value membawa data payload.

Contoh desain buruk:

```text
key = null
value = { caseId: "C-1", status: "OPEN" }
topic cleanup.policy=compact
```

Compaction tidak bisa mempertahankan latest state per `caseId` karena key Kafka null.

Desain lebih baik:

```text
key   = { caseId: "C-1" }
value = { status: "OPEN", ... }
```

Untuk connector, key converter harus dipikirkan sama seriusnya dengan value converter.

---

## 10. Single Message Transform / SMT

SMT adalah transform ringan yang diterapkan per record.

Confluent mendeskripsikan transforms sebagai logic sederhana untuk mengubah setiap message yang diproduksi oleh connector atau dikirim ke connector.

Contoh penggunaan SMT:

1. Rename field.
2. Drop field.
3. Insert static field.
4. Extract nested field.
5. Change topic name.
6. Mask field sederhana.
7. Hoist field.
8. Set timestamp.
9. Extract key dari value.

Contoh konfigurasi konseptual:

```properties
transforms=unwrap,route
transforms.unwrap.type=io.debezium.transforms.ExtractNewRecordState
transforms.route.type=org.apache.kafka.connect.transforms.RegexRouter
transforms.route.regex=server1.public.(.*)
transforms.route.replacement=db.public.$1
```

### 10.1 Kapan SMT Cocok?

SMT cocok untuk transform ringan dan lokal:

```text
single record in -> single record out
```

Contoh cocok:

```text
rename topic
extract field menjadi key
drop metadata field
mask simple PII field
insert source system name
```

### 10.2 Kapan SMT Tidak Cocok?

SMT tidak cocok untuk business logic berat.

Tidak cocok untuk:

1. Join antar event.
2. Aggregation.
3. Windowing.
4. Stateful enrichment.
5. Complex validation.
6. Calling external services per record.
7. Workflow decision.
8. Regulatory rule engine.
9. Multi-record correlation.

Untuk itu gunakan:

```text
Kafka Streams
ksqlDB
Flink
custom stream processor
application service
```

Rule of thumb:

```text
SMT boleh mengubah bentuk record.
SMT jangan menjadi domain processing engine.
```

---

## 11. Error Handling dan Dead Letter Queue Dasar

Kafka Connect error handling perlu dipahami sejak awal.

Secara umum, error bisa terjadi di beberapa tempat:

```text
External source read
External sink write
Converter
SMT
Kafka produce/fetch
Schema Registry
Network
Authentication/authorization
Invalid record
Target schema mismatch
```

### 11.1 Fail Fast

Default yang sering diinginkan untuk data kritis adalah gagal cepat.

Keuntungan:

1. Data issue terlihat jelas.
2. Tidak silently kehilangan data.
3. Operator dipaksa melihat masalah.

Kerugian:

1. Satu bad record bisa menghentikan pipeline.
2. Lag bisa tumbuh.
3. Operational noise tinggi.

### 11.2 Tolerate Errors

Connect bisa dikonfigurasi untuk menoleransi sebagian error tergantung connector dan jenis error.

Konsep:

```properties
errors.tolerance=all
```

Namun ini berbahaya jika dipakai tanpa DLQ dan monitoring.

Anti-pattern:

```properties
errors.tolerance=all
# tanpa DLQ
# tanpa alert
# tanpa audit
```

Ini bisa membuat data hilang secara diam-diam dari perspektif target.

### 11.3 Dead Letter Queue

DLQ adalah topic Kafka untuk record yang gagal diproses.

Confluent docs menjelaskan bahwa error pada sink connector, transform, atau converter dapat ditulis ke configurable dead letter queue topic, dan nama topic dikonfigurasi melalui `errors.deadletterqueue.topic.name` untuk sink connector.

Contoh konseptual:

```properties
errors.tolerance=all
errors.deadletterqueue.topic.name=dlq.case-search-sink
errors.deadletterqueue.context.headers.enable=true
errors.log.enable=true
errors.log.include.messages=false
```

DLQ membantu:

1. Pipeline tetap jalan.
2. Bad record bisa dianalisis.
3. Reprocessing bisa dilakukan setelah fix.
4. Incident tidak selalu menghentikan seluruh data flow.

Tetapi DLQ bukan tempat sampah permanen.

DLQ harus punya:

```text
[ ] owner
[ ] alert
[ ] retention
[ ] triage process
[ ] replay process
[ ] PII/security policy
[ ] dashboard
```

Jika tidak, DLQ menjadi kuburan data.

---

## 12. REST API Kafka Connect

Kafka Connect menyediakan REST API untuk mengelola connector.

Operasi umum:

```text
GET    /connectors
POST   /connectors
GET    /connectors/{name}
GET    /connectors/{name}/config
PUT    /connectors/{name}/config
GET    /connectors/{name}/status
POST   /connectors/{name}/restart
PUT    /connectors/{name}/pause
PUT    /connectors/{name}/resume
DELETE /connectors/{name}
```

Dalam distributed mode, kamu bisa memanggil REST API ke salah satu worker. Worker akan berkoordinasi melalui Kafka internal topics dan group membership.

### 12.1 Connector Config as Code

Jangan hanya klik/manual submit config di production.

Lebih baik:

```text
connector-configs/
  dev/
    case-jdbc-source.json
  staging/
    case-jdbc-source.json
  prod/
    case-jdbc-source.json
```

Deployment via pipeline:

```bash
curl -X PUT \
  -H "Content-Type: application/json" \
  --data @prod/case-jdbc-source.json \
  http://connect:8083/connectors/case-jdbc-source/config
```

Principle:

```text
Connector config adalah production artifact.
Harus versioned, reviewed, promoted, dan auditable.
```

---

## 13. Plugin Path dan Connector Deployment

Kafka Connect worker memuat connector plugin dari plugin path.

Contoh:

```properties
plugin.path=/usr/share/java,/opt/connectors
```

Setiap connector biasanya membawa dependency sendiri.

Masalah production umum:

1. Dependency conflict.
2. Versi connector tidak sama antar worker.
3. Worker restart lupa mount plugin.
4. Connector class tidak ditemukan.
5. Driver JDBC tidak tersedia.
6. Plugin path terlalu luas dan classpath kacau.
7. Upgrade plugin tanpa rollout plan.

Best practice:

```text
[ ] Semua worker dalam group punya plugin set yang sama.
[ ] Connector version dipin.
[ ] Image Connect immutable.
[ ] Plugin diuji di staging.
[ ] JDBC driver eksplisit.
[ ] Classpath tidak dicampur sembarangan.
[ ] Upgrade connector dilakukan rolling dengan compatibility check.
```

---

## 14. Connector Config Anatomy

Contoh source connector konseptual:

```json
{
  "name": "case-events-jdbc-source",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "tasks.max": "1",
    "connection.url": "jdbc:postgresql://postgres:5432/cases",
    "connection.user": "connect_user",
    "connection.password": "${file:/secrets/db.properties:password}",
    "mode": "timestamp+incrementing",
    "incrementing.column.name": "id",
    "timestamp.column.name": "updated_at",
    "topic.prefix": "source.postgres.cases.",
    "poll.interval.ms": "5000",
    "key.converter": "io.confluent.connect.avro.AvroConverter",
    "value.converter": "io.confluent.connect.avro.AvroConverter",
    "key.converter.schema.registry.url": "http://schema-registry:8081",
    "value.converter.schema.registry.url": "http://schema-registry:8081"
  }
}
```

Contoh sink connector konseptual:

```json
{
  "name": "case-search-opensearch-sink",
  "config": {
    "connector.class": "io.confluent.connect.elasticsearch.ElasticsearchSinkConnector",
    "tasks.max": "4",
    "topics": "case.lifecycle.events",
    "connection.url": "https://opensearch:9200",
    "key.ignore": "false",
    "schema.ignore": "false",
    "behavior.on.malformed.documents": "warn",
    "errors.tolerance": "all",
    "errors.deadletterqueue.topic.name": "dlq.case-search-opensearch-sink",
    "errors.deadletterqueue.context.headers.enable": "true",
    "key.converter": "io.confluent.connect.avro.AvroConverter",
    "value.converter": "io.confluent.connect.avro.AvroConverter",
    "key.converter.schema.registry.url": "http://schema-registry:8081",
    "value.converter.schema.registry.url": "http://schema-registry:8081"
  }
}
```

Catatan: detail config spesifik connector berbeda-beda. Jangan menghafal contoh ini sebagai template universal. Pakai dokumentasi connector masing-masing.

---

## 15. Connect Data Model

Kafka Connect memakai data model internal agar connector tidak perlu peduli format Kafka bytes secara langsung.

Elemen umum:

```text
Schema
Struct
Field
primitive types
array
map
optional field
default value
logical types
```

Logical types bisa mencakup konsep seperti:

```text
date
time
timestamp
decimal
```

Masalah umum:

```text
Database DECIMAL -> Connect Decimal -> Avro bytes/logical type -> Sink target
```

Jika converter atau sink tidak memahami logical type dengan benar, data bisa rusak atau gagal.

Contoh risiko:

1. Timestamp timezone ambiguity.
2. Decimal precision loss.
3. Nullability mismatch.
4. Field optionality berubah.
5. Enum/string mismatch.
6. JSON tidak punya tipe kuat.

Production principle:

```text
Selalu uji tipe data kritis end-to-end, bukan hanya happy path string/integer.
```

---

## 16. Kafka Connect dan Schema Registry

Schema Registry sering dipakai bersama Connect.

Untuk source connector:

```text
External system data
-> Connect Schema/Struct
-> AvroConverter/ProtobufConverter/JsonSchemaConverter
-> Schema Registry subject/version
-> Kafka bytes
```

Untuk sink connector:

```text
Kafka bytes
-> Converter membaca schema id/schema
-> Connect Schema/Struct
-> Sink connector menulis ke target
```

Keuntungan:

1. Schema contract eksplisit.
2. Compatibility validation.
3. Consumer lebih aman.
4. Integrasi multi-team lebih terkontrol.
5. Schema evolution bisa dikelola.

Risiko:

1. Subject naming strategy salah.
2. Source connector membuat schema terlalu teknis.
3. Database schema leak ke event publik.
4. Compatibility mode tidak sesuai.
5. Connector restart gagal karena schema incompatible.
6. Banyak topic/schema liar tanpa ownership.

Rule penting:

```text
Connect + Schema Registry tidak otomatis menghasilkan event model yang bagus.
Ia hanya membuat struktur data lebih governable.
Domain semantics tetap harus didesain.
```

---

## 17. Source Connector Offset Mental Model

Source connector harus tahu posisi terakhir di source system.

Kafka offset tidak cukup karena data belum berasal dari Kafka.

Contoh source offset:

```text
JDBC timestamp+incrementing:
  { table: "cases", last_id: 12345, last_updated_at: "2026-06-19T10:00:00Z" }

CDC:
  { wal_lsn: "0/16B6C50", txid: 9981 }

File:
  { file: "/data/a.log", position: 912873 }

API:
  { cursor: "eyJwYWdlIjo..." }
```

Connect framework menyimpan offset ini di offset storage topic.

Failure scenario:

```text
Source connector membaca 100 rows.
Berhasil produce ke Kafka.
Worker crash sebelum offset source tersimpan.
Setelah restart, connector membaca ulang sebagian rows.
Hasil: duplicate events.
```

Maka source connector umumnya harus dianggap at-least-once kecuali connector tertentu menyediakan guarantee lebih kuat melalui mekanisme khusus.

Design implication:

```text
Downstream harus siap duplicate.
Event harus punya stable id.
Sink harus idempotent jika data kritis.
```

---

## 18. Sink Connector Offset Mental Model

Sink connector membaca Kafka topic sebagai consumer.

Failure scenario klasik:

```text
Sink task membaca record offset 100..199.
Sink task menulis batch ke database.
Database write sukses.
Worker crash sebelum Kafka offset commit.
Setelah restart, offset 100..199 dibaca ulang.
Database menerima duplicate write.
```

Ini adalah alasan sink connector harus didesain dengan idempotency.

Contoh mitigasi:

1. Upsert berdasarkan key.
2. External idempotency key.
3. Natural unique constraint.
4. Sink target write yang deterministic.
5. Dedup table.
6. Version check.
7. Last-write-wins yang eksplisit.
8. Exactly-once sink jika connector/target mendukung secara khusus.

Default mental model aman:

```text
Kafka Connect sink = at-least-once side effect, unless proven otherwise.
```

---

## 19. Connect vs Custom Producer/Consumer

### 19.1 Pakai Kafka Connect Jika

Gunakan Connect jika:

1. Integrasi sumber/target umum sudah ada connector matang.
2. Transformasi ringan cukup.
3. Kebutuhan utama adalah data movement.
4. Operasional lebih penting daripada custom flexibility.
5. Tim ingin standar deployment dan monitoring.
6. Source/sink semantics connector sesuai kebutuhan.
7. Data contract bisa diatur dengan converter/schema registry.
8. Connector mendukung auth/security target.
9. Throughput/latency cocok.
10. Failure handling connector bisa diterima.

Contoh cocok:

```text
PostgreSQL CDC -> Kafka
Kafka -> S3
Kafka -> OpenSearch
Kafka -> Snowflake/warehouse
Kafka -> JDBC reporting table
SaaS API polling -> Kafka
```

### 19.2 Tulis Custom Service Jika

Tulis custom producer/consumer jika:

1. Ada domain decision kompleks.
2. Perlu orchestration workflow.
3. Perlu multi-step transaction khusus.
4. Perlu call external service dengan business fallback.
5. Perlu custom idempotency logic berat.
6. Perlu stateful processing.
7. Perlu join/aggregation/window.
8. Connector tidak matang atau tidak ada.
9. Error semantics connector tidak cocok.
10. Security/compliance memerlukan kontrol penuh.
11. Latency sangat ketat dan connector overhead tidak diterima.
12. Data movement harus dipadukan dengan business invariant.

Contoh tidak cocok untuk Connect murni:

```text
Jika case escalated dan officer unavailable,
cek roster, policy, priority, legal deadline,
lalu pilih assignment berikutnya dan publish decision event.
```

Itu bukan data movement. Itu domain workflow.

Gunakan application service/Kafka Streams/workflow engine.

---

## 20. Connect dalam Arsitektur Event-Driven

Kafka Connect biasanya berada di boundary arsitektur.

### 20.1 Ingestion Boundary

```text
Legacy DB -> CDC Connector -> Kafka raw topics -> stream processing -> domain topics
```

Pola ini cocok saat:

1. Source system tidak bisa publish event sendiri.
2. Perlu integrasi legacy.
3. Perlu audit perubahan database.
4. Migrasi sistem bertahap.

Risiko:

```text
CDC events sering bersifat database-centric, bukan domain-centric.
```

Maka raw CDC topic sebaiknya tidak selalu langsung dijadikan public domain event.

### 20.2 Egress Boundary

```text
Domain topic -> Sink Connector -> Search Index / Data Lake / Warehouse
```

Pola ini cocok untuk projection.

Contoh:

```text
case.lifecycle.events -> OpenSearch case index
case.audit.events     -> S3 audit lake
case.assignment.events -> reporting warehouse
```

### 20.3 Integration Boundary

```text
SaaS API -> Source Connector -> Kafka -> internal services
Kafka -> Sink Connector -> SaaS API
```

Hati-hati dengan rate limit dan API semantics.

Connect tidak menghilangkan kebutuhan memahami target/source.

---

## 21. Case Management Example

Misalkan kita punya enforcement lifecycle platform.

Kebutuhan:

1. Legacy case database masih menjadi source awal.
2. Kafka menjadi event backbone.
3. Search index perlu update near real-time.
4. Data lake perlu audit trail.
5. Reporting warehouse perlu subset data.

Desain awal:

```text
PostgreSQL cases table
    |
    | CDC/source connector
    v
raw.db.cases
    |
    | stream processor / domain mapper
    v
case.lifecycle.events
    |
    +--> OpenSearch sink connector -> case search index
    |
    +--> S3 sink connector -> audit lake
    |
    +--> JDBC/warehouse sink connector -> reporting model
```

Mengapa tidak langsung:

```text
raw.db.cases -> all consumers
```

Karena raw database change event biasanya:

1. Mengandung struktur tabel, bukan domain language.
2. Bisa berubah saat refactor schema DB.
3. Tidak selalu punya event name semantik.
4. Bisa mengandung kolom internal.
5. Sulit dijadikan public contract.

Lebih defensible:

```text
CDC raw topic = private integration stream.
Domain event topic = public business contract.
```

---

## 22. Connect dan Security

Kafka Connect berada di tengah banyak boundary keamanan:

```text
Kafka credentials
Schema Registry credentials
Database credentials
S3 credentials
SaaS API token
TLS certificates
Connector REST API auth
Plugin supply chain
```

### 22.1 Secret Management

Jangan hardcode secrets di connector config plain text jika platform mendukung secret provider.

Contoh pattern:

```properties
connection.password=${file:/mnt/secrets/db.properties:password}
```

Atau integrasi dengan secret manager, tergantung platform.

### 22.2 ACL Kafka

Connect principal butuh permission untuk:

1. Internal topics.
2. Source-produced topics.
3. Sink-consumed topics.
4. Consumer groups.
5. DLQ topics.
6. Schema Registry subject access jika digunakan.

Prinsip:

```text
Jangan beri Connect cluster-wide superuser tanpa alasan.
Pisahkan Connect cluster/principal untuk domain atau tenant kritis.
```

### 22.3 REST API Exposure

Connect REST API bisa mengubah connector config.

Jika tidak dilindungi, attacker/operator ceroboh bisa:

1. Membaca config sensitif.
2. Mengubah target sink.
3. Menghapus connector.
4. Mengubah DLQ.
5. Membuat connector exfiltration.
6. Restart pipeline kritis.

Checklist:

```text
[ ] REST API tidak expose publik
[ ] authn/authz tersedia di layer platform
[ ] network policy diterapkan
[ ] audit log perubahan config
[ ] connector config tidak menyimpan plain secret sembarangan
```

---

## 23. Observability Dasar Kafka Connect

Monitoring Connect harus mencakup beberapa layer.

### 23.1 Worker Health

Pantau:

```text
worker up/down
JVM heap
GC pause
CPU
thread count
network
plugin errors
REST API availability
```

### 23.2 Connector Status

Pantau:

```text
connector state
task state
failed task count
restart count
pause state
```

### 23.3 Throughput

Pantau:

```text
records read from source
records produced to Kafka
records consumed from Kafka
records written to sink
batch size
poll time
put time
```

### 23.4 Error Metrics

Pantau:

```text
conversion errors
transformation errors
produce errors
sink write errors
DLQ count
retry count
```

### 23.5 Lag

Untuk sink connector:

```text
consumer lag per connector group/topic/partition
```

Untuk source connector:

lag tergantung source:

```text
CDC lag by WAL/binlog position
JDBC lag by timestamp difference
API lag by cursor/time
file lag by file position
```

Tidak semua source lag bisa dilihat dari Kafka offset.

---

## 24. Common Failure Modes

### 24.1 Connector Class Not Found

Gejala:

```text
Failed to find any class that implements Connector
```

Penyebab:

1. Plugin belum dipasang.
2. Plugin path salah.
3. Worker belum restart.
4. Versi plugin tidak sama antar worker.
5. Dependency conflict.

Mitigasi:

```text
Gunakan immutable image dan plugin inventory check.
```

### 24.2 Converter Mismatch

Gejala:

```text
Unknown magic byte
SerializationException
JsonConverter error
Schema Registry subject not found
```

Penyebab:

1. Topic Avro dibaca dengan JSON converter.
2. JSON tanpa schema dibaca dengan schemas.enable=true.
3. Schema Registry URL salah.
4. Subject naming mismatch.

Mitigasi:

```text
Standarisasi converter per topic/connector family.
Dokumentasikan format topic.
```

### 24.3 Task Failed, Connector Still Exists

Connector status bisa menunjukkan connector RUNNING tapi task FAILED.

Selalu cek task status, bukan hanya connector status.

```text
Connector logical job bisa hidup,
tetapi task yang menjalankan data movement bisa mati.
```

### 24.4 DLQ Growing Silently

Pipeline tampak jalan, tetapi banyak record masuk DLQ.

Risiko:

```text
Target tidak lengkap.
Audit/data lake/search index kehilangan subset data.
```

Mitigasi:

```text
Alert DLQ rate > threshold.
Alert DLQ non-empty untuk critical pipeline.
```

### 24.5 Sink Duplicate Writes

Penyebab:

1. Retry setelah partial success.
2. Crash sebelum offset commit.
3. Rebalance saat batch write.
4. Target timeout tapi write sebenarnya sukses.

Mitigasi:

```text
Idempotent sink design.
Primary key/upsert/versioning.
```

### 24.6 Source Duplicate Ingestion

Penyebab:

1. Source offset commit terlambat.
2. Snapshot restart.
3. Cursor ambiguity.
4. Timestamp polling overlap.

Mitigasi:

```text
Stable event id.
Downstream dedup/idempotency.
Connector-specific offset strategy.
```

---

## 25. Operational Lifecycle

Connector lifecycle bukan hanya create.

### 25.1 Create

```text
Submit config.
Validate connector class available.
Verify topic/schema/ACL.
Check status RUNNING.
Check records flowing.
```

### 25.2 Pause

Pause menghentikan processing tanpa menghapus config.

Cocok untuk:

1. Maintenance target.
2. Stop temporary ingestion.
3. Prevent further damage saat incident.

### 25.3 Resume

Resume melanjutkan dari offset/checkpoint terakhir.

Perhatikan backlog/lag.

### 25.4 Restart

Restart connector/task untuk recover transient failure.

Jangan jadikan restart loop sebagai solusi permanen.

### 25.5 Update Config

Update config bisa memicu rebalance/restart task.

Perlu review:

1. Apakah topic berubah?
2. Apakah converter berubah?
3. Apakah offset masih valid?
4. Apakah tasks.max berubah?
5. Apakah transform berubah?
6. Apakah DLQ berubah?
7. Apakah credential berubah?

### 25.6 Delete

Delete connector menghapus config dari Connect.

Pertanyaan sebelum delete:

```text
Apakah offset akan dipertahankan?
Apakah internal state perlu dibersihkan?
Apakah topic target/source masih digunakan?
Apakah ada consumer downstream?
Apakah ada compliance retention?
```

---

## 26. Design Trade-Offs

### 26.1 Declarative Simplicity vs Semantic Control

Connect membuat integrasi cepat.

Tetapi:

```text
Semakin kompleks semantics yang kamu butuhkan,
semakin mungkin Connect config tidak cukup.
```

Jika pipeline hanya data movement, Connect unggul.
Jika pipeline mengandung decision logic, Connect bisa menjadi tempat yang salah.

### 26.2 Reusable Connector vs Custom Business Logic

Reusable connector mengurangi kode.

Namun connector general-purpose mungkin tidak tahu:

1. Domain invariant.
2. Legal deadline.
3. Escalation policy.
4. Human assignment rule.
5. Case state machine validity.

Jangan memasukkan domain invariant penting ke SMT atau connector config yang sulit dites.

### 26.3 At-Least-Once vs Exactly-Once Expectation

Banyak sink/source connector efektifnya at-least-once.

Jika bisnis menuntut exactly-once externally, kamu harus mendesain:

1. Idempotency key.
2. Upsert semantics.
3. Deduplication.
4. Transaction boundary.
5. Reconciliation.
6. Audit.

Jangan mengandalkan kata “Kafka” untuk menyelesaikan side effect exactly-once.

### 26.4 Central Connect Cluster vs Domain-Specific Connect Cluster

Satu Connect cluster besar:

Keuntungan:

1. Operasional sederhana.
2. Resource pooling.
3. Connector management terpusat.

Kerugian:

1. Blast radius besar.
2. Plugin conflict lebih mungkin.
3. Credential boundary lemah.
4. Noisy neighbor.
5. Upgrade sulit.

Connect cluster per domain/criticality:

Keuntungan:

1. Blast radius kecil.
2. Security lebih jelas.
3. Upgrade lebih terkontrol.
4. Ownership lebih baik.

Kerugian:

1. Lebih banyak cluster dikelola.
2. Resource overhead.
3. Governance perlu disiplin.

Rule praktis:

```text
Untuk platform besar, pisahkan Connect cluster berdasarkan criticality, domain, dan trust boundary.
```

---

## 27. Anti-Patterns

### 27.1 Connect sebagai Business Logic Engine

Salah:

```text
SMT + connector config + scripts = workflow decision engine
```

Akibat:

1. Sulit dites.
2. Sulit di-review.
3. Observability buruk.
4. Domain logic tersembunyi.
5. Incident sulit dianalisis.

### 27.2 Semua Database Table Di-CDC Langsung ke Public Topic

Salah:

```text
public.users
public.cases
public.assignments
langsung dipakai semua tim sebagai contract
```

Akibat:

1. Database schema menjadi public API.
2. Refactor DB merusak downstream.
3. Kolom internal bocor.
4. Domain event semantics tidak jelas.

Lebih baik:

```text
raw CDC topics private -> curated domain events public
```

### 27.3 `errors.tolerance=all` Tanpa DLQ

Salah:

```properties
errors.tolerance=all
```

tanpa DLQ, alert, atau audit.

Akibat:

```text
Data hilang secara operasional tetapi pipeline terlihat hijau.
```

### 27.4 Null Key untuk Data yang Butuh Upsert/Compaction

Salah:

```text
key=null
value={caseId:"C-123", status:"OPEN"}
```

Lalu berharap sink bisa idempotent/compacted by caseId.

Key harus didesain.

### 27.5 Satu Connect Cluster untuk Semua Hal

Salah:

```text
Semua connector semua domain semua credential semua plugin dalam satu cluster.
```

Akibat:

1. Blast radius besar.
2. Upgrade chaos.
3. Plugin dependency conflict.
4. Security boundary lemah.

### 27.6 Mengabaikan Target Semantics

Kafka Connect tidak membuat target magically scalable.

Contoh:

```text
Kafka topic 100 MB/s -> JDBC sink -> database OLTP
```

Jika database tidak siap, sink lag akan naik atau target overload.

---

## 28. Java Engineer Perspective

Sebagai Java engineer, kamu harus memahami Connect dari dua sisi:

1. Sebagai user/operator connector.
2. Sebagai developer yang mungkin perlu menulis connector custom.

Part ini fokus pada user/operator. Custom connector development bisa dipelajari nanti setelah fondasi kuat.

### 28.1 Mapping ke Java Concepts

```text
Worker JVM       -> long-running Java process
Connector class  -> plugin class
Task class       -> executable unit
ConfigDef        -> schema konfigurasi connector
SourceRecord     -> record dari external source ke Kafka
SinkRecord       -> record dari Kafka ke external sink
Converter        -> Connect data <-> Kafka bytes
Transformation   -> per-record transformation
```

### 28.2 Kenapa Java Engineer Harus Peduli?

Karena walaupun Connect declarative, incident-nya sering memerlukan debugging yang mirip aplikasi Java:

1. Stack trace.
2. Classpath.
3. Dependency conflict.
4. Thread stuck.
5. GC pause.
6. Heap pressure.
7. Batch size.
8. HTTP client timeout.
9. JDBC driver behavior.
10. Retry loop.
11. Serialization exception.

Connect bukan no-code magic. Connect adalah Java runtime yang menjalankan plugin integrasi.

---

## 29. Minimal Local Mental Exercise

Kita tidak akan membuat full lab di part ini, tetapi pahami flow berikut.

### 29.1 Source Flow

```text
JDBC Source Connector
  reads rows from table cases
  converts each row into Connect Struct
  converter serializes Struct to Avro
  Schema Registry stores schema
  Kafka receives record in topic source.postgres.cases
  Connect stores source offset last id/timestamp
```

Pertanyaan:

1. Apa yang terjadi jika worker crash setelah Kafka menerima record tetapi sebelum source offset tersimpan?
2. Apa yang terjadi jika kolom baru ditambah di table?
3. Apakah topic ini layak langsung menjadi public domain event?
4. Apa key Kafka record-nya?
5. Bagaimana downstream dedup?

### 29.2 Sink Flow

```text
OpenSearch Sink Connector
  reads case.lifecycle.events
  converter deserializes Avro into Connect Struct
  SMT extracts caseId as document id
  connector writes document to OpenSearch
  Connect commits Kafka offset
```

Pertanyaan:

1. Apa yang terjadi jika OpenSearch write sukses tapi worker crash sebelum offset commit?
2. Apakah duplicate write aman?
3. Apa yang terjadi jika schema event berubah?
4. Apa DLQ policy-nya?
5. Bagaimana kamu tahu index tertinggal?

---

## 30. Production Readiness Checklist

Sebelum menjalankan connector production, minimal jawab checklist ini.

### 30.1 Ownership

```text
[ ] Siapa owner connector?
[ ] Siapa owner source system?
[ ] Siapa owner target system?
[ ] Siapa on-call?
[ ] Siapa approve schema/config change?
```

### 30.2 Data Contract

```text
[ ] Topic input/output jelas?
[ ] Key schema jelas?
[ ] Value schema jelas?
[ ] Compatibility mode jelas?
[ ] Subject naming strategy jelas?
[ ] Null/tombstone behavior jelas?
```

### 30.3 Delivery Semantics

```text
[ ] Source duplicate possibility dipahami?
[ ] Sink duplicate possibility dipahami?
[ ] Idempotency strategy ada?
[ ] Offset/checkpoint recovery dipahami?
[ ] Reprocessing strategy ada?
```

### 30.4 Error Handling

```text
[ ] Fail fast atau tolerate?
[ ] DLQ topic ada?
[ ] DLQ alert ada?
[ ] DLQ retention ada?
[ ] DLQ replay procedure ada?
[ ] Bad record tidak menghilang diam-diam?
```

### 30.5 Security

```text
[ ] Kafka ACL minimal?
[ ] Schema Registry access benar?
[ ] Source/target credentials aman?
[ ] REST API terlindungi?
[ ] Secret tidak hardcoded?
[ ] PII handling jelas?
```

### 30.6 Operations

```text
[ ] tasks.max dipilih berdasarkan bottleneck nyata?
[ ] Worker capacity cukup?
[ ] Plugin version dipin?
[ ] Semua worker punya plugin sama?
[ ] Internal topics replicated?
[ ] Monitoring connector/task/DLQ/lag ada?
[ ] Runbook restart/pause/resume ada?
```

---

## 31. Thought Exercises

### Exercise 1 — Connect or Custom Service?

Untuk setiap skenario, pilih Connect atau custom service, lalu jelaskan alasannya.

1. Menyalin event `case.audit.events` ke S3 untuk audit lake.
2. Membaca case dari Kafka, memanggil policy engine, lalu menentukan escalation action.
3. Mengirim event `case.lifecycle.events` ke OpenSearch untuk search UI.
4. Mengambil perubahan table legacy `violations` dari database lama ke Kafka raw topic.
5. Membaca Kafka dan mengirim email notifikasi dengan template kompleks dan retry business-specific.

Jawaban ideal:

```text
1. Connect sink cocok.
2. Custom service/Kafka Streams lebih cocok.
3. Connect sink cocok jika mapping sederhana.
4. CDC/source connector cocok, tetapi raw topic jangan otomatis public.
5. Custom service lebih cocok karena business side effect dan template semantics.
```

### Exercise 2 — Identify Hidden Duplicate Risk

Skenario:

```text
Kafka -> JDBC Sink -> reporting_db.case_status
```

Connector melakukan insert biasa, bukan upsert.

Pertanyaan:

1. Apa yang terjadi jika worker crash setelah insert sukses sebelum offset commit?
2. Apa yang terjadi jika connector retry karena timeout, tetapi database sebenarnya sudah commit?
3. Bagaimana memperbaiki desain?

Jawaban:

```text
Duplicate insert mungkin terjadi.
Gunakan primary key natural/event id, upsert, idempotency table, atau write model yang deterministic.
```

### Exercise 3 — Raw CDC vs Domain Event

Skenario:

```text
Debezium/CDC menghasilkan topic raw.public.case_table.
Tim lain ingin consume topic itu langsung untuk workflow enforcement.
```

Pertanyaan:

1. Apa risikonya?
2. Kapan boleh?
3. Apa alternatif lebih baik?

Jawaban:

```text
Risiko: schema DB menjadi public API, semantics CRUD bukan domain, kolom internal bocor, refactor DB breaking.
Boleh untuk private pipeline/analytics tertentu dengan governance.
Lebih baik raw CDC -> mapper -> domain event topic.
```

---

## 32. Ringkasan

Kafka Connect adalah runtime standar untuk integrasi data antara Kafka dan sistem eksternal.

Konsep inti:

```text
Connector = logical integration job.
Task      = unit kerja paralel.
Worker    = proses runtime yang menjalankan connector/task.
Converter = boundary antara Connect data model dan Kafka bytes.
SMT       = transform ringan per record.
DLQ       = topic untuk record gagal yang perlu triage.
```

Source connector:

```text
External system -> Kafka
```

Sink connector:

```text
Kafka -> External system
```

Distributed mode menyimpan config, offset, dan status di Kafka internal topics, sehingga cocok untuk production.

Hal paling penting untuk engineer senior:

```text
Kafka Connect menyederhanakan data movement,
tetapi tidak menghapus kebutuhan memahami schema, offset, duplicate, idempotency,
source/target semantics, security, observability, dan operational lifecycle.
```

Connect paling cocok untuk integrasi standar. Jangan menjadikannya domain workflow engine.

---

## 33. Apa yang Harus Diingat Sebelum Lanjut

Sebelum lanjut ke Part 015, pastikan kamu bisa menjawab:

1. Apa bedanya connector, task, dan worker?
2. Apa bedanya source connector dan sink connector?
3. Mengapa distributed mode butuh internal topics?
4. Apa bedanya converter dan serializer?
5. Mengapa key converter sama pentingnya dengan value converter?
6. Apa risiko `errors.tolerance=all`?
7. Mengapa sink connector harus diasumsikan at-least-once?
8. Kapan memakai Connect dan kapan custom service?
9. Mengapa raw CDC topic tidak otomatis menjadi domain event topic?
10. Apa saja yang perlu dimonitor pada connector production?

---

## 34. Referensi

Referensi yang relevan untuk part ini:

1. Apache Kafka Documentation — Kafka Connect API and user guide.
2. Apache Kafka Connect User Guide — standalone mode, distributed mode, internal topics, connector lifecycle.
3. Confluent Platform Documentation — Kafka Connect concepts, workers, connectors, transforms, dead letter queue, worker configuration.
4. Confluent Kafka Connect Connector Documentation — JDBC source/sink, sink connector configs, DLQ configs.
5. Red Hat Streams for Apache Kafka Documentation — Kafka Connect component overview.

---

## 35. Status Seri

```text
Part 000 selesai — Orientation: Kafka as a Distributed Log, Not Just a Queue
Part 001 selesai — The Log Mental Model: Topics, Partitions, Offsets, and Ordering
Part 002 selesai — Broker Internals: Storage, Page Cache, Replication, and Durability
Part 003 selesai — Kafka Cluster Architecture: KRaft, Controllers, Metadata, and Quorum
Part 004 selesai — Producers Deep Dive: Batching, Compression, Acks, Idempotence, and Throughput
Part 005 selesai — Partitioning Strategy: Keys, Ordering Domains, Hot Partitions, and Scalability
Part 006 selesai — Consumers Deep Dive: Poll Loop, Offset Management, Fetching, and Backpressure
Part 007 selesai — Consumer Groups and Rebalancing: Assignment, Ownership, and Failure Modes
Part 008 selesai — Delivery Semantics: At-Most-Once, At-Least-Once, Effectively-Once, Exactly-Once
Part 009 selesai — Event Design: Facts, Commands, State Changes, and Domain Events
Part 010 selesai — Serialization and Schema Governance: Avro, Protobuf, JSON Schema, Compatibility
Part 011 selesai — Topic Design and Governance: Naming, Retention, Compaction, ACL, Ownership
Part 012 selesai — Log Compaction and KTable Mental Model
Part 013 selesai — Kafka Security: TLS, SASL, ACL, Principal, Multi-Tenant Boundaries
Part 014 selesai — Kafka Connect Fundamentals: Source, Sink, Workers, Tasks, Converters

Seri belum selesai.
Part berikutnya: Part 015 — Kafka Connect in Production: Scaling, Failure, DLQ, Offset, and Operational Control
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — Kafka Security: TLS, SASL, ACL, Principal, Multi-Tenant Boundaries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-015.md">Part 015 — Kafka Connect in Production: Scaling, Failure, DLQ, Offset, and Operational Control ➡️</a>
</div>

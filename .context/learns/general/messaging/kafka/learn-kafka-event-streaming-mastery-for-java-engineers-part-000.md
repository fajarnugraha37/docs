# learn-kafka-event-streaming-mastery-for-java-engineers-part-000.md

# Part 000 — Orientation: Kafka as a Distributed Log, Not Just a Queue

## 0. Metadata

**Series:** Kafka Event Streaming Mastery for Java Engineers  
**Part:** 000 / 034  
**Title:** Orientation: Kafka as a Distributed Log, Not Just a Queue  
**Audience:** Java software engineer, tech lead, backend/distributed systems engineer  
**Goal:** Membentuk mental model yang benar sebelum masuk ke producer, consumer, partitioning, delivery semantics, Kafka Connect, ksqlDB, Kafka Streams, dan production architecture.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus bisa menjelaskan Kafka bukan sebagai “message queue yang lebih cepat”, tetapi sebagai:

1. **Distributed append-only log**  
   Kafka menyimpan record secara berurutan di dalam partition. Consumer membaca dari posisi tertentu yang disebut offset.

2. **Event streaming platform**  
   Kafka tidak hanya mengirim pesan antar service. Kafka memungkinkan event disimpan, dibaca ulang, diproses, direplikasi, dan dijadikan backbone integrasi data.

3. **Replayable integration layer**  
   Consumer tidak harus hadir saat event diproduksi. Jika retention masih menyimpan event, consumer baru bisa membaca dari masa lalu.

4. **Shared durable event substrate**  
   Banyak aplikasi bisa membaca event yang sama dengan tujuan berbeda: projection, audit, analytics, notification, fraud detection, monitoring, machine learning, dan workflow automation.

5. **Foundation untuk ecosystem lebih besar**  
   Kafka Connect, Kafka Streams, ksqlDB, Schema Registry, CDC, outbox, stream processing, dan event-driven architecture semuanya berdiri di atas fondasi log, partition, offset, dan replay.

Bagian ini belum bertujuan membuat kamu langsung menulis aplikasi Kafka production-grade. Bagian ini bertujuan mengoreksi cara berpikir. Kalau mental model awal salah, konfigurasi dan API Kafka akan terlihat seperti kumpulan properti acak.

---

## 2. Kafka dalam Satu Kalimat

Kafka adalah **platform event streaming terdistribusi** yang menyimpan event dalam log terpartisi, durable, scalable, dan replayable, sehingga banyak producer dan consumer dapat bertukar, menyimpan, dan memproses aliran data secara real-time maupun historis.

Versi yang lebih teknis:

> Kafka adalah distributed commit log dengan model publish-subscribe, di mana producer menulis record ke topic-partition, broker menyimpan record tersebut secara durable, consumer membaca record berdasarkan offset, dan consumer group mengoordinasikan parallel consumption.

Versi yang lebih arsitektural:

> Kafka adalah backbone untuk mengubah sistem dari model synchronous request-response menjadi model asynchronous event-driven, tanpa kehilangan kemampuan audit, replay, integration fan-out, dan high-throughput ingestion.

---

## 3. Masalah yang Diselesaikan Kafka

Sebelum Kafka, integrasi antar sistem sering terlihat seperti ini:

```text
Service A ---> Service B
Service A ---> Service C
Service A ---> Service D
Service B ---> Service E
Service C ---> Data Warehouse
Service D ---> Search Index
```

Masalahnya:

1. **Point-to-point coupling**  
   Setiap sistem harus tahu siapa konsumennya.

2. **Synchronous dependency**  
   Jika downstream lambat atau mati, upstream ikut terdampak.

3. **Data fan-out sulit**  
   Satu event bisnis perlu dikirim ke banyak tujuan: audit, analytics, notification, search, compliance, monitoring.

4. **Replay sulit**  
   Kalau bug terjadi di consumer, data masa lalu sulit diproses ulang.

5. **Historical reconstruction sulit**  
   Sistem hanya menyimpan state terakhir, bukan sequence perubahan.

6. **Dual-write problem**  
   Aplikasi sering perlu menulis database dan mengirim message. Jika salah satu gagal, state menjadi inkonsisten.

7. **Batch integration lambat**  
   Data warehouse, reporting, dan downstream sync sering menunggu batch periodik.

Kafka mengubah model menjadi:

```text
                 +----------------+
Producer A ----> |                | ----> Consumer X
Producer B ----> |     Kafka      | ----> Consumer Y
Producer C ----> |                | ----> Consumer Z
                 +----------------+
```

Tetapi diagram itu masih terlalu sederhana. Yang lebih penting:

```text
Producer writes fact once.
Kafka stores fact durably.
Many consumers interpret the same fact independently.
Consumers can start now, lag behind, recover, or replay.
```

Kafka bukan hanya transport. Kafka adalah **durable shared history**.

---

## 4. Mental Model Utama: Kafka sebagai Log

### 4.1 Apa itu log?

Log adalah struktur data append-only:

```text
offset 0  -> Event A
offset 1  -> Event B
offset 2  -> Event C
offset 3  -> Event D
```

Record baru ditambahkan di ujung kanan. Record lama tidak di-update seperti row database biasa.

Dalam Kafka, log ini ada di dalam **partition**.

```text
Topic: case-events

Partition 0:
0 -> CaseCreated(caseId=101)
1 -> CaseAssigned(caseId=101)
2 -> CaseEscalated(caseId=101)

Partition 1:
0 -> CaseCreated(caseId=202)
1 -> EvidenceAttached(caseId=202)
2 -> CaseClosed(caseId=202)
```

Offset hanya bermakna di dalam satu partition. Offset 2 di partition 0 berbeda dari offset 2 di partition 1.

### 4.2 Kenapa log penting?

Karena log memberikan beberapa kemampuan sekaligus:

1. **Ordering lokal**  
   Di dalam satu partition, record memiliki urutan jelas.

2. **Replay**  
   Consumer bisa membaca ulang dari offset lama.

3. **Fan-out**  
   Banyak consumer group bisa membaca log yang sama.

4. **Auditability**  
   Event historis bisa menjadi jejak perubahan.

5. **Backpressure isolation**  
   Consumer lambat tidak otomatis menghentikan producer, selama Kafka masih bisa menyimpan data.

6. **Temporal reasoning**  
   Sistem bisa menjawab “apa yang terjadi sebelum state ini terbentuk?”

### 4.3 Log berbeda dari queue biasa

Queue tradisional sering memiliki mental model:

```text
Producer sends message.
Consumer receives message.
Message disappears.
```

Kafka memiliki mental model:

```text
Producer appends record.
Kafka stores record.
Consumer reads record.
Record remains until retention/compaction policy removes it.
Consumer offset moves independently.
```

Ini perbedaan fundamental.

---

## 5. Core Building Blocks

### 5.1 Event / Record

Record Kafka biasanya berisi:

```text
key
value
headers
timestamp
topic
partition
offset
```

Contoh konseptual:

```json
{
  "key": "CASE-2026-0001",
  "value": {
    "eventType": "CaseEscalated",
    "caseId": "CASE-2026-0001",
    "fromLevel": "L1",
    "toLevel": "L2",
    "reason": "SLA_BREACH",
    "occurredAt": "2026-06-19T08:15:00+07:00"
  },
  "headers": {
    "correlationId": "corr-9f31",
    "causationId": "evt-8b72",
    "tenantId": "regulator-id"
  }
}
```

Key bukan sekadar metadata. Key sering menentukan partition.

### 5.2 Topic

Topic adalah nama stream/log secara logical.

Contoh:

```text
case.events.v1
enforcement.decisions.v1
evidence.ingested.v1
notification.commands.v1
payment.transactions.v1
```

Topic harus diperlakukan sebagai kontrak publik. Topic yang buruk akan membuat seluruh ekosistem Kafka sulit dipelihara.

### 5.3 Partition

Partition adalah unit fisik/logical untuk:

1. ordering,
2. parallelism,
3. storage distribution,
4. consumer ownership,
5. replication leadership.

Satu topic bisa memiliki banyak partition:

```text
case.events.v1
  partition 0
  partition 1
  partition 2
  partition 3
```

Jika semua event untuk `caseId=CASE-1` selalu masuk ke partition yang sama, maka urutan event untuk case tersebut bisa dipertahankan.

### 5.4 Offset

Offset adalah posisi record di dalam partition.

```text
partition 0:
  offset 0
  offset 1
  offset 2
```

Offset bukan business ID. Jangan menggunakan offset sebagai ID domain.

Offset digunakan consumer untuk melacak progress.

### 5.5 Broker

Broker adalah server Kafka yang menyimpan partition dan melayani request producer/consumer.

Cluster Kafka terdiri dari beberapa broker:

```text
Broker 1
Broker 2
Broker 3
```

Partition tersebar di antara broker agar storage dan traffic bisa didistribusikan.

### 5.6 Producer

Producer adalah client yang menulis record ke Kafka.

Producer bertanggung jawab atas:

1. memilih topic,
2. menentukan key,
3. memilih partition secara langsung atau lewat partitioner,
4. batching,
5. compression,
6. retry,
7. delivery acknowledgement,
8. idempotence jika diaktifkan.

### 5.7 Consumer

Consumer adalah client yang membaca record dari Kafka.

Consumer bertanggung jawab atas:

1. membaca dari topic-partition,
2. memproses record,
3. mengelola offset,
4. commit progress,
5. menangani error,
6. berkoordinasi dengan consumer lain dalam group.

### 5.8 Consumer Group

Consumer group adalah sekumpulan consumer yang bekerja bersama membaca topic.

Prinsip penting:

```text
Within one consumer group, one partition is owned by at most one active consumer at a time.
Across different consumer groups, the same partition can be read independently.
```

Contoh:

```text
Topic: case.events.v1 with 4 partitions

Consumer Group: audit-projection
  consumer A -> partition 0, 1
  consumer B -> partition 2, 3

Consumer Group: notification-service
  consumer C -> partition 0, 1, 2, 3

Consumer Group: analytics-ingestion
  consumer D -> partition 0
  consumer E -> partition 1
  consumer F -> partition 2
  consumer G -> partition 3
```

Setiap group punya offset sendiri.

---

## 6. Kafka vs Message Queue vs Pub/Sub vs Database

### 6.1 Kafka vs queue tradisional

Queue biasanya berorientasi pada work distribution:

```text
One message -> one worker handles it -> message removed
```

Kafka berorientasi pada durable stream:

```text
One event -> stored in log -> many independent consumers can read it
```

Kafka bisa dipakai untuk work distribution, tetapi itu bukan satu-satunya atau bahkan mental model terbaiknya.

### 6.2 Kafka vs pub/sub biasa

Pub/sub biasa sering berfokus pada delivery ke subscriber saat ini.

Kafka berfokus pada:

1. durable storage,
2. offset-based consumption,
3. replay,
4. retention,
5. stream processing,
6. integration pipeline.

Subscriber baru bisa membaca event lama jika retention masih tersedia.

### 6.3 Kafka vs database

Kafka bukan database umum.

Kafka tidak cocok untuk:

1. ad-hoc query arbitrary,
2. transactional relational integrity,
3. random update by primary key,
4. foreign key constraint,
5. OLTP state mutation,
6. complex SQL query serving.

Tetapi Kafka memiliki kemampuan yang database biasa tidak berikan secara natural:

1. ordered append log,
2. high-throughput event ingestion,
3. fan-out consumption,
4. replayable stream,
5. event time processing,
6. decoupled consumer progress.

Kafka dan database sering dipakai bersama, bukan saling menggantikan.

### 6.4 Kafka vs HTTP

HTTP request-response cocok untuk:

1. query langsung,
2. command sinkron,
3. user-facing interaction,
4. low-latency request with immediate response,
5. control plane API.

Kafka cocok untuk:

1. asynchronous event propagation,
2. high-throughput data movement,
3. integration fan-out,
4. durable audit/event history,
5. stream processing,
6. decoupled downstream processing.

Jangan mengganti semua HTTP dengan Kafka. Kafka bukan RPC protocol.

---

## 7. Kenapa Kafka Penting untuk Java Engineer

Java engineer sering bertemu Kafka dalam bentuk:

1. Spring Kafka listener,
2. producer service,
3. consumer worker,
4. Kafka Streams app,
5. CDC integration,
6. outbox publisher,
7. notification pipeline,
8. audit pipeline,
9. event-driven microservices,
10. data ingestion pipeline.

Masalahnya, banyak engineer hanya belajar API:

```java
kafkaTemplate.send("topic", key, value);
```

atau:

```java
@KafkaListener(topics = "case.events")
public void consume(Event event) {
    // process
}
```

Itu belum cukup.

Engineer yang matang harus memahami:

1. Apa yang terjadi jika producer mendapat timeout tetapi broker sebenarnya sudah menerima record?
2. Apa yang terjadi jika consumer berhasil menulis ke database tetapi crash sebelum commit offset?
3. Apa yang terjadi saat rebalance di tengah batch processing?
4. Apa yang terjadi jika partition key salah dan ordering domain pecah?
5. Apa yang terjadi jika schema berubah tanpa compatibility?
6. Apa yang terjadi jika consumer lag 12 jam dan retention hanya 6 jam?
7. Apa yang terjadi jika satu key menjadi hot dan satu partition overload?
8. Apa yang terjadi jika DLQ menjadi kuburan event tanpa owner?
9. Apa yang terjadi jika event dianggap command tetapi diberi nama seperti fact?
10. Apa yang terjadi jika Kafka dipakai untuk synchronous approval workflow?

Top 1% Kafka engineer bukan hanya bisa menulis producer/consumer. Mereka bisa memodelkan konsekuensi.

---

## 8. Kafka sebagai Event Streaming Platform

Kafka ecosystem biasanya mencakup beberapa layer:

```text
+------------------------------------------------------+
| Applications / Microservices                         |
| Java, Spring Boot, Go, .NET, Node.js                 |
+------------------------------------------------------+
| Stream Processing                                    |
| Kafka Streams, ksqlDB, Flink, Spark Structured Stream|
+------------------------------------------------------+
| Integration                                          |
| Kafka Connect, CDC, Debezium, JDBC, S3, Search       |
+------------------------------------------------------+
| Governance                                           |
| Schema Registry, ACL, quotas, topic catalog          |
+------------------------------------------------------+
| Core Kafka                                           |
| Broker, topic, partition, offset, consumer group     |
+------------------------------------------------------+
| Infrastructure                                       |
| Disk, network, OS page cache, Kubernetes/VM/cloud    |
+------------------------------------------------------+
```

Bagian Part 000 ini berada di level mental model. Part berikutnya akan turun ke detail teknis.

---

## 9. Kafka Ecosystem: Gambaran Awal

### 9.1 Kafka Core

Kafka Core mencakup:

1. broker,
2. topic,
3. partition,
4. producer API,
5. consumer API,
6. admin API,
7. replication,
8. controller/quorum,
9. retention,
10. compaction,
11. security.

Ini adalah fondasi.

### 9.2 Kafka Connect

Kafka Connect adalah framework untuk memindahkan data antara Kafka dan sistem lain.

Contoh source connector:

```text
PostgreSQL CDC -> Kafka
MySQL CDC      -> Kafka
JDBC Source    -> Kafka
File Source    -> Kafka
```

Contoh sink connector:

```text
Kafka -> S3/Object Storage
Kafka -> Elasticsearch/OpenSearch
Kafka -> JDBC Database
Kafka -> Data Warehouse
```

Connect penting karena custom integration service sering mengulang masalah yang sama:

1. offset tracking,
2. retry,
3. schema conversion,
4. task parallelism,
5. deployment,
6. connector status,
7. error handling.

Tetapi Connect bukan silver bullet. Kita akan membahas kapan memakai Connect dan kapan menulis service sendiri.

### 9.3 Schema Registry

Schema Registry adalah komponen governance untuk schema event.

Tanpa schema governance, Kafka topic mudah menjadi “JSON landfill”.

Masalah umum tanpa schema:

```json
{
  "case_id": "123",
  "status": "OPEN"
}
```

lalu berubah menjadi:

```json
{
  "caseId": 123,
  "caseStatus": "OPENED"
}
```

Consumer bisa rusak diam-diam.

Schema Registry membantu mengelola:

1. schema version,
2. compatibility,
3. serialization format,
4. producer-consumer contract,
5. schema evolution.

### 9.4 Kafka Streams

Kafka Streams adalah Java library untuk stream processing.

Contoh penggunaan:

1. enrich event,
2. aggregate event,
3. join stream-table,
4. detect pattern,
5. build projection,
6. maintain local state store.

Kafka Streams bukan external cluster seperti Spark/Flink. Ia berjalan sebagai aplikasi Java biasa, tetapi menggunakan Kafka untuk input, output, partitioning, coordination, changelog, dan fault tolerance.

### 9.5 ksqlDB

ksqlDB menyediakan interface SQL-like untuk stream processing di atas Kafka.

Contoh konseptual:

```sql
CREATE STREAM escalated_cases AS
SELECT caseId, reason, occurredAt
FROM case_events
WHERE eventType = 'CaseEscalated';
```

ksqlDB cocok untuk:

1. prototyping stream processing,
2. simple filtering,
3. stream/table transformations,
4. operational projections,
5. SQL-oriented teams.

Tetapi untuk logic kompleks, lifecycle state machine rumit, atau testing deterministik di Java, Kafka Streams atau custom service sering lebih tepat.

---

## 10. Kafka Bukan Hanya Messaging

Kafka sering salah diposisikan sebagai “message broker”. Itu tidak sepenuhnya salah, tetapi terlalu sempit.

Kafka dapat dipakai sebagai:

1. **Messaging backbone**  
   Service mengirim event ke service lain.

2. **Event log**  
   Sistem menyimpan perubahan domain sebagai sequence event.

3. **Data integration bus**  
   Data dari database, service, dan external system dialirkan ke banyak sink.

4. **Stream processing substrate**  
   Event diproses terus-menerus untuk menghasilkan event/state baru.

5. **Audit trail**  
   Event immutable menjadi bukti proses.

6. **Replay platform**  
   Consumer baru atau versi baru bisa memproses ulang data lama.

7. **Decoupling layer**  
   Producer tidak perlu tahu semua downstream.

8. **Temporal state reconstruction layer**  
   Sistem bisa membangun ulang state berdasarkan event historis.

Tetapi Kafka tidak cocok sebagai:

1. RPC replacement,
2. low-volume simple queue tanpa kebutuhan replay,
3. request-response API untuk UI,
4. relational database,
5. distributed transaction manager umum,
6. workflow engine lengkap,
7. scheduler utama,
8. tempat menyimpan file besar secara langsung,
9. sistem authorization bisnis,
10. solusi otomatis untuk konsistensi data.

---

## 11. Event: Fact, Command, atau State?

Ini fondasi penting sebelum masuk desain topic.

### 11.1 Event sebagai fact

Event idealnya merepresentasikan fakta yang sudah terjadi.

Contoh:

```text
CaseCreated
CaseAssigned
CaseEscalated
EvidenceAttached
DecisionIssued
CaseClosed
```

Kalimatnya:

```text
Something happened.
```

### 11.2 Command sebagai permintaan

Command merepresentasikan instruksi agar sesuatu dilakukan.

Contoh:

```text
CreateCase
AssignCase
EscalateCase
SendNotification
GenerateReport
```

Kalimatnya:

```text
Please do something.
```

### 11.3 State sebagai kondisi saat ini

State merepresentasikan nilai terbaru.

Contoh:

```json
{
  "caseId": "CASE-1",
  "status": "ESCALATED",
  "assignedUnit": "L2",
  "lastUpdatedAt": "2026-06-19T08:15:00+07:00"
}
```

Kafka bisa membawa event, command, atau state snapshot. Tetapi masing-masing punya konsekuensi.

### 11.4 Kesalahan umum

Nama event:

```text
CaseUpdated
```

Masalah:

1. Apa yang berubah?
2. Mengapa berubah?
3. Siapa yang menyebabkan?
4. Apakah ini assignment, escalation, correction, review, closure?
5. Consumer mana yang harus bereaksi?

Lebih baik:

```text
CasePriorityChanged
CaseAssigned
CaseEscalated
CaseReviewRequested
CaseDecisionIssued
CaseReopened
```

Event yang baik mengurangi interpretasi ambigu.

---

## 12. Kafka dan Regulatory / Case Management Systems

Untuk konteks enforcement lifecycle, Kafka sangat relevan bila digunakan dengan hati-hati.

### 12.1 Kenapa relevan?

Regulatory systems sering membutuhkan:

1. audit trail,
2. lifecycle reconstruction,
3. escalation logic,
4. SLA monitoring,
5. cross-entity impact,
6. asynchronous notification,
7. evidence ingestion,
8. decision traceability,
9. downstream analytics,
10. human-in-the-loop workflow.

Kafka cocok untuk event seperti:

```text
CaseRegistered
CaseValidated
EvidenceSubmitted
EvidenceVerified
RiskScoreCalculated
CaseAssigned
SlaTimerStarted
SlaBreached
CaseEscalated
EnforcementActionRecommended
DecisionApproved
DecisionPublished
AppealSubmitted
CaseClosed
```

### 12.2 Kafka membantu menjawab pertanyaan defensibility

Contoh pertanyaan regulator/auditor:

1. Kapan case dibuat?
2. Data apa yang diketahui pada saat keputusan dibuat?
3. Siapa/apa yang menyebabkan escalation?
4. Apakah SLA dilanggar sebelum atau setelah assignment?
5. Apakah evidence baru masuk setelah decision?
6. Apakah review dilakukan berdasarkan data versi mana?
7. Apakah correction mengubah fakta lama atau membuat fakta korektif baru?

Event log membantu membangun narrative berbasis waktu.

### 12.3 Tetapi Kafka bukan workflow engine penuh

Kafka tidak secara otomatis menyediakan:

1. BPMN,
2. task inbox,
3. user assignment UI,
4. authorization bisnis,
5. form lifecycle,
6. deadline calendar semantics,
7. compensation orchestration,
8. manual approval screen,
9. case note editing,
10. document management.

Kafka bisa menjadi event backbone untuk workflow platform, tetapi bukan pengganti seluruh case management engine.

---

## 13. Mental Model: Producer, Kafka, Consumer

### 13.1 Producer perspective

Producer berpikir:

```text
I have a fact/record.
I choose topic.
I choose key.
Kafka chooses or receives partition.
I wait for acknowledgement depending on configuration.
```

Producer harus memutuskan:

1. Apa event yang benar?
2. Topic mana?
3. Key apa?
4. Serialization apa?
5. Header apa?
6. Apakah butuh idempotence?
7. Apakah bisa retry?
8. Apa yang dilakukan jika send gagal?

### 13.2 Kafka perspective

Kafka berpikir:

```text
Append record to partition leader.
Replicate to followers.
Expose record to consumers after durability condition is met.
Retain record according to policy.
```

Kafka tidak memahami business semantics event. Kafka tidak tahu apakah `CaseEscalated` valid secara domain.

### 13.3 Consumer perspective

Consumer berpikir:

```text
Fetch record from assigned partitions.
Process record.
Commit offset when safe.
Handle duplicates.
Handle poison records.
Survive rebalance.
```

Consumer harus memutuskan:

1. Kapan commit offset?
2. Apakah processing idempotent?
3. Bagaimana retry?
4. Bagaimana DLQ?
5. Bagaimana backpressure?
6. Bagaimana shutdown?
7. Bagaimana observability?

---

## 14. Delivery Semantics: Gambaran Awal

Nanti ada part khusus, tetapi orientasi awal penting.

### 14.1 At-most-once

```text
Commit offset before processing.
If crash happens during processing, record may be lost from application's perspective.
```

Risiko: data hilang.

### 14.2 At-least-once

```text
Process first, then commit offset.
If crash happens after processing but before commit, record will be processed again.
```

Risiko: duplicate.

Ini default mental model paling umum untuk Kafka applications.

### 14.3 Exactly-once

Kafka memiliki fitur idempotent producer dan transactions, terutama kuat untuk Kafka-to-Kafka pipelines.

Tetapi jangan menyimpulkan:

```text
Kafka exactly-once = seluruh sistem exactly-once
```

Jika consumer menulis ke external database, mengirim email, memanggil HTTP API, atau membuat side effect di luar Kafka, guarantee menjadi lebih kompleks.

Prinsip praktis:

```text
Design consumers to tolerate duplicates.
Use idempotency keys.
Treat external side effects carefully.
```

---

## 15. Ordering: Salah Satu Konsep Paling Sering Disalahpahami

Kafka tidak memberikan global ordering untuk seluruh topic jika topic memiliki lebih dari satu partition.

Kafka memberikan ordering di dalam partition.

```text
Topic: case.events.v1

Partition 0:
  offset 0: CaseCreated(CASE-1)
  offset 1: CaseAssigned(CASE-1)
  offset 2: CaseEscalated(CASE-1)

Partition 1:
  offset 0: CaseCreated(CASE-2)
  offset 1: CaseClosed(CASE-2)
```

Tidak ada makna absolut bahwa partition 0 offset 2 terjadi sebelum partition 1 offset 1 hanya berdasarkan offset.

Kalau kamu butuh ordering per case, gunakan `caseId` sebagai key agar event untuk case yang sama masuk partition yang sama.

Tetapi konsekuensinya:

1. case dengan traffic tinggi bisa menyebabkan hot partition,
2. partition count membatasi parallelism consumer group,
3. perubahan partition count bisa mengubah mapping key ke partition,
4. key design menjadi keputusan arsitektural, bukan detail teknis.

---

## 16. Retention dan Replay

Kafka menyimpan record berdasarkan retention policy.

Contoh:

```text
retention.ms = 7 days
```

Artinya record bisa dihapus setelah melewati batas retention, walaupun belum semua consumer membacanya.

Ini penting:

```text
Kafka retention is not based on whether all consumers have consumed the record.
```

Jika consumer mati 10 hari tetapi retention 7 hari, consumer mungkin kehilangan data.

Replay bergantung pada:

1. data masih tersedia,
2. offset masih valid,
3. schema masih bisa dibaca,
4. consumer logic bisa memproses event lama,
5. side effects aman untuk diulang.

Replay bukan tombol ajaib. Replay adalah kemampuan yang harus didesain.

---

## 17. Compaction: Gambaran Awal

Retention delete menyimpan data berdasarkan waktu/ukuran.

Compaction menyimpan record terbaru per key.

Contoh compacted topic:

```text
key=CASE-1 value=status=OPEN
key=CASE-2 value=status=OPEN
key=CASE-1 value=status=ESCALATED
key=CASE-2 value=status=CLOSED
```

Setelah compaction, Kafka dapat membuang record lama untuk key yang sama dan mempertahankan nilai terbaru.

Compacted topic berguna untuk:

1. reference data,
2. latest state cache,
3. changelog Kafka Streams,
4. table-like stream representation.

Tetapi compaction bukan database biasa. Tidak ada arbitrary query, constraint, join relational, atau transactional update seperti RDBMS.

---

## 18. Common Kafka Use Cases

### 18.1 Event-driven microservices

Service menerbitkan domain event; service lain bereaksi.

```text
Case Service -> CaseEscalated -> Notification Service
Case Service -> CaseEscalated -> SLA Analytics
Case Service -> CaseEscalated -> Audit Projection
```

### 18.2 Data integration

Kafka menjadi backbone data movement.

```text
PostgreSQL CDC -> Kafka -> Data Lake
Application Event -> Kafka -> Search Index
Telemetry -> Kafka -> Real-time Dashboard
```

### 18.3 Stream processing

Event diproses menjadi event/state baru.

```text
case.events + sla.rules -> sla.breach.events
transaction.events -> fraud.alerts
sensor.readings -> anomaly.events
```

### 18.4 Audit and compliance

Kafka menyimpan immutable sequence untuk reconstruction.

```text
CaseCreated -> EvidenceAttached -> RiskCalculated -> DecisionApproved
```

### 18.5 CQRS projection

Write model menerbitkan event; read model dibangun secara asynchronous.

```text
case.events -> case_search_projection
case.events -> case_dashboard_projection
case.events -> case_audit_projection
```

### 18.6 CDC and outbox

Aplikasi menulis database dan outbox table dalam satu transaction. CDC connector mengirim outbox event ke Kafka.

```text
Application DB transaction:
  insert/update business table
  insert outbox_event

CDC:
  outbox_event -> Kafka topic
```

Ini membantu menghindari dual-write problem.

---

## 19. Kapan Kafka Tepat Digunakan

Kafka layak dipertimbangkan jika kamu memiliki beberapa kondisi berikut:

### 19.1 Banyak downstream membutuhkan event yang sama

Contoh:

```text
CaseEscalated dibutuhkan oleh:
- notification service
- SLA monitoring
- audit service
- analytics pipeline
- management dashboard
- compliance reporting
```

Kafka memungkinkan producer publish once, consumers consume independently.

### 19.2 Butuh replay

Contoh:

1. bug di consumer projection,
2. perlu membangun read model baru,
3. perlu backfill analytics,
4. perlu audit reconstruction,
5. perlu menjalankan logic versi baru terhadap event lama.

### 19.3 Throughput tinggi

Kafka kuat untuk high-throughput append/read workload.

### 19.4 Consumer lambat tidak boleh menjatuhkan producer

Kafka memungkinkan buffer durable antara producer dan consumer.

### 19.5 Integrasi data lintas sistem

Kafka cocok sebagai pusat pergerakan data antar operational system, data platform, search, monitoring, dan downstream service.

### 19.6 Event menjadi first-class artifact

Jika event adalah bagian penting dari model bisnis, Kafka bisa menjadi backbone yang kuat.

---

## 20. Kapan Kafka Tidak Tepat

Kafka sering dipakai secara berlebihan. Beberapa situasi yang tidak ideal:

### 20.1 Hanya butuh simple queue kecil

Jika hanya ada satu producer, satu consumer, volume rendah, tidak butuh replay, tidak butuh fan-out, tidak butuh stream processing, maka Kafka mungkin terlalu berat.

### 20.2 Butuh request-response sinkron

Contoh:

```text
User clicks button -> UI needs immediate answer
```

HTTP/gRPC biasanya lebih tepat.

### 20.3 Butuh transaksi multi-entity kompleks dengan query relational

Gunakan database.

### 20.4 Tim belum siap dengan operational complexity

Kafka membawa kompleksitas:

1. partitioning,
2. lag monitoring,
3. schema compatibility,
4. rebalance,
5. DLQ,
6. retention,
7. capacity planning,
8. security,
9. consumer idempotency,
10. incident recovery.

### 20.5 Event model belum jelas

Kafka tidak memperbaiki domain model yang buruk. Kafka justru menyebarkan domain model buruk ke banyak consumer.

### 20.6 Menginginkan exactly-once side effect universal

Kafka tidak menghapus kompleksitas side effect external.

---

## 21. Anti-Patterns Awal

### 21.1 Kafka sebagai RPC bus

Buruk:

```text
Service A sends command to Kafka and waits synchronously for response topic.
```

Kadang request-reply via Kafka valid untuk kasus tertentu, tetapi jika dipakai sebagai pengganti HTTP untuk semua interaksi, sistem menjadi sulit di-debug dan latency tidak natural.

### 21.2 Satu topic besar bernama `events`

Buruk:

```text
events
```

Berisi semua event dari semua domain.

Masalah:

1. ownership kabur,
2. schema kacau,
3. access control sulit,
4. retention sulit,
5. consumer harus filter terlalu banyak,
6. governance runtuh.

### 21.3 Event tanpa key

Jika event butuh ordering per entity tetapi key null, ordering domain pecah.

### 21.4 Menganggap offset sebagai business ID

Offset adalah posisi teknis, bukan identity domain.

### 21.5 Auto-commit tanpa memahami konsekuensi

Auto-commit bisa membuat record dianggap selesai sebelum benar-benar selesai diproses.

### 21.6 DLQ tanpa ownership

DLQ bukan tempat pembuangan akhir. DLQ harus punya:

1. owner,
2. alert,
3. replay process,
4. classification,
5. retention,
6. remediation workflow.

### 21.7 Retention pendek untuk stream yang perlu replay

Jika bisnis berharap bisa replay 30 hari, retention 3 hari adalah bug arsitektur.

### 21.8 Schema-free JSON untuk integrasi enterprise

JSON tanpa governance mudah rusak saat evolusi.

### 21.9 Semua event pakai `EntityUpdated`

Consumer harus menebak perubahan. Domain semantics hilang.

### 21.10 Menambah partition tanpa memahami ordering impact

Menambah partition bisa mengubah distribusi key untuk record baru. Ini bisa mempengaruhi ordering assumption bila tidak direncanakan.

---

## 22. Kafka dari Perspektif Distributed Systems

Kafka menggabungkan beberapa prinsip distributed systems:

### 22.1 Replication

Data partition direplikasi agar broker failure tidak langsung menyebabkan data hilang.

### 22.2 Leader-based writes

Setiap partition memiliki leader replica yang menerima write/read utama, sementara follower mereplikasi.

### 22.3 Quorum-like durability configuration

Durability dipengaruhi oleh kombinasi:

```text
replication.factor
min.insync.replicas
producer acks
```

### 22.4 Backpressure by lag

Consumer lambat menyebabkan lag, bukan langsung menghapus data.

### 22.5 Coordination

Consumer group membutuhkan koordinasi untuk assignment partition.

### 22.6 Failure detection

Consumer heartbeat, session timeout, max poll interval, dan broker/controller state menentukan kapan sistem menganggap node gagal.

### 22.7 Ordering vs parallelism trade-off

Semakin kuat ordering domain, semakin terbatas parallelism. Semakin banyak partition, semakin tinggi parallelism tetapi ordering global makin tidak tersedia.

---

## 23. Kafka dari Perspektif Architecture Decision

Saat memutuskan Kafka, jangan mulai dari “kita butuh Kafka”. Mulai dari pertanyaan:

1. Event apa yang menjadi first-class?
2. Siapa producer authoritative?
3. Siapa consumer?
4. Apakah consumer perlu replay?
5. Berapa retention yang dibutuhkan?
6. Apa ordering domain?
7. Apa partition key?
8. Apa schema dan compatibility policy?
9. Apa delivery semantics yang dibutuhkan?
10. Apa side effect consumer?
11. Bagaimana duplicate ditangani?
12. Bagaimana poison event ditangani?
13. Bagaimana lag dimonitor?
14. Bagaimana topic dikelola?
15. Siapa owner event contract?
16. Bagaimana akses dikontrol?
17. Apa incident runbook?
18. Apa cost model?

Kafka adalah keputusan platform, bukan hanya library dependency.

---

## 24. Minimal Vocabulary yang Harus Dikuasai

Sebelum lanjut ke Part 001, pastikan istilah berikut tidak asing:

| Istilah | Makna Singkat |
|---|---|
| Record | Unit data yang ditulis ke Kafka |
| Event | Record yang merepresentasikan fakta yang terjadi |
| Topic | Nama logical stream/log |
| Partition | Log terurut di dalam topic |
| Offset | Posisi record di partition |
| Broker | Server Kafka |
| Cluster | Kumpulan broker |
| Producer | Client yang menulis record |
| Consumer | Client yang membaca record |
| Consumer group | Kelompok consumer yang berbagi partition ownership |
| Key | Nilai yang sering dipakai menentukan partition |
| Retention | Kebijakan berapa lama data disimpan |
| Compaction | Kebijakan menyimpan latest value per key |
| Lag | Selisih antara posisi latest record dan progress consumer |
| Rebalance | Redistribusi partition ownership dalam consumer group |
| ISR | In-sync replicas |
| ACK | Acknowledgement producer write |
| SerDe | Serializer/deserializer |
| Schema | Struktur data event |
| DLQ | Dead letter queue/topic untuk record bermasalah |

---

## 25. Java Engineer Perspective: Apa yang Akan Berubah dari Cara Berpikir Backend Biasa

### 25.1 Dari request lifecycle ke event lifecycle

Backend HTTP biasa:

```text
request -> validate -> transaction -> response
```

Kafka/event system:

```text
event produced -> stored -> consumed by many -> projected/transformed/replayed -> monitored
```

### 25.2 Dari call stack ke causality chain

Dalam sistem synchronous, call stack relatif jelas.

Dalam event-driven system, kamu butuh metadata:

```text
correlationId
causationId
eventId
traceId
producer
occurredAt
schemaVersion
```

Tanpa itu, debugging menjadi sulit.

### 25.3 Dari exception handling ke failure pipeline

Dalam HTTP, exception sering langsung dikembalikan ke caller.

Dalam Kafka, failure bisa menjadi:

1. retry,
2. pause partition,
3. skip,
4. DLQ,
5. poison event quarantine,
6. alert,
7. replay,
8. compensation.

### 25.4 Dari transaction boundary ke idempotency boundary

Dalam database transaction, atomicity relatif lokal.

Dalam Kafka, side effect bisa tersebar.

Pertanyaan penting:

```text
If this event is processed twice, what happens?
```

Jika jawabannya “data rusak”, consumer belum production-ready.

### 25.5 Dari current state ke historical timeline

Dalam sistem case management, current state tidak cukup.

Kamu perlu tahu:

```text
How did this state happen?
What was known at that time?
Which event caused the transition?
Was the transition valid according to policy at that time?
```

Kafka membantu jika event dirancang benar.

---

## 26. Example: Enforcement Case Lifecycle dengan Kafka

Bayangkan sistem enforcement case.

### 26.1 Tanpa Kafka

```text
Case Service writes DB.
Case Service calls Notification Service.
Case Service calls Audit Service.
Case Service calls Analytics Service.
Case Service calls SLA Service.
```

Masalah:

1. Case Service terlalu tahu downstream.
2. Jika Analytics lambat, apakah case transaction gagal?
3. Jika Notification gagal, apakah case escalation rollback?
4. Jika audit service down, apakah event hilang?
5. Jika nanti ada Fraud Service baru, bagaimana membaca event lama?

### 26.2 Dengan Kafka

```text
Case Service -> case.events.v1

case.events.v1 -> Audit Projection
case.events.v1 -> Notification Service
case.events.v1 -> SLA Monitor
case.events.v1 -> Analytics Ingestion
case.events.v1 -> Management Dashboard Projection
```

Case Service menerbitkan fakta:

```json
{
  "eventId": "evt-1001",
  "eventType": "CaseEscalated",
  "caseId": "CASE-2026-0001",
  "fromQueue": "L1",
  "toQueue": "L2",
  "reason": "SLA_BREACH",
  "occurredAt": "2026-06-19T10:00:00+07:00"
}
```

Consumer bisa memproses sesuai kebutuhan masing-masing.

### 26.3 Apa yang harus dijaga?

1. Event harus immutable.
2. Event harus punya ID.
3. Event harus punya waktu kejadian.
4. Event harus punya reason.
5. Event harus punya causation/correlation.
6. Event harus punya schema yang berevolusi aman.
7. Consumer harus idempotent.
8. Retention harus sesuai kebutuhan replay/audit.
9. DLQ harus dikelola.
10. Access control harus sesuai sensitivity data.

---

## 27. Skill Matrix: Dari Beginner ke Top 1%

### 27.1 Beginner

Bisa:

1. membuat topic,
2. menulis producer sederhana,
3. menulis consumer sederhana,
4. menjalankan Kafka lokal,
5. melihat message masuk.

Belum cukup untuk production.

### 27.2 Intermediate

Bisa:

1. memahami partition dan offset,
2. memakai consumer group,
3. mengatur serializer/deserializer,
4. melakukan manual commit,
5. menangani retry sederhana,
6. membaca consumer lag,
7. memakai Schema Registry dasar.

### 27.3 Senior

Bisa:

1. mendesain topic boundary,
2. memilih partition key,
3. menjelaskan delivery semantics,
4. membuat consumer idempotent,
5. mendesain DLQ dan replay,
6. mengelola schema evolution,
7. menganalisis rebalance,
8. merancang outbox/CDC,
9. mengoperasikan Connect,
10. mengobservasi broker/producer/consumer.

### 27.4 Staff / Principal / Top 1%

Bisa:

1. memodelkan failure sebelum terjadi,
2. membuat Kafka architecture decision record,
3. menimbang Kafka vs alternative secara jernih,
4. mendesain governance lintas tim,
5. menetapkan event taxonomy enterprise,
6. mendesain multi-region strategy,
7. menentukan retention/security/compliance posture,
8. mengoptimalkan cost/performance,
9. men-debug incident lintas producer-broker-consumer,
10. membangun platform operating model,
11. membedakan event, command, state, projection, dan workflow,
12. menjelaskan trade-off Kafka kepada engineer, product, compliance, dan leadership.

---

## 28. Checklist: Apakah Kamu Sudah Memahami Part 000?

Jawab pertanyaan berikut tanpa melihat catatan:

1. Mengapa Kafka lebih tepat dipahami sebagai log daripada queue?
2. Apa perbedaan topic dan partition?
3. Apa makna offset?
4. Apakah offset global untuk seluruh topic?
5. Mengapa key penting?
6. Apa guarantee ordering Kafka?
7. Mengapa consumer group penting?
8. Apa perbedaan satu consumer group dan banyak consumer group?
9. Apa perbedaan event dan command?
10. Mengapa `CaseUpdated` adalah event yang lemah?
11. Apa risiko auto-commit?
12. Mengapa replay tidak otomatis aman?
13. Apa peran retention?
14. Mengapa Kafka bukan database relational?
15. Mengapa Kafka bukan pengganti HTTP?
16. Apa itu DLQ dan mengapa harus punya owner?
17. Apa yang terjadi jika consumer crash setelah side effect tetapi sebelum offset commit?
18. Mengapa exactly-once tidak otomatis berlaku untuk external database?
19. Kapan Kafka terlalu berat?
20. Apa pertanyaan arsitektural sebelum memperkenalkan Kafka?

Jika kamu bisa menjawab semuanya, kamu siap masuk Part 001.

---

## 29. Latihan Mental Model

### Latihan 1 — Queue atau Kafka?

Kamu memiliki sistem yang mengirim email welcome user baru.

Kondisi A:

```text
Satu service menghasilkan task.
Satu worker mengirim email.
Tidak butuh replay.
Volume kecil.
```

Kafka mungkin terlalu berat.

Kondisi B:

```text
UserRegistered event dibutuhkan oleh email service, fraud service, analytics, audit, CRM sync, dan recommendation system.
Consumer baru perlu bisa membaca event historis.
```

Kafka mulai masuk akal.

### Latihan 2 — Pilih key

Event:

```text
CaseEscalated
```

Kandidat key:

```text
caseId
tenantId
assignedOfficerId
random UUID
null
```

Pertanyaan:

1. Ordering apa yang dibutuhkan?
2. Apakah semua event untuk case yang sama harus urut?
3. Apakah tenant tertentu bisa menjadi hot?
4. Apakah officer tertentu bisa menjadi hot?
5. Apakah null key menghancurkan ordering per case?

Jawaban awal yang sering masuk akal: `caseId`, jika ordering per case adalah requirement utama.

### Latihan 3 — Duplicate handling

Consumer menerima event:

```text
CaseEscalated(eventId=evt-123, caseId=CASE-1)
```

Consumer mengirim notification.

Pertanyaan:

1. Apa yang terjadi jika event diproses dua kali?
2. Apakah user menerima dua email?
3. Apakah notification table punya idempotency key?
4. Apakah `eventId` disimpan sebagai processed key?
5. Apakah side effect external bisa dicegah duplicate-nya?

### Latihan 4 — Replay risk

Consumer analytics memiliki bug selama 3 hari. Kamu ingin replay event 3 hari terakhir.

Pertanyaan:

1. Apakah retention cukup?
2. Apakah schema lama masih compatible?
3. Apakah consumer bisa membedakan replay vs live?
4. Apakah output analytics akan duplicate?
5. Apakah external sink mendukung upsert/idempotency?

---

## 30. Production Readiness Thinking dari Hari Pertama

Bahkan saat baru belajar, biasakan bertanya:

### 30.1 Untuk producer

1. Apa event contract-nya?
2. Apa key-nya?
3. Apa schema-nya?
4. Apa retry behavior-nya?
5. Apa yang terjadi jika send timeout?
6. Apakah producer idempotence aktif?
7. Apakah event bisa diproduksi dua kali?
8. Apakah event ID stabil?

### 30.2 Untuk topic

1. Siapa owner?
2. Apa naming convention?
3. Berapa partition?
4. Apa retention?
5. Apakah compacted?
6. Siapa boleh produce?
7. Siapa boleh consume?
8. Apa schema compatibility?

### 30.3 Untuk consumer

1. Apa consumer group ID?
2. Kapan offset commit?
3. Apakah idempotent?
4. Apa retry policy?
5. Apa DLQ policy?
6. Bagaimana handle poison event?
7. Apa lag alert?
8. Bagaimana graceful shutdown?

### 30.4 Untuk platform

1. Bagaimana broker monitored?
2. Bagaimana topic governance?
3. Bagaimana schema governance?
4. Bagaimana access control?
5. Bagaimana capacity planning?
6. Bagaimana incident response?
7. Bagaimana upgrade?
8. Bagaimana disaster recovery?

---

## 31. Peta Belajar Setelah Part 000

Part berikutnya akan memperdalam log model.

Urutan awal:

```text
Part 000: Orientation
Part 001: The Log Mental Model
Part 002: Broker Internals
Part 003: Cluster Architecture and KRaft
Part 004: Producers Deep Dive
Part 005: Partitioning Strategy
Part 006: Consumers Deep Dive
Part 007: Consumer Groups and Rebalancing
Part 008: Delivery Semantics
```

Jangan lompat ke Kafka Connect atau ksqlDB sebelum memahami Part 001–008. Connect dan ksqlDB akan terasa seperti magic jika fondasi offset, partition, consumer group, retention, dan delivery semantics belum kuat.

---

## 32. Ringkasan

Kafka adalah:

```text
Distributed append-only log
+ durable event storage
+ partitioned scalability
+ independent consumer progress
+ replayable stream
+ integration backbone
+ stream processing substrate
```

Kafka bukan sekadar:

```text
message queue
RPC replacement
database replacement
workflow engine replacement
magic exactly-once system
```

Mental model paling penting:

```text
Producer appends facts to a partitioned log.
Kafka stores those facts durably according to retention/compaction policy.
Consumers independently read and process those facts using offsets.
Many systems can derive different meanings and projections from the same event history.
```

Untuk menjadi sangat kuat di Kafka, kamu harus menguasai bukan hanya API, tetapi juga:

1. event modelling,
2. partitioning,
3. ordering,
4. offset management,
5. delivery semantics,
6. idempotency,
7. schema evolution,
8. consumer group rebalancing,
9. replay,
10. DLQ,
11. observability,
12. failure modelling,
13. platform governance,
14. architecture trade-off.

---

## 33. Referensi Resmi dan Bacaan Lanjutan

Referensi berikut digunakan sebagai dasar orientasi dan akan kembali dipakai di part-part berikutnya:

1. Apache Kafka Documentation — Introduction and Core Concepts  
   https://kafka.apache.org/documentation/

2. Apache Kafka — Main Project Page  
   https://kafka.apache.org/

3. Apache Kafka KRaft Documentation  
   https://kafka.apache.org/41/operations/kraft/

4. Apache Kafka Streams Documentation  
   https://kafka.apache.org/documentation/streams/

5. Confluent Schema Registry Documentation  
   https://docs.confluent.io/platform/current/schema-registry/index.html

6. Confluent Kafka Streams Introduction  
   https://docs.confluent.io/platform/current/streams/introduction.html

7. Confluent Kafka Connect JDBC Connector Overview  
   https://docs.confluent.io/kafka-connectors/jdbc/current/overview.html

8. Confluent ksqlDB Overview  
   https://docs.confluent.io/platform/current/ksqldb/overview.html

---

## 34. Status Seri

**Status:** Seri belum selesai.  
**Part selesai:** Part 000 dari 034.  
**Part berikutnya:** `learn-kafka-event-streaming-mastery-for-java-engineers-part-001.md` — The Log Mental Model: Topics, Partitions, Offsets, and Ordering.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-001.md">Part 001 — The Log Mental Model: Topics, Partitions, Offsets, and Ordering ➡️</a>
</div>

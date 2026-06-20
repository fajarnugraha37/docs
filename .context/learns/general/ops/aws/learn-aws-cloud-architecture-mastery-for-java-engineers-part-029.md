# learn-aws-cloud-architecture-mastery-for-java-engineers-part-029.md

# Part 029 — Data Movement and Analytics on AWS: Glue, Athena, Lake Formation, Redshift, EMR, MSK, Firehose

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Bagian: `029`  
> Status seri: **belum selesai**  
> Fokus: data movement dan analytics architecture di AWS tanpa mengulang internals Kafka, ClickHouse, SQL engine, atau database yang sudah dibahas pada seri sebelumnya.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas bagaimana data bergerak dari sistem transaksi menuju analytical system di AWS.

Kita tidak akan mengulang:

- SQL internals;
- query planner;
- Kafka consumer group internals;
- OLAP columnar database internals;
- data warehouse theory secara akademik;
- Spark programming secara mendalam;
- database indexing fundamentals.

Yang kita bahas adalah **arsitektur AWS-native untuk data movement dan analytics**:

- kapan data perlu dipindahkan;
- kapan data cukup direferensikan;
- bagaimana membangun data lake di S3;
- bagaimana catalog bekerja;
- bagaimana Athena membaca data;
- bagaimana Glue melakukan ETL;
- bagaimana Lake Formation mengontrol akses;
- kapan Redshift dipakai;
- kapan EMR masuk akal;
- bagaimana Firehose menyederhanakan streaming delivery;
- bagaimana MSK/Kinesis ditempatkan dalam analytical pipeline;
- bagaimana menghindari cost explosion;
- bagaimana menjaga auditability, lineage, dan governance.

Target akhir bagian ini: Anda bisa mendesain pipeline data AWS dengan jelas, bukan sekadar berkata “pakai S3 + Glue + Athena”.

---

## 1. Mental Model: Operational Data vs Analytical Data

Sistem produksi biasanya memiliki dua dunia data:

1. **Operational data**  
   Data yang dipakai aplikasi untuk menjalankan transaksi, workflow, enforcement lifecycle, user journey, dan state machine.

2. **Analytical data**  
   Data yang dipakai untuk reporting, audit analysis, investigation, trend detection, compliance review, ML, dashboard, dan decision support.

Kesalahan umum adalah mencampur keduanya.

Contoh buruk:

```text
Java API production database
  ├── melayani request user
  ├── menjalankan transaction
  ├── menjadi sumber laporan kompleks
  ├── di-query analyst langsung
  ├── dipakai batch export malam
  └── dipakai dashboard near-real-time
```

Akibat:

- OLTP database overload;
- query reporting mengunci resource penting;
- indexing dipaksa melayani dua access pattern yang berbeda;
- backup/restore dan retention menjadi kacau;
- audit trail sulit dipisahkan dari operational mutation;
- tim aplikasi menjadi bottleneck setiap ada kebutuhan report.

Desain yang lebih sehat:

```text
Operational System
  ├── serves application path
  ├── emits events / CDC / exports
  ↓
Analytical Platform
  ├── stores raw immutable data
  ├── catalogs metadata
  ├── transforms curated datasets
  ├── serves query/report/BI/ML
  └── enforces analytical governance
```

Prinsip penting:

> Analytical platform harus menghormati source-of-truth, tetapi tidak boleh membuat source-of-truth menjadi bottleneck semua kebutuhan analisis.

---

## 2. Data Movement Taxonomy

Sebelum memilih service, definisikan jenis perpindahan data.

### 2.1 Snapshot Export

Mengambil kondisi data pada titik waktu tertentu.

Contoh:

- export database harian ke S3;
- export case records untuk audit bulanan;
- dump reference data untuk analytics.

Cocok untuk:

- reporting yang tidak perlu real-time;
- reconciliation;
- compliance archive;
- reprocessing.

Risiko:

- data stale;
- export terlalu besar;
- window export mengganggu database;
- snapshot tidak konsisten jika tidak dirancang.

### 2.2 Change Data Capture

Mengirim perubahan data dari source system.

Contoh:

```text
RDS/Aurora transaction log
  → DMS / streaming connector
  → S3 / Redshift / Kafka/MSK
```

Cocok untuk:

- incremental analytics;
- near-real-time reporting;
- rebuilding projections;
- data synchronization.

Risiko:

- schema drift;
- duplicate event;
- out-of-order event;
- delete/update semantics tidak jelas;
- replay behaviour harus dirancang.

### 2.3 Event Emission

Aplikasi secara eksplisit menerbitkan event domain.

Contoh:

```json
{
  "eventType": "CaseEscalated",
  "caseId": "CASE-123",
  "fromStage": "REVIEW",
  "toStage": "ENFORCEMENT",
  "occurredAt": "2026-06-20T09:00:00Z"
}
```

Cocok untuk:

- audit journey;
- business event analytics;
- workflow monitoring;
- integration antar bounded context.

Risiko:

- event bukan database row;
- event perlu contract governance;
- missing event bisa lebih berbahaya daripada missing row;
- retry dan idempotency wajib.

### 2.4 Streaming Ingestion

Data masuk terus-menerus dari source berkecepatan tinggi.

Contoh:

- clickstream;
- device telemetry;
- application logs;
- security events;
- partner feed.

Cocok untuk:

- real-time dashboard;
- anomaly detection;
- near-real-time alerting;
- stream enrichment.

Risiko:

- backpressure;
- partition hotspot;
- consumer lag;
- small files di S3;
- ordering expectation yang salah.

### 2.5 Batch Transformation

Data diproses dalam batch.

Contoh:

```text
raw S3 data
  → Glue ETL job
  → curated Parquet table
  → Athena/Redshift query
```

Cocok untuk:

- cleansing;
- normalization;
- enrichment;
- daily fact table;
- compliance reporting.

Risiko:

- job failure setengah jalan;
- partial output;
- duplicate write;
- bad partition;
- cost tinggi karena scan besar.

---

## 3. AWS Analytics Building Blocks

Secara kasar, AWS analytics platform dapat dipahami seperti ini:

```text
Sources
  ├── Application DB
  ├── Application events
  ├── Logs
  ├── Partner files
  ├── SaaS systems
  └── Streams

Ingestion
  ├── DMS
  ├── Glue jobs
  ├── Data Firehose
  ├── Kinesis Data Streams
  ├── MSK
  ├── S3 direct upload
  └── EventBridge / SQS integrations

Storage
  └── S3 data lake
        ├── raw zone
        ├── cleaned zone
        ├── curated zone
        ├── analytics zone
        └── archive zone

Catalog / Governance
  ├── AWS Glue Data Catalog
  ├── Lake Formation
  ├── IAM
  ├── KMS
  └── DataZone / metadata workflows

Processing
  ├── Glue ETL
  ├── EMR / Spark
  ├── Lambda for small transforms
  ├── Athena CTAS/INSERT
  └── Redshift ELT

Query / Serving
  ├── Athena
  ├── Redshift
  ├── Redshift Spectrum
  ├── OpenSearch for search analytics
  ├── QuickSight
  └── ML / downstream systems
```

Top engineer tidak mulai dari service.

Top engineer mulai dari pertanyaan:

1. Apa source-of-truth?
2. Apa data contract?
3. Seberapa stale data boleh?
4. Siapa consumer-nya?
5. Apa query pattern?
6. Apa access boundary?
7. Apa retention requirement?
8. Apa reprocessing requirement?
9. Apa lineage requirement?
10. Apa failure mode yang paling mahal?

---

## 4. S3 Data Lake: Storage Layer Analytical Platform

Amazon S3 sering menjadi storage utama data lake karena durability, object lifecycle, integration luas, dan separation antara storage dan compute.

Namun S3 bukan database.

S3 adalah object store.

Konsekuensinya:

- object immutable secara praktis;
- read/write pattern berbasis object;
- listing dan partition layout penting;
- file size matters;
- format matters;
- metadata/catalog matters;
- query engine menentukan cara data dibaca.

### 4.1 Data Lake Zones

Pattern umum:

```text
s3://company-data-lake/raw/
s3://company-data-lake/cleaned/
s3://company-data-lake/curated/
s3://company-data-lake/analytics/
s3://company-data-lake/archive/
```

#### Raw Zone

Karakteristik:

- data disimpan mendekati bentuk aslinya;
- immutable;
- append-only;
- dipakai untuk replay;
- akses sangat terbatas.

Contoh:

```text
raw/source=case-service/entity=case/year=2026/month=06/day=20/hour=10/
```

#### Cleaned Zone

Karakteristik:

- format dinormalisasi;
- data invalid dipisahkan;
- schema mulai dikontrol;
- PII mungkin mulai dimask.

#### Curated Zone

Karakteristik:

- siap query;
- format columnar seperti Parquet;
- partition dirancang untuk query;
- data dictionary jelas;
- consumer lebih luas.

#### Analytics Zone

Karakteristik:

- aggregate;
- dashboard-specific;
- denormalized;
- optimized for BI/report.

#### Archive Zone

Karakteristik:

- long-term retention;
- jarang diakses;
- lifecycle ke storage class lebih murah;
- restore time harus dipahami.

---

## 5. File Format: JSON, CSV, Parquet, ORC, Avro

Format menentukan performance, cost, schema evolution, dan correctness.

### 5.1 JSON

Kelebihan:

- mudah dihasilkan aplikasi;
- fleksibel;
- cocok untuk raw event.

Kekurangan:

- boros storage;
- mahal untuk scan;
- schema tidak ketat;
- nested field bisa menyulitkan.

Cocok untuk:

- raw event log;
- early ingestion;
- debugging.

Tidak ideal untuk:

- query besar berulang;
- dashboard intensif;
- long-term curated analytics.

### 5.2 CSV

Kelebihan:

- sederhana;
- kompatibel luas.

Kekurangan:

- tipe data lemah;
- quoting/escaping rawan;
- schema evolution buruk;
- nested data tidak natural.

### 5.3 Parquet

Kelebihan:

- columnar;
- efisien untuk analytics;
- compression bagus;
- predicate pushdown;
- schema support lebih baik.

Kekurangan:

- perlu proses transform;
- file size harus dikelola;
- schema evolution tetap perlu governance.

Cocok untuk:

- curated zone;
- Athena;
- Redshift Spectrum;
- Spark/Glue;
- repeated analytical query.

### 5.4 Avro

Kelebihan:

- bagus untuk row-oriented serialized data;
- schema evolution lebih formal;
- umum di streaming ecosystem.

Cocok untuk:

- streaming pipelines;
- intermediate data.

### 5.5 Rule of Thumb

```text
Raw ingestion       → JSON/Avro/as-is
Curated analytics   → Parquet/ORC
Dashboard serving   → aggregate table / Redshift / optimized Parquet
Compliance archive  → raw + immutable + metadata manifest
```

---

## 6. Partitioning: Cost and Performance Control

Partitioning adalah salah satu keputusan paling penting di data lake.

Partitioning menjawab:

> Query biasanya memfilter data berdasarkan apa?

Contoh layout:

```text
s3://lake/curated/case_event/year=2026/month=06/day=20/tenant_id=T001/part-0001.parquet
```

Partition yang baik membuat query membaca sedikit data.

Partition yang buruk membuat query membaca terlalu banyak data atau membuat metadata terlalu besar.

### 6.1 Common Partition Keys

- date/time;
- tenant;
- region;
- source system;
- event type;
- domain entity;
- ingestion date vs event date.

### 6.2 Ingestion Date vs Event Date

Ini sering membingungkan.

**Ingestion date**: kapan data masuk ke data lake.  
**Event date**: kapan kejadian bisnis terjadi.

Untuk audit dan replay, keduanya penting.

Contoh:

```text
raw/case_events/ingest_year=2026/ingest_month=06/ingest_day=20/
curated/case_events/event_year=2026/event_month=06/event_day=19/
```

Jika hanya event date:

- late-arriving event sulit dilacak.

Jika hanya ingestion date:

- query bisnis “kejadian tanggal X” lebih mahal.

### 6.3 Over-Partitioning

Terlalu banyak partition bisa buruk.

Contoh buruk:

```text
partition by tenant_id + case_id + event_type + year + month + day + hour + minute
```

Akibat:

- terlalu banyak directory kecil;
- catalog membengkak;
- query planning lambat;
- small files meningkat.

### 6.4 Small Files Problem

Streaming ingestion sering menghasilkan banyak file kecil.

Dampak:

- query overhead tinggi;
- listing object mahal/lambat;
- metadata berat;
- Athena/Spark job tidak efisien.

Mitigasi:

- buffer di Firehose;
- compaction job;
- target file size;
- partition projection;
- Iceberg/Hudi/Delta jika butuh table management lebih advanced.

---

## 7. AWS Glue

AWS Glue adalah serverless data integration service untuk menemukan, menyiapkan, memindahkan, dan mengintegrasikan data dari berbagai sumber.

Dalam arsitektur, Glue punya beberapa peran:

1. **Data Catalog**;
2. **Crawler**;
3. **ETL Job**;
4. **Workflow/Trigger**;
5. **Schema and metadata integration**.

### 7.1 Glue Data Catalog

Glue Data Catalog adalah metadata catalog.

Ia menyimpan informasi seperti:

- database;
- table;
- column;
- partition;
- schema;
- location S3;
- serializer/deserializer;
- table property.

Query engine seperti Athena dan Redshift Spectrum dapat menggunakan catalog ini.

Mental model:

```text
S3 object = actual data
Glue Catalog = metadata pointer and schema
Athena = query engine
Lake Formation = access governance layer
```

Kesalahan umum:

> “Data sudah ada di S3, berarti otomatis bisa di-query.”

Belum tentu.

Query engine perlu memahami schema, format, dan location.

### 7.2 Crawler

Crawler membaca data source dan mencoba menginfer schema.

Cocok untuk:

- discovery awal;
- semi-managed dataset;
- prototyping;
- source yang belum stabil.

Tidak selalu cocok untuk:

- production schema contract yang ketat;
- regulated dataset;
- dataset dengan schema evolution kompleks;
- dataset besar dengan partition banyak.

Dalam production, schema sering lebih baik didefinisikan eksplisit lewat IaC/catalog deployment.

### 7.3 Glue ETL Job

Glue ETL dapat menjalankan transformasi menggunakan Spark atau Python shell tergantung kebutuhan.

Pola umum:

```text
raw JSON
  → Glue ETL
  → validate schema
  → mask sensitive fields
  → write Parquet
  → update Glue Catalog
```

### 7.4 Glue Job Design Questions

Sebelum menulis job, jawab:

1. Input zone apa?
2. Output zone apa?
3. Apakah job idempotent?
4. Bagaimana mendeteksi data sudah diproses?
5. Apa partition output?
6. Bagaimana menangani bad records?
7. Bagaimana schema drift ditangani?
8. Apakah job overwrite atau append?
9. Bagaimana partial failure dibersihkan?
10. Bagaimana lineage dicatat?

### 7.5 Glue Anti-Patterns

Anti-pattern:

```text
Crawler infer schema semua dataset production setiap malam tanpa contract.
```

Risiko:

- schema berubah diam-diam;
- query consumer rusak;
- tipe data salah infer;
- partition membengkak;
- governance sulit.

Anti-pattern lain:

```text
ETL job overwrite curated dataset tanpa atomicity strategy.
```

Risiko:

- consumer membaca data setengah jadi;
- report salah;
- rollback sulit.

---

## 8. Amazon Athena

Athena adalah serverless interactive query service untuk menganalisis data di S3 menggunakan SQL.

Athena bagus untuk:

- ad-hoc query;
- data lake exploration;
- compliance investigation;
- lightweight reporting;
- querying raw/curated data;
- validating pipeline outputs.

Athena kurang cocok sebagai:

- high-concurrency low-latency API backend;
- OLTP database;
- sub-millisecond query engine;
- unrestricted BI platform tanpa cost guardrail.

### 8.1 Athena Mental Model

```text
SQL Query
  → Athena engine
  → reads metadata from Glue Catalog
  → scans objects in S3
  → writes query result to S3
```

Cost dan performance sangat dipengaruhi oleh:

- berapa banyak data discan;
- file format;
- compression;
- partition pruning;
- column selection;
- table layout;
- result reuse/cache;
- query pattern.

### 8.2 Athena Cost Control

Karena Athena membayar berdasarkan data scanned, desain data menentukan biaya.

Praktik penting:

- gunakan Parquet/ORC untuk curated data;
- compress data;
- partition sesuai query;
- hindari `SELECT *`;
- batasi akses ad-hoc ke raw zone;
- gunakan workgroup dengan query limit;
- pisahkan workgroup per team/use case;
- monitor bytes scanned;
- gunakan CTAS untuk materialized dataset;
- compact small files.

### 8.3 Partition Projection

Partition projection memungkinkan Athena menghitung partition value secara dinamis daripada selalu mengambil partition metadata dari catalog.

Ini berguna untuk dataset yang memiliki partition sangat banyak atau partition yang predictable seperti tanggal.

Contoh use case:

```text
s3://logs/year=2026/month=06/day=20/hour=13/
```

Dengan partition projection, query engine bisa memahami range partition berdasarkan konfigurasi, bukan harus semua partition didaftarkan satu per satu.

### 8.4 Athena Failure Modes

| Failure | Penyebab | Dampak |
|---|---|---|
| Query mahal | format row-based, no partition | biaya naik |
| Query lambat | small files, many partitions | analyst blocked |
| Data salah | schema mismatch | report salah |
| Access leak | broad S3/IAM access | data exposure |
| Result leak | query result bucket terbuka | sensitive result bocor |
| Catalog drift | crawler berubah schema | consumer rusak |
| Late data missing | partition belum update | report tidak lengkap |

---

## 9. AWS Lake Formation

Lake Formation membantu governance data lake di S3 dan metadata Glue Data Catalog.

Masalah yang dipecahkan:

- siapa boleh melihat table apa;
- siapa boleh melihat column apa;
- siapa boleh melihat row apa;
- bagaimana share data lintas account;
- bagaimana mengelola data lake permission secara terpusat.

Tanpa Lake Formation, banyak organisasi hanya mengandalkan IAM + S3 bucket policy.

Itu bisa bekerja, tetapi untuk data lake enterprise sering menjadi terlalu kasar.

### 9.1 IAM vs Lake Formation

IAM menjawab:

```text
Principal ini boleh memanggil API apa ke resource AWS apa?
```

Lake Formation menjawab:

```text
Principal ini boleh mengakses data table/column/row mana melalui analytics service?
```

Keduanya bisa terlibat.

Untuk debugging access, jangan berpikir hanya satu layer.

### 9.2 Fine-Grained Access Control

Lake Formation dapat mengatur:

- database permission;
- table permission;
- column-level permission;
- row/cell filter;
- cross-account sharing;
- data location permission.

Contoh regulated workload:

- investigator boleh melihat case metadata;
- supervisor boleh melihat enforcement decision;
- analyst boleh melihat aggregated dataset;
- external auditor hanya boleh melihat immutable evidence subset;
- PII column dimasking/dihilangkan untuk general analytics.

### 9.3 Lake Formation Failure Modes

| Failure | Penyebab | Dampak |
|---|---|---|
| Analyst denied unexpectedly | IAM/LF mismatch | productivity issue |
| Data leak | broad table grant | compliance incident |
| Cross-account share broken | RAM/LF config missing | pipeline gagal |
| Column filter incomplete | schema evolution | PII exposure |
| Bypass governance | direct S3 access | LF ineffective |

Ingat:

> Data governance tidak kuat jika consumer masih bisa bypass langsung ke S3 object tanpa kontrol yang sesuai.

---

## 10. Amazon Redshift

Redshift adalah cloud data warehouse untuk analytical workload yang membutuhkan performance, concurrency, data modeling, dan BI serving lebih kuat daripada ad-hoc Athena.

Gunakan Redshift ketika:

- query sering dan berat;
- BI dashboard butuh predictable performance;
- banyak join/aggregate kompleks;
- semantic layer/reporting perlu stabil;
- workload lebih warehouse daripada lake exploration;
- cost lebih efisien dengan provisioned/serverless warehouse dibanding repeated large S3 scans.

### 10.1 Redshift vs Athena

| Dimensi | Athena | Redshift |
|---|---|---|
| Mode | serverless query over S3 | data warehouse |
| Best for | ad-hoc, lake exploration | BI/reporting, heavy analytics |
| Storage | S3 | Redshift managed storage / external Spectrum |
| Cost driver | bytes scanned | compute/storage/workgroup usage |
| Performance | depends heavily on files/partitions | optimized warehouse execution |
| Governance | Glue/LF/S3/IAM | Redshift permissions + LF for Spectrum |

### 10.2 Redshift Spectrum

Redshift Spectrum memungkinkan Redshift query data external di S3.

Mental model:

```text
Redshift local tables
  + external tables in S3 via Spectrum
  + Glue Catalog / Lake Formation governance
```

Cocok untuk:

- combining warehouse data and lake data;
- avoiding load for rarely queried external data;
- staged migration from lake to warehouse.

### 10.3 Redshift Data Design Concerns

Tidak masuk terlalu dalam ke internals, tetapi arsitek harus memperhatikan:

- workload management;
- concurrency;
- materialized views;
- sort/distribution strategy;
- data load strategy;
- schema evolution;
- ELT pattern;
- separation of raw/curated/serving;
- BI user isolation;
- cost control.

---

## 11. Amazon EMR

EMR adalah managed big data platform untuk framework seperti Apache Spark, Hadoop, Hive, Presto/Trino, Flink, dan lainnya.

Gunakan EMR ketika:

- transformasi sangat besar;
- butuh Spark ecosystem yang lebih fleksibel;
- job butuh custom dependency/runtime;
- workload tidak cocok dengan Glue abstraction;
- perlu cluster-level tuning;
- sudah punya Spark workload existing;
- butuh cost/performance control granular.

### 11.1 Glue vs EMR

| Dimensi | Glue | EMR |
|---|---|---|
| Operational model | serverless/managed ETL | managed cluster/serverless options |
| Best for | common ETL, catalog integration | complex big data processing |
| Control | lebih sederhana | lebih granular |
| Team skill | data engineer biasa | Spark/platform expertise |
| Tuning | terbatas dibanding EMR | lebih dalam |

### 11.2 EMR Failure Modes

- cluster idle terlalu lama;
- job retry mengulang output tanpa idempotency;
- Spark shuffle cost tinggi;
- skewed partition;
- executor memory issue;
- dependency conflict;
- data write partial;
- IAM/S3 permission issue;
- Spot interruption jika tidak dirancang.

---

## 12. Amazon Data Firehose

Amazon Data Firehose adalah managed delivery service untuk mengirim streaming data ke destination seperti S3, Redshift, OpenSearch, HTTP endpoint, dan lain-lain.

Firehose cocok ketika Anda ingin:

- menerima streaming data;
- buffering otomatis;
- delivery ke S3/Redshift/OpenSearch;
- transform ringan via Lambda;
- mengurangi operational burden;
- tidak perlu consumer custom yang kompleks.

### 12.1 Firehose Mental Model

```text
Producer
  → Firehose delivery stream
      → buffer by size/time
      → optional transform
      → optional format conversion
      → destination
      → backup/error prefix
```

### 12.2 Firehose vs Kinesis Data Streams

| Dimensi | Firehose | Kinesis Data Streams |
|---|---|---|
| Purpose | delivery | stream processing primitive |
| Consumer | managed destination | custom consumers |
| Retention | delivery oriented | retention window |
| Control | lower | higher |
| Use case | logs/events to S3/OpenSearch | custom real-time processing |

### 12.3 Firehose Failure Modes

- transform Lambda timeout;
- destination unavailable;
- bad record format;
- backup/error prefix tidak dimonitor;
- buffer terlalu kecil menghasilkan small files;
- dynamic partitioning salah;
- schema conversion gagal;
- downstream cost explosion.

---

## 13. Kinesis, MSK, and Streaming Analytics Boundary

Karena seri Kafka sudah dibahas, bagian ini hanya memosisikan Kinesis/MSK dalam AWS analytics architecture.

### 13.1 Kinesis Data Streams

Cocok untuk:

- AWS-native streaming;
- custom consumer;
- ordered records per partition key;
- near-real-time processing;
- Lambda consumer;
- Glue streaming ETL;
- Flink analytics.

Perhatian:

- shard capacity;
- partition key distribution;
- consumer lag;
- resharding;
- retention;
- duplicate processing;
- ordering only within shard/partition key.

### 13.2 Amazon MSK

MSK cocok ketika:

- organisasi sudah menggunakan Kafka protocol;
- butuh Kafka ecosystem;
- producer/consumer existing Kafka;
- multi-language event streaming platform;
- semantics Kafka memang dibutuhkan.

Perhatian:

- topic/partition governance;
- broker capacity;
- storage retention;
- schema registry strategy;
- ACL/IAM integration;
- cluster operation;
- cross-account/networking.

### 13.3 Stream to Lake Pattern

```text
Application events
  → MSK / Kinesis
  → Firehose / Glue streaming / custom consumer
  → S3 raw zone
  → Glue ETL compaction
  → curated Parquet
  → Athena / Redshift / ML
```

Key design:

- raw stream preserved;
- curated data compacted;
- bad records isolated;
- replay possible;
- schema version tracked;
- event idempotency enforced.

---

## 14. AWS DMS for Data Movement

AWS Database Migration Service membantu memigrasikan dan mereplikasi database.

Use case:

- initial load ke AWS;
- CDC dari source database;
- database migration;
- feeding analytics lake;
- dual-run during migration.

DMS cocok ketika:

- source adalah database;
- perubahan row-level dibutuhkan;
- aplikasi tidak mudah diubah untuk emit event;
- migration window terbatas.

Tetapi DMS bukan pengganti domain event.

CDC menjawab:

```text
Row apa berubah?
```

Domain event menjawab:

```text
Kejadian bisnis apa terjadi?
```

Keduanya tidak sama.

---

## 15. Schema Evolution and Data Contracts

Data analytics sering gagal bukan karena storage, tetapi karena schema berubah tanpa contract.

Contoh perubahan:

- column baru;
- column dihapus;
- tipe data berubah;
- enum value bertambah;
- nested object berubah;
- timestamp timezone berubah;
- meaning field berubah.

### 15.1 Compatibility Rules

Pertanyaan penting:

1. Apakah consumer lama tetap bisa membaca data baru?
2. Apakah consumer baru bisa membaca data lama?
3. Apakah field optional atau required?
4. Apakah default value jelas?
5. Apakah semantic change versioned?
6. Apakah data historical perlu backfill?

### 15.2 Data Contract Template

```yaml
name: CaseEvent
version: 3
owner: case-platform-team
classification: confidential
source_of_truth: case-service
primary_keys:
  - event_id
partitioning:
  - event_date
  - tenant_id
fields:
  event_id:
    type: string
    required: true
  tenant_id:
    type: string
    required: true
  case_id:
    type: string
    required: true
  event_type:
    type: string
    required: true
  occurred_at:
    type: timestamp
    required: true
  actor_type:
    type: string
    required: false
pii_fields:
  - actor_id
compatibility: backward
retention: 7 years
consumers:
  - audit-reporting
  - compliance-analytics
```

---

## 16. Data Governance Architecture

Governance bukan hanya access control.

Governance mencakup:

- ownership;
- classification;
- catalog;
- lineage;
- retention;
- data quality;
- access approval;
- usage monitoring;
- deletion policy;
- residency;
- sharing;
- auditability.

### 16.1 Data Classification

Minimal:

```text
Public
Internal
Confidential
Restricted
Regulated
```

Untuk setiap classification, tentukan:

- allowed storage zone;
- encryption requirement;
- access approval;
- masking requirement;
- retention period;
- logging requirement;
- cross-account sharing rule;
- export restriction.

### 16.2 Data Ownership

Setiap dataset harus punya:

- owner team;
- technical steward;
- business steward;
- SLA/SLO jika dipakai critical report;
- schema change process;
- incident contact.

Tanpa owner, data lake menjadi data swamp.

---

## 17. Data Quality and Validation

Analytical system yang cepat tetapi salah tidak berguna.

Validation points:

1. Ingestion validation;
2. Schema validation;
3. Null/required field validation;
4. Referential validation;
5. Duplicate detection;
6. Freshness check;
7. Completeness check;
8. Reconciliation with source;
9. Outlier detection;
10. Consumer contract tests.

Contoh quality metrics:

```text
raw_events_received_count
bad_records_count
curated_records_written_count
duplicate_event_count
late_arriving_event_count
schema_rejection_count
freshness_lag_minutes
source_to_lake_reconciliation_gap
```

Untuk regulated workload, quality metrics harus menjadi bagian evidence.

---

## 18. Reference Architecture: Regulated Case Management Analytics

Scenario:

- Java platform mengelola case lifecycle;
- ada tenant/regulator berbeda;
- perlu audit report;
- perlu management dashboard;
- perlu investigation analytics;
- data mengandung PII;
- retention 7–10 tahun;
- report tidak boleh membebani OLTP.

### 18.1 Architecture

```text
Case Service / Enforcement Service / Document Service
  ├── Domain events → EventBridge / MSK / Kinesis
  ├── Audit events → S3 raw immutable bucket
  ├── DB snapshot/CDC → DMS → S3 raw zone
  └── App logs/security logs → Firehose → S3 log zone

S3 Data Lake
  ├── raw/case_events/
  ├── raw/audit_events/
  ├── raw/db_cdc/
  ├── cleaned/
  ├── curated/case_timeline/
  ├── curated/enforcement_metrics/
  └── archive/

Catalog & Governance
  ├── Glue Data Catalog
  ├── Lake Formation permissions
  ├── KMS keys by classification
  ├── CloudTrail data events for sensitive buckets
  └── Config/Security Hub controls

Processing
  ├── Glue batch ETL
  ├── Glue streaming / Firehose delivery
  ├── EMR for large historical recomputation
  └── Step Functions orchestration for report generation

Query & Serving
  ├── Athena for investigation/ad-hoc
  ├── Redshift for BI/dashboard
  ├── QuickSight / reporting service
  └── controlled export API
```

### 18.2 Key Design Decisions

#### Raw Zone Immutable

Raw events and CDC stored append-only.

Reason:

- replay;
- forensic audit;
- debugging;
- reprocessing after bug fix.

#### Curated Zone PII-Minimized

Analysts should not query raw PII unless approved.

Curated datasets:

- mask sensitive fields;
- tokenize actor ids;
- separate restricted columns;
- use Lake Formation column/row filters.

#### Tenant-Aware Partitioning

Potential layout:

```text
curated/case_timeline/tenant_id=T001/event_year=2026/event_month=06/
```

But beware high tenant cardinality or tenant size skew.

For large tenants, separate prefix/account may be justified.

#### Dual Time Semantics

Store both:

- `occurred_at`;
- `ingested_at`;
- `processed_at`.

This is critical for audit.

#### Quality Evidence

Every ETL run writes:

- input count;
- output count;
- rejected count;
- checksum/manifest;
- job version;
- schema version;
- operator/system actor;
- execution id.

---

## 19. Java Application Responsibilities

Java services should not become analytical query engines.

But Java applications must produce clean analytical inputs.

Responsibilities:

1. Emit domain events with stable schema.
2. Include event id.
3. Include tenant id where appropriate.
4. Include correlation id and causation id.
5. Include occurred timestamp and version.
6. Avoid leaking unnecessary PII.
7. Make event publication reliable.
8. Use outbox if event and database write must be coordinated.
9. Expose export APIs carefully if direct exports are needed.
10. Avoid letting analysts query production OLTP directly.

### 19.1 Event Envelope Example

```json
{
  "event_id": "evt-01J...",
  "event_type": "CaseStatusChanged",
  "event_version": 2,
  "tenant_id": "regulator-a",
  "case_id": "case-123",
  "occurred_at": "2026-06-20T10:15:00Z",
  "produced_at": "2026-06-20T10:15:02Z",
  "correlation_id": "corr-456",
  "causation_id": "cmd-789",
  "source": "case-service",
  "classification": "confidential",
  "payload": {
    "from_status": "UNDER_REVIEW",
    "to_status": "ESCALATED",
    "reason_code": "HIGH_RISK_SIGNAL"
  }
}
```

### 19.2 Outbox Pattern Boundary

Jika event harus konsisten dengan database write:

```text
Transaction:
  ├── update case table
  └── insert outbox event

Publisher:
  ├── reads outbox
  ├── publishes event
  └── marks event published
```

Analytical pipeline menerima event.

Consumer harus tetap idempotent.

---

## 20. Cost Engineering for Analytics

Cost drivers:

- S3 storage;
- S3 requests;
- data transfer;
- Glue job DPU/runtime;
- Athena bytes scanned;
- Redshift compute;
- EMR cluster runtime;
- Firehose ingestion/delivery;
- Kinesis shards;
- MSK brokers/storage;
- CloudWatch logs;
- Lake Formation underlying services;
- cross-AZ/cross-region transfer;
- small file overhead.

### 20.1 Cost Anti-Patterns

| Anti-pattern | Cost Impact |
|---|---|
| Raw JSON queried repeatedly | high Athena scan cost |
| No partitioning | full table scans |
| Too many tiny files | query overhead |
| Unbounded crawler | Glue cost/time |
| Redshift always-on unused | compute waste |
| EMR cluster left running | large waste |
| Logs duplicated to many places | storage + ingest cost |
| No lifecycle policy | archive cost grows |
| Cross-region analytics copy | transfer/storage duplication |

### 20.2 Cost Controls

- lifecycle raw/archive data;
- convert curated data to Parquet;
- partition by query filters;
- compact small files;
- Athena workgroup limits;
- Redshift pause/serverless controls where appropriate;
- EMR auto-termination;
- Firehose buffer tuning;
- separate exploratory vs production query environments;
- data product ownership and cost allocation tags.

---

## 21. Security Architecture for Analytics

Security concerns:

- raw data often contains more sensitive information than curated data;
- query result bucket can leak derived sensitive data;
- broad S3 access can bypass Lake Formation;
- analysts may accidentally export restricted datasets;
- cross-account sharing must be explicit;
- encryption key policy can block analytics services;
- logs can contain PII.

### 21.1 Controls

- bucket policy deny non-TLS;
- SSE-KMS with appropriate key policy;
- Lake Formation grants;
- query result bucket isolation;
- CloudTrail data events for sensitive buckets;
- Macie for sensitive data discovery;
- IAM Identity Center groups for analytics roles;
- separate accounts for data lake, analytics, security, and application workload;
- row/column filters;
- approved export path;
- retention and legal hold.

### 21.2 Common Access Pattern

```text
Human analyst
  → IAM Identity Center group
  → analytics role in analytics account
  → Lake Formation permission
  → Athena workgroup
  → query curated table
  → result written to controlled S3 bucket
```

---

## 22. Observability for Data Pipelines

Pipeline observability must answer:

1. Did data arrive?
2. Was data processed?
3. Was data rejected?
4. Is data fresh?
5. Is data complete?
6. Did schema change?
7. Is cost abnormal?
8. Is consumer query failing?
9. Is access denied due to policy?
10. Can we replay safely?

### 22.1 Metrics

```text
ingestion_records_received
ingestion_bytes_received
bad_records_count
etl_job_duration_seconds
etl_job_failed_count
curated_records_written
athena_bytes_scanned
redshift_query_latency_p95
firehose_delivery_to_s3_failed
kinesis_consumer_lag
msk_consumer_lag
lakeformation_access_denied_count
data_freshness_lag_minutes
```

### 22.2 Alarms

Useful alarms:

- no data received for expected feed;
- bad record ratio above threshold;
- freshness lag too high;
- ETL job failure;
- Firehose delivery failure;
- Kinesis/MSK lag high;
- Athena spend anomaly;
- Redshift CPU/concurrency saturation;
- unexpected access denied spike;
- sensitive data detected in wrong bucket.

---

## 23. Failure Mode Catalog

| Failure Mode | Example | Mitigation |
|---|---|---|
| Data arrives late | partner feed delayed | model event time + ingest time |
| Duplicate records | retry producer | event id + idempotent processing |
| Schema drift | field type changes | schema contract + validation |
| Small files | streaming writes tiny objects | Firehose buffer + compaction |
| Query cost explosion | no partition, JSON scan | Parquet + partition + workgroup limits |
| PII exposure | raw data queried broadly | Lake Formation + curated masking |
| Catalog mismatch | crawler infers wrong type | explicit schema as code |
| Partial ETL output | job fails after writing | write temp path + atomic publish pattern |
| Consumer reads half-built data | overwrite in place | versioned output + manifest |
| Governance bypass | direct S3 permission | deny direct access except governed roles |
| Redshift overload | BI dashboard burst | WLM/serverless scaling/materialized views |
| EMR waste | cluster left idle | auto-termination |
| Firehose transform timeout | Lambda too slow | simplify transform / use Glue/stream processor |
| Lost bad records | error prefix ignored | monitor error prefix and DLQ |
| Inconsistent reporting | CDC vs event mismatch | define source semantics and reconciliation |

---

## 24. Design Method: Choosing the Right Analytics Stack

Use this decision flow.

### 24.1 Need ad-hoc query over S3?

Use:

```text
S3 + Glue Catalog + Athena
```

Add:

- Parquet;
- partitioning;
- workgroup controls;
- Lake Formation.

### 24.2 Need governed enterprise data lake?

Use:

```text
S3 + Glue Catalog + Lake Formation + IAM/KMS + audit controls
```

Add:

- classification;
- row/column filtering;
- cross-account sharing;
- data stewardship.

### 24.3 Need repeated BI/dashboard with heavy joins?

Use:

```text
Redshift + curated datasets + materialized views / semantic layer
```

Potentially combine with:

```text
Redshift Spectrum over S3
```

### 24.4 Need simple streaming delivery to S3/OpenSearch/Redshift?

Use:

```text
Amazon Data Firehose
```

### 24.5 Need custom stream processing?

Use:

```text
Kinesis Data Streams / MSK + consumer / Flink / Glue streaming
```

### 24.6 Need large Spark transformation?

Use:

```text
Glue ETL for managed serverless ETL
EMR for complex/tunable big data workloads
```

### 24.7 Need database migration/CDC?

Use:

```text
AWS DMS
```

But distinguish CDC from domain events.

---

## 25. ADR Template

```markdown
# ADR: Analytics Data Movement Architecture for <Workload>

## Context
- Source systems:
- Data consumers:
- Freshness requirement:
- Retention requirement:
- Data classification:
- Compliance constraints:

## Decision
We will use:
- Ingestion:
- Storage zones:
- Catalog:
- Governance:
- Processing:
- Query/serving:

## Data Contracts
- Event/schema versioning:
- Compatibility rule:
- Owner:
- Quality checks:

## Partitioning
- Raw partition strategy:
- Curated partition strategy:
- Late-arriving data strategy:

## Security
- IAM roles:
- Lake Formation grants:
- KMS keys:
- Query result control:
- Cross-account access:

## Reliability
- Replay strategy:
- Bad record handling:
- Partial output handling:
- Reconciliation:

## Cost Controls
- File format:
- Compaction:
- Athena workgroup limit:
- Lifecycle:
- Redshift/EMR controls:

## Consequences
Positive:
Negative:
Risks:
Mitigations:
```

---

## 26. Production Checklist

### Data Contract

- [ ] Dataset owner defined.
- [ ] Schema versioned.
- [ ] Compatibility policy defined.
- [ ] PII fields classified.
- [ ] Retention defined.
- [ ] Consumer list known.

### Ingestion

- [ ] Idempotency key exists.
- [ ] Duplicate handling defined.
- [ ] Bad record path exists.
- [ ] Late-arriving data handled.
- [ ] Replay strategy defined.

### Storage

- [ ] Raw zone immutable.
- [ ] Curated zone optimized.
- [ ] Lifecycle policy configured.
- [ ] Encryption enabled.
- [ ] Bucket policy prevents unsafe access.

### Catalog

- [ ] Tables defined explicitly for production.
- [ ] Partitions managed or projected.
- [ ] Schema drift monitored.
- [ ] Catalog changes reviewed.

### Governance

- [ ] Lake Formation/IAM access mapped.
- [ ] Query result bucket secured.
- [ ] Cross-account sharing reviewed.
- [ ] Audit logs enabled for sensitive access.

### Processing

- [ ] ETL idempotent.
- [ ] Partial output safe.
- [ ] Data quality checks implemented.
- [ ] Job failures alarmed.
- [ ] Execution metadata stored.

### Query/Serving

- [ ] Athena workgroups configured.
- [ ] Query cost guardrails enabled.
- [ ] Redshift workload isolated if used.
- [ ] Dashboard queries optimized.

### Observability

- [ ] Freshness metric exists.
- [ ] Completeness metric exists.
- [ ] Bad record metric exists.
- [ ] Cost metric exists.
- [ ] Access denied metric reviewed.

---

## 27. Exercises

### Exercise 1 — Design a Case Event Data Lake

Design S3 layout for case lifecycle events.

Requirements:

- multi-tenant;
- 7-year retention;
- raw immutable zone;
- curated query by tenant and event date;
- late-arriving events;
- PII in actor fields;
- Athena investigation queries.

Deliverables:

- bucket/prefix layout;
- partition keys;
- file format;
- catalog strategy;
- access model;
- failure handling.

### Exercise 2 — Athena Cost Review

Given a dataset:

```text
s3://lake/raw/events/*.json
```

It is queried daily with:

```sql
SELECT * FROM events WHERE event_date = '2026-06-20';
```

Identify why cost may be high and propose redesign.

Expected improvements:

- Parquet;
- partition by event date;
- avoid select star;
- curated zone;
- workgroup limits;
- compaction.

### Exercise 3 — Choose Glue vs EMR

You have a transformation job that processes 30 TB historical data monthly with complex joins and custom Spark dependencies.

Decide:

- Glue or EMR;
- why;
- cost controls;
- failure handling;
- output publishing strategy.

### Exercise 4 — Governance Threat Model

Analysts need access to enforcement trend data but must not see complainant identity.

Design:

- curated dataset;
- Lake Formation grants;
- column masking/removal;
- query result bucket policy;
- audit logging;
- exception process.

---

## 28. Key Takeaways

1. AWS analytics architecture is a data contract and governance problem before it is a service selection problem.
2. S3 is storage, not a database; query correctness requires catalog, format, partitioning, and governance.
3. Glue Data Catalog is metadata; Athena reads S3 through metadata and writes results back to S3.
4. Lake Formation adds data lake governance, especially fine-grained permissions and cross-account sharing.
5. Redshift is better for repeated, heavy, governed warehouse workloads; Athena is better for serverless lake query and exploration.
6. Firehose is a delivery service, not a general stream processing platform.
7. Kinesis/MSK are stream primitives; use them when custom stream processing or ecosystem compatibility is needed.
8. Partitioning and file format are major cost/performance controls.
9. Raw data should usually be immutable; curated data should be optimized and governed.
10. Data quality, lineage, and freshness are production concerns, not afterthoughts.

---

## 29. Referensi Resmi

- AWS Analytics overview: https://docs.aws.amazon.com/whitepapers/latest/aws-overview/analytics.html
- AWS Glue: https://docs.aws.amazon.com/glue/latest/dg/what-is-glue.html
- AWS Glue Data Catalog best practices: https://docs.aws.amazon.com/glue/latest/dg/best-practice-catalog.html
- Amazon Athena partitioning: https://docs.aws.amazon.com/athena/latest/ug/partitions.html
- Athena data optimization: https://docs.aws.amazon.com/athena/latest/ug/performance-tuning-data-optimization-techniques.html
- Athena partition projection: https://docs.aws.amazon.com/athena/latest/ug/partition-projection.html
- Amazon Data Firehose: https://docs.aws.amazon.com/firehose/latest/dev/what-is-this-service.html
- Firehose data delivery: https://docs.aws.amazon.com/firehose/latest/dev/basic-deliver.html
- AWS Lake Formation: https://docs.aws.amazon.com/lake-formation/latest/dg/what-is-lake-formation.html
- Lake Formation fine-grained access control: https://docs.aws.amazon.com/lake-formation/latest/dg/access-control-fine-grained.html
- Redshift Spectrum and Lake Formation: https://docs.aws.amazon.com/redshift/latest/dg/spectrum-lake-formation.html

---

## 30. Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-030.md
```

Judul:

```text
Machine Learning and AI Services on AWS for Backend Engineers
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — Resilient Integration with AWS APIs: Retry, Timeout, Idempotency, Throttling, Quota, dan Backoff</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-030.md">Part 030 — Machine Learning and AI Services on AWS for Backend Engineers ➡️</a>
</div>

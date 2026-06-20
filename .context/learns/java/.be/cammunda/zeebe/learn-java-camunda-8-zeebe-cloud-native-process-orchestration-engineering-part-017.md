# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-017.md

# Part 017 — Exporters, Elasticsearch/OpenSearch, Operate, Tasklist, and Read-Side Architecture

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Bagian: `017 / 035`  
> Level: Advanced / production engineering  
> Fokus: exporter, secondary storage, projection, Operate, Tasklist, Optimize, read-side consistency, audit, troubleshooting, dan desain arsitektur read model di Camunda 8/Zeebe.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kita ingin mampu melihat Camunda 8 bukan hanya sebagai engine yang menjalankan BPMN, tetapi sebagai **distributed write engine + projection ecosystem**.

Camunda 8/Zeebe memiliki jalur utama:

```text
Command/write path:
Client / Worker / API
        -> Gateway
        -> Broker leader partition
        -> Zeebe stream + runtime state

Read/projection path:
Zeebe stream
        -> Exporter
        -> Secondary storage
        -> Operate / Tasklist / Optimize / custom read model
```

Di Camunda 7, banyak engineer terbiasa berpikir:

```text
runtime state + history + query = relational database milik process engine
```

Di Camunda 8, mental model itu berubah:

```text
runtime source of truth = Zeebe broker state + stream
query/read visibility = exported projection di secondary storage
```

Konsekuensinya besar:

1. Operate bukan engine.
2. Tasklist bukan engine.
3. Optimize bukan engine.
4. Elasticsearch/OpenSearch/RDBMS secondary storage bukan runtime authority untuk process progression.
5. Projection lag adalah kemungkinan normal dalam distributed architecture.
6. Exporter backlog bisa mempengaruhi observability, operasi, bahkan flow-control tergantung konfigurasi/version.
7. Read model harus didesain sebagai eventually consistent view.
8. Custom audit/search/reporting tidak boleh sembarangan membaca state seolah-olah itu command authority.

Bagian ini akan membahas read-side architecture dari sisi software engineer yang harus membangun sistem production-grade.

---

## 1. Mental Model Utama: Write Model vs Read Model

Camunda 8 memisahkan dua kebutuhan yang sering tercampur dalam sistem workflow tradisional:

| Kebutuhan | Diurus Oleh | Karakter |
|---|---|---|
| Menjalankan proses | Zeebe broker | authoritative, ordered per partition, durable |
| Mengirim command | Gateway/API/client | command-facing, stateless routing |
| Melihat proses | Operate | projection/search-oriented |
| Mengelola human task | Tasklist | task-oriented projection + APIs |
| Analytics/process improvement | Optimize | analytical projection |
| Custom audit/reporting | Exported records/custom projection | domain/read optimized |

Prinsip dasarnya:

> **Zeebe broker memutuskan apa yang benar-benar terjadi. Read-side component menampilkan atau menganalisis apa yang sudah diekspor dan diproyeksikan.**

Ini mirip separation dalam CQRS/event-driven system:

```text
Command side:
- accepts commands
- validates command against runtime state
- mutates authoritative state
- appends records

Read side:
- consumes records
- builds queryable view
- optimizes for search/filter/UI/reporting
- may lag behind command side
```

Namun hati-hati: jangan menyederhanakan Zeebe sebagai “event sourcing biasa”. Zeebe adalah workflow engine dengan stream processor, state, commands, intents, jobs, incidents, timers, partitions, replication, dan exporters. CQRS hanya analogi untuk memahami separation-nya.

---

## 2. Apa Itu Exporter?

Exporter adalah mekanisme untuk mengambil record dari Zeebe stream dan mengirimkannya ke sistem lain.

Secara konseptual:

```text
Zeebe partition stream
      |
      v
Exporter
      |
      +--> Elasticsearch / OpenSearch / RDBMS secondary storage
      +--> custom audit store
      +--> data lake
      +--> monitoring pipeline
      +--> compliance archive
```

Exporter membaca record yang diproduksi oleh engine. Record tersebut bisa berkaitan dengan:

- process deployment
- process instance lifecycle
- flow node lifecycle
- variable updates
- job creation/activation/completion/failure
- incidents
- messages
- timers
- user task events
- internal maintenance events

Secara production thinking, exporter adalah **bridge dari deterministic runtime stream ke query/search/reporting world**.

---

## 3. Kenapa Exporter Dibutuhkan?

Zeebe broker tidak didesain untuk menjadi database query umum.

Broker harus fokus pada:

1. menerima command,
2. memproses workflow deterministically,
3. menjaga ordered stream,
4. menyimpan runtime state,
5. mereplikasi state,
6. recovery,
7. backpressure,
8. job dispatching.

Kalau semua query Operate/Tasklist/reporting langsung membebani broker, engine akan bercampur antara workload command-critical dan workload read-heavy.

Exporter memisahkan:

```text
runtime execution concern
```

 dari:

```text
read/search/analytics concern
```

Ini memungkinkan:

- UI mencari process instance dengan filter kompleks;
- user melihat task list;
- analyst menghitung bottleneck;
- auditor membaca historical events;
- tim ops melakukan incident triage;
- engineer membuat custom read model;
- runtime engine tetap fokus menjalankan proses.

---

## 4. Secondary Storage

Dalam Camunda 8 Self-Managed, secondary storage adalah backend query/projection untuk fitur seperti Operate, Tasklist, Identity/Admin, dan search-based APIs.

Historically, Elasticsearch/OpenSearch sangat dominan dalam Camunda 8 self-managed. Versi terbaru juga memperkenalkan konsep secondary storage yang lebih umum, termasuk dukungan backend lain sesuai konfigurasi dan dukungan versi.

Mental model:

```text
Zeebe stream = fact source for execution
Secondary storage = query/index/projection store
```

Jangan dibalik.

Secondary storage boleh menjawab:

- instance mana yang terlihat di Operate;
- task mana yang muncul di Tasklist;
- variable apa yang sudah diproyeksikan;
- incident apa yang sudah terlihat;
- historical path mana yang sudah bisa dianalisis;
- report apa yang bisa dihitung.

Secondary storage tidak boleh menjadi sumber keputusan command-critical seperti:

- “boleh complete job ini atau tidak?”
- “process sudah pasti menunggu message atau belum?”
- “state authoritative saat ini apa?”
- “apakah command berikutnya pasti valid?”

Keputusan command-critical harus melalui Zeebe API/engine semantics, bukan membaca projection secara naïf.

---

## 5. Operate: Operational Projection, Bukan Source of Truth

Operate adalah tool untuk melihat dan mengoperasikan process instance.

Operate membantu:

- melihat running process instances;
- melihat completed/canceled/terminated instances;
- melihat flow node state;
- melihat variables;
- melihat incidents;
- retry/resolution operation;
- process instance modification/cancellation;
- debugging production issue.

Namun Operate membaca dari projection/imported data, bukan langsung dari internal broker state secara transactional.

Implikasi:

```text
Command selesai di broker
        !=
langsung terlihat sempurna di Operate
```

Kemungkinan kondisi:

1. Process instance sudah berjalan, tetapi belum muncul di Operate.
2. Job sudah completed, tetapi node masih tampak aktif sesaat.
3. Incident sudah muncul di broker, tetapi belum muncul di Operate.
4. Variable sudah berubah, tetapi UI masih menunjukkan nilai lama.
5. Flow node sudah completed, tetapi projection belum catch up.

Untuk engineer yang terbiasa Camunda 7 Cockpit + DB query langsung, ini sering menjadi sumber kebingungan.

Prinsip:

> Operate adalah alat observability dan operation. Ia sangat penting, tetapi tetap read-side projection.

---

## 6. Tasklist: Human Task Projection dan Interaction Layer

Tasklist bertugas menampilkan dan mengelola user task.

Tasklist concern:

- available tasks;
- assigned tasks;
- candidate groups/users;
- claim/unclaim;
- form display;
- task completion;
- task variables;
- task filters/search;
- human workflow visibility.

Namun Tasklist juga bergantung pada imported/projected task data.

Contoh masalah yang sering terjadi:

```text
Process memasuki user task
        -> Zeebe sudah membuat task state
        -> exporter/importer belum selesai
        -> Tasklist belum menampilkan task
```

Dari sudut user:

> “Task belum muncul.”

Dari sudut engine:

> “Task mungkin sudah ada, tetapi projection/search side belum catch up.”

Ini penting ketika membangun custom task application. Jangan berasumsi bahwa setelah command `createProcessInstance` sukses, task pertama langsung bisa dicari di Tasklist API pada millisecond yang sama.

Arsitektur UI harus tolerate eventual consistency:

- polling dengan backoff;
- refresh state;
- user-friendly pending state;
- correlation ID untuk support;
- jangan double-create process hanya karena task belum muncul;
- jangan menganggap empty search sebagai proof bahwa task tidak ada.

---

## 7. Optimize: Analytical Projection, Bukan Operational Ground Truth

Optimize dipakai untuk:

- process analytics;
- bottleneck detection;
- cycle time analysis;
- user task duration;
- SLA trend;
- variant analysis;
- process improvement;
- business dashboard.

Optimize bekerja di analytical layer. Data yang dianalisis adalah data yang sudah tersedia melalui pipeline/projection.

Karena itu Optimize cocok untuk pertanyaan:

```text
Berapa rata-rata waktu review aplikasi bulan ini?
Task mana yang menjadi bottleneck?
Berapa persentase proses yang melewati SLA?
Varian alur mana yang paling sering terjadi?
```

Tidak cocok untuk pertanyaan command-time seperti:

```text
Apakah instance X saat ini boleh saya kirim command Y?
Apakah task Y pasti masih open saat ini?
Apakah process sudah 100% pada state Z saat transaksi ini?
```

Analytics selalu memiliki konteks data freshness.

---

## 8. Command Path vs Read Path: Diagram Besar

```text
                           +-------------------+
                           | Java App / Worker |
                           +---------+---------+
                                     |
                                     | command/query API
                                     v
                               +-----+-----+
                               | Gateway   |
                               +-----+-----+
                                     |
                                     | routed command
                                     v
                           +---------+---------+
                           | Zeebe Broker      |
                           | Leader Partition  |
                           +---------+---------+
                                     |
                                     | append/process records
                                     v
                           +---------+---------+
                           | Zeebe Stream      |
                           +---------+---------+
                                     |
                                     | export records
                                     v
                 +-------------------+-------------------+
                 |                                       |
                 v                                       v
      +----------------------+              +-------------------------+
      | Secondary Storage    |              | Custom Export Pipeline  |
      | ES / OS / RDBMS      |              | Audit/Data Lake/etc.    |
      +----------+-----------+              +-----------+-------------+
                 |                                      |
     +-----------+-----------+                          |
     |           |           |                          |
     v           v           v                          v
+--------+   +---------+   +----------+          +----------------+
|Operate |   |Tasklist |   |Optimize  |          |Custom Reports  |
+--------+   +---------+   +----------+          +----------------+
```

Perhatikan dua hal:

1. Command path harus tetap sederhana, cepat, dan reliable.
2. Read path boleh kaya fitur, tetapi harus menerima konsekuensi projection lag.

---

## 9. Record Stream: Bahan Baku Projection

Exporter tidak menerima “row database final”. Exporter menerima record dari stream.

Record bisa dipahami sebagai fakta teknis bahwa sesuatu terjadi atau diperintahkan dalam engine.

Contoh konseptual:

```json
{
  "partitionId": 2,
  "position": 87123211,
  "key": 4503599627371001,
  "valueType": "JOB",
  "intent": "CREATED",
  "timestamp": "2026-06-21T10:15:30.123Z",
  "value": {
    "type": "verify-applicant",
    "processInstanceKey": 2251799813685249,
    "elementId": "Task_VerifyApplicant",
    "retries": 3
  }
}
```

Atau:

```json
{
  "valueType": "VARIABLE",
  "intent": "CREATED",
  "value": {
    "name": "applicationStatus",
    "value": "PENDING_REVIEW",
    "processInstanceKey": 2251799813685249,
    "scopeKey": 2251799813685251
  }
}
```

Read model harus membangun state dari sequence record ini.

Artinya, projection logic perlu memahami:

- ordering per partition;
- key semantics;
- value type;
- intent;
- variable scope;
- process instance relationship;
- flow node lifecycle;
- deleted/updated state;
- incident lifecycle;
- task lifecycle.

---

## 10. Position, Ordering, dan Checkpoint

Dalam stream system, exporter perlu tahu sampai mana ia sudah memproses record.

Konsep penting:

| Konsep | Makna |
|---|---|
| partition | stream shard tempat record berada |
| position | offset/urutan record dalam partition |
| exporter state/checkpoint | posisi terakhir yang sudah aman diproses exporter |
| lag | jarak antara stream terbaru dan record terakhir yang diproyeksikan |

Projection yang benar tidak hanya “consume lalu write”. Ia harus:

1. membaca record secara ordered per partition;
2. menulis ke target storage;
3. menyimpan progress/checkpoint;
4. bisa resume setelah restart;
5. tidak membuat duplicate logical state saat retry;
6. tidak kehilangan record saat crash.

Pattern umum:

```text
for each partition:
    read next record
    transform record into projection update
    write projection update idempotently
    persist exporter position/checkpoint
```

Kalau step 3 berhasil tetapi checkpoint gagal, record bisa diproses ulang.

Kalau step 3 gagal tetapi checkpoint berhasil, record bisa hilang dari projection.

Maka exporter harus sangat hati-hati dengan atomicity/idempotency.

---

## 11. Projection Lag

Projection lag adalah keterlambatan read model dibanding source stream.

Penyebab:

1. exporter lambat;
2. target storage lambat;
3. Elasticsearch/OpenSearch indexing pressure;
4. bulk indexing failure;
5. network issue;
6. broker menghasilkan event lebih cepat daripada exporter memproses;
7. large variable payload;
8. high-cardinality index;
9. inefficient mapping/index template;
10. disk I/O bottleneck;
11. reindex/retention task;
12. target cluster yellow/red;
13. throttling/backpressure;
14. version migration/import backlog.

Gejala:

- Operate telat update;
- Tasklist task telat muncul;
- incident tidak langsung terlihat;
- Optimize report tertinggal;
- search result tidak konsisten;
- support team melihat “state lama”;
- user melakukan duplicate action karena UI belum update.

Mental model:

```text
read-your-write tidak otomatis berlaku di projection path
```

Setelah command sukses, UI/read model bisa butuh waktu untuk catch up.

---

## 12. Eventual Consistency di Custom Application

Kalau kita membangun aplikasi enterprise di atas Camunda 8, kita harus eksplisit menentukan mana operasi yang butuh consistency kuat dan mana yang bisa eventual.

Contoh:

### 12.1 Start Application Flow

```text
User submit application
  -> backend validates input
  -> backend creates process instance
  -> backend stores application row in domain DB
  -> UI redirects to application detail page
```

Pertanyaan: setelah create process instance sukses, apakah UI harus langsung menampilkan task dari Tasklist?

Jawaban production-grade: tidak harus. UI bisa menampilkan:

```text
Application submitted. Workflow is being prepared.
```

Lalu melakukan refresh/polling sampai task projection muncul.

### 12.2 Complete User Task

```text
User clicks Approve
  -> backend completes user task
  -> process moves to next service task
  -> worker processes verification
  -> next task may appear later
```

Jangan langsung mengharapkan task berikutnya muncul synchronous.

Desain UI:

- disable double-submit;
- show command accepted;
- refresh task queue asynchronously;
- correlate by task id/process instance id;
- do not infer failure from delayed visibility.

### 12.3 Dashboard Count

Dashboard count dari projection boleh eventual.

```text
Pending Review: 125
```

Angka ini bukan kontrak transaction-level. Untuk regulatory dashboard, tampilkan `lastUpdatedAt` dan definisikan freshness SLA.

---

## 13. Operate Data vs Domain Data

Kesalahan umum: menyimpan semua business data di Camunda variables lalu berharap Operate/Elasticsearch menjadi domain database.

Ini salah untuk banyak sistem enterprise.

Camunda variables cocok untuk:

- orchestration decision data;
- small routing attributes;
- correlation keys;
- status flags;
- references to domain entities;
- worker input/output minimal;
- audit-relevant decision snapshot tertentu.

Domain database tetap harus menyimpan:

- application detail;
- applicant profile;
- document metadata;
- case record;
- enforcement entity;
- financial calculation;
- evidence record;
- user decision record;
- immutable domain audit.

Pattern yang lebih sehat:

```text
Camunda variable:
{
  "applicationId": "APP-2026-000123",
  "caseId": "CASE-2026-000777",
  "riskBand": "HIGH",
  "reviewOutcome": "APPROVED"
}

Domain DB:
- full application data
- applicant data
- documents
- assessment detail
- decision comments
- evidence
- attachments
- domain audit
```

Camunda projection membantu operational visibility, bukan menggantikan domain persistence.

---

## 14. Exporter sebagai Audit Source: Manfaat dan Batas

Exporter record sangat berguna untuk audit teknis:

- process instance created;
- element activated/completed;
- job failed;
- BPMN error thrown;
- variable changed;
- incident created/resolved;
- message correlated;
- user task completed.

Namun audit enterprise biasanya butuh dua jenis audit:

### 14.1 Process Audit

Menjawab:

```text
Process lewat node apa saja?
Kapan task dibuat?
Kapan job gagal?
Kapan incident terjadi?
Siapa menyelesaikan user task?
```

### 14.2 Domain Audit

Menjawab:

```text
Siapa mengubah field application address?
Apa nilai sebelum/sesudah?
Dokumen apa yang dipakai sebagai evidence?
Apa alasan officer approve/reject?
Rule mana yang dipakai?
Apakah keputusan memenuhi policy X?
```

Zeebe exported records bisa membantu process audit, tetapi domain audit tetap harus dirancang di aplikasi domain.

Untuk regulated system, jangan hanya mengandalkan Operate sebagai audit trail final.

---

## 15. Designing Custom Read Model

Custom read model berguna ketika Operate/Tasklist/Optimize tidak cukup.

Contoh kebutuhan:

- regulatory case dashboard;
- cross-process search;
- SLA breach report;
- audit event archive;
- near-real-time risk queue;
- task workload by agency/team;
- process-to-domain timeline;
- legal defensibility package;
- external reporting to data warehouse;
- data lake analytics;
- alerting pipeline.

Ada beberapa pilihan arsitektur.

### 15.1 Direct Custom Exporter

```text
Zeebe broker
  -> custom exporter
  -> target system
```

Kelebihan:

- dekat ke source stream;
- bisa process semua record;
- rendah latency;
- powerful.

Kekurangan:

- berjalan dalam konteks broker process;
- kesalahan exporter bisa berdampak serius;
- perlu lifecycle dan compatibility care;
- tidak tersedia di SaaS;
- upgrade Camunda bisa memerlukan validasi ulang;
- butuh high engineering maturity.

Gunakan hanya jika benar-benar perlu dan tim memahami risk.

### 15.2 Consume dari Secondary Storage

```text
Zeebe
  -> official exporter
  -> Elasticsearch/OpenSearch/RDBMS
  -> custom reporting service
```

Kelebihan:

- lebih sederhana;
- tidak mengganggu broker;
- menggunakan data yang sama dengan Operate/Tasklist;
- cocok untuk reporting/search.

Kekurangan:

- tergantung projection schema;
- schema bisa berubah antar versi;
- eventual consistency;
- query berat bisa mengganggu Operate/Tasklist jika storage shared;
- tidak selalu ideal untuk compliance archive.

### 15.3 Domain Event Projection dari Worker/Application

```text
Worker/domain service
  -> domain outbox
  -> Kafka/RabbitMQ/etc.
  -> audit/read model
```

Kelebihan:

- domain-oriented;
- strong business semantics;
- lebih stabil daripada internal engine record;
- mudah dikontrol schema versioning;
- cocok untuk audit bisnis.

Kekurangan:

- tidak menangkap semua technical process events;
- perlu discipline event publishing;
- bisa berbeda dari actual process path kalau tidak dikorelasikan dengan process instance.

### 15.4 Hybrid

Untuk enterprise system, hybrid sering paling baik:

```text
Zeebe exported records     -> process audit / operational timeline
Domain outbox events       -> business audit / domain reporting
Tasklist/Operate APIs      -> user/ops application interaction
Data warehouse projection  -> analytics/reporting
```

---

## 16. Custom Exporter: Responsibility dan Bahaya

Custom exporter menggoda karena terlihat seperti “tinggal consume semua event”. Namun ia berada dekat dengan engine.

Custom exporter harus:

1. tidak blocking lama;
2. melakukan batching;
3. handle retry;
4. idempotent;
5. menyimpan checkpoint dengan benar;
6. tidak mengirim secret/data sensitif sembarangan;
7. tahan terhadap target outage;
8. punya backpressure strategy;
9. punya metrics;
10. kompatibel dengan versi Zeebe;
11. punya disaster recovery plan.

Hal yang tidak boleh dilakukan:

- memanggil API lambat synchronously tanpa timeout;
- melakukan heavy transformation CPU di broker;
- mengirim semua variable PII ke external system tanpa filtering;
- membuat exporter crash loop;
- bergantung pada target system tanpa fallback;
- menulis projection non-idempotent;
- menempatkan business decision logic di exporter.

Exporter bukan worker bisnis. Exporter adalah read-side stream processor.

---

## 17. Read Model Idempotency

Projection update harus idempotent karena record bisa diproses ulang setelah crash/restart.

Misalnya target table:

```sql
CREATE TABLE zeebe_event_projection (
    partition_id      INTEGER      NOT NULL,
    position          BIGINT       NOT NULL,
    record_key        BIGINT       NOT NULL,
    value_type        VARCHAR(64)  NOT NULL,
    intent            VARCHAR(64)  NOT NULL,
    process_instance_key BIGINT,
    element_id        VARCHAR(255),
    event_time        TIMESTAMP    NOT NULL,
    payload_json      CLOB,
    PRIMARY KEY (partition_id, position)
);
```

Dengan primary key `(partition_id, position)`, retry insert tidak menciptakan duplicate.

Untuk read summary:

```sql
CREATE TABLE process_instance_summary (
    process_instance_key BIGINT PRIMARY KEY,
    bpmn_process_id      VARCHAR(255) NOT NULL,
    version              INTEGER,
    state                VARCHAR(64) NOT NULL,
    started_at           TIMESTAMP,
    ended_at             TIMESTAMP,
    last_record_position BIGINT,
    updated_at           TIMESTAMP
);
```

Update summary harus monotonic terhadap position:

```sql
UPDATE process_instance_summary
SET state = ?,
    last_record_position = ?,
    updated_at = ?
WHERE process_instance_key = ?
  AND last_record_position < ?;
```

Ini mencegah older replay menimpa state baru.

---

## 18. Read Model Schema Design

Jangan hanya dump JSON mentah lalu berharap semua reporting mudah.

Read model biasanya butuh beberapa layer:

### 18.1 Raw Event Archive

```text
partition_id
position
record_key
value_type
intent
timestamp
raw_payload
```

Tujuan:

- traceability;
- replay;
- forensic;
- debugging;
- future re-projection.

### 18.2 Process Instance Summary

```text
process_instance_key
bpmn_process_id
process_definition_key
version
business_key / correlation id
state
started_at
completed_at
incident_count
current_element_ids
```

Tujuan:

- search;
- dashboard;
- operational list.

### 18.3 Element Timeline

```text
process_instance_key
element_instance_key
element_id
element_type
state
activated_at
completed_at
terminated_at
duration_ms
```

Tujuan:

- process audit;
- bottleneck;
- support.

### 18.4 Job Timeline

```text
job_key
job_type
worker
retries
state
activated_at
completed_at
failed_at
error_message
process_instance_key
element_id
```

Tujuan:

- worker performance;
- retry analysis;
- incident root cause.

### 18.5 User Task Timeline

```text
task_key
process_instance_key
element_id
assignee
candidate_groups
created_at
claimed_at
completed_at
outcome
due_date
follow_up_date
```

Tujuan:

- human workload;
- SLA;
- maker-checker audit.

### 18.6 Variable Snapshot / Variable History

Ada dua pilihan:

```text
latest variable snapshot
```

atau:

```text
variable history by update event
```

Untuk audit, variable history lebih defensible. Untuk dashboard, latest snapshot lebih cepat.

---

## 19. Elasticsearch/OpenSearch Indexing Concerns

Elasticsearch/OpenSearch bagus untuk search dan analytics-like queries, tetapi bisa bermasalah jika diperlakukan seperti relational transactional DB.

Perhatikan:

1. index mapping;
2. field cardinality;
3. dynamic mapping explosion;
4. payload besar;
5. nested object complexity;
6. refresh interval;
7. shard count;
8. replica count;
9. disk watermark;
10. JVM heap;
11. query pattern;
12. retention;
13. ILM/ISM;
14. bulk indexing throughput;
15. cluster health;
16. snapshot/restore.

Variable payload yang liar bisa memicu mapping explosion.

Contoh buruk:

```json
{
  "variables": {
    "field_20260621_101530_123": "value",
    "field_20260621_101531_456": "value",
    "field_20260621_101532_789": "value"
  }
}
```

Ini menciptakan dynamic field terus-menerus.

Lebih baik:

```json
{
  "attributes": [
    { "name": "fieldA", "value": "value" },
    { "name": "fieldB", "value": "value" }
  ]
}
```

atau lebih baik lagi, jangan kirim dynamic arbitrary object ke process variables.

---

## 20. Retention dan Archival

Read-side storage akan tumbuh.

Sumber pertumbuhan:

- process instance events;
- variable updates;
- job records;
- incidents;
- user task records;
- messages;
- timers;
- Optimize analytics;
- Operate indices;
- Tasklist indices;
- custom indices.

Pertanyaan governance:

1. Berapa lama running/completed instances perlu terlihat di Operate?
2. Berapa lama user task history perlu tersedia?
3. Berapa lama variable values disimpan?
4. Apakah PII boleh tinggal di projection?
5. Apa policy archival?
6. Apa policy deletion?
7. Apakah audit perlu immutable storage?
8. Apakah data warehouse mengambil snapshot harian?
9. Bagaimana restore jika auditor meminta case lama?
10. Apakah retention berbeda per tenant/agency?

Untuk regulated workflow, retention bukan technical cleanup semata. Itu governance decision.

---

## 21. Data Privacy dan PII di Projection

Jika variable mengandung PII, maka PII bisa ikut masuk projection.

Contoh variable berisiko:

```json
{
  "fullName": "...",
  "nationalId": "...",
  "email": "...",
  "phone": "...",
  "address": "...",
  "medicalCondition": "...",
  "investigationNotes": "..."
}
```

Jika diekspor ke Elasticsearch/OpenSearch:

- siapa yang bisa query?
- apakah masked?
- apakah encrypted at rest?
- apakah masuk backup?
- apakah masuk snapshot?
- apakah masuk log?
- apakah masuk Optimize?
- apakah masuk custom dashboard?
- apakah retention sesuai policy?

Prinsip:

```text
Jangan memasukkan data ke process variables hanya karena mudah.
```

Gunakan reference-over-payload:

```json
{
  "applicationId": "APP-2026-000123",
  "applicantRef": "APPLICANT-88291",
  "riskBand": "HIGH"
}
```

Data detail tetap di domain service yang punya authorization, masking, encryption, retention, dan audit lebih tepat.

---

## 22. Operate/Tasklist API dalam Custom UI

Saat membangun custom task/case UI, beberapa pendekatan mungkin:

```text
A. UI langsung memakai Tasklist/Operate API
B. Backend-for-Frontend memakai Tasklist/Operate API
C. BFF menggabungkan Tasklist/Operate API + domain DB
D. BFF memakai custom read model + Camunda API
```

Untuk enterprise, B atau C sering lebih baik.

```text
Frontend
   -> BFF
       -> Camunda Tasklist API
       -> Camunda Operate API
       -> Domain services
       -> Authorization service
```

Kenapa tidak langsung dari FE?

- token exposure;
- fine-grained authorization;
- data masking;
- tenant enforcement;
- aggregation;
- audit;
- rate limiting;
- stable API contract;
- UI-specific composition.

BFF juga bisa menyembunyikan eventual consistency dengan UX yang lebih baik.

---

## 23. Anti-Pattern: Query Projection untuk Mengambil Keputusan Command

Contoh anti-pattern:

```java
boolean taskVisible = tasklistApi.searchTask(processInstanceKey).isPresent();
if (!taskVisible) {
    createNewProcessInstance(command);
}
```

Masalah:

- task mungkin belum terproyeksi;
- search bisa stale;
- Tasklist bisa lag;
- user bisa menciptakan duplicate process.

Lebih baik:

- gunakan idempotency key di domain DB;
- simpan process instance key saat create;
- enforce unique business id;
- treat projection absence as unknown;
- reconciliation job untuk detect missing visibility.

Contoh desain:

```sql
CREATE TABLE workflow_start_guard (
    business_id           VARCHAR(128) PRIMARY KEY,
    process_instance_key  BIGINT NOT NULL,
    started_at            TIMESTAMP NOT NULL,
    status                VARCHAR(64) NOT NULL
);
```

Flow:

```text
1. Insert guard by business_id.
2. If already exists, return existing process_instance_key.
3. Create process instance.
4. Store process_instance_key.
5. UI waits for projection asynchronously.
```

---

## 24. Anti-Pattern: Operate as Business Database

Contoh anti-pattern:

```text
Application status page reads all state from Operate variables.
```

Masalah:

- Operate schema/API bukan domain contract utama;
- variable projection bisa lag;
- variable payload bisa berubah antar process version;
- authorization domain sulit;
- reporting jadi tergantung internal workflow model;
- domain UI rusak saat BPMN refactor.

Lebih baik:

```text
Domain DB owns business status.
Camunda owns orchestration state.
Custom projection correlates both for operational timeline.
```

Contoh:

```text
application.status = UNDER_REVIEW
workflow.currentElement = ManagerReviewTask
```

Keduanya berhubungan, tetapi tidak identik.

---

## 25. Projection Lag Playbook

Ketika user berkata:

> “Process sudah jalan tapi tidak muncul di Operate.”

Jangan langsung menyimpulkan engine gagal.

Checklist:

1. Apakah command create instance sukses?
2. Ada process instance key?
3. Broker healthy?
4. Gateway healthy?
5. Partition leader available?
6. Exporter healthy?
7. Secondary storage healthy?
8. Importer/Operate healthy?
9. Ada exporter lag?
10. Ada index write rejection?
11. Elasticsearch/OpenSearch cluster green/yellow/red?
12. Disk watermark?
13. Mapping error?
14. Large variable payload?
15. Query filter salah?
16. Tenant/auth filter menyembunyikan data?
17. Process version/deployment salah?

Support response yang matang:

```text
Command path and read path are separate. We have confirmed process instance creation at Zeebe command level. Current symptom points to projection/import visibility delay. We are checking exporter lag, secondary storage health, and Operate importer status before declaring runtime failure.
```

---

## 26. Exporter Failure Modes

| Failure | Symptom | Risk | Mitigation |
|---|---|---|---|
| target storage down | Operate/Tasklist stale | low visibility | monitor exporter lag, restore storage |
| slow indexing | UI delayed | support confusion | tune bulk/index/storage |
| mapping error | some records fail | missing data | schema discipline, dead-letter strategy |
| huge variables | indexing pressure | lag/storage bloat | payload discipline |
| exporter crash | projection stops | stale read side | health check, restart, alert |
| checkpoint bug | duplicate/missing projection | audit risk | idempotent writes, tests |
| disk full | indexing fails | cluster instability | retention, capacity planning |
| auth failure to storage | exporter cannot write | stale projections | secret rotation monitoring |
| version incompatibility | importer/exporter error | upgrade incident | upgrade rehearsal |

---

## 27. Read-Side Observability Metrics

Minimal metrics yang harus dimonitor:

### 27.1 Exporter Metrics

- exported records per second;
- exporter lag per partition;
- last exported position;
- exporter errors;
- export batch duration;
- retry count;
- failed bulk writes;
- checkpoint progress;
- exporter queue size.

### 27.2 Secondary Storage Metrics

- indexing rate;
- indexing latency;
- bulk rejection;
- search latency;
- JVM heap;
- CPU;
- disk usage;
- disk watermark;
- shard health;
- cluster status;
- refresh latency;
- merge pressure;
- thread pool rejection.

### 27.3 Operate/Tasklist/Optimize Metrics

- importer lag;
- API latency;
- error rate;
- failed imports;
- query latency;
- task search latency;
- incident visibility delay;
- application health.

### 27.4 Business Visibility Metrics

- process created to visible in Operate latency;
- user task created to visible in Tasklist latency;
- command accepted to dashboard updated latency;
- SLA dashboard freshness;
- number of stale queue items.

---

## 28. Alert Design

Bad alert:

```text
Operate has 1 stale instance.
```

Better alert:

```text
Projection lag p95 > 60s for 10 minutes.
```

Better still:

```text
Task visibility latency p95 > 30s and pending human task queue freshness > 2 minutes.
```

Alert classes:

### 28.1 Critical

- secondary storage unavailable;
- exporter stopped;
- exporter lag growing rapidly;
- Operate/Tasklist unavailable during business hours;
- disk near full;
- cluster red;
- importer failing continuously.

### 28.2 Warning

- lag above normal baseline;
- indexing rejection increasing;
- query latency degrading;
- index size growth faster than forecast;
- Optimize import delayed.

### 28.3 Informational

- retention cleanup completed;
- index rollover;
- scheduled maintenance;
- reindex in progress.

---

## 29. Designing a Regulatory Timeline Projection

Untuk sistem enforcement/case management, sering dibutuhkan timeline yang bisa menjawab:

```text
Apa yang terjadi pada case ini, kapan, oleh siapa/sistem apa, berdasarkan event/decision mana?
```

Timeline bisa menggabungkan:

```text
Zeebe process events
+ user task events
+ domain audit events
+ document events
+ correspondence events
+ external integration events
```

Contoh model:

```sql
CREATE TABLE case_timeline_event (
    event_id              VARCHAR(64) PRIMARY KEY,
    case_id               VARCHAR(64) NOT NULL,
    source                VARCHAR(64) NOT NULL,
    source_partition_id   INTEGER,
    source_position       BIGINT,
    source_record_key     BIGINT,
    process_instance_key  BIGINT,
    event_type            VARCHAR(128) NOT NULL,
    event_time            TIMESTAMP NOT NULL,
    actor_type            VARCHAR(32),
    actor_id              VARCHAR(128),
    summary               VARCHAR(1000),
    details_json          CLOB,
    created_at            TIMESTAMP NOT NULL
);
```

Event source examples:

```text
ZEEBE_FLOW_NODE_ACTIVATED
ZEEBE_JOB_FAILED
ZEEBE_INCIDENT_CREATED
TASK_COMPLETED
DOMAIN_APPLICATION_UPDATED
DOMAIN_DECISION_RECORDED
DOCUMENT_UPLOADED
EMAIL_SENT
EXTERNAL_VERIFICATION_RESULT_RECEIVED
```

Ini lebih defensible daripada mencoba memaksa Operate menjadi case timeline final.

---

## 30. Combining Exported Records with Domain Outbox

Salah satu desain paling kuat:

```text
Worker completes domain operation inside DB transaction
  -> writes domain state
  -> writes domain audit event
  -> writes outbox event
  -> commits
  -> completes Zeebe job

Separately:
  Zeebe exporter writes process events
  Outbox publisher writes domain events
  Timeline projection correlates both
```

Keuntungan:

- domain audit kuat;
- process audit kuat;
- timeline kaya;
- retry/idempotency lebih aman;
- investigation lebih mudah;
- regulatory defensibility meningkat.

Namun perlu korelasi:

- processInstanceKey;
- elementId;
- businessKey/applicationId/caseId;
- commandId/idempotencyKey;
- actorId;
- timestamp;
- externalReferenceId.

---

## 31. Handling Reprocessing/Reprojection

Read model yang baik bisa dibangun ulang.

Pertanyaan penting:

1. Apakah raw event disimpan?
2. Apakah schema projection versioned?
3. Apakah transformation deterministic?
4. Apakah projection idempotent?
5. Apakah bisa replay dari awal?
6. Apakah bisa replay per case/process instance?
7. Apakah bisa run dual projection saat migration?
8. Apakah bisa compare old vs new projection?

Versioned projection table:

```sql
CREATE TABLE projection_metadata (
    projection_name VARCHAR(128) PRIMARY KEY,
    projection_version INTEGER NOT NULL,
    status VARCHAR(64) NOT NULL,
    last_rebuilt_at TIMESTAMP,
    notes VARCHAR(1000)
);
```

Reprojection strategy:

```text
1. Build new projection table v2.
2. Replay raw events into v2.
3. Validate counts/checksums/sample cases.
4. Switch read API to v2.
5. Keep v1 temporarily.
6. Drop v1 after confidence window.
```

---

## 32. Read API Design Over Projection

Jika kita membangun custom projection, jangan expose storage schema langsung ke frontend.

Gunakan API contract:

```http
GET /cases/{caseId}/workflow-summary
GET /cases/{caseId}/timeline
GET /cases/{caseId}/tasks
GET /workflow/instances/{processInstanceKey}/technical-status
GET /reports/sla-breaches?from=...&to=...
```

Response harus punya metadata freshness:

```json
{
  "caseId": "CASE-2026-000777",
  "workflowState": "PENDING_MANAGER_REVIEW",
  "processInstanceKey": 2251799813685249,
  "lastProjectedAt": "2026-06-21T10:20:45Z",
  "projectionLagMs": 1350,
  "stalenessWarning": false,
  "currentTasks": [
    {
      "taskId": "...",
      "name": "Manager Review",
      "assignee": null,
      "candidateGroups": ["MANAGER"]
    }
  ]
}
```

Ini membuat eventual consistency eksplisit.

---

## 33. Java Projection Service Skeleton

Berikut contoh sederhana untuk read API yang tidak menganggap projection selalu fresh.

```java
public final class WorkflowSummary {
    private final String caseId;
    private final Long processInstanceKey;
    private final String workflowState;
    private final Instant lastProjectedAt;
    private final long projectionLagMillis;
    private final boolean stale;

    public WorkflowSummary(
            String caseId,
            Long processInstanceKey,
            String workflowState,
            Instant lastProjectedAt,
            long projectionLagMillis,
            boolean stale
    ) {
        this.caseId = caseId;
        this.processInstanceKey = processInstanceKey;
        this.workflowState = workflowState;
        this.lastProjectedAt = lastProjectedAt;
        this.projectionLagMillis = projectionLagMillis;
        this.stale = stale;
    }

    public String getCaseId() {
        return caseId;
    }

    public Long getProcessInstanceKey() {
        return processInstanceKey;
    }

    public String getWorkflowState() {
        return workflowState;
    }

    public Instant getLastProjectedAt() {
        return lastProjectedAt;
    }

    public long getProjectionLagMillis() {
        return projectionLagMillis;
    }

    public boolean isStale() {
        return stale;
    }
}
```

```java
public interface WorkflowProjectionRepository {
    Optional<WorkflowProjectionRow> findByCaseId(String caseId);

    Optional<ProjectionHealthRow> findProjectionHealth(String projectionName);
}
```

```java
public final class WorkflowSummaryService {
    private static final Duration STALE_THRESHOLD = Duration.ofSeconds(30);

    private final WorkflowProjectionRepository repository;
    private final Clock clock;

    public WorkflowSummaryService(WorkflowProjectionRepository repository, Clock clock) {
        this.repository = Objects.requireNonNull(repository, "repository");
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    public WorkflowSummary getSummary(String caseId) {
        WorkflowProjectionRow row = repository.findByCaseId(caseId)
                .orElseThrow(() -> new IllegalArgumentException("No workflow projection found for caseId=" + caseId));

        Instant now = Instant.now(clock);
        long lagMillis = Duration.between(row.getLastProjectedAt(), now).toMillis();
        boolean stale = lagMillis > STALE_THRESHOLD.toMillis();

        return new WorkflowSummary(
                caseId,
                row.getProcessInstanceKey(),
                row.getWorkflowState(),
                row.getLastProjectedAt(),
                lagMillis,
                stale
        );
    }
}
```

Catatan: ini bukan replacement untuk Camunda API. Ini read-side API untuk UI/reporting.

---

## 34. Projection-Aware UX

UX yang bagus harus membedakan:

1. command accepted;
2. workflow processing;
3. projection updated;
4. human action required;
5. error/incident.

Contoh setelah submit:

```text
Application submitted successfully.
Workflow reference: WF-2251799813685249.
Current status may take a few seconds to appear.
```

Jangan tampilkan:

```text
No task found. Please submit again.
```

Karena itu bisa menciptakan duplicate process.

Custom UI state machine:

```text
SUBMITTING
  -> COMMAND_ACCEPTED
  -> WAITING_FOR_PROJECTION
  -> READY_FOR_ACTION
  -> INCIDENT_VISIBLE
```

---

## 35. Query Pattern: Search vs Lookup

Projection API harus membedakan:

### 35.1 Lookup by ID

```text
GET /cases/{caseId}/workflow-summary
```

Biasanya butuh cepat dan akurat secara eventual.

### 35.2 Search

```text
GET /tasks?group=MANAGER&status=OPEN&page=...
```

Butuh indexing dan pagination.

### 35.3 Analytics

```text
GET /reports/sla?from=...&to=...
```

Butuh aggregation dan mungkin precomputed table.

Jangan memakai satu index/table untuk semua workload tanpa desain. Search, lookup, dan analytics punya karakter berbeda.

---

## 36. Operate/Tasklist Shared Storage Contention

Jika custom report langsung query Elasticsearch/OpenSearch yang juga dipakai Operate/Tasklist, query berat bisa mengganggu UI operational.

Risiko:

- query aggregation besar;
- wildcard query;
- deep pagination;
- unbounded date range;
- sorting high-cardinality field;
- full payload retrieval;
- reporting batch saat jam kerja.

Mitigation:

1. buat replica/read-only reporting cluster;
2. ETL ke data warehouse;
3. buat custom projection terpisah;
4. batasi query API;
5. gunakan pagination/search_after;
6. cache dashboard;
7. schedule heavy report off-hours;
8. set timeout dan circuit breaker.

---

## 37. Secondary Storage Capacity Planning

Capacity planning minimal harus menghitung:

```text
records per process instance
x process instances per day
x average payload size
x retention days
x replica factor
x indexing overhead
x growth factor
```

Contoh kasar:

```text
20,000 process instances/day
x 80 records/instance
= 1,600,000 records/day

average indexed record 2 KB
= ~3.2 GB/day raw indexed docs

with replicas/overhead say x2.5
= ~8 GB/day

retention 180 days
= ~1.44 TB

plus Optimize/reporting/custom indices
```

Ini hanya contoh. Real number harus diukur dari workload.

Faktor yang sering membuat estimasi meleset:

- variable payload besar;
- multi-instance fan-out;
- retry storm;
- incident loop;
- frequent variable updates;
- excessive service task granularity;
- task history retention;
- Optimize import;
- replicas/snapshots;
- index overhead.

---

## 38. Deployment Topology untuk Read Side

### 38.1 Small/Non-Critical Environment

```text
Zeebe + Operate + Tasklist + Elasticsearch/OpenSearch small cluster
```

Cocok untuk dev/test.

### 38.2 Production Standard

```text
Zeebe brokers on dedicated nodes
Gateway separately scalable
Operate/Tasklist separately scalable
Elasticsearch/OpenSearch dedicated data nodes
Separate monitoring
Retention configured
Backup/snapshot configured
```

### 38.3 Regulated/High-Volume

```text
Zeebe runtime cluster
Official secondary storage for Operate/Tasklist
Custom audit projection
Data warehouse export
Immutable archive
Separate reporting cluster
Strict data classification
```

Key principle:

> Jangan biarkan reporting workload merusak operational visibility.

---

## 39. Upgrade and Compatibility Risks

Read-side architecture sering terkena upgrade risk.

Pertanyaan sebelum upgrade:

1. Apakah exporter behavior berubah?
2. Apakah index schema berubah?
3. Apakah Operate/Tasklist importer berubah?
4. Apakah secondary storage supported version berubah?
5. Apakah custom query ke internal index masih valid?
6. Apakah custom exporter masih kompatibel?
7. Apakah Optimize import filter berubah?
8. Apakah retention settings berubah?
9. Apakah REST/search APIs berubah?
10. Apakah migration memerlukan reindex/import ulang?

Jika custom app langsung bergantung pada internal index, upgrade risk besar.

Lebih aman:

```text
Camunda APIs / controlled custom projection / versioned read contract
```

---

## 40. Migration dari Camunda 7 History Mindset

Camunda 7 engineer sering memakai:

- runtime tables;
- history tables;
- ACT_HI_* query;
- custom SQL;
- Cockpit plugins;
- shared DB reporting;
- engine transaction assumptions.

Di Camunda 8, jangan memindahkan kebiasaan ini mentah-mentah.

Mapping mental:

| Camunda 7 Habit | Camunda 8 Better Thinking |
|---|---|
| query ACT_HI_* directly | use Operate/Tasklist/Optimize/API/custom projection |
| engine DB as reporting source | secondary storage/read model |
| JavaDelegate transaction with engine | external worker + idempotency/outbox |
| history table as audit | process export + domain audit |
| Cockpit as source of operational truth | Operate as projection/ops tool |
| synchronous DB visibility | eventual projection visibility |

Migration harus mencatat semua custom history queries di Camunda 7 dan mendesain ulang read model-nya.

---

## 41. Production Checklist

### 41.1 Exporter/Secondary Storage

- [ ] Exporter health monitored.
- [ ] Exporter lag monitored per partition.
- [ ] Secondary storage cluster health monitored.
- [ ] Disk watermark alert configured.
- [ ] Bulk indexing errors monitored.
- [ ] Retention policy defined.
- [ ] Snapshot/backup configured.
- [ ] Restore tested.
- [ ] PII policy applied.
- [ ] Large variable policy enforced.

### 41.2 Operate/Tasklist

- [ ] UI/API health monitored.
- [ ] Import lag monitored.
- [ ] Auth/tenant filtering tested.
- [ ] Incident triage runbook exists.
- [ ] Task visibility delay expectation documented.
- [ ] User support script prepared.

### 41.3 Custom Read Model

- [ ] Idempotent projection update.
- [ ] Raw event archival decision made.
- [ ] Projection schema versioned.
- [ ] Reprojection plan exists.
- [ ] API exposes freshness metadata.
- [ ] No command-critical decision from stale projection.
- [ ] Domain audit separated from process audit.
- [ ] Heavy reporting isolated from operational storage.

### 41.4 Governance

- [ ] Data classification for variables.
- [ ] Retention and deletion policy approved.
- [ ] Access control to projection storage defined.
- [ ] Audit requirements mapped.
- [ ] Upgrade compatibility tested.
- [ ] Operational ownership clear.

---

## 42. Design Review Questions

Gunakan pertanyaan ini saat review arsitektur:

1. Apa source of truth untuk workflow execution?
2. Apa source of truth untuk business entity state?
3. Apa source of truth untuk audit bisnis?
4. Komponen mana yang hanya projection?
5. Berapa acceptable projection lag?
6. Bagaimana UI menangani projection delay?
7. Apakah process variables mengandung PII?
8. Apakah variable payload terlalu besar?
9. Apakah dashboard membaca Operate index langsung?
10. Apakah custom query bisa mengganggu Tasklist/Operate?
11. Apakah command decision memakai stale read model?
12. Bagaimana duplicate process dicegah?
13. Bagaimana task double-submit dicegah?
14. Bagaimana read model di-rebuild?
15. Bagaimana retention diterapkan?
16. Bagaimana backup/restore diuji?
17. Bagaimana incident exporter dideteksi?
18. Bagaimana migration Camunda 7 history query ditangani?

---

## 43. Top 1% Mental Model

Engineer biasa bertanya:

```text
Bagaimana cara query process instance?
```

Engineer kuat bertanya:

```text
Query itu membaca source of truth atau projection?
Apa freshness guarantee-nya?
Apa yang terjadi jika projection lag?
Apakah query ini dipakai untuk decision atau hanya display?
Bagaimana kalau record diproses ulang?
Bagaimana kalau secondary storage down?
Apakah payload aman untuk diindeks?
Apakah custom reporting mengganggu Operate/Tasklist?
```

Engineer biasa bertanya:

```text
Kenapa task belum muncul?
```

Engineer kuat menjawab:

```text
Mari pisahkan command path dan read path. Jika Zeebe sudah menerima command dan process sudah sampai user task, masalah mungkin ada di projection/import/Tasklist visibility. Kita cek process key, exporter lag, secondary storage health, importer status, auth filter, dan query criteria.
```

Engineer biasa membuat dashboard dari variable projection.

Engineer kuat mendesain:

```text
Domain DB for business state.
Zeebe export for process audit.
Tasklist/Operate for operational interaction.
Custom projection for regulatory timeline.
Data warehouse for analytics.
Freshness metadata everywhere.
```

---

## 44. Kesimpulan

Part ini adalah fondasi untuk memahami Camunda 8 sebagai platform yang memiliki **runtime command side** dan **read/projection side**.

Poin terpenting:

1. Zeebe broker adalah authoritative runtime engine.
2. Exporter membawa records dari stream ke read-side world.
3. Secondary storage mendukung Operate, Tasklist, Optimize, search, dan analytics.
4. Operate/Tasklist/Optimize penting, tetapi bukan source of truth runtime.
5. Projection lag harus dianggap kemungkinan normal.
6. UI dan custom apps harus projection-aware.
7. Custom read model harus idempotent, versioned, observable, dan bisa direbuild.
8. Business audit tidak boleh hanya bergantung pada process projection.
9. Variable discipline mempengaruhi storage, privacy, performance, dan reporting.
10. Production-grade Camunda 8 architecture selalu memisahkan command decision dari read visibility.

Jika Part 000–016 membangun cara berpikir tentang engine, BPMN, worker, correctness, variables, modelling, Spring, architecture, dan connectors, maka Part 017 menambahkan layer penting:

```text
Bagaimana semua kejadian workflow menjadi terlihat, searchable, auditable, dan analyzable tanpa merusak runtime engine.
```

---

## 45. Referensi Resmi dan Bacaan Lanjutan

- Camunda 8 Docs — Zeebe Architecture: https://docs.camunda.io/docs/components/zeebe/technical-concepts/architecture/
- Camunda 8 Docs — Exporters: https://docs.camunda.io/docs/self-managed/concepts/exporters/
- Camunda 8 Docs — Secondary Storage: https://docs.camunda.io/docs/self-managed/concepts/secondary-storage/
- Camunda 8 Docs — Configure Secondary Storage: https://docs.camunda.io/docs/self-managed/concepts/secondary-storage/configuring-secondary-storage/
- Camunda 8 Docs — Elasticsearch Exporter: https://docs.camunda.io/docs/self-managed/components/orchestration-cluster/zeebe/exporters/elasticsearch-exporter/
- Camunda 8 Docs — OpenSearch Exporter: https://docs.camunda.io/docs/self-managed/components/orchestration-cluster/zeebe/exporters/opensearch-exporter/
- Camunda 8 Docs — Self-Managed Overview: https://docs.camunda.io/docs/self-managed/about-self-managed/
- Camunda 8 Docs — Reference Architecture: https://docs.camunda.io/docs/self-managed/reference-architecture/
- Camunda 8 Docs — Task Application Architecture: https://docs.camunda.io/docs/apis-tools/frontend-development/task-applications/task-application-architecture/
- Camunda Blog — Performance Tuning Camunda 8: https://camunda.com/blog/2025/01/performance-tuning-camunda-8/
- Camunda Blog — One Exporter to Rule Them All: Exploring Camunda Exporter: https://camunda.com/blog/2025/02/one-exporter-to-rule-them-all-exploring-camunda-exporter/

---

## Status Seri

Seri belum selesai.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-018.md
```

Judul:

```text
Part 018 — Operate Deep Dive: Incident Triage, Process Instance Debugging, and Production Support
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-016.md">⬅️ Part 016 — Connectors, Integration Patterns, and When Java Workers Are Still Better</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-018.md">Part 018 — Operate Deep Dive: Incident Triage, Process Instance Debugging, and Production Support ➡️</a>
</div>

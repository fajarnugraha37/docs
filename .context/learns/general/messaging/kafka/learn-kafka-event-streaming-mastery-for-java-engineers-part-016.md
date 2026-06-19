# learn-kafka-event-streaming-mastery-for-java-engineers-part-016.md

# Part 016 — CDC with Kafka: Database Logs, Debezium Mental Model, Outbox, and Ordering

> Seri: `learn-kafka-event-streaming-mastery-for-java-engineers`  
> Bagian: `016 / 034`  
> Status seri: **belum selesai**  
> Fokus: memahami Change Data Capture sebagai jembatan antara dunia database transaksional dan Kafka event streaming, tanpa jatuh ke jebakan dual-write, ordering palsu, atau CRUD-stream yang merusak domain model.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan apa itu **Change Data Capture (CDC)** dan mengapa CDC berbeda dari polling biasa.
2. Memahami bagaimana database transaction log seperti WAL/binlog/redo log menjadi sumber perubahan yang durable.
3. Memahami mental model Debezium sebagai **Kafka Connect source connector** yang membaca database log dan menghasilkan Kafka records.
4. Membedakan CDC untuk **data replication**, **analytics**, **cache/search projection**, dan **microservice integration**.
5. Memahami fase **snapshot** dan **streaming** dalam CDC.
6. Membaca struktur umum change event: `before`, `after`, `op`, `source`, timestamp, transaction metadata, key.
7. Memahami delete event, tombstone, dan hubungannya dengan log compaction.
8. Menilai risiko ordering dalam CDC: per-table, per-key, per-transaction, per-partition, cross-table.
9. Memahami mengapa CDC mentah dari tabel tidak selalu sama dengan domain event.
10. Menggunakan **transactional outbox pattern** untuk menghindari dual-write antara database dan Kafka.
11. Mendesain outbox event table yang bisa dipakai untuk event-driven integration.
12. Memahami Debezium Outbox Event Router sebagai transformasi untuk mengubah row outbox menjadi event topic yang lebih domain-oriented.
13. Mengenali failure mode CDC: connector restart, snapshot ulang, schema change, log retention terlalu pendek, duplicate events, lag besar, dan poison schema.
14. Membuat checklist production readiness untuk CDC pipeline.

---

## 2. Mental Model Utama

CDC adalah teknik untuk menangkap perubahan data dari sistem sumber, biasanya database, lalu mengirimkannya ke downstream system. Dalam konteks Kafka, CDC berarti:

```text
Database transaction commit
        ↓
Database transaction log / replication log
        ↓
CDC connector reads committed changes
        ↓
Kafka topic receives change events
        ↓
Consumers build projections, indexes, caches, analytics, workflows
```

Mental model yang paling penting:

> CDC bukan “query database setiap beberapa detik”.  
> CDC adalah “membaca jejak commit yang sudah ditulis database ke log transaksionalnya”.

Database transaksional modern sudah menulis perubahan ke log internal agar bisa melakukan recovery, replication, dan durability. CDC memanfaatkan log tersebut sebagai sumber perubahan.

Contoh:

| Database | Log yang relevan |
|---|---|
| PostgreSQL | WAL + logical decoding |
| MySQL | binlog |
| SQL Server | transaction log / CDC feature |
| Oracle | redo/archive log |
| MongoDB | oplog/change streams |

Dalam Kafka ecosystem, tool yang sangat umum untuk CDC adalah **Debezium**. Debezium adalah platform open-source untuk change data capture yang berjalan sebagai Kafka Connect source connector dan dapat menangkap insert, update, delete dari database lalu menghasilkan event stream ke Kafka.

---

## 3. Mengapa CDC Penting

### 3.1 Problem yang diselesaikan CDC

Banyak sistem modern memiliki kebutuhan seperti:

1. Mengisi search index dari database utama.
2. Mengirim perubahan data ke data warehouse/lakehouse.
3. Membangun read model CQRS.
4. Mengisi cache distributed.
5. Menyinkronkan data antar bounded context.
6. Menghindari query berat ke database operasional.
7. Membuat audit trail downstream.
8. Membuat event-driven integration tanpa memodifikasi banyak service code.
9. Memigrasikan monolith ke microservices secara bertahap.
10. Menghindari dual-write bug saat aplikasi harus menulis database dan publish event.

Tanpa CDC, solusi yang sering muncul adalah polling:

```sql
SELECT *
FROM orders
WHERE updated_at > :last_seen_time
ORDER BY updated_at
LIMIT 1000;
```

Polling terlihat sederhana, tetapi penuh masalah.

### 3.2 Masalah polling

Polling memiliki banyak failure mode:

| Masalah | Penjelasan |
|---|---|
| Missed update | Dua update pada row yang sama bisa terjadi di antara dua polling dan hanya latest state yang terlihat. |
| Clock issue | `updated_at` bergantung pada jam aplikasi/database dan presisi timestamp. |
| Load | Query berkala memberi beban tambahan ke primary database. |
| No delete visibility | Row yang dihapus tidak mudah terdeteksi tanpa soft delete. |
| Ordering lemah | Urutan commit tidak selalu sama dengan `updated_at`. |
| Race condition | Data bisa berubah saat polling batch sedang diproses. |
| Backfill sulit | Harus menggabungkan snapshot dan incremental query sendiri. |
| Schema drift | Query polling sering rapuh terhadap perubahan tabel. |
| Duplicate atau gap | Checkpoint polling sering sulit dibuat benar. |

CDC mengurangi banyak masalah ini karena membaca perubahan dari sumber yang lebih dekat ke commit ordering database.

---

## 4. CDC Bukan Selalu Domain Event

Ini bagian yang sangat penting.

CDC dari tabel menghasilkan **data change events**. Contoh:

```text
Row customer_case id=CASE-123 changed:
status: REVIEW_PENDING → ESCALATED
assigned_officer_id: OFF-9 → OFF-12
updated_at: 2026-06-19T10:12:44Z
```

Domain event yang baik bisa saja:

```text
CaseEscalated
caseId=CASE-123
fromStatus=REVIEW_PENDING
toStatus=ESCALATED
reason=SLA_BREACH
causedBy=SlaMonitorJob
```

Perbedaannya:

| CDC row change | Domain event |
|---|---|
| Berbasis tabel | Berbasis business meaning |
| Mengatakan “kolom berubah” | Mengatakan “sesuatu terjadi dalam domain” |
| Cocok untuk replication/projection | Cocok untuk integration workflow |
| Bisa terlalu low-level | Lebih semantic |
| Mengikuti schema database | Mengikuti contract event |
| Sering bocorkan internal model | Bisa dirancang sebagai API publik |

Maka aturan penting:

> CDC mentah bagus untuk replikasi data, analytics, search index, cache, dan migration.  
> Untuk integrasi domain antar service, pertimbangkan outbox pattern agar event yang dipublish adalah domain event, bukan sekadar row mutation.

---

## 5. Cara Kerja CDC Log-Based

### 5.1 Database commit lifecycle sederhana

Ketika aplikasi menulis ke database:

```text
BEGIN
  UPDATE case SET status = 'ESCALATED' WHERE id = 'CASE-123';
COMMIT
```

Database perlu memastikan perubahan tidak hilang jika crash. Karena itu database menulis perubahan ke transaction log.

Simplifikasi:

```text
Application transaction
        ↓
Database modifies pages/buffers
        ↓
Database writes commit information to transaction log
        ↓
Commit acknowledged
        ↓
Replication/CDC can read committed changes from log
```

CDC connector membaca log ini, bukan melakukan query polling terhadap tabel utama untuk setiap perubahan.

### 5.2 Mengapa membaca log lebih kuat

Karena transaction log berisi urutan perubahan yang database butuhkan untuk durability dan replication.

Keuntungannya:

1. Lebih dekat ke commit order.
2. Bisa menangkap insert/update/delete.
3. Tidak perlu trigger aplikasi untuk setiap perubahan.
4. Bisa menangkap perubahan dari banyak aplikasi yang menulis ke database yang sama.
5. Cocok untuk legacy system yang sulit dimodifikasi.
6. Bisa melanjutkan dari posisi log terakhir setelah restart.
7. Bisa lebih efisien daripada polling berat.

Namun, CDC juga punya batas:

1. Tergantung konfigurasi database log.
2. Tergantung permission replication.
3. Bisa tertinggal jika connector down terlalu lama dan log lama sudah dibuang.
4. Change event sering merefleksikan struktur tabel, bukan domain contract.
5. Snapshot awal perlu dirancang hati-hati.
6. Schema change bisa mengganggu pipeline.

---

## 6. Debezium Mental Model

Debezium biasanya berjalan di dalam Kafka Connect sebagai source connector.

```text
+----------------+       +----------------+       +----------------+
| Source DB      |       | Kafka Connect  |       | Kafka          |
| WAL/binlog     | ----> | Debezium       | ----> | Topic(s)       |
| tables         |       | SourceConnector|       | change events  |
+----------------+       +----------------+       +----------------+
```

Debezium connector bertanggung jawab untuk:

1. Connect ke database.
2. Melakukan snapshot awal jika dikonfigurasi.
3. Membaca transaction log / replication stream.
4. Mengonversi perubahan menjadi Kafka records.
5. Menyimpan source offset di Kafka Connect offset storage.
6. Melanjutkan dari offset terakhir setelah restart.
7. Menghasilkan schema untuk key/value jika menggunakan Schema Registry.
8. Mengirim insert/update/delete ke topic Kafka.

### 6.1 Debezium adalah source connector, bukan magic data lake

Debezium tidak otomatis membuat domain architecture benar. Debezium hanya menangkap perubahan dengan sangat berguna.

Yang tetap harus didesain:

1. Topic naming.
2. Key design.
3. Schema compatibility.
4. Snapshot policy.
5. Filtering table/column.
6. Outbox vs raw CDC.
7. DLQ/retry handling.
8. Monitoring lag.
9. Access control.
10. Downstream idempotency.

---

## 7. Snapshot Phase dan Streaming Phase

CDC pipeline biasanya punya dua fase besar:

```text
Initial snapshot
        ↓
Continuous streaming from transaction log
```

### 7.1 Mengapa perlu snapshot

Misalnya database sudah punya 100 juta row sebelum CDC diaktifkan. Jika connector hanya membaca perubahan baru dari log, downstream tidak punya baseline state.

Snapshot phase mengambil kondisi awal tabel.

```text
Tabel orders saat CDC mulai:
O-001
O-002
O-003
...

Snapshot menghasilkan event awal untuk row-row tersebut.
```

Setelah snapshot selesai, connector masuk ke streaming phase dan membaca perubahan baru dari log.

### 7.2 Tantangan snapshot

Snapshot tidak trivial karena database tetap menerima write saat snapshot berjalan.

Masalah utama:

```text
T1: snapshot mulai membaca table customer
T2: aplikasi update customer C-1
T3: snapshot membaca customer C-1
T4: connector membaca update dari log
```

Tanpa algoritma yang benar, downstream bisa menerima state tidak konsisten, duplicate, atau urutan yang membingungkan.

Debezium memiliki mekanisme snapshot dan incremental snapshot untuk menangani skenario ini, tetapi sebagai engineer kamu tetap harus memahami konsekuensinya:

1. Snapshot event bukan selalu “business event baru”.
2. Snapshot event bisa merepresentasikan state existing.
3. Downstream harus bisa membedakan snapshot vs live change jika perlu.
4. Snapshot bisa menghasilkan volume besar.
5. Snapshot bisa menekan database source.
6. Snapshot bisa terganggu schema change.
7. Snapshot restart bisa menghasilkan duplicate.

### 7.3 Streaming phase

Setelah baseline terbentuk, connector membaca perubahan commit baru dari log.

```text
DB commit #1001 → Kafka event
DB commit #1002 → Kafka event
DB commit #1003 → Kafka event
```

Streaming phase lebih dekat dengan “real-time CDC”.

Namun “real-time” bukan berarti nol latency. Latency dipengaruhi oleh:

1. Database log availability.
2. Connector polling/streaming interval.
3. Connect worker load.
4. Serialization.
5. Kafka producer batching.
6. Broker latency.
7. Downstream consumer lag.

---

## 8. Struktur Change Event Debezium

Debezium umumnya menghasilkan event dengan envelope yang memuat informasi perubahan.

Bentuk konseptual:

```json
{
  "before": {
    "id": "CASE-123",
    "status": "REVIEW_PENDING",
    "assigned_officer_id": "OFF-9"
  },
  "after": {
    "id": "CASE-123",
    "status": "ESCALATED",
    "assigned_officer_id": "OFF-12"
  },
  "source": {
    "db": "regulatory_case_db",
    "schema": "public",
    "table": "case",
    "lsn": "...",
    "txId": "..."
  },
  "op": "u",
  "ts_ms": 1781873564000
}
```

Field umum:

| Field | Meaning |
|---|---|
| `before` | State row sebelum perubahan. Biasanya ada untuk update/delete jika database menyediakan. |
| `after` | State row setelah perubahan. Ada untuk insert/update. Null untuk delete. |
| `source` | Metadata sumber: database, table, log position, connector info. |
| `op` | Operation: create/read/update/delete. |
| `ts_ms` | Timestamp event/processing/source tergantung field dan connector. |
| transaction metadata | Informasi transaksi jika diaktifkan. |

Operation umum:

| `op` | Meaning |
|---|---|
| `c` | Create/insert |
| `u` | Update |
| `d` | Delete |
| `r` | Snapshot read |

Catatan penting:

> `op = r` bukan berarti user membuat data baru. Itu berarti connector membaca row saat snapshot.

---

## 9. Kafka Record Key dalam CDC

Dalam CDC, Kafka record key biasanya berasal dari primary key tabel.

Contoh table:

```sql
CREATE TABLE case_file (
  id VARCHAR PRIMARY KEY,
  status VARCHAR NOT NULL,
  assigned_officer_id VARCHAR,
  updated_at TIMESTAMP NOT NULL
);
```

Kafka key:

```json
{
  "id": "CASE-123"
}
```

Kafka value:

```json
{
  "before": { ... },
  "after": { ... },
  "op": "u",
  "source": { ... }
}
```

Mengapa key penting?

1. Menentukan partition jika topic menggunakan key-based partitioning.
2. Menjaga ordering per row/entity key dalam topic.
3. Memungkinkan log compaction.
4. Memungkinkan downstream upsert.
5. Memungkinkan dedup/idempotency.

Jika table tidak punya primary key, CDC menjadi lebih lemah:

1. Key bisa null atau tidak stabil.
2. Compaction tidak meaningful.
3. Delete/update sulit dikorelasikan.
4. Ordering per entity tidak jelas.
5. Downstream upsert menjadi rapuh.

Production rule:

> Jangan anggap semua tabel layak di-CDC-kan. Tabel tanpa primary key, tabel audit noisy, tabel temp, dan tabel high-churn harus dievaluasi khusus.

---

## 10. Insert, Update, Delete, dan Tombstone

### 10.1 Insert

Insert menghasilkan event dengan `before = null`, `after = row baru`.

```json
{
  "before": null,
  "after": {
    "id": "CASE-123",
    "status": "OPEN"
  },
  "op": "c"
}
```

### 10.2 Update

Update menghasilkan event dengan state sebelum dan sesudah, tergantung connector/database.

```json
{
  "before": {
    "id": "CASE-123",
    "status": "OPEN"
  },
  "after": {
    "id": "CASE-123",
    "status": "UNDER_REVIEW"
  },
  "op": "u"
}
```

### 10.3 Delete

Delete biasanya menghasilkan event dengan `after = null`.

```json
{
  "before": {
    "id": "CASE-123",
    "status": "UNDER_REVIEW"
  },
  "after": null,
  "op": "d"
}
```

### 10.4 Tombstone

Jika topic compacted, Kafka membutuhkan tombstone record untuk menghapus key dari compacted log.

Tombstone berarti:

```text
key = CASE-123
value = null
```

Bukan:

```json
{
  "op": "d",
  "after": null
}
```

Perbedaannya:

| Event | Meaning |
|---|---|
| Delete event | Memberi tahu bahwa row dihapus. Masih punya payload. |
| Tombstone | Instruksi kepada Kafka compaction bahwa key bisa dibersihkan. Value null. |

Debezium secara default pada beberapa connector dapat mengirim delete event diikuti tombstone untuk mendukung log compaction.

### 10.5 Risiko tombstone

Tombstone sangat berguna, tetapi berbahaya jika consumer tidak siap.

Consumer harus bisa menangani:

```java
if (record.value() == null) {
    // tombstone: delete local projection/cache entry
}
```

Failure umum:

1. Consumer deserialize value null lalu NPE.
2. Sink connector menganggap tombstone sebagai error.
3. Topic tidak compacted tetapi tombstone tetap dikirim tanpa kebutuhan jelas.
4. Tombstone retention terlalu pendek untuk slow consumer yang membangun projection dari awal.
5. Downstream salah membedakan delete event dan tombstone.

---

## 11. Topic Mapping dalam Raw CDC

Debezium default sering memetakan table ke topic.

Contoh:

```text
server.public.case_file
server.public.case_assignment
server.public.case_evidence
```

Atau pattern lain tergantung konfigurasi.

Kelebihan table-topic mapping:

1. Mudah dipahami.
2. Cocok untuk replication.
3. Cocok untuk data lake ingestion.
4. Cocok untuk search projection.
5. Dekat dengan source database schema.

Kekurangan:

1. Membocorkan struktur database internal.
2. Tidak mengandung domain intention.
3. Perubahan tabel menjadi perubahan contract Kafka.
4. Cross-table business event sulit direpresentasikan.
5. Downstream perlu memahami relational model source.
6. Consumer menjadi tightly coupled ke database schema service lain.

Contoh coupling buruk:

```text
Consumer PaymentRiskService membaca:
- monolith.public.case_file
- monolith.public.case_assignment
- monolith.public.case_sla_clock
- monolith.public.case_review_note

Lalu menyimpulkan sendiri bahwa case escalated.
```

Ini berarti business meaning tidak dipublish oleh owner domain. Downstream menebak dari tabel.

---

## 12. CDC untuk Use Case yang Berbeda

CDC bisa digunakan untuk beberapa tujuan, tetapi desainnya harus berbeda.

### 12.1 Data replication

Tujuan: memindahkan perubahan database ke storage lain.

Contoh:

```text
PostgreSQL → Kafka → S3/Data Lake
MySQL → Kafka → Elasticsearch
Oracle → Kafka → PostgreSQL reporting replica
```

Desain:

1. Topic per table masuk akal.
2. Schema mengikuti table cukup acceptable.
3. Delete/tombstone penting.
4. Snapshot penting.
5. Consumer biasanya sink/projection.
6. Domain semantics tidak selalu perlu.

### 12.2 Analytics

Tujuan: menyediakan perubahan data untuk warehouse/lakehouse.

Desain:

1. Raw CDC topic bisa disimpan apa adanya.
2. Curated topic bisa dibuat setelah enrichment.
3. Data lineage penting.
4. Schema evolution harus dijaga.
5. Reprocessing/backfill penting.
6. PII governance penting.

### 12.3 Search index/cache projection

Tujuan: membangun secondary view.

Desain:

1. Key harus cocok untuk upsert/delete.
2. Tombstone harus diproses.
3. Idempotency penting.
4. Lag harus dimonitor.
5. Projection rebuild harus diuji.

### 12.4 Microservice integration

Tujuan: memberi tahu service lain bahwa business event terjadi.

Desain:

1. Jangan expose table mentah jika bisa dihindari.
2. Gunakan outbox domain event.
3. Event harus punya semantic name.
4. Contract harus stabil.
5. Downstream tidak boleh menebak intention dari row mutation.
6. Event envelope harus kuat: event id, type, aggregate id, causation id, correlation id.

---

## 13. Dual-Write Problem

Dual-write adalah salah satu bug paling fundamental dalam distributed systems.

Contoh service:

```java
@Transactional
public void escalateCase(String caseId) {
    caseRepository.updateStatus(caseId, "ESCALATED");
    kafkaTemplate.send("case-events", new CaseEscalated(caseId));
}
```

Sekilas terlihat benar. Masalahnya: database transaction dan Kafka publish bukan satu atomic transaction yang sama, kecuali kamu membuat mekanisme transactional yang sangat hati-hati dan masih ada batas eksternal.

Failure scenario:

### Scenario A — DB commit berhasil, Kafka publish gagal

```text
1. Update DB: CASE-123 status = ESCALATED
2. DB commit success
3. Publish Kafka gagal karena broker unavailable
```

Akibat:

```text
Database: case escalated
Kafka consumers: tidak tahu
```

Downstream state inconsistent.

### Scenario B — Kafka publish berhasil, DB rollback

```text
1. Publish CaseEscalated ke Kafka
2. DB commit gagal/rollback
```

Akibat:

```text
Kafka: case escalated
Database: case tidak escalated
```

Downstream menerima event palsu.

### Scenario C — aplikasi crash di antara dua operasi

```text
1. DB commit success
2. JVM crash sebelum Kafka publish
```

Akibat sama seperti scenario A.

### 13.1 Kenapa retry saja tidak cukup

Retry membantu, tetapi tidak menyelesaikan atomicity.

Jika service tidak tahu apakah Kafka publish sudah berhasil sebelum crash, retry bisa menghasilkan duplicate. Jika event tidak punya idempotency key, downstream bisa salah.

### 13.2 Kenapa distributed transaction biasanya dihindari

Secara teori, 2PC/JTA/XA bisa mencoba membuat database dan Kafka participate dalam distributed transaction. Dalam praktik modern microservices, ini sering dihindari karena:

1. Operational complexity tinggi.
2. Coupling kuat.
3. Availability buruk saat participant bermasalah.
4. Tidak semua sistem mendukung semantics yang sama.
5. Sulit lintas cloud/managed infra.
6. Tidak cocok untuk loosely-coupled event-driven architecture.

Solusi yang umum: **transactional outbox**.

---

## 14. Transactional Outbox Pattern

Transactional outbox memindahkan masalah atomicity ke satu database transaction lokal.

Alih-alih:

```text
write business table + publish Kafka
```

Kita lakukan:

```text
write business table + insert outbox row
```

Dalam transaksi database yang sama.

```sql
BEGIN;

UPDATE case_file
SET status = 'ESCALATED'
WHERE id = 'CASE-123';

INSERT INTO outbox_event (
  id,
  aggregate_type,
  aggregate_id,
  event_type,
  payload,
  occurred_at
) VALUES (
  'EVT-999',
  'Case',
  'CASE-123',
  'CaseEscalated',
  '{...}',
  now()
);

COMMIT;
```

Karena business update dan outbox insert berada di transaksi database yang sama, maka invariant-nya:

```text
Jika case status berubah, outbox event ikut tersimpan.
Jika transaksi rollback, keduanya tidak terjadi.
```

Setelah itu CDC connector membaca row outbox dari database log dan menerbitkannya ke Kafka.

```text
Application
   ↓ local DB transaction
Business table + outbox table
   ↓ database log
Debezium CDC
   ↓
Kafka domain event topic
```

### 14.1 Invariant outbox

Invariant utama:

> Tidak ada perubahan domain penting tanpa outbox event yang committed dalam transaksi yang sama.

Ini lebih kuat daripada publish Kafka langsung dari service setelah commit.

### 14.2 Outbox bukan audit log biasa

Outbox adalah publish intent yang durable.

| Audit table | Outbox table |
|---|---|
| Untuk manusia/compliance | Untuk integrasi event stream |
| Bisa sangat detail | Harus contract-oriented |
| Bisa internal | Sering jadi API event publik |
| Tidak selalu dikonsumsi real-time | Akan dibaca relay/CDC |
| Bisa disimpan permanen | Bisa dipurge setelah aman, tergantung kebijakan |

---

## 15. Desain Outbox Table

Contoh desain dasar:

```sql
CREATE TABLE outbox_event (
    id              VARCHAR(64) PRIMARY KEY,
    aggregate_type  VARCHAR(100) NOT NULL,
    aggregate_id    VARCHAR(100) NOT NULL,
    event_type      VARCHAR(200) NOT NULL,
    event_version   INTEGER NOT NULL,
    payload         JSONB NOT NULL,
    headers         JSONB,
    occurred_at     TIMESTAMP NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT now()
);
```

Field penting:

| Field | Purpose |
|---|---|
| `id` | Unique event id untuk dedup/idempotency. |
| `aggregate_type` | Jenis aggregate/domain entity, misalnya `Case`. |
| `aggregate_id` | Business key untuk partitioning dan ordering. |
| `event_type` | Nama semantic event, misalnya `CaseEscalated`. |
| `event_version` | Versi contract event. |
| `payload` | Isi event domain. |
| `headers` | Correlation id, causation id, tenant id, trace id. |
| `occurred_at` | Waktu kejadian domain. |
| `created_at` | Waktu row outbox dibuat. |

### 15.1 Contoh event payload

```json
{
  "caseId": "CASE-123",
  "fromStatus": "REVIEW_PENDING",
  "toStatus": "ESCALATED",
  "reason": "SLA_BREACH",
  "escalationLevel": 2,
  "assignedOfficerId": "OFF-12"
}
```

### 15.2 Contoh headers

```json
{
  "correlationId": "CORR-20260619-0001",
  "causationId": "EVT-998",
  "tenantId": "REG-AUTH-01",
  "traceId": "a4f7...",
  "actorType": "SYSTEM",
  "actorId": "sla-monitor"
}
```

### 15.3 Key Kafka dari outbox

Biasanya Kafka key untuk outbox event adalah `aggregate_id`.

```text
key = CASE-123
value = CaseEscalated payload/envelope
```

Ini menjaga ordering per aggregate:

```text
CaseCreated(CASE-123)
CaseAssigned(CASE-123)
CaseEscalated(CASE-123)
CaseClosed(CASE-123)
```

Semua event dengan key `CASE-123` masuk partition yang sama, sehingga ordering per case lebih terjaga.

---

## 16. Debezium Outbox Event Router

Debezium menyediakan Outbox Event Router SMT untuk membantu mengubah row outbox menjadi Kafka event yang lebih bersih.

Tanpa router, topic CDC outbox bisa berisi row-level event:

```text
server.public.outbox_event
```

Dengan router, event bisa diarahkan ke topic domain:

```text
case.lifecycle.events
```

Record value bisa menjadi payload domain, bukan envelope row-table mentah.

Konseptual:

```text
outbox_event row
        ↓ Debezium
CDC envelope for outbox table
        ↓ Outbox Event Router SMT
Kafka topic: case.lifecycle.events
key: aggregate_id
headers: event metadata
value: payload
```

Manfaat:

1. Downstream tidak perlu tahu struktur table outbox.
2. Event topic bisa domain-oriented.
3. Routing bisa berdasarkan `aggregate_type` atau `event_type`.
4. Payload bisa lebih bersih.
5. Headers bisa diisi dari kolom outbox.
6. Mengurangi coupling ke database schema.

---

## 17. Ordering dalam CDC

Ordering adalah area paling sering disalahpahami.

### 17.1 Ordering database transaction log

Database log punya urutan internal. Tetapi saat masuk Kafka, ordering yang terlihat consumer dipengaruhi oleh:

1. Connector task parallelism.
2. Topic partitioning.
3. Kafka key.
4. Multiple topics.
5. Snapshot vs streaming event.
6. Cross-table transaction representation.
7. Downstream consumer concurrency.

### 17.2 Ordering per row/entity

Jika Kafka key adalah primary key row atau aggregate id, maka ordering per key di topic yang sama bisa dijaga.

```text
key=CASE-123 → partition 4

offset 10: CaseAssigned
offset 11: CaseEscalated
offset 12: CaseClosed
```

Ini bagus.

### 17.3 Ordering lintas key tidak dijamin

```text
CASE-123 → partition 4
CASE-456 → partition 7
```

Tidak ada global ordering antara CASE-123 dan CASE-456.

Biasanya ini tidak masalah, karena domain ordering yang penting adalah per aggregate.

### 17.4 Ordering lintas table sulit

Contoh transaksi database:

```sql
BEGIN;
UPDATE case_file SET status='ESCALATED' WHERE id='CASE-123';
INSERT INTO case_escalation_history (...);
COMMIT;
```

CDC bisa menghasilkan event ke dua topic berbeda:

```text
public.case_file
public.case_escalation_history
```

Downstream yang membaca dua topic tidak boleh sembarangan mengandalkan urutan global antar topic.

Jika downstream membutuhkan satu semantic event `CaseEscalated`, lebih baik pakai outbox.

### 17.5 Ordering snapshot vs streaming

Snapshot event bisa datang bersama live changes. Connector yang baik punya algoritma untuk menjaga consistency, tetapi downstream tetap harus paham bahwa event snapshot (`op=r`) bukan perubahan baru.

Consumer yang memicu side effect berdasarkan snapshot event bisa berbahaya.

Contoh buruk:

```text
Consumer membaca op=r untuk case lama status=ESCALATED
Lalu mengirim email escalation lagi
```

Snapshot event sebaiknya dipakai untuk build state, bukan trigger external side effect tanpa filter.

---

## 18. CDC dan Schema Evolution

CDC schema mengikuti source database. Ini bisa menjadi risiko besar.

Contoh perubahan:

```sql
ALTER TABLE case_file ADD COLUMN risk_score INTEGER;
```

Biasanya ini additive dan relatif aman.

Contoh berbahaya:

```sql
ALTER TABLE case_file DROP COLUMN status;
ALTER TABLE case_file ALTER COLUMN case_id TYPE BIGINT;
ALTER TABLE case_file RENAME COLUMN assigned_officer_id TO owner_id;
```

Risiko:

1. Schema Registry compatibility gagal.
2. Consumer tidak bisa deserialize.
3. Sink connector gagal menulis.
4. Projection menjadi corrupt.
5. Connector snapshot/streaming terganggu.

### 18.1 Database schema bukan event schema yang stabil

Jika raw CDC topic adalah public API, maka setiap migration database menjadi public contract change.

Ini sangat berbahaya.

Untuk domain integration, outbox membantu karena event payload bisa tetap stabil walaupun table internal berubah.

Contoh:

```text
Internal table berubah:
assigned_officer_id → owner_user_id

Domain event tetap:
CaseAssigned {
  caseId,
  officerId
}
```

---

## 19. CDC Exactly-Once: Hati-Hati dengan Klaim

Kafka Connect memiliki dukungan exactly-once untuk source connectors melalui mekanisme transaction support tertentu. Debezium juga memiliki dokumentasi terkait exactly-once delivery pada konfigurasi source connector.

Namun, kamu harus membedakan:

1. Exactly-once delivery dari connector ke Kafka.
2. Exactly-once processing oleh consumer.
3. Exactly-once side effect ke database/search/API downstream.
4. Exactly-once business outcome.

CDC pipeline end-to-end sering tetap membutuhkan idempotency.

### 19.1 Duplicate tetap harus diasumsikan

Consumer CDC harus robust terhadap duplicate karena:

1. Connector restart.
2. Snapshot restart.
3. Offset commit race.
4. Sink retry.
5. Downstream failure after side effect.
6. Manual replay.
7. DR/failover.

Rule:

> CDC consumer harus idempotent walaupun connector mengklaim delivery semantics kuat.

### 19.2 Idempotency strategy

Untuk raw CDC projection:

```text
Use primary key + source log position/version/timestamp
```

Untuk outbox domain event:

```text
Use event_id as dedup key
```

Contoh tabel dedup:

```sql
CREATE TABLE processed_event (
  event_id VARCHAR PRIMARY KEY,
  processed_at TIMESTAMP NOT NULL DEFAULT now()
);
```

Consumer transaction:

```sql
BEGIN;

INSERT INTO processed_event(event_id)
VALUES (:eventId)
ON CONFLICT DO NOTHING;

-- if inserted, apply side effect
-- if not inserted, skip duplicate

COMMIT;
```

---

## 20. CDC untuk Regulatory / Case Management Systems

Untuk sistem enforcement lifecycle, case management, escalation, dan regulatory defensibility, CDC perlu dipakai dengan hati-hati.

### 20.1 Use case yang cocok

CDC sangat cocok untuk:

1. Audit lake ingestion.
2. Search index untuk case/evidence.
3. Reporting projection.
4. Timeline reconstruction internal.
5. Legacy database integration.
6. Migration dari monolith ke service baru.
7. Read model untuk dashboard monitoring.
8. Data quality monitoring.

### 20.2 Use case yang perlu outbox

Gunakan outbox jika event punya business consequence:

1. `CaseEscalated`
2. `InvestigationAssigned`
3. `EvidenceSubmitted`
4. `SlaBreached`
5. `EnforcementActionRecommended`
6. `DecisionApproved`
7. `AppealReceived`
8. `CaseClosed`

Event ini sebaiknya bukan hasil downstream menebak dari perubahan kolom.

### 20.3 Regulatory defensibility

Dalam konteks regulatory, kamu perlu menjawab:

1. Apa yang terjadi?
2. Kapan terjadi?
3. Siapa/apa yang menyebabkan?
4. Dari state apa ke state apa?
5. Berdasarkan aturan apa?
6. Evidence apa yang tersedia saat keputusan dibuat?
7. Apakah event bisa direplay?
8. Apakah event bisa dijelaskan ke auditor?

Raw CDC bisa membantu membuktikan perubahan data, tetapi domain event/outbox lebih baik untuk menjelaskan business meaning.

Idealnya:

```text
Raw CDC stream → forensic/data lineage
Outbox domain stream → business workflow/audit semantic
```

---

## 21. Pattern: Raw CDC + Curated Domain Stream

Dalam enterprise yang matang, sering ada dua lapisan:

```text
Source DB
  ↓
Raw CDC topics
  ↓
Curated stream processing / outbox router / normalization
  ↓
Domain event topics / data product topics
```

### 21.1 Raw zone

Raw CDC topic:

```text
raw.monolith.public.case_file
raw.monolith.public.case_assignment
raw.monolith.public.case_evidence
```

Karakter:

1. Dekat ke source.
2. Retain untuk replay/lineage.
3. Access terbatas.
4. Tidak ideal untuk banyak application consumers.
5. Berguna untuk analytics/search/migration.

### 21.2 Curated zone

Curated topic:

```text
case.lifecycle.events
case.assignment.events
case.evidence.events
case.search.documents
```

Karakter:

1. Contract lebih stabil.
2. Domain-oriented.
3. Access lebih luas.
4. Schema governed.
5. Cocok untuk application integration.

---

## 22. CDC Pipeline Architecture Example

Contoh untuk case management platform:

```text
+------------------------------+
| Case Service                 |
|                              |
| DB transaction:              |
| - update case_file           |
| - insert outbox_event        |
+---------------+--------------+
                |
                v
+------------------------------+
| PostgreSQL WAL               |
+---------------+--------------+
                |
                v
+------------------------------+
| Kafka Connect + Debezium     |
| - raw CDC connector          |
| - outbox connector/router    |
+---------------+--------------+
                |
        +-------+--------+
        |                |
        v                v
+---------------+  +----------------------+
| raw CDC topic |  | case.lifecycle.events|
+---------------+  +----------------------+
        |                |
        v                v
+---------------+  +----------------------+
| data lake     |  | workflow consumers    |
| search index  |  | notification service  |
| audit archive |  | SLA monitor           |
+---------------+  +----------------------+
```

Key point:

1. Raw CDC dan domain events punya audience berbeda.
2. Outbox membuat business event atomic dengan state change.
3. CDC connector menjadi relay durable.
4. Consumers tetap idempotent.
5. Schema governance tetap wajib.

---

## 23. Java Engineer Perspective

### 23.1 Menulis outbox dalam transaksi yang sama

Pseudo-code Spring style:

```java
@Service
public class CaseEscalationService {

    private final CaseRepository caseRepository;
    private final OutboxEventRepository outboxRepository;
    private final Clock clock;

    @Transactional
    public void escalateCase(EscalateCaseCommand command) {
        CaseFile caseFile = caseRepository.findByIdForUpdate(command.caseId())
                .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

        CaseStatus oldStatus = caseFile.status();
        caseFile.escalate(command.reason(), command.actorId());

        caseRepository.save(caseFile);

        OutboxEvent event = OutboxEvent.builder()
                .id(UUID.randomUUID().toString())
                .aggregateType("Case")
                .aggregateId(caseFile.id())
                .eventType("CaseEscalated")
                .eventVersion(1)
                .payload(Map.of(
                        "caseId", caseFile.id(),
                        "fromStatus", oldStatus.name(),
                        "toStatus", caseFile.status().name(),
                        "reason", command.reason().name(),
                        "actorId", command.actorId()
                ))
                .headers(Map.of(
                        "correlationId", command.correlationId(),
                        "causationId", command.causationId(),
                        "tenantId", command.tenantId()
                ))
                .occurredAt(Instant.now(clock))
                .build();

        outboxRepository.save(event);
    }
}
```

Important invariant:

```text
caseRepository.save(caseFile)
outboxRepository.save(event)
```

harus berada dalam transaksi yang sama.

### 23.2 Jangan publish Kafka langsung di dalam transaksi DB

Anti-pattern:

```java
@Transactional
public void escalateCase(...) {
    caseRepository.save(caseFile);
    kafkaTemplate.send("case.lifecycle.events", event);
}
```

Masalah:

1. Kafka send bisa terjadi sebelum DB commit final.
2. DB rollback tidak otomatis membatalkan event yang sudah terlihat consumer.
3. Kafka failure bisa membuat DB state berubah tanpa event.
4. Callback async bisa membuat reasoning semakin sulit.

### 23.3 Domain method sebaiknya menghasilkan event intention

Model yang lebih bersih:

```java
public final class CaseFile {
    public CaseEscalated escalate(EscalationReason reason, Actor actor) {
        CaseStatus previous = this.status;
        this.status = CaseStatus.ESCALATED;
        this.escalatedAt = Instant.now();

        return new CaseEscalated(
                this.id,
                previous,
                this.status,
                reason,
                actor.id()
        );
    }
}
```

Application service lalu menyimpan state + outbox event.

---

## 24. CDC Consumer Design

CDC consumers harus dirancang berbeda tergantung event type.

### 24.1 Raw CDC consumer untuk projection

```java
for (ConsumerRecord<CaseKey, DebeziumEnvelope<CaseRow>> record : records) {
    CaseKey key = record.key();
    DebeziumEnvelope<CaseRow> envelope = record.value();

    if (envelope == null) {
        projection.delete(key.id());
        continue;
    }

    switch (envelope.operation()) {
        case SNAPSHOT_READ:
        case CREATE:
        case UPDATE:
            projection.upsert(key.id(), envelope.after());
            break;
        case DELETE:
            projection.delete(key.id());
            break;
    }
}
```

Projection consumer biasanya:

1. Upsert berdasarkan primary key.
2. Delete saat tombstone/delete.
3. Tidak memicu irreversible external side effect dari snapshot.
4. Idempotent terhadap duplicate.

### 24.2 Outbox domain event consumer

```java
for (ConsumerRecord<String, CaseLifecycleEvent> record : records) {
    CaseLifecycleEvent event = record.value();

    if (processedEventRepository.alreadyProcessed(event.eventId())) {
        continue;
    }

    switch (event.type()) {
        case "CaseEscalated" -> notificationService.notifyEscalation(event);
        case "CaseAssigned" -> workloadService.updateAssignment(event);
        default -> eventLogger.ignoreUnknown(event);
    }

    processedEventRepository.markProcessed(event.eventId());
}
```

Domain event consumer biasanya:

1. Dedup dengan event id.
2. Memproses semantic event.
3. Memiliki error handling dan DLQ.
4. Tidak bergantung pada table schema source.
5. Bisa melakukan side effect dengan idempotency.

---

## 25. Failure Modes CDC

### 25.1 Connector down terlalu lama

Jika connector mati dan database log retention tidak cukup panjang:

```text
Connector offset terakhir: LSN 100
Database hanya menyimpan WAL mulai LSN 500
Connector restart butuh LSN 100
```

Akibat:

```text
CDC gap. Connector tidak bisa melanjutkan tanpa snapshot ulang/recovery.
```

Mitigasi:

1. Monitor connector lag terhadap database log.
2. Set WAL/binlog retention cukup.
3. Alert jika replication slot/log retention mendekati limit.
4. Runbook snapshot ulang.
5. Capacity planning untuk outage window.

### 25.2 Snapshot terlalu berat

Snapshot table besar bisa memberi beban ke source database.

Mitigasi:

1. Incremental snapshot jika tersedia.
2. Snapshot saat traffic rendah.
3. Batasi table yang disnapshot.
4. Tune fetch size.
5. Gunakan replica jika aman dan didukung.
6. Monitor locks, I/O, replication lag.

### 25.3 Schema change mematahkan connector/consumer

Mitigasi:

1. Migration governance.
2. Compatibility check.
3. Pre-production CDC test.
4. Avoid destructive changes langsung.
5. Expand-contract migration.
6. Schema Registry policy.

### 25.4 Duplicate events

Mitigasi:

1. Idempotent sink.
2. Event id.
3. Source position tracking.
4. Upsert semantics.
5. Dedup table.

### 25.5 Outbox table tumbuh tanpa batas

Outbox row bisa tumbuh besar.

Mitigasi:

1. Retention/purge policy setelah event aman dipublish.
2. Partition outbox table by time.
3. Archive jika compliance perlu.
4. Jangan hapus sebelum CDC membaca.
5. Monitor row count dan table bloat.

### 25.6 Downstream salah memproses snapshot event

Mitigasi:

1. Gunakan `op` field.
2. Jangan trigger notification dari snapshot raw CDC.
3. Gunakan outbox untuk event side-effect.
4. Pisahkan projection consumer dan workflow consumer.

### 25.7 Poison event

Poison event bisa terjadi karena:

1. Bad schema.
2. Unexpected null.
3. Payload terlalu besar.
4. Invalid enum.
5. Consumer bug.

Mitigasi:

1. DLQ.
2. Schema validation.
3. Consumer defensive coding.
4. Replay tools.
5. Quarantine topic.

---

## 26. Design Trade-Offs

### 26.1 Raw CDC vs Outbox

| Aspek | Raw CDC | Outbox |
|---|---|---|
| Setup awal | Relatif mudah | Butuh perubahan aplikasi/schema |
| Semantic quality | Rendah-menengah | Tinggi |
| Coupling | Coupled ke table | Coupled ke event contract |
| Cocok untuk analytics | Sangat cocok | Bisa, tapi bukan tujuan utama |
| Cocok untuk domain integration | Risiko tinggi | Sangat cocok |
| Schema stability | Mengikuti DB | Bisa distabilkan |
| Cross-table business event | Sulit | Natural |
| Dual-write avoidance | Ya untuk capture DB changes | Ya untuk publish event semantic |

### 26.2 CDC vs Application Producer

| Aspek | CDC | Application Producer |
|---|---|---|
| Tidak perlu ubah legacy app | Kuat | Tidak |
| Domain semantics | Lemah kecuali outbox | Kuat jika didesain baik |
| Atomic dengan DB | Kuat jika log-based/outbox | Lemah tanpa outbox/transaction |
| Latency | Near-real-time | Bisa sangat cepat |
| Operational complexity | Connector/database log | Producer code/config |
| Backfill | Bisa snapshot | Harus custom |

### 26.3 Topic per table vs topic per domain event

| Aspek | Topic per table | Topic per domain event/family |
|---|---|---|
| Replikasi | Bagus | Kurang langsung |
| Domain clarity | Lemah | Kuat |
| Consumer simplicity | Kadang rumit | Lebih jelas |
| Schema coupling | Tinggi | Lebih rendah |
| Data lake raw | Cocok | Kurang raw |
| Workflow | Berbahaya | Cocok |

---

## 27. Anti-Patterns

### 27.1 Menganggap CDC row update sebagai domain event

Buruk:

```text
case_file row status changed → downstream menyimpulkan CaseEscalated
```

Lebih baik:

```text
CaseEscalated event diterbitkan via outbox
```

### 27.2 Semua table di-CDC-kan tanpa governance

Akibat:

1. Topic explosion.
2. Sensitive data bocor.
3. Consumer coupling liar.
4. Kafka dipakai sebagai database mirror tanpa ownership.
5. Biaya storage meningkat.

### 27.3 CDC topic raw diberi akses bebas

Raw CDC sering berisi PII, internal field, deleted data, operational metadata.

Perlu:

1. ACL ketat.
2. Data classification.
3. Masking/filtering.
4. Curated topics untuk konsumsi luas.

### 27.4 Tidak memonitor database log retention

CDC connector bisa gagal total jika log yang dibutuhkan sudah hilang.

### 27.5 Consumer tidak menangani tombstone

Ini akan menyebabkan crash atau projection tidak pernah menghapus data.

### 27.6 Outbox event tanpa stable event id

Tanpa event id, dedup downstream sulit.

### 27.7 Outbox payload hanya copy seluruh row database

Jika outbox hanya meng-copy row, kamu belum benar-benar membuat domain event. Kamu hanya membungkus CDC mentah.

### 27.8 Menghapus outbox row terlalu cepat

Jika outbox row dihapus sebelum connector membaca transaction log dengan aman, bisa terjadi kehilangan event atau race tergantung mekanisme.

### 27.9 Mengandalkan global ordering CDC

Kafka tidak memberi global ordering lintas partition/topic. Desainlah ordering domain secara eksplisit.

---

## 28. Checklist Production Readiness CDC

### 28.1 Database readiness

- [ ] Database log mode sudah mendukung CDC/logical replication.
- [ ] User connector punya permission minimum yang diperlukan.
- [ ] Log retention cukup untuk outage window.
- [ ] Replication slot/binlog retention dimonitor.
- [ ] Primary key tersedia untuk tabel yang dicapture.
- [ ] Tabel high-churn dievaluasi kapasitasnya.
- [ ] Schema migration process mempertimbangkan CDC.

### 28.2 Kafka Connect readiness

- [ ] Connect cluster distributed mode production-ready.
- [ ] Internal topics replicated dan compacted sesuai kebutuhan.
- [ ] Connector config version-controlled.
- [ ] Restart/pause/resume runbook tersedia.
- [ ] DLQ dikonfigurasi jika sesuai.
- [ ] Converter/Schema Registry dikonfigurasi konsisten.
- [ ] Metrics connector task lag dipantau.

### 28.3 Topic readiness

- [ ] Topic naming jelas: raw vs curated vs outbox/domain.
- [ ] Partitioning strategy jelas.
- [ ] Retention policy jelas.
- [ ] Compaction/tombstone policy jelas.
- [ ] ACL sesuai data classification.
- [ ] Ownership metadata ada.

### 28.4 Consumer readiness

- [ ] Consumer idempotent.
- [ ] Tombstone ditangani.
- [ ] Snapshot event tidak memicu side effect berbahaya.
- [ ] DLQ/retry policy jelas.
- [ ] Reprocessing strategy diuji.
- [ ] Dedup key jelas.
- [ ] Lag alert tersedia.

### 28.5 Outbox readiness

- [ ] Business update dan outbox insert satu transaksi.
- [ ] Event id unique dan stable.
- [ ] Aggregate id digunakan sebagai Kafka key.
- [ ] Event type semantic.
- [ ] Event version disediakan.
- [ ] Correlation/causation id tersedia.
- [ ] Purge/archive policy aman.
- [ ] Outbox router config diuji.

---

## 29. Thought Exercises

### Exercise 1 — Raw CDC atau Outbox?

Untuk setiap kebutuhan berikut, pilih raw CDC, outbox, atau keduanya:

1. Mengisi Elasticsearch index untuk pencarian case.
2. Mengirim notifikasi saat case dieskalasi.
3. Mengisi data lake untuk analytics.
4. Mengaktifkan workflow investigasi saat evidence baru disubmit.
5. Migrasi modul reporting dari monolith lama.
6. Membuat audit reconstruction untuk regulator.

Jawaban yang diharapkan:

```text
1. Raw CDC atau curated projection.
2. Outbox domain event.
3. Raw CDC.
4. Outbox domain event.
5. Raw CDC, mungkin curated topic.
6. Keduanya: raw CDC untuk forensic, outbox untuk semantic timeline.
```

### Exercise 2 — Identify ordering domain

Event:

```text
CaseCreated
CaseAssigned
CaseEscalated
CaseClosed
```

Apa Kafka key yang paling masuk akal?

Jawaban:

```text
caseId / aggregateId
```

Karena ordering yang penting adalah per case, bukan global seluruh case.

### Exercise 3 — Snapshot side effect

Raw CDC consumer menerima event snapshot untuk 1 juta case yang statusnya `ESCALATED`. Apakah consumer boleh mengirim notifikasi escalation?

Jawaban:

```text
Tidak. Snapshot merepresentasikan baseline state, bukan kejadian baru. Gunakan domain event/outbox untuk trigger side effect.
```

### Exercise 4 — Dual-write failure

Service update database lalu publish Kafka. DB commit sukses, Kafka publish gagal. Apa invariant yang rusak?

Jawaban:

```text
State domain berubah tanpa event integrasi. Downstream tidak tahu perubahan yang sudah committed.
```

Solusi:

```text
Transactional outbox + CDC relay.
```

---

## 30. Ringkasan

CDC adalah salah satu cara paling powerful untuk menghubungkan database transaksional dengan Kafka, tetapi harus dipahami sebagai mekanisme membaca perubahan dari log database, bukan sebagai solusi universal untuk event-driven architecture.

Inti yang harus diingat:

1. CDC log-based lebih kuat daripada polling karena membaca perubahan dari transaction log.
2. Debezium adalah source connector yang membaca database changes dan menghasilkan Kafka records.
3. CDC biasanya memiliki snapshot phase dan streaming phase.
4. Snapshot event bukan business event baru.
5. Raw CDC event biasanya merepresentasikan row/table mutation, bukan domain event.
6. Kafka key untuk CDC umumnya berasal dari primary key atau aggregate id.
7. Delete event berbeda dari tombstone.
8. Tombstone penting untuk compacted topics dan projection delete.
9. Ordering harus dipikirkan per key/topic/partition, bukan diasumsikan global.
10. Dual-write problem terjadi saat aplikasi mencoba menulis database dan publish Kafka secara terpisah.
11. Transactional outbox menyelesaikan atomicity lokal dengan menyimpan event intent di database transaction yang sama.
12. Outbox Event Router dapat mengubah row outbox menjadi domain event Kafka yang lebih bersih.
13. CDC consumer tetap harus idempotent.
14. CDC untuk regulatory/case management idealnya memisahkan raw forensic stream dan curated/domain semantic stream.
15. Production CDC membutuhkan governance: schema, topic, ACL, retention, monitoring, replay, dan runbook.

---

## 31. Koneksi ke Part Berikutnya

Part ini menjelaskan bagaimana Kafka bisa diisi dari database transaction log dan bagaimana Kafka Connect/Debezium menjadi bridge dari database ke event stream.

Part berikutnya akan masuk ke:

```text
Part 017 — ksqlDB Fundamentals: Streams, Tables, Persistent Queries, Push/Pull Queries
```

Koneksi konsep:

```text
CDC topic dari database
        ↓
Kafka stream/table abstraction
        ↓
ksqlDB stream/table query
        ↓
projection, filtering, enrichment, aggregation
```

Dengan kata lain, setelah data perubahan masuk ke Kafka, kita perlu memahami cara memprosesnya sebagai stream/table. Itulah peran ksqlDB dan Kafka Streams pada bagian berikutnya.

---

## 32. Status Seri

```text
Progress: Part 000–016 selesai
Total target: Part 000–034
Status: Belum selesai
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-015.md">⬅️ Part 015 — Kafka Connect in Production: Scaling, Failure, DLQ, Offset, and Operational Control</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-017.md">Part 017 — ksqlDB Fundamentals: Streams, Tables, Persistent Queries, Push/Pull Queries ➡️</a>
</div>

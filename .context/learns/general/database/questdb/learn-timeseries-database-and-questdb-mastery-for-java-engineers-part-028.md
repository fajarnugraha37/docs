# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-028.md

# Part 028 — Backfill, Replay, and Historical Data Loading

## 1. Tujuan Part

Bagian ini membahas salah satu pekerjaan paling berisiko dalam platform time-series: **memasukkan data lama, memutar ulang data, atau melakukan historical load besar** tanpa merusak live ingestion, query freshness, dedup correctness, retention policy, dan operabilitas QuestDB.

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **backfill**, **replay**, **historical import**, **correction load**, dan **migration load**.
2. Mendesain jalur loading data lama yang aman terhadap out-of-order write amplification.
3. Memilih antara ILP, CSV/COPY, SQL insert, dan pipeline replay.
4. Menentukan kapan data harus disortir sebelum masuk QuestDB.
5. Menggunakan deduplication/idempotency agar replay bisa diulang tanpa menggandakan data.
6. Membatasi dampak backfill terhadap live ingestion dan query latency.
7. Melakukan validation dan reconciliation setelah load.
8. Mendesain cutover dari sistem lama ke QuestDB.
9. Membuat runbook backfill produksi yang bisa dieksekusi ulang dengan aman.

Backfill bukan sekadar “insert data lama”. Backfill adalah operasi produksi yang menyentuh storage engine, WAL, partitioning, dedup, query correctness, freshness SLO, kapasitas disk, dan trust terhadap data.

---

## 2. Problem yang Sedang Diselesaikan

Dalam sistem time-series, data historis biasanya masuk dari beberapa skenario:

- service sempat down lalu buffer lokal harus dikirim ulang;
- Kafka consumer tertinggal dan harus mengejar backlog;
- data lama dari PostgreSQL/CSV/object storage dimigrasikan ke QuestDB;
- producer bug mengirim value/unit salah dan perlu correction;
- sensor offline beberapa jam lalu mengirim data lama saat online;
- exchange/market data feed mengirim late correction;
- observability agent kehilangan koneksi lalu melakukan replay;
- customer baru onboarding membawa arsip 2 tahun;
- table schema baru dibuat dan perlu diisi ulang dari raw event log.

Kesalahan umum adalah memperlakukan semua skenario itu sama:

```text
for every old row:
    insert into QuestDB
```

Secara fungsional mungkin terlihat benar. Secara produksi, ini bisa menyebabkan:

- WAL lag besar;
- table freshness turun;
- query dashboard menjadi stale;
- disk tumbuh cepat;
- O3 merge berat;
- partition split/squash berlebihan;
- duplicate row;
- correction tertimpa dengan urutan salah;
- ingestion live kalah resource;
- materialized view refresh tertinggal;
- alert palsu karena data historis dianggap data baru;
- restore/backfill tidak bisa diverifikasi.

Backfill yang baik harus menjawab pertanyaan berikut:

```text
Data lama ini masuk untuk tujuan apa?
Apakah harus queryable segera?
Apakah boleh mengganggu live ingestion?
Apakah data bisa sorted by time?
Apakah duplicate aman?
Apakah correction harus overwrite atau append revision?
Apa checkpoint-nya?
Bagaimana validasi setelah selesai?
Bagaimana rollback jika salah?
```

---

## 3. Mental Model Utama

### 3.1 Backfill adalah Controlled Historical Write

Backfill bukan live ingestion normal. Backfill adalah write besar yang timestamp-nya sering berada jauh di masa lalu.

Dalam QuestDB, timestamp menentukan table ordering, partition placement, dan time-series query semantics. Karena itu historical write bisa menyentuh banyak partition lama dan menimbulkan kerja storage yang berbeda dari append terbaru.

Mental model:

```text
live ingestion:
    mostly append near now
    touches hot partition
    freshness-sensitive

backfill:
    often historical
    may touch many partitions
    may be out-of-order relative to table head
    correctness-sensitive
```

Jika live ingestion dioptimalkan untuk **freshness**, backfill dioptimalkan untuk **correctness + repeatability + controlled resource usage**.

---

### 3.2 Replay Harus Idempotent

Replay berarti sistem mengirim ulang data yang mungkin sebagian sudah pernah berhasil ditulis.

Replay aman hanya jika:

```text
same logical observation + same key + same timestamp
=> same final database state
```

Tanpa idempotency, replay akan memperbanyak row. Di time-series, duplicate sering tidak langsung terlihat, tetapi akan merusak aggregate, alert, billing, rate calculation, OHLC, dan compliance report.

---

### 3.3 Sort Order adalah Performance Lever

Data time-series paling murah ditulis saat masuk mendekati urutan timestamp.

Jika data lama dikirim acak:

```text
2024-01-10
2024-01-01
2024-01-09
2023-12-20
2024-01-02
```

QuestDB harus lebih banyak melakukan merge/reorder terhadap partition lama.

Jika data dikirim sorted by designated timestamp:

```text
2023-12-20
2024-01-01
2024-01-02
2024-01-09
2024-01-10
```

Write path jauh lebih predictable.

Untuk backfill besar, sorting bukan detail kecil. Sorting adalah bagian dari architecture.

---

### 3.4 Backfill Membutuhkan Lane Terpisah

Jangan mencampur semua traffic ke satu jalur tanpa kontrol.

Model yang lebih aman:

```text
live lane:
    recent data
    high priority
    freshness SLO

late lane:
    bounded late arrival
    controlled rate
    may be idempotent

bulk backfill lane:
    historical data
    rate limited
    checkpointed
    validation-heavy
```

Live lane harus tetap sehat bahkan saat backfill berjalan.

---

## 4. Istilah Penting

### 4.1 Backfill

Memasukkan data historis yang belum ada di target table.

Contoh:

```text
Load telemetry January–March 2025 from object storage into QuestDB.
```

### 4.2 Replay

Mengirim ulang data dari source of truth atau broker karena hasil write sebelumnya tidak pasti atau table baru perlu dibangun ulang.

Contoh:

```text
Replay Kafka topic sensor.raw from offset 0 into QuestDB table sensor_readings.
```

### 4.3 Catch-up

Consumer tertinggal dari live stream lalu harus mengejar backlog.

Contoh:

```text
QuestDB sink is 8 hours behind Kafka head.
```

### 4.4 Historical Import

Memuat data lama dari format file atau database lama, biasanya dalam jumlah besar.

Contoh:

```text
Import 3 TB CSV market ticks from S3 export.
```

### 4.5 Correction Load

Memasukkan revisi terhadap data yang sudah ada.

Contoh:

```text
Correct temperature values where unit was Fahrenheit but interpreted as Celsius.
```

### 4.6 Migration Load

Membangun QuestDB sebagai target baru dari database lama.

Contoh:

```text
Move trading analytics store from custom files to QuestDB.
```

---

## 5. QuestDB-Specific Mechanics

### 5.1 Designated Timestamp adalah Anchor

Backfill harus selalu menghormati designated timestamp.

Jangan memakai ingestion time untuk data historis jika query semantics membutuhkan event time.

Bad:

```text
sensor_readings,device_id=d-1 temperature=21.5 2026-now
```

untuk measurement yang sebenarnya terjadi tahun 2024.

Good:

```text
sensor_readings,device_id=d-1 temperature=21.5 2024-event-time
```

Jika data historis ditulis memakai server/ingestion timestamp, maka:

- partition salah;
- range query historis salah;
- dedup tidak bisa bekerja sesuai event identity;
- materialized view historis tidak benar;
- retention salah;
- audit trail misleading.

---

### 5.2 WAL Membuat Write Durable Tetapi Apply Tetap Perlu Dikejar

Pada WAL table, data yang berhasil commit ke WAL belum tentu langsung fully visible atau optimized di table storage.

Pipeline:

```text
client
-> WAL commit
-> WAL apply
-> table storage
-> query visibility/freshness
```

Backfill besar dapat membuat:

- WAL segment tumbuh;
- apply lag meningkat;
- disk pressure meningkat;
- materialized view refresh tertinggal;
- query terhadap range yang baru di-backfill belum lengkap sampai apply mengejar.

Karena itu, backfill harus dimonitor bukan hanya dari sisi “client berhasil insert”, tetapi juga:

```text
WAL lag
pending rows
apply progress
table suspension
query reconciliation
```

---

### 5.3 Out-of-Order Historical Writes Bisa Mahal

Jika table sudah memiliki data sampai hari ini, lalu kamu memasukkan data 6 bulan lalu, write itu adalah out-of-order relatif terhadap table head.

Ini bukan berarti tidak boleh. QuestDB memang mendukung O3 ingestion. Tetapi desain backfill harus mengontrol biaya.

Cost driver:

```text
O3 cost = distance from table head
         + partition size
         + number of partitions touched
         + row width
         + dedup key complexity
         + write concurrency
         + materialized view refresh impact
```

Backfill yang baik mencoba mengurangi cost dengan:

- sorting by timestamp;
- batching per partition/time window;
- membatasi concurrency;
- menjalankan pada off-peak;
- memisahkan live lane dan bulk lane;
- menggunakan table staging bila perlu;
- melakukan validation setelah apply selesai.

---

### 5.4 Partition-Aware Loading

Jika table `PARTITION BY DAY`, backfill sebaiknya berpikir dalam unit hari atau range yang selaras dengan hari.

Contoh planning:

```text
2025-01-01 -> batch A
2025-01-02 -> batch B
2025-01-03 -> batch C
```

Untuk `PARTITION BY MONTH`:

```text
2025-01 -> batch A
2025-02 -> batch B
2025-03 -> batch C
```

Manfaat:

- lebih mudah checkpoint;
- lebih mudah validate row count;
- lebih mudah retry;
- lebih mudah isolate bad file;
- lebih predictable terhadap partition rewrite;
- lebih mudah pause/resume.

---

### 5.5 Deduplication Harus Dirancang Sebelum Replay

Jika replay mungkin terjadi, table harus memiliki idempotency model.

Contoh untuk sensor reading:

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    tenant_id SYMBOL,
    device_id SYMBOL,
    sensor_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    quality SYMBOL,
    source_seq LONG
) TIMESTAMP(ts)
PARTITION BY DAY
WAL
DEDUP UPSERT KEYS(ts, tenant_id, device_id, sensor_id, metric);
```

Key harus merepresentasikan logical observation.

Jika key terlalu sempit:

```text
(ts, device_id)
```

beberapa sensor berbeda pada device yang sama bisa saling overwrite.

Jika key terlalu lebar:

```text
(ts, device_id, metric, value, source_seq, ingestion_batch_id)
```

duplicate tidak akan dianggap duplicate karena retry mengubah metadata.

---

## 6. Memilih Jalur Loading

### 6.1 ILP untuk Streaming Backfill dan Replay

ILP cocok jika:

- data diproduksi oleh service Java;
- source berasal dari Kafka/RabbitMQ/object reader;
- perlu continuous replay;
- perlu throttling aplikasi;
- ingin memakai same ingestion gateway seperti live data;
- perlu validation/enrichment sebelum write.

Pattern:

```text
source reader
-> transformer/validator
-> partition-aware sorter/batcher
-> ILP sender
-> QuestDB
```

Keunggulan:

- mudah rate limit;
- mudah DLQ;
- mudah checkpoint;
- mudah integrasi Java;
- cocok untuk replay idempotent.

Risiko:

- butuh aplikasi loader;
- HTTP/TCP client error semantics harus ditangani;
- jika data tidak disortir, O3 cost bisa tinggi;
- invalid line bisa menghentikan batch jika tidak diisolasi.

---

### 6.2 CSV/COPY untuk Bulk File Import

CSV/COPY cocok jika:

- data sudah dalam file;
- load dilakukan secara batch;
- transformasi minimal;
- environment bisa meletakkan file di import root QuestDB;
- operasi dilakukan oleh platform/operator.

Pattern:

```text
extract old data
-> normalize CSV
-> validate schema/types
-> sort by timestamp
-> place in import root
-> COPY into QuestDB
-> validate
```

Keunggulan:

- sederhana untuk bulk import;
- cocok untuk migration/load offline;
- tidak perlu membangun streaming loader penuh.

Risiko:

- file harus tersedia di lokasi yang dapat dibaca QuestDB;
- error handling harus dirancang;
- kurang cocok untuk continuous replay;
- transformasi kompleks lebih baik dilakukan sebelum file masuk.

---

### 6.3 PGWire/JDBC Insert untuk Volume Rendah atau Admin Load

PGWire/JDBC cocok jika:

- volume kecil;
- operasi administratif;
- ad-hoc correction terbatas;
- controlled script.

Tidak ideal untuk:

- ratusan ribu row/sec;
- replay besar;
- historical load multi-TB;
- high-frequency telemetry.

---

### 6.4 Staging Table Pattern

Gunakan staging table jika data perlu dibersihkan sebelum masuk table final.

Pattern:

```text
raw imported table
-> validation query
-> transform/dedup
-> insert into final table
-> reconciliation
-> drop/archive staging
```

Staging berguna untuk:

- migration dari sumber kotor;
- correction massal;
- data dengan schema berubah;
- file dari customer;
- data yang perlu unit normalization.

Namun staging juga menambah:

- storage sementara;
- waktu load;
- query/transform cost;
- operational complexity.

Gunakan jika correctness lebih penting daripada speed.

---

## 7. Backfill Planning Framework

Sebelum menulis satu row, buat dokumen rencana.

### 7.1 Define Scope

```text
source:
  Kafka topic sensor.raw

time range:
  2025-01-01T00:00:00Z to 2025-03-31T23:59:59Z

target:
  sensor_readings

mode:
  replay idempotent

expected rows:
  12.4 billion

expected compressed/source size:
  1.8 TB

expected target size:
  2.4 TB native + WAL headroom
```

### 7.2 Define Correctness Contract

```text
One logical sensor reading is unique by:
  ts, tenant_id, device_id, sensor_id, metric

If duplicate same full row:
  skip/no-op

If duplicate key with different value:
  correction wins only if correction_version higher
```

Jika QuestDB dedup final state tidak cukup untuk correction semantics yang kompleks, simpan correction sebagai revision stream atau staging dahulu.

### 7.3 Define Resource Budget

```text
max backfill rate:
  100k rows/sec

max allowed WAL lag:
  10 minutes

max disk utilization during load:
  75%

max live ingestion latency impact:
  p95 < 2s

allowed window:
  22:00-05:00 local time
```

### 7.4 Define Checkpoints

Contoh checkpoint by partition/day:

```text
checkpoint_key = table + date + source_file + source_offset_range
```

Checkpoint harus mencatat:

- source range;
- row count read;
- row count valid;
- row count rejected;
- row count sent;
- time range min/max;
- hash/checksum opsional;
- status: pending/running/sent/applied/validated/failed.

### 7.5 Define Rollback Strategy

Rollback di time-series jarang semudah transaction rollback.

Alternatif:

1. Drop affected partitions jika backfill hanya menyentuh range tertentu dan aman.
2. Rebuild target table from source of truth.
3. Load correction rows dengan dedup/upsert semantics.
4. Switch view/API ke previous table version.
5. Restore snapshot.

Untuk backfill besar, pertimbangkan table versioning:

```text
sensor_readings_v1
sensor_readings_v2_backfill
view/current alias at API layer
```

QuestDB mungkin tidak memiliki abstraction alias/view yang sama seperti RDBMS penuh untuk semua kebutuhan aplikasi, jadi API/service layer sering menjadi tempat cutover.

---

## 8. Sorting Strategy

### 8.1 Sort by Designated Timestamp First

Minimum sorting:

```text
ORDER BY ts ASC
```

Untuk dedup key tambahan:

```text
ORDER BY ts ASC, tenant_id, device_id, sensor_id, metric
```

Sorting membantu:

- mengurangi O3 randomness;
- membuat batch lebih partition-local;
- mempercepat validation;
- membuat checkpoint lebih natural;
- mempermudah reconciliation.

### 8.2 External Sort untuk Dataset Besar

Jika data tidak muat memory:

```text
read chunks
-> sort chunk by ts/key
-> write sorted run
-> merge sorted runs
-> stream to QuestDB
```

Untuk Java loader, jangan memaksa semua data ke heap.

Gunakan model:

```text
bounded memory
+ temp files
+ streaming parser
+ backpressure
```

### 8.3 Partition-Bucketed Sort

Alternatif lebih praktis:

```text
bucket by partition
-> sort within bucket
-> load bucket sequentially
```

Contoh:

```text
source file contains 90 days
-> split into day files
-> sort each day
-> load day by day
```

Ini sering lebih mudah daripada global sort multi-TB.

---

## 9. Java Backfill Loader Design

### 9.1 Component Model

```text
BackfillJobRunner
  -> SourceReader
  -> Decoder
  -> Validator
  -> Normalizer
  -> PartitionBucketer
  -> Sorter
  -> Sender
  -> CheckpointStore
  -> ReconciliationService
  -> DlqWriter
```

### 9.2 SourceReader

Tanggung jawab:

- membaca CSV/Parquet/Kafka/object storage/database lama;
- emit record streaming;
- tidak melakukan transformasi domain terlalu banyak;
- mendukung resume dari checkpoint.

Interface konseptual:

```java
interface SourceReader<T> extends AutoCloseable {
    boolean hasNext();
    SourceRecord<T> next();
    SourcePosition position();
}
```

### 9.3 Validator

Validasi wajib:

```text
ts not null
ts within job range
tenant/device/metric valid
numeric value parseable
unit recognized
cardinality within allowed domain
source record has deterministic key
```

Invalid record jangan langsung dibuang diam-diam.

Tulis ke DLQ:

```json
{
  "jobId": "bf-2026-06-sensor-jan2025",
  "source": "s3://.../file-001.csv",
  "line": 92831,
  "reason": "UNKNOWN_METRIC",
  "raw": "..."
}
```

### 9.4 PartitionBucketer

Tentukan target partition dari timestamp.

```java
LocalDate bucket = Instant.ofEpochMilli(tsMillis)
    .atZone(ZoneOffset.UTC)
    .toLocalDate();
```

Jangan pakai timezone lokal sembarangan untuk boundary fisik kecuali table memang didesain berdasarkan itu. Untuk time-series global, UTC biasanya default safest.

### 9.5 Sender

Sender harus:

- bounded;
- rate-limited;
- observable;
- idempotent;
- flushable;
- retry-aware;
- shutdown-safe.

Pseudo-flow:

```java
for (PartitionBatch batch : batches) {
    checkpoint.markRunning(batch.id());

    try {
        sender.send(batch.rows());
        sender.flush();
        checkpoint.markSent(batch.id(), batch.rowCount());
    } catch (Exception e) {
        checkpoint.markFailed(batch.id(), e);
        throw e;
    }

    waitUntilWalLagBelowThreshold();
    validateBatchEventually(batch);
}
```

### 9.6 CheckpointStore

Checkpoint bisa disimpan di PostgreSQL, file durable, atau internal control table terpisah. Jangan hanya memory.

Minimal fields:

```sql
job_id
batch_id
source_uri
source_start_offset
source_end_offset
min_ts
max_ts
expected_rows
valid_rows
invalid_rows
sent_rows
validated_rows
status
attempt_count
last_error
created_at
updated_at
```

### 9.7 Rate Limiter

Rate limit harus adaptif terhadap QuestDB health:

```text
if wal_lag high:
    reduce send rate

if disk utilization high:
    pause

if table suspended:
    stop job

if live freshness degraded:
    pause bulk backfill
```

Ini lebih baik daripada fixed throughput yang mengabaikan sistem target.

---

## 10. Idempotency Patterns for Backfill

### 10.1 Natural Observation Key

Contoh telemetry:

```text
ts + tenant_id + device_id + sensor_id + metric
```

Contoh trade tick:

```text
exchange + symbol + trade_id
```

Jika `trade_id` unique dan timestamp bisa berubah karena correction, hati-hati: designated timestamp tetap harus masuk dedup key dalam QuestDB dedup model. Desain final mungkin perlu menyimpan revisions atau memastikan timestamp stable.

### 10.2 Source Sequence Key

Untuk source yang punya sequence number:

```text
source_id + partition_id + sequence_number
```

Namun jika query utama berbasis event timestamp, sequence key tetap harus diselaraskan dengan timestamp semantics.

### 10.3 Batch ID Bukan Dedup Key

Jangan masukkan `backfill_job_id` ke dedup key jika tujuanmu idempotent replay.

Bad:

```text
UPSERT KEYS(ts, device_id, metric, backfill_job_id)
```

Karena retry job baru akan menghasilkan duplicate logical observation.

Good:

```text
UPSERT KEYS(ts, device_id, metric)
```

Simpan `backfill_job_id` sebagai audit column hanya jika tidak mengubah dedup identity.

---

## 11. Correction Load Patterns

### 11.1 Overwrite Latest Value

Cocok jika:

- setiap logical observation hanya boleh punya satu final value;
- correction dianggap menggantikan value lama;
- tidak perlu menyimpan riwayat revisi di table yang sama.

Pattern:

```text
DEDUP UPSERT KEYS(...logical observation...)
```

Risk:

- audit revision hilang jika tidak disimpan di tempat lain;
- correction order harus deterministik;
- race antara old replay dan new correction bisa menyebabkan value lama menang jika tidak dikontrol.

### 11.2 Append Revision

Cocok jika:

- regulatory/audit butuh riwayat perubahan;
- correction bisa banyak kali;
- perlu query “as reported” vs “as corrected”.

Schema:

```sql
CREATE TABLE sensor_reading_revisions (
    ts TIMESTAMP,
    tenant_id SYMBOL,
    device_id SYMBOL,
    sensor_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    revision INT,
    correction_reason SYMBOL,
    corrected_at TIMESTAMP
) TIMESTAMP(ts)
PARTITION BY DAY
WAL;
```

Serving query bisa memilih latest revision per observation.

### 11.3 Raw + Corrected Serving Table

Pattern kuat:

```text
raw_events_append_only
    immutable source facts

corrected_readings
    dedup/upsert final state for serving
```

Manfaat:

- raw audit tetap lengkap;
- serving query cepat;
- correction bisa direbuild;
- replay bisa dilakukan dari raw.

---

## 12. Backfill Validation and Reconciliation

### 12.1 Row Count Validation

Per partition/batch:

```text
source_valid_rows == target_rows_for_range_and_keys
```

Namun jika dedup aktif:

```text
target rows <= sent rows
```

Maka validasi harus membedakan:

- raw input rows;
- valid rows;
- unique logical observations;
- dedup skipped rows;
- corrected rows;
- final rows.

### 12.2 Min/Max Timestamp Validation

```sql
SELECT min(ts), max(ts), count()
FROM sensor_readings
WHERE ts >= '2025-01-01T00:00:00Z'
  AND ts <  '2025-01-02T00:00:00Z';
```

Pastikan range sesuai batch.

### 12.3 Aggregate Checksum

Untuk numeric metrics:

```text
count
sum(value)
min(value)
max(value)
avg(value)
```

Per metric/device/tenant jika memungkinkan.

Example:

```sql
SELECT
    tenant_id,
    metric,
    count() AS rows,
    min(value),
    max(value),
    sum(value)
FROM sensor_readings
WHERE ts >= '2025-01-01T00:00:00Z'
  AND ts <  '2025-02-01T00:00:00Z'
GROUP BY tenant_id, metric;
```

### 12.4 Missing Series Detection

Jika source memiliki known device/metric inventory:

```text
expected series set - actual series set = missing series
actual series set - expected series set = unexpected series
```

### 12.5 Freshness/Visibility Wait

Jangan validasi terlalu cepat saat WAL apply masih tertinggal.

Flow:

```text
send batch
-> observe WAL/apply lag
-> wait until batch likely visible
-> run validation query
-> mark validated
```

### 12.6 Sample-Based Deep Validation

Untuk data sangat besar, full validation bisa mahal. Gunakan kombinasi:

- full row count per partition;
- aggregate checksum per partition;
- random sample exact match;
- known sentinel events;
- domain constraints.

---

## 13. Cutover Strategy from Existing System

### 13.1 Dual Write with Historical Backfill

Pattern:

```text
T0: QuestDB empty
T1: start dual-write live data to old + QuestDB
T2: backfill historical data before T1
T3: validate QuestDB completeness
T4: switch read traffic
T5: keep old system as fallback
T6: decommission after retention window
```

Risiko:

- duplicate around cutover boundary;
- schema mismatch old/new;
- live data correction racing with backfill;
- reads comparing different aggregation semantics.

Mitigation:

- define exact cutover timestamp;
- dedup across boundary;
- freeze historical source snapshot;
- reconcile overlap period.

### 13.2 Shadow Read Validation

Before switching users:

```text
API query -> old system
same query -> QuestDB
compare results
record diff
```

Queries to compare:

- latest state;
- range aggregate;
- downsampled dashboard;
- temporal join if applicable;
- edge ranges around partition boundary;
- DST/timezone queries if applicable.

### 13.3 Read Cutover by Tenant/Feature

Safer than big-bang:

```text
tenant A -> QuestDB
tenant B -> old

or

dashboard X -> QuestDB
reporting Y -> old
```

This allows controlled blast radius.

---

## 14. Operational Guardrails During Backfill

### 14.1 Protect Live Ingestion

Define priority:

```text
P0: live ingestion freshness
P1: query availability
P2: backfill throughput
```

Backfill should pause when:

- live WAL lag exceeds threshold;
- disk utilization high;
- query latency SLO breached;
- table suspended;
- CPU saturation sustained;
- materialized view lag exceeds threshold.

### 14.2 Protect Disk

Before backfill:

```text
available disk >= expected raw load
              + WAL growth
              + O3/merge workspace
              + index overhead
              + MV growth
              + safety headroom
```

Never start multi-TB backfill at 80% disk usage.

### 14.3 Protect Query Users

Options:

- run backfill off-peak;
- throttle loader;
- route heavy dashboard to materialized views;
- temporarily reduce expensive ad-hoc query access;
- isolate backfill to staging instance;
- use replica for queries if HA topology supports it.

### 14.4 Protect Schema

During backfill:

- disable uncontrolled auto column creation if possible through process/gateway;
- validate every field;
- reject unknown metric names;
- cap symbol values;
- block new dimensions unless approved.

---

## 15. Common Anti-Patterns

### 15.1 Backfill Directly from Unsorted Source

```text
read random historical rows
-> send as fast as possible
```

Failure:

- O3 storm;
- WAL lag;
- disk amplification;
- unpredictable completion time.

Better:

```text
bucket by partition
-> sort
-> rate-limit
-> validate
```

### 15.2 No Dedup, Then Replay

Failure:

- duplicate rows;
- inflated aggregates;
- broken billing/reporting;
- hard cleanup.

Better:

```text
define logical key
-> enable dedup/upsert where appropriate
-> test replay twice
```

### 15.3 Backfill Job Has No Checkpoint

Failure:

- crash after 60% load;
- nobody knows what was inserted;
- rerun duplicates or gaps.

Better:

```text
checkpoint per source range/partition
```

### 15.4 Validate Only Client-Side Success

Failure:

- client sent rows;
- WAL apply failed or lagging;
- query result incomplete.

Better:

```text
client success + WAL health + target reconciliation
```

### 15.5 Use Ingestion Time for Historical Data

Failure:

- data appears in wrong time range;
- retention wrong;
- dedup wrong;
- dashboards wrong.

Better:

```text
always use event/designated timestamp for historical facts
```

### 15.6 Include Batch Metadata in Dedup Key

Failure:

- retry produces new keys;
- dedup ineffective.

Better:

```text
batch metadata is audit field, not logical identity
```

### 15.7 No Cutover Boundary

Failure:

- overlap duplicates;
- missing gap;
- old/new systems disagree.

Better:

```text
explicit cutover timestamp + overlap reconciliation
```

---

## 16. Case Study: Industrial IoT Historical Load

### 16.1 Scenario

A factory platform has 18 months of telemetry in object storage. QuestDB will become the serving store for operational dashboards.

Source:

```text
s3://factory-telemetry/raw/yyyy/mm/dd/*.csv.gz
```

Target table:

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    tenant_id SYMBOL,
    site_id SYMBOL,
    line_id SYMBOL,
    device_id SYMBOL,
    sensor_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    unit SYMBOL,
    quality SYMBOL
) TIMESTAMP(ts)
PARTITION BY DAY
WAL
DEDUP UPSERT KEYS(ts, tenant_id, device_id, sensor_id, metric);
```

### 16.2 Plan

```text
1. Freeze source snapshot list.
2. Split files by UTC day.
3. Validate schema and metric catalog.
4. Sort each day by ts, tenant_id, device_id, sensor_id, metric.
5. Load day by day with ILP HTTP.
6. Throttle based on WAL lag and disk.
7. Validate row count and aggregate checksum per day.
8. Build/refresh materialized views after raw load or per window.
9. Run shadow dashboard queries.
10. Cut over tenants gradually.
```

### 16.3 Key Decision

Backfill is not sent at max possible throughput. It is sent at max safe throughput.

```text
safe throughput = min(
    loader capacity,
    QuestDB write capacity,
    WAL apply capacity,
    disk headroom,
    live freshness budget,
    validation throughput
)
```

---

## 17. Case Study: Market Tick Replay

### 17.1 Scenario

A trading analytics system replays tick data for one exchange after a feed parser bug.

Problem:

- some trades had wrong side;
- trade ID is stable;
- timestamp is nanosecond precision;
- downstream OHLC must be rebuilt.

### 17.2 Design

Raw table append-only:

```sql
CREATE TABLE trades_raw (
    ts TIMESTAMP_NS,
    exchange SYMBOL,
    symbol SYMBOL,
    trade_id SYMBOL,
    price DOUBLE,
    size DOUBLE,
    side SYMBOL,
    parser_version SYMBOL,
    replay_id SYMBOL
) TIMESTAMP(ts)
PARTITION BY DAY
WAL;
```

Serving table deduped:

```sql
CREATE TABLE trades_current (
    ts TIMESTAMP_NS,
    exchange SYMBOL,
    symbol SYMBOL,
    trade_id SYMBOL,
    price DOUBLE,
    size DOUBLE,
    side SYMBOL,
    correction_version INT
) TIMESTAMP(ts)
PARTITION BY DAY
WAL
DEDUP UPSERT KEYS(ts, exchange, symbol, trade_id);
```

### 17.3 Replay Rule

```text
raw receives all replay facts
current receives latest corrected fact
OHLC materialized views rebuilt/refreshed for affected range
```

### 17.4 Validation

- count trades by symbol/day;
- compare total volume;
- compare OHLC before/after for expected affected symbols;
- sample trade_id exact match;
- check duplicate count by `(ts, exchange, symbol, trade_id)`.

---

## 18. Testing Backfill Before Production

### 18.1 Replay Twice Test

A backfill pipeline is not idempotent until this test passes:

```text
load same batch once
load same batch again
final target state unchanged
```

Validation:

```sql
SELECT ts, tenant_id, device_id, sensor_id, metric, count()
FROM sensor_readings
WHERE ts >= '2025-01-01T00:00:00Z'
  AND ts <  '2025-01-02T00:00:00Z'
GROUP BY ts, tenant_id, device_id, sensor_id, metric
HAVING count() > 1;
```

Expected:

```text
0 rows
```

### 18.2 Failure Injection

Test:

- kill loader after 30%;
- restart from checkpoint;
- simulate QuestDB connection drop;
- simulate invalid row;
- simulate disk near-full in staging;
- send duplicate batch;
- send late correction;
- pause WAL apply if possible in test environment;
- throttle network.

### 18.3 Scale Test

Do not infer multi-TB behavior from 10 MB test.

Test at least:

- realistic row width;
- realistic symbol cardinality;
- realistic partition count;
- realistic timestamp disorder;
- realistic live ingestion concurrency;
- realistic query traffic.

---

## 19. Production Runbook Template

### 19.1 Pre-Flight

```text
[ ] Source snapshot defined
[ ] Target table schema reviewed
[ ] Dedup/idempotency reviewed
[ ] Partition strategy reviewed
[ ] Disk capacity verified
[ ] WAL monitoring dashboard ready
[ ] Live freshness dashboard ready
[ ] Loader config reviewed
[ ] Rate limit configured
[ ] DLQ configured
[ ] Checkpoint store ready
[ ] Validation queries prepared
[ ] Rollback strategy approved
[ ] Change window approved
```

### 19.2 Execution

```text
1. Announce start.
2. Start with small canary batch.
3. Validate canary.
4. Increase throughput gradually.
5. Monitor WAL lag, disk, CPU, query latency, live freshness.
6. Pause on threshold breach.
7. Validate each partition/batch.
8. Record checkpoint states.
9. Reconcile final range.
10. Announce completion or rollback.
```

### 19.3 Stop Conditions

Stop immediately if:

```text
table suspended
OR disk usage > hard threshold
OR WAL lag > hard threshold
OR live freshness SLO violated for sustained period
OR duplicate anomaly detected
OR schema pollution detected
OR validation mismatch exceeds tolerance
```

### 19.4 Post-Run

```text
[ ] All batches validated
[ ] DLQ reviewed
[ ] Reconciliation report generated
[ ] Materialized views refreshed/validated
[ ] Dashboards checked
[ ] API shadow comparison passed
[ ] Capacity updated
[ ] Lessons learned recorded
```

---

## 20. Production Checklist

Before approving a backfill/replay design, answer:

```text
Scope
[ ] What exact source data is loaded?
[ ] What exact time range?
[ ] What exact target table?
[ ] What is expected row count?

Timestamp
[ ] Is event/designated timestamp used?
[ ] Are timezone conversions explicit?
[ ] Are timestamp precisions correct?

Ordering
[ ] Is data sorted by timestamp/key?
[ ] Is loading partition-aware?
[ ] Is O3 risk understood?

Idempotency
[ ] Is dedup enabled if replay can happen?
[ ] Are UPSERT KEYS correct?
[ ] Has replay-twice test passed?

Resource control
[ ] Is rate limit configured?
[ ] Is WAL lag monitored?
[ ] Is disk headroom sufficient?
[ ] Is live ingestion protected?

Checkpoint
[ ] Can job resume after crash?
[ ] Are source offsets/files recorded?
[ ] Are batch statuses durable?

Validation
[ ] Are row counts checked?
[ ] Are aggregate checksums checked?
[ ] Are sample exact matches checked?
[ ] Are materialized views validated?

Rollback
[ ] Can affected data be removed/rebuilt?
[ ] Is snapshot/backup available?
[ ] Is cutover reversible?
```

---

## 21. Ringkasan

Backfill dan replay adalah operasi produksi serius pada sistem time-series.

Prinsip utamanya:

```text
1. Use the correct event timestamp.
2. Sort or bucket data by time.
3. Make replay idempotent.
4. Load partition-aware.
5. Protect live ingestion.
6. Monitor WAL/apply, not only client success.
7. Validate target state.
8. Checkpoint everything.
9. Define rollback before execution.
10. Treat migration/backfill as an engineering project, not a script.
```

QuestDB dapat menangani out-of-order dan historical data, tetapi bukan berarti backfill boleh dilakukan tanpa desain. Semakin besar data dan semakin jauh timestamp dari table head, semakin penting sorting, throttling, dedup, partition awareness, dan reconciliation.

Mental model final:

```text
safe backfill = correct timestamp
              + sorted/partition-aware load
              + idempotent write semantics
              + bounded resource usage
              + durable checkpoints
              + target-side validation
              + rollback plan
```

Jika part sebelumnya membahas ingestion, WAL, dedup, temporal query, retention, dan failure mode secara individual, part ini menyatukannya ke salah satu operasi paling nyata dalam lifecycle TSDB: **memindahkan atau memutar ulang sejarah tanpa merusak masa kini**.

---

## 22. Apa Selanjutnya

Part berikutnya akan membahas:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-029.md
Performance Engineering and Benchmarking
```

Kita akan membangun metodologi benchmark yang benar: ingestion throughput, query latency, cardinality realism, partition realism, cold/warm cache, WAL/apply lag, producer bottleneck, dan cara menghindari benchmark palsu yang terlihat bagus tetapi tidak mewakili workload produksi.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-027.md">⬅️ Pipeline Architecture with Kafka/RabbitMQ Without Repeating Messaging Theory</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-029.md">Performance Engineering and Benchmarking ➡️</a>
</div>

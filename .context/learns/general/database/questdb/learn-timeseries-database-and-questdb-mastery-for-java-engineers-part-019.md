# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-019.md

# Storage Capacity Planning

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Part: 019  
> Target pembaca: Java software engineer / tech lead yang ingin mendesain QuestDB untuk workload time-series production-scale.

---

## 0. Executive Summary

Storage capacity planning untuk time-series database tidak boleh dimulai dari pertanyaan:

> “Berapa GB disk yang kita butuhkan?”

Pertanyaan yang benar:

> “Berapa banyak fakta temporal yang akan kita simpan, dengan bentuk schema apa, pada lifecycle apa, dengan freshness dan query SLA apa, serta failure headroom berapa?”

Dalam sistem time-series seperti QuestDB, storage bukan hanya tempat menyimpan data. Storage adalah bagian dari write path, query path, WAL recovery path, retention path, backup path, dan operational safety margin.

Model paling sederhana:

```text
storage/day = rows/day × effective_bytes_per_row
```

Tetapi model production harus memperhitungkan:

```text
production_storage_need = raw_table_size
                        + symbol/string overhead
                        + WAL overhead
                        + partition metadata/files
                        + index overhead
                        + materialized view / rollup size
                        + cold/historical copy
                        + backup/snapshot overhead
                        + compaction / conversion workspace
                        + operational headroom
```

Part ini akan membangun cara berpikir tersebut secara sistematis.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu harus bisa:

1. Mengubah workload time-series menjadi estimasi rows/day dan bytes/day.
2. Menghitung capacity dari schema QuestDB secara reasonable.
3. Memahami pengaruh tipe data, symbol cardinality, string, null, partition, index, WAL, dan materialized view terhadap storage.
4. Menentukan retention dan tiering berdasarkan biaya serta query SLA.
5. Mendesain headroom untuk spike, replay, backfill, WAL lag, dan recovery.
6. Membuat capacity planning worksheet yang bisa dipakai dalam architecture review.
7. Menghindari anti-pattern seperti “disk cukup 2x raw data” tanpa memperhitungkan write amplification dan operational workspace.

---

## 2. Problem yang Sedang Diselesaikan

Time-series system sering gagal bukan karena query pertama lambat, tetapi karena storage tumbuh lebih cepat dari yang diasumsikan.

Gejalanya:

```text
- disk usage naik lebih cepat dari forecast
- WAL menumpuk saat apply lambat
- partition terlalu banyak atau terlalu besar
- TTL tidak sesuai partition size
- backup window makin panjang
- query lama makin mahal
- materialized view diam-diam menggandakan data
- string/dimension cardinality meledak
- SSD write endurance mulai jadi risiko
- backfill butuh temporary space besar
- restore test gagal karena data terlalu besar untuk waktu recovery yang dijanjikan
```

Masalah utama: banyak tim menghitung storage dari jumlah metric saja.

Contoh asumsi lemah:

```text
Kita punya 100 metric, tiap metric 8 byte, jadi kecil.
```

Padahal kenyataan bisa lebih dekat ke:

```text
100 metric
× 50,000 devices
× 1 sample/second
× timestamp
× tags
× symbols
× WAL
× retention
× rollups
× backup
× headroom
```

Perbedaan antara dua cara hitung ini bisa ribuan kali lipat.

---

## 3. Mental Model Utama

### 3.1 Storage Is Not Just Data Size

Dalam QuestDB, storage adalah konsekuensi dari lima hal:

```text
1. event volume
2. schema shape
3. lifecycle policy
4. write-path behavior
5. query-serving design
```

Jangan memisahkan capacity planning dari schema design dan retention design.

---

### 3.2 Capacity Is a Rate Problem

Data time-series tumbuh sebagai rate.

```text
rows/sec → rows/day → rows/month → retention footprint
```

Karena itu, capacity planning harus memakai model rate, bukan snapshot.

```text
Bad:
"Sekarang table ini 50 GB."

Better:
"Table ini tumbuh 82 GB/day pada p95 ingest, retention 90 hari, dengan 35% WAL/index/MV overhead, sehingga hot footprint butuh sekitar 10 TB sebelum backup/headroom."
```

---

### 3.3 Partition Is the Unit of Lifecycle

Jika table dipartisi harian, maka growth harian menjadi unit fisik yang penting.

```text
partition_size ≈ rows_per_day × bytes_per_row
```

Partition size memengaruhi:

```text
- query pruning
- TTL/drop cost
- out-of-order rewrite cost
- backup granularity
- Parquet conversion
- operational blast radius
```

---

### 3.4 Hot Storage Is Expensive; Cold Storage Is Slow

Tidak semua data butuh SSD hot storage.

Typical lifecycle:

```text
raw hot data       : recent, frequently queried, low latency
warm rollup data   : aggregated, moderate latency
cold historical    : rare query, cheaper storage, slower access
archive/compliance : retained for policy, not interactive
```

Storage planning tanpa lifecycle akan overpay atau underperform.

---

### 3.5 Headroom Is a Reliability Feature

Headroom bukan waste.

Headroom melindungi dari:

```text
- ingest spike
- WAL lag
- backfill
- replay
- partition conversion
- index rebuild
- backup snapshot
- query temporary memory/disk impact
- operational delay before scaling
```

Jika disk selalu 85–95%, sistem sudah berada dalam incident mode.

---

## 4. Core Formula

### 4.1 Rows Per Second

Untuk workload telemetry:

```text
rows/sec = entities × metrics_per_entity × samples_per_second
```

Contoh:

```text
50,000 devices
× 20 metrics/device
× 1 sample/10 seconds
= 100,000 rows/sec
```

Untuk tick/event workload:

```text
rows/sec = events_per_entity_per_sec × entity_count
```

Contoh market data:

```text
2,000 symbols
× 30 quote updates/sec
= 60,000 quote rows/sec
```

Untuk application observability:

```text
rows/sec = services × instances × endpoints × status_groups × sample_rate
```

Hati-hati: observability cardinality sering lebih berbahaya daripada raw sample rate.

---

### 4.2 Rows Per Day

```text
rows/day = rows/sec × 86,400
```

Example:

```text
100,000 rows/sec × 86,400 = 8,640,000,000 rows/day
```

8.64 miliar row/day bukan angka luar biasa untuk time-series modern.

---

### 4.3 Naive Bytes Per Row

Naive model:

```text
bytes/row = sum(fixed_width_column_sizes)
```

Approximate fixed sizes:

```text
BOOLEAN      ~1 byte logical value
BYTE         ~1 byte
SHORT        ~2 bytes
INT          ~4 bytes
LONG         ~8 bytes
FLOAT        ~4 bytes
DOUBLE       ~8 bytes
TIMESTAMP    ~8 bytes
TIMESTAMP_NS ~8 bytes
UUID         ~16 bytes logical
```

Example schema:

```sql
CREATE TABLE sensor_reading (
    ts TIMESTAMP,
    tenant SYMBOL,
    site SYMBOL,
    device_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    quality BYTE
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Naive fixed part:

```text
ts       8
value    8
quality  1
symbols  dictionary references / encoded ids + dictionary storage
```

Jangan menganggap symbol/string gratis.

---

### 4.4 Effective Bytes Per Row

Production estimate harus memakai:

```text
effective_bytes_per_row = fixed_value_columns
                        + timestamp
                        + symbol_reference_cost
                        + nullable/sparse overhead
                        + string/varchar payload amortized
                        + index overhead amortized
                        + metadata/file overhead amortized
```

Karena detail internal bisa berubah antar versi dan bergantung data distribution, gunakan measurement loop:

```text
1. generate representative dataset
2. ingest to staging QuestDB
3. measure table directory size
4. divide by row count
5. add WAL/MV/backup/headroom separately
```

Approximation berguna untuk forecast awal, tetapi measurement wajib sebelum production commitment.

---

## 5. Data Type Impact

### 5.1 Numeric Columns

Numeric fixed-width columns relatif mudah dihitung.

```text
DOUBLE × 10 columns × 1B rows = about 80 GB raw fixed values
```

Namun query dan storage behavior juga dipengaruhi oleh:

```text
- number of columns scanned
- sparsity
- null distribution
- compression / encoding behavior
- partition locality
```

Rule:

> Gunakan tipe paling sempit yang masih benar secara domain.

Contoh:

```text
temperature_celsius: DOUBLE jika butuh precision floating
quality_code       : BYTE / SHORT
counter            : LONG
status_enum        : SYMBOL or BYTE depending semantics
```

Anti-pattern:

```text
Semua angka pakai DOUBLE karena mudah.
```

Konsekuensi:

```text
- storage lebih besar
- memory scan lebih besar
- cache efficiency lebih rendah
- network result lebih besar
```

---

### 5.2 Timestamp Cost

Timestamp biasanya 8 byte.

Tetapi timestamp punya dampak lebih besar dari ukuran kolom:

```text
- menentukan partition
- menentukan O3 behavior
- menentukan query pruning
- menentukan MV refresh
- menentukan retention
```

Timestamp salah lebih mahal daripada column size salah.

---

### 5.3 SYMBOL Columns

`SYMBOL` cocok untuk repetitive categorical values.

Contoh cocok:

```text
tenant_id
site_id
device_id
metric_name
exchange
instrument
service_name
status_class
```

Tapi symbol punya dictionary.

Storage impact:

```text
symbol_column_storage ≈ row references + dictionary values + metadata + optional index
```

Cardinality penting.

```text
Low cardinality:
status = OK/WARN/FAIL

Moderate cardinality:
device_id = 50k devices

High/unbounded cardinality:
request_id = unique per request
trace_id = unique per trace
user_agent = many free-form strings
error_message = unbounded text
```

Jangan masukkan unique IDs sebagai symbol jika tidak dipakai sebagai repeated dimension query.

---

### 5.4 STRING / VARCHAR Columns

String/varchar biasanya lebih mahal dan lebih sulit diprediksi.

Cocok untuk:

```text
- descriptive payload
- raw message
- optional diagnostic text
- non-filtered value
```

Tidak cocok untuk:

```text
- repeated dimension yang sering difilter
- high-throughput tag utama
- metric identity
```

Untuk capacity planning, hitung string dengan average dan p95 length.

```text
avg_string_bytes = average UTF-8 byte length
p95_string_bytes = p95 UTF-8 byte length
```

Jika error_message rata-rata 200 byte dan ada 1M row/sec, itu bukan detail kecil.

---

### 5.5 Null and Sparse Data

Sparse table bisa tampak convenient:

```sql
CREATE TABLE device_metrics (
    ts TIMESTAMP,
    device_id SYMBOL,
    temperature DOUBLE,
    pressure DOUBLE,
    vibration DOUBLE,
    voltage DOUBLE,
    current DOUBLE,
    rpm DOUBLE,
    error_code SYMBOL
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Tetapi jika setiap row hanya mengisi satu dari banyak metric columns, banyak kolom sparse.

Risiko:

```text
- wasted logical shape
- query confusion
- schema evolution berat
- more columns than needed
- ingestion contract sulit
```

Wide table cocok jika metrics biasanya dikirim bersama.

Narrow table cocok jika metric datang independen:

```sql
CREATE TABLE metric_sample (
    ts TIMESTAMP,
    device_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    quality BYTE
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Tetapi narrow table meningkatkan row count dan membutuhkan `metric` dimension.

Capacity trade-off:

```text
wide  = fewer rows, more columns, possible sparsity
narrow = more rows, fewer value columns, more dimension overhead
```

Tidak ada jawaban universal. Ukur dengan data representative.

---

## 6. Cardinality Capacity Model

### 6.1 Cardinality Is Storage + Memory + Query Cost

Cardinality bukan hanya jumlah unique values.

Cardinality berdampak pada:

```text
- symbol dictionary size
- group-by state
- index size
- query result size
- memory pressure
- dashboard usability
- series explosion
```

Formula series cardinality:

```text
series_count = cardinality(dim1) × cardinality(dim2) × ...
```

Tapi hanya jika kombinasi semua dimensi benar-benar muncul.

Contoh:

```text
tenant: 100
site per tenant: 20
device per site: 500
metric per device: 50

potential series = 100 × 20 × 500 × 50 = 50,000,000 series
```

50 juta series mungkin valid, tetapi harus didesain sadar.

---

### 6.2 Active Cardinality vs Historical Cardinality

Dua angka berbeda:

```text
active cardinality     = values active in recent/hot window
historical cardinality = all values ever seen
```

Contoh:

```text
active devices: 50,000
historical devices: 2,500,000
```

Historical cardinality memengaruhi dictionary dan old partition; active cardinality memengaruhi dashboard dan current query.

---

### 6.3 Dimension Admission Control

Production system perlu policy:

```text
Allowed symbols:
- tenant_id
- site_id
- device_id
- metric_name
- source

Forbidden symbols:
- request_id
- trace_id
- session_id
- raw_url_with_query
- user_agent
- stack_trace
- exception_message
```

Di Java ingestion gateway, enforce:

```java
boolean isAllowedDimension(String key, String value) {
    if (!ALLOWED_KEYS.contains(key)) return false;
    if (value == null || value.isBlank()) return false;
    if (value.length() > MAX_DIMENSION_VALUE_LENGTH) return false;
    if (looksLikeUuid(key, value) && !UUID_DIMENSIONS_ALLOWED.contains(key)) return false;
    return true;
}
```

Cardinality harus diperlakukan sebagai budget.

---

## 7. Partition Size Planning

### 7.1 Estimate Partition Size

Jika partition by day:

```text
partition_size_day = rows/day × effective_bytes_per_row
```

Jika partition by hour:

```text
partition_size_hour = rows/hour × effective_bytes_per_row
```

Contoh:

```text
rows/sec = 50,000
effective bytes/row = 80
rows/day = 4,320,000,000
partition/day = 345,600,000,000 bytes ≈ 322 GiB raw-ish
```

Satu partition harian 300+ GiB mungkin masih mungkin untuk scan tertentu, tetapi operationally perlu hati-hati:

```text
- O3 rewrite mahal
- backup chunk besar
- Parquet conversion besar
- drop/attach operation besar
- cold query blast radius besar
```

Mungkin `PARTITION BY HOUR` lebih cocok jika workload sangat besar dan query recent-window pendek.

---

### 7.2 Partition Granularity Heuristic

| Workload | Typical Volume | Query Window | Candidate Partition |
|---|---:|---:|---|
| Low-volume business events | rendah | hari/bulan | MONTH / DAY |
| Observability metrics | sedang-tinggi | menit-jam | DAY / HOUR |
| IoT telemetry | sedang-tinggi | jam-hari | DAY |
| Market ticks high rate | sangat tinggi | detik-jam | HOUR / DAY depending volume |
| Historical archive | besar, jarang query | bulan/tahun | MONTH / YEAR / Parquet |

Heuristic:

```text
Choose partition size so that:
- common query touches few partitions
- TTL can drop whole partitions cleanly
- O3/backfill blast radius is acceptable
- partition count does not become operational noise
```

---

### 7.3 Too Small vs Too Large

Too small:

```text
- too many directories/files
- metadata overhead
- query planning overhead
- operational clutter
```

Too large:

```text
- expensive retention boundary
- expensive O3 merge
- slower backup/conversion
- large blast radius
```

Good partitioning is not about “smallest possible” or “largest possible”. It is about lifecycle-aligned physical boundaries.

---

## 8. WAL Storage Planning

### 8.1 WAL Is Temporary but Critical

WAL is not the same as table storage. It is part of the write path.

WAL size depends on:

```text
- ingest rate
- apply throughput
- row width
- transaction/batch shape
- O3 merge pressure
- table suspension
- disk speed
- replication lag if applicable
```

Simplified model:

```text
wal_growth = ingest_bytes_per_sec - apply_bytes_per_sec
```

If apply keeps up:

```text
WAL remains bounded
```

If apply lags:

```text
WAL grows until apply catches up or disk fills
```

---

### 8.2 WAL Headroom

You need enough disk headroom for:

```text
- normal WAL queue
- p95/p99 ingest bursts
- short apply lag
- maintenance/restart catch-up
- backfill/replay
```

Rule of thumb for planning:

```text
WAL headroom ≥ several hours of peak ingest volume
```

For critical systems:

```text
WAL headroom should cover worst acceptable apply outage window.
```

Example:

```text
peak ingest = 150 MB/s
acceptable apply disruption = 2 hours
WAL headroom = 150 × 3600 × 2 = 1,080,000 MB ≈ 1.08 TB
```

This is only WAL headroom, not total database size.

---

### 8.3 WAL Lag Changes Query Freshness

Capacity planning must include freshness impact.

```text
Client write accepted -> WAL durable
But query freshness depends on WAL apply
```

If WAL accumulates, disk and freshness both degrade.

Alert not only on disk:

```text
- WAL lag rows/time
- table suspended state
- apply job throughput
- disk free bytes
- oldest unapplied transaction age
```

---

## 9. Index Overhead Planning

Indexes improve selective lookup but cost storage and write overhead.

Only index if query shape justifies it.

Common index candidates:

```text
- device_id for point/device range query
- instrument for market symbol query
- service_name for service-level observability
- tenant_id if tenant-scoped query is common and selective
```

Bad index candidates:

```text
- status with only 3 values if most queries scan broad ranges anyway
- high-cardinality unique request_id in massive table
- dimension not used in filters
- column only used in group-by over broad time range
```

Capacity model:

```text
index_overhead = indexed_column_reference_structures + metadata + write maintenance cost
```

In planning, maintain separate index budget:

```text
base_table_size × index_overhead_factor
```

Initial factor for rough planning:

```text
5%–30% depending number/selectivity/cardinality of indexed symbol columns
```

But validate with representative data.

---

## 10. Materialized View / Rollup Storage

Rollups are not free.

Example raw:

```text
raw data: 100,000 rows/sec
```

1-minute rollup by device+metric:

```text
devices = 50,000
metrics = 20
buckets/day = 1,440
rows/day = 50,000 × 20 × 1,440 = 1.44B rollup rows/day
```

That may still be huge.

Rollup is useful when it reduces cardinality or bucket count enough.

Compare:

```text
raw rows/day = 8.64B
rollup rows/day = 1.44B
reduction = 6x
```

Good, but not tiny.

If rollup by tenant+metric only:

```text
tenants = 100
metrics = 20
buckets/day = 1,440
rows/day = 2.88M
```

Massive reduction.

Key question:

> What dimension level should be served interactively?

Do not blindly roll up at every possible dimension.

---

## 11. Backup and Snapshot Storage

Backup planning often doubles or triples actual need.

Questions:

```text
- Are backups full or incremental?
- Are snapshots local, remote, or both?
- How long are backups retained?
- Are WAL files included?
- Are Parquet/cold partitions backed up separately?
- Is backup taken before or after TTL/drop?
- What temporary space does snapshot/conversion need?
```

Simplified model:

```text
backup_storage = database_size × backup_retention_factor
```

Example:

```text
hot DB size = 8 TB
local snapshot = 1 full copy temporary
remote backups = 14 daily incrementals + 4 weekly fulls
```

The exact mechanism matters. But architecture review must include it.

Storage without backup plan is not production capacity planning.

---

## 12. SSD Endurance and Write Amplification

High-ingest TSDB can stress SSD write endurance.

Write volume is not only final data:

```text
actual_disk_writes = WAL writes
                   + table writes
                   + O3 merge writes
                   + index writes
                   + MV writes
                   + compaction/conversion
                   + backup/snapshot IO
```

This is write amplification.

Approximate:

```text
write_amplification_factor = actual_physical_write_bytes / logical_ingested_bytes
```

For in-order append-only workload, factor may be relatively low.

For O3-heavy/backfill/index/MV-heavy workload, factor can be much higher.

Planning questions:

```text
- What is daily logical ingest GB?
- What is estimated physical write GB/day?
- What is SSD TBW rating?
- What is expected hardware lifetime?
- What happens during replay/backfill spike?
```

Example:

```text
logical ingest = 2 TB/day
write amplification = 2.5x
physical writes = 5 TB/day
SSD endurance = 10,000 TBW
expected endurance = 10,000 / 5 = 2,000 days ≈ 5.5 years
```

That may be acceptable. But if amplification becomes 8x during O3-heavy ingest, endurance changes materially.

---

## 13. Capacity Planning Worksheet

### 13.1 Input Variables

```text
entities_count
metrics_per_entity
samples_per_second_per_metric
average_event_rows_per_second
fixed_bytes_per_row
avg_string_bytes_per_row
symbol_overhead_factor
index_overhead_factor
wal_headroom_hours
retention_hot_days
retention_warm_days
retention_cold_days
materialized_view_factor
backup_factor
operational_headroom_factor
```

---

### 13.2 Basic Formula

```text
rows_per_sec = entities_count
             × metrics_per_entity
             × samples_per_second_per_metric

rows_per_day = rows_per_sec × 86,400

base_bytes_per_row = fixed_bytes_per_row
                   + avg_string_bytes_per_row
                   + symbol_reference_bytes

base_storage_per_day = rows_per_day × base_bytes_per_row

indexed_storage_per_day = base_storage_per_day × (1 + index_overhead_factor)

hot_storage = indexed_storage_per_day × retention_hot_days

mv_storage = hot_storage × materialized_view_factor

wal_headroom = ingest_bytes_per_sec_peak × 3600 × wal_headroom_hours

backup_storage = (hot_storage + mv_storage) × backup_factor

total_required = (hot_storage + mv_storage + wal_headroom + backup_storage)
               × operational_headroom_factor
```

---

### 13.3 Example: Industrial Telemetry

Assumptions:

```text
devices                         = 40,000
metrics/device                  = 15
sample interval                 = 10 seconds
samples/sec/metric              = 0.1
rows/sec                        = 40,000 × 15 × 0.1 = 60,000
rows/day                        = 5,184,000,000
bytes/row effective             = 72
base/day                        = 373,248,000,000 bytes ≈ 347.6 GiB/day
index overhead                  = 15%
indexed/day                     ≈ 399.7 GiB/day
hot retention                   = 30 days
hot storage                     ≈ 11.7 TiB
materialized view factor         = 0.12
MV storage                      ≈ 1.4 TiB
WAL headroom                    = 6 hours peak at 2× normal
normal ingest bytes/sec          = 60,000 × 72 = 4.32 MB/s
peak ingest bytes/sec            = 8.64 MB/s
WAL headroom                    ≈ 186.6 GiB
backup factor                   = 1.5
backup storage                  ≈ 19.7 TiB
operational headroom            = 1.35x
```

Total rough:

```text
hot + MV + WAL + backup = 11.7 + 1.4 + 0.18 + 19.7 ≈ 32.98 TiB
with headroom = 32.98 × 1.35 ≈ 44.5 TiB
```

If you only counted raw data, you might have planned ~10–12 TiB. Production need may be closer to 45 TiB depending backup model.

---

### 13.4 Example: Market Quotes

Assumptions:

```text
instruments       = 5,000
updates/sec/inst  = 20 average
rows/sec          = 100,000
rows/day          = 8.64B
bytes/row         = 96
base/day          = 829.4 GB ≈ 772.4 GiB
partition         = HOUR
hourly partition  = 32.2 GiB
hot retention     = 14 days
hot base          = 10.56 TiB
index overhead    = 20%
hot indexed       = 12.67 TiB
MV factor         = 0.05
MV                = 0.63 TiB
WAL headroom      = 3 hours at 3× peak
backup factor     = 1.2
headroom          = 1.4x
```

Rough result:

```text
hot indexed + MV ≈ 13.3 TiB
backup ≈ 15.96 TiB
WAL maybe several hundred GiB to >1TiB depending peak
required with headroom likely >40 TiB
```

Market data systems often need fast NVMe and careful partitioning because raw ingest and short-window query both matter.

---

## 14. Measurement Loop

Forecast is not enough.

Use empirical measurement.

### 14.1 Build Representative Dataset

Representative means:

```text
- real cardinality distribution
- real string lengths
- real timestamp disorder
- real null/sparse behavior
- real partition boundaries
- real indexes
- real materialized views
```

Synthetic uniform data can understate storage and query cost.

---

### 14.2 Ingest to Staging

Procedure:

```text
1. create schema exactly as planned
2. enable same partitioning/WAL/index/MV
3. ingest at least several partitions worth of data
4. include representative late arrivals
5. measure directory size
6. measure WAL behavior during ingest
7. measure MV size
8. measure backup/snapshot behavior
```

---

### 14.3 Calculate Effective Bytes Per Row

```text
effective_bytes_per_row = table_size_bytes / row_count
```

Do this per table:

```text
raw table
rollup table
reference table
MV table
```

Then compare with forecast.

If measured size differs by >30%, revisit assumptions.

---

## 15. Operational Headroom Model

### 15.1 Disk Watermarks

Suggested mental model:

```text
<60% used      : healthy planning zone
60–75% used    : watch growth, plan expansion
75–85% used    : action zone
85–90% used    : high risk
>90% used      : incident territory
```

Exact thresholds depend on environment, but the principle is stable: do not run TSDB disk near full.

---

### 15.2 Why Full Disk Is Catastrophic

Disk full can break:

```text
- WAL writes
- WAL apply
- partition creation
- index updates
- materialized view refresh
- backup/snapshot
- Parquet conversion
- crash recovery
```

In write-heavy systems, disk full is not just “cannot store more data”. It can create recovery complexity.

---

### 15.3 Expansion Lead Time

Capacity plan must include lead time.

```text
days_until_full = free_bytes / daily_growth_bytes
```

But action threshold must include procurement/deployment time.

```text
if days_until_85_percent < expansion_lead_time_days + safety_margin:
    scale now
```

For cloud disks this may be hours. For bare metal NVMe, it may be weeks.

---

## 16. Java Engineer Perspective

### 16.1 Producer Determines Storage Cost

Every Java producer decision changes storage:

```text
- sends one metric per row vs batch/wide row
- includes raw labels
- uses high-cardinality tags
- sends string payloads
- changes units
- sends null-heavy columns
- emits duplicate retries
- emits late data unsorted
```

Capacity is not only DBA concern.

---

### 16.2 Add Storage Budget to Event Contract

A producer contract should include:

```text
- expected rows/sec normal
- expected rows/sec peak
- max dimensions
- allowed dimension keys
- max dimension value length
- max payload string length
- timestamp semantics
- retry behavior
- duplicate behavior
- late-arrival profile
```

Example YAML-like contract:

```yaml
metric_family: machine_sensor
owner: plant-platform
normal_rows_per_sec: 25000
peak_rows_per_sec: 100000
allowed_symbols:
  - tenant_id
  - site_id
  - line_id
  - machine_id
  - metric
max_symbol_value_length: 64
string_payload_allowed: false
timestamp_semantics: event_time_utc
late_arrival_p99: 5m
retention_hot: 30d
rollup_required:
  - 1m_by_machine_metric
  - 1h_by_site_metric
```

---

### 16.3 Runtime Guardrails

In ingestion gateway:

```text
- reject unknown dimension keys
- cap string length
- cap batch size
- meter rows/sec by producer
- meter bytes/sec by producer
- meter cardinality growth
- sample invalid rows
- send invalid rows to DLQ
```

Java-side metrics:

```text
questdb_ingest_rows_total{producer="x"}
questdb_ingest_bytes_total{producer="x"}
questdb_ingest_rejected_total{reason="dimension_not_allowed"}
questdb_ingest_rejected_total{reason="payload_too_large"}
questdb_ingest_late_rows_total{age_bucket="..."}
questdb_ingest_duplicate_attempt_total
```

---

## 17. Backfill and Replay Capacity

Backfill can temporarily multiply storage pressure.

Planning questions:

```text
- How much historical data will be loaded?
- Is it sorted by timestamp?
- Does it overlap existing data?
- Is dedup enabled?
- How much WAL will it create?
- Will materialized views refresh during backfill?
- Will indexes be maintained during load?
- Is there enough temporary workspace?
```

Possible strategy:

```text
1. load historical data to separate table
2. validate counts/checksums
3. attach/copy into serving table if needed
4. build/refresh rollups separately
5. cut over query API
6. drop temporary data after validation
```

Capacity factor for backfill:

```text
temporary_backfill_space = historical_load_size × 1.2 to 3.0
```

Higher if data is unsorted/O3-heavy or duplicate-heavy.

---

## 18. Query Result and Network Cost

Storage planning usually focuses on disk, but query output can matter.

Example bad API:

```http
GET /metrics?from=2024-01-01&to=2026-01-01&device=all
```

Even if DB can scan, returning billions of rows is not acceptable.

API should enforce:

```text
- maximum time range
- maximum result rows
- mandatory aggregation for long range
- pagination/cursor for raw export
- async export path for bulk extraction
```

Capacity implication:

```text
large exports may need temporary files, network bandwidth, and throttling
```

---

## 19. Common Anti-Patterns

### 19.1 Counting Only Value Columns

Bad:

```text
value is DOUBLE, 8 bytes, so 1B rows = 8GB.
```

Missing:

```text
- timestamp
- symbols
- strings
- indexes
- WAL
- MV
- partition metadata
- backup
- headroom
```

---

### 19.2 No Peak Model

Bad:

```text
Average ingest is 20k rows/sec.
```

Better:

```text
Average: 20k rows/sec
p95: 80k rows/sec
p99 burst: 250k rows/sec for 20 minutes
backfill: 500k rows/sec controlled lane
```

---

### 19.3 Infinite Cardinality Tags

Bad:

```text
Add all labels from upstream telemetry.
```

Consequence:

```text
- symbol explosion
- query grouping explosion
- storage drift
- dashboard unusability
```

---

### 19.4 Retention Afterthought

Bad:

```text
We'll decide retention later.
```

Consequence:

```text
- partitioning may be wrong
- TTL cannot align cleanly
- disk forecast wrong
- compliance unclear
```

---

### 19.5 Materialized View Explosion

Bad:

```text
Create MV for every dashboard dimension.
```

Consequence:

```text
- data multiplied
- refresh overhead
- stale derived data
- more failure points
```

---

### 19.6 No Restore Test

Bad:

```text
We have backups.
```

Better:

```text
We have restored 12TB into staging in 3h47m and validated row counts/checksums.
```

---

## 20. Architecture Review Checklist

### 20.1 Workload Volume

```text
[ ] normal rows/sec known
[ ] p95 rows/sec known
[ ] p99 burst profile known
[ ] backfill/replay rate known
[ ] rows/day calculated
[ ] rows/partition calculated
```

### 20.2 Schema Size

```text
[ ] fixed columns counted
[ ] symbol columns identified
[ ] string/varchar average and p95 length estimated
[ ] sparse columns reviewed
[ ] wide vs narrow trade-off documented
[ ] effective bytes/row measured in staging
```

### 20.3 Cardinality

```text
[ ] active cardinality estimated
[ ] historical cardinality estimated
[ ] dimension admission policy defined
[ ] forbidden high-cardinality fields listed
[ ] cardinality growth metrics planned
```

### 20.4 Partitioning

```text
[ ] partition granularity chosen intentionally
[ ] expected partition size calculated
[ ] TTL aligns with partition boundary
[ ] O3/backfill blast radius acceptable
[ ] partition count acceptable
```

### 20.5 WAL and Write Path

```text
[ ] WAL headroom calculated
[ ] acceptable apply lag defined
[ ] WAL lag alert defined
[ ] disk-full runbook exists
[ ] backfill lane capacity reviewed
```

### 20.6 Derived Data

```text
[ ] materialized view storage estimated
[ ] rollup cardinality calculated
[ ] rollup retention defined
[ ] freshness semantics documented
```

### 20.7 Backup/DR

```text
[ ] backup footprint estimated
[ ] snapshot temporary space included
[ ] restore time tested or estimated
[ ] RPO/RTO documented
[ ] cold storage lifecycle defined
```

### 20.8 Headroom

```text
[ ] operational headroom factor applied
[ ] disk watermarks defined
[ ] expansion lead time known
[ ] scaling procedure documented
```

---

## 21. Practical Capacity Planning Template

Use this as a starting spreadsheet model.

```text
Table name:
Owner:
Use case:

Ingest:
- normal rows/sec:
- peak rows/sec:
- burst duration:
- backfill rows/sec:

Schema:
- fixed bytes/row estimate:
- string bytes/row avg:
- symbol columns:
- indexed columns:
- measured bytes/row:

Partition:
- partition unit:
- rows/partition:
- size/partition:

Retention:
- hot retention:
- warm retention:
- cold retention:
- TTL:

Derived data:
- materialized views:
- rollup rows/day:
- MV storage/day:

WAL:
- normal ingest bytes/sec:
- peak ingest bytes/sec:
- WAL headroom hours:
- WAL headroom bytes:

Backup:
- backup type:
- backup factor:
- restore target time:

Total:
- hot table footprint:
- index overhead:
- MV footprint:
- WAL headroom:
- backup footprint:
- operational headroom:
- total required:

Risks:
- cardinality risk:
- O3 risk:
- backfill risk:
- disk expansion risk:
```

---

## 22. Worked Mini Example: From Java Event Contract to Disk

Java event:

```java
record MachineMetric(
    Instant observedAt,
    String tenantId,
    String siteId,
    String machineId,
    String metric,
    double value,
    byte quality
) {}
```

Expected workload:

```text
machines = 25,000
metrics/machine = 12
sample interval = 5 seconds
```

Rows/sec:

```text
25,000 × 12 × 0.2 = 60,000 rows/sec
```

Rows/day:

```text
60,000 × 86,400 = 5.184B rows/day
```

Schema estimate:

```text
ts          8
value       8
quality     1
symbol refs tenant/site/machine/metric ≈ estimate 16–32 total
metadata/null/index amortized ≈ 15–30
```

Effective bytes/row estimate:

```text
70–90 bytes/row until measured
```

Daily base:

```text
5.184B × 80 = 414.72GB decimal ≈ 386GiB/day
```

30-day hot:

```text
~11.3TiB base
```

Add index/MV/backup/headroom and realistic production footprint may exceed:

```text
30–50TiB
```

This is why early capacity planning matters.

---

## 23. Final Mental Model

Storage capacity planning for QuestDB is not a one-line multiplication.

It is a chain:

```text
domain event rate
→ row model
→ schema width
→ symbol/cardinality profile
→ partition size
→ WAL pressure
→ index/MV overhead
→ retention lifecycle
→ backup/DR footprint
→ operational headroom
```

The strongest engineers do not ask:

```text
How much data will we store?
```

They ask:

```text
At what rate will data arrive?
How wide is each fact?
How many identities exist?
How long must each layer live?
What query SLA does each layer serve?
How much failure and replay headroom do we need?
How will we prove this with measurement?
```

That is the difference between a prototype TSDB and a production time-series platform.

---

## 24. Ringkasan

Di part ini kita mempelajari:

1. Storage time-series adalah rate problem.
2. Rows/sec dan bytes/row harus dihitung bersama.
3. `SYMBOL`, string, index, WAL, MV, backup, dan headroom bisa mengubah footprint secara drastis.
4. Partition size adalah boundary fisik untuk query, TTL, O3, backup, dan lifecycle.
5. WAL storage harus direncanakan sebagai safety buffer, bukan dianggap temporary detail.
6. Materialized view bisa mempercepat query tetapi menambah storage dan refresh cost.
7. Java producer harus ikut mengontrol dimension, payload size, timestamp, duplicate, dan late arrival.
8. Empirical measurement dengan representative dataset wajib sebelum production commitment.
9. Disk headroom adalah reliability feature.
10. Capacity planning yang baik menghasilkan keputusan schema, partition, retention, backup, dan scaling yang defensible.

---

## 25. Berikutnya

Part berikutnya:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-020.md
Deployment Models: Local, Bare Metal, VM, Kubernetes, and Production Topology
```

Kita akan membahas bagaimana menjalankan QuestDB sebagai service produksi: Docker/local dev, bare metal, VM, Kubernetes, filesystem, NVMe, page cache, container memory, volume, backup path, dan kapan Kubernetes justru bukan pilihan awal terbaik.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-018.md">⬅️ Part 018 — Retention, TTL, Parquet, and Hot/Warm/Cold Lifecycle</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-020.md">Part 020 — Deployment Models: Local, Bare Metal, VM, Kubernetes, and Production Topology ➡️</a>
</div>

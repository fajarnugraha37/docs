# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-018.md

# Part 018 — Retention, TTL, Parquet, and Hot/Warm/Cold Lifecycle

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: lifecycle data time-series di QuestDB: retention, TTL, partition lifecycle, Parquet conversion, hot/warm/cold storage, cost model, regulatory retention, dan production runbook.

---

## 1. Tujuan Part Ini

Setelah part ini, kamu harus bisa:

1. Mendesain retention policy sebagai bagian dari arsitektur, bukan cleanup belakangan.
2. Memahami kenapa time-series retention hampir selalu harus berbasis partition, bukan row-by-row delete.
3. Memilih TTL yang cocok dengan partition granularity.
4. Membedakan hot, warm, dan cold data secara operasional.
5. Memahami kapan native QuestDB storage cocok dan kapan historical partition perlu dikonversi ke Parquet.
6. Mendesain lifecycle raw table, rollup table, dan materialized view.
7. Membuat policy yang selaras dengan biaya storage, query latency, compliance, dan recovery.
8. Menghindari anti-pattern seperti menyimpan raw high-volume telemetry selamanya di hot SSD.

Part ini penting karena banyak sistem time-series gagal bukan saat ingest hari pertama, tetapi setelah 3–12 bulan ketika data volume, disk growth, query range, backup, dan retention mulai menjadi masalah nyata.

---

## 2. Problem yang Sedang Diselesaikan

Time-series data punya sifat berbeda dari data bisnis OLTP:

```text
Setiap detik sistem menghasilkan baris baru.
Sebagian besar baris tidak akan pernah diupdate.
Nilai historis makin lama makin jarang diakses.
Query terbaru butuh cepat.
Query historis boleh lebih lambat, tetapi tetap harus mungkin.
Sebagian data harus dihapus karena biaya atau regulasi.
Sebagian data justru harus disimpan lama karena audit/compliance.
```

Masalahnya bukan hanya: “berapa lama data disimpan?”

Masalah sebenarnya:

```text
lifecycle = ingestion rate
          + partition layout
          + query pattern
          + retention requirement
          + storage cost
          + backup cost
          + regulatory obligation
          + cold access expectation
          + operational safety
```

Tanpa lifecycle design, sistem akan mengalami:

- disk penuh;
- query dashboard melambat karena scan historis;
- backup terlalu besar;
- restore terlalu lama;
- TTL menghapus data yang masih dibutuhkan;
- regulatory data hilang terlalu cepat;
- raw data bertahan selamanya tanpa nilai bisnis;
- migration ke cold storage dilakukan saat incident, bukan saat desain.

---

## 3. Mental Model Utama

Time-series data harus dipikirkan sebagai **data with temperature**.

```text
hot data   = baru, sering ditulis, sering dibaca, latency-sensitive
warm data  = tidak lagi ditulis, masih kadang dibaca, query boleh sedikit lebih lambat
cold data  = historis, jarang dibaca, lebih penting murah dan interoperable
expired    = tidak boleh/ tidak perlu disimpan lagi
```

Di QuestDB, boundary natural lifecycle adalah **time partition**.

```text
partition = physical lifecycle unit
```

Karena itu, retention yang sehat biasanya berbentuk:

```text
raw high-resolution data:
  keep hot for N days/weeks
  optionally convert older partitions to Parquet
  eventually drop after retention window

rollup / aggregate data:
  keep much longer
  lower row count
  lower storage cost
  useful for long-range analytics
```

Prinsip utama:

```text
Do not retain all data at the highest resolution forever unless the business can justify it.
```

---

## 4. QuestDB Lifecycle Primitives

QuestDB menyediakan beberapa primitive penting untuk lifecycle:

1. **Time partitioning**
   - Data dipisahkan secara fisik berdasarkan interval waktu.
   - Query range bisa melewati partition yang tidak relevan.
   - Retention bisa dilakukan dengan drop partition.

2. **TTL / Time To Live**
   - Retention otomatis berdasarkan usia data.
   - QuestDB menghapus partition yang sepenuhnya berada di luar retention window.

3. **Partition detach / attach / drop**
   - Memungkinkan operasi lifecycle di level partition.
   - Berguna untuk backup, restore, quarantine, atau migration.

4. **Parquet conversion**
   - Partition lama dapat dikonversi ke format Parquet.
   - Cocok untuk cold historical data, compression, interoperability, dan downstream analytics.

5. **Materialized views / rollups**
   - Data raw bisa diringkas menjadi resolusi lebih rendah.
   - Rollup bisa disimpan lebih lama dibanding raw.

6. **Storage policy**
   - Pada edisi tertentu, lifecycle dapat diotomasi lebih jauh, misalnya konversi Parquet atau pengelolaan local/object storage.

---

## 5. Retention Is Not Deletion

Retention sering disalahpahami sebagai:

```text
hapus data lama
```

Itu terlalu sempit.

Retention adalah jawaban atas pertanyaan:

```text
Untuk setiap jenis data:
- berapa lama disimpan?
- dalam resolusi apa?
- di media apa?
- untuk query apa?
- dengan latency berapa?
- dengan backup/recovery requirement apa?
- dengan constraint hukum apa?
```

Contoh:

```text
raw_sensor_readings:
  hot native: 30 hari
  cold parquet: 365 hari
  aggregate_1m: 3 tahun
  aggregate_1h: 7 tahun

trade_ticks:
  hot native: 14 hari
  cold parquet: 7 tahun
  ohlc_1m: 7 tahun
  audit_corrections: 7 tahun

app_metrics:
  raw: 7 hari
  1m rollup: 90 hari
  1h rollup: 1 tahun
```

Ini bukan sekadar storage policy. Ini product/operations/legal decision.

---

## 6. TTL and Partition Granularity

TTL di time-series database yang sehat bekerja efektif bila selaras dengan partition.

Misalnya:

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    tenant SYMBOL,
    device_id SYMBOL,
    metric SYMBOL,
    value DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY
TTL 30 DAYS;
```

Dengan `PARTITION BY DAY`, TTL 30 hari berarti QuestDB bisa menjatuhkan partition harian yang sepenuhnya sudah lebih tua dari window.

Namun penting:

```text
TTL operates cleanly when whole partitions expire.
```

Kalau partition terlalu besar dibanding TTL:

```text
PARTITION BY MONTH
TTL 7 DAYS
```

maka partition bulanan tidak bisa langsung dibuang sampai seluruh partition keluar dari window. Akibatnya data bisa tersimpan lebih lama dari yang kamu kira.

### Rule of thumb

```text
TTL window should be significantly larger than partition size.
```

Contoh sehat:

| Data | Partition | TTL | Reasoning |
|---|---:|---:|---|
| high-volume ticks | HOUR | 7–30 days | drop granular, smaller hot partitions |
| IoT sensor | DAY | 30–365 days | manageable daily lifecycle |
| low-volume audit metric | MONTH | 3–7 years | fewer partitions, long retention |
| rollup hourly | MONTH | years | low row count, long-range analytics |

### Hidden implication

Partition granularity adalah keputusan retention juga, bukan hanya query performance.

---

## 7. Native Storage vs Parquet

QuestDB native storage cocok untuk:

- hot ingestion;
- recent query;
- low-latency SQL;
- active partitions;
- frequent dashboard/API queries;
- O3/later arrival handling;
- high-throughput write path.

Parquet cocok untuk:

- older partitions;
- cold/historical data;
- compression;
- interoperability dengan Spark, DuckDB, Pandas, lakehouse tooling;
- lower storage cost;
- long-term archive;
- analytical scan yang tidak latency-critical.

Mental model:

```text
native QuestDB format = operational serving format
Parquet = historical analytical/archive format
```

Tapi jangan salah: cold tidak berarti tidak bisa diquery. Partition Parquet tetap bisa menjadi bagian dari query, tetapi kamu harus menganggap latency/behavior-nya sebagai bagian dari cold access model.

---

## 8. Hot / Warm / Cold Lifecycle Pattern

### 8.1 Hot data

Karakteristik:

- masih menerima write;
- query dashboard/API sering mengenai data ini;
- freshness penting;
- latency penting;
- berada di native QuestDB format;
- berada di fast local SSD;
- mungkin masih terkena out-of-order merge.

Contoh:

```text
last 24h metrics
last 7d ticks
current month IoT readings
```

Design concern:

- ingestion throughput;
- WAL health;
- O3 overhead;
- memory pressure;
- query concurrency;
- p95/p99 latency.

### 8.2 Warm data

Karakteristik:

- jarang menerima write;
- masih cukup sering dibaca;
- bisa tetap native atau mulai dikonversi;
- query latency boleh lebih tinggi;
- cocok untuk recent historical analytics.

Contoh:

```text
last 30–90 days raw data
last quarter trading ticks
last 6 months industrial readings
```

Design concern:

- partition pruning;
- compression;
- dashboard range guardrail;
- rollup availability.

### 8.3 Cold data

Karakteristik:

- tidak menerima write;
- jarang dibaca;
- query cenderung ad hoc/batch;
- lebih penting murah dan portable;
- sering cocok untuk Parquet/object storage.

Contoh:

```text
1–7 year historical data
regulatory archive
offline ML training set
historical strategy research
```

Design concern:

- cost;
- compliance;
- immutability;
- restore/requery path;
- metadata catalog;
- object storage durability;
- validation checksum.

---

## 9. Raw vs Rollup Retention

Time-series retention hampir selalu harus multi-resolution.

Raw data mahal karena row count tinggi.
Rollup data murah karena row count lebih rendah.

Contoh:

```text
Raw sensor data:
  10,000 devices × 1 metric/sec = 864M rows/day

1-minute rollup:
  10,000 devices × 1 metric/min = 14.4M rows/day

1-hour rollup:
  10,000 devices × 1 metric/hour = 240K rows/day
```

Ini bukan optimisasi kecil. Ini perbedaan eksistensial.

Retention policy yang sehat:

```text
raw_1s       keep 14–30 days
agg_1m       keep 1–2 years
agg_1h       keep 3–7 years
agg_1d       keep forever / regulatory horizon
```

### Query routing implication

A Java API tidak boleh selalu query raw table.

Ia harus memilih source berdasarkan range dan resolution:

```java
enum Resolution {
    RAW,
    ONE_MINUTE,
    ONE_HOUR,
    ONE_DAY
}

record TimeRange(Instant from, Instant to) {
    Duration length() {
        return Duration.between(from, to);
    }
}

Resolution chooseResolution(TimeRange range, Duration requestedStep) {
    if (range.length().compareTo(Duration.ofDays(2)) <= 0 && requestedStep.compareTo(Duration.ofSeconds(1)) <= 0) {
        return Resolution.RAW;
    }
    if (range.length().compareTo(Duration.ofDays(90)) <= 0) {
        return Resolution.ONE_MINUTE;
    }
    if (range.length().compareTo(Duration.ofDays(365 * 2)) <= 0) {
        return Resolution.ONE_HOUR;
    }
    return Resolution.ONE_DAY;
}
```

This is product architecture, not only database tuning.

---

## 10. Designing a Retention Matrix

Untuk setiap table, buat retention matrix.

Contoh:

| Table | Resolution | Hot native | Warm native | Parquet/cold | Drop after | Query purpose |
|---|---:|---:|---:|---:|---:|---|
| `raw_ticks` | event | 7d | 30d | 7y | 7y | forensic, trading replay |
| `ohlc_1m` | 1m | 90d | 1y | 7y | 7y | chart/API |
| `sensor_raw` | 1s | 14d | 90d | 1y | 1y | troubleshooting |
| `sensor_1m` | 1m | 180d | 2y | 7y | 7y | reporting |
| `app_metric_raw` | 10s | 7d | 30d | none | 30d | recent debugging |
| `app_metric_5m` | 5m | 90d | 1y | none | 1y | SLO trend |

Checklist untuk matrix:

```text
[ ] Ada owner bisnis untuk retention?
[ ] Ada alasan menyimpan raw selama window tersebut?
[ ] Ada rollup yang menggantikan raw untuk query panjang?
[ ] Ada regulatory minimum retention?
[ ] Ada privacy maximum retention?
[ ] Ada proses deletion/drop yang teruji?
[ ] Ada restore/requery process untuk cold data?
[ ] Ada biaya storage dan backup yang dihitung?
```

---

## 11. Regulatory and Compliance Retention

Dalam sistem enterprise/regulatory, retention bukan hanya biaya.

Ada dua arah constraint:

### 11.1 Minimum retention

Data harus disimpan minimal N tahun.

Contoh:

```text
market data audit trail: 5–7 years
case lifecycle event: years
machine quality telemetry: product warranty period
financial compliance signal: statutory period
```

### 11.2 Maximum retention

Data tidak boleh disimpan lebih lama dari kebutuhan.

Contoh:

```text
personal data
location telemetry
sensitive customer behavior
employee monitoring data
```

### 11.3 Design implication

Retention harus menjadi metadata formal:

```yaml
table: device_location_events
data_classification: personal_data
raw_retention: 30d
rollup_retention: 365d
cold_archive: disabled
legal_hold_supported: true
deletion_unit: tenant + time partition
owner: platform-observability
```

Kalau kamu tidak bisa menjelaskan retention table, kamu belum production-ready.

---

## 12. Legal Hold and Deletion Exceptions

TTL otomatis bagus, tapi compliance kadang membutuhkan exception:

- legal hold untuk tenant tertentu;
- investigation window;
- audit preservation;
- customer deletion request;
- regulator request;
- data quarantine.

Masalahnya: QuestDB partition biasanya berbasis waktu, bukan tenant.

Kalau kamu butuh delete tenant-specific data dalam shared table, kamu harus desain dari awal.

Pilihan:

1. **tenant column in shared table**
   - murah secara operasional;
   - susah tenant-specific physical deletion;
   - query butuh tenant filter wajib.

2. **table per tenant**
   - lifecycle tenant-specific lebih mudah;
   - banyak table;
   - schema governance lebih berat.

3. **database/instance per tenant**
   - isolasi kuat;
   - biaya lebih tinggi;
   - operasional kompleks.

4. **tenant class sharding**
   - kompromi untuk high-value tenant atau regulated tenant.

Regulatory lifecycle sering menentukan data model.

---

## 13. Lifecycle for Backfill and Replay

Historical backfill jangan dicampur sembarangan dengan hot lifecycle.

Contoh salah:

```text
Live ingestion sedang menulis partition hari ini.
Backfill 3 tahun data masuk bersamaan tanpa sorting.
TTL aktif.
Materialized view refresh ikut tertinggal.
Disk naik cepat.
WAL apply lag besar.
Dashboard fresh data terganggu.
```

Pattern lebih sehat:

```text
1. Load historical data ke staging table.
2. Sort/batch by timestamp and partition.
3. Validate counts, min/max timestamp, dedup ratio.
4. Attach/import into production table or controlled insert.
5. Convert older partitions to Parquet if needed.
6. Refresh/rebuild derived tables.
7. Enable/verify TTL after data placement.
```

Backfill lifecycle harus punya isolation.

---

## 14. Parquet Conversion Strategy

Parquet conversion sebaiknya dilakukan pada partition yang:

- sudah tidak aktif;
- tidak lagi menerima frequent late writes;
- tidak menjadi target dashboard low-latency;
- cukup besar untuk compression benefit;
- masuk cold/warm policy.

Pseudo-policy:

```text
if partition_age > 30 days
and late_arrival_probability is low
and query_latency_sla is relaxed
then convert partition to Parquet
```

Contoh SQL konseptual:

```sql
ALTER TABLE trades
CONVERT PARTITION TO PARQUET
WHERE timestamp < dateadd('d', -30, now());
```

Setelah conversion, monitor:

```sql
SHOW PARTITIONS FROM trades;
```

Hal yang harus dipahami:

```text
active/latest partition should stay native
old stable partitions are better cold candidates
conversion is operational work, not free magic
```

---

## 15. Object Storage and Cold Tier Thinking

Cold tier sering berarti object storage:

- S3;
- GCS;
- Azure Blob;
- MinIO/on-prem object storage.

Object storage bagus untuk:

- durability;
- low cost per TB;
- external analytics;
- historical archive;
- decoupling compute/storage.

Namun object storage buruk untuk:

- tiny random reads;
- low-latency dashboard;
- high-frequency mutation;
- write-heavy hot partition;
- operational debugging yang butuh immediate scan.

Mental model:

```text
object storage is not just cheaper disk.
it is a different access model.
```

Karena itu jangan pindahkan data ke object storage tanpa menjawab:

```text
Siapa yang akan query?
Berapa sering?
Lewat QuestDB atau Spark/DuckDB/Pandas?
Apa latency yang diterima?
Bagaimana metadata ditemukan?
Bagaimana permission dikelola?
Bagaimana data divalidasi?
```

---

## 16. Capacity Planning for Lifecycle

Lifecycle design harus punya angka.

Minimal hitung:

```text
rows_per_second
× seconds_per_day
× bytes_per_row
× retention_days
× replication_factor / backup_factor
× compression_factor
```

Contoh kasar:

```text
100,000 rows/sec
× 86,400 sec/day
= 8.64B rows/day

Jika effective 40 bytes/row:
= 345.6 GB/day raw-ish

30 hari hot:
= ~10.3 TB

Dengan WAL, filesystem overhead, backup, index/symbol overhead:
planning mungkin 15–25 TB
```

Ini sebelum cold archive.

### Lifecycle effect

Kalau raw hanya 7 hari:

```text
~2.4 TB base instead of ~10.3 TB
```

Kalau 1m rollup menggantikan long-range query:

```text
storage turun orders of magnitude
query latency turun drastis
backup lebih masuk akal
```

---

## 17. Backup and Restore Implication

Semakin panjang hot native retention, semakin besar backup surface.

Pertanyaan yang harus dijawab:

```text
Apakah semua raw data perlu masuk backup cepat?
Apakah cold Parquet sudah cukup durable di object storage?
Apakah restore butuh semua data atau hanya hot serving window?
Berapa RTO jika 20 TB harus restore?
Apakah materialized views bisa rebuild dari raw/cold?
Apakah rollup harus dibackup atau bisa regenerate?
```

Pattern umum:

```text
hot native data:
  snapshot/replication, fast recovery

cold parquet:
  object storage lifecycle/versioning, slower recovery

derived rollups:
  backup if expensive to rebuild, otherwise regenerate
```

Jangan desain retention tanpa DR design.

---

## 18. Java Service Lifecycle Responsibilities

Aplikasi Java biasanya bertanggung jawab untuk:

1. Menyertakan timestamp yang benar.
2. Mengirim data ke table yang benar.
3. Memvalidasi tenant/metric/cardinality.
4. Tidak query raw untuk long range.
5. Memilih table/resolution berdasarkan request.
6. Menyediakan API metadata tentang data availability.
7. Menolak query di luar retention.
8. Menjelaskan partial availability ke client.

Contoh response API sehat:

```json
{
  "metric": "cpu_usage",
  "from": "2026-01-01T00:00:00Z",
  "to": "2026-06-01T00:00:00Z",
  "resolution": "1h",
  "source": "metric_1h_rollup",
  "rawAvailableFrom": "2026-05-01T00:00:00Z",
  "note": "raw data is retained for 30 days; older range served from rollup"
}
```

Ini jauh lebih baik daripada diam-diam query raw, timeout, lalu menyalahkan database.

---

## 19. Query Semantics Across Lifecycle

Lifecycle mengubah query semantics.

### 19.1 Raw query

```text
exact event/sample-level data
high row count
short range only
```

### 19.2 Rollup query

```text
aggregated values
lower row count
long range
may lose detail
```

### 19.3 Cold Parquet query

```text
historical data
possibly slower
maybe used for offline analytics
```

API harus eksplisit:

```text
resolution requested
resolution returned
aggregation method
source table/view
freshness
coverage
```

Jangan mencampur raw dan rollup tanpa metadata.

---

## 20. Failure Modes

### 20.1 TTL deletes data unexpectedly

Cause:

- wrong TTL;
- wrong partition granularity;
- misunderstanding retention window;
- using event time that is wrong/skewed;
- staging table accidentally has TTL.

Mitigation:

- retention matrix;
- dry-run partition listing;
- backup before policy change;
- monitoring for partition drop;
- approval workflow for DDL.

### 20.2 Disk full before TTL can help

Cause:

- retention too long;
- WAL backlog;
- large backfill;
- TTL not aligned to partition;
- active partition too large;
- no cold conversion.

Mitigation:

- disk growth alert;
- WAL size alert;
- partition size monitoring;
- emergency ingestion throttle;
- emergency partition drop policy.

### 20.3 Historical query melts hot node

Cause:

- dashboard allows 5-year raw query;
- no rollup;
- no query guardrail;
- cold data served from same node without control.

Mitigation:

- API max range;
- resolution routing;
- materialized views;
- separate analytics path;
- query timeout/resource limits.

### 20.4 Parquet conversion too aggressive

Cause:

- converting partitions still receiving late data;
- converting data still needed for low-latency queries;
- no validation after conversion.

Mitigation:

- conversion age threshold;
- late arrival analysis;
- staged conversion;
- `SHOW PARTITIONS` checks;
- query benchmark before/after.

### 20.5 Compliance violation

Cause:

- data retained longer than allowed;
- data deleted earlier than required;
- no legal hold mechanism;
- shared tenant table prevents deletion.

Mitigation:

- classification;
- formal retention policy;
- legal hold design;
- audit log for lifecycle actions;
- tenant isolation review.

---

## 21. Anti-Patterns

### Anti-pattern 1: “Storage is cheap, keep everything raw forever”

This fails when backup, restore, query, compliance, and operational cost are included.

### Anti-pattern 2: TTL added after disk incident

TTL should be part of table design, not emergency patch.

### Anti-pattern 3: Partition granularity chosen only by ingest rate

Partition is also lifecycle unit.

### Anti-pattern 4: Rollups treated as optional

For long-range dashboards, rollups are often core architecture.

### Anti-pattern 5: Cold storage without access path

Data archived but no one knows how to query, validate, or restore it.

### Anti-pattern 6: Shared table for tenants with strict deletion needs

Cheap now, expensive during regulatory request.

### Anti-pattern 7: Raw and rollup mixed without metadata

Users get charts but cannot tell what resolution or aggregation they are seeing.

---

## 22. Production Lifecycle Checklist

Before table goes production:

```text
[ ] What is the raw retention?
[ ] What is the rollup retention?
[ ] What partition granularity is used?
[ ] Is TTL aligned with partition size?
[ ] What is the estimated daily storage growth?
[ ] What is the hot storage capacity horizon?
[ ] What happens after hot retention expires?
[ ] Are old partitions converted to Parquet?
[ ] Is cold storage local or object storage?
[ ] Is backup strategy different for hot/cold data?
[ ] Is restore tested?
[ ] Are long-range queries routed to rollups?
[ ] Are API query ranges bounded?
[ ] Is retention documented per table?
[ ] Is there legal/compliance approval?
[ ] Is there monitoring for partition count/size/drops?
[ ] Is emergency disk-full runbook defined?
```

---

## 23. Hands-On Lab

Design lifecycle for this workload:

```text
Workload:
- 50,000 devices
- each device emits 5 metrics every 10 seconds
- dashboard needs last 24h at raw resolution
- product reporting needs 1 year at 1-minute resolution
- compliance requires 3 years daily aggregates
- raw data older than 30 days is not useful
```

Questions:

1. How many raw rows per day?
2. What tables would you create?
3. What partitioning would each table use?
4. What TTL would each table use?
5. Which table powers dashboard last 24h?
6. Which table powers 1-year report?
7. Which table powers compliance report?
8. Would you convert anything to Parquet?
9. What query guardrails should Java API enforce?

Suggested answer outline:

```text
raw_device_metrics:
  partition by DAY
  TTL 30 DAYS
  native hot storage

metric_1m_rollup:
  partition by MONTH
  TTL 1–2 YEARS
  maybe native/warm, maybe Parquet after 90d

metric_1d_rollup:
  partition by YEAR
  TTL 3–7 YEARS depending compliance
  cold candidate
```

Raw row estimate:

```text
50,000 devices × 5 metrics × 6 samples/min × 60 min/hour × 24 hour
= 2.16B rows/day
```

This is why rollup is not optional.

---

## 24. Summary

Retention di time-series adalah desain arsitektur, bukan cleanup task.

Key ideas:

```text
partition = physical lifecycle unit
TTL = automated partition expiration
raw data = expensive, short-lived unless justified
rollup data = cheaper, long-lived, query-friendly
Parquet = cold/interoperable historical format
hot/warm/cold = access pattern + cost + latency model
```

QuestDB sangat kuat ketika lifecycle dipakai sesuai bentuk alaminya:

```text
high-throughput native hot ingestion
+ time partitioning
+ bounded temporal SQL
+ rollups/materialized views
+ Parquet/cold lifecycle for historical data
```

Tetapi QuestDB tidak bisa menyelamatkan desain yang menyimpan semua raw data selamanya, membiarkan dashboard query 5 tahun raw range, dan baru berpikir retention setelah disk penuh.

Production invariant:

```text
Every time-series table must have a lifecycle policy before it receives production data.
```

---

## 25. Next Part

Selanjutnya:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-019.md
Storage Capacity Planning
```

Part berikutnya akan menghitung storage dari first principles: rows/sec, bytes/row, symbol overhead, WAL overhead, partition growth, disk sizing, SSD endurance, backup multiplier, compression, Parquet savings, dan capacity planning spreadsheet mental model.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-017.md">⬅️ Indexes, Symbols, Cardinality, and Lookup Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-019.md">Storage Capacity Planning ➡️</a>
</div>

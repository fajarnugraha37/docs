# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-005.md

# Part 005 — Partitioning: The Physical Boundary of Time

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita membahas data model QuestDB: designated timestamp, `SYMBOL`, tipe data, dan bentuk table. Sekarang kita masuk ke keputusan fisik pertama yang paling penting di QuestDB: **partitioning**.

Di banyak database, partitioning sering dianggap fitur administratif: cara membagi table besar agar mudah dikelola. Di time-series database, partitioning jauh lebih fundamental. Ia adalah boundary fisik untuk:

- query pruning;
- retention;
- write amplification;
- out-of-order ingestion;
- WAL apply behavior;
- backup/restore;
- cold storage;
- operational incident blast radius;
- dan biaya disk jangka panjang.

Dalam QuestDB, partitioning bukan dekorasi. Untuk workload time-series yang benar, partitioning adalah bagian dari model data.

Dokumentasi QuestDB menjelaskan bahwa table partitioned disimpan sebagai interval waktu terpisah di disk. Pemisahan fisik ini memungkinkan QuestDB melewati time range yang tidak relevan saat query dan mengelola lifecycle data secara efisien.

---

## 1. Tujuan Part Ini

Setelah part ini, kamu harus bisa:

1. Menjelaskan kenapa partitioning di TSDB adalah boundary fisik waktu, bukan sekadar teknik scale-out.
2. Memilih `PARTITION BY HOUR`, `DAY`, `WEEK`, `MONTH`, atau `YEAR` dengan reasoning produksi.
3. Memahami hubungan antara designated timestamp, partition assignment, partition pruning, dan query latency.
4. Mendesain retention menggunakan TTL/drop partition tanpa expensive delete.
5. Memprediksi efek out-of-order data terhadap partition rewrite/split/squash.
6. Membedakan hot partition, warm partition, dan cold partition.
7. Membuat checklist partitioning sebelum table dipakai di production.

---

## 2. Problem Yang Sedang Diselesaikan

Bayangkan kamu memiliki telemetry table:

```sql
CREATE TABLE machine_readings (
    ts TIMESTAMP,
    site SYMBOL,
    line SYMBOL,
    machine_id SYMBOL,
    sensor SYMBOL,
    value DOUBLE,
    quality SYMBOL
) TIMESTAMP(ts)
PARTITION BY DAY;
```

Data masuk 2 juta row per menit. Query dashboard biasanya membaca 15 menit terakhir. Compliance meminta raw data disimpan 180 hari. Kadang device offline mengirim data tertunda 3 hari. Kadang backfill historis 2 tahun perlu dimasukkan ulang.

Pertanyaan yang harus dijawab:

- Apakah partition by day cukup?
- Apakah partition by hour lebih baik?
- Apa efeknya ke query 15 menit terakhir?
- Apa efeknya ke delete data lama?
- Apa efeknya ke late-arriving data?
- Apa efeknya ke storage dan WAL apply?
- Apa yang terjadi saat backfill lama dilakukan bersamaan dengan live ingestion?

Di sinilah partitioning menjadi desain arsitektural, bukan sekadar SQL clause.

---

## 3. Mental Model Utama

### 3.1 Partition adalah folder waktu

Mental model sederhana:

```text
Table: machine_readings

machine_readings/
  2026-06-18/
    ts.d
    site.d
    machine_id.d
    value.d
    ...
  2026-06-19/
    ts.d
    site.d
    machine_id.d
    value.d
    ...
  2026-06-20/
    ts.d
    site.d
    machine_id.d
    value.d
    ...
```

QuestDB menyimpan partition sebagai interval waktu fisik. Query yang memfilter timestamp dapat melewati partition yang tidak mungkin berisi data relevan.

Query:

```sql
SELECT avg(value)
FROM machine_readings
WHERE ts >= '2026-06-20T10:00:00.000000Z'
  AND ts <  '2026-06-20T10:15:00.000000Z'
  AND machine_id = 'M-42';
```

Dengan `PARTITION BY DAY`, QuestDB hanya perlu melihat partition `2026-06-20`, bukan 180 hari penuh.

Dengan `PARTITION BY HOUR`, QuestDB mungkin hanya perlu melihat partition jam `10:00`.

Tetapi partition lebih kecil tidak selalu lebih baik. Terlalu banyak partition meningkatkan metadata overhead, file count, lifecycle complexity, dan operational noise.

### 3.2 Partition adalah pruning unit

Pruning berarti database tidak membaca data yang pasti tidak relevan.

Tanpa partition pruning:

```text
query 15 menit terakhir
→ scan banyak file lama
→ filter timestamp row-by-row
→ expensive
```

Dengan partition pruning:

```text
query 15 menit terakhir
→ tentukan partition waktu relevan
→ buka sedikit partition
→ scan column yang dibutuhkan
→ jauh lebih murah
```

Dalam TSDB, query sering bounded by time. Karena itu partitioning by time sangat efektif.

### 3.3 Partition adalah retention unit

Di OLTP biasa, retention sering berarti:

```sql
DELETE FROM events
WHERE ts < now() - interval '180 days';
```

Untuk table besar, delete seperti ini mahal karena menyentuh banyak row, index, MVCC, vacuum/compaction, dan lock behavior.

Di QuestDB, retention idealnya berupa drop partition:

```text
hapus partition utuh yang sudah melewati TTL
```

Ini jauh lebih murah karena boundary data sudah aligned dengan waktu.

QuestDB TTL bekerja dengan menghapus partition lama yang seluruhnya berada di luar retention window. Karena penghapusan dilakukan whole-partition, TTL harus selaras dengan ukuran partition.

### 3.4 Partition adalah write amplification boundary

Append ke partition terbaru biasanya murah.

Late insert ke partition lama lebih mahal karena engine harus menjaga data tersusun berdasarkan timestamp. Untuk out-of-order data, QuestDB dapat melakukan split/merge/rewrite pada partition yang terdampak. Semakin besar partition yang terkena dan semakin sering late data masuk, semakin besar potensi write amplification.

Jadi partition granularity memengaruhi biaya late-arriving data.

### 3.5 Partition adalah incident blast radius

Jika satu partition bermasalah, terlalu besar, terlalu panas, atau butuh operasi manual, ukuran partition menentukan blast radius.

```text
PARTITION BY MONTH
→ satu partition bisa berisi data sangat besar
→ operasi repair/backfill/convert/drop punya blast radius besar

PARTITION BY DAY
→ operasi lebih granular
→ lebih banyak partition
→ metadata/file count lebih besar
```

Desain partitioning selalu trade-off.

---

## 4. QuestDB Partitioning Basics

QuestDB mendukung partitioning berdasarkan interval waktu, umumnya:

```sql
PARTITION BY HOUR
PARTITION BY DAY
PARTITION BY WEEK
PARTITION BY MONTH
PARTITION BY YEAR
```

Contoh:

```sql
CREATE TABLE trades (
    ts TIMESTAMP,
    symbol SYMBOL,
    price DOUBLE,
    size DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY;
```

Elemen penting:

```text
TIMESTAMP(ts)
→ menetapkan designated timestamp

PARTITION BY DAY
→ menggunakan ts untuk menentukan partition fisik
```

Tanpa designated timestamp, table tidak dapat menjadi time-series table penuh. Tanpa partitioning, banyak fitur penting seperti WAL tidak tersedia untuk table tersebut.

QuestDB documentation menyatakan WAL membutuhkan partitioning; non-partitioned tables tidak bisa menggunakan WAL. Untuk table time-series production, ini berarti `PARTITION BY` seharusnya eksplisit, bukan dibiarkan kebetulan.

---

## 5. Designated Timestamp dan Partition Assignment

Setiap row punya timestamp utama:

```text
row.ts = 2026-06-20T10:32:45.123456Z
```

Jika table `PARTITION BY DAY`, row masuk ke:

```text
2026-06-20
```

Jika `PARTITION BY HOUR`, row masuk ke:

```text
2026-06-20T10
```

Jika `PARTITION BY MONTH`, row masuk ke:

```text
2026-06
```

Designated timestamp bukan hanya kolom biasa. Ia menentukan:

- partition fisik;
- timestamp ordering;
- temporal SQL semantics;
- pruning;
- TTL eligibility;
- out-of-order reconciliation boundary.

Inilah alasan part sebelumnya menekankan bahwa memilih timestamp adalah keputusan fisik.

---

## 6. Partition Granularity: HOUR vs DAY vs WEEK vs MONTH vs YEAR

### 6.1 `PARTITION BY HOUR`

Cocok untuk:

- ingest rate sangat tinggi;
- query window pendek;
- data retention pendek/menengah;
- late data biasanya dalam hitungan menit/jam;
- operational need untuk drop/convert partition kecil;
- market data atau high-frequency telemetry.

Kelebihan:

- pruning sangat tajam untuk query pendek;
- late data hanya memengaruhi partition kecil;
- drop data bisa lebih granular;
- hot partition lebih kecil;
- backfill bisa dipecah per jam.

Kekurangan:

- jumlah partition tinggi;
- file/directory count tinggi;
- metadata overhead lebih besar;
- operasi lifecycle lebih banyak;
- retention dalam tahun bisa menghasilkan ribuan partition.

Rule of thumb:

```text
Gunakan HOUR jika row volume per hari sangat besar dan query mayoritas sub-hour/hourly.
```

Contoh:

```sql
CREATE TABLE market_ticks (
    ts TIMESTAMP_NS,
    symbol SYMBOL,
    venue SYMBOL,
    price DOUBLE,
    size DOUBLE
) TIMESTAMP(ts)
PARTITION BY HOUR;
```

### 6.2 `PARTITION BY DAY`

Cocok untuk:

- default produksi paling umum;
- ingest rate sedang sampai tinggi;
- query window menit sampai hari;
- retention bulan sampai beberapa tahun;
- late data biasanya dalam hari;
- operational simplicity masih penting.

Kelebihan:

- balance antara pruning dan metadata overhead;
- TTL/drop partition natural untuk daily retention;
- cukup granular untuk banyak workload IoT/metrics;
- mudah dipahami operator.

Kekurangan:

- query 5 menit tetap membuka partition satu hari;
- late data 3 hari lalu dapat rewrite partition harian;
- partition harian bisa terlalu besar untuk very high ingest.

Rule of thumb:

```text
Gunakan DAY sebagai default awal untuk mayoritas telemetry dan event time-series.
```

Contoh:

```sql
CREATE TABLE app_metrics (
    ts TIMESTAMP,
    service SYMBOL,
    endpoint SYMBOL,
    status SYMBOL,
    latency_ms DOUBLE,
    count LONG
) TIMESTAMP(ts)
PARTITION BY DAY;
```

### 6.3 `PARTITION BY WEEK`

Cocok untuk:

- data volume rendah/sedang;
- query sering multi-day/multi-week;
- retention panjang;
- operational preference untuk lebih sedikit partition.

Kelebihan:

- lebih sedikit partition daripada day;
- cocok untuk low-volume business time-series;
- lifecycle lebih sederhana.

Kekurangan:

- pruning lebih kasar;
- late data rewrite lebih besar;
- TTL granularity kasar;
- kurang cocok untuk high ingest.

Rule of thumb:

```text
Gunakan WEEK hanya jika volume rendah dan query natural-nya mingguan.
```

### 6.4 `PARTITION BY MONTH`

Cocok untuk:

- data volume rendah;
- retention panjang;
- query sering bulanan/kuartalan;
- archival datasets;
- reference-like time-series.

Kelebihan:

- partition count rendah;
- mudah untuk long-term retention;
- cocok untuk reporting historis low-volume.

Kekurangan:

- query pendek tetap membuka partition besar;
- out-of-order rewrite berpotensi mahal;
- drop data granularity bulanan;
- risky untuk high-ingest raw telemetry.

Rule of thumb:

```text
Gunakan MONTH untuk low-volume historical/aggregated data, bukan raw high-frequency events.
```

### 6.5 `PARTITION BY YEAR`

Cocok untuk:

- sangat low-volume data;
- mostly archival;
- query sering multi-year;
- metadata minim lebih penting daripada pruning.

Kekurangan besar:

- pruning sangat kasar;
- TTL sangat kasar;
- late data rewrite blast radius sangat besar;
- operational operation per partition sangat berat bila volume besar.

Rule of thumb:

```text
YEAR hampir tidak cocok untuk raw high-volume time-series.
```

---

## 7. Decision Matrix Partitioning

Gunakan matrix ini sebagai starting point:

| Workload | Ingest Rate | Typical Query Window | Late Data | Retention | Suggested Partition |
|---|---:|---:|---:|---:|---|
| Market ticks | sangat tinggi | detik-menit-jam | rendah-menengah | minggu-bulan | HOUR |
| Industrial telemetry | tinggi | menit-jam-hari | jam-hari | bulan-tahun | DAY |
| App metrics | sedang-tinggi | menit-jam | menit-jam | minggu-bulan | DAY/HOUR |
| Aggregated metrics | rendah-sedang | hari-minggu | rendah | bulan-tahun | DAY/MONTH |
| Business status snapshots | rendah | hari-bulan | rendah | tahun | MONTH |
| Audit-like events | sedang | hari-bulan | rendah | tahun | DAY/MONTH |
| Backfilled historical data only | variabel | bulan-tahun | tidak relevan setelah load | panjang | MONTH/YEAR, tergantung volume |

Jangan jadikan matrix ini aturan absolut. Jadikan ia starting hypothesis lalu validasi dengan:

- row per partition;
- query latency target;
- retention boundary;
- late data distribution;
- file count;
- backfill strategy;
- storage lifecycle.

---

## 8. Query Pruning: Kenapa Predicate Timestamp Harus Jelas

Partitioning membantu hanya jika query memberi batas waktu yang bisa dipakai optimizer.

Baik:

```sql
SELECT avg(value)
FROM machine_readings
WHERE ts >= '2026-06-20T10:00:00.000000Z'
  AND ts <  '2026-06-20T11:00:00.000000Z';
```

Kurang ideal:

```sql
SELECT avg(value)
FROM machine_readings
WHERE machine_id = 'M-42';
```

Query kedua tidak punya time bound. QuestDB harus mempertimbangkan seluruh partition karena kamu tidak memberi batas temporal.

Anti-pattern umum dari aplikasi Java:

```java
// Bad: endpoint API membiarkan user query tanpa time range
GET /metrics?machineId=M-42
```

Lebih baik:

```java
GET /metrics?machineId=M-42&from=2026-06-20T10:00:00Z&to=2026-06-20T11:00:00Z
```

Aturan API:

```text
Time-series API harus punya bounded time range by default.
```

Jika user tidak memberi range, sistem harus menetapkan default window:

```text
last 15 minutes
last 1 hour
last 24 hours
```

Bukan seluruh history.

---

## 9. Retention dan TTL

### 9.1 Retention sebaiknya partition-aligned

Retention yang baik:

```text
PARTITION BY DAY
TTL 180 DAYS
```

Retention yang buruk:

```text
PARTITION BY MONTH
butuh hapus data lebih tua dari 45 hari secara presisi harian
```

Karena TTL menghapus partition utuh, retention window harus selaras dengan partition size. Jika partition terlalu kasar, data bisa tertahan lebih lama dari yang diinginkan atau TTL rule menjadi tidak valid.

QuestDB TTL menghapus data yang melewati TTL hanya per whole partition. Karena itu TTL period harus merupakan multiple dari ukuran partition.

### 9.2 TTL bukan delete row-by-row

Mental model:

```text
TTL check
→ partition seluruhnya expired?
→ drop partition
```

Bukan:

```text
scan rows
→ delete old rows
→ compact table
```

Konsekuensi:

- retention lebih murah;
- predictable;
- tidak perlu cron manual untuk kasus umum;
- tetapi granularity retention mengikuti partition.

### 9.3 Regulatory retention

Untuk domain regulated, retention bukan hanya biaya disk. Retention adalah kewajiban:

- minimum retention;
- maximum retention;
- legal hold;
- audit trail;
- data deletion policy;
- tenant-specific retention;
- data residency.

Jika tenant berbeda punya retention berbeda, ada dua opsi desain:

```text
Option A: tenant_id column dalam satu table
→ retention global table
→ sulit tenant-specific TTL

Option B: table per retention class / tenant class
→ retention lebih mudah
→ operational table count naik
```

Jangan menyembunyikan requirement retention di application layer. Ia harus masuk ke table design.

---

## 10. Hot, Warm, Cold Partition

Dalam production, partition tidak setara.

### 10.1 Hot partition

Hot partition adalah partition yang sedang aktif menerima write.

Contoh `PARTITION BY DAY`:

```text
2026-06-20 = hot partition
```

Karakteristik:

- append tinggi;
- WAL apply aktif;
- query dashboard sering membaca;
- data mungkin belum sepenuhnya stabil;
- late correction masih umum.

### 10.2 Warm partition

Warm partition adalah partition baru lewat dari hot window tetapi masih sering dibaca.

Contoh:

```text
last 7 days
```

Karakteristik:

- write rendah kecuali late arrival;
- query masih sering;
- cocok untuk native storage;
- bisa masuk rollup/materialized view.

### 10.3 Cold partition

Cold partition jarang dibaca, mostly retained.

Contoh:

```text
older than 90 days
```

Karakteristik:

- write hampir nol;
- query jarang;
- candidate untuk Parquet/cold storage;
- backup/archive lebih penting daripada low latency.

Partitioning adalah dasar untuk lifecycle ini.

---

## 11. Out-of-Order Data dan Partition Cost

### 11.1 Out-of-order adalah normal

Di distributed systems, data bisa terlambat karena:

- network delay;
- device offline;
- retry;
- batch upload;
- Kafka replay;
- clock skew;
- mobile edge nodes;
- cross-region ingestion;
- producer pause;
- historical backfill.

Jadi pertanyaannya bukan:

```text
Apakah data akan out-of-order?
```

Pertanyaannya:

```text
Seberapa jauh out-of-order?
Seberapa sering?
Berapa volume late rows?
Partition mana yang terdampak?
```

### 11.2 Append fast path

Jika data masuk roughly ascending by timestamp:

```text
incoming ts >= latest ts in hot partition
→ append path
→ murah
```

### 11.3 Late insert path

Jika data masuk ke waktu lama:

```text
incoming ts < current max timestamp
→ out-of-order handling
→ partition may need split/merge/rewrite
→ lebih mahal
```

QuestDB mendokumentasikan bahwa saat out-of-order data datang, engine menyusun ulang data untuk menjaga timestamp order, membagi partition untuk mengurangi write amplification, dan melakukan compact di background.

### 11.4 Partition granularity dan late data

Misal late data 3 jam terlambat.

Dengan `PARTITION BY DAY`:

```text
late data masih dalam partition hari ini
→ rewrite/sort scope = daily partition region
```

Dengan `PARTITION BY HOUR`:

```text
late data masuk partition jam terkait
→ scope lebih kecil
```

Tetapi jika late data sering 3 hari terlambat:

```text
PARTITION BY HOUR
→ banyak partition lama bisa disentuh
→ operational complexity naik

PARTITION BY DAY
→ lebih sedikit partition tersentuh
→ masing-masing lebih besar
```

Tidak ada jawaban universal. Harus lihat distribusi late data.

---

## 12. Backfill dan Live Ingestion

Backfill adalah musuh alami hot-path ingestion jika tidak didesain.

Skenario buruk:

```text
live ingestion: now()
backfill: data 2 tahun lalu
same table
same time
high volume
```

Dampak:

- banyak partition lama dibuka;
- write amplification tinggi;
- WAL apply bisa tertinggal;
- disk I/O berebut dengan live ingestion;
- query freshness bisa menurun;
- operator sulit membedakan masalah live vs historical load.

Strategi lebih aman:

### 12.1 Backfill ke staging table

```sql
CREATE TABLE readings_backfill (
    ts TIMESTAMP,
    site SYMBOL,
    machine_id SYMBOL,
    sensor SYMBOL,
    value DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY;
```

Lalu validasi:

```sql
SELECT count(), min(ts), max(ts)
FROM readings_backfill;
```

Setelah valid, merge atau query union-like pattern sesuai kebutuhan.

### 12.2 Backfill partition by partition

```text
load 2024-01-01
validate
load 2024-01-02
validate
...
```

Keuntungan:

- blast radius kecil;
- progress bisa diulang;
- mudah pause/resume;
- lebih mudah reconcile.

### 12.3 Sort before ingest

Jika memungkinkan, load data ascending by timestamp. Komunitas QuestDB juga menekankan bahwa ascending chunks jauh lebih cepat daripada out-of-order ingestion karena O3 membutuhkan split/rewrite partition.

---

## 13. Java Engineer Perspective

### 13.1 Partitioning memengaruhi API contract

API query time-series harus memaksa time range:

```java
record TimeRange(Instant fromInclusive, Instant toExclusive) {
    TimeRange {
        if (!fromInclusive.isBefore(toExclusive)) {
            throw new IllegalArgumentException("from must be before to");
        }
        Duration max = Duration.ofDays(7);
        if (Duration.between(fromInclusive, toExclusive).compareTo(max) > 0) {
            throw new IllegalArgumentException("time range too large");
        }
    }
}
```

Jangan biarkan controller membuat SQL tanpa bound:

```java
// Bad
String sql = "SELECT * FROM readings WHERE machine_id = $1";
```

Lebih aman:

```java
String sql = """
    SELECT ts, machine_id, sensor, value
    FROM readings
    WHERE ts >= $1
      AND ts <  $2
      AND machine_id = $3
    ORDER BY ts
    """;
```

### 13.2 Producer harus aware terhadap event time

Producer tidak boleh mengirim `Instant.now()` sebagai timestamp jika event sebenarnya terjadi 10 menit lalu.

Bad:

```java
sender.table("readings")
    .symbol("machine_id", machineId)
    .doubleColumn("value", value)
    .atNow();
```

Better:

```java
sender.table("readings")
    .symbol("machine_id", machineId)
    .doubleColumn("value", value)
    .at(eventTimestampMicros, ChronoUnit.MICROS);
```

`atNow()` hanya benar jika observation time memang sama dengan ingestion time.

### 13.3 Backpressure harus mempertimbangkan WAL lag

Dari sisi aplikasi, ingestion sukses belum selalu berarti data sudah query-visible jika WAL apply tertinggal. Maka observability aplikasi harus memisahkan:

```text
producer sent rows
QuestDB accepted rows
WAL apply caught up
query sees rows
```

Freshness SLO harus mengukur end-to-end:

```text
now - max(ts visible in table)
```

Bukan hanya HTTP/TCP success dari client.

---

## 14. Operational Design Implications

### 14.1 Partition size target

Pertanyaan praktis:

```text
Berapa row per partition?
Berapa GB per partition?
Berapa file per partition?
Berapa lama operasi drop/convert/backup partition?
```

Rule of thumb konseptual:

```text
Partition harus cukup besar agar metadata overhead tidak mendominasi,
tetapi cukup kecil agar pruning, retention, recovery, dan O3 cost tetap terkendali.
```

### 14.2 Query window harus dibandingkan dengan partition size

Jika query umum 5 menit dan partition monthly, pruning hampir tidak membantu.

Jika query umum 30 hari dan partition hourly, pruning sangat tajam tetapi membuka ratusan partition.

Idealnya:

```text
partition size ≈ natural operational unit
```

Bukan selalu sama dengan query window, tetapi sejalan dengan:

- volume;
- retention;
- late data;
- lifecycle;
- operational handling.

### 14.3 Retention harus didesain sebelum production

Pertanyaan wajib:

- Berapa lama raw data disimpan?
- Berapa lama aggregated data disimpan?
- Apakah ada legal hold?
- Apakah retention berbeda per tenant?
- Apakah data boleh disimpan lebih lama karena partition granularity?
- Apa mekanisme audit deletion?

Jika jawaban ini tidak jelas, table design belum siap.

---

## 15. Partitioning Anti-Patterns

### Anti-pattern 1: Non-partitioned time-series table

```sql
CREATE TABLE readings (
    ts TIMESTAMP,
    value DOUBLE
);
```

Masalah:

- bukan time-series table penuh;
- tidak memakai designated timestamp;
- tidak ada partition pruning;
- WAL features tidak tersedia;
- retention sulit.

Better:

```sql
CREATE TABLE readings (
    ts TIMESTAMP,
    value DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY;
```

### Anti-pattern 2: Partition terlalu kasar untuk raw high-volume data

```sql
PARTITION BY MONTH
```

Untuk market ticks jutaan row/detik, ini berbahaya:

- partition sangat besar;
- O3 rewrite mahal;
- pruning kasar;
- drop/backup/convert berat.

### Anti-pattern 3: Partition terlalu kecil tanpa alasan

```sql
PARTITION BY HOUR
```

Untuk data 10 ribu row/hari, ini bisa berlebihan:

- terlalu banyak partition kecil;
- metadata overhead;
- lifecycle noise;
- tidak ada benefit nyata.

### Anti-pattern 4: Query API tanpa time bound

```sql
SELECT * FROM readings WHERE device_id = 'D-1';
```

Masalah:

- partition pruning tidak efektif;
- bisa scan seluruh history;
- query latency tidak bounded;
- mudah menyebabkan incident.

### Anti-pattern 5: Backfill besar langsung ke live table tanpa plan

Masalah:

- WAL lag;
- O3 storm;
- disk I/O contention;
- data freshness terganggu;
- sulit rollback.

### Anti-pattern 6: Retention tidak selaras dengan partition

```text
Need exact 45-day retention
Table PARTITION BY MONTH
```

Masalah:

- TTL/drop partition tidak cocok;
- data bisa tertahan terlalu lama;
- compliance ambiguity.

---

## 16. Partitioning Design Examples

### 16.1 Market ticks

Requirement:

```text
rows/sec: 1M+
query: last seconds/minutes/hour
late data: seconds-minutes
retention raw: 30 days
precision: nanosecond
```

Design:

```sql
CREATE TABLE market_ticks (
    ts TIMESTAMP_NS,
    symbol SYMBOL CAPACITY 100000 CACHE,
    venue SYMBOL CAPACITY 128 CACHE,
    price DOUBLE,
    size DOUBLE,
    side SYMBOL CAPACITY 4 CACHE
) TIMESTAMP(ts)
PARTITION BY HOUR;
```

Reasoning:

- high row volume;
- query window pendek;
- O3 scope harus kecil;
- TTL 30 days berarti sekitar 720 hourly partitions;
- masih manageable untuk high-value data.

### 16.2 Industrial telemetry

Requirement:

```text
rows/sec: 50k
query: last 15m, last 24h, daily trend
late data: minutes-hours, sometimes days
retention raw: 180 days
```

Design:

```sql
CREATE TABLE machine_readings (
    ts TIMESTAMP,
    site SYMBOL CAPACITY 256 CACHE,
    line SYMBOL CAPACITY 1024 CACHE,
    machine_id SYMBOL CAPACITY 100000 NOCACHE,
    sensor SYMBOL CAPACITY 4096 CACHE,
    value DOUBLE,
    quality SYMBOL CAPACITY 16 CACHE
) TIMESTAMP(ts)
PARTITION BY DAY;
```

Reasoning:

- daily partition balances pruning and operational simplicity;
- retention by day natural;
- late data by day manageable;
- dashboard can use MV for sub-hour aggregation if needed.

### 16.3 Aggregated application metrics

Requirement:

```text
rows/sec: low-medium
query: daily/weekly/monthly reports
retention: 3 years
raw already exists elsewhere
```

Design:

```sql
CREATE TABLE endpoint_metrics_1m (
    ts TIMESTAMP,
    service SYMBOL,
    endpoint SYMBOL,
    method SYMBOL,
    status_class SYMBOL,
    request_count LONG,
    latency_p95 DOUBLE,
    error_count LONG
) TIMESTAMP(ts)
PARTITION BY MONTH;
```

Reasoning:

- already aggregated;
- lower volume;
- retention long;
- query often broad;
- monthly partition acceptable.

---

## 17. Failure Modes

### 17.1 Partition explosion

Symptom:

- too many small partitions;
- metadata overhead;
- filesystem overhead;
- slow lifecycle operation.

Cause:

- `PARTITION BY HOUR` for low-volume table;
- many tiny tenant tables;
- overzealous granularity.

Mitigation:

- use `DAY`/`MONTH` for lower volume;
- consolidate tables by retention/workload class;
- review partition count periodically.

### 17.2 Giant partition

Symptom:

- query on short range still expensive;
- out-of-order ingestion slow;
- backup/restore slow;
- cold conversion heavy.

Cause:

- `PARTITION BY MONTH/YEAR` for high-volume raw data.

Mitigation:

- use `DAY` or `HOUR`;
- split workload by table;
- materialize aggregates separately.

### 17.3 O3 storm

Symptom:

- ingestion accepted but visibility delayed;
- WAL apply lag increases;
- CPU/I/O high;
- query freshness degraded.

Cause:

- large late-arriving batch;
- replay unsorted data;
- producer clock skew;
- backfill into live table.

Mitigation:

- sort by timestamp;
- backfill into staging;
- throttle historical load;
- isolate live ingestion and backfill windows;
- monitor WAL apply.

### 17.4 Retention miss

Symptom:

- old data still present;
- disk growth unexpected;
- compliance concern.

Cause:

- TTL not configured;
- TTL incompatible with partition size;
- legal hold/manual archive confusion;
- derived tables not covered by retention.

Mitigation:

- explicit TTL policy;
- test expiration in staging;
- retention checklist per table;
- monitor oldest partition.

### 17.5 Unbounded query incident

Symptom:

- dashboard/API query consumes CPU/I/O;
- p99 latency spike;
- users accidentally query years of data.

Cause:

- no API time range guard;
- UI default set to all time;
- SQL endpoint exposed broadly.

Mitigation:

- enforce max range;
- default last N minutes/hours;
- query timeout;
- read-only role guardrails;
- pre-aggregated serving tables.

---

## 18. Hands-On Lab

### 18.1 Create three candidate tables

```sql
CREATE TABLE readings_hourly (
    ts TIMESTAMP,
    device SYMBOL,
    sensor SYMBOL,
    value DOUBLE
) TIMESTAMP(ts)
PARTITION BY HOUR;

CREATE TABLE readings_daily (
    ts TIMESTAMP,
    device SYMBOL,
    sensor SYMBOL,
    value DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY;

CREATE TABLE readings_monthly (
    ts TIMESTAMP,
    device SYMBOL,
    sensor SYMBOL,
    value DOUBLE
) TIMESTAMP(ts)
PARTITION BY MONTH;
```

### 18.2 Insert representative data

Generate data for:

- last 7 days;
- 100 devices;
- 20 sensors;
- one sample per second per sensor;
- some late data 2 days ago.

### 18.3 Compare query behavior

Queries:

```sql
-- last 15 minutes
SELECT avg(value)
FROM readings_daily
WHERE ts >= dateadd('m', -15, now())
  AND sensor = 'temperature';

-- last 24 hours
SELECT sensor, avg(value)
FROM readings_daily
WHERE ts >= dateadd('d', -1, now())
GROUP BY sensor;

-- last 7 days
SELECT sensor, avg(value)
FROM readings_daily
WHERE ts >= dateadd('d', -7, now())
GROUP BY sensor;
```

Repeat for hourly/monthly tables.

Observe:

- query latency;
- partition count;
- disk layout;
- ingestion behavior with late data;
- operational complexity.

### 18.4 Retention experiment

Set TTL on a partitioned table and verify old partition behavior.

Example pattern:

```sql
ALTER TABLE readings_daily SET TTL 30 DAYS;
```

Then observe how retention aligns with partition boundary.

---

## 19. Production Checklist

Sebelum membuat QuestDB table production, jawab ini:

### Timestamp

- Apa designated timestamp?
- Apakah event time atau ingestion time?
- Apakah precision microsecond cukup atau perlu nanosecond?
- Apakah producer clock reliable?

### Partitioning

- Apa `PARTITION BY`?
- Berapa estimasi row per partition?
- Berapa estimasi GB per partition?
- Apakah query umum selaras dengan partition granularity?
- Apakah retention selaras dengan partition granularity?

### Ingestion

- Apakah data mostly ordered?
- Seberapa sering late data?
- Berapa maksimum lateness normal?
- Bagaimana backfill dilakukan?
- Apakah producer bisa sort batch by timestamp?

### Query

- Apakah semua query API punya time bound?
- Apakah ada max allowed query window?
- Apakah dashboard butuh materialized view?
- Apakah query cross-partition terlalu banyak?

### Lifecycle

- Apa TTL raw data?
- Apa TTL derived data?
- Apakah cold storage/Parquet dibutuhkan?
- Bagaimana backup partition dilakukan?
- Bagaimana restore divalidasi?

### Operations

- Bagaimana monitor oldest/newest partition?
- Bagaimana monitor WAL lag?
- Bagaimana detect O3 storm?
- Apa runbook disk growth?
- Apa runbook retention failure?

---

## 20. Practical Heuristics

Gunakan heuristik berikut, lalu validasi dengan benchmark.

### 20.1 Default heuristic

```text
Jika ragu dan workload time-series normal:
start dengan PARTITION BY DAY.
```

Kenapa:

- cukup granular untuk retention;
- cukup efisien untuk query umum;
- tidak terlalu banyak partition;
- cocok untuk banyak telemetry/app metrics.

### 20.2 Move to HOUR jika

```text
- row/day sangat besar;
- query mayoritas sub-hour;
- late data kecil tapi high-frequency;
- daily partition terlalu besar;
- O3 rewrite daily partition terlalu mahal.
```

### 20.3 Move to MONTH jika

```text
- data sudah aggregated;
- volume rendah;
- query broad historical;
- retention panjang;
- late writes hampir tidak ada.
```

### 20.4 Hindari YEAR kecuali

```text
- volume sangat rendah;
- archival only;
- query selalu historical broad;
- lifecycle sangat sederhana.
```

### 20.5 Jangan memilih partition hanya dari query window

Partitioning harus mempertimbangkan kombinasi:

```text
query window
+ ingest rate
+ late data distribution
+ retention
+ lifecycle operation
+ file count
+ backfill model
```

---

## 21. Staff-Level Review Questions

Saat review desain QuestDB, tanyakan:

1. Apa operational unit of time untuk table ini?
2. Apa natural lifecycle unit-nya?
3. Apa maximum acceptable stale visibility setelah ingest?
4. Apakah late data mengarah ke hot partition atau historical partition?
5. Apa worst-case backfill scenario?
6. Berapa partition yang dibuka query dashboard paling umum?
7. Berapa partition yang disentuh query ad-hoc paling buruk?
8. Apakah API mencegah query unbounded?
9. Apakah TTL benar-benar sesuai compliance?
10. Apakah partition size membuat restore feasible?
11. Apakah partitioning choice masih valid jika traffic 10x?
12. Apakah derived/materialized tables punya partition/TTL sendiri?

Pertanyaan ini lebih penting daripada sekadar “QuestDB support partition by apa?”.

---

## 22. Ringkasan

Partitioning di QuestDB adalah boundary fisik waktu. Ia menentukan bagaimana data ditempatkan, bagaimana query melewati data yang tidak relevan, bagaimana retention dilakukan, bagaimana late data ditangani, dan bagaimana operator mengelola lifecycle table.

Inti part ini:

```text
Designated timestamp menentukan waktu row.
Partitioning menentukan boundary fisik row.
Predicate timestamp memungkinkan pruning.
TTL/drop partition memungkinkan retention murah.
Out-of-order data memengaruhi partition rewrite cost.
Backfill harus partition-aware.
API harus time-bounded.
```

Default yang masuk akal untuk banyak workload adalah `PARTITION BY DAY`, tetapi high-frequency raw data bisa membutuhkan `HOUR`, sementara low-volume aggregated/historical data bisa memakai `MONTH`.

Partitioning bukan keputusan yang bisa diabaikan dan diperbaiki belakangan dengan mudah. Ia harus dipilih berdasarkan workload shape, bukan kebiasaan.

---

## 23. Preview Part Berikutnya

Part berikutnya:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-006.md
Ingestion Model: ILP, PGWire, REST, CSV, and Embedded Java
```

Kita akan membahas ingestion path QuestDB:

- ILP sebagai high-throughput ingestion path;
- PGWire untuk query dan low-volume insert;
- HTTP vs TCP ILP;
- CSV import untuk bootstrap/backfill;
- embedded Java mode;
- auto table/column creation;
- dan bagaimana memilih ingestion interface berdasarkan workload.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-004.md">⬅️ Data Model: Timestamp, Symbol, Column Type, and Table Shape</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-006.md">Part 006 — Ingestion Model: ILP, PGWire, REST, CSV, and Embedded Java ➡️</a>
</div>

# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-004.md

# Part 004 — MergeTree Internals I: Parts, Granules, Marks, Primary Index, and Sorting Key

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membangun gambaran besar arsitektur ClickHouse:

- client mengirim query atau insert,
- server memprosesnya melalui execution pipeline,
- table engine menentukan bagaimana data disimpan dan dibaca,
- `MergeTree` menjadi engine utama untuk workload analitik besar,
- data tidak disimpan sebagai row-by-row mutable records, melainkan sebagai kumpulan immutable data parts,
- query cepat bukan karena ClickHouse punya index seperti OLTP database, tetapi karena ia pintar membaca kolom, part, dan granule yang relevan saja.

Part ini masuk ke inti performa ClickHouse: **bagaimana `MergeTree` menyusun data di disk dan bagaimana sparse primary index bekerja**.

Kalau kamu hanya mengingat satu hal dari part ini, ingat ini:

> Di ClickHouse, `ORDER BY` pada table `MergeTree` bukan sekadar urutan tampilan data. Ia adalah keputusan physical layout yang menentukan bagaimana data dikelompokkan, dikompresi, dilewati, dan dibaca.

Banyak engineer yang datang dari PostgreSQL/MySQL keliru menganggap primary key ClickHouse seperti B-tree unique index. Ini salah secara mental model. Di ClickHouse:

- primary key tidak otomatis unik,
- primary key bukan row lookup index,
- primary key bersifat sparse,
- primary key bekerja pada level granule, bukan row,
- `ORDER BY` menentukan physical sort order,
- `PRIMARY KEY` menentukan subset/prefix yang masuk ke sparse index jika didefinisikan terpisah,
- jika `PRIMARY KEY` tidak didefinisikan, ClickHouse biasanya memakai `ORDER BY` sebagai primary key expression.

Part ini akan membahas:

1. Apa itu MergeTree secara internal.
2. Apa itu part.
3. Apa itu partition.
4. Apa itu granule.
5. Apa itu mark.
6. Apa itu sparse primary index.
7. Apa hubungan `ORDER BY`, `PRIMARY KEY`, dan physical data order.
8. Bagaimana query menggunakan index untuk skip data.
9. Bagaimana sorting key memengaruhi compression.
10. Bagaimana cara berpikir sebelum memilih key.

---

## 1. Mental Model Utama: ClickHouse Tidak Mencari Row, Ia Menghindari Membaca Data

Pada OLTP database, pertanyaan performa sering berbunyi:

> Bagaimana database menemukan row tertentu secepat mungkin?

Pada ClickHouse, pertanyaannya lebih sering:

> Bagaimana database menghindari membaca mayoritas data yang tidak relevan?

Ini perbedaan besar.

Contoh OLTP:

```sql
SELECT *
FROM users
WHERE id = 'u-123';
```

Database OLTP idealnya memakai index untuk menemukan satu row.

Contoh OLAP:

```sql
SELECT
    toStartOfHour(event_time) AS hour,
    status,
    count() AS total
FROM case_events
WHERE tenant_id = 'regulator-a'
  AND event_time >= now() - INTERVAL 7 DAY
  AND event_type = 'ESCALATED'
GROUP BY hour, status
ORDER BY hour;
```

Query ini tidak mencari satu row. Query ini membaca banyak event, sedikit kolom, lalu melakukan agregasi. Performa datang dari:

- membaca hanya kolom yang diperlukan,
- membaca hanya part yang relevan,
- membaca hanya granule yang mungkin mengandung data relevan,
- memanfaatkan data yang sudah tersortir,
- melakukan scan kolom secara vectorized,
- melakukan agregasi efisien.

Maka internal MergeTree harus dipahami sebagai struktur untuk **massively efficient scan pruning**, bukan sebagai row-indexed mutable store.

---

## 2. Apa Itu MergeTree?

`MergeTree` adalah keluarga table engine utama ClickHouse untuk data besar. Ia mendukung:

- penyimpanan columnar,
- partitioning,
- sparse primary index,
- background merge,
- data skipping,
- TTL,
- replication melalui varian replicated,
- varian khusus seperti `ReplacingMergeTree`, `SummingMergeTree`, `AggregatingMergeTree`, dan lainnya.

Table sederhana:

```sql
CREATE TABLE case_events
(
    tenant_id LowCardinality(String),
    case_id UUID,
    event_time DateTime64(3),
    event_type LowCardinality(String),
    actor_role LowCardinality(String),
    status LowCardinality(String),
    severity UInt8,
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_type, case_id);
```

Di table ini:

- `ENGINE = MergeTree` menentukan storage behavior.
- `PARTITION BY toYYYYMM(event_time)` menentukan lifecycle grouping.
- `ORDER BY (...)` menentukan physical sort order di dalam data part.

Hal yang paling sering salah dipahami:

> `ORDER BY` di DDL ClickHouse bukan sama dengan `ORDER BY` di query SELECT.

Pada DDL `MergeTree`, `ORDER BY` adalah storage-level sorting key.

---

## 3. Insert Mental Model: Dari Batch Menjadi Immutable Part

Ketika aplikasi melakukan insert ke table MergeTree, secara konseptual prosesnya seperti ini:

```text
incoming rows
    ↓
ClickHouse receives block
    ↓
rows are sorted by ORDER BY expression within the target partition
    ↓
column files are written
    ↓
marks and sparse primary index are written
    ↓
new immutable part appears
    ↓
background merges later combine parts
```

Important nuance:

- Insert tidak langsung mengubah satu file besar.
- Setiap insert batch biasanya menghasilkan satu atau lebih data part.
- Part bersifat immutable.
- Merge background membuat part lebih besar dari beberapa part kecil.
- Query dapat membaca banyak part sekaligus.

Analogi Java:

Bayangkan kamu punya `List<Event>` besar yang tidak pernah dimodifikasi in-place. Setiap batch masuk menjadi sorted immutable segment. Nanti background process menggabungkan beberapa segment menjadi segment lebih besar, tetap sorted. Query tidak mencari mutable object satu per satu, tetapi memilih segment dan range yang perlu discan.

---

## 4. Data Part: Unit Fisik Utama di MergeTree

### 4.1 Apa Itu Part?

Part adalah kumpulan data fisik yang ditulis ClickHouse dari hasil insert atau merge.

Satu part berisi:

- data kolom,
- metadata,
- primary index file,
- mark files,
- checksums,
- min/max partition-related metadata,
- informasi row count,
- informasi format part.

Part dapat dianggap sebagai **immutable sorted mini-table**.

Contoh:

```text
Table: case_events
Partition: 202606

Part A: rows 1,000,000  sorted by (tenant_id, event_time, event_type, case_id)
Part B: rows   800,000  sorted by (tenant_id, event_time, event_type, case_id)
Part C: rows 1,200,000  sorted by (tenant_id, event_time, event_type, case_id)
```

Setiap part sorted secara internal. Namun sebelum merge, table secara keseluruhan dapat memiliki banyak part untuk partition yang sama.

### 4.2 Kenapa Part Immutable?

Immutable part memberi beberapa keuntungan:

1. **Write throughput tinggi**  
   Insert batch bisa ditulis sebagai segment baru tanpa random update.

2. **Columnar compression efektif**  
   Data ditulis dalam chunk kolom yang terstruktur.

3. **Concurrency lebih sederhana**  
   Query dapat membaca snapshot part yang stabil.

4. **Merge bisa asynchronous**  
   Compaction tidak perlu terjadi di critical path insert.

5. **Recovery lebih deterministik**  
   Part punya checksum dan metadata.

Trade-off-nya:

- update/delete tidak murah,
- terlalu banyak small part membuat query dan background merge berat,
- desain ingestion batch menjadi penting.

---

## 5. Partition vs Part: Jangan Disamakan

Ini salah satu sumber kebingungan terbesar.

### 5.1 Partition

Partition adalah grouping logical/physical berdasarkan expression `PARTITION BY`.

Contoh:

```sql
PARTITION BY toYYYYMM(event_time)
```

Maka data dikelompokkan per bulan:

```text
202601
202602
202603
...
```

Partition berguna untuk:

- data lifecycle,
- drop partition,
- TTL,
- backfill per periode,
- membatasi scope merge,
- partition pruning jika query punya filter yang sesuai.

### 5.2 Part

Part adalah file set hasil insert/merge di dalam partition.

Satu partition bisa punya banyak part:

```text
Partition 202606
    Part 202606_1_1_0
    Part 202606_2_2_0
    Part 202606_3_8_1
    Part 202606_9_20_2
```

### 5.3 Hubungan Partition dan Part

```text
Table
  ├── Partition 202605
  │     ├── Part A
  │     ├── Part B
  │     └── Part C
  └── Partition 202606
        ├── Part D
        ├── Part E
        └── Part F
```

Partition adalah folder/kelompok lifecycle. Part adalah unit storage aktual yang dibaca/ditulis/di-merge.

### 5.4 Kesalahan Umum

Kesalahan:

```sql
PARTITION BY tenant_id
```

Jika tenant sangat banyak, ini dapat menciptakan terlalu banyak partition. Di ClickHouse, partition bukan alat indexing utama untuk setiap dimension. Partition lebih cocok untuk boundary data lifecycle, biasanya waktu.

Better default:

```sql
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_type, case_id)
```

Atau untuk data sangat besar:

```sql
PARTITION BY toYYYYMMDD(event_time)
```

Namun daily partition juga harus hati-hati jika data per hari kecil atau jumlah tenant besar.

---

## 6. Granule: Unit Minimum Data Skipping

### 6.1 Apa Itu Granule?

Granule adalah sekelompok rows dalam part yang menjadi unit indexing/skipping. Secara default, ClickHouse sering memakai index granularity sekitar 8192 rows, meskipun ada juga pengaturan berbasis bytes seperti `index_granularity_bytes`.

Jika satu part punya 1,000,000 rows dan granularity 8192 rows, maka jumlah granule kira-kira:

```text
1,000,000 / 8,192 ≈ 123 granules
```

Setiap granule punya entry di sparse primary index.

### 6.2 Granule Bukan Page OLTP

Granule bukan sama dengan database page di PostgreSQL/MySQL. Granule adalah logical row range dalam sorted part yang membantu ClickHouse memutuskan bagian mana yang perlu dibaca.

ClickHouse tidak berkata:

> row ke-12345 ada di offset ini, ambil row itu.

ClickHouse lebih sering berkata:

> filter ini mungkin cocok di granule 10 sampai 15; baca kolom yang diperlukan dari range tersebut.

### 6.3 Dampak Granule

Granule memengaruhi:

- precision data skipping,
- ukuran primary index,
- jumlah mark,
- jumlah seek,
- overhead metadata,
- efisiensi scan.

Granule lebih kecil:

- skipping lebih presisi,
- metadata lebih besar,
- lebih banyak mark,
- lebih banyak overhead.

Granule lebih besar:

- metadata lebih kecil,
- skipping kurang presisi,
- dapat membaca lebih banyak data yang tidak relevan.

Sebagai engineer, kamu jarang perlu mengubah granularity di awal. Lebih penting memilih `ORDER BY` yang benar.

---

## 7. Mark: Peta Offset Untuk Membaca Kolom

### 7.1 Apa Itu Mark?

Mark adalah metadata yang menunjuk lokasi data pada file kolom untuk granule tertentu.

Karena ClickHouse menyimpan data per kolom, setiap kolom perlu tahu kira-kira di mana posisi data untuk granule tertentu.

Bayangkan part punya kolom:

```text
tenant_id.bin
event_time.bin
event_type.bin
case_id.bin
status.bin
severity.bin
payload.bin
```

Dan setiap kolom punya mark file yang memberi offset untuk granule:

```text
tenant_id.mrk
event_time.mrk
event_type.mrk
...
```

Secara konseptual:

```text
Granule 0:
  tenant_id column offset = ...
  event_time column offset = ...
  event_type column offset = ...

Granule 1:
  tenant_id column offset = ...
  event_time column offset = ...
  event_type column offset = ...
```

### 7.2 Mark Menghubungkan Index ke Data Kolom

Primary index membantu memilih granule. Mark membantu membaca data kolom untuk granule itu.

Flow:

```text
WHERE condition
    ↓
primary index selects candidate granules
    ↓
marks identify offsets for selected granules
    ↓
ClickHouse reads only necessary columns/ranges
```

Ini alasan kenapa ClickHouse bisa cepat untuk query seperti:

```sql
SELECT count()
FROM case_events
WHERE tenant_id = 'regulator-a'
  AND event_time >= '2026-06-01'
  AND event_time <  '2026-07-01';
```

Jika sorting key mendukung filter, ClickHouse dapat menghindari membaca banyak granule.

---

## 8. Sparse Primary Index: Index yang Sengaja Tidak Detail

### 8.1 Apa Itu Sparse Index?

Sparse index menyimpan entry untuk sebagian row, bukan semua row.

Di MergeTree, primary index menyimpan nilai key untuk awal granule.

Misalnya table sorted by:

```sql
ORDER BY (tenant_id, event_time, event_type, case_id)
```

Primary index entry secara konseptual:

```text
Granule 0  starts at ('bank-a', '2026-06-01 00:00:00', 'CREATED',   ...)
Granule 1  starts at ('bank-a', '2026-06-01 03:12:10', 'UPDATED',   ...)
Granule 2  starts at ('bank-a', '2026-06-01 08:44:02', 'ESCALATED', ...)
Granule 3  starts at ('bank-b', '2026-06-01 00:01:21', 'CREATED',   ...)
Granule 4  starts at ('bank-b', '2026-06-01 05:20:11', 'REVIEWED',  ...)
```

Ini bukan index per row.

### 8.2 Kenapa Sparse?

Karena OLAP table bisa punya miliaran/triliunan rows. Index per row akan terlalu besar dan mahal.

Sparse index punya karakteristik:

- kecil,
- bisa fit di memory,
- murah dibuat,
- cocok untuk scan besar,
- tidak cocok untuk precise single-row lookup.

Inilah kompromi yang tepat untuk OLAP.

### 8.3 Sparse Index Tidak Menjamin Uniqueness

Ini penting.

Di PostgreSQL:

```sql
PRIMARY KEY (id)
```

Biasanya berarti:

- unique,
- not null,
- indexed,
- referential target.

Di ClickHouse `MergeTree`:

```sql
PRIMARY KEY (tenant_id, event_time)
```

Berarti:

- expression untuk sparse primary index,
- membantu skip granules,
- tidak otomatis unique,
- bukan constraint seperti OLTP.

Kalau kamu butuh uniqueness, harus diselesaikan di ingestion pipeline, source system, deduplication strategy, atau engine tertentu seperti `ReplacingMergeTree` dengan trade-off tertentu.

---

## 9. `ORDER BY` vs `PRIMARY KEY` di ClickHouse

### 9.1 Default Mental Model

Paling sederhana:

```sql
ENGINE = MergeTree
ORDER BY (tenant_id, event_time, event_type, case_id)
```

Jika tidak menulis `PRIMARY KEY`, ClickHouse memakai sorting key sebagai primary key expression.

### 9.2 Ketika `PRIMARY KEY` Ditulis Terpisah

ClickHouse memungkinkan:

```sql
ENGINE = MergeTree
ORDER BY (tenant_id, event_time, event_type, case_id)
PRIMARY KEY (tenant_id, event_time)
```

Maknanya:

- data tetap physically sorted by `(tenant_id, event_time, event_type, case_id)`,
- sparse primary index hanya memakai `(tenant_id, event_time)`,
- index lebih kecil,
- sort locality tetap lebih detail.

Ini berguna jika sorting key panjang tetapi tidak semua kolom perlu masuk primary index.

### 9.3 Aturan Penting

Secara praktis, `PRIMARY KEY` harus menjadi prefix dari `ORDER BY` jika didefinisikan terpisah.

Contoh valid:

```sql
ORDER BY (tenant_id, event_time, event_type, case_id)
PRIMARY KEY (tenant_id, event_time)
```

Contoh desain buruk/bermasalah secara konsep:

```sql
ORDER BY (tenant_id, event_time, event_type, case_id)
PRIMARY KEY (event_type, tenant_id)
```

Karena primary index harus sejalan dengan physical order.

### 9.4 Sorting Key Mengatur Lebih Banyak Hal

`ORDER BY` memengaruhi:

- skip efficiency,
- compression,
- merge behavior,
- locality untuk aggregation,
- locality untuk range scan,
- dedup semantics pada beberapa engine variant,
- cost query dashboard.

Maka `ORDER BY` adalah keputusan desain yang lebih fundamental daripada banyak engineer kira.

---

## 10. Bagaimana Query Menggunakan Sparse Primary Index

Gunakan table:

```sql
CREATE TABLE case_events
(
    tenant_id LowCardinality(String),
    case_id UUID,
    event_time DateTime64(3),
    event_type LowCardinality(String),
    status LowCardinality(String),
    severity UInt8
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_type, case_id);
```

### 10.1 Query yang Cocok Dengan Sorting Key

```sql
SELECT count()
FROM case_events
WHERE tenant_id = 'bank-a'
  AND event_time >= '2026-06-01'
  AND event_time <  '2026-06-08';
```

Query ini bagus karena filter memakai prefix sorting key:

```text
(tenant_id, event_time, ...)
```

ClickHouse dapat:

1. memilih partition `202606`,
2. membaca primary index di setiap part relevan,
3. menemukan granule range untuk `tenant_id = bank-a`,
4. mempersempit lagi berdasarkan `event_time`,
5. membaca kolom minimal untuk menghitung count.

### 10.2 Query yang Kurang Cocok

```sql
SELECT count()
FROM case_events
WHERE event_type = 'ESCALATED';
```

Walaupun `event_type` ada di `ORDER BY`, ia berada setelah `tenant_id` dan `event_time`.

Tanpa filter pada prefix awal, data dengan `event_type = 'ESCALATED'` tersebar di banyak tenant dan waktu. ClickHouse mungkin harus membaca jauh lebih banyak granule.

Ini mirip compound index pada database lain, tetapi tidak sama. Prinsip prefix tetap penting.

### 10.3 Query yang Sangat Buruk Untuk Key Ini

```sql
SELECT *
FROM case_events
WHERE case_id = '...';
```

Karena `case_id` ada di posisi akhir sorting key, dan prefix sebelumnya tidak diberikan, ClickHouse tidak bisa langsung melompat ke row. Ia dapat melakukan scan besar.

Jika use case utama adalah lookup by `case_id`, ClickHouse mungkin bukan serving store yang tepat, atau butuh model/projection/table terpisah.

---

## 11. Sorting Key Sebagai Clustering Strategy

`ORDER BY` pada MergeTree lebih tepat dipahami sebagai **clustering key**.

Ia menjawab:

> Row mana yang sebaiknya berdekatan secara fisik agar query umum membaca range yang compact?

Contoh data event:

```text
(tenant_id, event_time, event_type, case_id)
```

Physical order akan mengelompokkan:

1. semua data tenant yang sama,
2. di dalam tenant, data tersusun berdasarkan waktu,
3. di dalam waktu, event type berdekatan,
4. di dalam event type, case id tersusun.

Ini bagus untuk query:

```sql
WHERE tenant_id = ? AND event_time BETWEEN ? AND ?
```

Dan cukup bagus untuk:

```sql
WHERE tenant_id = ? AND event_time BETWEEN ? AND ? AND event_type = ?
```

Tapi kurang bagus untuk:

```sql
WHERE case_id = ?
```

Maka desain key harus berasal dari query shape dominan.

---

## 12. Compression: Sorting Key Juga Menghemat Storage

Columnar compression sangat dipengaruhi oleh urutan data.

Misalnya data tidak sorted:

```text
tenant_id column:
bank-a, fintech-x, bank-b, bank-a, regulator-z, bank-b, fintech-x, ...
```

Data sorted by tenant:

```text
tenant_id column:
bank-a, bank-a, bank-a, bank-a, bank-b, bank-b, bank-b, fintech-x, ...
```

Versi kedua lebih mudah dikompresi.

Begitu juga `event_type`:

```text
CREATED, CREATED, CREATED, UPDATED, UPDATED, ESCALATED, ESCALATED
```

lebih kompresibel daripada nilai acak.

Sorting key membantu compression karena:

- nilai serupa berdekatan,
- delta antar timestamp lebih kecil,
- low-cardinality run lebih panjang,
- codec bekerja lebih efektif,
- kolom correlated menjadi lebih local.

Ini berarti `ORDER BY` memengaruhi bukan hanya query speed, tetapi juga:

- storage cost,
- I/O cost,
- cache hit rate,
- decompression cost.

---

## 13. Memilih Urutan Kolom Dalam Sorting Key

Tidak ada satu jawaban universal. Tapi ada prinsip.

### 13.1 Pilih Berdasarkan Query Filter Paling Umum

Jika hampir semua query punya tenant filter:

```sql
WHERE tenant_id = ?
```

maka `tenant_id` kandidat kuat di awal key.

Jika hampir semua query time range:

```sql
WHERE event_time >= ? AND event_time < ?
```

maka time juga kandidat kuat.

Namun urutan harus dipikirkan.

### 13.2 Equality Sebelum Range Sering Masuk Akal

Contoh:

```sql
ORDER BY (tenant_id, event_time)
```

Untuk query:

```sql
WHERE tenant_id = 'bank-a'
  AND event_time >= '2026-06-01'
  AND event_time < '2026-06-08'
```

Ini ideal: equality pada tenant, range pada time.

Jika dibalik:

```sql
ORDER BY (event_time, tenant_id)
```

Maka semua tenant dalam time range akan berdekatan, bukan tenant tertentu sepanjang time range. Ini bisa bagus untuk global time dashboards, tetapi kurang optimal untuk tenant-specific queries.

### 13.3 Low Cardinality Di Awal? Tidak Selalu, Tapi Sering Berguna

Kolom low-cardinality seperti region/status/type dapat membantu clustering dan compression. Tapi jangan taruh kolom low-cardinality di awal hanya karena low-cardinality.

Pertanyaan yang benar:

> Apakah kolom ini sering dipakai untuk membuang banyak data?

Contoh `status`:

```sql
ORDER BY (status, event_time)
```

Jika query sering:

```sql
WHERE status = 'OPEN'
```

ini bisa membantu.

Tapi jika hampir semua query tidak filter status, maka status di awal mungkin merusak locality yang lebih penting.

### 13.4 Time-First vs Tenant-First

#### Tenant-first

```sql
ORDER BY (tenant_id, event_time)
```

Bagus untuk:

- SaaS multi-tenant dashboards,
- tenant-specific reports,
- access isolation by tenant,
- regulatory entity-specific analytics.

Kurang bagus untuk:

- global dashboards across all tenants per minute,
- queries tanpa tenant filter.

#### Time-first

```sql
ORDER BY (event_time, tenant_id)
```

Bagus untuk:

- global time-series analytics,
- observability workloads,
- recent data queries across all tenants/services,
- append locality by time.

Kurang bagus untuk:

- tenant-specific long-range scans jika tenant cardinality besar.

#### Hybrid dengan bucket

Kadang dipakai:

```sql
ORDER BY (toDate(event_time), tenant_id, event_time)
```

Tapi hati-hati. Expression dalam sorting key harus mencerminkan query pattern.

### 13.5 Jangan Taruh UUID Random di Awal

Buruk:

```sql
ORDER BY (event_id)
```

Jika `event_id` random UUID:

- locality buruk,
- compression buruk,
- time range pruning buruk,
- insert sorting acak,
- query analytics umum tidak terbantu.

Lebih baik:

```sql
ORDER BY (tenant_id, event_time, event_type, event_id)
```

UUID boleh di akhir untuk deterministic ordering, bukan di awal sebagai access path utama.

---

## 14. Primary Key Prefix Effect

Misalnya sorting key:

```sql
ORDER BY (tenant_id, event_time, event_type, case_id)
```

### 14.1 Filter Prefix Lengkap

```sql
WHERE tenant_id = 'bank-a'
  AND event_time >= '2026-06-01'
  AND event_time < '2026-06-08'
```

Sangat baik.

### 14.2 Filter Kolom Pertama Saja

```sql
WHERE tenant_id = 'bank-a'
```

Masih baik untuk skip tenant lain.

### 14.3 Filter Kolom Kedua Tanpa Kolom Pertama

```sql
WHERE event_time >= '2026-06-01'
  AND event_time < '2026-06-08'
```

Bisa jauh kurang efektif karena data disusun tenant dulu. Untuk setiap tenant ada range waktu sendiri.

### 14.4 Filter Kolom Ketiga Tanpa Prefix

```sql
WHERE event_type = 'ESCALATED'
```

Biasanya tidak efektif sebagai primary index pruning.

### 14.5 Filter Akhir Saja

```sql
WHERE case_id = '...'
```

Umumnya buruk untuk key ini.

---

## 15. Practical Example: Regulatory Case Lifecycle Analytics

Konteks:

- sistem menyimpan event lifecycle kasus,
- multi-tenant atau multi-entity,
- setiap event punya time,
- dashboard sering melihat jumlah kasus by stage/status/severity dalam rentang waktu,
- audit trail perlu drill-down by case.

Table awal:

```sql
CREATE TABLE case_lifecycle_events
(
    tenant_id LowCardinality(String),
    regulator_id LowCardinality(String),
    regulated_entity_id String,
    case_id UUID,
    event_id UUID,
    event_time DateTime64(3),
    event_date Date MATERIALIZED toDate(event_time),
    event_type LowCardinality(String),
    previous_state LowCardinality(String),
    new_state LowCardinality(String),
    severity UInt8,
    actor_role LowCardinality(String),
    source_system LowCardinality(String),
    ingestion_time DateTime64(3),
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_type, case_id, event_id);
```

Kenapa key ini?

- `tenant_id` di awal karena hampir semua query terisolasi tenant.
- `event_time` kedua karena hampir semua analytics berbasis waktu.
- `event_type` ketiga karena filter dan group by event type umum.
- `case_id` untuk locality event case dalam tenant/time/type tertentu.
- `event_id` di akhir untuk deterministic ordering, bukan pruning utama.

Query yang cocok:

```sql
SELECT
    toStartOfDay(event_time) AS day,
    event_type,
    count() AS events
FROM case_lifecycle_events
WHERE tenant_id = 'regulator-a'
  AND event_time >= '2026-06-01'
  AND event_time < '2026-07-01'
GROUP BY day, event_type
ORDER BY day, event_type;
```

Query yang kurang cocok:

```sql
SELECT *
FROM case_lifecycle_events
WHERE case_id = '...';
```

Untuk lookup by case, opsi:

1. gunakan OLTP/source store untuk detail case,
2. buat table/projection terpisah sorted by `(tenant_id, case_id, event_time)`,
3. gunakan materialized view ke serving table case-centric,
4. terima scan jika query jarang dan dataset masih manageable.

---

## 16. Practical Example: Observability Logs

Workload logs biasanya:

- query recent time range,
- filter by service/environment/level,
- kadang search message,
- cardinality tinggi pada trace_id/request_id/user_id.

Desain umum:

```sql
CREATE TABLE app_logs
(
    timestamp DateTime64(3),
    environment LowCardinality(String),
    service LowCardinality(String),
    level LowCardinality(String),
    trace_id String,
    span_id String,
    message String,
    attributes Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (environment, service, timestamp, level);
```

Atau jika query global recent logs lebih dominan:

```sql
ORDER BY (timestamp, environment, service, level)
```

Trade-off:

- environment/service first baik untuk service-specific dashboard,
- timestamp first baik untuk global recent scanning,
- trace_id lookup tidak akan optimal kecuali ada table/projection lain,
- message search butuh strategi tambahan seperti token bloom filter atau sistem search khusus.

---

## 17. Anti-Patterns Sorting Key

### 17.1 `ORDER BY tuple()` Untuk Data Besar

```sql
ORDER BY tuple()
```

Ini berarti tidak ada meaningful sort key.

Masuk akal hanya untuk table kecil, staging sementara, atau workload khusus. Untuk fact table besar, ini biasanya buruk karena ClickHouse kehilangan access path utama.

### 17.2 Random UUID First

```sql
ORDER BY (event_id, event_time)
```

Buruk untuk analytics karena event_id acak merusak clustering.

### 17.3 Terlalu Banyak Kolom Di Key

```sql
ORDER BY (
    tenant_id,
    event_time,
    event_type,
    status,
    severity,
    actor_role,
    source_system,
    case_id,
    event_id,
    ingestion_time
)
```

Masalah:

- index lebih besar,
- sorting lebih mahal,
- mental model sulit,
- tidak semua kolom membantu pruning,
- kolom akhir sering tidak berguna untuk skipping jika prefix tidak dipakai.

Key panjang tidak otomatis lebih cepat.

### 17.4 Kolom High-Cardinality Tidak Relevan Di Awal

```sql
ORDER BY (user_id, event_time)
```

Jika query jarang filter user_id, ini buruk. Data time range global terpecah-pecah per user.

### 17.5 Key Berdasarkan “Keunikan” Bukan Query

Engineer OLTP sering berpikir:

> Primary key harus unique, jadi pakai id.

Di ClickHouse, pemikiran lebih tepat:

> Sorting key harus mengelompokkan data agar query umum membaca sesedikit mungkin granule.

---

## 18. Bagaimana Mengevaluasi Apakah Key Bagus?

Gunakan pertanyaan berikut.

### 18.1 Query Pattern

- Query paling sering filter kolom apa?
- Query paling mahal filter kolom apa?
- Apakah query selalu punya time range?
- Apakah query selalu punya tenant/entity filter?
- Query global atau tenant-specific?
- Query dashboard atau ad hoc exploration?

### 18.2 Selectivity

- Kolom mana yang membuang data paling banyak?
- Filter mana yang paling stabil muncul?
- Apakah filter equality atau range?
- Apakah cardinality terlalu tinggi/rendah?

### 18.3 Locality

- Row mana yang sebaiknya berdekatan?
- Apakah group by akan mendapat manfaat dari locality?
- Apakah compression membaik jika kolom ini diurutkan?

### 18.4 Operational

- Apakah insert perlu sorting mahal?
- Apakah partition terlalu granular?
- Apakah query tanpa prefix masih banyak?
- Apakah butuh projection/table kedua?

### 18.5 Evolution

- Apakah key ini masih masuk akal dalam 6 bulan?
- Jika query berubah, apakah bisa tambah materialized view/projection?
- Apakah re-clustering table mahal?

---

## 19. Measurement: Apa yang Harus Dilihat

Untuk query tuning nanti, beberapa metrik penting:

- rows read,
- bytes read,
- marks read,
- parts read,
- partitions read,
- memory usage,
- query duration,
- selected granules,
- result rows,
- profile events.

Contoh investigasi:

```sql
EXPLAIN indexes = 1
SELECT count()
FROM case_lifecycle_events
WHERE tenant_id = 'regulator-a'
  AND event_time >= '2026-06-01'
  AND event_time < '2026-07-01';
```

Lalu lihat query log:

```sql
SELECT
    query_duration_ms,
    read_rows,
    read_bytes,
    result_rows,
    memory_usage
FROM system.query_log
WHERE query LIKE '%case_lifecycle_events%'
  AND type = 'QueryFinish'
ORDER BY event_time DESC
LIMIT 10;
```

Lihat part:

```sql
SELECT
    partition,
    count() AS parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS size
FROM system.parts
WHERE table = 'case_lifecycle_events'
  AND active
GROUP BY partition
ORDER BY partition DESC;
```

Jika query membaca terlalu banyak rows untuk hasil kecil, kemungkinan:

- sorting key tidak cocok,
- filter tidak memakai prefix,
- partition tidak membantu,
- query shape perlu aggregate table,
- data skipping index/projection dibutuhkan,
- query memang perlu full scan.

---

## 20. Design Pattern: Main Table + Alternate Access Table

Karena satu table hanya punya satu primary physical order utama, kadang butuh table tambahan.

Main analytics table:

```sql
CREATE TABLE case_events_by_tenant_time
(
    tenant_id String,
    case_id UUID,
    event_time DateTime64(3),
    event_type String,
    status String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_type, case_id);
```

Case lookup table:

```sql
CREATE TABLE case_events_by_case
(
    tenant_id String,
    case_id UUID,
    event_time DateTime64(3),
    event_type String,
    status String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, case_id, event_time);
```

Data dapat dikirim ke keduanya dari ingestion pipeline atau materialized view.

Trade-off:

- storage bertambah,
- ingestion complexity bertambah,
- lookup query jauh lebih cepat,
- desain lebih eksplisit.

Ini lebih baik daripada memaksa satu sorting key melayani semua query.

---

## 21. Decision Framework Memilih Sorting Key Awal

Gunakan langkah ini.

### Step 1 — Tulis Query Paling Penting

Jangan mulai dari kolom. Mulai dari query.

Contoh:

```sql
-- Dashboard utama
WHERE tenant_id = ? AND event_time BETWEEN ? AND ?
GROUP BY day, event_type

-- Drill-down event type
WHERE tenant_id = ? AND event_time BETWEEN ? AND ? AND event_type = ?

-- Entity report
WHERE tenant_id = ? AND regulated_entity_id = ? AND event_time BETWEEN ? AND ?

-- Case lookup
WHERE tenant_id = ? AND case_id = ?
```

### Step 2 — Tandai Query Dominan

Tidak semua query sama penting.

Klasifikasi:

- P0: dashboard kritikal sering dipakai,
- P1: report rutin,
- P2: drill-down occasional,
- P3: admin/debug query.

Sorting key harus mengoptimalkan P0/P1, bukan semua query.

### Step 3 — Pilih Prefix Paling Stabil

Jika semua P0 punya:

```text
tenant_id + time range
```

maka kandidat:

```sql
ORDER BY (tenant_id, event_time, ...)
```

### Step 4 — Tambahkan Kolom Yang Membantu Pruning/Locality

Misalnya:

```sql
ORDER BY (tenant_id, event_time, event_type, case_id)
```

### Step 5 — Jangan Terlalu Panjang

Mulai dengan 3 sampai 5 kolom yang benar-benar berguna.

### Step 6 — Rencanakan Alternate Access

Jika ada query penting yang tidak cocok, buat:

- materialized view,
- projection,
- serving table,
- external lookup store,
- separate ClickHouse table.

### Step 7 — Validasi Dengan Data Nyata

Load sample representatif, lalu ukur:

- read_rows,
- read_bytes,
- query time,
- compression ratio,
- part count,
- memory.

---

## 22. ClickHouse vs OLTP Index: Perbandingan Cepat

| Aspek | OLTP B-tree Index | ClickHouse Sparse Primary Index |
|---|---|---|
| Tujuan | menemukan row cepat | skip granule yang tidak relevan |
| Granularity | row-level/key-level | granule-level |
| Cocok untuk | point lookup | range scan/agregasi |
| Ukuran | bisa besar | relatif kecil |
| Uniqueness | sering enforce unique | tidak enforce unique |
| Write cost | index update per row | batch/part index generation |
| Query model | seek lalu fetch row | prune lalu scan column range |
| Physical order | optional/clustered tergantung DB | ditentukan `ORDER BY` |

---

## 23. Failure Mode: Key Salah Di Produksi

### 23.1 Gejala

- query dashboard lambat walau data “tidak terlalu besar”,
- query membaca ratusan juta rows untuk hasil kecil,
- compression ratio buruk,
- CPU tinggi saat scan,
- disk read tinggi,
- query by tenant tetap membaca banyak data,
- semua query bergantung pada `FINAL` atau full scan,
- butuh skip index terlalu banyak untuk menambal desain awal.

### 23.2 Root Cause Umum

- `ORDER BY` memakai UUID,
- key tidak cocok dengan WHERE clause,
- time tidak ada di key untuk time-range workload,
- tenant tidak ada di key untuk tenant-isolated workload,
- terlalu mengandalkan partition,
- membuat satu table untuk semua access pattern,
- desain berdasarkan entity model OLTP, bukan query analytics.

### 23.3 Recovery Options

- buat table baru dengan sorting key benar,
- backfill dari raw table,
- buat materialized view baru,
- tambah projection jika cocok,
- ubah API agar memakai query pattern yang lebih aligned,
- pisahkan lookup workload dari analytical workload.

Di ClickHouse, mengubah `ORDER BY` table besar bukan operasi murah. Sering kali perlu create table baru dan migrate/backfill data.

---

## 24. Mini Exercise

### Exercise 1

Workload:

- 95% query filter by `tenant_id`, `event_time` range,
- group by `event_type`, `status`, day,
- occasional lookup by `case_id`,
- data 5 TB per tahun,
- retention 3 tahun.

Pilih sorting key.

Kemungkinan awal:

```sql
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_type, status, case_id)
```

Tapi diskusikan:

- apakah `status` perlu di key?
- apakah `case_id` cukup di akhir?
- apakah lookup by case butuh table lain?
- apakah partition monthly cukup?

### Exercise 2

Workload:

- observability logs,
- query selalu last 15 minutes sampai last 24 hours,
- kadang filter service,
- kadang filter environment,
- global incident dashboard lintas service penting.

Opsi A:

```sql
ORDER BY (service, timestamp)
```

Opsi B:

```sql
ORDER BY (timestamp, service)
```

Opsi C:

```sql
ORDER BY (environment, service, timestamp)
```

Tidak ada jawaban universal. Pilihan bergantung apakah query global-time atau service-specific lebih penting.

### Exercise 3

Kenapa ini buruk?

```sql
ORDER BY (event_id)
```

Jawaban:

- random distribution,
- tidak membantu time range,
- tidak membantu tenant filter,
- compression buruk,
- query analytics scan besar,
- event_id lookup mungkin tetap bukan use case utama.

---

## 25. Production Checklist Untuk Part Ini

Sebelum membuat table besar di ClickHouse, jawab:

1. Apa 5 query paling penting?
2. Apa filter yang selalu muncul?
3. Apakah workload tenant-specific atau global?
4. Apakah time range hampir selalu ada?
5. Apa cardinality kolom kandidat key?
6. Apakah kolom awal key membuang banyak data?
7. Apakah key membantu compression?
8. Apakah ada query penting yang tidak cocok dengan key?
9. Apakah query itu butuh table/projection/materialized view lain?
10. Apakah partition key dipilih untuk lifecycle, bukan sebagai pengganti index?
11. Apakah insert batch cukup besar agar tidak menciptakan terlalu banyak parts?
12. Apakah sudah diuji dengan data representatif?
13. Apakah `read_rows` dan `read_bytes` masuk akal untuk query utama?
14. Apakah table masih bisa berevolusi jika query berubah?
15. Apakah key tidak dibuat hanya karena kebiasaan OLTP?

---

## 26. Ringkasan

`MergeTree` adalah engine utama ClickHouse untuk data analitik besar. Ia menyimpan data sebagai immutable sorted parts. Di dalam part, data dibagi ke granule. Sparse primary index menyimpan nilai key untuk granule, bukan untuk setiap row. Mark menghubungkan granule ke offset data kolom. Query cepat ketika ClickHouse dapat memilih part dan granule yang relevan, lalu membaca hanya kolom yang dibutuhkan.

Konsep paling penting:

- `ORDER BY` di DDL menentukan physical sort order.
- `PRIMARY KEY` di ClickHouse adalah sparse index, bukan uniqueness constraint.
- Sparse index bekerja pada level granule.
- Sorting key harus dipilih berdasarkan query pattern dominan.
- Kolom awal key jauh lebih penting daripada kolom akhir.
- Partition bukan pengganti sorting key.
- Random UUID di awal key hampir selalu buruk untuk OLAP.
- Compression sangat dipengaruhi oleh sort order.
- Satu table tidak harus melayani semua access pattern.

Jika kamu memahami part ini, kamu sudah melewati salah satu lompatan mental terbesar dari OLTP engineer menuju ClickHouse/OLAP engineer.

---

## 27. Referensi

Referensi utama untuk pendalaman:

1. ClickHouse Docs — MergeTree table engine: https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree
2. ClickHouse Docs — Primary indexes: https://clickhouse.com/docs/primary-indexes
3. ClickHouse Docs — Sparse primary indexes best practices: https://clickhouse.com/docs/guides/best-practices/sparse-primary-indexes
4. ClickHouse Docs — Choosing a primary key: https://clickhouse.com/docs/best-practices/choosing-a-primary-key
5. ClickHouse Docs — MergeTree settings: https://clickhouse.com/docs/operations/settings/merge-tree-settings

---

## 28. Status Series

Status: **belum selesai**.

Part yang sudah dibuat:

- Part 000 — Orientation: Why OLAP Is a Different Engineering Discipline
- Part 001 — OLAP Workload Anatomy: Queries, Facts, Dimensions, Events, and Metrics
- Part 002 — Columnar Storage Mental Model: From Rows to Columns to Compressed Blocks
- Part 003 — ClickHouse Architecture Overview: Server, Tables, Parts, Blocks, and Pipelines
- Part 004 — MergeTree Internals I: Parts, Granules, Marks, Primary Index, and Sorting Key

Part berikutnya:

- Part 005 — MergeTree Internals II: Background Merges, Mutations, TTL, and Part Explosion


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — ClickHouse Architecture Overview: Server, Tables, Parts, Blocks, and Pipelines</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-005.md">Part 005 — MergeTree Internals II: Background Merges, Mutations, TTL, and Part Explosion ➡️</a>
</div>

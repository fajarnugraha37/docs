# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-016.md

# Part 016 — Projections, Data Skipping Indexes, and Secondary Access Paths

> Seri: **OLAP, Column-Oriented Database and ClickHouse Mastery for Java Engineers**  
> Bagian: **016 dari 034**  
> Status seri: **belum selesai**  
> Fokus: memahami optimasi akses selain primary sorting key: **projections**, **data skipping indexes**, dan cara memilih secondary access path tanpa jatuh ke mental model B-tree OLTP.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membangun pondasi:

- OLAP workload berbeda dari OLTP.
- ClickHouse membaca data secara columnar.
- `MergeTree` menyimpan data sebagai parts, granules, marks, dan sparse primary index.
- `ORDER BY` adalah keputusan physical clustering paling penting.
- `PARTITION BY` terutama adalah boundary lifecycle.
- schema, tipe data, compression, ingestion, query execution, aggregation, materialized view, dan rollup semua memengaruhi cost.

Part ini membahas satu pertanyaan lanjutan:

> Kalau `ORDER BY` hanya bisa punya satu physical order utama, bagaimana kalau workload punya lebih dari satu pola filter/query penting?

Jawaban ClickHouse bukan langsung “buat banyak index seperti OLTP”. Jawabannya lebih nuanced:

1. Pertama, pilih `ORDER BY` yang benar.
2. Kedua, gunakan pre-aggregation/materialized view jika query butuh hasil turunan berat.
3. Ketiga, gunakan **projections** jika butuh alternate physical layout di table yang sama.
4. Keempat, gunakan **data skipping indexes** jika ada predicate yang bisa membuat ClickHouse melewati granule/blocks besar.
5. Kelima, jangan menambah access path tanpa bukti, karena setiap optimasi punya cost di storage, insert, merge, dan operational complexity.

Di akhir part ini, kamu harus bisa:

- membedakan projection, materialized view, primary key, partition, dan skipping index;
- memahami bagaimana ClickHouse melewati data;
- memilih jenis skipping index yang cocok;
- tahu kapan projection lebih tepat dibanding materialized view;
- membaca apakah index/projection benar-benar digunakan;
- menghindari index cargo-culting;
- membuat eksperimen performa yang valid.

---

## 1. Big Idea: ClickHouse Optimization Is Mostly About Not Reading Data

Dalam OLTP database, optimasi sering terasa seperti:

> “Bagaimana menemukan row spesifik secepat mungkin?”

Dalam ClickHouse, pertanyaannya lebih sering:

> “Bagaimana membuat query tidak perlu membaca mayoritas column chunks yang tidak relevan?”

Ini perbedaan besar.

ClickHouse tidak dirancang untuk melakukan random lookup row-by-row seperti B-tree OLTP engine. ClickHouse kuat ketika:

- data tersusun secara fisik sesuai query pattern;
- hanya kolom yang diperlukan dibaca;
- banyak granule/part/partition bisa dilewati;
- komputasi dilakukan dalam batch/vectorized pipeline;
- aggregation bisa dilakukan secara paralel;
- intermediate state tetap cukup kecil.

Jadi secondary access path di ClickHouse harus dipahami sebagai mekanisme untuk **mengurangi scan**, bukan sebagai index pointer ke row individual.

---

## 2. Recap: Access Path Utama di MergeTree

Sebelum masuk projection dan skipping index, kita perlu menata ulang konsep akses utama.

Pada table `MergeTree`, access path utama biasanya berasal dari:

```sql
CREATE TABLE events
(
    tenant_id UInt64,
    event_date Date,
    event_time DateTime64(3),
    event_type LowCardinality(String),
    user_id UInt64,
    case_id UUID,
    amount Decimal(18, 2)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_date, event_type, event_time);
```

Komponen penting:

| Komponen | Fungsi utama | Bukan untuk |
|---|---|---|
| `PARTITION BY` | lifecycle, pruning kasar, retention, backfill | menggantikan index utama |
| `ORDER BY` | physical clustering, sparse primary index, compression | uniqueness constraint |
| primary index | melewati granule berdasarkan prefix key | row lookup exact seperti OLTP |
| marks | offset untuk membaca column granules | index logical lengkap |
| column pruning | membaca hanya kolom yang diperlukan | mempercepat `SELECT *` |
| compression | mengurangi bytes dibaca | menghilangkan compute cost |

Kalau query sering seperti ini:

```sql
SELECT event_type, count()
FROM events
WHERE tenant_id = 42
  AND event_date >= '2026-06-01'
  AND event_date < '2026-07-01'
GROUP BY event_type;
```

maka `ORDER BY (tenant_id, event_date, ...)` sangat membantu.

Tapi kalau ada query penting seperti:

```sql
SELECT *
FROM events
WHERE case_id = '...';
```

sedangkan `case_id` tidak berada di prefix sorting key, ClickHouse mungkin harus membaca jauh lebih banyak data.

Di sinilah access path tambahan mulai relevan.

---

## 3. Jangan Mulai dari “Index Apa yang Harus Saya Tambah?”

Pertanyaan yang lebih benar:

> “Query mahal ini mahal karena membaca data terlalu banyak, melakukan aggregation terlalu besar, melakukan join terlalu berat, sort terlalu mahal, atau menghasilkan result terlalu besar?”

Index/projection hanya membantu sebagian masalah.

### 3.1 Query lambat karena scan terlalu luas

Kemungkinan solusi:

- sorting key lebih tepat;
- projection dengan alternate sort order;
- skipping index;
- partition pruning lebih baik;
- query rewrite agar filter selaras dengan key;
- pre-filter di serving table.

### 3.2 Query lambat karena aggregation state terlalu besar

Kemungkinan solusi:

- pre-aggregation;
- materialized view;
- approximate aggregate;
- mengurangi group dimensions;
- rollup table;
- distributed aggregation tuning.

Skipping index tidak menyelesaikan high-cardinality `GROUP BY` kalau data tetap harus dibaca.

### 3.3 Query lambat karena join

Kemungkinan solusi:

- denormalization;
- dictionary;
- join algorithm tuning;
- pre-joined serving table;
- materialized view.

Projection bisa membantu beberapa query, tapi bukan obat umum untuk join yang salah model.

### 3.4 Query lambat karena sort result besar

Kemungkinan solusi:

- align order with sorting key/projection;
- top-N precomputation;
- limit by;
- avoid global sort;
- materialized view.

Skipping index tidak membuat sort result besar menjadi murah.

### 3.5 Query lambat karena output terlalu besar

Kalau API mengembalikan jutaan rows, masalahnya bukan hanya database.

Kemungkinan solusi:

- pagination semantics yang benar;
- export flow async;
- object storage output;
- aggregation instead of raw dump;
- result size limit;
- separate interactive vs batch endpoint.

---

## 4. Mental Model: Primary Key, Projection, Materialized View, Skipping Index

Mari bandingkan empat mekanisme yang sering tertukar.

| Mekanisme | Apa itu | Kapan digunakan | Cost utama |
|---|---|---|---|
| Primary sorting key | physical order utama table | pola filter paling umum dan paling selektif | harus dipilih saat desain table; perubahan butuh rebuild |
| Projection | alternate physical representation dalam table yang sama | query penting butuh sort/pre-aggregate berbeda | storage tambahan, merge cost tambahan |
| Materialized view | insert-time transformation ke target table | serving layer, rollup, reshape, aggregate, denormalize | write amplification, consistency/backfill complexity |
| Data skipping index | metadata tambahan per granule/block untuk melewati data | predicate bisa dibuktikan tidak match pada banyak granule | storage/index build/merge cost; false positives |

Rule of thumb:

- **Primary key dulu** untuk query pattern mayoritas.
- **Materialized view** untuk hasil turunan, rollup, serving model, atau transformasi data.
- **Projection** untuk alternate physical layout yang masih logically bagian dari table yang sama.
- **Skipping index** untuk predicate tambahan yang punya locality/correlation cukup agar banyak granule bisa dilewati.

---

## 5. Projections: Alternate Physical Layout Inside the Same Table

Projection adalah fitur ClickHouse yang memungkinkan table menyimpan representasi data tambahan untuk mempercepat query tertentu.

Secara mental:

> Projection adalah “copy internal” dari subset/transformasi data dengan physical order atau aggregation berbeda, yang dapat dipilih optimizer secara otomatis jika cocok.

Contoh table utama:

```sql
CREATE TABLE case_events
(
    tenant_id UInt64,
    event_date Date,
    event_time DateTime64(3),
    case_id UUID,
    actor_id UInt64,
    event_type LowCardinality(String),
    status LowCardinality(String),
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_date, event_type, event_time);
```

Sorting key utama bagus untuk query tenant + date + event type.

Tapi query investigasi sering mencari semua event untuk satu `case_id`:

```sql
SELECT event_time, event_type, status, actor_id
FROM case_events
WHERE tenant_id = 42
  AND case_id = '4c5d6e7f-...'
ORDER BY event_time;
```

Karena `case_id` tidak ada di prefix sorting key utama, query ini bisa mahal.

Projection bisa dibuat:

```sql
ALTER TABLE case_events
ADD PROJECTION prj_by_case
(
    SELECT
        tenant_id,
        case_id,
        event_time,
        event_type,
        status,
        actor_id
    ORDER BY (tenant_id, case_id, event_time)
);
```

Lalu materialize untuk data lama:

```sql
ALTER TABLE case_events
MATERIALIZE PROJECTION prj_by_case;
```

Untuk data baru, projection akan dipelihara saat insert/merge.

---

## 6. Projection vs Materialized View

Projection dan materialized view sama-sama bisa mempercepat query, tapi semantics-nya berbeda.

### 6.1 Projection

Projection:

- melekat pada table;
- digunakan optimizer otomatis jika cocok;
- lebih transparan untuk query caller;
- cocok untuk alternate order atau pre-aggregation yang masih dekat dengan source table;
- tidak menjadi table API terpisah secara eksplisit;
- punya lifecycle mengikuti base table;
- menambah storage dan background merge work.

### 6.2 Materialized view

Materialized view:

- mengalirkan data dari source ke target table;
- target table eksplisit;
- cocok untuk raw → refined → serving;
- cocok untuk rollup multi-resolution;
- cocok untuk reshape schema;
- cocok untuk security/tenant-specific serving layer;
- membutuhkan query diarahkan ke target table;
- backfill dan consistency perlu dikelola eksplisit.

### 6.3 Decision table

| Kebutuhan | Lebih cocok |
|---|---|
| Query sama, hanya butuh alternate sort order | Projection |
| Query perlu pre-aggregate sederhana dalam table sama | Projection atau MV, tergantung governance |
| Query butuh serving table jelas untuk API | Materialized view |
| Query butuh reshape/denormalize/enrich | Materialized view |
| Query harus dipilih otomatis tanpa ubah application SQL | Projection |
| Query harus punya lifecycle, retention, security berbeda | Materialized view |
| Butuh audit raw vs derived secara eksplisit | Materialized view |
| Butuh beberapa downstream models dari raw | Materialized view |

Untuk Java backend, materialized view sering lebih eksplisit dan lebih mudah dijadikan contract API. Projection lebih cocok ketika tim database ingin mengoptimasi table tanpa mengubah application query secara besar.

---

## 7. Projection Types

Secara praktis, projection sering muncul dalam dua bentuk utama:

1. **Normal projection**: menyimpan data dengan order berbeda.
2. **Aggregate projection**: menyimpan hasil aggregation/state.

### 7.1 Normal projection

Contoh:

```sql
ALTER TABLE api_events
ADD PROJECTION prj_by_trace
(
    SELECT
        tenant_id,
        trace_id,
        event_time,
        service_name,
        endpoint,
        latency_ms,
        status_code
    ORDER BY (tenant_id, trace_id, event_time)
);
```

Cocok untuk:

- trace lookup;
- case lookup;
- user journey lookup;
- audit timeline lookup;
- secondary drill-down access.

### 7.2 Aggregate projection

Contoh:

```sql
ALTER TABLE api_events
ADD PROJECTION prj_endpoint_hourly
(
    SELECT
        tenant_id,
        toStartOfHour(event_time) AS hour,
        service_name,
        endpoint,
        count() AS request_count,
        avg(latency_ms) AS avg_latency_ms
    GROUP BY
        tenant_id,
        hour,
        service_name,
        endpoint
);
```

Cocok untuk query dashboard yang selalu agregasi di grain tertentu.

Namun hati-hati:

- aggregate projection tidak selalu menggantikan rollup table;
- metric seperti percentile, distinct count, ratio harus dirancang dengan benar;
- bila API perlu governance dan explicit serving model, MV target table mungkin lebih baik.

---

## 8. Projection Cost Model

Projection bukan gratis.

Projection dapat menambah:

- storage usage;
- insert cost;
- merge cost;
- mutation complexity;
- backfill/materialization time;
- operational observability surface;
- risk optimizer memilih path yang tidak sesuai jika statistik/setting/query tidak cocok.

Projection juga membuat table lebih berat untuk maintenance.

Jika base table 10 TB dan projection menyimpan hampir semua kolom lagi, kamu mungkin mendekati 20 TB logical storage sebelum compression detail.

### 8.1 Kapan projection layak?

Projection layak jika:

- query pattern penting dan sering;
- query tidak cocok dengan primary sorting key utama;
- query bisa dipercepat secara signifikan oleh alternate order/pre-aggregation;
- storage tambahan bisa diterima;
- insert/merge overhead masih aman;
- query SQL ingin tetap transparan;
- manfaat terbukti lewat benchmark.

### 8.2 Kapan projection tidak layak?

Projection tidak layak jika:

- query jarang;
- query lambat karena aggregation cardinality, bukan scan path;
- query lambat karena join/output besar;
- workload belum stabil;
- table masih sering berubah schema;
- storage budget ketat;
- banyak projection ditambahkan tanpa measurement.

---

## 9. Reading Whether Projection Is Used

Jangan percaya bahwa projection pasti digunakan hanya karena ada.

Gunakan `EXPLAIN`.

Contoh:

```sql
EXPLAIN indexes = 1
SELECT event_time, event_type, status
FROM case_events
WHERE tenant_id = 42
  AND case_id = '4c5d6e7f-...'
ORDER BY event_time;
```

Atau:

```sql
EXPLAIN PLAN
SELECT ...;
```

Kamu ingin melihat apakah query plan memilih projection.

Selain itu, ukur:

```sql
SELECT
    query_duration_ms,
    read_rows,
    read_bytes,
    result_rows,
    memory_usage
FROM system.query_log
WHERE type = 'QueryFinish'
  AND query ILIKE '%case_events%'
ORDER BY event_time DESC
LIMIT 20;
```

Metrics yang penting:

- `read_rows` turun?
- `read_bytes` turun?
- `query_duration_ms` turun?
- `memory_usage` turun?
- CPU turun?
- concurrency membaik?
- insert/merge cost naik berapa?

Optimization yang hanya membuat satu query lebih cepat tetapi menghancurkan ingestion/merge bukan optimization sistemik.

---

## 10. Data Skipping Indexes: Metadata untuk Melewati Granules

Data skipping index adalah metadata tambahan yang membantu ClickHouse menentukan apakah satu block/granule mungkin mengandung data yang cocok dengan predicate.

Mental model:

> Skipping index tidak menemukan row. Skipping index membantu membuktikan bahwa sebagian data **tidak mungkin** cocok, sehingga bisa dilewati.

Ini mirip pernyataan:

- “Di granule ini, nilai minimum tanggal adalah 2026-01-01 dan maksimum adalah 2026-01-31. Query mencari tanggal 2026-06-01, jadi granule ini tidak perlu dibaca.”
- “Di granule ini, set status hanya `OPEN`, `CLOSED`. Query mencari `ESCALATED`, jadi granule ini bisa dilewati.”
- “Bloom filter granule ini menyatakan kemungkinan besar tidak ada token `timeout`, jadi skip.”

Data skipping index bekerja baik bila:

- predicate sering dipakai;
- data punya locality/correlation;
- index bisa membuang banyak granule;
- false positives rendah;
- cost membaca index lebih kecil daripada data yang dihindari.

---

## 11. Data Skipping Index Is Not a B-tree Index

Ini kesalahan mental model paling umum.

Dalam OLTP:

```sql
CREATE INDEX idx_user_id ON orders(user_id);
```

sering berarti database bisa langsung menemukan row untuk `user_id = ?`.

Dalam ClickHouse skipping index:

```sql
INDEX idx_user_id user_id TYPE set(1000) GRANULARITY 4
```

artinya ClickHouse punya metadata per index block/granule yang membantu melewati block yang tidak mungkin berisi `user_id` tertentu.

Kalau `user_id` tersebar random di seluruh table, hampir setiap block mungkin mengandung banyak user atau bloom filter memberi banyak possible match. Index menjadi tidak terlalu berguna.

### 11.1 Pertanyaan utama

Bukan:

> “Apakah kolom ini sering difilter?”

Tapi:

> “Apakah nilai kolom ini cukup terkelompok sehingga metadata per granule bisa mengeliminasi banyak granule?”

Kalau tidak, skipping index hanya menambah overhead.

---

## 12. Skipping Index Types

ClickHouse menyediakan beberapa tipe skipping index. Kita bahas mental model dan use case.

### 12.1 `minmax`

Menyimpan nilai minimum dan maksimum untuk expression/column dalam block.

Contoh:

```sql
ALTER TABLE events
ADD INDEX idx_amount amount TYPE minmax GRANULARITY 4;
```

Cocok untuk:

- numeric range;
- date/time range;
- monotonically increasing/correlated values;
- values yang clustered.

Contoh query:

```sql
SELECT count()
FROM events
WHERE amount >= 1000000;
```

`minmax` bagus jika amount besar hanya muncul pada sebagian region data.

Tidak bagus jika:

- nilai tersebar acak;
- hampir setiap granule punya min kecil dan max besar;
- predicate tidak range-compatible.

### 12.2 `set(N)`

Menyimpan set nilai sampai batas `N` dalam block. Jika jumlah distinct dalam block melebihi `N`, index bisa menjadi kurang berguna untuk block tersebut.

Contoh:

```sql
ALTER TABLE case_events
ADD INDEX idx_status status TYPE set(100) GRANULARITY 2;
```

Cocok untuk:

- low-cardinality column;
- equality/in predicate;
- status, event_type, country, severity;
- data yang tidak terlalu random.

Query:

```sql
SELECT count()
FROM case_events
WHERE status = 'ESCALATED';
```

Tidak cocok jika:

- column high-cardinality;
- setiap block punya terlalu banyak distinct values;
- value tersebar merata di seluruh block.

### 12.3 `bloom_filter`

Bloom filter adalah probabilistic index untuk membership. Bisa menjawab:

- “nilai ini pasti tidak ada”; atau
- “nilai ini mungkin ada”.

Ada false positive, tidak ada false negative dalam model normal.

Contoh:

```sql
ALTER TABLE case_events
ADD INDEX idx_case_id case_id TYPE bloom_filter(0.01) GRANULARITY 4;
```

Cocok untuk:

- equality lookup;
- high-cardinality-ish columns;
- UUID/id lookup;
- value cukup sparse;
- false positives masih acceptable.

Tidak cocok jika:

- predicate range;
- query mencari hampir semua data;
- value sangat tersebar sehingga banyak block still possible;
- bloom filter overhead lebih besar dari benefit.

### 12.4 `tokenbf_v1`

Bloom filter berbasis token. Berguna untuk text yang dipisah token.

Contoh:

```sql
ALTER TABLE logs
ADD INDEX idx_message_token message TYPE tokenbf_v1(10240, 3, 0) GRANULARITY 4;
```

Cocok untuk:

- log message search berbasis token;
- `hasToken`-style search;
- mencari kata utuh seperti `timeout`, `exception`, `payment`.

Tidak cocok untuk:

- substring arbitrary;
- regex berat;
- bahasa/tokenization yang tidak sesuai;
- query yang harus seperti search engine penuh.

### 12.5 `ngrambf_v1`

Bloom filter berbasis n-gram. Lebih cocok untuk substring matching.

Contoh:

```sql
ALTER TABLE logs
ADD INDEX idx_message_ngram message TYPE ngrambf_v1(3, 10240, 3, 0) GRANULARITY 4;
```

Cocok untuk:

- substring search;
- partial token matching;
- log/error text tertentu.

Tidak cocok jika:

- text sangat panjang dan random;
- query sangat broad;
- false positive tinggi;
- workload lebih cocok ke Elasticsearch/OpenSearch.

---

## 13. Index Granularity: Trade-off Antara Precision dan Overhead

Skipping index punya `GRANULARITY`.

Contoh:

```sql
INDEX idx_status status TYPE set(100) GRANULARITY 4
```

Secara sederhana:

- granularity lebih kecil: index lebih precise, lebih banyak metadata;
- granularity lebih besar: index lebih kecil, tapi skipping kurang precise.

Jika granularity terlalu besar, satu index block mencakup terlalu banyak data. Kemungkinan besar block tersebut mengandung value yang dicari, sehingga tidak bisa di-skip.

Jika granularity terlalu kecil, overhead index meningkat.

Rule of thumb:

- mulai dari default/reasonable;
- ukur `read_rows` dan `read_bytes`;
- jangan tuning granularity tanpa query benchmark;
- perhatikan insert/merge overhead.

---

## 14. Correlation: Syarat Tersembunyi Skipping Index

Skipping index sangat bergantung pada distribusi data.

Misalnya table sorted by:

```sql
ORDER BY (tenant_id, event_date, event_time)
```

Kolom `event_type` mungkin punya locality jika sistem menulis events per jenis proses tertentu. Tapi bisa juga tersebar merata.

### 14.1 Index bagus

Data physically clustered:

```text
Granule 1: status mostly OPEN
Granule 2: status mostly OPEN
Granule 3: status mostly ESCALATED
Granule 4: status mostly CLOSED
```

Query `status = 'ESCALATED'` bisa melewati granule 1, 2, 4.

### 14.2 Index buruk

Data random:

```text
Granule 1: OPEN, ESCALATED, CLOSED, PENDING
Granule 2: OPEN, ESCALATED, CLOSED, PENDING
Granule 3: OPEN, ESCALATED, CLOSED, PENDING
Granule 4: OPEN, ESCALATED, CLOSED, PENDING
```

Query `status = 'ESCALATED'` tidak bisa skip banyak.

### 14.3 Cara berpikir

Skipping index bekerja baik kalau kolom yang di-index punya **locality** terhadap physical order table.

Locality bisa berasal dari:

- sorting key;
- ingestion order;
- tenant/time clustering;
- business process sequence;
- event generation pattern;
- partitioning.

Kalau tidak ada locality, projection atau materialized view mungkin lebih cocok.

---

## 15. Menambahkan dan Mematerialisasi Skipping Index

Menambahkan index baru biasanya metadata change untuk data baru. Data lama perlu materialization agar index files dibangun untuk existing parts.

Contoh:

```sql
ALTER TABLE case_events
ADD INDEX idx_status status TYPE set(100) GRANULARITY 2;
```

Untuk data lama:

```sql
ALTER TABLE case_events
MATERIALIZE INDEX idx_status;
```

Menghapus:

```sql
ALTER TABLE case_events
DROP INDEX idx_status;
```

Clear index files:

```sql
ALTER TABLE case_events
CLEAR INDEX idx_status;
```

Pada table besar, materialization dapat menjadi background work yang signifikan. Jangan lakukan sembarangan di peak time.

---

## 16. Membaca Apakah Skipping Index Digunakan

Gunakan:

```sql
EXPLAIN indexes = 1
SELECT count()
FROM case_events
WHERE tenant_id = 42
  AND event_date >= '2026-06-01'
  AND status = 'ESCALATED';
```

Perhatikan bagian index analysis.

Kemudian ukur query log:

```sql
SELECT
    query_duration_ms,
    read_rows,
    read_bytes,
    result_rows,
    memory_usage
FROM system.query_log
WHERE type = 'QueryFinish'
  AND query ILIKE '%status =%ESCALATED%'
ORDER BY event_time DESC
LIMIT 10;
```

Jika index bekerja, biasanya terlihat:

- `read_rows` lebih kecil;
- `read_bytes` lebih kecil;
- durasi lebih rendah;
- disk read lebih rendah;
- CPU mungkin turun;
- memory mungkin tidak selalu turun jika aggregation tetap berat.

Tapi hati-hati terhadap cache. Benchmark harus mengontrol:

- warm vs cold cache;
- query concurrency;
- data range;
- repeated run;
- production-like volume.

---

## 17. PREWHERE: Related but Different

`PREWHERE` bukan skipping index, tapi mekanisme optimasi read path.

Dalam wide table, ClickHouse bisa membaca beberapa kolom filter lebih dulu, mengurangi rows sebelum membaca kolom lain yang mahal.

Contoh:

```sql
SELECT
    event_time,
    payload,
    error_stacktrace
FROM logs
PREWHERE tenant_id = 42
    AND event_date = '2026-06-21'
WHERE severity = 'ERROR';
```

Secara umum, ClickHouse sering dapat memindahkan predicate ke PREWHERE otomatis.

Mental model:

- skipping index: membantu melewati granule/block;
- PREWHERE: membantu membaca kolom filter lebih dulu sebelum membaca kolom lain;
- column pruning: membaca hanya kolom yang diperlukan;
- primary index: memanfaatkan physical order;
- projection: alternate physical layout.

Mereka bisa saling melengkapi.

---

## 18. Secondary Access Path Design Framework

Saat menghadapi query lambat, gunakan urutan ini.

### Step 1 — Klasifikasikan query

Pertanyaan:

- Apakah query interactive atau batch?
- Apakah query dashboard, drill-down, search, export, report, alert?
- Apakah query sering atau jarang?
- Apakah query SLA-critical?
- Apakah query tenant-scoped?
- Apakah query time-bounded?

### Step 2 — Baca actual cost

Gunakan:

```sql
EXPLAIN indexes = 1 ...
```

Lalu:

```sql
SELECT
    query_duration_ms,
    read_rows,
    read_bytes,
    result_rows,
    memory_usage
FROM system.query_log
WHERE type = 'QueryFinish'
ORDER BY event_time DESC
LIMIT 20;
```

Jangan optimize berdasarkan feeling.

### Step 3 — Cek apakah primary key sudah cocok

Kalau query utama tidak cocok dengan `ORDER BY`, jangan langsung tambah 10 skipping index. Mungkin table design salah atau butuh projection/MV.

### Step 4 — Cek apakah query butuh alternate order

Jika ya, candidate:

- projection;
- separate serving table via materialized view;
- duplicate table dengan order berbeda.

### Step 5 — Cek apakah predicate bisa skip data

Untuk setiap predicate:

- apakah selective?
- apakah clustered?
- apakah type cocok?
- apakah expression indexable?
- apakah value distribution mendukung?

### Step 6 — Pilih mechanism paling murah

Urutan umum:

1. query rewrite;
2. primary/sorting key design;
3. materialized view/rollup;
4. projection;
5. skipping index;
6. external search/index system jika workload search-heavy.

### Step 7 — Benchmark

Bandingkan sebelum/sesudah:

- p50/p95/p99 latency;
- read rows;
- read bytes;
- CPU;
- memory;
- disk IO;
- insert throughput;
- merge backlog;
- storage size;
- correctness.

---

## 19. Example 1: Regulatory Case Lifecycle Analytics

### 19.1 Workload

Table:

```sql
CREATE TABLE case_events
(
    tenant_id UInt64,
    event_date Date,
    event_time DateTime64(3),
    case_id UUID,
    actor_id UInt64,
    process_id UInt64,
    event_type LowCardinality(String),
    status LowCardinality(String),
    severity LowCardinality(String),
    jurisdiction LowCardinality(String),
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_date, event_type, event_time);
```

Primary workload:

```sql
SELECT event_type, count()
FROM case_events
WHERE tenant_id = 42
  AND event_date >= '2026-01-01'
  AND event_date < '2026-02-01'
GROUP BY event_type;
```

Good fit for primary key.

Secondary workload:

```sql
SELECT event_time, event_type, status, actor_id
FROM case_events
WHERE tenant_id = 42
  AND case_id = '...'
ORDER BY event_time;
```

Potential solution:

```sql
ALTER TABLE case_events
ADD PROJECTION prj_case_timeline
(
    SELECT
        tenant_id,
        case_id,
        event_time,
        event_type,
        status,
        actor_id,
        severity,
        jurisdiction
    ORDER BY (tenant_id, case_id, event_time)
);
```

Why projection?

- case timeline is common drill-down;
- query needs alternate order;
- result remains same logical table;
- application may not need separate serving table.

Alternative:

- materialized view into `case_timeline_serving` if API contract/security/lifecycle differs.

### 19.2 Status filter

Query:

```sql
SELECT count()
FROM case_events
WHERE tenant_id = 42
  AND event_date >= '2026-01-01'
  AND status = 'ESCALATED';
```

Candidate:

```sql
ALTER TABLE case_events
ADD INDEX idx_status status TYPE set(64) GRANULARITY 2;
```

Will it help?

It depends. If `ESCALATED` events are scattered across all tenant/date ranges, maybe not. If escalation happens in clusters or certain event types/time windows, it may help.

### 19.3 Payload text search

Query:

```sql
SELECT event_time, case_id, event_type
FROM case_events
WHERE tenant_id = 42
  AND event_date >= '2026-01-01'
  AND hasToken(payload, 'sanction');
```

Candidate:

```sql
ALTER TABLE case_events
ADD INDEX idx_payload_token payload TYPE tokenbf_v1(10240, 3, 0) GRANULARITY 4;
```

But if payload search becomes core product functionality, ClickHouse may not be enough as a full text search engine. Consider:

- promote structured payload fields to columns;
- maintain search index externally;
- create extracted keyword table;
- materialized view to structured flags.

---

## 20. Example 2: Observability Logs

Table:

```sql
CREATE TABLE logs
(
    tenant_id UInt64,
    event_date Date,
    ts DateTime64(3),
    service LowCardinality(String),
    severity LowCardinality(String),
    trace_id String,
    span_id String,
    message String,
    attributes Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_date, service, severity, ts);
```

### 20.1 Service/severity query

```sql
SELECT count()
FROM logs
WHERE tenant_id = 10
  AND event_date = '2026-06-21'
  AND service = 'payment'
  AND severity = 'ERROR';
```

Already good because `service` and `severity` align with order key after tenant/date.

### 20.2 Trace lookup

```sql
SELECT ts, service, severity, message
FROM logs
WHERE tenant_id = 10
  AND trace_id = 'abc...'
ORDER BY ts;
```

Candidate projection:

```sql
ALTER TABLE logs
ADD PROJECTION prj_trace
(
    SELECT
        tenant_id,
        trace_id,
        ts,
        service,
        severity,
        message
    ORDER BY (tenant_id, trace_id, ts)
);
```

Alternative:

- separate trace index table;
- dedicated tracing backend;
- materialized view by trace.

### 20.3 Message token search

```sql
SELECT ts, service, message
FROM logs
WHERE tenant_id = 10
  AND event_date = '2026-06-21'
  AND hasToken(message, 'timeout');
```

Candidate:

```sql
ALTER TABLE logs
ADD INDEX idx_message_token message TYPE tokenbf_v1(20480, 4, 0) GRANULARITY 4;
```

But benchmark carefully. Text search indexes can create significant metadata and false positive behavior.

---

## 21. Example 3: Product Analytics with User Drilldown

Table:

```sql
CREATE TABLE product_events
(
    tenant_id UInt64,
    event_date Date,
    event_time DateTime64(3),
    event_name LowCardinality(String),
    user_id UInt64,
    session_id UUID,
    country LowCardinality(String),
    device LowCardinality(String),
    properties Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_date, event_name, event_time);
```

Dashboard:

```sql
SELECT event_name, count()
FROM product_events
WHERE tenant_id = 7
  AND event_date >= '2026-06-01'
GROUP BY event_name;
```

Good.

User journey:

```sql
SELECT event_time, event_name, properties
FROM product_events
WHERE tenant_id = 7
  AND user_id = 123
ORDER BY event_time;
```

Candidate projection:

```sql
ALTER TABLE product_events
ADD PROJECTION prj_user_journey
(
    SELECT
        tenant_id,
        user_id,
        event_time,
        event_name,
        session_id,
        country,
        device
    ORDER BY (tenant_id, user_id, event_time)
);
```

But if `properties` is large and frequently needed, projection storing it may double large string/map storage. Alternative:

- projection without `properties`, then fetch raw if necessary;
- separate user journey serving table with selected fields;
- promote key properties to columns.

---

## 22. Expression Indexes

Skipping indexes can be defined on expressions, not only raw columns.

Example:

```sql
ALTER TABLE api_events
ADD INDEX idx_status_class intDiv(status_code, 100) TYPE set(10) GRANULARITY 2;
```

Query:

```sql
SELECT count()
FROM api_events
WHERE intDiv(status_code, 100) = 5;
```

Potentially useful for HTTP 5xx filtering.

But beware:

- expression in query must match/allow optimizer to use index;
- expression computation has cost;
- sometimes better to add materialized column:

```sql
status_class UInt8 MATERIALIZED intDiv(status_code, 100)
```

then index/filter on `status_class`.

For production, materialized columns often make query patterns clearer and less fragile.

---

## 23. Functional Predicates Can Defeat Skipping

Bad:

```sql
WHERE toDate(event_time) = '2026-06-21'
```

Better if you have `event_date` column:

```sql
WHERE event_date = '2026-06-21'
```

Bad:

```sql
WHERE lower(status) = 'closed'
```

Better:

- normalize status at ingestion;
- use `LowCardinality(String)`;
- store canonical uppercase/lowercase.

Bad:

```sql
WHERE JSONExtractString(payload, 'riskLevel') = 'HIGH'
```

Better:

```sql
risk_level LowCardinality(String) MATERIALIZED JSONExtractString(payload, 'riskLevel')
```

or extract at ingestion.

Then:

```sql
WHERE risk_level = 'HIGH'
```

Columnar analytics rewards making hot predicates explicit columns.

---

## 24. Skip Index vs Promote Column vs Materialized View

Suppose payload has JSON:

```json
{
  "riskLevel": "HIGH",
  "channel": "MOBILE",
  "ruleId": "AML-017"
}
```

Query frequently filters:

```sql
WHERE JSONExtractString(payload, 'riskLevel') = 'HIGH'
```

Options:

### Option A — Skipping index on expression

```sql
INDEX idx_risk JSONExtractString(payload, 'riskLevel') TYPE set(16) GRANULARITY 2
```

Pros:

- minimal schema change;
- can help if expression supported well.

Cons:

- still parses/extracts expression concerns;
- less explicit;
- possible fragility;
- payload remains hot.

### Option B — Materialized column

```sql
risk_level LowCardinality(String)
    MATERIALIZED JSONExtractString(payload, 'riskLevel')
```

Pros:

- explicit column;
- better compression;
- easier query;
- easier index/key use.

Cons:

- schema change;
- backfill/materialization.

### Option C — Refined table via materialized view

Raw table keeps payload. Refined table extracts fields.

Pros:

- clean raw/refined separation;
- API queries hit structured table;
- governance easier.

Cons:

- more pipeline complexity.

### Recommendation

For frequently filtered fields, prefer explicit columns or refined table. Skipping index is an optimization, not a substitute for data modeling.

---

## 25. Anti-Patterns

### 25.1 Adding index to every filtered column

Bad:

```sql
INDEX idx_a a TYPE bloom_filter GRANULARITY 4,
INDEX idx_b b TYPE bloom_filter GRANULARITY 4,
INDEX idx_c c TYPE bloom_filter GRANULARITY 4,
INDEX idx_d d TYPE bloom_filter GRANULARITY 4
```

Problems:

- storage overhead;
- insert overhead;
- merge overhead;
- little benefit if columns are random;
- harder debugging.

### 25.2 Expecting skipping index to fix wrong `ORDER BY`

If most important query is by `case_id`, but table sorted by `(event_date, event_type)`, adding bloom filter may help but may not be enough. Projection or table redesign may be needed.

### 25.3 Creating projection for every query

Projection explosion is real.

Problems:

- table becomes heavy;
- merges become expensive;
- storage balloons;
- optimization becomes opaque;
- mutations/backfills more complex.

### 25.4 Indexing high-cardinality random columns with `set`

`set(N)` on random UUID/user_id often becomes ineffective because each block has too many distinct values.

### 25.5 Using text bloom filter as search engine replacement

ClickHouse can support some token/substring search patterns, especially logs analytics, but it is not automatically a replacement for dedicated search workloads with scoring, fuzzy matching, complex relevance, or arbitrary text exploration.

### 25.6 Benchmarking on tiny data

Skipping indexes and projections may look irrelevant on tiny data or amazing due to cache. Benchmark on production-like scale.

### 25.7 Measuring only latency

Need measure:

- latency;
- read rows;
- read bytes;
- memory;
- CPU;
- storage;
- insert throughput;
- merge backlog;
- concurrency.

---

## 26. Production Benchmark Methodology

### 26.1 Establish baseline

For candidate query:

```sql
EXPLAIN indexes = 1
SELECT ...;
```

Then run query several times and collect:

```sql
SELECT
    event_time,
    query_duration_ms,
    read_rows,
    read_bytes,
    result_rows,
    memory_usage,
    ProfileEvents['SelectedMarks'] AS selected_marks,
    ProfileEvents['SelectedRows'] AS selected_rows
FROM system.query_log
WHERE type = 'QueryFinish'
  AND query_id = '...';
```

Exact available `ProfileEvents` can vary by version/settings, but the principle stands: collect actual execution metrics.

### 26.2 Apply one change

Only one:

- add projection; or
- add skipping index; or
- rewrite query; or
- change table design in test clone.

### 26.3 Materialize if needed

For projection:

```sql
ALTER TABLE t MATERIALIZE PROJECTION prj_name;
```

For index:

```sql
ALTER TABLE t MATERIALIZE INDEX idx_name;
```

### 26.4 Re-run with comparable conditions

Avoid invalid comparisons:

- same date range;
- same tenant;
- same concurrency;
- similar cache condition;
- similar data freshness;
- enough repeated runs.

### 26.5 Measure write path too

After adding projection/index, observe:

```sql
SELECT
    table,
    count() AS active_parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS size
FROM system.parts
WHERE active
  AND database = currentDatabase()
GROUP BY table;
```

And:

```sql
SELECT *
FROM system.merges
WHERE database = currentDatabase();
```

Also watch ingestion latency and part count.

---

## 27. Design Matrix

| Problem | Primary candidate | Why |
|---|---|---|
| Main dashboard filters by tenant/date/event | Sorting key | access path utama |
| Secondary drilldown by case_id | Projection or serving table | alternate physical order |
| Hourly dashboard aggregate | MV/rollup or aggregate projection | avoid repeated aggregation |
| Filter by low-cardinality status | `set` skipping index if clustered | skip granules with no status |
| Filter by numeric range not in key | `minmax` if correlated | skip out-of-range blocks |
| Lookup high-cardinality id | bloom filter or projection | depends frequency/selectivity |
| Token search in logs | `tokenbf_v1` | skip blocks without token |
| Substring search | `ngrambf_v1` | probabilistic substring pruning |
| JSON field frequently filtered | materialized column/refined table | model hot fields explicitly |
| Full search product | dedicated search system or hybrid | ClickHouse index not enough |
| Report needs business grain table | materialized view serving table | explicit contract and governance |

---

## 28. Java/System Architecture Perspective

As Java engineer, jangan melihat projection/index sebagai purely database concern. Access path design memengaruhi API dan service design.

### 28.1 Analytics API should expose supported query shapes

Bad API:

```http
GET /events?filter=any_arbitrary_expression
```

This invites unbounded queries.

Better:

```http
GET /analytics/cases/{caseId}/timeline
GET /analytics/events/summary?tenantId=&from=&to=&eventType=
GET /analytics/logs/search?tenantId=&from=&to=&service=&severity=&token=
```

Setiap endpoint punya known query shape dan bisa didukung oleh:

- primary sorting key;
- projection;
- materialized view;
- skipping index;
- external search.

### 28.2 Query planner at application layer

Untuk analytics API, sering berguna punya routing layer:

```text
Request shape
  -> choose raw table / rollup table / projection-compatible query / export flow
  -> enforce limits
  -> set query settings
  -> execute
  -> observe query_id
```

Jangan biarkan semua request jadi arbitrary SQL langsung ke ClickHouse.

### 28.3 Timeouts and degradation

Jika query path tidak didukung access path:

- fail fast;
- return guidance;
- route to async export;
- use lower-resolution rollup;
- restrict time range;
- require additional filter.

### 28.4 Query ID for observability

Set query id dari Java service agar bisa trace:

```text
analytics.case.timeline.tenant42.req-abc123
```

Kemudian query log bisa dikorelasikan dengan API request.

---

## 29. Failure Modeling

### Failure 1 — Projection materialization overload

Symptom:

- merges/backfills heavy;
- disk IO high;
- query latency unstable;
- replication lag.

Cause:

- adding projection to huge table and materializing during peak;
- projection stores too many columns.

Mitigation:

- materialize during low traffic;
- clone/test first;
- apply per partition where possible;
- consider serving table instead;
- monitor merges and disk.

### Failure 2 — Skipping index no-op

Symptom:

- index exists;
- query still reads same rows/bytes;
- `EXPLAIN indexes = 1` shows little/no pruning.

Cause:

- data not clustered;
- granularity too coarse;
- wrong index type;
- predicate expression mismatch;
- query not selective.

Mitigation:

- benchmark distribution;
- choose projection/table redesign;
- promote column;
- drop useless index.

### Failure 3 — Write path slowed by too many access paths

Symptom:

- ingestion latency increases;
- background merges lag;
- disk grows unexpectedly;
- `Too many parts` risk rises.

Cause:

- too many projections/indexes;
- projections duplicate large columns;
- high insert rate.

Mitigation:

- reduce projections;
- use MV serving table only for critical query;
- batch inserts;
- monitor parts/merges.

### Failure 4 — Optimizer does not choose projection

Symptom:

- projection exists and materialized;
- query not using it.

Cause:

- query shape not compatible;
- selected columns not covered;
- settings/version behavior;
- query expression differs;
- projection not materialized for parts.

Mitigation:

- inspect `EXPLAIN`;
- simplify query;
- ensure projection covers needed columns;
- verify materialization;
- consider explicit serving table.

### Failure 5 — Text index creates false confidence

Symptom:

- simple token query okay;
- complex search slow;
- users expect search-engine behavior.

Cause:

- ClickHouse used beyond intended text search pattern.

Mitigation:

- define supported search semantics;
- extract structured fields;
- hybrid with OpenSearch/Elasticsearch if needed;
- route broad searches to async/export.

---

## 30. Practical SQL Snippet Library

### 30.1 Add projection by alternate order

```sql
ALTER TABLE case_events
ADD PROJECTION prj_by_case
(
    SELECT
        tenant_id,
        case_id,
        event_time,
        event_type,
        status,
        actor_id
    ORDER BY (tenant_id, case_id, event_time)
);

ALTER TABLE case_events
MATERIALIZE PROJECTION prj_by_case;
```

### 30.2 Add aggregate projection

```sql
ALTER TABLE api_events
ADD PROJECTION prj_endpoint_hourly
(
    SELECT
        tenant_id,
        toStartOfHour(event_time) AS hour,
        endpoint,
        count() AS request_count,
        avg(latency_ms) AS avg_latency_ms
    GROUP BY
        tenant_id,
        hour,
        endpoint
);
```

### 30.3 Add minmax index

```sql
ALTER TABLE payments
ADD INDEX idx_amount amount TYPE minmax GRANULARITY 4;

ALTER TABLE payments
MATERIALIZE INDEX idx_amount;
```

### 30.4 Add set index

```sql
ALTER TABLE case_events
ADD INDEX idx_status status TYPE set(64) GRANULARITY 2;

ALTER TABLE case_events
MATERIALIZE INDEX idx_status;
```

### 30.5 Add bloom filter index

```sql
ALTER TABLE case_events
ADD INDEX idx_case_id case_id TYPE bloom_filter(0.01) GRANULARITY 4;

ALTER TABLE case_events
MATERIALIZE INDEX idx_case_id;
```

### 30.6 Add token bloom filter index

```sql
ALTER TABLE logs
ADD INDEX idx_msg_token message TYPE tokenbf_v1(10240, 3, 0) GRANULARITY 4;

ALTER TABLE logs
MATERIALIZE INDEX idx_msg_token;
```

### 30.7 Add ngram bloom filter index

```sql
ALTER TABLE logs
ADD INDEX idx_msg_ngram message TYPE ngrambf_v1(3, 10240, 3, 0) GRANULARITY 4;

ALTER TABLE logs
MATERIALIZE INDEX idx_msg_ngram;
```

### 30.8 Explain index usage

```sql
EXPLAIN indexes = 1
SELECT count()
FROM case_events
WHERE tenant_id = 42
  AND event_date >= '2026-06-01'
  AND status = 'ESCALATED';
```

### 30.9 Query log metrics

```sql
SELECT
    event_time,
    query_duration_ms,
    read_rows,
    read_bytes,
    result_rows,
    memory_usage,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND query ILIKE '%case_events%'
ORDER BY event_time DESC
LIMIT 20;
```

### 30.10 Drop useless index

```sql
ALTER TABLE case_events
DROP INDEX idx_status;
```

### 30.11 Drop projection

```sql
ALTER TABLE case_events
DROP PROJECTION prj_by_case;
```

---

## 31. Heuristics for Top 1% Engineering Judgment

### Heuristic 1 — If it is the dominant query path, fix the physical model

Do not patch dominant workload with random indexes. Use correct sorting key, projection, or serving table.

### Heuristic 2 — If it is a derived product/API, use serving table

For analytics APIs with explicit contract, materialized view target tables are often cleaner than hidden projection behavior.

### Heuristic 3 — If it is a predicate on clustered data, skipping index may work

Especially `set` and `minmax` on values with locality.

### Heuristic 4 — If it is a random high-cardinality lookup, projection may beat bloom filter

If lookup is common and latency-critical, physically cluster data by that lookup key somewhere.

### Heuristic 5 — If field is frequently filtered, make it a real column

Do not repeatedly parse JSON in hot queries.

### Heuristic 6 — Measure read reduction, not just query duration

Latency can be noisy. `read_rows` and `read_bytes` reveal whether access path actually improved.

### Heuristic 7 — Every access path is a write-path tax

Projections and indexes are not free. They affect inserts, merges, storage, mutations, and operations.

### Heuristic 8 — Delete useless indexes

A useless index is negative value: extra overhead, no query benefit.

---

## 32. Checklist: Before Adding Projection or Skipping Index

### Query understanding

- [ ] Is query frequent?
- [ ] Is query SLA-critical?
- [ ] Is query interactive or batch/export?
- [ ] Is query tenant/time bounded?
- [ ] Is query slow because of scan, aggregation, join, sort, or output?

### Baseline measurement

- [ ] Have you captured `EXPLAIN indexes = 1`?
- [ ] Have you captured `read_rows`?
- [ ] Have you captured `read_bytes`?
- [ ] Have you captured memory usage?
- [ ] Have you captured p95/p99 latency?

### Projection decision

- [ ] Is alternate physical order needed?
- [ ] Are required columns covered?
- [ ] Is storage overhead acceptable?
- [ ] Is insert/merge overhead acceptable?
- [ ] Is optimizer likely to use it?
- [ ] Would an explicit MV serving table be clearer?

### Skipping index decision

- [ ] Is predicate selective?
- [ ] Is column clustered/localized enough?
- [ ] Is index type appropriate?
- [ ] Is granularity reasonable?
- [ ] Is data old enough materialized?
- [ ] Does `EXPLAIN` show pruning?
- [ ] Does query log show reduced reads?

### Operational safety

- [ ] Will materialization happen outside peak?
- [ ] Is disk budget enough?
- [ ] Are merges monitored?
- [ ] Is rollback/drop plan ready?
- [ ] Are Java API query patterns controlled?

---

## 33. Exercises

### Exercise 1 — Choose access path

You have table:

```sql
ORDER BY (tenant_id, event_date, event_type, event_time)
```

Queries:

1. tenant/date/event_type dashboard count;
2. case_id timeline lookup;
3. status = ESCALATED count;
4. payload contains token `fraud`;
5. daily report grouped by jurisdiction and event_type.

For each, choose:

- primary key already enough;
- projection;
- skipping index;
- materialized view;
- external system;
- no optimization needed.

Explain why.

### Exercise 2 — Index effectiveness reasoning

You add:

```sql
INDEX idx_status status TYPE set(100) GRANULARITY 4
```

But query still reads almost all rows.

List five possible reasons.

### Exercise 3 — Projection vs MV

A Java analytics endpoint needs:

```text
GET /tenants/{tenantId}/cases/{caseId}/timeline
```

The table is sorted by tenant/date/event_type. Would you use projection or materialized view? What factors decide?

### Exercise 4 — JSON field promotion

A payload field `riskLevel` is used in 70% of dashboard queries. Design three possible implementations and pick one.

### Exercise 5 — Failure review

A team added six projections and ten skipping indexes to a 20 TB table. Ingestion slowed and merges lag. Create a remediation plan.

---

## 34. Summary

Secondary access paths in ClickHouse are powerful, but they require the right mental model.

Key points:

1. ClickHouse optimization is mostly about **not reading data**.
2. `ORDER BY` remains the most important access path.
3. Projection gives alternate physical layout or aggregation inside the same table.
4. Materialized view creates explicit derived/serving tables.
5. Data skipping indexes help skip granules; they are not B-tree row lookup indexes.
6. Skipping index effectiveness depends heavily on data locality/correlation.
7. `minmax`, `set`, `bloom_filter`, `tokenbf_v1`, and `ngrambf_v1` solve different problems.
8. `EXPLAIN indexes = 1` and `system.query_log` are mandatory for validation.
9. Every projection/index adds storage and write-path cost.
10. The best design often combines: correct sorting key, explicit hot columns, pre-aggregation, carefully chosen projections, and minimal skipping indexes.

The top-level discipline is:

> Do not add access paths because columns are filtered. Add access paths because measured query cost shows data can be skipped or served from a better physical layout.

---

## 35. Referensi Utama

Referensi yang relevan untuk pendalaman:

- ClickHouse documentation — Projections.
- ClickHouse documentation — Understanding ClickHouse data skipping indexes.
- ClickHouse documentation — Data skipping index examples.
- ClickHouse documentation — Use data skipping indices where appropriate.
- ClickHouse documentation — Choosing a primary key.
- ClickHouse documentation — Query optimization guide.
- ClickHouse documentation — ALTER statements for skipping indexes.
- ClickHouse documentation — EXPLAIN.
- ClickHouse documentation — MergeTree table engine.

---

## 36. Status Seri

Part ini adalah:

```text
Part 016 dari 034
```

Seri **belum selesai**.

Part berikutnya:

```text
Part 017 — Joins in ClickHouse: Algorithms, Dictionaries, Denormalization, and Trade-offs
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-015.md">⬅️ Part 015 — Materialized Views II: Rollups, Pre-Aggregation, and Serving Tables</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-017.md">Part 017 — Joins in ClickHouse: Algorithms, Dictionaries, Denormalization, and Trade-offs ➡️</a>
</div>

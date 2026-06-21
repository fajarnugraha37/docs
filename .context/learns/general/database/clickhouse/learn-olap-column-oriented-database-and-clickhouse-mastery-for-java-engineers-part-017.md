# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-017.md

# Part 017 — Joins in ClickHouse: Algorithms, Dictionaries, Denormalization, and Trade-offs

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **017 / 034**  
> Fokus: memahami join dalam ClickHouse sebagai keputusan arsitektural, bukan sekadar operator SQL.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

- OLAP workload anatomy.
- Columnar storage mental model.
- MergeTree internals.
- Sorting key dan partitioning.
- Compression dan data type.
- Ingestion architecture.
- Query execution model.
- Aggregation dan materialized views.
- Projections dan data skipping indexes.

Sekarang kita masuk ke topik yang sering menjadi sumber salah desain dalam analytics system: **JOIN**.

Di sistem OLTP, join sering dianggap normal, natural, dan murah jika index tepat.  
Di sistem OLAP columnar seperti ClickHouse, join tetap didukung, tetapi mental modelnya berbeda.

ClickHouse bisa melakukan join sangat cepat dalam banyak kasus, tetapi join juga bisa menjadi titik paling mahal dari query karena:

1. join sering memaksa materialisasi banyak data;
2. join sering membutuhkan hash table besar di memory;
3. join bisa mengganggu manfaat column pruning;
4. join distributed bisa meledakkan network traffic;
5. join dengan cardinality tidak terkendali bisa memperbanyak rows;
6. join sering menandakan model data belum cocok untuk query shape utama.

Part ini tidak mengulang SQL join dasar seperti `INNER JOIN`, `LEFT JOIN`, dan `ON`. Kita akan fokus pada:

- cost model;
- join algorithms;
- dictionaries;
- denormalization;
- distributed joins;
- dimension modeling;
- production failure modes;
- framework memilih antara join, dictionary, denormalization, materialized view, atau projection.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. menjelaskan kenapa join di OLAP berbeda dari join di OLTP;
2. membaca join sebagai physical execution problem, bukan hanya logical relation;
3. memahami kapan ClickHouse menggunakan hash join, merge join, partial merge, grace hash, dan direct join secara konseptual;
4. memahami kenapa sisi kanan join sering kritikal;
5. membedakan runtime join, dictionary lookup, denormalization, materialized view, dan projection;
6. mendesain dimension strategy untuk workload analytics;
7. menghindari distributed join anti-pattern;
8. membuat query analytics Java API yang tidak menciptakan join explosion;
9. membangun checklist sebelum memasukkan join ke query production;
10. memilih solusi join berdasarkan latency, freshness, cardinality, memory, correctness, dan operability.

---

## 2. Mental Model Utama

### 2.1 Join Bukan “Menghubungkan Tabel”, Join Adalah Membangun Relasi Saat Query Time

Secara logical, join terlihat seperti:

```sql
SELECT
    e.event_date,
    u.country,
    count()
FROM events e
LEFT JOIN users u ON e.user_id = u.user_id
GROUP BY e.event_date, u.country;
```

Secara physical, engine perlu melakukan salah satu dari beberapa hal:

- membaca banyak row dari `events`;
- membaca banyak row dari `users`;
- membangun hash table dari salah satu sisi;
- melakukan lookup per row;
- melakukan sort/merge;
- menukar data antar shard;
- menyimpan intermediate state;
- memperbesar row set jika join menghasilkan many-to-many match;
- mengirim hasil antar pipeline stage.

Jadi join adalah **runtime relationship reconstruction**.

Dalam OLAP, jika query membaca 2 miliar events dan setiap event perlu lookup dimension, pertanyaan utamanya bukan “syntax join benar atau tidak”, tetapi:

> Berapa banyak rows yang harus disentuh, berapa banyak key yang harus disimpan di memory, dan apakah relationship ini seharusnya sudah diprecompute saat ingestion?

---

## 3. OLTP Join vs OLAP Join

### 3.1 OLTP Join

Dalam OLTP, join biasanya:

- mengambil sedikit row;
- memakai B-tree index;
- berjalan dalam transaksi;
- fokus pada single entity atau small result set;
- query sangat selektif;
- latency target rendah untuk operasi user-facing transactional.

Contoh:

```sql
SELECT *
FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.id = ?;
```

Jika `orders.id` dan `customers.id` indexed, query ini murah.

### 3.2 OLAP Join

Dalam OLAP, join sering:

- membaca jutaan sampai miliaran rows;
- melakukan aggregation setelah join;
- membutuhkan dimension enrichment;
- berjalan parallel;
- bottleneck di memory/network/CPU;
- query result kecil, tetapi intermediate besar.

Contoh:

```sql
SELECT
    c.segment,
    toDate(o.created_at) AS day,
    sum(o.amount)
FROM order_events o
LEFT JOIN customer_dimension c ON o.customer_id = c.customer_id
WHERE o.created_at >= now() - INTERVAL 90 DAY
GROUP BY
    c.segment,
    day;
```

Hasilnya mungkin hanya beberapa ratus rows.  
Tetapi intermediate-nya bisa jutaan atau miliaran order events.

### 3.3 Perbedaan Kunci

| Aspek | OLTP | OLAP / ClickHouse |
|---|---|---|
| Query target | Beberapa entity | Banyak rows |
| Join purpose | Fetch related data | Enrichment / grouping / filtering |
| Access pattern | Point lookup | Scan + vectorized processing |
| Index model | Row-level index | Sparse index, sorted parts, skipping |
| Bottleneck umum | Lock/index/random I/O | Memory, CPU, scan volume, network |
| Normalization | Biasanya sehat | Sering terlalu mahal |
| Denormalization | Kadang duplikasi | Sering strategi utama |
| Correctness | Current transactional truth | Historical/event-time truth |

---

## 4. Kenapa Join Mahal di Columnar Analytics

### 4.1 Columnar Scan Suka Membaca Sedikit Kolom, Banyak Rows

Columnar database sangat cepat ketika query seperti ini:

```sql
SELECT
    event_date,
    event_type,
    count()
FROM events
WHERE event_date >= today() - 7
GROUP BY
    event_date,
    event_type;
```

Ia hanya perlu membaca beberapa kolom:

- `event_date`;
- `event_type`;
- mungkin tidak perlu membaca payload lain.

Join bisa memaksa engine membaca kolom tambahan:

- join key di left table;
- join key di right table;
- dimension attributes;
- nullable marker;
- intermediate columns.

### 4.2 Join Bisa Menghilangkan Kesederhanaan Pipeline

Pipeline tanpa join:

```text
Read columns
→ filter
→ aggregate
→ merge aggregate
→ output
```

Pipeline dengan join:

```text
Read right table
→ build hash table / prepare join structure
→ read left table
→ probe join structure
→ materialize joined columns
→ filter or aggregate
→ output
```

Atau pada distributed query:

```text
Read shards
→ exchange data
→ build/probe join structures
→ aggregate partials
→ merge across cluster
→ output
```

### 4.3 Join Bisa Membesarkan Data

One-to-one join relatif aman.

One-to-many join bisa memperbesar rows.

Many-to-many join bisa meledak.

Misalnya:

```text
events: 1,000,000 rows
campaign_rules: 20 matching rules per event
joined output: 20,000,000 rows
```

Jika setelah itu masih ada group by cardinality tinggi, memory bisa naik drastis.

### 4.4 Join Key Cardinality Menentukan Memory

Hash join biasanya membutuhkan struktur memory untuk sisi kanan.

Jika right side:

- kecil;
- unique by key;
- hanya beberapa kolom;
- sudah difilter;

maka join bisa murah.

Jika right side:

- besar;
- banyak duplicate key;
- banyak kolom;
- tidak difilter;
- high cardinality;

maka query bisa memory-heavy.

---

## 5. First Principle: Sisi Kanan Join Itu Penting

Banyak engine hash join membangun hash table dari salah satu sisi input. Dalam ClickHouse, secara praktis, desain query sering harus memperhatikan **right-hand side** dari join.

Contoh buruk:

```sql
SELECT ...
FROM large_events e
LEFT JOIN huge_dimension_history d
    ON e.user_id = d.user_id;
```

Jika `huge_dimension_history` sangat besar dan tidak difilter, engine harus menangani right side besar.

Lebih baik:

```sql
SELECT ...
FROM large_events e
LEFT JOIN
(
    SELECT
        user_id,
        argMax(segment, updated_at) AS segment
    FROM user_dimension_history
    WHERE updated_at <= now()
    GROUP BY user_id
) d
ON e.user_id = d.user_id;
```

Atau lebih baik lagi: precompute latest dimension table.

```sql
CREATE TABLE user_dimension_current
(
    user_id UInt64,
    segment LowCardinality(String),
    country LowCardinality(String),
    updated_at DateTime64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY user_id;
```

Kemudian join ke table yang jauh lebih kecil dan unique.

---

## 6. Join Strictness: ALL, ANY, SEMI, ANTI, ASOF

ClickHouse mendukung berbagai bentuk join. Yang penting untuk analytics bukan hanya tipe logical join, tetapi juga **strictness**.

### 6.1 ALL JOIN

`ALL` mempertahankan semua match.

Jika key duplicate di right side, output bisa berlipat.

```sql
SELECT *
FROM events e
LEFT ALL JOIN user_segments s
ON e.user_id = s.user_id;
```

Jika user punya 5 segment records, satu event menjadi 5 rows.

Gunakan jika memang butuh semua kombinasi.

### 6.2 ANY JOIN

`ANY` mengambil satu match untuk key.

```sql
SELECT *
FROM events e
LEFT ANY JOIN user_current_segment s
ON e.user_id = s.user_id;
```

Ini sering lebih cocok untuk dimension lookup.

Tapi harus hati-hati: jika right side tidak unique, “satu match” harus bisa diterima secara business logic. Jangan pakai `ANY` untuk menyembunyikan data quality problem.

### 6.3 SEMI JOIN

`SEMI JOIN` mengecek keberadaan match, tetapi tidak menggandakan kolom right table.

Contoh konsep:

```sql
SELECT e.*
FROM events e
LEFT SEMI JOIN allowed_users u
ON e.user_id = u.user_id;
```

Cocok untuk filtering existence.

### 6.4 ANTI JOIN

`ANTI JOIN` mengambil row yang tidak punya match.

```sql
SELECT e.*
FROM events e
LEFT ANTI JOIN blocked_users b
ON e.user_id = b.user_id;
```

Cocok untuk exclusion.

### 6.5 ASOF JOIN

`ASOF JOIN` berguna untuk time-aligned lookup, misalnya harga terakhir sebelum event, config effective saat event, atau status sebelumnya.

Contoh:

```sql
SELECT
    e.event_id,
    e.event_time,
    r.rate
FROM events e
ASOF LEFT JOIN rates r
ON e.currency = r.currency
AND e.event_time >= r.effective_time;
```

ASOF join sering relevan untuk event-time correctness.

Namun untuk workload besar, pertimbangkan apakah hasilnya perlu diprecompute.

---

## 7. Join Algorithms Secara Konseptual

ClickHouse memiliki beberapa join algorithm. Detail implementasi dapat berubah antar versi, jadi yang paling penting adalah memahami cost model-nya.

### 7.1 Hash Join

Mental model:

```text
Build hash table dari right side
Probe hash table dengan left side
```

Cocok jika:

- right table cukup kecil untuk memory;
- join key hashable;
- query butuh general-purpose join;
- right side bisa difilter ketat.

Risiko:

- memory tinggi;
- OOM jika right side besar;
- duplicate key memperbesar payload;
- distributed join bisa mahal.

Contoh:

```sql
SELECT
    e.day,
    d.country,
    count()
FROM events e
LEFT JOIN users_current d
ON e.user_id = d.user_id
WHERE e.day >= today() - 7
GROUP BY
    e.day,
    d.country;
```

Jika `users_current` kecil dan unique by `user_id`, hash join masuk akal.

### 7.2 Parallel Hash Join

Mental model:

```text
Build/probe hash table secara parallel
```

Cocok untuk:

- right side masih muat memory;
- butuh throughput tinggi;
- CPU tersedia.

Risiko:

- memory bisa lebih tinggi;
- overhead parallelization.

### 7.3 Grace Hash Join

Mental model:

```text
Partition input ke bucket
Join bucket-by-bucket
Spill jika perlu
```

Cocok jika:

- right side terlalu besar untuk memory;
- masih ingin hash-based join;
- disk spill dapat diterima.

Trade-off:

- lebih stabil memory;
- lebih lambat;
- butuh temporary disk;
- perlu tuning.

### 7.4 Full Sorting Merge Join

Mental model:

```text
Sort kedua sisi berdasarkan join key
Merge seperti merge step
```

Cocok jika:

- kedua sisi besar;
- data sudah atau bisa disort by join key;
- memory harus lebih terkendali;
- sort cost dapat diterima.

Jika physical order table sudah align dengan join key, sort cost bisa berkurang.

### 7.5 Partial Merge Join

Mental model:

```text
Sort right side penuh
Sort left side block-wise
Merge dengan memory lebih rendah
```

Cocok jika:

- memory lebih penting daripada speed;
- right side besar;
- query tidak bisa memakai hash join dengan aman.

Trade-off:

- cenderung lebih lambat;
- lebih kompleks;
- cocok sebagai fallback stabilitas.

### 7.6 Direct Join

Mental model:

```text
Probe key-value structure langsung
```

Cocok jika:

- right side adalah dictionary atau table engine dengan key-value lookup characteristic;
- join adalah `LEFT ANY` atau `INNER` pattern yang compatible;
- lookup dimension relatif kecil dan cocok di memory/cache.

Ini sering menjadi strategi terbaik untuk dimension enrichment.

---

## 8. Direct Join dan Dictionaries

### 8.1 Apa Itu Dictionary di ClickHouse?

Dictionary adalah struktur lookup key-value yang dikelola ClickHouse. Ia bisa mengambil data dari sumber seperti:

- file;
- HTTP;
- MySQL/PostgreSQL;
- ClickHouse table;
- executable source;
- dan lain-lain tergantung konfigurasi.

Konsepnya:

```text
key → attributes
```

Contoh:

```text
user_id → country, segment, risk_level
case_type_id → case_type_name, severity_group
agency_id → agency_name, region
```

### 8.2 Kenapa Dictionary Penting?

Karena banyak join analytics sebenarnya bukan relational join penuh. Banyak yang hanya:

> Untuk setiap event, ambil attribute kecil berdasarkan key.

Itu lookup, bukan analytical join besar.

Daripada:

```sql
SELECT
    e.event_date,
    d.segment,
    count()
FROM events e
LEFT JOIN user_dimension d
ON e.user_id = d.user_id
GROUP BY
    e.event_date,
    d.segment;
```

Kita bisa memakai dictionary function:

```sql
SELECT
    event_date,
    dictGet('user_dim_dict', 'segment', user_id) AS segment,
    count()
FROM events
GROUP BY
    event_date,
    segment;
```

Atau direct join pattern jika compatible.

### 8.3 Dictionary Cocok Untuk

Dictionary cocok jika:

- dimension relatif kecil atau lookup-friendly;
- attribute sering dipakai;
- relationship one-to-one atau many-to-one;
- lookup by key;
- freshness requirement bisa dikelola;
- data bisa di-refresh sesuai lifecycle.

Contoh yang cocok:

- country code;
- tenant metadata;
- user segment current;
- agency/office reference;
- product category;
- case severity mapping;
- enum business label;
- risk bucket definition;
- region mapping.

### 8.4 Dictionary Kurang Cocok Untuk

Dictionary kurang cocok jika:

- dimension sangat besar dan tidak fit memory/cache;
- relationship many-to-many;
- butuh historical as-of lookup kompleks;
- data sangat sering berubah dan freshness harus immediate;
- lookup key composite kompleks tanpa desain;
- query butuh scan dimension besar, bukan lookup.

### 8.5 Dictionary Freshness

Dictionary bukan magic. Ia punya refresh lifecycle.

Pertanyaan yang harus dijawab:

1. Seberapa sering dimension berubah?
2. Apakah analytics harus melihat update langsung?
3. Apakah query harus historical correct?
4. Apakah stale dimension 1 menit/5 menit/1 jam bisa diterima?
5. Apakah perubahan dimension harus memengaruhi event lama?

Contoh penting:

Jika user pindah segment hari ini, apakah report bulan lalu harus berubah?

- Jika iya: dictionary current-state lookup mungkin salah untuk historical reporting.
- Jika tidak: segment sebaiknya ditulis ke event saat ingestion.
- Jika butuh keduanya: simpan `segment_at_event_time` di raw event dan juga allow current lookup untuk operational view.

---

## 9. Denormalization: Strategi Utama, Bukan Dosa

### 9.1 Denormalization di OLAP

Dalam OLTP, denormalization sering dianggap berisiko karena:

- update anomaly;
- storage duplication;
- consistency issue.

Dalam OLAP, denormalization sering sehat karena:

- data append-only;
- query membaca banyak rows;
- storage columnar compressed;
- duplicate low-cardinality attributes murah;
- runtime join mahal;
- historical correctness sering butuh attribute at event time.

Contoh event table:

```sql
CREATE TABLE case_events
(
    tenant_id UInt64,
    case_id UUID,
    event_time DateTime64(3),
    event_type LowCardinality(String),
    actor_user_id UInt64,

    -- denormalized dimensions
    jurisdiction LowCardinality(String),
    case_type LowCardinality(String),
    severity LowCardinality(String),
    enforcement_program LowCardinality(String),

    -- measure/context
    duration_ms UInt32,
    ingest_time DateTime64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, case_id);
```

Atribut seperti `jurisdiction`, `case_type`, `severity` mungkin sudah ada di table lain dalam OLTP. Tetapi untuk analytics, menaruhnya di event sering benar.

### 9.2 Kenapa Denormalized Attributes Murah di Columnar Storage?

Jika kolom:

- low-cardinality;
- sorted/correlated;
- string bisa `LowCardinality`;
- sering dipakai filter/group by;

maka duplication cost sering jauh lebih kecil daripada runtime join cost.

Columnar compression membuat nilai berulang sangat efisien.

### 9.3 Denormalization Untuk Historical Correctness

Misalnya case severity berubah:

```text
2026-01-01: case severity = LOW
2026-02-01: case severity = HIGH
```

Event tanggal Januari seharusnya dihitung sebagai severity apa?

Ada tiga pilihan:

#### A. Current-state reporting

Semua event lama direport dengan severity terbaru.

```text
Jan events now appear as HIGH
```

Cocok untuk: current portfolio view.

#### B. Event-time reporting

Event lama tetap memakai severity saat event terjadi.

```text
Jan events remain LOW
```

Cocok untuk: audit, compliance, regulatory reporting.

#### C. Bitemporal reporting

Bisa melihat report berdasarkan event time dan knowledge/effective time.

Cocok untuk: sistem regulasi kompleks.

Untuk B dan C, runtime join ke current dimension bisa salah. Denormalization atau SCD/as-of strategy lebih tepat.

---

## 10. Dimension Modeling Strategy

### 10.1 Tipe Dimension

#### Static Dimension

Jarang berubah.

Contoh:

- country code;
- event type label;
- currency code;
- severity taxonomy.

Strategi:

- denormalize;
- dictionary;
- `LowCardinality`.

#### Slowly Changing Dimension

Berubah sesekali.

Contoh:

- user segment;
- case severity;
- organization region;
- product category.

Strategi:

- denormalize at event time untuk historical reports;
- maintain current snapshot untuk operational reports;
- maintain history table untuk as-of reports.

#### Rapidly Changing Dimension

Berubah sering.

Contoh:

- account balance;
- user online state;
- risk score real-time;
- current assignment.

Strategi:

- hindari join runtime besar;
- snapshot periodically;
- event-log changes;
- materialize serving table;
- hati-hati current lookup.

#### Many-to-Many Dimension

Contoh:

- user belongs to many groups;
- case has many tags;
- product belongs to multiple campaigns.

Strategi:

- explode saat ingestion jika query sering by tag;
- maintain bridge table hanya jika query terbatas;
- use arrays carefully;
- precompute membership snapshot;
- avoid uncontrolled runtime join.

---

## 11. Pattern: Raw Fact + Denormalized Hot Dimensions + Lookup Cold Dimensions

Strategi praktis:

```text
Raw fact/event table:
- hot dimensions that are frequently filtered/grouped
- event-time attributes needed for correctness
- IDs for drill-down

Dictionary / dimension table:
- cold attributes
- labels
- display names
- rarely used enrichment
```

Contoh:

```sql
CREATE TABLE payment_events
(
    tenant_id UInt64,
    event_time DateTime64(3),
    payment_id UUID,
    customer_id UInt64,

    -- hot dimensions
    country LowCardinality(String),
    payment_method LowCardinality(String),
    risk_bucket LowCardinality(String),

    -- measures
    amount Decimal(18, 2),
    latency_ms UInt32,

    -- cold lookup id
    merchant_id UInt64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, payment_method, customer_id);
```

Query dashboard utama tidak perlu join.

Untuk drill-down display:

```sql
SELECT
    merchant_id,
    dictGet('merchant_dict', 'merchant_name', merchant_id) AS merchant_name,
    sum(amount)
FROM payment_events
WHERE tenant_id = 42
  AND event_time >= now() - INTERVAL 7 DAY
GROUP BY merchant_id
ORDER BY sum(amount) DESC
LIMIT 100;
```

---

## 12. Pattern: Pre-Join Dengan Materialized View

Jika enrichment perlu dilakukan konsisten saat ingestion, materialized view bisa digunakan.

```sql
CREATE TABLE raw_events
(
    tenant_id UInt64,
    event_time DateTime64(3),
    user_id UInt64,
    event_type LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, user_id);
```

Target refined table:

```sql
CREATE TABLE enriched_events
(
    tenant_id UInt64,
    event_time DateTime64(3),
    user_id UInt64,
    event_type LowCardinality(String),
    country LowCardinality(String),
    segment LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_type, user_id);
```

Materialized view:

```sql
CREATE MATERIALIZED VIEW mv_enrich_events
TO enriched_events
AS
SELECT
    tenant_id,
    event_time,
    user_id,
    event_type,
    dictGet('user_dim_dict', 'country', user_id) AS country,
    dictGet('user_dim_dict', 'segment', user_id) AS segment
FROM raw_events;
```

Trade-off:

- query lebih cepat;
- ingestion lebih mahal;
- dimension value captured at insert time;
- kalau dictionary salah/stale, perlu reprocess;
- correctness lebih predictable jika event-time enrichment memang diinginkan.

---

## 13. Pattern: Latest-State Snapshot Table

Untuk dimension current state, buat table snapshot.

```sql
CREATE TABLE user_state_events
(
    user_id UInt64,
    updated_at DateTime64(3),
    country LowCardinality(String),
    segment LowCardinality(String),
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY user_id;
```

Query current dimension:

```sql
SELECT
    user_id,
    argMax(segment, updated_at) AS segment,
    argMax(country, updated_at) AS country
FROM user_state_events
GROUP BY user_id;
```

Atau maintain serving table current state secara periodik/materialized.

Peringatan:

- `ReplacingMergeTree` tidak langsung menghapus versi lama sampai merge;
- `FINAL` bisa mahal;
- untuk query serving cepat, sering perlu table current yang sudah compact/validated.

---

## 14. Pattern: ASOF / Historical Dimension

Untuk event-time dimension:

```sql
CREATE TABLE user_segment_history
(
    user_id UInt64,
    valid_from DateTime64(3),
    segment LowCardinality(String)
)
ENGINE = MergeTree
ORDER BY (user_id, valid_from);
```

Query konsep:

```sql
SELECT
    e.event_time,
    e.user_id,
    h.segment
FROM events e
ASOF LEFT JOIN user_segment_history h
ON e.user_id = h.user_id
AND e.event_time >= h.valid_from;
```

Cocok untuk:

- price at transaction time;
- policy version at decision time;
- assignment at event time;
- risk model version at enforcement time.

Namun untuk data besar, pertimbangkan:

- pre-enrich saat ingestion;
- periodic snapshots;
- materialized tables;
- query scope yang ketat.

---

## 15. Distributed Joins

Distributed join adalah area yang sering mengejutkan.

### 15.1 Local Join

Jika data dishard berdasarkan join key yang sama, tiap shard bisa join secara lokal.

Contoh:

```text
events sharded by user_id
user_dimension sharded by user_id
```

Maka query bisa:

```text
Shard 1: join events_1 with users_1
Shard 2: join events_2 with users_2
Shard 3: join events_3 with users_3
...
Coordinator merges result
```

Ini lebih efisien.

### 15.2 Global Join

Jika right table harus dikirim ke semua shard:

```text
Coordinator reads right table
Broadcast right table to shards
Each shard joins with local left table
```

Ini bisa mahal jika right table besar.

### 15.3 Distributed Join Failure Modes

1. Right table besar dibroadcast ke semua shards.
2. Data tidak colocated by join key.
3. Join menghasilkan intermediate besar di tiap shard.
4. Coordinator overload saat merge.
5. Network bottleneck.
6. Memory OOM di shard karena hash table duplicate.
7. Query tampak cepat di single node, lambat di cluster.

### 15.4 Sharding Key dan Join Key

Jika join sering berdasarkan `tenant_id` atau `user_id`, pertimbangkan shard key yang align.

Namun jangan hanya shard by join key tanpa mempertimbangkan:

- write distribution;
- hot tenants;
- skew;
- query locality;
- rebalancing;
- future join patterns.

Contoh multi-tenant:

```text
Shard by tenant_id:
+ good tenant-local queries
- hot tenant risk
- large tenant can dominate one shard

Shard by hash(user_id):
+ balanced user events
- tenant-level queries fan-out

Shard by tuple(tenant_id, user_id):
+ better tenant+user locality
- more complex distribution
```

---

## 16. Join Selectivity dan Predicate Placement

### 16.1 Filter Sebelum Join

Buruk:

```sql
SELECT ...
FROM events e
LEFT JOIN users u ON e.user_id = u.user_id
WHERE e.event_time >= now() - INTERVAL 1 DAY
  AND u.country = 'ID';
```

Bergantung optimizer dan semantics, filter pada joined dimension bisa terjadi setelah join.

Lebih eksplisit:

```sql
SELECT ...
FROM
(
    SELECT *
    FROM events
    WHERE event_time >= now() - INTERVAL 1 DAY
) e
LEFT JOIN
(
    SELECT user_id, country
    FROM users
    WHERE country = 'ID'
) u
ON e.user_id = u.user_id;
```

Atau jika country adalah hot dimension, denormalize:

```sql
SELECT
    event_date,
    count()
FROM events
WHERE event_time >= now() - INTERVAL 1 DAY
  AND country = 'ID'
GROUP BY event_date;
```

### 16.2 Reduce Columns in Right Side

Jangan:

```sql
LEFT JOIN users u ON e.user_id = u.user_id
```

jika `users` punya 200 kolom.

Lebih baik:

```sql
LEFT JOIN
(
    SELECT
        user_id,
        country,
        segment
    FROM users
) u
ON e.user_id = u.user_id
```

### 16.3 Reduce Duplicates in Right Side

Jangan join ke history table mentah jika butuh current value.

Buruk:

```sql
LEFT JOIN user_segment_history h
ON e.user_id = h.user_id
```

Baik:

```sql
LEFT JOIN
(
    SELECT
        user_id,
        argMax(segment, updated_at) AS segment
    FROM user_segment_history
    GROUP BY user_id
) h
ON e.user_id = h.user_id
```

Lebih baik untuk query sering: maintain current dimension table.

---

## 17. Join vs IN vs Dictionary

### 17.1 Existence Filtering

Jika hanya perlu filter berdasarkan set key, `IN` atau SEMI JOIN bisa lebih tepat daripada join penuh.

```sql
SELECT count()
FROM events
WHERE user_id IN
(
    SELECT user_id
    FROM users
    WHERE country = 'ID'
);
```

Ini tidak perlu membawa kolom right table.

### 17.2 Attribute Lookup

Jika perlu satu attribute by key:

```sql
dictGet('user_dict', 'country', user_id)
```

bisa lebih cocok daripada join.

### 17.3 Multi-Attribute Lookup

Dictionary bisa mengambil beberapa attribute, tetapi jangan berlebihan jika query memanggil banyak `dictGet` per row dan row count sangat besar. Ukur performanya.

Kadang pre-enrichment lebih baik.

### 17.4 Many-to-Many Relationship

Join mungkin diperlukan, tetapi pertimbangkan explode/precompute.

Contoh tags:

```text
case_id → [tag_a, tag_b, tag_c]
```

Jika query sering “count cases by tag”, simpan table:

```sql
CREATE TABLE case_tag_events
(
    tenant_id UInt64,
    case_id UUID,
    event_time DateTime64(3),
    tag LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, tag, event_time, case_id);
```

Daripada join runtime dari events ke bridge tags untuk setiap dashboard.

---

## 18. Join dan Array/Nested Data

ClickHouse punya `ARRAY JOIN`, tetapi perlu hati-hati.

Contoh:

```sql
SELECT
    tag,
    count()
FROM case_events
ARRAY JOIN tags AS tag
GROUP BY tag;
```

Ini menggandakan row sebanyak jumlah tag.

Jika rata-rata tags per event = 10 dan events = 500 juta:

```text
intermediate rows = 5 miliar
```

Bisa sangat mahal.

Strategi alternatif:

1. Simpan exploded table jika query by tag sering.
2. Pre-aggregate by tag.
3. Batasi time range.
4. Gunakan materialized view untuk explode saat ingestion.
5. Jangan expose arbitrary `ARRAY JOIN` di API publik tanpa limit.

---

## 19. Join dan Aggregation Ordering

Urutan logical sering seperti:

```text
join → group by
```

Tetapi sering lebih murah:

```text
pre-aggregate left → join smaller result
```

Contoh buruk:

```sql
SELECT
    u.country,
    count()
FROM events e
LEFT JOIN users u ON e.user_id = u.user_id
WHERE e.event_time >= today() - 30
GROUP BY u.country;
```

Jika events sangat besar, join dilakukan pada semua events.

Alternatif:

```sql
WITH event_counts AS
(
    SELECT
        user_id,
        count() AS events
    FROM events
    WHERE event_time >= today() - 30
    GROUP BY user_id
)
SELECT
    u.country,
    sum(events)
FROM event_counts e
LEFT JOIN users u ON e.user_id = u.user_id
GROUP BY u.country;
```

Ini mengurangi rows sebelum join dari event-level menjadi user-level.

Trade-off:

- benar jika aggregation by user tidak mengubah semantics;
- tidak benar untuk distinct/event-level conditions tertentu;
- perlu memahami metric.

---

## 20. Join dan Metric Correctness

Join bisa merusak metric jika cardinality relationship salah.

### 20.1 Double Counting

```sql
SELECT
    c.campaign_name,
    sum(o.amount)
FROM orders o
JOIN campaign_membership c
ON o.user_id = c.user_id
GROUP BY c.campaign_name;
```

Jika user berada di beberapa campaign, order amount dihitung berkali-kali.

Pertanyaan business:

- Apakah amount memang diatribusi ke semua campaign?
- Apakah perlu fractional attribution?
- Apakah perlu latest campaign only?
- Apakah perlu first-touch/last-touch?
- Apakah perlu bridge table dengan weight?

### 20.2 Distinct Setelah Join

```sql
countDistinct(user_id)
```

mungkin tetap benar setelah one-to-many join, tetapi mahal.

### 20.3 Ratio Setelah Join

Jika numerator dan denominator dipengaruhi join berbeda, ratio bisa salah.

Jangan hanya melihat syntax. Lihat relationship cardinality.

---

## 21. Regulatory / Case Lifecycle Example

### 21.1 Problem

Kita punya analytics untuk enforcement lifecycle:

- cases;
- events;
- assignments;
- agencies;
- officers;
- severity;
- risk programs;
- SLA stages;
- decisions;
- appeals.

Query:

1. jumlah cases by jurisdiction and severity per month;
2. median time from opened to assigned;
3. backlog by current status;
4. escalation rate by officer region;
5. historical report based on severity at event time;
6. current operational dashboard by latest case status.

### 21.2 Bad Design: Runtime Join Everything

```sql
SELECT
    j.name,
    s.name,
    count()
FROM case_events e
JOIN cases c ON e.case_id = c.case_id
JOIN jurisdictions j ON c.jurisdiction_id = j.id
JOIN severity_history s ON c.case_id = s.case_id
JOIN officers o ON e.actor_user_id = o.user_id
WHERE e.event_time >= '2026-01-01'
GROUP BY
    j.name,
    s.name;
```

Masalah:

- join ke `cases`;
- join ke `severity_history`;
- history bisa duplicate;
- current vs historical semantics ambigu;
- right side bisa besar;
- dimension attributes sering dipakai;
- report bisa tidak reproducible.

### 21.3 Better Model: Event-Time Fact Table

```sql
CREATE TABLE case_lifecycle_events
(
    tenant_id UInt64,
    case_id UUID,
    event_time DateTime64(3),
    event_date Date MATERIALIZED toDate(event_time),
    event_type LowCardinality(String),

    jurisdiction LowCardinality(String),
    case_type LowCardinality(String),
    severity_at_event LowCardinality(String),
    program LowCardinality(String),

    actor_user_id UInt64,
    actor_region LowCardinality(String),

    from_status LowCardinality(String),
    to_status LowCardinality(String),

    ingest_time DateTime64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, jurisdiction, case_id);
```

Query:

```sql
SELECT
    toStartOfMonth(event_time) AS month,
    jurisdiction,
    severity_at_event,
    countDistinct(case_id) AS cases
FROM case_lifecycle_events
WHERE tenant_id = 10
  AND event_time >= '2026-01-01'
  AND event_type = 'CASE_OPENED'
GROUP BY
    month,
    jurisdiction,
    severity_at_event;
```

Tidak perlu join untuk report utama.

### 21.4 Current Operational View

Buat current state table:

```sql
CREATE TABLE case_current_state
(
    tenant_id UInt64,
    case_id UUID,
    status LowCardinality(String),
    current_severity LowCardinality(String),
    current_assignee_user_id UInt64,
    current_region LowCardinality(String),
    updated_at DateTime64(3),
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (tenant_id, case_id);
```

Query operational dashboard bisa memakai current state, bukan event history.

### 21.5 Dictionary Untuk Display Name

```sql
dictGet('officer_dict', 'display_name', actor_user_id)
```

Display name tidak perlu disimpan di event jika tidak dipakai filter/group utama.

---

## 22. Product Analytics Example

### 22.1 Query

```text
Daily active users by country, plan, device, acquisition channel.
```

Hot dimensions:

- country;
- plan;
- device;
- acquisition channel.

Jika query ini dashboard utama, simpan di event table.

```sql
CREATE TABLE product_events
(
    tenant_id UInt64,
    event_time DateTime64(3),
    event_name LowCardinality(String),
    user_id UInt64,

    country LowCardinality(String),
    plan LowCardinality(String),
    device_type LowCardinality(String),
    acquisition_channel LowCardinality(String),

    session_id UUID
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_name, event_time, user_id);
```

Query:

```sql
SELECT
    toDate(event_time) AS day,
    country,
    plan,
    device_type,
    uniq(user_id) AS dau
FROM product_events
WHERE tenant_id = 1
  AND event_time >= today() - 30
GROUP BY
    day,
    country,
    plan,
    device_type;
```

No join.

### 22.2 When Join Still Makes Sense

For ad-hoc enrichment:

```sql
SELECT
    d.account_manager,
    sum(revenue)
FROM revenue_events e
LEFT ANY JOIN customer_current_dim d
ON e.customer_id = d.customer_id
WHERE e.event_time >= today() - 30
GROUP BY d.account_manager;
```

If not a hot dashboard query and dimension is small, join is acceptable.

---

## 23. Observability Logs Example

Logs often include attributes:

- service;
- environment;
- region;
- status_code;
- route;
- error_type;
- trace_id;
- span_id.

Do not join logs with service registry for every query if `service`, `env`, and `region` are hot dimensions.

Store them directly:

```sql
CREATE TABLE logs
(
    timestamp DateTime64(3),
    service LowCardinality(String),
    environment LowCardinality(String),
    region LowCardinality(String),
    level LowCardinality(String),
    status_code UInt16,
    route LowCardinality(String),
    trace_id UUID,
    message String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (service, environment, timestamp, level);
```

Use dictionary only for cold metadata:

```sql
dictGet('service_owner_dict', 'team_name', service)
```

---

## 24. Java API Design Implications

### 24.1 Do Not Expose Arbitrary Joins

If your analytics API lets client request arbitrary joins:

```json
{
  "join": ["users", "campaigns", "orders", "tags"]
}
```

you are building a query explosion machine.

Better:

- define curated datasets;
- expose semantic metrics;
- expose dimensions that are already modeled;
- validate allowed group by fields;
- route to correct table;
- limit time range;
- limit cardinality;
- prevent high-risk joins.

### 24.2 Query Builder Should Know Field Origin

Example metadata:

```json
{
  "field": "country",
  "source": "product_events",
  "storage": "denormalized",
  "allowed_in_group_by": true,
  "max_cardinality_class": "medium"
}
```

For dictionary field:

```json
{
  "field": "merchant_name",
  "source": "merchant_dict",
  "storage": "dictionary_lookup",
  "allowed_in_filter": false,
  "allowed_in_group_by": "limited"
}
```

For join-required field:

```json
{
  "field": "account_manager",
  "source": "customer_current_dim",
  "storage": "runtime_join",
  "requires_join": true,
  "allowed_time_range_days": 30
}
```

### 24.3 Guardrails

Add guardrails:

- maximum time range;
- maximum selected dimensions;
- maximum expected cardinality;
- no many-to-many join in interactive APIs;
- require pre-aggregated table for dashboard;
- query timeout;
- memory limit;
- result row limit;
- async export for heavy reports.

### 24.4 Prepared Query Families

Instead of dynamic arbitrary join:

```text
AnalyticsQueryV1
- events_by_day
- conversion_funnel
- active_users_by_dimension
- latency_percentiles
- case_backlog_snapshot
```

Each query family maps to known physical design.

---

## 25. Join Observability

### 25.1 Use EXPLAIN

Examples:

```sql
EXPLAIN PLAN
SELECT ...
```

```sql
EXPLAIN PIPELINE
SELECT ...
```

Look for:

- join stage;
- build side;
- pipeline width;
- sorting;
- exchanges/distributed reads;
- aggregation after join.

### 25.2 Query Log

```sql
SELECT
    query_id,
    query_duration_ms,
    read_rows,
    read_bytes,
    memory_usage,
    result_rows,
    ProfileEvents
FROM system.query_log
WHERE type = 'QueryFinish'
  AND query LIKE '%JOIN%'
ORDER BY event_time DESC
LIMIT 20;
```

Useful signals:

- `read_rows` much larger than expected;
- `memory_usage` high;
- result rows huge;
- query duration spikes;
- ProfileEvents related to join/hash tables.

### 25.3 System Events

ClickHouse exposes various `ProfileEvents` that can help diagnose join behavior. Exact event names can change across versions, so use:

```sql
SELECT *
FROM system.events
WHERE event ILIKE '%Join%';
```

### 25.4 Join-Specific Questions

For every slow join query, ask:

1. How many rows are read from left side?
2. How many rows are read from right side?
3. Is right side filtered?
4. Is right side unique by join key?
5. Is output cardinality bigger than input?
6. Is this join one-to-one, many-to-one, one-to-many, or many-to-many?
7. Is the join happening before aggregation?
8. Could we aggregate before joining?
9. Could this be a dictionary lookup?
10. Could hot attributes be denormalized?
11. Is this distributed join broadcasting large data?
12. Is the join key aligned with shard key?
13. Is memory bounded?
14. Is the result useful enough to justify cost?

---

## 26. Join Tuning Settings: Use Carefully

ClickHouse has join-related settings, including `join_algorithm`.

But tuning setting should be step 4 or 5, not step 1.

Order of optimization:

1. fix model;
2. reduce scanned rows/columns;
3. reduce right side;
4. ensure correct cardinality;
5. consider dictionary/direct join;
6. consider pre-aggregation;
7. consider materialized serving table;
8. only then tune join algorithm/settings.

Why?

Because if you are joining 3 billion rows to a dirty many-to-many dimension, no setting will make the architecture sane.

### 26.1 Example Session Setting

```sql
SET join_algorithm = 'hash';
```

or

```sql
SET join_algorithm = 'grace_hash';
```

Use only after measuring.

### 26.2 Memory Limits

Common controls include query memory limits and external processing settings. These protect cluster stability, but do not fix incorrect query design.

A failed query is better than an unstable cluster.

---

## 27. Decision Framework: Join or Not?

### 27.1 Use Denormalization When

Use denormalization if:

- attribute is frequently filtered/grouped;
- attribute is low/medium cardinality;
- attribute is needed for event-time correctness;
- storage cost is acceptable;
- ingestion can enrich reliably;
- dashboard/API latency matters.

Examples:

- country;
- plan;
- case severity at event time;
- event category;
- jurisdiction;
- service name;
- environment;
- device type.

### 27.2 Use Dictionary When

Use dictionary if:

- right side is lookup-like;
- relationship is many-to-one or one-to-one;
- value can be current or refresh interval acceptable;
- dimension is relatively small or cache-friendly;
- join type matches direct/lookup pattern;
- attribute is not central enough to store on fact table.

Examples:

- display name;
- region label;
- account manager;
- product category label;
- agency name.

### 27.3 Use Runtime Join When

Use runtime join if:

- query is ad hoc or infrequent;
- right side is small and filtered;
- relationship cardinality is well understood;
- data freshness must be current;
- precompute cost is not justified;
- time range is bounded.

### 27.4 Use Materialized View / Serving Table When

Use MV/serving table if:

- query is frequent;
- join is expensive;
- result shape is stable;
- dashboard/API has low latency SLA;
- correctness can be defined at ingestion/build time;
- backfill/rebuild can be operationalized.

### 27.5 Use Projection When

Use projection if:

- same table needs alternate sort/aggregate layout;
- query shape is stable;
- no semantic transformation/join needed;
- storage overhead acceptable.

Projection is not a replacement for dimension modeling.

---

## 28. Relationship Cardinality Checklist

Before joining two tables, classify relationship:

| Relationship | Example | Risk |
|---|---|---|
| One-to-one | user_id → user_current | Usually manageable |
| Many-to-one | events → user_current | Common enrichment |
| One-to-many | user → many events | Row expansion |
| Many-to-many | users ↔ campaigns | Explosion risk |
| Time-dependent many-to-one | event → dimension valid at time | Correctness risk |
| Dirty many-to-one | duplicate current records | Silent metric corruption |

For analytics, relationship classification is not optional. It determines whether metric results are meaningful.

---

## 29. Common Anti-Patterns

### 29.1 Mirroring OLTP Schema Into ClickHouse

Bad:

```text
users
orders
order_items
products
categories
campaigns
campaign_users
sessions
events
```

Then dashboard joins all of them.

Better:

- raw event/fact tables;
- denormalized hot dimensions;
- current snapshots;
- rollups;
- dictionaries;
- curated serving tables.

### 29.2 Joining History Table Without Time Constraint

Bad:

```sql
events e
JOIN user_status_history h ON e.user_id = h.user_id
```

If user has 100 status changes, every event may duplicate 100x.

### 29.3 Using ANY JOIN To Hide Duplicate Bugs

`ANY JOIN` can make query “look correct” but hide dirty dimension.

Always validate uniqueness:

```sql
SELECT
    user_id,
    count()
FROM user_current_dim
GROUP BY user_id
HAVING count() > 1
LIMIT 10;
```

### 29.4 Joining Before Reducing Data

Bad:

```text
scan billion events → join → group
```

Sometimes better:

```text
scan events → group by join key → join smaller result → final group
```

### 29.5 Distributed Join Without Colocation

If large left and right tables are sharded differently, network cost can dominate.

### 29.6 Joining Display Labels in Core Dashboard

If label can be added at API layer or dictionary lookup after aggregation, do not join at event granularity.

### 29.7 Unbounded Ad-Hoc Join API

Letting frontend users pick arbitrary dimensions from arbitrary tables is dangerous unless you have a semantic layer with guardrails.

### 29.8 Many-to-Many Attribution Without Business Rule

If relationship is many-to-many, define attribution rule before writing SQL.

---

## 30. Production Checklist

Before approving a join query for production:

### Semantics

- [ ] Is the relationship one-to-one, many-to-one, one-to-many, or many-to-many?
- [ ] Is the join current-state or event-time/historical?
- [ ] Can duplicates corrupt metrics?
- [ ] Is `ANY` logically safe?
- [ ] Are null/missing matches acceptable?
- [ ] Is double counting handled?

### Performance

- [ ] How many rows does left side read?
- [ ] How many rows does right side read?
- [ ] Is right side filtered?
- [ ] Is right side projected to minimal columns?
- [ ] Is right side unique by key?
- [ ] Can left side be pre-aggregated before join?
- [ ] Does join increase row count?
- [ ] Is memory usage bounded?
- [ ] Has `EXPLAIN` been inspected?
- [ ] Has query been tested on realistic data volume?

### Architecture

- [ ] Should hot dimension be denormalized?
- [ ] Should cold lookup use dictionary?
- [ ] Should query use materialized serving table?
- [ ] Should this be a current snapshot table?
- [ ] Should this be an as-of/historical dimension model?
- [ ] For distributed setup, is data colocated by join key?
- [ ] Is network broadcast acceptable?

### Operations

- [ ] Are query timeout and memory limit set?
- [ ] Is query logged and observable?
- [ ] Are freshness expectations documented?
- [ ] Is backfill/rebuild plan defined if enrichment changes?
- [ ] Is there reconciliation for dimension uniqueness?
- [ ] Is there an API guardrail for time range/cardinality?

---

## 31. Exercises

### Exercise 1: Identify Join Type

You have:

```text
events(user_id, event_time, event_name)
user_current(user_id, country, plan)
```

Dashboard:

```text
Daily events by country and plan.
```

Questions:

1. Is runtime join acceptable?
2. Should country/plan be denormalized?
3. What if plan changes over time?
4. What if dashboard must show current plan?
5. What if dashboard must show plan at event time?

Expected reasoning:

- For frequent dashboard, denormalize country/plan if event-time correctness matters.
- For current plan report, current dimension join/dictionary can be acceptable.
- If both needed, store event-time plan and maintain current user dimension separately.

### Exercise 2: Many-to-Many Campaign Attribution

You have:

```text
orders(order_id, user_id, amount)
campaign_users(user_id, campaign_id)
```

Query:

```text
Revenue by campaign.
```

Questions:

1. Can you safely join and sum amount?
2. What if user belongs to multiple campaigns?
3. What attribution rules are possible?
4. How would you model it in ClickHouse?

Expected reasoning:

- Naive join can double count.
- Need business attribution rule.
- May require bridge table with weights or event-time attribution field.
- Precompute attribution if report is frequent.

### Exercise 3: Distributed Join

You have:

```text
events sharded by hash(user_id)
accounts sharded by hash(account_id)
```

Query joins `events.account_id = accounts.account_id`.

Questions:

1. Is join local?
2. What is likely cost?
3. How could you redesign?
4. When is dictionary better?

Expected reasoning:

- Not colocated by account_id if events are sharded by user_id.
- Query may require distributed exchange/broadcast.
- Redesign shard key, denormalize account attributes, or dictionary lookup if account dimension is lookup-like.

### Exercise 4: Historical Severity

You have case severity changes over time.

Report:

```text
Count opened cases by severity at the time the case was opened.
```

Questions:

1. Should query join current severity?
2. Should severity be stored in event?
3. Should you use ASOF join?
4. What is most robust for regulatory audit?

Expected reasoning:

- Current severity is incorrect for historical report.
- Store `severity_at_event` or maintain event-time dimension.
- ASOF join can work but may be expensive.
- For audit, immutable event-time attribute is often more defensible.

---

## 32. Summary

Join di ClickHouse adalah fitur kuat, tetapi bukan default modeling strategy untuk semua analytics.

Mental model utama:

1. Join adalah runtime relationship reconstruction.
2. Dalam OLAP, join cost sering berasal dari memory, row expansion, scan volume, dan network.
3. Sisi kanan join harus sekecil, sebersih, dan seunik mungkin.
4. Denormalization adalah strategi sehat untuk hot dimensions.
5. Dictionary sangat berguna untuk lookup-like dimension.
6. Materialized view/serving table cocok untuk query join yang sering dan mahal.
7. Distributed join harus memperhatikan sharding key dan data locality.
8. Relationship cardinality menentukan correctness metric.
9. `ANY JOIN` bukan pengganti data quality.
10. Query API harus punya semantic guardrails agar tidak menciptakan arbitrary join explosion.

Kalimat praktis:

> Jangan mulai dari “bagaimana saya join table ini?”  
> Mulailah dari “apakah relationship ini seharusnya diselesaikan saat ingestion, lookup, pre-aggregation, atau query time?”

---

## 33. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi ClickHouse untuk detail versi spesifik:

1. ClickHouse Docs — Using JOINs.
2. ClickHouse Docs — JOIN clause.
3. ClickHouse Docs — Minimize and optimize JOINs.
4. ClickHouse Docs — Dictionaries.
5. ClickHouse Docs — Dictionary best practices.
6. ClickHouse Docs — Distributed table engine.
7. ClickHouse Blog — Choosing the right join algorithm.
8. ClickHouse Blog — JOIN algorithms under the hood.
9. ClickHouse Docs — Query optimization.
10. ClickHouse Docs — EXPLAIN.

---

## 34. Status Seri

Part ini adalah:

```text
Part 017 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 018 — ClickHouse Table Engines Beyond Basic MergeTree
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-016.md">⬅️ Part 016 — Projections, Data Skipping Indexes, and Secondary Access Paths</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-018.md">Part 018 — ClickHouse Table Engines Beyond Basic MergeTree ➡️</a>
</div>

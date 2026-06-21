# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-018.md

# Part 018 — ClickHouse Table Engines Beyond Basic MergeTree

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **018 / 034**  
> Fokus: memahami table engine ClickHouse sebagai kontrak semantics, storage, merge behavior, distribution, replication, dan ingestion integration.

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah membahas:

- OLAP mental model.
- Columnar storage.
- MergeTree internals.
- Sorting key.
- Partitioning.
- Compression.
- Ingestion.
- Query execution.
- Aggregation.
- Materialized views.
- Projections dan skipping indexes.
- Joins, dictionaries, dan denormalization.

Sekarang kita membahas **table engines**.

Di ClickHouse, `ENGINE` bukan detail kecil. Engine menentukan:

1. bagaimana data disimpan;
2. apakah data persisted atau volatile;
3. apakah data direplikasi;
4. apakah data didistribusikan;
5. bagaimana data merge di background;
6. apakah duplicates disimpan, digabung, dijumlah, atau dicollapse;
7. apakah table hanya façade ke table lain;
8. apakah table membaca dari Kafka/S3/file;
9. apakah insert ke table memicu transformasi ke target table;
10. apa failure mode utama table tersebut.

Dalam database OLTP, kamu mungkin terbiasa bahwa “table ya table”.  
Di ClickHouse, “table” selalu berarti:

> Data shape + physical layout + engine behavior + merge semantics + operational lifecycle.

---

## 1. Tujuan Part Ini

Setelah part ini, kamu diharapkan mampu:

1. memahami kenapa engine selection adalah keputusan desain besar;
2. membedakan engine persistence, transformation, integration, dan distribution;
3. memilih antara `MergeTree`, `ReplacingMergeTree`, `SummingMergeTree`, `AggregatingMergeTree`, `CollapsingMergeTree`, `VersionedCollapsingMergeTree`, `ReplicatedMergeTree`, dan `Distributed`;
4. memahami kapan special engines seperti `Memory`, `Null`, `Buffer`, `File`, `S3`, `Kafka`, dan `URL` masuk akal;
5. menjelaskan kenapa `ReplacingMergeTree` bukan unique constraint;
6. menjelaskan kenapa `SummingMergeTree` bukan general-purpose aggregation engine;
7. memahami kenapa `AggregatingMergeTree` membutuhkan aggregate states;
8. mengenali risiko `CollapsingMergeTree` dan sign/version modeling;
9. membangun decision matrix untuk table engine selection;
10. menghubungkan engine choice dengan Java application architecture, ingestion, reporting, backfill, dan operations.

---

## 2. Mental Model Utama: Engine Adalah Kontrak Behavior

Saat menulis:

```sql
CREATE TABLE events
(
    event_time DateTime64(3),
    user_id UInt64,
    event_name LowCardinality(String)
)
ENGINE = MergeTree
ORDER BY (event_name, event_time, user_id);
```

Kamu tidak hanya memilih “storage”.

Kamu memilih:

```text
append-oriented persistent table
+ sorted data parts
+ sparse primary index
+ background merges
+ mutation behavior
+ TTL support
+ partitioning support
+ columnar compression
```

Saat menulis:

```sql
ENGINE = ReplacingMergeTree(version)
```

kamu memilih:

```text
MergeTree behavior
+ duplicate replacement semantics during merge
+ eventual deduplication
+ no immediate uniqueness guarantee
```

Saat menulis:

```sql
ENGINE = AggregatingMergeTree
```

kamu memilih:

```text
MergeTree behavior
+ merge aggregate states for same sorting key
+ requires correct AggregateFunction state modeling
```

Jadi engine bukan sekadar syntax.

Engine adalah **semantic contract**.

---

## 3. Kategori Table Engines

Secara praktis, kita bisa mengelompokkan engine ClickHouse menjadi beberapa kategori.

### 3.1 Core Persistent Analytical Engines

Ini adalah keluarga utama untuk data besar:

- `MergeTree`
- `ReplacingMergeTree`
- `SummingMergeTree`
- `AggregatingMergeTree`
- `CollapsingMergeTree`
- `VersionedCollapsingMergeTree`
- `CoalescingMergeTree`
- `GraphiteMergeTree`

Mayoritas table production besar memakai keluarga ini.

### 3.2 Replicated Engines

Untuk replicated storage:

- `ReplicatedMergeTree`
- `ReplicatedReplacingMergeTree`
- `ReplicatedSummingMergeTree`
- `ReplicatedAggregatingMergeTree`
- dan variasi replicated lainnya.

Di ClickHouse Cloud, ada konsep cloud-native seperti `SharedMergeTree`, tetapi untuk self-managed cluster klasik, family `Replicated*MergeTree` sangat penting.

### 3.3 Distribution Engine

Untuk query/insert routing di cluster:

- `Distributed`

Engine ini tidak menyimpan data sendiri. Ia menjadi façade ke local tables di banyak server.

### 3.4 Integration Engines

Untuk membaca/menulis ke external stream/file/object storage:

- `Kafka`
- `S3`
- `File`
- `URL`
- `HDFS`
- `JDBC`
- `ODBC`
- `MySQL`
- `PostgreSQL`
- dan integration engines lain.

### 3.5 Special Utility Engines

Untuk temporary, routing, sink, atau development:

- `Memory`
- `Null`
- `Buffer`
- `Set`
- `Join`
- `Dictionary`
- `GenerateRandom`
- `View`
- `MaterializedView`

Tidak semuanya cocok untuk persistent production data.

---

## 4. MergeTree: Default Workhorse

### 4.1 Kapan Memakai MergeTree

Gunakan `MergeTree` untuk:

- raw events;
- logs;
- metrics;
- audit trail;
- append-only facts;
- refined events;
- normal analytical fact tables;
- source-of-truth analytics storage.

Contoh:

```sql
CREATE TABLE case_events
(
    tenant_id UInt64,
    case_id UUID,
    event_time DateTime64(3),
    event_type LowCardinality(String),
    jurisdiction LowCardinality(String),
    severity LowCardinality(String),
    ingest_time DateTime64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, case_id);
```

### 4.2 Semantics

`MergeTree` berarti:

- data disimpan sebagai immutable parts;
- parts digabung di background;
- data disort by `ORDER BY`;
- sparse primary index dibuat dari sorting key/prefix;
- data tidak otomatis deduplicate;
- update/delete adalah mutation;
- TTL bisa diterapkan;
- sangat cocok untuk append-heavy OLAP.

### 4.3 Jangan Pakai MergeTree Jika

Jangan hanya memakai `MergeTree` jika:

- kamu butuh latest-state compaction;
- kamu ingin aggregate states digabung saat merge;
- kamu ingin automatic summing;
- kamu butuh collapse positive/negative rows;
- kamu butuh replication;
- table hanya façade distributed.

Namun ingat: banyak kebutuhan bisa tetap diselesaikan dengan `MergeTree` + materialized view + query logic. Jangan lompat ke engine khusus tanpa memahami semantics.

---

## 5. ReplacingMergeTree: Eventual Latest/Dedup Semantics

### 5.1 Apa Itu ReplacingMergeTree?

`ReplacingMergeTree` adalah varian MergeTree yang dapat mengganti duplicate rows berdasarkan sorting key saat merge.

Contoh:

```sql
CREATE TABLE user_current_state
(
    user_id UInt64,
    country LowCardinality(String),
    plan LowCardinality(String),
    updated_at DateTime64(3),
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY user_id;
```

Jika ada beberapa row dengan `user_id` sama, saat merge ClickHouse dapat mempertahankan row dengan `version` terbesar.

### 5.2 Use Case

Cocok untuk:

- latest user profile;
- current case state;
- latest product metadata;
- CDC upsert stream;
- deduplication of repeated inserts;
- slowly changing current snapshot;
- latest status table.

### 5.3 Hal Paling Penting: Eventual, Bukan Immediate

`ReplacingMergeTree` tidak menjamin duplicate langsung hilang setelah insert.

Misalnya:

```sql
INSERT INTO user_current_state VALUES
(1, 'ID', 'free', now(), 1),
(1, 'ID', 'pro',  now(), 2);
```

Query biasa bisa melihat dua row sebelum merge:

```sql
SELECT *
FROM user_current_state
WHERE user_id = 1;
```

Untuk hasil logical latest, kamu mungkin perlu:

```sql
SELECT *
FROM user_current_state FINAL
WHERE user_id = 1;
```

Tetapi `FINAL` bisa mahal pada data besar.

Alternatif lebih aman untuk query serving:

```sql
SELECT
    user_id,
    argMax(plan, version) AS plan,
    argMax(country, version) AS country
FROM user_current_state
WHERE user_id = 1
GROUP BY user_id;
```

Atau maintain serving table yang sudah compact.

### 5.4 Anti-Pattern

Anti-pattern umum:

1. menganggap `ReplacingMergeTree` sebagai unique constraint;
2. mengandalkan dedup immediate;
3. memakai `FINAL` di semua dashboard;
4. sorting key terlalu luas sehingga duplicate tidak pernah dianggap duplicate;
5. version tidak monoton;
6. menggunakan timestamp precision rendah sebagai version;
7. tidak punya strategy untuk tombstone/delete.

### 5.5 Good Fit

Baik jika:

- duplicate bisa hilang eventually;
- query bisa tolerate duplicates atau menggunakan aggregation/latest logic;
- primary/sorting key merepresentasikan identity;
- version jelas;
- table current-state tidak terlalu massive untuk query pattern;
- correctness model terdokumentasi.

---

## 6. SummingMergeTree: Automatic Numeric Summation During Merge

### 6.1 Apa Itu SummingMergeTree?

`SummingMergeTree` menjumlahkan kolom numeric untuk rows dengan sorting key yang sama saat parts merge.

Contoh:

```sql
CREATE TABLE daily_event_counts
(
    tenant_id UInt64,
    day Date,
    event_type LowCardinality(String),
    count UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, event_type);
```

Jika ada rows:

```text
tenant_id day        event_type count
1         2026-06-01 click      10
1         2026-06-01 click      15
```

Setelah merge, bisa menjadi:

```text
1         2026-06-01 click      25
```

### 6.2 Use Case

Cocok untuk:

- simple counters;
- additive metrics;
- pre-aggregated counts;
- sum of amounts;
- daily/hourly simple rollups;
- materialized view target untuk additive metrics.

### 6.3 Batasan

`SummingMergeTree` cocok hanya untuk metrics additive sederhana.

Tidak cocok untuk:

- average tanpa numerator/denominator;
- percentile;
- distinct count;
- median;
- min/max with metadata;
- non-additive metrics;
- ratios;
- latest value;
- complex aggregate states.

Contoh salah:

```sql
CREATE TABLE daily_latency
(
    day Date,
    avg_latency Float64
)
ENGINE = SummingMergeTree
ORDER BY day;
```

Menjumlahkan average tidak menghasilkan average benar.

Lebih baik simpan:

```sql
sum_latency_ms UInt64,
count_requests UInt64
```

Lalu query:

```sql
SELECT
    day,
    sum(sum_latency_ms) / sum(count_requests) AS avg_latency
FROM daily_latency
GROUP BY day;
```

### 6.4 Hidden Risk: Merge Belum Selesai

Seperti engine MergeTree family lain, summing terjadi saat merge. Query bisa melihat multiple rows untuk key sama sebelum merge.

Karena itu query sebaiknya tetap melakukan `sum()`:

```sql
SELECT
    tenant_id,
    day,
    event_type,
    sum(count) AS count
FROM daily_event_counts
GROUP BY
    tenant_id,
    day,
    event_type;
```

Jangan asumsikan table selalu sudah physically collapsed.

### 6.5 Good Fit

Gunakan jika:

- metric additive;
- query selalu aggregate lagi secara aman;
- target table adalah rollup sederhana;
- merge-time summing membantu storage compaction;
- correctness tidak bergantung pada physical merge selesai.

---

## 7. AggregatingMergeTree: Aggregate State Storage

### 7.1 Apa Itu AggregatingMergeTree?

`AggregatingMergeTree` menyimpan dan menggabungkan aggregate states.

Contoh:

```sql
CREATE TABLE hourly_api_metrics
(
    tenant_id UInt64,
    hour DateTime,
    route LowCardinality(String),
    request_count SimpleAggregateFunction(sum, UInt64),
    unique_users AggregateFunction(uniq, UInt64),
    latency_p95 AggregateFunction(quantile(0.95), UInt32)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (tenant_id, hour, route);
```

Data dimasukkan menggunakan state functions:

```sql
INSERT INTO hourly_api_metrics
SELECT
    tenant_id,
    toStartOfHour(timestamp) AS hour,
    route,
    count() AS request_count,
    uniqState(user_id) AS unique_users,
    quantileState(0.95)(latency_ms) AS latency_p95
FROM api_events
GROUP BY
    tenant_id,
    hour,
    route;
```

Query menggunakan merge functions:

```sql
SELECT
    tenant_id,
    hour,
    route,
    sum(request_count) AS requests,
    uniqMerge(unique_users) AS unique_users,
    quantileMerge(0.95)(latency_p95) AS p95_latency
FROM hourly_api_metrics
GROUP BY
    tenant_id,
    hour,
    route;
```

### 7.2 Use Case

Cocok untuk:

- rollups dengan distinct count;
- quantile/percentile;
- aggregate states yang bisa digabung;
- complex pre-aggregation;
- materialized view targets;
- multi-resolution analytics;
- dashboard serving tables.

### 7.3 Kenapa Bukan SummingMergeTree?

Karena banyak metric tidak bisa digabung dengan sum biasa.

Contoh:

- `uniq(user_id)`;
- `quantile(0.95)(latency_ms)`;
- `avg` jika tidak disimpan sebagai sum/count;
- topK;
- argMax state;
- histogram-like aggregates.

### 7.4 Kesalahan Umum

1. Insert final aggregate value, bukan state.
2. Query state column tanpa `...Merge`.
3. Memilih aggregate function yang tidak cocok untuk rollup hierarchy.
4. Menggunakan exact distinct untuk cardinality sangat besar tanpa memory planning.
5. Tidak mendokumentasikan semantic metric.
6. Mencampur `AggregateFunction` dan final value sembarangan.
7. Grouping key terlalu detail sehingga rollup tidak mengurangi data.

### 7.5 Good Fit

Gunakan jika:

- query sering membutuhkan aggregate mahal;
- metric bisa direpresentasikan sebagai mergeable state;
- storage overhead state acceptable;
- ingestion/write amplification acceptable;
- backfill plan jelas;
- query layer tahu cara finalize state.

---

## 8. CollapsingMergeTree: Sign-Based State Cancellation

### 8.1 Apa Itu CollapsingMergeTree?

`CollapsingMergeTree` menggunakan kolom `Sign` untuk mencollapse pasangan row state dan cancel row saat merge.

Konsep:

```text
Sign = 1  → row state aktif
Sign = -1 → row membatalkan state sebelumnya
```

Contoh:

```sql
CREATE TABLE account_state_changes
(
    account_id UInt64,
    balance Decimal(18, 2),
    updated_at DateTime64(3),
    Sign Int8
)
ENGINE = CollapsingMergeTree(Sign)
ORDER BY account_id;
```

### 8.2 Use Case

Cocok untuk model di mana update direpresentasikan sebagai:

```text
old state cancellation + new state insertion
```

Contoh:

```text
(account=1, balance=100, Sign=1)
(account=1, balance=100, Sign=-1)
(account=1, balance=150, Sign=1)
```

Setelah collapse, state lama dapat hilang, state baru tersisa.

### 8.3 Risiko

`CollapsingMergeTree` lebih sulit dipakai dengan benar dibanding `ReplacingMergeTree`.

Risiko:

- sign salah;
- cancel row tidak match;
- out-of-order data;
- duplicate sign;
- query sebelum merge melihat row positif dan negatif;
- metrics harus memperhitungkan sign;
- debugging sulit.

Query sering harus menulis:

```sql
SELECT
    account_id,
    sum(balance * Sign) AS balance
FROM account_state_changes
GROUP BY account_id
HAVING sum(Sign) > 0;
```

### 8.4 Good Fit

Gunakan hanya jika:

- kamu benar-benar butuh sign-based collapsing;
- event producer bisa membuat cancel/update pair dengan benar;
- ordering/identity jelas;
- tim memahami query pattern dengan `Sign`;
- failure recovery jelas.

Untuk kebanyakan latest-state analytics, `ReplacingMergeTree` lebih mudah.

---

## 9. VersionedCollapsingMergeTree: Collapsing Dengan Version

### 9.1 Apa Itu VersionedCollapsingMergeTree?

`VersionedCollapsingMergeTree` mirip `CollapsingMergeTree`, tetapi memakai version column untuk membantu collapse rows dalam kondisi insert order tidak selalu sama.

Contoh:

```sql
CREATE TABLE object_state_changes
(
    object_id UInt64,
    value String,
    version UInt64,
    Sign Int8
)
ENGINE = VersionedCollapsingMergeTree(Sign, version)
ORDER BY object_id;
```

### 9.2 Use Case

Cocok jika:

- update/cancel pairs bisa datang tidak berurutan;
- ada version yang reliable;
- kamu perlu state change compaction berbasis sign;
- data model benar-benar append update/cancel.

### 9.3 Risiko

Risiko tetap tinggi:

- version tidak reliable;
- producer bug menyebabkan unmatched rows;
- query semantics lebih kompleks;
- operational debugging lebih sulit;
- butuh validation job.

### 9.4 Rule of Thumb

Jika kamu belum bisa menjelaskan dengan jelas:

```text
apa identity row,
apa version row,
kapan Sign = 1,
kapan Sign = -1,
bagaimana query sebelum merge tetap benar,
bagaimana repair unmatched rows
```

jangan gunakan engine ini.

---

## 10. CoalescingMergeTree: Partial Latest-Value Merge

`CoalescingMergeTree` adalah engine lebih baru dalam keluarga MergeTree yang berguna ketika rows dengan primary key sama ingin dicoalesce: nilai non-null dari beberapa rows digabung menjadi satu row selama merge.

Use case konseptual:

```text
partial updates
same entity key
different columns arrive at different times
merge should combine non-null fields
```

Contoh mental:

```text
user_id=1, country='ID', plan=NULL
user_id=1, country=NULL, plan='pro'
```

Setelah coalescing:

```text
user_id=1, country='ID', plan='pro'
```

Namun engine seperti ini harus dipakai hati-hati karena:

- semantics partial update harus jelas;
- null meaning harus didefinisikan;
- merge eventual;
- query sebelum merge bisa melihat rows terpisah;
- tidak cocok jika null adalah nilai business meaningful.

Untuk production adoption, cek dokumentasi versi yang kamu pakai dan uji pada data realistis.

---

## 11. GraphiteMergeTree

`GraphiteMergeTree` dirancang untuk Graphite-style time-series rollup/retention.

Use case:

- Graphite metrics;
- older time-series infrastructure;
- retention/downsampling berdasarkan config Graphite.

Untuk sebagian besar sistem analytics modern, kamu kemungkinan lebih sering memakai:

- `MergeTree`;
- `AggregatingMergeTree`;
- materialized views;
- TTL rollup;
- custom metric rollup tables.

Jangan memilih `GraphiteMergeTree` kecuali workload memang Graphite-like.

---

## 12. ReplicatedMergeTree Family

### 12.1 Kenapa Replication Table-Level?

Di ClickHouse, replication bekerja pada level table. Kamu bisa punya table replicated dan non-replicated dalam server yang sama.

Contoh:

```sql
CREATE TABLE events_replicated
(
    tenant_id UInt64,
    event_time DateTime64(3),
    event_name LowCardinality(String)
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/events_replicated',
    '{replica}'
)
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_name);
```

Dalam modern ClickHouse setups, path bisa dikelola lewat macros/config.

### 12.2 Use Case

Gunakan replicated family untuk:

- high availability;
- data durability across nodes;
- failover;
- distributed cluster;
- production data tables;
- replicated local tables di belakang `Distributed`.

### 12.3 Replicated Variants

Contoh:

```text
ReplicatedMergeTree
ReplicatedReplacingMergeTree
ReplicatedSummingMergeTree
ReplicatedAggregatingMergeTree
ReplicatedCollapsingMergeTree
ReplicatedVersionedCollapsingMergeTree
```

Pilih replicated variant berdasarkan semantics yang sama dengan non-replicated engine.

### 12.4 Operational Concepts

Replication melibatkan:

- ClickHouse Keeper/ZooKeeper metadata coordination;
- replication queue;
- part fetch;
- quorum/insert settings;
- replica lag;
- background fetch threads;
- data part consistency;
- recovery from failed replica.

### 12.5 Common Failure Modes

1. Replica lag tinggi.
2. Replication queue menumpuk.
3. Keeper/ZooKeeper unavailable.
4. Insert succeeds on one replica but lagging elsewhere.
5. Disk full pada salah satu replica.
6. Misconfigured macros/path.
7. Schema drift antar replicas.
8. Overload karena too many small parts.
9. Network partition.

### 12.6 Rule of Thumb

Untuk production cluster self-managed:

```text
Local persistent tables biasanya Replicated*MergeTree.
Distributed table berada di atasnya untuk query cluster-wide.
```

---

## 13. Distributed Engine

### 13.1 Apa Itu Distributed Engine?

`Distributed` table tidak menyimpan data sendiri. Ia mengarahkan query/insert ke local tables di cluster.

Contoh local table di setiap node:

```sql
CREATE TABLE events_local
(
    tenant_id UInt64,
    event_time DateTime64(3),
    event_name LowCardinality(String),
    user_id UInt64
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/events_local',
    '{replica}'
)
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_name, user_id);
```

Distributed table:

```sql
CREATE TABLE events_dist
AS events_local
ENGINE = Distributed(
    my_cluster,
    default,
    events_local,
    cityHash64(tenant_id, user_id)
);
```

### 13.2 Use Case

Gunakan `Distributed` untuk:

- query across shards;
- insert routing;
- cluster façade untuk application;
- distributed aggregation;
- routing ke replicas/shards;
- multi-node scale-out.

### 13.3 Semantics

Distributed table:

- tidak menyimpan data utama;
- query fan-out ke shards;
- hasil digabung coordinator;
- insert bisa diarahkan berdasarkan sharding key;
- failure behavior tergantung settings;
- performa bergantung network, cluster topology, shard key, dan query shape.

### 13.4 Anti-Pattern

1. Menganggap Distributed table menyimpan data.
2. Query heavy join lewat Distributed tanpa colocation.
3. Sharding key random tanpa query locality consideration.
4. Insert ke local table dari app sehingga data hanya masuk satu node.
5. Tidak memahami `distributed_product_mode`.
6. Coordinator bottleneck.
7. Menggunakan Distributed table di atas Distributed table tanpa alasan kuat.

### 13.5 Application Pattern

Java app biasanya:

- insert ke `Distributed` table untuk routing cluster-wide; atau
- insert ke local shard secara eksplisit via ingestion router; atau
- memakai managed ingestion.

Query layer biasanya membaca dari `Distributed` table.

Namun untuk debugging, engineer harus bisa query local tables.

---

## 14. SharedMergeTree in ClickHouse Cloud

Dalam ClickHouse Cloud, `SharedMergeTree` adalah keluarga engine cloud-native yang menggantikan pola replicated classic dalam konteks shared storage.

Konsep high-level:

```text
compute nodes
+ shared object storage
+ shared metadata/catalog behavior
+ cloud-managed replication/failover semantics
```

Jika kamu memakai ClickHouse Cloud, kamu mungkin tidak perlu mendesain `ReplicatedMergeTree` path manual seperti self-managed cluster.

Namun konsep yang tetap penting:

- part lifecycle;
- sorting key;
- partitioning;
- query shape;
- ingestion batching;
- merge behavior;
- storage/caching trade-off.

Engine cloud-native mengurangi sebagian operational burden, bukan menghapus kebutuhan data modeling yang benar.

---

## 15. Memory Engine

### 15.1 Apa Itu Memory Engine?

`Memory` menyimpan data di RAM.

Contoh:

```sql
CREATE TABLE temp_ids
(
    user_id UInt64
)
ENGINE = Memory;
```

### 15.2 Use Case

Cocok untuk:

- temporary staging kecil;
- testing;
- lookup transient;
- small intermediate data;
- development.

### 15.3 Risiko

Data hilang saat server restart.

Tidak cocok untuk:

- persistent data;
- production source of truth;
- large table;
- critical staging tanpa recovery.

### 15.4 Rule of Thumb

Pakai `Memory` hanya jika kehilangan data acceptable.

---

## 16. Null Engine

### 16.1 Apa Itu Null Engine?

`Null` menerima insert tetapi tidak menyimpan data.

Contoh:

```sql
CREATE TABLE raw_sink
(
    event_time DateTime64(3),
    event_name String,
    payload String
)
ENGINE = Null;
```

### 16.2 Kenapa Berguna?

`Null` berguna sebagai source untuk materialized views.

Insert ke `Null` table tidak menyimpan raw data, tetapi materialized view tetap bisa memproses insert block ke target table.

Contoh:

```sql
CREATE MATERIALIZED VIEW mv_parse_events
TO parsed_events
AS
SELECT
    event_time,
    JSONExtractString(payload, 'event_name') AS event_name
FROM raw_sink;
```

### 16.3 Use Case

Cocok untuk:

- transformation pipeline tanpa menyimpan raw input;
- load testing materialized views;
- routing inserts ke multiple target tables;
- discard sink.

### 16.4 Risiko

- raw data hilang;
- tidak bisa replay dari table ini;
- debugging ingestion lebih sulit;
- harus punya source/replay elsewhere jika correctness penting.

Untuk regulatory/audit systems, biasanya raw immutable source tetap perlu disimpan.

---

## 17. Buffer Engine

### 17.1 Apa Itu Buffer Engine?

`Buffer` menyimpan data sementara di memory lalu flush ke target table berdasarkan threshold.

Konsep:

```text
insert → Buffer table → periodic flush → destination MergeTree table
```

### 17.2 Use Case

Historically berguna untuk mengurangi small inserts.

Namun dengan modern ClickHouse, banyak kasus lebih baik memakai:

- client-side batching;
- async inserts;
- Kafka/ClickPipes;
- ingestion service;
- direct batch insert.

### 17.3 Risiko

- data di buffer bisa hilang jika crash sebelum flush;
- behavior flush harus dipahami;
- memory pressure;
- operational complexity;
- kurang ideal untuk critical ingestion.

### 17.4 Rule of Thumb

Jangan pakai `Buffer` sebagai solusi pertama untuk small inserts.  
Mulai dari batching dan async insert.

---

## 18. File Engine

### 18.1 Apa Itu File Engine?

`File` engine menyimpan/membaca data dari file lokal dalam format tertentu.

Contoh use case:

- development;
- local file ingestion;
- export/import;
- simple experiments.

### 18.2 Contoh

```sql
CREATE TABLE local_csv
(
    id UInt64,
    name String
)
ENGINE = File(CSV);
```

### 18.3 Risiko

- local to server;
- tidak cocok untuk distributed durable storage;
- operational lifecycle manual;
- permission/path issues.

Untuk data lake/object storage, `S3` sering lebih relevan.

---

## 19. S3 Engine and Object Storage Access

### 19.1 Apa Itu S3 Engine?

`S3` engine memungkinkan ClickHouse membaca/menulis data di object storage compatible S3.

Use case:

- batch load from data lake;
- query external Parquet/CSV/JSON files;
- export result;
- backfill;
- staging;
- lakehouse integration.

Contoh konsep:

```sql
CREATE TABLE s3_events
(
    event_time DateTime64(3),
    user_id UInt64,
    event_name String
)
ENGINE = S3(
    'https://bucket.s3.amazonaws.com/events/*.parquet',
    'Parquet'
);
```

Atau:

```sql
INSERT INTO events
SELECT *
FROM s3(
    'https://bucket.s3.amazonaws.com/events/2026/06/*.parquet',
    'Parquet'
);
```

### 19.2 Use Case Yang Bagus

- load historical data;
- reprocess from data lake;
- export aggregates;
- ad-hoc external query;
- separation of raw lake and ClickHouse serving layer.

### 19.3 Risiko

- object storage latency;
- API call cost;
- schema drift;
- file size terlalu kecil;
- many small files;
- eventual consistency considerations depending backend;
- credentials/security;
- query performance berbeda dari native MergeTree.

### 19.4 Pattern

Better pattern untuk production serving:

```text
S3 raw files
→ batch load into MergeTree
→ query from MergeTree
```

Jangan jadikan S3 external table sebagai primary serving table untuk low-latency dashboard kecuali sudah diukur dan desainnya memang mendukung.

---

## 20. Kafka Engine

### 20.1 Apa Itu Kafka Engine?

`Kafka` engine memungkinkan ClickHouse membaca dari Kafka topic.

Pattern umum:

```text
Kafka topic
→ Kafka engine table
→ Materialized View
→ MergeTree target table
```

Kafka engine table sendiri bukan persistent analytics table utama.

### 20.2 Contoh

```sql
CREATE TABLE kafka_raw_events
(
    event_time DateTime64(3),
    user_id UInt64,
    event_name String
)
ENGINE = Kafka
SETTINGS
    kafka_broker_list = 'broker1:9092',
    kafka_topic_list = 'events',
    kafka_group_name = 'clickhouse-events-consumer',
    kafka_format = 'JSONEachRow';
```

Materialized view:

```sql
CREATE MATERIALIZED VIEW mv_kafka_to_events
TO events
AS
SELECT
    event_time,
    user_id,
    event_name
FROM kafka_raw_events;
```

### 20.3 Use Case

- streaming ingestion;
- simple ClickHouse-owned consumer;
- direct topic-to-table path;
- event pipelines with materialized view transformation.

### 20.4 Risks

- operational semantics around offsets;
- poison messages;
- schema evolution;
- retry/reprocessing;
- materialized view failure;
- backpressure;
- exactly-once assumptions;
- limited transformation/error handling compared to dedicated stream processor.

### 20.5 Java Engineer Perspective

Jika transformation kompleks, validation rumit, enrichment butuh external service, atau DLQ handling penting, dedicated Java/Kafka consumer mungkin lebih appropriate.

Pattern:

```text
Kafka
→ Java ingestion service
→ batch insert ClickHouse
→ DLQ/retry/reconciliation controlled by app
```

Atau managed:

```text
Kafka
→ ClickPipes / connector
→ ClickHouse
```

---

## 21. URL Engine

`URL` engine membaca data dari HTTP endpoint.

Use case:

- ad-hoc ingestion;
- small external datasets;
- integration testing;
- controlled metadata sources.

Risiko:

- network reliability;
- endpoint latency;
- schema drift;
- security;
- lack of replay;
- not a durable analytics source.

Gunakan untuk controlled cases, bukan core serving table.

---

## 22. MySQL/PostgreSQL/JDBC/ODBC Engines

ClickHouse memiliki engines/integrations untuk membaca dari database eksternal.

Use case:

- dimension lookup;
- migration;
- federated query ringan;
- backfill;
- reference data.

Risiko:

- query dapat membebani OLTP database;
- latency unpredictable;
- pushdown terbatas;
- type mapping;
- network;
- consistency snapshot;
- tidak cocok untuk join besar interactive OLAP.

Pattern yang lebih aman:

```text
OLTP source
→ CDC/batch sync
→ ClickHouse dimension/current table
→ analytics query
```

Gunakan federated access sebagai convenience, bukan fondasi high-volume analytics.

---

## 23. Set and Join Engines

### 23.1 Set Engine

`Set` engine dapat menyimpan set untuk operasi `IN`.

Use case:

- membership filtering;
- allow/block list;
- small key sets.

### 23.2 Join Engine

`Join` engine menyimpan prepared join structure.

Use case:

- repeated joins against relatively stable small dimension;
- specialized lookup.

Namun untuk banyak use case modern, dictionaries lebih sering menjadi pilihan lookup yang lebih fleksibel.

---

## 24. View and MaterializedView Engines

### 24.1 View

Normal view tidak menyimpan data. Ia adalah saved query.

```sql
CREATE VIEW recent_events AS
SELECT *
FROM events
WHERE event_time >= now() - INTERVAL 7 DAY;
```

Use case:

- abstraction;
- permission boundary;
- query reuse;
- semantic layer ringan.

Risiko:

- tidak mempercepat query sendiri;
- query masih dieksekusi ke underlying table;
- bisa menyembunyikan query mahal.

### 24.2 Materialized View

Materialized view di ClickHouse adalah insert-time transformation, bukan sekadar cached view.

Pattern:

```text
source insert block
→ materialized view query
→ target table insert
```

Target engine menentukan semantics:

- `MergeTree` untuk transformed raw;
- `SummingMergeTree` untuk additive rollup;
- `AggregatingMergeTree` untuk aggregate states;
- `ReplacingMergeTree` untuk latest-style target.

---

## 25. Engine Selection by Data Shape

### 25.1 Raw Events / Logs / Audit

Use:

```text
MergeTree / ReplicatedMergeTree
```

Why:

- append-only;
- source of truth;
- no automatic collapse;
- predictable;
- easy backfill.

### 25.2 Current State / Latest Snapshot

Use:

```text
ReplacingMergeTree(version)
```

or:

```text
MergeTree + argMax query/materialized serving table
```

Avoid:

- assuming immediate uniqueness.

### 25.3 Simple Additive Rollup

Use:

```text
SummingMergeTree
```

if metrics are additive.

Example:

- counts;
- total amount;
- total duration.

### 25.4 Complex Rollup

Use:

```text
AggregatingMergeTree
```

for:

- unique users;
- quantiles;
- topK;
- aggregate states.

### 25.5 Update/Cancel State Modeling

Use carefully:

```text
CollapsingMergeTree
VersionedCollapsingMergeTree
```

only when sign/version model is justified.

### 25.6 Distributed Cluster Query

Use:

```text
Distributed over Replicated*MergeTree local tables
```

### 25.7 Streaming Ingestion

Use:

```text
Kafka engine + MV + MergeTree
```

or external ingestion service.

### 25.8 Object Storage Batch Load

Use:

```text
S3 table function/engine → INSERT INTO MergeTree
```

### 25.9 Temporary Data

Use:

```text
Memory
Temporary tables
```

### 25.10 Discard + Transform

Use:

```text
Null + Materialized Views
```

only if raw replay not needed in ClickHouse.

---

## 26. Engine Selection Decision Matrix

| Requirement | Recommended Engine/Pattern | Warning |
|---|---|---|
| Append-only events | `MergeTree` | Design `ORDER BY` carefully |
| Replicated append-only events | `ReplicatedMergeTree` | Monitor replica queue |
| Current latest state | `ReplacingMergeTree(version)` | Not immediate uniqueness |
| Simple counters | `SummingMergeTree` | Query still needs `sum()` |
| Distinct/quantile rollup | `AggregatingMergeTree` | Requires state/merge functions |
| Positive/negative state changes | `CollapsingMergeTree` | High semantic complexity |
| Out-of-order sign/version collapse | `VersionedCollapsingMergeTree` | Version correctness critical |
| Cluster query façade | `Distributed` | Stores no data itself |
| Kafka ingestion | `Kafka` + MV | Offset/error handling |
| S3 batch load | `S3` function/engine | Small files/object latency |
| Temporary RAM table | `Memory` | Data lost on restart |
| Discard source after MV transform | `Null` | No replay from source table |
| Small membership set | `Set` | Not main fact storage |
| Reusable lookup join | `Join`/Dictionary | Check freshness/size |
| Saved query abstraction | `View` | No performance gain by itself |

---

## 27. Regulatory / Case Management Engine Design Example

### 27.1 Raw Case Events

Requirement:

- immutable audit trail;
- historical replay;
- event-time reporting;
- regulatory defensibility.

Engine:

```sql
CREATE TABLE case_events_local
(
    tenant_id UInt64,
    case_id UUID,
    event_time DateTime64(3),
    event_type LowCardinality(String),
    jurisdiction LowCardinality(String),
    severity_at_event LowCardinality(String),
    actor_user_id UInt64,
    ingest_time DateTime64(3)
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/case_events_local',
    '{replica}'
)
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, jurisdiction, case_id);
```

Distributed façade:

```sql
CREATE TABLE case_events
AS case_events_local
ENGINE = Distributed(
    my_cluster,
    analytics,
    case_events_local,
    cityHash64(tenant_id, case_id)
);
```

### 27.2 Current Case State

Requirement:

- current backlog;
- current assignee;
- latest severity;
- operational dashboard.

Engine:

```sql
CREATE TABLE case_current_state_local
(
    tenant_id UInt64,
    case_id UUID,
    status LowCardinality(String),
    current_severity LowCardinality(String),
    assignee_user_id UInt64,
    updated_at DateTime64(3),
    version UInt64
)
ENGINE = ReplicatedReplacingMergeTree(
    '/clickhouse/tables/{shard}/case_current_state_local',
    '{replica}',
    version
)
ORDER BY (tenant_id, case_id);
```

Important:

- query may need `argMax` or `FINAL`;
- don't assume duplicates are gone immediately;
- use a serving table if dashboard requires strict low-latency no-duplicate semantics.

### 27.3 Daily Case Rollup

Requirement:

- daily report by jurisdiction/severity;
- additive counts.

Engine:

```sql
CREATE TABLE daily_case_opened_counts_local
(
    tenant_id UInt64,
    day Date,
    jurisdiction LowCardinality(String),
    severity LowCardinality(String),
    opened_count UInt64
)
ENGINE = ReplicatedSummingMergeTree(
    '/clickhouse/tables/{shard}/daily_case_opened_counts_local',
    '{replica}'
)
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, jurisdiction, severity);
```

Query still:

```sql
SELECT
    day,
    jurisdiction,
    severity,
    sum(opened_count) AS opened_count
FROM daily_case_opened_counts
WHERE tenant_id = 10
GROUP BY
    day,
    jurisdiction,
    severity;
```

### 27.4 SLA Percentile Rollup

Requirement:

- p50/p95 time-to-assignment;
- unique cases;
- complex aggregate.

Engine:

```sql
CREATE TABLE hourly_case_sla_metrics_local
(
    tenant_id UInt64,
    hour DateTime,
    jurisdiction LowCardinality(String),
    case_count AggregateFunction(uniq, UUID),
    time_to_assign_p95 AggregateFunction(quantile(0.95), UInt64)
)
ENGINE = ReplicatedAggregatingMergeTree(
    '/clickhouse/tables/{shard}/hourly_case_sla_metrics_local',
    '{replica}'
)
PARTITION BY toYYYYMM(hour)
ORDER BY (tenant_id, hour, jurisdiction);
```

Query:

```sql
SELECT
    hour,
    jurisdiction,
    uniqMerge(case_count) AS cases,
    quantileMerge(0.95)(time_to_assign_p95) AS p95_time_to_assign
FROM hourly_case_sla_metrics
WHERE tenant_id = 10
GROUP BY
    hour,
    jurisdiction;
```

---

## 28. Product Analytics Engine Design Example

### 28.1 Raw Product Events

```sql
CREATE TABLE product_events_local
(
    tenant_id UInt64,
    event_time DateTime64(3),
    event_name LowCardinality(String),
    user_id UInt64,
    session_id UUID,
    country LowCardinality(String),
    plan LowCardinality(String),
    device_type LowCardinality(String)
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/product_events_local',
    '{replica}'
)
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_name, event_time, user_id);
```

### 28.2 Daily Active Users Rollup

DAU uses distinct users, so use `AggregatingMergeTree`.

```sql
CREATE TABLE daily_active_users_local
(
    tenant_id UInt64,
    day Date,
    event_name LowCardinality(String),
    country LowCardinality(String),
    users AggregateFunction(uniq, UInt64)
)
ENGINE = ReplicatedAggregatingMergeTree(
    '/clickhouse/tables/{shard}/daily_active_users_local',
    '{replica}'
)
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, event_name, country);
```

Do not use `SummingMergeTree` with precomputed daily distinct counts if you need to roll up across country/event/month without understanding double-counting.

---

## 29. Observability Engine Design Example

### 29.1 Logs

```sql
CREATE TABLE logs_local
(
    timestamp DateTime64(3),
    service LowCardinality(String),
    environment LowCardinality(String),
    level LowCardinality(String),
    route LowCardinality(String),
    status_code UInt16,
    latency_ms UInt32,
    trace_id UUID,
    message String
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/logs_local',
    '{replica}'
)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (service, environment, timestamp, level);
```

### 29.2 Latency Rollup

```sql
CREATE TABLE api_latency_1m_local
(
    service LowCardinality(String),
    environment LowCardinality(String),
    minute DateTime,
    route LowCardinality(String),
    request_count SimpleAggregateFunction(sum, UInt64),
    p95_latency AggregateFunction(quantile(0.95), UInt32),
    p99_latency AggregateFunction(quantile(0.99), UInt32)
)
ENGINE = ReplicatedAggregatingMergeTree(
    '/clickhouse/tables/{shard}/api_latency_1m_local',
    '{replica}'
)
PARTITION BY toYYYYMM(minute)
ORDER BY (service, environment, minute, route);
```

---

## 30. Java Application Architecture Implications

### 30.1 Engine Choice Should Be Hidden Behind Dataset Contract

Your Java service should not expose raw engine semantics to API users.

Instead define datasets:

```text
case_events
case_current_state
daily_case_counts
hourly_case_sla_metrics
logs
api_latency_1m
```

Each dataset maps internally to engine behavior.

### 30.2 Query Builder Must Know Finalization Rules

For `AggregatingMergeTree`, query builder must know:

```text
AggregateFunction column → use ...Merge()
SimpleAggregateFunction column → use sum()/appropriate aggregate
```

Example metadata:

```json
{
  "field": "unique_users",
  "storage_type": "AggregateFunction(uniq, UInt64)",
  "query_expression": "uniqMerge(unique_users)"
}
```

For `SummingMergeTree`:

```json
{
  "field": "opened_count",
  "query_expression": "sum(opened_count)"
}
```

For `ReplacingMergeTree`:

```json
{
  "dataset": "case_current_state",
  "dedup_semantics": "eventual",
  "safe_query_pattern": "argMax fields by version or controlled FINAL"
}
```

### 30.3 Ingestion Service Must Match Engine Semantics

For `MergeTree`:

- batch insert;
- avoid small inserts;
- immutable events.

For `ReplacingMergeTree`:

- include identity key;
- include monotonic version;
- handle tombstones if needed.

For `SummingMergeTree`:

- insert additive deltas;
- ensure grouping key matches rollup grain.

For `AggregatingMergeTree`:

- insert aggregate states, not final values;
- use materialized view or controlled aggregation insert.

For `CollapsingMergeTree`:

- emit sign rows correctly;
- validate unmatched signs.

### 30.4 Migration and Backfill

Engine semantics affect backfill.

For raw `MergeTree`:

```text
reinsert historical events
```

For `ReplacingMergeTree`:

```text
ensure version ordering remains valid
```

For `SummingMergeTree`:

```text
avoid double-counting if rerun
```

For `AggregatingMergeTree`:

```text
insert states over same grain, query with Merge functions
```

For `Null` source:

```text
cannot replay unless external source retained
```

---

## 31. Engine-Specific Failure Modes

### 31.1 MergeTree

- too many parts;
- wrong sorting key;
- over-partitioning;
- mutation storm;
- poor compression due to order;
- slow query due to full scan.

### 31.2 ReplacingMergeTree

- duplicate rows visible;
- `FINAL` too expensive;
- wrong version;
- sorting key not identity;
- tombstone semantics missing.

### 31.3 SummingMergeTree

- non-additive metric stored;
- average-of-averages;
- query forgot `sum()`;
- unexpected summing of numeric columns not intended;
- granularity too detailed.

### 31.4 AggregatingMergeTree

- final value inserted instead of state;
- wrong merge function;
- state column type mismatch;
- exact state too memory-heavy;
- rollup hierarchy invalid.

### 31.5 CollapsingMergeTree

- unmatched positive/negative rows;
- sign bugs;
- query doesn't account for sign;
- out-of-order update issues;
- difficult debugging.

### 31.6 ReplicatedMergeTree

- replica lag;
- replication queue backlog;
- Keeper/ZooKeeper issues;
- schema mismatch;
- disk/network failure;
- part fetch failures.

### 31.7 Distributed

- data not stored;
- coordinator bottleneck;
- bad sharding key;
- distributed join explosion;
- insert routing surprises;
- replica selection/failure behavior misunderstood.

### 31.8 Kafka

- poison messages;
- offset handling;
- schema evolution failure;
- materialized view target insert failure;
- backpressure;
- replay complexity.

### 31.9 S3

- small files;
- object storage latency;
- credentials;
- schema drift;
- expensive repeated scans;
- not optimized like MergeTree.

### 31.10 Buffer

- data loss on crash;
- memory pressure;
- unpredictable flush;
- false confidence as batching fix.

---

## 32. Engine Selection Workflow

Use this workflow before creating a table.

### Step 1: Is This Data Persistent?

If yes:

- likely `MergeTree` family.

If no:

- `Memory`, `Null`, `File`, `S3`, `Kafka`, temporary table may be possible.

### Step 2: Is This Raw Source of Truth?

If yes:

- prefer `MergeTree`/`ReplicatedMergeTree`.

Do not use engine that discards/collapses historical records unless raw data is preserved elsewhere.

### Step 3: Does the Table Represent Current Latest State?

If yes:

- `ReplacingMergeTree(version)` or current-state serving table.

### Step 4: Is It a Rollup?

If yes:

- additive only → `SummingMergeTree`;
- complex aggregate → `AggregatingMergeTree`.

### Step 5: Is There Update/Cancel Pair Semantics?

If yes:

- consider `CollapsingMergeTree`/`VersionedCollapsingMergeTree`;
- otherwise avoid.

### Step 6: Is This Cluster-Wide Access?

If yes:

- local replicated table + `Distributed` façade.

### Step 7: Is This External Ingestion/Source?

If yes:

- Kafka/S3/File/URL/connector engine may be staging/integration, not final serving storage.

### Step 8: What Is the Failure Mode?

For every engine, write:

```text
If merge is delayed, is query still correct?
If duplicate exists, is query still correct?
If server restarts, is data safe?
If replay happens, do metrics double count?
If dimension changes, can we rebuild?
If cluster node fails, can query still serve?
```

---

## 33. Production Checklist

Before approving a table engine:

### Semantics

- [ ] Is this raw, refined, aggregate, current-state, staging, or distributed table?
- [ ] Does engine behavior match the data lifecycle?
- [ ] Are merge-time semantics acceptable?
- [ ] Is eventual behavior documented?
- [ ] Does query layer know how to read this engine correctly?

### Correctness

- [ ] Can duplicates appear?
- [ ] Can query tolerate duplicates?
- [ ] Is version/sign/state modeled correctly?
- [ ] Is backfill idempotent?
- [ ] Can replay cause double counting?
- [ ] Are historical records preserved if needed?

### Performance

- [ ] Is `ORDER BY` designed for query shape?
- [ ] Is partitioning reasonable?
- [ ] Will background merges keep up?
- [ ] Are aggregate states bounded?
- [ ] Is `FINAL` avoided in large dashboards?
- [ ] Is distributed query fan-out acceptable?

### Operations

- [ ] Is replication needed?
- [ ] Are system tables monitored?
- [ ] Is there backup/restore plan?
- [ ] Is there backfill/rebuild plan?
- [ ] Are ingestion failures observable?
- [ ] Are engine-specific risks documented?

### Java/API Integration

- [ ] Does ingestion service produce correct columns/states/sign/version?
- [ ] Does query builder finalize aggregate states correctly?
- [ ] Are API fields mapped to safe physical expressions?
- [ ] Are heavy query patterns guarded?
- [ ] Is table engine hidden behind dataset abstraction?

---

## 34. Exercises

### Exercise 1: Choose Engine for Case Events

Data:

```text
case_id, event_time, event_type, severity_at_event, jurisdiction
```

Requirement:

- immutable audit trail;
- event-time reports;
- replayable;
- 5-year retention.

Choose engine.

Expected answer:

```text
ReplicatedMergeTree if production cluster;
MergeTree if single node/dev.
```

Reason:

- raw source of truth;
- should not collapse/dedup automatically;
- historical audit data must be preserved.

### Exercise 2: Choose Engine for Current Case Status

Data:

```text
case_id, status, assignee, updated_at, version
```

Requirement:

- current dashboard;
- latest version wins;
- duplicate updates possible.

Choose engine.

Expected answer:

```text
ReplacingMergeTree(version)
```

with warning:

- not immediate uniqueness;
- avoid uncontrolled `FINAL`;
- use argMax or compact serving table if needed.

### Exercise 3: Choose Engine for Daily Opened Case Count

Data:

```text
tenant_id, day, jurisdiction, opened_count
```

Requirement:

- simple count rollup;
- additive.

Expected answer:

```text
SummingMergeTree
```

with query still using:

```sql
sum(opened_count)
```

### Exercise 4: Choose Engine for Daily Unique Users

Data:

```text
day, country, user_id
```

Requirement:

- daily unique users;
- roll up by week/month.

Expected answer:

```text
AggregatingMergeTree with uniqState/uniqMerge
```

Not `SummingMergeTree` on daily distinct counts unless you understand double-counting.

### Exercise 5: Choose Engine for Kafka Topic Ingestion

Requirement:

- ingest JSON events from Kafka;
- transform to ClickHouse table.

Expected answer:

```text
Kafka engine + materialized view + MergeTree target
```

or dedicated Java consumer if transformation/error handling is complex.

### Exercise 6: Choose Engine for External Parquet Backfill

Requirement:

- load 3 years historical Parquet files from object storage.

Expected answer:

```text
S3 table function/engine for reading
INSERT INTO MergeTree target
```

Not serving directly from S3 unless measured and acceptable.

---

## 35. Summary

Table engine selection in ClickHouse is one of the most important design decisions.

Core rules:

1. Use `MergeTree`/`ReplicatedMergeTree` for raw append-only analytics data.
2. Use `ReplacingMergeTree` for eventual latest-state/dedup, not immediate uniqueness.
3. Use `SummingMergeTree` only for additive metrics.
4. Use `AggregatingMergeTree` for aggregate states like distinct count and quantiles.
5. Use `CollapsingMergeTree` and `VersionedCollapsingMergeTree` only with strong sign/version discipline.
6. Use `Distributed` as cluster façade; it stores no data itself.
7. Use `Kafka`, `S3`, `File`, and `URL` as integration/staging engines, not blindly as final serving storage.
8. Use `Memory`, `Null`, and `Buffer` only when their loss/flush semantics are acceptable.
9. Always design query layer around engine semantics.
10. Always ask: “If merge has not happened yet, is my query still correct?”

The practical mindset:

> Do not choose a ClickHouse engine because it sounds powerful.  
> Choose it because its merge behavior matches your data semantics and your query layer can read it correctly.

---

## 36. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi sesuai versi yang kamu pakai:

1. ClickHouse Docs — Table Engines.
2. ClickHouse Docs — MergeTree table engine.
3. ClickHouse Docs — MergeTree engine family.
4. ClickHouse Docs — ReplacingMergeTree.
5. ClickHouse Docs — SummingMergeTree.
6. ClickHouse Docs — AggregatingMergeTree.
7. ClickHouse Docs — CollapsingMergeTree.
8. ClickHouse Docs — VersionedCollapsingMergeTree.
9. ClickHouse Docs — Replicated table engines.
10. ClickHouse Docs — Distributed table engine.
11. ClickHouse Docs — Kafka table engine.
12. ClickHouse Docs — S3 integration.
13. ClickHouse Docs — SharedMergeTree for ClickHouse Cloud.

---

## 37. Status Seri

Part ini adalah:

```text
Part 018 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 019 — Updates, Deletes, Deduplication, and Mutable Analytics
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-017.md">⬅️ Part 017 — Joins in ClickHouse: Algorithms, Dictionaries, Denormalization, and Trade-offs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-019.md">Part 019 — Updates, Deletes, Deduplication, and Mutable Analytics ➡️</a>
</div>

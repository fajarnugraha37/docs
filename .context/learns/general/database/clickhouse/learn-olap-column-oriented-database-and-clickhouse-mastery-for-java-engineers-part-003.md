# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-003.md

# Part 003 — ClickHouse Architecture Overview: Server, Tables, Parts, Blocks, and Pipelines

> Series: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **003 / 034**  
> Focus: **Arsitektur ClickHouse dari sudut pandang sistem: server, table engines, insert path, query path, MergeTree parts, blocks, marks, granules, background merges, local table, distributed table, dan mental model debugging produksi.**

---

## 0. Posisi Part Ini dalam Series

Di Part 000 kita membangun orientasi besar: OLAP adalah disiplin engineering yang berbeda dari OLTP.  
Di Part 001 kita membedah bentuk workload analytics: event, fact, dimension, measure, metric, grain, cardinality, dan query shape.  
Di Part 002 kita masuk ke mental model columnar storage: column pruning, compression, vectorized execution, predicate pushdown, late materialization, dan block-oriented processing.

Sekarang kita masuk ke ClickHouse sebagai sistem nyata.

Tujuan part ini bukan menghafal semua komponen ClickHouse, melainkan membangun **peta internal**:

```text
Client / App / BI Tool / Java Service
        |
        v
ClickHouse Server
        |
        +-- SQL Parser / Analyzer / Planner
        |
        +-- Query Execution Pipeline
        |
        +-- Table Engine Layer
        |
        +-- Storage Layer
              |
              +-- Database
              +-- Table
              +-- Partition
              +-- Part
              +-- Column files
              +-- Marks
              +-- Granules
              +-- Compressed blocks
```

Setelah part ini, setiap konsep lanjutan seperti `ORDER BY`, `PARTITION BY`, MergeTree, materialized view, distributed tables, mutations, TTL, query logs, dan performance tuning akan terasa lebih masuk akal.

---

## 1. Core Thesis

ClickHouse cepat bukan karena satu fitur ajaib.

ClickHouse cepat karena kombinasi beberapa keputusan desain yang saling menguatkan:

1. **Column-oriented storage**: hanya baca kolom yang dibutuhkan.
2. **Compressed column files**: lebih sedikit I/O dan lebih banyak data masuk cache.
3. **Vectorized execution**: proses data dalam batch/blocks, bukan row-by-row.
4. **Sparse primary index**: skip banyak granule tanpa index sebesar row-level B-tree.
5. **Sorted immutable parts**: data disimpan dalam part yang immutable dan terurut.
6. **Background merges**: banyak part kecil digabung asynchronous menjadi part lebih besar.
7. **Massive parallelism**: baca, filter, aggregate, dan merge dilakukan paralel.
8. **Table-engine architecture**: behavior table ditentukan oleh engine, bukan satu model universal.
9. **Distributed query fan-out**: query bisa disebar ke shard/replica.
10. **SQL frontend**: pengguna tetap menulis SQL meskipun engine internalnya sangat berbeda dari OLTP DB.

Mental model yang penting:

> ClickHouse adalah sistem yang mengubah query SQL menjadi pipeline eksekusi paralel atas kolom-kolom terkompresi yang disimpan dalam immutable sorted parts.

---

## 2. ClickHouse dari Sudut Pandang Java Engineer

Sebagai Java engineer, jangan bayangkan ClickHouse seperti `PostgreSQL tapi lebih cepat untuk analytics`.

Bayangkan ClickHouse seperti kombinasi dari:

```text
Columnar file store
+ SQL execution engine
+ background compaction engine
+ distributed query coordinator
+ ingestion-optimized append store
+ analytical aggregation runtime
```

Dalam aplikasi Java, ClickHouse biasanya berperan sebagai:

1. **Analytics serving database**
   - dashboard,
   - reporting,
   - operational analytics,
   - audit analytics,
   - product analytics,
   - observability analytics.

2. **Read-heavy analytical backend**
   - queries scan jutaan sampai miliaran rows,
   - output biasanya kecil: chart, table, aggregate, export.

3. **Append-oriented sink**
   - data masuk sebagai events, logs, metrics, facts, CDC result, atau batch load.

4. **Fast aggregation engine**
   - `GROUP BY`, top-N, percentile, distinct count, time bucket, cohort, funnel.

5. **Specialized storage layer**
   - bukan tempat utama untuk transaksi bisnis mutable.

Dari sisi Java service, pola umum:

```text
OLTP System / Event Producer
        |
        v
Ingestion Pipeline
        |
        v
ClickHouse Raw Table
        |
        +--> Materialized View / Rollup Table
        |
        v
Analytics API Service
        |
        v
Frontend Dashboard / BI / Internal Tools
```

---

## 3. Komponen Besar ClickHouse

Secara konseptual, ClickHouse bisa dibagi menjadi beberapa layer.

```text
+-------------------------------------------------------------+
| Client Layer                                                |
| HTTP, Native protocol, JDBC, Java client, BI tools           |
+-------------------------------------------------------------+
| SQL Layer                                                   |
| Parser, analyzer, optimizer/planner                         |
+-------------------------------------------------------------+
| Execution Layer                                             |
| Query pipeline, processors, transforms, aggregation, joins   |
+-------------------------------------------------------------+
| Table Engine Layer                                          |
| MergeTree, ReplicatedMergeTree, Distributed, Memory, S3, ... |
+-------------------------------------------------------------+
| Storage Layer                                               |
| Parts, columns, marks, granules, compressed blocks           |
+-------------------------------------------------------------+
| Background Services                                         |
| Merges, mutations, replication queues, TTL, cleanup          |
+-------------------------------------------------------------+
| System Metadata / Observability                             |
| system.query_log, system.parts, system.merges, etc.          |
+-------------------------------------------------------------+
```

Yang sering membingungkan pemula:

- `Database` di ClickHouse adalah namespace/logical grouping.
- `Table` punya `ENGINE` yang menentukan storage dan behavior.
- Engine paling penting untuk persistent analytical tables adalah keluarga `MergeTree`.
- `Distributed` table bukan tempat data utama; ia adalah routing/query facade ke table lain di cluster.
- Replication bekerja pada level table, bukan seluruh server.
- Primary key ClickHouse bukan uniqueness constraint seperti OLTP.
- Part adalah unit fisik penting; terlalu banyak part adalah sinyal masalah ingestion/partitioning.

---

## 4. Server Process Mental Model

Satu ClickHouse server adalah proses database yang bisa menerima query, menyimpan data, menjalankan background task, dan berpartisipasi dalam cluster.

Secara sederhana:

```text
clickhouse-server
    |
    +-- listens for client queries
    +-- parses SQL
    +-- executes read/write pipeline
    +-- stores table data
    +-- runs background merges
    +-- runs TTL/mutation tasks
    +-- participates in replication
    +-- exposes system tables and logs
```

Satu server bisa memiliki banyak database dan table.

```text
Server A
  database analytics
    table raw_events
    table daily_user_metrics
    table case_lifecycle_events
  database system
    table query_log
    table parts
    table merges
```

Untuk single-node setup, semua eksekusi terjadi di satu server.

Untuk cluster setup, satu query bisa melibatkan banyak server:

```text
Client
  |
  v
Coordinator Node
  |
  +--> Shard 1 / Replica A
  +--> Shard 2 / Replica A
  +--> Shard 3 / Replica B
  |
  v
merge partial results
  |
  v
Client
```

---

## 5. Database, Table, and Engine

Di ClickHouse, membuat table hampir selalu berarti memilih engine.

Contoh sederhana:

```sql
CREATE TABLE analytics.events
(
    event_time DateTime64(3),
    tenant_id UInt64,
    user_id UInt64,
    event_name LowCardinality(String),
    amount Decimal(18, 2)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_name);
```

Bagian penting:

```text
ENGINE = MergeTree
```

Engine menentukan:

1. bagaimana data disimpan,
2. apakah data persistent atau memory-only,
3. apakah data replicated,
4. apakah table mengarah ke cluster,
5. apakah rows akan di-aggregate saat merge,
6. apakah duplicate/latest-state akan diselesaikan saat merge,
7. apakah table membaca dari external source.

Contoh engine family:

```text
MergeTree family
  - MergeTree
  - ReplicatedMergeTree
  - ReplacingMergeTree
  - SummingMergeTree
  - AggregatingMergeTree
  - CollapsingMergeTree
  - VersionedCollapsingMergeTree

Special / integration engines
  - Distributed
  - Kafka
  - S3
  - File
  - Memory
  - Null
  - Buffer
```

Untuk production analytics, mayoritas table utama menggunakan MergeTree family.

---

## 6. Table Engine Layer: Kenapa ClickHouse Tidak Punya Satu Behavior Universal

Di database OLTP umum, table biasanya punya semantic dasar yang relatif seragam:

- row bisa di-update,
- primary key biasanya unique,
- index row-level,
- constraints kuat,
- transaksi row-level.

Di ClickHouse, table behavior sangat dipengaruhi engine.

Contoh:

```sql
ENGINE = MergeTree
```

Berarti:

- data disimpan sebagai sorted immutable parts,
- query bisa memakai sparse primary index,
- background merges akan menggabungkan parts,
- cocok untuk append-heavy analytics.

```sql
ENGINE = ReplacingMergeTree(version)
```

Berarti:

- rows dengan sorting key sama bisa direduksi ke versi terbaru saat merge,
- berguna untuk latest-state analytics,
- tetapi hasil final tanpa `FINAL` bisa terlihat punya duplicate sementara.

```sql
ENGINE = AggregatingMergeTree
```

Berarti:

- table menyimpan aggregate states,
- cocok untuk materialized pre-aggregation,
- query harus memahami aggregate state functions.

```sql
ENGINE = Distributed(...)
```

Berarti:

- table ini tidak menyimpan data utama secara lokal,
- ia meneruskan query/insert ke shard sesuai konfigurasi cluster.

Mental model:

> Di ClickHouse, table engine adalah bagian dari desain domain dan desain performa, bukan detail implementasi kecil.

---

## 7. Insert Path Overview

Saat data masuk ke table MergeTree, alurnya kira-kira seperti ini:

```text
Client sends INSERT
        |
        v
ClickHouse receives block of rows
        |
        v
Parse / validate / type conversion
        |
        v
Build in-memory block
        |
        v
Sort by ORDER BY key if needed
        |
        v
Write new immutable data part
        |
        v
Part becomes visible to queries
        |
        v
Background merges later combine parts
```

Poin penting:

1. Insert sebaiknya batch, bukan row-by-row.
2. Setiap insert bisa menghasilkan part baru.
3. Terlalu banyak insert kecil menghasilkan banyak part kecil.
4. Banyak part kecil membuat query dan background merge lebih berat.
5. ClickHouse mengoptimalkan append dan merge, bukan random in-place row update.

Contoh salah:

```text
Java service inserts 1 row per HTTP request
        |
        v
1000 inserts/sec
        |
        v
1000 tiny parts/sec
        |
        v
merge backlog
        |
        v
query latency unstable
```

Contoh lebih benar:

```text
Java service / ingestion worker buffers rows
        |
        v
batch every N rows or T seconds
        |
        v
insert 10k - 100k rows per batch depending workload
        |
        v
fewer larger parts
        |
        v
healthier merge behavior
```

Angka batch bukan hukum universal. Yang penting adalah memahami hubungan:

```text
insert frequency + partitioning strategy + batch size => part creation rate
```

---

## 8. Block: Unit Eksekusi Logis

ClickHouse memproses data dalam bentuk blocks.

Block bisa dibayangkan sebagai batch kolom dengan jumlah rows tertentu:

```text
Block
  column tenant_id:   [1, 1, 1, 2, 2, 3, ...]
  column event_time:  [t1, t2, t3, t4, t5, ...]
  column event_name:  [login, view, pay, ...]
  column amount:      [0, 0, 120.50, ...]
```

Ini berbeda dari eksekusi row-by-row.

Row-oriented thinking:

```text
for each row:
    read tenant_id
    read event_time
    read event_name
    read amount
    evaluate predicate
```

Block/vectorized thinking:

```text
read tenant_id column vector
read event_time column vector
compute predicate mask for whole vector
apply mask to needed columns
aggregate selected vectors
```

Analog Java:

```java
// row object style: pointer chasing, object overhead
List<Event> events;
for (Event e : events) {
    if (e.tenantId() == 10 && e.eventTime().isAfter(start)) {
        sum += e.amount();
    }
}

// column vector style: primitive arrays, cache-friendly
long[] tenantIds;
long[] eventTimes;
long[] amounts;
for (int i = 0; i < size; i++) {
    if (tenantIds[i] == 10 && eventTimes[i] >= startEpoch) {
        sum += amounts[i];
    }
}
```

ClickHouse lebih dekat ke model kedua.

---

## 9. Data Part: Unit Fisik Terpenting di MergeTree

Dalam MergeTree, data tidak ditulis dengan cara update file besar secara langsung.

Data ditulis sebagai **parts**.

```text
Table events
  partition 202606
    part_001
    part_002
    part_003
  partition 202607
    part_004
    part_005
```

Part adalah sekumpulan data immutable yang sudah disortir berdasarkan `ORDER BY`.

Setiap part berisi file-file kolom dan metadata.

Konseptual:

```text
part_001/
  tenant_id.bin
  tenant_id.mrk
  event_time.bin
  event_time.mrk
  event_name.bin
  event_name.mrk
  amount.bin
  amount.mrk
  primary.idx
  checksums.txt
  columns.txt
  count.txt
```

Nama file sebenarnya bisa berbeda tergantung format part, compact/wide, versi, setting, dan layout internal. Tapi mental modelnya:

```text
part = sorted immutable segment of table data
```

Kenapa part penting?

Karena hampir semua operasi produksi menyentuh part:

- query membaca part,
- index berada per part,
- background merges menggabungkan part,
- mutation me-rewrite part,
- TTL bisa menghapus/memindahkan data per part,
- backup/restore memperhatikan part,
- `system.parts` menunjukkan kesehatan table.

Jika kamu tidak memahami part, kamu akan kesulitan memahami performance ClickHouse.

---

## 10. Partition vs Part

Ini sering membingungkan.

Partition adalah grouping logical/fisik berdasarkan ekspresi `PARTITION BY`.

Part adalah unit data immutable yang dibuat oleh insert dan merge.

Contoh:

```sql
PARTITION BY toYYYYMM(event_time)
```

Maka data Juni 2026 masuk partition `202606`.

Di dalam partition itu bisa ada banyak parts:

```text
partition 202606
  part A from insert batch 1
  part B from insert batch 2
  part C from insert batch 3
  part D from merge(A+B)
```

Mental model:

```text
Table
  -> Partition
      -> Part
          -> Granule
              -> Column compressed blocks
```

Atau:

```text
Partition = lifecycle boundary
Part      = physical storage/merge unit
Granule   = index/scan unit
Block     = processing unit
```

Part berikutnya di series akan masuk sangat dalam ke MergeTree, tapi untuk sekarang cukup pegang relasi ini.

---

## 11. Granule and Mark: Unit Skipping

ClickHouse tidak membuat index untuk setiap row seperti B-tree row-store.

ClickHouse membuat sparse primary index.

Konsepnya:

```text
Rows sorted by ORDER BY
  row 0
  row 1
  ...
  row 8191
  row 8192
  ...
```

Sekelompok rows disebut granule.

```text
Granule 0: rows 0 - 8191
Granule 1: rows 8192 - 16383
Granule 2: rows 16384 - 24575
```

Setiap granule punya mark/index entry.

```text
Primary index
  mark for granule 0: key value at first row
  mark for granule 1: key value at first row
  mark for granule 2: key value at first row
```

Query dengan predicate yang cocok dengan sorting key bisa skip granule.

Misal table sorted by:

```sql
ORDER BY (tenant_id, event_time)
```

Query:

```sql
SELECT count()
FROM events
WHERE tenant_id = 42
  AND event_time >= '2026-06-01'
  AND event_time <  '2026-07-01';
```

ClickHouse bisa menggunakan sparse index untuk menemukan range granule yang mungkin berisi `tenant_id = 42` pada waktu tersebut.

Ia tidak menjamin hanya membaca row matching. Ia membaca granule yang mungkin mengandung data matching.

Penting:

```text
ClickHouse primary index skips granules, not individual rows.
```

Konsekuensi:

- sorting key sangat penting,
- query filter harus align dengan sorting key,
- data clustering memengaruhi skip efficiency,
- high-cardinality/random first key bisa merusak locality.

---

## 12. Marks vs Granules vs Blocks

Istilah ini sering terlihat mirip, tapi punya peran berbeda.

```text
Granule
  group of rows in sorted data; smallest scan/index lookup unit conceptually.

Mark
  pointer/index metadata to locate granule in column files.

Compressed block
  physical compressed bytes on disk for column data.

Execution block
  in-memory batch of columns processed by pipeline.
```

Relasi sederhana:

```text
On disk:
  column files are split into compressed blocks
  marks help locate data ranges
  granules define groups of rows for sparse index

In memory:
  data is read into blocks
  execution pipeline transforms blocks
```

Jangan menyamakan semua “block”. Dalam dokumentasi dan diskusi ClickHouse, konteks penting.

---

## 13. Query Path Overview

Saat query SELECT masuk:

```sql
SELECT
    toStartOfHour(event_time) AS hour,
    event_name,
    count() AS c
FROM events
WHERE tenant_id = 42
  AND event_time >= now() - INTERVAL 7 DAY
GROUP BY hour, event_name
ORDER BY hour, c DESC;
```

Alur konseptual:

```text
Client sends SELECT
        |
        v
Parse SQL
        |
        v
Analyze identifiers, functions, types
        |
        v
Build query plan / pipeline
        |
        v
Prune columns
        |
        v
Select parts/partitions
        |
        v
Use primary index / skip indexes to choose granules
        |
        v
Read needed columns from disk/cache
        |
        v
Decompress into column vectors
        |
        v
Apply filters
        |
        v
Compute expressions
        |
        v
Aggregate
        |
        v
Sort/limit/finalize
        |
        v
Return result
```

Yang perlu diperhatikan:

1. ClickHouse tidak membaca semua kolom jika tidak diperlukan.
2. ClickHouse mencoba memilih data ranges yang relevan.
3. ClickHouse memproses data dalam pipeline paralel.
4. Aggregation bisa menjadi bottleneck memory.
5. Sorting global bisa mahal.
6. Distributed query menambah network dan merge step.

---

## 14. Query Pipeline Mental Model

ClickHouse query bukan satu loop sederhana.

Lebih tepat dibayangkan sebagai pipeline operator:

```text
ReadFromMergeTree
    |
    v
FilterTransform
    |
    v
ExpressionTransform
    |
    v
AggregatingTransform
    |
    v
MergingAggregatedTransform
    |
    v
SortingTransform
    |
    v
LimitTransform
    |
    v
OutputFormat
```

Pada query paralel, pipeline bisa bercabang:

```text
Read part ranges in parallel
    |       |       |
    v       v       v
Filter  Filter  Filter
    |       |       |
    v       v       v
Partial aggregate
    |       |       |
    +--- merge partial states ---+
                |
                v
          final aggregate
                |
                v
              output
```

Ini penting untuk performance reasoning.

Jika query lambat, pertanyaannya bukan hanya “index ada atau tidak?”.

Pertanyaan yang lebih benar:

1. Berapa banyak rows/granules/parts yang dibaca?
2. Kolom mana yang dibaca?
3. Apakah predicate align dengan sorting key?
4. Apakah aggregation cardinality terlalu tinggi?
5. Apakah memory cukup?
6. Apakah ada join besar?
7. Apakah sorting global besar?
8. Apakah query distributed menghabiskan network?
9. Apakah background merges mengganggu I/O?
10. Apakah part count terlalu tinggi?

---

## 15. Column Pruning in the Architecture

Misal table punya 200 kolom:

```sql
CREATE TABLE events
(
    event_time DateTime64(3),
    tenant_id UInt64,
    user_id UInt64,
    session_id String,
    event_name String,
    page_url String,
    user_agent String,
    ip String,
    country String,
    device_type String,
    ... 190 more columns ...
)
ENGINE = MergeTree
ORDER BY (tenant_id, event_time);
```

Query:

```sql
SELECT count()
FROM events
WHERE tenant_id = 10
  AND event_time >= today() - 7;
```

Secara ideal, ClickHouse hanya perlu membaca:

```text
tenant_id
event_time
```

Jika query:

```sql
SELECT event_name, count()
FROM events
WHERE tenant_id = 10
  AND event_time >= today() - 7
GROUP BY event_name;
```

Maka perlu:

```text
tenant_id
event_time
event_name
```

Tidak perlu membaca `user_agent`, `page_url`, `ip`, dan kolom lain.

Ini alasan wide table masuk akal di OLAP: selama query hanya menyentuh subset kolom, wide table tidak otomatis berarti semua data dibaca.

Namun wide table tetap punya trade-off:

- insert block lebih besar,
- schema evolution lebih kompleks,
- nullable/string-heavy columns bisa mahal,
- query `SELECT *` menjadi sangat buruk,
- operational metadata lebih besar.

---

## 16. Background Merges: Compaction as a Core Architecture Feature

MergeTree menulis data sebagai part baru, lalu menggabungkan parts di background.

```text
Initial inserts:
  part_1
  part_2
  part_3
  part_4

Background merge:
  merge(part_1, part_2) -> part_5
  merge(part_3, part_4) -> part_6
  merge(part_5, part_6) -> part_7
```

Part lama biasanya tidak langsung hilang sampai aman untuk cleanup.

Mengapa merge penting?

1. Mengurangi jumlah parts.
2. Meningkatkan query efficiency.
3. Meningkatkan compression.
4. Menjalankan logic engine tertentu seperti ReplacingMergeTree/SummingMergeTree/AggregatingMergeTree.
5. Menjalankan TTL/mutation effects dalam banyak kasus.

Merge adalah background cost.

Artinya ClickHouse memiliki dua jenis pekerjaan besar:

```text
foreground workload:
  - SELECT queries
  - INSERT queries

background workload:
  - merges
  - mutations
  - TTL
  - replication fetches
  - cleanup
```

Jika ingestion buruk, background workload bisa mengejar terus dan mengganggu query.

---

## 17. Insert Visibility and Merge Asynchrony

Data yang di-insert biasanya bisa terlihat setelah part commit/visible.

Namun merge berjalan asynchronous.

Ini membawa konsekuensi penting.

Untuk table biasa MergeTree:

```text
inserted rows visible quickly
merge later optimizes physical layout
```

Untuk engine seperti ReplacingMergeTree:

```text
insert duplicate/new version rows
rows may both be visible before merge
merge eventually collapses/replaces rows
query with FINAL can force final view but expensive
```

Untuk AggregatingMergeTree:

```text
partial aggregate states can be merged later
query must finalize/merge states correctly
```

Jadi jangan selalu menganggap hasil fisik sudah “fully compacted” segera setelah insert.

Mental model:

> Inserts are foreground; convergence/optimization is often background.

---

## 18. Read Isolation from Background Merges

Saat merge berlangsung, query tetap bisa membaca table.

Karena parts immutable, ClickHouse bisa melakukan model mirip snapshot atas set of parts yang aktif.

Konseptual:

```text
Before merge:
  active parts = A, B, C

During merge:
  A + B -> D is being built
  queries can still read A, B, C

After merge commit:
  active parts = D, C
  old A, B later removed
```

Ini salah satu keuntungan immutable parts:

- query tidak perlu membaca file yang sedang diubah in-place,
- merge bisa membangun part baru lalu commit metadata,
- concurrency read/write lebih mudah dibanding update-in-place storage.

Namun tetap ada cost:

- disk space sementara meningkat,
- I/O background meningkat,
- terlalu banyak merges bisa berebut resource dengan queries.

---

## 19. Local Table vs Distributed Table

Dalam cluster ClickHouse, pola umum:

```text
Local table:
  stores actual data on each shard/replica

Distributed table:
  logical facade that sends query to local tables across cluster
```

Contoh:

```sql
CREATE TABLE events_local
(
    event_time DateTime64(3),
    tenant_id UInt64,
    event_name String
)
ENGINE = ReplicatedMergeTree(...)
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time);
```

Lalu:

```sql
CREATE TABLE events_distributed
AS events_local
ENGINE = Distributed(
    analytics_cluster,
    analytics,
    events_local,
    cityHash64(tenant_id)
);
```

Query ke `events_distributed`:

```sql
SELECT event_name, count()
FROM events_distributed
WHERE tenant_id = 42
GROUP BY event_name;
```

Konseptual:

```text
Client
  |
  v
Distributed table on coordinator
  |
  +--> events_local on shard 1
  +--> events_local on shard 2
  +--> events_local on shard 3
  |
  v
Merge partial results
  |
  v
Client
```

Key point:

- local table menyimpan data,
- distributed table merutekan query/insert,
- sharding key menentukan distribusi data,
- query distributed punya biaya network dan result merging,
- salah sharding key bisa membuat query tenant-specific tetap menyentuh semua shard.

---

## 20. Shard and Replica Mental Model

Shard dan replica sering tertukar.

```text
Shard = horizontal data partition
Replica = copy of same shard data
```

Contoh 2 shards, 2 replicas:

```text
Cluster
  Shard 1
    Replica 1A
    Replica 1B

  Shard 2
    Replica 2A
    Replica 2B
```

Jika data di-shard by tenant:

```text
tenant_id hash -> Shard 1 or Shard 2
```

Replica memberi redundancy/failover dan bisa membantu read scaling.

Shard memberi capacity/parallelism karena data dibagi.

Pertanyaan desain:

```text
Need more storage / scan throughput?  -> add shards
Need failover / read redundancy?      -> add replicas
Need both?                            -> shards + replicas
```

Tetapi distributed systems tidak gratis:

- insert routing lebih kompleks,
- query merge lebih kompleks,
- replication lag bisa terjadi,
- cluster metadata harus dikelola,
- schema migration perlu hati-hati,
- network menjadi bottleneck.

---

## 21. Replication Is Table-Level

Dalam ClickHouse, replication pada MergeTree family menggunakan engine replicated, misalnya `ReplicatedMergeTree`.

Penting:

```text
Replication is configured per table, not automatically for the whole server.
```

Implikasi:

1. Satu server bisa punya table replicated dan non-replicated.
2. Membuat database/table di semua node perlu strategi migration/deployment.
3. `ON CLUSTER` membantu menjalankan DDL di cluster, tetapi tetap perlu dipahami.
4. Replication queue perlu dimonitor.
5. Data consistency dan lag perlu masuk operational thinking.

Part distributed/replication akan dibahas mendalam di Part 020 dan Part 021.

Untuk sekarang, pegang mental model:

```text
ReplicatedMergeTree local table = physical data copy participating in replication
Distributed table = query/insert routing across cluster
```

---

## 22. Query Coordinator in Distributed Query

Saat query ke distributed table, node yang menerima query berperan sebagai coordinator.

Tugas coordinator:

1. menentukan shard/replica target,
2. mengirim subquery,
3. menerima partial result,
4. merge/finalize hasil,
5. mengirim response ke client.

Contoh aggregation distributed:

```sql
SELECT event_name, count()
FROM events_distributed
WHERE event_time >= today() - 1
GROUP BY event_name;
```

Eksekusi konseptual:

```text
Shard 1: event_name -> partial count
Shard 2: event_name -> partial count
Shard 3: event_name -> partial count
Coordinator: merge counts by event_name
```

Jika cardinality `event_name` kecil, merge ringan.

Jika group by key high-cardinality:

```sql
GROUP BY user_id, session_id, request_id
```

Maka partial result besar bisa dikirim lewat network ke coordinator.

Akibatnya bottleneck berpindah:

```text
not disk scan anymore
but network + coordinator memory + merge CPU
```

---

## 23. System Tables: Architecture Visibility

ClickHouse menyediakan banyak `system.*` tables untuk melihat kondisi internal.

Yang sangat penting:

```text
system.tables       -> metadata table
system.columns      -> metadata column
system.parts        -> active/inactive parts
system.merges       -> running background merges
system.mutations    -> mutation status
system.query_log    -> query history and metrics
system.processes    -> currently running queries
system.errors       -> errors
system.disks        -> disk config/status
system.replicas     -> replica status for replicated tables
```

Contoh inspeksi part:

```sql
SELECT
    database,
    table,
    partition,
    count() AS part_count,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS size
FROM system.parts
WHERE active
GROUP BY database, table, partition
ORDER BY part_count DESC;
```

Query ini menjawab:

- partition mana yang punya terlalu banyak parts,
- table mana yang part count-nya tidak sehat,
- apakah ingestion/merge bermasalah.

Contoh inspeksi query:

```sql
SELECT
    query_duration_ms,
    read_rows,
    read_bytes,
    result_rows,
    memory_usage,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
ORDER BY event_time DESC
LIMIT 20;
```

Ini membantu melihat:

- query membaca rows terlalu banyak,
- query membaca bytes terlalu besar,
- query memory-heavy,
- result kecil tapi scan besar,
- query pattern buruk.

---

## 24. Architecture by Request Type

### 24.1 INSERT Request

```text
Java ingestion worker
  -> HTTP/native/JDBC insert
  -> ClickHouse validates schema/types
  -> data forms block
  -> sort/compress/write new part
  -> part visible
  -> background merge later
```

Primary concerns:

- batch size,
- partition spread,
- insert frequency,
- type conversion,
- duplicate handling,
- retry semantics,
- async inserts,
- write amplification from merges.

### 24.2 SELECT Request

```text
Analytics API
  -> SELECT query
  -> parse/analyze
  -> choose columns/parts/granules
  -> read compressed column data
  -> filter/aggregate/sort
  -> return result
```

Primary concerns:

- scanned rows,
- scanned columns,
- sorting key alignment,
- aggregation cardinality,
- memory,
- distributed fan-out,
- result size.

### 24.3 ALTER / Mutation Request

```text
ALTER TABLE ... UPDATE/DELETE
  -> mutation metadata created
  -> background task rewrites affected parts
  -> progress visible in system.mutations
```

Primary concerns:

- mutations are expensive,
- rewrite can lag,
- many mutations harm cluster,
- not equivalent to OLTP row update.

### 24.4 DROP PARTITION / TTL

```text
lifecycle operation
  -> can remove old data efficiently if partitioning matches retention
```

Primary concerns:

- partition design,
- retention window,
- storage cleanup,
- compliance delete requirements.

---

## 25. Why ClickHouse Primary Key Is Not OLTP Primary Key

In OLTP:

```sql
PRIMARY KEY (id)
```

Usually means:

- unique,
- row identity,
- lookup path,
- foreign key reference target,
- constraint.

In ClickHouse MergeTree:

```sql
ORDER BY (tenant_id, event_time)
```

and optionally:

```sql
PRIMARY KEY (tenant_id, event_time)
```

Means primarily:

- sort order,
- sparse index expression,
- data clustering,
- skip granule ability,
- compression improvement.

It does **not** inherently mean unique row identity.

This is a major conceptual shift.

Bad assumption:

```text
I need unique id primary key, so ORDER BY id.
```

Often bad for analytics because UUID/random id destroys locality.

Better thinking:

```text
What filters are most common?
What dimensions cluster data naturally?
What time range do queries scan?
What order maximizes skipping and compression?
```

Example:

```sql
ORDER BY (tenant_id, event_time, event_name)
```

Might be much better for tenant-scoped time-range analytics than:

```sql
ORDER BY event_id
```

Even if `event_id` is unique.

---

## 26. Architecture Example: Case Lifecycle Analytics

Misal kita punya regulatory/case management platform.

OLTP tables mungkin punya:

```text
cases
case_status_history
case_assignments
case_actions
case_documents
case_escalations
case_sla_breaches
```

Untuk OLAP, kita bisa menghasilkan event/fact stream:

```text
case_lifecycle_events
  event_time
  tenant_id
  case_id
  actor_id
  previous_state
  next_state
  transition_type
  enforcement_stage
  risk_level
  region
  team_id
  elapsed_ms_since_previous_state
  sla_target_ms
  sla_breached
```

ClickHouse table:

```sql
CREATE TABLE case_lifecycle_events
(
    event_time DateTime64(3),
    tenant_id UInt64,
    case_id UUID,
    actor_id UInt64,
    previous_state LowCardinality(String),
    next_state LowCardinality(String),
    transition_type LowCardinality(String),
    enforcement_stage LowCardinality(String),
    risk_level LowCardinality(String),
    region LowCardinality(String),
    team_id UInt64,
    elapsed_ms_since_previous_state UInt64,
    sla_target_ms UInt64,
    sla_breached UInt8
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, enforcement_stage, transition_type);
```

Query:

```sql
SELECT
    enforcement_stage,
    transition_type,
    count() AS transitions,
    quantile(0.95)(elapsed_ms_since_previous_state) AS p95_elapsed_ms,
    sum(sla_breached) AS breaches
FROM case_lifecycle_events
WHERE tenant_id = 10
  AND event_time >= now() - INTERVAL 30 DAY
GROUP BY enforcement_stage, transition_type
ORDER BY breaches DESC;
```

Why this aligns with architecture:

1. `tenant_id` and `event_time` filter align with sorting key.
2. `LowCardinality` helps repeated dimension strings.
3. Query reads only relevant columns.
4. Data is append-oriented.
5. Time partition supports retention/backfill.
6. Aggregation output is small relative to scan.

---

## 27. Architecture Example: Product Event Analytics

Table:

```sql
CREATE TABLE product_events
(
    event_time DateTime64(3),
    tenant_id UInt64,
    user_id UInt64,
    session_id UUID,
    event_name LowCardinality(String),
    page LowCardinality(String),
    country LowCardinality(String),
    device LowCardinality(String),
    revenue Decimal(18, 2)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_name, user_id);
```

Query:

```sql
SELECT
    toDate(event_time) AS d,
    event_name,
    count() AS events,
    uniq(user_id) AS users
FROM product_events
WHERE tenant_id = 7
  AND event_time >= today() - 30
GROUP BY d, event_name
ORDER BY d, events DESC;
```

Column read likely:

```text
event_time
tenant_id
event_name
user_id
```

Not read:

```text
session_id
page
country
device
revenue
```

This is columnar advantage in practice.

---

## 28. Architecture Example: Observability Logs

Logs table:

```sql
CREATE TABLE app_logs
(
    timestamp DateTime64(3),
    service LowCardinality(String),
    environment LowCardinality(String),
    level LowCardinality(String),
    trace_id String,
    span_id String,
    message String,
    error_type LowCardinality(String),
    duration_ms UInt32,
    attributes Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (environment, service, timestamp, level);
```

Query:

```sql
SELECT
    service,
    error_type,
    count() AS errors
FROM app_logs
WHERE environment = 'prod'
  AND timestamp >= now() - INTERVAL 1 HOUR
  AND level = 'ERROR'
GROUP BY service, error_type
ORDER BY errors DESC;
```

Good:

- filters align with sort key prefix,
- reads limited columns,
- time partition helps lifecycle.

Risk:

- free-text `message` search may be less efficient,
- `Map(String, String)` can be flexible but costly,
- high-cardinality attributes can explode aggregation.

---

## 29. Deployment Modes: Single Node, Replicated, Sharded

### 29.1 Single Node

```text
One ClickHouse server
  - simplest
  - excellent for learning/dev/small-medium workloads
  - no HA
  - vertical scaling only
```

Use when:

- workload fits one machine,
- early stage,
- non-critical analytics,
- simple operational footprint.

### 29.2 Replicated Single Shard

```text
Shard 1
  Replica A
  Replica B
```

Use when:

- data fits one shard,
- need HA/failover,
- want replica for reads.

### 29.3 Sharded + Replicated Cluster

```text
Shard 1: Replica A, B
Shard 2: Replica A, B
Shard 3: Replica A, B
```

Use when:

- data exceeds one node,
- scan throughput needs parallelism,
- storage needs horizontal scaling,
- HA required.

Trade-off:

- more operational complexity,
- distributed query complexity,
- schema migration complexity,
- monitoring complexity,
- cost.

---

## 30. ClickHouse Keeper / ZooKeeper Context

For replicated MergeTree setups, ClickHouse needs coordination metadata.

Historically this often used ZooKeeper. ClickHouse also provides ClickHouse Keeper.

Conceptual responsibilities:

- replication coordination,
- table part metadata coordination,
- leader election/coordination-like tasks for replication,
- distributed DDL coordination depending setup.

Do not confuse this with storing data.

```text
Data lives in ClickHouse disks/object storage.
Keeper/ZooKeeper coordinates metadata for replication.
```

Operationally:

- Keeper health matters,
- replication queue health matters,
- network latency matters,
- misconfigured paths/macros can cause serious issues.

Deep dive later in Part 021.

---

## 31. The Three Critical Physical Questions

Whenever designing a ClickHouse table, ask:

### 31.1 How will data be grouped over lifecycle?

This is `PARTITION BY`.

Examples:

```sql
PARTITION BY toYYYYMM(event_time)
PARTITION BY toYYYYMMDD(timestamp)
```

Concern:

- retention,
- drop partition,
- backfill,
- merge boundaries,
- partition count.

### 31.2 How will data be sorted inside parts?

This is `ORDER BY`.

Concern:

- primary index skipping,
- compression,
- common filters,
- tenant/time locality,
- query patterns.

### 31.3 How will data be distributed across cluster?

This is sharding key / Distributed engine config.

Concern:

- data balance,
- tenant locality,
- distributed query fan-out,
- hot shards,
- failure isolation.

These three decisions are more important than most syntax details.

---

## 32. Lifecycle of a Row in ClickHouse

Suppose Java service inserts an event:

```json
{
  "event_time": "2026-06-21T10:15:30.123",
  "tenant_id": 42,
  "event_name": "CASE_ESCALATED",
  "case_id": "...",
  "risk_level": "HIGH"
}
```

Lifecycle:

```text
1. Java service batches event with others.
2. Batch sent to ClickHouse.
3. ClickHouse parses and converts data types.
4. Rows become in-memory block.
5. Rows are sorted according to ORDER BY.
6. New data part is written to partition based on PARTITION BY.
7. Part becomes active/visible.
8. Query can read this part.
9. Background merge later combines this part with others.
10. If TTL applies, row/part may eventually expire.
11. If replicated, part metadata/data is coordinated/fetched by replicas.
12. If backup runs, part is included depending backup strategy.
```

This lifecycle is the foundation for understanding:

- ingestion latency,
- eventual merge convergence,
- read performance,
- retention,
- replication,
- mutation cost.

---

## 33. Why Small Inserts Hurt

A common production failure:

```text
Application writes too frequently with tiny batches.
```

Example:

```text
500 Java app instances
each sends insert every second
for each tenant independently
with partition by day
```

Potential result:

```text
many tiny parts per table/partition
background merges fall behind
system.parts active count grows
query must consider many parts
metadata overhead grows
filesystem pressure grows
latency becomes unstable
```

Better pattern:

```text
buffer -> batch -> insert less frequently -> create fewer larger parts
```

Options:

- application-side batching,
- ingestion worker,
- queue/stream sink,
- ClickHouse async inserts,
- buffer table with caution,
- file/object storage batch load.

Part 010 and 011 will go deep into ingestion architecture.

---

## 34. Why Too Many Partitions Hurt

Another common failure:

```sql
PARTITION BY (tenant_id, toYYYYMMDD(event_time))
```

Looks intuitive:

```text
tenant isolation + daily lifecycle
```

But if there are 10,000 tenants per day:

```text
10,000 partitions/day
```

This can create severe metadata and merge fragmentation.

Better thinking:

- partition is lifecycle boundary,
- sorting key handles query locality,
- tenant_id often belongs in ORDER BY, not PARTITION BY,
- partition count should remain manageable.

Usually:

```sql
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time)
```

is healthier than:

```sql
PARTITION BY (tenant_id, toYYYYMMDD(event_time))
ORDER BY event_time
```

But exact decision depends on retention, tenant size, query shape, and backfill requirements.

---

## 35. Why `SELECT *` Is Architecturally Hostile

In OLTP, `SELECT *` is often bad but survivable for small rows.

In ClickHouse, `SELECT *` destroys a major advantage:

```text
column pruning
```

If table has 150 columns and query needs 5, selecting all 150 means:

- more disk reads,
- more decompression,
- more memory movement,
- more network output,
- worse cache behavior,
- slower query.

Analytics API should generate explicit column lists.

Bad:

```sql
SELECT *
FROM events
WHERE tenant_id = ?
LIMIT 1000;
```

Better:

```sql
SELECT
    event_time,
    event_name,
    user_id,
    amount
FROM events
WHERE tenant_id = ?
ORDER BY event_time DESC
LIMIT 1000;
```

Even better if API endpoint is designed around analytical intent rather than raw browsing.

---

## 36. Memory Model of Query Execution

ClickHouse can scan huge data efficiently, but not all operations stream with constant memory.

Memory-heavy operations:

1. high-cardinality `GROUP BY`,
2. exact distinct count,
3. large joins,
4. large `ORDER BY` without limit optimization,
5. distributed result merge,
6. complex array/map processing,
7. building large intermediate states.

Example dangerous query:

```sql
SELECT
    user_id,
    session_id,
    request_id,
    count()
FROM events
WHERE event_time >= today() - 30
GROUP BY user_id, session_id, request_id;
```

If those keys are very high-cardinality, aggregation state can explode.

Architecture implication:

- fast scan does not mean infinite memory,
- pre-aggregation may be needed,
- approximate functions may be better,
- query limits/settings matter,
- API should prevent unbounded group-by dimensions.

---

## 37. Concurrency Model at a High Level

ClickHouse is designed for high throughput analytics, but concurrency must still be managed.

Types of concurrent work:

```text
many dashboard queries
+ ingestion inserts
+ background merges
+ mutations
+ distributed fetches
+ exports
```

Potential contention:

- CPU for scan/decompression/aggregation,
- disk I/O for reads and merges,
- memory for aggregation/join/sort,
- network for distributed queries/results,
- Keeper/metadata for replication-heavy operations.

Common production strategy:

1. set query limits,
2. isolate heavy exports,
3. pre-aggregate dashboards,
4. avoid mutation storms,
5. monitor background merges,
6. control ingestion batch behavior,
7. separate workloads by cluster or user settings if necessary.

---

## 38. Observability of the Architecture

A production ClickHouse engineer should be comfortable answering:

```text
What queries are running now?
What queries were slow recently?
How many rows/bytes did they read?
How much memory did they use?
Which tables have too many parts?
Are merges running?
Are mutations stuck?
Are replicas delayed?
Is disk filling?
Is query load CPU-bound, IO-bound, memory-bound, or network-bound?
```

Starter queries:

```sql
SELECT
    query_id,
    elapsed,
    read_rows,
    read_bytes,
    memory_usage,
    query
FROM system.processes
ORDER BY elapsed DESC;
```

```sql
SELECT
    database,
    table,
    count() AS active_parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS bytes
FROM system.parts
WHERE active
GROUP BY database, table
ORDER BY active_parts DESC;
```

```sql
SELECT
    database,
    table,
    elapsed,
    progress,
    num_parts,
    result_part_name
FROM system.merges
ORDER BY elapsed DESC;
```

```sql
SELECT
    database,
    table,
    mutation_id,
    command,
    create_time,
    is_done,
    latest_failed_part,
    latest_fail_reason
FROM system.mutations
ORDER BY create_time DESC;
```

These are not optional trivia. They are the dashboard of your storage engine.

---

## 39. Common Misleading Mental Models

### 39.1 “ClickHouse is just faster PostgreSQL”

Wrong.

ClickHouse has different storage, indexing, update model, transaction semantics, execution model, and scaling model.

### 39.2 “Primary key means unique row identity”

Wrong for MergeTree mental model.

It is primarily sort/index/clustering design.

### 39.3 “Partition by everything I filter on”

Wrong.

Partition is lifecycle/management boundary. Over-partitioning hurts.

### 39.4 “Small inserts are fine because ClickHouse is fast”

Wrong.

Small inserts produce too many parts and merge pressure.

### 39.5 “Materialized view is just a cached SELECT”

Wrong.

In ClickHouse, materialized views are often insert-triggered transformations into target tables.

### 39.6 “Distributed table stores distributed data”

Misleading.

Distributed table is usually a routing facade; local tables store data.

### 39.7 “Compression is only storage saving”

Incomplete.

Compression can improve query speed by reducing I/O, but costs CPU to decompress.

### 39.8 “All slow queries need indexes”

Too simplistic.

Slow query may be due to aggregation cardinality, sort, join, memory, distributed merge, too many parts, or bad schema.

---

## 40. Concept Map

```text
ClickHouse Server
  |
  +-- SQL interface
  |     +-- parser
  |     +-- analyzer
  |     +-- planner/pipeline builder
  |
  +-- Execution pipeline
  |     +-- read columns
  |     +-- filter
  |     +-- expression
  |     +-- aggregate
  |     +-- sort
  |     +-- merge distributed results
  |
  +-- Table engines
  |     +-- MergeTree
  |     +-- ReplicatedMergeTree
  |     +-- ReplacingMergeTree
  |     +-- AggregatingMergeTree
  |     +-- Distributed
  |
  +-- MergeTree storage
  |     +-- table
  |     +-- partition
  |     +-- part
  |     +-- column file
  |     +-- compressed block
  |     +-- mark
  |     +-- granule
  |
  +-- Background work
  |     +-- merges
  |     +-- mutations
  |     +-- TTL
  |     +-- replication
  |
  +-- Observability
        +-- system.parts
        +-- system.query_log
        +-- system.merges
        +-- system.mutations
        +-- system.replicas
```

---

## 41. Practical Design Walkthrough

Suppose requirement:

> “We need a dashboard showing daily number of enforcement cases by status transition, risk level, region, and team. It must support tenant filtering, last 12 months, and drilldown to case-level events.”

A weak design process:

```text
Create table with all fields.
Partition by tenant.
Order by event_id.
Insert each event immediately.
Let dashboard run SELECT * and filter dynamically.
```

Likely problems:

- tenant partition explosion,
- UUID/event_id sort kills locality,
- tiny inserts create many parts,
- dashboard scans too much,
- no pre-aggregation,
- unpredictable latency.

Better design process:

### 41.1 Identify grain

```text
One row = one case lifecycle event/state transition.
```

### 41.2 Identify common filters

```text
tenant_id
event_time range
region
risk_level
team_id
transition_type/status
```

### 41.3 Choose partition

```sql
PARTITION BY toYYYYMM(event_time)
```

Because retention/backfill likely time-based.

### 41.4 Choose order

```sql
ORDER BY (tenant_id, event_time, transition_type, risk_level)
```

Because tenant/time are dominant filters.

### 41.5 Choose types

```text
LowCardinality(String) for status/risk/region/team label if string-like and repeated.
DateTime64 for event time.
UUID/String for case id depending source.
UInt64 for tenant/team numeric identifiers.
```

### 41.6 Ingestion

```text
Batch events through ingestion worker.
Avoid one-row inserts.
Handle retries with deterministic event_id/dedup strategy if needed.
```

### 41.7 Serving

```text
Dashboard queries select explicit columns.
Rollups/materialized views considered for daily aggregates.
Limits and allowed dimensions enforced by API.
```

### 41.8 Observability

```text
Monitor query_log, parts, merges, mutations.
```

This is architecture-driven ClickHouse usage.

---

## 42. Minimal Local Learning Setup

A simple Docker setup can be used for learning, but do not confuse learning setup with production architecture.

Example conceptual command:

```bash
docker run --rm -it \
  -p 8123:8123 \
  -p 9000:9000 \
  --name clickhouse-server \
  clickhouse/clickhouse-server
```

Ports commonly encountered:

```text
8123 -> HTTP interface
9000 -> native protocol
```

Then HTTP query:

```bash
curl 'http://localhost:8123/?query=SELECT%201'
```

Using CLI inside container:

```bash
docker exec -it clickhouse-server clickhouse-client
```

Learning tables should start simple:

```sql
CREATE DATABASE IF NOT EXISTS learning;

CREATE TABLE learning.events
(
    event_time DateTime64(3),
    tenant_id UInt64,
    user_id UInt64,
    event_name LowCardinality(String),
    amount Decimal(18, 2)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_name);
```

Insert sample:

```sql
INSERT INTO learning.events VALUES
('2026-06-21 10:00:00.000', 1, 101, 'login', 0),
('2026-06-21 10:01:00.000', 1, 102, 'purchase', 120.50),
('2026-06-21 10:02:00.000', 2, 201, 'login', 0);
```

Query:

```sql
SELECT
    tenant_id,
    event_name,
    count() AS c,
    sum(amount) AS revenue
FROM learning.events
GROUP BY tenant_id, event_name
ORDER BY tenant_id, c DESC;
```

Inspect parts:

```sql
SELECT
    partition,
    name,
    active,
    rows,
    marks,
    bytes_on_disk
FROM system.parts
WHERE database = 'learning'
  AND table = 'events';
```

This simple exercise already connects:

```text
CREATE TABLE -> engine -> partition -> order -> insert -> part -> query -> system.parts
```

---

## 43. What to Learn Before Tuning

Do not tune settings randomly before understanding these invariants:

1. Data is stored in sorted immutable parts.
2. Part count matters.
3. Sort key determines locality and skipping.
4. Partition key determines lifecycle boundaries.
5. Query performance depends on rows/bytes/columns read and aggregation cardinality.
6. Background merges are normal and necessary.
7. Small inserts hurt.
8. Mutations are rewrites, not OLTP updates.
9. Distributed queries add network/coordinator complexity.
10. System tables are the truth source for diagnosis.

Settings are secondary. Physical design is primary.

---

## 44. Production Failure Modes Preview

### 44.1 Too Many Parts

Symptoms:

- `system.parts` count high,
- merges constantly running,
- query latency unstable,
- insert errors/warnings about too many parts.

Root causes:

- tiny inserts,
- too many partitions,
- insufficient merge capacity,
- burst ingestion.

### 44.2 Wrong ORDER BY

Symptoms:

- queries scan huge rows despite filters,
- read_rows much larger than result_rows,
- CPU/I/O high,
- no effective pruning.

Root causes:

- random UUID first,
- time-only sort in multi-tenant workload,
- filter dimensions absent from sort prefix,
- wrong cardinality ordering.

### 44.3 Over-Partitioning

Symptoms:

- huge partition count,
- many tiny parts across partitions,
- merge fragmentation,
- metadata overhead.

Root causes:

- partition by tenant,
- partition by high-cardinality dimension,
- partition by too fine time grain.

### 44.4 Mutation Storm

Symptoms:

- `system.mutations` backlog,
- disk I/O high,
- part rewrites continuous,
- query degradation.

Root causes:

- frequent UPDATE/DELETE,
- treating ClickHouse as OLTP database,
- correction model not append-friendly.

### 44.5 Distributed Query Bottleneck

Symptoms:

- shards finish partial work but coordinator slow,
- high network transfer,
- memory high on coordinator,
- group by result huge.

Root causes:

- high-cardinality distributed aggregation,
- bad sharding key,
- no pre-aggregation,
- unbounded query dimensions.

---

## 45. Java Engineer Architecture Checklist

Before connecting a Java service to ClickHouse, answer:

### Data shape

- What is the row grain?
- Is the data append-only, latest-state, or correction-heavy?
- Which fields are high-cardinality?
- Which fields are dimensions vs measures?

### Query shape

- What filters are dominant?
- What time windows are common?
- What group-by dimensions are allowed?
- What result sizes are expected?
- Are queries dashboard-like or export-like?

### Physical design

- What is `PARTITION BY` and why?
- What is `ORDER BY` and why?
- Which columns should be `LowCardinality`?
- Are nullable columns necessary?
- Is pre-aggregation needed?

### Ingestion

- What batch size?
- What retry behavior?
- How to handle duplicates?
- What freshness SLA?
- How to handle late events?

### Operations

- How to monitor part count?
- How to monitor slow queries?
- How to monitor merges/mutations?
- What retention policy?
- What backup/recovery strategy?

### API safety

- Are query dimensions bounded?
- Are time ranges bounded?
- Are columns explicit?
- Are exports isolated?
- Are tenant filters enforced?

---

## 46. Small Glossary

**Server**  
A ClickHouse process that accepts queries, stores data, and runs background tasks.

**Database**  
Logical namespace for tables.

**Table**  
A logical object with schema and engine.

**Engine**  
Defines how a table stores/accesses data or routes queries.

**MergeTree**  
Main family of engines for persistent analytical data.

**Partition**  
Data grouping defined by `PARTITION BY`, often used for lifecycle/retention/backfill.

**Part**  
Immutable physical unit of data in MergeTree.

**Granule**  
Group of rows used as sparse index/scan unit.

**Mark**  
Metadata/index pointer associated with granules and column data ranges.

**Block**  
Batch of columnar data processed in memory; also “compressed block” can refer to physical compressed data on disk depending context.

**Sparse primary index**  
Index with entries per granule, not per row.

**ORDER BY**  
Defines physical sort order for MergeTree data.

**Distributed table**  
Engine that routes queries/inserts to tables across cluster.

**Shard**  
Horizontal data partition across servers.

**Replica**  
Copy of shard data for redundancy/failover/read scaling.

**Merge**  
Background process combining parts.

**Mutation**  
Background rewrite caused by update/delete-like operation.

---

## 47. Exercises

### Exercise 1 — Explain the Architecture

Without looking back, explain this path:

```text
INSERT batch -> block -> sorted data -> part -> background merge -> query reads part
```

Use your own words.

### Exercise 2 — Identify the Unit

For each concept, classify it:

```text
partition
part
granule
mark
block
compressed block
Distributed table
ReplicatedMergeTree table
```

As one of:

```text
logical namespace
lifecycle boundary
physical storage unit
index/skip unit
execution unit
routing layer
replication-enabled storage engine
```

### Exercise 3 — Diagnose a Bad Design

Given:

```sql
CREATE TABLE events
(
    event_id UUID,
    tenant_id UInt64,
    event_time DateTime64(3),
    event_name String
)
ENGINE = MergeTree
PARTITION BY tenant_id
ORDER BY event_id;
```

Workload:

```sql
WHERE tenant_id = ? AND event_time BETWEEN ? AND ?
GROUP BY event_name
```

Identify problems and propose a better design.

Expected reasoning:

- partition by tenant may create too many partitions,
- order by random UUID kills time/tenant locality,
- event_name may benefit from LowCardinality,
- likely better partition by month/day time and order by tenant/time/event_name.

### Exercise 4 — Read System Tables

After creating a learning table and inserting data, run:

```sql
SELECT partition, name, rows, marks, bytes_on_disk
FROM system.parts
WHERE active
  AND database = 'learning'
  AND table = 'events';
```

Explain what each row represents.

### Exercise 5 — Query Path Trace

For this query:

```sql
SELECT event_name, count()
FROM events
WHERE tenant_id = 10
  AND event_time >= now() - INTERVAL 1 DAY
GROUP BY event_name;
```

List:

- likely columns read,
- possible index use,
- aggregation state key,
- where memory might be used,
- why `ORDER BY (tenant_id, event_time)` helps.

---

## 48. Summary

ClickHouse architecture is best understood as a pipeline over sorted immutable columnar parts.

The most important mental models from this part:

1. ClickHouse is not a row-store OLTP database.
2. Table engine determines table behavior.
3. MergeTree stores data as sorted immutable parts.
4. Parts are created by inserts and optimized by background merges.
5. Partition is lifecycle boundary; part is physical storage unit.
6. Granules and marks support sparse primary index skipping.
7. Blocks are central to vectorized execution.
8. `ORDER BY` is physical design, not cosmetic syntax.
9. Distributed tables route queries; local tables store data.
10. Shards split data; replicas copy data.
11. System tables are essential for diagnosis.
12. Most production issues trace back to physical design, ingestion shape, query shape, or background work.

A compact final model:

```text
ClickHouse receives SQL
  -> builds query pipeline
  -> reads only needed columns
  -> skips irrelevant granules using sparse indexes when possible
  -> processes compressed columnar data in blocks
  -> aggregates/sorts/merges in parallel
  -> relies on background merges to keep immutable parts efficient
```

This is the foundation for the next part.

---

## 49. What Comes Next

Next part:

```text
learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-004.md
```

Title:

```text
MergeTree Internals I: Parts, Granules, Marks, Primary Index, and Sorting Key
```

Part 004 will go deeper into the most important ClickHouse storage engine concept:

- MergeTree parts,
- granules,
- marks,
- sparse primary index,
- `ORDER BY`,
- `PRIMARY KEY`,
- why key design dominates performance.

---

## 50. Series Status

```text
Part 000 completed
Part 001 completed
Part 002 completed
Part 003 completed  <-- current
Part 004 next
...
Part 034 final capstone
```

Seri belum selesai. Ini adalah **Part 003 dari 034**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-002.md">⬅️ Part 002 — Columnar Storage Mental Model: From Rows to Columns to Compressed Blocks</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-004.md">Part 004 — MergeTree Internals I: Parts, Granules, Marks, Primary Index, and Sorting Key ➡️</a>
</div>

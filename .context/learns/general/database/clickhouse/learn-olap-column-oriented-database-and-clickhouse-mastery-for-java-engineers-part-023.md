# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-023.md

# Part 023 — Performance Engineering I: Reading EXPLAIN, Query Logs, and System Tables

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **023 / 034**  
> Fokus: membangun workflow diagnosis performa ClickHouse berbasis bukti: `EXPLAIN`, query logs, thread logs, parts, merges, mutations, replicas, system tables, dan investigation playbook.

---

## 0. Posisi Part Ini Dalam Seri

Sampai sini kita sudah membangun fondasi:

- OLAP workload anatomy.
- Columnar storage mental model.
- MergeTree internals.
- Sorting key dan partitioning.
- Compression dan data type.
- Ingestion architecture.
- Query execution model.
- Aggregation.
- Materialized views.
- Projections dan skipping indexes.
- Joins.
- Table engines.
- Updates/deletes/deduplication.
- Distributed ClickHouse.
- Cloud-native ClickHouse.

Sekarang kita masuk ke performance engineering.

Banyak engineer ketika query ClickHouse lambat langsung bertanya:

```text
Index apa yang harus saya tambahkan?
Setting apa yang harus saya ubah?
Harus tambah node berapa?
```

Pertanyaan itu sering prematur.

Performance engineering yang benar dimulai dari observasi:

```text
Query membaca berapa rows?
Membaca berapa bytes?
Kolom apa saja yang dibaca?
Partition/part/granule mana yang disentuh?
Apakah primary key pruning bekerja?
Apakah skipping index/projection dipakai?
Apakah bottleneck CPU, disk, memory, network, atau coordinator?
Apakah lambat karena scan, aggregation, join, sort, merge backlog, replica lag, atau result serialization?
```

Part ini adalah fondasi diagnosis.

Part 024 akan fokus ke query optimization patterns.  
Part 025 akan fokus ke CPU, memory, disk, network, dan concurrency.

---

## 1. Tujuan Part Ini

Setelah part ini, kamu diharapkan mampu:

1. membaca `EXPLAIN` untuk memahami query plan dan pipeline;
2. menggunakan `EXPLAIN indexes = 1` untuk melihat partition/primary key/skipping index pruning;
3. menggunakan `system.query_log` untuk menganalisis query lambat;
4. menggunakan `system.query_thread_log` untuk memahami kerja per thread/node;
5. membaca `read_rows`, `read_bytes`, `result_rows`, `memory_usage`, dan duration secara benar;
6. memakai `system.parts` untuk melihat part count, bytes, rows, partition health;
7. memakai `system.parts_columns`/`system.columns` untuk memahami ukuran kolom dan compression;
8. memakai `system.merges` dan `system.mutations` untuk melihat background pressure;
9. memakai `system.replicas`, `system.replication_queue`, dan `system.distribution_queue` untuk distributed health;
10. membangun investigation workflow untuk query lambat;
11. membedakan root cause schema/design/query/operations/resources;
12. membuat template performance report yang bisa dipakai tim engineering.

---

## 2. Mental Model Utama: Jangan Tune Sebelum Tahu Yang Mahal

ClickHouse cepat karena bisa:

- membaca hanya kolom yang diperlukan;
- melewati partition/part/granule yang tidak relevan;
- melakukan vectorized execution;
- parallel scan;
- aggregate partials;
- compress/decompress efisien;
- memanfaatkan sort order;
- memanfaatkan pre-aggregation/projection/skipping index.

Query lambat biasanya karena satu atau lebih dari ini gagal:

```text
terlalu banyak data dibaca
terlalu banyak kolom dibaca
filter tidak align dengan sorting key
partition terlalu granular atau tidak membantu
part terlalu banyak
aggregation cardinality terlalu besar
join terlalu besar
sort terlalu mahal
result terlalu besar
distributed fan-in terlalu besar
memory spill/OOM
background merges/mutations mengganggu
replica/distribution queue bermasalah
```

Tuning yang benar:

```text
measure → classify bottleneck → fix model/query/resource → validate
```

Bukan:

```text
tambahkan index random → ubah setting random → tambah node
```

---

## 3. Performance Investigation Layers

Gunakan layering berikut.

### Layer 1: Query Shape

Pertanyaan:

- Query melakukan scan, aggregation, join, sort, distinct, export, atau lookup?
- Apakah query interactive atau batch?
- Apakah query sering atau ad-hoc?
- Apakah result kecil atau besar?
- Apakah time range bounded?

### Layer 2: Data Access

Pertanyaan:

- Berapa rows/bytes dibaca?
- Kolom apa dibaca?
- Apakah partition pruning terjadi?
- Apakah primary key pruning terjadi?
- Apakah skipping index/projection dipakai?
- Apakah query memakai `SELECT *`?

### Layer 3: Execution Work

Pertanyaan:

- CPU banyak dipakai di expression/filter?
- Aggregation cardinality tinggi?
- Join membangun hash table besar?
- Sort external?
- Memory pressure?
- Parallelism cukup?

### Layer 4: Storage Health

Pertanyaan:

- Part count terlalu tinggi?
- Merges backlog?
- Mutations berjalan?
- Disk penuh/lambat?
- Object storage/cache miss?

### Layer 5: Distributed Health

Pertanyaan:

- Shard skew?
- Replica lag?
- Distributed queue backlog?
- Coordinator bottleneck?
- Network transfer besar?
- High-cardinality fan-in?

### Layer 6: Product/API Contract

Pertanyaan:

- Query ini seharusnya synchronous?
- Apakah endpoint terlalu bebas?
- Apakah perlu rollup?
- Apakah perlu async export?
- Apakah SLA realistis?

---

## 4. Essential Metrics: Cara Membaca Angka

### 4.1 `read_rows`

Jumlah rows yang dibaca dari storage/execution.

Jika query return 100 rows tetapi `read_rows = 5,000,000,000`, query mahal meskipun result kecil.

### 4.2 `read_bytes`

Jumlah bytes yang dibaca.

Lebih penting dari rows dalam columnar storage karena:

```text
1 miliar rows × 2 kolom kecil
```

bisa lebih murah daripada:

```text
100 juta rows × 80 kolom besar
```

### 4.3 `result_rows`

Jumlah rows output.

Jika `result_rows` besar, bottleneck bisa di:

- network;
- serialization;
- client memory;
- Java service;
- frontend;
- export layer.

### 4.4 `memory_usage`

Peak memory usage query.

High memory biasanya karena:

- aggregation hash table;
- join hash table;
- sort;
- distinct;
- final merge on coordinator;
- `FINAL`;
- large result buffering.

### 4.5 `query_duration_ms`

Total duration. Jangan baca sendirian. Kombinasikan dengan:

- read rows/bytes;
- memory;
- ProfileEvents;
- thread log;
- distributed fragments;
- background load.

### 4.6 `written_rows` / `written_bytes`

Untuk insert/backfill/MV/mutation workloads.

### 4.7 Ratio Penting

#### Rows read per result row

```text
read_rows / result_rows
```

Jika sangat tinggi, query sangat selective secara output tetapi tidak secara scan.

#### Bytes per row

```text
read_bytes / read_rows
```

Indikasi kolom besar ikut terbaca.

#### Duration per GB

```text
query_duration / read_bytes
```

Bisa membantu membandingkan query.

#### Memory per group

Estimasi:

```text
memory_usage / estimated_group_count
```

Membantu memahami aggregation pressure.

---

## 5. `EXPLAIN`: Peta Sebelum Eksekusi

ClickHouse menyediakan beberapa bentuk `EXPLAIN`.

### 5.1 `EXPLAIN SYNTAX`

Melihat query setelah rewrite/syntax-level transformation.

```sql
EXPLAIN SYNTAX
SELECT
    count()
FROM events
WHERE event_time >= today() - 7;
```

Gunakan untuk:

- melihat query normalization;
- memastikan expression tidak berubah aneh;
- debugging SQL generation dari Java query builder.

### 5.2 `EXPLAIN AST`

Melihat abstract syntax tree.

Lebih internal. Berguna untuk advanced debugging.

```sql
EXPLAIN AST
SELECT count()
FROM events
WHERE event_time >= today() - 7;
```

### 5.3 `EXPLAIN PLAN`

Melihat logical/query plan.

```sql
EXPLAIN PLAN
SELECT
    event_name,
    count()
FROM events
WHERE tenant_id = 10
  AND event_time >= now() - INTERVAL 7 DAY
GROUP BY event_name;
```

Cari:

- read from table;
- filter;
- aggregation;
- sorting;
- join;
- projection usage;
- expression steps.

### 5.4 `EXPLAIN PIPELINE`

Melihat execution pipeline dan parallelism.

```sql
EXPLAIN PIPELINE
SELECT
    event_name,
    count()
FROM events
WHERE tenant_id = 10
  AND event_time >= now() - INTERVAL 7 DAY
GROUP BY event_name;
```

Cari:

- number of streams;
- read processors;
- transform processors;
- aggregation stages;
- merge stages;
- remote source stages;
- final output stage.

### 5.5 `EXPLAIN indexes = 1`

Sangat penting untuk MergeTree pruning.

```sql
EXPLAIN indexes = 1
SELECT
    event_name,
    count()
FROM events
WHERE tenant_id = 10
  AND event_time >= toDateTime('2026-06-01')
  AND event_time < toDateTime('2026-07-01')
GROUP BY event_name;
```

Cari:

- partition pruning;
- primary key pruning;
- skipping indexes;
- parts selected;
- granules selected.

---

## 6. Reading `EXPLAIN indexes = 1`

### 6.1 Good Signal

Good query:

```text
Parts: 12/240
Granules: 800/50000
```

Artinya banyak data berhasil dilewati.

### 6.2 Bad Signal

Bad query:

```text
Parts: 240/240
Granules: 50000/50000
```

Artinya query membaca semua data relevan table/partition.

Mungkin tetap acceptable untuk batch scan, tapi tidak untuk interactive API jika data besar.

### 6.3 Partition Pruning

Jika query punya:

```sql
WHERE event_time >= '2026-06-01'
  AND event_time < '2026-07-01'
```

dan table:

```sql
PARTITION BY toYYYYMM(event_time)
```

maka June partition bisa dipilih.

Jika query memakai function yang tidak mudah dipahami:

```sql
WHERE formatDateTime(event_time, '%Y-%m') = '2026-06'
```

pruning bisa lebih buruk.

### 6.4 Primary Key Pruning

Jika local table:

```sql
ORDER BY (tenant_id, event_type, event_time, case_id)
```

Query:

```sql
WHERE tenant_id = 10
  AND event_type = 'CASE_OPENED'
  AND event_time >= ...
```

Good alignment.

Query:

```sql
WHERE case_id = '...'
```

tanpa tenant/event_type/time mungkin kurang memanfaatkan prefix sort key.

### 6.5 Skipping Index

If skip index exists:

```sql
INDEX idx_trace_id trace_id TYPE bloom_filter GRANULARITY 4
```

`EXPLAIN indexes = 1` can show whether it is used.

If not used, reasons may include:

- predicate not compatible;
- index not materialized;
- data not correlated;
- query expression mismatch;
- index too coarse;
- index not useful enough.

---

## 7. `system.query_log`

### 7.1 What It Contains

`system.query_log` records query events, usually including:

- query text;
- start time;
- duration;
- read rows/bytes;
- written rows/bytes;
- result rows/bytes;
- memory usage;
- exception;
- ProfileEvents;
- settings;
- user;
- query_id;
- initial_query_id;
- distributed query info.

Exact fields may vary by version/config.

### 7.2 Basic Slow Query Query

```sql
SELECT
    event_time,
    query_id,
    user,
    query_duration_ms,
    read_rows,
    formatReadableSize(read_bytes) AS read_bytes,
    result_rows,
    formatReadableSize(result_bytes) AS result_bytes,
    formatReadableSize(memory_usage) AS memory,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
ORDER BY query_duration_ms DESC
LIMIT 20;
```

### 7.3 Recent Failed Queries

```sql
SELECT
    event_time,
    query_id,
    user,
    exception_code,
    exception,
    query
FROM system.query_log
WHERE type = 'ExceptionBeforeStart'
   OR type = 'ExceptionWhileProcessing'
ORDER BY event_time DESC
LIMIT 50;
```

### 7.4 Heavy Scans

```sql
SELECT
    event_time,
    query_id,
    query_duration_ms,
    read_rows,
    formatReadableSize(read_bytes) AS read_bytes,
    formatReadableSize(memory_usage) AS memory,
    result_rows,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
ORDER BY read_bytes DESC
LIMIT 20;
```

### 7.5 High Memory Queries

```sql
SELECT
    event_time,
    query_id,
    query_duration_ms,
    formatReadableSize(memory_usage) AS memory,
    read_rows,
    result_rows,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
ORDER BY memory_usage DESC
LIMIT 20;
```

### 7.6 Queries with Huge Result

```sql
SELECT
    event_time,
    query_id,
    query_duration_ms,
    result_rows,
    formatReadableSize(result_bytes) AS result_bytes,
    read_rows,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
ORDER BY result_bytes DESC
LIMIT 20;
```

This often reveals exports or accidental `SELECT *`.

---

## 8. `ProfileEvents`

`ProfileEvents` in query log contains counters about what happened.

Examples of useful areas:

- selected parts/marks;
- read bytes from filesystem;
- read rows;
- CPU time;
- memory allocations;
- external aggregation/sort;
- network send/receive;
- cache hits/misses;
- inserted rows;
- merged rows;
- file/object storage reads;
- distributed connection behavior.

Exact event names vary by version.

### 8.1 Explore Profile Events

```sql
SELECT *
FROM system.events
WHERE event ILIKE '%Read%'
ORDER BY event;
```

```sql
SELECT *
FROM system.events
WHERE event ILIKE '%Merge%'
ORDER BY event;
```

```sql
SELECT *
FROM system.events
WHERE event ILIKE '%Cache%'
ORDER BY event;
```

### 8.2 Reading ProfileEvents from Query Log

Depending representation:

```sql
SELECT
    query_id,
    ProfileEvents['SelectedRows'] AS selected_rows,
    ProfileEvents['SelectedBytes'] AS selected_bytes
FROM system.query_log
WHERE type = 'QueryFinish'
ORDER BY event_time DESC
LIMIT 10;
```

If map access differs by version, inspect field type first:

```sql
DESCRIBE TABLE system.query_log;
```

### 8.3 Why ProfileEvents Matter

`read_rows` and `read_bytes` are high-level.

ProfileEvents can reveal:

- query read from cache or disk;
- external sort occurred;
- aggregation spilled;
- remote reads happened;
- selected marks too high;
- OS read vs filesystem cache;
- network bottleneck.

---

## 9. `system.query_thread_log`

### 9.1 Why Thread Log Matters

`system.query_log` shows total query.  
`system.query_thread_log` shows work per thread.

Useful for:

- parallelism analysis;
- skew;
- distributed fragments;
- CPU imbalance;
- slow shard/thread;
- memory per thread.

### 9.2 Example

```sql
SELECT
    query_id,
    thread_id,
    query_duration_ms,
    read_rows,
    formatReadableSize(read_bytes) AS read_bytes,
    formatReadableSize(memory_usage) AS memory
FROM system.query_thread_log
WHERE query_id = 'your-query-id'
ORDER BY read_rows DESC;
```

### 9.3 Distributed Query

Use `initial_query_id` across cluster:

```sql
SELECT
    hostName() AS host,
    query_id,
    thread_id,
    read_rows,
    formatReadableSize(read_bytes) AS read_bytes,
    query_duration_ms
FROM clusterAllReplicas('my_cluster', system, query_thread_log)
WHERE initial_query_id = 'your-initial-query-id'
ORDER BY read_rows DESC;
```

### 9.4 Detecting Skew

If one host/thread reads much more:

```text
host A read 900 GB
host B read 80 GB
host C read 70 GB
```

You likely have:

- shard skew;
- bad sharding key;
- data imbalance;
- query predicate targets one shard;
- hot tenant;
- unbalanced partitions.

---

## 10. `system.processes`: Live Queries

### 10.1 Current Running Queries

```sql
SELECT
    query_id,
    user,
    elapsed,
    read_rows,
    formatReadableSize(read_bytes) AS read_bytes,
    total_rows_approx,
    formatReadableSize(memory_usage) AS memory,
    query
FROM system.processes
ORDER BY elapsed DESC;
```

Use when cluster currently slow.

### 10.2 Kill Query

If necessary:

```sql
KILL QUERY WHERE query_id = '...';
```

Use carefully. Killing important mutation/backfill/report query can create partial operational workflows.

### 10.3 Live Diagnosis

If a query is running for long time:

- read_rows increasing fast → scanning;
- memory increasing → aggregation/join/sort;
- read_rows stuck → waiting/I/O/network/lock;
- many similar queries → API storm;
- one user causing load → quota/limit issue.

---

## 11. `system.parts`: Table Physical Health

### 11.1 Why It Matters

Most ClickHouse performance problems eventually show up in parts.

Too many parts cause:

- query overhead;
- merge backlog;
- insert failures;
- replication queue pressure;
- metadata overhead.

### 11.2 Parts by Partition

```sql
SELECT
    partition,
    count() AS parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS bytes,
    min(min_time) AS min_time,
    max(max_time) AS max_time
FROM system.parts
WHERE database = 'analytics'
  AND table = 'events_local'
  AND active
GROUP BY partition
ORDER BY partition;
```

Some columns like `min_time/max_time` depend on table/partition metadata availability; adapt to your version/schema.

### 11.3 Total Parts

```sql
SELECT
    count() AS active_parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS bytes
FROM system.parts
WHERE database = 'analytics'
  AND table = 'events_local'
  AND active;
```

### 11.4 Small Parts Detection

```sql
SELECT
    partition,
    count() AS parts,
    sum(rows) AS rows,
    round(avg(rows), 2) AS avg_rows_per_part,
    formatReadableSize(avg(bytes_on_disk)) AS avg_part_size
FROM system.parts
WHERE database = 'analytics'
  AND table = 'events_local'
  AND active
GROUP BY partition
ORDER BY parts DESC
LIMIT 20;
```

Bad smell:

```text
many partitions with thousands of tiny parts
```

### 11.5 Part Age

```sql
SELECT
    partition,
    min(modification_time) AS oldest_part,
    max(modification_time) AS newest_part,
    count() AS parts
FROM system.parts
WHERE database = 'analytics'
  AND table = 'events_local'
  AND active
GROUP BY partition
ORDER BY newest_part DESC;
```

If old partitions still have many small parts, merges may not be happening or partitions are overfragmented.

---

## 12. `system.parts_columns` and `system.columns`: Column Size and Compression

### 12.1 Column Size

```sql
SELECT
    column,
    formatReadableSize(sum(column_data_compressed_bytes)) AS compressed,
    formatReadableSize(sum(column_data_uncompressed_bytes)) AS uncompressed,
    round(sum(column_data_uncompressed_bytes) / nullIf(sum(column_data_compressed_bytes), 0), 2) AS compression_ratio
FROM system.parts_columns
WHERE database = 'analytics'
  AND table = 'events_local'
  AND active
GROUP BY column
ORDER BY sum(column_data_compressed_bytes) DESC;
```

This reveals expensive columns.

### 12.2 Why It Matters

If query reads a large `payload`/`message` column unnecessarily, `read_bytes` can explode.

Example:

```sql
SELECT *
FROM logs
WHERE service = 'payment-api'
LIMIT 100;
```

Maybe reads `message`, `stack_trace`, `labels`, `attributes`.

Better:

```sql
SELECT
    timestamp,
    level,
    route,
    status_code
FROM logs
WHERE service = 'payment-api'
LIMIT 100;
```

### 12.3 Compression Ratio

Low compression ratio may indicate:

- high-cardinality random strings;
- UUID as String;
- poor sorting correlation;
- JSON payload;
- nullable overhead;
- compression codec mismatch.

### 12.4 Schema Optimization

Use findings to decide:

- promote hot JSON fields;
- avoid reading payload;
- use `LowCardinality`;
- choose better data type;
- change sorting key for correlation;
- split wide/cold columns into separate table;
- use materialized columns.

---

## 13. `system.merges`

### 13.1 Current Background Merges

```sql
SELECT
    database,
    table,
    partition_id,
    elapsed,
    progress,
    num_parts,
    total_size_bytes_compressed,
    formatReadableSize(total_size_bytes_compressed) AS total_size,
    result_part_name
FROM system.merges
ORDER BY elapsed DESC;
```

### 13.2 Why It Matters

If merges cannot keep up:

- parts accumulate;
- queries slow;
- inserts may hit too many parts;
- replication queue grows;
- disk usage grows.

### 13.3 Merge Pressure Causes

- small inserts;
- over-partitioning;
- materialized view write amplification;
- backfills;
- TTL moves/deletes;
- mutations;
- insufficient CPU/disk;
- object storage latency.

### 13.4 What Not To Do

Do not blindly run:

```sql
OPTIMIZE TABLE events FINAL;
```

on huge tables.

It can be extremely expensive and worsen load.

---

## 14. `system.mutations`

### 14.1 Mutation Status

```sql
SELECT
    database,
    table,
    mutation_id,
    command,
    create_time,
    is_done,
    parts_to_do,
    latest_failed_part,
    latest_fail_reason
FROM system.mutations
WHERE database = 'analytics'
ORDER BY create_time DESC;
```

### 14.2 Why It Matters

Running mutations can compete with queries and merges.

If query suddenly slow, check if someone started:

```sql
ALTER TABLE large_table UPDATE ...
ALTER TABLE large_table DELETE ...
```

### 14.3 Stuck Mutation

Signs:

- `parts_to_do` not decreasing;
- `latest_fail_reason` non-empty;
- long-running mutation;
- replicas differ;
- disk/memory pressure.

### 14.4 Mutation Impact on Performance

Mutation can:

- rewrite parts;
- increase disk I/O;
- create temporary disk usage;
- delay merges;
- cause query to read mixed part versions;
- affect replicas differently.

---

## 15. Distributed Health Tables

### 15.1 `system.replicas`

```sql
SELECT
    database,
    table,
    is_readonly,
    is_session_expired,
    queue_size,
    inserts_in_queue,
    merges_in_queue,
    part_mutations_in_queue,
    absolute_delay,
    active_replicas,
    total_replicas
FROM system.replicas
WHERE database = 'analytics';
```

### 15.2 `system.replication_queue`

```sql
SELECT
    database,
    table,
    replica_name,
    type,
    create_time,
    now() - create_time AS age,
    num_tries,
    last_exception
FROM system.replication_queue
WHERE database = 'analytics'
ORDER BY age DESC
LIMIT 50;
```

### 15.3 `system.distribution_queue`

If using Distributed inserts:

```sql
SELECT
    database,
    table,
    count() AS pending_files,
    min(create_time) AS oldest
FROM system.distribution_queue
GROUP BY database, table
ORDER BY pending_files DESC;
```

### 15.4 Why It Matters

A query may be slow or stale because:

- replica lag;
- distributed insert backlog;
- replication fetch failures;
- shard unhealthy;
- coordinator waiting on slow shard.

Performance investigation must include cluster health.

---

## 16. Query Investigation Workflow

Use this every time a query is slow.

### Step 1: Capture Query ID and Context

Record:

```text
query_id
user
endpoint/job
time
expected SLA
input parameters
table(s)
cluster/node
```

In Java service, set query_id explicitly.

### Step 2: Get Query Log

```sql
SELECT
    event_time,
    query_id,
    query_duration_ms,
    read_rows,
    formatReadableSize(read_bytes) AS read_bytes,
    result_rows,
    formatReadableSize(result_bytes) AS result_bytes,
    formatReadableSize(memory_usage) AS memory,
    exception,
    query
FROM system.query_log
WHERE query_id = '...';
```

### Step 3: Classify Bottleneck

Based on data:

| Symptom | Possible Bottleneck |
|---|---|
| huge read_rows/read_bytes | scan/pruning issue |
| huge memory | aggregation/join/sort/FINAL |
| huge result_rows | export/API misuse |
| low read but long duration | network/wait/lock/coordination |
| one shard slow | skew/replica/disk issue |
| high failed queries | resource limits/schema/error |
| query got slower recently | parts/merges/mutations/data growth |

### Step 4: Run EXPLAIN

```sql
EXPLAIN indexes = 1
...
```

```sql
EXPLAIN PIPELINE
...
```

### Step 5: Check Table Health

```sql
SELECT partition, count(), sum(rows), formatReadableSize(sum(bytes_on_disk))
FROM system.parts
WHERE database = 'analytics'
  AND table = 'events_local'
  AND active
GROUP BY partition
ORDER BY count() DESC;
```

### Step 6: Check Background Work

```sql
SELECT * FROM system.merges;
SELECT * FROM system.mutations WHERE is_done = 0;
```

### Step 7: Check Distributed Health

```sql
SELECT * FROM system.replicas WHERE database = 'analytics';
SELECT * FROM system.replication_queue WHERE database = 'analytics';
SELECT * FROM system.distribution_queue;
```

### Step 8: Check Column Sizes

```sql
SELECT
    column,
    formatReadableSize(sum(column_data_compressed_bytes)) AS compressed
FROM system.parts_columns
WHERE database = 'analytics'
  AND table = 'events_local'
  AND active
GROUP BY column
ORDER BY sum(column_data_compressed_bytes) DESC;
```

### Step 9: Produce Hypothesis

Examples:

```text
Query scans all partitions because filter wraps event_time in formatDateTime.
```

```text
Query uses GROUP BY user_id over 180 days causing coordinator memory pressure.
```

```text
ORDER BY starts with tenant_id,event_type,event_time, but query filters only case_id.
```

```text
Distributed query fans out and one shard has 70% of data due to tenant skew.
```

### Step 10: Test Fix

Do not apply broad fix blindly.

Test:

- rewritten query;
- reduced time range;
- different filter expression;
- pre-aggregation;
- projection/skipping index;
- schema change;
- rollup table;
- API guardrail;
- resource setting.

### Step 11: Validate

Compare before/after:

- duration;
- read_rows;
- read_bytes;
- memory;
- result correctness;
- concurrency behavior.

---

## 17. Common Diagnosis Patterns

### Pattern 1: Query Reads Too Much

Symptoms:

- high read_rows/read_bytes;
- low result rows;
- EXPLAIN shows no pruning.

Likely causes:

- bad sorting key;
- missing time filter;
- function wrapping key column;
- query filters column not in sort key;
- partition key not aligned;
- `SELECT *`;
- skip index ineffective.

Fix:

- rewrite predicate;
- add required filter;
- redesign sorting key/table;
- projection;
- materialized view/rollup;
- data skipping index if correlated;
- split cold columns.

### Pattern 2: Aggregation Memory High

Symptoms:

- memory_usage high;
- GROUP BY high cardinality;
- coordinator OOM.

Likely causes:

- grouping by user/session/trace over large range;
- distinct exact;
- too many dimensions;
- distributed fan-in.

Fix:

- reduce dimensions;
- pre-aggregate;
- use approximate aggregate;
- use rollup;
- async export;
- limits;
- external aggregation settings if appropriate.

### Pattern 3: Join Memory High

Symptoms:

- memory high;
- query includes join;
- right side large;
- duplicate keys.

Fix:

- reduce right side;
- filter right side;
- dictionary;
- denormalize;
- pre-join MV;
- colocate shards;
- use appropriate join strictness.

### Pattern 4: Sort Slow

Symptoms:

- ORDER BY large result;
- memory high;
- external sort;
- no useful sort key.

Fix:

- sort smaller aggregated result;
- limit after proper top-N strategy;
- align sorting key/projection;
- use rollup/top-N table;
- avoid sorting raw billions.

### Pattern 5: Result Too Large

Symptoms:

- result_rows/result_bytes huge;
- Java service slow;
- frontend timeout.

Fix:

- pagination carefully;
- async export;
- limit;
- aggregate server-side;
- object storage export;
- do not return raw events synchronously.

### Pattern 6: Operational Background Pressure

Symptoms:

- queries generally slower;
- merges/mutations active;
- part count high.

Fix:

- fix ingestion batching;
- reduce partitions;
- stop mutation storm;
- schedule backfill;
- add resources;
- compact/rebuild carefully.

### Pattern 7: Distributed Skew

Symptoms:

- one shard much slower;
- query_thread_log imbalance;
- shard row counts uneven.

Fix:

- reshard/hybrid tenant isolation;
- separate hot tenant;
- pre-aggregate;
- query routing;
- workload isolation.

---

## 18. Reading Query Performance in Java API Context

A Java analytics API should not treat ClickHouse as black box.

### 18.1 Add Query Metadata

Attach:

- endpoint name;
- request id;
- tenant id;
- user id;
- query family;
- dashboard/report/export tag;
- generated SQL hash;
- query_id.

Example query id:

```text
analytics-api/backlog-dashboard/tenant-10/request-abc123
```

### 18.2 Log Query Stats

After executing query, log:

- duration;
- rows returned;
- bytes returned if available;
- query_id;
- exception;
- timeout;
- ClickHouse server;
- query family.

### 18.3 Build Query Family Metrics

Group by query family:

```text
case_backlog_summary
case_lifecycle_trend
api_latency_percentiles
raw_event_export
```

Track:

- p50/p95/p99 latency;
- error rate;
- read rows/bytes from query_log;
- memory;
- frequency;
- tenant skew.

### 18.4 Guardrails

Use diagnosis to enforce:

- max date range;
- max group-by dimensions;
- max result rows;
- async export threshold;
- safe fields only;
- required tenant/time filter;
- query timeout;
- memory limit.

---

## 19. Performance Report Template

When reporting a slow query, include:

```text
Title:
  Slow query: case_lifecycle_trend endpoint

Context:
  endpoint/job:
  tenant:
  time range:
  query_id:
  timestamp:
  expected SLA:
  actual duration:

Query:
  SQL text or normalized template

Observed metrics:
  duration:
  read_rows:
  read_bytes:
  result_rows:
  result_bytes:
  memory_usage:
  selected parts/granules:
  distributed hosts involved:
  slowest shard:

EXPLAIN summary:
  partition pruning:
  primary key pruning:
  projection/skipping index:
  pipeline stages:

Table health:
  active parts:
  parts per partition:
  bytes:
  merges:
  mutations:
  replica lag:

Hypothesis:
  e.g. query filters case_id but sorting key starts tenant_id,event_type,event_time.

Fix options:
  short-term:
  medium-term:
  long-term:

Validation:
  before/after metrics:
  correctness checks:
  concurrency test:
```

This makes performance work reviewable and repeatable.

---

## 20. Example Investigation: Bad Time Predicate

### 20.1 Query

```sql
SELECT
    event_type,
    count()
FROM case_events
WHERE formatDateTime(event_time, '%Y-%m') = '2026-06'
GROUP BY event_type;
```

### 20.2 Symptom

- reads many partitions;
- slow.

### 20.3 Problem

Function wrapping `event_time` may prevent efficient partition pruning.

### 20.4 Better Query

```sql
SELECT
    event_type,
    count()
FROM case_events
WHERE event_time >= toDateTime('2026-06-01 00:00:00')
  AND event_time < toDateTime('2026-07-01 00:00:00')
GROUP BY event_type;
```

### 20.5 Validation

Run:

```sql
EXPLAIN indexes = 1
...
```

Compare selected parts/granules and query log read_bytes.

---

## 21. Example Investigation: `SELECT *` on Logs

### 21.1 Query

```sql
SELECT *
FROM logs
WHERE service = 'payment-api'
  AND timestamp >= now() - INTERVAL 1 HOUR
LIMIT 1000;
```

### 21.2 Symptom

- read_bytes high;
- Java response large;
- latency unstable.

### 21.3 Problem

`SELECT *` reads large columns:

- message;
- stack_trace;
- attributes;
- labels;
- raw_json.

### 21.4 Diagnose Column Size

```sql
SELECT
    column,
    formatReadableSize(sum(column_data_compressed_bytes)) AS compressed
FROM system.parts_columns
WHERE table = 'logs'
  AND active
GROUP BY column
ORDER BY sum(column_data_compressed_bytes) DESC;
```

### 21.5 Fix

```sql
SELECT
    timestamp,
    level,
    route,
    status_code,
    latency_ms
FROM logs
WHERE service = 'payment-api'
  AND timestamp >= now() - INTERVAL 1 HOUR
LIMIT 1000;
```

For raw message drilldown, use separate endpoint.

---

## 22. Example Investigation: High Cardinality GROUP BY

### 22.1 Query

```sql
SELECT
    user_id,
    count()
FROM product_events
WHERE tenant_id = 10
  AND event_time >= now() - INTERVAL 180 DAY
GROUP BY user_id
ORDER BY count() DESC
LIMIT 100;
```

### 22.2 Symptom

- memory high;
- distributed coordinator OOM;
- long duration.

### 22.3 Problem

Grouping by all users over 180 days creates huge aggregation state.

### 22.4 Fix Options

- restrict time;
- pre-aggregate daily user activity;
- use topK approximate if acceptable;
- build top users rollup;
- async export;
- route to offline compute group;
- add tenant-specific limits.

### 22.5 Better Serving Table

```sql
CREATE TABLE daily_user_activity
(
    tenant_id UInt64,
    day Date,
    user_id UInt64,
    event_count UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, user_id);
```

Query:

```sql
SELECT
    user_id,
    sum(event_count) AS events
FROM daily_user_activity
WHERE tenant_id = 10
  AND day >= today() - 180
GROUP BY user_id
ORDER BY events DESC
LIMIT 100;
```

Still high-cardinality, but far less raw scan.

---

## 23. Example Investigation: Too Many Parts

### 23.1 Symptom

- inserts slow;
- queries slow;
- errors about too many parts;
- merges constantly running.

### 23.2 Diagnose

```sql
SELECT
    partition,
    count() AS parts,
    sum(rows) AS rows,
    round(avg(rows), 2) AS avg_rows_per_part,
    formatReadableSize(avg(bytes_on_disk)) AS avg_size
FROM system.parts
WHERE database = 'analytics'
  AND table = 'events_local'
  AND active
GROUP BY partition
ORDER BY parts DESC
LIMIT 20;
```

### 23.3 Root Causes

- small inserts;
- too many partitions;
- distributed inserts split small batches;
- materialized view target parts;
- backfill tiny chunks.

### 23.4 Fix

- increase batch size;
- async insert;
- reduce partition granularity;
- batch by partition/shard;
- avoid too many MV targets;
- rebuild/compact carefully;
- tune ingestion service.

---

## 24. Example Investigation: Replica Lag Causes Stale Dashboard

### 24.1 Symptom

Dashboard sometimes misses latest rows depending which node receives query.

### 24.2 Diagnose

```sql
SELECT
    hostName(),
    max(ingest_time),
    count()
FROM clusterAllReplicas('my_cluster', analytics, events_local)
GROUP BY hostName()
ORDER BY max(ingest_time);
```

Check replicas:

```sql
SELECT
    hostName(),
    absolute_delay,
    queue_size,
    inserts_in_queue
FROM clusterAllReplicas('my_cluster', system, replicas)
WHERE database = 'analytics'
  AND table = 'events_local';
```

### 24.3 Fix

- avoid stale replicas via settings;
- investigate replication queue;
- fix network/disk/Keeper issues;
- expose freshness;
- use insert quorum if required;
- reduce part pressure.

---

## 25. Performance Engineering Anti-Patterns

### 25.1 Tuning Without Query Log

No evidence, no diagnosis.

### 25.2 Adding Indexes Blindly

Skipping indexes help only if predicate/data layout makes them useful.

### 25.3 Using `OPTIMIZE FINAL` as Routine Fix

Can create huge background pressure.

### 25.4 Blaming Hardware First

Many issues are schema/query/ingestion design.

### 25.5 Ignoring Result Size

Sometimes ClickHouse query is fine, but Java/frontend/export path is the bottleneck.

### 25.6 Looking Only at Average Latency

p95/p99 matters for dashboards and APIs.

### 25.7 Benchmarking on Warm Cache Only

Misleading for cold/historical queries.

### 25.8 Ignoring Distributed Fragments

Initial query may look fine while remote shard suffers.

### 25.9 Not Setting Query ID

Hard to trace production incidents.

### 25.10 No Baseline

You cannot detect regression without baseline metrics.

---

## 26. Production Checklist

### Query Diagnosis

- [ ] Query ID captured.
- [ ] Query log inspected.
- [ ] `read_rows/read_bytes/result_rows/memory` recorded.
- [ ] `EXPLAIN indexes = 1` run.
- [ ] `EXPLAIN PIPELINE` run if execution unclear.
- [ ] Query shape classified.
- [ ] Bottleneck hypothesis documented.

### Table Health

- [ ] `system.parts` checked.
- [ ] Parts per partition checked.
- [ ] Column sizes checked.
- [ ] Compression ratios reviewed.
- [ ] Merges checked.
- [ ] Mutations checked.

### Distributed Health

- [ ] Replica lag checked.
- [ ] Replication queue checked.
- [ ] Distribution queue checked.
- [ ] Per-shard query/thread stats checked.
- [ ] Data skew checked.

### Java/API

- [ ] Query family identified.
- [ ] Query ID propagated.
- [ ] Tenant/time filters enforced.
- [ ] Result size bounded.
- [ ] Timeout and memory settings configured.
- [ ] Slow query logged with context.

### Optimization Validation

- [ ] Before/after metrics compared.
- [ ] Correctness validated.
- [ ] Concurrent workload tested.
- [ ] Cold/warm cache behavior considered.
- [ ] Regression dashboard updated.

---

## 27. Exercises

### Exercise 1: Read Rows vs Result Rows

Query returns 50 rows but reads 2 billion rows.

Questions:

1. Is this necessarily bad?
2. What do you check?
3. What fixes are possible?

Expected reasoning:

- Could be acceptable for batch but suspicious for interactive.
- Check `EXPLAIN indexes = 1`, sort key alignment, partition pruning, selected columns, rollup possibility.

### Exercise 2: High Memory Query

Query has low read_bytes but huge memory.

Questions:

1. What operations cause this?
2. What logs/tables help?

Expected:

- aggregation, join, sort, distinct, `FINAL`.
- Check query_log memory, query_thread_log, EXPLAIN pipeline, group cardinality.

### Exercise 3: Slow Only in Production

Same query fast in staging.

Questions:

1. What differences matter?

Expected:

- data volume/cardinality;
- part count;
- cache state;
- cluster distribution;
- concurrent workload;
- mutations/merges;
- object storage;
- schema drift.

### Exercise 4: Dashboard Stale

Rows inserted but dashboard missing them.

Questions:

1. What to check?

Expected:

- raw vs rollup;
- MV lag/failure;
- replica lag;
- distributed insert queue;
- query time column;
- cache;
- ingestion watermark.

### Exercise 5: Too Many Parts

A table has 50,000 active parts.

Questions:

1. What caused it?
2. Why harmful?
3. How to fix?

Expected:

- small inserts/over-partitioning/backfill/MV.
- harms query/merge/replication.
- batch better, reduce partition count, compact/rebuild carefully.

---

## 28. Summary

Performance engineering in ClickHouse starts with evidence.

Core principles:

1. Measure before tuning.
2. `read_rows`, `read_bytes`, `result_rows`, and `memory_usage` tell different stories.
3. `EXPLAIN indexes = 1` reveals whether data skipping works.
4. `EXPLAIN PIPELINE` reveals execution structure and parallelism.
5. `system.query_log` is the primary historical query evidence.
6. `system.parts` reveals physical table health.
7. `system.parts_columns` reveals expensive columns and compression.
8. `system.merges` and `system.mutations` reveal background pressure.
9. Distributed diagnosis must include replicas, queues, shard skew, and coordinator behavior.
10. Java analytics APIs need query IDs, guardrails, and query-family observability.

Practical sentence:

> A slow ClickHouse query is not a mystery; it is usually a measurable mismatch between query shape, physical layout, data volume, and operational state.

---

## 29. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi ClickHouse sesuai versi yang kamu pakai:

1. ClickHouse Docs — EXPLAIN statement.
2. ClickHouse Docs — Understanding query execution with the analyzer.
3. ClickHouse Docs — Query optimization.
4. ClickHouse Docs — system.query_log.
5. ClickHouse Docs — system.query_thread_log.
6. ClickHouse Docs — system.parts.
7. ClickHouse Docs — system.parts_columns.
8. ClickHouse Docs — system.columns.
9. ClickHouse Docs — system.merges.
10. ClickHouse Docs — system.mutations.
11. ClickHouse Docs — system.replicas.
12. ClickHouse Docs — system.replication_queue.
13. ClickHouse Docs — system.distribution_queue.
14. ClickHouse Docs — Performance and optimizations.
15. ClickHouse Docs — Data skipping indexes.
16. ClickHouse Docs — Projections.

---

## 30. Status Seri

Part ini adalah:

```text
Part 023 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 024 — Performance Engineering II: Query Optimization Patterns
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-022.md">⬅️ Part 022 — Cloud-Native ClickHouse: Object Storage, Separation of Compute/Storage, and SharedMergeTree</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-024.md">Part 024 — Performance Engineering II: Query Optimization Patterns ➡️</a>
</div>

# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-012.md

# Part 012 — Query Execution Model: From SQL Text to Pipeline Execution

> Seri: `learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami OLAP, column-oriented database, dan ClickHouse sampai level arsitektur, internal, dan production reasoning.  
> Fokus part ini: memahami bagaimana ClickHouse mengeksekusi query dari SQL text sampai physical pipeline, agar kita bisa membaca `EXPLAIN`, memahami bottleneck, dan mendesain query/table/API yang selaras dengan cara kerja engine.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 011, kita sudah membangun fondasi berikut:

1. OLAP berbeda dari OLTP.
2. Columnar storage cepat karena membaca kolom yang diperlukan saja, mengompresi data dengan baik, dan memproses data dalam block/vector.
3. ClickHouse memakai table engine, khususnya keluarga `MergeTree`, sebagai pusat desain fisik.
4. `ORDER BY`, partition, data type, codec, ingestion batching, dan pipeline data menentukan biaya query jauh sebelum query dijalankan.

Part ini menjawab pertanyaan berikut:

> Setelah data sudah berada di table ClickHouse, apa yang sebenarnya terjadi saat query SQL dieksekusi?

Ini penting karena banyak engineer melakukan tuning hanya dari permukaan:

```sql
SELECT ...
FROM events
WHERE ...
GROUP BY ...
ORDER BY ...
LIMIT ...
```

Lalu ketika query lambat, responsnya sering berupa tebakan:

- tambah index;
- tambah server;
- tambah materialized view;
- tambah cache;
- rewrite query secara acak;
- pakai `FINAL`;
- pakai `OPTIMIZE FINAL`;
- split table;
- atau menyalahkan ClickHouse.

Di ClickHouse, pendekatan seperti itu lemah. Query performance harus dibaca sebagai pipeline fisik:

```text
SQL text
  -> AST
  -> semantic analysis
  -> query plan
  -> optimized plan
  -> execution pipeline
  -> processors
  -> column reads
  -> filters
  -> expressions
  -> aggregation / join / sort
  -> result stream
```

Mental model utama part ini:

> ClickHouse tidak “mengeksekusi SQL” secara abstrak. ClickHouse membangun pipeline pemrosesan kolom berbasis block, lalu menjalankan banyak processor secara paralel untuk membaca, menyaring, mengubah, menggabungkan, dan mengirim data.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan tahapan query execution ClickHouse dari SQL text sampai result.
2. Membedakan AST, analyzed query, logical plan, physical pipeline, dan runtime metrics.
3. Membaca `EXPLAIN AST`, `EXPLAIN SYNTAX`, `EXPLAIN PLAN`, `EXPLAIN PIPELINE`, dan `EXPLAIN indexes = 1` secara praktis.
4. Memahami block/vectorized execution.
5. Memahami bagaimana ClickHouse membaca column files, marks, granules, dan parts.
6. Menjelaskan kenapa query sederhana bisa mahal.
7. Menjelaskan kenapa query kompleks kadang tetap cepat.
8. Menghubungkan query shape dengan CPU, memory, disk, network, dan concurrency.
9. Menentukan apakah masalah query berasal dari schema, sorting key, aggregation, join, sort, distributed fan-out, memory, atau client API.
10. Menyusun workflow diagnosis query untuk production.

---

## 2. Satu Kalimat yang Harus Diingat

> Query ClickHouse cepat ketika pipeline dapat membaca sedikit kolom, melewati banyak granule, memproses block secara paralel, menjaga intermediate state kecil, dan menghindari shuffle/sort/join besar.

Sebaliknya, query ClickHouse lambat ketika pipeline dipaksa:

- membaca terlalu banyak columns;
- membaca terlalu banyak parts/granules;
- melakukan expression mahal untuk banyak rows;
- melakukan aggregation high-cardinality;
- join besar tanpa access path yang baik;
- sort global besar;
- menggunakan `FINAL` secara luas;
- melakukan distributed fan-out besar;
- mengembalikan result terlalu besar ke client;
- atau bertarung dengan query lain untuk CPU/memory/disk.

---

## 3. ClickHouse Query Execution: Big Picture

Secara konseptual, query SELECT melewati tahap berikut:

```text
Client
  |
  v
SQL text
  |
  v
Parser
  |
  v
AST
  |
  v
Analyzer / semantic analysis
  |
  v
Query tree / logical plan
  |
  v
Optimization
  |
  v
Query plan
  |
  v
Execution pipeline
  |
  v
Processors reading chunks/blocks
  |
  v
Result stream
  |
  v
Client
```

Dokumentasi resmi ClickHouse menjelaskan bahwa query execution dapat dipecah ke beberapa step dan tiap step bisa dianalisis dengan variasi `EXPLAIN`. Dokumentasi arsitektur ClickHouse juga menjelaskan bahwa interpreter membangun query execution pipeline dari AST, dan pipeline terdiri dari processor yang mengonsumsi serta memproduksi chunk/column sets.

Bagi Java engineer, analoginya kira-kira seperti ini:

```java
SqlText sql = clientRequest.getSql();
Ast ast = parser.parse(sql);
AnalyzedQuery analyzed = analyzer.resolve(ast, catalog, settings);
QueryPlan plan = planner.createPlan(analyzed);
QueryPlan optimized = optimizer.optimize(plan);
Pipeline pipeline = pipelineBuilder.build(optimized);
ResultStream result = executor.run(pipeline);
```

Tentu implementasi sebenarnya jauh lebih kompleks, tetapi model ini cukup untuk reasoning.

---

## 4. SQL Text: Input yang Terlihat Sederhana

Misalnya ada query:

```sql
SELECT
    toStartOfHour(event_time) AS hour,
    action_type,
    count() AS events,
    uniqExact(case_id) AS cases
FROM case_events
WHERE tenant_id = 'tenant-a'
  AND event_time >= now() - INTERVAL 7 DAY
  AND action_type IN ('ESCALATED', 'APPROVED', 'REJECTED')
GROUP BY
    hour,
    action_type
ORDER BY
    hour ASC,
    events DESC;
```

Dari permukaan query ini terlihat sebagai:

1. baca table;
2. filter rows;
3. group rows;
4. sort result;
5. return result.

Tetapi secara fisik ClickHouse harus menjawab banyak pertanyaan:

1. Kolom apa yang perlu dibaca?
2. Table engine apa yang dipakai?
3. Part mana yang mungkin relevan?
4. Partition mana yang bisa dilewati?
5. Granule mana yang bisa dilewati oleh sparse primary index?
6. Skip index mana yang bisa dipakai?
7. Apakah filter bisa didorong sedini mungkin?
8. Expression mana yang dihitung sebelum/ بعد filter?
9. Berapa stream paralel yang dibuka?
10. Bagaimana aggregation state dibuat?
11. Apakah aggregation muat memory?
12. Apakah perlu external aggregation ke disk?
13. Apakah sort result kecil atau besar?
14. Apakah query distributed?
15. Apakah result dikirim ke client dalam format apa?

Query execution adalah proses menjawab pertanyaan-pertanyaan ini.

---

## 5. Tahap 1 — Parsing: SQL Text Menjadi AST

Parser membaca SQL text dan menghasilkan AST, yaitu struktur sintaksis query.

Contoh query:

```sql
SELECT count()
FROM case_events
WHERE tenant_id = 'tenant-a';
```

Secara konseptual AST-nya bisa dilihat seperti:

```text
SelectQuery
  ExpressionList
    Function count
  Tables
    Table case_events
  Where
    Equals
      Identifier tenant_id
      Literal 'tenant-a'
```

AST belum sepenuhnya tahu apakah:

- `case_events` benar-benar ada;
- `tenant_id` kolom valid;
- `count()` tipe hasilnya apa;
- function overload mana yang digunakan;
- database default apa;
- user punya permission atau tidak;
- settings apa yang berlaku.

AST hanya struktur sintaksis.

### 5.1 Kenapa AST Penting?

AST penting untuk memahami bahwa query rewriting dan semantic analysis terjadi setelah parsing.

Misalnya query:

```sql
SELECT 1 + 2;
```

AST masih berisi expression `1 + 2`. Optimizer bisa melakukan constant folding menjadi `3` pada tahap berikutnya.

Contoh lain:

```sql
SELECT *
FROM case_events
WHERE tenant_id = 'tenant-a';
```

AST tahu ada `*`, tetapi daftar kolom yang direferensikan baru bisa di-resolve setelah table metadata dibaca.

### 5.2 Tool: EXPLAIN AST

Gunakan:

```sql
EXPLAIN AST
SELECT count()
FROM case_events
WHERE tenant_id = 'tenant-a';
```

Tujuannya bukan untuk tuning harian, tetapi untuk debugging bagaimana ClickHouse memahami struktur syntax.

Kapan berguna:

1. Query generated oleh aplikasi terlihat aneh.
2. Macro/template SQL menghasilkan expression kompleks.
3. Perlu memastikan precedence operator.
4. Perlu memahami transformasi awal.

Kapan tidak terlalu berguna:

1. Query lambat karena scan besar.
2. Query lambat karena aggregation high-cardinality.
3. Query lambat karena distributed fan-out.

Untuk tuning performa, `EXPLAIN PLAN`, `EXPLAIN PIPELINE`, dan logs biasanya lebih berguna.

---

## 6. Tahap 2 — Analyzer: Nama, Tipe, Function, Scope, dan Semantics

Analyzer mengubah query dari struktur syntax menjadi query yang secara semantic bermakna.

Analyzer harus resolve:

1. Table names.
2. Column names.
3. Aliases.
4. Function overloads.
5. Data types.
6. Aggregate function semantics.
7. Scope subquery.
8. JOIN references.
9. CTE references.
10. Permission dan access checks.

Misalnya:

```sql
SELECT
    toStartOfHour(event_time) AS hour,
    count() AS events
FROM case_events
WHERE event_time >= now() - INTERVAL 1 DAY
GROUP BY hour;
```

Analyzer harus tahu:

- `event_time` bertipe `DateTime64` atau `DateTime`;
- `toStartOfHour(event_time)` mengembalikan tipe apa;
- alias `hour` di `GROUP BY` mengacu ke expression yang benar;
- `now()` mengembalikan datetime;
- `INTERVAL 1 DAY` valid;
- `count()` adalah aggregate function;
- kolom non-aggregate harus ada di `GROUP BY`.

### 6.1 Kenapa Analyzer Penting untuk Engineer?

Karena banyak bug query analytics bukan bug storage, melainkan bug semantic:

1. Alias ambigu.
2. Type coercion tidak sesuai ekspektasi.
3. Timezone tidak eksplisit.
4. Decimal/Float campur.
5. Nullable menghasilkan behavior yang tidak disadari.
6. `DateTime` dibandingkan dengan string literal.
7. `Map`/`JSON` field dibaca dengan tipe yang tidak stabil.
8. Aggregate function dipakai salah.

### 6.2 Semantic Failure Example

Query:

```sql
SELECT
    tenant_id,
    action_type,
    count() AS events
FROM case_events;
```

Ini invalid secara semantic bila `tenant_id` dan `action_type` tidak masuk `GROUP BY`.

Di OLTP database, engineer sering melihat ini sebagai aturan SQL. Di OLAP, semantic correctness lebih dari aturan syntax: query harus mendefinisikan grain output.

Output grain query di atas tidak jelas:

```text
Satu row output merepresentasikan apa?
```

Harus dibuat eksplisit:

```sql
SELECT
    tenant_id,
    action_type,
    count() AS events
FROM case_events
GROUP BY
    tenant_id,
    action_type;
```

---

## 7. Tahap 3 — Query Plan: Langkah Logis untuk Menghasilkan Result

Setelah query dianalisis, ClickHouse membangun query plan.

Secara konseptual, query plan adalah DAG/sequence logical operations:

```text
ReadFromMergeTree(case_events)
  -> Filter(tenant_id = 'tenant-a' AND event_time >= ...)
  -> Expression(toStartOfHour(event_time))
  -> Aggregating(GROUP BY hour, action_type)
  -> Sorting(hour ASC, events DESC)
  -> Output
```

Plan belum selalu menunjukkan detail runtime yang konkret. Ia menjelaskan operasi besar.

### 7.1 Tool: EXPLAIN PLAN

Gunakan:

```sql
EXPLAIN PLAN
SELECT
    toStartOfHour(event_time) AS hour,
    action_type,
    count() AS events
FROM case_events
WHERE tenant_id = 'tenant-a'
  AND event_time >= now() - INTERVAL 7 DAY
GROUP BY
    hour,
    action_type
ORDER BY
    hour ASC,
    events DESC;
```

Yang dicari:

1. Apakah ada `ReadFromMergeTree`?
2. Apakah filter muncul cukup awal?
3. Apakah aggregation terjadi setelah filter?
4. Apakah ada sorting global?
5. Apakah ada join?
6. Apakah ada expression berat sebelum filter?
7. Apakah ada unexpected subquery/materialization?

### 7.2 Plan vs Pipeline

Plan menjawab:

```text
Operasi logis apa yang akan dilakukan?
```

Pipeline menjawab:

```text
Bagaimana operasi itu dijalankan secara fisik/paralel?
```

Contoh:

Plan:

```text
Read -> Filter -> Aggregating -> Sorting
```

Pipeline:

```text
ReadFromMergeTree × 16 streams
  -> ExpressionTransform × 16
  -> FilterTransform × 16
  -> AggregatingTransform × 16
  -> Resize 16 -> 8
  -> MergingAggregatedTransform × 8
  -> SortingTransform
  -> MergeSortingTransform
  -> OutputFormat
```

Pipeline jauh lebih dekat ke runtime cost.

---

## 8. Tahap 4 — Query Optimization

Optimizer mencoba memperbaiki plan tanpa mengubah hasil query.

Optimisasi umum:

1. Column pruning.
2. Constant folding.
3. Predicate pushdown.
4. Filter splitting.
5. Remove unused columns.
6. Projection usage.
7. Data skipping index usage.
8. Read-in-order optimization.
9. Limit pushdown.
10. Join optimization.

### 8.1 Column Pruning

Query:

```sql
SELECT count()
FROM case_events
WHERE tenant_id = 'tenant-a';
```

ClickHouse tidak perlu membaca semua kolom. Ia hanya perlu membaca kolom yang diperlukan untuk filter dan aggregation.

Dalam columnar database, ini sangat penting.

Table bisa punya 200 kolom, tetapi query hanya membaca:

```text
tenant_id
```

atau bahkan metadata tertentu untuk `count()` bergantung query shape dan engine behavior.

Anti-pattern:

```sql
SELECT *
FROM case_events
WHERE tenant_id = 'tenant-a'
LIMIT 1000;
```

Ini memaksa pembacaan banyak kolom, termasuk kolom besar yang mungkin tidak diperlukan:

- raw payload;
- error stack;
- JSON metadata;
- description text;
- long comments;
- labels map.

Dalam analytics API, jangan buat endpoint generic yang selalu `SELECT *`.

### 8.2 Predicate Pushdown

Filter sebaiknya diterapkan sedini mungkin.

Query:

```sql
SELECT
    action_type,
    count()
FROM case_events
WHERE tenant_id = 'tenant-a'
  AND event_time >= '2026-06-01 00:00:00'
GROUP BY action_type;
```

Filter `tenant_id` dan `event_time` bisa membantu ClickHouse membaca lebih sedikit granule bila selaras dengan sorting key/partition.

Namun tidak semua predicate sama murahnya.

Murah:

```sql
tenant_id = 'tenant-a'
event_time >= ...
action_type IN (...)
```

Lebih mahal:

```sql
lower(user_agent) LIKE '%chrome%'
JSONExtractString(payload, 'status') = 'APPROVED'
match(message, 'regex...')
```

Filter mahal yang memerlukan function per row biasanya tidak bisa membantu data skipping bila function tidak cocok dengan index/sort key.

### 8.3 Constant Folding

Query:

```sql
WHERE event_time >= toDateTime('2026-06-01 00:00:00')
```

Expression konstan bisa dihitung sekali, bukan per row.

Namun query seperti:

```sql
WHERE toDate(event_time) = '2026-06-01'
```

bisa menghambat penggunaan sort key bila `event_time` ada di sorting key tetapi dibungkus function. Lebih baik:

```sql
WHERE event_time >= '2026-06-01 00:00:00'
  AND event_time <  '2026-06-02 00:00:00'
```

Reasoning:

```text
Filter range langsung pada kolom fisik lebih mudah dipakai untuk data skipping daripada function applied to column.
```

### 8.4 Remove Unused Columns

Jika query punya subquery:

```sql
SELECT count()
FROM
(
    SELECT
        tenant_id,
        event_time,
        action_type,
        payload,
        user_agent
    FROM case_events
)
WHERE tenant_id = 'tenant-a';
```

Optimizer bisa menghapus kolom yang tidak dipakai jika memungkinkan.

Tetapi jangan bergantung sepenuhnya pada optimizer untuk membersihkan query buruk dari aplikasi. Query generator yang eksplisit jauh lebih baik.

---

## 9. Tahap 5 — Execution Pipeline

Execution pipeline adalah bentuk fisik dari query plan.

ClickHouse memakai processor. Processor mengonsumsi input dan menghasilkan output dalam bentuk chunks/blocks.

Contoh processor konseptual:

```text
ReadFromMergeTree
ExpressionTransform
FilterTransform
AggregatingTransform
MergingAggregatedTransform
SortingTransform
LimitTransform
OutputFormat
```

Pipeline dapat punya banyak stream paralel.

### 9.1 Tool: EXPLAIN PIPELINE

Gunakan:

```sql
EXPLAIN PIPELINE
SELECT
    action_type,
    count()
FROM case_events
WHERE tenant_id = 'tenant-a'
  AND event_time >= now() - INTERVAL 7 DAY
GROUP BY action_type;
```

Yang dicari:

1. Berapa banyak read streams?
2. Berapa banyak transform paralel?
3. Apakah ada `Resize`?
4. Apakah aggregation two-stage?
5. Apakah ada `MergingAggregated`?
6. Apakah sorting terjadi satu stream atau banyak stream?
7. Apakah pipeline collapse terlalu cepat menjadi single thread?
8. Apakah query punya bottleneck final merge/sort/output?

### 9.2 Pipeline Parallelism

ClickHouse dirancang untuk memanfaatkan banyak CPU cores. Query besar biasanya dibagi menjadi banyak stream.

Contoh mental model:

```text
Part/marks to read:
  granule range A -> stream 1
  granule range B -> stream 2
  granule range C -> stream 3
  ...
```

Setiap stream membaca column chunks lalu menjalankan transform:

```text
stream 1: read -> filter -> partial aggregate
stream 2: read -> filter -> partial aggregate
stream 3: read -> filter -> partial aggregate
...
```

Lalu intermediate states digabung:

```text
partial aggregate states -> merge aggregate states -> final result
```

### 9.3 Parallelism Bukan Obat Semua Masalah

Lebih banyak thread tidak selalu membuat query lebih cepat.

Bottleneck bisa terjadi pada:

1. Disk read bandwidth.
2. Decompression CPU.
3. Memory allocation.
4. Hash table aggregation.
5. Final merge single bottleneck.
6. Network transfer antar shard.
7. Client output consumption.
8. Result serialization.

Jika query membaca 2 TB data, menambah thread bisa mempercepat sampai batas tertentu, tetapi tidak mengubah fakta bahwa query membaca 2 TB.

First-order optimization tetap:

```text
Baca data lebih sedikit.
```

Bukan:

```text
Baca data besar dengan lebih banyak thread.
```

---

## 10. Block-Oriented and Vectorized Execution

ClickHouse memproses data dalam block/chunk, bukan row-by-row object seperti banyak aplikasi Java.

### 10.1 Row-by-Row Mental Model

Naive Java style:

```java
for (Event event : events) {
    if (event.tenantId().equals("tenant-a")) {
        grouped.merge(event.actionType(), 1L, Long::sum);
    }
}
```

Masalah:

- object allocation;
- pointer chasing;
- poor CPU cache locality;
- virtual calls;
- branch misprediction;
- per-row overhead tinggi.

### 10.2 Column Block Mental Model

Columnar/vectorized style:

```text
tenant_id column block:
  [tenant-a, tenant-b, tenant-a, ...]

action_type column block:
  [OPENED, ESCALATED, APPROVED, ...]

event_time column block:
  [ts1, ts2, ts3, ...]
```

Filter bisa menghasilkan mask:

```text
tenant_id == tenant-a
  [true, false, true, ...]
```

Lalu mask diterapkan pada kolom yang diperlukan.

Ini lebih dekat dengan:

```java
String[] tenantIds = ...;
String[] actionTypes = ...;
long[] eventTimes = ...;
boolean[] mask = new boolean[blockSize];

for (int i = 0; i < blockSize; i++) {
    mask[i] = tenantIds[i].equals("tenant-a");
}

for (int i = 0; i < blockSize; i++) {
    if (mask[i]) {
        aggregate(actionTypes[i]);
    }
}
```

Tetapi implementasi native ClickHouse lebih dekat ke low-level C++ vectorized processing.

### 10.3 Kenapa Ini Penting?

Karena query design harus mendukung pemrosesan block:

Baik:

```sql
WHERE tenant_id = 'tenant-a'
  AND event_time >= ...
```

Kurang baik:

```sql
WHERE customSlowFunction(payload) = 'x'
```

Baik:

```sql
SELECT action_type, count()
GROUP BY action_type
```

Mahal:

```sql
SELECT normalizeHugeJson(payload), uniqExact(user_id)
GROUP BY normalizeHugeJson(payload)
```

Query yang memaksa parsing string/JSON/regex per row menghancurkan keuntungan columnar.

---

## 11. Read Path dari MergeTree

Untuk table `MergeTree`, read path kira-kira seperti ini:

```text
1. Determine table and metadata
2. Determine required columns
3. Determine relevant partitions
4. Determine relevant parts
5. Use sparse primary index to prune granules
6. Use skip indexes if available
7. Read marks
8. Read compressed column ranges
9. Decompress blocks
10. Produce chunks into pipeline
```

### 11.1 Required Columns

Query:

```sql
SELECT action_type, count()
FROM case_events
WHERE tenant_id = 'tenant-a'
GROUP BY action_type;
```

Kolom yang dibutuhkan:

```text
tenant_id    -- filter
action_type  -- group by and output
```

Kolom yang tidak perlu dibaca:

```text
payload
comment
created_by_name
previous_status
new_status
trace_id
ip_address
...
```

### 11.2 Partition Pruning

Jika table:

```sql
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, action_type)
```

Query:

```sql
WHERE event_time >= '2026-06-01'
  AND event_time <  '2026-07-01'
```

ClickHouse bisa menghindari partition di luar Juni 2026.

Tetapi jika query:

```sql
WHERE toDate(event_time) = '2026-06-15'
```

pruning mungkin tidak seefektif range eksplisit, tergantung expression analysis.

Biasakan generate query API dengan range:

```sql
WHERE event_time >= {from}
  AND event_time <  {to}
```

bukan function wrapping pada kolom.

### 11.3 Primary Index / Granule Pruning

Jika sorting key:

```sql
ORDER BY (tenant_id, event_time, action_type)
```

Query:

```sql
WHERE tenant_id = 'tenant-a'
  AND event_time >= '2026-06-01'
  AND event_time <  '2026-06-08'
```

sangat selaras dengan key prefix.

ClickHouse dapat mencari mark ranges relevan dan melewati granule lain.

Jika query:

```sql
WHERE action_type = 'ESCALATED'
```

tanpa tenant/time, sorting key di atas tidak banyak membantu karena `action_type` bukan prefix awal.

Ingat prefix effect dari Part 007:

```text
ORDER BY (tenant_id, event_time, action_type)
```

Membantu:

```text
tenant_id
tenant_id + event_time
tenant_id + event_time + action_type
```

Tidak optimal untuk:

```text
event_time only
action_type only
action_type + event_time
```

### 11.4 Mark Reading

ClickHouse tidak membaca row satu per satu dari disk. Ia membaca range berdasarkan marks.

Dari Part 004:

```text
part
  column files
  marks
  sparse primary index
  granules
```

Jika query hanya membutuhkan 10 granule dari 1000 granule, ClickHouse bisa membaca range kolom yang sesuai mark tersebut.

Namun granule adalah unit minimum. Jika satu granule berisi banyak row campuran karena sorting key buruk, ClickHouse tetap harus membaca granule tersebut.

---

## 12. Filter Execution: Cheap Filter vs Expensive Filter

Tidak semua filter sama.

### 12.1 Filter yang Baik untuk ClickHouse

Filter ideal:

1. Menggunakan kolom fisik.
2. Selaras dengan sorting key/partition.
3. Selective.
4. Tipe data sederhana.
5. Tidak membungkus kolom dengan function mahal.
6. Menggunakan range eksplisit.

Contoh:

```sql
WHERE tenant_id = 'tenant-a'
  AND event_time >= '2026-06-01 00:00:00'
  AND event_time <  '2026-06-08 00:00:00'
```

### 12.2 Filter yang Mahal

Contoh:

```sql
WHERE JSONExtractString(payload, 'actionType') = 'ESCALATED'
```

Masalah:

- harus membaca `payload`;
- harus parse/extract untuk banyak rows;
- sulit memanfaatkan sorting key jika field tidak dipromosikan ke kolom;
- compression mungkin buruk;
- CPU besar.

Lebih baik saat field sering dipakai:

```sql
ALTER TABLE case_events
ADD COLUMN action_type LowCardinality(String);
```

Lalu ingestion mengisi `action_type` sebagai kolom fisik.

### 12.3 Function on Column Problem

Kurang baik:

```sql
WHERE toDate(event_time) = '2026-06-01'
```

Lebih baik:

```sql
WHERE event_time >= '2026-06-01 00:00:00'
  AND event_time <  '2026-06-02 00:00:00'
```

Kurang baik:

```sql
WHERE lower(email) = 'alice@example.com'
```

Lebih baik:

```sql
WHERE normalized_email = 'alice@example.com'
```

Bila filter adalah query path utama, normalisasi saat ingestion jauh lebih baik daripada normalisasi saat query.

---

## 13. Expression Evaluation

Expression adalah computation dalam query:

```sql
toStartOfHour(event_time)
if(status = 'APPROVED', 1, 0)
concat(country, '-', region)
JSONExtractString(payload, 'x')
parseDateTimeBestEffort(raw_time)
```

Expression bisa terjadi:

1. Sebelum filter.
2. Setelah filter.
3. Sebelum aggregation.
4. Setelah aggregation.
5. Saat projection output.

### 13.1 Push Expensive Expression After Filter

Buruk:

```sql
SELECT
    expensiveNormalize(payload) AS normalized,
    count()
FROM case_events
WHERE tenant_id = 'tenant-a'
GROUP BY normalized;
```

Jika `expensiveNormalize(payload)` harus dihitung untuk semua row sebelum filter, query mahal.

Lebih baik desain schema agar filter murah dulu:

```sql
SELECT
    normalized_action,
    count()
FROM case_events
WHERE tenant_id = 'tenant-a'
  AND event_time >= ...
GROUP BY normalized_action;
```

### 13.2 Materialized Columns

Untuk expression yang sering dipakai, gunakan materialized column atau ingestion-side computed field.

Contoh:

```sql
CREATE TABLE api_events
(
    event_time DateTime64(3),
    tenant_id LowCardinality(String),
    path String,
    normalized_path String MATERIALIZED replaceRegexpAll(path, '/[0-9]+', '/{id}'),
    status_code UInt16,
    latency_ms UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, normalized_path);
```

Catatan: jangan sembarangan menaruh expression mahal sebagai materialized column tanpa mengukur ingestion cost. Kamu memindahkan biaya dari query-time ke insert-time.

---

## 14. Aggregation Execution

Aggregation adalah operasi inti OLAP.

Query:

```sql
SELECT
    tenant_id,
    action_type,
    count() AS events
FROM case_events
WHERE event_time >= now() - INTERVAL 7 DAY
GROUP BY
    tenant_id,
    action_type;
```

Secara fisik, ClickHouse membangun aggregation state.

Mental model:

```text
key: (tenant_id, action_type)
state: count
```

Hash table:

```text
('tenant-a', 'OPENED')     -> 12345
('tenant-a', 'ESCALATED')  -> 456
('tenant-b', 'OPENED')     -> 9988
...
```

### 14.1 Partial Aggregation

Dengan parallel streams:

```text
stream 1 -> partial aggregate map
stream 2 -> partial aggregate map
stream 3 -> partial aggregate map
...
```

Lalu digabung:

```text
partial maps -> merged aggregate map -> final rows
```

### 14.2 Cardinality Determines Memory

Aggregation memory terutama dipengaruhi oleh jumlah unique group keys dan ukuran state.

Murah:

```sql
GROUP BY action_type
```

Jika `action_type` hanya 20 nilai.

Mahal:

```sql
GROUP BY user_id, request_id, trace_id
```

Jika kombinasi hampir unik per row.

Sangat mahal:

```sql
SELECT
    user_id,
    uniqExact(session_id),
    quantilesExact(0.5, 0.95, 0.99)(latency_ms)
FROM events
GROUP BY user_id;
```

Karena state exact distinct/quantile bisa besar.

### 14.3 Aggregation State Size

Fungsi agregasi berbeda punya state berbeda:

| Function | State Cost | Catatan |
|---|---:|---|
| `count()` | kecil | counter |
| `sum(UInt64)` | kecil | accumulator |
| `min/max` | kecil | value |
| `avg` | kecil-sedang | sum + count |
| `uniq` | sedang | approximate distinct |
| `uniqExact` | tinggi | exact set |
| `quantile` | tergantung fungsi | approximate/exact berbeda |
| `groupArray` | bisa sangat tinggi | menyimpan banyak value |

Part 013 akan membahas aggregation lebih dalam.

Untuk part ini cukup ingat:

```text
GROUP BY cardinality × aggregate state size = memory pressure.
```

### 14.4 External Aggregation

Jika memory tidak cukup, ClickHouse dapat melakukan external aggregation ke disk bila settings mengizinkan.

Trade-off:

- query tidak langsung gagal;
- tetapi lebih lambat karena spill ke disk;
- disk I/O meningkat;
- concurrent query bisa makin terganggu.

External aggregation bukan pengganti desain query yang baik.

---

## 15. Sorting Execution

Sorting sering mahal karena memerlukan global order.

Query:

```sql
SELECT
    user_id,
    count() AS events
FROM events
GROUP BY user_id
ORDER BY events DESC
LIMIT 100;
```

Langkahnya:

```text
read/filter
  -> aggregate by user_id
  -> produce many groups
  -> sort groups by events desc
  -> take top 100
```

Jika jumlah `user_id` jutaan, sorting bisa mahal.

### 15.1 ORDER BY Storage Key vs Query ORDER BY

Table:

```sql
ORDER BY (tenant_id, event_time)
```

Query:

```sql
ORDER BY event_time
```

Tidak otomatis berarti result sudah terurut global sesuai query, terutama jika:

- query tidak filter tenant prefix;
- banyak parts;
- distributed table;
- aggregation mengubah order;
- query order berbeda dari storage order.

### 15.2 LIMIT Tidak Selalu Murah

Query:

```sql
SELECT *
FROM events
ORDER BY latency_ms DESC
LIMIT 100;
```

Jika `latency_ms` bukan storage order/projection, ClickHouse mungkin harus membaca banyak data untuk menemukan top 100.

`LIMIT 100` tidak berarti membaca 100 rows.

Yang benar:

```text
LIMIT membatasi output, bukan otomatis membatasi scan.
```

### 15.3 Top-N Pattern

Top-N lebih baik jika:

1. Filter awal sangat selective.
2. Data sudah dipre-aggregate.
3. Ada projection/materialized view sesuai access path.
4. Query memakai approximate heavy hitters bila acceptable.
5. Endpoint API membatasi dimension yang boleh dipakai.

---

## 16. JOIN Execution Overview

JOIN di ClickHouse bisa cepat, tetapi bukan operasi gratis.

Query:

```sql
SELECT
    e.action_type,
    d.case_category,
    count()
FROM case_events e
LEFT JOIN case_dimension d ON e.case_id = d.case_id
WHERE e.tenant_id = 'tenant-a'
  AND e.event_time >= now() - INTERVAL 7 DAY
GROUP BY
    e.action_type,
    d.case_category;
```

Potensi biaya:

1. Membaca left side besar.
2. Membaca/build right side hash table.
3. Memory untuk hash table join.
4. Distributed join complexity.
5. Output cardinality explosion.
6. Join sebelum filter/aggregation bisa memperbesar pipeline.

Part 017 akan membahas JOIN lebih dalam.

Untuk sekarang, prinsipnya:

```text
Dalam OLAP, join harus diperlakukan sebagai keputusan desain pipeline, bukan convenience modeling.
```

Jika dimension kecil dan stabil, opsi:

1. Denormalize ke event table saat ingestion.
2. Gunakan dictionary.
3. Gunakan materialized view enrichment.
4. Gunakan join saat query hanya jika workload mendukung.

---

## 17. Distributed Query Execution

Jika memakai `Distributed` table, query bisa menyebar ke shard.

Mental model:

```text
client
  -> coordinator node
      -> shard 1 local query
      -> shard 2 local query
      -> shard 3 local query
      -> shard 4 local query
  -> merge partial results
  -> return to client
```

### 17.1 Distributed Aggregation

Query:

```sql
SELECT action_type, count()
FROM distributed_case_events
WHERE tenant_id = 'tenant-a'
GROUP BY action_type;
```

Idealnya setiap shard melakukan partial aggregation:

```text
shard 1: action_type -> count
shard 2: action_type -> count
shard 3: action_type -> count
```

Coordinator menggabungkan hasil:

```text
merge counts by action_type
```

Ini efisien bila intermediate result kecil.

### 17.2 Distributed Query yang Mahal

Mahal bila intermediate result besar:

```sql
SELECT user_id, request_id, count()
FROM distributed_events
GROUP BY user_id, request_id;
```

Jika output partial dari tiap shard jutaan rows, coordinator menerima volume besar.

Mahal juga bila:

- join distributed tidak dirancang;
- sharding key tidak selaras dengan query;
- query memerlukan global sort besar;
- tenant tersebar di semua shard padahal query tenant-specific;
- network bandwidth menjadi bottleneck.

### 17.3 Sharding Key Matters

Jika query dominan tenant-specific:

```sql
WHERE tenant_id = 'tenant-a'
```

Sharding by tenant bisa mengurangi fan-out bila routing mendukung.

Jika query dominan global time-series:

```sql
WHERE event_time >= ... GROUP BY region
```

Sharding by tenant bisa tetap memerlukan semua shard.

Part 020 dan 021 akan membahas cluster lebih dalam.

---

## 18. Result Serialization and Client Consumption

Query belum selesai sampai result dikirim ke client.

Bottleneck bisa berada di:

1. Output formatting.
2. Compression over wire.
3. Network bandwidth.
4. Client deserialization.
5. Java heap allocation.
6. HTTP response buffering.
7. Browser/dashboard rendering.

Query:

```sql
SELECT *
FROM events
WHERE tenant_id = 'tenant-a'
LIMIT 1000000;
```

Mungkin server mampu menghasilkan result cepat, tetapi Java service lambat karena:

- deserialize satu juta row menjadi object;
- heap pressure;
- GC pause;
- JSON serialization ke frontend;
- frontend tidak mampu render;
- network transfer besar.

Untuk analytics API, desain output sama pentingnya dengan query.

Prinsip:

```text
OLAP API sebaiknya mengembalikan insight/aggregate, bukan dump mentah besar, kecuali endpoint export didesain khusus.
```

---

## 19. Query Settings yang Mempengaruhi Execution

ClickHouse punya banyak settings. Jangan menghafal semuanya di awal. Pahami kategori.

### 19.1 Parallelism Settings

Contoh kategori:

- maximum threads;
- read pool size;
- distributed parallelism;
- parallel replicas.

Efek:

- lebih banyak parallelism bisa mempercepat scan;
- tetapi bisa mengganggu query lain;
- bisa meningkatkan memory;
- bisa membuat disk/network saturasi.

### 19.2 Memory Settings

Contoh kategori:

- max memory usage;
- external aggregation threshold;
- external sort threshold.

Efek:

- mencegah query membunuh server;
- memungkinkan spill ke disk;
- tapi bisa membuat query lebih lambat.

### 19.3 Read Settings

Contoh kategori:

- max rows to read;
- max bytes to read;
- force index usage;
- skip index behavior.

Efek:

- guardrail untuk query buruk;
- governance untuk multi-tenant API.

### 19.4 Timeout Settings

Contoh kategori:

- max execution time;
- receive timeout;
- send timeout.

Efek:

- melindungi service dari stuck query;
- harus dikombinasikan dengan cancellation.

### 19.5 Jangan Tuning dari Settings Dulu

Urutan yang lebih baik:

```text
1. Understand query shape
2. Check rows/bytes read
3. Check parts/granules skipped
4. Check aggregation cardinality
5. Check sort/join/distributed step
6. Check memory and CPU
7. Baru pertimbangkan settings
```

Settings tidak memperbaiki schema yang salah.

---

## 20. EXPLAIN Toolkit

ClickHouse menyediakan beberapa variasi `EXPLAIN`.

### 20.1 EXPLAIN AST

Untuk melihat syntax tree.

```sql
EXPLAIN AST
SELECT count()
FROM case_events
WHERE tenant_id = 'tenant-a';
```

Gunakan untuk:

- debugging parser;
- memahami generated SQL;
- operator precedence;
- query transformation awal.

### 20.2 EXPLAIN SYNTAX

Untuk melihat query setelah syntax-level rewrite.

```sql
EXPLAIN SYNTAX
SELECT count()
FROM case_events
WHERE tenant_id = 'tenant-a';
```

Gunakan untuk:

- melihat rewrite sederhana;
- memastikan query generated tidak berubah aneh.

### 20.3 EXPLAIN PLAN

Untuk melihat query plan.

```sql
EXPLAIN PLAN
SELECT action_type, count()
FROM case_events
WHERE tenant_id = 'tenant-a'
GROUP BY action_type;
```

Gunakan untuk:

- memahami operator logis;
- melihat filter/aggregation/sort/join;
- memastikan read source.

### 20.4 EXPLAIN PIPELINE

Untuk melihat physical pipeline.

```sql
EXPLAIN PIPELINE
SELECT action_type, count()
FROM case_events
WHERE tenant_id = 'tenant-a'
GROUP BY action_type;
```

Gunakan untuk:

- melihat parallel streams;
- melihat transform runtime;
- melihat merge/finalization bottleneck;
- memahami apakah pipeline parallel atau collapse.

### 20.5 EXPLAIN indexes = 1

Untuk melihat pemakaian index, filtered parts, dan granules.

```sql
EXPLAIN indexes = 1
SELECT action_type, count()
FROM case_events
WHERE tenant_id = 'tenant-a'
  AND event_time >= '2026-06-01 00:00:00'
  AND event_time <  '2026-06-08 00:00:00'
GROUP BY action_type;
```

Yang dicari:

1. Apakah partition pruning terjadi?
2. Apakah primary index dipakai?
3. Berapa banyak parts filtered?
4. Berapa banyak granules filtered?
5. Apakah skip index dipakai?

Jika query membaca terlalu banyak granule, masalah biasanya ada di:

- sorting key;
- filter tidak selaras key;
- function wrapping column;
- partition terlalu luas;
- query requirement memang luas;
- data distribution buruk.

---

## 21. System Tables untuk Runtime Observability

`EXPLAIN` memberi perkiraan/struktur. Runtime observability memberi fakta setelah query berjalan.

### 21.1 system.query_log

Gunakan untuk melihat query yang sudah berjalan.

Contoh:

```sql
SELECT
    query_id,
    type,
    event_time,
    query_duration_ms,
    read_rows,
    read_bytes,
    result_rows,
    result_bytes,
    memory_usage,
    ProfileEvents['SelectedMarks'] AS selected_marks,
    ProfileEvents['SelectedRows'] AS selected_rows,
    ProfileEvents['SelectedBytes'] AS selected_bytes,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time >= now() - INTERVAL 1 HOUR
ORDER BY query_duration_ms DESC
LIMIT 20;
```

Interpretasi:

| Metric | Arti |
|---|---|
| `read_rows` | rows yang dibaca dari storage/pipeline |
| `read_bytes` | bytes dibaca |
| `result_rows` | rows dikembalikan |
| `memory_usage` | peak memory query |
| `query_duration_ms` | durasi end-to-end |
| `ProfileEvents` | event detail internal |

Rasio penting:

```text
read_rows / result_rows
read_bytes / result_bytes
```

Jika membaca 10 miliar rows untuk menghasilkan 100 rows, query mungkin masih valid untuk OLAP, tetapi harus dipastikan access path sesuai.

### 21.2 system.processes

Untuk query yang sedang berjalan:

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

Gunakan saat incident:

- query mana yang sedang lama;
- apakah read_rows terus naik;
- memory usage naik;
- query dari user/API mana.

### 21.3 system.query_thread_log

Berguna untuk melihat per-thread execution detail.

Pertanyaan yang bisa dijawab:

1. Apakah workload tersebar merata antar thread?
2. Apakah ada thread sangat lambat?
3. Apakah query benar-benar parallel?
4. Apakah bottleneck di read atau CPU transform?

### 21.4 system.query_metric_log

Menyimpan history metric dan memory per query secara periodik. Berguna untuk query panjang yang memory-nya naik bertahap.

### 21.5 system.asynchronous_metrics

Untuk melihat kondisi node:

- memory;
- background activity;
- system-level metrics.

Query execution tidak bisa dipisahkan dari kondisi node. Query yang biasanya 2 detik bisa jadi 20 detik saat background merges, disk pressure, atau query concurrent tinggi.

---

## 22. Cara Membaca Query Lambat: Workflow Praktis

Jangan mulai dari rewrite query secara random.

Gunakan workflow berikut.

### Step 1 — Ambil Query dan Konteks

Kumpulkan:

1. SQL final yang dikirim aplikasi.
2. `query_id`.
3. user/tenant/request id.
4. waktu eksekusi.
5. settings yang dipakai.
6. table version/schema.
7. cluster/node.
8. apakah query single-node atau distributed.

### Step 2 — Cek Runtime Summary

Dari `system.query_log`:

```sql
SELECT
    query_duration_ms,
    read_rows,
    read_bytes,
    result_rows,
    result_bytes,
    memory_usage,
    query
FROM system.query_log
WHERE query_id = '...'
  AND type = 'QueryFinish';
```

Pertanyaan:

1. Apakah query membaca banyak data?
2. Apakah result juga besar?
3. Apakah memory tinggi?
4. Apakah durasi sejalan dengan read volume?

### Step 3 — Cek Data Skipping

```sql
EXPLAIN indexes = 1
SELECT ...;
```

Pertanyaan:

1. Apakah partition pruning terjadi?
2. Apakah primary key membantu?
3. Apakah terlalu banyak granule dibaca?
4. Apakah filter expression menghambat pruning?

### Step 4 — Cek Plan

```sql
EXPLAIN PLAN
SELECT ...;
```

Pertanyaan:

1. Apakah operator sesuai ekspektasi?
2. Apakah filter muncul sebelum aggregation/join?
3. Apakah ada sort besar?
4. Apakah ada join yang tidak disadari?
5. Apakah subquery/materialization mahal?

### Step 5 — Cek Pipeline

```sql
EXPLAIN PIPELINE
SELECT ...;
```

Pertanyaan:

1. Berapa parallelism?
2. Apakah pipeline collapse di satu titik?
3. Apakah ada merge/sort/finalization bottleneck?
4. Apakah aggregation multi-stage?

### Step 6 — Klasifikasi Bottleneck

Gunakan taxonomy:

| Gejala | Kemungkinan bottleneck |
|---|---|
| `read_bytes` besar, memory rendah | scan/I/O/decompression |
| `read_rows` besar, result kecil | data skipping buruk atau query memang luas |
| memory tinggi | aggregation/join/sort cardinality |
| result_rows besar | client/output/API problem |
| duration tinggi, read rendah | CPU expression/join/sort/network/concurrency |
| distributed query lambat | shard fan-out/network/coordinator bottleneck |
| query lambat saat insert tinggi | merge/disk contention |

### Step 7 — Pilih Fix Sesuai Layer

| Layer | Fix |
|---|---|
| Query | filter range, remove `SELECT *`, avoid function on key column |
| Schema | promote hot JSON field, reduce Nullable/String, better type |
| Sorting key | redesign table for access path |
| Partition | align lifecycle/time pruning |
| Pre-aggregation | materialized view/rollup |
| Projection | alternate physical layout |
| Ingestion | normalize/enrich at write time |
| Cluster | shard key, distributed topology, resources |
| API | pagination/export/caching/limits |

---

## 23. Example 1 — Query Cepat Karena Access Path Selaras

Table:

```sql
CREATE TABLE case_events
(
    tenant_id LowCardinality(String),
    event_time DateTime64(3),
    case_id UUID,
    action_type LowCardinality(String),
    actor_role LowCardinality(String),
    duration_ms UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, action_type, case_id);
```

Query:

```sql
SELECT
    action_type,
    count() AS events,
    uniq(case_id) AS cases
FROM case_events
WHERE tenant_id = 'tenant-a'
  AND event_time >= '2026-06-01 00:00:00'
  AND event_time <  '2026-06-08 00:00:00'
GROUP BY action_type
ORDER BY events DESC;
```

Kenapa bagus:

1. Filter memakai prefix sorting key.
2. Time range eksplisit.
3. Partition pruning bulanan mungkin membantu.
4. Kolom dibaca sedikit.
5. `action_type` low-cardinality.
6. Group cardinality kecil.
7. Result kecil.

Pipeline kira-kira:

```text
Read relevant marks
  -> Filter tenant/time
  -> Partial aggregate by action_type
  -> Merge aggregates
  -> Sort small result
  -> Output
```

Fix tambahan mungkin tidak diperlukan.

---

## 24. Example 2 — Query Lambat Walau Ada LIMIT

Query:

```sql
SELECT
    case_id,
    event_time,
    payload
FROM case_events
WHERE JSONExtractString(payload, 'riskLevel') = 'HIGH'
ORDER BY event_time DESC
LIMIT 100;
```

Masalah:

1. Filter membaca `payload` besar.
2. JSON extraction per row.
3. Filter tidak selaras sorting key.
4. `ORDER BY event_time DESC LIMIT 100` bisa tetap membaca banyak data.
5. Payload besar memperberat scan dan output.

Solusi desain:

Promote field:

```sql
risk_level LowCardinality(String)
```

Gunakan query:

```sql
SELECT
    case_id,
    event_time,
    risk_level
FROM case_events
WHERE tenant_id = 'tenant-a'
  AND event_time >= now() - INTERVAL 30 DAY
  AND risk_level = 'HIGH'
ORDER BY event_time DESC
LIMIT 100;
```

Jika query ini critical, pertimbangkan table/projection dengan key:

```sql
ORDER BY (tenant_id, risk_level, event_time)
```

atau materialized serving table.

---

## 25. Example 3 — Aggregation Memory Explosion

Query:

```sql
SELECT
    tenant_id,
    user_id,
    request_id,
    uniqExact(session_id) AS sessions
FROM api_events
WHERE event_time >= now() - INTERVAL 7 DAY
GROUP BY
    tenant_id,
    user_id,
    request_id;
```

Masalah:

1. `request_id` hampir unik.
2. Group count mendekati row count.
3. `uniqExact` state mahal.
4. Memory tinggi.
5. Output mungkin besar.

Pertanyaan desain:

- Apakah query ini benar-benar analytics?
- Apakah grain output masuk akal?
- Apakah user butuh exact distinct?
- Apakah bisa pre-aggregate by hour/user?
- Apakah `request_id` seharusnya filter/drilldown, bukan group dimension?

Alternatif:

```sql
SELECT
    tenant_id,
    user_id,
    toStartOfHour(event_time) AS hour,
    count() AS requests,
    uniq(session_id) AS approx_sessions
FROM api_events
WHERE event_time >= now() - INTERVAL 7 DAY
GROUP BY
    tenant_id,
    user_id,
    hour;
```

Atau serving rollup table.

---

## 26. Example 4 — Distributed Coordinator Bottleneck

Query:

```sql
SELECT
    user_id,
    count() AS events
FROM distributed_events
WHERE event_time >= now() - INTERVAL 30 DAY
GROUP BY user_id
ORDER BY events DESC
LIMIT 1000;
```

Kemungkinan pipeline:

```text
Shard 1 reads and aggregates by user_id
Shard 2 reads and aggregates by user_id
Shard 3 reads and aggregates by user_id
Shard 4 reads and aggregates by user_id
Coordinator receives millions of user_id groups
Coordinator merges
Coordinator sorts
Coordinator returns top 1000
```

Bottleneck bisa di coordinator.

Solusi:

1. Pre-aggregate per shard/time bucket.
2. Use top-K approximation if acceptable.
3. Add tenant/time filter.
4. Use rollup table.
5. Align shard key with tenant/query pattern.
6. Reduce cardinality before distributed merge.

---

## 27. Query Execution and Java API Design

Sebagai Java engineer, kamu tidak hanya menulis SQL. Kamu biasanya membuat service/API yang menghasilkan SQL dan mengirim result ke user/dashboard.

### 27.1 Jangan Buat Query Generator yang Terlalu Bebas

Buruk:

```text
Frontend bebas pilih:
- semua kolom
- semua dimension
- semua metric
- semua filter
- arbitrary sort
- arbitrary date range
```

Ini menghasilkan query tak terkendali.

Lebih baik:

```text
Analytics API contract:
- allowed dimensions
- allowed metrics
- allowed filters
- maximum date range
- maximum result rows
- default time filter
- safe sort options
- approximate/exact metric policy
- tenant guardrail
```

### 27.2 Query Shape Registry

Buat registry query shape:

```java
enum AnalyticsQueryShape {
    CASE_VOLUME_BY_DAY,
    CASE_VOLUME_BY_STATUS,
    ESCALATION_RATE_BY_REGION,
    SLA_BREACH_TOP_REASONS,
    AUDIT_EVENTS_SEARCH,
    CASE_TIMELINE_DRILLDOWN
}
```

Setiap shape punya:

```text
- expected filters
- required sorting key support
- max range
- output grain
- max cardinality
- exact/approx metrics
- timeout
- memory limit
- fallback behavior
```

Ini jauh lebih defensible daripada raw SQL builder bebas.

### 27.3 Always Add Tenant and Time Guardrails

Untuk multi-tenant analytics:

```sql
WHERE tenant_id = {tenantId}
  AND event_time >= {from}
  AND event_time <  {to}
```

Jangan biarkan query dashboard tanpa time range default.

Default aman:

```text
last 24 hours / last 7 days / last 30 days
```

tergantung use case.

### 27.4 Stream Results for Large Exports

Untuk export endpoint:

- jangan load semua result ke heap;
- stream dari ClickHouse ke response/file;
- gunakan format efisien;
- terapkan limit dan async export job;
- log query_id;
- pisahkan dari interactive dashboard workload.

---

## 28. Common Anti-Patterns

### Anti-Pattern 1 — Tuning Query Tanpa Melihat `read_rows` / `read_bytes`

Jika tidak tahu berapa data yang dibaca, kamu belum diagnosis.

### Anti-Pattern 2 — Mengira `LIMIT` Membatasi Scan

```sql
ORDER BY something_not_in_storage_order
LIMIT 100
```

bisa tetap scan besar.

### Anti-Pattern 3 — Function Wrapping di Kolom Sorting Key

Buruk:

```sql
WHERE toDate(event_time) = today()
```

Lebih baik:

```sql
WHERE event_time >= today()
  AND event_time < today() + INTERVAL 1 DAY
```

### Anti-Pattern 4 — `SELECT *` di Analytics API

Membaca kolom besar yang tidak diperlukan.

### Anti-Pattern 5 — JSON Extraction sebagai Main Query Path

Jika field sering difilter/group, jadikan kolom fisik.

### Anti-Pattern 6 — GROUP BY High-Cardinality Tanpa Batas

```sql
GROUP BY request_id
```

sering bukan analytics, tapi log retrieval.

### Anti-Pattern 7 — Join Besar Karena Model Terlalu Normalized

ClickHouse bisa join, tetapi OLAP model harus mempertimbangkan denormalization/dictionary/serving table.

### Anti-Pattern 8 — Menganggap Distributed Table Gratis

Distributed query bisa memperbesar network/coordinator cost.

### Anti-Pattern 9 — Mengandalkan Settings untuk Menyelamatkan Desain Buruk

Settings adalah guardrail/tuning layer, bukan pengganti schema dan query shape.

### Anti-Pattern 10 — Tidak Menyimpan `query_id` di Application Logs

Tanpa `query_id`, sulit menghubungkan request API dengan `system.query_log`.

---

## 29. Production Query Review Checklist

Sebelum query menjadi bagian dari dashboard/API production, jawab:

### 29.1 Query Shape

- [ ] Apa output grain query ini?
- [ ] Apa metric yang dihitung?
- [ ] Apa dimensions yang dipakai?
- [ ] Apakah query interactive atau export?
- [ ] Apakah exactness diperlukan?

### 29.2 Filter

- [ ] Apakah ada tenant filter?
- [ ] Apakah ada time range?
- [ ] Apakah filter memakai kolom fisik?
- [ ] Apakah filter selaras sorting key?
- [ ] Apakah ada function wrapping pada key column?

### 29.3 Columns

- [ ] Apakah query hanya membaca kolom yang perlu?
- [ ] Apakah menghindari `SELECT *`?
- [ ] Apakah kolom besar hanya dibaca saat perlu?

### 29.4 Aggregation

- [ ] Berapa estimasi cardinality group key?
- [ ] Apakah aggregate state besar?
- [ ] Apakah exact distinct diperlukan?
- [ ] Apakah perlu rollup/materialized view?

### 29.5 Sort/Limit

- [ ] Apakah sort global besar?
- [ ] Apakah `LIMIT` benar-benar mengurangi work?
- [ ] Apakah sort bisa dilakukan setelah aggregation kecil?

### 29.6 Distributed

- [ ] Apakah query fan-out ke semua shard?
- [ ] Apakah intermediate result besar?
- [ ] Apakah coordinator bottleneck?
- [ ] Apakah shard key selaras query?

### 29.7 Runtime Safety

- [ ] Timeout ditentukan?
- [ ] Memory limit ditentukan?
- [ ] Max rows/result guardrail ada?
- [ ] Query id dilog?
- [ ] Slow query observable?

---

## 30. Practical SQL Snippets for Investigation

### 30.1 Query Log Slowest Queries

```sql
SELECT
    event_time,
    query_duration_ms,
    read_rows,
    formatReadableSize(read_bytes) AS read_size,
    result_rows,
    formatReadableSize(result_bytes) AS result_size,
    formatReadableSize(memory_usage) AS memory,
    query_id,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time >= now() - INTERVAL 1 HOUR
ORDER BY query_duration_ms DESC
LIMIT 20;
```

### 30.2 Queries with High Read Amplification

```sql
SELECT
    query_duration_ms,
    read_rows,
    result_rows,
    round(read_rows / greatest(result_rows, 1), 2) AS read_to_result_ratio,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time >= now() - INTERVAL 1 HOUR
  AND read_rows > 1000000
ORDER BY read_to_result_ratio DESC
LIMIT 20;
```

### 30.3 Queries with High Memory

```sql
SELECT
    event_time,
    query_duration_ms,
    formatReadableSize(memory_usage) AS memory,
    read_rows,
    result_rows,
    query_id,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time >= now() - INTERVAL 1 HOUR
ORDER BY memory_usage DESC
LIMIT 20;
```

### 30.4 Currently Running Queries

```sql
SELECT
    elapsed,
    read_rows,
    formatReadableSize(read_bytes) AS read_size,
    formatReadableSize(memory_usage) AS memory,
    query_id,
    query
FROM system.processes
ORDER BY elapsed DESC;
```

### 30.5 Explain Index Usage

```sql
EXPLAIN indexes = 1
SELECT
    action_type,
    count()
FROM case_events
WHERE tenant_id = 'tenant-a'
  AND event_time >= '2026-06-01 00:00:00'
  AND event_time <  '2026-06-08 00:00:00'
GROUP BY action_type;
```

### 30.6 Explain Pipeline

```sql
EXPLAIN PIPELINE
SELECT
    action_type,
    count()
FROM case_events
WHERE tenant_id = 'tenant-a'
  AND event_time >= '2026-06-01 00:00:00'
  AND event_time <  '2026-06-08 00:00:00'
GROUP BY action_type;
```

---

## 31. How to Think Like a Query Execution Engineer

Saat melihat query, jangan hanya lihat syntax. Ubah menjadi pertanyaan execution:

### 31.1 What must be read?

```text
Columns?
Parts?
Granules?
Compressed bytes?
```

### 31.2 What can be skipped?

```text
Partitions?
Granules via primary index?
Skip indexes?
Columns?
```

### 31.3 What must be computed?

```text
Expressions?
JSON parsing?
Regex?
Date bucketing?
Hashing?
```

### 31.4 What state must be held?

```text
Aggregation hash table?
Join hash table?
Sort buffer?
Distinct set?
Quantile state?
```

### 31.5 What must be moved?

```text
Between processors?
Between threads?
Between shards?
From server to client?
```

### 31.6 What must be serialized?

```text
Native format?
JSON?
CSV?
Parquet?
HTTP response?
Java objects?
```

Query performance is the sum of all these costs.

---

## 32. Exercises

### Exercise 1 — Classify Query Cost

Given table:

```sql
ORDER BY (tenant_id, event_time, action_type)
PARTITION BY toYYYYMM(event_time)
```

Classify these queries as likely efficient or expensive. Explain why.

#### Query A

```sql
SELECT action_type, count()
FROM events
WHERE tenant_id = 't1'
  AND event_time >= now() - INTERVAL 7 DAY
GROUP BY action_type;
```

#### Query B

```sql
SELECT user_id, count()
FROM events
WHERE action_type = 'CLICK'
GROUP BY user_id
ORDER BY count() DESC
LIMIT 100;
```

#### Query C

```sql
SELECT *
FROM events
WHERE JSONExtractString(payload, 'campaign') = 'x'
LIMIT 100;
```

#### Query D

```sql
SELECT toDate(event_time), count()
FROM events
WHERE tenant_id = 't1'
GROUP BY toDate(event_time);
```

Questions:

1. Which query aligns with sorting key?
2. Which query risks reading too many granules?
3. Which query reads too many columns?
4. Which query has high-cardinality aggregation?
5. Which query should be redesigned with materialized columns or rollups?

### Exercise 2 — Rewrite for Better Data Skipping

Rewrite:

```sql
SELECT count()
FROM events
WHERE toDate(event_time) = '2026-06-01'
  AND tenant_id = 'tenant-a';
```

Expected rewrite:

```sql
SELECT count()
FROM events
WHERE tenant_id = 'tenant-a'
  AND event_time >= '2026-06-01 00:00:00'
  AND event_time <  '2026-06-02 00:00:00';
```

Explain why.

### Exercise 3 — Design API Guardrails

For a dashboard endpoint:

```text
GET /analytics/cases/group-by?dimension=...&from=...&to=...
```

Define:

1. Allowed dimensions.
2. Max time range per dimension.
3. Max output rows.
4. Exact vs approximate metric policy.
5. Timeout.
6. Query id logging.
7. Fallback behavior.

### Exercise 4 — Investigate a Slow Query

Given runtime:

```text
query_duration_ms = 45000
read_rows = 12,000,000,000
result_rows = 120
memory_usage = 700 MB
```

What does this suggest?

Possible answer:

- query is scan-heavy;
- memory is not main issue;
- result is tiny but read volume huge;
- check sorting key/filter/partition/data skipping;
- maybe query needs rollup or projection.

### Exercise 5 — Investigate Memory Explosion

Given runtime:

```text
query_duration_ms = 30000
read_rows = 200,000,000
result_rows = 80,000,000
memory_usage = 50 GB
```

What does this suggest?

Possible answer:

- high-cardinality aggregation or sort;
- output too large;
- query may not be appropriate for interactive dashboard;
- need pre-aggregation, limit dimensions, export path, or approximate metric.

---

## 33. What This Part Deliberately Does Not Cover Deeply

Agar tidak terlalu melebar, part ini belum membahas detail penuh:

1. Aggregation algorithms secara mendalam.
2. Join algorithms secara mendalam.
3. Projection selection secara mendalam.
4. Distributed query consistency/failover.
5. Query cache/result cache.
6. Workload isolation.
7. Cluster-level resource governance.
8. Advanced settings tuning.

Topik-topik itu akan muncul di part berikutnya.

---

## 34. Summary

Query execution ClickHouse harus dipahami sebagai pipeline fisik, bukan sekadar SQL abstraction.

Tahapan utamanya:

```text
SQL text
  -> parser
  -> AST
  -> analyzer
  -> query plan
  -> optimizer
  -> execution pipeline
  -> processors
  -> result stream
```

Hal terpenting:

1. Parser membuat AST.
2. Analyzer resolve nama, tipe, fungsi, alias, dan semantic query.
3. Query plan menjelaskan operasi logis.
4. Pipeline menjelaskan eksekusi fisik dan parallelism.
5. MergeTree read path membaca kolom, part, mark, dan granule yang diperlukan.
6. Column pruning dan data skipping adalah sumber efisiensi utama.
7. Aggregation cost ditentukan oleh cardinality dan state size.
8. Sorting dan join bisa menjadi bottleneck besar.
9. Distributed query menambah network dan coordinator cost.
10. Result serialization/client consumption bisa menjadi bottleneck di Java service.
11. Diagnosis query harus dimulai dari fakta: `read_rows`, `read_bytes`, `memory_usage`, `result_rows`, `EXPLAIN`, dan `system.query_log`.

Mental model akhir:

> Query cepat bukan query yang terlihat pendek. Query cepat adalah query yang membuat pipeline membaca sedikit data relevan, menghitung state kecil, menjalankan transform paralel secara seimbang, dan mengirim output yang memang dibutuhkan.

---

## 35. Referensi

Referensi utama untuk pendalaman:

1. ClickHouse Docs — Understanding query execution with the analyzer.  
   `https://clickhouse.com/docs/guides/developer/understanding-query-execution-with-the-analyzer`
2. ClickHouse Docs — EXPLAIN Statement.  
   `https://clickhouse.com/docs/sql-reference/statements/explain`
3. ClickHouse Docs — Query optimization guide.  
   `https://clickhouse.com/docs/optimize/query-optimization`
4. ClickHouse Docs — How ClickHouse executes a query in parallel.  
   `https://clickhouse.com/docs/optimize/query-parallelism`
5. ClickHouse Docs — Architecture overview / development architecture.  
   `https://clickhouse.com/docs/development/architecture`
6. ClickHouse Docs — Academic overview.  
   `https://clickhouse.com/docs/academic_overview`
7. ClickHouse Docs — MergeTree table engine.  
   `https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree`
8. ClickHouse Docs — System table `query_log`.  
   `https://clickhouse.com/docs/operations/system-tables/query_log`
9. ClickHouse Docs — System table `query_metric_log`.  
   `https://clickhouse.com/docs/operations/system-tables/query_metric_log`
10. ClickHouse Docs — System table `asynchronous_metrics`.  
   `https://clickhouse.com/docs/operations/system-tables/asynchronous_metrics`

---

## 36. Status Seri

Part ini adalah:

```text
Part 012 dari 034
```

Seri belum selesai. Part berikutnya:

```text
Part 013 — Aggregation Deep Dive: GROUP BY, States, Approximation, and Memory
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-011.md">⬅️ Part 011 — Ingestion Architecture II: Streaming, CDC, Object Storage, and Batch Loads</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-013.md">Part 013 — Aggregation Deep Dive: GROUP BY, States, Approximation, and Memory ➡️</a>
</div>

# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-016.md

# Query Engine and Execution Mental Model

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Part: 016  
> Fokus: memahami query QuestDB sebagai pekerjaan fisik, bukan sekadar SQL text.  
> Target pembaca: Java software engineer yang ingin mampu mendesain query, API, dashboard, dan storage layout yang performan secara sistemik.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas:

- data model,
- partitioning,
- ingestion,
- WAL,
- deduplication,
- SQL time-series,
- temporal join,
- materialized views.

Sekarang kita masuk ke pertanyaan yang lebih dalam:

> Ketika sebuah query dikirim ke QuestDB, pekerjaan fisik apa yang sebenarnya terjadi?

Ini penting karena engineer yang hanya melihat SQL sebagai teks biasanya berhenti di level:

```sql
SELECT avg(temp)
FROM sensor_readings
WHERE ts >= now() - 1h
SAMPLE BY 1m;
```

Engineer yang lebih matang akan membaca query itu sebagai:

```text
- Berapa partition yang akan disentuh?
- Apakah predicate timestamp memungkinkan pruning?
- Column mana yang perlu dibaca?
- Apakah symbol filter mengurangi row set secara signifikan?
- Apakah group-by memerlukan hash state besar?
- Apakah order-by memaksa materialisasi/sort mahal?
- Apakah query ini berjalan di hot partition yang masih menerima write?
- Apakah hasilnya cocok diambil dari raw table atau materialized view?
- Apakah API membatasi range agar user tidak men-scan 2 tahun data?
```

Tujuan part ini:

1. Membangun mental model query execution di QuestDB.
2. Membaca query dari sisi cost fisik.
3. Memahami peran partition pruning, columnar scan, symbol lookup, grouping, sorting, join, dan memory.
4. Membuat design rule untuk Java API agar query tetap bounded.
5. Menghindari anti-pattern yang membuat QuestDB terlihat lambat padahal query/app-nya yang salah bentuk.

---

## 2. Core Mental Model

Query engine time-series tidak boleh dipahami seperti “database mengeksekusi SQL”. Itu terlalu abstrak.

Model yang lebih berguna:

```text
query cost = time range touched
           × columns read
           × rows surviving filters
           × grouping/join/sort state
           × memory/cache behavior
           × concurrency pressure
```

Untuk QuestDB, axis paling penting biasanya:

```text
time range -> partition pruning -> column scan -> temporal operators -> result materialization
```

Bentuk ringkasnya:

```text
SQL text
  -> parse/compile
  -> identify timestamp constraints
  -> prune partitions
  -> select columns
  -> scan relevant column files/pages
  -> apply filters
  -> aggregate/join/sort/sample/latest
  -> stream/materialize result
```

Hal yang harus diingat:

> Time-series performance paling sering menang bukan karena “index semua hal”, tetapi karena query diarahkan ke rentang waktu kecil, kolom sedikit, dan operasi temporal yang cocok dengan layout fisik.

---

## 3. QuestDB Query Engine in One Picture

Secara konseptual, query QuestDB melewati lapisan berikut:

```text
Client
  |
  | SQL over PGWire / HTTP console / REST query
  v
SQL parser + compiler
  |
  | resolve tables, columns, timestamp, functions
  v
Query plan
  |
  | partition pruning, filter placement, join strategy, aggregation shape
  v
Execution engine
  |
  | column scan, symbol lookup, temporal operator, aggregation, sort
  v
Storage engine
  |
  | native table files, partitions, columns, symbol dictionaries, page cache
  v
Result streaming/materialization
```

Di sisi Java, biasanya query masuk melalui:

```text
Java service
  -> JDBC/PostgreSQL driver
  -> QuestDB PGWire
  -> SQL compiler/executor
  -> result set
  -> DTO/API response
```

Jangan campur mental model ingestion dan query:

```text
ILP path  : optimized for writes
PGWire    : optimized for SQL query interoperability
Storage   : optimized for time-partitioned columnar reads
```

---

## 4. The Most Important Optimization: Ask Less Data

Banyak engineer terlalu cepat mencari “index apa yang harus dibuat?”.

Untuk time-series, pertanyaan pertama seharusnya:

```text
Apakah query ini membaca time range yang memang perlu dibaca?
```

Contoh buruk:

```sql
SELECT device_id, avg(temperature)
FROM sensor_readings
WHERE site = 'plant-17'
GROUP BY device_id;
```

Masalahnya:

```text
Tidak ada batas waktu.
```

Query ini secara semantik mungkin berarti:

```text
Hitung rata-rata semua waktu sejak awal sejarah.
```

Itu hampir selalu bukan maksud user.

Lebih baik:

```sql
SELECT device_id, avg(temperature)
FROM sensor_readings
WHERE ts >= dateadd('h', -6, now())
  AND site = 'plant-17'
GROUP BY device_id;
```

Atau untuk dashboard:

```sql
SELECT device_id, avg(temperature)
FROM sensor_readings
WHERE ts >= $from
  AND ts <  $to
  AND site = $site
GROUP BY device_id;
```

Production invariant:

> Hampir semua query API time-series harus memiliki bounded time range.

Kecuali:

- metadata query,
- `LATEST ON` untuk current state,
- carefully designed admin/reporting query,
- query terhadap materialized view yang memang kecil.

---

## 5. Partition Pruning: Query Cost Boundary Pertama

Partition pruning adalah kemampuan engine untuk melewati partisi waktu yang tidak relevan.

Misalnya table `trades` dipartisi per hari:

```sql
CREATE TABLE trades (
    ts TIMESTAMP,
    symbol SYMBOL,
    price DOUBLE,
    size LONG
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Jika query:

```sql
SELECT avg(price)
FROM trades
WHERE ts >= '2026-06-01T00:00:00Z'
  AND ts <  '2026-06-02T00:00:00Z';
```

Engine secara konseptual hanya perlu menyentuh partition:

```text
2026-06-01
```

Bukan semua partition.

Jika query:

```sql
SELECT avg(price)
FROM trades
WHERE symbol = 'AAPL';
```

Meskipun ada filter symbol, tidak ada time range. Engine tidak bisa tahu partisi waktu mana yang tidak relevan hanya dari symbol.

Cost-nya bisa menjadi:

```text
scan semua partition -> filter symbol -> aggregate
```

Design rule:

```text
time predicate dulu secara desain API, bukan sekadar urutan teks SQL.
```

---

## 6. Predicate Shape: Query yang Sama Secara Logika Bisa Berbeda Secara Fisik

Query berikut mudah dipahami manusia:

```sql
SELECT *
FROM readings
WHERE date_trunc('day', ts) = '2026-06-21';
```

Tapi bentuk ini buruk karena timestamp column dibungkus function.

Lebih baik:

```sql
SELECT *
FROM readings
WHERE ts >= '2026-06-21T00:00:00Z'
  AND ts <  '2026-06-22T00:00:00Z';
```

Kenapa?

Karena bentuk kedua mengekspresikan interval langsung.

Rule umum:

```text
Jangan membungkus designated timestamp dengan function pada predicate utama.
Gunakan explicit lower/upper bound.
```

Buruk:

```sql
WHERE to_str(ts, 'yyyy-MM-dd') = '2026-06-21'
```

Baik:

```sql
WHERE ts >= '2026-06-21T00:00:00Z'
  AND ts <  '2026-06-22T00:00:00Z'
```

Buruk:

```sql
WHERE extract('hour', ts) = 13
```

Lebih baik untuk query rentang spesifik:

```sql
WHERE ts >= $from
  AND ts <  $to
```

Jika memang butuh analisis “semua jam 13 sepanjang sejarah”, itu workload analitik khusus dan sebaiknya diarahkan ke rollup/materialized view, bukan raw scan sembarangan.

---

## 7. Columnar Scan: Jangan SELECT Kolom yang Tidak Dibutuhkan

QuestDB read path bersifat column-oriented. Konsekuensinya:

```text
Query yang membaca 3 kolom jauh lebih murah daripada membaca 80 kolom.
```

Contoh buruk:

```sql
SELECT *
FROM sensor_readings
WHERE ts >= $from
  AND ts <  $to
  AND device_id = $device;
```

Jika table punya kolom:

```text
ts, tenant_id, site_id, device_id, sensor_id,
temperature, pressure, vibration, rpm, current, voltage,
firmware_version, quality, source, unit, ingestion_ts, ...
```

`SELECT *` memaksa engine/client membaca dan mengirim lebih banyak data daripada perlu.

Lebih baik:

```sql
SELECT ts, temperature, pressure
FROM sensor_readings
WHERE ts >= $from
  AND ts <  $to
  AND device_id = $device
ORDER BY ts;
```

Design rule untuk Java API:

```text
Endpoint harus mendefinisikan projection eksplisit.
Jangan expose generic SELECT * endpoint ke user/dashboard.
```

Bad API shape:

```http
GET /query?sql=SELECT * FROM readings
```

Better API shape:

```http
GET /devices/{deviceId}/temperature?from=...&to=...&resolution=1m
```

Lalu service memilih query yang bounded dan projected.

---

## 8. Symbol Filters: Useful, But Not Magic

`SYMBOL` efektif untuk repetitive string dimensions seperti:

```text
device_id
symbol
exchange
site_id
sensor_type
region
status
```

Tetapi symbol bukan alasan untuk membiarkan query tanpa time range.

Contoh:

```sql
SELECT avg(value)
FROM metrics
WHERE metric = 'cpu_usage'
  AND service = 'payment-api';
```

Masih berbahaya jika tidak ada time range.

Lebih benar:

```sql
SELECT avg(value)
FROM metrics
WHERE ts >= $from
  AND ts <  $to
  AND metric = 'cpu_usage'
  AND service = 'payment-api';
```

Symbol filter berguna untuk memperkecil row set di dalam time range.

Mental model:

```text
Time predicate narrows partitions.
Symbol predicate narrows series within partitions.
Value predicate narrows observations.
```

Urutan desainnya:

```text
1. Time range
2. Series identity / symbol filters
3. Value filters
4. Aggregation/projection
```

---

## 9. Latest Query Cost Model

`LATEST ON` terlihat sederhana:

```sql
SELECT *
FROM readings
LATEST ON ts PARTITION BY device_id;
```

Semantiknya:

```text
Ambil row terbaru per device_id.
```

Tetapi secara cost, pertanyaan penting:

```text
Berapa banyak series/device?
Berapa banyak partition yang perlu diperiksa?
Apakah ada filter tenant/site?
Apakah current state lebih cocok disimpan di serving table/materialized view?
```

Lebih baik jika dibatasi:

```sql
SELECT *
FROM readings
WHERE tenant_id = $tenant
LATEST ON ts PARTITION BY device_id;
```

Untuk dashboard “current state semua device site X”:

```sql
SELECT device_id, temperature, pressure, ts
FROM readings
WHERE site_id = $site
LATEST ON ts PARTITION BY device_id;
```

Jika jumlah device sangat besar dan query sangat sering, pertimbangkan:

```text
raw table -> current_state serving table/materialized projection
```

Decision rule:

```text
LATEST ON cocok untuk latest state query.
Tetapi high-QPS current-state API mungkin butuh serving projection.
```

---

## 10. SAMPLE BY Cost Model

Query umum:

```sql
SELECT ts, avg(temperature)
FROM readings
WHERE device_id = $device
  AND ts >= $from
  AND ts <  $to
SAMPLE BY 1m;
```

Cost ditentukan oleh:

```text
- jumlah row dalam range,
- jumlah bucket,
- jumlah series/group,
- fill strategy,
- calendar/timezone alignment,
- apakah query memakai raw table atau materialized view.
```

Misalnya user meminta grafik 30 hari resolusi 1 detik:

```text
30 hari × 24 jam × 3600 detik = 2.592.000 bucket
```

Itu terlalu banyak untuk UI biasa.

Dashboard harus punya resolution policy:

```text
range <= 1h      -> 1s bucket
range <= 24h     -> 1m bucket
range <= 30d     -> 15m bucket
range <= 1y      -> 1h / 1d bucket
```

Java API sebaiknya tidak menerima arbitrary `sampleBy` tanpa guardrail.

Contoh policy:

```java
Duration chooseBucket(Duration range, int maxPoints) {
    long targetMillis = Math.max(1, range.toMillis() / maxPoints);
    if (targetMillis <= 1_000) return Duration.ofSeconds(1);
    if (targetMillis <= 60_000) return Duration.ofMinutes(1);
    if (targetMillis <= 900_000) return Duration.ofMinutes(15);
    if (targetMillis <= 3_600_000) return Duration.ofHours(1);
    return Duration.ofDays(1);
}
```

Query engine tidak boleh menjadi korban UI yang meminta resolusi tidak realistis.

---

## 11. GROUP BY: State Size Matters

Aggregation bukan cuma membaca row. Ia juga membuat state.

Contoh:

```sql
SELECT device_id, avg(temperature)
FROM readings
WHERE ts >= $from
  AND ts <  $to
GROUP BY device_id;
```

State kira-kira:

```text
satu aggregate state per device_id
```

Jika device 10.000, masih masuk akal.

Jika group by:

```sql
GROUP BY tenant_id, site_id, device_id, sensor_id, firmware_version, error_code
```

State bisa meledak.

Danger sign:

```text
high-cardinality group-by over long range
```

Lebih buruk:

```sql
SELECT user_id, session_id, request_id, avg(latency)
FROM app_metrics
WHERE ts >= $from
  AND ts < $to
GROUP BY user_id, session_id, request_id;
```

Ini biasanya bukan time-series metric query yang sehat. Itu mendekati event analytics/high-cardinality tracing workload.

Rule:

```text
Group-by dimensions harus punya cardinality budget.
```

Untuk API:

```text
- whitelist group-by dimension,
- batasi jumlah group,
- batasi range,
- gunakan top-K jika perlu,
- gunakan materialized view untuk high-QPS aggregate.
```

---

## 12. ORDER BY and LIMIT: Jangan Salah Membaca Murah/Mahal

Query:

```sql
SELECT *
FROM readings
WHERE ts >= $from
  AND ts <  $to
ORDER BY ts DESC
LIMIT 100;
```

Bisa masuk akal untuk recent event feed.

Tapi query:

```sql
SELECT *
FROM readings
WHERE site_id = $site
ORDER BY temperature DESC
LIMIT 100;
```

Tanpa time range, ini bisa berarti:

```text
Cari 100 temperature tertinggi sepanjang sejarah site.
```

Mahal.

Time-series top-N harus hampir selalu dibatasi waktu:

```sql
SELECT device_id, temperature, ts
FROM readings
WHERE site_id = $site
  AND ts >= dateadd('h', -1, now())
ORDER BY temperature DESC
LIMIT 100;
```

Rule:

```text
LIMIT tidak otomatis membuat query murah jika engine tetap harus membaca banyak data untuk menentukan top result.
```

---

## 13. JOIN Cost Model

Temporal join sudah dibahas di part 014. Sekarang kita lihat cost fisiknya.

`ASOF JOIN` contoh:

```sql
SELECT t.ts, t.symbol, t.price, q.bid, q.ask
FROM trades t
ASOF JOIN quotes q
ON t.symbol = q.symbol
WHERE t.ts >= $from
  AND t.ts <  $to;
```

Pertanyaan cost:

```text
- Berapa banyak row kiri?
- Berapa banyak row kanan yang relevan?
- Apakah kedua stream sama-sama punya time locality?
- Apakah join key cardinality wajar?
- Apakah ada tolerance/staleness bound?
- Apakah hasil join sangat besar?
```

Anti-pattern:

```sql
SELECT ...
FROM huge_events e
ASOF JOIN huge_state s
ON e.entity_id = s.entity_id;
```

Tanpa time range.

Better:

```sql
SELECT ...
FROM huge_events e
ASOF JOIN huge_state s
ON e.entity_id = s.entity_id
WHERE e.ts >= $from
  AND e.ts <  $to;
```

Lebih baik lagi jika business semantics punya tolerance:

```text
state older than 5 minutes is invalid
```

Jika engine/operator mendukung ekspresi window/tolerance dalam bentuk yang sesuai, gunakan. Jika tidak, filter hasil join dengan age delta.

Production rule:

```text
Join antar-stream harus punya bounded left side.
```

---

## 14. Result Materialization: Query Murah Bisa Jadi Mahal Karena Output

Kadang scan-nya tidak buruk, tetapi output-nya besar.

Contoh:

```sql
SELECT ts, device_id, temperature
FROM readings
WHERE site_id = $site
  AND ts >= $from
  AND ts <  $to;
```

Jika site punya 100.000 device dan range 24 jam, result bisa jutaan row.

Problem:

```text
- database harus mengirim banyak data,
- network besar,
- Java service memory pressure,
- JSON serialization mahal,
- browser tidak sanggup render,
- user tidak bisa memahami result.
```

Rule:

```text
A query is not production-safe just because database can execute it.
The result must also be consumable.
```

API guardrail:

```text
- max rows,
- mandatory aggregation for wide range,
- pagination by time cursor,
- response compression,
- binary/CSV export for offline use,
- async export path for huge data.
```

Bad:

```http
GET /readings?site=plant-17&from=2025-01-01&to=2026-01-01
```

Good split:

```text
/dashboard/summary -> aggregate/materialized view
/readings/export   -> async export job
/readings/window   -> bounded short range
```

---

## 15. Memory Model: Hash State, Sort State, Join State, Result Buffers

QuestDB uses native memory and OS/page-cache behavior heavily. Dari sudut pandang Java engineer, ini berarti:

```text
Container memory bukan hanya JVM heap.
```

Di sisi query, memory pressure bisa datang dari:

```text
- large group-by state,
- large sort/top-N state,
- large join state,
- result materialization,
- many concurrent queries,
- high-cardinality symbol operations,
- cold scans causing page cache churn.
```

Contoh query risk tinggi:

```sql
SELECT customer_id, session_id, request_id, avg(latency)
FROM request_metrics
WHERE ts >= dateadd('d', -30, now())
GROUP BY customer_id, session_id, request_id;
```

Risk:

```text
huge group cardinality + long range + likely not useful for UI
```

Better:

```sql
SELECT service, endpoint, status, avg(latency), max(latency)
FROM request_metrics_1m
WHERE ts >= dateadd('h', -6, now())
GROUP BY service, endpoint, status;
```

Where `request_metrics_1m` is materialized/rollup.

---

## 16. Page Cache and Cold vs Warm Query

QuestDB’s storage interaction depends heavily on filesystem/page cache behavior.

Mental model:

```text
Warm query:
  relevant pages already in OS cache -> fast

Cold query:
  pages must be read from disk/object tier -> slower
```

This explains why benchmark results vary:

```text
same SQL + warm cache != same SQL + cold cache
```

Operational implication:

```text
- Recent dashboard usually fast because hot partitions are cache-warm.
- Rare historical query may be slower.
- Backfill can evict useful cache pages.
- Heavy ad-hoc query can affect live dashboards.
```

Production architecture pattern:

```text
Live query workload      -> recent partitions / materialized views
Historical exploration   -> separate user/API limits
Backfill/replay          -> scheduled with throttling
Heavy export             -> async path
```

---

## 17. Concurrency: Banyak Query Sedang-Sedang Bisa Lebih Buruk dari Satu Query Besar

QuestDB performance juga dipengaruhi concurrency.

Contoh:

```text
100 dashboard panels
× each refresh every 5 seconds
× each panel queries raw table for last 24h
```

Itu bisa menciptakan query storm.

Masalahnya bukan satu query, tetapi workload aggregate:

```text
query_rate × scanned_rows × result_size × concurrency
```

Dashboard design rule:

```text
Dashboard is a workload generator, not just UI.
```

Mitigation:

```text
- combine panels where possible,
- use materialized views,
- use cache at API layer for short TTL,
- increase refresh interval,
- restrict default range,
- precompute common rollups,
- separate admin exploration from operational dashboard.
```

Java service can add:

```text
- request coalescing,
- per-tenant query budget,
- circuit breaker,
- query timeout,
- max rows,
- max range,
- concurrency limit by endpoint.
```

---

## 18. Query Shapes: Good, Risky, Dangerous

### 18.1 Good Query Shape

```sql
SELECT ts, avg(cpu)
FROM metrics
WHERE ts >= $from
  AND ts <  $to
  AND service = $service
  AND host = $host
SAMPLE BY 1m;
```

Why good:

```text
- bounded time range,
- clear series filters,
- limited projection,
- aggregation reduces output,
- bucket size explicit.
```

### 18.2 Risky Query Shape

```sql
SELECT service, endpoint, avg(latency)
FROM http_metrics
WHERE ts >= dateadd('d', -30, now())
GROUP BY service, endpoint;
```

Why risky:

```text
- long range,
- potentially many groups,
- maybe should use rollup.
```

### 18.3 Dangerous Query Shape

```sql
SELECT *
FROM http_metrics
WHERE user_id = $user;
```

Why dangerous:

```text
- no time range,
- high-cardinality filter,
- wide projection,
- unbounded result.
```

### 18.4 Misleading LIMIT Query

```sql
SELECT *
FROM readings
ORDER BY temperature DESC
LIMIT 10;
```

Why dangerous:

```text
- LIMIT does not avoid reading large data if global top-N must be computed.
```

---

## 19. Explainability Without EXPLAIN: Practical Query Review Checklist

Even when you do not inspect a formal plan, you can review a query manually.

Ask:

```text
1. What table is read?
2. What is the designated timestamp?
3. Is there a bounded timestamp predicate?
4. How many partitions will be touched?
5. Which columns are read?
6. Are symbol filters selective and bounded by time?
7. Is there GROUP BY? What is max group cardinality?
8. Is there SAMPLE BY? How many buckets?
9. Is there JOIN? How large is left side?
10. Is there ORDER BY? Does it require global sort/top-N?
11. How many rows can result contain?
12. Is this raw, rollup, or serving query?
13. What happens if a tenant has 10x more data?
14. What happens if the UI refreshes this every 5 seconds?
15. What timeout/limit protects the system?
```

This checklist is often more useful than blindly looking for an index.

---

## 20. Java API Query Guardrails

A QuestDB-backed Java API should not expose arbitrary SQL unless it is an internal/admin tool with strong controls.

Recommended guardrails:

```text
- require from/to for most endpoints,
- enforce max range by endpoint,
- enforce max bucket count,
- enforce max rows,
- whitelist group-by dimensions,
- whitelist order-by fields,
- prefer prepared statements / parameter binding,
- map product use cases to known query templates,
- route large export to async jobs,
- apply per-tenant query budget,
- record query latency and scanned range metadata,
- reject raw SELECT * in public endpoints.
```

Example API contract:

```java
public record TimeSeriesQueryRequest(
    Instant from,
    Instant to,
    String tenantId,
    String deviceId,
    List<String> metrics,
    Duration requestedResolution
) {}
```

Validation:

```java
void validate(TimeSeriesQueryRequest request) {
    if (!request.from().isBefore(request.to())) {
        throw new IllegalArgumentException("from must be before to");
    }

    Duration range = Duration.between(request.from(), request.to());

    if (range.compareTo(Duration.ofDays(30)) > 0) {
        throw new IllegalArgumentException("range too large for interactive query");
    }

    if (request.metrics().size() > 10) {
        throw new IllegalArgumentException("too many metrics requested");
    }
}
```

Query template:

```sql
SELECT ts, avg(value)
FROM device_metrics
WHERE tenant_id = ?
  AND device_id = ?
  AND metric IN (?)
  AND ts >= ?
  AND ts <  ?
SAMPLE BY ?;
```

Important: not every JDBC driver supports parameterizing interval syntax cleanly. In production, bucket duration may need whitelist mapping to generated SQL fragments.

Safe pattern:

```java
enum Bucket {
    S1("1s"),
    M1("1m"),
    M15("15m"),
    H1("1h"),
    D1("1d");

    final String sqlLiteral;

    Bucket(String sqlLiteral) {
        this.sqlLiteral = sqlLiteral;
    }
}
```

Never concatenate arbitrary user string into SQL.

---

## 21. Query Templates for Common Patterns

### 21.1 Recent Raw Series

Use when:

```text
- short range,
- few series,
- user needs raw points.
```

```sql
SELECT ts, value
FROM device_metrics
WHERE tenant_id = $tenant
  AND device_id = $device
  AND metric = $metric
  AND ts >= $from
  AND ts <  $to
ORDER BY ts;
```

### 21.2 Aggregated Chart

Use when:

```text
- UI chart,
- longer range,
- fixed max point count.
```

```sql
SELECT ts, avg(value) AS avg_value
FROM device_metrics
WHERE tenant_id = $tenant
  AND device_id = $device
  AND metric = $metric
  AND ts >= $from
  AND ts <  $to
SAMPLE BY 1m FILL(NULL);
```

### 21.3 Current State

```sql
SELECT device_id, value, ts
FROM device_metrics
WHERE tenant_id = $tenant
  AND site_id = $site
  AND metric = 'temperature'
LATEST ON ts PARTITION BY device_id;
```

### 21.4 Top-N Recent Anomalies

```sql
SELECT ts, device_id, value
FROM device_metrics
WHERE tenant_id = $tenant
  AND metric = 'temperature'
  AND ts >= dateadd('h', -1, now())
  AND value > $threshold
ORDER BY value DESC
LIMIT 100;
```

### 21.5 Rollup-backed Dashboard

```sql
SELECT ts, avg_value, max_value
FROM device_metrics_1m
WHERE tenant_id = $tenant
  AND site_id = $site
  AND metric = $metric
  AND ts >= $from
  AND ts <  $to
ORDER BY ts;
```

---

## 22. Anti-Patterns

### Anti-pattern 1: Treating QuestDB Like PostgreSQL with a Timestamp Column

Bad assumption:

```text
I can model arbitrary business entities and query them by any field later.
```

Correct framing:

```text
QuestDB is strongest when the primary access path is temporal.
```

### Anti-pattern 2: SELECT * in API Endpoints

Bad:

```sql
SELECT * FROM readings WHERE ts >= $from AND ts < $to;
```

Correct:

```sql
SELECT ts, device_id, temperature FROM readings ...
```

### Anti-pattern 3: Unbounded “Latest Everything”

Bad:

```sql
SELECT * FROM metrics LATEST ON ts PARTITION BY host, metric;
```

For enormous cardinality, this can be a heavy “current state of everything” query.

Correct:

```sql
WHERE tenant_id = $tenant AND service = $service
LATEST ON ts PARTITION BY host, metric
```

Or maintain serving projection.

### Anti-pattern 4: Dashboard Query Directly on Raw Table for Every Panel

Bad:

```text
Every dashboard panel scans raw high-frequency table.
```

Correct:

```text
Raw table for forensic/detail.
Materialized view for dashboard.
Serving projection for current state.
```

### Anti-pattern 5: Believing LIMIT Saves Unbounded Query

Bad:

```sql
SELECT * FROM readings ORDER BY value DESC LIMIT 10;
```

Correct:

```sql
SELECT * FROM readings
WHERE ts >= dateadd('h', -1, now())
ORDER BY value DESC
LIMIT 10;
```

### Anti-pattern 6: High-Cardinality GROUP BY Over Long Range

Bad:

```sql
GROUP BY user_id, request_id, session_id
```

Correct:

```text
Use lower-cardinality dimensions, rollups, or route to another analytics system if the question is not time-series serving.
```

### Anti-pattern 7: Letting UI Decide Query Resolution Directly

Bad:

```text
User picks 1s bucket for 1 year range.
```

Correct:

```text
API chooses allowed bucket based on range and max points.
```

---

## 23. Failure Modes

### 23.1 Query Storm

Symptom:

```text
Dashboard refresh causes latency spike.
```

Likely causes:

```text
- too many panels,
- raw scans,
- no caching,
- no materialized views,
- refresh interval too aggressive.
```

Mitigation:

```text
- rollups,
- API cache,
- combine queries,
- throttle concurrency,
- increase refresh interval.
```

### 23.2 Historical Query Evicts Hot Cache

Symptom:

```text
Recent dashboard slows after someone runs large historical export.
```

Mitigation:

```text
- async export,
- separate heavy query window,
- resource governance,
- read replica if available/appropriate,
- cold/historical query policy.
```

### 23.3 GROUP BY Memory Blow-up

Symptom:

```text
Query fails or system memory pressure increases.
```

Cause:

```text
High-cardinality aggregation state.
```

Mitigation:

```text
- limit group dimensions,
- shorter range,
- pre-aggregate,
- top-K pattern,
- deny unsafe query via API.
```

### 23.4 Huge Result Set

Symptom:

```text
Database query completes, but API times out or browser crashes.
```

Cause:

```text
Result materialization/serialization/rendering too large.
```

Mitigation:

```text
- max rows,
- aggregation,
- pagination,
- async export,
- binary/CSV download path.
```

### 23.5 Query Correct but Semantically Wrong

Example:

```sql
SELECT avg(cpu)
FROM metrics
WHERE ts >= now() - 1h;
```

Problem:

```text
now() anchored to query time, not dashboard selected interval or business event time.
```

Mitigation:

```text
- use explicit from/to from API,
- document timestamp semantics,
- test boundary cases.
```

---

## 24. Production Query Review Rubric

Use this before approving any new dashboard/API/query template.

| Dimension | Question | Good Answer |
|---|---|---|
| Time range | Is it bounded? | Yes, with explicit from/to or approved latest pattern |
| Partition pruning | Can engine skip partitions? | Yes, predicate on designated timestamp |
| Projection | Are only needed columns selected? | Yes |
| Cardinality | Are filters/group-by bounded? | Yes, dimension budget known |
| Aggregation | Raw or rollup? | Uses rollup for high-QPS/long-range |
| Output size | Is max result bounded? | Yes |
| Concurrency | What if many users refresh? | Budget/caching/materialized view exists |
| Failure | What if query is slow? | Timeout and degradation path exist |
| Security | Can user inject SQL? | No, template + parameters/whitelist |
| Semantics | Is timestamp meaning correct? | Event time and interval boundaries explicit |

---

## 25. Practical Lab

### Lab 1: Rewrite Unsafe Queries

Rewrite these:

```sql
SELECT * FROM metrics WHERE service = 'checkout';
```

```sql
SELECT host, avg(cpu) FROM metrics GROUP BY host;
```

```sql
SELECT * FROM trades ORDER BY price DESC LIMIT 10;
```

Expected direction:

```sql
SELECT ts, host, cpu
FROM metrics
WHERE service = 'checkout'
  AND ts >= $from
  AND ts <  $to;
```

```sql
SELECT host, avg(cpu)
FROM metrics
WHERE ts >= $from
  AND ts <  $to
GROUP BY host;
```

```sql
SELECT ts, symbol, price, size
FROM trades
WHERE ts >= dateadd('h', -1, now())
ORDER BY price DESC
LIMIT 10;
```

### Lab 2: Build a Query Budget

For each endpoint, define:

```text
- max time range,
- max result rows,
- max bucket count,
- allowed group-by dimensions,
- raw vs rollup source,
- timeout,
- cache TTL,
- fallback behavior.
```

Example:

| Endpoint | Max Range | Source | Max Points | Cache |
|---|---:|---|---:|---:|
| `/device/{id}/chart` | 30 days | raw/rollup auto | 2,000 | 5s |
| `/site/{id}/dashboard` | 7 days | materialized view | 1,000 | 10s |
| `/readings/export` | 1 year | async export | N/A | none |
| `/alerts/recent` | 24h | raw | 500 rows | 2s |

### Lab 3: Query Shape Classification

Classify each query as:

```text
good / risky / dangerous
```

Criteria:

```text
- bounded time?
- projected columns?
- output size?
- group cardinality?
- raw vs rollup?
```

---

## 26. Key Takeaways

1. QuestDB query performance starts with time range discipline.
2. Partition pruning is usually the first and biggest cost reducer.
3. Columnar storage rewards narrow projection.
4. `SYMBOL` filters are useful but do not replace bounded time predicates.
5. `SAMPLE BY`, `LATEST ON`, and temporal joins are powerful when query shape matches time-series access patterns.
6. `LIMIT` does not automatically make unbounded query cheap.
7. GROUP BY cost depends on cardinality and range.
8. Query result size can be the bottleneck even if scan is fast.
9. Java APIs should expose safe query templates, not arbitrary SQL.
10. Dashboards are workload generators and must be designed like production systems.

---

## 27. Mental Model Final

A QuestDB query should be reviewed as:

```text
What time range?
What partitions?
What columns?
What series?
What aggregation/join/sort state?
What output size?
What concurrency?
What failure boundary?
```

The mature engineer does not ask only:

```text
Is this SQL correct?
```

They ask:

```text
Is this query physically bounded, semantically correct, operationally safe, and appropriate for its caller?
```

That is the difference between using QuestDB and engineering with QuestDB.

---

## 28. Next Part

Next:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-017.md
Indexes, Symbols, Cardinality, and Lookup Patterns
```

Part berikutnya akan fokus pada `SYMBOL`, cardinality, indexing/lookup pattern, dan bagaimana mendesain dimension agar query cepat tanpa membuat ingestion/memory rusak.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-015.md">⬅️ Part 015 — Materialized Views and Pre-Aggregation Strategy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-017.md">Indexes, Symbols, Cardinality, and Lookup Patterns ➡️</a>
</div>

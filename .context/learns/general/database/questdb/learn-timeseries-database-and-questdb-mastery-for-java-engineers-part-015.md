# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-015.md

# Part 015 — Materialized Views and Pre-Aggregation Strategy

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Audience: Java software engineer / tech lead  
> Fokus: bagaimana mengubah raw time-series yang sangat besar menjadi query serving layer yang cepat, konsisten, dan operable menggunakan materialized views, rollup hierarchy, dan pre-aggregation strategy di QuestDB.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas SQL time-series: range query, `LATEST ON`, `SAMPLE BY`, dan temporal joins. Itu cukup untuk query eksploratif dan analisis langsung terhadap raw table.

Namun di produksi, raw query tidak selalu boleh menjadi jalur utama untuk dashboard/API.

Problem nyata:

```text
Raw table:
  500k rows/sec
  43.2B rows/day
  retention raw 30 hari

Dashboard:
  refresh setiap 5 detik
  200 pengguna aktif
  query window 24 jam
  grouping by tenant/device/symbol/status
```

Kalau setiap dashboard melakukan raw scan dan aggregate ulang, sistem akan menjadi mahal, lambat, dan tidak predictable.

Part ini bertujuan membuat kamu mampu:

1. membedakan raw query, ad-hoc query, materialized view, rollup table, dan serving table;
2. memahami kapan `SAMPLE BY` langsung cukup dan kapan perlu pre-aggregation;
3. mendesain hierarchy raw → derived → serving;
4. memakai materialized view QuestDB sebagai persisted pre-computation;
5. memahami refresh strategy, lag, invalidation, TTL, dan failure mode;
6. membangun query layer Java yang membaca dari view yang tepat;
7. menghindari anti-pattern seperti dashboard yang selalu scan raw data multi-hari;
8. memahami trade-off correctness, latency, storage, dan operational complexity.

---

## 2. Problem yang Sedang Diselesaikan

Time-series database biasanya menghadapi dua workload yang saling bertentangan:

```text
Write workload:
  high-throughput append
  continuous ingestion
  late arrival
  replay
  burst

Read workload:
  dashboards
  APIs
  alerting
  reporting
  exploratory analysis
```

Read workload sering meminta data dalam bentuk yang berbeda dari raw event.

Raw event:

```text
ts, device_id, metric, value, quality
2026-06-21T10:00:01Z, pump-7, pressure, 42.1, GOOD
2026-06-21T10:00:02Z, pump-7, pressure, 42.3, GOOD
2026-06-21T10:00:03Z, pump-7, pressure, 41.9, GOOD
```

Dashboard biasanya butuh:

```text
per 1 minute:
  avg_pressure
  min_pressure
  max_pressure
  count_samples
  bad_quality_count
```

Reporting mungkin butuh:

```text
per day:
  avg_pressure
  p95_pressure
  uptime_ratio
  missing_sample_count
```

Alerting mungkin butuh:

```text
last 5 minutes:
  moving_avg_pressure
  latest_status
  threshold breach count
```

Kalau semua dihitung dari raw setiap kali query, maka sistem harus membayar biaya compute yang sama berulang-ulang.

Materialized view dan pre-aggregation menyelesaikan problem ini dengan prinsip sederhana:

```text
Do expensive work once.
Reuse the result many times.
```

Tetapi prinsip ini membawa trade-off:

```text
Faster query
  at cost of
extra storage + refresh complexity + freshness semantics + invalidation handling
```

---

## 3. Mental Model Utama

### 3.1 Raw Table Is the Source of Truth; View Is a Serving Projection

Dalam desain yang sehat:

```text
raw table       = immutable source of observation truth
materialized view = derived projection optimized for reads
serving API     = query contract over one or more projections
```

Jangan membalik mental model ini.

Materialized view bukan pengganti raw data. Ia adalah bentuk turunan yang lebih murah dibaca.

Raw table menjawab:

```text
What actually arrived?
```

Materialized view menjawab:

```text
What aggregated shape do consumers repeatedly need?
```

Serving API menjawab:

```text
What contract do product users depend on?
```

---

### 3.2 Aggregation Is a Data Product

Agregasi bukan hanya query optimization.

Ia adalah data product dengan contract:

```text
bucket size
timezone/calendar semantics
included dimensions
aggregation functions
late data behavior
refresh delay
freshness guarantee
retention period
consumer compatibility
```

Contoh:

```sql
SELECT
  ts,
  device_id,
  avg(temperature) AS avg_temperature
FROM sensor_readings
SAMPLE BY 1m;
```

Pertanyaan arsitektural:

1. `1m` ini fixed duration atau calendar-aligned?
2. timezone apa yang dipakai?
3. apakah late data 30 menit lalu mengubah bucket lama?
4. apakah consumer melihat data partial bucket?
5. apakah `avg_temperature` ignore invalid quality?
6. apakah bucket kosong harus `NULL`, `0`, atau interpolated?
7. berapa lama view ini disimpan?
8. apakah view ini bagian dari public API?

Kalau pertanyaan ini tidak dijawab, materialized view hanya memindahkan ketidakjelasan dari query ke storage.

---

### 3.3 Serving Latency Is Usually Bought With Precomputation

Untuk dashboard, target yang sering diinginkan:

```text
p95 query latency < 500 ms
refresh interval 5-30 seconds
window 1h/24h/7d
many concurrent users
```

Raw query bisa cepat untuk window kecil dan cardinality rendah. Tetapi ketika:

```text
window besar
rows/sec tinggi
dimensi banyak
concurrent dashboard banyak
query sama diulang terus
```

maka pre-aggregation menjadi bukan optimasi premature. Ia menjadi mekanisme kontrol beban.

---

## 4. Konsep Inti

### 4.1 Raw Query

Raw query membaca table sumber secara langsung.

Contoh:

```sql
SELECT
  ts,
  device_id,
  temperature
FROM sensor_readings
WHERE ts >= dateadd('h', -1, now())
  AND device_id = 'pump-7';
```

Cocok untuk:

```text
debugging
exploratory analysis
small window
low concurrency
exact event inspection
forensics
```

Tidak ideal untuk:

```text
high-concurrency dashboards
long-window repeated aggregates
expensive joins repeated frequently
customer-facing API with strict latency SLO
```

---

### 4.2 On-the-Fly Aggregation

Query menghitung agregasi saat runtime.

```sql
SELECT
  ts,
  device_id,
  avg(temperature) AS avg_temp
FROM sensor_readings
WHERE ts >= dateadd('h', -24, now())
SAMPLE BY 1m;
```

Cocok jika:

```text
raw data volume manageable
query tidak sering diulang
freshness harus sedekat mungkin dengan raw
dimensi kecil
window terbatas
```

Risiko:

```text
latency unpredictable under load
compute repeated
query dapat bersaing dengan ingestion
user dapat memperbesar time range dan membuat scan besar
```

---

### 4.3 Materialized View

Materialized view menyimpan hasil query ke disk.

Secara mental:

```text
logical view:
  recompute at read time

materialized view:
  compute before read time
  persist result
  read result later
```

Di QuestDB, materialized view berguna terutama untuk `SAMPLE BY` aggregation yang sering dibaca.

Contoh konseptual:

```sql
CREATE MATERIALIZED VIEW sensor_1m AS
SELECT
  ts,
  device_id,
  avg(temperature) AS avg_temperature,
  min(temperature) AS min_temperature,
  max(temperature) AS max_temperature,
  count() AS sample_count
FROM sensor_readings
SAMPLE BY 1m;
```

View menjadi table fisik turunan.

Keuntungan:

```text
query dashboard lebih cepat
compute aggregate tidak diulang untuk setiap user
window besar menjadi murah
read latency lebih predictable
```

Biaya:

```text
extra storage
extra write/refresh work
freshness lag
late data handling
view invalidation/recovery
schema dependency
```

---

### 4.4 Rollup Hierarchy

Untuk long-range dashboard, satu granularitas biasanya tidak cukup.

Hierarchy umum:

```text
raw events
  -> 1 second rollup
  -> 1 minute rollup
  -> 15 minute rollup
  -> 1 hour rollup
  -> 1 day rollup
```

Contoh serving rule:

```text
last 15 minutes   -> raw or 1s
last 24 hours     -> 1m
last 30 days      -> 15m or 1h
last 1 year       -> 1d
```

Ini penting karena jumlah point yang dikirim ke UI harus bounded.

Salah:

```text
Graph 30 hari dengan bucket 1 detik
= 2,592,000 points per series
```

Benar:

```text
Graph 30 hari dengan bucket 1 jam
= 720 points per series
```

UI, API, network, dan database semuanya lebih stabil.

---

### 4.5 Derived Table vs Materialized View

Tidak semua pre-aggregation harus memakai materialized view.

Pilihan desain:

```text
materialized view
  database-managed refresh
  cocok untuk supported aggregation pattern

manual derived table
  application/job-managed write
  lebih fleksibel
  lebih banyak tanggung jawab operasional
```

Gunakan materialized view jika:

```text
query pattern cocok dengan support QuestDB
aggregation sederhana/menengah
refresh semantics database-managed cukup
view dependency jelas
```

Gunakan derived table manual jika:

```text
logic terlalu custom
aggregation butuh external enrichment berat
butuh complex state machine
butuh correction workflow khusus
butuh exactly-defined batch windows
butuh integration dengan pipeline lain
```

---

## 5. QuestDB-Specific Mechanics

### 5.1 Materialized View as Persisted Precomputed Query

QuestDB mendukung materialized view sebagai persisted result, bukan hanya logical view. Ini berarti query ke view membaca data yang sudah dihitung sebelumnya, bukan menghitung ulang dari base table pada setiap request.

QuestDB mendokumentasikan materialized views sebagai auto-refreshing tables yang menyimpan precomputed results ke disk dan efisien untuk aggregate query mahal yang sering dijalankan; QuestDB mendukung materialized views untuk `SAMPLE BY` queries, termasuk query yang melakukan join dengan table lain.

---

### 5.2 Basic Pattern

Base table:

```sql
CREATE TABLE trades (
  ts TIMESTAMP,
  symbol SYMBOL,
  price DOUBLE,
  amount DOUBLE
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Materialized view:

```sql
CREATE MATERIALIZED VIEW trades_1m AS
SELECT
  ts,
  symbol,
  first(price) AS open,
  max(price) AS high,
  min(price) AS low,
  last(price) AS close,
  sum(amount) AS volume,
  count() AS trade_count
FROM trades
SAMPLE BY 1m;
```

Consumer query:

```sql
SELECT
  ts,
  symbol,
  open,
  high,
  low,
  close,
  volume,
  trade_count
FROM trades_1m
WHERE ts >= dateadd('h', -24, now())
  AND symbol = 'BTC-USD';
```

Instead of scanning raw trades for 24 hours, the dashboard scans one row per minute per symbol.

---

### 5.3 Refresh Strategy

Materialized view refresh strategy defines when the persisted result is updated.

Conceptually:

```text
IMMEDIATE
  update incrementally as base table receives data

MANUAL
  update only when operator/job triggers refresh

EVERY interval
  refresh periodically
```

Design implication:

```text
IMMEDIATE:
  better freshness
  more continuous write/refresh work

MANUAL:
  maximum control
  consumer may see stale data until refresh

EVERY:
  stable refresh cadence
  freshness bounded by interval + processing lag
```

Do not choose refresh strategy by habit. Choose based on consumer SLA.

---

### 5.4 Refresh Delay and Late Data

Late data creates a hard question:

```text
When is a bucket final?
```

Example:

```text
bucket: 10:00:00 - 10:01:00
view computed at 10:01:05
late event arrives at 10:00:30 at 10:02:15
```

Possible semantics:

```text
A. Update old bucket
   more correct
   more refresh/recompute cost

B. Ignore data older than limit
   more stable
   less complete

C. Keep correction separately
   audit-friendly
   more complex consumers
```

QuestDB has refresh-limit mechanics that can bound how far incremental refresh considers older base-table rows. This is a key production tool because unrestricted late-data recomputation can make historical buckets unstable and expensive.

---

### 5.5 Materialized View TTL

A materialized view can have its own retention.

Important: raw and derived retention do not have to match.

Examples:

```text
raw ticks:
  keep 14 days

1m OHLC:
  keep 2 years

1h OHLC:
  keep 7 years
```

Or:

```text
raw sensor readings:
  keep 90 days

1m aggregate:
  keep 2 years

1d aggregate:
  keep 10 years
```

This is a common cost-control design:

```text
high-resolution data is expensive and short-lived
low-resolution data is cheap and long-lived
```

---

### 5.6 Materialized Views Are Not Free

Every materialized view adds:

```text
more write work
more disk writes
more storage
more catalog objects
more refresh state
more recovery state
more monitoring requirements
```

A common anti-pattern:

```text
Create one materialized view per dashboard widget.
```

Better:

```text
Create reusable aggregate layers.
Let dashboards compose from stable serving views.
```

---

## 6. Designing Rollups

### 6.1 Start from Consumer Query Shapes

Do not start with:

```text
Let's create 1m, 5m, 1h because that sounds standard.
```

Start with:

```text
Who reads this?
What window do they read?
What latency do they need?
What dimensions do they group by?
What freshness can they tolerate?
What accuracy do they need?
```

Example consumer matrix:

| Consumer | Window | Granularity | Freshness | Source |
|---|---:|---:|---:|---|
| Live device page | 15m | raw / 1s | <5s | raw or 1s MV |
| Site dashboard | 24h | 1m | <30s | 1m MV |
| Weekly ops report | 30d | 1h | 15m | 1h MV |
| Compliance export | 1y | 1d | daily | 1d derived |

This matrix should drive view design.

---

### 6.2 Choose Bucket Size by Pixel, Not Habit

For visual dashboards, bucket size should relate to display resolution.

If a chart has 1000 horizontal pixels, sending 100,000 points is wasteful.

Rule of thumb:

```text
points returned per series should be bounded
usually 300-2000 points for interactive UI
```

Example:

```text
window = 24h
max points = 720
bucket ~= 2 minutes
```

But for operational familiarity, choose common buckets:

```text
1s, 10s, 1m, 5m, 15m, 1h, 1d
```

---

### 6.3 Do Not Average Averages Blindly

Rollup hierarchy can break correctness.

Wrong:

```text
1m avg -> 1h avg by averaging 60 averages equally
```

This is only correct if every 1m bucket has equal sample count.

Correct:

```text
1h avg = sum(value_sum) / sum(sample_count)
```

Therefore lower-level rollup should often store sufficient statistics:

```text
sum_value
sample_count
min_value
max_value
first_value
last_value
bad_count
```

Then higher-level rollup can be computed correctly.

Recommended 1m aggregate shape:

```sql
CREATE MATERIALIZED VIEW sensor_1m AS
SELECT
  ts,
  device_id,
  metric,
  sum(value) AS value_sum,
  count() AS sample_count,
  min(value) AS value_min,
  max(value) AS value_max,
  first(value) AS value_first,
  last(value) AS value_last
FROM sensor_readings
SAMPLE BY 1m;
```

Consumer computes:

```sql
SELECT
  ts,
  device_id,
  metric,
  value_sum / sample_count AS avg_value,
  value_min,
  value_max
FROM sensor_1m
WHERE ...;
```

---

### 6.4 OHLC Requires Ordered Semantics

For market data:

```text
open  = first price in bucket by timestamp
high  = max price in bucket
low   = min price in bucket
close = last price in bucket by timestamp
volume = sum amount
```

Common pitfall:

```text
close = max(price)
```

This is wrong.

Another pitfall:

```text
open/close from ingestion order, not event timestamp order
```

For out-of-order data, late ticks can modify historical OHLC buckets. You must define whether historical candles are mutable.

---

### 6.5 Counters Need Rate Semantics

Application metrics often include counters:

```text
http_requests_total
bytes_sent_total
error_count_total
```

Aggregating counters by `avg(counter_value)` is usually meaningless.

Need:

```text
increase over window
rate per second
reset handling
```

If using QuestDB for observability metrics, be explicit:

```text
raw counter samples
-> derive deltas/rates carefully
-> aggregate derived rates
```

Counter reset must be handled in producer or derived layer.

---

## 7. Refresh Semantics and Freshness

### 7.1 Freshness Is a Contract

A materialized view may be fast but stale.

Consumers need to know:

```text
How fresh is this result?
Is the latest bucket partial?
Can historical buckets change?
What is the max tolerated lag?
```

Expose freshness explicitly.

Example API response:

```json
{
  "series": [...],
  "bucket": "1m",
  "from": "2026-06-21T10:00:00Z",
  "to": "2026-06-21T11:00:00Z",
  "dataFreshAsOf": "2026-06-21T10:59:42Z",
  "latestBucketComplete": false
}
```

This prevents product users from assuming all data is final.

---

### 7.2 Partial Bucket Policy

The newest bucket is usually incomplete.

Example:

```text
now = 10:00:17
bucket = 10:00:00 - 10:01:00
```

Options:

```text
include partial bucket
  good for live dashboards
  can fluctuate

exclude partial bucket
  good for reports
  less fresh

mark partial bucket
  best for honest APIs
```

Do not mix policies silently.

---

### 7.3 Late Data Policy

Define late data policy per use case.

| Use Case | Late Data Policy |
|---|---|
| Trading ticks | update historical bucket if within allowed correction window |
| Industrial telemetry | accept late replay up to N hours/days |
| Real-time alerting | usually alert on live lane, not delayed corrections |
| Billing/compliance | correction workflow must be explicit and auditable |
| Dashboard | may tolerate bucket restatement |

---

## 8. Query Layer Design in Java

### 8.1 API Should Choose Source Based on Window and Resolution

Do not let frontend directly choose arbitrary raw table queries.

Create a source selection policy:

```java
public enum SeriesSource {
    RAW,
    ROLLUP_1S,
    ROLLUP_1M,
    ROLLUP_15M,
    ROLLUP_1H,
    ROLLUP_1D
}
```

Selection example:

```java
public SeriesSource chooseSource(Duration window, Duration requestedBucket) {
    if (window.compareTo(Duration.ofMinutes(30)) <= 0 && requestedBucket.compareTo(Duration.ofSeconds(1)) <= 0) {
        return SeriesSource.RAW;
    }
    if (window.compareTo(Duration.ofDays(1)) <= 0) {
        return SeriesSource.ROLLUP_1M;
    }
    if (window.compareTo(Duration.ofDays(30)) <= 0) {
        return SeriesSource.ROLLUP_15M;
    }
    if (window.compareTo(Duration.ofDays(365)) <= 0) {
        return SeriesSource.ROLLUP_1H;
    }
    return SeriesSource.ROLLUP_1D;
}
```

This is not just optimization. It is a safety guardrail.

---

### 8.2 Bound Query Result Size

Always enforce:

```text
max time range
max series count
max points per series
max group cardinality
max export size
```

Example:

```java
public record TimeSeriesQuery(
    Instant from,
    Instant to,
    Duration bucket,
    List<String> deviceIds,
    String metric
) {
    public void validate() {
        if (!from.isBefore(to)) {
            throw new IllegalArgumentException("from must be before to");
        }
        if (Duration.between(from, to).compareTo(Duration.ofDays(90)) > 0) {
            throw new IllegalArgumentException("range too large");
        }
        long points = Duration.between(from, to).toMillis() / bucket.toMillis();
        if (points > 2000) {
            throw new IllegalArgumentException("too many points; increase bucket size");
        }
        if (deviceIds.size() > 100) {
            throw new IllegalArgumentException("too many series");
        }
    }
}
```

QuestDB can be fast, but no database should be exposed to unbounded user query shapes.

---

### 8.3 Do Not Leak Physical Table Names to Product API

Bad API:

```http
GET /query?table=sensor_1m&sql=...
```

Better API:

```http
GET /devices/{deviceId}/metrics/temperature?from=...&to=...&resolution=auto
```

The backend maps request to source:

```text
resolution=auto
  -> choose view by window and SLO
```

This allows you to change materialized view strategy without breaking clients.

---

## 9. Failure Modes

### 9.1 View Is Fast but Stale

Symptom:

```text
dashboard query is fast
but data appears delayed
raw table contains newer data
```

Possible causes:

```text
refresh lag
WAL apply lag on base table
view invalidation
manual refresh not triggered
refresh limit ignoring late rows
```

Response:

```text
compare max(ts) in raw vs max(ts) in view
check materialized view state
check WAL apply health
check refresh strategy
report dataFreshAsOf to users
```

---

### 9.2 View Invalid After Schema Change

Symptom:

```text
base table schema changed
view refresh fails or becomes invalid
```

Possible causes:

```text
dropped/renamed source column
changed type
changed symbol semantics
aggregation no longer valid
```

Prevention:

```text
schema change review must include dependent views
contract tests should validate view creation
migration should include refresh/rebuild step
```

---

### 9.3 Too Many Views Cause Write Amplification

Symptom:

```text
ingestion slows after adding many materialized views
disk write increases
refresh jobs consume CPU
```

Cause:

```text
each view adds derived write work
```

Response:

```text
consolidate views
remove widget-specific views
increase bucket granularity
switch some views to scheduled/manual refresh
review cardinality dimensions
```

---

### 9.4 Late Data Rewrites Too Much History

Symptom:

```text
old buckets keep changing
refresh cost spikes
queries inconsistent over historical windows
```

Cause:

```text
late arrival SLA unbounded
backfill mixed with live ingestion
refresh limit absent or too large
```

Response:

```text
separate backfill lane
sort historical load
define correction window
configure refresh limit where appropriate
communicate mutable history semantics
```

---

### 9.5 Consumer Misinterprets Aggregates

Symptom:

```text
reports wrong even though query is fast
```

Causes:

```text
averaging averages
counter rates computed incorrectly
partial bucket treated as final
timezone mismatch
quality flags ignored
```

Prevention:

```text
store sufficient statistics
include bucket metadata
standardize timezone
write semantic tests
review aggregation formulas like API contracts
```

---

## 10. Anti-Patterns

### Anti-Pattern 1: Dashboard Scans Raw Multi-Day Data

```sql
SELECT avg(value)
FROM raw_sensor
WHERE ts >= dateadd('d', -30, now())
SAMPLE BY 1s;
```

Problem:

```text
massive scan
too many points
unpredictable latency
high concurrency risk
```

Better:

```text
use 1m/15m/1h materialized view
bound points returned
```

---

### Anti-Pattern 2: One View per Widget

Problem:

```text
view explosion
write amplification
schema dependency mess
hard to monitor
```

Better:

```text
design reusable aggregate layers
let widgets filter/select from shared views
```

---

### Anti-Pattern 3: Average of Averages

Problem:

```text
mathematically wrong when sample counts differ
```

Better:

```text
store sum and count
compute weighted average
```

---

### Anti-Pattern 4: Hiding Staleness

Problem:

```text
consumer assumes fast result is current result
```

Better:

```text
return dataFreshAsOf
mark partial bucket
monitor raw-vs-view lag
```

---

### Anti-Pattern 5: Materialized View as Source of Truth

Problem:

```text
cannot audit raw events
correction workflow becomes unclear
view rebuild impossible if raw expired too early
```

Better:

```text
preserve raw according to required audit/rebuild window
use view as serving projection
```

---

## 11. Hands-On Lab

### 11.1 Create Raw Table

```sql
CREATE TABLE sensor_readings (
  ts TIMESTAMP,
  tenant SYMBOL,
  site SYMBOL,
  device_id SYMBOL,
  metric SYMBOL,
  value DOUBLE,
  quality SYMBOL
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

---

### 11.2 Insert Example Data

```sql
INSERT INTO sensor_readings VALUES
('2026-06-21T10:00:01.000000Z', 'tenant-a', 'site-1', 'pump-7', 'pressure', 42.1, 'GOOD'),
('2026-06-21T10:00:02.000000Z', 'tenant-a', 'site-1', 'pump-7', 'pressure', 42.3, 'GOOD'),
('2026-06-21T10:00:03.000000Z', 'tenant-a', 'site-1', 'pump-7', 'pressure', 41.9, 'GOOD'),
('2026-06-21T10:00:04.000000Z', 'tenant-a', 'site-1', 'pump-8', 'pressure', 38.2, 'GOOD');
```

---

### 11.3 Create 1-Minute Aggregate

```sql
CREATE MATERIALIZED VIEW sensor_pressure_1m AS
SELECT
  ts,
  tenant,
  site,
  device_id,
  metric,
  sum(value) AS value_sum,
  count() AS sample_count,
  min(value) AS value_min,
  max(value) AS value_max,
  first(value) AS value_first,
  last(value) AS value_last
FROM sensor_readings
WHERE metric = 'pressure'
SAMPLE BY 1m;
```

---

### 11.4 Query the View

```sql
SELECT
  ts,
  tenant,
  site,
  device_id,
  metric,
  value_sum / sample_count AS avg_value,
  value_min,
  value_max,
  sample_count
FROM sensor_pressure_1m
WHERE ts >= '2026-06-21T10:00:00.000000Z'
  AND ts <  '2026-06-21T11:00:00.000000Z'
  AND tenant = 'tenant-a'
  AND site = 'site-1';
```

---

### 11.5 Compare Raw vs View Freshness

```sql
SELECT max(ts) AS raw_max_ts FROM sensor_readings;
```

```sql
SELECT max(ts) AS view_max_ts FROM sensor_pressure_1m;
```

Operationally, this difference should become a dashboard/alert metric.

---

### 11.6 Design Exercise

Given:

```text
10,000 devices
1 metric every second per device
raw retention 30 days
UI supports last 15m, 24h, 30d, 1y
```

Design:

1. raw table;
2. rollup views;
3. retention per layer;
4. API source selection rule;
5. late data policy;
6. maximum points per series;
7. freshness metadata.

Expected reasoning:

```text
last 15m -> raw or 1s
24h      -> 1m
30d      -> 15m or 1h
1y       -> 1d
```

---

## 12. Production Checklist

Before adding a materialized view, answer:

```text
[ ] Which consumer needs this view?
[ ] What query does it replace?
[ ] What latency improvement is expected?
[ ] What raw scan cost is avoided?
[ ] What bucket size is required?
[ ] What timezone/calendar semantics apply?
[ ] Are partial buckets included?
[ ] Can historical buckets change?
[ ] What late-data window is accepted?
[ ] Is refresh immediate, scheduled, or manual?
[ ] What is the freshness SLO?
[ ] What is the retention period?
[ ] Can this view be rebuilt from raw data?
[ ] What schema changes can break it?
[ ] What monitoring detects refresh lag?
[ ] How many other views depend on the same base table?
[ ] Is the view reusable or widget-specific?
[ ] Does the aggregate store sufficient statistics?
[ ] Is the Java API hiding physical view names?
[ ] Is result size bounded?
```

---

## 13. Staff-Level Design Heuristics

### Heuristic 1: Raw Is for Truth, Views Are for Speed

Never lose raw data before you are sure every required derived view can be rebuilt or audited.

---

### Heuristic 2: Pre-Aggregate Repeated Expensive Questions

If many consumers repeatedly ask the same aggregate question, it should likely become a view or serving table.

---

### Heuristic 3: Store Sufficient Statistics

Prefer:

```text
sum + count + min + max + first + last
```

over:

```text
avg only
```

This preserves future rollup correctness.

---

### Heuristic 4: Freshness Must Be Visible

A fast stale view is dangerous if consumers believe it is real-time.

Expose freshness.

---

### Heuristic 5: Rollups Are Part of Product Contract

Changing bucket size, timezone, or partial-bucket policy can break users even if SQL still works.

---

## 14. Summary

Materialized views and pre-aggregation are how high-volume time-series systems become predictable for dashboards and APIs.

The core model:

```text
raw table
  = source of truth

materialized view
  = persisted derived projection

rollup hierarchy
  = controlled resolution over long windows

serving API
  = stable contract over physical tables/views
```

The hardest part is not writing `CREATE MATERIALIZED VIEW`.

The hard part is deciding:

```text
what to aggregate
at what granularity
with what freshness
under what late-data policy
for which consumer
with what retention
and what rebuild path
```

QuestDB materialized views are powerful because they let repeated `SAMPLE BY`-style aggregates become persisted, incrementally maintained read models. Used well, they reduce query cost and improve dashboard latency. Used carelessly, they create write amplification, stale data confusion, and schema dependency sprawl.

A production-grade QuestDB architecture should treat materialized views as first-class data products with contracts, monitoring, and lifecycle policy.

---

## 15. What Comes Next

Next part:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-016.md
Query Engine and Execution Mental Model
```

We will move beneath SQL syntax and learn how to reason from query text to execution cost: partition pruning, columnar scan, symbol filtering, ordering, joins, memory pressure, and why two queries that look similar can behave very differently.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-014.md">⬅️ Part 014 — Advanced Temporal Querying: ASOF JOIN, LT JOIN, SPLICE JOIN, WINDOW JOIN</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-016.md">Query Engine and Execution Mental Model ➡️</a>
</div>

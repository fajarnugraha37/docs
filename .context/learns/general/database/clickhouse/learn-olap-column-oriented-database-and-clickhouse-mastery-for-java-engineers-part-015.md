# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-015.md

# Part 015 — Materialized Views II: Rollups, Pre-Aggregation, and Serving Tables

> Seri: `learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin menguasai OLAP, column-oriented database, dan ClickHouse sampai level desain produksi.  
> Fokus part ini: bagaimana menggunakan materialized view, aggregate states, rollup table, dan serving table untuk membuat analytical query cepat, stabil, dapat di-backfill, dan defensible secara operasional.

---

## 0. Posisi Part Ini Dalam Seri

Di part sebelumnya, kita membahas **materialized view sebagai insert-time transformation pipeline**. Intinya:

- materialized view ClickHouse bukan sekadar saved query;
- incremental materialized view bekerja ketika data masuk ke source table;
- data hasil transformasi biasanya ditulis ke explicit target table;
- target table engine menentukan semantics merge dan query;
- aggregate state memungkinkan pre-aggregation yang bisa digabung lagi;
- backfill harus didesain, bukan dilakukan asal dengan `POPULATE`.

Part ini melanjutkan dari sana, tetapi lebih fokus pada **arsitektur serving layer**:

> Bagaimana mengubah raw analytical events menjadi tabel cepat untuk dashboard, API, report, dan drill-down tanpa kehilangan kemampuan audit dan koreksi?

Kita akan membahas:

1. rollup design;
2. pre-aggregation strategy;
3. multi-resolution aggregates;
4. serving tables;
5. correctness model;
6. late events;
7. backfill/rebuild;
8. query rewrite manual;
9. dashboard/API design;
10. regulatory/case-management reporting pattern.

Bagian ini penting karena banyak tim memakai ClickHouse dengan pola berikut:

```text
raw table besar  --->  semua dashboard query langsung ke raw table
```

Awalnya cepat. Setelah data tumbuh, query mulai scan terlalu banyak data, dashboard tidak stabil, concurrency naik, biaya CPU/memory membesar, lalu tim mulai “menambah index” secara acak.

Cara berpikir yang lebih matang:

```text
raw events
   |
   | incremental materialized views
   v
rollup / refined / serving tables
   |
   v
API / dashboard / report / alerting
```

Raw table tetap menjadi sumber detail dan audit. Serving table menjadi kontrak performa.

---

## 1. Core Mental Model

### 1.1 Raw Table Adalah Truth; Serving Table Adalah Product

Dalam sistem OLAP produksi, satu tabel tidak harus melayani semua kebutuhan.

Raw table biasanya menyimpan fakta detail:

```text
one row = one event / one observation / one measurement / one state change
```

Serving table biasanya menyimpan bentuk data yang sudah dioptimalkan untuk konsumsi:

```text
one row = one bucket + one dimension combination + one metric state/value
```

Contoh raw event:

```text
case_id=CASE-123
agency_id=AG-01
event_type=ESCALATED
event_time=2026-06-21T10:31:44.123Z
actor_role=SUPERVISOR
severity=HIGH
```

Contoh serving rollup per jam:

```text
bucket_start=2026-06-21 10:00:00
agency_id=AG-01
event_type=ESCALATED
severity=HIGH
case_count_state=uniqState(case_id)
event_count=42
```

Raw table menjawab:

- “Apa yang persis terjadi?”
- “Event mana saja yang membentuk angka ini?”
- “Bisakah kita audit ulang?”
- “Bisakah kita rebuild?”

Serving table menjawab:

- “Tampilkan trend harian 6 bulan terakhir.”
- “Hitung escalation rate per agency.”
- “Dashboard harus respons < 500 ms.”
- “API dipanggil ratusan kali per menit.”

Keduanya punya peran berbeda.

### 1.2 Pre-Aggregation Adalah Memindahkan Biaya dari Query Time ke Ingestion/Merge Time

Query langsung ke raw table:

```sql
SELECT
    toStartOfHour(event_time) AS hour,
    agency_id,
    event_type,
    count() AS events,
    uniq(case_id) AS cases
FROM case_events_raw
WHERE event_time >= now() - INTERVAL 30 DAY
GROUP BY hour, agency_id, event_type
ORDER BY hour;
```

Jika raw table berisi miliaran row, query ini harus:

1. membaca kolom terkait;
2. filter rentang waktu;
3. membuat group key `(hour, agency_id, event_type)`;
4. membangun aggregate state;
5. merge partial results;
6. sort output.

Dengan rollup, pekerjaan berat dilakukan saat insert:

```text
raw insert
  -> materialized view computes hourly partial states
  -> target table stores pre-aggregated rows/states
  -> query merges far fewer rows
```

Query serving table:

```sql
SELECT
    hour,
    agency_id,
    event_type,
    sum(events) AS events,
    uniqMerge(cases_state) AS cases
FROM case_events_hourly
WHERE hour >= now() - INTERVAL 30 DAY
GROUP BY hour, agency_id, event_type
ORDER BY hour;
```

Perbedaannya bukan hanya syntax. Perbedaannya adalah jumlah data yang harus disentuh.

Jika raw table memiliki 3 miliar events dalam 30 hari, tetapi hourly rollup hanya memiliki:

```text
24 hours/day * 30 days * agencies * event_types * severities
```

maka query bisa turun dari miliaran row menjadi ribuan/jutaan row tergantung cardinality dimension.

### 1.3 Rollup Bukan Cache

Cache menyimpan hasil query tertentu.

Rollup menyimpan struktur data yang lebih rendah granularitasnya dan bisa dipakai banyak query.

Cache:

```text
key = query parameters
value = final result
```

Rollup:

```text
key = time bucket + dimensions
value = aggregate values/states
```

Cache bagus untuk request yang berulang identik. Rollup bagus untuk workload analitik yang punya banyak kombinasi filter/grouping tetapi masih mengikuti pola granularity yang jelas.

### 1.4 Serving Table Adalah API Contract

Jika backend Java menyediakan endpoint:

```http
GET /analytics/cases/escalations?from=2026-01-01&to=2026-06-01&groupBy=day,agency,severity
```

maka backend tidak seharusnya membangun query acak ke raw table untuk semua kemungkinan. Backend perlu tahu:

- endpoint mana memakai raw table;
- endpoint mana memakai hourly rollup;
- endpoint mana memakai daily rollup;
- endpoint mana memakai current snapshot;
- endpoint mana memakai precomputed serving table.

Serving table menjadi bagian dari kontrak API:

```text
analytics endpoint SLA -> serving table design -> ingestion/rollup maintenance -> query template
```

---

## 2. Vocabulary Penting

### 2.1 Raw Table

Tabel detail append-oriented. Biasanya berisi event/fact granular.

Karakteristik:

- high volume;
- insert-heavy;
- retention lebih panjang atau sesuai audit policy;
- schema kaya;
- query detail/debug/audit;
- sering menjadi source materialized view.

Contoh:

```sql
CREATE TABLE case_events_raw
(
    event_id UUID,
    case_id String,
    tenant_id LowCardinality(String),
    agency_id LowCardinality(String),
    event_type LowCardinality(String),
    severity LowCardinality(String),
    actor_role LowCardinality(String),
    event_time DateTime64(3, 'UTC'),
    ingest_time DateTime64(3, 'UTC'),
    duration_ms UInt32,
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, agency_id, case_id);
```

### 2.2 Refined Table

Tabel hasil normalisasi/cleaning/enrichment dari raw.

Contoh:

- parse JSON hot fields;
- normalize status code;
- map actor role;
- enrich with dimension snapshot;
- compute derived columns.

Refined table masih bisa detail-level.

### 2.3 Rollup Table

Tabel aggregate berdasarkan bucket waktu dan dimension tertentu.

Contoh:

```text
hour + tenant + agency + event_type + severity -> counts/states
```

Rollup table biasanya dipakai untuk trend, dashboard, metrics, alerting, dan report.

### 2.4 Serving Table

Tabel yang didesain spesifik untuk query/API tertentu.

Rollup table adalah salah satu bentuk serving table, tetapi serving table bisa juga berupa:

- latest state table;
- ranking table;
- search helper table;
- export/report table;
- denormalized dashboard table;
- compliance evidence summary table.

### 2.5 Aggregate State

Intermediate state dari aggregate function.

Misalnya:

```sql
uniqState(case_id)
quantileTDigestState(0.95)(duration_ms)
sumState(amount)
countState()
```

State ini belum final value. Ia disimpan agar bisa digabung lagi:

```sql
uniqMerge(case_state)
quantileTDigestMerge(0.95)(duration_state)
sumMerge(amount_state)
countMerge(count_state)
```

### 2.6 Rollup Grain

Definisi satu row dalam rollup.

Contoh:

```text
one row = one hour + one tenant + one agency + one event_type + one severity
```

Grain harus jelas. Jika tidak, table akan membengkak atau metric menjadi ambigu.

### 2.7 Query Grain

Granularity yang diminta user/query.

Contoh:

- per minute;
- per hour;
- per day;
- per agency;
- per severity;
- per case type.

Rollup grain harus bisa melayani query grain tanpa menghasilkan metric salah.

---

## 3. Mengapa Query Langsung ke Raw Table Tidak Selalu Cukup

ClickHouse cepat, tetapi bukan berarti semua query raw table akan murah selamanya.

### 3.1 Masalah Scan Volume

Query analytics sering membaca banyak row.

Jika dashboard menampilkan 12 chart dan masing-masing chart query raw 90 hari, maka request user tunggal bisa memicu:

```text
12 queries * billions of rows scanned
```

Meskipun satu query masih “cepat”, concurrency akan memperlihatkan biaya sebenarnya.

### 3.2 Masalah Group Cardinality

Aggregation mahal bukan hanya karena jumlah row, tetapi karena jumlah group state.

Query ini bisa sangat berat:

```sql
SELECT
    toStartOfMinute(event_time) AS minute,
    user_id,
    endpoint,
    uniq(session_id)
FROM api_events_raw
WHERE event_time >= now() - INTERVAL 7 DAY
GROUP BY minute, user_id, endpoint;
```

Jika `user_id` dan `endpoint` cardinality tinggi, aggregate state bisa meledak.

### 3.3 Masalah Repeated Work

Dashboard yang sama akan menghitung ulang hal yang sama berkali-kali.

Contoh:

- total events per hour;
- error rate per service;
- escalation count per agency;
- percentile latency per endpoint;
- cases breached per day.

Jika semua dihitung dari raw setiap kali, kita membayar biaya yang sama berulang.

### 3.4 Masalah SLA dan Tail Latency

Query raw mungkin median latency bagus, tetapi p95/p99 buruk ketika:

- background merges sedang berat;
- cluster concurrency tinggi;
- cache dingin;
- query dashboard bersamaan;
- distributed query fan-out ke shard lambat;
- group cardinality naik.

Serving table membantu membuat workload lebih deterministik.

### 3.5 Masalah Governance

Raw table sering mengandung PII/detail sensitif. Dashboard/report tidak selalu perlu detail tersebut.

Serving table bisa menyimpan:

- aggregate only;
- fewer columns;
- masked dimensions;
- tenant-scoped data;
- pre-approved reporting shape.

Ini membantu compliance dan least privilege.

---

## 4. Rollup Design dari Prinsip Pertama

### 4.1 Langkah 1 — Tentukan Business Question

Jangan mulai dari table. Mulai dari pertanyaan.

Contoh:

```text
Berapa jumlah case escalation per agency per hari dalam 12 bulan terakhir?
```

Breakdown:

| Elemen | Nilai |
|---|---|
| Entity | case events |
| Metric | escalation count |
| Time grain | day |
| Dimensions | agency |
| Filter | event_type = ESCALATED |
| Range | 12 months |
| Freshness | near real-time? hourly? daily? |
| Accuracy | exact count? |

### 4.2 Langkah 2 — Tentukan Raw Grain

Raw grain mungkin:

```text
one row = one case lifecycle event
```

Jika event dapat duplicate, raw table harus tetap bisa menampungnya, tetapi metric harus punya dedup logic.

### 4.3 Langkah 3 — Tentukan Rollup Grain

Untuk query harian, rollup bisa daily:

```text
day + tenant + agency + event_type -> event_count, unique_cases
```

Tetapi jika dashboard juga butuh hourly drill-down, daily saja tidak cukup. Pilihan:

1. hanya hourly rollup, query harian menjumlahkan hourly;
2. hourly dan daily rollup;
3. raw untuk hourly, daily untuk long range.

### 4.4 Langkah 4 — Tentukan Metric Semantics

Metric tidak boleh ambigu.

Contoh “case count” bisa berarti:

1. jumlah event;
2. jumlah unique case yang mengalami event;
3. jumlah current active cases;
4. jumlah cases created;
5. jumlah cases closed;
6. jumlah cases ever escalated;
7. jumlah cases currently escalated.

Setiap metric punya model berbeda.

### 4.5 Langkah 5 — Tentukan Additivity

Metric additive:

```text
event_count per hour bisa dijumlahkan menjadi day/month
```

Metric semi-additive:

```text
open_cases snapshot per hour tidak boleh dijumlahkan menjadi daily open_cases
```

Metric non-additive:

```text
unique cases per hour tidak selalu bisa dijumlahkan menjadi unique cases per day
```

Karena itu untuk distinct count, lebih aman menyimpan aggregate state:

```sql
uniqState(case_id)
```

lalu menggabungkan:

```sql
uniqMerge(case_state)
```

### 4.6 Langkah 6 — Tentukan Query Serving Pattern

Apakah query akan:

- selalu group by time?
- sering filter tenant?
- sering filter agency?
- butuh top-N?
- butuh drill-down?
- butuh exact distinct?
- butuh percentile?
- butuh compare period-over-period?

Rollup harus mengikuti query shape yang dominan.

### 4.7 Langkah 7 — Tentukan Rebuild Story

Sebelum production, jawab:

- Bisakah rollup direbuild dari raw?
- Berapa lama rebuild 1 bulan data?
- Bagaimana cutover tanpa double counting?
- Apa boundary event_time atau ingest_time?
- Bagaimana menangani late events?
- Bagaimana memvalidasi hasil?

Jika tidak bisa direbuild, serving layer menjadi liability.

---

## 5. Pattern Dasar: Raw → Hourly Rollup → Query

### 5.1 Raw Table

```sql
CREATE TABLE case_events_raw
(
    event_id UUID,
    case_id String,
    tenant_id LowCardinality(String),
    agency_id LowCardinality(String),
    event_type LowCardinality(String),
    severity LowCardinality(String),
    event_time DateTime64(3, 'UTC'),
    ingest_time DateTime64(3, 'UTC'),
    processing_duration_ms UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, agency_id, case_id);
```

### 5.2 Target Rollup Table

```sql
CREATE TABLE case_events_hourly_rollup
(
    hour DateTime('UTC'),
    tenant_id LowCardinality(String),
    agency_id LowCardinality(String),
    event_type LowCardinality(String),
    severity LowCardinality(String),

    event_count SimpleAggregateFunction(sum, UInt64),
    unique_cases AggregateFunction(uniq, String),
    p95_processing_duration AggregateFunction(quantileTDigest(0.95), UInt32)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (tenant_id, event_type, hour, agency_id, severity);
```

Catatan:

- `event_count` memakai `SimpleAggregateFunction(sum, UInt64)` karena count additive;
- `unique_cases` memakai `AggregateFunction(uniq, String)` karena distinct tidak additive;
- percentile memakai aggregate state karena percentile tidak additive;
- sorting key mengikuti query dominan.

### 5.3 Materialized View

```sql
CREATE MATERIALIZED VIEW case_events_hourly_rollup_mv
TO case_events_hourly_rollup
AS
SELECT
    toStartOfHour(event_time) AS hour,
    tenant_id,
    agency_id,
    event_type,
    severity,

    count() AS event_count,
    uniqState(case_id) AS unique_cases,
    quantileTDigestState(0.95)(processing_duration_ms) AS p95_processing_duration
FROM case_events_raw
GROUP BY
    hour,
    tenant_id,
    agency_id,
    event_type,
    severity;
```

### 5.4 Query Rollup

```sql
SELECT
    hour,
    agency_id,
    event_type,
    severity,
    sum(event_count) AS events,
    uniqMerge(unique_cases) AS cases,
    quantileTDigestMerge(0.95)(p95_processing_duration) AS p95_processing_ms
FROM case_events_hourly_rollup
WHERE
    tenant_id = 'tenant-a'
    AND hour >= toDateTime('2026-06-01 00:00:00', 'UTC')
    AND hour <  toDateTime('2026-07-01 00:00:00', 'UTC')
GROUP BY
    hour,
    agency_id,
    event_type,
    severity
ORDER BY hour, agency_id, event_type, severity;
```

### 5.5 Kenapa Masih Perlu `GROUP BY` di Query Rollup?

Karena `AggregatingMergeTree` menggabungkan state secara background, tetapi pada saat query mungkin masih ada beberapa rows dengan key yang sama di different parts. Query harus merge state secara eksplisit.

Jangan menganggap target rollup selalu physically collapsed menjadi satu row per key.

Gunakan:

```sql
uniqMerge(...)
```

bukan membaca state mentah.

---

## 6. Multi-Resolution Rollups

### 6.1 Problem

Dashboard sering butuh rentang waktu berbeda:

| Range | Desired granularity |
|---|---|
| Last 1 hour | minute |
| Last 24 hours | 5-minute / hour |
| Last 30 days | hour / day |
| Last 12 months | day / week / month |

Jika semua query long-range memakai minute-level rollup, jumlah rows tetap besar.

Jika semua query memakai daily rollup, short-range dashboard kehilangan detail.

### 6.2 Solusi: Multi-Resolution Tables

```text
raw_events
  -> mv_minute_rollup
  -> mv_hourly_rollup
  -> mv_daily_rollup
```

Atau:

```text
raw_events -> hourly_rollup
hourly_rollup -> daily_rollup
```

Pattern kedua disebut cascading materialized views. Namun, harus hati-hati karena materialized view downstream membaca data yang diinsert ke table upstream, bukan hasil final merge sempurna. Desain dengan aggregate states lebih aman.

### 6.3 Minute Rollup

```sql
CREATE TABLE api_metrics_1m
(
    minute DateTime('UTC'),
    service LowCardinality(String),
    endpoint LowCardinality(String),
    status_class LowCardinality(String),

    request_count SimpleAggregateFunction(sum, UInt64),
    error_count SimpleAggregateFunction(sum, UInt64),
    latency_p50 AggregateFunction(quantileTDigest(0.50), UInt32),
    latency_p95 AggregateFunction(quantileTDigest(0.95), UInt32),
    latency_p99 AggregateFunction(quantileTDigest(0.99), UInt32)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(minute)
ORDER BY (service, endpoint, minute, status_class);
```

### 6.4 Hourly Rollup from Raw

```sql
CREATE TABLE api_metrics_1h
(
    hour DateTime('UTC'),
    service LowCardinality(String),
    endpoint LowCardinality(String),
    status_class LowCardinality(String),

    request_count SimpleAggregateFunction(sum, UInt64),
    error_count SimpleAggregateFunction(sum, UInt64),
    latency_p50 AggregateFunction(quantileTDigest(0.50), UInt32),
    latency_p95 AggregateFunction(quantileTDigest(0.95), UInt32),
    latency_p99 AggregateFunction(quantileTDigest(0.99), UInt32)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (service, endpoint, hour, status_class);
```

Materialized view langsung dari raw:

```sql
CREATE MATERIALIZED VIEW api_metrics_1h_mv
TO api_metrics_1h
AS
SELECT
    toStartOfHour(event_time) AS hour,
    service,
    endpoint,
    status_class,
    count() AS request_count,
    countIf(status_class = '5xx') AS error_count,
    quantileTDigestState(0.50)(latency_ms) AS latency_p50,
    quantileTDigestState(0.95)(latency_ms) AS latency_p95,
    quantileTDigestState(0.99)(latency_ms) AS latency_p99
FROM api_requests_raw
GROUP BY hour, service, endpoint, status_class;
```

### 6.5 Daily Rollup from Hourly States

Jika daily rollup dibuat dari hourly table, gunakan merge state dengan benar:

```sql
CREATE MATERIALIZED VIEW api_metrics_1d_mv
TO api_metrics_1d
AS
SELECT
    toDate(hour) AS day,
    service,
    endpoint,
    status_class,
    sum(request_count) AS request_count,
    sum(error_count) AS error_count,
    quantileTDigestMergeState(0.50)(latency_p50) AS latency_p50,
    quantileTDigestMergeState(0.95)(latency_p95) AS latency_p95,
    quantileTDigestMergeState(0.99)(latency_p99) AS latency_p99
FROM api_metrics_1h
GROUP BY day, service, endpoint, status_class;
```

Namun, cascading MV perlu diuji dengan hati-hati. Dalam banyak sistem, lebih mudah dan lebih jelas membuat multiple MVs dari raw:

```text
raw -> 1m
raw -> 1h
raw -> 1d
```

Trade-off:

| Pattern | Kelebihan | Risiko |
|---|---|---|
| raw -> each rollup | Semantics lebih jelas, rebuild lebih mudah | Write amplification lebih besar |
| raw -> hourly -> daily | Mengurangi recomputation | Cascading semantics lebih rumit |

### 6.6 Routing Query Berdasarkan Range

Backend Java bisa memilih table berdasarkan range:

```text
range <= 6 hours      -> 1m rollup
range <= 30 days      -> 1h rollup
range > 30 days       -> 1d rollup
```

Pseudo-code:

```java
public enum Resolution {
    MINUTE, HOUR, DAY
}

public Resolution chooseResolution(Instant from, Instant to) {
    Duration range = Duration.between(from, to);
    if (range.compareTo(Duration.ofHours(6)) <= 0) {
        return Resolution.MINUTE;
    }
    if (range.compareTo(Duration.ofDays(30)) <= 0) {
        return Resolution.HOUR;
    }
    return Resolution.DAY;
}
```

Query planner di aplikasi memilih SQL template yang sesuai.

Ini bukan “hack”; ini adalah bagian dari analytics serving architecture.

---

## 7. Rollup Metrics: Nilai Final vs Aggregate State

### 7.1 Kapan Simpan Nilai Final?

Simpan final value jika metric additive dan bisa digabung sederhana.

Contoh:

```text
count
sum
error_count
bytes_total
amount_total
```

Tipe:

```sql
SimpleAggregateFunction(sum, UInt64)
```

atau pada `SummingMergeTree`:

```sql
UInt64
```

### 7.2 Kapan Simpan Aggregate State?

Simpan aggregate state jika metric perlu digabung non-trivial.

Contoh:

| Metric | State |
|---|---|
| distinct users | `uniqState(user_id)` |
| unique cases | `uniqState(case_id)` |
| p95 latency | `quantileTDigestState(0.95)(latency_ms)` |
| average with correct denominator | `avgState(value)` or sum/count pair |
| top-k | `topKState(k)(value)` |

### 7.3 Average: Jangan Simpan Average Saja Jika Akan Digabung

Salah:

```text
hour1 avg latency = 100ms, count=10
hour2 avg latency = 200ms, count=1000
average of averages = 150ms  // salah
```

Benar:

```text
sum latency + count
```

atau:

```sql
avgState(latency_ms)
```

lalu:

```sql
avgMerge(latency_state)
```

### 7.4 Ratio: Simpan Numerator dan Denominator

Salah:

```text
store error_rate per hour lalu average error_rate per day
```

Benar:

```text
store error_count and request_count
error_rate = sum(error_count) / sum(request_count)
```

SQL:

```sql
SELECT
    day,
    sum(error_count) / nullIf(sum(request_count), 0) AS error_rate
FROM api_metrics_1d
GROUP BY day;
```

### 7.5 Distinct Count: Jangan Menjumlahkan Distinct per Bucket

Salah:

```text
unique users day = sum(unique users per hour)
```

User yang aktif di 3 jam akan dihitung 3 kali.

Benar:

```sql
uniqMerge(user_state)
```

atau jika exact required:

```sql
uniqExactState(user_id)
uniqExactMerge(user_state)
```

Tetapi exact distinct state bisa sangat mahal untuk high cardinality. Gunakan hanya jika benar-benar diperlukan.

---

## 8. Serving Table Patterns

### 8.1 Generic Rollup Table

Satu rollup table melayani banyak query.

Contoh:

```text
hour + tenant + agency + event_type + severity
```

Kelebihan:

- reusable;
- jumlah table lebih sedikit;
- query fleksibel.

Kekurangan:

- bisa tetap besar jika dimension terlalu banyak;
- API perlu masih melakukan group/merge;
- tidak optimal untuk semua dashboard.

### 8.2 Dashboard-Specific Serving Table

Table khusus untuk dashboard tertentu.

Contoh:

```text
daily_case_compliance_dashboard
```

Kolom:

```text
day
tenant_id
agency_id
new_cases
closed_cases
escalated_cases
sla_breached_cases
avg_resolution_duration_state
p95_resolution_duration_state
```

Kelebihan:

- sangat cepat;
- query sederhana;
- contract jelas.

Kekurangan:

- lebih banyak table;
- lebih banyak write amplification;
- perubahan dashboard bisa memerlukan schema change/backfill.

### 8.3 Latest-State Serving Table

Untuk pertanyaan:

```text
berapa case saat ini yang OPEN / ESCALATED / BREACHED?
```

Raw event table tidak cukup langsung, karena perlu menentukan latest state per case.

Pattern:

- raw state change events;
- latest state table dengan `ReplacingMergeTree`;
- optional rollup dari latest state untuk current snapshot.

Contoh latest table:

```sql
CREATE TABLE case_current_state
(
    tenant_id LowCardinality(String),
    case_id String,
    agency_id LowCardinality(String),
    status LowCardinality(String),
    severity LowCardinality(String),
    updated_at DateTime64(3, 'UTC'),
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY cityHash64(case_id) % 32
ORDER BY (tenant_id, case_id);
```

Catatan: query dengan `FINAL` bisa mahal. Untuk dashboard besar, current-state aggregate mungkin perlu table tersendiri atau pipeline terpisah.

### 8.4 Top-N Serving Table

Query top-N sering mahal jika dihitung dari raw:

```sql
SELECT endpoint, count()
FROM api_requests_raw
WHERE event_time >= now() - INTERVAL 1 DAY
GROUP BY endpoint
ORDER BY count() DESC
LIMIT 20;
```

Jika endpoint cardinality tinggi, ini bisa mahal.

Rollup:

```text
hour + service + endpoint -> request_count/error_count/latency_state
```

Query top-N dari rollup:

```sql
SELECT
    endpoint,
    sum(request_count) AS requests
FROM api_endpoint_hourly
WHERE service = 'case-api'
  AND hour >= now() - INTERVAL 1 DAY
GROUP BY endpoint
ORDER BY requests DESC
LIMIT 20;
```

### 8.5 Report Export Table

Untuk report regulasi bulanan, kadang lebih aman membuat report table fixed:

```text
report_month
tenant_id
agency_id
metric_code
metric_value
calculation_version
generated_at
source_range_start
source_range_end
```

Ini bukan hanya performa. Ini membantu:

- reproducibility;
- audit;
- calculation versioning;
- sign-off workflow;
- retention evidence.

### 8.6 Search Helper Table

ClickHouse bisa melakukan beberapa search-like query, tetapi jangan paksa semua menjadi full text search.

Untuk analytics search helper:

```text
case_id
tenant_id
last_event_time
case_type
agency_id
normalized_tags
summary_tokens
```

Table ini bisa membantu drill-down dari aggregate ke candidate case list.

---

## 9. Query Rewrite Manual

ClickHouse tidak otomatis selalu memilih rollup table seperti semantic layer penuh. Aplikasi sering perlu memilih sendiri.

### 9.1 Raw Query

```sql
SELECT
    toDate(event_time) AS day,
    agency_id,
    countIf(event_type = 'ESCALATED') AS escalations
FROM case_events_raw
WHERE tenant_id = {tenant:String}
  AND event_time >= {from:DateTime}
  AND event_time <  {to:DateTime}
GROUP BY day, agency_id;
```

### 9.2 Rollup Query

```sql
SELECT
    toDate(hour) AS day,
    agency_id,
    sumIf(event_count, event_type = 'ESCALATED') AS escalations
FROM case_events_hourly_rollup
WHERE tenant_id = {tenant:String}
  AND hour >= {from:DateTime}
  AND hour <  {to:DateTime}
GROUP BY day, agency_id;
```

### 9.3 API Layer Decision

```java
record AnalyticsRequest(
    String tenantId,
    Instant from,
    Instant to,
    List<String> groupBy,
    List<String> metrics
) {}
```

Routing:

```java
public QueryPlan plan(AnalyticsRequest request) {
    Duration range = Duration.between(request.from(), request.to());

    if (request.metrics().contains("raw_event_list")) {
        return QueryPlan.rawDetail();
    }

    if (range.compareTo(Duration.ofDays(30)) > 0) {
        return QueryPlan.dailyRollup();
    }

    if (range.compareTo(Duration.ofHours(12)) > 0) {
        return QueryPlan.hourlyRollup();
    }

    return QueryPlan.minuteRollup();
}
```

### 9.4 Beware Metric Semantics

Not every query can be rewritten safely.

Safe rewrite:

```text
sum event_count from hourly -> daily event_count
```

Unsafe rewrite:

```text
sum hourly unique_cases -> daily unique_cases
```

Safe if state is stored:

```text
uniqMerge(hourly unique_cases_state) -> daily unique_cases
```

The query planner must understand metric semantics.

---

## 10. Late Arriving Events

### 10.1 Definition

Late event:

```text
ingest_time much later than event_time
```

Example:

```text
event_time  = 2026-06-01 10:00:00
ingest_time = 2026-06-05 12:00:00
```

If hourly rollup groups by `event_time`, this event updates a historical bucket.

### 10.2 Why Late Events Matter

Dashboards often show:

```text
last 7 days
last month
monthly compliance report
```

Late events can change historical numbers.

Need policy:

- Are historical buckets mutable?
- How long do we accept late events?
- Do reports freeze after sign-off?
- Do we show provisional vs final numbers?
- Do we backfill/recompute closed periods?

### 10.3 ClickHouse MV Behavior With Late Events

If late event is inserted into raw table, MV will aggregate into the bucket based on `event_time`:

```sql
toStartOfHour(event_time)
```

This works naturally for append late events.

But problem arises for:

- duplicate correction;
- event deletion;
- updated event fields;
- signed-off reports;
- immutable regulatory submissions.

### 10.4 Watermark Pattern

Define data completeness rule:

```text
A daily bucket is considered final after event_time day + 72 hours.
```

Serving API can expose:

```text
provisional for recent days
final for old days
```

Report generation can use only final windows.

### 10.5 Correction Table Pattern

Instead of mutating old raw rows, write correction events:

```text
original event -> correction event -> metric compensation
```

Example:

```text
+1 escalation event was wrongly emitted
correction event contributes -1 escalation_count
```

This is more defensible for audit-heavy systems.

### 10.6 Rebuild Window Pattern

For recent mutable period:

```text
rebuild last N days rollup periodically
```

Approach:

1. create temporary rollup table for period;
2. insert-select from raw for period;
3. validate counts;
4. replace partition in target table.

This avoids massive mutations.

---

## 11. Backfill and Rebuild Strategy

### 11.1 Why Backfill Is Inevitable

You will need backfill when:

- adding new materialized view;
- adding new metric;
- changing dimension mapping;
- fixing bug in transformation;
- migrating schema;
- onboarding historical data;
- rebuilding corrupted/incorrect rollup;
- changing aggregate function semantics.

If the system cannot backfill, it cannot evolve safely.

### 11.2 Avoid Blind `POPULATE` for Large Production Tables

For large datasets, prefer explicit backfill:

```sql
INSERT INTO case_events_hourly_rollup
SELECT
    toStartOfHour(event_time) AS hour,
    tenant_id,
    agency_id,
    event_type,
    severity,
    count() AS event_count,
    uniqState(case_id) AS unique_cases,
    quantileTDigestState(0.95)(processing_duration_ms) AS p95_processing_duration
FROM case_events_raw
WHERE event_time >= toDateTime('2026-01-01 00:00:00', 'UTC')
  AND event_time <  toDateTime('2026-02-01 00:00:00', 'UTC')
GROUP BY hour, tenant_id, agency_id, event_type, severity;
```

Backfill by partition/window:

```text
month by month
or day by day
or tenant by tenant + month
```

### 11.3 Shadow Table Pattern

When changing rollup definition:

```text
case_events_hourly_rollup_v1
case_events_hourly_rollup_v2_shadow
```

Steps:

1. create v2 target table;
2. create v2 materialized view for new incoming data with a cutover boundary;
3. backfill historical data into v2;
4. validate v1 vs v2 on overlapping metrics;
5. switch API to v2;
6. retire v1 after safety window.

### 11.4 Cutover Boundary

Example:

```text
cutover_time = 2026-07-01 00:00:00 UTC
```

MV for new data:

```sql
CREATE MATERIALIZED VIEW case_events_hourly_rollup_v2_mv
TO case_events_hourly_rollup_v2
AS
SELECT ...
FROM case_events_raw
WHERE event_time >= toDateTime('2026-07-01 00:00:00', 'UTC')
GROUP BY ...;
```

Historical backfill:

```sql
INSERT INTO case_events_hourly_rollup_v2
SELECT ...
FROM case_events_raw
WHERE event_time < toDateTime('2026-07-01 00:00:00', 'UTC')
GROUP BY ...;
```

This avoids double counting.

### 11.5 Validation Queries

Raw vs rollup count:

```sql
SELECT
    toDate(event_time) AS day,
    count() AS raw_events
FROM case_events_raw
WHERE event_time >= '2026-06-01'
  AND event_time < '2026-07-01'
GROUP BY day
ORDER BY day;
```

```sql
SELECT
    toDate(hour) AS day,
    sum(event_count) AS rollup_events
FROM case_events_hourly_rollup
WHERE hour >= '2026-06-01'
  AND hour < '2026-07-01'
GROUP BY day
ORDER BY day;
```

Compare using application/reconciliation job.

### 11.6 Backfill Resource Control

Backfill can compete with production queries.

Control:

- run during lower-traffic windows;
- limit per partition/day;
- use settings for memory/thread limits;
- monitor merges and parts;
- avoid generating millions of tiny parts;
- batch insert into reasonable windows;
- isolate cluster if needed.

---

## 12. Rollup Table Engine Choice

### 12.1 `AggregatingMergeTree`

Best when storing aggregate states.

Use for:

- distinct count;
- quantile;
- avg state;
- topK state;
- complex aggregation.

Example:

```sql
ENGINE = AggregatingMergeTree
ORDER BY (...)
```

### 12.2 `SummingMergeTree`

Useful for simple additive numeric metrics.

Use for:

- event_count;
- amount_sum;
- byte_sum;
- error_count.

But be careful: if you need non-additive metrics, `SummingMergeTree` alone is not enough.

### 12.3 Plain `MergeTree`

Useful for already-final serving rows where merge semantics are not needed.

Example:

- generated monthly report rows;
- export-ready table;
- snapshot table where rows are inserted once per period.

### 12.4 `ReplacingMergeTree`

Useful for latest-state serving table.

But remember:

- replacement happens during background merges;
- duplicate versions can exist before merge;
- query with `FINAL` can be expensive;
- correctness-sensitive queries need careful handling.

### 12.5 Choosing Engine

| Need | Engine candidate |
|---|---|
| Sum-only counters | `SummingMergeTree` or `AggregatingMergeTree` |
| Distinct/quantile/avg states | `AggregatingMergeTree` |
| Latest state | `ReplacingMergeTree` |
| Final report rows | `MergeTree` |
| Mutable correction-heavy data | event/correction model + aggregate rebuild |

---

## 13. Designing Rollup Dimensions

### 13.1 Dimension Explosion

Every dimension added to rollup multiplies row count.

If rollup grain:

```text
hour + tenant + agency + event_type + severity + actor_role + region + channel
```

Approximate row upper bound:

```text
hours * tenants * agencies * event_types * severities * roles * regions * channels
```

Most combinations may not exist, but high cardinality dimensions can still explode.

### 13.2 Hot Dimensions vs Drill-Down Dimensions

Hot dimensions:

- commonly used in dashboard group/filter;
- low/medium cardinality;
- stable semantics;
- worth materializing.

Drill-down dimensions:

- used occasionally;
- high cardinality;
- may be served from raw/detail table.

Example:

| Dimension | Use in rollup? | Reason |
|---|---:|---|
| tenant_id | yes | mandatory access boundary |
| agency_id | yes | common grouping |
| event_type | yes | common filter/metric |
| severity | yes | common reporting dimension |
| case_id | no for generic rollup | too high cardinality |
| actor_id | usually no | high cardinality, drill-down |
| comment_text | no | not aggregate dimension |

### 13.3 Hierarchical Dimensions

Example:

```text
region -> agency -> office -> team
```

Options:

1. store lowest level and join/enrich later;
2. store all levels in rollup;
3. maintain separate rollups at different hierarchy levels.

Trade-off:

- storing all levels increases row width but makes query simple;
- separate rollups reduce query cost but increase pipeline complexity;
- late changes in hierarchy can require rebuild.

### 13.4 Slowly Changing Dimensions

If agency belongs to region A today but region B next month, historical report semantics matter.

Options:

1. event-time dimension snapshot: store `region_at_event_time`;
2. current dimension: join current mapping at query time;
3. report-specific dimension version.

For audit-heavy reporting, prefer explicit historical dimension attributes in event/refined/rollup.

---

## 14. Serving Layer for Dashboard

### 14.1 Dashboard Workload Characteristics

Dashboard tends to:

- issue multiple queries at once;
- refresh periodically;
- repeat similar queries;
- use fixed charts;
- require predictable latency;
- tolerate slightly stale data;
- need drill-down path.

This is perfect for serving tables.

### 14.2 Design Dashboard Backwards

Start from widgets:

```text
Widget 1: daily escalation count by agency
Widget 2: SLA breach rate by severity
Widget 3: p95 processing duration by agency
Widget 4: top 20 agencies by overdue cases
Widget 5: current open cases by status
```

Map each to table:

| Widget | Source |
|---|---|
| daily escalation trend | daily/hourly rollup |
| SLA breach rate | daily case metric rollup |
| p95 duration | aggregate state rollup |
| top agencies | rollup + top-N query |
| current open cases | latest-state/current snapshot serving table |

Do not force every widget to one generic raw query.

### 14.3 Dashboard Freshness

Define freshness per widget:

| Widget | Freshness |
|---|---:|
| real-time event counter | 10s-60s |
| daily compliance report | hourly/daily |
| monthly sign-off | frozen after approval |
| operational alert | near real-time |

Freshness affects ingestion and rollup design.

### 14.4 Dashboard Drill-Down

A good pattern:

```text
aggregate chart -> click bucket/dimension -> query detail IDs -> fetch raw detail
```

Example:

1. chart shows escalation spike on June 21 for agency A;
2. user clicks point;
3. backend queries raw/refined table for events in that bucket;
4. detail API paginates by event_time/case_id.

Rollup is not supposed to replace detail table.

---

## 15. Regulatory / Case-Management Reporting Pattern

This section maps directly to complex lifecycle/regulatory systems.

### 15.1 Domain Model

Assume cases move through states:

```text
CREATED -> TRIAGED -> INVESTIGATING -> ESCALATED -> RESOLVED -> CLOSED
```

Events:

```text
CASE_CREATED
STATUS_CHANGED
ASSIGNED
ESCALATED
DE_ESCALATED
SLA_STARTED
SLA_BREACHED
SLA_PAUSED
SLA_RESUMED
CASE_CLOSED
```

Business questions:

- how many cases were created per agency per day?
- how many escalations occurred?
- how many unique cases breached SLA?
- what is median/p95 time to resolution?
- how many cases are currently open?
- how many cases changed jurisdiction?
- how many enforcement actions were triggered?

One raw table cannot efficiently answer all of these forever.

### 15.2 Raw Lifecycle Event Table

```sql
CREATE TABLE case_lifecycle_events_raw
(
    event_id UUID,
    tenant_id LowCardinality(String),
    case_id String,
    agency_id LowCardinality(String),
    jurisdiction LowCardinality(String),
    case_type LowCardinality(String),
    event_type LowCardinality(String),
    from_status LowCardinality(Nullable(String)),
    to_status LowCardinality(Nullable(String)),
    severity LowCardinality(String),
    event_time DateTime64(3, 'UTC'),
    ingest_time DateTime64(3, 'UTC'),
    actor_role LowCardinality(String),
    version UInt64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, agency_id, case_type, case_id);
```

### 15.3 Daily Event Rollup

```sql
CREATE TABLE case_lifecycle_daily_rollup
(
    day Date,
    tenant_id LowCardinality(String),
    agency_id LowCardinality(String),
    jurisdiction LowCardinality(String),
    case_type LowCardinality(String),
    severity LowCardinality(String),
    event_type LowCardinality(String),

    event_count SimpleAggregateFunction(sum, UInt64),
    unique_cases AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, event_type, day, agency_id, jurisdiction, case_type, severity);
```

MV:

```sql
CREATE MATERIALIZED VIEW case_lifecycle_daily_rollup_mv
TO case_lifecycle_daily_rollup
AS
SELECT
    toDate(event_time) AS day,
    tenant_id,
    agency_id,
    jurisdiction,
    case_type,
    severity,
    event_type,
    count() AS event_count,
    uniqState(case_id) AS unique_cases
FROM case_lifecycle_events_raw
GROUP BY
    day,
    tenant_id,
    agency_id,
    jurisdiction,
    case_type,
    severity,
    event_type;
```

### 15.4 Query Escalation Trend

```sql
SELECT
    day,
    agency_id,
    sum(event_count) AS escalation_events,
    uniqMerge(unique_cases) AS escalated_cases
FROM case_lifecycle_daily_rollup
WHERE tenant_id = 'regulator-x'
  AND event_type = 'ESCALATED'
  AND day >= toDate('2026-01-01')
  AND day <  toDate('2026-07-01')
GROUP BY day, agency_id
ORDER BY day, agency_id;
```

### 15.5 SLA Breach Rollup

SLA breach may need special semantics. If one case can breach multiple times, decide whether metric is:

- breach events;
- unique cases that breached;
- current breached cases;
- first breach per case;
- breach duration.

For unique breach cases:

```sql
SELECT
    day,
    agency_id,
    uniqMerge(unique_cases) AS cases_breached
FROM case_lifecycle_daily_rollup
WHERE event_type = 'SLA_BREACHED'
GROUP BY day, agency_id;
```

For current breached cases, use state/current snapshot, not event rollup.

### 15.6 Time-to-Resolution Rollup

Time-to-resolution is not a simple event count. It is derived when case closes.

Refined close event table:

```text
one row = one case closure
columns: case_id, created_time, closed_time, resolution_duration_ms, agency_id, case_type, severity
```

Rollup:

```sql
CREATE TABLE case_resolution_daily_rollup
(
    day Date,
    tenant_id LowCardinality(String),
    agency_id LowCardinality(String),
    case_type LowCardinality(String),
    severity LowCardinality(String),

    closed_cases SimpleAggregateFunction(sum, UInt64),
    avg_resolution AggregateFunction(avg, UInt64),
    p50_resolution AggregateFunction(quantileTDigest(0.50), UInt64),
    p95_resolution AggregateFunction(quantileTDigest(0.95), UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, agency_id, case_type, severity);
```

MV:

```sql
CREATE MATERIALIZED VIEW case_resolution_daily_rollup_mv
TO case_resolution_daily_rollup
AS
SELECT
    toDate(closed_time) AS day,
    tenant_id,
    agency_id,
    case_type,
    severity,
    count() AS closed_cases,
    avgState(resolution_duration_ms) AS avg_resolution,
    quantileTDigestState(0.50)(resolution_duration_ms) AS p50_resolution,
    quantileTDigestState(0.95)(resolution_duration_ms) AS p95_resolution
FROM case_closure_facts
GROUP BY day, tenant_id, agency_id, case_type, severity;
```

Query:

```sql
SELECT
    day,
    agency_id,
    sum(closed_cases) AS closed_cases,
    avgMerge(avg_resolution) AS avg_resolution_ms,
    quantileTDigestMerge(0.50)(p50_resolution) AS p50_resolution_ms,
    quantileTDigestMerge(0.95)(p95_resolution) AS p95_resolution_ms
FROM case_resolution_daily_rollup
WHERE tenant_id = 'regulator-x'
GROUP BY day, agency_id
ORDER BY day, agency_id;
```

### 15.7 Auditability

For regulatory systems, every aggregate should answer:

- What raw events contributed?
- What calculation version was used?
- What time window was used?
- Was the metric provisional or final?
- Was there a correction after report sign-off?

You may need extra metadata columns:

```text
calculation_version
source_schema_version
data_completeness_status
generated_at
watermark_time
```

Serving design is not only performance design; it is defensibility design.

---

## 16. Materialized View Backfill Example End-to-End

### 16.1 Scenario

You already have raw table with 18 months data. You add a new daily rollup.

Naive approach:

```sql
CREATE MATERIALIZED VIEW ... POPULATE ...
```

Risk:

- can miss concurrent inserts depending on timing;
- hard to control resource usage;
- hard to validate;
- not ideal for large datasets.

### 16.2 Safer Approach

Pick cutover:

```text
cutover = 2026-07-01 00:00:00 UTC
```

Create target table.

Create MV for new data only:

```sql
CREATE MATERIALIZED VIEW case_lifecycle_daily_rollup_mv
TO case_lifecycle_daily_rollup
AS
SELECT ...
FROM case_lifecycle_events_raw
WHERE event_time >= toDateTime('2026-07-01 00:00:00', 'UTC')
GROUP BY ...;
```

Backfill old data month by month:

```sql
INSERT INTO case_lifecycle_daily_rollup
SELECT ...
FROM case_lifecycle_events_raw
WHERE event_time >= toDateTime('2026-01-01 00:00:00', 'UTC')
  AND event_time <  toDateTime('2026-02-01 00:00:00', 'UTC')
GROUP BY ...;
```

Repeat for all historical windows.

Validate:

```sql
SELECT count()
FROM case_lifecycle_events_raw
WHERE event_time >= '2026-01-01'
  AND event_time < '2026-02-01';
```

```sql
SELECT sum(event_count)
FROM case_lifecycle_daily_rollup
WHERE day >= '2026-01-01'
  AND day < '2026-02-01';
```

If filtered by event_type/dimensions, validate per dimension.

### 16.3 Replace Partition Strategy

For rebuilding one month:

1. build into temporary table;
2. validate temporary table;
3. replace partition in production table.

Conceptual:

```sql
CREATE TABLE case_lifecycle_daily_rollup_tmp AS case_lifecycle_daily_rollup;
```

Insert corrected month into tmp.

Then use partition replacement techniques appropriate to your ClickHouse version and operational policy.

The main principle:

> Do not mutate billions of rows in place if you can rebuild and swap a bounded partition.

---

## 17. Correctness Model

### 17.1 Define Metric Contract

Every metric should have a definition like:

```text
Metric: escalated_cases
Definition: unique case_id that had at least one ESCALATED event in the selected time window.
Time basis: event_time.
Deduplication: event_id uniqueness assumed; case uniqueness via uniq(case_id).
Late data policy: provisional until T+72h.
Correction policy: correction events applied in next rebuild cycle.
```

Without this, disputes become impossible to resolve.

### 17.2 Raw vs Rollup Reconciliation

For each rollup:

- compare count totals;
- compare distinct approximate/exact within acceptable tolerance;
- compare selected sample windows;
- compare known test fixtures;
- track last successful backfill/validation.

### 17.3 Approximation Policy

Approximate functions are often fine for dashboards but not always for official reports.

Example:

| Use case | Approx ok? |
|---|---:|
| product analytics unique users | often yes |
| operational dashboard p95 latency | yes |
| billing count | no |
| regulatory official count | usually no |
| compliance breach count | no/depends |

If exactness required, design cost into the system.

### 17.4 Versioned Calculations

Metric definitions change.

Add:

```text
metric_version
calculation_version
schema_version
```

This is especially valuable for regulated systems.

---

## 18. Operational Observability for Rollups

### 18.1 Monitor Source Inserts

Questions:

- Are raw inserts successful?
- Are materialized views firing?
- Is insert latency increasing?
- Are there rejected rows?

### 18.2 Monitor Target Parts

```sql
SELECT
    table,
    partition,
    count() AS active_parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS size
FROM system.parts
WHERE active
  AND table IN ('case_lifecycle_daily_rollup', 'case_events_hourly_rollup')
GROUP BY table, partition
ORDER BY active_parts DESC;
```

Too many parts in rollup table can still happen, especially if MV emits many small grouped blocks.

### 18.3 Monitor Merges

```sql
SELECT
    database,
    table,
    elapsed,
    progress,
    num_parts,
    formatReadableSize(total_size_bytes_compressed) AS compressed
FROM system.merges
ORDER BY elapsed DESC;
```

### 18.4 Monitor Query Usage

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
  AND event_time >= now() - INTERVAL 1 HOUR
  AND query ILIKE '%case_lifecycle_daily_rollup%'
ORDER BY query_duration_ms DESC
LIMIT 20;
```

### 18.5 Freshness Check

```sql
SELECT
    max(hour) AS latest_hour,
    now() - max(hour) AS lag
FROM case_events_hourly_rollup
WHERE tenant_id = 'tenant-a';
```

For raw:

```sql
SELECT
    max(event_time) AS latest_event_time,
    max(ingest_time) AS latest_ingest_time
FROM case_events_raw
WHERE tenant_id = 'tenant-a';
```

### 18.6 Reconciliation Job

A Java scheduled job can:

1. select random day/tenant;
2. compute raw totals;
3. compute rollup totals;
4. compare;
5. emit metric or alert.

Pseudo-code:

```java
public final class RollupReconciliationJob {
    public void run(LocalDate day, String tenantId) {
        long raw = queryRawEventCount(day, tenantId);
        long rollup = queryRollupEventCount(day, tenantId);

        if (raw != rollup) {
            alert(day, tenantId, raw, rollup);
        }
    }
}
```

For approximate metrics, use tolerance.

---

## 19. Performance Pitfalls

### 19.1 Rollup with Too Many Dimensions

Bad:

```text
hour + tenant + user_id + session_id + endpoint + status + browser + device + country + city
```

This may be almost as large as raw.

Better:

- generic low-cardinality rollup;
- separate endpoint rollup;
- raw drill-down for user/session;
- top-N serving if needed.

### 19.2 Storing Final Distinct Counts

Bad:

```text
hourly_unique_users UInt64
```

Then summing across hours gives wrong daily unique users.

Better:

```text
unique_users AggregateFunction(uniq, String)
```

### 19.3 Average of Averages

Bad:

```text
daily_avg = avg(hourly_avg)
```

Better:

```text
sum / count
```

or aggregate state.

### 19.4 Querying `AggregatingMergeTree` Without Merge Functions

Bad:

```sql
SELECT unique_cases FROM rollup;
```

Better:

```sql
SELECT uniqMerge(unique_cases) FROM rollup;
```

### 19.5 Using `FINAL` as a Habit

`FINAL` can be expensive. If every API query needs `FINAL`, revisit engine/design.

### 19.6 No Backfill Plan

If materialized view is created without historical plan, dashboards may show partial data.

### 19.7 No Cutover Boundary

Backfilling and live MV can double count if windows overlap.

### 19.8 Treating Rollup as Immutable Truth

Rollup should usually be rebuildable from raw. If not, corrections become dangerous.

### 19.9 Ignoring Late Data

Numbers will change unexpectedly unless late data policy is explicit.

### 19.10 Overusing Cascading Materialized Views

Cascading can be powerful, but make state semantics and insert flow harder to reason about.

---

## 20. Java/System Architecture Perspective

### 20.1 Analytics API Should Not Be a Generic SQL Proxy

Bad architecture:

```text
frontend sends arbitrary dimensions/metrics
backend builds arbitrary ClickHouse query
all queries hit raw table
```

Better architecture:

```text
analytics API exposes supported metrics/dimensions
backend maps request to known query plan
query plan maps to specific serving table
```

### 20.2 Metric Catalog

Represent metrics explicitly:

```java
public enum Metric {
    EVENT_COUNT,
    UNIQUE_CASES,
    ESCALATION_RATE,
    P95_PROCESSING_DURATION
}
```

Each metric knows:

```text
source table
required aggregate expression
merge expression
allowed dimensions
exact/approx semantics
freshness
```

Example conceptual model:

```java
record MetricDefinition(
    String name,
    String expression,
    Set<String> allowedDimensions,
    boolean approximate,
    Duration freshnessSla
) {}
```

### 20.3 Query Templates

Use parameterized templates, not string concatenation.

```sql
SELECT
    day,
    agency_id,
    sum(event_count) AS events,
    uniqMerge(unique_cases) AS unique_cases
FROM case_lifecycle_daily_rollup
WHERE tenant_id = {tenant_id:String}
  AND day >= {from:Date}
  AND day <  {to:Date}
GROUP BY day, agency_id
ORDER BY day, agency_id
```

### 20.4 Resolution Routing

```java
public ServingTable chooseServingTable(AnalyticsRequest request) {
    if (request.requiresDetail()) {
        return ServingTable.RAW_EVENTS;
    }
    if (request.range().toDays() > 90) {
        return ServingTable.DAILY_ROLLUP;
    }
    if (request.range().toHours() > 12) {
        return ServingTable.HOURLY_ROLLUP;
    }
    return ServingTable.MINUTE_ROLLUP;
}
```

### 20.5 Safe Degradation

If raw detail query is too expensive, API can return:

```text
Please narrow time range or choose fewer dimensions.
```

Do not let arbitrary user query scan years of raw data with high-cardinality grouping.

### 20.6 Caching on Top of Rollup

Rollup and cache are complementary.

Use cache for:

- dashboard default views;
- expensive period-over-period query;
- slow-changing report;
- high-traffic common request.

But cache should not be the only performance layer.

---

## 21. Design Review Checklist

Before creating a rollup/serving table, answer:

### Business/Metric

- What question does this table serve?
- What is the metric definition?
- Is metric additive, semi-additive, or non-additive?
- Is approximate result acceptable?
- What is freshness SLA?
- Is the data provisional or final?

### Grain

- What is one row?
- What is time bucket?
- What dimensions are included?
- Are any dimensions high-cardinality?
- Can query grain be derived safely from rollup grain?

### Engine/Storage

- Which engine is appropriate?
- Do we need aggregate states?
- What is `ORDER BY`?
- What is `PARTITION BY`?
- What is expected row count per day/month?
- What is retention policy?

### Pipeline

- What source table feeds this?
- Is MV live only or also historical?
- What is backfill plan?
- What is cutover boundary?
- Can it be rebuilt?
- How are late events handled?
- How are corrections handled?

### Query/API

- Which endpoints use this table?
- What SQL templates are allowed?
- What filters/groupings are supported?
- What max range is allowed?
- What fallback exists?

### Operations

- How do we monitor freshness?
- How do we monitor parts/merges?
- How do we reconcile raw vs rollup?
- How do we validate after backfill?
- How do we version metric logic?

---

## 22. Exercises

### Exercise 1 — Pick Rollup Grain

Requirement:

```text
Dashboard shows daily case creation, escalation, SLA breach, and closure counts by agency, case type, and severity for last 24 months.
```

Design:

- raw table grain;
- rollup table grain;
- metrics;
- aggregate states needed;
- partition key;
- sorting key.

### Exercise 2 — Identify Unsafe Aggregation

Given hourly table:

```text
hour, service, endpoint, unique_users UInt64, avg_latency Float64
```

Explain why daily query using:

```sql
sum(unique_users), avg(avg_latency)
```

is wrong. Propose correct table shape.

### Exercise 3 — Late Event Policy

Requirement:

```text
Events can arrive up to 5 days late. Monthly compliance report is signed off on the 7th day of next month.
```

Design:

- provisional/final period;
- rebuild window;
- report freeze policy;
- correction handling.

### Exercise 4 — Dashboard Routing

You have:

- raw table;
- 1-minute rollup;
- 1-hour rollup;
- 1-day rollup.

Define routing rules for query ranges:

- last 30 minutes;
- last 24 hours;
- last 90 days;
- last 2 years.

### Exercise 5 — Backfill Plan

You need to add p95 resolution time to a daily rollup that already exists.

Design:

- new table or ALTER existing table?
- new MV?
- historical backfill?
- validation?
- API cutover?

---

## 23. Summary

Materialized views become truly powerful when they are used not only as a convenience feature, but as part of a deliberate serving architecture.

The main ideas:

1. Raw table is truth; serving table is product.
2. Rollup is not cache; it is precomputed analytical structure.
3. Pre-aggregation moves work from query time to ingestion/merge time.
4. Rollup grain determines correctness and cost.
5. Additive metrics can be summed; non-additive metrics need states or special handling.
6. Distinct count, percentile, average, and ratio require careful semantics.
7. Multi-resolution rollups support different time ranges efficiently.
8. Backfill and rebuild are mandatory design requirements.
9. Late events and corrections require explicit policy.
10. Java analytics APIs should route requests to known serving tables, not generate arbitrary raw-table queries.
11. Regulatory/reporting systems need calculation versioning, reproducibility, and auditability.

If Part 014 taught **how materialized views work**, this part taught **how to use them as a production architecture tool**.

---

## 24. What Comes Next

Next part:

```text
learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-016.md
```

Topic:

```text
Projections, Data Skipping Indexes, and Secondary Access Paths
```

We will learn:

- how projections differ from materialized views;
- when projections can act like alternate physical layouts;
- minmax/set/bloom/token/ngram skip indexes;
- why secondary access paths in ClickHouse are not like OLTP indexes;
- how to test whether an index actually helps;
- how to avoid indexing theater.

---

## 25. Status Seri

Seri belum selesai.

Progress:

```text
Part 000 selesai
Part 001 selesai
Part 002 selesai
Part 003 selesai
Part 004 selesai
Part 005 selesai
Part 006 selesai
Part 007 selesai
Part 008 selesai
Part 009 selesai
Part 010 selesai
Part 011 selesai
Part 012 selesai
Part 013 selesai
Part 014 selesai
Part 015 selesai  <-- posisi saat ini
Part 016 berikutnya
...
Part 034 terakhir
```

Masih tersisa:

```text
Part 016 sampai Part 034
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-014.md">⬅️ Part 014 — Materialized Views I: Incremental Transformation Mental Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-016.md">Part 016 — Projections, Data Skipping Indexes, and Secondary Access Paths ➡️</a>
</div>
